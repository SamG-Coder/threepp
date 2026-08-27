import { pixelInSilhouette, silhouetteRadius, worldToPixel } from "./silhouette.mjs";

export const DEFAULT_RESOLUTION = 96;

export function voxelIndex(x, y, z, resolution) {
  return x + y * resolution + z * resolution * resolution;
}

export function voxelCenter(x, y, z, volume) {
  const { min, size, resolution } = volume;
  return [
    min[0] + (x + 0.5) / resolution * size[0],
    min[1] + (y + 0.5) / resolution * size[1],
    min[2] + (z + 0.5) / resolution * size[2],
  ];
}

export function occupiedCount(occupancy) {
  let count = 0;
  for (let i = 0; i < occupancy.length; i++) count += occupancy[i];
  return count;
}

function carveView(volume, view) {
  const { occupancy, resolution } = volume;
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const index = voxelIndex(x, y, z, resolution);
        if (!occupancy[index]) continue;
        const center = voxelCenter(x, y, z, volume);
        const pixel = worldToPixel(view, center[0], center[1], center[2]);
        if (!pixelInSilhouette(view, pixel.x, pixel.y)) occupancy[index] = 0;
      }
    }
  }
}

function lowestOccupiedY(occupancy, resolution) {
  for (let y = 0; y < resolution; y++) {
    const row = y * resolution;
    for (let z = 0; z < resolution; z++) {
      const slab = row + z * resolution * resolution;
      for (let x = 0; x < resolution; x++) {
        if (occupancy[slab + x]) return y;
      }
    }
  }
  return -1;
}

export function keepGroundConnected(occupancy, resolution) {
  const startY = lowestOccupiedY(occupancy, resolution);
  if (startY < 0) return occupancy;
  const total = occupancy.length;
  const keep = new Uint8Array(total);
  const stack = [];
  const tryPush = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= resolution || y >= resolution || z >= resolution) {
      return;
    }
    const index = voxelIndex(x, y, z, resolution);
    if (!occupancy[index] || keep[index]) return;
    keep[index] = 1;
    stack.push(x, y, z);
  };

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      tryPush(x, startY, z);
    }
  }

  while (stack.length) {
    const z = stack.pop();
    const y = stack.pop();
    const x = stack.pop();
    tryPush(x - 1, y, z);
    tryPush(x + 1, y, z);
    tryPush(x, y - 1, z);
    tryPush(x, y + 1, z);
    tryPush(x, y, z - 1);
    tryPush(x, y, z + 1);
  }

  occupancy.set(keep);
  return occupancy;
}

export function carveVisualHull(views, options = {}) {
  const resolution = Math.max(8, Math.trunc(options.resolution ?? DEFAULT_RESOLUTION));
  const radius = options.radius ?? silhouetteRadius(views);
  const min = [-radius, 0, -radius];
  const max = [radius, 1, radius];
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const occupancy = new Uint8Array(resolution * resolution * resolution);
  occupancy.fill(1);
  const volume = { occupancy, resolution, min, max, size, radius };
  for (const view of views) carveView(volume, view);
  if (options.groundConnected !== false) keepGroundConnected(occupancy, resolution);
  volume.filled = occupiedCount(occupancy);
  return volume;
}

export function isSurfaceVoxel(occupancy, resolution, x, y, z) {
  if (!occupancy[voxelIndex(x, y, z, resolution)]) return false;
  if (x === 0 || y === 0 || z === 0) return true;
  if (x === resolution - 1 || y === resolution - 1 || z === resolution - 1) return true;
  return !(
    occupancy[voxelIndex(x - 1, y, z, resolution)]
    && occupancy[voxelIndex(x + 1, y, z, resolution)]
    && occupancy[voxelIndex(x, y - 1, z, resolution)]
    && occupancy[voxelIndex(x, y + 1, z, resolution)]
    && occupancy[voxelIndex(x, y, z - 1, resolution)]
    && occupancy[voxelIndex(x, y, z + 1, resolution)]
  );
}

export function occupancyGradient(volume, x, y, z) {
  const { occupancy, resolution } = volume;
  const sample = (ix, iy, iz) => occupancy[voxelIndex(
    Math.min(resolution - 1, Math.max(0, ix)),
    Math.min(resolution - 1, Math.max(0, iy)),
    Math.min(resolution - 1, Math.max(0, iz)),
    resolution,
  )];
  return [
    sample(x - 1, y, z) - sample(x + 1, y, z),
    sample(x, y - 1, z) - sample(x, y + 1, z),
    sample(x, y, z - 1) - sample(x, y, z + 1),
  ];
}
