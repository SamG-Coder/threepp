import * as THREE from "three/webgpu";

// Procedural, asset-free surface maps for the flash-flood gorge.  Every noise
// primitive wraps on a torus, so the generated maps remain seamless under
// RepeatWrapping at every mip level.

export const SURFACE_TEXTURE_FAMILIES = Object.freeze({
  DRY_GORGE: "dryGorge",
  WET_CHANNEL_ROCK: "wetChannelRock",
  BOULDER_STONE: "boulderStone",
  CONCRETE: "concrete",
  WET_ASPHALT: "wetAsphalt",
  BARK_LIVE_WOOD: "barkLiveWood",
  DEAD_SOAKED_WOOD: "deadSoakedWood",
  FOLIAGE_SHRUB: "foliageShrub",
  DARK_METAL: "darkMetal",
  WATER_FLOW: "waterFlow",
});

const DEFAULT_SIZE = 256;
const DEFAULT_ANISOTROPY = 8;
const TWO_PI = Math.PI * 2;
const CACHE = new Map();

function rgb(hex) {
  return Object.freeze([
    ((hex >>> 16) & 255) / 255,
    ((hex >>> 8) & 255) / 255,
    (hex & 255) / 255,
  ]);
}

const DEFINITIONS = Object.freeze({
  [SURFACE_TEXTURE_FAMILIES.DRY_GORGE]: Object.freeze({
    label: "Dry gorge strata and soil",
    seed: 0x64727967,
    dark: rgb(0x39322c),
    light: rgb(0x827365),
    accent: rgb(0x51443a),
    repeat: Object.freeze([1, 1]),
    normalScale: 0.36,
  }),
  [SURFACE_TEXTURE_FAMILIES.WET_CHANNEL_ROCK]: Object.freeze({
    label: "Flood-darkened channel rock",
    seed: 0x77657472,
    dark: rgb(0x121a1c),
    light: rgb(0x485659),
    accent: rgb(0x263a38),
    repeat: Object.freeze([4, 6]),
    normalScale: 0.56,
  }),
  [SURFACE_TEXTURE_FAMILIES.BOULDER_STONE]: Object.freeze({
    label: "Fractured boulder and talus stone",
    seed: 0x626f756c,
    dark: rgb(0x302d29),
    light: rgb(0x797269),
    accent: rgb(0x998b75),
    repeat: Object.freeze([2, 2]),
    normalScale: 0.9,
  }),
  [SURFACE_TEXTURE_FAMILIES.CONCRETE]: Object.freeze({
    label: "Weathered hydraulic concrete",
    seed: 0x636f6e63,
    dark: rgb(0x404543),
    light: rgb(0x90928c),
    accent: rgb(0x303a3a),
    repeat: Object.freeze([3, 3]),
    normalScale: 0.66,
  }),
  [SURFACE_TEXTURE_FAMILIES.WET_ASPHALT]: Object.freeze({
    label: "Rain-darkened inspection-road asphalt",
    seed: 0x61737068,
    dark: rgb(0x15191a),
    light: rgb(0x454a49),
    accent: rgb(0x68706d),
    repeat: Object.freeze([5, 5]),
    normalScale: 0.5,
  }),
  [SURFACE_TEXTURE_FAMILIES.BARK_LIVE_WOOD]: Object.freeze({
    label: "Weathered live-tree bark",
    seed: 0x6261726b,
    dark: rgb(0x211b17),
    light: rgb(0x6b5a4b),
    accent: rgb(0x171310),
    repeat: Object.freeze([2, 8]),
    normalScale: 1,
  }),
  [SURFACE_TEXTURE_FAMILIES.DEAD_SOAKED_WOOD]: Object.freeze({
    label: "Dead and water-soaked timber",
    seed: 0x64726966,
    dark: rgb(0x14110f),
    light: rgb(0x514236),
    accent: rgb(0x12191a),
    repeat: Object.freeze([2, 7]),
    normalScale: 0.72,
  }),
  [SURFACE_TEXTURE_FAMILIES.FOLIAGE_SHRUB]: Object.freeze({
    label: "Cool moonlit foliage and scrub",
    seed: 0x6c656166,
    dark: rgb(0x0b1b14),
    light: rgb(0x476a54),
    accent: rgb(0x6b7c61),
    repeat: Object.freeze([4, 4]),
    normalScale: 0.78,
  }),
  [SURFACE_TEXTURE_FAMILIES.DARK_METAL]: Object.freeze({
    label: "Weathered dark structural metal",
    seed: 0x6d657461,
    dark: rgb(0x192225),
    light: rgb(0x5d6b6e),
    accent: rgb(0x593b2d),
    repeat: Object.freeze([2, 3]),
    normalScale: 0.42,
  }),
  [SURFACE_TEXTURE_FAMILIES.WATER_FLOW]: Object.freeze({
    label: "Aperiodic fast-water flow detail",
    seed: 0x666c6f77,
    dark: rgb(0x071820),
    light: rgb(0x41666b),
    accent: rgb(0xbaccc8),
    repeat: Object.freeze([1, 1]),
    normalScale: 0.48,
  }),
});

