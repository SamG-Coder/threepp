import { occupiedCount, voxelCenter, voxelIndex } from "./visual-hull.mjs";

function occupiedExtents(volume) {
  const { occupancy, resolution } = volume;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        if (!occupancy[voxelIndex(x, y, z, resolution)]) continue;
        const center = voxelCenter(x, y, z, volume);
        if (center[0] < minX) minX = center[0];
        if (center[0] > maxX) maxX = center[0];
        if (center[1] < minY) minY = center[1];
        if (center[1] > maxY) maxY = center[1];
        if (center[2] < minZ) minZ = center[2];
        if (center[2] > maxZ) maxZ = center[2];
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return { radius: volume.radius ?? 0.3, minY: 0, maxY: 1, cx: 0, cz: 0 };
  }
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const radius = Math.min(maxX - minX, maxZ - minZ) * 0.5;
  return { radius, minY, maxY, cx, cz };
}

/**
 * Four (or two) silhouette cards of a cylinder make a square prism.
 * Snap occupancy to the inscribed cylinder or capsule.
 */
export function snapOccupancyToPrimitive(volume, shape) {
  const kind = shape?.kind;
  if (kind !== "cylinder" && kind !== "capsule") return volume;
  const { occupancy, resolution } = volume;
  const fit = occupiedExtents(volume);
  const radius = Math.max(1e-4, fit.radius);
  const height = Math.max(1e-4, fit.maxY - fit.minY);
  const cap = Math.min(radius, height * 0.5);
  const capsule = kind === "capsule";

  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const index = voxelIndex(x, y, z, resolution);
        if (!occupancy[index]) continue;
        const center = voxelCenter(x, y, z, volume);
        const dx = center[0] - fit.cx;
        const dz = center[2] - fit.cz;
        const radial = Math.hypot(dx, dz);
        if (!capsule) {
          if (radial > radius) occupancy[index] = 0;
          continue;
        }
        const localY = center[1] - fit.minY;
        if (localY < cap) {
          if (Math.hypot(dx, localY - cap, dz) > radius) occupancy[index] = 0;
        } else if (localY > height - cap) {
          if (Math.hypot(dx, localY - (height - cap), dz) > radius) occupancy[index] = 0;
        } else if (radial > radius) {
          occupancy[index] = 0;
        }
      }
    }
  }
  volume.filled = occupiedCount(occupancy);
  volume.primitiveFit = { ...fit, radius, kind };
  return volume;
}
