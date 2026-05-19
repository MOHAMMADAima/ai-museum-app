/**
 * LORE — Cinematic Ambient Sound Engine  (v2 — fully procedural)
 *
 * Generates all atmosphere from oscillators, noise buffers, filters, delay,
 * and LFO modulation using only the Web Audio API. No external audio files.
 *
 * ── LIFECYCLE ────────────────────────────────────────────────────────────────
 *
 *  AmbientSoundEngine.start(artwork)
 *    Called when the generation screen opens.
 *    Plays the low "resurrection oscillator" — the ritual aura that was there
 *    in v1. Fades in over 1.5 s.
 *
 *  AmbientSoundEngine.crossfadeToNarration(narrative, artwork)
 *    Called just before the narration screen appears.
 *    Fades the resurrection oscillator OUT and simultaneously fades the full
 *    cinematic atmosphere IN over 2 s.  The profile is chosen from the now-
 *    available narrative + artwork context (more accurate than at scan time).
 *
 *  AmbientSoundEngine.stop()
 *    Fades everything out over 2 s; returns a Promise.
 *    Called once after narration ends.
 *
 *  AmbientSoundEngine.stopNow()
 *    Instant cut — error recovery / forced exit.
 *
 * ── MIXING RULES ─────────────────────────────────────────────────────────────
 *  • Master gain ceiling: 0.04.  Voice always dominates.
 *  • Ambience is subconscious texture, not music.
 *  • CPU budget: max ~6 oscillators + 1 noise BufferSource per profile.
 *    Runs smoothly on mobile Safari, Android Chrome, low-end devices.
 *
 * ── AUDIO GRAPH (per profile) ────────────────────────────────────────────────
 *
 *   [noise buffer × 1]──[filter]──┐
 *   [osc drone     × 1]──────────┤
 *   [osc harmonic  × 1]──────────┤──[profile gain]──[master gain]──[destination]
 *   [osc colour    × 1]──────────┤
 *   [LFO osc × 1]──[LFO gain]────┘  (modulates drone gain, not routed to dest)
 */

import { AudioUnlock } from './audioUnlock.js';
import { AudioMixer } from './audioMixer.js';

// ── NOISE BUFFER FACTORY ─────────────────────────────────────────────────────

/**
 * Build a 2-second looping noise buffer of the requested colour.
 * Returned as a BufferSourceNode (loop=true) ready to be started.
 *
 * @param {AudioContext} ctx
 * @param {'white'|'pink'|'brown'} colour
 * @returns {AudioBufferSourceNode}
 */
