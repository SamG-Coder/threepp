import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MERCURY_BASS_CUES,
  MERCURY_BASS_TRACK,
  MERCURY_SONG_SECTIONS,
  mercurySongPosition,
} from "../src/bass-shocks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", "assets", "mercury-sub-bass.wav");
const channels = 2;
const bitsPerSample = 16;
const bytesPerSample = bitsPerSample / 8;
const blockAlign = channels * bytesPerSample;
const sampleRate = MERCURY_BASS_TRACK.sampleRate;
const loopSeconds = MERCURY_BASS_TRACK.durationSeconds;
const frameCount = Math.round(loopSeconds * sampleRate);
const dataSize = frameCount * blockAlign;
const fmtSize = 16;
const cueSize = 4 + MERCURY_BASS_CUES.length * 24;
const riffSize = 4 + (8 + fmtSize) + (8 + dataSize) + (8 + cueSize);
const bytes = Buffer.alloc(8 + riffSize);
const leftMix = new Float32Array(frameCount);
const rightMix = new Float32Array(frameCount);

const tau = Math.PI * 2;
const cueFrames = MERCURY_BASS_CUES.map(cue => Math.round(cue.timeSeconds * sampleRate));
const sectionIndex = new Map(MERCURY_SONG_SECTIONS.map((section, index) => [section.name, index]));
const bassScales = [
  [36.708, 43.654, 48.999, 55.000, 43.654, 41.203],
  [36.708, 48.999, 55.000, 58.270, 43.654, 65.406, 48.999],
  [36.708, 55.000, 43.654, 65.406, 48.999, 58.270, 41.203, 73.416],
  [29.135, 36.708, 43.654, 32.703, 41.203],
  [41.203, 55.000, 65.406, 48.999, 73.416, 58.270, 82.407],
  [36.708, 32.703, 29.135, 43.654, 27.500],
];
const arpScales = [
  [146.832, 220.000, 261.626, 174.614],
  [220.000, 293.665, 349.228, 440.000, 391.995, 523.251],
  [293.665, 440.000, 523.251, 349.228, 587.330, 659.255, 440.000, 783.991],
  [146.832, 174.614, 220.000, 195.998],
  [329.628, 493.883, 587.330, 440.000, 659.255, 880.000, 523.251],
  [220.000, 174.614, 146.832, 130.813],
];

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function circularAdd(buffer, frame, value) {
  buffer[(frame % frameCount + frameCount) % frameCount] += value;
}

// Long, periodic harmonic bed. Oscillator cycle counts are integers across the
// full loop; continuously interpolated weights create chord movement without
// introducing a seam at the outro-to-intro boundary.
const padFrequencies = [65.406, 73.416, 82.407, 87.307, 97.999, 110.000, 130.813];
const padCycles = padFrequencies.map(frequency => Math.round(frequency * loopSeconds));
const sectionPadWeights = [
  [0.70, 0.22, 0.10, 0.34, 0.08, 0.18, 0.05],
  [0.40, 0.16, 0.34, 0.12, 0.28, 0.24, 0.10],
  [0.30, 0.34, 0.18, 0.26, 0.22, 0.38, 0.16],
  [0.58, 0.28, 0.08, 0.36, 0.06, 0.15, 0.04],
  [0.24, 0.20, 0.38, 0.16, 0.32, 0.42, 0.20],
  [0.70, 0.22, 0.10, 0.34, 0.08, 0.18, 0.05],
];

for (let frame = 0; frame < frameCount; ++frame) {
  const time = frame / sampleRate;
  const position = mercurySongPosition(time);
  const index = sectionIndex.get(position.section.name);
  const nextIndex = (index + 1) % MERCURY_SONG_SECTIONS.length;
  const blend = smoothstep(0.68, 1, position.progress);
  const loopPhase = frame / frameCount;
  let left = 0;
  let right = 0;
  for (let oscillator = 0; oscillator < padCycles.length; ++oscillator) {
    const weight = sectionPadWeights[index][oscillator] * (1 - blend) +
      sectionPadWeights[nextIndex][oscillator] * blend;
    const phase = tau * padCycles[oscillator] * loopPhase + oscillator * 0.39;
    const tone = Math.sin(phase) * weight * 0.026;
    left += tone * (oscillator & 1 ? 0.82 : 1.12);
    right += tone * (oscillator & 1 ? 1.12 : 0.82);
  }

  // The tempo map is audible in the changing pulse rate. Every note uses a
  // Hann gate, so tempo/section boundaries reach zero rather than clicking.
  const subdivision = position.section.subdivision;
  const arpPosition = position.localBeat * subdivision;
  const arpStep = Math.floor(arpPosition);
  const arpUnit = arpPosition - arpStep;
  const gate = Math.sin(Math.PI * arpUnit) ** 2;
  const transitionDistance = Math.min(
    time - position.section.start,
    position.section.end - time,
  );
  const transitionGate = smoothstep(0, 0.09, Math.max(0, transitionDistance));
  const scale = arpScales[index];
  const phraseOffset = Math.floor(position.localBeat / 8) * (index + 2);
  const arpFrequency = scale[(arpStep * (index + 1) + phraseOffset) % scale.length];
  const arpPhase = tau * arpFrequency * time + index * 0.47;
  const densityGain = [0.018, 0.032, 0.050, 0.020, 0.055, 0.014][index];
  const arp = (
    Math.sin(arpPhase) + Math.sin(arpPhase * 2 + 0.31) * 0.19
  ) * gate * transitionGate * densityGain;
  const pan = ((arpStep + index) & 1) ? 0.34 : -0.34;
  leftMix[frame] = left + arp * (1 - pan);
  rightMix[frame] = right + arp * (1 + pan);
}

