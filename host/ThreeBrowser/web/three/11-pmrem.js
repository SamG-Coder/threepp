(function (TN) {
  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  const ENV_KEY = Symbol("tnEnvironment");

  function allocHandle() {
    if (TN.cmd && typeof TN.cmd.alloc === "function") return TN.cmd.alloc();
    return 0;
  }

  function num(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
    return fallback;
  }

  function vec3(value, fallback) {
    const v = value && value.value !== undefined ? value.value : value;
    if (v && typeof v.x === "number") return [v.x, v.y, v.z];
    if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2]];
    return fallback;
  }

  function fromMaterial(material) {
    if (!material) return null;
    const list = Array.isArray(material) ? material : [material];
    for (let i = 0; i < list.length; i++) {
      const uniforms = list[i] && list[i].uniforms;
      if (!uniforms) continue;
      if (
        uniforms.sunPosition === undefined &&
        uniforms.turbidity === undefined &&
        uniforms.rayleigh === undefined
      ) {
        continue;
      }
      const sun = vec3(uniforms.sunPosition, [1, 0.45, 0.25]);
      return {
        sunX: sun[0],
        sunY: sun[1],
        sunZ: sun[2],
        turbidity: num(uniforms.turbidity, 2),
        rayleigh: num(uniforms.rayleigh, 1),
        mieCoefficient: num(uniforms.mieCoefficient, 0.005),
        mieDirectionalG: num(uniforms.mieDirectionalG, 0.8),
      };
    }
    return null;
  }

  function extractSkyFrom(object) {
    if (!object) return null;
    const direct = fromMaterial(object.material);
    if (direct) return direct;
    const children = object.children;
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        const found = extractSkyFrom(children[i]);
        if (found) return found;
      }
    }
    return null;
  }

  function extractSky(object) {
    return (
      extractSkyFrom(object) || {
        sunX: 1,
        sunY: 0.45,
        sunZ: 0.25,
        turbidity: 2,
        rayleigh: 1,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.8,
      }
    );
  }

  function makeTarget(handle) {
    const RT = TN.WebGLRenderTarget;
    const width = 256;
    const height = 128;
    const rt = typeof RT === "function" ? new RT(width, height) : { texture: { isTexture: true } };
    const tex = rt.texture || (rt.texture = { isTexture: true });
    tex._h = handle || 0;
    tex.mapping = TN.CubeUVReflectionMapping ?? 306;
    tex.colorSpace = TN.LinearSRGBColorSpace ?? "srgb-linear";
    tex.type = TN.FloatType ?? 1015;
    tex.generateMipmaps = true;
    tex.minFilter = TN.LinearMipmapLinearFilter ?? 1008;
    tex.magFilter = TN.LinearFilter ?? 1006;
    tex.wrapS = TN.RepeatWrapping ?? 1000;
    tex.wrapT = TN.ClampToEdgeWrapping ?? 1001;
    return rt;
  }

  function nativePmremFromSky(params) {
    const n = native();
    if (!TN.hostHas?.(n, "PmremFromSky")) return 0;
    const id = allocHandle();
    try {
      if (TN.cmd && typeof TN.cmd.submit === "function") TN.cmd.submit();
      return n.PmremFromSky(
        id,
        params.sunX,
        params.sunY,
        params.sunZ,
        params.turbidity,
        params.rayleigh,
        params.mieCoefficient,
        params.mieDirectionalG
      );
    } catch {
      return 0;
    }
  }

  function nativePmremFromTexture(kind, source) {
    const n = native();
    const name = kind === "cube" ? "PmremFromCubemap" : "PmremFromEquirect";
    if (!TN.hostHas?.(n, name)) return 0;
    const id = allocHandle();
    const srcH = source && source._h ? source._h : 0;
    try {
      if (TN.cmd && typeof TN.cmd.submit === "function") TN.cmd.submit();
      return n[name](id, srcH) || 0;
    } catch {
      return 0;
    }
  }

  function pushEnvironment(scene, texture) {
    const sceneH = scene && scene._h ? scene._h : 0;
    if (!sceneH) return;
    const texH = texture && texture._h ? texture._h : 0;
    if (globalThis.process?.env?.THREEBROWSER_TRACE_TEXTURES) {
      console.error(`ThreeBrowser environment: scene=${sceneH} texture=${texH}`);
    }
    if (texture) {
      if (!texture._environmentScenes) texture._environmentScenes = new Set();
      texture._environmentScenes.add(scene);
    }
    try {
      if (TN.cmd && typeof TN.cmd.submit === "function") TN.cmd.submit();
      const n = native();
      if (TN.hostHas?.(n, "SceneSetEnvironment")) {
        n.SceneSetEnvironment(sceneH, texH);
      }
    } catch {
      /* native environment optional until the scene slot exists */
    }
  }

  class PMREMGenerator {
    constructor(renderer) {
      this._renderer = renderer;
    }
    fromScene(scene, sigma, near, far) {
      void sigma;
      void near;
      void far;
      if (scene && typeof scene.updateMatrixWorld === "function") {
        scene.updateMatrixWorld(true);
      }
      if (scene && !scene._h && typeof scene.flushSelf === "function") {
        scene.flushSelf();
      }
      const n = native();
      try {
        if (TN.cmd && typeof TN.cmd.submit === "function") TN.cmd.submit();
      } catch {
        /* cmd ring may not be attached yet */
      }
      const objH = scene && scene._h ? scene._h : 0;
      if (objH && TN.hostHas?.(n, "PmremFromObject")) {
        const id = allocHandle();
        try {
          const handle = n.PmremFromObject(id, objH);
          if (handle) return makeTarget(handle);
        } catch (err) {
          console.warn("ThreeBrowser PMREMGenerator.fromScene", err);
        }
      }
      console.warn(
        "ThreeBrowser: fromScene captures the live object shader; not substituting a default sky"
      );
      return makeTarget(0);
    }
    fromEquirectangular(texture) {
      return makeTarget(nativePmremFromTexture("equirect", texture));
    }
    fromCubemap(texture) {
      return makeTarget(nativePmremFromTexture("cube", texture));
    }
    compileCubemapShader() {}
    compileEquirectangularShader() {}
    dispose() {}
  }

  TN.PMREMGenerator = PMREMGenerator;

  const Scene = TN.Scene;
  if (Scene && Scene.prototype) {
    Object.defineProperty(Scene.prototype, "environment", {
      configurable: true,
      enumerable: true,
      get() {
        return this[ENV_KEY] ?? null;
      },
      set(value) {
        this[ENV_KEY] = value ?? null;
        pushEnvironment(this, this[ENV_KEY]);
      },
    });
    // Scene() writes this.environment as an own data property, which would
    // shadow the prototype setter. Drop it so later assignments hit native IBL.
    const orig = Scene;
    function SceneEnv(...args) {
      const inst = new orig(...args);
      if (Object.prototype.hasOwnProperty.call(inst, "environment")) {
        const current = inst.environment;
        delete inst.environment;
        inst.environment = current;
      }
      return inst;
    }
    SceneEnv.prototype = orig.prototype;
    Object.defineProperty(SceneEnv, "name", { value: orig.name || "Scene" });
    Object.setPrototypeOf(SceneEnv, orig);
    TN.Scene = SceneEnv;
  }
})(globalThis.__TN = globalThis.__TN || {});
