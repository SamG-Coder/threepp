// Native WebGPU command ring. Little-endian, 4-byte fields, commands padded
// to 8 bytes. Header is always { u32 op, u32 bytes } (size includes header).
// Opcodes match native/webgpu/cmd_ops_webgpu.hpp. JS assigns handles from 1;
// handle 0 is the swapchain colour view.

const CAP = 8 * 1024 * 1024;

// Keep this protocol budget aligned with every native RTX scene decoder. A
// maximum-size update carries 8,192 affine 3x4 matrices plus visibility masks
// (about 416 KiB), comfortably below the 8 MiB command ring above.
export const RTX_MAX_INSTANCE_GROUP_CAPACITY = 8192;

export const OP = {
  NOP: 0,
  START: 1,
  RESIZE: 2,
  PRESENT: 3,
  SET_VSYNC: 4,
  BUF_CREATE: 10,
  BUF_WRITE: 11,
  BUF_DESTROY: 12,
  TEX_CREATE: 20,
  TEX_DESTROY: 21,
  TEX_VIEW: 22,
  TEX_WRITE: 23,
  SAMP_CREATE: 30,
  SHADER_CREATE: 40,
  BGL_CREATE: 41,
  PL_CREATE: 42,
  CPIPE_CREATE: 43,
  RPIPE_CREATE: 44,
  BG_CREATE: 45,
  ENC_BEGIN: 50,
  COMPUTE_BEGIN: 51,
  COMPUTE_PIPE: 52,
  COMPUTE_BG: 53,
  DISPATCH: 54,
  COMPUTE_END: 55,
  RENDER_BEGIN: 56,
  RENDER_PIPE: 57,
  RENDER_BG: 58,
  SET_VERTEX: 59,
  SET_INDEX: 60,
  DRAW: 61,
  DRAW_INDEXED: 62,
  RENDER_END: 63,
  SUBMIT: 64,
  COPY_BUF: 65,
  COPY_TEX: 66,
  PIPE_BGL: 67,
  SET_VIEWPORT: 68,
  SET_SCISSOR: 69,
  SET_STENCIL: 70,
  SET_BLEND: 71,
  DRAW_INDIRECT: 72,
  DRAW_INDEXED_INDIRECT: 73,
  DLSS_EVALUATE: 74,
  DLSSG_TAG: 75,
  RAY_RECONSTRUCTION_EVALUATE: 76,
  RTX_SCENE_BEGIN: 77,
  RTX_SCENE_POSITIONS: 78,
  RTX_SCENE_INDICES: 79,
  RTX_SCENE_COMMIT: 80,
  RTX_SCENE_DESTROY: 81,
  RTX_LIGHTING_EVALUATE: 82,
  RTX_SCENE_TRIANGLE_RADIANCE: 83,
  RTX_REFLECTIONS_EVALUATE: 84,
  RTX_SCENE_TRIANGLE_SURFACE: 85,
  RTX_SCENE_LIGHTS: 86,
  RTX_PIPELINE_CREATE: 87,
  RTX_PIPELINE_DESTROY: 88,
  RTX_SCENE_INSTANCE_GROUP: 89,
  RTX_INSTANCE_GROUP_UPDATE: 90,
  RTX_PIPELINE_CREATE_SOURCE: 91,
  RTX_DYNAMIC_MESH_CREATE: 92,
  RTX_DYNAMIC_MESH_REFIT: 93,
  RTX_DYNAMIC_MESH_DESTROY: 94,
};

// wgpu-native webgpu.h numeric enums (WGPUTextureFormat, …).
export const TEX_FORMAT = {
  undefined: 0,
  r8unorm: 1,
  r8snorm: 2,
  r8uint: 3,
  r8sint: 4,
  r16unorm: 5,
  r16snorm: 6,
  r16uint: 7,
  r16sint: 8,
  r16float: 9,
  rg8unorm: 10,
  rg8snorm: 11,
  rg8uint: 12,
  rg8sint: 13,
  r32float: 14,
  r32uint: 15,
  r32sint: 16,
  rg16unorm: 17,
  rg16snorm: 18,
  rg16uint: 19,
  rg16sint: 20,
  rg16float: 21,
  rgba8unorm: 22,
  "rgba8unorm-srgb": 23,
  rgba8snorm: 24,
  rgba8uint: 25,
  rgba8sint: 26,
  bgra8unorm: 27,
  "bgra8unorm-srgb": 28,
  rgb10a2uint: 29,
  rgb10a2unorm: 30,
  rg11b10ufloat: 31,
  rgb9e5ufloat: 32,
  rg32float: 33,
  rg32uint: 34,
  rg32sint: 35,
  rgba16unorm: 36,
  rgba16snorm: 37,
  rgba16uint: 38,
  rgba16sint: 39,
  rgba16float: 40,
  rgba32float: 41,
  rgba32uint: 42,
  rgba32sint: 43,
  stencil8: 44,
  depth16unorm: 45,
  depth24plus: 46,
  "depth24plus-stencil8": 47,
  depth32float: 48,
  "depth32float-stencil8": 49,
};

const VERTEX_FORMAT = {
  uint8: 1,
  uint8x2: 2,
  uint8x4: 3,
  sint8: 4,
  sint8x2: 5,
  sint8x4: 6,
  unorm8: 7,
  unorm8x2: 8,
  unorm8x4: 9,
  snorm8: 10,
  snorm8x2: 11,
  snorm8x4: 12,
  uint16: 13,
  uint16x2: 14,
  uint16x4: 15,
  sint16: 16,
  sint16x2: 17,
  sint16x4: 18,
  unorm16: 19,
  unorm16x2: 20,
  unorm16x4: 21,
  snorm16: 22,
  snorm16x2: 23,
  snorm16x4: 24,
  float16: 25,
  float16x2: 26,
  float16x4: 27,
  float32: 28,
  float32x2: 29,
  float32x3: 30,
  float32x4: 31,
  uint32: 32,
  uint32x2: 33,
  uint32x3: 34,
  uint32x4: 35,
  sint32: 36,
  sint32x2: 37,
  sint32x3: 38,
  sint32x4: 39,
  unorm10_10_10_2: 40,
  unorm8x4bgra: 41,
};

const TOPOLOGY = { "point-list": 1, "line-list": 2, "line-strip": 3, "triangle-list": 4, "triangle-strip": 5 };
const CULL = { none: 1, front: 2, back: 3 };
const FRONT = { ccw: 1, cw: 2 };
const COMPARE = {
  never: 1,
  less: 2,
  equal: 3,
  "less-equal": 4,
  greater: 5,
  "not-equal": 6,
  "greater-equal": 7,
  always: 8,
};
const ADDR = { "clamp-to-edge": 1, repeat: 2, "mirror-repeat": 3 };
const FILTER = { nearest: 1, linear: 2 };
const TEX_DIM = { "1d": 1, "2d": 2, "3d": 3 };
const VIEW_DIM = { "1d": 1, "2d": 2, "2d-array": 3, cube: 4, "cube-array": 5, "3d": 6 };
const ASPECT = { all: 1, "stencil-only": 2, "depth-only": 3 };
const LOAD = { load: 1, clear: 2 };
const STORE = { store: 1, discard: 2 };
const INDEX_FMT = { uint16: 1, uint32: 2 };
const STEP = { vertex: 1, instance: 2 };
const BUF_TYPE = { uniform: 2, storage: 3, "read-only-storage": 4 };
const SAMP_TYPE = { filtering: 2, "non-filtering": 3, comparison: 4 };
const SAMPLE_TYPE = { float: 2, "unfilterable-float": 3, depth: 4, sint: 5, uint: 6 };
const ST_ACCESS = { "write-only": 2, "read-only": 3, "read-write": 4 };
const STENCIL_OP = {
  keep: 1,
  zero: 2,
  replace: 3,
  invert: 4,
  "increment-clamp": 5,
  "decrement-clamp": 6,
  "increment-wrap": 7,
  "decrement-wrap": 8,
};
const BLEND_FACTOR = {
  zero: 1,
  one: 2,
  src: 3,
  "one-minus-src": 4,
  "src-alpha": 5,
  "one-minus-src-alpha": 6,
  dst: 7,
  "one-minus-dst": 8,
  "dst-alpha": 9,
  "one-minus-dst-alpha": 10,
  "src-alpha-saturated": 11,
  constant: 12,
  "one-minus-constant": 13,
};
const BLEND_OP = { add: 1, subtract: 2, "reverse-subtract": 3, min: 4, max: 5 };
const COPY_KIND = { tex2buf: 0, buf2tex: 1, tex2tex: 2 };

