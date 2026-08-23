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
  constructor(renderer, camera, rtx) {
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;
    this.enabled = false;
    this.sceneRegistered = false;
    this.rayLightingEnabled = typeof rtx?.evaluateRayLighting === "function";
    this.rayLightingFailure = "";
    this.failure = "";
    this.width = 0;
    this.height = 0;
    this.frameIndex = 0;
    this.sceneTarget = null;
    this.outputTarget = null;

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
    this._displayMaterial = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._displayMaterial.toneMapped = true;
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

    this._viewProjection = new THREE.Matrix4();
    this._inverseViewProjection = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();
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
      this._createTargets(positiveInteger(width), positiveInteger(height));
      this.enabled = true;
      this.frameIndex = 0;
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

  resize(width, height) {
    const nextWidth = positiveInteger(width);
    const nextHeight = positiveInteger(height);
    if (!this.enabled || (nextWidth === this.width && nextHeight === this.height)) return this.enabled;
    try {
      this._createTargets(nextWidth, nextHeight);
      this.frameIndex = 0;
      return true;
    } catch (error) {
      this.enabled = false;
      this.failure = `Native reflection resize failed: ${error?.message || error}`;
      console.error(`[RTX reflections] ${this.failure}`);
      return false;
    }
  }

  _createTargets(width, height) {
    this._disposeTargets();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = "RTX reflection depth";
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
    sceneTarget.textures[0].name = "output";
    // The primary HDR image is shaded in place by the optional native
    // directional-light-visibility/contact-AO pass before OP84 samples it.
    sceneTarget.textures[0].isStorageTexture = true;
    sceneTarget.textures[1].name = "normalRoughness";
    sceneTarget.textures[2].name = "specularAlbedo";
    for (const texture of sceneTarget.textures) {
      texture.format = THREE.RGBAFormat;
      texture.type = THREE.HalfFloatType;
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.mipmapsAutoUpdate = false;
    }

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
      throw new Error("Three.js did not expose all native reflection GPU textures.");
    }
    requireUsage(sourceColor, 0x04, "Reflection sourceColor");
    requireUsage(sourceColor, 0x08, "RTX lighting sourceColor");
    requireUsage(normalRoughness, 0x04, "Reflection normalRoughness");
    requireUsage(specularAlbedo, 0x04, "Reflection specularAlbedo");
    requireUsage(depth, 0x04, "Reflection depth");
    requireUsage(outputColor, 0x04, "Reflection outputColor presentation");
    requireUsage(outputColor, 0x08, "Reflection outputColor storage");

    this.sceneTarget = sceneTarget;
    this.outputTarget = outputTarget;
    this.width = width;
    this.height = height;
    this._sourceColor = sourceColor;
    this._normalRoughness = normalRoughness;
    this._specularAlbedo = specularAlbedo;
    this._depth = depth;
    this._outputColor = outputColor;
    this._outputView = outputColor.createView();
    this._displayMaterial.map = outputTarget.texture;
    this._displayMaterial.needsUpdate = true;
  }

  get presentationTexture() {
    return this.outputTarget?.texture ?? null;
  }

  render(scene, camera = this.camera, frameOptions = {}) {
    if (!this.enabled || !this.sceneTarget || !this.outputTarget) return false;
    try {
      // Pass 1: one same-size FP16 MRT records source radiance, exact world
      // normal + perceptual roughness, linear F0 + reflection mask, and D32 depth.
      this.renderer.setMRT(this._mrt);
      this.renderer.setRenderTarget(this.sceneTarget);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);

      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._inverseViewProjection.copy(this._viewProjection).invert();
      camera.getWorldPosition(this._cameraPosition);

      // Pass 2: add restrained, ray-tested moon visibility and contact AO to
      // the primary HDR frame. Transparent glazing is absent from the TLAS, so
      // these rays pass through panes while mullions, walls and fixtures still
      // block them. A failure disables only this enhancement, never OP84.
      if (this.rayLightingEnabled && typeof this.rtx.evaluateRayLighting === "function") {
        try {
          const layouts = this.rtx.vulkanImageLayouts;
          const lightingEncoder = this.device.createCommandEncoder({
            label: "RTX glasshouse moon visibility and contact AO",
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
            directionalSampleCount: 4,
            aoSampleCount: 8,
            maxDistance: 10000,
            rayBias: 0.002,
            frameIndex: this.frameIndex,
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

      // Pass 3: prime the distinct FP16 storage output in color-attachment
      // layout. Raw Vulkan work must own a dedicated otherwise-empty encoder.
      const primeEncoder = this.device.createCommandEncoder({
        label: "RTX reflection output prime",
      });
      const primePass = primeEncoder.beginRenderPass({
        label: "RTX reflection output clear",
        colorAttachments: [{
          view: this._outputView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      primePass.end();
      this.device.queue.submit([primeEncoder.finish()]);

      const layouts = this.rtx.vulkanImageLayouts;
      const encoder = this.device.createCommandEncoder({ label: "RTX ray reflections" });
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
        reflectionStrength: 0.92,
        maxDistance: 78,
        rayBias: 0.018,
        roughnessCutoff: 0.82,
        environmentColor: [0.032, 0.065, 0.088],
        environmentIntensity: 0.78,
        // Until a history buffer and disocclusion-aware denoiser are present,
        // changing the GGX sample rotation every frame creates crawling noise.
        // Keep the spatial sequence deterministic so reflections stay stable.
        temporalJitter: false,
        // The demo deliberately spends the available RTX headroom on stable
        // spatial convergence. Other pages keep the bridge's 1/4/8-ray default.
        highQuality: true,
        frameIndex: this.frameIndex++,
        depthInverted: false,
      });
      this.device.queue.submit([encoder.finish()]);

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

  present(hudTexture = null) {
    if (!this.enabled || !this.outputTarget || !this._displayMaterial.map) return false;
    try {
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
    this.sceneTarget?.dispose();
    this.outputTarget?.dispose();
    this.sceneTarget = null;
    this.outputTarget = null;
    this._sourceColor = null;
    this._normalRoughness = null;
    this._specularAlbedo = null;
    this._depth = null;
    this._outputColor = null;
    this._outputView = null;
    this.width = 0;
    this.height = 0;
    this._displayMaterial.map = null;
  }

  dispose() {
    this.enabled = false;
    this._disposeTargets();
    if (this.sceneRegistered) this.rtx?.destroyStaticScene?.();
    this.sceneRegistered = false;
    this._displayGeometry.dispose();
    this._displayMaterial.dispose();
    this._hudGeometry.dispose();
    this._hudMaterial.dispose();
  }
}
