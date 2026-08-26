// A deliberately small, dependency-free camera interaction heuristic. It is
// not a hand-pose model: a diffused skin-colour layer is motion-seeded into
// connected hand proxies, and two temporal slots make those proxies useful for
// sculpting light without shipping frames off-device.
export const MOTION_TRACKER_LABEL = "LOCAL SKIN-DIFFUSION + MOTION HAND PROXIES / NON-NEURAL";
export const GESTURE_NONE = "none";
export const GESTURE_CLOSED = "closed";
export const GESTURE_OPEN = "open";
export const GESTURE_POINT = "point";
export const GESTURE_SWIPE = "swipe";

export const DEFAULT_MOTION_TRACKER_OPTIONS = Object.freeze({
  sampleWidth: 96,
  sampleHeight: 72,
  motionThreshold: 0.08,
  skinThreshold: 0.24,
  skinDiffusionFloor: 0.10,
  skinDiffusionAmount: 0.62,
  skinDiffusionIterations: 2,
  skinGrowthThreshold: 0.15,
  skinGrowthMotionRatio: 0.34,
  skinGrowthBackgroundRatio: 0.24,
  skinGrowthSteps: 1,
  skinSeedRawRatio: 0.72,
  minComponentPixels: 4,
  minComponentFraction: 0.0008,
  maxComponentFraction: 0.30,
  backgroundLearningRate: 0.075,
  foregroundLearningRate: 0.0025,
  positionSharpness: 24,
  velocityBlend: 0.42,
  opennessBlend: 0.46,
  pointingBlend: 0.52,
  tipPositionSharpness: 28,
  tipVelocityBlend: 0.48,
  confidenceBlend: 0.55,
  confidenceDecay: 0.72,
  velocityDecay: 0.78,
  associationDistance: 0.34,
  maxMissingFrames: 6,
  gestureConfidenceEnter: 0.42,
  gestureConfidenceExit: 0.24,
  closedEnterOpenness: 0.24,
  closedExitOpenness: 0.40,
  openEnterOpenness: 0.58,
  openExitOpenness: 0.42,
  pointEnterEvidence: 0.62,
  pointExitEvidence: 0.44,
  swipeEnterSpeed: 0.72,
  swipeExitSpeed: 0.34,
  gestureConfirmFrames: 2,
  swipeConfirmFrames: 2,
  swipeReleaseFrames: 2,
  mirrorX: true,
  targetAspect: null,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
  return number;
}

function dimension(value, label) {
  const number = Math.floor(finitePositive(value, label));
  if (number < 1) throw new RangeError(`${label} must be at least one.`);
  return number;
}

function rgbaData(value) {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return value;
  throw new TypeError("RGBA data must be a typed array.");
}

/**
 * Returns a broad, deliberately non-semantic skin-colour likelihood in [0, 1].
 * Motion is always required as a separate gate, which limits false positives
 * from warm walls, timber, clothing, and highlights.
 */
export function skinLikelihood(red, green, blue) {
  const r = clamp(red, 0, 255);
  const g = clamp(green, 0, 255);
  const b = clamp(blue, 0, 255);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const chroma = maximum - minimum;
  const brightness = (r + g + b) / 3;

  // A broad YCbCr ellipse includes a useful range of illuminated skin tones.
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const ellipseDistance = Math.hypot((cb - 109) / 37, (cr - 152) / 43);
  const chromaLikelihood = clamp01(1.18 - ellipseDistance * 0.62);
  const warmth = clamp01((r - b + 8) / 62);
  const colourfulness = clamp01((chroma - 4) / 42);
  const brightnessGate = clamp01((brightness - 16) / 42) * clamp01((282 - brightness) / 36);
  const channelOrderGate = r >= g * 0.76 && r >= b * 0.92 && g >= b * 0.52 ? 1 : 0.14;

  return clamp01(
    brightnessGate * channelOrderGate *
    (chromaLikelihood * 0.62 + warmth * 0.25 + colourfulness * 0.13),
  );
}

/** Compute the centered raw-frame crop used by an object-fit: cover surface. */
export function computeCoverCrop(frameWidth, frameHeight, targetAspect) {
  const width = finitePositive(frameWidth, "frameWidth");
  const height = finitePositive(frameHeight, "frameHeight");
  const aspect = finitePositive(targetAspect, "targetAspect");
  const sourceAspect = width / height;

  if (Math.abs(sourceAspect - aspect) < 1e-12) {
    return { x: 0, y: 0, width, height };
  }
  if (sourceAspect > aspect) {
    const cropWidth = height * aspect;
    return { x: (width - cropWidth) * 0.5, y: 0, width: cropWidth, height };
  }
  const cropHeight = width / aspect;
  return { x: 0, y: (height - cropHeight) * 0.5, width, height: cropHeight };
}

export const getCoverCrop = computeCoverCrop;

/** Mirror a normalized point without mutating the caller's object. */
export function mirrorNormalizedPoint(point, mirrorX = true) {
  const x = Number(point?.x ?? point?.[0]);
  const y = Number(point?.y ?? point?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("point must contain finite x and y coordinates.");
  }
  return { x: mirrorX ? 1 - x : x, y };
}

/**
 * Map a raw camera-frame point through the same centered cover crop used by a
 * mirrored display.
 *
 * Signature:
 *   mapFramePointToDisplay({ x, y }, { width, height }, {
 *     mirrorX = true,
 *     targetAspect,              // e.g. 16 / 9; enables centered cover crop
 *     crop: { x, y, width, height }, // optional explicit raw-frame crop
 *     displayWidth, displayHeight,   // optional pixel output; otherwise x/y=u/v
 *     clamp: false,
 *   })
 *
 * The returned u/v are normalized display coordinates. `visible` remains
 * false for points removed by the cover crop even when clamp is requested.
 */
export function mapFramePointToDisplay(point, frameSize, options = {}) {
  const frameWidth = finitePositive(frameSize?.width, "frameSize.width");
  const frameHeight = finitePositive(frameSize?.height, "frameSize.height");
  const pointX = Number(point?.x ?? point?.[0]);
  const pointY = Number(point?.y ?? point?.[1]);
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
    throw new TypeError("point must contain finite x and y coordinates.");
  }

  const displayWidth = options.displayWidth == null
    ? null
    : finitePositive(options.displayWidth, "displayWidth");
  const displayHeight = options.displayHeight == null
    ? null
    : finitePositive(options.displayHeight, "displayHeight");
  if ((displayWidth == null) !== (displayHeight == null)) {
    throw new TypeError("displayWidth and displayHeight must be supplied together.");
  }

  const inferredAspect = displayWidth == null ? null : displayWidth / displayHeight;
  const targetAspect = options.targetAspect == null
    ? inferredAspect
    : finitePositive(options.targetAspect, "targetAspect");
  const suppliedCrop = options.crop;
  let crop;
  if (suppliedCrop != null) {
    crop = {
      x: Number(suppliedCrop.x),
      y: Number(suppliedCrop.y),
      width: finitePositive(suppliedCrop.width, "crop.width"),
      height: finitePositive(suppliedCrop.height, "crop.height"),
    };
    if (!Number.isFinite(crop.x) || !Number.isFinite(crop.y)) {
      throw new TypeError("crop.x and crop.y must be finite numbers.");
    }
  } else {
    crop = targetAspect == null
      ? { x: 0, y: 0, width: frameWidth, height: frameHeight }
      : computeCoverCrop(frameWidth, frameHeight, targetAspect);
  }

  let u = (pointX - crop.x) / crop.width;
  let v = (pointY - crop.y) / crop.height;
  const visible = u >= 0 && u <= 1 && v >= 0 && v <= 1;
  if (options.mirrorX !== false) u = 1 - u;
  if (options.clamp === true) {
    u = clamp01(u);
    v = clamp01(v);
  }

  return {
    x: displayWidth == null ? u : u * displayWidth,
    y: displayHeight == null ? v : v * displayHeight,
    u,
    v,
    visible,
    crop: { ...crop },
  };
}

export const mapRawPointToMirroredDisplay = mapFramePointToDisplay;

