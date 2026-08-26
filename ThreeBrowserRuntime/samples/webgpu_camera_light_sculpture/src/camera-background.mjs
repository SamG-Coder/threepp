export const CAMERA_TEXTURE_WIDTH = 640;
export const CAMERA_TEXTURE_HEIGHT = 360;

const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));

function positiveDimension(value, label) {
  const result = Math.trunc(Number(value));
  if (!(result > 0)) throw new RangeError(`${label} must be a positive integer`);
  return result;
}

export function computeCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sw = positiveDimension(sourceWidth, "sourceWidth");
  const sh = positiveDimension(sourceHeight, "sourceHeight");
  const tw = positiveDimension(targetWidth, "targetWidth");
  const th = positiveDimension(targetHeight, "targetHeight");
  const sourceAspect = sw / sh;
  const targetAspect = tw / th;

  if (sourceAspect > targetAspect) {
    const width = sh * targetAspect;
    return { x: (sw - width) * 0.5, y: 0, width, height: sh };
  }

  const height = sw / targetAspect;
  return { x: 0, y: (sh - height) * 0.5, width: sw, height };
}

export function mapSourcePointToTexture(
  x,
  y,
  sourceWidth,
  sourceHeight,
  targetWidth = CAMERA_TEXTURE_WIDTH,
  targetHeight = CAMERA_TEXTURE_HEIGHT,
  mirrorX = true,
) {
  const crop = computeCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const sourceX = clamp01(x) * Number(sourceWidth);
  const sourceY = clamp01(y) * Number(sourceHeight);
  let u = (sourceX - crop.x) / crop.width;
  const v = (sourceY - crop.y) / crop.height;
  if (mirrorX) u = 1 - u;
  return {
    x: u,
    y: v,
    visible: u >= 0 && u <= 1 && v >= 0 && v <= 1,
  };
}

