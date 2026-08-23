import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createMoonwaterHud } from "./hud.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { collectStaticCoveScene } from "./rtx-scene.mjs";
import { buildMoonlitOcean, sampleOceanWaveHeight } from "./open-ocean-scene.mjs";

document.title = "RTX Moonlit Open Ocean — ThreeBrowser Runtime";

const MAX_INTERNAL_PIXELS = 5_300_000;
const MAX_INTERNAL_RATIO = 2.25;
const CAMERA_MODES = ["aerial", "deck", "wave"];
const DEBUG_LABELS = [
  "BEAUTY",
  "FRESNEL",
  "CAUSTICS",
  "NORMALS",
  "RAY DISTANCE",
];

function chooseInternalRatio(width, height) {
  // The presentation canvas owns display DPR. Expensive offscreen MRT/RTX
  // targets obey their own pixel budget so high-DPI displays cannot silently
  // multiply the internal render cost beyond the cap.
  const budgetRatio = Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height));
  return Math.min(MAX_INTERNAL_RATIO, budgetRatio);
}

function timeLabel() {
  return "MOONLIGHT";
}

function reportBridge(rtx, status) {
  if (!rtx) {
    console.warn("[Moonlit Ocean] RTX bridge unavailable; the JS/TSL WebGPU ocean remains active.");
    return;
  }
  const capabilities = status?.capabilities ?? rtx.capabilities ?? {};
  const native = status?.features?.nativeRayTracing;
  console.log(
    `[Moonlit Ocean] bridge=${capabilities.adapterName || "unknown"}` +
    ` · nativeRayTraversal=${Boolean(native?.supported ?? capabilities.nativeRayTracing)}` +
    ` · rayLighting=${typeof rtx.evaluateRayLighting === "function"}` +
    ` · rayReflections=${typeof rtx.evaluateRayReflections === "function"}`,
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Moonlit Open Ocean requires native WebGPU; there is no WebGL path.");
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
  renderer.setClearColor(0x020712, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // A moonlit sea is physically dim, but the viewer is adapted to darkness.
  // This exposure retains deep blacks while lifting mid-tone wave structure
  // into the mesopic range; the lunar disc and RTX emitter remain calibrated.
  renderer.toneMappingExposure = 1.26;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error("WebGPURenderer did not initialize its WebGPU backend.");
  }
  renderer.backend.device?.addEventListener?.("uncapturederror", event => {
    console.error("[Moonwater WebGPU validation]", event.error?.message || event.error || event);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  const featureRequest = { dlssFrameGeneration: false, dlssRayReconstruction: false };
  if (capabilities.reflex) featureRequest.reflex = "boost";
  const requestedStatus = rtx?.requestFeatures?.(featureRequest) ?? rtx?.status ?? null;
  const initialStatus = rtx?.getStatus?.() ?? requestedStatus;
  reportBridge(rtx, initialStatus);

  const scene = new THREE.Scene();
  scene.name = "RTX Moonlit Open Ocean world";
  scene.background = new THREE.Color(0x020711);
  scene.fog = new THREE.FogExp2(0x06121c, 0.0022);
  const camera = new THREE.PerspectiveCamera(
    52,
    innerWidth / Math.max(1, innerHeight),
    0.025,
    // The JS ocean fades through about 1.45 km of marine atmosphere. Keep the
    // camera frustum beyond that optical range so clipping never substitutes
    // a geometric line for the naturally extinct horizon.
    1800,
  );
  camera.position.set(3.0, 2.65, 24.0);
  camera.lookAt(-5.0, 0.0, -100.0);

  const ocean = buildMoonlitOcean(scene, renderer);
  prepareRtxGuideMaterials(scene);
  const internalSize = (scale = 1) => new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * internalRatio * scale)),
    Math.max(1, Math.round(innerHeight * internalRatio * scale)),
  );
  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx);
  let staticScene = null;
  if (rtx && (typeof rtx.evaluateRayLighting === "function" ||
      typeof rtx.evaluateRayReflections === "function")) {
    try {
      staticScene = collectStaticCoveScene(ocean.staticRoots, ocean.staticLights);
    } catch (error) {
      console.warn(`[Moonwater RTX] Static-scene collection failed: ${error?.message || error}`);
    }
  }
  const initialSize = internalSize();
  // Record compositor dimensions even when the optional native bridge is
  // absent. The ordinary HDR target itself remains lazy until fallback is used.
  nativeRenderer.resize(initialSize.x, initialSize.y);
  const nativeConfigured = staticScene
    ? await nativeRenderer.configure(initialSize.x, initialSize.y, staticScene)
    : false;

  const state = {
    cameraMode: "deck",
    timeFlow: true,
    rtxRequested: nativeConfigured,
    waves: true,
    waveEnergy: 1,
    debugMode: 0,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    lookOffset: new THREE.Vector2(),
    lookTarget: new THREE.Vector2(),
    pointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    dolly: 1,
    dollyTarget: 1,
    deckHeave: 0,
    deckPitch: 0,
    deckRoll: 0,
  };

  function useNativePath() {
    return Boolean(state.rtxRequested && nativeRenderer.enabled);
  }

  function setCameraMode(mode) {
    if (CAMERA_MODES.includes(mode)) state.cameraMode = mode;
  }

  function toggleRtx() {
    if (!nativeConfigured || !nativeRenderer.enabled) {
      state.rtxRequested = false;
      return;
    }
    state.rtxRequested = !state.rtxRequested;
  }

  function cycleDebug() {
    state.debugMode = (state.debugMode + 1) % DEBUG_LABELS.length;
  }

  function toggleWaves() {
    state.waves = !state.waves;
    state.waveEnergy = state.waves ? 1 : 0.12;
    ocean.setWaveEnergy(state.waveEnergy);
  }

  function handleControl(id) {
    if (CAMERA_MODES.includes(id)) setCameraMode(id);
    else if (id === "time") state.timeFlow = !state.timeFlow;
    else if (id === "rtx") toggleRtx();
    else if (id === "debug") cycleDebug();
    else if (id === "waves") toggleWaves();
  }

  const hud = createMoonwaterHud({
    renderer,
    callbacks: { onPress: handleControl },
  });

  function syncHud() {
    const available = nativeConfigured && nativeRenderer.enabled;
    let path = useNativePath() ? nativeRenderer.rayPathLabel : "WEBGPU REFRACTION + TSL CAUSTICS";
    if (useNativePath() && nativeRenderer.lastPath !== "raster-fallback") {
      path = nativeRenderer.lastPath.replaceAll("-", " ").toUpperCase();
    }
    hud.setState({
      cameraMode: state.cameraMode,
      timeFlow: state.timeFlow,
      rtxRequested: state.rtxRequested,
      rtxAvailable: available,
      waves: state.waves,
      debugMode: state.debugMode,
      path,
      timeLabel: timeLabel(),
      debugLabel: DEBUG_LABELS[state.debugMode],
    });
  }

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  function onPointerDown(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    state.pointerTarget.copy(pointerNdc(event));
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.previousPointer.set(event.clientX, event.clientY);
    state.lookTarget.x = THREE.MathUtils.clamp(state.lookTarget.x - dx * 0.0034, -0.82, 0.82);
    state.lookTarget.y = THREE.MathUtils.clamp(state.lookTarget.y + dy * 0.0027, -0.45, 0.48);
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.dollyTarget = THREE.MathUtils.clamp(
      state.dollyTarget + Math.sign(event.deltaY) * 0.075,
      0.72,
      1.34,
    );
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "1") setCameraMode("aerial");
    else if (key === "2") setCameraMode("deck");
    else if (key === "3") setCameraMode("wave");
    else if (key === "t") state.timeFlow = !state.timeFlow;
    else if (key === "x") toggleRtx();
    else if (key === "d") cycleDebug();
    else if (key === "w") toggleWaves();
    else if (key === "h") hud.toggleVisible();
    syncHud();
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);

  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const smoothedTarget = new THREE.Vector3(-5.0, 0.0, -100.0);
  const cameraBase = new THREE.Vector3();
  function updateCamera(time, delta) {
    const easing = 1 - Math.exp(-delta * 3.7);
    state.pointer.lerp(state.pointerTarget, 1 - Math.exp(-delta * 6));
    state.lookOffset.lerp(state.lookTarget, 1 - Math.exp(-delta * 5.4));
    state.dolly = THREE.MathUtils.lerp(state.dolly, state.dollyTarget, 1 - Math.exp(-delta * 5));

    if (state.cameraMode === "aerial") {
      cameraBase.set(
        29.0 + Math.sin(time * 0.050) * 5.2,
        23.5 + Math.sin(time * 0.075) * 0.55,
        51.0 + Math.cos(time * 0.043) * 2.4,
      );
      // A restrained drone-height view reveals the directional swell field
      // without tilting so far down that the Moon leaves frame. This is now a
      // genuinely different composition from the eye-height deck camera.
      // Look across the prevailing wind instead of almost directly down it.
      // The oblique bearing exposes the directional crest field and cloud
      // streets as depth-bearing diagonals rather than stacked screen-space
      // bands, while keeping the Moon on the left third of the composition.
      desiredTarget.set(15.0 + Math.sin(time * 0.036) * 2.4, 0.8, -108.0);
      camera.fov = THREE.MathUtils.lerp(camera.fov, 54, easing);
    } else if (state.cameraMode === "wave") {
      // Offset the waterline camera downwind of the Moon path. This keeps the
      // near reflection from clipping against the lower frame and makes the
      // buoy a useful depth/scale cue among the foreground swells.
      const x = 18.0 + Math.sin(time * 0.070) * 0.8;
      const z = 14.0 + Math.cos(time * 0.061) * 0.50;
      const surface = sampleOceanWaveHeight(x, z, time, state.waveEnergy);
      cameraBase.set(
        x,
        surface + 1.05,
        z,
      );
      desiredTarget.set(9.0 + Math.sin(time * 0.045) * 1.0, 0.30, -90.0);
      camera.fov = THREE.MathUtils.lerp(camera.fov, 60, easing);
    } else {
      const x = 3.0 + Math.sin(time * 0.055) * 1.0;
      const z = 24.0 + Math.cos(time * 0.047) * 0.5;
      desiredTarget.set(-8.0 + Math.sin(time * 0.038) * 1.3, 0.12, -104.0);

      // Treat the deck camera as a point on a small vessel rather than a
      // tripod attached to one wave vertex. Four hull-support samples derive
      // phase-correct heave, pitch and roll from the same JS wave spectrum;
      // asymmetric damping supplies the inertia of a real hull without
      // introducing a second authored motion signal.
      let forwardX = desiredTarget.x - x;
      let forwardZ = desiredTarget.z - z;
      const forwardLength = Math.hypot(forwardX, forwardZ) || 1;
      forwardX /= forwardLength;
      forwardZ /= forwardLength;
      const rightX = -forwardZ;
      const rightZ = forwardX;
      const bow = sampleOceanWaveHeight(
        x + forwardX * 2.4,
        z + forwardZ * 2.4,
        time,
        state.waveEnergy,
      );
      const stern = sampleOceanWaveHeight(
        x - forwardX * 2.4,
        z - forwardZ * 2.4,
        time,
        state.waveEnergy,
      );
      const port = sampleOceanWaveHeight(
        x - rightX * 1.1,
        z - rightZ * 1.1,
        time,
        state.waveEnergy,
      );
      const starboard = sampleOceanWaveHeight(
        x + rightX * 1.1,
        z + rightZ * 1.1,
        time,
        state.waveEnergy,
      );
      const targetHeave = (bow + stern + port + starboard) * 0.25 * 0.65;
      const targetPitch = THREE.MathUtils.clamp(
        Math.atan2(bow - stern, 4.8) * 0.55,
        -THREE.MathUtils.degToRad(0.8),
        THREE.MathUtils.degToRad(0.8),
      );
      const targetRoll = THREE.MathUtils.clamp(
        Math.atan2(starboard - port, 2.2) * 0.45,
        -THREE.MathUtils.degToRad(1.15),
        THREE.MathUtils.degToRad(1.15),
      );
      state.deckHeave = THREE.MathUtils.lerp(
        state.deckHeave,
        targetHeave,
        1 - Math.exp(-delta * 1.2),
      );
      state.deckPitch = THREE.MathUtils.lerp(
        state.deckPitch,
        targetPitch,
        1 - Math.exp(-delta * 0.9),
      );
      state.deckRoll = THREE.MathUtils.lerp(
        state.deckRoll,
        targetRoll,
        1 - Math.exp(-delta * 0.85),
      );
      cameraBase.set(x, 2.65 + state.deckHeave, z);
      camera.fov = THREE.MathUtils.lerp(camera.fov, 50, easing);
    }

    if (state.cameraMode !== "deck") {
      state.deckHeave = THREE.MathUtils.lerp(
        state.deckHeave,
        0,
        1 - Math.exp(-delta * 1.2),
      );
      state.deckPitch = THREE.MathUtils.lerp(
        state.deckPitch,
        0,
        1 - Math.exp(-delta * 0.9),
      );
      state.deckRoll = THREE.MathUtils.lerp(
        state.deckRoll,
        0,
        1 - Math.exp(-delta * 0.85),
      );
    }

    desiredPosition.copy(cameraBase);
    desiredPosition.x += state.lookOffset.x * 3.2 + state.pointer.x * 0.10;
    desiredPosition.y += state.lookOffset.y * 1.15 + state.pointer.y * 0.05;
    const targetDistance = desiredPosition.distanceTo(desiredTarget);
    desiredPosition.lerp(desiredTarget, 1 - state.dolly);
    if (targetDistance < 0.1) desiredPosition.copy(cameraBase);
    desiredTarget.x -= state.lookOffset.x * 4.0;
    desiredTarget.y -= state.lookOffset.y * 2.0;
    camera.position.lerp(desiredPosition, easing);
    smoothedTarget.lerp(desiredTarget, easing * 1.15);
    camera.lookAt(smoothedTarget);
    if (state.cameraMode === "deck") {
      camera.rotateX(state.deckPitch);
      camera.rotateZ(state.deckRoll);
    }
    camera.updateProjectionMatrix();
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    internalRatio = chooseInternalRatio(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    hud.resize(width, height);
    const size = internalSize(state.debugMode === 0 ? 1 : 0.78);
    nativeRenderer.resize(size.x, size.y);
    if (!nativeRenderer.enabled) state.rtxRequested = false;
    syncHud();
  }
  globalThis.addEventListener("resize", resize);
  resize();

  let previousTime = performance.now();
  let elapsed = 0;
  let diagnosticTime = 0;
  let diagnosticFrames = 0;
  let diagnosticWallTime = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.05, wallDelta);
    previousTime = now;
    if (state.timeFlow) elapsed += delta;
    diagnosticTime += delta;
    diagnosticFrames += 1;
    diagnosticWallTime += wallDelta;

    updateCamera(elapsed, delta);

    const nativeRequested = useNativePath();
    ocean.setNativeMode(nativeRequested);
    const frame = ocean.update(elapsed, delta, 1, camera, state.debugMode);

    renderer.info.reset();
    let nativeRendered = false;
    let offscreenRendered = false;
    if (nativeRequested) {
      nativeRendered = nativeRenderer.render(scene, camera, {
        celestialDirection: frame.celestialDirection,
        celestialIntensity: frame.celestialIntensity,
        maxDistance: 160,
      });
    }
    if (!nativeRendered) {
      // Native evaluation is optional. Restore the JS/TSL surface immediately
      // and use the same offscreen compositor whether RTX was toggled off,
      // failed this frame, or never existed on this host.
      if (nativeRequested && !nativeRenderer.enabled) state.rtxRequested = false;
      ocean.setNativeMode(false);
      offscreenRendered = nativeRenderer.renderRaster(scene, camera);
    }

    if (nativeRendered || offscreenRendered) {
      const hudTexture = hud.renderToTexture();
      if (!nativeRenderer.present(hudTexture, state.debugMode)) {
        nativeRendered = false;
        offscreenRendered = false;
      }
    }
    if (!nativeRendered && !offscreenRendered) {
      // Emergency-only direct path. Normal native and raster frames both make
      // exactly one final canvas render through NativeRtxRenderer.
      ocean.setNativeMode(false);
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.clearDepth();
      hud.render();
    }
    syncHud();

    if (diagnosticTime >= 7) {
      diagnosticTime = 0;
      const fps = diagnosticWallTime > 0 ? Math.round(diagnosticFrames / diagnosticWallTime) : 0;
      const renderInfo = renderer.info?.render ?? {};
      const size = nativeRendered || offscreenRendered
        ? new THREE.Vector2(nativeRenderer.width, nativeRenderer.height)
        : renderer.getDrawingBufferSize(new THREE.Vector2());
      console.log(
        `[Moonlit Ocean] fps=${fps}` +
        ` · calls=${renderInfo.drawCalls ?? renderInfo.calls ?? 0}` +
        ` · triangles=${Number(renderInfo.triangles ?? 0).toLocaleString()}` +
        ` · internal=${size.x}x${size.y}@${internalRatio.toFixed(2)}` +
        ` · camera=${state.cameraMode}` +
        ` · light=${timeLabel()}` +
        ` · path=${nativeRendered || offscreenRendered ? nativeRenderer.lastPath : "webgpu-fallback"}` +
        ` · debug=${DEBUG_LABELS[state.debugMode]}`,
      );
      diagnosticFrames = 0;
      diagnosticWallTime = 0;
    }
  });

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    hud.dispose();
    nativeRenderer.dispose();
    ocean.dispose();
    if (rtx && capabilities.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    renderer.dispose();
  });

  console.log(
    "[Moonlit Ocean] Ready: JS/TSL directional wind sea, procedural moonlit sky, curvature foam, " +
    "three above-water cameras, a distant navigation buoy and optional generic RTX visibility/reflections.",
  );
}

await main();
