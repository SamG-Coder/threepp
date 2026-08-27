import { sampleViewAtPixel, viewDepth, worldToPixel } from "./silhouette.mjs";
import {
  keepGroundConnected,
  occupiedCount,
  voxelCenter,
  voxelIndex,
} from "./visual-hull.mjs";

function pixelIndex(view, pixelX, pixelY) {
  const x = Math.round(pixelX);
  const y = Math.round(pixelY);
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return -1;
  if (!view.occupancy[y * view.width + x]) return -1;
  return y * view.width + x;
}

export function buildViewFronts(volume, views) {
  const { occupancy, resolution } = volume;
  return views.map(view => {
    const pixels = view.width * view.height;
    const frontDepth = new Float32Array(pixels);
    const count = new Uint16Array(pixels);
    frontDepth.fill(-Infinity);
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          if (!occupancy[voxelIndex(x, y, z, resolution)]) continue;
          const center = voxelCenter(x, y, z, volume);
          const pixel = worldToPixel(view, center[0], center[1], center[2]);
          const index = pixelIndex(view, pixel.x, pixel.y);
          if (index < 0) continue;
          count[index] += 1;
          const depth = viewDepth(center[0], center[1], center[2], view);
          if (depth > frontDepth[index]) frontDepth[index] = depth;
        }
      }
    }
    return { frontDepth, count };
  });
}

function colorSpread(colors) {
  if (colors.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const dr = colors[i][0] - colors[j][0];
      const dg = colors[i][1] - colors[j][1];
      const db = colors[i][2] - colors[j][2];
      max = Math.max(max, Math.hypot(dr, dg, db));
    }
  }
  return max;
}

export function carvePhotoconsistent(volume, views, options = {}) {
  const iterations = options.iterations ?? 5;
  const threshold = options.threshold ?? 96;
  const { occupancy, resolution } = volume;
  const startFilled = occupiedCount(occupancy);
  const backup = Uint8Array.from(occupancy);
  let carved = 0;

  for (let pass = 0; pass < iterations; pass++) {
    const fronts = buildViewFronts(volume, views);
    const ranked = [];
    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const index = voxelIndex(x, y, z, resolution);
          if (!occupancy[index]) continue;
          const center = voxelCenter(x, y, z, volume);
          if (center[1] < 0.22 && Math.hypot(center[0], center[2]) < volume.radius * 0.22) {
            continue;
          }
          const colors = [];
          let uniqueWitness = false;
          let visible = false;
          for (let v = 0; v < views.length; v++) {
            const view = views[v];
            const pixel = worldToPixel(view, center[0], center[1], center[2]);
            const pix = pixelIndex(view, pixel.x, pixel.y);
            if (pix < 0) continue;
            if (fronts[v].count[pix] <= 1) uniqueWitness = true;
            const depth = viewDepth(center[0], center[1], center[2], view);
            if (depth + 0.015 >= fronts[v].frontDepth[pix]) {
              visible = true;
              const rgb = sampleViewAtPixel(view, pixel.x, pixel.y);
              if (rgb) colors.push(rgb);
            }
          }
          if (uniqueWitness || !visible || colors.length < 3) continue;
          const spread = colorSpread(colors);
          if (spread >= threshold) ranked.push({ index, spread });
        }
      }
    }
    if (!ranked.length) break;
    ranked.sort((a, b) => b.spread - a.spread);
    const cap = Math.max(8, Math.floor(occupiedCount(occupancy) * 0.08));
    const doomed = ranked.slice(0, cap);
    for (const item of doomed) occupancy[item.index] = 0;
    carved += doomed.length;
  }

  keepGroundConnected(occupancy, resolution);
  volume.filled = occupiedCount(occupancy);
  if (volume.filled < startFilled * 0.4) {
    occupancy.set(backup);
    volume.filled = startFilled;
    carved = 0;
  }
  volume.photoCarved = carved;
  return volume;
}
