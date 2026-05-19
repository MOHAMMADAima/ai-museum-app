# Voice Nationality & Gender Audit
## Date: 2026-05-16

---

## 1. Pipeline Overview (how nationality/gender reach the voice engine)

```
artwork (DB entry or manual entry)
    ↓ flowController._guessNationality(artist)   ← only for custom/typed artwork
    ↓ artwork.nationality                         ← fallback if Claude returns nothing

Claude (AI.generateWitness)
    → narrative.nationality  e.g. "French", "North African"
    → narrative.language     e.g. "fr", "ar"  (BCP-47 hint)
    → narrative.gender       e.g. "male", "female", "unknown"

Audio.speak(text, artwork, narrative)
    nat    = narrative.nationality || artwork.nationality || ''
    lang   = narrative.language   || ''
    gender = narrative.gender     || ''   ← raw string, NOT yet normalised

    _browserLocaleMatchExists(nat, lang, voices)
        → calls normalizeNationality(nat)       ← first normalisation point
        → if match: PATH A  — _makeSpeechHandle (browser TTS)
        → if no match:
            if ElevenLabs key: PATH B — _getElevenLabsVoice(gender)
                                           calls normalizeGender(gender)
            else: PATH C — _makeSpeechHandle (browser catch-all)
            else: PATH D — cannot-return

_makeSpeechHandle(text, nationality, gender, lang)
    NAT_STYLES key: nationality.toLowerCase().replace(/[\s-]+/g, '_')
    voice selected: selectBrowserVoice(nationality, gender, lang)
        → calls normalizeNationality(nationality)   ← second normalisation point
        → calls normalizeGender(gender)             ← second normalisation point
```

---

## 2. Confirmed Bugs

---

### BUG 1 — `normalizeNationality` misses "North African" (with space)
**Severity: HIGH — wrong voice for a valid Claude-returned nationality**

**File:** `src/modules/audio.js` lines 228–232

