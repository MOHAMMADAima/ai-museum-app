/**
 * LORE — Flow Controller
 * Deterministic cinematic ritual engine.
 * Owns all sequencing: AI, Audio, Screen, Camera.
 */

import { State } from './state.js';
import { Transitions } from './transitions.js';
import { AI } from './ai.js';
import { Audio, sanitizeNarration } from './audio.js';
import { Camera } from './camera.js';
import { AmbientSoundEngine } from './ambientSoundEngine.js';
import { Underscore } from './underscore.js';
import { SubtitleEngine } from './subtitles.js';
import { navigateTo } from '../main.js';

// ── NATIONALITY GUESSER ───────────────────────────────────
// Lightweight heuristic for ambient sound profile selection.
// Covers the most common Western European art traditions.
const NATIONALITY_HINTS = [
    [/van\s+gogh|vermeer|rembrandt|hals|hooch/i,        'Dutch'],
    [/picasso|vel[aá]zquez|goya|dal[ií]/i,               'Spanish'],
    [/da\s+vinci|michelangelo|raphael|botticelli|titian/i,'Italian'],
    [/monet|renoir|degas|c[eé]zanne|matisse|gauguin/i,   'French'],
    [/klimt|schiele|kokoschka/i,                         'Austrian'],
    [/d[üu]rer|holbein|cranach/i,                        'German'],
    [/turner|constable|gainsborough|hockney/i,           'British'],
    [/munch/i,                                           'Norwegian'],
    [/el\s+greco/i,                                      'Greek'],
];

function _guessNationality(artistName) {
    if (!artistName) return 'Unknown';
    for (const [pattern, nat] of NATIONALITY_HINTS) {
        if (pattern.test(artistName)) return nat;
    }
    return 'Unknown';
}

// ── FLOW STATE MACHINE ─────────────────────────────────
export const FLOW_STATES = Object.freeze({
    IDLE:                 'IDLE',
    SCANNING:             'SCANNING',
    GENERATING_CHARACTER: 'GENERATING_CHARACTER',
    GENERATING_VOICE:     'GENERATING_VOICE',
    TRANSITIONING:        'TRANSITIONING',
    PLAYING_NARRATION:    'PLAYING_NARRATION',
    CONTINUATION_MODE:    'CONTINUATION_MODE',
});

// ── INTERNAL HELPERS ───────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function stopActiveAudio() {
    Audio.stopAll();
    AmbientSoundEngine.stopNow();  // kill any previous ambient instantly
    State.activeAudioHandle = null;
    if (State.stopWaveform) {
        State.stopWaveform();
        State.stopWaveform = null;
    }
}

