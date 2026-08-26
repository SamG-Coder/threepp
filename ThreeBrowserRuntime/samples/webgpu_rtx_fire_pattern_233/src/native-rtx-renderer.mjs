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
  vec3,
  vec4,
} from "three/tsl";
import { validateStaticRtxScene } from "./rtx-scene.mjs";

const COPY_SRC = 0x01;
const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const STORAGE_BINDING = 0x08;
const DEFAULT_TIMEOUT_MS = 8_000;
const EMPTY_ARRAY = Object.freeze([]);
const DEFAULT_ENVIRONMENT_COLOR = Object.freeze([0.006, 0.002, 0.014]);
const DEFAULT_KEY_DIRECTION = Object.freeze([-0.34, 0.82, -0.46]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = 1) {
  const number = Math.trunc(finite(value, fallback));
  return number > 0 ? number : fallback;
}

function requireDynamicMeshDescriptor(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("The exact mercury dynamic-mesh descriptor is required.");
  }
  const width = positiveInteger(value.width, 0);
  const height = positiveInteger(value.height, 0);
  const vertexCount = positiveInteger(value.vertexCount, 0);
  if (!(width > 0 && height > 0 && vertexCount > 0) || vertexCount > width * height) {
    throw new RangeError("The mercury dynamic vertex count exceeds its position texture.");
  }
  if (!(value.positions instanceof Float32Array) ||
      value.positions.length !== width * height * 4) {
    throw new TypeError("Mercury dynamic positions must contain one rgba32float texel per slot.");
  }
  if (!(value.indices instanceof Uint32Array) || value.indices.length === 0 ||
      value.indices.length % 3 !== 0) {
    throw new TypeError("Mercury dynamic topology must be complete Uint32 triangles.");
  }
  return value;
}

function makeResource(texture, layout, width, height) {
  return {
    texture,
    layout,
    vulkanLayout: layout,
    left: 0,
    top: 0,
    width,
    height,
  };
}

function requireUsage(texture, usage, label) {
  if ((Number(texture?.usage ?? 0) & usage) !== usage) {
    throw new Error(`${label} is missing GPUTextureUsage 0x${usage.toString(16)}.`);
  }
}

function normalizeDirectionInto(target, value, fallback = DEFAULT_KEY_DIRECTION) {
  let x = fallback[0];
  let y = fallback[1];
  let z = fallback[2];
  if (value?.isVector3) {
    x = finite(value.x, x);
    y = finite(value.y, y);
    z = finite(value.z, z);
  } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    x = finite(value[0], x);
    y = finite(value[1], y);
    z = finite(value[2], z);
  }
  const length = Math.hypot(x, y, z) || 1;
  return target.set(x / length, y / length, z / length);
}

function normalizeGuideMaterial(material) {
  if (!material) return;
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  if (!Number.isFinite(material.rtxUsesResolvedPbr)) {
    material.rtxUsesResolvedPbr = material.isMeshStandardNodeMaterial ? 1 : 0;
  }
  if (!Number.isFinite(material.rtxReflectionMask)) {
    if (material.transparent || finite(material.opacity, 1) < 0.995) {
      material.rtxReflectionMask = 0;
    } else {
      const glossy = 1 - THREE.MathUtils.clamp(material.roughness, 0, 1);
      const metallic = THREE.MathUtils.clamp(material.metalness, 0, 1);
      const clearcoat = THREE.MathUtils.clamp(finite(material.clearcoat), 0, 1);
      material.rtxReflectionMask = THREE.MathUtils.clamp(
        metallic * 0.74 + clearcoat * 0.34 + glossy * 0.18,
        0,
        1,
      );
    }
  }
}

/** Normalize numeric fallbacks consumed by the native MRT guide graph. */
export function prepareRtxGuideMaterials(scene) {
  scene?.traverse?.(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) normalizeGuideMaterial(material);
  });
}

function liveRtxStatus(rtx) {
  try {
    return rtx?.getStatus?.() ?? rtx?.status ?? null;
  } catch {
    return rtx?.status ?? null;
  }
}

async function waitForStaticScene(rtx, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = performance.now() + timeoutMs;
  let status = liveRtxStatus(rtx);
  while (performance.now() < deadline) {
    const feature = status?.features?.nativeRayTracing;
    if (feature?.active) return { ready: true, status, feature };
    if (feature?.supported === false) return { ready: false, status, feature };
    await new Promise(resolve => setTimeout(resolve, 8));
    status = liveRtxStatus(rtx) ?? status;
  }
  return {
    ready: false,
    status,
    feature: status?.features?.nativeRayTracing ?? null,
  };
}

/**
 * Offscreen native visibility/reflection boundary for the jelly-rave sample.
 * `renderNative()` and `renderRaster()` only stage an HDR texture. `present()`
 * is the sole method that binds the canvas, applies ACES/sRGB and renders it.
 */
