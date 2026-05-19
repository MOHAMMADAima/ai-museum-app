/**
 * LORE — Narration Screen  v21
 * Background: pure black. Camera: OFF.
 *
 * Layout (top → bottom, no overlap guaranteed):
 *   ① Character name + city/year    absolute top: 2.5rem
 *   ② Waveform zone                 fixed 80px height, centred (flex)
 *   ③ Live Transcript zone          38vh, overflow-y: auto, scroll-to-bottom stream
 *   ④ WhatsApp notification         absolute bottom: 7rem  (post-speech)
 *   ⑤ Discover button               absolute bottom: 2.5rem (post-speech)
 *
 * Live Transcript ("Historical Scroll Feed"):
 *   - Words stream in one by one, synced to speechSynthesis
 *   - Each word slides up from 6px + fades in (200ms)
 *   - Container auto-scrolls to bottom as text accumulates
 *   - Current word highlighted #C9A96E; spoken words #F0EBE0 at 0.82 opacity
 *   - On speech end: transcript dims to 40% opacity → buttons revealed
 */

import { UI, Transitions } from '../modules/transitions.js';
import { State } from '../modules/state.js';
import { FlowController } from '../modules/flowController.js';
import { Camera } from '../modules/camera.js';
import { GlobalExitButton } from '../modules/globalExitButton.js';
import { navigateTo } from '../main.js';

export const NarrationScreen = {
    render() {
        const artwork   = State.currentArtwork;
        const narrative = State.currentNarrative;
        const charName  = narrative?.characterName || '…';
        const city      = narrative?.city      || artwork?.city || artwork?.origin || '';
        const yearLabel = narrative?.yearLabel || artwork?.year  || '';
        const location  = [city, yearLabel].filter(Boolean).join(' · ');

        const html = `
            <div class="screen active" id="narration-screen" style="
                background: #080808;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                position: relative;
                overflow: hidden;
                padding-top: 5.5rem;
                box-sizing: border-box;
            ">
                <!-- ① Character identity — absolute top -->
                <div id="narration-identity" style="
                    position: absolute;
                    top: 2.5rem;
                    left: 0; right: 0;
                    text-align: center;
                    opacity: 0;
                    transition: opacity 1s ease 0.4s;
                    pointer-events: none;
                ">
                    <p style="
                        font-family: var(--font-sans);
                        font-size: 0.875rem;
                        font-weight: 300;
                        color: #F0EBE0;
                        letter-spacing: 0.08em;
                        margin: 0 0 0.4rem;
                    ">${charName}</p>
                    <p style="
                        font-family: var(--font-sans);
                        font-size: 0.75rem;
                        font-weight: 300;
                        color: #8A8070;
                        letter-spacing: 0.06em;
                        margin: 0;
                    ">${location}</p>
                </div>

                <!-- ② Waveform — fixed height, full width -->
                <div id="waveform-bars" style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    height: 80px;
                    width: 100%;
                    max-width: 480px;
                    flex-shrink: 0;
                    padding: 0 2rem;
                    box-sizing: border-box;
                    margin-bottom: 1.25rem;
                "></div>

                <!-- ③ Live Transcript Stream — scrollable, accumulates from top to bottom -->
                <div id="transcript-zone" style="
                    width: 100%;
                    max-width: 480px;
                    height: 38vh;
                    min-height: 180px;
                    max-height: 340px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 0 2rem 2rem;
                    box-sizing: border-box;
                    opacity: 0;
                    transition: opacity 0.6s ease;
                    flex-shrink: 0;
                    scroll-behavior: smooth;
                    -webkit-overflow-scrolling: touch;
                    /* hide scrollbar — content flows naturally */
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                ">
                    <!-- inner text paragraph — words accumulate here -->
                    <p id="transcript-text" style="
                        font-family: 'DM Sans', var(--font-sans), sans-serif;
                        font-weight: 300;
                        font-size: 1rem;
                        line-height: 1.85;
                        color: rgba(240,235,224,0);
                        letter-spacing: 0.018em;
                        text-align: left;
                        margin: 0;
                        padding: 0;
                        word-break: break-word;
                    "></p>
                </div>

                <!-- ⑤ "Discover another artwork" — hidden until FlowController unlocks -->
                <div id="narration-controls" class="hidden" style="
                    position: absolute;
                    bottom: 2.5rem;
                    left: 0; right: 0;
                    text-align: center;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.9rem;
                ">
                    <button class="btn-gold" id="end-narration" style="
                        font-size: 0.85rem;
                        letter-spacing: 0.2em;
                        padding: 10px 28px;
                    ">Discover another artwork &#8594;</button>
                </div>

                <!-- Cannot-return fallback — only in the rarest case -->
                <div id="narration-fallback" style="
                    position: absolute;
                    bottom: calc(2.5rem + 60px);
                    left: 50%;
                    transform: translateX(-50%);
                    max-width: 340px;
                    width: calc(100% - 3rem);
                    text-align: center;
                    opacity: 0;
                    transition: opacity 1.2s ease;
                    pointer-events: none;
                ">
                    <p id="narration-fallback-text" style="
                        font-family: var(--font-serif);
                        font-style: italic;
                        font-size: 1rem;
                        color: rgba(201,169,110,0.7);
                        line-height: 1.7;
                        letter-spacing: 0.02em;
                        margin: 0;
                    "></p>
                </div>

                <!-- Webkit scrollbar hide for transcript-zone -->
                <style>
                    #transcript-zone::-webkit-scrollbar { display: none; }
                </style>
            </div>
        `;

        UI.render(html);

        // Mount global × exit button (top-right)
        GlobalExitButton.mount();

        // Camera already hidden by FlowController
        Camera.setOverlayOpacity(0);

        // Fade in identity text
        setTimeout(() => {
            const id = document.getElementById('narration-identity');
            if (id) id.style.opacity = '1';
        }, 500);

        // ── "Discover another artwork" click handler ─────────────
        const endBtn = document.getElementById('end-narration');
        endBtn.addEventListener('click', function handleEnd() {
            if (FlowController.isLocked()) return;
            endBtn.removeEventListener('click', handleEnd);
            endBtn.disabled = true;

            // Reset state fully so the scan form renders with empty fields next time.
            // Using an empty object (not null) prevents null-access on .title/.artist/.year
            // in any component that reads State.currentArtwork before the next scan.
            State.currentArtwork   = { title: '', artist: '', year: '' };
            State.currentNarrative = null;

            Camera.show();
            Camera.setOverlayOpacity(0.6);

            Transitions.to('scan', () => navigateTo('scan'));
        });
    },

    /**
     * Cannot-return mode — speechSynthesis entirely unavailable.
     * Shows a cinematic "cannot return" line in the subtitle zone.
     */
    showFallbackText(_text) {
        const wrapper = document.getElementById('narration-fallback');
        const textEl  = document.getElementById('narration-fallback-text');
        if (!wrapper || !textEl) return;

        console.log('[NarrationScreen] Cannot-return mode — cinematic message.');
        wrapper.style.opacity  = '1';
        textEl.textContent     = 'The voice cannot fully return…';
        textEl.style.fontStyle = 'italic';
    },
};
