# Scene Anchor — Experimental SillyTavern Companion Extension

**Prototype; not yet tested inside a live SillyTavern/Render session.** A small companion to Smart Memory, not a modification or replacement of it. Uses Smart Memory's existing connection-profile memory model (`generateMemoryExtract`), so it doesn't require a new API key or a second connection profile.

## The problem it targets

A memory model stores a historical event (game show in the lounge; hair being bleached in the bathroom). A writer model mistakenly treats that old event as ongoing. This extension holds a single **replaceable** current-scene snapshot and injects it at depth 0 near the newest message. Past snapshots are archived per chat but **never** injected as if current.

## Features

- One current scene only: location, time, participants, present action, environment, ongoing business.
- Refresh after each assistant reply using Smart Memory's separately configured LLM.
- Immediate synchronous override when the next user message describes a time jump or obvious room change: stale snapshot is discarded **before** the next generation.
- Past snapshots archived silently under the chat's metadata; no interruption, notes, or pop-ups required.
- Avoids assigning psychological meanings, romantic motivations, private knowledge, or imagined props.
- Shows current snapshot and a small completed-scene index in the Extensions menu.
- Does not modify the original Smart Memory data, original character card, or actual chat messages.

## Installation (manual; appropriate for a private Render-hosted SillyTavern)

1. **Back up your chat and extension configuration. Use a duplicate branch first.**
2. Copy the entire `Scene-Anchor` folder to the **same extension parent folder** where your `Smart-Memory` extension is installed. The folders must be siblings, named `Scene-Anchor` and `Smart-Memory` respectively. In ST these often correspond to `data/<user-handle>/extensions/` for private extensions, or `public/scripts/extensions/third-party/` for all users.
3. Restart SillyTavern and look for **Scene Anchor (experimental)** under Extensions.
4. Leave Smart Memory's Long-Term and Session memories on if useful, but **disable the inaccurate State Ledger, Short-Term Memory and Character & World Profiles** to prevent conflicting present-tense states. Consider disabling Scene History *injection* if it is ordered incorrectly.
5. Confirm Smart Memory's **Memory LLM** still uses your saved Gemma 4 Instruct connection profile.
6. Tap **Refresh current scene** once, inspect the resulting snapshot, and continue chatting. From then on it refreshes after each AI reply.
7. Check **Prompt Itemization → Raw Prompt** for `LIVE SCENE ANCHOR` and confirm it appears with the correct scene.

You **cannot** install this ZIP by pasting its sandbox link into SillyTavern's `Install Extension` dialog; that dialog requires a Git repository URL. Put the files on your Render-hosted SillyTavern server using your normal file access/deployment method, or upload the extension folder to your own Git repository and install by Git URL.

## Known limitations

- This is a prototype that has only been statically checked outside SillyTavern. ST versions or install folder names can vary, and its dynamic import of `../Smart-Memory/generate.js` might need adjustment on your installation.
- An LLM still makes mistakes. Read-only previews and explicit source priority reduce rather than eliminate errors.
- A fresh model call follows each AI reply, increasing subscription usage/API traffic. If the automatic refresh finishes after you send your next message, the current-user override still takes priority.
- The first reply after an unmarked scene change can still reflect an imperfect prior snapshot; explicit time/room transitions are handled conservatively. The model is instructed not to treat old details as active.
- The *past scene index* is a lightweight chronology of snapshots after installation, not a retroactive scene map of the whole existing 200+ message chat. Smart Memory can continue handling historical memory.
- On unsupported/unavailable Smart Memory extraction model, the extension logs an error; it does not alter your chat messages.

## Uninstall

Disable Scene Anchor, restart and/or remove the `Scene-Anchor` folder. It stores only its own `scene_anchor_companion_v1` chat metadata; it does not delete Smart Memory records.
