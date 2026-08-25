import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as THREE from "three/webgpu";

import { MercuryPoolModel } from "../src/mercury-model.mjs";
import { createMercurySurface } from "../src/mercury.mjs";
import {
  NEON_MERCURY_ROOM_DIMENSIONS,
  createNeonMirrorRoom,
} from "../src/room.mjs";
import { collectStaticRtxScene } from "../src/rtx-scene.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

function sourceBlock(source, signature, label) {
  const match = signature.exec(source);
  assert.ok(match, `expected ${label}`);
  const openingBrace = source.indexOf("{", match.index);
  assert.ok(openingBrace >= 0, `expected a body for ${label}`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; ++index) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail(`unterminated body for ${label}`);
}

function insideBox(point, box, epsilon = 1e-9) {
  return point.x >= box.min.x - epsilon && point.x <= box.max.x + epsilon &&
    point.y >= box.min.y - epsilon && point.y <= box.max.y + epsilon &&
    point.z >= box.min.z - epsilon && point.z <= box.max.z + epsilon;
}

function approximately(actual, expected, epsilon = 1e-6, message = undefined) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("manifest enumerates every runtime file and the implementation is MJS-only", async () => {
  const manifest = JSON.parse(await readFile(join(sampleRoot, "threebrowser.pull.json"), "utf8"));
  const sourceModules = (await readdir(join(sampleRoot, "src"), { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => `src/${entry.name}`)
    .sort();
  const expectedRuntimeFiles = [
    "index.html",
    "site-entry.mjs",
    "assets/mercury-sub-bass.wav",
    ...sourceModules,
  ].sort();
  const listed = manifest.files.map(file => file.path);

  assert.equal(manifest.format, 2);
  assert.equal(manifest.requiresWebGPU, true);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.html, "index.html");
  assert.equal(manifest.compatibility?.canvasOnly, true);
  assert.equal(manifest.compatibility?.htmlOverlay, false);
  assert.equal(manifest.compatibility?.domRequired, false);
  assert.equal(new Set(listed).size, listed.length, "manifest paths must be unique");
  assert.deepEqual([...listed].sort(), expectedRuntimeFiles);
  for (const path of listed) await access(join(sampleRoot, ...path.split("/")));

  const requiredModules = [
    "src/main.mjs",
    "src/bass-shocks.mjs",
    "src/mercury-model.mjs",
    "src/mercury.mjs",
    "src/room.mjs",
    "src/rtx-scene.mjs",
    "src/native-rtx-renderer.mjs",
  ];
  for (const path of requiredModules) assert.ok(listed.includes(path), `missing ${path}`);
  assert.ok(sourceModules.every(path => extname(path) === ".mjs"));

  const files = await walk(sampleRoot);
  const forbiddenExtensions = new Set([
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp",
    ".wgsl", ".glsl", ".vert", ".frag", ".comp", ".spv", ".hlsl",
  ]);
  const forbiddenFiles = files
    .map(path => relative(sampleRoot, path).replaceAll("\\", "/"))
    .filter(path => forbiddenExtensions.has(extname(path).toLowerCase()));
  assert.deepEqual(forbiddenFiles, [], "no native or standalone shader source may be added");

  const runtimeModuleSources = await Promise.all(
    listed.filter(path => path.endsWith(".mjs"))
      .map(path => readFile(join(sampleRoot, ...path.split("/")), "utf8")),
  );
  assert.doesNotMatch(
    runtimeModuleSources.join("\n"),
    /["'][^"']+\.(?:c|cc|cpp|cxx|h|hh|hpp|wgsl|glsl|vert|frag|comp|spv|hlsl)["']/i,
    "runtime MJS must not load a native or standalone shader file",
  );
  const entry = await readFile(join(sampleRoot, manifest.entry), "utf8");
  assert.match(entry, /await\s+import\(["']\.\/src\/main\.mjs["']\)/);
  const audio = manifest.files.find(file => file.path === "assets/mercury-sub-bass.wav");
  assert.equal(audio?.type, "audio");
  assert.ok(audio?.bytes > 1_000_000);
});

test("native audio cues drive the real fixed-step mercury without UI or Web Audio", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const bass = await readFile(join(sampleRoot, "src", "bass-shocks.mjs"), "utf8");
  assert.match(main, /createMercuryBassController\s*\(\s*\{\s*model\s*\}\s*\)/);
  assert.match(main, /bassAudio\.poll\(\)/);
  assert.match(main, /bassAudio\.pause\(\)/);
  assert.match(main, /bassAudio\.restart\(\)/);
  assert.match(main, /bassAudio\.dispose\(\)/);
  assert.match(main, /audioTime=/);
  assert.match(main, /shocks=/);
  assert.match(main, /native synthwave transport started/);
  assert.match(bass, /audio\.pollCues\(0\)/);
  assert.match(bass, /model\.disturb\s*\(/);
  assert.doesNotMatch(main + bass, /AudioContext|AnalyserNode|createOscillator|requestAnimationFrame/);
  assert.doesNotMatch(main + bass, /document\.createElement\(\s*["']audio["']/i);
});

test("HTML and main create only the renderer canvas, never HUD or overlay UI", async () => {
  const html = await readFile(join(sampleRoot, "index.html"), "utf8");
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const imports = [...main.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);

  assert.doesNotMatch(
    html,
    /<(?:div|aside|section|header|footer|button|input|output|label|meter|progress|dialog)\b/i,
  );
  assert.equal((html.match(/<canvas\b/gi) ?? []).length, 0, "WebGPURenderer owns the sole canvas");
  assert.equal(
    imports.some(path => /(?:^|[-_/])(?:hud|ui|overlay|gui)(?:[-_.]|$)/i.test(path)),
    false,
  );
  assert.doesNotMatch(
    main,
    /document\.createElement\(\s*["'](?:div|aside|section|header|button|input|output|canvas)["']\s*\)/i,
  );
  assert.doesNotMatch(main, /\b(?:create|render|update)\w*(?:Hud|HUD|Ui|UI|Overlay|Telemetry)\s*\(/);
  assert.equal((main.match(/document\.body\.appendChild\(renderer\.domElement\)/g) ?? []).length, 1);
});

test("room is sealed, human-scale, reflection-rich, and statically lit", async () => {
  const scene = new THREE.Scene();
  const room = createNeonMirrorRoom(scene);
  const model = new MercuryPoolModel({ width: 8, height: 10 });
  const mercury = createMercurySurface({ model, baseY: 0.02 });
  scene.add(mercury.group);
  try {
    const stats = room.getStats();
    assert.ok(stats.mirrorPanels >= 18, stats);
    assert.ok(stats.neonTubes >= 16, stats);
    assert.equal(stats.rtxLights, 8);
    assert.equal(room.lights.length, 8);
    assert.ok(room.lights.every(light => (
      light.isPointLight &&
      light.castShadow === false &&
      light.intensity === light.userData.invariantIntensity &&
      /stable/i.test(light.name)
    )));

    const dimensions = NEON_MERCURY_ROOM_DIMENSIONS;
    assert.ok(dimensions.width >= 4.5 && dimensions.width <= 8);
    assert.ok(dimensions.height >= 2.7 && dimensions.height <= 5);
    assert.ok(dimensions.depth >= 5 && dimensions.depth <= 10);
    approximately(stats.roomWidthMetres, dimensions.width);
    approximately(stats.roomHeightMetres, dimensions.height);
    approximately(stats.roomDepthMetres, dimensions.depth);
    approximately(stats.poolWidthMetres, dimensions.poolWidth);
    approximately(stats.poolDepthMetres, dimensions.poolDepth);
    assert.ok((dimensions.width - dimensions.poolWidth) * 0.5 >= 0.58);
    assert.ok((dimensions.depth - dimensions.poolDepth) * 0.5 >= 0.78);

    const architectureNames = room.architecture.children.map(child => child.name.toLowerCase());
    for (const boundary of [
      "floor slab", "left chamber wall", "right chamber wall",
      "rear chamber wall", "front chamber wall", "chamber ceiling",
    ]) {
      assert.ok(
        architectureNames.some(name => name.includes(boundary)),
        `sealed room requires ${boundary}`,
      );
    }

    const panelMeshes = [];
    room.mirrors.traverse(object => {
      if (object.isMesh && object.material?.metalness === 1 && object.material?.roughness <= 0.025) {
        panelMeshes.push(object);
      }
    });
    assert.equal(panelMeshes.length, stats.mirrorPanels);
    assert.ok(panelMeshes.every(mesh => (
      mesh.material.rtxReflectionMask === 1 &&
      mesh.material.userData.rtxUsesResolvedPbr === 1
    )));
    assert.equal(room.neonCores.children.length, stats.neonTubes);
    assert.ok(room.neonCores.children.every(core => (
      core.isMesh &&
      core.material.transparent !== true &&
      core.material.userData.rtxTriangleRadiance?.some(value => value > 1)
    )));
    assert.equal(room.neonHalos.userData.rtxIgnore, true);
    assert.ok(room.neonHalos.children.every(halo => (
      halo.userData.rtxIgnore === true &&
      halo.material.userData.rtxIgnore === true &&
      halo.material.transparent === true
    )));

    const { bounds } = room;
    approximately(bounds.room.max.x - bounds.room.min.x, dimensions.width);
    approximately(bounds.room.max.z - bounds.room.min.z, dimensions.depth);
    approximately(bounds.pool.max.x - bounds.pool.min.x, dimensions.poolWidth);
    approximately(bounds.pool.max.z - bounds.pool.min.z, dimensions.poolDepth);
    approximately(bounds.pool.surfaceY, dimensions.mercurySurfaceY);
    assert.ok(insideBox(bounds.cameraSafe.min, bounds.room));
    assert.ok(insideBox(bounds.cameraSafe.max, bounds.room));
    assert.ok(insideBox(bounds.cameraHome.position, bounds.cameraSafe));
    assert.ok(insideBox(bounds.cameraHome.target, bounds.room));
    assert.ok(bounds.pool.max.x < bounds.room.max.x && bounds.pool.min.x > bounds.room.min.x);
    assert.ok(bounds.pool.max.z < bounds.room.max.z && bounds.pool.min.z > bounds.room.min.z);

    const staticOnly = await collectStaticRtxScene(room.staticRtxRoots, {
      lights: room.lights,
      maxTriangles: 100_000,
      timeBudgetMs: 50,
    });
    const withDynamicMercury = await collectStaticRtxScene(
      [...room.staticRtxRoots, mercury.group],
      { lights: room.lights, maxTriangles: 100_000, timeBudgetMs: 50 },
    );
    assert.equal(staticOnly.truncated, false);
    assert.ok(staticOnly.triangleCount > 500, "room architecture must enter the static TLAS");
    assert.equal(staticOnly.lightCount, 8);
    assert.ok(staticOnly.triangleRadiance.some(value => value > 1), "neon cores must enter RTX radiance");
    assert.ok(staticOnly.skipped.ignoredOrHidden >= 1, "halo root must be excluded");
    assert.equal(withDynamicMercury.triangleCount, staticOnly.triangleCount);
    assert.equal(withDynamicMercury.sourceMeshCount, staticOnly.sourceMeshCount);
    assert.ok(
      withDynamicMercury.skipped.ignoredOrHidden >= staticOnly.skipped.ignoredOrHidden + 1,
      "dynamic mercury must be excluded from immutable static RTX geometry",
    );
  } finally {
    mercury.dispose();
    room.dispose();
  }
});

test("opaque metallic mercury geometry is a live view of the solver arrays", () => {
  const model = new MercuryPoolModel({
    width: 12,
    height: 14,
    poolWidth: 4.4,
    poolDepth: 5.2,
  });
  const baseY = 0.02;
  const mercury = createMercurySurface({ model, baseY });
  try {
    assert.equal(mercury.material.transparent, false);
    assert.equal(mercury.material.opacity, 1);
    assert.equal(mercury.material.metalness, 1);
    assert.ok(mercury.material.roughness > 0 && mercury.material.roughness <= 0.12);
    assert.equal(mercury.material.rtxReflectionMask, 1);
    assert.equal(mercury.material.rtxUsesResolvedPbr, 1);
    assert.equal(mercury.material.userData.rtxIgnore, true);
    assert.equal(mercury.material.userData.rtxDynamicGuideSurface, true);
    assert.ok(mercury.material.positionNode, "solver positions must remain the material silhouette");
    assert.equal(mercury.group.userData.rtxIgnore, true);
    assert.equal(mercury.surface.userData.rtxIgnore, true);
    assert.ok(mercury.group.children.every(child => child.userData.rtxIgnore === true));
    const rayMesh = mercury.rtxDynamicMesh;
    assert.equal(rayMesh.width, model.width);
    assert.equal(rayMesh.height, model.height);
    assert.equal(rayMesh.vertexCount, model.width * model.height);
    assert.ok(rayMesh.positions instanceof Float32Array);
    assert.equal(rayMesh.positions.length, rayMesh.vertexCount * 4);
    assert.ok(rayMesh.indices instanceof Uint32Array);
    assert.deepEqual(rayMesh.reflectionMaterial.radiance, [0.0072, 0.0026, 0.00028, 1]);
    assert.deepEqual(rayMesh.reflectionMaterial.surface, [0.71, 0.31, 0.022, 0.055]);
    assert.equal(rayMesh.isObject3D, undefined, "secondary-ray geometry cannot enter the camera scene");

    model.disturb(0.35, -0.4, 0.035, 0.75);
    model.setPointer(0.78, -0.42, { weight: 1.3 });
    model.advanceTicks(36);
    assert.equal(mercury.update(model.elapsedSeconds), true);

    const geometry = mercury.surface.geometry;
    const position = geometry.getAttribute("position");
    const agitation = geometry.getAttribute("mercuryAgitation");
    const curvature = geometry.getAttribute("mercuryCurvature");
    const speed = geometry.getAttribute("mercurySpeed");
    assert.equal(position.count, model.surface.length);
    assert.equal(position.count, model.width * model.height);
    assert.equal(agitation.count, model.agitation.length);
    assert.equal(curvature.count, model.curvature.length);
    assert.equal(speed.count, model.velocityX.length);
    assert.equal(geometry.index.count, (model.width - 1) * (model.height - 1) * 6);
    assert.equal(rayMesh.indices, geometry.index.array);
    assert.equal(rayMesh.indices.length / 3, (model.width - 1) * (model.height - 1) * 2);
    assert.ok(rayMesh.positions.every(Number.isFinite));

    for (let index = 0; index < position.count; ++index) {
      const x = index % model.width;
      const z = Math.floor(index / model.width);
      approximately(position.getX(index), model.originX + (x + 0.5) * model.cellSizeX, 2e-6);
      approximately(position.getY(index), baseY + model.surface[index], 2e-6);
      approximately(position.getZ(index), model.originZ + (z + 0.5) * model.cellSizeZ, 2e-6);
      approximately(rayMesh.positions[index * 4], position.getX(index), 1e-8);
      approximately(rayMesh.positions[index * 4 + 1], position.getY(index), 1e-8);
      approximately(rayMesh.positions[index * 4 + 2], position.getZ(index), 1e-8);
      assert.equal(rayMesh.positions[index * 4 + 3], 1);
      approximately(agitation.getX(index), model.agitation[index], 2e-6);
      approximately(
        curvature.getX(index),
        THREE.MathUtils.clamp(model.curvature[index], -1, 1),
        2e-6,
      );
      approximately(
        speed.getX(index),
        Math.hypot(model.velocityX[index], model.velocityZ[index]),
        2e-6,
      );
    }
    assert.equal(mercury.stats().silhouetteSource, "conservative-finite-volume-solver");
  } finally {
    mercury.dispose();
  }
});

test("production mercury exposes one exact connected 88x104 dynamic BLAS topology", () => {
  const model = new MercuryPoolModel();
  const mercury = createMercurySurface({ model, baseY: 0.02 });
  try {
    const rayMesh = mercury.rtxDynamicMesh;
    assert.equal(rayMesh.width, 88);
    assert.equal(rayMesh.height, 104);
    assert.equal(rayMesh.vertexCount, 88 * 104);
    assert.equal(rayMesh.positions.length, 88 * 104 * 4);
    assert.equal(rayMesh.indices.length / 3, 87 * 103 * 2);
    assert.equal(mercury.stats().dynamicRayMesh.exactRasterTopology, true);
    assert.equal("capacity" in rayMesh, false);
    assert.equal("matrices" in rayMesh, false);
    assert.equal("masks" in rayMesh, false);
  } finally {
    mercury.dispose();
  }
});

test("camera is hard-locked and native/raster stages share one presentation", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const cameraUpdate = sourceBlock(
    main,
    /\bfunction\s+updateCamera\s*\([^)]*\)\s*\{/,
    "updateCamera()",
  );

  assert.doesNotMatch(main, /OrbitControls|PointerLockControls|FlyControls|FirstPersonControls/);
  assert.match(cameraUpdate, /MathUtils\.clamp\(state\.pointer\.x\s*\*\s*0\.11,\s*-0\.12,\s*0\.12\)/);
  assert.match(cameraUpdate, /MathUtils\.clamp\(1\.70\s*\+\s*state\.pointer\.y\s*\*\s*0\.055,\s*1\.63,\s*1\.77\)/);
  assert.match(cameraUpdate, /MathUtils\.clamp\(2\.90\s*-\s*Math\.abs\(state\.pointer\.x\)\s*\*\s*0\.025,\s*2\.86,\s*2\.91\)/);
  assert.match(cameraUpdate, /camera\.position\.lerp\(desiredPosition,/);
  assert.match(cameraUpdate, /camera\.lookAt\(state\.cameraTarget\)/);
  assert.doesNotMatch(cameraUpdate, /camera\.position\.(?:add|sub)|camera\.translate|camera\.rotation/);
  assert.doesNotMatch(main, /\b(?:KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown)\b/);

  assert.equal((main.match(/\bnativeRenderer\.renderNative\s*\(/g) ?? []).length, 1);
  assert.equal((main.match(/\bnativeRenderer\.renderRaster\s*\(/g) ?? []).length, 1);
  assert.equal((main.match(/\bnativeRenderer\.present\s*\(/g) ?? []).length, 1);
  assert.match(main, /let\s+staged\s*=\s*false\s*;/);
  assert.match(main, /if\s*\(state\.nativeConfigured\s*&&\s*!state\.forceRaster\)\s*\{/);
  assert.match(main, /if\s*\(!staged\)\s*staged\s*=\s*nativeRenderer\.renderRaster\(scene,\s*camera\)/);
  assert.match(main, /if\s*\(staged\s*&&\s*!nativeRenderer\.present\(\)\)\s*\{/);
  const nativeStage = main.indexOf("nativeRenderer.renderNative");
  const dynamicUpload = main.indexOf("nativeRenderer.updateDynamicTriangleMesh");
  const rasterStage = main.indexOf("nativeRenderer.renderRaster");
  const presentation = main.indexOf("nativeRenderer.present");
  assert.ok(dynamicUpload >= 0 && dynamicUpload < nativeStage);
  assert.ok(nativeStage >= 0 && nativeStage < rasterStage && rasterStage < presentation);
  assert.doesNotMatch(main, /\brenderer\.render\s*\(/, "main cannot bypass the single presenter");
  assert.doesNotMatch(main, /\brenderer\.setRenderTarget\(null\)/);
  assert.doesNotMatch(main, /\brenderer\.clear\s*\(/);
});

test("present binds the default target once and has no clear or direct fallback", async () => {
  const native = await readFile(join(sampleRoot, "src", "native-rtx-renderer.mjs"), "utf8");
  const offscreen = sourceBlock(
    native,
    /\b_renderLinearScene\s*\([^)]*\)\s*\{/,
    "_renderLinearScene()",
  );
  const nativeStage = sourceBlock(
    native,
    /\brenderNative\s*\([^)]*\)\s*\{/,
    "renderNative()",
  );
  const rasterStage = sourceBlock(
    native,
    /\brenderRaster\s*\([^)]*\)\s*\{/,
    "renderRaster()",
  );
  const nativeEffects = sourceBlock(
    native,
    /\b_evaluateNativeEffects\s*\([^)]*\)\s*\{/,
    "_evaluateNativeEffects()",
  );
  const dynamicCreate = sourceBlock(
    native,
    /\b_createDynamicTriangleMesh\s*\([^)]*\)\s*\{/,
    "_createDynamicTriangleMesh()",
  );
  const dynamicDestroy = sourceBlock(
    native,
    /\b_destroyDynamicTriangleMesh\s*\([^)]*\)\s*\{/,
    "_destroyDynamicTriangleMesh()",
  );
  const staticDestroy = sourceBlock(
    native,
    /\b_destroyStaticScene\s*\([^)]*\)\s*\{/,
    "_destroyStaticScene()",
  );
  const present = sourceBlock(native, /\bpresent\s*\(\s*\)\s*\{/, "present()");

  assert.match(offscreen, /setRenderTarget\(target\)[\s\S]*?\.clear\(true,\s*true,\s*true\)[\s\S]*?\.render\(scene,\s*camera\)/);
  assert.equal((present.match(/this\.renderer\.setRenderTarget\(null\)/g) ?? []).length, 1);
  assert.equal((present.match(/this\.renderer\.render\s*\(/g) ?? []).length, 1);
  assert.match(present, /setRenderTarget\(null\)[\s\S]*?autoClear\s*=\s*true[\s\S]*?render\(this\._displayScene,\s*this\._displayCamera\)/);
  assert.doesNotMatch(present, /\.clear\s*\(/, "the default target must not receive a separate clear");
  assert.doesNotMatch(nativeStage, /this\.renderer\.render\s*\(/);
  assert.doesNotMatch(rasterStage, /this\.renderer\.render\s*\(/);
  assert.equal(
    (native.match(/render\(this\._displayScene,\s*this\._displayCamera\)/g) ?? []).length,
    1,
    "only present() may render the display scene to the swapchain",
  );
  assert.match(native, /format:\s*["']rgba32float["']/);
  assert.match(native, /usage:\s*COPY_SRC\s*\|\s*COPY_DST\s*\|\s*STORAGE_BINDING/);
  assert.match(native, /this\.device\.queue\.writeTexture\s*\(/);
  assert.match(native, /this\.rtx\.createDynamicTriangleMesh\s*\(/);
  assert.match(native, /reflectionMaterial:\s*descriptor\.reflectionMaterial/);
  assert.match(native, /this\.rtx\.refitDynamicTriangleMesh\s*\(/);
  assert.match(native, /this\.rtx\?\.destroyDynamicTriangleMesh\?\.\s*\(/);
  assert.ok(
    dynamicCreate.indexOf("_uploadDynamicPositions(false)") <
      dynamicCreate.indexOf("this.rtx.createDynamicTriangleMesh"),
    "initial texture upload must precede the dynamic BLAS build",
  );
  assert.ok(
    dynamicDestroy.indexOf("this.rtx?.destroyDynamicTriangleMesh") <
      dynamicDestroy.indexOf("texture?.destroy"),
    "the BLAS/TLAS handle must be submitted before its borrowed texture is destroyed",
  );
  assert.ok(
    staticDestroy.indexOf("_destroyDynamicTriangleMesh") <
      staticDestroy.indexOf("this.rtx?.destroyStaticScene"),
    "the dynamic mesh must be detached before static-scene destruction",
  );
  const refit = nativeEffects.indexOf("_recordDynamicMeshRefit");
  const lighting = nativeEffects.indexOf("_recordLighting", refit);
  const reflections = nativeEffects.indexOf("_recordReflections", lighting);
  const orderedSubmit = nativeEffects.indexOf("submitBuffers.push(dynamicBuffer)", reflections);
  assert.ok(refit >= 0 && refit < lighting && lighting < reflections && reflections < orderedSubmit);
  assert.doesNotMatch(native, /\bupdateInstanceGroup\s*\(/);
});
