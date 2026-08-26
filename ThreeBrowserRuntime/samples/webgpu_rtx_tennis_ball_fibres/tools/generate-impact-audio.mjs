import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outputUrl = new URL("../assets/tennis-table-impact.wav", import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const sampleRate = 48_000;
const durationSeconds = 0.34;
const frameCount = Math.round(sampleRate * durationSeconds);
const samples = new Float32Array(frameCount);

let randomState = 0x71e5515d;
const randomSigned = () => {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return (randomState / 0xffffffff) * 2 - 1;
};

let bodyPhase = 0;
let shellPhase = 0;
let noiseLow = 0;
for (let frame = 0; frame < frameCount; ++frame) {
  const time = frame / sampleRate;
  // Felt rounds off the leading edge; a slower attack avoids the hard,
  // click-like transient of a bare rubber or wooden impact.
  const attack = 1 - Math.exp(-time * 720);
  const tail = Math.min(1, Math.max(0, (durationSeconds - time) / 0.045));

  // The hollow pressurised rubber shell has a compact downward body sweep.
  const bodyFrequency = 78 + 74 * Math.exp(-time * 17);
  bodyPhase += Math.PI * 2 * bodyFrequency / sampleRate;
  const bodyEnvelope = Math.exp(-time * 18.5);
  const body = (
    Math.sin(bodyPhase) * 0.48 +
    Math.sin(bodyPhase * 2.01 + 0.38) * 0.075
  ) * bodyEnvelope;

  // A faster mode supplies the taut rubber snap without becoming a wood hit.
  const shellFrequency = 190 + 380 * Math.exp(-time * 38);
  shellPhase += Math.PI * 2 * shellFrequency / sampleRate;
  const shell = Math.sin(shellPhase) * Math.exp(-time * 58) * 0.085;

  // High-passed deterministic noise is the short felt/table contact scrape.
  const white = randomSigned();
  noiseLow += (white - noiseLow) * 0.075;
  const felt = (white - noiseLow) * Math.exp(-time * 68) * 0.055;

  // Two restrained table modes give the polished surface a physical response.
  const table = (
    Math.sin(Math.PI * 2 * 238 * time + 0.7) * 0.035 +
    Math.sin(Math.PI * 2 * 422 * time + 1.2) * 0.014
  ) * Math.exp(-time * 32);

  const mixed = (body + shell + felt + table) * attack * tail;
  samples[frame] = Math.tanh(mixed * 1.05) / Math.tanh(1.05);
}

const bytesPerSample = 2;
const dataBytes = frameCount * bytesPerSample;
const wav = Buffer.alloc(44 + dataBytes);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
wav.writeUInt16LE(bytesPerSample, 32);
wav.writeUInt16LE(bytesPerSample * 8, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(dataBytes, 40);
for (let frame = 0; frame < frameCount; ++frame) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[frame])) * 32767), 44 + frame * 2);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, wav);
console.log(`Wrote ${outputPath} (${frameCount} mono frames at ${sampleRate} Hz)`);
