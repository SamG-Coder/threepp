import { cmd } from "./three-webgpu-cmd.js?tb-native=3";

const FEATURES = [
  "core-features-and-limits",
  "depth-clip-control",
  "depth32float-stencil8",
  "texture-compression-bc",
  "indirect-first-instance",
  "rg11b10ufloat-renderable",
  "bgra8unorm-storage",
  "float32-filterable",
  "float32-blendable",
  "clip-distances",
  "dual-source-blending",
];

const WGSL_FEATURES = [
  "readonly_and_readwrite_storage_textures",
  "packed_4x8_integer_dot_product",
  "unrestricted_pointer_parameters",
  "pointer_composite_access",
  "uniform_buffer_standard_layout",
];

const LIMITS = {
  maxTextureDimension1D: 16384,
  maxTextureDimension2D: 16384,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 2048,
  maxBindGroups: 8,
  maxBindGroupsPlusVertexBuffers: 24,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 8,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 10,
  maxStorageTexturesPerShaderStage: 8,
  maxUniformBuffersPerShaderStage: 12,
  // Match the WebGPU device's portable uniform binding limit. Advertising a
  // larger synthetic value makes three.js combine per-object uniforms into a
  // binding that wgpu-native must reject on otherwise capable adapters.
  maxUniformBufferBindingSize: 64 * 1024,
  maxStorageBufferBindingSize: 1 << 30,
  minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256,
  maxVertexBuffers: 8,
  maxBufferSize: 1 << 30,
  maxVertexAttributes: 30,
  maxVertexBufferArrayStride: 2048,
  maxInterStageShaderComponents: 128,
  maxInterStageShaderVariables: 28,
  maxColorAttachments: 8,
  maxColorAttachmentBytesPerSample: 128,
  maxComputeWorkgroupStorageSize: 32768,
  maxComputeInvocationsPerWorkgroup: 1024,
  maxComputeWorkgroupSizeX: 1024,
  maxComputeWorkgroupSizeY: 1024,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
};

const ADAPTER_INFO = {
  vendor: "ThreeBrowser",
  architecture: "native",
  device: "ThreeBrowser WebGPU",
  description: "Native WebGPU command ring",
  subgroupMinSize: 4,
  subgroupMaxSize: 128,
  isFallbackAdapter: false,
};

let installed = false;
let runtimeStarted = false;
let lastW = 0;
let lastH = 0;
let swapchainAcquired = false;
let overlayStyled = false;
let origGetContext = null;
let origOffscreenGetContext = null;
let tracedSurfaceSubmits = 0;
let activeNativeDevice = null;

function nativeCall(callback, fallback) {
  try {
    const value = callback();
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function reflexRequestMode(value) {
  if (value === undefined || value === null) return -1;
  if (value === true) return 1;
  if (value === false) return 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[\s_+-]+/g, "");
    if (normalized === "off" || normalized === "disabled") return 0;
    if (normalized === "on" || normalized === "enabled" || normalized === "lowlatency") return 1;
    if (normalized === "boost" || normalized === "onboost" || normalized === "lowlatencyboost") return 2;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError("Reflex mode must be off, on, boost, or a number from 0 to 2");
  return Math.max(0, Math.min(2, numeric | 0));
}

function requestedFlag(options, name) {
  if (!Object.prototype.hasOwnProperty.call(options, name)) return -1;
  const value = options[name];
  return value && typeof value === "object" ? (value.enabled === false ? 0 : 1) : (value ? 1 : 0);
}

const DLSS_MODES = Object.freeze({
  off: 0,
  performance: 1,
  "max-performance": 1,
  balanced: 2,
  quality: 3,
  "max-quality": 3,
  "ultra-performance": 4,
  "ultra-quality": 5,
  dlaa: 6,
});

const VULKAN_IMAGE_LAYOUTS = Object.freeze({
  general: 1,
  colorAttachment: 2,
  depthStencilAttachment: 3,
  depthStencilReadOnly: 4,
  shaderReadOnly: 5,
  transferSource: 6,
  transferDestination: 7,
});

function dlssModeValue(value, fallback = 3) {
  if (value === undefined || value === null || value === true) return fallback;
  if (value === false) return 0;
  if (typeof value === "string") {
    const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (Object.prototype.hasOwnProperty.call(DLSS_MODES, key)) return DLSS_MODES[key];
    throw new TypeError(`Unknown DLSS mode "${value}"`);
  }
  const mode = Number(value);
  if (!Number.isInteger(mode) || mode < 0 || mode > 6) {
    throw new TypeError("DLSS mode must be off, performance, balanced, quality, ultra-performance, ultra-quality, DLAA, or 0-6");
  }
  return mode;
}

function finiteNumber(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
}

function positiveDimension(value, name, fallback) {
  const number = Math.trunc(finiteNumber(value, name, fallback));
  if (number <= 0) throw new RangeError(`${name} must be greater than zero`);
  return number;
}

function normalizeDlssOptions(value, defaultWidth, defaultHeight) {
  const source = value && typeof value === "object" ? value : {};
  const enabled = source.enabled !== false && value !== false;
  const mode = enabled ? dlssModeValue(source.mode ?? (typeof value === "object" ? undefined : value)) : 0;
  const outputWidth = mode === 0 ? 0 : positiveDimension(source.outputWidth, "outputWidth", defaultWidth);
  const outputHeight = mode === 0 ? 0 : positiveDimension(source.outputHeight, "outputHeight", defaultHeight);
  return {
    mode,
    outputWidth,
    outputHeight,
    preExposure: finiteNumber(source.preExposure, "preExposure", 1),
    exposureScale: finiteNumber(source.exposureScale, "exposureScale", 1),
    colorBuffersHDR: source.colorBuffersHDR !== false,
    autoExposure: Boolean(source.autoExposure),
    alphaUpscaling: Boolean(source.alphaUpscaling),
  };
}

function numericArray(value, length, name) {
  const source = value?.elements ?? value;
  if (!source || typeof source.length !== "number" || source.length !== length) {
    throw new TypeError(`${name} must contain exactly ${length} numbers`);
  }
  const result = Array.from(source, Number);
  if (result.some(number => !Number.isFinite(number))) {
    throw new TypeError(`${name} must contain only finite numbers`);
  }
  return result;
}

function numericVector(value, length, name) {
  if (value && typeof value === "object" && typeof value.length !== "number" && !value.elements) {
    const keys = length === 2 ? ["x", "y"] : ["x", "y", "z"];
    return numericArray(keys.map(key => value[key]), length, name);
  }
  return numericArray(value, length, name);
}

const DLSS_COLOR_FORMATS = new Set([
  "rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb",
  "rgb10a2unorm", "rg11b10ufloat", "rgba16float", "rgba32float",
]);
const DLSS_DEPTH_FORMATS = new Set(["depth16unorm", "depth32float", "depth32float-stencil8"]);
const DLSS_MOTION_FORMATS = new Set(["rg16float", "rg32float", "rgba16float", "rgba32float"]);
const DLSS_EXPOSURE_FORMATS = new Set(["r16float", "r32float"]);
// Streamline 2.12 DLSS-G does not support FP16/scRGB final color. Keep this
// narrower than the DLSS-SR color set so an HDR intermediate cannot be
// mislabeled as the post-tonemapped HUD-less frame.
const DLSSG_HUDLESS_FORMATS = new Set([
  "rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb", "rgb10a2unorm",
]);
const DLSSG_UI_COLOR_FORMATS = new Set([
  "rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "bgra8unorm-srgb",
]);
const DLSSG_UI_ALPHA_FORMATS = new Set(["r8unorm", "r16float", "r32float"]);
const RR_HDR_COLOR_FORMATS = new Set(["rg11b10ufloat", "rgba16float", "rgba32float"]);
const RR_LINEAR_ALBEDO_FORMATS = new Set([
  "rgba8unorm", "rgb10a2unorm", "rg11b10ufloat", "rgba16float", "rgba32float",
]);
const RR_NORMAL_FORMATS = new Set(["rgba16float", "rgba32float"]);
const RR_SCALAR_FORMATS = new Set(["r16float", "r32float"]);
const RR_MOTION_FORMATS = new Set(["rg16float", "rg32float"]);
const IDENTITY_MATRIX_4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function dlssResource(value, name, allowedFormats, requiredUsage) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required`);
  const texture = value.texture;
  if (!(texture instanceof GPUTexture) || texture._kind !== "texture" || !texture._h) {
    throw new TypeError(`${name}.texture must be a native GPUTexture created by this device`);
  }
  if (texture._swapchain) throw new TypeError(`${name}.texture cannot be the transient swapchain texture`);
  if (texture.dimension !== "2d" || texture.depthOrArrayLayers !== 1 ||
      texture.mipLevelCount !== 1 || texture.sampleCount !== 1) {
    throw new TypeError(`${name}.texture must be a single-sampled, single-layer 2D texture with one mip level`);
  }
  if (!allowedFormats.has(texture.format)) {
    throw new TypeError(`${name}.texture format ${texture.format || "undefined"} is not valid for this DLSS input`);
  }
  if ((texture.usage & requiredUsage) === 0) {
    const requiredName = requiredUsage === 0x08 ? "STORAGE_BINDING" : "TEXTURE_BINDING";
    throw new TypeError(`${name}.texture requires GPUTextureUsage.${requiredName}`);
  }
  const vulkanLayout = Number(value.vulkanLayout);
  if (!Number.isInteger(vulkanLayout) || vulkanLayout <= 0) {
    throw new TypeError(`${name}.vulkanLayout must be the texture's current non-zero Vulkan VkImageLayout value`);
  }
  const left = Math.trunc(finiteNumber(value.left, `${name}.left`, 0));
  const top = Math.trunc(finiteNumber(value.top, `${name}.top`, 0));
  const width = positiveDimension(value.width, `${name}.width`, texture.width - left);
  const height = positiveDimension(value.height, `${name}.height`, texture.height - top);
  if (left < 0 || top < 0 || left + width > texture.width || top + height > texture.height) {
    throw new RangeError(`${name} region must be contained by its texture`);
  }
  return { textureHandle: texture._h, vulkanLayout, left, top, width, height };
}

function rtxFloat32Positions(value) {
  const source = value?.array ?? value;
  if (!source || typeof source.length !== "number" || source.length === 0 || (source.length % 3) !== 0) {
    throw new TypeError("positions must be a non-empty Float32Array-compatible list of world-space xyz triples");
  }
  const positions = source instanceof Float32Array
    ? new Float32Array(source)
    : Float32Array.from(source, Number);
  if (positions.some(component => !Number.isFinite(component))) {
    throw new TypeError("positions must contain only finite world-space coordinates");
  }
  return positions;
}

function rtxUint32Indices(value, vertexCount) {
  const source = value?.array ?? value;
  if (!source || typeof source.length !== "number" || source.length === 0 || (source.length % 3) !== 0) {
    throw new TypeError("indices must be a non-empty Uint32Array-compatible triangle index list");
  }
  const indices = source instanceof Uint32Array
    ? new Uint32Array(source)
    : Uint32Array.from(source, Number);
  for (let i = 0; i < indices.length; i++) {
    const original = Number(source[i]);
    if (!Number.isInteger(original) || original < 0 || original >= vertexCount) {
      throw new RangeError(`indices[${i}] does not reference a registered position`);
    }
  }
  return indices;
}

function rtxTriangleRadiance(value, triangleCount) {
  if (value == null) return null;
  const source = value?.array ?? value;
  const expected = triangleCount * 4;
  if (!source || typeof source.length !== "number" || source.length !== expected) {
    throw new TypeError(
      `triangleRadiance must contain exactly one linear HDR vec4 per triangle (${expected} floats)`,
    );
  }
  const radiance = source instanceof Float32Array
    ? new Float32Array(source)
    : Float32Array.from(source, Number);
  if (radiance.some(component => !Number.isFinite(component) || component < 0)) {
    throw new TypeError("triangleRadiance must contain only finite, non-negative linear HDR values");
  }
  return radiance;
}

