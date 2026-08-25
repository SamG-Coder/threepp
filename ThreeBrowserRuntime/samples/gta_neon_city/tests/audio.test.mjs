import assert from "node:assert/strict";
import test from "node:test";
import {
  SPATIAL_AUDIO_PROFILES,
  SPATIAL_VOICE_COUNTS,
  calculateSpatialMix,
  createAudioDefinitions,
  createChannelIsolatedStereoWav,
  createGameAudio,
  createSpatialListenerState,
  createSpatialVoicePool,
  synthesizeWav,
  updateSpatialListener,
} from "../src/game/audio.mjs";

test("procedural audio encoder writes a valid deterministic mono PCM wave", () => {
  const wave = synthesizeWav(0.1, time => Math.sin(Math.PI * 2 * 220 * time), 8_000);
  assert.equal(new TextDecoder().decode(wave.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wave.subarray(8, 12)), "WAVE");
  const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 8_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 1_600);
  assert.equal(wave.byteLength, 1_644);
  assert.ok(wave.some((value, index) => index >= 44 && value !== 0));
});

test("procedural sound bank includes deterministic storm and vehicle ambience", () => {
  const first = createAudioDefinitions();
  const second = createAudioDefinitions();
  for (const name of ["ambience", "cityDay", "cityNight", "engine", "rain", "tire", "thunder", "gunshot", "melee", "footstep"]) {
    assert.ok(first[name] instanceof Uint8Array, `${name} should be encoded in memory`);
    assert.ok(first[name].byteLength > 1_000, `${name} should contain non-trivial PCM data`);
    assert.deepEqual(first[name], second[name], `${name} synthesis should be deterministic`);
  }
  assert.ok(first.thunder.byteLength > first.gunshot.byteLength * 5, "thunder should retain a long low-frequency tail");
});

test("taxi boarding and meter cues are deterministic prebuilt one-shots", () => {
  const first = createAudioDefinitions();
  const second = createAudioDefinitions();
  for (const name of ["taxiDoor", "seatbelt", "taxiMeter"]) {
    assert.ok(first[name] instanceof Uint8Array, `${name} should be encoded before play`);
    assert.ok(first[name].byteLength > 5_000, `${name} should have a readable mechanical tail`);
    assert.deepEqual(first[name], second[name], `${name} must be deterministic`);
    assert.equal(new TextDecoder().decode(first[name].subarray(0, 4)), "RIFF");
    assert.equal(new TextDecoder().decode(first[name].subarray(8, 12)), "WAVE");
  }
  assert.notDeepEqual(first.taxiDoor, first.seatbelt);
  assert.notDeepEqual(first.seatbelt, first.taxiMeter);
});

test("channel-isolated stereo WAV pairs preserve PCM in exactly one channel", () => {
  const mono = synthesizeWav(0.02, time => Math.sin(Math.PI * 2 * 220 * time) * 0.5, 8_000);
  const left = createChannelIsolatedStereoWav(mono, "left");
  const right = createChannelIsolatedStereoWav(mono, "right");
  const leftView = new DataView(left.buffer, left.byteOffset, left.byteLength);
  const rightView = new DataView(right.buffer, right.byteOffset, right.byteLength);
  const monoView = new DataView(mono.buffer, mono.byteOffset, mono.byteLength);
  assert.equal(leftView.getUint16(22, true), 2);
  assert.equal(rightView.getUint16(22, true), 2);
  assert.equal(leftView.getUint32(24, true), 8_000);
  assert.equal(leftView.getUint16(32, true), 4);
  assert.equal(leftView.getUint32(40, true), monoView.getUint32(40, true) * 2);
  for (let frame = 0; frame < 160; ++frame) {
    const monoSample = monoView.getInt16(44 + frame * 2, true);
    assert.equal(leftView.getInt16(44 + frame * 4, true), monoSample);
    assert.equal(leftView.getInt16(46 + frame * 4, true), 0);
    assert.equal(rightView.getInt16(44 + frame * 4, true), 0);
    assert.equal(rightView.getInt16(46 + frame * 4, true), monoSample);
  }
  assert.deepEqual(left, createChannelIsolatedStereoWav(mono, "left"));
  assert.deepEqual(right, createChannelIsolatedStereoWav(mono, "right"));
});