/** Preserve aspect ratio while fitting a raw frame inside a sample budget. */
export function computeDownsampleSize(frameWidth, frameHeight, maxWidth = 96, maxHeight = 72) {
  const width = dimension(frameWidth, "frameWidth");
  const height = dimension(frameHeight, "frameHeight");
  const limitWidth = dimension(maxWidth, "maxWidth");
  const limitHeight = dimension(maxHeight, "maxHeight");
  const scale = Math.min(1, limitWidth / width, limitHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Deterministic box-filter RGBA downsampling. Options may specify exact
 * targetWidth/targetHeight, or maxWidth/maxHeight for an aspect-preserving fit.
 */
export function downsampleRgba(data, frameWidth, frameHeight, options = {}) {
  const source = rgbaData(data);
  const width = dimension(frameWidth, "frameWidth");
  const height = dimension(frameHeight, "frameHeight");
  if (source.length < width * height * 4) {
    throw new RangeError(`RGBA data has ${source.length} values; ${width * height * 4} are required.`);
  }

  let targetWidth;
  let targetHeight;
  if (options.targetWidth != null || options.targetHeight != null) {
    targetWidth = dimension(options.targetWidth ?? width, "targetWidth");
    targetHeight = dimension(options.targetHeight ?? height, "targetHeight");
  } else {
    const size = computeDownsampleSize(
      width,
      height,
      options.maxWidth ?? DEFAULT_MOTION_TRACKER_OPTIONS.sampleWidth,
      options.maxHeight ?? DEFAULT_MOTION_TRACKER_OPTIONS.sampleHeight,
    );
    targetWidth = size.width;
    targetHeight = size.height;
  }
  targetWidth = Math.min(width, targetWidth);
  targetHeight = Math.min(height, targetHeight);

  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; ++targetY) {
    const sourceY0 = Math.floor(targetY * height / targetHeight);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor((targetY + 1) * height / targetHeight));
    for (let targetX = 0; targetX < targetWidth; ++targetX) {
      const sourceX0 = Math.floor(targetX * width / targetWidth);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor((targetX + 1) * width / targetWidth));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sourceY = sourceY0; sourceY < sourceY1; ++sourceY) {
        for (let sourceX = sourceX0; sourceX < sourceX1; ++sourceX) {
          const sourceOffset = (sourceY * width + sourceX) * 4;
          red += source[sourceOffset];
          green += source[sourceOffset + 1];
          blue += source[sourceOffset + 2];
          alpha += source[sourceOffset + 3];
          count += 1;
        }
      }
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      output[targetOffset] = Math.round(red / count);
      output[targetOffset + 1] = Math.round(green / count);
      output[targetOffset + 2] = Math.round(blue / count);
      output[targetOffset + 3] = Math.round(alpha / count);
    }
  }

  return {
    data: output,
    width: targetWidth,
    height: targetHeight,
    scaleX: width / targetWidth,
    scaleY: height / targetHeight,
    sourceWidth: width,
    sourceHeight: height,
  };
}

export const downsampleRGBA = downsampleRgba;

function scoreField(values, pixels, label) {
  if (!ArrayBuffer.isView(values) || values.length < pixels) {
    throw new RangeError(`${label} must be a typed array covering width * height entries.`);
  }
  return values;
}

/**
 * Edge-aware skin-colour diffusion. A pixel whose original likelihood is below
 * `skinDiffusionFloor` is always written as zero and never contributes to a
 * neighbour, so smoothing cannot leak across a non-skin background barrier.
 */
export function diffuseSkinLikelihood(skinScores, width, height, options = {}) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  const raw = scoreField(skinScores, pixels, "skinScores");
  const floor = clamp01(options.skinDiffusionFloor ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinDiffusionFloor);
  const amount = clamp01(options.skinDiffusionAmount ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinDiffusionAmount);
  const iterations = Math.max(
    1,
    Math.floor(Number(options.skinDiffusionIterations ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinDiffusionIterations)),
  );
  let current = new Float32Array(pixels);
  for (let index = 0; index < pixels; ++index) current[index] = clamp01(raw[index]);
  let next = new Float32Array(pixels);

  for (let iteration = 0; iteration < iterations; ++iteration) {
    for (let y = 0; y < rows; ++y) {
      for (let x = 0; x < columns; ++x) {
        const index = y * columns + x;
        const rawCenter = clamp01(raw[index]);
        if (rawCenter < floor) {
          next[index] = 0;
          continue;
        }
        let sum = current[index] * 2;
        let totalWeight = 2;
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(rows - 1, y + 1);
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(columns - 1, x + 1);
        for (let neighbourY = y0; neighbourY <= y1; ++neighbourY) {
          for (let neighbourX = x0; neighbourX <= x1; ++neighbourX) {
            if (neighbourX === x && neighbourY === y) continue;
            const neighbour = neighbourY * columns + neighbourX;
            if (raw[neighbour] < floor) continue;
            const spatialWeight = neighbourX === x || neighbourY === y ? 1 : Math.SQRT1_2;
            sum += current[neighbour] * spatialWeight;
            totalWeight += spatialWeight;
          }
        }
        const localAverage = sum / totalWeight;
        next[index] = clamp01(rawCenter + (localAverage - rawCenter) * amount);
      }
    }
    const swap = current;
    current = next;
    next = swap;
  }
  return current;
}

/**
 * Flood strong skin+motion seeds through 8-connected pixels that remain
 * plausible skin and have weaker, but non-zero, motion or background-change
 * evidence. No eligible path can cross a raw non-skin pixel.
 */
export function growSkinMotionSeeds(layer, options = {}) {
  const columns = dimension(layer?.width, "layer.width");
  const rows = dimension(layer?.height, "layer.height");
  const pixels = columns * rows;
  const rawSkinScores = scoreField(layer?.skinScores, pixels, "layer.skinScores");
  const diffusedSkinScores = scoreField(
    layer?.diffusedSkinScores,
    pixels,
    "layer.diffusedSkinScores",
  );
  const motionScores = scoreField(layer?.motionScores, pixels, "layer.motionScores");
  const backgroundScores = layer?.backgroundScores == null
    ? null
    : scoreField(layer.backgroundScores, pixels, "layer.backgroundScores");
  const diffusionFloor = clamp01(
    options.skinDiffusionFloor ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinDiffusionFloor,
  );
  const seedThreshold = clamp01(options.skinThreshold ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinThreshold);
  const motionThreshold = clamp01(options.motionThreshold ?? DEFAULT_MOTION_TRACKER_OPTIONS.motionThreshold);
  const growthSkinThreshold = clamp01(
    options.skinGrowthThreshold ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinGrowthThreshold,
  );
  const seedRawThreshold = seedThreshold * clamp01(
    options.skinSeedRawRatio ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinSeedRawRatio,
  );
  const growthMotionThreshold = motionThreshold * clamp01(
    options.skinGrowthMotionRatio ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinGrowthMotionRatio,
  );
  const growthBackgroundThreshold = motionThreshold * clamp01(
    options.skinGrowthBackgroundRatio ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinGrowthBackgroundRatio,
  );
  const requestedGrowthSteps = Number(
    options.skinGrowthSteps ?? DEFAULT_MOTION_TRACKER_OPTIONS.skinGrowthSteps,
  );
  const growthSteps = Number.isFinite(requestedGrowthSteps)
    ? Math.max(0, Math.min(2, Math.floor(requestedGrowthSteps)))
    : DEFAULT_MOTION_TRACKER_OPTIONS.skinGrowthSteps;

  const plausibleMask = new Uint8Array(pixels);
  const seedMask = new Uint8Array(pixels);
  const grownMask = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const queueDepth = new Uint8Array(pixels);
  let queueRead = 0;
  let queueWrite = 0;
  let rawSkinPixels = 0;
  let skinPixels = 0;
  let seedPixels = 0;
  for (let index = 0; index < pixels; ++index) {
    const rawSkin = rawSkinScores[index];
    if (rawSkin >= diffusionFloor) rawSkinPixels += 1;
    const plausible = rawSkin >= diffusionFloor && diffusedSkinScores[index] >= growthSkinThreshold;
    if (plausible) {
      plausibleMask[index] = 1;
      skinPixels += 1;
    }
    const seed = plausible &&
      rawSkin >= seedRawThreshold &&
      diffusedSkinScores[index] >= seedThreshold &&
      motionScores[index] >= motionThreshold;
    if (seed) {
      seedMask[index] = 1;
      grownMask[index] = 1;
      queue[queueWrite++] = index;
      seedPixels += 1;
    }
  }

  while (queueRead < queueWrite) {
    const index = queue[queueRead++];
    const depth = queueDepth[index];
    if (depth >= growthSteps) continue;
    const x = index % columns;
    const y = Math.floor(index / columns);
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(rows - 1, y + 1);
    const x0 = Math.max(0, x - 1);
    const x1 = Math.min(columns - 1, x + 1);
    for (let neighbourY = y0; neighbourY <= y1; ++neighbourY) {
      for (let neighbourX = x0; neighbourX <= x1; ++neighbourX) {
        if (neighbourX === x && neighbourY === y) continue;
        const neighbour = neighbourY * columns + neighbourX;
        if (grownMask[neighbour] || !plausibleMask[neighbour]) continue;
        const lowerEvidence = motionScores[neighbour] >= growthMotionThreshold ||
          (backgroundScores != null && backgroundScores[neighbour] >= growthBackgroundThreshold);
        if (!lowerEvidence) continue;
        grownMask[neighbour] = 1;
        queueDepth[neighbour] = depth + 1;
        queue[queueWrite++] = neighbour;
      }
    }
  }

  return {
    width: columns,
    height: rows,
    plausibleMask,
    skinMask: plausibleMask,
    seedMask,
    grownMask,
    mask: grownMask,
    rawSkinPixels,
    skinPixels,
    seedPixels,
    grownPixels: queueWrite,
    rawSkinCoverage: rawSkinPixels / pixels,
    skinCoverage: skinPixels / pixels,
    seedCoverage: seedPixels / pixels,
    grownCoverage: queueWrite / pixels,
  };
}