function rtxTriangleSurface(value, triangleCount) {
  if (value == null) return null;
  const source = value?.array ?? value;
  const expected = triangleCount * 4;
  if (!source || typeof source.length !== "number" || source.length !== expected) {
    throw new TypeError(
      `triangleSurface must contain exactly one linear albedo/roughness vec4 per triangle (${expected} floats)`,
    );
  }
  const surface = source instanceof Float32Array
    ? new Float32Array(source)
    : Float32Array.from(source, Number);
  for (let offset = 0; offset < surface.length; offset += 4) {
    if (!Number.isFinite(surface[offset]) || surface[offset] < 0 ||
        !Number.isFinite(surface[offset + 1]) || surface[offset + 1] < 0 ||
        !Number.isFinite(surface[offset + 2]) || surface[offset + 2] < 0 ||
        !Number.isFinite(surface[offset + 3]) ||
        surface[offset + 3] < 0 || surface[offset + 3] > 1) {
      throw new TypeError(
        "triangleSurface must contain finite non-negative linear albedo RGB and roughness in [0, 1]",
      );
    }
  }
  return surface;
}

function rtxStaticLights(value) {
  if (value == null) return null;
  const source = value?.array ?? value;
  if (!source || typeof source.length !== "number" || source.length === 0 ||
      (source.length % 16) !== 0 || source.length > 8 * 16) {
    throw new TypeError(
      "lights must contain between one and eight packed 4xvec4 records (16 floats per light)",
    );
  }
  const lights = source instanceof Float32Array
    ? new Float32Array(source)
    : Float32Array.from(source, Number);
  for (let offset = 0; offset < lights.length; offset += 16) {
    if (Array.from(lights.subarray(offset, offset + 16)).some(value => !Number.isFinite(value))) {
      throw new TypeError("lights must contain only finite values");
    }
    const range = lights[offset + 3];
    const outerCos = lights[offset + 7];
    const intensity = lights[offset + 11];
    const innerCos = lights[offset + 12];
    const type = lights[offset + 13];
    const decay = lights[offset + 14];
    if (range < 0 || outerCos < -1 || outerCos > 1 || intensity < 0 ||
        lights[offset + 8] < 0 || lights[offset + 9] < 0 || lights[offset + 10] < 0 ||
        innerCos < -1 || innerCos > 1 || !Number.isInteger(type) ||
        (type !== 0 && type !== 1) || decay < 0) {
      throw new RangeError(
        "lights require non-negative range/color/intensity/decay, cone cosines in [-1, 1], and type 0 (point) or 1 (spot)",
      );
    }
    if (type === 1) {
      const directionLength = Math.hypot(
        lights[offset + 4], lights[offset + 5], lights[offset + 6],
      );
      if (!(directionLength > 1e-6) || innerCos < outerCos) {
        throw new RangeError(
          "spot lights require a non-zero direction and innerCos greater than or equal to outerCos",
        );
      }
    }
  }
  return lights;
}

function rtxTextureResource(value, name, requiredFormat, requiredUsage, layoutOverride, defaultLayout) {
  const texture = value instanceof GPUTexture ? value : value?.texture;
  if (!(texture instanceof GPUTexture) || texture._kind !== "texture" ||
      !texture._h || texture._destroyed) {
    throw new TypeError(`${name} must be a native GPUTexture created by this device`);
  }
  if (texture._swapchain) {
    throw new TypeError(`${name} cannot be the transient swapchain texture; use a persistent render target`);
  }
  if (texture.dimension !== "2d" || texture.depthOrArrayLayers !== 1 ||
      texture.mipLevelCount !== 1 || texture.sampleCount !== 1) {
    throw new TypeError(`${name} must be a single-sampled, single-layer 2D texture with one mip level`);
  }
  if (texture.format !== requiredFormat) {
    throw new TypeError(`${name} must use ${requiredFormat}; received ${texture.format || "undefined"}`);
  }
  if ((texture.usage & requiredUsage) !== requiredUsage) {
    throw new TypeError(`${name} does not include the GPU usage bits required by native ray-query lighting`);
  }
  const vulkanLayout = Number(layoutOverride ?? value?.vulkanLayout ?? defaultLayout);
  if (!Number.isInteger(vulkanLayout) || vulkanLayout <= 0) {
    throw new TypeError(`${name} requires its current non-zero Vulkan VkImageLayout`);
  }
  return { texture, textureHandle: texture._h, vulkanLayout };
}

function rtxVector4(value, name, defaultW) {
  let source = value?.elements ?? value;
  if (source && typeof source === "object" && typeof source.length !== "number" &&
      "x" in source && "y" in source && "z" in source) {
    source = [source.x, source.y, source.z, source.w ?? defaultW];
  }
  if (!source || typeof source.length !== "number" || (source.length !== 3 && source.length !== 4)) {
    throw new TypeError(`${name} must contain three or four finite numbers`);
  }
  const result = [Number(source[0]), Number(source[1]), Number(source[2]),
    source.length === 4 ? Number(source[3]) : defaultW];
  if (result.some(component => !Number.isFinite(component))) {
    throw new TypeError(`${name} must contain only finite numbers`);
  }
  return result;
}

function dlssFrameConstants(value) {
  if (!value || typeof value !== "object") throw new TypeError("frame.constants is required");
  const cameraNear = finiteNumber(value.cameraNear, "constants.cameraNear");
  const cameraFar = finiteNumber(value.cameraFar, "constants.cameraFar");
  const cameraFov = finiteNumber(value.cameraFov, "constants.cameraFov");
  const cameraAspectRatio = finiteNumber(value.cameraAspectRatio, "constants.cameraAspectRatio");
  if (cameraNear < 0 || cameraFar <= cameraNear || cameraFov <= 0 || cameraAspectRatio <= 0) {
    throw new RangeError("cameraNear/far/fov/aspectRatio do not describe a valid camera");
  }
  return {
    cameraViewToClip: numericArray(value.cameraViewToClip, 16, "constants.cameraViewToClip"),
    clipToCameraView: numericArray(value.clipToCameraView, 16, "constants.clipToCameraView"),
    clipToLensClip: numericArray(value.clipToLensClip, 16, "constants.clipToLensClip"),
    clipToPrevClip: numericArray(value.clipToPrevClip, 16, "constants.clipToPrevClip"),
    prevClipToClip: numericArray(value.prevClipToClip, 16, "constants.prevClipToClip"),
    jitterOffset: numericVector(value.jitterOffset, 2, "constants.jitterOffset"),
    motionVectorScale: numericVector(value.motionVectorScale, 2, "constants.motionVectorScale"),
    cameraPinholeOffset: numericVector(value.cameraPinholeOffset, 2, "constants.cameraPinholeOffset"),
    cameraPosition: numericVector(value.cameraPosition, 3, "constants.cameraPosition"),
    cameraUp: numericVector(value.cameraUp, 3, "constants.cameraUp"),
    cameraRight: numericVector(value.cameraRight, 3, "constants.cameraRight"),
    cameraForward: numericVector(value.cameraForward, 3, "constants.cameraForward"),
    cameraNear,
    cameraFar,
    cameraFov,
    cameraAspectRatio,
    depthInverted: Boolean(value.depthInverted),
    cameraMotionIncluded: Boolean(value.cameraMotionIncluded),
    motionVectors3D: Boolean(value.motionVectors3D),
    reset: Boolean(value.reset),
    orthographicProjection: Boolean(value.orthographicProjection),
    motionVectorsDilated: Boolean(value.motionVectorsDilated),
    motionVectorsJittered: Boolean(value.motionVectorsJittered),
  };
}

function immutableSnapshot(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) immutableSnapshot(child);
  return Object.freeze(value);
}

function ensureConstants() {
  const g = globalThis;
  if (!g.GPUMapMode) g.GPUMapMode = { READ: 0x0001, WRITE: 0x0002 };
  if (!g.GPUBufferUsage) {
    g.GPUBufferUsage = {
      MAP_READ: 0x0001,
      MAP_WRITE: 0x0002,
      COPY_SRC: 0x0004,
      COPY_DST: 0x0008,
      INDEX: 0x0010,
      VERTEX: 0x0020,
      UNIFORM: 0x0040,
      STORAGE: 0x0080,
      INDIRECT: 0x0100,
      QUERY_RESOLVE: 0x0200,
    };
  }
  if (!g.GPUTextureUsage) {
    g.GPUTextureUsage = {
      COPY_SRC: 0x01,
      COPY_DST: 0x02,
      TEXTURE_BINDING: 0x04,
      STORAGE_BINDING: 0x08,
      RENDER_ATTACHMENT: 0x10,
    };
  }
  if (!g.GPUShaderStage) {
    g.GPUShaderStage = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };
  }
  if (!g.GPUColorWrite) {
    g.GPUColorWrite = { RED: 0x1, GREEN: 0x2, BLUE: 0x4, ALPHA: 0x8, ALL: 0xf };
  }
}

function injectOverlayStyle() {
  if (overlayStyled) return;
  overlayStyled = true;
  const doc = globalThis.document;
  if (!doc?.documentElement) return;
  const style = doc.createElement("style");
  style.textContent = "html,body{background:transparent!important;}";
  (doc.head || doc.documentElement).appendChild(style);
}

function styleHitCanvas(el) {
  if (!el || !el.style) return;
  const s = el.style;
  s.position = "fixed";
  s.left = "0";
  s.top = "0";
  s.width = "100%";
  s.height = "100%";
  s.margin = "0";
  s.border = "0";
  s.padding = "0";
  s.display = "block";
  s.boxSizing = "border-box";
  s.background = "transparent";
  s.opacity = "0";
  s.pointerEvents = "auto";
}

function canvasSize(el) {
  // WebGPU presents at the canvas backing-store size, not its CSS size.
  // Three.js may deliberately render above CSS resolution (DPR / supersampling),
  // and every attachment in that pass must match the swapchain texture.
  const w = Math.max(
    1,
    (el && (el.width || el.clientWidth)) || globalThis.innerWidth || 1
  );
  const h = Math.max(
    1,
    (el && (el.height || el.clientHeight)) || globalThis.innerHeight || 1
  );
  return { w: w | 0, h: h | 0 };
}

function ensureStarted(w, h) {
  w = Math.max(1, w | 0);
  h = Math.max(1, h | 0);
  if (!runtimeStarted) {
    cmd.start(w, h);
    runtimeStarted = true;
    lastW = w;
    lastH = h;
    return;
  }
  if (w !== lastW || h !== lastH) {
    cmd.resize(w, h);
    lastW = w;
    lastH = h;
  }
}

function asU8(src) {
  if (!src) return new Uint8Array(0);
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return new Uint8Array(src);
}

function writeBufferBytes(data, dataOffset, size) {
  if (data instanceof ArrayBuffer) {
    const start = dataOffset || 0;
    const n = size != null ? size : data.byteLength - start;
    return new Uint8Array(data, start, n);
  }
  if (ArrayBuffer.isView(data)) {
    const el = data.BYTES_PER_ELEMENT || 1;
    const start = (dataOffset || 0) * el;
    const n = size != null ? size * el : data.byteLength - start;
    return new Uint8Array(data.buffer, data.byteOffset + start, n);
  }
  return asU8(data);
}

