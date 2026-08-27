import {
  alphaBounds,
  despillImageData,
  keyImageData,
  occupancyFromRgba,
  trunkBaseX,
} from "./chroma-key.mjs";
import { cameraBasis } from "./views.mjs";

export const DEFAULT_ORBIT_FRAME_LIMITS = Object.freeze({
  borderMargin: 1,
  maxScaleRatio: 1.32,
  maxSupportDrift: 0.14,
  maxCenterDrift: 0.08,
  minOppositeMirrorIoU: 0.42,
  maxOppositeWidthDelta: 0.22,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedPixel(value, extent) {
  return Math.min(Math.max(0, extent - 1), Math.max(0, value));
}

function exactOccupancyBounds(occupancy, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let filled = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!occupancy[row + x]) continue;
      filled += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!filled) {
    return {
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      width,
      height,
      filled: 0,
    };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    filled,
  };
}

/**
 * Ignore isolated one-pixel fringe when estimating the camera/support frame.
 * The original keyed occupancy is retained for reconstruction and colour.
 */
function robustOccupancyBounds(occupancy, width, height) {
  const exact = exactOccupancyBounds(occupancy, width, height);
  if (!exact.filled) return exact;
  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  let maxRow = 0;
  let maxColumn = 0;
  for (let y = exact.minY; y <= exact.maxY; y++) {
    const row = y * width;
    for (let x = exact.minX; x <= exact.maxX; x++) {
      if (!occupancy[row + x]) continue;
      rows[y] += 1;
      columns[x] += 1;
      if (rows[y] > maxRow) maxRow = rows[y];
      if (columns[x] > maxColumn) maxColumn = columns[x];
    }
  }
  const rowFloor = Math.max(1, Math.ceil(maxRow * 0.003));
  const columnFloor = Math.max(1, Math.ceil(maxColumn * 0.003));
  let minY = exact.minY;
  let maxY = exact.maxY;
  let minX = exact.minX;
  let maxX = exact.maxX;
  while (minY < maxY && rows[minY] < rowFloor) minY += 1;
  while (maxY > minY && rows[maxY] < rowFloor) maxY -= 1;
  while (minX < maxX && columns[minX] < columnFloor) minX += 1;
  while (maxX > minX && columns[maxX] < columnFloor) maxX -= 1;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    filled: exact.filled,
  };
}

function median(values, fallback) {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];
  return (values[middle - 1] + values[middle]) * 0.5;
}

/** A stable grounded pivot, without recentering every silhouette by its bbox. */
function supportCenterX(occupancy, width, bounds, fallback) {
  const band = Math.max(2, Math.floor(bounds.height * 0.12));
  const startY = Math.max(bounds.minY, bounds.maxY - band + 1);
  const rowCenters = [];
  for (let y = startY; y <= bounds.maxY; y++) {
    const row = y * width;
    let left = width;
    let right = -1;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!occupancy[row + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (right >= left) rowCenters.push((left + right) * 0.5);
  }
  return median(rowCenters, fallback);
}

function calibrateSourceView(view) {
  const frameBounds = robustOccupancyBounds(view.occupancy, view.width, view.height);
  const fallbackCenter = trunkBaseX(
    view.occupancy,
    view.width,
    view.height,
    frameBounds,
  );
  const inferredCenter = supportCenterX(
    view.occupancy,
    view.width,
    frameBounds,
    fallbackCenter,
  );
  const cameraCenterX = view.cameraCenterExplicit
    ? boundedPixel(finite(view.cameraCenterX, inferredCenter), view.width)
    : inferredCenter;
  const supportY = view.supportExplicit
    ? boundedPixel(finite(view.supportY, frameBounds.maxY), view.height)
    : frameBounds.maxY;
  const topY = frameBounds.minY;
  const subjectPixelsPerUnit = Math.max(1, supportY - topY);
  const maxCamX = Math.max(
    Math.abs(frameBounds.minX - cameraCenterX),
    Math.abs(frameBounds.maxX - cameraCenterX),
  ) / subjectPixelsPerUnit;
  return {
    ...view,
    bounds: frameBounds,
    frameBounds,
    cameraCenterX,
    supportY,
    subjectPixelsPerUnit,
    pixelsPerUnitX: subjectPixelsPerUnit,
    pixelsPerUnitY: subjectPixelsPerUnit,
    // Compatibility aliases for existing callers outside the reconstruction path.
    trunkBaseX: cameraCenterX,
    worldPerPixel: 1 / subjectPixelsPerUnit,
    maxCamX,
  };
}

export function keyedViewFromRgba(rgba, width, height, meta = {}) {
  const imageData = {
    width,
    height,
    data: rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba),
  };
  keyImageData(imageData);
  despillImageData(imageData);
  const occupancy = occupancyFromRgba(imageData.data, width, height);
  const bounds = alphaBounds(imageData);
  const baseX = trunkBaseX(occupancy, width, height, bounds);
  const subjectPixelsPerUnit = Math.max(1, bounds.height - 1);
  const basis = cameraBasis(meta.yaw ?? 0);
  const cameraCenterExplicit = meta.cameraCenterX !== null
    && meta.cameraCenterX !== undefined
    && Number.isFinite(Number(meta.cameraCenterX));
  const supportExplicit = meta.supportY !== null
    && meta.supportY !== undefined
    && Number.isFinite(Number(meta.supportY));
  const cameraCenterX = cameraCenterExplicit ? Number(meta.cameraCenterX) : baseX;
  const supportY = supportExplicit ? Number(meta.supportY) : bounds.maxY;
  const maxCamX = Math.max(
    Math.abs(bounds.minX - cameraCenterX),
    Math.abs(bounds.maxX - cameraCenterX),
  ) / subjectPixelsPerUnit;
  return {
    ...meta,
    width,
    height,
    data: imageData.data,
    occupancy,
    alphaBounds: bounds,
    bounds,
    cameraCenterExplicit,
    supportExplicit,
    cameraCenterX,
    supportY,
    subjectPixelsPerUnit,
    pixelsPerUnitX: subjectPixelsPerUnit,
    pixelsPerUnitY: subjectPixelsPerUnit,
    trunkBaseX: cameraCenterX,
    worldPerPixel: 1 / subjectPixelsPerUnit,
    basis,
    maxCamX,
  };
}

