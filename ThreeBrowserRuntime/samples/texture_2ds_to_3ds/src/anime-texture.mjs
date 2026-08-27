import * as THREE from "three/webgpu";

const ANIME_SHADER_URL = new URL("../shaders/anime_texture.comp", import.meta.url);

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

export function collectOpaqueTriangles(root, options = {}) {
  const maxTriangles = options.maxTriangles ?? 1_200_000;
  const positions = [];
  const indices = [];
  const radiance = [];
  const surface = [];
  const world = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!object.isMesh || !object.geometry || object.userData?.rtxIgnore) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    const triangleCount = index ? Math.trunc(index.count / 3) : Math.trunc(position.count / 3);
    if (indices.length / 3 + triangleCount > maxTriangles) return;
    const base = positions.length / 3;
    object.updateMatrixWorld(true);
    for (let i = 0; i < position.count; i++) {
      world.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      positions.push(world.x, world.y, world.z);
    }
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < position.count; i++) indices.push(base + i);
    }
    const color = object.material?.color ?? new THREE.Color(0x6a7a4a);
    for (let t = 0; t < triangleCount; t++) {
      radiance.push(color.r * 0.02, color.g * 0.02, color.b * 0.02, 1);
      surface.push(color.r, color.g, color.b, 0.72);
    }
  });
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleRadiance: new Float32Array(radiance),
    triangleSurface: new Float32Array(surface),
    triangleCount: indices.length / 3,
    vertexCount: positions.length / 3,
  };
}

export async function loadAnimeTextureShader() {
  const response = await fetch(ANIME_SHADER_URL);
  if (!response.ok) throw new Error(`Failed to load anime_texture.comp (${response.status})`);
  return response.text();
}