function decodeMapped(raw, size) {
  if (raw instanceof ArrayBuffer) return raw.byteLength ? raw : new ArrayBuffer(size);
  if (ArrayBuffer.isView(raw)) {
    const u = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return u.slice().buffer;
  }
  if (typeof raw === "string") {
    const bin = atob(raw);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  if (raw && typeof raw === "object" && raw.length != null) {
    return Uint8Array.from(raw).buffer;
  }
  return new ArrayBuffer(size);
}

function mapReadNative(handle, offset, size) {
  const n = cmd.host();
  if (cmd.hostHas(n, "WebGpuMapRead")) {
    return decodeMapped(n.WebGpuMapRead(handle, offset, size), size);
  }
  if (cmd.hostHas(n, "WebGpuMapReadB64")) {
    return decodeMapped(n.WebGpuMapReadB64(handle, offset, size), size);
  }
  return new ArrayBuffer(size);
}

function dynOffsets(dyn, start, count) {
  if (dyn == null) return [];
  if (start != null && count != null) {
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = dyn[start + i] >>> 0;
    return out;
  }
  return Array.from(dyn, (v) => v >>> 0);
}

function viewHandle(v) {
  if (!v) return 0;
  if (v._swapchain) return 0;
  if (v._tex?._destroyed) {
    throw new Error("Cannot use a GPUTextureView after its parent GPUTexture was destroyed");
  }
  return (v._h || 0) >>> 0;
}

function extent(size) {
  if (size == null) return { width: 1, height: 1, depthOrArrayLayers: 1 };
  if (Array.isArray(size) || typeof size === "object" && size.length != null) {
    return {
      width: size[0] || 1,
      height: size[1] || 1,
      depthOrArrayLayers: size[2] || 1,
    };
  }
  return {
    width: size.width || 1,
    height: size.height || 1,
    depthOrArrayLayers: size.depthOrArrayLayers || 1,
  };
}

function origin3(o) {
  if (!o) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(o) || o.length != null) return { x: o[0] || 0, y: o[1] || 0, z: o[2] || 0 };
  return { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
}

function rasterize(image, w, h, flipY) {
  const doc = globalThis.document;
  if (!doc?.createElement) return new Uint8Array(w * h * 4);
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx2d = c.getContext("2d", { willReadFrequently: true });
  if (!ctx2d) return new Uint8Array(w * h * 4);
  if (flipY) {
    ctx2d.translate(0, h);
    ctx2d.scale(1, -1);
  }
  try {
    ctx2d.drawImage(image, 0, 0, w, h);
  } catch {
    return new Uint8Array(w * h * 4);
  }
  return ctx2d.getImageData(0, 0, w, h).data;
}

class FeatureSet {
  constructor(list) {
    this._s = new Set(list);
  }
  has(name) {
    return this._s.has(name);
  }
  keys() {
    return this._s.values();
  }
  values() {
    return this._s.values();
  }
  entries() {
    return this._s.entries();
  }
  forEach(fn, thisArg) {
    this._s.forEach(fn, thisArg);
  }
  get size() {
    return this._s.size;
  }
  [Symbol.iterator]() {
    return this._s.values();
  }
}

class Emitter {
  constructor() {
    this._l = new Map();
  }
  addEventListener(type, fn) {
    if (typeof fn !== "function") return;
    let set = this._l.get(type);
    if (!set) {
      set = new Set();
      this._l.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type, fn) {
    this._l.get(type)?.delete(fn);
  }
  dispatchEvent(ev) {
    const set = this._l.get(ev.type);
    if (set) for (const fn of set) fn(ev);
    return true;
  }
}

class GPUBuffer {
  constructor(handle, size, usage, mappedAtCreation) {
    this._h = handle;
    this._kind = "buffer";
    this.size = size;
    this.usage = usage;
    this.mapState = mappedAtCreation ? "mapped" : "unmapped";
    this._mapOffset = 0;
    this._mapSize = size;
    this._mappedAtCreation = !!mappedAtCreation;
    this._mapped = mappedAtCreation ? new ArrayBuffer(size) : null;
    this._slices = null;
    this.label = "";
  }
  mapAsync(mode, offset, size) {
    offset = offset || 0;
    size = size == null ? this.size - offset : size;
    this.mapState = "pending";
    this._mapOffset = offset;
    this._mapSize = size;
    const read = mode & 0x0001;
    return new Promise((resolve, reject) => {
      try {
        if (read) {
          cmd.submitNow(true);
          this._mapped = mapReadNative(this._h, offset, size);
        } else {
          this._mapped = new ArrayBuffer(size);
        }
        this.mapState = "mapped";
        resolve();
      } catch (err) {
        this.mapState = "unmapped";
        reject(err);
      }
    });
  }
  getMappedRange(offset, size) {
    if (!this._mapped) return new ArrayBuffer(0);
    offset = offset || 0;
    size = size == null ? this._mapped.byteLength - offset : size;
    if (offset === 0 && size === this._mapped.byteLength) return this._mapped;
    const sub = this._mapped.slice(offset, offset + size);
    (this._slices || (this._slices = [])).push({ offset, buf: sub });
    return sub;
  }
  unmap() {
    if (this._slices) {
      const u = new Uint8Array(this._mapped);
      for (const s of this._slices) u.set(new Uint8Array(s.buf), s.offset);
      this._slices = null;
    }
    const write = this._mappedAtCreation || (this.usage & 0x0002);
    if (write && this._mapped) {
      cmd.bufWrite(this._h, this._mapOffset || 0, new Uint8Array(this._mapped));
    }
    this._mapped = null;
    this._mappedAtCreation = false;
    this.mapState = "unmapped";
  }
  destroy() {
    if (this.mapState === "mapped") this.unmap();
    cmd.bufDestroy(this._h);
  }
}

class GPUTextureView {
  constructor(handle, texture, desc) {
    this._h = handle;
    this._kind = "view";
    this._tex = texture;
    this._desc = { ...(desc || {}) };
    this._swapchain = !!(texture && texture._swapchain);
    this.label = desc?.label || "";
  }
}

class GPUTexture {
  constructor(handle, desc, swapchain) {
    const size = desc.size || desc;
    this._h = handle;
    this._kind = "texture";
    this._swapchain = !!swapchain;
    this.width = (size.width ?? size[0] ?? 1) >>> 0;
    this.height = (size.height ?? size[1] ?? 1) >>> 0;
    this.depthOrArrayLayers = (size.depthOrArrayLayers ?? size[2] ?? 1) >>> 0;
    this.mipLevelCount = (desc.mipLevelCount ?? 1) >>> 0;
    this.sampleCount = (desc.sampleCount ?? 1) >>> 0;
    this.dimension = desc.dimension || "2d";
    this.format = desc.format;
    this.usage = desc.usage >>> 0;
    this.label = desc.label || "";
    this._destroyed = false;
  }
  createView(desc) {
    desc = desc || {};
    if (this._destroyed) throw new Error("Cannot create a view from a destroyed GPUTexture");
    if (this._swapchain) return new GPUTextureView(0, this, desc);
    const h = cmd.allocHandle();
    cmd.texView(h, this._h, desc);
    if (globalThis.process?.env?.THREEBROWSER_TRACE_WEBGPU_VIEWS) {
      console.error("ThreeBrowser WebGPU view", JSON.stringify({ view: h, texture: this._h, size: [this.width, this.height, this.depthOrArrayLayers], desc }));
    }
    return new GPUTextureView(h, this, desc);
  }
  destroy() {
    if (this._swapchain || this._destroyed) return;
    const handle = this._h;
    this._destroyed = true;
    this._h = 0;
    cmd.texDestroy(handle);
  }
}

class GPUSampler {
  constructor(handle) {
    this._h = handle;
    this._kind = "sampler";
    this.label = "";
  }
}

class GPUShaderModule {
  constructor(handle, code) {
    this._h = handle;
    this._kind = "shader";
    this.label = "";
    this._code = code;
  }
  getCompilationInfo() {
    return Promise.resolve({ messages: [] });
  }
}

class GPUBindGroupLayout {
  constructor(handle) {
    this._h = handle;
    this._kind = "bgl";
    this.label = "";
  }
}

class GPUPipelineLayout {
  constructor(handle) {
    this._h = handle;
    this._kind = "pl";
    this.label = "";
  }
}

class GPUBindGroup {
  constructor(handle) {
    this._h = handle;
    this._kind = "bg";
    this.label = "";
  }
}

class GPUComputePipeline {
  constructor(handle, layout) {
    this._h = handle;
    this._kind = "cpipe";
    this._layout = layout;
    this.label = "";
  }
  getBindGroupLayout(index) {
    this._bglCache = this._bglCache || [];
    if (this._bglCache[index]) return this._bglCache[index];
    const h = cmd.allocHandle();
    cmd.pipeBgl(h, this._h, index >>> 0);
    const l = new GPUBindGroupLayout(h);
    this._bglCache[index] = l;
    return l;
  }
}

class GPURenderPipeline {
  constructor(handle, layout) {
    this._h = handle;
    this._kind = "rpipe";
    this._layout = layout;
    this.label = "";
  }
  getBindGroupLayout(index) {
    this._bglCache = this._bglCache || [];
    if (this._bglCache[index]) return this._bglCache[index];
    const h = cmd.allocHandle();
    cmd.pipeBgl(h, this._h, index >>> 0);
    const l = new GPUBindGroupLayout(h);
    this._bglCache[index] = l;
    return l;
  }
}

class GPUQuerySet {
  constructor(handle, desc) {
    this._h = handle;
    this.type = desc.type;
    this.count = desc.count || 0;
    this.label = desc.label || "";
  }
  destroy() {}
}

class GPUCommandBuffer {
  constructor(handle, commands, submissionValidators = [], submissionCallbacks = []) {
    this._h = handle;
    this._commands = commands;
    this._submissionValidators = submissionValidators;
    this._submissionCallbacks = submissionCallbacks;
    this.label = "";
  }
}

class GPURenderBundle {
  constructor(commands, desc) {
    this._commands = commands;
    this.label = desc?.label || "";
  }
}

class GPURenderBundleEncoder {
  constructor(desc) {
    this._commands = [];
    this.label = desc?.label || "";
  }
  setPipeline(pipeline) {
    this._commands.push(["setPipeline", pipeline]);
  }
  setBindGroup(index, group, dyn, start, count) {
    this._commands.push(["setBindGroup", index, group, dynOffsets(dyn, start, count)]);
  }
  setVertexBuffer(slot, buffer, offset, size) {
    this._commands.push(["setVertexBuffer", slot, buffer, offset, size]);
  }
  setIndexBuffer(buffer, format, offset, size) {
    this._commands.push(["setIndexBuffer", buffer, format, offset, size]);
  }
  draw(vertexCount, instanceCount, firstVertex, firstInstance) {
    this._commands.push(["draw", vertexCount, instanceCount, firstVertex, firstInstance]);
  }
  drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance) {
    this._commands.push(["drawIndexed", indexCount, instanceCount, firstIndex, baseVertex, firstInstance]);
  }
  drawIndirect(buffer, offset) {
    this._commands.push(["drawIndirect", buffer, offset]);
  }
  drawIndexedIndirect(buffer, offset) {
    this._commands.push(["drawIndexedIndirect", buffer, offset]);
  }
  setViewport(x, y, width, height, minDepth, maxDepth) {
    this._commands.push(["setViewport", x, y, width, height, minDepth, maxDepth]);
  }
  setScissorRect(x, y, width, height) {
    this._commands.push(["setScissorRect", x, y, width, height]);
  }
  setStencilReference(reference) {
    this._commands.push(["setStencilReference", reference]);
  }
  setBlendConstant(color) {
    this._commands.push(["setBlendConstant", color]);
  }
  pushDebugGroup() {}
  popDebugGroup() {}
  insertDebugMarker() {}
  finish(desc) {
    return new GPURenderBundle(this._commands.slice(), desc);
  }
}

class GPUComputePassEncoder {
  constructor(enc, commands) {
    this._enc = enc;
    this._commands = commands;
    this.label = "";
  }
  setPipeline(pipeline) {
    this._commands.push(["computePipe", pipeline]);
  }
  setBindGroup(index, group, dyn, start, count) {
    this._commands.push(["computeBg", index, group, dynOffsets(dyn, start, count)]);
  }
  dispatchWorkgroups(x, y, z) {
    this._commands.push(["dispatch", x, y, z]);
  }
  dispatchWorkgroupsIndirect() {}
  end() {
    this._commands.push(["computeEnd"]);
  }
  pushDebugGroup() {}
  popDebugGroup() {}
  insertDebugMarker() {}
}

class GPURenderPassEncoder {
  constructor(enc, commands) {
    this._enc = enc;
    this._commands = commands;
    this.label = "";
  }
  setPipeline(pipeline) {
    this._commands.push(["renderPipe", pipeline]);
  }
  setBindGroup(index, group, dyn, start, count) {
    this._commands.push(["renderBg", index, group, dynOffsets(dyn, start, count)]);
  }
  setVertexBuffer(slot, buffer, offset, size) {
    this._commands.push(["setVertex", slot, buffer, offset || 0, size || 0]);
  }
  setIndexBuffer(buffer, format, offset, size) {
    this._commands.push(["setIndex", buffer, format, offset || 0, size || 0]);
  }
  draw(vertexCount, instanceCount, firstVertex, firstInstance) {
    this._commands.push(["draw", vertexCount, instanceCount, firstVertex, firstInstance]);
  }
  drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance) {
    this._commands.push(["drawIndexed", indexCount, instanceCount, firstIndex, baseVertex, firstInstance]);
  }
  drawIndirect(buffer, offset) {
    this._commands.push(["drawIndirect", buffer, offset || 0, false]);
  }
  drawIndexedIndirect(buffer, offset) {
    this._commands.push(["drawIndirect", buffer, offset || 0, true]);
  }
  setViewport(x, y, width, height, minDepth, maxDepth) {
    this._commands.push(["setViewport", x, y, width, height, minDepth, maxDepth]);
  }
  setScissorRect(x, y, width, height) {
    this._commands.push(["setScissor", x, y, width, height]);
  }
  setStencilReference(reference) {
    this._commands.push(["setStencil", reference]);
  }
  setBlendConstant(color) {
    this._commands.push(["setBlend", color]);
  }
  beginOcclusionQuery() {}
  endOcclusionQuery() {}
  executeBundles(bundles) {
    for (const bundle of bundles || []) {
      for (const entry of bundle?._commands || []) {
        const method = entry[0];
        const fn = this[method];
        if (typeof fn === "function") fn.apply(this, entry.slice(1));
      }
    }
  }
  end() {
    this._commands.push(["renderEnd"]);
  }
  finish() {
    return { _h: 0, label: "" };
  }
  pushDebugGroup() {}
  popDebugGroup() {}
  insertDebugMarker() {}
}

