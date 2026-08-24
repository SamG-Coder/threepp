import * as THREE from "three/webgpu";

const TEXTURE_SIZE = 128;
const CHANNELS = 4;

const SURFACE_PROFILES = Object.freeze({
  asphalt: Object.freeze({ seed: 0x41535048, repeat: [12, 96], normalStrength: 3.2 }),
  concrete: Object.freeze({ seed: 0x434f4e43, repeat: [6, 6], normalStrength: 2.5 }),
  paintedMetal: Object.freeze({ seed: 0x4d455441, repeat: [7, 7], normalStrength: 1.7 }),
  glassGrime: Object.freeze({ seed: 0x474c4153, repeat: [5, 4], normalStrength: 0.72 }),
  rubber: Object.freeze({ seed: 0x52554252, repeat: [9, 5], normalStrength: 3.0 }),
});

export const PROCEDURAL_TEXTURE_KINDS = Object.freeze(Object.keys(SURFACE_PROFILES));

const textureCache = new Map();

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp01((value - edge0) / Math.max(1e-8, edge1 - edge0));
  return amount * amount * (3 - amount * 2);
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function hash2(x, y, seed) {
  let value = seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(u, v, frequency, seed) {
  const period = Math.max(1, Math.trunc(frequency));
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx0 = x - x0;
  const ty0 = y - y0;
  const tx = tx0 * tx0 * (3 - tx0 * 2);
  const ty = ty0 * ty0 * (3 - ty0 * 2);
  const sample = (sx, sy) => hash2(
    positiveModulo(sx, period),
    positiveModulo(sy, period),
    seed,
  );
  const a = sample(x0, y0);
  const b = sample(x0 + 1, y0);
  const c = sample(x0, y0 + 1);
  const d = sample(x0 + 1, y0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, tx),
    THREE.MathUtils.lerp(c, d, tx),
    ty,
  );
}

function fbm(u, v, baseFrequency, octaves, seed) {
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = baseFrequency;
  for (let octave = 0; octave < octaves; ++octave) {
    sum += valueNoise(u, v, frequency, seed + octave * 0x632be5ab) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / weight;
}

function cellDistance(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let closest = Infinity;
  for (let offsetY = -1; offsetY <= 1; ++offsetY) {
    for (let offsetX = -1; offsetX <= 1; ++offsetX) {
      const cellX = ix + offsetX;
      const cellY = iy + offsetY;
      const wrappedX = positiveModulo(cellX, cells);
      const wrappedY = positiveModulo(cellY, cells);
      const pointX = cellX + hash2(wrappedX, wrappedY, seed);
      const pointY = cellY + hash2(wrappedX, wrappedY, seed ^ 0x68bc21eb);
      closest = Math.min(closest, Math.hypot(pointX - x, pointY - y));
    }
  }
  return clamp01(closest / 0.78);
}

function asphaltSample(u, v, seed) {
  const broad = fbm(u, v, 3, 5, seed);
  const fine = fbm(u, v, 18, 3, seed ^ 0x29a3d1f5);
  const aggregate = cellDistance(u, v, 31, seed ^ 0x5f356495);
  const pit = 1 - smoothstep(0.05, 0.24, aggregate);
  const tarThread = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 7 + v * 3 + broad * 0.34))),
    22,
  );
  const value = clamp01(0.91 + (broad - 0.5) * 0.13 + (fine - 0.5) * 0.08 - pit * 0.18);
  return {
    color: [value * 0.97, value * 0.985, value],
    roughness: clamp01(0.59 + (fine - 0.5) * 0.22 + pit * 0.16 - tarThread * 0.13),
    height: clamp01(0.48 + (broad - 0.5) * 0.16 + (fine - 0.5) * 0.09 - pit * 0.20 - tarThread * 0.035),
  };
}

