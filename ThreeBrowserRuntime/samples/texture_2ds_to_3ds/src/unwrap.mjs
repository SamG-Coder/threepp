import { isSurfaceVoxel, occupancyGradient, voxelCenter } from "./visual-hull.mjs";
import { voxelRgb } from "./color-bake.mjs";
import { nearestViewByAzimuth } from "./structure.mjs";
import { worldToPixel } from "./silhouette.mjs";

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function wrap01(value) {
  let u = value;
  u -= Math.floor(u);
  return u;
}

function azimuthU(x, z) {
  return wrap01(Math.atan2(x, z) / (Math.PI * 2) + 0.5);
}

export function volumeUvBounds(volume) {
  const min = volume?.min ?? [-1, 0, -1];
  const max = volume?.max ?? [1, 1, 1];
  return {
    minX: min[0],
    minY: min[1],
    minZ: min[2],
    maxX: max[0],
    maxY: max[1],
    maxZ: max[2],
    radius: volume?.radius ?? Math.max(max[0] - min[0], max[2] - min[2]) * 0.5,
  };
}

function viewNearYaw(views, yaw) {
  if (!views?.length) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const view of views) {
    const delta = Math.abs((view.yaw ?? 0) - yaw);
    if (delta < bestDelta) {
      best = view;
      bestDelta = delta;
    }
  }
  return best;
}

function facingScore(x, z, view) {
  const position = view?.basis?.position;
  if (!position) return -Infinity;
  return x * position[0] + z * position[2];
}

function photoUv(view, x, y, z) {
  const pixel = worldToPixel(view, x, y, z);
  const source = view.colorView ?? view;
  const width = Math.max(1, source.width ?? view.width ?? 1);
  const height = Math.max(1, source.height ?? view.height ?? 1);
  return [
    clamp01(pixel.x / width),
    clamp01(1 - pixel.y / height),
  ];
}

function pickCylinderSides(views) {
  if (!views?.length) return null;
  const front = viewNearYaw(views, 0);
  const back = viewNearYaw(views, 180);
  if (front && back && front !== back) return [front, back];
  const side = viewNearYaw(views, 90);
  if (front && side && front !== side) return [front, side];
  if (views.length >= 2) return [views[0], views[1]];
  return null;
}

/**
 * Two UV islands: front still wraps one 180° half, back still wraps the other.
 */
export function cylinderUv(x, y, z, bounds = {}, options = {}) {
  const sides = pickCylinderSides(options.views);
  if (sides) {
    const frontScore = facingScore(x, z, sides[0]);
    const backScore = facingScore(x, z, sides[1]);
    const island = frontScore >= backScore ? 0 : 1;
    const local = photoUv(sides[island], x, y, z);
    return [island * 0.5 + local[0] * 0.5, local[1]];
  }
  const minY = bounds.minY ?? 0;
  const maxY = bounds.maxY ?? 1;
  return [azimuthU(x, z), clamp01((y - minY) / Math.max(1e-6, maxY - minY))];
}

export const cylindricalUv = cylinderUv;

export function capsuleUv(x, y, z, bounds = {}) {
  const minY = bounds.minY ?? 0;
  const maxY = bounds.maxY ?? 1;
  const height = Math.max(1e-6, maxY - minY);
  const radius = Math.max(1e-6, bounds.radius ?? (Math.hypot(x, z) || height * 0.25));
  const cap = Math.min(radius, height * 0.5);
  const shaft = Math.max(0, height - 2 * cap);
  const local = y - minY;
  let arc = 0;
  if (local < cap) {
    const t = clamp01(local / Math.max(1e-6, cap)) * 2 - 1;
    arc = Math.asin(Math.min(1, Math.max(-1, t))) + Math.PI / 2;
  } else if (local > cap + shaft) {
    const t = (local - cap - shaft) / Math.max(1e-6, cap);
    arc = Math.PI / 2 + shaft / cap + Math.asin(Math.min(1, Math.max(-1, t * 2 - 1)));
  } else {
    arc = Math.PI / 2 + (local - cap) / cap;
  }
  const total = Math.PI + shaft / cap;
  return [azimuthU(x, z), clamp01(arc / Math.max(1e-6, total))];
}

