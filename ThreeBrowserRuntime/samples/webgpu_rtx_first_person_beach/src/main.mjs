import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createViewState, stepFirstPerson, cameraOrientation } from "./first-person.mjs";
import { createBeachCollisionWorld } from "./collision-system.mjs";
import { createBeachFootstepSystem } from "./footstep-system.mjs";
import { loadAllTileMaps, syncSkyUniforms, waterTime } from "./materials.mjs";
import { applySkyCycle, createSkyClock } from "./sky-cycle.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { collectStaticBeachScene } from "./rtx-scene.mjs";
import { buildBeachScene, createBeachEnvironment, WATER_LEVEL, WORLD } from "./scene.mjs";
import { createBeachWeather } from "./weather.mjs";
import { createBeachShovel } from "./shovel-system.mjs";

document.title = "RTX First-Person Beach — ThreeBrowser Runtime";

const MAX_INTERNAL_PIXELS = 5_300_000;
const MAX_INTERNAL_RATIO = 2.25;

function chooseInternalRatio(width, height) {
  const budgetRatio = Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height));
  return Math.min(MAX_INTERNAL_RATIO, budgetRatio);
}

function reportBridge(rtx) {
  if (!rtx) {
    console.warn("[First-Person Beach] RTX bridge unavailable; WebGPU raster remains active.");
    return;
  }
  const capabilities = rtx.capabilities ?? {};
  console.log(
    `[First-Person Beach] adapter=${capabilities.adapterName || "unknown"}` +
    ` · RTX=${Boolean(capabilities.rtx)}` +
    ` · rayLighting=${typeof rtx.evaluateRayLighting === "function"}` +
    ` · rayReflections=${typeof rtx.evaluateRayReflections === "function"}`,
  );
}

if (!WebGPU.isAvailable()) {
  throw new Error("First-person beach requires native WebGPU; there is no WebGL path.");
}

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  powerPreference: "high-performance",
  trackTimestamp: false,
});
const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
let internalRatio = chooseInternalRatio(innerWidth, innerHeight);
renderer.setPixelRatio(displayPixelRatio);
renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
renderer.setClearColor(0x87b0d2, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
renderer.domElement.style.touchAction = "none";
document.body.appendChild(renderer.domElement);
await renderer.init();
if (!renderer.backend?.isWebGPUBackend) {
  throw new Error("WebGPURenderer did not initialize its WebGPU backend.");
}
renderer.backend.device?.addEventListener?.("uncapturederror", event => {
  console.error("[Beach WebGPU]", event.error?.message || event.error || event);
});

const rtx = navigator.gpu?.threeBrowserRTX ?? null;
reportBridge(rtx);
console.log("[First-Person Beach] Click to lock · WASD walk · Shift sprint · Space jump · E carry/drop · X RTX");

const scene = new THREE.Scene();
scene.name = "First-person tropical beach";
scene.background = new THREE.Color(0x87b0d2);
scene.fog = new THREE.FogExp2(0x9ec0dc, 0.0088);

const camera = new THREE.PerspectiveCamera(72, innerWidth / Math.max(1, innerHeight), 0.08, 4000);
const environment = createBeachEnvironment(renderer);
scene.environment = environment.texture;
scene.environmentIntensity = 0.62;

const maps = await loadAllTileMaps();
const world = await buildBeachScene(scene, maps, renderer);
const collisionWorld = createBeachCollisionWorld(world);
const weather = createBeachWeather(scene, camera, world);
const footsteps = createBeachFootstepSystem(scene, world, weather.surfaceWater, collisionWorld);
const view = createViewState(0, -18, Math.PI, -0.05);
view.y = collisionWorld.groundHeightAt(view.x, view.z) + 1.64;
camera.position.set(view.x, view.y, view.z);
const shovel = await createBeachShovel(scene, camera, view, collisionWorld);
prepareRtxGuideMaterials(scene);

const keys = new Set();
const look = { x: 0, y: 0 };
let nativeRequested = true;
let looking = false;
let jumpQueued = false;
let lastPathLabel = "";

const rtxRenderer = new NativeRtxRenderer(renderer, camera, rtx);
let nativeReady = false;
const sunDirection = new THREE.Vector3();
const sunTarget = new THREE.Vector3();
const skyClock = createSkyClock();

function warmScenePipelines() {
  const savedPosition = camera.position.clone();
  const savedQuaternion = camera.quaternion.clone();
  try {
    camera.position.set(0, 5.5, -10);
    camera.lookAt(0, 6, -38);
    camera.updateMatrixWorld(true);
    const warmed = nativeReady
      ? rtxRenderer.render(scene, camera, { maxDistance: 180, rayBias: 0.022 })
      : rtxRenderer.renderRaster(scene, camera);
    if (warmed) console.log("[First-Person Beach] WebGPU palm and shadow pipelines warmed");
  } catch (error) {
    console.warn(`[First-Person Beach] Pipeline warm-up skipped: ${error?.message || error}`);
  } finally {
    camera.position.copy(savedPosition);
    camera.quaternion.copy(savedQuaternion);
    camera.updateMatrixWorld(true);
  }
}

function internalSize() {
  return new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * internalRatio)),
    Math.max(1, Math.round(innerHeight * internalRatio)),
  );
}

async function configureNative() {
  const size = internalSize();
  rtxRenderer.resize(size.x, size.y);
  nativeReady = false;
  const hasRays = typeof rtx?.evaluateRayLighting === "function"
    || typeof rtx?.evaluateRayReflections === "function";
  if (!nativeRequested || !hasRays) return false;
  try {
    world.terrain.updateWorldMatrix(true, true);
    world.dressing.updateWorldMatrix(true, true);
    const staticScene = collectStaticBeachScene(world.staticRoots, []);
    nativeReady = await rtxRenderer.configure(size.x, size.y, staticScene);
  } catch (error) {
    console.warn(`[First-Person Beach] RTX setup failed: ${error?.message || error}`);
    nativeReady = false;
  }
  return nativeReady;
}

