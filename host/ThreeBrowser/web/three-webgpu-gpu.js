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
  maxUniformBufferBindingSize: 16 * 1024 * 1024,
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
  // Match the native HWND (CSS client pixels). Ignoring backing-store
  // pixelRatio avoids MSAA/swapchain size mismatch.
  const w = Math.max(
    1,
    (el && (el.clientWidth || el.width)) || globalThis.innerWidth || 1
  );
  const h = Math.max(
    1,
    (el && (el.clientHeight || el.height)) || globalThis.innerHeight || 1
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
  }
  createView(desc) {
    desc = desc || {};
    if (this._swapchain) return new GPUTextureView(0, this, desc);
    const h = cmd.allocHandle();
    cmd.texView(h, this._h, desc);
    if (globalThis.process?.env?.THREEBROWSER_TRACE_WEBGPU_VIEWS) {
      console.error("ThreeBrowser WebGPU view", JSON.stringify({ view: h, texture: this._h, size: [this.width, this.height, this.depthOrArrayLayers], desc }));
    }
    return new GPUTextureView(h, this, desc);
  }
  destroy() {
    if (this._swapchain) return;
    cmd.texDestroy(this._h);
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
  constructor(handle, commands) {
    this._h = handle;
    this._commands = commands;
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
      { handle: source.buffer._h, offset: source.offset },
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
    return new GPUCommandBuffer(this._h, this._commands.slice());
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
    for (const buffer of buffers || []) replayCommandBuffer(buffer);
    if (swapchainAcquired) {
      cmd.present();
      swapchainAcquired = false;
    }
    cmd.submitNow();
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
      console.error("ThreeBrowser WebGPU bind group", JSON.stringify({ handle: h, entries: (desc.entries || []).map(entry => ({ binding: entry.binding, view: entry.resource?._h, texture: entry.resource?._tex?._h, size: entry.resource?._tex ? [entry.resource._tex.width, entry.resource._tex.height, entry.resource._tex.depthOrArrayLayers] : undefined, viewDesc: entry.resource?._desc })) }));
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
  destroy() {}
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
  configure(cfg) {
    this._device = cfg.device;
    this._format = cfg.format || "bgra8unorm";
    this._alphaMode = cfg.alphaMode || "opaque";
    this._usage = cfg.usage ?? 0x10;
    this._configured = true;
    injectOverlayStyle();
    styleHitCanvas(this.canvas);
    const { w, h } = canvasSize(this.canvas);
    ensureStarted(w, h);
    this._tex = new GPUTexture(
      0,
      {
        size: { width: w, height: h, depthOrArrayLayers: 1 },
        format: this._format,
        usage: this._usage | 0x10,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: "2d",
      },
      true
    );
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
    ensureStarted(w, h);
    swapchainAcquired = true;
    if (!this._tex) {
      this._tex = new GPUTexture(
        0,
        {
          size: { width: w, height: h, depthOrArrayLayers: 1 },
          format: this._format,
          usage: this._usage | 0x10,
          mipLevelCount: 1,
          sampleCount: 1,
          dimension: "2d",
        },
        true
      );
    } else {
      this._tex.width = w;
      this._tex.height = h;
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
  canvasContexts.set(canvas, ctx);
  return ctx;
}

class GPU {
  constructor() {
    this.wgslLanguageFeatures = new FeatureSet(WGSL_FEATURES);
  }
  requestAdapter() {
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
