import * as THREE from "three/webgpu";
import { mrt, output, velocity } from "three/tsl";

const VIEWPORT = 0;
// RTX 5080 has ample headroom for a compact sample, so DLAA preserves the
// high-frequency procedural sand, vegetation and caustic detail instead of
// reconstructing them from a 480p input. Frame Generation remains available.
const DEFAULT_MODE = "dlaa";

function rowMajor(matrix) {
  return matrix.clone().transpose().toArray();
}

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function makeResource(texture, layout, width, height) {
  return { texture, vulkanLayout: layout, left: 0, top: 0, width, height };
}

function requireUsage(texture, flag, label) {
  if ((Number(texture?.usage ?? 0) & flag) !== flag) {
    throw new Error(`${label} is missing required GPUTextureUsage 0x${flag.toString(16)}.`);
  }
}

/**
 * A deliberately small adapter between Three.js' WebGPU MRT path and the
 * native ThreeBrowser DLSS bridge. It owns no alternate rendering algorithm:
 * when native DLSS cannot be configured, render() returns false so the caller
 * can use the ordinary full-resolution Three.js path.
 */
export class NativeDlssSuperResolution {
  constructor(renderer, camera, rtx) {
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;

    this.sceneTarget = null;
    this.outputTarget = null;
    this.hudlessTarget = null;
    this.renderWidth = 0;
    this.renderHeight = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this.optimalSettings = null;
    this.enabled = false;
    this.frameGenerationEnabled = false;
    this.frameGenerationWarmupFrames = 0;
    this.rayLighting = null;
    this.rayLightingFailure = "";
    this.rayLightingFrameIndex = 0;
    this.resetHistory = true;
    this.failure = "";

    this._mrt = mrt({ output, velocity });
    this._displayScene = new THREE.Scene();
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._displayGeometry = new THREE.PlaneGeometry(2, 2);
    // Three's render-target sampling convention accounts for the orientation of
    // images written by its own WebGPU render passes. Streamline writes the
    // upscaled Vulkan image directly, so presenting that texture through a
    // Three RenderTarget needs the inverse V coordinate exactly once.
    const displayUvs = this._displayGeometry.getAttribute("uv");
    for (let index = 0; index < displayUvs.count; ++index) {
      displayUvs.setY(index, 1 - displayUvs.getY(index));
    }
    displayUvs.needsUpdate = true;
    this._displayMaterial = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._displayMesh = new THREE.Mesh(this._displayGeometry, this._displayMaterial);
    this._displayMesh.frustumCulled = false;
    this._displayScene.add(this._displayMesh);
    this._presentScene = new THREE.Scene();
    this._presentMaterial = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._presentMesh = new THREE.Mesh(this._displayGeometry, this._presentMaterial);
    this._presentMesh.frustumCulled = false;
    this._presentScene.add(this._presentMesh);

    this._currentViewProjection = new THREE.Matrix4();
    this._previousViewProjection = new THREE.Matrix4();
    this._inverseCurrentViewProjection = new THREE.Matrix4();
    this._clipToPreviousClip = new THREE.Matrix4();
    this._previousClipToClip = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();
    this._cameraUp = new THREE.Vector3();
    this._cameraRight = new THREE.Vector3();
    this._cameraForward = new THREE.Vector3();
    this._identity = new THREE.Matrix4();
  }

  configureRayLighting(options = null) {
    this.rayLighting = options ? { ...options, enabled: options.enabled !== false } : null;
    this.rayLightingFailure = "";
    this.rayLightingFrameIndex = 0;
    return Boolean(this.rayLighting?.enabled);
  }