function concreteSample(u, v, seed) {
  const broad = fbm(u, v, 2, 5, seed);
  const grain = fbm(u, v, 22, 3, seed ^ 0xa54ff53a);
  const pores = 1 - smoothstep(0.035, 0.18, cellDistance(u, v, 38, seed ^ 0x510e527f));
  const streak = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 2 + v * 7 + broad * 0.18))),
    12,
  );
  const value = clamp01(0.94 + (broad - 0.5) * 0.10 + (grain - 0.5) * 0.055 - pores * 0.16 - streak * 0.035);
  return {
    color: [value * 0.99, value * 0.995, value],
    roughness: clamp01(0.73 + (grain - 0.5) * 0.19 + pores * 0.12 + streak * 0.06),
    height: clamp01(0.52 + (broad - 0.5) * 0.12 + (grain - 0.5) * 0.08 - pores * 0.21),
  };
}

function paintedMetalSample(u, v, seed) {
  const broad = fbm(u, v, 3, 4, seed);
  const grain = valueNoise(u, v, 48, seed ^ 0x1f83d9ab);
  const scratchA = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 37 + v * 2 + broad * 0.16))),
    48,
  );
  const scratchB = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 5 - v * 29 + grain * 0.11))),
    62,
  );
  const scratch = Math.max(scratchA, scratchB * 0.72);
  const value = clamp01(0.965 + (broad - 0.5) * 0.045 + (grain - 0.5) * 0.025 - scratch * 0.16);
  return {
    color: [value * 0.995, value * 0.998, value],
    roughness: clamp01(0.42 + (grain - 0.5) * 0.13 + scratch * 0.36),
    height: clamp01(0.51 + (broad - 0.5) * 0.035 + (grain - 0.5) * 0.025 - scratch * 0.16),
  };
}

function glassGrimeSample(u, v, seed) {
  const film = fbm(u, v, 2, 5, seed);
  const fine = fbm(u, v, 17, 3, seed ^ 0x9b05688c);
  const droplet = 1 - smoothstep(0.055, 0.20, cellDistance(u, v, 19, seed ^ 0xbb67ae85));
  const verticalStreak = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 13 + film * 0.32))),
    18,
  ) * smoothstep(0.38, 0.82, fine);
  const grime = clamp01((film - 0.34) * 0.52 + droplet * 0.42 + verticalStreak * 0.26);
  const value = clamp01(0.995 - grime * 0.17);
  return {
    color: [value * 0.985, value * 0.995, value],
    roughness: clamp01(0.08 + grime * 0.56 + (fine - 0.5) * 0.05),
    height: clamp01(0.5 + droplet * 0.15 + verticalStreak * 0.08 + (fine - 0.5) * 0.035),
  };
}

function rubberSample(u, v, seed) {
  const broad = fbm(u, v, 4, 4, seed);
  const stipple = fbm(u, v, 29, 3, seed ^ 0x3c6ef372);
  const moldingBand = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 3 + v * 17))),
    16,
  );
  const pore = 1 - smoothstep(0.045, 0.19, cellDistance(u, v, 34, seed ^ 0xcbbb9d5d));
  const value = clamp01(0.90 + (broad - 0.5) * 0.08 + (stipple - 0.5) * 0.07 - pore * 0.08);
  return {
    color: [value * 0.985, value * 0.993, value],
    roughness: clamp01(0.70 + (stipple - 0.5) * 0.19 + pore * 0.10 - moldingBand * 0.08),
    height: clamp01(0.5 + (broad - 0.5) * 0.08 + (stipple - 0.5) * 0.10 - pore * 0.09 + moldingBand * 0.045),
  };
}

const SURFACE_SAMPLERS = Object.freeze({
  asphalt: asphaltSample,
  concrete: concreteSample,
  paintedMetal: paintedMetalSample,
  glassGrime: glassGrimeSample,
  rubber: rubberSample,
});

function byte(value) {
  return Math.round(clamp01(value) * 255);
}

function makeTexture(data, kind, role, repeat) {
  const texture = new THREE.DataTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `District ${kind} procedural ${role}`;
  texture.colorSpace = role === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.userData.sharedProceduralTexture = true;
  texture.userData.surfaceKind = kind;
  texture.userData.channelRole = role;
  texture.userData.baseByteLength = data.byteLength;
  texture.needsUpdate = true;
  return texture;
}

