import * as THREE from "three/webgpu";
import {
  attribute,
  bumpMap,
  float,
  mix,
  mx_fractal_noise_float,
  normalMap,
  normalize,
  positionWorld,
  texture,
  vec2,
  vec3,
} from "three/tsl";
import {
  SURFACE_TEXTURE_FAMILIES,
  applySurfaceTextureSet,
  disposeSurfaceTextureCache,
  getSurfaceTextureSet,
  getSurfaceTextureStats,
} from "./surface-textures.mjs";

// World convention shared with the flood solver: x crosses the gorge and z
// increases downstream.  The authored reach is almost a kilometre long, so a
// person-height camera reads it as landscape rather than a tabletop channel.
export const GORGE_BOUNDS = Object.freeze({
  minX: -340,
  maxX: 340,
  minZ: -680,
  maxZ: 300,
  upstreamZ: -680,
  downstreamZ: 300,
  width: 680,
  length: 980,
});

const TERRAIN_COLUMNS = 232;
const TERRAIN_ROWS = 320;
const TERRAIN_SKIRT_DEPTH = 190;
const UP = new THREE.Vector3(0, 1, 0);

function fract(value) {
  return value - Math.floor(value);
}

function hash2(x, z, seed = 0) {
  return fract(Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123);
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
  let amplitude = 0.53;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; ++octave) {
    sum += valueNoise(x * frequency, z * frequency, seed + octave * 29) * amplitude;
    total += amplitude;
    frequency *= 2.04;
    amplitude *= 0.48;
  }
  return sum / Math.max(total, 1e-6);
}

