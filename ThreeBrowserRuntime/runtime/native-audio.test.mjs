import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addonPath = path.resolve(here, "../build/bin/three_browser_runtime.node");
const bassTrack = path.resolve(
  here,
  "../samples/webgpu_rtx_neon_mercury_room/assets/mercury-sub-bass.wav",
);
const bassContract = await import(pathToFileURL(path.resolve(
  here,
  "../samples/webgpu_rtx_neon_mercury_room/src/bass-shocks.mjs",
)));
const expectedCuePoints = bassContract.MERCURY_BASS_CUES.map(cue => ({
  cueId: cue.cueId,
  sampleFrame: Math.round(cue.timeSeconds * bassContract.MERCURY_BASS_TRACK.sampleRate),
}));
const expectedLengthFrames = Math.round(
  bassContract.MERCURY_BASS_TRACK.durationSeconds * bassContract.MERCURY_BASS_TRACK.sampleRate,
);
const available = fs.existsSync(addonPath) && fs.existsSync(bassTrack);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("native PCM playback exposes the WAV cue clock", {
  skip: available ? false : "native addon or generated bass track is not built",
}, async t => {
  const native = require(addonPath);
  for (const method of [
    "audioOpen", "audioPlay", "audioPause", "audioSetLooping", "audioSetVolume",
    "audioSetPlaybackRate", "audioSeek", "audioState", "audioPollCues", "audioClose",
  ]) {
    assert.equal(typeof native[method], "function", `${method} must cross the N-API boundary`);
  }

  const opened = native.audioOpen(bassTrack);
  if (!opened.handle) {
    t.skip(`default audio output is unavailable: ${opened.error || "unknown error"}`);
    return;
  }
  try {
    assert.equal(opened.error, "");
    assert.equal(opened.state.sampleRate, 48_000);
    assert.equal(opened.state.channels, 2);
    assert.equal(opened.cueCount, expectedCuePoints.length);
    assert.deepEqual(opened.cuePoints, expectedCuePoints);
    assert.equal(opened.state.lengthFrames, expectedLengthFrames);

    assert.equal(native.audioSetLooping(opened.handle, true), true);
    assert.equal(native.audioSetVolume(opened.handle, 0.18), true);
    assert.equal(native.audioSeek(
      opened.handle,
      Math.max(0, expectedCuePoints[0].sampleFrame - 2_400),
    ), true);
    assert.equal(native.audioPlay(opened.handle), true);
    await wait(140);

    const firstPoll = native.audioPollCues(opened.handle);
    assert.deepEqual(firstPoll.cues.map(cue => cue.cueId), [expectedCuePoints[0].cueId]);
    assert.deepEqual(firstPoll.cues.map(cue => cue.sequence), [1]);
    assert.ok(firstPoll.cues.every(cue => cue.playheadSample > 0));
    assert.equal(firstPoll.cues.every(cue => cue.sampleRate === 48_000), true);
    assert.deepEqual(native.audioPollCues(opened.handle).cues, [], "cues are consumed once");

    assert.equal(native.audioPause(opened.handle), true);
    const paused = native.audioState(opened.handle);
    assert.equal(paused.playing, false);
    assert.equal(paused.looping, true);
    assert.ok(Math.abs(paused.volume - 0.18) < 1e-5);
    assert.ok(paused.cursorFrame > 0);
  } finally {
    native.audioClose(opened.handle);
  }
});

test("HTMLAudioElement forwards playback and cue polling to native C++", {
  skip: available ? false : "native addon or generated bass track is not built",
}, async t => {
  process.env.THREEBROWSER_RUNTIME_ADDON = addonPath;
  const host = await import(`${pathToFileURL(path.join(here, "browser-host.mjs")).href}?native-audio-test`);
  const audio = new Audio(pathToFileURL(bassTrack).href);
  audio.loop = true;
  audio.volume = 0.16;
  const played = await audio.play().then(() => true, error => {
    t.skip(`default audio output is unavailable: ${error?.message || error}`);
    return false;
  });
  if (!played) return;
  try {
    assert.equal(audio.readyState, HTMLMediaElement.HAVE_ENOUGH_DATA);
    assert.ok(Math.abs(audio.duration - bassContract.MERCURY_BASS_TRACK.durationSeconds) < 1 / 30);
    assert.equal(audio.paused, false);
    audio.currentTime = Math.max(0, bassContract.MERCURY_BASS_CUES[0].timeSeconds - 0.05);
    await wait(120);
    const cues = audio.pollCues(0);
    assert.deepEqual(cues.map(cue => cue.cueId), [bassContract.MERCURY_BASS_CUES[0].cueId]);
    assert.equal(audio.pollCues(0).length, 0);
    assert.ok(audio.currentTime > 0);
    audio.pause();
    assert.equal(audio.paused, true);
  } finally {
    audio.close();
    host.stop();
  }
});
