import * as THREE from "three/webgpu";

export const WORLD_BOUNDS = Object.freeze({
  minX: -210,
  maxX: 210,
  minZ: -240,
  maxZ: 220,
});

export const WORLD_SEED = 0x4b454550;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function fade(value) {
  return value * value * (3 - value * 2);
}

function hash2(x, z, seed = WORLD_SEED) {
  let value = seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z, frequency, seed) {
  const sx = x * frequency;
  const sz = z * frequency;
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const tx = fade(sx - ix);
  const tz = fade(sz - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), tz);
}

function fbm(x, z, seed = WORLD_SEED) {
  let sum = 0;
  let amplitude = 1;
  let normalizer = 0;
  let frequency = 0.0065;
  for (let octave = 0; octave < 5; ++octave) {
    sum += valueNoise(x, z, frequency, seed + octave * 0x632be5ab) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.48;
    frequency *= 2.08;
  }
  return sum / normalizer;
}

function gaussian(x, z, centerX, centerZ, radiusX, radiusZ) {
  const dx = (x - centerX) / radiusX;
  const dz = (z - centerZ) / radiusZ;
  return Math.exp(-(dx * dx + dz * dz));
}

function smoothBand(distance, inner, outer) {
  return 1 - fade(clamp01((distance - inner) / Math.max(0.0001, outer - inner)));
}

/** The east/west river centreline used by terrain, water, bridge and mill. */
export function riverCenterZ(x) {
  return 62 + Math.sin(x * 0.022) * 12 + Math.sin(x * 0.051 + 0.7) * 2.4;
}

/** The old north road bends around the forest before climbing to the keep. */
export function trailCenterX(z) {
  if (z > 20) return Math.sin(z * 0.018) * 2;
  const forestBend = Math.sin((z + 8) * 0.025) * 13 - smoothBand(Math.abs(z + 88), 0, 76) * 3;
  const fortressApproach = fade(clamp01((-z - 122) / 38));
  return THREE.MathUtils.lerp(forestBend, 0, fortressApproach);
}

/**
 * Authoritative deterministic terrain query for rendering, physics and AI.
 * It intentionally has no mutable dependencies, so all agents can call it.
 */
export function terrainHeight(x, z) {
  const broad = (fbm(x, z) - 0.5) * 15;
  const detail = (valueNoise(x, z, 0.038, WORLD_SEED ^ 0x8da6b343) - 0.5) * 2.8;
  const riverDistance = Math.abs(z - riverCenterZ(x));
  const riverCut = smoothBand(riverDistance, 0, 26);
  const side = Math.max(0, Math.abs(x) - 70) / 140;
  const valleyWall = side * side * 39 * (1 - riverCut * 0.88);
  const northRise = clamp01((-z - 82) / 170) * 7;
  let height = broad + detail + valleyWall + northRise;

  // Broad civic plateaus avoid floating architecture without making the land
  // read as a collection of disconnected flat arenas.
  const villagePlateau = gaussian(x, z, 0, 4, 66, 58);
  height = THREE.MathUtils.lerp(height, 3.4 + x * 0.004, villagePlateau * 0.78);
  const southFields = Math.max(
    gaussian(x, z, -72, 102, 48, 38),
    gaussian(x, z, 68, 108, 50, 40),
  );
  height = THREE.MathUtils.lerp(height, 2.2 + Math.sin(x * 0.025) * 0.5, southFields * 0.72);

  // The river carves the final surface after the plateaus are formed.
  height -= riverCut * (5.4 + smoothBand(riverDistance, 0, 8) * 1.8);

  // The ruined keep is a single high destination, not a separate sky island.
  const fortressHill = gaussian(x, z, 0, -190, 62, 50);
  height += fortressHill * 28;
  height = THREE.MathUtils.lerp(height, 28.2 + (x * x) * 0.0008, gaussian(x, z, 0, -190, 39, 31) * 0.82);

  // A shallow compressed track is visible all the way from the south gate to
  // the fortress. It remains continuous through village and forest.
  const roadDistance = Math.abs(x - trailCenterX(z));
  const road = smoothBand(roadDistance, 1.8, z > 22 ? 6.8 : 5.2);
  height -= road * (0.18 + smoothBand(Math.abs(z - 70), 0, 170) * 0.10);
  return height;
}

