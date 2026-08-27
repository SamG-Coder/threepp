import { voxelIndex } from "./visual-hull.mjs";
import { voxelRgb } from "./color-bake.mjs";
import { volumeUvBounds, wrapQuadUvs, wrapUv } from "./unwrap.mjs";

function occupied(volume, x, y, z) {
  const { occupancy, resolution } = volume;
  if (x < 0 || y < 0 || z < 0 || x >= resolution || y >= resolution || z >= resolution) {
    return 0;
  }
  return occupancy[voxelIndex(x, y, z, resolution)];
}

function worldPoint(volume, x, y, z) {
  return [
    volume.min[0] + x / volume.resolution * volume.size[0],
    volume.min[1] + y / volume.resolution * volume.size[1],
    volume.min[2] + z / volume.resolution * volume.size[2],
  ];
}

function pushQuad(mesh, corners, normal, color, wrap) {
  const base = mesh.positions.length / 3;
  const uvs = corners.map(corner => wrapUv(corner[0], corner[1], corner[2], {
    ...wrap,
    normal,
  }));
  if ((wrap?.kind ?? "custom") === "capsule") {
    wrapQuadUvs(uvs);
  }
  for (let i = 0; i < 4; i++) {
    mesh.positions.push(corners[i][0], corners[i][1], corners[i][2]);
    mesh.normals.push(normal[0], normal[1], normal[2]);
    mesh.uvs.push(uvs[i][0], uvs[i][1]);
    mesh.colors.push(color[0] / 255, color[1] / 255, color[2] / 255);
  }
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function emitMerged(volume, axis, sign, slice, u0, v0, w, h, mesh, wrap) {
  const uAxis = (axis + 1) % 3;
  const vAxis = (axis + 2) % 3;
  const voxel = [0, 0, 0];
  voxel[axis] = sign > 0 ? slice - 1 : slice;
  voxel[uAxis] = u0;
  voxel[vAxis] = v0;
  const color = voxelRgb(volume, voxel[0], voxel[1], voxel[2]);

  const origin = [0, 0, 0];
  origin[axis] = slice;
  origin[uAxis] = u0;
  origin[vAxis] = v0;
  const du = [0, 0, 0];
  du[uAxis] = w;
  const dv = [0, 0, 0];
  dv[vAxis] = h;

  const a = worldPoint(volume, origin[0], origin[1], origin[2]);
  const b = worldPoint(volume, origin[0] + du[0], origin[1] + du[1], origin[2] + du[2]);
  const c = worldPoint(volume, origin[0] + du[0] + dv[0], origin[1] + du[1] + dv[1], origin[2] + du[2] + dv[2]);
  const d = worldPoint(volume, origin[0] + dv[0], origin[1] + dv[1], origin[2] + dv[2]);
  const normal = [0, 0, 0];
  normal[axis] = sign;
  const corners = sign > 0 ? [a, b, c, d] : [a, d, c, b];
  pushQuad(mesh, corners, normal, color, wrap);
}

function greedyAxis(volume, axis, sign, mesh, wrap) {
  const { resolution } = volume;
  const uAxis = (axis + 1) % 3;
  const vAxis = (axis + 2) % 3;
  const mask = new Uint8Array(resolution * resolution);

  for (let slice = 0; slice <= resolution; slice++) {
    mask.fill(0);
    for (let v = 0; v < resolution; v++) {
      for (let u = 0; u < resolution; u++) {
        const voxel = [0, 0, 0];
        const neighbor = [0, 0, 0];
        voxel[uAxis] = u;
        voxel[vAxis] = v;
        neighbor[uAxis] = u;
        neighbor[vAxis] = v;
        if (sign > 0) {
          voxel[axis] = slice - 1;
          neighbor[axis] = slice;
        } else {
          voxel[axis] = slice;
          neighbor[axis] = slice - 1;
        }
        const solid = occupied(volume, voxel[0], voxel[1], voxel[2]);
        const empty = !occupied(volume, neighbor[0], neighbor[1], neighbor[2]);
        mask[v * resolution + u] = solid && empty ? 1 : 0;
      }
    }

    for (let v = 0; v < resolution; v++) {
      for (let u = 0; u < resolution; ) {
        if (!mask[v * resolution + u]) {
          u += 1;
          continue;
        }
        let width = 1;
        while (u + width < resolution && mask[v * resolution + u + width]) width += 1;
        let height = 1;
        outer: while (v + height < resolution) {
          for (let k = 0; k < width; k++) {
            if (!mask[(v + height) * resolution + u + k]) break outer;
          }
          height += 1;
        }
        emitMerged(volume, axis, sign, slice, u, v, width, height, mesh, wrap);
        for (let dv = 0; dv < height; dv++) {
          mask.fill(0, (v + dv) * resolution + u, (v + dv) * resolution + u + width);
        }
        u += width;
      }
    }
  }
}

export function greedyMesh(volume, options = {}) {
  const mesh = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
  };
  const wrap = {
    kind: options.shape?.kind ?? options.kind ?? "custom",
    bounds: volumeUvBounds(volume),
    views: options.views,
  };
  greedyAxis(volume, 0, -1, mesh, wrap);
  greedyAxis(volume, 0, 1, mesh, wrap);
  greedyAxis(volume, 1, -1, mesh, wrap);
  greedyAxis(volume, 1, 1, mesh, wrap);
  greedyAxis(volume, 2, -1, mesh, wrap);
  greedyAxis(volume, 2, 1, mesh, wrap);
  return {
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    uvs: new Float32Array(mesh.uvs),
    colors: new Float32Array(mesh.colors),
    indices: new Uint32Array(mesh.indices),
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
  };
}
