import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three/webgpu";
import { createCylindricalTrunkUvs, orientTrunkOutward } from "../src/palm-model.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function glbJson(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

test("Studio palm GLB preserves material IDs, colors, and opaque alpha", async () => {
  const bytes = await readFile(join(sampleRoot, "assets", "models", "realistic-beach-palm.glb"));
  const json = glbJson(bytes);
  const expectedIds = new Set([
    "material/palm-bark",
    "material/palm-coconut",
    "material/palm-rachis",
    "material/palm-leaf-light",
    "material/palm-leaf",
    "material/palm-dry-leaf",
  ]);
  assert.deepEqual(new Set(json.materials.map(material => material.extras.studioMaterialId)), expectedIds);
  for (const material of json.materials) {
    assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1);
    assert.notDeepEqual(material.pbrMetallicRoughness.baseColorFactor.slice(0, 3), [0.7, 0.7, 0.7]);
  }
  assert.equal(json.nodes.length, 206);
  assert.equal(json.meshes.length, 205);
  assert.equal(json.nodes.some(node => /bark[ _-]?collar/i.test(node.name ?? "")), false);

  const leafNodeCount = json.nodes
    .filter(node => /^f\d[px]\d[lr]( Detail)?$/.test(node.name ?? "")).length;
  assert.equal(leafNodeCount, 192);
});

test("missing trunk UVs become finite, seam-safe cylindrical coordinates", () => {
  const source = new THREE.CylinderGeometry(0.3, 0.45, 8, 12, 5);
  source.rotateX(Math.PI * 0.5);
  source.deleteAttribute("uv");
  const geometry = createCylindricalTrunkUvs(source);
  const uv = geometry.getAttribute("uv");
  assert.ok(uv);
  assert.equal(geometry.index, null);
  assert.equal(uv.count, geometry.getAttribute("position").count);
  assert.equal(geometry.userData.generatedPalmUv, "cylindrical-z-seam-safe");
  for (let triangle = 0; triangle < uv.count; triangle += 3) {
    const values = [uv.getX(triangle), uv.getX(triangle + 1), uv.getX(triangle + 2)];
    assert.ok(values.every(Number.isFinite));
    assert.ok(Math.max(...values) - Math.min(...values) <= 0.5 + 1e-6);
  }
});

test("inside-out trunk winding and normals are corrected before mapping", () => {
  const source = new THREE.CylinderGeometry(0.3, 0.45, 8, 12, 5);
  source.rotateX(Math.PI * 0.5);
  const indices = source.index.array;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const second = indices[offset + 1];
    indices[offset + 1] = indices[offset + 2];
    indices[offset + 2] = second;
  }
  source.computeVertexNormals();
  const corrected = orientTrunkOutward(source);
  assert.equal(corrected.userData.correctedPalmWinding, "outward");
  const position = corrected.getAttribute("position");
  const normal = corrected.getAttribute("normal");
  let score = 0;
  for (let index = 0; index < position.count; index += 1) {
    score += position.getX(index) * normal.getX(index) + position.getY(index) * normal.getY(index);
  }
  assert.ok(score > 0);
});
