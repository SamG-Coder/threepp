import * as THREE from "three/webgpu";
import {
  attribute,
  bumpMap,
  color,
  float,
  mix,
  mx_fractal_noise_float,
  positionWorld,
  smoothstep,
  vec3,
} from "three/tsl";

// The high-detail forest occupies roughly x=[-210, 210], z=[-330, 150].  A
// broad terrain-only apron and successive ridge lines keep every authored
// camera inside a real mountainside rather than on a small rectangular stage.
const TERRAIN_WIDTH = 600;
const TERRAIN_DEPTH = 800;
const TERRAIN_NEAR_Z = 220;
const TERRAIN_FAR_Z = -580;
const TERRAIN_SKIRT_DEPTH = 145;

function fract(value) {
  return value - Math.floor(value);
}

function hash2(x, z, seed = 0) {
  return fract(Math.sin(x * 127.1 + z * 311.7 + seed * 71.9) * 43758.5453123);
}

function valueNoise(x, z, seed = 0) {
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
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uz,
  );
}

function fbm(x, z, seed = 0, octaves = 5) {
  let value = 0;
  let amplitude = 0.52;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; ++octave) {
    value += valueNoise(x * frequency, z * frequency, seed + octave * 23) * amplitude;
    total += amplitude;
    frequency *= 2.03;
    amplitude *= 0.49;
  }
  return value / total;
}

function gaussianBand(value, center, width) {
  return Math.exp(-Math.pow((value - center) / width, 2));
}

function drainageCenterX(z) {
  return -9.5 + Math.sin(z * 0.014 + 0.35) * 17
    + Math.sin(z * 0.047 - 0.8) * 4.5;
}

function managementTrackX(z) {
  // Kept identical to the forest exclusion query; the visible road and its
  // tree-free corridor therefore remain coincident across the larger world.
  return 13 + Math.sin(z * 0.052) * 5;
}

/**
 * Broad Australian-looking mountainside with a central drainage gully.  The
 * function is deterministic and shared by terrain, trees, fire cells and
 * smoke emitters so nothing floats above a separately sampled surface.
 */
export function terrainHeight(x, z) {
  const distanceUphill = 40 - z;
  const farField = THREE.MathUtils.smoothstep(-z, 86, 520);
  const uphill = distanceUphill * 0.108;

  // Three spatial bands prevent the broad slope from reading as one inflated
  // noise tile: kilometre-scale folds, wooded spurs and close weathering.
  const broadFold = (fbm(x * 0.0062 - 1.7, z * 0.0062 + 2.1, 11, 5) - 0.47) * 17.5;
  const woodedSpurs = (fbm(x * 0.0185 + 6.4, z * 0.0185 - 3.2, 29, 5) - 0.5) * 7.4;
  const weathering = (fbm(x * 0.064 - 8.2, z * 0.064 + 4.7, 37, 4) - 0.5) * 2.3;
  const strata = Math.sin(z * 0.046 + Math.sin(x * 0.021) * 1.7) * 0.62;

  // A winding drainage floor broadens with distance, while the land rises
  // into asymmetric valley shoulders outside the populated forest core.
  const gullyCenter = drainageCenterX(z);
  const gullyWidth = 11.5 + farField * 17;
  const gully = -(4.2 + farField * 8.8)
    * gaussianBand(x, gullyCenter, gullyWidth);
  const shoulderDistance = Math.abs(x - gullyCenter);
  const sideShoulders = Math.pow(
    THREE.MathUtils.smoothstep(shoulderDistance, 72, 258),
    1.34,
  ) * (24 + farField * 37);
  const westernSpur = gaussianBand(x, -92 + Math.sin(z * 0.012) * 18, 46)
    * THREE.MathUtils.smoothstep(-z, 15, 310) * 8.5;
  const easternSpur = gaussianBand(x, 126 + Math.sin(z * 0.009 + 1.2) * 24, 58)
    * THREE.MathUtils.smoothstep(-z, 55, 420) * 6.4;

  // Two non-parallel ridge shelves give low cameras overlapping silhouettes;
  // the farther escarpment hides the fog-softened outer terrain boundary.
  const middleRidgeZ = -168 + Math.sin(x * 0.0105) * 31
    + (fbm(x * 0.018, 0.4, 71, 3) - 0.5) * 24;
  const farRidgeZ = -378 + Math.sin(x * 0.0078 + 0.7) * 48
    + (fbm(x * 0.011, -1.6, 97, 3) - 0.5) * 35;
  const middleRidge = gaussianBand(z, middleRidgeZ, 43)
    * (9.5 + (fbm(x * 0.013, z * 0.013, 113, 3) - 0.5) * 4.2);
  const farRidge = gaussianBand(z, farRidgeZ, 67)
    * (23 + (fbm(x * 0.008, z * 0.008, 149, 4) - 0.5) * 9);
  const distantEscarpment = Math.pow(farField, 1.55) * 24;

  return uphill + broadFold + woodedSpurs + weathering + strata + gully
    + sideShoulders + westernSpur + easternSpur + middleRidge + farRidge
    + distantEscarpment - 9.4;
}