**Root cause:**
```js
// Current — BROKEN
if (v.includes('north_afric') || v.includes('northafrican') ||
    v.includes('morocc') || ...)
    return 'north_african';
```
Claude returns `"North African"` (two words, space-separated).
`'north african'.includes('north_afric')` → **false** (underscore in pattern, space in input).
`'north african'.includes('northafrican')` → **false** (no-space variant doesn't match either).

**What actually happens:**
- `normalizeNationality('North African')` → `''`
- `_browserLocaleMatchExists` returns `false`
- Engine skips `ar-MA / ar / fr-FR` browser voices entirely
- Falls to ElevenLabs → British male voice (George) plays instead of Arabic/French accent

**Exception:** If Claude also provides `language: "ar"` or `language: "fr"`, the `lang` hint
path in `_browserLocaleMatchExists` catches it first (line 498–503), bypassing the broken
nationality path. So the bug only manifests when `language` is blank or when both are absent.

**Fix:**
```js
// Add 'north afric' (with space) before the underscore variants
if (v.includes('north afric') || v.includes('north_afric') || v.includes('northafrican') ||
    v.includes('morocc') || v.includes('algeri') || v.includes('tunisi') ||
    v.includes('egypt') || v.includes('berber'))
    return 'north_african';
```

---

### BUG 2 — `normalizeNationality` misses "Central African" (with space)
**Severity: HIGH — same root cause as Bug 1**

**File:** `src/modules/audio.js` lines 234–238

**Root cause:**
```js
// Current — BROKEN
if (v.includes('central_afric') || v.includes('centralafrican') ||
    v.includes('congol') || ...)
```
`'central african'.includes('central_afric')` → **false**.
`'central african'.includes('centralafrican')` → **false**.

**What actually happens:**
- `normalizeNationality('Central African')` → `''`
- Skips `fr-FR / fr / en-GB` fallback browser voices
- Falls to ElevenLabs British male voice

**Fix:**
```js
if (v.includes('central afric') || v.includes('central_afric') || v.includes('centralafrican') ||
    v.includes('congol') || v.includes('senegal') || v.includes('nigeria') ||
    v.includes('subsahara') || v.includes('subsah'))
    return 'central_african';
```

---

### BUG 3 — `normalizeNationality` has no entry for "Greek"
**Severity: MEDIUM — affects El Greco and any Greek-character artwork**

**File:** `src/modules/audio.js` (normalizeNationality) + `src/modules/flowController.js` line 29

**Root cause:**
`_guessNationality` in flowController explicitly returns `'Greek'` for El Greco:
```js
[/el\s+greco/i, 'Greek'],
```
But `normalizeNationality` has **zero Greek entries**. `normalizeNationality('Greek')` → `''`.

**What actually happens:**
- For El Greco (or any Greek character Claude generates):
  - `normalizeNationality` returns `''`
  - `_browserLocaleMatchExists` returns `false`
  - Falls to ElevenLabs British voice — a Greek character speaks with a British accent

**Fix — add to `normalizeNationality`:**
```js
// ── Greek ────────────────────────────────────────────────────
if (v.includes('greek') || v.includes('greece') || v.includes('hellen') ||
    v.includes('athen') || v.includes('crete') || v.includes('byzant'))
    return 'greek';
```

**Also add to `selectBrowserVoice` langMap:**
```js
greek: ['el-GR', 'el'],
```

**Also add to `_browserLocaleMatchExists` langMap:**
```js
greek: ['el'],
```

**Also add to `_makeSpeechHandle` NAT_STYLES:**  
*(not strictly needed — the `.toLowerCase().replace()` in `_makeSpeechHandle` already produces `'greek'`, which falls to `default`. The NAT_STYLES entry is optional but adds pacing correctness.)*
```js
greek: { rate: 1.04, pitch: 0.88, breathMs: 280, sentencePause: 320 },
```

> Note: `el-GR` browser voices are rare (mostly Android/Windows). If absent, the
> `selectBrowserVoice` fallback chain proceeds to European chain → British → English,
> which is acceptable.

---

### BUG 4 — `speak()` passes raw `"unknown"` gender string (not normalised at source)
**Severity: LOW — functionally safe but causes misleading debug logs**

**File:** `src/modules/audio.js` line 676

**Root cause:**
```js
const gender = narrative?.gender || '';
```
`'unknown'` is truthy, so it passes through as `'unknown'` (not `''`).
`normalizeGender` IS called by all downstream consumers (`_getElevenLabsVoice`,
`selectBrowserVoice`) so the voice result is correct. But the debug log at line 678 says:
```
[VOICE ENGINE] speak() entry { gender: 'unknown' }
```
…suggesting no gender was resolved, when the actual normalisation happens silently later.

**Fix:**
```js
const gender = normalizeGender(narrative?.gender || '');
```
This makes the log accurate and removes any risk of a future consumer forgetting to normalise.

---

## 3. Non-Bugs (investigated and confirmed correct)

| Item | Status |
|------|--------|
| `normalizeGender` inside `selectBrowserVoice` | ✅ Correct — always called |
| `normalizeGender` inside `_getElevenLabsVoice` | ✅ Correct — always called |
| `_makeSpeechHandle` NAT_STYLES lookup for `'North African'` | ✅ Correct — uses `.replace(/[\s-]+/g,'_')` which converts space to underscore |
| `_makeSpeechHandle` NAT_STYLES lookup for `'Dutch'`, `'French'`, etc. | ✅ All match |
| `selectBrowserVoice` fallback chain (steps 0–8) | ✅ Logic correct — gender always stays locale-scoped |
| `_browserLocaleMatchExists` `lang` hint path (line 498–503) | ✅ Correct — bypasses nationality normalisation when `lang` is provided |
| Simulated witnesses (no API key) — `nationality: 'Italian'`, `language: 'it'` | ✅ All three DB entries have correct pairs |
| ElevenLabs gender fallback when `gender = ''` | ✅ Falls to `male[0]` (George, British) — documented behaviour |

---

## 4. Summary Table

| # | Bug | File | Severity | Impact |
|---|-----|------|----------|--------|
| 1 | `normalizeNationality('North African')` → `''` | audio.js:229 | HIGH | Wrong accent (British ElevenLabs instead of Arabic/French browser voice) |
| 2 | `normalizeNationality('Central African')` → `''` | audio.js:235 | HIGH | Wrong accent (British ElevenLabs instead of French browser voice) |
| 3 | `normalizeNationality('Greek')` → `''` | audio.js:158–247 | MEDIUM | Wrong accent for El Greco and any Greek character |
| 4 | `speak()` passes raw `'unknown'` gender | audio.js:676 | LOW | Misleading debug log; no voice impact |

---

## 5. Complete Fix (all bugs, minimal change)

### `src/modules/audio.js`

**Fix 1 + 2 — North/Central African space matching** (lines 228–238):
```js
// ── North African ────────────────────────────────────────────────────────────
if (v.includes('north afric') || v.includes('north_afric') || v.includes('northafrican') ||
    v.includes('morocc') || v.includes('algeri') || v.includes('tunisi') ||
    v.includes('egypt') || v.includes('berber'))
    return 'north_african';

// ── Central African ──────────────────────────────────────────────────────────
if (v.includes('central afric') || v.includes('central_afric') || v.includes('centralafrican') ||
    v.includes('congol') || v.includes('senegal') || v.includes('nigeria') ||
    v.includes('subsahara') || v.includes('subsah'))
    return 'central_african';
```

**Fix 3 — Greek entry in `normalizeNationality`** (add after `american`, before return ''):
```js
// ── Greek ────────────────────────────────────────────────────
if (v.includes('greek') || v.includes('greece') || v.includes('hellen') ||
    v.includes('athen') || v.includes('crete') || v.includes('byzant'))
    return 'greek';
```

**Fix 3 — Greek in `selectBrowserVoice` langMap** (line ~316):
```js
greek: ['el-GR', 'el'],
```

**Fix 3 — Greek in `_browserLocaleMatchExists` langMap** (line ~513):
```js
greek: ['el'],
```

**Fix 4 — Normalise gender at source in `speak()`** (line 676):
```js
const gender = normalizeGender(narrative?.gender || '');
```

---

## 6. Risk Assessment

All four fixes are additive or substitutive with no removal of existing logic:
- Fixes 1–3: adding new `includes()` clauses to an existing if-chain — zero regression risk
- Fix 3 langMap entries: adding new keys — zero collision risk
- Fix 4: `normalizeGender` is already called downstream; normalising at source is idempotent — calling it twice on an already-normalised value returns the same result
