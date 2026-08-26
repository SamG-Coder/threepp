import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";

import { createJellyDynamicRayMesh } from "../src/jelly-rtx-mesh.mjs";

test("dynamic jelly RTX mesh shares exact transformed render vertices", () => {
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.position.set(2.5, 1.25, -3);
  root.scale.set(1.2, 0.8, 1.1);
  root.add(mesh);
  root.updateWorldMatrix(true, true);

  const dynamic = createJellyDynamicRayMesh([{ mesh }]);
  const descriptor = dynamic.descriptor;
  assert.equal(descriptor.vertexCount, geometry.getAttribute("position").count);
  assert.equal(descriptor.indices.length, geometry.getIndex().count);
  assert.ok(descriptor.width * descriptor.height >= descriptor.vertexCount);
  assert.equal(mesh.userData.rtxIgnore, true);

  const source = new THREE.Vector3().fromBufferAttribute(
    geometry.getAttribute("position"),
    0,
  ).applyMatrix4(mesh.matrixWorld);
  assert.ok(Math.abs(descriptor.positions[0] - source.x) < 1e-6);
  assert.ok(Math.abs(descriptor.positions[1] - source.y) < 1e-6);
  assert.ok(Math.abs(descriptor.positions[2] - source.z) < 1e-6);
  assert.equal(descriptor.positions[3], 1);

  root.position.x += 4;
  dynamic.update();
  assert.ok(Math.abs(descriptor.positions[0] - (source.x + 4)) < 1e-5);
  assert.equal(dynamic.stats().triangleCount, descriptor.indices.length / 3);

  geometry.dispose();
  mesh.material.dispose();
});