export function terrainNormal(x, z, target = new THREE.Vector3()) {
  const epsilon = 0.32;
  const left = terrainHeight(x - epsilon, z);
  const right = terrainHeight(x + epsilon, z);
  const down = terrainHeight(x, z - epsilon);
  const up = terrainHeight(x, z + epsilon);
  return target.set(left - right, epsilon * 2, down - up).normalize();
}

export function terrainFuel(x, z) {
  const gullyCenter = drainageCenterX(z);
  const drainage = Math.exp(-Math.pow((x - gullyCenter) / 8.5, 2));
  const trackX = managementTrackX(z);
  const track = Math.exp(-Math.pow((x - trackX) / 2.2, 2));
  const broadPatch = fbm(x * 0.017, z * 0.017, 61, 4) - 0.5;
  const scrub = 0.58 + broadPatch * 0.25
    + (fbm(x * 0.065, z * 0.065, 83, 4) - 0.5) * 0.62;
  return THREE.MathUtils.clamp(scrub + drainage * 0.22 - track * 0.54, 0.08, 1);
}

function buildTerrainGeometry(columns = 272, rows = 296) {
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(columns * rows * 6);
  const ochre = new THREE.Color(0x45372b);
  const leafLitter = new THREE.Color(0x273024);
  const moss = new THREE.Color(0x354532);
  const stone = new THREE.Color(0x39342d);
  const tint = new THREE.Color();
  let p = 0;
  let c = 0;
  let uv = 0;

  for (let row = 0; row <= rows; ++row) {
    const v = row / rows;
    const z = THREE.MathUtils.lerp(TERRAIN_NEAR_Z, TERRAIN_FAR_Z, v);
    for (let column = 0; column <= columns; ++column) {
      const u = column / columns;
      const x = (u - 0.5) * TERRAIN_WIDTH;
      const y = terrainHeight(x, z);
      const normal = terrainNormal(x, z);
      const fuel = terrainFuel(x, z);
      const exposed = THREE.MathUtils.smoothstep(0.86 - normal.y, 0.02, 0.24);
      tint.copy(ochre).lerp(leafLitter, fuel * 0.72).lerp(moss, Math.max(0, fuel - 0.72) * 0.52);
      tint.lerp(stone, exposed * 0.68);
      const grit = 0.84 + hash2(column, row, 131) * 0.22;
      positions[p++] = x;
      positions[p++] = y;
      positions[p++] = z;
      colors[c++] = tint.r * grit;
      colors[c++] = tint.g * grit;
      colors[c++] = tint.b * grit;
      uvs[uv++] = u * 11;
      uvs[uv++] = v * 13;
    }
  }

  const stride = columns + 1;
  let cursor = 0;
  for (let row = 0; row < rows; ++row) {
    for (let column = 0; column < columns; ++column) {
      const a = row * stride + column;
      const b = a + stride;
      indices[cursor++] = a;
      indices[cursor++] = a + 1;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = a + 1;
      indices[cursor++] = b + 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTerrainSkirt(segmentsX = 96, segmentsZ = 128) {
  const perimeter = [];
  const halfWidth = TERRAIN_WIDTH * 0.5;
  for (let index = 0; index < segmentsX; ++index) {
    const t = index / segmentsX;
    perimeter.push([
      THREE.MathUtils.lerp(-halfWidth, halfWidth, t),
      TERRAIN_NEAR_Z,
    ]);
  }
  for (let index = 0; index < segmentsZ; ++index) {
    const t = index / segmentsZ;
    perimeter.push([
      halfWidth,
      THREE.MathUtils.lerp(TERRAIN_NEAR_Z, TERRAIN_FAR_Z, t),
    ]);
  }
  for (let index = 0; index < segmentsX; ++index) {
    const t = index / segmentsX;
    perimeter.push([
      THREE.MathUtils.lerp(halfWidth, -halfWidth, t),
      TERRAIN_FAR_Z,
    ]);
  }
  for (let index = 0; index < segmentsZ; ++index) {
    const t = index / segmentsZ;
    perimeter.push([
      -halfWidth,
      THREE.MathUtils.lerp(TERRAIN_FAR_Z, TERRAIN_NEAR_Z, t),
    ]);
  }

  const positions = new Float32Array(perimeter.length * 2 * 3);
  const indices = new Uint32Array(perimeter.length * 6);
  for (let index = 0; index < perimeter.length; ++index) {
    const [x, z] = perimeter[index];
    const y = terrainHeight(x, z) - 0.08;
    const offset = index * 6;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    positions[offset + 3] = x;
    positions[offset + 4] = y - TERRAIN_SKIRT_DEPTH;
    positions[offset + 5] = z;

    const next = (index + 1) % perimeter.length;
    const cursor = index * 6;
    indices[cursor] = index * 2;
    indices[cursor + 1] = next * 2;
    indices[cursor + 2] = index * 2 + 1;
    indices[cursor + 3] = index * 2 + 1;
    indices[cursor + 4] = next * 2;
    indices[cursor + 5] = next * 2 + 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Fog-dark terrain horizon skirt",
    color: 0x0b0d0b,
    side: THREE.DoubleSide,
    fog: true,
  });
  const skirt = new THREE.Mesh(geometry, material);
  skirt.name = "Edge-hiding mountainside skirt";
  skirt.userData.rtxIgnore = true;
  return skirt;
}

function createGroundMaterial() {
  const macro = mx_fractal_noise_float(positionWorld.mul(vec3(0.082, 0.12, 0.082)), 4, 2.03, 0.49)
    .mul(0.5).add(0.5);
  const grit = mx_fractal_noise_float(positionWorld.mul(vec3(0.74, 0.52, 0.74)), 3, 2.11, 0.47)
    .mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered mountainside soil and leaf litter",
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    clearcoat: 0.015,
    clearcoatRoughness: 0.95,
  });
  material.colorNode = attribute("color", "vec3").mul(
    mix(color(0x66503d), color(0x49563d), macro.mul(0.62).add(grit.mul(0.16))),
  );
  // The authored vertex field distinguishes ochre soil, litter, moss and
  // exposed rock; this analytic normal adds close dirt and litter relief.
  material.normalNode = bumpMap(macro.mul(0.09).add(grit.mul(0.025)), 0.36);
  material.roughnessNode = mix(float(0.86), float(0.99), grit);
  return material;
}