function occupancyIntegral(occupancy, width, height) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const sourceRow = y * width;
    const outputRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x++) {
      rowSum += occupancy[sourceRow + x];
      integral[outputRow + x + 1] = integral[previousRow + x + 1] + rowSum;
    }
  }
  return { integral, stride };
}

function rectangleSum(table, width, height, x0, y0, x1, y1) {
  const left = Math.max(0, Math.min(width - 1, x0));
  const top = Math.max(0, Math.min(height - 1, y0));
  const right = Math.max(0, Math.min(width - 1, x1));
  const bottom = Math.max(0, Math.min(height - 1, y1));
  if (right < left || bottom < top) return { filled: 0, area: 0 };
  const { integral, stride } = table;
  const ax = left;
  const ay = top;
  const bx = right + 1;
  const by = bottom + 1;
  const filled = integral[by * stride + bx]
    - integral[ay * stride + bx]
    - integral[by * stride + ax]
    + integral[ay * stride + ax];
  return { filled, area: (right - left + 1) * (bottom - top + 1) };
}

function canonicalFrame(views, size, padding) {
  const extent = Math.max(8, Math.trunc(size));
  const pad = Math.max(1, Math.min(Math.floor((extent - 2) * 0.2), Math.trunc(padding)));
  const centerX = (extent - 1) * 0.5;
  const supportY = extent - 1 - pad;
  const maxCamX = views.reduce((maximum, view) => Math.max(maximum, view.maxCamX), 0.5);
  const verticalPixels = Math.max(1, supportY - pad);
  const horizontalPixels = Math.max(1, centerX - pad) / Math.max(1e-6, maxCamX);
  const pixelsPerUnit = Math.max(0.25, Math.min(verticalPixels, horizontalPixels));
  return { size: extent, padding: pad, centerX, supportY, pixelsPerUnit, maxCamX };
}