let ab = new ArrayBuffer(CAP);
let u8 = new Uint8Array(ab);
let u32 = new Uint32Array(ab);
let f32 = new Float32Array(ab);
let off = 0;
let nextId = 1;
let shared = false;
let pendingSubmit = false;
let deferredSubmit = false;
let hostCache = null;
let lastAttached = null;
let hostSession = 0;

function host() {
  if (hostCache) return hostCache;
  hostCache = globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  return hostCache;
}

function hostHas(n, name) {
  if (!n) return false;
  try {
    return typeof n[name] === "function";
  } catch {
    return false;
  }
}

function views() {
  u8 = new Uint8Array(ab);
  u32 = new Uint32Array(ab);
  f32 = new Float32Array(ab);
}

function align8(n) {
  return (n + 7) & ~7;
}

function enu(map, v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "number") return v >>> 0;
  const n = map[v];
  return n == null ? fallback : n;
}

export function formatNum(name) {
  if (name == null) return 0;
  if (typeof name === "number") return name >>> 0;
  const n = TEX_FORMAT[name];
  return n == null ? 0 : n;
}

function bytesToB64(src) {
  let s = "";
  const n = 0x8000;
  for (let i = 0; i < src.length; i += n) {
    s += String.fromCharCode.apply(null, src.subarray(i, i + n));
  }
  return btoa(s);
}

function asU8(src) {
  if (!src) return new Uint8Array(0);
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) {
    return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  }
  return new Uint8Array(src);
}

function utf8(str) {
  return new TextEncoder().encode(str || "");
}

function submitNow(force = false) {
  if (off <= 0) return;
  if (globalThis.__threeBrowserNativeRuntime && !force) {
    if (!deferredSubmit) {
      deferredSubmit = true;
      const flush = () => {
        deferredSubmit = false;
        submitNow(true);
      };
      if (typeof setImmediate === "function") setImmediate(flush);
      else setTimeout(flush, 0);
    }
    return;
  }
  deferredSubmit = false;
  const n = host();
  const used = off;
  if (!shared) {
    const b64 = bytesToB64(u8.subarray(0, used));
    const copy = hostHas(n, "WebGpuCmdSubmitB64")
      ? n.WebGpuCmdSubmitB64
      : hostHas(n, "CmdSubmitB64")
        ? n.CmdSubmitB64
        : null;
    if (copy) {
      try {
        copy.call(n, b64);
        off = 0;
        pendingSubmit = false;
        return;
      } catch (err) {
        console.warn("ThreeBrowser WebGPU cmd submit copy failed", err);
      }
    }
    pendingSubmit = true;
    if (hostHas(n, "EnsureCmdBuffer")) {
      try {
        n.EnsureCmdBuffer();
      } catch {
        /* sharedbufferreceived is async */
      }
    }
    return;
  }
  const submit = hostHas(n, "WebGpuCmdSubmit")
    ? n.WebGpuCmdSubmit.bind(n)
    : hostHas(n, "CmdSubmit")
      ? n.CmdSubmit.bind(n)
      : null;
  let submittedForSession = false;
  try {
    if (hostSession === 0) hostSession = n.WebGpuSession() | 0;
    if (hostSession !== 0) {
      n.WebGpuCmdSubmitSession(used, hostSession);
      submittedForSession = true;
    }
  } catch {
    /* older hosts fall through to the legacy endpoint */
  }
  if (!submit && !submittedForSession) {
    off = 0;
    return;
  }
  off = 0;
  pendingSubmit = false;
  if (!submittedForSession) {
    submit(used);
  }
}

function need(bytes) {
  bytes = align8(bytes);
  if (off + bytes <= ab.byteLength) return;
  submitNow(true);
  if (off + bytes > ab.byteLength) {
    throw new Error("ThreeBrowser WebGPU cmd buffer overflow");
  }
}

function begin(op, payload) {
  const size = align8(8 + payload);
  need(size);
  const start = off;
  u32[off >> 2] = op >>> 0;
  u32[(off >> 2) + 1] = size >>> 0;
  off += 8;
  return start;
}

function end(start) {
  off = start + u32[(start >> 2) + 1];
}

function wu32(v) {
  u32[off >> 2] = v >>> 0;
  off += 4;
}

function wf32(v) {
  f32[off >> 2] = +v;
  off += 4;
}

function wbytes(src) {
  const bytes = asU8(src);
  if (!bytes.byteLength) return;
  u8.set(bytes, off);
  off += bytes.byteLength;
}

function allocHandle() {
  return nextId++;
}

function attach(buffer) {
  if (!buffer || !(buffer instanceof ArrayBuffer)) return;
  if (buffer === lastAttached) {
    shared = true;
    if (pendingSubmit) submitNow(true);
    return;
  }
  if (off > 0 && buffer.byteLength >= off) {
    new Uint8Array(buffer).set(u8.subarray(0, off));
  }
  ab = buffer;
  lastAttached = buffer;
  views();
  shared = true;
  if (pendingSubmit) submitNow(true);
}

function maxPayload() {
  return ab.byteLength - 64;
}

function writeChunks(writeOne, handle, offset, data) {
  const src = asU8(data);
  let done = 0;
  while (done < src.byteLength) {
    const room = Math.max(16, maxPayload() - 32);
    const n = Math.min(src.byteLength - done, room);
    writeOne(handle, (offset + done) >>> 0, src.subarray(done, done + n));
    done += n;
  }
}

// Payload layouts after the 8-byte header. Native must match these.

function nop() {
  const s = begin(OP.NOP, 0);
  end(s);
}

function start(w, h) {
  const s = begin(OP.START, 8);
  wu32(w);
  wu32(h);
  end(s);
}

function resize(w, h) {
  const s = begin(OP.RESIZE, 8);
  wu32(w);
  wu32(h);
  end(s);
}

function present() {
  const s = begin(OP.PRESENT, 0);
  end(s);
}

function setVsync(enabled) {
  const s = begin(OP.SET_VSYNC, 8);
  wu32(enabled ? 1 : 0);
  wu32(0);
  end(s);
}

// BUF_CREATE: u32 handle, usage, size, mappedAtCreation
function bufCreate(handle, size, usage, mappedAtCreation) {
  const s = begin(OP.BUF_CREATE, 16);
  wu32(handle);
  wu32(usage);
  wu32(size);
  wu32(mappedAtCreation ? 1 : 0);
  end(s);
}

// BUF_WRITE: u32 handle, offset, size, pad, u8 data[size]
function bufWrite(handle, offset, data) {
  const src = asU8(data);
  if (src.byteLength + 16 > maxPayload()) {
    writeChunks((h, o, chunk) => bufWrite(h, o, chunk), handle, offset, src);
    return;
  }
  const s = begin(OP.BUF_WRITE, 16 + src.byteLength);
  wu32(handle);
  wu32(offset);
  wu32(src.byteLength);
  wu32(0);
  wbytes(src);
  end(s);
}

function bufDestroy(handle) {
  const s = begin(OP.BUF_DESTROY, 8);
  wu32(handle);
  wu32(0);
  end(s);
}

