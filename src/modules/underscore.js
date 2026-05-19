/**
 * LORE — Emotional Underscore Engine
 *
 * A real-time adaptive musical layer that plays UNDER the narration voice.
 * Generated entirely from Web Audio API primitives — no external files, no paid APIs.
 *
 * ── DESIGN PRINCIPLE ─────────────────────────────────────────────────────────
 *
 *  This must NEVER become music. It is "memory under speech":
 *   • Subtle, reactive, atmospheric, emotionally suggestive
 *   • Voice is ALWAYS dominant — underscore ducks on every spoken word
 *   • At max gain, the underscore is nearly inaudible when voice is active
 *
 * ── SIDECHAIN DUCKING ────────────────────────────────────────────────────────
 *
 *  ElevenLabs mode  — reads real-time RMS from the shared AnalyserNode via RAF.
 *                     Fast attack (30 ms), slow release (300 ms) for naturalness.
 *
 *  Speech mode      — hooks into speechContext callbacks (onWaveformStart / End /
 *                     Segment) to apply coarse per-segment ducking without an
 *                     analyser. Chains callbacks non-destructively.
 *
 *  Cannot-return    — runs at constant very low gain; no sync available.
 *
 * ── GAIN BUDGET ──────────────────────────────────────────────────────────────
 *
 *   masterGain = BASE_GAIN × intensityFactor × duckFactor
 *
 *   BASE_GAIN        0.022   (ceiling — never louder than this)
 *   intensityFactor  0.10–0.60  (derived from emotionalState keywords)
 *   duckFactor       0.12 (voice active) → 1.0 (silence)
 *
 *   Worst-case at full intensity + speaking:  0.022 × 0.60 × 0.12 ≈ 0.0016
 *   Best-case at full intensity + silence:    0.022 × 0.60 × 1.00 ≈ 0.013
 *   Both values are well below any perceptible foreground level.
 *
 * ── PUBLIC API ───────────────────────────────────────────────────────────────
 *
 *   Underscore.start(narrative, artwork, { analyserNode, speechContext })
 *   Underscore.stop()       — 1.5 s fade, returns Promise
 *   Underscore.stopNow()    — instant cut (exit / error)
 */

import { AudioUnlock } from './audioUnlock.js';
import { AudioMixer } from './audioMixer.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_GAIN       = 0.08;    // absolute ceiling — raised for audibility through music bus
const FADE_IN_MS      = 800;
const FADE_OUT_MS     = 1500;
const DUCK_ACTIVE     = 0.12;    // gain factor while voice is audible
const DUCK_IDLE       = 1.0;     // gain factor during silence / pauses
const RMS_THRESHOLD   = 0.045;   // above this → voice is speaking
const ATTACK_COEFF    = 0.35;    // duck smoothing: fast attack
const RELEASE_COEFF   = 0.04;    // duck smoothing: slow release

// ─────────────────────────────────────────────────────────────────────────────
// INTENSITY MAPPING  (emotionalState keyword → 0.10–0.60)
// ─────────────────────────────────────────────────────────────────────────────

const INTENSITY_KEYWORDS = [
    { level: 0.60, words: ['violent', 'rage', 'fury', 'uprising', 'massacre', 'murder'] },
    { level: 0.55, words: ['tragic', 'tragedy', 'devastat', 'shatter', 'broken', 'dying', 'death'] },
    { level: 0.45, words: ['dramatic', 'obsess', 'torment', 'haunt', 'anguish', 'despair', 'ruin'] },
    { level: 0.35, words: ['grief', 'longing', 'sorrow', 'mourning', 'regret', 'guilt', 'loss', 'melanchol'] },
    { level: 0.25, words: ['mysterious', 'secret', 'hidden', 'shadow', 'unseen', 'silence', 'forgotten'] },
    { level: 0.15, words: ['calm', 'peace', 'serenity', 'devotion', 'prayer', 'gentle', 'tender'] },
];

function _deriveIntensity(emotionalState = '') {
    const hay = emotionalState.toLowerCase();
    for (const { level, words } of INTENSITY_KEYWORDS) {
        if (words.some(w => hay.includes(w))) return level;
    }
    return 0.20;   // default: quietly present
}