function resampleCalibratedView(view, frame) {
  const size = frame.size;
  const occupancy = new Uint8Array(size * size);
  const table = occupancyIntegral(view.occupancy, view.width, view.height);
  const sourcePixelsPerTarget = view.subjectPixelsPerUnit / frame.pixelsPerUnit;
  const halfFootprint = Math.max(0.5, sourcePixelsPerTarget * 0.5);
  for (let y = 0; y < size; y++) {
    const worldY = (frame.supportY - y) / frame.pixelsPerUnit;
    const sourceY = view.supportY - view.subjectPixelsPerUnit * worldY;
    for (let x = 0; x < size; x++) {
      const projectedX = (x - frame.centerX) / frame.pixelsPerUnit;
      const sourceX = view.cameraCenterX + view.subjectPixelsPerUnit * projectedX;
      if (sourceX < -0.5 || sourceY < -0.5 || sourceX > view.width - 0.5 || sourceY > view.height - 0.5) {
        continue;
      }
      const nearestX = Math.min(view.width - 1, Math.max(0, Math.round(sourceX)));
      const nearestY = Math.min(view.height - 1, Math.max(0, Math.round(sourceY)));
      let hit = view.occupancy[nearestY * view.width + nearestX] === 1;
      if (!hit && sourcePixelsPerTarget > 1.25) {
        const sample = rectangleSum(
          table,
          view.width,
          view.height,
          Math.floor(sourceX - halfFootprint),
          Math.floor(sourceY - halfFootprint),
          Math.ceil(sourceX + halfFootprint),
          Math.ceil(sourceY + halfFootprint),
        );
        hit = sample.area > 0 && sample.filled / sample.area >= 0.12;
      }
      if (hit) occupancy[y * size + x] = 1;
    }
  }
  const bounds = exactOccupancyBounds(occupancy, size, size);
  const sourceScale = view.subjectPixelsPerUnit / frame.pixelsPerUnit;
  return {
    ...view,
    width: size,
    height: size,
    data: null,
    occupancy,
    bounds,
    frameBounds: bounds,
    cameraCenterX: frame.centerX,
    supportY: frame.supportY,
    subjectPixelsPerUnit: frame.pixelsPerUnit,
    pixelsPerUnitX: frame.pixelsPerUnit,
    pixelsPerUnitY: frame.pixelsPerUnit,
    trunkBaseX: frame.centerX,
    worldPerPixel: 1 / frame.pixelsPerUnit,
    maxCamX: view.maxCamX,
    colorView: view,
    sourceFromPixel: {
      scaleX: sourceScale,
      scaleY: sourceScale,
      offsetX: view.cameraCenterX - sourceScale * frame.centerX,
      offsetY: view.supportY - sourceScale * frame.supportY,
    },
  };
}

function dilateMask(mask, width, height) {
  const output = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          output[ny * width + nx] = 1;
        }
      }
    }
  }
  return output;
}

function mirroredMask(view) {
  const mirrored = new Uint8Array(view.occupancy.length);
  for (let y = 0; y < view.height; y++) {
    for (let x = 0; x < view.width; x++) {
      mirrored[y * view.width + x] = view.occupancy[y * view.width + (view.width - 1 - x)];
    }
  }
  return mirrored;
}

function maskIoU(left, right) {
  let intersection = 0;
  let union = 0;
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i++) {
    const a = left[i] ? 1 : 0;
    const b = right[i] ? 1 : 0;
    intersection += a & b;
    union += a | b;
  }
  return union ? intersection / union : 1;
}

function normalizedYaw(yaw) {
  const value = finite(yaw, 0) % 360;
  return value < 0 ? value + 360 : value;
}

function angularDelta(left, right) {
  const direct = Math.abs(normalizedYaw(left) - normalizedYaw(right));
  return Math.min(direct, 360 - direct);
}

function oppositePairs(views) {
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < views.length; i++) {
    if (used.has(i)) continue;
    const target = normalizedYaw((views[i].yaw ?? 0) + 180);
    let match = -1;
    let best = Infinity;
    for (let j = i + 1; j < views.length; j++) {
      if (used.has(j)) continue;
      const delta = angularDelta(views[j].yaw ?? 0, target);
      if (delta < best) {
        best = delta;
        match = j;
      }
    }
    if (match < 0 || best > 1) continue;
    used.add(i);
    used.add(match);
    pairs.push([i, match]);
  }
  return pairs;
}