/** Build the complete pure skin-diffusion and seeded-growth first layer. */
export function buildSkinMotionLayer(skinScores, motionScores, width, height, options = {}) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  scoreField(skinScores, pixels, "skinScores");
  scoreField(motionScores, pixels, "motionScores");
  const diffusedSkinScores = diffuseSkinLikelihood(skinScores, columns, rows, options);
  const grown = growSkinMotionSeeds({
    width: columns,
    height: rows,
    skinScores,
    diffusedSkinScores,
    motionScores,
    backgroundScores: options.backgroundScores,
  }, options);
  return {
    ...grown,
    skinScores,
    diffusedSkinScores,
    motionScores,
  };
}

export const computeSkinDiffusionLayer = buildSkinMotionLayer;

/**
 * Adapt the RGB background model while protecting only strong skin+motion
 * seeds. Diffusion-grown support is intentionally learned at the normal rate
 * so a completed silhouette cannot linger as a long-lived background ghost.
 */
export function adaptBackgroundModel(
  backgroundRgb,
  sampledRgba,
  seedMask,
  normalLearningRate,
  foregroundLearningRate,
) {
  if (!ArrayBuffer.isView(seedMask) || seedMask instanceof DataView) {
    throw new TypeError("seedMask must be a typed array.");
  }
  const pixels = seedMask.length;
  const background = scoreField(backgroundRgb, pixels * 3, "backgroundRgb");
  const sampled = rgbaData(sampledRgba);
  if (sampled.length < pixels * 4) {
    throw new RangeError("sampledRgba must cover seedMask.length RGBA pixels.");
  }
  const normalRate = clamp01(normalLearningRate);
  const foregroundRate = clamp01(foregroundLearningRate);
  for (let index = 0; index < pixels; ++index) {
    const rate = seedMask[index] ? foregroundRate : normalRate;
    const rgbaOffset = index * 4;
    const backgroundOffset = index * 3;
    background[backgroundOffset] += (sampled[rgbaOffset] - background[backgroundOffset]) * rate;
    background[backgroundOffset + 1] +=
      (sampled[rgbaOffset + 1] - background[backgroundOffset + 1]) * rate;
    background[backgroundOffset + 2] +=
      (sampled[rgbaOffset + 2] - background[backgroundOffset + 2]) * rate;
  }
  return backgroundRgb;
}

function opennessFromShape(area, boundsWidth, boundsHeight, perimeter, sumX, sumY, sumX2, sumY2) {
  if (area <= 1) return 0;
  const fill = area / Math.max(1, boundsWidth * boundsHeight);
  const compactness = perimeter * perimeter / Math.max(1, 4 * Math.PI * area);
  const centerX = sumX / area;
  const centerY = sumY / area;
  const variance = Math.max(0, sumX2 / area - centerX * centerX) +
    Math.max(0, sumY2 / area - centerY * centerY);
  const equivalentRadius = Math.sqrt(area / Math.PI);
  const spread = Math.sqrt(variance) / Math.max(0.5, equivalentRadius);

  const sparseShape = clamp01((0.88 - fill) / 0.55);
  const articulatedEdge = clamp01((compactness - 1.15) / 1.8);
  const radialSpread = clamp01((spread - 0.70) / 0.60);
  return clamp01(sparseShape * 0.55 + articulatedEdge * 0.30 + radialSpread * 0.15);
}

function silhouetteExtremities(
  componentPixels,
  boundaryPixels,
  width,
  height,
  centerX,
  centerY,
  varianceX,
  varianceY,
  covarianceXY,
  area,
) {
  const nearlyRound = Math.abs(varianceX - varianceY) < 1e-9 && Math.abs(covarianceXY) < 1e-9;
  const angle = nearlyRound ? 0 : 0.5 * Math.atan2(2 * covarianceXY, varianceX - varianceY);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const trace = varianceX + varianceY;
  const discriminant = Math.hypot(varianceX - varianceY, 2 * covarianceXY);
  const majorVariance = Math.max(0, (trace + discriminant) * 0.5);
  const minorVariance = Math.max(0, (trace - discriminant) * 0.5);
  const elongation = Math.sqrt((majorVariance + 0.18) / (minorVariance + 0.18));

  let minimumProjection = Infinity;
  let maximumProjection = -Infinity;
  for (const index of boundaryPixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    const projection = (x - centerX) * axisX + (y - centerY) * axisY;
    minimumProjection = Math.min(minimumProjection, projection);
    maximumProjection = Math.max(maximumProjection, projection);
  }
  if (!Number.isFinite(minimumProjection) || !Number.isFinite(maximumProjection)) {
    minimumProjection = -0.5;
    maximumProjection = 0.5;
  }
  const projectionRange = Math.max(1, maximumProjection - minimumProjection);

  function summarizeEnd(sign) {
    const extreme = sign > 0 ? maximumProjection : minimumProjection;
    const capDistance = Math.max(0.75, projectionRange * 0.075);
    const widthDistance = Math.max(1, projectionRange * 0.24);
    let capX = 0;
    let capY = 0;
    let capWeight = 0;
    for (const index of boundaryPixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      const projection = (x - centerX) * axisX + (y - centerY) * axisY;
      const inwardDistance = sign > 0 ? extreme - projection : projection - extreme;
      if (inwardDistance <= capDistance) {
        const weight = 1 + (capDistance - inwardDistance) / capDistance;
        capX += x * weight;
        capY += y * weight;
        capWeight += weight;
      }
    }
    if (capWeight <= 0) {
      capX = centerX + axisX * extreme;
      capY = centerY + axisY * extreme;
      capWeight = 1;
    }

    let minimumPerpendicular = Infinity;
    let maximumPerpendicular = -Infinity;
    for (const index of componentPixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      const offsetX = x - centerX;
      const offsetY = y - centerY;
      const projection = offsetX * axisX + offsetY * axisY;
      const inwardDistance = sign > 0 ? extreme - projection : projection - extreme;
      if (inwardDistance <= widthDistance) {
        const perpendicular = -offsetX * axisY + offsetY * axisX;
        minimumPerpendicular = Math.min(minimumPerpendicular, perpendicular);
        maximumPerpendicular = Math.max(maximumPerpendicular, perpendicular);
      }
    }
    const tipX = capX / capWeight;
    const tipY = capY / capWeight;
    const endWidth = Number.isFinite(minimumPerpendicular)
      ? maximumPerpendicular - minimumPerpendicular + 1
      : 1;
    const edgeDistance = Math.min(tipX, width - 1 - tipX, tipY, height - 1 - tipY);
    return {
      x: tipX,
      y: tipY,
      width: Math.max(1, endWidth),
      length: Math.abs(extreme),
      edgeDistance: Math.max(0, edgeDistance),
    };
  }

  const ends = [summarizeEnd(-1), summarizeEnd(1)];
  const equivalentRadius = Math.max(0.5, Math.sqrt(area / Math.PI));
  const frameScale = Math.max(1, Math.min(width, height));
  for (let index = 0; index < ends.length; ++index) {
    const end = ends[index];
    const other = ends[1 - index];
    const taper = clamp01((other.width - end.width) / Math.max(1, other.width));
    const prominence = end.length / equivalentRadius;
    end.taper = taper;
    end.prominence = prominence;
    // A fingertip is usually the prominent, narrow end away from the frame
    // edge where a wrist entered. This is only a silhouette proxy, so both
    // endpoints remain available to temporal association below.
    end.tipScore = prominence * 0.52 + taper * 0.62 + end.edgeDistance / frameScale * 0.34;
  }
  let tipIndex = 0;
  if (ends[1].tipScore > ends[0].tipScore + 1e-9) tipIndex = 1;
  else if (Math.abs(ends[1].tipScore - ends[0].tipScore) <= 1e-9) {
    if (ends[1].y < ends[0].y || (ends[1].y === ends[0].y && ends[1].x < ends[0].x)) tipIndex = 1;
  }
  const tip = ends[tipIndex];
  const elongationEvidence = clamp01((elongation - 1.45) / 1.8);
  const prominenceEvidence = clamp01((tip.prominence - 1.20) / 1.10);
  const pointing = clamp01(
    elongationEvidence * 0.58 + prominenceEvidence * 0.23 + tip.taper * 0.19,
  );
  return {
    axis: { x: axisX, y: axisY },
    elongation,
    pointing,
    tipIndex,
    tip: { x: tip.x, y: tip.y },
    extremities: ends,
  };
}

