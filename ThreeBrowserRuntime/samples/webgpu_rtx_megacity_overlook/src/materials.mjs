import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  color,
  float,
  mix,
  normalMap,
  positionWorld,
  sin,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";

export const palette = Object.freeze({
  void: 0x010307,
  night: 0x03070d,
  storm: 0x26130d,
  stormOrange: 0xff7a36,
  fogCyan: 0x52cfe2,
  building: 0x1c252d,
  buildingAlt: 0x24343e,
  concrete: 0x34383b,
  wetConcrete: 0x293a40,
  steel: 0x53616b,
  wetSteel: 0x34515d,
  canal: 0x0b2430,
  canalLift: 0x275565,
  canalWall: 0x29363a,
  coolWindow: 0x91cbd2,
  warmWindow: 0xd9ae7d,
  crownWarm: 0xff873f,
  crownCool: 0x42dcff,
  red: 0xff3555,
  transit: 0x252e34,
  black: 0x05070a,
});

export const cityClock = uniform(0);

const MAP_SIZE = 128;
const CHANNELS = 4;
const proceduralTextureCache = new Map();
const activeBundles = new Set();

const SURFACE_PROFILES = Object.freeze({
  concrete: Object.freeze({ seed: 0x434f4e43, repeat: [8, 12], normalStrength: 2.8 }),
  paintedMetal: Object.freeze({ seed: 0x4d455441, repeat: [12, 8], normalStrength: 1.9 }),
  glassGrime: Object.freeze({ seed: 0x474c4153, repeat: [4, 7], normalStrength: 0.82 }),
});

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
  const sample = (sampleX, sampleY) => hash2(
    positiveModulo(sampleX, period),
    positiveModulo(sampleY, period),
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

function concreteSample(u, v, seed) {
  const broad = fbm(u, v, 2, 5, seed);
  const aggregate = fbm(u, v, 28, 3, seed ^ 0xa54ff53a);
  const pores = 1 - smoothstep(
    0.035,
    0.19,
    cellDistance(u, v, 43, seed ^ 0x510e527f),
  );
  const rainStreak = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 3 + v * 11 + broad * 0.13))),
    20,
  );
  const hairline = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 7 - v * 5 + broad * 0.48))),
    54,
  );
  const value = clamp01(
    0.92 + (broad - 0.5) * 0.13 + (aggregate - 0.5) * 0.07 -
    pores * 0.18 - rainStreak * 0.055 - hairline * 0.08,
  );
  return {
    color: [value * 0.985, value * 0.995, value],
    roughness: clamp01(
      0.72 + (aggregate - 0.5) * 0.22 + pores * 0.13 + rainStreak * 0.08,
    ),
    height: clamp01(
      0.52 + (broad - 0.5) * 0.14 + (aggregate - 0.5) * 0.09 -
      pores * 0.24 - hairline * 0.08,
    ),
  };
}

function paintedMetalSample(u, v, seed) {
  const broad = fbm(u, v, 3, 4, seed);
  const grain = valueNoise(u, v, 58, seed ^ 0x1f83d9ab);
  const brushed = valueNoise(u, v, 83, seed ^ 0x5be0cd19);
  const scratchA = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 43 + v * 1.7 + broad * 0.15))),
    64,
  );
  const scratchB = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 7 - v * 37 + brushed * 0.09))),
    76,
  );
  const seamWear = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 4 + v * 4))),
    36,
  );
  const scratch = Math.max(scratchA, scratchB * 0.72);
  const value = clamp01(
    0.955 + (broad - 0.5) * 0.055 + (grain - 0.5) * 0.035 -
    scratch * 0.19 - seamWear * 0.04,
  );
  return {
    color: [value * 0.985, value * 0.995, value],
    roughness: clamp01(
      0.39 + (grain - 0.5) * 0.16 + scratch * 0.39 + seamWear * 0.12,
    ),
    height: clamp01(
      0.51 + (broad - 0.5) * 0.045 + (brushed - 0.5) * 0.03 - scratch * 0.18,
    ),
  };
}

