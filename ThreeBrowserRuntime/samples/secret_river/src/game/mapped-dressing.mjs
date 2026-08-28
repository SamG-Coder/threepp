import { FLORA_KINDS } from "../flora-layout.mjs";
import { TREE_SPECIES } from "../tree-layout.mjs";

const TREE_BY_ID = new Map(TREE_SPECIES.map(species => [species.id, species]));
const FLORA_BY_ID = new Map(FLORA_KINDS.map(kind => [kind.id, kind]));

const BROAD_REACH_PROFILE = Object.freeze({
  id: "broad-reach",
  treeSeed: 0x8a0b45,
  floraSeed: 0x52ef9a,
  treeCount: 76,
  floraCount: 188,
  reedShare: 0.34,
  treeSpacing: 5.8,
  treeShoreClearance: 1.15,
  reedBand: 2.35,
  groundSpacing: 0.7,
  riparianTrees: Object.freeze([
    ["river-red-gum", 4.8],
    ["casuarina", 3.2],
    ["paperbark", 1.5],
    ["angophora", 1.2],
  ]),
  inlandTrees: Object.freeze([
    ["scribbly-gum", 4.0],
    ["angophora", 3.6],
    ["river-red-gum", 2.0],
    ["banksia", 1.4],
    ["sapling", 0.8],
  ]),
  nearBankFlora: Object.freeze([
    ["lomandra", 4.2],
    ["grass", 3.8],
    ["fern", 1.0],
    ["log", 0.7],
  ]),
  inlandFlora: Object.freeze([
    ["grass", 4.8],
    ["wattle", 2.2],
    ["lomandra", 1.8],
    ["sapling", 1.2],
    ["log", 0.8],
  ]),
});

const FIRST_BRANCH_PROFILE = Object.freeze({
  id: "first-branch",
  treeSeed: 0x1f1742,
  floraSeed: 0xacd271,
  treeCount: 96,
  floraCount: 224,
  reedShare: 0.28,
  treeSpacing: 4.65,
  treeShoreClearance: 0.72,
  reedBand: 1.8,
  groundSpacing: 0.58,
  riparianTrees: Object.freeze([
    ["paperbark", 5.0],
    ["casuarina", 4.4],
    ["tea-tree", 2.4],
    ["river-red-gum", 0.8],
  ]),
  inlandTrees: Object.freeze([
    ["paperbark", 3.3],
    ["casuarina", 3.0],
    ["tea-tree", 2.8],
    ["banksia", 2.4],
    ["sapling", 2.1],
    ["scribbly-gum", 1.0],
  ]),
  nearBankFlora: Object.freeze([
    ["fern", 4.4],
    ["lomandra", 3.8],
    ["sapling", 1.4],
    ["log", 1.0],
  ]),
  inlandFlora: Object.freeze([
    ["fern", 3.7],
    ["lomandra", 2.8],
    ["wattle", 1.8],
    ["sapling", 1.7],
    ["hang", 0.8],
    ["grass", 0.7],
  ]),
});

export const DRESSING_PROFILES = Object.freeze({
  BROAD_REACH: BROAD_REACH_PROFILE,
  FIRST_BRANCH: FIRST_BRANCH_PROFILE,
});

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = value + 0x6d2b79f5 | 0;
    let output = Math.imul(value ^ value >>> 15, 1 | value);
    output = output + Math.imul(output ^ output >>> 7, 61 | output) ^ output;
    return ((output ^ output >>> 14) >>> 0) / 4294967296;
  };
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function mix(random, minimum, maximum) {
  return minimum + random() * (maximum - minimum);
}

function pickWeighted(random, entries) {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  let ticket = random() * total;
  for (const [id, weight] of entries) {
    ticket -= weight;
    if (ticket <= 0) return id;
  }
  return entries.at(-1)[0];
}

function normaliseBounds(mapModel) {
  const source = mapModel?.bounds ?? {};
  const bounds = {
    minX: finite(source.minX ?? source.xMin, NaN),
    maxX: finite(source.maxX ?? source.xMax, NaN),
    minZ: finite(source.minZ ?? source.zMin, NaN),
    maxZ: finite(source.maxZ ?? source.zMax, NaN),
  };
  if (
    !Number.isFinite(bounds.minX)
    || !Number.isFinite(bounds.maxX)
    || !Number.isFinite(bounds.minZ)
    || !Number.isFinite(bounds.maxZ)
    || bounds.minX >= bounds.maxX
    || bounds.minZ >= bounds.maxZ
  ) {
    throw new TypeError("mapped dressing requires ordered minX/maxX/minZ/maxZ bounds");
  }
  return bounds;
}

