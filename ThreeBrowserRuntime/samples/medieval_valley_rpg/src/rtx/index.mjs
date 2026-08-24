import * as THREE from "three/webgpu";
import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "./native-reflections.mjs";
import { collectStaticReflectionScene } from "./static-scene.mjs";

const DEFAULT_FRAME_OPTIONS = Object.freeze({
  directionalLightDirection: [-0.42, 0.79, 0.45],
  reflectionStrength: 1.02,
  maxDistance: 260,
  rayBias: 0.014,
  roughnessCutoff: 0.92,
  environmentColor: [0.018, 0.027, 0.044],
  environmentIntensity: 0.78,
  highQuality: false,
});

function positiveInteger(value, fallback = 1) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function currentDrawingBufferSize(renderer, width, height) {
  const fallbackWidth = positiveInteger(width, positiveInteger(globalThis.innerWidth, 1));
  const fallbackHeight = positiveInteger(height, positiveInteger(globalThis.innerHeight, 1));
  try {
    const size = renderer?.getDrawingBufferSize?.(new THREE.Vector2());
    if (Number(size?.x) > 0 && Number(size?.y) > 0) {
      return {
        width: positiveInteger(size.x, fallbackWidth),
        height: positiveInteger(size.y, fallbackHeight),
      };
    }
  } catch {
    // A not-yet-initialized renderer can still be configured with an explicit
    // extent. The normal game startup initializes WebGPU before this module.
  }
  return { width: fallbackWidth, height: fallbackHeight };
}

function getLiveStatus(rtx) {
  try {
    return rtx?.getStatus?.() ?? null;
  } catch {
    return null;
  }
}

function featureRecord(liveStatus, capabilities, name, capabilityName = name) {
  const feature = liveStatus?.features?.[name] ?? null;
  return {
    supported: Boolean(feature?.supported ?? capabilities?.[capabilityName]),
    requested: Boolean(feature?.requested),
    // This is deliberately the only source of the active claim. Capability,
    // successful API calls and queued evaluations are not equivalent to the
    // runtime reporting the feature active.
    active: Boolean(feature?.active),
    reason: String(feature?.reason ?? ""),
    evaluationCount: Number(feature?.evaluationCount ?? 0),
    failureCount: Number(feature?.failureCount ?? 0),
  };
}

function truthfulFeatureStatus(rtx) {
  const live = getLiveStatus(rtx);
  const capabilities = rtx?.capabilities ?? {};
  return {
    nativeRayTracing: featureRecord(live, capabilities, "nativeRayTracing"),
    dlssRayReconstruction: featureRecord(
      live,
      capabilities,
      "dlssRayReconstruction",
    ),
    dlssSuperResolution: featureRecord(
      live,
      capabilities,
      "dlssSuperResolution",
    ),
    dlssFrameGeneration: featureRecord(
      live,
      capabilities,
      "dlssFrameGeneration",
    ),
    reflex: featureRecord(live, capabilities, "reflex"),
  };
}

function activeLabel(features, nativeFramePresented) {
  if (!nativeFramePresented || !features.nativeRayTracing.active) {
    return "WEBGPU FULL-RES FALLBACK";
  }
  const parts = ["RTX RAY-QUERY REFLECTIONS"];
  if (features.dlssRayReconstruction.active) parts.push("DLSS RR");
  else if (features.dlssSuperResolution.active) parts.push("DLSS SR");
  if (features.dlssFrameGeneration.active) parts.push("DLSS FG");
  if (features.reflex.active) parts.push("REFLEX");
  return parts.join(" · ");
}

async function compileProjectReflectionPipeline(rtx) {
  const canCompile = Boolean(
    (rtx?.capabilities?.rayQuery || rtx?.capabilities?.nativeRayTracing) &&
    typeof rtx?.compileRayQueryPipeline === "function",
  );
  if (!canCompile) return { pipeline: null, failure: "Ray-query shader compilation is unavailable." };

  try {
    const shaderUrl = new URL("./shaders/rpg_reflections.comp", import.meta.url);
    const response = await fetch(shaderUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading ${shaderUrl.pathname}`);
    }
    const source = await response.text();
    const pipeline = await rtx.compileRayQueryPipeline({
      profile: "reflections-v2",
      source,
      language: "glsl",
      stage: "compute",
      entryPoint: "main",
      label: "Medieval Valley wet stone, iron and fire-light reflections",
    });
    return { pipeline, failure: "" };
  } catch (error) {
    const failure = String(error?.message || error);
    console.warn(
      `[Medieval Valley RTX] Project reflection shader unavailable; ` +
      `the runtime's generic reflections-v2 pipeline will be attempted: ${failure}`,
    );
    return { pipeline: null, failure };
  }
}

/**
 * Creates the project's complete presentation boundary.
 *
 * Native registration is intentionally restricted to `world.staticRoots` and
 * `world.staticLights`. Player, NPC, enemy, particles, water displacement and
 * atmospheric objects remain raster-only and therefore never enter an
 * immutable native acceleration structure by accident.
 *
 * `render()` returns true only when the native ray-query frame was evaluated
 * and presented. False means the caller must render `scene`/`camera` normally;
 * no reduced-resolution or synthetic fallback is hidden in this module.
 */
