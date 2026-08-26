import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";

import { createJellyDynamicRayMesh } from "./jelly-rtx-mesh.mjs";
import { createJellyPhysics } from "./jelly-physics.mjs";
import { createJellyRaveScene } from "./jelly-scene.mjs";
import {
  JELLY_RAVE_TRACK,
  createRaveAudioController,
  sampleRaveAnalysis,
} from "./rave-audio.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { collectStaticRtxScene } from "./rtx-scene.mjs";

document.title = "RTX Jelly Rave — ThreeBrowser Runtime";

const PIXEL_RATIO_CAP = 1.45;
const CAMERA_MIN_DISTANCE = 8.5;
const CAMERA_MAX_DISTANCE = 38;
const FLOOR_Y = 0;
const scratchNdc = new THREE.Vector2();
const scratchPoint = new THREE.Vector3();
const scratchColor = new THREE.Color();

function createRaveEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x020106);
  const owned = [];

  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x090711,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(34, 20, 42), shellMaterial);
  shell.position.y = 7;
  environmentScene.add(shell);
  owned.push(shell.geometry, shellMaterial);

  const cards = [
    { color: 0x18eaff, energy: 8.5, size: [0.7, 12], position: [-13, 6, 0], rotation: [0, Math.PI * 0.5, 0] },
    { color: 0xff25d2, energy: 8.0, size: [0.7, 12], position: [13, 5, -2], rotation: [0, -Math.PI * 0.5, 0] },
    { color: 0x854fff, energy: 7.0, size: [18, 0.7], position: [0, 13, -8], rotation: [Math.PI * 0.5, 0, 0] },
    { color: 0xbaff2a, energy: 5.4, size: [12, 0.5], position: [0, 2, -18], rotation: [0, 0, 0] },
    { color: 0xff8a24, energy: 4.8, size: [8, 0.4], position: [0, 1, 17], rotation: [0, Math.PI, 0] },
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
    0.05,
    28,
    { size: 256, position: new THREE.Vector3(0, 5, -2) },
  );
  generator.dispose();
  for (const value of owned) value.dispose?.();
  return target;
}

function createHud() {
  const root = document.createElement("div");
  root.setAttribute("aria-label", "RTX Jelly Rave status and controls");
  Object.assign(root.style, {
    position: "fixed",
    left: "clamp(14px, 2.2vw, 38px)",
    top: "clamp(14px, 2.2vw, 32px)",
    zIndex: "10",
    color: "#e9fbff",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    textShadow: "0 0 14px rgba(40,235,255,.72)",
    pointerEvents: "none",
    userSelect: "none",
    letterSpacing: ".09em",
  });
  const title = document.createElement("div");
  title.textContent = "JELLY / RTX RAVE";
  Object.assign(title.style, {
    fontSize: "clamp(15px, 1.3vw, 23px)",
    fontWeight: "800",
    letterSpacing: ".18em",
  });
  const status = document.createElement("div");
  Object.assign(status.style, {
    marginTop: "7px",
    fontSize: "clamp(9px, .72vw, 12px)",
    color: "#8df7ff",
    lineHeight: "1.65",
    whiteSpace: "pre-line",
  });
  const controls = document.createElement("div");
  controls.textContent = "DRAG ORBIT  ·  WHEEL DOLLY  ·  RIGHT CLICK SHOCK\nSPACE DROP  ·  M MUSIC  ·  C COLOR  ·  X RTX  ·  R RESET";
  Object.assign(controls.style, {
    marginTop: "9px",
    padding: "8px 11px",
    borderLeft: "2px solid rgba(255,43,214,.72)",
    background: "linear-gradient(90deg,rgba(5,3,14,.64),rgba(5,3,14,0))",
    fontSize: "clamp(8px, .62vw, 10px)",
    color: "rgba(238,246,255,.72)",
    lineHeight: "1.65",
    whiteSpace: "pre-line",
  });
  root.append(title, status, controls);
  document.body.append(root);
  return {
    update(music, renderStatus, jellyStats) {
      const section = String(music.section || "waiting").replaceAll("-", " ").toUpperCase();
      const audioState = music.playing ? "LIVE" : "CLICK / M FOR AUDIO";
      const path = renderStatus.lastPresentedPath || renderStatus.lastPath || "STARTING";
      status.textContent =
        `${JELLY_RAVE_TRACK.title.toUpperCase()}  ·  ${JELLY_RAVE_TRACK.bpm} BPM  ·  ${audioState}\n` +
        `${section}  ·  BAR ${String((music.bar ?? 0) + 1).padStart(2, "0")} / ${JELLY_RAVE_TRACK.bars}` +
        `  ·  ${path.toUpperCase()}\n` +
        `${jellyStats.jellyCount} LIVE JELLIES  ·  ${jellyStats.triangleCount.toLocaleString()} REFITTED RTX TRIANGLES`;
    },
    dispose() { root.remove(); },
  };
}

