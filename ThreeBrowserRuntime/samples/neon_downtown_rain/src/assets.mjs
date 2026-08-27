import * as THREE from "three/webgpu";

const ASSET_ROOT = new URL("../assets/", import.meta.url);
const textureCache = new Map();
let manifestPaths = null;
const requestedAssetPaths = new Set();
const report = {
  sample: "neon_downtown_rain",
  policy: "grok-only-2d",
  startedAt: new Date().toISOString(),
  ready: false,
  loaded: 0,
  failed: 0,
  entries: {},
};

globalThis.__NEON_DOWNTOWN_ASSET_REPORT__ = report;

function assetUrl(relativePath) {
  const clean = String(relativePath || "").replace(/^assets[\\/]/, "");
  if (!clean || clean.includes("..")) {
    throw new RangeError("Invalid downtown asset path: " + relativePath);
  }
  if (!manifestPaths) {
    throw new Error("The Grok asset manifest must load before any downtown image.");
  }
  if (!manifestPaths.has(clean)) {
    throw new Error("Runtime requested an image absent from the Grok manifest: " + relativePath);
  }
  requestedAssetPaths.add(clean);
  return new URL(clean, ASSET_ROOT);
}

function record(relativePath, values) {
  report.entries[relativePath] = Object.assign(
    { path: relativePath, generator: "grok", sourceType: "2d-raster" },
    report.entries[relativePath] || {},
    values,
  );
}

async function loadImage(relativePath) {
  const url = assetUrl(relativePath);
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Could not load Grok image: " + relativePath));
    image.src = url.href;
  });
  if (typeof image.decode === "function") {
    try {
      await image.decode();
    } catch {
      // A completed load with valid dimensions is usable even if decode() is
      // unavailable or rejects on a particular browser image backend.
    }
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("Grok image decoded without dimensions: " + relativePath);
  }
  return image;
}

function isKeyMagenta(r, g, b) {
  const separation = Math.min(r, b) - g;
  const chroma = (r - g) + (b - g);
  return (
    (r > 145 && b > 80 && g < 178 && separation > 34 && chroma > 92)
    || (r > 95 && b > 72 && g < 135 && separation > 40 && chroma > 110)
  );
}

function keyMagenta(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const pixelCount = width * height;
  const candidates = new Uint8Array(pixelCount);
  const exterior = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; ++pixel) {
    const offset = pixel * 4;
    candidates[pixel] = data[offset + 3] > 0
      && isKeyMagenta(data[offset], data[offset + 1], data[offset + 2])
      ? 1
      : 0;
  }
  let head = 0;
  let tail = 0;
  function seed(pixel) {
    if (!candidates[pixel] || exterior[pixel]) return;
    exterior[pixel] = 1;
    queue[tail++] = pixel;
  }
  for (let x = 0; x < width; ++x) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; ++y) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) seed(pixel - 1);
    if (x + 1 < width) seed(pixel + 1);
    if (y > 0) seed(pixel - width);
    if (y + 1 < height) seed(pixel + width);
  }
  let keyR = 0;
  let keyG = 0;
  let keyB = 0;
  let keyCount = 0;
  for (let pixel = 0; pixel < pixelCount; ++pixel) {
    if (!exterior[pixel]) continue;
    const offset = pixel * 4;
    keyR += data[offset];
    keyG += data[offset + 1];
    keyB += data[offset + 2];
    keyCount += 1;
  }
  if (keyCount > 0) {
    keyR /= keyCount;
    keyG /= keyCount;
    keyB /= keyCount;
  }
  const removed = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; ++pixel) {
    const offset = pixel * 4;
    const closeToLearnedKey = keyCount > 0
      && candidates[pixel]
      && Math.abs(data[offset] - keyR) <= 42
      && Math.abs(data[offset + 1] - keyG) <= 42
      && Math.abs(data[offset + 2] - keyB) <= 48
      && (
        Math.abs(data[offset] - keyR)
        + Math.abs(data[offset + 1] - keyG)
        + Math.abs(data[offset + 2] - keyB)
      ) <= 92;
    if (exterior[pixel] || closeToLearnedKey) removed[pixel] = 1;
  }
  for (let pixel = 0; pixel < pixelCount; ++pixel) {
    const offset = pixel * 4;
    if (removed[pixel]) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      continue;
    }
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const touchesRemovedKey = (
      (x > 0 && removed[pixel - 1])
      || (x + 1 < width && removed[pixel + 1])
      || (y > 0 && removed[pixel - width])
      || (y + 1 < height && removed[pixel + width])
    );
    if (!touchesRemovedKey) continue;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const spill = Math.max(0, Math.min(r, b) - g - 16);
    if (spill > 0) {
      data[offset] = Math.max(0, r - spill * 0.46);
      data[offset + 2] = Math.max(0, b - spill * 0.38);
      data[offset + 3] = Math.min(data[offset + 3], 214);
    }
  }
  return imageData;
}

