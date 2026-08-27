import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createAtmosphere } from "./atmosphere.mjs";
import { createFaceOnCamera } from "./camera.mjs";
import { createFlora } from "./flora.mjs";
import { createHills } from "./hills.mjs";
import { createInput } from "./input.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { createRiver } from "./river.mjs";
import { collectStaticRiverScene } from "./rtx-scene.mjs";
import { createTerrain } from "./terrain.mjs";
import { createTreeFlats } from "./trees.mjs";
import { createWalker } from "./walker.mjs";

document.title = "Secret River — ThreeBrowser Runtime";

const MAX_INTERNAL_PIXELS = 3_200_000;
const MAX_INTERNAL_RATIO = 1.6;
const TARGET_FRAME_INTERVAL_MS = 1000 / 60;
const PRESET_KEYS = Object.freeze(["morning", "midday", "afternoon", "sunset", "night"]);

function chooseInternalRatio(width, height) {
  const budgetRatio = Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height));
  return Math.min(MAX_INTERNAL_RATIO, budgetRatio);
}

function reportBridge(rtx) {
  if (!rtx) {
    console.warn("[Secret River] RTX bridge unavailable; the WebGPU/TSL riverbank remains active.");
    return;
  }
  const capabilities = rtx.capabilities ?? {};
  const native = rtx.getStatus?.()?.features?.nativeRayTracing;
  console.log(
    `[Secret River] bridge=${capabilities.adapterName || "unknown"}` +
    ` · nativeRayTraversal=${Boolean(native?.supported ?? capabilities.nativeRayTracing)}` +
    ` · rayLighting=${typeof rtx.evaluateRayLighting === "function"}` +
    ` · rayReflections=${typeof rtx.evaluateRayReflections === "function"}`,
  );
}

