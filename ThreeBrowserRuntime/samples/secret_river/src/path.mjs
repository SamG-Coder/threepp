/**
 * Side-on 2.5D Hawkesbury bank.
 *
 * X is along the creek (left/right).
 * +Z is inland, away from the camera.
 * The creek occupies the near field so it sits at the BOTTOM of the screen.
 *
 *   z -10..14   creek / water (foreground)
 *   z  12..16   muddy shore and rocks
 *   z  16..24   playable dirt path
 *   z  24..48   midground bush
 *   z  48..80   far trees
 *   z  80..170  wooded hills
 */

export const WORLD = Object.freeze({
  minX: -96,
  maxX: 96,
  minZ: -28,
  maxZ: 170,
  waterMinZ: -22,
  waterMaxZ: 14,
  shoreZ: 14.2,
  pathMinZ: 16.2,
  pathMaxZ: 24.4,
  waterHeight: 0.02,
  roadWidth: 4.4,
});

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hash2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function valueNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z) {
  return valueNoise(x, z) * 0.62
    + valueNoise(x * 2.13, z * 2.07) * 0.26
    + valueNoise(x * 4.31, z * 4.19) * 0.12;
}

export function roadCenterZ(x) {
  return 19.4
    + Math.sin(x * 0.034) * 1.15
    + Math.sin(x * 0.011 + 1.1) * 0.55;
}

export function riverEdgeZ(x) {
  const weave = Math.sin(x * 0.041 + 0.4) * 2.45
    + Math.sin(x * 0.097 + 1.7) * 1.35
    + Math.sin(x * 0.21 + 0.2) * 0.55
    + (fbm(x * 0.07, 3.1) - 0.5) * 2.0;
  const spit = Math.exp(-((x + 1.5) ** 2) / 36) * 3.4
    + Math.exp(-((x - 18) ** 2) / 28) * 2.2
    + Math.exp(-((x + 22) ** 2) / 22) * 1.8;
  return clamp(WORLD.shoreZ + weave - spit, 8.4, WORLD.pathMinZ - 1.35);
}

export function farBankZ(x) {
  return 46 + Math.sin(x * 0.017) * 3.2;
}

export function terrainHeight(x, z) {
  const n = (fbm(x * 0.038, z * 0.042) - 0.5) * 0.72;
  const fine = (fbm(x * 0.17, z * 0.16) - 0.5) * 0.12;
  const shore = riverEdgeZ(x);
  const road = roadCenterZ(x);
  const inWater = 1 - smoothstep(WORLD.waterMinZ, shore - 0.4, z);
  const bankRise = smoothstep(shore - 0.8, road + 1.2, z);
  const bankTop = 1.85 + n * 0.12 + fine;
  const inland = bankTop + Math.max(0, z - road) * 0.035;
  const path = bankTop - 0.06;
  const mud = 0.22 + n * 0.05;
  const bed = -0.55 + n * 0.03;
  if (z < shore - 0.15) {
    const channel = bed * inWater + mud * (1 - inWater);
    return Math.min(WORLD.waterHeight - 0.08, channel);
  }
  const rise = smoothstep(shore, road - 1.6, z);
  const mixBank = mud * (1 - rise) + inland * rise;
  const roadMask = Math.exp(-((z - road) ** 2) / (2.4 ** 2));
  return mixBank * (1 - roadMask) + path * roadMask;
}

export function isWalkable(x, z) {
  if (x < WORLD.minX + 2 || x > WORLD.maxX - 2) return false;
  if (z < WORLD.pathMinZ || z > WORLD.pathMaxZ) return false;
  return terrainHeight(x, z) > WORLD.waterHeight + 0.35;
}

export function clampToBank(x, z) {
  const nextX = clamp(x, WORLD.minX + 2, WORLD.maxX - 2);
  let nextZ = clamp(z, WORLD.pathMinZ, WORLD.pathMaxZ);
  if (!isWalkable(nextX, nextZ)) nextZ = roadCenterZ(nextX);
  return {
    x: nextX,
    z: nextZ,
    y: terrainHeight(nextX, nextZ),
  };
}

export function spawnOnRoad(x = 0) {
  const z = roadCenterZ(x);
  return { x, z, y: terrainHeight(x, z) };
}
