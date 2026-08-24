import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  color,
  float,
  fract,
  max,
  mix,
  mx_fractal_noise_float,
  normalMap,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  vec3,
} from "three/tsl";
import {
  beaconStrength,
  graphicsTime,
  worldCorruption,
  worldNight,
  worldWetness,
} from "./state.mjs";

const TEXTURE_SIZE = 96;
const textureCache = new Map();

export const WORLD_PALETTE = Object.freeze({
  grass: 0x49613b,
  moss: 0x384e2d,
  mud: 0x5b4931,
  trail: 0x746047,
  villageStone: 0x8a8172,
  fortressStone: 0x252b2b,
  plaster: 0xc3b594,
  timber: 0x563821,
  thatch: 0x9a7b47,
  iron: 0x373b3b,
  leaf: 0x29472b,
  pine: 0x183727,
  crop: 0xb19447,
  water: 0x244f58,
  warm: 0xffb35a,
  beacon: 0xffd48a,
  corruption: 0x592f75,
});

const SURFACES = Object.freeze({
  soil: { seed: 0x534f494c, base: [0.39, 0.31, 0.20], repeat: [22, 26], grain: 1.15 },
  stone: { seed: 0x53544f4e, base: [0.58, 0.55, 0.49], repeat: [7, 7], grain: 2.2 },
  basalt: { seed: 0x42415341, base: [0.17, 0.19, 0.19], repeat: [8, 8], grain: 2.8 },
  timber: { seed: 0x54494d42, base: [0.35, 0.22, 0.12], repeat: [4, 13], grain: 1.8 },
  thatch: { seed: 0x54484154, base: [0.58, 0.45, 0.24], repeat: [8, 18], grain: 2.0 },
  plaster: { seed: 0x504c4153, base: [0.73, 0.68, 0.55], repeat: [6, 6], grain: 1.0 },
  iron: { seed: 0x49524f4e, base: [0.24, 0.25, 0.24], repeat: [9, 9], grain: 2.6 },
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hash2(x, y, seed) {
  let value = seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function smooth(value) {
  return value * value * (3 - value * 2);
}

function valueNoise(u, v, frequency, seed) {
  const x = u * frequency;
  const y = v * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

function fbm(u, v, seed) {
  let sum = 0;
  let amplitude = 0.55;
  let normalizer = 0;
  let frequency = 3;
  for (let octave = 0; octave < 5; ++octave) {
    sum += valueNoise(u, v, frequency, seed + octave * 1013) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.52;
    frequency *= 2.06;
  }
  return sum / normalizer;
}

function makeTexture(data, name, role, repeat) {
  const textureValue = new THREE.DataTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  textureValue.name = `Medieval valley procedural ${name} ${role}`;
  textureValue.colorSpace = role === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  textureValue.wrapS = THREE.RepeatWrapping;
  textureValue.wrapT = THREE.RepeatWrapping;
  textureValue.minFilter = THREE.LinearMipmapLinearFilter;
  textureValue.magFilter = THREE.LinearFilter;
  textureValue.generateMipmaps = true;
  textureValue.anisotropy = 4;
  textureValue.repeat.set(repeat[0], repeat[1]);
  textureValue.userData.sharedProceduralTexture = true;
  textureValue.needsUpdate = true;
  return textureValue;
}

function createSurfaceTextures(kind) {
  const profile = SURFACES[kind];
  if (!profile) throw new Error(`Unknown procedural surface: ${kind}`);
  const texels = TEXTURE_SIZE * TEXTURE_SIZE;
  const albedoBytes = new Uint8Array(texels * 4);
  const roughnessBytes = new Uint8Array(texels * 4);
  const normalBytes = new Uint8Array(texels * 4);
  const heights = new Float32Array(texels);
  for (let y = 0; y < TEXTURE_SIZE; ++y) {
    for (let x = 0; x < TEXTURE_SIZE; ++x) {
      const u = (x + 0.5) / TEXTURE_SIZE;
      const v = (y + 0.5) / TEXTURE_SIZE;
      const broad = fbm(u, v, profile.seed);
      const fine = valueNoise(u, v, 39, profile.seed ^ 0x68bc21eb);
      const fibre = kind === "timber" || kind === "thatch"
        ? Math.pow(Math.max(0, Math.cos((u * 4 + broad * 0.7) * Math.PI * 2)), kind === "thatch" ? 10 : 22)
        : 0;
      const block = kind === "stone" || kind === "basalt"
        ? Math.max(
          Math.pow(Math.abs(Math.cos((u * 5 + (Math.floor(v * 7) & 1) * 0.5) * Math.PI)), 26),
          Math.pow(Math.abs(Math.cos(v * 7 * Math.PI)), 30),
        )
        : 0;
      const height = clamp01(0.46 + (broad - 0.5) * 0.32 + (fine - 0.5) * 0.12 + fibre * 0.08 - block * 0.16);
      const shade = clamp01(0.82 + (broad - 0.5) * 0.30 + (fine - 0.5) * 0.08 - block * 0.24);
      const offset = (y * TEXTURE_SIZE + x) * 4;
      albedoBytes[offset] = Math.round(clamp01(profile.base[0] * shade) * 255);
      albedoBytes[offset + 1] = Math.round(clamp01(profile.base[1] * shade) * 255);
      albedoBytes[offset + 2] = Math.round(clamp01(profile.base[2] * shade) * 255);
      albedoBytes[offset + 3] = 255;
      const rough = Math.round(clamp01(0.72 + (fine - 0.5) * 0.22 + block * 0.16 - fibre * 0.08) * 255);
      roughnessBytes[offset] = rough;
      roughnessBytes[offset + 1] = rough;
      roughnessBytes[offset + 2] = rough;
      roughnessBytes[offset + 3] = 255;
      heights[y * TEXTURE_SIZE + x] = height;
    }
  }
  const wrap = (value) => (value + TEXTURE_SIZE) % TEXTURE_SIZE;
  const heightAt = (x, y) => heights[wrap(y) * TEXTURE_SIZE + wrap(x)];
  for (let y = 0; y < TEXTURE_SIZE; ++y) {
    for (let x = 0; x < TEXTURE_SIZE; ++x) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * profile.grain;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * profile.grain;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const offset = (y * TEXTURE_SIZE + x) * 4;
      normalBytes[offset] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      normalBytes[offset + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      normalBytes[offset + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      normalBytes[offset + 3] = 255;
    }
  }
  const textures = {
    albedo: makeTexture(albedoBytes, kind, "albedo", profile.repeat),
    roughness: makeTexture(roughnessBytes, kind, "roughness", profile.repeat),
    normal: makeTexture(normalBytes, kind, "normal", profile.repeat),
    refs: 0,
  };
  return textures;
}

export function acquireSurfaceTextures(kind) {
  let set = textureCache.get(kind);
  if (!set) {
    set = createSurfaceTextures(kind);
    textureCache.set(kind, set);
  }
  set.refs += 1;
  return set;
}

export function releaseSurfaceTextures(kind) {
  const set = textureCache.get(kind);
  if (!set) return;
  set.refs = Math.max(0, set.refs - 1);
  if (set.refs > 0) return;
  set.albedo.dispose();
  set.roughness.dispose();
  set.normal.dispose();
  textureCache.delete(kind);
}

function tagMaterial(material, reflectionMask = 0, radiance = null) {
  material.rtxReflectionMask = THREE.MathUtils.clamp(reflectionMask, 0, 1);
  if (radiance) material.userData.rtxTriangleRadiance = [...radiance];
  return material;
}

function wetSurfaceMaterial(name, set, options) {
  const {
    colorValue,
    roughness = 0.78,
    metalness = 0,
    normalStrength = 0.8,
    wetResponse = 0.72,
    reflectionMask = 0.08,
  } = options;
  const material = new THREE.MeshPhysicalNodeMaterial({
    name,
    color: colorValue,
    roughness,
    metalness,
    clearcoat: wetResponse * 0.22,
    clearcoatRoughness: 0.28,
  });
  const base = mix(texture(set.albedo).rgb, color(colorValue), 0.34);
  const puddleNoise = mx_fractal_noise_float(positionWorld.mul(vec3(0.12, 0.035, 0.12)), 3, 2.07, 0.51)
    .mul(0.5).add(0.5);
  const exposed = smoothstep(0.18, 0.78, puddleNoise).mul(worldWetness).mul(wetResponse);
  material.colorNode = mix(base, base.mul(color(0x48596a)), exposed.mul(0.52));
  material.roughnessNode = mix(
    texture(set.roughness).r.mul(roughness).add(0.12).min(1),
    float(0.16),
    exposed,
  );
  material.normalNode = normalMap(texture(set.normal), new THREE.Vector2(normalStrength, normalStrength));
  return tagMaterial(material, reflectionMask);
}

function makeTerrainMaterial(soil, stone) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Valley terrain — procedural wet loam and moss",
    color: WORLD_PALETTE.grass,
    roughness: 0.9,
    metalness: 0,
  });
  const noise = mx_fractal_noise_float(positionWorld.mul(vec3(0.045, 0.08, 0.045)), 4, 2.03, 0.52)
    .mul(0.5).add(0.5);
  const detail = mx_fractal_noise_float(positionWorld.mul(vec3(0.31, 0.14, 0.31)), 3, 2.17, 0.48)
    .mul(0.5).add(0.5);
  const slope = float(1).sub(abs(normalWorld.y)).saturate();
  const exposedStone = smoothstep(0.12, 0.58, slope.add(positionWorld.y.mul(0.012))).mul(0.78);
  const riverDistance = abs(positionWorld.z.sub(sin(positionWorld.x.mul(0.022)).mul(12).add(62)));
  const riverBank = float(1).sub(smoothstep(6, 24, riverDistance));
  const wet = worldWetness.mul(noise.mul(0.62).add(riverBank.mul(0.74))).saturate();
  const grassTint = mix(color(0x344d2d), color(0x607443), detail);
  const soilNode = mix(texture(soil.albedo).rgb, color(0x8a7956), 0.34);
  const stoneNode = mix(texture(stone.albedo).rgb, color(0x9b9585), 0.34);
  let surface = mix(grassTint, soilNode, smoothstep(0.66, 0.94, noise).mul(0.48).add(riverBank.mul(0.64)));
  surface = mix(surface, stoneNode, exposedStone);
  material.colorNode = mix(surface, surface.mul(color(0x485b62)), wet.mul(0.38));
  material.roughnessNode = mix(float(0.94), float(0.24), wet).add(exposedStone.mul(0.04)).min(1);
  const micro = noise.mul(0.09).add(detail.mul(0.035));
  material.normalNode = bumpMap(micro, 0.15);
  return tagMaterial(material, 0.22);
}

function makeWindowMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Warm leaded village window",
    color: 0x5e4a31,
    roughness: 0.34,
    metalness: 0.05,
  });
  const warm = color(WORLD_PALETTE.warm);
  material.colorNode = mix(color(0x302c28), warm, worldNight.mul(0.74));
  material.emissiveNode = warm.mul(worldNight.mul(2.2).add(0.035));
  return tagMaterial(material, 0.24, [0.24, 0.09, 0.022, 1]);
}

