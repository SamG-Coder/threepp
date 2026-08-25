import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createInfiniteScaleHud } from "./hud.mjs";
import { updateMaterialUniforms } from "./materials.mjs";
import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "./native-reflections.mjs";
import { collectStaticReflectionSceneAsync } from "./rtx-scene.mjs";
import { ScaleJourney, formatScale } from "./scale-model.mjs";
import { createScaleSystem } from "./scale-system.mjs";

document.title = "RTX Infinite Descent — ThreeBrowser Runtime";

const TEST_MODE = globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_TEST_MODE === "1";
const TEST_REPORT = globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_REPORT || "";
const TEST_REBASE_TARGET = Math.max(
  2,
  Math.trunc(Number(globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_TEST_REBASES) || 8),
);
const TEST_SPEED = THREE.MathUtils.clamp(
  Number(globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_TEST_SPEED) || 8,
  0.1,
  16,
);
const TEST_WAIT_FOR_PREWARM = TEST_MODE &&
  globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_TEST_WAIT_FOR_PREWARM === "1";
const TEST_HOLD_AFTER_PREWARM = TEST_MODE &&
  globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_TEST_HOLD_AFTER_PREWARM === "1";
const TEST_START_SECONDS = TEST_MODE
  ? Math.max(0, Number(globalThis.process?.env?.THREEBROWSER_INFINITE_SCALE_TEST_START_SECONDS) || 0)
  : 0;
const DOMAIN_BACKGROUND = Object.freeze([
  0x020307,
  0x090b0d,
  0x090c10,
  0x030811,
  0x01040b,
  0x09020d,
  0x02000a,
]);
const DOMAIN_EXPOSURE = Object.freeze([0.91, 1.02, 1.0, 1.14, 1.18, 1.08, 1.22]);
const DOMAIN_FOG = Object.freeze([0.018, 0.012, 0.026, 0.034, 0.018, 0.032, 0.026]);

function chooseRasterRatio(width, height) {
  const pixels = Math.max(1, width * height);
  const budget = Math.sqrt(4_300_000 / pixels);
  return Math.max(1, Math.min(1.65, budget));
}

function addEnvironmentPanel(scene, size, position, rotation, hex, intensity) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(hex).multiplyScalar(intensity),
    side: THREE.DoubleSide,
    fog: false,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
  panel.position.set(...position);
  panel.rotation.set(...rotation);
  scene.add(panel);
}

function createEnvironment(renderer) {
  const environment = new THREE.Scene();
  environment.background = new THREE.Color(0x020308);
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 18, 30),
    new THREE.MeshBasicNodeMaterial({ color: 0x090d13, side: THREE.BackSide, fog: false }),
  );
  room.position.y = 3;
  environment.add(room);
  addEnvironmentPanel(environment, [8, 2.4], [-8.5, 2.2, -8], [0, 0.45, 0], 0xff6a18, 8.4);
  addEnvironmentPanel(environment, [5, 9], [10, 2.8, -3], [0, -Math.PI * 0.5, 0], 0x8ac8ec, 5.2);
  addEnvironmentPanel(environment, [2, 12], [0, 4, 13], [0, Math.PI, 0], 0xffb55e, 2.7);
  addEnvironmentPanel(environment, [12, 0.7], [0, -4.7, 1], [Math.PI * 0.5, 0, 0], 0x6193b2, 2.2);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(environment, 0.045, 0.1, 70, {
    size: 128,
    position: new THREE.Vector3(0, 2, 0),
  });
  generator.dispose();
  environment.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