function smoothRange(value, minimum, maximum) {
  const t = THREE.MathUtils.clamp((value - minimum) / (maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
}

function seededRandom(seed = 0x676f7267) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Winding channel centre in world metres. */
export function channelCenterX(z) {
  return -10.5
    + Math.sin((z + 102) * 0.0108) * 25
    + Math.sin((z - 31) * 0.0275) * 7.2
    + Math.sin((z + 440) * 0.0041) * 10.5;
}

/** Unit vector following the downstream centreline. */
export function channelTangent(z, target = new THREE.Vector3()) {
  const epsilon = 0.8;
  const dx = channelCenterX(z + epsilon) - channelCenterX(z - epsilon);
  return target.set(dx, 0, epsilon * 2).normalize();
}

/** Bank-full half width. Pools widen downstream while two bedrock gates pinch. */
export function channelHalfWidth(z) {
  const downstream = smoothRange(z, GORGE_BOUNDS.minZ, GORGE_BOUNDS.maxZ);
  const gateA = Math.exp(-Math.pow((z + 382) / 72, 2));
  const gateB = Math.exp(-Math.pow((z - 28) / 58, 2));
  const pool = Math.exp(-Math.pow((z + 145) / 105, 2));
  return 16.5 + downstream * 11.5 + pool * 7.5 - gateA * 5.2 - gateB * 3.6;
}

/** Centre-line elevation. z increases in the direction of gravity-driven flow. */
export function channelFloorHeight(z) {
  const fall = (GORGE_BOUNDS.maxZ - z) * 0.039;
  const reachUndulation = Math.sin(z * 0.020 + 0.8) * 0.46
    + Math.sin(z * 0.061 - 1.3) * 0.16;
  const fallsLip = smoothRange(z, -442, -416) * (1 - smoothRange(z, -409, -377)) * 2.8;
  const lowerRapid = smoothRange(z, 75, 101) * (1 - smoothRange(z, 108, 146)) * 1.35;
  return -7.5 + fall + reachUndulation + fallsLip + lowerRapid;
}

/**
 * Continuous flood-bed sampler. It is intentionally independent of render
 * tessellation and is the source of truth for shallow-water depth and debris.
 */
export function bedHeight(x, z) {
  const center = channelCenterX(z);
  const halfWidth = channelHalfWidth(z);
  const dx = x - center;
  const normalized = THREE.MathUtils.clamp(dx / halfWidth, -1.3, 1.3);
  const crossfall = normalized * normalized * 1.85;
  const thalwegOffset = -halfWidth * (0.16 + Math.sin(z * 0.013) * 0.09);
  const thalweg = -0.82 * Math.exp(-Math.pow((dx - thalwegOffset) / (halfWidth * 0.31), 2));
  const gravelBars = (fbm(x * 0.047, z * 0.031, 73, 4) - 0.5) * 0.58;
  const cobbles = (fbm(x * 0.19 + 7.1, z * 0.17 - 3.8, 131, 3) - 0.5) * 0.14;
  const riffles = Math.sin(z * 0.117 + Math.sin(x * 0.16) * 0.8) * 0.09;
  return channelFloorHeight(z) + crossfall + thalweg + gravelBars + cobbles + riffles;
}

/** Full canyon surface, exactly coincident with bedHeight inside the channel. */
export function gorgeHeight(x, z) {
  const center = channelCenterX(z);
  const halfWidth = channelHalfWidth(z);
  const dx = x - center;
  const distance = Math.abs(dx);
  const west = dx < 0;

  // The western wall is close, tall and hard; the eastern side opens through
  // two old flood terraces before reaching a broken escarpment.
  const bankStart = halfWidth * 0.83;
  const innerBankWidth = west ? 11 : 18;
  const terraceWidth = west ? 24 : 47;
  const wallWidth = west ? 58 : 89;
  const innerBank = smoothRange(distance, bankStart, bankStart + innerBankWidth)
    * (west ? 12.5 : 8.7);
  const terrace = smoothRange(
    distance,
    bankStart + innerBankWidth,
    bankStart + innerBankWidth + terraceWidth,
  ) * (west ? 18 : 12);
  const wallStart = bankStart + innerBankWidth + terraceWidth;
  const wall = Math.pow(smoothRange(distance, wallStart, wallStart + wallWidth), west ? 0.56 : 0.68)
    * (west ? 105 : 83);
  const upperShoulder = Math.pow(smoothRange(distance, wallStart + wallWidth, 305), 1.22)
    * (west ? 29 : 38);

  const wallMask = smoothRange(distance, bankStart + 6, wallStart + wallWidth);
  const broadRock = (fbm(x * 0.0102 + 4.5, z * 0.0093 - 2.7, 19, 5) - 0.49)
    * (5 + wallMask * 18);
  const brokenFaces = (fbm(x * 0.034 - 8.1, z * 0.029 + 5.4, 47, 4) - 0.5)
    * wallMask * 7.8;
  const strata = Math.sin((channelFloorHeight(z) + wall) * 0.46 + z * 0.026)
    * wallMask * 1.45;

  // Side gullies cut recognizable notches through the skyline and stop the
  // kilometre-long walls from becoming two smooth parallel rails.
  const sideSign = west ? -1 : 1;
  const gullyAxisA = channelCenterX(z) + sideSign * (115 + Math.sin(z * 0.008) * 23);
  const gullyAxisB = channelCenterX(z) + sideSign * (214 + Math.sin(z * 0.005 + 1.8) * 31);
  const ravineA = -Math.exp(-Math.pow((x - gullyAxisA) / 17, 2))
    * (8 + smoothRange(distance, 70, 190) * 15);
  const ravineB = -Math.exp(-Math.pow((x - gullyAxisB) / 25, 2))
    * smoothRange(distance, 135, 280) * 19;

  const longitudinalMassif = Math.sin(z * 0.0071 + (west ? 0.4 : 2.2))
    * wallMask * (west ? 7.5 : 5.2);
  return bedHeight(x, z) + innerBank + terrace + wall + upperShoulder
    + broadRock + brokenFaces + strata + ravineA + ravineB + longitudinalMassif;
}

export const terrainHeight = gorgeHeight;

export function gorgeNormal(x, z, target = new THREE.Vector3()) {
  const epsilon = 0.8;
  const left = gorgeHeight(x - epsilon, z);
  const right = gorgeHeight(x + epsilon, z);
  const upstream = gorgeHeight(x, z - epsilon);
  const downstream = gorgeHeight(x, z + epsilon);
  return target.set(left - right, epsilon * 2, upstream - downstream).normalize();
}

export function bedNormal(x, z, target = new THREE.Vector3()) {
  const epsilon = 0.42;
  const left = bedHeight(x - epsilon, z);
  const right = bedHeight(x + epsilon, z);
  const upstream = bedHeight(x, z - epsilon);
  const downstream = bedHeight(x, z + epsilon);
  return target.set(left - right, epsilon * 2, upstream - downstream).normalize();
}

/** 0=dry upper wall, 1=frequently submerged or spray-darkened rock. */
export function gorgeWetness(x, z) {
  const distance = Math.abs(x - channelCenterX(z));
  const halfWidth = channelHalfWidth(z);
  const channel = 1 - smoothRange(distance, halfWidth * 0.64, halfWidth * 1.13);
  const sprayA = Math.exp(-Math.pow((z + 395) / 54, 2));
  const sprayB = Math.exp(-Math.pow((z - 108) / 39, 2));
  const dampBank = (1 - smoothRange(distance, halfWidth, halfWidth + 14))
    * Math.max(sprayA, sprayB) * 0.45;
  const seep = fbm(x * 0.021, z * 0.019, 211, 4) > 0.61
    ? (1 - smoothRange(distance, halfWidth, halfWidth + 58)) * 0.18
    : 0;
  return THREE.MathUtils.clamp(channel * 0.88 + dampBank + seep, 0, 1);
}

export function isInChannel(x, z, margin = 0) {
  return Math.abs(x - channelCenterX(z)) <= channelHalfWidth(z) + margin;
}

function buildGorgeGeometry(columns = TERRAIN_COLUMNS, rows = TERRAIN_ROWS) {
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const wetness = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(columns * rows * 6);
  const wetStone = new THREE.Color(0x202b2c);
  const gravel = new THREE.Color(0x4a4740);
  const warmRock = new THREE.Color(0x5d5045);
  const paleFace = new THREE.Color(0x6b6156);
  const moss = new THREE.Color(0x273a31);
  const tint = new THREE.Color();
  let p = 0;
  let c = 0;
  let uv = 0;

  for (let row = 0; row <= rows; ++row) {
    const v = row / rows;
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.maxZ, GORGE_BOUNDS.minZ, v);
    for (let column = 0; column <= columns; ++column) {
      const u = column / columns;
      const x = THREE.MathUtils.lerp(GORGE_BOUNDS.minX, GORGE_BOUNDS.maxX, u);
      const y = gorgeHeight(x, z);
      const normal = gorgeNormal(x, z);
      const wet = gorgeWetness(x, z);
      const wallExposure = smoothRange(1 - normal.y, 0.18, 0.78);
      const rockBand = 0.5 + Math.sin(y * 0.29 + z * 0.018) * 0.5;
      const micro = 0.86 + hash2(column, row, 331) * 0.22;
      tint.copy(gravel)
        .lerp(warmRock, wallExposure * 0.74)
        .lerp(paleFace, wallExposure * rockBand * 0.28)
        .lerp(wetStone, wet * 0.82)
        .lerp(moss, wet * wallExposure * 0.22)
        .multiplyScalar(micro);
      positions[p++] = x;
      positions[p++] = y;
      positions[p++] = z;
      colors[c++] = tint.r;
      colors[c++] = tint.g;
      colors[c++] = tint.b;
      wetness[row * (columns + 1) + column] = wet;
      // A few landscape-scale tiles preserve geological mass. Do not repeat
      // tangent-space strata hundreds of times over steep heightfield walls.
      uvs[uv++] = u * 1.5;
      uvs[uv++] = v * 2;
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
  geometry.setAttribute("wetness", new THREE.BufferAttribute(wetness, 1));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createGorgeMaterial() {
  const dryMaps = getSurfaceTextureSet(SURFACE_TEXTURE_FAMILIES.DRY_GORGE);
  const wetMaps = getSurfaceTextureSet(SURFACE_TEXTURE_FAMILIES.WET_CHANNEL_ROCK);
  const macro = mx_fractal_noise_float(positionWorld.mul(vec3(0.027, 0.035, 0.027)), 4, 2.03, 0.49)
    .mul(0.5).add(0.5);
  const grain = mx_fractal_noise_float(positionWorld.mul(vec3(0.33, 0.24, 0.33)), 3, 2.11, 0.47)
    .mul(0.5).add(0.5);
  const wet = attribute("wetness", "float");
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Layered wet and dry moonlit gorge stone",
    vertexColors: true,
    roughness: 0.87,
    metalness: 0.012,
    clearcoat: 0.06,
    clearcoatRoughness: 0.5,
  });
  const mappedAlbedo = mix(texture(dryMaps.albedo).rgb, texture(wetMaps.albedo).rgb, wet);
  const authoredAlbedo = attribute("color", "vec3");
  material.colorNode = mix(authoredAlbedo, mappedAlbedo, 0.18)
    .mul(float(0.84).add(macro.mul(0.16)).add(grain.mul(0.055)))
    .clamp(0, 1);
  const mappedNormal = normalMap(
    mix(texture(dryMaps.normal).rgb, texture(wetMaps.normal).rgb, wet),
    vec2(0.12, 0.12),
  );
  const proceduralNormal = bumpMap(macro.mul(0.09).add(grain.mul(0.028)), 0.19);
  // Steep heightfield walls heavily shear tangent UVs. Keep the generated map
  // as fine grain, but let stable world-space noise own the broad normal so
  // strata never turn into hundreds of zebra contours on the canyon face.
  material.normalNode = normalize(mix(proceduralNormal, mappedNormal, 0.08));
  const mappedRoughness = mix(
    texture(dryMaps.roughness).g,
    texture(wetMaps.roughness).g,
    wet,
  );
  material.roughnessNode = mix(float(0.98), float(0.72), wet)
    .mul(mappedRoughness)
    .clamp(0.16, 0.98);
  material.clearcoatNode = wet.mul(0.21).add(0.012);
  material.rtxUsesResolvedPbr = 1;
  material.userData.surfaceTextureFamily = "dryGorge+wetChannelRock";
  return material;
}

function createTerrainSkirt() {
  const perimeter = [];
  const segmentsX = 78;
  const segmentsZ = 116;
  for (let i = 0; i < segmentsX; ++i) {
    const t = i / segmentsX;
    perimeter.push([THREE.MathUtils.lerp(GORGE_BOUNDS.minX, GORGE_BOUNDS.maxX, t), GORGE_BOUNDS.maxZ]);
  }
  for (let i = 0; i < segmentsZ; ++i) {
    const t = i / segmentsZ;
    perimeter.push([GORGE_BOUNDS.maxX, THREE.MathUtils.lerp(GORGE_BOUNDS.maxZ, GORGE_BOUNDS.minZ, t)]);
  }
  for (let i = 0; i < segmentsX; ++i) {
    const t = i / segmentsX;
    perimeter.push([THREE.MathUtils.lerp(GORGE_BOUNDS.maxX, GORGE_BOUNDS.minX, t), GORGE_BOUNDS.minZ]);
  }
  for (let i = 0; i < segmentsZ; ++i) {
    const t = i / segmentsZ;
    perimeter.push([GORGE_BOUNDS.minX, THREE.MathUtils.lerp(GORGE_BOUNDS.minZ, GORGE_BOUNDS.maxZ, t)]);
  }

  const positions = new Float32Array(perimeter.length * 6);
  const indices = new Uint32Array(perimeter.length * 6);
  for (let i = 0; i < perimeter.length; ++i) {
    const [x, z] = perimeter[i];
    const top = gorgeHeight(x, z) - 0.25;
    const p = i * 6;
    positions[p] = x;
    positions[p + 1] = top;
    positions[p + 2] = z;
    positions[p + 3] = x;
    positions[p + 4] = top - TERRAIN_SKIRT_DEPTH;
    positions[p + 5] = z;
    const next = (i + 1) % perimeter.length;
    const k = i * 6;
    indices[k] = i * 2;
    indices[k + 1] = next * 2;
    indices[k + 2] = i * 2 + 1;
    indices[k + 3] = i * 2 + 1;
    indices[k + 4] = next * 2;
    indices[k + 5] = next * 2 + 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Fog-dark gorge horizon skirt",
    color: 0x080b0c,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Gorge boundary-hiding rock skirt";
  mesh.userData.rtxIgnore = true;
  return mesh;
}

function createDeformedRockGeometry(detail = 1, seed = 1) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; ++i) {
    let x = positions.getX(i);
    let y = positions.getY(i);
    let z = positions.getZ(i);
    const length = Math.max(Math.hypot(x, y, z), 1e-5);
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const chip = (hash2(Math.round(nx * 11), Math.round(nz * 11), seed + Math.round(ny * 9)) - 0.5) * 0.17;
    const band = Math.sin((ny + 1) * 9.4 + seed) * 0.045;
    const scale = 0.91 + chip + band;
    x *= scale * (1.04 + Math.sin(seed * 1.7) * 0.08);
    y *= scale * (ny > 0 ? 0.78 : 0.63);
    z *= scale * (0.96 + Math.cos(seed * 1.3) * 0.07);
    positions.setXYZ(i, x, y, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function setInstanceAlong(object, start, end, radius) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  object.position.copy(start).addScaledVector(direction, 0.5);
  object.quaternion.setFromUnitVectors(UP, direction.normalize());
  object.scale.set(radius, length, radius);
  object.updateMatrix();
}

function createBoulderFields() {
  const geometry = createDeformedRockGeometry(1, 23);
  const dryMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Dry fractured talus",
    color: 0x51483f,
    roughness: 0.91,
    metalness: 0.01,
  });
  const wetMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Flood-polished wet boulders",
    color: 0x293235,
    roughness: 0.25,
    metalness: 0.025,
    clearcoat: 0.25,
    clearcoatRoughness: 0.31,
  });
  applySurfaceTextureSet(dryMaterial, SURFACE_TEXTURE_FAMILIES.BOULDER_STONE, {
    tint: 0xc6bbac,
    roughness: 1,
    normalStrength: 0.78,
  });
  applySurfaceTextureSet(wetMaterial, SURFACE_TEXTURE_FAMILIES.WET_CHANNEL_ROCK, {
    tint: 0xb4c0c2,
    roughness: 0.74,
    normalStrength: 0.64,
  });
  const dryCount = 300;
  const wetCount = 176;
  const dry = new THREE.InstancedMesh(geometry, dryMaterial, dryCount);
  const wet = new THREE.InstancedMesh(geometry, wetMaterial, wetCount);
  const random = seededRandom(0x74616c75);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < dryCount; ++i) {
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.minZ + 20, GORGE_BOUNDS.maxZ - 18, random());
    const side = random() < 0.52 ? -1 : 1;
    const halfWidth = channelHalfWidth(z);
    const distance = halfWidth + 12 + Math.pow(random(), 1.7) * 155;
    const x = channelCenterX(z) + side * distance;
    const size = 0.45 + Math.pow(random(), 2.25) * 4.8;
    dummy.position.set(x, gorgeHeight(x, z) + size * 0.25, z);
    dummy.rotation.set((random() - 0.5) * 0.38, random() * Math.PI * 2, (random() - 0.5) * 0.35);
    dummy.scale.set(size * (0.72 + random() * 1.12), size * (0.44 + random() * 0.55), size * (0.7 + random() * 1.2));
    dummy.updateMatrix();
    dry.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < wetCount; ++i) {
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.minZ + 12, GORGE_BOUNDS.maxZ - 10, random());
    const halfWidth = channelHalfWidth(z);
    const x = channelCenterX(z) + (random() * 2 - 1) * halfWidth * 0.91;
    const size = 0.24 + Math.pow(random(), 2.1) * 2.35;
    dummy.position.set(x, bedHeight(x, z) + size * 0.3, z);
    dummy.rotation.set((random() - 0.5) * 0.25, random() * Math.PI * 2, (random() - 0.5) * 0.25);
    dummy.scale.set(size * (0.72 + random() * 1.3), size * (0.43 + random() * 0.58), size * (0.74 + random() * 1.2));
    dummy.updateMatrix();
    wet.setMatrixAt(i, dummy.matrix);
  }
  for (const mesh of [dry, wet]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere?.();
  }
  dry.name = "Instanced upper-slope talus and fallen rock";
  wet.name = "Instanced polished channel boulders";
  return { dry, wet };
}

