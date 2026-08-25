import assert from "node:assert/strict";
import test from "node:test";
import { createAudioDefinitions, synthesizeWav } from "../src/game/audio.mjs";

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
