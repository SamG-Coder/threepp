import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";

import { createMercuryBassController } from "./bass-shocks.mjs";
import { MercuryPoolModel } from "./mercury-model.mjs";
import { createMercurySurface } from "./mercury.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { createNeonMirrorRoom } from "./room.mjs";
import { collectStaticRtxScene } from "./rtx-scene.mjs";

document.title = "RTX Neon Mercury Mirror Room — ThreeBrowser Runtime";

const DISPLAY_PIXEL_RATIO_CAP = 1.25;
const CAMERA_BASE_POSITION = new THREE.Vector3(0, 1.70, 2.90);
const CAMERA_BASE_TARGET = new THREE.Vector3(0, 0.78, -1.48);

function createFallbackEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x030207);
  const owned = [];
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x101017,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), shellMaterial);
  shell.position.y = 2;
  environmentScene.add(shell);
  owned.push(shell.geometry, shellMaterial);

  const cards = [
    { color: 0x21e6ff, intensity: 6.0, size: [0.36, 5.5], position: [-4.8, 2.3, -1], rotation: [0, Math.PI * 0.5, 0] },
    { color: 0xff25ad, intensity: 5.6, size: [0.36, 5.5], position: [4.8, 2.1, 0.8], rotation: [0, -Math.PI * 0.5, 0] },
    { color: 0x9255ff, intensity: 4.4, size: [7.0, 0.3], position: [0, 5.1, -2.4], rotation: [Math.PI * 0.5, 0, 0] },
    { color: 0xffa229, intensity: 4.7, size: [4.5, 0.24], position: [0, 1.4, -5.5], rotation: [0, 0, 0] },
  ];
  for (const card of cards) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(card.color).multiplyScalar(card.intensity),
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
    0.025,
    0.05,
    24,
    { size: 192, position: new THREE.Vector3(0, 1.5, 0) },
  );
  generator.dispose();
  for (const value of owned) value.dispose?.();
  return target;
}