// ── FLOW CONTROLLER ────────────────────────────────────
export const FlowController = {

    _state:  FLOW_STATES.IDLE,
    _locked: false,

    // ── Experience abort signal ───────────────────────────────────────
    // Owned by runExperience() for the ENTIRE pipeline lifecycle —
    // not just narration playback.
    //
    // abortNarration() is called by GlobalExitButton the moment × is tapped.
    // It sets _narrationAborted and resolves _abortNarrationResolve (the shared
    // exitPromise created at the top of runExperience) so every awaiting step
    // in the pipeline unblocks immediately.
    //
    // The flag is ONLY reset at the TOP of runExperience() so no downstream
    // function can accidentally erase a pre-existing exit signal.
    _narrationAborted:        false,
    _abortNarrationResolve:   null,

    abortNarration() {
        this._narrationAborted = true;
        if (this._abortNarrationResolve) {
            this._abortNarrationResolve();
            this._abortNarrationResolve = null;
        }
        console.log('[FlowController] Narration aborted by exit signal.');
    },

    lock()   { this._locked = true;  State.isProcessing = true;  document.body.classList.add('experience-locked'); },
    unlock() { this._locked = false; State.isProcessing = false; document.body.classList.remove('experience-locked'); },
    isLocked() { return this._locked; },

    setState(s) {
        this._state = s;
        document.body.dataset.flowState = s;
    },

    // ── Controlled screen transition ──────────────────
    async transitionToScreen(screenId) {
        this.setState(FLOW_STATES.TRANSITIONING);
        await Transitions.to(screenId, () => navigateTo(screenId));
        await delay(350);
    },

    // ── RESURRECTION ENTRY POINT ─────────────────────────────
    //
    // Unified entry for all artwork experiences (v10+).
    //
    // @param {object}      metadata  — { title, artist, year } (all optional)
    // @param {object}      scanData  — { snapshot: string|null, hasFrame: boolean, timestamp: number }
    // @param {object|null} dbHint    — matched ArtworkDatabase entry (from autocomplete) or null
    // @param {object|null} ocrData   — { rawText: string, source: 'ocr' } or null
    //
    async startResurrectionFlow(metadata, scanData, dbHint = null, ocrData = null) {
        if (this._locked || State.isProcessing) {
            console.warn('[FlowController] Resurrection ignored — already processing.');
            return;
        }

        console.log('[Flow] Resurrection started');
        console.log('[Flow] Camera frame captured — hasFrame:', scanData.hasFrame,
                    '| snapshot size:', scanData.snapshot
                        ? `${(scanData.snapshot.length / 1024).toFixed(1)} KB` : 'none');
        if (ocrData) console.log('[Flow] OCR raw text received —', ocrData.rawText.substring(0, 120));

        const hasMetadata = !!(metadata.title || metadata.artist || metadata.year);

        // ── Build artwork context object ──────────────────────────
        // If user autocomplete-selected a known DB entry, use that nationality.
        // Otherwise infer or fall back to 'Unknown'.
        let artwork;

        if (dbHint) {
            // Exact DB match via autocomplete — enrich with any user edits
            artwork = {
                ...dbHint,
                title:       metadata.title  || dbHint.title,
                artist:      metadata.artist || dbHint.artist,
                year:        metadata.year   || dbHint.year,
                hasMetadata: true,
                snapshot:    scanData.snapshot,
                ocrRawText:  ocrData?.rawText || null,
            };
        } else if (hasMetadata) {
            // User typed metadata but not from DB — build synthetic entry
            artwork = {
                id:          'custom-' + Date.now(),
                title:       metadata.title  || '',
                artist:      metadata.artist || '',
                year:        metadata.year   || '',
                nationality: _guessNationality(metadata.artist),
                keywords:    [],
                hasMetadata: true,
                snapshot:    scanData.snapshot,
                ocrRawText:  ocrData?.rawText || null,
            };
        } else {
            // No metadata at all — pure visual guide mode
            artwork = {
                id:          'unknown-' + Date.now(),
                title:       '',
                artist:      '',
                year:        '',
                nationality: 'Unknown',
                keywords:    [],
                hasMetadata: false,
                snapshot:    scanData.snapshot,
                ocrRawText:  ocrData?.rawText || null,
            };
        }

        console.log('[FlowController] Resurrection context:', {
            hasMetadata,
            title:       artwork.title       || '(none)',
            artist:      artwork.artist      || '(none)',
            year:        artwork.year        || '(none)',
            hasFrame:    scanData.hasFrame,
            nationality: artwork.nationality,
        });

        // ── FIX: Map to valid GenerationScreen RITUAL modes ──────
        // generation.js RITUAL only knows 'selection' and 'scan'.
        // 'resurrection' does not exist — accessing RITUAL['resurrection']
        // throws TypeError and the catch block silently routes back to scan.
        // Known artwork (user supplied metadata) → 'selection' (confident emergence)
        // Unknown artwork (camera only)          → 'scan'      (uncertain emergence)
        State.entryMode = hasMetadata ? 'selection' : 'scan';

        await this.runExperience(artwork);
    },

    // ── LEGACY STUBS — removed in v9 ──────────────────────────
    // startScanFlow and startSelectionFlow are no longer used.
    // They are replaced by startResurrectionFlow above.

    // ── MASTER ENTRY POINT ────────────────────────────
    async runExperience(artwork) {
        if (this._locked) {
            console.warn('[FlowController] Already running. Ignoring duplicate trigger.');
            return;
        }

        this.lock();
        this.setState(FLOW_STATES.SCANNING);
        stopActiveAudio();

        // ── ABORT OWNERSHIP: initialise here, covers the ENTIRE pipeline ──────
        // This is the ONLY place _narrationAborted is reset to false.
        // startNarration() must NEVER reset it — doing so erases a pre-existing
        // exit signal and is the root cause of zombie narration.
        this._narrationAborted = false;
        const exitPromise = new Promise(resolve => {
            this._abortNarrationResolve = resolve;
        });
        const aborted = () => this._narrationAborted;

        State.currentArtwork = artwork;
        State.addArtwork(artwork);

        try {
            // ① Camera OFF — generation and narration are pure black
            Camera.hide();
            Camera.setOverlayOpacity(0);

            // ② Navigate to generation screen (Phase 1–4 starts automatically)
            console.log('[Flow] Navigating to ritual screen — generation');
            await this.transitionToScreen('generation');

            // ③ Ambient aura begins immediately
            AmbientSoundEngine.start(artwork);

            // ④ AI witness generation
            this.setState(FLOW_STATES.GENERATING_CHARACTER);
            console.log('[Flow] Claude generation started');
            const narrative = await AI.generateWitness(artwork, State.visitorProfile);
            State.currentNarrative = narrative;

            // ── ABORT GUARD ④ ─────────────────────────────────────────────────
            if (aborted()) {
                console.log('[EXIT ABORT] generation aborted — pipeline halted after Claude.');
                this.unlock();
                this.setState(FLOW_STATES.IDLE);
                return;
            }

            console.log('[Flow] Character generated:', narrative?.characterName);
            console.log('[FlowController] Character details:', {
                characterName: narrative?.characterName,
                characterBio:  narrative?.characterBio?.substring(0, 60),
                narrativeLen:  narrative?.narrative?.length,
                hasNarrative:  !!narrative?.narrative,
            });

            if (!narrative || !narrative.narrative) {
                throw new Error('narrative.narrative field is missing from AI response.');
            }

            // ⑤ Voice synthesis — pass narrative so character nationality+gender drive voice selection
            this.setState(FLOW_STATES.GENERATING_VOICE);
            console.log('[Flow] ElevenLabs generation started');
            const audioHandle = await Audio.speak(narrative.narrative, artwork, narrative);

            // ── ABORT GUARD ⑤ ─────────────────────────────────────────────────
            // Covers both windows: ElevenLabs AbortError (re-thrown by speak())
            // and flag set while waiting for the non-ElevenLabs paths.
            if (aborted()) {
                console.log('[EXIT ABORT] voice synthesis aborted — pipeline halted after Audio.speak.');
                audioHandle?.stop?.();
                this.unlock();
                this.setState(FLOW_STATES.IDLE);
                return;
            }

            State.activeAudioHandle = audioHandle;

            console.log('[Flow] Audio ready — duration:', audioHandle.duration?.toFixed(1) + 's',
                        '| mode:', audioHandle.mode || (audioHandle.audioBuffer !== null ? 'elevenlabs' : 'silent'));

            // ⑥ Signal generation screen: both ready → Phase 5 plays
            const { GenerationScreen } = await import('../screens/generation.js');
            GenerationScreen.signalReady(narrative);

            // ── ABORT GUARD ⑥ — race waitReady against exitPromise ────────────
            // waitReady() blocks for ~6-7 s of CSS animation (TextEffects.wait(4200)).
            // Racing it against exitPromise lets an exit signal cut through
            // immediately without waiting for the full animation sequence.
            await Promise.race([
                GenerationScreen.waitReady(),
                exitPromise,
            ]);

            if (aborted()) {
                console.log('[EXIT ABORT] GenerationScreen.waitReady aborted — no ambient crossfade, no narration screen.');
                this.unlock();
                this.setState(FLOW_STATES.IDLE);
                return;
            }

            // ⑦ Crossfade resurrection oscillator → cinematic atmosphere
            // Triggered here so the 2-second fade overlaps the screen transition,
            // making the shift from generation to narration feel like the painting
            // physically exhales.  The full narrative is now available, so the
            // profile selector has maximum context (character bio, emotional tone, etc.)
            AmbientSoundEngine.crossfadeToNarration(narrative, artwork);

            // ⑧ Transition to narration
            console.log('[Flow] Navigating to ritual screen — narration');
            await this.transitionToScreen('narration');

            // ── ABORT GUARD ⑧ ─────────────────────────────────────────────────
            if (aborted()) {
                console.log('[EXIT ABORT] narration prevented — user exited during screen transition.');
                this.unlock();
                this.setState(FLOW_STATES.IDLE);
                return;
            }

            // ⑨ Synchronised narration
            await this.startNarration(audioHandle);

        } catch (err) {
            // AbortError from the ElevenLabs fetch is a clean, intentional exit —
            // not a pipeline failure. Suppress the cinematic error overlay.
            // Still unlock so a "Stay" → Cancel → rescan path works without a stuck lock.
            if (err.name === 'AbortError' || this._narrationAborted) {
                console.log('[EXIT ABORT] pipeline catch — clean exit, no error overlay.');
                this.unlock();
                this.setState(FLOW_STATES.IDLE);
                return;
            }
            console.error('[FlowController] Experience pipeline failed:', err);
            AmbientSoundEngine.stopNow();
            Underscore.stopNow();
            this.unlock();
            this.setState(FLOW_STATES.IDLE);
            // Restore camera state
            Camera.show();
            Camera.setOverlayOpacity(0.65);
            // Show cinematic error overlay — NEVER silently navigate back to scan
            this._showCinematicError(err);
        }
    },

    // ── Cinematic error overlay ────────────────────────────
    // Shown when ANY step of the resurrection pipeline fails.
    // NEVER navigates to scan automatically — the visitor must choose.
    _showCinematicError(err) {
        console.log('[Flow] Showing cinematic error overlay. Error:', err?.message);

        // Remove any stale overlay
        const existing = document.getElementById('lore-error-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'lore-error-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: rgba(4,4,4,0.92);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2.5rem;
            padding: 2rem;
            opacity: 0;
            transition: opacity 0.9s ease;
            backdrop-filter: blur(8px);
        `;

        overlay.innerHTML = `
            <p style="
                font-family: var(--font-serif, 'Cormorant Garamond', serif);
                font-style: italic;
                font-size: clamp(1.1rem, 4vw, 1.45rem);
                color: #C9A96E;
                text-align: center;
                line-height: 1.7;
                max-width: 340px;
                opacity: 0.85;
            ">The voice could not<br>cross the centuries.</p>
            <button id="lore-error-retry" style="
                background: transparent;
                border: 1px solid rgba(201,169,110,0.5);
                border-radius: 2px;
                color: rgba(201,169,110,0.75);
                font-family: var(--font-serif, 'Cormorant Garamond', serif);
                font-style: italic;
                font-size: 0.95rem;
                letter-spacing: 0.14em;
                padding: 12px 32px;
                cursor: pointer;
                transition: all 0.25s ease;
                -webkit-tap-highlight-color: transparent;
            ">Try Again</button>
        `;

        document.body.appendChild(overlay);

        // Fade in
        requestAnimationFrame(() => requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        }));

        // Hover state for retry button
        const retryBtn = overlay.querySelector('#lore-error-retry');
        retryBtn.addEventListener('mouseenter', () => {
            retryBtn.style.background      = 'rgba(201,169,110,0.08)';
            retryBtn.style.borderColor     = 'rgba(201,169,110,0.9)';
            retryBtn.style.color           = '#C9A96E';
        });
        retryBtn.addEventListener('mouseleave', () => {
            retryBtn.style.background      = 'transparent';
            retryBtn.style.borderColor     = 'rgba(201,169,110,0.5)';
            retryBtn.style.color           = 'rgba(201,169,110,0.75)';
        });

        // On Try Again: fade out overlay, then navigate to scan
        retryBtn.addEventListener('click', async () => {
            overlay.style.opacity = '0';
            await delay(700);
            overlay.remove();
            await this.transitionToScreen('scan');
        }, { once: true });
    },

    // ── Narration: 5-bar waveform + audio sync ────────
    async startNarration(audioHandle) {
        this.setState(FLOW_STATES.PLAYING_NARRATION);

        // ── Abort signal ──────────────────────────────────────────────────────
        // CRITICAL: do NOT reset _narrationAborted here.
        // Abort ownership belongs exclusively to runExperience().
        // Resetting here would erase an exit signal that arrived before this
        // function was called — the root cause of zombie narration.
        //
        // Re-use the exitPromise resolver created by runExperience().
        // If abortNarration() was already called before we got here,
        // _abortNarrationResolve is null (already resolved) — create a
        // pre-resolved promise so raceDelay() returns immediately.
        const abortPromise = this._abortNarrationResolve
            ? new Promise(r => { this._abortNarrationResolve = r; })
            : Promise.resolve();
        const aborted   = () => this._narrationAborted;
        const raceDelay = (ms) => Promise.race([delay(ms), abortPromise]);

        const waveformContainer = document.getElementById('waveform-bars');
        const controls          = document.getElementById('narration-controls');

        if (!waveformContainer) {
            console.error('[FlowController] #waveform-bars not found — narration screen missing.');
            this.unlock();
            Camera.show();
            Camera.setOverlayOpacity(0.65);
            return;
        }

        // ── Detect cannot-return mode (speechSynthesis entirely unavailable) ──
        // mode === 'silent' (audioBuffer === null) is the only truly voiceless state.
        // mode === 'speech'     → browser speechSynthesis is active — real voice, no fallback text needed.
        // mode === 'elevenlabs' → Web Audio buffer — real voice, no fallback text needed.
        const isCannotReturn = audioHandle.audioBuffer === null;
        if (isCannotReturn) {
            console.warn('[FlowController] Cannot-return mode — speechSynthesis unavailable. Ambient continues.');
        } else {
            console.log('[FlowController] Voice active — mode:', audioHandle.mode, '| proceeding to playback.');
        }

        // Ritual silence before voice
        await raceDelay(1000);
        if (aborted()) return;

        // Create AnalyserNode only for ElevenLabs — Web Audio API reads real amplitude.
        // For speech / cannot-return: pass null so waveform runs organic simulation.
        const analyserNode  = (audioHandle.mode === 'elevenlabs') ? Audio.createAnalyser() : null;
        // Pass speechContext for the timeline-driven waveform (speech mode only).
        const speechContext = audioHandle.speechContext ?? null;

        // Start waveform animation — mode selected inside draw5BarWaveform
        const stopBars = Audio.draw5BarWaveform(waveformContainer, analyserNode, speechContext);
        State.stopWaveform = stopBars;

        // Start live transcript engine for speech mode
        // Must be wired AFTER draw5BarWaveform (which sets onWaveformStart/End on speechContext)
        // so SubtitleEngine can wrap those callbacks without losing waveform signals.
        if (speechContext && audioHandle.mode === 'speech') {
            const narrationText = sanitizeNarration(State.currentNarrative?.narrative || '');
            SubtitleEngine.start(narrationText, speechContext, 'transcript-zone');
        }

        // Start emotional underscore layer — wired AFTER SubtitleEngine so all
        // speechContext callbacks are already chained; Underscore appends to the end.
        // analyserNode is non-null for ElevenLabs (real sidechain), null for speech
        // mode (callback-based ducking via speechContext).
        Underscore.start(State.currentNarrative, State.currentArtwork, {
            analyserNode,
            speechContext,
        });

        // Play via Web Audio — no user-gesture requirement, only needs running context
        console.log('[FlowController] Calling audioHandle.play()…');
        await audioHandle.play(analyserNode);
        if (aborted()) return;
        console.log('[FlowController] audioHandle.play() returned — queue running async.');

        // ── WAIT FOR TRUE AUDIO END ──────────────────────────────────────────
        // For speech mode: await audioEndPromise (resolves when last utterance ends
        //   OR immediately when abortNarration() is called — handle.stop() calls _resolveAudioEnd).
        // For ElevenLabs:  await duration-based timer.
        // Every path also races against abortPromise for instant exit response.
        // Safety cap: duration estimate + 30s prevents hanging on TTS edge-cases.
        const durationMs = (audioHandle.duration || 22) * 1000;
        if (audioHandle.audioEndPromise) {
            console.log('[FlowController] Awaiting audioEndPromise (true queue end)…');
            await Promise.race([
                audioHandle.audioEndPromise,
                abortPromise,
                new Promise(r => setTimeout(r, durationMs + 30000)),
            ]);
            console.log('[FlowController] audioEndPromise resolved — speech truly finished.');
        } else {
            // ElevenLabs / cannot-return path
            console.log(`[FlowController] Awaiting duration timer: ${(durationMs / 1000).toFixed(1)}s`);
            await raceDelay(durationMs);
        }

        // If exit was triggered mid-narration: audio, subtitles, waveform, and
        // ambient have already been stopped by GlobalExitButton. Return here so
        // we never touch post-audio UI (WhatsApp notif, controls) on a screen
        // that no longer exists.
        if (aborted()) return;

        // ── POST-AUDIO SEQUENCE ──────────────────────────────────────────────
        // 1. Stop waveform animation (begins visual decay)
        stopBars();
        State.stopWaveform = null;

        // 2. TranscriptEngine received onWaveformEnd (fired by _runQueue → onSpeechEnd).
        //    It holds the final transcript for POST_SPEECH_HOLD_MS (1000ms), then dims
        //    to 40% opacity over POST_SPEECH_DIM_MS (600ms). We wait for that window
        //    before showing any end-UI so the transition completes cleanly.
        const SUBTITLE_EXIT_MS = 1000 + 600 + 200;  // hold + dim + margin
        await raceDelay(SUBTITLE_EXIT_MS);
        if (aborted()) return;

        // 3. Now that subtitles have exited: stop engine (clears callbacks / timers).
        SubtitleEngine.stop();

        // 4. Fade out ambient aura + underscore concurrently with UI reveal
        AmbientSoundEngine.stop();
        Underscore.stop();

        // 5. Reveal "Discover another artwork" button
        if (controls) controls.classList.remove('hidden');

        // Unlock — NarrationScreen button drives the next navigation (→ scan).
        // FlowController never navigates after narration ends (v11+).
        this.unlock();
        this.setState(FLOW_STATES.IDLE);
    },

    enterContinuationMode() { this.setState(FLOW_STATES.CONTINUATION_MODE); },
    exitContinuationMode()  { this.setState(FLOW_STATES.IDLE); }
};