// TEX_CREATE: handle, w, h, depth, format, usage, dimension, mips, samples, pad
function texCreate(handle, desc) {
  const size = desc.size || desc;
  const w = (size.width ?? size[0] ?? 1) >>> 0;
  const h = (size.height ?? size[1] ?? 1) >>> 0;
  const d = (size.depthOrArrayLayers ?? size.depth ?? size[2] ?? 1) >>> 0;
  const s = begin(OP.TEX_CREATE, 40);
  wu32(handle);
  wu32(w);
  wu32(h);
  wu32(d);
  wu32(formatNum(desc.format));
  wu32(desc.usage >>> 0);
  wu32(enu(TEX_DIM, desc.dimension || "2d", 2));
  wu32((desc.mipLevelCount ?? 1) >>> 0);
  wu32((desc.sampleCount ?? 1) >>> 0);
  wu32(0);
  end(s);
}

function texDestroy(handle) {
  const s = begin(OP.TEX_DESTROY, 8);
  wu32(handle);
  wu32(0);
  end(s);
}

// TEX_VIEW: view, tex, format, dimension, aspect, baseMip, mipCount, baseLayer, layerCount, pad
function texView(viewHandle, texHandle, desc) {
  desc = desc || {};
  const s = begin(OP.TEX_VIEW, 40);
  wu32(viewHandle);
  wu32(texHandle);
  wu32(formatNum(desc.format));
  wu32(enu(VIEW_DIM, desc.dimension, 0));
  wu32(enu(ASPECT, desc.aspect || "all", 1));
  wu32((desc.baseMipLevel ?? 0) >>> 0);
  wu32((desc.mipLevelCount ?? 0xffffffff) >>> 0);
  wu32((desc.baseArrayLayer ?? 0) >>> 0);
  wu32((desc.arrayLayerCount ?? 0xffffffff) >>> 0);
  wu32(0);
  end(s);
}

// TEX_WRITE: handle, mip, x,y,z, w,h,d, bytesPerRow, rowsPerImage, dataSize, pad, data
function texWrite(handle, mip, origin, size, data, bytesPerRow, rowsPerImage) {
  const src = asU8(data);
  const ox = (origin?.x ?? origin?.[0] ?? 0) >>> 0;
  const oy = (origin?.y ?? origin?.[1] ?? 0) >>> 0;
  const oz = (origin?.z ?? origin?.[2] ?? 0) >>> 0;
  const w = (size?.width ?? size?.[0] ?? 1) >>> 0;
  const h = (size?.height ?? size?.[1] ?? 1) >>> 0;
  const d = (size?.depthOrArrayLayers ?? size?.[2] ?? 1) >>> 0;
  const bpr = (bytesPerRow ?? 0) >>> 0;
  const rpi = (rowsPerImage ?? 0) >>> 0;
  const header = 48;
  if (src.byteLength + header > maxPayload() && h > 1 && bpr > 0) {
    const maxRows = Math.max(1, Math.floor((maxPayload() - header) / bpr));
    let y = 0;
    let offBytes = 0;
    while (y < h) {
      const rows = Math.min(maxRows, h - y);
      const n = rows * bpr;
      texWrite(
        handle,
        mip,
        { x: ox, y: oy + y, z: oz },
        { width: w, height: rows, depthOrArrayLayers: 1 },
        src.subarray(offBytes, offBytes + n),
        bpr,
        rpi
      );
      y += rows;
      offBytes += n;
    }
    return;
  }
  const s = begin(OP.TEX_WRITE, header + src.byteLength);
  wu32(handle);
  wu32(mip >>> 0);
  wu32(ox);
  wu32(oy);
  wu32(oz);
  wu32(w);
  wu32(h);
  wu32(d);
  wu32(bpr);
  wu32(rpi);
  wu32(src.byteLength);
  wu32(0);
  wbytes(src);
  end(s);
}

// SAMP_CREATE: handle, addrUVW, mag/min/mip, compare, maxAniso, lodMin, lodMax, pad
function sampCreate(handle, desc) {
  desc = desc || {};
  const s = begin(OP.SAMP_CREATE, 48);
  wu32(handle);
  wu32(enu(ADDR, desc.addressModeU || "clamp-to-edge", 1));
  wu32(enu(ADDR, desc.addressModeV || "clamp-to-edge", 1));
  wu32(enu(ADDR, desc.addressModeW || "clamp-to-edge", 1));
  wu32(enu(FILTER, desc.magFilter || "nearest", 1));
  wu32(enu(FILTER, desc.minFilter || "nearest", 1));
  wu32(enu(FILTER, desc.mipmapFilter || "nearest", 1));
  wu32(enu(COMPARE, desc.compare, 0));
  wu32((desc.maxAnisotropy ?? 1) >>> 0);
  wf32(desc.lodMinClamp ?? 0);
  wf32(desc.lodMaxClamp ?? 32);
  wu32(0);
  end(s);
}

// SHADER_CREATE: handle, codeBytes, utf8 wgsl
function shaderCreate(handle, code) {
  const bytes = typeof code === "string" ? utf8(code) : asU8(code);
  const s = begin(OP.SHADER_CREATE, 8 + bytes.byteLength);
  wu32(handle);
  wu32(bytes.byteLength);
  wbytes(bytes);
  end(s);
}

function bglKind(entry) {
  if (entry.buffer) return 0;
  if (entry.sampler) return 1;
  // ThreeBrowser lowers texture_external to a persistent RGBA texture for its
  // Windows camera compatibility path. It therefore uses an ordinary sampled
  // texture binding in the native WebGPU layout.
  if (entry.texture || entry.externalTexture) return 2;
  if (entry.storageTexture) return 3;
  return 0;
}

// BGL_CREATE: handle, count, then per entry 6×u32
// kind 0 buffer: type, hasDynamicOffset, minBindingSize
// kind 1 sampler: type, 0, 0
// kind 2 texture: sampleType, viewDimension, multisampled
// kind 3 storageTexture: access, format, viewDimension
function bglCreate(handle, entries) {
  entries = entries || [];
  const s = begin(OP.BGL_CREATE, 8 + entries.length * 24);
  wu32(handle);
  wu32(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const kind = bglKind(e);
    wu32(e.binding >>> 0);
    wu32(e.visibility >>> 0);
    wu32(kind);
    if (kind === 0) {
      const b = e.buffer || {};
      wu32(enu(BUF_TYPE, b.type || "uniform", 2));
      wu32(b.hasDynamicOffset ? 1 : 0);
      wu32((b.minBindingSize ?? 0) >>> 0);
    } else if (kind === 1) {
      const sm = e.sampler || {};
      wu32(enu(SAMP_TYPE, sm.type || "filtering", 2));
      wu32(0);
      wu32(0);
    } else if (kind === 2) {
      const t = e.texture || e.externalTexture || {};
      wu32(enu(SAMPLE_TYPE, t.sampleType || "float", 2));
      wu32(enu(VIEW_DIM, t.viewDimension || "2d", 2));
      wu32(t.multisampled ? 1 : 0);
    } else {
      const st = e.storageTexture || {};
      wu32(enu(ST_ACCESS, st.access || "write-only", 2));
      wu32(formatNum(st.format));
      wu32(enu(VIEW_DIM, st.viewDimension || "2d", 2));
    }
  }
  end(s);
}

// PL_CREATE: handle, count, u32 bgl[count]
function plCreate(handle, layouts) {
  layouts = layouts || [];
  const s = begin(OP.PL_CREATE, 8 + layouts.length * 4);
  wu32(handle);
  wu32(layouts.length);
  for (let i = 0; i < layouts.length; i++) wu32(layouts[i] >>> 0);
  end(s);
}

function wEntryPoint(str) {
  const bytes = utf8(str || "main");
  wu32(bytes.byteLength);
  wbytes(bytes);
  const pad = (4 - (bytes.byteLength & 3)) & 3;
  for (let i = 0; i < pad; i++) u8[off++] = 0;
}