/** Extract 8-connected components and deterministic shape metrics from a mask. */
export function extractConnectedComponents(mask, width, height, options = {}) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  if (!ArrayBuffer.isView(mask) || mask.length < columns * rows) {
    throw new RangeError("mask must be a typed array covering width * height entries.");
  }
  const weights = options.weights;
  const skinScores = options.skinScores;
  const motionScores = options.motionScores;
  const pixelCount = columns * rows;
  for (const [name, values] of [["weights", weights], ["skinScores", skinScores], ["motionScores", motionScores]]) {
    if (values != null && (!ArrayBuffer.isView(values) || values.length < pixelCount)) {
      throw new RangeError(`${name} must cover width * height entries.`);
    }
  }

  const minimumPixels = Math.max(
    1,
    Math.floor(options.minComponentPixels ?? DEFAULT_MOTION_TRACKER_OPTIONS.minComponentPixels),
    Math.ceil(pixelCount * Number(options.minComponentFraction ?? DEFAULT_MOTION_TRACKER_OPTIONS.minComponentFraction)),
  );
  const maximumPixels = Math.max(
    minimumPixels,
    Math.floor(pixelCount * Number(options.maxComponentFraction ?? DEFAULT_MOTION_TRACKER_OPTIONS.maxComponentFraction)),
  );
  const visited = new Uint8Array(pixelCount);
  const stack = new Int32Array(pixelCount);
  const components = [];

  for (let seed = 0; seed < pixelCount; ++seed) {
    if (!mask[seed] || visited[seed]) continue;
    let stackLength = 1;
    stack[0] = seed;
    visited[seed] = 1;
    let area = 0;
    let weightedArea = 0;
    let weightedX = 0;
    let weightedY = 0;
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;
    let skinSum = 0;
    let motionSum = 0;
    let weightSum = 0;
    let perimeter = 0;
    let minimumX = columns;
    let minimumY = rows;
    let maximumX = -1;
    let maximumY = -1;
    const componentPixels = [];
    const boundaryPixels = [];

    while (stackLength > 0) {
      const index = stack[--stackLength];
      const x = index % columns;
      const y = Math.floor(index / columns);
      const weight = Math.max(0.01, Number(weights?.[index] ?? 1));
      area += 1;
      weightedArea += weight;
      weightedX += x * weight;
      weightedY += y * weight;
      sumX += x;
      sumY += y;
      sumX2 += x * x;
      sumY2 += y * y;
      sumXY += x * y;
      componentPixels.push(index);
      skinSum += Number(skinScores?.[index] ?? 0);
      motionSum += Number(motionScores?.[index] ?? 0);
      weightSum += Number(weights?.[index] ?? 0);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);

      let boundary = false;
      if (x === 0 || !mask[index - 1]) { perimeter += 1; boundary = true; }
      if (x === columns - 1 || !mask[index + 1]) { perimeter += 1; boundary = true; }
      if (y === 0 || !mask[index - columns]) { perimeter += 1; boundary = true; }
      if (y === rows - 1 || !mask[index + columns]) { perimeter += 1; boundary = true; }
      if (boundary) boundaryPixels.push(index);

      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(rows - 1, y + 1);
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(columns - 1, x + 1);
      for (let neighbourY = y0; neighbourY <= y1; ++neighbourY) {
        for (let neighbourX = x0; neighbourX <= x1; ++neighbourX) {
          if (neighbourX === x && neighbourY === y) continue;
          const neighbour = neighbourY * columns + neighbourX;
          if (!visited[neighbour] && mask[neighbour]) {
            visited[neighbour] = 1;
            stack[stackLength++] = neighbour;
          }
        }
      }
    }

    if (area < minimumPixels || area > maximumPixels) continue;
    const boundsWidth = maximumX - minimumX + 1;
    const boundsHeight = maximumY - minimumY + 1;
    const skin = skinScores == null ? 1 : skinSum / area;
    const motion = motionScores == null ? 1 : motionSum / area;
    const areaEvidence = clamp01((area - minimumPixels + 1) / Math.max(1, minimumPixels * 5));
    const confidence = clamp01(skin * 0.36 + motion * 0.38 + areaEvidence * 0.26);
    const shapeCenterX = sumX / area;
    const shapeCenterY = sumY / area;
    const varianceX = Math.max(0, sumX2 / area - shapeCenterX * shapeCenterX);
    const varianceY = Math.max(0, sumY2 / area - shapeCenterY * shapeCenterY);
    const covarianceXY = sumXY / area - shapeCenterX * shapeCenterY;
    const silhouette = silhouetteExtremities(
      componentPixels,
      boundaryPixels,
      columns,
      rows,
      shapeCenterX,
      shapeCenterY,
      varianceX,
      varianceY,
      covarianceXY,
      area,
    );
    components.push({
      area,
      areaFraction: area / pixelCount,
      x: weightedX / weightedArea,
      y: weightedY / weightedArea,
      bounds: { x: minimumX, y: minimumY, width: boundsWidth, height: boundsHeight },
      perimeter,
      skin,
      motion,
      confidence,
      elongation: silhouette.elongation,
      pointing: silhouette.pointing,
      axis: silhouette.axis,
      tip: silhouette.tip,
      tipIndex: silhouette.tipIndex,
      tipConfidence: confidence * (0.32 + silhouette.pointing * 0.68),
      extremities: silhouette.extremities,
      openness: opennessFromShape(
        area,
        boundsWidth,
        boundsHeight,
        perimeter,
        sumX,
        sumY,
        sumX2,
        sumY2,
      ),
      quality: area * (0.45 + skin) * (0.4 + motion) + weightSum * 0.2,
    });
  }

  components.sort((left, right) =>
    right.quality - left.quality ||
    right.area - left.area ||
    left.x - right.x ||
    left.y - right.y,
  );
  return components;
}

function rgbContainer(value, expectedPixels, label) {
  if (value == null) return null;
  const data = ArrayBuffer.isView(value) ? value : value.data;
  if (!ArrayBuffer.isView(data)) throw new TypeError(`${label} must contain typed-array data.`);
  const channels = Number(value?.channels) || (data.length >= expectedPixels * 4 ? 4 : 3);
  if (channels !== 3 && channels !== 4) throw new RangeError(`${label}.channels must be 3 or 4.`);
  if (data.length < expectedPixels * channels) throw new RangeError(`${label} is smaller than the current sample.`);
  return { data, channels };
}

