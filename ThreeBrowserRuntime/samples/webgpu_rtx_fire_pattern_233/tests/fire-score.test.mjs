import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIRE_PATTERN_SEED,
  FIRE_SCORE_CUES,
  FIRE_SCORE_SECTIONS,
  FIRE_SCORE_TRACK,
  createFireScoreAudioController,
  fireScorePositionAt,
  sampleFireScore,
} from "../src/fire-score.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function chunksIn(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  const chunks = new Map();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    assert.ok(payload + size <= bytes.length, `${id} chunk exceeds file`);
    chunks.set(id, { offset: payload, size });
    offset = payload + size + (size & 1);
  }
  return chunks;
}

test("literal seed authors an exact non-looping nine-section, 180-second score", () => {
  assert.equal(
    FIRE_PATTERN_SEED,
    "p4 + 11c9h 9fwhsa assa dasd sa u923t u3240-9t 0w3",
  );
  assert.equal(FIRE_SCORE_TRACK.title, "CIN/SIN — Pattern of Fire +233");
  assert.equal(FIRE_SCORE_TRACK.seed, FIRE_PATTERN_SEED);
  assert.equal(FIRE_SCORE_TRACK.seedHash, "0xbe8b6b9d");
  assert.equal(FIRE_SCORE_TRACK.durationSeconds, 180);
  assert.equal(FIRE_SCORE_TRACK.sampleRate, 48_000);
  assert.equal(FIRE_SCORE_TRACK.channels, 2);
  assert.equal(FIRE_SCORE_TRACK.bitsPerSample, 16);
  assert.equal(FIRE_SCORE_TRACK.bpm, 128);
  assert.equal(FIRE_SCORE_TRACK.beatsPerBar, 4);
  assert.equal(FIRE_SCORE_TRACK.bars, 96);
  assert.equal(FIRE_SCORE_TRACK.loop, false);
  assert.equal(FIRE_SCORE_TRACK.looping, false);
  assert.equal(FIRE_SCORE_TRACK.throughComposed, true);
  assert.equal(FIRE_SCORE_SECTIONS.length, 9);

  assert.equal(FIRE_SCORE_SECTIONS[0].firstBar, 0);
  assert.equal(FIRE_SCORE_SECTIONS.at(-1).finalBar, FIRE_SCORE_TRACK.bars);
  for (let index = 0; index < FIRE_SCORE_SECTIONS.length; ++index) {
    const section = FIRE_SCORE_SECTIONS[index];
    assert.equal(section.index, index);
    assert.ok(section.finalBar > section.firstBar);
    assert.equal(section.startSeconds, section.firstBar * 1.875);
    assert.equal(section.endSeconds, section.finalBar * 1.875);
    if (index > 0) {
      assert.equal(section.firstBar, FIRE_SCORE_SECTIONS[index - 1].finalBar);
      assert.equal(section.startSeconds, FIRE_SCORE_SECTIONS[index - 1].endSeconds);
    }
  }
  assert.equal(
    FIRE_SCORE_SECTIONS.reduce((sum, section) => sum + section.cueCount, 0),
    FIRE_SCORE_TRACK.cueCount,
  );
});

test("all 233 fire cues are deterministic, ordered, spatial and section-owned", () => {
  assert.equal(FIRE_SCORE_CUES.length, 233);
  assert.equal(FIRE_SCORE_CUES[0].sampleFrame, 0);
  const sectionCounts = new Map(FIRE_SCORE_SECTIONS.map(section => [section.id, 0]));
  for (let index = 0; index < FIRE_SCORE_CUES.length; ++index) {
    const cue = FIRE_SCORE_CUES[index];
    assert.equal(cue.cueId, index + 1);
    assert.equal(cue.sampleFrame, Math.round(cue.timeSeconds * FIRE_SCORE_TRACK.sampleRate));
    assert.ok(cue.sampleFrame >= 0 && cue.sampleFrame < FIRE_SCORE_TRACK.durationSeconds * FIRE_SCORE_TRACK.sampleRate);
    if (index > 0) assert.ok(cue.sampleFrame > FIRE_SCORE_CUES[index - 1].sampleFrame);
    assert.equal(cue.bar, Math.floor(cue.timeSeconds / 1.875));
    assert.ok([1, 2, 3].includes(cue.tier));
    assert.ok(cue.strength >= 0 && cue.strength <= 1);
    assert.ok(cue.heat >= 0 && cue.heat <= 1);
    assert.ok(cue.turbulence >= 0 && cue.turbulence <= 1);
    assert.ok(Math.hypot(cue.x, cue.z) <= 1 + 1e-12);
    sectionCounts.set(cue.section, sectionCounts.get(cue.section) + 1);
  }
  for (const section of FIRE_SCORE_SECTIONS) {
    assert.equal(sectionCounts.get(section.id), section.cueCount, section.id);
    const first = FIRE_SCORE_CUES.find(cue => cue.section === section.id);
    assert.equal(first.timeSeconds, section.startSeconds);
    assert.equal(first.kind, "ignition");
    assert.equal(first.tier, 3);
  }

  // Significant-event rhythm never copies an eight-bar window elsewhere in
  // the piece. Harmonic, bass and melodic renderers add further bar variation.
  const windowFingerprints = [];
  for (let firstBar = 0; firstBar <= FIRE_SCORE_TRACK.bars - 8; ++firstBar) {
    windowFingerprints.push(FIRE_SCORE_CUES
      .filter(cue => cue.bar >= firstBar && cue.bar < firstBar + 8)
      .map(cue => [
        (cue.timeSeconds - firstBar * 1.875).toFixed(7),
        cue.tier,
        cue.kind,
      ].join(":"))
      .join("|"));
  }
  assert.equal(new Set(windowFingerprints).size, windowFingerprints.length);
});

