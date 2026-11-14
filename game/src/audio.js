// SLAGLINE — synthesized sound. Pure WebAudio: oscillators + one shared
// noise buffer + filters + envelopes. No audio files, no network.
// The AudioContext is created on the first user gesture (browser policy);
// in ?shot= mode everything stays silent so screenshots stay clean.
// Distance: gain = 1 / (1 + d / 8), and distant sounds get darker.
import * as THREE from 'three';

const NOISE_SECONDS = 1;

let ctx = null;
let master = null;
let noiseBuffer = null;
let listenerPos = new THREE.Vector3(0, 0, 0);
let shotMode = false;

try {
  shotMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('shot');
} catch (err) {
  shotMode = false;
}

function ensureContext() {
  if (ctx || shotMode) return ctx;
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  ctx = new window.AudioContext();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.ratio.value = 8;
  compressor.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(compressor);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  // Deterministic fill: a tiny LCG, never a nondeterministic call in the audio path.
  let seed = 0x9e3779b9;
  for (let i = 0; i < data.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    data[i] = (seed >>> 0) / 4294967296 * 2 - 1;
  }
  return ctx;
}

// Public: call once from the first pointer/key gesture.
export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume();
}

export function setListenerPos(pos) {
  listenerPos.set(pos.x, pos.y || 0, pos.z);
}

function distanceGain(pos) {
  if (!pos) return { gain: 1, cutoff: 18000 };
  const dx = pos.x - listenerPos.x;
  const dy = (pos.y || 0) - listenerPos.y;
  const dz = pos.z - listenerPos.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { gain: 1 / (1 + d / 8), cutoff: Math.max(400, 18000 / (1 + d / 6)) };
}

function tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.1, gain = 0.5, at = 0, cutoff = null }) {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let node = osc;
  if (cutoff !== null) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    osc.connect(filter);
    node = filter;
  }
  node.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.1, gain = 0.5, at = 0, filterType = 'lowpass', freq = 3000, freqEnd = null, q = 0.8 }) {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// One recipe per named sound. `g` scales with distance; `cutoff` is the
const RECIPES = {
  shot_p9(cutoff, g) {
    noise({ dur: 0.07, gain: 0.55 * g, freq: Math.min(cutoff, 4200), freqEnd: 900 });
    tone({ type: 'square', freq: 180, freqEnd: 55, dur: 0.05, gain: 0.25 * g });
  },
  shot_p50(cutoff, g) {
    noise({ dur: 0.1, gain: 0.65 * g, freq: Math.min(cutoff, 3600), freqEnd: 700 });
    tone({ type: 'square', freq: 150, freqEnd: 45, dur: 0.07, gain: 0.3 * g });
  },
  shot_kestrel(cutoff, g) {
    noise({ dur: 0.06, gain: 0.5 * g, freq: Math.min(cutoff, 5200), freqEnd: 1400 });
    tone({ type: 'square', freq: 220, freqEnd: 70, dur: 0.04, gain: 0.18 * g });
  },
  shot_mule(cutoff, g) {
    noise({ dur: 0.18, gain: 0.8 * g, freq: Math.min(cutoff, 1800), freqEnd: 300 });
    tone({ type: 'sine', freq: 70, freqEnd: 40, dur: 0.16, gain: 0.5 * g });
  },
  shot_ar7(cutoff, g) {
    noise({ dur: 0.09, gain: 0.7 * g, freq: Math.min(cutoff, 3500), freqEnd: 800 });
    tone({ type: 'square', freq: 160, freqEnd: 40, dur: 0.06, gain: 0.28 * g });
  },
  shot_vigil(cutoff, g) {
    noise({ dur: 0.26, gain: 0.8 * g, freq: Math.min(cutoff, 5000), freqEnd: 500 });
    noise({ dur: 0.12, gain: 0.3 * g, at: 0.1, filterType: 'highpass', freq: 2500 });
    tone({ type: 'sine', freq: 110, freqEnd: 35, dur: 0.2, gain: 0.35 * g });
  },
  reload(_cutoff, g) {
    noise({ dur: 0.03, gain: 0.35 * g, freq: 2400, q: 4 });
    noise({ dur: 0.03, gain: 0.35 * g, at: 0.25, freq: 1600, q: 4 });
    noise({ dur: 0.04, gain: 0.4 * g, at: 0.55, freq: 3200, q: 4 });
  },
  step(_cutoff, g) {
    noise({ dur: 0.06, gain: 0.22 * g, freq: 500, freqEnd: 200 });
  },
  dryfire(_cutoff, g) {
    tone({ type: 'square', freq: 1800, dur: 0.03, gain: 0.3 * g });
  },
  hit(_cutoff, g) {
    tone({ type: 'sine', freq: 2200, dur: 0.03, gain: 0.35 * g });
  },
  kill(_cutoff, g) {
    tone({ type: 'sine', freq: 2200, dur: 0.03, gain: 0.35 * g });
    tone({ type: 'sine', freq: 1600, dur: 0.05, gain: 0.35 * g, at: 0.06 });
  },
  plant_beep(_cutoff, g) {
    tone({ type: 'sine', freq: 880, dur: 0.08, gain: 0.4 * g });
  },
  // Periodic beep of a planted charge. bomb.js calls it once a second
  charge_beep(_cutoff, g) {
    tone({ type: 'sine', freq: 1320, dur: 0.06, gain: 0.45 * g });
  },
  scope(_cutoff, g) {
    tone({ type: 'sine', freq: 2400, dur: 0.02, gain: 0.25 * g });
    noise({ dur: 0.02, gain: 0.15 * g, freq: 3600, q: 2 });
  },
  plant_done(_cutoff, g) {
    tone({ type: 'sine', freq: 1320, dur: 0.15, gain: 0.45 * g });
    tone({ type: 'sine', freq: 1760, dur: 0.2, gain: 0.4 * g, at: 0.12 });
  },
  defuse_beep(_cutoff, g) {
    tone({ type: 'sine', freq: 1100, dur: 0.06, gain: 0.4 * g });
  },
  defuse_done(_cutoff, g) {
    tone({ type: 'sine', freq: 990, dur: 0.07, gain: 0.4 * g });
    tone({ type: 'sine', freq: 1320, dur: 0.07, gain: 0.4 * g, at: 0.08 });
    tone({ type: 'sine', freq: 1760, dur: 0.12, gain: 0.4 * g, at: 0.16 });
  },
  explosion(_cutoff, g) {
    noise({ dur: 0.7, gain: 1.0 * g, freq: 3000, freqEnd: 100 });
    tone({ type: 'sine', freq: 120, freqEnd: 30, dur: 0.6, gain: 0.8 * g });
  },
  round_win(_cutoff, g) {
    tone({ type: 'sine', freq: 660, dur: 0.15, gain: 0.4 * g });
    tone({ type: 'sine', freq: 990, dur: 0.25, gain: 0.4 * g, at: 0.15 });
  },
  round_lose(_cutoff, g) {
    tone({ type: 'sine', freq: 440, dur: 0.15, gain: 0.4 * g });
    tone({ type: 'sine', freq: 330, dur: 0.25, gain: 0.4 * g, at: 0.15 });
  },
  buy(_cutoff, g) {
    tone({ type: 'sine', freq: 1500, dur: 0.06, gain: 0.35 * g });
  },
  buy_error(_cutoff, g) {
    tone({ type: 'square', freq: 140, dur: 0.15, gain: 0.35 * g });
  },
  click(_cutoff, g) {
    tone({ type: 'sine', freq: 2000, dur: 0.02, gain: 0.25 * g });
  },
};

// `name` is a recipe key ('shot_ar7', 'reload', 'explosion', ...).
export const Audio = {
  play(name, pos) {
    if (shotMode) return;
    const recipe = RECIPES[name];
    if (!recipe) return;
    ensureContext();
    if (!ctx) return;
    const { gain, cutoff } = distanceGain(pos);
    if (gain < 0.02) return;
    recipe(cutoff, gain);
  },
  unlock: unlockAudio,
  setListener: setListenerPos,
};