function orbitFrameReport(sourceViews, workingViews, limits) {
  const reasons = [];
  const views = sourceViews.map(view => {
    const exact = view.alphaBounds ?? exactOccupancyBounds(view.occupancy, view.width, view.height);
    const imageHeight = Math.max(1, view.height - 1);
    const imageWidth = Math.max(1, view.width - 1);
    const borderMargin = Math.max(0, Math.trunc(limits.borderMargin));
    return {
      yaw: normalizedYaw(view.yaw ?? 0),
      file: view.file,
      empty: !(exact.filled ?? view.frameBounds?.filled ?? 0),
      clipped: exact.minX <= borderMargin
        || exact.minY <= borderMargin
        || exact.maxX >= view.width - 1 - borderMargin
        || exact.maxY >= view.height - 1 - borderMargin,
      heightFraction: view.subjectPixelsPerUnit / imageHeight,
      supportFraction: view.supportY / imageHeight,
      centerFraction: view.cameraCenterX / imageWidth,
      normalizedWidth: view.frameBounds.width / view.subjectPixelsPerUnit,
    };
  });
  const nonEmpty = views.filter(view => !view.empty);
  const heightFractions = nonEmpty.map(view => view.heightFraction).filter(value => value > 0);
  const supportFractions = nonEmpty.map(view => view.supportFraction);
  const centerFractions = nonEmpty.map(view => view.centerFraction);
  const scaleRatio = heightFractions.length
    ? Math.max(...heightFractions) / Math.max(1e-6, Math.min(...heightFractions))
    : Infinity;
  const supportDrift = supportFractions.length
    ? Math.max(...supportFractions) - Math.min(...supportFractions)
    : Infinity;
  const centerDrift = centerFractions.length
    ? Math.max(...centerFractions) - Math.min(...centerFractions)
    : Infinity;
  const clippedViews = views.filter(view => view.clipped).map(view => view.yaw);
  const emptyViews = views.filter(view => view.empty).map(view => view.yaw);
  if (emptyViews.length) reasons.push(`empty silhouette yaw ${emptyViews.join("/")}`);
  if (clippedViews.length) reasons.push(`border clipping yaw ${clippedViews.join("/")}`);
  if (scaleRatio > limits.maxScaleRatio) {
    reasons.push(`frame scale ratio ${scaleRatio.toFixed(3)} > ${limits.maxScaleRatio.toFixed(3)}`);
  }
  if (supportDrift > limits.maxSupportDrift) {
    reasons.push(`support drift ${supportDrift.toFixed(3)} > ${limits.maxSupportDrift.toFixed(3)}`);
  }
  if (centerDrift > limits.maxCenterDrift) {
    reasons.push(`pivot drift ${centerDrift.toFixed(3)} > ${limits.maxCenterDrift.toFixed(3)}`);
  }

  const pairs = oppositePairs(sourceViews).map(([leftIndex, rightIndex]) => {
    const left = workingViews[leftIndex];
    const right = workingViews[rightIndex];
    const mirrored = dilateMask(mirroredMask(right), right.width, right.height);
    const leftDilated = dilateMask(left.occupancy, left.width, left.height);
    const mirrorIoU = maskIoU(leftDilated, mirrored);
    const leftWidth = views[leftIndex].normalizedWidth;
    const rightWidth = views[rightIndex].normalizedWidth;
    const widthDelta = Math.abs(leftWidth - rightWidth) / Math.max(1e-6, leftWidth, rightWidth);
    return {
      yaws: [views[leftIndex].yaw, views[rightIndex].yaw],
      mirrorIoU,
      widthDelta,
    };
  });
  const minOppositeMirrorIoU = pairs.length
    ? Math.min(...pairs.map(pair => pair.mirrorIoU))
    : null;
  const maxOppositeWidthDelta = pairs.length
    ? Math.max(...pairs.map(pair => pair.widthDelta))
    : null;
  const worstMirror = pairs.reduce(
    (worst, pair) => !worst || pair.mirrorIoU < worst.mirrorIoU ? pair : worst,
    null,
  );
  const worstWidth = pairs.reduce(
    (worst, pair) => !worst || pair.widthDelta > worst.widthDelta ? pair : worst,
    null,
  );
  if (worstMirror && worstMirror.mirrorIoU < limits.minOppositeMirrorIoU) {
    reasons.push(
      `opposite ${worstMirror.yaws.join("/")} mirror IoU ${worstMirror.mirrorIoU.toFixed(3)} < ${limits.minOppositeMirrorIoU.toFixed(3)}`,
    );
  }
  if (worstWidth && worstWidth.widthDelta > limits.maxOppositeWidthDelta) {
    reasons.push(
      `opposite ${worstWidth.yaws.join("/")} width delta ${worstWidth.widthDelta.toFixed(3)} > ${limits.maxOppositeWidthDelta.toFixed(3)}`,
    );
  }
  return {
    ok: reasons.length === 0,
    reasons,
    limits,
    scaleRatio,
    supportDrift,
    centerDrift,
    minOppositeMirrorIoU,
    maxOppositeWidthDelta,
    clippedViews,
    emptyViews,
    pairs,
    views,
  };
}

/**
 * Build a shared orthographic frame without fitting each yaw's width. Every
 * source view uses its own height-derived uniform scale; the canonical frame
 * uses one center, support baseline, and pixels-per-unit for the whole orbit.
 */
