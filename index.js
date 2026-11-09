/**
 * Scene Anchor – companion to Smart Memory for active-scene continuity.
 * Prototype v0.1.0. Runs in SillyTavern's browser extension environment.
 * It does NOT modify Smart Memory's stored memories or character cards.
 */
import {
    eventSource, event_types, setExtensionPrompt, extension_prompt_types,
    extension_prompt_roles, saveSettingsDebounced,
} from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';
import { readableMessages, explicitSceneReset, parseAnchor, buildExtractionPrompt, renderAnchor } from './scene-core.js';

const NAME = 'scene_anchor_companion';
const META = 'scene_anchor_companion_v1';
const SLOT = 'scene_anchor_companion_current';
const DEFAULTS = { enabled: true, autoRefresh: true, depth: 0, messages: 14, maxInputPerMessage: 1500, attachUserOverride: false };
let memoryExtractorPromise = null;
let running = false;
let pending = false;
let lastRequestedKey = '';
let chatVersion = 0;

function settings() {
    if (!extension_settings[NAME]) extension_settings[NAME] = { ...DEFAULTS };
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (!(k in extension_settings[NAME])) extension_settings[NAME][k] = v;
    }
    return extension_settings[NAME];
}
function ctx() { return getContext(); }
function currentMeta() { return ctx().chatMetadata?.[META] || null; }
function currentMessages() { return Array.isArray(ctx().chat) ? ctx().chat : []; }
function lastUser() { return [...currentMessages()].reverse().find(m => m?.is_user && !m.is_system && typeof m.mes === 'string'); }
function currentChatKey() {
    const c = ctx();
    return String(c.chatId ?? c.groupId ?? c.characterId ?? '') + '/' + currentMessages().length;
}
function currentFingerprint() {
    const msgs = currentMessages();
    const tail = msgs[msgs.length - 1] || {};
    return `${currentChatKey()}/${String(tail.mes || '').slice(-100)}`;
}
function inject() {
    const conf = settings();
    if (!conf.enabled || !currentMessages().length) {
        setExtensionPrompt(SLOT, '', extension_prompt_types.NONE, 0);
        return;
    }
    const stored = currentMeta();
    const messages = currentMessages();
    const latest = messages.at(-1);
    const latestRaw = latest?.is_user ? String(latest.mes || '') : '';
    const latestText = conf.attachUserOverride ? latestRaw : '';
    // Important: a previous scene's snapshot MUST NOT survive an explicit time jump.
    const reset = latest?.is_user && explicitSceneReset(latestRaw);
    let snap = stored?.snapshot || null;
    // A copied chat can inherit stale metadata. Avoid using an anchor from the future.
    if (stored?.processedLength > messages.length || stored?.processedLength < messages.length - 20) snap = null;
    const block = renderAnchor(snap, { override: latestText, reset: !!reset });
    setExtensionPrompt(SLOT, block, extension_prompt_types.IN_CHAT, conf.depth, false, extension_prompt_roles.SYSTEM);
    updateUI();
}
function extractor() {
    // Reuse the SAME separate model selected under Smart Memory → Memory LLM.
    // No NanoGPT token, API key, or connection profile is copied or exposed.
    if (!memoryExtractorPromise) {
        memoryExtractorPromise = import('../Smart-Memory/generate.js')
            .then(mod => {
                if (typeof mod.generateMemoryExtract !== 'function') throw Error('Smart Memory generation helper unavailable');
                return mod.generateMemoryExtract;
            }).catch(e => { memoryExtractorPromise = null; throw e; });
    }
    return memoryExtractorPromise;
}
async function refresh(reason = 'automatic') {
    const conf = settings();
    if (!conf.enabled || !currentMessages().length) return;
    if (running) { pending = true; return; }
    running = true;
    const capturedMeta = ctx().chatMetadata;
    const capturedVersion = chatVersion;
    const beforeLen = currentMessages().length;
    const beforeFingerprint = currentFingerprint();
    const previousRecord = currentMeta();
    const previous = previousRecord?.snapshot || null;
    try {
        updateStatus('Updating current scene…');
        const transcript = readableMessages(currentMessages(), conf.messages, conf.maxInputPerMessage);
        const prompt = buildExtractionPrompt(transcript, previous);
        const generate = await extractor();
        // ST connection profile selected in Smart Memory controls this generation.
        const raw = await generate(prompt, { responseLength: 550 });
        const result = parseAnchor(raw);
        if (!result) throw Error('The memory model returned a non-JSON scene snapshot');
        // Never write a result into a different chat or after additional messages arrived.
        if (capturedMeta !== ctx().chatMetadata || capturedVersion !== chatVersion || beforeFingerprint !== currentFingerprint()) {
            updateStatus('Scene changed while updating; discarded old result.');
            return;
        }
        const history = [...(previousRecord?.history || [])];
        const lastActualUser = [...currentMessages()].reverse().find(m => m?.is_user && !m.is_system);
        const explicit = explicitSceneReset(lastActualUser?.mes || '');
        if (previous && (result.scene_changed || explicit)) {
            const old = { ...previous };
            delete old.scene_changed;
            const oldSig = JSON.stringify(old);
            if (!history.length || JSON.stringify(history.at(-1)?.snapshot) !== oldSig) {
                history.push({ atMessage: previousRecord?.processedLength || beforeLen, snapshot: old });
            }
        }
        if (!ctx().chatMetadata) throw Error('Chat metadata is not available');
        ctx().chatMetadata[META] = {
            snapshot: result,
            processedLength: beforeLen,
            fingerprint: beforeFingerprint,
            history: history.slice(-25),
            timestamp: Date.now(),
            reason,
        };
        if (typeof ctx().saveMetadata === 'function') await ctx().saveMetadata();
        inject();
        updateStatus('Current scene updated.');
    } catch (error) {
        console.error('[Scene Anchor] Update failed', error);
        updateStatus(`Update failed: ${error.message}`);
    } finally {
        running = false;
        if (pending) { pending = false; setTimeout(() => refresh('queued'), 300); }
    }
}
function updateStatus(text) {
    const el = document.querySelector('#scene-anchor-status');
    if (el) el.textContent = text;
}
function updateUI() {
    const area = document.querySelector('#scene-anchor-view');
    const history = document.querySelector('#scene-anchor-history');
    if (area) {
        const rec = currentMeta();
        const snap = rec?.snapshot;
        area.textContent = snap ? Object.entries(snap).filter(([k, v]) => k !== 'scene_changed' && v)
            .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`).join('\n') : 'No current snapshot yet. Use “Refresh scene” once, or let automatic tracking run.';
    }
    if (history) {
        const arr = currentMeta()?.history || [];
        history.textContent = arr.length ? arr.map((e, i) => `${i + 1}. Ended near message #${e.atMessage}: ${e.snapshot?.location || 'unknown'} — ${e.snapshot?.activity || 'unknown'}`).join('\n') : 'No completed scenes recorded yet.';
    }
}
async function buildUI() {
    const root = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!root || root.querySelector('#scene-anchor-companion-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'scene-anchor-companion-panel';
    panel.className = 'inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header"><b>Scene Anchor (experimental)</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content" style="padding:10px;">
        <label style="display:block; margin:8px 0;"><input type="checkbox" id="scene-anchor-enabled"> Enable live scene anchor</label>
        <label style="display:block; margin:8px 0;"><input type="checkbox" id="scene-anchor-auto"> Automatically refresh after replies</label>
        <p class="notes">Uses Smart Memory's configured Memory LLM. Writes one short replaceable scene note, not a running therapy or relationship summary. Automatically archives completed snapshots without injecting them.</p>
        <button class="menu_button" id="scene-anchor-refresh" type="button">Refresh current scene</button>
        <p class="notes" id="scene-anchor-status">Ready.</p>
        <h4>Current scene (view only)</h4><pre id="scene-anchor-view" style="white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto;"></pre>
        <details><summary>Completed scene index (not injected)</summary><pre id="scene-anchor-history" style="white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto;"></pre></details>
        <p class="notes">Test on a copy of your chat. Disable Smart Memory's outdated State Ledger, Short-Term Summary, and Character/World Profiles injection to avoid competing current-state notes.</p>
      </div>`;
    root.appendChild(panel);
    document.querySelector('#scene-anchor-enabled').checked = settings().enabled;
    document.querySelector('#scene-anchor-auto').checked = settings().autoRefresh;
    document.querySelector('#scene-anchor-enabled').addEventListener('change', e => {
        settings().enabled = e.target.checked; saveSettingsDebounced(); inject();
    });
    document.querySelector('#scene-anchor-auto').addEventListener('change', e => {
        settings().autoRefresh = e.target.checked; saveSettingsDebounced();
    });
    document.querySelector('#scene-anchor-refresh').addEventListener('click', () => refresh('manual'));
    updateUI();
}
function onChatChanged() {
    chatVersion++;
    lastRequestedKey = '';
    inject();
    // Initial snapshot of latest 14 messages when opening an already-long chat.
    // Avoid needless regeneration when the stored snapshot already matches the chat.
    if (settings().enabled && settings().autoRefresh && currentMessages().length > 0) {
        const rec = currentMeta();
        if (!rec || rec.fingerprint !== currentFingerprint()) {
            setTimeout(() => refresh('chat-load'), 500);
        }
    }
}
function onUserMessage() {
    // Synchronous update is intentional: latest user scene shift can cancel a stale
    // anchor *before* the main model sends its next response.
    inject();
}
function onAiRendered(_id, type) {
    if (!settings().enabled || !settings().autoRefresh) return;
    if (type === 'quiet' || type === 'impersonate' || type === 'continue') return;
    const key = currentFingerprint();
    if (key === lastRequestedKey) return;
    lastRequestedKey = key;
    setTimeout(() => refresh('reply'), 250);
}

await buildUI();
// Some ST versions mount their extension settings panel after extension JS runs.
if (event_types.APP_READY) eventSource.on(event_types.APP_READY, () => { buildUI(); updateUI(); });
setTimeout(() => buildUI(), 1200);
// Generation interceptors are run just before a normal prompt is assembled; this
// guarantees a new user's scene transition suppresses an old snapshot in time.
globalThis.sceneAnchorBeforeGeneration = async (_chat, _contextSize, _abort, type) => {
    if (type === 'quiet' || type === 'impersonate') return;
    inject();
};
eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
if (event_types.CHAT_LOADED) eventSource.on(event_types.CHAT_LOADED, onChatChanged);
eventSource.on(event_types.MESSAGE_SENT, onUserMessage);
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onAiRendered);
onChatChanged();
console.info('[Scene Anchor] Companion extension loaded.');
