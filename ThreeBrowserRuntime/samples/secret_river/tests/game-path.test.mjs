import assert from "node:assert/strict";
import test from "node:test";
import { getLocation } from "../src/game/location-graph.mjs";
import { LOCATION_IDS, LOCATION_REGISTRY } from "../src/game/locations.mjs";
import { runtimePathProfile } from "../src/game/path-profile.mjs";
import {
  isWalkable,
  riverEdgeZ,
  roadCenterZ,
  setPathProfile,
  spawnOnRoad,
  terrainHeight,
} from "../src/path.mjs";

test("map-derived path profiles change Game geography and restore the Demo exactly", () => {
  setPathProfile(null);
  const samples = [-72, -24, 0, 38, 77];
  const demo = samples.map(x => [riverEdgeZ(x), roadCenterZ(x), terrainHeight(x, 20)]);
  const broad = getLocation(LOCATION_REGISTRY, LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH);
  const branch = getLocation(LOCATION_REGISTRY, LOCATION_IDS.MACDONALD_RIVER_FIRST_BRANCH);

  try {
    setPathProfile(runtimePathProfile(broad));
    assert.ok(Math.abs(riverEdgeZ(0) - broad.pathProfile.knots[2].shoreZ) < 0.3);
    assert.equal(roadCenterZ(0), broad.pathProfile.knots[2].roadCenterZ);
    assert.equal(isWalkable(spawnOnRoad(0).x, spawnOnRoad(0).z), true);
    const broadCurve = samples.map(x => riverEdgeZ(x));

    setPathProfile(runtimePathProfile(branch));
    const branchCurve = samples.map(x => riverEdgeZ(x));
    assert.notDeepEqual(branchCurve, broadCurve);
    assert.ok(branchCurve.every(Number.isFinite));
    assert.ok(samples.every(x => roadCenterZ(x) > riverEdgeZ(x)));
  } finally {
    setPathProfile(null);
  }

  const restored = samples.map(x => [riverEdgeZ(x), roadCenterZ(x), terrainHeight(x, 20)]);
  assert.deepEqual(restored, demo);
});