  configure(outputWidth, outputHeight) {
    this.enabled = false;
    this.frameGenerationEnabled = false;
    this.frameGenerationWarmupFrames = 0;
    this.failure = "";

    if (!this.rtx?.capabilities?.dlssSuperResolution ||
        typeof this.rtx.getOptimalSettings !== "function" ||
        typeof this.rtx.evaluateSuperResolution !== "function" ||
        !this.device) {
      this.failure = "Native DLSS Super Resolution is not available on this adapter/runtime.";
      return false;
    }

    const width = positiveInteger(outputWidth, 1);
    const height = positiveInteger(outputHeight, 1);
    const options = {
      mode: DEFAULT_MODE,
      outputWidth: width,
      outputHeight: height,
      preExposure: 1,
      exposureScale: 1,
      colorBuffersHDR: true,
      autoExposure: false,
      alphaUpscaling: false,
    };

    let settings;
    try {
      settings = this.rtx.getOptimalSettings(options);
    } catch (error) {
      this.failure = `DLSS optimal-settings query failed: ${error?.message || error}`;
      console.warn(`[DLSS] ${this.failure}`);
      return false;
    }
    if (!settings) {
      this.failure = "DLSS did not return optimal render dimensions for this output size.";
      return false;
    }

    const renderWidth = positiveInteger(settings.optimalRenderWidth, 0);
    const renderHeight = positiveInteger(settings.optimalRenderHeight, 0);
    if (!renderWidth || !renderHeight) {
      this.failure = "DLSS returned invalid optimal render dimensions.";
      return false;
    }

    try {
      this.rtx.releaseViewport?.(VIEWPORT);
      const frameGenerationAvailable = Boolean(
        this.rtx.capabilities?.dlssFrameGeneration &&
        typeof this.rtx.tagFrameGeneration === "function",
      );
      this.rtx.requestFeatures({
        dlssSuperResolution: options,
        // The sample owns a persistent full-resolution post-tonemapped RGBA8
        // image, dense motion vectors and native depth through Present. No UI
        // resource is needed because the final image has no HUD.
        dlssFrameGeneration: frameGenerationAvailable,
        dlssRayReconstruction: false,
      });
      this._createTargets(renderWidth, renderHeight, width, height);
    } catch (error) {
      this.failure = `DLSS target/configuration setup failed: ${error?.message || error}`;
      console.error(`[DLSS] ${this.failure}`);
      this._disposeTargets();
      return false;
    }

    const state = this.rtx.getStatus?.().features?.dlssSuperResolution;
    if (!state?.configured) {
      this.failure = state?.reason || "The native runtime did not accept the DLSS configuration.";
      this._disposeTargets();
      return false;
    }

    this.optimalSettings = settings;
    this.enabled = true;
    this.frameGenerationEnabled = Boolean(
      this.rtx.getStatus?.().features?.dlssFrameGeneration?.requested,
    );
    // A resize updates Three's output targets immediately, while the native
    // swapchain and Streamline's present hook settle asynchronously over the
    // next few Presents. Keep Frame Generation requested, but allow a short
    // run of ordinary Presents before tagging the rebuilt full-size inputs.
    // Six frames is at most 100 ms at the runtime's minimum supported refresh.
    this.frameGenerationWarmupFrames = this.frameGenerationEnabled ? 6 : 0;
    this.resetHistory = true;
    console.log(
      `[DLSS] DLAA configured: ${renderWidth}×${renderHeight} → ${width}×${height}` +
      ` · optimalSharpness=${Number(settings.optimalSharpness ?? 0).toFixed(3)}`,
    );
    return true;
  }

  resize(outputWidth, outputHeight) {
    const width = positiveInteger(outputWidth, 1);
    const height = positiveInteger(outputHeight, 1);
    if (width === this.outputWidth && height === this.outputHeight) return this.enabled;
    return this.configure(width, height);
  }

