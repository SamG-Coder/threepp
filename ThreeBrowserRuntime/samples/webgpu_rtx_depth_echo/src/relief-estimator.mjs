// Project-owned, deterministic image heuristic. This module performs no
// learned inference: it turns luma, local contrast, saturation, Sobel edges,
// and a broad center prior into a temporally smoothed non-metric relief.
// positionsTexture.xyz are world positions; positionsTexture.w is a bounded
// non-semantic foreground confidence for downstream cell rejection.
export const RELIEF_LABEL = "HEURISTIC LUMA+EDGE RELIEF / NON-NEURAL / NON-METRIC";
export const RELIEF_WIDTH = 224;
export const RELIEF_HEIGHT = 224;

const WORLD_EXTENT = 6.4;
const WORLD_DEPTH_BASE = -0.20;
const WORLD_DEPTH_SCALE = 1.55;
const WORKGROUP_SIZE = 8;

const TEXTURE_USAGE = globalThis.GPUTextureUsage ?? {
  COPY_SRC: 0x01,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
};
const BUFFER_USAGE = globalThis.GPUBufferUsage ?? {
  COPY_DST: 0x08,
  UNIFORM: 0x40,
};
const SHADER_STAGE = globalThis.GPUShaderStage ?? { COMPUTE: 0x04 };

const RELIEF_WGSL = /* wgsl */ `
struct ReliefParams {
  outputSize: vec2<u32>,
  resetHistory: u32,
  mirrorX: u32,
  time: f32,
  historyBlend: f32,
  edgeStrength: f32,
  padding: f32,
};

@group(0) @binding(0) var sourceFrame: texture_external;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var previousDepth: texture_2d<f32>;
@group(0) @binding(3) var nextDepth: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var positions: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var<uniform> params: ReliefParams;

fn sampleRgb(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleBaseClampToEdge(sourceFrame, sourceSampler, uv).rgb;
}

fn luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputSize.x || gid.y >= params.outputSize.y) {
    return;
  }

  let maximumPixel = vec2<f32>(params.outputSize - vec2<u32>(1u));
  let gridUv = vec2<f32>(gid.xy) / maximumPixel;
  let registeredU = select(gridUv.x, 1.0 - gridUv.x, params.mirrorX != 0u);
  let uv = vec2<f32>(registeredU, gridUv.y);
  let texel = 1.0 / maximumPixel;

  let centerRgb = sampleRgb(uv);
  let center = luma(centerRgb);
  let left = luma(sampleRgb(uv + vec2<f32>(-texel.x, 0.0)));
  let right = luma(sampleRgb(uv + vec2<f32>(texel.x, 0.0)));
  let top = luma(sampleRgb(uv + vec2<f32>(0.0, -texel.y)));
  let bottom = luma(sampleRgb(uv + vec2<f32>(0.0, texel.y)));
  let topLeft = luma(sampleRgb(uv + vec2<f32>(-texel.x, -texel.y)));
  let topRight = luma(sampleRgb(uv + vec2<f32>(texel.x, -texel.y)));
  let bottomLeft = luma(sampleRgb(uv + vec2<f32>(-texel.x, texel.y)));
  let bottomRight = luma(sampleRgb(uv + vec2<f32>(texel.x, texel.y)));

  let sobelX = (topRight + 2.0 * right + bottomRight) -
    (topLeft + 2.0 * left + bottomLeft);
  let sobelY = (bottomLeft + 2.0 * bottom + bottomRight) -
    (topLeft + 2.0 * top + topRight);
  let edge = clamp(length(vec2<f32>(sobelX, sobelY)) * 0.34 * params.edgeStrength, 0.0, 1.0);
  let localMean = (left + right + top + bottom) * 0.25;
  let localContrast = clamp(abs(center - localMean) * 4.0, 0.0, 1.0);
  let maximumChannel = max(max(centerRgb.r, centerRgb.g), centerRgb.b);
  let minimumChannel = min(min(centerRgb.r, centerRgb.g), centerRgb.b);
  let saturation = maximumChannel - minimumChannel;

  // A broad center prior makes the relief legible for portraits without
  // pretending to recover metric or semantic depth.
  let centered = (gridUv - vec2<f32>(0.5)) * vec2<f32>(1.0, 0.82);
  let centerPrior = 1.0 - smoothstep(0.22, 0.68, length(centered));
  // Non-semantic foreground confidence for downstream cell rejection. It is
  // deliberately heuristic: w is neither validity nor metric depth.
  let foregroundConfidence = clamp(
    centerPrior * 0.52 +
    saturation * 0.18 +
    localContrast * 0.18 +
    edge * 0.34,
    0.0,
    1.0
  );
  let pseudoDepth = clamp(
    0.10 +
    (1.0 - center) * 0.24 +
    saturation * 0.16 +
    localContrast * 0.24 +
    edge * 0.36 +
    centerPrior * 0.25,
    0.0,
    1.0
  );

  let previous = textureLoad(previousDepth, vec2<i32>(gid.xy), 0).x;
  let difference = abs(pseudoDepth - previous);
  let motionResponse = smoothstep(0.018, 0.16, difference);
  let baseResponse = 1.0 - params.historyBlend;
  let response = clamp(max(baseResponse, max(motionResponse * 0.76, edge * 0.62)), 0.04, 1.0);
  var smoothed = mix(previous, pseudoDepth, response);
  if (params.resetHistory != 0u) {
    smoothed = pseudoDepth;
  }

  textureStore(nextDepth, vec2<i32>(gid.xy), vec4<f32>(smoothed, 0.0, 0.0, 1.0));
  let worldX = (registeredU - 0.5) * ${WORLD_EXTENT.toFixed(1)};
  let worldY = (0.5 - gridUv.y) * ${WORLD_EXTENT.toFixed(1)};
  let worldZ = ${WORLD_DEPTH_BASE.toFixed(2)} + smoothed * ${WORLD_DEPTH_SCALE.toFixed(2)};
  textureStore(
    positions,
    vec2<i32>(gid.xy),
    vec4<f32>(worldX, worldY, worldZ, foregroundConfidence)
  );
}
`;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function sourceMarker(source) {
  for (const key of ["sequence", "timestampUs", "timestamp"]) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return `${key}:${value}`;
  }
  const currentTime = Number(source?.currentTime);
  return Number.isFinite(currentTime) ? `currentTime:${currentTime}` : null;
}

