import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";

import { createUniverseEyeScene } from "./eye-scene.mjs";
import { UNIVERSE_EYE_SEED } from "./universe-eye-model.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { collectStaticRtxScene } from "./rtx-scene.mjs";

document.title = "RTX Universe Eye ×1000 — ThreeBrowser Runtime";

const PIXEL_RATIO_CAP = 1.5;
const MIN_MAGNIFICATION = 1;
const MAX_MAGNIFICATION = 1000;
const BASE_FOV_DEGREES = 35;
const BASE_TARGET = new THREE.Vector3(0, 0, 1.4);
const HERO_TARGET = new THREE.Vector3(3.54, 1.28, 11.96);
const scratchColor = new THREE.Color();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value), 0, 1);
}

function smoothUnit(value) {
  const unit = clamp01(value);
  return unit * unit * (3 - 2 * unit);
}

function createEyeEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x030710);
  const owned = [];

  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x07101d,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 24), shellMaterial);
  environmentScene.add(shell);
  owned.push(shell.geometry, shellMaterial);

  const cards = [
    { color: 0xd8efff, energy: 11, size: [10, 16], position: [-18, 17, 22], rotation: [0, Math.PI * 0.68, -0.08] },
    { color: 0x6ea6ff, energy: 6, size: [6, 14], position: [18, -2, 18], rotation: [0, -Math.PI * 0.64, 0.08] },
    { color: 0xff9d8b, energy: 4.5, size: [12, 5], position: [13, 14, -16], rotation: [0, -0.4, 0] },
    { color: 0x2f5fff, energy: 2.6, size: [22, 4], position: [-3, -18, 4], rotation: [Math.PI * 0.46, 0, 0] },
    { color: 0xffffff, energy: 9, size: [3, 3], position: [-4, 5, 25], rotation: [0, Math.PI, 0] },
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
    { size: 512, position: new THREE.Vector3(0, 0, 3) },
  );
  generator.dispose();
  for (const resource of owned) resource.dispose?.();
  return target;
}

async function loadGeneratedTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const [irisTexture, scleraTexture] = await Promise.all([
    loader.loadAsync(new URL("../assets/universe-spiral-iris.png", import.meta.url).href),
    loader.loadAsync(new URL("../assets/sclera-microvascular.png", import.meta.url).href),
  ]);
  const maxAnisotropy = Math.min(16, finite(renderer.backend?.device?.limits?.maxSamplerAnisotropy, 16));
  for (const texture of [irisTexture, scleraTexture]) {
    texture.anisotropy = maxAnisotropy;
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  irisTexture.name = "ImageGen universe-spiral blue iris albedo";
  scleraTexture.name = "ImageGen ivory microvascular sclera albedo";
  return { irisTexture, scleraTexture };
}

function createHud() {
  const root = document.createElement("div");
  root.setAttribute("aria-label", "Universe Eye X1000 renderer and biology status");
  Object.assign(root.style, {
    position: "fixed",
    left: "clamp(14px,2.2vw,38px)",
    top: "clamp(14px,2.2vw,34px)",
    zIndex: "10",
    color: "#e8f7ff",
    fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace",
    textShadow: "0 0 18px rgba(77,167,255,.82)",
    pointerEvents: "none",
    userSelect: "none",
    letterSpacing: ".08em",
  });

  const title = document.createElement("div");
  title.textContent = "UNIVERSE EYE  ·  RTX ×1000";
  Object.assign(title.style, {
    fontSize: "clamp(14px,1.32vw,23px)",
    fontWeight: "850",
    letterSpacing: ".18em",
  });
  const status = document.createElement("div");
  Object.assign(status.style, {
    marginTop: "7px",
    color: "#9fdcff",
    fontSize: "clamp(9px,.72vw,12px)",
    lineHeight: "1.68",
    whiteSpace: "pre-line",
  });
  const controls = document.createElement("div");
  controls.textContent = "MOVE GAZE / LIGHT  ·  DRAG ORBIT  ·  WHEEL ×1–×1000\nSPACE BLINK  ·  L LIGHT RIG  ·  P PAUSE BIOLOGY  ·  X RTX  ·  R RESET";
  Object.assign(controls.style, {
    marginTop: "9px",
    padding: "8px 11px",
    borderLeft: "2px solid rgba(82,190,255,.82)",
    background: "linear-gradient(90deg,rgba(2,9,20,.76),rgba(2,9,20,0))",
    color: "rgba(225,245,255,.78)",
    fontSize: "clamp(8px,.62vw,10px)",
    lineHeight: "1.68",
    whiteSpace: "pre-line",
  });
  root.append(title, status, controls);
  document.body.append(root);

  return Object.freeze({
    update(worldStats, renderStatus, state) {
      const path = String(renderStatus.lastPresentedPath ?? renderStatus.lastPath ?? "starting")
        .replaceAll("-", " ").toUpperCase();
      const native = state.nativeConfigured && !state.forceRaster ? "NATIVE RAYS" : "EXACT WEBGPU";
      status.textContent =
        `DETAIL ×${Math.max(1, Math.round(state.magnification)).toLocaleString()}  ·  ${native}  ·  ${path}\n` +
        `${worldStats.stromalFibres.toLocaleString()} STROMAL FIBRES  ·  PUPIL ${worldStats.pupilRadiusMm.toFixed(2)} MM  ·  IOR ${worldStats.cornealIor.toFixed(3)}\n` +
        `${worldStats.studioRigName}  ·  ${state.paused ? "BIOLOGY FROZEN" : "MICROSACCADES LIVE"}  ·  SEED ${worldStats.seedHex}`;
    },
    dispose() { root.remove(); },
  });
}