function buildTextureSet(kind) {
  const profile = SURFACE_PROFILES[kind];
  const sampleSurface = SURFACE_SAMPLERS[kind];
  const texelCount = TEXTURE_SIZE * TEXTURE_SIZE;
  const albedoData = new Uint8Array(texelCount * CHANNELS);
  const roughnessData = new Uint8Array(texelCount * CHANNELS);
  const normalData = new Uint8Array(texelCount * CHANNELS);
  const heights = new Float32Array(texelCount);

  for (let y = 0; y < TEXTURE_SIZE; ++y) {
    for (let x = 0; x < TEXTURE_SIZE; ++x) {
      const u = (x + 0.5) / TEXTURE_SIZE;
      const v = (y + 0.5) / TEXTURE_SIZE;
      const sample = sampleSurface(u, v, profile.seed);
      const pixel = y * TEXTURE_SIZE + x;
      const offset = pixel * CHANNELS;
      albedoData[offset] = byte(sample.color[0]);
      albedoData[offset + 1] = byte(sample.color[1]);
      albedoData[offset + 2] = byte(sample.color[2]);
      albedoData[offset + 3] = 255;
      const roughness = byte(sample.roughness);
      roughnessData[offset] = roughness;
      roughnessData[offset + 1] = roughness;
      roughnessData[offset + 2] = roughness;
      roughnessData[offset + 3] = 255;
      heights[pixel] = sample.height;
    }
  }

  const heightAt = (x, y) => heights[
    positiveModulo(y, TEXTURE_SIZE) * TEXTURE_SIZE + positiveModulo(x, TEXTURE_SIZE)
  ];
  for (let y = 0; y < TEXTURE_SIZE; ++y) {
    for (let x = 0; x < TEXTURE_SIZE; ++x) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * profile.normalStrength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * profile.normalStrength;
      const inverseLength = 1 / Math.hypot(dx, dy, 1);
      const offset = (y * TEXTURE_SIZE + x) * CHANNELS;
      normalData[offset] = byte(-dx * inverseLength * 0.5 + 0.5);
      normalData[offset + 1] = byte(-dy * inverseLength * 0.5 + 0.5);
      normalData[offset + 2] = byte(inverseLength * 0.5 + 0.5);
      normalData[offset + 3] = 255;
    }
  }

  const albedo = makeTexture(albedoData, kind, "albedo", profile.repeat);
  const roughness = makeTexture(roughnessData, kind, "roughness", profile.repeat);
  const normal = makeTexture(normalData, kind, "normal", profile.repeat);
  const baseByteLength = albedoData.byteLength + roughnessData.byteLength + normalData.byteLength;
  return Object.freeze({
    kind,
    size: TEXTURE_SIZE,
    albedo,
    roughness,
    normal,
    textures: Object.freeze([albedo, roughness, normal]),
    baseByteLength,
    estimatedMipByteLength: Math.ceil(baseByteLength * 4 / 3),
  });
}

/** Returns one shared, lazily generated texture triplet for a surface kind. */
export function getProceduralTextureSet(kind) {
  if (!Object.hasOwn(SURFACE_PROFILES, kind)) {
    throw new RangeError(`Unknown district procedural texture kind: ${kind}`);
  }
  let textureSet = textureCache.get(kind);
  if (!textureSet) {
    textureSet = buildTextureSet(kind);
    textureCache.set(kind, textureSet);
  }
  return textureSet;
}

/** Diagnostic accounting uses uncompressed RGBA8 base data plus full mip cost. */
export function getProceduralTextureStats() {
  const sets = [...textureCache.values()];
  return Object.freeze({
    setCount: sets.length,
    textureCount: sets.reduce((total, set) => total + set.textures.length, 0),
    baseByteLength: sets.reduce((total, set) => total + set.baseByteLength, 0),
    estimatedMipByteLength: sets.reduce((total, set) => total + set.estimatedMipByteLength, 0),
    kinds: Object.freeze(sets.map(set => set.kind)),
  });
}

/** Call only after every district material has been released; textures are shared. */
export function disposeProceduralTextureCache() {
  for (const textureSet of textureCache.values()) {
    for (const texture of textureSet.textures) texture.dispose();
  }
  textureCache.clear();
}
