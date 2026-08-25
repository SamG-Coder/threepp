import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MERCURY_BASS_CUES,
  MERCURY_BASS_TRACK,
  MERCURY_SONG_SECTIONS,
  applyBassCueToMercury,
  bassCueDescriptor,
  createMercuryBassController,
  mapBassCueToMercuryShock,
  mercurySongPosition,
} from "../src/bass-shocks.mjs";
import { MercuryPoolModel } from "../src/mercury-model.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function findChunks(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  const chunks = new Map();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    assert.ok(dataOffset + size <= bytes.length, `${id} chunk exceeds the WAV`);
    chunks.set(id, { offset: dataOffset, size });
    offset = dataOffset + size + (size & 1);
  }
  return chunks;
}

test("authored bass cues are ordered, unique, and physically bounded", () => {
  assert.equal(MERCURY_BASS_TRACK.sampleRate, 48_000);
  assert.equal(MERCURY_BASS_TRACK.durationSeconds, 96);
  assert.equal(MERCURY_SONG_SECTIONS.length, 6);
  assert.deepEqual(MERCURY_SONG_SECTIONS.map(section => section.name), [
    "atmospheric-intro",
    "accelerating-build",
    "main-drop",
    "half-time-breakdown",
    "second-variation-final-lift",
    "long-decay-outro",
  ]);
  assert.deepEqual(
    MERCURY_SONG_SECTIONS.map(section => [section.bpmStart, section.bpmEnd]),
    [[58, 66], [72, 112], [118, 124], [68, 74], [126, 134], [72, 54]],
  );
  assert.equal(mercurySongPosition(20).section.name, "accelerating-build");
  assert.ok(mercurySongPosition(29).bpm > mercurySongPosition(17).bpm);
  assert.equal(mercurySongPosition(55).section.name, "half-time-breakdown");
  assert.equal(mercurySongPosition(70).section.name, "second-variation-final-lift");
  assert.equal(mercurySongPosition(96).seconds, 0, "tempo map wraps exactly");

  assert.equal(MERCURY_BASS_CUES.length, 122);
  assert.equal(new Set(MERCURY_BASS_CUES.map(cue => cue.cueId)).size, 122);
  const countsBySection = Object.fromEntries(MERCURY_SONG_SECTIONS.map(section => [
    section.name,
    MERCURY_BASS_CUES.filter(cue => cue.section === section.name).length,
  ]));
  assert.ok(countsBySection["atmospheric-intro"] < countsBySection["main-drop"]);
  assert.ok(countsBySection["half-time-breakdown"] < countsBySection["second-variation-final-lift"]);
  assert.equal(MERCURY_BASS_CUES.filter(cue => cue.tier === 3).length, 6);
  for (let index = 0; index < MERCURY_BASS_CUES.length; ++index) {
    const cue = MERCURY_BASS_CUES[index];
    assert.equal(bassCueDescriptor(cue.cueId), cue);
    assert.ok(cue.timeSeconds >= 0 && cue.timeSeconds < MERCURY_BASS_TRACK.durationSeconds);
    if (index > 0) assert.ok(cue.timeSeconds >= MERCURY_BASS_CUES[index - 1].timeSeconds);
    assert.ok(Math.abs(cue.x) <= 0.6);
    assert.ok(Math.abs(cue.z) <= 0.6);
    assert.ok(cue.strength >= 0.55 && cue.strength <= 1);
    assert.ok(cue.tier >= 1 && cue.tier <= 3);
    assert.ok(cue.radius >= 0.33 && cue.radius <= 0.50);
  }
  assert.equal(bassCueDescriptor(999_999), null);
});