async function main() {
  if (!WebGPU.isAvailable()) throw new Error("RTX Universe Eye ×1000 requires WebGPU.");

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#02050b";

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
  renderer.setClearColor(0x02050b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
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
    throw new Error("Universe Eye did not receive the native WebGPU backend.");
  }

  const validationErrors = [];
  renderer.backend.device.addEventListener?.("uncapturederror", event => {
    const message = event.error?.message || String(event.error || event);
    validationErrors.push(message);
    console.error("[Universe Eye WebGPU]", message);
  });

  const scene = new THREE.Scene();
  scene.name = "Ultra-realistic generated-texture universe eye";
  scene.background = new THREE.Color(0x02050b);
  scene.fog = new THREE.FogExp2(0x050814, 0.0065);

  const camera = new THREE.PerspectiveCamera(
    BASE_FOV_DEGREES,
    innerWidth / Math.max(1, innerHeight),
    0.0005,
    160,
  );
  camera.position.set(0, 0, 43);
  camera.lookAt(BASE_TARGET);

  const textures = await loadGeneratedTextures(renderer);
  const environmentTarget = createEyeEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1.08;

  const eyeWorld = createUniverseEyeScene(scene, {
    ...textures,
    seed: UNIVERSE_EYE_SEED,
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
    console.warn("[Universe Eye RTX] Feature request rejected: " + (error?.message || error));
  }

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
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    magnification: 1,
    targetMagnification: 1,
    studioRig: 0,
    keyBase: eyeWorld.lights[0].position.clone(),
    forceRaster: false,
    nativeConfigured: false,
    setupFinished: false,
    staticSceneStats: null,
    lastHudTime: -Infinity,
  };

  function resetExperience() {
    state.elapsed = 0;
    state.paused = false;
    state.targetYaw = 0;
    state.targetPitch = 0;
    state.targetMagnification = 1;
    state.pointer.set(0, 0);
    state.gaze.set(0, 0);
    state.studioRig = 0;
    eyeWorld.reset();
    eyeWorld.setPaused(false);
    state.keyBase.copy(eyeWorld.lights[0].position);
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
    state.targetYaw = THREE.MathUtils.clamp(state.targetYaw - dx * 0.0036, -0.82, 0.82);
    state.targetPitch = THREE.MathUtils.clamp(state.targetPitch + dy * 0.0029, -0.5, 0.5);
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
      eyeWorld.triggerBlink(event.shiftKey ? 0.52 : 0.34);
    } else if (key === "l") {
      state.studioRig = (state.studioRig + 1) % 3;
      eyeWorld.setStudioRig(state.studioRig);
      state.keyBase.copy(eyeWorld.lights[0].position);
    } else if (key === "p") {
      state.paused = !state.paused;
      eyeWorld.setPaused(state.paused);
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

  const desiredTarget = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  function updateCamera(delta) {
    const response = 1 - Math.exp(-Math.min(0.08, Math.max(0, delta)) * 7.2);
    state.yaw = THREE.MathUtils.lerp(state.yaw, state.targetYaw, response);
    state.pitch = THREE.MathUtils.lerp(state.pitch, state.targetPitch, response);
    const currentLog = Math.log(Math.max(1, state.magnification));
    const targetLog = Math.log(Math.max(1, state.targetMagnification));
    state.magnification = Math.exp(THREE.MathUtils.lerp(currentLog, targetLog, response));

    const zoomUnit = clamp01(Math.log10(state.magnification) / 3);
    const targetBlend = smoothUnit(THREE.MathUtils.clamp((zoomUnit - 0.18) / 0.54, 0, 1));
    desiredTarget.copy(BASE_TARGET).lerp(HERO_TARGET, targetBlend);
    const distance = THREE.MathUtils.lerp(41.5, 22, smoothUnit(zoomUnit));
    spherical.set(distance, Math.PI * 0.5 + state.pitch, state.yaw);
    desiredPosition.setFromSpherical(spherical).add(desiredTarget);
    camera.position.lerp(desiredPosition, response);
    const baseDistance = 41.5;
    const baseHeight = 2 * baseDistance * Math.tan(THREE.MathUtils.degToRad(BASE_FOV_DEGREES * 0.5));
    const desiredHeight = baseHeight / state.magnification;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(desiredHeight / (2 * distance)));
    camera.fov = THREE.MathUtils.lerp(camera.fov, THREE.MathUtils.clamp(fov, 0.035, BASE_FOV_DEGREES), response);
    camera.updateProjectionMatrix();
    camera.lookAt(desiredTarget);
  }

  function snapshot() {
    return Object.freeze({
      title: document.title,
      seed: UNIVERSE_EYE_SEED,
      world: eyeWorld.stats(),
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

  globalThis.__UNIVERSE_EYE_X1000_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      blink: duration => eyeWorld.triggerBlink(duration),
      pause(value = true) {
        state.paused = Boolean(value);
        eyeWorld.setPaused(state.paused);
        return state.paused;
      },
      gaze(x = 0, y = 0) {
        state.gaze.set(finite(x), finite(y)).clampLength(0, 0.82);
        return state.gaze.toArray();
      },
      magnify(value = 1) {
        state.targetMagnification = THREE.MathUtils.clamp(finite(value, 1), 1, 1000);
        return state.targetMagnification;
      },
      studio(value = state.studioRig + 1) {
        state.studioRig = ((Math.trunc(finite(value)) % 3) + 3) % 3;
        const result = eyeWorld.setStudioRig(state.studioRig);
        state.keyBase.copy(eyeWorld.lights[0].position);
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
    console.warn("[Universe Eye] Shader prewarm deferred: " + (error?.message || error));
  });

  let previousTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min(0.075, Math.max(0, (now - previousTime) / 1000));
    previousTime = now;
    state.elapsed += delta;

    const rigLuminance = [0.62, 0.82, 0.42][state.studioRig] ?? 0.62;
    eyeWorld.update(delta, {
      gazeX: state.gaze.x,
      gazeY: state.gaze.y,
      luminance: rigLuminance + state.pointer.y * 0.06,
    });
    eyeWorld.lights[0].position.x = state.keyBase.x + state.pointer.x * 4.5;
    eyeWorld.lights[0].position.y = state.keyBase.y + state.pointer.y * 3.2;
    updateCamera(delta);

    let staged = false;
    if (state.nativeConfigured && !state.forceRaster) {
      const worldStats = eyeWorld.stats();
      scratchColor.setHex([0x193b63, 0x203c54, 0x251b4f][state.studioRig] ?? 0x193b63)
        .convertSRGBToLinear();
      staged = nativeRenderer.renderNative(scene, camera, {
        directionalLightDirection: [-0.36 + state.pointer.x * 0.08, 0.78, -0.5],
        directionalLightIntensity: 0.16 + rigLuminance * 0.08,
        reflectionStrength: 0.34 + worldStats.blink * 0.04,
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
      console.error("[Universe Eye] Single-surface presentation failed.");
    }

    if (state.elapsed - state.lastHudTime >= 0.1) {
      state.lastHudTime = state.elapsed;
      hud.update(eyeWorld.stats(), nativeRenderer.status(), state);
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
      console.warn("[Universe Eye RTX] Native bridge unavailable; exact WebGPU remains active.");
      return;
    }
    try {
      const staticScene = await collectStaticRtxScene(eyeWorld.opaqueRoots, {
        maxTriangles: 420_000,
        lights: eyeWorld.lights,
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
        `[Universe Eye RTX] registered=${state.nativeConfigured}` +
        ` · static=${staticScene.triangleCount.toLocaleString()} triangles` +
        ` · transparent optics raster-only` +
        ` · fibres=${eyeWorld.stats().stromalFibres.toLocaleString()}`,
      );
    } catch (error) {
      console.warn("[Universe Eye RTX] Setup failed; WebGPU remains active: " + (error?.message || error));
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
    eyeWorld.dispose();
    environmentTarget.dispose();
    if (rtx && capabilities.reflex) {
      try { rtx.requestFeatures?.({ reflexMode: previousReflexMode }); } catch { /* adapter teardown */ }
    }
    renderer.dispose();
    delete globalThis.__UNIVERSE_EYE_X1000_DEMO__;
  }, { once: true });
}

await main();
