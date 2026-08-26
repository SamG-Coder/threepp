import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SYSTEM,
  buildCaptureTrajectory,
  disruptionEnvelope,
  gravitationalRedshift,
  localGeodesicSpeedFraction,
  sampleCaptureTrajectory,
} from "../src/relativity-model.mjs";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const DURATION_SECONDS = 72;
const CONTROL_FRAMES = 192;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const TAU = Math.PI * 2;
const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, Number(value) || 0));
const mix = (left, right, amount) => left + (right - left) * amount;
const smoothstep = (minimum, maximum, value) => {
  const unit = clamp((value - minimum) / Math.max(1e-9, maximum - minimum));
  return unit * unit * (3 - 2 * unit);
};

const trajectory = buildCaptureTrajectory({
  startRadiusM: 118,
  stopRadiusM: 2.055,
  energy: 1,
  angularMomentumM: 3.98,
  stepM: 0.05,
  recordEvery: 4,
});

function controlAt(timeSeconds) {
  const linearProgress = clamp(timeSeconds / DURATION_SECONDS);
  const pathProgress = Math.pow(linearProgress, 0.66);
  const sample = sampleCaptureTrajectory(trajectory, pathProgress);
  const envelope = disruptionEnvelope(sample.rM, DEFAULT_SYSTEM);
  const beta = localGeodesicSpeedFraction(sample.rM, trajectory.energy);
  const redshift = gravitationalRedshift(sample.rM);
  const closeness = 1 - clamp((sample.rM - 2.055) / (118 - 2.055));
  const tidalEnergy = smoothstep(0.65, 18, envelope.stress);
  const plunge = smoothstep(0.76, 0.995, pathProgress);
  return {
    pathProgress,
    phi: sample.phi,
    redshift,
    beta,
    stress: Math.min(140, envelope.stress),
    stretch: Math.min(11, envelope.stretch),
    stripped: envelope.strippedFraction,
    bound: envelope.boundFraction,
    closeness,
    tidalEnergy,
    plunge,
    pan: Math.sin(sample.phi) * 0.72,
  };
}

const stressThresholds = [1, 2, 5, 12, 30, 80];
const stressEvents = [];
let thresholdIndex = 0;
for (let frame = 0; frame <= FRAME_COUNT && thresholdIndex < stressThresholds.length; frame += 240) {
  const timeSeconds = frame / SAMPLE_RATE;
  const state = controlAt(timeSeconds);
  while (thresholdIndex < stressThresholds.length && state.stress >= stressThresholds[thresholdIndex]) {
    stressEvents.push({
      timeSeconds,
      threshold: stressThresholds[thresholdIndex],
      strength: 0.42 + thresholdIndex * 0.10,
      baseFrequency: 46 + thresholdIndex * 17,
    });
    thresholdIndex += 1;
  }
}

function makeNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000 * 2 - 1;
  };
}

function interpolateState(left, right, amount) {
  return {
    pathProgress: mix(left.pathProgress, right.pathProgress, amount),
    phi: mix(left.phi, right.phi, amount),
    redshift: mix(left.redshift, right.redshift, amount),
    beta: mix(left.beta, right.beta, amount),
    stress: mix(left.stress, right.stress, amount),
    stretch: mix(left.stretch, right.stretch, amount),
    stripped: mix(left.stripped, right.stripped, amount),
    bound: mix(left.bound, right.bound, amount),
    closeness: mix(left.closeness, right.closeness, amount),
    tidalEnergy: mix(left.tidalEnergy, right.tidalEnergy, amount),
    plunge: mix(left.plunge, right.plunge, amount),
    pan: mix(left.pan, right.pan, amount),
  };
}