function pointerNdc(element, event, target = new THREE.Vector2()) {
  const rect = element.getBoundingClientRect();
  return target.set(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("RTX Neon Mercury Mirror Room requires native WebGPU.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#020105";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  renderer.setPixelRatio(Math.min(
    DISPLAY_PIXEL_RATIO_CAP,
    Math.max(1, Number(globalThis.devicePixelRatio || 1)),
  ));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x020105, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
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
  if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
    throw new Error("WebGPURenderer did not initialize the native WebGPU backend.");
  }

  const validationErrors = [];
  renderer.backend.device.addEventListener?.("uncapturederror", event => {
    const message = event.error?.message || String(event.error || event);
    validationErrors.push(message);
    console.error("[Neon Mercury WebGPU]", message);
  });

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
    console.warn("[Neon Mercury RTX] Feature request rejected: " + (error?.message || error));
  }

  const scene = new THREE.Scene();
  scene.name = "Sealed neon mirror chamber with molten gold mercury";
  scene.background = new THREE.Color(0x020105);
  const camera = new THREE.PerspectiveCamera(
    66,
    innerWidth / Math.max(1, innerHeight),
    0.035,
    55,
  );
  camera.position.copy(CAMERA_BASE_POSITION);
  camera.lookAt(CAMERA_BASE_TARGET);

  const room = createNeonMirrorRoom(scene, renderer);
  const roomRoot = room.root ?? room.group;
  if (roomRoot && roomRoot.parent !== scene) scene.add(roomRoot);
  const fallbackEnvironmentTarget = room.environment
    ? null
    : createFallbackEnvironment(renderer);
  scene.environment = room.environment ?? fallbackEnvironmentTarget.texture;
  scene.environmentIntensity = 0.86;

  const model = new MercuryPoolModel();
  const authoredSurfaceY = Number(room.bounds?.pool?.surfaceY);
  const baseY = Number.isFinite(authoredSurfaceY)
    ? authoredSurfaceY - model.meanDepth
    : 0.02;
  const mercury = createMercurySurface({ model, baseY });
  scene.add(mercury.group);
  prepareRtxGuideMaterials(scene);
  const bassAudio = createMercuryBassController({ model });
  void bassAudio.play().then(started => {
    const audio = bassAudio.status();
    if (started && audio.available) {
      console.log("[Neon Mercury Audio] native synthwave transport started.");
    } else {
      console.warn(
        "[Neon Mercury Audio] native playback unavailable" +
        (audio.error ? ": " + audio.error : "; cue transport was not exposed."),
      );
    }
  });

  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx, {
    timeoutMs: 30_000,
    maxDistance: 52,
    rayBias: 0.0035,
    aoRadius: 1.1,
    aoStrength: 0.18,
    reflectionDistance: 48,
    reflectionRayBias: 0.0045,
    reflectionStrength: 1.08,
    roughnessCutoff: 0.48,
  });
  const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  nativeRenderer.resize(bufferSize.x, bufferSize.y);

  const state = {
    paused: false,
    forceRaster: false,
    dragging: false,
    pointerTarget: new THREE.Vector2(),
    pointer: new THREE.Vector2(),
    previousPointer: new THREE.Vector2(),
    cameraTarget: CAMERA_BASE_TARGET.clone(),
    elapsed: 0,
    fps: 0,
    nativeConfigured: false,
    setupFinished: false,
    staticSceneStats: null,
    dynamicMeshDirty: true,
  };

  function applyPointerWeight() {
    // Pointer input is an apparent gravity vector, not a direct height edit.
    // The model filters it through dense-fluid inertia before it reaches the
    // finite-volume momentum step.
    model.setPointer?.(
      THREE.MathUtils.clamp(state.pointerTarget.x, -1, 1),
      THREE.MathUtils.clamp(-state.pointerTarget.y, -1, 1),
      { weight: state.dragging ? 1.32 : 1 },
    );
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    pointerNdc(renderer.domElement, event, state.pointerTarget);
    applyPointerWeight();
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    pointerNdc(renderer.domElement, event, state.pointerTarget);
    applyPointerWeight();
    if (state.dragging) state.previousPointer.set(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    state.dragging = false;
    applyPointerWeight();
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onPointerLeave() {
    if (state.dragging) return;
    state.pointerTarget.set(0, 0);
    applyPointerWeight();
  }

  function resetMercury() {
    model.reset();
    state.pointerTarget.set(0, 0);
    state.pointer.set(0, 0);
    state.elapsed = 0;
    state.paused = false;
    void bassAudio.restart();
    applyPointerWeight();
    const changed = mercury.update(0);
    if (changed) state.dynamicMeshDirty = true;
    return model.stats();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      state.paused = !state.paused;
      if (state.paused) bassAudio.pause();
      else void bassAudio.play();
    } else if (event.key.toLowerCase() === "r") {
      resetMercury();
    } else if (event.key.toLowerCase() === "x") {
      state.forceRaster = !state.forceRaster;
    }
  }

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
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("resize", resize);

  function updateCamera(delta) {
    const response = 1 - Math.exp(-Math.min(0.05, Math.max(0, delta)) * 7.4);
    state.pointer.lerp(state.pointerTarget, response);

    // Hard-coded interior limits are deliberately much tighter than the room.
    // Mouse movement supplies head parallax and look direction only; there is
    // no orbit, dolly, free-flight, or path that can cross a wall.
    const desiredPosition = new THREE.Vector3(
      THREE.MathUtils.clamp(state.pointer.x * 0.11, -0.12, 0.12),
      THREE.MathUtils.clamp(1.70 + state.pointer.y * 0.055, 1.63, 1.77),
      THREE.MathUtils.clamp(2.90 - Math.abs(state.pointer.x) * 0.025, 2.86, 2.91),
    );
    const desiredTarget = new THREE.Vector3(
      THREE.MathUtils.clamp(state.pointer.x * 0.76, -0.82, 0.82),
      THREE.MathUtils.clamp(0.78 + state.pointer.y * 0.48, 0.30, 1.30),
      -1.48,
    );
    camera.position.lerp(desiredPosition, response * 0.74);
    state.cameraTarget.lerp(desiredTarget, response * 0.86);
    camera.lookAt(state.cameraTarget);
  }

  function snapshot() {
    const roomStats = typeof room.stats === "function" ? room.stats() : room.stats;
    return {
      title: document.title,
      simulation: { ...model.stats() },
      audio: bassAudio.status(),
      mercury: mercury.stats(),
      room: roomStats ? { ...roomStats } : null,
      camera: {
        lockedInsideRoom: true,
        position: camera.position.toArray(),
        target: state.cameraTarget.toArray(),
      },
      render: {
        fps: state.fps,
        forceRaster: state.forceRaster,
        buffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
      },
      rtx: {
        setupFinished: state.setupFinished,
        nativeConfigured: state.nativeConfigured,
        staticScene: state.staticSceneStats ? { ...state.staticSceneStats } : null,
        renderer: nativeRenderer.status(),
      },
      validationErrors: [...validationErrors],
    };
  }

  globalThis.__NEON_MERCURY_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      pause(value = true) {
        state.paused = Boolean(value);
        if (state.paused) bassAudio.pause();
        else void bassAudio.play();
        return state.paused;
      },
      resume() {
        state.paused = false;
        void bassAudio.play();
      },
      reset: resetMercury,
      setWeight(x = 0, z = 0) {
        state.pointerTarget.set(
          THREE.MathUtils.clamp(Number(x) || 0, -1, 1),
          THREE.MathUtils.clamp(-(Number(z) || 0), -1, 1),
        );
        applyPointerWeight();
        return state.pointerTarget.toArray();
      },
      compareRaster(value = true) {
        state.forceRaster = Boolean(value);
        return state.forceRaster;
      },
    }),
  });

  renderer.compileAsync?.(scene, camera)?.catch?.(error => {
    console.warn("[Neon Mercury] Shader prewarm deferred: " + (error?.message || error));
  });

  let previousTime = performance.now();
  let diagnosticSeconds = 0;
  let diagnosticWallSeconds = 0;
  let diagnosticFrames = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const frameDelta = Math.min(0.10, wallDelta);
    previousTime = now;
    diagnosticWallSeconds += wallDelta;
    diagnosticFrames += 1;

    if (!state.paused) bassAudio.poll();
    if (!state.paused && frameDelta > 0) {
      model.advance(frameDelta);
      state.elapsed += frameDelta;
    }
    updateCamera(frameDelta);
    const mercuryChanged = mercury.update(state.elapsed);
    if (mercuryChanged) state.dynamicMeshDirty = true;
    room.update?.(state.elapsed, frameDelta);

    let staged = false;
    if (state.nativeConfigured && !state.forceRaster) {
      if (state.dynamicMeshDirty && nativeRenderer.updateDynamicTriangleMesh()) {
        state.dynamicMeshDirty = false;
      }
      staged = nativeRenderer.renderNative(scene, camera, {
        reflectionStrength: 1.08,
        reflectionDistance: 48,
        maxDistance: 52,
        rayBias: 0.0035,
        roughnessCutoff: 0.48,
        environmentColor: [0.004, 0.002, 0.009],
        environmentIntensity: 0.22,
        highQuality: true,
      });
      if (!staged && !nativeRenderer.status().configured) {
        state.nativeConfigured = false;
        console.warn("[Neon Mercury RTX] Native transport stopped; raster staging restored.");
      }
    }
    if (!staged) staged = nativeRenderer.renderRaster(scene, camera);
    if (staged && !nativeRenderer.present()) {
      // Never issue a second canvas render: present() is the only swapchain
      // boundary and may have reached it before the host surfaced an error.
      console.error("[Neon Mercury] Single-surface presentation failed.");
    }

    diagnosticSeconds += frameDelta;
    if (diagnosticSeconds >= 6) {
      diagnosticSeconds = 0;
      state.fps = diagnosticWallSeconds > 0
        ? diagnosticFrames / diagnosticWallSeconds
        : 0;
      const simulation = model.stats();
      const native = nativeRenderer.status();
      const audio = bassAudio.status();
      console.log(
        "[Neon Mercury] fps=" + Math.round(state.fps) +
        " · volumeError=" + finiteStat(simulation.volumeError, 0).toExponential(2) + "m³" +
        " · speed=" + finiteStat(simulation.maximumSpeed, 0).toFixed(3) + "m/s" +
        " · audioTime=" + finiteStat(audio.currentTime, 0).toFixed(2) + "s" +
        " · shocks=" + Math.trunc(finiteStat(audio.shockCount, 0)) +
        " · path=" + (native.lastPresentedPath ?? native.lastPath ?? "none"),
      );
      diagnosticWallSeconds = 0;
      diagnosticFrames = 0;
    }
  });

  const bridgeUsable = Boolean(
    rtx &&
    typeof rtx.registerStaticScene === "function" &&
    typeof rtx.createDynamicTriangleMesh === "function" &&
    typeof rtx.refitDynamicTriangleMesh === "function" &&
    typeof rtx.destroyDynamicTriangleMesh === "function" &&
    typeof rtx.evaluateRayReflections === "function",
  );
  void (async () => {
    if (!bridgeUsable) {
      state.setupFinished = true;
      console.warn("[Neon Mercury RTX] Native ray bridge unavailable; WebGPU fallback remains active.");
      return;
    }
    try {
      const staticScene = await collectStaticRtxScene(
        room.staticRtxRoots ?? room.rtxRoots ?? [room.group],
        {
          maxTriangles: 260_000,
          lights: room.lights ?? [],
          yieldToHost: () => new Promise(resolve => setTimeout(resolve, 0)),
        },
      );
      state.staticSceneStats = {
        triangles: staticScene.triangleCount,
        vertices: staticScene.vertexCount,
        meshes: staticScene.sourceMeshCount,
        instances: staticScene.sourceInstanceCount,
        lights: staticScene.lightCount,
        truncated: staticScene.truncated,
      };
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      state.nativeConfigured = await nativeRenderer.configure(
        buffer.x,
        buffer.y,
        staticScene,
        mercury.rtxDynamicMesh,
      );
      state.dynamicMeshDirty = !state.nativeConfigured;
      console.log(
        "[Neon Mercury RTX] registered=" + state.nativeConfigured +
        " · triangles=" + staticScene.triangleCount.toLocaleString() +
        " · lights=" + staticScene.lightCount +
        " · liquidRayTriangles=" + (mercury.rtxDynamicMesh.indices.length / 3).toLocaleString() +
        " · transport=" + (nativeRenderer.status().pipelineMode ?? "bridge"),
      );
    } catch (error) {
      console.warn("[Neon Mercury RTX] Setup failed; raster remains active: " + (error?.message || error));
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
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    nativeRenderer.dispose();
    bassAudio.dispose();
    mercury.dispose();
    room.dispose?.();
    fallbackEnvironmentTarget?.dispose();
    if (rtx && capabilities.reflex) {
      try {
        rtx.requestFeatures?.({ reflexMode: previousReflexMode });
      } catch {
        // The host may already be tearing down its adapter.
      }
    }
    renderer.dispose();
    delete globalThis.__NEON_MERCURY_DEMO__;
  }, { once: true });
}

function finiteStat(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

await main();
