/**
 * LORE — Live Transcript Stream Engine  v21
 *
 * Renders a "living historical voice writing itself in real time" —
 * a scrolling transcript feed synchronized with the speechSynthesis queue.
 * NOT subtitles. NOT karaoke. A museum scroll feed.
 *
 * Sync strategy (two-layer, same as v20):
 *   Primary  — utterance.onboundary charIndex events →
 *               speechContext.onSubtitleBoundary(segIdx, charIndex)
 *   Fallback — per-segment timing timer →
 *               speechContext.onSubtitleSegment(segIdx, rateFactor)
 *               (activated when onboundary is absent: iOS Safari, old Firefox)
 *
 * Word reveal behaviour:
 *   - Words stream in one-by-one (never pre-rendered)
 *   - Each word: opacity 0→1 + translateY(6px→0) over 200ms
 *   - Current word highlighted #C9A96E; spoken words #F0EBE0 at 0.82 opacity
 *   - Transcript accumulates — no deletions
 *   - Container auto-scrolls to bottom, debounced every 2–3 words or punctuation
 *
 * End-of-speech sequence:
 *   1. Reveal any remaining words instantly
 *   2. Remove current-word highlight
 *   3. Hold 1 000ms (last words settle)
 *   4. Dim transcript to 40% opacity (600ms) — "voice recedes into history"
 *   5. flowController reveals WhatsApp + Discover button after full window
 */

const SPOKEN_COLOR        = 'rgba(240,235,224,0.82)';
const CURRENT_COLOR       = '#C9A96E';
const WORD_FADE_MS        = 200;          // opacity + translateY transition
const SCROLL_DEBOUNCE_MS  = 120;          // ms between scroll calls
const SCROLL_EVERY_N      = 2;            // scroll every N words (or on punctuation)
const POST_SPEECH_HOLD_MS = 1000;         // hold before dimming
const POST_SPEECH_DIM_MS  = 600;          // dim transition duration
const POST_SPEECH_OPACITY = '0.40';       // final dimmed opacity (still readable)

/** Punctuation that triggers an immediate scroll even if word count < SCROLL_EVERY_N */
const SCROLL_PUNCT = /[.,;:!?…—–]$/;

/**
 * @typedef {Object} TranscriptHandle
 * @property {function} stop — cancel timers, null callbacks, finalize state
 */