const ALIASES = Object.freeze({
  dryRockSoil: SURFACE_TEXTURE_FAMILIES.DRY_GORGE,
  dryRock: SURFACE_TEXTURE_FAMILIES.DRY_GORGE,
  soil: SURFACE_TEXTURE_FAMILIES.DRY_GORGE,
  wetRock: SURFACE_TEXTURE_FAMILIES.WET_CHANNEL_ROCK,
  boulder: SURFACE_TEXTURE_FAMILIES.BOULDER_STONE,
  stone: SURFACE_TEXTURE_FAMILIES.BOULDER_STONE,
  weatheredConcrete: SURFACE_TEXTURE_FAMILIES.CONCRETE,
  asphalt: SURFACE_TEXTURE_FAMILIES.WET_ASPHALT,
  roadSurface: SURFACE_TEXTURE_FAMILIES.WET_ASPHALT,
  bark: SURFACE_TEXTURE_FAMILIES.BARK_LIVE_WOOD,
  liveWood: SURFACE_TEXTURE_FAMILIES.BARK_LIVE_WOOD,
  soakedWood: SURFACE_TEXTURE_FAMILIES.DEAD_SOAKED_WOOD,
  deadWood: SURFACE_TEXTURE_FAMILIES.DEAD_SOAKED_WOOD,
  foliage: SURFACE_TEXTURE_FAMILIES.FOLIAGE_SHRUB,
  shrub: SURFACE_TEXTURE_FAMILIES.FOLIAGE_SHRUB,
  metal: SURFACE_TEXTURE_FAMILIES.DARK_METAL,
  water: SURFACE_TEXTURE_FAMILIES.WATER_FLOW,
  flowNormal: SURFACE_TEXTURE_FAMILIES.WATER_FLOW,
});

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(minimum, maximum, value) {
  const t = clamp01((value - minimum) / Math.max(1e-8, maximum - minimum));
  return t * t * (3 - 2 * t);
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function hashLattice(x, y, seed) {
  let state = (Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ seed) >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return (state >>> 0) / 4294967296;
}

function tileNoise(u, v, cells, seed) {
  const period = Math.max(1, Math.trunc(cells));
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = modulo(ix, period);
  const x1 = modulo(ix + 1, period);
  const y0 = modulo(iy, period);
  const y1 = modulo(iy + 1, period);
  const a = hashLattice(x0, y0, seed);
  const b = hashLattice(x1, y0, seed);
  const c = hashLattice(x0, y1, seed);
  const d = hashLattice(x1, y1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, sx),
    THREE.MathUtils.lerp(c, d, sx),
    sy,
  );
}

