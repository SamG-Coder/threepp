import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  DYNAMIC_TRIANGLE_COUNT,
  DYNAMIC_VERTEX_COUNT,
  FIBRE_RINGS,
  FIBRE_SIDES,
  POSITION_ATLAS_HEIGHT,
  POSITION_ATLAS_WIDTH,
  RTX_PROXY_TRIANGLE_COUNT,
  RTX_PROXY_TRIANGLES_PER_FIBRE,
  TRIANGLES_PER_FIBRE,
  VERTICES_PER_FIBRE,
} from "../src/fibre-gpu.mjs";
import { FIBRE_COUNT } from "../src/fibre-model.mjs";
import {
  createKitchenCollisionWorld,
  TENNIS_COLLISION_RADIUS,
} from "../src/kitchen-colliders.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = relative => readFile(path.join(root, relative), "utf8");

test("fixed tube topology and rgba32float atlas cover every GPU fibre vertex", () => {
  assert.equal(FIBRE_COUNT, 24_576);
  assert.equal(FIBRE_RINGS, 12);
  assert.equal(FIBRE_SIDES, 4);
  assert.equal(VERTICES_PER_FIBRE, FIBRE_RINGS * FIBRE_SIDES);
  assert.equal(TRIANGLES_PER_FIBRE, (FIBRE_RINGS - 1) * FIBRE_SIDES * 2);
  assert.equal(DYNAMIC_VERTEX_COUNT, FIBRE_COUNT * VERTICES_PER_FIBRE);
  assert.equal(DYNAMIC_TRIANGLE_COUNT, FIBRE_COUNT * TRIANGLES_PER_FIBRE);
  assert.equal(RTX_PROXY_TRIANGLE_COUNT, FIBRE_COUNT * RTX_PROXY_TRIANGLES_PER_FIBRE);
  assert.ok(RTX_PROXY_TRIANGLE_COUNT * 3 * Uint32Array.BYTES_PER_ELEMENT < 8 * 1024 * 1024);
  assert.ok(POSITION_ATLAS_WIDTH * POSITION_ATLAS_HEIGHT >= DYNAMIC_VERTEX_COUNT);
  assert.ok(POSITION_ATLAS_WIDTH * (POSITION_ATLAS_HEIGHT - 1) < DYNAMIC_VERTEX_COUNT);
});

test("frame ordering is compute, exact raster, BLAS refit, ray lighting, then macro DOF", async () => {
  const source = await load("src/native-ray-renderer.mjs");
  const simulation = source.indexOf("recordSimulation(encoder");
  const raster = source.indexOf("recordRaster(encoder", simulation);
  const refit = source.indexOf("recordRefit(encoder", raster);
  const lighting = source.indexOf("evaluateRayLighting({", refit);
  const dof = source.indexOf("_recordDof(encoder", lighting);
  assert.ok(simulation >= 0 && simulation < raster && raster < refit && refit < lighting && lighting < dof);
  assert.match(source, /directionalSampleCount:\s*LIGHT_SAMPLES/);
  assert.match(source, /aoSampleCount:\s*AO_SAMPLES/);
});

