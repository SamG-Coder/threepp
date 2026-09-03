import { grayToRgba, rgbToRgba, rgbaToRgb } from "./tile-png.mjs";

export function wrapIndex(value, modulus) {
  const size = Math.trunc(modulus);
  if (size <= 0) return 0;
  return ((Math.trunc(value) % size) + size) % size;
}

export function lumaByte(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function cropRgb(src, srcWidth, srcHeight, x0, y0, cropWidth, cropHeight) {
  const dst = new Float32Array(cropWidth * cropHeight * 3);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const si = ((y0 + y) * srcWidth + (x0 + x)) * 3;
      const di = (y * cropWidth + x) * 3;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
    }
  }
  return dst;
}

export function boxBlurWrap(src, width, height, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let c = 0; c < 3; c += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) acc += src[(y * width + wrapIndex(k, width)) * 3 + c];
      for (let x = 0; x < width; x += 1) {
        tmp[(y * width + x) * 3 + c] = acc / span;
        acc += src[(y * width + wrapIndex(x + radius + 1, width)) * 3 + c];
        acc -= src[(y * width + wrapIndex(x - radius, width)) * 3 + c];
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) acc += tmp[(wrapIndex(k, height) * width + x) * 3 + c];
      for (let y = 0; y < height; y += 1) {
        dst[(y * width + x) * 3 + c] = acc / span;
        acc += tmp[(wrapIndex(y + radius + 1, height) * width + x) * 3 + c];
        acc -= tmp[(wrapIndex(y - radius, height) * width + x) * 3 + c];
      }
    }
  }
  return dst;
}

export function highPassWrap(rgb, width, height, radius) {
  const blur = boxBlurWrap(boxBlurWrap(rgb, width, height, radius), width, height, radius);
  const mean = [0, 0, 0];
  const n = width * height;
  for (let i = 0; i < n; i += 1) {
    mean[0] += rgb[i * 3];
    mean[1] += rgb[i * 3 + 1];
    mean[2] += rgb[i * 3 + 2];
  }
  mean[0] /= n;
  mean[1] /= n;
  mean[2] /= n;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgb[i * 3 + c] - blur[i * 3 + c] + mean[c];
      rgb[i * 3 + c] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
  return rgb;
}

export function quiltRgb(src, srcWidth, srcHeight, tileWidth, tileHeight, patch, overlap, seed) {
  const dst = new Float32Array(tileWidth * tileHeight * 3);
  const weight = new Float32Array(tileWidth * tileHeight);
  const mean = [0, 0, 0];
  const sourceCount = srcWidth * srcHeight;
  for (let i = 0; i < sourceCount; i += 1) {
    mean[0] += src[i * 3];
    mean[1] += src[i * 3 + 1];
    mean[2] += src[i * 3 + 2];
  }
  mean[0] /= sourceCount;
  mean[1] /= sourceCount;
  mean[2] /= sourceCount;
  for (let i = 0; i < tileWidth * tileHeight; i += 1) {
    dst[i * 3] = mean[0];
    dst[i * 3 + 1] = mean[1];
    dst[i * 3 + 2] = mean[2];
  }
  const random = mulberry32(seed);
  const step = Math.max(1, patch - overlap);
  const maxOx = Math.max(1, srcWidth - patch);
  const maxOy = Math.max(1, srcHeight - patch);
  for (let ty = -overlap; ty < tileHeight; ty += step) {
    for (let tx = -overlap; tx < tileWidth; tx += step) {
      const sx0 = Math.floor(random() * maxOx);
      const sy0 = Math.floor(random() * maxOy);
      for (let py = 0; py < patch; py += 1) {
        const dy = wrapIndex(ty + py, tileHeight);
        let wy = 1;
        if (py < overlap) wy = py / overlap;
        if (py >= patch - overlap) wy = (patch - 1 - py) / overlap;
        wy = wy * wy * (3 - 2 * wy);
        for (let px = 0; px < patch; px += 1) {
          const dx = wrapIndex(tx + px, tileWidth);
          let wx = 1;
          if (px < overlap) wx = px / overlap;
          if (px >= patch - overlap) wx = (patch - 1 - px) / overlap;
          wx = wx * wx * (3 - 2 * wx);
          const w = wx * wy;
          const di = (dy * tileWidth + dx) * 3;
          const si = ((sy0 + py) * srcWidth + (sx0 + px)) * 3;
          const acc = weight[dy * tileWidth + dx];
          const sum = acc + w;
          if (sum <= 1e-8) continue;
          dst[di] = (dst[di] * acc + src[si] * w) / sum;
          dst[di + 1] = (dst[di + 1] * acc + src[si + 1] * w) / sum;
          dst[di + 2] = (dst[di + 2] * acc + src[si + 2] * w) / sum;
          weight[dy * tileWidth + dx] = sum;
        }
      }
    }
  }
  return dst;
}

