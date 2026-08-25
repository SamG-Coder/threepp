import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createGorgeSunsetAtmosphere } from "./atmosphere.mjs";
import { createFloodEffects } from "./effects.mjs";
import { FlashFloodModel } from "./fluid-model.mjs";
import {
  bedHeight,
  channelCenterX,
  channelHalfWidth,
  createGorgeEnvironment,
  gorgeHeight,
} from "./gorge.mjs";
import { NativeRtxWaterRenderer } from "./native-rtx-water.mjs";
import { collectStaticRtxScene } from "./rtx-scene.mjs";
import {
  SURFACE_TEXTURE_FAMILIES,
  applySurfaceTextureSet,
} from "./surface-textures.mjs";
import { createFlashFloodWater } from "./water.mjs";

document.title = "RTX Sunset Flash Flood Gorge — ThreeBrowser Runtime";

const DISPLAY_PIXEL_RATIO_CAP = 1.35;
const STARTUP_SIMULATION_SECONDS = 120;
const MODEL_OPTIONS = Object.freeze({
  width: 96,
  height: 245,
  cellSize: 4,
  originX: -192,
  originZ: -680,
  fixedStepSeconds: 0.05,
  gateWidthCells: 11,
  gateStartSeconds: 0.8,
  gateRiseSeconds: 5.5,
  gateHoldSeconds: Infinity,
  gatePeakDischarge: 920,
  maxDepth: 9,
  maxVelocity: 22,
  manningRoughness: 0.042,
  linearDamping: 0.03,
  maximumFroude: 1.95,
});

function createFloodModel() {
  const model = new FlashFloodModel({
    ...MODEL_OPTIONS,
    gateCenterX: channelCenterX(MODEL_OPTIONS.originZ),
    bed: ({ x, z }) => gorgeHeight(x, z),
  });
  // The opening frame is a mature, valley-scale event rather than an empty
  // channel. Reset still returns to the closed-gate beginning of the release.
  const stats = model.advance(STARTUP_SIMULATION_SECONDS);
  return { model, stats };
}

function createSafetyBeacons(gorge) {
  const group = new THREE.Group();
  group.name = "Invariant amber spillway and bridge scale beacons";
  const bulbGeometry = new THREE.IcosahedronGeometry(0.34, 2);
  const poleGeometry = new THREE.CylinderGeometry(0.075, 0.095, 2.8, 8);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    name: "Warm flood-control beacon glass",
    color: 0xffb15a,
    emissive: 0xff7a24,
    emissiveIntensity: 5.5,
    roughness: 0.16,
    metalness: 0.02,
  });
  bulbMaterial.userData.rtxTriangleRadiance = [5.2, 1.45, 0.22, 1];
  bulbMaterial.userData.rtxTriangleSurface = [0.92, 0.31, 0.07, 0.14];
  const poleMaterial = new THREE.MeshStandardMaterial({
    name: "Dark galvanized beacon pole",
    color: 0x30383a,
    roughness: 0.42,
    metalness: 0.78,
  });
  applySurfaceTextureSet(poleMaterial, SURFACE_TEXTURE_FAMILIES.DARK_METAL, {
    tint: 0xb8c2c3,
    roughness: 0.84,
    normalStrength: 0.34,
  });

  gorge.group.updateMatrixWorld(true);
  const fixtures = [
    {
      position: gorge.spillway.group.localToWorld(new THREE.Vector3(-18, 13.2, 1.45)),
      intensity: 18,
      distance: 58,
    },
    {
      position: gorge.spillway.group.localToWorld(new THREE.Vector3(18, 13.2, 1.45)),
      intensity: 18,
      distance: 58,
    },
    {
      position: gorge.bridge.group.localToWorld(new THREE.Vector3(-39, 34.1, 0)),
      intensity: 12,
      distance: 48,
    },
    {
      position: gorge.bridge.group.localToWorld(new THREE.Vector3(39, 34.1, 0)),
      intensity: 12,
      distance: 48,
    },
  ];
  const lights = [];
  for (let index = 0; index < fixtures.length; ++index) {
    const fixture = fixtures[index];
    const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
    bulb.name = "Steady amber gorge beacon " + (index + 1);
    bulb.position.copy(fixture.position);
    bulb.castShadow = false;
    bulb.receiveShadow = false;
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.name = "Beacon pole " + (index + 1);
    pole.position.copy(fixture.position);
    pole.position.y -= 1.55;
    pole.castShadow = true;
    pole.receiveShadow = true;
    const light = new THREE.PointLight(
      0xff9a45,
      fixture.intensity,
      fixture.distance,
      1.8,
    );
    light.name = "Stable amber scale light " + (index + 1);
    light.position.copy(fixture.position);
    light.castShadow = false;
    group.add(pole, bulb, light);
    lights.push(light);
  }
  return {
    group,
    lights,
    rtxRoots: [group],
    dispose() {
      group.removeFromParent();
      bulbGeometry.dispose();
      poleGeometry.dispose();
      bulbMaterial.dispose();
      poleMaterial.dispose();
    },
  };
}

