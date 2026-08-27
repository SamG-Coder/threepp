import { sampleViewAtPixel, worldToPixel } from "./silhouette.mjs";
import { nearestViewByAzimuth } from "./structure.mjs";
import { volumeUvBounds, wrapUv } from "./unwrap.mjs";
import { voxelCenter, voxelIndex } from "./visual-hull.mjs";

const TETS = [
  [0, 1, 2, 6],
  [0, 1, 5, 6],
  [0, 3, 2, 6],
  [0, 3, 7, 6],
  [0, 4, 5, 6],
  [0, 4, 7, 6],
];

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

function sampleSdf(sdf, volume, x, y, z) {
  const { resolution } = volume;
  if (x < 0 || y < 0 || z < 0 || x >= resolution || y >= resolution || z >= resolution) {
    return 1;
  }
  return sdf[voxelIndex(x, y, z, resolution)];
}

function interpolate(p0, p1, v0, v1) {
  const denom = v0 - v1;
  const t = Math.abs(denom) < 1e-6 ? 0.5 : v0 / denom;
  const u = Math.min(1, Math.max(0, t));
  return [
    p0[0] + (p1[0] - p0[0]) * u,
    p0[1] + (p1[1] - p0[1]) * u,
    p0[2] + (p1[2] - p0[2]) * u,
  ];
}

function cornerWorld(volume, x, y, z, corner) {
  return voxelCenter(x + corner[0], y + corner[1], z + corner[2], volume);
}

function edgeId(a, b, resolution) {
  const pack = (x, y, z) => x + y * resolution + z * resolution * resolution;
  const pa = pack(a[0], a[1], a[2]);
  const pb = pack(b[0], b[1], b[2]);
  return pa < pb ? pa * resolution * resolution * resolution + pb : pb * resolution * resolution * resolution + pa;
}

function pushTriangle(mesh, a, b, c, vertexMap, positions, toward) {
  if (a === b || b === c || c === a) return;
  let ia = vertexMap.get(a);
  let ib = vertexMap.get(b);
  let ic = vertexMap.get(c);
  const abx = positions[ib * 3] - positions[ia * 3];
  const aby = positions[ib * 3 + 1] - positions[ia * 3 + 1];
  const abz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
  const acx = positions[ic * 3] - positions[ia * 3];
  const acy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
  const acz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  if (nx * nx + ny * ny + nz * nz < 1e-14) return;
  const mx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
  const my = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
  const mz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
  if (nx * (toward[0] - mx) + ny * (toward[1] - my) + nz * (toward[2] - mz) < 0) {
    const swap = ib;
    ib = ic;
    ic = swap;
  }
  mesh.indices.push(ia, ib, ic);
}

