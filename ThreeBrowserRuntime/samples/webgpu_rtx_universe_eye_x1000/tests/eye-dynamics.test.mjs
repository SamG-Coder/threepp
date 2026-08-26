import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BLINK_DURATION_SECONDS,
  DEFAULT_PUPIL_RADIUS_MM,
  PUPIL_RADIUS_MAX_MM,
  PUPIL_RADIUS_MIN_MM,
  clampGaze,
  createEyeDynamics,
  pupilRadiusForLuminance,
  sampleBlink,
  sampleMicrosaccade,
} from "../src/eye-dynamics.mjs";
import { UNIVERSE_EYE_SEED } from "../src/universe-eye-model.mjs";

const closeTo = (actual, expected, epsilon = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("gaze is finite and constrained to the unit disc", () => {
  assert.deepEqual(clampGaze(0.25, -0.5), { x: 0.25, y: -0.5 });
  const diagonal = clampGaze(12, -12);
  closeTo(Math.hypot(diagonal.x, diagonal.y), 1);
  assert.deepEqual(clampGaze(Number.NaN, Infinity), { x: 0, y: 0 });
});

test("blink closes, holds briefly and opens without overshoot", () => {
  const duration = DEFAULT_BLINK_DURATION_SECONDS;
  assert.equal(sampleBlink(4.9, 5, duration), 0);
  assert.equal(sampleBlink(5, 5, duration), 0);
  assert.equal(sampleBlink(5 + duration * 0.42, 5, duration), 1);
  assert.equal(sampleBlink(5 + duration, 5, duration), 0);
  assert.equal(sampleBlink(6, 5, duration), 0);

  for (let step = 0; step <= 100; ++step) {
    const value = sampleBlink(5 + duration * step / 100, 5, duration);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("pupil response is bounded and contracts monotonically with light", () => {
  assert.equal(pupilRadiusForLuminance(1), PUPIL_RADIUS_MIN_MM);
  assert.equal(pupilRadiusForLuminance(0), PUPIL_RADIUS_MAX_MM);
  assert.equal(pupilRadiusForLuminance(-Infinity), PUPIL_RADIUS_MAX_MM);
  assert.equal(pupilRadiusForLuminance(Infinity), PUPIL_RADIUS_MAX_MM);

  let previous = Infinity;
  for (let step = 0; step <= 100; ++step) {
    const radius = pupilRadiusForLuminance(step / 100);
    assert.ok(radius >= PUPIL_RADIUS_MIN_MM && radius <= PUPIL_RADIUS_MAX_MM);
    assert.ok(radius <= previous);
    previous = radius;
  }
});

test("microsaccades are seeded, deterministic and tightly bounded", () => {
  assert.deepEqual(
    sampleMicrosaccade(12.345, UNIVERSE_EYE_SEED),
    sampleMicrosaccade(12.345, UNIVERSE_EYE_SEED),
  );
  assert.notDeepEqual(
    sampleMicrosaccade(12.345, UNIVERSE_EYE_SEED),
    sampleMicrosaccade(12.345, UNIVERSE_EYE_SEED ^ 1),
  );
  for (let step = 0; step < 1000; ++step) {
    const sample = sampleMicrosaccade(step / 60, UNIVERSE_EYE_SEED);
    assert.ok(Number.isFinite(sample.x) && Number.isFinite(sample.y));
    assert.ok(Math.abs(sample.x) <= 0.035);
    assert.ok(Math.abs(sample.y) <= 0.027);
  }
});

test("eye controller updates smoothly and is invariant to frame partitioning", () => {
  const single = createEyeDynamics();
  const partitioned = createEyeDynamics();
  single.setGaze(0.7, -0.4);
  single.setLuminance(0.9);
  partitioned.setGaze(0.7, -0.4);
  partitioned.setLuminance(0.9);

  const once = single.update(0.1);
  let many;
  for (let index = 0; index < 10; ++index) many = partitioned.update(0.01);
  for (const key of ["biologyTime", "gazeX", "gazeY", "pupilRadius", "blink"]) {
    closeTo(once[key], many[key], 1e-11);
  }

  assert.ok(once.gazeX > 0 && once.gazeX < 0.7);
  assert.ok(once.gazeY < 0 && once.gazeY > -0.4);
  assert.ok(once.pupilRadius < DEFAULT_PUPIL_RADIUS_MM);
  assert.ok(Object.isFrozen(once));
});

test("pause freezes biology while accepting targets, and reset is exact", () => {
  const dynamics = createEyeDynamics();
  dynamics.setGaze(0.5, 0.2);
  dynamics.triggerBlink();
  const moving = dynamics.update(0.08);
  dynamics.setPaused(true);
  const paused = dynamics.update(0.1, { gazeX: -0.9, gazeY: 0.1, luminance: 1 });
  const pausedAgain = dynamics.update(0.1);

  assert.equal(paused.paused, true);
  assert.equal(paused.biologyTime, moving.biologyTime);
  assert.equal(pausedAgain.biologyTime, paused.biologyTime);
  assert.equal(pausedAgain.gazeX, paused.gazeX);
  assert.equal(pausedAgain.gazeY, paused.gazeY);
  assert.equal(pausedAgain.pupilRadius, paused.pupilRadius);
  assert.equal(pausedAgain.blink, paused.blink);
  assert.equal(paused.targetGazeX, -0.9);
  assert.equal(paused.luminance, 1);

  const reset = dynamics.reset();
  const fresh = createEyeDynamics().snapshot();
  assert.deepEqual(reset, fresh);
  assert.equal(reset.paused, false);
  assert.equal(reset.biologyTime, 0);
  assert.equal(reset.pupilRadius, DEFAULT_PUPIL_RADIUS_MM);
  assert.equal(reset.blink, 0);
});

test("large and invalid deltas cannot destabilize the controller", () => {
  const dynamics = createEyeDynamics();
  assert.equal(dynamics.update(Infinity).biologyTime, 0);
  assert.equal(dynamics.update(-10).biologyTime, 0);
  const snapshot = dynamics.update(99, { gazeX: 99, gazeY: 99, luminance: -4 });
  closeTo(snapshot.biologyTime, 0.1);
  assert.ok(Math.hypot(snapshot.targetGazeX, snapshot.targetGazeY) <= 1 + 1e-12);
  assert.equal(snapshot.luminance, 0);
  for (const value of Object.values(snapshot)) {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
  }
});