export function terrainNormal(x, z, target = new THREE.Vector3(), sampleDistance = 0.7) {
  const left = terrainHeight(x - sampleDistance, z);
  const right = terrainHeight(x + sampleDistance, z);
  const back = terrainHeight(x, z - sampleDistance);
  const front = terrainHeight(x, z + sampleDistance);
  return target.set(left - right, sampleDistance * 2, back - front).normalize();
}

function makeTerrainChunk(material, bounds, segments) {
  const columns = segments + 1;
  const vertexCount = columns * columns;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(segments * segments * 6);
  const normal = new THREE.Vector3();
  let vertex = 0;
  for (let row = 0; row <= segments; ++row) {
    const z = THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, row / segments);
    for (let column = 0; column <= segments; ++column) {
      const x = THREE.MathUtils.lerp(bounds.minX, bounds.maxX, column / segments);
      const y = terrainHeight(x, z);
      terrainNormal(x, z, normal);
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      normals[vertex * 3] = normal.x;
      normals[vertex * 3 + 1] = normal.y;
      normals[vertex * 3 + 2] = normal.z;
      uvs[vertex * 2] = (x - WORLD_BOUNDS.minX) / 9;
      uvs[vertex * 2 + 1] = (z - WORLD_BOUNDS.minZ) / 9;
      vertex += 1;
    }
  }
  let cursor = 0;
  for (let row = 0; row < segments; ++row) {
    for (let column = 0; column < segments; ++column) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Terrain ${bounds.minX}:${bounds.minZ}`;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.worldStatic = true;
  return mesh;
}

export function createTerrain(material, {
  chunksX = 3,
  chunksZ = 4,
  segmentsPerChunk = 38,
} = {}) {
  const group = new THREE.Group();
  group.name = "Continuous procedural valley terrain";
  group.userData.worldStatic = true;
  const meshes = [];
  for (let chunkZ = 0; chunkZ < chunksZ; ++chunkZ) {
    for (let chunkX = 0; chunkX < chunksX; ++chunkX) {
      const bounds = {
        minX: THREE.MathUtils.lerp(WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX, chunkX / chunksX),
        maxX: THREE.MathUtils.lerp(WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX, (chunkX + 1) / chunksX),
        minZ: THREE.MathUtils.lerp(WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ, chunkZ / chunksZ),
        maxZ: THREE.MathUtils.lerp(WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ, (chunkZ + 1) / chunksZ),
      };
      const mesh = makeTerrainChunk(material, bounds, segmentsPerChunk);
      meshes.push(mesh);
      group.add(mesh);
    }
  }
  return {
    group,
    meshes,
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
    },
  };
}

/** Create a conforming road/trail ribbon from sampled world-space points. */
export function createTerrainRibbon(points, material, {
  width = 4,
  yOffset = 0.07,
  name = "Terrain ribbon",
} = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("A terrain ribbon requires at least two points.");
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  const normal = new THREE.Vector3();
  for (let index = 0; index < points.length; ++index) {
    const current = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    if (index > 0) distance += Math.hypot(current.x - previous.x, current.z - previous.z);
    const tangentX = next.x - previous.x;
    const tangentZ = next.z - previous.z;
    const inverse = 1 / Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    const sideX = tangentZ * inverse * width * 0.5;
    const sideZ = -tangentX * inverse * width * 0.5;
    for (const side of [-1, 1]) {
      const x = current.x + sideX * side;
      const z = current.z + sideZ * side;
      const y = terrainHeight(x, z) + yOffset;
      terrainNormal(x, z, normal);
      positions.push(x, y, z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push((side + 1) * 0.5, distance / Math.max(1, width));
    }
    if (index < points.length - 1) {
      const a = index * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.userData.worldStatic = true;
  return mesh;
}

export function sampleOldNorthRoad(step = 4) {
  const points = [];
  for (let z = WORLD_BOUNDS.maxZ - 3; z >= -180; z -= Math.max(1, step)) {
    points.push({ x: trailCenterX(z), z });
  }
  return points;
}