function createCliffStrata() {
  const geometry = new THREE.BoxGeometry(1, 1, 1, 2, 1, 3);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; ++i) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const chip = (hash2(Math.round((x + 1) * 7), Math.round((z + 1) * 9), 401 + i) - 0.5) * 0.12;
    positions.setXYZ(i, x + chip, y + chip * 0.42, z - chip * 0.65);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Moon-edged sedimentary ledges",
    color: 0x5b5046,
    roughness: 0.82,
    metalness: 0.008,
  });
  applySurfaceTextureSet(material, SURFACE_TEXTURE_FAMILIES.DRY_GORGE, {
    tint: 0xc7b9ac,
    roughness: 0.97,
    normalStrength: 0.5,
  });
  const count = 248;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const random = seededRandom(0x73747261);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; ++i) {
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.minZ + 12, GORGE_BOUNDS.maxZ - 12, random());
    const side = i % 2 ? 1 : -1;
    const halfWidth = channelHalfWidth(z);
    const distance = halfWidth + (side < 0 ? 38 : 63) + random() * (side < 0 ? 72 : 105);
    const x = channelCenterX(z) + side * distance;
    const slabLength = 8 + Math.pow(random(), 0.7) * 24;
    const slabHeight = 1.1 + random() * 4.3;
    dummy.position.set(x, gorgeHeight(x, z) + (random() - 0.42) * 2.2, z);
    dummy.rotation.set((random() - 0.5) * 0.08, (random() - 0.5) * 0.31, (random() - 0.5) * 0.06);
    dummy.scale.set(2.2 + random() * 5.8, slabHeight, slabLength);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "Broken horizontal cliff strata and moon-catching ledges";
  mesh.computeBoundingSphere?.();
  return mesh;
}

