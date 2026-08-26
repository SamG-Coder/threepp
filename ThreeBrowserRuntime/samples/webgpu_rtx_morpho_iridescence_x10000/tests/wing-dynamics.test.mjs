import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWingDynamics } from "../src/wing-dynamics.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const STEP = 1 / 60;
const ANGLE_LIMIT = Math.PI;
const ANGLE_KEYS = Object.freeze([
  "leftAngle",
  "rightAngle",
  "leftTwist",
  "rightTwist",
]);

function poseAfter(dynamics, dtSeconds, options) {
  dynamics.update(dtSeconds, options);
  const pose = dynamics.pose();
  assert.ok(pose && typeof pose === "object");
  assert.ok(Object.isFrozen(pose));
  return pose;
}

function assertAnglesFrozen(actual, expected) {
  for (const key of ANGLE_KEYS) {
    assert.equal(actual[key], expected[key], `${key} moved while paused`);
  }
}

function assertAnglesBounded(pose) {
  for (const key of ANGLE_KEYS) {
    const value = pose[key];
    assert.ok(Number.isFinite(value), `${key}=${value} is not finite`);
    assert.ok(
      Math.abs(value) <= ANGLE_LIMIT + 1e-12,
      `${key}=${value} is outside ±${ANGLE_LIMIT}`,
    );
  }
  for (const key of ["thoraxBreath", "abdomenCurl", "antennaPhase", "gazeX", "gazeY", "elapsed"]) {
    assert.ok(Number.isFinite(pose[key]), `${key}=${pose[key]} is not finite`);
  }
}

test("update advances elapsed", () => {
  const dynamics = createWingDynamics();
  const initial = dynamics.pose();
  assert.ok(Object.isFrozen(initial));
  assert.equal(initial.elapsed, 0);

  const once = poseAfter(dynamics, 0.05);
  assert.ok(once.elapsed > initial.elapsed, `elapsed did not advance: ${once.elapsed}`);
  assert.ok(Number.isFinite(once.elapsed));

  const twice = poseAfter(dynamics, 0.05);
  assert.ok(twice.elapsed > once.elapsed, `elapsed did not accumulate: ${twice.elapsed}`);
});

test("setPaused(true) freezes elapsed and angles across further updates", () => {
  const dynamics = createWingDynamics();
  let moving;
  for (let step = 0; step < 8; ++step) moving = poseAfter(dynamics, STEP);
  assert.equal(moving.paused, false);
  assert.ok(moving.elapsed > 0);

  dynamics.setPaused(true);
  const paused = poseAfter(dynamics, STEP);
  const pausedAgain = poseAfter(dynamics, 0.1);

  assert.equal(paused.paused, true);
  assert.equal(paused.elapsed, moving.elapsed);
  assert.equal(pausedAgain.paused, true);
  assert.equal(pausedAgain.elapsed, paused.elapsed);
  assertAnglesFrozen(paused, moving);
  assertAnglesFrozen(pausedAgain, paused);
});

test("triggerFlap changes leftAngle vs idle after several steps", () => {
  const idle = createWingDynamics();
  const flapping = createWingDynamics();
  flapping.triggerFlap();

  let idlePose;
  let flapPose;
  let maxDelta = 0;
  for (let step = 0; step < 12; ++step) {
    idlePose = poseAfter(idle, STEP);
    flapPose = poseAfter(flapping, STEP);
    maxDelta = Math.max(maxDelta, Math.abs(flapPose.leftAngle - idlePose.leftAngle));
  }

  assert.ok(Number.isFinite(idlePose.leftAngle) && Number.isFinite(flapPose.leftAngle));
  assert.notEqual(flapPose.leftAngle, idlePose.leftAngle);
  assert.ok(maxDelta > 0, "triggered flap never diverged from idle leftAngle");
});

test("reset restores", () => {
  const dynamics = createWingDynamics();
  const initial = dynamics.pose();

  dynamics.triggerFlap(1.4);
  for (let step = 0; step < 20; ++step) dynamics.update(STEP);
  dynamics.setPaused(true);
  dynamics.setGaze(0.4, -0.25);
  dynamics.update(STEP);

  const restored = dynamics.reset();
  const afterReset = dynamics.pose();
  const fresh = createWingDynamics().pose();

  assert.deepEqual(afterReset, initial);
  assert.deepEqual(afterReset, fresh);
  if (restored && typeof restored === "object") assert.deepEqual(restored, fresh);
  assert.equal(afterReset.elapsed, 0);
  assert.equal(afterReset.paused, false);
});

test("angles bounded", () => {
  const dynamics = createWingDynamics();
  dynamics.triggerFlap(8);
  dynamics.setGaze(4, -4);

  for (let step = 0; step < 240; ++step) {
    if (step === 90) dynamics.triggerFlap(3);
    assertAnglesBounded(poseAfter(dynamics, STEP));
  }

  assertAnglesBounded(poseAfter(dynamics, 99));
});

test("no Math.random in source", async () => {
  const source = await readFile(join(sampleRoot, "src", "wing-dynamics.mjs"), "utf8");
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /from\s+["']three(?:\/|["'])/);
  assert.doesNotMatch(source, /\b(?:window|document|navigator)\b/);
});
