# Audit: "Leave the Museum" Voice Stop Failure
## Date: 2026-05-16

---

## Executive Summary

The voice does not always stop when the user taps "Leave the museum" because
`abortNarration()` was designed to abort only the _narration playback phase_,
but voice and screen transitions can be initiated **before** `startNarration()`
is ever reached. There are three distinct timing windows where the exit signal
either does nothing or arrives too late — and one of them silently resets the
abort flag, making narration play in full on a screen the user has already left.

---

## How the exit flow is supposed to work

When the `×` button is tapped, `GlobalExitButton._showLeaveOverlay()` fires
this sequence **synchronously** (before the overlay animates in):

```
1. FlowController.abortNarration()   ← sets _narrationAborted = true
2. Audio.stopAll()                   ← _stopAll() + State.activeAudioHandle?.stop()
3. AmbientSoundEngine.stopNow()
4. Underscore.stopNow()
5. SubtitleEngine.stop()
6. State.stopWaveform()
7. State.activeAudioHandle = null
```

This is correct **only if** `startNarration()` is already running. Outside that
window, the signal has either no target or is erased before it can be read.

---

## The async pipeline (where the bugs live)

`FlowController.runExperience()` is one long async chain:

| Step | Code | Approx. duration |
|------|------|-----------------|
| ① Camera off | `Camera.hide()` | instant |
| ② Nav to generation | `transitionToScreen('generation')` | ~350 ms |
| ③ Ambient starts | `AmbientSoundEngine.start()` | instant |
| ④ Claude generation | `AI.generateWitness()` | 2 – 8 s |
| ⑤ Voice synthesis | `await Audio.speak()` | 0 ms (speech) or 1 – 4 s (ElevenLabs) |
| ⑥ Signal ready | `GenerationScreen.signalReady()` | instant |
| ⑦ Wait for Phase 5 | `await GenerationScreen.waitReady()` | **~6 – 7 s** |
| ⑧ Crossfade ambient | `AmbientSoundEngine.crossfadeToNarration()` | instant |
| ⑨ Nav to narration | `transitionToScreen('narration')` | ~350 ms |
| ⑩ Narration plays | `await startNarration(audioHandle)` | 35 – 55 s |

`abortNarration()` is only wired into step ⑩. Steps ④ – ⑨ have **no abort
path**.

---

## Bug 1 — `_narrationAborted` is silently reset to `false` on entry to `startNarration`

**File:** `flowController.js` line 370
**Severity: CRITICAL — the abort flag is erased before it can be acted on**

```js
// startNarration — line 370
this._narrationAborted = false;   // ← RESETS any prior abortNarration() call
```

If the user taps `×` during window 1 (ElevenLabs fetch, ~1 – 4 s) or window 2
(GenerationScreen animation hold, ~6 – 7 s), `abortNarration()` sets
`_narrationAborted = true`. But `runExperience` keeps running through steps
⑥ – ⑨ with no guard checks. When it finally reaches step ⑩,
`startNarration()` unconditionally resets the flag back to `false` on the very
first line. Every subsequent `aborted()` check throughout the playback sequence
returns `false`, and the narration plays in full.

**User-visible symptom:** Full narration plays after the user has already seen
the leave overlay, confirmed exit, and been navigated to splash. Voice comes
from an invisible screen.

**Fix:** Preserve a pre-existing abort signal at entry, not reset it:

```js
// startNarration — line 370
// Only reset if no prior abort has been signalled
if (!this._narrationAborted) {
    this._narrationAborted = false;
}
// Better: simply do not reset at all — let runExperience guard earlier (see Bug 3)
```

---

## Bug 2 — `_abortNarrationResolve` is `null` outside `startNarration`

**File:** `flowController.js` line 79
**Severity: HIGH — abortNarration() has no effect during steps ④ – ⑨**

`_abortNarrationResolve` is the Promise resolver that makes `raceDelay()` calls
inside `startNarration` return immediately. It is created only at line 371:

```js
const abortPromise = new Promise(r => { this._abortNarrationResolve = r; });
```

This line is inside `startNarration()`, which hasn't been reached yet when the
user taps `×` during the generation screen (steps ④ – ⑨).

