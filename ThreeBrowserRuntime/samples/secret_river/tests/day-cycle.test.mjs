import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_LENGTH_SECONDS,
  DAY_START_PROGRESS,
  dayBlendAt,
  dayProgressAt,
  wrapDayProgress,
} from "../src/day-cycle.mjs";

test("day clock begins in late afternoon and wraps continuously", () => {
  assert.ok(Math.abs(dayProgressAt(0) - DAY_START_PROGRESS) < 1e-9);
  assert.ok(Math.abs(dayProgressAt(DAY_LENGTH_SECONDS) - DAY_START_PROGRESS) < 1e-9);
  assert.ok(Math.abs(wrapDayProgress(-0.1) - 0.9) < 1e-9);
});

test("day phases hold night and blend smoothly into the authored light states", () => {
  const night = dayBlendAt(0.06);
  assert.equal(night.from, "night");
  assert.equal(night.to, "night");

  const dawn = dayBlendAt(0.17);
  assert.equal(dawn.from, "night");
  assert.equal(dawn.to, "morning");
  assert.ok(dawn.mix > 0 && dawn.mix < 1);

  const dusk = dayBlendAt(0.81);
  assert.equal(dusk.from, "sunset");
  assert.equal(dusk.to, "night");
  assert.ok(dusk.mix > 0 && dusk.mix < 1);
});