export function patchCornerMark(rgb, width, height) {
  const stampW = Math.max(8, Math.floor(width * 0.18));
  const stampH = Math.max(8, Math.floor(height * 0.08));
  const dx = width - stampW;
  const dy = height - stampH;
  const sx = Math.max(0, width - stampW * 3);
  const sy = Math.max(0, height - stampH * 3);
  for (let y = 0; y < stampH; y += 1) {
    for (let x = 0; x < stampW; x += 1) {
      const si = ((sy + y) * width + (sx + x)) * 3;
      const di = ((dy + y) * width + (dx + x)) * 3;
      rgb[di] = rgb[si];
      rgb[di + 1] = rgb[si + 1];
      rgb[di + 2] = rgb[si + 2];
    }
  }
  return rgb;
}

export function wrapBlendEdges(rgb, width, height, blend = 32) {
  const radius = Math.max(1, Math.min(blend, Math.floor(Math.min(width, height) / 4)));
  const copy = Float32Array.from(rgb);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < radius; x += 1) {
      const t = x / radius;
      const w = t * t * (3 - 2 * t);
      const left = (y * width + x) * 3;
      const right = (y * width + (width - radius + x)) * 3;
      for (let c = 0; c < 3; c += 1) {
        const mixed = copy[right + c] * (1 - w) + copy[left + c] * w;
        rgb[left + c] = mixed;
        rgb[right + c] = mixed;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < radius; y += 1) {
      const t = y / radius;
      const w = t * t * (3 - 2 * t);
      const top = (y * width + x) * 3;
      const bottom = ((height - radius + y) * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const mixed = rgb[bottom + c] * (1 - w) + rgb[top + c] * w;
        rgb[top + c] = mixed;
        rgb[bottom + c] = mixed;
      }
    }
  }
  return rgb;
}

export function makeSeamless(rgba, width, height, options = {}) {
  const mode = options.mode ?? "quilt";
  const size = options.size ?? Math.min(width, height);
  let rgb = rgbaToRgb(rgba, width, height);
  patchCornerMark(rgb, width, height);
  if (mode === "keep") {
    return { width, height, rgb };
  }
  if (mode === "wrap") {
    const copy = rgb.slice();
    const radius = Math.max(2, Math.min(options.highPassTile ?? 10, Math.floor(Math.min(width, height) / 8)));
    highPassWrap(copy, width, height, radius);
    wrapBlendEdges(copy, width, height, options.wrapBlend ?? 28);
    return { width, height, rgb: copy };
  }

  const cropSize = Math.min(width, height) * 5 / 8 | 0;
  const cx = Math.floor((width - cropSize) / 2);
  let cy = Math.floor((height - cropSize) / 2) - Math.floor(height / 16);
  if (cy < 0) cy = Math.floor((height - cropSize) / 2);
  const cropped = cropRgb(rgb, width, height, cx, cy, cropSize, cropSize);
  const cropRadius = Math.max(2, Math.min(cropSize >> 2, Math.floor(cropSize / (options.highPassCrop ?? 14))));
  highPassWrap(cropped, cropSize, cropSize, cropRadius);
  const patch = Math.max(8, Math.min(options.patch ?? 176, cropSize));
  const overlap = Math.max(2, Math.min(options.overlap ?? 56, Math.floor(patch / 2)));
  const quilted = quiltRgb(
    cropped,
    cropSize,
    cropSize,
    size,
    size,
    patch,
    overlap,
    options.seed ?? 7,
  );
  highPassWrap(quilted, size, size, Math.max(2, Math.min(options.highPassTile ?? 20, size >> 3)));
  return { width: size, height: size, rgb: quilted };
}

