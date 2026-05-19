/**
 * LORE — Audio Module  v21
 *
 * ROUTING FIXES (v21):
 *   — normalizeNationality: 'North African' / 'Central African' (with space) now match correctly
 *   — normalizeNationality: 'Greek' / Hellenic nationalities added (el-GR locale)
 *   — speak(): gender normalised at source via normalizeGender() — 'unknown' no longer leaks raw
 *   — _getElevenLabsVoice(): deterministic artwork-seeded selection (same artwork = same voice)
 *   — selectBrowserVoice step 8: gender preference honoured even at absolute last resort
 *   — All routing decisions emitted as a single [VOICE ROUTING] log per speak() call
 *
 * TWO-LAYER VOICE ARCHITECTURE:
 *
 *   LAYER 1 — CHARACTER IDENTITY (Claude)
 *     nationality, culture, origin are used ONLY for:
 *       → prompt / narrative style / language fragments / emotional tone
 *       → selectBrowserVoice() locale matching
 *
 *   LAYER 2 — VOICE ENGINE (Reality)
 *     Only real, confirmed-working voices are ever used.
 *
 * Pipeline priority (LORE must NEVER be fully silent):
 *
 *   1. Browser TTS  — preferred for non-English nationalities
 *                     Uses real locale voices: it-IT, fr-FR, ja-JP, de-DE, etc.
 *                     mode: 'speech'   when locale voice found
 *
 *   2. ElevenLabs   — ENGLISH-ONLY fallback (British/American voices)
 *                     Used when browser has NO locale voice for this language.
 *                     Selected by gender ONLY — no fake nationality mapping.
 *                     mode: 'elevenlabs'
 *
 *   3. Browser TTS  — catch-all fallback after ElevenLabs failure
 *                     Any available voice, no locale restriction.
 *                     mode: 'speech'
 *
 *   4. Cannot Return — speechSynthesis entirely unavailable
 *                      Cinematic on-screen message only.
 *                      mode: 'silent'
 *
 * NEVER:
 *   - Fake nationality voices (Italian/French/etc. mapped to American IDs)
 *   - 402 / 404 voice IDs in any pool
 *   - Silent waveform pretending to play
 *   - Retry loop on ElevenLabs errors (immediately falls to browser TTS)
 *
 * Debug logs emitted at every decision point:
 *   [VOICE ENGINE] browser voices: <available locale list>
 *   [VOICE ENGINE] elevenlabs voices: <catalog>
 *   [VOICE ENGINE] selected voice: <id or voice name>
 *   [VOICE ENGINE] mode: browser | elevenlabs
 *
 * Handle interface (returned by speak()):
 *   { mode, duration, audioBuffer, play(analyserNode?): Promise<void>, stop() }
 *
 *   mode === 'elevenlabs'  → audioBuffer is an AudioBuffer (truthy)
 *   mode === 'speech'      → audioBuffer is the symbol SPEECH_MARKER (truthy)
 *   mode === 'silent'      → audioBuffer is null (only mode with null)
 */

import { AudioUnlock } from './audioUnlock.js';
import { AudioMixer } from './audioMixer.js';

// ── sanitizeNarration ──────────────────────────────────────────
/**
 * Strip stage directions from AI-generated narration text before any
 * TTS or subtitle pipeline sees it.
 *
 * Removes:
 *   (parenthetical actions)   e.g. (whispers), (voice trembling)
 *   [bracketed directions]    e.g. [silence], [pause]
 *   *asterisk actions*        e.g. *gasps*, *laughs softly*
 *
 * Then collapses whitespace and trims.
 * Safe to call multiple times — idempotent.
 *
 * @param {string} text — raw Claude output
 * @returns {string}    — clean, directly speakable text
 */
export function sanitizeNarration(text) {
    if (!text) return '';
    return text
        .replace(/\([^)]*\)/g, '')   // (parenthetical)
        .replace(/\[[^\]]*\]/g, '')   // [bracketed]
        .replace(/\*[^*]*\*/g,  '')   // *asterisk action*
        .replace(/\s{2,}/g,    ' ')   // collapse multiple spaces
        .trim();
}

// ── Constants ──────────────────────────────────────────────────
const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';

// Sentinel: audioBuffer value for speechSynthesis mode (truthy, not null, not an AudioBuffer)
const SPEECH_MARKER = Symbol('speech');

// ── Runtime env getter — never cached at module scope ──────────
function getElevenLabsKey() {
    return (
        (typeof window !== 'undefined' && window.__ELEVENLABS_KEY__) ||
        import.meta.env?.VITE_ELEVENLABS_API_KEY ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('LORE_ELEVENLABS_KEY')) ||
        ''
    );
}