// Sparse long-tail melodic answers make every section phrase differently.
const melody = [
  [6.2, 293.665, 4.8, -0.32], [12.1, 349.228, 4.0, 0.28],
  [18.4, 440.000, 3.3, -0.24], [23.1, 523.251, 3.0, 0.30], [27.2, 587.330, 2.8, -0.35],
  [33.6, 659.255, 2.4, 0.32], [38.2, 523.251, 2.8, -0.30], [44.0, 783.991, 2.2, 0.34],
  [53.4, 261.626, 5.2, -0.20], [59.2, 220.000, 5.8, 0.18], [64.0, 329.628, 4.6, -0.24],
  [69.2, 659.255, 2.5, 0.34], [73.8, 880.000, 2.1, -0.34], [78.4, 698.456, 2.6, 0.30],
  [82.0, 987.767, 2.0, -0.28], [88.2, 293.665, 5.0, 0.20], [92.0, 220.000, 5.8, -0.18],
];
for (const [startSeconds, frequency, tailSeconds, pan] of melody) {
  const startFrame = Math.round(startSeconds * sampleRate);
  const tailFrames = Math.round(tailSeconds * sampleRate);
  for (let sample = 0; sample < tailFrames; ++sample) {
    const age = sample / sampleRate;
    const attack = 1 - Math.exp(-age * 8);
    const envelope = attack * Math.exp(-age * 0.72) * 0.038;
    const phase = tau * frequency * age;
    const value = (Math.sin(phase) + Math.sin(phase * 0.5 + 0.7) * 0.22) * envelope;
    circularAdd(leftMix, startFrame + sample, value * (1 - pan));
    circularAdd(rightMix, startFrame + sample, value * (1 + pan));
  }
}

// Each native cue is also the source of one synthesized impact. Rendering
// cue-local tails into the circular mix is both fast and guarantees that late-
// outro tails continue seamlessly into the atmospheric intro.
for (let cueIndex = 0; cueIndex < MERCURY_BASS_CUES.length; ++cueIndex) {
  const cue = MERCURY_BASS_CUES[cueIndex];
  const index = sectionIndex.get(cue.section);
  const scale = bassScales[index];
  const noteFrequency = scale[(cueIndex * (index + 3) + cue.tier) % scale.length];
  const tailSeconds = cue.tier === 3 ? 1.35 : cue.tier === 2 ? 1.08 : 0.88;
  const tailFrames = Math.round(tailSeconds * sampleRate);
  const startFrame = cueFrames[cueIndex];
  const tierGain = cue.tier === 3 ? 1.16 : cue.tier === 2 ? 0.96 : 0.78;
  for (let sample = 0; sample < tailFrames; ++sample) {
    const age = sample / sampleRate;
    const attack = 1 - Math.exp(-age * 190);
    const envelope = attack * Math.exp(-age * (cue.tier === 3 ? 3.2 : 4.5));
    const kickPhase = tau * (
      48 * age + 50 * (1 - Math.exp(-age * 18)) / 18
    );
    const punchEnvelope = attack * Math.exp(-age * 12);
    const kick = Math.sin(kickPhase) * envelope * 0.43 +
      Math.sin(kickPhase * 2 + 0.16) * punchEnvelope * 0.25 +
      Math.sin(kickPhase * 3 + 0.39) * punchEnvelope * 0.085;
    const notePhase = tau * noteFrequency * age;
    const bassline = (
      Math.sin(notePhase) + Math.sin(notePhase * 2 + 0.27) * 0.36 +
      Math.sin(notePhase * 3 + 0.54) * 0.13
    ) * envelope * 0.30;
    const beater = Math.sin(tau * (880 + index * 65) * age) * Math.exp(-age * 68) * 0.050;
    const value = (kick + bassline + beater) * cue.strength * tierGain;
    const pan = cue.x * 0.13;
    circularAdd(leftMix, startFrame + sample, value * (1 - pan));
    circularAdd(rightMix, startFrame + sample, value * (1 + pan));
  }
}

let offset = 0;
function text(value) {
  bytes.write(value, offset, "ascii");
  offset += value.length;
}
function u16(value) {
  bytes.writeUInt16LE(value, offset);
  offset += 2;
}
function u32(value) {
  bytes.writeUInt32LE(value >>> 0, offset);
  offset += 4;
}

text("RIFF");
u32(riffSize);
text("WAVE");
text("fmt ");
u32(fmtSize);
u16(1);
u16(channels);
u32(sampleRate);
u32(sampleRate * blockAlign);
u16(blockAlign);
u16(bitsPerSample);
text("data");
u32(dataSize);

const dataOffset = offset;
for (let frame = 0; frame < frameCount; ++frame) {
  // Deliberate tier-three impacts are large, but the soft limiter keeps the
  // delivered PCM below full scale and retains usable transient contrast.
  const left = Math.tanh(leftMix[frame] * 1.24) * 0.92;
  const right = Math.tanh(rightMix[frame] * 1.24) * 0.92;
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32767), offset);
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32767), offset + 2);
  offset += blockAlign;
}

if (offset !== dataOffset + dataSize) throw new Error("PCM size mismatch.");
text("cue ");
u32(cueSize);
u32(MERCURY_BASS_CUES.length);
for (let index = 0; index < MERCURY_BASS_CUES.length; ++index) {
  const cue = MERCURY_BASS_CUES[index];
  u32(cue.cueId);
  u32(cueFrames[index]);
  text("data");
  u32(0);
  u32(0);
  u32(cueFrames[index]);
}

if (offset !== bytes.length) throw new Error(`RIFF size mismatch: ${offset} != ${bytes.length}`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(`${output} (${bytes.length.toLocaleString()} bytes, ${MERCURY_BASS_CUES.length} cues)`);
