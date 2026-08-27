import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectOpaqueTriangles } from "../src/anime-texture.mjs";
import * as THREE from "three/webgpu";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("anime_texture.comp is a lighting-v1 Ghibli painterly shader without ink outlines", async () => {
  const source = await readFile(join(sampleRoot, "shaders", "anime_texture.comp"), "utf8");
  assert.match(source, /#version 460/);
  assert.match(source, /GL_EXT_ray_query/);
  assert.match(source, /accelerationStructureEXT topLevelScene/);
  assert.match(source, /image2D hdrColor/);
  assert.match(source, /sampler2D sceneDepth/);
  assert.match(source, /inverseViewProjection/);
  assert.match(source, /ghibliSky/);
  assert.match(source, /ghibliSea/);
  assert.match(source, /ghibliLeaf/);
  assert.match(source, /ghibliBark/);
  assert.match(source, /ghibliGrass/);
  assert.match(source, /poster4/);
  assert.match(source, /posterLeaf/);
  assert.match(source, /voronoi/);
  assert.match(source, /cameraSmoothNormal/);
  assert.match(source, /occluded/);
  assert.match(source, /kLeafSun/);
  assert.match(source, /classifier only/);
  assert.match(source, /classifyLeafFromPhoto/);
  assert.match(source, /channelMax/);
  assert.match(source, /classified\.g >= channelMax/);
  assert.doesNotMatch(source, /outerCameraSilhouette/);
  assert.doesNotMatch(source, /inkEdge/);
  assert.doesNotMatch(source, /vec3\(0\.08, 0\.07, 0\.06\)/);
  assert.doesNotMatch(source, /mix\([^;]*source\.rgb/);
  assert.doesNotMatch(source, /painted\s*\*=\s*source/);
  assert.doesNotMatch(source, /ghibliLeaf\([^)]*source/);
  assert.doesNotMatch(source, /ghibliBark\([^)]*source/);
});

test("collectOpaqueTriangles packs a world-space grove mesh", () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshBasicMaterial({ color: 0x448822 }),
  );
  mesh.position.set(2, 1, 0);
  scene.add(mesh);
  const packed = collectOpaqueTriangles(scene);
  assert.equal(packed.triangleCount, 12);
  assert.equal(packed.vertexCount, 24);
  assert.equal(packed.positions.length, packed.vertexCount * 3);
  assert.equal(packed.indices.length, packed.triangleCount * 3);
  let maxX = -Infinity;
  for (let i = 0; i < packed.positions.length; i += 3) {
    maxX = Math.max(maxX, packed.positions[i]);
  }
  assert.ok(maxX > 2, "world matrices must be applied");
});
