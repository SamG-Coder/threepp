import * as THREE from "three/webgpu";
import {
  diffuseColor,
  materialReference,
  metalness,
  mix,
  mrt,
  normalWorld,
  output,
  roughness,
  velocity,
  vec3,
  vec4,
} from "three/tsl";

const STREAMLINE_VIEWPORT = 0;
const FRAME_GENERATION_WARMUP = 8;

function rowMajor(matrix) {
  return matrix.clone().transpose().toArray();
}

// The generic lighting bridge intentionally supports a changing frame seed so
// callers with a history buffer can temporally accumulate its stochastic soft
// shadows and AO. This project has no history/denoising pass, so a moving seed
// becomes visible glitter. Spend more rays spatially and keep their sequence
// fixed instead; camera motion remains responsive while each surface point's
// lighting is stable from frame to frame.
const LIGHTING_SEQUENCE_SEED = 0;
const DIRECTIONAL_LIGHTING_SAMPLES = 4;
const AMBIENT_OCCLUSION_SAMPLES = 8;

function makeResource(texture, layout, width, height) {
  // Keep the concise public name and the bridge's explicit Vulkan spelling;
  // current runtimes read vulkanLayout while older prototypes read layout.
  return { texture, layout, vulkanLayout: layout, left: 0, top: 0, width, height };
}

function requireUsage(texture, flag, label) {
  if ((Number(texture?.usage ?? 0) & flag) !== flag) {
    throw new Error(`${label} is missing GPUTextureUsage 0x${flag.toString(16)}.`);
  }
}

function positiveInteger(value, fallback = 1) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeMaterial(material) {
  if (!material) return;
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  // Standard/physical node materials assign the resolved TSL roughness and
  // metalness properties. Basic node materials do not, so their numeric
  // compatibility values remain the conservative guide fallback.
  material.rtxUsesResolvedPbr = material.isMeshStandardNodeMaterial ? 1 : 0;
  if (!Number.isFinite(material.rtxReflectionMask)) {
    if (material.transparent || Number(material.opacity ?? 1) < 0.995) {
      material.rtxReflectionMask = 0;
    } else {
      const glossy = 1 - THREE.MathUtils.clamp(material.roughness, 0, 1);
      const metallic = THREE.MathUtils.clamp(material.metalness, 0, 1);
      const clearcoat = THREE.MathUtils.clamp(Number(material.clearcoat ?? 0), 0, 1);
      material.rtxReflectionMask = THREE.MathUtils.clamp(
        metallic * 0.74 + clearcoat * 0.34 + glossy * 0.18,
        0,
        1,
      );
    }
  }
}

export function prepareReflectionGuideMaterials(scene) {
  scene.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) normalizeMaterial(material);
  });
}

async function waitForStaticScene(rtx, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  let status = rtx?.getStatus?.() ?? rtx?.status ?? null;
  while (performance.now() < deadline) {
    const feature = status?.features?.nativeRayTracing;
    if (feature?.active) return { ready: true, status, feature };
    if (feature?.supported === false) return { ready: false, status, feature };
    await new Promise(resolve => setTimeout(resolve, 8));
    status = rtx?.getStatus?.() ?? rtx?.status ?? status;
  }
  return { ready: false, status, feature: status?.features?.nativeRayTracing ?? null };
}

/**
 * Owns the public Three.js MRT resources consumed by the native reflection
 * bridge. Returning false from render() is the complete fallback boundary: the
 * caller then renders the same scene through its three planar reflectors.
 */
