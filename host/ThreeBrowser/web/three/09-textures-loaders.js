(function (TN) {
  function native() {
    return globalThis.chrome?.webview?.hostObjects?.sync?.native || null;
  }

  const UVMapping = TN.UVMapping ?? 300;
  const CubeReflectionMapping = TN.CubeReflectionMapping ?? 301;
  const RepeatWrapping = TN.RepeatWrapping ?? 1000;
  const ClampToEdgeWrapping = TN.ClampToEdgeWrapping ?? 1001;
  const MirroredRepeatWrapping = TN.MirroredRepeatWrapping ?? 1002;
  const NearestFilter = TN.NearestFilter ?? 1003;
  const LinearFilter = TN.LinearFilter ?? 1006;
  const LinearMipmapLinearFilter = TN.LinearMipmapLinearFilter ?? 1008;
  const UnsignedByteType = TN.UnsignedByteType ?? 1009;
  const UnsignedIntType = TN.UnsignedIntType ?? 1014;
  const UnsignedInt248Type = TN.UnsignedInt248Type ?? 1020;
  const RGBAFormat = TN.RGBAFormat ?? 1023;
  const DepthFormat = TN.DepthFormat ?? 1026;
  const DepthStencilFormat = TN.DepthStencilFormat ?? 1027;
  const NoColorSpace = TN.NoColorSpace ?? "";
  const SRGBColorSpace = TN.SRGBColorSpace ?? "srgb";

  const EventDispatcher =
    typeof TN.EventDispatcher === "function"
      ? TN.EventDispatcher
      : class {
          addEventListener(type, listener) {
            if (this._listeners === undefined) this._listeners = {};
            const list = this._listeners[type] || (this._listeners[type] = []);
            if (list.indexOf(listener) === -1) list.push(listener);
          }
          hasEventListener(type, listener) {
            return (
              this._listeners !== undefined &&
              this._listeners[type] !== undefined &&
              this._listeners[type].indexOf(listener) !== -1
            );
          }
          removeEventListener(type, listener) {
            if (this._listeners === undefined) return;
            const list = this._listeners[type];
            if (!list) return;
            const i = list.indexOf(listener);
            if (i !== -1) list.splice(i, 1);
          }
          dispatchEvent(event) {
            if (this._listeners === undefined) return;
            const list = this._listeners[event.type];
            if (!list) return;
            event.target = this;
            const copy = list.slice();
            for (let i = 0; i < copy.length; i++) copy[i].call(this, event);
            event.target = null;
          }
        };

  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
      this.isVector2 = true;
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
      return new Vec2(this.x, this.y);
    }
    fromArray(arr, offset = 0) {
      this.x = arr[offset];
      this.y = arr[offset + 1];
      return this;
    }
  }

  class Mat3 {
    constructor() {
      this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      this.isMatrix3 = true;
    }
    copy(m) {
      this.elements = m.elements.slice();
      return this;
    }
    clone() {
      return new Mat3().copy(this);
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
  }

  const Vector2 = typeof TN.Vector2 === "function" ? TN.Vector2 : Vec2;
  const Matrix3 = typeof TN.Matrix3 === "function" ? TN.Matrix3 : Mat3;

  function generateUUID() {
    if (TN.MathUtils && typeof TN.MathUtils.generateUUID === "function") {
      return TN.MathUtils.generateUUID();
    }
    return globalThis.crypto?.randomUUID?.() ?? "tn-" + Math.random().toString(16).slice(2);
  }

  function bytesToB64(u8) {
    let s = "";
    const n = 0x8000;
    for (let i = 0; i < u8.length; i += n) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + n));
    }
    return btoa(s);
  }

  function applyUvTransform(matrix, tx, ty, sx, sy, rotation, cx, cy) {
    if (typeof matrix.setUvTransform === "function") {
      matrix.setUvTransform(tx, ty, sx, sy, rotation, cx, cy);
      return;
    }
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    if (typeof matrix.set === "function") {
      matrix.set(
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
      return;
    }
    const e = matrix.elements;
    e[0] = sx * c;
    e[1] = -sy * s;
    e[2] = 0;
    e[3] = sx * s;
    e[4] = sy * c;
    e[5] = 0;
    e[6] = -sx * (c * cx + s * cy) + cx + tx;
    e[7] = -sy * (-s * cx + c * cy) + cy + ty;
    e[8] = 1;
  }

  function getTypedArray(type, buffer) {
    switch (type) {
      case "Int8Array":
        return new Int8Array(buffer);
      case "Uint8Array":
        return new Uint8Array(buffer);
      case "Uint8ClampedArray":
        return new Uint8ClampedArray(buffer);
      case "Int16Array":
        return new Int16Array(buffer);
      case "Uint16Array":
        return new Uint16Array(buffer);
      case "Int32Array":
        return new Int32Array(buffer);
      case "Uint32Array":
        return new Uint32Array(buffer);
      case "Float32Array":
        return new Float32Array(buffer);
      case "Float64Array":
        return new Float64Array(buffer);
      default:
        return new Float32Array(buffer);
    }
  }

  function construct(name, args) {
    const Ctor = TN[name];
    if (typeof Ctor !== "function") return { type: name };
    try {
      if (!args || args.length === 0) return new Ctor();
      return new Ctor(...args);
    } catch {
      try {
        return new Ctor();
      } catch {
        return { type: name };
      }
    }
  }

  const Cache = {
    enabled: false,
    files: {},
    add(key, file) {
      if (this.enabled === false) return;
      this.files[key] = file;
    },
    get(key) {
      if (this.enabled === false) return;
      return this.files[key];
    },
    remove(key) {
      delete this.files[key];
    },
    clear() {
      this.files = {};
    },
  };

  class LoaderUtils {
    static decodeText(array) {
      if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(array);
      let s = "";
      for (let i = 0; i < array.length; i++) s += String.fromCharCode(array[i]);
      try {
        return decodeURIComponent(escape(s));
      } catch {
        return s;
      }
    }
    static extractUrlBase(url) {
      const index = String(url).lastIndexOf("/");
      if (index === -1) return "./";
      return String(url).slice(0, index + 1);
    }
    static resolveURL(url, path) {
      if (typeof url !== "string" || url === "") return "";
      if (/^https?:\/\//i.test(path) && /^\//.test(url)) {
        path = path.replace(/(^https?:\/\/[^\/]+).*/i, "$1");
      }
      if (/^(https?:)?\/\//i.test(url)) return url;
      if (/^data:.*,.*$/i.test(url)) return url;
      if (/^blob:.*$/i.test(url)) return url;
      return path + url;
    }
  }

  class LoadingManager {
    constructor(onLoad, onProgress, onError) {
      const scope = this;
      let isLoading = false;
      let itemsLoaded = 0;
      let itemsTotal = 0;
      let urlModifier;
      const handlers = [];

      this.onStart = undefined;
      this.onLoad = onLoad;
      this.onProgress = onProgress;
      this.onError = onError;

      this.itemStart = function (url) {
        itemsTotal++;
        if (isLoading === false && scope.onStart !== undefined) {
          scope.onStart(url, itemsLoaded, itemsTotal);
        }
        isLoading = true;
      };

      this.itemEnd = function (url) {
        itemsLoaded++;
        if (scope.onProgress !== undefined) {
          scope.onProgress(url, itemsLoaded, itemsTotal);
        }
        if (itemsLoaded === itemsTotal) {
          isLoading = false;
          if (scope.onLoad !== undefined) scope.onLoad();
        }
      };

      this.itemError = function (url) {
        if (scope.onError !== undefined) scope.onError(url);
      };

      this.resolveURL = function (url) {
        if (typeof url === "string" && typeof url.normalize === "function") {
          url = url.normalize("NFC");
        }
        return urlModifier ? urlModifier(url) : url;
      };

      this.setURLModifier = function (transform) {
        urlModifier = transform;
        return this;
      };

      this.addHandler = function (regex, loader) {
        handlers.push(regex, loader);
        return this;
      };

      this.removeHandler = function (regex) {
        const index = handlers.indexOf(regex);
        if (index !== -1) handlers.splice(index, 2);
        return this;
      };

      this.getHandler = function (file) {
        for (let i = 0, l = handlers.length; i < l; i += 2) {
          const regex = handlers[i];
          const loader = handlers[i + 1];
          if (regex.global) regex.lastIndex = 0;
          if (regex.test(file)) return loader;
        }
        return null;
      };
    }
  }

  const DefaultLoadingManager = new LoadingManager();

  class Loader {
    constructor(manager) {
      this.manager = manager !== undefined ? manager : DefaultLoadingManager;
      this.crossOrigin = "anonymous";
      this.withCredentials = false;
      this.path = "";
      this.resourcePath = "";
      this.requestHeader = {};
    }
    load() {}
    loadAsync(url, onProgress) {
      const scope = this;
      return new Promise(function (resolve, reject) {
        scope.load(url, resolve, onProgress, reject);
      });
    }
    parse() {}
    setCrossOrigin(crossOrigin) {
      this.crossOrigin = crossOrigin;
      return this;
    }
    setWithCredentials(value) {
      this.withCredentials = value;
      return this;
    }
    setPath(path) {
      this.path = path;
      return this;
    }
    setResourcePath(resourcePath) {
      this.resourcePath = resourcePath;
      return this;
    }
    setRequestHeader(requestHeader) {
      this.requestHeader = requestHeader;
      return this;
    }
    abort() {
      return this;
    }
  }

  Loader.DEFAULT_MATERIAL_NAME = "__DEFAULT";

  class FileLoader extends Loader {
    constructor(manager) {
      super(manager);
      this.mimeType = "";
      this.responseType = "";
    }
    load(url, onLoad, onProgress, onError) {
      if (url === undefined) url = "";
      if (this.path !== undefined) url = this.path + url;
      url = this.manager.resolveURL(url);

      const cached = Cache.get(url);
      if (cached !== undefined) {
        this.manager.itemStart(url);
        setTimeout(() => {
          if (onLoad) onLoad(cached);
          this.manager.itemEnd(url);
        }, 0);
        return;
      }

      const responseType = this.responseType;
      const requestHeader = this.requestHeader;
      const withCredentials = this.withCredentials;
      this.manager.itemStart(url);

      const opts = {
        credentials: withCredentials ? "include" : "same-origin",
      };
      if (requestHeader && Object.keys(requestHeader).length > 0) {
        opts.headers = requestHeader;
      }

      fetch(url, opts)
        .then((response) => {
          if (!response.ok && response.status !== 0) {
            throw new Error(
              'fetch for "' + url + '" responded with ' + response.status + ": " + response.statusText
            );
          }
          if (responseType === "arraybuffer") return response.arrayBuffer();
          if (responseType === "blob") return response.blob();
          if (responseType === "json") return response.json();
          return response.text();
        })
        .then((data) => {
          Cache.add(url, data);
          if (onLoad) onLoad(data);
        })
        .catch((err) => {
          if (onError) onError(err);
          this.manager.itemError(url);
        })
        .finally(() => {
          this.manager.itemEnd(url);
        });
    }
    setResponseType(value) {
      this.responseType = value;
      return this;
    }
    setMimeType(value) {
      this.mimeType = value;
      return this;
    }
  }

  class ImageLoader extends Loader {
    constructor(manager) {
      super(manager);
    }
    load(url, onLoad, onProgress, onError) {
      if (this.path !== undefined) url = this.path + url;
      url = this.manager.resolveURL(url);
      const scope = this;
      const cached = Cache.get(url);
      if (cached !== undefined) {
        scope.manager.itemStart(url);
        setTimeout(function () {
          if (onLoad) onLoad(cached);
          scope.manager.itemEnd(url);
        }, 0);
        return cached;
      }

      const image = new Image();

      function onImageLoad() {
        removeEventListeners();
        Cache.add(url, image);
        if (onLoad) onLoad(image);
        scope.manager.itemEnd(url);
      }

      function onImageError(event) {
        removeEventListeners();
        if (onError) onError(event);
        scope.manager.itemError(url);
        scope.manager.itemEnd(url);
      }

      function removeEventListeners() {
        image.removeEventListener("load", onImageLoad, false);
        image.removeEventListener("error", onImageError, false);
      }

      image.addEventListener("load", onImageLoad, false);
      image.addEventListener("error", onImageError, false);

      if (String(url).slice(0, 5) !== "data:") {
        if (this.crossOrigin !== undefined) image.crossOrigin = this.crossOrigin;
      }

      scope.manager.itemStart(url);
      image.src = url;
      return image;
    }
  }

  class ImageBitmapLoader extends Loader {
    constructor(manager) {
      super(manager);
      this.isImageBitmapLoader = true;
      this.options = { premultiplyAlpha: "none" };
    }
    setOptions(options) {
      this.options = options;
      return this;
    }
    load(url, onLoad, onProgress, onError) {
      if (url === undefined) url = "";
      if (this.path !== undefined) url = this.path + url;
      url = this.manager.resolveURL(url);
      const scope = this;
      const cached = Cache.get(url);
      if (cached !== undefined) {
        scope.manager.itemStart(url);
        if (cached && typeof cached.then === "function") {
          cached
            .then(function (imageBitmap) {
              if (onLoad) onLoad(imageBitmap);
              scope.manager.itemEnd(url);
            })
            .catch(function (e) {
              if (onError) onError(e);
            });
          return;
        }
        setTimeout(function () {
          if (onLoad) onLoad(cached);
          scope.manager.itemEnd(url);
        }, 0);
        return cached;
      }

      const fetchOptions = {
        credentials: this.crossOrigin === "anonymous" ? "same-origin" : "include",
        headers: this.requestHeader,
      };

      const promise = fetch(url, fetchOptions)
        .then(function (res) {
          return res.blob();
        })
        .then(function (blob) {
          return createImageBitmap(blob, Object.assign({}, scope.options, { colorSpaceConversion: "none" }));
        })
        .then(function (imageBitmap) {
          Cache.add(url, imageBitmap);
          if (onLoad) onLoad(imageBitmap);
          scope.manager.itemEnd(url);
          return imageBitmap;
        })
        .catch(function (e) {
          if (onError) onError(e);
          Cache.remove(url);
          scope.manager.itemError(url);
          scope.manager.itemEnd(url);
        });

      Cache.add(url, promise);
      scope.manager.itemStart(url);
    }
  }

  let _sourceId = 0;

  class Source {
    constructor(data = null) {
      this.isSource = true;
      Object.defineProperty(this, "id", { value: _sourceId++ });
      this.uuid = generateUUID();
      this.data = data;
      this.dataReady = true;
      this.version = 0;
    }
    set needsUpdate(value) {
      if (value === true) this.version++;
    }
    toJSON(meta) {
      const isRootObject = meta === undefined || typeof meta === "string";
      if (!isRootObject && meta.images && meta.images[this.uuid] !== undefined) {
        return meta.images[this.uuid];
      }
      const output = { uuid: this.uuid, url: "" };
      const data = this.data;
      if (data !== null) {
        if (Array.isArray(data)) {
          const url = [];
          for (let i = 0; i < data.length; i++) {
            url.push(serializeImage(data[i] && data[i].isDataTexture ? data[i].image : data[i]));
          }
          output.url = url;
        } else {
          output.url = serializeImage(data);
        }
      }
      if (!isRootObject && meta.images) meta.images[this.uuid] = output;
      return output;
    }
  }

  function serializeImage(image) {
    if (!image) return {};
    if (
      (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) ||
      (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
    ) {
      if (typeof image.toDataURL === "function") return image.toDataURL();
      return "";
    }
    if (image.data) {
      return {
        data: Array.from(image.data),
        width: image.width,
        height: image.height,
        type: image.data.constructor ? image.data.constructor.name : "Array",
      };
    }
    return {};
  }

  let _textureId = 0;

  class Texture extends EventDispatcher {
    constructor(
      image = Texture.DEFAULT_IMAGE,
      mapping = Texture.DEFAULT_MAPPING,
      wrapS = ClampToEdgeWrapping,
      wrapT = ClampToEdgeWrapping,
      magFilter = LinearFilter,
      minFilter = LinearMipmapLinearFilter,
      format = RGBAFormat,
      type = UnsignedByteType,
      anisotropy = Texture.DEFAULT_ANISOTROPY,
      colorSpace = NoColorSpace
    ) {
      super();
      this.isTexture = true;
      Object.defineProperty(this, "id", { value: _textureId++ });
      this.uuid = generateUUID();
      this.name = "";
      this.source = new Source(image);
      this.mipmaps = [];
      this.mapping = mapping;
      this.channel = 0;
      this.wrapS = wrapS;
      this.wrapT = wrapT;
      this.magFilter = magFilter;
      this.minFilter = minFilter;
      this.anisotropy = anisotropy;
      this.format = format;
      this.internalFormat = null;
      this.type = type;
      this.offset = new Vector2(0, 0);
      this.repeat = new Vector2(1, 1);
      this.center = new Vector2(0, 0);
      this.rotation = 0;
      this.matrixAutoUpdate = true;
      this.matrix = new Matrix3();
      this.generateMipmaps = true;
      this.premultiplyAlpha = false;
      this._flipY = true;
      this.unpackAlignment = 4;
      this.colorSpace = colorSpace;
      this.userData = {};
      this.version = 0;
      this.onUpdate = null;
      this.isRenderTargetTexture = false;
      this.pmremVersion = 0;
      this._h = 0;
      this._materials = [];
    }
    get flipY() {
      return this._flipY;
    }
    set flipY(value) {
      const next = !!value;
      if (this._flipY === next) return;
      this._flipY = next;
      // WebGL reads UNPACK_FLIP_Y at upload/draw time. Loaders set needsUpdate
      // first, then flipY in a later .then — re-upload if GPU pixels used the
      // previous convention.
      if (this._h && this._nativeFlipY !== next) scheduleTextureUpload(this);
    }
    get image() {
      return this.source.data;
    }
    set image(value) {
      this.source.data = value;
      if (this.version > 0) scheduleTextureUpload(this);
    }
    updateMatrix() {
      applyUvTransform(
        this.matrix,
        this.offset.x,
        this.offset.y,
        this.repeat.x,
        this.repeat.y,
        this.rotation,
        this.center.x,
        this.center.y
      );
    }
    clone() {
      return new this.constructor().copy(this);
    }
    copy(source) {
      this.name = source.name;
      this.source = source.source;
      this.mipmaps = source.mipmaps ? source.mipmaps.slice(0) : [];
      this.mapping = source.mapping;
      this.channel = source.channel;
      this.wrapS = source.wrapS;
      this.wrapT = source.wrapT;
      this.magFilter = source.magFilter;
      this.minFilter = source.minFilter;
      this.anisotropy = source.anisotropy;
      this.format = source.format;
      this.internalFormat = source.internalFormat;
      this.type = source.type;
      this.offset.copy(source.offset);
      this.repeat.copy(source.repeat);
      this.center.copy(source.center);
      this.rotation = source.rotation;
      this.matrixAutoUpdate = source.matrixAutoUpdate;
      this.matrix.copy(source.matrix);
      this.generateMipmaps = source.generateMipmaps;
      this.premultiplyAlpha = source.premultiplyAlpha;
      this.flipY = source.flipY;
      this.unpackAlignment = source.unpackAlignment;
      this.colorSpace = source.colorSpace;
      this.userData = JSON.parse(JSON.stringify(source.userData || {}));
      this.needsUpdate = true;
      return this;
    }
    dispose() {
      this.dispatchEvent({ type: "dispose" });
    }
    transformUv(uv) {
      if (this.mapping !== UVMapping) return uv;
      const e = this.matrix.elements;
      const x = uv.x;
      const y = uv.y;
      uv.x = e[0] * x + e[3] * y + e[6];
      uv.y = e[1] * x + e[4] * y + e[7];
      if (uv.x < 0 || uv.x > 1) {
        switch (this.wrapS) {
          case RepeatWrapping:
            uv.x = uv.x - Math.floor(uv.x);
            break;
          case ClampToEdgeWrapping:
            uv.x = uv.x < 0 ? 0 : 1;
            break;
          case MirroredRepeatWrapping:
            if (Math.abs(Math.floor(uv.x) % 2) === 1) uv.x = Math.ceil(uv.x) - uv.x;
            else uv.x = uv.x - Math.floor(uv.x);
            break;
        }
      }
      if (uv.y < 0 || uv.y > 1) {
        switch (this.wrapT) {
          case RepeatWrapping:
            uv.y = uv.y - Math.floor(uv.y);
            break;
          case ClampToEdgeWrapping:
            uv.y = uv.y < 0 ? 0 : 1;
            break;
          case MirroredRepeatWrapping:
            if (Math.abs(Math.floor(uv.y) % 2) === 1) uv.y = Math.ceil(uv.y) - uv.y;
            else uv.y = uv.y - Math.floor(uv.y);
            break;
        }
      }
      if (this.flipY) uv.y = 1 - uv.y;
      return uv;
    }
    set needsUpdate(value) {
      if (value === true) {
        this.version++;
        this.source.needsUpdate = true;
        scheduleTextureUpload(this);
      }
    }
    set needsPMREMUpdate(value) {
      if (value === true) this.pmremVersion++;
    }
  }

  Texture.DEFAULT_IMAGE = null;
  Texture.DEFAULT_MAPPING = UVMapping;
  Texture.DEFAULT_ANISOTROPY = 1;

  class CanvasTexture extends Texture {
    constructor(canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy) {
      super(canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);
      this.isCanvasTexture = true;
      this.needsUpdate = true;
    }
  }

  class VideoTexture extends Texture {
    constructor(video, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy) {
      super(video, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);
      this.isVideoTexture = true;
      this.minFilter = minFilter !== undefined ? minFilter : LinearFilter;
      this.magFilter = magFilter !== undefined ? magFilter : LinearFilter;
      this.generateMipmaps = false;
      const scope = this;
      function updateVideo() {
        scope.needsUpdate = true;
        if (video && typeof video.requestVideoFrameCallback === "function") {
          video.requestVideoFrameCallback(updateVideo);
        }
      }
      if (video && typeof video === "object" && "requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(updateVideo);
      }
    }
    clone() {
      return new this.constructor(this.image).copy(this);
    }
    update() {
      const video = this.image;
      if (!video) return;
      const hasVideoFrameCallback = "requestVideoFrameCallback" in video;
      if (hasVideoFrameCallback === false && video.readyState >= video.HAVE_CURRENT_DATA) {
        this.needsUpdate = true;
      }
    }
  }

  class DataTexture extends Texture {
    constructor(
      data = null,
      width = 1,
      height = 1,
      format,
      type,
      mapping,
      wrapS,
      wrapT,
      magFilter = NearestFilter,
      minFilter = NearestFilter,
      anisotropy,
      colorSpace
    ) {
      super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, colorSpace);
      this.isDataTexture = true;
      this.image = { data: data, width: width, height: height };
      this.generateMipmaps = false;
      this.flipY = false;
      this.unpackAlignment = 1;
    }
  }

  class Data3DTexture extends Texture {
    constructor(data = null, width = 1, height = 1, depth = 1) {
      super(null);
      this.isData3DTexture = true;
      this.image = { data, width, height, depth };
      this.magFilter = NearestFilter;
      this.minFilter = NearestFilter;
      this.wrapR = ClampToEdgeWrapping;
      this.generateMipmaps = false;
      this.flipY = false;
      this.unpackAlignment = 1;
    }
  }

  class DataArrayTexture extends Texture {
    constructor(data = null, width = 1, height = 1, depth = 1) {
      super(null);
      this.isDataArrayTexture = true;
      this.image = { data, width, height, depth };
      this.magFilter = NearestFilter;
      this.minFilter = NearestFilter;
      this.wrapR = ClampToEdgeWrapping;
      this.generateMipmaps = false;
      this.flipY = false;
      this.unpackAlignment = 1;
      this.layerUpdates = new Set();
    }
    addLayerUpdate(layerIndex) {
      this.layerUpdates.add(layerIndex);
    }
    clearLayerUpdates() {
      this.layerUpdates.clear();
    }
  }

  class CompressedTexture extends Texture {
    constructor(
      mipmaps,
      width,
      height,
      format,
      type,
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      anisotropy,
      colorSpace
    ) {
      super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, colorSpace);
      this.isCompressedTexture = true;
      this.image = { width: width, height: height };
      this.mipmaps = mipmaps;
      this.flipY = false;
      this.generateMipmaps = false;
    }
  }

  class CubeTexture extends Texture {
    constructor(images, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, colorSpace) {
      images = images !== undefined ? images : [];
      mapping = mapping !== undefined ? mapping : CubeReflectionMapping;
      super(images, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, colorSpace);
      this.isCubeTexture = true;
      this.flipY = false;
    }
    get images() {
      return this.image;
    }
    set images(value) {
      this.image = value;
    }
  }

  class DepthTexture extends Texture {
    constructor(width, height, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, format = DepthFormat) {
      if (format !== DepthFormat && format !== DepthStencilFormat) {
        throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");
      }
      if (type === undefined && format === DepthFormat) type = UnsignedIntType;
      if (type === undefined && format === DepthStencilFormat) type = UnsignedInt248Type;
      super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);
      this.isDepthTexture = true;
      this.image = { width: width, height: height };
      this.magFilter = magFilter !== undefined ? magFilter : NearestFilter;
      this.minFilter = minFilter !== undefined ? minFilter : NearestFilter;
      this.flipY = false;
      this.generateMipmaps = false;
      this.compareFunction = null;
    }
    copy(source) {
      super.copy(source);
      this.compareFunction = source.compareFunction;
      return this;
    }
  }

  class FramebufferTexture extends Texture {
    constructor(width, height) {
      super({ width, height });
      this.isFramebufferTexture = true;
      this.magFilter = NearestFilter;
      this.minFilter = NearestFilter;
      this.generateMipmaps = false;
      this.needsUpdate = true;
    }
  }

  function rasterizeToRgba(texture) {
    const img = texture && texture.image;
    if (!img) return null;
    if (typeof HTMLVideoElement !== "undefined" && img instanceof HTMLVideoElement) return null;
    if (typeof ImageData !== "undefined" && img instanceof ImageData) {
      return { width: img.width, height: img.height, pixels: img.data };
    }
    if (img.data && img.width > 0 && img.height > 0 && typeof img.data.length === "number") {
      const data = img.data;
      if (
        data.length >= img.width * img.height * 4 &&
        (data instanceof Uint8Array || data instanceof Uint8ClampedArray)
      ) {
        return { width: img.width, height: img.height, pixels: data };
      }
    }
    const width = img.width || img.naturalWidth || 0;
    const height = img.height || img.naturalHeight || 0;
    if (!width || !height || typeof document === "undefined") return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
    } catch {
      return null;
    }
  }

  function bindWaitingMaterials(texture) {
    const materials = texture._materials || [];
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i];
      if (!mat) continue;
      if (typeof TN._bindMaterialMaps === "function") TN._bindMaterialMaps(mat);
      else {
        const host = native();
        if (host && mat._h && texture._h) host.MaterialSetMap(mat._h, texture._h);
      }
    }
  }

  const _pendingUpload = new Set();
  function scheduleTextureUpload(texture) {
    if (!texture || _pendingUpload.has(texture)) return;
    _pendingUpload.add(texture);
    const run = function () {
      _pendingUpload.delete(texture);
      try {
        uploadTextureNative(texture);
      } catch (err) {
        console.warn("ThreeBrowser texture upload failed", err);
      }
    };
    // GLTFLoader (and others) set needsUpdate in one promise .then and
    // flipY/wrap/colorSpace in the next. A microtask still sees Texture
    // defaults (flipY=true) and V-flips glTF atlases. WebGL uploads at
    // draw time; a macrotask is the equivalent — after those loader hooks.
    if (typeof setTimeout === "function") setTimeout(run, 0);
    else queueMicrotask(run);
  }

  function absorbNativeId(handle) {
    handle = handle >>> 0;
    if (!handle || handle >= 0x80000000 || !TN.cmd || typeof TN.cmd.alloc !== "function") return;
    let guard = 0;
    while (guard++ < 1000000) {
      const id = TN.cmd.alloc();
      if (id >= handle) break;
    }
  }

  function textureParams(texture) {
    const cs = texture && texture.colorSpace;
    const linear =
      cs == null ||
      cs === "" ||
      cs === -1 ||
      cs === 3000 ||
      cs === TN.LinearSRGBColorSpace ||
      cs === "srgb-linear" ||
      cs === "NoColorSpace";
    const off = texture && texture.offset;
    const rep = texture && texture.repeat;
    return {
      wrapS: texture && texture.wrapS != null ? texture.wrapS : TN.RepeatWrapping ?? 1000,
      wrapT: texture && texture.wrapT != null ? texture.wrapT : TN.RepeatWrapping ?? 1000,
      colorSpace: linear ? 0xffffffff : 3001,
      mag: texture && texture.magFilter != null ? texture.magFilter : TN.LinearFilter ?? 1006,
      min:
        texture && texture.minFilter != null
          ? texture.minFilter
          : TN.LinearMipmapLinearFilter ?? 1008,
      channel: texture && texture.channel ? texture.channel : 0,
      ox: off && typeof off.x === "number" ? off.x : 0,
      oy: off && typeof off.y === "number" ? off.y : 0,
      rx: rep && typeof rep.x === "number" ? rep.x : 1,
      ry: rep && typeof rep.y === "number" ? rep.y : 1,
    };
  }

  function applyNativeTexParams(texture) {
    if (!texture || !texture._h) return;
    if (!TN.cmd || typeof TN.cmd.texParams !== "function") return;
    const p = textureParams(texture);
    TN.cmd.texParams(
      texture._h,
      p.wrapS,
      p.wrapT,
      p.colorSpace,
      p.mag,
      p.min,
      p.channel,
      p.ox,
      p.oy,
      p.rx,
      p.ry
    );
  }

  function uploadTextureNative(texture) {
    if (!texture || texture._uploadingNative) return;
    const flip = !!texture.flipY;
    const ver = texture.version | 0;
    if (texture._h && texture._nativeFlipY === flip && texture._nativeVersion === ver) {
      applyNativeTexParams(texture);
      return;
    }
    texture._uploadingNative = true;
    try {
      uploadTextureNativeBody(texture, flip, ver);
    } finally {
      texture._uploadingNative = false;
    }
  }

  function uploadTextureNativeBody(texture, flip, ver) {
    const raster = rasterizeToRgba(texture);
    if (!raster || !raster.width || !raster.height || !raster.pixels) return;
    let pixels = raster.pixels;
    if (flip) {
      const stride = raster.width * 4;
      const flipped = new Uint8ClampedArray(pixels.length);
      for (let y = 0; y < raster.height; y++) {
        flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (raster.height - 1 - y) * stride);
      }
      pixels = flipped;
    }
    const params = textureParams(texture);
    if (TN.cmd && typeof TN.cmd.uploadRgba === "function") {
      try {
        const id = texture._h || TN.cmd.alloc();
        if (TN.cmd.uploadRgba(id, raster.width, raster.height, pixels, params)) {
          texture._h = id;
          texture._nativeFlipY = flip;
          texture._nativeVersion = ver;
          bindWaitingMaterials(texture);
          return;
        }
      } catch {
        /* fall through to COM */
      }
    }
    const host = native();
    if (!TN.hostHas?.(host, "TextureFromRgba")) return;
    try {
      if (TN.cmd && typeof TN.cmd.submit === "function") {
        try {
          TN.cmd.submit();
        } catch {
          /* cmd ring may not be attached yet */
        }
      }
      texture._h = host.TextureFromRgba(raster.width, raster.height, bytesToB64(pixels));
      absorbNativeId(texture._h);
    } catch {
      texture._h = 0;
      return;
    }
    if (!texture._h) return;
    texture._nativeFlipY = flip;
    texture._nativeVersion = ver;
    try {
      if (TN.hostHas(host, "TextureSetFilter")) {
        host.TextureSetFilter(texture._h, texture.magFilter, texture.minFilter);
      }
    } catch {
      /* filter is optional */
    }
    try {
      applyNativeTexParams(texture);
    } catch {
      /* wrap/colorSpace optional */
    }
    bindWaitingMaterials(texture);
  }

  function ensureTextureNative(texture) {
    if (!texture || !texture.image) return;
    uploadTextureNative(texture);
  }

  class TextureLoader extends Loader {
    constructor(manager) {
      super(manager);
    }
    load(url, onLoad, onProgress, onError) {
      const texture = new Texture();
      if (this.path !== undefined) url = this.path + url;
      url = this.manager.resolveURL(url);
      const scope = this;
      const img = new Image();
      if (String(url).slice(0, 5) !== "data:") {
        img.crossOrigin = this.crossOrigin || "anonymous";
      }
      scope.manager.itemStart(url);
      img.onload = function () {
        queueMicrotask(function () {
          try {
            texture.image = img;
            texture.needsUpdate = true;
            if (onLoad) onLoad(texture);
            scope.manager.itemEnd(url);
          } catch (err) {
            if (onError) onError(err);
            else console.warn("ThreeBrowser texture upload failed", err);
            scope.manager.itemError(url);
            scope.manager.itemEnd(url);
          }
        });
      };
      img.onerror = function (err) {
        if (onError) onError(err);
        scope.manager.itemError(url);
        scope.manager.itemEnd(url);
      };
      img.src = url;
      return texture;
    }
  }

  class CubeTextureLoader extends Loader {
    constructor(manager) {
      super(manager);
    }
    load(urls, onLoad, onProgress, onError) {
      const texture = new CubeTexture();
      texture.colorSpace = SRGBColorSpace;
      try {
        const list = Array.isArray(urls) ? urls : [];
        if (list.length === 0) return texture;
        const loader = new ImageLoader(this.manager);
        loader.setCrossOrigin(this.crossOrigin);
        loader.setPath(this.path);
        let loaded = 0;
        const total = Math.min(list.length, 6);
        function check() {
          loaded++;
          if (loaded >= total) {
            texture.needsUpdate = true;
            if (onLoad) onLoad(texture);
          }
        }
        for (let i = 0; i < total; i++) {
          loader.load(
            list[i],
            function (image) {
              try {
                texture.images[i] = image;
              } catch {
                /* ignore */
              }
              check();
            },
            undefined,
            function (err) {
              if (onError) {
                try {
                  onError(err);
                } catch {
                  /* ignore */
                }
              }
              check();
            }
          );
        }
      } catch (e) {
        if (onError) {
          try {
            onError(e);
          } catch {
            /* ignore */
          }
        }
      }
      return texture;
    }
  }

  class AudioLoader extends Loader {
    constructor(manager) {
      super(manager);
    }
    load(/* url, onLoad, onProgress, onError */) {}
  }

  const MAP_KEYS = {
    map: 1,
    matcap: 1,
    alphaMap: 1,
    bumpMap: 1,
    normalMap: 1,
    displacementMap: 1,
    roughnessMap: 1,
    metalnessMap: 1,
    emissiveMap: 1,
    specularMap: 1,
    specularIntensityMap: 1,
    specularColorMap: 1,
    envMap: 1,
    lightMap: 1,
    aoMap: 1,
    gradientMap: 1,
    clearcoatMap: 1,
    clearcoatRoughnessMap: 1,
    clearcoatNormalMap: 1,
    iridescenceMap: 1,
    iridescenceThicknessMap: 1,
    transmissionMap: 1,
    thicknessMap: 1,
    anisotropyMap: 1,
    sheenColorMap: 1,
    sheenRoughnessMap: 1,
  };

  class MaterialLoader extends Loader {
    constructor(manager) {
      super(manager);
      this.textures = {};
    }
    load(url, onLoad, onProgress, onError) {
      const scope = this;
      const loader = new FileLoader(scope.manager);
      loader.setPath(scope.path);
      loader.setRequestHeader(scope.requestHeader);
      loader.setWithCredentials(scope.withCredentials);
      loader.load(
        url,
        function (text) {
          try {
            onLoad(scope.parse(JSON.parse(text)));
          } catch (e) {
            if (onError) onError(e);
            else console.error(e);
            scope.manager.itemError(url);
          }
        },
        onProgress,
        onError
      );
    }
    parse(json) {
      const textures = this.textures;
      const material = this.createMaterialFromType(json.type || "MeshStandardMaterial");
      for (const key in json) {
        if (key === "type") continue;
        const value = json[key];
        if (MAP_KEYS[key]) {
          material[key] = textures[value];
          continue;
        }
        if (
          (key === "color" ||
            key === "emissive" ||
            key === "specular" ||
            key === "specularColor" ||
            key === "attenuationColor" ||
            key === "sheenColor") &&
          material[key] &&
          typeof material[key].setHex === "function"
        ) {
          material[key].setHex(value);
          continue;
        }
        if (key === "normalScale" || key === "clearcoatNormalScale") {
          const arr = Array.isArray(value) ? value : [value, value];
          material[key] = new Vector2().fromArray(arr);
          continue;
        }
        material[key] = value;
      }
      return material;
    }
    setTextures(value) {
      this.textures = value;
      return this;
    }
    createMaterialFromType(type) {
      return MaterialLoader.createMaterialFromType(type);
    }
    static createMaterialFromType(type) {
      return construct(type);
    }
  }

  class BufferGeometryLoader extends Loader {
    constructor(manager) {
      super(manager);
    }
    load(url, onLoad, onProgress, onError) {
      const scope = this;
      const loader = new FileLoader(scope.manager);
      loader.setPath(scope.path);
      loader.setRequestHeader(scope.requestHeader);
      loader.setWithCredentials(scope.withCredentials);
      loader.load(
        url,
        function (text) {
          try {
            onLoad(scope.parse(JSON.parse(text)));
          } catch (e) {
            if (onError) onError(e);
            else console.error(e);
            scope.manager.itemError(url);
          }
        },
        onProgress,
        onError
      );
    }
    parse(json) {
      const Geometry = TN.BufferGeometry;
      const geometry = Geometry ? new Geometry() : { attributes: {}, morphAttributes: {} };
      const data = json.data || json;
      const Attribute = TN.BufferAttribute || function (array, itemSize, normalized) {
        this.array = array;
        this.itemSize = itemSize;
        this.normalized = !!normalized;
      };
      if (typeof geometry.setAttribute !== "function") {
        geometry.setAttribute = function (name, attr) {
          this.attributes[name] = attr;
          return this;
        };
      }
      if (typeof geometry.setIndex !== "function") {
        geometry.setIndex = function (attr) {
          this.index = attr;
          return this;
        };
      }
      if (data.index) {
        geometry.setIndex(new Attribute(getTypedArray(data.index.type, data.index.array), 1));
      }
      const attributes = data.attributes;
      if (attributes) {
        for (const key in attributes) {
          const attribute = attributes[key];
          const typed = getTypedArray(attribute.type, attribute.array);
          const attr = new Attribute(typed, attribute.itemSize, attribute.normalized);
          if (attribute.name !== undefined) attr.name = attribute.name;
          geometry.setAttribute(key, attr);
        }
      }
      if (json.name) geometry.name = json.name;
      if (json.userData) geometry.userData = json.userData;
      if (json.uuid) geometry.uuid = json.uuid;
      return geometry;
    }
  }

  class ObjectLoader extends Loader {
    constructor(manager) {
      super(manager);
    }
    load(url, onLoad, onProgress, onError) {
      const scope = this;
      const path = this.path === "" ? LoaderUtils.extractUrlBase(url) : this.path;
      this.resourcePath = this.resourcePath || path;
      const loader = new FileLoader(this.manager);
      loader.setPath(this.path);
      loader.setRequestHeader(this.requestHeader);
      loader.setWithCredentials(this.withCredentials);
      loader.load(
        url,
        function (text) {
          try {
            const json = JSON.parse(text);
            scope.parse(json, onLoad);
          } catch (error) {
            if (onError) onError(error);
          }
        },
        onProgress,
        onError
      );
    }
    parse(json, onLoad) {
      const geometries = {};
      if (json.geometries) {
        const geoLoader = new BufferGeometryLoader();
        for (let i = 0; i < json.geometries.length; i++) {
          const data = json.geometries[i];
          try {
            const geometry = geoLoader.parse(data);
            if (data.uuid) geometries[data.uuid] = geometry;
          } catch {
            /* ignore */
          }
        }
      }
      const textures = {};
      if (json.textures) {
        for (let i = 0; i < json.textures.length; i++) {
          const data = json.textures[i];
          const texture = new Texture();
          if (data.uuid) texture.uuid = data.uuid;
          if (data.name !== undefined) texture.name = data.name;
          if (data.mapping !== undefined) texture.mapping = data.mapping;
          if (data.wrap) {
            texture.wrapS = data.wrap[0];
            texture.wrapT = data.wrap[1];
          }
          if (data.repeat && texture.repeat.fromArray) texture.repeat.fromArray(data.repeat);
          if (data.offset && texture.offset.fromArray) texture.offset.fromArray(data.offset);
          if (data.center && texture.center.fromArray) texture.center.fromArray(data.center);
          if (data.rotation !== undefined) texture.rotation = data.rotation;
          if (data.minFilter !== undefined) texture.minFilter = data.minFilter;
          if (data.magFilter !== undefined) texture.magFilter = data.magFilter;
          if (data.anisotropy !== undefined) texture.anisotropy = data.anisotropy;
          if (data.flipY !== undefined) texture.flipY = data.flipY;
          if (data.colorSpace !== undefined) texture.colorSpace = data.colorSpace;
          if (data.uuid) textures[data.uuid] = texture;
        }
      }
      const materials = {};
      if (json.materials) {
        const matLoader = new MaterialLoader();
        matLoader.setTextures(textures);
        for (let i = 0; i < json.materials.length; i++) {
          const data = json.materials[i];
          try {
            materials[data.uuid] = matLoader.parse(data);
          } catch {
            /* ignore */
          }
        }
      }
      const object = this.parseObject(json.object || json, geometries, materials);
      if (onLoad) onLoad(object);
      return object;
    }
    parseObject(data, geometries, materials) {
      if (!data) return construct("Object3D");
      const type = data.type || "Object3D";
      let object;
      const geo = data.geometry != null && geometries ? geometries[data.geometry] : undefined;
      let mat;
      if (data.material != null && materials) {
        mat = Array.isArray(data.material)
          ? data.material.map(function (id) {
              return materials[id];
            })
          : materials[data.material];
      }
      if (type === "PerspectiveCamera") {
        object = construct(type, [data.fov, data.aspect, data.near, data.far]);
      } else if (type === "OrthographicCamera") {
        object = construct(type, [data.left, data.right, data.top, data.bottom, data.near, data.far]);
      } else if (geo !== undefined || mat !== undefined) {
        object = construct(type, [geo, mat]);
      } else if (type === "AmbientLight" || type === "DirectionalLight" || type === "PointLight") {
        object = construct(type, [data.color, data.intensity]);
      } else {
        object = construct(type);
      }
      if (data.uuid) object.uuid = data.uuid;
      if (data.name !== undefined) object.name = data.name;
      if (data.visible !== undefined) object.visible = data.visible;
      if (data.userData !== undefined) object.userData = data.userData;
      if (data.position && object.position && object.position.fromArray) object.position.fromArray(data.position);
      if (data.rotation && object.rotation && object.rotation.fromArray) object.rotation.fromArray(data.rotation);
      if (data.quaternion && object.quaternion && object.quaternion.fromArray) {
        object.quaternion.fromArray(data.quaternion);
      }
      if (data.scale && object.scale && object.scale.fromArray) object.scale.fromArray(data.scale);
      if (data.children) {
        for (let i = 0; i < data.children.length; i++) {
          const child = this.parseObject(data.children[i], geometries, materials);
          if (object.add) object.add(child);
        }
      }
      return object;
    }
  }

  TN.Source = Source;
  TN.Texture = Texture;
  TN.CanvasTexture = CanvasTexture;
  TN.VideoTexture = VideoTexture;
  TN.DataTexture = DataTexture;
  TN.Data3DTexture = Data3DTexture;
  TN.DataArrayTexture = DataArrayTexture;
  TN.CompressedTexture = CompressedTexture;
  TN.CubeTexture = CubeTexture;
  TN.DepthTexture = DepthTexture;
  TN.FramebufferTexture = FramebufferTexture;
  TN.TextureLoader = TextureLoader;
  TN.CubeTextureLoader = CubeTextureLoader;
  TN.FileLoader = FileLoader;
  TN.ImageLoader = ImageLoader;
  TN.ImageBitmapLoader = ImageBitmapLoader;
  TN.LoadingManager = LoadingManager;
  TN.DefaultLoadingManager = DefaultLoadingManager;
  TN.Loader = Loader;
  TN.LoaderUtils = LoaderUtils;
  TN.Cache = Cache;
  TN.ObjectLoader = ObjectLoader;
  TN.MaterialLoader = MaterialLoader;
  TN.BufferGeometryLoader = BufferGeometryLoader;
  TN.AudioLoader = AudioLoader;
  TN._ensureTextureNative = ensureTextureNative;
})(globalThis.__TN = globalThis.__TN || {});