function tileFbm(u, v, cells, seed, octaves = 4) {
  let amplitude = 0.54;
  let frequency = Math.max(1, Math.trunc(cells));
  let value = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; ++octave) {
    value += tileNoise(u, v, frequency, seed + octave * 0x9e37) * amplitude;
    total += amplitude;
    frequency *= 2;
    amplitude *= 0.48;
  }
  return value / Math.max(total, 1e-8);
}

// Distance to the nearest seeded point on a periodic grid.  Evaluating the
// wrapped neighbouring cells makes aggregate, pebble and leaf masks seamless.
function tileCellDistance(u, v, cells, seed) {
  const period = Math.max(2, Math.trunc(cells));
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let nearest = Number.POSITIVE_INFINITY;
  for (let offsetY = -1; offsetY <= 1; ++offsetY) {
    for (let offsetX = -1; offsetX <= 1; ++offsetX) {
      const cellX = ix + offsetX;
      const cellY = iy + offsetY;
      const wrappedX = modulo(cellX, period);
      const wrappedY = modulo(cellY, period);
      const pointX = cellX + 0.12 + hashLattice(wrappedX, wrappedY, seed) * 0.76;
      const pointY = cellY + 0.12 + hashLattice(wrappedX, wrappedY, seed ^ 0x68bc21eb) * 0.76;
      nearest = Math.min(nearest, Math.hypot(pointX - x, pointY - y));
    }
  }
  return clamp01(nearest / 0.74);
}

