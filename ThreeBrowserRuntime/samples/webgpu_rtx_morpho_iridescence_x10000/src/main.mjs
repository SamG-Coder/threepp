import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";

import { createMorphoScene } from "./morpho-scene.mjs";
import { MORPHO_SEED } from "./morpho-model.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { collectStaticRtxScene } from "./rtx-scene.mjs";
import { createHud } from "./hud.mjs";
import {
  createCameraRig,
  MIN_MAGNIFICATION,
  MAX_MAGNIFICATION,
  DEFAULT_MAGNIFICATION,
  DEFAULT_YAW,
  DEFAULT_PITCH,
} from "./camera-rig.mjs";

document.title = "RTX Morpho Iridescence ×10000 — ThreeBrowser Runtime";

const PIXEL_RATIO_CAP = 1.5;
const BASE_FOV_DEGREES = 35;
const LIGHTING_RIG_COUNT = 4;
const RIG_LUMINANCE = Object.freeze([0.58, 0.84, 0.38, 0.72]);
const RIG_ENVIRONMENT = Object.freeze([0x17364a, 0x243848, 0x3a220e, 0x1c2a36]);
const scratchColor = new THREE.Color();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createDawnEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x02080a);
  const owned = [];

  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x07140f,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 24), shellMaterial);
  environmentScene.add(shell);
  owned.push(shell.geometry, shellMaterial);

  const cards = [
    { color: 0xe8f4ff, energy: 16, size: [14, 18], position: [2, 22, 4], rotation: [Math.PI * 0.52, 0, 0] },
    { color: 0xffe2c4, energy: 9, size: [10, 14], position: [-16, 14, 8], rotation: [0, Math.PI * 0.55, -0.1] },
    { color: 0x6eb8ff, energy: 7, size: [8, 12], position: [16, 8, 10], rotation: [0, -Math.PI * 0.6, 0.08] },
    { color: 0xffc07a, energy: 5, size: [12, 5], position: [8, 10, -14], rotation: [0, -0.35, 0] },
    { color: 0xffffff, energy: 14, size: [3, 3], position: [0, 12, 8], rotation: [0.4, Math.PI, 0] },
  ];
  for (const card of cards) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(card.color).multiplyScalar(card.energy),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const geometry = new THREE.PlaneGeometry(...card.size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...card.position);
    mesh.rotation.set(...card.rotation);
    environmentScene.add(mesh);
    owned.push(geometry, material);
  }

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.018,
    0.1,
    78,
    { size: 512, position: new THREE.Vector3(0.4, 1.2, 0.2) },
  );
  generator.dispose();
  for (const resource of owned) resource.dispose?.();
  return target;
}

async function loadGeneratedTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const [wingTexture, eyeTexture, mossTexture] = await Promise.all([
    loader.loadAsync(new URL("../assets/morpho-wing-lamellae.png", import.meta.url).href),
    loader.loadAsync(new URL("../assets/compound-eye-mosaic.png", import.meta.url).href),
    loader.loadAsync(new URL("../assets/greenhouse-moss.png", import.meta.url).href),
  ]);
  const maxAnisotropy = Math.min(16, finite(renderer.backend?.device?.limits?.maxSamplerAnisotropy, 16));
  for (const texture of [wingTexture, eyeTexture, mossTexture]) {
    texture.anisotropy = maxAnisotropy;
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  wingTexture.name = "ImageGen morpho wing lamellae albedo";
  eyeTexture.name = "ImageGen compound-eye mosaic albedo";
  mossTexture.name = "ImageGen greenhouse moss albedo";
  return { wingTexture, eyeTexture, mossTexture };
}