test("position and authored analysis clamp instead of wrapping and remain normalized", () => {
  assert.equal(fireScorePositionAt(-20).timeSeconds, 0);
  assert.equal(fireScorePositionAt(1e6).timeSeconds, 180);
  assert.equal(fireScorePositionAt(180).ended, true);
  assert.equal(fireScorePositionAt(180).section, "last-coal");
  assert.notDeepEqual(sampleFireScore(0), sampleFireScore(180));

  const normalized = [
    "beatPhase", "barPhase", "sectionProgress", "pulse", "bass", "mid", "air",
    "energy", "heat", "flame", "smoke", "turbulence", "spark", "flare", "crown", "accent",
  ];
  for (let step = 0; step <= 3600; ++step) {
    const analysis = sampleFireScore(step / 20);
    for (const key of normalized) {
      assert.ok(analysis[key] >= 0 && analysis[key] <= 1, `${key}=${analysis[key]} at ${analysis.timeSeconds}`);
    }
    assert.equal(analysis.cueIndex, analysis.cueId);
    assert.equal(analysis.cuesPassed, analysis.cueId);
  }

  for (const cue of FIRE_SCORE_CUES.filter(cue => cue.tier === 3).slice(0, 12)) {
    const hit = sampleFireScore(cue.timeSeconds);
    const tail = sampleFireScore(Math.min(180, cue.timeSeconds + 0.4));
    assert.ok(hit.accent >= tail.accent, `cue ${cue.cueId} must decay`);
  }
  assert.ok(sampleFireScore(90).energy > sampleFireScore(110).energy, "crownfire must outweigh ash-eye");
  assert.equal(sampleFireScore(180).flame, 0);
});