export class NativeRtxRenderer {
  constructor(
    renderer,
    camera,
    rtx = globalThis.navigator?.gpu?.threeBrowserRTX ?? null,
    options = {},
  ) {
    if (!renderer || !camera) {
      throw new TypeError("NativeRtxRenderer requires a renderer and camera.");
    }
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;
    this.options = Object.freeze({
      timeoutMs: Math.min(60_000, positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)),
      directionalLightIntensity: THREE.MathUtils.clamp(
        finite(options.directionalLightIntensity, 0.26),
        0,
        100,
      ),
      directionalAngularRadius: THREE.MathUtils.clamp(
        finite(options.directionalAngularRadius, 0.0047),
        0,
        0.2,
      ),
      directionalSampleCount: Math.min(16, positiveInteger(options.directionalSampleCount, 4)),
      aoSampleCount: Math.min(32, positiveInteger(options.aoSampleCount, 8)),
      maxDistance: THREE.MathUtils.clamp(finite(options.maxDistance, 1_600), 1, 100_000),
      rayBias: THREE.MathUtils.clamp(finite(options.rayBias, 0.018), 0.00001, 1),
      shadowStrength: THREE.MathUtils.clamp(finite(options.shadowStrength, 0.48), 0, 1),
      aoStrength: THREE.MathUtils.clamp(finite(options.aoStrength, 0.16), 0, 1),
      aoRadius: THREE.MathUtils.clamp(finite(options.aoRadius, 1.2), 0.01, 100),
      reflectionStrength: THREE.MathUtils.clamp(finite(options.reflectionStrength, 0.96), 0, 4),
      reflectionDistance: THREE.MathUtils.clamp(finite(options.reflectionDistance, 1_200), 0.1, 100_000),
      reflectionRayBias: THREE.MathUtils.clamp(finite(options.reflectionRayBias, 0.024), 0.00001, 1),
      roughnessCutoff: THREE.MathUtils.clamp(finite(options.roughnessCutoff, 0.88), 0.02, 1),
    });

    this.enabled = false;
    this.sceneRegistered = false;
    this.disposed = false;
    this.failure = "";
    this.width = 1;
    this.height = 1;
    this.frameIndex = 0;
    this.lastPath = "none";
    this.lastPresentedPath = "none";
    this.lightingEnabled = typeof rtx?.evaluateRayLighting === "function";
    this.reflectionsEnabled = typeof rtx?.evaluateRayReflections === "function";
    this.lightingFailure = "";
    this.reflectionFailure = "";
    this.dynamicMeshFailure = "";
    this.nativeFrameCount = 0;
    this.rasterFrameCount = 0;
    this.presentationCount = 0;
    this.nativeQueueSubmitCount = 0;
    this.dynamicMeshUploadCount = 0;
    this.dynamicMeshRefitCount = 0;
    this.dynamicMeshBuildCount = 0;
    this._registeredStats = null;
    this._frameReady = false;
    this._activeTexture = null;
    this._lastFrameNative = false;

    this.rasterTarget = null;
    this.sceneTarget = null;
    this.outputTarget = null;
    this._sourceColor = null;
    this._guideColor = null;
    this._normalRoughness = null;
    this._specularAlbedo = null;
    this._depth = null;
    this._outputColor = null;
    this._nativeLayouts = null;
    this._nativeResources = null;
    this._nativeSubmitBuffers = [];
    this._dynamicMeshDescriptor = null;
    this._dynamicPositionsTexture = null;
    this._dynamicMesh = null;
    this._dynamicMeshDirty = false;

    const resolvedPbr = materialReference("rtxUsesResolvedPbr", "float").clamp(0, 1);
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
    const guideMask = materialReference("rtxReflectionMask", "float").clamp(0, 1);
    const specularF0 = mix(vec3(0.04), diffuseColor.rgb, guideMetalness);
    this._mrt = mrt({
      output,
      normalRoughness: vec4(normalWorld, guideRoughness),
      specularAlbedo: vec4(specularF0, guideMask),
    });

    this._displayScene = new THREE.Scene();
    this._displayScene.name = "Jelly Rave one-surface HDR presentation";
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._displayGeometry = new THREE.PlaneGeometry(2, 2);
    const uvs = this._displayGeometry.getAttribute("uv");
    for (let index = 0; index < uvs.count; ++index) uvs.setY(index, 1 - uvs.getY(index));
    uvs.needsUpdate = true;
    this._displayMaterialCache = new Map();
    this._placeholderMaterial = this._createDisplayMaterial(null);
    this._displayMaterial = this._placeholderMaterial;
    this._displayQuad = new THREE.Mesh(this._displayGeometry, this._displayMaterial);
    this._displayQuad.name = "ACES-presented jelly-rave HDR frame";
    this._displayQuad.frustumCulled = false;
    this._displayScene.add(this._displayQuad);