function createRockGeometry(radius = 1, seed = 1) {
  const geometry = new THREE.IcosahedronGeometry(radius, 2);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; ++index) {
    let x = positions.getX(index);
    let y = positions.getY(index);
    let z = positions.getZ(index);
    const length = Math.max(1e-5, Math.hypot(x, y, z));
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const angular = Math.sin(Math.atan2(nz, nx) * 5 + seed * 1.7) * 0.055;
    const chip = (hash2(Math.round(nx * 8), Math.round(nz * 8), seed) - 0.5) * 0.13;
    const scale = 0.92 + angular + chip;
    x *= scale * (1.08 + Math.sin(seed * 2.4) * 0.12);
    z *= scale * (0.92 + Math.cos(seed * 1.8) * 0.10);
    y *= scale * (ny > 0 ? 0.66 : 0.48);
    positions.setXYZ(index, x, y, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function seededRandom(seed = 0x726f636b) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createRockField() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Moonlit sandstone outcrops",
    color: 0x3d362d,
    roughness: 0.88,
    metalness: 0.015,
  });
  const geometry = createRockGeometry(1, 17);
  const count = 112;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const random = seededRandom(0x6d6f756e);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; ++index) {
    const majorOutcrop = index < 24;
    let x;
    let z;
    do {
      if (majorOutcrop) {
        const side = index % 2 ? 1 : -1;
        x = side * (82 + random() * 142);
        z = THREE.MathUtils.lerp(82, -455, Math.pow(random(), 0.78));
      } else {
        x = (random() * 2 - 1) * 248;
        z = THREE.MathUtils.lerp(142, -495, Math.pow(random(), 0.82));
      }
    } while (Math.abs(x - managementTrackX(z)) < (majorOutcrop ? 8 : 4.2));
    const size = majorOutcrop
      ? 3.8 + Math.pow(random(), 1.35) * 8.2
      : 0.28 + Math.pow(random(), 2.15) * 2.9;
    dummy.position.set(x, terrainHeight(x, z) + size * (majorOutcrop ? 0.12 : 0.22), z);
    dummy.rotation.set((random() - 0.5) * 0.22, random() * Math.PI * 2, (random() - 0.5) * 0.22);
    dummy.scale.set(
      size * (majorOutcrop ? 1.15 + random() * 1.35 : 0.72 + random() * 0.75),
      size * (majorOutcrop ? 0.38 + random() * 0.34 : 0.42 + random() * 0.42),
      size * (majorOutcrop ? 0.82 + random() * 1.18 : 0.76 + random() * 0.68),
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "Scattered eroded sandstone, granite, and ridge outcrops";
  mesh.computeBoundingSphere?.();
  return mesh;
}

function createManagementTrack() {
  const points = [];
  const halfWidth = 1.18;
  const segments = 224;
  for (let index = 0; index <= segments; ++index) {
    const t = index / segments;
    const z = THREE.MathUtils.lerp(135, -360, t);
    const centerX = managementTrackX(z);
    const nextZ = z - 0.2;
    const nextX = managementTrackX(nextZ);
    const tangent = new THREE.Vector2(nextX - centerX, nextZ - z).normalize();
    const side = new THREE.Vector2(-tangent.y, tangent.x);
    for (const sign of [-1, 1]) {
      const x = centerX + side.x * halfWidth * sign;
      const sampleZ = z + side.y * halfWidth * sign;
      points.push(x, terrainHeight(x, sampleZ) + 0.035, sampleZ);
    }
  }
  const indices = [];
  for (let index = 0; index < segments; ++index) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Dry management track",
    color: 0x5a4936,
    roughness: 1,
    metalness: 0,
  });
  const track = new THREE.Mesh(geometry, material);
  track.name = "Winding fire-management track";
  track.receiveShadow = true;
  return track;
}

export function createMountainside() {
  const group = new THREE.Group();
  group.name = "Procedural bushfire mountainside";

  const terrain = new THREE.Mesh(buildTerrainGeometry(), createGroundMaterial());
  terrain.name = "Continuous terrain receiver";
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  group.add(terrain);

  const skirt = createTerrainSkirt();
  const rocks = createRockField();
  const track = createManagementTrack();
  group.add(skirt, rocks, track);

  return {
    group,
    terrain,
    skirt,
    rocks,
    track,
    rtxRoots: [terrain, rocks],
    bounds: {
      minX: -TERRAIN_WIDTH * 0.5,
      maxX: TERRAIN_WIDTH * 0.5,
      minZ: TERRAIN_FAR_Z,
      maxZ: TERRAIN_NEAR_Z,
    },
    dispose() {
      group.traverse(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
        else object.material?.dispose?.();
      });
    },
  };
}