// ── ElevenLabs confirmed voice catalog ────────────────────────
// ONLY voice IDs confirmed HTTP 200 on the current account (live-tested).
// Grouped by gender ONLY — no nationality mapping.
// ElevenLabs is the ENGLISH-ONLY fallback layer. Cultural accent comes
// from the browser's real locale voices (it-IT, fr-FR, ja-JP, etc.).
//
// Male preference order: British theatrical first, then dramatic/strong.
// Female preference order: British first, then warm American.
const ELEVENLABS_CATALOG = {
    male: [
        { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George',  accent: 'british',    style: 'narrative_story'        },
        { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel',  accent: 'british',    style: 'informative_educational' },
        { id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry',   accent: 'american',   style: 'characters_animation'   },
        { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', accent: 'australian', style: 'conversational'          },
        { id: 'VR6AewLTigWG4xSOukaG', name: '—',       accent: 'unknown',    style: 'shared'                 },
        { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum',  accent: 'american',   style: 'characters_animation'   },
        { id: 'ErXwobaYiN019PkySvjV', name: '—',       accent: 'unknown',    style: 'shared'                 },
        { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam',    accent: 'american',   style: 'social_media'           },
        { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',    accent: 'american',   style: 'social_media'           },
    ],
    female: [
        { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily',    accent: 'british',  style: 'informative_educational' },
        { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice',   accent: 'british',  style: 'informative_educational' },
        { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah',   accent: 'american', style: 'entertainment_tv'        },
        { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', accent: 'american', style: 'informative_educational' },
        { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura',   accent: 'american', style: 'social_media'            },
        { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', accent: 'american', style: 'conversational'          },
    ],
};

/**
 * Pick the best ElevenLabs voice for a character.
 * Selection is by gender ONLY — no fake nationality mapping.
 *
 * Voice index is stabilised with a simple hash of `artworkSeed` so the same
 * artwork always produces the same voice across sessions (Phase 8).
 * Falls back to pool[0] when artworkSeed is empty.
 *
 * @param {string} gender      — "male" | "female" | "" | "unknown"
 * @param {string} artworkSeed — artwork id or title for deterministic selection
 * @returns {{ id: string, name: string, accent: string }}
 */
function _getElevenLabsVoice(gender, artworkSeed = '') {
    const g    = normalizeGender(gender);
    const pool = g === 'female' ? ELEVENLABS_CATALOG.female : ELEVENLABS_CATALOG.male;

    // Stable hash: sum char codes, modulo pool length
    let idx = 0;
    if (artworkSeed) {
        let h = 0;
        for (let i = 0; i < artworkSeed.length; i++) h = (h * 31 + artworkSeed.charCodeAt(i)) >>> 0;
        idx = h % pool.length;
    }
    const chosen = pool[idx];
    console.log('[VOICE ENGINE] elevenlabs voices:', pool.map(v => `${v.name}(${v.id.slice(0,8)})`).join(', '));
    console.log('[VOICE ENGINE] selected voice:', `${chosen.name} (${chosen.id}) accent:${chosen.accent} idx:${idx}`);
    return chosen;
}

/**
 * Canonicalise any nationality string Claude might return into the exact
 * keys used by ELEVENLABS_CATALOG and selectBrowserVoice() langMap.
 *
 * Uses substring matching so all realistic Claude variants resolve:
 *   "Italian" | "italy" | "Florentine" | "Tuscan" | "italiano" → "italian"
 *   "French"  | "france" | "Parisian"  | "provençal"           → "french"
 *   etc.
 *
 * @param {string} raw — raw nationality string from Claude or artwork metadata
 * @returns {string}   — canonical lowercase key, or "" if unrecognised
 */
function normalizeNationality(raw = '') {
    const v = raw.toLowerCase().trim();
    if (!v) return '';

    // ── Italian ──────────────────────────────────────────────────
    if (v.includes('ital') || v.includes('floren') || v.includes('tuscan') ||
        v.includes('veneti') || v.includes('roman') || v.includes('milane') ||
        v.includes('napol') || v.includes('sicil') || v.includes('genoes'))
        return 'italian';

    // ── French ───────────────────────────────────────────────────
    if (v.includes('fran') || v.includes('paris') || v.includes('proven') ||
        v.includes('normand') || v.includes('bretton') || v.includes('lyonn') ||
        v.includes('bourgu') || v.includes('gaul'))
        return 'french';

    // ── British ──────────────────────────────────────────────────
    if (v.includes('brit') || v.includes('english') || v.includes('scotland') ||
        v.includes('scottish') || v.includes('welsh') || v.includes('irish') ||
        v.includes('london') || v.includes('edinbu'))
        return 'british';

    // ── German / Germanic ────────────────────────────────────────
    if (v.includes('germ') || v.includes('pruss') || v.includes('bavari') ||
        v.includes('saxon') || v.includes('hanover') || v.includes('rhineland'))
        return 'german';

    // ── Spanish ──────────────────────────────────────────────────
    if (v.includes('span') || v.includes('castil') || v.includes('catalan') ||
        v.includes('andalu') || v.includes('madrid') || v.includes('sevill') ||
        v.includes('basque') || v.includes('aragon'))
        return 'spanish';

    // ── Dutch / Flemish ──────────────────────────────────────────
    if (v.includes('dutch') || v.includes('dutch') || v.includes('flemi') ||
        v.includes('nether') || v.includes('hollan') || v.includes('bruges') ||
        v.includes('ghent')  || v.includes('amsterdam'))
        return 'dutch';

    // ── Austrian ─────────────────────────────────────────────────
    if (v.includes('austri') || v.includes('vienna') || v.includes('wien') ||
        v.includes('habsbur'))
        return 'austrian';

    // ── Norwegian / Scandinavian ─────────────────────────────────
    if (v.includes('norweg') || v.includes('swedish') || v.includes('danish') ||
        v.includes('nordic') || v.includes('scandin') || v.includes('norse') ||
        v.includes('viking'))
        return 'norwegian';

    // ── Japanese ─────────────────────────────────────────────────
    if (v.includes('japan') || v.includes('kyoto') || v.includes('tokyo') ||
        v.includes('edo')   || v.includes('osaka'))
        return 'japanese';

    // ── Chinese ──────────────────────────────────────────────────
    if (v.includes('chines') || v.includes('china') || v.includes('beijing') ||
        v.includes('canton') || v.includes('shangh'))
        return 'chinese';

    // ── Korean ───────────────────────────────────────────────────
    if (v.includes('korea') || v.includes('seoul') || v.includes('joseon'))
        return 'korean';

    // ── Arabic / Middle Eastern ──────────────────────────────────
    if (v.includes('arab') || v.includes('persian') || v.includes('ottoman') ||
        v.includes('cairo') || v.includes('damasc') || v.includes('baghdad') ||
        v.includes('bagdad') || v.includes('istanbul'))
        return 'arabic';

    // ── North African ────────────────────────────────────────────
    // BUG FIX: added 'north afric' (with space) — Claude returns "North African"
    // with a space; the previous patterns only matched underscore/no-space variants.
    if (v.includes('north afric') || v.includes('north_afric') || v.includes('northafrican') ||
        v.includes('morocc') || v.includes('algeri') || v.includes('tunisi') ||
        v.includes('egypt') || v.includes('berber'))
        return 'north_african';

    // ── Central African ──────────────────────────────────────────
    // BUG FIX: added 'central afric' (with space) — same reason as north_african.
    if (v.includes('central afric') || v.includes('central_afric') || v.includes('centralafrican') ||
        v.includes('congol') || v.includes('senegal') || v.includes('nigeria') ||
        v.includes('subsahara') || v.includes('subsah'))
        return 'central_african';

    // ── American (last resort — explicit only) ───────────────────
    if (v.includes('americ') || v.includes('united states') || v.includes('usa') ||
        v.includes('new york') || v.includes('boston') || v.includes('chicago'))
        return 'american';

    // ── Greek / Hellenic ─────────────────────────────────────────
    // BUG FIX: _guessNationality() returns 'Greek' for El Greco; no entry existed,
    // causing '' → _browserLocaleMatchExists false → British ElevenLabs voice.
    if (v.includes('greek') || v.includes('greece') || v.includes('hellen') ||
        v.includes('athen') || v.includes('crete') || v.includes('byzant'))
        return 'greek';

    // Unrecognised — return empty so callers trigger default chain
    return '';
}
/**
 * Canonicalise any gender string into the exact key used by voice pools.
 *
 * Handles all variants Claude or artwork metadata might return:
 *   "Male" | "MALE" | "man" | "m" | "masculine" → "male"
 *   "Female" | "FEMALE" | "woman" | "f" | "feminine" | "femme" → "female"
 *   "unknown" | "" | null | "non-binary" | "neutral" → "" (no gender forced)
 *
 * NEVER defaults to "male" — an empty string lets the caller handle ambiguity.
 *
 * @param {string} raw — raw gender value from Claude JSON or metadata
 * @returns {"male"|"female"|""}
 */
function normalizeGender(raw = '') {
    const v = (raw || '').toLowerCase().trim();
    if (!v || v === 'unknown' || v === 'neutral' || v === 'non-binary' || v === 'nonbinary') return '';

    if (v === 'male'   || v === 'man'  || v === 'm'   ||
        v === 'masculine' || v === 'homme' || v === 'uomo' || v === 'hombre') return 'male';

    if (v === 'female' || v === 'woman' || v === 'f'  ||
        v === 'feminine' || v === 'femme' || v === 'donna' || v === 'mujer' ||
        v === 'girl'   || v === 'lady') return 'female';

    return '';
}





// ── Nationality → browser language codes ──────────────────────
/**
 * Find the best available SpeechSynthesisVoice matching nationality AND gender.
 *
 * Uses normalizeGender() so "woman", "f", "Female" all resolve correctly.
 * Gender search is ALWAYS locale-scoped — never searches all voices for gender
 * before checking locale (that would always return en-US on most devices).
 *
 * Priority:
 *   0. BCP-47 lang hint (from Claude `language` field) + gender   ← highest
 *   1. Exact locale + normalised gender
 *   2. Locale-root + normalised gender     (still locale-scoped)
 *   3. Exact locale, any gender
 *   4. Locale-root, any gender
 *   5. European artistic chain: Italian > British > French > Germanic
 *   6. en-GB before en-US                  (dramatic > neutral)
 *   7. Any English voice
 *   8. Absolute fallback
 *
 * @param {string} nationality — e.g. "French", "Italian", "North African"
 * @param {string} gender      — "male" | "female" | "" (unknown)
 * @param {string} [lang]      — BCP-47 hint from Claude e.g. "it", "fr", "ja"
 * @returns {SpeechSynthesisVoice | null}
 */
function selectBrowserVoice(nationality, gender, lang = '') {
    if (typeof speechSynthesis === 'undefined') return null;

    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;

    // ── Normalise using the same canonicalisers as the ElevenLabs path ────────
    const nat = normalizeNationality(nationality) || 'default';
    const g   = normalizeGender(gender);  // "male" | "female" | ""

    console.log('[VOICE RESOLUTION]', { engine: 'webspeech', raw_nationality: nationality, normalised_nationality: nat, raw_gender: gender, normalised_gender: g || '(unknown)' });

    // ── Locale codes per canonicalised nationality ─────────────────────────────
    const langMap = {
        french:          ['fr-FR', 'fr'],
        italian:         ['it-IT', 'it'],
        spanish:         ['es-ES', 'es-MX', 'es'],
        german:          ['de-DE', 'de'],
        british:         ['en-GB'],
        american:        ['en-US'],
        dutch:           ['nl-NL', 'nl'],
        austrian:        ['de-AT', 'de-DE', 'de'],
        norwegian:       ['nb-NO', 'no'],
        chinese:         ['zh-CN', 'zh-TW', 'zh'],
        japanese:        ['ja-JP', 'ja'],
        korean:          ['ko-KR', 'ko'],
        arabic:          ['ar-SA', 'ar'],
        north_african:   ['ar-MA', 'ar', 'fr-FR', 'fr'],
        central_african: ['fr-FR', 'fr', 'en-GB', 'en'],
        greek:           ['el-GR', 'el'],
        // Default: British before American — artistic direction
        default:         ['en-GB', 'en-US', 'en'],
    };

    // Known-female voice name fragments (browser TTS names, any locale)
    const FEMALE_NAMES = [
        'female', 'woman',
        'samantha', 'victoria', 'karen', 'moira', 'tessa', 'veena',
        'ting-ting', 'sin-ji', 'mei-jia', 'yuna', 'damayanti',
        'amelie', 'joana', 'paulina', 'monica', 'alice', 'anna',
        'sara', 'laura', 'zosia', 'ioana', 'milena',
        'zira', 'hazel', 'heera', 'sabina', 'hortense', 'helena',
        'mia', 'nora', 'satu', 'kanya', 'matilda',
        'eva', 'elsa', 'benedikte', 'julie', 'petra',
        'google uk english female', 'google us english female',
    ];

    // Known-male voice name fragments
    const MALE_NAMES = [
        'male', 'man',
        'alex', 'daniel', 'fred', 'tom', 'lee', 'diego',
        'jorge', 'felix', 'tarik', 'yannick', 'luca',
        'magnus', 'xander', 'stefan', 'rishi', 'eddy',
        'david', 'mark', 'james', 'george', 'pablo', 'ivan',
        'andika', 'naayf',
        'google uk english male', 'google us english male',
    ];

    const looksLike   = (v, tokens) => tokens.some(t => v.name.toLowerCase().includes(t));
    const isFemale    = v => looksLike(v, FEMALE_NAMES);
    const isMale      = v => looksLike(v, MALE_NAMES);
    const genderMatch = (v) => {
        if (g === 'female') return isFemale(v);
        if (g === 'male')   return isMale(v);
        return true;  // unknown — accept any
    };

    const langs = langMap[nat] || langMap['default'];

    // ── 0. BCP-47 lang hint (from Claude `language` field) ───────────────────
    // Claude returns e.g. "it", "fr", "ja" — more precise than nationality string.
    // Skipped for English roots (ElevenLabs handles those upstream).
    if (lang && lang.trim()) {
        const hintRoot = lang.toLowerCase().split('-')[0];
        if (hintRoot !== 'en') {
            if (g) {
                const v = voices.find(v => v.lang.toLowerCase().startsWith(hintRoot) && genderMatch(v));
                if (v) {
                    console.log('[VOICE RESOLUTION]', { engine: 'webspeech', lang_hint: lang, gender: g, selectedVoice: v.name, step: 'lang-hint+gender' });
                    return v;
                }
            }
            const v = voices.find(v => v.lang.toLowerCase().startsWith(hintRoot));
            if (v) {
                console.log('[VOICE RESOLUTION]', { engine: 'webspeech', lang_hint: lang, selectedVoice: v.name, step: 'lang-hint-any-gender' });
                return v;
            }
        }
    }

    // ── 1. Exact locale + correct gender ─────────────────────────────────────
    if (g) {
        for (const lc of langs) {
            const v = voices.find(v => v.lang === lc && genderMatch(v));
            if (v) {
                console.log('[VOICE RESOLUTION]', { engine: 'webspeech', nationality: nat, gender: g, selectedVoice: v.name, step: 'exact-locale+gender' });
                return v;
            }
        }
    }

    // ── 2. Locale-root + correct gender (still locale-scoped) ────────────────
    // CRITICAL: must remain locale-scoped — a global gender search returns
    // en-US voices first on almost every device.
    if (g) {
        for (const lc of langs) {
            const root = lc.split('-')[0];
            const v = voices.find(v => v.lang.startsWith(root) && genderMatch(v));
            if (v) {
                console.log('[VOICE RESOLUTION]', { engine: 'webspeech', nationality: nat, gender: g, selectedVoice: v.name, step: 'locale-root+gender' });
                return v;
            }
        }
    }

    // ── 3. Exact locale, any gender ───────────────────────────────────────────
    for (const lc of langs) {
        const v = voices.find(v => v.lang === lc);
        if (v) {
            console.warn('[VOICE FALLBACK]', { requested: `${nat}_${g || '(unknown)'}`, actual: v.name, step: 'exact-locale-any-gender' });
            return v;
        }
    }

    // ── 4. Locale-root, any gender ────────────────────────────────────────────
    for (const lc of langs) {
        const root = lc.split('-')[0];
        const v    = voices.find(v => v.lang.startsWith(root));
        if (v) {
            console.warn('[VOICE FALLBACK]', { requested: `${nat}_${g || '(unknown)'}`, actual: v.name, step: 'locale-root-any-gender' });
            return v;
        }
    }

    // ── 5. European artistic priority chain ───────────────────────────────────
    // Prefer gender match within each fallback locale before dropping gender.
    const europeanFallbacks = [
        { key: 'italian',  langs: ['it-IT', 'it']          },
        { key: 'british',  langs: ['en-GB']                 },
        { key: 'french',   langs: ['fr-FR', 'fr']           },
        { key: 'german',   langs: ['de-DE', 'de-AT', 'de']  },
    ];
    for (const { key, langs: fbLangs } of europeanFallbacks) {
        for (const lc of fbLangs) {
            const root = lc.split('-')[0];
            const vg = g ? voices.find(v => (v.lang === lc || v.lang.startsWith(root)) && genderMatch(v)) : null;
            const v  = vg || voices.find(v => v.lang === lc) || voices.find(v => v.lang.startsWith(root));
            if (v) {
                console.warn('[VOICE FALLBACK]', { requested: `${nationality}_${gender}`, actual: v.name, step: `european-chain-${key}` });
                return v;
            }
        }
    }

    // ── 6. en-GB before en-US (dramatic over neutral) ─────────────────────────
    const enGB = g
        ? voices.find(v => v.lang.startsWith('en-GB') && genderMatch(v)) || voices.find(v => v.lang.startsWith('en-GB'))
        : voices.find(v => v.lang === 'en-GB');
    if (enGB) {
        console.warn('[VOICE FALLBACK]', { requested: `${nationality}_${gender}`, actual: enGB.name, step: 'en-GB' });
        return enGB;
    }

    // ── 7. Any English voice ──────────────────────────────────────────────────
    const eng = g
        ? voices.find(v => v.lang.startsWith('en') && genderMatch(v)) || voices.find(v => v.lang.startsWith('en'))
        : voices.find(v => v.lang.startsWith('en'));
    if (eng) {
        console.warn('[VOICE FALLBACK]', { requested: `${nationality}_${gender}`, actual: eng.name, step: 'any-en' });
        return eng;
    }

    // ── 8. Absolute fallback — honour gender preference even here ────────────
    // Phase 5: the wrong gender is only acceptable as the very last resort.
    // Try gender match first; only then accept any available voice.
    const byGender8 = g ? voices.find(v => genderMatch(v)) : null;
    const chosen8   = byGender8 || voices[0] || null;
    console.warn('[VOICE FALLBACK]', {
        requested: `${nationality}_${gender}`,
        actual:    chosen8?.name,
        step:      byGender8 ? 'absolute-gender' : 'absolute-any',
    });
    return chosen8;
}


// ── Browser locale presence check ─────────────────────────────
/**
 * Returns true if the device has at least one speechSynthesis voice
 * whose locale matches the character's nationality or language hint.
 *
 * Uses the same langMap as selectBrowserVoice() for consistency.
 * Also accepts the Claude-output BCP-47 `lang` hint (e.g. "it", "fr")
 * as an override — it is more precise than inferring from nationality.
 *
 * @param {string}               nationality — e.g. "Italian", "French"
 * @param {string}               lang        — BCP-47 hint e.g. "it", "fr", "ja"
 * @param {SpeechSynthesisVoice[]} voices    — from speechSynthesis.getVoices()
 * @returns {boolean}
 */
function _browserLocaleMatchExists(nationality, lang, voices) {
    if (!voices || !voices.length) return false;

    // Language hint from Claude takes priority — direct root match
    if (lang && lang.trim()) {
        const root = lang.toLowerCase().split('-')[0];
        // Skip English — ElevenLabs is better quality for English narration
        if (root !== 'en') {
            return voices.some(v => v.lang.toLowerCase().startsWith(root));
        }
    }

    // Fall back to normalizeNationality → langMap
    const nat = normalizeNationality(nationality);
    if (!nat) return false;

    // English nationalities (British, American) → always prefer ElevenLabs quality
    if (nat === 'british' || nat === 'american') return false;

    const langMap = {
        french:          ['fr'],
        italian:         ['it'],
        spanish:         ['es'],
        german:          ['de'],
        dutch:           ['nl'],
        austrian:        ['de'],
        norwegian:       ['nb', 'no'],
        japanese:        ['ja'],
        chinese:         ['zh'],
        korean:          ['ko'],
        arabic:          ['ar'],
        north_african:   ['ar', 'fr'],
        central_african: ['fr'],
        greek:           ['el'],
    };

    const roots = langMap[nat];
    if (!roots) return false;

    return roots.some(root =>
        voices.some(v => v.lang.toLowerCase().startsWith(root))
    );
}

/**
 * Find the single best browser locale voice for a nationality + gender.
 * Used only for logging — actual voice selection is inside _makeSpeechHandle
 * via selectBrowserVoice(). This function gives a preview for the debug log.
 *
 * @param {string}               nationality
 * @param {string}               lang        — BCP-47 hint
 * @param {string}               gender
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {SpeechSynthesisVoice | null}
 */
function _findBestBrowserLocaleVoice(nationality, lang, gender, voices) {
    if (!voices || !voices.length) return null;

    // Try lang hint root first
    const root = lang ? lang.toLowerCase().split('-')[0] : null;
    if (root && root !== 'en') {
        const match = voices.find(v => v.lang.toLowerCase().startsWith(root));
        if (match) return match;
    }

    // Fall back to normalizeNationality path via selectBrowserVoice
    return selectBrowserVoice(nationality, gender);
}


// ── Active Web Audio source singleton ─────────────────────────
let _activeSource   = null;
let _activeSpeech   = null;

// ── In-flight ElevenLabs fetch abort controller ────────────────
// Module-level so stopAll() can abort the fetch even before the
// Audio object methods execute (e.g. called from GlobalExitButton).
// Reset to null after each fetch completes or is aborted.
let _activeTTSAbortController = null;

function _stopActiveSource() {
    if (_activeSource) {
        try { _activeSource.stop(0); } catch (_) {}
        _activeSource = null;
    }
}

function _stopActiveSpeech() {
    if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
    }
    _activeSpeech = null;
}

function _stopAll() {
    _stopActiveSource();
    _stopActiveSpeech();
}

// ── Cinematic on-screen message helpers ───────────────────────
function _showVoiceMessage(text) {
    const existingId = 'lore-voice-message';
    const existing   = document.getElementById(existingId);
    if (existing) existing.remove();

    const el = document.createElement('p');
    el.id = existingId;
    el.textContent = text;
    el.style.cssText = `
        position: fixed;
        bottom: 18%;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-style: italic;
        font-size: clamp(0.9rem, 3vw, 1.1rem);
        color: rgba(201,169,110,0.75);
        opacity: 0;
        transition: opacity 1.4s ease;
        pointer-events: none;
        z-index: 9000;
        text-align: center;
        white-space: nowrap;
    `;
    document.body.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
    return el;
}

function _removeVoiceMessage() {
    const el = document.getElementById('lore-voice-message');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 1500);
}

// ──────────────────────────────────────────────────────────────
// MAIN EXPORT
// ──────────────────────────────────────────────────────────────

export const Audio = {

    stopAll() {
        // ── 1. Abort any in-flight ElevenLabs fetch ────────────────────────
        // Must fire FIRST — before touching WebAudio nodes — so the fetch
        // rejects immediately and cannot produce an orphan handle.
        // Idempotent: safe to call multiple times.
        if (_activeTTSAbortController) {
            _activeTTSAbortController.abort();
            _activeTTSAbortController = null;
        }
        // ── 2. Stop WebAudio source + speechSynthesis ──────────────────────
        _stopAll();
        // ── 3. Stop any active handle (sets _stopped=true, resolves audioEndPromise) ─
        if (State.activeAudioHandle?.stop) State.activeAudioHandle.stop();
    },

    /**
     * Produce a voice handle for the given narration text.
     *
     * TWO-LAYER ARCHITECTURE:
     *   Layer 1 — Character identity (nationality, language) drives browser voice locale.
     *   Layer 2 — Engine reality: only real voices are used.
     *
     * Priority:
     *   1. Browser TTS  (if a matching locale voice exists for this nationality)
     *      → Real linguistic accent — it-IT, fr-FR, ja-JP, de-DE, ar-SA, etc.
     *      → Preferred for ALL non-English nationalities.
     *
     *   2. ElevenLabs   (if no browser locale voice, and key is present)
     *      → British/American voices only (confirmed-working IDs).
     *      → Selected by gender only — no fake nationality mapping.
     *
     *   3. Browser TTS  (catch-all after ElevenLabs failure, any available voice)
     *
     *   4. Cannot Return (speechSynthesis entirely unavailable)
     *
     * @param {string}      text      — narration text
     * @param {object|null} artwork   — artwork context { nationality, ... }
     * @param {object|null} narrative — Claude character JSON { nationality, gender, language, ... }
     * @returns {Promise<AudioHandle>}
     */
    async speak(text, artwork, narrative = null) {
        _stopAll();

        if (!text || !text.trim()) {
            console.warn('[Audio] speak() called with empty text — using cannot-return handle.');
            return _makeCannotReturnHandle('');
        }

        const cleanText = sanitizeNarration(text);
        if (!cleanText) {
            console.warn('[Audio] speak() — text empty after sanitization — using cannot-return handle.');
            return _makeCannotReturnHandle('');
        }

        const nat         = narrative?.nationality || artwork?.nationality || '';
        const lang        = narrative?.language   || '';   // BCP-47 hint from Claude e.g. "it", "fr"
        const genderRaw   = narrative?.gender     || '';
        // BUG FIX: normalise gender at source so all downstream paths receive a
        // canonical value; previously 'unknown' (truthy) passed through unnormalised.
        const gender      = normalizeGender(genderRaw);
        const artworkSeed = artwork?.id || artwork?.title || '';

        // Structured routing log — one entry per speak() call, all decisions visible
        console.log('[VOICE ROUTING]', {
            nationalityOriginal:  nat,
            nationalityNormalized: normalizeNationality(nat) || '(unmapped→default)',
            genderOriginal:   genderRaw,
            genderNormalized: gender || '(unknown)',
            lang:             lang   || '(none)',
            artworkSeed:      artworkSeed || '(none)',
        });

        // ── Log available browser locales ─────────────────────────────────────
        const browserVoices = (typeof speechSynthesis !== 'undefined')
            ? speechSynthesis.getVoices()
            : [];
        const availableLocales = [...new Set(browserVoices.map(v => v.lang))].sort();
        console.log('[VOICE ENGINE] browser voices:', availableLocales.length
            ? availableLocales.join(', ')
            : '(none loaded yet)');

        // ── Determine if browser has a locale voice for this character ────────
        // A "locale match" means the device has at least one voice for the
        // language/region of this nationality — e.g. it-IT for Italian.
        // This check is SYNCHRONOUS on first call (voices may not be loaded yet).
        // If voices are not yet loaded we skip to ElevenLabs; the browser
        // voices will be ready by the time play() is called.
        const hasBrowserLocale = browserVoices.length > 0
            && _browserLocaleMatchExists(nat, lang, browserVoices);

        if (hasBrowserLocale) {
            // ── PATH A: Browser locale voice — real linguistic accent ─────────
            const matched = _findBestBrowserLocaleVoice(nat, lang, gender, browserVoices);
            console.log('[VOICE ENGINE] mode: browser');
            console.log('[VOICE ENGINE] selected voice:', matched
                ? `${matched.name} (${matched.lang})`
                : '(browser default)');
            return _makeSpeechHandle(cleanText, nat, gender, lang);
        }

        // ── PATH B: ElevenLabs (English-only fallback) ────────────────────────
        const key = getElevenLabsKey();
        console.log('[VOICE ENGINE] no browser locale voice for nationality:', nat || '(unknown)',
            '→', key ? 'trying ElevenLabs' : 'no key, going to browser TTS');

        if (key) {
            const voice = _getElevenLabsVoice(gender, artworkSeed);
            console.log('[VOICE ENGINE] mode: elevenlabs');
            // Create a fresh AbortController for this fetch — stored at module-level
            // so stopAll() can cancel it immediately if the user exits during the request.
            const abortCtrl = new AbortController();
            _activeTTSAbortController = abortCtrl;
            try {
                const handle = await this._fetchFromElevenLabs(cleanText, voice.id, key, abortCtrl.signal);
                console.log('[Audio] ElevenLabs succeeded — duration:', handle.duration?.toFixed(1) + 's');
                return handle;
            } catch (err) {
                if (err.name === 'AbortError') {
                    // User intentionally exited — silent cancellation, no UI modal, no retry.
                    console.log('[EXIT ABORT] ElevenLabs fetch aborted by exit signal.');
                    throw err;  // propagate so runExperience abort-guard catches it
                }
                console.warn('[Audio] ElevenLabs failed:', err.message, '→ falling back to browser TTS');
            } finally {
                // Clear the ref whether we succeeded, failed, or were aborted.
                if (_activeTTSAbortController === abortCtrl) {
                    _activeTTSAbortController = null;
                }
            }
        }

        // ── PATH C: Browser TTS (catch-all, any available voice) ─────────────
        if (typeof speechSynthesis !== 'undefined') {
            console.log('[VOICE ENGINE] mode: browser (catch-all fallback)');
            console.log('[VOICE ENGINE] selected voice: (best available for', nat || 'unknown', gender || 'unknown gender', ')');
            return _makeSpeechHandle(cleanText, nat, gender, lang);
        }

        // ── PATH D: Cannot Return ─────────────────────────────────────────────
        console.error('[Audio] speechSynthesis unavailable — using cannot-return mode.');
        return _makeCannotReturnHandle(cleanText);
    },

    // ── ElevenLabs fetch (no retry) ───────────────────────────
    async _fetchFromElevenLabs(text, voiceId, key, signal = null) {
        console.log('[ElevenLabs] Request started — voice:', voiceId);
        const response = await fetch(`${ELEVENLABS_ENDPOINT}/${voiceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept':       'audio/mpeg',
                'xi-api-key':   key,
            },
            body: JSON.stringify({
                text,
                model_id:      'eleven_multilingual_v2',
                output_format: 'mp3_44100_128',
                voice_settings: {
                    stability:         0.45,
                    similarity_boost:  0.8,
                    style:             0.65,
                    use_speaker_boost: true,
                },
            }),
            ...(signal ? { signal } : {}),
        });

        console.log('[ElevenLabs] Response status:', response.status, response.statusText);

        // Accept ONLY HTTP 200 — 402 means paid-plan-only voice; 4xx/5xx → speech fallback
        if (response.status !== 200) {
            const body = await response.text();
            console.warn('[ElevenLabs] Non-200 response — not retrying. Body:', body.slice(0, 120));
            throw new Error(`ElevenLabs HTTP ${response.status} — routing to speechSynthesis`);
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log('[ElevenLabs] Voice blob received —', (arrayBuffer.byteLength / 1024).toFixed(1), 'KB');

        if (arrayBuffer.byteLength < 100) {
            throw new Error(`ElevenLabs response too small (${arrayBuffer.byteLength} bytes)`);
        }

        const ctx = AudioUnlock.getContext();
        if (!ctx) throw new Error('[Audio] AudioContext not available.');

        if (ctx.state !== 'running') {
            console.warn('[Audio] Context suspended — resuming before decode…');
            await ctx.resume();
            console.log('[Audio] Context after resume:', ctx.state);
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        console.log('[Audio] decodeAudioData complete — duration:', audioBuffer.duration.toFixed(2) + 's');

        return this._makeWebAudioHandle(audioBuffer);
    },

    // ── Web Audio handle (ElevenLabs mode) ───────────────────
    _makeWebAudioHandle(audioBuffer) {
        return {
            mode:        'elevenlabs',
            duration:    audioBuffer.duration,
            audioBuffer,
            async play(analyserNode = null) {
                const ctx = AudioUnlock.getContext();
                console.log('[Audio] play() — AudioContext state:', ctx.state);

                if (ctx.state !== 'running') {
                    await ctx.resume();
                    console.log('[Audio] Context after resume:', ctx.state);
                }

                _stopActiveSource();

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;

                // Route: source → analyserNode (for waveform data) → voiceBus → masterGain → destination
                // analyserNode is a pass-through: it reads amplitude without blocking signal flow.
                const voiceBus = AudioMixer.getVoiceBus();
                if (analyserNode) {
                    source.connect(analyserNode);
                    analyserNode.connect(voiceBus);
                } else {
                    source.connect(voiceBus);
                }

                source.start(0);
                _activeSource = source;
                AudioMixer.onVoiceStart();
                console.log('[Audio] ▶ ElevenLabs playback started —', audioBuffer.duration.toFixed(1) + 's');

                source.onended = () => {
                    if (_activeSource === source) _activeSource = null;
                    AudioMixer.onVoiceEnd();
                    console.log('[Audio] ■ ElevenLabs playback ended.');
                };
            },
            stop() {
                _stopActiveSource();
                console.log('[Audio] ■ ElevenLabs playback stopped.');
            },
        };
    },

    // ── Analyser creation (for ElevenLabs mode only) ─────────
    createAnalyser() {
        const ctx = AudioUnlock.getContext();
        if (!ctx) {
            console.warn('[Audio] createAnalyser: AudioContext not available.');
            return null;
        }
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        // DO NOT connect analyser to destination here — the ElevenLabs play()
        // method connects it inline: source → analyser → voiceBus → masterGain.
        // Connecting here would create a duplicate, unmixed output path.
        return analyser;
    },

    // ── 5-bar waveform ─────────────────────────────────────
    /**
     * Animate 5 vertical bars.
     *
     * THREE rendering modes (selected automatically):
     *
     * 1. ElevenLabs (analyserNode set)
     *    — Real frequency data from Web Audio API AnalyserNode.
     *
     * 2. Speech timeline (speechContext set)
     *    — No audio signal exists.  Amplitude is computed from a pre-built
     *      timeline of segment emotion weights, a 4-phase envelope over the
     *      full narration arc, and punctuation spike events.
     *      Waveform starts exactly when first utterance.onstart fires,
     *      dims during inter-segment breath pauses, and decays on end.
     *
     * 3. Organic fallback (both null)
     *    — Simple multi-sine idle animation for cannot-return mode.
     *
     * @param {HTMLElement}       container
     * @param {AnalyserNode|null} analyserNode  — non-null for ElevenLabs mode
     * @param {SpeechContext|null} speechContext — non-null for speech mode
     * @returns {function} stop — call to halt and decay bars
     */
    draw5BarWaveform(container, analyserNode = null, speechContext = null) {
        container.innerHTML = '';
        container.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            height: 60px;
        `;

        // ── Build bars ──
        const BAR_W    = 4;
        const BAR_MIN  = 4;
        const BAR_MAX  = 54;
        const GOLD     = '201,169,110';

        const bars = Array.from({ length: 5 }, (_, i) => {
            const bar = document.createElement('div');
            bar.style.cssText = `
                width: ${BAR_W}px;
                min-height: ${BAR_MIN}px;
                height: ${BAR_MIN}px;
                background: rgb(${GOLD});
                border-radius: 2px;
                will-change: height, box-shadow;
                transform-origin: center bottom;
            `;
            container.appendChild(bar);
            return bar;
        });

        let animId;
        let stopped = false;

        // ── ElevenLabs mode (real signal) ─────────────────────
        if (analyserNode) {
            const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
            const draw = () => {
                if (stopped) return;
                analyserNode.getByteFrequencyData(dataArray);
                const bucket = Math.floor(dataArray.length / 5);
                bars.forEach((bar, i) => {
                    let sum = 0;
                    for (let j = i * bucket; j < (i + 1) * bucket; j++) sum += dataArray[j];
                    const energy = sum / bucket / 255;
                    const h = BAR_MIN + energy * (BAR_MAX - BAR_MIN);
                    bar.style.height = `${h}px`;
                    bar.style.boxShadow = `0 0 ${3 + energy * 10}px rgba(${GOLD},${(0.2 + energy * 0.65).toFixed(2)})`;
                });
                animId = requestAnimationFrame(draw);
            };
            draw();
            return _makeStopFn(bars, () => { stopped = true; cancelAnimationFrame(animId); });
        }

        // ── Speech timeline mode (no audio signal) ────────────
        if (speechContext) {
            const { timeline, totalDurationMs, spikeEvents, notifyWaveformReady } = speechContext;

            let waveformStartTime = null;
            let speechEnded       = false;
            let decayStart        = null;

            // Register callbacks — _runQueue will call these
            speechContext.onWaveformStart = () => {
                waveformStartTime = performance.now();
                console.log('[Waveform] ▶ Speech started — timeline animation begins.');
            };
            speechContext.onWaveformEnd = () => {
                speechEnded = true;
                decayStart  = performance.now();
                console.log('[Waveform] ■ Speech ended — beginning decay.');
            };
            speechContext.onWaveformSegment = (segIdx) => {
                // No-op here — timeline positions are already pre-computed
                void segIdx;
            };

            // Notify the handle that the waveform is wired up
            if (typeof notifyWaveformReady === 'function') notifyWaveformReady();

            // ── Phase envelope ──────────────────────────────────
            // Maps global progress [0..1] → amplitude multiplier [0..1]
            function phaseAmplitude(p) {
                if (p < 0.20) return 0.20 + (p / 0.20) * 0.28;          // intro: 0.20→0.48
                if (p < 0.70) return 0.48 + ((p - 0.20) / 0.50) * 0.44; // dynamic: 0.48→0.92
                if (p < 0.90) return 0.92 + ((p - 0.70) / 0.20) * 0.08; // peak: 0.92→1.00
                return Math.max(0, 1.00 - ((p - 0.90) / 0.10));          // decay: 1.00→0
            }

            // ── Segment lookup ──────────────────────────────────
            // Returns segment weight + whether we're in a breath-pause gap.
            function getSegmentState(elapsedMs) {
                for (let i = 0; i < timeline.length; i++) {
                    const seg = timeline[i];
                    if (elapsedMs >= seg.tStart && elapsedMs < seg.tEnd) {
                        return { weight: seg.weight, inPause: false, segProgress: (elapsedMs - seg.tStart) / (seg.tEnd - seg.tStart) };
                    }
                    // Check if we're in the pause AFTER this segment
                    const nextStart = timeline[i + 1]?.tStart ?? Infinity;
                    if (elapsedMs >= seg.tEnd && elapsedMs < nextStart) {
                        const pauseLen = nextStart - seg.tEnd;
                        const pauseProg = (elapsedMs - seg.tEnd) / pauseLen;
                        return { weight: seg.weight * (1 - pauseProg * 0.7), inPause: true, segProgress: 1 };
                    }
                }
                return { weight: 0.3, inPause: false, segProgress: 0 };
            }

            // ── Spike lookup ────────────────────────────────────
            // Returns a 0..0.65 boost if now is within a spike window.
            function getSpikeBoost(elapsedMs) {
                let boost = 0;
                for (const ev of spikeEvents) {
                    const dt = elapsedMs - ev.timeMs;
                    if (dt >= 0 && dt < ev.durationMs) {
                        const progress = dt / ev.durationMs;
                        // Fast rise, slow decay
                        const envelope = progress < 0.2
                            ? progress / 0.2
                            : 1 - ((progress - 0.2) / 0.8);
                        boost = Math.max(boost, ev.intensity * envelope);
                    }
                }
                return boost;
            }

            // ── Decay out after speech ends ─────────────────────
            const DECAY_MS = 1200;

            // ── Frame loop ──────────────────────────────────────
            const draw = () => {
                if (stopped) return;
                const now = performance.now();

                // Pre-start: idle gentle breathing until speech begins
                if (waveformStartTime === null) {
                    const t = now * 0.0018;
                    bars.forEach((bar, i) => {
                        const v = Math.sin(t + i * 1.2) * 0.25 + 0.3;
                        bar.style.height = `${BAR_MIN + v * 10}px`;
                        bar.style.boxShadow = `0 0 3px rgba(${GOLD},0.15)`;
                    });
                    animId = requestAnimationFrame(draw);
                    return;
                }

                const elapsed  = now - waveformStartTime;
                const globalP  = Math.min(1, elapsed / totalDurationMs);
                const phaseMul = phaseAmplitude(globalP);

                // After speech: decay bars to stillness
                if (speechEnded) {
                    const decayP = Math.min(1, (now - decayStart) / DECAY_MS);
                    const fade   = 1 - decayP;
                    bars.forEach((bar, i) => {
                        const t = now * 0.001;
                        const v = Math.sin(t + i * 0.9) * 0.15 + 0.15;
                        const h = BAR_MIN + v * 8 * fade;
                        bar.style.height = `${h}px`;
                        bar.style.boxShadow = `0 0 ${2 * fade}px rgba(${GOLD},${(0.1 * fade).toFixed(2)})`;
                    });
                    if (decayP < 1) animId = requestAnimationFrame(draw);
                    return;
                }

                const { weight, inPause, segProgress } = getSegmentState(elapsed);
                const spikeBoost = getSpikeBoost(elapsed);

                // Global energy level this frame
                const baseEnergy = phaseMul * weight * (inPause ? 0.28 : 1.0);

                bars.forEach((bar, i) => {
                    const t = now * 0.001;

                    // Primary oscillator — each bar has a slightly different frequency
                    const freq  = 1.8 + i * 0.38;
                    const phase = i * 1.15;
                    const primary = Math.sin(t * freq + phase);

                    // Tremor — micro-variation layer
                    const tremor = Math.sin(t * (5.2 + i * 1.1) + i * 0.7) * 0.14;

                    // Intra-segment swell — builds during the segment, peaks near end
                    const swell = 0.85 + Math.sin(segProgress * Math.PI) * 0.15;

                    // Combine signal
                    const signal = (primary * 0.7 + tremor) * swell;
                    const raw    = Math.abs(signal);

                    // Apply energy + spike
                    const energy = Math.min(1, raw * baseEnergy + spikeBoost * (0.5 + Math.random() * 0.5));

                    const h     = BAR_MIN + energy * (BAR_MAX - BAR_MIN);
                    const glow  = (0.15 + energy * 0.60).toFixed(2);
                    const glowR = (3 + energy * 12).toFixed(1);

                    bar.style.height    = `${h}px`;
                    bar.style.boxShadow = `0 0 ${glowR}px rgba(${GOLD},${glow})`;
                });

                animId = requestAnimationFrame(draw);
            };

            draw();
            return _makeStopFn(bars, () => { stopped = true; cancelAnimationFrame(animId); });
        }

        // ── Organic fallback (cannot-return mode) ─────────────
        const draw = () => {
            if (stopped) return;
            const t       = Date.now() * 0.0022;
            const offsets = [0, 1.3, 2.6, 3.9, 5.2];
            bars.forEach((bar, i) => {
                const v = (Math.sin(t + offsets[i]) * 0.5 + 0.5)
                        * (Math.cos(t * 0.7 + offsets[i] * 0.5) * 0.3 + 0.7);
                const h   = BAR_MIN + v * 36;
                bar.style.height    = `${h}px`;
                bar.style.boxShadow = `0 0 4px rgba(${GOLD},${(0.10 + v * 0.20).toFixed(2)})`;
            });
            animId = requestAnimationFrame(draw);
        };
        draw();
        return _makeStopFn(bars, () => { stopped = true; cancelAnimationFrame(animId); });
    },

    /** Legacy canvas waveform — kept for backward compatibility. */
    drawWaveform(canvas) {
        const ctx = canvas.getContext('2d');
        let animId;
        let stopped = false;

        const draw = () => {
            if (stopped) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.beginPath();
            ctx.strokeStyle = '#C9A96E';
            ctx.lineWidth   = 1.5;

            const t   = Date.now() * 0.004;
            const mid = canvas.height / 2;

            for (let x = 0; x < canvas.width; x++) {
                const p = Math.sin(x * 0.045 + t) * 18;
                const s = Math.sin(x * 0.02  + t * 1.3) * 9;
                const q = Math.cos(x * 0.07  + t * 0.7) * 5;
                x === 0 ? ctx.moveTo(x, mid + p + s + q) : ctx.lineTo(x, mid + p + s + q);
            }
            ctx.stroke();
            animId = requestAnimationFrame(draw);
        };

        draw();

        return function stop() {
            stopped = true;
            cancelAnimationFrame(animId);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
    },
};

// ── Waveform stop helper ───────────────────────────────────────
/**
 * Returns a stop function that halts the animation and smoothly decays
 * all bars to their minimum height.
 */
function _makeStopFn(bars, cancelAnim) {
    return function stop() {
        cancelAnim();
        bars.forEach(bar => {
            bar.style.height    = '4px';
            bar.style.boxShadow = 'none';
        });
    };
}

// ── Speech handle factory ──────────────────────────────────────
/**
 * Build an audioHandle backed by the Web Speech API.
 *
 * The narration text is parsed into a sequence of Segments — each a short
 * spoken phrase with individual rate, pitch, volume, and surrounding pauses.
 * This makes the delivery feel like "a living witness from the past" rather
 * than flat TTS.
 *
 * play()  — fires the segment queue asynchronously, returns immediately.
 *           flowController awaits audioHandle.audioEndPromise for TRUE completion.
 * stop()  — cancels the queue and current utterance mid-speech.
 * duration — estimated total seconds, computed from segment tree.
 *
 * @param {string} text        — full narration text
 * @param {string} nationality — character's nationality
 * @param {string} gender      — "male" | "female" | "" (unknown)
 * @param {string} [lang]      — BCP-47 language hint from Claude (e.g. "it", "fr", "ja")
 * @returns {AudioHandle}
 */
function _makeSpeechHandle(text, nationality, gender = '', lang = '') {

    // ── 1. NATIONALITY VOICE STYLE ──────────────────────────────
    // Base rates: 1.03–1.08 for non-emotional segments (spec: min 1.03, max 1.10).
    // Emotion detection (§2) always overrides downward via Math.min —
    // so climax/grief/witness slowdowns are NEVER compressed.
    // Pauses (pauseBefore, pauseAfter) are HALVED vs earlier versions for
    // a more fluid, intimate, museum-friendly pacing.
    const NAT_STYLES = {
        french:          { rate: 1.04, pitch: 0.88, breathMs: 325, sentencePause: 375 },
        italian:         { rate: 1.06, pitch: 0.96, breathMs: 190, sentencePause: 240 },
        spanish:         { rate: 1.07, pitch: 0.97, breathMs: 180, sentencePause: 230 },
        german:          { rate: 1.04, pitch: 0.88, breathMs: 280, sentencePause: 320 },
        british:         { rate: 1.05, pitch: 0.92, breathMs: 245, sentencePause: 280 },
        dutch:           { rate: 1.05, pitch: 0.90, breathMs: 250, sentencePause: 290 },
        austrian:        { rate: 1.04, pitch: 0.89, breathMs: 270, sentencePause: 305 },
        norwegian:       { rate: 1.04, pitch: 0.90, breathMs: 260, sentencePause: 300 },
        arabic:          { rate: 1.03, pitch: 0.84, breathMs: 390, sentencePause: 430 },
        north_african:   { rate: 1.03, pitch: 0.86, breathMs: 360, sentencePause: 400 },
        central_african: { rate: 1.04, pitch: 0.88, breathMs: 325, sentencePause: 365 },
        chinese:         { rate: 1.05, pitch: 0.90, breathMs: 300, sentencePause: 340 },
        japanese:        { rate: 1.04, pitch: 0.89, breathMs: 320, sentencePause: 360 },
        korean:          { rate: 1.04, pitch: 0.90, breathMs: 290, sentencePause: 330 },
        american:        { rate: 1.06, pitch: 0.92, breathMs: 220, sentencePause: 260 },
        default:         { rate: 1.05, pitch: 0.90, breathMs: 250, sentencePause: 290 },
    };

    const nat   = (nationality || '').toLowerCase().replace(/[\s-]+/g, '_');
    const style = NAT_STYLES[nat] || NAT_STYLES['default'];

    // ── 2. EMOTION WORD TABLES ──────────────────────────────────
    // Groups drive per-segment rate/pitch/pause modifications.
    // Only lowercased test; match is substring so "remembered" matches "remember".

    // Confession / witness memory → slow + lower pitch
    const WITNESS_TOKENS   = ['i saw','i remember','i was there','i never','i told no','i should not','i was in','i swear','i confess'];
    // Grief / longing / fear → slower, more breath
    const GRIEF_TOKENS     = ['grief','wept','cried','tears','died','death','alone','silence','dark','shadow','abandoned','lost','guilt','afraid','fear','tremb'];
    // Tender / intimate → softer, slightly slower
    const TENDER_TOKENS    = ['beautiful','gentle','tender','soft','quiet','delicate','fragile','whisper','longing','love','beloved'];
    // Climax / violence / horror → dramatic slow
    const CLIMAX_TOKENS    = ['war','terror','terrible','horrible','murder','executed','condemned','destroyed','burned','blood','scream','rage','defiant','burning'];

    // ── 3. TEXT SEGMENTATION ────────────────────────────────────
    /**
     * Split narration into spoken segments.
     *
     * Rules:
     *   "..."   → ellipsis pause (1 000ms after) + very slow rate
     *   "."     → sentence boundary → breath pause (breathMs after)
     *   "!"     → exclamation → sentence pause + micro silence before next
     *   "?"     → question → slightly longer pause
     *   ","     → clause boundary → short pause (250–350ms after)
     *   "—"     → em-dash → medium pause (400ms) — common in literary speech
     *
     * Segment shape:
     * {
     *   text:         string   — clean text to speak
     *   rate:         number   — utterance rate (0.65–0.95)
     *   pitch:        number   — utterance pitch (0.80–1.00)
     *   volume:       number   — utterance volume (0.75–1.00)
     *   pauseBefore:  number   — ms silence BEFORE speaking
     *   pauseAfter:   number   — ms silence AFTER speaking (breath)
     * }
     */
    function parseSegments(rawText) {
        if (!rawText || !rawText.trim()) return [];

        // Count total exclamations to detect "climax density"
        const exclCount = (rawText.match(/!/g) || []).length;

        // ── Split on hard sentence boundaries first ──
        // Keep the delimiter attached as meta so we know what caused the split.
        // Strategy: replace delimiters with a sentinel, then split.
        const prepared = rawText
            .replace(/\.{3}/g, '…')           // normalise ellipsis
            .replace(/([.!?…])\s+/g, '$1\n')  // sentence breaks → newline
            .replace(/([,—])\s+/g, '$1|');     // clause breaks → pipe

        const rawSegments = [];

        for (const sentence of prepared.split('\n')) {
            if (!sentence.trim()) continue;

            // Clause-level split within the sentence
            const clauses = sentence.split('|');
            clauses.forEach((clause, clauseIdx) => {
                const isLastClause = clauseIdx === clauses.length - 1;

                // Trim + strip leading delimiter
                let cleanText = clause.replace(/^[,—]+/, '').trim();
                if (!cleanText) return;

                // Detect trailing delimiter (what ended this segment)
                const endsWithEllipsis   = cleanText.endsWith('…');
                const endsWithExclaim    = cleanText.endsWith('!');
                const endsWithQuestion   = cleanText.endsWith('?');
                const endsWithSentence   = cleanText.endsWith('.') || endsWithEllipsis || endsWithExclaim || endsWithQuestion;
                const endsWithComma      = clause.endsWith(',');
                const endsWithDash       = clause.endsWith('—');

                // Remove trailing delimiter from spoken text to avoid TTS reading it weirdly
                cleanText = cleanText.replace(/[…,—]$/, '').trim();
                if (!cleanText) return;

                const lower = cleanText.toLowerCase();

                // ── Base values from nationality style ──
                let rate   = style.rate;
                let pitch  = style.pitch;
                let volume = 1.0;
                let pauseBefore = 0;
                let pauseAfter  = 0;

                // ── Emotion detection — applied cumulatively ──
                const isWitness = WITNESS_TOKENS.some(t => lower.includes(t));
                const isGrief   = GRIEF_TOKENS.some(t => lower.includes(t));
                const isTender  = TENDER_TOKENS.some(t => lower.includes(t));
                const isClimax  = CLIMAX_TOKENS.some(t => lower.includes(t));

                if (isWitness) {
                    // Confession moment — slow, lower pitch, brief breath before
                    rate        = Math.min(rate, 0.75);
                    pitch       = Math.min(pitch, 0.85);
                    pauseBefore = Math.max(pauseBefore, 110);
                }
                if (isGrief) {
                    // Grief / loss — even slower, slight volume dip, brief breath after
                    rate        = Math.min(rate, 0.78);
                    pitch       = Math.min(pitch, 0.84);
                    volume      = 0.90;
                    pauseAfter  = Math.max(pauseAfter, 140);
                }
                if (isTender) {
                    // Tender / intimate — soft and slow
                    rate        = Math.min(rate, 0.82);
                    pitch       = Math.min(pitch, 0.88);
                    volume      = 0.88;
                }
                if (isClimax) {
                    // Dramatic climax — slowest, lowest pitch, full volume
                    rate        = Math.min(rate, 0.68);
                    pitch       = Math.min(pitch, 0.82);
                    volume      = 1.0;
                    pauseBefore = Math.max(pauseBefore, 150);
                    pauseAfter  = Math.max(pauseAfter, 175);
                }

                // ── High exclamation density — micro pause before each sentence start ──
                if (exclCount >= 3 && isLastClause) {
                    pauseBefore = Math.max(pauseBefore, 90);
                }

                // ── Pause AFTER based on punctuation type ──
                if (endsWithEllipsis) {
                    // Ellipsis — brief dramatic pause + slightly softer
                    pauseAfter  = Math.max(pauseAfter, 500);
                    rate        = Math.min(rate, 0.72);
                    volume      = Math.min(volume, 0.88);
                } else if (isLastClause && (endsWithSentence || endsWithExclaim || endsWithQuestion)) {
                    // End of sentence — breath pause
                    const jitter  = Math.floor(Math.random() * 60);
                    pauseAfter   = Math.max(pauseAfter, style.breathMs + jitter);
                } else if (endsWithComma || endsWithDash || !isLastClause) {
                    // Clause break — short pause
                    const jitter = Math.floor(Math.random() * 40);
                    pauseAfter   = Math.max(pauseAfter, 130 + jitter);
                }

                rawSegments.push({ text: cleanText, rate, pitch, volume, pauseBefore, pauseAfter });
            });
        }

        return rawSegments;
    }

    // ── 4. DURATION ESTIMATE ────────────────────────────────────
    // Estimate total playback time in seconds from segment tree.
    // Word-rate assumes 130 wpm base × utterance rate scaling.
    function estimateDuration(segments) {
        let totalMs = 0;
        for (const seg of segments) {
            const words      = seg.text.split(/\s+/).filter(Boolean).length;
            const speechMs   = (words / (130 * seg.rate)) * 60000;
            totalMs += seg.pauseBefore + speechMs + seg.pauseAfter;
        }
        return Math.max(15, Math.round(totalMs / 1000));
    }

    const segments    = parseSegments(text);
    const estDuration = estimateDuration(segments);

    console.log(`[Speech] Parsed ${segments.length} segments — estimated ${estDuration}s | nationality:"${nationality}"`);

    // ── 5. SPEECH CONTEXT — wired to waveform controller ─────────
    // Builds the timeline (pre-computed from segments) and punctuation spike
    // event list that draw5BarWaveform uses to drive the visual.
    // Waveform registers its onWaveformStart/onWaveformEnd callbacks here.
    const totalDurationMs = estDuration * 1000;

    // Build timeline: each segment gets absolute tStart/tEnd + emotion weight.
    const timeline = (function buildTimeline() {
        let cursor = 0;
        return segments.map((seg) => {
            const words    = seg.text.split(/\s+/).filter(Boolean).length;
            const speechMs = (words / (130 * seg.rate)) * 60000;

            // Emotion weight: maps segment characteristics to a 0.3–1.0 value
            const isClimax  = seg.rate <= 0.70;
            const isGrief   = seg.rate <= 0.80 && !isClimax;
            const isTender  = seg.volume < 0.95;
            const weight    = isClimax ? 1.00 : isGrief ? 0.80 : isTender ? 0.65 : 0.50;

            const tStart = cursor + seg.pauseBefore;
            const tEnd   = tStart + speechMs;
            cursor       = tEnd + seg.pauseAfter;

            return { tStart, tEnd, weight };
        });
    }());

    // Build punctuation spikes: scan text for high-energy punctuation and map
    // to approximate absolute times within the timeline.
    const spikeEvents = (function buildSpikes() {
        const events = [];
        let charCursor = 0;
        const totalChars = text.length;

        for (let ci = 0; ci < text.length; ci++) {
            const ch = text[ci];
            let type = null;
            if (ch === '.')  type = 'period';
            if (ch === '!')  type = 'exclaim';
            if (ch === '?')  type = 'question';
            if (ch === '…' || text.slice(ci, ci + 3) === '...') type = 'ellipsis';

            if (type) {
                const approxTimeMs = (ci / totalChars) * totalDurationMs;
                const intensity = type === 'exclaim'  ? 0.60
                                : type === 'ellipsis' ? 0.45
                                : type === 'question' ? 0.30
                                :                       0.20;
                const durationMs = type === 'ellipsis' ? 900
                                 : type === 'exclaim'  ? 450
                                 :                       300;
                events.push({ timeMs: approxTimeMs, intensity, durationMs });
            }
        }
        return events;
    }());

    // Shared mutable context — callbacks set by draw5BarWaveform when wired up.
    let _waveformReady = false;

    // audioEndPromise resolves when the segment queue truly finishes.
    // flowController awaits this instead of a fixed duration timer, so the UI
    // is NEVER revealed before the last word is spoken.
    let _resolveAudioEnd;
    const audioEndPromise = new Promise(r => { _resolveAudioEnd = r; });

    const speechContext = {
        timeline,
        totalDurationMs,
        spikeEvents,
        // Full segment text list — consumed by SubtitleEngine for word mapping
        segmentTexts: segments.map(s => s.text),
        // Callbacks registered by draw5BarWaveform — called by _runQueue
        onWaveformStart:   null,
        onWaveformEnd:     null,
        onWaveformSegment: null,
        // Subtitle callbacks — registered by SubtitleEngine after waveform callbacks
        onSubtitleBoundary: null,    // (segIdx, charIndex) — from utterance.onboundary
        onSubtitleSegment:  null,    // (segIdx, rateFactor) — timing fallback
        // Called by draw5BarWaveform to signal it's wired and ready
        notifyWaveformReady() { _waveformReady = true; },
    };

    // ── 6. HANDLE ───────────────────────────────────────────────
    let _stopped = false;

    return {
        mode:          'speech',
        duration:      estDuration,
        audioBuffer:   SPEECH_MARKER,
        speechContext,              // consumed by flowController → draw5BarWaveform
        audioEndPromise,            // resolves when queue truly ends — flowController awaits this

        /**
         * Kicks off the segment queue and returns IMMEDIATELY.
         * Await audioHandle.audioEndPromise for TRUE completion.
         */
        play() {
            _stopped = false;

            if (typeof speechSynthesis === 'undefined') {
                console.warn('[Speech] play() — speechSynthesis not available.');
                return Promise.resolve();
            }

            speechSynthesis.cancel();

            // Resolve voice (synchronous if voices loaded, deferred otherwise)
            // Passes nationality, gender, AND lang hint for locale-aware matching.
            const resolveVoice = () => new Promise((res) => {
                const voices = speechSynthesis.getVoices();
                if (voices.length > 0) {
                    res(selectBrowserVoice(nationality, gender, lang));
                } else {
                    speechSynthesis.addEventListener('voiceschanged', () => {
                        res(selectBrowserVoice(nationality, gender, lang));
                    }, { once: true });
                    // Safari may never fire voiceschanged — fallback after 800ms
                    setTimeout(() => res(selectBrowserVoice(nationality, gender, lang)), 800);
                }
            });

            // Fire queue asynchronously — play() itself resolves immediately.
            // _runQueue calls _resolveAudioEnd when truly done (last word spoken).
            resolveVoice().then((voice) => {
                if (voice) console.log('[Speech] ▶ Queue starting — voice:', voice.name, voice.lang, `(${gender || 'unknown gender'}) | segments:`, segments.length);
                else       console.log('[Speech] ▶ Queue starting — no specific voice, browser default | segments:', segments.length);
                _runQueue(segments, voice, speechContext, () => _stopped, _resolveAudioEnd);
            });

            return Promise.resolve();
        },

        stop() {
            _stopped = true;
            speechSynthesis.cancel();
            _removeVoiceMessage();
            // Resolve audioEndPromise so flowController never hangs on early stop
            if (_resolveAudioEnd) _resolveAudioEnd();
            if (speechContext.onWaveformEnd) speechContext.onWaveformEnd();
            // SubtitleEngine listens to onWaveformEnd, so subtitle cleanup is automatic
            console.log('[Speech] ■ Queue cancelled manually.');
        },
    };

    // ── SEGMENT QUEUE RUNNER ─────────────────────────────────
    /**
     * Speak segments one by one, honouring pauses and the stop flag.
     * Signals waveform controller at queue start, per-segment, and queue end.
     * Also fires subtitle callbacks (boundary from _speakSegment; timing fallback here).
     *
     * @param {function} resolveAudioEnd — resolves audioEndPromise on TRUE completion.
     */
    async function _runQueue(segs, voice, ctx, isStopped, resolveAudioEnd) {
        // Signal waveform: first utterance about to start
        if (ctx.onWaveformStart) ctx.onWaveformStart();

        for (let i = 0; i < segs.length; i++) {
            if (isStopped()) break;

            const seg = segs[i];

            // Pause BEFORE
            if (seg.pauseBefore > 0) {
                await _sleep(seg.pauseBefore);
                if (isStopped()) break;
            }

            // Notify waveform of segment change (index-based timeline lookup)
            if (ctx.onWaveformSegment) ctx.onWaveformSegment(i);

            // Subtitle timing fallback — fires immediately before the utterance starts.
            // SubtitleEngine ignores this if onboundary events are already arriving.
            if (ctx.onSubtitleSegment) ctx.onSubtitleSegment(i, seg.rate);

            // Speak segment (wires onboundary → ctx.onSubtitleBoundary internally)
            await _speakSegment(seg, i, voice, ctx);
            if (isStopped()) break;

            // Pause AFTER (breath)
            if (seg.pauseAfter > 0) {
                await _sleep(seg.pauseAfter);
            }
        }

        // Signal waveform + subtitles: all speech complete — begin decay
        if (ctx.onWaveformEnd) ctx.onWaveformEnd();
        // Resolve audioEndPromise — flowController is awaiting this signal
        if (resolveAudioEnd) resolveAudioEnd();
        console.log('[Speech] ■ Queue complete.');
    }

    /**
     * Speak one segment — returns a Promise that resolves on utterance end.
     * Hooks utterance.onboundary to fire ctx.onSubtitleBoundary when available.
     */
    function _speakSegment(seg, segIdx, voice, ctx) {
        return new Promise((resolve) => {
            const utt = new SpeechSynthesisUtterance(seg.text);

            if (voice) utt.voice = voice;
            utt.rate   = seg.rate;
            utt.pitch  = seg.pitch;
            utt.volume = seg.volume;

            // Real-time word boundary → subtitle highlight (primary sync path)
            utt.onboundary = (event) => {
                if (event.name === 'word' && ctx.onSubtitleBoundary) {
                    ctx.onSubtitleBoundary(segIdx, event.charIndex);
                }
            };

            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };

            utt.onend   = finish;
            utt.onerror = (e) => {
                if (e.error !== 'interrupted') console.warn('[Speech] Segment error:', e.error, '|', seg.text.slice(0, 40));
                finish();
            };

            // Safety: if onend never fires (Chrome bug on long pauses), continue after timeout
            const safetyMs = Math.max(3000, seg.text.split(/\s+/).length * 1200);
            setTimeout(finish, safetyMs);

            speechSynthesis.speak(utt);
            _activeSpeech = utt;
        });
    }
}

/** Simple async sleep. */
function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Cannot-return handle factory ───────────────────────────────
/**
 * Absolute last resort — speechSynthesis entirely unavailable.
 * Ambient oscillator keeps running (managed elsewhere).
 * Shows cinematic "The voice cannot fully return..." message.
 * Waveform animates organically (play() triggers the timing).
 *
 * audioBuffer === null — the ONE case flowController treats as truly silent.
 *
 * @param {string} text — narration text (kept for duration estimate)
 * @returns {AudioHandle}
 */
function _makeCannotReturnHandle(text) {
    const wordCount     = (text || '').split(/\s+/).filter(Boolean).length;
    const estimatedSecs = Math.max(15, Math.round((wordCount / 130) * 60));

    return {
        mode:        'silent',
        duration:    estimatedSecs,
        audioBuffer: null,

        play() {
            console.warn('[Audio] Cannot-return mode — showing cinematic message, no audio.');
            _showVoiceMessage('The voice cannot fully return…');
            return Promise.resolve();
        },

        stop() {
            _removeVoiceMessage();
            console.log('[Audio] ■ Cannot-return handle stopped.');
        },
    };
}