function glassGrimeSample(u, v, seed) {
  const film = fbm(u, v, 2, 5, seed);
  const fine = fbm(u, v, 21, 3, seed ^ 0x9b05688c);
  const droplet = 1 - smoothstep(
    0.045,
    0.19,
    cellDistance(u, v, 23, seed ^ 0xbb67ae85),
  );
  const verticalStreak = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (u * 17 + film * 0.31))),
    22,
  ) * smoothstep(0.36, 0.84, fine);
  const wipeArc = Math.pow(
    Math.max(0, Math.cos(Math.PI * 2 * (Math.hypot(u - 0.18, v - 0.08) * 5.2))),
    32,
  ) * smoothstep(0.47, 0.79, film);
  const grime = clamp01(
    Math.max(0, film - 0.31) * 0.57 + droplet * 0.39 +
    verticalStreak * 0.28 + wipeArc * 0.13,
  );
  const value = clamp01(0.995 - grime * 0.21);
  return {
    color: [value * 0.98, value * 0.995, value],
    roughness: clamp01(0.09 + grime * 0.59 + (fine - 0.5) * 0.055),
    height: clamp01(
      0.5 + droplet * 0.16 + verticalStreak * 0.09 +
      wipeArc * 0.035 + (fine - 0.5) * 0.035,
    ),
  };
}

const SURFACE_SAMPLERS = Object.freeze({
  concrete: concreteSample,
  paintedMetal: paintedMetalSample,
  glassGrime: glassGrimeSample,
});

function byte(value) {
  return Math.round(clamp01(value) * 255);
}

function rendererAnisotropy(renderer) {
  try {
    const maximum = Number(renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
    return THREE.MathUtils.clamp(Number.isFinite(maximum) ? Math.trunc(maximum) : 4, 1, 8);
  } catch {
    return 4;
  }
}

function makeProceduralTexture(data, kind, role, repeat, anisotropy) {
  const result = new THREE.DataTexture(
    data,
    MAP_SIZE,
    MAP_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  result.name = `Megacity ${kind} generated ${role}`;
  result.colorSpace = role === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.wrapS = THREE.RepeatWrapping;
  result.wrapT = THREE.RepeatWrapping;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.magFilter = THREE.LinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = anisotropy;
  result.repeat.set(repeat[0], repeat[1]);
  result.userData.megacityProcedural = true;
  result.userData.surfaceKind = kind;
  result.userData.channelRole = role;
  result.userData.baseByteLength = data.byteLength;
  result.needsUpdate = true;
  return result;
}

function buildTextureSet(kind, anisotropy) {
  const profile = SURFACE_PROFILES[kind];
  const sampleSurface = SURFACE_SAMPLERS[kind];
  const texelCount = MAP_SIZE * MAP_SIZE;
  const albedoData = new Uint8Array(texelCount * CHANNELS);
  const roughnessData = new Uint8Array(texelCount * CHANNELS);
  const normalData = new Uint8Array(texelCount * CHANNELS);
  const heights = new Float32Array(texelCount);

  for (let y = 0; y < MAP_SIZE; ++y) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const u = (x + 0.5) / MAP_SIZE;
      const v = (y + 0.5) / MAP_SIZE;
      const sample = sampleSurface(u, v, profile.seed);
      const pixel = y * MAP_SIZE + x;
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
    positiveModulo(y, MAP_SIZE) * MAP_SIZE + positiveModulo(x, MAP_SIZE)
  ];
  for (let y = 0; y < MAP_SIZE; ++y) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * profile.normalStrength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * profile.normalStrength;
      const inverseLength = 1 / Math.hypot(dx, dy, 1);
      const offset = (y * MAP_SIZE + x) * CHANNELS;
      normalData[offset] = byte(-dx * inverseLength * 0.5 + 0.5);
      normalData[offset + 1] = byte(-dy * inverseLength * 0.5 + 0.5);
      normalData[offset + 2] = byte(inverseLength * 0.5 + 0.5);
      normalData[offset + 3] = 255;
    }
  }

  const albedo = makeProceduralTexture(
    albedoData,
    kind,
    "albedo",
    profile.repeat,
    anisotropy,
  );
  const roughness = makeProceduralTexture(
    roughnessData,
    kind,
    "roughness",
    profile.repeat,
    anisotropy,
  );
  const normal = makeProceduralTexture(
    normalData,
    kind,
    "normal",
    profile.repeat,
    anisotropy,
  );
  return Object.freeze({
    kind,
    albedo,
    roughness,
    normal,
    textures: Object.freeze([albedo, roughness, normal]),
  });
}

