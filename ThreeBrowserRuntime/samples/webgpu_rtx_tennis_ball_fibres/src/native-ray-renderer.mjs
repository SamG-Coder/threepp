import * as THREE from "three/webgpu";

const LIGHT_SAMPLES = 6;
const AO_SAMPLES = 4;
const DOF_UNIFORM_BYTES = 112;

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

async function waitForStaticScene(rtx, timeoutMs = 7000) {
  const deadline = performance.now() + timeoutMs;
  let status = rtx?.getStatus?.() ?? rtx?.status ?? null;
  while (performance.now() < deadline) {
    const feature = status?.features?.nativeRayTracing;
    if (feature?.active) return { ready: true, status, feature };
    if (feature?.supported === false) return { ready: false, status, feature };
    await new Promise(resolve => setTimeout(resolve, 10));
    status = rtx?.getStatus?.() ?? rtx?.status ?? status;
  }
  return { ready: false, status, feature: status?.features?.nativeRayTracing ?? null };
}

async function compileFibreTransport(rtx) {
  if (!rtx?.capabilities?.rayQuery || typeof rtx.compileRayQueryPipeline !== "function") {
    return null;
  }
  const shaderUrl = new URL("../shaders/fibre_transport.comp", import.meta.url);
  const response = await fetch(shaderUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${shaderUrl.pathname}`);
  const source = await response.text();
  return rtx.compileRayQueryPipeline({
    profile: "lighting-v1",
    source,
    language: "glsl",
    stage: "compute",
    entryPoint: "main",
    label: "Tennis felt inter-fibre visibility and multiple scatter",
  });
}

async function createMacroDofResources(device) {
  const shaderStage = globalThis.GPUShaderStage;
  const bufferUsage = globalThis.GPUBufferUsage;
  if (!shaderStage || !bufferUsage) throw new Error("WebGPU DOF constants are unavailable.");
  const shaderUrl = new URL("../shaders/macro_dof.wgsl", import.meta.url);
  const response = await fetch(shaderUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${shaderUrl.pathname}`);
  const source = await response.text();
  const layout = device.createBindGroupLayout({
    label: "Tennis macro depth-of-field bindings",
    entries: [
      { binding: 0, visibility: shaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 1, visibility: shaderStage.COMPUTE, texture: { sampleType: "depth" } },
      {
        binding: 2,
        visibility: shaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "rgba16float" },
      },
      { binding: 3, visibility: shaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: "Tennis macro bilateral golden-angle DOF",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ label: "Tennis macro DOF WGSL", code: source }),
      entryPoint: "main",
    },
  });
  const uniform = device.createBuffer({
    label: "Tennis macro DOF parameters",
    size: DOF_UNIFORM_BYTES,
    usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
  });
  return { layout, pipeline, uniform };
}

function requireUsage(texture, usage, label) {
  if ((Number(texture?.usage ?? 0) & usage) !== usage) {
    throw new Error(`${label} is missing GPUTextureUsage 0x${usage.toString(16)}.`);
  }
}

export class TennisRayRenderer {
  constructor(renderer, camera, rtx = null) {
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;
    this.fibres = null;
    this.target = null;
    this.width = 1;
    this.height = 1;
    this.active = false;
    this.raysEnabled = true;
    this.sceneRegistered = false;
    this.pipeline = null;
    this.customPipeline = false;
    this.failure = "";
    this.evaluationCount = 0;
    this.dofResources = null;
    this.dofTarget = null;
    this.dofBindGroup = null;
    this.dofActive = false;
    this._viewProjection = new THREE.Matrix4();
    this._inverseViewProjection = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();

    this._displayScene = new THREE.Scene();
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._displayGeometry = new THREE.PlaneGeometry(2, 2);
    const worldUvs = this._displayGeometry.getAttribute("uv");
    for (let index = 0; index < worldUvs.count; ++index) {
      worldUvs.setY(index, 1 - worldUvs.getY(index));
    }
    worldUvs.needsUpdate = true;
    this._displayMaterialCache = new Map();
    this._displayPlaceholderMaterial = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._displayPlaceholderMaterial.toneMapped = true;
    this._displayMaterial = this._displayPlaceholderMaterial;
    this._displayQuad = new THREE.Mesh(this._displayGeometry, this._displayMaterial);
    this._displayQuad.name = "Linear HDR tennis-felt presentation";
    this._displayQuad.renderOrder = 0;
    this._displayQuad.frustumCulled = false;
    this._displayScene.add(this._displayQuad);

    this._hudGeometry = new THREE.PlaneGeometry(2, 2);
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
    this._hudQuad.name = "JavaScript bitmap macro HUD";
    this._hudQuad.renderOrder = 1;
    this._hudQuad.frustumCulled = false;
    this._hudQuad.visible = false;
    this._displayScene.add(this._hudQuad);
  }