await configureNative();
warmScenePipelines();

function applyCamera() {
  const pose = cameraOrientation(view);
  camera.rotation.order = "YXZ";
  camera.rotation.x = pose.pitch;
  camera.rotation.y = pose.yaw;
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
}

function clampToWorld(state) {
  state.x = THREE.MathUtils.clamp(state.x, WORLD.minX + 4, WORLD.maxX - 4);
  state.z = THREE.MathUtils.clamp(state.z, WORLD.minZ + 4, 18);
}

const canvas = renderer.domElement;
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  footsteps.arm();
  looking = true;
  canvas.setPointerCapture?.(event.pointerId);
  canvas.requestPointerLock?.();
});
canvas.addEventListener("pointerup", event => {
  looking = false;
  canvas.releasePointerCapture?.(event.pointerId);
});
canvas.addEventListener("pointercancel", () => {
  looking = false;
});
canvas.addEventListener("pointermove", event => {
  const locked = document.pointerLockElement === canvas;
  if (!looking && !locked) return;
  look.x += event.movementX || 0;
  look.y += event.movementY || 0;
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas) looking = false;
});
addEventListener("keydown", event => {
  footsteps.arm();
  keys.add(event.code);
  if (event.code === "Space" && !event.repeat) {
    jumpQueued = true;
    event.preventDefault?.();
  }
  if (event.code === "KeyE" && !event.repeat) shovel.interact();
  if (event.code === "KeyX") {
    nativeRequested = !nativeRequested;
    if (nativeRequested) configureNative();
    else nativeReady = false;
    console.log(`[First-Person Beach] RTX requested=${nativeRequested}`);
  }
});
addEventListener("keyup", event => keys.delete(event.code));

let previous = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  stepFirstPerson(view, {
    forward: Number(keys.has("KeyW") || keys.has("ArrowUp")),
    back: Number(keys.has("KeyS") || keys.has("ArrowDown")),
    left: Number(keys.has("KeyA") || keys.has("ArrowLeft")),
    right: Number(keys.has("KeyD") || keys.has("ArrowRight")),
    sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    jump: jumpQueued,
    lookX: look.x,
    lookY: look.y,
  }, collisionWorld.groundHeightAt, WATER_LEVEL, dt, collisionWorld);
  jumpQueued = false;
  look.x = 0;
  look.y = 0;
  clampToWorld(view);
  applyCamera();
  world.sky.position.copy(camera.position);
  waterTime.value += dt;
  world.foamField?.update(dt);
  const sky = skyClock.advance(dt);
  syncSkyUniforms(sky);
  applySkyCycle(sky, {
    sun: world.sun,
    moonLight: world.moonLight,
    hemi: world.lights.hemi,
    bounce: world.lights.bounce,
    moon: world.moon,
    stars: world.stars,
    camera,
    scene,
    renderer,
  });
  const weatherFrame = weather.update(dt, sky, world);
  footsteps.update(dt, view);
  shovel.update(dt);

  world.sun.updateWorldMatrix(true, false);
  world.sun.target.updateWorldMatrix(true, false);
  if (sky.keyIsSun) {
    world.sun.getWorldPosition(sunDirection);
    world.sun.target.getWorldPosition(sunTarget);
  } else {
    world.moonLight.updateWorldMatrix(true, false);
    world.moonLight.target.updateWorldMatrix(true, false);
    world.moonLight.getWorldPosition(sunDirection);
    world.moonLight.target.getWorldPosition(sunTarget);
  }
  sunDirection.sub(sunTarget).normalize();

  const frameOptions = {
    sunDirection,
    sunIntensity: sky.rtxSunIntensity * (1 - weatherFrame.cloudShadow * 0.62),
    shadowStrength: Math.min(0.9, sky.shadowStrength + weatherFrame.cloudShadow * 0.42),
    aoStrength: sky.day * 0.1 + 0.04,
    aoRadius: 1.15,
    maxDistance: 180,
    rayBias: 0.022,
    reflectionStrength: 0.35 + sky.day * 0.35,
    environmentColor: sky.horizon,
    environmentIntensity: (0.18 + sky.day * 0.62) * (1 - weatherFrame.cloudShadow * 0.48),
  };

  let rendered = false;
  if (nativeRequested && nativeReady) {
    rendered = rtxRenderer.render(scene, camera, frameOptions);
  }
  if (!rendered) {
    nativeReady = false;
    rendered = rtxRenderer.renderRaster(scene, camera);
  }
  if (!rtxRenderer.present(null)) {
    renderer.setRenderTarget(null);
    renderer.setMRT(null);
    renderer.render(scene, camera);
  }

  const pathLabel = nativeReady ? rtxRenderer.rayPathLabel : "WEBGPU RASTER FALLBACK";
  if (pathLabel !== lastPathLabel) {
    lastPathLabel = pathLabel;
    console.log(`[First-Person Beach] path=${pathLabel}`);
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
  internalRatio = chooseInternalRatio(innerWidth, innerHeight);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  const size = internalSize();
  const resized = rtxRenderer.resize(size.x, size.y);
  if (nativeReady) nativeReady = resized;
});

addEventListener("beforeunload", () => {
  world.foamField?.dispose();
  weather.dispose();
  footsteps.dispose();
  shovel.dispose();
  rtxRenderer.dispose();
});
