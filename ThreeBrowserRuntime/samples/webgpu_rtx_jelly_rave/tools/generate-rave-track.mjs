import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JELLY_RAVE_TRACK, raveSectionAt } from "../src/rave-audio.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", "assets", "neon-jelly-rave.wav");
const { sampleRate, durationSeconds, bpm } = JELLY_RAVE_TRACK;
const channels = 2;
const bitsPerSample = 16;
const blockAlign = channels * bitsPerSample / 8;
const frameCount = Math.round(durationSeconds * sampleRate);
const beatSeconds = 60 / bpm;
const beatFrames = sampleRate * beatSeconds;
const barSeconds = beatSeconds * 4;
const left = new Float32Array(frameCount);
const right = new Float32Array(frameCount);
const tau = Math.PI * 2;

function hashNoise(index, salt = 0) {
  let value = (index + Math.imul(salt + 17, 0x9e3779b1)) | 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 0x80000000 - 1;
}

function circularAdd(buffer, frame, value) {
  buffer[(frame % frameCount + frameCount) % frameCount] += value;
}

function sectionGainAt(time) {
  const section = raveSectionAt(time);
  return section.id === "neon-ignition" ? 0.74 :
    section.id === "laser-lift" ? 0.92 :
    section.id === "prismatic-drop" ? 1.08 :
    section.id === "liquid-breakdown" ? 0.60 : 1.13;
}

// Harmonic material: an original F-minor progression with a different top
// voice on each return. Every pad voice has a Hann envelope, preventing clicks
// at chord changes and at the file loop point.
const chordRoots = [43.654, 34.648, 51.913, 38.891]; // F1, Db1, Ab1, Eb1
const chordRatios = [1, 1.498307, 2, 2.378414];
for (let bar = 0; bar < JELLY_RAVE_TRACK.bars; ++bar) {
  const start = Math.round(bar * barSeconds * sampleRate);
  const root = chordRoots[bar % chordRoots.length];
  const sectionGain = sectionGainAt(bar * barSeconds);
  const breakdown = bar >= 16 && bar < 20;
  const barFrames = Math.round(barSeconds * sampleRate);
  for (let sample = 0; sample < barFrames; ++sample) {
    const age = sample / sampleRate;
    const unit = sample / barFrames;
    const envelope = Math.sin(Math.PI * unit) ** 0.55;
    let signalL = 0;
    let signalR = 0;
    for (let voice = 0; voice < chordRatios.length; ++voice) {
      const frequency = root * chordRatios[voice] * (breakdown ? 2 : 4);
      const detune = 1 + (voice - 1.5) * 0.0017;
      const phase = tau * frequency * age;
      const sawish = Math.sin(phase * detune) + Math.sin(phase * 2 * detune + 0.2) * 0.28 +
        Math.sin(phase * 3 / detune + 0.6) * 0.12;
      signalL += sawish * (voice & 1 ? 0.72 : 1.0);
      signalR += sawish * (voice & 1 ? 1.0 : 0.72);
    }
    const gain = envelope * sectionGain * (breakdown ? 0.020 : 0.026);
    circularAdd(left, start + sample, signalL * gain);
    circularAdd(right, start + sample, signalR * gain);
  }
}

// Four-on-the-floor percussion. Event tails are added circularly so the final
// beat naturally decays into the first bar when the audio element loops.
for (let beat = 0; beat < JELLY_RAVE_TRACK.bars * 4; ++beat) {
  const start = Math.round(beat * beatFrames);
  const time = beat * beatSeconds;
  const section = raveSectionAt(time);
  const kickGain = section.id === "liquid-breakdown" ? (beat % 2 ? 0.50 : 0.88) : 1;
  const kickFrames = Math.round(sampleRate * 0.72);
  for (let sample = 0; sample < kickFrames; ++sample) {
    const age = sample / sampleRate;
    const attack = 1 - Math.exp(-age * 260);
    const phase = tau * (48 * age + 68 * (1 - Math.exp(-age * 22)) / 22);
    const body = Math.sin(phase) * Math.exp(-age * 8.2);
    const knock = Math.sin(phase * 2.03 + 0.31) * Math.exp(-age * 24) * 0.34;
    const click = hashNoise(sample, beat) * Math.exp(-age * 95) * 0.11;
    const value = (body + knock + click) * attack * 0.72 * kickGain;
    circularAdd(left, start + sample, value);
    circularAdd(right, start + sample, value);
  }

  if (beat % 4 === 1 || beat % 4 === 3) {
    const clapFrames = Math.round(sampleRate * 0.23);
    let lowL = 0;
    let lowR = 0;
    for (let sample = 0; sample < clapFrames; ++sample) {
      const age = sample / sampleRate;
      lowL += (hashNoise(sample, beat * 7) - lowL) * 0.34;
      lowR += (hashNoise(sample, beat * 11 + 3) - lowR) * 0.34;
      const burst = Math.exp(-age * 22) * (0.72 + 0.28 * Math.cos(tau * 28 * age));
      circularAdd(left, start + sample, lowL * burst * 0.24);
      circularAdd(right, start + sample, lowR * burst * 0.24);
    }
  }
}

