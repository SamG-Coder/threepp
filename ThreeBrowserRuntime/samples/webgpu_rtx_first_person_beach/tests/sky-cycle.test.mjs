import assert from "node:assert/strict";
import test from "node:test";
import {
  GAME_MINUTES_PER_REAL_SECOND,
  MINUTES_PER_DAY,
  createSkyClock,
  sampleSkyCycle,
} from "../src/sky-cycle.mjs";

test("one real second equals one game minute", () => {
  assert.equal(GAME_MINUTES_PER_REAL_SECOND, 1);
  assert.equal(MINUTES_PER_DAY, 1440);
  const clock = createSkyClock(0);
  clock.advance(1);
  assert.equal(clock.minutes, 1);
  clock.advance(59);
  assert.equal(Math.floor(clock.hours), 1);
});

test("a full real day is twenty-four minutes", () => {
  const clock = createSkyClock(0);
  clock.advance(24 * 60);
  assert.ok(clock.minutes < 1e-6 || Math.abs(clock.minutes - 0) < 1e-6);
});

test("sun is high at noon and below the horizon at midnight", () => {
  const noon = sampleSkyCycle(12);
  const midnight = sampleSkyCycle(0);
  const dawn = sampleSkyCycle(6);
  assert.ok(noon.sun.elevation > 0.9);
  assert.ok(noon.day > 0.85);
  assert.ok(midnight.sun.elevation < 0);
  assert.ok(midnight.night > 0.85);
  assert.ok(Math.abs(dawn.sun.elevation) < 0.08);
});

test("moon is up when the sun is down", () => {
  const midnight = sampleSkyCycle(0);
  const noon = sampleSkyCycle(12);
  assert.ok(midnight.moon.elevation > 0.4);
  assert.ok(noon.moon.elevation < 0);
  assert.ok(midnight.starVisibility > 0.7);
  assert.ok(noon.starVisibility < 0.05);
});
