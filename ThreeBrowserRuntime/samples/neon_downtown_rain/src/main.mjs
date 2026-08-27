import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import {
  DowntownReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "./native-rtx.mjs";
import {
  collectStaticReflectionScene,
} from "../../webgpu_rtx_light_transport_observatory/src/rtx-scene.mjs";
import {
  assertAssetCoverage,
  assertGenerationReport,
  disposeAssetCache,
  finishAssetReport,
  loadAssetManifest,
  loadGenerationReport,
  loadSceneConfig,
} from "./assets.mjs";
import { createDowntownActors } from "./actors.mjs";
import { createDowntownCamera } from "./camera.mjs";
import { createDowntownCards } from "./cards.mjs";
import { createInput } from "./input.mjs";
import { createDowntownLighting } from "./lighting.mjs";
import { createDowntownSurfaces } from "./surfaces.mjs";
import { createDowntownWeather } from "./weather.mjs";

document.title = "Neon Downtown Rain — ThreeBrowser Runtime";

const MAX_INTERNAL_PIXELS = 3_600_000;
const MAX_INTERNAL_RATIO = 1.65;

function choosePixelRatio(width, height) {
  const display = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  const budget = Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height));
  return Math.max(0.5, Math.min(MAX_INTERNAL_RATIO, display, budget));
}