// Open hats on offbeats and quick closed hats on the remaining eighths.
for (let eighth = 0; eighth < JELLY_RAVE_TRACK.bars * 8; ++eighth) {
  const start = Math.round(eighth * beatFrames * 0.5);
  const ageSeconds = eighth * beatSeconds * 0.5;
  const section = raveSectionAt(ageSeconds);
  if (section.id === "liquid-breakdown" && eighth % 2 === 0) continue;
  const open = eighth % 2 === 1;
  const tailSeconds = open ? 0.24 : 0.065;
  const tailFrames = Math.round(sampleRate * tailSeconds);
  let low = 0;
  for (let sample = 0; sample < tailFrames; ++sample) {
    const age = sample / sampleRate;
    const noise = hashNoise(sample, eighth * 19);
    low += (noise - low) * 0.055;
    const high = noise - low;
    const envelope = Math.exp(-age * (open ? 14 : 52));
    const value = high * envelope * (open ? 0.112 : 0.064);
    const pan = eighth % 4 < 2 ? -0.28 : 0.28;
    circularAdd(left, start + sample, value * (1 - pan));
    circularAdd(right, start + sample, value * (1 + pan));
  }
}

// Rolling octave bass, with rhythmic holes that make the two drops breathe.
const bassPattern = [0, 0, 7, 12, 0, 15, 12, 7, 0, 0, 3, 7, 12, 10, 7, 3];
for (let step = 0; step < JELLY_RAVE_TRACK.bars * 8; ++step) {
  const time = step * beatSeconds * 0.5;
  const section = raveSectionAt(time);
  if (section.id === "neon-ignition" && step % 4 !== 2) continue;
  if (section.id === "liquid-breakdown" && step % 4 !== 0) continue;
  const semitone = bassPattern[(step + Math.floor(step / 32) * 3) % bassPattern.length];
  const frequency = 43.654 * 2 ** (semitone / 12);
  const start = Math.round(time * sampleRate);
  const tailFrames = Math.round(sampleRate * (section.id === "liquid-breakdown" ? 0.38 : 0.205));
  for (let sample = 0; sample < tailFrames; ++sample) {
    const age = sample / sampleRate;
    const attack = 1 - Math.exp(-age * 125);
    const envelope = attack * Math.exp(-age * (section.id === "liquid-breakdown" ? 6 : 15));
    const phase = tau * frequency * age;
    const value = (Math.sin(phase) + Math.sin(phase * 2 + 0.18) * 0.42 +
      Math.sin(phase * 3 + 0.48) * 0.17) * envelope * 0.30;
    circularAdd(left, start + sample, value * 0.98);
    circularAdd(right, start + sample, value * 1.02);
  }
}

