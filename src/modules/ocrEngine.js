/**
 * LORE — OCR Engine (v2 — hardened)
 *
 * Reads museum labels and descriptive plaques using OCR.space.
 * The captured camera frame (base64 JPEG) is sent via a Supabase Edge Function
 * that injects the API key server-side — the key is never exposed to the browser.
 *
 * ARCHITECTURE
 * ─────────────
 * Frontend → POST /functions/v1/ocr-parse-image (Supabase Edge Function)
 *          → POST OCR.space /parse/image  (key injected server-side)
 *
 * CONFIDENCE SYSTEM (v2 — weighted + validated)
 * ──────────────────────────────────────────────
 * Each field is validated for plausibility before it contributes to the score:
 *
 *   title valid  (≥3 chars, not purely numeric)  → +0.5
 *   artist valid (looks like a name)              → +0.3
 *   year valid   (1000–2099)                      → +0.2
 *
 *   Final score (0–1):
 *     ≥ 0.6 → high confidence → proceed to resurrection
 *     < 0.6 → low confidence  → show fallback modal (pre-filled)
 *
 * RELIABILITY
 * ────────────
 * • 15 s AbortController timeout on each attempt
 * • 1 automatic retry with 1 s backoff on network / 5xx errors
 * • OCRExitCode 2 (partial parse) treated as low-confidence, not success
 * • Every failure path returns a structured result — never throws to caller
 */

const CONFIDENCE_THRESHOLD = 0.6;  // title (0.5) alone is not enough — needs at least artist too

// ─────────────────────────────────────────────────────────────────────
// extractArtworkMetadata
// ─────────────────────────────────────────────────────────────────────
/**
 * Parse raw OCR text from a museum label into structured metadata.
 *
 * DETECTION HEURISTICS — tried in order:
 *
 * 1. Explicit em-dash pattern:
 *    "Mona Lisa — Leonardo da Vinci — 1503"
 *
 * 2. Year-anchored pattern (year on its own line or inline):
 *    Looks for a 3–4 digit year and positions title/artist relative to it.
 *
 * 3. Line-by-line classification:
 *    Lines are scored against four categories:
 *      YEAR  – matches /^[\(]?\d{3,4}[\)\s]?(?:–\d+)?/ or era phrases
 *      ARTIST – matches "by", "artist:", common name patterns, title-case
 *      TITLE  – remaining short lines, often the first substantial text
 *      OTHER  – parentheticals, dates, dimensions, descriptions
 *
 * @param {string} rawText – full OCR output
 * @returns {{
 *   title: string,
 *   artist: string,
 *   year: string,
 *   era: string,
 *   confidence: number,
 *   rawText: string,
 *   fieldCount: number
 * }}
 */
