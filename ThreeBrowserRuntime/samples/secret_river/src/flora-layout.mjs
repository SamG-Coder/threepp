import {
  mulberry32,
  riverEdgeZ,
  roadCenterZ,
  terrainHeight,
  WORLD,
} from "./path.mjs";

export const FLORA_KINDS = Object.freeze([
  Object.freeze({ id: "reeds", file: "reeds.jpg", height: 1.8 }),
  Object.freeze({ id: "grass", file: "kangaroo-grass.jpg", height: 0.7 }),
  Object.freeze({ id: "wattle", file: "wattle.jpg", height: 2.8 }),
  Object.freeze({ id: "lomandra", file: "lomandra.jpg", height: 0.9 }),
  Object.freeze({ id: "sapling", file: "sapling.jpg", height: 4.5 }),
  Object.freeze({ id: "log", file: "fallen-log.jpg", height: 0.55 }),
  Object.freeze({ id: "hang", file: "hanging-branch.jpg", height: 6 }),
  Object.freeze({ id: "fern", file: "fern.jpg", height: 1.1 }),
]);

function kindById(id) {
  return FLORA_KINDS.find(kind => kind.id === id) ?? FLORA_KINDS[0];
}

export const DEFAULT_FLORA_SEED = 0x51c7e1;

export function reedEdgeShare(records, maxDelta = 3.5) {
  const reeds = records.filter(record => record.kind === "reeds");
  const near = reeds.filter(record => Math.abs(record.z - riverEdgeZ(record.x)) <= maxDelta);
  return {
    reeds: reeds.length,
    near: near.length,
    share: reeds.length ? near.length / reeds.length : 0,
  };
}

/** Share of reeds whose z sits in [edge - intoWater, edge + inland]. */
export function wetReedShare(records, intoWater = 1.2, inland = 0.9) {
  const reeds = records.filter(record => record.kind === "reeds");
  const wet = reeds.filter(record => {
    const delta = record.z - riverEdgeZ(record.x);
    return delta >= -intoWater && delta <= inland;
  });
  return {
    reeds: reeds.length,
    near: wet.length,
    share: reeds.length ? wet.length / reeds.length : 0,
  };
}

export function layoutFlora(seed = DEFAULT_FLORA_SEED) {
  const random = mulberry32(seed);
  const records = [];

  function push(id, x, z, scale, flip, yOverride) {
    const kind = kindById(id);
    const y = yOverride ?? terrainHeight(x, z);
    if (id !== "hang" && id !== "reeds" && y < WORLD.waterHeight + 0.05) return;
    if (id === "reeds" && y < WORLD.waterHeight - 0.2) return;
    records.push({
      id: `${id}-${records.length}`,
      kind: kind.id,
      x,
      y,
      z,
      scale,
      flip: flip ? -1 : 1,
      height: kind.height * scale,
    });
  }

  for (let bed = 0; bed < 27; bed++) {
    if (random() < 0.2) continue;
    const cx = WORLD.minX + 6 + random() * (WORLD.maxX - WORLD.minX - 12);
    const n = 6 + Math.floor(random() * 10);
    // Reed beds sit in or just inland of the wet edge, including in-water stems.
    const wetBias = (random() - 0.62) * 1.4;
    for (let index = 0; index < n; index++) {
      const x = cx + (random() - 0.5) * 5.6;
      const edge = riverEdgeZ(x);
      const z = Math.min(
        edge + 0.9,
        Math.max(edge - 1.2, edge + wetBias + (random() - 0.5) * 0.85),
      );
      const inWater = z < edge;
      push(
        "reeds",
        x,
        z,
        0.42 + random() * 0.7,
        random() < 0.5,
        inWater ? WORLD.waterHeight - 0.1 : undefined,
      );
    }
  }

  for (let patch = 0; patch < 34; patch++) {
    if (random() < 0.16) continue;
    const cx = WORLD.minX + 5 + random() * (WORLD.maxX - WORLD.minX - 10);
    const inland = random() < 0.22;
    if (inland && Math.abs(cx + 4) < 8) continue;
    const n = 5 + Math.floor(random() * 8);
    for (let index = 0; index < n; index++) {
      const x = cx + (random() - 0.5) * (inland ? 4.4 : 6.2);
      const edge = riverEdgeZ(x);
      const road = roadCenterZ(x);
      const z = inland
        ? road + 0.5 + random() * 3.4
        : edge + 0.12 + random() * Math.max(1.5, (road - edge) * 0.88);
      if (z <= edge) continue;
      push("grass", x, z, 0.7 + random() * 0.55, random() < 0.5);
    }
  }

  for (let index = 0; index < 14; index++) {
    if (random() < 0.28) continue;
    const x = WORLD.minX + 10 + index * 12.4 + (random() - 0.5) * 5.5;
    const z = 24 + random() * 16;
    push("wattle", x, z, 0.84 + random() * 0.42, random() < 0.5);
  }

  for (let clump = 0; clump < 21; clump++) {
    if (random() < 0.2) continue;
    const cx = WORLD.minX + 6 + random() * (WORLD.maxX - WORLD.minX - 12);
    const n = 2 + Math.floor(random() * 5);
    const bankBias = 0.25 + random() * 1.1;
    for (let index = 0; index < n; index++) {
      const x = cx + (random() - 0.5) * 3.8;
      const edge = riverEdgeZ(x);
      const z = Math.max(edge + 0.08, edge + bankBias + (random() - 0.5) * 2.2);
      push("lomandra", x, z, 0.8 + random() * 0.45, random() < 0.5);
    }
  }

  for (let index = 0; index < 16; index++) {
    if (random() < 0.42) continue;
    const x = WORLD.minX + 11 + index * 10.8 + (random() - 0.5) * 4.4;
    const z = 25 + random() * 13;
    push("sapling", x, z, 0.74 + random() * 0.5, random() < 0.5);
  }

  for (let index = 0; index < 8; index++) {
    if (random() < 0.18) continue;
    const x = WORLD.minX + 14 + index * 21.5 + (random() - 0.5) * 7.5;
    const onPath = random() < 0.55;
    const side = random() < 0.5 ? -1 : 1;
    const z = onPath
      ? roadCenterZ(x) + side * (1.55 + random() * 1.15)
      : riverEdgeZ(x) + 0.45 + random() * 1.5;
    push("log", x, z, 0.88 + random() * 0.38, random() < 0.5);
  }

  for (let index = 0; index < 6; index++) {
    if (random() < 0.16) continue;
    const x = WORLD.minX + 18 + index * 28 + (random() - 0.5) * 9;
    const z = roadCenterZ(x) - 4.4 - random() * 2.6;
    push("hang", x, z, 0.88 + random() * 0.32, random() < 0.5, terrainHeight(x, z) + 8);
  }

  for (let index = 0; index < 18; index++) {
    if (random() < 0.3) continue;
    const x = WORLD.minX + 8 + index * 9.6 + (random() - 0.5) * 4;
    const z = 26 + random() * 14;
    push("fern", x, z, 0.78 + random() * 0.5, random() < 0.5);
  }

  return records;
}
