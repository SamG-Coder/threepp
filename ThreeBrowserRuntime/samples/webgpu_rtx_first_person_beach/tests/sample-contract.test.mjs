import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TILE_SPECS } from "../src/tile-relief.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = relative => readFile(path.join(root, relative), "utf8");

test("manifest registers a portable WebGPU first-person beach", async () => {
  const [entry, html, manifestText] = await Promise.all([
    load("site-entry.mjs"),
    load("index.html"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(entry, /globalThis\.__threeBrowserSourceURL/);
  assert.match(entry, /webgpu-rtx-first-person-beach\.runtime\.threebrowser\.local/);
  assert.match(html, /RTX First-Person Beach/);
  assert.match(html, /"three\/webgpu"/);
  assert.equal(manifest.requiresWebGPU, true);
  assert.deepEqual(manifest.compatibility.rendererCandidates, ["webgpu"]);
  assert.equal(manifest.compatibility.canvasOnly, true);
  assert.equal(manifest.compatibility.htmlOverlay, false);
  assert.equal(manifest.compatibility.domRequired, false);
  for (const file of [
    "index.html",
    "site-entry.mjs",
    "src/main.mjs",
    "src/palm-model.mjs",
    "src/foam-field.mjs",
    "src/weather.mjs",
    "src/surface-water.mjs",
    "src/sky-cycle.mjs",
    "src/tile-relief.mjs",
    "src/native-rtx-renderer.mjs",
    "assets/models/realistic-beach-palm.glb",
    "assets/source/palm-leaf.png",
    "assets/textures/palm-leaf-albedo.png",
    "assets/textures/palm-leaf-height.png",
    "assets/textures/palm-leaf-normal.png",
    "assets/textures/dry-sand-albedo.png",
    "assets/textures/dry-sand-height.png",
    "assets/textures/dry-sand-normal.png",
    "assets/textures/lunar-surface-albedo.png",
    "assets/textures/lunar-surface-height.png",
    "assets/textures/lunar-surface-normal.png",
  ]) {
    assert.ok(manifest.files.some(entry => entry.path === file), `${file} missing from manifest`);
    assert.ok((await stat(path.join(root, file))).isFile());
  }
});

test("main wires first-person controls and hybrid RTX lighting without HTML overlay", async () => {
  const [main, html] = await Promise.all([load("src/main.mjs"), load("index.html")]);
  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /stepFirstPerson/);
  assert.match(main, /pointermove/);
  assert.match(main, /requestPointerLock/);
  assert.match(main, /NativeRtxRenderer/);
  assert.match(main, /evaluateRayLighting/);
  assert.match(main, /collectStaticBeachScene/);
  assert.match(main, /loadAllTileMaps/);
  assert.match(main, /foamField\?\.update/);
  assert.match(main, /createBeachWeather/);
  assert.match(main, /weather\.update/);
  assert.match(main, /\.present\(/);
  assert.match(main, /renderRaster\(/);
  assert.doesNotMatch(main, /OrbitControls|PointerLockControls|FlyControls/);
  assert.doesNotMatch(main, /document\.createElement\(\s*["'](?:div|aside|section|button|input|output)["']\s*\)/);
  assert.doesNotMatch(main, /innerHTML/);
  assert.doesNotMatch(html, /<(?:div|aside|section|header|footer|button|input)\b/i);
  assert.ok((main.match(/\.present\(/g) ?? []).length >= 1);
});

test("volumetric clouds drive rain from the same world-space storm field", async () => {
  const weather = await load("src/weather.mjs");
  assert.match(weather, /const CLOUD_BASE = 140/);
  assert.match(weather, /const CLOUD_TOP = 260/);
  assert.match(weather, /RaymarchingBox\(32/);
  assert.match(weather, /new THREE\.NodeMaterial/);
  assert.match(weather, /material\.colorNode = cloudRaymarch\(\)/);
  assert.match(weather, /new THREE\.BoxGeometry\(1, 1, 1\)/);
  assert.match(weather, /volume\.scale\.set\(760, CLOUD_SPAN_Y, 760\)/);
  assert.match(weather, /cloudFieldNode\(point\)/);
  assert.match(weather, /cloudDensityNode\(point\.add\(cloudKeyDirection\.mul\(16\)\)\)/);
  assert.match(weather, /lightTransmission/);
  assert.match(weather, /silverLining/);
  assert.match(weather, /cloudCellDensity\(x, z, seconds\)/);
  assert.match(weather, /rainPotentialAt\(x, z, elapsed/);
  assert.match(weather, /CLOUD_BASE \+ 2 \+ random\(\) \* 18/);
  assert.match(weather, /world\.sun\.intensity \*=/);
  assert.match(weather, /scene\.fog\.density/);
});

test("rain impacts accumulate, run downhill, and react by surface type", async () => {
  const [weather, surfaceWater] = await Promise.all([
    load("src/weather.mjs"),
    load("src/surface-water.mjs"),
  ]);
  assert.match(weather, /createSurfaceWaterSystem/);
  assert.match(weather, /kind: overWater \? "water" : "terrain"/);
  assert.match(weather, /findObjectImpact/);
  assert.match(surfaceWater, /Rain accumulation and downhill runoff/);
  assert.match(surfaceWater, /lowestHead/);
  assert.match(surfaceWater, /transfer/);
  assert.match(surfaceWater, /rainWetnessTexture/);
  assert.match(surfaceWater, /Rain impact water ripples/);
  assert.match(surfaceWater, /Rain impact splash droplets/);
  assert.match(surfaceWater, /Rain beads on wet surfaces/);
});

test("beach water keeps its Gerstner mesh and advects persistent foam", async () => {
  const [scene, materials, foamField, main] = await Promise.all([
    load("src/scene.mjs"),
    load("src/materials.mjs"),
    load("src/foam-field.mjs"),
    load("src/main.mjs"),
  ]);
  assert.match(scene, /PlaneGeometry\(320, 280, 180, 140\)/);
  assert.match(scene, /HEIGHT_BOUNDS/);
  assert.match(scene, /createBeachFoamField/);
  assert.match(scene, /breakingInjectionNode/);
  assert.match(scene, /foamVelocityNode/);
  assert.match(scene, /preRollFoam/);
  assert.match(materials, /foldingStrain/);
  assert.match(materials, /foamLaceNode/);
  assert.match(materials, /foamSourceFromWaves/);
  assert.match(materials, /createWaterMaterial\(heightMap, persistentFoamSample/);
  assert.match(materials, /transformDirection\(cameraViewMatrix\)/);
  assert.match(materials, /dot\(normalWorld, normalize\(toSun\.add\(viewDir\)\)\)/);
  assert.doesNotMatch(materials, /dot\(shadedNormalView, normalize\(toSunView/);
  assert.match(foamField, /sampleVelocity/);
  assert.match(foamField, /resetParcel/);
  assert.match(main, /buildBeachScene\(scene, maps, renderer\)/);
  assert.match(main, /createSkyClock/);
  assert.match(main, /syncSkyUniforms/);
  assert.doesNotMatch(scene, /new THREE\.Water|OceanGeometry|WaterMesh/);
});

test("Studio-authored palms load as reusable GLB instances", async () => {
  const [scene, palm, materials, html] = await Promise.all([
    load("src/scene.mjs"),
    load("src/palm-model.mjs"),
    load("src/materials.mjs"),
    load("index.html"),
  ]);
  assert.match(scene, /GLTFLoader/);
  assert.match(scene, /realistic-beach-palm\.glb/);
  assert.match(scene, /template\.clone\(true\)/);
  assert.match(scene, /prepareStudioPalm/);
  assert.match(palm, /studioMaterialId/);
  assert.match(palm, /createCylindricalTrunkUvs/);
  assert.match(palm, /generatedPalmUv = "cylindrical-z-seam-safe"/);
  assert.match(palm, /material\.transparent = false/);
  assert.match(palm, /material\.depthWrite = true/);
  assert.match(palm, /maps\[profile\.tile\]/);
  assert.match(materials, /uv\(\)\.mul\(vec2\(uvScale\[0\], uvScale\[1\]\)\)/);
  assert.match(html, /"three": "\.\.\/\.\.\/node_modules\/three\/build\/three\.webgpu\.js"/);
});

test("every tile that needs relief ships albedo, height and normal maps", async () => {
  for (const name of Object.keys(TILE_SPECS)) {
    for (const suffix of ["albedo", "height", "normal"]) {
      const file = path.join(root, "assets", "textures", `${name}-${suffix}.png`);
      assert.ok((await stat(file)).isFile(), file);
    }
  }
});
