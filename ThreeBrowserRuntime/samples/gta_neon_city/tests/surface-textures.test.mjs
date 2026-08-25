import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import {
  applySurfaceTexture,
  createInteriorTextureSet,
  createSurfaceTextureSet,
  disposeSurfaceTextureSets,
} from "../src/world/surface-textures.mjs";

test("procedural PBR surface textures are deterministic, tiled, and material-ready", () => {
  const first = createSurfaceTextureSet("asphalt", { repeat: [10, 72], normalStrength: 3.1 });
  const second = createSurfaceTextureSet("asphalt", { repeat: [10, 72], normalStrength: 3.1 });
  try {
    assert.equal(first.size, 96);
    assert.equal(first.checksum, second.checksum);
    assert.ok(first.checksum > 0);
    assert.deepEqual([...first.albedo.image.data], [...second.albedo.image.data]);
    assert.equal(first.albedo.colorSpace, THREE.SRGBColorSpace);
    assert.equal(first.normal.colorSpace, THREE.NoColorSpace);
    assert.equal(first.albedo.wrapS, THREE.RepeatWrapping);
    assert.deepEqual(first.albedo.repeat.toArray(), [10, 72]);
    const material = new THREE.MeshStandardNodeMaterial({ color: 0x334455, roughness: 0.6 });
    applySurfaceTexture(material, first, 0.7);
    assert.equal(material.map, first.albedo);
    assert.equal(material.roughnessMap, first.roughness);
    assert.equal(material.normalMap, first.normal);
    assert.deepEqual(material.normalScale.toArray(), [0.7, 0.7]);
    material.dispose();
  } finally {
    disposeSurfaceTextureSets([first, second]);
  }
});

test("virtual interior atlases contain deterministic lit and dark offices on separate depth layers", () => {
  const first = createInteriorTextureSet(0);
  const duplicate = createInteriorTextureSet(0);
  const residential = createInteriorTextureSet(1);
  const studio = createInteriorTextureSet(2);
  try {
    assert.equal(first.kind, "virtual-interior");
    assert.deepEqual(first.size, [256, 64]);
    assert.equal(first.roomCount, 8);
    assert.equal(first.checksum, duplicate.checksum);
    assert.equal(first.layerChecksum, duplicate.layerChecksum);
    assert.deepEqual([...first.albedo.image.data], [...duplicate.albedo.image.data]);
    assert.notEqual(first.checksum, residential.checksum);
    assert.notEqual(residential.checksum, studio.checksum);
    for (const set of [first, residential, studio]) {
      assert.ok(set.litRooms > 0 && set.unlitRooms > 0, set);
      assert.equal(set.litRooms + set.unlitRooms, set.roomCount);
      assert.ok(set.blindRooms > 0 && set.deskRooms > 0, set);
      assert.equal(set.albedo.colorSpace, THREE.SRGBColorSpace);
      assert.equal(set.emissive.colorSpace, THREE.SRGBColorSpace);
      assert.equal(set.foreground.wrapS, THREE.ClampToEdgeWrapping);
      const foregroundAlpha = set.foreground.image.data.filter((_value, index) => index % 4 === 3);
      assert.ok(foregroundAlpha.some(value => value === 0));
      assert.ok(foregroundAlpha.some(value => value > 200));
      const emission = set.emissive.image.data.filter((_value, index) => index % 4 !== 3);
      assert.ok(emission.some(value => value === 0), "unlit rooms need black emission");
      assert.ok(emission.some(value => value > 20), "lit rooms need restrained practical emission");
    }
    assert.ok(first.silhouettes + residential.silhouettes + studio.silhouettes >= 2);
  } finally {
    disposeSurfaceTextureSets([first, duplicate, residential, studio]);
  }
});

test("surface texture factory rejects unknown material profiles", () => {
  assert.throws(() => createSurfaceTextureSet("marshmallow"), /Unknown surface texture kind/);
});

test("brick profile has a dedicated deterministic staggered PBR surface", () => {
  const brick = createSurfaceTextureSet("brick", { repeat: [3, 5], normalStrength: 2.65 });
  const facade = createSurfaceTextureSet("facade", { repeat: [3, 5], normalStrength: 2.65 });
  try {
    assert.equal(brick.kind, "brick");
    assert.notEqual(brick.checksum, facade.checksum);
    assert.deepEqual(brick.albedo.repeat.toArray(), [3, 5]);
    assert.ok(brick.normal.image.data.some((value, index) => index % 4 < 2 && value !== 128));
  } finally {
    disposeSurfaceTextureSets([brick, facade]);
  }
});

test("painted court profile supplies a distinct deterministic micro-surface", () => {
  const court = createSurfaceTextureSet("court", { repeat: [2, 3], normalStrength: 1.65 });
  const asphalt = createSurfaceTextureSet("asphalt", { repeat: [2, 3], normalStrength: 1.65 });
  try {
    assert.equal(court.kind, "court");
    assert.notEqual(court.checksum, asphalt.checksum);
    assert.deepEqual(court.albedo.repeat.toArray(), [2, 3]);
    assert.ok(court.roughness.image.data.some((value, index) => index % 4 === 0 && value > 100));
    assert.ok(court.normal.image.data.some((value, index) => index % 4 < 2 && value !== 128));
  } finally {
    disposeSurfaceTextureSets([court, asphalt]);
  }
});
