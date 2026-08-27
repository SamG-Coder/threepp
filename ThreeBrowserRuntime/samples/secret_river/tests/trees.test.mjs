import assert from "node:assert/strict";
import test from "node:test";
import { terrainHeight, WORLD } from "../src/path.mjs";
import { layoutTrees, TREE_SPECIES } from "../src/tree-layout.mjs";

test("the authored forest uses every Hawkesbury species and stays on land", () => {
  const records = layoutTrees(0x51c7e1);
  assert.ok(records.length >= 40, `expected a sparse riverbank grove, got ${records.length}`);
  assert.ok(records.length < 105, `grove should retain authored breathing room, got ${records.length}`);
  const ids = new Set(records.map(record => record.species));
  for (const species of TREE_SPECIES) {
    assert.equal(ids.has(species.id), true, `missing ${species.id}`);
  }
  for (const record of records) {
    assert.equal(Number.isFinite(record.x), true);
    assert.equal(Number.isFinite(record.y), true);
    assert.equal(Number.isFinite(record.z), true);
    assert.ok(record.y > WORLD.waterHeight);
    assert.ok(Math.abs(record.y - terrainHeight(record.x, record.z)) < 0.001);
    assert.ok(record.height > 1);
  }
});

test("trees stand near the path and in the far inland bush", () => {
  const records = layoutTrees(0x51c7e1);
  const near = records.filter(record => record.z >= 16 && record.z <= 50);
  const far = records.filter(record => record.z > 48);
  assert.ok(near.length >= 8, "trees around the path and midground");
  assert.ok(far.length >= 8, "far trees sit inland of the path");
});
