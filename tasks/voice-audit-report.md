# LORE Voice Audio System — Detailed Audit Report
**Date:** 2026-05-16  
**Auditor:** Code Review + Live API Testing  
**Scope:** Full pipeline from character generation → voice selection → ElevenLabs TTS → Web Audio playback

---

## 1. EXECUTIVE SUMMARY

**The voice audio is "unavailable" because 5 of the 30 voice IDs in the `VOICE_MAP` return HTTP 402 (`paid_plan_required`) from ElevenLabs.** The current account is on a free/tier plan that does not include "library voices." When a character's nationality + gender resolves to one of these 5 IDs, the fetch fails twice (with automatic retry), then the app silently falls back to **simulation mode** — animated waveform bars with zero sound output.

**Impact:** Any artwork whose generated character is French-female, Spanish-female, British-female, Dutch-female, North-African-female, Chinese-female, Korean-female, Japanese-female, or Central-African-male will produce **complete silence** while the UI pretends audio is playing.

---

## 2. AUDIT METHODOLOGY

1. **Code review** of `audio.js`, `flowController.js`, `ai.js`, `audioUnlock.js`, `main.js`, `scan.js`
2. **Live API testing** against `api.elevenlabs.io/v1/text-to-speech/<voiceId>` for every voice ID in `VOICE_MAP`
3. **Account voice inventory** queried via `GET /v1/voices`
4. **End-to-end trace** of the generation → narration flow

---

## 3. DETAILED FINDINGS

### 3.1 PRIMARY ROOT CAUSE: 5 Voice IDs Are "Paid Plan Only"

**HTTP 402 Response Body:**
```json
{"detail":{"type":"payment_required","code":"paid_plan_required","message":"Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.","status":"payment_required"}}
```

**Failing Voice IDs (all 402):**

| Voice ID | Mapped Keys | Gender | Region |
|---|---|---|---|
| `MF3mGyEYCl7XYWbV9V6O` | `french_female`, `japanese_female` | Female | France, Japan |
| `ThT5KcBeYPX3keUQqHPh` | `spanish_female`, `chinese_female`, `korean_female` | Female | Spain, China, Korea |
| `jsCqWAovK2LkecY7zXl4` | `british_female`, `norwegian_female` | Female | UK, Norway |
| `jBpfuIE2acCO8z3wKNLl` | `dutch_female`, `north_african_female` | Female | Netherlands, North Africa |
| `XB0fDUnXU5powFXDhCwa` | `central_african_male` | Male | Central Africa |

**Working Voice IDs (all 200 + valid MP3):**

| Voice ID | Mapped Keys | Notes |
|---|---|---|
| `pNInz6obpgDQGcFmaJgB` | `default`, `american_male`, `spanish_male` | Adam — deep, dominant |
| `VR6AewLTigWG4xSOukaG` | `italian_male`, `austrian_male`, `japanese_male` | Returns 200 |
| `EXAVITQu4vr4xnSDxMaL` | `italian_female`, `american_female`, `central_african_female` | Sarah — mature, confident |
| `IKne3meq5aSn9XLyUdCD` | `german_male`, `arabic_male` | Charlie — deep, energetic |
| `XrExE9yKIg1WjnnlVkGX` | `german_female`, `arabic_female`, `austrian_female` | Matilda — professional |
| `SOYHLrjzK2X1ezoPC6cr` | `british_male`, `norwegian_male` | Harry — fierce |
| `N2lVS1w4EtoT3dr4eOWO` | `dutch_male`, `north_african_male` | Callum — husky |
| `onwK4e9ZLuTAKqWW03F9` | `french_male`, `chinese_male`, `korean_male` | Daniel — steady broadcaster |

### 3.2 SILENT FALLBACK CHAIN — How the User Experiences Nothing

