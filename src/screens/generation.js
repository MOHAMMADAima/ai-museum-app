/**
 * LORE — Generation Screen (Rituel de Résurrection v16)
 * Pure display layer. Background: pure black. Camera: OFF.
 *
 * ── 5-PHASE RITUAL ───────────────────────────────────────────────────
 *
 * PHASE 1 — INVOCATION  (renders immediately, runs during AI call)
 *   "Someone remembers this artwork."
 *
 * PHASE 2 — MEMORY  (city/year from artwork, then "A voice survived…")
 *   "[City] · [Year]"  (or nothing for unknown artworks)
 *   "A voice survived the centuries."
 *
 * PHASE 3 — MEMORY FRAGMENTS  (continuous loop until signalReady fires)
 *   Static cinematic phrases cycle while AI/voice generate.
 *   Claude's memoryFragments[] are injected into the queue when ready.
 *   Each phrase fades in / holds / fades out like memories resurfacing.
 *   NO loading language. NO tech language. Pure emotional atmosphere.
 *
 * PHASE 4 — CHARACTER ARRIVAL  (triggered by signalReady — narrative ready)
 *   Stacked progressive reveal — lines appear one by one:
 *     {Name},                       (gold, 40px Cormorant italic)
 *     {relationshipToArtwork},      (sepia muted, DM Sans 14px)
 *     {trait1} and {trait2},        (gold dim, 12px)
 *     {city} · {year},              (tracked sepia, small)
 *     "was there."                  (off-white, larger — dramatic close)
 *   Brief hold → fade out stacked lines
 *   → presentationStyle sentence    (off-white italic serif)
 *   → full traits pill row          (gold dim uppercase)
 *
 * PHASE 5 — FINAL INVITATION  (immediately after character reveal)
 *   "Put your phone away."
 *   "Look at the artwork."
 *   "[Name] will take you there."
 *
 * FlowController drives AI+Voice generation in parallel with Phases 1–3.
 * signalReady(narrative) stops the memory loop and triggers Phase 4 + 5.
 * waitReady() resolves after Phase 5 hold → FlowController navigates to Narration.
 */

import { UI } from '../modules/transitions.js';
import { TextEffects } from '../modules/textEffects.js';
import { State } from '../modules/state.js';
import { GlobalExitButton } from '../modules/globalExitButton.js';

let _readyResolver = null;

