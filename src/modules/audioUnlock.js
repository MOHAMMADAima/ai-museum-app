/**
 * LORE — Audio Unlock Module
 *
 * Browsers block all audio autoplay until a user gesture has been received.
 * This module owns the SINGLE AudioContext for the app and ensures it is
 * resumed on the first qualifying user gesture (click, touchend, keydown).
 *
 * Usage:
 *   AudioUnlock.init()       — call once at app boot (main.js)
 *   AudioUnlock.unlock()     — call explicitly from any known gesture handler
 *   AudioUnlock.getContext() — returns the shared AudioContext
 *   AudioUnlock.isUnlocked() — true after first successful resume
 */

let _ctx = null;
let _unlocked = false;

// ── Internal: create or return the singleton AudioContext ──
function _getOrCreateContext() {
    if (!_ctx) {
        try {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('[AudioUnlock] AudioContext not available:', e.message);
        }
    }
    return _ctx;
}

// ── Internal: play a 0-length silent oscillator to unlock Web Audio ──
function _pingSilentOscillator() {
    const ctx = _getOrCreateContext();
    if (!ctx) return;
    try {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;           // silent
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.001);
    } catch (e) {
        // Non-fatal — context may already be running
    }
}

// ── Internal: resume the AudioContext and mark as unlocked ──
async function _resume() {
    const ctx = _getOrCreateContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (e) {
            console.warn('[AudioUnlock] resume() failed:', e.message);
        }
    }

    _pingSilentOscillator();
    _unlocked = ctx.state === 'running';
}

// ── Exported singleton ─────────────────────────────────────
export const AudioUnlock = {

    /**
     * Call once at app boot.
     * Attaches passive listeners on click + touchend so the FIRST gesture
     * from anywhere in the app automatically unlocks audio.
     */
    init() {
        const handler = async () => {
            await _resume();
        };
        // { once: true } — auto-removes after first fire
        document.addEventListener('click',    handler, { once: true, passive: true });
        document.addEventListener('touchend', handler, { once: true, passive: true });
        document.addEventListener('keydown',  handler, { once: true, passive: true });
    },

    /**
     * Call directly from any known gesture handler for immediate effect.
     * Safe to call multiple times.
     */
    async unlock() {
        await _resume();
    },

    /**
     * Returns the shared AudioContext (creates it on first call).
     * Used by Audio.draw5BarWaveform instead of `new AudioContext()`.
     */
    getContext() {
        return _getOrCreateContext();
    },

    /** True after the first successful AudioContext resume. */
    isUnlocked() {
        return _unlocked;
    }
};
