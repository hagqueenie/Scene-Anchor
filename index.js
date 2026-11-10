/**
 * Scene Anchor v0.2.0: swipe-safe snapshots from the established story prefix.
 * Companions to Smart Memory. Does not modify chat messages or Smart Memory.
 */
import {
    eventSource, event_types, setExtensionPrompt, extension_prompt_types,
    extension_prompt_roles, saveSettingsDebounced,
} from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';
import {
    readableMessages, explicitSceneReset, parseAnchor, buildExtractionPrompt,
    renderAnchor, acceptedMessagesForGeneration, fingerprintAcceptedMessages,
} from './scene-core.js';

const NAME = 'scene_anchor_companion';
const META = 'scene_anchor_companion_v1'; // Keep chat data on upgrade.
const SLOT = 'scene_anchor_companion_current';
const DEFAULTS = { enabled: true, autoRefresh: true, depth: 0, messages: 14, maxInputPerMessage: 1500, attachUserOverride: false };
let memoryExtractorPromise = null;
let running = null;
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
function transcriptFor(messages, conf = settings()) {
    return readableMessages(messages, conf.messages, conf.maxInputPerMessage);
}
function selectedContext(mode = 'idle') {
    const messages = acceptedMessagesForGeneration(currentMessages(), mode);
    const transcript = transcriptFor(messages);
    return { messages, transcript, sourceKey: fingerprintTranscript(transcript) };
}
function inject(mode = 'idle') {
    const conf = settings();
    if (!conf.enabled || !currentMessages().length) {
        setExtensionPrompt(SLOT, '', extension_prompt_types.NONE, 0);
        return;
    }
    const selection = selectedContext(mode);
    const record = currentMeta();
    // v0.1 could save a discarded swipe as the current scene. Do not trust
    // legacy metadata (or an unmatched source) in this new, swipe-safe version.
    const snapshot = record?.sourceKey === selection.sourceKey ? record.snapshot : null;
    const latest = selection.messages.at(-1);
    const latestRaw = latest?.is_user ? String(latest.mes || '') : '';
    const reset = !!(latest?.is_user && explicitSceneReset(latestRaw) && !snapshot);
    const block = renderAnchor(snapshot, {
        reset,
        override: conf.attachUserOverride ? latestRaw : '',
    });
    setExtensionPrompt(SLOT, block, extension_prompt_types.IN_CHAT, conf.depth, false, extension_prompt_roles.SYSTEM);
    updateUI();
}
function extractor() {
    // Reuse Smart Memory's separately configured memory model.
    if (!memoryExtractorPromise) {
        memoryExtractorPromise = import('../Smart-Memory/generate.js')
            .then(mod => {
                if (typeof mod.generateMemoryExtract !== 'function') throw Error('Smart Memory generation helper unavailable');
                return mod.generateMemoryExtract;
            }).catch(e => { memoryExtractorPromise = null; throw e; });
    }
    return memoryExtractorPromise;
}