export function boxUv(x, y, z, normal = [0, 1, 0], bounds = {}) {
  const minX = bounds.minX ?? -1;
  const minY = bounds.minY ?? 0;
  const minZ = bounds.minZ ?? -1;
  const maxX = bounds.maxX ?? 1;
  const maxY = bounds.maxY ?? 1;
  const maxZ = bounds.maxZ ?? 1;
  const fx = clamp01((x - minX) / Math.max(1e-6, maxX - minX));
  const fy = clamp01((y - minY) / Math.max(1e-6, maxY - minY));
  const fz = clamp01((z - minZ) / Math.max(1e-6, maxZ - minZ));
  const nx = normal[0] ?? 0;
  const ny = normal[1] ?? 0;
  const nz = normal[2] ?? 0;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let col = 1;
  let row = 0;
  let u = fx;
  let v = fy;
  if (ax >= ay && ax >= az) {
    col = 0;
    row = nx >= 0 ? 0 : 1;
    u = fz;
    v = fy;
  } else if (az >= ay) {
    col = 2;
    row = nz >= 0 ? 0 : 1;
    u = fx;
    v = fy;
  } else {
    col = 1;
    row = ny >= 0 ? 0 : 1;
    u = fx;
    v = fz;
  }
  return [(col + u) / 3, (row + v) / 2];
}

export function customUv(x, y, z, options = {}) {
  const views = options.views;
  if (views?.length) {
    const view = nearestViewByAzimuth(x, z, views);
    if (view) {
      const pixel = worldToPixel(view, x, y, z);
      const source = view.colorView ?? view;
      const width = Math.max(1, source.width ?? view.width ?? 1);
      const height = Math.max(1, source.height ?? view.height ?? 1);
      return [
        clamp01(pixel.x / width),
        clamp01(1 - pixel.y / height),
      ];
    }
  }
  return cylinderUv(x, y, z, options.bounds);
}

export function wrapUv(x, y, z, options = {}) {
  const kind = options.kind ?? "custom";
  const bounds = options.bounds ?? {};
  const normal = options.normal ?? [0, 1, 0];
  if (kind === "cylinder") return cylinderUv(x, y, z, bounds, options);
  if (kind === "capsule") return capsuleUv(x, y, z, bounds);
  if (kind === "square" || kind === "rectangle") return boxUv(x, y, z, normal, bounds);
  if (kind === "humanoid") return customUv(x, y, z, { ...options, bounds });
  return customUv(x, y, z, { ...options, bounds });
}

export function wrapQuadUvs(uvs) {
  const us = uvs.map(uv => uv[0]);
  const min = Math.min(...us);
  const max = Math.max(...us);
  if (max - min <= 0.5) return uvs;
  for (const uv of uvs) {
    if (uv[0] < 0.5) uv[0] += 1;
  }
  return uvs;
}

function splat(data, width, height, channels, u, v, values, weight) {
  const x = u * (width - 1);
  const y = (1 - v) * (height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const write = (ix, iy, w) => {
    if (w <= 0 || ix < 0 || iy < 0 || ix >= width || iy >= height) return;
    const index = (iy * width + ix) * channels;
    for (let c = 0; c < channels; c++) data[index + c] += values[c] * w;
  };
  write(x0, y0, (1 - tx) * (1 - ty) * weight);
  write(x0 + 1, y0, tx * (1 - ty) * weight);
  write(x0, y0 + 1, (1 - tx) * ty * weight);
  write(x0 + 1, y0 + 1, tx * ty * weight);
}

function blur(source, width, height, channels) {
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ix = Math.min(width - 1, Math.max(0, x + dx));
            const iy = Math.min(height - 1, Math.max(0, y + dy));
            const kernel = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
            sum += source[(iy * width + ix) * channels + c] * kernel;
            weight += kernel;
          }
        }
        output[(y * width + x) * channels + c] = sum / weight;
      }
    }
  }
  return output;
}