  _displayMaterialFor(texture) {
    if (!texture) return this._displayPlaceholderMaterial;
    let material = this._displayMaterialCache.get(texture);
    if (!material) {
      material = new THREE.MeshBasicNodeMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        fog: false,
      });
      material.toneMapped = true;
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

  async configure(staticScene, fibres) {
    this.fibres = fibres;
    this.active = false;
    this.failure = "";
    try {
      this.dofResources = await createMacroDofResources(this.device);
    } catch (error) {
      this.dofResources = null;
      console.warn(`[RTX Tennis Felt] Macro DOF unavailable: ${error?.message || error}`);
    }
    const capabilities = this.rtx?.capabilities ?? {};
    if (!this.device || !(capabilities.rayQuery || capabilities.nativeRayTracing) ||
        typeof this.rtx?.registerStaticScene !== "function" ||
        typeof this.rtx?.evaluateRayLighting !== "function") {
      this.failure = "Native ray-query lighting is unavailable; exact GPU fibres remain rasterized.";
      return false;
    }

    try {
      try {
        this.pipeline = await compileFibreTransport(this.rtx);
        this.customPipeline = Boolean(this.pipeline);
      } catch (error) {
        console.warn(
          `[RTX Tennis Felt] Project transport shader unavailable; generic lighting retained: ` +
          `${error?.message || error}`,
        );
        this.pipeline = null;
        this.customPipeline = false;
      }
      const registration = this.rtx.registerStaticScene({
        positions: staticScene.positions,
        indices: staticScene.indices,
      });
      if (!registration?.queued) {
        throw new Error(registration?.reason || "Static tennis scene registration was rejected.");
      }
      this.sceneRegistered = true;
      const ready = await waitForStaticScene(this.rtx);
      if (!ready.ready) {
        throw new Error(ready.feature?.reason || "The static tennis TLAS did not become ready.");
      }
      const dynamicMesh = await fibres.attachDynamicMesh();
      if (!dynamicMesh) throw new Error("The exact dynamic fibre mesh could not be attached.");
      this.active = true;
      console.log(
        `[RTX Tennis Felt] Ready · static=${staticScene.triangleCount.toLocaleString()} triangles` +
        ` · fibres=${fibres.stats.fibreCount.toLocaleString()}` +
        ` · RTX proxy=${fibres.stats.rtxProxyTriangleCount.toLocaleString()} triangles` +
        ` · shader=${this.customPipeline ? "project fibre transport" : "generic lighting-v1"}`,
      );
      return true;
    } catch (error) {
      this.failure = error?.message || String(error);
      this.active = false;
      fibres.destroyDynamicMesh?.();
      if (this.sceneRegistered) this.rtx?.destroyStaticScene?.();
      this.sceneRegistered = false;
      console.warn(`[RTX Tennis Felt] Raster fallback: ${this.failure}`);
      return false;
    }
  }

