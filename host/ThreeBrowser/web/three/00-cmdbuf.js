(function (TN) {
  "use strict";

  // Little-endian command ring. Fields are 4-byte aligned; each command is
  // padded to 8 bytes. Keep opcodes in sync with native/cmd_ops.hpp.
  const OP = {
    NOP: 0,
    RENDER: 1,
    SET_SIZE: 2,
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
    OBJECT_ADD: 80,
    SET_POSE: 81,
    LOOK_AT: 82,
    LOOK_FROM: 83,
    LIGHT_AMBIENT: 90,
    LIGHT_DIR: 91,
    LIGHT_HEMI: 92,
    LIGHT_POINT: 93,
    LIGHT_SPOT: 94,
    INST_MATRIX: 100,
    INST_COLOR: 101,
  };

  // Keep in sync with native/cmd_ops.hpp MAP_SLOT_*
  const MAP_SLOT = {
    map: 0,
    normalMap: 1,
    roughnessMap: 2,
    metalnessMap: 3,
    aoMap: 4,
    emissiveMap: 5,
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

  function views() {
    u8 = new Uint8Array(ab);
    u32 = new Uint32Array(ab);
    f32 = new Float32Array(ab);
  }

  function align8(n) {
    return (n + 7) & ~7;
  }

  function submitNow() {
    if (off <= 0) return;
    const n = host();
    if (!TN.hostHas(n, "CmdSubmit")) {
      off = 0;
      return;
    }
    if (!shared && TN.hostHas?.(n, "EnsureCmdBuffer")) {
      try {
        n.EnsureCmdBuffer();
      } catch {
        /* event is async */
      }
    }
    if (!shared) {
      pendingSubmit = true;
      return;
    }
    const used = off;
    off = 0;
    pendingSubmit = false;
    n.CmdSubmit(used);
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

  const cmd = {
    OP,
    MAP_SLOT,
    alloc,
    attach,
    markPose,
    flushPoses,
    submit,
    ready() {
      return !!host();
    },
    render(scene, camera) {
      const s = begin(OP.RENDER, 8);
      wu32(scene);
      wu32(camera);
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
    add(parent, child) {
      const s = begin(OP.OBJECT_ADD, 8);
      wu32(parent);
      wu32(child);
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