export class NativeReflectionRenderer {
  constructor(renderer, camera, rtx, reflectionPipeline = null) {
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.reflectionPipeline = reflectionPipeline;
    this.device = renderer.backend?.device ?? null;
    this.enabled = false;
    this.sceneRegistered = false;
    this.rayLightingEnabled = typeof rtx?.evaluateRayLighting === "function";
    this.rayLightingFailure = "";
    this.failure = "";
    this.width = 0;
    this.height = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this.frameIndex = 0;
    this.sceneTarget = null;
    this.outputTarget = null;
    this.hitDistanceTarget = null;
    this.reconstructedTarget = null;
    this.hudlessTarget = null;
    this.rasterTarget = null;
    this.adaptiveEnabled = false;
    this.adaptiveFrameReady = false;
    this.adaptiveRequestInitialized = false;
    // Keep the page's requested feature set separate from the effective native
    // state. Runtime controls may temporarily mask a feature without changing
    // the page intent; a later resize must still update that feature's stored
    // Streamline output extent so re-enabling it cannot resurrect stale sizes.
    this.pageRayReconstructionRequested = false;
    this.pageSuperResolutionRequested = false;
    this.pageFrameGenerationRequested = false;
    this.rayReconstructionRequested = false;
    this.rayReconstructionFailed = false;
    this.superResolutionRequested = false;
    this.superResolutionFailed = false;
    this.frameGenerationRequested = false;
    this.frameGenerationRuntimeRequested = false;
    this.frameGenerationFailed = false;
    this.frameGenerationWarmup = 0;
    this.resetHistory = true;
    this.presentationPath = "NATIVE OP84";
    this.rayReconstructionEvaluations = 0;
    this.superResolutionEvaluations = 0;
    this.frameGenerationTags = 0;
    this.rayReconstructionFailureCount = 0;
    this.superResolutionFailureCount = 0;
    this.frameGenerationFailureCount = 0;
    this._lastFrameConstants = null;

    // These property nodes are assigned by NodeMaterial.setupVariants() before
    // the renderer evaluates its MRT. Unlike materialReference(), they include
    // each material's procedural colorNode, roughnessNode and metalnessNode.
    const resolvedPbr = materialReference("rtxUsesResolvedPbr", "float")
      .clamp(0, 1);
    const guideRoughness = mix(
      materialReference("roughness", "float"),
      roughness,
      resolvedPbr,
    ).clamp(0.02, 1);
    const guideMetalness = mix(
      materialReference("metalness", "float"),
      metalness,
      resolvedPbr,
    ).clamp(0, 1);
    const guideMask = materialReference("rtxReflectionMask", "float")
      .clamp(0, 1);
    const specularF0 = mix(vec3(0.04), diffuseColor.rgb, guideMetalness);
    this._mrt = mrt({
      output,
      velocity,
      diffuseAlbedo: vec4(diffuseColor.rgb, 1),
      // Exact world-space xyz in [-1, 1]. Do not octahedrally encode this guide.
      normalRoughness: vec4(normalWorld, guideRoughness),
      specularAlbedo: vec4(specularF0, guideMask),
    });

    // One and only one renderer submission touches the canvas. The first quad
    // uses the exact presentation path that already proved the native OP84
    // output, while the second alpha-blends the JS HUD texture rendered
    // offscreen by hud.mjs.
    this._displayScene = new THREE.Scene();
    this._displayScene.name = "Native reflection and JS HUD presentation";
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._displayGeometry = new THREE.PlaneGeometry(2, 2);
    // Raw Vulkan storage writes use the inverse V convention of a texture
    // produced by Three's own render-target path. Flip only the OP84 quad.
    const nativeUvs = this._displayGeometry.getAttribute("uv");
    for (let index = 0; index < nativeUvs.count; ++index) {
      nativeUvs.setY(index, 1 - nativeUvs.getY(index));
    }
    nativeUvs.needsUpdate = true;
    // WebGPURenderer compiles a texture node into the material pipeline. Keep
    // one material per source texture so switching between native output and
    // the raster fallback never leaves a stale binding behind.
    this._displayMaterialCache = new Map();
    this._displayPlaceholderMaterial = this._createDisplayMaterial(null);
    this._displayMaterial = this._displayPlaceholderMaterial;
    this._displayQuad = new THREE.Mesh(this._displayGeometry, this._displayMaterial);
    this._displayQuad.name = "Native reflected HDR output";
    this._displayQuad.renderOrder = 0;
    this._displayQuad.frustumCulled = false;
    this._displayScene.add(this._displayQuad);

    this._hudGeometry = new THREE.PlaneGeometry(2, 2);
    // The offscreen HUD target uses framebuffer coordinates too. Flip its V
    // axis at the final fullscreen sample so top-left UI remains top-left.
    const hudUvs = this._hudGeometry.getAttribute("uv");
    for (let index = 0; index < hudUvs.count; ++index) {
      hudUvs.setY(index, 1 - hudUvs.getY(index));
    }
    hudUvs.needsUpdate = true;
    this._hudMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._hudMaterial.toneMapped = false;
    this._hudQuad = new THREE.Mesh(this._hudGeometry, this._hudMaterial);
    this._hudQuad.name = "JS HUD texture overlay";
    this._hudQuad.renderOrder = 1;
    this._hudQuad.frustumCulled = false;
    this._hudQuad.visible = false;
    this._displayScene.add(this._hudQuad);

    // Adaptive presentation is deliberately a second offscreen boundary. It
    // tone maps the one RR/SR result into persistent full-resolution RGBA8;
    // only present() touches the swapchain and composites the independently
    // rendered JS HUD exactly once.
    this._presentScene = new THREE.Scene();
    this._presentScene.name = "Adaptive HUD-less color and JS HUD presentation";
    this._presentMaterial = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._presentMaterial.toneMapped = false;
    this._presentQuad = new THREE.Mesh(this._displayGeometry, this._presentMaterial);
    this._presentQuad.frustumCulled = false;
    this._presentQuad.renderOrder = 0;
    this._presentScene.add(this._presentQuad);
    this._presentHudQuad = new THREE.Mesh(this._hudGeometry, this._hudMaterial);
    this._presentHudQuad.frustumCulled = false;
    this._presentHudQuad.renderOrder = 1;
    this._presentHudQuad.visible = false;
    this._presentScene.add(this._presentHudQuad);

    this._viewProjection = new THREE.Matrix4();
    this._inverseViewProjection = new THREE.Matrix4();
    this._previousViewProjection = new THREE.Matrix4();
    this._clipToPreviousClip = new THREE.Matrix4();
    this._previousClipToClip = new THREE.Matrix4();
    this._identity = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();
    this._cameraUp = new THREE.Vector3();
    this._cameraRight = new THREE.Vector3();
    this._cameraForward = new THREE.Vector3();
  }

  _createDisplayMaterial(texture) {
    const material = new THREE.MeshBasicNodeMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    material.toneMapped = true;
    return material;
  }

  _displayMaterialFor(texture) {
    if (!texture) return this._displayPlaceholderMaterial;
    let material = this._displayMaterialCache.get(texture);
    if (!material) {
      material = this._createDisplayMaterial(texture);
      this._displayMaterialCache.set(texture, material);
    }
    return material;
  }

  _setDisplayTexture(texture) {
    const material = this._displayMaterialFor(texture);
    if (material === this._displayMaterial) return;
    this._displayMaterial = material;
    this._displayQuad.material = material;
  }

  _releaseDisplayTextures(textures) {
    for (const texture of textures) {
      if (!texture) continue;
      const material = this._displayMaterialCache.get(texture);
      if (!material) continue;
      if (this._displayMaterial === material) {
        this._displayMaterial = this._displayPlaceholderMaterial;
        this._displayQuad.material = this._displayPlaceholderMaterial;
      }
      this._displayMaterialCache.delete(texture);
      material.dispose();
    }
  }

  _adaptiveSettings(outputWidth, outputHeight) {
    const options = {
      mode: "quality",
      outputWidth,
      outputHeight,
      preExposure: 1,
      exposureScale: 1,
      colorBuffersHDR: true,
      autoExposure: false,
      alphaUpscaling: false,
    };
    if (!this.rtx?.capabilities?.dlssSuperResolution ||
        typeof this.rtx.getOptimalSettings !== "function" ||
        typeof this.rtx.evaluateSuperResolution !== "function") {
      return { options, width: outputWidth, height: outputHeight, enabled: false };
    }
    const settings = this.rtx.getOptimalSettings(options);
    const width = positiveInteger(settings?.optimalRenderWidth, outputWidth);
    const height = positiveInteger(settings?.optimalRenderHeight, outputHeight);
    return { options, settings, width, height, enabled: true };
  }

  _requestAdaptiveFeatures(options, {
    preserveIntent = false,
    includeReflex = true,
  } = {}) {
    const rrAvailable = Boolean(
      this.rtx?.capabilities?.dlssRayReconstruction &&
      typeof this.rtx.evaluateRayReconstruction === "function",
    );
    const srAvailable = Boolean(
      this.rtx?.capabilities?.dlssSuperResolution &&
      typeof this.rtx.evaluateSuperResolution === "function",
    );
    const fgAvailable = Boolean(
      this.rtx?.capabilities?.dlssFrameGeneration &&
      typeof this.rtx.tagFrameGeneration === "function",
    );
    const rr = rrAvailable &&
      (!preserveIntent || this.pageRayReconstructionRequested);
    // RR is built on the DLSS viewport configuration. Keep SR requested when
    // RR is desired even if an older caller only recorded the RR intent.
    const sr = srAvailable &&
      (!preserveIntent || this.pageSuperResolutionRequested || rr);
    const fg = fgAvailable &&
      (!preserveIntent || this.pageFrameGenerationRequested);
    this.pageRayReconstructionRequested = rr;
    this.pageSuperResolutionRequested = sr;
    this.pageFrameGenerationRequested = fg;

    const request = {
      dlssSuperResolution: sr ? options : false,
      dlssRayReconstruction: rr ? options : false,
      dlssFrameGeneration: fg,
    };
    // Omitting Reflex during resize preserves the page's existing mode instead
    // of silently forcing Boost whenever only the DLSS extent changed.
    if (includeReflex) request.reflex = this.rtx?.capabilities?.reflex ? "boost" : false;
    this.rtx.releaseViewport?.(STREAMLINE_VIEWPORT);
    const status = this.rtx.requestFeatures?.(request);
    this.adaptiveRequestInitialized = true;
    this.rayReconstructionRequested = rr;
    this.rayReconstructionFailed = false;
    this.superResolutionRequested = sr;
    this.superResolutionFailed = false;
    this.frameGenerationRequested = fg;
    this.frameGenerationRuntimeRequested = fg;
    this.frameGenerationFailed = false;
    this.frameGenerationWarmup = fg ? FRAME_GENERATION_WARMUP : 0;
    this.rayReconstructionEvaluations = 0;
    this.superResolutionEvaluations = 0;
    this.frameGenerationTags = 0;
    this.rayReconstructionFailureCount = Number(
      status?.features?.dlssRayReconstruction?.failureCount ?? 0,
    );
    this.superResolutionFailureCount = Number(
      status?.features?.dlssSuperResolution?.failureCount ?? 0,
    );
    this.frameGenerationFailureCount = Number(
      status?.features?.dlssFrameGeneration?.failureCount ?? 0,
    );
    this._syncAdaptiveFeatureRequests(status);
    return status;
  }