function entryPointBytes(str) {
  const n = utf8(str || "main").byteLength;
  return 4 + n + ((4 - (n & 3)) & 3);
}

// CPIPE_CREATE: handle, layout, shader, entryPoint
function cpipeCreate(handle, layoutHandle, shaderHandle, entryPoint) {
  const s = begin(OP.CPIPE_CREATE, 12 + entryPointBytes(entryPoint));
  wu32(handle);
  wu32(layoutHandle >>> 0);
  wu32(shaderHandle >>> 0);
  wEntryPoint(entryPoint);
  end(s);
}

function rpipePayload(desc) {
  let n = 16;
  n += entryPointBytes(desc.vertex?.entryPoint);
  n += entryPointBytes(desc.fragment?.entryPoint);
  n += 68;
  const targets = desc.fragment?.targets || [];
  n += 4;
  for (let i = 0; i < targets.length; i++) {
    n += 12;
    if (targets[i]?.blend) n += 24;
  }
  const vbs = desc.vertex?.buffers || [];
  n += 4;
  for (let i = 0; i < vbs.length; i++) {
    const attrs = vbs[i]?.attributes || [];
    n += 12 + attrs.length * 12;
  }
  return n;
}

// RPIPE_CREATE: handle, layout, vs, fs, vsEntry, fsEntry,
// topology, cull, frontFace, stripIndex, sampleCount, alphaToCoverage, pad
// hasDepth, dsFormat, depthWrite, depthCompare, stencilFront×4, stencilRead, stencilWrite
// colorCount, {format, writeMask, hasBlend, [6 blend u32]}*
// vbCount, {stride, step, attrCount, {loc, offset, format}*}*
function rpipeCreate(handle, desc) {
  desc = desc || {};
  const vs = desc.vertex || {};
  const fs = desc.fragment;
  const prim = desc.primitive || {};
  const ms = desc.multisample || {};
  const ds = desc.depthStencil;
  const s = begin(OP.RPIPE_CREATE, rpipePayload(desc));
  wu32(handle);
  wu32((desc.layoutHandle ?? 0) >>> 0);
  wu32((vs.moduleHandle ?? 0) >>> 0);
  wu32((fs?.moduleHandle ?? 0) >>> 0);
  wEntryPoint(vs.entryPoint);
  wEntryPoint(fs?.entryPoint);
  wu32(enu(TOPOLOGY, prim.topology || "triangle-list", 4));
  wu32(enu(CULL, prim.cullMode || "none", 1));
  wu32(enu(FRONT, prim.frontFace || "ccw", 1));
  wu32(enu(INDEX_FMT, prim.stripIndexFormat, 0));
  wu32((ms.count ?? 1) >>> 0);
  wu32(ms.alphaToCoverageEnabled ? 1 : 0);
  wu32(0);
  wu32(ds ? 1 : 0);
  wu32(formatNum(ds?.format));
  wu32(ds && ds.depthWriteEnabled === false ? 0 : 1);
  wu32(enu(COMPARE, ds?.depthCompare || "less", 2));
  const front = ds?.stencilFront || {};
  wu32(enu(COMPARE, front.compare || "always", 8));
  wu32(enu(STENCIL_OP, front.failOp || "keep", 1));
  wu32(enu(STENCIL_OP, front.depthFailOp || "keep", 1));
  wu32(enu(STENCIL_OP, front.passOp || "keep", 1));
  wu32((ds?.stencilReadMask ?? 0xffffffff) >>> 0);
  wu32((ds?.stencilWriteMask ?? 0xffffffff) >>> 0);
  const targets = fs?.targets || [];
  wu32(targets.length);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i] || {};
    wu32(formatNum(t.format));
    wu32((t.writeMask ?? 0xf) >>> 0);
    const blend = t.blend;
    wu32(blend ? 1 : 0);
    if (blend) {
      const c = blend.color || {};
      const a = blend.alpha || {};
      wu32(enu(BLEND_FACTOR, c.srcFactor || "one", 2));
      wu32(enu(BLEND_FACTOR, c.dstFactor || "zero", 1));
      wu32(enu(BLEND_OP, c.operation || "add", 1));
      wu32(enu(BLEND_FACTOR, a.srcFactor || "one", 2));
      wu32(enu(BLEND_FACTOR, a.dstFactor || "zero", 1));
      wu32(enu(BLEND_OP, a.operation || "add", 1));
    }
  }
  const vbs = vs.buffers || [];
  wu32(vbs.length);
  for (let i = 0; i < vbs.length; i++) {
    const vb = vbs[i] || {};
    const attrs = vb.attributes || [];
    wu32((vb.arrayStride ?? 0) >>> 0);
    wu32(enu(STEP, vb.stepMode || "vertex", 1));
    wu32(attrs.length);
    for (let j = 0; j < attrs.length; j++) {
      const at = attrs[j] || {};
      wu32((at.shaderLocation ?? 0) >>> 0);
      wu32((at.offset ?? 0) >>> 0);
      wu32(enu(VERTEX_FORMAT, at.format, 31));
    }
  }
  end(s);
}

// BG_CREATE: handle, layout, count, {binding, kind, resource, offset, size}*
// kind 0 buffer, 1 sampler, 2 textureView. size 0 = whole buffer.
function bgCreate(handle, layoutHandle, entries) {
  entries = entries || [];
  const s = begin(OP.BG_CREATE, 12 + entries.length * 20);
  wu32(handle);
  wu32(layoutHandle >>> 0);
  wu32(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    wu32(e.binding >>> 0);
    wu32(e.kind >>> 0);
    wu32(e.resource >>> 0);
    wu32((e.offset ?? 0) >>> 0);
    wu32((e.size ?? 0) >>> 0);
  }
  end(s);
}

function encBegin(handle) {
  const s = begin(OP.ENC_BEGIN, 8);
  wu32(handle);
  wu32(0);
  end(s);
}

function computeBegin(encoder) {
  const s = begin(OP.COMPUTE_BEGIN, 8);
  wu32(encoder);
  wu32(0);
  end(s);
}

function computePipe(encoder, pipeline) {
  const s = begin(OP.COMPUTE_PIPE, 8);
  wu32(encoder);
  wu32(pipeline);
  end(s);
}

function writeBindGroup(op, encoder, index, bindGroup, dyn) {
  dyn = dyn || [];
  const s = begin(op, 16 + dyn.length * 4);
  wu32(encoder);
  wu32(index >>> 0);
  wu32(bindGroup >>> 0);
  wu32(dyn.length);
  for (let i = 0; i < dyn.length; i++) wu32(dyn[i] >>> 0);
  end(s);
}

function computeBg(encoder, index, bindGroup, dyn) {
  writeBindGroup(OP.COMPUTE_BG, encoder, index, bindGroup, dyn);
}

function dispatch(encoder, x, y, z) {
  const s = begin(OP.DISPATCH, 16);
  wu32(encoder);
  wu32(x >>> 0);
  wu32((y ?? 1) >>> 0);
  wu32((z ?? 1) >>> 0);
  end(s);
}

function computeEnd(encoder) {
  const s = begin(OP.COMPUTE_END, 8);
  wu32(encoder);
  wu32(0);
  end(s);
}

function xyz(v, key, i) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v[i] ?? 0;
  return v[key] ?? 0;
}

function colorVal(c, k, i, d) {
  if (!c) return d;
  if (typeof c[k] === "number") return c[k];
  if (Array.isArray(c)) return c[i] ?? d;
  return d;
}