test("controller never autoplays, never loops, supports cues and exposes safe transport", async () => {
  class FakeAudio {
    constructor(source) {
      this.src = source;
      this.currentTime = 0;
      this.paused = true;
      this.ended = false;
      this.playCount = 0;
      this.closed = false;
    }
    play() { this.paused = false; this.ended = false; ++this.playCount; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
    close() { this.closed = true; }
  }

  let element;
  const controller = createFireScoreAudioController({
    audioFactory(source) { element = new FakeAudio(source); return element; },
  });
  assert.equal(element.playCount, 0);
  assert.equal(element.loop, false);
  assert.equal(element.preload, "auto");
  assert.equal(element.volume, 0.44);
  assert.equal(controller.status().playing, false);
  assert.equal(await controller.start(), true);
  assert.equal(element.playCount, 1);
  assert.equal(controller.update().playing, true);

  const firstPackets = controller.pollCues();
  assert.deepEqual(firstPackets.map(packet => packet.cueId), [1]);
  const targetCue = FIRE_SCORE_CUES[5];
  element.currentTime = targetCue.timeSeconds + 1 / FIRE_SCORE_TRACK.sampleRate;
  const crossed = controller.pollCues();
  assert.equal(crossed.at(-1).cueId, targetCue.cueId);
  assert.equal(crossed.at(-1).cue.kind, targetCue.kind);

  const seeked = controller.seek(500);
  assert.equal(seeked.timeSeconds, 180);
  assert.equal(controller.setVolume(3), 1);
  assert.equal(element.volume, 1);
  assert.equal(await controller.restart(), true);
  assert.equal(element.currentTime, 0);
  assert.equal(element.loop, false);
  assert.equal(await controller.toggle(), false);
  assert.equal(controller.status().playing, false);
  controller.dispose();
  assert.equal(element.closed, true);
  assert.equal(controller.status().available, false);
});

test("committed master is exact 48 kHz stereo PCM16 with 233 matching RIFF cues", async () => {
  const bytes = await readFile(join(sampleRoot, "assets", "cin-sin-fire-pattern-233.wav"));
  const chunks = chunksIn(bytes);
  const fmt = chunks.get("fmt ");
  const data = chunks.get("data");
  const cue = chunks.get("cue ");
  assert.ok(fmt && data && cue);
  assert.equal(bytes.readUInt16LE(fmt.offset), 1);
  assert.equal(bytes.readUInt16LE(fmt.offset + 2), 2);
  assert.equal(bytes.readUInt32LE(fmt.offset + 4), 48_000);
  assert.equal(bytes.readUInt32LE(fmt.offset + 8), 192_000);
  assert.equal(bytes.readUInt16LE(fmt.offset + 12), 4);
  assert.equal(bytes.readUInt16LE(fmt.offset + 14), 16);
  assert.equal(data.size, 180 * 48_000 * 4);
  assert.equal(bytes.readUInt32LE(cue.offset), 233);
  assert.equal(cue.size, 4 + 233 * 24);
  for (let index = 0; index < FIRE_SCORE_CUES.length; ++index) {
    const record = cue.offset + 4 + index * 24;
    assert.equal(bytes.readUInt32LE(record), FIRE_SCORE_CUES[index].cueId);
    assert.equal(bytes.readUInt32LE(record + 4), FIRE_SCORE_CUES[index].sampleFrame);
    assert.equal(bytes.toString("ascii", record + 8, record + 12), "data");
    assert.equal(bytes.readUInt32LE(record + 20), FIRE_SCORE_CUES[index].sampleFrame);
  }

  let peak = 0;
  let sum = 0;
  let stereoDifference = 0;
  for (let offset = data.offset; offset < data.offset + data.size; offset += 4) {
    const left = bytes.readInt16LE(offset) / 32768;
    const right = bytes.readInt16LE(offset + 2) / 32768;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    sum += (left * left + right * right) * 0.5;
    stereoDifference += (left - right) ** 2;
  }
  const frames = data.size / 4;
  const rms = Math.sqrt(sum / frames);
  const stereoDifferenceRms = Math.sqrt(stereoDifference / frames);
  assert.ok(peak > 0.74 && peak <= 0.92, `peak ${peak}`);
  assert.ok(rms > 0.11 && rms < 0.22, `RMS ${rms}`);
  assert.ok(stereoDifferenceRms > 0.015, `stereo difference ${stereoDifferenceRms}`);
  assert.equal(bytes.readInt16LE(data.offset), 0);
  assert.equal(bytes.readInt16LE(data.offset + 2), 0);
  assert.equal(bytes.readInt16LE(data.offset + data.size - 4), 0);
  assert.equal(bytes.readInt16LE(data.offset + data.size - 2), 0);

  // Section RMS follows the authored fire arc: both climaxes clearly exceed
  // the opening, ash-eye and dying-coal passages.
  const sectionRms = FIRE_SCORE_SECTIONS.map(section => {
    const firstFrame = Math.round(section.startSeconds * 48_000);
    const finalFrame = Math.round(section.endSeconds * 48_000);
    let energy = 0;
    let count = 0;
    for (let frame = firstFrame; frame < finalFrame; frame += 12) {
      const offset = data.offset + frame * 4;
      const left = bytes.readInt16LE(offset) / 32768;
      const right = bytes.readInt16LE(offset + 2) / 32768;
      energy += (left * left + right * right) * 0.5;
      count += 1;
    }
    return Math.sqrt(energy / count);
  });
  assert.ok(sectionRms[4] > sectionRms[0] * 2.5);
  assert.ok(sectionRms[7] > sectionRms[5] * 1.7);
  assert.ok(sectionRms[7] > sectionRms[8] * 2.2);
});

test("generator is seed-deterministic and owns no copied or remote audio", async () => {
  const generator = await readFile(join(sampleRoot, "tools", "generate-fire-score.mjs"), "utf8");
  assert.match(generator, /P4_MOTIF/);
  assert.match(generator, /for \(const cue of FIRE_SCORE_CUES\) renderCueAccent\(cue\)/);
  assert.doesNotMatch(generator, /Math\.random|Date\.now|https?:\/\//);
});
