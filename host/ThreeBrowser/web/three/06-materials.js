(function (TN) {
  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  let materialId = 0;

  const FrontSide = TN.FrontSide ?? 0;
  const NormalBlending = TN.NormalBlending ?? 1;
  const LessEqualDepth = TN.LessEqualDepth ?? 3;
  const SrcAlphaFactor = TN.SrcAlphaFactor ?? 204;
  const OneMinusSrcAlphaFactor = TN.OneMinusSrcAlphaFactor ?? 205;
  const AddEquation = TN.AddEquation ?? 100;
  const AlwaysStencilFunc = TN.AlwaysStencilFunc ?? 519;
  const KeepStencilOp = TN.KeepStencilOp ?? 7680;
  const MultiplyOperation = TN.MultiplyOperation ?? 0;
  const TangentSpaceNormalMap = TN.TangentSpaceNormalMap ?? 0;
  const BasicDepthPacking = TN.BasicDepthPacking ?? 3200;

  const Super = typeof TN.EventDispatcher === "function" ? TN.EventDispatcher : class {};

  function makeUUID() {
    if (TN.MathUtils && typeof TN.MathUtils.generateUUID === "function") {
      return TN.MathUtils.generateUUID();
    }
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function makeColor(value) {
    return value === undefined ? new TN.Color() : new TN.Color(value);
  }

  function makeVec2(x, y) {
    return TN.Vector2 ? new TN.Vector2(x, y) : { x: x, y: y, isVector2: true };
  }

  function makeVec3(x, y, z) {
    return TN.Vector3 ? new TN.Vector3(x, y, z) : { x: x, y: y, z: z, isVector3: true };
  }

  function makeEuler() {
    return TN.Euler ? new TN.Euler() : { x: 0, y: 0, z: 0, isEuler: true };
  }

  function isColorObj(value) {
    return !!(
      value &&
      (value.isColor ||
        (TN.Color && value instanceof TN.Color) ||
        (typeof value.r === "number" &&
          typeof value.set === "function" &&
          typeof value.getHex === "function"))
    );
  }

  function hasCopy(value) {
    return !!(
      value &&
      typeof value.copy === "function" &&
      (value.isVector2 ||
        value.isVector3 ||
        value.isVector4 ||
        value.isEuler ||
        value.isMatrix3 ||
        value.isMatrix4)
    );
  }

  function hex(color) {
    if (color == null) return 0xffffff;
    if (typeof color === "number" && Number.isFinite(color)) return color >>> 0;
    if (typeof color === "string") return makeColor(color).getHex() >>> 0;
    if (typeof color.getHex === "function") return color.getHex() >>> 0;
    if (typeof color.r === "number") {
      return (
        (((Math.round(color.r * 255) & 255) << 16) |
          ((Math.round(color.g * 255) & 255) << 8) |
          (Math.round(color.b * 255) & 255)) >>>
        0
      );
    }
    return 0xffffff;
  }

  const MAP_SLOTS = {
    map: 0,
    normalMap: 1,
    roughnessMap: 2,
    metalnessMap: 3,
    aoMap: 4,
    emissiveMap: 5,
  };

  function applyMapSlot(matId, slot, texId) {
    if (!matId || !texId) return;
    if (TN.cmd && typeof TN.cmd.matMapSlot === "function") TN.cmd.matMapSlot(matId, slot, texId);
    else {
      const n = native();
      if (n && typeof n.MaterialSetMapSlot === "function") n.MaterialSetMapSlot(matId, slot, texId);
      else if (n && slot === 0) n.MaterialSetMap(matId, texId);
    }
  }

  function bindMap(mat, texture, slot) {
    if (!texture || typeof texture !== "object") return;
    if (!texture._materials) texture._materials = [];
    if (texture._materials.indexOf(mat) < 0) texture._materials.push(mat);
    const matId = mat.__h || 0;
    if (!matId || !texture._h) return;
    applyMapSlot(matId, slot == null ? 0 : slot, texture._h);
  }

  function bindAllMaps(mat) {
    if (!mat) return;
    for (const key in MAP_SLOTS) {
      bindMap(mat, mat[key], MAP_SLOTS[key]);
    }
  }

  TN._bindMaterialMaps = bindAllMaps;

  function bindEmissive(mat) {
    const col = mat.emissive;
    if (!col || typeof col._onChange !== "function" || !mat.__h) return;
    const prev = col._onChangeCallback;
    col._onChange(function () {
      if (typeof prev === "function") prev.call(col);
      if (TN.cmd && mat.__h) TN.cmd.matEmissive(mat.__h, hex(col));
    });
  }

  // r129 ShaderChunk has encodings_fragment, not colorspace_fragment. Expand
  // the modern Sky includes to GLSL that the native GL prefix already supports
  // (toneMapping() / linearToOutputTexel()).
  function expandShaderChunks(src) {
    if (!src || typeof src !== "string") return "";
    return src
      .replace(
        /#include\s+<tonemapping_fragment>/g,
        "#if defined( TONE_MAPPING )\n\tgl_FragColor.rgb = toneMapping( gl_FragColor.rgb );\n#endif"
      )
      .replace(
        /#include\s+<colorspace_fragment>/g,
        "gl_FragColor = linearToOutputTexel( gl_FragColor );"
      )
      .replace(
        /#include\s+<encodings_fragment>/g,
        "gl_FragColor = linearToOutputTexel( gl_FragColor );"
      )
      .replace(/#include\s+<colorspace_pars_fragment>/g, "");
  }

  function uniformRawValue(entry) {
    if (entry == null) return undefined;
    if (typeof entry === "object" && "value" in entry) return entry.value;
    return entry;
  }

  function pushShaderUniform(n, handle, name, value) {
    if (!n || !handle || !name || value == null) return;
    try {
      if (typeof value === "boolean") {
        if (n.ShaderUniformFloat) n.ShaderUniformFloat(handle, name, value ? 1 : 0);
        return;
      }
      if (typeof value === "number") {
        if (Number.isFinite(value) && n.ShaderUniformFloat) {
          n.ShaderUniformFloat(handle, name, value);
        }
        return;
      }
      if (typeof value !== "object") return;
      if (value.isTexture || value.isCubeTexture) return;
      if (
        value.isColor ||
        (typeof value.r === "number" &&
          typeof value.g === "number" &&
          typeof value.b === "number" &&
          !value.isVector3)
      ) {
        if (n.ShaderUniformVec3) n.ShaderUniformVec3(handle, name, value.r, value.g, value.b);
        return;
      }
      if (value.isVector4 || typeof value.w === "number") {
        if (n.ShaderUniformVec4) {
          n.ShaderUniformVec4(handle, name, value.x, value.y, value.z, value.w);
        } else if (n.ShaderUniformVec3) {
          n.ShaderUniformVec3(handle, name, value.x, value.y, value.z);
        }
        return;
      }
      if (value.isVector3 || typeof value.z === "number") {
        if (n.ShaderUniformVec3) n.ShaderUniformVec3(handle, name, value.x, value.y, value.z);
        return;
      }
      if (value.isVector2 || typeof value.x === "number") {
        if (n.ShaderUniformVec2) n.ShaderUniformVec2(handle, name, value.x, value.y);
        else if (n.ShaderUniformVec3) n.ShaderUniformVec3(handle, name, value.x, value.y, 0);
      }
    } catch {
      /* COM may reject an unknown uniform type */
    }
  }

  function flushShaderUniforms(mat) {
    const n = native();
    if (!n || !mat.__h || !mat.uniforms) return;
    for (const name in mat.uniforms) {
      if (!Object.prototype.hasOwnProperty.call(mat.uniforms, name)) continue;
      pushShaderUniform(n, mat.__h, name, uniformRawValue(mat.uniforms[name]));
    }
  }

  function hookUniformLive(mat, name, entry) {
    if (!entry || typeof entry !== "object" || entry.__nativeHooked) return;
    entry.__nativeHooked = true;

    function push() {
      if (!mat.__h) return;
      const n = native();
      if (!n) return;
      pushShaderUniform(n, mat.__h, name, uniformRawValue(entry));
    }

    function hookVec(v) {
      if (!v || typeof v._onChange !== "function" || v.__shaderHooked) return;
      v.__shaderHooked = true;
      const prev = v._onChangeCallback;
      v._onChange(function () {
        if (typeof prev === "function") prev.call(v);
        push();
      });
    }

    hookVec(entry.value);
    let current = entry.value;
    Object.defineProperty(entry, "value", {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(v) {
        current = v;
        hookVec(v);
        push();
      },
    });
  }

  function bindShaderUniforms(mat) {
    const uniforms = mat.uniforms;
    if (!uniforms) return;
    for (const name in uniforms) {
      if (!Object.prototype.hasOwnProperty.call(uniforms, name)) continue;
      hookUniformLive(mat, name, uniforms[name]);
    }
    flushShaderUniforms(mat);
  }

  // COM insert() shares the native slot map with cmd.alloc()/insertAt.
  // Flush queued cmd ops first so g.next is past them, then burn JS ids
  // up through the COM handle so a later mesh alloc cannot collide.
  function absorbNativeId(handle) {
    if (!handle || !TN.cmd || typeof TN.cmd.alloc !== "function") return;
    let guard = 0;
    while (guard++ < 1000000) {
      const id = TN.cmd.alloc();
      if (id >= handle) break;
    }
  }

  function bindNative(mat) {
    if (mat.__bound || !mat._nativeKind) return;
    mat.__bound = true;
    const color = hex(mat.color);
    let handle = 0;
    if (TN.cmd && mat._nativeKind !== "shader") {
      handle = TN.cmd.alloc();
      if (mat._nativeKind === "basic") TN.cmd.matBasic(handle, color);
      else if (mat._nativeKind === "lambert") TN.cmd.matLambert(handle, color);
      else if (mat._nativeKind === "line") TN.cmd.matLine(handle, color, mat.linewidth ?? 1);
      else if (mat._nativeKind === "points") TN.cmd.matPoints(handle, color, mat.size ?? 1);
      else if (mat._nativeKind === "sprite") TN.cmd.matSprite(handle, color);
      else {
        const metal = mat._nativePbr ? mat._nativePbr.metalness : mat.metalness ?? 0;
        const rough = mat._nativePbr ? mat._nativePbr.roughness : mat.roughness ?? 1;
        TN.cmd.matStandard(handle, color, metal, rough);
      }
      if (handle) {
        if (mat.side != null) TN.cmd.matSide(handle, mat.side);
        mat.__h = handle;
        bindAllMaps(mat);
        bindEmissive(mat);
      }
      return;
    }
    const n = native();
    if (!n) return;
    if (mat._nativeKind === "basic" && n.MeshBasicMaterialCreate) {
      handle = n.MeshBasicMaterialCreate(color);
    } else if (mat._nativeKind === "lambert" && n.MeshLambertMaterialCreate) {
      handle = n.MeshLambertMaterialCreate(color);
    } else if (mat._nativeKind === "line" && typeof n.LineBasicMaterialCreate === "function") {
      try {
        handle = n.LineBasicMaterialCreate(color, mat.linewidth ?? 1);
      } catch {
        handle = 0;
      }
    } else if (mat._nativeKind === "points" && typeof n.PointsMaterialCreate === "function") {
      try {
        handle = n.PointsMaterialCreate(color, mat.size ?? 1);
      } catch {
        handle = 0;
      }
    } else if (mat._nativeKind === "sprite" && typeof n.SpriteMaterialCreate === "function") {
      try {
        handle = n.SpriteMaterialCreate(color);
      } catch {
        handle = 0;
      }
    } else if (mat._nativeKind === "shader" && typeof n.ShaderMaterialCreate === "function") {
      try {
        if (TN.cmd && typeof TN.cmd.submit === "function") {
          try {
            TN.cmd.submit();
          } catch {
            /* cmd ring may not be attached yet */
          }
        }
        handle = n.ShaderMaterialCreate(
          expandShaderChunks(mat.vertexShader || ""),
          expandShaderChunks(mat.fragmentShader || "")
        );
        absorbNativeId(handle);
      } catch {
        handle = 0;
      }
      mat.__h = handle || 0;
      if (mat.__h) {
        try {
          if (typeof n.ShaderSetFlags === "function") {
            n.ShaderSetFlags(mat.__h, mat.side ?? FrontSide, mat.depthWrite ? 1 : 0);
          } else if (n.MaterialSetSide) {
            n.MaterialSetSide(mat.__h, mat.side ?? FrontSide);
          }
        } catch {
          /* ignore */
        }
        bindShaderUniforms(mat);
      }
      return;
    } else if (n.MeshStandardMaterialCreate) {
      handle = n.MeshStandardMaterialCreate(color);
      const metal = mat._nativePbr ? mat._nativePbr.metalness : mat.metalness ?? 0;
      const rough = mat._nativePbr ? mat._nativePbr.roughness : mat.roughness ?? 1;
      if (n.MaterialSetPbr) n.MaterialSetPbr(handle, metal, rough);
    } else if (n.MeshBasicMaterialCreate) {
      handle = n.MeshBasicMaterialCreate(color);
    }
    mat.__h = handle || 0;
    if (mat.__h && n.MaterialSetSide) n.MaterialSetSide(mat.__h, mat.side ?? FrontSide);
    bindAllMaps(mat);
    bindEmissive(mat);
  }

  function addLightMaps(mat) {
    mat.lightMap = null;
    mat.lightMapIntensity = 1;
    mat.aoMap = null;
    mat.aoMapIntensity = 1;
  }

  function addEmissive(mat) {
    mat.emissive = makeColor(0x000000);
    mat.emissiveIntensity = 1;
    mat.emissiveMap = null;
  }

  function addNormalMaps(mat) {
    mat.bumpMap = null;
    mat.bumpScale = 1;
    mat.normalMap = null;
    mat.normalMapType = TangentSpaceNormalMap;
    mat.normalScale = makeVec2(1, 1);
    mat.displacementMap = null;
    mat.displacementScale = 1;
    mat.displacementBias = 0;
  }

  function addEnv(mat) {
    mat.envMap = null;
    mat.envMapRotation = makeEuler();
    mat.envMapIntensity = 1;
    mat.combine = MultiplyOperation;
    mat.reflectivity = 1;
    mat.refractionRatio = 0.98;
  }

  function addWireframe(mat) {
    mat.wireframe = false;
    mat.wireframeLinewidth = 1;
    mat.wireframeLinecap = "round";
    mat.wireframeLinejoin = "round";
  }

  class Material extends Super {
    constructor() {
      super();
      this.isMaterial = true;
      Object.defineProperty(this, "id", { value: materialId++, writable: false });
      this.uuid = makeUUID();
      this.name = "";
      this.type = "Material";
      this.side = FrontSide;
      this.opacity = 1;
      this.transparent = false;
      this.visible = true;
      this.depthTest = true;
      this.depthWrite = true;
      this.depthFunc = LessEqualDepth;
      this.blending = NormalBlending;
      this.blendSrc = SrcAlphaFactor;
      this.blendDst = OneMinusSrcAlphaFactor;
      this.blendEquation = AddEquation;
      this.blendSrcAlpha = null;
      this.blendDstAlpha = null;
      this.blendEquationAlpha = null;
      this.vertexColors = false;
      this.color = makeColor(0xffffff);
      this.map = null;
      this.alphaMap = null;
      this.alphaTest = 0;
      this.alphaHash = false;
      this.alphaToCoverage = false;
      this.premultipliedAlpha = false;
      this.toneMapped = true;
      this.colorWrite = true;
      this.fog = true;
      this.precision = null;
      this.polygonOffset = false;
      this.polygonOffsetFactor = 0;
      this.polygonOffsetUnits = 0;
      this.dithering = false;
      this.clippingPlanes = null;
      this.clipIntersection = false;
      this.clipShadows = false;
      this.shadowSide = null;
      this.stencilWrite = false;
      this.stencilWriteMask = 0xff;
      this.stencilFunc = AlwaysStencilFunc;
      this.stencilRef = 0;
      this.stencilFuncMask = 0xff;
      this.stencilFail = KeepStencilOp;
      this.stencilZFail = KeepStencilOp;
      this.stencilZPass = KeepStencilOp;
      this.forceSinglePass = false;
      this.allowOverride = true;
      this.userData = {};
      this.version = 0;
      this._nativeKind = null;
      this._nativePbr = null;
      this.onBeforeCompile = function onBeforeCompile() {};
    }

    onBeforeRender() {}

    customProgramCacheKey() {
      return this.onBeforeCompile.toString();
    }

    setValues(values) {
      if (values === undefined) return this;
      for (const key in values) {
        const newValue = values[key];
        if (newValue === undefined) continue;
        const currentValue = this[key];
        if (currentValue === undefined) continue;
        if (isColorObj(currentValue)) {
          currentValue.set(newValue);
        } else if (hasCopy(currentValue) && newValue && typeof newValue === "object") {
          currentValue.copy(newValue);
        } else {
          this[key] = newValue;
        }
        if (MAP_SLOTS[key] != null) bindMap(this, this[key], MAP_SLOTS[key]);
        if (!this.__h) continue;
        if (
          this._nativeKind === "shader" &&
          (key === "side" || key === "depthWrite")
        ) {
          const n = native();
          if (n && n.ShaderSetFlags) {
            n.ShaderSetFlags(this.__h, this.side ?? FrontSide, this.depthWrite ? 1 : 0);
          }
        }
        if (key === "side") {
          if (TN.cmd) TN.cmd.matSide(this.__h, this.side);
          else {
            const n = native();
            if (n && n.MaterialSetSide) n.MaterialSetSide(this.__h, this.side);
          }
        }
        if (key === "metalness" || key === "roughness") {
          const metal = this.metalness ?? 0;
          const rough = this.roughness ?? 1;
          if (TN.cmd) TN.cmd.matPbr(this.__h, metal, rough);
          else {
            const n = native();
            if (n && n.MaterialSetPbr) n.MaterialSetPbr(this.__h, metal, rough);
          }
        }
      }
      return this;
    }

    copy(source) {
      const skip = { uuid: 1, id: 1, version: 1 };
      for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        if (skip[key] || key.startsWith("is") || key.startsWith("_")) continue;
        const value = source[key];
        if (typeof value === "function") continue;
        const dest = this[key];
        if (isColorObj(dest) && value != null) {
          dest.set(value);
        } else if (hasCopy(dest) && value && typeof value === "object") {
          dest.copy(value);
        } else if (Array.isArray(value)) {
          this[key] = value.slice();
        } else if (value && value.constructor === Object) {
          this[key] = Object.assign({}, value);
        } else {
          this[key] = value;
        }
      }
      bindAllMaps(this);
      return this;
    }

    clone() {
      return new this.constructor().copy(this);
    }

    dispose() {
      if (typeof this.dispatchEvent === "function") {
        this.dispatchEvent({ type: "dispose" });
      }
    }

    set needsUpdate(value) {
      if (value === true) this.version++;
    }

    flushNative() {
      if (this._nativeKind === "shader") flushShaderUniforms(this);
    }
  }

  Object.defineProperty(Material.prototype, "_h", {
    get() {
      if (!this.__bound) bindNative(this);
      return this.__h || 0;
    },
    set(value) {
      this.__h = value;
    },
  });

  class MeshBasicMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshBasicMaterial = true;
      this.type = "MeshBasicMaterial";
      this._nativeKind = "basic";
      addLightMaps(this);
      this.specularMap = null;
      addEnv(this);
      addWireframe(this);
      this.setValues(params);
    }
  }

  class MeshLambertMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshLambertMaterial = true;
      this.type = "MeshLambertMaterial";
      this._nativeKind = "lambert";
      addLightMaps(this);
      addEmissive(this);
      addNormalMaps(this);
      this.specularMap = null;
      addEnv(this);
      addWireframe(this);
      this.flatShading = false;
      this.setValues(params);
    }
  }

  class MeshPhongMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshPhongMaterial = true;
      this.type = "MeshPhongMaterial";
      this._nativeKind = "standard";
      this._nativePbr = { metalness: 0.1, roughness: 0.4 };
      this.specular = makeColor(0x111111);
      this.shininess = 30;
      addLightMaps(this);
      addEmissive(this);
      addNormalMaps(this);
      this.specularMap = null;
      addEnv(this);
      addWireframe(this);
      this.flatShading = false;
      this.setValues(params);
    }
  }

  class MeshStandardMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshStandardMaterial = true;
      this.type = "MeshStandardMaterial";
      this._nativeKind = "standard";
      this.defines = { STANDARD: "" };
      this.roughness = 1;
      this.metalness = 0;
      addLightMaps(this);
      addEmissive(this);
      addNormalMaps(this);
      this.roughnessMap = null;
      this.metalnessMap = null;
      addEnv(this);
      addWireframe(this);
      this.flatShading = false;
      this.setValues(params);
    }
  }

  class MeshPhysicalMaterial extends MeshStandardMaterial {
    constructor(params) {
      super();
      this.isMeshPhysicalMaterial = true;
      this.type = "MeshPhysicalMaterial";
      this.defines = { STANDARD: "", PHYSICAL: "" };
      this.clearcoat = 0;
      this.clearcoatMap = null;
      this.clearcoatRoughness = 0;
      this.clearcoatRoughnessMap = null;
      this.clearcoatNormalScale = makeVec2(1, 1);
      this.clearcoatNormalMap = null;
      this.ior = 1.5;
      this.iridescence = 0;
      this.iridescenceMap = null;
      this.iridescenceIOR = 1.3;
      this.iridescenceThicknessRange = [100, 400];
      this.iridescenceThicknessMap = null;
      this.sheen = 0;
      this.sheenColor = makeColor(0x000000);
      this.sheenColorMap = null;
      this.sheenRoughness = 1;
      this.sheenRoughnessMap = null;
      this.transmission = 0;
      this.transmissionMap = null;
      this.thickness = 0;
      this.thicknessMap = null;
      this.attenuationDistance = Infinity;
      this.attenuationColor = makeColor(0xffffff);
      this.specularIntensity = 1;
      this.specularIntensityMap = null;
      this.specularColor = makeColor(0xffffff);
      this.specularColorMap = null;
      this.anisotropy = 0;
      this.anisotropyRotation = 0;
      this.anisotropyMap = null;
      this.dispersion = 0;
      Object.defineProperty(this, "reflectivity", {
        configurable: true,
        enumerable: true,
        get() {
          const ior = this.ior;
          const t = (2.5 * (ior - 1)) / (ior + 1);
          return t < 0 ? 0 : t > 1 ? 1 : t;
        },
        set(value) {
          this.ior = (1 + 0.4 * value) / (1 - 0.4 * value);
        },
      });
      this.setValues(params);
    }
  }

  class MeshNormalMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshNormalMaterial = true;
      this.type = "MeshNormalMaterial";
      this._nativeKind = "standard";
      this._nativePbr = { metalness: 0.2, roughness: 0.5 };
      this.color = makeColor(0x8888ff);
      addNormalMaps(this);
      addWireframe(this);
      this.flatShading = false;
      this.setValues(params);
    }
  }

  class MeshToonMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshToonMaterial = true;
      this.type = "MeshToonMaterial";
      this._nativeKind = "lambert";
      this.gradientMap = null;
      addLightMaps(this);
      addEmissive(this);
      addNormalMaps(this);
      addWireframe(this);
      this.fog = true;
      this.setValues(params);
    }
  }

  class MeshMatcapMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshMatcapMaterial = true;
      this.type = "MeshMatcapMaterial";
      this._nativeKind = "standard";
      this._nativePbr = { metalness: 0.2, roughness: 0.4 };
      this.matcap = null;
      addNormalMaps(this);
      addWireframe(this);
      this.flatShading = false;
      this.setValues(params);
    }
  }

  class MeshDepthMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshDepthMaterial = true;
      this.type = "MeshDepthMaterial";
      this.depthPacking = BasicDepthPacking;
      addNormalMaps(this);
      addWireframe(this);
      this.setValues(params);
    }
  }

  class MeshDistanceMaterial extends Material {
    constructor(params) {
      super();
      this.isMeshDistanceMaterial = true;
      this.type = "MeshDistanceMaterial";
      this.referencePosition = makeVec3(0, 0, 0);
      this.nearDistance = 1;
      this.farDistance = 1000;
      addNormalMaps(this);
      this.setValues(params);
    }
  }

  class ShadowMaterial extends Material {
    constructor(params) {
      super();
      this.isShadowMaterial = true;
      this.type = "ShadowMaterial";
      this.color = makeColor(0x000000);
      this.transparent = true;
      this.setValues(params);
    }
  }

  const DEFAULT_VERTEX =
    "void main() {\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}";
  const DEFAULT_FRAGMENT =
    "void main() {\n\tgl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n}";

  class ShaderMaterial extends Material {
    constructor(params) {
      super();
      this.isShaderMaterial = true;
      this.type = "ShaderMaterial";
      this._nativeKind = "shader";
      this.defines = {};
      this.uniforms = {};
      this.uniformsGroups = [];
      this.vertexShader = DEFAULT_VERTEX;
      this.fragmentShader = DEFAULT_FRAGMENT;
      this.linewidth = 1;
      addWireframe(this);
      this.fog = false;
      this.lights = false;
      this.clipping = false;
      this.forceSinglePass = true;
      this.extensions = { clipCullDistance: false, multiDraw: false };
      this.defaultAttributeValues = {
        color: [1, 1, 1],
        uv: [0, 0],
        uv1: [0, 0],
      };
      this.index0AttributeName = undefined;
      this.glslVersion = null;
      let uniformsNeedUpdate = false;
      Object.defineProperty(this, "uniformsNeedUpdate", {
        configurable: true,
        enumerable: true,
        get() {
          return uniformsNeedUpdate;
        },
        set(v) {
          uniformsNeedUpdate = !!v;
          if (uniformsNeedUpdate) this.flushNative();
        },
      });
      this.setValues(params);
    }

    copy(source) {
      super.copy(source);
      this.fragmentShader = source.fragmentShader;
      this.vertexShader = source.vertexShader;
      this.uniforms = {};
      if (source.uniforms) {
        for (const name in source.uniforms) {
          const uniform = source.uniforms[name];
          this.uniforms[name] =
            uniform && typeof uniform === "object" && "value" in uniform
              ? { value: uniform.value }
              : uniform;
        }
      }
      this.uniformsGroups = (source.uniformsGroups || []).slice();
      this.defines = Object.assign({}, source.defines);
      this.extensions = Object.assign({}, source.extensions);
      this.defaultAttributeValues = Object.assign({}, source.defaultAttributeValues);
      this.glslVersion = source.glslVersion;
      this.index0AttributeName = source.index0AttributeName;
      this.uniformsNeedUpdate = source.uniformsNeedUpdate;
      this.lights = source.lights;
      this.clipping = source.clipping;
      return this;
    }
  }

  class RawShaderMaterial extends ShaderMaterial {
    constructor(params) {
      super(params);
      this.isRawShaderMaterial = true;
      this.type = "RawShaderMaterial";
    }
  }

  class LineBasicMaterial extends Material {
    constructor(params) {
      super();
      this.isLineBasicMaterial = true;
      this.type = "LineBasicMaterial";
      this._nativeKind = "line";
      this.linewidth = 1;
      this.linecap = "round";
      this.linejoin = "round";
      this.setValues(params);
    }
  }

  class LineDashedMaterial extends LineBasicMaterial {
    constructor(params) {
      super();
      this.isLineDashedMaterial = true;
      this.type = "LineDashedMaterial";
      this.scale = 1;
      this.dashSize = 3;
      this.gapSize = 1;
      this.setValues(params);
    }
  }

  class PointsMaterial extends Material {
    constructor(params) {
      super();
      this.isPointsMaterial = true;
      this.type = "PointsMaterial";
      this._nativeKind = "points";
      this.size = 1;
      this.sizeAttenuation = true;
      this.setValues(params);
    }
  }

  class SpriteMaterial extends Material {
    constructor(params) {
      super();
      this.isSpriteMaterial = true;
      this.type = "SpriteMaterial";
      this._nativeKind = "sprite";
      this.rotation = 0;
      this.sizeAttenuation = true;
      this.transparent = true;
      this.setValues(params);
    }
  }

  TN.Material = Material;
  TN.MeshBasicMaterial = MeshBasicMaterial;
  TN.MeshLambertMaterial = MeshLambertMaterial;
  TN.MeshPhongMaterial = MeshPhongMaterial;
  TN.MeshStandardMaterial = MeshStandardMaterial;
  TN.MeshPhysicalMaterial = MeshPhysicalMaterial;
  TN.MeshNormalMaterial = MeshNormalMaterial;
  TN.MeshToonMaterial = MeshToonMaterial;
  TN.MeshMatcapMaterial = MeshMatcapMaterial;
  TN.MeshDepthMaterial = MeshDepthMaterial;
  TN.MeshDistanceMaterial = MeshDistanceMaterial;
  TN.ShadowMaterial = ShadowMaterial;
  TN.ShaderMaterial = ShaderMaterial;
  TN.RawShaderMaterial = RawShaderMaterial;
  TN.LineBasicMaterial = LineBasicMaterial;
  TN.LineDashedMaterial = LineDashedMaterial;
  TN.PointsMaterial = PointsMaterial;
  TN.SpriteMaterial = SpriteMaterial;
})(globalThis.__TN = globalThis.__TN || {});
