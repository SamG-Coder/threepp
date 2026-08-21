(function (TN) {
  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  function bytesToB64(u8) {
    let s = "";
    const n = 0x8000;
    for (let i = 0; i < u8.length; i += n) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + n));
    }
    return btoa(s);
  }

  function f32ToB64(arr) {
    if (!arr || arr.length === 0) return "";
    const f32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
    return bytesToB64(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
  }

  function indexToB64(attr) {
    if (!attr) return "";
    const src = attr.array || attr;
    if (src instanceof Uint32Array) {
      return bytesToB64(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
    }
    const u32 = new Uint32Array(src.length);
    for (let i = 0; i < src.length; i++) u32[i] = src[i];
    return bytesToB64(new Uint8Array(u32.buffer));
  }

  function materialHandle(material) {
    if (!material) return 0;
    if (Array.isArray(material)) return material[0]?._h || 0;
    return material._h || 0;
  }

  function packInversesForNative(bones, boneInverses) {
    const out = [];
    for (let i = 0; i < bones.length; i++) {
      if (!(bones[i] && bones[i]._h)) continue;
      const e = boneInverses[i] && boneInverses[i].elements;
      if (e && e.length >= 16) {
        for (let j = 0; j < 16; j++) out.push(e[j]);
      } else {
        out.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      }
    }
    return new Float32Array(out);
  }

  function packedInversesAreIdentity(floats) {
    if (!floats || floats.length < 16) return true;
    for (let o = 0; o < floats.length; o += 16) {
      for (let j = 0; j < 16; j++) {
        const expect = j % 5 === 0 ? 1 : 0;
        if (Math.abs(floats[o + j] - expect) > 1e-5) return false;
      }
    }
    return true;
  }

  function applySkeletonInverses(skeleton) {
    if (!skeleton || !skeleton._h || skeleton._nativeInversesApplied) return;
    const packed = packInversesForNative(skeleton.bones, skeleton.boneInverses);
    if (packedInversesAreIdentity(packed)) return;
    const n = native();
    if (!TN.hostHas?.(n, "SkeletonSetInverses")) return;
    if (TN.cmd && typeof TN.cmd.submit === "function") {
      try {
        TN.cmd.submit();
      } catch {
        /* bind must land before inverses */
      }
    }
    try {
      n.SkeletonSetInverses(skeleton._h, f32ToB64(packed));
      skeleton._nativeInversesApplied = true;
    } catch {
      /* keep calculateInverses from bind */
    }
  }

  function syncNativeMaterial(obj, material) {
    if (!obj?._h) return;
    const mh = materialHandle(material);
    if (!mh) return;
    if (TN.cmd && typeof TN.cmd.meshMaterial === "function") {
      TN.cmd.meshMaterial(obj._h, mh);
      return;
    }
    const n = native();
    if (n && typeof n.MeshSetMaterial === "function") {
      try {
        n.MeshSetMaterial(obj._h, mh);
      } catch {
        /* native material swap optional */
      }
    }
  }

  function installMaterial(obj, material) {
    obj._material = material;
    Object.defineProperty(obj, "material", {
      configurable: true,
      enumerable: true,
      get() {
        return this._material;
      },
      set(value) {
        this._material = value;
        if (value && typeof TN._bindMaterialMaps === "function") {
          TN._bindMaterialMaps(Array.isArray(value) ? value[0] : value);
        }
        syncNativeMaterial(this, value);
      },
    });
  }

  function attrToF32(attr) {
    if (!attr) return null;
    const itemSize = attr.itemSize || 0;
    if (!itemSize) return null;
    const count =
      attr.count != null
        ? attr.count
        : attr.array && itemSize
          ? (attr.array.length / itemSize) | 0
          : 0;
    if (!count) return null;
    const packed = count * itemSize;
    const src = attr.array;
    const interleaved =
      !!(attr.isInterleavedBufferAttribute || (attr.data && attr.data.stride != null)) ||
      (src && src.length !== packed);
    if (interleaved || attr.normalized || !src || !(src instanceof Float32Array)) {
      const out = new Float32Array(packed);
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < itemSize; j++) {
          out[i * itemSize + j] = attr.getComponent ? attr.getComponent(i, j) : 0;
        }
      }
      return out;
    }
    return src;
  }

  function uploadExtraAttributes(geo) {
    if (!geo || !geo._h) return;
    const skip = { position: 1, normal: 1, uv: 1 };
    const attrs = geo.attributes || {};
    if (!geo._nativeAttrs) geo._nativeAttrs = {};
    for (const name in attrs) {
      if (skip[name] || geo._nativeAttrs[name]) continue;
      const attr = attrs[name];
      const itemSize = attr && attr.itemSize;
      const floats = attrToF32(attr);
      if (!itemSize || !floats || !floats.length) continue;
      geo._nativeAttrs[name] = 1;
      const nativeName = name === "uv1" ? "uv2" : name;
      if (TN.cmd && typeof TN.cmd.bufAttr === "function") {
        TN.cmd.bufAttr(geo._h, nativeName, itemSize, floats);
      } else {
        const n = native();
        if (n && typeof n.BufferGeometrySetAttr === "function") {
          try {
            n.BufferGeometrySetAttr(geo._h, nativeName, itemSize, f32ToB64(floats));
          } catch {
            /* extra attributes optional */
          }
        }
      }
    }
  }

  function ensureNativeGeometry(geo) {
    if (!geo) return 0;
    if (!geo._h && geo._nativeId) geo._h = geo._nativeId;
    const pos = geo.attributes?.position;
    if (!pos) return geo._h || 0;
    if (geo._h) {
      uploadExtraAttributes(geo);
      return geo._h;
    }
    if (TN.cmd) {
      geo._h = TN.cmd.alloc();
      TN.cmd.bufGeo(
        geo._h,
        attrToF32(pos),
        attrToF32(geo.attributes.normal),
        attrToF32(geo.attributes.uv),
        geo.index?.array || geo.index
      );
      geo._nativeId = geo._h;
      geo._nativeAttrs = {};
      uploadExtraAttributes(geo);
      return geo._h;
    }
    const n = native();
    if (!n || typeof n.BufferGeometryCreate !== "function") return 0;
    try {
      geo._h = n.BufferGeometryCreate(
        f32ToB64(attrToF32(pos)),
        f32ToB64(attrToF32(geo.attributes.normal)),
        f32ToB64(attrToF32(geo.attributes.uv)),
        indexToB64(geo.index)
      );
    } catch {
      geo._h = 0;
    }
    if (geo._h) {
      geo._nativeId = geo._h;
      geo._nativeAttrs = {};
      uploadExtraAttributes(geo);
    }
    return geo._h || 0;
  }

  function nativeMeshHandle(geometry, material) {
    const gh = ensureNativeGeometry(geometry);
    const mh = materialHandle(material);
    if (!gh || !mh) return 0;
    if (TN.cmd) {
      const id = TN.cmd.alloc();
      TN.cmd.mesh(id, gh, mh);
      return id;
    }
    const n = native();
    if (!n || typeof n.MeshCreate !== "function") return 0;
    try {
      return n.MeshCreate(gh, mh) || 0;
    } catch {
      return 0;
    }
  }

  function nativeSkinnedHandle(geometry, material) {
    const gh = ensureNativeGeometry(geometry);
    const mh = materialHandle(material);
    if (!gh || !mh) return 0;
    if (TN.cmd && typeof TN.cmd.skinnedMesh === "function") {
      const id = TN.cmd.alloc();
      TN.cmd.skinnedMesh(id, gh, mh);
      return id;
    }
    const n = native();
    if (!n || typeof n.SkinnedMeshCreate !== "function") return 0;
    try {
      return n.SkinnedMeshCreate(gh, mh) || 0;
    } catch {
      return 0;
    }
  }

  function nativeGroupHandle() {
    if (TN.cmd) {
      const id = TN.cmd.alloc();
      TN.cmd.group(id);
      return id;
    }
    const n = native();
    if (!n || typeof n.GroupCreate !== "function") return 0;
    try {
      return n.GroupCreate() || 0;
    } catch {
      return 0;
    }
  }

  function nativeLineHandle(geometry, material, kind) {
    const gh = ensureNativeGeometry(geometry);
    const mh = materialHandle(material);
    if (!gh || !mh) return 0;
    if (TN.cmd) {
      const id = TN.cmd.alloc();
      if (kind === "segments") TN.cmd.lineSeg(id, gh, mh);
      else if (kind === "loop") TN.cmd.lineLoop(id, gh, mh);
      else TN.cmd.line(id, gh, mh);
      return id;
    }
    const n = native();
    if (!n) return 0;
    const create =
      kind === "segments"
        ? n.LineSegmentsCreate
        : kind === "loop"
          ? n.LineLoopCreate
          : n.LineCreate;
    if (typeof create !== "function") return 0;
    try {
      return create(gh, mh) || 0;
    } catch {
      return 0;
    }
  }

  function nativePointsHandle(geometry, material) {
    const gh = ensureNativeGeometry(geometry);
    const mh = materialHandle(material);
    if (!gh || !mh) return 0;
    if (TN.cmd) {
      const id = TN.cmd.alloc();
      TN.cmd.points(id, gh, mh);
      return id;
    }
    const n = native();
    if (!n || typeof n.PointsCreate !== "function") return 0;
    try {
      return n.PointsCreate(gh, mh) || 0;
    } catch {
      return 0;
    }
  }

  function colorToHex(color) {
    if (color == null) return 0xffffff;
    if (typeof color === "number" && Number.isFinite(color)) return color >>> 0;
    if (typeof color.getHex === "function") return color.getHex() >>> 0;
    if (typeof color.r === "number") {
      return (
        ((Math.round(color.r * 255) & 255) << 16) |
        ((Math.round(color.g * 255) & 255) << 8) |
        (Math.round(color.b * 255) & 255)
      ) >>> 0;
    }
    return 0xffffff;
  }

  function instancedAttr(array, itemSize) {
    const Ctor = TN.InstancedBufferAttribute || TN.BufferAttribute;
    if (Ctor) return new Ctor(array, itemSize);
    return {
      array,
      itemSize,
      count: array ? (array.length / itemSize) | 0 : 0,
      needsUpdate: false,
    };
  }

  function writeMatrix(array, offset, matrix) {
    const e = matrix?.elements;
    if (e) {
      for (let i = 0; i < 16; i++) array[offset + i] = e[i];
      return;
    }
    if (matrix && typeof matrix.toArray === "function") {
      matrix.toArray(array, offset);
    }
  }

  function readMatrix(array, offset, matrix) {
    if (matrix?.elements) {
      for (let i = 0; i < 16; i++) matrix.elements[i] = array[offset + i];
      return matrix;
    }
    if (matrix && typeof matrix.fromArray === "function") {
      return matrix.fromArray(array, offset);
    }
    return matrix;
  }

  function writeColor(array, offset, color) {
    if (!color) {
      array[offset] = 1;
      array[offset + 1] = 1;
      array[offset + 2] = 1;
      return;
    }
    if (typeof color.toArray === "function") {
      color.toArray(array, offset);
      return;
    }
    array[offset] = color.r ?? 1;
    array[offset + 1] = color.g ?? 1;
    array[offset + 2] = color.b ?? 1;
  }

  const _identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const warned = Object.create(null);
  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn(message);
  }

  const FrontSide = TN.FrontSide ?? 0;
  const BackSide = TN.BackSide ?? 1;
  const Vector2 = TN.Vector2;
  const Vector3 = TN.Vector3;
  const Matrix4 = TN.Matrix4;
  const Ray = TN.Ray;
  const Sphere = TN.Sphere;
  const Triangle = TN.Triangle;
  const _inverseMatrix = Matrix4 ? new Matrix4() : null;
  const _ray = Ray ? new Ray() : null;
  const _sphere = Sphere ? new Sphere() : null;
  const _sphereHitAt = Vector3 ? new Vector3() : null;
  const _vA = Vector3 ? new Vector3() : null;
  const _vB = Vector3 ? new Vector3() : null;
  const _vC = Vector3 ? new Vector3() : null;
  const _intersectionPoint = Vector3 ? new Vector3() : null;
  const _intersectionPointWorld = Vector3 ? new Vector3() : null;
  const _barycoord = Vector3 ? new Vector3() : null;
  const _uv = Vector2 ? new Vector2() : null;
  const _uv1 = Vector2 ? new Vector2() : null;
  const _hitNormal = Vector3 ? new Vector3() : null;
  const _faceNormal = Vector3 ? new Vector3() : null;

  function checkIntersection(object, material, raycaster, ray, pA, pB, pC, point) {
    let intersect;
    const side = material && material.side;
    if (side === BackSide) {
      intersect = ray.intersectTriangle(pC, pB, pA, true, point);
    } else {
      intersect = ray.intersectTriangle(pA, pB, pC, side === FrontSide, point);
    }
    if (intersect === null) return null;
    _intersectionPointWorld.copy(point);
    _intersectionPointWorld.applyMatrix4(object.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(_intersectionPointWorld);
    if (distance < raycaster.near || distance > raycaster.far) return null;
    return {
      distance,
      point: _intersectionPointWorld.clone(),
      object,
    };
  }

  function checkGeometryIntersection(object, material, raycaster, ray, uv, uv1, normal, a, b, c) {
    object.getVertexPosition(a, _vA);
    object.getVertexPosition(b, _vB);
    object.getVertexPosition(c, _vC);
    const intersection = checkIntersection(object, material, raycaster, ray, _vA, _vB, _vC, _intersectionPoint);
    if (!intersection) return null;
    if (Triangle && typeof Triangle.getBarycoord === "function") {
      Triangle.getBarycoord(_intersectionPoint, _vA, _vB, _vC, _barycoord);
      intersection.barycoord = _barycoord.clone();
      if (uv && _uv && typeof Triangle.getInterpolatedAttribute === "function") {
        intersection.uv = Triangle.getInterpolatedAttribute(uv, a, b, c, _barycoord, _uv).clone();
      }
      if (uv1 && _uv1 && typeof Triangle.getInterpolatedAttribute === "function") {
        intersection.uv1 = Triangle.getInterpolatedAttribute(uv1, a, b, c, _barycoord, _uv1).clone();
      }
      if (normal && _hitNormal && typeof Triangle.getInterpolatedAttribute === "function") {
        intersection.normal = Triangle.getInterpolatedAttribute(normal, a, b, c, _barycoord, _hitNormal).clone();
        if (intersection.normal.dot(ray.direction) > 0) intersection.normal.multiplyScalar(-1);
      }
    }
    const face = {
      a,
      b,
      c,
      normal: _faceNormal ? _faceNormal.clone() : new Vector3(),
      materialIndex: 0,
    };
    if (Triangle && typeof Triangle.getNormal === "function") {
      Triangle.getNormal(_vA, _vB, _vC, face.normal);
    }
    intersection.face = face;
    return intersection;
  }

  function meshRaycast(raycaster, intersects) {
    const geometry = this.geometry;
    const material = this.material;
    if (material === undefined || !geometry || !_ray || !_sphere || !_inverseMatrix) return;
    if (typeof this.updateWorldMatrix === "function") this.updateWorldMatrix(true, false);
    if (geometry.boundingSphere === null && typeof geometry.computeBoundingSphere === "function") {
      geometry.computeBoundingSphere();
    }
    if (geometry.boundingSphere) {
      _sphere.copy(geometry.boundingSphere);
      _sphere.applyMatrix4(this.matrixWorld);
      _ray.copy(raycaster.ray).recast(raycaster.near);
      if (_sphere.containsPoint(_ray.origin) === false) {
        if (_ray.intersectSphere(_sphere, _sphereHitAt) === null) return;
        if (_ray.origin.distanceToSquared(_sphereHitAt) > (raycaster.far - raycaster.near) ** 2) return;
      }
    }
    _inverseMatrix.copy(this.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix);
    if (geometry.boundingBox !== null && _ray.intersectsBox(geometry.boundingBox) === false) return;

    const index = geometry.index;
    const position = geometry.attributes && geometry.attributes.position;
    const uv = geometry.attributes && geometry.attributes.uv;
    const uv1 = geometry.attributes && (geometry.attributes.uv1 || geometry.attributes.uv2);
    const normal = geometry.attributes && geometry.attributes.normal;
    const groups = geometry.groups || [];
    const drawRange = geometry.drawRange || { start: 0, count: Infinity };
    const materials = Array.isArray(material) ? material : null;

    function pushHit(intersection, faceIndex, materialIndex) {
      if (!intersection) return;
      intersection.faceIndex = faceIndex;
      if (intersection.face) intersection.face.materialIndex = materialIndex || 0;
      intersects.push(intersection);
    }

    if (index !== null && index !== undefined) {
      if (materials) {
        for (let i = 0, il = groups.length; i < il; i++) {
          const group = groups[i];
          const groupMaterial = materials[group.materialIndex];
          const start = Math.max(group.start, drawRange.start);
          const end = Math.min(index.count, Math.min(group.start + group.count, drawRange.start + drawRange.count));
          for (let j = start; j < end; j += 3) {
            const a = index.getX(j);
            const b = index.getX(j + 1);
            const c = index.getX(j + 2);
            pushHit(
              checkGeometryIntersection(this, groupMaterial, raycaster, _ray, uv, uv1, normal, a, b, c),
              Math.floor(j / 3),
              group.materialIndex
            );
          }
        }
      } else {
        const start = Math.max(0, drawRange.start);
        const end = Math.min(index.count, drawRange.start + drawRange.count);
        for (let i = start; i < end; i += 3) {
          const a = index.getX(i);
          const b = index.getX(i + 1);
          const c = index.getX(i + 2);
          pushHit(
            checkGeometryIntersection(this, material, raycaster, _ray, uv, uv1, normal, a, b, c),
            Math.floor(i / 3),
            0
          );
        }
      }
    } else if (position) {
      if (materials) {
        for (let i = 0, il = groups.length; i < il; i++) {
          const group = groups[i];
          const groupMaterial = materials[group.materialIndex];
          const start = Math.max(group.start, drawRange.start);
          const end = Math.min(position.count, Math.min(group.start + group.count, drawRange.start + drawRange.count));
          for (let j = start; j < end; j += 3) {
            pushHit(
              checkGeometryIntersection(this, groupMaterial, raycaster, _ray, uv, uv1, normal, j, j + 1, j + 2),
              Math.floor(j / 3),
              group.materialIndex
            );
          }
        }
      } else {
        const start = Math.max(0, drawRange.start);
        const end = Math.min(position.count, drawRange.start + drawRange.count);
        for (let i = start; i < end; i += 3) {
          pushHit(
            checkGeometryIntersection(this, material, raycaster, _ray, uv, uv1, normal, i, i + 1, i + 2),
            Math.floor(i / 3),
            0
          );
        }
      }
    }
  }

  class Mesh extends TN.Object3D {
    // Third arg is an already-created native handle (InstancedMesh / BatchedMesh).
    constructor(geometry, material, nativeHandle) {
      const handle =
        arguments.length > 2 ? nativeHandle || 0 : nativeMeshHandle(geometry, material);
      super(handle);
      this._h = handle;
      this.isMesh = true;
      this.type = "Mesh";
      this.geometry = geometry;
      installMaterial(this, material);
      this.morphTargetDictionary = undefined;
      this.morphTargetInfluences = undefined;
      this.count = 1;
      this.updateMorphTargets();
      if (!this._h && TN.cmd) TN.cmd.markPose(this);
    }
    updateMorphTargets() {}
    flushSelf() {
      if (!this._h) {
        const handle = this.isSkinnedMesh
          ? nativeSkinnedHandle(this.geometry, this.material)
          : nativeMeshHandle(this.geometry, this.material);
        if (handle) {
          this._h = handle;
          const parent = this.parent;
          if (parent && parent._h) {
            if (TN.cmd) TN.cmd.add(parent._h, this._h);
            else {
              const n = native();
              if (n && n.ObjectAdd) n.ObjectAdd(parent._h, this._h);
            }
          }
        }
      } else if (this.geometry) {
        ensureNativeGeometry(this.geometry);
      }
      if (typeof super.flushSelf === "function") return super.flushSelf();
      return this;
    }
    raycast(raycaster, intersects) {
      meshRaycast.call(this, raycaster, intersects);
    }
    getVertexPosition(index, target) {
      const position = this.geometry?.attributes?.position;
      if (!position || !target) return target;
      if (typeof target.fromBufferAttribute === "function") {
        return target.fromBufferAttribute(position, index);
      }
      if (typeof position.getX === "function") {
        return target.set(position.getX(index), position.getY(index), position.getZ(index));
      }
      const item = position.itemSize || 3;
      const a = position.array;
      const i = index * item;
      return target.set(a[i], a[i + 1], a[i + 2]);
    }
    copy(source, recursive) {
      if (typeof super.copy === "function") super.copy(source, recursive);
      this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
      this.geometry = source.geometry;
      if (source.morphTargetInfluences) {
        this.morphTargetInfluences = source.morphTargetInfluences.slice();
      }
      if (source.morphTargetDictionary) {
        this.morphTargetDictionary = Object.assign({}, source.morphTargetDictionary);
      }
      return this;
    }
    dispose() {
      if (this._h && typeof TN.releaseHandle === "function") {
        TN.releaseHandle(this._h);
        this._h = 0;
      }
    }
  }

  class Group extends TN.Object3D {
    constructor() {
      const handle = nativeGroupHandle();
      super(handle);
      this._h = handle;
      this.isGroup = true;
      this.type = "Group";
    }
  }

  class InstancedMesh extends Mesh {
    constructor(geometry, material, count = 1) {
      const n = native();
      ensureNativeGeometry(geometry);
      let handle = 0;
      const gh = geometry?._h || 0;
      const mh = materialHandle(material);
      if (TN.cmd && gh && mh) {
        handle = TN.cmd.alloc();
        TN.cmd.instanced(handle, gh, mh, count);
      } else if (n && typeof n.InstancedMeshCreate === "function" && gh && mh) {
        try {
          handle = n.InstancedMeshCreate(gh, mh, count) || 0;
        } catch {
          handle = 0;
        }
      }
      super(geometry, material, handle);
      this.isInstancedMesh = true;
      this.type = "InstancedMesh";
      this.count = count;
      this.instanceMatrix = instancedAttr(new Float32Array(count * 16), 16);
      this.instanceColor = null;
      this.morphTexture = null;
      this.boundingBox = null;
      this.boundingSphere = null;
      for (let i = 0; i < count; i++) {
        this.instanceMatrix.array.set(_identity, i * 16);
      }
    }
    setMatrixAt(index, matrix) {
      writeMatrix(this.instanceMatrix.array, index * 16, matrix);
      this.instanceMatrix.needsUpdate = true;
      if (this._h) {
        const slice = this.instanceMatrix.array.subarray(index * 16, index * 16 + 16);
        if (TN.cmd) TN.cmd.instMatrix(this._h, index, slice);
        else {
          const n = native();
          if (n && typeof n.InstancedSetMatrixAt === "function") {
            try {
              n.InstancedSetMatrixAt(this._h, index, f32ToB64(slice));
            } catch {
              /* native instance matrix optional */
            }
          }
        }
      }
      return this;
    }
    getMatrixAt(index, matrix) {
      return readMatrix(this.instanceMatrix.array, index * 16, matrix);
    }
    setColorAt(index, color) {
      if (this.instanceColor === null) {
        const n = this.instanceMatrix.count || this.count || 0;
        this.instanceColor = instancedAttr(new Float32Array(n * 3).fill(1), 3);
      }
      writeColor(this.instanceColor.array, index * 3, color);
      this.instanceColor.needsUpdate = true;
      if (this._h) {
        const hex = colorToHex(color);
        if (TN.cmd) TN.cmd.instColor(this._h, index, hex);
        else {
          const n = native();
          if (n && typeof n.InstancedSetColorAt === "function") {
            try {
              n.InstancedSetColorAt(this._h, index, hex);
            } catch {
              /* native instance color optional */
            }
          }
        }
      }
      return this;
    }
    getColorAt(index, color) {
      if (!color) return color;
      if (this.instanceColor === null) {
        if (typeof color.setRGB === "function") return color.setRGB(1, 1, 1);
        color.r = 1;
        color.g = 1;
        color.b = 1;
        return color;
      }
      const a = this.instanceColor.array;
      const o = index * 3;
      if (typeof color.fromArray === "function") return color.fromArray(a, o);
      if (typeof color.setRGB === "function") return color.setRGB(a[o], a[o + 1], a[o + 2]);
      color.r = a[o];
      color.g = a[o + 1];
      color.b = a[o + 2];
      return color;
    }
    fillGrid(spacing = 5.5) {
      const n = native();
      if (this._h && n && typeof n.InstancedFillGrid === "function") {
        n.InstancedFillGrid(this._h, spacing);
      }
      return this;
    }
    computeBoundingBox() {}
    computeBoundingSphere() {}
    updateMorphTargets() {}
    dispose() {
      super.dispose();
      if (this.morphTexture && typeof this.morphTexture.dispose === "function") {
        this.morphTexture.dispose();
        this.morphTexture = null;
      }
    }
  }

  class Line extends TN.Object3D {
    constructor(geometry, material, nativeHandle) {
      const handle =
        arguments.length > 2 ? nativeHandle || 0 : nativeLineHandle(geometry, material, "line");
      super(handle);
      this._h = handle;
      this.isLine = true;
      this.type = "Line";
      this.geometry = geometry;
      installMaterial(this, material);
      this.morphTargetDictionary = undefined;
      this.morphTargetInfluences = undefined;
      this.updateMorphTargets();
    }
    updateMorphTargets() {}
    raycast() {}
    computeLineDistances() {
      const geometry = this.geometry;
      const position = geometry?.attributes?.position;
      if (!geometry || geometry.index || !position) return this;
      const lineDistances = [0];
      const _a = TN.Vector3 ? new TN.Vector3() : null;
      const _b = TN.Vector3 ? new TN.Vector3() : null;
      for (let i = 1, l = position.count; i < l; i++) {
        let d = 0;
        if (_a && typeof _a.fromBufferAttribute === "function") {
          _a.fromBufferAttribute(position, i - 1);
          _b.fromBufferAttribute(position, i);
          d = _a.distanceTo(_b);
        } else {
          const s = (i - 1) * 3;
          const e = i * 3;
          const a = position.array;
          d = Math.hypot(a[e] - a[s], a[e + 1] - a[s + 1], a[e + 2] - a[s + 2]);
        }
        lineDistances[i] = lineDistances[i - 1] + d;
      }
      const Attr = TN.Float32BufferAttribute || TN.BufferAttribute;
      if (geometry.setAttribute && Attr) {
        geometry.setAttribute("lineDistance", new Attr(lineDistances, 1));
      }
      return this;
    }
    copy(source, recursive) {
      if (typeof super.copy === "function") super.copy(source, recursive);
      this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
      this.geometry = source.geometry;
      return this;
    }
  }

  class LineSegments extends Line {
    constructor(geometry, material) {
      super(geometry, material, nativeLineHandle(geometry, material, "segments"));
      this.isLineSegments = true;
      this.type = "LineSegments";
    }
    computeLineDistances() {
      const geometry = this.geometry;
      const position = geometry?.attributes?.position;
      if (!geometry || geometry.index || !position) return this;
      const lineDistances = [];
      const _a = TN.Vector3 ? new TN.Vector3() : null;
      const _b = TN.Vector3 ? new TN.Vector3() : null;
      for (let i = 0, l = position.count; i < l; i += 2) {
        let d = 0;
        if (_a && typeof _a.fromBufferAttribute === "function") {
          _a.fromBufferAttribute(position, i);
          _b.fromBufferAttribute(position, i + 1);
          d = _a.distanceTo(_b);
        } else {
          const s = i * 3;
          const e = (i + 1) * 3;
          const a = position.array;
          d = Math.hypot(a[e] - a[s], a[e + 1] - a[s + 1], a[e + 2] - a[s + 2]);
        }
        lineDistances[i] = i === 0 ? 0 : lineDistances[i - 1];
        lineDistances[i + 1] = lineDistances[i] + d;
      }
      const Attr = TN.Float32BufferAttribute || TN.BufferAttribute;
      if (geometry.setAttribute && Attr) {
        geometry.setAttribute("lineDistance", new Attr(lineDistances, 1));
      }
      return this;
    }
  }

  class LineLoop extends Line {
    constructor(geometry, material) {
      super(geometry, material, nativeLineHandle(geometry, material, "loop"));
      this.isLineLoop = true;
      this.type = "LineLoop";
    }
  }

  class Points extends TN.Object3D {
    constructor(geometry, material) {
      const handle = nativePointsHandle(geometry, material);
      super(handle);
      this._h = handle;
      this.isPoints = true;
      this.type = "Points";
      this.geometry = geometry;
      installMaterial(this, material);
      this.morphTargetDictionary = undefined;
      this.morphTargetInfluences = undefined;
      this.updateMorphTargets();
    }
    updateMorphTargets() {}
    raycast() {}
    copy(source, recursive) {
      if (typeof super.copy === "function") super.copy(source, recursive);
      this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
      this.geometry = source.geometry;
      return this;
    }
  }

  let _spriteGeometry;
  function spriteGeometry() {
    if (_spriteGeometry) return _spriteGeometry;
    if (!TN.BufferGeometry) return { attributes: {}, _h: 0 };
    const g = new TN.BufferGeometry();
    const Attr = TN.BufferAttribute || TN.Float32BufferAttribute;
    if (Attr) {
      g.setAttribute?.(
        "position",
        new Attr(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)
      );
      g.setAttribute?.("uv", new Attr(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    }
    g.setIndex?.([0, 1, 2, 0, 2, 3]);
    _spriteGeometry = g;
    return g;
  }

  class Sprite extends TN.Object3D {
    constructor(material) {
      const geometry = spriteGeometry();
      let handle = 0;
      const mh = materialHandle(material);
      if (TN.cmd && mh) {
        handle = TN.cmd.alloc();
        TN.cmd.sprite(handle, mh);
      } else {
        const n = native();
        if (n && typeof n.SpriteCreate === "function") {
          try {
            handle = n.SpriteCreate(mh) || 0;
          } catch {
            handle = 0;
          }
        }
      }
      super(handle);
      this._h = handle;
      this.isSprite = true;
      this.type = "Sprite";
      this.geometry = geometry;
      installMaterial(this, material);
      this.center = TN.Vector2 ? new TN.Vector2(0.5, 0.5) : { x: 0.5, y: 0.5 };
      this.count = 1;
    }
    raycast() {}
    copy(source, recursive) {
      if (typeof super.copy === "function") super.copy(source, recursive);
      if (source.center && this.center?.copy) this.center.copy(source.center);
      this.material = source.material;
      return this;
    }
  }

  class LOD extends TN.Object3D {
    constructor() {
      let handle = 0;
      const n = native();
      if (n && typeof n.LodCreate === "function") {
        try {
          handle = n.LodCreate() || 0;
        } catch {
          handle = 0;
        }
      }
      super(handle);
      this._h = handle;
      this.isLOD = true;
      this.type = "LOD";
      this.levels = [];
      this.autoUpdate = true;
      this._currentLevel = 0;
    }
    addLevel(object, distance = 0, hysteresis = 0) {
      distance = Math.abs(distance);
      const levels = this.levels;
      let l = 0;
      for (; l < levels.length; l++) {
        if (distance < levels[l].distance) break;
      }
      levels.splice(l, 0, { distance, hysteresis, object });
      this.add(object);
      const n = native();
      if (this._h && object?._h && n && typeof n.LodAddLevel === "function") {
        try {
          n.LodAddLevel(this._h, object._h, distance);
        } catch {
          /* native lod optional */
        }
      }
      return this;
    }
    removeLevel(distance) {
      const levels = this.levels;
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].distance === distance) {
          const removed = levels.splice(i, 1);
          this.remove(removed[0].object);
          return true;
        }
      }
      return false;
    }
    getCurrentLevel() {
      return this._currentLevel;
    }
    getObjectForDistance(distance) {
      const levels = this.levels;
      if (levels.length === 0) return null;
      let i = 1;
      const count = levels.length;
      for (; i < count; i++) {
        let levelDistance = levels[i].distance;
        if (levels[i].object.visible) {
          levelDistance -= levelDistance * levels[i].hysteresis;
        }
        if (distance < levelDistance) break;
      }
      return levels[i - 1].object;
    }
    update(camera) {
      const n = native();
      if (this._h && camera?._h && n && typeof n.LodUpdate === "function") {
        try {
          n.LodUpdate(this._h, camera._h);
        } catch {
          /* native lod optional */
        }
      }
      const levels = this.levels;
      if (levels.length < 2 || !camera?.matrixWorld || !this.matrixWorld) return;
      const ce = camera.matrixWorld.elements;
      const te = this.matrixWorld.elements;
      const distance =
        Math.hypot(ce[12] - te[12], ce[13] - te[13], ce[14] - te[14]) / (camera.zoom || 1);
      levels[0].object.visible = true;
      let i = 1;
      const count = levels.length;
      for (; i < count; i++) {
        let levelDistance = levels[i].distance;
        if (levels[i].object.visible) {
          levelDistance -= levelDistance * levels[i].hysteresis;
        }
        if (distance >= levelDistance) {
          levels[i - 1].object.visible = false;
          levels[i].object.visible = true;
        } else {
          break;
        }
      }
      this._currentLevel = i - 1;
      for (; i < count; i++) {
        levels[i].object.visible = false;
      }
    }
    raycast() {}
    copy(source) {
      if (typeof super.copy === "function") super.copy(source, false);
      const levels = source.levels || [];
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        const object = level.object.clone ? level.object.clone() : level.object;
        this.addLevel(object, level.distance, level.hysteresis);
      }
      this.autoUpdate = source.autoUpdate;
      return this;
    }
  }

  class Bone extends TN.Object3D {
    constructor() {
      let handle = 0;
      const n = native();
      if (n && typeof n.BoneCreate === "function") {
        try {
          handle = n.BoneCreate() || 0;
        } catch {
          handle = 0;
        }
      }
      super(handle);
      this._h = handle;
      this.isBone = true;
      this.type = "Bone";
    }
  }

  function newMatrix4() {
    return TN.Matrix4 ? new TN.Matrix4() : { elements: _identity.slice() };
  }

  class Skeleton {
    constructor(bones = [], boneInverses = []) {
      this.uuid = TN.MathUtils?.generateUUID?.() || "";
      this.bones = bones.slice(0);
      this.boneInverses = boneInverses;
      this.boneMatrices = null;
      this.boneTexture = null;
      this.init();
    }
    init() {
      const bones = this.bones;
      const boneInverses = this.boneInverses;
      this.boneMatrices = new Float32Array(bones.length * 16);
      if (boneInverses.length === 0) {
        this.calculateInverses();
      } else if (bones.length !== boneInverses.length) {
        this.boneInverses = [];
        for (let i = 0; i < bones.length; i++) this.boneInverses.push(newMatrix4());
      }
      const n = native();
      if (n && typeof n.SkeletonCreate === "function") {
        try {
          this._h = n.SkeletonCreate(
            this.bones.map((b) => b._h || 0).filter(Boolean).join(",")
          ) || 0;
        } catch {
          this._h = 0;
        }
      }
    }
    calculateInverses() {
      this.boneInverses.length = 0;
      for (let i = 0; i < this.bones.length; i++) {
        const inverse = newMatrix4();
        const bone = this.bones[i];
        if (bone?.matrixWorld && typeof inverse.copy === "function") {
          inverse.copy(bone.matrixWorld);
          if (typeof inverse.invert === "function") inverse.invert();
        }
        this.boneInverses.push(inverse);
      }
    }
    pose() {
      for (let i = 0; i < this.bones.length; i++) {
        const bone = this.bones[i];
        if (!bone) continue;
        if (bone.matrixWorld?.copy && this.boneInverses[i]) {
          bone.matrixWorld.copy(this.boneInverses[i]);
          if (typeof bone.matrixWorld.invert === "function") bone.matrixWorld.invert();
        }
      }
      for (let i = 0; i < this.bones.length; i++) {
        const bone = this.bones[i];
        if (!bone) continue;
        if (bone.parent?.isBone && bone.matrix?.copy && bone.parent.matrixWorld) {
          bone.matrix.copy(bone.parent.matrixWorld);
          if (typeof bone.matrix.invert === "function") bone.matrix.invert();
          if (typeof bone.matrix.multiply === "function") bone.matrix.multiply(bone.matrixWorld);
        } else if (bone.matrix?.copy) {
          bone.matrix.copy(bone.matrixWorld);
        }
        if (typeof bone.matrix?.decompose === "function") {
          bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
        }
      }
    }
    update() {
      const bones = this.bones;
      const boneInverses = this.boneInverses;
      const boneMatrices = this.boneMatrices;
      const offset = newMatrix4();
      for (let i = 0; i < bones.length; i++) {
        const matrix = bones[i] ? bones[i].matrixWorld : null;
        if (offset.multiplyMatrices && matrix && boneInverses[i]) {
          offset.multiplyMatrices(matrix, boneInverses[i]);
        } else if (offset.copy && matrix) {
          offset.copy(matrix);
        }
        writeMatrix(boneMatrices, i * 16, offset);
      }
      if (this.boneTexture) this.boneTexture.needsUpdate = true;
    }
    clone() {
      return new Skeleton(this.bones, this.boneInverses);
    }
    computeBoneTexture() {
      return this;
    }
    getBoneByName(name) {
      for (let i = 0; i < this.bones.length; i++) {
        if (this.bones[i]?.name === name) return this.bones[i];
      }
      return undefined;
    }
    dispose() {
      if (this.boneTexture && typeof this.boneTexture.dispose === "function") {
        this.boneTexture.dispose();
      }
      this.boneTexture = null;
    }
    fromJSON(json, bones) {
      this.uuid = json.uuid;
      this.bones = [];
      this.boneInverses = [];
      for (let i = 0; i < json.bones.length; i++) {
        this.bones.push(bones[json.bones[i]] || new Bone());
        const inverse = newMatrix4();
        if (typeof inverse.fromArray === "function") inverse.fromArray(json.boneInverses[i]);
        this.boneInverses.push(inverse);
      }
      this.init();
      return this;
    }
    toJSON() {
      const data = { uuid: this.uuid, bones: [], boneInverses: [] };
      for (let i = 0; i < this.bones.length; i++) {
        data.bones.push(this.bones[i].uuid);
        const inv = this.boneInverses[i];
        data.boneInverses.push(inv?.toArray ? inv.toArray() : inv?.elements?.slice?.() || []);
      }
      return data;
    }
  }

  class SkinnedMesh extends Mesh {
    constructor(geometry, material) {
      super(geometry, material, nativeSkinnedHandle(geometry, material));
      this.isSkinnedMesh = true;
      this.type = "SkinnedMesh";
      this.bindMode = TN.AttachedBindMode || "attached";
      this.bindMatrix = newMatrix4();
      this.bindMatrixInverse = newMatrix4();
      this.boundingBox = null;
      this.boundingSphere = null;
      this.skeleton = null;
    }
    bind(skeleton, bindMatrix) {
      this.skeleton = skeleton;
      if (bindMatrix === undefined) {
        if (typeof this.updateMatrixWorld === "function") this.updateMatrixWorld(true);
        skeleton?.calculateInverses?.();
        bindMatrix = this.matrixWorld;
      }
      if (this.bindMatrix?.copy && bindMatrix) {
        this.bindMatrix.copy(bindMatrix);
        if (this.bindMatrixInverse.copy) {
          this.bindMatrixInverse.copy(bindMatrix);
          if (typeof this.bindMatrixInverse.invert === "function") this.bindMatrixInverse.invert();
        }
      }
      if (this._h && skeleton?._h) {
        if (TN.cmd && typeof TN.cmd.skinnedBind === "function") {
          TN.cmd.skinnedBind(this._h, skeleton._h);
        } else {
          const n = native();
          if (n && typeof n.SkinnedBind === "function") {
            try {
              n.SkinnedBind(this._h, skeleton._h);
            } catch {
              /* native skin bind optional */
            }
          }
        }
        applySkeletonInverses(skeleton);
      }
    }
    pose() {
      this.skeleton?.pose?.();
    }
    normalizeSkinWeights() {
      const skinWeight = this.geometry?.attributes?.skinWeight;
      if (!skinWeight) return;
      for (let i = 0, l = skinWeight.count; i < l; i++) {
        const x = skinWeight.getX(i);
        const y = skinWeight.getY(i);
        const z = skinWeight.getZ(i);
        const w = typeof skinWeight.getW === "function" ? skinWeight.getW(i) : 0;
        const scale = 1 / (Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(w));
        if (Number.isFinite(scale)) {
          skinWeight.setX(i, x * scale);
          skinWeight.setY(i, y * scale);
          skinWeight.setZ(i, z * scale);
          skinWeight.setComponent?.(i, 3, w * scale);
        } else {
          skinWeight.setX(i, 1);
          skinWeight.setY(i, 0);
          skinWeight.setZ(i, 0);
          skinWeight.setComponent?.(i, 3, 0);
        }
      }
    }
    applyBoneTransform(index, target) {
      return target;
    }
    getVertexPosition(index, target) {
      super.getVertexPosition(index, target);
      return this.applyBoneTransform(index, target);
    }
    computeBoundingBox() {}
    computeBoundingSphere() {
      const Sphere = TN.Sphere;
      if (!this.boundingSphere) {
        this.boundingSphere = Sphere ? new Sphere() : { center: { x: 0, y: 0, z: 0 }, radius: 0 };
      }
      const geo = this.geometry;
      if (geo && geo.boundingSphere == null && typeof geo.computeBoundingSphere === "function") {
        geo.computeBoundingSphere();
      }
      if (geo && geo.boundingSphere && typeof this.boundingSphere.copy === "function") {
        this.boundingSphere.copy(geo.boundingSphere);
      }
      return this;
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.bindMode = source.bindMode;
      if (this.bindMatrix?.copy && source.bindMatrix) this.bindMatrix.copy(source.bindMatrix);
      if (this.bindMatrixInverse?.copy && source.bindMatrixInverse) {
        this.bindMatrixInverse.copy(source.bindMatrixInverse);
      }
      this.skeleton = source.skeleton;
      return this;
    }
  }

  function copyAttributeData(src, target, targetOffset = 0) {
    const itemSize = target.itemSize;
    if (!src || !target || !target.array) return;
    if (src.isInterleavedBufferAttribute || !src.array || src.array.constructor !== target.array.constructor) {
      const vertexCount = src.count;
      for (let i = 0; i < vertexCount; i++) {
        for (let c = 0; c < itemSize; c++) {
          target.setComponent(i + targetOffset, c, src.getComponent(i, c));
        }
      }
    } else {
      target.array.set(src.array, targetOffset * itemSize);
    }
    target.needsUpdate = true;
  }

  const Box3 = TN.Box3;
  const Color = TN.Color;
  const BufferAttribute = TN.BufferAttribute;
  const DataTexture = TN.DataTexture;
  const RGBAFormat = TN.RGBAFormat ?? 1023;
  const FloatType = TN.FloatType ?? 1015;
  const RedIntegerFormat = TN.RedIntegerFormat ?? 1029;
  const UnsignedIntType = TN.UnsignedIntType ?? 1014;
  const _batchMatrix = Matrix4 ? new Matrix4() : null;
  const _batchBox = Box3 ? new Box3() : null;
  const _batchSphere = Sphere ? new Sphere() : null;
  const _batchVec = Vector3 ? new Vector3() : null;

  class BatchedMesh extends Mesh {
    constructor(maxInstanceCount, maxVertexCount, maxIndexCount, material) {
      if (maxIndexCount === undefined) maxIndexCount = maxVertexCount * 2;
      const geometry = TN.BufferGeometry ? new TN.BufferGeometry() : { attributes: {}, index: null, _h: 0 };
      super(geometry, material, nativeGroupHandle());
      this.isBatchedMesh = true;
      this.type = "BatchedMesh";
      this.perObjectFrustumCulled = true;
      this.sortObjects = true;
      this.boundingBox = null;
      this.boundingSphere = null;
      this.customSort = null;
      this._maxInstanceCount = maxInstanceCount | 0;
      this._maxVertexCount = maxVertexCount | 0;
      this._maxIndexCount = maxIndexCount | 0;
      this._instanceInfo = [];
      this._geometryInfo = [];
      this._availableInstanceIds = [];
      this._availableGeometryIds = [];
      this._nextIndexStart = 0;
      this._nextVertexStart = 0;
      this._geometryCount = 0;
      this._visibilityChanged = true;
      this._geometryInitialized = false;
      this._multiDrawCounts = new Int32Array(Math.max(1, this._maxInstanceCount));
      this._multiDrawStarts = new Int32Array(Math.max(1, this._maxInstanceCount));
      this._multiDrawCount = 0;
      this._multiDrawBytesPerElement = 1;
      this._matricesTexture = null;
      this._indirectTexture = null;
      this._colorsTexture = null;
      this._nativeBatches = [];
      this._nativeBatchesDirty = true;
      this._initMatricesTexture();
      this._initIndirectTexture();
      if (TN.cmd) TN.cmd.markPose(this);
    }
    _initMatricesTexture() {
      if (!DataTexture) return;
      let size = Math.sqrt(this._maxInstanceCount * 4);
      size = Math.ceil(size / 4) * 4;
      size = Math.max(size, 4);
      const matricesArray = new Float32Array(size * size * 4);
      this._matricesTexture = new DataTexture(matricesArray, size, size, RGBAFormat, FloatType);
    }
    _initIndirectTexture() {
      if (!DataTexture) return;
      let size = Math.ceil(Math.sqrt(this._maxInstanceCount));
      size = Math.max(size, 1);
      const indirectArray = new Uint32Array(size * size);
      this._indirectTexture = new DataTexture(indirectArray, size, size, RedIntegerFormat, UnsignedIntType);
    }
    _initColorsTexture() {
      if (!DataTexture) return;
      let size = Math.ceil(Math.sqrt(this._maxInstanceCount));
      size = Math.max(size, 1);
      const colorsArray = new Float32Array(size * size * 4).fill(1);
      this._colorsTexture = new DataTexture(colorsArray, size, size, RGBAFormat, FloatType);
    }
    _initializeGeometry(reference) {
      const geometry = this.geometry;
      if (this._geometryInitialized || !reference || !geometry || !BufferAttribute) return;
      const attrs = reference.attributes || {};
      for (const attributeName in attrs) {
        const srcAttribute = typeof reference.getAttribute === "function"
          ? reference.getAttribute(attributeName)
          : attrs[attributeName];
        if (!srcAttribute || !srcAttribute.array) continue;
        const dstArray = new srcAttribute.array.constructor(this._maxVertexCount * srcAttribute.itemSize);
        geometry.setAttribute(
          attributeName,
          new BufferAttribute(dstArray, srcAttribute.itemSize, srcAttribute.normalized)
        );
      }
      const srcIndex = typeof reference.getIndex === "function" ? reference.getIndex() : reference.index;
      if (srcIndex) {
        const indexArray =
          this._maxVertexCount > 65535
            ? new Uint32Array(this._maxIndexCount)
            : new Uint16Array(this._maxIndexCount);
        geometry.setIndex(new BufferAttribute(indexArray, 1));
      }
      this._geometryInitialized = true;
    }
    _validateGeometry(geometry) {
      const batchGeometry = this.geometry;
      const srcIndex = typeof geometry.getIndex === "function" ? geometry.getIndex() : geometry.index;
      const dstIndex = typeof batchGeometry.getIndex === "function" ? batchGeometry.getIndex() : batchGeometry.index;
      if (Boolean(srcIndex) !== Boolean(dstIndex)) {
        throw new Error('THREE.BatchedMesh: All geometries must consistently have "index".');
      }
      const attrs = batchGeometry.attributes || {};
      for (const attributeName in attrs) {
        if (typeof geometry.hasAttribute === "function") {
          if (!geometry.hasAttribute(attributeName)) {
            throw new Error('THREE.BatchedMesh: Added geometry missing "' + attributeName + '".');
          }
        }
      }
    }
    get maxInstanceCount() {
      return this._maxInstanceCount;
    }
    get instanceCount() {
      return this._instanceInfo.length - this._availableInstanceIds.length;
    }
    get unusedVertexCount() {
      return this._maxVertexCount - this._nextVertexStart;
    }
    get unusedIndexCount() {
      return this._maxIndexCount - this._nextIndexStart;
    }
    validateInstanceId(instanceId) {
      const instanceInfo = this._instanceInfo;
      if (instanceId < 0 || instanceId >= instanceInfo.length || instanceInfo[instanceId].active === false) {
        throw new Error("THREE.BatchedMesh: Invalid instanceId " + instanceId + ".");
      }
    }
    validateGeometryId(geometryId) {
      const geometryInfoList = this._geometryInfo;
      if (geometryId < 0 || geometryId >= geometryInfoList.length || geometryInfoList[geometryId].active === false) {
        throw new Error("THREE.BatchedMesh: Invalid geometryId " + geometryId + ".");
      }
    }
    setCustomSort(func) {
      this.customSort = func;
      return this;
    }
    computeBoundingBox() {
      if (!this.boundingBox && Box3) this.boundingBox = new Box3();
      if (!this.boundingBox) return;
      this.boundingBox.makeEmpty();
      for (let i = 0, l = this._instanceInfo.length; i < l; i++) {
        if (this._instanceInfo[i].active === false) continue;
        if (!this.getBoundingBoxAt(this._instanceInfo[i].geometryIndex, _batchBox)) continue;
        this.getMatrixAt(i, _batchMatrix);
        _batchBox.applyMatrix4(_batchMatrix);
        this.boundingBox.union(_batchBox);
      }
    }
    computeBoundingSphere() {
      if (!this.boundingSphere && Sphere) this.boundingSphere = new Sphere();
      if (!this.boundingSphere) return;
      this.boundingSphere.makeEmpty();
      for (let i = 0, l = this._instanceInfo.length; i < l; i++) {
        if (this._instanceInfo[i].active === false) continue;
        if (!this.getBoundingSphereAt(this._instanceInfo[i].geometryIndex, _batchSphere)) continue;
        this.getMatrixAt(i, _batchMatrix);
        _batchSphere.applyMatrix4(_batchMatrix);
        this.boundingSphere.union(_batchSphere);
      }
    }
    addGeometry(geometry, reservedVertexCount = -1, reservedIndexCount = -1) {
      this._initializeGeometry(geometry);
      this._validateGeometry(geometry);
      const pos = geometry.getAttribute ? geometry.getAttribute("position") : geometry.attributes.position;
      const index = geometry.getIndex ? geometry.getIndex() : geometry.index;
      const geometryInfo = {
        vertexStart: this._nextVertexStart,
        vertexCount: pos ? pos.count : 0,
        reservedVertexCount: reservedVertexCount === -1 ? (pos ? pos.count : 0) : reservedVertexCount,
        indexStart: -1,
        indexCount: -1,
        reservedIndexCount: -1,
        start: -1,
        count: -1,
        boundingBox: null,
        boundingSphere: null,
        active: true,
        sourceGeometry: geometry,
      };
      if (index) {
        geometryInfo.indexStart = this._nextIndexStart;
        geometryInfo.reservedIndexCount = reservedIndexCount === -1 ? index.count : reservedIndexCount;
      }
      if (
        (geometryInfo.indexStart !== -1 &&
          geometryInfo.indexStart + geometryInfo.reservedIndexCount > this._maxIndexCount) ||
        geometryInfo.vertexStart + geometryInfo.reservedVertexCount > this._maxVertexCount
      ) {
        throw new Error("THREE.BatchedMesh: Reserved space request exceeds the maximum buffer size.");
      }
      let geometryId;
      if (this._availableGeometryIds.length) {
        this._availableGeometryIds.sort((a, b) => a - b);
        geometryId = this._availableGeometryIds.shift();
        this._geometryInfo[geometryId] = geometryInfo;
      } else {
        geometryId = this._geometryCount++;
        this._geometryInfo.push(geometryInfo);
      }
      this.setGeometryAt(geometryId, geometry);
      this._nextIndexStart = geometryInfo.indexStart === -1
        ? this._nextIndexStart
        : geometryInfo.indexStart + geometryInfo.reservedIndexCount;
      this._nextVertexStart = geometryInfo.vertexStart + geometryInfo.reservedVertexCount;
      this._nativeBatchesDirty = true;
      return geometryId;
    }
    addInstance(geometryId) {
      if (this._instanceInfo.length >= this.maxInstanceCount && this._availableInstanceIds.length === 0) {
        throw new Error("THREE.BatchedMesh: Maximum item count reached.");
      }
      const instanceInfo = { visible: true, active: true, geometryIndex: geometryId };
      let drawId;
      if (this._availableInstanceIds.length > 0) {
        this._availableInstanceIds.sort((a, b) => a - b);
        drawId = this._availableInstanceIds.shift();
        this._instanceInfo[drawId] = instanceInfo;
      } else {
        drawId = this._instanceInfo.length;
        this._instanceInfo.push(instanceInfo);
      }
      const matricesTexture = this._matricesTexture;
      if (matricesTexture && _batchMatrix) {
        _batchMatrix.identity().toArray(matricesTexture.image.data, drawId * 16);
        matricesTexture.needsUpdate = true;
      }
      this._visibilityChanged = true;
      this._nativeBatchesDirty = true;
      if (TN.cmd) TN.cmd.markPose(this);
      return drawId;
    }
    setGeometryAt(geometryId, geometry) {
      if (geometryId >= this._geometryCount) {
        throw new Error("THREE.BatchedMesh: Maximum geometry count reached.");
      }
      this._validateGeometry(geometry);
      const batchGeometry = this.geometry;
      const hasIndex = (batchGeometry.getIndex ? batchGeometry.getIndex() : batchGeometry.index) !== null;
      const dstIndex = batchGeometry.getIndex ? batchGeometry.getIndex() : batchGeometry.index;
      const srcIndex = geometry.getIndex ? geometry.getIndex() : geometry.index;
      const geometryInfo = this._geometryInfo[geometryId];
      const srcPos = geometry.getAttribute ? geometry.getAttribute("position") : geometry.attributes.position;
      if (
        (hasIndex && srcIndex && srcIndex.count > geometryInfo.reservedIndexCount) ||
        (srcPos && srcPos.count > geometryInfo.reservedVertexCount)
      ) {
        throw new Error("THREE.BatchedMesh: Reserved space not large enough for provided geometry.");
      }
      const vertexStart = geometryInfo.vertexStart;
      const reservedVertexCount = geometryInfo.reservedVertexCount;
      geometryInfo.vertexCount = srcPos ? srcPos.count : 0;
      geometryInfo.sourceGeometry = geometry;
      const attrs = batchGeometry.attributes || {};
      for (const attributeName in attrs) {
        const srcAttribute = geometry.getAttribute
          ? geometry.getAttribute(attributeName)
          : geometry.attributes[attributeName];
        const dstAttribute = attrs[attributeName];
        if (!srcAttribute || !dstAttribute) continue;
        copyAttributeData(srcAttribute, dstAttribute, vertexStart);
        const itemSize = srcAttribute.itemSize;
        for (let i = srcAttribute.count; i < reservedVertexCount; i++) {
          const index = vertexStart + i;
          for (let c = 0; c < itemSize; c++) dstAttribute.setComponent(index, c, 0);
        }
        dstAttribute.needsUpdate = true;
        if (typeof dstAttribute.addUpdateRange === "function") {
          dstAttribute.addUpdateRange(vertexStart * itemSize, reservedVertexCount * itemSize);
        }
      }
      if (hasIndex && srcIndex && dstIndex) {
        const indexStart = geometryInfo.indexStart;
        geometryInfo.indexCount = srcIndex.count;
        for (let i = 0; i < srcIndex.count; i++) {
          dstIndex.setX(indexStart + i, vertexStart + srcIndex.getX(i));
        }
        for (let i = srcIndex.count; i < geometryInfo.reservedIndexCount; i++) {
          dstIndex.setX(indexStart + i, vertexStart);
        }
        dstIndex.needsUpdate = true;
        if (typeof dstIndex.addUpdateRange === "function") {
          dstIndex.addUpdateRange(indexStart, geometryInfo.reservedIndexCount);
        }
      }
      geometryInfo.start = hasIndex ? geometryInfo.indexStart : geometryInfo.vertexStart;
      geometryInfo.count = hasIndex ? geometryInfo.indexCount : geometryInfo.vertexCount;
      geometryInfo.boundingBox = geometry.boundingBox ? geometry.boundingBox.clone() : null;
      geometryInfo.boundingSphere = geometry.boundingSphere ? geometry.boundingSphere.clone() : null;
      this._visibilityChanged = true;
      this._nativeBatchesDirty = true;
      return geometryId;
    }
    deleteGeometry(geometryId) {
      const info = this._geometryInfo[geometryId];
      if (!info || !info.active) return this;
      for (let i = 0; i < this._instanceInfo.length; i++) {
        if (this._instanceInfo[i].active && this._instanceInfo[i].geometryIndex === geometryId) {
          this.deleteInstance(i);
        }
      }
      info.active = false;
      this._availableGeometryIds.push(geometryId);
      this._visibilityChanged = true;
      this._nativeBatchesDirty = true;
      return this;
    }
    deleteInstance(instanceId) {
      const info = this._instanceInfo[instanceId];
      if (!info || !info.active) return this;
      info.active = false;
      this._availableInstanceIds.push(instanceId);
      this._visibilityChanged = true;
      this._nativeBatchesDirty = true;
      return this;
    }
    optimize() {
      return this;
    }
    getBoundingBoxAt(geometryId, target) {
      if (!target || geometryId >= this._geometryCount) return null;
      const geometry = this.geometry;
      const geometryInfo = this._geometryInfo[geometryId];
      if (!geometryInfo) return null;
      if (geometryInfo.boundingBox === null && Box3 && _batchVec) {
        const box = new Box3();
        const index = geometry.getIndex ? geometry.getIndex() : geometry.index;
        const position = geometry.attributes && geometry.attributes.position;
        if (position) {
          for (let i = geometryInfo.start, l = geometryInfo.start + geometryInfo.count; i < l; i++) {
            const iv = index ? index.getX(i) : i;
            box.expandByPoint(_batchVec.fromBufferAttribute(position, iv));
          }
        }
        geometryInfo.boundingBox = box;
      }
      if (!geometryInfo.boundingBox) return null;
      target.copy(geometryInfo.boundingBox);
      return target;
    }
    getBoundingSphereAt(geometryId, target) {
      if (!target || geometryId >= this._geometryCount) return null;
      const geometryInfo = this._geometryInfo[geometryId];
      if (!geometryInfo) return null;
      if (geometryInfo.boundingSphere === null && Sphere && _batchVec && _batchBox) {
        const sphere = new Sphere();
        this.getBoundingBoxAt(geometryId, _batchBox);
        _batchBox.getCenter(sphere.center);
        const geometry = this.geometry;
        const index = geometry.getIndex ? geometry.getIndex() : geometry.index;
        const position = geometry.attributes && geometry.attributes.position;
        let maxRadiusSq = 0;
        if (position) {
          for (let i = geometryInfo.start, l = geometryInfo.start + geometryInfo.count; i < l; i++) {
            const iv = index ? index.getX(i) : i;
            _batchVec.fromBufferAttribute(position, iv);
            maxRadiusSq = Math.max(maxRadiusSq, sphere.center.distanceToSquared(_batchVec));
          }
        }
        sphere.radius = Math.sqrt(maxRadiusSq);
        geometryInfo.boundingSphere = sphere;
      }
      if (!geometryInfo.boundingSphere) return null;
      target.copy(geometryInfo.boundingSphere);
      return target;
    }
    setMatrixAt(instanceId, matrix) {
      this.validateInstanceId(instanceId);
      const matricesTexture = this._matricesTexture;
      if (matricesTexture && matrix && typeof matrix.toArray === "function") {
        matrix.toArray(matricesTexture.image.data, instanceId * 16);
        matricesTexture.needsUpdate = true;
      } else {
        writeMatrix(this._matricesTexture ? this._matricesTexture.image.data : this._matrices, instanceId * 16, matrix);
      }
      this._nativeBatchesDirty = true;
      if (TN.cmd) TN.cmd.markPose(this);
      return this;
    }
    getMatrixAt(instanceId, matrix) {
      this.validateInstanceId(instanceId);
      const data = this._matricesTexture ? this._matricesTexture.image.data : this._matrices;
      if (matrix && typeof matrix.fromArray === "function") return matrix.fromArray(data, instanceId * 16);
      return readMatrix(data, instanceId * 16, matrix);
    }
    setColorAt(instanceId, color) {
      this.validateInstanceId(instanceId);
      if (this._colorsTexture === null) this._initColorsTexture();
      if (this._colorsTexture && color && typeof color.toArray === "function") {
        color.toArray(this._colorsTexture.image.data, instanceId * 4);
        this._colorsTexture.needsUpdate = true;
      }
      return this;
    }
    getColorAt(instanceId, color) {
      this.validateInstanceId(instanceId);
      if (!color) return color;
      if (this._colorsTexture === null) {
        if (typeof color.setRGB === "function") return color.setRGB(1, 1, 1);
        color.r = 1;
        color.g = 1;
        color.b = 1;
        return color;
      }
      return color.fromArray
        ? color.fromArray(this._colorsTexture.image.data, instanceId * 4)
        : color.setRGB?.(
            this._colorsTexture.image.data[instanceId * 4],
            this._colorsTexture.image.data[instanceId * 4 + 1],
            this._colorsTexture.image.data[instanceId * 4 + 2]
          );
    }
    setVisibleAt(instanceId, visible) {
      this.validateInstanceId(instanceId);
      if (this._instanceInfo[instanceId].visible === visible) return this;
      this._instanceInfo[instanceId].visible = visible;
      this._visibilityChanged = true;
      return this;
    }
    getVisibleAt(instanceId) {
      this.validateInstanceId(instanceId);
      return this._instanceInfo[instanceId].visible;
    }
    setGeometryIdAt(instanceId, geometryId) {
      this.validateInstanceId(instanceId);
      this.validateGeometryId(geometryId);
      this._instanceInfo[instanceId].geometryIndex = geometryId;
      this._visibilityChanged = true;
      this._nativeBatchesDirty = true;
      return this;
    }
    getGeometryIdAt(instanceId) {
      this.validateInstanceId(instanceId);
      return this._instanceInfo[instanceId].geometryIndex;
    }
    getGeometryRangeAt(geometryId, target = {}) {
      this.validateGeometryId(geometryId);
      const info = this._geometryInfo[geometryId];
      target.vertexStart = info.vertexStart;
      target.vertexCount = info.vertexCount;
      target.reservedVertexCount = info.reservedVertexCount;
      target.indexStart = info.indexStart;
      target.indexCount = info.indexCount;
      target.reservedIndexCount = info.reservedIndexCount;
      target.start = info.start;
      target.count = info.count;
      return target;
    }
    setInstanceCount(maxInstanceCount) {
      this._maxInstanceCount = maxInstanceCount;
      this._multiDrawCounts = new Int32Array(maxInstanceCount);
      this._multiDrawStarts = new Int32Array(maxInstanceCount);
      if (this._matricesTexture) this._matricesTexture.dispose();
      this._initMatricesTexture();
      if (this._indirectTexture) this._indirectTexture.dispose();
      this._initIndirectTexture();
      this._nativeBatchesDirty = true;
      return this;
    }
    setGeometrySize(maxVertexCount, maxIndexCount) {
      this._maxVertexCount = maxVertexCount;
      this._maxIndexCount = maxIndexCount;
      return this;
    }
    _syncNativeBatches() {
      if (!this._nativeBatchesDirty) return;
      this._nativeBatchesDirty = false;
      const prev = this._nativeBatches;
      this._nativeBatches = [];
      for (let i = 0; i < prev.length; i++) {
        const child = prev[i];
        this.remove(child);
        if (child && typeof child.dispose === "function") child.dispose();
      }
      const groups = [];
      for (let i = 0, l = this._instanceInfo.length; i < l; i++) {
        const info = this._instanceInfo[i];
        if (!info || !info.active || info.visible === false) continue;
        const gid = info.geometryIndex;
        if (!groups[gid]) groups[gid] = [];
        groups[gid].push(i);
      }
      const mat4 = _batchMatrix || (Matrix4 ? new Matrix4() : null);
      if (!mat4) return;
      for (let gid = 0; gid < groups.length; gid++) {
        const ids = groups[gid];
        if (!ids || !ids.length) continue;
        const src = this._geometryInfo[gid] && this._geometryInfo[gid].sourceGeometry;
        if (!src) continue;
        const mesh = new InstancedMesh(src, this.material, ids.length);
        const color = Color ? new Color() : null;
        for (let i = 0; i < ids.length; i++) {
          this.getMatrixAt(ids[i], mat4);
          mesh.setMatrixAt(i, mat4);
          if (this._colorsTexture && color) {
            this.getColorAt(ids[i], color);
            mesh.setColorAt(i, color);
          }
        }
        this.add(mesh);
        this._nativeBatches.push(mesh);
      }
    }
    flushSelf() {
      this._syncNativeBatches();
      if (typeof Object.getPrototypeOf(Mesh.prototype).flushSelf === "function") {
        return Object.getPrototypeOf(Mesh.prototype).flushSelf.call(this);
      }
      return this;
    }
    onBeforeShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial) {
      if (typeof this.onBeforeRender === "function") {
        this.onBeforeRender(renderer, null, shadowCamera, geometry, depthMaterial);
      }
    }
    dispose() {
      super.dispose();
      if (this.geometry && typeof this.geometry.dispose === "function") this.geometry.dispose();
      if (this._matricesTexture) this._matricesTexture.dispose();
      if (this._indirectTexture) this._indirectTexture.dispose();
      if (this._colorsTexture) this._colorsTexture.dispose();
      this._matricesTexture = null;
      this._indirectTexture = null;
      this._colorsTexture = null;
      const prev = this._nativeBatches;
      this._nativeBatches = [];
      for (let i = 0; i < prev.length; i++) {
        const child = prev[i];
        this.remove(child);
        if (child && typeof child.dispose === "function") child.dispose();
      }
    }
  }

  TN.Mesh = Mesh;
  TN.Group = Group;
  TN.InstancedMesh = InstancedMesh;
  TN.Line = Line;
  TN.LineSegments = LineSegments;
  TN.LineLoop = LineLoop;
  TN.Points = Points;
  TN.Sprite = Sprite;
  TN.LOD = LOD;
  TN.Bone = Bone;
  TN.Skeleton = Skeleton;
  TN.SkinnedMesh = SkinnedMesh;
  TN.BatchedMesh = BatchedMesh;
})(globalThis.__TN = globalThis.__TN || {});
