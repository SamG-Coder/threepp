import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIRE_PATTERN_SEED,
  FIRE_SCORE_CUES,
  FIRE_SCORE_SECTIONS,
  FIRE_SCORE_TRACK,
} from "../src/fire-score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", "assets", "cin-sin-fire-pattern-233.wav");
const {
  sampleRate,
  durationSeconds,
  channels,
  bitsPerSample,
  bpm,
  beatsPerBar,
  bars,
} = FIRE_SCORE_TRACK;
const bytesPerSample = bitsPerSample / 8;
const blockAlign = channels * bytesPerSample;
const frameCount = Math.round(durationSeconds * sampleRate);
const beatSeconds = 60 / bpm;
const barSeconds = beatSeconds * beatsPerBar;
const beatFrames = sampleRate * beatSeconds;
const left = new Float32Array(frameCount);
const right = new Float32Array(frameCount);
const tau = Math.PI * 2;

if (durationSeconds !== 180 || sampleRate !== 48_000 || channels !== 2 || bitsPerSample !== 16) {
  throw new Error("Fire score output contract changed unexpectedly.");
}
if (bars * barSeconds !== durationSeconds || FIRE_SCORE_SECTIONS.length !== 9 || FIRE_SCORE_CUES.length !== 233) {
  throw new Error("Fire score timeline contract changed unexpectedly.");
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(text))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const seedHash = fnv1a(FIRE_PATTERN_SEED);
function hashUint(a = 0, b = 0, c = 0) {
  let value = seedHash ^ Math.imul((a | 0) + 1, 0x9e3779b1);
  value ^= Math.imul((b | 0) + 17, 0x85ebca6b);
  value ^= Math.imul((c | 0) + 101, 0xc2b2ae35);
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return (value ^ value >>> 15) >>> 0;
}
const hash01 = (a, b, c) => hashUint(a, b, c) / 0x1_0000_0000;
const hashNoise = (sample, salt = 0) => hash01(sample, salt, 0x9f) * 2 - 1;
const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const midiFrequency = midi => 440 * 2 ** ((midi - 69) / 12);
const sectionForBar = bar => FIRE_SCORE_SECTIONS.find(section =>
  bar >= section.firstBar && bar < section.finalBar
) ?? FIRE_SCORE_SECTIONS.at(-1);

const MODES = Object.freeze({
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "dorian-sharp-four": [0, 2, 3, 6, 7, 9, 10],
  "phrygian-dominant": [0, 1, 4, 5, 7, 8, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "lydian-minor": [0, 2, 4, 6, 7, 8, 10],
  octatonic: [0, 1, 3, 4, 6, 7, 9, 10],
  "minor-add-nine": [0, 2, 3, 5, 7, 8, 10],
});
const P4_MOTIF = [0, 5, 2, 10, 7, 3, 12, 8, 15, 5, 17, 14, 22];

function equalPowerPan(pan) {
  const unit = (clamp(pan, -1, 1) + 1) * Math.PI * 0.25;
  return [Math.cos(unit), Math.sin(unit)];
}

function addStereo(frame, value, pan = 0) {
  if (frame < 0 || frame >= frameCount) return;
  const [leftGain, rightGain] = equalPowerPan(pan);
  left[frame] += value * leftGain;
  right[frame] += value * rightGain;
}

function renderPadVoice(startFrame, seconds, frequency, gain, pan, salt) {
  const count = Math.min(Math.round(seconds * sampleRate), frameCount - startFrame);
  if (count <= 0) return;
  const [leftGain, rightGain] = equalPowerPan(pan);
  let phase = hash01(salt, 1, 8) * tau;
  const increment = tau * frequency / sampleRate;
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const remaining = (count - 1 - sample) / sampleRate;
    const envelope = (1 - Math.exp(-age * 7.5)) * (1 - Math.exp(-remaining * 5.5));
    const slowMotion = 0.86 + Math.sin(tau * (0.071 + (salt % 7) * 0.006) * age + salt) * 0.14;
    const tone = (
      Math.sin(phase) +
      Math.sin(phase * 2.003 + 0.31) * 0.19 +
      Math.sin(phase * 3.997 + 0.77) * 0.075
    ) * envelope * slowMotion * gain;
    const frame = startFrame + sample;
    left[frame] += tone * leftGain;
    right[frame] += tone * rightGain;
    phase += increment;
  }
}