export function resampleCoverRgba(
  source,
  sourceWidth,
  sourceHeight,
  destination,
  targetWidth = CAMERA_TEXTURE_WIDTH,
  targetHeight = CAMERA_TEXTURE_HEIGHT,
  mirrorX = true,
) {
  const sw = positiveDimension(sourceWidth, "sourceWidth");
  const sh = positiveDimension(sourceHeight, "sourceHeight");
  const tw = positiveDimension(targetWidth, "targetWidth");
  const th = positiveDimension(targetHeight, "targetHeight");
  if (!ArrayBuffer.isView(source) || source.byteLength < sw * sh * 4) {
    throw new RangeError("source must contain a complete RGBA frame");
  }
  if (!ArrayBuffer.isView(destination) || destination.byteLength < tw * th * 4) {
    throw new RangeError("destination must contain a complete RGBA frame");
  }

  const crop = computeCoverCrop(sw, sh, tw, th);
  let cursor = 0;
  for (let y = 0; y < th; ++y) {
    const sourceY = Math.min(sh - 1, Math.max(0,
      Math.floor(crop.y + (y + 0.5) * crop.height / th),
    ));
    for (let x = 0; x < tw; ++x) {
      const normalizedX = (x + 0.5) / tw;
      const sampledX = mirrorX ? 1 - normalizedX : normalizedX;
      const sourceX = Math.min(sw - 1, Math.max(0,
        Math.floor(crop.x + sampledX * crop.width),
      ));
      const from = (sourceY * sw + sourceX) * 4;
      destination[cursor++] = source[from];
      destination[cursor++] = source[from + 1];
      destination[cursor++] = source[from + 2];
      destination[cursor++] = 255;
    }
  }
  return destination;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sampleMatteAlpha(alpha, width, height, sourceX, sourceY, sourceWidth, sourceHeight) {
  const mx = clamp01((sourceX + 0.5) / sourceWidth) * width - 0.5;
  const my = clamp01((sourceY + 0.5) / sourceHeight) * height - 0.5;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(mx)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(my)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clamp01(mx - x0);
  const ty = clamp01(my - y0);
  const top = Number(alpha[y0 * width + x0]) * (1 - tx) + Number(alpha[y0 * width + x1]) * tx;
  const bottom = Number(alpha[y1 * width + x0]) * (1 - tx) + Number(alpha[y1 * width + x1]) * tx;
  return clamp01(top * (1 - ty) + bottom * ty);
}

/**
 * Cover-crop and mirror a camera frame while revealing only the supplied
 * low-resolution person matte. RGB is converted to luminance/chroma before
 * being remapped into the sculpture's violet/cyan palette; the room remains a
 * nearly-black opaque backdrop and is never flashed while the matte calibrates.
 */
export function compositePersonMatteRgba(
  source,
  sourceWidth,
  sourceHeight,
  destination,
  matte,
  targetWidth = CAMERA_TEXTURE_WIDTH,
  targetHeight = CAMERA_TEXTURE_HEIGHT,
  mirrorX = true,
) {
  const sw = positiveDimension(sourceWidth, "sourceWidth");
  const sh = positiveDimension(sourceHeight, "sourceHeight");
  const tw = positiveDimension(targetWidth, "targetWidth");
  const th = positiveDimension(targetHeight, "targetHeight");
  if (!ArrayBuffer.isView(source) || source.byteLength < sw * sh * 4) {
    throw new RangeError("source must contain a complete RGBA frame");
  }
  if (!ArrayBuffer.isView(destination) || destination.byteLength < tw * th * 4) {
    throw new RangeError("destination must contain a complete RGBA frame");
  }
  const matteWidth = positiveDimension(matte?.width, "matte.width");
  const matteHeight = positiveDimension(matte?.height, "matte.height");
  const matteAlpha = matte?.alpha;
  if (!ArrayBuffer.isView(matteAlpha) || matteAlpha.length < matteWidth * matteHeight) {
    throw new RangeError("matte.alpha must cover matte.width * matte.height pixels");
  }

  const crop = computeCoverCrop(sw, sh, tw, th);
  let cursor = 0;
  for (let y = 0; y < th; ++y) {
    const sourceY = Math.min(sh - 1, Math.max(0,
      Math.floor(crop.y + (y + 0.5) * crop.height / th),
    ));
    for (let x = 0; x < tw; ++x) {
      const normalizedX = (x + 0.5) / tw;
      const sampledX = mirrorX ? 1 - normalizedX : normalizedX;
      const sourceX = Math.min(sw - 1, Math.max(0,
        Math.floor(crop.x + sampledX * crop.width),
      ));
      const from = (sourceY * sw + sourceX) * 4;
      const red = Number(source[from]);
      const green = Number(source[from + 1]);
      const blue = Number(source[from + 2]);

      // BT.601-style luminance/chroma conversion is deliberately performed
      // before styling so changing camera white balance does not simply tint
      // the entire frame into a false foreground.
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      const cb = 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue;
      const cr = 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue;
      const detail = clamp01((luminance - 6) / 235);
      const warmChroma = clamp01((cr - 116) / 58);
      const coolChroma = clamp01((cb - 92) / 72);
      const alpha = smoothstep(
        0.18,
        0.78,
        sampleMatteAlpha(matteAlpha, matteWidth, matteHeight, sourceX, sourceY, sw, sh),
      );

      const spectralRed = 14 + detail * (145 + warmChroma * 72);
      const spectralGreen = 7 + detail * (60 + (1 - warmChroma) * 24);
      const spectralBlue = 30 + detail * (176 + coolChroma * 36);
      destination[cursor++] = Math.round(2 + alpha * (spectralRed - 2));
      destination[cursor++] = Math.round(1 + alpha * (spectralGreen - 1));
      destination[cursor++] = Math.round(8 + alpha * (spectralBlue - 8));
      destination[cursor++] = 255;
    }
  }
  return destination;
}

export function coverPlaneSize(viewportAspect, textureAspect = CAMERA_TEXTURE_WIDTH / CAMERA_TEXTURE_HEIGHT) {
  const view = Math.max(0.01, Number(viewportAspect) || 1);
  const texture = Math.max(0.01, Number(textureAspect) || 1);
  if (view >= texture) {
    return { width: view * 2, height: view * 2 / texture };
  }
  return { width: texture * 2, height: 2 };
}

export function texturePointToWorld(point, planeSize) {
  return {
    x: (clamp01(point?.x) - 0.5) * Number(planeSize?.width || 2),
    y: (0.5 - clamp01(point?.y)) * Number(planeSize?.height || 2),
  };
}

function hashNoise(x, y, tick) {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 29, 668265263) ^ Math.imul(tick + 7, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function fillSyntheticCameraFrame(
  destination,
  width = CAMERA_TEXTURE_WIDTH,
  height = CAMERA_TEXTURE_HEIGHT,
  timeSeconds = 0,
) {
  const w = positiveDimension(width, "width");
  const h = positiveDimension(height, "height");
  if (!ArrayBuffer.isView(destination) || destination.byteLength < w * h * 4) {
    throw new RangeError("destination must contain a complete RGBA frame");
  }

  const tick = Math.floor(Math.max(0, Number(timeSeconds) || 0) * 12);
  let cursor = 0;
  for (let y = 0; y < h; ++y) {
    const v = (y + 0.5) / h;
    const ny = v * 2 - 1;
    for (let x = 0; x < w; ++x) {
      const u = (x + 0.5) / w;
      const nx = u * 2 - 1;
      const vignette = Math.max(0, 1 - (nx * nx * 0.52 + ny * ny * 0.82));
      const warmWall = Math.exp(-((u - 0.12) ** 2 * 12 + (v - 0.40) ** 2 * 4.2));
      const violetHaze = Math.exp(-((u - 0.76) ** 2 * 5.5 + (v - 0.48) ** 2 * 3.0));
      const curtain = u < 0.48
        ? 0.5 + 0.5 * Math.sin(u * 94 + Math.sin(v * 7) * 0.8)
        : 0;
      const grain = hashNoise(x, y, tick) - 0.5;
      const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 0.31 + u * 2.1);
      destination[cursor++] = Math.round(Math.max(0,
        3 + vignette * 5 + warmWall * 31 + curtain * 4 + grain * 3,
      ));
      destination[cursor++] = Math.round(Math.max(0,
        4 + vignette * 5 + warmWall * 12 + violetHaze * 4 + grain * 2,
      ));
      destination[cursor++] = Math.round(Math.max(0,
        9 + vignette * 8 + violetHaze * (12 + pulse * 8) + curtain * 5 + grain * 4,
      ));
      destination[cursor++] = 255;
    }
  }
  return destination;
}