function isWater(mapModel, x, z) {
  return Boolean(mapModel.isWater(x, z));
}

function heightAt(mapModel, x, z) {
  return finite(mapModel.heightAt?.(x, z), 0);
}

function approximateShoreDistance(mapModel, x, z, maximum = 12) {
  const originWet = isWater(mapModel, x, z);
  const directions = 12;
  for (let radius = 0.45; radius <= maximum; radius += 0.55) {
    for (let index = 0; index < directions; index += 1) {
      const angle = index / directions * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      if (isWater(mapModel, px, pz) !== originWet) return radius;
    }
  }
  return Infinity;
}

/** Distance to the mapped wet/dry boundary, on either side of the shoreline. */
export function shoreDistanceAt(mapModel, x, z) {
  const wet = isWater(mapModel, x, z);
  const supplied = mapModel.distanceToWater?.(x, z);
  // Conventional distance-to-water fields are zero throughout a water polygon,
  // so probe for land when the candidate itself is wet.
  if (Number.isFinite(supplied) && (!wet || Math.abs(supplied) > 1e-4)) {
    return Math.abs(supplied);
  }
  return approximateShoreDistance(mapModel, x, z);
}

function randomPoint(random, bounds, marginShare = 0.025) {
  const marginX = Math.min((bounds.maxX - bounds.minX) * marginShare, 3);
  const marginZ = Math.min((bounds.maxZ - bounds.minZ) * marginShare, 3);
  return {
    x: mix(random, bounds.minX + marginX, bounds.maxX - marginX),
    z: mix(random, bounds.minZ + marginZ, bounds.maxZ - marginZ),
  };
}

function farEnough(records, x, z, distance) {
  const squared = distance * distance;
  for (const record of records) {
    const dx = record.x - x;
    const dz = record.z - z;
    if (dx * dx + dz * dz < squared) return false;
  }
  return true;
}

function layerAt(bounds, z) {
  const depth = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  if (depth < 0.26) return "foreground";
  if (depth < 0.5) return "play";
  if (depth < 0.76) return "mid";
  return "far";
}

export function resolveDressingProfile(locationId = "") {
  const id = String(locationId).toLowerCase();
  return id.includes("first-branch") || id.includes("macdonald")
    ? FIRST_BRANCH_PROFILE
    : BROAD_REACH_PROFILE;
}

export function createMappedTreeRecords(mapModel, options = {}) {
  if (typeof mapModel?.isWater !== "function") {
    throw new TypeError("mapped dressing requires isWater(x, z)");
  }
  const bounds = normaliseBounds(mapModel);
  const profile = options.profile ?? resolveDressingProfile(options.locationId);
  const seed = (options.seed ?? options.treeSeed ?? profile.treeSeed) >>> 0;
  const random = mulberry32(seed);
  const records = [];
  const wanted = Math.max(0, Math.floor(options.count ?? profile.treeCount));
  const budget = wanted * 160;

  for (let attempt = 0; records.length < wanted && attempt < budget; attempt += 1) {
    const { x, z } = randomPoint(random, bounds);
    if (isWater(mapModel, x, z)) continue;
    const shoreDistance = shoreDistanceAt(mapModel, x, z);
    const weights = shoreDistance <= 8 ? profile.riparianTrees : profile.inlandTrees;
    const speciesId = pickWeighted(random, weights);
    const isWetTolerant = speciesId === "casuarina" || speciesId === "paperbark";
    const clearance = isWetTolerant ? 0.38 : profile.treeShoreClearance;
    if (shoreDistance < clearance) continue;
    const spacing = profile.treeSpacing * (speciesId === "sapling" || speciesId === "tea-tree" ? 0.72 : 1);
    if (!farEnough(records, x, z, spacing)) continue;

    const species = TREE_BY_ID.get(speciesId) ?? TREE_SPECIES[0];
    const scale = mix(random, profile.id === "first-branch" ? 0.78 : 0.88, profile.id === "first-branch" ? 1.22 : 1.34);
    records.push({
      id: `${profile.id}-${species.id}-${records.length}`,
      species: species.id,
      x,
      y: heightAt(mapModel, x, z),
      z,
      scale,
      flip: random() < 0.5 ? -1 : 1,
      height: species.height * scale,
      layer: layerAt(bounds, z),
      mapConditioned: true,
      shoreDistance,
    });
  }
  return records;
}