  _validateAdaptiveConfiguration(status, adaptive, outputWidth, outputHeight) {
    const feature = status?.features?.dlssSuperResolution;
    if (feature?.configured) {
      const renderWidth = positiveInteger(feature.renderWidth, 0);
      const renderHeight = positiveInteger(feature.renderHeight, 0);
      const configuredOutputWidth = positiveInteger(feature.outputWidth, 0);
      const configuredOutputHeight = positiveInteger(feature.outputHeight, 0);
      if (renderWidth !== adaptive.width || renderHeight !== adaptive.height ||
          configuredOutputWidth !== outputWidth || configuredOutputHeight !== outputHeight) {
        throw new Error(
          `Streamline configured ${renderWidth}x${renderHeight} -> ` +
          `${configuredOutputWidth}x${configuredOutputHeight}; expected ` +
          `${adaptive.width}x${adaptive.height} -> ${outputWidth}x${outputHeight}.`,
        );
      }
      return;
    }

    const reason = String(feature?.reason ?? "");
    const runtimeMasked = reason === "Disabled from runtime controls" ||
      reason.startsWith("Blocked by runtime controls:");
    if (!runtimeMasked) {
      throw new Error(reason || "Streamline did not configure the resized DLSS viewport.");
    }
  }

  _syncAdaptiveFeatureRequests(status = this.rtx?.getStatus?.()) {
    const features = status?.features;
    if (!features || !this.adaptiveRequestInitialized) {
      return {
        adaptiveRequested:
          this.rayReconstructionRequested || this.superResolutionRequested,
      };
    }

    const previousRayReconstruction = this.rayReconstructionRequested;
    const previousSuperResolution = this.superResolutionRequested;
    const previousFrameGeneration = this.frameGenerationRuntimeRequested;
    const rayReconstruction = Boolean(
      features.dlssRayReconstruction?.requested &&
      this.rtx?.capabilities?.dlssRayReconstruction &&
      typeof this.rtx.evaluateRayReconstruction === "function",
    );
    const superResolution = Boolean(
      features.dlssSuperResolution?.requested &&
      this.rtx?.capabilities?.dlssSuperResolution &&
      typeof this.rtx.evaluateSuperResolution === "function",
    );
    const frameGenerationRequestedByRuntime = Boolean(
      features.dlssFrameGeneration?.requested &&
      this.rtx?.capabilities?.dlssFrameGeneration &&
      typeof this.rtx.tagFrameGeneration === "function",
    );
    const frameGeneration = frameGenerationRequestedByRuntime &&
      !this.frameGenerationFailed;
    const rayReconstructionFailureCount = Number(
      features.dlssRayReconstruction?.failureCount ?? 0,
    );
    const superResolutionFailureCount = Number(
      features.dlssSuperResolution?.failureCount ?? 0,
    );
    const frameGenerationFailureCount = Number(
      features.dlssFrameGeneration?.failureCount ?? 0,
    );

    this.rayReconstructionRequested = rayReconstruction;
    this.superResolutionRequested = superResolution;
    this.frameGenerationRequested = frameGeneration;
    this.frameGenerationRuntimeRequested = frameGenerationRequestedByRuntime;
    if (rayReconstruction && !previousRayReconstruction) {
      this.rayReconstructionFailed = false;
      this.rayReconstructionFailureCount = rayReconstructionFailureCount;
    } else if (rayReconstruction &&
        rayReconstructionFailureCount > this.rayReconstructionFailureCount) {
      // Streamline evaluation executes during queue submission. A native
      // failure therefore cannot be caught around evaluateRayReconstruction;
      // observe its counter on the next frame and activate the SR fallback.
      this.rayReconstructionFailed = true;
      this.rayReconstructionFailureCount = rayReconstructionFailureCount;
    } else if (!rayReconstruction) {
      this.rayReconstructionFailed = false;
      this.rayReconstructionFailureCount = rayReconstructionFailureCount;
    }
    if (superResolution && !previousSuperResolution) {
      this.superResolutionFailed = false;
      this.superResolutionFailureCount = superResolutionFailureCount;
    } else if (superResolution &&
        superResolutionFailureCount > this.superResolutionFailureCount) {
      this.superResolutionFailed = true;
      this.superResolutionFailureCount = superResolutionFailureCount;
    } else if (!superResolution) {
      this.superResolutionFailed = false;
      this.superResolutionFailureCount = superResolutionFailureCount;
    }
    if (rayReconstruction !== previousRayReconstruction ||
        superResolution !== previousSuperResolution) {
      this.resetTemporalHistory("adaptive path changed");
    }
    if (frameGenerationRequestedByRuntime && !previousFrameGeneration) {
      this.frameGenerationFailed = false;
      this.frameGenerationRequested = true;
      this.frameGenerationWarmup = FRAME_GENERATION_WARMUP;
      this.frameGenerationFailureCount = frameGenerationFailureCount;
    } else if (frameGenerationRequestedByRuntime &&
        frameGenerationFailureCount > this.frameGenerationFailureCount) {
      this.frameGenerationFailed = true;
      this.frameGenerationRequested = false;
      this.frameGenerationFailureCount = frameGenerationFailureCount;
    } else if (!frameGenerationRequestedByRuntime) {
      this.frameGenerationFailed = false;
      this.frameGenerationRequested = false;
      this.frameGenerationWarmup = 0;
      this.frameGenerationFailureCount = frameGenerationFailureCount;
    }

    return { adaptiveRequested: rayReconstruction || superResolution };
  }

