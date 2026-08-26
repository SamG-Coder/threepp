import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  JELLY_RAVE_SECTIONS,
  JELLY_RAVE_TRACK,
  createRaveAudioController,
  sampleRaveAnalysis,
} from "../src/rave-audio.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function chunksIn(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  const chunks = new Map();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    assert.ok(dataOffset + size <= bytes.length, `${id} chunk exceeds file`);
    chunks.set(id, { offset: dataOffset, size });
    offset = dataOffset + size + (size & 1);
  }
  return chunks;
}

test("music grid and visual analysis wrap cleanly and stay normalized", () => {
  assert.equal(JELLY_RAVE_TRACK.sampleRate, 48_000);
  assert.equal(JELLY_RAVE_TRACK.durationSeconds, 45);
  assert.equal(JELLY_RAVE_TRACK.bpm, 128);
  assert.equal(JELLY_RAVE_SECTIONS.length, 5);
  assert.deepEqual(sampleRaveAnalysis(0), sampleRaveAnalysis(45));
  for (let step = 0; step <= 900; ++step) {
    const analysis = sampleRaveAnalysis(step / 20);
    for (const key of ["beatPhase", "barPhase", "sectionProgress", "pulse", "bass", "energy", "drop", "strobe"]) {
      assert.ok(analysis[key] >= 0 && analysis[key] <= 1, `${key}: ${analysis[key]}`);
    }
  }
  assert.ok(sampleRaveAnalysis(15.1).drop > sampleRaveAnalysis(31).drop);
});

test("generated track is 48 kHz stereo PCM with safe energetic levels", async () => {
  const bytes = await readFile(join(sampleRoot, "assets", "neon-jelly-rave.wav"));
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  const chunks = chunksIn(bytes);
  const fmt = chunks.get("fmt ");
  const data = chunks.get("data");
  const cue = chunks.get("cue ");
  assert.ok(fmt && data && cue);
  assert.equal(bytes.readUInt16LE(fmt.offset), 1);
  assert.equal(bytes.readUInt16LE(fmt.offset + 2), 2);
  assert.equal(bytes.readUInt32LE(fmt.offset + 4), 48_000);
  assert.equal(bytes.readUInt16LE(fmt.offset + 14), 16);
  assert.equal(data.size / 4 / 48_000, 45);
  assert.equal(bytes.readUInt32LE(cue.offset), 96);

  let peak = 0;
  let sum = 0;
  for (let offset = data.offset; offset < data.offset + data.size; offset += 4) {
    const left = bytes.readInt16LE(offset) / 32768;
    const right = bytes.readInt16LE(offset + 2) / 32768;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    sum += (left * left + right * right) * 0.5;
  }
  const rms = Math.sqrt(sum / (data.size / 4));
  assert.ok(peak > 0.72 && peak <= 0.91, `peak ${peak}`);
  assert.ok(rms > 0.09 && rms < 0.30, `RMS ${rms}`);
  for (const channelOffset of [0, 2]) {
    const first = bytes.readInt16LE(data.offset + channelOffset);
    const last = bytes.readInt16LE(data.offset + data.size - 4 + channelOffset);
    assert.ok(Math.abs(first - last) <= 4, `loop seam delta ${first - last}`);
  }
});

test("controller never autoplays and exposes gesture-safe toggle, volume and analysis", async () => {
  class FakeAudio {
    constructor(source) {
      this.src = source;
      this.currentTime = 15;
      this.paused = true;
      this.ended = false;
      this.playCount = 0;
    }
    play() { this.paused = false; ++this.playCount; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
  }
  let element;
  const controller = createRaveAudioController({
    audioFactory(source) { element = new FakeAudio(source); return element; },
  });
  assert.equal(element.playCount, 0, "construction must not violate autoplay policy");
  assert.equal(element.volume, 0.38);
  assert.equal(controller.status().playing, false);
  assert.equal(await controller.toggle(), true);
  assert.equal(controller.update().playing, true);
  assert.equal(controller.update().section, "prismatic-drop");
  assert.equal(controller.setVolume(8), 1);
  assert.equal(element.volume, 1);
  assert.equal(await controller.toggle(), false);
  assert.equal(controller.status().playing, false);
  controller.dispose();
  assert.equal(controller.status().available, false);
});
