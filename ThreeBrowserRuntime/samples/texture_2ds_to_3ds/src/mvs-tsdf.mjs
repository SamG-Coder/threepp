import { pixelToView, sampleViewAtPixel, viewDepth, worldToPixel } from "./silhouette.mjs";
import { unprojectView } from "./views.mjs";
import { keepGroundConnected, occupiedCount, voxelCenter, voxelIndex } from "./visual-hull.mjs";

function pixelToCamera(view, px, py) {
  return pixelToView(view, px, py);
}

function colorDistance(a, b) {
  if (!a || !b) return 90;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function insideVolume(volume, x, y, z) {
  const gx = (x - volume.min[0]) / volume.size[0] * volume.resolution;
  const gy = (y - volume.min[1]) / volume.size[1] * volume.resolution;
  const gz = (z - volume.min[2]) / volume.size[2] * volume.resolution;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const iz = Math.floor(gz);
  if (ix < 0 || iy < 0 || iz < 0) return false;
  if (ix >= volume.resolution || iy >= volume.resolution || iz >= volume.resolution) return false;
  return volume.occupancy[voxelIndex(ix, iy, iz, volume.resolution)] === 1;
}

export function estimateDepthMaps(volume, views, options = {}) {
  const steps = options.steps ?? 28;
  const maps = [];
  for (let index = 0; index < views.length; index++) {
    const view = views[index];
    const neighbors = [
      views[(index + 1) % views.length],
      views[(index + views.length - 1) % views.length],
    ];
    const depth = new Float32Array(view.width * view.height);
    depth.fill(Number.NaN);
    const near = volume.radius;
    const far = -volume.radius;
    for (let py = 0; py < view.height; py++) {
      for (let px = 0; px < view.width; px++) {
        if (!view.occupancy[py * view.width + px]) continue;
        const camera = pixelToCamera(view, px, py);
        const reference = sampleViewAtPixel(view, px, py);
        if (!reference) continue;
        let best = Infinity;
        let bestDepth = Number.NaN;
        for (let step = 0; step < steps; step++) {
          const t = step / Math.max(1, steps - 1);
          const d = near + (far - near) * t;
          const world = unprojectView(camera.x, camera.y, d, view.basis);
          if (!insideVolume(volume, world.x, world.y, world.z)) continue;
          let cost = 0;
          for (const neighbor of neighbors) {
            const pixel = worldToPixel(neighbor, world.x, world.y, world.z);
            const rgb = sampleViewAtPixel(neighbor, pixel.x, pixel.y);
            cost += colorDistance(reference, rgb);
          }
          cost = cost / neighbors.length + t * 6;
          if (cost < best) {
            best = cost;
            bestDepth = d;
          }
        }
        if (Number.isFinite(bestDepth)) depth[py * view.width + px] = bestDepth;
      }
    }
    maps.push(depth);
  }
  return maps;
}

export function chamferSignedDistance(volume) {
  const { occupancy, resolution, size } = volume;
  const inf = 1e6;
  const inside = new Float32Array(occupancy.length);
  const outside = new Float32Array(occupancy.length);
  for (let i = 0; i < occupancy.length; i++) {
    inside[i] = occupancy[i] ? inf : 0;
    outside[i] = occupancy[i] ? 0 : inf;
  }

  const step = (field, ax, ay, az, weight) => {
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const nx = x + ax;
          const ny = y + ay;
          const nz = z + az;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= resolution || ny >= resolution || nz >= resolution) {
            continue;
          }
          const index = voxelIndex(x, y, z, resolution);
          const other = voxelIndex(nx, ny, nz, resolution);
          const candidate = field[other] + weight;
          if (candidate < field[index]) field[index] = candidate;
        }
      }
    }
  };

  const passes = [
    [1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1],
    [1, 1, 0, 1.414], [1, 0, 1, 1.414], [0, 1, 1, 1.414],
    [1, 1, 1, 1.732],
  ];
  for (const field of [inside, outside]) {
    for (const [ax, ay, az, w] of passes) step(field, ax, ay, az, w);
    for (const [ax, ay, az, w] of passes) step(field, -ax, -ay, -az, w);
  }

  const voxel = Math.min(size[0], size[1], size[2]) / resolution;
  const sdf = new Float32Array(occupancy.length);
  for (let i = 0; i < occupancy.length; i++) {
    sdf[i] = occupancy[i] ? -inside[i] * voxel : outside[i] * voxel;
  }
  return sdf;
}

export function blurField(field, resolution) {
  const output = new Float32Array(field.length);
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        let sum = 0;
        let weight = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              if (nx < 0 || ny < 0 || nz < 0 || nx >= resolution || ny >= resolution || nz >= resolution) {
                continue;
              }
              const kernel = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
              sum += field[voxelIndex(nx, ny, nz, resolution)] * kernel;
              weight += kernel;
            }
          }
        }
        output[voxelIndex(x, y, z, resolution)] = sum / weight;
      }
    }
  }
  return output;
}

export function fuseDepthMaps(volume, views, depthMaps, sdf, options = {}) {
  const truncation = options.truncation ?? volume.size[1] / volume.resolution * 2.8;
  const { occupancy, resolution } = volume;
  const accum = Float32Array.from(sdf);
  const weights = new Float32Array(sdf.length);
  weights.fill(1);

  for (let v = 0; v < views.length; v++) {
    const view = views[v];
    const depths = depthMaps[v];
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const index = voxelIndex(x, y, z, resolution);
          const center = voxelCenter(x, y, z, volume);
          const pixel = worldToPixel(view, center[0], center[1], center[2]);
          const px = Math.round(pixel.x);
          const py = Math.round(pixel.y);
          if (px < 0 || py < 0 || px >= view.width || py >= view.height) continue;
          if (sdf[index] < -truncation) continue;
          const surface = depths[py * view.width + px];
          if (!Number.isFinite(surface)) continue;
          const observed = viewDepth(center[0], center[1], center[2], view) - surface;
          if (Math.abs(observed) > truncation) continue;
          const weight = occupancy[index] ? 1.35 : 0.85;
          accum[index] += observed * weight;
          weights[index] += weight;
        }
      }
    }
  }

  for (let i = 0; i < sdf.length; i++) sdf[i] = accum[i] / weights[i];
  return sdf;
}

export function occupancyFromSdf(volume, sdf) {
  const { occupancy, resolution } = volume;
  for (let i = 0; i < occupancy.length; i++) occupancy[i] = sdf[i] <= 0 ? 1 : 0;
  keepGroundConnected(occupancy, resolution);
  volume.filled = occupiedCount(occupancy);
  volume.sdf = sdf;
  return volume;
}
