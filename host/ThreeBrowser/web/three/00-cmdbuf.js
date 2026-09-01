(function (TN) {
  "use strict";

  // Little-endian command ring. Fields are 4-byte aligned; each command is
  // padded to 8 bytes. Keep opcodes in sync with native/cmd_ops.hpp.
  const OP = {
    NOP: 0,
    RENDER: 1,
    SET_SIZE: 2,
    CLEAR_COLOR: 3,
    RENDER_PASS: 4,
    RENDER_COMPOSITE: 5,
    SCENE_CREATE: 10,
    SCENE_BG: 11,
    SCENE_FOG: 12,
    SCENE_FOG_EXP2: 13,
    PERSP_CAM: 20,
    ORTHO_CAM: 21,
    ORTHO_UPDATE: 22,
    CAM_ASPECT: 23,
    CAM_UPD_PROJ: 24,
    BUF_GEO: 30,
    BOX_GEO: 31,
    BUF_ATTR: 32,
    TEX_RGBA: 33,
    TEX_BEGIN: 34,
    TEX_ROWS: 35,
    TEX_PARAMS: 36,
    TEX_CUBE: 37,
    TEX_FLOAT: 38,
    MAT_BASIC: 40,
    MAT_LAMBERT: 41,
    MAT_STANDARD: 42,
    MAT_LINE: 43,
    MAT_POINTS: 44,
    MAT_SPRITE: 45,
    MAT_SIDE: 46,
    MAT_MAP: 47,
    MAT_PBR: 48,
    MAT_EMISSIVE: 49,
    MAT_MAP_SLOT: 50,
    MAT_NORMAL: 51,
    MAT_ALPHA: 52,
    MAT_VISIBLE: 53,
    MAT_COLOR: 54,
    MAT_NORMAL_SCALE: 55,
    SHADER_TEX: 56,
    MESH: 60,
    GROUP: 61,
    INSTANCED: 62,
    LINE: 63,
    LINE_SEG: 64,
    LINE_LOOP: 65,
    POINTS: 66,
    SPRITE: 67,
    SKINNED: 68,
    SKINNED_BIND: 69,
    MESH_MAT: 70,
    OBJECT_ADD: 80,
    SET_POSE: 81,
    LOOK_AT: 82,
    LOOK_FROM: 83,
    SET_VISIBLE: 84,
    OBJECT_REMOVE: 85,
    SLOT_DESTROY: 86,
    SET_POSE_QUAT: 87,
    LIGHT_AMBIENT: 90,
    LIGHT_DIR: 91,
    LIGHT_HEMI: 92,
    LIGHT_POINT: 93,
    LIGHT_SPOT: 94,
    INST_MATRIX: 100,
    INST_COLOR: 101,
    INST_COUNT: 102,
    INST_MATRICES: 103,
  };

  // Keep in sync with native/cmd_ops.hpp MAP_SLOT_*
  const MAP_SLOT = {
    map: 0,
    normalMap: 1,
    roughnessMap: 2,
    metalnessMap: 3,
    aoMap: 4,
    emissiveMap: 5,
    envMap: 6,
    lightMap: 7,
  };

  const CAP = 8 * 1024 * 1024;
  let ab = new ArrayBuffer(CAP);
  let u8 = new Uint8Array(ab);
  let u32 = new Uint32Array(ab);
  let f32 = new Float32Array(ab);
  let off = 0;
  let nextId = 1;
  let shared = false;
  let pendingSubmit = false;
  let hostCache = null;
  let dirtyHead = null;
  let asyncSubmitTimer = 0;
  let lastAsyncSubmitAt = -Infinity;
  let pendingAsyncScene = 0;
  let pendingAsyncCamera = 0;

  function host() {
    if (hostCache) return hostCache;
    hostCache = globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
    return hostCache;
  }

  // WebView2 COM throws DISP_E_UNKNOWNNAME (0x80020006) on missing members.
  // Never use `typeof n.Foo === "function"` — the property get throws.
  TN.hostHas = function hostHas(n, name) {
    if (!n) return false;
    try {
      return typeof n[name] === "function";
    } catch {
      return false;
    }
  };

  TN.releaseHandle = function releaseHandle(handle) {
    handle = handle >>> 0;
    if (!handle) return;
    if (TN.cmd && typeof TN.cmd.destroy === "function") {
      TN.cmd.destroy(handle);
      return;
    }
    const n = host();
    if (TN.hostHas(n, "SlotDestroy")) {
      try {
        n.SlotDestroy(handle);
      } catch {
        /* native destroy optional */
      }
    }
  };

  function views() {
    u8 = new Uint8Array(ab);
    u32 = new Uint32Array(ab);
    f32 = new Float32Array(ab);
  }

  function align8(n) {
    return (n + 7) & ~7;
  }

  function bytesToB64(u8src) {
    let s = "";
    const n = 0x8000;
    for (let i = 0; i < u8src.length; i += n) {
      s += String.fromCharCode.apply(null, u8src.subarray(i, i + n));
    }
    return btoa(s);
  }

  function submitNow(preferAsync) {
    if (off <= 0) return;
    const n = host();
    const used = off;
    // SharedBuffer may arrive after the page's first fromScene/Sky mesh.
    // COM CmdSubmit reads the C# mapping, not this JS heap — copy the
    // pending bytes so geometry/mesh exist before PMREM captures them.
    if (!shared) {
      // Android WebView can move an ArrayBuffer through its asynchronous
      // WebMessage channel. Keep synchronous Base64 below for initialization
      // barriers where the caller immediately invokes a native host method.
      if (preferAsync && TN.hostHas(n, "CmdSubmitBuffer")) {
        try {
          n.CmdSubmitBuffer(ab.slice(0, used));
          off = 0;
          pendingSubmit = false;
          return;
        } catch (err) {
          console.warn("ThreeBrowser binary cmd submit failed", err);
        }
      }
      if (TN.hostHas(n, "CmdSubmitB64")) {
        try {
          n.CmdSubmitB64(bytesToB64(u8.subarray(0, used)));
          off = 0;
          pendingSubmit = false;
          return;
        } catch (err) {
          console.warn("ThreeBrowser cmd submit copy failed", err);
        }
      }
      pendingSubmit = true;
      if (TN.hostHas?.(n, "EnsureCmdBuffer")) {
        try {
          n.EnsureCmdBuffer();
        } catch {
          /* sharedbufferreceived is async */
        }
      }
      return;
    }
    if (!TN.hostHas(n, "CmdSubmit")) {
      off = 0;
      return;
    }
    off = 0;
    pendingSubmit = false;
    n.CmdSubmit(used);
  }

  function cmdBytes(payload) {
    return align8(8 + payload);
  }

  function canFit(payload) {
    const size = cmdBytes(payload);
    if (size > ab.byteLength) return false;
    if (off + size <= ab.byteLength) return true;
    submitNow();
    return off + size <= ab.byteLength;
  }

  function need(bytes) {
    bytes = align8(bytes);
    if (off + bytes <= ab.byteLength) return;
    submitNow();
    if (off + bytes > ab.byteLength) {
      throw new Error("ThreeBrowser cmd buffer overflow");
    }
  }

  function begin(op, payload) {
    const size = align8(8 + payload);
    need(size);
    const start = off;
    u32[off >> 2] = op;
    u32[(off >> 2) + 1] = size;
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
    f32[off >> 2] = v;
    off += 4;
  }

  function copyBytes(src) {
    if (!src || src.length === 0) return;
    const bytes =
      src instanceof Uint8Array
        ? src
        : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    u8.set(bytes, off);
    off += bytes.byteLength;
  }

  function alloc() {
    return nextId++;
  }

  function attach(buffer) {
    if (!buffer || !(buffer instanceof ArrayBuffer)) return;
    if (off > 0 && buffer.byteLength >= off) {
      new Uint8Array(buffer).set(u8.subarray(0, off));
    }
    ab = buffer;
    views();
    shared = true;
    if (pendingSubmit) submitNow();
  }

  function markPose(obj) {
    if (!obj || obj._inDirty) return;
    obj._inDirty = 1;
    obj._dirtyNext = dirtyHead;
    dirtyHead = obj;
  }

  function flushPoses() {
    let o = dirtyHead;
    dirtyHead = null;
    while (o) {
      const next = o._dirtyNext;
      o._dirtyNext = null;
      o._inDirty = 0;
      if (typeof o.flushSelf === "function") o.flushSelf();
      o = next;
    }
  }

  function submit() {
    flushPoses();
    submitNow();
  }

  function asyncSubmitInterval(n) {
    if (!TN.hostHas(n, "CmdSubmitIntervalMs")) return 0;
    try {
      const value = Number(n.CmdSubmitIntervalMs());
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function appendRender(scene, camera) {
    const s = begin(OP.RENDER, 8);
    wu32(scene);
    wu32(camera);
    end(s);
  }

  function appendComposite(worldScene, worldCamera, overlayScene, overlayCamera) {
    const s = begin(OP.RENDER_COMPOSITE, 16);
    wu32(worldScene);
    wu32(worldCamera);
    wu32(overlayScene);
    wu32(overlayCamera);
    end(s);
  }

  function emitAsyncFrame() {
    const scene = pendingAsyncScene;
    const camera = pendingAsyncCamera;
    pendingAsyncScene = 0;
    pendingAsyncCamera = 0;
    flushPoses();
    appendRender(scene, camera);
    lastAsyncSubmitAt = performance.now();
    submitNow(true);
  }

  function cancelAsyncFrame() {
    pendingAsyncScene = 0;
    pendingAsyncCamera = 0;
    if (asyncSubmitTimer) {
      clearTimeout(asyncSubmitTimer);
      asyncSubmitTimer = 0;
    }
  }

  function submitFrame(scene, camera) {
    const n = host();
    const interval = asyncSubmitInterval(n);
    if (interval <= 0) {
      flushPoses();
      appendRender(scene, camera);
      submitNow(true);
      return;
    }

    // Retain only the most recent requested view while pose objects remain on
    // the dirty list. When emitted, flushPoses reads their latest JS state, so
    // obsolete animation frames are coalesced without losing one-shot edits.
    pendingAsyncScene = scene;
    pendingAsyncCamera = camera;
    const now = performance.now();
    const delay = interval - (now - lastAsyncSubmitAt);
    if (delay <= 0) {
      if (asyncSubmitTimer) {
        clearTimeout(asyncSubmitTimer);
        asyncSubmitTimer = 0;
      }
      emitAsyncFrame();
      return;
    }
    if (!asyncSubmitTimer) {
      asyncSubmitTimer = setTimeout(() => {
        asyncSubmitTimer = 0;
        emitAsyncFrame();
      }, delay);
    }
  }

  function submitAsync() {
    flushPoses();
    submitNow(true);
  }

  const cmd = {
    OP,
    MAP_SLOT,
    alloc,
    attach,
    markPose,
    flushPoses,
    submit,
    submitAsync,
    submitFrame,
    submitComposite(worldScene, worldCamera, overlayScene, overlayCamera) {
      // A composite is the complete, newest presentation for this display
      // frame. Never allow an older coalesced single-scene render to fire
      // afterward and erase its viewmodel/HUD overlay.
      cancelAsyncFrame();
      flushPoses();
      appendComposite(worldScene, worldCamera, overlayScene, overlayCamera);
      lastAsyncSubmitAt = performance.now();
      submitNow(true);
    },
    ready() {
      return !!host();
    },
    render(scene, camera) {
      appendRender(scene, camera);
    },
    renderPass(scene, camera, target, overrideMaterial = 0, face = 0, mip = 0, flags = 0) {
      const s = begin(OP.RENDER_PASS, 28);
      wu32(scene);
      wu32(camera);
      wu32(target);
      wu32(overrideMaterial);
      wu32(face);
      wu32(mip);
      wu32(flags);
      end(s);
    },
    setSize(w, h) {
      const s = begin(OP.SET_SIZE, 8);
      wu32(w);
      wu32(h);
      end(s);
    },
    sceneCreate(id) {
      const s = begin(OP.SCENE_CREATE, 8);
      wu32(id);
      wu32(0);
      end(s);
    },
    sceneBg(id, hex) {
      const s = begin(OP.SCENE_BG, 8);
      wu32(id);
      wu32(hex);
      end(s);
    },
    sceneFog(id, hex, near, far) {
      const s = begin(OP.SCENE_FOG, 16);
      wu32(id);
      wu32(hex);
      wf32(near);
      wf32(far);
      end(s);
    },
    sceneFogExp2(id, hex, density) {
      const s = begin(OP.SCENE_FOG_EXP2, 16);
      wu32(id);
      wu32(hex);
      wf32(density);
      wu32(0);
      end(s);
    },
    perspCam(id, fov, aspect, near, far) {
      const s = begin(OP.PERSP_CAM, 24);
      wu32(id);
      wf32(fov);
      wf32(aspect);
      wf32(near);
      wf32(far);
      wu32(0);
      end(s);
    },
    orthoCam(id, left, right, top, bottom, near, far) {
      const s = begin(OP.ORTHO_CAM, 32);
      wu32(id);
      wf32(left);
      wf32(right);
      wf32(top);
      wf32(bottom);
      wf32(near);
      wf32(far);
      wu32(0);
      end(s);
    },
    orthoUpdate(id, left, right, top, bottom, near, far, zoom) {
      const s = begin(OP.ORTHO_UPDATE, 32);
      wu32(id);
      wf32(left);
      wf32(right);
      wf32(top);
      wf32(bottom);
      wf32(near);
      wf32(far);
      wf32(zoom);
      end(s);
    },
    camAspect(id, aspect) {
      const s = begin(OP.CAM_ASPECT, 8);
      wu32(id);
      wf32(aspect);
      end(s);
    },
    camUpdProj(id) {
      const s = begin(OP.CAM_UPD_PROJ, 8);
      wu32(id);
      wu32(0);
      end(s);
    },
    // OP_BUF_GEO payload after 8-byte header (unchanged, backward compatible):
    //   u32 id, posN, nrmN, uvN, idxN, pad,
    //   f32 pos[posN], f32 nrm[nrmN], f32 uv[uvN], u32 idx[idxN]
    // Extra float attributes (skinIndex, skinWeight, uv2, color, tangent, ...)
    // are uploaded separately via OP_BUF_ATTR.
    bufGeo(id, pos, nrm, uv, idx) {
      const posN = pos && pos.length ? pos.length : 0;
      const nrmN = nrm && nrm.length ? nrm.length : 0;
      const uvN = uv && uv.length ? uv.length : 0;
      const idxN = idx && idx.length ? idx.length : 0;
      const payload = 24 + (posN + nrmN + uvN + idxN) * 4;
      const s = begin(OP.BUF_GEO, payload);
      wu32(id);
      wu32(posN);
      wu32(nrmN);
      wu32(uvN);
      wu32(idxN);
      wu32(0);
      if (posN) copyBytes(pos instanceof Float32Array ? pos : new Float32Array(pos));
      if (nrmN) copyBytes(nrm instanceof Float32Array ? nrm : new Float32Array(nrm));
      if (uvN) copyBytes(uv instanceof Float32Array ? uv : new Float32Array(uv));
      if (idxN) {
        const src = idx.array || idx;
        if (src instanceof Uint32Array) copyBytes(src);
        else {
          const u = new Uint32Array(idxN);
          for (let i = 0; i < idxN; i++) u[i] = src[i];
          copyBytes(u);
        }
      }
      end(s);
    },
    // OP_BUF_ATTR payload after 8-byte header:
    //   u32 geoId, u32 itemSize, u32 floatCount, u32 pad,
    //   char name[16], f32 data[floatCount]
    bufAttr(id, name, itemSize, data) {
      const floats = data instanceof Float32Array ? data : new Float32Array(data || []);
      const n = floats.length;
      const payload = 32 + n * 4;
      const s = begin(OP.BUF_ATTR, payload);
      wu32(id);
      wu32(itemSize);
      wu32(n);
      wu32(0);
      const nameBytes = new Uint8Array(16);
      const str = String(name || "");
      for (let i = 0; i < str.length && i < 15; i++) nameBytes[i] = str.charCodeAt(i) & 255;
      copyBytes(nameBytes);
      if (n) copyBytes(floats);
      end(s);
    },
    boxGeo(id, w, h, d) {
      const s = begin(OP.BOX_GEO, 16);
      wu32(id);
      wf32(w);
      wf32(h);
      wf32(d);
      end(s);
    },
    // OP_TEX_RGBA payload after 8-byte header:
    //   u32 id, u32 width, u32 height, u32 pad, u8 rgba[width*height*4]
    // Returns false when the pixels cannot fit the ring even after a flush
    // (caller should use TEX_BEGIN/ROWS or COM).
    texRgba(id, width, height, pixels) {
      const n = (width | 0) * (height | 0) * 4;
      const payload = 16 + Math.max(0, n);
      if (!canFit(payload)) return false;
      const s = begin(OP.TEX_RGBA, payload);
      wu32(id);
      wu32(width);
      wu32(height);
      wu32(0);
      if (n) copyBytes(pixels);
      end(s);
      return true;
    },
    // OP_TEX_PARAMS: u32 id, wrapS, wrapT, colorSpace, mag, min, channel, pad,
    //                f32 ox, oy, repeatX, repeatY
    texParams(id, wrapS, wrapT, colorSpace, mag, min, channel, ox, oy, rx, ry) {
      const s = begin(OP.TEX_PARAMS, 48);
      wu32(id);
      wu32(wrapS);
      wu32(wrapT);
      wu32(colorSpace);
      wu32(mag);
      wu32(min);
      wu32(channel);
      wu32(0);
      wf32(ox);
      wf32(oy);
      wf32(rx);
      wf32(ry);
      end(s);
    },
    // OP_TEX_BEGIN: u32 id, u32 width, u32 height, u32 pad
    texBegin(id, width, height) {
      const payload = 16;
      if (!canFit(payload)) return false;
      const s = begin(OP.TEX_BEGIN, payload);
      wu32(id);
      wu32(width);
      wu32(height);
      wu32(0);
      end(s);
      return true;
    },
    // OP_TEX_ROWS: u32 id, u32 y, u32 rows, u32 pad, u8 rgba[width*rows*4]
    texRows(id, y, rows, pixels) {
      const n = pixels && pixels.length ? pixels.length : 0;
      const payload = 16 + n;
      if (!canFit(payload)) return false;
      const s = begin(OP.TEX_ROWS, payload);
      wu32(id);
      wu32(y);
      wu32(rows);
      wu32(0);
      if (n) copyBytes(pixels);
      end(s);
      return true;
    },
    uploadRgba(id, width, height, pixels, params) {
      const ok = this.texRgba(id, width, height, pixels);
      if (ok) {
        if (params) this.texParams(id, params.wrapS, params.wrapT, params.colorSpace, params.mag, params.min, params.channel, params.ox, params.oy, params.rx, params.ry);
        return true;
      }
      const w = width | 0;
      const h = height | 0;
      if (w <= 0 || h <= 0) return false;
      const src =
        pixels instanceof Uint8Array
          ? pixels
          : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      const stride = w * 4;
      if (!this.texBegin(id, w, h)) return false;
      const maxPayload = ab.byteLength - 64;
      const maxRows = Math.max(1, Math.floor((maxPayload - 16) / stride) | 0);
      let y = 0;
      while (y < h) {
        const rows = Math.min(maxRows, h - y);
        const slice = src.subarray(y * stride, (y + rows) * stride);
        if (!this.texRows(id, y, rows, slice)) return false;
        y += rows;
      }
      if (params) {
        this.texParams(
          id,
          params.wrapS,
          params.wrapT,
          params.colorSpace,
          params.mag,
          params.min,
          params.channel,
          params.ox,
          params.oy,
          params.rx,
          params.ry
        );
      }
      return true;
    },
    // Float data textures (for example skinning bone matrices) must retain
    // signed values and cannot pass through the display-image RGBA8 path.
    uploadFloat(id, width, height, pixels, params) {
      const w = width | 0;
      const h = height | 0;
      const count = w * h * 4;
      if (w <= 0 || h <= 0 || !pixels || pixels.length < count) return false;
      const payload = 16 + count * 4;
      if (!canFit(payload)) return false;
      const s = begin(OP.TEX_FLOAT, payload);
      wu32(id);
      wu32(w);
      wu32(h);
      wu32(0);
      copyBytes(new Uint8Array(pixels.buffer, pixels.byteOffset, count * 4));
      end(s);
      if (params) this.texParams(id, params.wrapS, params.wrapT, params.colorSpace, params.mag, params.min, params.channel, params.ox, params.oy, params.rx, params.ry);
      return true;
    },
    matBasic(id, hex) {
      const s = begin(OP.MAT_BASIC, 8);
      wu32(id);
      wu32(hex);
      end(s);
    },
    matLambert(id, hex) {
      const s = begin(OP.MAT_LAMBERT, 8);
      wu32(id);
      wu32(hex);
      end(s);
    },
    matStandard(id, hex, metal, rough) {
      const s = begin(OP.MAT_STANDARD, 16);
      wu32(id);
      wu32(hex);
      wf32(metal);
      wf32(rough);
      end(s);
    },
    matLine(id, hex, width) {
      const s = begin(OP.MAT_LINE, 16);
      wu32(id);
      wu32(hex);
      wf32(width);
      wu32(0);
      end(s);
    },
    matPoints(id, hex, size) {
      const s = begin(OP.MAT_POINTS, 16);
      wu32(id);
      wu32(hex);
      wf32(size);
      wu32(0);
      end(s);
    },
    matSprite(id, hex) {
      const s = begin(OP.MAT_SPRITE, 8);
      wu32(id);
      wu32(hex);
      end(s);
    },
    matNormal(id) {
      const s = begin(OP.MAT_NORMAL, 8);
      wu32(id);
      wu32(0);
      end(s);
    },
    matSide(id, side) {
      const s = begin(OP.MAT_SIDE, 8);
      wu32(id);
      wu32(side);
      end(s);
    },
    matMap(id, tex) {
      const s = begin(OP.MAT_MAP, 8);
      wu32(id);
      wu32(tex);
      end(s);
    },
    // OP_MAT_MAP_SLOT payload: u32 matId, u32 slot, u32 texId, u32 pad
    matMapSlot(id, slot, tex) {
      const s = begin(OP.MAT_MAP_SLOT, 16);
      wu32(id);
      wu32(slot);
      wu32(tex);
      wu32(0);
      end(s);
    },
    matPbr(id, metal, rough) {
      const s = begin(OP.MAT_PBR, 16);
      wu32(id);
      wf32(metal);
      wf32(rough);
      wu32(0);
      end(s);
    },
    matEmissive(id, hex) {
      const s = begin(OP.MAT_EMISSIVE, 8);
      wu32(id);
      wu32(hex);
      end(s);
    },
    // OP_MAT_ALPHA: u32 id, f32 opacity, f32 alphaTest, u32 flags
    // flags: bit0 transparent, bit1 depthWrite
    matAlpha(id, opacity, alphaTest, transparent, depthWrite) {
      const s = begin(OP.MAT_ALPHA, 16);
      wu32(id);
      wf32(opacity);
      wf32(alphaTest);
      wu32((transparent ? 1 : 0) | (depthWrite ? 2 : 0));
      end(s);
    },
    matVisible(id, visible) {
      const s = begin(OP.MAT_VISIBLE, 8);
      wu32(id);
      wu32(visible ? 1 : 0);
      end(s);
    },
    clearColor(hex, alpha) {
      const s = begin(OP.CLEAR_COLOR, 8);
      wu32(hex);
      wf32(alpha);
      end(s);
    },
    texCube(id, faces, colorSpace) {
      const s = begin(OP.TEX_CUBE, 32);
      wu32(id);
      for (let i = 0; i < 6; i++) wu32(faces?.[i] || 0);
      wu32(colorSpace || 0);
      end(s);
    },
    matColor(id, hex) {
      const s = begin(OP.MAT_COLOR, 8);
      wu32(id);
      wu32(hex);
      end(s);
    },
    matNormalScale(id, x, y) {
      const s = begin(OP.MAT_NORMAL_SCALE, 16);
      wu32(id);
      wf32(x);
      wf32(y);
      wu32(0);
      end(s);
    },
    shaderTexture(id, name, tex) {
      const bytes = new TextEncoder().encode(String(name || ""));
      if (!id || !tex || !bytes.length) return;
      const s = begin(OP.SHADER_TEX, 12 + bytes.length);
      wu32(id);
      wu32(tex);
      wu32(bytes.length);
      copyBytes(bytes);
      end(s);
    },
    mesh(id, geo, mat) {
      const s = begin(OP.MESH, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(0);
      end(s);
    },
    group(id) {
      const s = begin(OP.GROUP, 8);
      wu32(id);
      wu32(0);
      end(s);
    },
    instanced(id, geo, mat, count) {
      const s = begin(OP.INSTANCED, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(count);
      end(s);
    },
    line(id, geo, mat) {
      const s = begin(OP.LINE, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(0);
      end(s);
    },
    lineSeg(id, geo, mat) {
      const s = begin(OP.LINE_SEG, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(0);
      end(s);
    },
    lineLoop(id, geo, mat) {
      const s = begin(OP.LINE_LOOP, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(0);
      end(s);
    },
    points(id, geo, mat) {
      const s = begin(OP.POINTS, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(0);
      end(s);
    },
    sprite(id, mat) {
      const s = begin(OP.SPRITE, 8);
      wu32(id);
      wu32(mat);
      end(s);
    },
    skinnedMesh(id, geo, mat) {
      const s = begin(OP.SKINNED, 16);
      wu32(id);
      wu32(geo);
      wu32(mat);
      wu32(0);
      end(s);
    },
    skinnedBind(mesh, skeleton) {
      const s = begin(OP.SKINNED_BIND, 8);
      wu32(mesh);
      wu32(skeleton);
      end(s);
    },
    meshMaterial(mesh, material) {
      const s = begin(OP.MESH_MAT, 8);
      wu32(mesh);
      wu32(material);
      end(s);
    },
    add(parent, child) {
      const s = begin(OP.OBJECT_ADD, 8);
      wu32(parent);
      wu32(child);
      end(s);
    },
    remove(parent, child) {
      const s = begin(OP.OBJECT_REMOVE, 8);
      wu32(parent);
      wu32(child);
      end(s);
    },
    destroy(id) {
      const s = begin(OP.SLOT_DESTROY, 8);
      wu32(id);
      wu32(0);
      end(s);
    },
    setPose(id, px, py, pz, rx, ry, rz, sx, sy, sz) {
      const s = begin(OP.SET_POSE, 40);
      wu32(id);
      wf32(px);
      wf32(py);
      wf32(pz);
      wf32(rx);
      wf32(ry);
      wf32(rz);
      wf32(sx);
      wf32(sy);
      wf32(sz);
      end(s);
    },
    setPoseQuat(id, px, py, pz, qx, qy, qz, qw, sx, sy, sz) {
      const s = begin(OP.SET_POSE_QUAT, 44);
      wu32(id);
      wf32(px);
      wf32(py);
      wf32(pz);
      wf32(qx);
      wf32(qy);
      wf32(qz);
      wf32(qw);
      wf32(sx);
      wf32(sy);
      wf32(sz);
      end(s);
    },
    lookAt(id, x, y, z) {
      const s = begin(OP.LOOK_AT, 16);
      wu32(id);
      wf32(x);
      wf32(y);
      wf32(z);
      end(s);
    },
    lookFrom(id, px, py, pz, tx, ty, tz) {
      const s = begin(OP.LOOK_FROM, 32);
      wu32(id);
      wf32(px);
      wf32(py);
      wf32(pz);
      wf32(tx);
      wf32(ty);
      wf32(tz);
      wu32(0);
      end(s);
    },
    setVisible(id, visible) {
      const s = begin(OP.SET_VISIBLE, 8);
      wu32(id);
      wu32(visible ? 1 : 0);
      end(s);
    },
    lightAmbient(id, hex, intensity) {
      const s = begin(OP.LIGHT_AMBIENT, 16);
      wu32(id);
      wu32(hex);
      wf32(intensity);
      wu32(0);
      end(s);
    },
    lightDir(id, hex, intensity) {
      const s = begin(OP.LIGHT_DIR, 16);
      wu32(id);
      wu32(hex);
      wf32(intensity);
      wu32(0);
      end(s);
    },
    lightHemi(id) {
      const s = begin(OP.LIGHT_HEMI, 8);
      wu32(id);
      wu32(0);
      end(s);
    },
    lightPoint(id, hex, intensity) {
      const s = begin(OP.LIGHT_POINT, 16);
      wu32(id);
      wu32(hex);
      wf32(intensity);
      wu32(0);
      end(s);
    },
    lightSpot(id, hex, intensity, distance, angle, penumbra, decay) {
      const s = begin(OP.LIGHT_SPOT, 32);
      wu32(id);
      wu32(hex);
      wf32(intensity);
      wf32(distance);
      wf32(angle);
      wf32(penumbra);
      wf32(decay);
      wu32(0);
      end(s);
    },
    instMatrix(id, index, elements) {
      const s = begin(OP.INST_MATRIX, 72);
      wu32(id);
      wu32(index);
      copyBytes(elements instanceof Float32Array ? elements : new Float32Array(elements));
      end(s);
    },
    instColor(id, index, hex) {
      const s = begin(OP.INST_COLOR, 16);
      wu32(id);
      wu32(index);
      wu32(hex);
      wu32(0);
      end(s);
    },
    instCount(id, count) {
      const s = begin(OP.INST_COUNT, 8);
      wu32(id);
      wu32(count >>> 0);
      end(s);
    },
    instMatrices(id, start, count, elements) {
      const src = elements instanceof Float32Array ? elements : new Float32Array(elements);
      let done = 0;
      while (done < count) {
        need(8 + 12 + 64);
        const room = ab.byteLength - off;
        const n = Math.min(count - done, Math.max(1, Math.floor((room - 32) / 64)));
        const payload = 12 + n * 64;
        const s = begin(OP.INST_MATRICES, payload);
        wu32(id);
        wu32((start + done) >>> 0);
        wu32(n >>> 0);
        copyBytes(new Uint8Array(src.buffer, src.byteOffset + done * 64, n * 64));
        end(s);
        done += n;
      }
    },
  };

  if (globalThis.__TN_SHARED) cmd.attach(globalThis.__TN_SHARED);
  else {
    try {
      const n = host();
      if (n && typeof n.EnsureCmdBuffer === "function") n.EnsureCmdBuffer();
    } catch {
      /* sharedbufferreceived is async */
    }
  }

  TN.cmd = cmd;
})(globalThis.__TN = globalThis.__TN || {});
