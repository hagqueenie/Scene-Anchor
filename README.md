# Scene Anchor — Swipe-safe SillyTavern extension (v0.2.1)

**Experimental, user-specific companion to Smart Memory.** This version fixes a serious behavior in v0.1: it no longer treats each new swipe (a rejected alternative assistant reply) as part of story canon.

## v0.2.1 initialization hotfix

The v0.2 update accidentally called `fingerprintTranscript()` without importing it from `scene-core.js`. This caused initialization to stop as the UI was being created. Symptoms: the v0.2 heading appears, status stays at "Ready", and the anchor remains empty even if the refresh button is clicked. This hotfix adds the missing import and restores initialization.

After updating the repository and running **Manage Extensions → Update**, reload SillyTavern, open the test chat and press **Refresh current scene**. If the extractor fails for another reason, the status should report the problem; send the exact message for diagnosis.

## v0.2 swipe fix

A swipe is a **replacement for the last assistant message**, not a new event in the story. v0.1 ran memory extraction after `CHARACTER_MESSAGE_RENDERED`, which could commit an alternate reply's contents to the *current scene* before the user decided whether to keep it. The next swipe then saw the discarded reply's objects and actions in the anchor.

v0.2 changes its lifecycle:

1. **Before** the next generation, use SillyTavern's asynchronous `generate_interceptor` to update the anchor from the *established* conversation.
2. For `swipe` or `regenerate`, exclude the existing trailing assistant candidate from extraction.
3. **Do not extract after an assistant reply**. All alternative swipes for a user turn reuse the same snapshot and source fingerprint.
4. The user chooses which AI reply is accepted by continuing the conversation with a new user message. At the next generation, that chosen assistant message is part of the established history and is incorporated automatically.
5. If the user uses **Continue** on a response, include that response in the continuity state (it is being extended, rather than replaced).
6. Validate any async model result against the source fingerprint of the established story rather than against the generated swipe text.
7. Ignore legacy v0.1 snapshot data until it has been re-extracted from an accepted prefix. The original chat, its swipe variants, and Smart Memory records remain unchanged.

**Important:** The **Current anchor** preview intentionally describes the state *before the latest AI reply* while you are swiping. The next user message is the moment that establishes the chosen reply as canon. This is intentional.

## Other features

- Keeps a short current location/time/participants/activity/environment note without inventing NPC knowledge or romantic motivations.
- Clears temporary objects, programs, or other scene-specific conditions after explicit scene transitions.
- Uses the extraction model configured in **Smart Memory → Memory LLM**. No additional API key or connection profile.
- Tracks completed scene snapshots in chat metadata for reference; they are not injected as current events.
- Contains no changes to chat messages, roleplay cards, or Smart Memory's own stored data.

## Installing v0.2 when v0.1 is already installed from GitHub

1. Keep a backup/duplicate branch of the chat for testing.
2. Download and extract this v0.2 ZIP. Inside `Scene-Anchor/` are five files: `index.js`, `scene-core.js`, `manifest.json`, `package.json`, and `README.md`.
3. In **your existing GitHub Scene-Anchor repository**, replace the five files **at the repository root** with these newer versions. Commit the changes. Do **not** make another nested `Scene-Anchor` folder and do **not** upload the ZIP as the extension source.
4. In SillyTavern go to **Extensions → Manage extensions → Scene Anchor → Update**, then reload the SillyTavern page. It is important to update the installed extension; GitHub changes do not instantly modify the already-installed copy.
5. The extension settings heading should now read **Scene Anchor (experimental) v0.2**.
6. Open your duplicate Bucky/Teya chat. Tap **Refresh current scene** once. Then generate a reply, swipe through a couple alternatives, and confirm the current anchor does not change between swipes.
7. When you select one alternative and send your next message, the anchor will update from that chosen reply and your new message. No manual note updates needed.

If the update button is missing or a Git update fails, do not delete your original chat. Check that the changed files were committed to the same repository and branch used by the installed extension.

## Suggested Smart Memory settings for the test

Keep Smart Memory available for the memory model and historical memory, but avoid injecting its inaccurate live/current-state records from **State Ledger**, **Short-Term Memory**, and **Character & World Profiles** while comparing continuity.

## Remaining limitations

- **Not live-tested inside your Render-hosted SillyTavern instance.** This is a source-level patch with JS syntax checks and simulated swipe tests, not a guarantee against every UI-specific timing race.
- Uses a model extraction call before generation when a new accepted turn needs a fresh snapshot. This may add latency to the beginning of a response and use additional memory-model calls. Repeat swipes from the same user turn should reuse the cached snapshot.
- The extractor is still an LLM and may misunderstand scene details; no extraction system guarantees perfect continuity.
- Most recent explicit text in the chat always outranks the stored anchor.
- Do not simultaneously inject another outdated "current moment" summary or State Ledger, because those systems can still reintroduce stale facts.

## Technical test results

Node.js syntax checks passed for `index.js` and `scene-core.js`. A small seven-case test suite verified stable state across alternate swipes, regeneration, selected swipe acceptance on the next user message, continuation behavior, and preservation of the end of longer messages during extraction. These tests do not substitute for testing in SillyTavern.

## Uninstall

Disable or remove Scene Anchor through SillyTavern's extension manager. Its own metadata key is `scene_anchor_companion_v1` (preserved for compatibility) and does not replace or delete your original chat messages or Smart Memory database.
