import { voxelCenter, voxelIndex } from "./visual-hull.mjs";
import { worldToPixel } from "./silhouette.mjs";

export function reprojectSlice(volume, view) {
  const predicted = new Uint8Array(view.width * view.height);
  const { occupancy, resolution } = volume;
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        if (!occupancy[voxelIndex(x, y, z, resolution)]) continue;
        const center = voxelCenter(x, y, z, volume);
        const pixel = worldToPixel(view, center[0], center[1], center[2]);
        const px = Math.round(pixel.x);
        const py = Math.round(pixel.y);
        if (px < 0 || py < 0 || px >= view.width || py >= view.height) continue;
        predicted[py * view.width + px] = 1;
      }
    }
  }
  return predicted;
}

export function dilateOccupancy(occupancy, width, height, radius = 1) {
  if (radius <= 0) return occupancy;
  const output = new Uint8Array(occupancy);
  const extent = Math.trunc(radius);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!occupancy[y * width + x]) continue;
      for (let dy = -extent; dy <= extent; dy++) {
        for (let dx = -extent; dx <= extent; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          output[ny * width + nx] = 1;
        }
      }
    }
  }
  return output;
}

export function occupancyIoU(predicted, expected) {
  let intersection = 0;
  let union = 0;
  const length = Math.min(predicted.length, expected.length);
  for (let i = 0; i < length; i++) {
    const a = predicted[i] ? 1 : 0;
    const b = expected[i] ? 1 : 0;
    intersection += a & b;
    union += a | b;
  }
  if (union === 0) return 1;
  return intersection / union;
}

export function matchViewSlice(volume, view, options = {}) {
  const predicted = reprojectSlice(volume, view);
  const radius = options.dilate ?? 1;
  const grown = dilateOccupancy(predicted, view.width, view.height, radius);
  const iou = occupancyIoU(grown, view.occupancy);
  const coverage = occupancyIoU(view.occupancy, grown);
  return {
    yaw: view.yaw,
    label: view.label,
    iou,
    coverage,
    predicted,
  };
}

export function matchAllSlices(volume, views, options = {}) {
  const matches = views.map(view => matchViewSlice(volume, view, options));
  const meanIoU = matches.reduce((sum, match) => sum + match.iou, 0) / Math.max(1, matches.length);
  const minIoU = matches.reduce((min, match) => Math.min(min, match.iou), 1);
  return { matches, meanIoU, minIoU };
}