export async function createRpgRenderPipeline({
  renderer,
  scene,
  camera,
  world,
  frameOptions = {},
} = {}) {
  if (!renderer || !scene || !camera || !world) {
    throw new TypeError(
      "createRpgRenderPipeline requires renderer, scene, camera and world.",
    );
  }

  const rtx = globalThis.navigator?.gpu?.threeBrowserRTX ?? null;
  const previousReflexMode = Number(rtx?.reflexMode ?? 0);
  const nativeRenderer = new NativeReflectionRenderer(renderer, camera, rtx, null);
  let disposed = false;
  let configured = false;
  let nativeFramePresented = false;
  let staticScene = null;
  let shaderPipeline = null;
  let shaderFailure = "";
  let setupFailure = "";
  let configuredWidth = 0;
  let configuredHeight = 0;

  const roots = Array.isArray(world.staticRoots)
    ? world.staticRoots.filter(Boolean)
    : [];
  const lights = Array.isArray(world.staticLights)
    ? world.staticLights.filter(Boolean)
    : [];

  if (rtx && roots.length > 0) {
    prepareReflectionGuideMaterials(scene);
    const compiled = await compileProjectReflectionPipeline(rtx);
    shaderPipeline = compiled.pipeline;
    shaderFailure = compiled.failure;
    nativeRenderer.reflectionPipeline = shaderPipeline;
    try {
      // No scene traversal is performed here: the collector receives only the
      // authored immutable roots and the eight selected fire/lantern lights.
      staticScene = collectStaticReflectionScene(roots, lights);
    } catch (error) {
      setupFailure = `Static RTX snapshot failed: ${error?.message || error}`;
      console.warn(`[Medieval Valley RTX] ${setupFailure}`);
    }
  } else if (!rtx) {
    setupFailure = "ThreeBrowser RTX runtime API is unavailable.";
  } else {
    setupFailure = "The world exposed no staticRoots for RTX registration.";
  }

  async function configure(width, height) {
    if (disposed || !staticScene) return false;
    const size = currentDrawingBufferSize(renderer, width, height);
    configuredWidth = size.width;
    configuredHeight = size.height;
    configured = await nativeRenderer.configure(
      configuredWidth,
      configuredHeight,
      staticScene,
    );
    if (!configured) {
      setupFailure = nativeRenderer.failure || setupFailure || "Native RTX configuration failed.";
    }
    nativeFramePresented = false;
    return configured;
  }

  function render(renderScene = scene, renderCamera = camera, options = {}) {
    if (disposed || !configured) {
      nativeFramePresented = false;
      return false;
    }
    const mergedOptions = {
      ...DEFAULT_FRAME_OPTIONS,
      ...frameOptions,
      ...options,
    };
    const evaluated = nativeRenderer.render(renderScene, renderCamera, mergedOptions);
    if (!evaluated) {
      configured = false;
      setupFailure = nativeRenderer.failure || "Native RTX evaluation stopped.";
      nativeFramePresented = false;
      return false;
    }
    const presented = nativeRenderer.present(options.hudTexture ?? null);
    nativeFramePresented = Boolean(presented);
    if (!presented) {
      configured = false;
      setupFailure = nativeRenderer.failure || "Native RTX presentation stopped.";
    }
    return nativeFramePresented;
  }

  function resize(width, height) {
    if (disposed || !configured) return false;
    // Renderer.setSize() should run first. Reading its drawing-buffer extent
    // preserves native pixel ratio and keeps DLSS input/output dimensions in
    // one transaction even when callers pass CSS pixel dimensions here.
    const size = currentDrawingBufferSize(renderer, width, height);
    configuredWidth = size.width;
    configuredHeight = size.height;
    configured = nativeRenderer.resize(configuredWidth, configuredHeight);
    nativeFramePresented = false;
    if (!configured) setupFailure = nativeRenderer.failure || "Native RTX resize failed.";
    return configured;
  }

  function status() {
    const features = truthfulFeatureStatus(rtx);
    const adaptive = nativeRenderer.getAdaptiveStatus();
    return {
      label: activeLabel(features, nativeFramePresented),
      path: nativeFramePresented && features.nativeRayTracing.active
        ? "native-ray-query"
        : "webgpu-full-resolution",
      configured,
      nativeFramePresented,
      projectShaderCompiled: Boolean(shaderPipeline),
      shaderFailure,
      failure: setupFailure || nativeRenderer.failure || "",
      registered: {
        roots: roots.length,
        lights: Math.min(lights.length, 8),
        vertices: Number(staticScene?.vertexCount ?? 0),
        triangles: Number(staticScene?.triangleCount ?? 0),
      },
      dimensions: {
        width: configuredWidth,
        height: configuredHeight,
        renderWidth: Number(adaptive.renderWidth ?? configuredWidth),
        renderHeight: Number(adaptive.renderHeight ?? configuredHeight),
      },
      features,
    };
  }

  function resetTemporalHistory(reason = "game discontinuity") {
    if (disposed) return;
    nativeRenderer.resetTemporalHistory(reason);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    configured = false;
    nativeFramePresented = false;
    nativeRenderer.dispose();
    shaderPipeline?.destroy?.();
    shaderPipeline = null;
    // The pipeline requests Reflex only through requestFeatures(). Restore the
    // host's prior mode instead of leaving a project-specific request behind.
    if (rtx?.capabilities?.reflex) {
      try {
        rtx.requestFeatures?.({ reflexMode: previousReflexMode });
      } catch (error) {
        console.warn(`[Medieval Valley RTX] Reflex restore failed: ${error?.message || error}`);
      }
    }
  }

  await configure();

  return {
    configure,
    render,
    resize,
    status,
    resetTemporalHistory,
    dispose,
  };
}

export { collectStaticReflectionScene, prepareReflectionGuideMaterials };