function _noiseSource(ctx, colour = 'brown') {
    const sampleRate = ctx.sampleRate;
    const length     = sampleRate * 2;
    const buffer     = ctx.createBuffer(1, length, sampleRate);
    const data       = buffer.getChannelData(0);

    if (colour === 'brown') {
        // Brown (Brownian) noise: low-frequency, warm rumble
        let last = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
    } else if (colour === 'pink') {
        // Pink noise: 1/f spectrum, balanced — wind-like
        let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
        for (let i = 0; i < length; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
            b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
            b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
            data[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
            b6 = w * 0.115926;
        }
    } else {
        // White noise: flat spectrum — hiss / spray
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    }

    const src  = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop   = true;
    return src;
}

// ── SIMPLE DELAY-BASED REVERB TAIL ───────────────────────────────────────────

/**
 * Build a rudimentary "room reverb" from 3 feedback delay lines + allpass.
 * Much cheaper than ConvolverNode + procedural IR on mobile.
 *
 * @param {AudioContext} ctx
 * @param {number} roomSize  — 0 (tight) … 1 (cathedral)
 * @returns {{ input: AudioNode, output: AudioNode }}
 */
function _buildReverb(ctx, roomSize = 0.5) {
    const times    = [0.029, 0.047, 0.071].map(t => t * (0.5 + roomSize));
    const feedback = 0.2 + roomSize * 0.25;   // 0.20 – 0.45

    const input  = ctx.createGain();
    const output = ctx.createGain();
    output.gain.value = 0.6;

    times.forEach(delayTime => {
        const delay = ctx.createDelay(1.0);
        const fb    = ctx.createGain();
        const ap    = ctx.createBiquadFilter();

        delay.delayTime.value = delayTime;
        fb.gain.value         = feedback;
        ap.type               = 'allpass';
        ap.frequency.value    = 400 + roomSize * 1200;

        input.connect(delay);
        delay.connect(ap);
        ap.connect(fb);
        fb.connect(delay);      // feedback loop
        ap.connect(output);
    });

    // NOTE: output is intentionally left unconnected here.
    // Callers must wire: master → reverb.input  and  reverb.output → musicBus
    return { input, output };
}

// ── ATMOSPHERE BUILDERS ───────────────────────────────────────────────────────
//
// Each builder receives an AudioContext and a master GainNode to connect into.
// It returns an array of all created nodes so they can be stopped cleanly.
//
// Max gain is enforced by the caller (master). Builders may use lower internal
// gains for mixing between their own layers.

/**
 * Build a single LFO that amplitude-modulates a target AudioParam.
 * The LFO itself is not connected to the destination.
 */
function _lfo(ctx, { rate = 0.1, depth = 0.01, param }) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type            = 'sine';
    osc.frequency.value = rate;
    gain.gain.value     = depth;
    osc.connect(gain);
    gain.connect(param);
    osc.start(0);
    return [osc, gain];
}

// ── 1. RENAISSANCE ITALIAN ────────────────────────────────────────────────────
function _buildRenaissance(ctx, master) {
    const nodes = [];

    // Drone: warm low sine + perfect fifth + octave (soft choir feel)
    [[220, 0.020], [330, 0.010], [440, 0.005]].forEach(([freq, g]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type            = 'sine';
        osc.frequency.value = freq;
        gain.gain.value     = g;
        osc.connect(gain); gain.connect(master);
        osc.start(0);
        nodes.push(osc, gain);
    });

    // Brown noise → low-pass → room tone (candle air)
    const noise  = _noiseSource(ctx, 'brown');
    const lpf    = ctx.createBiquadFilter();
    const nGain  = ctx.createGain();
    lpf.type            = 'lowpass';
    lpf.frequency.value = 180;
    nGain.gain.value    = 0.007;
    noise.connect(lpf); lpf.connect(nGain); nGain.connect(master);
    noise.start(0);
    nodes.push(noise, lpf, nGain);

    // Delay reverb for cathedral depth
    const reverb = _buildReverb(ctx, 0.7);
    // Route reverb wet signal to music bus — not directly to destination
    master.connect(reverb.input);
    reverb.output.connect(AudioMixer.getMusicBus());
    nodes.push(reverb.input, reverb.output);

    // LFO: very slow breath on fundamental
    const droneGain = nodes[1]; // second node is the gain for 220Hz
    nodes.push(..._lfo(ctx, { rate: 0.07, depth: 0.008, param: droneGain.gain }));

    return nodes;
}

