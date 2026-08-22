(() => {
  const g = globalThis;

  function toHex(c) {
    if (c == null) return 0xffffff;
    if (typeof c === "number" && Number.isFinite(c)) return c >>> 0;
    if (typeof c === "object") {
      if (typeof c.getHex === "function") return c.getHex() >>> 0;
      if (typeof c.r === "number") {
        return (
          ((Math.round(c.r * 255) & 255) << 16) |
          ((Math.round(c.g * 255) & 255) << 8) |
          (Math.round(c.b * 255) & 255)
        ) >>> 0;
      }
    }
    if (typeof c === "string") {
      const s = c.trim();
      if (s[0] === "#") return parseInt(s.slice(1), 16) >>> 0;
      if (s.startsWith("0x") || s.startsWith("0X")) return parseInt(s, 16) >>> 0;
    }
    return 0xffffff;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
    copy(v) {
      return this.set(v.x, v.y);
    }
    clone() {
      return new Vector2(this.x, this.y);
    }
    add(v) {
      this.x += v.x;
      this.y += v.y;
      return this;
    }
    sub(v) {
      this.x -= v.x;
      this.y -= v.y;
      return this;
    }
    subVectors(a, b) {
      return this.set(a.x - b.x, a.y - b.y);
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      return this;
    }
    length() {
      return Math.hypot(this.x, this.y);
    }
    distanceTo(v) {
      return Math.hypot(this.x - v.x, this.y - v.y);
    }
  }

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this._x = x;
      this._y = y;
      this._z = z;
      this.isVector3 = true;
      this._onChangeCallback = Vector3.noop;
    }
    static noop() {}
    get x() {
      return this._x;
    }
    set x(v) {
      this._x = +v;
      this._onChangeCallback();
    }
    get y() {
      return this._y;
    }
    set y(v) {
      this._y = +v;
      this._onChangeCallback();
    }
    get z() {
      return this._z;
    }
    set z(v) {
      this._z = +v;
      this._onChangeCallback();
    }
    set(x, y, z) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._onChangeCallback();
      return this;
    }
    copy(v) {
      return this.set(v.x, v.y, v.z);
    }
    clone() {
      return new Vector3(this._x, this._y, this._z);
    }
    add(v) {
      return this.set(this._x + v.x, this._y + v.y, this._z + v.z);
    }
    addScaledVector(v, s) {
      return this.set(this._x + v.x * s, this._y + v.y * s, this._z + v.z * s);
    }
    sub(v) {
      return this.set(this._x - v.x, this._y - v.y, this._z - v.z);
    }
    subVectors(a, b) {
      return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    multiplyScalar(s) {
      return this.set(this._x * s, this._y * s, this._z * s);
    }
    divideScalar(s) {
      return this.multiplyScalar(s === 0 ? 0 : 1 / s);
    }
    lengthSq() {
      return this._x * this._x + this._y * this._y + this._z * this._z;
    }
    length() {
      return Math.sqrt(this.lengthSq());
    }
    distanceToSquared(v) {
      const dx = this._x - v.x;
      const dy = this._y - v.y;
      const dz = this._z - v.z;
      return dx * dx + dy * dy + dz * dz;
    }
    distanceTo(v) {
      return Math.sqrt(this.distanceToSquared(v));
    }
    normalize() {
      return this.divideScalar(this.length() || 1);
    }
    dot(v) {
      return this._x * v.x + this._y * v.y + this._z * v.z;
    }
    crossVectors(a, b) {
      return this.set(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x
      );
    }
    cross(v) {
      return this.crossVectors(this, v);
    }
    lerp(v, a) {
      return this.set(
        this._x + (v.x - this._x) * a,
        this._y + (v.y - this._y) * a,
        this._z + (v.z - this._z) * a
      );
    }
    clampLength(min, max) {
      const len = this.length();
      return this.divideScalar(len || 1).multiplyScalar(clamp(len, min, max));
    }
    setFromSpherical(s) {
      return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
    }
    setFromSphericalCoords(radius, phi, theta) {
      const sinPhiRadius = Math.sin(phi) * radius;
      return this.set(
        sinPhiRadius * Math.sin(theta),
        Math.cos(phi) * radius,
        sinPhiRadius * Math.cos(theta)
      );
    }
    fromBufferAttribute(attr, index) {
      return this.set(attr.getX(index), attr.getY(index), attr.getZ(index));
    }
    setFromMatrixColumn(m, index) {
      return this.fromArray(m.elements, index * 4);
    }
    fromArray(arr, offset = 0) {
      return this.set(arr[offset], arr[offset + 1], arr[offset + 2]);
    }
    applyQuaternion(q) {
      const x = this._x;
      const y = this._y;
      const z = this._z;
      const qx = q.x;
      const qy = q.y;
      const qz = q.z;
      const qw = q.w;
      const ix = qw * x + qy * z - qz * y;
      const iy = qw * y + qz * x - qx * z;
      const iz = qw * z + qx * y - qy * x;
      const iw = -qx * x - qy * y - qz * z;
      return this.set(
        ix * qw + iw * -qx + iy * -qz - iz * -qy,
        iy * qw + iw * -qy + iz * -qx - ix * -qz,
        iz * qw + iw * -qz + ix * -qy - iy * -qx
      );
    }
    transformDirection(m) {
      const e = m.elements;
      const x = this._x;
      const y = this._y;
      const z = this._z;
      this.set(
        e[0] * x + e[4] * y + e[8] * z,
        e[1] * x + e[5] * y + e[9] * z,
        e[2] * x + e[6] * y + e[10] * z
      );
      return this.normalize();
    }
    unproject() {
      return this;
    }
    equals(v) {
      return this._x === v.x && this._y === v.y && this._z === v.z;
    }
  }

  class Vector4 {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
    }
    set(x, y, z, w) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
      return this;
    }
    copy(v) {
      return this.set(v.x, v.y, v.z, v.w);
    }
    clone() {
      return new Vector4(this.x, this.y, this.z, this.w);
    }
  }

  class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._w = w;
    }
    get x() {
      return this._x;
    }
    set x(v) {
      this._x = +v;
    }
    get y() {
      return this._y;
    }
    set y(v) {
      this._y = +v;
    }
    get z() {
      return this._z;
    }
    set z(v) {
      this._z = +v;
    }
    get w() {
      return this._w;
    }
    set w(v) {
      this._w = +v;
    }
    set(x, y, z, w) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._w = w;
      return this;
    }
    copy(q) {
      return this.set(q.x, q.y, q.z, q.w);
    }
    clone() {
      return new Quaternion(this._x, this._y, this._z, this._w);
    }
    identity() {
      return this.set(0, 0, 0, 1);
    }
    lengthSq() {
      return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
    }
    normalize() {
      const l = Math.sqrt(this.lengthSq());
      if (l === 0) return this.identity();
      return this.set(this._x / l, this._y / l, this._z / l, this._w / l);
    }
    invert() {
      return this.set(-this._x, -this._y, -this._z, this._w);
    }
    conjugate() {
      return this.invert();
    }
    dot(q) {
      return this._x * q.x + this._y * q.y + this._z * q.z + this._w * q.w;
    }
    setFromUnitVectors(vFrom, vTo) {
      let r = vFrom.dot(vTo) + 1;
      if (r < 1e-6) {
        if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) this.set(-vFrom.y, vFrom.x, 0, 0);
        else this.set(0, -vFrom.z, vFrom.y, 0);
      } else {
        this.set(
          vFrom.y * vTo.z - vFrom.z * vTo.y,
          vFrom.z * vTo.x - vFrom.x * vTo.z,
          vFrom.x * vTo.y - vFrom.y * vTo.x,
          r
        );
      }
      return this.normalize();
    }
    setFromRotationMatrix(m) {
      const te = m.elements;
      const m11 = te[0];
      const m12 = te[4];
      const m13 = te[8];
      const m21 = te[1];
      const m22 = te[5];
      const m23 = te[9];
      const m31 = te[2];
      const m32 = te[6];
      const m33 = te[10];
      const trace = m11 + m22 + m33;
      if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        return this.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
      }
      if (m11 > m22 && m11 > m33) {
        const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
        return this.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
      }
      if (m22 > m33) {
        const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
        return this.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
      }
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      return this.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
    }
  }

  class Euler {
    constructor(x = 0, y = 0, z = 0, order = "XYZ") {
      this._x = x;
      this._y = y;
      this._z = z;
      this._order = order;
      this._onChangeCallback = Vector3.noop;
    }
    get x() {
      return this._x;
    }
    set x(v) {
      this._x = +v;
      this._onChangeCallback();
    }
    get y() {
      return this._y;
    }
    set y(v) {
      this._y = +v;
      this._onChangeCallback();
    }
    get z() {
      return this._z;
    }
    set z(v) {
      this._z = +v;
      this._onChangeCallback();
    }
    get order() {
      return this._order;
    }
    set order(v) {
      this._order = v;
    }
    set(x, y, z, order) {
      this._x = x;
      this._y = y;
      this._z = z;
      if (order) this._order = order;
      this._onChangeCallback();
      return this;
    }
    copy(e) {
      return this.set(e.x, e.y, e.z, e.order);
    }
    clone() {
      return new Euler(this._x, this._y, this._z, this._order);
    }
  }

  class Matrix3 {
    constructor() {
      this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
    identity() {
      this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      return this;
    }
    copy(m) {
      this.elements = m.elements.slice();
      return this;
    }
    clone() {
      return new Matrix3().copy(this);
    }
  }

  const _m1 = new Vector3();
  const _m2 = new Vector3();
  const _m3 = new Vector3();

  class Matrix4 {
    constructor() {
      this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }
    identity() {
      this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      return this;
    }
    copy(m) {
      this.elements = m.elements.slice();
      return this;
    }
    clone() {
      return new Matrix4().copy(this);
    }
    makeTranslation(x, y, z) {
      this.identity();
      this.elements[12] = x;
      this.elements[13] = y;
      this.elements[14] = z;
      return this;
    }
    makeRotationX(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      this.identity();
      const te = this.elements;
      te[5] = c;
      te[9] = -s;
      te[6] = s;
      te[10] = c;
      return this;
    }
    makeRotationY(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      this.identity();
      const te = this.elements;
      te[0] = c;
      te[8] = s;
      te[2] = -s;
      te[10] = c;
      return this;
    }
    makeRotationZ(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      this.identity();
      const te = this.elements;
      te[0] = c;
      te[4] = -s;
      te[1] = s;
      te[5] = c;
      return this;
    }
    lookAt(eye, target, up) {
      const te = this.elements;
      _m1.subVectors(eye, target);
      if (_m1.lengthSq() === 0) _m1.z = 1;
      _m1.normalize();
      _m2.crossVectors(up, _m1);
      if (_m2.lengthSq() === 0) {
        if (Math.abs(up.z) === 1) _m1.x += 0.0001;
        else _m1.z += 0.0001;
        _m1.normalize();
        _m2.crossVectors(up, _m1);
      }
      _m2.normalize();
      _m3.crossVectors(_m1, _m2);
      te[0] = _m2.x;
      te[4] = _m3.x;
      te[8] = _m1.x;
      te[1] = _m2.y;
      te[5] = _m3.y;
      te[9] = _m1.y;
      te[2] = _m2.z;
      te[6] = _m3.z;
      te[10] = _m1.z;
      return this;
    }
  }

  class Spherical {
    constructor(radius = 1, phi = 0, theta = 0) {
      this.radius = radius;
      this.phi = phi;
      this.theta = theta;
    }
    set(radius, phi, theta) {
      this.radius = radius;
      this.phi = phi;
      this.theta = theta;
      return this;
    }
    copy(s) {
      return this.set(s.radius, s.phi, s.theta);
    }
    clone() {
      return new Spherical(this.radius, this.phi, this.theta);
    }
    makeSafe() {
      const eps = 1e-6;
      this.phi = clamp(this.phi, eps, Math.PI - eps);
      return this;
    }
    setFromVector3(v) {
      this.radius = v.length();
      if (this.radius === 0) {
        this.theta = 0;
        this.phi = 0;
      } else {
        this.theta = Math.atan2(v.x, v.z);
        this.phi = Math.acos(clamp(v.y / this.radius, -1, 1));
      }
      return this;
    }
  }

  class Color {
    constructor(r, g, b) {
      this.r = 1;
      this.g = 1;
      this.b = 1;
      if (g === undefined && b === undefined) this.set(r);
      else this.setRGB(r, g, b);
    }
    set(value) {
      if (value instanceof Color) return this.copy(value);
      if (typeof value === "number") return this.setHex(value);
      if (typeof value === "string") return this.setHex(toHex(value));
      return this;
    }
    setHex(hex) {
      hex = hex >>> 0;
      this.r = ((hex >> 16) & 255) / 255;
      this.g = ((hex >> 8) & 255) / 255;
      this.b = (hex & 255) / 255;
      return this;
    }
    setRGB(r, g, b) {
      this.r = r;
      this.g = g;
      this.b = b;
      return this;
    }
    getHex() {
      return (
        ((Math.round(this.r * 255) & 255) << 16) |
        ((Math.round(this.g * 255) & 255) << 8) |
        (Math.round(this.b * 255) & 255)
      ) >>> 0;
    }
    copy(c) {
      this.r = c.r;
      this.g = c.g;
      this.b = c.b;
      return this;
    }
    clone() {
      return new Color(this.r, this.g, this.b);
    }
  }

  function toTyped(array, Type) {
    if (array instanceof Type) return array;
    if (ArrayBuffer.isView(array)) return new Type(array);
    return new Type(array);
  }

  class BufferAttribute {
    constructor(array, itemSize = 1, normalized = false) {
      this.array = array;
      this.itemSize = itemSize;
      this.normalized = !!normalized;
      this.count = array ? (array.length / itemSize) | 0 : 0;
      this.usage = 35044;
      this.isBufferAttribute = true;
      this.isInterleavedBufferAttribute = false;
    }
    getX(i) {
      return this.array[i * this.itemSize];
    }
    getY(i) {
      return this.array[i * this.itemSize + 1];
    }
    getZ(i) {
      return this.array[i * this.itemSize + 2];
    }
    getW(i) {
      return this.array[i * this.itemSize + 3];
    }
    setX(i, v) {
      this.array[i * this.itemSize] = v;
      return this;
    }
    setY(i, v) {
      this.array[i * this.itemSize + 1] = v;
      return this;
    }
    setZ(i, v) {
      this.array[i * this.itemSize + 2] = v;
      return this;
    }
    setComponent(i, c, v) {
      this.array[i * this.itemSize + c] = v;
      return this;
    }
    getComponent(i, c) {
      return this.array[i * this.itemSize + c];
    }
    copy(src) {
      this.array = src.array.slice();
      this.itemSize = src.itemSize;
      this.normalized = src.normalized;
      this.count = src.count;
      return this;
    }
    clone() {
      return new this.constructor(this.array.slice(), this.itemSize, this.normalized);
    }
    applyMatrix4(m) {
      const e = m.elements;
      const a = this.array;
      for (let i = 0, il = this.count * 3; i < il; i += 3) {
        const x = a[i];
        const y = a[i + 1];
        const z = a[i + 2];
        a[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
        a[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        a[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      return this;
    }
    applyNormalMatrix(m) {
      const e = m.elements || m;
      const a = this.array;
      for (let i = 0, il = this.count * 3; i < il; i += 3) {
        const x = a[i];
        const y = a[i + 1];
        const z = a[i + 2];
        let nx = e[0] * x + e[4] * y + e[8] * z;
        let ny = e[1] * x + e[5] * y + e[9] * z;
        let nz = e[2] * x + e[6] * y + e[10] * z;
        const len = Math.hypot(nx, ny, nz) || 1;
        a[i] = nx / len;
        a[i + 1] = ny / len;
        a[i + 2] = nz / len;
      }
      return this;
    }
  }

  class Float32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(toTyped(array, Float32Array), itemSize, normalized);
    }
  }

  class Uint16BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(toTyped(array, Uint16Array), itemSize, normalized);
    }
  }

  class InstancedBufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized, meshPerAttribute = 1) {
      super(array, itemSize, normalized);
      this.meshPerAttribute = meshPerAttribute;
      this.isInstancedBufferAttribute = true;
    }
  }

  const _geoRot = new Matrix4();

  class BufferGeometry {
    constructor() {
      this.type = "BufferGeometry";
      this.attributes = {};
      this.morphAttributes = {};
      this.morphTargetsRelative = false;
      this.index = null;
      this.groups = [];
      this.boundingBox = null;
      this.boundingSphere = null;
      this.isBufferGeometry = true;
      this._h = 0;
    }
    setAttribute(name, attr) {
      this.attributes[name] = attr;
      this._h = 0;
      return this;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    hasAttribute(name) {
      return this.attributes[name] != null;
    }
    deleteAttribute(name) {
      delete this.attributes[name];
      this._h = 0;
      return this;
    }
    setIndex(index) {
      if (index && !index.isBufferAttribute && !index.isInterleavedBufferAttribute) {
        const arr = Array.isArray(index) || ArrayBuffer.isView(index) ? index : index.array;
        this.index = new BufferAttribute(
          arr instanceof Uint32Array || arr instanceof Uint16Array ? arr : new Uint32Array(arr),
          1
        );
      } else {
        this.index = index;
      }
      this._h = 0;
      return this;
    }
    getIndex() {
      return this.index;
    }
    addGroup(start, count, materialIndex = 0) {
      this.groups.push({ start, count, materialIndex });
      return this;
    }
    clearGroups() {
      this.groups = [];
      return this;
    }
    applyMatrix4(matrix) {
      this.attributes.position?.applyMatrix4(matrix);
      this.attributes.normal?.applyNormalMatrix(matrix);
      this._h = 0;
      if (this.boundingSphere) this.computeBoundingSphere();
      return this;
    }
    rotateX(angle) {
      return this.applyMatrix4(_geoRot.makeRotationX(angle));
    }
    rotateY(angle) {
      return this.applyMatrix4(_geoRot.makeRotationY(angle));
    }
    rotateZ(angle) {
      return this.applyMatrix4(_geoRot.makeRotationZ(angle));
    }
    translate(x, y, z) {
      return this.applyMatrix4(_geoRot.makeTranslation(x, y, z));
    }
    clone() {
      const geo = new BufferGeometry();
      geo.copy(this);
      return geo;
    }
    copy(source) {
      this.index = source.index ? source.index.clone() : null;
      this.attributes = {};
      for (const name in source.attributes) {
        this.attributes[name] = source.attributes[name].clone();
      }
      this.morphAttributes = {};
      this.morphTargetsRelative = source.morphTargetsRelative;
      this.groups = source.groups.slice();
      this.parameters = source.parameters ? { ...source.parameters } : undefined;
      this._h = 0;
      return this;
    }
    computeBoundingSphere() {
      const pos = this.attributes.position;
      let radius = 0;
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          radius = Math.max(radius, x * x + y * y + z * z);
        }
        radius = Math.sqrt(radius);
      }
      this.boundingSphere = { center: new Vector3(), radius };
      return this;
    }
    dispose() {}
  }

  class PlaneGeometry extends BufferGeometry {
    constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
      super();
      this.type = "PlaneGeometry";
      this.parameters = { width, height, widthSegments, heightSegments };
      const widthHalf = width / 2;
      const heightHalf = height / 2;
      const gridX = Math.floor(widthSegments) || 1;
      const gridY = Math.floor(heightSegments) || 1;
      const gridX1 = gridX + 1;
      const gridY1 = gridY + 1;
      const segmentWidth = width / gridX;
      const segmentHeight = height / gridY;
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      for (let iy = 0; iy < gridY1; iy++) {
        const y = iy * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX1; ix++) {
          const x = ix * segmentWidth - widthHalf;
          vertices.push(x, -y, 0);
          normals.push(0, 0, 1);
          uvs.push(ix / gridX);
          uvs.push(1 - iy / gridY);
        }
      }
      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
          const a = ix + gridX1 * iy;
          const b = ix + gridX1 * (iy + 1);
          const c = ix + 1 + gridX1 * (iy + 1);
          const d = ix + 1 + gridX1 * iy;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
  }

  class BoxGeometry extends BufferGeometry {
    constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
      super();
      this.type = "BoxGeometry";
      this.parameters = { width, height, depth, widthSegments, heightSegments, depthSegments };
      widthSegments = Math.floor(widthSegments) || 1;
      heightSegments = Math.floor(heightSegments) || 1;
      depthSegments = Math.floor(depthSegments) || 1;
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      let numberOfVertices = 0;
      let groupStart = 0;
      const buildPlane = (u, v, w, udir, vdir, pWidth, pHeight, pDepth, gridX, gridY, materialIndex) => {
        const segmentWidth = pWidth / gridX;
        const segmentHeight = pHeight / gridY;
        const widthHalf = pWidth / 2;
        const heightHalf = pHeight / 2;
        const depthHalf = pDepth / 2;
        const gridX1 = gridX + 1;
        const gridY1 = gridY + 1;
        let vertexCounter = 0;
        let groupCount = 0;
        const vector = new Vector3();
        for (let iy = 0; iy < gridY1; iy++) {
          const y = iy * segmentHeight - heightHalf;
          for (let ix = 0; ix < gridX1; ix++) {
            const x = ix * segmentWidth - widthHalf;
            vector[u] = x * udir;
            vector[v] = y * vdir;
            vector[w] = depthHalf;
            vertices.push(vector.x, vector.y, vector.z);
            vector[u] = 0;
            vector[v] = 0;
            vector[w] = pDepth > 0 ? 1 : -1;
            normals.push(vector.x, vector.y, vector.z);
            uvs.push(ix / gridX);
            uvs.push(1 - iy / gridY);
            vertexCounter++;
          }
        }
        for (let iy = 0; iy < gridY; iy++) {
          for (let ix = 0; ix < gridX; ix++) {
            const a = numberOfVertices + ix + gridX1 * iy;
            const b = numberOfVertices + ix + gridX1 * (iy + 1);
            const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
            const d = numberOfVertices + (ix + 1) + gridX1 * iy;
            indices.push(a, b, d);
            indices.push(b, c, d);
            groupCount += 6;
          }
        }
        this.addGroup(groupStart, groupCount, materialIndex);
        groupStart += groupCount;
        numberOfVertices += vertexCounter;
      };
      buildPlane("z", "y", "x", -1, -1, depth, height, width, depthSegments, heightSegments, 0);
      buildPlane("z", "y", "x", 1, -1, depth, height, -width, depthSegments, heightSegments, 1);
      buildPlane("x", "z", "y", 1, 1, width, depth, height, widthSegments, depthSegments, 2);
      buildPlane("x", "z", "y", 1, -1, width, depth, -height, widthSegments, depthSegments, 3);
      buildPlane("x", "y", "z", 1, -1, width, height, depth, widthSegments, heightSegments, 4);
      buildPlane("x", "y", "z", -1, -1, width, height, -depth, widthSegments, heightSegments, 5);
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
  }

  class Timer {
    constructor() {
      this._previousTime = 0;
      this._currentTime = 0;
      this._startTime = performance.now();
      this._delta = 0;
      this._elapsed = 0;
      this._timescale = 1;
      this._document = null;
      this._pageVisibilityHandler = null;
    }
    connect(doc) {
      this._document = doc;
      if (doc && doc.hidden !== undefined) {
        this._pageVisibilityHandler = () => {
          if (this._document.hidden === false) this.reset();
        };
        doc.addEventListener("visibilitychange", this._pageVisibilityHandler, false);
      }
    }
    disconnect() {
      if (this._pageVisibilityHandler && this._document) {
        this._document.removeEventListener("visibilitychange", this._pageVisibilityHandler);
      }
      this._pageVisibilityHandler = null;
      this._document = null;
    }
    getDelta() {
      return this._delta / 1000;
    }
    getElapsed() {
      return this._elapsed / 1000;
    }
    setTimescale(timescale) {
      this._timescale = timescale;
      return this;
    }
    reset() {
      this._currentTime = performance.now() - this._startTime;
      return this;
    }
    dispose() {
      this.disconnect();
    }
    update(timestamp) {
      if (this._pageVisibilityHandler !== null && this._document?.hidden === true) {
        this._delta = 0;
      } else {
        this._previousTime = this._currentTime;
        this._currentTime = (timestamp !== undefined ? timestamp : performance.now()) - this._startTime;
        this._delta = (this._currentTime - this._previousTime) * this._timescale;
        this._elapsed += this._delta;
      }
      return this;
    }
  }

  class Plane {
    constructor(normal = new Vector3(1, 0, 0), constant = 0) {
      this.normal = normal;
      this.constant = constant;
    }
    setFromNormalAndCoplanarPoint(n, p) {
      this.normal.copy(n).normalize();
      this.constant = -p.dot(this.normal);
      return this;
    }
  }

  class Ray {
    constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
      this.origin = origin;
      this.direction = direction;
    }
    copy(r) {
      this.origin.copy(r.origin);
      this.direction.copy(r.direction);
      return this;
    }
    intersectPlane(plane, target) {
      const denom = plane.normal.dot(this.direction);
      if (Math.abs(denom) < 1e-6) return null;
      const t = -(this.origin.dot(plane.normal) + plane.constant) / denom;
      if (t < 0) return null;
      return target.copy(this.direction).multiplyScalar(t).add(this.origin);
    }
  }

  const MathUtils = {
    DEG2RAD: Math.PI / 180,
    RAD2DEG: 180 / Math.PI,
    clamp,
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    euclideanModulo(n, m) {
      return ((n % m) + m) % m;
    },
    generateUUID() {
      return g.crypto?.randomUUID?.() ?? "tn-" + Math.random().toString(16).slice(2);
    },
    damp(x, y, lambda, dt) {
      return MathUtils.lerp(x, y, 1 - Math.exp(-lambda * dt));
    },
    mapLinear(x, a1, a2, b1, b2) {
      return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
    },
    degToRad(d) {
      return d * MathUtils.DEG2RAD;
    },
    radToDeg(r) {
      return r * MathUtils.RAD2DEG;
    },
    isPowerOfTwo(v) {
      return (v & (v - 1)) === 0 && v !== 0;
    },
    randFloat(low, high) {
      return low + Math.random() * (high - low);
    },
    randInt(low, high) {
      return low + Math.floor(Math.random() * (high - low + 1));
    },
  };

  class EventDispatcher {
    constructor() {
      this._listeners = {};
    }
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    hasEventListener(type, fn) {
      return (this._listeners[type] || []).includes(fn);
    }
    removeEventListener(type, fn) {
      const list = this._listeners[type];
      if (!list) return;
      this._listeners[type] = list.filter((x) => x !== fn);
    }
    dispatchEvent(event) {
      const list = this._listeners[event.type];
      if (!list) return;
      event.target = this;
      for (const fn of list.slice()) fn.call(this, event);
    }
  }

  class Controls extends EventDispatcher {
    constructor(object, domElement = null) {
      super();
      this.object = object;
      this.domElement = domElement;
      this.enabled = true;
      this.state = -1;
      this.keys = {};
      this.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
      this.touches = { ONE: null, TWO: null };
    }
    connect(element) {
      if (this.domElement !== null) this.disconnect();
      this.domElement = element;
    }
    disconnect() {}
    dispose() {}
    update() {}
  }

  class Clock {
    constructor(autoStart = true) {
      this.autoStart = autoStart;
      this.startTime = 0;
      this.oldTime = 0;
      this.elapsedTime = 0;
      this.running = false;
    }
    start() {
      this.startTime = performance.now();
      this.oldTime = this.startTime;
      this.elapsedTime = 0;
      this.running = true;
    }
    getDelta() {
      if (this.autoStart && !this.running) this.start();
      const now = performance.now();
      const dt = (now - this.oldTime) / 1000;
      this.oldTime = now;
      this.elapsedTime += dt;
      return dt;
    }
    getElapsedTime() {
      this.getDelta();
      return this.elapsedTime;
    }
  }

  class Layers {
    constructor() {
      this.mask = 1;
    }
    enable() {}
    disable() {}
    toggle() {}
    test() {
      return true;
    }
  }

  class Texture {
    constructor(image = null) {
      this.image = image;
      this.colorSpace = "";
      this.needsUpdate = false;
      this.wrapS = 1000;
      this.wrapT = 1000;
      this.magFilter = 1006;
      this.minFilter = 1008;
      this.flipY = true;
      this._h = 0;
      this._materials = [];
    }
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

  class TextureLoader {
    load(url, onLoad, _onProgress, onError) {
      const texture = new Texture();
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        queueMicrotask(() => {
          try {
            texture.image = img;
            texture.needsUpdate = true;
            const native = nativeHost();
            if (native) {
              const canvas = document.createElement("canvas");
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(img, 0, 0);
              let pixels = ctx.getImageData(0, 0, img.width, img.height).data;
              if (texture.flipY !== false) {
                const stride = img.width * 4;
                const flipped = new Uint8ClampedArray(pixels.length);
                for (let y = 0; y < img.height; y++) {
                  flipped.set(
                    pixels.subarray(y * stride, (y + 1) * stride),
                    (img.height - 1 - y) * stride
                  );
                }
                pixels = flipped;
              }
              texture._h = native.TextureFromRgba(img.width, img.height, bytesToB64(pixels));
              native.TextureSetFilter(texture._h, texture.magFilter, texture.minFilter);
              for (const mat of texture._materials) {
                if (mat._h) native.MaterialSetMap(mat._h, texture._h);
              }
            }
            onLoad?.(texture);
          } catch (err) {
            console.warn("ThreeBrowser texture upload failed", err);
            onError?.(err);
          }
        });
      };
      img.onerror = (err) => onError?.(err);
      img.src = url;
      return texture;
    }
  }

  function stub(name) {
    const C = class {
      constructor() {
        this.type = name;
        this.isStub = true;
      }
    };
    Object.defineProperty(C, "name", { value: name });
    return C;
  }

  function createTHREE(native) {
    let nextId = 1;

    function flushPose(obj) {
      if (!obj || !obj._h) return;
      if (obj._look) {
        native.ObjectLookFrom(
          obj._h,
          obj.position.x,
          obj.position.y,
          obj.position.z,
          obj._look.x,
          obj._look.y,
          obj._look.z
        );
      } else if (obj._posDirty) {
        native.ObjectSetPosition(obj._h, obj.position.x, obj.position.y, obj.position.z);
      }
      if (obj._rotDirty && !obj._look) {
        native.ObjectSetRotation(obj._h, obj.rotation.x, obj.rotation.y, obj.rotation.z);
      }
      if (obj._scaleDirty) {
        native.ObjectSetScale(obj._h, obj.scale.x, obj.scale.y, obj.scale.z);
      }
      obj._posDirty = false;
      obj._rotDirty = false;
      obj._scaleDirty = false;
      if (obj.children) {
        for (const child of obj.children) flushPose(child);
      }
    }

    class Object3D {
      constructor(handle = 0) {
        this._h = handle;
        this.id = nextId++;
        this.uuid = MathUtils.generateUUID();
        this.name = "";
        this.type = "Object3D";
        this.children = [];
        this.parent = null;
        this.up = new Vector3(0, 1, 0);
        this.position = new Vector3();
        this.rotation = new Euler();
        this.quaternion = new Quaternion();
        this.scale = new Vector3(1, 1, 1);
        this.matrix = new Matrix4();
        this.matrixWorld = new Matrix4();
        this.layers = new Layers();
        this.visible = true;
        this.matrixAutoUpdate = true;
        this.frustumCulled = true;
        this.isObject3D = true;
        this._posDirty = false;
        this._rotDirty = false;
        this._scaleDirty = false;
        this._look = null;
        this.position._onChangeCallback = () => {
          this._posDirty = true;
        };
        this.rotation._onChangeCallback = () => {
          this._rotDirty = true;
        };
        this.scale._onChangeCallback = () => {
          this._scaleDirty = true;
        };
      }
      add(...children) {
        for (const child of children) {
          if (!child) continue;
          this.children.push(child);
          child.parent = this;
          if (this._h && child._h) native.ObjectAdd(this._h, child._h);
        }
        return this;
      }
      remove(...children) {
        for (const child of children) {
          const i = this.children.indexOf(child);
          if (i >= 0) this.children.splice(i, 1);
        }
        return this;
      }
      lookAt(x, y, z) {
        if (x && typeof x.x === "number") {
          z = x.z;
          y = x.y;
          x = x.x;
        }
        this._look = { x, y, z };
        this.matrix.lookAt(this.position, this._look, this.up);
        this.quaternion.setFromRotationMatrix(this.matrix);
        return this;
      }
      updateMatrixWorld() {
        if (this._look) this.matrix.lookAt(this.position, this._look, this.up);
        this.matrixWorld.copy(this.matrix);
      }
      updateProjectionMatrix() {}
      traverse(fn) {
        fn(this);
        for (const child of this.children) child.traverse?.(fn);
      }
    }

    class Scene extends Object3D {
      constructor() {
        super(native.SceneCreate());
        this.isScene = true;
        this.type = "Scene";
        this.background = null;
        this.environment = null;
        this.fog = null;
      }
      set background(value) {
        this._background = value;
        if (value != null && this._h) native.SceneSetBackground(this._h, toHex(value));
      }
      get background() {
        return this._background;
      }
    }

    class Camera extends Object3D {
      constructor(handle) {
        super(handle);
        this.isCamera = true;
        this.zoom = 1;
        this.near = 0.1;
        this.far = 2000;
      }
    }

    class PerspectiveCamera extends Camera {
      constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
        super(native.PerspectiveCameraCreate(fov, aspect, near, far));
        this.isPerspectiveCamera = true;
        this.type = "PerspectiveCamera";
        this.fov = fov;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
      }
      set aspect(value) {
        this._aspect = value;
        if (this._h) native.CameraSetAspect(this._h, value);
      }
      get aspect() {
        return this._aspect;
      }
      updateProjectionMatrix() {
        native.CameraUpdateProjectionMatrix(this._h);
      }
    }

    function ensureNativeGeometry(geo) {
      if (!geo) return 0;
      if (geo._h) return geo._h;
      const pos = geo.attributes?.position;
      if (!pos) return 0;
      geo._h = native.BufferGeometryCreate(
        f32ToB64(pos.array),
        f32ToB64(geo.attributes.normal?.array),
        f32ToB64(geo.attributes.uv?.array),
        indexToB64(geo.index)
      );
      return geo._h;
    }

    class SphereGeometry {
      constructor(radius = 1, widthSegments = 32, heightSegments = 16) {
        this._h = native.SphereGeometryCreate(radius, widthSegments, heightSegments);
        this.type = "SphereGeometry";
      }
    }

    class CylinderGeometry {
      constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1) {
        this._h = native.CylinderGeometryCreate(
          radiusTop,
          radiusBottom,
          height,
          radialSegments,
          heightSegments
        );
        this.type = "CylinderGeometry";
      }
    }

    class TorusKnotGeometry {
      constructor(radius = 1, tube = 0.4, tubular = 64, radial = 8, p = 2, q = 3) {
        this._h = native.TorusKnotGeometryCreate(radius, tube, tubular, radial, p, q);
        this.type = "TorusKnotGeometry";
      }
    }

    class MeshStandardMaterial {
      constructor(params = {}) {
        const color = toHex(params.color ?? 0xffffff);
        this._h = native.MeshStandardMaterialCreate(color);
        this.type = "MeshStandardMaterial";
        this.color = new Color().setHex(color);
        this.map = params.map ?? null;
        this.side = params.side ?? 0;
        this.metalness = params.metalness ?? 0;
        this.roughness = params.roughness ?? 1;
        if (params.metalness != null || params.roughness != null) {
          native.MaterialSetPbr(this._h, this.metalness, this.roughness);
        }
        if (params.side != null) native.MaterialSetSide(this._h, params.side);
        if (this.map) {
          this.map._materials.push(this);
          if (this.map._h) native.MaterialSetMap(this._h, this.map._h);
        }
      }
    }

    class MeshBasicMaterial {
      constructor(params = {}) {
        const color = toHex(params.color ?? 0xffffff);
        this._h = native.MeshBasicMaterialCreate(color);
        this.type = "MeshBasicMaterial";
        this.color = new Color().setHex(color);
        this.map = params.map ?? null;
        this.side = params.side ?? 0;
        if (params.side != null) native.MaterialSetSide(this._h, params.side);
        if (this.map) {
          this.map._materials.push(this);
          if (this.map._h) native.MaterialSetMap(this._h, this.map._h);
        }
      }
    }

    class MeshPhongMaterial extends MeshStandardMaterial {
      constructor(params = {}) {
        super({ metalness: 0.1, roughness: 0.4, ...params });
        this.type = "MeshPhongMaterial";
      }
    }

    class MeshLambertMaterial {
      constructor(params = {}) {
        const color = toHex(params.color ?? 0xffffff);
        this._h = native.MeshLambertMaterialCreate(color);
        this.type = "MeshLambertMaterial";
        this.color = new Color().setHex(color);
        this.map = params.map ?? null;
        this.side = params.side ?? 0;
        if (params.side != null) native.MaterialSetSide(this._h, params.side);
        if (this.map) {
          this.map._materials.push(this);
          if (this.map._h) native.MaterialSetMap(this._h, this.map._h);
        }
      }
    }

    class MeshNormalMaterial extends MeshStandardMaterial {
      constructor(params = {}) {
        super({ color: 0x8888ff, metalness: 0.2, roughness: 0.5, ...params });
        this.type = "MeshNormalMaterial";
      }
    }

    class Mesh extends Object3D {
      constructor(geometry, material) {
        const gh = geometry?._h || ensureNativeGeometry(geometry);
        const mh = material?._h;
        super(gh && mh ? native.MeshCreate(gh, mh) : 0);
        this.isMesh = true;
        this.type = "Mesh";
        this.geometry = geometry;
        this.material = material;
        if (!this._h) {
          console.warn("ThreeBrowser: Mesh is missing native geometry/material");
        }
      }
    }

    class InstancedMesh extends Object3D {
      constructor(geometry, material, count) {
        super(native.InstancedMeshCreate(geometry._h, material._h, count));
        this.isInstancedMesh = true;
        this.type = "InstancedMesh";
        this.geometry = geometry;
        this.material = material;
        this.count = count;
      }
      fillGrid(spacing = 5.5) {
        native.InstancedFillGrid(this._h, spacing);
        return this;
      }
    }

    class Group extends Object3D {
      constructor() {
        super(native.GroupCreate());
        this.isGroup = true;
        this.type = "Group";
      }
    }

    class AmbientLight extends Object3D {
      constructor(color = 0xffffff, intensity = 1) {
        super(native.AmbientLightCreate(toHex(color), intensity));
        this.isLight = true;
        this.type = "AmbientLight";
        this.color = new Color(color);
        this.intensity = intensity;
      }
    }

    class DirectionalLight extends Object3D {
      constructor(color = 0xffffff, intensity = 1) {
        super(native.DirectionalLightCreate(toHex(color), intensity));
        this.isLight = true;
        this.type = "DirectionalLight";
        this.color = new Color(color);
        this.intensity = intensity;
        this.target = new Object3D();
      }
    }

    class HemisphereLight extends Object3D {
      constructor(skyColor = 0xffffff, groundColor = 0x444444, intensity = 1) {
        super(native.HemisphereLightCreate());
        this.isLight = true;
        this.type = "HemisphereLight";
        this.color = new Color(skyColor);
        this.groundColor = new Color(groundColor);
        this.intensity = intensity;
      }
    }

    class PointLight extends Object3D {
      constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
        super(native.PointLightCreate(toHex(color), intensity));
        this.isLight = true;
        this.type = "PointLight";
        this.color = new Color(color);
        this.intensity = intensity;
        this.distance = distance;
        this.decay = decay;
      }
    }

    class WebGLRenderer {
      constructor(options = {}) {
        const canvas = options.canvas ?? document.createElement("canvas");
        const width = Math.max(1, options.width ?? canvas.clientWidth ?? g.innerWidth ?? 960);
        const height = Math.max(1, options.height ?? canvas.clientHeight ?? g.innerHeight ?? 600);
        const ok = native.RuntimeStart(width, height, "ThreeBrowser");
        if (!ok) throw new Error(native.LastError() || "failed to start native renderer");
        this.backend = native.BackendName();
        this.domElement = canvas;
        this.shadowMap = { enabled: false, type: 1 };
        this.xr = { enabled: false };
        this.capabilities = {
          getMaxAnisotropy: () => 16,
          isWebGL2: true,
        };
        this.info = {
          render: { frame: 0, calls: 0, triangles: 0 },
          memory: { geometries: 0, textures: 0 },
        };
        this._toneMapping = 0;
        this._toneMappingExposure = 1;
        this._anim = null;
        g.__threeNativeCanvas = canvas;
        native.RendererSetToneMapping(
          options.toneMapping ?? 0,
          options.toneMappingExposure ?? 1
        );
        if (document?.documentElement) {
          const style = document.createElement("style");
          style.textContent =
            "html,body{background:transparent!important;}canvas{background:transparent!important;}";
          (document.head || document.documentElement).appendChild(style);
        }
      }
      get aspect() {
        const h = this.domElement.clientHeight || 1;
        return (this.domElement.clientWidth || 1) / h;
      }
      setSize(width, height, updateStyle = true) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        native.RuntimeSetSize(w, h);
        this.domElement.width = w;
        this.domElement.height = h;
        if (updateStyle && this.domElement.style) {
          this.domElement.style.width = w + "px";
          this.domElement.style.height = h + "px";
        }
      }
      setPixelRatio() {}
      getContext() {
        return this.domElement.getContext("webgl2") || this.domElement.getContext("webgl");
      }
      setClearColor(color) {
        this._clearColor = color;
      }
      setAnimationLoop(cb) {
        this._anim = cb;
        if (!cb) return;
        const self = this;
        const loop = (t) => {
          if (self._anim !== cb) return;
          cb(t);
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }
      render(scene, camera) {
        flushPose(camera);
        flushPose(scene);
        this.info.render.frame++;
        const keep = native.RuntimeRender(scene._h, camera._h);
        if (!keep) {
          const err = native.LastError();
          if (err) console.warn(err);
        }
        return keep;
      }
      dispose() {
        this._anim = null;
      }
      get toneMapping() {
        return this._toneMapping;
      }
      set toneMapping(value) {
        this._toneMapping = value;
        native.RendererSetToneMapping(value, this._toneMappingExposure ?? 1);
      }
      get toneMappingExposure() {
        return this._toneMappingExposure;
      }
      set toneMappingExposure(value) {
        this._toneMappingExposure = value;
        native.RendererSetToneMapping(this._toneMapping ?? 0, value);
      }
    }

    const THREE = {
      REVISION: "native-threepp",
      Scene,
      Object3D,
      Group,
      Camera,
      PerspectiveCamera,
      BoxGeometry,
      PlaneGeometry,
      SphereGeometry,
      CylinderGeometry,
      TorusKnotGeometry,
      BufferGeometry,
      BufferAttribute,
      Float32BufferAttribute,
      Uint16BufferAttribute,
      InstancedBufferAttribute,
      Timer,
      MeshStandardMaterial,
      MeshBasicMaterial,
      MeshPhongMaterial,
      MeshLambertMaterial,
      MeshNormalMaterial,
      Mesh,
      InstancedMesh,
      HemisphereLight,
      AmbientLight,
      DirectionalLight,
      PointLight,
      WebGLRenderer,
      Vector2,
      Vector3,
      Vector4,
      Quaternion,
      Euler,
      Matrix3,
      Matrix4,
      Spherical,
      Color,
      Plane,
      Ray,
      MathUtils,
      EventDispatcher,
      Controls,
      Clock,
      Timer,
      Layers,
      Texture,
      TextureLoader,
      ColorManagement: { enabled: false, workingColorSpace: "srgb-linear" },
      MOUSE: { LEFT: 0, MIDDLE: 1, RIGHT: 2, ROTATE: 0, DOLLY: 1, PAN: 2 },
      TOUCH: { ROTATE: 0, PAN: 1, DOLLY_PAN: 2, DOLLY_ROTATE: 3 },
      SRGBColorSpace: "srgb",
      LinearSRGBColorSpace: "srgb-linear",
      NoColorSpace: "",
      DisplayP3ColorSpace: "display-p3",
      LinearDisplayP3ColorSpace: "display-p3-linear",
      NoToneMapping: 0,
      LinearToneMapping: 1,
      ReinhardToneMapping: 2,
      CineonToneMapping: 3,
      ACESFilmicToneMapping: 4,
      AgXToneMapping: 6,
      NeutralToneMapping: 7,
      CustomToneMapping: 5,
      FrontSide: 0,
      BackSide: 1,
      DoubleSide: 2,
      NoBlending: 0,
      NormalBlending: 1,
      AdditiveBlending: 2,
      SubtractiveBlending: 3,
      MultiplyBlending: 4,
      CustomBlending: 5,
      FlatShading: 1,
      SmoothShading: 2,
      RepeatWrapping: 1000,
      ClampToEdgeWrapping: 1001,
      MirroredRepeatWrapping: 1002,
      NearestFilter: 1003,
      NearestMipmapNearestFilter: 1004,
      NearestMipMapNearestFilter: 1004,
      NearestMipmapLinearFilter: 1005,
      NearestMipMapLinearFilter: 1005,
      LinearFilter: 1006,
      LinearMipmapNearestFilter: 1007,
      LinearMipMapNearestFilter: 1007,
      LinearMipmapLinearFilter: 1008,
      LinearMipMapLinearFilter: 1008,
      UVMapping: 300,
      CubeReflectionMapping: 301,
      CubeRefractionMapping: 302,
      EquirectangularReflectionMapping: 303,
      EquirectangularRefractionMapping: 304,
      BasicShadowMap: 0,
      PCFShadowMap: 1,
      PCFSoftShadowMap: 2,
      VSMShadowMap: 3,
      NeverDepth: 0,
      AlwaysDepth: 1,
      LessDepth: 2,
      LessEqualDepth: 3,
      EqualDepth: 4,
      GreaterEqualDepth: 5,
      GreaterDepth: 6,
      NotEqualDepth: 7,
      LoopOnce: 2200,
      LoopRepeat: 2201,
      LoopPingPong: 2202,
      InterpolateDiscrete: 2300,
      InterpolateLinear: 2301,
      InterpolateSmooth: 2302,
      NormalAnimationBlendMode: 2500,
      AdditiveAnimationBlendMode: 2501,
      TriangleFanDrawMode: 1,
      TriangleStripDrawMode: 2,
      TrianglesDrawMode: 0,
      object3d: (handle) => new Object3D(handle),
    };

    const stubs = [
      "BatchedMesh",
      "Line",
      "LineSegments",
      "LineLoop",
      "Points",
      "Sprite",
      "SkinnedMesh",
      "Bone",
      "Skeleton",
      "LOD",
      "OrthographicCamera",
      "CubeCamera",
      "ArrayCamera",
      "StereoCamera",
      "SpotLight",
      "RectAreaLight",
      "LightProbe",
      "MeshPhysicalMaterial",
      "MeshToonMaterial",
      "MeshMatcapMaterial",
      "MeshDepthMaterial",
      "MeshDistanceMaterial",
      "ShadowMaterial",
      "ShaderMaterial",
      "RawShaderMaterial",
      "PointsMaterial",
      "LineBasicMaterial",
      "LineDashedMaterial",
      "SpriteMaterial",
      "ConeGeometry",
      "CircleGeometry",
      "RingGeometry",
      "TorusGeometry",
      "DodecahedronGeometry",
      "IcosahedronGeometry",
      "OctahedronGeometry",
      "TetrahedronGeometry",
      "LatheGeometry",
      "ExtrudeGeometry",
      "ShapeGeometry",
      "TubeGeometry",
      "EdgesGeometry",
      "WireframeGeometry",
      "CapsuleGeometry",
      "InterleavedBuffer",
      "InterleavedBufferAttribute",
      "InstancedBufferAttribute",
      "Box3",
      "Box2",
      "Sphere",
      "Frustum",
      "Triangle",
      "Line3",
      "Cylindrical",
      "Raycaster",
      "Fog",
      "FogExp2",
      "AnimationMixer",
      "AnimationClip",
      "AnimationAction",
      "KeyframeTrack",
      "PMREMGenerator",
      "WebGLRenderTarget",
      "WebGLCubeRenderTarget",
      "WebGPURenderer",
      "DataTexture",
      "CanvasTexture",
      "VideoTexture",
      "CompressedTexture",
      "CubeTexture",
      "DepthTexture",
      "CubeTextureLoader",
      "FileLoader",
      "ImageLoader",
      "LoadingManager",
      "AxesHelper",
      "GridHelper",
      "BoxHelper",
      "ArrowHelper",
      "CameraHelper",
      "PolarGridHelper",
      "SkeletonHelper",
      "Shape",
      "Path",
      "ShapePath",
      "CurvePath",
      "CatmullRomCurve3",
      "Uniform",
      "UniformsUtils",
      "Cache",
    ];
    for (const name of stubs) {
      if (!THREE[name]) THREE[name] = stub(name);
    }
    THREE.DefaultLoadingManager = new THREE.LoadingManager();
    return THREE;
  }

  function nativeHost() {
    return g.chrome?.webview?.hostObjects?.sync?.native ?? null;
  }

  const host = nativeHost();
  if (!host) {
    console.error("ThreeBrowser: chrome.webview.hostObjects.sync.native is missing");
    g.THREE = g.THREE || {};
    return;
  }

  const THREE = createTHREE(host);
  g.THREE = THREE;
  console.info("[ThreeBrowser] native THREE (" + host.BackendName() + ") replaced window.THREE");

  const fire = () => {
    try {
      g.dispatchEvent(new Event("three-ready"));
    } catch {
      /* ignore */
    }
  };
  if (g.document && g.document.readyState === "loading") {
    g.document.addEventListener("DOMContentLoaded", fire);
  } else {
    fire();
  }
})();