function packColorAttachment(c) {
  return {
    viewHandle: viewHandle(c.view),
    // 0 = swapchain, 0xffffffff = no resolve (do not guess).
    resolveHandle: c.resolveTarget == null ? 0xffffffff : viewHandle(c.resolveTarget),
    loadOp: c.loadOp,
    storeOp: c.storeOp,
    clearValue: c.clearValue,
  };
}

function packDepth(d) {
  if (!d) return null;
  return {
    viewHandle: viewHandle(d.view),
    depthLoadOp: d.depthLoadOp,
    depthStoreOp: d.depthStoreOp,
    depthClearValue: d.depthClearValue,
    stencilLoadOp: d.stencilLoadOp,
    stencilStoreOp: d.stencilStoreOp,
    stencilClearValue: d.stencilClearValue,
  };
}

class GPUCommandEncoder {
  constructor(desc) {
    this._h = cmd.allocHandle();
    this._commands = [];
    this._submissionValidators = [];
    this._submissionCallbacks = [];
    this._finished = false;
    this.label = desc?.label || "";
  }
  beginComputePass() {
    this._commands.push(["computeBegin"]);
    return new GPUComputePassEncoder(this._h, this._commands);
  }
  beginRenderPass(desc) {
    this._commands.push(["renderBegin", {
      colorAttachments: (desc.colorAttachments || []).map(packColorAttachment),
      depthStencilAttachment: packDepth(desc.depthStencilAttachment),
    }]);
    return new GPURenderPassEncoder(this._h, this._commands);
  }
  copyBufferToBuffer(src, srcOffset, dst, dstOffset, size) {
    this._commands.push(["copyBuf", src, srcOffset, dst, dstOffset, size]);
  }
  copyTextureToBuffer(source, dest, copySize) {
    this._commands.push(["copyTex", 0,
      {
        handle: source.texture._h,
        origin: origin3(source.origin),
        mipLevel: source.mipLevel,
        aspect: source.aspect,
      },
      {
        handle: dest.buffer._h,
        offset: dest.offset,
        bytesPerRow: dest.bytesPerRow,
        rowsPerImage: dest.rowsPerImage,
      },
      extent(copySize)]);
  }
  copyBufferToTexture(source, dest, copySize) {
    this._commands.push(["copyTex", 1,
      {
        handle: source.buffer._h,
        offset: source.offset,
        bytesPerRow: source.bytesPerRow,
        rowsPerImage: source.rowsPerImage,
      },
      {
        handle: dest.texture._h,
        origin: origin3(dest.origin),
        mipLevel: dest.mipLevel,
        aspect: dest.aspect,
      },
      extent(copySize)]);
  }
  copyTextureToTexture(source, dest, copySize) {
    this._commands.push(["copyTex", 2,
      {
        handle: source.texture._h,
        origin: origin3(source.origin),
        mipLevel: source.mipLevel,
        aspect: source.aspect,
      },
      {
        handle: dest.texture._h,
        origin: origin3(dest.origin),
        mipLevel: dest.mipLevel,
        aspect: dest.aspect,
      },
      extent(copySize)]);
  }
  clearBuffer() {}
  resolveQuerySet() {}
  finish() {
    const commandBuffer = new GPUCommandBuffer(
      this._h,
      this._commands.slice(),
      this._submissionValidators.slice(),
      this._submissionCallbacks.slice(),
    );
    this._finished = true;
    return commandBuffer;
  }
  pushDebugGroup() {}
  popDebugGroup() {}
  insertDebugMarker() {}
}

function replayCommandBuffer(buffer) {
  const enc = buffer._h;
  cmd.encBegin(enc);
  for (const entry of buffer._commands || []) {
    const op = entry[0];
    switch (op) {
      case "computeBegin": cmd.computeBegin(enc); break;
      case "computePipe": cmd.computePipe(enc, entry[1]._h); break;
      case "computeBg": cmd.computeBg(enc, entry[1], entry[2]._h, entry[3]); break;
      case "dispatch": cmd.dispatch(enc, entry[1], entry[2], entry[3]); break;
      case "computeEnd": cmd.computeEnd(enc); break;
      case "renderBegin": cmd.renderBegin(enc, entry[1]); break;
      case "renderPipe": cmd.renderPipe(enc, entry[1]._h); break;
      case "renderBg": cmd.renderBg(enc, entry[1], entry[2]._h, entry[3]); break;
      case "setVertex": cmd.setVertex(enc, entry[1], entry[2]._h, entry[3], entry[4]); break;
      case "setIndex": cmd.setIndex(enc, entry[1]._h, entry[2], entry[3], entry[4]); break;
      case "draw": cmd.draw(enc, entry[1], entry[2], entry[3], entry[4]); break;
      case "drawIndexed": cmd.drawIndexed(enc, entry[1], entry[2], entry[3], entry[4], entry[5]); break;
      case "drawIndirect": cmd.drawIndirect(enc, entry[1]._h, entry[2], entry[3]); break;
      case "setViewport": cmd.setViewport(enc, entry[1], entry[2], entry[3], entry[4], entry[5], entry[6]); break;
      case "setScissor": cmd.setScissor(enc, entry[1], entry[2], entry[3], entry[4]); break;
      case "setStencil": cmd.setStencil(enc, entry[1]); break;
      case "setBlend": cmd.setBlend(enc, entry[1]); break;
      case "renderEnd": cmd.renderEnd(enc); break;
      case "dlssEvaluate": cmd.dlssEvaluate(enc, entry[1]); break;
      case "frameGenerationTag": cmd.frameGenerationTag(enc, entry[1]); break;
      case "rayReconstructionEvaluate": cmd.rayReconstructionEvaluate(enc, entry[1]); break;
      case "rtxSceneBegin": cmd.rtxSceneBegin(); break;
      case "rtxScenePositions": cmd.rtxScenePositions(entry[1]); break;
      case "rtxSceneIndices": cmd.rtxSceneIndices(entry[1]); break;
      case "rtxSceneTriangleRadiance": cmd.rtxSceneTriangleRadiance(entry[1]); break;
      case "rtxSceneTriangleSurface": cmd.rtxSceneTriangleSurface(entry[1]); break;
      case "rtxSceneLights": cmd.rtxSceneLights(entry[1]); break;
      case "rtxSceneCommit": cmd.rtxSceneCommit(enc); break;
      case "rtxLightingEvaluate": cmd.rtxLightingEvaluate(enc, entry[1]); break;
      case "rtxReflectionsEvaluate": cmd.rtxReflectionsEvaluate(enc, entry[1]); break;
      case "copyBuf": cmd.copyBuf(enc, entry[1]._h, entry[3]._h, entry[2], entry[4], entry[5]); break;
      case "copyTex": cmd.copyTex(enc, entry[1], entry[2], entry[3], entry[4]); break;
    }
  }
  cmd.submitEncoders([enc]);
}

class GPUQueue {
  constructor(device) {
    this._device = device;
    this.label = "";
  }
  submit(buffers) {
    const submittedBuffers = Array.from(buffers || []);
    // Native-only passes may depend on state established by an earlier submit.
    // Validate every command buffer before replaying any of them so a stale
    // evaluation cannot partially mutate the native command stream.
    for (const buffer of submittedBuffers) {
      for (const validate of buffer?._submissionValidators || []) validate();
    }
    if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER && tracedSurfaceSubmits < 8) {
      for (const buffer of submittedBuffers) {
        const commands = buffer?._commands || [];
        const surfacePasses = commands.filter(entry => entry[0] === "renderBegin" &&
          entry[1]?.colorAttachments?.some(attachment => attachment.viewHandle === 0));
        if (surfacePasses.length) {
          tracedSurfaceSubmits++;
          console.error("ThreeBrowser WebGPU surface submit", {
            passes: surfacePasses.length,
            draws: commands.filter(entry => entry[0] === "draw" || entry[0] === "drawIndexed" || entry[0] === "drawIndirect"),
            loadOp: surfacePasses[0][1].colorAttachments[0]?.loadOp,
            clear: surfacePasses[0][1].colorAttachments[0]?.clearValue,
          });
        }
      }
    }
    for (const buffer of submittedBuffers) replayCommandBuffer(buffer);
    if (swapchainAcquired) {
      cmd.present();
      swapchainAcquired = false;
    }
    cmd.submitNow();
    // State becomes active only after native replay and submission both return
    // successfully. Keep callback order identical to command-buffer order.
    for (const buffer of submittedBuffers) {
      for (const submitted of buffer?._submissionCallbacks || []) submitted();
    }
  }
  writeBuffer(buffer, bufferOffset, data, dataOffset, size) {
    cmd.bufWrite(buffer._h, bufferOffset || 0, writeBufferBytes(data, dataOffset, size));
  }
  writeTexture(dest, data, layout, size) {
    let bytes = asU8(data);
    if (layout?.offset) bytes = bytes.subarray(layout.offset);
    const sz = extent(size);
    const bpr = layout?.bytesPerRow || (sz.height > 0 ? Math.floor(bytes.byteLength / sz.height) : bytes.byteLength);
    cmd.texWrite(
      dest.texture._h,
      dest.mipLevel || 0,
      origin3(dest.origin),
      sz,
      bytes,
      bpr,
      layout?.rowsPerImage
    );
  }
  copyExternalImageToTexture(source, dest, copySize) {
    const sz = extent(copySize);
    const pixels = rasterize(source.source, sz.width, sz.height, !!source.flipY);
    cmd.texWrite(
      dest.texture._h,
      dest.mipLevel || 0,
      origin3(dest.origin),
      sz,
      pixels,
      sz.width * 4,
      sz.height
    );
  }
  onSubmittedWorkDone() {
    return Promise.resolve();
  }
}

function packRenderDesc(desc) {
  const vs = desc.vertex || {};
  const fs = desc.fragment;
  return {
    layoutHandle: desc.layout && desc.layout !== "auto" ? desc.layout._h : 0,
    vertex: {
      moduleHandle: vs.module?._h || 0,
      entryPoint: vs.entryPoint || "main",
      buffers: vs.buffers || [],
    },
    fragment: fs
      ? {
          moduleHandle: fs.module?._h || 0,
          entryPoint: fs.entryPoint || "main",
          targets: fs.targets || [],
        }
      : null,
    primitive: desc.primitive,
    multisample: desc.multisample,
    depthStencil: desc.depthStencil,
  };
}

function bgEntries(entries) {
  const out = [];
  for (let i = 0; i < (entries?.length || 0); i++) {
    const e = entries[i];
    const r = e.resource;
    if (r && r.buffer) {
      out.push({
        binding: e.binding,
        kind: 0,
        resource: r.buffer._h,
        offset: r.offset || 0,
        size: r.size || 0,
      });
    } else if (r && r._kind === "sampler") {
      out.push({ binding: e.binding, kind: 1, resource: r._h, offset: 0, size: 0 });
    } else {
      out.push({ binding: e.binding, kind: 2, resource: viewHandle(r), offset: 0, size: 0 });
    }
  }
  return out;
}