export function bakeHeight(rgb, width, height, options = {}) {
  const gain = Number.isFinite(options.gain) ? options.gain : 2.4;
  const invert = Boolean(options.invert);
  const count = width * height;
  let mean = 0;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = lumaByte(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    luma[i] = value;
    mean += value;
  }
  mean /= count;
  const gray = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    let height01 = 0.5 + (luma[i] - mean) * gain;
    if (invert) height01 = 1 - height01;
    gray[i] = Math.max(0, Math.min(255, Math.round(height01 * 255)));
  }
  return gray;
}

export function bakeNormal(height, width, heightPixels, options = {}) {
  const strength = Number.isFinite(options.strength) ? options.strength : 8;
  const rgba = new Uint8ClampedArray(width * heightPixels * 4);
  const sample = (x, y) => height[wrapIndex(y, heightPixels) * width + wrapIndex(x, width)] / 255;
  for (let y = 0; y < heightPixels; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const o = (y * width + x) * 4;
      rgba[o] = Math.round((nx * 0.5 + 0.5) * 255);
      rgba[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      rgba[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

export function composite2x2(rgba, width, height) {
  const out = new Uint8ClampedArray(width * 2 * height * 2 * 4);
  for (let y = 0; y < height * 2; y += 1) {
    for (let x = 0; x < width * 2; x += 1) {
      const s = ((y % height) * width + (x % width)) * 4;
      const d = (y * width * 2 + x) * 4;
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
      out[d + 3] = rgba[s + 3];
    }
  }
  return { width: width * 2, height: height * 2, data: out };
}

export const TILE_SPECS = Object.freeze({
  "dry-sand": Object.freeze({
    needsRelief: true,
    mode: "quilt",
    patch: 176,
    overlap: 56,
    seed: 7,
    highPassCrop: 14,
    highPassTile: 20,
    heightGain: 1.85,
    normalStrength: 6.4,
  }),
  "wet-sand": Object.freeze({
    needsRelief: true,
    mode: "quilt",
    patch: 192,
    overlap: 64,
    seed: 11,
    highPassCrop: 12,
    highPassTile: 18,
    heightGain: 2.35,
    normalStrength: 8.6,
  }),
  "pebble-hash": Object.freeze({
    needsRelief: true,
    mode: "quilt",
    patch: 160,
    overlap: 52,
    seed: 19,
    highPassCrop: 16,
    highPassTile: 14,
    heightGain: 3.15,
    normalStrength: 10.4,
  }),
  "coastal-rock": Object.freeze({
    needsRelief: true,
    mode: "wrap",
    highPassTile: 8,
    wrapBlend: 28,
    heightGain: 3.2,
    normalStrength: 11,
  }),
  "dune-grass": Object.freeze({
    needsRelief: true,
    mode: "quilt",
    patch: 168,
    overlap: 56,
    seed: 29,
    highPassCrop: 16,
    highPassTile: 18,
    heightGain: 1.45,
    normalStrength: 5.4,
  }),
  "palm-bark": Object.freeze({
    needsRelief: true,
    mode: "wrap",
    highPassTile: 8,
    wrapBlend: 24,
    heightGain: 2.85,
    normalStrength: 11.2,
  }),
  "palm-leaf": Object.freeze({
    needsRelief: true,
    mode: "wrap",
    outputSize: 1024,
    highPassTile: 6,
    wrapBlend: 32,
    heightGain: 0.9,
    normalStrength: 3.2,
  }),
  "lunar-surface": Object.freeze({
    needsRelief: true,
    mode: "keep",
    heightGain: 2.4,
    normalStrength: 8.5,
  }),
});

export function bakeTileMaps(rgba, width, height, spec = {}) {
  if (spec.needsRelief === false) {
    return {
      width,
      height,
      albedo: Uint8ClampedArray.from(rgba),
      heightMap: null,
      normal: null,
    };
  }
  const seamless = makeSeamless(rgba, width, height, spec);
  const albedo = rgbToRgba(seamless.rgb);
  const heightMap = bakeHeight(seamless.rgb, seamless.width, seamless.height, {
    gain: spec.heightGain,
    invert: spec.invert,
  });
  const normal = bakeNormal(heightMap, seamless.width, seamless.height, {
    strength: spec.normalStrength,
  });
  return {
    width: seamless.width,
    height: seamless.height,
    albedo,
    heightMap,
    normal,
    preview: composite2x2(albedo, seamless.width, seamless.height),
  };
}