  _createTargets(renderWidth, renderHeight, outputWidth, outputHeight) {
    this._disposeTargets();

    const depthTexture = new THREE.DepthTexture(renderWidth, renderHeight, THREE.FloatType);
    depthTexture.name = "DLSS depth";
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;

    const sceneTarget = new THREE.RenderTarget(renderWidth, renderHeight, {
      count: 2,
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
    sceneTarget.textures[0].colorSpace = THREE.NoColorSpace;
    // Native ray-query lighting writes the linear HDR result in place before
    // Streamline consumes it. This marker adds STORAGE_BINDING without taking
    // away Three's render-attachment and sampled usages.
    sceneTarget.textures[0].isStorageTexture = true;
    sceneTarget.textures[0].mipmapsAutoUpdate = false;
    sceneTarget.textures[1].name = "velocity";
    sceneTarget.textures[1].format = THREE.RGFormat;
    sceneTarget.textures[1].type = THREE.HalfFloatType;
    sceneTarget.textures[1].colorSpace = THREE.NoColorSpace;

    const outputTarget = new THREE.RenderTarget(outputWidth, outputHeight, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    outputTarget.texture.name = "DLSS upscaled output";
    outputTarget.texture.colorSpace = THREE.NoColorSpace;
    // WebGPUTextureUtils turns this marker into STORAGE_BINDING while retaining
    // the render-target, sampled, and copy usages required by the pipeline.
    outputTarget.texture.isStorageTexture = true;
    outputTarget.texture.mipmapsAutoUpdate = false;

    // Streamline DLSS-G cannot consume the FP16 pre-output-transform DLSS
    // result. Three's public output-target path applies the exact renderer tone
    // mapping and output-color conversion into this persistent RGBA8 image.
    // The image is then tagged and sampled unchanged by the final swapchain
    // pass, so the tagged HUD-less color is the image that is presented.
    const hudlessTarget = new THREE.RenderTarget(outputWidth, outputHeight, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    hudlessTarget.texture.name = "DLSS-G post-tonemapped HUD-less color";
    hudlessTarget.texture.colorSpace = THREE.NoColorSpace;
    hudlessTarget.texture.mipmapsAutoUpdate = false;

    this.renderer.initRenderTarget(sceneTarget);
    this.renderer.initRenderTarget(outputTarget);
    this.renderer.initRenderTarget(hudlessTarget);

    const colorInput = this.renderer.backend.get(sceneTarget.textures[0]).texture;
    const motionVectors = this.renderer.backend.get(sceneTarget.textures[1]).texture;
    const depth = this.renderer.backend.get(sceneTarget.depthTexture).texture;
    const colorOutput = this.renderer.backend.get(outputTarget.texture).texture;
    const hudlessColor = this.renderer.backend.get(hudlessTarget.texture).texture;
    if (!colorInput || !motionVectors || !depth || !colorOutput || !hudlessColor) {
      sceneTarget.dispose();
      outputTarget.dispose();
      hudlessTarget.dispose();
      throw new Error("Three.js did not expose the native GPU textures for the DLSS targets.");
    }
    // Mirror the native validation at the JS/Three boundary so an accidental
    // RenderTarget option regression fails during setup, not deep in Streamline.
    requireUsage(colorInput, 0x04, "DLSS color input"); // TEXTURE_BINDING
    requireUsage(colorInput, 0x08, "RTX lighting color input"); // STORAGE_BINDING
    requireUsage(motionVectors, 0x04, "DLSS motion vectors");
    requireUsage(depth, 0x04, "DLSS depth");
    requireUsage(colorOutput, 0x08, "DLSS color output"); // STORAGE_BINDING
    requireUsage(hudlessColor, 0x04, "DLSS-G HUD-less color"); // TEXTURE_BINDING
    requireUsage(hudlessColor, 0x10, "DLSS-G HUD-less color"); // RENDER_ATTACHMENT

    this.sceneTarget = sceneTarget;
    this.outputTarget = outputTarget;
    this.hudlessTarget = hudlessTarget;
    this.renderWidth = renderWidth;
    this.renderHeight = renderHeight;
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    this._colorInput = colorInput;
    this._motionVectors = motionVectors;
    this._depth = depth;
    this._colorOutput = colorOutput;
    this._colorOutputView = colorOutput.createView();
    this._displayMaterial.map = outputTarget.texture;
    this._displayMaterial.needsUpdate = true;
    this._hudlessColor = hudlessColor;
    this._presentMaterial.map = hudlessTarget.texture;
    this._presentMaterial.needsUpdate = true;
  }

  _frameConstants(camera) {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this._currentViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._inverseCurrentViewProjection.copy(this._currentViewProjection).invert();

    if (this.resetHistory) this._previousViewProjection.copy(this._currentViewProjection);
    this._clipToPreviousClip
      .copy(this._previousViewProjection)
      .multiply(this._inverseCurrentViewProjection);
    this._previousClipToClip
      .copy(this._currentViewProjection)
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
      // Three's velocity node emits currentNDC - previousNDC. DLSS expects
      // normalized UV motion, including the NDC-to-texture Y inversion.
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

  render(scene, camera = this.camera, frameOptions = {}) {
    if (!this.enabled || !this.sceneTarget || !this.outputTarget) return false;

    try {
      // Pass 1: Three.js writes HDR color, native depth and TSL velocity at the
      // optimal low resolution. No sampling occurs before native evaluation,
      // so these images remain in their attachment layouts.
      this.renderer.setMRT(this._mrt);
      this.renderer.setRenderTarget(this.sceneTarget);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);

      const layouts = this.rtx.vulkanImageLayouts;
      const constants = this._frameConstants(camera);

      // Pass 2: run the native ray-query lighting stage against the same HDR
      // color and depth images DLSS receives. The bridge restores both Vulkan
      // layouts before returning, so no hidden copy or second renderer exists.
      if (this.rayLighting?.enabled && typeof this.rtx.evaluateRayLighting === "function") {
        try {
          const rayEncoder = this.device.createCommandEncoder({
            label: "RTX directional visibility and ambient occlusion",
          });
          this.rtx.evaluateRayLighting({
            commandEncoder: rayEncoder,
            color: makeResource(
              this._colorInput,
              layouts.colorAttachment,
              this.renderWidth,
              this.renderHeight,
            ),
            depth: makeResource(
              this._depth,
              layouts.depthStencilAttachment,
              this.renderWidth,
              this.renderHeight,
            ),
            width: this.renderWidth,
            height: this.renderHeight,
            inverseViewProjection: this._inverseCurrentViewProjection.toArray(),
            cameraPosition: this._cameraPosition,
            directionalLightDirection: this.rayLighting.directionalLightDirection,
            directionalLightIntensity: this.rayLighting.directionalLightIntensity,
            directionalAngularRadius: this.rayLighting.directionalAngularRadius,
            directionalSampleCount: this.rayLighting.directionalSampleCount,
            aoSampleCount: this.rayLighting.aoSampleCount,
            maxDistance: this.rayLighting.maxDistance,
            rayBias: this.rayLighting.rayBias,
            frameIndex: this.rayLightingFrameIndex,
            shadowStrength: this.rayLighting.shadowStrength ?? 0.62,
            aoStrength: this.rayLighting.aoStrength ?? 0.20,
            aoRadius: this.rayLighting.aoRadius ?? 0.82,
            depthInverted: false,
          });
          this.device.queue.submit([rayEncoder.finish()]);
          this.rayLightingFrameIndex += 1;
        } catch (error) {
          this.rayLighting.enabled = false;
          this.rayLightingFailure = String(error?.message || error);
          console.error(`[RTX lighting] Native evaluation stopped: ${this.rayLightingFailure}`);
        }
      }

      // Pass 3: transition/clear the storage-capable output with an ordinary
      // WebGPU encoder. wgpu-native deliberately forbids mixing its encoding
      // API with a raw Vulkan callback in one encoder, so Streamline evaluation
      // is recorded on the separate raw-only encoder below.
      const transitionEncoder = this.device.createCommandEncoder({
        label: "DLSS output transition",
      });
      const clearPass = transitionEncoder.beginRenderPass({
        label: "DLSS output transition/clear",
        colorAttachments: [{
          view: this._colorOutputView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      clearPass.end();
      this.device.queue.submit([transitionEncoder.finish()]);

      const encoder = this.device.createCommandEncoder({ label: "DLSS Super Resolution" });
      this.rtx.evaluateSuperResolution({
        commandEncoder: encoder,
        viewport: VIEWPORT,
        colorInput: makeResource(
          this._colorInput,
          layouts.colorAttachment,
          this.renderWidth,
          this.renderHeight,
        ),
        colorOutput: makeResource(
          this._colorOutput,
          layouts.colorAttachment,
          this.outputWidth,
          this.outputHeight,
        ),
        depth: makeResource(
          this._depth,
          layouts.depthStencilAttachment,
          this.renderWidth,
          this.renderHeight,
        ),
        motionVectors: makeResource(
          this._motionVectors,
          layouts.colorAttachment,
          this.renderWidth,
          this.renderHeight,
        ),
        constants,
      });
      this.device.queue.submit([encoder.finish()]);

      // Pass 4: use Three's stock output-target path to apply exactly the same
      // tone mapping and output-color conversion that its screen path uses,
      // but write the result into persistent full-resolution RGBA8 storage.
      const previousRenderTarget = this.renderer.getRenderTarget();
      const previousOutputTarget = this.renderer.getOutputRenderTarget();
      this.renderer.setRenderTarget(null);
      this.renderer.setOutputRenderTarget(this.hudlessTarget);
      try {
        this.renderer.render(this._displayScene, this._displayCamera);
      } finally {
        this.renderer.setOutputRenderTarget(previousOutputTarget);
        this.renderer.setRenderTarget(previousRenderTarget);
      }

      // Pass 5: tag on a dedicated raw-only encoder after the ordinary HUD-less
      // render submit. The immutable layout is the layout at Present: the final
      // pass below samples this image and leaves it shader-readable. Depth and
      // velocity remain in their attachment layouts and all resources persist
      // until resize/dispose, satisfying Vulkan's explicit lifetime contract.
      if (this.frameGenerationEnabled && this.frameGenerationWarmupFrames > 0) {
        this.frameGenerationWarmupFrames -= 1;
      } else if (this.frameGenerationEnabled) {
        try {
          const frameGenerationEncoder = this.device.createCommandEncoder({
            label: "DLSS Frame Generation inputs",
          });
          this.rtx.tagFrameGeneration({
            commandEncoder: frameGenerationEncoder,
            viewport: VIEWPORT,
            hudlessColor: makeResource(
              this._hudlessColor,
              layouts.shaderReadOnly,
              this.outputWidth,
              this.outputHeight,
            ),
            depth: makeResource(
              this._depth,
              layouts.depthStencilAttachment,
              this.renderWidth,
              this.renderHeight,
            ),
            motionVectors: makeResource(
              this._motionVectors,
              layouts.colorAttachment,
              this.renderWidth,
              this.renderHeight,
            ),
            framesToGenerate: 1,
            constants,
          });
          this.device.queue.submit([frameGenerationEncoder.finish()]);
        } catch (error) {
          const message = String(error?.message || error);
          this.frameGenerationEnabled = false;
          console.warn(`[DLSS-G] Native tagging stopped: ${message}`);
          this.rtx.requestFeatures?.({ dlssFrameGeneration: false });
        }
      }

      // Pass 6: copy the same post-tonemapped RGBA8 image to the swapchain.
      // No second tone/color transform is allowed: NoToneMapping plus the
      // working color space makes this a raw encoded-byte presentation copy.
      const previousToneMapping = this.renderer.toneMapping;
      const previousOutputColorSpace = this.renderer.outputColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setRenderTarget(null);
      this.renderer.setOutputRenderTarget(null);
      try {
        this.renderer.render(this._presentScene, this._displayCamera);
      } finally {
        this.renderer.toneMapping = previousToneMapping;
        this.renderer.outputColorSpace = previousOutputColorSpace;
      }

      this._previousViewProjection.copy(this._currentViewProjection);
      this.resetHistory = false;
      return true;
    } catch (error) {
      this.enabled = false;
      this.failure = `Native DLSS evaluation stopped: ${error?.message || error}`;
      console.error(`[DLSS] ${this.failure}`);
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT(null);
      return false;
    }
  }

  _disposeTargets() {
    this.sceneTarget?.dispose();
    this.outputTarget?.dispose();
    this.hudlessTarget?.dispose();
    this.sceneTarget = null;
    this.outputTarget = null;
    this.hudlessTarget = null;
    this._colorInput = null;
    this._motionVectors = null;
    this._depth = null;
    this._colorOutput = null;
    this._colorOutputView = null;
    this._hudlessColor = null;
    this.renderWidth = 0;
    this.renderHeight = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this._displayMaterial.map = null;
    this._presentMaterial.map = null;
  }

  dispose() {
    this.enabled = false;
    this.frameGenerationEnabled = false;
    this.frameGenerationWarmupFrames = 0;
    this.rayLighting = null;
    this.rayLightingFrameIndex = 0;
    this.rtx?.releaseViewport?.(VIEWPORT);
    this._disposeTargets();
    this._displayGeometry.dispose();
    this._displayMaterial.dispose();
    this._presentMaterial.dispose();
  }
}