// ── 2. REVOLUTIONARY FRANCE ───────────────────────────────────────────────────
function _buildRevolutionary(ctx, master) {
    const nodes = [];

    // Low brass-like sawtooth → low-pass (removes harshness)
    const brass = ctx.createOscillator();
    const bLpf  = ctx.createBiquadFilter();
    const bGain = ctx.createGain();
    brass.type            = 'sawtooth';
    brass.frequency.value = 110;
    bLpf.type             = 'lowpass';
    bLpf.frequency.value  = 280;
    bGain.gain.value      = 0.016;
    brass.connect(bLpf); bLpf.connect(bGain); bGain.connect(master);
    brass.start(0);
    nodes.push(brass, bLpf, bGain);

    // Sub rumble
    const sub  = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type            = 'sine';
    sub.frequency.value = 55;
    sGain.gain.value    = 0.012;
    sub.connect(sGain); sGain.connect(master);
    sub.start(0);
    nodes.push(sub, sGain);

    // Pink noise → bandpass → crowd murmur
    const crowd  = _noiseSource(ctx, 'pink');
    const cBpf   = ctx.createBiquadFilter();
    const cGain  = ctx.createGain();
    cBpf.type             = 'bandpass';
    cBpf.frequency.value  = 700;
    cBpf.Q.value          = 2.0;
    cGain.gain.value      = 0.005;
    crowd.connect(cBpf); cBpf.connect(cGain); cGain.connect(master);
    crowd.start(0);
    nodes.push(crowd, cBpf, cGain);

    // Tension pulse oscillator — modulated by fast LFO
    const pulse  = ctx.createOscillator();
    const pGain  = ctx.createGain();
    pulse.type            = 'triangle';
    pulse.frequency.value = 165;
    pGain.gain.value      = 0.008;
    pulse.connect(pGain); pGain.connect(master);
    pulse.start(0);
    nodes.push(pulse, pGain);

    // LFO: fast pulse rhythm on tension oscillator
    nodes.push(..._lfo(ctx, { rate: 0.28, depth: 0.007, param: pGain.gain }));
    // LFO2: slow swell on master
    nodes.push(..._lfo(ctx, { rate: 0.04, depth: 0.004, param: master.gain }));

    return nodes;
}

// ── 3. MARITIME / SHIPWRECK ───────────────────────────────────────────────────
function _buildMaritime(ctx, master) {
    const nodes = [];

    // Melancholic low drone
    const drone  = ctx.createOscillator();
    const dGain  = ctx.createGain();
    drone.type            = 'sine';
    drone.frequency.value = 72;
    dGain.gain.value      = 0.018;
    drone.connect(dGain); dGain.connect(master);
    drone.start(0);
    nodes.push(drone, dGain);

    // Pink noise → bandpass → wind howl
    const wind  = _noiseSource(ctx, 'pink');
    const wBpf  = ctx.createBiquadFilter();
    const wGain = ctx.createGain();
    wBpf.type             = 'bandpass';
    wBpf.frequency.value  = 380;
    wBpf.Q.value          = 0.8;
    wGain.gain.value      = 0.010;
    wind.connect(wBpf); wBpf.connect(wGain); wGain.connect(master);
    wind.start(0);
    nodes.push(wind, wBpf, wGain);

    // White noise → highpass → sea spray / detail
    const spray  = _noiseSource(ctx, 'white');
    const sHpf   = ctx.createBiquadFilter();
    const sGain  = ctx.createGain();
    sHpf.type             = 'highpass';
    sHpf.frequency.value  = 2400;
    sGain.gain.value      = 0.003;
    spray.connect(sHpf); sHpf.connect(sGain); sGain.connect(master);
    spray.start(0);
    nodes.push(spray, sHpf, sGain);

    // LFO: wave rhythm on wind gain (0.10 Hz — one wave every ~10s)
    nodes.push(..._lfo(ctx, { rate: 0.10, depth: 0.008, param: wGain.gain }));
    // LFO2: vast ocean swell on master (very slow)
    nodes.push(..._lfo(ctx, { rate: 0.035, depth: 0.005, param: master.gain }));

    return nodes;
}

