import assert from "node:assert/strict";
import test from "node:test";
import { layoutFlora, reedEdgeShare, wetReedShare } from "../src/flora-layout.mjs";
import {
  CANOPY_BIN_WIDTH,
  DEFAULT_LAYOUT_SEED,
  inlandCanopyOccupancy,
  layoutTrees,
  longestEmptyRun,
} from "../src/tree-layout.mjs";

test("inland canopy fills most x-bins without a rectangular empty run", () => {
  for (const seed of [DEFAULT_LAYOUT_SEED, 0x9e3779b9]) {
    const records = layoutTrees(seed);
    const { bins, counts, occupied } = inlandCanopyOccupancy(records);
    assert.ok(bins >= 8, `bins ${bins}`);
    assert.ok(occupied / bins >= 0.72, `seed ${seed} occupied ${occupied}/${bins}`);
    assert.ok(
      longestEmptyRun(counts) <= 2,
      `seed ${seed} empty run ${longestEmptyRun(counts)} (bin ${CANOPY_BIN_WIDTH}m)`,
    );
  }
});

test("most reeds sit on the wet river edge", () => {
  for (const seed of [0x51c7e1, 0x9e3779b9]) {
    const records = layoutFlora(seed);
    const near = reedEdgeShare(records, 1.2);
    const wet = wetReedShare(records);
    assert.ok(near.reeds >= 24, `seed ${seed} reeds ${near.reeds}`);
    assert.ok(near.share > 0.5, `seed ${seed} within 1.2m ${near.share}`);
    assert.ok(wet.share > 0.5, `seed ${seed} wet band ${wet.share}`);
  }
});

