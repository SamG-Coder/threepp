import * as THREE from "three/webgpu";
import {
  abs,
  cameraPosition,
  cos,
  dot,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalMap,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { HEIGHT_BOUNDS, WATER_LEVEL } from "./terrain.mjs";
export const waterTime = uniform(0);
export const waterLevel = uniform(WATER_LEVEL);
export const TILE_NAMES = Object.freeze([
  "dry-sand",
  "wet-sand",
  "pebble-hash",
  "coastal-rock",
  "dune-grass",
  "palm-bark",
]);

const WAVES = Object.freeze([
  { x: 0.94, z: 0.34, frequency: 0.42, speed: 0.78, amplitude: 0.20, chop: 0.55 },
  { x: -0.31, z: 0.95, frequency: 0.76, speed: -0.64, amplitude: 0.11, chop: 0.42 },
  { x: 0.62, z: -0.78, frequency: 1.28, speed: 0.96, amplitude: 0.055, chop: 0.28 },
  { x: -0.82, z: -0.56, frequency: 2.15, speed: -1.22, amplitude: 0.028, chop: 0.18 },
  { x: 0.22, z: -0.97, frequency: 3.85, speed: 1.64, amplitude: 0.012, chop: 0.10 },
]);

function tag(material, reflectionMask, extras = {}) {
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  material.rtxReflectionMask = reflectionMask;
  Object.assign(material.userData, extras);
  return material;
}

async function loadMap(url, { srgb = false, wrap = THREE.RepeatWrapping } = {}) {
  const textureMap = await new THREE.TextureLoader().loadAsync(url.href || url);
  textureMap.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  textureMap.wrapS = wrap;
  textureMap.wrapT = wrap;
  textureMap.anisotropy = 8;
  textureMap.generateMipmaps = true;
  textureMap.minFilter = THREE.LinearMipmapLinearFilter;
  textureMap.magFilter = THREE.LinearFilter;
  textureMap.needsUpdate = true;
  return textureMap;
}

export async function loadTileMaps(name) {
  const [albedo, heightMap, normal] = await Promise.all([
    loadMap(new URL(`../assets/textures/${name}-albedo.png`, import.meta.url), { srgb: true }),
    loadMap(new URL(`../assets/textures/${name}-height.png`, import.meta.url), { srgb: false }),
    loadMap(new URL(`../assets/textures/${name}-normal.png`, import.meta.url), { srgb: false }),
  ]);
  albedo.name = `${name}-albedo`;
  heightMap.name = `${name}-height`;
  normal.name = `${name}-normal`;
  return { albedo, heightMap, normal };
}

export async function loadAllTileMaps() {
  const entries = await Promise.all(TILE_NAMES.map(async name => [name, await loadTileMaps(name)]));
  return Object.fromEntries(entries);
}

function worldUv(repeat) {
  return positionWorld.xz.mul(vec2(repeat, repeat));
}

export function createMappedMaterial(maps, options = {}) {
  const repeat = options.repeat ?? 0.28;
  const uvNode = options.objectUv ? null : worldUv(repeat);
  const albedoSample = uvNode ? texture(maps.albedo, uvNode) : texture(maps.albedo);
  const heightSample = (uvNode ? texture(maps.heightMap, uvNode) : texture(maps.heightMap)).r;
  const mappedNormal = normalMap(
    (uvNode ? texture(maps.normal, uvNode) : texture(maps.normal)).rgb,
    vec2(options.normalScale ?? 1, options.normalScale ?? 1),
  );
  const colorNode = albedoSample.rgb.mul(options.tint ?? vec3(1, 1, 1));
  if (options.clearcoat) {
    const physical = new THREE.MeshPhysicalNodeMaterial({
      metalness: 0,
      roughness: options.roughness ?? 0.22,
      clearcoat: options.clearcoat,
      clearcoatRoughness: options.clearcoatRoughness ?? 0.18,
      color: options.color ?? 0xffffff,
    });
    physical.colorNode = colorNode;
    physical.normalNode = mappedNormal;
    physical.roughnessNode = mix(float(options.roughness ?? 0.18), float(0.42), heightSample.mul(0.45));
    return tag(physical, options.reflectionMask ?? 0.62, { tile: options.name });
  }
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: options.roughness ?? 0.86,
    color: options.color ?? 0xffffff,
  });
  material.colorNode = colorNode;
  material.normalNode = mappedNormal;
  if (options.roughnessFromHeight) {
    material.roughnessNode = mix(
      float(options.roughness ?? 0.86),
      float(options.roughnessHigh ?? 0.96),
      heightSample,
    );
  }
  return tag(material, options.reflectionMask ?? 0.08, { tile: options.name });
}