// Ninety-six individually voiced bars form a continuous harmonic climb. The
// root motion, inversion, added tone and stereo placement all depend on the
// absolute bar index, so no phrase-sized block is copied back into the score.
for (let bar = 0; bar < bars; ++bar) {
  const section = sectionForBar(bar);
  const scale = MODES[section.mode];
  const localBar = bar - section.firstBar;
  const degree = (bar * 5 + Math.floor(hash01(bar, section.index, 11) * scale.length)) % scale.length;
  const inversion = (bar + Math.floor(hash01(bar, 2, 19) * 4)) % 4;
  const startFrame = Math.round(bar * barSeconds * sampleRate);
  const duration = Math.min(barSeconds + 0.62, durationSeconds - bar * barSeconds);
  const padGain = (0.010 + section.energy * 0.0095) *
    (section.id === "ash-eye" ? 1.24 : section.id === "white-heat-cathedral" ? 0.86 : 1);
  for (let voice = 0; voice < 4; ++voice) {
    const scaleIndex = degree + voice * 2 + (voice >= 4 - inversion ? 1 : 0);
    const octaves = Math.floor(scaleIndex / scale.length);
    const semitone = scale[((scaleIndex % scale.length) + scale.length) % scale.length];
    const color = voice === 3 && (bar + section.index) % 3 === 0 ? 5 : 0; // seed's explicit P4
    const midi = section.rootMidi + 12 + semitone + octaves * 12 + color;
    renderPadVoice(
      startFrame,
      duration,
      midiFrequency(midi) * (1 + (voice - 1.5) * 0.00082),
      padGain * (voice === 0 ? 1 : 0.78),
      [-0.62, 0.48, -0.30, 0.66][voice],
      bar * 17 + voice * 41 + section.index,
    );
  }
}

function renderBass(startFrame, frequency, seconds, gain, pan, salt) {
  const count = Math.min(Math.round(seconds * sampleRate), frameCount - startFrame);
  let phase = hash01(salt, 7, 2) * tau;
  const increment = tau * frequency / sampleRate;
  const [leftGain, rightGain] = equalPowerPan(pan);
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const attack = 1 - Math.exp(-age * 105);
    const envelope = attack * Math.exp(-age * (seconds > 0.4 ? 6.2 : 10.5));
    const value = (
      Math.sin(phase) +
      Math.sin(phase * 2.001 + 0.23) * 0.39 +
      Math.sin(phase * 3.002 + 0.61) * 0.14
    ) * envelope * gain;
    const frame = startFrame + sample;
    left[frame] += value * leftGain;
    right[frame] += value * rightGain;
    phase += increment;
  }
}

// A new eight-step bass answer is derived for every bar. Density follows the
// fire lifecycle, while note choice rotates through the seed's perfect-fourth
// contour instead of repeating a stock bass loop.
for (let bar = 0; bar < bars; ++bar) {
  const section = sectionForBar(bar);
  const scale = MODES[section.mode];
  for (let eighth = 0; eighth < 8; ++eighth) {
    const absoluteStep = bar * 8 + eighth;
    const structural = eighth === 0 || eighth === 3 || eighth === 6;
    const gate = hash01(absoluteStep, section.index, 31);
    const threshold = section.index === 0 ? (structural ? 0.56 : 0.92) :
      section.index === 5 ? (structural ? 0.30 : 0.82) :
        section.index === 8 ? (eighth === 0 || eighth === 5 ? 0 : 1) :
          0.76 - section.density * 0.48 - (structural ? 0.18 : 0);
    if (gate < threshold) continue;
    const motif = P4_MOTIF[(absoluteStep + bar + section.index * 3) % P4_MOTIF.length];
    const scaleTone = scale[(bar + eighth * 2 + section.index) % scale.length];
    const midi = section.rootMidi - 12 + scaleTone + (motif % 12) * (eighth % 3 === 0 ? 0 : 0.25);
    const startFrame = Math.round((bar * barSeconds + eighth * beatSeconds * 0.5) * sampleRate);
    renderBass(
      startFrame,
      midiFrequency(midi),
      section.index === 5 || section.index === 8 ? 0.62 : 0.31 + hash01(bar, eighth, 4) * 0.11,
      0.19 + section.bass * 0.115,
      (hash01(absoluteStep, 4, 8) - 0.5) * 0.12,
      absoluteStep,
    );
  }
}

