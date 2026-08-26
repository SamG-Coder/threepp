import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTidalAudioController, TIDAL_SCORE } from "../src/tidal-audio.mjs";

function fakeAudio() {
  return {
    currentTime: 0,
    duration: TIDAL_SCORE.durationSeconds,
    ended: false,
    paused: true,
    loop: true,
    preload: "",
    volume: 1,
    playbackRate: 1,
    load() {},
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    removeAttribute() {},
    close() {},
  };
}

test("tidal soundtrack controller is gesture-started, seekable and rate-aware", async () => {
  const voice = fakeAudio();
  const audio = createTidalAudioController({ audioFactory: () => voice });
  assert.equal(audio.status().playing, false);
  assert.equal(voice.loop, false);
  assert.equal(voice.preload, "auto");
  assert.equal(await audio.start({ timeSeconds: 18.5, rate: 2 }), true);
  assert.equal(audio.status().playing, true);
  assert.equal(voice.currentTime, 18.5);
  assert.equal(voice.playbackRate, 2);
  audio.pause();
  assert.equal(audio.status().playing, false);
  audio.seek(7.25);
  assert.equal(voice.currentTime, 7.25);
  audio.dispose();
  assert.equal(audio.status().available, false);
});

test("committed soundtrack is 72 seconds of stereo 48 kHz PCM", async () => {
  const wave = await readFile(new URL("../assets/tidal-rupture-score.wav", import.meta.url));
  assert.equal(wave.toString("ascii", 0, 4), "RIFF");
  assert.equal(wave.toString("ascii", 8, 12), "WAVE");
  assert.equal(wave.readUInt16LE(20), 1);
  assert.equal(wave.readUInt16LE(22), 2);
  assert.equal(wave.readUInt32LE(24), 48_000);
  const frames = wave.readUInt32LE(40) / (wave.readUInt16LE(22) * 2);
  assert.equal(frames / wave.readUInt32LE(24), 72);
});
