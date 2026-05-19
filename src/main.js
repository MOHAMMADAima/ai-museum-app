import { State } from './modules/state.js';
import { Transitions } from './modules/transitions.js';
import { FlowController } from './modules/flowController.js';
import { Camera } from './modules/camera.js';
import { Audio } from './modules/audio.js';
import { AudioUnlock } from './modules/audioUnlock.js';
import { SplashScreen } from './screens/splash.js';
import { ProfileScreen } from './screens/profile.js';
import { ScanScreen } from './screens/scan.js';
import { GenerationScreen } from './screens/generation.js';
import { NarrationScreen } from './screens/narration.js';
import { WhatsappScreen } from './screens/whatsapp.js';

// endVisit screen removed in v11 — the loop is now: narration → scan → repeat.

const screens = {
    splash:     SplashScreen,
    profile:    ProfileScreen,
    scan:       ScanScreen,
    generation: GenerationScreen,
    narration:  NarrationScreen,
    whatsapp:   WhatsappScreen
};

export function navigateTo(screenId) {
    const screen = screens[screenId];
    if (screen) {
        State.currentState = screenId;
        screen.render();
    } else {
        console.error(`[LORE] Screen "${screenId}" not found.`);
    }
}

function initApp() {
    // ── Runtime key seeding ────────────────────────────────────────
    // import.meta.env is safely readable HERE at app boot time.
    // We push values into window.* and localStorage so any module
    // that delayed reading (or was evaluated before .env was loaded)
    // can call a getter and always get the live value.
    const _elKey     = import.meta.env?.VITE_ELEVENLABS_API_KEY || '';
    const _claudeKey = import.meta.env?.VITE_CLAUDE_API_KEY     || '';

    window.__ELEVENLABS_KEY__ = _elKey;
    window.__CLAUDE_KEY__     = _claudeKey;

    // Persist to localStorage — only overwrite if we actually have a value,
    // so a cached key survives across hard-refreshes even before Vite rebuilds.
    if (_elKey)     localStorage.setItem('LORE_ELEVENLABS_KEY', _elKey);
    if (_claudeKey) localStorage.setItem('LORE_CLAUDE_KEY',     _claudeKey);

    console.log('[LORE] Keys seeded — ElevenLabs:', _elKey     ? _elKey.slice(0, 6)     + '…' : 'MISSING',
                                   '| Claude:',     _claudeKey ? _claudeKey.slice(0, 14) + '…' : 'MISSING');

    State.load();
    Transitions.init();

    // ── Audio unlock — attach passive listeners immediately ───────
    // First gesture anywhere (click/touch/key) resumes AudioContext.
    AudioUnlock.init();

    // ── Boot Camera immediately — persists for entire session ──
    // Runs asynchronously; Splash ritual waits for its own timing.
    Camera.init();

    // ── Custom Cursor (desktop only) ───────────────────────────
    const cursor = document.getElementById('custom-cursor');
    document.addEventListener('mousemove', (e) => {
        cursor.style.left = e.clientX + 'px';
        cursor.style.top  = e.clientY + 'px';
    });
    document.addEventListener('mousedown', () => {
        cursor.style.width      = '30px';
        cursor.style.height     = '30px';
        cursor.style.background = 'rgba(201, 169, 110, 0.2)';
    });
    document.addEventListener('mouseup', () => {
        cursor.style.width      = '20px';
        cursor.style.height     = '20px';
        cursor.style.background = 'transparent';
    });

    // ── Debug console exposure ─────────────────────────────────
    window.__LORE__ = { FlowController, State, Camera, Audio, AudioUnlock, navigateTo };

    navigateTo('splash');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
