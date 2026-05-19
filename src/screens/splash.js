/**
 * Splash Screen — Cinematic Onboarding Ritual
 *
 * 6-step sequence:
 *   1. Black silence
 *   2. Camera permission requested (handled by Camera module in main.js)
 *   3. Camera background fades in (managed by Camera module)
 *   4. LORE wordmark appears
 *   5. Tagline revealed letter-by-letter
 *   6. Earphone instruction + entry button fade in
 */

import { UI, Transitions } from '../modules/transitions.js';
import { TextEffects } from '../modules/textEffects.js';
import { AudioUnlock } from '../modules/audioUnlock.js';
import { navigateTo } from '../main.js';

const TAGLINE = `Every artwork has a story nobody told you.\nLORE lets you hear it — from someone who was there.`;
const EARPHONE_LINE = 'Put on your earphones.';

export const SplashScreen = {
    async render() {
        const html = `
            <div class="screen" id="splash-screen" style="
                background: transparent;
                justify-content: center;
                gap: 0;
            ">
                <!-- LORE wordmark -->
                <div id="splash-wordmark" style="
                    text-align: center;
                    opacity: 0;
                    margin-bottom: 3.5rem;
                ">
                    <h1 class="serif italic" style="
                        font-size: clamp(3rem, 10vw, 5.5rem);
                        color: var(--gold);
                        letter-spacing: 0.12em;
                        line-height: 1;
                        margin-bottom: 0.4rem;
                    ">LORE</h1>
                    <p class="serif" style="
                        font-size: 0.65rem;
                        letter-spacing: 0.45em;
                        opacity: 0.55;
                        text-transform: uppercase;
                    ">Narrative Resurrection Engine</p>
                </div>

                <!-- Tagline (typewriter target) -->
                <div id="splash-tagline" style="
                    max-width: 420px;
                    text-align: center;
                    padding: 0 2rem;
                    margin-bottom: 3rem;
                    min-height: 5rem;
                ">
                    <p id="tagline-text" class="serif italic" style="
                        font-size: clamp(1rem, 3.5vw, 1.25rem);
                        line-height: 1.75;
                        color: var(--text-color);
                    "></p>
                </div>

                <!-- Earphone instruction -->
                <div id="splash-earphone" style="
                    opacity: 0;
                    text-align: center;
                    margin-bottom: 3rem;
                ">
                    <p id="earphone-text" class="serif" style="
                        font-size: 0.85rem;
                        letter-spacing: 0.22em;
                        color: var(--gold);
                        opacity: 0.75;
                    "></p>
                </div>

                <!-- Entry CTA -->
                <div id="splash-cta" style="opacity: 0;">
                    <button class="btn-gold" id="start-ritual">Enter the Ritual</button>
                </div>

                <!-- Year tag -->
                <p style="
                    position: absolute;
                    bottom: 2rem;
                    font-size: 0.65rem;
                    letter-spacing: 0.2em;
                    opacity: 0.3;
                ">MUSEUM EXPERIENCE • 2026</p>
            </div>
        `;

        UI.render(html);

        // Give the screen's enter-animation a breath before we start
        await TextEffects.wait(600);

        // ── Step 4: LORE wordmark fades in ──────────────────────
        const wordmark   = document.getElementById('splash-wordmark');
        const taglineEl  = document.getElementById('tagline-text');
        const earphoneEl = document.getElementById('earphone-text');
        const earphoneWrap = document.getElementById('splash-earphone');
        const ctaWrap    = document.getElementById('splash-cta');
        const startBtn   = document.getElementById('start-ritual');

        await TextEffects.fadeIn(wordmark, 1000);
        await TextEffects.wait(400);

        // ── Step 5: Tagline typewriter ───────────────────────────
        await TextEffects.typewriter(taglineEl, TAGLINE, 36, 20);
        await TextEffects.wait(700);

        // ── Step 6a: Earphone instruction ───────────────────────
        earphoneWrap.style.opacity = '0';
        earphoneWrap.style.transition = 'opacity 0.8s ease';
        // Kick off typewriter and fade-in together
        requestAnimationFrame(() => requestAnimationFrame(() => {
            earphoneWrap.style.opacity = '1';
        }));
        await TextEffects.typewriter(earphoneEl, EARPHONE_LINE, 50, 15);
        await TextEffects.wait(500);

        // ── Step 6b: Entry button ────────────────────────────────
        await TextEffects.fadeIn(ctaWrap, 700);

        // Wire up navigation — only once, not re-attachable
        startBtn.addEventListener('click', async function handleEnter() {
            startBtn.removeEventListener('click', handleEnter);
            // Splash button IS a user gesture — unlock audio immediately
            await AudioUnlock.unlock();
            Transitions.to('profile', () => navigateTo('profile'));
        });
    }
};