async function createProjectReflectionPipeline(rtx) {
  if (!rtx?.capabilities?.rayQuery || typeof rtx.compileRayQueryPipeline !== "function") return null;
  try {
    const shaderUrl = new URL("../shaders/infinite_scale_reflections.comp", import.meta.url);
    const response = await fetch(shaderUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${shaderUrl.pathname}`);
    const source = await response.text();
    const pipeline = await rtx.compileRayQueryPipeline({
      profile: "reflections-v2",
      source,
      language: "glsl",
      stage: "compute",
      entryPoint: "main",
      label: "Infinite Descent deterministic three-bounce forge reflections",
    });
    console.log(
      `[Infinite Descent] Project GLSL ready` +
      ` · cache=${pipeline?.cacheHit ? "hit" : "compiled"}` +
      ` · profile=${pipeline?.profile || "reflections-v2"}`,
    );
    return pipeline;
  } catch (error) {
    console.warn(`[Infinite Descent] Project ray-query shader unavailable: ${error?.message || error}`);
    return null;
  }
}

function featureSnapshot(rtx, adaptive = {}) {
  const status = adaptive.runtimeStatus ?? rtx?.getStatus?.() ?? {};
  const features = status.features ?? {};
  return {
    nativeRayTracingActive: Boolean(features.nativeRayTracing?.active),
    rayReconstructionActive: Boolean(features.dlssRayReconstruction?.active),
    superResolutionActive: Boolean(features.dlssSuperResolution?.active),
    frameGenerationActive: Boolean(features.dlssFrameGeneration?.active),
    reflexActive: Boolean(features.reflex?.active),
    rayReconstructionRequested: Boolean(features.dlssRayReconstruction?.requested),
    superResolutionRequested: Boolean(features.dlssSuperResolution?.requested),
    frameGenerationRequested: Boolean(features.dlssFrameGeneration?.requested),
    reflexRequested: Boolean(features.reflex?.requested),
    path: adaptive.path ?? "RASTER",
    reasons: {
      rr: features.dlssRayReconstruction?.reason ?? "",
      sr: features.dlssSuperResolution?.reason ?? "",
      fg: features.dlssFrameGeneration?.reason ?? "",
      reflex: features.reflex?.reason ?? "",
    },
    evaluations: {
      rr: Number(features.dlssRayReconstruction?.evaluationCount ?? 0),
      sr: Number(features.dlssSuperResolution?.evaluationCount ?? 0),
      generated: Number(features.dlssFrameGeneration?.generatedFrameCount ?? 0),
    },
  };
}

function heapMegabytes() {
  const bytes = Number(globalThis.process?.memoryUsage?.().heapUsed ?? 0);
  return bytes > 0 ? bytes / (1024 * 1024) : 0;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Native WebGPU is required; Infinite Descent has no WebGL fallback.");
  }

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DOMAIN_EXPOSURE[0];
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.setClearColor(DOMAIN_BACKGROUND[0], 1);
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) throw new Error("WebGPURenderer did not initialize WebGPU.");

  const diagnostics = {
    startedAt: new Date().toISOString(),
    testMode: TEST_MODE,
    testSpeed: TEST_MODE ? TEST_SPEED : 1,
    waitedForPrewarm: TEST_WAIT_FOR_PREWARM,
    transitions: [],
    webgpuErrors: [],
    frames: 0,
    cyclesCompleted: 0,
    maxHeapMB: heapMegabytes(),
    minHeapMB: heapMegabytes(),
    frameTiming: {
      samples: 0,
      maxMs: 0,
      over50Ms: 0,
      boundaries: [],
      transitionEvents: [],
      phaseMaxMs: { scaleUpdate: 0, sceneRender: 0, hudPresent: 0 },
      transitionPhaseMaxMs: { scaleUpdate: 0, sceneRender: 0, hudPresent: 0 },
    },
    complete: false,
  };
  globalThis.__infiniteScaleDiagnostics = diagnostics;
  renderer.backend.device?.addEventListener?.("uncapturederror", event => {
    const message = String(event.error?.message || event.error || event);
    diagnostics.webgpuErrors.push(message);
    console.error(`[Infinite Descent WebGPU validation] ${message}`);
  });

  const scene = new THREE.Scene();
  scene.name = "RTX Infinite Descent scale-rebased world";
  scene.background = new THREE.Color(DOMAIN_BACKGROUND[0]);
  scene.fog = new THREE.FogExp2(DOMAIN_BACKGROUND[0], DOMAIN_FOG[0]);
  const camera = new THREE.PerspectiveCamera(48, innerWidth / Math.max(1, innerHeight), 0.004, 100);
  const cameraTarget = new THREE.Vector3();
  const environmentTarget = createEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1.05;

  // This dim camera-independent fill prevents the smallest representations
  // from becoming unlit when their authored orange/blue sources move far away.
  const continuityFill = new THREE.HemisphereLight(0x315a7a, 0x401505, 0.35);
  continuityFill.userData.rtxIgnore = true;
  scene.add(continuityFill);

  let reflectionRenderer = null;
  let currentSample = null;
  let lastRebaseIndex = -1;
  const scaleSystem = createScaleSystem(scene, {
    onRebase(event) {
      reflectionRenderer?.resetTemporalHistory?.(`scale rebase to ${event.current.id}`);
      const heapMB = heapMegabytes();
      diagnostics.maxHeapMB = Math.max(diagnostics.maxHeapMB, heapMB);
      diagnostics.minHeapMB = diagnostics.minHeapMB > 0 ? Math.min(diagnostics.minHeapMB, heapMB) : heapMB;
      diagnostics.transitions.push({
        index: event.index,
        domain: event.current.id,
        rebase: event.rebaseCount,
        cycle: event.cycle,
        time: performance.now(),
        heapMB,
      });
      lastRebaseIndex = event.index;
      console.log(
        `[Infinite Descent] REBASE ${event.rebaseCount}` +
        ` · ${event.previous?.id ?? "origin"} -> ${event.current.id}` +
        ` · heap=${heapMB.toFixed(1)}MB` +
        " · temporal history reset",
      );
    },
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const previousReflexMode = rtx?.reflexMode ?? 0;
  prepareReflectionGuideMaterials(scene);
  let reflectionPipeline = null;
  reflectionRenderer = new NativeReflectionRenderer(renderer, camera, rtx, null);

  const forge = scaleSystem.byId.get("forge");
  const nativeSetupAvailable = typeof rtx?.evaluateRayReflections === "function";
  let nativeSetupFinished = !nativeSetupAvailable;
  let nativeSetupStarted = false;
  let nativeSetupPromise = null;
  let shuttingDown = false;

  const journey = new ScaleJourney({
    speed: TEST_MODE ? TEST_SPEED : 1,
    paused: TEST_WAIT_FOR_PREWARM,
  });
  if (TEST_START_SECONDS > 0) journey.seconds = TEST_START_SECONDS;
  const state = {
    speed: journey.speed,
    nativeConfigured: false,
    nativeFrame: false,
    dragging: false,
    pointerStart: new THREE.Vector2(),
    lookOffset: new THREE.Vector2(),
    lookTarget: new THREE.Vector2(),
    lastRtxStatus: featureSnapshot(rtx),
  };

  function requestReflexOnly() {
    if (!rtx?.capabilities?.reflex) return;
    rtx.requestFeatures?.({
      reflex: "boost",
      dlssSuperResolution: false,
      dlssRayReconstruction: false,
      dlssFrameGeneration: false,
    });
  }

  const yieldToJourney = () => new Promise(resolve => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => resolve());
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });

  function withDomainConfiguration(indices, target, mrtLayout, callback) {
    const rootStates = scaleSystem.domains.map(domain => ({
      root: domain.root,
      visible: domain.root.visible,
      position: domain.root.position.clone(),
      quaternion: domain.root.quaternion.clone(),
      scale: domain.root.scale.clone(),
    }));
    const objectStates = [];
    try {
      for (const domain of scaleSystem.domains) domain.root.visible = false;
      const configurationOffset = scaleSystem.domains[indices[0]].zoneOffset;
      for (const index of indices) {
        const domain = scaleSystem.domains[index];
        // A handoff places both representations in the outgoing domain cell.
        // Matching that here also warms its real cross-domain shadow passes;
        // keeping the incoming root in its distant atlas cell misses them.
        domain.root.position.copy(configurationOffset);
        domain.root.quaternion.identity();
        domain.root.scale.setScalar(1);
        domain.root.visible = true;
        domain.root.traverse(object => {
          if (object === domain.root) return;
          objectStates.push({
            object,
            visible: object.visible,
            frustumCulled: object.frustumCulled,
          });
          object.visible = true;
          if (object.isMesh || object.isPoints || object.isLine) object.frustumCulled = false;
        });
        domain.root.updateWorldMatrix(true, true);
      }

      const previousTarget = renderer.getRenderTarget();
      const previousMrt = renderer.getMRT();
      const previousToneMapping = renderer.toneMapping;
      const previousExposure = renderer.toneMappingExposure;
      try {
        renderer.setMRT(mrtLayout);
        renderer.setRenderTarget(target);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
        return callback();
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setMRT(previousMrt);
        renderer.toneMapping = previousToneMapping;
        renderer.toneMappingExposure = previousExposure;
      }
    } finally {
      for (const saved of objectStates) {
        saved.object.visible = saved.visible;
        saved.object.frustumCulled = saved.frustumCulled;
      }
      for (const saved of rootStates) {
        saved.root.visible = saved.visible;
        saved.root.position.copy(saved.position);
        saved.root.quaternion.copy(saved.quaternion);
        saved.root.scale.copy(saved.scale);
        saved.root.updateWorldMatrix(true, true);
      }
    }
  }

  async function compileDomainConfigurations(configurations, target, mrtLayout, label) {
    for (const indices of configurations) {
      await yieldToJourney();
      if (shuttingDown) return false;

      // WebGPU pipeline compatibility includes the attachment layout. Compile
      // the real scene/light cache with culling disabled, then submit one
      // offscreen priming draw so geometry/bindings are resident too.
      const compilation = withDomainConfiguration(
        indices,
        target,
        mrtLayout,
        () => renderer.compileAsync(scene, camera),
      );
      await compilation;
      await yieldToJourney();
      if (shuttingDown) return false;
      withDomainConfiguration(indices, target, mrtLayout, () => {
        renderer.render(scene, camera);
      });
    }
    console.log(`[Infinite Descent] ${label} domain pipelines and buffers are GPU-prewarmed.`);
    return true;
  }

  let domainPrewarmFinished = typeof renderer.compileAsync !== "function";
  let domainPrewarmPromise = Promise.resolve(domainPrewarmFinished);
  function beginDomainPipelinePrewarm() {
    if (typeof renderer.compileAsync !== "function") {
      domainPrewarmFinished = true;
      return domainPrewarmPromise;
    }
    const count = scaleSystem.domains.length;
    const pairs = Array.from({ length: count }, (_, index) => [index, (index + 1) % count]);
    const singles = Array.from({ length: count }, (_, index) => [index]);
    const width = Math.max(1, Math.round(innerWidth * rasterRatio));
    const height = Math.max(1, Math.round(innerHeight * rasterRatio));
    const rasterTarget = reflectionRenderer.rasterTarget ??
      reflectionRenderer._ensureRasterTarget(width, height);
    domainPrewarmFinished = false;
    domainPrewarmPromise = compileDomainConfigurations(
      [...pairs, ...singles],
      rasterTarget,
      null,
      "All raster single-domain and handoff",
    ).catch(error => {
      console.warn(`[Infinite Descent] Background raster prewarm incomplete: ${error?.message || error}`);
      return false;
    }).finally(() => {
      domainPrewarmFinished = true;
    });
    return domainPrewarmPromise;
  }

  async function initializeNativeInBackground() {
    if (nativeSetupStarted) return nativeSetupPromise;
    nativeSetupStarted = true;
    if (!nativeSetupAvailable) {
      requestReflexOnly();
      nativeSetupFinished = true;
      console.log(
        `[Infinite Descent] RTX setup · adapter=${rtx?.capabilities?.adapterName || "unavailable"}` +
        " · ray path unavailable · raster journey remains continuous",
      );
      return false;
    }

    nativeSetupFinished = false;
    nativeSetupPromise = (async () => {
      let staticRoots = [];
      try {
        console.log("[Infinite Descent] Journey live · RTX atlas is streaming cooperatively in the background.");
        staticRoots = scaleSystem.domains.map(domain => {
          const clone = domain.root.clone(true);
          clone.visible = true;
          clone.position.copy(domain.zoneOffset);
          clone.quaternion.identity();
          clone.scale.setScalar(1);
          clone.updateWorldMatrix(true, true);
          return clone;
        });
        const staticLights = scaleSystem.persistentLights
          .filter(entry => entry.domainIndex === 0)
          .map(entry => entry.light)
          .filter(light => light.isPointLight || light.isSpotLight);

        const [pipeline, staticScene] = await Promise.all([
          createProjectReflectionPipeline(rtx),
          collectStaticReflectionSceneAsync(staticRoots, staticLights, {
            timeBudgetMs: TEST_MODE && TEST_SPEED > 1 ? 2.5 : 0.75,
            shouldAbort: () => shuttingDown,
          }),
        ]);
        if (shuttingDown) return false;
        reflectionPipeline = pipeline;
        reflectionRenderer.reflectionPipeline = pipeline;
        staticScene.instanceGroups = [forge.rtxInstanceGroup];
        console.log(
          `[Infinite Descent] Scale-atlas TLAS source` +
          ` · ${staticScene.vertexCount.toLocaleString()} vertices` +
          ` · ${staticScene.triangleCount.toLocaleString()} triangles` +
          " · off-camera tool gallery included",
        );

        const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        const configured = await reflectionRenderer.configure(
          drawingSize.x,
          drawingSize.y,
          staticScene,
        );
        if (shuttingDown) return false;
        if (configured && typeof renderer.compileAsync === "function") {
          await domainPrewarmPromise;
          const singles = Array.from(
            { length: scaleSystem.domains.length },
            (_, index) => [index],
          );
          await compileDomainConfigurations(
            singles,
            reflectionRenderer.sceneTarget,
            reflectionRenderer._mrt,
            "All native MRT",
          );
          // Leave every two-domain raster handoff as the most recently
          // materialized render context after native MRT warming. Three's
          // render-object cache otherwise rebuilds those variants on entry.
          const rasterPairs = Array.from(
            { length: scaleSystem.domains.length },
            (_, index) => [index, (index + 1) % scaleSystem.domains.length],
          );
          await compileDomainConfigurations(
            rasterPairs,
            reflectionRenderer.rasterTarget,
            null,
            "All final raster handoff",
          );
          if (shuttingDown) return false;
        }
        state.nativeConfigured = configured;
        if (!configured) requestReflexOnly();
        state.lastRtxStatus = featureSnapshot(rtx, reflectionRenderer.getAdaptiveStatus?.());
        console.log(
          `[Infinite Descent] RTX setup` +
          ` · adapter=${rtx?.capabilities?.adapterName || "unavailable"}` +
          ` · rayPath=${configured ? "ready without stopping the journey" : "raster fallback"}` +
          " · claims follow getStatus().features.*.active only",
        );
        return configured;
      } catch (error) {
        if (!shuttingDown && error?.name !== "AbortError") {
          console.warn(`[Infinite Descent] Background RTX setup unavailable: ${error?.message || error}`);
          requestReflexOnly();
        }
        state.nativeConfigured = false;
        return false;
      } finally {
        for (const root of staticRoots) root.clear();
        nativeSetupFinished = true;
      }
    })();
    return nativeSetupPromise;
  }

  function handleKey(key, event) {
    if (key === " ") {
      journey.togglePaused();
      reflectionRenderer.resetTemporalHistory("pause toggled");
    } else if (key === "r") {
      journey.reverse();
      reflectionRenderer.resetTemporalHistory("direction reversed");
    } else if (key === "+" || key === "=") {
      journey.setSpeed(journey.speed * 1.25);
      state.speed = journey.speed;
    } else if (key === "-" || key === "_") {
      journey.setSpeed(journey.speed / 1.25);
      state.speed = journey.speed;
    } else if (/^[1-7]$/.test(key)) {
      journey.jumpTo(Number(key) - 1);
      reflectionRenderer.resetTemporalHistory(`debug jump ${key}`);
    } else if (key === "a") {
      journey.paused = false;
      journey.direction = 1;
      journey.setSpeed(1);
      state.speed = journey.speed;
    } else {
      return;
    }
    event?.preventDefault?.();
  }

  const hud = createInfiniteScaleHud({ renderer, onKey: handleKey });

  function onPointerDown(event) {
    if (event.button !== 0) return;
    state.dragging = true;
    state.pointerStart.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.pointerStart.x;
    const dy = event.clientY - state.pointerStart.y;
    state.pointerStart.set(event.clientX, event.clientY);
    state.lookTarget.x = THREE.MathUtils.clamp(state.lookTarget.x - dx * 0.0018, -0.16, 0.16);
    state.lookTarget.y = THREE.MathUtils.clamp(state.lookTarget.y - dy * 0.0015, -0.11, 0.11);
  }
  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }
  function onWheel(event) {
    journey.setSpeed(journey.speed * Math.exp(-Math.sign(event.deltaY) * 0.16));
    state.speed = journey.speed;
    event.preventDefault?.();
  }
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  let rasterRatio = chooseRasterRatio(innerWidth, innerHeight);
  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    rasterRatio = chooseRasterRatio(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    hud.resize(width, height);
    if (state.nativeConfigured) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!reflectionRenderer.resize(size.x, size.y)) {
        state.nativeConfigured = false;
        console.warn("[Infinite Descent] Adaptive resize failed; persistent raster presentation restored.");
      }
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

  const backgroundColor = new THREE.Color();
  const targetBackground = new THREE.Color();
  const cameraForward = new THREE.Vector3();
  const neutralLookTarget = new THREE.Vector2();
  const renderSize = new THREE.Vector2();
  const nativeInstanceUpdates = [null];
  let rtxSparkActiveState = null;
  const nativeFrameOptions = {
    directionalLightDirection: [-0.36, 0.79, 0.49],
    reflectionStrength: 1.08,
    maxDistance: 86,
    rayBias: 0.006,
    roughnessCutoff: 0.92,
    environmentColor: [0.018, 0.028, 0.046],
    environmentIntensity: 0.82,
    highQuality: true,
  };
  let previousTime = performance.now();
  let elapsed = 0;
  let statusFrame = 0;
  let diagnosticFrames = 0;
  let diagnosticSeconds = 0;
  let measuredFps = 0;
  let testFinalizing = false;
  let observedRebaseCount = 0;
  let activeTimingProbes = [];
  let wasTransitioning = false;
  let wasSettling = false;
  const recentFrameTimes = [];
  const testFrameTimes = [];

  function startTimingProbe(collection, kind, scaleState, frameTimeMs) {
    const probe = {
      kind,
      rebase: scaleState.rebaseCount,
      domain: scaleState.current.id,
      beforeMs: recentFrameTimes.slice(0, -1),
      afterMs: [frameTimeMs],
    };
    collection.push(probe);
    activeTimingProbes.push(probe);
    return probe;
  }

  function pipelineStats() {
    const programs = renderer._pipelines?.programs ?? {};
    return {
      pipelines: Number(renderer._pipelines?.caches?.size ?? 0),
      vertexPrograms: Number(programs.vertex?.size ?? 0),
      fragmentPrograms: Number(programs.fragment?.size ?? 0),
    };
  }

  async function finishAutomatedValidation() {
    if (testFinalizing) return;
    testFinalizing = true;
    diagnostics.complete = diagnostics.webgpuErrors.length === 0 &&
      diagnostics.transitions.length >= TEST_REBASE_TARGET;
    diagnostics.finishedAt = new Date().toISOString();
    diagnostics.cyclesCompleted = Math.max(0, Math.floor((diagnostics.transitions.length - 1) / 7));
    diagnostics.heapGrowthMB = diagnostics.transitions.length > 1
      ? diagnostics.transitions.at(-1).heapMB - diagnostics.transitions[0].heapMB
      : 0;
    diagnostics.rtx = featureSnapshot(rtx, reflectionRenderer.getAdaptiveStatus?.());
    const boundaryTimes = diagnostics.frameTiming.boundaries
      .filter(boundary => boundary.rebase > 1)
      .flatMap(boundary => [...boundary.beforeMs, ...boundary.afterMs]);
    const transitionTimes = diagnostics.frameTiming.transitionEvents
      .flatMap(event => [...event.beforeMs, ...event.afterMs]);
    diagnostics.frameTiming.p50Ms = percentile(testFrameTimes, 0.5);
    diagnostics.frameTiming.p95Ms = percentile(testFrameTimes, 0.95);
    diagnostics.frameTiming.p99Ms = percentile(testFrameTimes, 0.99);
    diagnostics.frameTiming.boundaryMaxMs = boundaryTimes.length ? Math.max(...boundaryTimes) : 0;
    diagnostics.frameTiming.boundaryP95Ms = percentile(boundaryTimes, 0.95);
    diagnostics.frameTiming.boundarySpikeRatio = diagnostics.frameTiming.p95Ms > 0
      ? diagnostics.frameTiming.boundaryMaxMs / diagnostics.frameTiming.p95Ms
      : 0;
    diagnostics.frameTiming.transitionMaxMs = transitionTimes.length ? Math.max(...transitionTimes) : 0;
    diagnostics.frameTiming.transitionP95Ms = percentile(transitionTimes, 0.95);
    diagnostics.frame = {
      count: diagnostics.frames,
      fps: measuredFps,
      drawCalls: renderer.info?.render?.drawCalls ?? 0,
      triangles: renderer.info?.render?.triangles ?? 0,
    };
    if (TEST_REPORT) {
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(TEST_REPORT, JSON.stringify(diagnostics, null, 2), "utf8");
      } catch (error) {
        diagnostics.complete = false;
        console.error(`[Infinite Descent test] Could not write report: ${error?.message || error}`);
      }
    }
    console.log(
      `[Infinite Descent test] ${diagnostics.complete ? "PASS" : "FAIL"}` +
      ` · transitions=${diagnostics.transitions.length}` +
      ` · WebGPU errors=${diagnostics.webgpuErrors.length}` +
      ` · heap growth=${diagnostics.heapGrowthMB.toFixed(1)}MB` +
      ` · speed=${diagnostics.testSpeed}×` +
      ` · boundary max=${diagnostics.frameTiming.boundaryMaxMs.toFixed(1)}ms` +
      ` · transition max=${diagnostics.frameTiming.transitionMaxMs.toFixed(1)}ms`,
    );
    setTimeout(() => globalThis.process?.exit?.(diagnostics.complete ? 0 : 2), 250);
  }

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const frameTimeMs = wallDelta * 1000;
    const delta = Math.min(0.05, wallDelta);
    previousTime = now;
    elapsed += delta;
    diagnostics.frames += 1;
    diagnosticFrames += 1;
    diagnosticSeconds += wallDelta;
    diagnostics.frameTiming.samples += 1;
    diagnostics.frameTiming.maxMs = Math.max(diagnostics.frameTiming.maxMs, frameTimeMs);
    if (frameTimeMs > 50) diagnostics.frameTiming.over50Ms += 1;
    recentFrameTimes.push(frameTimeMs);
    if (recentFrameTimes.length > 8) recentFrameTimes.shift();
    if (TEST_MODE && testFrameTimes.length < 20_000) testFrameTimes.push(frameTimeMs);

    if (TEST_WAIT_FOR_PREWARM && !TEST_HOLD_AFTER_PREWARM && journey.paused && nativeSetupStarted &&
        nativeSetupFinished && domainPrewarmFinished) {
      journey.paused = false;
      console.log("[Infinite Descent test] Prewarm complete; accelerated journey released.");
    }
    const scaleUpdateStarted = performance.now();
    currentSample = journey.update(delta);
    const scaleState = scaleSystem.update(currentSample, elapsed, delta, camera, cameraTarget);
    const scaleUpdateMs = performance.now() - scaleUpdateStarted;
    for (const probe of activeTimingProbes) {
      if (probe.afterMs.length < 12) probe.afterMs.push(frameTimeMs);
    }
    activeTimingProbes = activeTimingProbes.filter(probe => probe.afterMs.length < 12);
    if (scaleState.rebaseCount !== observedRebaseCount) {
      observedRebaseCount = scaleState.rebaseCount;
      startTimingProbe(
        diagnostics.frameTiming.boundaries,
        "rebase",
        scaleState,
        frameTimeMs,
      );
    }
    const isTransitioning = scaleState.transitionAmount >= 0.002;
    if (!wasTransitioning && isTransitioning) {
      const probe = startTimingProbe(
        diagnostics.frameTiming.transitionEvents,
        "handoff-start",
        scaleState,
        frameTimeMs,
      );
      probe.pipelineBefore = pipelineStats();
    }
    if (wasSettling && !scaleState.settling) {
      startTimingProbe(
        diagnostics.frameTiming.transitionEvents,
        "settlement-end",
        scaleState,
        frameTimeMs,
      );
    }
    wasTransitioning = isTransitioning;
    wasSettling = scaleState.settling;
    const smoothing = 1 - Math.exp(-delta * 5.5);
    state.lookOffset.lerp(state.dragging ? state.lookTarget : neutralLookTarget, smoothing);
    camera.lookAt(cameraTarget);
    camera.rotateY(state.lookOffset.x);
    camera.rotateX(state.lookOffset.y);
    camera.rotateZ(Math.sin(elapsed * 0.11) * 0.0035);
    camera.updateProjectionMatrix();

    updateMaterialUniforms(
      elapsed,
      Math.max(0.08, 1 - currentSample.index * 0.13),
      0.28 + currentSample.index * 0.12,
    );
    targetBackground.setHex(DOMAIN_BACKGROUND[currentSample.index]);
    backgroundColor.copy(scene.background).lerp(targetBackground, 1 - Math.exp(-delta * 2.8));
    scene.background.copy(backgroundColor);
    scene.fog.color.copy(backgroundColor);
    scene.fog.density = THREE.MathUtils.lerp(
      scene.fog.density,
      DOMAIN_FOG[currentSample.index],
      1 - Math.exp(-delta * 2.2),
    );
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      renderer.toneMappingExposure,
      DOMAIN_EXPOSURE[currentSample.index],
      1 - Math.exp(-delta * 1.8),
    );
    continuityFill.intensity = 0.28 + currentSample.index * 0.035;

    const sceneRenderStarted = performance.now();
    renderer.info.reset();
    // Every normalized domain owns one isolated cell in the immutable AS atlas.
    // The camera/root rebase together; transitions use raster until the incoming
    // cell is authoritative, so no stale geometry is ever queried.
    const nativeFrame = Boolean(
      state.nativeConfigured &&
      scaleState.transitionAmount < 0.002 &&
      !scaleState.settling,
    );
    let rendered = false;
    if (nativeFrame) {
      const sparksActive = currentSample.index === 0;
      if (sparksActive || rtxSparkActiveState !== sparksActive) {
        nativeInstanceUpdates[0] = forge.rayTracingInstanceUpdate(sparksActive);
        reflectionRenderer.updateInstanceGroups(nativeInstanceUpdates);
        rtxSparkActiveState = sparksActive;
      }
      rendered = reflectionRenderer.render(scene, camera, nativeFrameOptions);
    }
    state.nativeFrame = nativeFrame && rendered;

    renderSize.set(
      Math.max(1, Math.round(innerWidth * rasterRatio)),
      Math.max(1, Math.round(innerHeight * rasterRatio)),
    );
    if (!rendered) {
      rendered = reflectionRenderer.renderRaster(scene, camera, renderSize.x, renderSize.y);
    }
    const sceneRenderMs = performance.now() - sceneRenderStarted;

    const hudPresentStarted = performance.now();
    if ((statusFrame++ % 12) === 0) {
      const adaptive = reflectionRenderer.getAdaptiveStatus?.() ?? {};
      state.lastRtxStatus = featureSnapshot(rtx, adaptive);
      const heap = heapMegabytes();
      diagnostics.maxHeapMB = Math.max(diagnostics.maxHeapMB, heap);
      diagnostics.minHeapMB = diagnostics.minHeapMB > 0 ? Math.min(diagnostics.minHeapMB, heap) : heap;
    }
    hud.update({
      scale: formatScale(currentSample.logMeters),
      domain: currentSample.domain.label,
      progress: currentSample.cycleProgress,
      index: currentSample.index,
      paused: journey.paused,
      direction: journey.direction,
      speed: journey.speed,
      rebaseCount: scaleState.rebaseCount,
      streaming: scaleState.streaming,
      nativeFrame: state.nativeFrame,
      rtxStatus: state.lastRtxStatus,
      fps: measuredFps,
    });
    const hudTexture = hud.renderToTexture();
    const sourceTexture = state.nativeFrame
      ? undefined
      : reflectionRenderer.rasterTarget?.texture;
    if (!rendered || !reflectionRenderer.present(hudTexture, sourceTexture)) {
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.clearDepth();
      hud.render();
    }
    const hudPresentMs = performance.now() - hudPresentStarted;
    const latestTransitionEvent = diagnostics.frameTiming.transitionEvents.at(-1);
    if (latestTransitionEvent?.kind === "handoff-start" &&
        latestTransitionEvent.pipelineAfter === undefined) {
      latestTransitionEvent.pipelineAfter = pipelineStats();
    }
    const phaseMax = diagnostics.frameTiming.phaseMaxMs;
    phaseMax.scaleUpdate = Math.max(phaseMax.scaleUpdate, scaleUpdateMs);
    phaseMax.sceneRender = Math.max(phaseMax.sceneRender, sceneRenderMs);
    phaseMax.hudPresent = Math.max(phaseMax.hudPresent, hudPresentMs);
    if (isTransitioning || scaleState.settling) {
      const transitionPhaseMax = diagnostics.frameTiming.transitionPhaseMaxMs;
      transitionPhaseMax.scaleUpdate = Math.max(transitionPhaseMax.scaleUpdate, scaleUpdateMs);
      transitionPhaseMax.sceneRender = Math.max(transitionPhaseMax.sceneRender, sceneRenderMs);
      transitionPhaseMax.hudPresent = Math.max(transitionPhaseMax.hudPresent, hudPresentMs);
    }
    // The animated journey is the loading screen. Optional raster/native
    // preparation continues cooperatively after the first visible frames.
    if (diagnostics.frames > 2) {
      document.getElementById("startup")?.remove();
    }

    if (diagnosticSeconds >= 4) {
      measuredFps = Math.round(diagnosticFrames / Math.max(0.001, diagnosticSeconds));
      diagnosticFrames = 0;
      diagnosticSeconds = 0;
      const info = renderer.info?.render ?? {};
      console.log(
        `[Infinite Descent] ${currentSample.domain.label}` +
        ` · ${formatScale(currentSample.logMeters)}` +
        ` · fps=${measuredFps}` +
        ` · draws=${info.drawCalls ?? 0}` +
        ` · triangles=${Number(info.triangles ?? 0).toLocaleString()}` +
        ` · path=${state.nativeFrame ? state.lastRtxStatus.path : "RASTER DOMAIN"}`,
      );
    }

    if (TEST_MODE && diagnostics.transitions.length >= TEST_REBASE_TARGET &&
        nativeSetupFinished && domainPrewarmFinished && !scaleState.settling) {
      finishAutomatedValidation();
    }
  });

  // Let the first raster frame reach the window before any optional pipeline
  // or RTX preparation begins. Both tasks then yield cooperatively while the
  // already-built seven-domain journey continues to animate.
  const scheduleBackgroundPreparation = () => {
    beginDomainPipelinePrewarm();
    void initializeNativeInBackground();
  };
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => globalThis.setTimeout(scheduleBackgroundPreparation, 0));
  } else {
    globalThis.setTimeout(scheduleBackgroundPreparation, 0);
  }

  globalThis.addEventListener("beforeunload", () => {
    shuttingDown = true;
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    globalThis.removeEventListener("resize", resize);
    hud.dispose();
    scaleSystem.dispose();
    reflectionRenderer.dispose();
    reflectionPipeline?.destroy?.();
    environmentTarget.dispose();
    if (rtx?.capabilities?.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    renderer.dispose();
  });
}

await main();