test("generated PCM16 WAV embeds the exact authored RIFF cue points", async () => {
  const bytes = await readFile(join(sampleRoot, "assets", "mercury-sub-bass.wav"));
  const declaredRiffSize = bytes.readUInt32LE(4);
  assert.equal(declaredRiffSize + 8, bytes.length);
  const chunks = findChunks(bytes);
  const fmt = chunks.get("fmt ");
  const data = chunks.get("data");
  const cue = chunks.get("cue ");
  assert.ok(fmt && data && cue);
  assert.equal(bytes.readUInt16LE(fmt.offset), 1, "PCM format");
  assert.equal(bytes.readUInt16LE(fmt.offset + 2), 2, "stereo channels");
  assert.equal(bytes.readUInt32LE(fmt.offset + 4), MERCURY_BASS_TRACK.sampleRate);
  assert.equal(bytes.readUInt16LE(fmt.offset + 14), 16, "16-bit samples");
  assert.equal(data.size % 4, 0, "whole stereo PCM frames");
  assert.equal(bytes.readUInt32LE(cue.offset), MERCURY_BASS_CUES.length);

  const frameCount = data.size / 4;
  assert.equal(frameCount / MERCURY_BASS_TRACK.sampleRate, 96);
  let peak = 0;
  let squaredSum = 0;
  for (let frame = 0; frame < frameCount; ++frame) {
    const left = bytes.readInt16LE(data.offset + frame * 4) / 32768;
    const right = bytes.readInt16LE(data.offset + frame * 4 + 2) / 32768;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    const mono = (left + right) * 0.5;
    squaredSum += mono * mono;
  }
  const rms = Math.sqrt(squaredSum / frameCount);
  assert.ok(peak > 0.78 && peak < 0.90, `safe deliberate peak level: ${peak}`);
  assert.ok(rms > 0.10 && rms < 0.22, `audible but controlled song RMS: ${rms}`);
  const sectionRms = new Map(MERCURY_SONG_SECTIONS.map(section => {
    const firstFrame = Math.round(section.start * MERCURY_BASS_TRACK.sampleRate);
    const finalFrame = Math.round(section.end * MERCURY_BASS_TRACK.sampleRate);
    let sum = 0;
    for (let frame = firstFrame; frame < finalFrame; ++frame) {
      const left = bytes.readInt16LE(data.offset + frame * 4) / 32768;
      const right = bytes.readInt16LE(data.offset + frame * 4 + 2) / 32768;
      const mono = (left + right) * 0.5;
      sum += mono * mono;
    }
    return [section.name, Math.sqrt(sum / (finalFrame - firstFrame))];
  }));
  assert.ok(
    sectionRms.get("main-drop") > sectionRms.get("atmospheric-intro") * 2.5,
    Object.fromEntries(sectionRms),
  );
  assert.ok(
    sectionRms.get("half-time-breakdown") < sectionRms.get("main-drop") * 0.55,
    Object.fromEntries(sectionRms),
  );
  assert.ok(
    sectionRms.get("second-variation-final-lift") >
      sectionRms.get("half-time-breakdown") * 2,
    Object.fromEntries(sectionRms),
  );
  for (const channelOffset of [0, 2]) {
    const first = bytes.readInt16LE(data.offset + channelOffset);
    const last = bytes.readInt16LE(data.offset + data.size - 4 + channelOffset);
    assert.ok(Math.abs(first - last) <= 192, `channel seam delta: ${first - last}`);
  }

  // Measure a strong drop accent. These partials deliberately occupy the
  // 55-140 Hz range so the bass remains obvious without a subwoofer.
  const majorAccent = MERCURY_BASS_CUES.find(cue => cue.tier === 3);
  const accentStart = Math.round((majorAccent.timeSeconds + 0.015) * MERCURY_BASS_TRACK.sampleRate);
  const accentLength = Math.round(0.24 * MERCURY_BASS_TRACK.sampleRate);
  function amplitudeAt(frequency) {
    let real = 0;
    let imaginary = 0;
    for (let sample = 0; sample < accentLength; ++sample) {
      const frame = accentStart + sample;
      const left = bytes.readInt16LE(data.offset + frame * 4);
      const right = bytes.readInt16LE(data.offset + frame * 4 + 2);
      const value = (left + right) / (2 * 32768);
      const phase = Math.PI * 2 * frequency * sample / MERCURY_BASS_TRACK.sampleRate;
      real += value * Math.cos(phase);
      imaginary -= value * Math.sin(phase);
    }
    return 2 * Math.hypot(real, imaginary) / accentLength;
  }
  const ordinarySpeakerBass = [55, 73, 96, 110, 140]
    .reduce((sum, frequency) => sum + amplitudeAt(frequency), 0);
  assert.ok(ordinarySpeakerBass > 0.25, `audible bass-band amplitude: ${ordinarySpeakerBass}`);

  for (let index = 0; index < MERCURY_BASS_CUES.length; ++index) {
    const record = cue.offset + 4 + index * 24;
    const authored = MERCURY_BASS_CUES[index];
    const expectedFrame = Math.round(
      authored.timeSeconds * MERCURY_BASS_TRACK.sampleRate,
    );
    assert.equal(bytes.readUInt32LE(record), authored.cueId);
    assert.equal(bytes.readUInt32LE(record + 4), expectedFrame);
    assert.equal(bytes.toString("ascii", record + 8, record + 12), "data");
    assert.equal(bytes.readUInt32LE(record + 20), expectedFrame);
  }
});

test("native audio-clock packets map to safe fixed-tick radial shocks", () => {
  const model = new MercuryPoolModel({
    width: 20,
    height: 24,
    poolWidth: 1.6,
    poolDepth: 1.9,
  });
  const packet = {
    sequence: 1,
    cueId: 1,
    sampleFrame: 2_400,
    absoluteSample: 2_400,
    playheadSample: 0,
    sampleRate: 48_000,
    loop: 0,
  };
  const shock = mapBassCueToMercuryShock(model, packet);
  assert.equal(shock.atTick, 12, "50 ms lookahead maps to twelve 240 Hz ticks");
  assert.equal(shock.recoilTick, 16);
  assert.ok(shock.x > model.worldBounds.minX && shock.x < model.worldBounds.maxX);
  assert.ok(shock.z > model.worldBounds.minZ && shock.z < model.worldBounds.maxZ);
  assert.equal(shock.tier, 1);
  assert.equal(shock.liftAmplitude, 0);
  assert.ok(shock.amplitude > 0.035 && shock.amplitude < 0.04);
  assert.ok(shock.radius <= model.poolWidth * 0.5);

  const applied = applyBassCueToMercury(model, packet);
  assert.deepEqual(applied, shock);
  assert.equal(model.stats().pendingEvents, 2);
  model.advanceTicks(12);
  assert.ok(model.depth.every(value => value === model.meanDepth));
  model.advanceTicks(1);
  assert.ok(model.stats().rmsSurfaceDisplacement > 0.001);
  assert.ok(Math.abs(model.stats().volumeError) < 1e-12);
});