function getTextureSet(kind, anisotropy) {
  let textureSet = proceduralTextureCache.get(kind);
  if (!textureSet) {
    textureSet = buildTextureSet(kind, anisotropy);
    proceduralTextureCache.set(kind, textureSet);
  }
  return textureSet;
}

function disposeProceduralTextureCache() {
  for (const textureSet of proceduralTextureCache.values()) {
    for (const ownedTexture of textureSet.textures) ownedTexture.dispose();
  }
  proceduralTextureCache.clear();
}

function linearColor(value) {
  if (value?.isColor) return value.clone();
  return new THREE.Color(value ?? 0xffffff);
}

function rgbaRadiance(value, intensity = 1) {
  const result = linearColor(value).multiplyScalar(Math.max(0, Number(intensity) || 0));
  return [result.r, result.g, result.b, 1];
}

function tagMaterial(material, {
  reflectionMask = 0,
  surfaceColor = material.color,
  surfaceRoughness = material.roughness,
  radiance = null,
  rtxIgnore = false,
} = {}) {
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  material.rtxReflectionMask = THREE.MathUtils.clamp(Number(reflectionMask) || 0, 0, 1);
  const surface = linearColor(surfaceColor);
  const roughness = THREE.MathUtils.clamp(
    Number.isFinite(Number(surfaceRoughness)) ? Number(surfaceRoughness) : material.roughness,
    0.02,
    1,
  );
  material.userData.rtxTriangleSurface = [surface.r, surface.g, surface.b, roughness];
  material.userData.megacityMaterial = true;
  if (radiance) material.userData.rtxTriangleRadiance = [...radiance];
  if (rtxIgnore) material.userData.rtxIgnore = true;
  return material;
}

function applyMappedNodes(material, maps, baseHex, {
  albedoInfluence = 0.55,
  roughnessMin = 0.25,
  roughnessMax = 0.85,
  normalStrength = 0.3,
} = {}) {
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  material.colorNode = color(baseHex).mul(
    mix(vec3(1), mappedAlbedo, float(albedoInfluence)),
  );
  material.roughnessNode = mix(
    float(roughnessMin),
    float(roughnessMax),
    mappedRoughness,
  ).clamp(0.02, 1);
  material.normalNode = normalMap(
    texture(maps.normal).rgb,
    vec2(normalStrength, normalStrength),
  );
  material.userData.proceduralTextureKind = maps.kind;
  return material;
}

function createMappedStandard(name, maps, baseHex, {
  roughness,
  metalness,
  reflectionMask = 0,
  albedoInfluence,
  roughnessMin,
  roughnessMax,
  normalStrength,
} = {}) {
  const material = new THREE.MeshStandardNodeMaterial({
    name,
    color: baseHex,
    roughness,
    metalness,
  });
  applyMappedNodes(material, maps, baseHex, {
    albedoInfluence,
    roughnessMin,
    roughnessMax,
    normalStrength,
  });
  return tagMaterial(material, { reflectionMask });
}

function createMappedPhysical(name, maps, baseHex, {
  roughness,
  metalness,
  clearcoat,
  clearcoatRoughness,
  envMapIntensity = 1,
  reflectionMask = 0,
  albedoInfluence,
  roughnessMin,
  roughnessMax,
  normalStrength,
} = {}) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name,
    color: baseHex,
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness,
    envMapIntensity,
  });
  applyMappedNodes(material, maps, baseHex, {
    albedoInfluence,
    roughnessMin,
    roughnessMax,
    normalStrength,
  });
  return tagMaterial(material, { reflectionMask });
}

