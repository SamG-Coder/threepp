import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function glbJson(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

test("Studio rock GLB contains three mapped, non-spherical silhouettes", async () => {
  const bytes = await readFile(join(sampleRoot, "assets", "models", "coastal-rock-set.glb"));
  const json = glbJson(bytes);
  assert.deepEqual(json.meshes.map(mesh => mesh.name), [
    "Wave Worn Slab",
    "Fractured Boulder",
    "Embedded Shore Wedge",
  ]);
  assert.equal(json.meshes.length, 3);

  const dimensions = json.meshes.map(mesh => {
    const primitive = mesh.primitives[0];
    assert.ok(Number.isInteger(primitive.attributes.POSITION));
    assert.ok(Number.isInteger(primitive.attributes.NORMAL));
    assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0));
    const position = json.accessors[primitive.attributes.POSITION];
    return position.max.map((value, axis) => value - position.min[axis]);
  });

  assert.ok(dimensions[0][2] < dimensions[0][0] * 0.5, "slab should be visibly low");
  assert.ok(dimensions[1][2] > dimensions[1][0] * 0.7, "boulder should be visibly tall");
  assert.ok(dimensions[2][0] > dimensions[2][2] * 1.7, "shore wedge should be visibly broad");
});

