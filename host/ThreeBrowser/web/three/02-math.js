(function (TN) {
  'use strict';

  const WebGLCoordinateSystem = 2000;
  const WebGPUCoordinateSystem = 2001;

  const _lut = [];
  for (let i = 0; i < 256; i++) {
    _lut[i] = (i < 16 ? '0' : '') + i.toString(16);
  }
  let _seed = 1234567;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function euclideanModulo(n, m) {
    return ((n % m) + m) % m;
  }

  function lerp(x, y, t) {
    return (1 - t) * x + t * y;
  }

  function generateUUID() {
    const d0 = (Math.random() * 0xffffffff) | 0;
    const d1 = (Math.random() * 0xffffffff) | 0;
    const d2 = (Math.random() * 0xffffffff) | 0;
    const d3 = (Math.random() * 0xffffffff) | 0;
    return (
      _lut[d0 & 0xff] +
      _lut[(d0 >> 8) & 0xff] +
      _lut[(d0 >> 16) & 0xff] +
      _lut[(d0 >> 24) & 0xff] +
      '-' +
      _lut[d1 & 0xff] +
      _lut[(d1 >> 8) & 0xff] +
      '-' +
      _lut[((d1 >> 16) & 0x0f) | 0x40] +
      _lut[(d1 >> 24) & 0xff] +
      '-' +
      _lut[(d2 & 0x3f) | 0x80] +
      _lut[(d2 >> 8) & 0xff] +
      '-' +
      _lut[(d2 >> 16) & 0xff] +
      _lut[(d2 >> 24) & 0xff] +
      _lut[d3 & 0xff] +
      _lut[(d3 >> 8) & 0xff] +
      _lut[(d3 >> 16) & 0xff] +
      _lut[(d3 >> 24) & 0xff]
    ).toLowerCase();
  }

  function SRGBToLinear(c) {
    return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
  }

  function LinearToSRGB(c) {
    return c < 0.0031308 ? c * 12.92 : 1.055 * (Math.pow(c, 0.41666) - 0.055);
  }

  const MathUtils = {
    DEG2RAD: Math.PI / 180,
    RAD2DEG: 180 / Math.PI,
    generateUUID,
    clamp,
    euclideanModulo,
    mapLinear(x, a1, a2, b1, b2) {
      return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
    },
    inverseLerp(x, y, value) {
      return x !== y ? (value - x) / (y - x) : 0;
    },
    lerp,
    damp(x, y, lambda, dt) {
      return lerp(x, y, 1 - Math.exp(-lambda * dt));
    },
    pingpong(x, length = 1) {
      return length - Math.abs(euclideanModulo(x, length * 2) - length);
    },
    smoothstep(x, min, max) {
      if (x <= min) return 0;
      if (x >= max) return 1;
      x = (x - min) / (max - min);
      return x * x * (3 - 2 * x);
    },
    smootherstep(x, min, max) {
      if (x <= min) return 0;
      if (x >= max) return 1;
      x = (x - min) / (max - min);
      return x * x * x * (x * (x * 6 - 15) + 10);
    },
    randInt(low, high) {
      return low + Math.floor(Math.random() * (high - low + 1));
    },
    randFloat(low, high) {
      return low + Math.random() * (high - low);
    },
    randFloatSpread(range) {
      return range * (0.5 - Math.random());
    },
    seededRandom(s) {
      if (s !== undefined) _seed = s;
      let t = (_seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    degToRad(degrees) {
      return degrees * MathUtils.DEG2RAD;
    },
    radToDeg(radians) {
      return radians * MathUtils.RAD2DEG;
    },
    isPowerOfTwo(value) {
      return (value & (value - 1)) === 0 && value !== 0;
    },
    ceilPowerOfTwo(value) {
      return Math.pow(2, Math.ceil(Math.log(value) / Math.LN2));
    },
    floorPowerOfTwo(value) {
      return Math.pow(2, Math.floor(Math.log(value) / Math.LN2));
    },
    setQuaternionFromProperEuler(q, a, b, c, order) {
      const c2 = Math.cos(b / 2);
      const s2 = Math.sin(b / 2);
      const c13 = Math.cos((a + c) / 2);
      const s13 = Math.sin((a + c) / 2);
      const c1_3 = Math.cos((a - c) / 2);
      const s1_3 = Math.sin((a - c) / 2);
      const c3_1 = Math.cos((c - a) / 2);
      const s3_1 = Math.sin((c - a) / 2);
      switch (order) {
        case 'XYX':
          q.set(c2 * s13, s2 * c1_3, s2 * s1_3, c2 * c13);
          break;
        case 'YZY':
          q.set(s2 * s1_3, c2 * s13, s2 * c1_3, c2 * c13);
          break;
        case 'ZXZ':
          q.set(s2 * c1_3, s2 * s1_3, c2 * s13, c2 * c13);
          break;
        case 'XZX':
          q.set(c2 * s13, s2 * s3_1, s2 * c3_1, c2 * c13);
          break;
        case 'YXY':
          q.set(s2 * c3_1, c2 * s13, s2 * s3_1, c2 * c13);
          break;
        case 'ZYZ':
          q.set(s2 * s3_1, s2 * c3_1, c2 * s13, c2 * c13);
          break;
        default:
          console.warn('THREE.MathUtils: .setQuaternionFromProperEuler() unknown order: ' + order);
      }
    },
    normalize(value, array) {
      switch (array.constructor) {
        case Float32Array:
          return value;
        case Uint32Array:
          return Math.round(value * 4294967295.0);
        case Uint16Array:
          return Math.round(value * 65535.0);
        case Uint8Array:
          return Math.round(value * 255.0);
        case Int32Array:
          return Math.round(value * 2147483647.0);
        case Int16Array:
          return Math.round(value * 32767.0);
        case Int8Array:
          return Math.round(value * 127.0);
        default:
          throw new Error('Invalid component type.');
      }
    },
    denormalize(value, array) {
      switch (array.constructor) {
        case Float32Array:
          return value;
        case Uint32Array:
          return value / 4294967295.0;
        case Uint16Array:
          return value / 65535.0;
        case Uint8Array:
          return value / 255.0;
        case Int32Array:
          return Math.max(value / 2147483647.0, -1.0);
        case Int16Array:
          return Math.max(value / 32767.0, -1.0);
        case Int8Array:
          return Math.max(value / 127.0, -1.0);
        default:
          throw new Error('Invalid component type.');
      }
    },
  };

  class Vector2 {
    constructor(x = 0, y = 0) {
      this.isVector2 = true;
      this.x = x;
      this.y = y;
    }
    get width() {
      return this.x;
    }
    set width(v) {
      this.x = v;
    }
    get height() {
      return this.y;
    }
    set height(v) {
      this.y = v;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
    setScalar(s) {
      this.x = s;
      this.y = s;
      return this;
    }
    setX(x) {
      this.x = x;
      return this;
    }
    setY(y) {
      this.y = y;
      return this;
    }
    setComponent(index, value) {
      if (index === 0) this.x = value;
      else if (index === 1) this.y = value;
      else throw new Error('index is out of range: ' + index);
      return this;
    }
    getComponent(index) {
      if (index === 0) return this.x;
      if (index === 1) return this.y;
      throw new Error('index is out of range: ' + index);
    }
    clone() {
      return new this.constructor(this.x, this.y);
    }
    copy(v) {
      this.x = v.x;
      this.y = v.y;
      return this;
    }
    add(v) {
      this.x += v.x;
      this.y += v.y;
      return this;
    }
    addScalar(s) {
      this.x += s;
      this.y += s;
      return this;
    }
    addVectors(a, b) {
      this.x = a.x + b.x;
      this.y = a.y + b.y;
      return this;
    }
    addScaledVector(v, s) {
      this.x += v.x * s;
      this.y += v.y * s;
      return this;
    }
    sub(v) {
      this.x -= v.x;
      this.y -= v.y;
      return this;
    }
    subScalar(s) {
      this.x -= s;
      this.y -= s;
      return this;
    }
    subVectors(a, b) {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      return this;
    }
    multiply(v) {
      this.x *= v.x;
      this.y *= v.y;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      return this;
    }
    divide(v) {
      this.x /= v.x;
      this.y /= v.y;
      return this;
    }
    divideScalar(s) {
      return this.multiplyScalar(1 / s);
    }
    applyMatrix3(m) {
      const x = this.x;
      const y = this.y;
      const e = m.elements;
      this.x = e[0] * x + e[3] * y + e[6];
      this.y = e[1] * x + e[4] * y + e[7];
      return this;
    }
    min(v) {
      this.x = Math.min(this.x, v.x);
      this.y = Math.min(this.y, v.y);
      return this;
    }
    max(v) {
      this.x = Math.max(this.x, v.x);
      this.y = Math.max(this.y, v.y);
      return this;
    }
    clamp(min, max) {
      this.x = Math.max(min.x, Math.min(max.x, this.x));
      this.y = Math.max(min.y, Math.min(max.y, this.y));
      return this;
    }
    clampScalar(minVal, maxVal) {
      this.x = Math.max(minVal, Math.min(maxVal, this.x));
      this.y = Math.max(minVal, Math.min(maxVal, this.y));
      return this;
    }
    clampLength(min, max) {
      const length = this.length();
      return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
    }
    floor() {
      this.x = Math.floor(this.x);
      this.y = Math.floor(this.y);
      return this;
    }
    ceil() {
      this.x = Math.ceil(this.x);
      this.y = Math.ceil(this.y);
      return this;
    }
    round() {
      this.x = Math.round(this.x);
      this.y = Math.round(this.y);
      return this;
    }
    roundToZero() {
      this.x = Math.trunc(this.x);
      this.y = Math.trunc(this.y);
      return this;
    }
    negate() {
      this.x = -this.x;
      this.y = -this.y;
      return this;
    }
    dot(v) {
      return this.x * v.x + this.y * v.y;
    }
    cross(v) {
      return this.x * v.y - this.y * v.x;
    }
    lengthSq() {
      return this.x * this.x + this.y * this.y;
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    manhattanLength() {
      return Math.abs(this.x) + Math.abs(this.y);
    }
    normalize() {
      return this.divideScalar(this.length() || 1);
    }
    angle() {
      return Math.atan2(-this.y, -this.x) + Math.PI;
    }
    angleTo(v) {
      const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
      if (denominator === 0) return Math.PI / 2;
      return Math.acos(clamp(this.dot(v) / denominator, -1, 1));
    }
    distanceTo(v) {
      return Math.sqrt(this.distanceToSquared(v));
    }
    distanceToSquared(v) {
      const dx = this.x - v.x;
      const dy = this.y - v.y;
      return dx * dx + dy * dy;
    }
    manhattanDistanceTo(v) {
      return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);
    }
    setLength(length) {
      return this.normalize().multiplyScalar(length);
    }
    lerp(v, alpha) {
      this.x += (v.x - this.x) * alpha;
      this.y += (v.y - this.y) * alpha;
      return this;
    }
    lerpVectors(v1, v2, alpha) {
      this.x = v1.x + (v2.x - v1.x) * alpha;
      this.y = v1.y + (v2.y - v1.y) * alpha;
      return this;
    }
    equals(v) {
      return v.x === this.x && v.y === this.y;
    }
    fromArray(array, offset = 0) {
      this.x = array[offset];
      this.y = array[offset + 1];
      return this;
    }
    toArray(array = [], offset = 0) {
      array[offset] = this.x;
      array[offset + 1] = this.y;
      return array;
    }
    fromBufferAttribute(attribute, index) {
      this.x = attribute.getX(index);
      this.y = attribute.getY(index);
      return this;
    }
    rotateAround(center, angle) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = this.x - center.x;
      const y = this.y - center.y;
      this.x = x * c - y * s + center.x;
      this.y = x * s + y * c + center.y;
      return this;
    }
    random() {
      this.x = Math.random();
      this.y = Math.random();
      return this;
    }
    *[Symbol.iterator]() {
      yield this.x;
      yield this.y;
    }
  }

  class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.isQuaternion = true;
      this._x = x;
      this._y = y;
      this._z = z;
      this._w = w;
    }
    static slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t) {
      let x0 = src0[srcOffset0];
      let y0 = src0[srcOffset0 + 1];
      let z0 = src0[srcOffset0 + 2];
      let w0 = src0[srcOffset0 + 3];
      const x1 = src1[srcOffset1];
      const y1 = src1[srcOffset1 + 1];
      const z1 = src1[srcOffset1 + 2];
      const w1 = src1[srcOffset1 + 3];
      if (t === 0) {
        dst[dstOffset] = x0;
        dst[dstOffset + 1] = y0;
        dst[dstOffset + 2] = z0;
        dst[dstOffset + 3] = w0;
        return;
      }
      if (t === 1) {
        dst[dstOffset] = x1;
        dst[dstOffset + 1] = y1;
        dst[dstOffset + 2] = z1;
        dst[dstOffset + 3] = w1;
        return;
      }
      if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
        let s = 1 - t;
        const cos = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
        const dir = cos >= 0 ? 1 : -1;
        const sqrSin = 1 - cos * cos;
        if (sqrSin > Number.EPSILON) {
          const sin = Math.sqrt(sqrSin);
          const len = Math.atan2(sin, cos * dir);
          s = Math.sin(s * len) / sin;
          t = Math.sin(t * len) / sin;
        }
        const tDir = t * dir;
        x0 = x0 * s + x1 * tDir;
        y0 = y0 * s + y1 * tDir;
        z0 = z0 * s + z1 * tDir;
        w0 = w0 * s + w1 * tDir;
        if (s === 1 - t) {
          const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
          x0 *= f;
          y0 *= f;
          z0 *= f;
          w0 *= f;
        }
      }
      dst[dstOffset] = x0;
      dst[dstOffset + 1] = y0;
      dst[dstOffset + 2] = z0;
      dst[dstOffset + 3] = w0;
    }
    static multiplyQuaternionsFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1) {
      const x0 = src0[srcOffset0];
      const y0 = src0[srcOffset0 + 1];
      const z0 = src0[srcOffset0 + 2];
      const w0 = src0[srcOffset0 + 3];
      const x1 = src1[srcOffset1];
      const y1 = src1[srcOffset1 + 1];
      const z1 = src1[srcOffset1 + 2];
      const w1 = src1[srcOffset1 + 3];
      dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
      dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
      dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
      dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;
      return dst;
    }
    get x() {
      return this._x;
    }
    set x(v) {
      this._x = v;
      this._onChangeCallback();
    }
    get y() {
      return this._y;
    }
    set y(v) {
      this._y = v;
      this._onChangeCallback();
    }
    get z() {
      return this._z;
    }
    set z(v) {
      this._z = v;
      this._onChangeCallback();
    }
    get w() {
      return this._w;
    }
    set w(v) {
      this._w = v;
      this._onChangeCallback();
    }
    set(x, y, z, w) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._w = w;
      this._onChangeCallback();
      return this;
    }
    clone() {
      return new this.constructor(this._x, this._y, this._z, this._w);
    }
    copy(q) {
      this._x = q.x;
      this._y = q.y;
      this._z = q.z;
      this._w = q.w;
      this._onChangeCallback();
      return this;
    }
    setFromEuler(euler, update = true) {
      const x = euler._x;
      const y = euler._y;
      const z = euler._z;
      const order = euler._order;
      const c1 = Math.cos(x / 2);
      const c2 = Math.cos(y / 2);
      const c3 = Math.cos(z / 2);
      const s1 = Math.sin(x / 2);
      const s2 = Math.sin(y / 2);
      const s3 = Math.sin(z / 2);
      switch (order) {
        case 'XYZ':
          this._x = s1 * c2 * c3 + c1 * s2 * s3;
          this._y = c1 * s2 * c3 - s1 * c2 * s3;
          this._z = c1 * c2 * s3 + s1 * s2 * c3;
          this._w = c1 * c2 * c3 - s1 * s2 * s3;
          break;
        case 'YXZ':
          this._x = s1 * c2 * c3 + c1 * s2 * s3;
          this._y = c1 * s2 * c3 - s1 * c2 * s3;
          this._z = c1 * c2 * s3 - s1 * s2 * c3;
          this._w = c1 * c2 * c3 + s1 * s2 * s3;
          break;
        case 'ZXY':
          this._x = s1 * c2 * c3 - c1 * s2 * s3;
          this._y = c1 * s2 * c3 + s1 * c2 * s3;
          this._z = c1 * c2 * s3 + s1 * s2 * c3;
          this._w = c1 * c2 * c3 - s1 * s2 * s3;
          break;
        case 'ZYX':
          this._x = s1 * c2 * c3 - c1 * s2 * s3;
          this._y = c1 * s2 * c3 + s1 * c2 * s3;
          this._z = c1 * c2 * s3 - s1 * s2 * c3;
          this._w = c1 * c2 * c3 + s1 * s2 * s3;
          break;
        case 'YZX':
          this._x = s1 * c2 * c3 + c1 * s2 * s3;
          this._y = c1 * s2 * c3 + s1 * c2 * s3;
          this._z = c1 * c2 * s3 - s1 * s2 * c3;
          this._w = c1 * c2 * c3 - s1 * s2 * s3;
          break;
        case 'XZY':
          this._x = s1 * c2 * c3 - c1 * s2 * s3;
          this._y = c1 * s2 * c3 - s1 * c2 * s3;
          this._z = c1 * c2 * s3 + s1 * s2 * c3;
          this._w = c1 * c2 * c3 + s1 * s2 * s3;
          break;
        default:
          console.warn('THREE.Quaternion: .setFromEuler() unknown order: ' + order);
      }
      if (update === true) this._onChangeCallback();
      return this;
    }
    setFromAxisAngle(axis, angle) {
      const halfAngle = angle / 2;
      const s = Math.sin(halfAngle);
      this._x = axis.x * s;
      this._y = axis.y * s;
      this._z = axis.z * s;
      this._w = Math.cos(halfAngle);
      this._onChangeCallback();
      return this;
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
        this._w = 0.25 / s;
        this._x = (m32 - m23) * s;
        this._y = (m13 - m31) * s;
        this._z = (m21 - m12) * s;
      } else if (m11 > m22 && m11 > m33) {
        const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
        this._w = (m32 - m23) / s;
        this._x = 0.25 * s;
        this._y = (m12 + m21) / s;
        this._z = (m13 + m31) / s;
      } else if (m22 > m33) {
        const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
        this._w = (m13 - m31) / s;
        this._x = (m12 + m21) / s;
        this._y = 0.25 * s;
        this._z = (m23 + m32) / s;
      } else {
        const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
        this._w = (m21 - m12) / s;
        this._x = (m13 + m31) / s;
        this._y = (m23 + m32) / s;
        this._z = 0.25 * s;
      }
      this._onChangeCallback();
      return this;
    }
    setFromUnitVectors(vFrom, vTo) {
      let r = vFrom.dot(vTo) + 1;
      if (r < Number.EPSILON) {
        r = 0;
        if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
          this._x = -vFrom.y;
          this._y = vFrom.x;
          this._z = 0;
          this._w = r;
        } else {
          this._x = 0;
          this._y = -vFrom.z;
          this._z = vFrom.y;
          this._w = r;
        }
      } else {
        this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
        this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
        this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
        this._w = r;
      }
      return this.normalize();
    }
    angleTo(q) {
      return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
    }
    rotateTowards(q, step) {
      const angle = this.angleTo(q);
      if (angle === 0) return this;
      this.slerp(q, Math.min(1, step / angle));
      return this;
    }
    identity() {
      return this.set(0, 0, 0, 1);
    }
    invert() {
      return this.conjugate();
    }
    conjugate() {
      this._x *= -1;
      this._y *= -1;
      this._z *= -1;
      this._onChangeCallback();
      return this;
    }
    dot(v) {
      return this._x * v.x + this._y * v.y + this._z * v.z + this._w * v.w;
    }
    lengthSq() {
      return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
    }
    length() {
      return Math.sqrt(this.lengthSq());
    }
    normalize() {
      let l = this.length();
      if (l === 0) {
        this._x = 0;
        this._y = 0;
        this._z = 0;
        this._w = 1;
      } else {
        l = 1 / l;
        this._x *= l;
        this._y *= l;
        this._z *= l;
        this._w *= l;
      }
      this._onChangeCallback();
      return this;
    }
    multiply(q) {
      return this.multiplyQuaternions(this, q);
    }
    premultiply(q) {
      return this.multiplyQuaternions(q, this);
    }
    multiplyQuaternions(a, b) {
      const qax = a._x;
      const qay = a._y;
      const qaz = a._z;
      const qaw = a._w;
      const qbx = b._x;
      const qby = b._y;
      const qbz = b._z;
      const qbw = b._w;
      this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
      this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
      this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
      this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
      this._onChangeCallback();
      return this;
    }
    slerp(qb, t) {
      if (t === 0) return this;
      if (t === 1) return this.copy(qb);
      const x = this._x;
      const y = this._y;
      const z = this._z;
      const w = this._w;
      let cosHalfTheta = w * qb._w + x * qb._x + y * qb._y + z * qb._z;
      if (cosHalfTheta < 0) {
        this._w = -qb._w;
        this._x = -qb._x;
        this._y = -qb._y;
        this._z = -qb._z;
        cosHalfTheta = -cosHalfTheta;
      } else {
        this.copy(qb);
      }
      if (cosHalfTheta >= 1) {
        this._w = w;
        this._x = x;
        this._y = y;
        this._z = z;
        return this;
      }
      const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
      if (sqrSinHalfTheta <= Number.EPSILON) {
        const s = 1 - t;
        this._w = s * w + t * this._w;
        this._x = s * x + t * this._x;
        this._y = s * y + t * this._y;
        this._z = s * z + t * this._z;
        this.normalize();
        return this;
      }
      const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
      const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
      const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
      const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
      this._w = w * ratioA + this._w * ratioB;
      this._x = x * ratioA + this._x * ratioB;
      this._y = y * ratioA + this._y * ratioB;
      this._z = z * ratioA + this._z * ratioB;
      this._onChangeCallback();
      return this;
    }
    slerpQuaternions(qa, qb, t) {
      return this.copy(qa).slerp(qb, t);
    }
    random() {
      const theta1 = 2 * Math.PI * Math.random();
      const theta2 = 2 * Math.PI * Math.random();
      const x0 = Math.random();
      const r1 = Math.sqrt(1 - x0);
      const r2 = Math.sqrt(x0);
      return this.set(r1 * Math.sin(theta1), r1 * Math.cos(theta1), r2 * Math.sin(theta2), r2 * Math.cos(theta2));
    }
    equals(q) {
      return q._x === this._x && q._y === this._y && q._z === this._z && q._w === this._w;
    }
    fromArray(array, offset = 0) {
      this._x = array[offset];
      this._y = array[offset + 1];
      this._z = array[offset + 2];
      this._w = array[offset + 3];
      this._onChangeCallback();
      return this;
    }
    toArray(array = [], offset = 0) {
      array[offset] = this._x;
      array[offset + 1] = this._y;
      array[offset + 2] = this._z;
      array[offset + 3] = this._w;
      return array;
    }
    fromBufferAttribute(attribute, index) {
      this._x = attribute.getX(index);
      this._y = attribute.getY(index);
      this._z = attribute.getZ(index);
      this._w = attribute.getW(index);
      this._onChangeCallback();
      return this;
    }
    toJSON() {
      return this.toArray();
    }
    _onChange(callback) {
      this._onChangeCallback = callback;
      return this;
    }
    _onChangeCallback() {}
    *[Symbol.iterator]() {
      yield this._x;
      yield this._y;
      yield this._z;
      yield this._w;
    }
  }

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.isVector3 = true;
      this._x = x;
      this._y = y;
      this._z = z;
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
    set(x, y, z) {
      if (z === undefined) z = this._z;
      this._x = x;
      this._y = y;
      this._z = z;
      this._onChangeCallback();
      return this;
    }
    setScalar(s) {
      return this.set(s, s, s);
    }
    setX(x) {
      this.x = x;
      return this;
    }
    setY(y) {
      this.y = y;
      return this;
    }
    setZ(z) {
      this.z = z;
      return this;
    }
    setComponent(index, value) {
      if (index === 0) this.x = value;
      else if (index === 1) this.y = value;
      else if (index === 2) this.z = value;
      else throw new Error('index is out of range: ' + index);
      return this;
    }
    getComponent(index) {
      if (index === 0) return this._x;
      if (index === 1) return this._y;
      if (index === 2) return this._z;
      throw new Error('index is out of range: ' + index);
    }
    clone() {
      return new this.constructor(this._x, this._y, this._z);
    }
    copy(v) {
      return this.set(v.x, v.y, v.z);
    }
    add(v) {
      return this.set(this._x + v.x, this._y + v.y, this._z + v.z);
    }
    addScalar(s) {
      return this.set(this._x + s, this._y + s, this._z + s);
    }
    addVectors(a, b) {
      return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
    }
    addScaledVector(v, s) {
      return this.set(this._x + v.x * s, this._y + v.y * s, this._z + v.z * s);
    }
    sub(v) {
      return this.set(this._x - v.x, this._y - v.y, this._z - v.z);
    }
    subScalar(s) {
      return this.set(this._x - s, this._y - s, this._z - s);
    }
    subVectors(a, b) {
      return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    multiply(v) {
      return this.set(this._x * v.x, this._y * v.y, this._z * v.z);
    }
    multiplyScalar(s) {
      return this.set(this._x * s, this._y * s, this._z * s);
    }
    multiplyVectors(a, b) {
      return this.set(a.x * b.x, a.y * b.y, a.z * b.z);
    }
    applyEuler(euler) {
      return this.applyQuaternion(_v3quat.setFromEuler(euler));
    }
    applyAxisAngle(axis, angle) {
      return this.applyQuaternion(_v3quat.setFromAxisAngle(axis, angle));
    }
    applyMatrix3(m) {
      const x = this._x;
      const y = this._y;
      const z = this._z;
      const e = m.elements;
      return this.set(e[0] * x + e[3] * y + e[6] * z, e[1] * x + e[4] * y + e[7] * z, e[2] * x + e[5] * y + e[8] * z);
    }
    applyNormalMatrix(m) {
      return this.applyMatrix3(m).normalize();
    }
    applyMatrix4(m) {
      const x = this._x;
      const y = this._y;
      const z = this._z;
      const e = m.elements;
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      return this.set(
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
      );
    }
    applyQuaternion(q) {
      const vx = this._x;
      const vy = this._y;
      const vz = this._z;
      const qx = q.x;
      const qy = q.y;
      const qz = q.z;
      const qw = q.w;
      const tx = 2 * (qy * vz - qz * vy);
      const ty = 2 * (qz * vx - qx * vz);
      const tz = 2 * (qx * vy - qy * vx);
      return this.set(vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx);
    }
    project(camera) {
      return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    }
    unproject(camera) {
      if (!camera) return this;
      if (camera.projectionMatrixInverse) this.applyMatrix4(camera.projectionMatrixInverse);
      if (camera.matrixWorld) this.applyMatrix4(camera.matrixWorld);
      return this;
    }
    transformDirection(m) {
      const x = this._x;
      const y = this._y;
      const z = this._z;
      const e = m.elements;
      this.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z);
      return this.normalize();
    }
    divide(v) {
      return this.set(this._x / v.x, this._y / v.y, this._z / v.z);
    }
    divideScalar(s) {
      return this.multiplyScalar(1 / s);
    }
    min(v) {
      return this.set(Math.min(this._x, v.x), Math.min(this._y, v.y), Math.min(this._z, v.z));
    }
    max(v) {
      return this.set(Math.max(this._x, v.x), Math.max(this._y, v.y), Math.max(this._z, v.z));
    }
    clamp(min, max) {
      return this.set(
        Math.max(min.x, Math.min(max.x, this._x)),
        Math.max(min.y, Math.min(max.y, this._y)),
        Math.max(min.z, Math.min(max.z, this._z))
      );
    }
    clampScalar(minVal, maxVal) {
      return this.set(
        Math.max(minVal, Math.min(maxVal, this._x)),
        Math.max(minVal, Math.min(maxVal, this._y)),
        Math.max(minVal, Math.min(maxVal, this._z))
      );
    }
    clampLength(min, max) {
      const length = this.length();
      return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
    }
    floor() {
      return this.set(Math.floor(this._x), Math.floor(this._y), Math.floor(this._z));
    }
    ceil() {
      return this.set(Math.ceil(this._x), Math.ceil(this._y), Math.ceil(this._z));
    }
    round() {
      return this.set(Math.round(this._x), Math.round(this._y), Math.round(this._z));
    }
    roundToZero() {
      return this.set(Math.trunc(this._x), Math.trunc(this._y), Math.trunc(this._z));
    }
    negate() {
      return this.set(-this._x, -this._y, -this._z);
    }
    dot(v) {
      return this._x * v.x + this._y * v.y + this._z * v.z;
    }
    lengthSq() {
      return this._x * this._x + this._y * this._y + this._z * this._z;
    }
    length() {
      return Math.sqrt(this.lengthSq());
    }
    manhattanLength() {
      return Math.abs(this._x) + Math.abs(this._y) + Math.abs(this._z);
    }
    normalize() {
      return this.divideScalar(this.length() || 1);
    }
    setLength(length) {
      return this.normalize().multiplyScalar(length);
    }
    lerp(v, alpha) {
      return this.set(
        this._x + (v.x - this._x) * alpha,
        this._y + (v.y - this._y) * alpha,
        this._z + (v.z - this._z) * alpha
      );
    }
    lerpVectors(v1, v2, alpha) {
      return this.set(v1.x + (v2.x - v1.x) * alpha, v1.y + (v2.y - v1.y) * alpha, v1.z + (v2.z - v1.z) * alpha);
    }
    cross(v) {
      return this.crossVectors(this, v);
    }
    crossVectors(a, b) {
      const ax = a.x;
      const ay = a.y;
      const az = a.z;
      const bx = b.x;
      const by = b.y;
      const bz = b.z;
      return this.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    }
    projectOnVector(v) {
      const denominator = v.lengthSq();
      if (denominator === 0) return this.set(0, 0, 0);
      const scalar = v.dot(this) / denominator;
      return this.copy(v).multiplyScalar(scalar);
    }
    projectOnPlane(planeNormal) {
      _v3tmp.copy(this).projectOnVector(planeNormal);
      return this.sub(_v3tmp);
    }
    reflect(normal) {
      return this.sub(_v3tmp.copy(normal).multiplyScalar(2 * this.dot(normal)));
    }
    angleTo(v) {
      const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
      if (denominator === 0) return Math.PI / 2;
      return Math.acos(clamp(this.dot(v) / denominator, -1, 1));
    }
    distanceTo(v) {
      return Math.sqrt(this.distanceToSquared(v));
    }
    distanceToSquared(v) {
      const dx = this._x - v.x;
      const dy = this._y - v.y;
      const dz = this._z - v.z;
      return dx * dx + dy * dy + dz * dz;
    }
    manhattanDistanceTo(v) {
      return Math.abs(this._x - v.x) + Math.abs(this._y - v.y) + Math.abs(this._z - v.z);
    }
    setFromSpherical(s) {
      return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
    }
    setFromSphericalCoords(radius, phi, theta) {
      const sinPhiRadius = Math.sin(phi) * radius;
      return this.set(sinPhiRadius * Math.sin(theta), Math.cos(phi) * radius, sinPhiRadius * Math.cos(theta));
    }
    setFromCylindrical(c) {
      return this.setFromCylindricalCoords(c.radius, c.theta, c.y);
    }
    setFromCylindricalCoords(radius, theta, y) {
      return this.set(radius * Math.sin(theta), y, radius * Math.cos(theta));
    }
    setFromMatrixPosition(m) {
      const e = m.elements;
      return this.set(e[12], e[13], e[14]);
    }
    setFromMatrixScale(m) {
      const sx = this.setFromMatrixColumn(m, 0).length();
      const sy = this.setFromMatrixColumn(m, 1).length();
      const sz = this.setFromMatrixColumn(m, 2).length();
      return this.set(sx, sy, sz);
    }
    setFromMatrixColumn(m, index) {
      return this.fromArray(m.elements, index * 4);
    }
    setFromMatrix3Column(m, index) {
      return this.fromArray(m.elements, index * 3);
    }
    setFromEuler(e) {
      return this.set(e._x, e._y, e._z);
    }
    setFromColor(c) {
      return this.set(c.r, c.g, c.b);
    }
    equals(v) {
      return v.x === this._x && v.y === this._y && v.z === this._z;
    }
    fromArray(array, offset = 0) {
      return this.set(array[offset], array[offset + 1], array[offset + 2]);
    }
    toArray(array = [], offset = 0) {
      array[offset] = this._x;
      array[offset + 1] = this._y;
      array[offset + 2] = this._z;
      return array;
    }
    fromBufferAttribute(attribute, index) {
      return this.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    }
    random() {
      return this.set(Math.random(), Math.random(), Math.random());
    }
    randomDirection() {
      const theta = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const c = Math.sqrt(1 - u * u);
      return this.set(c * Math.cos(theta), u, c * Math.sin(theta));
    }
    _onChange(callback) {
      this._onChangeCallback = callback;
      return this;
    }
    _onChangeCallback() {}
    *[Symbol.iterator]() {
      yield this._x;
      yield this._y;
      yield this._z;
    }
  }

  class Vector4 {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.isVector4 = true;
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
    }
    get width() {
      return this.z;
    }
    set width(v) {
      this.z = v;
    }
    get height() {
      return this.w;
    }
    set height(v) {
      this.w = v;
    }
    set(x, y, z, w) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
      return this;
    }
    setScalar(s) {
      this.x = s;
      this.y = s;
      this.z = s;
      this.w = s;
      return this;
    }
    setX(x) {
      this.x = x;
      return this;
    }
    setY(y) {
      this.y = y;
      return this;
    }
    setZ(z) {
      this.z = z;
      return this;
    }
    setW(w) {
      this.w = w;
      return this;
    }
    setComponent(index, value) {
      if (index === 0) this.x = value;
      else if (index === 1) this.y = value;
      else if (index === 2) this.z = value;
      else if (index === 3) this.w = value;
      else throw new Error('index is out of range: ' + index);
      return this;
    }
    getComponent(index) {
      if (index === 0) return this.x;
      if (index === 1) return this.y;
      if (index === 2) return this.z;
      if (index === 3) return this.w;
      throw new Error('index is out of range: ' + index);
    }
    clone() {
      return new this.constructor(this.x, this.y, this.z, this.w);
    }
    copy(v) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      this.w = v.w !== undefined ? v.w : 1;
      return this;
    }
    add(v) {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      this.w += v.w;
      return this;
    }
    addScalar(s) {
      this.x += s;
      this.y += s;
      this.z += s;
      this.w += s;
      return this;
    }
    addVectors(a, b) {
      this.x = a.x + b.x;
      this.y = a.y + b.y;
      this.z = a.z + b.z;
      this.w = a.w + b.w;
      return this;
    }
    addScaledVector(v, s) {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      this.w += v.w * s;
      return this;
    }
    sub(v) {
      this.x -= v.x;
      this.y -= v.y;
      this.z -= v.z;
      this.w -= v.w;
      return this;
    }
    subScalar(s) {
      this.x -= s;
      this.y -= s;
      this.z -= s;
      this.w -= s;
      return this;
    }
    subVectors(a, b) {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      this.z = a.z - b.z;
      this.w = a.w - b.w;
      return this;
    }
    multiply(v) {
      this.x *= v.x;
      this.y *= v.y;
      this.z *= v.z;
      this.w *= v.w;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      this.w *= s;
      return this;
    }
    applyMatrix4(m) {
      const x = this.x;
      const y = this.y;
      const z = this.z;
      const w = this.w;
      const e = m.elements;
      this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
      this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
      this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
      this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
      return this;
    }
    divide(v) {
      this.x /= v.x;
      this.y /= v.y;
      this.z /= v.z;
      this.w /= v.w;
      return this;
    }
    divideScalar(s) {
      return this.multiplyScalar(1 / s);
    }
    setAxisAngleFromQuaternion(q) {
      this.w = 2 * Math.acos(q.w);
      const s = Math.sqrt(1 - q.w * q.w);
      if (s < 0.0001) {
        this.x = 1;
        this.y = 0;
        this.z = 0;
      } else {
        this.x = q.x / s;
        this.y = q.y / s;
        this.z = q.z / s;
      }
      return this;
    }
    setFromMatrixPosition(m) {
      const e = m.elements;
      this.x = e[12];
      this.y = e[13];
      this.z = e[14];
      this.w = e[15];
      return this;
    }
    min(v) {
      this.x = Math.min(this.x, v.x);
      this.y = Math.min(this.y, v.y);
      this.z = Math.min(this.z, v.z);
      this.w = Math.min(this.w, v.w);
      return this;
    }
    max(v) {
      this.x = Math.max(this.x, v.x);
      this.y = Math.max(this.y, v.y);
      this.z = Math.max(this.z, v.z);
      this.w = Math.max(this.w, v.w);
      return this;
    }
    clamp(min, max) {
      this.x = Math.max(min.x, Math.min(max.x, this.x));
      this.y = Math.max(min.y, Math.min(max.y, this.y));
      this.z = Math.max(min.z, Math.min(max.z, this.z));
      this.w = Math.max(min.w, Math.min(max.w, this.w));
      return this;
    }
    clampScalar(minVal, maxVal) {
      this.x = Math.max(minVal, Math.min(maxVal, this.x));
      this.y = Math.max(minVal, Math.min(maxVal, this.y));
      this.z = Math.max(minVal, Math.min(maxVal, this.z));
      this.w = Math.max(minVal, Math.min(maxVal, this.w));
      return this;
    }
    clampLength(min, max) {
      const length = this.length();
      return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
    }
    floor() {
      this.x = Math.floor(this.x);
      this.y = Math.floor(this.y);
      this.z = Math.floor(this.z);
      this.w = Math.floor(this.w);
      return this;
    }
    ceil() {
      this.x = Math.ceil(this.x);
      this.y = Math.ceil(this.y);
      this.z = Math.ceil(this.z);
      this.w = Math.ceil(this.w);
      return this;
    }
    round() {
      this.x = Math.round(this.x);
      this.y = Math.round(this.y);
      this.z = Math.round(this.z);
      this.w = Math.round(this.w);
      return this;
    }
    roundToZero() {
      this.x = Math.trunc(this.x);
      this.y = Math.trunc(this.y);
      this.z = Math.trunc(this.z);
      this.w = Math.trunc(this.w);
      return this;
    }
    negate() {
      this.x = -this.x;
      this.y = -this.y;
      this.z = -this.z;
      this.w = -this.w;
      return this;
    }
    dot(v) {
      return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
    }
    lengthSq() {
      return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }
    length() {
      return Math.sqrt(this.lengthSq());
    }
    manhattanLength() {
      return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
    }
    normalize() {
      return this.divideScalar(this.length() || 1);
    }
    setLength(length) {
      return this.normalize().multiplyScalar(length);
    }
    lerp(v, alpha) {
      this.x += (v.x - this.x) * alpha;
      this.y += (v.y - this.y) * alpha;
      this.z += (v.z - this.z) * alpha;
      this.w += (v.w - this.w) * alpha;
      return this;
    }
    lerpVectors(v1, v2, alpha) {
      this.x = v1.x + (v2.x - v1.x) * alpha;
      this.y = v1.y + (v2.y - v1.y) * alpha;
      this.z = v1.z + (v2.z - v1.z) * alpha;
      this.w = v1.w + (v2.w - v1.w) * alpha;
      return this;
    }
    equals(v) {
      return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;
    }
    fromArray(array, offset = 0) {
      this.x = array[offset];
      this.y = array[offset + 1];
      this.z = array[offset + 2];
      this.w = array[offset + 3];
      return this;
    }
    toArray(array = [], offset = 0) {
      array[offset] = this.x;
      array[offset + 1] = this.y;
      array[offset + 2] = this.z;
      array[offset + 3] = this.w;
      return array;
    }
    fromBufferAttribute(attribute, index) {
      this.x = attribute.getX(index);
      this.y = attribute.getY(index);
      this.z = attribute.getZ(index);
      this.w = attribute.getW(index);
      return this;
    }
    random() {
      this.x = Math.random();
      this.y = Math.random();
      this.z = Math.random();
      this.w = Math.random();
      return this;
    }
    *[Symbol.iterator]() {
      yield this.x;
      yield this.y;
      yield this.z;
      yield this.w;
    }
  }

  class Euler {
    constructor(x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER) {
      this.isEuler = true;
      this._x = x;
      this._y = y;
      this._z = z;
      this._order = order;
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
      this._onChangeCallback();
    }
    set(x, y, z, order = this._order) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._order = order;
      this._onChangeCallback();
      return this;
    }
    clone() {
      return new this.constructor(this._x, this._y, this._z, this._order);
    }
    copy(euler) {
      this._x = euler._x;
      this._y = euler._y;
      this._z = euler._z;
      this._order = euler._order;
      this._onChangeCallback();
      return this;
    }
    setFromRotationMatrix(m, order = this._order, update = true) {
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
      switch (order) {
        case 'XYZ':
          this._y = Math.asin(clamp(m13, -1, 1));
          if (Math.abs(m13) < 0.9999999) {
            this._x = Math.atan2(-m23, m33);
            this._z = Math.atan2(-m12, m11);
          } else {
            this._x = Math.atan2(m32, m22);
            this._z = 0;
          }
          break;
        case 'YXZ':
          this._x = Math.asin(-clamp(m23, -1, 1));
          if (Math.abs(m23) < 0.9999999) {
            this._y = Math.atan2(m13, m33);
            this._z = Math.atan2(m21, m22);
          } else {
            this._y = Math.atan2(-m31, m11);
            this._z = 0;
          }
          break;
        case 'ZXY':
          this._x = Math.asin(clamp(m32, -1, 1));
          if (Math.abs(m32) < 0.9999999) {
            this._y = Math.atan2(-m31, m33);
            this._z = Math.atan2(-m12, m22);
          } else {
            this._y = 0;
            this._z = Math.atan2(m21, m11);
          }
          break;
        case 'ZYX':
          this._y = Math.asin(-clamp(m31, -1, 1));
          if (Math.abs(m31) < 0.9999999) {
            this._x = Math.atan2(m32, m33);
            this._z = Math.atan2(m21, m11);
          } else {
            this._x = 0;
            this._z = Math.atan2(-m12, m22);
          }
          break;
        case 'YZX':
          this._z = Math.asin(clamp(m21, -1, 1));
          if (Math.abs(m21) < 0.9999999) {
            this._x = Math.atan2(-m23, m22);
            this._y = Math.atan2(-m31, m11);
          } else {
            this._x = 0;
            this._y = Math.atan2(m13, m33);
          }
          break;
        case 'XZY':
          this._z = Math.asin(-clamp(m12, -1, 1));
          if (Math.abs(m12) < 0.9999999) {
            this._x = Math.atan2(m32, m22);
            this._y = Math.atan2(m13, m11);
          } else {
            this._x = Math.atan2(-m23, m33);
            this._y = 0;
          }
          break;
        default:
          console.warn('THREE.Euler: .setFromRotationMatrix() unknown order: ' + order);
      }
      this._order = order;
      if (update === true) this._onChangeCallback();
      return this;
    }
    setFromQuaternion(q, order, update) {
      return this.setFromRotationMatrix(_eulerM.makeRotationFromQuaternion(q), order, update);
    }
    setFromVector3(v, order = this._order) {
      return this.set(v.x, v.y, v.z, order);
    }
    reorder(newOrder) {
      _eulerQ.setFromEuler(this);
      return this.setFromQuaternion(_eulerQ, newOrder);
    }
    equals(euler) {
      return euler._x === this._x && euler._y === this._y && euler._z === this._z && euler._order === this._order;
    }
    fromArray(array) {
      this._x = array[0];
      this._y = array[1];
      this._z = array[2];
      if (array[3] !== undefined) this._order = array[3];
      this._onChangeCallback();
      return this;
    }
    toArray(array = [], offset = 0) {
      array[offset] = this._x;
      array[offset + 1] = this._y;
      array[offset + 2] = this._z;
      array[offset + 3] = this._order;
      return array;
    }
    _onChange(callback) {
      this._onChangeCallback = callback;
      return this;
    }
    _onChangeCallback() {}
    *[Symbol.iterator]() {
      yield this._x;
      yield this._y;
      yield this._z;
      yield this._order;
    }
  }
  Euler.DEFAULT_ORDER = 'XYZ';

  class Matrix2 {
    constructor(n11, n12, n21, n22) {
      this.isMatrix2 = true;
      this.elements = [1, 0, 0, 1];
      if (n11 !== undefined) this.set(n11, n12, n21, n22);
    }
    set(n11, n12, n21, n22) {
      const te = this.elements;
      te[0] = n11;
      te[2] = n12;
      te[1] = n21;
      te[3] = n22;
      return this;
    }
    identity() {
      return this.set(1, 0, 0, 1);
    }
    copy(m) {
      const te = this.elements;
      const me = m.elements;
      te[0] = me[0];
      te[1] = me[1];
      te[2] = me[2];
      te[3] = me[3];
      return this;
    }
    clone() {
      return new this.constructor().fromArray(this.elements);
    }
    fromArray(array, offset = 0) {
      for (let i = 0; i < 4; i++) this.elements[i] = array[i + offset];
      return this;
    }
    toArray(array = [], offset = 0) {
      const te = this.elements;
      array[offset] = te[0];
      array[offset + 1] = te[1];
      array[offset + 2] = te[2];
      array[offset + 3] = te[3];
      return array;
    }
    multiply(m) {
      return this.multiplyMatrices(this, m);
    }
    multiplyMatrices(a, b) {
      const ae = a.elements;
      const be = b.elements;
      const te = this.elements;
      const a11 = ae[0];
      const a12 = ae[2];
      const a21 = ae[1];
      const a22 = ae[3];
      const b11 = be[0];
      const b12 = be[2];
      const b21 = be[1];
      const b22 = be[3];
      te[0] = a11 * b11 + a12 * b21;
      te[2] = a11 * b12 + a12 * b22;
      te[1] = a21 * b11 + a22 * b21;
      te[3] = a21 * b12 + a22 * b22;
      return this;
    }
    determinant() {
      const te = this.elements;
      return te[0] * te[3] - te[2] * te[1];
    }
    invert() {
      const te = this.elements;
      const n11 = te[0];
      const n21 = te[1];
      const n12 = te[2];
      const n22 = te[3];
      const det = n11 * n22 - n12 * n21;
      if (det === 0) return this.set(0, 0, 0, 0);
      const inv = 1 / det;
      te[0] = n22 * inv;
      te[1] = -n21 * inv;
      te[2] = -n12 * inv;
      te[3] = n11 * inv;
      return this;
    }
  }

  class Matrix3 {
    constructor(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
      this.isMatrix3 = true;
      this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      if (n11 !== undefined) this.set(n11, n12, n13, n21, n22, n23, n31, n32, n33);
    }
    set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
      const te = this.elements;
      te[0] = n11;
      te[1] = n21;
      te[2] = n31;
      te[3] = n12;
      te[4] = n22;
      te[5] = n32;
      te[6] = n13;
      te[7] = n23;
      te[8] = n33;
      return this;
    }
    identity() {
      return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
    }
    copy(m) {
      const te = this.elements;
      const me = m.elements;
      for (let i = 0; i < 9; i++) te[i] = me[i];
      return this;
    }
    extractBasis(xAxis, yAxis, zAxis) {
      xAxis.setFromMatrix3Column(this, 0);
      yAxis.setFromMatrix3Column(this, 1);
      zAxis.setFromMatrix3Column(this, 2);
      return this;
    }
    setFromMatrix4(m) {
      const me = m.elements;
      return this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]);
    }
    multiply(m) {
      return this.multiplyMatrices(this, m);
    }
    premultiply(m) {
      return this.multiplyMatrices(m, this);
    }
    multiplyMatrices(a, b) {
      const ae = a.elements;
      const be = b.elements;
      const te = this.elements;
      const a11 = ae[0];
      const a12 = ae[3];
      const a13 = ae[6];
      const a21 = ae[1];
      const a22 = ae[4];
      const a23 = ae[7];
      const a31 = ae[2];
      const a32 = ae[5];
      const a33 = ae[8];
      const b11 = be[0];
      const b12 = be[3];
      const b13 = be[6];
      const b21 = be[1];
      const b22 = be[4];
      const b23 = be[7];
      const b31 = be[2];
      const b32 = be[5];
      const b33 = be[8];
      te[0] = a11 * b11 + a12 * b21 + a13 * b31;
      te[3] = a11 * b12 + a12 * b22 + a13 * b32;
      te[6] = a11 * b13 + a12 * b23 + a13 * b33;
      te[1] = a21 * b11 + a22 * b21 + a23 * b31;
      te[4] = a21 * b12 + a22 * b22 + a23 * b32;
      te[7] = a21 * b13 + a22 * b23 + a23 * b33;
      te[2] = a31 * b11 + a32 * b21 + a33 * b31;
      te[5] = a31 * b12 + a32 * b22 + a33 * b32;
      te[8] = a31 * b13 + a32 * b23 + a33 * b33;
      return this;
    }
    multiplyScalar(s) {
      const te = this.elements;
      for (let i = 0; i < 9; i++) te[i] *= s;
      return this;
    }
    determinant() {
      const te = this.elements;
      const a = te[0];
      const b = te[1];
      const c = te[2];
      const d = te[3];
      const e = te[4];
      const f = te[5];
      const g = te[6];
      const h = te[7];
      const i = te[8];
      return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
    }
    invert() {
      const te = this.elements;
      const n11 = te[0];
      const n21 = te[1];
      const n31 = te[2];
      const n12 = te[3];
      const n22 = te[4];
      const n32 = te[5];
      const n13 = te[6];
      const n23 = te[7];
      const n33 = te[8];
      const t11 = n33 * n22 - n32 * n23;
      const t12 = n32 * n13 - n33 * n12;
      const t13 = n23 * n12 - n22 * n13;
      const det = n11 * t11 + n21 * t12 + n31 * t13;
      if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      const detInv = 1 / det;
      te[0] = t11 * detInv;
      te[1] = (n31 * n23 - n33 * n21) * detInv;
      te[2] = (n32 * n21 - n31 * n22) * detInv;
      te[3] = t12 * detInv;
      te[4] = (n33 * n11 - n31 * n13) * detInv;
      te[5] = (n31 * n12 - n32 * n11) * detInv;
      te[6] = t13 * detInv;
      te[7] = (n21 * n13 - n23 * n11) * detInv;
      te[8] = (n22 * n11 - n21 * n12) * detInv;
      return this;
    }
    transpose() {
      const m = this.elements;
      let tmp = m[1];
      m[1] = m[3];
      m[3] = tmp;
      tmp = m[2];
      m[2] = m[6];
      m[6] = tmp;
      tmp = m[5];
      m[5] = m[7];
      m[7] = tmp;
      return this;
    }
    getNormalMatrix(matrix4) {
      return this.setFromMatrix4(matrix4).invert().transpose();
    }
    transposeIntoArray(r) {
      const m = this.elements;
      r[0] = m[0];
      r[1] = m[3];
      r[2] = m[6];
      r[3] = m[1];
      r[4] = m[4];
      r[5] = m[7];
      r[6] = m[2];
      r[7] = m[5];
      r[8] = m[8];
      return this;
    }
    setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      return this.set(
        sx * c,
        sx * s,
        -sx * (c * cx + s * cy) + cx + tx,
        -sy * s,
        sy * c,
        -sy * (-s * cx + c * cy) + cy + ty,
        0,
        0,
        1
      );
    }
    scale(sx, sy) {
      this.premultiply(_m3tmp.makeScale(sx, sy));
      return this;
    }
    rotate(theta) {
      this.premultiply(_m3tmp.makeRotation(-theta));
      return this;
    }
    translate(tx, ty) {
      this.premultiply(_m3tmp.makeTranslation(tx, ty));
      return this;
    }
    makeTranslation(x, y) {
      if (x && x.isVector2) return this.set(1, 0, x.x, 0, 1, x.y, 0, 0, 1);
      return this.set(1, 0, x, 0, 1, y, 0, 0, 1);
    }
    makeRotation(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return this.set(c, -s, 0, s, c, 0, 0, 0, 1);
    }
    makeScale(x, y) {
      return this.set(x, 0, 0, 0, y, 0, 0, 0, 1);
    }
    equals(matrix) {
      const te = this.elements;
      const me = matrix.elements;
      for (let i = 0; i < 9; i++) if (te[i] !== me[i]) return false;
      return true;
    }
    fromArray(array, offset = 0) {
      for (let i = 0; i < 9; i++) this.elements[i] = array[i + offset];
      return this;
    }
    toArray(array = [], offset = 0) {
      const te = this.elements;
      for (let i = 0; i < 9; i++) array[offset + i] = te[i];
      return array;
    }
    clone() {
      return new this.constructor().fromArray(this.elements);
    }
  }

  class Matrix4 {
    constructor(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
      this.isMatrix4 = true;
      this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      if (n11 !== undefined) {
        this.set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44);
      }
    }
    set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
      const te = this.elements;
      te[0] = n11;
      te[4] = n12;
      te[8] = n13;
      te[12] = n14;
      te[1] = n21;
      te[5] = n22;
      te[9] = n23;
      te[13] = n24;
      te[2] = n31;
      te[6] = n32;
      te[10] = n33;
      te[14] = n34;
      te[3] = n41;
      te[7] = n42;
      te[11] = n43;
      te[15] = n44;
      return this;
    }
    identity() {
      return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }
    clone() {
      return new Matrix4().fromArray(this.elements);
    }
    copy(m) {
      const te = this.elements;
      const me = m.elements;
      for (let i = 0; i < 16; i++) te[i] = me[i];
      return this;
    }
    copyPosition(m) {
      const te = this.elements;
      const me = m.elements;
      te[12] = me[12];
      te[13] = me[13];
      te[14] = me[14];
      return this;
    }
    setFromMatrix3(m) {
      const me = m.elements;
      return this.set(me[0], me[3], me[6], 0, me[1], me[4], me[7], 0, me[2], me[5], me[8], 0, 0, 0, 0, 1);
    }
    extractBasis(xAxis, yAxis, zAxis) {
      xAxis.setFromMatrixColumn(this, 0);
      yAxis.setFromMatrixColumn(this, 1);
      zAxis.setFromMatrixColumn(this, 2);
      return this;
    }
    makeBasis(xAxis, yAxis, zAxis) {
      return this.set(xAxis.x, yAxis.x, zAxis.x, 0, xAxis.y, yAxis.y, zAxis.y, 0, xAxis.z, yAxis.z, zAxis.z, 0, 0, 0, 0, 1);
    }
    extractRotation(m) {
      const te = this.elements;
      const me = m.elements;
      const scaleX = 1 / _m4v.setFromMatrixColumn(m, 0).length();
      const scaleY = 1 / _m4v.setFromMatrixColumn(m, 1).length();
      const scaleZ = 1 / _m4v.setFromMatrixColumn(m, 2).length();
      te[0] = me[0] * scaleX;
      te[1] = me[1] * scaleX;
      te[2] = me[2] * scaleX;
      te[3] = 0;
      te[4] = me[4] * scaleY;
      te[5] = me[5] * scaleY;
      te[6] = me[6] * scaleY;
      te[7] = 0;
      te[8] = me[8] * scaleZ;
      te[9] = me[9] * scaleZ;
      te[10] = me[10] * scaleZ;
      te[11] = 0;
      te[12] = 0;
      te[13] = 0;
      te[14] = 0;
      te[15] = 1;
      return this;
    }
    makeRotationFromEuler(euler) {
      const te = this.elements;
      const x = euler.x;
      const y = euler.y;
      const z = euler.z;
      const a = Math.cos(x);
      const b = Math.sin(x);
      const c = Math.cos(y);
      const d = Math.sin(y);
      const e = Math.cos(z);
      const f = Math.sin(z);
      if (euler.order === 'XYZ') {
        const ae = a * e;
        const af = a * f;
        const be = b * e;
        const bf = b * f;
        te[0] = c * e;
        te[4] = -c * f;
        te[8] = d;
        te[1] = af + be * d;
        te[5] = ae - bf * d;
        te[9] = -b * c;
        te[2] = bf - ae * d;
        te[6] = be + af * d;
        te[10] = a * c;
      } else if (euler.order === 'YXZ') {
        const ce = c * e;
        const cf = c * f;
        const de = d * e;
        const df = d * f;
        te[0] = ce + df * b;
        te[4] = de * b - cf;
        te[8] = a * d;
        te[1] = a * f;
        te[5] = a * e;
        te[9] = -b;
        te[2] = cf * b - de;
        te[6] = df + ce * b;
        te[10] = a * c;
      } else if (euler.order === 'ZXY') {
        const ce = c * e;
        const cf = c * f;
        const de = d * e;
        const df = d * f;
        te[0] = ce - df * b;
        te[4] = -a * f;
        te[8] = de + cf * b;
        te[1] = cf + de * b;
        te[5] = a * e;
        te[9] = df - ce * b;
        te[2] = -a * d;
        te[6] = b;
        te[10] = a * c;
      } else if (euler.order === 'ZYX') {
        const ae = a * e;
        const af = a * f;
        const be = b * e;
        const bf = b * f;
        te[0] = c * e;
        te[4] = be * d - af;
        te[8] = ae * d + bf;
        te[1] = c * f;
        te[5] = bf * d + ae;
        te[9] = af * d - be;
        te[2] = -d;
        te[6] = b * c;
        te[10] = a * c;
      } else if (euler.order === 'YZX') {
        const ac = a * c;
        const ad = a * d;
        const bc = b * c;
        const bd = b * d;
        te[0] = c * e;
        te[4] = bd - ac * f;
        te[8] = bc * f + ad;
        te[1] = f;
        te[5] = a * e;
        te[9] = -b * e;
        te[2] = -d * e;
        te[6] = ad * f + bc;
        te[10] = ac - bd * f;
      } else if (euler.order === 'XZY') {
        const ac = a * c;
        const ad = a * d;
        const bc = b * c;
        const bd = b * d;
        te[0] = c * e;
        te[4] = -f;
        te[8] = d * e;
        te[1] = ac * f + bd;
        te[5] = a * e;
        te[9] = ad * f - bc;
        te[2] = bc * f - ad;
        te[6] = b * e;
        te[10] = bd * f + ac;
      }
      te[3] = 0;
      te[7] = 0;
      te[11] = 0;
      te[12] = 0;
      te[13] = 0;
      te[14] = 0;
      te[15] = 1;
      return this;
    }
    makeRotationFromQuaternion(q) {
      return this.compose(_m4zero, q, _m4one);
    }
    lookAt(eye, target, up) {
      const te = this.elements;
      _m4z.subVectors(eye, target);
      if (_m4z.lengthSq() === 0) _m4z.z = 1;
      _m4z.normalize();
      _m4x.crossVectors(up, _m4z);
      if (_m4x.lengthSq() === 0) {
        if (Math.abs(up.z) === 1) _m4z.x += 0.0001;
        else _m4z.z += 0.0001;
        _m4z.normalize();
        _m4x.crossVectors(up, _m4z);
      }
      _m4x.normalize();
      _m4y.crossVectors(_m4z, _m4x);
      te[0] = _m4x.x;
      te[4] = _m4y.x;
      te[8] = _m4z.x;
      te[1] = _m4x.y;
      te[5] = _m4y.y;
      te[9] = _m4z.y;
      te[2] = _m4x.z;
      te[6] = _m4y.z;
      te[10] = _m4z.z;
      return this;
    }
    multiply(m) {
      return this.multiplyMatrices(this, m);
    }
    premultiply(m) {
      return this.multiplyMatrices(m, this);
    }
    multiplyMatrices(a, b) {
      const ae = a.elements;
      const be = b.elements;
      const te = this.elements;
      const a11 = ae[0];
      const a12 = ae[4];
      const a13 = ae[8];
      const a14 = ae[12];
      const a21 = ae[1];
      const a22 = ae[5];
      const a23 = ae[9];
      const a24 = ae[13];
      const a31 = ae[2];
      const a32 = ae[6];
      const a33 = ae[10];
      const a34 = ae[14];
      const a41 = ae[3];
      const a42 = ae[7];
      const a43 = ae[11];
      const a44 = ae[15];
      const b11 = be[0];
      const b12 = be[4];
      const b13 = be[8];
      const b14 = be[12];
      const b21 = be[1];
      const b22 = be[5];
      const b23 = be[9];
      const b24 = be[13];
      const b31 = be[2];
      const b32 = be[6];
      const b33 = be[10];
      const b34 = be[14];
      const b41 = be[3];
      const b42 = be[7];
      const b43 = be[11];
      const b44 = be[15];
      te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
      te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
      te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
      te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
      te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
      te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
      te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
      te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
      te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
      te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
      te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
      te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
      te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
      te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
      te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
      te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
      return this;
    }
    multiplyScalar(s) {
      const te = this.elements;
      for (let i = 0; i < 16; i++) te[i] *= s;
      return this;
    }
    determinant() {
      const te = this.elements;
      const n11 = te[0];
      const n12 = te[4];
      const n13 = te[8];
      const n14 = te[12];
      const n21 = te[1];
      const n22 = te[5];
      const n23 = te[9];
      const n24 = te[13];
      const n31 = te[2];
      const n32 = te[6];
      const n33 = te[10];
      const n34 = te[14];
      const n41 = te[3];
      const n42 = te[7];
      const n43 = te[11];
      const n44 = te[15];
      return (
        n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
        n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
        n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
        n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
      );
    }
    transpose() {
      const te = this.elements;
      let tmp;
      tmp = te[1];
      te[1] = te[4];
      te[4] = tmp;
      tmp = te[2];
      te[2] = te[8];
      te[8] = tmp;
      tmp = te[6];
      te[6] = te[9];
      te[9] = tmp;
      tmp = te[3];
      te[3] = te[12];
      te[12] = tmp;
      tmp = te[7];
      te[7] = te[13];
      te[13] = tmp;
      tmp = te[11];
      te[11] = te[14];
      te[14] = tmp;
      return this;
    }
    setPosition(x, y, z) {
      const te = this.elements;
      if (x && x.isVector3) {
        te[12] = x.x;
        te[13] = x.y;
        te[14] = x.z;
      } else {
        te[12] = x;
        te[13] = y;
        te[14] = z;
      }
      return this;
    }
    invert() {
      const te = this.elements;
      const n11 = te[0];
      const n21 = te[1];
      const n31 = te[2];
      const n41 = te[3];
      const n12 = te[4];
      const n22 = te[5];
      const n32 = te[6];
      const n42 = te[7];
      const n13 = te[8];
      const n23 = te[9];
      const n33 = te[10];
      const n43 = te[11];
      const n14 = te[12];
      const n24 = te[13];
      const n34 = te[14];
      const n44 = te[15];
      const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
      const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
      const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
      const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
      const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
      if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      const detInv = 1 / det;
      te[0] = t11 * detInv;
      te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
      te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
      te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;
      te[4] = t12 * detInv;
      te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
      te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
      te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;
      te[8] = t13 * detInv;
      te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
      te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
      te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;
      te[12] = t14 * detInv;
      te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
      te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
      te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;
      return this;
    }
    scale(v) {
      const te = this.elements;
      const x = v.x;
      const y = v.y;
      const z = v.z;
      te[0] *= x;
      te[4] *= y;
      te[8] *= z;
      te[1] *= x;
      te[5] *= y;
      te[9] *= z;
      te[2] *= x;
      te[6] *= y;
      te[10] *= z;
      te[3] *= x;
      te[7] *= y;
      te[11] *= z;
      return this;
    }
    getMaxScaleOnAxis() {
      const te = this.elements;
      const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
      const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
      const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];
      return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
    }
    makeTranslation(x, y, z) {
      if (x && x.isVector3) return this.set(1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1);
      return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
    }
    makeRotationX(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
    }
    makeRotationY(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
    }
    makeRotationZ(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }
    makeRotationAxis(axis, angle) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const t = 1 - c;
      const x = axis.x;
      const y = axis.y;
      const z = axis.z;
      const tx = t * x;
      const ty = t * y;
      return this.set(
        tx * x + c,
        tx * y - s * z,
        tx * z + s * y,
        0,
        tx * y + s * z,
        ty * y + c,
        ty * z - s * x,
        0,
        tx * z - s * y,
        ty * z + s * x,
        t * z * z + c,
        0,
        0,
        0,
        0,
        1
      );
    }
    makeScale(x, y, z) {
      return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
    }
    makeShear(xy, xz, yx, yz, zx, zy) {
      return this.set(1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 0, 1);
    }
    compose(position, quaternion, scale) {
      const te = this.elements;
      const x = quaternion._x;
      const y = quaternion._y;
      const z = quaternion._z;
      const w = quaternion._w;
      const x2 = x + x;
      const y2 = y + y;
      const z2 = z + z;
      const xx = x * x2;
      const xy = x * y2;
      const xz = x * z2;
      const yy = y * y2;
      const yz = y * z2;
      const zz = z * z2;
      const wx = w * x2;
      const wy = w * y2;
      const wz = w * z2;
      const sx = scale.x;
      const sy = scale.y;
      const sz = scale.z;
      te[0] = (1 - (yy + zz)) * sx;
      te[1] = (xy + wz) * sx;
      te[2] = (xz - wy) * sx;
      te[3] = 0;
      te[4] = (xy - wz) * sy;
      te[5] = (1 - (xx + zz)) * sy;
      te[6] = (yz + wx) * sy;
      te[7] = 0;
      te[8] = (xz + wy) * sz;
      te[9] = (yz - wx) * sz;
      te[10] = (1 - (xx + yy)) * sz;
      te[11] = 0;
      te[12] = position.x;
      te[13] = position.y;
      te[14] = position.z;
      te[15] = 1;
      return this;
    }
    decompose(position, quaternion, scale) {
      const te = this.elements;
      let sx = _m4v.set(te[0], te[1], te[2]).length();
      const sy = _m4v.set(te[4], te[5], te[6]).length();
      const sz = _m4v.set(te[8], te[9], te[10]).length();
      if (this.determinant() < 0) sx = -sx;
      position.x = te[12];
      position.y = te[13];
      position.z = te[14];
      _m4tmp.copy(this);
      const invSX = 1 / sx;
      const invSY = 1 / sy;
      const invSZ = 1 / sz;
      _m4tmp.elements[0] *= invSX;
      _m4tmp.elements[1] *= invSX;
      _m4tmp.elements[2] *= invSX;
      _m4tmp.elements[4] *= invSY;
      _m4tmp.elements[5] *= invSY;
      _m4tmp.elements[6] *= invSY;
      _m4tmp.elements[8] *= invSZ;
      _m4tmp.elements[9] *= invSZ;
      _m4tmp.elements[10] *= invSZ;
      quaternion.setFromRotationMatrix(_m4tmp);
      scale.x = sx;
      scale.y = sy;
      scale.z = sz;
      return this;
    }
    makePerspective(left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem) {
      const te = this.elements;
      const x = (2 * near) / (right - left);
      const y = (2 * near) / (top - bottom);
      const a = (right + left) / (right - left);
      const b = (top + bottom) / (top - bottom);
      let c;
      let d;
      if (coordinateSystem === WebGLCoordinateSystem) {
        c = -(far + near) / (far - near);
        d = (-2 * far * near) / (far - near);
      } else if (coordinateSystem === WebGPUCoordinateSystem) {
        c = -far / (far - near);
        d = (-far * near) / (far - near);
      } else {
        throw new Error('THREE.Matrix4.makePerspective(): Invalid coordinate system: ' + coordinateSystem);
      }
      te[0] = x;
      te[4] = 0;
      te[8] = a;
      te[12] = 0;
      te[1] = 0;
      te[5] = y;
      te[9] = b;
      te[13] = 0;
      te[2] = 0;
      te[6] = 0;
      te[10] = c;
      te[14] = d;
      te[3] = 0;
      te[7] = 0;
      te[11] = -1;
      te[15] = 0;
      return this;
    }
    makeOrthographic(left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem) {
      const te = this.elements;
      const w = 1.0 / (right - left);
      const h = 1.0 / (top - bottom);
      const p = 1.0 / (far - near);
      const x = (right + left) * w;
      const y = (top + bottom) * h;
      let z;
      let zInv;
      if (coordinateSystem === WebGLCoordinateSystem) {
        z = (far + near) * p;
        zInv = -2 * p;
      } else if (coordinateSystem === WebGPUCoordinateSystem) {
        z = near * p;
        zInv = -1 * p;
      } else {
        throw new Error('THREE.Matrix4.makeOrthographic(): Invalid coordinate system: ' + coordinateSystem);
      }
      te[0] = 2 * w;
      te[4] = 0;
      te[8] = 0;
      te[12] = -x;
      te[1] = 0;
      te[5] = 2 * h;
      te[9] = 0;
      te[13] = -y;
      te[2] = 0;
      te[6] = 0;
      te[10] = zInv;
      te[14] = -z;
      te[3] = 0;
      te[7] = 0;
      te[11] = 0;
      te[15] = 1;
      return this;
    }
    equals(matrix) {
      const te = this.elements;
      const me = matrix.elements;
      for (let i = 0; i < 16; i++) if (te[i] !== me[i]) return false;
      return true;
    }
    fromArray(array, offset = 0) {
      for (let i = 0; i < 16; i++) this.elements[i] = array[i + offset];
      return this;
    }
    toArray(array = [], offset = 0) {
      const te = this.elements;
      for (let i = 0; i < 16; i++) array[offset + i] = te[i];
      return array;
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
    copy(other) {
      this.radius = other.radius;
      this.phi = other.phi;
      this.theta = other.theta;
      return this;
    }
    makeSafe() {
      const EPS = 0.000001;
      this.phi = Math.max(EPS, Math.min(Math.PI - EPS, this.phi));
      return this;
    }
    setFromVector3(v) {
      return this.setFromCartesianCoords(v.x, v.y, v.z);
    }
    setFromCartesianCoords(x, y, z) {
      this.radius = Math.sqrt(x * x + y * y + z * z);
      if (this.radius === 0) {
        this.theta = 0;
        this.phi = 0;
      } else {
        this.theta = Math.atan2(x, z);
        this.phi = Math.acos(clamp(y / this.radius, -1, 1));
      }
      return this;
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  class Cylindrical {
    constructor(radius = 1, theta = 0, y = 0) {
      this.radius = radius;
      this.theta = theta;
      this.y = y;
    }
    set(radius, theta, y) {
      this.radius = radius;
      this.theta = theta;
      this.y = y;
      return this;
    }
    copy(other) {
      this.radius = other.radius;
      this.theta = other.theta;
      this.y = other.y;
      return this;
    }
    setFromVector3(v) {
      return this.setFromCartesianCoords(v.x, v.y, v.z);
    }
    setFromCartesianCoords(x, y, z) {
      this.radius = Math.sqrt(x * x + z * z);
      this.theta = Math.atan2(x, z);
      this.y = y;
      return this;
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  const _colorKeywords = {
    aliceblue: 0xf0f8ff,
    antiquewhite: 0xfaebd7,
    aqua: 0x00ffff,
    aquamarine: 0x7fffd4,
    azure: 0xf0ffff,
    beige: 0xf5f5dc,
    bisque: 0xffe4c4,
    black: 0x000000,
    blanchedalmond: 0xffebcd,
    blue: 0x0000ff,
    blueviolet: 0x8a2be2,
    brown: 0xa52a2a,
    burlywood: 0xdeb887,
    cadetblue: 0x5f9ea0,
    chartreuse: 0x7fff00,
    chocolate: 0xd2691e,
    coral: 0xff7f50,
    cornflowerblue: 0x6495ed,
    cornsilk: 0xfff8dc,
    crimson: 0xdc143c,
    cyan: 0x00ffff,
    darkblue: 0x00008b,
    darkcyan: 0x008b8b,
    darkgoldenrod: 0xb8860b,
    darkgray: 0xa9a9a9,
    darkgreen: 0x006400,
    darkgrey: 0xa9a9a9,
    darkkhaki: 0xbdb76b,
    darkmagenta: 0x8b008b,
    darkolivegreen: 0x556b2f,
    darkorange: 0xff8c00,
    darkorchid: 0x9932cc,
    darkred: 0x8b0000,
    darksalmon: 0xe9967a,
    darkseagreen: 0x8fbc8f,
    darkslateblue: 0x483d8b,
    darkslategray: 0x2f4f4f,
    darkslategrey: 0x2f4f4f,
    darkturquoise: 0x00ced1,
    darkviolet: 0x9400d3,
    deeppink: 0xff1493,
    deepskyblue: 0x00bfff,
    dimgray: 0x696969,
    dimgrey: 0x696969,
    dodgerblue: 0x1e90ff,
    firebrick: 0xb22222,
    floralwhite: 0xfffaf0,
    forestgreen: 0x228b22,
    fuchsia: 0xff00ff,
    gainsboro: 0xdcdcdc,
    ghostwhite: 0xf8f8ff,
    gold: 0xffd700,
    goldenrod: 0xdaa520,
    gray: 0x808080,
    green: 0x008000,
    greenyellow: 0xadff2f,
    grey: 0x808080,
    honeydew: 0xf0fff0,
    hotpink: 0xff69b4,
    indianred: 0xcd5c5c,
    indigo: 0x4b0082,
    ivory: 0xfffff0,
    khaki: 0xf0e68c,
    lavender: 0xe6e6fa,
    lavenderblush: 0xfff0f5,
    lawngreen: 0x7cfc00,
    lemonchiffon: 0xfffacd,
    lightblue: 0xadd8e6,
    lightcoral: 0xf08080,
    lightcyan: 0xe0ffff,
    lightgoldenrodyellow: 0xfafad2,
    lightgray: 0xd3d3d3,
    lightgreen: 0x90ee90,
    lightgrey: 0xd3d3d3,
    lightpink: 0xffb6c1,
    lightsalmon: 0xffa07a,
    lightseagreen: 0x20b2aa,
    lightskyblue: 0x87cefa,
    lightslategray: 0x778899,
    lightslategrey: 0x778899,
    lightsteelblue: 0xb0c4de,
    lightyellow: 0xffffe0,
    lime: 0x00ff00,
    limegreen: 0x32cd32,
    linen: 0xfaf0e6,
    magenta: 0xff00ff,
    maroon: 0x800000,
    mediumaquamarine: 0x66cdaa,
    mediumblue: 0x0000cd,
    mediumorchid: 0xba55d3,
    mediumpurple: 0x9370db,
    mediumseagreen: 0x3cb371,
    mediumslateblue: 0x7b68ee,
    mediumspringgreen: 0x00fa9a,
    mediumturquoise: 0x48d1cc,
    mediumvioletred: 0xc71585,
    midnightblue: 0x191970,
    mintcream: 0xf5fffa,
    mistyrose: 0xffe4e1,
    moccasin: 0xffe4b5,
    navajowhite: 0xffdead,
    navy: 0x000080,
    oldlace: 0xfdf5e6,
    olive: 0x808000,
    olivedrab: 0x6b8e23,
    orange: 0xffa500,
    orangered: 0xff4500,
    orchid: 0xda70d6,
    palegoldenrod: 0xeee8aa,
    palegreen: 0x98fb98,
    paleturquoise: 0xafeeee,
    palevioletred: 0xdb7093,
    papayawhip: 0xffefd5,
    peachpuff: 0xffdab9,
    peru: 0xcd853f,
    pink: 0xffc0cb,
    plum: 0xdda0dd,
    powderblue: 0xb0e0e6,
    purple: 0x800080,
    rebeccapurple: 0x663399,
    red: 0xff0000,
    rosybrown: 0xbc8f8f,
    royalblue: 0x4169e1,
    saddlebrown: 0x8b4513,
    salmon: 0xfa8072,
    sandybrown: 0xf4a460,
    seagreen: 0x2e8b57,
    seashell: 0xfff5ee,
    sienna: 0xa0522d,
    silver: 0xc0c0c0,
    skyblue: 0x87ceeb,
    slateblue: 0x6a5acd,
    slategray: 0x708090,
    slategrey: 0x708090,
    snow: 0xfffafa,
    springgreen: 0x00ff7f,
    steelblue: 0x4682b4,
    tan: 0xd2b48c,
    teal: 0x008080,
    thistle: 0xd8bfd8,
    tomato: 0xff6347,
    turquoise: 0x40e0d0,
    violet: 0xee82ee,
    wheat: 0xf5deb3,
    white: 0xffffff,
    whitesmoke: 0xf5f5f5,
    yellow: 0xffff00,
    yellowgreen: 0x9acd32,
  };

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  }

  class Color {
    constructor(r, g, b) {
      this.isColor = true;
      this.r = 1;
      this.g = 1;
      this.b = 1;
      if (g === undefined && b === undefined) this.set(r);
      else this.setRGB(r, g, b);
    }
    set(r, g, b) {
      if (g === undefined && b === undefined) {
        const value = r;
        if (value && value.isColor) this.copy(value);
        else if (typeof value === 'number') this.setHex(value);
        else if (typeof value === 'string') this.setStyle(value);
      } else {
        this.setRGB(r, g, b);
      }
      return this;
    }
    setScalar(scalar) {
      this.r = scalar;
      this.g = scalar;
      this.b = scalar;
      return this;
    }
    setHex(hex) {
      hex = Math.floor(hex);
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
    setHSL(h, s, l) {
      h = euclideanModulo(h, 1);
      s = clamp(s, 0, 1);
      l = clamp(l, 0, 1);
      if (s === 0) {
        this.r = this.g = this.b = l;
      } else {
        const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
        const q = 2 * l - p;
        this.r = hue2rgb(q, p, h + 1 / 3);
        this.g = hue2rgb(q, p, h);
        this.b = hue2rgb(q, p, h - 1 / 3);
      }
      return this;
    }
    setStyle(style) {
      let m;
      if ((m = /^((?:rgb|hsl)a?)\(([^\)]*)\)/.exec(style))) {
        let color;
        const name = m[1];
        const components = m[2];
        switch (name) {
          case 'rgb':
          case 'rgba':
            if ((color = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(components))) {
              return this.setRGB(
                Math.min(255, parseInt(color[1], 10)) / 255,
                Math.min(255, parseInt(color[2], 10)) / 255,
                Math.min(255, parseInt(color[3], 10)) / 255
              );
            }
            if ((color = /^\s*(\d+)%\s*,\s*(\d+)%\s*,\s*(\d+)%/.exec(components))) {
              return this.setRGB(
                Math.min(100, parseInt(color[1], 10)) / 100,
                Math.min(100, parseInt(color[2], 10)) / 100,
                Math.min(100, parseInt(color[3], 10)) / 100
              );
            }
            break;
          case 'hsl':
          case 'hsla':
            if ((color = /^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)%\s*,\s*(\d*\.?\d+)%/.exec(components))) {
              return this.setHSL(parseFloat(color[1]) / 360, parseFloat(color[2]) / 100, parseFloat(color[3]) / 100);
            }
            break;
        }
      } else if ((m = /^#([A-Fa-f\d]+)$/.exec(style))) {
        const hex = m[1];
        const size = hex.length;
        if (size === 3) {
          return this.setRGB(
            parseInt(hex.charAt(0), 16) / 15,
            parseInt(hex.charAt(1), 16) / 15,
            parseInt(hex.charAt(2), 16) / 15
          );
        }
        if (size === 6) return this.setHex(parseInt(hex, 16));
      } else if (style && style.length > 0) {
        return this.setColorName(style);
      }
      return this;
    }
    setColorName(style) {
      const hex = _colorKeywords[style.toLowerCase()];
      if (hex !== undefined) this.setHex(hex);
      else console.warn('THREE.Color: Unknown color ' + style);
      return this;
    }
    clone() {
      return new this.constructor(this.r, this.g, this.b);
    }
    copy(color) {
      this.r = color.r;
      this.g = color.g;
      this.b = color.b;
      return this;
    }
    copySRGBToLinear(color) {
      this.r = SRGBToLinear(color.r);
      this.g = SRGBToLinear(color.g);
      this.b = SRGBToLinear(color.b);
      return this;
    }
    copyLinearToSRGB(color) {
      this.r = LinearToSRGB(color.r);
      this.g = LinearToSRGB(color.g);
      this.b = LinearToSRGB(color.b);
      return this;
    }
    convertSRGBToLinear() {
      return this.copySRGBToLinear(this);
    }
    convertLinearToSRGB() {
      return this.copyLinearToSRGB(this);
    }
    getHex() {
      return (
        (Math.round(clamp(this.r * 255, 0, 255)) << 16) ^
        (Math.round(clamp(this.g * 255, 0, 255)) << 8) ^
        Math.round(clamp(this.b * 255, 0, 255))
      );
    }
    getHexString() {
      return ('000000' + this.getHex().toString(16)).slice(-6);
    }
    getHSL(target) {
      const r = this.r;
      const g = this.g;
      const b = this.b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let hue;
      let saturation;
      const lightness = (min + max) / 2;
      if (min === max) {
        hue = 0;
        saturation = 0;
      } else {
        const delta = max - min;
        saturation = lightness <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
        switch (max) {
          case r:
            hue = (g - b) / delta + (g < b ? 6 : 0);
            break;
          case g:
            hue = (b - r) / delta + 2;
            break;
          default:
            hue = (r - g) / delta + 4;
            break;
        }
        hue /= 6;
      }
      target.h = hue;
      target.s = saturation;
      target.l = lightness;
      return target;
    }
    getRGB(target) {
      target.r = this.r;
      target.g = this.g;
      target.b = this.b;
      return target;
    }
    getStyle() {
      return 'rgb(' + Math.round(this.r * 255) + ',' + Math.round(this.g * 255) + ',' + Math.round(this.b * 255) + ')';
    }
    offsetHSL(h, s, l) {
      this.getHSL(_hslA);
      return this.setHSL(_hslA.h + h, _hslA.s + s, _hslA.l + l);
    }
    add(color) {
      this.r += color.r;
      this.g += color.g;
      this.b += color.b;
      return this;
    }
    addColors(color1, color2) {
      this.r = color1.r + color2.r;
      this.g = color1.g + color2.g;
      this.b = color1.b + color2.b;
      return this;
    }
    addScalar(s) {
      this.r += s;
      this.g += s;
      this.b += s;
      return this;
    }
    sub(color) {
      this.r = Math.max(0, this.r - color.r);
      this.g = Math.max(0, this.g - color.g);
      this.b = Math.max(0, this.b - color.b);
      return this;
    }
    multiply(color) {
      this.r *= color.r;
      this.g *= color.g;
      this.b *= color.b;
      return this;
    }
    multiplyScalar(s) {
      this.r *= s;
      this.g *= s;
      this.b *= s;
      return this;
    }
    lerp(color, alpha) {
      this.r += (color.r - this.r) * alpha;
      this.g += (color.g - this.g) * alpha;
      this.b += (color.b - this.b) * alpha;
      return this;
    }
    lerpColors(color1, color2, alpha) {
      this.r = color1.r + (color2.r - color1.r) * alpha;
      this.g = color1.g + (color2.g - color1.g) * alpha;
      this.b = color1.b + (color2.b - color1.b) * alpha;
      return this;
    }
    lerpHSL(color, alpha) {
      this.getHSL(_hslA);
      color.getHSL(_hslB);
      return this.setHSL(lerp(_hslA.h, _hslB.h, alpha), lerp(_hslA.s, _hslB.s, alpha), lerp(_hslA.l, _hslB.l, alpha));
    }
    setFromVector3(v) {
      this.r = v.x;
      this.g = v.y;
      this.b = v.z;
      return this;
    }
    applyMatrix3(m) {
      const r = this.r;
      const g = this.g;
      const b = this.b;
      const e = m.elements;
      this.r = e[0] * r + e[3] * g + e[6] * b;
      this.g = e[1] * r + e[4] * g + e[7] * b;
      this.b = e[2] * r + e[5] * g + e[8] * b;
      return this;
    }
    equals(c) {
      return c.r === this.r && c.g === this.g && c.b === this.b;
    }
    fromArray(array, offset = 0) {
      this.r = array[offset];
      this.g = array[offset + 1];
      this.b = array[offset + 2];
      return this;
    }
    toArray(array = [], offset = 0) {
      array[offset] = this.r;
      array[offset + 1] = this.g;
      array[offset + 2] = this.b;
      return array;
    }
    fromBufferAttribute(attribute, index) {
      this.r = attribute.getX(index);
      this.g = attribute.getY(index);
      this.b = attribute.getZ(index);
      return this;
    }
    toJSON() {
      return this.getHex();
    }
    *[Symbol.iterator]() {
      yield this.r;
      yield this.g;
      yield this.b;
    }
  }
  Color.NAMES = _colorKeywords;

  class Line3 {
    constructor(start = new Vector3(), end = new Vector3()) {
      this.start = start;
      this.end = end;
    }
    set(start, end) {
      this.start.copy(start);
      this.end.copy(end);
      return this;
    }
    copy(line) {
      this.start.copy(line.start);
      this.end.copy(line.end);
      return this;
    }
    getCenter(target) {
      return target.addVectors(this.start, this.end).multiplyScalar(0.5);
    }
    delta(target) {
      return target.subVectors(this.end, this.start);
    }
    distanceSq() {
      return this.start.distanceToSquared(this.end);
    }
    distance() {
      return this.start.distanceTo(this.end);
    }
    at(t, target) {
      return this.delta(target).multiplyScalar(t).add(this.start);
    }
    closestPointToPointParameter(point, clampToLine) {
      _lineStartP.subVectors(point, this.start);
      _lineStartEnd.subVectors(this.end, this.start);
      const startEnd2 = _lineStartEnd.dot(_lineStartEnd);
      const startEnd_startP = _lineStartEnd.dot(_lineStartP);
      let t = startEnd_startP / startEnd2;
      if (clampToLine) t = clamp(t, 0, 1);
      return t;
    }
    closestPointToPoint(point, clampToLine, target) {
      const t = this.closestPointToPointParameter(point, clampToLine);
      return this.delta(target).multiplyScalar(t).add(this.start);
    }
    applyMatrix4(matrix) {
      this.start.applyMatrix4(matrix);
      this.end.applyMatrix4(matrix);
      return this;
    }
    equals(line) {
      return line.start.equals(this.start) && line.end.equals(this.end);
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  class Plane {
    constructor(normal = new Vector3(1, 0, 0), constant = 0) {
      this.isPlane = true;
      this.normal = normal;
      this.constant = constant;
    }
    set(normal, constant) {
      this.normal.copy(normal);
      this.constant = constant;
      return this;
    }
    setComponents(x, y, z, w) {
      this.normal.set(x, y, z);
      this.constant = w;
      return this;
    }
    setFromNormalAndCoplanarPoint(normal, point) {
      this.normal.copy(normal);
      this.constant = -point.dot(this.normal);
      return this;
    }
    setFromCoplanarPoints(a, b, c) {
      const normal = _planeV1.subVectors(c, b).cross(_planeV2.subVectors(a, b)).normalize();
      return this.setFromNormalAndCoplanarPoint(normal, a);
    }
    copy(plane) {
      this.normal.copy(plane.normal);
      this.constant = plane.constant;
      return this;
    }
    normalize() {
      const inverseNormalLength = 1.0 / this.normal.length();
      this.normal.multiplyScalar(inverseNormalLength);
      this.constant *= inverseNormalLength;
      return this;
    }
    negate() {
      this.constant *= -1;
      this.normal.negate();
      return this;
    }
    distanceToPoint(point) {
      return this.normal.dot(point) + this.constant;
    }
    distanceToSphere(sphere) {
      return this.distanceToPoint(sphere.center) - sphere.radius;
    }
    projectPoint(point, target) {
      return target.copy(point).addScaledVector(this.normal, -this.distanceToPoint(point));
    }
    intersectLine(line, target) {
      const direction = line.delta(_planeV1);
      const denominator = this.normal.dot(direction);
      if (denominator === 0) {
        if (this.distanceToPoint(line.start) === 0) return target.copy(line.start);
        return null;
      }
      const t = -(line.start.dot(this.normal) + this.constant) / denominator;
      if (t < 0 || t > 1) return null;
      return target.copy(line.start).addScaledVector(direction, t);
    }
    intersectsLine(line) {
      const startSign = this.distanceToPoint(line.start);
      const endSign = this.distanceToPoint(line.end);
      return (startSign < 0 && endSign > 0) || (endSign < 0 && startSign > 0);
    }
    intersectsBox(box) {
      return box.intersectsPlane(this);
    }
    intersectsSphere(sphere) {
      return sphere.intersectsPlane(this);
    }
    coplanarPoint(target) {
      return target.copy(this.normal).multiplyScalar(-this.constant);
    }
    applyMatrix4(matrix, optionalNormalMatrix) {
      const normalMatrix = optionalNormalMatrix || _planeNM.getNormalMatrix(matrix);
      const referencePoint = this.coplanarPoint(_planeV1).applyMatrix4(matrix);
      const normal = this.normal.applyMatrix3(normalMatrix).normalize();
      this.constant = -referencePoint.dot(normal);
      return this;
    }
    translate(offset) {
      this.constant -= offset.dot(this.normal);
      return this;
    }
    equals(plane) {
      return plane.normal.equals(this.normal) && plane.constant === this.constant;
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  class Box2 {
    constructor(min = new Vector2(+Infinity, +Infinity), max = new Vector2(-Infinity, -Infinity)) {
      this.isBox2 = true;
      this.min = min;
      this.max = max;
    }
    set(min, max) {
      this.min.copy(min);
      this.max.copy(max);
      return this;
    }
    setFromPoints(points) {
      this.makeEmpty();
      for (let i = 0, il = points.length; i < il; i++) this.expandByPoint(points[i]);
      return this;
    }
    setFromCenterAndSize(center, size) {
      const halfSize = _box2v.copy(size).multiplyScalar(0.5);
      this.min.copy(center).sub(halfSize);
      this.max.copy(center).add(halfSize);
      return this;
    }
    clone() {
      return new this.constructor().copy(this);
    }
    copy(box) {
      this.min.copy(box.min);
      this.max.copy(box.max);
      return this;
    }
    makeEmpty() {
      this.min.x = this.min.y = +Infinity;
      this.max.x = this.max.y = -Infinity;
      return this;
    }
    isEmpty() {
      return this.max.x < this.min.x || this.max.y < this.min.y;
    }
    getCenter(target) {
      return this.isEmpty() ? target.set(0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
    }
    getSize(target) {
      return this.isEmpty() ? target.set(0, 0) : target.subVectors(this.max, this.min);
    }
    expandByPoint(point) {
      this.min.min(point);
      this.max.max(point);
      return this;
    }
    expandByVector(vector) {
      this.min.sub(vector);
      this.max.add(vector);
      return this;
    }
    expandByScalar(scalar) {
      this.min.addScalar(-scalar);
      this.max.addScalar(scalar);
      return this;
    }
    containsPoint(point) {
      return point.x >= this.min.x && point.x <= this.max.x && point.y >= this.min.y && point.y <= this.max.y;
    }
    containsBox(box) {
      return this.min.x <= box.min.x && box.max.x <= this.max.x && this.min.y <= box.min.y && box.max.y <= this.max.y;
    }
    getParameter(point, target) {
      return target.set(
        (point.x - this.min.x) / (this.max.x - this.min.x),
        (point.y - this.min.y) / (this.max.y - this.min.y)
      );
    }
    intersectsBox(box) {
      return box.max.x >= this.min.x && box.min.x <= this.max.x && box.max.y >= this.min.y && box.min.y <= this.max.y;
    }
    clampPoint(point, target) {
      return target.copy(point).clamp(this.min, this.max);
    }
    distanceToPoint(point) {
      return this.clampPoint(point, _box2v).distanceTo(point);
    }
    intersect(box) {
      this.min.max(box.min);
      this.max.min(box.max);
      if (this.isEmpty()) this.makeEmpty();
      return this;
    }
    union(box) {
      this.min.min(box.min);
      this.max.max(box.max);
      return this;
    }
    translate(offset) {
      this.min.add(offset);
      this.max.add(offset);
      return this;
    }
    equals(box) {
      return box.min.equals(this.min) && box.max.equals(this.max);
    }
  }

  class Box3 {
    constructor(min = new Vector3(+Infinity, +Infinity, +Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
      this.isBox3 = true;
      this.min = min;
      this.max = max;
    }
    set(min, max) {
      this.min.copy(min);
      this.max.copy(max);
      return this;
    }
    setFromArray(array) {
      this.makeEmpty();
      for (let i = 0, il = array.length; i < il; i += 3) {
        this.expandByPoint(_box3v.fromArray(array, i));
      }
      return this;
    }
    setFromBufferAttribute(attribute) {
      this.makeEmpty();
      for (let i = 0, il = attribute.count; i < il; i++) {
        this.expandByPoint(_box3v.fromBufferAttribute(attribute, i));
      }
      return this;
    }
    setFromPoints(points) {
      this.makeEmpty();
      for (let i = 0, il = points.length; i < il; i++) this.expandByPoint(points[i]);
      return this;
    }
    setFromCenterAndSize(center, size) {
      const halfSize = _box3v.copy(size).multiplyScalar(0.5);
      this.min.copy(center).sub(halfSize);
      this.max.copy(center).add(halfSize);
      return this;
    }
    setFromObject(object, precise = false) {
      this.makeEmpty();
      return this.expandByObject(object, precise);
    }
    clone() {
      return new this.constructor().copy(this);
    }
    copy(box) {
      this.min.copy(box.min);
      this.max.copy(box.max);
      return this;
    }
    makeEmpty() {
      this.min.x = this.min.y = this.min.z = +Infinity;
      this.max.x = this.max.y = this.max.z = -Infinity;
      return this;
    }
    isEmpty() {
      return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
    }
    getCenter(target) {
      return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
    }
    getSize(target) {
      return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min);
    }
    expandByPoint(point) {
      this.min.min(point);
      this.max.max(point);
      return this;
    }
    expandByVector(vector) {
      this.min.sub(vector);
      this.max.add(vector);
      return this;
    }
    expandByScalar(scalar) {
      this.min.addScalar(-scalar);
      this.max.addScalar(scalar);
      return this;
    }
    expandByObject(object, precise = false) {
      if (object.updateWorldMatrix) object.updateWorldMatrix(false, false);
      const geometry = object.geometry;
      if (geometry !== undefined) {
        const positionAttribute = geometry.getAttribute ? geometry.getAttribute('position') : geometry.attributes?.position;
        if (precise === true && positionAttribute !== undefined && object.isInstancedMesh !== true) {
          for (let i = 0, l = positionAttribute.count; i < l; i++) {
            if (object.isMesh === true && object.getVertexPosition) object.getVertexPosition(i, _box3v);
            else _box3v.fromBufferAttribute(positionAttribute, i);
            if (object.matrixWorld) _box3v.applyMatrix4(object.matrixWorld);
            this.expandByPoint(_box3v);
          }
        } else {
          if (object.boundingBox !== undefined) {
            if (object.boundingBox === null && object.computeBoundingBox) object.computeBoundingBox();
            if (object.boundingBox) _box3tmp.copy(object.boundingBox);
            else _box3tmp.makeEmpty();
          } else {
            if (geometry.boundingBox == null && geometry.computeBoundingBox) geometry.computeBoundingBox();
            if (geometry.boundingBox) _box3tmp.copy(geometry.boundingBox);
            else _box3tmp.makeEmpty();
          }
          if (object.matrixWorld) _box3tmp.applyMatrix4(object.matrixWorld);
          this.union(_box3tmp);
        }
      }
      const children = object.children;
      if (children) {
        for (let i = 0, l = children.length; i < l; i++) this.expandByObject(children[i], precise);
      }
      return this;
    }
    containsPoint(point) {
      return (
        point.x >= this.min.x &&
        point.x <= this.max.x &&
        point.y >= this.min.y &&
        point.y <= this.max.y &&
        point.z >= this.min.z &&
        point.z <= this.max.z
      );
    }
    containsBox(box) {
      return (
        this.min.x <= box.min.x &&
        box.max.x <= this.max.x &&
        this.min.y <= box.min.y &&
        box.max.y <= this.max.y &&
        this.min.z <= box.min.z &&
        box.max.z <= this.max.z
      );
    }
    getParameter(point, target) {
      return target.set(
        (point.x - this.min.x) / (this.max.x - this.min.x),
        (point.y - this.min.y) / (this.max.y - this.min.y),
        (point.z - this.min.z) / (this.max.z - this.min.z)
      );
    }
    intersectsBox(box) {
      return (
        box.max.x >= this.min.x &&
        box.min.x <= this.max.x &&
        box.max.y >= this.min.y &&
        box.min.y <= this.max.y &&
        box.max.z >= this.min.z &&
        box.min.z <= this.max.z
      );
    }
    intersectsSphere(sphere) {
      this.clampPoint(sphere.center, _box3v);
      return _box3v.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
    }
    intersectsPlane(plane) {
      let min;
      let max;
      if (plane.normal.x > 0) {
        min = plane.normal.x * this.min.x;
        max = plane.normal.x * this.max.x;
      } else {
        min = plane.normal.x * this.max.x;
        max = plane.normal.x * this.min.x;
      }
      if (plane.normal.y > 0) {
        min += plane.normal.y * this.min.y;
        max += plane.normal.y * this.max.y;
      } else {
        min += plane.normal.y * this.max.y;
        max += plane.normal.y * this.min.y;
      }
      if (plane.normal.z > 0) {
        min += plane.normal.z * this.min.z;
        max += plane.normal.z * this.max.z;
      } else {
        min += plane.normal.z * this.max.z;
        max += plane.normal.z * this.min.z;
      }
      return min <= -plane.constant && max >= -plane.constant;
    }
    intersectsTriangle(triangle) {
      if (this.isEmpty()) return false;
      this.getCenter(_box3center);
      _box3extents.subVectors(this.max, _box3center);
      _box3v0.subVectors(triangle.a, _box3center);
      _box3v1.subVectors(triangle.b, _box3center);
      _box3v2.subVectors(triangle.c, _box3center);
      _box3f0.subVectors(_box3v1, _box3v0);
      _box3f1.subVectors(_box3v2, _box3v1);
      _box3f2.subVectors(_box3v0, _box3v2);
      let axes = [
        0, -_box3f0.z, _box3f0.y, 0, -_box3f1.z, _box3f1.y, 0, -_box3f2.z, _box3f2.y,
        _box3f0.z, 0, -_box3f0.x, _box3f1.z, 0, -_box3f1.x, _box3f2.z, 0, -_box3f2.x,
        -_box3f0.y, _box3f0.x, 0, -_box3f1.y, _box3f1.x, 0, -_box3f2.y, _box3f2.x, 0,
      ];
      if (!_satForAxes(axes, _box3v0, _box3v1, _box3v2, _box3extents)) return false;
      axes = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      if (!_satForAxes(axes, _box3v0, _box3v1, _box3v2, _box3extents)) return false;
      _box3triN.crossVectors(_box3f0, _box3f1);
      axes = [_box3triN.x, _box3triN.y, _box3triN.z];
      return _satForAxes(axes, _box3v0, _box3v1, _box3v2, _box3extents);
    }
    clampPoint(point, target) {
      return target.copy(point).clamp(this.min, this.max);
    }
    distanceToPoint(point) {
      return this.clampPoint(point, _box3v).distanceTo(point);
    }
    getBoundingSphere(target) {
      if (this.isEmpty()) target.makeEmpty();
      else {
        this.getCenter(target.center);
        target.radius = this.getSize(_box3v).length() * 0.5;
      }
      return target;
    }
    intersect(box) {
      this.min.max(box.min);
      this.max.min(box.max);
      if (this.isEmpty()) this.makeEmpty();
      return this;
    }
    union(box) {
      this.min.min(box.min);
      this.max.max(box.max);
      return this;
    }
    applyMatrix4(matrix) {
      if (this.isEmpty()) return this;
      _box3points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix);
      _box3points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix);
      _box3points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix);
      _box3points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix);
      _box3points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix);
      _box3points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix);
      _box3points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix);
      _box3points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix);
      this.setFromPoints(_box3points);
      return this;
    }
    translate(offset) {
      this.min.add(offset);
      this.max.add(offset);
      return this;
    }
    equals(box) {
      return box.min.equals(this.min) && box.max.equals(this.max);
    }
  }

  function _satForAxes(axes, v0, v1, v2, extents) {
    for (let i = 0, j = axes.length - 3; i <= j; i += 3) {
      _box3testAxis.fromArray(axes, i);
      const r =
        extents.x * Math.abs(_box3testAxis.x) +
        extents.y * Math.abs(_box3testAxis.y) +
        extents.z * Math.abs(_box3testAxis.z);
      const p0 = v0.dot(_box3testAxis);
      const p1 = v1.dot(_box3testAxis);
      const p2 = v2.dot(_box3testAxis);
      if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) return false;
    }
    return true;
  }

  class Sphere {
    constructor(center = new Vector3(), radius = -1) {
      this.isSphere = true;
      this.center = center;
      this.radius = radius;
    }
    set(center, radius) {
      this.center.copy(center);
      this.radius = radius;
      return this;
    }
    setFromPoints(points, optionalCenter) {
      const center = this.center;
      if (optionalCenter !== undefined) center.copy(optionalCenter);
      else _sphereBox.setFromPoints(points).getCenter(center);
      let maxRadiusSq = 0;
      for (let i = 0, il = points.length; i < il; i++) {
        maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(points[i]));
      }
      this.radius = Math.sqrt(maxRadiusSq);
      return this;
    }
    copy(sphere) {
      this.center.copy(sphere.center);
      this.radius = sphere.radius;
      return this;
    }
    isEmpty() {
      return this.radius < 0;
    }
    makeEmpty() {
      this.center.set(0, 0, 0);
      this.radius = -1;
      return this;
    }
    containsPoint(point) {
      return point.distanceToSquared(this.center) <= this.radius * this.radius;
    }
    distanceToPoint(point) {
      return point.distanceTo(this.center) - this.radius;
    }
    intersectsSphere(sphere) {
      const radiusSum = this.radius + sphere.radius;
      return sphere.center.distanceToSquared(this.center) <= radiusSum * radiusSum;
    }
    intersectsBox(box) {
      return box.intersectsSphere(this);
    }
    intersectsPlane(plane) {
      return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
    }
    clampPoint(point, target) {
      const deltaLengthSq = this.center.distanceToSquared(point);
      target.copy(point);
      if (deltaLengthSq > this.radius * this.radius) {
        target.sub(this.center).normalize();
        target.multiplyScalar(this.radius).add(this.center);
      }
      return target;
    }
    getBoundingBox(target) {
      if (this.isEmpty()) {
        target.makeEmpty();
        return target;
      }
      target.set(this.center, this.center);
      target.expandByScalar(this.radius);
      return target;
    }
    applyMatrix4(matrix) {
      this.center.applyMatrix4(matrix);
      this.radius = this.radius * matrix.getMaxScaleOnAxis();
      return this;
    }
    translate(offset) {
      this.center.add(offset);
      return this;
    }
    expandByPoint(point) {
      if (this.isEmpty()) {
        this.center.copy(point);
        this.radius = 0;
        return this;
      }
      _sphereV1.subVectors(point, this.center);
      const lengthSq = _sphereV1.lengthSq();
      if (lengthSq > this.radius * this.radius) {
        const length = Math.sqrt(lengthSq);
        const delta = (length - this.radius) * 0.5;
        this.center.addScaledVector(_sphereV1, delta / length);
        this.radius += delta;
      }
      return this;
    }
    union(sphere) {
      if (sphere.isEmpty()) return this;
      if (this.isEmpty()) {
        this.copy(sphere);
        return this;
      }
      if (this.center.equals(sphere.center) === true) {
        this.radius = Math.max(this.radius, sphere.radius);
      } else {
        _sphereV2.subVectors(sphere.center, this.center).setLength(sphere.radius);
        this.expandByPoint(_sphereV1.copy(sphere.center).add(_sphereV2));
        this.expandByPoint(_sphereV1.copy(sphere.center).sub(_sphereV2));
      }
      return this;
    }
    equals(sphere) {
      return sphere.center.equals(this.center) && sphere.radius === this.radius;
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  class Triangle {
    constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) {
      this.a = a;
      this.b = b;
      this.c = c;
    }
    static getNormal(a, b, c, target) {
      target.subVectors(c, b);
      _triV0.subVectors(a, b);
      target.cross(_triV0);
      const targetLengthSq = target.lengthSq();
      if (targetLengthSq > 0) return target.multiplyScalar(1 / Math.sqrt(targetLengthSq));
      return target.set(0, 0, 0);
    }
    static getBarycoord(point, a, b, c, target) {
      _triV0.subVectors(c, a);
      _triV1.subVectors(b, a);
      _triV2.subVectors(point, a);
      const dot00 = _triV0.dot(_triV0);
      const dot01 = _triV0.dot(_triV1);
      const dot02 = _triV0.dot(_triV2);
      const dot11 = _triV1.dot(_triV1);
      const dot12 = _triV1.dot(_triV2);
      const denom = dot00 * dot11 - dot01 * dot01;
      if (denom === 0) {
        target.set(0, 0, 0);
        return null;
      }
      const invDenom = 1 / denom;
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      return target.set(1 - u - v, v, u);
    }
    static containsPoint(point, a, b, c) {
      if (this.getBarycoord(point, a, b, c, _triV3) === null) return false;
      return _triV3.x >= 0 && _triV3.y >= 0 && _triV3.x + _triV3.y <= 1;
    }
    static getInterpolation(point, p1, p2, p3, v1, v2, v3, target) {
      if (this.getBarycoord(point, p1, p2, p3, _triV3) === null) {
        target.x = 0;
        target.y = 0;
        if ('z' in target) target.z = 0;
        if ('w' in target) target.w = 0;
        return null;
      }
      target.setScalar(0);
      target.addScaledVector(v1, _triV3.x);
      target.addScaledVector(v2, _triV3.y);
      target.addScaledVector(v3, _triV3.z);
      return target;
    }
    static getInterpolatedAttribute(attr, i1, i2, i3, barycoord, target) {
      const size = attr.itemSize || (target && target.isVector2 ? 2 : 3);
      const ax = attr.getX(i1);
      const ay = attr.getY(i1);
      const az = size > 2 && attr.getZ ? attr.getZ(i1) : 0;
      const bx = attr.getX(i2);
      const by = attr.getY(i2);
      const bz = size > 2 && attr.getZ ? attr.getZ(i2) : 0;
      const cx = attr.getX(i3);
      const cy = attr.getY(i3);
      const cz = size > 2 && attr.getZ ? attr.getZ(i3) : 0;
      const x = ax * barycoord.x + bx * barycoord.y + cx * barycoord.z;
      const y = ay * barycoord.x + by * barycoord.y + cy * barycoord.z;
      const z = az * barycoord.x + bz * barycoord.y + cz * barycoord.z;
      if (target && typeof target.set === 'function') {
        if (target.isVector2) return target.set(x, y);
        return target.set(x, y, z);
      }
      target.x = x;
      target.y = y;
      if ('z' in target) target.z = z;
      return target;
    }
    static isFrontFacing(a, b, c, direction) {
      _triV0.subVectors(c, b);
      _triV1.subVectors(a, b);
      return _triV0.cross(_triV1).dot(direction) < 0;
    }
    set(a, b, c) {
      this.a.copy(a);
      this.b.copy(b);
      this.c.copy(c);
      return this;
    }
    setFromPointsAndIndices(points, i0, i1, i2) {
      this.a.copy(points[i0]);
      this.b.copy(points[i1]);
      this.c.copy(points[i2]);
      return this;
    }
    setFromAttributeAndIndices(attribute, i0, i1, i2) {
      this.a.fromBufferAttribute(attribute, i0);
      this.b.fromBufferAttribute(attribute, i1);
      this.c.fromBufferAttribute(attribute, i2);
      return this;
    }
    clone() {
      return new this.constructor().copy(this);
    }
    copy(triangle) {
      this.a.copy(triangle.a);
      this.b.copy(triangle.b);
      this.c.copy(triangle.c);
      return this;
    }
    getArea() {
      _triV0.subVectors(this.c, this.b);
      _triV1.subVectors(this.a, this.b);
      return _triV0.cross(_triV1).length() * 0.5;
    }
    getMidpoint(target) {
      return target.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3);
    }
    getNormal(target) {
      return Triangle.getNormal(this.a, this.b, this.c, target);
    }
    getPlane(target) {
      return target.setFromCoplanarPoints(this.a, this.b, this.c);
    }
    getBarycoord(point, target) {
      return Triangle.getBarycoord(point, this.a, this.b, this.c, target);
    }
    getInterpolation(point, v1, v2, v3, target) {
      return Triangle.getInterpolation(point, this.a, this.b, this.c, v1, v2, v3, target);
    }
    containsPoint(point) {
      return Triangle.containsPoint(point, this.a, this.b, this.c);
    }
    isFrontFacing(direction) {
      return Triangle.isFrontFacing(this.a, this.b, this.c, direction);
    }
    intersectsBox(box) {
      return box.intersectsTriangle(this);
    }
    closestPointToPoint(p, target) {
      const a = this.a;
      const b = this.b;
      const c = this.c;
      _triVab.subVectors(b, a);
      _triVac.subVectors(c, a);
      _triVap.subVectors(p, a);
      const d1 = _triVab.dot(_triVap);
      const d2 = _triVac.dot(_triVap);
      if (d1 <= 0 && d2 <= 0) return target.copy(a);
      _triVbp.subVectors(p, b);
      const d3 = _triVab.dot(_triVbp);
      const d4 = _triVac.dot(_triVbp);
      if (d3 >= 0 && d4 <= d3) return target.copy(b);
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return target.copy(a).addScaledVector(_triVab, v);
      }
      _triVcp.subVectors(p, c);
      const d5 = _triVab.dot(_triVcp);
      const d6 = _triVac.dot(_triVcp);
      if (d6 >= 0 && d5 <= d6) return target.copy(c);
      const vb = d5 * d2 - d1 * d6;
      if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return target.copy(a).addScaledVector(_triVac, w);
      }
      const va = d3 * d6 - d5 * d4;
      if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        _triVbc.subVectors(c, b);
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return target.copy(b).addScaledVector(_triVbc, w);
      }
      const denom = 1 / (va + vb + vc);
      const v = vb * denom;
      const w = vc * denom;
      return target.copy(a).addScaledVector(_triVab, v).addScaledVector(_triVac, w);
    }
    equals(triangle) {
      return triangle.a.equals(this.a) && triangle.b.equals(this.b) && triangle.c.equals(this.c);
    }
  }

  class Ray {
    constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
      this.origin = origin;
      this.direction = direction;
    }
    set(origin, direction) {
      this.origin.copy(origin);
      this.direction.copy(direction);
      return this;
    }
    copy(ray) {
      this.origin.copy(ray.origin);
      this.direction.copy(ray.direction);
      return this;
    }
    at(t, target) {
      return target.copy(this.origin).addScaledVector(this.direction, t);
    }
    lookAt(v) {
      this.direction.copy(v).sub(this.origin).normalize();
      return this;
    }
    recast(t) {
      this.origin.copy(this.at(t, _rayV));
      return this;
    }
    closestPointToPoint(point, target) {
      target.subVectors(point, this.origin);
      const directionDistance = target.dot(this.direction);
      if (directionDistance < 0) return target.copy(this.origin);
      return target.copy(this.origin).addScaledVector(this.direction, directionDistance);
    }
    distanceToPoint(point) {
      return Math.sqrt(this.distanceSqToPoint(point));
    }
    distanceSqToPoint(point) {
      const directionDistance = _rayV.subVectors(point, this.origin).dot(this.direction);
      if (directionDistance < 0) return this.origin.distanceToSquared(point);
      _rayV.copy(this.origin).addScaledVector(this.direction, directionDistance);
      return _rayV.distanceToSquared(point);
    }
    intersectSphere(sphere, target) {
      _rayV.subVectors(sphere.center, this.origin);
      const tca = _rayV.dot(this.direction);
      const d2 = _rayV.dot(_rayV) - tca * tca;
      const radius2 = sphere.radius * sphere.radius;
      if (d2 > radius2) return null;
      const thc = Math.sqrt(radius2 - d2);
      const t0 = tca - thc;
      const t1 = tca + thc;
      if (t1 < 0) return null;
      if (t0 < 0) return this.at(t1, target);
      return this.at(t0, target);
    }
    intersectsSphere(sphere) {
      return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
    }
    distanceToPlane(plane) {
      const denominator = plane.normal.dot(this.direction);
      if (denominator === 0) {
        if (plane.distanceToPoint(this.origin) === 0) return 0;
        return null;
      }
      const t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
      return t >= 0 ? t : null;
    }
    intersectPlane(plane, target) {
      const t = this.distanceToPlane(plane);
      if (t === null) return null;
      return this.at(t, target);
    }
    intersectsPlane(plane) {
      const distToPoint = plane.distanceToPoint(this.origin);
      if (distToPoint === 0) return true;
      const denominator = plane.normal.dot(this.direction);
      return denominator * distToPoint < 0;
    }
    intersectBox(box, target) {
      let tmin;
      let tmax;
      let tymin;
      let tymax;
      let tzmin;
      let tzmax;
      const invdirx = 1 / this.direction.x;
      const invdiry = 1 / this.direction.y;
      const invdirz = 1 / this.direction.z;
      const origin = this.origin;
      if (invdirx >= 0) {
        tmin = (box.min.x - origin.x) * invdirx;
        tmax = (box.max.x - origin.x) * invdirx;
      } else {
        tmin = (box.max.x - origin.x) * invdirx;
        tmax = (box.min.x - origin.x) * invdirx;
      }
      if (invdiry >= 0) {
        tymin = (box.min.y - origin.y) * invdiry;
        tymax = (box.max.y - origin.y) * invdiry;
      } else {
        tymin = (box.max.y - origin.y) * invdiry;
        tymax = (box.min.y - origin.y) * invdiry;
      }
      if (tmin > tymax || tymin > tmax) return null;
      if (tymin > tmin || isNaN(tmin)) tmin = tymin;
      if (tymax < tmax || isNaN(tmax)) tmax = tymax;
      if (invdirz >= 0) {
        tzmin = (box.min.z - origin.z) * invdirz;
        tzmax = (box.max.z - origin.z) * invdirz;
      } else {
        tzmin = (box.max.z - origin.z) * invdirz;
        tzmax = (box.min.z - origin.z) * invdirz;
      }
      if (tmin > tzmax || tzmin > tmax) return null;
      if (tzmin > tmin || tmin !== tmin) tmin = tzmin;
      if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
      if (tmax < 0) return null;
      return this.at(tmin >= 0 ? tmin : tmax, target);
    }
    intersectsBox(box) {
      return this.intersectBox(box, _rayV) !== null;
    }
    intersectTriangle(a, b, c, backfaceCulling, target) {
      _rayEdge1.subVectors(b, a);
      _rayEdge2.subVectors(c, a);
      _rayNormal.crossVectors(_rayEdge1, _rayEdge2);
      let DdN = this.direction.dot(_rayNormal);
      let sign;
      if (DdN > 0) {
        if (backfaceCulling) return null;
        sign = 1;
      } else if (DdN < 0) {
        sign = -1;
        DdN = -DdN;
      } else {
        return null;
      }
      _rayDiff.subVectors(this.origin, a);
      const DdQxE2 = sign * this.direction.dot(_rayEdge2.crossVectors(_rayDiff, _rayEdge2));
      if (DdQxE2 < 0) return null;
      const DdE1xQ = sign * this.direction.dot(_rayEdge1.cross(_rayDiff));
      if (DdE1xQ < 0) return null;
      if (DdQxE2 + DdE1xQ > DdN) return null;
      const QdN = -sign * _rayDiff.dot(_rayNormal);
      if (QdN < 0) return null;
      return this.at(QdN / DdN, target);
    }
    applyMatrix4(matrix4) {
      this.origin.applyMatrix4(matrix4);
      this.direction.transformDirection(matrix4);
      return this;
    }
    equals(ray) {
      return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  class Frustum {
    constructor(p0 = new Plane(), p1 = new Plane(), p2 = new Plane(), p3 = new Plane(), p4 = new Plane(), p5 = new Plane()) {
      this.planes = [p0, p1, p2, p3, p4, p5];
    }
    set(p0, p1, p2, p3, p4, p5) {
      const planes = this.planes;
      planes[0].copy(p0);
      planes[1].copy(p1);
      planes[2].copy(p2);
      planes[3].copy(p3);
      planes[4].copy(p4);
      planes[5].copy(p5);
      return this;
    }
    copy(frustum) {
      const planes = this.planes;
      for (let i = 0; i < 6; i++) planes[i].copy(frustum.planes[i]);
      return this;
    }
    setFromProjectionMatrix(m, coordinateSystem = WebGLCoordinateSystem) {
      const planes = this.planes;
      const me = m.elements;
      const me0 = me[0];
      const me1 = me[1];
      const me2 = me[2];
      const me3 = me[3];
      const me4 = me[4];
      const me5 = me[5];
      const me6 = me[6];
      const me7 = me[7];
      const me8 = me[8];
      const me9 = me[9];
      const me10 = me[10];
      const me11 = me[11];
      const me12 = me[12];
      const me13 = me[13];
      const me14 = me[14];
      const me15 = me[15];
      planes[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize();
      planes[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize();
      planes[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize();
      planes[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize();
      planes[4].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize();
      if (coordinateSystem === WebGLCoordinateSystem) {
        planes[5].setComponents(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize();
      } else if (coordinateSystem === WebGPUCoordinateSystem) {
        planes[5].setComponents(me2, me6, me10, me14).normalize();
      } else {
        throw new Error('THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: ' + coordinateSystem);
      }
      return this;
    }
    intersectsObject(object) {
      if (!object) return false;
      if (object.boundingSphere !== undefined) {
        if (object.boundingSphere === null && object.computeBoundingSphere) object.computeBoundingSphere();
        if (!object.boundingSphere) return true;
        _frustumSphere.copy(object.boundingSphere);
        if (object.matrixWorld) _frustumSphere.applyMatrix4(object.matrixWorld);
      } else {
        const geometry = object.geometry;
        if (!geometry) return true;
        if (geometry.boundingSphere == null && geometry.computeBoundingSphere) geometry.computeBoundingSphere();
        if (!geometry.boundingSphere) return true;
        _frustumSphere.copy(geometry.boundingSphere);
        if (object.matrixWorld) _frustumSphere.applyMatrix4(object.matrixWorld);
      }
      return this.intersectsSphere(_frustumSphere);
    }
    intersectsSprite(sprite) {
      _frustumSphere.center.set(0, 0, 0);
      _frustumSphere.radius = 0.7071067811865476;
      if (sprite && sprite.matrixWorld) _frustumSphere.applyMatrix4(sprite.matrixWorld);
      return this.intersectsSphere(_frustumSphere);
    }
    intersectsSphere(sphere) {
      const planes = this.planes;
      const center = sphere.center;
      const negRadius = -sphere.radius;
      for (let i = 0; i < 6; i++) {
        if (planes[i].distanceToPoint(center) < negRadius) return false;
      }
      return true;
    }
    intersectsBox(box) {
      const planes = this.planes;
      for (let i = 0; i < 6; i++) {
        const plane = planes[i];
        _frustumV.x = plane.normal.x > 0 ? box.max.x : box.min.x;
        _frustumV.y = plane.normal.y > 0 ? box.max.y : box.min.y;
        _frustumV.z = plane.normal.z > 0 ? box.max.z : box.min.z;
        if (plane.distanceToPoint(_frustumV) < 0) return false;
      }
      return true;
    }
    containsPoint(point) {
      const planes = this.planes;
      for (let i = 0; i < 6; i++) {
        if (planes[i].distanceToPoint(point) < 0) return false;
      }
      return true;
    }
    clone() {
      return new this.constructor().copy(this);
    }
  }

  class SphericalHarmonics3 {
    constructor() {
      this.isSphericalHarmonics3 = true;
      this.coefficients = [];
      for (let i = 0; i < 9; i++) this.coefficients.push(new Vector3());
    }
    set(coefficients) {
      for (let i = 0; i < 9; i++) this.coefficients[i].copy(coefficients[i]);
      return this;
    }
    zero() {
      for (let i = 0; i < 9; i++) this.coefficients[i].set(0, 0, 0);
      return this;
    }
    getAt(normal, target) {
      const x = normal.x;
      const y = normal.y;
      const z = normal.z;
      const coeff = this.coefficients;
      target.copy(coeff[0]).multiplyScalar(0.282095);
      target.addScaledVector(coeff[1], 0.488603 * y);
      target.addScaledVector(coeff[2], 0.488603 * z);
      target.addScaledVector(coeff[3], 0.488603 * x);
      target.addScaledVector(coeff[4], 1.092548 * (x * y));
      target.addScaledVector(coeff[5], 1.092548 * (y * z));
      target.addScaledVector(coeff[6], 0.315392 * (3.0 * z * z - 1.0));
      target.addScaledVector(coeff[7], 1.092548 * (x * z));
      target.addScaledVector(coeff[8], 0.546274 * (x * x - y * y));
      return target;
    }
    getIrradianceAt(normal, target) {
      const x = normal.x;
      const y = normal.y;
      const z = normal.z;
      const coeff = this.coefficients;
      target.copy(coeff[0]).multiplyScalar(0.886227);
      target.addScaledVector(coeff[1], 2.0 * 0.511664 * y);
      target.addScaledVector(coeff[2], 2.0 * 0.511664 * z);
      target.addScaledVector(coeff[3], 2.0 * 0.511664 * x);
      target.addScaledVector(coeff[4], 2.0 * 0.429043 * x * y);
      target.addScaledVector(coeff[5], 2.0 * 0.429043 * y * z);
      target.addScaledVector(coeff[6], 0.743125 * z * z - 0.247708);
      target.addScaledVector(coeff[7], 2.0 * 0.429043 * x * z);
      target.addScaledVector(coeff[8], 0.429043 * (x * x - y * y));
      return target;
    }
    add(sh) {
      for (let i = 0; i < 9; i++) this.coefficients[i].add(sh.coefficients[i]);
      return this;
    }
    addScaledSH(sh, s) {
      for (let i = 0; i < 9; i++) this.coefficients[i].addScaledVector(sh.coefficients[i], s);
      return this;
    }
    scale(s) {
      for (let i = 0; i < 9; i++) this.coefficients[i].multiplyScalar(s);
      return this;
    }
    lerp(sh, alpha) {
      for (let i = 0; i < 9; i++) this.coefficients[i].lerp(sh.coefficients[i], alpha);
      return this;
    }
    equals(sh) {
      for (let i = 0; i < 9; i++) if (!this.coefficients[i].equals(sh.coefficients[i])) return false;
      return true;
    }
    copy(sh) {
      return this.set(sh.coefficients);
    }
    clone() {
      return new this.constructor().copy(this);
    }
    fromArray(array, offset = 0) {
      for (let i = 0; i < 9; i++) this.coefficients[i].fromArray(array, offset + i * 3);
      return this;
    }
    toArray(array = [], offset = 0) {
      for (let i = 0; i < 9; i++) this.coefficients[i].toArray(array, offset + i * 3);
      return array;
    }
    static getBasisAt(normal, shBasis) {
      const x = normal.x;
      const y = normal.y;
      const z = normal.z;
      shBasis[0] = 0.282095;
      shBasis[1] = 0.488603 * y;
      shBasis[2] = 0.488603 * z;
      shBasis[3] = 0.488603 * x;
      shBasis[4] = 1.092548 * x * y;
      shBasis[5] = 1.092548 * y * z;
      shBasis[6] = 0.315392 * (3 * z * z - 1);
      shBasis[7] = 1.092548 * x * z;
      shBasis[8] = 0.546274 * (x * x - y * y);
    }
  }

  const _v3tmp = new Vector3();
  const _v3quat = new Quaternion();
  const _m3tmp = new Matrix3();
  const _m4v = new Vector3();
  const _m4tmp = new Matrix4();
  const _m4zero = new Vector3(0, 0, 0);
  const _m4one = new Vector3(1, 1, 1);
  const _m4x = new Vector3();
  const _m4y = new Vector3();
  const _m4z = new Vector3();
  const _eulerM = new Matrix4();
  const _eulerQ = new Quaternion();
  const _hslA = { h: 0, s: 0, l: 0 };
  const _hslB = { h: 0, s: 0, l: 0 };
  const _lineStartP = new Vector3();
  const _lineStartEnd = new Vector3();
  const _planeV1 = new Vector3();
  const _planeV2 = new Vector3();
  const _planeNM = new Matrix3();
  const _box2v = new Vector2();
  const _box3v = new Vector3();
  const _box3tmp = new Box3();
  const _box3points = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ];
  const _box3v0 = new Vector3();
  const _box3v1 = new Vector3();
  const _box3v2 = new Vector3();
  const _box3f0 = new Vector3();
  const _box3f1 = new Vector3();
  const _box3f2 = new Vector3();
  const _box3center = new Vector3();
  const _box3extents = new Vector3();
  const _box3triN = new Vector3();
  const _box3testAxis = new Vector3();
  const _sphereBox = new Box3();
  const _sphereV1 = new Vector3();
  const _sphereV2 = new Vector3();
  const _triV0 = new Vector3();
  const _triV1 = new Vector3();
  const _triV2 = new Vector3();
  const _triV3 = new Vector3();
  const _triVab = new Vector3();
  const _triVac = new Vector3();
  const _triVbc = new Vector3();
  const _triVap = new Vector3();
  const _triVbp = new Vector3();
  const _triVcp = new Vector3();
  const _rayV = new Vector3();
  const _rayEdge1 = new Vector3();
  const _rayEdge2 = new Vector3();
  const _rayNormal = new Vector3();
  const _rayDiff = new Vector3();
  const _frustumSphere = new Sphere();
  const _frustumV = new Vector3();

  Vector2.prototype.isVector2 = true;
  Vector3.prototype.isVector3 = true;
  Vector4.prototype.isVector4 = true;
  Quaternion.prototype.isQuaternion = true;
  Euler.prototype.isEuler = true;
  Matrix2.prototype.isMatrix2 = true;
  Matrix3.prototype.isMatrix3 = true;
  Matrix4.prototype.isMatrix4 = true;
  Color.prototype.isColor = true;
  Plane.prototype.isPlane = true;
  Box2.prototype.isBox2 = true;
  Box3.prototype.isBox3 = true;
  Sphere.prototype.isSphere = true;
  SphericalHarmonics3.prototype.isSphericalHarmonics3 = true;

  TN.Vector2 = Vector2;
  TN.Vector3 = Vector3;
  TN.Vector4 = Vector4;
  TN.Quaternion = Quaternion;
  TN.Euler = Euler;
  TN.Matrix2 = Matrix2;
  TN.Matrix3 = Matrix3;
  TN.Matrix4 = Matrix4;
  TN.Spherical = Spherical;
  TN.Cylindrical = Cylindrical;
  TN.Color = Color;
  TN.Plane = Plane;
  TN.Ray = Ray;
  TN.Box2 = Box2;
  TN.Box3 = Box3;
  TN.Sphere = Sphere;
  TN.Triangle = Triangle;
  TN.Line3 = Line3;
  TN.Frustum = Frustum;
  TN.MathUtils = MathUtils;
  TN.SphericalHarmonics3 = SphericalHarmonics3;
  TN.DEG2RAD = MathUtils.DEG2RAD;
  TN.RAD2DEG = MathUtils.RAD2DEG;
})(globalThis.__TN = globalThis.__TN || {});
