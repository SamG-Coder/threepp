/** Harbor-specific post-process for meshes reconstructed from 2D orbit stills. */

const DEFAULT_LIMITS = Object.freeze({
  triangleFraction: 0.01,
  surfaceAreaFraction: 0.0025,
  minimumTriangleLimit: 24,
});
const SUPPORT_QUANTILE = 0.02;
const MAX_SUPPORT_LIFT_FRACTION = 0.01;

function triangleArea(positions, a, b, c) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const abx = positions[b * 3] - ax;
  const aby = positions[b * 3 + 1] - ay;
  const abz = positions[b * 3 + 2] - az;
  const acx = positions[c * 3] - ax;
  const acy = positions[c * 3 + 1] - ay;
  const acz = positions[c * 3 + 2] - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.hypot(nx, ny, nz) * 0.5;
}

function connectedComponents(mesh) {
  const positions = mesh.positions;
  const indices = mesh.indices;
  const vertexCount = positions.length / 3;
  const parent = new Int32Array(vertexCount);
  const rank = new Uint8Array(vertexCount);
  for (let index = 0; index < vertexCount; index++) parent[index] = index;

  function find(vertex) {
    let root = vertex;
    while (parent[root] !== root) root = parent[root];
    while (parent[vertex] !== vertex) {
      const next = parent[vertex];
      parent[vertex] = root;
      vertex = next;
    }
    return root;
  }

  function union(a, b) {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return;
    if (rank[rootA] < rank[rootB]) [rootA, rootB] = [rootB, rootA];
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
  }

  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    union(a, b);
    union(b, c);
  }

  const byRoot = new Map();
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    const root = find(a);
    let component = byRoot.get(root);
    if (!component) {
      component = {
        root,
        triangleOffsets: [],
        triangleCount: 0,
        surfaceArea: 0,
        minY: Infinity,
        maxY: -Infinity,
        vertexIds: new Set(),
      };
      byRoot.set(root, component);
    }
    component.triangleOffsets.push(offset);
    component.triangleCount += 1;
    component.surfaceArea += triangleArea(positions, a, b, c);
    component.vertexIds.add(a);
    component.vertexIds.add(b);
    component.vertexIds.add(c);
    component.minY = Math.min(
      component.minY,
      positions[a * 3 + 1],
      positions[b * 3 + 1],
      positions[c * 3 + 1],
    );
    component.maxY = Math.max(
      component.maxY,
      positions[a * 3 + 1],
      positions[b * 3 + 1],
      positions[c * 3 + 1],
    );
  }
  return [...byRoot.values()];
}

function componentSupportBaseY(component, positions) {
  const heights = [...component.vertexIds]
    .map((vertex) => positions[vertex * 3 + 1])
    .sort((a, b) => a - b);
  if (!heights.length) return component.minY;
  const quantileIndex = Math.floor((heights.length - 1) * SUPPORT_QUANTILE);
  const quantileY = heights[quantileIndex];
  const liftCap = component.minY
    + Math.max(0, component.maxY - component.minY) * MAX_SUPPORT_LIFT_FRACTION;
  return Math.min(quantileY, liftCap);
}

function copyVertex(mesh, oldIndex, output) {
  for (let axis = 0; axis < 3; axis++) {
    output.positions.push(mesh.positions[oldIndex * 3 + axis]);
    output.normals.push(mesh.normals[oldIndex * 3 + axis]);
    output.colors.push(mesh.colors[oldIndex * 3 + axis]);
  }
  for (let axis = 0; axis < 2; axis++) output.uvs.push(mesh.uvs[oldIndex * 2 + axis]);
}

function compactMesh(mesh, components) {
  const oldToNew = new Int32Array(mesh.positions.length / 3);
  oldToNew.fill(-1);
  const output = { positions: [], normals: [], colors: [], uvs: [], indices: [] };

  function remap(oldIndex) {
    if (oldToNew[oldIndex] >= 0) return oldToNew[oldIndex];
    const next = output.positions.length / 3;
    oldToNew[oldIndex] = next;
    copyVertex(mesh, oldIndex, output);
    return next;
  }

  const offsets = components
    .flatMap((component) => component.triangleOffsets)
    .sort((a, b) => a - b);
  for (const offset of offsets) {
    output.indices.push(
      remap(mesh.indices[offset]),
      remap(mesh.indices[offset + 1]),
      remap(mesh.indices[offset + 2]),
    );
  }

  return {
    ...mesh,
    positions: new Float32Array(output.positions),
    normals: new Float32Array(output.normals),
    colors: new Float32Array(output.colors),
    uvs: new Float32Array(output.uvs),
    indices: new Uint32Array(output.indices),
    vertexCount: output.positions.length / 3,
    triangleCount: output.indices.length / 3,
  };
}

/**
 * Drop only components that are tiny by both topology and surface area.
 * The largest connected body is never altered, so attached roots, eaves,
 * branches, limbs, and trim remain intact. Grounding considers every retained
 * component, so legitimate separate wheels or legs still touch the terrain;
 * a discarded low speck can no longer lift the visible asset.
 */
export function cleanupReconstructionMesh(mesh, limits = DEFAULT_LIMITS) {
  if (
    !mesh?.positions?.length
    || !mesh?.indices?.length
    || !mesh?.normals?.length
    || !mesh?.colors?.length
    || !mesh?.uvs?.length
  ) {
    return {
      mesh,
      groundBaseY: 0,
      stats: Object.freeze({ components: 0, keptComponents: 0, removedComponents: 0, removedTriangles: 0 }),
    };
  }

  const components = connectedComponents(mesh);
  const primary = components.reduce((largest, component) => {
    if (!largest || component.surfaceArea > largest.surfaceArea) return component;
    if (component.surfaceArea === largest.surfaceArea && component.triangleCount > largest.triangleCount) {
      return component;
    }
    return largest;
  }, null);
  if (!primary) {
    return {
      mesh,
      groundBaseY: 0,
      stats: Object.freeze({ components: 0, keptComponents: 0, removedComponents: 0, removedTriangles: 0 }),
    };
  }

  const triangleLimit = Math.max(
    Number(limits.minimumTriangleLimit) || DEFAULT_LIMITS.minimumTriangleLimit,
    primary.triangleCount * (Number(limits.triangleFraction) || DEFAULT_LIMITS.triangleFraction),
  );
  const surfaceAreaLimit =
    primary.surfaceArea * (Number(limits.surfaceAreaFraction) || DEFAULT_LIMITS.surfaceAreaFraction);
  const kept = components.filter((component) => (
    component === primary
    || component.triangleCount > triangleLimit
    || component.surfaceArea > surfaceAreaLimit
  ));
  const removed = components.filter((component) => !kept.includes(component));
  const cleanedMesh = removed.length ? compactMesh(mesh, kept) : mesh;
  const groundBaseY = kept.reduce(
    (lowest, component) => Math.min(lowest, componentSupportBaseY(component, mesh.positions)),
    Infinity,
  );

  return {
    mesh: cleanedMesh,
    groundBaseY: Number.isFinite(groundBaseY) ? groundBaseY : 0,
    stats: Object.freeze({
      components: components.length,
      keptComponents: kept.length,
      removedComponents: removed.length,
      removedTriangles: removed.reduce((sum, component) => sum + component.triangleCount, 0),
    }),
  };
}