function makeCameraPresets(gorge, readFlowStats) {
  const overviewTarget = new THREE.Vector3(0, 50, -120);
  const bridgeTarget = gorge.landmarks.bridge.clone();
  const spillwayTarget = gorge.landmarks.spillway.clone();
  // Presets are sampled every animation frame. Keep their result vectors
  // stable so orbiting a fixed view never creates short-lived garbage.
  const overviewView = {
    position: new THREE.Vector3(85, 55, 85),
    target: overviewTarget,
    fov: 70,
  };
  const surgeView = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: 58,
  };
  let smoothedSurgeFrontZ = Number.NaN;
  function rawSurgeFrontZ() {
    const stats = readFlowStats();
    return THREE.MathUtils.clamp(
      Number.isFinite(stats.frontZ) ? stats.frontZ : -610,
      -570,
      224,
    );
  }
  const bridgeView = {
    position: new THREE.Vector3(-16.233, 8.609, 188),
    target: bridgeTarget,
    fov: 59,
  };
  const spillwayView = {
    position: new THREE.Vector3(19.399, 41.428, -570),
    target: spillwayTarget,
    fov: 58,
  };
  return [
    {
      name: "high gorge overview",
      resolve() {
        return overviewView;
      },
    },
    {
      name: "surge chase",
      activate() {
        // Enter on the surge's current location. The outer camera transition
        // handles the view change; following frames then filter cell steps.
        smoothedSurgeFrontZ = rawSurgeFrontZ();
      },
      reset() {
        smoothedSurgeFrontZ = Number.NaN;
      },
      resolve(_time, delta = 0) {
        const rawFrontZ = rawSurgeFrontZ();
        if (!Number.isFinite(smoothedSurgeFrontZ)) smoothedSurgeFrontZ = rawFrontZ;
        // frontZ advances in four-metre grid cells. A persistent exponential
        // anchor turns those steps into continuous, frame-rate-independent
        // motion without changing the simulated front itself.
        const anchorResponse = 1 - Math.exp(
          -THREE.MathUtils.clamp(Number(delta) || 0, 0, 0.05) * 5.5,
        );
        smoothedSurgeFrontZ = THREE.MathUtils.lerp(
          smoothedSurgeFrontZ,
          rawFrontZ,
          anchorResponse,
        );
        const cameraZ = THREE.MathUtils.clamp(smoothedSurgeFrontZ + 112, -490, 275);
        const center = channelCenterX(cameraZ);
        const cameraX = center + 28;
        const targetZ = smoothedSurgeFrontZ - 18;
        const targetX = channelCenterX(targetZ);
        surgeView.position.set(
          cameraX,
          bedHeight(center, cameraZ) + 38,
          cameraZ,
        );
        surgeView.target.set(
          targetX,
          bedHeight(targetX, targetZ) + 4.2,
          targetZ,
        );
        return surgeView;
      },
    },
    {
      name: "inspection bridge",
      resolve() {
        return bridgeView;
      },
    },
    {
      name: "spillway release",
      resolve() {
        return spillwayView;
      },
    },
  ];
}

/**
 * WebGPURenderer supports per-light shadow invalidation. The moon, gorge and
 * beacons are fixed, but the floating-log InstancedMesh is a genuine moving
 * shadow caster. A one-time shadow freeze would therefore leave stale log
 * silhouettes. Compare its actual matrices and request the 2048 map only when
 * the rendered caster state changed; identical state produces identical depth.
 */
