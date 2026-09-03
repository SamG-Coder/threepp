import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceStride,
  classifyBeachSurface,
  createStrideTracker,
  footprintFacing,
} from "../src/footstep-logic.mjs";

test("surface classification prioritises props, water depth, and accumulated wetness", () => {
  const base = { groundHeight: 1, waterLevel: 0.16, wetness: 0 };
  assert.equal(classifyBeachSurface(base), "dry-sand");
  assert.equal(classifyBeachSurface({ ...base, wetness: 0.5 }), "wet-sand");
  assert.equal(classifyBeachSurface({ groundHeight: 0.12, waterLevel: 0.16 }), "wet-sand");
  assert.equal(classifyBeachSurface({ groundHeight: 0.02, waterLevel: 0.16 }), "shallow-water");
  assert.equal(classifyBeachSurface({ ...base, objectKind: "rock" }), "rock");
  assert.equal(classifyBeachSurface({ ...base, objectKind: "wood" }), "wood");
});

test("stride tracker alternates feet based on actual travelled distance", () => {
  const tracker = createStrideTracker(0, 0);
  assert.equal(advanceStride(tracker, 0, 0.2, 3.25), null);
  const left = advanceStride(tracker, 0, 0.4, 3.25);
  assert.equal(left.leftFoot, true);
  assert.ok(left.directionZ > 0.99);
  assert.equal(advanceStride(tracker, 0, 0.8, 3.25), null);
  const right = advanceStride(tracker, 0, 1.2, 3.25);
  assert.equal(right.leftFoot, false);
});

test("teleports and stationary frames do not emit footfalls", () => {
  const tracker = createStrideTracker(0, 0);
  assert.equal(advanceStride(tracker, 8, 8, 3.25), null);
  assert.equal(advanceStride(tracker, 8, 8, 0), null);
});

test("stride travel can be sideways while the footprint follows player facing", () => {
  const tracker = createStrideTracker(0, 0);
  const step = advanceStride(tracker, 0.4, 0, 3.25);
  assert.ok(step.directionX > 0.99);
  assert.ok(Math.abs(step.directionZ) < 1e-6);
  const facing = footprintFacing(0);
  assert.ok(Math.abs(facing.directionX) < 1e-6);
  assert.ok(facing.directionZ < -0.99);
});