function writeParams(device, buffer, values) {
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  view.setUint32(0, RELIEF_WIDTH, true);
  view.setUint32(4, RELIEF_HEIGHT, true);
  view.setUint32(8, values.resetHistory ? 1 : 0, true);
  view.setUint32(12, values.mirrorX ? 1 : 0, true);
  view.setFloat32(16, Number(values.time) || 0, true);
  view.setFloat32(20, values.historyBlend, true);
  view.setFloat32(24, values.edgeStrength, true);
  view.setFloat32(28, 0, true);
  device.queue.writeBuffer(buffer, 0, bytes);
}

export class HeuristicReliefEstimator {
  #device;
  #historyBlend;
  #edgeStrength;
  #positionsTexture;
  #positionView;
  #historyTextures = [];
  #historyViews = [];
  #historyIndex = 0;
  #paramsBuffer;
  #sampler;
  #bindGroupLayout;
  #pipeline;
  #initialized = false;
  #disposed = false;
  #resetHistory = true;
  #frameIndex = 0;
  #lastMarker = null;
  #lastSource = null;
  #lastMirrorX = false;
  #lastResult = null;

  constructor({ device, historyBlend = 0.82, edgeStrength = 1 } = {}) {
    if (!device?.createTexture || !device?.createComputePipeline) {
      throw new TypeError("Heuristic relief requires an existing WebGPU GPUDevice.");
    }
    this.#device = device;
    this.#historyBlend = clamp(historyBlend, 0, 0.98);
    this.#edgeStrength = clamp(edgeStrength, 0, 2);
  }

  get label() {
    return RELIEF_LABEL;
  }

  get kind() {
    return "heuristic-non-neural";
  }

  get width() {
    return RELIEF_WIDTH;
  }

  get height() {
    return RELIEF_HEIGHT;
  }

  get positionsTexture() {
    return this.#positionsTexture ?? null;
  }

