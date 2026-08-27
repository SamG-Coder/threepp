import { sampleViewAtPixel } from "./silhouette.mjs";
import { occupiedCount, voxelCenter, voxelIndex } from "./visual-hull.mjs";

function isFoliageRgb(r, g, b) {
  return g > r + 8 && g > b + 4 && g > 45;
}

function isBarkRgb(r, g, b) {
  return r > 40 && r >= g - 6 && g >= b - 8 && g < 140 && Math.abs(r - g) < 55;
}

export function estimateCanopyStart(views) {
  let start = 0.38;
  for (const view of views) {
    const { occupancy, width, bounds } = view;
    let trunkWidth = 1;
    const yBottom = bounds.maxY;
    const yTrunk = Math.max(bounds.minY, yBottom - Math.floor(bounds.height * 0.12));
    for (let y = yTrunk; y <= yBottom; y++) {
      let minX = width;
      let maxX = 0;
      const row = y * width;
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!occupancy[row + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      if (maxX >= minX) trunkWidth = Math.max(trunkWidth, maxX - minX + 1);
    }
    for (let y = yBottom; y >= bounds.minY; y--) {
      let minX = width;
      let maxX = 0;
      let green = 0;
      let count = 0;
      const row = y * width;
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!occupancy[row + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        const rgb = sampleViewAtPixel(view, x, y);
        if (rgb) {
          count += 1;
          if (isFoliageRgb(rgb[0], rgb[1], rgb[2])) green += 1;
        }
      }
      const span = maxX >= minX ? maxX - minX + 1 : 0;
      const foliage = count > 0 ? green / count : 0;
      if (span > trunkWidth * 2.05 && foliage > 0.35) {
        const worldY = (bounds.maxY - y) * view.worldPerPixel;
        start = Math.min(start, Math.max(0.18, worldY));
        break;
      }
    }
  }
  return start;
}

export function hollowCanopy(volume, canopyY, thickness = 2.4) {
  const { occupancy, resolution } = volume;
  const inf = 1e5;
  const dist = new Float32Array(occupancy.length);
  for (let i = 0; i < occupancy.length; i++) dist[i] = occupancy[i] ? inf : 0;

  const relax = (dx, dy, dz, w) => {
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= resolution || ny >= resolution || nz >= resolution) {
            continue;
          }
          const index = voxelIndex(x, y, z, resolution);
          const other = voxelIndex(nx, ny, nz, resolution);
          const candidate = dist[other] + w;
          if (candidate < dist[index]) dist[index] = candidate;
        }
      }
    }
  };
  relax(1, 0, 0, 1); relax(0, 1, 0, 1); relax(0, 0, 1, 1);
  relax(-1, 0, 0, 1); relax(0, -1, 0, 1); relax(0, 0, -1, 1);

  let carved = 0;
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const index = voxelIndex(x, y, z, resolution);
        if (!occupancy[index]) continue;
        const center = voxelCenter(x, y, z, volume);
        if (center[1] < canopyY) continue;
        if (dist[index] > thickness) {
          occupancy[index] = 0;
          carved += 1;
        }
      }
    }
  }
  volume.filled = occupiedCount(occupancy);
  volume.canopyY = canopyY;
  volume.canopyCarved = carved;
  return volume;
}

export function dilateOccupancy(occupancy, width, height) {
  const next = new Uint8Array(occupancy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!occupancy[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          next[ny * width + nx] = 1;
        }
      }
    }
  }
  return next;
}

export function barkOccupancy(view) {
  const occupancy = new Uint8Array(view.occupancy.length);
  const { width, height } = view;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!view.occupancy[index]) continue;
      const rgb = sampleViewAtPixel(view, x, y);
      if (!rgb) continue;
      if (isFoliageRgb(rgb[0], rgb[1], rgb[2])) continue;
      occupancy[index] = 1;
    }
  }
  return dilateOccupancy(occupancy, width, height);
}

export function barkOrFull(view) {
  const bark = barkOccupancy(view);
  let barkCount = 0;
  let fullCount = 0;
  for (let i = 0; i < bark.length; i++) {
    barkCount += bark[i];
    fullCount += view.occupancy[i];
  }
  if (fullCount > 0 && barkCount >= fullCount * 0.035) {
    return withOccupancy(view, bark);
  }
  return view;
}

export function foliageRgba(view) {
  const source = view.colorView ?? view;
  const data = new Uint8ClampedArray(source.data);
  const width = source.width;
  const height = source.height;
  const watermarkWidth = Math.max(1, Math.floor(width * 0.24));
  const watermarkHeight = Math.max(1, Math.floor(height * 0.075));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index + 3] <= 12) continue;
      if (x >= width - watermarkWidth && y >= height - watermarkHeight) {
        data[index + 3] = 0;
        continue;
      }
      if (!isFoliageRgb(data[index], data[index + 1], data[index + 2])) {
        data[index + 3] = 0;
      }
    }
  }
  return { data, width, height };
}

export function withOccupancy(view, occupancy) {
  return { ...view, occupancy };
}

export function nearestViewByAzimuth(x, z, views) {
  const azimuth = Math.atan2(x, z);
  let best = views[0];
  let bestDelta = Infinity;
  for (const view of views) {
    let delta = Math.abs(azimuth - view.basis.yaw);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = view;
    }
  }
  return best;
}

export { isFoliageRgb, isBarkRgb };