export function marchingTetrahedra(volume, sdf) {
  const { resolution } = volume;
  const positions = [];
  const vertexMap = new Map();
  const mesh = { indices: [] };

  const vertexForEdge = (c0, c1, p0, p1, v0, v1) => {
    const id = edgeId(c0, c1, resolution + 2);
    if (vertexMap.has(id)) return id;
    const point = interpolate(p0, p1, v0, v1);
    vertexMap.set(id, positions.length / 3);
    positions.push(point[0], point[1], point[2]);
    return id;
  };

  for (let z = 0; z < resolution - 1; z++) {
    for (let y = 0; y < resolution - 1; y++) {
      for (let x = 0; x < resolution - 1; x++) {
        const points = CORNERS.map(corner => cornerWorld(volume, x, y, z, corner));
        const values = CORNERS.map(corner => sampleSdf(sdf, volume, x + corner[0], y + corner[1], z + corner[2]));
        const ids = CORNERS.map(corner => [x + corner[0], y + corner[1], z + corner[2]]);
        for (const tet of TETS) {
          const occupied = tet.filter(corner => values[corner] <= 0);
          if (occupied.length === 0 || occupied.length === 4) continue;
          const empty = tet.filter(corner => values[corner] > 0);
          const toward = [0, 0, 0];
          for (const corner of empty) {
            toward[0] += points[corner][0];
            toward[1] += points[corner][1];
            toward[2] += points[corner][2];
          }
          toward[0] /= empty.length;
          toward[1] /= empty.length;
          toward[2] /= empty.length;
          if (occupied.length === 1 || occupied.length === 3) {
            const inside = occupied.length === 1 ? occupied[0] : empty[0];
            const outside = occupied.length === 1 ? empty : occupied;
            const edges = outside.map(corner => vertexForEdge(
              ids[inside],
              ids[corner],
              points[inside],
              points[corner],
              values[inside],
              values[corner],
            ));
            pushTriangle(mesh, edges[0], edges[1], edges[2], vertexMap, positions, toward);
          } else {
            const a = occupied[0];
            const b = occupied[1];
            const c = empty[0];
            const d = empty[1];
            const e0 = vertexForEdge(ids[a], ids[c], points[a], points[c], values[a], values[c]);
            const e1 = vertexForEdge(ids[a], ids[d], points[a], points[d], values[a], values[d]);
            const e2 = vertexForEdge(ids[b], ids[d], points[b], points[d], values[b], values[d]);
            const e3 = vertexForEdge(ids[b], ids[c], points[b], points[c], values[b], values[c]);
            pushTriangle(mesh, e0, e1, e2, vertexMap, positions, toward);
            pushTriangle(mesh, e0, e2, e3, vertexMap, positions, toward);
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(mesh.indices),
  };
}

export function laplacianSmooth(positions, indices, iterations = 5, lambda = 0.42) {
  const count = positions.length / 3;
  const adjacency = Array.from({ length: count }, () => []);
  const seen = Array.from({ length: count }, () => new Set());
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const link = (i0, i1) => {
      if (seen[i0].has(i1)) return;
      seen[i0].add(i1);
      adjacency[i0].push(i1);
    };
    link(a, b); link(b, a);
    link(b, c); link(c, b);
    link(c, a); link(a, c);
  }

  const next = new Float32Array(positions.length);
  for (let pass = 0; pass < iterations; pass++) {
    next.set(positions);
    for (let i = 0; i < count; i++) {
      const neighbors = adjacency[i];
      if (!neighbors.length) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const n of neighbors) {
        x += positions[n * 3];
        y += positions[n * 3 + 1];
        z += positions[n * 3 + 2];
      }
      const inv = 1 / neighbors.length;
      next[i * 3] += (x * inv - positions[i * 3]) * lambda;
      next[i * 3 + 1] += (y * inv - positions[i * 3 + 1]) * lambda;
      next[i * 3 + 2] += (z * inv - positions[i * 3 + 2]) * lambda;
    }
    positions.set(next);
  }
  return positions;
}

export function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

function srgbChannelToLinear(byte) {
  const s = Math.min(1, Math.max(0, byte / 255));
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function punchierPhotoRgb(rgb) {
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = 1.28;
  const lift = 1.08;
  return [
    Math.min(255, Math.max(0, (gray + (r - gray) * sat) * lift)),
    Math.min(255, Math.max(0, (gray + (g - gray) * sat) * lift)),
    Math.min(255, Math.max(0, (gray + (b - gray) * sat) * lift)),
  ];
}

export function projectVertexColors(positions, normals, views, options = {}) {
  const count = positions.length / 3;
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const kind = options.shape?.kind ?? options.kind ?? "custom";
  const bounds = options.bounds ?? {};
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const uv = wrapUv(x, y, z, {
      kind,
      bounds,
      normal: [nx, ny, nz],
      views,
    });
    uvs[i * 2] = uv[0];
    uvs[i * 2 + 1] = uv[1];
    const primary = nearestViewByAzimuth(x, z, views);
    let color = null;
    const tryView = view => {
      const pixel = worldToPixel(view, x, y, z);
      return sampleViewAtPixel(view, pixel.x, pixel.y);
    };
    color = tryView(primary);
    if (!color) {
      let best = -1;
      for (const view of views) {
        const rgb = tryView(view);
        if (!rgb) continue;
        const facing = nx * view.basis.position[0] + nz * view.basis.position[2] + ny * 0.08;
        if (facing > best) {
          best = facing;
          color = rgb;
        }
      }
    }
    if (!color) color = [86, 78, 52];
    const punched = punchierPhotoRgb(color);
    colors[i * 3] = srgbChannelToLinear(punched[0]);
    colors[i * 3 + 1] = srgbChannelToLinear(punched[1]);
    colors[i * 3 + 2] = srgbChannelToLinear(punched[2]);
  }
  return { colors, uvs };
}

export function extractIsosurface(volume, sdf, views, options = {}) {
  const raw = marchingTetrahedra(volume, sdf);
  laplacianSmooth(raw.positions, raw.indices, options.smoothIterations ?? 6, options.smoothLambda ?? 0.4);
  const normals = computeNormals(raw.positions, raw.indices);
  const projected = projectVertexColors(raw.positions, normals, views, {
    shape: options.shape,
    bounds: volumeUvBounds(volume),
  });
  return {
    positions: raw.positions,
    normals,
    uvs: projected.uvs,
    colors: projected.colors,
    indices: raw.indices,
    vertexCount: raw.positions.length / 3,
    triangleCount: raw.indices.length / 3,
  };
}

export function axisAlignedNormalRatio(mesh) {
  if (!mesh.vertexCount) return 1;
  let aligned = 0;
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const peak = Math.max(
      Math.abs(mesh.normals[i]),
      Math.abs(mesh.normals[i + 1]),
      Math.abs(mesh.normals[i + 2]),
    );
    if (peak > 0.97) aligned += 1;
  }
  return aligned / mesh.vertexCount;
}
