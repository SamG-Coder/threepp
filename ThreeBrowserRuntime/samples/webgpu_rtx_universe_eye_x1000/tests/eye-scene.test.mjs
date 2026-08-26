import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three/webgpu";

import {
  createIrisAnnulusGeometry,
  createUniverseEyeScene,
} from "../src/eye-scene.mjs";
import { collectStaticRtxScene } from "../src/rtx-scene.mjs";
import {
  STROMAL_FIBRE_CHECKSUM,
  STROMAL_FIBRE_COUNT,
  UNIVERSE_EYE_SEED,
} from "../src/universe-eye-model.mjs";

function createFixture(seed = UNIVERSE_EYE_SEED) {
  const scene = new THREE.Scene();
  const irisTexture = new THREE.Texture();
  irisTexture.name = "test universe spiral iris";
  const scleraTexture = new THREE.Texture();
  scleraTexture.name = "test sclera microvascular";
  const eye = createUniverseEyeScene(scene, { irisTexture, scleraTexture, seed });
  return { scene, irisTexture, scleraTexture, eye };
}

test("iris annulus has bounded topology, UVs and a real pupil opening", () => {
  const geometry = createIrisAnnulusGeometry({
    innerRadius: 2,
    outerRadius: 6,
    angularSegments: 32,
    radialSegments: 4,
  });
  try {
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    assert.equal(position.count, 33 * 5);
    assert.equal(uv.count, position.count);
    assert.equal(geometry.getIndex().count, 32 * 4 * 6);
    assert.deepEqual(geometry.userData, {
      angularSegments: 32,
      radialSegments: 4,
      outerRadius: 6,
    });

    assert.ok(Math.abs(Math.hypot(position.getX(0), position.getY(0)) - 2) < 1e-6);
    const outer = 4 * 33;
    assert.ok(Math.abs(Math.hypot(position.getX(outer), position.getY(outer)) - 6) < 1e-6);
    for (let index = 0; index < position.count; ++index) {
      assert.ok(Number.isFinite(position.getX(index) + position.getY(index) + position.getZ(index)));
      assert.ok(uv.getX(index) >= 0 && uv.getX(index) <= 1);
      assert.ok(uv.getY(index) >= 0 && uv.getY(index) <= 1);
    }
  } finally {
    geometry.dispose();
  }
});

test("scene construction requires a THREE.Scene and both decoded albedos", () => {
  const texture = new THREE.Texture();
  assert.throws(
    () => createUniverseEyeScene(new THREE.Group(), {
      irisTexture: texture,
      scleraTexture: texture,
    }),
    /THREE\.Scene/,
  );
  assert.throws(() => createUniverseEyeScene(new THREE.Scene()), /Decoded iris and sclera textures/);
  texture.dispose();
});