/**
 * Create a skin-biased motion mask and connected components from downsampled
 * RGBA frames. The optional background may be RGB or RGBA typed-array data.
 */
export function detectMotionComponents(current, previous = null, background = null, options = {}) {
  const width = dimension(current?.width, "current.width");
  const height = dimension(current?.height, "current.height");
  const pixels = width * height;
  const currentData = rgbaData(current?.data);
  if (currentData.length < pixels * 4) throw new RangeError("current.data is smaller than width * height * 4.");
  const previousPixels = rgbContainer(previous, pixels, "previous");
  const backgroundPixels = rgbContainer(background, pixels, "background");

  let globalRedDelta = 0;
  let globalGreenDelta = 0;
  let globalBlueDelta = 0;
  if (previousPixels) {
    for (let index = 0; index < pixels; ++index) {
      const currentOffset = index * 4;
      const previousOffset = index * previousPixels.channels;
      globalRedDelta += currentData[currentOffset] - previousPixels.data[previousOffset];
      globalGreenDelta += currentData[currentOffset + 1] - previousPixels.data[previousOffset + 1];
      globalBlueDelta += currentData[currentOffset + 2] - previousPixels.data[previousOffset + 2];
    }
    globalRedDelta /= pixels;
    globalGreenDelta /= pixels;
    globalBlueDelta /= pixels;
  }

  const skinScores = new Float32Array(pixels);
  const motionScores = new Float32Array(pixels);
  const frameDifferenceScores = new Float32Array(pixels);
  const backgroundScores = new Float32Array(pixels);
  const weights = new Float32Array(pixels);
  for (let index = 0; index < pixels; ++index) {
    const currentOffset = index * 4;
    const red = currentData[currentOffset];
    const green = currentData[currentOffset + 1];
    const blue = currentData[currentOffset + 2];
    const skin = skinLikelihood(red, green, blue);
    let frameDifference = 0;
    if (previousPixels) {
      const offset = index * previousPixels.channels;
      frameDifference = (
        Math.abs(red - previousPixels.data[offset] - globalRedDelta) +
        Math.abs(green - previousPixels.data[offset + 1] - globalGreenDelta) +
        Math.abs(blue - previousPixels.data[offset + 2] - globalBlueDelta)
      ) / 765;
    }
    let backgroundDifference = 0;
    if (backgroundPixels) {
      const offset = index * backgroundPixels.channels;
      backgroundDifference = (
        Math.abs(red - backgroundPixels.data[offset]) +
        Math.abs(green - backgroundPixels.data[offset + 1]) +
        Math.abs(blue - backgroundPixels.data[offset + 2])
      ) / 765;
    }
    const motion = clamp01(Math.max(frameDifference * 1.65, backgroundDifference * 1.15));
    skinScores[index] = skin;
    motionScores[index] = motion;
    frameDifferenceScores[index] = frameDifference;
    backgroundScores[index] = backgroundDifference;
  }

  const skinLayer = buildSkinMotionLayer(skinScores, motionScores, width, height, {
    ...options,
    backgroundScores,
  });
  for (let index = 0; index < pixels; ++index) {
    weights[index] = motionScores[index] * (0.42 + skinLayer.diffusedSkinScores[index] * 0.58);
  }

  const components = extractConnectedComponents(skinLayer.grownMask, width, height, {
    ...options,
    weights,
    skinScores: skinLayer.diffusedSkinScores,
    motionScores,
  });
  return {
    width,
    height,
    mask: skinLayer.grownMask,
    grownMask: skinLayer.grownMask,
    seedMask: skinLayer.seedMask,
    skinMask: skinLayer.skinMask,
    skinScores,
    diffusedSkinScores: skinLayer.diffusedSkinScores,
    motionScores,
    frameDifferenceScores,
    backgroundScores,
    weights,
    components,
    activePixels: skinLayer.grownPixels,
    seedPixels: skinLayer.seedPixels,
    skinPixels: skinLayer.skinPixels,
    coverage: skinLayer.grownCoverage,
    seedCoverage: skinLayer.seedCoverage,
    skinCoverage: skinLayer.skinCoverage,
    rawSkinCoverage: skinLayer.rawSkinCoverage,
    skinLayer,
    globalDelta: { r: globalRedDelta, g: globalGreenDelta, b: globalBlueDelta },
  };
}

function freshSlot(id) {
  return {
    id,
    active: false,
    visible: false,
    confidence: 0,
    openness: 0,
    pointing: 0,
    u: 0.5,
    v: 0.5,
    measuredU: 0.5,
    measuredV: 0.5,
    velocityU: 0,
    velocityV: 0,
    associationVelocityU: 0,
    associationVelocityV: 0,
    motionReliable: false,
    tipInitialized: false,
    tipVisible: false,
    tipConfidence: 0,
    tipU: 0.5,
    tipV: 0.5,
    measuredTipU: 0.5,
    measuredTipV: 0.5,
    tipVelocityU: 0,
    tipVelocityV: 0,
    tipAge: 0,
    area: 0,
    bounds: null,
    missingFrames: 0,
    age: 0,
    poseGesture: GESTURE_NONE,
    poseCandidate: GESTURE_NONE,
    poseCandidateFrames: 0,
    gesture: GESTURE_NONE,
    gestureStrength: 0,
    gestureAge: 0,
    gestureAgeMs: 0,
    gestureChanged: false,
    swipeCandidateFrames: 0,
    swipeReleaseCount: 0,
    swipeDirectionU: 0,
    swipeDirectionV: 0,
  };
}

function nextPoseEvidence(slot, options) {
  const confidence = slot.confidence;
  const openness = slot.openness;
  const enterConfidence = options.gestureConfidenceEnter;
  const exitConfidence = options.gestureConfidenceExit;

  if (slot.poseGesture === GESTURE_POINT) {
    if (confidence < exitConfidence) return GESTURE_NONE;
    if (slot.pointing >= options.pointExitEvidence) return GESTURE_POINT;
    if (confidence >= enterConfidence && openness <= options.closedEnterOpenness) return GESTURE_CLOSED;
    if (confidence >= enterConfidence && openness >= options.openEnterOpenness) return GESTURE_OPEN;
    return GESTURE_NONE;
  }
  if (slot.poseGesture === GESTURE_CLOSED) {
    if (confidence < exitConfidence) return GESTURE_NONE;
    if (confidence >= enterConfidence && slot.pointing >= options.pointEnterEvidence) return GESTURE_POINT;
    if (confidence >= enterConfidence && openness >= options.openEnterOpenness) return GESTURE_OPEN;
    return openness <= options.closedExitOpenness ? GESTURE_CLOSED : GESTURE_NONE;
  }
  if (slot.poseGesture === GESTURE_OPEN) {
    if (confidence < exitConfidence) return GESTURE_NONE;
    if (confidence >= enterConfidence && slot.pointing >= options.pointEnterEvidence) return GESTURE_POINT;
    if (confidence >= enterConfidence && openness <= options.closedEnterOpenness) return GESTURE_CLOSED;
    return openness >= options.openExitOpenness ? GESTURE_OPEN : GESTURE_NONE;
  }
  if (confidence < enterConfidence) return GESTURE_NONE;
  if (slot.pointing >= options.pointEnterEvidence) return GESTURE_POINT;
  if (openness <= options.closedEnterOpenness) return GESTURE_CLOSED;
  if (openness >= options.openEnterOpenness) return GESTURE_OPEN;
  return GESTURE_NONE;
}

function updatePoseGesture(slot, options) {
  if (!slot.visible) {
    slot.poseCandidate = GESTURE_NONE;
    slot.poseCandidateFrames = 0;
    return;
  }
  const candidate = nextPoseEvidence(slot, options);
  if (candidate === slot.poseGesture) {
    slot.poseCandidate = GESTURE_NONE;
    slot.poseCandidateFrames = 0;
    return;
  }
  if (candidate !== slot.poseCandidate) {
    slot.poseCandidate = candidate;
    slot.poseCandidateFrames = 1;
  } else {
    slot.poseCandidateFrames += 1;
  }
  if (slot.poseCandidateFrames >= options.gestureConfirmFrames) {
    slot.poseGesture = candidate;
    slot.poseCandidate = GESTURE_NONE;
    slot.poseCandidateFrames = 0;
  }
}

