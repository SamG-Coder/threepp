import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createModeRouter } from "./app/mode-router.mjs";
import { createMainMenu } from "./modes/main-menu.mjs";

document.title = "Secret River — ThreeBrowser Runtime";

const MAX_INTERNAL_PIXELS = 3_200_000;
const MAX_INTERNAL_RATIO = 1.6;
const TARGET_FRAME_INTERVAL_MS = 1000 / 60;

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

  function currentViewport() {
    const width = Math.max(1, Number(innerWidth) || 1);
    const height = Math.max(1, Number(innerHeight) || 1);
    return Object.freeze({
      width,
      height,
      internalWidth: Math.max(1, Math.round(width * internalRatio)),
      internalHeight: Math.max(1, Math.round(height * internalRatio)),
      displayPixelRatio,
      internalRatio,
    });
  }

  let previousTime = performance.now();
  let nextFrameTime = previousTime;
  function resetFrameClock() {
    previousTime = performance.now();
    nextFrameTime = previousTime;
  }

  let router = null;
  async function requestMode(modeId) {
    const started = await router.activate(modeId);
    if (started) resetFrameClock();
    return started;
  }

  function modeContext() {
    return {
      renderer,
      rtx,
      viewport: currentViewport(),
      requestMode,
    };
  }

  router = createModeRouter({
    factories: {
      menu: () => createMainMenu({ renderer, onSelect: requestMode }),
      demo: async () => {
        const { createDemoMode } = await import("./modes/demo-mode.mjs");
        return createDemoMode(modeContext());
      },
      game: async () => {
        const { createGameMode } = await import("./modes/game-mode.mjs");
        if (typeof createGameMode !== "function") {
          throw new TypeError("Secret River game-mode.mjs must export createGameMode(context).");
        }
        return createGameMode(modeContext());
      },
    },
    onError(error, detail) {
      console.error(
        `[Secret River] ${detail.phase} ${detail.modeId} failed`,
        error?.message || error,
      );
    },
  });

  function resize() {
    const width = Math.max(1, Number(innerWidth) || 1);
    const height = Math.max(1, Number(innerHeight) || 1);
    internalRatio = chooseInternalRatio(width, height);
    renderer.setSize(width, height);
    router.resize(currentViewport());
  }
  globalThis.addEventListener("resize", resize);
  resize();

  if (!await router.activate("menu")) {
    throw new Error("Secret River main screen could not start.");
  }
  resetFrameClock();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (now + 0.25 < nextFrameTime) return;
    if (now - nextFrameTime > TARGET_FRAME_INTERVAL_MS * 2) nextFrameTime = now;
    nextFrameTime += TARGET_FRAME_INTERVAL_MS;
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.1, wallDelta);
    previousTime = now;
    router.frame({ now, delta, wallDelta });
  });
}

main().catch(error => {
  console.error("[Secret River] Failed to start", error);
  throw error;
});