test("tier-three sound-wave accents produce a bounded near-jump compound lift", () => {
  const model = new MercuryPoolModel({ width: 24, height: 28, poolWidth: 1.8, poolDepth: 2.1 });
  const cue = MERCURY_BASS_CUES.find(value => value.tier === 3);
  const packet = {
    cueId: cue.cueId,
    sampleFrame: Math.round(cue.timeSeconds * MERCURY_BASS_TRACK.sampleRate),
    playheadSample: Math.round(cue.timeSeconds * MERCURY_BASS_TRACK.sampleRate),
    sampleRate: MERCURY_BASS_TRACK.sampleRate,
    loop: 0,
  };
  const shock = applyBassCueToMercury(model, packet);
  assert.equal(shock.tier, 3);
  assert.equal(shock.amplitude, 0.070);
  assert.ok(shock.liftAmplitude > 0.055);
  assert.equal(model.stats().pendingEvents, 2, "lift and recoil remain queued after immediate push");
  model.advanceTicks(2);
  const airborne = model.stats();
  assert.ok(airborne.maximumDepth > model.meanDepth + 0.085, airborne);
  assert.ok(airborne.minimumDepth >= model.minimumDepth - 1e-12, airborne);
  assert.ok(Math.abs(airborne.volumeError) / model.restVolume < 1e-10, airborne);
});

test("controller drains every native cue once and shares pause/reset lifecycle", async () => {
  class FakeNativeAudio {
    constructor(source) {
      this.src = source;
      this.currentTime = 0;
      this.paused = true;
      this.packets = [];
    }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    pollCues() { return this.packets.splice(0); }
  }

  const model = new MercuryPoolModel({ width: 16, height: 20, poolWidth: 1.6, poolDepth: 2 });
  let nativeAudio;
  const controller = createMercuryBassController({
    model,
    audioFactory(source) {
      nativeAudio = new FakeNativeAudio(source);
      return nativeAudio;
    },
  });
  assert.equal(controller.status().available, true);
  assert.equal(nativeAudio.volume, 0.88);
  assert.equal(await controller.play(), true);
  const due = {
    sequence: 7,
    cueId: 6,
    sampleFrame: 10_000,
    playheadSample: 10_200,
    sampleRate: 48_000,
    loop: 2,
  };
  nativeAudio.packets.push(due, { ...due });
  assert.equal(controller.poll(), 1, "duplicate native sequence is ignored");
  assert.equal(controller.status().shockCount, 1);
  assert.equal(controller.status().lastCueId, 6);
  assert.equal(controller.status().lastLoop, 2);
  assert.ok(model.stats().rmsSurfaceDisplacement > 0);

  controller.pause();
  nativeAudio.packets.push({ ...due, sequence: 8, cueId: 7 });
  assert.equal(controller.poll(), 0);
  assert.equal(await controller.restart(), true);
  assert.equal(nativeAudio.currentTime, 0);
  assert.equal(controller.poll(), 1);
  controller.dispose();
  assert.equal(controller.status().playing, false);
  assert.equal(nativeAudio.src, "");
});

test("many musical loops remain finite, positive, and volume-conserving", () => {
  const model = new MercuryPoolModel({ width: 16, height: 20, poolWidth: 1.6, poolDepth: 2 });
  const loopSamples = MERCURY_BASS_TRACK.durationSeconds * MERCURY_BASS_TRACK.sampleRate;
  for (let loop = 0; loop < 2; ++loop) {
    for (const cue of MERCURY_BASS_CUES) {
      const sampleFrame = Math.round(cue.timeSeconds * MERCURY_BASS_TRACK.sampleRate);
      applyBassCueToMercury(model, {
        cueId: cue.cueId,
        sampleFrame,
        absoluteSample: loop * loopSamples + sampleFrame,
        playheadSample: 0,
        sampleRate: MERCURY_BASS_TRACK.sampleRate,
        loop,
      });
    }
  }
  const finalTick = Math.ceil(2 * loopSamples / MERCURY_BASS_TRACK.sampleRate / model.fixedStepSeconds) + 480;
  model.advanceTicks(finalTick);
  const stats = model.stats();
  for (const field of [model.depth, model.surface, model.velocityX, model.velocityZ]) {
    assert.ok(field.every(Number.isFinite));
  }
  assert.ok(stats.minimumDepth >= model.minimumDepth - 1e-12);
  assert.ok(stats.maximumSpeed <= model.maximumVelocity + 1e-12);
  assert.ok(Math.abs(stats.volumeError) / model.restVolume < 1e-10);
});