async function refresh(reason = 'manual', mode = 'idle') {
    const conf = settings();
    if (!conf.enabled || !currentMessages().length) return;

    // Never let two extractor calls overwrite one another. When a new user
    // turn arrives during extraction, wait for the older call, then recalculate
    // from the NEW accepted prefix before building the next prompt.
    if (running) await running.catch(() => {});
    if (!settings().enabled || !currentMessages().length) return;
    const selection = selectedContext(mode);
    if (!selection.transcript.trim()) { inject(mode); return; }
    const existing = currentMeta();
    if (existing?.sourceKey === selection.sourceKey && existing?.snapshot) {
        inject(mode);
        return;
    }

    const task = (async () => {
        const capturedMeta = ctx().chatMetadata;
        const capturedVersion = chatVersion;
        try {
            updateStatus('Updating accepted story state…');
            // A prior v0.1 snapshot may include a rejected swipe. Do not feed
            // legacy snapshots back into extraction during migration.
            const prior = existing?.sourceKey ? existing.snapshot : null;
            const prompt = buildExtractionPrompt(selection.transcript, prior);
            const generate = await extractor();
            const raw = await generate(prompt, { responseLength: 550 });
            const result = parseAnchor(raw);
            if (!result) throw Error('The memory model returned a non-JSON scene snapshot');

            // Revalidate against the accepted prefix, not the current last AI
            // message. A new generated swipe does not change this key.
            if (capturedMeta !== ctx().chatMetadata || capturedVersion !== chatVersion ||
                selectedContext(mode).sourceKey !== selection.sourceKey) {
                updateStatus('Story changed while extracting; ignored stale result.');
                return;
            }
            const history = [...(existing?.history || [])];
            const lastUser = [...selection.messages].reverse().find(m => m?.is_user && !m.is_system);
            const explicit = explicitSceneReset(lastUser?.mes || '');
            if (prior && (result.scene_changed || explicit) && existing.sourceKey !== selection.sourceKey) {
                const old = { ...prior };
                delete old.scene_changed;
                if (!history.length || JSON.stringify(history.at(-1)?.snapshot) !== JSON.stringify(old)) {
                    history.push({ atMessage: existing.processedLength || 0, snapshot: old });
                }
            }
            if (!ctx().chatMetadata) throw Error('Chat metadata is not available');
            ctx().chatMetadata[META] = {
                snapshot: result,
                sourceKey: selection.sourceKey,
                processedLength: selection.messages.length,
                history: history.slice(-25),
                timestamp: Date.now(),
                reason,
            };
            if (typeof ctx().saveMetadata === 'function') await ctx().saveMetadata();
            inject(mode);
            updateStatus('Accepted scene updated. Swipes will reuse this state.');
        } catch (error) {
            console.error('[Scene Anchor] Update failed', error);
            updateStatus(`Update failed: ${error.message}`);
            inject(mode); // Never fall back to a rejected swipe snapshot.
        }
    })();
    running = task;
    try { await task; } finally { if (running === task) running = null; }
}
function updateStatus(message) {
    const node = document.querySelector('#scene-anchor-status');
    if (node) node.textContent = message;
}
function updateUI() {
    const area = document.querySelector('#scene-anchor-view');
    const history = document.querySelector('#scene-anchor-history');
    if (area) {
        const rec = currentMeta();
        const view = selectedContext('idle');
        const snap = rec?.sourceKey === view.sourceKey ? rec.snapshot : null;
        area.textContent = snap
            ? Object.entries(snap).filter(([k, v]) => k !== 'scene_changed' && v)
                .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`).join('\n')
            : 'No swipe-safe snapshot for this accepted story turn yet. Generate a reply or press Refresh current scene.';
    }
    if (history) {
        const entries = currentMeta()?.history || [];
        history.textContent = entries.length
            ? entries.map((entry, i) => `${i + 1}. Ended near message #${entry.atMessage}: ${entry.snapshot?.location || 'unknown'} — ${entry.snapshot?.activity || 'unknown'}`).join('\n')
            : 'No completed scenes recorded yet.';
    }
}
async function buildUI() {
    const root = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!root || root.querySelector('#scene-anchor-companion-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'scene-anchor-companion-panel';
    panel.className = 'inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header"><b>Scene Anchor (experimental) v0.2</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content" style="padding:10px;">
        <label style="display:block; margin:8px 0;"><input type="checkbox" id="scene-anchor-enabled"> Enable live scene anchor</label>
        <label style="display:block; margin:8px 0;"><input type="checkbox" id="scene-anchor-auto"> Automatically refresh from accepted turns</label>
        <p class="notes">Swipe-safe: alternative AI replies are drafts, NOT new story turns. The anchor is reconstructed from the established chat before each generation and stays fixed across swipes. The chosen reply enters memory after your next message.</p>
        <button class="menu_button" id="scene-anchor-refresh" type="button">Refresh current scene</button>
        <p class="notes" id="scene-anchor-status">Ready.</p>
        <h4>Current anchor (accepted story before latest AI reply)</h4><pre id="scene-anchor-view" style="white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto;"></pre>
        <details><summary>Completed scene index (not injected)</summary><pre id="scene-anchor-history" style="white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto;"></pre></details>
        <p class="notes">Test on your duplicate chat. This extension does not alter or delete earlier swipe variants, and its v0.1 snapshots are automatically invalidated.</p>
      </div>`;
    root.appendChild(panel);
    document.querySelector('#scene-anchor-enabled').checked = settings().enabled;
    document.querySelector('#scene-anchor-auto').checked = settings().autoRefresh;
    document.querySelector('#scene-anchor-enabled').addEventListener('change', e => {
        settings().enabled = e.target.checked;
        saveSettingsDebounced();
        inject();
    });
    document.querySelector('#scene-anchor-auto').addEventListener('change', e => {
        settings().autoRefresh = e.target.checked;
        saveSettingsDebounced();
    });
    document.querySelector('#scene-anchor-refresh').addEventListener('click', () => refresh('manual', 'idle'));
    updateUI();
}
function onChatChanged() {
    chatVersion++;
    inject('idle');
    // When opening an existing chat, build a swipe-safe snapshot from the
    // accepted prefix (ending at the previous user message).
    if (settings().enabled && settings().autoRefresh && currentMessages().length) {
        setTimeout(() => refresh('chat-load', 'idle'), 400);
    }
}
function onUserMessage() {
    // Do not assume that the newly selected AI swipe has already been extracted;
    // the upcoming async interceptor will include it as accepted history.
    inject('normal');
}
function onSwipe() {
    // Existing anchor remains based on the prior accepted user turn; never
    // extract or commit whichever alternative the interface currently displays.
    inject('swipe');
    updateStatus('Swipe draft: keeping the previous accepted scene.');
}
function onAiRendered() {
    // v0.1 extracted here, incorrectly promoting every rejected swipe into
    // canonical scene memory. In v0.2 the AI reply is NOT committed until
    // followed by the user's next message (or explicitly continued).
    inject('idle');
}

await buildUI();
if (event_types.APP_READY) eventSource.on(event_types.APP_READY, () => { buildUI(); updateUI(); });
setTimeout(() => buildUI(), 1200);

globalThis.sceneAnchorBeforeGeneration = async (_chat, _contextSize, _abort, type) => {
    if (type === 'quiet' || type === 'impersonate') return;
    const mode = String(type || 'normal').toLowerCase();
    if (settings().autoRefresh) await refresh('before-generation', mode);
    inject(mode); // Always inject the matching accepted prefix or nothing.
};

eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
if (event_types.CHAT_LOADED) eventSource.on(event_types.CHAT_LOADED, onChatChanged);
eventSource.on(event_types.MESSAGE_SENT, onUserMessage);
if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, onSwipe);
if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => inject('idle'));
if (event_types.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => inject('idle'));
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onAiRendered);
onChatChanged();
console.info('[Scene Anchor] v0.2.0 swipe-safe companion loaded.');