test("eye builds one X1000 fibre batch and the complete named anatomy", () => {
  const fixture = createFixture();
  const { eye, scene, irisTexture, scleraTexture } = fixture;
  try {
    assert.ok(Object.isFrozen(eye));
    assert.equal(eye.root.parent, scene);
    assert.equal(eye.root.name, "RTX Universe Eye ×1000 anatomical root");

    const fibres = eye.root.getObjectByName("Exactly 1000 instanced universe stromal fibres");
    assert.ok(fibres?.isInstancedMesh);
    assert.equal(fibres.count, STROMAL_FIBRE_COUNT);
    assert.equal(fibres.instanceMatrix.count, STROMAL_FIBRE_COUNT);
    assert.equal(fibres.material.transparent, true);
    assert.ok(eye.transparentRoots.includes(fibres));

    const iris = eye.root.getObjectByName("Deforming annular universe-spiral iris");
    const sclera = eye.root.getObjectByName("Ivory generated-texture scleral globe");
    const pupil = eye.root.getObjectByName("True black pupil aperture");
    const lashes = eye.root.getObjectByName("128 tapered blink-following eyelashes");
    const caruncle = eye.root.getObjectByName("Inner lacrimal caruncle");
    assert.ok(iris?.isMesh && pupil?.isMesh && sclera?.isMesh && caruncle?.isMesh);
    assert.ok(lashes?.isInstancedMesh);
    assert.equal(lashes.count, 128);
    assert.equal(iris.material.map, irisTexture);
    assert.equal(sclera.material.map, scleraTexture);

    assert.equal(irisTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(scleraTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(irisTexture.anisotropy, 16);
    assert.equal(scleraTexture.anisotropy, 16);
    assert.equal(irisTexture.generateMipmaps, true);
    assert.equal(scleraTexture.generateMipmaps, true);

    const stats = eye.stats();
    assert.ok(Object.isFrozen(stats));
    assert.equal(stats.seed, UNIVERSE_EYE_SEED);
    assert.equal(stats.seedHex, "0x0E1E1000");
    assert.equal(stats.stromalFibres, 1000);
    assert.equal(stats.stromalChecksum, STROMAL_FIBRE_CHECKSUM);
    assert.equal(stats.eyelashes, 128);
    assert.equal(stats.cornealIor, 1.376);
    assert.equal(stats.generatedTextures, 2);
  } finally {
    eye.dispose();
  }
});

test("transparent optics stay out of the opaque native RTX boundary", async () => {
  const fixture = createFixture();
  const { eye } = fixture;
  try {
    assert.ok(Object.isFrozen(eye.opaqueRoots));
    assert.ok(Object.isFrozen(eye.transparentRoots));
    assert.deepEqual(
      eye.opaqueRoots.map(object => object.name),
      ["Ivory generated-texture scleral globe", "Inner lacrimal caruncle"],
    );
    assert.deepEqual(
      eye.transparentRoots.map(object => object.name),
      [
        "Aspheric 1.376 IOR corneal dome and tear film",
        "Recessed crystalline lens",
        "Upper moist lid margin",
        "Lower tear meniscus",
        "Exactly 1000 instanced universe stromal fibres",
      ],
    );

    const cornea = eye.root.getObjectByName("Aspheric 1.376 IOR corneal dome and tear film");
    const tear = eye.root.getObjectByName("Lower tear meniscus");
    assert.equal(cornea.userData.rtxIgnore, true);
    assert.equal(cornea.material.transparent, true);
    assert.equal(cornea.material.transmission, 0.985);
    assert.equal(cornea.material.ior, 1.376);
    assert.equal(cornea.material.depthWrite, false);
    assert.equal(tear.userData.rtxIgnore, true);

    for (const root of eye.opaqueRoots) {
      assert.equal(root.userData.rtxIgnore, undefined);
      assert.notEqual(root.material?.transparent, true);
      assert.ok(!eye.transparentRoots.includes(root));
    }
    for (const root of eye.transparentRoots) {
      assert.ok(
        root.userData.rtxIgnore === true || root.material?.transparent === true ||
          root.material?.transmission > 0.005,
        `${root.name} can leak into the opaque collector`,
      );
    }

    const staticScene = await collectStaticRtxScene(eye.opaqueRoots, {
      maxTriangles: 64,
      lights: eye.lights,
      timeBudgetMs: 1000,
    });
    assert.equal(staticScene.triangleCount, 64);
    assert.equal(staticScene.truncated, true);
    assert.equal(staticScene.skipped.transparent, 0);
    assert.ok(staticScene.sourceMeshCount >= 1);
    await assert.rejects(
      collectStaticRtxScene(eye.transparentRoots, { maxTriangles: 64, timeBudgetMs: 1000 }),
      /no opaque static RTX triangles/,
    );
  } finally {
    eye.dispose();
  }
});

test("blink, pause, studio rigs and reset remain bounded and deterministic", () => {
  const fixture = createFixture();
  const { eye } = fixture;
  try {
    assert.equal(eye.stats().studioRig, 0);
    assert.deepEqual(eye.setStudioRig(1), { index: 1, name: "CLINICAL RING" });
    assert.equal(eye.stats().studioRig, 1);
    assert.deepEqual(eye.setStudioRig(-1), { index: 2, name: "NEBULA SPLIT" });

    const first = eye.update(0.1, { gazeX: 0.6, gazeY: -0.3 });
    assert.ok(first.biologyTime > 0);
    eye.triggerBlink(0.34);
    eye.update(0.1);
    eye.update(0.04);
    assert.ok(eye.stats().blink > 0.95);

    eye.setPaused(true);
    const pausedAt = eye.stats().biologyTime;
    eye.update(0.1, { gazeX: -0.8, gazeY: 0.2 });
    assert.equal(eye.stats().biologyTime, pausedAt);
    eye.update(0.1);
    assert.equal(eye.stats().biologyTime, pausedAt);

    assert.deepEqual(eye.reset(), { index: 0, name: "ARCTIC SOFTBOX" });
    const reset = eye.stats();
    assert.equal(reset.biologyTime, 0);
    assert.equal(reset.blink, 0);
    assert.equal(reset.studioRig, 0);
    assert.equal(reset.pupilRadiusMm, 2.18);
  } finally {
    eye.dispose();
  }
});

test("dispose detaches anatomy and releases both injected textures", () => {
  const fixture = createFixture();
  const { eye, scene, irisTexture, scleraTexture } = fixture;
  let irisDisposed = 0;
  let scleraDisposed = 0;
  irisTexture.addEventListener("dispose", () => ++irisDisposed);
  scleraTexture.addEventListener("dispose", () => ++scleraDisposed);

  eye.dispose();
  assert.equal(eye.root.parent, null);
  assert.ok(!scene.children.includes(eye.root));
  assert.equal(irisDisposed, 1);
  assert.equal(scleraDisposed, 1);
});