```
1. User taps [Begin Resurrection]
   → AudioUnlock.unlock() runs ✓ (AudioContext goes to "running")

2. Claude generates character with nationality="French", gender="female"

3. getVoiceId() resolves: "french" + "female" → MF3mGyEYCl7XYWbV9V6O

4. _fetchFromElevenLabs() sends POST to /v1/text-to-speech/MF3mGyEYCl7XYWbV9V6O
   → HTTP 402 (paid_plan_required)
   → Console: "ElevenLabs attempt 1 FAILED: ElevenLabs HTTP 402: {...}"

5. Automatic retry after 1.5s with same voice ID
   → HTTP 402 again
   → Console: "ElevenLabs attempt 2 FAILED: ElevenLabs HTTP 402: {...}"
   → Console: "Both attempts failed — falling back to silent simulation"

6. Audio.speak() returns _simulateAudio() handle:
   { duration: ~22s, audioBuffer: null, play() { /* no-op */ }, stop() {} }

7. flowController.startNarration() receives handle:
   → audioBuffer === null → isSimulation = true
   → Logs: "Simulation mode detected — showing fallback text"
   → Shows fallback text on narration screen (visitors rarely read it)

8. Audio.draw5BarWaveform(container, null) starts:
   → analyserNode is null → enters ORGANIC SIMULATION mode
   → Bars animate via Math.sin() — looks EXACTLY like real audio
   → User sees moving waveform, hears ABSOLUTE SILENCE

9. audioHandle.play(analyserNode) is called
   → Simulation play() is a no-op Promise.resolve()
   → Console: "Simulation play() called — waveform runs in organic mode, no sound output."

10. flowController waits durationMs (~22s) then continues to WhatsApp screen
    → User thinks: "The voice didn't work."
```

**Key deception:** The organic waveform animation is visually indistinguishable from real audio analysis. A museum visitor has no way to know audio failed.

### 3.3 THE API KEY IS VALID — Not a Key Problem

- **Test:** `POST /v1/text-to-speech/pNInz6obpgDQGcFmaJgB` → **HTTP 200**, returns 19,688 bytes valid MP3
- **Key format:** `sk_a04406842ad6e37f...` (starts with `sk_`, correct length)
- **Env loading:** `main.js` seeds `window.__ELEVENLABS_KEY__` and `localStorage.setItem('LORE_ELEVENLABS_KEY', ...)` at boot
- **Runtime getter:** `getElevenLabsKey()` reads from window → import.meta.env → localStorage

**Verdict:** The v17 resilience refactor successfully fixed the cached-empty-key bug. The key is present, valid, and dynamically retrievable.

### 3.4 AUDIO UNLOCK IS FUNCTIONAL — Not an Autoplay Policy Problem

**Evidence:**
- `scan.js:468` and `scan.js:487` both call `await AudioUnlock.unlock()` before the generation flow
- `audioUnlock.js:77-79` attaches `{ once: true }` listeners on `click`, `touchend`, `keydown`
- `audio.js:307-311` calls `ctx.resume()` before every playback attempt
- `audio.js:286-290` calls `ctx.resume()` before `decodeAudioData` if context is suspended

**Verdict:** The browser autoplay policy is correctly handled. AudioContext is unlocked on first user gesture.

### 3.5 WEB AUDIO DECODE IS FUNCTIONAL

**Evidence:**
- `decodeAudioData(arrayBuffer.slice(0))` is called after successful fetch
- Test fetch returned 19,688 bytes of valid MP3 (ID3v2.4, MPEG ADTS, 128kbps, 44.1kHz)
- The decoded AudioBuffer is passed to `_makeWebAudioHandle()` which creates a BufferSourceNode

**Verdict:** The Web Audio API pipeline is sound. If ElevenLabs returns a valid MP3, it will play.

### 3.6 NATIONALITY + GENDER CONTRACT IS FUNCTIONAL

**Evidence:**
- `ai.js:74-75` — `nationality` and `gender` are in the Claude JSON outputSpec
- `ai.js:156-162` — Nationality + Gender Rule added to prompt
- `ai.js:451-452` — parsed defaults set `nationality` and normalize `gender`
- `ai.js:475-476, 496-497, 517-518` — All simulation witnesses include `nationality` and `gender`
- `audio.js:89-103` — `getVoiceId(narrative, artwork)` correctly builds `${nat}_${gender}` key
- `flowController.js:222` — Passes `narrative` to `Audio.speak(narrative.narrative, artwork, narrative)`

**Verdict:** The nationality+gender voice selection architecture (v18) is correctly implemented end-to-end.

### 3.7 NO HTTP 402-SPECIFIC HANDLING

