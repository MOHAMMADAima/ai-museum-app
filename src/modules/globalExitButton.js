/**
 * LORE — Global Exit Button (v11)
 *
 * A small, minimal × button placed in the top-right corner of every
 * main screen (scan, generation, narration, whatsapp).
 *
 * Clicking it shows a cinematic full-screen leave overlay:
 *
 *   "Leaving so soon?"
 *   "The voices will remain here."
 *   [ Leave the museum ]   [ Stay a little longer ]
 *
 * If the visitor confirms, the experience ends and the visitor is
 * navigated back to the splash screen (a graceful restart — no
 * browser close, which is impossible from JS anyway).
 *
 * ── RULES ────────────────────────────────────────────────
 *  • ONE × at a time — mount() removes any previous instance first.
 *  • The × must NOT be pointer-events:none during FlowController lock
 *    (we punch through the body.experience-locked rule for this element).
 *  • The overlay z-index sits ABOVE all other UI (z: 9990) but BELOW
 *    the cinematic error overlay (z: 9999).
 *  • "Stay" simply removes the overlay — zero state change.
 *  • "Leave" clears all State, stops all audio, navigates to splash.
 */

import { State } from './state.js';
import { FlowController } from './flowController.js';
import { Audio } from './audio.js';
import { AmbientSoundEngine } from './ambientSoundEngine.js';
import { Underscore } from './underscore.js';
import { SubtitleEngine } from './subtitles.js';
import { Camera } from './camera.js';
import { Transitions } from './transitions.js';
import { navigateTo } from '../main.js';

const OVERLAY_ID = 'lore-exit-overlay';
const BTN_ID     = 'lore-exit-btn';