function createSparseVegetation() {
  const random = seededRandom(0x70696e65);
  const treeCount = 112;
  const canopyPerTree = 4;
  const trunkGeometry = new THREE.CylinderGeometry(0.72, 1, 1, 9, 2, false);
  const branchGeometry = new THREE.CylinderGeometry(0.55, 0.8, 1, 7, 1, false);
  const canopyGeometry = createDeformedRockGeometry(1, 59);
  const trunkMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Moonlit weathered gorge bark",
    color: 0x514941,
    roughness: 0.96,
    metalness: 0,
  });
  const canopyMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Sparse cool night foliage",
    color: 0x172a25,
    roughness: 0.88,
    metalness: 0,
  });
  applySurfaceTextureSet(trunkMaterial, SURFACE_TEXTURE_FAMILIES.BARK_LIVE_WOOD, {
    tint: 0xc0b3a7,
    roughness: 1,
    normalStrength: 0.86,
  });
  applySurfaceTextureSet(canopyMaterial, SURFACE_TEXTURE_FAMILIES.FOLIAGE_SHRUB, {
    tint: 0xa9bcae,
    roughness: 0.98,
    normalStrength: 0.32,
  });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const branches = new THREE.InstancedMesh(branchGeometry, trunkMaterial, treeCount * 2);
  const canopy = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, treeCount * canopyPerTree);
  const dummy = new THREE.Object3D();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  let branchIndex = 0;
  let canopyIndex = 0;

  for (let i = 0; i < treeCount; ++i) {
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.minZ + 18, GORGE_BOUNDS.maxZ - 32, random());
    const side = random() < 0.54 ? -1 : 1;
    const distance = channelHalfWidth(z) + 48 + Math.pow(random(), 0.75) * 220;
    const x = THREE.MathUtils.clamp(channelCenterX(z) + side * distance, GORGE_BOUNDS.minX + 9, GORGE_BOUNDS.maxX - 9);
    const ground = gorgeHeight(x, z);
    const height = 11 + Math.pow(random(), 0.72) * 18;
    const radius = 0.24 + height * 0.018 + random() * 0.12;
    const leanX = (random() - 0.5) * height * 0.055;
    const leanZ = (random() - 0.5) * height * 0.055;
    start.set(x, ground - 0.08, z);
    end.set(x + leanX, ground + height, z + leanZ);
    setInstanceAlong(dummy, start, end, radius);
    trunks.setMatrixAt(i, dummy.matrix);

    for (let fork = 0; fork < 2; ++fork) {
      const fraction = 0.53 + fork * 0.18 + random() * 0.06;
      start.set(
        x + leanX * fraction,
        ground + height * fraction,
        z + leanZ * fraction,
      );
      const angle = random() * Math.PI * 2;
      const branchLength = height * (0.19 + random() * 0.1);
      end.set(
        start.x + Math.cos(angle) * branchLength,
        start.y + branchLength * (0.27 + random() * 0.25),
        start.z + Math.sin(angle) * branchLength,
      );
      setInstanceAlong(dummy, start, end, radius * (0.36 - fork * 0.07));
      branches.setMatrixAt(branchIndex++, dummy.matrix);
    }

    for (let cluster = 0; cluster < canopyPerTree; ++cluster) {
      const angle = cluster * 2.39996 + random() * 0.7;
      const fraction = 0.58 + cluster * 0.10;
      const spread = height * (cluster === canopyPerTree - 1 ? 0.03 : 0.12 + random() * 0.07);
      const crownRadius = height * (0.105 + random() * 0.052);
      dummy.position.set(
        x + leanX * fraction + Math.cos(angle) * spread,
        ground + height * fraction + (random() - 0.25) * 1.4,
        z + leanZ * fraction + Math.sin(angle) * spread,
      );
      dummy.rotation.set(random() * 0.3, random() * Math.PI * 2, random() * 0.22);
      dummy.scale.set(crownRadius * (0.75 + random() * 0.5), crownRadius * (0.72 + random() * 0.45), crownRadius * (0.78 + random() * 0.52));
      dummy.updateMatrix();
      canopy.setMatrixAt(canopyIndex++, dummy.matrix);
    }
  }

  const shrubGeometry = createDeformedRockGeometry(0, 87);
  const shrubMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Sparse riverbank scrub",
    color: 0x21352a,
    roughness: 0.92,
  });
  applySurfaceTextureSet(shrubMaterial, SURFACE_TEXTURE_FAMILIES.FOLIAGE_SHRUB, {
    tint: 0xbdc9b4,
    roughness: 1,
    normalStrength: 0.28,
  });
  const shrubCount = 360;
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  for (let i = 0; i < shrubCount; ++i) {
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.minZ + 8, GORGE_BOUNDS.maxZ - 8, random());
    const side = random() < 0.5 ? -1 : 1;
    const x = channelCenterX(z) + side * (channelHalfWidth(z) + 7 + Math.pow(random(), 1.45) * 170);
    const size = 0.45 + Math.pow(random(), 1.8) * 1.75;
    dummy.position.set(x, gorgeHeight(x, z) + size * 0.37, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.set(size * (0.8 + random() * 0.7), size * (0.58 + random() * 0.56), size * (0.82 + random() * 0.68));
    dummy.updateMatrix();
    shrubs.setMatrixAt(i, dummy.matrix);
  }

  for (const mesh of [trunks, branches, canopy, shrubs]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere?.();
  }
  trunks.name = "Sparse old gorge trees";
  branches.name = "Irregular moonlit tree forks";
  canopy.name = "Separated high-detail foliage crowns";
  shrubs.name = "Instanced ledge and riverbank shrubs";
  return { trunks, branches, canopy, shrubs };
}

function createStrandedLogs() {
  const geometry = new THREE.CylinderGeometry(0.78, 1, 1, 9, 2, false);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Water-dark stranded timber",
    color: 0x352b24,
    roughness: 0.54,
    metalness: 0,
    clearcoat: 0.055,
    clearcoatRoughness: 0.64,
  });
  applySurfaceTextureSet(material, SURFACE_TEXTURE_FAMILIES.DEAD_SOAKED_WOOD, {
    tint: 0xb9ada3,
    roughness: 0.9,
    normalStrength: 0.72,
  });
  const count = 76;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const random = seededRandom(0x64726966);
  const dummy = new THREE.Object3D();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  for (let i = 0; i < count; ++i) {
    const z = THREE.MathUtils.lerp(GORGE_BOUNDS.minZ + 20, GORGE_BOUNDS.maxZ - 18, random());
    const side = random() < 0.5 ? -1 : 1;
    const halfWidth = channelHalfWidth(z);
    const x = channelCenterX(z) + side * halfWidth * (0.75 + random() * 0.48);
    const y = gorgeHeight(x, z) + 0.2;
    const angle = (random() - 0.5) * 1.9 + (side < 0 ? 0.15 : -0.15);
    const length = 3.8 + Math.pow(random(), 0.72) * 10.5;
    const radius = 0.16 + random() * 0.28;
    start.set(x - Math.sin(angle) * length * 0.5, y, z - Math.cos(angle) * length * 0.5);
    end.set(x + Math.sin(angle) * length * 0.5, y + (random() - 0.5) * 0.45, z + Math.cos(angle) * length * 0.5);
    setInstanceAlong(dummy, start, end, radius);
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "Stranded flood logs above the active channel";
  mesh.computeBoundingSphere?.();
  return mesh;
}

function channelAlignedGroup(name, z) {
  const group = new THREE.Group();
  const tangent = channelTangent(z);
  group.name = name;
  group.position.set(channelCenterX(z), bedHeight(channelCenterX(z), z), z);
  group.rotation.y = Math.atan2(tangent.x, tangent.z);
  return group;
}

function localLandmark(group, x, y, z) {
  group.updateMatrixWorld(true);
  return group.localToWorld(new THREE.Vector3(x, y, z));
}