class GPUDevice extends Emitter {
  constructor(adapter, desc) {
    super();
    this._adapter = adapter;
    this.features = new FeatureSet(desc.requiredFeatures || FEATURES);
    this.limits = Object.assign({}, LIMITS, desc.requiredLimits || {});
    this.adapterInfo = ADAPTER_INFO;
    this.queue = new GPUQueue(this);
    this.lost = new Promise(() => {});
    this.label = desc.label || "";
    this._errStack = [];
    activeNativeDevice = this;
    ensureStarted(globalThis.innerWidth || 1, globalThis.innerHeight || 1);
  }
  createShaderModule(desc) {
    const h = cmd.allocHandle();
    cmd.shaderCreate(h, desc.code || "");
    const m = new GPUShaderModule(h, desc.code);
    m.label = desc.label || "";
    return m;
  }
  createBuffer(desc) {
    const h = cmd.allocHandle();
    const size = desc.size >>> 0;
    cmd.bufCreate(h, size, desc.usage >>> 0, !!desc.mappedAtCreation);
    const buf = new GPUBuffer(h, size, desc.usage >>> 0, !!desc.mappedAtCreation);
    buf.label = desc.label || "";
    return buf;
  }
  createTexture(desc) {
    const h = cmd.allocHandle();
    cmd.texCreate(h, desc);
    return new GPUTexture(h, desc, false);
  }
  createSampler(desc) {
    const h = cmd.allocHandle();
    cmd.sampCreate(h, desc || {});
    const s = new GPUSampler(h);
    s.label = desc?.label || "";
    return s;
  }
  createBindGroupLayout(desc) {
    const h = cmd.allocHandle();
    cmd.bglCreate(h, desc.entries || []);
    const l = new GPUBindGroupLayout(h);
    l.label = desc.label || "";
    return l;
  }
  createPipelineLayout(desc) {
    const layouts = desc.bindGroupLayouts || [];
    const h = cmd.allocHandle();
    cmd.plCreate(
      h,
      layouts.map((l) => l._h)
    );
    const pl = new GPUPipelineLayout(h);
    pl._bgls = layouts;
    pl.label = desc.label || "";
    return pl;
  }
  createBindGroup(desc) {
    const h = cmd.allocHandle();
    if (globalThis.process?.env?.THREEBROWSER_TRACE_WEBGPU_VIEWS) {
      console.error("ThreeBrowser WebGPU bind group", JSON.stringify({ handle: h, entries: (desc.entries || []).map(entry => ({ binding: entry.binding, view: entry.resource?._h, texture: entry.resource?._tex?._h, size: entry.resource?._tex ? [entry.resource._tex.width, entry.resource._tex.height, entry.resource._tex.depthOrArrayLayers] : entry.resource?.size, viewDesc: entry.resource?._desc, buffer: entry.resource?.buffer?._h, bufferSize: entry.resource?.buffer?.size, bufferUsage: entry.resource?.buffer?.usage })) }));
    }
    cmd.bgCreate(h, desc.layout._h, bgEntries(desc.entries));
    const g = new GPUBindGroup(h);
    g.label = desc.label || "";
    return g;
  }
  createComputePipeline(desc) {
    const h = cmd.allocHandle();
    const layout = desc.layout && desc.layout !== "auto" ? desc.layout : null;
    cmd.cpipeCreate(
      h,
      layout ? layout._h : 0,
      desc.compute.module._h,
      desc.compute.entryPoint || "main"
    );
    const p = new GPUComputePipeline(h, layout);
    p.label = desc.label || "";
    return p;
  }
  createComputePipelineAsync(desc) {
    return Promise.resolve(this.createComputePipeline(desc));
  }
  createRenderPipeline(desc) {
    const h = cmd.allocHandle();
    const layout = desc.layout && desc.layout !== "auto" ? desc.layout : null;
    cmd.rpipeCreate(h, packRenderDesc(desc));
    const p = new GPURenderPipeline(h, layout);
    p.label = desc.label || "";
    return p;
  }
  createRenderPipelineAsync(desc) {
    return Promise.resolve(this.createRenderPipeline(desc));
  }
  createCommandEncoder(desc) {
    return new GPUCommandEncoder(desc);
  }
  createQuerySet(desc) {
    return new GPUQuerySet(cmd.allocHandle(), desc || {});
  }
  createRenderBundleEncoder(desc) {
    return new GPURenderBundleEncoder(desc);
  }
  pushErrorScope(filter) {
    this._errStack.push(filter);
  }
  popErrorScope() {
    this._errStack.pop();
    return Promise.resolve(null);
  }
  destroy() {
    if (activeNativeDevice === this) activeNativeDevice = null;
  }
  importExternalTexture() {
    return { _kind: "external" };
  }
}

class GPUAdapter {
  constructor() {
    this.features = new FeatureSet(FEATURES);
    this.limits = Object.assign({}, LIMITS);
    this.info = ADAPTER_INFO;
    this.isFallbackAdapter = false;
  }
  requestDevice(desc) {
    if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) console.error("ThreeBrowser WebGPU requestDevice", desc || {});
    desc = desc || {};
    const granted = [];
    const seen = new Set();
    const req = desc.requiredFeatures || [];
    for (let i = 0; i < req.length; i++) {
      if (!seen.has(req[i])) {
        seen.add(req[i]);
        granted.push(req[i]);
      }
    }
    for (let i = 0; i < FEATURES.length; i++) {
      if (!seen.has(FEATURES[i])) {
        seen.add(FEATURES[i]);
        granted.push(FEATURES[i]);
      }
    }
    return Promise.resolve(new GPUDevice(this, { ...desc, requiredFeatures: granted }));
  }
  requestAdapterInfo() {
    return Promise.resolve(ADAPTER_INFO);
  }
}

class GPUCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this._device = null;
    this._format = "bgra8unorm";
    this._alphaMode = "opaque";
    this._usage = 0x10;
    this._tex = null;
    this._configured = false;
  }
  _isPresented() {
    const select = globalThis.__threeBrowserIsPresentedCanvas;
    return typeof select !== "function" || select(this.canvas);
  }
  _createTexture(w, h, swapchain) {
    const desc = {
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: this._format,
      usage: this._usage | 0x10,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: "2d",
    };
    return swapchain
      ? new GPUTexture(0, desc, true)
      : this._device.createTexture(desc);
  }
  configure(cfg) {
    if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) console.error("ThreeBrowser WebGPU canvas configure", cfg?.format || "bgra8unorm");
    this._device = cfg.device;
    this._format = cfg.format || "bgra8unorm";
    this._alphaMode = cfg.alphaMode || "opaque";
    this._usage = cfg.usage ?? 0x10;
    this._configured = true;
    injectOverlayStyle();
    styleHitCanvas(this.canvas);
    const { w, h } = canvasSize(this.canvas);
    const presented = this._isPresented();
    if (presented) ensureStarted(w, h);
    this._tex = this._createTexture(w, h, presented);
  }
  unconfigure() {
    this._configured = false;
    this._tex = null;
  }
  getConfiguration() {
    if (!this._configured) return null;
    return {
      device: this._device,
      format: this._format,
      usage: this._usage,
      alphaMode: this._alphaMode,
      viewFormats: [],
      colorSpace: "srgb",
      toneMapping: { mode: "standard" },
    };
  }
  getCurrentTexture() {
    const { w, h } = canvasSize(this.canvas);
    const presented = this._isPresented();
    if (presented) {
      ensureStarted(w, h);
      swapchainAcquired = true;
    }
    if (!this._tex || this._tex._swapchain !== presented ||
        this._tex.width !== w || this._tex.height !== h) {
      if (this._tex && !this._tex._swapchain) this._tex.destroy();
      this._tex = this._createTexture(w, h, presented);
    }
    return this._tex;
  }
}

const canvasContexts = new WeakMap();

function getCanvasContext(canvas) {
  let ctx = canvasContexts.get(canvas);
  if (ctx) return ctx;
  injectOverlayStyle();
  styleHitCanvas(canvas);
  ctx = new GPUCanvasContext(canvas);
  if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) console.error("ThreeBrowser WebGPU canvas context created");
  canvasContexts.set(canvas, ctx);
  return ctx;
}

class GPU {
  constructor() {
    this.wgslLanguageFeatures = new FeatureSet(WGSL_FEATURES);
  }
  requestAdapter() {
    if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) console.error("ThreeBrowser WebGPU requestAdapter");
    return Promise.resolve(new GPUAdapter());
  }
  getPreferredCanvasFormat() {
    return "bgra8unorm";
  }
}

export function isInstalled() {
  return installed;
}

export function present() {
  cmd.present();
  cmd.submitNow();
  swapchainAcquired = false;
}

export function attachMessageChannelLoop(renderer) {
  if (!renderer || typeof renderer.setAnimationLoop !== "function" || renderer._tbMsgLoop) {
    return renderer;
  }
  renderer._tbMsgLoop = true;
  const orig = renderer.setAnimationLoop.bind(renderer);
  renderer.setAnimationLoop = function (cb) {
    this._tbAnim = cb;
    if (this._tbAnimPort) {
      try {
        this._tbAnimPort.close();
      } catch {
        /* ignore */
      }
      this._tbAnimPort = null;
    }
    if (!cb) {
      orig(null);
      return;
    }
    if (typeof MessageChannel !== "function") {
      orig(cb);
      return;
    }
    orig(null);
    const ch = new MessageChannel();
    this._tbAnimPort = ch.port1;
    const self = this;
    const loop = () => {
      if (self._tbAnim !== cb) return;
      try {
        cb(performance.now());
      } catch (err) {
        console.error(err);
        self._tbAnim = null;
        return;
      }
      if (self._tbAnim === cb) ch.port2.postMessage(0);
    };
    ch.port1.onmessage = loop;
    ch.port2.postMessage(0);
  };
  return renderer;
}