export function extractArtworkMetadata(rawText) {
    const result = { title: '', artist: '', year: '', era: '', rawText, confidence: 0, fieldCount: 0 };

    if (!rawText || !rawText.trim()) return result;

    // ── Normalise: collapse excessive whitespace, unify dashes ──────
    const cleaned = rawText
        .replace(/[\u2013\u2014]/g, '—')  // normalise en/em dash
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    // ── STRATEGY 1: explicit dash-separated single line ─────────────
    // "Mona Lisa — Leonardo da Vinci — 1503"
    const dashLine = cleaned.split('\n').find(l => l.includes('—') && l.split('—').length >= 2);
    if (dashLine) {
        const parts = dashLine.split('—').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
            // last part may be year
            const last = parts[parts.length - 1];
            if (/^\d{3,4}/.test(last)) {
                result.year  = _cleanYear(last);
                result.title  = parts[0];
                result.artist = parts.length >= 3 ? parts[1] : '';
            } else if (parts.length === 2) {
                result.title  = parts[0];
                result.artist = parts[1];
            } else {
                result.title  = parts[0];
                result.artist = parts[1];
                result.year   = parts[2] || '';
            }
            _postProcess(result);
            return _score(result);
        }
    }

    // ── STRATEGY 2: comma-separated inline ──────────────────────────
    // "Liberty Leading the People, Eugène Delacroix, 1830"
    const commaLine = cleaned.split('\n').find(l => {
        const cs = l.split(',');
        return cs.length >= 2 && cs.some(c => /\d{3,4}/.test(c));
    });
    if (commaLine) {
        const parts = commaLine.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
            const yearPart = parts.find(p => /^\d{3,4}/.test(p));
            const nonYear  = parts.filter(p => p !== yearPart);
            result.title  = nonYear[0] || '';
            result.artist = nonYear[1] || '';
            result.year   = yearPart ? _cleanYear(yearPart) : '';
            _postProcess(result);
            return _score(result);
        }
    }

    // ── STRATEGY 3: line-by-line classification ──────────────────────
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 1);

    const classified = lines.map(line => ({ line, role: _classifyLine(line) }));

    // Pull year/era first (deterministic)
    const yearEntry = classified.find(c => c.role === 'year');
    if (yearEntry) {
        const parsed = _parseYearEra(yearEntry.line);
        result.year = parsed.year;
        result.era  = parsed.era;
    }

    // Artist line — explicit "by" prefix or "Artist:" label
    const artistByEntry = classified.find(c => c.role === 'artist_explicit');
    if (artistByEntry) {
        result.artist = _stripArtistLabel(artistByEntry.line);
    }

    // Title — first non-year, non-artist line that is title-cased or short
    const titleCandidates = classified.filter(c =>
        c.role === 'title' || (!result.artist && c.role === 'artist_inferred')
    );

    if (titleCandidates.length > 0) {
        result.title = titleCandidates[0].line;
        // if no explicit artist, second candidate may be artist
        if (!result.artist && titleCandidates.length > 1) {
            result.artist = titleCandidates[1].line;
        }
    }

    // Artist fallback: inferred (title-case name-like line)
    if (!result.artist) {
        const artistInferred = classified.find(c => c.role === 'artist_inferred');
        if (artistInferred) result.artist = artistInferred.line;
    }

    _postProcess(result);
    return _score(result);
}

// ─────────────────────────────────────────────────────────────────────
// Line classification helpers
// ─────────────────────────────────────────────────────────────────────

const YEAR_RE        = /^[\(]?\d{3,4}[\)\s]?(–\s*\d+)?/;
const ERA_PHRASES    = ['century', 'c.', 'circa', 'ca.', 'bc', 'ad', 'bce'];
const ARTIST_LABELS  = /^(by|artist|painter|sculptor|photographer|maker)\s*:?\s+/i;
const DIMENSION_RE   = /^\d+\s*(x|×)\s*\d+/i;
const PARENS_RE      = /^\(.*\)$/;

function _classifyLine(line) {
    const lc = line.toLowerCase();

    // Skip dimensions/parentheticals/accession numbers
    if (DIMENSION_RE.test(line) || PARENS_RE.test(line)) return 'skip';
    if (/^[A-Z0-9]{5,}\s*$/.test(line)) return 'skip'; // accession number

    if (YEAR_RE.test(line) || ERA_PHRASES.some(e => lc.includes(e))) return 'year';
    if (ARTIST_LABELS.test(line)) return 'artist_explicit';

    // Short title-case phrase likely to be title (3–60 chars)
    const words = line.split(' ');
    if (line.length <= 60 && words.length <= 8) {
        // Name pattern: two or more title-cased words, no verb-like lowercase
        const isNameLike = words.every(w => /^[A-ZÁÉÍÓÚÀÈÌÒÙÄÖÜÆØÅÑÇŒ]/.test(w));
        if (isNameLike && words.length >= 2 && words.length <= 5) return 'artist_inferred';
        return 'title';
    }

    return 'other';
}

function _parseYearEra(line) {
    const match = line.match(/(\d{3,4})/);
    return {
        year: match ? match[1] : '',
        era:  match ? '' : line,
    };
}