function clearGrokOverlayCorner(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const startX = Math.floor(width * 0.76);
  const startY = Math.floor(height * 0.88);
  for (let y = startY; y < height; ++y) {
    for (let x = startX; x < width; ++x) {
      const offset = (y * width + x) * 4;
      imageData.data[offset] = 0;
      imageData.data[offset + 1] = 0;
      imageData.data[offset + 2] = 0;
      imageData.data[offset + 3] = 0;
    }
  }
  return imageData;
}

function alphaBounds(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      if (data[(y * width + x) * 4 + 3] <= 10) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error("Chroma key removed the whole Grok image.");
  }
  return { minX, minY, maxX, maxY };
}

function sourceCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}

function atlasSafeSource(image) {
  const full = sourceCanvas(image);
  const context = full.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, full.width, full.height).data;
  const safeWidth = Math.max(4, Math.floor(full.width * 0.75));
  const safeHeight = Math.max(2, Math.floor(full.height * 0.87));
  const overlayStartX = Math.floor(full.width * 0.76);
  const overlayStartY = Math.floor(full.height * 0.88);
  let rightPixels = 0;
  let rightMagenta = 0;
  let bottomPixels = 0;
  let bottomMagenta = 0;
  for (let y = 0; y < full.height; y += 3) {
    for (let x = 0; x < full.width; x += 3) {
      const offset = (y * full.width + x) * 4;
      const key = isKeyMagenta(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      if (x >= safeWidth && y < overlayStartY) {
        rightPixels += 1;
        if (key) rightMagenta += 1;
      }
      if (y >= safeHeight && x < overlayStartX) {
        bottomPixels += 1;
        if (key) bottomMagenta += 1;
      }
    }
  }
  const rightRatio = rightMagenta / Math.max(1, rightPixels);
  const bottomRatio = bottomMagenta / Math.max(1, bottomPixels);
  if (rightRatio < 0.94 || bottomRatio < 0.94) {
    console.warn(
      "Grok atlas must keep its 4x2 grid inside the upper-left 75% x 87% safe region"
      + ` (right key=${rightRatio.toFixed(3)}, bottom key=${bottomRatio.toFixed(3)}); using full-sheet fallback.`,
    );
    return { canvas: full, used: false };
  }
  const canvas = document.createElement("canvas");
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  canvas.getContext("2d").drawImage(
    full,
    0,
    0,
    safeWidth,
    safeHeight,
    0,
    0,
    safeWidth,
    safeHeight,
  );
  return { canvas, used: true };
}

function keyedCanvas(image, crop, safeAtlas) {
  const prepared = safeAtlas ? atlasSafeSource(image) : { canvas: sourceCanvas(image), used: false };
  const source = prepared.canvas;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  let keyed = keyMagenta(sourceContext.getImageData(0, 0, source.width, source.height));
  if (!prepared.used) keyed = clearGrokOverlayCorner(keyed);
  sourceContext.putImageData(keyed, 0, 0);
  if (!crop) {
    return { canvas: source, width: source.width, height: source.height, safeAtlas: prepared.used };
  }
  const bounds = alphaBounds(keyed);
  const padding = 3;
  const x = Math.max(0, bounds.minX - padding);
  const y = Math.max(0, bounds.minY - padding);
  const width = Math.min(source.width - x, bounds.maxX - bounds.minX + 1 + padding * 2);
  const height = Math.min(source.height - y, bounds.maxY - bounds.minY + 1 + padding * 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, x, y, width, height, 0, 0, width, height);
  return { canvas, width, height, safeAtlas: prepared.used };
}

function configureColorTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function trimmedCanvas(image, margin = 0.14) {
  const trim = THREE.MathUtils.clamp(Number(margin) || 0, 0, 0.24);
  const sourceX = Math.floor(image.naturalWidth * trim);
  const sourceY = Math.floor(image.naturalHeight * trim);
  const sourceWidth = Math.max(1, image.naturalWidth - sourceX * 2);
  const sourceHeight = Math.max(1, image.naturalHeight - sourceY * 2);
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  canvas.getContext("2d").drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  return canvas;
}

function maskedFullCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  context.clearRect(
    Math.floor(canvas.width * 0.76),
    Math.floor(canvas.height * 0.88),
    Math.ceil(canvas.width * 0.24),
    Math.ceil(canvas.height * 0.12),
  );
  return canvas;
}

export async function loadCutout(relativePath, options = {}) {
  const crop = options.crop !== false;
  const safeAtlas = Boolean(options.safeAtlas);
  const cacheKey = "cutout:" + relativePath + ":" + crop + ":" + safeAtlas;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const pending = (async () => {
    try {
      const image = await loadImage(relativePath);
      const keyed = keyedCanvas(image, crop, safeAtlas);
      const texture = configureColorTexture(new THREE.CanvasTexture(keyed.canvas));
      texture.name = "Grok 2D cutout — " + relativePath;
      const result = {
        texture,
        canvas: keyed.canvas,
        width: keyed.width,
        height: keyed.height,
        aspect: keyed.width / Math.max(1, keyed.height),
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
        safeAtlas: keyed.safeAtlas,
        relativePath,
      };
      report.loaded += 1;
      record(relativePath, {
        status: "loaded",
        mode: keyed.safeAtlas ? "chroma-cutout-safe-atlas" : "chroma-cutout",
        dimensions: [image.naturalWidth, image.naturalHeight],
      });
      return result;
    } catch (error) {
      report.failed += 1;
      record(relativePath, { status: "failed", error: error.message || String(error) });
      throw error;
    }
  })();
  textureCache.set(cacheKey, pending);
  return pending;
}

export async function loadSurface(relativePath, options = {}) {
  const margin = Number(options.trimMargin ?? 0.14);
  const cacheKey = "surface:" + relativePath + ":" + margin;
  if (textureCache.has(cacheKey)) {
    const cached = await textureCache.get(cacheKey);
    return options.clone ? Object.assign({}, cached, { texture: cached.texture.clone() }) : cached;
  }
  const pending = (async () => {
    try {
      const image = await loadImage(relativePath);
      const canvas = trimmedCanvas(image, margin);
      const texture = new THREE.CanvasTexture(canvas);
      configureColorTexture(texture);
      texture.wrapS = THREE.MirroredRepeatWrapping;
      texture.wrapT = THREE.MirroredRepeatWrapping;
      texture.name = "Grok 2D surface — " + relativePath;
      const result = {
        texture,
        width: canvas.width,
        height: canvas.height,
        aspect: canvas.width / Math.max(1, canvas.height),
        relativePath,
      };
      report.loaded += 1;
      record(relativePath, {
        status: "loaded",
        mode: "flat-surface-trimmed-source-overlay",
        dimensions: [image.naturalWidth, image.naturalHeight],
      });
      return result;
    } catch (error) {
      report.failed += 1;
      record(relativePath, { status: "failed", error: error.message || String(error) });
      throw error;
    }
  })();
  textureCache.set(cacheKey, pending);
  const result = await pending;
  return options.clone ? Object.assign({}, result, { texture: result.texture.clone() }) : result;
}