export function normalizeOrbitViews(views, size, options = {}) {
  const sourceViews = views.map(calibrateSourceView);
  const padding = options.padding ?? Math.max(2, Math.round(size * 0.03));
  const frame = canonicalFrame(sourceViews, size, padding);
  const workingViews = sourceViews.map(view => resampleCalibratedView(view, frame));
  const limits = Object.freeze({
    ...DEFAULT_ORBIT_FRAME_LIMITS,
    ...(options.limits ?? {}),
  });
  const report = orbitFrameReport(sourceViews, workingViews, limits);
  return { sourceViews, workingViews, frame, report };
}

/** Compatibility helper for callers that resize a single view. */
export function resizeView(view, size) {
  return normalizeOrbitViews([view], size).workingViews[0];
}

function bilinearRgb(source, x, y) {
  if (!source.data) return null;
  const width = source.width;
  const height = source.height;
  if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) return null;
  const x0 = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const sample = (ix, iy) => {
    const index = (iy * width + ix) * 4;
    if (source.data[index + 3] <= 12) return null;
    return [source.data[index], source.data[index + 1], source.data[index + 2]];
  };
  const c00 = sample(x0, y0);
  const c10 = sample(x1, y0);
  const c01 = sample(x0, y1);
  const c11 = sample(x1, y1);
  if (!c00 && !c10 && !c01 && !c11) return null;
  const mix = (a, b, t) => {
    if (!a) return b;
    if (!b) return a;
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  };
  return mix(mix(c00, c10, tx), mix(c01, c11, tx), ty);
}

export function sampleView(view, u, v) {
  return sampleViewAtPixel(
    view,
    u * Math.max(1, view.width - 1),
    v * Math.max(1, view.height - 1),
  );
}

export function sampleViewAtPixel(view, pixelX, pixelY) {
  const source = view.colorView ?? view;
  if (!source.data) return null;
  if (view.sourceFromPixel) {
    const transform = view.sourceFromPixel;
    return bilinearRgb(
      source,
      pixelX * transform.scaleX + transform.offsetX,
      pixelY * transform.scaleY + transform.offsetY,
    );
  }
  if (source !== view) {
    const sx = (pixelX + 0.5) * source.width / view.width - 0.5;
    const sy = (pixelY + 0.5) * source.height / view.height - 0.5;
    return bilinearRgb(source, sx, sy);
  }
  return bilinearRgb(source, pixelX, pixelY);
}

export function viewDepth(x, y, z, view) {
  return x * -view.basis.forward[0] + z * -view.basis.forward[2];
}

export function worldToPixel(view, x, y, z) {
  const projectedX = x * view.basis.right[0] + z * view.basis.right[2];
  const centerX = finite(view.cameraCenterX, finite(view.trunkBaseX, 0));
  const supportY = finite(view.supportY, view.bounds?.maxY ?? 0);
  const pixelsPerUnitX = finite(
    view.pixelsPerUnitX,
    1 / Math.max(1e-6, finite(view.worldPerPixel, 1)),
  );
  const pixelsPerUnitY = finite(
    view.pixelsPerUnitY,
    1 / Math.max(1e-6, finite(view.worldPerPixel, 1)),
  );
  return {
    x: centerX + projectedX * pixelsPerUnitX,
    y: supportY - y * pixelsPerUnitY,
  };
}

export function pixelToView(view, pixelX, pixelY) {
  const centerX = finite(view.cameraCenterX, finite(view.trunkBaseX, 0));
  const supportY = finite(view.supportY, view.bounds?.maxY ?? 0);
  const pixelsPerUnitX = finite(
    view.pixelsPerUnitX,
    1 / Math.max(1e-6, finite(view.worldPerPixel, 1)),
  );
  const pixelsPerUnitY = finite(
    view.pixelsPerUnitY,
    1 / Math.max(1e-6, finite(view.worldPerPixel, 1)),
  );
  return {
    x: (pixelX - centerX) / Math.max(1e-6, pixelsPerUnitX),
    y: (supportY - pixelY) / Math.max(1e-6, pixelsPerUnitY),
  };
}

export function pixelInSilhouette(view, pixelX, pixelY) {
  const x = Math.round(pixelX);
  const y = Math.round(pixelY);
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return false;
  return view.occupancy[y * view.width + x] === 1;
}

export function silhouetteRadius(views, pad = 1.08) {
  let radius = 0.35;
  for (const view of views) radius = Math.max(radius, view.maxCamX);
  return radius * pad;
}