function reportBridge(rtx) {
  const capabilities = rtx?.capabilities || {};
  const native = Boolean(capabilities.nativeRayTracing);
  console.log(
    "[Neon Downtown] adapter=" + (capabilities.adapterName || "unknown")
    + " · nativeRayTracing=" + native
    + " · rayLighting=" + (typeof rtx?.evaluateRayLighting === "function")
    + " · rayReflections=" + (typeof rtx?.evaluateRayReflections === "function"),
  );
  console.log(
    "[Neon Downtown] controls: A/D walk · W/S depth · Shift faster"
    + " · F fly inspection · R rain · RTX always-on when available",
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Neon Downtown Rain requires native WebGPU; there is no WebGL path.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#02050b";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  let internalRatio = choosePixelRatio(innerWidth, innerHeight);
  renderer.setPixelRatio(internalRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x02050b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  let config;
  let assetManifest;
  let generationReport;
  try {
    await renderer.init();
    if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
      throw new Error("WebGPURenderer did not initialize the native WebGPU backend.");
    }
    renderer.backend.device.addEventListener?.("uncapturederror", event => {
      console.error("[Neon Downtown WebGPU]", event.error?.message || event.error || event);
    });
    [config, assetManifest, generationReport] = await Promise.all([
      loadSceneConfig(),
      loadAssetManifest(),
      loadGenerationReport(),
    ]);
    try {
      assertGenerationReport(generationReport, assetManifest);
    } catch (error) {
      console.warn("[Neon Downtown] Grok report still being finalized: " + error.message);
    }
  } catch (error) {
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  const scene = new THREE.Scene();
  scene.name = config.name + " — all-2D perspective world";
  const camera = new THREE.PerspectiveCamera(48, innerWidth / Math.max(1, innerHeight), 0.12, 250);
  camera.name = "Side-on perspective camera";
  scene.add(camera);
  const input = createInput(renderer.domElement);
  const lighting = createDowntownLighting(scene, config.buildings);

  let surfaces = null;
  let cards = null;
  let actors = null;
  let weather = null;
  try {
    surfaces = await createDowntownSurfaces(scene, config);
    cards = await createDowntownCards(scene, config);
    actors = await createDowntownActors(scene, config, input);
    weather = await createDowntownWeather(scene, config);
    assertAssetCoverage(assetManifest.expectedAssetCount);
  } catch (error) {
    finishAssetReport({
      expectedAssets: assetManifest.expectedAssetCount,
      fatal: error?.message || String(error),
    });
    weather?.dispose?.();
    actors?.dispose?.();
    cards?.dispose?.();
    surfaces?.dispose?.();
    lighting.dispose();
    input.dispose();
    disposeAssetCache();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  const cameraRig = createDowntownCamera(camera, actors.player, input, config.world);
  cameraRig.update(1);
  finishAssetReport({
    expectedAssets: assetManifest.expectedAssetCount,
    city: config.name,
    modularBuildings: cards.buildings.length,
    movingWalkers: actors.walkers.length,
    trafficCards: actors.vehicles.length,
  });

  // Normalize both road variants for the native guide MRT. Only one material
  // can be attached to the flat road at a time, so visit each before startup.
  surfaces.setNativeMode(true);
  prepareReflectionGuideMaterials(scene);
  surfaces.setNativeMode(false);
  prepareReflectionGuideMaterials(scene);
  const rtx = navigator.gpu?.threeBrowserRTX || null;
  reportBridge(rtx);
  if (rtx?.capabilities?.reflex) {
    try {
      rtx.requestFeatures?.({
        reflex: "boost",
        dlssSuperResolution: false,
        dlssFrameGeneration: false,
        dlssRayReconstruction: false,
      });
    } catch (error) {
      console.warn("[Neon Downtown] Reflex request failed: " + (error?.message || error));
    }
  }

  let staticScene = null;
  if (
    rtx
    && typeof rtx.registerStaticScene === "function"
    && typeof rtx.evaluateRayReflections === "function"
  ) {
    try {
      staticScene = collectStaticReflectionScene(
        [surfaces.proxyGroup, cards.proxyGroup],
        lighting.rtxLights,
      );
    } catch (error) {
      console.warn("[Neon Downtown RTX] Flat-scene collection failed: " + (error?.message || error));
    } finally {
      surfaces.hideProxies();
      cards.hideProxies();
    }
  } else {
    surfaces.hideProxies();
    cards.hideProxies();
  }

  const reflectionRenderer = new DowntownReflectionRenderer(renderer, camera, rtx, null);
  const displaySize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const nativeConfigured = staticScene
    ? await reflectionRenderer.configure(displaySize.x, displaySize.y, staticScene)
    : false;
  const state = {
    elapsed: 0,
    rain: true,
    nativeConfigured,
    nativeRequested: nativeConfigured,
    nativeActive: false,
  };
  function setNativeRequested(enabled, configured = state.nativeConfigured) {
    state.nativeConfigured = Boolean(configured);
    state.nativeRequested = Boolean(enabled) && state.nativeConfigured;
    surfaces.setNativeMode(state.nativeRequested);
    lighting.setNativeRayMode(state.nativeRequested);
  }
  setNativeRequested(nativeConfigured, nativeConfigured);
  globalThis.__NEON_DOWNTOWN_STATE__ = state;
  console.log(
    "[Neon Downtown] world ready · flatCards=" + cards.records.length
    + " · walkers=" + (actors.walkers.length + 1)
    + " · traffic=" + actors.vehicles.length
    + " · reflection=" + (nativeConfigured ? "native rays over flat image cards" : "planar image cards"),
  );

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    internalRatio = choosePixelRatio(width, height);
    renderer.setPixelRatio(internalRatio);
    renderer.setSize(width, height);
    cameraRig.resize(width, height);
    if (state.nativeConfigured) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!reflectionRenderer.resize(size.x, size.y)) {
        setNativeRequested(false, false);
      }
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === "KeyR") {
      state.rain = !state.rain;
      weather.setEnabled(state.rain);
      actors.setRainEnabled(state.rain);
      surfaces.setRainEnabled(state.rain);
      console.log("[Neon Downtown] rain=" + (state.rain ? "on" : "off"));
    }
  }
  globalThis.addEventListener("keydown", onKeyDown);

  let previousTime = performance.now();
  let diagnosticTime = 0;
  let diagnosticFrames = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.05, wallDelta);
    previousTime = now;
    state.elapsed += delta;
    diagnosticTime += wallDelta;
    diagnosticFrames += 1;

    actors.update(state.elapsed, delta);
    cameraRig.update(delta);
    cards.update(state.elapsed);
    surfaces.update(state.elapsed);
    weather.update(state.elapsed);
    lighting.update(
      state.elapsed,
      cameraRig.flyMode ? camera.position : actors.player.position,
      delta,
    );

    renderer.info.reset();
    let nativeRendered = false;
    if (state.nativeRequested && state.nativeConfigured) {
      nativeRendered = reflectionRenderer.render(scene, camera, {
        directionalLightDirection: lighting.moonDirection.toArray(),
        reflectionStrength: 0.52,
        maxDistance: 150,
        rayBias: 0.012,
        roughnessCutoff: 0.88,
        environmentColor: [0.006, 0.014, 0.028],
        environmentIntensity: 0.24,
        highQuality: true,
      });
    }
    state.nativeActive = nativeRendered;

    if (nativeRendered && !reflectionRenderer.present(null)) {
      nativeRendered = false;
      state.nativeActive = false;
      setNativeRequested(false, false);
      console.warn("[Neon Downtown] Native present failed; restored pure planar reflection.");
    }
    if (!nativeRendered) {
      if (state.nativeRequested && state.nativeConfigured) {
        setNativeRequested(false, false);
        console.warn("[Neon Downtown] Native ray path stopped; restored pure planar reflection.");
      }
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const rasterRendered = reflectionRenderer.renderRaster(scene, camera, size.x, size.y);
      if (
        !rasterRendered
        || !reflectionRenderer.present(null, reflectionRenderer.rasterTarget?.texture)
      ) {
        renderer.setRenderTarget(null);
        renderer.setMRT(null);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
      }
    }

    if (diagnosticTime >= 8) {
      const fps = Math.round(diagnosticFrames / Math.max(0.001, diagnosticTime));
      const renderInfo = renderer.info?.render || {};
      console.log(
        "[Neon Downtown] fps=" + fps
        + " · drawCalls=" + (renderInfo.drawCalls ?? renderInfo.calls ?? 0)
        + " · triangles=" + Number(renderInfo.triangles || 0).toLocaleString()
        + " · camera=" + (cameraRig.flyMode ? "fly" : "character")
        + " · rain=" + state.rain
        + " · path=" + (state.nativeActive ? "native-ray flat-card" : "WebGPU planar"),
      );
      diagnosticTime = 0;
      diagnosticFrames = 0;
    }
  });

  function dispose() {
    renderer.setAnimationLoop(null);
    globalThis.removeEventListener("resize", resize);
    globalThis.removeEventListener("keydown", onKeyDown);
    input.dispose();
    weather.dispose();
    actors.dispose();
    cards.dispose();
    surfaces.setNativeMode(false);
    surfaces.dispose();
    lighting.dispose();
    reflectionRenderer.dispose();
    disposeAssetCache();
    renderer.dispose();
    renderer.domElement.remove();
  }
  globalThis.addEventListener("beforeunload", dispose, { once: true });
}

main().catch(error => {
  console.error("[Neon Downtown fatal]", error);
  throw error;
});