export async function loadMask(relativePath, options = {}) {
  const preserveGrid = Boolean(options.preserveGrid);
  const safeAtlas = Boolean(options.safeAtlas);
  const cacheKey = "mask:" + relativePath + ":" + preserveGrid + ":" + safeAtlas;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const pending = (async () => {
    try {
      const image = await loadImage(relativePath);
      const prepared = safeAtlas ? atlasSafeSource(image) : null;
      const canvas = prepared?.used
        ? prepared.canvas
        : preserveGrid
          ? maskedFullCanvas(image)
          : trimmedCanvas(image, 0.14);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = preserveGrid ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
      texture.wrapT = preserveGrid ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      texture.name = "Grok 2D mask — " + relativePath;
      const result = {
        texture,
        width: canvas.width,
        height: canvas.height,
        aspect: canvas.width / Math.max(1, canvas.height),
        relativePath,
      };
      report.loaded += 1;
      record(relativePath, {
        status: "loaded",
        mode: prepared?.used
          ? "mask-safe-atlas"
          : preserveGrid
            ? "mask-corner-cleared"
            : "mask-trimmed-source-overlay",
        dimensions: [image.naturalWidth, image.naturalHeight],
      });
      return result;
    } catch (error) {
      report.failed += 1;
      record(relativePath, { status: "failed", error: error.message || String(error) });
      throw error;
    }
  })();
  textureCache.set(cacheKey, pending);
  return pending;
}

export async function loadSceneConfig() {
  const response = await fetch(new URL("../scene-config.json", import.meta.url));
  if (!response.ok) throw new Error("Could not load scene-config.json: HTTP " + response.status);
  const config = await response.json();
  if (Number(config?.format) !== 2) {
    throw new Error("scene-config.json must use modular face-on format 2.");
  }
  if (!Array.isArray(config.backgroundStructures) || config.backgroundStructures.length === 0) {
    throw new Error("scene-config.json requires backgroundStructures[].");
  }
  if (!Array.isArray(config.buildings) || config.buildings.length === 0) {
    throw new Error("scene-config.json requires buildings[].");
  }
  const pathIsValid = value => (
    typeof value === "string"
    && value.length > 4
    && !value.startsWith("assets/")
    && !value.includes("..")
    && value.endsWith(".png")
  );
  const ids = new Set();
  for (const building of config.buildings) {
    if (typeof building?.id !== "string" || !building.id || ids.has(building.id)) {
      throw new Error("Every modular building needs a unique id.");
    }
    ids.add(building.id);
    if (!pathIsValid(building.shell)
      || !pathIsValid(building.storefront?.asset)
      || !pathIsValid(building.windows?.asset)
      || !pathIsValid(building.sign?.asset)
      || (building.awning && !pathIsValid(building.awning.asset))) {
      throw new Error("Building " + building.id + " has an invalid modular image path.");
    }
    if (Array.isArray(building.sign) || !building.sign) {
      throw new Error("Building " + building.id + " must have exactly one sign component.");
    }
    const columns = Math.trunc(Number(building.windows.columns));
    const rows = Math.trunc(Number(building.windows.rows));
    if (columns < 1 || rows < 1 || columns > 8 || rows > 10) {
      throw new Error("Building " + building.id + " has an invalid repeated-window grid.");
    }
  }
  const nearestBuildingLayer = Number(config.world?.facadeZ) - 0.048;
  const sidewalkLimit = Number(config.world?.farSidewalkZ?.[1]);
  if (!Number.isFinite(nearestBuildingLayer)
    || !Number.isFinite(sidewalkLimit)
    || nearestBuildingLayer <= sidewalkLimit) {
    throw new Error("Modular building cards must remain behind the walkable sidewalk.");
  }
  return config;
}