function createWindowMaterial({
  name,
  maps,
  baseHex,
  emissiveHex,
  emissiveIntensity,
  proxyIntensity,
  roughness,
  phase,
}) {
  const material = new THREE.MeshStandardNodeMaterial({
    name,
    color: baseHex,
    roughness,
    metalness: 0,
    emissive: emissiveHex,
    emissiveIntensity,
    side: THREE.DoubleSide,
  });
  applyMappedNodes(material, maps, baseHex, {
    albedoInfluence: 0.48,
    roughnessMin: Math.max(0.16, roughness - 0.12),
    roughnessMax: Math.min(0.78, roughness + 0.24),
    normalStrength: 0.16,
  });
  const grimeTransmission = mix(
    float(0.76),
    float(1),
    float(1).sub(texture(maps.roughness).r).clamp(0, 1),
  );
  // Variation is tied to world-space panes, not a high-frequency time pulse:
  // occupied floors retain readable clusters without becoming flat neon cards.
  const occupancyBreakup = sin(
    positionWorld.x.mul(0.023)
      .add(positionWorld.y.mul(0.117))
      .add(positionWorld.z.mul(0.019))
      .add(phase * 1.73),
  ).mul(0.075).add(0.925);
  const flicker = sin(
    positionWorld.x.mul(0.071)
      .add(positionWorld.y.mul(0.113))
      .add(positionWorld.z.mul(0.037))
      .add(cityClock.mul(0.18 + phase * 0.017))
      .add(phase),
  ).mul(0.018).add(0.982);
  material.emissiveNode = color(emissiveHex)
    .mul(float(emissiveIntensity))
    .mul(flicker)
    .mul(occupancyBreakup)
    .mul(grimeTransmission);
  return tagMaterial(material, {
    reflectionMask: 0,
    radiance: rgbaRadiance(emissiveHex, proxyIntensity),
  });
}

function createEmitterMaterial(name, baseHex, emissiveHex, emissiveIntensity, proxyIntensity) {
  const material = new THREE.MeshStandardNodeMaterial({
    name,
    color: baseHex,
    roughness: 0.48,
    metalness: 0.02,
    emissive: emissiveHex,
    emissiveIntensity,
    side: THREE.DoubleSide,
  });
  const shimmer = sin(
    positionWorld.y.mul(0.061)
      .add(positionWorld.x.mul(0.019))
      .add(cityClock.mul(0.23)),
  ).mul(0.012).add(0.988);
  material.emissiveNode = color(emissiveHex)
    .mul(float(emissiveIntensity))
    .mul(shimmer);
  return tagMaterial(material, {
    reflectionMask: 0,
    radiance: rgbaRadiance(emissiveHex, proxyIntensity),
  });
}

function createFallbackAtlas(anisotropy) {
  const size = 64;
  const data = new Uint8Array(size * size * CHANNELS);
  const tileColors = [
    [42, 221, 255], [255, 80, 165], [255, 136, 57], [73, 122, 255],
    [86, 255, 196], [255, 62, 82], [247, 207, 103], [73, 224, 255],
    [206, 87, 255], [255, 154, 78], [84, 173, 255], [255, 71, 121],
    [82, 240, 215], [255, 184, 91], [107, 131, 255], [252, 83, 171],
  ];
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const tileX = Math.min(3, Math.floor(x / 16));
      const tileY = Math.min(3, Math.floor(y / 16));
      const tile = tileY * 4 + tileX;
      const localX = x & 15;
      const localY = y & 15;
      const line = localX === 1 || localX === 14 || localY === 2 || localY === 13 ||
        ((localX + localY + tile * 3) % 7 === 0);
      const strength = line ? 1 : 0.075 + hash2(x, y, 0x41544c53) * 0.055;
      const offset = (y * size + x) * CHANNELS;
      data[offset] = Math.round(tileColors[tile][0] * strength);
      data[offset + 1] = Math.round(tileColors[tile][1] * strength);
      data[offset + 2] = Math.round(tileColors[tile][2] * strength);
      data[offset + 3] = 255;
    }
  }
  const atlas = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  atlas.name = "Megacity deterministic fallback display atlas";
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = true;
  atlas.anisotropy = anisotropy;
  atlas.needsUpdate = true;
  return atlas;
}

