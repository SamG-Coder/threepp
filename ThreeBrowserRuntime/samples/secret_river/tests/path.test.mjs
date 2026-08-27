import assert from "node:assert/strict";
import test from "node:test";
import {
  clampToBank,
  isWalkable,
  riverEdgeZ,
  roadCenterZ,
  spawnOnRoad,
  terrainHeight,
  WORLD,
} from "../src/path.mjs";

test("terrain height stays finite across the authored bank", () => {
  for (let z = WORLD.minZ; z <= WORLD.maxZ; z += 3.5) {
    for (let x = WORLD.minX; x <= WORLD.maxX; x += 4.25) {
      const height = terrainHeight(x, z);
      assert.equal(Number.isFinite(height), true, `height at ${x},${z}`);
    }
  }
});

test("the dirt road sits on dry ground beside the river", () => {
  for (let x = -60; x <= 60; x += 5) {
    const spawn = spawnOnRoad(x);
    assert.equal(isWalkable(spawn.x, spawn.z), true);
    assert.ok(spawn.y > WORLD.waterHeight + 0.1);
    assert.ok(spawn.z >= riverEdgeZ(x), "the road sits inland of the shore");
    assert.ok(Math.abs(spawn.z - roadCenterZ(x)) < 0.001);
  }
});

test("the river channel is below the water line and is not walkable", () => {
  for (let x = -40; x <= 40; x += 8) {
    const z = riverEdgeZ(x) - 6;
    assert.ok(terrainHeight(x, z) < WORLD.waterHeight);
    assert.equal(isWalkable(x, z), false);
  }
});

test("clampToBank pulls a river step back onto the dirt track", () => {
  const start = spawnOnRoad(4);
  const wet = clampToBank(start.x, riverEdgeZ(start.x) - 6);
  assert.equal(isWalkable(wet.x, wet.z), true);
  assert.ok(wet.z >= riverEdgeZ(wet.x));
});
