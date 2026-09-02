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

function makeResource(texture, layout, width, height) {
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
  material.rtxUsesResolvedPbr = material.isMeshStandardNodeMaterial ? 1 : 0;
  if (!Number.isFinite(material.rtxReflectionMask)) {
    if (material.transparent || Number(material.opacity ?? 1) < 0.995) {
      material.rtxReflectionMask = 0;
    } else {
      const glossy = 1 - THREE.MathUtils.clamp(material.roughness, 0, 1);
      const metallic = THREE.MathUtils.clamp(material.metalness, 0, 1);
      const clearcoat = THREE.MathUtils.clamp(Number(material.clearcoat ?? 0), 0, 1);
      material.rtxReflectionMask = THREE.MathUtils.clamp(
        metallic * 0.76 + clearcoat * 0.35 + glossy * 0.18,
        0,
        1,
      );
    }
  }
}

export function prepareRtxGuideMaterials(scene) {
  scene.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) normalizeMaterial(material);
  });
}

async function waitForStaticScene(rtx, timeoutMs = 6000) {
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

function vectorArray(value, fallback) {
  if (value?.isVector3) return [value.x, value.y, value.z];
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  return fallback;
}

/**
 * One isolated boundary for the runtime's generic RTX renderer features. The
 * source scene, ocean transport, caustics and every artistic shader remain
 * ordinary Three.js/TSL. Native code receives only standard depth/PBR guides
 * for generic visibility, AO and one-bounce reflections.
 */
export class NativeRtxRenderer {
  constructor(renderer, camera, rtx) {
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;
    this.enabled = false;
    this.sceneRegistered = false;
    this.failure = "";
    this.width = 0;
    this.height = 0;
    this.frameIndex = 0;
    this.rasterTarget = null;
    this.sceneTarget = null;
    this.outputTarget = null;
    this.reflectionsEnabled = typeof rtx?.evaluateRayReflections === "function";
    this.lightingEnabled = typeof rtx?.evaluateRayLighting === "function";
    this.lastPath = "raster-fallback";
    this._activeTexture = null;
    this._lastFrameNative = false;

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
    this._displayScene.name = "Native first-person beach presentation";
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._displayGeometry = new THREE.PlaneGeometry(2, 2);
    const nativeUvs = this._displayGeometry.getAttribute("uv");
    for (let index = 0; index < nativeUvs.count; ++index) nativeUvs.setY(index, 1 - nativeUvs.getY(index));
    nativeUvs.needsUpdate = true;
    // WebGPURenderer compiles the material's texture node into its render
    // pipeline. Mutating MeshBasicNodeMaterial.map after that compilation can
    // leave the old binding active, which made the MRT diagnostics depend on
    // whichever texture happened to compile first. Keep one material per
    // presentation texture instead; changing views then only changes the
    // fullscreen quad's already-stable material/pipeline.
    this._displayMaterialCache = new Map();
    this._displayPlaceholderMaterial = this._createDisplayMaterial(null);
    this._displayMaterial = this._displayPlaceholderMaterial;
    this._displayQuad = new THREE.Mesh(this._displayGeometry, this._displayMaterial);
    this._displayQuad.frustumCulled = false;
    this._displayQuad.renderOrder = 0;
    this._displayScene.add(this._displayQuad);

    this._hudGeometry = new THREE.PlaneGeometry(2, 2);
    const hudUvs = this._hudGeometry.getAttribute("uv");
    for (let index = 0; index < hudUvs.count; ++index) hudUvs.setY(index, 1 - hudUvs.getY(index));
    hudUvs.needsUpdate = true;
    this._hudMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._hudMaterial.toneMapped = false;
    this._hudQuad = new THREE.Mesh(this._hudGeometry, this._hudMaterial);
    this._hudQuad.frustumCulled = false;
    this._hudQuad.renderOrder = 1;
    this._hudQuad.visible = false;
    this._displayScene.add(this._hudQuad);

    this._viewProjection = new THREE.Matrix4();
    this._inverseViewProjection = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();
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
    if (this._displayMaterial === material) return;
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

  get rayPathLabel() {
    if (!this.enabled) return "WEBGPU FALLBACK";
    if (this.reflectionsEnabled && this.lightingEnabled) return "RTX LIGHTING + REFLECTIONS";
    if (this.reflectionsEnabled) return "RTX REFLECTIONS";
    if (this.lightingEnabled) return "RTX RAY LIGHTING";
    return "WEBGPU FALLBACK";
  }

  async configure(width, height, staticScene) {
    this.enabled = false;
    this.failure = "";
    const hasEvaluation = this.reflectionsEnabled || this.lightingEnabled;
    if (!this.device || !this.rtx?.capabilities?.nativeRayTracing ||
        typeof this.rtx.registerStaticScene !== "function" || !hasEvaluation) {
      this.failure = "The native ray-query bridge is unavailable.";
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
        });
        if (!registration?.queued) throw new Error("Static beach scene registration was not queued.");
        const ready = await waitForStaticScene(this.rtx);
        if (!ready.ready) {
          throw new Error(ready.feature?.reason || "The beach BLAS/TLAS did not become ready before timeout.");
        }
        this.sceneRegistered = true;
        console.log(
          `[Beach RTX] Static beach ready: ${staticScene.vertexCount.toLocaleString()} vertices` +
          ` · ${staticScene.triangleCount.toLocaleString()} triangles` +
          ` · rayLighting=${this.lightingEnabled}` +
          ` · rayReflections=${this.reflectionsEnabled}`,
        );
      }
      this._createTargets(positiveInteger(width), positiveInteger(height));
      this.enabled = true;
      this.frameIndex = 0;
      return true;
    } catch (error) {
      this.failure = `Native beach setup failed: ${error?.message || error}`;
      console.warn(`[Beach RTX] ${this.failure}`);
      this._disposeNativeTargets();
      if (this.sceneRegistered) this.rtx.destroyStaticScene?.();
      this.sceneRegistered = false;
      return false;
    }
  }

  resize(width, height) {
    const nextWidth = positiveInteger(width);
    const nextHeight = positiveInteger(height);
    if (nextWidth === this.width && nextHeight === this.height) return true;

    this.width = nextWidth;
    this.height = nextHeight;
    let rasterReady = true;
    if (this.rasterTarget) {
      try {
        this._createRasterTarget(nextWidth, nextHeight);
      } catch (error) {
        rasterReady = false;
        this.failure = `Beach raster resize failed: ${error?.message || error}`;
        console.error(`[Beach WebGPU] ${this.failure}`);
        this._disposeRasterTarget();
      }
    }

    if (this.enabled) {
      try {
        this._createTargets(nextWidth, nextHeight);
        this.frameIndex = 0;
      } catch (error) {
        this.enabled = false;
        this.failure = `Native beach resize failed: ${error?.message || error}`;
        console.error(`[Beach RTX] ${this.failure}`);
        this._disposeNativeTargets();
        if (this.sceneRegistered) this.rtx?.destroyStaticScene?.();
        this.sceneRegistered = false;
      }
    }
    return rasterReady;
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
    target.texture.name = "Beach WebGPU raster composite";
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    target.texture.mipmapsAutoUpdate = false;
    this.renderer.initRenderTarget(target);
    this.rasterTarget = target;
    this.width = width;
    this.height = height;
    return target;
  }

  _ensureRasterTarget() {
    const width = positiveInteger(this.width);
    const height = positiveInteger(this.height);
    if (!this.rasterTarget || this.rasterTarget.width !== width || this.rasterTarget.height !== height) {
      this._createRasterTarget(width, height);
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

  _createTargets(width, height) {
    this._disposeNativeTargets();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = "Beach RTX depth";
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
    // MRTNode resolves its `output` member by render-target texture name. The
    // GPU handle is still exposed to the bridge as sourceColor below, but this
    // first attachment must retain Three.js' canonical MRT name.
    const names = [
      "output",
      "normalRoughness",
      "specularAlbedo",
    ];
    sceneTarget.textures.forEach((texture, index) => {
      texture.name = names[index];
      texture.format = THREE.RGBAFormat;
      texture.type = THREE.HalfFloatType;
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.mipmapsAutoUpdate = false;
    });
    sceneTarget.textures[0].isStorageTexture = true;

    const outputTarget = this._makeStorageTarget(width, height, "Beach native composite");
    this.renderer.initRenderTarget(sceneTarget);
    this.renderer.initRenderTarget(outputTarget);

    const sourceColor = this.renderer.backend.get(sceneTarget.textures[0]).texture;
    const normalRoughness = this.renderer.backend.get(sceneTarget.textures[1]).texture;
    const specularAlbedo = this.renderer.backend.get(sceneTarget.textures[2]).texture;
    const depth = this.renderer.backend.get(sceneTarget.depthTexture).texture;
    const outputColor = this.renderer.backend.get(outputTarget.texture).texture;
    if (!sourceColor || !normalRoughness || !specularAlbedo || !depth || !outputColor) {
      sceneTarget.dispose();
      outputTarget.dispose();
      throw new Error("Three.js did not expose all generic RTX guide textures.");
    }
    requireUsage(sourceColor, 0x04, "RTX sourceColor");
    requireUsage(sourceColor, 0x08, "Ray-lighting sourceColor");
    requireUsage(normalRoughness, 0x04, "Reflection normalRoughness");
    requireUsage(specularAlbedo, 0x04, "Reflection specularAlbedo");
    requireUsage(depth, 0x04, "RTX depth");
    requireUsage(outputColor, 0x04, "RTX output presentation");
    requireUsage(outputColor, 0x08, "RTX output storage");

    this.sceneTarget = sceneTarget;
    this.outputTarget = outputTarget;
    this.width = width;
    this.height = height;
    this._sourceColor = sourceColor;
    this._normalRoughness = normalRoughness;
    this._specularAlbedo = specularAlbedo;
    this._depth = depth;
    this._outputColor = outputColor;
    this._activeTexture = outputTarget.texture;
    this._setDisplayTexture(this._activeTexture);
  }

  _evaluateLighting(frameOptions, layouts) {
    if (!this.lightingEnabled || typeof this.rtx.evaluateRayLighting !== "function") return false;
    try {
      const encoder = this.device.createCommandEncoder({ label: "Beach ray-tested sun lighting" });
      this.rtx.evaluateRayLighting({
        commandEncoder: encoder,
        color: makeResource(this._sourceColor, layouts.colorAttachment, this.width, this.height),
        depth: makeResource(this._depth, layouts.depthStencilAttachment, this.width, this.height),
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection.toArray(),
        cameraPosition: this._cameraPosition,
        directionalLightDirection:
          vectorArray(frameOptions.sunDirection, [-0.42, 0.72, 0.55]),
        directionalLightIntensity: Number(frameOptions.sunIntensity ?? 4.6),
        directionalAngularRadius: Number(frameOptions.sunAngularRadius ?? 0.0047),
        directionalSampleCount: 4,
        aoSampleCount: 8,
        maxDistance: Number(frameOptions.maxDistance ?? 220),
        rayBias: Number(frameOptions.rayBias ?? 0.012),
        frameIndex: this.frameIndex,
        shadowStrength: Number(frameOptions.shadowStrength ?? 0.58),
        aoStrength: Number(frameOptions.aoStrength ?? 0.22),
        aoRadius: Number(frameOptions.aoRadius ?? 1.6),
        depthInverted: false,
      });
      this.device.queue.submit([encoder.finish()]);
      return true;
    } catch (error) {
      this.lightingEnabled = false;
      console.warn(`[Beach RTX] Ray lighting disabled: ${error?.message || error}`);
      return false;
    }
  }

  _evaluateReflections(frameOptions, layouts) {
    if (!this.reflectionsEnabled || typeof this.rtx.evaluateRayReflections !== "function") return false;
    try {
      const encoder = this.device.createCommandEncoder({ label: "Beach ray reflections fallback" });
      this.rtx.evaluateRayReflections({
        commandEncoder: encoder,
        sourceColor: makeResource(this._sourceColor, layouts.colorAttachment, this.width, this.height),
        outputColor: makeResource(this._outputColor, layouts.colorAttachment, this.width, this.height),
        depth: makeResource(this._depth, layouts.depthStencilAttachment, this.width, this.height),
        normalRoughness: makeResource(this._normalRoughness, layouts.colorAttachment, this.width, this.height),
        specularAlbedo: makeResource(this._specularAlbedo, layouts.colorAttachment, this.width, this.height),
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection.toArray(),
        cameraPosition: this._cameraPosition,
        reflectionStrength: Number(frameOptions.reflectionStrength ?? 0.74),
        maxDistance: Number(frameOptions.maxDistance ?? 160),
        rayBias: Number(frameOptions.rayBias ?? 0.014),
        roughnessCutoff: Number(frameOptions.roughnessCutoff ?? 0.78),
        environmentColor: vectorArray(frameOptions.environmentColor, [0.46, 0.68, 0.92]),
        environmentIntensity: Number(frameOptions.environmentIntensity ?? 0.82),
        temporalJitter: false,
        highQuality: true,
        frameIndex: this.frameIndex,
        depthInverted: false,
      });
      this.device.queue.submit([encoder.finish()]);
      return true;
    } catch (error) {
      this.reflectionsEnabled = false;
      console.warn(`[Beach RTX] Ray reflections disabled: ${error?.message || error}`);
      return false;
    }
  }

  _renderLinearScene(scene, camera, target, mrtLayout = null) {
    const previousToneMapping = this.renderer.toneMapping;
    const previousExposure = this.renderer.toneMappingExposure;
    try {
      // RTX/compute must receive scene-linear radiance. Presentation applies
      // the renderer's ACES transform exactly once after native processing.
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

  render(scene, camera = this.camera, frameOptions = {}) {
    if (!this.enabled || !this.sceneTarget) return false;
    try {
      this._renderLinearScene(scene, camera, this.sceneTarget, this._mrt);

      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._inverseViewProjection.copy(this._viewProjection).invert();
      camera.getWorldPosition(this._cameraPosition);

      const layouts = this.rtx.vulkanImageLayouts;
      const lightingUsed = this._evaluateLighting(frameOptions, layouts);
      const reflectionsUsed = this._evaluateReflections(frameOptions, layouts);

      if (reflectionsUsed) {
        this._activeTexture = this.outputTarget.texture;
        this.lastPath = lightingUsed ? "rtx-lighting-reflections" : "rtx-reflections";
      } else if (lightingUsed) {
        this._activeTexture = this.sceneTarget.textures[0];
        this.lastPath = "rtx-ray-lighting";
      } else {
        this.enabled = false;
        this._lastFrameNative = false;
        this.lastPath = "raster-fallback";
        return false;
      }
      this._lastFrameNative = true;
      this.frameIndex += 1;
      return true;
    } catch (error) {
      this.enabled = false;
      this._lastFrameNative = false;
      this.lastPath = "raster-fallback";
      this.failure = `Native Beach evaluation stopped: ${error?.message || error}`;
      console.error(`[Beach RTX] ${this.failure}`);
      if (error?.stack) console.error(error.stack);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      return false;
    }
  }

  renderRaster(scene, camera = this.camera) {
    try {
      // Always use an ordinary offscreen WebGPU target for the non-RTX path.
      // It is created lazily so a native-only run does not pay its memory cost,
      // while bridge-less hosts still use the same one-present compositor.
      const target = this._ensureRasterTarget();
      this._renderLinearScene(scene, camera, target);

      this._activeTexture = target.texture;
      this._lastFrameNative = false;
      this.lastPath = "webgpu-raster";
      this.frameIndex += 1;
      return true;
    } catch (error) {
      this.failure = `Beach raster target stopped: ${error?.message || error}`;
      console.error(`[Beach WebGPU] ${this.failure}`);
      if (error?.stack) console.error(error.stack);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      return false;
    }
  }

  present(hudTexture = null, debugMode = 0) {
    if (!this._activeTexture) return false;
    try {
      let presentationTexture = this._activeTexture;
      if (this._lastFrameNative && debugMode === 3 && this.sceneTarget?.textures?.[1]) {
        // The only native-side diagnostic is the standard Three.js normal /
        // roughness guide. Fresnel, caustics and ray-distance visualizations
        // remain material-authored TSL views in the source project.
        presentationTexture = this.sceneTarget.textures[1];
      }
      this._setDisplayTexture(presentationTexture);
      if (this._hudMaterial.map !== hudTexture) {
        this._hudMaterial.map = hudTexture;
        this._hudMaterial.needsUpdate = true;
      }
      this._hudQuad.visible = Boolean(hudTexture);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      const previousAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = true;
      try {
        // Exactly one canvas submission composites native output and the
        // offscreen JS HUD, avoiding competing swapchain presents.
        this.renderer.render(this._displayScene, this._displayCamera);
      } finally {
        this.renderer.autoClear = previousAutoClear;
      }
      return true;
    } catch (error) {
      this.failure = `Beach frame presentation stopped: ${error?.message || error}`;
      console.error(`[Beach WebGPU] ${this.failure}`);
      return false;
    }
  }

  _disposeNativeTargets() {
    const nativeTextures = [
      this.outputTarget?.texture,
      ...(this.sceneTarget?.textures ?? []),
    ].filter(Boolean);
    const activeWasNative = nativeTextures.includes(this._activeTexture);
    this._releaseDisplayTextures(nativeTextures);
    this.sceneTarget?.dispose();
    this.outputTarget?.dispose();
    this.sceneTarget = null;
    this.outputTarget = null;
    this._sourceColor = null;
    this._normalRoughness = null;
    this._specularAlbedo = null;
    this._depth = null;
    this._outputColor = null;
    if (activeWasNative) {
      this._activeTexture = null;
      this._lastFrameNative = false;
    }
  }

  _disposeRasterTarget() {
    const rasterTexture = this.rasterTarget?.texture ?? null;
    const activeWasRaster = this._activeTexture === rasterTexture;
    this._releaseDisplayTextures([rasterTexture]);
    this.rasterTarget?.dispose();
    this.rasterTarget = null;
    if (activeWasRaster) {
      this._activeTexture = null;
    }
  }

  dispose() {
    this.enabled = false;
    this._disposeNativeTargets();
    this._disposeRasterTarget();
    this.width = 0;
    this.height = 0;
    if (this.sceneRegistered) this.rtx?.destroyStaticScene?.();
    this.sceneRegistered = false;
    this._displayGeometry.dispose();
    for (const material of this._displayMaterialCache.values()) material.dispose();
    this._displayMaterialCache.clear();
    this._displayPlaceholderMaterial.dispose();
    this._displayMaterial = null;
    this._hudGeometry.dispose();
    this._hudMaterial.dispose();
  }
}
