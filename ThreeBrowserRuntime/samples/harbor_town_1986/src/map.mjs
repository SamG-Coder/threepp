/** Walkable Minamihama plan, metres. +X east, +Z south. Hill north, harbor south. */

function terrainBaseHeight(x, z) {
  x = Number(x);
  z = Number(z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  let y = 0;
  if (z < -12) {
    const t = Math.min(1, Math.max(0, (-z - 12) / 34));
    y = t * 8;
    if (x >= -24 && x <= -16) y -= 0.4 * t;
  } else if (z > 88) {
    y = -0.45;
  } else if (z >= 52) {
    y = 0.05;
  } else if (z >= 48) {
    y = 0;
  } else if (x > 18 && z >= 12 && z <= 28) {
    y = 0.02;
  }
  return y;
}

// Rigid orbit-reconstructed houses need level ground. These are terrain pads,
// not replacement models: each blends back into the authored hill over 3 m.
// That feather is wider than the height field's diagonal sample pitch.
const TERRACE_FEATHER = 3;
export const HILL_TERRACES = Object.freeze([
  { x: -28, z: -34, yaw: 0.42, width: 8.2, depth: 7.6 },
  { x: -38, z: -40, yaw: 0.2, width: 8.2, depth: 7.6 },
  { x: -38, z: -22, yaw: 0.35, width: 8.2, depth: 7.6 },
  { x: -10.5, z: -30, yaw: -1.35, width: 8.2, depth: 7.6 },
  { x: -42, z: -30, yaw: 0.7, width: 8.2, depth: 7.6 },
  { x: -12, z: -46, yaw: 0.15, width: 8.2, depth: 7.6 },
]);

function terraceWeight(pad, x, z) {
  const dx = x - pad.x;
  const dz = z - pad.z;
  const c = Math.cos(pad.yaw);
  const s = Math.sin(pad.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const outside = Math.max(Math.abs(lx) - pad.width * 0.5, Math.abs(lz) - pad.depth * 0.5);
  if (outside >= TERRACE_FEATHER) return 0;
  if (outside <= 0) return 1;
  const t = 1 - outside / TERRACE_FEATHER;
  return t * t * (3 - 2 * t);
}

export function groundHeight(x, z) {
  x = Number(x);
  z = Number(z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const base = terrainBaseHeight(x, z);
  let weight = 0;
  let target = base;
  for (const pad of HILL_TERRACES) {
    const next = terraceWeight(pad, x, z);
    if (next <= weight) continue;
    weight = next;
    target = terrainBaseHeight(pad.x, pad.z);
  }
  return base + (target - base) * weight;
}

// Height field in main extends well beyond the fly bounds, with vertex Y = groundHeight.
// Opaque paved tiles sit above it; flat road paint receives a further small lift.
export const DOCK_SURFACE_Y = 0.08;
export const WATER_SURFACE_Y = -0.4;

export const GROUND = Object.freeze({
  asphalt: { minX: -48, maxX: 48, minZ: -8, maxZ: 12, y: 0.015, color: 0x3a3a3c },
  sidewalkN: { minX: -40, maxX: 40, minZ: -12, maxZ: -6, y: 0.08, color: 0xb7b1a4 },
  sidewalkS: { minX: -40, maxX: 40, minZ: 6, maxZ: 10, y: 0.08, color: 0xb7b1a4 },
  alley: { minX: 18, maxX: 42, minZ: 10, maxZ: 28, y: 0.04, color: 0x6a5e52 },
  park: { minX: -44, maxX: -12, minZ: -48, maxZ: -16, y: -0.02, color: 0x4a5c3a },
  dock: { minX: -40, maxX: 48, minZ: 52, maxZ: 88, y: DOCK_SURFACE_Y, color: 0x8a8680 },
  water: { minX: -400, maxX: 400, minZ: 88, maxZ: 480, y: WATER_SURFACE_Y, color: 0x2a4458 },
  // Meet Sakae asphalt at one z=12 edge; the former z=10..12 overlap z-fought.
  route16Road: { minX: -46.5, maxX: -36.5, minZ: 12, maxZ: 52, y: 0.015, color: 0x3a3a3c },
  route16Quay: { minX: -47, maxX: -40.2, minZ: 50, maxZ: 84, y: 0.065, color: 0x3a3a3c },
  route16Lot: { minX: -34.5, maxX: -25.5, minZ: 20, maxZ: 34, y: 0.02, color: 0x4c4a46 },
  route16Walk: { minX: -36.5, maxX: -34.5, minZ: 10, maxZ: 50, y: 0.08, color: 0xb7b1a4 },
});

export const STAIR_SPEC = Object.freeze({
  x: -20,
  width: 6.5,
  z0: -12.4,
  run: 1.05,
  tread: 1.12,
  steps: 12,
});

function contains(spec, x, z) {
  return x >= spec.minX && x <= spec.maxX && z >= spec.minZ && z <= spec.maxZ;
}

const PAVED_PATCH_NAMES = Object.freeze([
  "asphalt",
  "alley",
  "dock",
  "route16Road",
  "route16Quay",
  "route16Lot",
]);

/** Highest opaque paved surface at x/z, suitable for decals and road paint. */
export function pavedSurfaceHeight(x, z) {
  let y = groundHeight(x, z);
  for (const name of PAVED_PATCH_NAMES) {
    const patch = GROUND[name];
    if (contains(patch, x, z)) y = Math.max(y, patch.y);
  }
  return y;
}

export function stairSurfaceHeight(x, z) {
  const halfW = STAIR_SPEC.width * 0.5;
  const firstNorth = STAIR_SPEC.z0 + STAIR_SPEC.tread * 0.5;
  const lastSouth = STAIR_SPEC.z0 - (STAIR_SPEC.steps - 1) * STAIR_SPEC.run - STAIR_SPEC.tread * 0.5;
  if (x < STAIR_SPEC.x - halfW || x > STAIR_SPEC.x + halfW || z > firstNorth || z < lastSouth) return null;
  const index = Math.max(0, Math.min(STAIR_SPEC.steps - 1, Math.round((STAIR_SPEC.z0 - z) / STAIR_SPEC.run)));
  const centreZ = STAIR_SPEC.z0 - index * STAIR_SPEC.run;
  const yDown = groundHeight(STAIR_SPEC.x, centreZ + STAIR_SPEC.tread * 0.5);
  const yUp = groundHeight(STAIR_SPEC.x, centreZ - STAIR_SPEC.tread * 0.5);
  return yDown + Math.max(0.24, yUp - yDown + 0.1);
}

/** Highest authored walking surface at x/z, including stairs and raised paving. */
export function walkSurfaceHeight(x, z) {
  let y = groundHeight(x, z);
  const stairY = stairSurfaceHeight(x, z);
  if (Number.isFinite(stairY)) y = Math.max(y, stairY);
  for (const name of [
    "asphalt",
    "sidewalkN",
    "sidewalkS",
    "alley",
    "dock",
    "route16Road",
    "route16Quay",
    "route16Lot",
    "route16Walk",
  ]) {
    const patch = GROUND[name];
    if (contains(patch, x, z)) y = Math.max(y, patch.y);
  }
  return y;
}

export const SPAWN = Object.freeze({
  x: -20,
  y: 1.6,
  z: -26,
  yaw: 0.18,
  pitch: -0.2,
});

const LAND_PADS = Object.freeze([
  { minX: -44, maxX: -12, minZ: -46, maxZ: -12 },
  { minX: -24, maxX: -16, minZ: -36, maxZ: -8 },
  { minX: -48, maxX: 46, minZ: -12, maxZ: 12 },
  { minX: 18, maxX: 42, minZ: 10, maxZ: 28 },
  { minX: -8, maxX: 8, minZ: 10, maxZ: 52 },
  { minX: -47, maxX: -24, minZ: 10, maxZ: 84 },
  { minX: -40, maxX: 46, minZ: 52, maxZ: 87.2 },
]);

export function clampWalk(x, z) {
  let bestX = x;
  let bestZ = z;
  let bestD = Infinity;
  for (const pad of LAND_PADS) {
    const cx = Math.min(pad.maxX, Math.max(pad.minX, x));
    const cz = Math.min(pad.maxZ, Math.max(pad.minZ, z));
    const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
    if (d < bestD) {
      bestD = d;
      bestX = cx;
      bestZ = cz;
      if (d === 0) break;
    }
  }
  return { x: bestX, z: bestZ };
}

export const WALK_WAYPOINTS = Object.freeze([
  { id: "hill", x: -22, z: -28, look: [0, 1.4, 0] },
  { id: "stairs", x: -18, z: -14, look: [0, 1.4, 4] },
  { id: "sakae-west", x: -14, z: 0, look: [8, 1.6, -6] },
  { id: "sakae-east", x: 10, z: 0, look: [8, 1.6, -8] },
  { id: "harbor-gate", x: 0, z: 48, look: [-8, 2, 70] },
  { id: "quay", x: 0, z: 80, look: [0, 1, 100] },
]);
