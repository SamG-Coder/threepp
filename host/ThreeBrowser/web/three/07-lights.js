(function (TN) {
  "use strict";

  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

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
      if (typeof TN.Color === "function") return new TN.Color(s).getHex() >>> 0;
    }
    return 0xffffff;
  }

  function intensityOf(v) {
    return v == null ? 1 : +v;
  }

  function nativeHandle(factory) {
    if (TN.cmd) {
      try {
        return factory(null) || 0;
      } catch {
        return 0;
      }
    }
    const n = native();
    if (!n) return 0;
    try {
      return factory(n) || 0;
    } catch {
      return 0;
    }
  }

  function placeAbove(object) {
    if (object.position && typeof object.position.set === "function") {
      const up = TN.Object3D && TN.Object3D.DEFAULT_UP;
      if (up && typeof object.position.copy === "function") object.position.copy(up);
      else object.position.set(0, 1, 0);
    }
    if (typeof object.updateMatrix === "function") object.updateMatrix();
  }

  function createMapSize(w, h) {
    const v = typeof TN.Vector2 === "function" ? new TN.Vector2(w, h) : { x: w, y: h };
    if (!("width" in v)) {
      Object.defineProperties(v, {
        width: {
          get() {
            return this.x;
          },
          set(n) {
            this.x = n;
          },
          enumerable: true,
          configurable: true,
        },
        height: {
          get() {
            return this.y;
          },
          set(n) {
            this.y = n;
          },
          enumerable: true,
          configurable: true,
        },
      });
    }
    return v;
  }

  function shadowCamera(kind) {
    const c = kind === 'ortho' ? new TN.OrthographicCamera(-5,5,5,-5,0.5,500) : new TN.PerspectiveCamera(kind === 'point' ? 90 : 50,1,0.5,500);
    c.isCamera = true;
    c.near = 0.5;
    c.far = 500;
    c.zoom = 1;
    c.matrixWorldInverse = typeof TN.Matrix4 === "function" ? new TN.Matrix4() : c.matrixWorld;
    c.projectionMatrix = typeof TN.Matrix4 === "function" ? new TN.Matrix4() : c.matrix;
    c.projectionMatrixInverse = typeof TN.Matrix4 === "function" ? new TN.Matrix4() : c.matrix;
    if (kind === "ortho") {
      c.isOrthographicCamera = true;
      c.left = -5;
      c.right = 5;
      c.top = 5;
      c.bottom = -5;
    } else {
      c.isPerspectiveCamera = true;
      c.fov = kind === "point" ? 90 : 50;
      c.aspect = 1;
      c.focus = 10;
    }
    c.updateProjectionMatrix();
    return c;
  }

  class LightShadow {
    constructor(camera) {
      this.camera = camera || shadowCamera("ortho");
      this.mapSize = createMapSize(512, 512);
      this.bias = 0;
      this.radius = 1;
      this.normalBias = 0;
      this.intensity = 1;
      this.map = null;
      this.mapPass = null;
      this.matrix = typeof TN.Matrix4 === "function" ? new TN.Matrix4() : null;
      this.autoUpdate = true;
      this.needsUpdate = false;
      this.blurSamples = 8;
    }
    update() {}
    updateMatrices(light) {
      if (!light?.target) return;
      const target = light.target.getWorldPosition(new TN.Vector3());
      this.camera.position.copy(light.getWorldPosition(new TN.Vector3()));
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      this.matrix.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1);
      this.matrix.multiply(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    }
    dispose() {
      if (this.map && typeof this.map.dispose === "function") this.map.dispose();
      if (this.mapPass && typeof this.mapPass.dispose === "function") this.mapPass.dispose();
    }
    clone() {
      const c = new this.constructor();
      if (this.mapSize && c.mapSize) {
        c.mapSize.x = this.mapSize.x;
        c.mapSize.y = this.mapSize.y;
        if ("width" in this.mapSize) c.mapSize.width = this.mapSize.width;
        if ("height" in this.mapSize) c.mapSize.height = this.mapSize.height;
      }
      c.bias = this.bias;
      c.radius = this.radius;
      c.normalBias = this.normalBias;
      c.intensity = this.intensity;
      c.autoUpdate = this.autoUpdate;
      c.needsUpdate = this.needsUpdate;
      return c;
    }
  }

  class DirectionalLightShadow extends LightShadow {
    constructor() {
      super(shadowCamera("ortho"));
      this.isDirectionalLightShadow = true;
    }
  }

  class PointLightShadow extends LightShadow {
    constructor() {
      super(shadowCamera("point"));
      this.isPointLightShadow = true;
    }
  }

  class SpotLightShadow extends LightShadow {
    constructor() {
      super(shadowCamera("spot"));
      this.isSpotLightShadow = true;
    }
  }

  function createSH(sh) {
    if (sh) return sh;
    if (typeof TN.SphericalHarmonics3 === "function") return new TN.SphericalHarmonics3();
    const coefficients = [];
    for (let i = 0; i < 9; i++) {
      coefficients.push(
        typeof TN.Vector3 === "function"
          ? new TN.Vector3()
          : {
              x: 0,
              y: 0,
              z: 0,
              set(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
                return this;
              },
              copy(v) {
                this.x = v.x;
                this.y = v.y;
                this.z = v.z;
                return this;
              },
            }
      );
    }
    return {
      isSphericalHarmonics3: true,
      coefficients,
      copy(other) {
        for (let i = 0; i < 9; i++) this.coefficients[i].copy(other.coefficients[i]);
        return this;
      },
      toArray(array, offset) {
        array = array || [];
        offset = offset || 0;
        for (let i = 0; i < 9; i++) {
          const c = this.coefficients[i];
          array[offset + i * 3] = c.x;
          array[offset + i * 3 + 1] = c.y;
          array[offset + i * 3 + 2] = c.z;
        }
        return array;
      },
      fromArray(array, offset) {
        offset = offset || 0;
        for (let i = 0; i < 9; i++) {
          this.coefficients[i].set(array[offset + i * 3], array[offset + i * 3 + 1], array[offset + i * 3 + 2]);
        }
        return this;
      },
    };
  }

  class Light extends TN.Object3D {
    constructor(color, intensity, handle) {
      super(handle || 0);
      this._h = handle || 0;
      this.isLight = true;
      this.type = "Light";
      this.color = color === undefined ? new TN.Color() : new TN.Color(color);
      this.intensity = intensityOf(intensity);
      this.castShadow = false;
      this.shadow = new LightShadow();
    }
    copy(source, recursive) {
      const base = TN.Object3D && TN.Object3D.prototype && TN.Object3D.prototype.copy;
      if (typeof base === "function") base.call(this, source, recursive);
      this.color.copy(source.color);
      this.intensity = source.intensity;
      return this;
    }
    clone(recursive) {
      return new this.constructor().copy(this, recursive);
    }
    dispose() {
      if (this.shadow && typeof this.shadow.dispose === "function") this.shadow.dispose();
    }
    toJSON(meta) {
      const base = TN.Object3D && TN.Object3D.prototype && TN.Object3D.prototype.toJSON;
      const data =
        typeof base === "function"
          ? base.call(this, meta)
          : { object: { uuid: this.uuid, type: this.type } };
      if (!data.object) data.object = {};
      data.object.color = this.color.getHex();
      data.object.intensity = this.intensity;
      return data;
    }
  }

  class AmbientLight extends Light {
    constructor(color, intensity) {
      super(
        color,
        intensity,
        nativeHandle((n) => {
          if (TN.cmd) {
            const id = TN.cmd.alloc();
            TN.cmd.lightAmbient(id, toHex(color), intensityOf(intensity));
            return id;
          }
          return n.AmbientLightCreate ? n.AmbientLightCreate(toHex(color), intensityOf(intensity)) : 0;
        })
      );
      this.isAmbientLight = true;
      this.type = "AmbientLight";
    }
  }

  class DirectionalLight extends Light {
    constructor(color, intensity) {
      super(
        color,
        intensity,
        nativeHandle((n) => {
          if (TN.cmd) {
            const id = TN.cmd.alloc();
            TN.cmd.lightDir(id, toHex(color), intensityOf(intensity));
            return id;
          }
          return n.DirectionalLightCreate ? n.DirectionalLightCreate(toHex(color), intensityOf(intensity)) : 0;
        })
      );
      this.isDirectionalLight = true;
      this.type = "DirectionalLight";
      this.target = new TN.Object3D();
      this.shadow = new DirectionalLightShadow();
      placeAbove(this);
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.target = source.target && typeof source.target.clone === "function" ? source.target.clone() : new TN.Object3D();
      this.shadow = source.shadow && typeof source.shadow.clone === "function" ? source.shadow.clone() : new DirectionalLightShadow();
      return this;
    }
    toJSON(meta) {
      const data = super.toJSON(meta);
      if (this.target) data.object.target = this.target.uuid;
      if (this.shadow && typeof this.shadow.toJSON === "function") data.object.shadow = this.shadow.toJSON();
      return data;
    }
  }

  class HemisphereLight extends Light {
    constructor(skyColor, groundColor, intensity) {
      super(
        skyColor,
        intensity,
        nativeHandle((n) => {
          if (TN.cmd) {
            const id = TN.cmd.alloc();
            TN.cmd.lightHemi(id);
            return id;
          }
          return n.HemisphereLightCreate ? n.HemisphereLightCreate() : 0;
        })
      );
      this.isHemisphereLight = true;
      this.type = "HemisphereLight";
      this.groundColor = new TN.Color(groundColor);
      placeAbove(this);
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.groundColor.copy(source.groundColor);
      return this;
    }
    toJSON(meta) {
      const data = super.toJSON(meta);
      data.object.groundColor = this.groundColor.getHex();
      return data;
    }
  }

  class PointLight extends Light {
    constructor(color, intensity, distance, decay) {
      super(
        color,
        intensity,
        nativeHandle((n) => {
          if (TN.cmd) {
            const id = TN.cmd.alloc();
            TN.cmd.lightPoint(id, toHex(color), intensityOf(intensity));
            return id;
          }
          return n.PointLightCreate ? n.PointLightCreate(toHex(color), intensityOf(intensity)) : 0;
        })
      );
      this.isPointLight = true;
      this.type = "PointLight";
      this.distance = distance == null ? 0 : distance;
      this.decay = decay == null ? 2 : decay;
      this.shadow = new PointLightShadow();
    }
    get power() {
      return this.intensity * 4 * Math.PI;
    }
    set power(power) {
      this.intensity = power / (4 * Math.PI);
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.distance = source.distance;
      this.decay = source.decay;
      this.shadow = source.shadow && typeof source.shadow.clone === "function" ? source.shadow.clone() : new PointLightShadow();
      return this;
    }
    toJSON(meta) {
      const data = super.toJSON(meta);
      data.object.distance = this.distance;
      data.object.decay = this.decay;
      return data;
    }
  }

  class SpotLight extends Light {
    constructor(color, intensity, distance, angle, penumbra, decay) {
      super(
        color,
        intensity,
        nativeHandle((n) => {
          const i = intensityOf(intensity);
          const hex = toHex(color);
          if (TN.cmd) {
            const id = TN.cmd.alloc();
            TN.cmd.lightSpot(id, hex, i, distance ?? 0, angle ?? Math.PI / 3, penumbra ?? 0, decay ?? 2);
            return id;
          }
          return typeof n.SpotLightCreate === "function"
            ? n.SpotLightCreate(hex, i, distance ?? 0, angle ?? Math.PI / 3, penumbra ?? 0, decay ?? 2)
            : typeof n.DirectionalLightCreate === "function"
              ? n.DirectionalLightCreate(hex, i)
              : 0;
        })
      );
      this.isSpotLight = true;
      this.type = "SpotLight";
      this.target = new TN.Object3D();
      this.distance = distance == null ? 0 : distance;
      this.angle = angle == null ? Math.PI / 3 : angle;
      this.penumbra = penumbra == null ? 0 : penumbra;
      this.decay = decay == null ? 2 : decay;
      this.map = null;
      this.shadow = new SpotLightShadow();
      placeAbove(this);
    }
    get power() {
      return this.intensity * Math.PI;
    }
    set power(power) {
      this.intensity = power / Math.PI;
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.distance = source.distance;
      this.angle = source.angle;
      this.penumbra = source.penumbra;
      this.decay = source.decay;
      this.map = source.map;
      this.target = source.target && typeof source.target.clone === "function" ? source.target.clone() : new TN.Object3D();
      this.shadow = source.shadow && typeof source.shadow.clone === "function" ? source.shadow.clone() : new SpotLightShadow();
      return this;
    }
    toJSON(meta) {
      const data = super.toJSON(meta);
      data.object.distance = this.distance;
      data.object.angle = this.angle;
      data.object.penumbra = this.penumbra;
      data.object.decay = this.decay;
      if (this.target) data.object.target = this.target.uuid;
      return data;
    }
  }

  class RectAreaLight extends Light {
    constructor(color, intensity, width, height) {
      super(
        color,
        intensity,
        nativeHandle((n) => {
          if (n.RectAreaLightCreate) return n.RectAreaLightCreate(toHex(color), intensityOf(intensity));
          return 0;
        })
      );
      this.isRectAreaLight = true;
      this.type = "RectAreaLight";
      this.width = width == null ? 10 : width;
      this.height = height == null ? 10 : height;
    }
    get power() {
      return this.intensity * this.width * this.height * Math.PI;
    }
    set power(power) {
      this.intensity = power / (this.width * this.height * Math.PI);
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.width = source.width;
      this.height = source.height;
      return this;
    }
    toJSON(meta) {
      const data = super.toJSON(meta);
      data.object.width = this.width;
      data.object.height = this.height;
      return data;
    }
  }

  class LightProbe extends Light {
    constructor(sh, intensity) {
      super(
        undefined,
        intensity == null ? 1 : intensity,
        nativeHandle((n) => (n.LightProbeCreate ? n.LightProbeCreate() : 0))
      );
      this.isLightProbe = true;
      this.type = "LightProbe";
      this.sh = createSH(sh);
    }
    copy(source, recursive) {
      super.copy(source, recursive);
      this.sh.copy(source.sh);
      return this;
    }
    fromJSON(json) {
      this.intensity = json.intensity;
      this.sh.fromArray(json.sh);
      return this;
    }
    toJSON(meta) {
      const data = super.toJSON(meta);
      data.object.sh = this.sh.toArray();
      return data;
    }
  }

  class HemisphereLightProbe extends LightProbe {
    constructor(skyColor, groundColor, intensity) {
      super(undefined, intensity);
      this.isHemisphereLightProbe = true;
      this.type = "HemisphereLightProbe";
      const color1 = new TN.Color(skyColor);
      const color2 = new TN.Color(groundColor);
      const c0 = Math.sqrt(Math.PI);
      const c1 = c0 * Math.sqrt(0.75);
      this.sh.coefficients[0].set((color1.r + color2.r) * c0, (color1.g + color2.g) * c0, (color1.b + color2.b) * c0);
      this.sh.coefficients[1].set((color1.r - color2.r) * c1, (color1.g - color2.g) * c1, (color1.b - color2.b) * c1);
    }
  }

  class AmbientLightProbe extends LightProbe {
    constructor(color, intensity) {
      super(undefined, intensity);
      this.isAmbientLightProbe = true;
      this.type = "AmbientLightProbe";
      const color1 = new TN.Color(color);
      const s = 2 * Math.sqrt(Math.PI);
      this.sh.coefficients[0].set(color1.r * s, color1.g * s, color1.b * s);
    }
  }

  TN.Light = Light;
  TN.LightShadow = LightShadow;
  TN.AmbientLight = AmbientLight;
  TN.DirectionalLight = DirectionalLight;
  TN.DirectionalLightShadow = DirectionalLightShadow;
  TN.HemisphereLight = HemisphereLight;
  TN.PointLight = PointLight;
  TN.PointLightShadow = PointLightShadow;
  TN.SpotLight = SpotLight;
  TN.SpotLightShadow = SpotLightShadow;
  TN.RectAreaLight = RectAreaLight;
  TN.LightProbe = LightProbe;
  TN.HemisphereLightProbe = HemisphereLightProbe;
  TN.AmbientLightProbe = AmbientLightProbe;
})(globalThis.__TN = globalThis.__TN || {});