// ── 4. SACRED RELIGIOUS ───────────────────────────────────────────────────────
function _buildSacred(ctx, master) {
    const nodes = [];

    // Organ-like chord: root + fifth + third + octave (all sines)
    [[132, 0.018], [198, 0.010], [264, 0.007], [396, 0.004]].forEach(([freq, g]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type            = 'sine';
        osc.frequency.value = freq;
        gain.gain.value     = g;
        osc.connect(gain); gain.connect(master);
        osc.start(0);
        nodes.push(osc, gain);
    });

    // Long reverb tail — cathedral scale; wet signal → music bus
    const reverb = _buildReverb(ctx, 0.95);
    master.connect(reverb.input);
    reverb.output.connect(AudioMixer.getMusicBus());
    nodes.push(reverb.input, reverb.output);

    // Airy high shimmer: brown noise → very narrow highpass
    const air   = _noiseSource(ctx, 'brown');
    const aHpf  = ctx.createBiquadFilter();
    const aGain = ctx.createGain();
    aHpf.type             = 'highpass';
    aHpf.frequency.value  = 3000;
    aGain.gain.value      = 0.003;
    air.connect(aHpf); aHpf.connect(aGain); aGain.connect(master);
    air.start(0);
    nodes.push(air, aHpf, aGain);

    // LFO: very slow divine breath (one cycle every ~33s)
    nodes.push(..._lfo(ctx, { rate: 0.03, depth: 0.006, param: master.gain }));

    return nodes;
}

// ── 5. INTIMATE PORTRAIT ──────────────────────────────────────────────────────
function _buildIntimate(ctx, master) {
    const nodes = [];

    // Warm fundamental
    const drone  = ctx.createOscillator();
    const dGain  = ctx.createGain();
    drone.type            = 'sine';
    drone.frequency.value = 180;
    dGain.gain.value      = 0.018;
    drone.connect(dGain); dGain.connect(master);
    drone.start(0);
    nodes.push(drone, dGain);

    // Delicate harmonic shimmer (one octave up)
    const shimmer  = ctx.createOscillator();
    const sGain    = ctx.createGain();
    shimmer.type            = 'sine';
    shimmer.frequency.value = 360;
    sGain.gain.value        = 0.004;
    shimmer.connect(sGain); sGain.connect(master);
    shimmer.start(0);
    nodes.push(shimmer, sGain);

    // Soft room tone: brown noise → very low low-pass
    const room  = _noiseSource(ctx, 'brown');
    const rLpf  = ctx.createBiquadFilter();
    const rGain = ctx.createGain();
    rLpf.type             = 'lowpass';
    rLpf.frequency.value  = 120;
    rGain.gain.value      = 0.006;
    room.connect(rLpf); rLpf.connect(rGain); rGain.connect(master);
    room.start(0);
    nodes.push(room, rLpf, rGain);

    // LFO: gentle pulse — almost a heartbeat (0.15 Hz ≈ once per 7s)
    nodes.push(..._lfo(ctx, { rate: 0.15, depth: 0.006, param: dGain.gain }));

    return nodes;
}

// ── 6. DARK BAROQUE ───────────────────────────────────────────────────────────
function _buildDarkBaroque(ctx, master) {
    const nodes = [];

    // Deep sawtooth → low-pass (removes bite, keeps weight)
    const main  = ctx.createOscillator();
    const mLpf  = ctx.createBiquadFilter();
    const mGain = ctx.createGain();
    main.type            = 'sawtooth';
    main.frequency.value = 98;
    mLpf.type             = 'lowpass';
    mLpf.frequency.value  = 190;
    mGain.gain.value      = 0.015;
    main.connect(mLpf); mLpf.connect(mGain); mGain.connect(master);
    main.start(0);
    nodes.push(main, mLpf, mGain);

    // Sub frequency
    const sub  = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type            = 'sine';
    sub.frequency.value = 49;
    sGain.gain.value    = 0.010;
    sub.connect(sGain); sGain.connect(master);
    sub.start(0);
    nodes.push(sub, sGain);

    // Slightly detuned twin — creates slow beating interference (instability)
    const twin  = ctx.createOscillator();
    const tGain = ctx.createGain();
    twin.type            = 'sine';
    twin.frequency.value = 100.8;  // +2.8 Hz beating against 98 Hz
    tGain.gain.value     = 0.007;
    twin.connect(tGain); tGain.connect(master);
    twin.start(0);
    nodes.push(twin, tGain);

    // Dark texture: brown noise → very low lowpass
    const dark  = _noiseSource(ctx, 'brown');
    const dLpf  = ctx.createBiquadFilter();
    const dGain = ctx.createGain();
    dLpf.type             = 'lowpass';
    dLpf.frequency.value  = 90;
    dGain.gain.value      = 0.005;
    dark.connect(dLpf); dLpf.connect(dGain); dGain.connect(master);
    dark.start(0);
    nodes.push(dark, dLpf, dGain);

    // LFO: slow breathing (0.07 Hz — inhale/exhale every ~14s)
    nodes.push(..._lfo(ctx, { rate: 0.07, depth: 0.009, param: mGain.gain }));

    return nodes;
}