function heightMapUv(point) {
  return vec2(
    point.x.sub(HEIGHT_BOUNDS.minX).div(HEIGHT_BOUNDS.maxX - HEIGHT_BOUNDS.minX),
    point.z.sub(HEIGHT_BOUNDS.minZ).div(HEIGHT_BOUNDS.maxZ - HEIGHT_BOUNDS.minZ),
  );
}

function sampleGroundHeight(heightMap, point) {
  const encoded = texture(heightMap, heightMapUv(point)).r;
  return encoded.mul(HEIGHT_BOUNDS.heightSpan).add(HEIGHT_BOUNDS.minHeight);
}

function wavePhase(point, wave, timeNode) {
  return point.x.mul(wave.x)
    .add(point.z.mul(wave.z))
    .mul(wave.frequency)
    .add(timeNode.mul(wave.speed));
}

function shoreEnvelope(point) {
  return smoothstep(float(3.5), float(22), point.z);
}

function sampleWaves(point, timeNode) {
  const envelope = shoreEnvelope(point);
  let height = float(0);
  let derivativeX = float(0);
  let derivativeZ = float(0);
  let chopX = float(0);
  let chopZ = float(0);
  for (const wave of WAVES) {
    const phase = wavePhase(point, wave, timeNode);
    const waveSin = sin(phase);
    const waveCos = cos(phase);
    const amplitude = envelope.mul(wave.amplitude);
    height = height.add(waveSin.mul(amplitude));
    derivativeX = derivativeX.add(waveCos.mul(amplitude).mul(wave.frequency * wave.x));
    derivativeZ = derivativeZ.add(waveCos.mul(amplitude).mul(wave.frequency * wave.z));
    chopX = chopX.add(waveCos.mul(amplitude).mul(wave.chop * wave.x));
    chopZ = chopZ.add(waveCos.mul(amplitude).mul(wave.chop * wave.z));
  }
  return { height, derivativeX, derivativeZ, chopX, chopZ, envelope };
}

function shoreWetness(point, ground, waves) {
  const liveSurface = waterLevel.add(waves.height);
  const wash = smoothstep(float(-0.045), float(0.07), liveSurface.sub(ground));
  const lag = sampleWaves(point, waterTime.sub(2.1));
  const older = sampleWaves(point, waterTime.sub(4.4));
  const lingerHeight = max(lag.height, older.height.mul(0.55));
  const lingerSurface = waterLevel.add(float(0.055)).add(lingerHeight);
  const damp = smoothstep(float(-0.14), float(0.03), lingerSurface.sub(ground));
  return saturate(max(wash, damp.mul(float(1).sub(wash)).mul(0.88)));
}

export function createBeachTerrainMaterial(maps, heightMap) {
  const dryUv = worldUv(0.24);
  const wetUv = worldUv(0.30);
  const pebbleUv = worldUv(0.22);
  const grassUv = worldUv(0.18);
  const point = positionWorld;
  const z = point.z;
  const grassW = float(1).sub(smoothstep(-50, -31, z));
  const pebbleW = smoothstep(-0.5, 8.5, z).mul(float(1).sub(smoothstep(13, 26, z)));
  const ground = sampleGroundHeight(heightMap, point);
  const waves = sampleWaves(point, waterTime);
  const wetness = shoreWetness(point, ground, waves).mul(float(1).sub(grassW));
  const dryAlbedo = texture(maps["dry-sand"].albedo, dryUv).rgb;
  const wetAlbedo = texture(maps["wet-sand"].albedo, wetUv).rgb;
  const pebbleAlbedo = texture(maps["pebble-hash"].albedo, pebbleUv).rgb;
  const grassAlbedo = texture(maps["dune-grass"].albedo, grassUv).rgb;
  const dryNormal = normalMap(texture(maps["dry-sand"].normal, dryUv).rgb, vec2(0.85, 0.85));
  const wetNormal = normalMap(texture(maps["wet-sand"].normal, wetUv).rgb, vec2(1.15, 1.15));
  const pebbleNormal = normalMap(texture(maps["pebble-hash"].normal, pebbleUv).rgb, vec2(1.35, 1.35));
  const grassNormal = normalMap(texture(maps["dune-grass"].normal, grassUv).rgb, vec2(0.7, 0.7));
  let albedo = mix(dryAlbedo, grassAlbedo, grassW);
  albedo = mix(albedo, wetAlbedo.mul(0.82), wetness);
  albedo = mix(albedo, pebbleAlbedo, pebbleW);
  let mappedNormal = mix(dryNormal, grassNormal, grassW);
  mappedNormal = mix(mappedNormal, wetNormal, wetness);
  mappedNormal = mix(mappedNormal, pebbleNormal, pebbleW);
  const roughness = mix(
    mix(float(0.93), float(0.8), grassW),
    float(0.13),
    wetness,
  );
  const pebbleRough = mix(roughness, float(0.46), pebbleW);
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.7,
    color: 0xc4a574,
  });
  material.colorNode = albedo;
  material.normalNode = normalize(mappedNormal);
  material.roughnessNode = pebbleRough;
  return tag(material, 0.28, { terrain: true });
}