export class AnimeTextureRenderer {
  constructor(renderer, camera, rtx) {
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;
    this.enabled = false;
    this.active = true;
    this.sceneRegistered = false;
    this.pipeline = null;
    this.failure = "";
    this.width = 0;
    this.height = 0;
    this.frameIndex = 0;
    this.target = null;
    this._color = null;
    this._depth = null;
    this._displayScene = new THREE.Scene();
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const displayGeometry = new THREE.PlaneGeometry(2, 2);
    const uv = displayGeometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this._displayQuad = new THREE.Mesh(
      displayGeometry,
      new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this._displayScene.add(this._displayQuad);
    this._inverseViewProjection = new THREE.Matrix4();
    this._cameraPosition = [0, 0, 0];
    this._lightDirection = new THREE.Vector3(-0.55, 0.76, 0.35).normalize();
  }

  async setup(scene, width, height) {
    this.failure = "";
    if (!this.rtx || typeof this.rtx.compileRayQueryPipeline !== "function") {
      this.failure = "The native ray-query bridge is unavailable.";
      return false;
    }
    try {
      const source = await loadAnimeTextureShader();
      this.pipeline = await this.rtx.compileRayQueryPipeline({
        profile: "lighting-v1",
        source,
        language: "glsl",
        stage: "compute",
        entryPoint: "main",
        label: "Anime texture stylization of reconstructed 3D objects",
      });
      if (!this.pipeline) throw new Error("The runtime returned no anime lighting pipeline.");

      const staticScene = collectOpaqueTriangles(scene);
      if (staticScene.triangleCount < 8) throw new Error("No opaque triangles to stylize.");
      const registration = this.rtx.registerStaticScene({
        positions: staticScene.positions,
        indices: staticScene.indices,
        triangleRadiance: staticScene.triangleRadiance,
        triangleSurface: staticScene.triangleSurface,
      });
      if (!registration?.queued) throw new Error("Static grove registration was not queued.");
      const ready = await waitForStaticScene(this.rtx);
      if (!ready.ready) {
        throw new Error(ready.feature?.reason || "The anime BLAS/TLAS did not become ready.");
      }
      this.sceneRegistered = true;
      this._createTarget(positiveInteger(width), positiveInteger(height));
      this.enabled = true;
      this.frameIndex = 0;
      console.log(
        `[Anime texture] lighting-v1 ready · ${staticScene.triangleCount.toLocaleString()} triangles`,
      );
      return true;
    } catch (error) {
      this.failure = error?.message || String(error);
      console.warn(`[Anime texture] ${this.failure}`);
      this.dispose();
      return false;
    }
  }

  resize(width, height) {
    if (!this.enabled) return;
    const nextWidth = positiveInteger(width);
    const nextHeight = positiveInteger(height);
    if (nextWidth === this.width && nextHeight === this.height) return;
    this._createTarget(nextWidth, nextHeight);
  }

  _createTarget(width, height) {
    this._disposeTarget();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = "Anime texture depth";
    depthTexture.format = THREE.DepthFormat;
    const target = new THREE.RenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
      generateMipmaps: false,
    });
    target.texture.name = "Anime texture HDR";
    target.texture.isStorageTexture = true;
    target.texture.generateMipmaps = false;
    this.renderer.initRenderTarget(target);
    const color = this.renderer.backend.get(target.texture).texture;
    const depth = this.renderer.backend.get(target.depthTexture).texture;
    if (!color || !depth) {
      target.dispose();
      throw new Error("Three.js did not expose anime HDR/depth textures.");
    }
    requireUsage(color, 0x08, "Anime HDR storage");
    requireUsage(depth, 0x04, "Anime depth");
    this.target = target;
    this._color = color;
    this._depth = depth;
    this.width = width;
    this.height = height;
    this._displayQuad.material.map = target.texture;
    this._displayQuad.material.needsUpdate = true;
  }

  _disposeTarget() {
    this.target?.dispose();
    this.target = null;
    this._color = null;
    this._depth = null;
  }

  render(scene, camera) {
    if (!this.enabled || !this.active || !this.pipeline) return false;
    const width = positiveInteger(this.renderer.domElement.width || innerWidth);
    const height = positiveInteger(this.renderer.domElement.height || innerHeight);
    this.resize(width, height);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this._inverseViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._inverseViewProjection.invert();
    this._cameraPosition = camera.position.toArray();

    const previousToneMapping = this.renderer.toneMapping;
    const previousExposure = this.renderer.toneMappingExposure;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = previousToneMapping;
    this.renderer.toneMappingExposure = previousExposure;

    try {
      const layouts = this.rtx.vulkanImageLayouts ?? {};
      const encoder = this.device.createCommandEncoder({ label: "Anime texture stylize" });
      this.rtx.evaluateRayLighting({
        pipeline: this.pipeline,
        commandEncoder: encoder,
        color: makeResource(this._color, layouts.colorAttachment ?? "general", this.width, this.height),
        depth: makeResource(this._depth, layouts.depthStencilAttachment ?? "depthStencilAttachment", this.width, this.height),
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection.toArray(),
        cameraPosition: this._cameraPosition,
        directionalLightDirection: this._lightDirection.toArray(),
        directionalLightIntensity: 1,
        directionalAngularRadius: 0.012,
        directionalSampleCount: 1,
        aoSampleCount: 1,
        maxDistance: 48,
        rayBias: 0.012,
        frameIndex: this.frameIndex,
        shadowStrength: 1,
        aoStrength: 0,
        aoRadius: 0.4,
        depthInverted: false,
      });
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      this.active = false;
      this.failure = error?.message || String(error);
      console.warn(`[Anime texture] disabled: ${this.failure}`);
      this.renderer.setRenderTarget(null);
      return false;
    }

    this.renderer.setRenderTarget(null);
    this.renderer.render(this._displayScene, this._displayCamera);
    this.frameIndex += 1;
    return true;
  }

  dispose() {
    this._disposeTarget();
    if (this.sceneRegistered) {
      try {
        this.rtx?.destroyStaticScene?.();
      } catch {
      }
      this.sceneRegistered = false;
    }
    try {
      this.pipeline?.destroy?.();
    } catch {
    }
    this.pipeline = null;
    this.enabled = false;
  }
}