// RENDER_BEGIN: encoder, colorCount, depthView, depthLoad, depthStore, depthClear,
// stencilLoad, stencilStore, stencilClear, pad
// then colors: view, resolve, load, store, r,g,b,a  (view 0 = swapchain)
function renderBegin(encoder, desc) {
  desc = desc || {};
  const colors = desc.colorAttachments || [];
  const depth = desc.depthStencilAttachment;
  const s = begin(OP.RENDER_BEGIN, 40 + colors.length * 32);
  wu32(encoder);
  wu32(colors.length);
  wu32((depth?.viewHandle ?? 0) >>> 0);
  wu32(enu(LOAD, depth?.depthLoadOp || (depth ? "clear" : "load"), 1));
  wu32(enu(STORE, depth?.depthStoreOp || "store", 1));
  wf32(depth?.depthClearValue ?? 1);
  wu32(enu(LOAD, depth?.stencilLoadOp || "clear", 2));
  wu32(enu(STORE, depth?.stencilStoreOp || "store", 1));
  wu32((depth?.stencilClearValue ?? 0) >>> 0);
  wu32(depth ? 1 : 0);
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i] || {};
    wu32((c.viewHandle ?? 0) >>> 0);
    wu32((c.resolveHandle ?? 0) >>> 0);
    wu32(enu(LOAD, c.loadOp || "load", 1));
    wu32(enu(STORE, c.storeOp || "store", 1));
    const cv = c.clearValue;
    wf32(colorVal(cv, "r", 0, 0));
    wf32(colorVal(cv, "g", 1, 0));
    wf32(colorVal(cv, "b", 2, 0));
    wf32(colorVal(cv, "a", 3, 1));
  }
  end(s);
}

function renderPipe(encoder, pipeline) {
  const s = begin(OP.RENDER_PIPE, 8);
  wu32(encoder);
  wu32(pipeline);
  end(s);
}

function renderBg(encoder, index, bindGroup, dyn) {
  writeBindGroup(OP.RENDER_BG, encoder, index, bindGroup, dyn);
}

// SET_VERTEX: encoder, slot, buffer, offset, size (0 = whole)
function setVertex(encoder, slot, buffer, offset, size) {
  const s = begin(OP.SET_VERTEX, 24);
  wu32(encoder);
  wu32(slot >>> 0);
  wu32(buffer >>> 0);
  wu32((offset ?? 0) >>> 0);
  wu32((size ?? 0) >>> 0);
  wu32(0);
  end(s);
}

// SET_INDEX: encoder, buffer, format, offset, size, pad
function setIndex(encoder, buffer, format, offset, size) {
  const s = begin(OP.SET_INDEX, 24);
  wu32(encoder);
  wu32(buffer >>> 0);
  wu32(enu(INDEX_FMT, format, 2));
  wu32((offset ?? 0) >>> 0);
  wu32((size ?? 0) >>> 0);
  wu32(0);
  end(s);
}

function draw(encoder, vertexCount, instanceCount, firstVertex, firstInstance) {
  const s = begin(OP.DRAW, 24);
  wu32(encoder);
  wu32(vertexCount >>> 0);
  wu32((instanceCount ?? 1) >>> 0);
  wu32((firstVertex ?? 0) >>> 0);
  wu32((firstInstance ?? 0) >>> 0);
  wu32(0);
  end(s);
}

function drawIndexed(encoder, indexCount, instanceCount, firstIndex, baseVertex, firstInstance) {
  const s = begin(OP.DRAW_INDEXED, 24);
  wu32(encoder);
  wu32(indexCount >>> 0);
  wu32((instanceCount ?? 1) >>> 0);
  wu32((firstIndex ?? 0) >>> 0);
  wu32(baseVertex ?? 0);
  wu32((firstInstance ?? 0) >>> 0);
  end(s);
}

function setViewport(encoder, x, y, width, height, minDepth, maxDepth) {
  const s = begin(OP.SET_VIEWPORT, 28);
  wu32(encoder);
  wf32(x); wf32(y); wf32(width); wf32(height); wf32(minDepth); wf32(maxDepth);
  end(s);
}

function setScissor(encoder, x, y, width, height) {
  const s = begin(OP.SET_SCISSOR, 20);
  wu32(encoder);
  wu32(x); wu32(y); wu32(width); wu32(height);
  end(s);
}

function setStencil(encoder, reference) {
  const s = begin(OP.SET_STENCIL, 8);
  wu32(encoder); wu32(reference);
  end(s);
}

function setBlend(encoder, color) {
  const s = begin(OP.SET_BLEND, 20);
  wu32(encoder);
  wf32(colorVal(color, "r", 0, 0));
  wf32(colorVal(color, "g", 1, 0));
  wf32(colorVal(color, "b", 2, 0));
  wf32(colorVal(color, "a", 3, 0));
  end(s);
}

function drawIndirect(encoder, buffer, offset, indexed) {
  const s = begin(indexed ? OP.DRAW_INDEXED_INDIRECT : OP.DRAW_INDIRECT, 12);
  wu32(encoder); wu32(buffer); wu32(offset ?? 0);
  end(s);
}

function renderEnd(encoder) {
  const s = begin(OP.RENDER_END, 8);
  wu32(encoder);
  wu32(0);
  end(s);
}

// DLSS_EVALUATE is recorded between ENC_BEGIN and SUBMIT. Keeping evaluation
// in the command stream is required: the native encoder does not exist until
// the worker replays ENC_BEGIN and is released by SUBMIT.
function dlssEvaluate(encoder, frame) {
  const resources = [
    frame.colorInput,
    frame.colorOutput,
    frame.depth,
    frame.motionVectors,
    frame.exposure,
  ];
  const constants = frame.constants;
  const s = begin(OP.DLSS_EVALUATE, 568);
  wu32(encoder);
  wu32(frame.viewport >>> 0);
  for (const resource of resources) {
    wu32((resource?.textureHandle ?? 0) >>> 0);
    wu32((resource?.vulkanLayout ?? 0) >>> 0);
    wu32((resource?.left ?? 0) >>> 0);
    wu32((resource?.top ?? 0) >>> 0);
    wu32((resource?.width ?? 0) >>> 0);
    wu32((resource?.height ?? 0) >>> 0);
  }
  wu32(frame.exposure ? 1 : 0);
  for (const values of [
    constants.cameraViewToClip,
    constants.clipToCameraView,
    constants.clipToLensClip,
    constants.clipToPrevClip,
    constants.prevClipToClip,
    constants.jitterOffset,
    constants.motionVectorScale,
    constants.cameraPinholeOffset,
    constants.cameraPosition,
    constants.cameraUp,
    constants.cameraRight,
    constants.cameraForward,
  ]) {
    for (const value of values) wf32(value);
  }
  wf32(constants.cameraNear);
  wf32(constants.cameraFar);
  wf32(constants.cameraFov);
  wf32(constants.cameraAspectRatio);
  wu32(constants.depthInverted ? 1 : 0);
  wu32(constants.cameraMotionIncluded ? 1 : 0);
  wu32(constants.motionVectors3D ? 1 : 0);
  wu32(constants.reset ? 1 : 0);
  wu32(constants.orthographicProjection ? 1 : 0);
  wu32(constants.motionVectorsDilated ? 1 : 0);
  wu32(constants.motionVectorsJittered ? 1 : 0);
  end(s);
}