// ── RESURRECTION OSCILLATOR (generation phase) ───────────────────────────────
//
// This is the simple ritual aura that plays during AI generation.
// Kept intentionally minimal — only a single oscillator so the "arrival"
// of the full cinematic atmosphere during crossfade feels transformative.

function _buildResurrection(ctx, gain) {
    const osc  = ctx.createOscillator();
    osc.type            = 'sine';
    osc.frequency.value = 220;
    osc.connect(gain);
    osc.start(0);
    return [osc];
}

// ── PROFILE REGISTRY ─────────────────────────────────────────────────────────

const CINEMATIC_PROFILES = [
    {
        id:      'renaissance-italian',
        build:   _buildRenaissance,
        gain:    0.12,
        label:   'Renaissance Italian — warm, sacred, intimate',
        keys:    ['italian', 'florentine', 'renaissance', 'leonardo', 'workshop',
                  'venetian', 'roman', 'milan', 'tuscany', 'siena', 'painter',
                  'notary', 'merchant', 'warm', 'artistic', 'apprentice', 'muse'],
    },
    {
        id:      'revolutionary-france',
        build:   _buildRevolutionary,
        gain:    0.11,
        label:   'Revolutionary France — tension, rage, history',
        keys:    ['french', 'revolution', 'paris', 'guillotine', 'tragedy',
                  'conflict', 'rupture', 'dark', 'violent', 'political',
                  'soldier', 'prison', 'execution', 'uprising', 'war',
                  'revolutionary', 'republic', 'delacroix', 'marat'],
    },
    {
        id:      'maritime-shipwreck',
        build:   _buildMaritime,
        gain:    0.11,
        label:   'Maritime Shipwreck — loneliness, vastness, survival',
        keys:    ['sea', 'ship', 'sailor', 'ocean', 'medusa', 'raft', 'wreck',
                  'maritime', 'harbor', 'port', 'wave', 'fisherman', 'fog',
                  'northern', 'storm', 'mast', 'deck', 'coast'],
    },
    {
        id:      'sacred-religious',
        build:   _buildSacred,
        gain:    0.10,
        label:   'Sacred Religious — reverence, mystery, silence',
        keys:    ['sacred', 'religious', 'spiritual', 'divine', 'monk', 'fra',
                  'friar', 'priest', 'church', 'cathedral', 'convent', 'abbey',
                  'prayer', 'ritual', 'holy', 'byzantine', 'gospel', 'nun'],
    },
    {
        id:      'intimate-portrait',
        build:   _buildIntimate,
        gain:    0.11,
        label:   'Intimate Portrait — memory, closeness, fragility',
        keys:    ['portrait', 'domestic', 'interior', 'household', 'flemish',
                  'delft', 'vermeer', 'wife', 'textile', 'room', 'window',
                  'table', 'settled', 'witness', 'observer', 'watcher',
                  'melancholic', 'solitude', 'night', 'asylum', 'van gogh'],
    },
    {
        id:      'dark-baroque',
        build:   _buildDarkBaroque,
        gain:    0.10,
        label:   'Dark Baroque — haunted, heavy, psychological',
        keys:    ['caravaggio', 'baroque', 'shadow', 'death', 'skull', 'dark',
                  'dramatic', 'chiaroscuro', 'murderer', 'assassin', 'wound',
                  'blood', 'grief', 'despair', 'dungeon', 'torture', 'saint',
                  'martyr', 'spanish', 'german'],
    },
];

