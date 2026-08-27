import assert from "node:assert/strict";
import test from "node:test";
import {
  gaitFrameFromDistance,
  integrateDampedAxis,
} from "../src/motion.mjs";

function integrate(parts, target = 2.3, response = 13.5) {
  let velocity = 0;
  let position = 0;
  for (const delta of parts) {
    const step = integrateDampedAxis(velocity, target, delta, response);
    velocity = step.velocity;
    position += step.distance;
  }
  return { velocity, position };
}

test("analytic locomotion is invariant to frame partitioning", () => {
  const once = integrate([1]);
  const sixty = integrate(Array.from({ length: 60 }, () => 1 / 60));
  assert.ok(Math.abs(once.velocity - sixty.velocity) < 1e-10);
  assert.ok(Math.abs(once.position - sixty.position) < 1e-10);
});

test("gait phase follows travelled metres and wraps without a long seam", () => {
  const count = 23;
  const stride = 1.42;
  assert.equal(gaitFrameFromDistance(0, count, stride), 0);
  assert.equal(gaitFrameFromDistance(stride * 0.5, count, stride), Math.floor(count * 0.5));
  assert.equal(gaitFrameFromDistance(stride, count, stride), 0);
  assert.equal(gaitFrameFromDistance(stride * 2.25, count, stride), Math.floor(count * 0.25));
});