  async init() {
    if (this.#disposed) throw new Error("Heuristic relief estimator is disposed.");
    if (this.#initialized) return this;

    this.#positionsTexture = this.#device.createTexture({
      label: `${RELIEF_LABEL} / WORLD POSITIONS`,
      size: { width: RELIEF_WIDTH, height: RELIEF_HEIGHT, depthOrArrayLayers: 1 },
      format: "rgba32float",
      usage: TEXTURE_USAGE.COPY_SRC | TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.STORAGE_BINDING,
    });
    this.#positionView = this.#positionsTexture.createView();
    for (let index = 0; index < 2; ++index) {
      const texture = this.#device.createTexture({
        label: `${RELIEF_LABEL} / TEMPORAL DEPTH ${index}`,
        size: { width: RELIEF_WIDTH, height: RELIEF_HEIGHT, depthOrArrayLayers: 1 },
        format: "r32float",
        usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.STORAGE_BINDING,
      });
      this.#historyTextures.push(texture);
      this.#historyViews.push(texture.createView());
    }
    this.#paramsBuffer = this.#device.createBuffer({
      label: `${RELIEF_LABEL} / PARAMETERS`,
      size: 32,
      usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
    });
    this.#sampler = this.#device.createSampler({
      label: `${RELIEF_LABEL} / CAMERA SAMPLER`,
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });
    this.#bindGroupLayout = this.#device.createBindGroupLayout({
      label: `${RELIEF_LABEL} / BINDINGS`,
      entries: [
        { binding: 0, visibility: SHADER_STAGE.COMPUTE, externalTexture: {} },
        { binding: 1, visibility: SHADER_STAGE.COMPUTE, sampler: { type: "filtering" } },
        { binding: 2, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: "write-only", format: "r32float" } },
        { binding: 4, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
        { binding: 5, visibility: SHADER_STAGE.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const descriptor = {
      label: RELIEF_LABEL,
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.#bindGroupLayout] }),
      compute: {
        module: this.#device.createShaderModule({ label: `${RELIEF_LABEL} / WGSL`, code: RELIEF_WGSL }),
        entryPoint: "main",
      },
    };
    this.#pipeline = this.#device.createComputePipelineAsync
      ? await this.#device.createComputePipelineAsync(descriptor)
      : this.#device.createComputePipeline(descriptor);
    this.#initialized = true;
    return this;
  }

  reset() {
    if (this.#disposed) return;
    this.#resetHistory = true;
    this.#lastMarker = null;
  }

  async update({ source, mirrorX = false, time = 0, force = false } = {}) {
    if (this.#disposed) throw new Error("Heuristic relief estimator is disposed.");
    if (!this.#initialized) throw new Error("Call reliefEstimator.init() before update().");
    if (!source || (typeof source !== "object" && typeof source !== "function")) {
      throw new TypeError("Relief update requires an HTMLVideoElement or deterministic RGBA source.");
    }

    const sourceChanged = source !== this.#lastSource;
    const mirrorChanged = Boolean(mirrorX) !== this.#lastMirrorX;
    if (sourceChanged || mirrorChanged) this.#resetHistory = true;
    const externalFrame = this.#device.importExternalTexture({ source });
    const marker = sourceMarker(source);
    if (!force && !sourceChanged && !mirrorChanged && marker !== null && marker === this.#lastMarker && this.#lastResult) {
      return { ...this.#lastResult, fresh: false, encodeSubmitMs: 0 };
    }

    writeParams(this.#device, this.#paramsBuffer, {
      resetHistory: this.#resetHistory,
      mirrorX: Boolean(mirrorX),
      time,
      historyBlend: this.#historyBlend,
      edgeStrength: this.#edgeStrength,
    });
    const previousIndex = this.#historyIndex;
    const nextIndex = 1 - previousIndex;
    const bindGroup = this.#device.createBindGroup({
      label: `${RELIEF_LABEL} / FRAME ${this.#frameIndex}`,
      layout: this.#bindGroupLayout,
      entries: [
        { binding: 0, resource: externalFrame },
        { binding: 1, resource: this.#sampler },
        { binding: 2, resource: this.#historyViews[previousIndex] },
        { binding: 3, resource: this.#historyViews[nextIndex] },
        { binding: 4, resource: this.#positionView },
        { binding: 5, resource: { buffer: this.#paramsBuffer } },
      ],
    });

    const started = nowMilliseconds();
    const encoder = this.#device.createCommandEncoder({ label: `${RELIEF_LABEL} / ENCODER` });
    const pass = encoder.beginComputePass({ label: RELIEF_LABEL });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(RELIEF_WIDTH / WORKGROUP_SIZE),
      Math.ceil(RELIEF_HEIGHT / WORKGROUP_SIZE),
      1,
    );
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
    const encodeSubmitMs = nowMilliseconds() - started;

    this.#historyIndex = nextIndex;
    this.#resetHistory = false;
    this.#frameIndex += 1;
    this.#lastMarker = marker;
    this.#lastSource = source;
    this.#lastMirrorX = Boolean(mirrorX);
    this.#lastResult = {
      positionsTexture: this.#positionsTexture,
      width: RELIEF_WIDTH,
      height: RELIEF_HEIGHT,
      fresh: true,
      label: RELIEF_LABEL,
      kind: "heuristic-non-neural",
      confidenceChannel: "positionsTexture.w / heuristic foreground confidence / non-semantic",
      encodeSubmitMs,
      frameIndex: this.#frameIndex,
    };
    return this.#lastResult;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#positionsTexture?.destroy?.();
    for (const texture of this.#historyTextures) texture.destroy?.();
    this.#paramsBuffer?.destroy?.();
    this.#historyTextures.length = 0;
    this.#historyViews.length = 0;
    this.#positionsTexture = null;
    this.#positionView = null;
    this.#lastResult = null;
  }
}

export function createReliefEstimator(options) {
  return new HeuristicReliefEstimator(options);
}

export default createReliefEstimator;