test("GPU positions are shared by raster and dynamic RTX without CPU readback", async () => {
  const source = await load("src/fibre-gpu.mjs");
  assert.match(source, /format:\s*"rgba32float"/);
  assert.match(source, /textureUsage\.COPY_SRC/);
  assert.match(source, /textureUsage\.TEXTURE_BINDING/);
  assert.match(source, /textureUsage\.STORAGE_BINDING/);
  assert.match(source, /createDynamicTriangleMesh\s*\(/);
  assert.match(source, /refitDynamicTriangleMesh\s*\(/);
  assert.match(source, /positionsTexture:\s*positionTexture/);
  assert.doesNotMatch(source, /mapAsync|getMappedRange|copyTextureToBuffer|readBuffer/);
});

test("project shaders obey the raw WebGPU and public lighting-v1 contracts", async () => {
  const [physics, raster, dof, transport, renderer] = await Promise.all([
    load("shaders/fibre_physics.wgsl"),
    load("shaders/fibre_raster.wgsl"),
    load("shaders/macro_dof.wgsl"),
    load("shaders/fibre_transport.comp"),
    load("src/native-ray-renderer.mjs"),
  ]);
  assert.match(physics, /@compute\s+@workgroup_size\(64, 1, 1\)/);
  assert.match(physics, /texture_storage_2d<rgba32float, write>/);
  assert.match(physics, /fibreState:\s*array<vec4<f32>>/);
  assert.match(raster, /@builtin\(vertex_index\)/);
  assert.match(raster, /textureLoad\(positionAtlas/);
  assert.match(raster, /loadRingCentre\(fibreIndex/);
  assert.match(dof, /texture_storage_2d<rgba16float, write>/);
  assert.match(dof, /SAMPLE_COUNT:\s*u32\s*=\s*16u/);
  assert.match(transport, /#extension GL_EXT_ray_query : require/);
  assert.match(transport, /layout\(set = 0, binding = 0\) uniform accelerationStructureEXT/);
  assert.match(transport, /layout\(rgba16f, set = 0, binding = 1\) uniform image2D/);
  assert.match(transport, /layout\(set = 0, binding = 2\) uniform sampler2D/);
  assert.match(transport, /rayQueryInitializeEXT/);
  assert.match(transport, /if \(fibreMask <= 0\.001\) return/);
  assert.match(transport, /keyFactor\s*=\s*mix\(1\.0, queriedKey, fibreMask\)/);
  assert.match(transport, /aoFactor\s*=\s*mix\(1\.0, queriedAo, fibreMask\)/);
  assert.match(renderer, /profile:\s*"lighting-v1"/);
  assert.doesNotMatch(renderer, /profile:\s*"reflections-v[12]"/);
});

test("manifest is complete, local-only and launches the WebGPU sample", async () => {
  const manifest = JSON.parse(await load("threebrowser.pull.json"));
  assert.equal(manifest.format, 2);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.requiresWebGPU, true);
  assert.equal(manifest.compatibility.canvasOnly, true);
  assert.equal(manifest.compatibility.htmlOverlay, false);
  const listed = new Set(manifest.files.map(file => file.path));
  for (const required of [
    "index.html",
    "site-entry.mjs",
    "src/main.mjs",
    "src/fibre-model.mjs",
    "src/fibre-gpu.mjs",
    "src/tennis-ball.mjs",
    "src/kitchen-colliders.mjs",
    "src/native-ray-renderer.mjs",
    "src/hud.mjs",
    "shaders/fibre_physics.wgsl",
    "shaders/fibre_raster.wgsl",
    "shaders/macro_dof.wgsl",
    "shaders/fibre_transport.comp",
    "assets/tennis-table-impact.wav",
    "tools/generate-impact-audio.mjs",
  ]) {
    assert.ok(listed.has(required), `${required} is absent from the manifest`);
    assert.ok((await stat(path.join(root, required))).isFile());
  }
  const entry = await load("site-entry.mjs");
  assert.match(entry, /await import\("\.\/src\/main\.mjs"\)/);
  const main = await load("src/main.mjs");
  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /createGpuFibreSystem/);
  assert.match(main, /surfaceDistanceMillimetres/);
});

test("native resize keeps the swapchain full-size and scales only RTX targets", async () => {
  const main = await load("src/main.mjs");
  assert.match(main, /renderer\.setPixelRatio\(displayPixelRatio\)/);
  assert.match(main, /renderer\.setSize\(width, height\)/);
  assert.match(main, /Math\.round\(width \* internalRatio\)/);
  assert.match(main, /Math\.round\(height \* internalRatio\)/);
  assert.doesNotMatch(main, /renderer\.setPixelRatio\(internalRatio\)/);
  assert.doesNotMatch(main, /renderer\.setPixelRatio\(ratio\)/);
  assert.doesNotMatch(main, /renderer\.setSize\(width, height, false\)/);
  const native = await load("src/native-ray-renderer.mjs");
  assert.match(native, /_displayMaterialCache = new Map\(\)/);
  assert.match(native, /_setDisplayTexture\(this\.dofTarget\?\.texture \?\? target\.texture\)/);
  assert.doesNotMatch(native, /_displayMaterial\.map\s*=/);
});

test("depth of field is a true macro-only effect", async () => {
  const main = await load("src/main.mjs");
  assert.match(main, /const macroDof = smoothstep\(photographicMacro\)/);
  assert.match(main, /maximumCoc:\s*9\.5 \* macroDof/);
  assert.match(main, /strength:\s*0\.92 \* macroDof/);
  assert.doesNotMatch(main, /maximumCoc:\s*THREE\.MathUtils\.lerp\(3\.2/);
  assert.doesNotMatch(main, /strength:\s*THREE\.MathUtils\.lerp\(0\.68/);
});

test("bounce pose stays identical across shell, raster fibres and dynamic RTX", async () => {
  const [main, gpu, physics, ball] = await Promise.all([
    load("src/main.mjs"),
    load("src/fibre-gpu.mjs"),
    load("shaders/fibre_physics.wgsl"),
    load("src/tennis-ball.mjs"),
  ]);
  assert.match(main, /tennis\.ballGroup\.scale\.copy\(ballScale\)/);
  assert.match(main, /tennis\.ballGroup\.position\.copy\(ballOffset\)/);
  assert.match(main, /ballScale:\s*ballScale\.toArray\(\)/);
  assert.match(main, /ballOffset:\s*ballOffset\.toArray\(\)/);
  assert.match(main, /ballRotation:\s*ballQuaternion\.toArray\(\)/);
  assert.match(gpu, /setFloat32\(80 \+ axis \* 4,[\s\S]*?, true\)/);
  assert.match(gpu, /setFloat32\(96 \+ axis \* 4,[\s\S]*?, true\)/);
  assert.match(gpu, /112 \+ axis \* 4/);
  assert.match(physics, /rotateByQuaternion\(finalPosition, simulation\.ballRotation\)/);
  assert.match(physics, /finalPosition \* simulation\.ballScale\.xyz \+ simulation\.ballOffset\.xyz/);
  assert.match(ball, /ballRotationGroup/);
  assert.match(ball, /collectTennisStaticScene\(\[/);
  assert.match(ball, /\.\.\.studio\.staticMeshes/);
  assert.match(ball, /\.\.\.fixedIslandMeshes/);
});

test("cinematic kitchen bounce has physical light, impact audio and extended dolly", async () => {
  const [main, ball] = await Promise.all([
    load("src/main.mjs"),
    load("src/tennis-ball.mjs"),
  ]);
  assert.match(main, /MAX_CAMERA_DISTANCE\s*=\s*32\.0/);
  assert.match(main, /new THREE\.SpotLight\([^\n]*, 2\)/);
  assert.match(main, /aimSpotlightAt\(ballOffset\)/);
  assert.match(main, /new THREE\.CylinderGeometry/);
  assert.match(main, /createTennisImpactAudio/);
  assert.match(main, /new Audio\(source\)/);
  assert.match(main, /tennis-table-impact\.wav/);
  assert.match(main, /impactAudio\.play\(impactSpeed\)/);
  assert.match(main, /THREE\.MathUtils\.lerp\(0\.014, 0\.05, amount\)/);
  assert.match(main, /state\.bounceVelocity\s*=\s*14\.0/);
  assert.match(main, /ballOffset\.y \* \(state\.playMode \? 1\.0 : 0\.42\)/);
  assert.match(ball, /STUDIO_ROOM_EXTENT\s*=\s*36/);
  assert.match(ball, /KITCHEN_FLOOR_HEIGHT\s*=\s*-19/);
  assert.match(ball, /KITCHEN_BENCH_HALF_X\s*=\s*19/);
  assert.match(ball, /KITCHEN_BENCH_HALF_Z\s*=\s*10/);
  assert.match(ball, /new THREE\.PlaneGeometry\(\s*KITCHEN_BENCH_HALF_X \* 2,\s*KITCHEN_BENCH_HALF_Z \* 2/);
  assert.match(ball, /Stable clear-coated black quartz kitchen bench/);
  assert.doesNotMatch(ball, /\breflector\s*\(/);
  for (const fixture of [
    "Complete procedural kitchen room",
    "Complete black and ivory checkerboard kitchen floor",
    "Continuous rear kitchen base cabinets",
    "Brushed kitchen stainless steel",
    "Deep stainless sink basin bottom",
    "Correctly oriented gooseneck kitchen tap",
    "Deep daylight sky beyond the kitchen window",
    "Smoky blue hand-trowelled kitchen plaster",
    "Black glass kitchen appliance",
  ]) assert.match(ball, new RegExp(fixture));
  assert.match(ball, /function createCheckerFloorGeometry/);
  assert.match(ball, /const inset = 0/);
  assert.doesNotMatch(ball, /Recessed grout under the checkerboard kitchen floor/);
  assert.match(ball, /name: "Complete black and ivory checkerboard kitchen floor",[\s\S]*?castShadow: false/);
  assert.match(ball, /Window centre mullion/);
  assert.match(ball, /new THREE\.PlaneGeometry\(28, 60\)/);
  assert.match(ball, /outdoorGround\.position\.set\(-51\.5, 1\.0, -11\.0\)/);
  assert.match(ball, /new THREE\.BoxGeometry\(51\.5, 17\.2, 7\.0\)/);
});

test("lit kitchen free-play uses held input, bench-to-floor physics and room collisions", async () => {
  const [main, gpu, physics, ball, colliders] = await Promise.all([
    load("src/main.mjs"),
    load("src/fibre-gpu.mjs"),
    load("shaders/fibre_physics.wgsl"),
    load("src/tennis-ball.mjs"),
    load("src/kitchen-colliders.mjs"),
  ]);
  assert.match(main, /keyName === "l"/);
  for (const code of ["KeyW", "KeyA", "KeyS", "KeyD"]) assert.match(main, new RegExp(code));
  assert.match(main, /state\.linearVelocity\.addScaledVector/);
  assert.match(main, /\(state\.grounded \? 8\.5 : 3\.5\) \* step/);
  assert.match(main, /planarSpeed > 12/);
  assert.match(main, /state\.jumpBoostRemaining/);
  assert.match(main, /state\.bounceVelocity \+= 44 \* step/);
  assert.match(main, /createKitchenCollisionWorld\(\{/);
  assert.match(main, /kitchenCollisions\.resolveSphere\(/);
  assert.match(main, /collision\.lateralImpactSpeed/);
  assert.match(colliders, /function nearestInsideFace/);
  assert.match(colliders, /for \(let pass = 0; pass < maxPasses; \+\+pass\)/);
  assert.match(colliders, /Deep sink basin bottom/);
  assert.match(colliders, /Four separate pieces leave the authored/);
  assert.match(main, /roomWash\.intensity/);
  assert.match(main, /roomLightLevel/);
  assert.match(main, /L-toggle full kitchen lighting rig/);
  assert.match(main, /roomLights\) light\.intensity = level \* 1_050/);
  assert.match(main, /shotTargetY = ballOffset\.y \* \(state\.playMode \? 1\.0 : 0\.42\)/);
  assert.match(main, /maximumNear = THREE\.MathUtils\.lerp\(0\.018, 0\.16, roomDepthPrecision\)/);
  assert.match(main, /tennis\.ballRotationGroup\.quaternion\.copy\(ballQuaternion\)/);
  assert.match(gpu, /SIMULATION_UNIFORM_BYTES = 128/);
  assert.match(physics, /ballRotation:\s*vec4<f32>/);
  assert.match(ball, /STUDIO_ROOM_TOP\s*=\s*32/);
  assert.match(ball, /\.\.\.studio\.staticMeshes/);
  assert.match(ball, /\.\.\.fixedIslandMeshes/);
});

test("kitchen collision world resolves fixtures and preserves the recessed sink opening", () => {
  const world = createKitchenCollisionWorld();
  const names = new Set(world.colliders.map(collider => collider.name));
  for (const name of [
    "Checkerboard kitchen floor",
    "Kitchen ceiling",
    "Polished kitchen island worktop",
    "Rear base cabinet bank",
    "Full-height refrigerator",
    "Deep sink basin bottom",
    "Tap spout",
  ]) assert.ok(names.has(name), `${name} has no collision volume`);

  const island = world.colliders.find(collider => collider.name === "Kitchen island cabinet base");
  const sidePosition = new THREE.Vector3(
    island.max.x + TENNIS_COLLISION_RADIUS - 0.18,
    island.min.y + 3,
    0,
  );
  const sideVelocity = new THREE.Vector3(-5, 0, 0);
  const sideHit = world.resolveSphere(sidePosition, sideVelocity, TENNIS_COLLISION_RADIUS);
  assert.ok(sidePosition.x >= island.max.x + TENNIS_COLLISION_RADIUS - 1e-5);
  assert.ok(sideVelocity.x > 0);
  assert.ok(sideHit.lateralImpactSpeed >= 4.99);

  // The centre of the sink is not covered by a monolithic counter collider;
  // a falling ball reaches and rebounds from the real basin bottom.
  const sinkPosition = new THREE.Vector3(-32.5, -2.0, -11.0);
  const sinkVelocity = new THREE.Vector3(0, -4, 0);
  const sinkHit = world.resolveSphere(sinkPosition, sinkVelocity, TENNIS_COLLISION_RADIUS);
  assert.ok(sinkHit.contacts.some(contact => contact.name === "Deep sink basin bottom"));
  assert.ok(sinkHit.groundImpactSpeed >= 3.99);
  assert.ok(sinkVelocity.y > 0);
});

test("sample directory contains no native code or downloaded visual assets", async () => {
  const manifest = JSON.parse(await load("threebrowser.pull.json"));
  const paths = manifest.files.map(file => file.path.toLowerCase());
  assert.ok(paths.every(file => !/\.(cpp|cc|cxx|h|hpp|png|jpg|jpeg|webp|glb|gltf)$/.test(file)));
  assert.ok(paths.every(file => !file.startsWith("http:") && !file.startsWith("https:")));
});