function writeWaveHeader(buffer, dataBytes) {
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  buffer.writeUInt16LE(CHANNELS * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
}

const dataBytes = FRAME_COUNT * CHANNELS * 2;
const wave = Buffer.allocUnsafe(44 + dataBytes);
writeWaveHeader(wave, dataBytes);
const noiseLeft = makeNoise(0x42484f4c);
const noiseRight = makeNoise(0x53554e21);
let rumbleLeft = 0;
let rumbleRight = 0;
let airLeft = 0;
let airRight = 0;
let subPhase = 0;
let gravityPhase = 0;
let plasmaPhase = 0;
let shimmerPhase = 0;
let controlLeft = controlAt(0);
let controlRight = controlAt(CONTROL_FRAMES / SAMPLE_RATE);
let peak = 0;
let sumSquares = 0;

for (let frame = 0; frame < FRAME_COUNT; ++frame) {
  if (frame > 0 && frame % CONTROL_FRAMES === 0) {
    controlLeft = controlRight;
    controlRight = controlAt(Math.min(DURATION_SECONDS, (frame + CONTROL_FRAMES) / SAMPLE_RATE));
  }
  const blockAmount = (frame % CONTROL_FRAMES) / CONTROL_FRAMES;
  const state = interpolateState(controlLeft, controlRight, blockAmount);
  const timeSeconds = frame / SAMPLE_RATE;
  const noiseA = noiseLeft();
  const noiseB = noiseRight();
  const lowPole = 0.0024 + state.tidalEnergy * 0.0058;
  rumbleLeft += (noiseA - rumbleLeft) * lowPole;
  rumbleRight += (noiseB - rumbleRight) * lowPole;
  const airPole = 0.032 + state.stripped * 0.055;
  airLeft += (noiseA - airLeft) * airPole;
  airRight += (noiseB - airRight) * airPole;
  const hissLeft = noiseA - airLeft;
  const hissRight = noiseB - airRight;

  const subFrequency = 25.5 + state.closeness * 8.2 + state.plunge * 5.4;
  const gravityFrequency = 50.8 + state.closeness * 17 + state.beta * 13;
  const plasmaFrequency = (138 + state.stretch * 11 + Math.sin(state.phi * 0.5) * 8)
    * clamp(state.redshift, 0.34, 1.08);
  const shimmerFrequency = 286 + state.tidalEnergy * 238 + state.beta * 92;
  subPhase += TAU * subFrequency / SAMPLE_RATE;
  gravityPhase += TAU * gravityFrequency / SAMPLE_RATE;
  plasmaPhase += TAU * plasmaFrequency / SAMPLE_RATE;
  shimmerPhase += TAU * shimmerFrequency / SAMPLE_RATE;

  const slowPulse = 0.72 + Math.sin(TAU * (0.074 + state.closeness * 0.031) * timeSeconds) * 0.13;
  const drone = (
    Math.sin(subPhase) * 0.19
    + Math.sin(subPhase * 2.001 + 0.37) * 0.082
    + Math.sin(gravityPhase + Math.sin(subPhase * 0.25) * 0.4) * 0.074
  ) * slowPulse * (0.66 + state.closeness * 0.34);
  const rumbleGain = 0.075 + state.stripped * 0.20 + state.plunge * 0.08;
  const plasmaGain = (0.018 + state.tidalEnergy * 0.078) * (0.45 + state.bound * 0.55);
  const plasma = (
    Math.sin(plasmaPhase + Math.sin(gravityPhase * 0.5) * 0.55) * 0.68
    + Math.sin(shimmerPhase) * 0.22
  ) * plasmaGain;
  const airGain = 0.006 + state.stripped * 0.031 + state.plunge * 0.015;

  let rupturePulse = 0;
  let rupturePan = 0;
  for (let eventIndex = 0; eventIndex < stressEvents.length; ++eventIndex) {
    const event = stressEvents[eventIndex];
    const age = timeSeconds - event.timeSeconds;
    if (age < 0 || age > 4.5) continue;
    const envelope = Math.exp(-age * (1.25 + eventIndex * 0.08));
    const chirp = event.baseFrequency * age + (32 + eventIndex * 11) * age * age * 0.5;
    const crack = age < 0.24 ? (1 - age / 0.24) * (noiseA + noiseB) * 0.12 : 0;
    rupturePulse += (Math.sin(TAU * chirp) * 0.15 + crack) * envelope * event.strength;
    rupturePan += Math.sin(eventIndex * 2.399963) * envelope * 0.18;
  }

  const pan = clamp(state.pan + rupturePan, -0.86, 0.86);
  const leftPan = Math.sqrt((1 - pan) * 0.5);
  const rightPan = Math.sqrt((1 + pan) * 0.5);
  const center = drone + (rumbleLeft + rumbleRight) * 0.5 * rumbleGain + rupturePulse;
  const solarLeft = plasma * leftPan + hissLeft * airGain * (0.72 + leftPan * 0.28);
  const solarRight = plasma * rightPan + hissRight * airGain * (0.72 + rightPan * 0.28);
  const fadeIn = smoothstep(0, 1.4, timeSeconds);
  const fadeOut = 1 - smoothstep(69.5, 72, timeSeconds);
  const master = fadeIn * fadeOut;
  const left = Math.tanh((center + solarLeft) * 1.32) * 1.16 * master;
  const right = Math.tanh((center + solarRight) * 1.32) * 1.16 * master;
  peak = Math.max(peak, Math.abs(left), Math.abs(right));
  sumSquares += left * left + right * right;
  const outputOffset = 44 + frame * 4;
  wave.writeInt16LE(Math.round(clamp(left, -1, 1) * 32767), outputOffset);
  wave.writeInt16LE(Math.round(clamp(right, -1, 1) * 32767), outputOffset + 2);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../assets/tidal-rupture-score.wav");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, wave);
const rms = Math.sqrt(sumSquares / (FRAME_COUNT * CHANNELS));
console.log(JSON.stringify({
  outputPath,
  bytes: wave.length,
  durationSeconds: DURATION_SECONDS,
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  peak: Number(peak.toFixed(4)),
  rms: Number(rms.toFixed(4)),
  stressEvents,
}, null, 2));