export function createWaterMaterial(heightMap) {
  const point = positionWorld;
  const waves = sampleWaves(point, waterTime);
  const ground = sampleGroundHeight(heightMap, point);
  const depth = waterLevel.add(waves.height).sub(ground);
  const optical = smoothstep(float(0.04), float(2.6), depth);
  const coverage = smoothstep(float(-0.03), float(0.045), depth);
  const foamNoise = mx_fractal_noise_float(point.mul(vec3(0.19, 0.04, 0.17)), 3, 2.07, 0.5).mul(0.5).add(0.5);
  const shoreFoam = saturate(float(1).sub(smoothstep(float(5), float(13.5), point.z)))
    .mul(smoothstep(float(2.2), float(7.5), point.z))
    .mul(mix(float(0.35), float(1), foamNoise));
  const peakFoam = saturate(waves.height.mul(2.8).add(foamNoise.mul(0.22)));
  const foam = saturate(shoreFoam.add(peakFoam.mul(waves.envelope).mul(0.35))).mul(coverage);
  const deep = vec3(0.012, 0.07, 0.12);
  const shallow = vec3(0.08, 0.32, 0.34);
  const waterColor = mix(shallow, deep, optical);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const waterNormal = normalize(vec3(waves.derivativeX.negate(), float(1), waves.derivativeZ.negate()));
  const fresnel = pow(saturate(float(1).sub(abs(dot(waterNormal, viewDirection)))), 5);
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.08,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    color: 0x0c3d4a,
    fog: true,
  });
  material.envMapIntensity = 0;
  material.positionNode = positionLocal.add(vec3(waves.chopX, waves.height, waves.chopZ));
  material.colorNode = mix(waterColor, vec3(0.86, 0.91, 0.93), foam.mul(0.82));
  material.normalNode = waterNormal;
  material.roughnessNode = mix(float(0.06), float(0.32), foam);
  material.opacityNode = saturate(
    mix(float(0.12), float(0.8), optical).add(fresnel.mul(0.18)),
  ).mul(coverage);
  return tag(material, 0, { water: true, rtxIgnore: true });
}

export function createSkyMaterial() {
  const zenith = vec3(0.23, 0.52, 0.86);
  const horizon = vec3(0.78, 0.86, 0.94);
  const sunBloom = vec3(1.0, 0.78, 0.48);
  const dir = normalize(positionLocal);
  const elevation = saturate(dir.y.mul(0.5).add(0.5));
  const sunDir = normalize(vec3(-0.42, 0.46, 0.78));
  const sun = pow(saturate(dot(dir, sunDir)), 48);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    depthTest: false,
  });
  material.toneMapped = false;
  material.colorNode = mix(horizon, zenith, pow(elevation, 1.35)).add(sunBloom.mul(sun.mul(1.6)));
  material.userData.rtxIgnore = true;
  return material;
}

export function createFrondMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x2f6a38,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const noise = mx_noise_float(positionWorld.mul(2.4)).mul(0.5).add(0.5);
  material.colorNode = mix(vec3(0.14, 0.32, 0.16), vec3(0.27, 0.48, 0.18), noise);
  return tag(material, 0.04, { rtxIgnore: true });
}