  resize(width, height) {
    const nextWidth = Math.max(1, Math.trunc(width));
    const nextHeight = Math.max(1, Math.trunc(height));
    if (this.target && nextWidth === this.width && nextHeight === this.height) return;
    this._releaseDisplayTextures([
      this.target?.texture ?? null,
      this.dofTarget?.texture ?? null,
    ]);
    this.target?.dispose();
    this.dofTarget?.dispose();
    this.dofTarget = null;
    this.dofBindGroup = null;
    const depthTexture = new THREE.DepthTexture(nextWidth, nextHeight, THREE.FloatType);
    depthTexture.name = "Tennis felt depth32";
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;
    const target = new THREE.RenderTarget(nextWidth, nextHeight, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
      generateMipmaps: false,
    });
    target.texture.name = "Tennis felt scene-linear HDR";
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.isStorageTexture = true;
    target.texture.generateMipmaps = false;
    target.texture.mipmapsAutoUpdate = false;
    this.renderer.initRenderTarget(target);
    const color = this.renderer.backend.get(target.texture)?.texture;
    const depth = this.renderer.backend.get(target.depthTexture)?.texture;
    if (!color || !depth) {
      target.dispose();
      throw new Error("Three.js did not expose the tennis-felt native color/depth textures.");
    }
    requireUsage(color, 0x08, "Tennis felt HDR color");
    requireUsage(color, 0x10, "Tennis felt HDR attachment");
    requireUsage(depth, 0x04, "Tennis felt depth sampling");
    this.target = target;
    this.width = nextWidth;
    this.height = nextHeight;
    this._color = color;
    this._depth = depth;
    if (this.dofResources) {
      const dofTarget = new THREE.RenderTarget(nextWidth, nextHeight, {
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        colorSpace: THREE.NoColorSpace,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
        generateMipmaps: false,
      });
      dofTarget.texture.name = "Tennis felt depth-of-field HDR";
      dofTarget.texture.colorSpace = THREE.NoColorSpace;
      dofTarget.texture.isStorageTexture = true;
      dofTarget.texture.generateMipmaps = false;
      dofTarget.texture.mipmapsAutoUpdate = false;
      this.renderer.initRenderTarget(dofTarget);
      const dofColor = this.renderer.backend.get(dofTarget.texture)?.texture;
      if (!dofColor) {
        dofTarget.dispose();
        throw new Error("Three.js did not expose the macro DOF storage texture.");
      }
      requireUsage(dofColor, 0x08, "Tennis felt DOF color");
      this.dofTarget = dofTarget;
      this._dofColor = dofColor;
      this.dofBindGroup = this.device.createBindGroup({
        label: "Tennis macro DOF frame resources",
        layout: this.dofResources.layout,
        entries: [
          { binding: 0, resource: color.createView() },
          { binding: 1, resource: depth.createView() },
          { binding: 2, resource: dofColor.createView() },
          { binding: 3, resource: { buffer: this.dofResources.uniform } },
        ],
      });
    }
    // WebGPU compiles a texture node into the presentation pipeline. Keep a
    // stable material per target texture rather than mutating a compiled map;
    // otherwise a resize can briefly present the destroyed old binding.
    this._setDisplayTexture(this.dofTarget?.texture ?? target.texture);
  }

  _recordDof(encoder, {
    focusDistance = 1,
    maximumCoc = 6,
    strength = 1,
    aperturePixels = 34,
  } = {}) {
    if (!this.dofResources || !this.dofBindGroup) {
      this.dofActive = false;
      return false;
    }
    const bytes = new ArrayBuffer(DOF_UNIFORM_BYTES);
    const floats = new Float32Array(bytes);
    const integers = new Uint32Array(bytes);
    floats.set(this._inverseViewProjection.elements, 0);
    floats.set([
      this._cameraPosition.x,
      this._cameraPosition.y,
      this._cameraPosition.z,
      1,
    ], 16);
    floats.set([
      Math.max(0.001, Number(focusDistance) || 1),
      Math.max(0, Number(maximumCoc) || 0),
      THREE.MathUtils.clamp(Number(strength) || 0, 0, 1),
      Math.max(0, Number(aperturePixels) || 0),
    ], 20);
    integers[24] = this.width;
    integers[25] = this.height;
    integers[26] = 0;
    integers[27] = 0;
    this.device.queue.writeBuffer(this.dofResources.uniform, 0, bytes);
    const pass = encoder.beginComputePass({ label: "Tennis macro depth of field" });
    pass.setPipeline(this.dofResources.pipeline);
    pass.setBindGroup(0, this.dofBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8), 1);
    pass.end();
    this.dofActive = strength > 0.001;
    return true;
  }

  _renderLinearBase(scene, camera) {
    const previousToneMapping = this.renderer.toneMapping;
    const previousExposure = this.renderer.toneMappingExposure;
    const previousTarget = this.renderer.getRenderTarget?.() ?? null;
    try {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
      this.renderer.setRenderTarget(this.target);
      this.renderer.setMRT(null);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setMRT(null);
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.toneMappingExposure = previousExposure;
    }
  }

  render(scene, camera, {
    simulation = {},
    lightDirection = [-0.46, 0.78, 0.42],
    lightDistance = 32,
    lightAngularRadius = 0.065,
    lightIntensity = 1.42,
    lightColor = [1.0, 0.88, 0.72],
    environmentColor = [0.20, 0.25, 0.19],
    environmentIntensity = 0.52,
    dof = {},
  } = {}) {
    if (!this.target || !this.fibres) return false;
    try {
      this._renderLinearBase(scene, camera);
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._inverseViewProjection.copy(this._viewProjection).invert();
      camera.getWorldPosition(this._cameraPosition);

      const encoder = this.device.createCommandEncoder({
        label: "Tennis felt physics, raster, BLAS refit and ray paths",
      });
      this.fibres.recordSimulation(encoder, simulation);
      this.fibres.recordRaster(encoder, {
        colorTexture: this._color,
        depthTexture: this._depth,
        viewProjection: this._viewProjection.elements,
        cameraPosition: this._cameraPosition.toArray(),
        lightDirection,
        lightIntensity,
        lightColor,
        environmentColor,
        environmentIntensity,
      });

      if (this.active) {
        this.fibres.recordRefit(encoder);
        if (this.raysEnabled) {
          const layouts = this.rtx.vulkanImageLayouts;
          const result = this.rtx.evaluateRayLighting({
            ...(this.pipeline ? { pipeline: this.pipeline } : {}),
            commandEncoder: encoder,
            color: makeResource(this._color, layouts.colorAttachment, this.width, this.height),
            depth: makeResource(this._depth, layouts.depthStencilAttachment, this.width, this.height),
            width: this.width,
            height: this.height,
            inverseViewProjection: this._inverseViewProjection.toArray(),
            cameraPosition: this._cameraPosition.toArray(),
            directionalLightDirection: lightDirection,
            directionalLightIntensity: 1,
            directionalAngularRadius: lightAngularRadius,
            directionalSampleCount: LIGHT_SAMPLES,
            aoSampleCount: AO_SAMPLES,
            maxDistance: lightDistance,
            rayBias: 0.00024,
            frameIndex: 0,
            shadowStrength: 0.64,
            aoStrength: 0.31,
            aoRadius: 0.013,
            depthInverted: false,
          });
          if (result?.queued === false) {
            throw new Error(result.reason || "Tennis fibre ray lighting was rejected.");
          }
          this.evaluationCount += 1;
        }
      }
      this._recordDof(encoder, dof);
      this.device.queue.submit([encoder.finish()]);
      return true;
    } catch (error) {
      this.failure = error?.message || String(error);
      console.error(`[RTX Tennis Felt] Frame path stopped: ${this.failure}`);
      // The GPU simulation and exact-position raster use the same encoder as
      // native work. Keep the failure explicit instead of presenting stale hair.
      return false;
    }
  }

  present(hudTexture = null) {
    if (!this.target) return false;
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
      this.renderer.render(this._displayScene, this._displayCamera);
    } finally {
      this.renderer.autoClear = previousAutoClear;
    }
    return true;
  }

  get status() {
    return Object.freeze({
      available: Boolean(this.rtx?.capabilities?.rayQuery || this.rtx?.capabilities?.nativeRayTracing),
      active: this.active,
      raysEnabled: this.raysEnabled,
      customPipeline: this.customPipeline,
      lightSamples: LIGHT_SAMPLES,
      aoSamples: AO_SAMPLES,
      evaluationCount: this.evaluationCount,
      refitCount: this.fibres?.refitCount ?? 0,
      dofActive: this.dofActive,
      failure: this.failure,
    });
  }

  dispose() {
    this.fibres?.destroyDynamicMesh?.();
    if (this.sceneRegistered) this.rtx?.destroyStaticScene?.();
    this.sceneRegistered = false;
    this.active = false;
    this.pipeline?.destroy?.();
    this.pipeline = null;
    this.target?.dispose();
    this.target = null;
    this.dofTarget?.dispose();
    this.dofTarget = null;
    this.dofResources?.uniform?.destroy?.();
    this.dofResources = null;
    this.dofBindGroup = null;
    this._displayGeometry.dispose();
    for (const material of this._displayMaterialCache.values()) material.dispose();
    this._displayMaterialCache.clear();
    this._displayPlaceholderMaterial.dispose();
    this._displayMaterial = null;
    this._hudGeometry.dispose();
    this._hudMaterial.dispose();
  }
}
