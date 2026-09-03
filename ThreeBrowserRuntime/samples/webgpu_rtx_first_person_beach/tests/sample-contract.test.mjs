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
    "src/rock-model.mjs",
    "src/foam-field.mjs",
    "src/weather.mjs",
    "src/surface-water.mjs",
    "src/footstep-logic.mjs",
    "src/footstep-system.mjs",
    "src/collision-system.mjs",
    "src/sky-cycle.mjs",
    "src/tile-relief.mjs",
    "src/native-rtx-renderer.mjs",
    "assets/models/realistic-beach-palm.glb",
    "assets/models/coastal-rock-set.glb",
    "assets/audio/footstep-dry-sand-1.wav",
    "assets/audio/footstep-wet-sand-1.wav",
    "assets/audio/footstep-shallow-water-1.wav",
    "assets/audio/footstep-rock-1.wav",
    "assets/audio/footstep-wood-1.wav",
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
  assert.match(main, /createBeachFootstepSystem/);
  assert.match(main, /createBeachCollisionWorld/);
  assert.match(main, /footsteps\.update\(dt, view\)/);
  assert.match(main, /jump: jumpQueued/);
  assert.match(main, /camera\.lookAt\(0, 6, -38\)/);
  assert.match(main, /rtxRenderer\.render\(scene, camera/);
  assert.match(main, /warmScenePipelines\(\)/);
  assert.match(main, /weather\.update/);
  assert.match(main, /\.present\(/);
  assert.match(main, /renderRaster\(/);
  assert.doesNotMatch(main, /OrbitControls|PointerLockControls|FlyControls/);
  assert.doesNotMatch(main, /document\.createElement\(\s*["'](?:div|aside|section|button|input|output)["']\s*\)/);
  assert.doesNotMatch(main, /innerHTML/);
  assert.doesNotMatch(html, /<(?:div|aside|section|header|footer|button|input)\b/i);
  assert.ok((main.match(/\.present\(/g) ?? []).length >= 1);
});

test("walking has native surface audio and pooled sand impressions", async () => {
  const [main, footsteps, logic, weather] = await Promise.all([
    load("src/main.mjs"),
    load("src/footstep-system.mjs"),
    load("src/footstep-logic.mjs"),
    load("src/weather.mjs"),
  ]);
  assert.match(main, /footsteps\.arm\(\)/);
  assert.match(weather, /surfaceWater,/);
  assert.match(footsteps, /new Audio\(source\)/);
  assert.match(footsteps, /new THREE\.InstancedMesh/);
  assert.match(footsteps, /createDepressedFootprintGeometry/);
  assert.match(footsteps, /const SEAM_COLLAR = 0\.035/);
  assert.match(footsteps, /const HOLE_SIDE_INSET = 0\.014/);
  assert.match(footsteps, /const HOLE_END_INSET = 0\.02/);
  assert.match(footsteps, /surrounding collar remains level/);
  assert.match(footsteps, /These are real vertices below the surrounding terrain surface/);
  assert.match(footsteps, /world\.terrain\.material\.clone\(\)/);
  assert.match(footsteps, /Dynamic terrain footprint openings/);
  assert.match(footsteps, /terrainMaterial\.alphaTestNode/);
  assert.doesNotMatch(footsteps, /MeshPhysicalMaterial|fillMesh|WaterFill/);
  assert.match(footsteps, /surfaceWater\?\.impact/);
  assert.match(footsteps, /handleLanding\(view\)/);
  assert.match(footsteps, /view\.landingImpact/);
  assert.match(footsteps, /const planarScale = 1\.08 \+ force \* 0\.3/);
  assert.match(footsteps, /const depthScale = 1\.3 \+ force \* 1\.05/);
  assert.match(footsteps, /Object\.assign\(step, footprintFacing\(view\.yaw\)\)/);
  assert.match(footsteps, /const \{ directionX, directionZ \} = footprintFacing\(view\.yaw\)/);
  assert.match(footsteps, /landingStep\.leftFoot = false/);
  assert.match(logic, /"shallow-water"/);
  assert.doesNotMatch(footsteps, /AudioContext|createOscillator|createBufferSource/);
});

test("player gravity and solid dressing collisions remain runtime-owned", async () => {
  const [controller, collision] = await Promise.all([
    load("src/first-person.mjs"),
    load("src/collision-system.mjs"),
  ]);
  assert.match(controller, /JUMP_SPEED/);
  assert.match(controller, /GRAVITY/);
  assert.match(controller, /collisionWorld\.resolveMovement/);
  assert.match(collision, /PLAYER_RADIUS/);
  assert.match(collision, /kind: "palm"/);
  assert.match(collision, /name\.includes\("rock"\)/);
  assert.match(collision, /name\.includes\("driftwood"\)/);
  assert.match(collision, /Axis-separated resolution/);
});

test("day-night transitions retain stable WebGPU shadow and celestial render graphs", async () => {
  const skyCycle = await load("src/sky-cycle.mjs");
  assert.match(skyCycle, /sun\.castShadow = true/);
  assert.doesNotMatch(skyCycle, /sun\.castShadow = sample\./);
  assert.match(skyCycle, /moon\.visible = true/);
  assert.match(skyCycle, /stars\.visible = true/);
  assert.doesNotMatch(skyCycle, /stars\.visible = sample\./);
});

test("volumetric clouds drive rain from the same world-space storm field", async () => {
  const weather = await load("src/weather.mjs");
  assert.match(weather, /const CLOUD_BASE = 650/);
  assert.match(weather, /const CLOUD_TOP = 950/);
  assert.match(weather, /const CLOUD_SHELL_RADIUS = 3900/);
  assert.match(weather, /Loop\(CLOUD_VIEW_STEPS/);
  assert.match(weather, /const deckHeight = point\.y\.sub\(CLOUD_BASE\)/);
  assert.match(weather, /mx_noise_float\(coarseCoord\)/);
  assert.match(weather, /new THREE\.SphereGeometry\(CLOUD_SHELL_RADIUS, 48, 24\)/);
  assert.match(weather, /clouds\.position\.copy\(camera\.position\)/);
  assert.match(weather, /new THREE\.NodeMaterial/);
  assert.match(weather, /material\.colorNode = cloudRaymarch\(\)/);
  assert.doesNotMatch(weather, /new THREE\.BoxGeometry/);
  assert.doesNotMatch(weather, /RaymarchingBox/);
  assert.match(weather, /material\.depthTest = true/);
  assert.match(weather, /cloudFieldNode\(point\)/);
  assert.match(weather, /cloudDensityNode\(point\.add\(cloudKeyDirection\.mul\(16\)\)\)/);
  assert.match(weather, /export function cloudShadowNode\(point\)/);
  assert.match(weather, /projected = point\.add\(cloudKeyDirection\.mul\(travel\)\)/);
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
  assert.match(materials, /import \{ cloudShadowNode \} from "\.\/weather\.mjs"/);
  assert.match(materials, /applyCloudShadow\(albedo, point, 0\.56\)/);
  assert.match(materials, /applyCloudShadow\(mix\(waterColor, foamColor, foam\), point, 0\.34\)/);
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
  assert.match(palm, /mergeGeometries/);
  assert.match(palm, /baked\.applyMatrix4\(object\.matrixWorld\)/);
  assert.match(palm, /mergedPartCount/);
  assert.match(materials, /uv\(\)\.mul\(vec2\(uvScale\[0\], uvScale\[1\]\)\)/);
  assert.match(html, /"three": "\.\.\/\.\.\/node_modules\/three\/build\/three\.webgpu\.js"/);
});

test("Studio-authored rock variants replace procedural ball geometry", async () => {
  const [scene, rocks] = await Promise.all([
    load("src/scene.mjs"),
    load("src/rock-model.mjs"),
  ]);
  assert.match(scene, /coastal-rock-set\.glb/);
  assert.match(scene, /prepareStudioRockSet/);
  assert.match(scene, /i % rockTemplates\.length/);
  assert.doesNotMatch(scene, /IcosahedronGeometry/);
  assert.match(rocks, /Wave Worn Slab/);
  assert.match(rocks, /Fractured Boulder/);
  assert.match(rocks, /Embedded Shore Wedge/);
  assert.match(rocks, /geometry\.applyMatrix4\(mesh\.matrixWorld\)/);
  assert.match(rocks, /coastal-rock-slab/);
  assert.match(rocks, /coastal-rock-boulder/);
  assert.match(rocks, /coastal-rock-wedge/);
  assert.match(rocks, /maps\[profile\.tile\] \?\? maps\["coastal-rock"\]/);
  assert.match(rocks, /applyBoxProjectedUvs/);
  assert.match(rocks, /boxProjectedUvs/);
  assert.match(rocks, /deleteAttribute\("tangent"\)/);
  assert.match(scene, /burialFraction/);
  assert.match(scene, /setFromUnitVectors/);
  assert.match(rocks, /material\.transparent = false/);
});

test("every tile that needs relief ships albedo, height and normal maps", async () => {
  for (const name of Object.keys(TILE_SPECS)) {
    for (const suffix of ["albedo", "height", "normal"]) {
      const file = path.join(root, "assets", "textures", `${name}-${suffix}.png`);
      assert.ok((await stat(file)).isFile(), file);
    }
  }
});
