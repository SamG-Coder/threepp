// Deterministic, client-only person matte heuristic. This is not semantic
// segmentation: inclusive skin-colour seeds anchor a foreground flood through
// pixels that changed from a locally maintained background. Unseeded movement
// remains outside the matte.
export const PERSON_MATTE_LABEL = "LOCAL YCBCR + SEEDED PERSON MATTE / NON-NEURAL";

export const DEFAULT_PERSON_MATTE_OPTIONS = Object.freeze({
  skinSeedThreshold: 0.34,
  seedForegroundThreshold: 0.105,
  foregroundGrowThreshold: 0.055,
  foregroundHardFloor: 0.024,
  spatialEvidenceAmount: 0.62,
  backgroundLearningRate: 0.045,
  foregroundLearningRate: 0.002,
  temporalAttack: 0.68,
  temporalRelease: 0.16,
  matteThreshold: 0.42,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function dimension(value, label) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return number;
}

function typed(values, length, label) {
  if (!ArrayBuffer.isView(values) || values instanceof DataView || values.length < length) {
    throw new RangeError(`${label} must be a typed array with at least ${length} entries.`);
  }
  return values;
}

function floatBuffer(value, length) {
  return value instanceof Float32Array && value.length >= length ? value : new Float32Array(length);
}

function byteBuffer(value, length) {
  return value instanceof Uint8Array && value.length >= length ? value : new Uint8Array(length);
}

/** Convert RGBA bytes to normalized BT.601-style Y, Cb, and Cr planes. */
export function rgbToLumaChroma(rgba, width, height, output = {}) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  const source = typed(rgba, pixels * 4, "rgba");
  const y = floatBuffer(output.y, pixels);
  const cb = floatBuffer(output.cb, pixels);
  const cr = floatBuffer(output.cr, pixels);
  for (let index = 0; index < pixels; ++index) {
    const offset = index * 4;
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    y[index] = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    cb[index] = clamp01(0.5 + (-0.168736 * red - 0.331264 * green + 0.5 * blue) / 255);
    cr[index] = clamp01(0.5 + (0.5 * red - 0.418688 * green - 0.081312 * blue) / 255);
  }
  return { width: columns, height: rows, y, cb, cr };
}

export const rgbaToLumaChroma = rgbToLumaChroma;

/** Broad YCbCr skin likelihood used only to seed foreground-connected regions. */
export function inclusiveSkinLikelihood(luminance, cb, cr) {
  const y = clamp01(luminance);
  const blueDifference = clamp01(cb);
  const redDifference = clamp01(cr);
  const ellipse = Math.hypot((blueDifference - 0.43) / 0.18, (redDifference - 0.60) / 0.20);
  const chromaLikelihood = clamp01(1.18 - ellipse * 0.66);
  const lowLightGate = clamp01((y - 0.035) / 0.10);
  const highlightGate = clamp01((1.02 - y) / 0.12);
  return clamp01(chromaLikelihood * lowLightGate * highlightGate);
}

export function createPersonMatteWorkspace(width, height) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  const planes = () => ({
    width: columns,
    height: rows,
    y: new Float32Array(pixels),
    cb: new Float32Array(pixels),
    cr: new Float32Array(pixels),
  });
  return {
    width: columns,
    height: rows,
    pixels,
    current: planes(),
    previous: planes(),
    background: planes(),
    skin: new Float32Array(pixels),
    backgroundDifference: new Float32Array(pixels),
    frameDifference: new Float32Array(pixels),
    foregroundEvidence: new Float32Array(pixels),
    smoothedEvidence: new Float32Array(pixels),
    confidence: new Float32Array(pixels),
    seedMask: new Uint8Array(pixels),
    eligibleMask: new Uint8Array(pixels),
    mask: new Uint8Array(pixels),
    queue: new Int32Array(pixels),
    histogram: new Uint32Array(257),
  };
}

function compatibleWorkspace(workspace, width, height) {
  return workspace?.width === width && workspace?.height === height && workspace?.pixels === width * height;
}

function planeFrame(value, width, height, target, label) {
  const pixels = width * height;
  if (value == null) return null;
  if (value.y != null && value.cb != null && value.cr != null) {
    if (Number(value.width ?? width) !== width || Number(value.height ?? height) !== height) {
      throw new RangeError(`${label} dimensions must match the current frame.`);
    }
    return {
      width,
      height,
      y: typed(value.y, pixels, `${label}.y`),
      cb: typed(value.cb, pixels, `${label}.cb`),
      cr: typed(value.cr, pixels, `${label}.cr`),
    };
  }
  const rgba = ArrayBuffer.isView(value) ? value : value.data;
  return rgbToLumaChroma(typed(rgba, pixels * 4, `${label}.data`), width, height, target);
}