**Current behavior:**
```javascript
if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`ElevenLabs HTTP ${response.status}: ${errBody}`);
}
```

Any non-2xx status (401, 402, 429, 500, 503) is treated identically: log, retry, fallback to simulation.

**Missing:** No special handling for 402. The app could detect `paid_plan_required` and:
- Fall back to a known-working voice ID instead of simulation
- Or at minimum, show a "voice unavailable" UI message instead of silently animating bars

---

## 4. ACCOUNT VOICE INVENTORY

Full list of voices available on the current ElevenLabs account:

| Voice ID | Name | Gender | Accent | Use Case |
|---|---|---|---|---|
| `pNInz6obpgDQGcFmaJgB` | Adam | male | american | social_media |
| `EXAVITQu4vr4xnSDxMaL` | Sarah | female | american | entertainment_tv |
| `IKne3meq5aSn9XLyUdCD` | Charlie | male | australian | conversational |
| `XrExE9yKIg1WjnnlVkGX` | Matilda | female | american | informative_educational |
| `SOYHLrjzK2X1ezoPC6cr` | Harry | male | american | characters_animation |
| `N2lVS1w4EtoT3dr4eOWO` | Callum | male | american | characters_animation |
| `onwK4e9ZLuTAKqWW03F9` | Daniel | male | british | informative_educational |
| `JBFqnCBsd6RMkjVDRZzb` | George | male | british | narrative_story |
| `pFZP5JQG7iQjIQuC4Bku` | Lily | female | british | informative_educational |
| `Xb7hH8MSUJpSbSDYk0k2` | Alice | female | british | informative_educational |
| `hpp4J3VqNfWAUOO0d1Us` | Bella | female | american | informative_educational |
| `cgSgspJ2msm6clMCkdW9` | Jessica | female | american | conversational |
| `cjVigY5qzO86Huf0OWal` | Eric | male | american | conversational |
| `CwhRBWXzGAHq8TQ4Fs17` | Roger | male | american | conversational |
| `FGY2WhTYpPnrIDTdsKH5` | Laura | female | american | social_media |
| `iP95p4xoKVk53GoZ742B` | Chris | male | american | conversational |
| `nPczCjzI2devNBz1zQrb` | Brian | male | american | social_media |
| `pqHfZKP75CvOlQylNhV4` | Bill | male | american | advertisement |
| `SAz9YHcvj6GT2YYXdXww` | River | neutral | american | conversational |
| `TX3LPaxmHKxFdv7VOQHJ` | Liam | male | american | social_media |
| `bIHbv24MWmeRgasZH58o` | Will | male | american | conversational |
| `VR6AewLTigWG4xSOukaG` | — | — | — | Returns 200 (shared/library voice) |

**Total available:** 22 voices  
**Male:** 13 | **Female:** 8 | **Neutral:** 1  
**American-accented:** 16 | **British-accented:** 4 | **Australian:** 1

---

## 5. BREAKDOWN BY NATIONALITY × GENDER

Which combinations will produce **real audio** vs **silence**:

| Nationality | Male | Female | Notes |
|---|---|---|---|
| French | ✅ (Daniel) | ❌ **SILENT** | female = 402 |
| Italian | ✅ (VR6Aew…) | ✅ (Sarah) | Both work |
| Spanish | ✅ (Adam) | ❌ **SILENT** | female = 402 |
| German | ✅ (Charlie) | ✅ (Matilda) | Both work |
| British | ✅ (Harry) | ❌ **SILENT** | female = 402 |
| American | ✅ (Adam) | ✅ (Sarah) | Both work |
| Dutch | ✅ (Callum) | ❌ **SILENT** | female = 402 |
| Austrian | ✅ (VR6Aew…) | ✅ (Matilda) | Both work |
| Norwegian | ✅ (Harry) | ❌ **SILENT** | female = 402 |
| Chinese | ✅ (Daniel) | ❌ **SILENT** | female = 402 |
| Japanese | ✅ (VR6Aew…) | ❌ **SILENT** | female = 402 |
| Korean | ✅ (Daniel) | ❌ **SILENT** | female = 402 |
| Arabic | ✅ (Charlie) | ✅ (Matilda) | Both work |
| North African | ✅ (Callum) | ❌ **SILENT** | female = 402 |
| Central African | ❌ **SILENT** | ✅ (Sarah) | male = 402 |
| Unknown / default | ✅ (Adam) | ✅ (Sarah) | fallback to default |

