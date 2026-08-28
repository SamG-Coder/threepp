import assert from "node:assert/strict";
import test from "node:test";
import { floraRecordsFor } from "../src/flora.mjs";
import { DEFAULT_FLORA_SEED, layoutFlora } from "../src/flora-layout.mjs";
import {
  createMappedDressing,
  DRESSING_PROFILES,
} from "../src/game/mapped-dressing.mjs";
import { treeRecordsFor } from "../src/trees.mjs";
import { DEFAULT_LAYOUT_SEED, layoutTrees } from "../src/tree-layout.mjs";

function createTestMap() {
  const shoreZ = x => 2 + Math.sin(x / 8) * 4;
  return {
    bounds: { minX: -48, maxX: 48, minZ: -24, maxZ: 54 },
    isWater(x, z) {
      return z < shoreZ(x);
    },
    heightAt(x, z) {
      return this.isWater(x, z) ? -0.18 : 0.4 + (z - shoreZ(x)) * 0.01;
    },
    distanceToWater(x, z) {
      // Standard GIS distance-to-polygon convention: all points inside the
      // water polygon return zero. mapped-dressing must still find the bank.
      return Math.max(0, z - shoreZ(x));
    },
  };
}

function count(records, key, values) {
  const accepted = new Set(values);
  return records.filter(record => accepted.has(record[key])).length;
}

test("Demo tree and flora defaults remain their authored layouts", () => {
  assert.deepEqual(treeRecordsFor(), layoutTrees(DEFAULT_LAYOUT_SEED));
  assert.deepEqual(floraRecordsFor(), layoutFlora(DEFAULT_FLORA_SEED));

  const trees = [{ id: "mapped-tree" }];
  const flora = [{ id: "mapped-flora" }];
  assert.equal(treeRecordsFor(123, trees), trees);
  assert.equal(treeRecordsFor({ seed: 123, records: trees }), trees);
  assert.equal(floraRecordsFor(456, flora), flora);
  assert.equal(floraRecordsFor({ seed: 456, records: flora }), flora);
});

test("mapped placement rejects water for trees and ground flora", () => {
  const map = createTestMap();
  for (const locationId of ["wisemans-ferry-broad-reach", "macdonald-river-first-branch"]) {
    const dressing = createMappedDressing(map, { locationId });
    assert.ok(dressing.trees.length >= 70);
    assert.equal(dressing.trees.some(record => map.isWater(record.x, record.z)), false);
    assert.equal(
      dressing.flora.some(record => record.kind !== "reeds" && map.isWater(record.x, record.z)),
      false,
    );
    assert.equal(dressing.flora.some(record => record.kind === "rock"), false);
  }
});

test("mapped reeds straddle and closely follow the actual curved shoreline", () => {
  const map = createTestMap();
  const broad = createMappedDressing(map, { locationId: "wisemans-ferry-broad-reach" });
  const reeds = broad.flora.filter(record => record.kind === "reeds");
  assert.ok(reeds.length >= 50);
  assert.ok(reeds.some(record => record.wet && map.isWater(record.x, record.z)));
  assert.ok(reeds.some(record => !record.wet && !map.isWater(record.x, record.z)));
  assert.ok(reeds.every(record => record.shoreDistance <= DRESSING_PROFILES.BROAD_REACH.reedBand));
});

test("Broad Reach and First Branch use deterministic but distinct ecologies", () => {
  const map = createTestMap();
  const broad = createMappedDressing(map, { locationId: "wisemans-ferry-broad-reach" });
  const broadAgain = createMappedDressing(map, { locationId: "wisemans-ferry-broad-reach" });
  const branch = createMappedDressing(map, { locationId: "macdonald-river-first-branch" });

  assert.deepEqual(broad, broadAgain);
  assert.notDeepEqual(broad.seeds, branch.seeds);
  assert.notDeepEqual(broad.trees, branch.trees);
  assert.equal(broad.profile, "broad-reach");
  assert.equal(branch.profile, "first-branch");

  const broadOpenForest = count(
    broad.trees,
    "species",
    ["river-red-gum", "scribbly-gum", "angophora"],
  );
  const broadEnclosedForest = count(
    broad.trees,
    "species",
    ["paperbark", "casuarina", "tea-tree"],
  );
  const branchOpenForest = count(
    branch.trees,
    "species",
    ["river-red-gum", "scribbly-gum", "angophora"],
  );
  const branchEnclosedForest = count(
    branch.trees,
    "species",
    ["paperbark", "casuarina", "tea-tree"],
  );
  assert.ok(broadOpenForest > broadEnclosedForest);
  assert.ok(branchEnclosedForest > branchOpenForest);

  const broadFerns = count(broad.flora, "kind", ["fern"]);
  const branchFerns = count(branch.flora, "kind", ["fern"]);
  assert.ok(branchFerns > broadFerns * 4);
});

test("explicit mapped seeds produce stable alternate placement", () => {
  const map = createTestMap();
  const a = createMappedDressing(map, {
    locationId: "wisemans-ferry-broad-reach",
    treeSeed: 101,
    floraSeed: 202,
  });
  const b = createMappedDressing(map, {
    locationId: "wisemans-ferry-broad-reach",
    treeSeed: 101,
    floraSeed: 202,
  });
  const c = createMappedDressing(map, {
    locationId: "wisemans-ferry-broad-reach",
    treeSeed: 303,
    floraSeed: 404,
  });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.trees, c.trees);
  assert.notDeepEqual(a.flora, c.flora);
});

test("roads have no influence on river-conditioned dressing", () => {
  const map = createTestMap();
  const baseline = createMappedDressing(map, {
    locationId: "macdonald-river-first-branch",
  });
  const roadTrap = {
    ...map,
    distanceToRoad() {
      throw new Error("road data must not be sampled");
    },
  };
  assert.deepEqual(
    createMappedDressing(roadTrap, { locationId: "macdonald-river-first-branch" }),
    baseline,
  );
});