export const SubtitleEngine = {
    /** @type {TranscriptHandle|null} */
    _active: null,

    /**
     * Mount the live transcript for this narration.
     *
     * @param {string} fullText        — complete narration text
     * @param {Object} speechContext   — shared context from _makeSpeechHandle
     * @param {string} transcriptZoneId — DOM element id (default 'transcript-zone')
     * @returns {TranscriptHandle}
     */
    start(fullText, speechContext, transcriptZoneId = 'transcript-zone') {
        this.stop();

        const zone   = document.getElementById(transcriptZoneId);
        const textEl = document.getElementById('transcript-text');
        if (!zone || !textEl) {
            console.warn('[Transcript] Zone or text element not found — id:', transcriptZoneId);
            return { stop: () => {} };
        }

        // ── Pre-process: tokenise into words (punctuation stays attached) ──
        const words = fullText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        if (words.length === 0) return { stop: () => {} };

        // Clear any leftover content from previous run
        textEl.innerHTML = '';
        textEl.style.color = SPOKEN_COLOR;  // paragraph base colour

        // ── Per-segment word index map ─────────────────────────────────────
        const segmentTexts      = speechContext.segmentTexts || [];
        const segmentWordRanges = buildSegmentWordRanges(words, segmentTexts);

        // ── State ──────────────────────────────────────────────────────────
        let currentWordIdx  = -1;
        let stopped         = false;
        let boundaryActive  = false;
        let fallbackTimers  = [];
        let wordsSinceScroll = 0;
        let scrollTimer      = null;

        // Spans are created on-demand as each word is revealed (not pre-rendered)
        // This is the key difference from v20: no pre-rendering, words truly "appear"
        const spans = new Array(words.length).fill(null);

        // ── Show transcript zone ───────────────────────────────────────────
        const showZone = () => {
            zone.style.transition  = 'opacity 0.6s ease';
            zone.style.opacity     = '1';
        };

        // ── Create a word span (called on first reveal of each word) ───────
        const createSpan = (idx) => {
            const span = document.createElement('span');
            const word = words[idx];
            // Add trailing space unless it's the last word
            span.textContent = (idx < words.length - 1) ? word + ' ' : word;
            span.style.cssText = `
                opacity: 0;
                color: ${SPOKEN_COLOR};
                transform: translateY(6px);
                display: inline;
                transition: opacity ${WORD_FADE_MS}ms ease,
                            transform ${WORD_FADE_MS}ms ease,
                            color 200ms ease;
            `;
            textEl.appendChild(span);
            spans[idx] = span;
            return span;
        };

        // ── Debounced scroll to bottom ─────────────────────────────────────
        const scheduleScroll = (force = false) => {
            wordsSinceScroll++;
            const isPunct = SCROLL_PUNCT.test(words[currentWordIdx] || '');
            if (!force && !isPunct && wordsSinceScroll < SCROLL_EVERY_N) return;
            wordsSinceScroll = 0;

            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                if (!stopped) {
                    zone.scrollTo({ top: zone.scrollHeight, behavior: 'smooth' });
                }
            }, SCROLL_DEBOUNCE_MS);
        };

        // ── Reveal words up to targetIdx (inclusive) ──────────────────────
        const revealUpTo = (targetIdx) => {
            if (stopped) return;
            const clamped = Math.min(targetIdx, words.length - 1);

            for (let i = Math.max(0, currentWordIdx + 1); i <= clamped; i++) {
                const span = spans[i] || createSpan(i);
                // Trigger CSS transition: next frame so the initial style is painted first
                requestAnimationFrame(() => {
                    span.style.opacity   = (i === clamped) ? '1' : '0.82';
                    span.style.color     = (i === clamped) ? CURRENT_COLOR : SPOKEN_COLOR;
                    span.style.transform = 'translateY(0)';
                });
            }

            // De-highlight previously active word
            if (currentWordIdx >= 0 && spans[currentWordIdx]) {
                spans[currentWordIdx].style.color = SPOKEN_COLOR;
            }

            currentWordIdx = clamped;
            scheduleScroll();
        };

        // ── PRIMARY: onboundary (charIndex) ───────────────────────────────
        speechContext.onSubtitleBoundary = (segIdx, charIndex) => {
            if (stopped) return;
            boundaryActive = true;

            const range = segmentWordRanges[segIdx];
            if (!range) return;

            const segText    = segmentTexts[segIdx] || '';
            const wordsInSeg = segText.slice(0, charIndex).split(/\s+/).filter(Boolean).length;
            const absIdx     = range.start + Math.min(wordsInSeg, range.count - 1);

            if (absIdx > currentWordIdx) revealUpTo(absIdx);
        };

        // ── FALLBACK: timing-based, one word per estimated interval ───────
        speechContext.onSubtitleSegment = (segIdx, rateFactor = 1.0) => {
            if (stopped || boundaryActive) return;

            const range = segmentWordRanges[segIdx];
            if (!range) return;

            // Per-word interval: ~60ms base, inversely scaled with speech rate
            const msPerWord = Math.round(60 / rateFactor);

            for (let w = 0; w < range.count; w++) {
                const absIdx = range.start + w;
                const delay  = w * msPerWord;
                const tid = setTimeout(() => {
                    if (!stopped && absIdx > currentWordIdx) revealUpTo(absIdx);
                }, delay);
                fallbackTimers.push(tid);
            }
        };

        // ── Speech started → show zone ─────────────────────────────────────
        const originalOnStart = speechContext.onWaveformStart;
        speechContext.onWaveformStart = () => {
            if (originalOnStart) originalOnStart();
            showZone();
        };

        // ── Speech ended → finalize transcript ────────────────────────────
        const originalOnEnd = speechContext.onWaveformEnd;
        speechContext.onWaveformEnd = () => {
            if (originalOnEnd) originalOnEnd();
            onSpeechEnd();
        };

        const onSpeechEnd = () => {
            if (stopped) return;

            // 1. Instantly reveal any remaining unrevealed words
            for (let i = Math.max(0, currentWordIdx + 1); i < words.length; i++) {
                const span = spans[i] || createSpan(i);
                span.style.opacity   = '0.82';
                span.style.color     = SPOKEN_COLOR;
                span.style.transform = 'translateY(0)';
                span.style.transition = 'none';
            }
            // Remove highlight from last active word
            if (currentWordIdx >= 0 && spans[currentWordIdx]) {
                spans[currentWordIdx].style.color = SPOKEN_COLOR;
            }
            currentWordIdx = words.length - 1;

            // 2. Force-scroll to very bottom
            zone.scrollTo({ top: zone.scrollHeight, behavior: 'smooth' });

            // 3. Hold → dim (transcript "recedes into history")
            setTimeout(() => {
                if (stopped) return;
                zone.style.transition = `opacity ${POST_SPEECH_DIM_MS}ms ease`;
                zone.style.opacity    = POST_SPEECH_OPACITY;
            }, POST_SPEECH_HOLD_MS);
        };

        // ── Handle ────────────────────────────────────────────────────────
        const handle = {
            /**
             * Called by flowController after the post-speech dim window completes.
             * Clears timers and callbacks — does NOT force-hide zone (already dimmed
             * by onSpeechEnd, or if called early during stop(), hides immediately).
             */
            stop() {
                stopped = true;
                clearTimeout(scrollTimer);
                fallbackTimers.forEach(clearTimeout);
                fallbackTimers = [];
                if (speechContext.onSubtitleBoundary) speechContext.onSubtitleBoundary = null;
                if (speechContext.onSubtitleSegment)  speechContext.onSubtitleSegment  = null;
                // Hide zone immediately (no-op if already dimmed by onSpeechEnd)
                zone.style.transition = 'none';
                zone.style.opacity    = '0';
            },
        };

        this._active = handle;
        return handle;
    },

    stop() {
        if (this._active) {
            this._active.stop();
            this._active = null;
        }
    },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a segment-index → { start, count } map by fuzzy-matching each
 * segment's first word against the global word list (in order, from cursor).
 */
function buildSegmentWordRanges(allWords, segmentTexts) {
    const ranges = [];
    let cursor   = 0;

    for (const segText of segmentTexts) {
        const segWords  = segText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        const count     = segWords.length;
        let matchStart  = cursor;

        const firstWord = segWords[0]?.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (firstWord) {
            for (let i = cursor; i < Math.min(cursor + 10, allWords.length); i++) {
                const cand = allWords[i]?.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cand === firstWord) { matchStart = i; break; }
            }
        }

        ranges.push({ start: matchStart, count: Math.max(1, count) });
        cursor = matchStart + count;
    }

    return ranges;
}
