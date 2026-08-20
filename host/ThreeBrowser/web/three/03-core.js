(function (TN) {
  'use strict';

  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  const Vector2 = TN.Vector2;
  const Vector3 = TN.Vector3;
  const Quaternion = TN.Quaternion;
  const Euler = TN.Euler;
  const Matrix3 = TN.Matrix3;
  const Matrix4 = TN.Matrix4;
  const Color = TN.Color;
  const MathUtils = TN.MathUtils || {};

  if (!Vector3 || !Quaternion || !Euler || !Matrix3 || !Matrix4 || !Color) {
    return;
  }

  const StaticDrawUsage = 35044;
  const FloatType = 1015;

  function generateUUID() {
    if (typeof MathUtils.generateUUID === 'function') return MathUtils.generateUUID();
    return globalThis.crypto?.randomUUID?.() ?? 'tn-' + Math.random().toString(16).slice(2);
  }

  function toHex(c) {
    if (c == null) return 0xffffff;
    if (typeof c === 'number' && Number.isFinite(c)) return c >>> 0;
    if (typeof c === 'object') {
      if (typeof c.getHex === 'function') return c.getHex() >>> 0;
      if (typeof c.r === 'number') {
        return (
          ((Math.round(c.r * 255) & 255) << 16) |
          ((Math.round(c.g * 255) & 255) << 8) |
          (Math.round(c.b * 255) & 255)
        ) >>> 0;
      }
    }
    return 0xffffff;
  }

  function isColorLike(value) {
    return typeof value === 'number' ||
      (value && (value.isColor || typeof value.getHex === 'function'));
  }

  function arrayNeedsUint32(array) {
    for (let i = array.length - 1; i >= 0; --i) {
      if (array[i] >= 65535) return true;
    }
    return false;
  }

  function denormalize(value, array) {
    if (typeof MathUtils.denormalize === 'function') return MathUtils.denormalize(value, array);
    switch (array.constructor) {
      case Float32Array: return value;
      case Uint32Array: return value / 4294967295.0;
      case Uint16Array: return value / 65535.0;
      case Uint8Array: return value / 255.0;
      case Int32Array: return Math.max(value / 2147483647.0, -1.0);
      case Int16Array: return Math.max(value / 32767.0, -1.0);
      case Int8Array: return Math.max(value / 127.0, -1.0);
      default: return value;
    }
  }

  function normalize(value, array) {
    if (typeof MathUtils.normalize === 'function') return MathUtils.normalize(value, array);
    switch (array.constructor) {
      case Float32Array: return value;
      case Uint32Array: return Math.round(value * 4294967295.0);
      case Uint16Array: return Math.round(value * 65535.0);
      case Uint8Array: return Math.round(value * 255.0);
      case Int32Array: return Math.round(value * 2147483647.0);
      case Int16Array: return Math.round(value * 32767.0);
      case Int8Array: return Math.round(value * 127.0);
      default: return value;
    }
  }

  const _floatView = new Float32Array(1);
  const _int32View = new Int32Array(_floatView.buffer);

  function toHalfFloat(val) {
    if (val > 65504) val = 65504;
    _floatView[0] = val;
    const x = _int32View[0];
    let bits = (x >> 16) & 0x8000;
    const m = (x >> 12) & 0x07ff;
    const e = (x >> 23) & 0xff;
    if (e < 103) return bits;
    if (e > 142) {
      bits |= 0x7c00;
      bits |= e === 255 && (x & 0x007fffff) ? 1 : 0;
      return bits;
    }
    if (e < 113) {
      const mm = m | 0x0800;
      bits |= (mm >> (114 - e)) + ((mm >> (113 - e)) & 1);
      return bits;
    }
    bits |= ((e - 112) << 10) | (m >> 1);
    bits += m & 1;
    return bits;
  }

  function fromHalfFloat(val) {
    const m = val & 0x3ff;
    const e = (val >> 10) & 0x1f;
    const s = val >> 15;
    if (e === 0) {
      if (m === 0) return s ? -0 : 0;
      return (s ? -1 : 1) * Math.pow(2, -14) * (m / 1024);
    }
    if (e === 31) return m === 0 ? (s ? -Infinity : Infinity) : NaN;
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + m / 1024);
  }

  function noop() {}

  function bindOnChange(obj, fn) {
    if (!obj) return;
    if (typeof obj._onChange === 'function') obj._onChange(fn);
    else obj._onChangeCallback = fn;
  }

  function vecFromAttr(v, attr, index) {
    if (typeof v.fromBufferAttribute === 'function') return v.fromBufferAttribute(attr, index);
    return v.set(
      attr.getX(index),
      attr.itemSize > 1 ? attr.getY(index) : 0,
      attr.itemSize > 2 ? attr.getZ(index) : 0
    );
  }

  function applyMatrix4Vec(v, m) {
    if (typeof v.applyMatrix4 === 'function') return v.applyMatrix4(m);
    const x = v.x;
    const y = v.y;
    const z = v.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
    return v.set(
      (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
      (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    );
  }

  function setFromMatrixPosition(v, m) {
    if (typeof v.setFromMatrixPosition === 'function') return v.setFromMatrixPosition(m);
    const e = m.elements;
    return v.set(e[12], e[13], e[14]);
  }

  function composeMatrix(matrix, position, quaternion, scale) {
    if (typeof matrix.compose === 'function') return matrix.compose(position, quaternion, scale);
    const te = matrix.elements;
    const x = quaternion.x;
    const y = quaternion.y;
    const z = quaternion.z;
    const w = quaternion.w;
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
    return matrix;
  }

  function decomposeMatrix(matrix, position, quaternion, scale) {
    if (typeof matrix.decompose === 'function') return matrix.decompose(position, quaternion, scale);
    const te = matrix.elements;
    let sx = Math.hypot(te[0], te[1], te[2]);
    const sy = Math.hypot(te[4], te[5], te[6]);
    const sz = Math.hypot(te[8], te[9], te[10]);
    if (matrix.determinant && matrix.determinant() < 0) sx = -sx;
    position.set(te[12], te[13], te[14]);
    scale.set(sx, sy, sz);
    const invSX = sx !== 0 ? 1 / sx : 0;
    const invSY = sy !== 0 ? 1 / sy : 0;
    const invSZ = sz !== 0 ? 1 / sz : 0;
    const m = _m1.identity ? _m1.identity() : _m1;
    const me = m.elements;
    me[0] = te[0] * invSX;
    me[1] = te[1] * invSX;
    me[2] = te[2] * invSX;
    me[4] = te[4] * invSY;
    me[5] = te[5] * invSY;
    me[6] = te[6] * invSY;
    me[8] = te[8] * invSZ;
    me[9] = te[9] * invSZ;
    me[10] = te[10] * invSZ;
    setQuatFromRotationMatrix(quaternion, m);
    return matrix;
  }

  function multiplyMatrices(out, a, b) {
    if (typeof out.multiplyMatrices === 'function') return out.multiplyMatrices(a, b);
    const ae = a.elements;
    const be = b.elements;
    const te = out.elements;
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
    return out;
  }

  function invertMatrix(m) {
    if (typeof m.invert === 'function') return m.invert();
    const te = m.elements;
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
    if (det === 0) return m.identity ? m.identity() : m;
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
    return m;
  }

  function extractRotation(out, m) {
    if (typeof out.extractRotation === 'function') return out.extractRotation(m);
    const te = m.elements;
    const me = out.elements;
    const sx = 1 / Math.hypot(te[0], te[1], te[2]);
    const sy = 1 / Math.hypot(te[4], te[5], te[6]);
    const sz = 1 / Math.hypot(te[8], te[9], te[10]);
    me[0] = te[0] * sx;
    me[1] = te[1] * sx;
    me[2] = te[2] * sx;
    me[3] = 0;
    me[4] = te[4] * sy;
    me[5] = te[5] * sy;
    me[6] = te[6] * sy;
    me[7] = 0;
    me[8] = te[8] * sz;
    me[9] = te[9] * sz;
    me[10] = te[10] * sz;
    me[11] = 0;
    me[12] = 0;
    me[13] = 0;
    me[14] = 0;
    me[15] = 1;
    return out;
  }

  function lookAtMatrix(m, eye, target, up) {
    if (typeof m.lookAt === 'function') return m.lookAt(eye, target, up);
    const te = m.elements;
    _lookZ.subVectors(eye, target);
    if (_lookZ.lengthSq() === 0) _lookZ.z = 1;
    _lookZ.normalize();
    _lookX.crossVectors(up, _lookZ);
    if (_lookX.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) _lookZ.x += 0.0001;
      else _lookZ.z += 0.0001;
      _lookZ.normalize();
      _lookX.crossVectors(up, _lookZ);
    }
    _lookX.normalize();
    _lookY.crossVectors(_lookZ, _lookX);
    te[0] = _lookX.x;
    te[4] = _lookY.x;
    te[8] = _lookZ.x;
    te[1] = _lookX.y;
    te[5] = _lookY.y;
    te[9] = _lookZ.y;
    te[2] = _lookX.z;
    te[6] = _lookY.z;
    te[10] = _lookZ.z;
    return m;
  }

  function makeRotationX(m, theta) {
    if (typeof m.makeRotationX === 'function') return m.makeRotationX(theta);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    if (m.identity) m.identity();
    const te = m.elements;
    te[5] = c;
    te[9] = -s;
    te[6] = s;
    te[10] = c;
    return m;
  }

  function makeRotationY(m, theta) {
    if (typeof m.makeRotationY === 'function') return m.makeRotationY(theta);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    if (m.identity) m.identity();
    const te = m.elements;
    te[0] = c;
    te[8] = s;
    te[2] = -s;
    te[10] = c;
    return m;
  }

  function makeRotationZ(m, theta) {
    if (typeof m.makeRotationZ === 'function') return m.makeRotationZ(theta);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    if (m.identity) m.identity();
    const te = m.elements;
    te[0] = c;
    te[4] = -s;
    te[1] = s;
    te[5] = c;
    return m;
  }

  function makeTranslation(m, x, y, z) {
    if (typeof m.makeTranslation === 'function') return m.makeTranslation(x, y, z);
    if (m.identity) m.identity();
    m.elements[12] = x;
    m.elements[13] = y;
    m.elements[14] = z;
    return m;
  }

  function makeScale(m, x, y, z) {
    if (typeof m.makeScale === 'function') return m.makeScale(x, y, z);
    if (m.identity) m.identity();
    const te = m.elements;
    te[0] = x;
    te[5] = y;
    te[10] = z;
    return m;
  }

  function premultiplyMatrix(m, a) {
    if (typeof m.premultiply === 'function') return m.premultiply(a);
    return multiplyMatrices(m, a, m);
  }

  function setQuatFromEuler(q, euler) {
    if (typeof q.setFromEuler === 'function') return q.setFromEuler(euler, false);
    const x = euler.x;
    const y = euler.y;
    const z = euler.z;
    const order = euler.order || 'XYZ';
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);
    switch (order) {
      case 'YXZ':
        q.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
        break;
      case 'ZXY':
        q.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
        break;
      case 'ZYX':
        q.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
        break;
      case 'YZX':
        q.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
        break;
      case 'XZY':
        q.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
        break;
      default:
        q.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
    }
    return q;
  }

  function setFromQuaternion(euler, q, order) {
    if (typeof euler.setFromQuaternion === 'function') return euler.setFromQuaternion(q, order, false);
    const m = _m1;
    setMatrixFromQuat(m, q);
    return setEulerFromRotationMatrix(euler, m, order || euler.order);
  }

  function setMatrixFromQuat(m, q) {
    if (typeof m.makeRotationFromQuaternion === 'function') return m.makeRotationFromQuaternion(q);
    return composeMatrix(m, _zero, q, _one);
  }

  function setEulerFromRotationMatrix(euler, m, order) {
    if (typeof euler.setFromRotationMatrix === 'function') return euler.setFromRotationMatrix(m, order, false);
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
    order = order || euler.order || 'XYZ';
    const clamp = MathUtils.clamp || ((v, a, b) => Math.max(a, Math.min(b, v)));
    switch (order) {
      case 'YXZ':
        euler.set(Math.asin(-clamp(m23, -1, 1)), Math.atan2(m13, m33), Math.atan2(m21, m22), order);
        break;
      case 'ZXY':
        euler.set(Math.asin(clamp(m32, -1, 1)), Math.atan2(-m31, m33), Math.atan2(-m12, m22), order);
        break;
      case 'ZYX':
        euler.set(Math.atan2(m32, m33), Math.asin(-clamp(m31, -1, 1)), Math.atan2(m21, m11), order);
        break;
      case 'YZX':
        euler.set(Math.atan2(-m23, m22), Math.atan2(-m31, m11), Math.asin(clamp(m21, -1, 1)), order);
        break;
      case 'XZY':
        euler.set(Math.atan2(m32, m22), Math.atan2(m13, m11), Math.asin(-clamp(m12, -1, 1)), order);
        break;
      default:
        euler.set(Math.atan2(-m23, m33), Math.asin(clamp(m13, -1, 1)), Math.atan2(-m12, m11), order);
    }
    return euler;
  }

  function setQuatFromRotationMatrix(q, m) {
    if (typeof q.setFromRotationMatrix === 'function') return q.setFromRotationMatrix(m);
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
      return q.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
    }
    if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      return q.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
    }
    if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      return q.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
    }
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    return q.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
  }

  function setQuatFromAxisAngle(q, axis, angle) {
    if (typeof q.setFromAxisAngle === 'function') return q.setFromAxisAngle(axis, angle);
    const half = angle / 2;
    const s = Math.sin(half);
    return q.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
  }

  function quatMultiply(target, a, b) {
    const qax = a.x;
    const qay = a.y;
    const qaz = a.z;
    const qaw = a.w;
    const qbx = b.x;
    const qby = b.y;
    const qbz = b.z;
    const qbw = b.w;
    return target.set(
      qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
      qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
      qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
      qaw * qbw - qax * qbx - qay * qby - qaz * qbz
    );
  }

  function quatInvert(q) {
    if (typeof q.invert === 'function') return q.invert();
    return q.set(-q.x, -q.y, -q.z, q.w);
  }

  function getNormalMatrix(matrix4) {
    const n = new Matrix3();
    if (typeof n.getNormalMatrix === 'function') return n.getNormalMatrix(matrix4);
    const te = matrix4.elements;
    const me = n.elements;
    const n11 = te[0];
    const n21 = te[1];
    const n31 = te[2];
    const n12 = te[4];
    const n22 = te[5];
    const n32 = te[6];
    const n13 = te[8];
    const n23 = te[9];
    const n33 = te[10];
    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;
    const det = n11 * t11 + n21 * t12 + n31 * t13;
    if (det === 0) {
      me[0] = 1; me[1] = 0; me[2] = 0;
      me[3] = 0; me[4] = 1; me[5] = 0;
      me[6] = 0; me[7] = 0; me[8] = 1;
      return n;
    }
    const detInv = 1 / det;
    me[0] = t11 * detInv;
    me[1] = (n31 * n23 - n33 * n21) * detInv;
    me[2] = (n32 * n21 - n31 * n22) * detInv;
    me[3] = t12 * detInv;
    me[4] = (n33 * n11 - n31 * n13) * detInv;
    me[5] = (n31 * n12 - n32 * n11) * detInv;
    me[6] = t13 * detInv;
    me[7] = (n21 * n13 - n23 * n11) * detInv;
    me[8] = (n22 * n11 - n21 * n12) * detInv;
    return n;
  }

  class LocalBox3 {
    constructor(min, max) {
      this.isBox3 = true;
      this.min = min ? min.clone() : new Vector3(Infinity, Infinity, Infinity);
      this.max = max ? max.clone() : new Vector3(-Infinity, -Infinity, -Infinity);
    }
    set(min, max) {
      this.min.copy(min);
      this.max.copy(max);
      return this;
    }
    copy(box) {
      this.min.copy(box.min);
      this.max.copy(box.max);
      return this;
    }
    clone() {
      return new LocalBox3(this.min, this.max);
    }
    makeEmpty() {
      this.min.set(Infinity, Infinity, Infinity);
      this.max.set(-Infinity, -Infinity, -Infinity);
      return this;
    }
    expandByPoint(point) {
      this.min.set(Math.min(this.min.x, point.x), Math.min(this.min.y, point.y), Math.min(this.min.z, point.z));
      this.max.set(Math.max(this.max.x, point.x), Math.max(this.max.y, point.y), Math.max(this.max.z, point.z));
      return this;
    }
    setFromBufferAttribute(attribute) {
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let i = 0, l = attribute.count; i < l; i++) {
        const x = attribute.getX(i);
        const y = attribute.getY(i);
        const z = attribute.getZ(i);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      this.min.set(minX, minY, minZ);
      this.max.set(maxX, maxY, maxZ);
      return this;
    }
    getCenter(target) {
      return target.set(
        (this.min.x + this.max.x) * 0.5,
        (this.min.y + this.max.y) * 0.5,
        (this.min.z + this.max.z) * 0.5
      );
    }
  }

  class LocalSphere {
    constructor(center, radius = 0) {
      this.isSphere = true;
      this.center = center ? center.clone() : new Vector3();
      this.radius = radius;
    }
    set(center, radius) {
      this.center.copy(center);
      this.radius = radius;
      return this;
    }
    copy(sphere) {
      this.center.copy(sphere.center);
      this.radius = sphere.radius;
      return this;
    }
    clone() {
      return new LocalSphere(this.center, this.radius);
    }
  }

  class LocalRay {
    constructor(origin, direction) {
      this.origin = origin || new Vector3();
      this.direction = direction || new Vector3(0, 0, -1);
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
  }

  const Box3 = TN.Box3 || LocalBox3;
  const Sphere = TN.Sphere || LocalSphere;
  const Ray = TN.Ray || LocalRay;

  const _v1 = new Vector3();
  const _v2 = new Vector3();
  const _q1 = new Quaternion();
  const _m1 = new Matrix4();
  const _m2 = new Matrix4();
  const _target = new Vector3();
  const _position = new Vector3();
  const _scale = new Vector3();
  const _quaternion = new Quaternion();
  const _xAxis = new Vector3(1, 0, 0);
  const _yAxis = new Vector3(0, 1, 0);
  const _zAxis = new Vector3(0, 0, 1);
  const _zero = new Vector3();
  const _one = new Vector3(1, 1, 1);
  const _lookX = new Vector3();
  const _lookY = new Vector3();
  const _lookZ = new Vector3();
  const _box = new Box3();
  const _boxMorph = new Box3();
  const _offset = new Vector3();
  const _vec2 = Vector2 ? new Vector2() : null;
  const _geoRot = new Matrix4();

  const _addedEvent = { type: 'added' };
  const _removedEvent = { type: 'removed' };
  const _childaddedEvent = { type: 'childadded', child: null };
  const _childremovedEvent = { type: 'childremoved', child: null };

  class EventDispatcher {
    addEventListener(type, listener) {
      if (this._listeners === undefined) this._listeners = {};
      const listeners = this._listeners;
      if (listeners[type] === undefined) listeners[type] = [];
      if (listeners[type].indexOf(listener) === -1) listeners[type].push(listener);
    }
    hasEventListener(type, listener) {
      if (this._listeners === undefined) return false;
      const listeners = this._listeners;
      return listeners[type] !== undefined && listeners[type].indexOf(listener) !== -1;
    }
    removeEventListener(type, listener) {
      if (this._listeners === undefined) return;
      const listenerArray = this._listeners[type];
      if (listenerArray !== undefined) {
        const index = listenerArray.indexOf(listener);
        if (index !== -1) listenerArray.splice(index, 1);
      }
    }
    dispatchEvent(event) {
      if (this._listeners === undefined) return;
      const listenerArray = this._listeners[event.type];
      if (listenerArray !== undefined) {
        event.target = this;
        const array = listenerArray.slice(0);
        for (let i = 0, l = array.length; i < l; i++) array[i].call(this, event);
        event.target = null;
      }
    }
  }

  class Layers {
    constructor() {
      this.mask = 1 | 0;
    }
    set(channel) {
      this.mask = (1 << channel | 0) >>> 0;
    }
    enable(channel) {
      this.mask |= 1 << channel | 0;
    }
    enableAll() {
      this.mask = 0xffffffff | 0;
    }
    toggle(channel) {
      this.mask ^= 1 << channel | 0;
    }
    disable(channel) {
      this.mask &= ~(1 << channel | 0);
    }
    disableAll() {
      this.mask = 0;
    }
    test(layers) {
      return (this.mask & layers.mask) !== 0;
    }
    isEnabled(channel) {
      return (this.mask & (1 << channel | 0)) !== 0;
    }
  }

  function now() {
    return performance.now();
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
      this.startTime = now();
      this.oldTime = this.startTime;
      this.elapsedTime = 0;
      this.running = true;
    }
    stop() {
      this.getElapsedTime();
      this.running = false;
      this.autoStart = false;
    }
    getElapsedTime() {
      this.getDelta();
      return this.elapsedTime;
    }
    getDelta() {
      let diff = 0;
      if (this.autoStart && !this.running) {
        this.start();
        return 0;
      }
      if (this.running) {
        const newTime = now();
        diff = (newTime - this.oldTime) / 1000;
        this.oldTime = newTime;
        this.elapsedTime += diff;
      }
      return diff;
    }
  }

  class Timer {
    constructor() {
      this._previousTime = 0;
      this._currentTime = 0;
      this._startTime = now();
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
        doc.addEventListener('visibilitychange', this._pageVisibilityHandler, false);
      }
    }
    disconnect() {
      if (this._pageVisibilityHandler !== null && this._document) {
        this._document.removeEventListener('visibilitychange', this._pageVisibilityHandler);
        this._pageVisibilityHandler = null;
      }
      this._document = null;
    }
    getDelta() {
      return this._delta / 1000;
    }
    getElapsed() {
      return this._elapsed / 1000;
    }
    getTimescale() {
      return this._timescale;
    }
    setTimescale(timescale) {
      this._timescale = timescale;
      return this;
    }
    reset() {
      this._currentTime = now() - this._startTime;
      return this;
    }
    dispose() {
      this.disconnect();
    }
    update(timestamp) {
      if (this._pageVisibilityHandler !== null && this._document && this._document.hidden === true) {
        this._delta = 0;
      } else {
        this._previousTime = this._currentTime;
        this._currentTime = (timestamp !== undefined ? timestamp : now()) - this._startTime;
        this._delta = (this._currentTime - this._previousTime) * this._timescale;
        this._elapsed += this._delta;
      }
      return this;
    }
  }

  class Uniform {
    constructor(value) {
      this.value = value;
    }
    clone() {
      return new Uniform(this.value.clone === undefined ? this.value : this.value.clone());
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
      if (element === undefined) {
        console.warn('THREE.Controls: connect() now requires an element.');
        return;
      }
      if (this.domElement !== null) this.disconnect();
      this.domElement = element;
    }
    disconnect() {}
    dispose() {}
    update() {}
  }

  class BufferAttribute {
    constructor(array, itemSize, normalized = false) {
      if (Array.isArray(array)) {
        throw new TypeError('THREE.BufferAttribute: array should be a Typed Array.');
      }
      this.isBufferAttribute = true;
      this.name = '';
      this.array = array;
      this.itemSize = itemSize;
      this.count = array !== undefined ? (array.length / itemSize) | 0 : 0;
      this.normalized = !!normalized;
      this.usage = StaticDrawUsage;
      this.updateRanges = [];
      this.gpuType = FloatType;
      this.version = 0;
    }
    onUploadCallback() {}
    set needsUpdate(value) {
      if (value === true) this.version++;
    }
    setUsage(value) {
      this.usage = value;
      return this;
    }
    addUpdateRange(start, count) {
      this.updateRanges.push({ start, count });
    }
    clearUpdateRanges() {
      this.updateRanges.length = 0;
    }
    copy(source) {
      this.name = source.name;
      this.array = new source.array.constructor(source.array);
      this.itemSize = source.itemSize;
      this.count = source.count;
      this.normalized = source.normalized;
      this.usage = source.usage;
      this.gpuType = source.gpuType;
      return this;
    }
    copyAt(index1, attribute, index2) {
      index1 *= this.itemSize;
      index2 *= attribute.itemSize;
      for (let i = 0, l = this.itemSize; i < l; i++) {
        this.array[index1 + i] = attribute.array[index2 + i];
      }
      return this;
    }
    copyArray(array) {
      this.array.set(array);
      return this;
    }
    applyMatrix3(m) {
      if (this.itemSize === 2 && _vec2 && _vec2.applyMatrix3) {
        for (let i = 0, l = this.count; i < l; i++) {
          _vec2.fromBufferAttribute(this, i);
          _vec2.applyMatrix3(m);
          this.setXY(i, _vec2.x, _vec2.y);
        }
      } else if (this.itemSize === 3) {
        const e = m.elements;
        for (let i = 0, l = this.count; i < l; i++) {
          const x = this.getX(i);
          const y = this.getY(i);
          const z = this.getZ(i);
          this.setXYZ(
            i,
            e[0] * x + e[3] * y + e[6] * z,
            e[1] * x + e[4] * y + e[7] * z,
            e[2] * x + e[5] * y + e[8] * z
          );
        }
      }
      return this;
    }
    applyMatrix4(m) {
      const e = m.elements;
      for (let i = 0, l = this.count; i < l; i++) {
        const x = this.getX(i);
        const y = this.getY(i);
        const z = this.getZ(i);
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
        this.setXYZ(
          i,
          (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
          (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
          (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
        );
      }
      return this;
    }
    applyNormalMatrix(m) {
      const e = m.elements || m;
      const is4 = e.length >= 16;
      for (let i = 0, l = this.count; i < l; i++) {
        const x = this.getX(i);
        const y = this.getY(i);
        const z = this.getZ(i);
        let nx;
        let ny;
        let nz;
        if (is4) {
          nx = e[0] * x + e[4] * y + e[8] * z;
          ny = e[1] * x + e[5] * y + e[9] * z;
          nz = e[2] * x + e[6] * y + e[10] * z;
        } else {
          nx = e[0] * x + e[3] * y + e[6] * z;
          ny = e[1] * x + e[4] * y + e[7] * z;
          nz = e[2] * x + e[5] * y + e[8] * z;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        this.setXYZ(i, nx / len, ny / len, nz / len);
      }
      return this;
    }
    transformDirection(m) {
      const e = m.elements;
      for (let i = 0, l = this.count; i < l; i++) {
        const x = this.getX(i);
        const y = this.getY(i);
        const z = this.getZ(i);
        let nx = e[0] * x + e[4] * y + e[8] * z;
        let ny = e[1] * x + e[5] * y + e[9] * z;
        let nz = e[2] * x + e[6] * y + e[10] * z;
        const len = Math.hypot(nx, ny, nz) || 1;
        this.setXYZ(i, nx / len, ny / len, nz / len);
      }
      return this;
    }
    set(value, offset = 0) {
      this.array.set(value, offset);
      return this;
    }
    getComponent(index, component) {
      let value = this.array[index * this.itemSize + component];
      if (this.normalized) value = denormalize(value, this.array);
      return value;
    }
    setComponent(index, component, value) {
      if (this.normalized) value = normalize(value, this.array);
      this.array[index * this.itemSize + component] = value;
      return this;
    }
    getX(index) {
      let x = this.array[index * this.itemSize];
      if (this.normalized) x = denormalize(x, this.array);
      return x;
    }
    setX(index, x) {
      if (this.normalized) x = normalize(x, this.array);
      this.array[index * this.itemSize] = x;
      return this;
    }
    getY(index) {
      let y = this.array[index * this.itemSize + 1];
      if (this.normalized) y = denormalize(y, this.array);
      return y;
    }
    setY(index, y) {
      if (this.normalized) y = normalize(y, this.array);
      this.array[index * this.itemSize + 1] = y;
      return this;
    }
    getZ(index) {
      let z = this.array[index * this.itemSize + 2];
      if (this.normalized) z = denormalize(z, this.array);
      return z;
    }
    setZ(index, z) {
      if (this.normalized) z = normalize(z, this.array);
      this.array[index * this.itemSize + 2] = z;
      return this;
    }
    getW(index) {
      let w = this.array[index * this.itemSize + 3];
      if (this.normalized) w = denormalize(w, this.array);
      return w;
    }
    setW(index, w) {
      if (this.normalized) w = normalize(w, this.array);
      this.array[index * this.itemSize + 3] = w;
      return this;
    }
    setXY(index, x, y) {
      index *= this.itemSize;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
      }
      this.array[index + 0] = x;
      this.array[index + 1] = y;
      return this;
    }
    setXYZ(index, x, y, z) {
      index *= this.itemSize;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
        z = normalize(z, this.array);
      }
      this.array[index + 0] = x;
      this.array[index + 1] = y;
      this.array[index + 2] = z;
      return this;
    }
    setXYZW(index, x, y, z, w) {
      index *= this.itemSize;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
        z = normalize(z, this.array);
        w = normalize(w, this.array);
      }
      this.array[index + 0] = x;
      this.array[index + 1] = y;
      this.array[index + 2] = z;
      this.array[index + 3] = w;
      return this;
    }
    onUpload(callback) {
      this.onUploadCallback = callback;
      return this;
    }
    clone() {
      return new this.constructor(this.array, this.itemSize).copy(this);
    }
    toJSON() {
      const data = {
        itemSize: this.itemSize,
        type: this.array.constructor.name,
        array: Array.from(this.array),
        normalized: this.normalized
      };
      if (this.name !== '') data.name = this.name;
      if (this.usage !== StaticDrawUsage) data.usage = this.usage;
      return data;
    }
  }

  class Int8BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Int8Array(array), itemSize, normalized);
    }
  }

  class Uint8BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Uint8Array(array), itemSize, normalized);
    }
  }

  class Int16BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Int16Array(array), itemSize, normalized);
    }
  }

  class Uint16BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Uint16Array(array), itemSize, normalized);
    }
  }

  class Int32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Int32Array(array), itemSize, normalized);
    }
  }

  class Uint32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Uint32Array(array), itemSize, normalized);
    }
  }

  class Float16BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Uint16Array(array), itemSize, normalized);
      this.isFloat16BufferAttribute = true;
    }
    getX(index) {
      let x = fromHalfFloat(this.array[index * this.itemSize]);
      if (this.normalized) x = denormalize(x, this.array);
      return x;
    }
    setX(index, x) {
      if (this.normalized) x = normalize(x, this.array);
      this.array[index * this.itemSize] = toHalfFloat(x);
      return this;
    }
    getY(index) {
      let y = fromHalfFloat(this.array[index * this.itemSize + 1]);
      if (this.normalized) y = denormalize(y, this.array);
      return y;
    }
    setY(index, y) {
      if (this.normalized) y = normalize(y, this.array);
      this.array[index * this.itemSize + 1] = toHalfFloat(y);
      return this;
    }
    getZ(index) {
      let z = fromHalfFloat(this.array[index * this.itemSize + 2]);
      if (this.normalized) z = denormalize(z, this.array);
      return z;
    }
    setZ(index, z) {
      if (this.normalized) z = normalize(z, this.array);
      this.array[index * this.itemSize + 2] = toHalfFloat(z);
      return this;
    }
    getW(index) {
      let w = fromHalfFloat(this.array[index * this.itemSize + 3]);
      if (this.normalized) w = denormalize(w, this.array);
      return w;
    }
    setW(index, w) {
      if (this.normalized) w = normalize(w, this.array);
      this.array[index * this.itemSize + 3] = toHalfFloat(w);
      return this;
    }
    setXY(index, x, y) {
      index *= this.itemSize;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
      }
      this.array[index + 0] = toHalfFloat(x);
      this.array[index + 1] = toHalfFloat(y);
      return this;
    }
    setXYZ(index, x, y, z) {
      index *= this.itemSize;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
        z = normalize(z, this.array);
      }
      this.array[index + 0] = toHalfFloat(x);
      this.array[index + 1] = toHalfFloat(y);
      this.array[index + 2] = toHalfFloat(z);
      return this;
    }
    setXYZW(index, x, y, z, w) {
      index *= this.itemSize;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
        z = normalize(z, this.array);
        w = normalize(w, this.array);
      }
      this.array[index + 0] = toHalfFloat(x);
      this.array[index + 1] = toHalfFloat(y);
      this.array[index + 2] = toHalfFloat(z);
      this.array[index + 3] = toHalfFloat(w);
      return this;
    }
  }

  class Float32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized) {
      super(new Float32Array(array), itemSize, normalized);
    }
  }

  class InstancedBufferAttribute extends BufferAttribute {
    constructor(array, itemSize, normalized, meshPerAttribute = 1) {
      super(array, itemSize, normalized);
      this.isInstancedBufferAttribute = true;
      this.meshPerAttribute = meshPerAttribute;
    }
    copy(source) {
      super.copy(source);
      this.meshPerAttribute = source.meshPerAttribute;
      return this;
    }
    toJSON() {
      const data = super.toJSON();
      data.meshPerAttribute = this.meshPerAttribute;
      data.isInstancedBufferAttribute = true;
      return data;
    }
  }

  class InterleavedBuffer {
    constructor(array, stride) {
      this.isInterleavedBuffer = true;
      this.array = array;
      this.stride = stride;
      this.count = array !== undefined ? (array.length / stride) | 0 : 0;
      this.usage = StaticDrawUsage;
      this.updateRanges = [];
      this.version = 0;
      this.uuid = generateUUID();
    }
    onUploadCallback() {}
    set needsUpdate(value) {
      if (value === true) this.version++;
    }
    setUsage(value) {
      this.usage = value;
      return this;
    }
    addUpdateRange(start, count) {
      this.updateRanges.push({ start, count });
    }
    clearUpdateRanges() {
      this.updateRanges.length = 0;
    }
    copy(source) {
      this.array = new source.array.constructor(source.array);
      this.count = source.count;
      this.stride = source.stride;
      this.usage = source.usage;
      return this;
    }
    copyAt(index1, attribute, index2) {
      index1 *= this.stride;
      index2 *= attribute.stride;
      for (let i = 0, l = this.stride; i < l; i++) {
        this.array[index1 + i] = attribute.array[index2 + i];
      }
      return this;
    }
    set(value, offset = 0) {
      this.array.set(value, offset);
      return this;
    }
    clone(data) {
      if (data === undefined) {
        const ib = new this.constructor(this.array.slice(), this.stride);
        ib.setUsage(this.usage);
        return ib;
      }
      if (data.arrayBuffers === undefined) data.arrayBuffers = {};
      if (this.array.buffer._uuid === undefined) this.array.buffer._uuid = generateUUID();
      if (data.arrayBuffers[this.array.buffer._uuid] === undefined) {
        data.arrayBuffers[this.array.buffer._uuid] = this.array.slice(0).buffer;
      }
      const array = new this.array.constructor(data.arrayBuffers[this.array.buffer._uuid]);
      const ib = new this.constructor(array, this.stride);
      ib.setUsage(this.usage);
      return ib;
    }
    onUpload(callback) {
      this.onUploadCallback = callback;
      return this;
    }
    toJSON(data) {
      if (data === undefined) data = {};
      if (data.arrayBuffers === undefined) data.arrayBuffers = {};
      if (this.array.buffer._uuid === undefined) this.array.buffer._uuid = generateUUID();
      if (data.arrayBuffers[this.array.buffer._uuid] === undefined) {
        data.arrayBuffers[this.array.buffer._uuid] = Array.from(new Uint32Array(this.array.buffer));
      }
      return {
        uuid: this.uuid,
        buffer: this.array.buffer._uuid,
        type: this.array.constructor.name,
        stride: this.stride
      };
    }
  }

  class InterleavedBufferAttribute {
    constructor(interleavedBuffer, itemSize, offset, normalized = false) {
      this.isInterleavedBufferAttribute = true;
      this.name = '';
      this.data = interleavedBuffer;
      this.itemSize = itemSize;
      this.offset = offset;
      this.normalized = !!normalized;
    }
    get count() {
      return this.data.count;
    }
    get array() {
      return this.data.array;
    }
    set needsUpdate(value) {
      this.data.needsUpdate = value;
    }
    applyMatrix4(m) {
      for (let i = 0, l = this.data.count; i < l; i++) {
        vecFromAttr(_v1, this, i);
        applyMatrix4Vec(_v1, m);
        this.setXYZ(i, _v1.x, _v1.y, _v1.z);
      }
      return this;
    }
    applyNormalMatrix(m) {
      const e = m.elements || m;
      const is4 = e.length >= 16;
      for (let i = 0, l = this.count; i < l; i++) {
        const x = this.getX(i);
        const y = this.getY(i);
        const z = this.getZ(i);
        let nx;
        let ny;
        let nz;
        if (is4) {
          nx = e[0] * x + e[4] * y + e[8] * z;
          ny = e[1] * x + e[5] * y + e[9] * z;
          nz = e[2] * x + e[6] * y + e[10] * z;
        } else {
          nx = e[0] * x + e[3] * y + e[6] * z;
          ny = e[1] * x + e[4] * y + e[7] * z;
          nz = e[2] * x + e[5] * y + e[8] * z;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        this.setXYZ(i, nx / len, ny / len, nz / len);
      }
      return this;
    }
    transformDirection(m) {
      const e = m.elements;
      for (let i = 0, l = this.count; i < l; i++) {
        const x = this.getX(i);
        const y = this.getY(i);
        const z = this.getZ(i);
        let nx = e[0] * x + e[4] * y + e[8] * z;
        let ny = e[1] * x + e[5] * y + e[9] * z;
        let nz = e[2] * x + e[6] * y + e[10] * z;
        const len = Math.hypot(nx, ny, nz) || 1;
        this.setXYZ(i, nx / len, ny / len, nz / len);
      }
      return this;
    }
    getComponent(index, component) {
      let value = this.array[index * this.data.stride + this.offset + component];
      if (this.normalized) value = denormalize(value, this.array);
      return value;
    }
    setComponent(index, component, value) {
      if (this.normalized) value = normalize(value, this.array);
      this.data.array[index * this.data.stride + this.offset + component] = value;
      return this;
    }
    setX(index, x) {
      if (this.normalized) x = normalize(x, this.array);
      this.data.array[index * this.data.stride + this.offset] = x;
      return this;
    }
    setY(index, y) {
      if (this.normalized) y = normalize(y, this.array);
      this.data.array[index * this.data.stride + this.offset + 1] = y;
      return this;
    }
    setZ(index, z) {
      if (this.normalized) z = normalize(z, this.array);
      this.data.array[index * this.data.stride + this.offset + 2] = z;
      return this;
    }
    setW(index, w) {
      if (this.normalized) w = normalize(w, this.array);
      this.data.array[index * this.data.stride + this.offset + 3] = w;
      return this;
    }
    getX(index) {
      let x = this.data.array[index * this.data.stride + this.offset];
      if (this.normalized) x = denormalize(x, this.array);
      return x;
    }
    getY(index) {
      let y = this.data.array[index * this.data.stride + this.offset + 1];
      if (this.normalized) y = denormalize(y, this.array);
      return y;
    }
    getZ(index) {
      let z = this.data.array[index * this.data.stride + this.offset + 2];
      if (this.normalized) z = denormalize(z, this.array);
      return z;
    }
    getW(index) {
      let w = this.data.array[index * this.data.stride + this.offset + 3];
      if (this.normalized) w = denormalize(w, this.array);
      return w;
    }
    setXY(index, x, y) {
      index = index * this.data.stride + this.offset;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
      }
      this.data.array[index + 0] = x;
      this.data.array[index + 1] = y;
      return this;
    }
    setXYZ(index, x, y, z) {
      index = index * this.data.stride + this.offset;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
        z = normalize(z, this.array);
      }
      this.data.array[index + 0] = x;
      this.data.array[index + 1] = y;
      this.data.array[index + 2] = z;
      return this;
    }
    setXYZW(index, x, y, z, w) {
      index = index * this.data.stride + this.offset;
      if (this.normalized) {
        x = normalize(x, this.array);
        y = normalize(y, this.array);
        z = normalize(z, this.array);
        w = normalize(w, this.array);
      }
      this.data.array[index + 0] = x;
      this.data.array[index + 1] = y;
      this.data.array[index + 2] = z;
      this.data.array[index + 3] = w;
      return this;
    }
    clone(data) {
      if (data === undefined) {
        const array = [];
        for (let i = 0; i < this.count; i++) {
          const index = i * this.data.stride + this.offset;
          for (let j = 0; j < this.itemSize; j++) array.push(this.data.array[index + j]);
        }
        return new BufferAttribute(new this.array.constructor(array), this.itemSize, this.normalized);
      }
      if (data.interleavedBuffers === undefined) data.interleavedBuffers = {};
      if (data.interleavedBuffers[this.data.uuid] === undefined) {
        data.interleavedBuffers[this.data.uuid] = this.data.clone(data);
      }
      return new InterleavedBufferAttribute(
        data.interleavedBuffers[this.data.uuid],
        this.itemSize,
        this.offset,
        this.normalized
      );
    }
  }

  let _object3DId = 0;

  function allocNativeGroup() {
    if (TN.cmd && typeof TN.cmd.group === "function") {
      const id = TN.cmd.alloc();
      TN.cmd.group(id);
      return id;
    }
    const n = native();
    if (!TN.hostHas?.(n, "GroupCreate")) return 0;
    try {
      return n.GroupCreate() || 0;
    } catch {
      return 0;
    }
  }

  class Object3D extends EventDispatcher {
    // GLTFLoader (and other addons) create empty nodes with `new Object3D()`.
    // Those must have a native Group or the whole subtree never reaches GL.
    constructor(handle) {
      super();
      this.isObject3D = true;
      if (arguments.length === 0) handle = allocNativeGroup();
      this._h = handle || 0;
      Object.defineProperty(this, 'id', { value: _object3DId++ });
      this.uuid = generateUUID();
      this.name = '';
      this.type = 'Object3D';
      this.parent = null;
      this.children = [];
      this.up = Object3D.DEFAULT_UP.clone();

      const position = new Vector3();
      const rotation = new Euler();
      const quaternion = new Quaternion();
      const scale = new Vector3(1, 1, 1);

      this._posDirty = false;
      this._rotDirty = false;
      this._scaleDirty = false;
      this._look = null;
      this._lookDirty = false;

      const scope = this;

      function onRotationChange() {
        const saved = quaternion._onChangeCallback;
        quaternion._onChangeCallback = noop;
        setQuatFromEuler(quaternion, rotation);
        quaternion._onChangeCallback = saved;
        scope._rotDirty = true;
        scope._look = null;
        TN.cmd && TN.cmd.markPose(scope);
      }

      function onQuaternionChange() {
        const saved = rotation._onChangeCallback;
        rotation._onChangeCallback = noop;
        setFromQuaternion(rotation, quaternion);
        rotation._onChangeCallback = saved;
        scope._rotDirty = true;
        scope._look = null;
        TN.cmd && TN.cmd.markPose(scope);
      }

      bindOnChange(position, () => {
        scope._posDirty = true;
        // three.js stores orientation in the quaternion. A later translate
        // (helper.lookAt(normal) then helper.position.copy(hit)) must keep
        // that rotation — not re-aim via lookFrom(newPos, oldTarget).
        scope._look = null;
        TN.cmd && TN.cmd.markPose(scope);
      });
      bindOnChange(rotation, onRotationChange);
      bindOnChange(quaternion, onQuaternionChange);
      bindOnChange(scale, () => {
        scope._scaleDirty = true;
        TN.cmd && TN.cmd.markPose(scope);
      });

      Object.defineProperties(this, {
        position: { configurable: true, enumerable: true, value: position },
        rotation: { configurable: true, enumerable: true, value: rotation },
        quaternion: { configurable: true, enumerable: true, value: quaternion },
        scale: { configurable: true, enumerable: true, value: scale },
        modelViewMatrix: { value: new Matrix4() },
        normalMatrix: { value: new Matrix3() }
      });

      this.matrix = new Matrix4();
      this.matrixWorld = new Matrix4();
      this.matrixAutoUpdate = Object3D.DEFAULT_MATRIX_AUTO_UPDATE;
      this.matrixWorldAutoUpdate = Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE;
      this.matrixWorldNeedsUpdate = false;
      this.layers = new Layers();
      let visible = true;
      Object.defineProperty(this, "visible", {
        configurable: true,
        enumerable: true,
        get() {
          return visible;
        },
        set(value) {
          const on = !!value;
          if (visible === on) return;
          visible = on;
          const h = this._h;
          if (!h) return;
          if (TN.cmd && typeof TN.cmd.setVisible === "function") {
            TN.cmd.setVisible(h, on ? 1 : 0);
          } else {
            const n = native();
            if (n && typeof n.ObjectSetVisible === "function") {
              try {
                n.ObjectSetVisible(h, on ? 1 : 0);
              } catch {
                /* native visibility optional */
              }
            }
          }
        },
      });
      this.castShadow = false;
      this.receiveShadow = false;
      this.frustumCulled = true;
      this.renderOrder = 0;
      this.animations = [];
      this.userData = {};
    }

    onBeforeShadow() {}
    onAfterShadow() {}
    onBeforeRender() {}
    onAfterRender() {}

    applyMatrix4(matrix) {
      if (this.matrixAutoUpdate) this.updateMatrix();
      premultiplyMatrix(this.matrix, matrix);
      decomposeMatrix(this.matrix, this.position, this.quaternion, this.scale);
    }

    applyQuaternion(q) {
      if (typeof this.quaternion.premultiply === 'function') this.quaternion.premultiply(q);
      else quatMultiply(this.quaternion, q, this.quaternion);
      return this;
    }

    setRotationFromAxisAngle(axis, angle) {
      setQuatFromAxisAngle(this.quaternion, axis, angle);
    }

    setRotationFromEuler(euler) {
      setQuatFromEuler(this.quaternion, euler);
    }

    setRotationFromMatrix(m) {
      setQuatFromRotationMatrix(this.quaternion, m);
    }

    setRotationFromQuaternion(q) {
      this.quaternion.copy(q);
    }

    rotateOnAxis(axis, angle) {
      setQuatFromAxisAngle(_q1, axis, angle);
      if (typeof this.quaternion.multiply === 'function') this.quaternion.multiply(_q1);
      else quatMultiply(this.quaternion, this.quaternion, _q1);
      return this;
    }

    rotateOnWorldAxis(axis, angle) {
      setQuatFromAxisAngle(_q1, axis, angle);
      if (typeof this.quaternion.premultiply === 'function') this.quaternion.premultiply(_q1);
      else quatMultiply(this.quaternion, _q1, this.quaternion);
      return this;
    }

    rotateX(angle) {
      return this.rotateOnAxis(_xAxis, angle);
    }

    rotateY(angle) {
      return this.rotateOnAxis(_yAxis, angle);
    }

    rotateZ(angle) {
      return this.rotateOnAxis(_zAxis, angle);
    }

    translateOnAxis(axis, distance) {
      _v1.copy(axis);
      if (typeof _v1.applyQuaternion === 'function') _v1.applyQuaternion(this.quaternion);
      this.position.add(_v1.multiplyScalar(distance));
      return this;
    }

    translateX(distance) {
      return this.translateOnAxis(_xAxis, distance);
    }

    translateY(distance) {
      return this.translateOnAxis(_yAxis, distance);
    }

    translateZ(distance) {
      return this.translateOnAxis(_zAxis, distance);
    }

    localToWorld(vector) {
      this.updateWorldMatrix(true, false);
      return applyMatrix4Vec(vector, this.matrixWorld);
    }

    worldToLocal(vector) {
      this.updateWorldMatrix(true, false);
      _m1.copy(this.matrixWorld);
      invertMatrix(_m1);
      return applyMatrix4Vec(vector, _m1);
    }

    lookAt(x, y, z) {
      if (x && (x.isVector3 || typeof x.x === 'number')) {
        _target.copy(x);
      } else {
        _target.set(x, y, z);
      }
      const parent = this.parent;
      this.updateWorldMatrix(true, false);
      setFromMatrixPosition(_position, this.matrixWorld);
      if (this.isCamera || this.isLight) lookAtMatrix(_m1, _position, _target, this.up);
      else lookAtMatrix(_m1, _target, _position, this.up);
      setQuatFromRotationMatrix(this.quaternion, _m1);
      if (parent) {
        extractRotation(_m1, parent.matrixWorld);
        setQuatFromRotationMatrix(_q1, _m1);
        quatInvert(_q1);
        if (typeof this.quaternion.premultiply === 'function') this.quaternion.premultiply(_q1);
        else quatMultiply(this.quaternion, _q1, this.quaternion);
      }
      this._look = { x: _target.x, y: _target.y, z: _target.z };
      this._lookDirty = true;
      TN.cmd && TN.cmd.markPose(this);
      return this;
    }

    add(object) {
      if (arguments.length > 1) {
        for (let i = 0; i < arguments.length; i++) this.add(arguments[i]);
        return this;
      }
      if (object === this) {
        console.error("THREE.Object3D.add: object can't be added as a child of itself.", object);
        return this;
      }
      if (object && object.isObject3D) {
        object.removeFromParent();
        object.parent = this;
        this.children.push(object);
        object.dispatchEvent(_addedEvent);
        _childaddedEvent.child = object;
        this.dispatchEvent(_childaddedEvent);
        _childaddedEvent.child = null;
        if (!object._h && typeof object.flushSelf === "function") object.flushSelf();
        if (TN.cmd && this._h && object._h) {
          TN.cmd.add(this._h, object._h);
        } else {
          const n = native();
          if (n && this._h && object._h) n.ObjectAdd(this._h, object._h);
        }
      } else {
        console.error('THREE.Object3D.add: object not an instance of THREE.Object3D.', object);
      }
      return this;
    }

    remove(object) {
      if (arguments.length > 1) {
        for (let i = 0; i < arguments.length; i++) this.remove(arguments[i]);
        return this;
      }
      const index = this.children.indexOf(object);
      if (index !== -1) {
        object.parent = null;
        this.children.splice(index, 1);
        object.dispatchEvent(_removedEvent);
        _childremovedEvent.child = object;
        this.dispatchEvent(_childremovedEvent);
        _childremovedEvent.child = null;
        const parentH = this._h;
        const childH = object && object._h;
        if (parentH && childH) {
          const drawable =
            object.isMesh ||
            object.isLine ||
            object.isLineSegments ||
            object.isLineLoop ||
            object.isPoints ||
            object.isSprite;
          if (drawable && typeof TN.releaseHandle === "function") {
            TN.releaseHandle(childH);
            object._h = 0;
          } else if (TN.cmd && typeof TN.cmd.remove === "function") {
            TN.cmd.remove(parentH, childH);
          } else {
            const n = native();
            if (TN.hostHas?.(n, "ObjectRemove")) {
              try {
                n.ObjectRemove(parentH, childH);
              } catch {
                /* native remove optional */
              }
            }
          }
        }
      }
      return this;
    }

    removeFromParent() {
      const parent = this.parent;
      if (parent !== null) parent.remove(this);
      return this;
    }

    clear() {
      return this.remove(...this.children);
    }

    attach(object) {
      this.updateWorldMatrix(true, false);
      _m1.copy(this.matrixWorld);
      invertMatrix(_m1);
      if (object.parent !== null) {
        object.parent.updateWorldMatrix(true, false);
        multiplyMatrices(_m1, _m1, object.parent.matrixWorld);
      }
      object.applyMatrix4(_m1);
      object.removeFromParent();
      object.parent = this;
      this.children.push(object);
      object.updateWorldMatrix(false, true);
      object.dispatchEvent(_addedEvent);
      _childaddedEvent.child = object;
      this.dispatchEvent(_childaddedEvent);
      _childaddedEvent.child = null;
      if (TN.cmd && this._h && object._h) {
        TN.cmd.add(this._h, object._h);
      } else {
        const n = native();
        if (n && this._h && object._h) n.ObjectAdd(this._h, object._h);
      }
      return this;
    }

    getObjectById(id) {
      return this.getObjectByProperty('id', id);
    }

    getObjectByName(name) {
      return this.getObjectByProperty('name', name);
    }

    getObjectByProperty(name, value) {
      if (this[name] === value) return this;
      for (let i = 0, l = this.children.length; i < l; i++) {
        const object = this.children[i].getObjectByProperty(name, value);
        if (object !== undefined) return object;
      }
      return undefined;
    }

    getObjectsByProperty(name, value, result = []) {
      if (this[name] === value) result.push(this);
      const children = this.children;
      for (let i = 0, l = children.length; i < l; i++) {
        children[i].getObjectsByProperty(name, value, result);
      }
      return result;
    }

    getWorldPosition(target) {
      this.updateWorldMatrix(true, false);
      return setFromMatrixPosition(target, this.matrixWorld);
    }

    getWorldQuaternion(target) {
      this.updateWorldMatrix(true, false);
      decomposeMatrix(this.matrixWorld, _position, target, _scale);
      return target;
    }

    getWorldScale(target) {
      this.updateWorldMatrix(true, false);
      decomposeMatrix(this.matrixWorld, _position, _quaternion, target);
      return target;
    }

    getWorldDirection(target) {
      this.updateWorldMatrix(true, false);
      const e = this.matrixWorld.elements;
      return target.set(e[8], e[9], e[10]).normalize();
    }

    raycast() {}

    traverse(callback) {
      callback(this);
      const children = this.children;
      for (let i = 0, l = children.length; i < l; i++) children[i].traverse(callback);
    }

    traverseVisible(callback) {
      if (this.visible === false) return;
      callback(this);
      const children = this.children;
      for (let i = 0, l = children.length; i < l; i++) children[i].traverseVisible(callback);
    }

    traverseAncestors(callback) {
      const parent = this.parent;
      if (parent !== null) {
        callback(parent);
        parent.traverseAncestors(callback);
      }
    }

    updateMatrix() {
      composeMatrix(this.matrix, this.position, this.quaternion, this.scale);
      this.matrixWorldNeedsUpdate = true;
    }

    updateMatrixWorld(force) {
      if (this.matrixAutoUpdate) this.updateMatrix();
      if (this.matrixWorldNeedsUpdate || force) {
        if (this.matrixWorldAutoUpdate === true) {
          if (this.parent === null) this.matrixWorld.copy(this.matrix);
          else multiplyMatrices(this.matrixWorld, this.parent.matrixWorld, this.matrix);
        }
        this.matrixWorldNeedsUpdate = false;
        force = true;
      }
      const children = this.children;
      for (let i = 0, l = children.length; i < l; i++) children[i].updateMatrixWorld(force);
    }

    updateWorldMatrix(updateParents, updateChildren) {
      const parent = this.parent;
      if (updateParents === true && parent !== null) parent.updateWorldMatrix(true, false);
      if (this.matrixAutoUpdate) this.updateMatrix();
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else multiplyMatrices(this.matrixWorld, this.parent.matrixWorld, this.matrix);
      }
      if (updateChildren === true) {
        const children = this.children;
        for (let i = 0, l = children.length; i < l; i++) children[i].updateWorldMatrix(false, true);
      }
    }

    flushSelf() {
      if (!this._h) return this;
      const posDirty = this._posDirty;
      const rotDirty = this._rotDirty;
      const scaleDirty = this._scaleDirty;
      const lookDirty = this._lookDirty;
      if (!posDirty && !rotDirty && !scaleDirty && !lookDirty) return this;
      const px = this.position.x;
      const py = this.position.y;
      const pz = this.position.z;
      if (TN.cmd) {
        if (this._look && (lookDirty || posDirty)) {
          TN.cmd.lookFrom(this._h, px, py, pz, this._look.x, this._look.y, this._look.z);
        } else if (posDirty || rotDirty || scaleDirty) {
          TN.cmd.setPose(
            this._h,
            px, py, pz,
            this.rotation.x, this.rotation.y, this.rotation.z,
            this.scale.x, this.scale.y, this.scale.z
          );
        }
      } else {
        const n = native();
        if (n) {
          if (this._look && (lookDirty || posDirty)) {
            if (n.ObjectLookFrom) n.ObjectLookFrom(this._h, px, py, pz, this._look.x, this._look.y, this._look.z);
            else {
              if (posDirty && n.ObjectSetPosition) n.ObjectSetPosition(this._h, px, py, pz);
              if (n.ObjectLookAt) n.ObjectLookAt(this._h, this._look.x, this._look.y, this._look.z);
            }
          } else if (posDirty && n.ObjectSetPosition) {
            n.ObjectSetPosition(this._h, px, py, pz);
          }
          if (rotDirty && !this._look && n.ObjectSetRotation) {
            n.ObjectSetRotation(this._h, this.rotation.x, this.rotation.y, this.rotation.z);
          }
          if (scaleDirty && n.ObjectSetScale) {
            n.ObjectSetScale(this._h, this.scale.x, this.scale.y, this.scale.z);
          }
        }
      }
      this._posDirty = false;
      this._rotDirty = false;
      this._scaleDirty = false;
      this._lookDirty = false;
      return this;
    }

    flush() {
      this.flushSelf();
      if (!TN.cmd) {
        const children = this.children;
        for (let i = 0, l = children.length; i < l; i++) {
          if (children[i].flush) children[i].flush();
        }
      }
      return this;
    }

    toJSON(meta) {
      const isRootObject = meta === undefined || typeof meta === 'string';
      const output = {};
      if (isRootObject) {
        meta = {
          geometries: {},
          materials: {},
          textures: {},
          images: {},
          shapes: {},
          skeletons: {},
          animations: {},
          nodes: {}
        };
        output.metadata = { version: 4.6, type: 'Object', generator: 'Object3D.toJSON' };
      }
      const object = {};
      object.uuid = this.uuid;
      object.type = this.type;
      if (this.name !== '') object.name = this.name;
      if (this.castShadow === true) object.castShadow = true;
      if (this.receiveShadow === true) object.receiveShadow = true;
      if (this.visible === false) object.visible = false;
      if (this.frustumCulled === false) object.frustumCulled = false;
      if (this.renderOrder !== 0) object.renderOrder = this.renderOrder;
      if (Object.keys(this.userData).length > 0) object.userData = this.userData;
      object.layers = this.layers.mask;
      object.matrix = this.matrix.toArray ? this.matrix.toArray() : this.matrix.elements.slice();
      object.up = this.up.toArray ? this.up.toArray() : [this.up.x, this.up.y, this.up.z];
      if (this.matrixAutoUpdate === false) object.matrixAutoUpdate = false;
      if (this.children.length > 0) {
        object.children = [];
        for (let i = 0; i < this.children.length; i++) {
          object.children.push(this.children[i].toJSON(meta).object);
        }
      }
      if (isRootObject) output.object = object;
      else output.object = object;
      return output;
    }

    clone(recursive) {
      return new this.constructor().copy(this, recursive);
    }

    copy(source, recursive = true) {
      this.name = source.name;
      this.up.copy(source.up);
      this.position.copy(source.position);
      this.rotation.order = source.rotation.order;
      this.quaternion.copy(source.quaternion);
      this.scale.copy(source.scale);
      this.matrix.copy(source.matrix);
      this.matrixWorld.copy(source.matrixWorld);
      this.matrixAutoUpdate = source.matrixAutoUpdate;
      this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
      this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
      this.layers.mask = source.layers.mask;
      this.visible = source.visible;
      this.castShadow = source.castShadow;
      this.receiveShadow = source.receiveShadow;
      this.frustumCulled = source.frustumCulled;
      this.renderOrder = source.renderOrder;
      this.animations = source.animations.slice();
      this.userData = JSON.parse(JSON.stringify(source.userData));
      if (recursive === true) {
        for (let i = 0; i < source.children.length; i++) this.add(source.children[i].clone());
      }
      return this;
    }
  }

  Object3D.DEFAULT_UP = new Vector3(0, 1, 0);
  Object3D.DEFAULT_MATRIX_AUTO_UPDATE = true;
  Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;

  const _geoObj = new Object3D();
  let _geometryId = 0;

  class BufferGeometry extends EventDispatcher {
    constructor() {
      super();
      this.isBufferGeometry = true;
      Object.defineProperty(this, 'id', { value: _geometryId++ });
      this.uuid = generateUUID();
      this.name = '';
      this.type = 'BufferGeometry';
      this.index = null;
      this.indirect = null;
      this.attributes = {};
      this.morphAttributes = {};
      this.morphTargetsRelative = false;
      this.groups = [];
      this.boundingBox = null;
      this.boundingSphere = null;
      this.drawRange = { start: 0, count: Infinity };
      this.userData = {};
      this._h = 0;
    }

    getIndex() {
      return this.index;
    }

    setIndex(index) {
      if (Array.isArray(index)) {
        this.index = new (arrayNeedsUint32(index) ? Uint32BufferAttribute : Uint16BufferAttribute)(index, 1);
      } else if (index && !index.isBufferAttribute && !index.isInterleavedBufferAttribute) {
        const arr = ArrayBuffer.isView(index) ? index : index.array;
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

    setIndirect(indirect) {
      this.indirect = indirect;
      return this;
    }

    getIndirect() {
      return this.indirect;
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
      this._h = 0;
      return this;
    }

    deleteAttribute(name) {
      delete this.attributes[name];
      this._h = 0;
      return this;
    }

    hasAttribute(name) {
      return this.attributes[name] !== undefined;
    }

    addGroup(start, count, materialIndex = 0) {
      this.groups.push({ start, count, materialIndex });
      return this;
    }

    clearGroups() {
      this.groups = [];
      return this;
    }

    setDrawRange(start, count) {
      this.drawRange.start = start;
      this.drawRange.count = count;
    }

    applyMatrix4(matrix) {
      const position = this.attributes.position;
      if (position !== undefined) {
        position.applyMatrix4(matrix);
        position.needsUpdate = true;
      }
      const normal = this.attributes.normal;
      if (normal !== undefined) {
        normal.applyNormalMatrix(getNormalMatrix(matrix));
        normal.needsUpdate = true;
      }
      const tangent = this.attributes.tangent;
      if (tangent !== undefined) {
        tangent.transformDirection(matrix);
        tangent.needsUpdate = true;
      }
      if (this.boundingBox !== null) this.computeBoundingBox();
      if (this.boundingSphere !== null) this.computeBoundingSphere();
      this._h = 0;
      return this;
    }

    applyQuaternion(q) {
      setMatrixFromQuat(_geoRot, q);
      this.applyMatrix4(_geoRot);
      return this;
    }

    rotateX(angle) {
      return this.applyMatrix4(makeRotationX(_geoRot, angle));
    }

    rotateY(angle) {
      return this.applyMatrix4(makeRotationY(_geoRot, angle));
    }

    rotateZ(angle) {
      return this.applyMatrix4(makeRotationZ(_geoRot, angle));
    }

    translate(x, y, z) {
      return this.applyMatrix4(makeTranslation(_geoRot, x, y, z));
    }

    scale(x, y, z) {
      return this.applyMatrix4(makeScale(_geoRot, x, y, z));
    }

    lookAt(vector) {
      _geoObj.lookAt(vector);
      _geoObj.updateMatrix();
      this.applyMatrix4(_geoObj.matrix);
      return this;
    }

    center() {
      this.computeBoundingBox();
      this.boundingBox.getCenter(_offset);
      _offset.x = -_offset.x;
      _offset.y = -_offset.y;
      _offset.z = -_offset.z;
      this.translate(_offset.x, _offset.y, _offset.z);
      return this;
    }

    setFromPoints(points) {
      const positionAttribute = this.getAttribute('position');
      if (positionAttribute === undefined) {
        const position = [];
        for (let i = 0, l = points.length; i < l; i++) {
          const point = points[i];
          position.push(point.x, point.y, point.z || 0);
        }
        this.setAttribute('position', new Float32BufferAttribute(position, 3));
      } else {
        for (let i = 0, l = positionAttribute.count; i < l; i++) {
          const point = points[i];
          positionAttribute.setXYZ(i, point.x, point.y, point.z || 0);
        }
        positionAttribute.needsUpdate = true;
      }
      return this;
    }

    computeBoundingBox() {
      if (this.boundingBox === null) this.boundingBox = new Box3();
      const position = this.attributes.position;
      const morphAttributesPosition = this.morphAttributes.position;
      if (position !== undefined) {
        if (typeof this.boundingBox.setFromBufferAttribute === 'function') {
          this.boundingBox.setFromBufferAttribute(position);
        } else {
          LocalBox3.prototype.setFromBufferAttribute.call(this.boundingBox, position);
        }
        if (morphAttributesPosition) {
          for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
            const morphAttribute = morphAttributesPosition[i];
            _box.setFromBufferAttribute(morphAttribute);
            if (this.morphTargetsRelative) {
              _v1.set(this.boundingBox.min.x + _box.min.x, this.boundingBox.min.y + _box.min.y, this.boundingBox.min.z + _box.min.z);
              this.boundingBox.expandByPoint(_v1);
              _v1.set(this.boundingBox.max.x + _box.max.x, this.boundingBox.max.y + _box.max.y, this.boundingBox.max.z + _box.max.z);
              this.boundingBox.expandByPoint(_v1);
            } else {
              this.boundingBox.expandByPoint(_box.min);
              this.boundingBox.expandByPoint(_box.max);
            }
          }
        }
      } else if (this.boundingBox.makeEmpty) {
        this.boundingBox.makeEmpty();
      }
    }

    computeBoundingSphere() {
      if (this.boundingSphere === null) this.boundingSphere = new Sphere();
      const position = this.attributes.position;
      const morphAttributesPosition = this.morphAttributes.position;
      if (position) {
        const center = this.boundingSphere.center;
        _box.setFromBufferAttribute(position);
        if (morphAttributesPosition) {
          for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
            const morphAttribute = morphAttributesPosition[i];
            _boxMorph.setFromBufferAttribute(morphAttribute);
            if (this.morphTargetsRelative) {
              _v1.set(_box.min.x + _boxMorph.min.x, _box.min.y + _boxMorph.min.y, _box.min.z + _boxMorph.min.z);
              _box.expandByPoint(_v1);
              _v1.set(_box.max.x + _boxMorph.max.x, _box.max.y + _boxMorph.max.y, _box.max.z + _boxMorph.max.z);
              _box.expandByPoint(_v1);
            } else {
              _box.expandByPoint(_boxMorph.min);
              _box.expandByPoint(_boxMorph.max);
            }
          }
        }
        _box.getCenter(center);
        let maxRadiusSq = 0;
        for (let i = 0, il = position.count; i < il; i++) {
          vecFromAttr(_v1, position, i);
          maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_v1));
        }
        if (morphAttributesPosition) {
          for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
            const morphAttribute = morphAttributesPosition[i];
            for (let j = 0, jl = morphAttribute.count; j < jl; j++) {
              vecFromAttr(_v1, morphAttribute, j);
              if (this.morphTargetsRelative) {
                vecFromAttr(_offset, position, j);
                _v1.add(_offset);
              }
              maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_v1));
            }
          }
        }
        this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
      }
      return this;
    }

    computeVertexNormals() {
      const index = this.index;
      const positionAttribute = this.getAttribute('position');
      if (positionAttribute === undefined) return;
      let normalAttribute = this.getAttribute('normal');
      if (normalAttribute === undefined) {
        normalAttribute = new BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
        this.setAttribute('normal', normalAttribute);
      } else {
        for (let i = 0, il = normalAttribute.count; i < il; i++) normalAttribute.setXYZ(i, 0, 0, 0);
      }
      const pA = new Vector3();
      const pB = new Vector3();
      const pC = new Vector3();
      const nA = new Vector3();
      const nB = new Vector3();
      const nC = new Vector3();
      const cb = new Vector3();
      const ab = new Vector3();
      if (index) {
        for (let i = 0, il = index.count; i < il; i += 3) {
          const vA = index.getX(i + 0);
          const vB = index.getX(i + 1);
          const vC = index.getX(i + 2);
          vecFromAttr(pA, positionAttribute, vA);
          vecFromAttr(pB, positionAttribute, vB);
          vecFromAttr(pC, positionAttribute, vC);
          cb.subVectors(pC, pB);
          ab.subVectors(pA, pB);
          cb.cross(ab);
          vecFromAttr(nA, normalAttribute, vA);
          vecFromAttr(nB, normalAttribute, vB);
          vecFromAttr(nC, normalAttribute, vC);
          nA.add(cb);
          nB.add(cb);
          nC.add(cb);
          normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z);
          normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z);
          normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
        }
      } else {
        for (let i = 0, il = positionAttribute.count; i < il; i += 3) {
          vecFromAttr(pA, positionAttribute, i + 0);
          vecFromAttr(pB, positionAttribute, i + 1);
          vecFromAttr(pC, positionAttribute, i + 2);
          cb.subVectors(pC, pB);
          ab.subVectors(pA, pB);
          cb.cross(ab);
          normalAttribute.setXYZ(i + 0, cb.x, cb.y, cb.z);
          normalAttribute.setXYZ(i + 1, cb.x, cb.y, cb.z);
          normalAttribute.setXYZ(i + 2, cb.x, cb.y, cb.z);
        }
      }
      this.normalizeNormals();
      normalAttribute.needsUpdate = true;
      this._h = 0;
    }

    normalizeNormals() {
      const normals = this.attributes.normal;
      if (!normals) return;
      for (let i = 0, il = normals.count; i < il; i++) {
        vecFromAttr(_v1, normals, i);
        _v1.normalize();
        normals.setXYZ(i, _v1.x, _v1.y, _v1.z);
      }
    }

    toNonIndexed() {
      function convertBufferAttribute(attribute, indices) {
        const array = attribute.array;
        const itemSize = attribute.itemSize;
        const normalized = attribute.normalized;
        const array2 = new array.constructor(indices.length * itemSize);
        let index = 0;
        let index2 = 0;
        for (let i = 0, l = indices.length; i < l; i++) {
          if (attribute.isInterleavedBufferAttribute) {
            index = indices[i] * attribute.data.stride + attribute.offset;
          } else {
            index = indices[i] * itemSize;
          }
          for (let j = 0; j < itemSize; j++) array2[index2++] = array[index++];
        }
        return new BufferAttribute(array2, itemSize, normalized);
      }
      if (this.index === null) {
        console.warn('THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.');
        return this;
      }
      const geometry2 = new BufferGeometry();
      const indices = this.index.array;
      const attributes = this.attributes;
      for (const name in attributes) {
        geometry2.setAttribute(name, convertBufferAttribute(attributes[name], indices));
      }
      const morphAttributes = this.morphAttributes;
      for (const name in morphAttributes) {
        const morphArray = [];
        const morphAttribute = morphAttributes[name];
        for (let i = 0, il = morphAttribute.length; i < il; i++) {
          morphArray.push(convertBufferAttribute(morphAttribute[i], indices));
        }
        geometry2.morphAttributes[name] = morphArray;
      }
      geometry2.morphTargetsRelative = this.morphTargetsRelative;
      const groups = this.groups;
      for (let i = 0, l = groups.length; i < l; i++) {
        const group = groups[i];
        geometry2.addGroup(group.start, group.count, group.materialIndex);
      }
      return geometry2;
    }

    clone() {
      return new this.constructor().copy(this);
    }

    copy(source) {
      this.index = null;
      this.attributes = {};
      this.morphAttributes = {};
      this.groups = [];
      this.boundingBox = null;
      this.boundingSphere = null;
      const data = {};
      this.name = source.name;
      const index = source.index;
      if (index !== null) this.setIndex(index.clone(data));
      const attributes = source.attributes;
      for (const name in attributes) this.setAttribute(name, attributes[name].clone(data));
      const morphAttributes = source.morphAttributes;
      for (const name in morphAttributes) {
        const array = [];
        const morphAttribute = morphAttributes[name];
        for (let i = 0, l = morphAttribute.length; i < l; i++) array.push(morphAttribute[i].clone(data));
        this.morphAttributes[name] = array;
      }
      this.morphTargetsRelative = source.morphTargetsRelative;
      const groups = source.groups;
      for (let i = 0, l = groups.length; i < l; i++) {
        const group = groups[i];
        this.addGroup(group.start, group.count, group.materialIndex);
      }
      if (source.boundingBox !== null) this.boundingBox = source.boundingBox.clone();
      if (source.boundingSphere !== null) this.boundingSphere = source.boundingSphere.clone();
      if (source.drawRange) {
        this.drawRange.start = source.drawRange.start;
        this.drawRange.count = source.drawRange.count;
      }
      this.userData = source.userData;
      if (source.parameters) this.parameters = { ...source.parameters };
      this._h = 0;
      return this;
    }

    toJSON() {
      const data = {
        metadata: { version: 4.6, type: 'BufferGeometry', generator: 'BufferGeometry.toJSON' }
      };
      data.uuid = this.uuid;
      data.type = this.type;
      if (this.name !== '') data.name = this.name;
      if (this.parameters !== undefined) {
        const parameters = this.parameters;
        for (const key in parameters) {
          if (parameters[key] !== undefined) data[key] = parameters[key];
        }
        return data;
      }
      data.data = { attributes: {} };
      const index = this.index;
      if (index !== null) {
        data.data.index = {
          type: index.array.constructor.name,
          array: Array.prototype.slice.call(index.array)
        };
      }
      const attributes = this.attributes;
      for (const key in attributes) data.data.attributes[key] = attributes[key].toJSON();
      const groups = this.groups;
      if (groups.length > 0) data.data.groups = JSON.parse(JSON.stringify(groups));
      const boundingSphere = this.boundingSphere;
      if (boundingSphere !== null) {
        data.data.boundingSphere = {
          center: boundingSphere.center.toArray ? boundingSphere.center.toArray() : [boundingSphere.center.x, boundingSphere.center.y, boundingSphere.center.z],
          radius: boundingSphere.radius
        };
      }
      return data;
    }

    dispose() {
      this.dispatchEvent({ type: 'dispose' });
      if (this._h && typeof TN.releaseHandle === "function") {
        TN.releaseHandle(this._h);
        this._h = 0;
        this._nativeId = 0;
      }
    }
  }

  class InstancedBufferGeometry extends BufferGeometry {
    constructor() {
      super();
      this.isInstancedBufferGeometry = true;
      this.type = 'InstancedBufferGeometry';
      this.instanceCount = Infinity;
    }
    copy(source) {
      super.copy(source);
      this.instanceCount = source.instanceCount;
      return this;
    }
    toJSON() {
      const data = super.toJSON();
      data.instanceCount = this.instanceCount;
      data.isInstancedBufferGeometry = true;
      return data;
    }
  }

  class Scene extends Object3D {
    constructor() {
      let handle = 0;
      if (TN.cmd) {
        handle = TN.cmd.alloc();
        TN.cmd.sceneCreate(handle);
      } else {
        const n = native();
        handle = n ? n.SceneCreate() : 0;
      }
      super(handle);
      this.isScene = true;
      this.type = 'Scene';
      this._background = null;
      this.environment = null;
      this._fog = null;
      this.backgroundBlurriness = 0;
      this.backgroundIntensity = 1;
      this.backgroundRotation = new Euler();
      this.environmentIntensity = 1;
      this.environmentRotation = new Euler();
      this.overrideMaterial = null;
    }
    get background() {
      return this._background;
    }
    set background(value) {
      this._background = value;
      if (this._h && isColorLike(value)) {
        if (TN.cmd) TN.cmd.sceneBg(this._h, toHex(value));
        else {
          const n = native();
          if (n) n.SceneSetBackground(this._h, toHex(value));
        }
      }
    }
    get fog() {
      return this._fog;
    }
    set fog(value) {
      this._fog = value;
      if (!this._h || !value) return;
      try {
        if (TN.cmd) {
          if (value.isFogExp2) TN.cmd.sceneFogExp2(this._h, toHex(value.color), value.density);
          else if (value.isFog) TN.cmd.sceneFog(this._h, toHex(value.color), value.near, value.far);
        } else {
          const n = native();
          if (!n) return;
          if (value.isFogExp2 && typeof n.SceneSetFogExp2 === 'function') {
            n.SceneSetFogExp2(this._h, toHex(value.color), value.density);
          } else if (value.isFog && typeof n.SceneSetFog === 'function') {
            n.SceneSetFog(this._h, toHex(value.color), value.near, value.far);
          }
        }
      } catch {
        /* native fog optional */
      }
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      if (source.background !== null && source.background !== undefined) {
        this.background = source.background.clone ? source.background.clone() : source.background;
      }
      if (source.environment !== null && source.environment !== undefined) {
        this.environment = source.environment.clone ? source.environment.clone() : source.environment;
      }
      if (source.fog !== null && source.fog !== undefined) this.fog = source.fog.clone();
      this.backgroundBlurriness = source.backgroundBlurriness;
      this.backgroundIntensity = source.backgroundIntensity;
      if (source.backgroundRotation) this.backgroundRotation.copy(source.backgroundRotation);
      this.environmentIntensity = source.environmentIntensity;
      if (source.environmentRotation) this.environmentRotation.copy(source.environmentRotation);
      if (source.overrideMaterial !== null && source.overrideMaterial !== undefined) {
        this.overrideMaterial = source.overrideMaterial.clone ? source.overrideMaterial.clone() : source.overrideMaterial;
      }
      this.matrixAutoUpdate = source.matrixAutoUpdate;
      return this;
    }
  }

  class Fog {
    constructor(color, near = 1, far = 1000) {
      this.isFog = true;
      this.name = '';
      this.color = new Color(color);
      this.near = near;
      this.far = far;
    }
    clone() {
      return new Fog(this.color, this.near, this.far);
    }
    toJSON() {
      return {
        type: 'Fog',
        name: this.name,
        color: this.color.getHex(),
        near: this.near,
        far: this.far
      };
    }
  }

  class FogExp2 {
    constructor(color, density = 0.00025) {
      this.isFogExp2 = true;
      this.name = '';
      this.color = new Color(color);
      this.density = density;
    }
    clone() {
      return new FogExp2(this.color, this.density);
    }
    toJSON() {
      return {
        type: 'FogExp2',
        name: this.name,
        color: this.color.getHex(),
        density: this.density
      };
    }
  }

  class Raycaster {
    constructor(origin, direction, near = 0, far = Infinity) {
      this.ray = new Ray(origin, direction);
      this.near = near;
      this.far = far;
      this.camera = null;
      this.layers = new Layers();
      this.params = {
        Mesh: {},
        Line: { threshold: 1 },
        LOD: {},
        Points: { threshold: 1 },
        Sprite: {}
      };
    }
    set(origin, direction) {
      this.ray.set(origin, direction);
    }
    setFromCamera(coords, camera) {
      if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();
      if (camera.isPerspectiveCamera) {
        setFromMatrixPosition(this.ray.origin, camera.matrixWorld);
        this.ray.direction.set(coords.x, coords.y, 0.5);
        if (typeof this.ray.direction.unproject === 'function') this.ray.direction.unproject(camera);
        this.ray.direction.sub(this.ray.origin).normalize();
        this.camera = camera;
      } else if (camera.isOrthographicCamera) {
        this.ray.origin.set(coords.x, coords.y, (camera.near + camera.far) / (camera.near - camera.far));
        if (typeof this.ray.origin.unproject === 'function') this.ray.origin.unproject(camera);
        this.ray.direction.set(0, 0, -1);
        if (typeof this.ray.direction.transformDirection === 'function') {
          this.ray.direction.transformDirection(camera.matrixWorld);
        }
        this.camera = camera;
      } else {
        console.error('THREE.Raycaster: Unsupported camera type: ' + camera.type);
      }
    }
    setFromXRController(controller) {
      if (_m2.identity) _m2.identity();
      extractRotation(_m2, controller.matrixWorld);
      setFromMatrixPosition(this.ray.origin, controller.matrixWorld);
      this.ray.direction.set(0, 0, -1);
      applyMatrix4Vec(this.ray.direction, _m2);
      return this;
    }
    intersectObject(object, recursive = true, intersects = []) {
      intersect(object, this, intersects, recursive);
      intersects.sort(ascSort);
      return intersects;
    }
    intersectObjects(objects, recursive = true, intersects = []) {
      for (let i = 0, l = objects.length; i < l; i++) {
        intersect(objects[i], this, intersects, recursive);
      }
      intersects.sort(ascSort);
      return intersects;
    }
  }

  function ascSort(a, b) {
    return a.distance - b.distance;
  }

  function intersect(object, raycaster, intersects, recursive) {
    let propagate = true;
    if (object.layers.test(raycaster.layers)) {
      const result = object.raycast(raycaster, intersects);
      if (result === false) propagate = false;
    }
    if (propagate === true && recursive === true) {
      const children = object.children;
      for (let i = 0, l = children.length; i < l; i++) {
        intersect(children[i], raycaster, intersects, true);
      }
    }
  }

  TN.EventDispatcher = EventDispatcher;
  TN.Layers = Layers;
  TN.Clock = Clock;
  TN.Timer = Timer;
  TN.Object3D = Object3D;
  TN.Scene = Scene;
  TN.Fog = Fog;
  TN.FogExp2 = FogExp2;
  TN.BufferAttribute = BufferAttribute;
  TN.Float32BufferAttribute = Float32BufferAttribute;
  TN.Float16BufferAttribute = Float16BufferAttribute;
  TN.Uint8BufferAttribute = Uint8BufferAttribute;
  TN.Uint16BufferAttribute = Uint16BufferAttribute;
  TN.Uint32BufferAttribute = Uint32BufferAttribute;
  TN.Int8BufferAttribute = Int8BufferAttribute;
  TN.Int16BufferAttribute = Int16BufferAttribute;
  TN.Int32BufferAttribute = Int32BufferAttribute;
  TN.InstancedBufferAttribute = InstancedBufferAttribute;
  TN.BufferGeometry = BufferGeometry;
  TN.InstancedBufferGeometry = InstancedBufferGeometry;
  TN.InterleavedBuffer = InterleavedBuffer;
  TN.InterleavedBufferAttribute = InterleavedBufferAttribute;
  TN.Raycaster = Raycaster;
  TN.Uniform = Uniform;
  TN.Controls = Controls;
})(globalThis.__TN = globalThis.__TN || {});