function poseStrength(slot, options) {
  if (slot.poseGesture === GESTURE_CLOSED) {
    const range = Math.max(1e-6, options.closedExitOpenness - options.closedEnterOpenness);
    return clamp01((options.closedExitOpenness - slot.openness) / range) * slot.confidence;
  }
  if (slot.poseGesture === GESTURE_OPEN) {
    const range = Math.max(1e-6, options.openEnterOpenness - options.openExitOpenness);
    return clamp01((slot.openness - options.openExitOpenness) / range) * slot.confidence;
  }
  if (slot.poseGesture === GESTURE_POINT) {
    const range = Math.max(1e-6, options.pointEnterEvidence - options.pointExitEvidence);
    return clamp01((slot.pointing - options.pointExitEvidence) / range) * slot.confidence;
  }
  return 0;
}

function updateGestureState(slot, deltaSeconds, options) {
  const previousGesture = slot.gesture;
  slot.gestureChanged = false;
  updatePoseGesture(slot, options);

  const speed = Math.hypot(slot.velocityU, slot.velocityV);
  const swipeEvidence = slot.visible && slot.motionReliable &&
    slot.confidence >= options.gestureConfidenceEnter &&
    speed >= options.swipeEnterSpeed;

  if (slot.gesture === GESTURE_SWIPE) {
    const keepSwipe = slot.visible && slot.motionReliable &&
      slot.confidence >= options.gestureConfidenceExit &&
      speed >= options.swipeExitSpeed;
    slot.swipeReleaseCount = keepSwipe ? 0 : slot.swipeReleaseCount + 1;
    if (slot.swipeReleaseCount >= options.swipeReleaseFrames) {
      slot.gesture = slot.poseGesture;
      slot.swipeReleaseCount = 0;
      slot.swipeDirectionU = 0;
      slot.swipeDirectionV = 0;
    }
  } else {
    slot.swipeCandidateFrames = swipeEvidence ? slot.swipeCandidateFrames + 1 : 0;
    slot.gesture = slot.poseGesture;
    if (slot.swipeCandidateFrames >= options.swipeConfirmFrames) {
      slot.gesture = GESTURE_SWIPE;
      slot.swipeCandidateFrames = 0;
      slot.swipeReleaseCount = 0;
      const length = Math.max(1e-9, speed);
      slot.swipeDirectionU = slot.velocityU / length;
      slot.swipeDirectionV = slot.velocityV / length;
    }
  }

  if (slot.gesture === GESTURE_SWIPE) {
    const speedRange = Math.max(1e-6, options.swipeEnterSpeed - options.swipeExitSpeed);
    slot.gestureStrength = clamp01((speed - options.swipeExitSpeed) / speedRange) * slot.confidence;
  } else {
    slot.gestureStrength = poseStrength(slot, options);
  }

  slot.gestureChanged = slot.gesture !== previousGesture;
  if (slot.gestureChanged) {
    slot.gestureAge = 1;
    slot.gestureAgeMs = deltaSeconds * 1000;
  } else {
    slot.gestureAge += 1;
    slot.gestureAgeMs += deltaSeconds * 1000;
  }
}

function directionName(x, y) {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return GESTURE_NONE;
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? "left" : "right";
  return y < 0 ? "up" : "down";
}

function associationCost(slot, detection, deltaSeconds, associationDistance) {
  // Association uses the most recent measured displacement. The public
  // velocity stays low-pass filtered, but filtering identity prediction would
  // make two fast proxies exchange slots just as their paths cross.
  const predictionU = slot.measuredU + slot.associationVelocityU * deltaSeconds;
  const predictionV = slot.measuredV + slot.associationVelocityV * deltaSeconds;
  const distance = Math.hypot(detection.u - predictionU, detection.v - predictionV);
  const gate = associationDistance + Math.min(
    0.12,
    Math.hypot(slot.associationVelocityU, slot.associationVelocityV) * deltaSeconds * 0.65,
  );
  if (distance > gate) return Infinity;
  const areaPenalty = Math.abs(Math.log((detection.area + 1) / (slot.area + 1))) * 0.035;
  const opennessPenalty = Math.abs(detection.openness - slot.openness) * 0.025;
  return distance + areaPenalty + opennessPenalty;
}

function bestActiveAssignment(slots, activeIndices, detections, deltaSeconds, associationDistance) {
  let bestCost = Infinity;
  let best = new Map();
  const missingCost = associationDistance + 0.12;

  function visit(position, usedDetections, cost, assignment) {
    if (cost > bestCost) return;
    if (position === activeIndices.length) {
      if (cost < bestCost) {
        bestCost = cost;
        best = new Map(assignment);
      }
      return;
    }
    const slotIndex = activeIndices[position];
    assignment.set(slotIndex, -1);
    visit(position + 1, usedDetections, cost + missingCost, assignment);
    assignment.delete(slotIndex);
    for (let detectionIndex = 0; detectionIndex < detections.length; ++detectionIndex) {
      if (usedDetections.has(detectionIndex)) continue;
      const pairCost = associationCost(
        slots[slotIndex],
        detections[detectionIndex],
        deltaSeconds,
        associationDistance,
      );
      if (!Number.isFinite(pairCost)) continue;
      usedDetections.add(detectionIndex);
      assignment.set(slotIndex, detectionIndex);
      visit(position + 1, usedDetections, cost + pairCost, assignment);
      assignment.delete(slotIndex);
      usedDetections.delete(detectionIndex);
    }
  }

  visit(0, new Set(), 0, new Map());
  return best;
}