// Bright syncopated rave stabs. The finale doubles their density and throws
// alternating notes across the stereo field.
const leadScale = [174.614, 207.652, 261.626, 311.127, 349.228, 415.305, 523.251];
for (let sixteenth = 0; sixteenth < JELLY_RAVE_TRACK.bars * 16; ++sixteenth) {
  const time = sixteenth * beatSeconds * 0.25;
  const section = raveSectionAt(time);
  const finale = section.id === "hyper-jelly-finale";
  const drop = section.id === "prismatic-drop" || finale;
  if (!drop || (!finale && sixteenth % 4 !== 3) || (finale && sixteenth % 2 !== 1)) continue;
  const frequency = leadScale[(sixteenth * 5 + Math.floor(sixteenth / 16) * 2) % leadScale.length];
  const start = Math.round(time * sampleRate);
  const tailFrames = Math.round(sampleRate * 0.18);
  const pan = sixteenth % 4 === 1 ? -0.46 : 0.46;
  for (let sample = 0; sample < tailFrames; ++sample) {
    const age = sample / sampleRate;
    const envelope = (1 - Math.exp(-age * 180)) * Math.exp(-age * 23);
    const sweep = frequency * (1.024 - 0.024 * Math.exp(-age * 19));
    const phase = tau * sweep * age;
    const value = (Math.sin(phase) + Math.sin(phase * 2.005 + 0.4) * 0.39 +
      Math.sin(phase * 3.997 + 0.9) * 0.19) * envelope * 0.145;
    circularAdd(left, start + sample, value * (1 - pan));
    circularAdd(right, start + sample, value * (1 + pan));
  }
}

// Original upward transition sweeps into both drops.
for (const [startBar, bars, gain] of [[6, 2, 0.13], [18, 2, 0.16]]) {
  const start = Math.round(startBar * barSeconds * sampleRate);
  const count = Math.round(bars * barSeconds * sampleRate);
  let lowL = 0;
  let lowR = 0;
  for (let sample = 0; sample < count; ++sample) {
    const progress = sample / count;
    const noiseL = hashNoise(sample, startBar * 101);
    const noiseR = hashNoise(sample, startBar * 131);
    const smoothing = 0.025 + progress * 0.42;
    lowL += (noiseL - lowL) * smoothing;
    lowR += (noiseR - lowR) * smoothing;
    const envelope = progress ** 2.2 * (1 - Math.exp(-(1 - progress) * 75));
    circularAdd(left, start + sample, lowL * envelope * gain);
    circularAdd(right, start + sample, lowR * envelope * gain);
  }
}

// Stereo tempo delay. Reading the mix before writing each frame produces a
// restrained feedback trail and naturally wraps late echoes into the intro.
const delayFrames = Math.round(beatFrames * 0.75);
for (let frame = 0; frame < frameCount; ++frame) {
  const source = (frame - delayFrames + frameCount) % frameCount;
  const echoL = right[source] * 0.115;
  const echoR = left[source] * 0.115;
  left[frame] += echoL;
  right[frame] += echoR;
}

// An eight-millisecond equal-power seam gate removes the tiny residual delay
// discontinuity without making an audible hole or softening the first kick.
const seamFrames = Math.round(sampleRate * 0.008);
for (let frame = 0; frame < seamFrames; ++frame) {
  const edgeGain = Math.sin(Math.PI * 0.5 * frame / (seamFrames - 1)) ** 2;
  left[frame] *= edgeGain;
  right[frame] *= edgeGain;
  const mirroredFrame = frameCount - 1 - frame;
  left[mirroredFrame] *= edgeGain;
  right[mirroredFrame] *= edgeGain;
}

const dataSize = frameCount * blockAlign;
const cueCount = JELLY_RAVE_TRACK.bars * 4;
const cueSize = 4 + cueCount * 24;
const fmtSize = 16;
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
for (let frame = 0; frame < frameCount; ++frame) {
  // Soft saturation glues the dense drop without hard clipping. The encoded
  // peak is deliberately below full scale; playback volume is also 0.38.
  const outputL = Math.tanh(left[frame] * 1.16) * 0.90;
  const outputR = Math.tanh(right[frame] * 1.16) * 0.90;
  peak = Math.max(peak, Math.abs(outputL), Math.abs(outputR));
  sumSquares += (outputL * outputL + outputR * outputR) * 0.5;
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outputL)) * 32767), offset);
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outputR)) * 32767), offset + 2);
  offset += blockAlign;
}

text("cue "); u32(cueSize); u32(cueCount);
for (let beat = 0; beat < cueCount; ++beat) {
  const frame = Math.round(beat * beatFrames);
  u32(beat + 1); u32(frame); text("data"); u32(0); u32(0); u32(frame);
}

if (offset !== bytes.length) throw new Error(`RIFF size mismatch: ${offset} != ${bytes.length}`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(JSON.stringify({
  output,
  bytes: bytes.length,
  sampleRate,
  channels,
  durationSeconds,
  beats: cueCount,
  peak: Number(peak.toFixed(4)),
  rms: Number(Math.sqrt(sumSquares / frameCount).toFixed(4)),
}));