function renderKick(startFrame, gain, salt) {
  const count = Math.min(Math.round(sampleRate * 0.68), frameCount - startFrame);
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const attack = 1 - Math.exp(-age * 240);
    const phase = tau * (45 * age + 75 * (1 - Math.exp(-age * 22)) / 22);
    const body = Math.sin(phase) * Math.exp(-age * 7.7);
    const knock = Math.sin(phase * 2.027 + 0.21) * Math.exp(-age * 22) * 0.31;
    const click = hashNoise(sample, salt) * Math.exp(-age * 105) * 0.075;
    const value = (body + knock + click) * attack * gain;
    const frame = startFrame + sample;
    left[frame] += value * 0.7071;
    right[frame] += value * 0.7071;
  }
}

function renderClap(startFrame, gain, pan, salt) {
  const count = Math.min(Math.round(sampleRate * 0.27), frameCount - startFrame);
  const [leftGain, rightGain] = equalPowerPan(pan);
  let low = 0;
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const noise = hashNoise(sample, salt);
    low += (noise - low) * 0.23;
    const high = noise - low;
    const repeatedBurst = 0.54 + 0.46 * Math.max(0, Math.cos(tau * 31 * age));
    const value = high * Math.exp(-age * 18) * repeatedBurst * gain;
    const frame = startFrame + sample;
    left[frame] += value * leftGain;
    right[frame] += value * rightGain;
  }
}

function renderHat(startFrame, open, gain, pan, salt) {
  const seconds = open ? 0.24 : 0.065;
  const count = Math.min(Math.round(sampleRate * seconds), frameCount - startFrame);
  const [leftGain, rightGain] = equalPowerPan(pan);
  let low = 0;
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const noise = hashNoise(sample, salt);
    low += (noise - low) * 0.045;
    const metallic = (noise - low) + Math.sin(tau * (6113 + salt % 479) * age) * 0.12;
    const value = metallic * Math.exp(-age * (open ? 13 : 55)) * gain;
    const frame = startFrame + sample;
    left[frame] += value * leftGain;
    right[frame] += value * rightGain;
  }
}

