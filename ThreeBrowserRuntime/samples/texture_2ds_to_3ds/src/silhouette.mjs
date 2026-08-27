import {
  alphaBounds,
  despillImageData,
  downsampleOccupancy,
  keyImageData,
  occupancyFromRgba,
  trunkBaseX,
} from "./chroma-key.mjs";
import { cameraBasis } from "./views.mjs";

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
  const worldPerPixel = 1 / Math.max(1, bounds.height);
  const basis = cameraBasis(meta.yaw ?? 0);
  const maxCamX = Math.max(
    Math.abs((bounds.minX - baseX) * worldPerPixel),
    Math.abs((bounds.maxX - baseX) * worldPerPixel),
  );
  return {
    ...meta,
    width,
    height,
    data: imageData.data,
    occupancy,
    bounds,
    trunkBaseX: baseX,
    worldPerPixel,
    basis,
    maxCamX,
  };
}

export function resizeView(view, size) {
  const occupancy = downsampleOccupancy(
    view.occupancy,
    view.width,
    view.height,
    size,
    size,
  );
  const scaleX = size / view.width;
  const scaleY = size / view.height;
  const bounds = {
    minX: Math.max(0, Math.floor(view.bounds.minX * scaleX)),
    minY: Math.max(0, Math.floor(view.bounds.minY * scaleY)),
    maxX: Math.min(size - 1, Math.ceil(view.bounds.maxX * scaleX)),
    maxY: Math.min(size - 1, Math.ceil(view.bounds.maxY * scaleY)),
  };
  bounds.width = bounds.maxX - bounds.minX + 1;
  bounds.height = bounds.maxY - bounds.minY + 1;
  const trunk = view.trunkBaseX * scaleX;
  const worldPerPixel = 1 / Math.max(1, bounds.height);
  return {
    ...view,
    width: size,
    height: size,
    occupancy,
    bounds,
    trunkBaseX: trunk,
    worldPerPixel,
    maxCamX: Math.max(
      Math.abs((bounds.minX - trunk) * worldPerPixel),
      Math.abs((bounds.maxX - trunk) * worldPerPixel),
    ),
    data: null,
    colorView: view,
  };
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
  const source = view.colorView ?? view;
  if (!source.data) return null;
  return bilinearRgb(source, u * (source.width - 1), v * (source.height - 1));
}

export function sampleViewAtPixel(view, pixelX, pixelY) {
  const source = view.colorView ?? view;
  if (!source.data) return null;
  const sx = (pixelX + 0.5) * source.width / view.width - 0.5;
  const sy = (pixelY + 0.5) * source.height / view.height - 0.5;
  return bilinearRgb(source, sx, sy);
}

export function viewDepth(x, y, z, view) {
  return x * -view.basis.forward[0] + z * -view.basis.forward[2];
}

export function worldToPixel(view, x, y, z) {
  const projected = {
    x: x * view.basis.right[0] + z * view.basis.right[2],
    y,
  };
  const pixelX = view.trunkBaseX + projected.x / view.worldPerPixel;
  const pixelY = view.bounds.maxY - projected.y / view.worldPerPixel;
  return { x: pixelX, y: pixelY };
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