function makeBeaconMaterial() {
  const pulse = sin(graphicsTime.mul(3.1)).mul(0.5).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Beacon crystal glow",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.colorNode = mix(color(0x502f68), color(WORLD_PALETTE.beacon), beaconStrength)
    .mul(beaconStrength.mul(pulse.mul(0.35).add(1.2)).add(worldCorruption.mul(0.32)));
  material.opacityNode = beaconStrength.mul(0.78).add(worldCorruption.mul(0.18));
  material.rtxReflectionMask = 0;
  return material;
}

/**
 * Creates the shared, disposable material library used by the whole valley.
 * All surface maps are deterministic DataTextures and all exposed surfaces
 * respond to the global TSL wetness uniform.
 */
export function createMaterialLibrary() {
  const acquired = {};
  for (const kind of Object.keys(SURFACES)) acquired[kind] = acquireSurfaceTextures(kind);
  const materials = {
    terrain: makeTerrainMaterial(acquired.soil, acquired.stone),
    soil: wetSurfaceMaterial("Wet field loam", acquired.soil, { colorValue: 0x806846, roughness: 0.95, wetResponse: 1, reflectionMask: 0.2 }),
    trail: wetSurfaceMaterial("Packed valley trail", acquired.soil, { colorValue: WORLD_PALETTE.trail, roughness: 0.9, wetResponse: 1, reflectionMask: 0.28 }),
    stone: wetSurfaceMaterial("Village fieldstone", acquired.stone, { colorValue: WORLD_PALETTE.villageStone, roughness: 0.88, normalStrength: 1.2, reflectionMask: 0.2 }),
    fortress: wetSurfaceMaterial("Ancient black fortress stone", acquired.basalt, { colorValue: WORLD_PALETTE.fortressStone, roughness: 0.84, normalStrength: 1.5, wetResponse: 0.92, reflectionMask: 0.34 }),
    wood: wetSurfaceMaterial("Hand-hewn oak", acquired.timber, { colorValue: WORLD_PALETTE.timber, roughness: 0.78, normalStrength: 0.9, reflectionMask: 0.12 }),
    thatch: wetSurfaceMaterial("Weathered thatch", acquired.thatch, { colorValue: WORLD_PALETTE.thatch, roughness: 0.96, normalStrength: 1.15, wetResponse: 0.5, reflectionMask: 0.04 }),
    plaster: wetSurfaceMaterial("Limewashed plaster", acquired.plaster, { colorValue: WORLD_PALETTE.plaster, roughness: 0.92, normalStrength: 0.55, wetResponse: 0.7, reflectionMask: 0.1 }),
    iron: wetSurfaceMaterial("Forged black iron", acquired.iron, { colorValue: WORLD_PALETTE.iron, roughness: 0.48, metalness: 0.74, normalStrength: 0.75, reflectionMask: 0.72 }),
    roofTile: wetSurfaceMaterial("Chapel slate", acquired.basalt, { colorValue: 0x414a4b, roughness: 0.68, normalStrength: 1.1, reflectionMask: 0.46 }),
    window: makeWindowMaterial(),
    beacon: makeBeaconMaterial(),
    leaf: tagMaterial(new THREE.MeshPhysicalNodeMaterial({ name: "Wind-tossed broadleaf", color: WORLD_PALETTE.leaf, roughness: 0.88, side: THREE.DoubleSide }), 0.04),
    pine: tagMaterial(new THREE.MeshPhysicalNodeMaterial({ name: "Dark pine needles", color: WORLD_PALETTE.pine, roughness: 0.9, side: THREE.DoubleSide }), 0.03),
    crop: tagMaterial(new THREE.MeshPhysicalNodeMaterial({ name: "Barley crop", color: WORLD_PALETTE.crop, roughness: 0.92, side: THREE.DoubleSide }), 0.02),
    rope: tagMaterial(new THREE.MeshStandardMaterial({ name: "Hemp rope", color: 0x6f5837, roughness: 1 }), 0),
  };
  for (const material of Object.values(materials)) {
    material.userData.medievalValleyShared = true;
  }
  let disposed = false;
  return {
    ...materials,
    textures: acquired,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) material.dispose();
      for (const kind of Object.keys(acquired)) releaseSurfaceTextures(kind);
    },
  };
}

