(function (TN) {
  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  function hex(color) {
    if (color == null) return 0xffffff;
    if (typeof color === "number" && Number.isFinite(color)) return color >>> 0;
    if (typeof color?.getHex === "function") return color.getHex() >>> 0;
    if (typeof color === "object" && typeof color.r === "number") {
      return (
        ((Math.round(color.r * 255) & 255) << 16) |
        ((Math.round(color.g * 255) & 255) << 8) |
        (Math.round(color.b * 255) & 255)
      ) >>> 0;
    }
    return 0xffffff;
  }

  function vec2(x = 0, y = 0) {
    return TN.Vector2 ? new TN.Vector2(x, y) : { x, y };
  }

  function vec3(x = 0, y = 0, z = 0) {
    return TN.Vector3 ? new TN.Vector3(x, y, z) : { x, y, z };
  }

  function vec4(x = 0, y = 0, z = 0, w = 0) {
    return TN.Vector4 ? new TN.Vector4(x, y, z, w) : { x, y, z, w };
  }

  function copy2(out, x, y) {
    if (out && typeof out.set === "function") return out.set(x, y);
    out.x = x;
    out.y = y;
    return out;
  }

  function copy3(out, x, y, z) {
    if (out && typeof out.set === "function") return out.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }

  function uuid() {
    return TN.MathUtils?.generateUUID?.() ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
  }

  class FallbackObject {
    constructor() {
      this._h = 0;
      this.id = FallbackObject._id++;
      this.uuid = uuid();
      this.name = "";
      this.type = "Object3D";
      this.children = [];
      this.parent = null;
      this.up = vec3(0, 1, 0);
      this.position = vec3();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
      this.scale = vec3(1, 1, 1);
      this.matrix = { elements: new Float32Array(16) };
      this.matrixWorld = { elements: new Float32Array(16) };
      this.visible = true;
      this.matrixAutoUpdate = true;
      this.frustumCulled = true;
      this.isObject3D = true;
      this.userData = {};
    }
    add(...objs) {
      for (const o of objs) {
        if (!o) continue;
        this.children.push(o);
        o.parent = this;
      }
      return this;
    }
    remove(...objs) {
      for (const o of objs) {
        const i = this.children.indexOf(o);
        if (i >= 0) this.children.splice(i, 1);
        if (o.parent === this) o.parent = null;
      }
      return this;
    }
    traverse(fn) {
      fn(this);
      for (const c of this.children) c.traverse?.(fn);
    }
    updateMatrixWorld() {}
    lookAt() {
      return this;
    }
    copy() {
      return this;
    }
    clone() {
      return new this.constructor();
    }
  }
  FallbackObject._id = 1;

  class FallbackDispatcher {
    constructor() {
      this._listeners = {};
    }
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    hasEventListener(type, fn) {
      return (this._listeners[type] || []).indexOf(fn) !== -1;
    }
    removeEventListener(type, fn) {
      const list = this._listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    dispatchEvent(event) {
      const list = this._listeners[event?.type];
      if (!list) return;
      for (const fn of list.slice()) fn.call(this, event);
    }
  }

  const ObjectBase = TN.Object3D || FallbackObject;
  const GroupBase = TN.Group || ObjectBase;
  const LineBase = TN.LineSegments || TN.Line || GroupBase;
  const DispatcherBase = TN.EventDispatcher || FallbackDispatcher;

  function flushObject(obj) {
    if (!obj) return;
    const C = TN.Object3D;
    if (C && typeof C.flush === "function") C.flush(obj);
    else if (typeof obj.flush === "function") obj.flush();
  }

  let overlayStyleInjected = false;
  function injectOverlayStyle() {
    if (overlayStyleInjected) return;
    overlayStyleInjected = true;
    const doc = globalThis.document;
    if (!doc?.documentElement) return;
    const style = doc.createElement("style");
    // Native HWND overlay needs a transparent page; keep this generic.
    style.textContent =
      "html,body{background:transparent!important;}canvas{background:transparent!important;}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function dummyTexture(width, height, depth) {
    if (TN.Texture) {
      const tex = new TN.Texture();
      tex.image = { width, height, depth: depth || 1 };
      tex.isRenderTargetTexture = true;
      return tex;
    }
    return {
      isTexture: true,
      image: { width, height, depth: depth || 1 },
      dispose() {},
    };
  }

  function applyToneMapping(mode, exposure) {
    const n = native();
    if (n && typeof n.RendererSetToneMapping === "function") {
      n.RendererSetToneMapping(mode, exposure);
    }
  }

  class WebGLRenderer {
    constructor(options = {}) {
      const doc = globalThis.document;
      const canvas =
        options.canvas ??
        (doc ? doc.createElement("canvas") : { width: 0, height: 0, style: {} });
      const width = Math.max(
        1,
        options.width ?? canvas.clientWidth ?? globalThis.innerWidth ?? 960
      );
      const height = Math.max(
        1,
        options.height ?? canvas.clientHeight ?? globalThis.innerHeight ?? 600
      );

      const n = native();
      if (n && typeof n.RuntimeStart === "function") {
        const ok = n.RuntimeStart(width, height, "ThreeBrowser");
        if (!ok) throw new Error(n.LastError?.() || "failed to start native renderer");
        this.backend = n.BackendName?.() || "native";
      } else {
        this.backend = "stub";
      }

      this.isWebGLRenderer = true;
      this.domElement = canvas;
      this.autoClear = true;
      this.autoClearColor = true;
      this.autoClearDepth = true;
      this.autoClearStencil = true;
      this.sortObjects = true;
      this.localClippingEnabled = false;
      this.clippingPlanes = [];
      this.debug = { checkShaderErrors: false, onShaderError: null };
      this.shadowMap = {
        enabled: false,
        autoUpdate: true,
        needsUpdate: false,
        type: TN.PCFShadowMap ?? 1,
      };
      this.xr = {
        enabled: false,
        isPresenting: false,
        addEventListener() {},
        removeEventListener() {},
      };
      this.info = {
        autoReset: true,
        render: { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 },
        memory: { geometries: 0, textures: 0 },
        programs: null,
        reset() {
          this.render.frame = 0;
          this.render.calls = 0;
          this.render.triangles = 0;
          this.render.points = 0;
          this.render.lines = 0;
        },
      };
      this.capabilities = {
        isWebGL2: true,
        maxAnisotropy: 16,
        precision: "highp",
        logarithmicDepthBuffer: false,
        maxTextures: 16,
        maxVertexTextures: 16,
        maxTextureSize: 16384,
        maxCubemapSize: 16384,
        maxAttributes: 16,
        maxVertexUniforms: 4096,
        maxVaryings: 16,
        maxFragmentUniforms: 4096,
        vertexTextures: true,
        floatFragmentTextures: true,
        floatVertexTextures: true,
        maxSamples: 8,
        getMaxAnisotropy() {
          return 16;
        },
      };
      this._width = width;
      this._height = height;
      this._pixelRatio = 1;
      this._toneMapping = options.toneMapping ?? TN.NoToneMapping ?? 0;
      this._toneMappingExposure = options.toneMappingExposure ?? 1;
      this._outputColorSpace = options.outputColorSpace ?? TN.SRGBColorSpace ?? "srgb";
      this._clearColor = 0x000000;
      this._clearAlpha = 1;
      this._anim = null;
      this._dummyContext = {};

      globalThis.__threeNativeCanvas = canvas;
      applyToneMapping(this._toneMapping, this._toneMappingExposure);
      injectOverlayStyle();
    }

    get aspect() {
      const h = this.domElement.clientHeight || this._height || 1;
      return (this.domElement.clientWidth || this._width || 1) / h;
    }

    get toneMapping() {
      return this._toneMapping;
    }
    set toneMapping(value) {
      this._toneMapping = value;
      applyToneMapping(value, this._toneMappingExposure ?? 1);
    }

    get toneMappingExposure() {
      return this._toneMappingExposure;
    }
    set toneMappingExposure(value) {
      this._toneMappingExposure = value;
      applyToneMapping(this._toneMapping ?? 0, value);
    }

    get outputColorSpace() {
      return this._outputColorSpace;
    }
    set outputColorSpace(value) {
      this._outputColorSpace = value;
    }

    setSize(width, height, updateStyle = true) {
      const w = Math.max(1, width | 0);
      const h = Math.max(1, height | 0);
      this._width = w;
      this._height = h;
      if (TN.cmd) TN.cmd.setSize(w, h);
      else {
        const n = native();
        if (n && typeof n.RuntimeSetSize === "function") n.RuntimeSetSize(w, h);
      }
      const el = this.domElement;
      if (el) {
        el.width = w;
        el.height = h;
        if (updateStyle && el.style) {
          el.style.width = w + "px";
          el.style.height = h + "px";
        }
      }
    }

    getPixelRatio() {
      return this._pixelRatio;
    }
    setPixelRatio(value) {
      if (value > 0) this._pixelRatio = value;
    }

    getSize(target) {
      if (!target) target = vec2();
      return copy2(target, this._width || 0, this._height || 0);
    }

    getDrawingBufferSize(target) {
      if (!target) target = vec2();
      const pr = this._pixelRatio || 1;
      return copy2(
        target,
        Math.floor((this._width || 1) * pr),
        Math.floor((this._height || 1) * pr)
      );
    }

    setClearColor(color, alpha) {
      this._clearColor = color;
      if (alpha != null) this._clearAlpha = alpha;
    }

    getClearColor(target) {
      if (target && typeof target.set === "function" && typeof this._clearColor === "number") {
        target.set(this._clearColor);
        return target;
      }
      return this._clearColor;
    }

    getClearAlpha() {
      return this._clearAlpha;
    }

    setClearAlpha(alpha) {
      this._clearAlpha = alpha;
    }

    setViewport() {}
    setScissor() {}
    setScissorTest() {}
    getContext() {
      return this._dummyContext;
    }
    getContextAttributes() {
      return {};
    }
    compile() {}
    compileAsync() {
      return Promise.resolve(this);
    }
    clear() {}
    clearColor() {}
    clearDepth() {}
    clearStencil() {}
    resetState() {}

    setAnimationLoop(cb) {
      this._anim = cb;
      if (this._animPort) {
        try {
          this._animPort.close();
        } catch {
          /* ignore */
        }
        this._animPort = null;
      }
      if (!cb) return;
      const self = this;
      if (typeof MessageChannel === "function") {
        const ch = new MessageChannel();
        this._animPort = ch.port1;
        const loop = () => {
          if (self._anim !== cb) return;
          cb(performance.now());
          if (self._anim === cb) ch.port2.postMessage(0);
        };
        ch.port1.onmessage = loop;
        ch.port2.postMessage(0);
        return;
      }
      const loop = (t) => {
        if (self._anim !== cb) return;
        cb(t);
        const raf = globalThis.requestAnimationFrame;
        if (typeof raf === "function") raf(loop);
      };
      const raf = globalThis.requestAnimationFrame;
      if (typeof raf === "function") raf(loop);
    }

    render(scene, camera) {
      this.info.render.frame++;
      if (TN.cmd) {
        TN.cmd.flushPoses();
        TN.cmd.render(scene?._h || 0, camera?._h || 0);
        TN.cmd.submit();
        return true;
      }
      flushObject(scene);
      flushObject(camera);
      const n = native();
      if (!n || typeof n.RuntimeRender !== "function") return false;
      const keep = n.RuntimeRender(scene?._h || 0, camera?._h || 0);
      if (!keep) {
        const err = n.LastError?.();
        if (err) console.warn(err);
      }
      return keep;
    }

    dispose() {
      this._anim = null;
    }
  }

  let webgpuWarned = false;
  class WebGPURenderer {
    constructor(options = {}) {
      if (!webgpuWarned) {
        webgpuWarned = true;
        console.warn("ThreeBrowser: WebGPURenderer is not available; calls are no-ops.");
      }
      const doc = globalThis.document;
      this.isWebGPURenderer = true;
      this.domElement =
        options.canvas ?? (doc ? doc.createElement("canvas") : { width: 0, height: 0, style: {} });
      this.shadowMap = { enabled: false, type: TN.PCFShadowMap ?? 1 };
      this.xr = { enabled: false, isPresenting: false, addEventListener() {} };
      this.info = { render: { frame: 0, calls: 0, triangles: 0 } };
      this.capabilities = { isWebGL2: true, maxAnisotropy: 16 };
      this._toneMapping = 0;
      this._toneMappingExposure = 1;
      this._outputColorSpace = TN.SRGBColorSpace || "srgb";
      this.backend = "noop";
    }
    async init() {
      return this;
    }
    setSize() {}
    setPixelRatio() {}
    getPixelRatio() {
      return 1;
    }
    setAnimationLoop() {}
    render() {}
    dispose() {}
    getSize(target) {
      return target || vec2();
    }
    getDrawingBufferSize(target) {
      return target || vec2();
    }
    setClearColor() {}
    setViewport() {}
    getContext() {
      return {};
    }
    compile() {}
    get toneMapping() {
      return this._toneMapping;
    }
    set toneMapping(v) {
      this._toneMapping = v;
    }
    get toneMappingExposure() {
      return this._toneMappingExposure;
    }
    set toneMappingExposure(v) {
      this._toneMappingExposure = v;
    }
    get outputColorSpace() {
      return this._outputColorSpace;
    }
    set outputColorSpace(v) {
      this._outputColorSpace = v;
    }
  }

  class WebGLRenderTarget {
    constructor(width = 1, height = 1, options = {}) {
      this.isWebGLRenderTarget = true;
      this.isRenderTarget = true;
      this.uuid = uuid();
      this.width = width;
      this.height = height;
      this.depth = options.depth ?? 1;
      this.scissor = vec4(0, 0, width, height);
      this.scissorTest = false;
      this.viewport = vec4(0, 0, width, height);
      this.texture = options.texture || dummyTexture(width, height, this.depth);
      this.depthBuffer = options.depthBuffer !== false;
      this.stencilBuffer = !!options.stencilBuffer;
      this.depthTexture = options.depthTexture ?? null;
      this.samples = options.samples ?? 0;
      this._listeners = {};
    }
    setSize(width, height, depth = 1) {
      this.width = width;
      this.height = height;
      this.depth = depth;
      if (this.texture?.image) {
        this.texture.image.width = width;
        this.texture.image.height = height;
        this.texture.image.depth = depth;
      }
      if (this.viewport?.set) this.viewport.set(0, 0, width, height);
      if (this.scissor?.set) this.scissor.set(0, 0, width, height);
    }
    dispose() {}
    clone() {
      return new this.constructor(this.width, this.height).copy(this);
    }
    copy(source) {
      this.width = source.width;
      this.height = source.height;
      this.depth = source.depth;
      this.texture = source.texture;
      this.depthBuffer = source.depthBuffer;
      this.stencilBuffer = source.stencilBuffer;
      this.samples = source.samples;
      return this;
    }
  }

  class WebGLCubeRenderTarget extends WebGLRenderTarget {
    constructor(size = 1, options = {}) {
      super(size, size, options);
      this.isWebGLCubeRenderTarget = true;
      if (this.texture) this.texture.isCubeTexture = true;
    }
    fromEquirectangularTexture() {
      return this;
    }
    clear() {
      return this;
    }
  }

  class WebGLArrayRenderTarget extends WebGLRenderTarget {
    constructor(width = 1, height = 1, depth = 1, options = {}) {
      super(width, height, { ...options, depth });
      this.isWebGLArrayRenderTarget = true;
      if (this.texture) this.texture.isArrayTexture = true;
    }
  }

  class WebGL3DRenderTarget extends WebGLRenderTarget {
    constructor(width = 1, height = 1, depth = 1, options = {}) {
      super(width, height, { ...options, depth });
      this.isWebGL3DRenderTarget = true;
      if (this.texture) this.texture.is3DTexture = true;
    }
  }

  class PMREMGenerator {
    constructor(renderer) {
      this._renderer = renderer;
    }
    fromScene() {
      return new WebGLRenderTarget(1, 1);
    }
    fromEquirectangular() {
      return new WebGLCubeRenderTarget(1);
    }
    fromCubemap() {
      return new WebGLCubeRenderTarget(1);
    }
    compileCubemapShader() {}
    compileEquirectangularShader() {}
    dispose() {}
  }

  const ShaderLib = {};
  const UniformsLib = {};
  const ShaderChunk = {};

  const UniformsUtils = {
    clone(src) {
      if (!src) return {};
      const dst = {};
      for (const name in src) {
        const srcUniform = src[name];
        if (!srcUniform || typeof srcUniform !== "object") {
          dst[name] = srcUniform;
          continue;
        }
        dst[name] = {};
        for (const p in srcUniform) {
          const property = srcUniform[p];
          if (property && typeof property.clone === "function") {
            dst[name][p] = property.clone();
          } else if (Array.isArray(property)) {
            dst[name][p] = property.slice();
          } else {
            dst[name][p] = property;
          }
        }
      }
      return dst;
    },
    merge(uniforms) {
      const list = Array.isArray(uniforms) ? uniforms : arguments;
      const merged = {};
      for (const u of list) {
        if (!u) continue;
        const tmp = UniformsUtils.clone(u);
        for (const p in tmp) merged[p] = tmp[p];
      }
      return merged;
    },
  };

  class KeyframeTrack {
    constructor(name = "", times = [], values = [], interpolation) {
      this.name = name;
      this.times = times;
      this.values = values;
      this.ValueTypeName = "mixed";
      this.setInterpolation(interpolation);
    }
    setInterpolation(interpolation) {
      this.getInterpolation = () => interpolation;
      return this;
    }
    getValueSize() {
      const n = this.times?.length || 0;
      return n ? Math.floor((this.values?.length || 0) / n) : 0;
    }
    shift(timeOffset) {
      if (!timeOffset) return this;
      for (let i = 0; i < this.times.length; i++) this.times[i] += timeOffset;
      return this;
    }
    scale(timeScale) {
      if (timeScale === 1) return this;
      for (let i = 0; i < this.times.length; i++) this.times[i] *= timeScale;
      return this;
    }
    trim(startTime, endTime) {
      return this;
    }
    validate() {
      return true;
    }
    optimize() {
      return this;
    }
    clone() {
      return new this.constructor(
        this.name,
        this.times.slice?.() || this.times,
        this.values.slice?.() || this.values
      );
    }
    static parse(json) {
      return new KeyframeTrack(json.name, json.times, json.values, json.interpolation);
    }
  }

  class NumberKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values, interpolation) {
      super(name, times, values, interpolation);
      this.ValueTypeName = "number";
    }
  }
  class VectorKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values, interpolation) {
      super(name, times, values, interpolation);
      this.ValueTypeName = "vector";
    }
  }
  class QuaternionKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values, interpolation) {
      super(name, times, values, interpolation);
      this.ValueTypeName = "quaternion";
    }
  }
  class ColorKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values, interpolation) {
      super(name, times, values, interpolation);
      this.ValueTypeName = "color";
    }
  }
  class BooleanKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values, interpolation) {
      super(name, times, values, interpolation);
      this.ValueTypeName = "bool";
    }
  }
  class StringKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values, interpolation) {
      super(name, times, values, interpolation);
      this.ValueTypeName = "string";
    }
  }

  const trackTypes = {
    number: NumberKeyframeTrack,
    vector: VectorKeyframeTrack,
    quaternion: QuaternionKeyframeTrack,
    color: ColorKeyframeTrack,
    bool: BooleanKeyframeTrack,
    boolean: BooleanKeyframeTrack,
    string: StringKeyframeTrack,
  };

  class AnimationClip {
    constructor(name = "", duration = -1, tracks = [], blendMode) {
      this.name = name;
      this.tracks = tracks || [];
      this.duration = duration;
      this.blendMode = blendMode ?? TN.NormalAnimationBlendMode ?? 2500;
      this.uuid = uuid();
      if (this.duration < 0) this.resetDuration();
    }
    resetDuration() {
      const tracks = this.tracks;
      let duration = 0;
      for (let i = 0; i < tracks.length; i++) {
        const times = tracks[i]?.times;
        if (times && times.length) duration = Math.max(duration, times[times.length - 1]);
      }
      this.duration = duration;
      return this;
    }
    trim() {
      for (const track of this.tracks) track.trim?.(0, this.duration);
      return this;
    }
    validate() {
      return true;
    }
    optimize() {
      for (const track of this.tracks) track.optimize?.();
      return this;
    }
    clone() {
      return new AnimationClip(
        this.name,
        this.duration,
        this.tracks.map((t) => (t.clone ? t.clone() : t)),
        this.blendMode
      );
    }
    static parse(json) {
      const tracks = [];
      const rawTracks = json.tracks || [];
      for (const raw of rawTracks) {
        const Type = trackTypes[raw.type] || KeyframeTrack;
        tracks.push(new Type(raw.name, raw.times, raw.values, raw.interpolation));
      }
      return new AnimationClip(json.name, json.duration, tracks, json.blendMode);
    }
    static toJSON(clip) {
      return {
        name: clip.name,
        duration: clip.duration,
        tracks: (clip.tracks || []).map((t) => ({
          name: t.name,
          times: t.times,
          values: t.values,
          type: t.ValueTypeName,
        })),
      };
    }
    static CreateFromMorphTargetSequence(name, morphTargetSequence, fps, noLoop) {
      return new AnimationClip(name, -1, []);
    }
    static findByName(objectOrClipArray, name) {
      const clips = Array.isArray(objectOrClipArray)
        ? objectOrClipArray
        : objectOrClipArray?.animations || [];
      for (const clip of clips) if (clip.name === name) return clip;
      return null;
    }
    static CreateClipsFromMorphTargetSequences(morphTargets, fps, noLoop) {
      return [];
    }
  }

  class AnimationAction {
    constructor(mixer, clip, localRoot, blendMode) {
      this._mixer = mixer;
      this._clip = clip;
      this._localRoot = localRoot || mixer?._root;
      this.blendMode = blendMode ?? clip?.blendMode ?? TN.NormalAnimationBlendMode ?? 2500;
      this.enabled = true;
      this.paused = false;
      this.time = 0;
      this.timeScale = 1;
      this.weight = 1;
      this.loop = TN.LoopRepeat ?? 2201;
      this.repetitions = Infinity;
      this.clampWhenFinished = false;
      this.zeroSlopeAtStart = true;
      this.zeroSlopeAtEnd = true;
      this.interpolantSettings = null;
      this._clipIndex = 0;
      this._isRunning = false;
    }
    play() {
      this._isRunning = true;
      this.paused = false;
      const mixer = this._mixer;
      const n = mixer?._native;
      if (n && mixer._h && typeof n.MixerPlay === "function") {
        n.MixerPlay(mixer._h, this._clipIndex | 0);
      }
      return this;
    }
    stop() {
      this._isRunning = false;
      return this;
    }
    reset() {
      this.paused = false;
      this.enabled = true;
      this.time = 0;
      this._isRunning = false;
      return this;
    }
    isRunning() {
      return this._isRunning && !this.paused && this.enabled && this.timeScale !== 0;
    }
    isScheduled() {
      return this._isRunning;
    }
    startAt() {
      return this;
    }
    setLoop(mode, repetitions) {
      this.loop = mode;
      if (repetitions != null) this.repetitions = repetitions;
      return this;
    }
    setEffectiveWeight(weight) {
      this.weight = weight;
      return this;
    }
    getEffectiveWeight() {
      return this.weight;
    }
    fadeIn() {
      return this;
    }
    fadeOut() {
      return this;
    }
    crossFadeFrom() {
      return this;
    }
    crossFadeTo() {
      return this;
    }
    stopFading() {
      return this;
    }
    setEffectiveTimeScale(timeScale) {
      this.timeScale = timeScale;
      return this;
    }
    getEffectiveTimeScale() {
      return this.timeScale;
    }
    setDuration(duration) {
      if (this._clip && this._clip.duration) this.timeScale = this._clip.duration / duration;
      return this;
    }
    syncWith() {
      return this;
    }
    halt() {
      this.timeScale = 0;
      return this;
    }
    warp() {
      return this;
    }
    stopWarping() {
      return this;
    }
    getMixer() {
      return this._mixer;
    }
    getClip() {
      return this._clip;
    }
    getRoot() {
      return this._localRoot;
    }
  }

  class AnimationMixer extends DispatcherBase {
    constructor(root) {
      super();
      this._root = root;
      this._actions = [];
      this._actionsByClip = new Map();
      this.time = 0;
      this.timeScale = 1;
      this._h = 0;
      this._native = null;
      const n = native();
      if (n && typeof n.MixerCreate === "function" && root && root._h) {
        this._h = n.MixerCreate(root._h);
        this._native = n;
      }
    }
    clipAction(clip, optionalRoot, blendMode) {
      const key = clip || optionalRoot;
      if (key && this._actionsByClip.has(key)) return this._actionsByClip.get(key);
      const action = new AnimationAction(this, clip, optionalRoot || this._root, blendMode);
      let idx = 0;
      if (clip && typeof clip._index === "number") idx = clip._index;
      else if (this._root && Array.isArray(this._root.animations)) {
        const found = this._root.animations.indexOf(clip);
        if (found >= 0) idx = found;
      }
      action._clipIndex = idx;
      this._actions.push(action);
      if (key) this._actionsByClip.set(key, action);
      return action;
    }
    existingAction(clip) {
      return this._actionsByClip.get(clip) || null;
    }
    stopAllAction() {
      for (const action of this._actions) action.stop();
      return this;
    }
    update(deltaTime) {
      const dt = deltaTime * this.timeScale;
      this.time += dt;
      const n = this._native || native();
      if (this._h && n && typeof n.MixerUpdate === "function") n.MixerUpdate(this._h, dt);
      for (const action of this._actions) {
        if (action.isRunning()) action.time += dt * action.timeScale;
      }
      return this;
    }
    setTime(timeInSeconds) {
      this.time = 0;
      for (const action of this._actions) action.time = 0;
      return this.update(timeInSeconds);
    }
    getRoot() {
      return this._root;
    }
    uncacheClip(clip) {
      this._actionsByClip.delete(clip);
      return this;
    }
    uncacheRoot() {
      return this;
    }
    uncacheAction(clip) {
      this._actionsByClip.delete(clip);
      return this;
    }
  }

  class AnimationLoader {
    constructor(manager) {
      this.manager = manager || TN.DefaultLoadingManager || null;
      this.path = "";
    }
    setPath(path) {
      this.path = path;
      return this;
    }
    setRequestHeader() {
      return this;
    }
    setWithCredentials() {
      return this;
    }
    load(url, onLoad, onProgress, onError) {
      const full = (this.path || "") + url;
      const finish = (text) => {
        try {
          const json = typeof text === "string" ? JSON.parse(text) : text;
          const clips = this.parse(json);
          onLoad?.(clips);
        } catch (err) {
          onError?.(err);
        }
      };
      if (TN.FileLoader) {
        const loader = new TN.FileLoader(this.manager);
        loader.setPath?.(this.path);
        loader.load(url, finish, onProgress, onError);
      } else if (typeof fetch === "function") {
        fetch(full)
          .then((r) => r.json())
          .then(finish)
          .catch((err) => onError?.(err));
      }
      return this;
    }
    parse(json) {
      const list = Array.isArray(json) ? json : json.animations || [json];
      const clips = [];
      for (const raw of list) {
        if (!raw) continue;
        clips.push(raw.tracks ? AnimationClip.parse(raw) : new AnimationClip(raw.name, raw.duration, []));
      }
      return clips;
    }
  }

  class PropertyBinding {
    constructor(rootNode, path, parsedPath) {
      this.rootNode = rootNode;
      this.path = path;
      this.parsedPath = parsedPath || PropertyBinding.parseTrackName(path);
      this.node = PropertyBinding.findNode(rootNode, this.parsedPath.nodeName) || rootNode;
    }
    getValue() {}
    setValue() {}
    bind() {}
    unbind() {}
    static create(root, path, parsedPath) {
      return new PropertyBinding(root, path, parsedPath);
    }
    static parseTrackName(trackName) {
      const s = String(trackName || "");
      const lastDot = s.lastIndexOf(".");
      return {
        nodeName: lastDot >= 0 ? s.slice(0, lastDot) : s,
        objectName: "",
        objectIndex: undefined,
        propertyName: lastDot >= 0 ? s.slice(lastDot + 1) : s,
        propertyIndex: undefined,
      };
    }
    static findNode(root, nodeName) {
      if (!root || !nodeName || nodeName === "." || nodeName === root.name) return root;
      if (typeof root.getObjectByName === "function") return root.getObjectByName(nodeName) || root;
      let found = null;
      root.traverse?.((c) => {
        if (!found && c.name === nodeName) found = c;
      });
      return found || root;
    }
  }

  class PropertyMixer {
    constructor(binding, typeName, valueSize) {
      this.binding = binding;
      this.typeName = typeName;
      this.valueSize = valueSize || 1;
      this.buffer = new Float64Array((valueSize || 1) * 4);
      this.cumulativeWeight = 0;
      this.cumulativeWeightAdditive = 0;
      this.useCount = 0;
      this.referenceCount = 0;
    }
    accumulate() {}
    accumulateAdditive() {}
    apply() {}
    saveOriginalState() {}
    restoreOriginalState() {}
  }

  class AnimationObjectGroup {
    constructor(...objects) {
      this.isAnimationObjectGroup = true;
      this.uuid = uuid();
      this.nCachedObjects_ = 0;
      this._objects = objects.filter(Boolean);
      this.stats = {
        bindingsPerObject: 0,
        objects: { total: this._objects.length, inUse: 0 },
      };
    }
    add(...objs) {
      for (const o of objs) if (o) this._objects.push(o);
      this.stats.objects.total = this._objects.length;
      return this;
    }
    remove() {
      return this;
    }
    uncache() {
      return this;
    }
  }

  const AnimationUtils = {
    arraySlice(array, from, to) {
      return array.slice ? array.slice(from, to) : Array.prototype.slice.call(array, from, to);
    },
    convertArray(array, type, forceClone) {
      if (!array || (!forceClone && type && array instanceof type)) return array;
      if (!type) return array;
      const out = new type(array.length);
      for (let i = 0; i < array.length; i++) out[i] = array[i];
      return out;
    },
    isTypedArray(object) {
      return ArrayBuffer.isView(object) && !(object instanceof DataView);
    },
    getKeyframeOrder(times) {
      const order = new Array(times.length);
      for (let i = 0; i < times.length; i++) order[i] = i;
      order.sort((a, b) => times[a] - times[b]);
      return order;
    },
    sortedArray(values, stride, order) {
      const nValues = values.length;
      const result = new values.constructor(nValues);
      let dstOffset = 0;
      for (let i = 0; dstOffset < nValues; i++) {
        const srcOffset = order[i] * stride;
        for (let j = 0; j < stride; j++) result[dstOffset++] = values[srcOffset + j];
      }
      return result;
    },
    flattenJSON(jsonKeys, times, values, valuePropertyName) {
      for (let i = 1, iTime = 1; i < jsonKeys.length; i++) {
        const key = jsonKeys[i];
        if (key[valuePropertyName] !== undefined) {
          times[iTime] = key.time;
          values[iTime] = key[valuePropertyName];
          iTime++;
        }
      }
    },
    subclip(sourceClip, name, startFrame, endFrame, fps = 30) {
      const clip = sourceClip.clone ? sourceClip.clone() : new AnimationClip(name, -1, []);
      clip.name = name;
      clip.duration = (endFrame - startFrame) / fps;
      return clip;
    },
    makeClipAdditive(targetClip) {
      return targetClip;
    },
  };

  function helperInit(obj, type, flag) {
    obj.type = type;
    obj[flag] = true;
    obj.matrixAutoUpdate = false;
  }

  class AxesHelper extends LineBase {
    constructor(size = 1) {
      super();
      helperInit(this, "AxesHelper", "isAxesHelper");
      this.size = size;
      const n = native();
      if (n && typeof n.AxesHelperCreate === "function") {
        try {
          this._h = n.AxesHelperCreate(size) || 0;
        } catch {
          this._h = 0;
        }
      }
    }
    setColors() {
      return this;
    }
    dispose() {}
  }

  class GridHelper extends LineBase {
    constructor(size = 10, divisions = 10, colorCenterLine = 0x444444, colorGrid = 0x888888) {
      super();
      helperInit(this, "GridHelper", "isGridHelper");
      this.size = size;
      this.divisions = divisions;
      this.colorCenterLine = colorCenterLine;
      this.colorGrid = colorGrid;
      const n = native();
      if (n && typeof n.GridHelperCreate === "function") {
        try {
          this._h = n.GridHelperCreate(size, divisions, hex(colorCenterLine), hex(colorGrid)) || 0;
        } catch {
          this._h = 0;
        }
      }
    }
    dispose() {}
  }

  class BoxHelper extends LineBase {
    constructor(object, color = 0xffff00) {
      super();
      helperInit(this, "BoxHelper", "isBoxHelper");
      this.object = object;
      this.color = color;
      const n = native();
      if (n && typeof n.BoxHelperCreate === "function") {
        try {
          this._h = n.BoxHelperCreate(object?._h || 0) || 0;
        } catch {
          this._h = 0;
        }
      }
    }
    update() {
      return this;
    }
    setFromObject(object) {
      this.object = object;
      return this.update();
    }
    copy() {
      return this;
    }
    dispose() {}
  }

  class Box3Helper extends LineBase {
    constructor(box, color = 0xffff00) {
      super();
      helperInit(this, "Box3Helper", "isBox3Helper");
      this.box = box;
      this.color = color;
    }
    updateMatrixWorld() {
      return this;
    }
    dispose() {}
  }

  class ArrowHelper extends GroupBase {
    constructor(dir, origin, length = 1, color = 0xffff00, headLength, headWidth) {
      super();
      helperInit(this, "ArrowHelper", "isArrowHelper");
      this._length = length;
      this._color = color;
      const n = native();
      if (n && typeof n.ArrowHelperCreate === "function") {
        try {
          this._h = n.ArrowHelperCreate(dir?.x || 0, dir?.y || 0, dir?.z || 1, length, hex(color)) || 0;
        } catch {
          this._h = 0;
        }
      }
      if (origin?.x != null) this.position?.copy?.(origin) || copy3(this.position, origin.x, origin.y, origin.z);
      if (dir) this.setDirection(dir);
      this.line = new LineBase();
      this.cone = new ObjectBase();
      this.add(this.line, this.cone);
    }
    setDirection(dir) {
      if (dir && this.lookAt) this.lookAt(dir.x, dir.y, dir.z);
      return this;
    }
    setLength(length) {
      this._length = length;
      return this;
    }
    setColor(color) {
      this._color = color;
      return this;
    }
    copy() {
      return this;
    }
    dispose() {}
  }

  class CameraHelper extends LineBase {
    constructor(camera) {
      super();
      helperInit(this, "CameraHelper", "isCameraHelper");
      this.camera = camera;
      this.pointMap = {};
      if (camera) this.matrix = camera.matrixWorld || this.matrix;
    }
    update() {
      return this;
    }
    dispose() {}
    setColors() {
      return this;
    }
  }

  class DirectionalLightHelper extends GroupBase {
    constructor(light, size = 1, color) {
      super();
      helperInit(this, "DirectionalLightHelper", "isDirectionalLightHelper");
      this.light = light;
      this.color = color;
      this.size = size;
      if (light) this.matrix = light.matrixWorld || this.matrix;
    }
    update() {
      return this;
    }
    dispose() {}
  }

  class HemisphereLightHelper extends GroupBase {
    constructor(light, size = 1, color) {
      super();
      helperInit(this, "HemisphereLightHelper", "isHemisphereLightHelper");
      this.light = light;
      this.color = color;
      this.size = size;
      if (light) this.matrix = light.matrixWorld || this.matrix;
    }
    update() {
      return this;
    }
    dispose() {}
  }

  class PointLightHelper extends ObjectBase {
    constructor(light, sphereSize = 1, color) {
      super();
      helperInit(this, "PointLightHelper", "isPointLightHelper");
      this.light = light;
      this.color = color;
      this.sphereSize = sphereSize;
      if (light) this.matrix = light.matrixWorld || this.matrix;
    }
    update() {
      return this;
    }
    dispose() {}
  }

  class SpotLightHelper extends GroupBase {
    constructor(light, color) {
      super();
      helperInit(this, "SpotLightHelper", "isSpotLightHelper");
      this.light = light;
      this.color = color;
      if (light) this.matrix = light.matrixWorld || this.matrix;
    }
    update() {
      return this;
    }
    dispose() {}
  }

  class PolarGridHelper extends LineBase {
    constructor(radius = 10, sectors = 16, rings = 8, divisions = 64, color1 = 0x444444, color2 = 0x888888) {
      super();
      helperInit(this, "PolarGridHelper", "isPolarGridHelper");
      this.radius = radius;
      this.sectors = sectors;
      this.rings = rings;
      this.divisions = divisions;
      this.color1 = color1;
      this.color2 = color2;
    }
    dispose() {}
  }

  class PlaneHelper extends LineBase {
    constructor(plane, size = 1, hex = 0xffff00) {
      super();
      helperInit(this, "PlaneHelper", "isPlaneHelper");
      this.plane = plane;
      this.size = size;
      this.color = hex;
    }
    updateMatrixWorld() {
      return this;
    }
    dispose() {}
  }

  class SkeletonHelper extends LineBase {
    constructor(object) {
      super();
      helperInit(this, "SkeletonHelper", "isSkeletonHelper");
      this.root = object;
      this.bones = object?.skeleton?.bones || object?.bones || [];
    }
    updateMatrixWorld() {
      return this;
    }
    dispose() {}
  }

  function cubicBezier(t, p0, p1, p2, p3) {
    const k = 1 - t;
    return k * k * k * p0 + 3 * k * k * t * p1 + 3 * k * t * t * p2 + t * t * t * p3;
  }

  function quadraticBezier(t, p0, p1, p2) {
    const k = 1 - t;
    return k * k * p0 + 2 * k * t * p1 + t * t * p2;
  }

  class Curve {
    constructor() {
      this.type = "Curve";
      this.arcLengthDivisions = 200;
      this.needsUpdate = false;
      this.cacheArcLengths = null;
    }
    getPoint(/* t, optionalTarget */) {
      console.warn("Curve: getPoint() not implemented.");
      return null;
    }
    getPointAt(u, optionalTarget) {
      return this.getPoint(this.getUtoTmapping(u), optionalTarget);
    }
    getPoints(divisions = 5) {
      const points = [];
      for (let d = 0; d <= divisions; d++) points.push(this.getPoint(d / divisions));
      return points;
    }
    getSpacedPoints(divisions = 5) {
      const points = [];
      for (let d = 0; d <= divisions; d++) points.push(this.getPointAt(d / divisions));
      return points;
    }
    getLength() {
      const lengths = this.getLengths();
      return lengths[lengths.length - 1] || 0;
    }
    getLengths(divisions) {
      if (divisions == null) divisions = this.arcLengthDivisions;
      if (this.cacheArcLengths && this.cacheArcLengths.length === divisions + 1 && !this.needsUpdate) {
        return this.cacheArcLengths;
      }
      this.needsUpdate = false;
      const cache = [];
      let current,
        last = this.getPoint(0);
      let sum = 0;
      cache.push(0);
      for (let p = 1; p <= divisions; p++) {
        current = this.getPoint(p / divisions);
        sum += Math.hypot(
          current.x - last.x,
          current.y - last.y,
          (current.z || 0) - (last.z || 0)
        );
        cache.push(sum);
        last = current;
      }
      this.cacheArcLengths = cache;
      return cache;
    }
    updateArcLengths() {
      this.needsUpdate = true;
      this.getLengths();
    }
    getUtoTmapping(u, distance) {
      const arcLengths = this.getLengths();
      const il = arcLengths.length;
      let target;
      if (distance) target = distance;
      else target = u * arcLengths[il - 1];
      let low = 0,
        high = il - 1;
      while (low <= high) {
        const i = Math.floor(low + (high - low) / 2);
        const comparison = arcLengths[i] - target;
        if (comparison < 0) low = i + 1;
        else if (comparison > 0) high = i - 1;
        else {
          high = i;
          break;
        }
      }
      const i = high;
      if (arcLengths[i] === target) return i / (il - 1);
      const lengthBefore = arcLengths[i];
      const lengthAfter = arcLengths[i + 1];
      const segmentLength = lengthAfter - lengthBefore;
      const segmentFraction = segmentLength ? (target - lengthBefore) / segmentLength : 0;
      return (i + segmentFraction) / (il - 1);
    }
    getTangent(t, optionalTarget) {
      const delta = 0.0001;
      let t1 = t - delta;
      let t2 = t + delta;
      if (t1 < 0) t1 = 0;
      if (t2 > 1) t2 = 1;
      const pt1 = this.getPoint(t1);
      const pt2 = this.getPoint(t2);
      const out = optionalTarget || (pt1.z != null ? vec3() : vec2());
      const dx = pt2.x - pt1.x;
      const dy = pt2.y - pt1.y;
      const dz = (pt2.z || 0) - (pt1.z || 0);
      const len = Math.hypot(dx, dy, dz) || 1;
      if (out.z != null) return copy3(out, dx / len, dy / len, dz / len);
      return copy2(out, dx / len, dy / len);
    }
    getTangentAt(u, optionalTarget) {
      return this.getTangent(this.getUtoTmapping(u), optionalTarget);
    }
    computeFrenetFrames(segments, closed) {
      const tangents = [];
      const normals = [];
      const binormals = [];
      for (let i = 0; i <= segments; i++) {
        tangents[i] = this.getTangentAt(i / segments, vec3());
        normals[i] = vec3(0, 1, 0);
        binormals[i] = vec3(1, 0, 0);
      }
      return { tangents, normals, binormals };
    }
    clone() {
      return new this.constructor().copy(this);
    }
    copy(source) {
      this.arcLengthDivisions = source.arcLengthDivisions;
      return this;
    }
  }

  class CurvePath extends Curve {
    constructor() {
      super();
      this.type = "CurvePath";
      this.curves = [];
      this.autoClose = false;
    }
    add(curve) {
      this.curves.push(curve);
      return this;
    }
    closePath() {
      const start = this.curves[0]?.getPoint(0);
      const end = this.curves[this.curves.length - 1]?.getPoint(1);
      if (start && end && (start.x !== end.x || start.y !== end.y || (start.z || 0) !== (end.z || 0))) {
        this.curves.push(new LineCurve3(end, start));
      }
      return this;
    }
    getPoint(t, optionalTarget) {
      const d = t * this.getLength();
      const curveLengths = this.getCurveLengths();
      let i = 0;
      while (i < curveLengths.length) {
        if (curveLengths[i] >= d) {
          const diff = curveLengths[i] - d;
          const curve = this.curves[i];
          const segmentLength = curve.getLength();
          const u = segmentLength === 0 ? 0 : 1 - diff / segmentLength;
          return curve.getPointAt(u, optionalTarget);
        }
        i++;
      }
      return this.curves[this.curves.length - 1]?.getPoint(1, optionalTarget) || optionalTarget || vec3();
    }
    getCurveLengths() {
      const lengths = [];
      let sum = 0;
      for (const curve of this.curves) {
        sum += curve.getLength();
        lengths.push(sum);
      }
      return lengths;
    }
    getPoints(divisions = 12) {
      const points = [];
      for (const curve of this.curves) {
        const pts = curve.getPoints(divisions);
        for (const p of pts) {
          const last = points[points.length - 1];
          if (!last || last.x !== p.x || last.y !== p.y || (last.z || 0) !== (p.z || 0)) points.push(p);
        }
      }
      if (this.autoClose && points.length > 1) points.push(points[0]);
      return points;
    }
  }

  class LineCurve3 extends Curve {
    constructor(v1 = vec3(), v2 = vec3()) {
      super();
      this.type = "LineCurve3";
      this.isLineCurve3 = true;
      this.v1 = v1;
      this.v2 = v2;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec3();
      if (t === 1) return copy3(point, this.v2.x, this.v2.y, this.v2.z);
      copy3(point, this.v2.x - this.v1.x, this.v2.y - this.v1.y, this.v2.z - this.v1.z);
      const x = this.v1.x + point.x * t;
      const y = this.v1.y + point.y * t;
      const z = this.v1.z + point.z * t;
      return copy3(point, x, y, z);
    }
    getPointAt(u, optionalTarget) {
      return this.getPoint(u, optionalTarget);
    }
  }

  class LineCurve extends Curve {
    constructor(v1 = vec2(), v2 = vec2()) {
      super();
      this.type = "LineCurve";
      this.isLineCurve = true;
      this.v1 = v1;
      this.v2 = v2;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec2();
      const x = this.v1.x + (this.v2.x - this.v1.x) * t;
      const y = this.v1.y + (this.v2.y - this.v1.y) * t;
      return copy2(point, x, y);
    }
    getPointAt(u, optionalTarget) {
      return this.getPoint(u, optionalTarget);
    }
  }

  class CubicBezierCurve extends Curve {
    constructor(v0 = vec2(), v1 = vec2(), v2 = vec2(), v3 = vec2()) {
      super();
      this.type = "CubicBezierCurve";
      this.v0 = v0;
      this.v1 = v1;
      this.v2 = v2;
      this.v3 = v3;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec2();
      return copy2(
        point,
        cubicBezier(t, this.v0.x, this.v1.x, this.v2.x, this.v3.x),
        cubicBezier(t, this.v0.y, this.v1.y, this.v2.y, this.v3.y)
      );
    }
  }

  class QuadraticBezierCurve extends Curve {
    constructor(v0 = vec2(), v1 = vec2(), v2 = vec2()) {
      super();
      this.type = "QuadraticBezierCurve";
      this.v0 = v0;
      this.v1 = v1;
      this.v2 = v2;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec2();
      return copy2(
        point,
        quadraticBezier(t, this.v0.x, this.v1.x, this.v2.x),
        quadraticBezier(t, this.v0.y, this.v1.y, this.v2.y)
      );
    }
  }

  class Path extends CurvePath {
    constructor(points) {
      super();
      this.type = "Path";
      this.currentPoint = vec2();
      if (points) this.setFromPoints(points);
    }
    setFromPoints(points) {
      this.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) this.lineTo(points[i].x, points[i].y);
      return this;
    }
    moveTo(x, y) {
      this.currentPoint = vec2(x, y);
      return this;
    }
    lineTo(x, y) {
      const curve = new LineCurve(this.currentPoint, vec2(x, y));
      this.curves.push(curve);
      this.currentPoint = curve.v2;
      return this;
    }
    quadraticCurveTo(aCPx, aCPy, aX, aY) {
      const curve = new QuadraticBezierCurve(this.currentPoint, vec2(aCPx, aCPy), vec2(aX, aY));
      this.curves.push(curve);
      this.currentPoint = curve.v2;
      return this;
    }
    bezierCurveTo(aCP1x, aCP1y, aCP2x, aCP2y, aX, aY) {
      const curve = new CubicBezierCurve(
        this.currentPoint,
        vec2(aCP1x, aCP1y),
        vec2(aCP2x, aCP2y),
        vec2(aX, aY)
      );
      this.curves.push(curve);
      this.currentPoint = curve.v3;
      return this;
    }
    splineThru(pts) {
      const npts = [this.currentPoint].concat(pts);
      const curve = new CatmullRomCurve3(npts.map((p) => vec3(p.x, p.y, p.z || 0)));
      this.curves.push(curve);
      this.currentPoint = pts[pts.length - 1];
      return this;
    }
    absarc(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise) {
      return this.absellipse(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);
    }
    arc(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise) {
      return this.absarc(
        this.currentPoint.x + aX,
        this.currentPoint.y + aY,
        aRadius,
        aStartAngle,
        aEndAngle,
        aClockwise
      );
    }
    absellipse(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation) {
      const curve = new EllipseCurve(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation);
      if (this.curves.length) {
        const first = curve.getPoint(0);
        if (first.x !== this.currentPoint.x || first.y !== this.currentPoint.y) {
          this.lineTo(first.x, first.y);
        }
      }
      this.curves.push(curve);
      this.currentPoint = curve.getPoint(1);
      return this;
    }
    ellipse(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation) {
      return this.absellipse(
        this.currentPoint.x + aX,
        this.currentPoint.y + aY,
        xRadius,
        yRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
        aRotation
      );
    }
  }

  class Shape extends Path {
    constructor(points) {
      super(points);
      this.type = "Shape";
      this.uuid = uuid();
      this.holes = [];
    }
    getPointsHoles(divisions) {
      return this.holes.map((h) => h.getPoints(divisions));
    }
    extractPoints(divisions) {
      return { shape: this.getPoints(divisions), holes: this.getPointsHoles(divisions) };
    }
  }

  class ShapePath {
    constructor() {
      this.type = "ShapePath";
      this.color = TN.Color ? new TN.Color() : { r: 1, g: 1, b: 1 };
      this.subPaths = [];
      this.currentPath = null;
    }
    moveTo(x, y) {
      this.currentPath = new Path();
      this.subPaths.push(this.currentPath);
      this.currentPath.moveTo(x, y);
      return this;
    }
    lineTo(x, y) {
      this.currentPath.lineTo(x, y);
      return this;
    }
    quadraticCurveTo(aCPx, aCPy, aX, aY) {
      this.currentPath.quadraticCurveTo(aCPx, aCPy, aX, aY);
      return this;
    }
    bezierCurveTo(aCP1x, aCP1y, aCP2x, aCP2y, aX, aY) {
      this.currentPath.bezierCurveTo(aCP1x, aCP1y, aCP2x, aCP2y, aX, aY);
      return this;
    }
    splineThru(pts) {
      this.currentPath.splineThru(pts);
      return this;
    }
    toShapes(isCCW, noHoles) {
      const shapes = [];
      for (const path of this.subPaths) {
        const shape = new Shape();
        shape.curves = path.curves;
        shape.currentPoint = path.currentPoint;
        shapes.push(shape);
      }
      return shapes;
    }
  }

  class CatmullRomCurve3 extends Curve {
    constructor(points = [], closed = false, curveType = "centripetal", tension = 0.5) {
      super();
      this.type = "CatmullRomCurve3";
      this.isCatmullRomCurve3 = true;
      this.points = points;
      this.closed = closed;
      this.curveType = curveType;
      this.tension = tension;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec3();
      const points = this.points;
      const l = points.length;
      if (l === 0) return copy3(point, 0, 0, 0);
      if (l === 1) return copy3(point, points[0].x, points[0].y, points[0].z);
      const p = (l - (this.closed ? 0 : 1)) * t;
      let intPoint = Math.floor(p);
      let weight = p - intPoint;
      if (this.closed) {
        intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
      } else if (weight === 0 && intPoint === l - 1) {
        intPoint = l - 2;
        weight = 1;
      }
      let p0, p3;
      if (this.closed || intPoint > 0) p0 = points[(intPoint - 1 + l) % l];
      else {
        p0 = vec3(
          points[0].x + (points[0].x - points[1].x),
          points[0].y + (points[0].y - points[1].y),
          points[0].z + (points[0].z - points[1].z)
        );
      }
      const p1 = points[intPoint % l];
      const p2 = points[(intPoint + 1) % l];
      if (this.closed || intPoint + 2 < l) p3 = points[(intPoint + 2) % l];
      else {
        p3 = vec3(
          points[l - 1].x + (points[l - 1].x - points[l - 2].x),
          points[l - 1].y + (points[l - 1].y - points[l - 2].y),
          points[l - 1].z + (points[l - 1].z - points[l - 2].z)
        );
      }
      if (this.curveType === "centripetal" || this.curveType === "chordal") {
        const pow = this.curveType === "chordal" ? 0.5 : 0.25;
        let dt0 = Math.pow(distSq(p0, p1), pow);
        let dt1 = Math.pow(distSq(p1, p2), pow);
        let dt2 = Math.pow(distSq(p2, p3), pow);
        if (dt1 < 1e-4) dt1 = 1;
        if (dt0 < 1e-4) dt0 = dt1;
        if (dt2 < 1e-4) dt2 = dt1;
        return copy3(
          point,
          nonuniform(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2, weight),
          nonuniform(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2, weight),
          nonuniform(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2, weight)
        );
      }
      const tens = this.tension;
      return copy3(
        point,
        catmull(p0.x, p1.x, p2.x, p3.x, tens, weight),
        catmull(p0.y, p1.y, p2.y, p3.y, tens, weight),
        catmull(p0.z, p1.z, p2.z, p3.z, tens, weight)
      );
    }
  }

  function distSq(a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    return dx * dx + dy * dy + dz * dz;
  }

  function catmull(x0, x1, x2, x3, tension, t) {
    const t1 = tension * (x2 - x0);
    const t2 = tension * (x3 - x1);
    const c0 = x1;
    const c1 = t1;
    const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
    const c3 = 2 * x1 - 2 * x2 + t1 + t2;
    const t2t = t * t;
    const t3 = t2t * t;
    return c0 + c1 * t + c2 * t2t + c3 * t3;
  }

  function nonuniform(x0, x1, x2, x3, dt0, dt1, dt2, t) {
    let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
    let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
    t1 *= dt1;
    t2 *= dt1;
    const c0 = x1;
    const c1 = t1;
    const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
    const c3 = 2 * x1 - 2 * x2 + t1 + t2;
    const t2t = t * t;
    const t3 = t2t * t;
    return c0 + c1 * t + c2 * t2t + c3 * t3;
  }

  class CubicBezierCurve3 extends Curve {
    constructor(v0 = vec3(), v1 = vec3(), v2 = vec3(), v3 = vec3()) {
      super();
      this.type = "CubicBezierCurve3";
      this.isCubicBezierCurve3 = true;
      this.v0 = v0;
      this.v1 = v1;
      this.v2 = v2;
      this.v3 = v3;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec3();
      return copy3(
        point,
        cubicBezier(t, this.v0.x, this.v1.x, this.v2.x, this.v3.x),
        cubicBezier(t, this.v0.y, this.v1.y, this.v2.y, this.v3.y),
        cubicBezier(t, this.v0.z, this.v1.z, this.v2.z, this.v3.z)
      );
    }
  }

  class QuadraticBezierCurve3 extends Curve {
    constructor(v0 = vec3(), v1 = vec3(), v2 = vec3()) {
      super();
      this.type = "QuadraticBezierCurve3";
      this.isQuadraticBezierCurve3 = true;
      this.v0 = v0;
      this.v1 = v1;
      this.v2 = v2;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec3();
      return copy3(
        point,
        quadraticBezier(t, this.v0.x, this.v1.x, this.v2.x),
        quadraticBezier(t, this.v0.y, this.v1.y, this.v2.y),
        quadraticBezier(t, this.v0.z, this.v1.z, this.v2.z)
      );
    }
  }

  class EllipseCurve extends Curve {
    constructor(
      aX = 0,
      aY = 0,
      xRadius = 1,
      yRadius = 1,
      aStartAngle = 0,
      aEndAngle = Math.PI * 2,
      aClockwise = false,
      aRotation = 0
    ) {
      super();
      this.type = "EllipseCurve";
      this.isEllipseCurve = true;
      this.aX = aX;
      this.aY = aY;
      this.xRadius = xRadius;
      this.yRadius = yRadius;
      this.aStartAngle = aStartAngle;
      this.aEndAngle = aEndAngle;
      this.aClockwise = aClockwise;
      this.aRotation = aRotation;
    }
    getPoint(t, optionalTarget) {
      const point = optionalTarget || vec2();
      const twoPi = Math.PI * 2;
      let deltaAngle = this.aEndAngle - this.aStartAngle;
      const samePoints = Math.abs(deltaAngle) < Number.EPSILON;
      while (deltaAngle < 0) deltaAngle += twoPi;
      while (deltaAngle > twoPi) deltaAngle -= twoPi;
      if (deltaAngle < Number.EPSILON) {
        if (samePoints) deltaAngle = 0;
        else deltaAngle = twoPi;
      }
      if (this.aClockwise === true && !samePoints) {
        if (Math.abs(deltaAngle - twoPi) < Number.EPSILON) deltaAngle = -twoPi;
        else deltaAngle = deltaAngle - twoPi;
      }
      const angle = this.aStartAngle + t * deltaAngle;
      let x = this.aX + this.xRadius * Math.cos(angle);
      let y = this.aY + this.yRadius * Math.sin(angle);
      if (this.aRotation !== 0) {
        const cos = Math.cos(this.aRotation);
        const sin = Math.sin(this.aRotation);
        const dx = x - this.aX;
        const dy = y - this.aY;
        x = this.aX + dx * cos - dy * sin;
        y = this.aY + dx * sin + dy * cos;
      }
      return copy2(point, x, y);
    }
  }

  Object.assign(TN, {
    WebGLRenderer,
    WebGPURenderer,
    WebGLRenderTarget,
    WebGLCubeRenderTarget,
    WebGLArrayRenderTarget,
    WebGL3DRenderTarget,
    PMREMGenerator,
    ShaderLib,
    UniformsLib,
    UniformsUtils,
    ShaderChunk,
    AnimationMixer,
    AnimationClip,
    AnimationAction,
    AnimationLoader,
    KeyframeTrack,
    NumberKeyframeTrack,
    VectorKeyframeTrack,
    QuaternionKeyframeTrack,
    ColorKeyframeTrack,
    BooleanKeyframeTrack,
    StringKeyframeTrack,
    PropertyBinding,
    PropertyMixer,
    AnimationObjectGroup,
    AnimationUtils,
    AxesHelper,
    GridHelper,
    BoxHelper,
    Box3Helper,
    ArrowHelper,
    CameraHelper,
    DirectionalLightHelper,
    HemisphereLightHelper,
    PointLightHelper,
    SpotLightHelper,
    PolarGridHelper,
    PlaneHelper,
    SkeletonHelper,
    Curve,
    CurvePath,
    Path,
    Shape,
    ShapePath,
    CatmullRomCurve3,
    CubicBezierCurve3,
    QuadraticBezierCurve3,
    LineCurve3,
    EllipseCurve,
  });
})(globalThis.__TN = globalThis.__TN || {});