  resetTemporalHistory(reason = "scene discontinuity") {
    this.resetHistory = true;
    this.frameGenerationWarmup = this.frameGenerationRequested
      ? FRAME_GENERATION_WARMUP
      : 0;
    this.presentationPath = `HISTORY RESET · ${String(reason).toUpperCase()}`;
  }

  getAdaptiveStatus() {
    const features = this.rtx?.getStatus?.()?.features ?? {};
    const rr = features.dlssRayReconstruction;
    const sr = features.dlssSuperResolution;
    const fg = features.dlssFrameGeneration;
    const reflex = features.reflex;
    const adaptiveRequested = Boolean(rr?.requested || sr?.requested);
    return {
      path: rr?.active ? "DLSS RAY RECONSTRUCTION" :
        sr?.active ? "DLSS SUPER RESOLUTION" :
          adaptiveRequested ? "ADAPTIVE PIPELINE WARMUP" : "NATIVE OP84",
      requestedPath: this.presentationPath,
      rayReconstructionActive: Boolean(rr?.active),
      superResolutionActive: Boolean(sr?.active && !rr?.active),
      frameGenerationActive: Boolean(fg?.active),
      reflexActive: Boolean(reflex?.active),
      rayReconstructionRequested: Boolean(rr?.requested),
      superResolutionRequested: Boolean(sr?.requested),
      frameGenerationRequested: Boolean(fg?.requested),
      reflexRequested: Boolean(reflex?.requested),
      rayReconstructionReason: rr?.reason ?? "",
      superResolutionReason: sr?.reason ?? "",
      frameGenerationReason: fg?.reason ?? "",
      rayReconstructionEvaluations: this.rayReconstructionEvaluations,
      superResolutionEvaluations: this.superResolutionEvaluations,
      frameGenerationTags: this.frameGenerationTags,
      rayReconstructionNativeEvaluations: Number(rr?.evaluationCount ?? 0),
      superResolutionNativeEvaluations: Number(sr?.evaluationCount ?? 0),
      frameGenerationGeneratedFrames: Number(fg?.generatedFrameCount ?? 0),
      rayReconstructionFailures: Number(rr?.failureCount ?? 0),
      superResolutionFailures: Number(sr?.failureCount ?? 0),
      frameGenerationFailures: Number(fg?.failureCount ?? 0),
      renderWidth: this.width,
      renderHeight: this.height,
      outputWidth: this.outputWidth,
      outputHeight: this.outputHeight,
    };
  }

  async configure(width, height, staticScene) {
    this.enabled = false;
    this.failure = "";
    if (!this.device || !this.rtx?.capabilities?.nativeRayTracing ||
        typeof this.rtx.registerStaticScene !== "function" ||
        typeof this.rtx.evaluateRayReflections !== "function") {
      this.failure = "The native specular reflection bridge is unavailable.";
      return false;
    }

    try {
      if (!this.sceneRegistered) {
        const registration = this.rtx.registerStaticScene({
          positions: staticScene.positions,
          indices: staticScene.indices,
          triangleRadiance: staticScene.triangleRadiance,
          triangleSurface: staticScene.triangleSurface,
          lights: staticScene.lights,
          instanceGroups: staticScene.instanceGroups,
        });
        if (!registration?.queued) throw new Error("Native static-scene registration was not queued.");
        const ready = await waitForStaticScene(this.rtx);
        if (!ready.ready) {
          throw new Error(
            ready.feature?.reason || "The native BLAS/TLAS did not become ready before timeout.",
          );
        }
        this.sceneRegistered = true;
        console.log(
          `[RTX reflections] Static scene ready: ${staticScene.vertexCount.toLocaleString()} vertices` +
          ` · ${staticScene.triangleCount.toLocaleString()} triangles` +
          ` · ${registration.staticLightCount ?? registration.lightCount ?? 0} shadow-tested lights` +
          " · linear HDR material data attached.",
        );
      }
      const outputWidth = positiveInteger(width);
      const outputHeight = positiveInteger(height);
      let adaptive = {
        options: null,
        width: outputWidth,
        height: outputHeight,
        enabled: false,
      };
      try {
        adaptive = this._adaptiveSettings(outputWidth, outputHeight);
        if (adaptive.enabled) {
          const status = this._requestAdaptiveFeatures(adaptive.options);
          this._validateAdaptiveConfiguration(status, adaptive, outputWidth, outputHeight);
        }
      } catch (error) {
        console.warn(`[RTX adaptive] Native presentation setup unavailable: ${error?.message || error}`);
        this.adaptiveEnabled = false;
        adaptive = {
          options: null,
          width: outputWidth,
          height: outputHeight,
          enabled: false,
        };
      }
      this._createTargets(
        adaptive.width,
        adaptive.height,
        outputWidth,
        outputHeight,
        adaptive.enabled,
      );
      this.enabled = true;
      this.adaptiveEnabled = adaptive.enabled;
      this.frameIndex = 0;
      this.resetTemporalHistory("initial frame");
      return true;
    } catch (error) {
      this.failure = `Native reflection setup failed: ${error?.message || error}`;
      console.warn(`[RTX reflections] ${this.failure}`);
      this._disposeTargets();
      if (this.sceneRegistered) {
        this.rtx.destroyStaticScene?.();
        this.sceneRegistered = false;
      }
      return false;
    }
  }

  updateInstanceGroups(updates) {
    if (!this.enabled || !this.sceneRegistered ||
        typeof this.rtx?.updateInstanceGroup !== "function") return false;
    try {
      for (const update of updates ?? []) this.rtx.updateInstanceGroup(update);
      return true;
    } catch (error) {
      this.failure = `Dynamic RTX instance update failed: ${error?.message || error}`;
      console.warn(`[RTX reflections] ${this.failure}`);
      return false;
    }
  }

  resize(width, height) {
    const nextWidth = positiveInteger(width);
    const nextHeight = positiveInteger(height);
    if (!this.enabled ||
        (nextWidth === this.outputWidth && nextHeight === this.outputHeight)) return this.enabled;
    try {
      this.adaptiveFrameReady = false;
      this._syncAdaptiveFeatureRequests();
      const pageAdaptiveRequested = this.pageRayReconstructionRequested ||
        this.pageSuperResolutionRequested;
      const adaptive = pageAdaptiveRequested
        ? this._adaptiveSettings(nextWidth, nextHeight)
        : {
            options: null,
            width: nextWidth,
            height: nextHeight,
            enabled: false,
          };
      // Reconfigure Streamline before destroying the old targets or exposing
      // any new-size texture view. This keeps its configured render/output
      // extents in the same resize transaction as the WebGPU resources.
      if (adaptive.enabled) {
        const status = this._requestAdaptiveFeatures(adaptive.options, {
          preserveIntent: true,
          includeReflex: false,
        });
        this._validateAdaptiveConfiguration(status, adaptive, nextWidth, nextHeight);
      }
      this._createTargets(
        adaptive.width,
        adaptive.height,
        nextWidth,
        nextHeight,
        adaptive.enabled,
      );
      this.adaptiveEnabled = adaptive.enabled;
      this.frameIndex = 0;
      this.resetTemporalHistory("resize");
      return true;
    } catch (error) {
      this.enabled = false;
      this.failure = `Native reflection resize failed: ${error?.message || error}`;
      console.error(`[RTX reflections] ${this.failure}`);
      this._disposeTargets();
      return false;
    }
  }