export function createCorruptionMaterial() {
  const pulse = sin(graphicsTime.mul(1.9).add(positionWorld.y.mul(0.7))).mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Corruption crystal",
    color: WORLD_PALETTE.corruption,
    roughness: 0.28,
    metalness: 0.08,
    transparent: true,
    opacity: 0.9,
  });
  material.colorNode = mix(color(0x1b2427), color(WORLD_PALETTE.corruption), worldCorruption.mul(0.82));
  material.emissiveNode = color(0x9c4fc2).mul(worldCorruption.mul(pulse.mul(0.85).add(0.35)));
  material.opacityNode = worldCorruption.mul(0.78).add(0.08);
  return tagMaterial(material, 0.44, [0.06, 0.012, 0.10, 1]);
}

export function createFireMaterial(intensity = uniform(1), seed = 0) {
  const lick = sin(
    positionWorld.y.mul(7.4)
      .sub(graphicsTime.mul(8.2))
      .add(positionWorld.x.mul(3.1))
      .add(seed),
  ).mul(0.5).add(0.5);
  const tip = float(1).sub(smoothstep(-0.55, 0.72, positionLocal.y));
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Reusable procedural flame",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(color(0xff4416), color(0xffd37d), pow(lick, 2)).mul(intensity);
  material.opacityNode = max(float(0), tip.mul(0.78).add(lick.mul(0.2))).mul(intensity);
  material.rtxReflectionMask = 0;
  return material;
}
