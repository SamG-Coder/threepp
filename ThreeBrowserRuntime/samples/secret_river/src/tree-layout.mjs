/**
 * Clustered 2.5D Hawkesbury bush. Authored sight lines and irregular groves
 * keep the walker readable instead of turning the bank into a clone wall.
 */

import {
  farBankZ,
  mulberry32,
  riverEdgeZ,
  roadCenterZ,
  terrainHeight,
  WORLD,
} from "./path.mjs";

export const TREE_SPECIES = Object.freeze([
  Object.freeze({
    id: "scribbly-gum",
    file: "scribbly-gum.jpg",
    height: 14.2,
    albedo: [0.55, 0.58, 0.42],
    layer: "play",
  }),
  Object.freeze({
    id: "casuarina",
    file: "casuarina.jpg",
    height: 11.0,
    albedo: [0.22, 0.32, 0.24],
    layer: "foreground",
  }),
  Object.freeze({
    id: "paperbark",
    file: "paperbark.jpg",
    height: 9.1,
    albedo: [0.36, 0.44, 0.28],
    layer: "mid",
  }),
  Object.freeze({
    id: "angophora",
    file: "angophora.jpg",
    height: 13.1,
    albedo: [0.48, 0.40, 0.28],
    layer: "play",
  }),
  Object.freeze({
    id: "banksia",
    file: "banksia.jpg",
    height: 6.2,
    albedo: [0.28, 0.34, 0.18],
    layer: "mid",
  }),
  Object.freeze({
    id: "tea-tree",
    file: "tea-tree.jpg",
    height: 4.1,
    albedo: [0.32, 0.36, 0.22],
    layer: "mid",
  }),
  Object.freeze({
    id: "river-red-gum",
    file: "river-red-gum.jpg",
    height: 15.2,
    albedo: [0.52, 0.46, 0.32],
    layer: "foreground",
  }),
  Object.freeze({
    id: "sapling",
    file: "sapling.jpg",
    height: 5.0,
    albedo: [0.30, 0.42, 0.22],
    layer: "far",
  }),
]);

const LAYERS = Object.freeze(["foreground", "play", "mid", "far"]);

function speciesById(id) {
  return TREE_SPECIES.find(species => species.id === id) ?? TREE_SPECIES[0];
}

function mix(random, a, b) {
  return a + random() * (b - a);
}

function pick(random, table) {
  let total = 0;
  for (const entry of table) total += entry[1];
  let ticket = random() * total;
  for (const [id, weight] of table) {
    ticket -= weight;
    if (ticket <= 0) return id;
  }
  return table[table.length - 1][0];
}

function inClearing(x, z, clearings) {
  for (const gap of clearings) {
    const dx = x - gap.x;
    const dz = (z - gap.z) * 0.55;
    if (dx * dx + dz * dz < gap.r * gap.r) return true;
  }
  return false;
}

function inSightLine(x, sightLines) {
  for (const line of sightLines) {
    if (Math.abs(x - line.x) < line.half) return true;
  }
  return false;
}

export const DEFAULT_LAYOUT_SEED = 0x51c7e1;
export const CANOPY_BIN_WIDTH = 12;

export function inlandCanopyOccupancy(records, binWidth = CANOPY_BIN_WIDTH) {
  const minX = WORLD.minX + 6;
  const maxX = WORLD.maxX - 6;
  const bins = Math.max(1, Math.ceil((maxX - minX) / binWidth));
  const counts = new Array(bins).fill(0);
  for (const record of records) {
    if (record.z <= WORLD.pathMaxZ) continue;
    const index = Math.floor((record.x - minX) / binWidth);
    if (index >= 0 && index < bins) counts[index] += 1;
  }
  return { bins, counts, occupied: counts.filter(count => count > 0).length };
}