// ─────────────────────────────────────────────────────────────────────────────
// NOISE BUFFER FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function _noiseBuffer(ctx, colour = 'pink') {
    const len  = ctx.sampleRate * 2;
    const buf  = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);

    if (colour === 'pink') {
        let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
            b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
            b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
            data[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
            b6 = w*0.115926;
        }
    } else {
        let last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            data[i] = last * 3.5;
        }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;
    return src;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELAY REVERB HELPER
// ─────────────────────────────────────────────────────────────────────────────

function _reverbTail(ctx, size = 0.4) {
    const input  = ctx.createGain();
    const output = ctx.createGain();
    output.gain.value = 0.45 + size * 0.3;

    [0.031, 0.053, 0.079].forEach(t => {
        const d  = ctx.createDelay(1.0);
        const fb = ctx.createGain();
        d.delayTime.value = t * (0.5 + size);
        fb.gain.value     = 0.18 + size * 0.2;
        input.connect(d);
        d.connect(fb);
        fb.connect(d);
        d.connect(output);
    });

    // NOTE: output left unconnected — callers wire output → AudioMixer.getMusicBus()
    return { input, output };
}

// ─────────────────────────────────────────────────────────────────────────────
// LFO HELPER
// ─────────────────────────────────────────────────────────────────────────────