function createAtlasTileTexture(source, tileIndex, anisotropy) {
  const tile = source.clone();
  const column = tileIndex % 4;
  const row = Math.floor(tileIndex / 4);
  tile.name = `Megacity display atlas tile ${String(tileIndex + 1).padStart(2, "0")}`;
  tile.colorSpace = THREE.SRGBColorSpace;
  tile.wrapS = THREE.ClampToEdgeWrapping;
  tile.wrapT = THREE.ClampToEdgeWrapping;
  tile.minFilter = THREE.LinearMipmapLinearFilter;
  tile.magFilter = THREE.LinearFilter;
  tile.generateMipmaps = true;
  tile.anisotropy = anisotropy;
  tile.matrixAutoUpdate = true;
  tile.repeat.set(0.25, 0.25);
  tile.offset.set(column * 0.25, 1 - (row + 1) * 0.25);
  tile.center.set(0, 0);
  tile.rotation = 0;
  tile.updateMatrix();
  tile.userData.megacityAtlasTile = tileIndex;
  tile.userData.megacityOwnedClone = true;
  tile.needsUpdate = true;
  return tile;
}

function createBillboardMaterial(tileTexture, tileIndex) {
  const emissiveIntensity = 2.9 + (tileIndex % 4) * 0.38 + Math.floor(tileIndex / 4) * 0.08;
  const material = new THREE.MeshStandardNodeMaterial({
    name: `Megacity original billboard tile ${String(tileIndex + 1).padStart(2, "0")}`,
    color: 0xffffff,
    map: tileTexture,
    roughness: 0.52,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: tileTexture,
    emissiveIntensity,
    side: THREE.DoubleSide,
  });
  material.userData.baseAtlasIntensity = emissiveIntensity;
  return tagMaterial(material, {
    reflectionMask: 0,
    radiance: rgbaRadiance(0xbfdbe3, 1.2),
    // The low-poly billboard housing supplies native occlusion and a separate
    // broad radiance proxy. Textured raster faces are not representable in the
    // bridge's per-triangle secondary-hit material contract.
    rtxIgnore: true,
  });
}

/**
 * Creates one complete megacity material bundle. Generated surface maps are
 * shared across bundles; atlas tile textures are cloned so each material owns
 * an independent 4x4 crop without mutating the caller's atlas texture.
 */