test("camera-relative equal-power pan and inverse distance attenuation are deterministic", () => {
  const listener = createSpatialListenerState();
  updateSpatialListener(listener, [0, 0, 0], [0, 0, -1], [0, 1, 0]);
  const right = calculateSpatialMix(listener, [12, 0, 0], SPATIAL_AUDIO_PROFILES.gunshot, 0.8, {});
  const left = calculateSpatialMix(listener, [-12, 0, 0], SPATIAL_AUDIO_PROFILES.gunshot, 0.8, {});
  assert.ok(right.pan > 0.999 && left.pan < -0.999);
  assert.ok(right.rightGain > 0 && right.leftGain < 1e-8);
  assert.ok(left.leftGain > 0 && left.rightGain < 1e-8);
  const expectedPower = (0.8 * right.attenuation) ** 2;
  assert.ok(Math.abs(right.leftGain ** 2 + right.rightGain ** 2 - expectedPower) < 1e-12);

  const near = calculateSpatialMix(listener, [0, 0, -6], SPATIAL_AUDIO_PROFILES.gunshot, 1, {});
  const far = calculateSpatialMix(listener, [0, 0, -60], SPATIAL_AUDIO_PROFILES.gunshot, 1, {});
  const rejected = calculateSpatialMix(listener, [0, 0, -181], SPATIAL_AUDIO_PROFILES.gunshot, 1, {});
  assert.ok(far.attenuation < near.attenuation * 0.2, `${near.attenuation} -> ${far.attenuation}`);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.leftGain, 0);
  assert.equal(rejected.rightGain, 0);

  updateSpatialListener(listener, [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  const cameraRight = calculateSpatialMix(listener, [0, 0, 10], SPATIAL_AUDIO_PROFILES.horn, 1, {});
  assert.ok(cameraRight.pan > 0.999, "pan must rotate with the active camera, not world X");
});

test("fixed spatial voice pools wrap without creating late elements or sources", () => {
  const elements = [];
  const played = [];
  const createElement = source => {
    const element = {
      source,
      paused: true,
      volume: 0,
      currentTime: 7,
      pause() { this.paused = true; },
      play() { this.paused = false; },
    };
    elements.push(element);
    return element;
  };
  const pool = createSpatialVoicePool({
    name: "gunshot",
    count: 3,
    leftFile: "gunshot-left.wav",
    rightFile: "gunshot-right.wav",
    createElement,
    playElement(element) { element.play(); played.push(element); },
  });
  const mix = { accepted: true, leftGain: 0.25, rightGain: 0.75 };
  const indices = [pool.trigger(mix), pool.trigger(mix), pool.trigger(mix), pool.trigger(mix)];
  assert.deepEqual(indices, [0, 1, 2, 0]);
  assert.equal(elements.length, 6);
  assert.equal(played.length, 8);
  assert.equal(pool.plays, 4);
  assert.equal(pool.steals, 1);
  assert.equal(pool.lastStolen, true);
  assert.ok(elements.every(element => element.currentTime === 0));
});

test("game audio preloads a bounded native stereo pool and keeps UI flat", async () => {
  class FakeAudio extends EventTarget {
    constructor(source) {
      super();
      this.src = source;
      this.currentSrc = source;
      this.readyState = 0;
      this.paused = true;
      this.volume = 0;
      this.currentTime = 0;
      this.loop = false;
      this.playbackRate = 1;
      this.playCount = 0;
      this.closed = false;
      queueMicrotask(() => {
        this.readyState = 4;
        this.dispatchEvent(new Event("canplaythrough"));
      });
    }
    play() { this.paused = false; this.playCount += 1; return Promise.resolve(); }
    pause() { this.paused = true; }
    close() { this.closed = true; }
  }
  const definitions = createAudioDefinitions();
  const files = Object.fromEntries(Object.keys(definitions).map(name => [name, `flat-${name}.wav`]));
  const spatialFiles = Object.fromEntries(Object.keys(SPATIAL_AUDIO_PROFILES).map(name => [name, {
    left: `${name}-left.wav`,
    right: `${name}-right.wav`,
  }]));
  const created = [];
  const audio = await createGameAudio({
    preparedFiles: { files, spatialFiles },
    audioFactory(source) { const element = new FakeAudio(source); created.push(element); return element; },
  });
  let state = audio.snapshot();
  const expectedPairs = Object.values(SPATIAL_VOICE_COUNTS).reduce((sum, count) => sum + count, 0) + 1;
  const expectedElements = Object.keys(files).length + expectedPairs * 2;
  assert.equal(state.filesReady, true);
  assert.ok(created.every(element => element.readyState === 4),
    "createGameAudio must await every native WAV handle before resolving");
  assert.equal(state.precreatedVoicePairs, expectedPairs);
  assert.equal(state.startupElementCount, expectedElements);
  assert.equal(created.length, expectedElements);
  assert.equal(state.runtimeElementAllocations, 0);
  assert.equal(state.runtimeSourceLoads, 0);

  audio.updateListener([0, 1.6, 0], [0, 0, -1], [0, 1, 0]);
  const voiceCount = SPATIAL_VOICE_COUNTS.gunshot;
  for (let index = 0; index <= voiceCount; ++index) audio.playAt("gunshot", 0.8, [12, 1.6, 0]);
  state = audio.snapshot();
  assert.equal(state.lastSpatialEvent.voiceIndex, 0);
  assert.ok(state.lastSpatialEvent.pan > 0.999);
  assert.ok(state.lastSpatialEvent.rightGain > state.lastSpatialEvent.leftGain);
  assert.equal(state.currentElementCount, expectedElements);
  assert.equal(state.runtimeElementAllocations, 0);
  assert.equal(state.runtimeSourceLoads, 0);

  const spatialSerial = state.lastSpatialEvent.serial;
  assert.equal(audio.play("mission", 0.5), true);
  assert.equal(audio.snapshot().lastSpatialEvent.serial, spatialSerial,
    "mission/UI feedback must stay on its single flat element");
  audio.update({ wantedStars: 2, sirenPosition: [15, 1, 0], sirenSourceId: "police-1" });
  state = audio.snapshot();
  assert.equal(state.activeSirenSource, "police-1");
  assert.equal(state.siren.active, true);
  assert.ok(state.siren.rightGain > state.siren.leftGain);
  audio.update({ wantedStars: 0, sirenPosition: [15, 1, 0], sirenSourceId: "police-1" });
  state = audio.snapshot();
  assert.equal(state.activeSirenSource, null);
  assert.equal(state.siren.leftGain, 0);
  assert.equal(state.siren.rightGain, 0);
  assert.equal(state.currentElementCount, expectedElements);
  audio.dispose();
  assert.ok(created.every(element => element.closed));
});