function resolveCurrent(value, options) {
  if (value == null) throw new TypeError("current frame is required.");
  const width = dimension(value.width ?? options.width, "current.width");
  const height = dimension(value.height ?? options.height, "current.height");
  return { width, height };
}

function medianPlaneDelta(current, reference, pixels, histogram) {
  histogram.fill(0);
  for (let index = 0; index < pixels; ++index) {
    const difference = clamp(current[index] - reference[index], -1, 1);
    histogram[Math.round((difference + 1) * 128)] += 1;
  }
  const middle = Math.floor((pixels - 1) * 0.5);
  let count = 0;
  for (let bin = 0; bin < histogram.length; ++bin) {
    count += histogram[bin];
    if (count > middle) return bin / 128 - 1;
  }
  return 0;
}

function estimateGlobalDelta(current, reference, pixels, histogram) {
  if (!reference) return { y: 0, cb: 0, cr: 0 };
  return {
    y: medianPlaneDelta(current.y, reference.y, pixels, histogram),
    cb: medianPlaneDelta(current.cb, reference.cb, pixels, histogram),
    cr: medianPlaneDelta(current.cr, reference.cr, pixels, histogram),
  };
}

function differenceEvidence(current, reference, index, delta) {
  if (!reference) return 0;
  const luminance = Math.abs((current.y[index] - reference.y[index]) - delta.y);
  const chroma = Math.hypot(
    (current.cb[index] - reference.cb[index]) - delta.cb,
    (current.cr[index] - reference.cr[index]) - delta.cr,
  );
  return clamp01(luminance * 2.35 + chroma * 1.35);
}

/** One allocation-free 3x3 smoothing pass over foreground evidence. */
export function smoothForegroundEvidence(source, width, height, output, amount = 0.62) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  const input = typed(source, pixels, "source");
  const result = floatBuffer(output, pixels);
  const blend = clamp01(amount);
  for (let y = 0; y < rows; ++y) {
    for (let x = 0; x < columns; ++x) {
      const index = y * columns + x;
      let sum = input[index] * 2;
      let weight = 2;
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(rows - 1, y + 1);
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(columns - 1, x + 1);
      for (let neighbourY = y0; neighbourY <= y1; ++neighbourY) {
        for (let neighbourX = x0; neighbourX <= x1; ++neighbourX) {
          if (neighbourX === x && neighbourY === y) continue;
          sum += input[neighbourY * columns + neighbourX];
          weight += 1;
        }
      }
      result[index] = input[index] + (sum / weight - input[index]) * blend;
    }
  }
  return result;
}

function matteStats(mask, width, height) {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let index = 0; index < mask.length; ++index) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    count += 1;
    sumX += x + 0.5;
    sumY += y + 0.5;
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  return {
    pixels: count,
    coverage: count / (width * height),
    centroid: count ? { x: sumX / count / width, y: sumY / count / height } : null,
    bounds: count ? {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    } : null,
  };
}

/**
 * Pure seeded matte extraction. Results reference the supplied workspace and
 * remain valid until that workspace is reused.
 */