function eventNdc(element, event) {
  const rect = element.getBoundingClientRect();
  return scratchNdc.set(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
}

function shiftRavePalette(rave, amount = 0.115) {
  const visited = new Set();
  rave.root.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || visited.has(material)) continue;
      visited.add(material);
      const reactive = Number.isFinite(material.userData?.baseEmissiveIntensity) ||
        material.userData?.rtxDynamicJelly;
      if (!reactive) continue;
      for (const property of ["color", "emissive", "sheenColor", "attenuationColor"]) {
        const value = material[property];
        if (!value?.isColor) continue;
        const hsl = value.getHSL({ h: 0, s: 0, l: 0 });
        value.setHSL((hsl.h + amount) % 1, hsl.s, hsl.l);
      }
    }
  });
  for (const light of rave.lights) {
    if (!light.color?.isColor || light.isHemisphereLight) continue;
    const hsl = light.color.getHSL({ h: 0, s: 0, l: 0 });
    light.color.setHSL((hsl.h + amount) % 1, hsl.s, hsl.l);
    if (Number.isFinite(light.userData.baseHue)) {
      light.userData.baseHue = (light.userData.baseHue + amount) % 1;
    }
  }
}

async function main() {
  if (!WebGPU.isAvailable()) throw new Error("RTX Jelly Rave requires WebGPU.");

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#020106";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  renderer.setPixelRatio(Math.min(
    PIXEL_RATIO_CAP,
    Math.max(1, Number(globalThis.devicePixelRatio || 1)),
  ));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x020106, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.cursor = "grab";
  document.body.append(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
    throw new Error("RTX Jelly Rave did not receive the native WebGPU backend.");
  }

  const validationErrors = [];
  renderer.backend.device.addEventListener?.("uncapturederror", event => {
    const message = event.error?.message || String(event.error || event);
    validationErrors.push(message);
    console.error("[Jelly Rave WebGPU]", message);
  });

  const scene = new THREE.Scene();
  scene.name = "Neon jelly warehouse rave with monumental gummy humanoid DJ";
  const camera = new THREE.PerspectiveCamera(
    54,
    innerWidth / Math.max(1, innerHeight),
    0.035,
    90,
  );
  const environmentTarget = createRaveEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1.35;

  const rave = createJellyRaveScene(scene);
  const bodyDefinitions = rave.jellies.map((jelly, index) => ({
    id: jelly.id,
    radius: jelly.radius,
    mass: Math.max(0.38, jelly.radius ** 3),
    position: jelly.basePosition.toArray(),
    velocity: [Math.sin(index * 1.7) * 0.08, 0, Math.cos(index * 1.31) * 0.08],
    phase: jelly.phase,
  }));
  const physics = createJellyPhysics({
    seed: 0x4a454c4c,
    bodies: bodyDefinitions,
    arena: {
      minX: -12.8,
      maxX: 12.8,
      minZ: -7.2,
      maxZ: 17.2,
      floorY: FLOOR_Y,
      ceilingY: 13.5,
    },
    gravity: [0, -23.5, 0],
    restitution: 0.66,
    bodyRestitution: 0.74,
    wallRestitution: 0.78,
    surfaceFriction: 0.13,
    shapeSpring: 88,
    shapeDamping: 12.8,
    beatStrength: 3.5,
  });
  const descriptorById = new Map(rave.jellies.map(jelly => [jelly.id, jelly]));
  for (const body of physics.bodies) descriptorById.get(body.id)?.applyBody(body);

  const dynamicJellies = createJellyDynamicRayMesh(rave.jellies, {
    radiance: [0.028, 0.008, 0.046, 1],
    surface: [0.42, 0.10, 0.67, 0.075],
  });
  const audio = createRaveAudioController();
  const hud = createHud();

  prepareRtxGuideMaterials(scene);
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
    console.warn("[Jelly Rave RTX] Feature request rejected: " + (error?.message || error));
  }

  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx, {
    timeoutMs: 30_000,
    directionalLightIntensity: 0.22,
    directionalAngularRadius: 0.012,
    directionalSampleCount: 6,
    aoSampleCount: 12,
    maxDistance: 78,
    rayBias: 0.0045,
    shadowStrength: 0.22,
    aoStrength: 0.12,
    aoRadius: 1.35,
    reflectionStrength: 1.34,
    reflectionDistance: 76,
    reflectionRayBias: 0.006,
    roughnessCutoff: 0.76,
  });

  const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  nativeRenderer.resize(bufferSize.x, bufferSize.y);

  const state = {
    elapsed: 0,
    paused: false,
    forceRaster: false,
    dragging: false,
    dragMoved: false,
    previousPointer: new THREE.Vector2(),
    azimuth: 0.08,
    targetAzimuth: 0.08,
    elevation: 0.24,
    targetElevation: 0.24,
    distance: 22,
    targetDistance: 22,
    autoCamera: true,
    cameraTarget: new THREE.Vector3(0, 3.25, -3.8),
    nativeConfigured: false,
    setupFinished: false,
    staticSceneStats: null,
    manualBeatImpulse: 0,
    audioAttempted: false,
    musicMuted: false,
    palette: 0,
    lastHudTime: -Infinity,
  };
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);

  async function ensureMusic() {
    if (state.musicMuted || audio.status().playing) return audio.status().playing;
    if (state.audioAttempted) return false;
    state.audioAttempted = true;
    const started = await audio.start();
    if (!started) state.audioAttempted = false;
    return started;
  }

  function fireShockwave(event, strength = 13) {
    raycaster.setFromCamera(eventNdc(renderer.domElement, event), camera);
    const hit = raycaster.ray.intersectPlane(floorPlane, scratchPoint);
    if (!hit) return 0;
    hit.x = THREE.MathUtils.clamp(hit.x, physics.arena.minX, physics.arena.maxX);
    hit.z = THREE.MathUtils.clamp(hit.z, physics.arena.minZ, physics.arena.maxZ);
    return physics.impulseAt(hit, strength, 8.5, {
      verticalLift: 0.68,
      falloffExponent: 1.1,
    });
  }

  function onPointerDown(event) {
    void ensureMusic();
    if (event.button === 2) {
      fireShockwave(event);
      state.manualBeatImpulse = Math.max(state.manualBeatImpulse, 1.15);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    state.dragging = true;
    state.dragMoved = false;
    state.autoCamera = false;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.style.cursor = "grabbing";
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) state.dragMoved = true;
    state.targetAzimuth -= dx * 0.0041;
    state.targetElevation = THREE.MathUtils.clamp(
      state.targetElevation + dy * 0.0031,
      0.06,
      0.74,
    );
    state.previousPointer.set(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.autoCamera = false;
    state.targetDistance = THREE.MathUtils.clamp(
      state.targetDistance * Math.exp(Math.sign(event.deltaY) * 0.105),
      CAMERA_MIN_DISTANCE,
      CAMERA_MAX_DISTANCE,
    );
    event.preventDefault();
  }

  async function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      void ensureMusic();
      state.manualBeatImpulse = 2.25;
      physics.impulseAt([0, 0, 4.6], 16.5, 34, {
        verticalLift: 0.92,
        falloffExponent: 0.46,
      });
    } else if (key === "m") {
      state.audioAttempted = true;
      const playing = await audio.toggle();
      state.musicMuted = !playing;
    } else if (key === "x") {
      state.forceRaster = !state.forceRaster;
    } else if (key === "c") {
      state.palette = (state.palette + 1) % 8;
      shiftRavePalette(rave);
    } else if (key === "r") {
      physics.reset();
      for (const body of physics.bodies) descriptorById.get(body.id)?.applyBody(body);
      state.manualBeatImpulse = 0;
      state.autoCamera = true;
      state.targetDistance = 22;
      state.targetAzimuth = 0.08;
      state.targetElevation = 0.24;
    } else if (key === "p") {
      state.paused = !state.paused;
      if (state.paused) audio.pause();
      else {
        state.musicMuted = false;
        state.audioAttempted = false;
        void ensureMusic();
      }
    } else {
      void ensureMusic();
    }
  }

  function onContextMenu(event) {
    event.preventDefault();
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
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("contextmenu", onContextMenu);
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("resize", resize);

  function updateCamera(delta, music) {
    if (state.autoCamera) {
      state.targetAzimuth = 0.12 + Math.sin(state.elapsed * 0.105) * 0.34;
      state.targetElevation = 0.23 + Math.sin(state.elapsed * 0.071 + 0.8) * 0.045;
      state.targetDistance = 21.5 - music.drop * 1.7 + Math.sin(state.elapsed * 0.16) * 0.7;
    }
    const response = 1 - Math.exp(-delta * 6.2);
    state.azimuth = THREE.MathUtils.lerp(state.azimuth, state.targetAzimuth, response);
    state.elevation = THREE.MathUtils.lerp(state.elevation, state.targetElevation, response);
    state.distance = THREE.MathUtils.lerp(state.distance, state.targetDistance, response);
    const cosElevation = Math.cos(state.elevation);
    camera.position.set(
      Math.sin(state.azimuth) * cosElevation,
      Math.sin(state.elevation),
      Math.cos(state.azimuth) * cosElevation,
    ).multiplyScalar(state.distance).add(state.cameraTarget);
    camera.lookAt(state.cameraTarget);
  }

  function snapshot() {
    return {
      title: document.title,
      audio: audio.status(),
      physics: {
        bodies: physics.bodies.length,
        time: physics.time,
        positions: physics.bodies.map(body => body.position.toArray()),
      },
      dynamicRtx: dynamicJellies.stats(),
      render: nativeRenderer.status(),
      nativeConfigured: state.nativeConfigured,
      setupFinished: state.setupFinished,
      staticScene: state.staticSceneStats ? { ...state.staticSceneStats } : null,
      forceRaster: state.forceRaster,
      validationErrors: [...validationErrors],
    };
  }

  globalThis.__JELLY_RAVE_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      music: () => audio.toggle(),
      drop() {
        state.manualBeatImpulse = 2.25;
        return physics.impulseAt([0, 0, 4.6], 16.5, 34, { verticalLift: 0.92 });
      },
      shock(x = 0, z = 4, strength = 12) {
        return physics.impulseAt([Number(x) || 0, 0, Number(z) || 0], Number(strength) || 12, 9, {
          verticalLift: 0.72,
        });
      },
      compareRaster(value = true) { state.forceRaster = Boolean(value); },
      reset: physics.reset,
      palette: () => shiftRavePalette(rave),
    }),
  });

  renderer.compileAsync?.(scene, camera)?.catch?.(error => {
    console.warn("[Jelly Rave] Shader prewarm deferred: " + (error?.message || error));
  });

  let previousTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.075, wallDelta);
    previousTime = now;
    if (!state.paused) state.elapsed += delta;

    const audioState = audio.update();
    const music = audioState.playing
      ? audioState
      : { ...sampleRaveAnalysis(state.elapsed), playing: false };
    if (!state.paused) {
      physics.update(delta, {
        beat: music.pulse,
        bass: music.bass,
        energy: music.energy,
        beatImpulse: state.manualBeatImpulse,
      });
      state.manualBeatImpulse = 0;
      for (const body of physics.bodies) descriptorById.get(body.id)?.applyBody(body);
      rave.updateReactiveLighting(
        music.timeSeconds,
        Math.min(1, music.pulse + music.strobe * 0.9),
        Math.min(1, music.bass + music.drop * 0.16),
      );
    }
    updateCamera(delta, music);

    if (state.nativeConfigured) {
      dynamicJellies.update();
      nativeRenderer.updateDynamicTriangleMesh();
    }

    let staged = false;
    if (state.nativeConfigured && !state.forceRaster) {
      // NativeRtxRenderer always stages the exact transparent raster first;
      // the bridge augments that color and never replaces it with MRT guides.
      staged = nativeRenderer.renderNative(scene, camera, {
        directionalLightDirection: [-0.34, 0.82, -0.41],
        directionalLightIntensity: 0.20,
        reflectionStrength: 1.28 + music.drop * 0.16,
        reflectionDistance: 76,
        reflectionRayBias: 0.006,
        roughnessCutoff: 0.76,
        maxDistance: 78,
        environmentColor: [0.006, 0.002, 0.014],
        environmentIntensity: 0.18,
        highQuality: true,
      });
      if (!staged && !nativeRenderer.status().configured) state.nativeConfigured = false;
    }
    if (!staged) staged = nativeRenderer.renderRaster(scene, camera);
    if (staged && !nativeRenderer.present()) {
      console.error("[Jelly Rave] Single-surface presentation failed.");
    }

    if (state.elapsed - state.lastHudTime >= 0.10) {
      state.lastHudTime = state.elapsed;
      hud.update(music, nativeRenderer.status(), dynamicJellies.stats());
    }
  });

  const bridgeUsable = Boolean(
    rtx &&
    typeof rtx.registerStaticScene === "function" &&
    typeof rtx.evaluateRayReflections === "function",
  );
  const dynamicBridgeUsable = Boolean(
    bridgeUsable &&
    typeof rtx.createDynamicTriangleMesh === "function" &&
    typeof rtx.refitDynamicTriangleMesh === "function" &&
    typeof rtx.destroyDynamicTriangleMesh === "function",
  );

  void (async () => {
    if (!bridgeUsable) {
      state.setupFinished = true;
      console.warn("[Jelly Rave RTX] Native bridge unavailable; WebGPU fallback remains active.");
      return;
    }
    try {
      const staticScene = await collectStaticRtxScene(rave.staticMeshes, {
        maxTriangles: 360_000,
        lights: rave.lights,
        yieldToHost: () => new Promise(resolve => setTimeout(resolve, 0)),
      });
      state.staticSceneStats = {
        triangles: staticScene.triangleCount,
        vertices: staticScene.vertexCount,
        meshes: staticScene.sourceMeshCount,
        lights: staticScene.lightCount,
        truncated: staticScene.truncated,
      };
      dynamicJellies.update();
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      state.nativeConfigured = await nativeRenderer.configure(
        buffer.x,
        buffer.y,
        staticScene,
        dynamicBridgeUsable ? dynamicJellies.descriptor : null,
      );
      const dynamicStats = dynamicJellies.stats();
      console.log(
        `[Jelly Rave RTX] registered=${state.nativeConfigured}` +
        ` · static=${staticScene.triangleCount.toLocaleString()} triangles` +
        ` · movingJellies=${dynamicBridgeUsable ? dynamicStats.triangleCount.toLocaleString() : "raster"}` +
        ` · lights=${staticScene.lightCount}`,
      );
    } catch (error) {
      console.warn("[Jelly Rave RTX] Setup failed; raster remains active: " + (error?.message || error));
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
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    audio.dispose();
    hud.dispose();
    nativeRenderer.dispose();
    rave.dispose();
    environmentTarget.dispose();
    if (rtx && capabilities.reflex) {
      try { rtx.requestFeatures?.({ reflexMode: previousReflexMode }); } catch { /* adapter teardown */ }
    }
    renderer.dispose();
    delete globalThis.__JELLY_RAVE_DEMO__;
  }, { once: true });
}

await main();