function createReeds(mapModel, bounds, profile, random, wanted, records) {
  const budget = wanted * 260;
  for (let attempt = 0; records.length < wanted && attempt < budget; attempt += 1) {
    const { x, z } = randomPoint(random, bounds, 0.01);
    const shoreDistance = shoreDistanceAt(mapModel, x, z);
    if (shoreDistance > profile.reedBand) continue;
    if (!farEnough(records, x, z, 0.42)) continue;
    const kind = FLORA_BY_ID.get("reeds");
    const scale = mix(random, 0.42, profile.id === "first-branch" ? 1.02 : 1.14);
    const wet = isWater(mapModel, x, z);
    records.push({
      id: `${profile.id}-reeds-${records.length}`,
      kind: "reeds",
      x,
      y: heightAt(mapModel, x, z),
      z,
      scale,
      flip: random() < 0.5 ? -1 : 1,
      height: kind.height * scale,
      mapConditioned: true,
      shoreDistance,
      wet,
    });
  }
}

function createGroundFlora(mapModel, bounds, profile, random, wanted, records) {
  const budget = wanted * 100;
  for (let attempt = 0; records.length < wanted && attempt < budget; attempt += 1) {
    const { x, z } = randomPoint(random, bounds);
    if (isWater(mapModel, x, z)) continue;
    const shoreDistance = shoreDistanceAt(mapModel, x, z);
    const weights = shoreDistance <= 5.5 ? profile.nearBankFlora : profile.inlandFlora;
    const kindId = pickWeighted(random, weights);
    if (!farEnough(records, x, z, profile.groundSpacing)) continue;
    const kind = FLORA_BY_ID.get(kindId) ?? FLORA_KINDS[0];
    const scale = mix(random, 0.68, kindId === "sapling" || kindId === "hang" ? 1.12 : 1.28);
    records.push({
      id: `${profile.id}-${kind.id}-${records.length}`,
      kind: kind.id,
      x,
      y: heightAt(mapModel, x, z) + (kind.id === "hang" ? 7.5 : 0),
      z,
      scale,
      flip: random() < 0.5 ? -1 : 1,
      height: kind.height * scale,
      mapConditioned: true,
      shoreDistance,
      wet: false,
    });
  }
}

export function createMappedFloraRecords(mapModel, options = {}) {
  if (typeof mapModel?.isWater !== "function") {
    throw new TypeError("mapped dressing requires isWater(x, z)");
  }
  const bounds = normaliseBounds(mapModel);
  const profile = options.profile ?? resolveDressingProfile(options.locationId);
  const seed = (options.seed ?? options.floraSeed ?? profile.floraSeed) >>> 0;
  const random = mulberry32(seed);
  const wanted = Math.max(0, Math.floor(options.count ?? profile.floraCount));
  const reedWanted = Math.min(wanted, Math.round(wanted * profile.reedShare));
  const reeds = [];
  const ground = [];
  createReeds(mapModel, bounds, profile, random, reedWanted, reeds);
  createGroundFlora(mapModel, bounds, profile, random, wanted - reeds.length, ground);
  return [...reeds, ...ground];
}

/**
 * Generate card placement records from the currently projected NSW map model.
 * This module owns no geometry: renderers remain the existing painted-card
 * tree/flora systems, including their RTX grounding proxies.
 */
export function createMappedDressing(mapModel, options = {}) {
  const profile = options.profile ?? resolveDressingProfile(options.locationId);
  const treeSeed = (options.treeSeed ?? profile.treeSeed) >>> 0;
  const floraSeed = (options.floraSeed ?? profile.floraSeed) >>> 0;
  return {
    profile: profile.id,
    seeds: Object.freeze({ trees: treeSeed, flora: floraSeed }),
    trees: createMappedTreeRecords(mapModel, { ...options, profile, seed: treeSeed }),
    flora: createMappedFloraRecords(mapModel, { ...options, profile, seed: floraSeed }),
  };
}