function _stripArtistLabel(line) {
    return line.replace(ARTIST_LABELS, '').trim();
}

function _cleanYear(str) {
    const m = str.match(/\d{3,4}/);
    return m ? m[0] : str.trim();
}

function _postProcess(result) {
    // Strip stray punctuation
    result.title  = result.title.replace(/[,;:—]+$/, '').trim();
    result.artist = result.artist.replace(/[,;:—]+$/, '').trim();
    result.year   = result.year.replace(/[^0-9\-–BCE ce]/gi, '').trim();

    // Swap if title looks more like a name (short, 2-word title-case) and artist is long
    if (
        result.title && result.artist &&
        result.title.split(' ').length <= 3 &&
        result.artist.split(' ').length > 6 &&
        /^[A-Z][a-z]+\s+[A-Z]/.test(result.title)
    ) {
        [result.title, result.artist] = [result.artist, result.title];
    }
}

function _score(result) {
    // ── Weighted, validated confidence (v2) ──────────────────────────
    // Each field must pass a plausibility check before it adds to the score.
    // title:  ≥ 3 chars, not purely numeric           → +0.5
    // artist: looks like a name (has letters, ≥2 chars, no lone digit) → +0.3
    // year:   integer between 1000 and 2099            → +0.2

    const titleValid  = _validateTitle(result.title);
    const artistValid = _validateArtist(result.artist);
    const yearValid   = _validateYear(result.year);

    let score = 0;
    if (titleValid)  score += 0.5;
    if (artistValid) score += 0.3;
    if (yearValid)   score += 0.2;

    result.fieldCount  = (titleValid ? 1 : 0) + (artistValid ? 1 : 0) + (yearValid ? 1 : 0);
    result.confidence  = Math.round(score * 100) / 100;
    return result;
}

function _validateTitle(title) {
    if (!title || title.trim().length < 3) return false;
    // Reject purely numeric strings (accession numbers, dimensions)
    if (/^\d+$/.test(title.trim())) return false;
    return true;
}

function _validateArtist(artist) {
    if (!artist || artist.trim().length < 2) return false;
    // Must contain at least one letter
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(artist)) return false;
    // Reject strings that are just a number or a single punctuation character
    if (/^[\d\W]+$/.test(artist.trim())) return false;
    return true;
}

function _validateYear(year) {
    if (!year) return false;
    const m = year.match(/\d{3,4}/);
    if (!m) return false;
    const y = parseInt(m[0], 10);
    return y >= 1000 && y <= 2099;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers — proxy fetch with timeout + retry
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = import.meta.env?.VITE_SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ocr-parse-image`;

const OCR_TIMEOUT_MS = 15_000;  // 15 s per attempt
const OCR_MAX_RETRY  = 1;       // 1 automatic retry on network / 5xx

function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Single attempt — POST base64 image to the Edge Function proxy.
 * Uses AbortController so it never hangs beyond OCR_TIMEOUT_MS.
 */
async function _attemptOcr(base64Snapshot) {
    const controller  = new AbortController();
    const timeoutId   = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    try {
        console.log('[OCR] sending to backend');
        const response = await fetch(EDGE_FUNCTION_URL, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey':        SUPABASE_ANON_KEY,
            },
            body:   JSON.stringify({ base64Image: base64Snapshot, language: 'eng' }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.status === 429) throw new Error('ocr_quota_exceeded');
        if (response.status === 402) throw new Error('ocr_insufficient_balance');

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ocr_http_${response.status}: ${errText}`);
        }

        return await response.json();

    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error('ocr_timeout');
        throw err;
    }
}

/**
 * Retry wrapper — retries once on network errors or 5xx.
 * Quota / billing errors are forwarded immediately (no retry).
 */