// Percussion grows from isolated ignition knocks into a running four-beat
// engine, disappears inside the ash-eye, returns as a 3+3+2 cross-rhythm, and
// reaches double-time only in the eighth section.
for (let bar = 0; bar < bars; ++bar) {
  const section = sectionForBar(bar);
  for (let beat = 0; beat < beatsPerBar; ++beat) {
    const absoluteBeat = bar * beatsPerBar + beat;
    const startFrame = Math.round(absoluteBeat * beatFrames);
    const kick = section.index === 0 ? (beat === 0 && bar % 2 === 0) :
      section.index === 1 ? (beat === 0 || beat === 2 || (beat === 3 && bar % 3 === 1)) :
        section.index === 5 ? beat === (bar % 2) * 2 :
          section.index === 8 ? beat === 0 && bar % 2 === 0 :
            !(beat === 3 && hash01(bar, beat, 66) < 0.13);
    if (kick) renderKick(startFrame, 0.43 + section.energy * 0.19, absoluteBeat);

    const clapBeat = section.index === 5 ? beat === 2 : beat === 1 || beat === 3;
    if (section.index > 0 && section.index < 8 && clapBeat) {
      renderClap(startFrame, 0.075 + section.energy * 0.078, beat === 1 ? -0.16 : 0.16, absoluteBeat);
    }
  }

  const subdivision = section.index >= 7 ? 16 : section.index >= 2 ? 8 : 4;
  for (let step = 0; step < subdivision; ++step) {
    if (section.index === 0 && step % 3 !== 0) continue;
    if (section.index === 5 && step % 2 === 0) continue;
    const absoluteStep = bar * 16 + Math.round(step * 16 / subdivision);
    if (hash01(absoluteStep, section.index, 73) > 0.53 + section.density * 0.42) continue;
    const startFrame = Math.round((bar * barSeconds + step * barSeconds / subdivision) * sampleRate);
    const open = step % Math.max(2, subdivision / 4) === Math.max(1, subdivision / 4 - 1);
    renderHat(
      startFrame,
      open,
      (open ? 0.047 : 0.030) + section.air * 0.027,
      ((absoluteStep * 5) % 9 - 4) * 0.11,
      absoluteStep * 13 + section.index,
    );
  }
}

function renderLead(startFrame, frequency, seconds, gain, pan, salt) {
  const count = Math.min(Math.round(seconds * sampleRate), frameCount - startFrame);
  const [leftGain, rightGain] = equalPowerPan(pan);
  let phase = hash01(salt, 22, 1) * tau;
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const envelope = (1 - Math.exp(-age * 155)) * Math.exp(-age * (seconds > 0.35 ? 5.8 : 17));
    const sweep = 1 + Math.exp(-age * 24) * 0.018;
    phase += tau * frequency * sweep / sampleRate;
    const tone = (
      Math.sin(phase) +
      Math.sin(phase * 1.997 + 0.48) * 0.31 +
      Math.sin(phase * 4.011 + 1.12) * 0.10
    ) * envelope * gain;
    const frame = startFrame + sample;
    left[frame] += tone * leftGain;
    right[frame] += tone * rightGain;
  }
}

// The literal p4 token becomes the melody's five-semitone leap. Every bar
// rotates, truncates or extends the contour with a different seed-derived
// register, making the final white-heat statement an evolution, not a reprise.
for (let bar = 0; bar < bars; ++bar) {
  const section = sectionForBar(bar);
  const density = section.index === 0 ? 0.07 : section.index === 5 ? 0.12 :
    section.index === 8 ? 0.18 : 0.15 + section.density * 0.47;
  for (let sixteenth = 0; sixteenth < 16; ++sixteenth) {
    const absoluteStep = bar * 16 + sixteenth;
    const syncopated = sixteenth % 4 === 3 || sixteenth % 8 === 6;
    if (hash01(absoluteStep, section.index, 91) > density + (syncopated ? 0.18 : 0)) continue;
    const motifIndex = (absoluteStep * (section.index + 3) + bar * 2 + section.index) % P4_MOTIF.length;
    const semitone = P4_MOTIF[motifIndex] + (Math.floor(bar / 7) + section.index) % 5;
    const octaveLift = section.index >= 7 ? 12 : section.index === 5 ? -12 : 0;
    const frequency = midiFrequency(section.rootMidi + 24 + semitone + octaveLift);
    const startFrame = Math.round((bar * barSeconds + sixteenth * barSeconds / 16) * sampleRate);
    renderLead(
      startFrame,
      frequency,
      section.index === 5 || section.index === 8 ? 0.52 : 0.16 + hash01(bar, sixteenth, 8) * 0.10,
      0.034 + section.energy * 0.046,
      hash01(absoluteStep, 7, 14) * 1.36 - 0.68,
      absoluteStep,
    );
  }
}

