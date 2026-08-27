import assert from "node:assert/strict";
import test from "node:test";
import { layoutFlora, reedEdgeShare } from "../src/flora-layout.mjs";
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
    const share = reedEdgeShare(layoutFlora(seed), 3.5);
    assert.ok(share.reeds >= 24, `seed ${seed} reeds ${share.reeds}`);
    assert.ok(share.share >= 0.45, `seed ${seed} edge share ${share.share}`);
  }
});