**Result:** 10 out of 31 gendered nationality slots are silent. **Any female character from a European, East Asian, or African nationality (except German, Arabic, Austrian, Italian, American, or Central African) will be completely silent.**

---

## 6. SECONDARY ISSUES

### 6.1 Simulation Mode Is Visually Deceptive
When `audioBuffer === null`, the 5-bar waveform runs organic sine-wave animation. A visitor has no visual cue that audio is missing. **Recommendation:** Change bar color to grey or add a "muted" icon when in simulation mode.

### 6.2 No User-Facing Error Message for 402
The `_showVoiceStruggleMessage()` only appears between attempt 1 and attempt 2 (during the 1.5s retry delay). If both attempts fail, the message has already faded out by the time simulation mode begins. **Recommendation:** Keep a persistent "Voice unavailable — reading silently" indicator on the narration screen when simulation mode is active.

### 6.3 Retry Uses Same Failing Voice ID
The retry logic does not switch voice IDs. It retries the exact same 402 voice. **Recommendation:** On 402, fall back to `VOICE_MAP.default` (Adam — known working) instead of giving up entirely.

### 6.4 No Runtime Voice Validation
The app never queries `/v1/voices` to verify which voice IDs are actually available. The static `VOICE_MAP` is treated as gospel. **Recommendation:** At app boot, query the voice list and mark unavailable IDs, or build the map dynamically.

---

## 7. VERDICT

| Component | Status | Notes |
|---|---|---|
| API Key | ✅ Valid | Present, dynamically loaded, tested working |
| AudioContext Unlock | ✅ Functional | Called on gesture, resume before playback |
| Web Audio Decode | ✅ Functional | decodeAudioData works, MP3 valid |
| Env Loading (v17 fix) | ✅ Fixed | Runtime getters, localStorage backup |
| Nationality+Gender Contract (v18) | ✅ Implemented | Claude outputs nationality/gender, flow passes it |
| Voice Map (v18) | ❌ **BROKEN** | 5/30 IDs return 402; 10/31 nationality+gender combos silent |
| 402 Error Handling | ❌ Missing | Treated as generic failure, no voice fallback |
| Simulation UX | ❌ Deceptive | Bars animate, user hears nothing, no clear indicator |
| Retry Logic | ⚠️ Partial | Retries once but with same failing voice ID |

---

## 8. FIX PRIORITIES

### P0 — Immediate (fixes silence today)
1. **Replace all 402 voice IDs** with working alternatives from the account's own library
2. **Add 402-specific fallback:** if response.status === 402, immediately retry with `VOICE_MAP.default` instead of waiting 1.5s

### P1 — High (prevents future breakage)
3. **Add simulation-mode visual indicator** (grey bars or "🔇" icon) so visitors know audio is absent
4. **Query `/v1/voices` at boot** and dynamically build available voice map

### P2 — Medium (quality of life)
5. **Upgrade ElevenLabs plan** to unlock the "library voices" (the original 5 IDs would then work)
6. **Add per-voice test button** in a hidden debug panel for museum staff

---

## 9. TEST COMMANDS FOR VERIFICATION

```bash
# Test any voice ID
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID" \
  -H "Content-Type: application/json" \
  -H "xi-api-key: $ELEVENLABS_KEY" \
  -d '{"text":"test","model_id":"eleven_multilingual_v2"}'

# List all available voices
curl -s -H "xi-api-key: $ELEVENLABS_KEY" \
  "https://api.elevenlabs.io/v1/voices"

# Full TTS test with working voice (Adam)
curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB" \
  -H "Content-Type: application/json" \
  -H "xi-api-key: $ELEVENLABS_KEY" \
  -d '{"text":"Hello world","model_id":"eleven_multilingual_v2","output_format":"mp3_44100_128","voice_settings":{"stability":0.45,"similarity_boost":0.8,"style":0.65,"use_speaker_boost":true}}' \
  -o test.mp3 && file test.mp3
```
