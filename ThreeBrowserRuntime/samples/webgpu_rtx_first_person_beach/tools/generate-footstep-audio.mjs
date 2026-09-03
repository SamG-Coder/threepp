import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 32_000;
const PROFILES = {
  "dry-sand": { duration: 0.23, thump: 88, noise: 0.46, cutoff: 0.19, decay: 18, grit: 0.18 },
  "wet-sand": { duration: 0.3, thump: 64, noise: 0.3, cutoff: 0.075, decay: 13, grit: 0.08 },
  "shallow-water": { duration: 0.46, thump: 42, noise: 0.32, cutoff: 0.035, decay: 7.2, grit: 0.045 },
  rock: { duration: 0.18, thump: 172, noise: 0.24, cutoff: 0.32, decay: 27, grit: 0.1 },
  wood: { duration: 0.28, thump: 118, noise: 0.17, cutoff: 0.22, decay: 17, grit: 0.07 },
};

function writeWav(path, samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

for (const [name, profile] of Object.entries(PROFILES)) {
  for (let variant = 1; variant <= 2; variant += 1) {
    let state = (0x9e3779b9 ^ name.length * 7919 ^ variant * 104729) >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0xffffffff * 2 - 1;
    };
    const frames = Math.round(profile.duration * SAMPLE_RATE);
    const samples = new Float32Array(frames);
    let low = 0;
    let waterLow = 0;
    let waterMid = 0;
    let phase = variant * 0.37;
    for (let frame = 0; frame < frames; frame += 1) {
      const t = frame / SAMPLE_RATE;
      const attack = 1 - Math.exp(-t * 520);
      const tail = Math.min(1, Math.max(0, (profile.duration - t) / 0.035));
      const white = random();
      low += (white - low) * profile.cutoff;
      const granular = (low * 0.72 + (white - low) * profile.grit) * profile.noise;
      const frequency = profile.thump * (1.08 + variant * 0.035) * (1 + Math.exp(-t * 30) * 0.22);
      phase += Math.PI * 2 * frequency / SAMPLE_RATE;
      let body = Math.sin(phase) * 0.42;
      if (name === "rock") body += Math.sin(phase * 2.71) * 0.19;
      if (name === "wood") body += Math.sin(Math.PI * 2 * 286 * t) * 0.14;
      if (name === "shallow-water") {
        // A foot entering shallow water produces a rounded displacement and
        // a quiet, filtered wash—not the bright white-noise crack of a large
        // splash. Two differently filtered layers make the tail slosh.
        waterLow += (white - waterLow) * 0.018;
        waterMid += (white - waterMid) * 0.065;
        const entry = Math.exp(-Math.pow((t - 0.055) / 0.052, 2));
        const wash = Math.exp(-Math.max(0, t - 0.035) * (5.1 + variant * 0.25));
        const slosh = waterLow * 0.62 + (waterMid - waterLow) * 0.28;
        body = Math.sin(phase) * 0.16 + slosh * wash * 0.78 + waterMid * entry * 0.2;
      }
      const envelope = Math.exp(-t * profile.decay) * attack * tail;
      samples[frame] = Math.tanh((body + granular) * envelope * 1.35) * 0.72;
    }
    const output = fileURLToPath(new URL(`../assets/audio/footstep-${name}-${variant}.wav`, import.meta.url));
    writeWav(output, samples);
    console.log(`Wrote ${output}`);
  }
}