export function buildPersonMatteLayer(
  currentValue,
  previousValue = null,
  backgroundValue = null,
  options = {},
  suppliedWorkspace = options.workspace,
) {
  const dimensions = resolveCurrent(currentValue, options);
  const width = dimensions.width;
  const height = dimensions.height;
  const pixels = width * height;
  const workspace = compatibleWorkspace(suppliedWorkspace, width, height)
    ? suppliedWorkspace
    : createPersonMatteWorkspace(width, height);
  const current = planeFrame(currentValue, width, height, workspace.current, "current");
  const previous = planeFrame(previousValue, width, height, workspace.previous, "previous");
  const background = planeFrame(backgroundValue, width, height, workspace.background, "background");
  const backgroundDelta = estimateGlobalDelta(current, background, pixels, workspace.histogram);
  const frameDelta = estimateGlobalDelta(current, previous, pixels, workspace.histogram);
  const skinThreshold = clamp01(options.skinSeedThreshold ?? DEFAULT_PERSON_MATTE_OPTIONS.skinSeedThreshold);
  const seedThreshold = clamp01(
    options.seedForegroundThreshold ?? DEFAULT_PERSON_MATTE_OPTIONS.seedForegroundThreshold,
  );
  const growThreshold = clamp01(
    options.foregroundGrowThreshold ?? DEFAULT_PERSON_MATTE_OPTIONS.foregroundGrowThreshold,
  );
  const hardFloor = clamp01(options.foregroundHardFloor ?? DEFAULT_PERSON_MATTE_OPTIONS.foregroundHardFloor);

  workspace.seedMask.fill(0);
  workspace.eligibleMask.fill(0);
  workspace.mask.fill(0);
  workspace.confidence.fill(0);
  for (let index = 0; index < pixels; ++index) {
    const skin = inclusiveSkinLikelihood(current.y[index], current.cb[index], current.cr[index]);
    const backgroundDifference = differenceEvidence(current, background, index, backgroundDelta);
    const frameDifference = differenceEvidence(current, previous, index, frameDelta);
    const foreground = Math.max(backgroundDifference, frameDifference * 0.84);
    workspace.skin[index] = skin;
    workspace.backgroundDifference[index] = backgroundDifference;
    workspace.frameDifference[index] = frameDifference;
    workspace.foregroundEvidence[index] = foreground;
  }
  smoothForegroundEvidence(
    workspace.foregroundEvidence,
    width,
    height,
    workspace.smoothedEvidence,
    options.spatialEvidenceAmount ?? DEFAULT_PERSON_MATTE_OPTIONS.spatialEvidenceAmount,
  );

  let queueRead = 0;
  let queueWrite = 0;
  let eligiblePixels = 0;
  for (let index = 0; index < pixels; ++index) {
    const rawEvidence = workspace.foregroundEvidence[index];
    const smoothed = workspace.smoothedEvidence[index];
    const eligible = rawEvidence >= hardFloor && smoothed >= growThreshold;
    if (eligible) {
      workspace.eligibleMask[index] = 1;
      eligiblePixels += 1;
    }
    if (eligible && workspace.skin[index] >= skinThreshold && rawEvidence >= seedThreshold) {
      workspace.seedMask[index] = 1;
      workspace.mask[index] = 1;
      workspace.queue[queueWrite++] = index;
    }
  }

  const seedPixels = queueWrite;
  while (queueRead < queueWrite) {
    const index = workspace.queue[queueRead++];
    const x = index % width;
    const y = Math.floor(index / width);
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    const x0 = Math.max(0, x - 1);
    const x1 = Math.min(width - 1, x + 1);
    for (let neighbourY = y0; neighbourY <= y1; ++neighbourY) {
      for (let neighbourX = x0; neighbourX <= x1; ++neighbourX) {
        if (neighbourX === x && neighbourY === y) continue;
        const neighbour = neighbourY * width + neighbourX;
        if (workspace.mask[neighbour] || !workspace.eligibleMask[neighbour]) continue;
        workspace.mask[neighbour] = 1;
        workspace.queue[queueWrite++] = neighbour;
      }
    }
  }

  for (let index = 0; index < pixels; ++index) {
    if (!workspace.mask[index]) continue;
    const evidence = workspace.smoothedEvidence[index];
    const seedBoost = workspace.seedMask[index] ? 0.22 : 0;
    workspace.confidence[index] = clamp01(0.38 + evidence * 1.45 + seedBoost);
  }
  const stats = matteStats(workspace.mask, width, height);
  return {
    label: PERSON_MATTE_LABEL,
    kind: "local-seeded-person-matte",
    width,
    height,
    mask: workspace.mask,
    alpha: workspace.confidence,
    confidence: workspace.confidence,
    seedMask: workspace.seedMask,
    eligibleMask: workspace.eligibleMask,
    skinLikelihood: workspace.skin,
    foregroundEvidence: workspace.foregroundEvidence,
    smoothedEvidence: workspace.smoothedEvidence,
    backgroundDifference: workspace.backgroundDifference,
    frameDifference: workspace.frameDifference,
    lumaChroma: current,
    seedPixels,
    seedCoverage: seedPixels / pixels,
    eligiblePixels,
    eligibleCoverage: eligiblePixels / pixels,
    pixels: stats.pixels,
    coverage: stats.coverage,
    centroid: stats.centroid,
    bounds: stats.bounds,
    globalBackgroundDelta: backgroundDelta,
    globalFrameDelta: frameDelta,
    workspace,
  };
}

export const computePersonMatte = buildPersonMatteLayer;

/** Asymmetric per-pixel temporal confidence smoothing. */
export function temporalSmoothMatte(current, previous, width, height, options = {}, output = null) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  const target = typed(current, pixels, "current");
  const history = typed(previous, pixels, "previous");
  const result = floatBuffer(output, pixels);
  const attack = clamp01(options.temporalAttack ?? DEFAULT_PERSON_MATTE_OPTIONS.temporalAttack);
  const release = clamp01(options.temporalRelease ?? DEFAULT_PERSON_MATTE_OPTIONS.temporalRelease);
  for (let index = 0; index < pixels; ++index) {
    const targetValue = clamp01(target[index]);
    const previousValue = clamp01(history[index]);
    const blend = targetValue >= previousValue ? attack : release;
    result[index] = previousValue + (targetValue - previousValue) * blend;
  }
  return result;
}