// DLSS-G consumes these tags during the Present that follows submission.  The
// native bridge therefore keeps the resources valid-until-present and proves
// ACTIVE only from the state reported after that Present.
function frameGenerationTag(encoder, frame) {
  const resources = [
    frame.hudlessColor,
    frame.depth,
    frame.motionVectors,
    frame.ui,
  ];
  const constants = frame.constants;
  const s = begin(OP.DLSSG_TAG, 552);
  wu32(encoder);
  wu32(frame.viewport >>> 0);
  for (const resource of resources) {
    wu32((resource?.textureHandle ?? 0) >>> 0);
    wu32((resource?.vulkanLayout ?? 0) >>> 0);
    wu32((resource?.left ?? 0) >>> 0);
    wu32((resource?.top ?? 0) >>> 0);
    wu32((resource?.width ?? 0) >>> 0);
    wu32((resource?.height ?? 0) >>> 0);
  }
  wu32(frame.ui ? 1 : 0);
  wu32(frame.uiAlphaOnly ? 1 : 0);
  wu32(frame.framesToGenerate >>> 0);
  for (const values of [
    constants.cameraViewToClip,
    constants.clipToCameraView,
    constants.clipToLensClip,
    constants.clipToPrevClip,
    constants.prevClipToClip,
    constants.jitterOffset,
    constants.motionVectorScale,
    constants.cameraPinholeOffset,
    constants.cameraPosition,
    constants.cameraUp,
    constants.cameraRight,
    constants.cameraForward,
  ]) {
    for (const value of values) wf32(value);
  }
  wf32(constants.cameraNear);
  wf32(constants.cameraFar);
  wf32(constants.cameraFov);
  wf32(constants.cameraAspectRatio);
  wu32(constants.depthInverted ? 1 : 0);
  wu32(constants.cameraMotionIncluded ? 1 : 0);
  wu32(constants.motionVectors3D ? 1 : 0);
  wu32(constants.reset ? 1 : 0);
  wu32(constants.orthographicProjection ? 1 : 0);
  wu32(constants.motionVectorsDilated ? 1 : 0);
  wu32(constants.motionVectorsJittered ? 1 : 0);
  end(s);
}

// Ray Reconstruction is intentionally a separate raw-only command.  The ten
// resources and their current Vulkan layouts are validated again natively
// before Streamline sees them.
function rayReconstructionEvaluate(encoder, frame) {
  const resources = [
    frame.noisyColor,
    frame.colorOutput,
    frame.depth,
    frame.motionVectors,
    frame.diffuseAlbedo,
    frame.specularAlbedo,
    frame.normalRoughness,
    frame.roughness,
    frame.specularMotionVectors,
    frame.specularHitDistance,
  ];
  const constants = frame.constants;
  const s = begin(OP.RAY_RECONSTRUCTION_EVALUATE, 828);
  wu32(encoder);
  wu32(frame.viewport >>> 0);
  for (const resource of resources) {
    wu32((resource?.textureHandle ?? 0) >>> 0);
    wu32((resource?.vulkanLayout ?? 0) >>> 0);
    wu32((resource?.left ?? 0) >>> 0);
    wu32((resource?.top ?? 0) >>> 0);
    wu32((resource?.width ?? 0) >>> 0);
    wu32((resource?.height ?? 0) >>> 0);
  }
  wu32(frame.normalRoughnessPacked ? 1 : 0);
  wu32(frame.roughness ? 1 : 0);
  wu32(frame.specularMotionVectors ? 1 : 0);
  wu32(frame.specularHitDistance ? 1 : 0);
  for (const values of [frame.worldToCameraView, frame.cameraViewToWorld]) {
    for (const value of values) wf32(value);
  }
  for (const values of [
    constants.cameraViewToClip,
    constants.clipToCameraView,
    constants.clipToLensClip,
    constants.clipToPrevClip,
    constants.prevClipToClip,
    constants.jitterOffset,
    constants.motionVectorScale,
    constants.cameraPinholeOffset,
    constants.cameraPosition,
    constants.cameraUp,
    constants.cameraRight,
    constants.cameraForward,
  ]) {
    for (const value of values) wf32(value);
  }
  wf32(constants.cameraNear);
  wf32(constants.cameraFar);
  wf32(constants.cameraFov);
  wf32(constants.cameraAspectRatio);
  wu32(constants.depthInverted ? 1 : 0);
  wu32(constants.cameraMotionIncluded ? 1 : 0);
  wu32(constants.motionVectors3D ? 1 : 0);
  wu32(constants.reset ? 1 : 0);
  wu32(constants.orthographicProjection ? 1 : 0);
  wu32(constants.motionVectorsDilated ? 1 : 0);
  wu32(constants.motionVectorsJittered ? 1 : 0);
  end(s);
}

// Version 1 of the native ray-query bridge owns a single world-space static
// triangle scene. Scene upload is recorded in the same command buffer as the
// Vulkan BLAS/TLAS build so no mesh bytes cross the bridge on later frames.
const RTX_PROTOCOL_VERSION = 1;
const RTX_DYNAMIC_MESH_CREATE_PROTOCOL_VERSION = 2;
const RTX_EVALUATION_PROTOCOL_VERSION = 2;
const RTX_PIPELINE_PROTOCOL_VERSION = 1;

function rtxSceneBegin() {
  const s = begin(OP.RTX_SCENE_BEGIN, 4);
  wu32(RTX_PROTOCOL_VERSION);
  end(s);
}

function rtxScenePositions(positions) {
  const src = asU8(positions);
  if ((src.byteLength % 12) !== 0) {
    throw new RangeError("RTX scene positions must contain tightly packed vec3<f32> values");
  }
  const chunkBytes = Math.floor((maxPayload() - 8) / 12) * 12;
  if (chunkBytes <= 0) throw new RangeError("Native command buffer is too small for an RTX position chunk");
  for (let offset = 0; offset < src.byteLength; offset += chunkBytes) {
    const chunk = src.subarray(offset, Math.min(offset + chunkBytes, src.byteLength));
    const s = begin(OP.RTX_SCENE_POSITIONS, 8 + chunk.byteLength);
    wu32(RTX_PROTOCOL_VERSION);
    wu32(chunk.byteLength / 12);
    wbytes(chunk);
    end(s);
  }
}

function rtxSceneIndices(indices) {
  const src = asU8(indices);
  if ((src.byteLength % 4) !== 0) {
    throw new RangeError("RTX scene indices must contain tightly packed uint32 values");
  }
  // Keep whole triangle triplets together even though native accepts each
  // u32 independently; this makes partial/corrupt uploads impossible to use.
  const chunkBytes = Math.floor((maxPayload() - 8) / 12) * 12;
  if (chunkBytes <= 0) throw new RangeError("Native command buffer is too small for an RTX index chunk");
  for (let offset = 0; offset < src.byteLength; offset += chunkBytes) {
    const chunk = src.subarray(offset, Math.min(offset + chunkBytes, src.byteLength));
    const s = begin(OP.RTX_SCENE_INDICES, 8 + chunk.byteLength);
    wu32(RTX_PROTOCOL_VERSION);
    wu32(chunk.byteLength / 4);
    wbytes(chunk);
    end(s);
  }
}

function rtxSceneTriangleRadiance(radiance) {
  const src = asU8(radiance);
  if ((src.byteLength % 16) !== 0) {
    throw new RangeError("RTX triangle radiance must contain tightly packed vec4<f32> values");
  }
  const chunkBytes = Math.floor((maxPayload() - 8) / 16) * 16;
  if (chunkBytes <= 0) {
    throw new RangeError("Native command buffer is too small for an RTX triangle-radiance chunk");
  }
  for (let offset = 0; offset < src.byteLength; offset += chunkBytes) {
    const chunk = src.subarray(offset, Math.min(offset + chunkBytes, src.byteLength));
    const s = begin(OP.RTX_SCENE_TRIANGLE_RADIANCE, 8 + chunk.byteLength);
    wu32(RTX_PROTOCOL_VERSION);
    wu32(chunk.byteLength / 16);
    wbytes(chunk);
    end(s);
  }
}

function rtxSceneTriangleSurface(surface) {
  const src = asU8(surface);
  if ((src.byteLength % 16) !== 0) {
    throw new RangeError("RTX triangle surface data must contain tightly packed vec4<f32> values");
  }
  const chunkBytes = Math.floor((maxPayload() - 8) / 16) * 16;
  if (chunkBytes <= 0) {
    throw new RangeError("Native command buffer is too small for an RTX triangle-surface chunk");
  }
  for (let offset = 0; offset < src.byteLength; offset += chunkBytes) {
    const chunk = src.subarray(offset, Math.min(offset + chunkBytes, src.byteLength));
    const s = begin(OP.RTX_SCENE_TRIANGLE_SURFACE, 8 + chunk.byteLength);
    wu32(RTX_PROTOCOL_VERSION);
    wu32(chunk.byteLength / 16);
    wbytes(chunk);
    end(s);
  }
}