  _createRasterTarget(width, height) {
    this._disposeRasterTarget();
    const target = new THREE.RenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    target.texture.name = "Observatory WebGPU raster composite";
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    target.texture.mipmapsAutoUpdate = false;
    this.renderer.initRenderTarget(target);
    this.rasterTarget = target;
    return target;
  }

  _ensureRasterTarget(width, height) {
    const targetWidth = positiveInteger(width);
    const targetHeight = positiveInteger(height);
    if (!this.rasterTarget ||
        this.rasterTarget.width !== targetWidth ||
        this.rasterTarget.height !== targetHeight) {
      this._createRasterTarget(targetWidth, targetHeight);
    }
    return this.rasterTarget;
  }

  _createTargets(width, height, outputWidth = width, outputHeight = height, adaptive = false) {
    this._disposeTargets();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = "RTX reflection depth";
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;

    const sceneTarget = new THREE.RenderTarget(width, height, {
      count: 5,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
      generateMipmaps: false,
    });
    sceneTarget.textures[0].name = "output";
    // The primary HDR image is shaded in place by the optional native
    // directional-light-visibility/contact-AO pass before OP84 samples it.
    sceneTarget.textures[0].isStorageTexture = true;
    sceneTarget.textures[1].name = "velocity";
    sceneTarget.textures[1].format = THREE.RGFormat;
    sceneTarget.textures[2].name = "diffuseAlbedo";
    sceneTarget.textures[3].name = "normalRoughness";
    sceneTarget.textures[4].name = "specularAlbedo";
    for (const texture of sceneTarget.textures) {
      texture.format = THREE.RGBAFormat;
      texture.type = THREE.HalfFloatType;
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.mipmapsAutoUpdate = false;
    }
    // Velocity is the one exception to the RGBA guide buffers. Keep it dense
    // but genuinely two-channel so Streamline sees the exact RG16F contract.
    sceneTarget.textures[1].format = THREE.RGFormat;

    const outputTarget = new THREE.RenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    outputTarget.texture.name = "RTX reflected HDR output";
    outputTarget.texture.colorSpace = THREE.NoColorSpace;
    outputTarget.texture.isStorageTexture = true;
    outputTarget.texture.mipmapsAutoUpdate = false;

    // OP84 writes a linear world-space primary reflection hit distance into
    // this guide. Misses/background remain zero. The exact R32F image is fed
    // to Ray Reconstruction with explicit world/view transforms.
    const hitDistanceTarget = new THREE.RenderTarget(width, height, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    hitDistanceTarget.texture.name = "RTX primary specular hit distance";
    hitDistanceTarget.texture.isStorageTexture = true;
    hitDistanceTarget.texture.mipmapsAutoUpdate = false;

    const reconstructedTarget = new THREE.RenderTarget(outputWidth, outputHeight, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    reconstructedTarget.texture.name = "Adaptive reconstructed HDR";
    reconstructedTarget.texture.isStorageTexture = true;
    reconstructedTarget.texture.mipmapsAutoUpdate = false;

    const hudlessTarget = new THREE.RenderTarget(outputWidth, outputHeight, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    hudlessTarget.texture.name = "Adaptive post-tonemapped HUD-less color";
    hudlessTarget.texture.mipmapsAutoUpdate = false;

    this.renderer.initRenderTarget(sceneTarget);
    this.renderer.initRenderTarget(outputTarget);
    this.renderer.initRenderTarget(hitDistanceTarget);
    this.renderer.initRenderTarget(reconstructedTarget);
    this.renderer.initRenderTarget(hudlessTarget);
    const sourceColor = this.renderer.backend.get(sceneTarget.textures[0]).texture;
    const motionVectors = this.renderer.backend.get(sceneTarget.textures[1]).texture;
    const diffuseAlbedo = this.renderer.backend.get(sceneTarget.textures[2]).texture;
    const normalRoughness = this.renderer.backend.get(sceneTarget.textures[3]).texture;
    const specularAlbedo = this.renderer.backend.get(sceneTarget.textures[4]).texture;
    const depth = this.renderer.backend.get(sceneTarget.depthTexture).texture;
    const outputColor = this.renderer.backend.get(outputTarget.texture).texture;
    const hitDistance = this.renderer.backend.get(hitDistanceTarget.texture).texture;
    const reconstructedColor = this.renderer.backend.get(reconstructedTarget.texture).texture;
    const hudlessColor = this.renderer.backend.get(hudlessTarget.texture).texture;
    if (!sourceColor || !motionVectors || !diffuseAlbedo || !normalRoughness ||
        !specularAlbedo || !depth || !outputColor || !hitDistance ||
        !reconstructedColor || !hudlessColor) {
      sceneTarget.dispose();
      outputTarget.dispose();
      hitDistanceTarget.dispose();
      reconstructedTarget.dispose();
      hudlessTarget.dispose();
      throw new Error("Three.js did not expose all native reflection GPU textures.");
    }
    requireUsage(sourceColor, 0x04, "Reflection sourceColor");
    requireUsage(sourceColor, 0x08, "RTX lighting sourceColor");
    requireUsage(motionVectors, 0x04, "Adaptive velocity");
    requireUsage(diffuseAlbedo, 0x04, "Adaptive diffuseAlbedo");
    requireUsage(normalRoughness, 0x04, "Reflection normalRoughness");
    requireUsage(specularAlbedo, 0x04, "Reflection specularAlbedo");
    requireUsage(depth, 0x04, "Reflection depth");
    requireUsage(outputColor, 0x04, "Reflection outputColor presentation");
    requireUsage(outputColor, 0x08, "Reflection outputColor storage");
    requireUsage(hitDistance, 0x04, "Reflection hit-distance guide sampling");
    requireUsage(hitDistance, 0x08, "Reflection hit-distance guide storage");
    requireUsage(reconstructedColor, 0x08, "Adaptive reconstructed output storage");
    requireUsage(hudlessColor, 0x04, "Frame Generation HUD-less color");
    requireUsage(hudlessColor, 0x10, "Frame Generation HUD-less render target");

    this.sceneTarget = sceneTarget;
    this.outputTarget = outputTarget;
    this.hitDistanceTarget = hitDistanceTarget;
    this.reconstructedTarget = reconstructedTarget;
    this.hudlessTarget = hudlessTarget;
    this.width = width;
    this.height = height;
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    this._sourceColor = sourceColor;
    this._motionVectors = motionVectors;
    this._diffuseAlbedo = diffuseAlbedo;
    this._normalRoughness = normalRoughness;
    this._specularAlbedo = specularAlbedo;
    this._depth = depth;
    this._outputColor = outputColor;
    this._outputView = outputColor.createView({
      label: "Observatory native reflection output attachment view",
    });
    this._hitDistance = hitDistance;
    this._hitDistanceView = hitDistance.createView({
      label: "Observatory native reflection hit-distance attachment view",
    });
    this._reconstructedColor = reconstructedColor;
    this._reconstructedView = reconstructedColor.createView({
      label: "Observatory adaptive reconstructed output attachment view",
    });
    this._hudlessColor = hudlessColor;
    this._presentMaterial.map = hudlessTarget.texture;
    this._presentMaterial.needsUpdate = true;
    this._setDisplayTexture(outputTarget.texture);
    this.adaptiveEnabled = adaptive;
  }

  get presentationTexture() {
    return this.outputTarget?.texture ?? null;
  }

  _frameConstants(camera) {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._inverseViewProjection.copy(this._viewProjection).invert();

    if (this.resetHistory) this._previousViewProjection.copy(this._viewProjection);
    this._clipToPreviousClip
      .copy(this._previousViewProjection)
      .multiply(this._inverseViewProjection);
    this._previousClipToClip
      .copy(this._viewProjection)
      .multiply(this._previousViewProjection.clone().invert());

    camera.getWorldPosition(this._cameraPosition);
    camera.getWorldDirection(this._cameraForward).normalize();
    this._cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    this._cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();

    return {
      cameraViewToClip: rowMajor(camera.projectionMatrix),
      clipToCameraView: rowMajor(camera.projectionMatrixInverse),
      clipToLensClip: rowMajor(this._identity),
      clipToPrevClip: rowMajor(this._clipToPreviousClip),
      prevClipToClip: rowMajor(this._previousClipToClip),
      jitterOffset: [0, 0],
      // Three's velocity node produces current NDC minus previous NDC. DLSS
      // consumes normalized UV motion, including the NDC texture-Y inversion.
      motionVectorScale: [0.5, -0.5],
      cameraPinholeOffset: [0, 0],
      cameraPosition: this._cameraPosition.toArray(),
      cameraUp: this._cameraUp.toArray(),
      cameraRight: this._cameraRight.toArray(),
      cameraForward: this._cameraForward.toArray(),
      cameraNear: camera.near,
      cameraFar: camera.far,
      cameraFov: THREE.MathUtils.degToRad(camera.fov),
      cameraAspectRatio: camera.aspect,
      depthInverted: false,
      cameraMotionIncluded: true,
      motionVectors3D: false,
      reset: this.resetHistory,
      orthographicProjection: false,
      motionVectorsDilated: false,
      motionVectorsJittered: false,
    };
  }

  _renderLinearScene(scene, camera, target, mrtLayout = null) {
    const previousToneMapping = this.renderer.toneMapping;
    const previousExposure = this.renderer.toneMappingExposure;
    try {
      // Native ray queries consume scene-linear HDR radiance. ACES belongs at
      // the single final presentation boundary, otherwise the bridge traces
      // already-compressed colors and applies tone mapping a second time.
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
      this.renderer.setMRT(mrtLayout);
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.toneMappingExposure = previousExposure;
    }
  }

  renderRaster(scene, camera = this.camera, width = innerWidth, height = innerHeight) {
    try {
      const target = this._ensureRasterTarget(width, height);
      this._renderLinearScene(scene, camera, target);
      return true;
    } catch (error) {
      this.failure = `Observatory raster target stopped: ${error?.message || error}`;
      console.error(`[Observatory WebGPU] ${this.failure}`);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      return false;
    }
  }

  render(scene, camera = this.camera, frameOptions = {}) {
    if (!this.enabled || !this.sceneTarget || !this.outputTarget) return false;
    try {
      // The runtime overlay owns manual enable/disable decisions after the
      // sample's initial request. Mirror its live state every frame instead of
      // silently re-requesting a feature that the user switched off.
      this._syncAdaptiveFeatureRequests();
      this.adaptiveFrameReady = false;

      // Pass 1: one same-size FP16 MRT records source radiance, exact world
      // normal + perceptual roughness, linear F0 + reflection mask, and D32 depth.
      this._renderLinearScene(scene, camera, this.sceneTarget, this._mrt);
      const constants = this._frameConstants(camera);

      // Pass 2: add restrained, ray-tested key-light visibility and contact AO to
      // the primary HDR frame. Transparent glazing is absent from the TLAS, so
      // these rays pass through panes while mullions, walls and fixtures still
      // block them. A failure disables only this enhancement, never OP84.
      if (this.rayLightingEnabled && typeof this.rtx.evaluateRayLighting === "function") {
        try {
          const layouts = this.rtx.vulkanImageLayouts;
          const lightingEncoder = this.device.createCommandEncoder({
            label: "RTX observatory sun visibility and contact AO",
          });
          this.rtx.evaluateRayLighting({
            commandEncoder: lightingEncoder,
            color: makeResource(
              this._sourceColor,
              layouts.colorAttachment,
              this.width,
              this.height,
            ),
            depth: makeResource(
              this._depth,
              layouts.depthStencilAttachment,
              this.width,
              this.height,
            ),
            width: this.width,
            height: this.height,
            inverseViewProjection: this._inverseViewProjection.toArray(),
            cameraPosition: this._cameraPosition,
            directionalLightDirection:
              frameOptions.directionalLightDirection ?? [-0.42, 0.79, 0.45],
            directionalLightIntensity: 0.9,
            directionalAngularRadius: 0.0065,
            directionalSampleCount: DIRECTIONAL_LIGHTING_SAMPLES,
            aoSampleCount: AMBIENT_OCCLUSION_SAMPLES,
            maxDistance: 10000,
            rayBias: 0.002,
            frameIndex: LIGHTING_SEQUENCE_SEED,
            shadowStrength: 0.16,
            aoStrength: 0.085,
            aoRadius: 0.74,
            depthInverted: false,
          });
          this.device.queue.submit([lightingEncoder.finish()]);
        } catch (error) {
          this.rayLightingEnabled = false;
          this.rayLightingFailure = String(error?.message || error);
          console.warn(`[RTX lighting] Disabled primary ray-lighting pass: ${this.rayLightingFailure}`);
        }
      }

      // Pass 3: prime both distinct storage outputs in attachment layout. OP84
      // writes genuine noisy HDR and a world-space primary-hit distance guide
      // in one native evaluation. Raw Vulkan work owns a separate empty encoder.
      const primeEncoder = this.device.createCommandEncoder({
        label: "RTX reflection output prime",
      });
      const primePass = primeEncoder.beginRenderPass({
        label: "RTX reflection and hit-distance clear",
        colorAttachments: [
          {
            view: this._outputView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
          {
            view: this._hitDistanceView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      primePass.end();
      this.device.queue.submit([primeEncoder.finish()]);

      const layouts = this.rtx.vulkanImageLayouts;
      const encoder = this.device.createCommandEncoder({ label: "RTX ray reflections" });
      this.rtx.evaluateRayReflections({
        commandEncoder: encoder,
        pipeline: this.reflectionPipeline,
        sourceColor: makeResource(this._sourceColor, layouts.colorAttachment, this.width, this.height),
        outputColor: makeResource(this._outputColor, layouts.colorAttachment, this.width, this.height),
        specularHitDistanceOutput: makeResource(
          this._hitDistance,
          layouts.colorAttachment,
          this.width,
          this.height,
        ),
        depth: makeResource(this._depth, layouts.depthStencilAttachment, this.width, this.height),
        normalRoughness: makeResource(this._normalRoughness, layouts.colorAttachment, this.width, this.height),
        specularAlbedo: makeResource(this._specularAlbedo, layouts.colorAttachment, this.width, this.height),
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection.toArray(),
        cameraPosition: this._cameraPosition,
        reflectionStrength: Number(frameOptions.reflectionStrength ?? 1.04),
        maxDistance: Number(frameOptions.maxDistance ?? 140),
        rayBias: Number(frameOptions.rayBias ?? 0.012),
        roughnessCutoff: Number(frameOptions.roughnessCutoff ?? 0.88),
        environmentColor: frameOptions.environmentColor ?? [0.012, 0.022, 0.031],
        environmentIntensity: Number(frameOptions.environmentIntensity ?? 0.82),
        // Until a history buffer and disocclusion-aware denoiser are present,
        // changing the GGX sample rotation every frame creates crawling noise.
        // Keep the spatial sequence deterministic so reflections stay stable.
        temporalJitter: false,
        // The demo deliberately spends the available RTX headroom on stable
        // spatial convergence. Other pages keep the bridge's 1/4/8-ray default.
        highQuality: frameOptions.highQuality !== false,
        frameIndex: this.frameIndex++,
        depthInverted: false,
      });
      this.device.queue.submit([encoder.finish()]);

      let adaptiveSource = this.outputTarget.texture;
      if (this.adaptiveEnabled && this.reconstructedTarget) {
        // Transition and clear the full-resolution storage output before the
        // one adaptive path chosen for this frame. RR owns ray-heavy frames;
        // SR is only the failure fallback and is never evaluated alongside RR.
        const reconstructionPrime = this.device.createCommandEncoder({
          label: "Adaptive reconstructed output prime",
        });
        const reconstructionPrimePass = reconstructionPrime.beginRenderPass({
          label: "Adaptive reconstructed output clear",
          colorAttachments: [{
            view: this._reconstructedView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        reconstructionPrimePass.end();
        this.device.queue.submit([reconstructionPrime.finish()]);

        let reconstructionQueued = false;
        let reconstructionPath = "";
        if (this.rayReconstructionRequested && !this.rayReconstructionFailed) {
          try {
            const rrEncoder = this.device.createCommandEncoder({
              label: "DLSS Ray Reconstruction",
            });
            const result = this.rtx.evaluateRayReconstruction({
              commandEncoder: rrEncoder,
              viewport: STREAMLINE_VIEWPORT,
              rayTracedInput: true,
              noisyColor: makeResource(
                this._outputColor,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              colorOutput: makeResource(
                this._reconstructedColor,
                layouts.colorAttachment,
                this.outputWidth,
                this.outputHeight,
              ),
              depth: makeResource(
                this._depth,
                layouts.depthStencilAttachment,
                this.width,
                this.height,
              ),
              motionVectors: makeResource(
                this._motionVectors,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              diffuseAlbedo: makeResource(
                this._diffuseAlbedo,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              specularAlbedo: makeResource(
                this._specularAlbedo,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              normalRoughness: makeResource(
                this._normalRoughness,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              normalRoughnessPacked: true,
              specularHitDistance: makeResource(
                this._hitDistance,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              worldToCameraView: rowMajor(camera.matrixWorldInverse),
              cameraViewToWorld: rowMajor(camera.matrixWorld),
              constants,
            });
            this.device.queue.submit([rrEncoder.finish()]);
            reconstructionQueued = result?.queued !== false;
            if (reconstructionQueued) {
              this.rayReconstructionEvaluations += 1;
              reconstructionPath = "DLSS RAY RECONSTRUCTION";
            }
          } catch (error) {
            this.rayReconstructionFailed = true;
            console.warn(
              `[DLSS-RR] Falling back to Super Resolution: ${error?.message || error}`,
            );
          }
        }

        if (!reconstructionQueued && this.superResolutionRequested &&
            !this.superResolutionFailed) {
          try {
            const srEncoder = this.device.createCommandEncoder({
              label: "DLSS Super Resolution fallback",
            });
            const result = this.rtx.evaluateSuperResolution({
              commandEncoder: srEncoder,
              viewport: STREAMLINE_VIEWPORT,
              colorInput: makeResource(
                this._outputColor,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              colorOutput: makeResource(
                this._reconstructedColor,
                layouts.colorAttachment,
                this.outputWidth,
                this.outputHeight,
              ),
              depth: makeResource(
                this._depth,
                layouts.depthStencilAttachment,
                this.width,
                this.height,
              ),
              motionVectors: makeResource(
                this._motionVectors,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              constants,
            });
            this.device.queue.submit([srEncoder.finish()]);
            reconstructionQueued = result?.queued !== false;
            if (reconstructionQueued) {
              this.superResolutionEvaluations += 1;
              reconstructionPath = this.rayReconstructionRequested
                ? "DLSS SUPER RESOLUTION FALLBACK"
                : "DLSS SUPER RESOLUTION";
            }
          } catch (error) {
            this.superResolutionFailed = true;
            console.warn(`[DLSS-SR] Evaluation stopped: ${error?.message || error}`);
          }
        }

        if (reconstructionQueued) {
          adaptiveSource = this.reconstructedTarget.texture;
          this._setDisplayTexture(adaptiveSource);
          this._hudQuad.visible = false;
          const previousRenderTarget = this.renderer.getRenderTarget();
          const previousOutputTarget = this.renderer.getOutputRenderTarget();
          this.renderer.setRenderTarget(null);
          this.renderer.setOutputRenderTarget(this.hudlessTarget);
          try {
            // Three's normal output pipeline applies the project's ACES/output
            // transform once, leaving a persistent full-resolution RGBA8 image.
            this.renderer.render(this._displayScene, this._displayCamera);
          } finally {
            this.renderer.setOutputRenderTarget(previousOutputTarget);
            this.renderer.setRenderTarget(previousRenderTarget);
          }
          this.adaptiveFrameReady = true;
          this.presentationPath = reconstructionPath;
        } else {
          this.presentationPath = "NATIVE OP84";
        }
      }

      this._lastFrameConstants = constants;
      this._previousViewProjection.copy(this._viewProjection);
      this.resetHistory = false;

      // Presentation intentionally happens in the HUD compositor. Keeping the
      // OP84 result offscreen here guarantees one canvas submission per frame.
      return true;
    } catch (error) {
      this.enabled = false;
      this.failure = `Native reflection evaluation stopped: ${error?.message || error}`;
      console.error(`[RTX reflections] ${this.failure}`);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      return false;
    }
  }

  present(hudTexture = null, sourceTexture = this.outputTarget?.texture ?? null) {
    if (!sourceTexture) return false;
    try {
      if (this.adaptiveEnabled && this.adaptiveFrameReady &&
          this.hudlessTarget && this._lastFrameConstants) {
        if (this._hudMaterial.map !== hudTexture) {
          this._hudMaterial.map = hudTexture;
          this._hudMaterial.needsUpdate = true;
        }
        this._presentHudQuad.visible = Boolean(hudTexture);

        // Tag FG only after the temporal pipeline has warmed. Supplying the
        // separately rendered full-resolution HUD lets Streamline interpolate
        // the 3D image without warping text or controls.
        if (this.frameGenerationRequested && this.frameGenerationWarmup > 0) {
          this.frameGenerationWarmup -= 1;
        } else if (this.frameGenerationRequested) {
          try {
            const layouts = this.rtx.vulkanImageLayouts;
            const uiGpu = hudTexture
              ? this.renderer.backend.get(hudTexture)?.texture ?? null
              : null;
            const uiMatchesOutput = Boolean(
              uiGpu &&
              Number(uiGpu.width) === this.outputWidth &&
              Number(uiGpu.height) === this.outputHeight,
            );
            const fgEncoder = this.device.createCommandEncoder({
              label: "DLSS Frame Generation present inputs",
            });
            const frame = {
              commandEncoder: fgEncoder,
              viewport: STREAMLINE_VIEWPORT,
              hudlessColor: makeResource(
                this._hudlessColor,
                layouts.shaderReadOnly,
                this.outputWidth,
                this.outputHeight,
              ),
              depth: makeResource(
                this._depth,
                layouts.depthStencilAttachment,
                this.width,
                this.height,
              ),
              motionVectors: makeResource(
                this._motionVectors,
                layouts.colorAttachment,
                this.width,
                this.height,
              ),
              framesToGenerate: 1,
              constants: this._lastFrameConstants,
            };
            if (uiMatchesOutput) {
              frame.ui = makeResource(
                uiGpu,
                layouts.shaderReadOnly,
                this.outputWidth,
                this.outputHeight,
              );
              frame.uiAlphaOnly = false;
            }
            const result = this.rtx.tagFrameGeneration(frame);
            this.device.queue.submit([fgEncoder.finish()]);
            if (result?.queued !== false) this.frameGenerationTags += 1;
          } catch (error) {
            this.frameGenerationFailed = true;
            this.frameGenerationRequested = false;
            console.warn(`[DLSS-G] Present tagging stopped: ${error?.message || error}`);
          }
        }

        // The only swapchain submission: an encoded-byte copy of the HUD-less
        // result plus its independent JS-authored overlay.
        const previousToneMapping = this.renderer.toneMapping;
        const previousOutputColorSpace = this.renderer.outputColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.renderer.setRenderTarget(null);
        this.renderer.setOutputRenderTarget(null);
        const previousAutoClear = this.renderer.autoClear;
        this.renderer.autoClear = true;
        try {
          this.renderer.render(this._presentScene, this._displayCamera);
        } finally {
          this.renderer.autoClear = previousAutoClear;
          this.renderer.toneMapping = previousToneMapping;
          this.renderer.outputColorSpace = previousOutputColorSpace;
        }
        return true;
      }

      this._setDisplayTexture(sourceTexture);
      if (this._hudMaterial.map !== hudTexture) {
        this._hudMaterial.map = hudTexture;
        this._hudMaterial.needsUpdate = true;
      }
      this._hudQuad.visible = Boolean(hudTexture);

      // Keep this identical to the previously working native presentation
      // boundary, except that the clear is the load operation of this render
      // pass. A separate clear() can become its own black swapchain frame in
      // the headless Runtime host.
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      const previousAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = true;
      try {
        this.renderer.render(this._displayScene, this._displayCamera);
      } finally {
        this.renderer.autoClear = previousAutoClear;
      }
      return true;
    } catch (error) {
      this.enabled = false;
      this.failure = `Native reflection presentation stopped: ${error?.message || error}`;
      console.error(`[RTX reflections] ${this.failure}`);
      return false;
    }
  }

  _disposeTargets() {
    this._releaseDisplayTextures([
      this.outputTarget?.texture,
      this.reconstructedTarget?.texture,
      this.hudlessTarget?.texture,
      ...(this.sceneTarget?.textures ?? []),
    ]);
    this.sceneTarget?.dispose();
    this.outputTarget?.dispose();
    this.hitDistanceTarget?.dispose();
    this.reconstructedTarget?.dispose();
    this.hudlessTarget?.dispose();
    this.sceneTarget = null;
    this.outputTarget = null;
    this.hitDistanceTarget = null;
    this.reconstructedTarget = null;
    this.hudlessTarget = null;
    this.adaptiveFrameReady = false;
    this._sourceColor = null;
    this._motionVectors = null;
    this._diffuseAlbedo = null;
    this._normalRoughness = null;
    this._specularAlbedo = null;
    this._depth = null;
    this._outputColor = null;
    this._outputView = null;
    this._hitDistance = null;
    this._hitDistanceView = null;
    this._reconstructedColor = null;
    this._reconstructedView = null;
    this._hudlessColor = null;
    this._lastFrameConstants = null;
    this.width = 0;
    this.height = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this._presentMaterial.map = null;
    this._presentMaterial.needsUpdate = true;
  }

  _disposeRasterTarget() {
    this._releaseDisplayTextures([this.rasterTarget?.texture]);
    this.rasterTarget?.dispose();
    this.rasterTarget = null;
  }

  dispose() {
    this.enabled = false;
    this.rtx?.releaseViewport?.(STREAMLINE_VIEWPORT);
    this._disposeTargets();
    this._disposeRasterTarget();
    if (this.sceneRegistered) this.rtx?.destroyStaticScene?.();
    this.sceneRegistered = false;
    this._displayGeometry.dispose();
    for (const material of this._displayMaterialCache.values()) material.dispose();
    this._displayMaterialCache.clear();
    this._displayPlaceholderMaterial.dispose();
    this._presentMaterial.dispose();
    this._displayMaterial = null;
    this._hudGeometry.dispose();
    this._hudMaterial.dispose();
  }
}
