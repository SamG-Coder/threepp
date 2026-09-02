export const WATER_LEVEL = 0.16;
export const WORLD = Object.freeze({
  minX: -78,
  maxX: 78,
  minZ: -82,
  maxZ: 52,
});
export const HEIGHT_BOUNDS = Object.freeze({
  minX: -160,
  maxX: 160,
  minZ: -82,
  maxZ: 220,
  minHeight: -4,
  heightSpan: 12,
});

function hash2(x, z, seed = 0) {
  const h = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function smoothNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

function fbm(x, z, seed = 0) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    value += smoothNoise(x * frequency, z * frequency, seed + octave * 19) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.49;
  }
  return value / 0.96875;
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function terrainHeight(x, z) {
  const inland = 1 - smoothstep(-8, 16, z);
  const dunes = fbm(x * 0.028 + 2.4, z * 0.033 - 1.1, 4);
  const ridges = fbm(x * 0.09 - 4.2, z * 0.08 + 3.7, 21);
  const duneLift = (0.85 + dunes * 4.8 + ridges * 1.15) * inland * inland;
  const berm = smoothstep(-22, -4, z) * (1 - smoothstep(-2, 8, z)) * 0.38;
  const swash = Math.sin(x * 1.85 + z * 0.42) * 0.028
    * smoothstep(-12, 1, z)
    * (1 - smoothstep(6, 16, z));
  const grain = (fbm(x * 0.37, z * 0.34, 61) - 0.5) * 0.045 * inland;
  const shelf = -smoothstep(10, 46, z) * (2.4 + fbm(x * 0.02, z * 0.018, 9) * 0.85);
  const basin = -smoothstep(38, 125, z) * (1.2 + fbm(x * 0.013, z * 0.011, 13) * 0.4);
  const cove = -0.22 * Math.exp(-((x - 18) * (x - 18)) / 420) * smoothstep(-4, 14, z);
  return duneLift + berm + swash + grain + shelf + basin + cove;
}

export function createHeightfieldGeometry(THREE, options = {}) {
  const minX = options.minX ?? WORLD.minX;
  const maxX = options.maxX ?? WORLD.maxX;
  const minZ = options.minZ ?? WORLD.minZ;
  const maxZ = options.maxZ ?? WORLD.maxZ;
  const columns = options.columns ?? 220;
  const rows = options.rows ?? 200;
  const uvScale = options.uvScale ?? 0.22;
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let p = 0;
  let q = 0;
  for (let row = 0; row <= rows; row += 1) {
    const vz = row / rows;
    const z = minZ + vz * (maxZ - minZ);
    for (let col = 0; col <= columns; col += 1) {
      const ux = col / columns;
      const x = minX + ux * (maxX - minX);
      positions[p++] = x;
      positions[p++] = terrainHeight(x, z);
      positions[p++] = z;
      uvs[q++] = x * uvScale;
      uvs[q++] = z * uvScale;
    }
  }
  const indices = new Uint32Array(columns * rows * 6);
  const stride = columns + 1;
  let i = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const a = row * stride + col;
      const b = a + stride;
      indices[i++] = a;
      indices[i++] = b;
      indices[i++] = a + 1;
      indices[i++] = a + 1;
      indices[i++] = b;
      indices[i++] = b + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTerrainHeightTexture(THREE, options = {}) {
  const width = options.width ?? 256;
  const height = options.height ?? 256;
  const bounds = options.bounds ?? HEIGHT_BOUNDS;
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const z = bounds.minZ + (row / Math.max(1, height - 1)) * (bounds.maxZ - bounds.minZ);
    for (let col = 0; col < width; col += 1) {
      const x = bounds.minX + (col / Math.max(1, width - 1)) * (bounds.maxX - bounds.minX);
      const encoded = (terrainHeight(x, z) - bounds.minHeight) / bounds.heightSpan;
      const value = Math.max(0, Math.min(255, Math.round(encoded * 255)));
      const offset = (row * width + col) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = "Beach terrain height";
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