// ── Helpers ────────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── GlobalExitButton ───────────────────────────────────────────────
export const GlobalExitButton = {

    /**
     * Mount the × button.
     * Call once per screen render, after UI.render() has run.
     *
     * @param {object} [opts]
     * @param {boolean} [opts.lightBackground=false] — set true if mounting
     *   on a near-white screen (unused in LORE but kept for future-proofing)
     */
    mount(opts = {}) {
        // Remove any stale instance
        const old = document.getElementById(BTN_ID);
        if (old) old.remove();

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.setAttribute('aria-label', 'Leave the museum');
        btn.textContent = '×';
        btn.style.cssText = `
            position: fixed;
            top: 1.1rem;
            right: 1.25rem;
            z-index: 9980;
            width:  38px;
            height: 38px;
            background: transparent;
            border: 1px solid rgba(201,169,110,0.3);
            border-radius: 50%;
            color: rgba(201,169,110,0.5);
            font-family: var(--font-serif, 'Cormorant Garamond', serif);
            font-size: 1.35rem;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: border-color 0.25s ease, color 0.25s ease, background 0.25s ease;
            -webkit-tap-highlight-color: transparent;
            /* Punch through experience-locked body rule */
            pointer-events: all !important;
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.borderColor = 'rgba(201,169,110,0.8)';
            btn.style.color       = '#C9A96E';
            btn.style.background  = 'rgba(201,169,110,0.06)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.borderColor = 'rgba(201,169,110,0.3)';
            btn.style.color       = 'rgba(201,169,110,0.5)';
            btn.style.background  = 'transparent';
        });

        btn.addEventListener('click', () => this._showLeaveOverlay());

        document.body.appendChild(btn);
    },

    /**
     * Remove the × button (called automatically before overlay appears).
     */
    unmount() {
        const btn = document.getElementById(BTN_ID);
        if (btn) btn.remove();
    },

    // ── Cinematic leave overlay ────────────────────────────────────
    _showLeaveOverlay() {
        // One overlay at a time
        if (document.getElementById(OVERLAY_ID)) return;

        // ── Stop all audio immediately — the moment × is tapped ──────────
        // Audio cuts before the overlay animates in so the museum goes
        // silent straight away, regardless of whether the visitor confirms.
        FlowController.abortNarration();
        Audio.stopAll().catch(() => {});
        AmbientSoundEngine.stopNow();
        Underscore.stopNow();
        SubtitleEngine.stop();
        if (State.stopWaveform) {
            State.stopWaveform();
            State.stopWaveform = null;
        }
        State.activeAudioHandle = null;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9990;
            background: rgba(4,4,4,0.91);
            backdrop-filter: blur(10px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0;
            padding: 2.5rem 2rem;
            opacity: 0;
            transition: opacity 0.8s ease;
            pointer-events: all;
        `;

        overlay.innerHTML = `
            <!-- Message -->
            <p id="lore-exit-heading" style="
                font-family: var(--font-serif, 'Cormorant Garamond', serif);
                font-style: italic;
                font-size: clamp(1.45rem, 5vw, 2rem);
                color: #F0EBE0;
                text-align: center;
                line-height: 1.3;
                margin-bottom: 1rem;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.9s ease 0.3s, transform 0.9s ease 0.3s;
            ">Leaving so soon?</p>

            <p id="lore-exit-sub" style="
                font-family: var(--font-serif, 'Cormorant Garamond', serif);
                font-style: italic;
                font-size: clamp(0.9rem, 3vw, 1.1rem);
                color: rgba(201,169,110,0.65);
                text-align: center;
                line-height: 1.7;
                margin-bottom: 3rem;
                max-width: 280px;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.9s ease 0.55s, transform 0.9s ease 0.55s;
            ">The voices will remain here.</p>

            <!-- Buttons -->
            <div id="lore-exit-actions" style="
                display: flex;
                flex-direction: column;
                gap: 1rem;
                width: 100%;
                max-width: 260px;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.9s ease 0.75s, transform 0.9s ease 0.75s;
            ">
                <button id="lore-exit-confirm" style="
                    background: transparent;
                    border: 1px solid rgba(201,169,110,0.6);
                    border-radius: 2px;
                    color: rgba(201,169,110,0.8);
                    font-family: var(--font-serif, 'Cormorant Garamond', serif);
                    font-style: italic;
                    font-size: 0.95rem;
                    letter-spacing: 0.14em;
                    padding: 13px 0;
                    cursor: pointer;
                    transition: background 0.25s, border-color 0.25s, color 0.25s;
                    -webkit-tap-highlight-color: transparent;
                ">Leave the museum</button>

                <button id="lore-exit-cancel" style="
                    background: transparent;
                    border: none;
                    color: rgba(240,235,224,0.28);
                    font-family: var(--font-sans, 'DM Sans', sans-serif);
                    font-size: 0.72rem;
                    letter-spacing: 0.12em;
                    padding: 8px 0;
                    cursor: pointer;
                    text-align: center;
                    transition: color 0.25s;
                    -webkit-tap-highlight-color: transparent;
                ">Stay a little longer</button>
            </div>
        `;

        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            // Stagger children
            const heading = overlay.querySelector('#lore-exit-heading');
            const sub     = overlay.querySelector('#lore-exit-sub');
            const actions = overlay.querySelector('#lore-exit-actions');
            if (heading) { heading.style.opacity = '1'; heading.style.transform = 'translateY(0)'; }
            if (sub)     { sub.style.opacity     = '1'; sub.style.transform     = 'translateY(0)'; }
            if (actions) { actions.style.opacity = '1'; actions.style.transform = 'translateY(0)'; }
        }));

        // ── Button hover states ──────────────────────────────────
        const confirmBtn = overlay.querySelector('#lore-exit-confirm');
        const cancelBtn  = overlay.querySelector('#lore-exit-cancel');

        confirmBtn.addEventListener('mouseenter', () => {
            confirmBtn.style.background   = 'rgba(201,169,110,0.08)';
            confirmBtn.style.borderColor  = 'rgba(201,169,110,1)';
            confirmBtn.style.color        = '#C9A96E';
        });
        confirmBtn.addEventListener('mouseleave', () => {
            confirmBtn.style.background   = 'transparent';
            confirmBtn.style.borderColor  = 'rgba(201,169,110,0.6)';
            confirmBtn.style.color        = 'rgba(201,169,110,0.8)';
        });
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.color = 'rgba(240,235,224,0.65)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.color = 'rgba(240,235,224,0.28)';
        });

        // ── Leave ────────────────────────────────────────────────
        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true;
            cancelBtn.disabled  = true;

            // ── 1. Unlock flow so splash can re-init cleanly ─────────────
            FlowController.unlock();
            FlowController.setState('IDLE');

            // ── 2. Reset artwork / narrative state (visitor profile kept) ─
            State.currentArtwork   = null;
            State.currentNarrative = null;
            State.isProcessing     = false;

            // ── 3. Restore camera ─────────────────────────────────────────
            Camera.show();
            Camera.setOverlayOpacity(0.65);

            // ── 4. Remove × button — not needed on splash ─────────────────
            this.unmount();

            // ── 5. Fade overlay out → navigate to splash ──────────────────
            overlay.style.transition = 'opacity 0.9s ease';
            overlay.style.opacity    = '0';
            await delay(700);
            overlay.remove();

            await Transitions.to('splash', () => navigateTo('splash'));
        }, { once: true });

        // ── Stay ─────────────────────────────────────────────────
        cancelBtn.addEventListener('click', async () => {
            overlay.style.opacity = '0';
            await delay(600);
            overlay.remove();
        }, { once: true });
    },
};