export async function loadAssetManifest() {
  const response = await fetch(new URL("../asset-manifest.json", import.meta.url));
  if (!response.ok) throw new Error("Could not load asset-manifest.json: HTTP " + response.status);
  const manifest = await response.json();
  const paths = Object.values(manifest?.groups || {}).flat();
  const uniquePaths = new Set(paths);
  const validPath = path => (
    typeof path === "string"
    && path.startsWith("assets/")
    && path.endsWith(".png")
    && !path.includes("..")
  );
  if (Number(manifest?.format) !== 2
    || paths.length === 0
    || paths.length !== uniquePaths.size
    || !paths.every(validPath)) {
    throw new Error("asset-manifest.json must contain a non-empty set of unique Grok asset paths.");
  }
  manifestPaths = new Set(paths.map(path => path.replace(/^assets[\\/]/, "")));
  return Object.assign(manifest, { expectedAssetCount: uniquePaths.size });
}

export async function loadGenerationReport() {
  const response = await fetch(new URL("../asset-generation-report.json", import.meta.url));
  if (!response.ok) {
    throw new Error("Could not load asset-generation-report.json: HTTP " + response.status);
  }
  return response.json();
}

export function assertGenerationReport(generationReport, manifest) {
  const expectedPaths = Object.values(manifest?.groups || {}).flat();
  const files = Array.isArray(generationReport?.files) ? generationReport.files : [];
  const reportedPaths = files.map(file => file?.path);
  const uniqueReported = new Set(reportedPaths);
  const expectedSet = new Set(expectedPaths);
  const missing = expectedPaths.filter(path => !uniqueReported.has(path));
  const unexpected = reportedPaths.filter(path => !expectedSet.has(path));
  const invalidProvenance = files.some(file => (
    file?.generator !== "grok"
    || file?.sourceType !== "2d-raster"
    || file?.status !== "verified"
  ));
  if (Number(generationReport?.format) !== 2
    || generationReport?.generator !== "grok"
    || generationReport?.status !== "complete"
    || Number(generationReport?.expected) !== expectedPaths.length
    || files.length !== expectedPaths.length
    || uniqueReported.size !== files.length
    || missing.length
    || unexpected.length
    || invalidProvenance) {
    throw new Error(
      "Grok generation report is not complete and exact"
      + (missing.length ? ": missing " + missing.slice(0, 4).join(", ") : "."),
    );
  }
  return true;
}

export function assertAssetCoverage(expectedAssetCount) {
  if (!manifestPaths) throw new Error("The Grok asset manifest was not initialized.");
  const expected = Math.max(0, Math.trunc(Number(expectedAssetCount) || 0));
  const missing = [...manifestPaths].filter(path => !requestedAssetPaths.has(path));
  if (expected !== manifestPaths.size || requestedAssetPaths.size !== manifestPaths.size || missing.length) {
    const preview = missing.slice(0, 4).join(", ");
    throw new Error(
      "Runtime/Grok manifest coverage mismatch"
      + (preview ? ": missing " + preview : "."),
    );
  }
  if (report.loaded !== expected) {
    throw new Error(
      `Expected exactly ${expected} Grok images but loaded ${report.loaded} cache entries.`,
    );
  }
  return true;
}

export function cloneAtlasTexture(asset) {
  const texture = asset.texture.clone();
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const insetX = 0.5 / Math.max(4, Number(asset.width) || 4);
  const insetY = 0.5 / Math.max(2, Number(asset.height) || 2);
  texture.userData.atlasInsetX = insetX;
  texture.userData.atlasInsetY = insetY;
  texture.repeat.set(0.25 - insetX * 2, 0.5 - insetY * 2);
  return texture;
}

export function finishAssetReport(extra = {}) {
  Object.assign(report, extra);
  const expected = Math.max(0, Number(report.expectedAssets) || 0);
  report.ready = report.failed === 0 && (expected === 0 || report.loaded === expected);
  report.finishedAt = new Date().toISOString();
  console.log(
    "[Neon Downtown assets] loaded=" + report.loaded
    + " failed=" + report.failed
    + " policy=" + report.policy,
  );
  return report;
}

export function disposeAssetCache() {
  for (const pending of textureCache.values()) {
    Promise.resolve(pending).then(value => value?.texture?.dispose?.()).catch(() => {});
  }
  textureCache.clear();
}
