import assert from "node:assert/strict";
import test from "node:test";
import {
  EYE_HEIGHT,
  GRAVITY,
  JUMP_SPEED,
  MAX_WADE_DEPTH,
  applyLook,
  createViewState,
  planarDelta,
  stepFirstPerson,
  wadeFactor,
} from "../src/first-person.mjs";
import { HEIGHT_BOUNDS, WATER_LEVEL, terrainHeight } from "../src/terrain.mjs";

test("look stays clamped and default yaw walks toward the ocean", () => {
  const state = createViewState(0, -18, Math.PI, 0);
  const before = state.yaw;
  applyLook(state, 40, 0);
  assert.ok(state.yaw < before, "mouse right decreases yaw to match camera right");
  applyLook(state, 0, -4000);
  assert.ok(state.pitch <= 1.22);
  applyLook(state, 0, 8000);
  assert.ok(state.pitch >= -1.38);
  const step = planarDelta(Math.PI, 0, 1);
  assert.ok(Math.abs(step.x) < 1e-9);
  assert.ok(step.z > 0.99);
});

test("A strafes camera-left and D strafes camera-right when facing the ocean", () => {
  const left = createViewState(0, -18, Math.PI, 0);
  stepFirstPerson(left, {
    forward: 0, back: 0, left: 1, right: 0, sprint: false, lookX: 0, lookY: 0,
  }, terrainHeight, WATER_LEVEL, 0.25);
  assert.ok(left.x > 0, "A moves with the camera left axis");
  const right = createViewState(0, -18, Math.PI, 0);
  stepFirstPerson(right, {
    forward: 0, back: 0, left: 0, right: 1, sprint: false, lookX: 0, lookY: 0,
  }, terrainHeight, WATER_LEVEL, 0.25);
  assert.ok(right.x < 0, "D moves with the camera right axis");
});

test("walking follows the sand and keeps the camera at eye height", () => {
  const state = createViewState(0, -18, Math.PI, 0);
  stepFirstPerson(state, {
    forward: 1, back: 0, left: 0, right: 0, sprint: false, lookX: 0, lookY: 0,
  }, terrainHeight, WATER_LEVEL, 0.25);
  assert.ok(state.z > -18);
  assert.equal(state.y, terrainHeight(state.x, state.z) + EYE_HEIGHT);
  assert.equal(state.wading, false);
});

test("deep water blocks the stride instead of swimming", () => {
  const deepZ = 40;
  assert.ok(WATER_LEVEL - terrainHeight(0, deepZ) > MAX_WADE_DEPTH);
  const state = createViewState(0, deepZ, 0, 0);
  const startX = state.x;
  stepFirstPerson(state, {
    forward: 1, back: 0, left: 0, right: 0, sprint: true, lookX: 0, lookY: 0,
  }, terrainHeight, WATER_LEVEL, 0.25);
  assert.equal(state.x, startX);
  assert.equal(state.speed, 0);
  assert.ok(wadeFactor(MAX_WADE_DEPTH) === 0);
});

test("Space launches a grounded player and gravity returns them to the beach", () => {
  const state = createViewState(0, -18, Math.PI, 0);
  const input = {
    forward: 0, back: 0, left: 0, right: 0,
    sprint: false, jump: true, lookX: 0, lookY: 0,
  };
  stepFirstPerson(state, input, terrainHeight, WATER_LEVEL, 0.016);
  assert.equal(state.grounded, false);
  assert.ok(state.verticalVelocity > 0 && state.verticalVelocity < JUMP_SPEED);
  const launchHeight = state.y;
  let landingImpact = 0;
  input.jump = false;
  for (let i = 0; i < 180; i += 1) {
    stepFirstPerson(state, input, terrainHeight, WATER_LEVEL, 1 / 60);
    landingImpact = Math.max(landingImpact, state.landingImpact);
  }
  assert.equal(state.grounded, true);
  assert.equal(state.verticalVelocity, 0);
  assert.equal(state.y, terrainHeight(state.x, state.z) + EYE_HEIGHT);
  assert.ok(GRAVITY > JUMP_SPEED);
  assert.ok(launchHeight > terrainHeight(0, -18) + EYE_HEIGHT);
  assert.ok(landingImpact > 4, "landing exposes the downward impact speed");
});

test("movement delegates to the solid collision world and preserves sliding", () => {
  const state = createViewState(0, -18, Math.PI, 0);
  const collisionWorld = {
    resolveMovement(fromX, fromZ, toX, toZ) {
      return { x: fromX, z: toZ };
    },
  };
  stepFirstPerson(state, {
    forward: 1, back: 0, left: 1, right: 0,
    sprint: false, jump: false, lookX: 0, lookY: 0,
  }, terrainHeight, WATER_LEVEL, 0.05, collisionWorld);
  assert.equal(state.x, 0, "blocked axis remains fixed");
  assert.ok(state.z > -18, "unblocked axis still slides");
});

test("shore is shallower than the packed height span and ocean is deeper", () => {
  const shore = terrainHeight(0, 2);
  const ocean = terrainHeight(0, 40);
  const encode = value => (value - HEIGHT_BOUNDS.minHeight) / HEIGHT_BOUNDS.heightSpan;
  assert.ok(encode(shore) > 0 && encode(shore) < 1);
  assert.ok(encode(ocean) > 0 && encode(ocean) < 1);
  assert.ok(WATER_LEVEL - ocean > 1.2);
  assert.ok(WATER_LEVEL - shore < 0.5);
});
