import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
import { createTidalDisruptionScene } from "./cosmic-scene.mjs";
import { createTidalDisruptionHud } from "./hud.mjs";
import { createSchwarzschildLensingNode } from "./lensing.mjs";
import { createTidalAudioController } from "./tidal-audio.mjs";
import {
  DEFAULT_SYSTEM,
  buildCaptureTrajectory,
  formatDuration,
} from "./relativity-model.mjs";

document.title = "RTX Tidal Rupture — ThreeBrowser Runtime";

const SCENE_SCALE = 0.15;
const ENCOUNTER_SECONDS = 72;
const SPEEDS = [0.5, 1, 2];
const MAX_INTERNAL_PIXELS = 5_200_000;
const MAX_INTERNAL_RATIO = 1.8;
const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));

function choosePixelRatio(width, height) {
  const displayRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  const pixelLimit = Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height));
  return Math.max(1, Math.min(MAX_INTERNAL_RATIO, displayRatio, pixelLimit));
}

function pointerNdc(event, element) {
  const rect = element.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("RTX Tidal Rupture requires the native WebGPU renderer.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#000000";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  const initialWidth = Math.max(1, innerWidth);
  const initialHeight = Math.max(1, innerHeight);
  renderer.setDrawingBufferSize(
    initialWidth,
    initialHeight,
    choosePixelRatio(initialWidth, initialHeight),
  );
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.autoClear = true;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error("RTX Tidal Rupture did not receive a WebGPU backend.");
  }
  renderer.backend.device?.addEventListener?.("uncapturederror", event => {
    renderer.setAnimationLoop(null);
    console.error("[RTX Tidal Rupture WebGPU]", event.error?.message || event.error || event);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  let rtxLabel = capabilities.rtx ? "RTX BRIDGE READY" : "WEBGPU HDR";
  if (capabilities.reflex) {
    try {
      rtx.requestFeatures?.({
        reflex: "boost",
        dlssSuperResolution: false,
        dlssFrameGeneration: false,
        dlssRayReconstruction: false,
      });
      const reflex = rtx.getStatus?.().features?.reflex;
      rtxLabel = reflex?.configured || reflex?.active ? "RTX REFLEX ACTIVE" : "RTX REFLEX READY";
    } catch (error) {
      console.warn(`[RTX Tidal Rupture] Reflex request failed: ${error?.message || error}`);
    }
  }
  console.log(
    `[RTX Tidal Rupture] adapter=${capabilities.adapterName || "unknown"}`
    + ` · RTX=${Boolean(capabilities.rtx)}`
    + ` · Reflex=${Boolean(capabilities.reflex)}`
    + " · gravitational light bending is project-owned Schwarzschild TSL math",
  );

  const scene = new THREE.Scene();
  scene.name = "RTX Tidal Rupture scene";
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(
    46,
    innerWidth / Math.max(1, innerHeight),
    0.025,
    420,
  );
  camera.position.set(4.8, 8.6, 25.5);
  camera.lookAt(0, 0, 0);
  scene.add(camera);

  const trajectory = buildCaptureTrajectory({
    startRadiusM: 118,
    stopRadiusM: 2.055,
    energy: 1,
    angularMomentumM: 3.98,
    stepM: 0.05,
    recordEvery: 4,
  });
  const cosmos = createTidalDisruptionScene(scene, {
    system: DEFAULT_SYSTEM,
    trajectory,
    sceneScale: SCENE_SCALE,
  });

  const hud = createTidalDisruptionHud();
  camera.add(hud.mesh);
  const sound = createTidalAudioController();
  sound.arm();

  const qaPostMode = String(globalThis.process?.env?.TIDAL_POST_MODE || "full").toLowerCase();
  if (globalThis.process?.env?.TIDAL_NO_HUD === "1") hud.setVisible(false);

  let renderPipeline = null;
  let scenePass = null;
  let bloomNode = null;
  let lensing = null;
  let postActive = qaPostMode !== "off";
  try {
    if (!postActive) throw new Error("post disabled by TIDAL_POST_MODE=off");
    renderPipeline = new THREE.RenderPipeline(renderer);
    scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode("output");
    lensing = createSchwarzschildLensingNode(sceneColor);
    if (qaPostMode === "lens") {
      renderPipeline.outputNode = lensing.output;
    } else {
      bloomNode = bloom(lensing.output, 1.18, 0.42, 0.68);
      renderPipeline.outputNode = lensing.output.add(bloomNode);
    }
  } catch (error) {
    postActive = false;
    if (qaPostMode !== "off") {
      console.warn(`[RTX Tidal Rupture] Relativistic compositor unavailable: ${error?.message || error}`);
    }
  }

  const state = {
    elapsed: 0,
    paused: false,
    speedIndex: 1,
    autoCamera: true,
    lensing: true,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    pointer: new THREE.Vector2(),
    azimuthTarget: 0.18,
    elevationTarget: 0.32,
    distanceTarget: 27,
    azimuth: 0.18,
    elevation: 0.32,
    distance: 27,
    preset: 0,
    fps: 60,
    soundEnabled: false,
  };

  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const projectedCenter = new THREE.Vector3();
  const projectedEdge = new THREE.Vector3();
  const edgePoint = new THREE.Vector3();
  const manualOffset = new THREE.Vector3();
  const presets = [
    { azimuth: 0.18, elevation: 0.32, distance: 27 },
    { azimuth: -0.62, elevation: 0.075, distance: 20 },
    { azimuth: 0.48, elevation: 0.22, distance: 11.8 },
  ];

  function positionHud() {
    const distance = 2;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * distance;
    const aspect = camera.aspect;
    hud.mesh.scale.setScalar(halfHeight);
    hud.mesh.position.set((-aspect + 1.06) * halfHeight, 0.755 * halfHeight, -distance);
  }

  function disableAutoCamera() {
    state.autoCamera = false;
  }

  function updateCamera(time, delta, telemetry) {
    const smoothing = 1 - Math.exp(-delta * 4.8);
    state.pointer.lerp(state.pointerTarget, smoothing);
    state.azimuth = THREE.MathUtils.lerp(state.azimuth, state.azimuthTarget, smoothing);
    state.elevation = THREE.MathUtils.lerp(state.elevation, state.elevationTarget, smoothing);
    state.distance = THREE.MathUtils.lerp(state.distance, state.distanceTarget, smoothing);

    if (state.autoCamera) {
      const separation = telemetry.starPosition.length();
      const closeness = 1 - clamp01((separation - 0.45) / 17.2);
      desiredTarget.copy(telemetry.starPosition).multiplyScalar(0.28 * (1 - closeness * 0.55));
      const orbit = 0.24 + time * 0.026 + closeness * 0.52;
      const distance = 25.8 - closeness * 10.2;
      desiredPosition.copy(desiredTarget).add(new THREE.Vector3(
        Math.sin(orbit) * (4.2 + closeness * 1.8),
        8.2 - closeness * 2.1 + Math.sin(time * 0.11) * 0.7,
        Math.cos(orbit) * 2.8 + distance,
      ));
      desiredPosition.x += state.pointer.x * 0.9;
      desiredPosition.y += state.pointer.y * 0.55;
      camera.fov = THREE.MathUtils.lerp(camera.fov, 46 - closeness * 4.5, smoothing * 0.55);
    } else {
      desiredTarget.set(0, 0, 0);
      if (state.preset === 0) desiredTarget.copy(telemetry.starPosition).multiplyScalar(0.22);
      const horizontal = Math.cos(state.elevation) * state.distance;
      manualOffset.set(
        Math.sin(state.azimuth) * horizontal,
        Math.sin(state.elevation) * state.distance,
        Math.cos(state.azimuth) * horizontal,
      );
      desiredPosition.copy(desiredTarget).add(manualOffset);
      camera.fov = THREE.MathUtils.lerp(camera.fov, state.preset === 2 ? 39 : 46, smoothing * 0.65);
    }
    camera.position.lerp(desiredPosition, smoothing * 0.72);
    lookTarget.lerp(desiredTarget, smoothing * 0.84);
    camera.lookAt(lookTarget);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    positionHud();
  }

  function updateLensingUniforms() {
    if (!lensing) return;
    projectedCenter.set(0, 0, 0).project(camera);
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    edgePoint.copy(cameraRight).multiplyScalar(SCENE_SCALE);
    projectedEdge.copy(edgePoint).project(camera);
    const centerX = projectedCenter.x * 0.5 + 0.5;
    const centerY = projectedCenter.y * 0.5 + 0.5;
    const edgeX = projectedEdge.x * 0.5 + 0.5;
    const edgeY = projectedEdge.y * 0.5 + 0.5;
    const aspect = innerWidth / Math.max(1, innerHeight);
    const dx = (edgeX - centerX) * aspect;
    const dy = edgeY - centerY;
    lensing.uniforms.center.value.set(centerX, centerY);
    lensing.uniforms.aspect.value = aspect;
    lensing.uniforms.massAngularRadius.value = Math.max(0.0002, Math.hypot(dx, dy));
    lensing.uniforms.angularToUv.value = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
    lensing.uniforms.strength.value = state.lensing ? 1 : 0;
    lensing.uniforms.ringExposure.value = state.lensing ? 1 : 0;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    state.pointerTarget.copy(pointerNdc(event, renderer.domElement));
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.previousPointer.set(event.clientX, event.clientY);
    state.azimuthTarget -= dx * 0.0042;
    state.elevationTarget = THREE.MathUtils.clamp(state.elevationTarget + dy * 0.0033, -0.12, 1.05);
    disableAutoCamera();
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.distanceTarget = THREE.MathUtils.clamp(
      state.distanceTarget + Math.sign(event.deltaY) * 1.25,
      8.2,
      42,
    );
    disableAutoCamera();
    event.preventDefault?.();
  }

  function soundStateLabel(status = sound.status()) {
    if (!status.available || status.error) return "SOUND UNAVAILABLE";
    if (!state.soundEnabled) return "SOUND OFF / M ENABLE";
    if (state.paused) return "SOUND PAUSED";
    return status.playing ? "SOUND ON / M MUTE" : "SOUND READY / M ENABLE";
  }

  async function startSound({ restart = false } = {}) {
    if (!state.soundEnabled) return false;
    const rate = SPEEDS[state.speedIndex];
    const started = restart
      ? await sound.restart({ rate })
      : await sound.start({ timeSeconds: state.elapsed, rate });
    if (!started) state.soundEnabled = false;
    return started;
  }

  async function toggleSound() {
    if (state.soundEnabled) {
      sound.pause();
      state.soundEnabled = false;
      return;
    }
    state.soundEnabled = true;
    await startSound();
  }

  async function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (event.code === "Space" || key === " ") {
      state.paused = !state.paused;
      if (state.paused) sound.pause();
      else await startSound();
      event.preventDefault?.();
      return;
    }
    if (key === "a") {
      state.autoCamera = !state.autoCamera;
      return;
    }
    if (key === "r") {
      state.elapsed = 0;
      state.paused = false;
      if (state.soundEnabled) await startSound({ restart: true });
      else sound.seek(0);
      return;
    }
    if (key === "t") {
      state.speedIndex = (state.speedIndex + 1) % SPEEDS.length;
      sound.setPlaybackRate(SPEEDS[state.speedIndex]);
      return;
    }
    if (key === "x") {
      state.lensing = !state.lensing;
      return;
    }
    if (key === "h") {
      hud.setVisible(!hud.visible);
      return;
    }
    if (key === "m") {
      await toggleSound();
      return;
    }
    const number = Number.parseInt(key, 10);
    if (Number.isInteger(number) && number >= 1 && number <= presets.length) {
      state.preset = number - 1;
      const preset = presets[state.preset];
      state.azimuthTarget = preset.azimuth;
      state.elevationTarget = preset.elevation;
      state.distanceTarget = preset.distance;
      disableAutoCamera();
    }
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);

  let viewportWidth = 0;
  let viewportHeight = 0;
  let viewportPixelRatio = 0;
  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const pixelRatio = choosePixelRatio(width, height);
    if (
      width === viewportWidth
      && height === viewportHeight
      && Math.abs(pixelRatio - viewportPixelRatio) < 1e-6
    ) return;
    viewportWidth = width;
    viewportHeight = height;
    viewportPixelRatio = pixelRatio;
    renderer.setDrawingBufferSize(width, height, pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    positionHud();
  }
  globalThis.addEventListener("resize", resize);
  resize();

  function disposePost() {
    bloomNode?.dispose?.();
    scenePass?.dispose?.();
    renderPipeline?.dispose?.();
    bloomNode = null;
    scenePass = null;
    renderPipeline = null;
  }

  function renderFrame() {
    // The native runtime owns one swap-chain texture per animation tick. Keep
    // scene, camera-attached HUD, lensing and bloom inside one final render.
    renderer.setRenderTarget(null);
    renderer.setMRT?.(null);
    if (postActive && renderPipeline) {
      try {
        renderPipeline.render();
      } catch (error) {
        postActive = false;
        renderer.setAnimationLoop(null);
        console.error(
          `[RTX Tidal Rupture] Render stopped on the last valid frame to preserve swap-chain ownership: ${error?.message || error}`,
        );
      }
      return;
    }
    renderer.render(scene, camera);
  }

  let previousTime = performance.now();
  let frameCounter = 0;
  let fpsAccumulator = 0;
  let telemetry = cosmos.update({ time: 0, progress: 0, camera });
  renderer.setAnimationLoop(now => {
    const delta = Math.min(0.05, Math.max(1 / 240, (now - previousTime) / 1000));
    previousTime = now;
    const soundStatus = sound.update();
    if (!state.paused && state.soundEnabled && soundStatus.playing) {
      state.elapsed = Math.min(ENCOUNTER_SECONDS, soundStatus.timeSeconds);
    } else if (!state.paused && state.elapsed < ENCOUNTER_SECONDS) {
      state.elapsed = Math.min(
        ENCOUNTER_SECONDS,
        state.elapsed + delta * SPEEDS[state.speedIndex],
      );
    }
    const linearProgress = clamp01(state.elapsed / ENCOUNTER_SECONDS);
    const pathProgress = Math.pow(linearProgress, 0.66);
    updateCamera(state.elapsed, delta, telemetry);
    telemetry = cosmos.update({
      time: state.elapsed,
      progress: pathProgress,
      camera,
    });
    updateLensingUniforms();

    fpsAccumulator += (1 / delta - fpsAccumulator) * 0.06;
    state.fps = fpsAccumulator;
    if ((frameCounter++ % 5) === 0) {
      const coordinateSeconds = telemetry.sample.coordinateTimeM * DEFAULT_SYSTEM.geometricTimeSeconds;
      hud.update({
        phase: linearProgress >= 1 ? "CAPTURE COMPLETE / PRESS R" : telemetry.phase,
        radiusSchwarzschild: telemetry.sample.rM * 0.5,
        speedFraction: telemetry.speedFraction,
        tidalStress: telemetry.envelope.stress,
        observedShift: telemetry.observedShift,
        coordinateTime: formatDuration(coordinateSeconds),
        progress: linearProgress,
        paused: state.paused,
        playbackRate: SPEEDS[state.speedIndex],
        rtxLabel: postActive ? rtxLabel : `${rtxLabel} / DIRECT`,
        lensing: state.lensing && postActive,
        autoCamera: state.autoCamera,
        fps: state.fps,
        soundState: soundStateLabel(soundStatus),
      });
    }
    renderFrame();
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
    if (rtx && capabilities.reflex) {
      try { rtx.requestFeatures?.({ reflexMode: previousReflexMode }); } catch { /* adapter teardown */ }
    }
    disposePost();
    sound.dispose();
    hud.dispose();
    cosmos.dispose();
    renderer.dispose();
  }, { once: true });
}

await main();
