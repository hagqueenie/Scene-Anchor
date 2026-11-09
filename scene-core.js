// Pure helpers for Scene Anchor; no SillyTavern globals required.
export const SCENE_FIELDS = ['location', 'time', 'participants', 'activity', 'environment', 'ongoing', 'just_finished'];

export function readableMessages(messages, limit = 14, perMessage = 1800) {
    return (messages || []).filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim())
        .slice(-limit).map((m, i) => {
            const role = m.is_user ? "USER (Teya\'s writer)" : `ASSISTANT (${m.name || 'narrator'})`;
            const plain = m.mes.trim();
            return `${i + 1}. ${role}: ${plain.length > perMessage ? plain.slice(0, perMessage) + ' [truncated]' : plain}`;
        }).join('\n\n');
}

// Conservative: only use explicit time-jump/scene-change markers. Never infer from emotion alone.
export function explicitSceneReset(text = '') {
    const s = String(text).trim().slice(0, 700);
    return /\b(?:the next (?:morning|day|night|afternoon|evening)|later that (?:day|night|morning|afternoon|evening)|(?:a |the )?following (?:morning|day|week|night)|(?:hours?|days?|weeks?|months?) (?:later|passed)|(?:a |one |the )?(?:week|month) later|meanwhile|some time (?:later|passed)|the following week|several (?:hours|days|weeks) later|at (?:noon|midnight)|that (?:evening|afternoon|night)|the next time|the following time)\b/i.test(s)
      || /^\s*(?:\*\s*\*\s*\*|---)\s*$/m.test(s)
      || /\b(?:entered|arrived at|walked into|stepped into) (?:the |a |an )?(?:lounge|kitchen|conference room|bathroom|gym|courtyard|medical wing|bedroom|library)\b/i.test(s);
}

export function parseAnchor(text) {
    if (typeof text !== 'string') return null;
    let value = text.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    try {
        const obj = JSON.parse(value.slice(start, end + 1));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
        const clean = {};
        for (const field of SCENE_FIELDS) {
            let s = obj[field];
            if (Array.isArray(s)) s = s.join(', ');
            clean[field] = typeof s === 'string' ? s.trim().slice(0, 240) : '';
        }
        clean.scene_changed = obj.scene_changed === true;
        return clean;
    } catch (_e) { return null; }
}

export function buildExtractionPrompt(messagesText, previous = null) {
    const prior = previous ? JSON.stringify(previous).slice(0, 1700) : 'none';
    return `You are a continuity clerk for a third-person roleplay, NOT the narrator. Extract ONE **currently active** physical scene from the chronological transcript below. Do not write prose or interpret emotions. Output ONLY a JSON object matching this schema:\n{"location":"...", "time":"...", "participants":"...", "activity":"...", "environment":"...", "ongoing":"...", "just_finished":"...", "scene_changed":true}\n\nRULES:\n- Most recent messages have ABSOLUTE precedence. Read transcript in chronological order.\n- A new day, time skip, room change, or explicit fresh scene ENDS temporary facts (TV/programs, music, hair dye, food, positions, objects, injuries or incapacitation that resolved). Never copy them into the new scene without fresh evidence.\n- Use 'unknown' for unestablished facts. Never invent a television, soundtrack, prop, clothing, injury, physical contact or character in the room.\n- LOCATION, TIME and PRESENT characters must describe NOW, not an earlier incident.\n- ACTIVITY is what is happening now, not what someone did several scenes ago.\n- ONGOING is only a short active conversation or physical situation; do not turn old unresolved relationship conflicts into an active scene.\n- JUST_FINISHED is at most one immediately preceding action in the same scene; otherwise empty.\n- scene_changed is true only when the current transcript explicitly transitions away from the prior snapshot, NOT because a character's mood changes.\n- Never reveal private user-character thoughts or memories to NPCs; describe only observable facts. Do not infer attraction, guilt, protectiveness, trauma bonding, motives or future plot.\n- Ignore the previous snapshot if the transcript contradicts it; previous snapshot can be stale or wrong.\n- Keep each field brief and specific, with no moral/psychological explanation.\n\nPREVIOUS SNAPSHOT (possibly outdated; low priority): ${prior}\n\nLATEST TRANSCRIPT (chronological):\n${messagesText}`;
}

export function renderAnchor(anchor, { override = '', reset = false } = {}) {
    let lines = [
        'LIVE SCENE ANCHOR — AUTOMATED, MAY BE IMPERFECT.',
        'Newest explicit chat messages override this snapshot and ALL older memory/scene/arc/state records.',
        'Historical scenes are NOT happening now. Do not carry forward television programs, hair dye, props, room contents, injuries, positions or activities after a scene transition.'
    ];
    if (!reset && anchor) {
        for (const key of SCENE_FIELDS) if (anchor[key]) lines.push(`${key.toUpperCase().replace('_', ' ')}: ${anchor[key]}`);
    } else if (reset) {
        lines.push('A new scene/time/location was just explicitly introduced. Discard the previous scene snapshot. Only the latest chat establishes present details.');
    } else {
        lines.push('No verified current-scene snapshot yet. Follow the latest chat messages; do not invent temporary conditions.');
    }
    if (override) lines.push(`LATEST USER SCENE/WORDS (higher priority than snapshot): ${override.slice(0, 850)}`);
    return lines.join('\n');
}