async function main() {
  if (!WebGPU.isAvailable()) throw new Error("RTX Morpho Iridescence ×10000 requires WebGPU.");

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#02080a";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  renderer.setPixelRatio(Math.min(
    PIXEL_RATIO_CAP,
    Math.max(1, finite(globalThis.devicePixelRatio, 1)),
  ));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x02080a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.38;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  Object.assign(renderer.domElement.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    touchAction: "none",
    cursor: "crosshair",
  });
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
    throw new Error("Morpho Iridescence did not receive the native WebGPU backend.");
  }

  const validationErrors = [];
  renderer.backend.device.addEventListener?.("uncapturederror", event => {
    const message = event.error?.message || String(event.error || event);
    validationErrors.push(message);
    console.error("[Morpho Iridescence WebGPU]", message);
  });

  const scene = new THREE.Scene();
  scene.name = "Dawn greenhouse with Morpho photonic-crystal iridescence";
  scene.background = new THREE.Color(0x02080a);
  scene.fog = new THREE.FogExp2(0x081018, 0.0035);

  const camera = new THREE.PerspectiveCamera(
    BASE_FOV_DEGREES,
    innerWidth / Math.max(1, innerHeight),
    0.0005,
    160,
  );
  camera.position.set(0.7, 2.9, 1.2);
  camera.lookAt(0.46, 1.14, 0.02);
  const cameraRig = createCameraRig(camera);
  cameraRig.snap(DEFAULT_YAW, DEFAULT_PITCH, DEFAULT_MAGNIFICATION);

  const textures = await loadGeneratedTextures(renderer);
  const environmentTarget = createDawnEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1.55;

  const world = createMorphoScene(scene, {
    ...textures,
    seed: MORPHO_SEED,
  });
  prepareRtxGuideMaterials(scene);
  const hud = createHud();

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  try {
    const features = {
      dlssSuperResolution: false,
      dlssFrameGeneration: false,
      dlssRayReconstruction: false,
    };
    if (capabilities.reflex) features.reflex = "boost";
    rtx?.requestFeatures?.(features);
  } catch (error) {
    console.warn("[Morpho Iridescence RTX] Feature request rejected: " + (error?.message || error));
  }

  // Hybrid real-time frame: native rays augment the WebGPU raster. This is not
  // a path tracer, and DLSS ray reconstruction stays off because the sample
  // does not provide that complete contract.
  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx, {
    timeoutMs: 30_000,
    directionalLightIntensity: 0.19,
    directionalAngularRadius: 0.028,
    directionalSampleCount: 8,
    aoSampleCount: 16,
    maxDistance: 82,
    rayBias: 0.0022,
    shadowStrength: 0.2,
    aoStrength: 0.11,
    aoRadius: 1.25,
    reflectionStrength: 0.38,
    reflectionDistance: 78,
    reflectionRayBias: 0.0028,
    roughnessCutoff: 0.76,
  });
  const initialBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  nativeRenderer.resize(initialBuffer.x, initialBuffer.y);

  const state = {
    elapsed: 0,
    paused: false,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    pointer: new THREE.Vector2(0, 0),
    gaze: new THREE.Vector2(0, 0),
    yaw: DEFAULT_YAW,
    pitch: DEFAULT_PITCH,
    targetYaw: DEFAULT_YAW,
    targetPitch: DEFAULT_PITCH,
    magnification: DEFAULT_MAGNIFICATION,
    targetMagnification: DEFAULT_MAGNIFICATION,
    studioRig: 0,
    keyBase: world.lights[0].position.clone(),
    forceRaster: false,
    nativeConfigured: false,
    setupFinished: false,
    staticSceneStats: null,
    lastHudTime: -Infinity,
  };

  function resetExperience() {
    state.elapsed = 0;
    state.paused = false;
    state.targetYaw = DEFAULT_YAW;
    state.targetPitch = DEFAULT_PITCH;
    state.yaw = DEFAULT_YAW;
    state.pitch = DEFAULT_PITCH;
    state.magnification = DEFAULT_MAGNIFICATION;
    state.targetMagnification = DEFAULT_MAGNIFICATION;
    state.pointer.set(0, 0);
    state.gaze.set(0, 0);
    state.studioRig = 0;
    cameraRig.reset();
    world.reset();
    world.setPaused(false);
    state.keyBase.copy(world.lights[0].position);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.style.cursor = "grabbing";
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function updatePointer(event) {
    state.pointer.set(
      THREE.MathUtils.clamp(event.clientX / Math.max(1, innerWidth) * 2 - 1, -1, 1),
      THREE.MathUtils.clamp(1 - event.clientY / Math.max(1, innerHeight) * 2, -1, 1),
    );
  }

  function onPointerMove(event) {
    updatePointer(event);
    if (!state.dragging) {
      state.gaze.set(state.pointer.x * 0.72, state.pointer.y * 0.58).clampLength(0, 0.82);
      return;
    }
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.targetYaw = THREE.MathUtils.clamp(state.targetYaw - dx * 0.0036, -1.35, 1.35);
    state.targetPitch = THREE.MathUtils.clamp(state.targetPitch + dy * 0.0029, -0.72, 0.28);
    state.previousPointer.set(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.style.cursor = "crosshair";
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.targetMagnification = THREE.MathUtils.clamp(
      state.targetMagnification * Math.exp(-finite(event.deltaY) * 0.0032),
      MIN_MAGNIFICATION,
      MAX_MAGNIFICATION,
    );
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      world.triggerFlap(event.shiftKey ? 1.35 : 1);
    } else if (key === "l") {
      state.studioRig = (state.studioRig + 1) % LIGHTING_RIG_COUNT;
      world.setStudioRig(state.studioRig);
      state.keyBase.copy(world.lights[0].position);
    } else if (key === "p") {
      state.paused = !state.paused;
      world.setPaused(state.paused);
    } else if (key === "x") {
      state.forceRaster = !state.forceRaster;
    } else if (key === "r") {
      resetExperience();
    }
  }

  function onContextMenu(event) { event.preventDefault(); }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!nativeRenderer.resize(buffer.x, buffer.y)) state.nativeConfigured = false;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("lostpointercapture", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("contextmenu", onContextMenu);
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("resize", resize);

  function updateCamera(delta) {
    const response = 1 - Math.exp(-Math.min(0.08, Math.max(0, delta)) * 7.2);
    state.yaw = THREE.MathUtils.lerp(state.yaw, state.targetYaw, response);
    state.pitch = THREE.MathUtils.lerp(state.pitch, state.targetPitch, response);
    const currentLog = Math.log(Math.max(1, state.magnification));
    const targetLog = Math.log(Math.max(1, state.targetMagnification));
    state.magnification = Math.exp(THREE.MathUtils.lerp(currentLog, targetLog, response));
    cameraRig.update(delta, {
      yaw: state.yaw,
      pitch: state.pitch,
      magnification: state.magnification,
    });
  }

  function snapshot() {
    return Object.freeze({
      title: document.title,
      seed: MORPHO_SEED,
      world: world.stats(),
      render: nativeRenderer.status(),
      nativeConfigured: state.nativeConfigured,
      setupFinished: state.setupFinished,
      staticScene: state.staticSceneStats ? { ...state.staticSceneStats } : null,
      magnification: state.magnification,
      targetMagnification: state.targetMagnification,
      forceRaster: state.forceRaster,
      paused: state.paused,
      camera: { position: camera.position.toArray(), fov: camera.fov },
      validationErrors: [...validationErrors],
    });
  }

  globalThis.__MORPHO_IRIDESCENCE_X10000_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      flap: strength => world.triggerFlap(strength),
      pause(value = true) {
        state.paused = Boolean(value);
        world.setPaused(state.paused);
        return state.paused;
      },
      gaze(x = 0, y = 0) {
        state.gaze.set(finite(x), finite(y)).clampLength(0, 0.82);
        return state.gaze.toArray();
      },
      magnify(value = 1) {
        state.targetMagnification = THREE.MathUtils.clamp(
          finite(value, 1),
          MIN_MAGNIFICATION,
          MAX_MAGNIFICATION,
        );
        return state.targetMagnification;
      },
      studio(value = state.studioRig + 1) {
        state.studioRig = ((Math.trunc(finite(value)) % LIGHTING_RIG_COUNT) + LIGHTING_RIG_COUNT) % LIGHTING_RIG_COUNT;
        const result = world.setStudioRig(state.studioRig);
        state.keyBase.copy(world.lights[0].position);
        return result;
      },
      compareRaster(value = true) {
        state.forceRaster = Boolean(value);
        return state.forceRaster;
      },
      reset: resetExperience,
    }),
  });

  renderer.compileAsync?.(scene, camera)?.catch?.(error => {
    console.warn("[Morpho Iridescence] Shader prewarm deferred: " + (error?.message || error));
  });

  let previousTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min(0.075, Math.max(0, (now - previousTime) / 1000));
    previousTime = now;
    state.elapsed += delta;

    const rigLuminance = RIG_LUMINANCE[state.studioRig] ?? 0.58;
    world.update(delta, {
      paused: state.paused,
      gazeX: state.gaze.x,
      gazeY: state.gaze.y,
      magnification: state.magnification,
      luminance: rigLuminance + state.pointer.y * 0.06,
    });
    world.lights[0].position.x = state.keyBase.x + state.pointer.x * 4.5;
    world.lights[0].position.y = state.keyBase.y + state.pointer.y * 3.2;
    updateCamera(delta);

    let staged = false;
    if (state.nativeConfigured && !state.forceRaster) {
      scratchColor.setHex(RIG_ENVIRONMENT[state.studioRig] ?? 0x17364a)
        .convertSRGBToLinear();
      staged = nativeRenderer.renderNative(scene, camera, {
        directionalLightDirection: [-0.36 + state.pointer.x * 0.08, 0.78, -0.5],
        directionalLightIntensity: 0.16 + rigLuminance * 0.08,
        reflectionStrength: 0.34 + (state.paused ? 0 : 0.04),
        reflectionDistance: 78,
        reflectionRayBias: 0.0028,
        roughnessCutoff: 0.76,
        maxDistance: 82,
        rayBias: 0.0022,
        environmentColor: [scratchColor.r * 0.08, scratchColor.g * 0.08, scratchColor.b * 0.1],
        environmentIntensity: 0.16,
        highQuality: true,
      });
      if (!staged && !nativeRenderer.status().configured) state.nativeConfigured = false;
    }
    if (!staged) staged = nativeRenderer.renderRaster(scene, camera);
    if (staged && !nativeRenderer.present()) {
      console.error("[Morpho Iridescence] Single-surface presentation failed.");
    }

    if (state.elapsed - state.lastHudTime >= 0.1) {
      state.lastHudTime = state.elapsed;
      hud.update(world.stats(), nativeRenderer.status(), state);
    }
  });

  const bridgeUsable = Boolean(
    rtx &&
    typeof rtx.registerStaticScene === "function" &&
    (typeof rtx.evaluateRayLighting === "function" || typeof rtx.evaluateRayReflections === "function"),
  );
  void (async () => {
    if (!bridgeUsable) {
      state.setupFinished = true;
      console.warn("[Morpho Iridescence RTX] Native bridge unavailable; exact WebGPU remains active.");
      return;
    }
    try {
      const staticScene = await collectStaticRtxScene(world.opaqueRoots, {
        maxTriangles: 420_000,
        lights: world.lights,
        yieldToHost: () => new Promise(resolve => setTimeout(resolve, 0)),
      });
      state.staticSceneStats = {
        triangles: staticScene.triangleCount,
        vertices: staticScene.vertexCount,
        meshes: staticScene.sourceMeshCount,
        instances: staticScene.sourceInstanceCount,
        lights: staticScene.lightCount,
        truncated: staticScene.truncated,
        transparentSkipped: staticScene.skipped.transparent,
      };
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      state.nativeConfigured = await nativeRenderer.configure(buffer.x, buffer.y, staticScene, null);
      console.log(
        `[Morpho Iridescence RTX] registered=${state.nativeConfigured}` +
        ` · static=${staticScene.triangleCount.toLocaleString()} triangles` +
        ` · transmissive optics raster-only` +
        ` · scales=${world.stats().photonicScales.toLocaleString()}`,
      );
    } catch (error) {
      console.warn("[Morpho Iridescence RTX] Setup failed; WebGPU remains active: " + (error?.message || error));
    } finally {
      state.setupFinished = true;
    }
  })();

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("lostpointercapture", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    hud.dispose();
    nativeRenderer.dispose();
    world.dispose();
    environmentTarget.dispose();
    if (rtx && capabilities.reflex) {
      try { rtx.requestFeatures?.({ reflexMode: previousReflexMode }); } catch { /* adapter teardown */ }
    }
    renderer.dispose();
    delete globalThis.__MORPHO_IRIDESCENCE_X10000_DEMO__;
  }, { once: true });
}

await main();
