/**
 * LORE — Scan Screen (v10 — Museum Label OCR)
 *
 * RESURRECTION ENTRY RITUAL
 * ─────────────────────────────────────────────────────────────
 * The visitor points the camera at the museum label beside the artwork.
 * Clicking [ Scan Museum Label ] captures the frame and runs OCR.
 *
 * HAPPY PATH:  OCR extracts title / artist / year with high confidence
 *              → resurrection flow begins immediately.
 *
 * FALLBACK:    OCR confidence low, text incomplete, or OCR fails
 *              → cinematic modal appears with pre-filled fields
 *              → visitor may correct or add details manually
 *              → [ Begin Resurrection ] launches the flow.
 *
 * SKIP PATH:   "Enter artwork details manually" link
 *              → jump straight to the fallback modal with empty fields.
 *
 * Camera is used ONLY for OCR text capture — NOT for artwork analysis.
 */

import { UI } from '../modules/transitions.js';
import { ArtworkDatabase } from '../modules/state.js';
import { FlowController } from '../modules/flowController.js';
import { Camera } from '../modules/camera.js';
import { AudioUnlock } from '../modules/audioUnlock.js';
import { ScanEngine } from '../modules/scanEngine.js';
import { OcrEngine } from '../modules/ocrEngine.js';
import { GlobalExitButton } from '../modules/globalExitButton.js';

// Shared input style used for all three manual-entry fields
const INPUT_STYLE = `
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(201,169,110,0.4);
    color: #F0EBE0;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 1.05rem;
    padding: 0.35rem 0 0.45rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.3s ease;
`;

const LABEL_STYLE = `
    display: block;
    font-family: var(--font-sans);
    font-size: 0.62rem;
    color: rgba(201,169,110,0.55);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin-bottom: 0.4rem;
`;