export const GenerationScreen = {
    _readyPromise: null,

    render() {
        // Reset promise gate for this session
        this._readyPromise = new Promise(resolve => { _readyResolver = resolve; });

        const artwork = State.currentArtwork;
        const city    = artwork?.city || artwork?.origin || '';
        const year    = artwork?.year || '';
        const hasLocation = !!(city || year);
        const locationLine = hasLocation
            ? `${city}${city && year ? ' · ' : ''}${year}`
            : '';

        const html = `
            <div class="screen active" id="generation-screen" style="
                background: #080808;
                justify-content: center;
                align-items: center;
                gap: 0;
                overflow: hidden;
            ">
                <!-- ── PHASE 1 — INVOCATION ──────────────────── -->
                <p id="gen-p1" class="gen-line">Someone remembers this artwork.</p>

                <!-- ── PHASE 2 — MEMORY ──────────────────────── -->
                <!-- 2a: location -->
                <p id="gen-p2a" class="gen-line">${locationLine}</p>

                <!-- 2b: "A voice survived…" -->
                <p id="gen-p2b" class="gen-line">A voice survived the centuries.</p>

                <!-- ── PHASE 3 — MEMORY FRAGMENTS ────────────── -->
                <!-- Single cycling element — phrases fade in/out like returning memories -->
                <p id="gen-memory-line" class="gen-line"></p>

                <!-- ── PHASE 4 — CHARACTER ARRIVAL ───────────── -->
                <!-- Stacked progressive reveal: Name → relationship → traits → location → "was there." -->
                <div id="gen-p4-wrap" style="
                    opacity: 0;
                    transition: opacity 0.6s ease;
                    text-align: center;
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.9rem;
                    padding: 0 2.5rem;
                    max-width: 520px;
                    width: 100%;
                ">
                    <!-- Line 1: Name — same base style, slightly larger for dramatic arrival -->
                    <p id="gen-char-name-line" class="gen-line" style="
                        font-size: 1.65rem;
                        color: #C9A96E;
                        opacity: 0;
                        transition: opacity 1.6s ease;
                        position: static;
                    "></p>

                    <!-- Line 2: relationshipToArtwork -->
                    <p id="gen-char-relationship" class="gen-line" style="
                        opacity: 0;
                        transition: opacity 1.4s ease;
                        position: static;
                    "></p>

                    <!-- Line 3: trait1 and trait2 -->
                    <p id="gen-char-traits-inline" class="gen-line" style="
                        opacity: 0;
                        transition: opacity 1.2s ease;
                        position: static;
                    "></p>

                    <!-- Line 4: City · Year -->
                    <p id="gen-char-location" class="gen-line" style="
                        opacity: 0;
                        transition: opacity 1.1s ease;
                        position: static;
                    "></p>

                    <!-- Line 5: "was there." — larger for dramatic close -->
                    <p id="gen-char-was-there" class="gen-line" style="
                        font-size: 1.65rem;
                        opacity: 0;
                        transition: opacity 1.8s ease;
                        position: static;
                    ">was there.</p>
                </div>

                <!-- ── PHASE 4b — EMOTIONAL PROMISE ──────────── -->
                <div id="gen-p4b-wrap" style="
                    opacity: 0;
                    transition: opacity 1s ease;
                    text-align: center;
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1.2rem;
                    padding: 0 2.5rem;
                    max-width: 480px;
                    width: 100%;
                ">
                    <!-- Thin gold thread divider -->
                    <div style="
                        width: 36px;
                        height: 1px;
                        background: linear-gradient(90deg, transparent, rgba(201,169,110,0.35), transparent);
                    "></div>

                    <!-- Presentation style -->
                    <p id="gen-char-presentation" class="gen-line" style="
                        opacity: 0;
                        transition: opacity 1.6s ease;
                        position: static;
                        max-width: 400px;
                    "></p>

                    <!-- Full traits — slightly dimmed, wide tracking -->
                    <p id="gen-char-traits" class="gen-line" style="
                        opacity: 0;
                        transition: opacity 1.2s ease 0.5s;
                        position: static;
                        letter-spacing: 0.22em;
                        text-transform: uppercase;
                        font-size: 0.78rem;
                        color: rgba(240,235,224,0.38);
                    "></p>
                </div>

                <!-- ── PHASE 5 — FINAL INVITATION ────────────── -->
                <div id="gen-p5-wrap" style="
                    opacity: 0;
                    transition: opacity 0.8s ease;
                    text-align: center;
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1.6rem;
                    padding: 0 2rem;
                    max-width: 460px;
                ">
                    <p id="gen-p5-a" class="gen-line" style="opacity:0;transition:opacity 1.4s ease;position:static;">Put your phone away.</p>
                    <p id="gen-p5-b" class="gen-line" style="opacity:0;transition:opacity 1.4s ease;position:static;">Look at the artwork.</p>
                    <p id="gen-p5-c" class="gen-line" style="opacity:0;transition:opacity 1.4s ease;position:static;color:#C9A96E;"></p>
                </div>

            </div>

            <style>
                /* ── Uniform resurrection text style ───────────────────────────
                 * ALL phrases in the generation ritual share one visual identity:
                 * Cormorant Garamond italic 24px, #F0EBE0, slow 2s opacity dissolve.
                 * Individual elements may override opacity/transition/size only.
                 * ─────────────────────────────────────────────────────────────── */
                .gen-line {
                    font-family: var(--font-serif);
                    font-style: italic;
                    font-size: 1.5rem;        /* 24px */
                    font-weight: 400;
                    color: #C9A96E;
                    letter-spacing: 0.02em;
                    line-height: 1.5;
                    text-align: center;
                    opacity: 0;
                    transition: opacity 2s ease;
                    position: absolute;
                    max-width: 480px;
                    padding: 0 2rem;
                    margin: 0;
                }

                @keyframes gold-pulse {
                    0%, 100% { transform: scale(1);   opacity: 0.9; }
                    50%       { transform: scale(2.4); opacity: 0.3; }
                }
            </style>
        `;

        UI.render(html);

        // Mount global × exit button
        GlobalExitButton.mount();

        // Run phases 1–3 immediately while AI/voice generate in background
        this._runPhases(hasLocation, locationLine);
    },

    // ── Static fallback pool — shown while Claude generates ─────────
    // Index 0 is a special slot: rendered dynamically via _getMeDoPhraseForGender()
    // so the pronoun updates the moment signalReady fires with the character gender.
    _staticFragments: [
        '__MEDO_VOICE__',
        'The memory is almost here.',
        'Something was left unfinished.',
        'The centuries are listening.',
        'A presence is taking shape.',
        'Someone is being called back.',
        'He never spoke about that night again.',
        'She remained beside the canvas for hours.',
        'The smell of oil paint never left his hands.',
        'Some believed he was obsessed with her eyes.',
        'He watched the painting change him.',
        'Nobody knew why she suddenly disappeared.',
        'He carried this secret for thirty years.',
        'She thought the artist had painted her soul.',
        'The light in the room was never quite the same afterward.',
        'They said he returned to look at it one last time.',
        'She never told anyone what she had seen.',
        'Something in the composition was not what it seemed.',
    ],

    // Queue of memoryFragments injected by signalReady when Claude responds
    _fragmentQueue: [],
    _memoryRunning:  false,
    _staticIndex:    0,
    _characterGender: '',   // set by signalReady as soon as Claude responds

    // Returns the MeDo loading phrase, gender-aware once the character is known.
    _getMeDoPhraseForGender() {
        return 'MeDo is bringing this voice back to you.';
    },

    // ── Memory loop — runs continuously until signalReady stops it ──
    async _memoryLoop() {
        const el = document.getElementById('gen-memory-line');
        if (!el) return;

        this._memoryRunning = true;
        this._staticIndex   = 0;

        while (this._memoryRunning) {
            // Prefer injected fragments from Claude; fall back to static pool
            let text;
            if (this._fragmentQueue.length > 0) {
                text = this._fragmentQueue.shift();
            } else {
                text = this._staticFragments[this._staticIndex % this._staticFragments.length];
                this._staticIndex++;
            }

            // Resolve the MeDo sentinel to the gender-aware phrase at render time
            if (text === '__MEDO_VOICE__') text = this._getMeDoPhraseForGender();

            el.textContent   = text;
            el.style.opacity = '1';
            await TextEffects.wait(2800);

            if (!this._memoryRunning) break; // stopped mid-hold

            el.style.opacity = '0';
            await TextEffects.wait(900);
        }

        // Final fade-out on stop
        if (el) el.style.opacity = '0';
    },

    // ── Phases 1–3: run during AI/voice generation ──────────────────
    async _runPhases(hasLocation, locationLine) {
        const p1  = document.getElementById('gen-p1');
        const p2a = document.getElementById('gen-p2a');
        const p2b = document.getElementById('gen-p2b');

        // Reset fragment queue for this session
        this._fragmentQueue   = [];
        this._memoryRunning   = false;
        this._characterGender = '';

        // ── PHASE 1 — INVOCATION ─────────────────────────────────
        await TextEffects.wait(500);
        if (p1) p1.style.opacity = '1';
        await TextEffects.wait(2800);
        if (p1) p1.style.opacity = '0';

        // ── PHASE 2 — MEMORY ─────────────────────────────────────
        await TextEffects.wait(600);
        if (hasLocation && p2a) {
            p2a.style.opacity = '1';
            await TextEffects.wait(2200);
            p2a.style.opacity = '0';
            await TextEffects.wait(400);
        }
        if (p2b) p2b.style.opacity = '1';
        await TextEffects.wait(2600);
        if (p2b) p2b.style.opacity = '0';

        // ── PHASE 3 — MEMORY FRAGMENTS LOOP ──────────────────────
        // Runs continuously (no await) until signalReady() sets _memoryRunning = false
        await TextEffects.wait(700);
        this._memoryLoop(); // intentionally not awaited — runs in parallel
    },

    // ── Phase 4 + 5: called by FlowController when narrative + audio ready ──
    async signalReady(narrative) {
        // ── 0. Store character gender FIRST — resolves the MeDo phrase ────
        this._characterGender = narrative?.gender || '';

        // ── 1. Stop the memory loop ──────────────────────────────
        this._memoryRunning = false;

        // Inject Claude's memoryFragments for the transition moment (unused now but safe)
        const fragments = Array.isArray(narrative?.memoryFragments) ? narrative.memoryFragments : [];
        this._fragmentQueue = [...fragments];

        const p4w          = document.getElementById('gen-p4-wrap');
        const p4bw         = document.getElementById('gen-p4b-wrap');
        const charNameLine = document.getElementById('gen-char-name-line');
        const charRelation = document.getElementById('gen-char-relationship');
        const charTrInline = document.getElementById('gen-char-traits-inline');
        const charLoc      = document.getElementById('gen-char-location');
        const charWasThere = document.getElementById('gen-char-was-there');
        const charPresent  = document.getElementById('gen-char-presentation');
        const charTr       = document.getElementById('gen-char-traits');
        const p5w          = document.getElementById('gen-p5-wrap');
        const p5a          = document.getElementById('gen-p5-a');
        const p5b          = document.getElementById('gen-p5-b');
        const p5c          = document.getElementById('gen-p5-c');

        if (!p4w) {
            if (_readyResolver) { _readyResolver(); _readyResolver = null; }
            return;
        }

        // ── 2. Populate all card fields ──────────────────────────
        const name         = narrative?.characterName           || 'A Voice from the Past';
        const relationship = narrative?.relationshipToArtwork   || narrative?.roleDescription || narrative?.role || '';
        const city         = narrative?.city                    || '';
        const yearLabel    = narrative?.yearLabel               || '';
        const presentation = narrative?.presentationStyle       || '';
        const traits       = Array.isArray(narrative?.traits) ? narrative.traits : [];

        const locationStr  = [city, yearLabel].filter(Boolean).join(' · ');
        const traitsStr    = traits.map(t => t.toLowerCase()).join(' · ');
        // Inline traits for reveal: "[trait1] and [trait2],"
        const traitsInline = traits.length >= 2
            ? `${traits[0]} and ${traits[1]},`
            : traits.length === 1 ? `${traits[0]},` : '';

        if (charNameLine)                   charNameLine.textContent  = `${name},`;
        if (charRelation && relationship)   charRelation.textContent  = `${relationship},`;
        if (charTrInline && traitsInline)   charTrInline.textContent  = traitsInline;
        if (charLoc      && locationStr)    charLoc.textContent       = `${locationStr},`;
        if (charPresent  && presentation)   charPresent.textContent   = presentation;
        if (charTr       && traitsStr)      charTr.textContent        = traitsStr;

        // ── 3. Fade out memory line cleanly ──────────────────────
        const memLine = document.getElementById('gen-memory-line');
        if (memLine) memLine.style.opacity = '0';
        await TextEffects.wait(700);

        // ── 4. PHASE 4A — Stacked progressive reveal ─────────────
        // Show wrapper (position it), then fade each line manually with ~600ms gap
        if (p4w) p4w.style.opacity = '1';

        await TextEffects.wait(100);
        if (charNameLine)  charNameLine.style.opacity  = '1';   // Name,
        await TextEffects.wait(700);
        if (charRelation)  charRelation.style.opacity  = '1';   // relationship,
        await TextEffects.wait(650);
        if (charTrInline)  charTrInline.style.opacity  = '1';   // trait1 and trait2,
        await TextEffects.wait(600);
        if (charLoc)       charLoc.style.opacity       = '1';   // CITY · YEAR,
        await TextEffects.wait(700);
        if (charWasThere)  charWasThere.style.opacity  = '1';   // was there.

        // Hold — let "was there." breathe
        await TextEffects.wait(3200);

        // Fade out stacked reveal
        if (p4w) p4w.style.opacity = '0';
        await TextEffects.wait(900);

        // ── 5. PHASE 4B — Emotional promise ──────────────────────
        if (p4bw) p4bw.style.opacity = '1';
        await TextEffects.wait(200);
        if (charPresent)   charPresent.style.opacity   = '1';   // presentationStyle
        // charTr uses CSS transition-delay 0.5s on the wrapper fade-in

        // Hold — visitor absorbs the emotional promise
        await TextEffects.wait(3800);

        // Fade out promise panel
        if (p4bw) p4bw.style.opacity = '0';
        await TextEffects.wait(800);

        // ── 6. PHASE 5 — FINAL INVITATION ────────────────────────
        if (p5c) p5c.textContent = `${name} will take you there.`;
        if (p5w) p5w.style.opacity = '1';

        await TextEffects.wait(300);
        if (p5a) p5a.style.opacity = '1';
        await TextEffects.wait(1100);
        if (p5b) p5b.style.opacity = '1';
        await TextEffects.wait(1100);
        if (p5c) p5c.style.opacity = '1';

        // Hold — visitor settles into anticipation
        await TextEffects.wait(4200);

        if (_readyResolver) { _readyResolver(); _readyResolver = null; }
    },

    /** Await Phase 5 completion before FlowController navigates to Narration */
    waitReady() {
        return this._readyPromise;
    }
};