export function install() {
  if (installed) return true;
  let n = null;
  try {
    n = globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  } catch {
    n = null;
  }
  if (!n) throw new Error("ThreeBrowser native WebGPU host missing");

  ensureConstants();
  const gpu = new GPU();
  const requested = {
    reflexMode: -1,
    dlssSuperResolution: -1,
    dlssOptions: null,
    dlssFrameGeneration: -1,
    dlssRayReconstruction: -1,
  };
  let staticRaySceneQueued = false;
  let staticRaySceneSubmitted = false;
  let staticRaySceneGeneration = 0;
  let activeStaticRaySceneGeneration = 0;
  let rayLightingQueued = false;
  let rayReflectionsQueued = false;

  const readCapabilities = () => {
    const raw = nativeCall(() => n.WebGpuCapabilities?.(), {}) || {};
    return {
      vendorId: Number(raw.vendorId || 0),
      deviceId: Number(raw.deviceId || 0),
      rtx: Boolean(raw.rtx),
      streamlinePresent: Boolean(raw.streamlinePresent),
      streamlineInitialized: Boolean(raw.streamlineInitialized),
      vulkanAttached: Boolean(raw.vulkanAttached),
      dlssSuperResolution: Boolean(raw.dlssSuperResolution),
      dlssFrameGeneration: Boolean(raw.dlssFrameGeneration),
      dlssRayReconstruction: Boolean(raw.dlssRayReconstruction),
      nativeRayTracing: Boolean(raw.nativeRayTracing ?? raw.rayQuery ?? raw.rayTracing),
      rayQuery: Boolean(raw.rayQuery ?? raw.nativeRayTracing ?? raw.rayTracing),
      reflex: Boolean(raw.reflex),
      adapterName: String(raw.adapterName || ""),
      status: String(raw.status || ""),
    };
  };

  const featureState = (supported, request, configured, active, reason, extra = {}) => ({
    supported: Boolean(supported),
    requested: request > 0,
    requestSpecified: request >= 0,
    configured: Boolean(configured),
    active: Boolean(active),
    reason,
    ...extra,
  });

  const fallbackStatus = () => {
    const capabilities = readCapabilities();
    const activeReflexMode = Number(nativeCall(() => n.WebGpuReflexMode?.(), 0)) || 0;
    const reflexConfigured = requested.reflexMode >= 0 && capabilities.reflex &&
      activeReflexMode === requested.reflexMode;
    const reflexReason = !capabilities.reflex
      ? "NVIDIA Reflex is not supported by the active native context."
      : requested.reflexMode < 0
        ? (activeReflexMode > 0
          ? "Enabled by the native runtime default; no page request has been made."
          : "Supported, but no page request has been made.")
        : reflexConfigured
          ? (activeReflexMode > 0
            ? "The requested Reflex mode is configured and active."
            : "Reflex is configured off as requested.")
          : "The requested Reflex mode was not accepted by the native runtime.";
    const unevaluated = (supported, request) => !supported
      ? "The active native context does not report this feature as supported."
      : request > 0
        ? "Support is present and the request is recorded, but no successful native evaluation has been observed; the feature is not active."
        : "Support is present, but the page has not requested or evaluated this feature.";
    return {
      apiVersion: 1,
      available: Boolean(capabilities.adapterName || capabilities.rtx || capabilities.streamlinePresent),
      backend: String(nativeCall(() => n.WebGpuBackendName?.(), "") || ""),
      capabilities,
      features: {
        reflex: featureState(
          capabilities.reflex,
          requested.reflexMode,
          reflexConfigured,
          capabilities.reflex && activeReflexMode > 0,
          reflexReason,
          { requestedMode: requested.reflexMode, activeMode: activeReflexMode },
        ),
        dlssSuperResolution: featureState(
          capabilities.dlssSuperResolution,
          requested.dlssSuperResolution,
          false,
          false,
          unevaluated(capabilities.dlssSuperResolution, requested.dlssSuperResolution),
        ),
        dlssFrameGeneration: featureState(
          capabilities.dlssFrameGeneration,
          requested.dlssFrameGeneration,
          false,
          false,
          unevaluated(capabilities.dlssFrameGeneration, requested.dlssFrameGeneration),
        ),
        dlssRayReconstruction: featureState(
          capabilities.dlssRayReconstruction,
          requested.dlssRayReconstruction,
          false,
          false,
          unevaluated(capabilities.dlssRayReconstruction, requested.dlssRayReconstruction),
        ),
        nativeRayTracing: featureState(
          capabilities.nativeRayTracing,
          staticRaySceneQueued ? 1 : -1,
          staticRaySceneQueued,
          rayLightingQueued || rayReflectionsQueued,
          !capabilities.nativeRayTracing
            ? "The active Vulkan adapter does not expose the required acceleration-structure and ray-query features."
            : !staticRaySceneQueued
              ? "Native ray queries are available; register a world-space static triangle scene to build BLAS/TLAS resources."
              : rayReflectionsQueued
                ? "Native one-bounce reflections have been queued on the Vulkan command stream."
                : rayLightingQueued
                  ? "Native sun visibility and ray-traced ambient occlusion have been queued on the Vulkan command stream."
                  : "The static scene is queued; evaluate ray lighting or reflections with persistent render targets.",
        ),
      },
    };
  };

  const getStatus = () => {
    const nativeStatus = nativeCall(() => n.WebGpuFeatureStatus?.(), null);
    if (nativeStatus?.features) {
      try {
        return immutableSnapshot(JSON.parse(JSON.stringify(nativeStatus)));
      } catch {
        // A legacy COM host may return a non-serializable proxy. The normalized
        // fallback below has the same public shape.
      }
    }
    return immutableSnapshot(fallbackStatus());
  };

  const requestFeatures = (options = {}) => {
    if (!options || typeof options !== "object") {
      throw new TypeError("threeBrowserRTX.requestFeatures expects an options object");
    }
    const reflexValue = Object.prototype.hasOwnProperty.call(options, "reflexMode")
      ? options.reflexMode
      : options.reflex;
    const reflexMode = reflexRequestMode(reflexValue);
    const hasDlss = Object.prototype.hasOwnProperty.call(options, "dlssSuperResolution");
    const hasRayReconstruction = Object.prototype.hasOwnProperty.call(options, "dlssRayReconstruction");
    const dlssSuperResolution = requestedFlag(options, "dlssSuperResolution");
    const dlssFrameGeneration = requestedFlag(options, "dlssFrameGeneration");
    const dlssRayReconstruction = requestedFlag(options, "dlssRayReconstruction");
    if (reflexMode >= 0) requested.reflexMode = reflexMode;
    if (hasDlss) {
      requested.dlssSuperResolution = dlssSuperResolution;
      requested.dlssOptions = normalizeDlssOptions(
        options.dlssSuperResolution,
        Math.max(1, lastW || globalThis.innerWidth || 1),
        Math.max(1, lastH || globalThis.innerHeight || 1),
      );
    } else if (hasRayReconstruction && dlssRayReconstruction > 0) {
      // DLSS-RR is an extension of DLSS and uses its performance-quality mode
      // and fixed output size.  A Ray Reconstruction object therefore doubles
      // as the underlying DLSS configuration when SR was not specified.
      requested.dlssSuperResolution = 1;
      requested.dlssOptions = normalizeDlssOptions(
        options.dlssRayReconstruction,
        Math.max(1, lastW || globalThis.innerWidth || 1),
        Math.max(1, lastH || globalThis.innerHeight || 1),
      );
    }
    if (dlssFrameGeneration >= 0) requested.dlssFrameGeneration = dlssFrameGeneration;
    if (dlssRayReconstruction >= 0) requested.dlssRayReconstruction = dlssRayReconstruction;

    const dlss = requested.dlssOptions;

    const nativeStatus = nativeCall(
      () => n.WebGpuRequestFeatures?.(
        reflexMode,
        dlss ? dlss.mode : -1,
        dlss?.outputWidth ?? 0,
        dlss?.outputHeight ?? 0,
        dlss?.preExposure ?? 1,
        dlss?.exposureScale ?? 1,
        dlss?.colorBuffersHDR === false ? 0 : 1,
        dlss?.autoExposure ? 1 : 0,
        dlss?.alphaUpscaling ? 1 : 0,
        requested.dlssFrameGeneration,
        requested.dlssRayReconstruction,
      ),
      null,
    );
    if (!nativeStatus && reflexMode >= 0) {
      nativeCall(() => n.WebGpuSetReflexMode?.(reflexMode), false);
    }
    return getStatus();
  };

  const getOptimalSettings = (options = {}) => {
    const normalized = normalizeDlssOptions(
      options,
      Math.max(1, lastW || globalThis.innerWidth || 1),
      Math.max(1, lastH || globalThis.innerHeight || 1),
    );
    if (normalized.mode === 0) throw new TypeError("DLSS optimal settings require an enabled DLSS mode");
    const result = nativeCall(
      () => n.WebGpuDLSSOptimalSettings?.(
        normalized.mode,
        normalized.outputWidth,
        normalized.outputHeight,
        normalized.preExposure,
        normalized.exposureScale,
        normalized.colorBuffersHDR ? 1 : 0,
        normalized.autoExposure ? 1 : 0,
        normalized.alphaUpscaling ? 1 : 0,
      ),
      null,
    );
    return result && typeof result === "object"
      ? immutableSnapshot(JSON.parse(JSON.stringify(result)))
      : null;
  };

  const evaluateSuperResolution = (frame = {}) => {
    if (!frame || typeof frame !== "object") {
      throw new TypeError("threeBrowserRTX.evaluateSuperResolution expects a frame object");
    }
    const encoder = frame.commandEncoder;
    if (!(encoder instanceof GPUCommandEncoder) || !encoder._h || !Array.isArray(encoder._commands)) {
      throw new TypeError("frame.commandEncoder must be a native GPUCommandEncoder from this device");
    }
    if (encoder._finished) {
      throw new TypeError("frame.commandEncoder has already been finished; record DLSS evaluation before finish()");
    }
    const packed = {
      viewport: Math.max(0, Math.trunc(finiteNumber(frame.viewport, "frame.viewport", 0))),
      colorInput: dlssResource(frame.colorInput, "frame.colorInput", DLSS_COLOR_FORMATS, 0x04),
      colorOutput: dlssResource(frame.colorOutput, "frame.colorOutput", DLSS_COLOR_FORMATS, 0x08),
      depth: dlssResource(frame.depth, "frame.depth", DLSS_DEPTH_FORMATS, 0x04),
      motionVectors: dlssResource(frame.motionVectors, "frame.motionVectors", DLSS_MOTION_FORMATS, 0x04),
      exposure: frame.exposure
        ? dlssResource(frame.exposure, "frame.exposure", DLSS_EXPOSURE_FORMATS, 0x04)
        : null,
      constants: dlssFrameConstants(frame.constants),
    };
    if (packed.colorInput.textureHandle === packed.colorOutput.textureHandle) {
      throw new TypeError("DLSS colorInput and colorOutput must be different textures");
    }
    for (const [name, resource] of [["depth", packed.depth], ["motionVectors", packed.motionVectors]]) {
      if (resource.width !== packed.colorInput.width || resource.height !== packed.colorInput.height) {
        throw new RangeError(`frame.${name} region must match frame.colorInput dimensions`);
      }
    }
    const configured = getStatus().features?.dlssSuperResolution;
    if (configured?.configured && configured.renderWidth > 0 && configured.renderHeight > 0 &&
        (packed.colorInput.width !== configured.renderWidth || packed.colorInput.height !== configured.renderHeight)) {
      throw new RangeError("frame.colorInput dimensions do not match the configured DLSS render dimensions");
    }
    if (configured?.configured && configured.outputWidth > 0 && configured.outputHeight > 0 &&
        (packed.colorOutput.width !== configured.outputWidth || packed.colorOutput.height !== configured.outputHeight)) {
      throw new RangeError("frame.colorOutput dimensions do not match the configured DLSS output dimensions");
    }
    encoder._commands.push(["dlssEvaluate", packed]);
    const status = getStatus();
    return immutableSnapshot({
      queued: true,
      viewport: packed.viewport,
      status,
      note: "Evaluation is recorded on the command encoder. Active state changes only after queue submission and successful native replay.",
    });
  };

  const tagFrameGeneration = (frame = {}) => {
    if (!frame || typeof frame !== "object") {
      throw new TypeError("threeBrowserRTX.tagFrameGeneration expects a frame object");
    }
    const encoder = frame.commandEncoder;
    if (!(encoder instanceof GPUCommandEncoder) || !encoder._h || !Array.isArray(encoder._commands)) {
      throw new TypeError("frame.commandEncoder must be a native GPUCommandEncoder from this device");
    }
    if (encoder._finished) {
      throw new TypeError("frame.commandEncoder has already been finished; tag Frame Generation before finish()");
    }
    if (encoder._commands.length !== 0) {
      throw new TypeError(
        "Frame Generation tagging requires a dedicated empty command encoder; submit ordinary WebGPU work before tagging present inputs",
      );
    }
    const feature = getStatus().features?.dlssFrameGeneration;
    if (!feature?.requested) {
      throw new TypeError(
        "DLSS Frame Generation must be requested with requestFeatures before tagging present inputs",
      );
    }
    const framesToGenerate = Math.trunc(finiteNumber(
      frame.framesToGenerate,
      "frame.framesToGenerate",
      1,
    ));
    // Streamline 2.12 only supports multi-frame generation on D3D12.  This
    // runtime presents through Vulkan, so exposing a larger value would be a
    // false capability even on a GPU that supports Dynamic MFG elsewhere.
    if (framesToGenerate !== 1) {
      throw new RangeError("Vulkan Frame Generation supports exactly one generated frame per rendered frame");
    }
    const uiAlphaOnly = Boolean(frame.uiAlphaOnly);
    if (!frame.ui && uiAlphaOnly) {
      throw new TypeError("frame.uiAlphaOnly requires frame.ui");
    }
    const packed = {
      viewport: Math.max(0, Math.trunc(finiteNumber(frame.viewport, "frame.viewport", 0))),
      hudlessColor: dlssResource(
        frame.hudlessColor,
        "frame.hudlessColor",
        DLSSG_HUDLESS_FORMATS,
        0x04,
      ),
      depth: dlssResource(frame.depth, "frame.depth", DLSS_DEPTH_FORMATS, 0x04),
      motionVectors: dlssResource(
        frame.motionVectors,
        "frame.motionVectors",
        DLSS_MOTION_FORMATS,
        0x04,
      ),
      ui: frame.ui
        ? dlssResource(
          frame.ui,
          "frame.ui",
          uiAlphaOnly ? DLSSG_UI_ALPHA_FORMATS : DLSSG_UI_COLOR_FORMATS,
          0x04,
        )
        : null,
      uiAlphaOnly,
      framesToGenerate,
      constants: dlssFrameConstants(frame.constants),
    };
    if (packed.depth.width !== packed.motionVectors.width ||
        packed.depth.height !== packed.motionVectors.height) {
      throw new RangeError("frame.depth and frame.motionVectors regions must have identical dimensions");
    }
    const backbufferWidth = Math.max(0, Math.trunc(lastW || globalThis.innerWidth || 0));
    const backbufferHeight = Math.max(0, Math.trunc(lastH || globalThis.innerHeight || 0));
    if (backbufferWidth > 0 && backbufferHeight > 0 &&
        (packed.hudlessColor.width !== backbufferWidth ||
         packed.hudlessColor.height !== backbufferHeight)) {
      throw new RangeError("frame.hudlessColor region must exactly match the configured backbuffer dimensions");
    }
    if (packed.ui &&
        (packed.ui.width !== packed.hudlessColor.width ||
         packed.ui.height !== packed.hudlessColor.height)) {
      throw new RangeError("frame.ui region must exactly match frame.hudlessColor dimensions");
    }
    encoder._commands.push(["frameGenerationTag", packed]);
    return immutableSnapshot({
      queued: true,
      viewport: packed.viewport,
      status: getStatus(),
      note: "Inputs are tagged until the following Present. Active changes only when Streamline reports an interpolated frame after that Present.",
    });
  };

  const evaluateRayReconstruction = (frame = {}) => {
    if (!frame || typeof frame !== "object") {
      throw new TypeError("threeBrowserRTX.evaluateRayReconstruction expects a frame object");
    }
    if (frame.rayTracedInput !== true) {
      throw new TypeError(
        "frame.rayTracedInput must be true: Ray Reconstruction denoises genuine noisy ray-traced lighting; it does not create rays",
      );
    }
    const encoder = frame.commandEncoder;
    if (!(encoder instanceof GPUCommandEncoder) || !encoder._h || !Array.isArray(encoder._commands)) {
      throw new TypeError("frame.commandEncoder must be a native GPUCommandEncoder from this device");
    }
    if (encoder._finished) {
      throw new TypeError("frame.commandEncoder has already been finished; record Ray Reconstruction before finish()");
    }
    if (encoder._commands.length !== 0) {
      throw new TypeError(
        "Ray Reconstruction requires a dedicated empty command encoder; submit ordinary WebGPU work before recording the native pass",
      );
    }
    const normalRoughnessPacked = frame.normalRoughnessPacked !== false;
    const hasRoughness = Boolean(frame.roughness);
    if (normalRoughnessPacked === hasRoughness) {
      throw new TypeError(
        "Provide packed normal.xyz/roughness.w or set normalRoughnessPacked:false and provide a separate roughness texture",
      );
    }
    const hasSpecularMotionVectors = Boolean(frame.specularMotionVectors);
    const hasSpecularHitDistance = Boolean(frame.specularHitDistance);
    if (hasSpecularMotionVectors === hasSpecularHitDistance) {
      throw new TypeError(
        "Provide exactly one reflection guide: specularMotionVectors or specularHitDistance plus world/view matrices",
      );
    }
    if (hasSpecularHitDistance &&
        (frame.worldToCameraView == null || frame.cameraViewToWorld == null)) {
      throw new TypeError(
        "specularHitDistance requires explicit worldToCameraView and cameraViewToWorld matrices",
      );
    }
    const worldToCameraView = numericArray(
      frame.worldToCameraView ?? IDENTITY_MATRIX_4,
      16,
      "frame.worldToCameraView",
    );
    const cameraViewToWorld = numericArray(
      frame.cameraViewToWorld ?? IDENTITY_MATRIX_4,
      16,
      "frame.cameraViewToWorld",
    );
    if (hasSpecularHitDistance &&
        (worldToCameraView.every(value => value === 0) ||
         cameraViewToWorld.every(value => value === 0))) {
      throw new TypeError("specularHitDistance requires non-zero worldToCameraView and cameraViewToWorld matrices");
    }

    const packed = {
      viewport: Math.max(0, Math.trunc(finiteNumber(frame.viewport, "frame.viewport", 0))),
      noisyColor: dlssResource(frame.noisyColor, "frame.noisyColor", RR_HDR_COLOR_FORMATS, 0x04),
      colorOutput: dlssResource(frame.colorOutput, "frame.colorOutput", RR_HDR_COLOR_FORMATS, 0x08),
      depth: dlssResource(frame.depth, "frame.depth", DLSS_DEPTH_FORMATS, 0x04),
      motionVectors: dlssResource(frame.motionVectors, "frame.motionVectors", RR_MOTION_FORMATS, 0x04),
      diffuseAlbedo: dlssResource(frame.diffuseAlbedo, "frame.diffuseAlbedo", RR_LINEAR_ALBEDO_FORMATS, 0x04),
      specularAlbedo: dlssResource(frame.specularAlbedo, "frame.specularAlbedo", RR_LINEAR_ALBEDO_FORMATS, 0x04),
      normalRoughness: dlssResource(frame.normalRoughness, "frame.normalRoughness", RR_NORMAL_FORMATS, 0x04),
      roughness: hasRoughness
        ? dlssResource(frame.roughness, "frame.roughness", RR_SCALAR_FORMATS, 0x04)
        : null,
      specularMotionVectors: hasSpecularMotionVectors
        ? dlssResource(frame.specularMotionVectors, "frame.specularMotionVectors", RR_MOTION_FORMATS, 0x04)
        : null,
      specularHitDistance: hasSpecularHitDistance
        ? dlssResource(frame.specularHitDistance, "frame.specularHitDistance", RR_SCALAR_FORMATS, 0x04)
        : null,
      normalRoughnessPacked,
      worldToCameraView,
      cameraViewToWorld,
      constants: dlssFrameConstants(frame.constants),
    };
    if (packed.noisyColor.textureHandle === packed.colorOutput.textureHandle) {
      throw new TypeError("Ray Reconstruction noisyColor and colorOutput must be different textures");
    }
    for (const [name, resource] of [
      ["depth", packed.depth],
      ["motionVectors", packed.motionVectors],
      ["diffuseAlbedo", packed.diffuseAlbedo],
      ["specularAlbedo", packed.specularAlbedo],
      ["normalRoughness", packed.normalRoughness],
      ["roughness", packed.roughness],
      ["specularMotionVectors", packed.specularMotionVectors],
      ["specularHitDistance", packed.specularHitDistance],
    ]) {
      if (resource &&
          (resource.width !== packed.noisyColor.width ||
           resource.height !== packed.noisyColor.height)) {
        throw new RangeError(`frame.${name} region must match frame.noisyColor dimensions`);
      }
    }
    const statusBeforeQueue = getStatus().features?.dlssRayReconstruction;
    if (statusBeforeQueue && !statusBeforeQueue.requested) {
      throw new TypeError(
        "DLSS Ray Reconstruction must be requested with requestFeatures before recording evaluation",
      );
    }
    const dlssStatus = getStatus().features?.dlssSuperResolution;
    if (dlssStatus?.outputWidth > 0 && dlssStatus?.outputHeight > 0 &&
        (packed.colorOutput.width !== dlssStatus.outputWidth ||
         packed.colorOutput.height !== dlssStatus.outputHeight)) {
      throw new RangeError("frame.colorOutput dimensions do not match the configured DLSS output dimensions");
    }
    encoder._commands.push(["rayReconstructionEvaluate", packed]);
    return immutableSnapshot({
      queued: true,
      viewport: packed.viewport,
      status: getStatus(),
      note: "Native DLSS-RR evaluation is queued. Active becomes true only after Streamline accepts every denoiser input during submission.",
    });
  };

  const dedicatedNativeEncoder = (provided, operation) => {
    const encoder = provided ?? activeNativeDevice?.createCommandEncoder({
      label: `ThreeBrowser ${operation}`,
    });
    if (!(encoder instanceof GPUCommandEncoder) || !encoder._h || !Array.isArray(encoder._commands)) {
      throw new TypeError(
        `${operation}.commandEncoder must be a native GPUCommandEncoder, or an active native GPUDevice must exist`,
      );
    }
    if (encoder._finished) {
      throw new TypeError(`${operation}.commandEncoder has already been finished`);
    }
    if (encoder._commands.length !== 0) {
      throw new TypeError(`${operation} requires a dedicated empty command encoder`);
    }
    return { encoder, autoSubmit: provided == null };
  };

  const submitNativeEncoderIfNeeded = ({ encoder, autoSubmit }) => {
    if (!autoSubmit) return false;
    if (!activeNativeDevice) throw new Error("The active native GPUDevice was destroyed before submission");
    activeNativeDevice.queue.submit([encoder.finish()]);
    return true;
  };

  const requireActiveStaticRayScene = (operation) => {
    if (!staticRaySceneQueued ||
        !staticRaySceneSubmitted ||
        activeStaticRaySceneGeneration !== staticRaySceneGeneration) {
      throw new Error(
        `registerStaticScene must be submitted before native ${operation} can be evaluated`,
      );
    }
    return activeStaticRaySceneGeneration;
  };

  const bindEvaluationToStaticScene = (encoder, generation, operation) => {
    encoder._submissionValidators.push(() => {
      if (!staticRaySceneQueued ||
          !staticRaySceneSubmitted ||
          staticRaySceneGeneration !== generation ||
          activeStaticRaySceneGeneration !== generation) {
        throw new Error(
          `The static scene changed before native ${operation} was submitted; record the evaluation again`,
        );
      }
    });
  };

  const registerStaticScene = (scene = {}) => {
    if (!scene || typeof scene !== "object") {
      throw new TypeError("threeBrowserRTX.registerStaticScene expects a scene object");
    }
    const positions = rtxFloat32Positions(scene.positions);
    const vertexCount = positions.length / 3;
    const indices = rtxUint32Indices(scene.indices, vertexCount);
    const triangleCount = indices.length / 3;
    const triangleRadiance = rtxTriangleRadiance(
      scene.triangleRadiance ?? scene.radiance,
      triangleCount,
    );
    const triangleSurface = rtxTriangleSurface(scene.triangleSurface, triangleCount);
    const lights = rtxStaticLights(scene.lights);
    const nativeEncoder = dedicatedNativeEncoder(scene.commandEncoder, "registerStaticScene");
    nativeEncoder.encoder._commands.push(["rtxSceneBegin"]);
    nativeEncoder.encoder._commands.push(["rtxScenePositions", positions]);
    nativeEncoder.encoder._commands.push(["rtxSceneIndices", indices]);
    if (triangleRadiance) {
      nativeEncoder.encoder._commands.push(["rtxSceneTriangleRadiance", triangleRadiance]);
    }
    if (triangleSurface) {
      nativeEncoder.encoder._commands.push(["rtxSceneTriangleSurface", triangleSurface]);
    }
    if (lights) {
      nativeEncoder.encoder._commands.push(["rtxSceneLights", lights]);
    }
    nativeEncoder.encoder._commands.push(["rtxSceneCommit"]);
    const generation = ++staticRaySceneGeneration;
    staticRaySceneQueued = true;
    staticRaySceneSubmitted = false;
    rayLightingQueued = false;
    rayReflectionsQueued = false;
    nativeEncoder.encoder._submissionCallbacks.push(() => {
      activeStaticRaySceneGeneration = generation;
      staticRaySceneSubmitted = generation === staticRaySceneGeneration;
    });
    const submitted = submitNativeEncoderIfNeeded(nativeEncoder);
    return immutableSnapshot({
      queued: true,
      submitted,
      vertexCount,
      triangleCount,
      hasTriangleRadiance: Boolean(triangleRadiance),
      hasTriangleSurface: Boolean(triangleSurface),
      staticLightCount: lights ? lights.length / 16 : 0,
      note: "World-space geometry plus optional per-triangle radiance, surface response and static lights are uploaded once; native owns the BLAS and identity TLAS after this command buffer completes.",
    });
  };

  const destroyStaticScene = () => {
    cmd.rtxSceneDestroy();
    cmd.submitNow(true);
    staticRaySceneQueued = false;
    staticRaySceneSubmitted = false;
    staticRaySceneGeneration++;
    activeStaticRaySceneGeneration = 0;
    rayLightingQueued = false;
    rayReflectionsQueued = false;
    return true;
  };

  const evaluateRayLighting = (frame = {}) => {
    if (!frame || typeof frame !== "object") {
      throw new TypeError("threeBrowserRTX.evaluateRayLighting expects a frame object");
    }
    const sceneGeneration = requireActiveStaticRayScene("ray-query lighting");
    const nativeEncoder = dedicatedNativeEncoder(frame.commandEncoder, "evaluateRayLighting");
    bindEvaluationToStaticScene(
      nativeEncoder.encoder,
      sceneGeneration,
      "ray-query lighting",
    );
    const color = rtxTextureResource(
      frame.color ?? frame.colorTexture,
      "color",
      "rgba16float",
      0x08,
      frame.colorVulkanLayout ?? frame.colorLayout,
      VULKAN_IMAGE_LAYOUTS.colorAttachment,
    );
    const depth = rtxTextureResource(
      frame.depth ?? frame.depthTexture,
      "depth",
      "depth32float",
      0x04,
      frame.depthVulkanLayout ?? frame.depthLayout,
      VULKAN_IMAGE_LAYOUTS.depthStencilAttachment,
    );
    const width = positiveDimension(frame.width, "width", Math.min(color.texture.width, depth.texture.width));
    const height = positiveDimension(frame.height, "height", Math.min(color.texture.height, depth.texture.height));
    if (width > color.texture.width || height > color.texture.height ||
        width > depth.texture.width || height > depth.texture.height) {
      throw new RangeError("Ray-query lighting dimensions must fit inside both color and depth textures");
    }

    const inverseViewProjection = numericArray(
      frame.inverseViewProjection,
      16,
      "inverseViewProjection",
    );
    const cameraPosition = rtxVector4(frame.cameraPosition, "cameraPosition", 1);
    const sun = rtxVector4(frame.sunDirection, "sunDirection", 0);
    const sunLength = Math.hypot(sun[0], sun[1], sun[2]);
    if (!(sunLength > 1e-6)) throw new RangeError("sunDirection must be non-zero");
    const intensity = finiteNumber(frame.intensity, "intensity", sun[3] || 1);
    if (intensity < 0) throw new RangeError("intensity cannot be negative");
    const shadowStrength = finiteNumber(frame.shadowStrength, "shadowStrength", 0.9);
    const aoStrength = finiteNumber(frame.aoStrength, "aoStrength", 0.22);
    const aoRadius = finiteNumber(frame.aoRadius, "aoRadius", 0.8);
    const aoMaxDistance = finiteNumber(frame.aoMaxDistance, "aoMaxDistance", 40);
    if (shadowStrength < 0 || aoStrength < 0 || aoRadius <= 0 || aoMaxDistance <= 0) {
      throw new RangeError("shadow/AO strengths must be non-negative and AO radius/distances must be positive");
    }
    const waterSource = frame.water && typeof frame.water === "object" ? frame.water : {};
    const waterTime = finiteNumber(waterSource.time, "water.time", 0);
    const waterSurfaceY = finiteNumber(waterSource.surfaceY, "water.surfaceY", 0);
    const causticStrength = finiteNumber(waterSource.strength, "water.strength", 0);
    const waterIor = finiteNumber(waterSource.ior, "water.ior", 1.333);
    if (causticStrength < 0 || waterIor < 1) {
      throw new RangeError("water.strength must be non-negative and water.ior must be at least 1");
    }

    const packed = {
      colorTextureHandle: color.textureHandle,
      colorVulkanLayout: color.vulkanLayout,
      depthTextureHandle: depth.textureHandle,
      depthVulkanLayout: depth.vulkanLayout,
      width,
      height,
      inverseViewProjection,
      cameraPosition,
      sunDirectionIntensity: [
        sun[0] / sunLength,
        sun[1] / sunLength,
        sun[2] / sunLength,
        intensity,
      ],
      params: [shadowStrength, aoStrength, aoRadius, aoMaxDistance],
      flags: (frame.depthInverted ? 1 : 0) | (frame.highQuality ? 2 : 0),
      water: [waterTime, waterSurfaceY, causticStrength, waterIor],
    };
    nativeEncoder.encoder._commands.push(["rtxLightingEvaluate", packed]);
    rayLightingQueued = true;
    const submitted = submitNativeEncoderIfNeeded(nativeEncoder);
    return immutableSnapshot({
      queued: true,
      submitted,
      width,
      height,
      effects: Object.freeze({
        sunVisibility: shadowStrength > 0,
        rayTracedAmbientOcclusion: aoStrength > 0,
        refractedWaterCaustics: causticStrength > 0,
        stableSunSamples: frame.highQuality ? 4 : 1,
        stableAoSamples: frame.highQuality ? 8 : 2,
      }),
      note: "Native Vulkan ray queries shade the HDR target in place and restore both supplied image layouts.",
    });
  };

  const evaluateRayReflections = (frame = {}) => {
    if (!frame || typeof frame !== "object") {
      throw new TypeError("threeBrowserRTX.evaluateRayReflections expects a frame object");
    }
    const sceneGeneration = requireActiveStaticRayScene("ray reflections");
    const nativeEncoder = dedicatedNativeEncoder(frame.commandEncoder, "evaluateRayReflections");
    bindEvaluationToStaticScene(
      nativeEncoder.encoder,
      sceneGeneration,
      "ray reflections",
    );
    const sourceColor = rtxTextureResource(
      frame.sourceColor ?? frame.colorInput,
      "sourceColor",
      "rgba16float",
      0x04,
      frame.sourceColorVulkanLayout ?? frame.sourceColorLayout,
      VULKAN_IMAGE_LAYOUTS.shaderReadOnly,
    );
    const outputColor = rtxTextureResource(
      frame.outputColor ?? frame.colorOutput,
      "outputColor",
      "rgba16float",
      0x08,
      frame.outputColorVulkanLayout ?? frame.outputColorLayout,
      VULKAN_IMAGE_LAYOUTS.colorAttachment,
    );
    const depth = rtxTextureResource(
      frame.depth ?? frame.depthTexture,
      "depth",
      "depth32float",
      0x04,
      frame.depthVulkanLayout ?? frame.depthLayout,
      VULKAN_IMAGE_LAYOUTS.depthStencilAttachment,
    );
    const normalRoughness = rtxTextureResource(
      frame.normalRoughness,
      "normalRoughness",
      "rgba16float",
      0x04,
      frame.normalRoughnessVulkanLayout ?? frame.normalRoughnessLayout,
      VULKAN_IMAGE_LAYOUTS.colorAttachment,
    );
    const specularAlbedo = rtxTextureResource(
      frame.specularAlbedo,
      "specularAlbedo",
      "rgba16float",
      0x04,
      frame.specularAlbedoVulkanLayout ?? frame.specularAlbedoLayout,
      VULKAN_IMAGE_LAYOUTS.colorAttachment,
    );
    const inputs = [sourceColor, depth, normalRoughness, specularAlbedo];
    if (inputs.some(resource => resource.textureHandle === outputColor.textureHandle)) {
      throw new TypeError("outputColor must be distinct from every ray-reflection input texture");
    }
    const uniqueInputHandles = new Set(inputs.map(resource => resource.textureHandle));
    if (uniqueInputHandles.size !== inputs.length) {
      throw new TypeError("Ray-reflection source, depth, normal/roughness and specular guides must be distinct textures");
    }

    const width = positiveDimension(frame.width, "width", sourceColor.texture.width);
    const height = positiveDimension(frame.height, "height", sourceColor.texture.height);
    for (const [name, resource] of [
      ["sourceColor", sourceColor],
      ["outputColor", outputColor],
      ["depth", depth],
      ["normalRoughness", normalRoughness],
      ["specularAlbedo", specularAlbedo],
    ]) {
      if (resource.texture.width !== width || resource.texture.height !== height) {
        throw new RangeError(`${name} must exactly match the ${width}x${height} ray-reflection extent`);
      }
    }

    const inverseViewProjection = numericArray(
      frame.inverseViewProjection,
      16,
      "inverseViewProjection",
    );
    const cameraPosition = rtxVector4(frame.cameraPosition, "cameraPosition", 1);
    const reflectionStrength = finiteNumber(frame.reflectionStrength, "reflectionStrength", 1);
    const maxDistance = finiteNumber(frame.maxDistance, "maxDistance", 120);
    const rayBias = finiteNumber(frame.rayBias, "rayBias", 0.012);
    const roughnessCutoff = finiteNumber(frame.roughnessCutoff, "roughnessCutoff", 0.32);
    if (reflectionStrength < 0 || maxDistance <= 0 || rayBias <= 0 ||
        roughnessCutoff <= 0 || roughnessCutoff > 1) {
      throw new RangeError(
        "reflectionStrength must be non-negative; maxDistance/rayBias must be positive; roughnessCutoff must be in (0, 1]",
      );
    }
    const environmentColor = rtxVector4(
      frame.environmentColor ?? frame.environment ?? [0.018, 0.032, 0.052],
      "environmentColor",
      1,
    );
    const environmentIntensity = finiteNumber(
      frame.environmentIntensity,
      "environmentIntensity",
      environmentColor[3],
    );
    if (environmentColor.slice(0, 3).some(component => component < 0) ||
        environmentIntensity < 0) {
      throw new RangeError("environmentColor and environmentIntensity must be non-negative");
    }
    const frameIndex = Math.trunc(finiteNumber(frame.frameIndex, "frameIndex", 0));
    if (frameIndex < 0) throw new RangeError("frameIndex cannot be negative");

    const packed = {
      sourceColor: {
        textureHandle: sourceColor.textureHandle,
        vulkanLayout: sourceColor.vulkanLayout,
      },
      outputColor: {
        textureHandle: outputColor.textureHandle,
        vulkanLayout: outputColor.vulkanLayout,
      },
      depth: { textureHandle: depth.textureHandle, vulkanLayout: depth.vulkanLayout },
      normalRoughness: {
        textureHandle: normalRoughness.textureHandle,
        vulkanLayout: normalRoughness.vulkanLayout,
      },
      specularAlbedo: {
        textureHandle: specularAlbedo.textureHandle,
        vulkanLayout: specularAlbedo.vulkanLayout,
      },
      width,
      height,
      inverseViewProjection,
      cameraPosition,
      params: [reflectionStrength, maxDistance, rayBias, roughnessCutoff],
      environment: [
        environmentColor[0],
        environmentColor[1],
        environmentColor[2],
        environmentIntensity,
      ],
      flags: (frame.depthInverted ? 1 : 0) |
        (frame.temporalJitter ? 2 : 0) |
        (frame.highQuality ? 4 : 0),
      frameIndex,
    };
    nativeEncoder.encoder._commands.push(["rtxReflectionsEvaluate", packed]);
    rayReflectionsQueued = true;
    const submitted = submitNativeEncoderIfNeeded(nativeEncoder);
    return immutableSnapshot({
      queued: true,
      submitted,
      width,
      height,
      effects: Object.freeze({
        oneBounceReflections: reflectionStrength > 0,
        roughnessAware: true,
        offscreenStaticGeometry: true,
        stableSampleTiers: frame.highQuality ? "1/8/16" : "1/4/8",
      }),
      note: "Native Vulkan ray queries write one-bounce static-scene reflections to a distinct HDR output and restore all supplied image layouts.",
    });
  };

  const releaseViewport = (viewport = 0) => {
    const normalized = Math.max(0, Math.trunc(finiteNumber(viewport, "viewport", 0)));
    nativeCall(() => n.WebGpuDLSSReleaseViewport?.(normalized), undefined);
  };

  Object.defineProperty(gpu, "threeBrowserRTX", {
    configurable: false,
    enumerable: true,
    value: Object.freeze({
      get capabilities() { return immutableSnapshot(readCapabilities()); },
      get status() { return getStatus(); },
      get reflexMode() { return Number(nativeCall(() => n.WebGpuReflexMode?.(), 0)) || 0; },
      getStatus,
      requestFeatures,
      getOptimalSettings,
      evaluateSuperResolution,
      tagFrameGeneration,
      evaluateRayReconstruction,
      registerStaticScene,
      destroyStaticScene,
      evaluateRayLighting,
      evaluateRayReflections,
      releaseViewport,
      vulkanImageLayouts: VULKAN_IMAGE_LAYOUTS,
      setReflexMode(mode) {
        const status = requestFeatures({ reflexMode: mode });
        return Boolean(status.features?.reflex?.configured);
      },
    }),
  });
  try {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: gpu,
    });
  } catch {
    navigator.gpu = gpu;
  }

  if (!origGetContext) {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (String(type).toLowerCase() === "webgpu") return getCanvasContext(this);
      return origGetContext.apply(this, arguments);
    };
  }
  if (globalThis.OffscreenCanvas && !origOffscreenGetContext) {
    origOffscreenGetContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (type) {
      if (String(type).toLowerCase() === "webgpu") return getCanvasContext(this);
      return origOffscreenGetContext.apply(this, arguments);
    };
  }

  installed = true;
  return true;
}

export { GPUBuffer, GPUTexture, GPUDevice, GPUAdapter };