function createSpillwayControlGate() {
  const z = -646;
  const group = channelAlignedGroup("Upstream concrete spillway and raised control gates", z);
  const halfWidth = channelHalfWidth(z);
  const clearSpan = halfWidth * 2 + 5;
  const concrete = new THREE.MeshPhysicalNodeMaterial({
    name: "Spray-darkened weathered spillway concrete",
    color: 0x5c6260,
    roughness: 0.67,
    metalness: 0.015,
    clearcoat: 0.09,
    clearcoatRoughness: 0.56,
  });
  const wetConcrete = new THREE.MeshPhysicalNodeMaterial({
    name: "Wet spillway apron concrete",
    color: 0x343e40,
    roughness: 0.31,
    metalness: 0.025,
    clearcoat: 0.28,
    clearcoatRoughness: 0.3,
  });
  const oxidizedSteel = new THREE.MeshPhysicalNodeMaterial({
    name: "Oxidized control-gate steel",
    color: 0x4b5555,
    roughness: 0.43,
    metalness: 0.72,
    clearcoat: 0.08,
    clearcoatRoughness: 0.51,
  });
  const safetyMetal = new THREE.MeshPhysicalNodeMaterial({
    name: "Dull galvanized spillway handrail",
    color: 0x768184,
    roughness: 0.39,
    metalness: 0.78,
  });
  applySurfaceTextureSet(concrete, SURFACE_TEXTURE_FAMILIES.CONCRETE, {
    tint: 0xd7d9d4,
    roughness: 0.92,
    normalStrength: 0.62,
  });
  applySurfaceTextureSet(wetConcrete, SURFACE_TEXTURE_FAMILIES.CONCRETE, {
    tint: 0x9daaad,
    roughness: 0.5,
    normalStrength: 0.48,
  });
  applySurfaceTextureSet(oxidizedSteel, SURFACE_TEXTURE_FAMILIES.DARK_METAL, {
    tint: 0xb9aaa0,
    roughness: 0.86,
    normalStrength: 0.78,
  });
  applySurfaceTextureSet(safetyMetal, SURFACE_TEXTURE_FAMILIES.DARK_METAL, {
    tint: 0xd7e1e2,
    roughness: 0.78,
    normalStrength: 0.42,
  });
  const unitBox = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const rtxRoots = [];

  function box(name, material, position, scale) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.scale.fromArray(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    rtxRoots.push(mesh);
    return mesh;
  }

  // The apron follows the active bed and projects downstream as a readable
  // hydraulic scale cue without sealing the water surface.
  const apron = box(
    "Broad wet concrete spillway apron",
    wetConcrete,
    [0, -0.18, 7.8],
    [clearSpan + 8, 0.6, 22],
  );
  const upstreamSill = box(
    "Rounded upstream control sill",
    wetConcrete,
    [0, 0.42, -3.5],
    [clearSpan + 4, 1.1, 3.8],
  );
  const overheadBeam = box(
    "Control gate overhead concrete beam",
    concrete,
    [0, 12.4, -1.4],
    [clearSpan + 10, 2.05, 3.2],
  );
  const serviceDeck = box(
    "Narrow spillway service deck",
    concrete,
    [0, 10.7, 1.5],
    [clearSpan + 12, 0.68, 4.4],
  );

  const pierCount = 4;
  const piers = new THREE.InstancedMesh(unitBox, concrete, pierCount);
  const pierDummy = new THREE.Object3D();
  for (let i = 0; i < pierCount; ++i) {
    const x = THREE.MathUtils.lerp(-clearSpan * 0.5, clearSpan * 0.5, i / (pierCount - 1));
    pierDummy.position.set(x, 5.5, -1.2);
    pierDummy.scale.set(i === 0 || i === pierCount - 1 ? 3.4 : 2.25, 11, 4.7);
    pierDummy.updateMatrix();
    piers.setMatrixAt(i, pierDummy.matrix);
  }
  piers.instanceMatrix.needsUpdate = true;
  piers.name = "Four spillway piers forming three clear flood passages";
  piers.castShadow = true;
  piers.receiveShadow = true;
  group.add(piers);
  rtxRoots.push(piers);

  const bayWidth = clearSpan / 3;
  const gates = new THREE.InstancedMesh(unitBox, oxidizedSteel, 3);
  for (let i = 0; i < 3; ++i) {
    pierDummy.position.set((i - 1) * bayWidth, 9.05, -0.78);
    // Gates are visibly raised: the lowest edge is about 6 m above the bed.
    pierDummy.scale.set(bayWidth - 2.7, 5.6, 0.42);
    pierDummy.updateMatrix();
    gates.setMatrixAt(i, pierDummy.matrix);
  }
  gates.instanceMatrix.needsUpdate = true;
  gates.name = "Three raised steel sluice gates with open water clearance";
  gates.castShadow = true;
  gates.receiveShadow = true;
  group.add(gates);
  rtxRoots.push(gates);

  const stepCount = 5;
  const steps = new THREE.InstancedMesh(unitBox, wetConcrete, stepCount);
  for (let i = 0; i < stepCount; ++i) {
    pierDummy.position.set(0, -0.46 - i * 0.13, 18.7 + i * 3.2);
    pierDummy.scale.set(clearSpan + 3 - i * 0.9, 0.42, 3.3);
    pierDummy.updateMatrix();
    steps.setMatrixAt(i, pierDummy.matrix);
  }
  steps.instanceMatrix.needsUpdate = true;
  steps.name = "Five submerged energy-dissipation steps";
  steps.receiveShadow = true;
  group.add(steps);
  rtxRoots.push(steps);

  const railSegments = new THREE.InstancedMesh(unitBox, safetyMetal, 14);
  let railIndex = 0;
  for (const sideZ of [-0.75, 3.75]) {
    for (const height of [11.55, 12.22]) {
      pierDummy.position.set(0, height, sideZ);
      pierDummy.scale.set(clearSpan + 11.2, 0.11, 0.11);
      pierDummy.updateMatrix();
      railSegments.setMatrixAt(railIndex++, pierDummy.matrix);
    }
    for (let post = 0; post < 5; ++post) {
      pierDummy.position.set(THREE.MathUtils.lerp(-(clearSpan + 10) * 0.5, (clearSpan + 10) * 0.5, post / 4), 11.55, sideZ);
      pierDummy.scale.set(0.12, 1.55, 0.12);
      pierDummy.updateMatrix();
      railSegments.setMatrixAt(railIndex++, pierDummy.matrix);
    }
  }
  railSegments.instanceMatrix.needsUpdate = true;
  railSegments.name = "Galvanized spillway service rails and posts";
  railSegments.castShadow = true;
  group.add(railSegments);
  rtxRoots.push(railSegments);

  const target = localLandmark(group, 0, 5.2, 8);
  return {
    group,
    apron,
    upstreamSill,
    overheadBeam,
    serviceDeck,
    piers,
    gates,
    steps,
    rails: railSegments,
    rtxRoots,
    target,
    position: group.position.clone(),
    bayCount: 3,
  };
}