function cloneBounds(bounds, scaleX, scaleY) {
  if (!bounds) return null;
  return {
    x: bounds.x * scaleX,
    y: bounds.y * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

function chooseTemporalTip(slot, detection, deltaSeconds) {
  const candidates = detection.tipCandidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return { u: detection.u, v: detection.v };
  const preferred = candidates[detection.preferredTipIndex] ?? candidates[0];
  if (!slot.tipInitialized) return preferred;

  const predictionU = slot.measuredTipU + slot.tipVelocityU * deltaSeconds;
  const predictionV = slot.measuredTipV + slot.tipVelocityV * deltaSeconds;
  let best = preferred;
  let bestCost = Infinity;
  for (let index = 0; index < candidates.length; ++index) {
    const candidate = candidates[index];
    // A small preferred-end bias lets silhouette taper evidence correct a
    // genuinely ambiguous history, while proximity prevents frame-to-frame
    // principal-axis sign changes from flipping the finger to the wrist.
    const preferredBias = index === detection.preferredTipIndex ? -0.012 : 0;
    const cost = Math.hypot(candidate.u - predictionU, candidate.v - predictionV) + preferredBias;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

export class MotionTracker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_MOTION_TRACKER_OPTIONS, ...options };
    this.options.sampleWidth = dimension(this.options.sampleWidth, "sampleWidth");
    this.options.sampleHeight = dimension(this.options.sampleHeight, "sampleHeight");
    this.options.maxMissingFrames = Math.max(0, Math.floor(Number(this.options.maxMissingFrames)));
    for (const name of [
      "gestureConfidenceEnter",
      "gestureConfidenceExit",
      "closedEnterOpenness",
      "closedExitOpenness",
      "openEnterOpenness",
      "openExitOpenness",
      "pointEnterEvidence",
      "pointExitEvidence",
    ]) {
      const value = Number(this.options[name]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`${name} must be a finite number in [0, 1].`);
      }
      this.options[name] = value;
    }
    for (const name of ["swipeEnterSpeed", "swipeExitSpeed"]) {
      const value = Number(this.options[name]);
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite non-negative number.`);
      }
      this.options[name] = value;
    }
    for (const name of ["gestureConfirmFrames", "swipeConfirmFrames", "swipeReleaseFrames"]) {
      this.options[name] = Math.max(1, Math.floor(finitePositive(this.options[name], name)));
    }
    if (this.options.gestureConfidenceExit > this.options.gestureConfidenceEnter) {
      throw new RangeError("gestureConfidenceExit must not exceed gestureConfidenceEnter.");
    }
    if (this.options.closedEnterOpenness >= this.options.closedExitOpenness) {
      throw new RangeError("closedEnterOpenness must be lower than closedExitOpenness.");
    }
    if (this.options.openExitOpenness >= this.options.openEnterOpenness) {
      throw new RangeError("openExitOpenness must be lower than openEnterOpenness.");
    }
    if (this.options.pointExitEvidence >= this.options.pointEnterEvidence) {
      throw new RangeError("pointExitEvidence must be lower than pointEnterEvidence.");
    }
    if (this.options.swipeExitSpeed >= this.options.swipeEnterSpeed) {
      throw new RangeError("swipeExitSpeed must be lower than swipeEnterSpeed.");
    }
    this.options.targetAspect = this.options.targetAspect == null
      ? null
      : finitePositive(this.options.targetAspect, "targetAspect");
    this.slots = [freshSlot(0), freshSlot(1)];
    this.previous = null;
    this.background = null;
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.sampleWidth = 0;
    this.sampleHeight = 0;
    this.lastTimestamp = null;
    this.frameIndex = 0;
  }

  get label() {
    return MOTION_TRACKER_LABEL;
  }

  get kind() {
    return "local-heuristic-motion";
  }

  reset() {
    this.previous = null;
    this.background = null;
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.sampleWidth = 0;
    this.sampleHeight = 0;
    this.lastTimestamp = null;
    this.frameIndex = 0;
    this.slots = [freshSlot(0), freshSlot(1)];
  }

  #resolveFrame(frameOrData, width, height, timestampMs) {
    if (frameOrData && !ArrayBuffer.isView(frameOrData) && frameOrData.data != null) {
      return {
        data: rgbaData(frameOrData.data),
        width: dimension(width ?? frameOrData.width, "width"),
        height: dimension(height ?? frameOrData.height, "height"),
        timestamp: Number(timestampMs ?? frameOrData.timestampMs ?? frameOrData.timestamp),
      };
    }
    return {
      data: rgbaData(frameOrData),
      width: dimension(width, "width"),
      height: dimension(height, "height"),
      timestamp: Number(timestampMs),
    };
  }

  #snapshotSlot(slot, frameWidth, frameHeight, mappingOptions) {
    const frameX = slot.u * frameWidth;
    const frameY = slot.v * frameHeight;
    const display = mapFramePointToDisplay(
      { x: frameX, y: frameY },
      { width: frameWidth, height: frameHeight },
      mappingOptions,
    );
    const crop = display.crop;
    const direction = mappingOptions.mirrorX === false ? 1 : -1;
    const displayVelocityX = direction * slot.velocityU * frameWidth / crop.width;
    const displayVelocityY = slot.velocityV * frameHeight / crop.height;
    const tipFrameX = slot.tipU * frameWidth;
    const tipFrameY = slot.tipV * frameHeight;
    const tipDisplay = mapFramePointToDisplay(
      { x: tipFrameX, y: tipFrameY },
      { width: frameWidth, height: frameHeight },
      mappingOptions,
    );
    const tipVelocityX = direction * slot.tipVelocityU * frameWidth / crop.width;
    const tipVelocityY = slot.tipVelocityV * frameHeight / crop.height;
    const tip = {
      x: tipDisplay.u,
      y: tipDisplay.v,
      position: { x: tipDisplay.u, y: tipDisplay.v },
      visible: slot.tipVisible && tipDisplay.visible,
      confidence: slot.tipConfidence,
      age: slot.tipAge,
      frame: { x: tipFrameX, y: tipFrameY },
      normalized: { x: slot.tipU, y: slot.tipV },
      display: tipDisplay,
      velocity: {
        x: tipVelocityX,
        y: tipVelocityY,
        speed: Math.hypot(tipVelocityX, tipVelocityY),
      },
      sourceVelocity: {
        x: slot.tipVelocityU,
        y: slot.tipVelocityV,
        speed: Math.hypot(slot.tipVelocityU, slot.tipVelocityV),
      },
    };
    let gestureVectorX = 0;
    let gestureVectorY = 0;
    if (slot.gesture === GESTURE_SWIPE) {
      gestureVectorX = direction * slot.swipeDirectionU * frameWidth / crop.width;
      gestureVectorY = slot.swipeDirectionV * frameHeight / crop.height;
      const gestureLength = Math.hypot(gestureVectorX, gestureVectorY);
      if (gestureLength > 1e-9) {
        gestureVectorX /= gestureLength;
        gestureVectorY /= gestureLength;
      }
    }
    return {
      id: slot.id,
      slot: slot.id,
      active: slot.active,
      visible: slot.visible && display.visible,
      detected: slot.visible,
      confidence: slot.confidence,
      openness: slot.openness,
      pointing: slot.pointing,
      gesture: slot.gesture,
      poseGesture: slot.poseGesture,
      gestureStrength: slot.gestureStrength,
      gestureAge: slot.gestureAge,
      gestureAgeMs: slot.gestureAgeMs,
      gestureChanged: slot.gestureChanged,
      gestureDirection: directionName(gestureVectorX, gestureVectorY),
      gestureVector: { x: gestureVectorX, y: gestureVectorY },
      gestureSourceVector: {
        x: slot.gesture === GESTURE_SWIPE ? slot.swipeDirectionU : 0,
        y: slot.gesture === GESTURE_SWIPE ? slot.swipeDirectionV : 0,
      },
      tip,
      finger: tip,
      tipVelocity: tip.velocity,
      fingerVelocity: tip.velocity,
      x: display.u,
      y: display.v,
      position: { x: display.u, y: display.v },
      frame: { x: frameX, y: frameY },
      normalized: { x: slot.u, y: slot.v },
      display,
      velocity: {
        x: displayVelocityX,
        y: displayVelocityY,
        speed: Math.hypot(displayVelocityX, displayVelocityY),
      },
      sourceVelocity: {
        x: slot.velocityU,
        y: slot.velocityV,
        speed: Math.hypot(slot.velocityU, slot.velocityV),
      },
      area: slot.area,
      bounds: slot.bounds ? { ...slot.bounds } : null,
      missingFrames: slot.missingFrames,
      age: slot.age,
    };
  }

  #result(frameWidth, frameHeight, timestamp, detection = null, initialized = false) {
    const mappingOptions = {
      mirrorX: this.options.mirrorX !== false,
      targetAspect: this.options.targetAspect,
      crop: this.options.crop ?? undefined,
      clamp: false,
    };
    const slots = this.slots.map(slot => this.#snapshotSlot(slot, frameWidth, frameHeight, mappingOptions));
    return {
      label: MOTION_TRACKER_LABEL,
      kind: "local-heuristic-motion",
      initialized,
      frameIndex: this.frameIndex,
      timestamp,
      frameWidth,
      frameHeight,
      sampleWidth: this.sampleWidth,
      sampleHeight: this.sampleHeight,
      coverage: detection?.coverage ?? 0,
      componentCount: detection?.components.length ?? 0,
      slots,
      hands: slots.filter(slot => slot.active),
    };
  }

  update(frameOrData, width, height, timestampMs) {
    const frame = this.#resolveFrame(frameOrData, width, height, timestampMs);
    if (frame.data.length < frame.width * frame.height * 4) {
      throw new RangeError(`RGBA data has ${frame.data.length} values; ${frame.width * frame.height * 4} are required.`);
    }
    let timestamp = frame.timestamp;
    if (!Number.isFinite(timestamp)) timestamp = this.lastTimestamp == null ? 0 : this.lastTimestamp + 1000 / 60;

    const sampled = downsampleRgba(frame.data, frame.width, frame.height, {
      maxWidth: this.options.sampleWidth,
      maxHeight: this.options.sampleHeight,
    });
    const dimensionsChanged = this.sourceWidth !== frame.width ||
      this.sourceHeight !== frame.height ||
      this.sampleWidth !== sampled.width ||
      this.sampleHeight !== sampled.height;
    if (dimensionsChanged && this.previous) this.reset();
    this.sourceWidth = frame.width;
    this.sourceHeight = frame.height;
    this.sampleWidth = sampled.width;
    this.sampleHeight = sampled.height;
    this.frameIndex += 1;

    if (!this.previous) {
      this.previous = sampled;
      this.background = new Float32Array(sampled.width * sampled.height * 3);
      for (let index = 0; index < sampled.width * sampled.height; ++index) {
        this.background[index * 3] = sampled.data[index * 4];
        this.background[index * 3 + 1] = sampled.data[index * 4 + 1];
        this.background[index * 3 + 2] = sampled.data[index * 4 + 2];
      }
      this.lastTimestamp = timestamp;
      return this.#result(frame.width, frame.height, timestamp, null, true);
    }

    const elapsed = Math.max(1, timestamp - this.lastTimestamp);
    const deltaSeconds = clamp(elapsed / 1000, 1 / 240, 0.25);
    const detection = detectMotionComponents(
      sampled,
      this.previous,
      { data: this.background, channels: 3 },
      this.options,
    );
    const candidateLimit = Math.max(2, Math.floor(Number(this.options.candidateLimit ?? 6)));
    const detections = detection.components.slice(0, candidateLimit).map(component => ({
      ...component,
      u: (component.x + 0.5) / sampled.width,
      v: (component.y + 0.5) / sampled.height,
      rawArea: component.area * sampled.scaleX * sampled.scaleY,
      rawBounds: cloneBounds(component.bounds, sampled.scaleX, sampled.scaleY),
      preferredTipIndex: component.tipIndex,
      tipCandidates: component.extremities.map(extremity => ({
        u: (extremity.x + 0.5) / sampled.width,
        v: (extremity.y + 0.5) / sampled.height,
      })),
    }));

    const activeIndices = this.slots
      .map((slot, index) => slot.active ? index : -1)
      .filter(index => index >= 0);
    const assignment = bestActiveAssignment(
      this.slots,
      activeIndices,
      detections,
      deltaSeconds,
      Number(this.options.associationDistance),
    );
    const usedDetections = new Set();

    for (const slotIndex of activeIndices) {
      const slot = this.slots[slotIndex];
      const detectionIndex = assignment.get(slotIndex) ?? -1;
      if (detectionIndex < 0) {
        slot.visible = false;
        slot.motionReliable = false;
        slot.missingFrames += 1;
        slot.u += slot.velocityU * deltaSeconds;
        slot.v += slot.velocityV * deltaSeconds;
        slot.velocityU *= Number(this.options.velocityDecay);
        slot.velocityV *= Number(this.options.velocityDecay);
        slot.associationVelocityU *= Number(this.options.velocityDecay);
        slot.associationVelocityV *= Number(this.options.velocityDecay);
        slot.tipVisible = false;
        slot.tipU += slot.tipVelocityU * deltaSeconds;
        slot.tipV += slot.tipVelocityV * deltaSeconds;
        slot.tipVelocityU *= Number(this.options.velocityDecay);
        slot.tipVelocityV *= Number(this.options.velocityDecay);
        slot.tipConfidence *= Number(this.options.confidenceDecay);
        slot.confidence *= Number(this.options.confidenceDecay);
        if (slot.missingFrames > this.options.maxMissingFrames || slot.confidence < 0.035) {
          const id = slot.id;
          this.slots[slotIndex] = freshSlot(id);
        }
        continue;
      }

      usedDetections.add(detectionIndex);
      const component = detections[detectionIndex];
      const uninterruptedMotion = slot.missingFrames === 0;
      const instantaneousU = (component.u - slot.measuredU) / deltaSeconds;
      const instantaneousV = (component.v - slot.measuredV) / deltaSeconds;
      const velocityBlend = clamp01(this.options.velocityBlend);
      slot.velocityU += (instantaneousU - slot.velocityU) * velocityBlend;
      slot.velocityV += (instantaneousV - slot.velocityV) * velocityBlend;
      slot.associationVelocityU = instantaneousU;
      slot.associationVelocityV = instantaneousV;
      const positionBlend = 1 - Math.exp(-Math.max(0, Number(this.options.positionSharpness)) * deltaSeconds);
      slot.u += (component.u - slot.u) * positionBlend;
      slot.v += (component.v - slot.v) * positionBlend;
      slot.measuredU = component.u;
      slot.measuredV = component.v;
      slot.confidence += (component.confidence - slot.confidence) * clamp01(this.options.confidenceBlend);
      slot.openness += (component.openness - slot.openness) * clamp01(this.options.opennessBlend);
      slot.pointing += (component.pointing - slot.pointing) * clamp01(this.options.pointingBlend);
      const tipCandidate = chooseTemporalTip(slot, component, deltaSeconds);
      const instantaneousTipU = uninterruptedMotion
        ? (tipCandidate.u - slot.measuredTipU) / deltaSeconds
        : 0;
      const instantaneousTipV = uninterruptedMotion
        ? (tipCandidate.v - slot.measuredTipV) / deltaSeconds
        : 0;
      const tipVelocityBlend = clamp01(this.options.tipVelocityBlend);
      slot.tipVelocityU += (instantaneousTipU - slot.tipVelocityU) * tipVelocityBlend;
      slot.tipVelocityV += (instantaneousTipV - slot.tipVelocityV) * tipVelocityBlend;
      const tipPositionBlend = 1 - Math.exp(
        -Math.max(0, Number(this.options.tipPositionSharpness)) * deltaSeconds,
      );
      slot.tipU += (tipCandidate.u - slot.tipU) * tipPositionBlend;
      slot.tipV += (tipCandidate.v - slot.tipV) * tipPositionBlend;
      slot.measuredTipU = tipCandidate.u;
      slot.measuredTipV = tipCandidate.v;
      slot.tipConfidence += (component.tipConfidence - slot.tipConfidence) * clamp01(this.options.confidenceBlend);
      slot.tipInitialized = true;
      slot.tipVisible = true;
      slot.tipAge += 1;
      slot.area = component.rawArea;
      slot.bounds = component.rawBounds;
      slot.visible = true;
      slot.motionReliable = uninterruptedMotion;
      slot.missingFrames = 0;
      slot.age += 1;
    }

    const inactiveIndices = this.slots
      .map((slot, index) => !slot.active ? index : -1)
      .filter(index => index >= 0);
    const unmatched = detections
      .map((component, index) => ({ component, index }))
      .filter(entry => !usedDetections.has(entry.index))
      .sort((left, right) => left.component.u - right.component.u || left.index - right.index);
    for (let index = 0; index < Math.min(inactiveIndices.length, unmatched.length); ++index) {
      const slot = this.slots[inactiveIndices[index]];
      const component = unmatched[index].component;
      slot.active = true;
      slot.visible = true;
      slot.confidence = component.confidence;
      slot.openness = component.openness;
      slot.pointing = component.pointing;
      slot.u = component.u;
      slot.v = component.v;
      slot.measuredU = component.u;
      slot.measuredV = component.v;
      slot.velocityU = 0;
      slot.velocityV = 0;
      slot.associationVelocityU = 0;
      slot.associationVelocityV = 0;
      slot.motionReliable = false;
      const tipCandidate = component.tipCandidates[component.preferredTipIndex] ?? component.tipCandidates[0];
      slot.tipInitialized = true;
      slot.tipVisible = true;
      slot.tipConfidence = component.tipConfidence;
      slot.tipU = tipCandidate?.u ?? component.u;
      slot.tipV = tipCandidate?.v ?? component.v;
      slot.measuredTipU = slot.tipU;
      slot.measuredTipV = slot.tipV;
      slot.tipVelocityU = 0;
      slot.tipVelocityV = 0;
      slot.tipAge = 1;
      slot.area = component.rawArea;
      slot.bounds = component.rawBounds;
      slot.missingFrames = 0;
      slot.age = 1;
    }

    for (const slot of this.slots) {
      if (slot.active) updateGestureState(slot, deltaSeconds, this.options);
    }

    adaptBackgroundModel(
      this.background,
      sampled.data,
      detection.seedMask,
      this.options.backgroundLearningRate,
      this.options.foregroundLearningRate,
    );

    this.previous = sampled;
    this.lastTimestamp = timestamp;
    return this.#result(frame.width, frame.height, timestamp, detection, true);
  }
}

export function createMotionTracker(options) {
  return new MotionTracker(options);
}

export default createMotionTracker;
