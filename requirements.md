# LORE — Narrative Resurrection Engine

## Project Overview
LORE is a cinematic AI museum experience that reanimates history through dynamically generated historical witnesses. Users scan artworks and hear emotionally immersive narrations.

## Core Features
1. **Dynamic Witness Generation**: Uses AI (Claude) to create unique, historically grounded characters based on artwork metadata and visitor profiles.
2. **Audio Narration**: Converts narratives into speech using AI (ElevenLabs) with culturally appropriate voices.
3. **Cinematic UI**: A dark museum aesthetic with gold ritual accents, smooth transitions, and typewriter animations.
4. **Narrative Persistence**: A simulated WhatsApp interface allowing visitors to continue the conversation with the reanimated witness.
5. **Artwork Identification**: Metadata-based system for recognizing masterpiece artworks.

## Tech Stack
- **Languages**: HTML5, CSS3, JavaScript (ES6+)
- **Frameworks**: None (Pure Vanilla implementation)
- **External APIs**: Claude (AI Layer), ElevenLabs (Audio Layer)
- **State Management**: Local browser storage with persistent session state.

## Screen Structure
1. **Splash**: Entry ritual and camera initialization.
2. **Profile**: Identity collection (Name, Gender).
3. **Scan**: Artwork recognition interface.
4. **Generation**: Ritual loading sequence while AI works.
5. **Narration**: Voice playback with synchronized waveform visualization.
6. **End Visit**: Emotional closure and transition to persistence.
7. **WhatsApp Simulation**: In-app simulated chat for deeper narrative exploration.

## Implementation Details
- **UI Layer**: Modular screen rendering.
- **AI Layer**: Prompt engineering for historical witnesses.
- **Audio Layer**: Dynamic voice selection and waveform rendering.
- **Transition Layer**: Gold thread animations and screen fades.
- **State Layer**: Global state management and local persistence.

---

## Cinematic Perception System

### Visual Layer Stack (z-index order)
| Layer | Element | z-index | Purpose |
|-------|---------|---------|---------|
| 1 | `#camera-bg-wrapper` | 0 | Live camera feed (or black) |
| 2 | `#camera-grain-canvas` | 1 | Animated grain fallback when camera denied |
| 3 | `#camera-dark-overlay` | 2 | Persistent `rgba(8,8,8,0.65)` veil |
| 4 | `#app-root` | 10 | All UI screens (transparent backgrounds) |
| 5 | `#transition-overlay` | 1000 | Screen-to-screen cinematic fade |
| 6 | `#custom-cursor` | 9999 | Gold ring cursor (desktop only) |

### Camera System (`camera.js`)
- Requested **once** at app boot via `Camera.init()` in `main.js`
- Streams into `#camera-bg-video` which covers full viewport via `object-fit: cover`
- On permission grant: `#camera-bg-wrapper` fades from `opacity:0` → `1` over 1.2s
- On permission denied: animated film-grain canvas activates at low opacity
- Stream persists across all screen navigations — never restarted

### Audio System (`audio.js`)
- **Singleton active track**: module-level `_activeAudioEl` variable; only one stream plays at a time
- `Audio.stopAll(fadeDuration)`: gracefully fades out then stops any playing audio
- `Audio.speak()` calls `_stopActive()` before resolving, guaranteeing no overlap
- `Audio.preload(url)`: pre-fetches an audio URL into a ready-to-play handle
- Simulated audio estimates realistic duration from word count (~130 wpm)

### Text Effects (`textEffects.js`)
- `TextEffects.typewriter(el, text, baseSpeed, variance)`: letter-by-letter with organic timing
  - Each character fades in via CSS transition (not instant appearance)
  - Punctuation (`.` `,` `—`) adds 120ms pause for natural breath
  - Spaces slightly faster; random variance per character
- `TextEffects.fadeIn/fadeOut(el, duration, delay)`: smooth opacity transitions returning Promises
- `TextEffects.wait(ms)`: composable delay primitive

### Splash Ritual Sequence
```
Boot:     Camera.init() fires → permission prompt appears
Step 1:   600ms black silence
Step 2:   LORE wordmark fades in (1000ms)
Step 3:   400ms pause
Step 4:   Tagline typewriter (organic, ~36ms/char)
Step 5:   700ms pause
Step 6a:  "Put on your earphones." typewriter + wrapper fade-in
Step 6b:  500ms pause → "Enter the Ritual" button fades in
```

### Overview
`flowController.js` is the deterministic cinematic engine that owns all AI + Audio + Screen sequencing. No screen may trigger generation or audio directly.

### Flow State Machine
```
IDLE → SCANNING → GENERATING_CHARACTER → GENERATING_VOICE → TRANSITIONING → PLAYING_NARRATION → IDLE
                                                                                       ↓
                                                                            CONTINUATION_MODE
```

### Controlled Sequence: `FlowController.runExperience(artwork)`
This is the **single entry point** for the entire scan→narration flow:

1. **Lock** — `FlowController.lock()` sets `body.experience-locked`, blocking all pointer events
2. **SCANNING** — artwork stored in State
3. **GENERATING_CHARACTER** — `GenerationScreen` renders (pure display); `AI.generateWitness()` runs
4. *(800 ms cinematic pause)*
5. **GENERATING_VOICE** — `Audio.speak()` synthesises narration audio; status updates on screen
6. *(800 ms cinematic pause)*
7. `"Witness arrived."` status + 1200 ms pause
8. **TRANSITIONING** — cinematic fade to `NarrationScreen`
9. *(1000 ms silence — screen visible, nothing playing)*
10. **PLAYING_NARRATION** — waveform starts, audio plays, typewriter runs in parallel
11. After completion: `FlowController.unlock()`, CTA button revealed
12. **IDLE** — user can proceed to `EndVisit`

### Failure Guarantees
- Race conditions: prevented by `_locked` flag + single async chain
- Overlapping audio: `stopActiveAudio()` called at start of every `runExperience()`
- Duplicate triggers: `confirmBtn` self-removes its event listener on first click
- API failure: `try/catch` in `runExperience()` returns user to scan screen after 2 s

### Module Responsibilities After Orchestration
| Module           | Responsibility                              | May call AI/Audio? |
|------------------|---------------------------------------------|--------------------|
| `flowController` | Sequencing, locking, state machine          | ✅ Yes              |
| `scan.js`        | Detection UI only; calls `runExperience()`  | ❌ No               |
| `generation.js`  | Ritual animation display only               | ❌ No               |
| `narration.js`   | Narration UI only; reads State              | ❌ No               |
| `endVisit.js`    | Closure UI; standard navigation             | ❌ No               |
| `whatsapp.js`    | Chat UI; may call AI for replies            | ✅ Chat only        |