function renderCueAccent(cue) {
  const startFrame = cue.sampleFrame;
  const seconds = cue.tier === 3 ? 1.32 : cue.tier === 2 ? 0.72 : 0.19;
  const count = Math.min(Math.round(seconds * sampleRate), frameCount - startFrame);
  const pan = clamp(cue.x * 0.68, -0.78, 0.78);
  const [leftGain, rightGain] = equalPowerPan(pan);
  const baseFrequency = midiFrequency(31 + cue.sectionIndex * 2 + (cue.cueId * 5) % 12);
  let lowNoise = 0;
  let phase = hash01(cue.cueId, 4, 12) * tau;
  for (let sample = 0; sample < count; ++sample) {
    const age = sample / sampleRate;
    const noise = hashNoise(sample, cue.cueId * 101);
    lowNoise += (noise - lowNoise) * (cue.tier === 1 ? 0.16 : 0.055);
    const crackle = (noise - lowNoise) * Math.exp(-age * (cue.tier === 1 ? 36 : 9));
    const envelope = (1 - Math.exp(-age * 135)) * Math.exp(-age * (cue.tier === 3 ? 3.4 : 7.2));
    const fallingPitch = 1 + Math.exp(-age * 18) * (cue.tier === 3 ? 0.72 : 0.28);
    phase += tau * baseFrequency * fallingPitch / sampleRate;
    const tonal = (Math.sin(phase) + Math.sin(phase * 2.013 + 0.4) * 0.28) * envelope;
    const value = (
      tonal * (cue.tier === 3 ? 0.23 : cue.tier === 2 ? 0.12 : 0.025) +
      crackle * (cue.tier === 3 ? 0.047 : cue.tier === 2 ? 0.039 : 0.052)
    ) * cue.strength;
    const frame = startFrame + sample;
    left[frame] += value * leftGain;
    right[frame] += value * rightGain;
  }
}

for (const cue of FIRE_SCORE_CUES) renderCueAccent(cue);

// Seeded flame-draw risers lead into each new stage. Their duration increases
// irregularly across the piece and each terminates exactly on its RIFF cue.
for (const section of FIRE_SCORE_SECTIONS.slice(1)) {
  const riseSeconds = 2.4 + hash01(section.index, 44, 2) * 2.1;
  const endFrame = Math.round(section.startSeconds * sampleRate);
  const startFrame = Math.max(0, endFrame - Math.round(riseSeconds * sampleRate));
  const count = endFrame - startFrame;
  let lowL = 0;
  let lowR = 0;
  for (let sample = 0; sample < count; ++sample) {
    const progress = sample / Math.max(1, count - 1);
    const noiseL = hashNoise(sample, section.index * 313);
    const noiseR = hashNoise(sample, section.index * 419);
    const response = 0.018 + progress * 0.39;
    lowL += (noiseL - lowL) * response;
    lowR += (noiseR - lowR) * response;
    const envelope = progress ** 2.1 * (1 - Math.exp(-(1 - progress) * 64));
    const whistle = Math.sin(tau * (210 + section.index * 31) * (sample / sampleRate) * (1 + progress * 0.8));
    left[startFrame + sample] += (lowL * 0.072 + whistle * 0.009) * envelope;
    right[startFrame + sample] += (lowR * 0.072 - whistle * 0.009) * envelope;
  }
}

// A filtered ash bed occupies only the quiet sixth section, preserving the
// silence/space contrast that makes the later return feel larger.
const ashSection = FIRE_SCORE_SECTIONS[5];
const ashStart = Math.round(ashSection.startSeconds * sampleRate);
const ashEnd = Math.round(ashSection.endSeconds * sampleRate);
let ashLowL = 0;
let ashLowR = 0;
for (let frame = ashStart; frame < ashEnd; ++frame) {
  const local = frame - ashStart;
  const progress = local / Math.max(1, ashEnd - ashStart - 1);
  const envelope = Math.sin(Math.PI * progress) ** 0.55;
  const noiseL = hashNoise(local, 0xa511);
  const noiseR = hashNoise(local, 0xb233);
  ashLowL += (noiseL - ashLowL) * 0.006;
  ashLowR += (noiseR - ashLowR) * 0.006;
  left[frame] += ashLowL * envelope * 0.032;
  right[frame] += ashLowR * envelope * 0.032;
}

