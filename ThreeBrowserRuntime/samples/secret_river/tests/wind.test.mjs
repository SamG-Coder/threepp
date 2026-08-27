import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLIAGE_GAIN,
  foliageDisplacementWeight,
  tipSwayWeight,
} from "../src/wind-weights.mjs";

test("pale gum bark and magenta studio pixels do not displace", () => {
  assert.equal(FOLIAGE_GAIN, 4.2);
  assert.ok(foliageDisplacementWeight(0.82, 0.80, 0.72) < 0.08);
  assert.equal(foliageDisplacementWeight(1, 0.05, 0.82), 0);
  assert.equal(foliageDisplacementWeight(0.95, 0.12, 0.9), 0);
});

test("olive eucalyptus leaf samples get a clearly nonzero wind weight", () => {
  const leaf = foliageDisplacementWeight(0.28, 0.52, 0.20);
  assert.ok(leaf > 0.4, `leaf weight ${leaf}`);
  assert.ok(leaf > foliageDisplacementWeight(0.82, 0.80, 0.72) * 8);
});

test("reed and grass sway is rooted at the base and stronger at the tip", () => {
  assert.ok(Math.abs(tipSwayWeight(0)) < 1e-9);
  assert.ok(tipSwayWeight(1) > tipSwayWeight(0.5));
  assert.ok(tipSwayWeight(0.5) > tipSwayWeight(0.1));
  assert.equal(tipSwayWeight(1), 1);
});