function _lfo(ctx, rate, depth, param) {
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

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE BUILDERS
// Each receives (ctx, masterGain) and returns [nodes…] for later cleanup.
// All relative gains are mixing ratios — absolute level is controlled by master.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Renaissance / Italian — warm sine drones, harmonic intervals, candle softness
function _profileRenaissance(ctx, master) {
    const nodes = [];

    // Fundamental + fifth + octave — pure sine, intimate and warm
    [[220, 1.0], [330, 0.50], [440, 0.22]].forEach(([freq, rel]) => {
        const osc  = ctx.createOscillator();
        const g    = ctx.createGain();
        osc.type            = 'sine';
        osc.frequency.value = freq;
        g.gain.value        = rel * 0.55;
        osc.connect(g); g.connect(master); osc.start(0);
        nodes.push(osc, g);
        // Slow candle-breath LFO on each partial
        nodes.push(..._lfo(ctx, 0.06 + freq * 0.0002, rel * 0.08, g.gain));
    });

    // Soft room tone (very low noise floor)
    const noise = _noiseBuffer(ctx, 'brown');
    const lpf   = ctx.createBiquadFilter();
    const ng    = ctx.createGain();
    lpf.type = 'lowpass'; lpf.frequency.value = 160;
    ng.gain.value = 0.12;
    noise.connect(lpf); lpf.connect(ng); ng.connect(master); noise.start(0);
    nodes.push(noise, lpf, ng);

    // Reverb tail for cathedral depth
    const rev = _reverbTail(ctx, 0.75);
    master.connect(rev.input);
    rev.output.connect(AudioMixer.getMusicBus());
    nodes.push(rev.input, rev.output);

    return nodes;
}

// ── 2. Revolutionary / French — sawtooth tension pulse, sub rumble, crowd texture
function _profileRevolutionary(ctx, master) {
    const nodes = [];

    // Low brass sawtooth → tamed by lowpass
    const saw  = ctx.createOscillator();
    const slpf = ctx.createBiquadFilter();
    const sg   = ctx.createGain();
    saw.type            = 'sawtooth';
    saw.frequency.value = 110;
    slpf.type = 'lowpass'; slpf.frequency.value = 260;
    sg.gain.value = 0.60;
    saw.connect(slpf); slpf.connect(sg); sg.connect(master); saw.start(0);
    nodes.push(saw, slpf, sg);

    // Sub bass rumble
    const sub  = ctx.createOscillator();
    const subg = ctx.createGain();
    sub.type = 'sine'; sub.frequency.value = 55;
    subg.gain.value = 0.45;
    sub.connect(subg); subg.connect(master); sub.start(0);
    nodes.push(sub, subg);

    // Irregular pulse LFO on sawtooth (tension breathes unevenly)
    nodes.push(..._lfo(ctx, 0.24, 0.28, sg.gain));

    // Distant crowd murmur: pink noise → bandpass
    const crowd  = _noiseBuffer(ctx, 'pink');
    const cbpf   = ctx.createBiquadFilter();
    const cg     = ctx.createGain();
    cbpf.type = 'bandpass'; cbpf.frequency.value = 650; cbpf.Q.value = 1.8;
    cg.gain.value = 0.14;
    crowd.connect(cbpf); cbpf.connect(cg); cg.connect(master); crowd.start(0);
    nodes.push(crowd, cbpf, cg);

    // Slow swell on master (historical weight)
    nodes.push(..._lfo(ctx, 0.035, 0.10, master.gain));

    return nodes;
}

// ── 3. British / Narrative — stable triangle motif, controlled, observational
function _profileBritish(ctx, master) {
    const nodes = [];

    // Triangle wave — soft, classical, non-threatening
    [[220, 0.80], [330, 0.32]].forEach(([freq, rel]) => {
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        g.gain.value = rel;
        osc.connect(g); g.connect(master); osc.start(0);
        nodes.push(osc, g);
    });

    // Stable, gentle pulse — controlled British restraint
    nodes.push(..._lfo(ctx, 0.12, 0.18, nodes[1].gain));

    // Soft room noise
    const noise = _noiseBuffer(ctx, 'brown');
    const lpf   = ctx.createBiquadFilter();
    const ng    = ctx.createGain();
    lpf.type = 'lowpass'; lpf.frequency.value = 200;
    ng.gain.value = 0.10;
    noise.connect(lpf); lpf.connect(ng); ng.connect(master); noise.start(0);
    nodes.push(noise, lpf, ng);

    const rev = _reverbTail(ctx, 0.40);
    master.connect(rev.input);
    rev.output.connect(AudioMixer.getMusicBus());
    nodes.push(rev.input, rev.output);

    return nodes;
}

// ── 4. Maritime / Solitude — wind-like noise, deep drone, slow wave amplitude
function _profileMaritime(ctx, master) {
    const nodes = [];

    // Deep melancholic drone
    const drone = ctx.createOscillator();
    const dg    = ctx.createGain();
    drone.type = 'sine'; drone.frequency.value = 68;
    dg.gain.value = 0.55;
    drone.connect(dg); dg.connect(master); drone.start(0);
    nodes.push(drone, dg);

    // Wind: pink noise → bandpass
    const wind = _noiseBuffer(ctx, 'pink');
    const wbpf = ctx.createBiquadFilter();
    const wg   = ctx.createGain();
    wbpf.type = 'bandpass'; wbpf.frequency.value = 360; wbpf.Q.value = 0.7;
    wg.gain.value = 0.35;
    wind.connect(wbpf); wbpf.connect(wg); wg.connect(master); wind.start(0);
    nodes.push(wind, wbpf, wg);

    // Wave rhythm on wind gain (0.09 Hz — one swell every ~11 s)
    nodes.push(..._lfo(ctx, 0.09, 0.22, wg.gain));
    // Vast ocean swell on master
    nodes.push(..._lfo(ctx, 0.03, 0.08, master.gain));

    return nodes;
}

// ── 5. German / Structured — precise harmonics, minimal LFO, clean layering
function _profileGerman(ctx, master) {
    const nodes = [];

    // Pure harmonic series — precise, architectural
    [[220, 1.0], [440, 0.45], [660, 0.18]].forEach(([freq, rel]) => {
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.value = rel * 0.60;
        osc.connect(g); g.connect(master); osc.start(0);
        nodes.push(osc, g);
    });

    // Minimal variation — one very slow LFO only
    nodes.push(..._lfo(ctx, 0.04, 0.06, master.gain));

    const rev = _reverbTail(ctx, 0.35);
    master.connect(rev.input);
    rev.output.connect(AudioMixer.getMusicBus());
    nodes.push(rev.input, rev.output);

    return nodes;
}

// ── 6. Eastern / Japanese — sparse sine tones, long decay, silence as texture
function _profileEastern(ctx, master) {
    const nodes = [];

    // Sparse pentatonic pair — D and A (open fifth — contemplative)
    [[293, 0.70], [440, 0.28]].forEach(([freq, rel]) => {
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.value = rel;
        osc.connect(g); g.connect(master); osc.start(0);
        nodes.push(osc, g);
    });

    // Long resonant delay tail — emphasises silence between tones
    const rev = _reverbTail(ctx, 0.90);
    master.connect(rev.input);
    rev.output.connect(AudioMixer.getMusicBus());
    nodes.push(rev.input, rev.output);

    // Very slow, deep breath (one cycle every ~25 s)
    nodes.push(..._lfo(ctx, 0.04, 0.20, nodes[1].gain));
    nodes.push(..._lfo(ctx, 0.025, 0.08, master.gain));

    return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE REGISTRY  &  SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

const PROFILES = [
    {
        id:    'renaissance',
        build: _profileRenaissance,
        keys:  ['italian', 'florentine', 'tuscan', 'venetian', 'roman', 'milanese',
                'renaissance', 'leonardo', 'michelangelo', 'raphael', 'workshop',
                'sacred', 'monk', 'friar', 'cathedral', 'church', 'spiritual', 'divine',
                'spanish', 'portuguese', 'mediterranean'],
    },
    {
        id:    'revolutionary',
        build: _profileRevolutionary,
        keys:  ['french', 'revolution', 'paris', 'guillotine', 'conflict', 'rupture',
                'soldier', 'uprising', 'war', 'political', 'prison', 'execution',
                'delacroix', 'marat', 'republic', 'violent', 'rage', 'drama',
                'caravaggio', 'baroque', 'shadow', 'dramatic'],
    },
    {
        id:    'british',
        build: _profileBritish,
        keys:  ['british', 'english', 'scottish', 'irish', 'welsh', 'london',
                'victorian', 'georgian', 'narrative', 'observer', 'witness',
                'portrait', 'aristocrat', 'duchess', 'lord', 'gentleman'],
    },
    {
        id:    'maritime',
        build: _profileMaritime,
        keys:  ['sea', 'ship', 'sailor', 'ocean', 'medusa', 'raft', 'wreck',
                'maritime', 'harbor', 'port', 'fisherman', 'wave', 'storm',
                'dutch', 'flemish', 'nordic', 'northern', 'solitude', 'asylum',
                'van gogh', 'melanchol', 'fog', 'isolation', 'wanderer'],
    },
    {
        id:    'german',
        build: _profileGerman,
        keys:  ['german', 'austrian', 'prussian', 'bavarian', 'vienna', 'académic',
                'academic', 'structured', 'scholar', 'professor', 'architect',
                'precise', 'methodical'],
    },
    {
        id:    'eastern',
        build: _profileEastern,
        keys:  ['japanese', 'chinese', 'korean', 'eastern', 'asian', 'kyoto',
                'edo', 'tokyo', 'osaka', 'beijing', 'canton', 'contemplat',
                'zen', 'silence', 'sparse', 'meditat'],
    },
];

function _selectProfile(narrative, artwork) {
    const haystack = [
        narrative?.nationality     || '',
        narrative?.emotionalState  || '',
        narrative?.characterBio    || '',
        narrative?.roleDescription || '',
        artwork?.nationality       || '',
        artwork?.artist            || '',
        artwork?.title             || '',
    ].join(' ').toLowerCase();

    let best  = null;
    let score = 0;

    for (const p of PROFILES) {
        let s = 0;
        for (const k of p.keys) if (haystack.includes(k)) s++;
        if (s > score) { score = s; best = p; }
    }

    const chosen = best || PROFILES[0];
    console.log(`[Underscore] Profile → "${chosen.id}" (score ${score})`);
    return chosen;
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE CLEANUP HELPER
// ─────────────────────────────────────────────────────────────────────────────

function _destroyNodes(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
        try {
            if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) n.stop(0);
            n.disconnect();
        } catch (_) {}
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE STATE
// ─────────────────────────────────────────────────────────────────────────────

let _running       = false;
let _nodes         = null;        // all synthesis nodes
let _masterGain    = null;        // GainNode — absolute level
let _duckFactor    = DUCK_IDLE;   // smoothed sidechain value
let _intensity     = 0.20;        // derived from emotionalState
let _rafId         = null;        // requestAnimationFrame handle
let _analyser      = null;        // AnalyserNode (ElevenLabs mode)
let _rmsBuffer     = null;        // Uint8Array reused each frame

// ─────────────────────────────────────────────────────────────────────────────
// SIDECHAIN  — ElevenLabs path (real analyser RMS)
// ─────────────────────────────────────────────────────────────────────────────

function _sidechainLoop() {
    if (!_running) return;

    if (_analyser && _rmsBuffer) {
        _analyser.getByteFrequencyData(_rmsBuffer);

        let sum = 0;
        for (let i = 0; i < _rmsBuffer.length; i++) {
            const norm = _rmsBuffer[i] / 255;
            sum += norm * norm;
        }
        const rms = Math.sqrt(sum / _rmsBuffer.length);

        // Asymmetric smoothing: duck fast, release slow (sounds natural)
        const voiceActive = rms > RMS_THRESHOLD;
        const target      = voiceActive ? DUCK_ACTIVE : DUCK_IDLE;
        const coeff       = _duckFactor > target ? ATTACK_COEFF : RELEASE_COEFF;
        const prev        = _duckFactor;
        _duckFactor       = _duckFactor + (target - _duckFactor) * coeff;

        // Trigger mixer-level ducking on state transitions — NOT by writing
        // .gain.value directly (that would cancel AudioParam ramp automations).
        // Only fire on meaningful threshold crossings to avoid constant scheduling.
        const threshold = 0.05;
        if (prev >= DUCK_ACTIVE + threshold && _duckFactor < DUCK_ACTIVE + threshold) {
            AudioMixer.onVoiceStart();   // crossed into ducked territory
        } else if (prev <= DUCK_IDLE - threshold && _duckFactor > DUCK_IDLE - threshold) {
            AudioMixer.onVoiceEnd();     // crossed back into idle territory
        }
    }

    _rafId = requestAnimationFrame(_sidechainLoop);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDECHAIN  — Speech mode path (callback-based coarse ducking)
// Chains into speechContext callbacks without clobbering existing listeners.
// ─────────────────────────────────────────────────────────────────────────────

function _attachSpeechDucking(speechContext) {
    if (!speechContext) return;

    // onWaveformSegment fires at the START of each utterance segment.
    // Use AudioMixer.onVoiceStart/End so the duck applies to the shared music bus,
    // NOT to the underscore's own master (which would conflict with its fade-in ramp).
    const prevSegment = speechContext.onWaveformSegment || null;
    speechContext.onWaveformSegment = (segIdx) => {
        if (prevSegment) prevSegment(segIdx);
        AudioMixer.onVoiceStart();   // duck the music bus on the mixer
        // Schedule restore after a conservative utterance duration
        clearTimeout(_duckReleaseTimer);
        _duckReleaseTimer = setTimeout(() => AudioMixer.onVoiceEnd(), 3200);
    };

    // onWaveformEnd fires when all speech is truly done
    const prevEnd = speechContext.onWaveformEnd || null;
    speechContext.onWaveformEnd = () => {
        if (prevEnd) prevEnd();
        clearTimeout(_duckReleaseTimer);
        AudioMixer.onVoiceEnd();
    };
}

let _duckReleaseTimer = null;

// _applyDuck removed — ducking is now handled by AudioMixer.onVoiceStart/End
// which operates on the shared music bus, preventing conflicts with the
// underscore's own fade-in AudioParam automation.

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export const Underscore = {

    /**
     * Build and fade in the emotional underscore layer.
     *
     * Called from flowController.startNarration() after draw5BarWaveform and
     * SubtitleEngine.start() have wired their callbacks, so chaining is safe.
     *
     * @param {Object}      narrative      — State.currentNarrative
     * @param {Object}      artwork        — State.currentArtwork
     * @param {Object}      opts
     * @param {AnalyserNode|null}  opts.analyserNode   — ElevenLabs path
     * @param {Object|null}       opts.speechContext   — speech path
     */
    start(narrative, artwork, { analyserNode = null, speechContext = null } = {}) {
        // Clean up any previous session
        this.stopNow();

        const ctx = AudioUnlock.getContext();
        if (!ctx) {
            console.warn('[Underscore] AudioContext unavailable — skipped.');
            return;
        }

        const profile  = _selectProfile(narrative, artwork);
        _intensity     = _deriveIntensity(narrative?.emotionalState || '');

        console.log(`[Underscore] Starting — profile:"${profile.id}"  intensity:${_intensity.toFixed(2)}  mode:${analyserNode ? 'elevenlabs' : speechContext ? 'speech' : 'silent'}`);

        // Master gain — starts at 0, fades in over FADE_IN_MS
        // Route dry signal through music bus (not directly to destination)
        const master       = ctx.createGain();
        master.gain.value  = 0;
        master.connect(AudioMixer.getMusicBus());

        // Build synthesis graph
        const profileNodes = profile.build(ctx, master);

        _masterGain = master;
        _nodes      = profileNodes;
        _running    = true;
        _duckFactor = DUCK_IDLE;

        // ── Fade in ───────────────────────────────────────────────────────────
        // Fade in to BASE_GAIN × intensity — duck factor no longer applied here.
        // Ducking is handled at mixer level (AudioMixer.musicBus) so this node
        // simply reflects the emotional intensity of the profile.
        const targetGain = BASE_GAIN * _intensity;
        const now        = ctx.currentTime;
        master.gain.setValueAtTime(0, now);
        master.gain.linearRampToValueAtTime(targetGain, now + FADE_IN_MS / 1000);
        console.log('UNDERSCORE PLAYING', '| profile:', profile.id, '| gain target:', targetGain.toFixed(4));

        // ── Wire sidechain ────────────────────────────────────────────────────
        if (analyserNode) {
            // ElevenLabs: real-time RMS loop
            _analyser   = analyserNode;
            _rmsBuffer  = new Uint8Array(analyserNode.frequencyBinCount);
            _rafId      = requestAnimationFrame(_sidechainLoop);

        } else if (speechContext) {
            // Speech mode: callback-based segment ducking
            _attachSpeechDucking(speechContext);
        }
        // Silent mode: no sidechain — stays at constant very-low gain
    },

    /**
     * Fade out and stop over 1.5 s.
     * Returns a Promise that resolves when complete.
     * Called in the post-audio cleanup sequence alongside AmbientSoundEngine.stop().
     */
    stop() {
        if (!_masterGain || !_running) return Promise.resolve();

        const ctx  = AudioUnlock.getContext();
        const gain = _masterGain;
        const nds  = _nodes;

        // Cancel RAF sidechain loop immediately
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        clearTimeout(_duckReleaseTimer);

        _running    = false;
        _masterGain = null;
        _nodes      = null;
        _analyser   = null;
        _rmsBuffer  = null;

        return new Promise(resolve => {
            try {
                const now = ctx.currentTime;
                gain.gain.cancelScheduledValues(now);
                gain.gain.setValueAtTime(gain.gain.value, now);
                gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_MS / 1000);

                setTimeout(() => {
                    _destroyNodes(nds);
                    try { gain.disconnect(); } catch (_) {}
                    console.log('[Underscore] Fade-out complete.');
                    resolve();
                }, FADE_OUT_MS + 200);

            } catch (err) {
                console.warn('[Underscore] stop() error:', err.message);
                _destroyNodes(nds);
                resolve();
            }
        });
    },

    /**
     * Instant cut — forced exit / error recovery.
     * Fire and forget; does NOT return a Promise.
     */
    stopNow() {
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        clearTimeout(_duckReleaseTimer);

        const nds  = _nodes;
        const gain = _masterGain;

        _running    = false;
        _masterGain = null;
        _nodes      = null;
        _analyser   = null;
        _rmsBuffer  = null;

        if (gain) {
            try { gain.gain.value = 0; gain.disconnect(); } catch (_) {}
        }
        _destroyNodes(nds);

        console.log('[Underscore] Stopped immediately.');
    },

    /** True while the underscore is active (including fade transitions). */
    isRunning() {
        return _running;
    },
};