function toBytes(source, count) {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    bytes[i] = Math.min(255, Math.max(0, Math.round(source[i])));
  }
  return bytes;
}

export function bakeMaterialMaps(volume, options = {}) {
  const width = options.width ?? 512;
  const height = options.height ?? 512;
  const albedo = new Float32Array(width * height * 4);
  const bump = new Float32Array(width * height);
  const { occupancy, resolution } = volume;
  const bounds = volumeUvBounds(volume);
  const kind = options.shape?.kind ?? options.kind ?? "custom";
  const wrap = { kind, bounds, views: options.views };

  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        if (!isSurfaceVoxel(occupancy, resolution, x, y, z)) continue;
        const center = voxelCenter(x, y, z, volume);
        const gradient = occupancyGradient(volume, x, y, z);
        const uv = wrapUv(center[0], center[1], center[2], {
          ...wrap,
          normal: gradient,
        });
        const rgb = voxelRgb(volume, x, y, z);
        const radius = Math.hypot(center[0], center[2]);
        splat(albedo, width, height, 4, uv[0], uv[1], [rgb[0], rgb[1], rgb[2], 255], 1);
        splat(bump, width, height, 1, uv[0], uv[1], [radius * 255], 1);
      }
    }
  }

  for (let i = 0; i < width * height; i++) {
    const alpha = albedo[i * 4 + 3];
    if (alpha > 0.001) {
      albedo[i * 4] /= alpha / 255;
      albedo[i * 4 + 1] /= alpha / 255;
      albedo[i * 4 + 2] /= alpha / 255;
      albedo[i * 4 + 3] = 255;
      bump[i] /= alpha / 255;
    } else {
      albedo[i * 4] = 48;
      albedo[i * 4 + 1] = 62;
      albedo[i * 4 + 2] = 38;
      albedo[i * 4 + 3] = 255;
    }
  }

  const albedoBytes = toBytes(albedo, albedo.length);
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    luma[i] = (
      albedoBytes[i * 4] * 0.2126
      + albedoBytes[i * 4 + 1] * 0.7152
      + albedoBytes[i * 4 + 2] * 0.0722
    ) / 255;
  }
  const heightField = blur(bump, width, height, 1);
  const bumpBytes = new Uint8Array(width * height);
  const normalBytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const left = heightField[y * width + Math.max(0, x - 1)];
      const right = heightField[y * width + Math.min(width - 1, x + 1)];
      const up = heightField[Math.max(0, y - 1) * width + x];
      const down = heightField[Math.min(height - 1, y + 1) * width + x];
      const nx = (left - right) * 0.035;
      const ny = (up - down) * 0.035;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      const o = index * 4;
      normalBytes[o] = Math.round((nx / length * 0.5 + 0.5) * 255);
      normalBytes[o + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      normalBytes[o + 2] = Math.round((nz / length * 0.5 + 0.5) * 255);
      normalBytes[o + 3] = 255;
      const detail = luma[index] - 0.42;
      bumpBytes[index] = Math.min(255, Math.max(0, Math.round(heightField[index] * 0.55 + detail * 90 + 96)));
    }
  }

  return {
    width,
    height,
    albedo: albedoBytes,
    bump: bumpBytes,
    normal: normalBytes,
  };
}

export function mapsHaveDetail(maps) {
  let min = 255;
  let max = 0;
  for (let i = 0; i < maps.bump.length; i++) {
    min = Math.min(min, maps.bump[i]);
    max = Math.max(max, maps.bump[i]);
  }
  return max - min > 8;
}
