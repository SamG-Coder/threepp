import { sampleView, worldToPixel } from "./silhouette.mjs";
import { occupancyGradient, voxelCenter, voxelIndex } from "./visual-hull.mjs";

export function bakeVoxelColors(volume, views) {
  const { occupancy, resolution } = volume;
  const colors = new Uint8Array(occupancy.length * 3);
  const accum = new Float32Array(occupancy.length * 3);
  const weights = new Float32Array(occupancy.length);
  for (const view of views) {
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const index = voxelIndex(x, y, z, resolution);
          if (!occupancy[index]) continue;
          const center = voxelCenter(x, y, z, volume);
          const pixel = worldToPixel(view, center[0], center[1], center[2]);
          const u = pixel.x / Math.max(1, view.width - 1);
          const v = pixel.y / Math.max(1, view.height - 1);
          if (u < 0 || v < 0 || u > 1 || v > 1) continue;
          const rgb = sampleView(view, u, v);
          if (!rgb) continue;
          const facing = Math.max(
            0.08,
            view.basis.position[0] * center[0] + view.basis.position[2] * center[2] + 0.35,
          );
          const offset = index * 3;
          accum[offset] += rgb[0] * facing;
          accum[offset + 1] += rgb[1] * facing;
          accum[offset + 2] += rgb[2] * facing;
          weights[index] += facing;
        }
      }
    }
  }

  for (let i = 0; i < occupancy.length; i++) {
    if (!occupancy[i]) continue;
    const offset = i * 3;
    const weight = weights[i];
    if (weight > 0) {
      colors[offset] = Math.min(255, Math.round(accum[offset] / weight));
      colors[offset + 1] = Math.min(255, Math.round(accum[offset + 1] / weight));
      colors[offset + 2] = Math.min(255, Math.round(accum[offset + 2] / weight));
    } else {
      colors[offset] = 58;
      colors[offset + 1] = 74;
      colors[offset + 2] = 42;
    }
  }

  volume.colors = colors;
  return volume;
}

export function voxelRgb(volume, x, y, z) {
  const index = voxelIndex(x, y, z, volume.resolution) * 3;
  return [volume.colors[index], volume.colors[index + 1], volume.colors[index + 2]];
}

export function voxelNormal(volume, x, y, z) {
  const gradient = occupancyGradient(volume, x, y, z);
  const length = Math.hypot(gradient[0], gradient[1], gradient[2]) || 1;
  return [gradient[0] / length, gradient[1] / length, gradient[2] / length];
}