function applyCutoutTint(preset, trees, flora, walker) {
  const tint = preset?.treeTint ?? [1, 1, 1];
  const color = new THREE.Color(tint[0], tint[1], tint[2]);
  trees.setTint?.(color);
  flora.setTint?.(color);
  walker.setTint?.(color);
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Secret River requires native WebGPU; there is no WebGL path.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#8aa3b0";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  let internalRatio = chooseInternalRatio(innerWidth, innerHeight);
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0xb7c7d4, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
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
  renderer.backend.device.addEventListener?.("uncapturederror", event => {
    console.error("[Secret River WebGPU validation]", event.error?.message || event.error || event);
  });

  const scene = new THREE.Scene();
  scene.name = "Hawkesbury riverbank";
  scene.userData.renderer = renderer;
  const camera = new THREE.PerspectiveCamera(52, innerWidth / Math.max(1, innerHeight), 0.15, 280);

  const atmosphere = createAtmosphere(scene);
  const terrain = await createTerrain();
  scene.add(terrain.group);
  const river = createRiver();
  scene.add(river.mesh);
  const hills = await createHills();
  scene.add(hills.group);
  const trees = await createTreeFlats();
  scene.add(trees.group);
  const flora = await createFlora();
  scene.add(flora.group);
  const walker = await createWalker();
  scene.add(walker.mesh);
  applyCutoutTint(atmosphere.getPreset(), trees, flora, walker);

  const follow = createFaceOnCamera(camera, walker);
  follow.update(1);
  atmosphere.updateFocus(walker.position, 1);
  const input = createInput();

  prepareRtxGuideMaterials(scene);
  // The planar reflector sees the actual alpha-cutout artwork. Native scene
  // hits use simplified shadow volumes, so applying those reflections to the
  // creek would replace faithful trees with opaque proxy blobs.
  river.mesh.material.rtxReflectionMask = 0;

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
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
      console.warn(`[Secret River] Reflex request failed: ${error?.message || error}`);
    }
  }

  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx);
  let staticScene = null;
  if (rtx && (typeof rtx.evaluateRayLighting === "function" ||
      typeof rtx.evaluateRayReflections === "function")) {
    try {
      staticScene = collectStaticRiverScene(
        [
          ...terrain.rtxRoots,
          ...(hills.rtxRoots ?? []),
          ...trees.rtxRoots,
          ...(flora.rtxRoots ?? []),
        ],
        atmosphere.campfire ? [atmosphere.campfire] : [],
      );
    } catch (error) {
      console.warn(`[Secret River RTX] Static-scene collection failed: ${error?.message || error}`);
    } finally {
      trees.hideProxies();
      flora.hideProxies?.();
    }
  } else {
    trees.hideProxies();
    flora.hideProxies?.();
  }

  const internalSize = (scale = 1) => new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * internalRatio * scale)),
    Math.max(1, Math.round(innerHeight * internalRatio * scale)),
  );
  const initialSize = internalSize();
  nativeRenderer.resize(initialSize.x, initialSize.y);
  const nativeConfigured = staticScene
    ? await nativeRenderer.configure(initialSize.x, initialSize.y, staticScene)
    : false;

  const state = {
    rtxRequested: nativeConfigured && nativeRenderer.rayLightingReady,
    elapsed: 0,
    preset: "afternoon",
  };

  function useNativePath() {
    return Boolean(state.rtxRequested && nativeRenderer.rayLightingReady);
  }

  function syncShadowPath() {
    atmosphere.setRayTracedShadows(useNativePath());
  }

  syncShadowPath();

  function setPreset(name) {
    const preset = atmosphere.applyPreset(name);
    state.preset = name;
    renderer.toneMappingExposure = preset.exposure;
    applyCutoutTint(preset, trees, flora, walker);
    console.log(`[Secret River] atmosphere=${preset.name}`);
  }

  function toggleRtx() {
    if (!nativeConfigured || !nativeRenderer.enabled) {
      state.rtxRequested = false;
      return;
    }
    state.rtxRequested = !state.rtxRequested;
    syncShadowPath();
    console.log(`[Secret River] path=${state.rtxRequested ? "RTX" : "WebGPU raster"}`);
  }

  globalThis.addEventListener("keydown", event => {
    if (event.repeat) return;
    const key = String(event.key || "");
    if (key === "1" || key === "2" || key === "3" || key === "4" || key === "5") {
      setPreset(PRESET_KEYS[Number(key) - 1]);
    } else if (key.toLowerCase() === "x") {
      toggleRtx();
    }
  });

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    internalRatio = chooseInternalRatio(width, height);
    follow.resize(width, height);
    renderer.setSize(width, height);
    nativeRenderer.resize(internalSize().x, internalSize().y);
    if (!nativeRenderer.enabled) state.rtxRequested = false;
    syncShadowPath();
  }
  globalThis.addEventListener("resize", resize);
  resize();

  let previousTime = performance.now();
  let nextFrameTime = previousTime;
  let diagnosticTime = 0;
  let diagnosticFrames = 0;
  let diagnosticWallTime = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (now + 0.25 < nextFrameTime) return;
    if (now - nextFrameTime > TARGET_FRAME_INTERVAL_MS * 2) nextFrameTime = now;
    nextFrameTime += TARGET_FRAME_INTERVAL_MS;
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.1, wallDelta);
    previousTime = now;
    state.elapsed += delta;
    diagnosticTime += delta;
    diagnosticFrames += 1;
    diagnosticWallTime += wallDelta;

    walker.update(delta, input.axis());
    follow.update(delta);
    atmosphere.updateFocus(walker.position, delta);
    river.update(state.elapsed);
    flora.update?.(state.elapsed);
    trees.update?.(state.elapsed);

    const preset = atmosphere.getPreset();
    renderer.info.reset();
    let nativeRendered = false;
    let offscreenRendered = false;
    if (useNativePath()) {
      nativeRendered = nativeRenderer.render(scene, camera, {
        skipReflections: true,
        skipLighting: false,
        celestialDirection: atmosphere.sunDirection,
        celestialIntensity: preset.rtxCelestialIntensity,
        shadowStrength: preset.rtxShadowStrength,
        aoStrength: preset.rtxAoStrength,
      });
    }
    if (!nativeRendered) {
      if (state.rtxRequested && !nativeRenderer.rayLightingReady) {
        state.rtxRequested = false;
        syncShadowPath();
      }
      offscreenRendered = nativeRenderer.renderRaster(scene, camera);
    }
    if (nativeRendered || offscreenRendered) {
      if (!nativeRenderer.present(null, 0)) {
        nativeRendered = false;
        offscreenRendered = false;
      }
    }
    if (!nativeRendered && !offscreenRendered) {
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    }

    if (diagnosticTime >= 7) {
      diagnosticTime = 0;
      const fps = diagnosticWallTime > 0 ? Math.round(diagnosticFrames / diagnosticWallTime) : 0;
      const renderInfo = renderer.info?.render ?? {};
      console.log(
        `[Secret River] fps=${fps}` +
        ` · calls=${renderInfo.drawCalls ?? renderInfo.calls ?? 0}` +
        ` · trees=${trees.records.length}` +
        ` · flora=${flora.records.length}` +
        ` · atmosphere=${preset.name}` +
        ` · path=${nativeRendered || offscreenRendered ? nativeRenderer.lastPath : "webgpu-fallback"}` +
        ` · pos=${walker.position.x.toFixed(1)},${walker.position.z.toFixed(1)}`,
      );
      diagnosticFrames = 0;
      diagnosticWallTime = 0;
    }
  });
}

main().catch(error => {
  console.error("[Secret River] Failed to start", error);
  throw error;
});