export function thresholdMatte(alpha, width, height, threshold = DEFAULT_PERSON_MATTE_OPTIONS.matteThreshold, output = null) {
  const columns = dimension(width, "width");
  const rows = dimension(height, "height");
  const pixels = columns * rows;
  const values = typed(alpha, pixels, "alpha");
  const result = byteBuffer(output, pixels);
  const cutoff = clamp01(threshold);
  for (let index = 0; index < pixels; ++index) result[index] = values[index] >= cutoff ? 1 : 0;
  return result;
}

export class TemporalMatte {
  constructor(width, height, options = {}) {
    this.width = dimension(width, "width");
    this.height = dimension(height, "height");
    this.options = { ...DEFAULT_PERSON_MATTE_OPTIONS, ...options };
    this.alpha = new Float32Array(this.width * this.height);
    this.mask = new Uint8Array(this.width * this.height);
  }

  update(confidence) {
    temporalSmoothMatte(confidence, this.alpha, this.width, this.height, this.options, this.alpha);
    thresholdMatte(this.alpha, this.width, this.height, this.options.matteThreshold, this.mask);
    return { alpha: this.alpha, mask: this.mask, ...matteStats(this.mask, this.width, this.height) };
  }

  reset() {
    this.alpha.fill(0);
    this.mask.fill(0);
  }
}

export function createTemporalMatte(width, height, options) {
  return new TemporalMatte(width, height, options);
}

function copyPlanes(source, target, pixels) {
  target.y.set(source.y.subarray(0, pixels));
  target.cb.set(source.cb.subarray(0, pixels));
  target.cr.set(source.cr.subarray(0, pixels));
}

export class PersonMatteTracker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_PERSON_MATTE_OPTIONS, ...options };
    this.workspace = null;
    this.temporal = null;
    this.initialized = false;
    this.frameIndex = 0;
  }

  reset() {
    this.workspace = null;
    this.temporal = null;
    this.initialized = false;
    this.frameIndex = 0;
  }

  update(frameOrData, width, height) {
    const frame = ArrayBuffer.isView(frameOrData)
      ? { data: frameOrData, width, height }
      : frameOrData;
    const columns = dimension(frame?.width, "frame.width");
    const rows = dimension(frame?.height, "frame.height");
    const pixels = columns * rows;
    if (!compatibleWorkspace(this.workspace, columns, rows)) {
      this.workspace = createPersonMatteWorkspace(columns, rows);
      this.temporal = createTemporalMatte(columns, rows, this.options);
      this.initialized = false;
      this.frameIndex = 0;
    }
    const current = planeFrame(frame, columns, rows, this.workspace.current, "frame");
    this.frameIndex += 1;
    if (!this.initialized) {
      copyPlanes(current, this.workspace.previous, pixels);
      copyPlanes(current, this.workspace.background, pixels);
      this.workspace.mask.fill(0);
      this.workspace.confidence.fill(0);
      this.temporal.reset();
      this.initialized = true;
      return {
        label: PERSON_MATTE_LABEL,
        kind: "local-seeded-person-matte",
        initialized: true,
        frameIndex: this.frameIndex,
        width: columns,
        height: rows,
        mask: this.temporal.mask,
        rawMask: this.workspace.mask,
        alpha: this.temporal.alpha,
        coverage: 0,
        pixels: 0,
        centroid: null,
        bounds: null,
      };
    }

    const layer = buildPersonMatteLayer(
      current,
      this.workspace.previous,
      this.workspace.background,
      this.options,
      this.workspace,
    );
    const temporal = this.temporal.update(layer.confidence);
    const normalRate = clamp01(this.options.backgroundLearningRate);
    const foregroundRate = clamp01(this.options.foregroundLearningRate);
    for (let index = 0; index < pixels; ++index) {
      const rate = layer.mask[index] || temporal.alpha[index] >= 0.12 ? foregroundRate : normalRate;
      this.workspace.background.y[index] += (current.y[index] - this.workspace.background.y[index]) * rate;
      this.workspace.background.cb[index] += (current.cb[index] - this.workspace.background.cb[index]) * rate;
      this.workspace.background.cr[index] += (current.cr[index] - this.workspace.background.cr[index]) * rate;
    }
    copyPlanes(current, this.workspace.previous, pixels);
    return {
      ...layer,
      initialized: true,
      frameIndex: this.frameIndex,
      rawMask: layer.mask,
      rawAlpha: layer.confidence,
      mask: temporal.mask,
      alpha: temporal.alpha,
      pixels: temporal.pixels,
      coverage: temporal.coverage,
      centroid: temporal.centroid,
      bounds: temporal.bounds,
    };
  }
}

export function createPersonMatte(options) {
  return new PersonMatteTracker(options);
}

export default createPersonMatte;
