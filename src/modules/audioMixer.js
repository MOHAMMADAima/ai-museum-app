/**
 * LORE — Audio Mixer
 *
 * Owns the shared mixing bus between voice, music (ambient + underscore),
 * and the single master output. All audio must flow through this graph —
 * nothing connects directly to AudioContext.destination.
 *
 * ── GRAPH ────────────────────────────────────────────────────────────────────
 *
 *   [voice source] ──→ VoiceGain (1.0) ──┐
 *   [ambient]      ──→ MusicGain (1.0) ──┤→ MasterGain (0.9) → destination
 *   [underscore]   ──→ MusicGain (1.0) ──┘
 *
 * Both ambient and underscore share the same MusicGain bus so ducking
 * affects them simultaneously and consistently.
 *
 * ── DUCKING ──────────────────────────────────────────────────────────────────
 *
 *   onVoiceStart() — ramps MusicGain to MUSIC_DUCKED in 60 ms
 *   onVoiceEnd()   — ramps MusicGain back to MUSIC_FULL  in 500 ms
 *
 *   MUSIC_FULL   = 1.0   (base level; absolute loudness set by synth modules)
 *   MUSIC_DUCKED = 0.35  (35 % of full — audible but not competing)
 *
 * ── INITIALISATION ───────────────────────────────────────────────────────────
 *
 *   Nodes are created lazily on first getVoiceBus() / getMusicBus() call
 *   because AudioContext may not exist at module load time.
 *   Call AudioMixer.reset() when the AudioContext itself is destroyed.
 */

import { AudioUnlock } from './audioUnlock.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MASTER_GAIN   = 0.90;
const VOICE_GAIN    = 1.00;
const MUSIC_FULL    = 1.00;   // transparent pass-through; absolute level set by synths
const MUSIC_DUCKED  = 0.35;   // 35 % — music is present but clearly subordinate
const DUCK_RAMP_S   = 0.060;  // 60 ms — fast attack (voice needs instant dominance)
const UNDUCK_RAMP_S = 0.500;  // 500 ms — slow release (natural breath-out feeling)

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON NODES
// ─────────────────────────────────────────────────────────────────────────────

let _master = null;   // GainNode  → AudioContext.destination
let _voice  = null;   // GainNode  → _master
let _music  = null;   // GainNode  → _master

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL
// ─────────────────────────────────────────────────────────────────────────────

function _init() {
    const ctx = AudioUnlock.getContext();
    if (!ctx || _master) return;   // already built, or no context yet

    _master = ctx.createGain();
    _voice  = ctx.createGain();
    _music  = ctx.createGain();

    _master.gain.value = MASTER_GAIN;
    _voice.gain.value  = VOICE_GAIN;
    _music.gain.value  = MUSIC_FULL;

    _voice.connect(_master);
    _music.connect(_master);
    _master.connect(ctx.destination);

    console.log('[AudioMixer] Bus created — masterGain:', MASTER_GAIN,
                '| voiceGain:', VOICE_GAIN, '| musicGain:', MUSIC_FULL);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export const AudioMixer = {

    /**
     * Returns the voice bus GainNode.
     * Connect any narration / TTS source here.
     * Creates the entire bus graph on first call.
     */
    getVoiceBus() {
        _init();
        return _voice;
    },

    /**
     * Returns the music bus GainNode.
     * Connect ambient layers and the emotional underscore here.
     * Creates the entire bus graph on first call.
     */
    getMusicBus() {
        _init();
        return _music;
    },

    // ── DUCKING ──────────────────────────────────────────────────────────────

    /**
     * Called when voice playback begins.
     * Ramps MusicGain to MUSIC_DUCKED in 60 ms.
     */
    onVoiceStart() {
        _init();
        const ctx = AudioUnlock.getContext();
        if (!ctx || !_music) return;

        const now = ctx.currentTime;
        _music.gain.cancelScheduledValues(now);
        _music.gain.setValueAtTime(_music.gain.value, now);
        _music.gain.linearRampToValueAtTime(MUSIC_DUCKED, now + DUCK_RAMP_S);

        console.log('VOICE PLAYING');
        console.log('MIX LEVELS', 'voice:', VOICE_GAIN, 'music:', MUSIC_DUCKED);
    },

    /**
     * Called when voice playback ends or pauses.
     * Ramps MusicGain back to MUSIC_FULL over 500 ms.
     */
    onVoiceEnd() {
        _init();
        const ctx = AudioUnlock.getContext();
        if (!ctx || !_music) return;

        const now = ctx.currentTime;
        _music.gain.cancelScheduledValues(now);
        _music.gain.setValueAtTime(_music.gain.value, now);
        _music.gain.linearRampToValueAtTime(MUSIC_FULL, now + UNDUCK_RAMP_S);

        console.log('MIX LEVELS', 'voice: silent', 'music:', MUSIC_FULL, '(restoring)');
    },

    /**
     * Destroy all bus nodes.
     * Call only when the AudioContext itself is being torn down.
     */
    reset() {
        for (const node of [_master, _voice, _music]) {
            try { node?.disconnect(); } catch (_) {}
        }
        _master = null;
        _voice  = null;
        _music  = null;
    },
};