So `abortNarration()` (line 77 – 83):
```js
abortNarration() {
    this._narrationAborted = true;
    if (this._abortNarrationResolve) {      // ← always NULL at this stage
        this._abortNarrationResolve();
        this._abortNarrationResolve = null;
    }
}
```
…sets the flag and does nothing else. None of the `await` calls in steps ⑥ – ⑨
race against anything that can be resolved.

**Fix:** Create `_abortNarrationResolve` at the start of `runExperience()` (not
inside `startNarration`), so the entire pipeline can race against it:

```js
// At the top of runExperience():
this._narrationAborted = false;
const exitPromise = new Promise(r => { this._abortNarrationResolve = r; });

// Then every internal await becomes:
await Promise.race([someWork(), exitPromise]);
if (this._narrationAborted) { cleanup(); return; }
```

---

## Bug 3 — `runExperience` has zero abort checks between steps ④ and ⑩

**File:** `flowController.js` lines 240 – 263
**Severity: HIGH — code continues running pipeline after user confirms exit**

After `Audio.speak()` returns (step ⑤), the code unconditionally executes:

```js
State.activeAudioHandle = audioHandle;          // ⑥
GenerationScreen.signalReady(narrative);         // ⑥
await GenerationScreen.waitReady();              // ⑦  ← 6-7 s, no abort check
AmbientSoundEngine.crossfadeToNarration(…);     // ⑧  ← restarts ambient
await this.transitionToScreen('narration');      // ⑨  ← navigates to narration
await this.startNarration(audioHandle);          // ⑩  ← finally checks aborted()
```

Even if the user has confirmed leaving during step ⑦, the ambient sound
restarts (step ⑧) and the user is navigated to the narration screen (step ⑨)
before any abort check.

**Fix:** Add `_narrationAborted` guard checks immediately after each major await:

```js
const audioHandle = await Audio.speak(…);
if (this._narrationAborted) { audioHandle?.stop?.(); return; }
State.activeAudioHandle = audioHandle;

await GenerationScreen.waitReady();
if (this._narrationAborted) return;            // skip ambient + navigation

AmbientSoundEngine.crossfadeToNarration(…);
await this.transitionToScreen('narration');
if (this._narrationAborted) return;

await this.startNarration(audioHandle);
```

---

## Bug 4 — ElevenLabs fetch has no `AbortController` — uninterruptible

**File:** `audio.js` line 791
**Severity: MEDIUM — in-flight network request cannot be cancelled**

When the engine is on the ElevenLabs path, `Audio.speak()` calls
`_fetchFromElevenLabs()` which issues a plain `fetch()` with no signal:

```js
const response = await fetch(`${ELEVENLABS_ENDPOINT}/${voiceId}`, {
    method: 'POST',
    headers: { … },
    body:    JSON.stringify({ … }),
    // ← no `signal` — cannot be aborted
});
```

If the user taps `×` while this fetch is in flight (1 – 4 s), the network
request completes regardless. `Audio.speak()` returns an `audioHandle` after
the user has left. `State.activeAudioHandle` is then set to this orphan handle
— **after** `Audio.stopAll()` has already been called and has already cleared
it. The handle's `stop()` is never called.

Combined with Bug 3, the orphan handle's `play()` is then called inside
`startNarration` (since Bug 1 reset `_narrationAborted` to `false`).

**Fix:** Pass an `AbortSignal` through the chain:

```js
// In Audio.speak():
const abortCtrl = new AbortController();
// Store it so stopAll() can call abortCtrl.abort()

// In _fetchFromElevenLabs():
const response = await fetch(url, { …, signal: abortCtrl.signal });
```

---

## Bug 5 — `State.activeAudioHandle` is read by `stopAll()` before it is set

**File:** `audio.js` line 671 + `flowController.js` line 241
**Severity: MEDIUM — stop signal misses the audio handle**

The sequence in `runExperience`:

```
line 240: await Audio.speak()          ← activeAudioHandle is NULL here
line 241: State.activeAudioHandle = …  ← set AFTER speak() returns
```

`Audio.stopAll()` (called from `GlobalExitButton`) reads
`State.activeAudioHandle` at call time:

```js
async stopAll() {
    _stopAll();
    if (State.activeAudioHandle?.stop) State.activeAudioHandle.stop();  // null if × clicked too early
}
```

If `×` is tapped while `Audio.speak()` is awaiting the ElevenLabs response,
`activeAudioHandle` is `null`, so `handle.stop()` is never called. When
`Audio.speak()` eventually resolves and the handle is assigned on line 241, it
is a live handle with no stop instruction applied.

**Fix:** Assign `State.activeAudioHandle` _before_ awaiting `Audio.speak()`, or
use a shared abort ref that `stopAll()` can trigger even before the handle
exists (see Bug 4 fix above with `AbortController`).

---

## Bug 6 — `startNarration` resets `_narrationAborted` without saving prior state

*(Secondary description of Bug 1 from the `startNarration` side)*

**File:** `flowController.js` line 370

`startNarration()` was written with the assumption that it is only ever reached
as part of a fresh, uninterrupted pipeline. The unconditional reset on entry
(`this._narrationAborted = false`) makes it impossible to pre-signal an abort
before `startNarration()` is entered.

**Fix:** Remove the reset from `startNarration()` entirely, and move abort
initialisation to the top of `runExperience()` (per Bug 2 fix).

---

## Summary Table

| # | Bug | Location | Severity | Symptom |
|---|-----|----------|----------|---------|
| 1 | `startNarration` resets `_narrationAborted = false` on entry | flowController.js:370 | **CRITICAL** | Narration plays after confirmed exit; abort flag erased |
| 2 | `_abortNarrationResolve` is null outside `startNarration` | flowController.js:79 | **HIGH** | `abortNarration()` does nothing during generation phase |
| 3 | No abort checks in `runExperience` steps ⑥ – ⑨ | flowController.js:246–263 | **HIGH** | Ambient restarts, screen navigates to narration after exit |
| 4 | ElevenLabs fetch has no `AbortController` | audio.js:791 | **MEDIUM** | In-flight fetch completes, orphan handle created |
| 5 | `activeAudioHandle` set after `Audio.speak()` resolves | flowController.js:241 | **MEDIUM** | `stopAll()` misses the handle when × tapped during fetch |
| 6 | Abort initialisation belongs in `runExperience`, not `startNarration` | flowController.js:370 | **HIGH** | Architecture: abort scope is too narrow |

---

## Recommended Fix Order

1. **Bug 1 + 6** together: remove the `_narrationAborted = false` reset from
   `startNarration` and initialise the full abort promise at the top of
   `runExperience`. This single change makes Bugs 2 and 3 fixable.

2. **Bug 3**: add `if (this._narrationAborted) return;` checks after every
   major `await` in `runExperience` (lines 240, 249, 260).

3. **Bug 2**: the `_abortNarrationResolve` promise, once created in
   `runExperience`, should also be used to short-circuit `GenerationScreen.waitReady()`.

4. **Bug 4**: wrap `_fetchFromElevenLabs` with an `AbortController`, store the
   controller on `Audio`, call `abort()` from `stopAll()`.

5. **Bug 5**: either assign `State.activeAudioHandle` before `await Audio.speak()` with a
   placeholder, or rely on the `AbortController` from Bug 4 fix to make the
   fetch cancellable without needing the handle reference.

---

## What IS working correctly (do not change)

| Item | Status |
|------|--------|
| `GlobalExitButton` stop sequence order | ✅ Correct — all engines stopped before overlay shown |
| `AmbientSoundEngine.stopNow()` / `_killAll()` | ✅ Instant, complete disconnect |
| `Underscore.stopNow()` | ✅ Instant cut |
| `SubtitleEngine.stop()` | ✅ Correct |
| `waveform stopWaveform()` | ✅ Correct |
| `handle.stop()` in `_makeSpeechHandle` | ✅ Sets `_stopped=true` + `speechSynthesis.cancel()` + resolves `audioEndPromise` |
| `handle.stop()` in `_makeWebAudioHandle` | ✅ Calls `_stopActiveSource()` |
| `_runQueue` `isStopped()` checks | ✅ Correct — breaks loop at segment boundaries |
| `startNarration` `aborted()` / `raceDelay` pattern | ✅ Correct — works when reached with flag intact |