export const ScanScreen = {
    render() {
        Camera.show();
        Camera.setOverlayOpacity(0.6);

        // DB entries used for autocomplete in the fallback modal
        const suggestions = ArtworkDatabase.map(a => ({
            id:          a.id,
            title:       a.title,
            artist:      a.artist,
            year:        a.year,
            nationality: a.nationality,
        }));

        const html = `
            <div class="screen active" id="scan-screen" style="
                background: transparent;
                justify-content: center;
                align-items: center;
            ">
                <!-- ─── MAIN SCAN PANEL ─────────────────────────── -->
                <div id="scan-panel" style="
                    position: relative;
                    z-index: 30;
                    width: calc(100% - 3rem);
                    max-width: 340px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0;
                    text-align: center;
                ">
                    <!-- Instruction -->
                    <p id="scan-instruction" style="
                        font-family: var(--font-serif);
                        font-style: italic;
                        font-size: clamp(0.95rem, 3.5vw, 1.15rem);
                        color: rgba(240,235,224,0.7);
                        line-height: 1.75;
                        margin-bottom: 2.4rem;
                        letter-spacing: 0.02em;
                    ">Point your camera toward<br>the museum label beside the artwork.</p>

                    <!-- Scan button -->
                    <button id="btn-scan-label" style="
                        width: 100%;
                        background: transparent;
                        border: 1px solid rgba(201,169,110,0.75);
                        border-radius: 2px;
                        color: #C9A96E;
                        font-family: var(--font-serif);
                        font-style: italic;
                        font-size: 1.05rem;
                        letter-spacing: 0.14em;
                        padding: 14px 0;
                        cursor: pointer;
                        transition: background 0.25s ease, border-color 0.25s ease, color 0.25s ease;
                        -webkit-tap-highlight-color: transparent;
                        margin-bottom: 1.8rem;
                    ">Scan Museum Label</button>

                    <!-- OCR status line (hidden until scan starts) -->
                    <p id="ocr-status" style="
                        font-family: var(--font-sans);
                        font-size: 0.72rem;
                        color: rgba(201,169,110,0.5);
                        letter-spacing: 0.12em;
                        min-height: 1.1em;
                        margin-bottom: 1.2rem;
                        transition: opacity 0.4s ease;
                        opacity: 0;
                    "></p>

                    <!-- Manual entry skip link -->
                    <button id="btn-manual-entry" style="
                        background: transparent;
                        border: none;
                        color: rgba(240,235,224,0.3);
                        font-family: var(--font-sans);
                        font-size: 0.68rem;
                        letter-spacing: 0.1em;
                        cursor: pointer;
                        padding: 0;
                        text-decoration: underline;
                        text-underline-offset: 3px;
                        text-decoration-color: rgba(240,235,224,0.15);
                        transition: color 0.25s ease;
                        -webkit-tap-highlight-color: transparent;
                    ">or enter artwork details manually</button>
                </div>

                <!-- Dev shortcut -->
                <button id="dev-quick" style="
                    position: absolute; bottom: 1.5rem; right: 1.5rem;
                    background: transparent;
                    border: 1px solid rgba(201,169,110,0.1);
                    color: rgba(201,169,110,0.25);
                    font-size: 0.5rem; padding: 3px 6px;
                    cursor: pointer; letter-spacing: 0.1em;
                    z-index: 40; pointer-events: all;
                ">dev</button>
            </div>

            <style>
                #btn-scan-label:hover,
                #btn-scan-label:active {
                    background: rgba(201,169,110,0.08);
                    border-color: rgba(201,169,110,1);
                    color: #E0C88A;
                }
                #btn-scan-label:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                #btn-manual-entry:hover {
                    color: rgba(240,235,224,0.6);
                }
                /* ── Fallback modal ───────────────────────────── */
                #fallback-modal {
                    position: fixed;
                    inset: 0;
                    z-index: 200;
                    background: rgba(4,4,4,0.88);
                    backdrop-filter: blur(10px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 2.5rem 2rem;
                    opacity: 0;
                    transition: opacity 0.7s ease;
                    pointer-events: none;
                }
                #fallback-modal.visible {
                    opacity: 1;
                    pointer-events: all;
                }
                .fb-field { margin-bottom: 1.5rem; }
                .fb-field input:focus { border-bottom-color: rgba(201,169,110,0.9); }
                .fb-field input::placeholder {
                    color: rgba(240,235,224,0.18);
                    font-style: italic;
                }
                #btn-resurrect:hover,
                #btn-resurrect:active {
                    background: rgba(201,169,110,0.1);
                    border-color: rgba(201,169,110,1);
                    color: #E0C88A;
                }
                #btn-resurrect:disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }
                /* ── Autocomplete ─────────────────────────────── */
                .autocomplete-item {
                    display: block;
                    width: 100%;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid rgba(201,169,110,0.08);
                    padding: 0.7rem 1rem;
                    text-align: left;
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                }
                .autocomplete-item:last-child { border-bottom: none; }
                .autocomplete-item:hover,
                .autocomplete-item:active { background: rgba(201,169,110,0.07); }
                .autocomplete-item .ac-title {
                    font-family: var(--font-serif);
                    font-style: italic;
                    font-size: 0.9rem;
                    color: #F0EBE0;
                    display: block;
                    margin-bottom: 1px;
                }
                .autocomplete-item .ac-sub {
                    font-family: var(--font-sans);
                    font-size: 0.65rem;
                    color: rgba(201,169,110,0.5);
                    letter-spacing: 0.06em;
                }
            </style>
        `;

        UI.render(html);

        // Mount global × exit button (top-right corner)
        GlobalExitButton.mount();

        // ── DOM refs ──────────────────────────────────────────────
        const btnScan      = document.getElementById('btn-scan-label');
        const btnManual    = document.getElementById('btn-manual-entry');
        const ocrStatus    = document.getElementById('ocr-status');
        const devBtn       = document.getElementById('dev-quick');

        // ── Scan-in-progress guard ────────────────────────────────
        // Prevents double-fire when btnScan is clicked rapidly.
        // Resets to false after every path (success, fallback, error).
        let _scanInProgress = false;

        // ── OCR Status helpers ────────────────────────────────────
        function setStatus(text, fade = false) {
            ocrStatus.textContent = text;
            ocrStatus.style.opacity = '1';
            if (fade) {
                setTimeout(() => { ocrStatus.style.opacity = '0'; }, 2800);
            }
        }

        // ─────────────────────────────────────────────────────────
        // FALLBACK MODAL
        // Shown when OCR is low confidence, fails, or user skips.
        // Pre-fills fields with whatever OCR extracted (may be empty).
        // ─────────────────────────────────────────────────────────
        function showFallbackModal(opts = {}) {
            const {
                message       = 'We could not fully read the plaque.',
                prefillTitle  = '',
                prefillArtist = '',
                prefillYear   = '',
                ocrRawText    = '',
                dbHint        = null,
            } = opts;

            console.log('[SCAN] fallback to manual input');

            // Always re-enable scan button — user can scan again from within modal
            btnScan.disabled = false;
            _scanInProgress  = false;

            // Remove any existing modal
            const existing = document.getElementById('fallback-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.id = 'fallback-modal';
            modal.innerHTML = `
                <!-- Message -->
                <p id="fb-message" style="
                    font-family: var(--font-serif);
                    font-style: italic;
                    font-size: clamp(0.95rem, 3.5vw, 1.15rem);
                    color: rgba(240,235,224,0.65);
                    text-align: center;
                    line-height: 1.7;
                    margin-bottom: 2.8rem;
                    max-width: 300px;
                "></p>

                <!-- Form -->
                <div style="
                    width: 100%;
                    max-width: 300px;
                ">
                    <!-- TITLE with autocomplete -->
                    <div class="fb-field" style="position: relative; margin-bottom: 1.5rem;">
                        <label style="${LABEL_STYLE}">Artwork title <span style="opacity:0.45;">optional</span></label>
                        <input
                            id="field-title"
                            type="text"
                            autocomplete="off"
                            placeholder="e.g. The Starry Night"
                            value=""
                            style="${INPUT_STYLE}"
                        />
                        <div id="autocomplete-list" style="
                            display: none;
                            position: absolute;
                            top: 100%;
                            left: 0; right: 0;
                            background: rgba(10,10,10,0.97);
                            border: 1px solid rgba(201,169,110,0.2);
                            border-top: none;
                            border-radius: 0 0 8px 8px;
                            z-index: 300;
                            overflow: hidden;
                            backdrop-filter: blur(12px);
                        "></div>
                    </div>

                    <!-- ARTIST -->
                    <div class="fb-field" style="margin-bottom: 1.5rem;">
                        <label style="${LABEL_STYLE}">Artist name <span style="opacity:0.45;">optional</span></label>
                        <input
                            id="field-artist"
                            type="text"
                            autocomplete="off"
                            placeholder="e.g. Vincent van Gogh"
                            value=""
                            style="${INPUT_STYLE}"
                        />
                    </div>

                    <!-- YEAR -->
                    <div class="fb-field" style="margin-bottom: 2.4rem;">
                        <label style="${LABEL_STYLE}">Year or historical era <span style="opacity:0.45;">optional</span></label>
                        <input
                            id="field-year"
                            type="text"
                            inputmode="numeric"
                            autocomplete="off"
                            placeholder="e.g. 1889"
                            value=""
                            style="${INPUT_STYLE}"
                        />
                    </div>

                    <!-- BEGIN RESURRECTION -->
                    <button id="btn-resurrect" style="
                        width: 100%;
                        background: transparent;
                        border: 1px solid rgba(201,169,110,0.75);
                        border-radius: 2px;
                        color: #C9A96E;
                        font-family: var(--font-serif);
                        font-style: italic;
                        font-size: 1.05rem;
                        letter-spacing: 0.14em;
                        padding: 14px 0;
                        cursor: pointer;
                        transition: background 0.25s ease, border-color 0.25s ease, color 0.25s ease;
                        -webkit-tap-highlight-color: transparent;
                        margin-bottom: 1.2rem;
                    ">Begin Resurrection</button>

                    <!-- Scan again link -->
                    <div style="text-align: center;">
                        <button id="btn-scan-again" style="
                            background: transparent;
                            border: none;
                            color: rgba(240,235,224,0.28);
                            font-family: var(--font-sans);
                            font-size: 0.65rem;
                            letter-spacing: 0.1em;
                            cursor: pointer;
                            text-decoration: underline;
                            text-underline-offset: 3px;
                            text-decoration-color: rgba(240,235,224,0.12);
                            -webkit-tap-highlight-color: transparent;
                        ">scan again</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // ── Safe DOM assignment — never trust OCR text as HTML ────
            // Message is app-controlled so textContent is still correct practice.
            const fbMessage = document.getElementById('fb-message');
            if (fbMessage) fbMessage.textContent = message;

            // Animate in
            requestAnimationFrame(() => requestAnimationFrame(() => {
                modal.classList.add('visible');
            }));

            // ── Autocomplete inside modal ─────────────────────────
            let _acSelected = dbHint;
            const fieldTitle  = document.getElementById('field-title');
            const fieldArtist = document.getElementById('field-artist');
            const fieldYear   = document.getElementById('field-year');
            const btnResuRect = document.getElementById('btn-resurrect');
            const acList      = document.getElementById('autocomplete-list');
            const btnScanAgain= document.getElementById('btn-scan-again');

            // Fields always start empty — user types fresh for each new artwork search

            function showAC(query) {
                if (!query || query.length < 2) { hideAC(); return; }
                const q = query.toLowerCase();
                const matches = suggestions.filter(s =>
                    s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
                ).slice(0, 4);
                if (!matches.length) { hideAC(); return; }
                acList.innerHTML = matches.map(m => `
                    <button class="autocomplete-item"
                        data-id="${m.id}" data-title="${_escAttr(m.title)}"
                        data-artist="${_escAttr(m.artist)}" data-year="${m.year}"
                        data-nationality="${m.nationality}">
                        <span class="ac-title">${m.title}</span>
                        <span class="ac-sub">${m.artist} · ${m.year}</span>
                    </button>`).join('');
                acList.style.display = 'block';
            }
            function hideAC() { acList.style.display = 'none'; acList.innerHTML = ''; }

            fieldTitle.addEventListener('input', () => {
                _acSelected = null;
                showAC(fieldTitle.value.trim());
            });
            fieldTitle.addEventListener('blur', () => setTimeout(hideAC, 180));
            acList.addEventListener('click', (e) => {
                const item = e.target.closest('.autocomplete-item');
                if (!item) return;
                fieldTitle.value  = item.dataset.title;
                fieldArtist.value = item.dataset.artist;
                fieldYear.value   = item.dataset.year;
                _acSelected = {
                    id: item.dataset.id, title: item.dataset.title,
                    artist: item.dataset.artist, year: item.dataset.year,
                    nationality: item.dataset.nationality,
                };
                hideAC();
                fieldTitle.blur();
            });

            // Scan again: close modal, re-enable scan button
            btnScanAgain.addEventListener('click', () => {
                modal.classList.remove('visible');
                setTimeout(() => modal.remove(), 500);
                btnScan.disabled = false;
                setStatus('');
            }, { once: true });

            // ── Begin Resurrection from fallback modal ────────────
            btnResuRect.addEventListener('click', async () => {
                if (FlowController.isLocked()) return;
                btnResuRect.disabled = true;

                const title  = fieldTitle.value.trim();
                const artist = fieldArtist.value.trim();
                const year   = fieldYear.value.trim();
                const metadata = { title, artist, year };

                console.log('[ScanScreen] Fallback Begin Resurrection —',
                    `"${title || '?'}" / ${artist || '?'} / ${year || '?'}`);

                await AudioUnlock.unlock();

                // Capture a fresh frame for Claude (camera is still live)
                const scanData = ScanEngine.capture();

                // Attach raw OCR text to artwork context if we have it
                const ocrData = ocrRawText ? { rawText: ocrRawText, source: 'ocr' } : null;

                await FlowController.startResurrectionFlow(metadata, scanData, _acSelected, ocrData);
            }, { once: true });
        }

        // ─────────────────────────────────────────────────────────
        // [ Scan Museum Label ] handler
        //
        // IMPORTANT: This function is attached as a PERSISTENT listener
        // (no { once: true }) so it can be triggered again after "scan again"
        // is clicked in the fallback modal.  Re-entrancy is prevented by the
        // _scanInProgress flag, which is cleared by EVERY exit path.
        // ─────────────────────────────────────────────────────────
        async function handleScanLabel() {
            // Guard: block re-entry while a scan is already running
            if (_scanInProgress)          return;
            if (FlowController.isLocked()) return;

            _scanInProgress  = true;
            btnScan.disabled = true;

            await AudioUnlock.unlock();

            // ── STEP 1: Camera permission fast-path ───────────────
            // If camera was explicitly denied by the browser, skip straight to
            // manual input — no point waiting for a frame that will never come.
            if (Camera.isDenied()) {
                console.log('[SCAN] camera permission denied — fallback to manual input');
                setStatus('Camera not available.');
                showFallbackModal({
                    message: 'Camera access was denied. Enter the artwork details below.',
                });
                return;  // _scanInProgress / btnScan.disabled reset inside showFallbackModal
            }

            // ── STEP 2: Capture frame ─────────────────────────────
            const scanData = ScanEngine.capture();
            console.log('[SCAN] camera started');
            console.log(`[ScanScreen] Frame captured for OCR — hasFrame: ${scanData.hasFrame}`);

            if (!scanData.hasFrame || !scanData.snapshot) {
                console.warn('[ScanScreen] No camera frame available.');
                setStatus('The centuries are difficult to read.');
                console.log('[SCAN] fallback to manual input');
                // Small delay so the status message is visible before modal
                setTimeout(() => {
                    showFallbackModal({ message: 'The centuries are difficult to read.' });
                }, 600);
                return;
            }

            // ── STEP 3: OCR ───────────────────────────────────────
            setStatus('Reading the plaque…');

            try {
                const ocrResult = await OcrEngine.scanLabel(scanData.snapshot);

                console.log('[SCAN] OCR result:', {
                    success:       ocrResult.success,
                    rawText:       (ocrResult.rawText || '').substring(0, 120),
                    title:         ocrResult.metadata?.title  || '(none)',
                    artist:        ocrResult.metadata?.artist || '(none)',
                    year:          ocrResult.metadata?.year   || '(none)',
                    highConfidence: ocrResult.highConfidence,
                });
                console.log('[SCAN] OCR confidence:', ocrResult.metadata?.confidence ?? 0);

                // ── STEP 4a: High confidence → resurrection ───────
                if (ocrResult.highConfidence) {
                    console.log('[ScanScreen] OCR high confidence — proceeding to resurrection.');
                    setStatus('The plaque has spoken.', true);

                    const { title, artist, year } = ocrResult.metadata;
                    const metadata = { title, artist, year };
                    const dbHint  = _matchDb(suggestions, title, artist) || null;
                    const ocrData = { rawText: ocrResult.rawText, source: 'ocr' };

                    // Lock is taken by FlowController; _scanInProgress stays true
                    // (the scan screen will be replaced by generation screen).
                    await FlowController.startResurrectionFlow(metadata, scanData, dbHint, ocrData);

                } else {
                    // ── STEP 4b: Low / zero confidence → fallback ─
                    const message = ocrResult.success
                        ? 'We could not fully read the plaque.'
                        : 'The centuries are difficult to read.';

                    console.log('[ScanScreen] OCR low confidence — showing fallback modal.');
                    setStatus(message);

                    const { title, artist, year } = ocrResult.metadata;
                    const dbHint = _matchDb(suggestions, title, artist) || null;

                    // Brief pause so status line is legible before modal opens
                    setTimeout(() => {
                        showFallbackModal({
                            message,
                            prefillTitle:  title,
                            prefillArtist: artist,
                            prefillYear:   year,
                            ocrRawText:    ocrResult.rawText,
                            dbHint,
                        });
                    }, 500);
                }

            } catch (err) {
                // ── STEP 4c: OCR threw — always show fallback ─────
                console.error('[ScanScreen] OCR error:', err.message);
                console.log('[SCAN] fallback to manual input');
                setStatus('The centuries are difficult to read.');
                setTimeout(() => {
                    showFallbackModal({ message: 'The centuries are difficult to read.' });
                }, 600);
            }
        }

        // Persistent listener — NOT { once: true }.
        // Re-entrancy is blocked by _scanInProgress flag inside handleScanLabel.
        btnScan.addEventListener('click', handleScanLabel);

        // ── Manual entry skip ─────────────────────────────────────
        btnManual.addEventListener('click', () => {
            showFallbackModal({
                message: 'Enter what you know about the artwork.',
            });
        });

        // ── Hover state for manual link ───────────────────────────
        btnManual.addEventListener('mouseenter', () => {
            btnManual.style.color = 'rgba(240,235,224,0.6)';
        });
        btnManual.addEventListener('mouseleave', () => {
            btnManual.style.color = 'rgba(240,235,224,0.3)';
        });

        // ── Dev shortcut ──────────────────────────────────────────
        devBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showFallbackModal({
                message:       'Dev mode — Starry Night pre-filled.',
                prefillTitle:  'The Starry Night',
                prefillArtist: 'Vincent van Gogh',
                prefillYear:   '1889',
                dbHint: suggestions.find(s => s.id === 'starry-night') || null,
            });
        });
    }
};

// ── Helpers ───────────────────────────────────────────────────────────

/** Escape a string for safe use as an HTML attribute value */
function _escAttr(str) {
    return (str || '')
        .replace(/&/g,  '&amp;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');
}

/**
 * Try to find a DB entry that matches extracted OCR title or artist.
 * Returns the first match or null.
 */
function _matchDb(suggestions, title, artist) {
    if (!title && !artist) return null;
    const tl = (title  || '').toLowerCase();
    const al = (artist || '').toLowerCase();
    return suggestions.find(s =>
        (tl && s.title.toLowerCase().includes(tl))  ||
        (al && s.artist.toLowerCase().includes(al))
    ) || null;
}