function createExactShadowInvalidator(light, dynamicRoot) {
  const shadow = light?.shadow;
  if (!shadow) return { update() {} };
  const casters = [];
  dynamicRoot?.traverse?.(object => {
    if (!object?.isInstancedMesh || object.castShadow !== true || !object.instanceMatrix) return;
    object.updateWorldMatrix?.(true, false);
    casters.push({
      object,
      count: object.count,
      visible: object.visible,
      castShadow: object.castShadow,
      matrices: new Float32Array(object.instanceMatrix.array),
      worldMatrix: new Float64Array(object.matrixWorld.elements),
    });
  });

  shadow.autoUpdate = false;
  shadow.needsUpdate = true;

  return {
    update() {
      let changed = false;
      for (const state of casters) {
        const object = state.object;
        object.updateWorldMatrix?.(true, false);
        const source = object.instanceMatrix.array;
        if (state.matrices.length !== source.length) {
          state.matrices = new Float32Array(source);
          changed = true;
        } else {
          for (let index = 0; index < source.length; ++index) {
            if (state.matrices[index] === source[index]) continue;
            state.matrices[index] = source[index];
            changed = true;
          }
        }
        const world = object.matrixWorld.elements;
        for (let index = 0; index < world.length; ++index) {
          if (state.worldMatrix[index] === world[index]) continue;
          state.worldMatrix[index] = world[index];
          changed = true;
        }
        if (state.count !== object.count || state.visible !== object.visible ||
            state.castShadow !== object.castShadow) {
          state.count = object.count;
          state.visible = object.visible;
          state.castShadow = object.castShadow;
          changed = true;
        }
      }
      if (changed) shadow.needsUpdate = true;
    },
  };
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("RTX Flash Flood Gorge requires native WebGPU; there is no WebGL path.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#120d18";

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
  renderer.setClearColor(0x120d18, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
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
    console.error("[Flash Flood WebGPU validation]", message);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  try {
    const request = {
      dlssSuperResolution: false,
      dlssFrameGeneration: false,
      dlssRayReconstruction: false,
    };
    if (capabilities.reflex) request.reflex = "boost";
    rtx?.requestFeatures?.(request);
  } catch (error) {
    console.warn("[Flash Flood RTX] Feature request rejected: " + (error?.message || error));
  }

  const scene = new THREE.Scene();
  scene.name = "Late-sunset valley-scale flash flood gorge";
  scene.background = new THREE.Color(0x120d18);
  const camera = new THREE.PerspectiveCamera(
    70,
    innerWidth / Math.max(1, innerHeight),
    0.15,
    1900,
  );

  const flood = createFloodModel();
  const model = flood.model;
  let latestFlowStats = flood.stats;
  const gorge = createGorgeEnvironment();
  scene.add(gorge.group);
  const atmosphere = createGorgeSunsetAtmosphere(scene, {
    sunIntensity: 2.35,
    moonIntensity: 0.58,
    fogDensity: 0.00122,
  });
  // Violet-blue fill reveals the valley walls while the grazing amber key
  // keeps the late-sunset direction and long-shadow depth unmistakable.
  // These values are invariant; no light source is animated or flickered.
  atmosphere.hemisphere.intensity = 1.12;
  atmosphere.ambient.intensity = 0.24;
  const beacons = createSafetyBeacons(gorge);
  scene.add(beacons.group);
  const water = createFlashFloodWater({
    model,
    bedHeight: gorgeHeight,
    moon: atmosphere.sunDirection,
  });
  scene.add(water.surface);
  const effects = createFloodEffects({
    model,
    bedHeight: gorgeHeight,
    channelCenterX,
    channelHalfWidth,
  });
  scene.add(effects.group);
  const sunShadowInvalidator = createExactShadowInvalidator(
    atmosphere.sunLight,
    effects.group,
  );

  const presets = makeCameraPresets(gorge, () => latestFlowStats);
  const initialView = presets[0].resolve();
  camera.position.copy(initialView.position);
  camera.lookAt(initialView.target);
  const cameraTarget = initialView.target.clone();
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const viewOffset = new THREE.Vector3();
  const spherical = new THREE.Spherical();

  const nativeRenderer = new NativeRtxWaterRenderer(renderer, camera, rtx, {
    timeoutMs: 30_000,
    directionalLightIntensity: 3.4,
    shadowStrength: 0.21,
    aoStrength: 0.07,
    reflectionStrength: 0.98,
    reflectionDistance: 1_300,
  });
  const nativeFrameOptions = Object.freeze({
    directionalLightDirection: atmosphere.sunDirection,
    directionalLightIntensity: 3.4,
    // A low stable raster sun keeps terrain readable while ray queries add
    // deterministic visibility, contact occlusion and reflections.
    suppressRasterLights: Object.freeze([]),
    reflectionStrength: 0.98,
    reflectionDistance: 1_300,
  });
  const initialBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  nativeRenderer.resize(initialBuffer.x, initialBuffer.y);

  let nativeConfigured = false;
  let staticSceneStats = null;
  let setupFinished = false;
  const bridgeUsable = Boolean(
    rtx &&
    typeof rtx.registerStaticScene === "function" &&
    (
      typeof rtx.evaluateRayLighting === "function" ||
      typeof rtx.evaluateRayReflections === "function"
    ),
  );

  const state = {
    preset: 0,
    cameraName: presets[0].name,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    yaw: 0,
    yawTarget: 0,
    pitch: 0,
    pitchTarget: 0,
    dolly: 1,
    dollyTarget: 1,
    paused: false,
    // The authored event runs at a cinematic 1.6x real-time cadence. Together
    // with the higher-discharge hydraulic model this presents a roughly
    // 10 m/s main current, while [ still exposes a calmer inspection speed.
    speed: 1.6,
    forceRaster: false,
    elapsed: STARTUP_SIMULATION_SECONDS,
    fps: 0,
    cameraTransitionElapsed: 0,
    cameraTransitionDuration: 0,
  };

  function setPreset(index) {
    const wrapped = ((Math.trunc(index) % presets.length) + presets.length) % presets.length;
    const changed = wrapped !== state.preset;
    state.preset = wrapped;
    state.cameraName = presets[wrapped].name;
    state.yawTarget = 0;
    state.pitchTarget = 0;
    state.dollyTarget = 1;
    if (changed) {
      presets[wrapped].activate?.();
      state.cameraTransitionElapsed = 0;
      // Preset 2 crosses from a composed overview into a moving world anchor.
      // Let that large move remain visibly cinematic instead of converging in
      // only a handful of frames. Other preset response remains unchanged.
      state.cameraTransitionDuration = wrapped === 1 ? 0.8 : 0;
    }
    return state.cameraName;
  }

  function updateCamera(time, delta) {
    const view = presets[state.preset].resolve(time, delta);
    desiredTarget.copy(view.target);
    viewOffset.copy(view.position).sub(view.target);
    spherical.setFromVector3(viewOffset);
    spherical.theta += state.yaw;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + state.pitch,
      0.12,
      Math.PI - 0.12,
    );
    spherical.radius *= state.dolly;
    desiredPosition.setFromSpherical(spherical).add(desiredTarget);

    let responseRate = 4.8;
    if (state.cameraTransitionElapsed < state.cameraTransitionDuration) {
      state.cameraTransitionElapsed = Math.min(
        state.cameraTransitionDuration,
        state.cameraTransitionElapsed + Math.max(0, delta),
      );
      const phase = state.cameraTransitionElapsed / state.cameraTransitionDuration;
      const easedPhase = phase * phase * (3 - 2 * phase);
      responseRate = THREE.MathUtils.lerp(3.2, 4.8, easedPhase);
    }
    const response = 1 - Math.exp(-Math.max(0, delta) * responseRate);
    camera.position.lerp(desiredPosition, response);
    cameraTarget.lerp(desiredTarget, response);
    const nextFov = Number.isFinite(view.fov) ? view.fov : 60;
    if (Math.abs(camera.fov - nextFov) > 0.001) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, nextFov, response);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(cameraTarget);
  }

  function resetFlood() {
    model.reset();
    latestFlowStats = model.stats();
    effects.reset?.();
    presets[1].reset?.();
    state.elapsed = 0;
    state.paused = false;
    water.update(0);
    effects.update(0, 0);
    return latestFlowStats;
  }

  function onPointerDown(event) {
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.previousPointer.set(event.clientX, event.clientY);
    state.yawTarget -= dx * 0.0033;
    state.pitchTarget = THREE.MathUtils.clamp(
      state.pitchTarget - dy * 0.0027,
      -0.82,
      0.82,
    );
  }
  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }
  function onWheel(event) {
    event.preventDefault();
    state.dollyTarget = THREE.MathUtils.clamp(
      state.dollyTarget * Math.exp(event.deltaY * 0.00072),
      0.32,
      2.7,
    );
  }
  function onKeyDown(event) {
    if (event.repeat) return;
    if (/^[1-4]$/.test(event.key)) {
      setPreset(Number(event.key) - 1);
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      state.paused = !state.paused;
    } else if (event.key === "[") {
      state.speed = Math.max(0.25, state.speed * 0.5);
    } else if (event.key === "]") {
      state.speed = Math.min(4, state.speed * 2);
    } else if (event.key.toLowerCase() === "r") {
      resetFlood();
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
    if (!nativeRenderer.resize(buffer.x, buffer.y)) nativeConfigured = false;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("resize", resize);

  function snapshot() {
    return {
      title: document.title,
      simulation: { ...model.stats() },
      effects: effects.stats(),
      water: water.stats(),
      gorge: gorge.getStats(),
      atmosphere: atmosphere.getStats(),
      camera: {
        preset: state.preset + 1,
        name: state.cameraName,
        position: camera.position.toArray(),
        target: cameraTarget.toArray(),
      },
      render: {
        fps: state.fps,
        forceRaster: state.forceRaster,
        buffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
      },
      rtx: {
        setupFinished,
        bridgeUsable,
        nativeConfigured,
        staticScene: staticSceneStats ? { ...staticSceneStats } : null,
        renderer: nativeRenderer.status(),
      },
      validationErrors: [...validationErrors],
    };
  }

  globalThis.__FLASH_FLOOD_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      pause(value = true) {
        state.paused = Boolean(value);
        return state.paused;
      },
      resume() {
        state.paused = false;
      },
      setSpeed(value) {
        state.speed = THREE.MathUtils.clamp(Number(value) || 1, 0.25, 4);
        return state.speed;
      },
      setCamera(value) {
        if (typeof value === "string") {
          const query = value.toLowerCase();
          const index = presets.findIndex(item => item.name.includes(query));
          if (index >= 0) return setPreset(index);
          return state.cameraName;
        }
        return setPreset(Number(value) - 1);
      },
      reset: resetFlood,
      compareRaster(value = true) {
        state.forceRaster = Boolean(value);
        return state.forceRaster;
      },
    }),
  });

  // Shader compilation is intentionally non-blocking. The first raster frame
  // starts immediately while the static gorge snapshot and native BLAS/TLAS
  // are prepared cooperatively in the background.
  water.update(state.elapsed);
  effects.update(state.elapsed, 0);
  renderer.compileAsync?.(scene, camera)?.catch?.(error => {
    console.warn("[Flash Flood] Shader prewarm deferred: " + (error?.message || error));
  });

  let previousTime = performance.now();
  let diagnosticTimer = 0;
  let diagnosticFrames = 0;
  let diagnosticWallSeconds = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    // Preserve the real interval through ordinary RTX frame dips. Only throw
    // away a quarter-second-or-larger interruption (breakpoint, window drag,
    // machine sleep), which would otherwise create a large catch-up burst.
    const frameDelta = Math.min(0.25, wallDelta);
    const visualDelta = Math.min(0.05, frameDelta);
    const simulationWallDelta = frameDelta;
    previousTime = now;
    diagnosticFrames += 1;
    diagnosticWallSeconds += wallDelta;
    let waterChanged = false;
    let simulationDelta = 0;
    if (!state.paused) {
      simulationDelta = simulationWallDelta * state.speed;
      if (simulationDelta > 0) {
        latestFlowStats = model.advance(simulationDelta);
        state.elapsed += simulationDelta;
        waterChanged = true;
      }
    }

    const orbitResponse = 1 - Math.exp(-visualDelta * 10);
    state.yaw += (state.yawTarget - state.yaw) * orbitResponse;
    state.pitch += (state.pitchTarget - state.pitch) * orbitResponse;
    state.dolly += (state.dollyTarget - state.dolly) * (1 - Math.exp(-visualDelta * 8));
    updateCamera(state.elapsed, visualDelta);
    atmosphere.update(state.elapsed, camera);
    // With paused model state and paused shader time, this upload would rewrite
    // all 23,520 water vertices with byte-identical data every display frame.
    if (waterChanged) water.update(state.elapsed);
    // Effects substep this complete simulation interval internally. Passing
    // the camera-smoothed visual delta made foam, spray and logs visibly slow
    // down precisely when the native ray passes were busiest.
    effects.update(state.elapsed, simulationDelta);
    sunShadowInvalidator.update();

    let staged = false;
    if (nativeConfigured && !state.forceRaster) {
      staged = nativeRenderer.renderNative(scene, camera, nativeFrameOptions);
      if (!staged && !nativeRenderer.status().configured) {
        nativeConfigured = false;
        console.warn("[Flash Flood RTX] Native evaluation stopped; raster staging restored.");
      }
    }
    if (!staged) staged = nativeRenderer.renderRaster(scene, camera);
    if (staged) {
      if (!nativeRenderer.present()) {
        // Do not issue a second canvas render here: present may have reached
        // the swapchain before an error was surfaced by the native host.
        console.error("[Flash Flood] The single-surface presentation failed.");
      }
    }

    diagnosticTimer += visualDelta;
    if (diagnosticTimer >= 6) {
      diagnosticTimer = 0;
      state.fps = diagnosticWallSeconds > 0
        ? diagnosticFrames / diagnosticWallSeconds
        : 0;
      const flow = latestFlowStats;
      const detail = effects.stats();
      const native = nativeRenderer.status();
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      console.log(
        "[Flash Flood] fps=" + Math.round(state.fps) +
        " · buffer=" + buffer.x + "x" + buffer.y +
        " · wet=" + flow.wetCells +
        " · frontZ=" + (flow.frontZ == null ? "dry" : flow.frontZ.toFixed(0) + "m") +
        " · depth=" + flow.maxDepth.toFixed(2) + "m" +
        " · speed=" + flow.maxSpeed.toFixed(1) + "m/s" +
        " · foam=" + detail.foamPatches +
        " · spray=" + detail.sprayParticles +
        " · debris=" + detail.floatingLogs +
        " · path=" + native.lastPresentedPath,
      );
      diagnosticFrames = 0;
      diagnosticWallSeconds = 0;
    }
  });

  void (async () => {
    if (!bridgeUsable) {
      setupFinished = true;
      console.warn("[Flash Flood RTX] Native ray bridge unavailable; deterministic WebGPU water remains active.");
      return;
    }
    try {
      const staticScene = await collectStaticRtxScene(
        [...gorge.rtxRoots, ...beacons.rtxRoots],
        {
          maxTriangles: 600_000,
          lights: beacons.lights,
          yieldToHost: () => new Promise(resolve => setTimeout(resolve, 0)),
        },
      );
      staticSceneStats = {
        triangles: staticScene.triangleCount,
        vertices: staticScene.vertexCount,
        meshes: staticScene.sourceMeshCount,
        instances: staticScene.sourceInstanceCount,
        lights: staticScene.lightCount,
        truncated: staticScene.truncated,
      };
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      nativeConfigured = await nativeRenderer.configure(buffer.x, buffer.y, staticScene);
      console.log(
        "[Flash Flood RTX] registered=" + nativeConfigured +
        " · triangles=" + staticScene.triangleCount.toLocaleString() +
        " · vertices=" + staticScene.vertexCount.toLocaleString() +
        " · lights=" + staticScene.lightCount,
      );
    } catch (error) {
      console.warn("[Flash Flood RTX] Static setup failed; raster remains active: " + (error?.message || error));
    } finally {
      setupFinished = true;
    }
  })();

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    nativeRenderer.dispose();
    effects.dispose();
    water.dispose();
    beacons.dispose();
    atmosphere.dispose();
    gorge.dispose();
    if (rtx && capabilities.reflex) {
      try {
        rtx.requestFeatures?.({ reflexMode: previousReflexMode });
      } catch {
        // The host may already be tearing down its adapter.
      }
    }
    renderer.dispose();
    delete globalThis.__FLASH_FLOOD_DEMO__;
  }, { once: true });
}

await main();