function createInspectionBridge() {
  const z = 108;
  const group = channelAlignedGroup("Weathered narrow gorge inspection bridge", z);
  const halfWidth = channelHalfWidth(z);
  const span = (halfWidth + 29) * 2;
  const deckY = 31;
  const roadMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Wet weathered inspection bridge deck",
    color: 0x3e4140,
    roughness: 0.58,
    metalness: 0.02,
    clearcoat: 0.12,
    clearcoatRoughness: 0.44,
  });
  const bridgeConcrete = new THREE.MeshPhysicalNodeMaterial({
    name: "Stained bridge pier concrete",
    color: 0x65645e,
    roughness: 0.75,
    metalness: 0.01,
  });
  const bridgeSteel = new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered blue-grey bridge steel",
    color: 0x43545a,
    roughness: 0.46,
    metalness: 0.71,
    clearcoat: 0.06,
    clearcoatRoughness: 0.55,
  });
  applySurfaceTextureSet(roadMaterial, SURFACE_TEXTURE_FAMILIES.WET_ASPHALT, {
    tint: 0xc5c8c7,
    roughness: 0.86,
    normalStrength: 0.68,
  });
  applySurfaceTextureSet(bridgeConcrete, SURFACE_TEXTURE_FAMILIES.CONCRETE, {
    tint: 0xd8d4ca,
    roughness: 0.98,
    normalStrength: 0.58,
  });
  applySurfaceTextureSet(bridgeSteel, SURFACE_TEXTURE_FAMILIES.DARK_METAL, {
    tint: 0xb8cbd1,
    roughness: 0.9,
    normalStrength: 0.68,
  });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitBeam = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, false);
  const rtxRoots = [];

  function box(name, material, position, scale) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.scale.fromArray(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    rtxRoots.push(mesh);
    return mesh;
  }

  const deck = box("Five metre wide wet inspection road deck", roadMaterial, [0, deckY, 0], [span, 0.72, 5.2]);
  const girders = new THREE.InstancedMesh(unitBox, bridgeSteel, 2);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 2; ++i) {
    dummy.position.set(0, deckY - 1.05, i ? 1.82 : -1.82);
    dummy.scale.set(span - 1.8, 1.45, 0.42);
    dummy.updateMatrix();
    girders.setMatrixAt(i, dummy.matrix);
  }
  girders.instanceMatrix.needsUpdate = true;
  girders.name = "Twin weathered steel bridge girders";
  girders.castShadow = true;
  group.add(girders);
  rtxRoots.push(girders);

  const pierOffsets = [-(halfWidth + 8.5), halfWidth + 8.5];
  const piers = new THREE.InstancedMesh(unitBox, bridgeConcrete, 4);
  let pierIndex = 0;
  for (const offset of pierOffsets) {
    const localGround = 10.5;
    const height = deckY - 1.45 - localGround;
    for (const sideZ of [-1.42, 1.42]) {
      dummy.position.set(offset, localGround + height * 0.5, sideZ);
      dummy.scale.set(2.05, height, 1.65);
      dummy.updateMatrix();
      piers.setMatrixAt(pierIndex++, dummy.matrix);
    }
  }
  piers.instanceMatrix.needsUpdate = true;
  piers.name = "Four bank-set concrete bridge columns leaving channel clear";
  piers.castShadow = true;
  piers.receiveShadow = true;
  group.add(piers);
  rtxRoots.push(piers);

  const abutments = new THREE.InstancedMesh(unitBox, bridgeConcrete, 2);
  for (let i = 0; i < 2; ++i) {
    dummy.position.set((i ? 1 : -1) * span * 0.5, deckY - 2.15, 0);
    dummy.scale.set(3.8, 5.1, 8.8);
    dummy.updateMatrix();
    abutments.setMatrixAt(i, dummy.matrix);
  }
  abutments.instanceMatrix.needsUpdate = true;
  abutments.name = "Massive weathered bridge abutments";
  abutments.castShadow = true;
  abutments.receiveShadow = true;
  group.add(abutments);
  rtxRoots.push(abutments);

  const railPostsPerSide = 22;
  const railPieces = new THREE.InstancedMesh(unitBox, bridgeSteel, railPostsPerSide * 2 + 4);
  let railIndex = 0;
  for (const sideZ of [-2.48, 2.48]) {
    for (let i = 0; i < railPostsPerSide; ++i) {
      dummy.position.set(THREE.MathUtils.lerp(-span * 0.5, span * 0.5, i / (railPostsPerSide - 1)), deckY + 0.92, sideZ);
      dummy.scale.set(0.13, 1.85, 0.13);
      dummy.updateMatrix();
      railPieces.setMatrixAt(railIndex++, dummy.matrix);
    }
    for (const height of [deckY + 1.2, deckY + 1.82]) {
      dummy.position.set(0, height, sideZ);
      dummy.scale.set(span, 0.12, 0.12);
      dummy.updateMatrix();
      railPieces.setMatrixAt(railIndex++, dummy.matrix);
    }
  }
  railPieces.instanceMatrix.needsUpdate = true;
  railPieces.name = "Inspection bridge guard rails and closely spaced posts";
  railPieces.castShadow = true;
  group.add(railPieces);
  rtxRoots.push(railPieces);

  // Alternating low truss braces break up the long bridge silhouette and give
  // moon reflections a recognizable human-scale industrial structure.
  const braceSegments = 9;
  const braces = new THREE.InstancedMesh(unitBeam, bridgeSteel, braceSegments * 2);
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  let braceIndex = 0;
  for (const sideZ of [-2.34, 2.34]) {
    for (let i = 0; i < braceSegments; ++i) {
      const x0 = THREE.MathUtils.lerp(-span * 0.48, span * 0.48, i / braceSegments);
      const x1 = THREE.MathUtils.lerp(-span * 0.48, span * 0.48, (i + 1) / braceSegments);
      const flip = i % 2 === 0;
      start.set(x0, flip ? deckY - 1.55 : deckY + 0.15, sideZ);
      end.set(x1, flip ? deckY + 0.15 : deckY - 1.55, sideZ);
      setInstanceAlong(dummy, start, end, 0.16);
      braces.setMatrixAt(braceIndex++, dummy.matrix);
    }
  }
  braces.instanceMatrix.needsUpdate = true;
  braces.name = "Alternating steel bridge cross braces";
  braces.castShadow = true;
  group.add(braces);
  rtxRoots.push(braces);

  const target = localLandmark(group, 0, deckY - 7, 0);
  return {
    group,
    deck,
    girders,
    piers,
    abutments,
    rails: railPieces,
    braces,
    rtxRoots,
    target,
    position: group.position.clone(),
    spanMetres: span,
    deckClearanceMetres: deckY - 1.5,
  };
}

function distantMountainHeight(spec, x, z) {
  const edge = smoothRange(x, spec.minX, spec.minX + spec.edgeFade)
    * (1 - smoothRange(x, spec.maxX - spec.edgeFade, spec.maxX))
    * smoothRange(z, spec.minZ, spec.minZ + spec.edgeFade)
    * (1 - smoothRange(z, spec.maxZ - spec.edgeFade, spec.maxZ));
  let mountain = 0;
  for (const peak of spec.peaks) {
    const radial = Math.pow((x - peak.x) / peak.radiusX, 2)
      + Math.pow((z - peak.z) / peak.radiusZ, 2);
    mountain = Math.max(mountain, peak.height * Math.exp(-radial * 1.18));
  }
  const mass = mountain * edge;
  const detailMask = smoothRange(mass, 4, 95);
  const broad = (fbm(x * 0.0041, z * 0.0038, spec.seed, 5) - 0.5)
    * (12 + mass * 0.065);
  const brokenFaces = (fbm(x * 0.018, z * 0.016, spec.seed + 67, 4) - 0.5)
    * (4 + mass * 0.032);
  const drainage = Math.pow(
    0.5 + Math.sin(x * 0.024 + z * 0.009 + spec.seed) * 0.5,
    9,
  ) * (4 + mass * 0.035);
  const strata = Math.sin((spec.baseY + mass) * 0.15 + z * 0.013)
    * (1.2 + mass * 0.009);
  return spec.baseY + mass + (broad + brokenFaces - drainage + strata) * detailMask * edge;
}

