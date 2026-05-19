# Audio Exit Audit — Why Voice Doesn't Stop on "Leave the museum"

## Date
2026-05-16

## Files Examined
- `src/modules/globalExitButton.js` — exit overlay orchestration
- `src/modules/audio.js` — voice synthesis module (v20)
- `src/modules/flowController.js` — narration lifecycle
- `src/modules/underscore.js` — underscore music
- `src/modules/ambientSoundEngine.js` — ambient sound
- `src/modules/subtitles.js` — subtitle engine

---

## 1. What the user clicks

```
×  (top-right corner)
    → _showLeaveOverlay()
        → FlowController.abortNarration()
        → Audio.stopAll()
        → AmbientSoundEngine.stopNow()
        → Underscore.stopNow()
        → SubtitleEngine.stop()
```

This happens **immediately** when the overlay opens (v38 fix moved it here).

Then inside the overlay:
```
[ Leave the museum ]
    → FlowController.unlock()
    → State reset + Camera restore
    → Navigate to splash
```

---

## 2. What Audio.stopAll() actually does

```js
// audio.js  line 630-632
async stopAll() {
    _stopAll();
}

// audio.js  line 581-584
function _stopAll() {
    _stopActiveSource();    // stops ElevenLabs buffer source
    _stopActiveSpeech();    // calls speechSynthesis.cancel()
}
```

`_stopActiveSpeech()` (line 574-578):
```js
function _stopActiveSpeech() {
    if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
    }
    _activeSpeech = null;
}
```

**Problem: `speechSynthesis.cancel()` alone is NOT enough.**

---

## 3. What the speech handle's .stop() does (that _stopAll() skips)

Inside `_makeSpeechHandle()` (audio.js line 1501-1510):

```js
stop() {
    _stopped = true;                           // ← kills _runQueue loop
    speechSynthesis.cancel();
    _removeVoiceMessage();
    if (_resolveAudioEnd) _resolveAudioEnd();  // ← unblocks FlowController
    if (speechContext.onWaveformEnd) speechContext.onWaveformEnd();  // ← kills waveform
    console.log('[Speech] ■ Queue cancelled manually.');
}
```

**Three critical things happen in `handle.stop()` that `_stopAll()` does NOT do:**

| Action | Why it matters |
|--------|---------------|
| `_stopped = true` | `_runQueue` checks `if (isStopped()) break;` at every segment boundary. Without this, the queue continues. |
| `_resolveAudioEnd()` | FlowController awaits `audioEndPromise` (line 441-447). Without this, it hangs until the 30s safety timeout. |
| `onWaveformEnd()` | Waveform animation keeps running. Subtitle timers keep firing. |

---

## 4. The exact failure sequence (browser TTS path)

1. Visitor clicks × → `Audio.stopAll()` → `_stopAll()` → `speechSynthesis.cancel()`
2. Current utterance fires `onerror: 'interrupted'` → `finish()` resolves segment promise
3. `_runQueue` wakes up, checks `if (isStopped()) break;` → **FALSE** because `_stopped` is still `false`
4. Loop continues to **next segment**
5. `speechSynthesis.speak(utt)` called for next segment → **voice RESUMES**
6. FlowController already exited via `abortPromise` → no controller left
7. **Ghost audio plays over the exit overlay**

---

## 5. Why ElevenLabs path doesn't have the same bug

ElevenLabs uses `_makeWebAudioHandle()` (line 791):
```js
stop() {
    _stopActiveSource();   // stops the buffer source node
    console.log('[Audio] ■ ElevenLabs playback stopped.');
}
```

`_stopAll()` calls `_stopActiveSource()` which does the same thing. So ElevenLabs stops correctly.

**But** it still misses resolving `audioEndPromise` and `onWaveformEnd`, so FlowController hangs and waveform keeps animating.

---

## 6. Why the exit overlay itself is not the blocker

The overlay (z-index 9990) is above all UI elements. Buttons are clickable. The issue is NOT z-index or pointer-events. The issue is the **audio pipeline continuing to play in the background** because `_runQueue` was never told to stop.

---

## 7. Root Cause Summary

```
Audio.stopAll()
    └── _stopAll()
            ├── _stopActiveSource()   → ✅ works for ElevenLabs
            └── _stopActiveSpeech()   → ⚠️ only cancels current utterance
                                         ❌ does NOT set _stopped flag
                                         ❌ does NOT resolve audioEndPromise
                                         ❌ does NOT call onWaveformEnd

The fix: Audio.stopAll() must ALSO call:
    State.activeAudioHandle?.stop()
```

---

## 8. Recommended Fix (1 line)

```js
// audio.js  line 630-632
async stopAll() {
    _stopAll();
    if (State.activeAudioHandle?.stop) State.activeAudioHandle.stop();
}
```

This ensures:
- `_stopAll()` stops whatever is currently playing (ElevenLabs buffer or current utterance)
- `handle.stop()` resolves all promises, kills the queue, stops waveform, and cleans up subtitles

---

## 9. Verification checklist after fix

- [ ] Click × during active narration → audio stops **immediately** (before overlay finishes fading in)
- [ ] "Leave the museum" → no ghost audio after navigation
- [ ] "Stay a little longer" → narration can resume (current segment may need restart; acceptable)
- [ ] Waveform bars freeze/flatline immediately on × click
- [ ] Subtitles stop updating immediately on × click
- [ ] No `setTimeout` safety timers leak after exit