export function longestEmptyRun(counts) {
  let longest = 0;
  let current = 0;
  for (const count of counts) {
    if (count === 0) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

export function layoutTrees(seed = DEFAULT_LAYOUT_SEED) {
  const random = mulberry32(seed);
  const records = [];

  const clearings = [{ x: -4, z: 39, r: 15 }];
  for (let index = 0; index < 8; index++) {
    clearings.push({
      x: mix(random, WORLD.minX + 16, WORLD.maxX - 16),
      z: mix(random, 32, 76),
      r: mix(random, 7, 14),
    });
  }

  const sightLines = [{ x: -4, half: 7.5 }];
  for (let index = 0; index < 3; index++) {
    sightLines.push({
      x: mix(random, WORLD.minX + 14, WORLD.maxX - 14),
      half: mix(random, 3.2, 4.8),
    });
  }

  function tooClose(x, z, minDist, minX = 0, sameLayer = null) {
    for (const record of records) {
      if (sameLayer && record.layer !== sameLayer) continue;
      const dx = record.x - x;
      const dz = record.z - z;
      if (dx * dx + dz * dz < minDist * minDist) return true;
      if (minX > 0 && Math.abs(dx) < minX && Math.abs(dz) < 10) return true;
    }
    return false;
  }

  function push(id, x, z, scale, layer) {
    if (!LAYERS.includes(layer)) return false;
    if (x < WORLD.minX + 4 || x > WORLD.maxX - 4) return false;
    const species = speciesById(id);
    const y = terrainHeight(x, z);
    const wet = y <= WORLD.waterHeight + 0.05;
    if (wet && species.id !== "casuarina") return false;
    if (y <= WORLD.waterHeight) return false;
    records.push({
      id: `${species.id}-${records.length}`,
      species: species.id,
      x,
      y,
      z,
      scale,
      flip: random() < 0.5 ? -1 : 1,
      height: species.height * scale,
      layer,
    });
    return true;
  }

  function dryForegroundZ(x, id) {
    const edge = riverEdgeZ(x);
    const zMax = WORLD.pathMinZ;
    let z = mix(random, edge - 1, zMax);
    if (id === "casuarina") return z;
    let guard = 0;
    while (terrainHeight(x, z) <= WORLD.waterHeight + 0.05 && z < zMax && guard < 10) {
      z += 0.4;
      guard += 1;
    }
    return z;
  }

  function placeForeground(startX, count) {
    let x = startX;
    let placed = 0;
    while (x < WORLD.maxX - 8 && placed < count) {
      if (Math.abs(x + 4) < 10) {
        x += 12;
        continue;
      }
      const id = pick(random, [
        ["river-red-gum", 3.4],
        ["scribbly-gum", 2.2],
        ["angophora", 1.6],
        ["casuarina", 1.2],
      ]);
      const z = dryForegroundZ(x, id);
      if (
        !tooClose(x, z, 14, 16, "foreground")
        && push(id, x, z, mix(random, 0.95, 1.25), "foreground")
      ) {
        placed += 1;
        x += mix(random, 20, 32);
      } else {
        x += mix(random, 4, 7);
      }
    }
    return placed;
  }

  function scatter({
    count,
    z0,
    z1,
    minDist,
    minX,
    scale0,
    scale1,
    layer,
    table,
    openViews = false,
    zPick,
  }) {
    let placed = 0;
    let attempts = 0;
    const budget = count * 40;
    while (placed < count && attempts < budget) {
      attempts += 1;
      const x = mix(random, WORLD.minX + 6, WORLD.maxX - 6);
      if (openViews && inSightLine(x, sightLines)) continue;
      const z = zPick ? zPick(x) : mix(random, z0, z1);
      if (z < z0 || z > z1) continue;
      if (openViews && inClearing(x, z, clearings)) continue;
      if (tooClose(x, z, minDist, minX, layer)) continue;
      if (push(pick(random, table), x, z, mix(random, scale0, scale1), layer)) placed += 1;
    }
    return placed;
  }

  const foregroundWanted = 6 + Math.floor(random() * 5);
  let foregroundPlaced = placeForeground(WORLD.minX + mix(random, 8, 16), foregroundWanted);
  if (foregroundPlaced < 6) {
    foregroundPlaced += placeForeground(WORLD.minX + mix(random, 12, 20), 6 - foregroundPlaced);
  }

  let xCursor = WORLD.minX + mix(random, 6, 14);
  while (xCursor < WORLD.maxX - 6) {
    if (Math.abs(xCursor + 4) < 8.5) {
      xCursor += mix(random, 12, 16);
      continue;
    }
    const inland = Math.max(22, roadCenterZ(xCursor) + WORLD.roadWidth * 0.7);
    const z = Math.min(28, inland + random() * Math.max(0.4, 28 - inland));
    const id = pick(random, [
      ["scribbly-gum", 3.2],
      ["angophora", 2.6],
      ["river-red-gum", 1.4],
      ["paperbark", 0.8],
    ]);
    if (!tooClose(xCursor, z, 10, 11, "play")) {
      push(id, xCursor, z, mix(random, 0.95, 1.35), "play");
    }
    xCursor += mix(random, 12, 18);
  }

  scatter({
    count: 25,
    z0: 28,
    z1: 52,
    minDist: 6.4,
    minX: 5.6,
    scale0: 0.95,
    scale1: 1.4,
    layer: "mid",
    openViews: true,
    table: [
      ["scribbly-gum", 1.8],
      ["angophora", 1.6],
      ["paperbark", 2.4],
      ["casuarina", 2.2],
      ["banksia", 1.2],
      ["river-red-gum", 0.6],
    ],
  });
  scatter({
    count: 16,
    z0: 28,
    z1: 52,
    minDist: 4.4,
    minX: 3.6,
    scale0: 0.8,
    scale1: 1.15,
    layer: "mid",
    openViews: true,
    table: [
      ["banksia", 2.6],
      ["tea-tree", 2.4],
      ["sapling", 2.2],
      ["paperbark", 1.1],
    ],
  });

  scatter({
    count: 19,
    z0: 50,
    z1: 86,
    minDist: 7.6,
    minX: 6.4,
    scale0: 1.05,
    scale1: 1.6,
    layer: "far",
    openViews: true,
    zPick: x => mix(random, Math.max(50, farBankZ(x) + 4), 86),
    table: [
      ["scribbly-gum", 2.2],
      ["angophora", 1.6],
      ["casuarina", 2.0],
      ["paperbark", 1.5],
      ["river-red-gum", 1.1],
    ],
  });
  scatter({
    count: 12,
    z0: 50,
    z1: 86,
    minDist: 5.5,
    minX: 4.7,
    scale0: 0.9,
    scale1: 1.25,
    layer: "far",
    openViews: true,
    table: [
      ["banksia", 2.0],
      ["sapling", 2.4],
      ["tea-tree", 1.6],
      ["paperbark", 1.2],
    ],
  });

  const used = new Set(records.map(record => record.species));
  const fallback = {
    "scribbly-gum": { z0: 22, z1: 28, scale: 1.1, layer: "play" },
    casuarina: { z0: 28, z1: 40, scale: 1.05, layer: "mid" },
    paperbark: { z0: 32, z1: 48, scale: 1.0, layer: "mid" },
    angophora: { z0: 22, z1: 28, scale: 1.1, layer: "play" },
    banksia: { z0: 30, z1: 46, scale: 0.95, layer: "mid" },
    "tea-tree": { z0: 30, z1: 44, scale: 0.9, layer: "mid" },
    "river-red-gum": { z0: 22, z1: 28, scale: 1.2, layer: "play" },
    sapling: { z0: 52, z1: 70, scale: 1.0, layer: "far" },
  };
  for (const species of TREE_SPECIES) {
    if (used.has(species.id)) continue;
    const slot = fallback[species.id];
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = mix(random, WORLD.minX + 10, WORLD.maxX - 10);
      const z = mix(random, slot.z0, slot.z1);
      if (push(species.id, x, z, slot.scale, slot.layer)) break;
    }
  }

  if (records.length < 72) {
    const need = Math.min(18, 82 - records.length);
    let extra = 0;
    let attempts = 0;
    while (extra < need && attempts < need * 40) {
      attempts += 1;
      const x = mix(random, WORLD.minX + 6, WORLD.maxX - 6);
      if (inSightLine(x, sightLines)) continue;
      const z = mix(random, 30, 82);
      if (inClearing(x, z, clearings)) continue;
      const layer = z < 50 ? "mid" : "far";
      if (tooClose(x, z, 5.5, 4.4, layer)) continue;
      const id = pick(random, [
        ["banksia", 2.0],
        ["sapling", 1.8],
        ["tea-tree", 1.4],
        ["paperbark", 1.2],
        ["casuarina", 1.0],
      ]);
      if (push(id, x, z, mix(random, 0.85, 1.2), layer)) extra += 1;
    }
  }

  const occupancy = inlandCanopyOccupancy(records);
  for (let index = 0; index < occupancy.bins; index++) {
    if (occupancy.counts[index] > 0) continue;
    const x = WORLD.minX + 6 + (index + 0.5) * CANOPY_BIN_WIDTH;
    const z = mix(random, 32, 62);
    push("scribbly-gum", x, z, mix(random, 1.05, 1.35), "mid");
  }

  return records;
}