function rtxSceneLights(lights) {
  const src = asU8(lights);
  if ((src.byteLength % 64) !== 0 || src.byteLength > 8 * 64) {
    throw new RangeError("RTX static lights must contain at most eight tightly packed 4xvec4<f32> records");
  }
  const s = begin(OP.RTX_SCENE_LIGHTS, 8 + src.byteLength);
  wu32(RTX_PROTOCOL_VERSION);
  wu32(src.byteLength / 64);
  wbytes(src);
  end(s);
}

function rtxSceneCommit(encoder) {
  const s = begin(OP.RTX_SCENE_COMMIT, 8);
  wu32(RTX_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  end(s);
}

function rtxSceneDestroy() {
  const s = begin(OP.RTX_SCENE_DESTROY, 4);
  wu32(RTX_PROTOCOL_VERSION);
  end(s);
}

function rtxSceneInstanceGroup(group) {
  const capacity = Number(group?.capacity);
  if (!Number.isInteger(capacity) || capacity <= 0 ||
      capacity > RTX_MAX_INSTANCE_GROUP_CAPACITY) {
    throw new RangeError(
      `RTX instance-group capacity must be an integer in [1, ${RTX_MAX_INSTANCE_GROUP_CAPACITY}]`,
    );
  }
  const s = begin(OP.RTX_SCENE_INSTANCE_GROUP, 32);
  wu32(RTX_PROTOCOL_VERSION);
  wu32(group.id >>> 0);
  wu32(capacity >>> 0);
  wu32(group.vertexOffset >>> 0);
  wu32(group.vertexCount >>> 0);
  wu32(group.indexOffset >>> 0);
  wu32(group.indexCount >>> 0);
  wu32(group.primitiveBase >>> 0);
  end(s);
}

function rtxInstanceGroupUpdate(encoder, id, matrices, masks) {
  const matrixBytes = asU8(matrices);
  const maskBytes = asU8(masks);
  const count = masks.length >>> 0;
  if (count === 0 || count > RTX_MAX_INSTANCE_GROUP_CAPACITY) {
    throw new RangeError(
      `RTX instance-group updates require a slot count in [1, ${RTX_MAX_INSTANCE_GROUP_CAPACITY}]`,
    );
  }
  if (matrixBytes.byteLength !== count * 12 * 4 || maskBytes.byteLength !== count * 4) {
    throw new RangeError("RTX instance-group updates require one 3x4 matrix and one uint32 mask per slot");
  }
  const s = begin(OP.RTX_INSTANCE_GROUP_UPDATE, 16 + matrixBytes.byteLength + maskBytes.byteLength);
  wu32(RTX_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  wu32(id >>> 0);
  wu32(count);
  wbytes(matrixBytes);
  wbytes(maskBytes);
  end(s);
}

function rtxDynamicMeshCreate(encoder, mesh) {
  const indexBytes = asU8(mesh.indices);
  if (indexBytes.byteLength === 0 || (indexBytes.byteLength % 12) !== 0) {
    throw new RangeError("RTX dynamic-mesh indices must contain complete uint32 triangles");
  }
  const reflectionMaterial = mesh.reflectionMaterial ?? null;
  if (!reflectionMaterial) {
    const s = begin(OP.RTX_DYNAMIC_MESH_CREATE, 36 + indexBytes.byteLength);
    wu32(RTX_PROTOCOL_VERSION);
    wu32(encoder >>> 0);
    wu32(mesh.handle >>> 0);
    wu32(mesh.positionsTextureHandle >>> 0);
    wu32(mesh.positionsVulkanLayout >>> 0);
    wu32(mesh.width >>> 0);
    wu32(mesh.height >>> 0);
    wu32(mesh.vertexCount >>> 0);
    wu32(indexBytes.byteLength / 4);
    wbytes(indexBytes);
    end(s);
    return;
  }
  const radiance = reflectionMaterial.radiance;
  const surface = reflectionMaterial.surface;
  const s = begin(OP.RTX_DYNAMIC_MESH_CREATE, 72 + indexBytes.byteLength);
  wu32(RTX_DYNAMIC_MESH_CREATE_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  wu32(mesh.handle >>> 0);
  wu32(mesh.positionsTextureHandle >>> 0);
  wu32(mesh.positionsVulkanLayout >>> 0);
  wu32(mesh.width >>> 0);
  wu32(mesh.height >>> 0);
  wu32(mesh.vertexCount >>> 0);
  wu32(indexBytes.byteLength / 4);
  wu32(2);
  for (let index = 0; index < 4; ++index) wf32(radiance[index]);
  for (let index = 0; index < 4; ++index) wf32(surface[index]);
  wbytes(indexBytes);
  end(s);
}

function rtxDynamicMeshRefit(encoder, mesh) {
  const s = begin(OP.RTX_DYNAMIC_MESH_REFIT, 36);
  wu32(RTX_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  wu32(mesh.handle >>> 0);
  wu32(mesh.positionsTextureHandle >>> 0);
  wu32(mesh.positionsVulkanLayout >>> 0);
  wu32(mesh.width >>> 0);
  wu32(mesh.height >>> 0);
  wu32(mesh.vertexCount >>> 0);
  wu32(mesh.rebuild ? 1 : 0);
  end(s);
}

function rtxDynamicMeshDestroy(encoder, handle) {
  const s = begin(OP.RTX_DYNAMIC_MESH_DESTROY, 12);
  wu32(RTX_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  wu32(handle >>> 0);
  end(s);
}

function rtxPipelineCreate(handle, profile, entryPoint, spirv) {
  const entryPointBytes = utf8(entryPoint);
  const entryPointPaddedBytes = (entryPointBytes.byteLength + 3) & ~3;
  const spirvBytes = asU8(spirv);
  const s = begin(
    OP.RTX_PIPELINE_CREATE,
    20 + entryPointPaddedBytes + spirvBytes.byteLength,
  );
  wu32(RTX_PIPELINE_PROTOCOL_VERSION);
  wu32(handle >>> 0);
  wu32(profile >>> 0);
  wu32(entryPointBytes.byteLength);
  wu32(spirvBytes.byteLength);
  wbytes(entryPointBytes);
  if (entryPointPaddedBytes > entryPointBytes.byteLength) {
    wbytes(new Uint8Array(entryPointPaddedBytes - entryPointBytes.byteLength));
  }
  wbytes(spirvBytes);
  end(s);
}

function rtxPipelineCreateSource(handle, profile, entryPoint, source) {
  const entryPointBytes = utf8(entryPoint);
  const entryPointPaddedBytes = (entryPointBytes.byteLength + 3) & ~3;
  const sourceBytes = utf8(source);
  const s = begin(
    OP.RTX_PIPELINE_CREATE_SOURCE,
    20 + entryPointPaddedBytes + sourceBytes.byteLength,
  );
  wu32(RTX_PIPELINE_PROTOCOL_VERSION);
  wu32(handle >>> 0);
  wu32(profile >>> 0);
  wu32(entryPointBytes.byteLength);
  wu32(sourceBytes.byteLength);
  wbytes(entryPointBytes);
  if (entryPointPaddedBytes > entryPointBytes.byteLength) {
    wbytes(new Uint8Array(entryPointPaddedBytes - entryPointBytes.byteLength));
  }
  wbytes(sourceBytes);
  end(s);
}

function rtxPipelineDestroy(handle) {
  const s = begin(OP.RTX_PIPELINE_DESTROY, 8);
  wu32(RTX_PIPELINE_PROTOCOL_VERSION);
  wu32(handle >>> 0);
  end(s);
}

function rtxLightingEvaluate(encoder, frame) {
  const s = begin(OP.RTX_LIGHTING_EVALUATE, 172);
  wu32(RTX_EVALUATION_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  wu32(frame.colorTextureHandle >>> 0);
  wu32(frame.colorVulkanLayout >>> 0);
  wu32(frame.depthTextureHandle >>> 0);
  wu32(frame.depthVulkanLayout >>> 0);
  wu32(frame.width >>> 0);
  wu32(frame.height >>> 0);
  for (const value of frame.inverseViewProjection) wf32(value);
  for (const value of frame.cameraPosition) wf32(value);
  for (const value of frame.directionalDirectionIntensity) wf32(value);
  for (const value of frame.params) wf32(value);
  wu32(frame.flags >>> 0);
  wf32(frame.maxDistance);
  wf32(frame.rayBias);
  wu32(frame.directionalSampleCount >>> 0);
  wu32(frame.aoSampleCount >>> 0);
  wu32(frame.frameIndex >>> 0);
  wu32(frame.pipelineHandle >>> 0);
  end(s);
}

function rtxReflectionsEvaluate(encoder, frame) {
  const hasSpecularHitDistance = !!frame.specularHitDistance;
  const s = begin(OP.RTX_REFLECTIONS_EVALUATE, hasSpecularHitDistance ? 188 : 180);
  wu32(hasSpecularHitDistance ? 3 : RTX_EVALUATION_PROTOCOL_VERSION);
  wu32(encoder >>> 0);
  for (const resource of [
    frame.sourceColor,
    frame.outputColor,
    frame.depth,
    frame.normalRoughness,
    frame.specularAlbedo,
  ]) {
    wu32(resource.textureHandle >>> 0);
    wu32(resource.vulkanLayout >>> 0);
  }
  wu32(frame.width >>> 0);
  wu32(frame.height >>> 0);
  for (const value of frame.inverseViewProjection) wf32(value);
  for (const value of frame.cameraPosition) wf32(value);
  for (const value of frame.params) wf32(value);
  for (const value of frame.environment) wf32(value);
  wu32(frame.flags >>> 0);
  wu32(frame.frameIndex >>> 0);
  wu32(frame.pipelineHandle >>> 0);
  if (hasSpecularHitDistance) {
    wu32(frame.specularHitDistance.textureHandle >>> 0);
    wu32(frame.specularHitDistance.vulkanLayout >>> 0);
  }
  end(s);
}

// SUBMIT: count, handles[count]
function pipeBgl(handle, pipeline, index) {
  const s = begin(OP.PIPE_BGL, 12);
  wu32(handle);
  wu32(pipeline >>> 0);
  wu32(index >>> 0);
  end(s);
}

function submitEncoders(handles) {
  handles = handles || [];
  const s = begin(OP.SUBMIT, 4 + handles.length * 4);
  wu32(handles.length);
  for (let i = 0; i < handles.length; i++) wu32(handles[i] >>> 0);
  end(s);
}

// COPY_BUF: encoder, src, dst, srcOffset, dstOffset, size
function copyBuf(encoder, src, dst, srcOffset, dstOffset, size) {
  const s = begin(OP.COPY_BUF, 24);
  wu32(encoder);
  wu32(src >>> 0);
  wu32(dst >>> 0);
  wu32((srcOffset ?? 0) >>> 0);
  wu32((dstOffset ?? 0) >>> 0);
  wu32(size >>> 0);
  end(s);
}

// COPY_TEX: encoder, kind (0 tex2buf, 1 buf2tex, 2 tex2tex),
// srcHandle, dstHandle, srcX,Y,Z, srcMip, srcAspect,
// dstX,Y,Z, dstMip, dstAspect, dstOffset, bytesPerRow, rowsPerImage,
// width, height, depth
function copyTex(encoder, kind, src, dst, copySize) {
  const kindNumber = typeof kind === "number" ? kind : enu(COPY_KIND, kind, 0);
  const bufferLayout = kindNumber === 1 ? src : dst;
  const s = begin(OP.COPY_TEX, 84);
  wu32(encoder);
  wu32(kindNumber);
  wu32((src.handle ?? src.textureHandle ?? src.bufferHandle ?? 0) >>> 0);
  wu32((dst.handle ?? dst.textureHandle ?? dst.bufferHandle ?? 0) >>> 0);
  wu32(xyz(src.origin, "x", 0));
  wu32(xyz(src.origin, "y", 1));
  wu32(xyz(src.origin, "z", 2));
  wu32((src.mipLevel ?? 0) >>> 0);
  wu32(enu(ASPECT, src.aspect || "all", 1));
  wu32(xyz(dst.origin, "x", 0));
  wu32(xyz(dst.origin, "y", 1));
  wu32(xyz(dst.origin, "z", 2));
  wu32((dst.mipLevel ?? 0) >>> 0);
  wu32(enu(ASPECT, dst.aspect || "all", 1));
  wu32((bufferLayout.offset ?? 0) >>> 0);
  wu32((bufferLayout.bytesPerRow ?? 0) >>> 0);
  wu32((bufferLayout.rowsPerImage ?? 0) >>> 0);
  wu32(xyz(copySize, "width", 0) >>> 0);
  wu32(xyz(copySize, "height", 1) >>> 0);
  wu32((xyz(copySize, "depthOrArrayLayers", 2) || 1) >>> 0);
  wu32(0);
  end(s);
}

function bindSharedListener() {
  try {
    const wv = globalThis.chrome?.webview;
    if (!wv || typeof wv.addEventListener !== "function") return;
    wv.addEventListener("sharedbufferreceived", (e) => {
      try {
        const b = e.getBuffer && e.getBuffer();
        if (b) attach(b);
      } catch {
        /* document script may own getBuffer */
      }
      queueMicrotask(() => {
        if (globalThis.__TN_SHARED) attach(globalThis.__TN_SHARED);
      });
    });
  } catch {
    /* host injects the same event */
  }
}

const cmd = {
  OP,
  ops: OP,
  TEX_FORMAT,
  formatNum,
  host,
  hostHas,
  attach,
  submitNow,
  allocHandle,
  align8,
  begin,
  end,
  wu32,
  wf32,
  wbytes,
  nop,
  start,
  resize,
  present,
  setVsync,
  bufCreate,
  bufWrite,
  bufDestroy,
  texCreate,
  texDestroy,
  texView,
  texWrite,
  sampCreate,
  shaderCreate,
  bglCreate,
  plCreate,
  cpipeCreate,
  rpipeCreate,
  bgCreate,
  encBegin,
  computeBegin,
  computePipe,
  computeBg,
  dispatch,
  computeEnd,
  renderBegin,
  renderPipe,
  renderBg,
  setVertex,
  setIndex,
  draw,
  drawIndexed,
  setViewport,
  setScissor,
  setStencil,
  setBlend,
  drawIndirect,
  renderEnd,
  dlssEvaluate,
  frameGenerationTag,
  rayReconstructionEvaluate,
  rtxSceneBegin,
  rtxScenePositions,
  rtxSceneIndices,
  rtxSceneTriangleRadiance,
  rtxSceneTriangleSurface,
  rtxSceneLights,
  rtxSceneCommit,
  rtxSceneDestroy,
  rtxSceneInstanceGroup,
  rtxInstanceGroupUpdate,
  rtxDynamicMeshCreate,
  rtxDynamicMeshRefit,
  rtxDynamicMeshDestroy,
  rtxPipelineCreate,
  rtxPipelineCreateSource,
  rtxPipelineDestroy,
  rtxLightingEvaluate,
  rtxReflectionsEvaluate,
  submitEncoders,
  pipeBgl,
  copyBuf,
  copyTex,
  ready() {
    return !!host();
  },
  used() {
    return off;
  },
};

if (globalThis.__TN_SHARED) attach(globalThis.__TN_SHARED);
else {
  try {
    const n = host();
    if (n && hostHas(n, "EnsureCmdBuffer")) n.EnsureCmdBuffer();
  } catch {
    /* sharedbufferreceived is async */
  }
}
bindSharedListener();

globalThis.__TB_WGPU_CMD = cmd;
export { cmd };
export default cmd;
