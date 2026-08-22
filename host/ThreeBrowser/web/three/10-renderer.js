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
    // Native HWND is sized by the host WebView. Do not restyle the page.
    style.textContent = "html,body{background:transparent!important;}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function styleHitCanvas(el) {
    if (!el || !el.style) return;
    const s = el.style;
    s.position = "fixed";
    s.left = "0";
    s.top = "0";
    s.width = "100%";
    s.height = "100%";
    s.margin = "0";
    s.border = "0";
    s.padding = "0";
    s.display = "block";
    s.boxSizing = "border-box";
    s.background = "transparent";
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
    if (TN.hostHas?.(n, "RendererSetToneMapping")) n.RendererSetToneMapping(mode, exposure);
  }

  function makeDummyGL() {
    return {
      DEPTH_BUFFER_BIT: 256,
      STENCIL_BUFFER_BIT: 1024,
      COLOR_BUFFER_BIT: 16384,
      NEVER: 512,
      LESS: 513,
      EQUAL: 514,
      LEQUAL: 515,
      GREATER: 516,
      NOTEQUAL: 517,
      GEQUAL: 518,
      ALWAYS: 519,
      KEEP: 7680,
      REPLACE: 7681,
      INCR: 7682,
      DECR: 7683,
      INVERT: 5386,
      INCR_WRAP: 34055,
      DECR_WRAP: 34056,
      TEXTURE_2D: 3553,
      UNSIGNED_BYTE: 5121,
      BYTE: 5120,
      SHORT: 5122,
      UNSIGNED_SHORT: 5123,
      INT: 5124,
      UNSIGNED_INT: 5125,
      FLOAT: 5126,
      HALF_FLOAT: 5131,
      ALPHA: 6406,
      RGB: 6407,
      RGBA: 6408,
      DEPTH_COMPONENT: 6402,
      DEPTH_STENCIL: 34041,
      RED: 6403,
      RED_INTEGER: 36244,
      RG: 33319,
      RG_INTEGER: 33320,
      RGBA_INTEGER: 36249,
      NONE: 0,
      BROWSER_DEFAULT_WEBGL: 37444,
      UNPACK_FLIP_Y_WEBGL: 37440,
      UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
      UNPACK_ALIGNMENT: 3317,
      UNPACK_COLORSPACE_CONVERSION_WEBGL: 37443,
      bindTexture() {},
      pixelStorei() {},
      texSubImage2D() {},
      texImage2D() {},
      getExtension(name) {
        return new Set([
          "OES_texture_float",
          "OES_texture_float_linear",
          "OES_texture_half_float",
          "OES_texture_half_float_linear",
          "OES_element_index_uint",
          "EXT_color_buffer_float",
          "EXT_texture_filter_anisotropic",
        ]).has(String(name)) ? {} : null;
      },
      getSupportedExtensions() {
        return ["OES_texture_float", "OES_texture_float_linear", "EXT_color_buffer_float", "EXT_texture_filter_anisotropic"];
      },
      getContextAttributes() {
        return { alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true };
      },
    };
  }

  const _glEnum = {
    [TN.UnsignedByteType ?? 1009]: 5121,
    [TN.ByteType ?? 1010]: 5120,
    [TN.ShortType ?? 1011]: 5122,
    [TN.UnsignedShortType ?? 1012]: 5123,
    [TN.IntType ?? 1013]: 5124,
    [TN.UnsignedIntType ?? 1014]: 5125,
    [TN.FloatType ?? 1015]: 5126,
    [TN.HalfFloatType ?? 1016]: 5131,
    [TN.UnsignedShort4444Type ?? 1017]: 32819,
    [TN.UnsignedShort5551Type ?? 1018]: 32820,
    [TN.UnsignedInt248Type ?? 1020]: 34042,
    [TN.AlphaFormat ?? 1021]: 6406,
    [TN.RGBFormat ?? 1022]: 6407,
    [TN.RGBAFormat ?? 1023]: 6408,
    [TN.DepthFormat ?? 1026]: 6402,
    [TN.DepthStencilFormat ?? 1027]: 34041,
    [TN.RedFormat ?? 1028]: 6403,
    [TN.RedIntegerFormat ?? 1029]: 36244,
    [TN.RGFormat ?? 1030]: 33319,
    [TN.RGIntegerFormat ?? 1031]: 33320,
    [TN.RGBAIntegerFormat ?? 1033]: 36249,
  };

  class WebGLUtils {
    constructor(gl, extensions, capabilities) {
      this.gl = gl;
      this.extensions = extensions;
      this.capabilities = capabilities;
    }
    convert(p, colorSpace) {
      void colorSpace;
      if (_glEnum[p] != null) return _glEnum[p];
      const gl = this.gl;
      if (gl && gl[p] !== undefined) return gl[p];
      return null;
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
      if (TN.hostHas?.(n, "RuntimeStart")) {
        const ok = n.RuntimeStart(width, height, "ThreeBrowser");
        if (!ok) throw new Error(n.LastError?.() || "failed to start native renderer");
        this.backend = n.BackendName?.() || "native";
      } else {
        this.backend = "stub";
      }

      this.isWebGLRenderer = true;
      this.domElement = canvas;
      styleHitCanvas(canvas);
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
      const legacyRevision = Number.parseInt(globalThis.THREE?.REVISION, 10);
      const defaultToneMapping = Number.isFinite(legacyRevision) && legacyRevision < 110
        ? (TN.LinearToneMapping ?? 1)
        : (TN.NoToneMapping ?? 0);
      this._toneMapping = options.toneMapping ?? defaultToneMapping;
      this._toneMappingExposure = options.toneMappingExposure ?? 1;
      this._outputColorSpace = options.outputColorSpace ?? TN.SRGBColorSpace ?? "srgb";
      this._clearColor = 0x000000;
      this._clearAlpha = 1;
      this._renderTarget = null;
      this._activeCubeFace = 0;
      this._activeMipmapLevel = 0;
      this._anim = null;
      this._dummyContext = makeDummyGL();
      const bufferState = {
        setMask() {},
        setLocked() {},
        setTest() {},
        setFunc() {},
        setOp() {},
        setClear() {},
      };
      this.state = {
        buffers: {
          color: { ...bufferState },
          depth: { ...bufferState },
          stencil: { ...bufferState },
        },
        reset() {},
      };
      this.extensions = {
        get() {
          return null;
        },
        has() {
          return false;
        },
      };

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

    // r150 and older use outputEncoding. Keep the legacy property live rather
    // than allowing assignment to create an ignored expando on the renderer.
    get outputEncoding() {
      return this._outputColorSpace === (TN.SRGBColorSpace ?? "srgb")
        ? (TN.sRGBEncoding ?? 3001)
        : (TN.LinearEncoding ?? 3000);
    }
    set outputEncoding(value) {
      this._outputColorSpace = value === (TN.sRGBEncoding ?? 3001)
        ? (TN.SRGBColorSpace ?? "srgb")
        : (TN.LinearSRGBColorSpace ?? "srgb-linear");
    }

    setSize(width, height, updateStyle = true) {
      const w = Math.max(1, width | 0);
      const h = Math.max(1, height | 0);
      this._width = w;
      this._height = h;
      // Native GL size comes from the host WebView client rect, not from
      // page innerWidth CSS. Applying those pixels as canvas style overflowed
      // the document and added scrollbars.
      void updateStyle;
      styleHitCanvas(this.domElement);
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
      if (TN.cmd && typeof TN.cmd.clearColor === "function") {
        TN.cmd.clearColor(hex(color), this._clearAlpha ?? 1);
      }
    }

    getClearColor(target) {
      if (!target && TN.Color) target = new TN.Color();
      if (target && typeof target.copy === "function" && this._clearColor?.isColor) {
        target.copy(this._clearColor);
        return target;
      }
      if (target && typeof target.set === "function") {
        target.set(this._clearColor);
        return target;
      }
      const value = typeof this._clearColor === "number" ? this._clearColor : 0;
      return { getHex: () => value };
    }

    getClearAlpha() {
      return this._clearAlpha;
    }

    setClearAlpha(alpha) {
      this._clearAlpha = alpha;
      if (TN.cmd && typeof TN.cmd.clearColor === "function") {
        TN.cmd.clearColor(hex(this._clearColor), this._clearAlpha ?? 1);
      }
    }

    setViewport() {}
    setScissor() {}
    setScissorTest() {}
    getRenderTarget() {
      return this._renderTarget;
    }
    setRenderTarget(target, activeCubeFace = 0, activeMipmapLevel = 0) {
      const n = native();
      const handle = target?._h || 0;
      // The headless runtime submits a single scene/camera pair per native
      // frame. Its compatibility path cannot replay a WebGL EffectComposer
      // pass graph, so binding its intermediate targets would expose those
      // clears as black/white window frames. Keep the JS render-target state
      // intact and present only the resolved backbuffer scene in render().
      if (!globalThis.__threeBrowserNativeRuntime && TN.hostHas?.(n, "RenderTargetSet")) {
        const ok = n.RenderTargetSet(handle, activeCubeFace, activeMipmapLevel);
        if (!ok && handle) throw new Error(n.LastError?.() || "failed to bind native render target");
      }
      this._renderTarget = target || null;
      this._activeCubeFace = activeCubeFace | 0;
      this._activeMipmapLevel = activeMipmapLevel | 0;
      return this;
    }
    getActiveCubeFace() {
      return this._activeCubeFace;
    }
    getActiveMipmapLevel() {
      return this._activeMipmapLevel;
    }
    readRenderTargetPixels(_target, _x, _y, _width, _height, buffer) {
      // Native offscreen readback is not exposed yet. Three.js applications
      // commonly call this during capability detection; returning a cleared
      // buffer correctly reports that optional float-target probes failed and
      // lets the application select its fallback path.
      if (buffer && typeof buffer.fill === "function") buffer.fill(0);
      return buffer;
    }
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
    initTexture() {}
    initRenderTarget() {}
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
      if (!globalThis.__threeBrowserNativeRuntime && typeof MessageChannel === "function") {
        const ch = new MessageChannel();
        this._animPort = ch.port1;
        const loop = () => {
          if (self._anim !== cb) return;
          try {
            cb(performance.now());
          } catch (err) {
            console.error(err);
            self._anim = null;
            return;
          }
          if (self._anim === cb) ch.port2.postMessage(0);
        };
        ch.port1.onmessage = loop;
        ch.port2.postMessage(0);
        return;
      }
      const loop = (t) => {
        if (self._anim !== cb) return;
        try {
          cb(t);
        } catch (err) {
          console.error(err);
          self._anim = null;
          return;
        }
        const raf = globalThis.requestAnimationFrame;
        if (typeof raf === "function") raf(loop);
      };
      const raf = globalThis.requestAnimationFrame;
      if (typeof raf === "function") raf(loop);
    }

    render(scene, camera, legacyRenderTarget) {
      this.info.render.frame++;
      globalThis.__threeBrowserRendererCalls = (globalThis.__threeBrowserRendererCalls || 0) + 1;
      TN._renderFrame = this.info.render.frame;
      // Three.js before r110 passed the destination directly to render().
      // Modern Three.js uses setRenderTarget(). Supporting both is essential
      // for old EffectComposer builds, otherwise every offscreen pass is
      // mistaken for a backbuffer presentation.
      const activeRenderTarget = arguments.length >= 3
        ? (legacyRenderTarget || null)
        : this._renderTarget;
      if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) {
        globalThis.__threeBrowserRenderTargets ??= { offscreen: 0, backbuffer: 0, command: !!TN.cmd };
        if (activeRenderTarget) globalThis.__threeBrowserRenderTargets.offscreen++;
        else {
          globalThis.__threeBrowserRenderTargets.backbuffer++;
          globalThis.__threeBrowserRenderTargets.latestScene = scene?._h || 0;
          globalThis.__threeBrowserRenderTargets.latestCamera = camera?._h || 0;
        }
      }
      if (
        globalThis.__threeBrowserNativeRuntime &&
        activeRenderTarget &&
        this._nativeOffscreenToken &&
        scene === this._lastNativeScene &&
        camera === this._lastNativeCamera
      ) {
        // ManualMSAARenderPass invokes the same full scene many times in one
        // synchronous composer cycle. Native MSAA is configured on the window;
        // repeating JS traversal cannot improve it and delays the next input
        // and animation update.
        return true;
      }
      if (!this._traceRendered && globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) {
        this._traceRendered = true;
        const objects = [];
        scene?.traverse?.((object) => objects.push({
          type: object?.type || object?.constructor?.name,
          handle: object?._h || 0,
          geometry: object?.geometry?._h || 0,
          material: object?.material?._h || 0,
        }));
        console.error("ThreeBrowser first scene", {
          scene: scene?._h || 0,
          camera: camera?._h || 0,
          objects: objects.slice(0, 100),
        });
      }
      if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER && this.info.render.frame % 300 === 0) {
        let firstMesh = null;
        scene?.traverse?.((object) => { if (!firstMesh && object?.isMesh) firstMesh = object; });
        console.error("ThreeBrowser scene motion", {
          frame: this.info.render.frame,
          meshScale: firstMesh?.scale && [firstMesh.scale.x, firstMesh.scale.y, firstMesh.scale.z],
          meshVisible: firstMesh?.visible,
          parentRotation: firstMesh?.parent?.rotation?.y,
        });
      }
      if (globalThis.process?.env?.THREEBROWSER_TRACE_MATERIALS && !this._traceMaterials) {
        const materials = [];
        const seen = new Set();
        scene?.traverse?.((object) => {
          const list = Array.isArray(object?.material) ? object.material : [object?.material];
          for (const material of list) {
            if (!material || seen.has(material)) continue;
            seen.add(material);
            materials.push({
              type: material.type || material.constructor?.name,
              nativeKind: material._nativeKind || null,
              handle: material._h || 0,
              color: material.color?.getHex?.(),
              map: material.map?._h || 0,
              mapSource: material.map?.image?.src || material.map?.source?.data?.src || null,
              lightMap: material.lightMap?._h || 0,
              lightMapSource: material.lightMap?.image?.src || material.lightMap?.source?.data?.src || null,
              normalMap: material.normalMap?._h || 0,
              normalMapSource: material.normalMap?.image?.src || material.normalMap?.source?.data?.src || null,
              aoMap: material.aoMap?._h || 0,
              aoMapSource: material.aoMap?.image?.src || material.aoMap?.source?.data?.src || null,
              envMap: material.envMap?._h || 0,
              metalness: material.metalness,
              roughness: material.roughness,
              opacity: material.opacity,
              unsupportedKeys: !material._h
                ? Object.keys(material).filter((key) => !key.startsWith("_")).slice(0, 80)
                : undefined,
              vertexShaderLength: material.vertexShader?.length,
              fragmentShaderLength: material.fragmentShader?.length,
            });
          }
        });
        if (materials.length >= 8 || this.info.render.frame >= 300) {
          this._traceMaterials = true;
          console.error("ThreeBrowser scene materials", materials);
        }
      }
      // WebGLRenderer creates a LightShadow render target before updating the
      // scene. Native shadows do not expose that internal WebGL target, but
      // user code legitimately manages its lifecycle (for example adaptive
      // shadow resolution calls shadow.map.dispose()). Preserve that browser
      // contract with a lightweight target facade.
      scene?.traverse?.((object) => {
        if (!object?.castShadow || !object.shadow || object.shadow.map) return;
        object.shadow.map = {
          width: object.shadow.mapSize?.width || 0,
          height: object.shadow.mapSize?.height || 0,
          texture: TN.Texture ? new TN.Texture() : null,
          dispose() {},
        };
      });
      if (scene && typeof scene.updateMatrixWorld === "function") scene.updateMatrixWorld();
      if (camera && camera.parent === null && typeof camera.updateMatrixWorld === "function") {
        camera.updateMatrixWorld();
      }
      if (scene && typeof scene.traverse === "function") {
        const self = this;
        const batched = [];
        let nativeTraceMeshIndex = 0;
        scene.traverse(function (obj) {
          if (globalThis.process?.env?.THREEBROWSER_NATIVE_TERRAIN_TRACE && obj?.name === "terrain" && !self._nativeTerrainTraceDone) {
            const uv = obj.geometry?.attributes?.uv;
            const values = uv?.array || [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i + 1 < values.length; i += uv?.itemSize || 2) {
              minX = Math.min(minX, values[i]); maxX = Math.max(maxX, values[i]);
              minY = Math.min(minY, values[i + 1]); maxY = Math.max(maxY, values[i + 1]);
            }
            const mask = obj.material?.uniforms?.tMasks?.value;
            console.error(`terrain trace uv=${minX},${minY}..${maxX},${maxY} mask=${mask?._h || 0} image=${mask?.image?.width || 0}x${mask?.image?.height || 0} flipY=${mask?.flipY}`);
            if (mask?._h) self._nativeTerrainTraceDone = true;
          }
          if (obj && typeof obj.onBeforeRender === "function") {
            try {
              obj.onBeforeRender(self, scene, camera, obj.geometry, obj.material);
              if (obj.isBatchedMesh) obj._nativeBeforeRenderFailed = false;
            } catch {
              if (obj && obj.isBatchedMesh) obj._nativeBeforeRenderFailed = true;
            }
          }
          if (obj && obj.isBatchedMesh) batched.push(obj);
          if (obj?.isSkinnedMesh && typeof obj._syncNativeSkeleton === "function") {
            obj._syncNativeSkeleton();
          }
          const materials = Array.isArray(obj?.material) ? obj.material : [obj?.material];
          // r148 enables the skinning chunks from WebGLRenderer state, not
          // from ShaderMaterial itself. Custom instanced character classes
          // deliberately extend InstancedMesh while exposing isSkinnedMesh,
          // so mirror that renderer contract and bind their shared bone atlas.
          if (obj?.isSkinnedMesh && obj.skeleton) {
            const skeleton = obj.skeleton;
            if (skeleton.boneTexture && typeof TN._ensureTextureNative === "function") {
              TN._ensureTextureNative(skeleton.boneTexture);
            }
            for (const material of materials) {
              if (material?._nativeKind !== "shader") continue;
              material.defines ||= {};
              const enabledSkinning = !Object.prototype.hasOwnProperty.call(material.defines, "USE_SKINNING");
              if (enabledSkinning) material.defines.USE_SKINNING = "";
              material.uniforms ||= {};
              material.uniforms.boneTexture = { value: skeleton.boneTexture };
              material.uniforms.boneTextureSize = { value: skeleton.boneTextureSize | 0 };
              material.uniforms.bindMatrix = { value: obj.bindMatrix };
              material.uniforms.bindMatrixInverse = { value: obj.bindMatrixInverse };
              if (enabledSkinning) material.needsUpdate = true;
            }
          }
          if (globalThis.process?.env?.THREEBROWSER_NATIVE_MESH_TRACE && obj?.isMesh && obj.visible !== false && !self._nativeMeshTraceDone) {
            console.error("ThreeBrowser JS mesh", nativeTraceMeshIndex++, {
              type: obj.type,
              name: obj.name,
              geometry: obj.geometry?.name || obj.geometry?.type,
              attributes: Object.keys(obj.geometry?.attributes || {}),
              material: materials.map((material) => ({
                id: material?.id,
                type: material?.type,
                defines: material?.defines,
              })),
            });
          }
          for (const material of materials) {
            if (material?._nativeKind === "shader" && typeof material.flushNative === "function") {
              material.flushNative();
            }
          }
        });
        if (globalThis.process?.env?.THREEBROWSER_NATIVE_MESH_TRACE) this._nativeMeshTraceDone = true;
        for (let i = 0; i < batched.length; i++) {
          const obj = batched[i];
          if (typeof obj._syncNativeBatches === "function") {
            try {
              obj._syncNativeBatches();
            } catch {
              /* native BatchedMesh draw list */
            }
          }
        }
      }
      let nativeScene = scene;
      let nativeCamera = camera;
      if (globalThis.__threeBrowserNativeRuntime) {
        let hasNativeDraw = false;
        let hasNativeSceneDraw = false;
        let nativeDepthPass = false;
        let nativeDrawableCount = 0;
        let sceneObjectCount = 0;
        scene?.traverse?.((object) => {
          sceneObjectCount++;
          if (!object?._h) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const depthDraw = materials.some((material) => material?.isMeshDepthMaterial);
          if (depthDraw) nativeDepthPass = true;
          if (
            (object.isMesh || object.isLine || object.isLineSegments || object.isPoints || object.isSprite) &&
            (depthDraw || materials.some((material) => material?._h))
          ) {
            hasNativeDraw = true;
            nativeDrawableCount++;
            if (materials.some((material) => material?._h && material?._nativeKind !== "shader")) {
              hasNativeSceneDraw = true;
            }
          }
        });

        const perspectiveScene = !!camera?.isPerspectiveCamera;
        if (globalThis.process?.env?.THREEBROWSER_TRACE_RENDER) {
          globalThis.__threeBrowserSceneCandidates ??= new Map();
          const candidateKey = `${scene?._h || 0}/${camera?._h || 0}/${scene?.uuid || ""}/${camera?.uuid || ""}`;
          globalThis.__threeBrowserSceneCandidates.set(candidateKey, {
            scene: scene?._h || 0,
            camera: camera?._h || 0,
            objects: sceneObjectCount,
            draws: nativeDrawableCount,
            semantic: hasNativeSceneDraw,
            perspective: perspectiveScene,
            target: !!activeRenderTarget,
          });
        }
        if (
          hasNativeDraw && camera?._h &&
          (perspectiveScene || (!this._lastNativeCameraIsPerspective && hasNativeSceneDraw))
        ) {
          this._lastNativeScene = scene;
          this._lastNativeCamera = camera;
          this._lastNativeCameraIsPerspective = perspectiveScene;
          if (perspectiveScene && sceneObjectCount >= (globalThis.__threeBrowserWindowSceneScore || 0)) {
            globalThis.__threeBrowserWindowScene = scene;
            globalThis.__threeBrowserWindowCamera = camera;
            globalThis.__threeBrowserWindowSceneScore = sceneObjectCount;
          }
        }

        // Offscreen passes are still evaluated on the JS side, including
        // callbacks and transforms above, but are not separate presentable
        // frames in the native renderer.
        if (activeRenderTarget) {
          if (hasNativeDraw) {
            const token = {};
            this._nativeOffscreenToken = token;
            const clearToken = () => {
              if (this._nativeOffscreenToken === token) this._nativeOffscreenToken = null;
            };
            if (typeof queueMicrotask === "function") queueMicrotask(clearToken);
            else Promise.resolve().then(clearToken);
          }
          if (
            hasNativeDraw && activeRenderTarget?._h && scene?._h && camera?._h &&
            TN.cmd && typeof TN.cmd.renderPass === "function"
          ) {
            if (globalThis.process?.env?.THREEBROWSER_NATIVE_SHADOW_TRACE && nativeDepthPass) {
              globalThis.__threeBrowserShadowPassTrace ||= new Set();
              const traceKey = `${scene._h}:${camera._h}:${activeRenderTarget._h}`;
              if (!globalThis.__threeBrowserShadowPassTrace.has(traceKey)) {
                globalThis.__threeBrowserShadowPassTrace.add(traceKey);
                console.error(`native shadow pass scene=${scene._h} camera=${camera._h} target=${activeRenderTarget._h}`);
              }
            }
            const overrideHandle = scene?.overrideMaterial?._h || 0;
            TN.cmd.renderPass(
              scene._h,
              camera._h,
              activeRenderTarget._h,
              overrideHandle,
              this._activeCubeFace || 0,
              this._activeMipmapLevel || 0,
              nativeDepthPass ? 1 : 0
            );
          }
          return true;
        }

        // Legacy EffectComposer commonly finishes with a fullscreen
        // ShaderMaterial. Until custom GLSL is available natively, resolve
        // that pass to the latest real scene instead of presenting its empty
        // clear frame.
        if (!camera?._h || (!hasNativeSceneDraw && !camera?.isPerspectiveCamera)) {
          const fallbackScene = globalThis.__threeBrowserWindowScene || this._lastNativeScene;
          const fallbackCamera = globalThis.__threeBrowserWindowCamera || this._lastNativeCamera;
          if (fallbackScene && fallbackCamera) {
            nativeScene = fallbackScene;
            nativeCamera = fallbackCamera;
          }
        }
      }
      if (TN.cmd) {
        if (typeof TN.cmd.submitFrame === "function") {
          TN.cmd.submitFrame(nativeScene?._h || 0, nativeCamera?._h || 0);
        } else {
          TN.cmd.flushPoses();
          TN.cmd.render(nativeScene?._h || 0, nativeCamera?._h || 0);
          TN.cmd.submit();
        }
        return true;
      }
      flushObject(scene);
      flushObject(camera);
      const n = native();
      if (!TN.hostHas?.(n, "RuntimeRender")) return false;
      const keep = n.RuntimeRender(nativeScene?._h || 0, nativeCamera?._h || 0);
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
        console.warn("ThreeBrowser: WebGPURenderer on the WebGL/threepp path is a no-op. Import from 'three/webgpu' — Native intercepts that as stock Dawn, not threepp.");
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
      this._h = 0;
      const n = native();
      if (!options._cube && TN.cmd && TN.hostHas?.(n, "RenderTargetCreate")) {
        const id = TN.cmd.alloc();
        this._h = n.RenderTargetCreate(
          id,
          width,
          height,
          this.samples,
          this.depthBuffer ? 1 : 0,
          this.stencilBuffer ? 1 : 0
        ) || 0;
        if (this._h && this.texture) this.texture._h = this._h;
      }
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
      const n = native();
      if (this._h && TN.hostHas?.(n, "RenderTargetResize")) {
        n.RenderTargetResize(this._h, width, height);
      }
    }
    dispose() {
      if (this._h && typeof TN.releaseHandle === "function") TN.releaseHandle(this._h);
      this._h = 0;
      if (this.texture) this.texture._h = 0;
    }
    clone() {
      return new this.constructor(this.width, this.height).copy(this);
    }
    copy(source) {
      this.width = source.width;
      this.height = source.height;
      this.depth = source.depth;
      // EffectComposer ping-pongs between clone()d render targets. Sharing the
      // source texture aliases both buffers and makes every later ShaderPass
      // sample the image it is currently writing. Preserve this target's own
      // native attachment while copying the source texture's public state.
      const targetTexture = this.texture;
      if (targetTexture && source.texture) {
        const nativeHandle = this._h || targetTexture._h || 0;
        if (typeof targetTexture.copy === "function") targetTexture.copy(source.texture);
        else Object.assign(targetTexture, source.texture);
        targetTexture._h = nativeHandle;
        this.texture = targetTexture;
      }
      this.depthBuffer = source.depthBuffer;
      this.stencilBuffer = source.stencilBuffer;
      this.samples = source.samples;
      return this;
    }
  }

  class WebGLCubeRenderTarget extends WebGLRenderTarget {
    constructor(size = 1, options = {}) {
      super(size, size, { ...options, _cube: true });
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

  class Interpolant {
    constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
      this.parameterPositions = parameterPositions;
      this._cachedIndex = 0;
      this.resultBuffer = resultBuffer !== undefined
        ? resultBuffer
        : new sampleValues.constructor(sampleSize);
      this.sampleValues = sampleValues;
      this.valueSize = sampleSize;
      this.settings = null;
      this.DefaultSettings_ = {};
    }
    evaluate(t) {
      const pp = this.parameterPositions;
      let i1 = this._cachedIndex;
      let t1 = pp[i1];
      let t0 = pp[i1 - 1];

      validate_interval: {
        seek: {
          let right;

          linear_scan: {
            forward_scan: if (!(t < t1)) {
              for (let giveUpAt = i1 + 2; ; ) {
                if (t1 === undefined) {
                  if (t < t0) break forward_scan;
                  i1 = pp.length;
                  this._cachedIndex = i1;
                  return this.copySampleValue_(i1 - 1);
                }
                if (i1 === giveUpAt) break;
                t0 = t1;
                t1 = pp[++i1];
                if (t < t1) break seek;
              }
              right = pp.length;
              break linear_scan;
            }

            if (!(t >= t0)) {
              const t1global = pp[1];
              if (t < t1global) {
                i1 = 2;
                t0 = t1global;
              }
              for (let giveUpAt = i1 - 2; ; ) {
                if (t0 === undefined) {
                  this._cachedIndex = 0;
                  return this.copySampleValue_(0);
                }
                if (i1 === giveUpAt) break;
                t1 = t0;
                t0 = pp[--i1 - 1];
                if (t >= t0) break seek;
              }
              right = i1;
              i1 = 0;
              break linear_scan;
            }

            break validate_interval;
          }

          while (i1 < right) {
            const mid = (i1 + right) >>> 1;
            if (t < pp[mid]) right = mid;
            else i1 = mid + 1;
          }

          t1 = pp[i1];
          t0 = pp[i1 - 1];

          if (t0 === undefined) {
            this._cachedIndex = 0;
            return this.copySampleValue_(0);
          }
          if (t1 === undefined) {
            i1 = pp.length;
            this._cachedIndex = i1;
            return this.copySampleValue_(i1 - 1);
          }
        }

        this._cachedIndex = i1;
        this.intervalChanged_(i1, t0, t1);
      }

      return this.interpolate_(i1, t0, t, t1);
    }
    getSettings_() {
      return this.settings || this.DefaultSettings_;
    }
    copySampleValue_(index) {
      const result = this.resultBuffer;
      const values = this.sampleValues;
      const stride = this.valueSize;
      const offset = index * stride;
      for (let i = 0; i !== stride; ++i) result[i] = values[offset + i];
      return result;
    }
    interpolate_(/* i1, t0, t, t1 */) {
      throw new Error("THREE.Interpolant: Call to abstract method.");
    }
    intervalChanged_(/* i1, t0, t1 */) {}
  }

  class LinearInterpolant extends Interpolant {
    interpolate_(i1, t0, t, t1) {
      const result = this.resultBuffer;
      const values = this.sampleValues;
      const stride = this.valueSize;
      const offset1 = i1 * stride;
      const offset0 = offset1 - stride;
      const weight1 = (t - t0) / (t1 - t0);
      const weight0 = 1 - weight1;
      for (let i = 0; i !== stride; ++i) {
        result[i] = values[offset0 + i] * weight0 + values[offset1 + i] * weight1;
      }
      return result;
    }
  }

  class DiscreteInterpolant extends Interpolant {
    interpolate_(i1) {
      return this.copySampleValue_(i1 - 1);
    }
  }

  class CubicInterpolant extends Interpolant {
    constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
      super(parameterPositions, sampleValues, sampleSize, resultBuffer);
      this._weightPrev = -0;
      this._offsetPrev = -0;
      this._weightNext = -0;
      this._offsetNext = -0;
      this.DefaultSettings_ = {
        endingStart: TN.ZeroCurvatureEnding ?? 2400,
        endingEnd: TN.ZeroCurvatureEnding ?? 2400,
      };
    }
    intervalChanged_(i1, t0, t1) {
      const pp = this.parameterPositions;
      let iPrev = i1 - 2;
      let iNext = i1 + 1;
      let tPrev = pp[iPrev];
      let tNext = pp[iNext];

      if (tPrev === undefined) {
        switch (this.getSettings_().endingStart) {
          case TN.ZeroSlopeEnding ?? 2401:
            iPrev = i1;
            tPrev = 2 * t0 - t1;
            break;
          case TN.WrapAroundEnding ?? 2402:
            iPrev = pp.length - 2;
            tPrev = t0 + pp[iPrev] - pp[iPrev + 1];
            break;
          default:
            iPrev = i1;
            tPrev = t1;
        }
      }

      if (tNext === undefined) {
        switch (this.getSettings_().endingEnd) {
          case TN.ZeroSlopeEnding ?? 2401:
            iNext = i1;
            tNext = 2 * t1 - t0;
            break;
          case TN.WrapAroundEnding ?? 2402:
            iNext = 1;
            tNext = t1 + pp[1] - pp[0];
            break;
          default:
            iNext = i1 - 1;
            tNext = t0;
        }
      }

      const halfDt = (t1 - t0) * 0.5;
      const stride = this.valueSize;
      this._weightPrev = halfDt / (t0 - tPrev);
      this._weightNext = halfDt / (tNext - t1);
      this._offsetPrev = iPrev * stride;
      this._offsetNext = iNext * stride;
    }
    interpolate_(i1, t0, t, t1) {
      const result = this.resultBuffer;
      const values = this.sampleValues;
      const stride = this.valueSize;
      const o1 = i1 * stride;
      const o0 = o1 - stride;
      const oP = this._offsetPrev;
      const oN = this._offsetNext;
      const wP = this._weightPrev;
      const wN = this._weightNext;
      const p = (t - t0) / (t1 - t0);
      const pp = p * p;
      const ppp = pp * p;
      const sP = -wP * ppp + 2 * wP * pp - wP * p;
      const s0 = (1 + wP) * ppp + (-1.5 - 2 * wP) * pp + (-0.5 + wP) * p + 1;
      const s1 = (-1 - wN) * ppp + (1.5 + wN) * pp + 0.5 * p;
      const sN = wN * ppp - wN * pp;
      for (let i = 0; i !== stride; ++i) {
        result[i] =
          sP * values[oP + i] +
          s0 * values[o0 + i] +
          s1 * values[o1 + i] +
          sN * values[oN + i];
      }
      return result;
    }
  }

  class QuaternionLinearInterpolant extends Interpolant {
    interpolate_(i1, t0, t, t1) {
      const result = this.resultBuffer;
      const values = this.sampleValues;
      const stride = this.valueSize;
      const alpha = (t - t0) / (t1 - t0);
      let offset = i1 * stride;
      for (let end = offset + stride; offset !== end; offset += 4) {
        TN.Quaternion.slerpFlat(result, 0, values, offset - stride, values, offset, alpha);
      }
      return result;
    }
  }

  class KeyframeTrack {
    constructor(name = "", times = [], values = [], interpolation) {
      this.name = name;
      this.times = AnimationUtils.convertArray(times, this.TimeBufferType);
      this.values = AnimationUtils.convertArray(values, this.ValueBufferType);
      this.setInterpolation(interpolation || this.DefaultInterpolation);
    }
    InterpolantFactoryMethodDiscrete(result) {
      return new DiscreteInterpolant(this.times, this.values, this.getValueSize(), result);
    }
    InterpolantFactoryMethodLinear(result) {
      return new LinearInterpolant(this.times, this.values, this.getValueSize(), result);
    }
    InterpolantFactoryMethodSmooth(result) {
      return new CubicInterpolant(this.times, this.values, this.getValueSize(), result);
    }
    setInterpolation(interpolation) {
      let factoryMethod;
      switch (interpolation) {
        case TN.InterpolateDiscrete ?? 2300:
          factoryMethod = this.InterpolantFactoryMethodDiscrete;
          break;
        case TN.InterpolateLinear ?? 2301:
          factoryMethod = this.InterpolantFactoryMethodLinear;
          break;
        case TN.InterpolateSmooth ?? 2302:
          factoryMethod = this.InterpolantFactoryMethodSmooth;
          break;
      }
      if (factoryMethod === undefined) {
        if (this.createInterpolant === undefined) {
          if (interpolation !== this.DefaultInterpolation) {
            this.setInterpolation(this.DefaultInterpolation);
          }
        }
        return this;
      }
      this.createInterpolant = factoryMethod;
      return this;
    }
    getInterpolation() {
      switch (this.createInterpolant) {
        case this.InterpolantFactoryMethodDiscrete:
          return TN.InterpolateDiscrete ?? 2300;
        case this.InterpolantFactoryMethodLinear:
          return TN.InterpolateLinear ?? 2301;
        case this.InterpolantFactoryMethodSmooth:
          return TN.InterpolateSmooth ?? 2302;
      }
      return this.DefaultInterpolation;
    }
    getValueSize() {
      const n = this.times?.length || 0;
      return n ? (this.values?.length || 0) / n : 0;
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
      const times = this.times.slice?.() || this.times;
      const values = this.values.slice?.() || this.values;
      const track = new this.constructor(this.name, times, values);
      track.createInterpolant = this.createInterpolant;
      return track;
    }
    static parse(json) {
      return new KeyframeTrack(json.name, json.times, json.values, json.interpolation);
    }
  }
  KeyframeTrack.prototype.TimeBufferType = Float32Array;
  KeyframeTrack.prototype.ValueBufferType = Float32Array;
  KeyframeTrack.prototype.DefaultInterpolation = TN.InterpolateLinear ?? 2301;
  KeyframeTrack.prototype.ValueTypeName = "mixed";

  class NumberKeyframeTrack extends KeyframeTrack {}
  NumberKeyframeTrack.prototype.ValueTypeName = "number";

  class VectorKeyframeTrack extends KeyframeTrack {}
  VectorKeyframeTrack.prototype.ValueTypeName = "vector";

  class QuaternionKeyframeTrack extends KeyframeTrack {
    InterpolantFactoryMethodLinear(result) {
      return new QuaternionLinearInterpolant(this.times, this.values, this.getValueSize(), result);
    }
  }
  QuaternionKeyframeTrack.prototype.ValueTypeName = "quaternion";
  QuaternionKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;

  class ColorKeyframeTrack extends KeyframeTrack {}
  ColorKeyframeTrack.prototype.ValueTypeName = "color";

  class BooleanKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values) {
      super(name, times, values);
    }
  }
  BooleanKeyframeTrack.prototype.ValueTypeName = "bool";
  BooleanKeyframeTrack.prototype.ValueBufferType = Array;
  BooleanKeyframeTrack.prototype.DefaultInterpolation = TN.InterpolateDiscrete ?? 2300;
  BooleanKeyframeTrack.prototype.InterpolantFactoryMethodLinear = undefined;
  BooleanKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;

  class StringKeyframeTrack extends KeyframeTrack {
    constructor(name, times, values) {
      super(name, times, values);
    }
  }
  StringKeyframeTrack.prototype.ValueTypeName = "string";
  StringKeyframeTrack.prototype.ValueBufferType = Array;
  StringKeyframeTrack.prototype.DefaultInterpolation = TN.InterpolateDiscrete ?? 2300;
  StringKeyframeTrack.prototype.InterpolantFactoryMethodLinear = undefined;
  StringKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;

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
      this._localRoot = localRoot || null;
      this.blendMode = blendMode ?? clip?.blendMode ?? TN.NormalAnimationBlendMode ?? 2500;
      const tracks = clip?.tracks || [];
      const nTracks = tracks.length;
      const interpolants = new Array(nTracks);
      const interpolantSettings = {
        endingStart: TN.ZeroCurvatureEnding ?? 2400,
        endingEnd: TN.ZeroCurvatureEnding ?? 2400,
      };
      for (let i = 0; i !== nTracks; ++i) {
        const interpolant = tracks[i].createInterpolant(null);
        interpolants[i] = interpolant;
        interpolant.settings = interpolantSettings;
      }
      this._interpolantSettings = interpolantSettings;
      this._interpolants = interpolants;
      this._propertyBindings = new Array(nTracks);
      this._cacheIndex = null;
      this._byClipCacheIndex = null;
      this._timeScaleInterpolant = null;
      this._restoreTimeScale = null;
      this._weightInterpolant = null;
      this.loop = TN.LoopRepeat ?? 2201;
      this._loopCount = -1;
      this._startTime = null;
      this.time = 0;
      this.timeScale = 1;
      this._effectiveTimeScale = 1;
      this.weight = 1;
      this._effectiveWeight = 1;
      this.repetitions = Infinity;
      this.paused = false;
      this.enabled = true;
      this.clampWhenFinished = false;
      this.zeroSlopeAtStart = true;
      this.zeroSlopeAtEnd = true;
      this._clipIndex = 0;
    }
    play() {
      this._mixer._activateAction(this);
      return this;
    }
    stop() {
      this._mixer._deactivateAction(this);
      return this.reset();
    }
    reset() {
      this.paused = false;
      this.enabled = true;
      this.time = 0;
      this._loopCount = -1;
      this._startTime = null;
      return this.stopFading().stopWarping();
    }
    isRunning() {
      return this.enabled && !this.paused && this.timeScale !== 0 &&
        this._startTime === null && this._mixer._isActiveAction(this);
    }
    isScheduled() {
      return this._mixer._isActiveAction(this);
    }
    startAt(time) {
      this._startTime = time;
      return this;
    }
    setLoop(mode, repetitions) {
      this.loop = mode;
      if (repetitions != null) this.repetitions = repetitions;
      return this;
    }
    setEffectiveWeight(weight) {
      this.weight = weight;
      this._effectiveWeight = this.enabled ? weight : 0;
      return this.stopFading();
    }
    getEffectiveWeight() {
      return this._effectiveWeight;
    }
    fadeIn(duration) {
      return this._scheduleFading(duration, 0, 1);
    }
    fadeOut(duration) {
      return this._scheduleFading(duration, 1, 0);
    }
    crossFadeFrom(fadeOutAction, duration, warp = false) {
      fadeOutAction.fadeOut(duration);
      this.fadeIn(duration);
      if (warp === true) {
        const fadeInDuration = this._clip.duration;
        const fadeOutDuration = fadeOutAction._clip.duration;
        const startEndRatio = fadeOutDuration / fadeInDuration;
        const endStartRatio = fadeInDuration / fadeOutDuration;
        fadeOutAction._restoreTimeScale = fadeOutAction.timeScale;
        this._restoreTimeScale = this.timeScale;
        fadeOutAction.warp(1.0, startEndRatio, duration);
        this.warp(endStartRatio, 1.0, duration);
      }
      return this;
    }
    crossFadeTo(fadeInAction, duration, warp = false) {
      return fadeInAction.crossFadeFrom(this, duration, warp);
    }
    stopFading() {
      const weightInterpolant = this._weightInterpolant;
      if (weightInterpolant !== null) {
        this._weightInterpolant = null;
        this._mixer._takeBackControlInterpolant(weightInterpolant);
      }
      return this;
    }
    setEffectiveTimeScale(timeScale) {
      this.timeScale = timeScale;
      this._effectiveTimeScale = this.paused ? 0 : timeScale;
      return this.stopWarping();
    }
    getEffectiveTimeScale() {
      return this._effectiveTimeScale;
    }
    setDuration(duration) {
      this.timeScale = this._clip.duration / duration;
      return this.stopWarping();
    }
    syncWith(action) {
      this.time = action.time;
      this.timeScale = action.timeScale;
      return this.stopWarping();
    }
    halt(duration) {
      return this.warp(this._effectiveTimeScale, 0, duration);
    }
    warp(startTimeScale, endTimeScale, duration) {
      const mixer = this._mixer;
      const now = mixer.time;
      const timeScale = this.timeScale;
      let interpolant = this._timeScaleInterpolant;
      if (interpolant === null) {
        interpolant = mixer._lendControlInterpolant();
        this._timeScaleInterpolant = interpolant;
      }
      const times = interpolant.parameterPositions;
      const values = interpolant.sampleValues;
      times[0] = now;
      times[1] = now + duration;
      values[0] = startTimeScale / timeScale;
      values[1] = endTimeScale / timeScale;
      return this;
    }
    stopWarping() {
      const timeScaleInterpolant = this._timeScaleInterpolant;
      if (timeScaleInterpolant !== null) {
        this._timeScaleInterpolant = null;
        this._mixer._takeBackControlInterpolant(timeScaleInterpolant);
      }
      this._restoreTimeScale = null;
      return this;
    }
    getMixer() {
      return this._mixer;
    }
    getClip() {
      return this._clip;
    }
    getRoot() {
      return this._localRoot || this._mixer._root;
    }
    _update(time, deltaTime, timeDirection, accuIndex) {
      if (!this.enabled) {
        this._updateWeight(time);
        return;
      }
      const startTime = this._startTime;
      if (startTime !== null) {
        const timeRunning = (time - startTime) * timeDirection;
        if (timeRunning < 0 || timeDirection === 0) {
          deltaTime = 0;
        } else {
          this._startTime = null;
          deltaTime = timeDirection * timeRunning;
        }
      }
      deltaTime *= this._updateTimeScale(time);
      const clipTime = this._updateTime(deltaTime);
      const weight = this._updateWeight(time);
      if (weight > 0) {
        const interpolants = this._interpolants;
        const propertyMixers = this._propertyBindings;
        if (this.blendMode === (TN.AdditiveAnimationBlendMode ?? 2501)) {
          for (let j = 0, m = interpolants.length; j !== m; ++j) {
            interpolants[j].evaluate(clipTime);
            propertyMixers[j].accumulateAdditive(weight);
          }
        } else {
          for (let j = 0, m = interpolants.length; j !== m; ++j) {
            interpolants[j].evaluate(clipTime);
            propertyMixers[j].accumulate(accuIndex, weight);
          }
        }
      }
    }
    _updateWeight(time) {
      let weight = 0;
      if (this.enabled) {
        weight = this.weight;
        const interpolant = this._weightInterpolant;
        if (interpolant !== null) {
          const interpolantValue = interpolant.evaluate(time)[0];
          weight *= interpolantValue;
          if (time > interpolant.parameterPositions[1]) {
            this.stopFading();
            if (interpolantValue === 0) this.enabled = false;
          }
        }
      }
      this._effectiveWeight = weight;
      return weight;
    }
    _updateTimeScale(time) {
      let timeScale = 0;
      if (!this.paused) {
        timeScale = this.timeScale;
        const interpolant = this._timeScaleInterpolant;
        if (interpolant !== null) {
          const interpolantValue = interpolant.evaluate(time)[0];
          timeScale *= interpolantValue;
          if (time > interpolant.parameterPositions[1]) {
            if (timeScale === 0) {
              this.paused = true;
            } else {
              if (this._restoreTimeScale !== null) timeScale = this._restoreTimeScale;
              this.timeScale = timeScale;
            }
            this.stopWarping();
          }
        }
      }
      this._effectiveTimeScale = timeScale;
      return timeScale;
    }
    _updateTime(deltaTime) {
      const duration = this._clip.duration;
      const loop = this.loop;
      let time = this.time + deltaTime;
      let loopCount = this._loopCount;
      const pingPong = loop === (TN.LoopPingPong ?? 2202);
      if (deltaTime === 0) {
        if (loopCount === -1) return time;
        return pingPong && (loopCount & 1) === 1 ? duration - time : time;
      }
      if (loop === (TN.LoopOnce ?? 2200)) {
        if (loopCount === -1) {
          this._loopCount = 0;
          this._setEndings(true, true, false);
        }
        handle_stop: {
          if (time >= duration) time = duration;
          else if (time < 0) time = 0;
          else {
            this.time = time;
            break handle_stop;
          }
          if (this.clampWhenFinished) this.paused = true;
          else this.enabled = false;
          this.time = time;
          this._mixer.dispatchEvent({
            type: "finished",
            action: this,
            direction: deltaTime < 0 ? -1 : 1,
          });
        }
      } else {
        if (loopCount === -1) {
          if (deltaTime >= 0) {
            loopCount = 0;
            this._setEndings(true, this.repetitions === 0, pingPong);
          } else {
            this._setEndings(this.repetitions === 0, true, pingPong);
          }
        }
        if (time >= duration || time < 0) {
          const loopDelta = Math.floor(time / duration);
          time -= duration * loopDelta;
          loopCount += Math.abs(loopDelta);
          const pending = this.repetitions - loopCount;
          if (pending <= 0) {
            if (this.clampWhenFinished) this.paused = true;
            else this.enabled = false;
            time = deltaTime > 0 ? duration : 0;
            this.time = time;
            this._mixer.dispatchEvent({
              type: "finished",
              action: this,
              direction: deltaTime > 0 ? 1 : -1,
            });
          } else {
            if (pending === 1) {
              const atStart = deltaTime < 0;
              this._setEndings(atStart, !atStart, pingPong);
            } else {
              this._setEndings(false, false, pingPong);
            }
            this._loopCount = loopCount;
            this.time = time;
            this._mixer.dispatchEvent({
              type: "loop",
              action: this,
              loopDelta,
            });
          }
        } else {
          this._loopCount = loopCount;
          this.time = time;
        }
        if (pingPong && (loopCount & 1) === 1) return duration - time;
      }
      return time;
    }
    _setEndings(atStart, atEnd, pingPong) {
      const settings = this._interpolantSettings;
      if (pingPong) {
        settings.endingStart = TN.ZeroSlopeEnding ?? 2401;
        settings.endingEnd = TN.ZeroSlopeEnding ?? 2401;
      } else {
        if (atStart) {
          settings.endingStart = this.zeroSlopeAtStart
            ? TN.ZeroSlopeEnding ?? 2401
            : TN.ZeroCurvatureEnding ?? 2400;
        } else {
          settings.endingStart = TN.WrapAroundEnding ?? 2402;
        }
        if (atEnd) {
          settings.endingEnd = this.zeroSlopeAtEnd
            ? TN.ZeroSlopeEnding ?? 2401
            : TN.ZeroCurvatureEnding ?? 2400;
        } else {
          settings.endingEnd = TN.WrapAroundEnding ?? 2402;
        }
      }
    }
    _scheduleFading(duration, weightNow, weightThen) {
      const mixer = this._mixer;
      const now = mixer.time;
      let interpolant = this._weightInterpolant;
      if (interpolant === null) {
        interpolant = mixer._lendControlInterpolant();
        this._weightInterpolant = interpolant;
      }
      const times = interpolant.parameterPositions;
      const values = interpolant.sampleValues;
      times[0] = now;
      values[0] = weightNow;
      times[1] = now + duration;
      values[1] = weightThen;
      return this;
    }
  }

  const _controlInterpolantsResultBuffer = new Float32Array(1);

  class AnimationMixer extends DispatcherBase {
    constructor(root) {
      super();
      this._root = root;
      this._initMemoryManager();
      this._accuIndex = 0;
      this.time = 0;
      this.timeScale = 1;
    }
    _bindAction(action, prototypeAction) {
      const root = action._localRoot || this._root;
      const tracks = action._clip.tracks;
      const nTracks = tracks.length;
      const bindings = action._propertyBindings;
      const interpolants = action._interpolants;
      const rootUuid = root.uuid;
      const bindingsByRoot = this._bindingsByRootAndName;
      let bindingsByName = bindingsByRoot[rootUuid];
      if (bindingsByName === undefined) {
        bindingsByName = {};
        bindingsByRoot[rootUuid] = bindingsByName;
      }
      for (let i = 0; i !== nTracks; ++i) {
        const track = tracks[i];
        const trackName = track.name;
        let binding = bindingsByName[trackName];
        if (binding !== undefined) {
          ++binding.referenceCount;
          bindings[i] = binding;
        } else {
          binding = bindings[i];
          if (binding !== undefined) {
            if (binding._cacheIndex === null) {
              ++binding.referenceCount;
              this._addInactiveBinding(binding, rootUuid, trackName);
            }
            continue;
          }
          const path = prototypeAction && prototypeAction._propertyBindings[i].binding.parsedPath;
          binding = new PropertyMixer(
            PropertyBinding.create(root, trackName, path),
            track.ValueTypeName,
            track.getValueSize()
          );
          ++binding.referenceCount;
          this._addInactiveBinding(binding, rootUuid, trackName);
          bindings[i] = binding;
        }
        interpolants[i].resultBuffer = binding.buffer;
      }
    }
    _activateAction(action) {
      if (!this._isActiveAction(action)) {
        if (action._cacheIndex === null) {
          const rootUuid = (action._localRoot || this._root).uuid;
          const clipUuid = action._clip.uuid;
          const actionsForClip = this._actionsByClip[clipUuid];
          this._bindAction(action, actionsForClip && actionsForClip.knownActions[0]);
          this._addInactiveAction(action, clipUuid, rootUuid);
        }
        const bindings = action._propertyBindings;
        for (let i = 0, n = bindings.length; i !== n; ++i) {
          const binding = bindings[i];
          if (binding.useCount++ === 0) {
            this._lendBinding(binding);
            binding.saveOriginalState();
          }
        }
        this._lendAction(action);
      }
    }
    _deactivateAction(action) {
      if (this._isActiveAction(action)) {
        const bindings = action._propertyBindings;
        for (let i = 0, n = bindings.length; i !== n; ++i) {
          const binding = bindings[i];
          if (--binding.useCount === 0) {
            binding.restoreOriginalState();
            this._takeBackBinding(binding);
          }
        }
        this._takeBackAction(action);
      }
    }
    _initMemoryManager() {
      this._actions = [];
      this._nActiveActions = 0;
      this._actionsByClip = {};
      this._bindings = [];
      this._nActiveBindings = 0;
      this._bindingsByRootAndName = {};
      this._controlInterpolants = [];
      this._nActiveControlInterpolants = 0;
      const scope = this;
      this.stats = {
        actions: {
          get total() {
            return scope._actions.length;
          },
          get inUse() {
            return scope._nActiveActions;
          },
        },
        bindings: {
          get total() {
            return scope._bindings.length;
          },
          get inUse() {
            return scope._nActiveBindings;
          },
        },
        controlInterpolants: {
          get total() {
            return scope._controlInterpolants.length;
          },
          get inUse() {
            return scope._nActiveControlInterpolants;
          },
        },
      };
    }
    _isActiveAction(action) {
      const index = action._cacheIndex;
      return index !== null && index < this._nActiveActions;
    }
    _addInactiveAction(action, clipUuid, rootUuid) {
      const actions = this._actions;
      const actionsByClip = this._actionsByClip;
      let actionsForClip = actionsByClip[clipUuid];
      if (actionsForClip === undefined) {
        actionsForClip = {
          knownActions: [action],
          actionByRoot: {},
        };
        action._byClipCacheIndex = 0;
        actionsByClip[clipUuid] = actionsForClip;
      } else {
        const knownActions = actionsForClip.knownActions;
        action._byClipCacheIndex = knownActions.length;
        knownActions.push(action);
      }
      action._cacheIndex = actions.length;
      actions.push(action);
      actionsForClip.actionByRoot[rootUuid] = action;
    }
    _removeInactiveAction(action) {
      const actions = this._actions;
      const lastInactiveAction = actions[actions.length - 1];
      const cacheIndex = action._cacheIndex;
      lastInactiveAction._cacheIndex = cacheIndex;
      actions[cacheIndex] = lastInactiveAction;
      actions.pop();
      action._cacheIndex = null;
      const clipUuid = action._clip.uuid;
      const actionsByClip = this._actionsByClip;
      const actionsForClip = actionsByClip[clipUuid];
      const knownActionsForClip = actionsForClip.knownActions;
      const lastKnownAction = knownActionsForClip[knownActionsForClip.length - 1];
      const byClipCacheIndex = action._byClipCacheIndex;
      lastKnownAction._byClipCacheIndex = byClipCacheIndex;
      knownActionsForClip[byClipCacheIndex] = lastKnownAction;
      knownActionsForClip.pop();
      action._byClipCacheIndex = null;
      const actionByRoot = actionsForClip.actionByRoot;
      const rootUuid = (action._localRoot || this._root).uuid;
      delete actionByRoot[rootUuid];
      if (knownActionsForClip.length === 0) delete actionsByClip[clipUuid];
      this._removeInactiveBindingsForAction(action);
    }
    _removeInactiveBindingsForAction(action) {
      const bindings = action._propertyBindings;
      for (let i = 0, n = bindings.length; i !== n; ++i) {
        const binding = bindings[i];
        if (--binding.referenceCount === 0) this._removeInactiveBinding(binding);
      }
    }
    _lendAction(action) {
      const actions = this._actions;
      const prevIndex = action._cacheIndex;
      const lastActiveIndex = this._nActiveActions++;
      const firstInactiveAction = actions[lastActiveIndex];
      action._cacheIndex = lastActiveIndex;
      actions[lastActiveIndex] = action;
      firstInactiveAction._cacheIndex = prevIndex;
      actions[prevIndex] = firstInactiveAction;
    }
    _takeBackAction(action) {
      const actions = this._actions;
      const prevIndex = action._cacheIndex;
      const firstInactiveIndex = --this._nActiveActions;
      const lastActiveAction = actions[firstInactiveIndex];
      action._cacheIndex = firstInactiveIndex;
      actions[firstInactiveIndex] = action;
      lastActiveAction._cacheIndex = prevIndex;
      actions[prevIndex] = lastActiveAction;
    }
    _addInactiveBinding(binding, rootUuid, trackName) {
      const bindingsByRoot = this._bindingsByRootAndName;
      const bindings = this._bindings;
      let bindingByName = bindingsByRoot[rootUuid];
      if (bindingByName === undefined) {
        bindingByName = {};
        bindingsByRoot[rootUuid] = bindingByName;
      }
      bindingByName[trackName] = binding;
      binding._cacheIndex = bindings.length;
      bindings.push(binding);
    }
    _removeInactiveBinding(binding) {
      const bindings = this._bindings;
      const propBinding = binding.binding;
      const rootUuid = propBinding.rootNode.uuid;
      const trackName = propBinding.path;
      const bindingsByRoot = this._bindingsByRootAndName;
      const bindingByName = bindingsByRoot[rootUuid];
      const lastInactiveBinding = bindings[bindings.length - 1];
      const cacheIndex = binding._cacheIndex;
      lastInactiveBinding._cacheIndex = cacheIndex;
      bindings[cacheIndex] = lastInactiveBinding;
      bindings.pop();
      delete bindingByName[trackName];
      if (Object.keys(bindingByName).length === 0) delete bindingsByRoot[rootUuid];
    }
    _lendBinding(binding) {
      const bindings = this._bindings;
      const prevIndex = binding._cacheIndex;
      const lastActiveIndex = this._nActiveBindings++;
      const firstInactiveBinding = bindings[lastActiveIndex];
      binding._cacheIndex = lastActiveIndex;
      bindings[lastActiveIndex] = binding;
      firstInactiveBinding._cacheIndex = prevIndex;
      bindings[prevIndex] = firstInactiveBinding;
    }
    _takeBackBinding(binding) {
      const bindings = this._bindings;
      const prevIndex = binding._cacheIndex;
      const firstInactiveIndex = --this._nActiveBindings;
      const lastActiveBinding = bindings[firstInactiveIndex];
      binding._cacheIndex = firstInactiveIndex;
      bindings[firstInactiveIndex] = binding;
      lastActiveBinding._cacheIndex = prevIndex;
      bindings[prevIndex] = lastActiveBinding;
    }
    _lendControlInterpolant() {
      const interpolants = this._controlInterpolants;
      const lastActiveIndex = this._nActiveControlInterpolants++;
      let interpolant = interpolants[lastActiveIndex];
      if (interpolant === undefined) {
        interpolant = new LinearInterpolant(
          new Float32Array(2),
          new Float32Array(2),
          1,
          _controlInterpolantsResultBuffer
        );
        interpolant.__cacheIndex = lastActiveIndex;
        interpolants[lastActiveIndex] = interpolant;
      }
      return interpolant;
    }
    _takeBackControlInterpolant(interpolant) {
      const interpolants = this._controlInterpolants;
      const prevIndex = interpolant.__cacheIndex;
      const firstInactiveIndex = --this._nActiveControlInterpolants;
      const lastActiveInterpolant = interpolants[firstInactiveIndex];
      interpolant.__cacheIndex = firstInactiveIndex;
      interpolants[firstInactiveIndex] = interpolant;
      lastActiveInterpolant.__cacheIndex = prevIndex;
      interpolants[prevIndex] = lastActiveInterpolant;
    }
    clipAction(clip, optionalRoot, blendMode) {
      const root = optionalRoot || this._root;
      const rootUuid = root.uuid;
      let clipObject = typeof clip === "string" ? AnimationClip.findByName(root, clip) : clip;
      const clipUuid = clipObject !== null ? clipObject.uuid : clip;
      const actionsForClip = this._actionsByClip[clipUuid];
      let prototypeAction = null;
      if (blendMode === undefined) {
        blendMode = clipObject !== null
          ? clipObject.blendMode
          : TN.NormalAnimationBlendMode ?? 2500;
      }
      if (actionsForClip !== undefined) {
        const existingAction = actionsForClip.actionByRoot[rootUuid];
        if (existingAction !== undefined && existingAction.blendMode === blendMode) {
          return existingAction;
        }
        prototypeAction = actionsForClip.knownActions[0];
        if (clipObject === null) clipObject = prototypeAction._clip;
      }
      if (clipObject === null) return null;
      const newAction = new AnimationAction(this, clipObject, optionalRoot, blendMode);
      let idx = 0;
      if (typeof clipObject._index === "number") idx = clipObject._index;
      else if (root && Array.isArray(root.animations)) {
        const found = root.animations.indexOf(clipObject);
        if (found >= 0) idx = found;
      }
      newAction._clipIndex = idx;
      this._bindAction(newAction, prototypeAction);
      this._addInactiveAction(newAction, clipUuid, rootUuid);
      return newAction;
    }
    existingAction(clip, optionalRoot) {
      const root = optionalRoot || this._root;
      const rootUuid = root.uuid;
      const clipObject = typeof clip === "string" ? AnimationClip.findByName(root, clip) : clip;
      const clipUuid = clipObject ? clipObject.uuid : clip;
      const actionsForClip = this._actionsByClip[clipUuid];
      if (actionsForClip !== undefined) return actionsForClip.actionByRoot[rootUuid] || null;
      return null;
    }
    stopAllAction() {
      const actions = this._actions;
      const nActions = this._nActiveActions;
      for (let i = nActions - 1; i >= 0; --i) actions[i].stop();
      return this;
    }
    update(deltaTime) {
      deltaTime *= this.timeScale;
      const actions = this._actions;
      const nActions = this._nActiveActions;
      const time = this.time += deltaTime;
      const timeDirection = Math.sign(deltaTime);
      const accuIndex = this._accuIndex ^= 1;
      for (let i = 0; i !== nActions; ++i) {
        actions[i]._update(time, deltaTime, timeDirection, accuIndex);
      }
      const bindings = this._bindings;
      const nBindings = this._nActiveBindings;
      for (let i = 0; i !== nBindings; ++i) {
        bindings[i].apply(accuIndex);
      }
      return this;
    }
    setTime(timeInSeconds) {
      this.time = 0;
      for (let i = 0; i < this._actions.length; i++) this._actions[i].time = 0;
      return this.update(timeInSeconds);
    }
    getRoot() {
      return this._root;
    }
    uncacheClip(clip) {
      const actions = this._actions;
      const clipUuid = clip.uuid;
      const actionsByClip = this._actionsByClip;
      const actionsForClip = actionsByClip[clipUuid];
      if (actionsForClip !== undefined) {
        const actionsToRemove = actionsForClip.knownActions;
        for (let i = 0, n = actionsToRemove.length; i !== n; ++i) {
          const action = actionsToRemove[i];
          this._deactivateAction(action);
          const cacheIndex = action._cacheIndex;
          const lastInactiveAction = actions[actions.length - 1];
          action._cacheIndex = null;
          action._byClipCacheIndex = null;
          lastInactiveAction._cacheIndex = cacheIndex;
          actions[cacheIndex] = lastInactiveAction;
          actions.pop();
          this._removeInactiveBindingsForAction(action);
        }
        delete actionsByClip[clipUuid];
      }
      return this;
    }
    uncacheRoot(root) {
      const rootUuid = root.uuid;
      const actionsByClip = this._actionsByClip;
      for (const clipUuid in actionsByClip) {
        const actionByRoot = actionsByClip[clipUuid].actionByRoot;
        const action = actionByRoot[rootUuid];
        if (action !== undefined) {
          this._deactivateAction(action);
          this._removeInactiveAction(action);
        }
      }
      const bindingsByRoot = this._bindingsByRootAndName;
      const bindingByName = bindingsByRoot[rootUuid];
      if (bindingByName !== undefined) {
        for (const trackName in bindingByName) {
          const binding = bindingByName[trackName];
          binding.restoreOriginalState();
          this._removeInactiveBinding(binding);
        }
      }
      return this;
    }
    uncacheAction(clip, optionalRoot) {
      const action = this.existingAction(clip, optionalRoot);
      if (action !== null) {
        this._deactivateAction(action);
        this._removeInactiveAction(action);
      }
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

  const _RESERVED_CHARS_RE = "\\[\\]\\.:\\/";
  const _reservedRe = new RegExp("[" + _RESERVED_CHARS_RE + "]", "g");
  const _wordChar = "[^" + _RESERVED_CHARS_RE + "]";
  const _wordCharOrDot = "[^" + _RESERVED_CHARS_RE.replace("\\.", "") + "]";
  const _directoryRe = /((?:WC+[\/:])*)/.source.replace("WC", _wordChar);
  const _nodeRe = /(WCOD+)?/.source.replace("WCOD", _wordCharOrDot);
  const _objectRe = /(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC", _wordChar);
  const _propertyRe = /\.(WC+)(?:\[(.+)\])?/.source.replace("WC", _wordChar);
  const _trackRe = new RegExp("" + "^" + _directoryRe + _nodeRe + _objectRe + _propertyRe + "$");
  const _supportedObjectNames = ["material", "materials", "bones", "map"];

  class CompositePropertyBinding {
    constructor(targetGroup, path, optionalParsedPath) {
      const parsedPath = optionalParsedPath || PropertyBinding.parseTrackName(path);
      this._targetGroup = targetGroup;
      this._bindings = targetGroup.subscribe_(path, parsedPath);
    }
    getValue(array, offset) {
      this.bind();
      const firstValidIndex = this._targetGroup.nCachedObjects_;
      const binding = this._bindings[firstValidIndex];
      if (binding !== undefined) binding.getValue(array, offset);
    }
    setValue(array, offset) {
      const bindings = this._bindings;
      for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i) {
        bindings[i].setValue(array, offset);
      }
    }
    bind() {
      const bindings = this._bindings;
      for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i) {
        bindings[i].bind();
      }
    }
    unbind() {
      const bindings = this._bindings;
      for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i) {
        bindings[i].unbind();
      }
    }
  }

  class PropertyBinding {
    constructor(rootNode, path, parsedPath) {
      this.path = path;
      this.parsedPath = parsedPath || PropertyBinding.parseTrackName(path);
      this.node = PropertyBinding.findNode(rootNode, this.parsedPath.nodeName);
      this.rootNode = rootNode;
      this.getValue = this._getValue_unbound;
      this.setValue = this._setValue_unbound;
    }
    static create(root, path, parsedPath) {
      if (!(root && root.isAnimationObjectGroup)) {
        return new PropertyBinding(root, path, parsedPath);
      }
      return new PropertyBinding.Composite(root, path, parsedPath);
    }
    static sanitizeNodeName(name) {
      return name.replace(/\s/g, "_").replace(_reservedRe, "");
    }
    static parseTrackName(trackName) {
      const matches = _trackRe.exec(trackName);
      if (matches === null) {
        throw new Error("THREE.PropertyBinding: Cannot parse trackName: " + trackName);
      }
      const results = {
        nodeName: matches[2],
        objectName: matches[3],
        objectIndex: matches[4],
        propertyName: matches[5],
        propertyIndex: matches[6],
      };
      const lastDot = results.nodeName && results.nodeName.lastIndexOf(".");
      if (lastDot !== undefined && lastDot !== -1) {
        const objectName = results.nodeName.substring(lastDot + 1);
        if (_supportedObjectNames.indexOf(objectName) !== -1) {
          results.nodeName = results.nodeName.substring(0, lastDot);
          results.objectName = objectName;
        }
      }
      if (results.propertyName === null || results.propertyName.length === 0) {
        throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: " + trackName);
      }
      return results;
    }
    static findNode(root, nodeName) {
      if (
        nodeName === undefined ||
        nodeName === "" ||
        nodeName === "." ||
        nodeName === -1 ||
        nodeName === root.name ||
        nodeName === root.uuid
      ) {
        return root;
      }
      if (root.skeleton) {
        const bone = root.skeleton.getBoneByName?.(nodeName);
        if (bone !== undefined) return bone;
      }
      if (root.children) {
        const searchNodeSubtree = function (children) {
          for (let i = 0; i < children.length; i++) {
            const childNode = children[i];
            if (childNode.name === nodeName || childNode.uuid === nodeName) return childNode;
            const result = searchNodeSubtree(childNode.children);
            if (result) return result;
          }
          return null;
        };
        const subTreeNode = searchNodeSubtree(root.children);
        if (subTreeNode) return subTreeNode;
      }
      if (typeof root.getObjectByName === "function") {
        const named = root.getObjectByName(nodeName);
        if (named) return named;
      }
      return null;
    }
    _getValue_unavailable() {}
    _setValue_unavailable() {}
    _getValue_direct(buffer, offset) {
      buffer[offset] = this.targetObject[this.propertyName];
    }
    _getValue_array(buffer, offset) {
      const source = this.resolvedProperty;
      for (let i = 0, n = source.length; i !== n; ++i) buffer[offset++] = source[i];
    }
    _getValue_arrayElement(buffer, offset) {
      buffer[offset] = this.resolvedProperty[this.propertyIndex];
    }
    _getValue_toArray(buffer, offset) {
      this.resolvedProperty.toArray(buffer, offset);
    }
    _setValue_direct(buffer, offset) {
      this.targetObject[this.propertyName] = buffer[offset];
    }
    _setValue_direct_setNeedsUpdate(buffer, offset) {
      this.targetObject[this.propertyName] = buffer[offset];
      this.targetObject.needsUpdate = true;
    }
    _setValue_direct_setMatrixWorldNeedsUpdate(buffer, offset) {
      this.targetObject[this.propertyName] = buffer[offset];
      this.targetObject.matrixWorldNeedsUpdate = true;
    }
    _setValue_array(buffer, offset) {
      const dest = this.resolvedProperty;
      for (let i = 0, n = dest.length; i !== n; ++i) dest[i] = buffer[offset++];
    }
    _setValue_array_setNeedsUpdate(buffer, offset) {
      const dest = this.resolvedProperty;
      for (let i = 0, n = dest.length; i !== n; ++i) dest[i] = buffer[offset++];
      this.targetObject.needsUpdate = true;
    }
    _setValue_array_setMatrixWorldNeedsUpdate(buffer, offset) {
      const dest = this.resolvedProperty;
      for (let i = 0, n = dest.length; i !== n; ++i) dest[i] = buffer[offset++];
      this.targetObject.matrixWorldNeedsUpdate = true;
    }
    _setValue_arrayElement(buffer, offset) {
      this.resolvedProperty[this.propertyIndex] = buffer[offset];
    }
    _setValue_arrayElement_setNeedsUpdate(buffer, offset) {
      this.resolvedProperty[this.propertyIndex] = buffer[offset];
      this.targetObject.needsUpdate = true;
    }
    _setValue_arrayElement_setMatrixWorldNeedsUpdate(buffer, offset) {
      this.resolvedProperty[this.propertyIndex] = buffer[offset];
      this.targetObject.matrixWorldNeedsUpdate = true;
    }
    _setValue_fromArray(buffer, offset) {
      this.resolvedProperty.fromArray(buffer, offset);
    }
    _setValue_fromArray_setNeedsUpdate(buffer, offset) {
      this.resolvedProperty.fromArray(buffer, offset);
      this.targetObject.needsUpdate = true;
    }
    _setValue_fromArray_setMatrixWorldNeedsUpdate(buffer, offset) {
      this.resolvedProperty.fromArray(buffer, offset);
      this.targetObject.matrixWorldNeedsUpdate = true;
    }
    _getValue_unbound(targetArray, offset) {
      this.bind();
      this.getValue(targetArray, offset);
    }
    _setValue_unbound(sourceArray, offset) {
      this.bind();
      this.setValue(sourceArray, offset);
    }
    bind() {
      let targetObject = this.node;
      const parsedPath = this.parsedPath;
      const objectName = parsedPath.objectName;
      const propertyName = parsedPath.propertyName;
      let propertyIndex = parsedPath.propertyIndex;
      if (!targetObject) {
        targetObject = PropertyBinding.findNode(this.rootNode, parsedPath.nodeName);
        this.node = targetObject;
      }
      this.getValue = this._getValue_unavailable;
      this.setValue = this._setValue_unavailable;
      if (!targetObject) return;
      if (objectName) {
        let objectIndex = parsedPath.objectIndex;
        switch (objectName) {
          case "materials":
            if (!targetObject.material?.materials) return;
            targetObject = targetObject.material.materials;
            break;
          case "bones":
            if (!targetObject.skeleton) return;
            targetObject = targetObject.skeleton.bones;
            for (let i = 0; i < targetObject.length; i++) {
              if (targetObject[i].name === objectIndex) {
                objectIndex = i;
                break;
              }
            }
            break;
          case "map":
            if ("map" in targetObject) {
              targetObject = targetObject.map;
              break;
            }
            if (!targetObject.material?.map) return;
            targetObject = targetObject.material.map;
            break;
          default:
            if (targetObject[objectName] === undefined) return;
            targetObject = targetObject[objectName];
        }
        if (objectIndex !== undefined) {
          if (targetObject[objectIndex] === undefined) return;
          targetObject = targetObject[objectIndex];
        }
      }
      const nodeProperty = targetObject[propertyName];
      if (nodeProperty === undefined) return;
      let versioning = this.Versioning.None;
      this.targetObject = targetObject;
      if (targetObject.isMaterial === true) versioning = this.Versioning.NeedsUpdate;
      else if (targetObject.isObject3D === true) versioning = this.Versioning.MatrixWorldNeedsUpdate;
      let bindingType = this.BindingType.Direct;
      if (propertyIndex !== undefined) {
        if (propertyName === "morphTargetInfluences") {
          if (!targetObject.geometry?.morphAttributes) return;
          if (targetObject.morphTargetDictionary?.[propertyIndex] !== undefined) {
            propertyIndex = targetObject.morphTargetDictionary[propertyIndex];
          }
        }
        bindingType = this.BindingType.ArrayElement;
        this.resolvedProperty = nodeProperty;
        this.propertyIndex = propertyIndex;
      } else if (nodeProperty.fromArray !== undefined && nodeProperty.toArray !== undefined) {
        bindingType = this.BindingType.HasFromToArray;
        this.resolvedProperty = nodeProperty;
      } else if (Array.isArray(nodeProperty)) {
        bindingType = this.BindingType.EntireArray;
        this.resolvedProperty = nodeProperty;
      } else {
        this.propertyName = propertyName;
      }
      this.getValue = this.GetterByBindingType[bindingType];
      this.setValue = this.SetterByBindingTypeAndVersioning[bindingType][versioning];
    }
    unbind() {
      this.node = null;
      this.getValue = this._getValue_unbound;
      this.setValue = this._setValue_unbound;
    }
  }
  PropertyBinding.Composite = CompositePropertyBinding;
  PropertyBinding.prototype.BindingType = {
    Direct: 0,
    EntireArray: 1,
    ArrayElement: 2,
    HasFromToArray: 3,
  };
  PropertyBinding.prototype.Versioning = {
    None: 0,
    NeedsUpdate: 1,
    MatrixWorldNeedsUpdate: 2,
  };
  PropertyBinding.prototype.GetterByBindingType = [
    PropertyBinding.prototype._getValue_direct,
    PropertyBinding.prototype._getValue_array,
    PropertyBinding.prototype._getValue_arrayElement,
    PropertyBinding.prototype._getValue_toArray,
  ];
  PropertyBinding.prototype.SetterByBindingTypeAndVersioning = [
    [
      PropertyBinding.prototype._setValue_direct,
      PropertyBinding.prototype._setValue_direct_setNeedsUpdate,
      PropertyBinding.prototype._setValue_direct_setMatrixWorldNeedsUpdate,
    ],
    [
      PropertyBinding.prototype._setValue_array,
      PropertyBinding.prototype._setValue_array_setNeedsUpdate,
      PropertyBinding.prototype._setValue_array_setMatrixWorldNeedsUpdate,
    ],
    [
      PropertyBinding.prototype._setValue_arrayElement,
      PropertyBinding.prototype._setValue_arrayElement_setNeedsUpdate,
      PropertyBinding.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate,
    ],
    [
      PropertyBinding.prototype._setValue_fromArray,
      PropertyBinding.prototype._setValue_fromArray_setNeedsUpdate,
      PropertyBinding.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate,
    ],
  ];

  class PropertyMixer {
    constructor(binding, typeName, valueSize) {
      this.binding = binding;
      this.typeName = typeName;
      this.valueSize = valueSize || 1;
      let mixFunction;
      let mixFunctionAdditive;
      let setIdentity;
      switch (typeName) {
        case "quaternion":
          mixFunction = this._slerp;
          mixFunctionAdditive = this._slerpAdditive;
          setIdentity = this._setAdditiveIdentityQuaternion;
          this.buffer = new Float64Array(this.valueSize * 6);
          this._workIndex = 5;
          break;
        case "string":
        case "bool":
          mixFunction = this._select;
          mixFunctionAdditive = this._select;
          setIdentity = this._setAdditiveIdentityOther;
          this.buffer = new Array(this.valueSize * 5);
          break;
        default:
          mixFunction = this._lerp;
          mixFunctionAdditive = this._lerpAdditive;
          setIdentity = this._setAdditiveIdentityNumeric;
          this.buffer = new Float64Array(this.valueSize * 5);
      }
      this._mixBufferRegion = mixFunction;
      this._mixBufferRegionAdditive = mixFunctionAdditive;
      this._setIdentity = setIdentity;
      this._origIndex = 3;
      this._addIndex = 4;
      this.cumulativeWeight = 0;
      this.cumulativeWeightAdditive = 0;
      this.useCount = 0;
      this.referenceCount = 0;
      this._cacheIndex = null;
    }
    accumulate(accuIndex, weight) {
      const buffer = this.buffer;
      const stride = this.valueSize;
      const offset = accuIndex * stride + stride;
      let currentWeight = this.cumulativeWeight;
      if (currentWeight === 0) {
        for (let i = 0; i !== stride; ++i) buffer[offset + i] = buffer[i];
        currentWeight = weight;
      } else {
        currentWeight += weight;
        const mix = weight / currentWeight;
        this._mixBufferRegion(buffer, offset, 0, mix, stride);
      }
      this.cumulativeWeight = currentWeight;
    }
    accumulateAdditive(weight) {
      const buffer = this.buffer;
      const stride = this.valueSize;
      const offset = stride * this._addIndex;
      if (this.cumulativeWeightAdditive === 0) this._setIdentity();
      this._mixBufferRegionAdditive(buffer, offset, 0, weight, stride);
      this.cumulativeWeightAdditive += weight;
    }
    apply(accuIndex) {
      const stride = this.valueSize;
      const buffer = this.buffer;
      const offset = accuIndex * stride + stride;
      const weight = this.cumulativeWeight;
      const weightAdditive = this.cumulativeWeightAdditive;
      const binding = this.binding;
      this.cumulativeWeight = 0;
      this.cumulativeWeightAdditive = 0;
      if (weight < 1) {
        const originalValueOffset = stride * this._origIndex;
        this._mixBufferRegion(buffer, offset, originalValueOffset, 1 - weight, stride);
      }
      if (weightAdditive > 0) {
        this._mixBufferRegionAdditive(buffer, offset, this._addIndex * stride, 1, stride);
      }
      for (let i = stride, e = stride + stride; i !== e; ++i) {
        if (buffer[i] !== buffer[i + stride]) {
          binding.setValue(buffer, offset);
          break;
        }
      }
    }
    saveOriginalState() {
      const binding = this.binding;
      const buffer = this.buffer;
      const stride = this.valueSize;
      const originalValueOffset = stride * this._origIndex;
      binding.getValue(buffer, originalValueOffset);
      for (let i = stride, e = originalValueOffset; i !== e; ++i) {
        buffer[i] = buffer[originalValueOffset + (i % stride)];
      }
      this._setIdentity();
      this.cumulativeWeight = 0;
      this.cumulativeWeightAdditive = 0;
    }
    restoreOriginalState() {
      const originalValueOffset = this.valueSize * 3;
      this.binding.setValue(this.buffer, originalValueOffset);
    }
    _setAdditiveIdentityNumeric() {
      const startIndex = this._addIndex * this.valueSize;
      const endIndex = startIndex + this.valueSize;
      for (let i = startIndex; i < endIndex; i++) this.buffer[i] = 0;
    }
    _setAdditiveIdentityQuaternion() {
      this._setAdditiveIdentityNumeric();
      this.buffer[this._addIndex * this.valueSize + 3] = 1;
    }
    _setAdditiveIdentityOther() {
      const startIndex = this._origIndex * this.valueSize;
      const targetIndex = this._addIndex * this.valueSize;
      for (let i = 0; i < this.valueSize; i++) {
        this.buffer[targetIndex + i] = this.buffer[startIndex + i];
      }
    }
    _select(buffer, dstOffset, srcOffset, t, stride) {
      if (t >= 0.5) {
        for (let i = 0; i !== stride; ++i) buffer[dstOffset + i] = buffer[srcOffset + i];
      }
    }
    _slerp(buffer, dstOffset, srcOffset, t) {
      TN.Quaternion.slerpFlat(buffer, dstOffset, buffer, dstOffset, buffer, srcOffset, t);
    }
    _slerpAdditive(buffer, dstOffset, srcOffset, t, stride) {
      const workOffset = this._workIndex * stride;
      TN.Quaternion.multiplyQuaternionsFlat(buffer, workOffset, buffer, dstOffset, buffer, srcOffset);
      TN.Quaternion.slerpFlat(buffer, dstOffset, buffer, dstOffset, buffer, workOffset, t);
    }
    _lerp(buffer, dstOffset, srcOffset, t, stride) {
      const s = 1 - t;
      for (let i = 0; i !== stride; ++i) {
        const j = dstOffset + i;
        buffer[j] = buffer[j] * s + buffer[srcOffset + i] * t;
      }
    }
    _lerpAdditive(buffer, dstOffset, srcOffset, t, stride) {
      for (let i = 0; i !== stride; ++i) {
        const j = dstOffset + i;
        buffer[j] = buffer[j] + buffer[srcOffset + i] * t;
      }
    }
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
    WebGLUtils,
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
    Interpolant,
    LinearInterpolant,
    DiscreteInterpolant,
    CubicInterpolant,
    QuaternionLinearInterpolant,
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
