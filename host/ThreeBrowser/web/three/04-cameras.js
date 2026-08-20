(function (TN) {
  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  const Object3D = TN.Object3D;
  const Matrix4 = TN.Matrix4;
  const Vector2 = TN.Vector2;
  const Vector3 = TN.Vector3;
  const MathUtils = TN.MathUtils || {};
  const DEG2RAD = MathUtils.DEG2RAD ?? Math.PI / 180;
  const RAD2DEG = MathUtils.RAD2DEG ?? 180 / Math.PI;
  const WebGLCoordinateSystem = TN.WebGLCoordinateSystem ?? 2000;
  const WebGPUCoordinateSystem = TN.WebGPUCoordinateSystem ?? 2001;

  const _v3 = new Vector3();
  const _minTarget = new Vector2();
  const _maxTarget = new Vector2();
  const _eyeLeft = new Matrix4();
  const _eyeRight = new Matrix4();
  const _stereoProjection = new Matrix4();

  function invertMatrix4(m) {
    if (typeof m.invert === "function") {
      m.invert();
      return m;
    }
    const te = m.elements;
    const n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3];
    const n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
    const n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11];
    const n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    const t1 = n11 * n22 - n21 * n12;
    const t2 = n11 * n32 - n31 * n12;
    const t3 = n11 * n42 - n41 * n12;
    const t4 = n21 * n32 - n31 * n22;
    const t5 = n21 * n42 - n41 * n22;
    const t6 = n31 * n42 - n41 * n32;
    const t7 = n13 * n24 - n23 * n14;
    const t8 = n13 * n34 - n33 * n14;
    const t9 = n13 * n44 - n43 * n14;
    const t10 = n23 * n34 - n33 * n24;
    const t11 = n23 * n44 - n43 * n24;
    const t12 = n33 * n44 - n43 * n34;
    const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;
    if (det === 0) {
      for (let i = 0; i < 16; i++) te[i] = 0;
      return m;
    }
    const detInv = 1 / det;
    te[0] = (n22 * t12 - n32 * t11 + n42 * t10) * detInv;
    te[1] = (n31 * t11 - n21 * t12 - n41 * t10) * detInv;
    te[2] = (n24 * t6 - n34 * t5 + n44 * t4) * detInv;
    te[3] = (n33 * t5 - n23 * t6 - n43 * t4) * detInv;
    te[4] = (n32 * t9 - n12 * t12 - n42 * t8) * detInv;
    te[5] = (n11 * t12 - n31 * t9 + n41 * t8) * detInv;
    te[6] = (n34 * t3 - n14 * t6 - n44 * t2) * detInv;
    te[7] = (n13 * t6 - n33 * t3 + n43 * t2) * detInv;
    te[8] = (n12 * t11 - n22 * t9 + n42 * t7) * detInv;
    te[9] = (n21 * t9 - n11 * t11 - n41 * t7) * detInv;
    te[10] = (n14 * t5 - n24 * t3 + n44 * t1) * detInv;
    te[11] = (n23 * t3 - n13 * t5 - n43 * t1) * detInv;
    te[12] = (n22 * t8 - n12 * t10 - n32 * t7) * detInv;
    te[13] = (n11 * t10 - n21 * t8 + n31 * t7) * detInv;
    te[14] = (n24 * t2 - n14 * t4 - n34 * t1) * detInv;
    te[15] = (n13 * t4 - n23 * t2 + n33 * t1) * detInv;
    return m;
  }

  function copyInverse(src, dst) {
    dst.copy(src);
    return invertMatrix4(dst);
  }

  function makePerspectiveMatrix(matrix, left, right, top, bottom, near, far, coordinateSystem, reversedDepth) {
    if (typeof matrix.makePerspective === "function") {
      return matrix.makePerspective(
        left, right, top, bottom, near, far, coordinateSystem, reversedDepth
      );
    }
    const te = matrix.elements;
    const x = (2 * near) / (right - left);
    const y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    let c;
    let d;
    if (reversedDepth) {
      c = near / (far - near);
      d = (far * near) / (far - near);
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      c = -far / (far - near);
      d = (-far * near) / (far - near);
    } else {
      c = -(far + near) / (far - near);
      d = (-2 * far * near) / (far - near);
    }
    te[0] = x; te[4] = 0; te[8] = a; te[12] = 0;
    te[1] = 0; te[5] = y; te[9] = b; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = -1; te[15] = 0;
    return matrix;
  }

  function makeOrthographicMatrix(matrix, left, right, top, bottom, near, far, coordinateSystem, reversedDepth) {
    if (typeof matrix.makeOrthographic === "function") {
      return matrix.makeOrthographic(
        left, right, top, bottom, near, far, coordinateSystem, reversedDepth
      );
    }
    const te = matrix.elements;
    const x = 2 / (right - left);
    const y = 2 / (top - bottom);
    const a = -(right + left) / (right - left);
    const b = -(top + bottom) / (top - bottom);
    let c;
    let d;
    if (reversedDepth) {
      c = 1 / (far - near);
      d = far / (far - near);
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      c = -1 / (far - near);
      d = -near / (far - near);
    } else {
      c = -2 / (far - near);
      d = -(far + near) / (far - near);
    }
    te[0] = x; te[4] = 0; te[8] = 0; te[12] = a;
    te[1] = 0; te[5] = y; te[9] = 0; te[13] = b;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return matrix;
  }

  function multiplyMatrix4(a, b) {
    if (typeof a.multiply === "function") return a.multiply(b);
    const ae = a.elements.slice();
    const be = b.elements;
    const te = a.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
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
    return a;
  }

  function applyMatrix4Vec3(v, m) {
    if (typeof v.applyMatrix4 === "function") return v.applyMatrix4(m);
    const e = m.elements;
    const x = v.x, y = v.y, z = v.z;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const iw = w !== 0 ? 1 / w : 1;
    v.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * iw;
    v.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw;
    v.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * iw;
    return v;
  }

  function ensureView(camera) {
    if (camera.view === null) {
      camera.view = {
        enabled: true,
        fullWidth: 1,
        fullHeight: 1,
        offsetX: 0,
        offsetY: 0,
        width: 1,
        height: 1,
      };
    }
    return camera.view;
  }

  class Camera extends Object3D {
    constructor(handle) {
      super(handle);
      if (handle != null) this._h = handle;
      this.isCamera = true;
      this.type = "Camera";
      this.zoom = 1;
      this.near = 0.1;
      this.far = 2000;
      this.matrixWorldInverse = new Matrix4();
      this.projectionMatrix = new Matrix4();
      this.projectionMatrixInverse = new Matrix4();
      this.coordinateSystem = WebGLCoordinateSystem;
      this._reversedDepth = false;
    }

    get reversedDepth() {
      return this._reversedDepth;
    }

    copy(source, recursive) {
      if (typeof super.copy === "function") super.copy(source, recursive);
      this.matrixWorldInverse.copy(source.matrixWorldInverse);
      this.projectionMatrix.copy(source.projectionMatrix);
      this.projectionMatrixInverse.copy(source.projectionMatrixInverse);
      this.coordinateSystem = source.coordinateSystem;
      this.zoom = source.zoom;
      this.near = source.near;
      this.far = source.far;
      return this;
    }

    getWorldDirection(target) {
      if (typeof super.getWorldDirection === "function") {
        const dir = super.getWorldDirection(target);
        return typeof dir.negate === "function" ? dir.negate() : dir.multiplyScalar(-1);
      }
      const e = this.matrixWorld.elements;
      return target.set(-e[8], -e[9], -e[10]).normalize();
    }

    updateMatrixWorld(force) {
      if (typeof super.updateMatrixWorld === "function") super.updateMatrixWorld(force);
      copyInverse(this.matrixWorld, this.matrixWorldInverse);
    }

    updateWorldMatrix(updateParents, updateChildren, force) {
      if (typeof super.updateWorldMatrix === "function") {
        super.updateWorldMatrix(updateParents, updateChildren, force);
      } else if (typeof super.updateMatrixWorld === "function") {
        super.updateMatrixWorld(force);
      }
      copyInverse(this.matrixWorld, this.matrixWorldInverse);
    }

    clone() {
      return new this.constructor().copy(this);
    }

    updateProjectionMatrix() {}
  }

  class PerspectiveCamera extends Camera {
    constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
      let handle = 0;
      if (TN.cmd) {
        handle = TN.cmd.alloc();
        TN.cmd.perspCam(handle, fov, aspect, near, far);
      } else {
        const n = native();
        handle = n ? n.PerspectiveCameraCreate(fov, aspect, near, far) : 0;
      }
      super(handle);
      this.isPerspectiveCamera = true;
      this.type = "PerspectiveCamera";
      this.fov = fov;
      this.zoom = 1;
      this.near = near;
      this.far = far;
      this.focus = 10;
      this._aspect = aspect;
      this.view = null;
      this.filmGauge = 35;
      this.filmOffset = 0;
      this.updateProjectionMatrix();
    }

    get aspect() {
      return this._aspect;
    }

    set aspect(value) {
      this._aspect = value;
      if (this._h) {
        if (TN.cmd) TN.cmd.camAspect(this._h, value);
        else {
          const n = native();
          if (n) n.CameraSetAspect(this._h, value);
        }
      }
    }

    copy(source, recursive) {
      super.copy(source, recursive);
      this.fov = source.fov;
      this.zoom = source.zoom;
      this.near = source.near;
      this.far = source.far;
      this.focus = source.focus;
      this.aspect = source.aspect;
      this.view = source.view === null || source.view === undefined ? null : Object.assign({}, source.view);
      this.filmGauge = source.filmGauge;
      this.filmOffset = source.filmOffset;
      return this;
    }

    setFocalLength(focalLength) {
      const vExtentSlope = (0.5 * this.getFilmHeight()) / focalLength;
      this.fov = RAD2DEG * 2 * Math.atan(vExtentSlope);
      this.updateProjectionMatrix();
    }

    getFocalLength() {
      const vExtentSlope = Math.tan(DEG2RAD * 0.5 * this.fov);
      return (0.5 * this.getFilmHeight()) / vExtentSlope;
    }

    getEffectiveFOV() {
      return RAD2DEG * 2 * Math.atan(Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom);
    }

    getFilmWidth() {
      return this.filmGauge * Math.min(this.aspect, 1);
    }

    getFilmHeight() {
      return this.filmGauge / Math.max(this.aspect, 1);
    }

    getViewBounds(distance, minTarget, maxTarget) {
      applyMatrix4Vec3(_v3.set(-1, -1, 0.5), this.projectionMatrixInverse);
      minTarget.set(_v3.x, _v3.y).multiplyScalar(-distance / _v3.z);
      applyMatrix4Vec3(_v3.set(1, 1, 0.5), this.projectionMatrixInverse);
      maxTarget.set(_v3.x, _v3.y).multiplyScalar(-distance / _v3.z);
    }

    getViewSize(distance, target) {
      this.getViewBounds(distance, _minTarget, _maxTarget);
      return target.subVectors(_maxTarget, _minTarget);
    }

    setViewOffset(fullWidth, fullHeight, x, y, width, height) {
      this.aspect = fullWidth / fullHeight;
      const view = ensureView(this);
      view.enabled = true;
      view.fullWidth = fullWidth;
      view.fullHeight = fullHeight;
      view.offsetX = x;
      view.offsetY = y;
      view.width = width;
      view.height = height;
      this.updateProjectionMatrix();
    }

    clearViewOffset() {
      if (this.view !== null) this.view.enabled = false;
      this.updateProjectionMatrix();
    }

    updateProjectionMatrix() {
      const near = this.near;
      let top = (near * Math.tan(DEG2RAD * 0.5 * this.fov)) / this.zoom;
      let height = 2 * top;
      let width = this.aspect * height;
      let left = -0.5 * width;
      const view = this.view;
      if (view !== null && view.enabled) {
        const fullWidth = view.fullWidth;
        const fullHeight = view.fullHeight;
        left += (view.offsetX * width) / fullWidth;
        top -= (view.offsetY * height) / fullHeight;
        width *= view.width / fullWidth;
        height *= view.height / fullHeight;
      }
      const skew = this.filmOffset;
      if (skew !== 0) left += (near * skew) / this.getFilmWidth();
      makePerspectiveMatrix(
        this.projectionMatrix,
        left,
        left + width,
        top,
        top - height,
        near,
        this.far,
        this.coordinateSystem,
        this.reversedDepth
      );
      copyInverse(this.projectionMatrix, this.projectionMatrixInverse);
      const n = native();
      if (n && this._h) n.CameraUpdateProjectionMatrix(this._h);
    }

    toJSON(meta) {
      const data = typeof super.toJSON === "function" ? super.toJSON(meta) : { metadata: {}, object: {} };
      data.object = data.object || {};
      data.object.fov = this.fov;
      data.object.zoom = this.zoom;
      data.object.near = this.near;
      data.object.far = this.far;
      data.object.focus = this.focus;
      data.object.aspect = this.aspect;
      if (this.view !== null) data.object.view = Object.assign({}, this.view);
      data.object.filmGauge = this.filmGauge;
      data.object.filmOffset = this.filmOffset;
      return data;
    }
  }

  function createOrthographicHandle(left, right, top, bottom, near, far) {
    if (TN.cmd) {
      const handle = TN.cmd.alloc();
      TN.cmd.orthoCam(handle, left, right, top, bottom, near, far);
      return { handle, nativeOrtho: true };
    }
    const n = native();
    if (!n) return { handle: 0, nativeOrtho: false };
    try {
      if (n.OrthographicCameraCreate) {
        return {
          handle: n.OrthographicCameraCreate(left, right, top, bottom, near, far),
          nativeOrtho: true,
        };
      }
    } catch {
      /* no native ortho */
    }
    const w = Math.abs(right - left) || 1;
    const h = Math.abs(top - bottom) || 1;
    return {
      handle: n.PerspectiveCameraCreate(50, w / h, near > 0 ? near : 0.1, far),
      nativeOrtho: false,
    };
  }

  class OrthographicCamera extends Camera {
    constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
      const created = createOrthographicHandle(left, right, top, bottom, near, far);
      super(created.handle);
      this.isOrthographicCamera = true;
      this.type = "OrthographicCamera";
      this.zoom = 1;
      this.view = null;
      this.left = left;
      this.right = right;
      this.top = top;
      this.bottom = bottom;
      this.near = near;
      this.far = far;
      this._nativeOrtho = created.nativeOrtho;
      this.updateProjectionMatrix();
    }

    copy(source, recursive) {
      super.copy(source, recursive);
      this.left = source.left;
      this.right = source.right;
      this.top = source.top;
      this.bottom = source.bottom;
      this.near = source.near;
      this.far = source.far;
      this.zoom = source.zoom;
      this.view = source.view === null || source.view === undefined ? null : Object.assign({}, source.view);
      return this;
    }

    setViewOffset(fullWidth, fullHeight, x, y, width, height) {
      const view = ensureView(this);
      view.enabled = true;
      view.fullWidth = fullWidth;
      view.fullHeight = fullHeight;
      view.offsetX = x;
      view.offsetY = y;
      view.width = width;
      view.height = height;
      this.updateProjectionMatrix();
    }

    clearViewOffset() {
      if (this.view !== null) this.view.enabled = false;
      this.updateProjectionMatrix();
    }

    updateProjectionMatrix() {
      const dx = (this.right - this.left) / (2 * this.zoom);
      const dy = (this.top - this.bottom) / (2 * this.zoom);
      const cx = (this.right + this.left) / 2;
      const cy = (this.top + this.bottom) / 2;
      let left = cx - dx;
      let right = cx + dx;
      let top = cy + dy;
      let bottom = cy - dy;
      if (this.view !== null && this.view.enabled) {
        const scaleW = (this.right - this.left) / this.view.fullWidth / this.zoom;
        const scaleH = (this.top - this.bottom) / this.view.fullHeight / this.zoom;
        left += scaleW * this.view.offsetX;
        right = left + scaleW * this.view.width;
        top -= scaleH * this.view.offsetY;
        bottom = top - scaleH * this.view.height;
      }
      makeOrthographicMatrix(
        this.projectionMatrix,
        left,
        right,
        top,
        bottom,
        this.near,
        this.far,
        this.coordinateSystem,
        this.reversedDepth
      );
      copyInverse(this.projectionMatrix, this.projectionMatrixInverse);
      if (this._nativeOrtho && this._h) {
        if (TN.cmd) {
          TN.cmd.orthoUpdate(
            this._h,
            this.left,
            this.right,
            this.top,
            this.bottom,
            this.near,
            this.far,
            this.zoom
          );
        } else {
          const n = native();
          if (n) {
            try {
              if (typeof n.OrthographicCameraUpdate === "function") {
                n.OrthographicCameraUpdate(
                  this._h,
                  this.left,
                  this.right,
                  this.top,
                  this.bottom,
                  this.near,
                  this.far,
                  this.zoom
                );
              } else if (typeof n.CameraUpdateProjectionMatrix === "function") {
                n.CameraUpdateProjectionMatrix(this._h);
              }
            } catch {
              /* native ortho update optional */
            }
          }
        }
      }
    }

    toJSON(meta) {
      const data = typeof super.toJSON === "function" ? super.toJSON(meta) : { metadata: {}, object: {} };
      data.object = data.object || {};
      data.object.zoom = this.zoom;
      data.object.left = this.left;
      data.object.right = this.right;
      data.object.top = this.top;
      data.object.bottom = this.bottom;
      data.object.near = this.near;
      data.object.far = this.far;
      if (this.view !== null) data.object.view = Object.assign({}, this.view);
      return data;
    }
  }

  const CUBE_FOV = -90;
  const CUBE_ASPECT = 1;

  class CubeCamera extends Object3D {
    constructor(near, far, renderTarget) {
      super();
      this.type = "CubeCamera";
      this.renderTarget = renderTarget;
      this.coordinateSystem = null;
      this.activeMipmapLevel = 0;

      const cameraPX = new PerspectiveCamera(CUBE_FOV, CUBE_ASPECT, near, far);
      cameraPX.layers = this.layers;
      this.add(cameraPX);

      const cameraNX = new PerspectiveCamera(CUBE_FOV, CUBE_ASPECT, near, far);
      cameraNX.layers = this.layers;
      this.add(cameraNX);

      const cameraPY = new PerspectiveCamera(CUBE_FOV, CUBE_ASPECT, near, far);
      cameraPY.layers = this.layers;
      this.add(cameraPY);

      const cameraNY = new PerspectiveCamera(CUBE_FOV, CUBE_ASPECT, near, far);
      cameraNY.layers = this.layers;
      this.add(cameraNY);

      const cameraPZ = new PerspectiveCamera(CUBE_FOV, CUBE_ASPECT, near, far);
      cameraPZ.layers = this.layers;
      this.add(cameraPZ);

      const cameraNZ = new PerspectiveCamera(CUBE_FOV, CUBE_ASPECT, near, far);
      cameraNZ.layers = this.layers;
      this.add(cameraNZ);
    }

    updateCoordinateSystem() {
      const coordinateSystem = this.coordinateSystem;
      const cameras = this.children.concat();
      const [cameraPX, cameraNX, cameraPY, cameraNY, cameraPZ, cameraNZ] = cameras;
      for (const camera of cameras) this.remove(camera);

      if (coordinateSystem === WebGLCoordinateSystem) {
        cameraPX.up.set(0, 1, 0);
        cameraPX.lookAt(1, 0, 0);
        cameraNX.up.set(0, 1, 0);
        cameraNX.lookAt(-1, 0, 0);
        cameraPY.up.set(0, 0, -1);
        cameraPY.lookAt(0, 1, 0);
        cameraNY.up.set(0, 0, 1);
        cameraNY.lookAt(0, -1, 0);
        cameraPZ.up.set(0, 1, 0);
        cameraPZ.lookAt(0, 0, 1);
        cameraNZ.up.set(0, 1, 0);
        cameraNZ.lookAt(0, 0, -1);
      } else if (coordinateSystem === WebGPUCoordinateSystem) {
        cameraPX.up.set(0, -1, 0);
        cameraPX.lookAt(-1, 0, 0);
        cameraNX.up.set(0, -1, 0);
        cameraNX.lookAt(1, 0, 0);
        cameraPY.up.set(0, 0, 1);
        cameraPY.lookAt(0, 1, 0);
        cameraNY.up.set(0, 0, -1);
        cameraNY.lookAt(0, -1, 0);
        cameraPZ.up.set(0, -1, 0);
        cameraPZ.lookAt(0, 0, 1);
        cameraNZ.up.set(0, -1, 0);
        cameraNZ.lookAt(0, 0, -1);
      }

      for (const camera of cameras) {
        this.add(camera);
        if (typeof camera.updateMatrixWorld === "function") camera.updateMatrixWorld();
      }
    }

    update() {}
  }

  class ArrayCamera extends PerspectiveCamera {
    constructor(array = []) {
      super();
      this.isArrayCamera = true;
      this.isMultiViewCamera = false;
      this.cameras = array;
    }
  }

  class StereoCamera {
    constructor() {
      this.type = "StereoCamera";
      this.aspect = 1;
      this.eyeSep = 0.064;
      this.cameraL = new PerspectiveCamera();
      this.cameraL.layers?.enable?.(1);
      this.cameraL.matrixAutoUpdate = false;
      this.cameraR = new PerspectiveCamera();
      this.cameraR.layers?.enable?.(2);
      this.cameraR.matrixAutoUpdate = false;
      this._cache = {
        focus: null,
        fov: null,
        aspect: null,
        near: null,
        far: null,
        zoom: null,
        eyeSep: null,
      };
    }

    update(camera) {
      const cache = this._cache;
      const needsUpdate =
        cache.focus !== camera.focus ||
        cache.fov !== camera.fov ||
        cache.aspect !== camera.aspect * this.aspect ||
        cache.near !== camera.near ||
        cache.far !== camera.far ||
        cache.zoom !== camera.zoom ||
        cache.eyeSep !== this.eyeSep;

      if (needsUpdate) {
        cache.focus = camera.focus;
        cache.fov = camera.fov;
        cache.aspect = camera.aspect * this.aspect;
        cache.near = camera.near;
        cache.far = camera.far;
        cache.zoom = camera.zoom;
        cache.eyeSep = this.eyeSep;

        _stereoProjection.copy(camera.projectionMatrix);
        const eyeSepHalf = cache.eyeSep / 2;
        const eyeSepOnProjection = (eyeSepHalf * cache.near) / cache.focus;
        const ymax = (cache.near * Math.tan(DEG2RAD * cache.fov * 0.5)) / cache.zoom;
        let xmin;
        let xmax;

        _eyeLeft.identity();
        _eyeRight.identity();
        _eyeLeft.elements[12] = -eyeSepHalf;
        _eyeRight.elements[12] = eyeSepHalf;

        xmin = -ymax * cache.aspect + eyeSepOnProjection;
        xmax = ymax * cache.aspect + eyeSepOnProjection;
        _stereoProjection.elements[0] = (2 * cache.near) / (xmax - xmin);
        _stereoProjection.elements[8] = (xmax + xmin) / (xmax - xmin);
        this.cameraL.projectionMatrix.copy(_stereoProjection);

        xmin = -ymax * cache.aspect - eyeSepOnProjection;
        xmax = ymax * cache.aspect - eyeSepOnProjection;
        _stereoProjection.elements[0] = (2 * cache.near) / (xmax - xmin);
        _stereoProjection.elements[8] = (xmax + xmin) / (xmax - xmin);
        this.cameraR.projectionMatrix.copy(_stereoProjection);
      }

      this.cameraL.matrix.copy(camera.matrixWorld);
      multiplyMatrix4(this.cameraL.matrix, _eyeLeft);
      this.cameraL.matrixWorldNeedsUpdate = true;
      this.cameraR.matrix.copy(camera.matrixWorld);
      multiplyMatrix4(this.cameraR.matrix, _eyeRight);
      this.cameraR.matrixWorldNeedsUpdate = true;
    }
  }

  TN.Camera = Camera;
  TN.PerspectiveCamera = PerspectiveCamera;
  TN.OrthographicCamera = OrthographicCamera;
  TN.CubeCamera = CubeCamera;
  TN.ArrayCamera = ArrayCamera;
  TN.StereoCamera = StereoCamera;
})(globalThis.__TN = globalThis.__TN || {});