export function createMegacityMaterials({ renderer = null, atlasTexture = null } = {}) {
  const anisotropy = rendererAnisotropy(renderer);
  const concreteMaps = getTextureSet("concrete", anisotropy);
  const metalMaps = getTextureSet("paintedMetal", anisotropy);
  const glassMaps = getTextureSet("glassGrime", anisotropy);

  const darkBuilding = createMappedStandard(
    "Megacity dark charcoal facade",
    metalMaps,
    palette.building,
    {
      roughness: 0.78,
      metalness: 0.08,
      reflectionMask: 0,
      albedoInfluence: 0.62,
      roughnessMin: 0.64,
      roughnessMax: 0.88,
      normalStrength: 0.28,
    },
  );
  const darkBuildingAlt = createMappedStandard(
    "Megacity blue-black alternate facade",
    metalMaps,
    palette.buildingAlt,
    {
      roughness: 0.72,
      metalness: 0.12,
      reflectionMask: 0,
      albedoInfluence: 0.58,
      roughnessMin: 0.59,
      roughnessMax: 0.84,
      normalStrength: 0.25,
    },
  );
  const concrete = createMappedStandard(
    "Megacity weathered dry concrete",
    concreteMaps,
    palette.concrete,
    {
      roughness: 0.86,
      metalness: 0,
      reflectionMask: 0,
      albedoInfluence: 0.66,
      roughnessMin: 0.72,
      roughnessMax: 0.96,
      normalStrength: 0.38,
    },
  );
  const wetConcrete = createMappedPhysical(
    "Megacity rain-darkened wet concrete",
    concreteMaps,
    palette.wetConcrete,
    {
      roughness: 0.47,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.66,
      reflectionMask: 0.22,
      albedoInfluence: 0.64,
      roughnessMin: 0.36,
      roughnessMax: 0.61,
      normalStrength: 0.34,
    },
  );
  const structuralMetal = createMappedStandard(
    "Megacity brushed structural metal",
    metalMaps,
    palette.steel,
    {
      roughness: 0.48,
      metalness: 0.78,
      reflectionMask: 0.08,
      albedoInfluence: 0.5,
      roughnessMin: 0.39,
      roughnessMax: 0.66,
      normalStrength: 0.27,
    },
  );
  const wetMetal = createMappedPhysical(
    "Megacity rain-wet painted metal",
    metalMaps,
    palette.wetSteel,
    {
      roughness: 0.29,
      metalness: 0.76,
      clearcoat: 0.52,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.72,
      reflectionMask: 0.4,
      albedoInfluence: 0.54,
      roughnessMin: 0.23,
      roughnessMax: 0.45,
      normalStrength: 0.27,
    },
  );

  const canalRippleA = sin(
    positionWorld.x.mul(0.105)
      .add(positionWorld.z.mul(0.011))
      .sub(cityClock.mul(0.59)),
  );
  const canalRippleB = sin(
    positionWorld.x.mul(-0.046)
      .add(positionWorld.z.mul(0.019))
      .add(cityClock.mul(0.41)),
  );
  const canalRippleC = sin(
    positionWorld.x.mul(0.23)
      .sub(positionWorld.z.mul(0.027))
      .sub(cityClock.mul(0.91)),
  );
  const canalHeight = canalRippleA.mul(0.027)
    .add(canalRippleB.mul(0.012))
    .add(canalRippleC.mul(0.0045));
  const canalRoughness = float(0.145)
    .add(abs(canalRippleA).mul(0.04))
    .add(abs(canalRippleB).mul(0.028))
    .clamp(0.14, 0.215);
  const canalColor = mix(
    color(palette.canal),
    color(palette.canalLift),
    canalRippleA.mul(0.5).add(0.5).mul(0.34),
  );

  const canalWaterRaster = new THREE.MeshPhysicalNodeMaterial({
    name: "Megacity animated canal water — raster",
    color: palette.canal,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.66,
    clearcoatRoughness: 0.17,
    envMapIntensity: 0.72,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  canalWaterRaster.colorNode = canalColor;
  canalWaterRaster.normalNode = bumpMap(canalHeight, 0.28);
  canalWaterRaster.roughnessNode = canalRoughness;
  tagMaterial(canalWaterRaster, { reflectionMask: 0.68 });

  const canalWaterNative = new THREE.MeshPhysicalNodeMaterial({
    name: "Megacity animated canal water — native reflection guide",
    color: palette.canal,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.08,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  canalWaterNative.colorNode = canalColor;
  canalWaterNative.normalNode = bumpMap(canalHeight, 0.28);
  canalWaterNative.roughnessNode = canalRoughness;
  tagMaterial(canalWaterNative, { reflectionMask: 0.68 });
  canalWaterRaster.userData.materialPair = "canalWater";
  canalWaterRaster.userData.nativeGuide = false;
  canalWaterNative.userData.materialPair = "canalWater";
  canalWaterNative.userData.nativeGuide = true;

  const canalWall = createMappedStandard(
    "Megacity stained canal retaining wall",
    concreteMaps,
    palette.canalWall,
    {
      roughness: 0.76,
      metalness: 0,
      reflectionMask: 0,
      albedoInfluence: 0.68,
      roughnessMin: 0.66,
      roughnessMax: 0.91,
      normalStrength: 0.43,
    },
  );

  const windowCool = createWindowMaterial({
    name: "Megacity cool cyan window field",
    maps: glassMaps,
    baseHex: 0x182c33,
    emissiveHex: palette.coolWindow,
    emissiveIntensity: 2.75,
    proxyIntensity: 2.15,
    roughness: 0.39,
    phase: 1.7,
  });
  const windowWarm = createWindowMaterial({
    name: "Megacity warm amber window field",
    maps: glassMaps,
    baseHex: 0x30231a,
    emissiveHex: palette.warmWindow,
    emissiveIntensity: 2.55,
    proxyIntensity: 1.95,
    roughness: 0.42,
    phase: 7.3,
  });
  const windowSparse = createWindowMaterial({
    name: "Megacity sparse low-energy window field",
    maps: glassMaps,
    baseHex: 0x172126,
    emissiveHex: 0x799da2,
    emissiveIntensity: 1.25,
    proxyIntensity: 0.72,
    roughness: 0.5,
    phase: 13.1,
  });

  const sourceAtlas = atlasTexture?.isTexture
    ? atlasTexture
    : createFallbackAtlas(anisotropy);
  const ownedAtlasBase = sourceAtlas === atlasTexture ? null : sourceAtlas;
  const atlasTileTextures = [];
  const billboardTiles = [];
  for (let tileIndex = 0; tileIndex < 16; ++tileIndex) {
    const tileTexture = createAtlasTileTexture(sourceAtlas, tileIndex, anisotropy);
    atlasTileTextures.push(tileTexture);
    billboardTiles.push(createBillboardMaterial(tileTexture, tileIndex));
  }
  Object.freeze(billboardTiles);

  const crownWarm = createEmitterMaterial(
    "Megacity orange tower crown",
    0x211009,
    palette.crownWarm,
    6.6,
    5.1,
  );
  const crownCool = createEmitterMaterial(
    "Megacity cyan tower crown",
    0x071b22,
    palette.crownCool,
    6.25,
    4.8,
  );
  const redAccent = createEmitterMaterial(
    "Megacity red aviation and transit accent",
    0x21070c,
    palette.red,
    5.4,
    3.9,
  );
  const transitDeck = createMappedPhysical(
    "Megacity rain-wet elevated transit deck",
    concreteMaps,
    palette.transit,
    {
      roughness: 0.55,
      metalness: 0.04,
      clearcoat: 0.24,
      clearcoatRoughness: 0.31,
      envMapIntensity: 0.66,
      reflectionMask: 0.18,
      albedoInfluence: 0.54,
      roughnessMin: 0.46,
      roughnessMax: 0.67,
      normalStrength: 0.3,
    },
  );
  const blackFrame = createMappedStandard(
    "Megacity billboard and glazing black frame",
    metalMaps,
    palette.black,
    {
      roughness: 0.61,
      metalness: 0.48,
      reflectionMask: 0,
      albedoInfluence: 0.42,
      roughnessMin: 0.5,
      roughnessMax: 0.78,
      normalStrength: 0.18,
    },
  );

  const atmosphereNeutral = new THREE.MeshBasicNodeMaterial({
    name: "Megacity neutral cyan atmosphere card",
    color: 0x477681,
    transparent: true,
    opacity: 0.055,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    fog: false,
  });
  tagMaterial(atmosphereNeutral, { reflectionMask: 0, rtxIgnore: true });

  const ownedMaterials = [
    darkBuilding,
    darkBuildingAlt,
    concrete,
    wetConcrete,
    structuralMetal,
    wetMetal,
    canalWaterRaster,
    canalWaterNative,
    canalWall,
    windowCool,
    windowWarm,
    windowSparse,
    ...billboardTiles,
    crownWarm,
    crownCool,
    redAccent,
    transitDeck,
    blackFrame,
    atmosphereNeutral,
  ];

  let disposed = false;
  let nativeMode = false;
  let api = null;

  function setNativeMode(enabled) {
    nativeMode = Boolean(enabled);
    return nativeMode ? canalWaterNative : canalWaterRaster;
  }

  function update(elapsed) {
    if (disposed) return;
    const value = Number(elapsed);
    if (Number.isFinite(value)) cityClock.value = value;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const material of ownedMaterials) material.dispose();
    for (const ownedTexture of atlasTileTextures) ownedTexture.dispose();
    ownedAtlasBase?.dispose();
    activeBundles.delete(api);
    if (activeBundles.size === 0) disposeProceduralTextureCache();
  }

  api = Object.freeze({
    darkBuilding,
    darkBuildingAlt,
    concrete,
    wetConcrete,
    structuralMetal,
    wetMetal,
    canalWaterRaster,
    canalWaterNative,
    get canalWater() {
      return nativeMode ? canalWaterNative : canalWaterRaster;
    },
    canalWall,
    windowCool,
    windowWarm,
    windowSparse,
    billboardTiles,
    crownWarm,
    crownCool,
    redAccent,
    transitDeck,
    blackFrame,
    atmosphereNeutral,
    get nativeMode() {
      return nativeMode;
    },
    setNativeMode,
    update,
    dispose,
  });
  activeBundles.add(api);
  return api;
}

/** Disposes every live bundle and all shared generated textures. */
export function disposeMegacityMaterials() {
  for (const bundle of [...activeBundles]) bundle.dispose();
  if (activeBundles.size === 0) disposeProceduralTextureCache();
}