function sampleSurface(family, u, v, definition, target) {
  const seed = definition.seed;
  let macro;
  let detail;
  let feature;
  let ridge;

  switch (family) {
    case SURFACE_TEXTURE_FAMILIES.DRY_GORGE: {
      macro = tileFbm(u, v, 3, seed, 5);
      detail = tileFbm(u, v, 14, seed ^ 0x14ad, 3);
      const band = Math.sin(TWO_PI * (v * 6 + (macro - 0.5) * 0.32));
      const fineBand = Math.sin(TWO_PI * (v * 17 + (detail - 0.5) * 0.12));
      const seam = Math.pow(1 - Math.abs(band), 9);
      target.height = macro * 0.5 + detail * 0.17 + band * 0.035 + fineBand * 0.018 - seam * 0.045;
      target.roughness = 0.82 + detail * 0.14 + seam * 0.02;
      target.tone = 0.36 + macro * 0.42 + detail * 0.07 + band * 0.02 - seam * 0.035;
      target.accent = seam * 0.1;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.WET_CHANNEL_ROCK: {
      macro = tileFbm(u, v, 4, seed, 5);
      detail = tileFbm(u, v, 18, seed ^ 0x9271, 3);
      const slick = smoothstep(0.56, 0.82, tileFbm(u, v, 3, seed ^ 0x41cc, 4));
      const streak = Math.pow(0.5 + 0.5 * Math.sin(
        TWO_PI * (u * 5 + v + (macro - 0.5) * 0.78),
      ), 7);
      target.height = macro * 0.4 + detail * 0.16 - slick * 0.08 - streak * 0.08;
      target.roughness = 0.2 + (1 - slick) * 0.2 + detail * 0.09;
      target.tone = 0.25 + macro * 0.44 + detail * 0.08 - slick * 0.12;
      target.accent = streak * 0.32 + slick * 0.18;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.BOULDER_STONE: {
      macro = tileFbm(u, v, 4, seed, 5);
      detail = tileFbm(u, v, 20, seed ^ 0x5b17, 3);
      feature = tileCellDistance(u, v, 7, seed ^ 0x81ef);
      const fracture = smoothstep(0.7, 0.94, feature);
      const vein = Math.pow(1 - Math.abs(Math.sin(
        TWO_PI * (u * 3 + v * 2 + (macro - 0.5) * 0.55),
      )), 12);
      target.height = macro * 0.48 + detail * 0.2 - fracture * 0.2 - vein * 0.12;
      target.roughness = 0.75 + detail * 0.17 + fracture * 0.05;
      target.tone = 0.29 + macro * 0.48 + detail * 0.08 - fracture * 0.13;
      target.accent = vein * 0.62;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.CONCRETE: {
      macro = tileFbm(u, v, 3, seed, 5);
      detail = tileFbm(u, v, 22, seed ^ 0xa109, 3);
      feature = tileCellDistance(u, v, 13, seed ^ 0x44e3);
      const aggregate = Math.pow(1 - feature, 7);
      const crackA = Math.pow(1 - Math.abs(Math.sin(
        TWO_PI * (u * 2 + v * 3 + (macro - 0.5) * 0.48),
      )), 22);
      const crackB = Math.pow(1 - Math.abs(Math.sin(
        TWO_PI * (u * 5 - v * 2 + (detail - 0.5) * 0.16 + 0.23),
      )), 30);
      const crack = Math.max(crackA, crackB * 0.64);
      const stain = smoothstep(0.57, 0.81, tileFbm(u, v, 2, seed ^ 0xc113, 5));
      target.height = macro * 0.31 + detail * 0.18 + aggregate * 0.13 - crack * 0.24;
      target.roughness = 0.58 + detail * 0.16 + aggregate * 0.08 + stain * 0.08;
      target.tone = 0.4 + macro * 0.34 + aggregate * 0.14 - stain * 0.2 - crack * 0.2;
      target.accent = Math.max(stain * 0.48, crack * 0.76);
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.WET_ASPHALT: {
      macro = tileFbm(u, v, 3, seed, 5);
      detail = tileFbm(u, v, 30, seed ^ 0xd311, 3);
      feature = tileCellDistance(u, v, 18, seed ^ 0x7c49);
      const aggregate = Math.pow(1 - feature, 5.5);
      const repaired = smoothstep(0.61, 0.82, tileFbm(u, v, 2, seed ^ 0x921d, 5));
      const hairline = Math.pow(1 - Math.abs(Math.sin(
        TWO_PI * (u * 3 - v * 5 + (macro - 0.5) * 0.42),
      )), 30);
      const wetSheen = smoothstep(0.53, 0.8, tileFbm(u, v, 5, seed ^ 0xa75b, 4));
      target.height = macro * 0.21 + detail * 0.22 + aggregate * 0.19 - hairline * 0.1;
      target.roughness = 0.28 + detail * 0.15 + aggregate * 0.08 + repaired * 0.09 - wetSheen * 0.12;
      target.tone = 0.22 + macro * 0.3 + detail * 0.09 - repaired * 0.08 - wetSheen * 0.12;
      target.accent = aggregate * wetSheen * 0.42 + hairline * 0.18;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.BARK_LIVE_WOOD: {
      macro = tileFbm(u, v, 3, seed, 5);
      detail = tileFbm(u, v, 18, seed ^ 0x20f5, 3);
      ridge = 0.5 + 0.5 * Math.sin(TWO_PI * (u * 12 + (macro - 0.5) * 0.6));
      const furrow = Math.pow(1 - ridge, 4.5);
      const split = Math.pow(1 - Math.abs(Math.sin(
        TWO_PI * (u * 4 + v * 3 + (detail - 0.5) * 0.2),
      )), 18);
      target.height = ridge * 0.54 + macro * 0.22 + detail * 0.1 - furrow * 0.25 - split * 0.12;
      target.roughness = 0.84 + detail * 0.12 + furrow * 0.035;
      target.tone = 0.25 + ridge * 0.45 + macro * 0.14 - furrow * 0.24;
      target.accent = Math.max(furrow * 0.8, split * 0.35);
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.DEAD_SOAKED_WOOD: {
      macro = tileFbm(u, v, 3, seed, 5);
      detail = tileFbm(u, v, 16, seed ^ 0x7d31, 3);
      const grain = 0.5 + 0.5 * Math.sin(TWO_PI * (u * 9 + (macro - 0.5) * 0.8));
      const fineGrain = 0.5 + 0.5 * Math.sin(TWO_PI * (u * 31 + (detail - 0.5) * 0.22));
      const waterDark = smoothstep(0.52, 0.8, tileFbm(u, v, 2, seed ^ 0xe851, 5));
      target.height = grain * 0.38 + fineGrain * 0.1 + macro * 0.2;
      target.roughness = 0.38 + detail * 0.15 + grain * 0.08 - waterDark * 0.07;
      target.tone = 0.2 + grain * 0.34 + macro * 0.17 - waterDark * 0.18;
      target.accent = waterDark * 0.68;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.FOLIAGE_SHRUB: {
      macro = tileFbm(u, v, 4, seed, 5);
      detail = tileFbm(u, v, 24, seed ^ 0xbb31, 3);
      feature = tileCellDistance(u, v, 15, seed ^ 0x5993);
      const leaf = Math.pow(1 - feature, 1.75);
      const shadow = smoothstep(0.58, 0.82, tileFbm(u, v, 7, seed ^ 0x91a3, 3));
      target.height = leaf * 0.52 + macro * 0.28 + detail * 0.09;
      target.roughness = 0.76 + detail * 0.16 + (1 - leaf) * 0.05;
      target.tone = 0.16 + macro * 0.4 + leaf * 0.22 - shadow * 0.13;
      target.accent = leaf * smoothstep(0.58, 0.86, detail) * 0.62;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.DARK_METAL: {
      macro = tileFbm(u, v, 3, seed, 5);
      detail = tileFbm(u, v, 28, seed ^ 0xa821, 3);
      const brushing = 0.5 + 0.5 * Math.sin(TWO_PI * (v * 23 + (macro - 0.5) * 0.09));
      const oxidation = smoothstep(0.63, 0.84, tileFbm(u, v, 5, seed ^ 0x531b, 4));
      const scratch = Math.pow(1 - Math.abs(Math.sin(
        TWO_PI * (u * 3 + v * 17 + (detail - 0.5) * 0.12),
      )), 34);
      target.height = macro * 0.22 + brushing * 0.006 + oxidation * 0.13 - scratch * 0.1;
      target.roughness = 0.33 + detail * 0.14 + oxidation * 0.25;
      target.tone = 0.27 + macro * 0.3 + brushing * 0.06 - oxidation * 0.14 + scratch * 0.08;
      target.accent = oxidation * 0.82;
      break;
    }
    case SURFACE_TEXTURE_FAMILIES.WATER_FLOW: {
      macro = tileFbm(u, v, 4, seed, 5);
      const warpU = tileFbm(u, v, 3, seed ^ 0x2d31, 4) - 0.5;
      const warpV = tileFbm(u, v, 5, seed ^ 0x8b17, 4) - 0.5;
      detail = tileFbm(u + warpU * 0.085, v + warpV * 0.085, 22, seed ^ 0xa531, 3);
      feature = tileCellDistance(u + warpV * 0.06, v - warpU * 0.06, 13, seed ^ 0x71c9);
      const brokenCrest = Math.pow(1 - feature, 2.8);
      const churn = smoothstep(0.56, 0.82, tileFbm(
        u - warpU * 0.07,
        v + warpV * 0.07,
        8,
        seed ^ 0xe193,
        4,
      ));
      target.height = macro * 0.34 + detail * 0.34 + brokenCrest * 0.2 - churn * 0.075;
      target.roughness = 0.16 + detail * 0.18 + churn * 0.16 + brokenCrest * 0.12;
      target.tone = 0.2 + macro * 0.32 + detail * 0.1 + brokenCrest * 0.15;
      target.accent = brokenCrest * churn * 0.34;
      break;
    }
    default:
      throw new RangeError(`Unknown surface texture family: ${family}`);
  }

  target.height = clamp01(target.height);
  target.roughness = clamp01(target.roughness);
  target.tone = clamp01(target.tone);
  target.accent = clamp01(target.accent);
  return target;
}

function normalizeFamily(kind) {
  const requested = String(kind ?? "");
  const family = DEFINITIONS[requested] ? requested : ALIASES[requested];
  if (family) return family;
  throw new RangeError(
    `Unknown surface texture family "${requested}". Expected one of: ${Object.values(SURFACE_TEXTURE_FAMILIES).join(", ")}`,
  );
}

function normalizeSize(value) {
  const requested = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_SIZE;
  const exponent = Math.round(Math.log2(THREE.MathUtils.clamp(requested, 64, 512)));
  return 2 ** exponent;
}

function normalizeAnisotropy(value) {
  return Math.round(THREE.MathUtils.clamp(Number(value) || DEFAULT_ANISOTROPY, 1, 16));
}

function textureFromBytes(data, size, name, colorSpace, repeat, anisotropy) {
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.colorSpace = colorSpace;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function generateTextureSet(family, size, anisotropy) {
  const definition = DEFINITIONS[family];
  const pixels = size * size;
  const albedoBytes = new Uint8Array(pixels * 4);
  const roughnessBytes = new Uint8Array(pixels * 4);
  const normalBytes = new Uint8Array(pixels * 4);
  const heights = new Float32Array(pixels);
  const sample = { height: 0, roughness: 0, tone: 0, accent: 0 };

  for (let y = 0; y < size; ++y) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; ++x) {
      const u = (x + 0.5) / size;
      sampleSurface(family, u, v, definition, sample);
      const pixel = y * size + x;
      const offset = pixel * 4;
      heights[pixel] = sample.height;
      let red = THREE.MathUtils.lerp(definition.dark[0], definition.light[0], sample.tone);
      let green = THREE.MathUtils.lerp(definition.dark[1], definition.light[1], sample.tone);
      let blue = THREE.MathUtils.lerp(definition.dark[2], definition.light[2], sample.tone);
      red = THREE.MathUtils.lerp(red, definition.accent[0], sample.accent);
      green = THREE.MathUtils.lerp(green, definition.accent[1], sample.accent);
      blue = THREE.MathUtils.lerp(blue, definition.accent[2], sample.accent);
      albedoBytes[offset] = Math.round(clamp01(red) * 255);
      albedoBytes[offset + 1] = Math.round(clamp01(green) * 255);
      albedoBytes[offset + 2] = Math.round(clamp01(blue) * 255);
      albedoBytes[offset + 3] = 255;
      const roughness = Math.round(sample.roughness * 255);
      // Three.js consumes roughness from the green channel; mirroring it into
      // RGB also makes the DataTexture useful to explicit TSL sampling.
      roughnessBytes[offset] = roughness;
      roughnessBytes[offset + 1] = roughness;
      roughnessBytes[offset + 2] = roughness;
      roughnessBytes[offset + 3] = 255;
    }
  }

  const gradientStrength = 9.5 * definition.normalScale;
  for (let y = 0; y < size; ++y) {
    const previousY = modulo(y - 1, size);
    const nextY = modulo(y + 1, size);
    for (let x = 0; x < size; ++x) {
      const previousX = modulo(x - 1, size);
      const nextX = modulo(x + 1, size);
      const dx = (heights[y * size + nextX] - heights[y * size + previousX]) * gradientStrength;
      const dy = (heights[nextY * size + x] - heights[previousY * size + x]) * gradientStrength;
      const inverseLength = 1 / Math.max(1e-8, Math.hypot(dx, dy, 1));
      const offset = (y * size + x) * 4;
      normalBytes[offset] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
      normalBytes[offset + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
      normalBytes[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
      normalBytes[offset + 3] = 255;
    }
  }

  const prefix = `Flash flood ${definition.label}`;
  const albedo = textureFromBytes(
    albedoBytes,
    size,
    `${prefix} albedo`,
    THREE.SRGBColorSpace,
    definition.repeat,
    anisotropy,
  );
  const roughness = textureFromBytes(
    roughnessBytes,
    size,
    `${prefix} roughness`,
    THREE.NoColorSpace,
    definition.repeat,
    anisotropy,
  );
  const normal = textureFromBytes(
    normalBytes,
    size,
    `${prefix} tangent normal`,
    THREE.NoColorSpace,
    definition.repeat,
    anisotropy,
  );
  const byteLength = albedoBytes.byteLength + roughnessBytes.byteLength + normalBytes.byteLength;

  return Object.freeze({
    family,
    label: definition.label,
    size,
    anisotropy,
    repeat: definition.repeat,
    normalScale: definition.normalScale,
    albedo,
    roughness,
    normal,
    byteLength,
  });
}

/**
 * Lazily returns one shared family-specific texture set.  Repeated calls with
 * the same family, size and anisotropy return the identical texture objects.
 */
export function getSurfaceTextureSet(kind, {
  size = DEFAULT_SIZE,
  anisotropy = DEFAULT_ANISOTROPY,
} = {}) {
  const family = normalizeFamily(kind);
  const normalizedSize = normalizeSize(size);
  const normalizedAnisotropy = normalizeAnisotropy(anisotropy);
  const key = `${family}:${normalizedSize}:${normalizedAnisotropy}`;
  let set = CACHE.get(key);
  if (!set) {
    set = generateTextureSet(family, normalizedSize, normalizedAnisotropy);
    CACHE.set(key, set);
  }
  return set;
}

/**
 * Applies one cached triplet to an ordinary physical node material. The
 * authored scalar/tint controls remain available as deliberate multipliers,
 * while native MRT guides consume the fully resolved mapped PBR values.
 */
export function applySurfaceTextureSet(material, kind, {
  tint = null,
  roughness = null,
  normalStrength = 1,
  size = DEFAULT_SIZE,
  anisotropy = DEFAULT_ANISOTROPY,
} = {}) {
  if (!material) throw new TypeError("applySurfaceTextureSet requires a material");
  const set = getSurfaceTextureSet(kind, { size, anisotropy });
  material.map = set.albedo;
  material.roughnessMap = set.roughness;
  material.normalMap = set.normal;
  if (tint != null && material.color?.set) material.color.set(tint);
  if (roughness != null && Number.isFinite(Number(roughness))) {
    material.roughness = THREE.MathUtils.clamp(Number(roughness), 0, 1);
  }
  const strength = Math.max(0, Number(normalStrength) || 0) * set.normalScale;
  if (material.normalScale?.set) material.normalScale.set(strength, strength);
  material.rtxUsesResolvedPbr = 1;
  material.userData.surfaceTextureFamily = set.family;
  material.userData.surfaceTextureResolution = set.size;
  material.needsUpdate = true;
  return set;
}

/** Disposes one cached configuration without touching other family variants. */
export function disposeSurfaceTextureSet(kind, options = {}) {
  const family = normalizeFamily(kind);
  const size = normalizeSize(options.size ?? DEFAULT_SIZE);
  const anisotropy = normalizeAnisotropy(options.anisotropy ?? DEFAULT_ANISOTROPY);
  const key = `${family}:${size}:${anisotropy}`;
  const set = CACHE.get(key);
  if (!set) return false;
  set.albedo.dispose();
  set.roughness.dispose();
  set.normal.dispose();
  CACHE.delete(key);
  return true;
}

/** Disposes every cached DataTexture owned by this module. */
export function disposeSurfaceTextureCache() {
  let texturesDisposed = 0;
  for (const set of CACHE.values()) {
    set.albedo.dispose();
    set.roughness.dispose();
    set.normal.dispose();
    texturesDisposed += 3;
  }
  CACHE.clear();
  return texturesDisposed;
}

/** Lightweight allocation information for diagnostics and sample tests. */
export function getSurfaceTextureStats() {
  const families = new Set();
  let byteLength = 0;
  for (const set of CACHE.values()) {
    families.add(set.family);
    byteLength += set.byteLength;
  }
  return {
    cachedSets: CACHE.size,
    cachedTextures: CACHE.size * 3,
    cachedFamilies: families.size,
    byteLength,
    availableFamilies: Object.keys(DEFINITIONS).length,
  };
}