async function _fetchOcrWithRetry(base64Snapshot) {
    let lastErr;
    for (let attempt = 0; attempt <= OCR_MAX_RETRY; attempt++) {
        try {
            return await _attemptOcr(base64Snapshot);
        } catch (err) {
            lastErr = err;
            // Do not retry on quota/billing — they won't self-resolve
            if (err.message === 'ocr_quota_exceeded' || err.message === 'ocr_insufficient_balance') {
                throw err;
            }
            if (attempt < OCR_MAX_RETRY) {
                console.warn(`[OCR] Attempt ${attempt + 1} failed (${err.message}) — retrying in 1 s…`);
                await _delay(1000 * (attempt + 1));
            }
        }
    }
    throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────
// OcrEngine — public API
// ─────────────────────────────────────────────────────────────────────
export const OcrEngine = {

    CONFIDENCE_THRESHOLD,

    /**
     * Scan the current camera frame via the secure Edge Function proxy.
     *
     * @param {string} base64Snapshot – JPEG data URL from ScanEngine.capture()
     * @returns {Promise<{
     *   success: boolean,
     *   rawText: string,
     *   metadata: ReturnType<extractArtworkMetadata>,
     *   highConfidence: boolean,
     *   partialParse: boolean,
     *   error?: string
     * }>}
     */
    async scanLabel(base64Snapshot) {
        if (!base64Snapshot) {
            console.warn('[OCR] No snapshot provided — cannot run OCR.');
            return { success: false, rawText: '', metadata: _emptyMeta(), highConfidence: false, partialParse: false, error: 'no_snapshot' };
        }

        try {
            const data = await _fetchOcrWithRetry(base64Snapshot);
            console.log('[OCR] response received', {
                exitCode:   data.OCRExitCode,
                errored:    data.IsErroredOnProcessing,
                processingMs: data.ProcessingTimeInMilliseconds,
            });

            if (data.IsErroredOnProcessing) {
                const msg = data.ParsedResults?.[0]?.ErrorMessage || 'Unknown OCR error';
                throw new Error(`OCR processing error: ${msg}`);
            }

            // Exit code 3 or 4 = hard failure
            if (data.OCRExitCode === 3 || data.OCRExitCode === 4) {
                throw new Error(`OCR exit code: ${data.OCRExitCode}`);
            }

            // Exit code 2 = partial parse — extract text but force low confidence
            const partialParse = (data.OCRExitCode === 2);
            if (partialParse) {
                console.warn('[OCR] Partial parse (exit code 2) — will treat as low confidence.');
            }

            const rawText = data.ParsedResults?.[0]?.ParsedText || '';
            console.log(`[OCR] response received — ${rawText.length} chars:`, rawText.substring(0, 200));

            if (!rawText.trim()) {
                console.warn('[OCR] Empty result — no text detected in frame.');
                console.log('[OCR] fallback triggered', 'no_text');
                return { success: false, rawText: '', metadata: _emptyMeta(), highConfidence: false, partialParse, error: 'no_text' };
            }

            const metadata = extractArtworkMetadata(rawText);

            // Partial parses never qualify as high-confidence regardless of field count
            const highConfidence = !partialParse && metadata.confidence >= CONFIDENCE_THRESHOLD;

            console.log('[OCR] confidence', metadata.confidence.toFixed(2), {
                title:         metadata.title  || '(none)',
                artist:        metadata.artist || '(none)',
                year:          metadata.year   || '(none)',
                highConfidence,
                partialParse,
            });

            if (!highConfidence) {
                console.log('[OCR] fallback triggered', partialParse ? 'partial_parse' : 'low_confidence');
            }

            return { success: true, rawText, metadata, highConfidence, partialParse };

        } catch (err) {
            console.error('[OCR] Scan failed:', err.message);
            console.log('[OCR] fallback triggered', err.message);
            return { success: false, rawText: '', metadata: _emptyMeta(), highConfidence: false, partialParse: false, error: err.message };
        }
    },
};

function _emptyMeta() {
    return { title: '', artist: '', year: '', era: '', rawText: '', confidence: 0, fieldCount: 0 };
}