// Direct artwork → profile shortcuts (highest priority)
const ARTWORK_PROFILE_MAP = {
    'mona-lisa':          'renaissance-italian',
    'starry-night':       'intimate-portrait',
    'girl-pearl-earring': 'intimate-portrait',
    'raft-medusa':        'maritime-shipwreck',
    'liberty-leading':    'revolutionary-france',
};

// ── PROFILE SELECTOR ─────────────────────────────────────────────────────────

function _selectProfile(artwork, narrative = null) {
    // 1. Direct artwork shortcut
    if (artwork?.id && ARTWORK_PROFILE_MAP[artwork.id]) {
        const id = ARTWORK_PROFILE_MAP[artwork.id];
        const p  = CINEMATIC_PROFILES.find(p => p.id === id);
        if (p) { console.log(`[Ambient] Profile shortcut → "${p.id}"`); return p; }
    }

    // 2. Keyword scoring over all available context
    const haystack = [
        artwork?.nationality   || '',
        artwork?.title         || '',
        artwork?.artist        || '',
        artwork?.period        || '',
        artwork?.subject       || '',
        narrative?.characterName || '',
        narrative?.characterBio  || '',
        narrative?.emotionalTone || '',
        narrative?.environment   || '',
    ].join(' ').toLowerCase();

    let best  = null;
    let score = 0;
    for (const p of CINEMATIC_PROFILES) {
        let s = 0;
        for (const k of p.keys) if (haystack.includes(k)) s++;
        if (s > score) { score = s; best = p; }
    }

    if (best) {
        console.log(`[Ambient] Profile matched → "${best.id}" (score ${score})`);
        return best;
    }

    // 3. Fallback: warm renaissance (universal LORE default)
    console.log('[Ambient] No profile match — defaulting to renaissance-italian');
    return CINEMATIC_PROFILES[0];
}

// ── NODE DESTRUCTION HELPER ──────────────────────────────────────────────────

function _destroyNodes(nodes) {
    if (!nodes) return;
    for (const node of nodes) {
        try {
            if (node instanceof AudioBufferSourceNode || node instanceof OscillatorNode) {
                node.stop(0);
            }
            node.disconnect();
        } catch (_) { /* already stopped or not started */ }
    }
}

// ── ENGINE STATE ─────────────────────────────────────────────────────────────

let _resurrectionNodes = null;   // OscillatorNode[] — generation phase
let _resurrectionGain  = null;   // GainNode for resurrection layer
let _cinematicNodes    = null;   // all nodes for active cinematic profile
let _cinematicGain     = null;   // master GainNode for cinematic layer
let _cinematicProfile  = null;   // currently active profile object
let _running           = false;