// Cross-channel dotted-eighth feedback makes sparks trail through the stereo
// field without wrapping the ending back to the beginning.
const delayFrames = Math.round(beatFrames * 0.75);
for (let frame = delayFrames; frame < frameCount; ++frame) {
  const source = frame - delayFrames;
  left[frame] += right[source] * 0.105;
  right[frame] += left[source] * 0.105;
}
const roomFrames = Math.round(sampleRate * 0.173);
for (let frame = roomFrames; frame < frameCount; ++frame) {
  left[frame] += left[frame - roomFrames] * 0.038;
  right[frame] += right[frame - roomFrames] * 0.038;
}

const dataSize = frameCount * blockAlign;
const fmtSize = 16;
const cueSize = 4 + FIRE_SCORE_CUES.length * 24;
const riffSize = 4 + (8 + fmtSize) + (8 + dataSize) + (8 + cueSize);
const bytes = Buffer.alloc(8 + riffSize);
let offset = 0;
const text = value => { bytes.write(value, offset, "ascii"); offset += value.length; };
const u16 = value => { bytes.writeUInt16LE(value, offset); offset += 2; };
const u32 = value => { bytes.writeUInt32LE(value >>> 0, offset); offset += 4; };

text("RIFF"); u32(riffSize); text("WAVE");
text("fmt "); u32(fmtSize); u16(1); u16(channels); u32(sampleRate);
u32(sampleRate * blockAlign); u16(blockAlign); u16(bitsPerSample);
text("data"); u32(dataSize);

let peak = 0;
let sumSquares = 0;
const fadeInFrames = Math.round(sampleRate * 0.045);
const fadeOutFrames = Math.round(sampleRate * 0.34);
for (let frame = 0; frame < frameCount; ++frame) {
  const fadeIn = frame < fadeInFrames
    ? Math.sin(Math.PI * 0.5 * frame / Math.max(1, fadeInFrames - 1)) ** 2
    : 1;
  const framesRemaining = frameCount - 1 - frame;
  const fadeOut = framesRemaining < fadeOutFrames
    ? Math.sin(Math.PI * 0.5 * framesRemaining / Math.max(1, fadeOutFrames - 1)) ** 2
    : 1;
  const edgeGain = fadeIn * fadeOut;
  // Soft saturation gives the two climaxes weight while keeping every sample
  // safely below full scale. Playback adds another restrained volume stage.
  const outputL = Math.tanh(left[frame] * 1.46) * 0.92 * edgeGain;
  const outputR = Math.tanh(right[frame] * 1.46) * 0.92 * edgeGain;
  peak = Math.max(peak, Math.abs(outputL), Math.abs(outputR));
  sumSquares += (outputL * outputL + outputR * outputR) * 0.5;
  bytes.writeInt16LE(Math.round(clamp(outputL, -1, 1) * 32767), offset);
  bytes.writeInt16LE(Math.round(clamp(outputR, -1, 1) * 32767), offset + 2);
  offset += blockAlign;
}

text("cue "); u32(cueSize); u32(FIRE_SCORE_CUES.length);
for (const cue of FIRE_SCORE_CUES) {
  u32(cue.cueId);
  u32(cue.sampleFrame);
  text("data");
  u32(0);
  u32(0);
  u32(cue.sampleFrame);
}

if (offset !== bytes.length) throw new Error(`RIFF size mismatch: ${offset} != ${bytes.length}`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(JSON.stringify({
  output,
  bytes: bytes.length,
  seed: FIRE_PATTERN_SEED,
  seedHash: FIRE_SCORE_TRACK.seedHash,
  sampleRate,
  channels,
  bitsPerSample,
  durationSeconds,
  sections: FIRE_SCORE_SECTIONS.length,
  cues: FIRE_SCORE_CUES.length,
  peak: Number(peak.toFixed(6)),
  rms: Number(Math.sqrt(sumSquares / frameCount).toFixed(6)),
}));