function buildDistantMountainGeometry(spec) {
  const topCount = (spec.columns + 1) * (spec.rows + 1);
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const low = new THREE.Color(spec.lowColor);
  const high = new THREE.Color(spec.highColor);
  const shadow = new THREE.Color(spec.shadowColor);
  const tint = new THREE.Color();
  for (let row = 0; row <= spec.rows; ++row) {
    const v = row / spec.rows;
    const z = THREE.MathUtils.lerp(spec.maxZ, spec.minZ, v);
    for (let column = 0; column <= spec.columns; ++column) {
      const u = column / spec.columns;
      const x = THREE.MathUtils.lerp(spec.minX, spec.maxX, u);
      const y = distantMountainHeight(spec, x, z);
      const altitude = smoothRange(y, spec.baseY + 18, spec.baseY + 330);
      const rockVariation = hash2(column, row, spec.seed + 311);
      tint.copy(low)
        .lerp(high, altitude * 0.72)
        .lerp(shadow, (1 - rockVariation) * 0.16)
        .multiplyScalar(0.91 + rockVariation * 0.16);
      positions.push(x, y, z);
      colors.push(tint.r, tint.g, tint.b);
      uvs.push(u * spec.uvScaleX, v * spec.uvScaleZ);
    }
  }
  const stride = spec.columns + 1;
  for (let row = 0; row < spec.rows; ++row) {
    for (let column = 0; column < spec.columns; ++column) {
      const a = row * stride + column;
      const b = a + stride;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  // A closed perimeter gives the massifs real depth for oblique raster and
  // ray-traced views instead of exposing a one-sided heightfield card.
  const perimeter = [];
  for (let column = 0; column < spec.columns; ++column) perimeter.push(column);
  for (let row = 0; row < spec.rows; ++row) perimeter.push(row * stride + spec.columns);
  for (let column = spec.columns; column > 0; --column) perimeter.push(spec.rows * stride + column);
  for (let row = spec.rows; row > 0; --row) perimeter.push(row * stride);
  for (const topIndex of perimeter) {
    const p = topIndex * 3;
    const uv = topIndex * 2;
    positions.push(positions[p], spec.skirtY, positions[p + 2]);
    colors.push(shadow.r * 0.48, shadow.g * 0.48, shadow.b * 0.48);
    uvs.push(uvs[uv], uvs[uv + 1]);
  }
  for (let index = 0; index < perimeter.length; ++index) {
    const next = (index + 1) % perimeter.length;
    const a = perimeter[index];
    const b = perimeter[next];
    const c = topCount + index;
    const d = topCount + next;
    indices.push(a, b, c, c, b, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createDistantMountains() {
  const group = new THREE.Group();
  group.name = "Layered three-dimensional upstream mountain backdrop";
  const specs = [
    {
      name: "Broad near-horizon upstream mountain range",
      minX: -1500, maxX: 1500, minZ: -1580, maxZ: -1050,
      columns: 112, rows: 60, edgeFade: 76, baseY: -82, skirtY: -260,
      uvScaleX: 5, uvScaleZ: 2, seed: 0x6d6f756e,
      lowColor: 0xa39b91, highColor: 0xd4cdc3, shadowColor: 0x697272,
      peaks: [
        { x: -1120, z: -1320, height: 275, radiusX: 420, radiusZ: 205 },
        { x: -560, z: -1240, height: 325, radiusX: 380, radiusZ: 190 },
        { x: 210, z: -1280, height: 342, radiusX: 410, radiusZ: 205 },
        { x: 790, z: -1370, height: 315, radiusX: 390, radiusZ: 220 },
        { x: 1320, z: -1260, height: 250, radiusX: 330, radiusZ: 180 },
      ],
    },
    {
      name: "Far broad serrated upstream mountain range",
      minX: -1850, maxX: 1850, minZ: -2220, maxZ: -1480,
      columns: 104, rows: 52, edgeFade: 92, baseY: -132, skirtY: -310,
      uvScaleX: 6, uvScaleZ: 2, seed: 0x6261636b,
      lowColor: 0x818a89, highColor: 0xb2b3ae, shadowColor: 0x4e5b60,
      peaks: [
        { x: -1420, z: -1880, height: 340, radiusX: 480, radiusZ: 265 },
        { x: -650, z: -1800, height: 405, radiusX: 470, radiusZ: 250 },
        { x: 120, z: -1920, height: 445, radiusX: 520, radiusZ: 285 },
        { x: 930, z: -1810, height: 390, radiusX: 480, radiusZ: 255 },
        { x: 1580, z: -1950, height: 320, radiusX: 380, radiusZ: 240 },
      ],
    },
  ];
  const layers = [];
  for (let layer = 0; layer < specs.length; ++layer) {
    const spec = specs[layer];
    const material = new THREE.MeshPhysicalNodeMaterial({
      name: `${spec.name} weathered rock`,
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.006,
      side: THREE.DoubleSide,
      fog: true,
    });
    applySurfaceTextureSet(material, SURFACE_TEXTURE_FAMILIES.DRY_GORGE, {
      tint: layer === 0 ? 0xe1dad0 : 0xb9c1c1,
      roughness: 0.98,
      normalStrength: layer === 0 ? 0.34 : 0.22,
    });
    const mesh = new THREE.Mesh(buildDistantMountainGeometry(spec), material);
    mesh.name = spec.name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.rtxIgnore = true;
    group.add(mesh);
    layers.push(mesh);
  }
  const dominantPeak = new THREE.Vector3(
    210,
    distantMountainHeight(specs[0], 210, -1280),
    -1280,
  );
  return {
    group,
    layers,
    rtxRoots: [],
    dominantPeak,
    triangles: layers.reduce((sum, mesh) => sum + geometryTriangles(mesh.geometry), 0),
  };
}

const OUTER_UPLAND_BOUNDS = Object.freeze({
  minX: -1400,
  maxX: 1400,
  minZ: -1600,
  maxZ: 900,
});

function outerUplandHeight(x, z) {
  const seamX = THREE.MathUtils.clamp(x, GORGE_BOUNDS.minX, GORGE_BOUNDS.maxX);
  const seamZ = THREE.MathUtils.clamp(z, GORGE_BOUNDS.minZ, GORGE_BOUNDS.maxZ);
  const offsetX = x - seamX;
  const offsetZ = z - seamZ;
  const boundaryDistance = Math.hypot(offsetX, offsetZ);
  const detailFade = smoothRange(boundaryDistance, 0, 52);
  const seamHeight = gorgeHeight(seamX, seamZ);
  const plateauRise = smoothRange(boundaryDistance, 0, 390) * 72;
  const rolling = (fbm(x * 0.0018, z * 0.00165, 701, 5) - 0.5) * 74
    + (fbm(x * 0.0062, z * 0.0054, 769, 4) - 0.5) * 24;
  const longApron = z < GORGE_BOUNDS.minZ || z > GORGE_BOUNDS.maxZ;
  const channelDistance = Math.abs(x - channelCenterX(z));
  const valleyMask = longApron
    ? 1 - smoothRange(channelDistance, 48, 205)
    : 0;
  const continuedValley = valleyMask * smoothRange(boundaryDistance, 20, 420) * 58;
  const broadRidge = Math.sin(x * 0.0038 + z * 0.0019 + 0.7)
    * smoothRange(boundaryDistance, 90, 620) * 13;
  return seamHeight + plateauRise + (rolling + broadRidge) * detailFade - continuedValley;
}

function buildOuterUplandGeometry(spec) {
  const vertexCount = (spec.columns + 1) * (spec.rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(spec.columns * spec.rows * 6);
  const low = new THREE.Color(0x7d756c);
  const high = new THREE.Color(0xb5aa9e);
  const scrub = new THREE.Color(0x58645a);
  const tint = new THREE.Color();
  let positionCursor = 0;
  let colorCursor = 0;
  let uvCursor = 0;
  for (let row = 0; row <= spec.rows; ++row) {
    const v = row / spec.rows;
    const z = THREE.MathUtils.lerp(spec.maxZ, spec.minZ, v);
    for (let column = 0; column <= spec.columns; ++column) {
      const u = column / spec.columns;
      const x = THREE.MathUtils.lerp(spec.minX, spec.maxX, u);
      const y = outerUplandHeight(x, z);
      const variation = hash2(column, row, spec.seed);
      const elevation = smoothRange(y, 55, 220);
      tint.copy(low)
        .lerp(high, elevation * 0.55)
        .lerp(scrub, smoothRange(variation, 0.68, 0.94) * 0.18)
        .multiplyScalar(0.9 + variation * 0.17);
      positions[positionCursor++] = x;
      positions[positionCursor++] = y;
      positions[positionCursor++] = z;
      colors[colorCursor++] = tint.r;
      colors[colorCursor++] = tint.g;
      colors[colorCursor++] = tint.b;
      // World-continuous coordinates keep the four independently tessellated
      // patches visually joined at their exact geometric seams.
      uvs[uvCursor++] = (x - OUTER_UPLAND_BOUNDS.minX) / 150;
      uvs[uvCursor++] = (z - OUTER_UPLAND_BOUNDS.minZ) / 150;
    }
  }
  const stride = spec.columns + 1;
  let indexCursor = 0;
  for (let row = 0; row < spec.rows; ++row) {
    for (let column = 0; column < spec.columns; ++column) {
      const a = row * stride + column;
      const b = a + stride;
      indices[indexCursor++] = a;
      indices[indexCursor++] = a + 1;
      indices[indexCursor++] = b;
      indices[indexCursor++] = b;
      indices[indexCursor++] = a + 1;
      indices[indexCursor++] = b + 1;
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

function createOuterUplands() {
  const group = new THREE.Group();
  group.name = "Connected rolling outer uplands around the flood gorge";
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Continuous dry-rock and soil outer uplands",
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.006,
    fog: true,
  });
  applySurfaceTextureSet(material, SURFACE_TEXTURE_FAMILIES.DRY_GORGE, {
    tint: 0xd2c8bd,
    roughness: 0.98,
    normalStrength: 0.25,
  });
  const specs = [
    // Boundary subdivisions deliberately match the 232 x 320 gorge grid.
    // Splitting each apron in three also makes its outer pieces match the
    // adjacent side strips, eliminating T-junction cracks at every join.
    { name: "Western connected upland", minX: -1400, maxX: -340, minZ: -680, maxZ: 300, columns: 60, rows: TERRAIN_ROWS, seed: 811 },
    { name: "Eastern connected upland", minX: 340, maxX: 1400, minZ: -680, maxZ: 300, columns: 60, rows: TERRAIN_ROWS, seed: 823 },
    { name: "Northwest upstream apron", minX: -1400, maxX: -340, minZ: -1600, maxZ: -680, columns: 60, rows: 48, seed: 839 },
    { name: "Central upstream valley apron", minX: -340, maxX: 340, minZ: -1600, maxZ: -680, columns: TERRAIN_COLUMNS, rows: 48, seed: 839 },
    { name: "Northeast upstream apron", minX: 340, maxX: 1400, minZ: -1600, maxZ: -680, columns: 60, rows: 48, seed: 839 },
    { name: "Southwest downstream apron", minX: -1400, maxX: -340, minZ: 300, maxZ: 900, columns: 60, rows: 36, seed: 853 },
    { name: "Central downstream valley apron", minX: -340, maxX: 340, minZ: 300, maxZ: 900, columns: TERRAIN_COLUMNS, rows: 36, seed: 853 },
    { name: "Southeast downstream apron", minX: 340, maxX: 1400, minZ: 300, maxZ: 900, columns: 60, rows: 36, seed: 853 },
  ];
  const patches = specs.map(spec => {
    const mesh = new THREE.Mesh(buildOuterUplandGeometry(spec), material);
    mesh.name = spec.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  return {
    group,
    patches,
    rtxRoots: patches,
    bounds: OUTER_UPLAND_BOUNDS,
    triangles: patches.reduce((sum, mesh) => sum + geometryTriangles(mesh.geometry), 0),
  };
}

function geometryTriangles(geometry) {
  return geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
}

function expandedTriangles(object) {
  const instances = object.isInstancedMesh ? object.count : 1;
  return geometryTriangles(object.geometry) * instances;
}

/**
 * Creates the static canyon shell. The returned group is not added to a scene
 * automatically; callers retain control over registration and disposal.
 */
export function createGorgeEnvironment() {
  const group = new THREE.Group();
  group.name = "980 metre late-sunset flash-flood gorge";

  const terrain = new THREE.Mesh(buildGorgeGeometry(), createGorgeMaterial());
  terrain.name = "Continuous analytic gorge and riverbed";
  terrain.receiveShadow = true;
  terrain.castShadow = true;

  const skirt = createTerrainSkirt();
  const cliffs = createCliffStrata();
  const boulders = createBoulderFields();
  const vegetation = createSparseVegetation();
  const logs = createStrandedLogs();
  const spillway = createSpillwayControlGate();
  const bridge = createInspectionBridge();
  const uplands = createOuterUplands();
  const mountains = createDistantMountains();
  group.add(
    terrain,
    skirt,
    cliffs,
    boulders.dry,
    boulders.wet,
    vegetation.trunks,
    vegetation.branches,
    vegetation.canopy,
    vegetation.shrubs,
    logs,
    spillway.group,
    bridge.group,
    uplands.group,
    mountains.group,
  );

  const rtxRoots = [
    terrain,
    cliffs,
    boulders.dry,
    boulders.wet,
    vegetation.trunks,
    vegetation.branches,
    vegetation.canopy,
    vegetation.shrubs,
    logs,
    ...spillway.rtxRoots,
    ...bridge.rtxRoots,
    ...uplands.rtxRoots,
  ];
  const staticTriangles = rtxRoots.reduce((sum, object) => sum + expandedTriangles(object), 0);
  const textureStats = getSurfaceTextureStats();
  const stats = Object.freeze({
    reachLengthMetres: GORGE_BOUNDS.length,
    terrainTriangles: geometryTriangles(terrain.geometry),
    staticTriangles,
    rtxRoots: rtxRoots.length,
    cliffLedges: cliffs.count,
    dryBoulders: boulders.dry.count,
    wetBoulders: boulders.wet.count,
    trees: vegetation.trunks.count,
    canopyClusters: vegetation.canopy.count,
    shrubs: vegetation.shrubs.count,
    strandedLogs: logs.count,
    spillwayBays: spillway.bayCount,
    spillwayStaticParts: spillway.rtxRoots.length,
    bridgeSpanMetres: bridge.spanMetres,
    bridgeStaticParts: bridge.rtxRoots.length,
    outerUplandPatches: uplands.patches.length,
    outerUplandTriangles: uplands.triangles,
    outerUplandSpanMetres: Object.freeze([2800, 2500]),
    distantMountainLayers: mountains.layers.length,
    distantMountainTriangles: mountains.triangles,
    distantMountainsRtx: false,
    dominantMountainPeak: Object.freeze(mountains.dominantPeak.toArray()),
    surfaceTextureFamilies: textureStats.cachedFamilies,
    surfaceTextureMaps: textureStats.cachedTextures,
    surfaceTextureBytes: textureStats.byteLength,
  });

  return {
    group,
    terrain,
    skirt,
    cliffs,
    boulders,
    vegetation,
    logs,
    spillway,
    bridge,
    uplands,
    mountains,
    landmarks: Object.freeze({
      spillway: spillway.target.clone(),
      bridge: bridge.target.clone(),
      mountainPeak: mountains.dominantPeak.clone(),
    }),
    // Compatibility alias retained for callers that framed the former flat
    // upstream silhouettes. It now references genuine layered terrain.
    ridges: mountains.group,
    rtxRoots,
    bounds: GORGE_BOUNDS,
    stats,
    getStats() {
      return { ...stats };
    },
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      group.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
        else if (object.material) materials.add(object.material);
      });
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
      disposeSurfaceTextureCache();
      group.removeFromParent();
    },
  };
}

export const createGorge = createGorgeEnvironment;