function _killAll() {
    _destroyNodes(_resurrectionNodes);
    _resurrectionNodes = null;
    if (_resurrectionGain) {
        try { _resurrectionGain.disconnect(); } catch (_) {}
        _resurrectionGain = null;
    }
    _destroyNodes(_cinematicNodes);
    _cinematicNodes = null;
    if (_cinematicGain) {
        try { _cinematicGain.disconnect(); } catch (_) {}
        _cinematicGain = null;
    }
    _cinematicProfile = null;
    _running = false;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

export const AmbientSoundEngine = {

    /**
     * Start the resurrection oscillator for the generation phase.
     * Any previous session is killed instantly before starting.
     *
     * @param {Object} artwork — currentArtwork from State
     */
    start(artwork) {
        _killAll();

        const ctx = AudioUnlock.getContext();
        if (!ctx) {
            console.warn('[Ambient] AudioContext unavailable — ambient skipped.');
            return;
        }

        const gain       = ctx.createGain();
        gain.gain.value  = 0;
        // Route through music bus — resurrection oscillator is background texture
        gain.connect(AudioMixer.getMusicBus());

        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.10, now + 1.5);  // fade in 1.5 s (raised gain)

        _resurrectionGain  = gain;
        _resurrectionNodes = _buildResurrection(ctx, gain);
        _running           = true;

        console.log('[Ambient] Resurrection oscillator started.');
    },

    /**
     * Crossfade from the resurrection oscillator to the full cinematic atmosphere.
     * Called just before the narration screen appears (character is now available).
     *
     * The transition takes 2 seconds:
     *   - Resurrection fades OUT from its current level to 0
     *   - Cinematic profile fades IN from 0 to its target gain
     *
     * This must feel magical — the century materialises as the voice prepares to speak.
     *
     * @param {Object}      narrative — generated character (improves profile accuracy)
     * @param {Object}      artwork   — currentArtwork
     */
    crossfadeToNarration(narrative, artwork) {
        const ctx = AudioUnlock.getContext();
        if (!ctx) return;

        const profile    = _selectProfile(artwork, narrative);
        _cinematicProfile = profile;

        const now = ctx.currentTime;

        // ── Fade OUT resurrection oscillator ─────────────────────────────────
        if (_resurrectionGain) {
            const rg = _resurrectionGain;
            const rn = _resurrectionNodes;
            rg.gain.cancelScheduledValues(now);
            rg.gain.setValueAtTime(rg.gain.value, now);
            rg.gain.linearRampToValueAtTime(0, now + 2.0);
            // Destroy after fade
            setTimeout(() => {
                _destroyNodes(rn);
                try { rg.disconnect(); } catch (_) {}
            }, 2200);
            _resurrectionGain  = null;
            _resurrectionNodes = null;
        }

        // ── Build and fade IN cinematic layer ────────────────────────────────
        const master       = ctx.createGain();
        master.gain.value  = 0;
        // Dry signal → music bus; reverb wet output also routed to music bus inside builders
        master.connect(AudioMixer.getMusicBus());

        const profileNodes = profile.build(ctx, master);
        _cinematicNodes    = profileNodes;
        _cinematicGain     = master;

        master.gain.setValueAtTime(0, now);
        master.gain.linearRampToValueAtTime(profile.gain, now + 2.0);  // fade in 2 s

        console.log(`[Ambient] Crossfade → "${profile.id}" — "${profile.label}"`);
    },

    /**
     * Fade out all active audio over 2 seconds.
     * Returns a Promise that resolves when the fade is complete.
     * Called once narration ends.
     */
    stop() {
        const ctx = AudioUnlock.getContext();
        if (!ctx || (!_resurrectionGain && !_cinematicGain)) return Promise.resolve();

        const now = ctx.currentTime;

        const fadeGain = (gainNode) => {
            if (!gainNode) return;
            try {
                gainNode.gain.cancelScheduledValues(now);
                gainNode.gain.setValueAtTime(gainNode.gain.value, now);
                gainNode.gain.linearRampToValueAtTime(0, now + 2.0);
            } catch (_) {}
        };

        fadeGain(_resurrectionGain);
        fadeGain(_cinematicGain);

        const rn = _resurrectionNodes;
        const rg = _resurrectionGain;
        const cn = _cinematicNodes;
        const cg = _cinematicGain;

        _resurrectionNodes = null; _resurrectionGain = null;
        _cinematicNodes    = null; _cinematicGain    = null;
        _cinematicProfile  = null; _running          = false;

        return new Promise(resolve => {
            setTimeout(() => {
                _destroyNodes(rn);
                _destroyNodes(cn);
                try { rg?.disconnect(); } catch (_) {}
                try { cg?.disconnect(); } catch (_) {}
                console.log('[Ambient] Fade-out complete.');
                resolve();
            }, 2200);
        });
    },

    /**
     * Instant cut — error recovery / forced exit.
     */
    stopNow() {
        _killAll();
        console.log('[Ambient] Stopped immediately.');
    },

    /** True while any audio layer is active. */
    isRunning() {
        return _running;
    },
};