    // Most transparent reflective materials use an opaque MRT guide. An
    // explicitly authored transparent guide may opt out through
    // rtxPreserveTransparency when its coverage must remain blended.
    this._nativeGuideMaterialCache = new Map();
    this._nativeGuideScene = null;
    this._nativeGuideBindings = [];
    this._nativeGuideSwaps = [];
    this._nativeGuidePlanBuildCount = 0;
    this._lightVisibility = [];
    this._viewProjection = new THREE.Matrix4();
    this._inverseViewProjection = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();
    this._directionalLightDirection = new THREE.Vector3();
  }

  _createDisplayMaterial(texture) {
    const material = new THREE.MeshBasicNodeMaterial({
      map: texture,
      color: texture ? 0xffffff : 0x000000,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    material.toneMapped = true;
    return material;
  }

  _displayMaterialFor(texture) {
    if (!texture) return this._placeholderMaterial;
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
      if (material === this._displayMaterial) {
        this._displayMaterial = this._placeholderMaterial;
        this._displayQuad.material = this._placeholderMaterial;
      }
      this._displayMaterialCache.delete(texture);
      material.dispose();
    }
  }

  _nativeGuideMaterial(material) {
    normalizeGuideMaterial(material);
    if (!material?.transparent || finite(material.rtxReflectionMask) <= 0) return material;
    if (finite(material.rtxPreserveTransparency) > 0) return material;
    let guide = this._nativeGuideMaterialCache.get(material);
    if (guide) return guide;
    guide = material.clone();
    guide.name = `Native MRT guide — ${material.name || material.type}`;
    guide.transparent = false;
    guide.opacity = 1;
    guide.depthWrite = true;
    guide.blending = THREE.NoBlending;
    guide.alphaTest = 0;
    guide.forceSinglePass = true;
    guide.rtxUsesResolvedPbr = material.rtxUsesResolvedPbr;
    guide.rtxReflectionMask = material.rtxReflectionMask;
    guide.needsUpdate = true;
    this._nativeGuideMaterialCache.set(material, guide);
    return guide;
  }

  _buildNativeGuidePlan(scene) {
    this._nativeGuideScene = scene;
    this._nativeGuideBindings.length = 0;
    this._nativeGuideSwaps.length = 0;
    scene?.traverse?.(object => {
      const original = object.material;
      if (!original) return;
      let guide = original;
      if (Array.isArray(original)) {
        const guides = new Array(original.length);
        let changed = false;
        for (let index = 0; index < original.length; ++index) {
          guides[index] = this._nativeGuideMaterial(original[index]);
          changed ||= guides[index] !== original[index];
        }
        if (changed) guide = guides;
      } else {
        guide = this._nativeGuideMaterial(original);
      }
      const binding = { object, original, guide };
      this._nativeGuideBindings.push(binding);
      if (guide !== original) this._nativeGuideSwaps.push(binding);
    });
    this._nativeGuidePlanBuildCount += 1;
  }

  _ensureNativeGuidePlan(scene) {
    let rebuild = scene !== this._nativeGuideScene;
    if (!rebuild) {
      // Material identity is the only live input to this stable sample's guide
      // plan. This cheap linear check also repairs an explicit material swap
      // without paying for two complete scene traversals every native frame.
      for (const binding of this._nativeGuideBindings) {
        if (binding.object.material !== binding.original) {
          rebuild = true;
          break;
        }
      }
    }
    if (rebuild) this._buildNativeGuidePlan(scene);
  }

  _applyNativeGuideMaterials(scene) {
    this._ensureNativeGuidePlan(scene);
    for (const binding of this._nativeGuideSwaps) {
      binding.object.material = binding.guide;
    }
  }

  _restoreNativeGuideMaterials() {
    for (let index = this._nativeGuideSwaps.length - 1; index >= 0; --index) {
      const binding = this._nativeGuideSwaps[index];
      binding.object.material = binding.original;
    }
  }

  _disposeGuideMaterials() {
    for (const material of this._nativeGuideMaterialCache.values()) material.dispose();
    this._nativeGuideMaterialCache.clear();
    this._nativeGuideScene = null;
    this._nativeGuideBindings.length = 0;
    this._nativeGuideSwaps.length = 0;
  }

  _disposeRasterTarget() {
    const texture = this.rasterTarget?.texture ?? null;
    this._releaseDisplayTextures([texture]);
    this.rasterTarget?.dispose();
    this.rasterTarget = null;
    if (this._activeTexture === texture) this._activeTexture = null;
  }

  _disposeNativeTargets() {
    const textures = [
      this.outputTarget?.texture,
      ...(this.sceneTarget?.textures ?? []),
    ].filter(Boolean);
    this._releaseDisplayTextures(textures);
    this.sceneTarget?.dispose();
    this.outputTarget?.dispose();
    this.sceneTarget = null;
    this.outputTarget = null;
    this._sourceColor = null;
    this._guideColor = null;
    this._normalRoughness = null;
    this._specularAlbedo = null;
    this._depth = null;
    this._outputColor = null;
    this._nativeLayouts = null;
    this._nativeResources = null;
    this._nativeSubmitBuffers.length = 0;
    if (textures.includes(this._activeTexture)) this._activeTexture = null;
  }

  _uploadDynamicPositions(markDirty = true) {
    const descriptor = this._dynamicMeshDescriptor;
    const texture = this._dynamicPositionsTexture;
    if (!descriptor || !texture) return false;
    this.device.queue.writeTexture(
      { texture },
      descriptor.positions,
      {
        bytesPerRow: descriptor.width * 4 * Float32Array.BYTES_PER_ELEMENT,
        rowsPerImage: descriptor.height,
      },
      {
        width: descriptor.width,
        height: descriptor.height,
        depthOrArrayLayers: 1,
      },
    );
    this.dynamicMeshUploadCount += 1;
    if (markDirty) this._dynamicMeshDirty = true;
    return true;
  }

  _createDynamicTriangleMesh(value) {
    const descriptor = requireDynamicMeshDescriptor(value);
    if (typeof this.rtx?.createDynamicTriangleMesh !== "function" ||
        typeof this.rtx?.refitDynamicTriangleMesh !== "function" ||
        typeof this.rtx?.destroyDynamicTriangleMesh !== "function") {
      throw new Error("The exact dynamic triangle-mesh bridge is unavailable.");
    }
    const transferDestination = this.rtx?.vulkanImageLayouts?.transferDestination;
    if (!transferDestination) {
      throw new Error("The RTX bridge did not expose the transfer-destination image layout.");
    }
    this._dynamicMeshDescriptor = descriptor;
    this._dynamicPositionsTexture = this.device.createTexture({
      label: `Exact ${descriptor.width}x${descriptor.height} neon-mercury solver positions`,
      size: {
        width: descriptor.width,
        height: descriptor.height,
        depthOrArrayLayers: 1,
      },
      format: "rgba32float",
      mipLevelCount: 1,
      sampleCount: 1,
      usage: COPY_SRC | COPY_DST | STORAGE_BINDING,
    });
    this._uploadDynamicPositions(false);

    const encoder = this.device.createCommandEncoder({
      label: "Exact neon-mercury dynamic BLAS build",
    });
    const mesh = this.rtx.createDynamicTriangleMesh({
      commandEncoder: encoder,
      positionsTexture: this._dynamicPositionsTexture,
      positionsVulkanLayout: transferDestination,
      vertexCount: descriptor.vertexCount,
      indices: descriptor.indices,
      reflectionMaterial: descriptor.reflectionMaterial,
      label: "Exact connected neon-mercury heightfield",
    });
    if (!mesh) throw new Error("The exact mercury dynamic BLAS returned no handle.");
    this.device.queue.submit([encoder.finish()]);
    this._dynamicMesh = mesh;
    this._dynamicMeshDirty = false;
    this.dynamicMeshBuildCount += 1;
  }

  _destroyDynamicTriangleMesh() {
    const mesh = this._dynamicMesh;
    const texture = this._dynamicPositionsTexture;
    this._dynamicMesh = null;
    this._dynamicPositionsTexture = null;
    this._dynamicMeshDescriptor = null;
    this._dynamicMeshDirty = false;
    if (mesh && !mesh.destroyed) {
      try {
        const encoder = this.device.createCommandEncoder({
          label: "Exact neon-mercury dynamic BLAS cleanup",
        });
        this.rtx?.destroyDynamicTriangleMesh?.({ mesh, commandEncoder: encoder });
        this.device.queue.submit([encoder.finish()]);
      } catch (error) {
        console.warn(`[Neon Mercury RTX] Dynamic-mesh release failed: ${error?.message || error}`);
      }
    }
    texture?.destroy?.();
  }

  _destroyStaticScene() {
    // The dynamic handle is generation-bound to the active static scene. Mask
    // and submit its TLAS slot before destroyStaticScene invalidates the handle;
    // only then release the borrowed rgba32float texture.
    this._destroyDynamicTriangleMesh();
    if (!this.sceneRegistered) return;
    try {
      this.rtx?.destroyStaticScene?.();
    } catch (error) {
      console.warn(`[Neon Mercury RTX] Static-scene release failed: ${error?.message || error}`);
    }
    this.sceneRegistered = false;
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
    target.texture.name = "Jelly Rave exact transparent linear raster";
    target.texture.colorSpace = THREE.NoColorSpace;
    // Native lighting augments this exact raster in place. Declaring storage
    // before initRenderTarget makes the Three.js-owned texture legal for both
    // the raster attachment and the generic RTX bridge.
    target.texture.isStorageTexture = true;
    target.texture.generateMipmaps = false;
    target.texture.mipmapsAutoUpdate = false;
    this.renderer.initRenderTarget(target);
    this.rasterTarget = target;
    return target;
  }

  _ensureRasterTarget() {
    if (!this.rasterTarget || this.rasterTarget.width !== this.width ||
        this.rasterTarget.height !== this.height) {
      this._createRasterTarget(this.width, this.height);
    }
    return this.rasterTarget;
  }

  _makeStorageTarget(width, height, name) {
    const target = new THREE.RenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    target.texture.name = name;
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.isStorageTexture = true;
    target.texture.generateMipmaps = false;
    target.texture.mipmapsAutoUpdate = false;
    return target;
  }

  _createNativeTargets(width, height) {
    this._disposeNativeTargets();
    // Keep the authored transparent raster separate from the opaque/native MRT
    // guides. It remains the primary color through the whole RTX handoff.
    const exactRasterTarget = this._ensureRasterTarget();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = "Jelly Rave RTX depth";
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;
    const sceneTarget = new THREE.RenderTarget(width, height, {
      count: 3,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
      generateMipmaps: false,
    });
    const names = ["output", "normalRoughness", "specularAlbedo"];
    sceneTarget.textures.forEach((texture, index) => {
      texture.name = names[index];
      texture.format = THREE.RGBAFormat;
      texture.type = THREE.HalfFloatType;
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.mipmapsAutoUpdate = false;
    });
    const outputTarget = this._makeStorageTarget(
      width,
      height,
      "Jelly Rave RTX-augmented exact HDR output",
    );
    this.renderer.initRenderTarget(sceneTarget);
    this.renderer.initRenderTarget(outputTarget);

    const sourceColor = this.renderer.backend?.get?.(exactRasterTarget.texture)?.texture ?? null;
    const guideColor = this.renderer.backend?.get?.(sceneTarget.textures[0])?.texture ?? null;
    const normalRoughness = this.renderer.backend?.get?.(sceneTarget.textures[1])?.texture ?? null;
    const specularAlbedo = this.renderer.backend?.get?.(sceneTarget.textures[2])?.texture ?? null;
    const depth = this.renderer.backend?.get?.(sceneTarget.depthTexture)?.texture ?? null;
    const outputColor = this.renderer.backend?.get?.(outputTarget.texture)?.texture ?? null;
    if (!sourceColor || !guideColor || !normalRoughness || !specularAlbedo || !depth || !outputColor) {
      sceneTarget.dispose();
      outputTarget.dispose();
      throw new Error("Three.js did not expose every jelly-rave native guide texture.");
    }
    requireUsage(sourceColor, TEXTURE_BINDING, "RTX sourceColor sampling");
    requireUsage(sourceColor, STORAGE_BINDING, "RTX sourceColor storage");
    requireUsage(normalRoughness, TEXTURE_BINDING, "RTX normalRoughness sampling");
    requireUsage(specularAlbedo, TEXTURE_BINDING, "RTX specularAlbedo sampling");
    requireUsage(depth, TEXTURE_BINDING, "RTX depth sampling");
    requireUsage(outputColor, TEXTURE_BINDING, "RTX output presentation");
    requireUsage(outputColor, STORAGE_BINDING, "RTX output storage");

    this.sceneTarget = sceneTarget;
    this.outputTarget = outputTarget;
    this._sourceColor = sourceColor;
    this._guideColor = guideColor;
    this._normalRoughness = normalRoughness;
    this._specularAlbedo = specularAlbedo;
    this._depth = depth;
    this._outputColor = outputColor;
    const layouts = this.rtx?.vulkanImageLayouts;
    if (!layouts?.colorAttachment || !layouts?.depthStencilAttachment) {
      throw new Error("The RTX bridge did not expose non-zero Vulkan image layouts.");
    }
    this._nativeLayouts = layouts;
    this._nativeResources = {
      sourceColor: makeResource(sourceColor, layouts.colorAttachment, width, height),
      normalRoughness: makeResource(normalRoughness, layouts.colorAttachment, width, height),
      specularAlbedo: makeResource(specularAlbedo, layouts.colorAttachment, width, height),
      depth: makeResource(depth, layouts.depthStencilAttachment, width, height),
      outputColor: makeResource(outputColor, layouts.colorAttachment, width, height),
    };
  }

  async configure(width, height, staticScene, dynamicMesh = null) {
    if (this.disposed) return false;
    this.enabled = false;
    this.failure = "";
    this.lightingFailure = "";
    this.reflectionFailure = "";
    this.dynamicMeshFailure = "";
    this._frameReady = false;
    this._registeredStats = null;
    this.width = positiveInteger(width);
    this.height = positiveInteger(height);
    this.device = this.renderer.backend?.device ?? this.device;
    this.lightingEnabled = typeof this.rtx?.evaluateRayLighting === "function";
    this.reflectionsEnabled = typeof this.rtx?.evaluateRayReflections === "function";
    this._disposeNativeTargets();
    this._destroyStaticScene();

    const capabilities = this.rtx?.capabilities ?? {};
    if (!this.device || !(capabilities.nativeRayTracing || capabilities.rayQuery) ||
        typeof this.rtx?.registerStaticScene !== "function" ||
        (!this.lightingEnabled && !this.reflectionsEnabled)) {
      this.failure = "The native ray-query lighting/reflection bridge is unavailable.";
      return false;
    }

    try {
      validateStaticRtxScene(staticScene);
      const registration = this.rtx.registerStaticScene({
        positions: staticScene.positions,
        indices: staticScene.indices,
        triangleRadiance: staticScene.triangleRadiance,
        triangleSurface: staticScene.triangleSurface,
        lights: staticScene.lights,
      });
      if (!registration || registration.queued === false) {
        throw new Error(registration?.reason || "Static room scene registration was rejected.");
      }
      this.sceneRegistered = true;
      const ready = await waitForStaticScene(this.rtx, this.options.timeoutMs);
      // Teardown can happen while the native BLAS/TLAS readiness promise is
      // pending. Never recreate GPU targets or re-enable a renderer after its
      // owner has already disposed it.
      if (this.disposed || !this.sceneRegistered) {
        this._destroyStaticScene();
        return false;
      }
      if (!ready.ready) {
        throw new Error(
          ready.feature?.reason || "The room BLAS/TLAS did not become ready before timeout.",
        );
      }
      this._createNativeTargets(this.width, this.height);
      if (dynamicMesh) this._createDynamicTriangleMesh(dynamicMesh);
      this._registeredStats = Object.freeze({
        vertexCount: staticScene.vertexCount,
        triangleCount: staticScene.triangleCount,
        lightCount: staticScene.lightCount,
        sourceMeshCount: staticScene.sourceMeshCount,
        sourceInstanceCount: staticScene.sourceInstanceCount,
        truncated: Boolean(staticScene.truncated),
      });
      this.enabled = true;
      console.log(
        `[Jelly Rave RTX] Static stage ready` +
        ` · ${staticScene.triangleCount.toLocaleString()} triangles` +
        ` · lights=${staticScene.lightCount}` +
        ` · rayLighting=${this.lightingEnabled}` +
        ` · rayReflections=${this.reflectionsEnabled}`,
      );
      return true;
    } catch (error) {
      this.failure = `Native room setup failed: ${error?.message || error}`;
      console.warn(`[Jelly Rave RTX] ${this.failure}`);
      this._disposeNativeTargets();
      this._destroyStaticScene();
      return false;
    }
  }

  setup(width, height, staticScene, dynamicMesh = null) {
    return this.configure(width, height, staticScene, dynamicMesh);
  }

  updateDynamicTriangleMesh() {
    if (!this.enabled || !this.sceneRegistered || !this._dynamicMesh) return false;
    try {
      const uploaded = this._uploadDynamicPositions(true);
      if (uploaded) this.dynamicMeshFailure = "";
      return uploaded;
    } catch (error) {
      this.dynamicMeshFailure = `Exact mercury position upload failed: ${error?.message || error}`;
      console.warn(`[Neon Mercury RTX] ${this.dynamicMeshFailure}`);
      return false;
    }
  }

  resize(width, height) {
    if (this.disposed) return false;
    const nextWidth = positiveInteger(width);
    const nextHeight = positiveInteger(height);
    if (nextWidth === this.width && nextHeight === this.height) return true;
    this.width = nextWidth;
    this.height = nextHeight;
    this._frameReady = false;
    try {
      if (this.rasterTarget) this._createRasterTarget(nextWidth, nextHeight);
      if (this.enabled) this._createNativeTargets(nextWidth, nextHeight);
      return true;
    } catch (error) {
      this.failure = `Jelly Rave target resize failed: ${error?.message || error}`;
      console.error(`[Jelly Rave RTX] ${this.failure}`);
      this.enabled = false;
      this._disposeNativeTargets();
      return false;
    }
  }

  _renderLinearScene(scene, camera, target, mrtLayout = null, suppressRasterLights = EMPTY_ARRAY) {
    const previousTarget = this.renderer.getRenderTarget?.() ?? null;
    const previousMrt = this.renderer.getMRT?.() ?? null;
    const previousToneMapping = this.renderer.toneMapping;
    const previousExposure = this.renderer.toneMappingExposure;
    const lightVisibility = this._lightVisibility;
    lightVisibility.length = 0;
    for (const light of suppressRasterLights ?? EMPTY_ARRAY) {
      if (!light?.isLight) continue;
      lightVisibility.push([light, light.visible]);
      light.visible = false;
    }
    try {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
      this.renderer.setMRT?.(mrtLayout);
      this.renderer.setRenderTarget(target);
      // This clear belongs to an offscreen target. The default surface is only
      // ever touched by the single render in present().
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
    } finally {
      for (const [light, visible] of lightVisibility) light.visible = visible;
      lightVisibility.length = 0;
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setMRT?.(previousMrt);
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.toneMappingExposure = previousExposure;
    }
  }

  _recordDynamicMeshRefit() {
    if (!this._dynamicMeshDirty) return null;
    if (!this._dynamicMesh || !this._dynamicPositionsTexture) {
      throw new Error("The exact mercury position upload has no active dynamic BLAS.");
    }
    const encoder = this.device.createCommandEncoder({
      label: "Exact neon-mercury position copy and BLAS refit",
    });
    const result = this.rtx.refitDynamicTriangleMesh({
      commandEncoder: encoder,
      mesh: this._dynamicMesh,
      positionsTexture: this._dynamicPositionsTexture,
      positionsVulkanLayout: this.rtx.vulkanImageLayouts.transferDestination,
      rebuild: false,
    });
    if (result?.queued === false) {
      throw new Error(result.reason || "The exact mercury dynamic BLAS refit was rejected.");
    }
    return encoder.finish();
  }

  _recordLighting(frameOptions) {
    if (!this.lightingEnabled || typeof this.rtx?.evaluateRayLighting !== "function") return false;
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Jelly Rave deterministic key visibility and RTAO",
      });
      normalizeDirectionInto(
        this._directionalLightDirection,
        frameOptions.directionalLightDirection,
      );
      const result = this.rtx.evaluateRayLighting({
        commandEncoder: encoder,
        color: this._nativeResources.sourceColor,
        depth: this._nativeResources.depth,
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection,
        cameraPosition: this._cameraPosition,
        directionalLightDirection: this._directionalLightDirection,
        directionalLightIntensity: finite(
          frameOptions.directionalLightIntensity,
          this.options.directionalLightIntensity,
        ),
        directionalAngularRadius: this.options.directionalAngularRadius,
        directionalSampleCount: this.options.directionalSampleCount,
        aoSampleCount: this.options.aoSampleCount,
        maxDistance: this.options.maxDistance,
        rayBias: this.options.rayBias,
        // No temporal resolve exists in this focused sample. A fixed spatial
        // sequence prevents the mirror walls and mercury highlights from flashing.
        frameIndex: 0,
        shadowStrength: this.options.shadowStrength,
        aoStrength: this.options.aoStrength,
        aoRadius: this.options.aoRadius,
        depthInverted: false,
      });
      if (result?.queued === false) {
        throw new Error(result.reason || "Native key lighting was rejected.");
      }
      return encoder.finish();
    } catch (error) {
      this.lightingEnabled = false;
      this.lightingFailure = String(error?.message || error);
      console.warn(`[Neon Mercury RTX] Ray lighting disabled: ${this.lightingFailure}`);
      return null;
    }
  }

  _recordReflections(frameOptions) {
    if (!this.reflectionsEnabled || typeof this.rtx?.evaluateRayReflections !== "function") return false;
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Jelly Rave deterministic stage reflections",
      });
      const result = this.rtx.evaluateRayReflections({
        commandEncoder: encoder,
        sourceColor: this._nativeResources.sourceColor,
        outputColor: this._nativeResources.outputColor,
        depth: this._nativeResources.depth,
        normalRoughness: this._nativeResources.normalRoughness,
        specularAlbedo: this._nativeResources.specularAlbedo,
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection,
        cameraPosition: this._cameraPosition,
        reflectionStrength: finite(
          frameOptions.reflectionStrength,
          this.options.reflectionStrength,
        ),
        maxDistance: finite(frameOptions.reflectionDistance, this.options.reflectionDistance),
        rayBias: finite(frameOptions.reflectionRayBias, this.options.reflectionRayBias),
        roughnessCutoff: finite(frameOptions.roughnessCutoff, this.options.roughnessCutoff),
        // Miss rays still replace a Fresnel-weighted portion of the exact
        // raster source. Feeding them black would therefore make clearcoat and
        // transmissive pixels darken the instant the native path becomes
        // ready. Use the deliberately dim authored warehouse ambience so the
        // RTX handoff preserves energy without washing out the practicals.
        environmentColor: frameOptions.environmentColor ?? DEFAULT_ENVIRONMENT_COLOR,
        environmentIntensity: Math.max(0, finite(frameOptions.environmentIntensity, 0.18)),
        temporalJitter: false,
        highQuality: true,
        frameIndex: 0,
        depthInverted: false,
      });
      if (result?.queued === false) {
        throw new Error(result.reason || "Native room reflections were rejected.");
      }
      return encoder.finish();
    } catch (error) {
      this.reflectionsEnabled = false;
      this.reflectionFailure = String(error?.message || error);
      console.warn(`[Neon Mercury RTX] Ray reflections disabled: ${this.reflectionFailure}`);
      return null;
    }
  }

  _evaluateNativeEffects(frameOptions) {
    let dynamicBuffer = null;
    try {
      dynamicBuffer = this._recordDynamicMeshRefit();
    } catch (error) {
      this.dynamicMeshFailure = String(error?.message || error);
      throw error;
    }
    const lightingBuffer = this._recordLighting(frameOptions);
    const reflectionBuffer = this._recordReflections(frameOptions);
    const submitBuffers = this._nativeSubmitBuffers;
    submitBuffers.length = 0;
    // Command buffers in one queue submission execute in array order. The
    // exact solver upload/refit is therefore visible to both ray passes without
    // touching the swapchain or adding another presentation boundary.
    if (dynamicBuffer) submitBuffers.push(dynamicBuffer);
    if (lightingBuffer) submitBuffers.push(lightingBuffer);
    if (reflectionBuffer) submitBuffers.push(reflectionBuffer);
    if (submitBuffers.length === 0) return 0;
    try {
      // Reflections require a dedicated empty logical encoder. Submit the
      // optional refit plus lighting and reflections as ordered command buffers
      // in one queue operation instead of introducing another frame boundary.
      this.device.queue.submit(submitBuffers);
      this.nativeQueueSubmitCount += 1;
      if (dynamicBuffer) {
        this._dynamicMeshDirty = false;
        this.dynamicMeshRefitCount += 1;
        this.dynamicMeshFailure = "";
      }
      return (lightingBuffer ? 1 : 0) | (reflectionBuffer ? 2 : 0);
    } catch (error) {
      const failure = String(error?.message || error);
      if (lightingBuffer) {
        this.lightingEnabled = false;
        this.lightingFailure = failure;
      }
      if (reflectionBuffer) {
        this.reflectionsEnabled = false;
        this.reflectionFailure = failure;
      }
      if (dynamicBuffer) this.dynamicMeshFailure = failure;
      console.warn(`[Jelly Rave RTX] Native effect submission disabled: ${failure}`);
      return 0;
    } finally {
      submitBuffers.length = 0;
    }
  }

  renderNative(scene, camera = this.camera, frameOptions = {}) {
    if (this.disposed || this._frameReady || !this.enabled || !this.sceneRegistered ||
        !this.sceneTarget || !this.outputTarget) return false;
    let guideMaterialsApplied = false;
    try {
      // First capture the exact authored frame with the real transmissive
      // materials and complete raster lighting. This is the color that both
      // native effects augment and that we present if reflections are absent.
      const exactRasterTarget = this._ensureRasterTarget();
      this._renderLinearScene(scene, camera, exactRasterTarget);

      // A second offscreen pass only supplies geometric guides. Opaque guide
      // clones can improve primary depth/normal stability, but their color is
      // deliberately never presented and never supplied as RTX sourceColor.
      this._applyNativeGuideMaterials(scene);
      guideMaterialsApplied = true;
      this._renderLinearScene(
        scene,
        camera,
        this.sceneTarget,
        this._mrt,
      );
      this._restoreNativeGuideMaterials();
      guideMaterialsApplied = false;

      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._inverseViewProjection.copy(this._viewProjection).invert();
      camera.getWorldPosition(this._cameraPosition);

      const effectMask = this._evaluateNativeEffects(frameOptions);
      const lightingUsed = (effectMask & 1) !== 0;
      const reflectionsUsed = (effectMask & 2) !== 0;
      if (reflectionsUsed) {
        this._activeTexture = this.outputTarget.texture;
        this.lastPath = lightingUsed ? "rtx-lighting-reflections" : "rtx-reflections";
      } else if (lightingUsed) {
        this._activeTexture = exactRasterTarget.texture;
        this.lastPath = "rtx-lighting";
      } else {
        this.enabled = false;
        this.lastPath = "native-unavailable";
        this._activeTexture = null;
        this._frameReady = false;
        return false;
      }
      this._lastFrameNative = true;
      this._frameReady = true;
      this.nativeFrameCount += 1;
      return true;
    } catch (error) {
      this.failure = `Native jelly-rave evaluation stopped: ${error?.message || error}`;
      console.error(`[Jelly Rave RTX] ${this.failure}`);
      this.enabled = false;
      this.lastPath = "native-failed";
      this._activeTexture = null;
      this._frameReady = false;
      return false;
    } finally {
      if (guideMaterialsApplied) this._restoreNativeGuideMaterials();
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT?.(null);
    }
  }

  renderRaster(scene, camera = this.camera) {
    if (this.disposed || this._frameReady) return false;
    try {
      const target = this._ensureRasterTarget();
      this._renderLinearScene(scene, camera, target);
      this._activeTexture = target.texture;
      this._lastFrameNative = false;
      this._frameReady = true;
      this.lastPath = "webgpu-raster";
      this.rasterFrameCount += 1;
      return true;
    } catch (error) {
      this.failure = `Jelly Rave raster staging failed: ${error?.message || error}`;
      console.error(`[Jelly Rave WebGPU] ${this.failure}`);
      this._activeTexture = null;
      this._frameReady = false;
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT?.(null);
      return false;
    }
  }

  present() {
    if (this.disposed || !this._frameReady || !this._activeTexture) return false;
    const previousToneMapping = this.renderer.toneMapping;
    const previousColorSpace = this.renderer.outputColorSpace;
    const previousAutoClear = this.renderer.autoClear;
    try {
      this._setDisplayTexture(this._activeTexture);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT?.(null);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.autoClear = true;
      // The clear is folded into this render pass by autoClear. Calling clear()
      // on the default target can become a second black swapchain frame.
      this.renderer.render(this._displayScene, this._displayCamera);
      this.lastPresentedPath = this.lastPath;
      this.presentationCount += 1;
      this.frameIndex += 1;
      this._frameReady = false;
      return true;
    } catch (error) {
      this.failure = `Jelly Rave presentation stopped: ${error?.message || error}`;
      console.error(`[Jelly Rave WebGPU] ${this.failure}`);
      this._frameReady = false;
      return false;
    } finally {
      this.renderer.autoClear = previousAutoClear;
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.outputColorSpace = previousColorSpace;
    }
  }

  status() {
    const runtime = liveRtxStatus(this.rtx);
    return {
      enabled: this.enabled,
      configured: Boolean(
        this.enabled && this.sceneRegistered && this.sceneTarget && this.outputTarget,
      ),
      sceneRegistered: this.sceneRegistered,
      frameReady: this._frameReady,
      width: this.width,
      height: this.height,
      frameIndex: this.frameIndex,
      lastPath: this.lastPath,
      lastPresentedPath: this.lastPresentedPath,
      pipelineMode: "generic-bridge",
      failure: this.failure,
      registered: this._registeredStats ? { ...this._registeredStats } : null,
      lighting: {
        available: typeof this.rtx?.evaluateRayLighting === "function",
        enabled: this.lightingEnabled,
        failure: this.lightingFailure,
      },
      reflections: {
        available: typeof this.rtx?.evaluateRayReflections === "function",
        enabled: this.reflectionsEnabled,
        failure: this.reflectionFailure,
        temporalJitter: false,
        environmentIntensity: 0.18,
      },
      dynamicMesh: {
        available: typeof this.rtx?.createDynamicTriangleMesh === "function" &&
          typeof this.rtx?.refitDynamicTriangleMesh === "function",
        active: Boolean(this._dynamicMesh && !this._dynamicMesh.destroyed),
        failure: this.dynamicMeshFailure,
        vertices: this._dynamicMeshDescriptor?.vertexCount ?? 0,
        triangles: (this._dynamicMeshDescriptor?.indices?.length ?? 0) / 3,
        uploads: this.dynamicMeshUploadCount,
        builds: this.dynamicMeshBuildCount,
        refits: this.dynamicMeshRefitCount,
      },
      counts: {
        nativeFrames: this.nativeFrameCount,
        rasterFrames: this.rasterFrameCount,
        presentations: this.presentationCount,
        nativeQueueSubmissions: this.nativeQueueSubmitCount,
        guidePlanBuilds: this._nativeGuidePlanBuildCount,
        guideBindings: this._nativeGuideBindings.length,
        guideSwaps: this._nativeGuideSwaps.length,
      },
      runtimeFeature: runtime?.features?.nativeRayTracing ?? null,
    };
  }

  getStatus() {
    return this.status();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this._frameReady = false;
    this._disposeNativeTargets();
    this._disposeRasterTarget();
    this._destroyStaticScene();
    this._disposeGuideMaterials();
    this._displayGeometry.dispose();
    for (const material of this._displayMaterialCache.values()) material.dispose();
    this._displayMaterialCache.clear();
    this._placeholderMaterial.dispose();
    this._displayQuad.removeFromParent();
  }
}

export const JellyRaveNativeRenderer = NativeRtxRenderer;
