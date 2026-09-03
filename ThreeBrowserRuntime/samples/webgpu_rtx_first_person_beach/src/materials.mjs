import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraPosition,
  cameraViewMatrix,
  cos,
  dot,
  float,
  floor,
  fwidth,
  length,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalMap,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { HEIGHT_BOUNDS, WATER_LEVEL } from "./terrain.mjs";
import { cloudShadowNode } from "./weather.mjs";
export const waterTime = uniform(0);
export const waterLevel = uniform(WATER_LEVEL);
export const skySunDirection = uniform(new THREE.Vector3(-0.42, 0.46, 0.78).normalize());
export const skyMoonDirection = uniform(new THREE.Vector3(0.42, -0.2, -0.78).normalize());
export const skyZenith = uniform(new THREE.Vector3(0.23, 0.52, 0.86));
export const skyHorizon = uniform(new THREE.Vector3(0.78, 0.86, 0.94));
export const skySunColor = uniform(new THREE.Vector3(1.0, 0.78, 0.48));
export const skyMoonColor = uniform(new THREE.Vector3(0.72, 0.8, 0.92));
export const skyNight = uniform(0);
export const skySunGlow = uniform(1);
export const celestialLightDir = uniform(new THREE.Vector3(-0.42, 0.55, 0.72).normalize());
export const moonShadeDir = uniform(new THREE.Vector3(-0.42, 0.55, 0.72).normalize());
export const TILE_NAMES = Object.freeze([
  "dry-sand",
  "wet-sand",
  "pebble-hash",
  "coastal-rock",
  "dune-grass",
  "palm-bark",
  "palm-leaf",
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

export async function loadMoonMaps() {
  return loadTileMaps("lunar-surface");
}

export function createMoonMaterial(maps) {
  const albedo = texture(maps.albedo);
  const crater = texture(maps.normal).rgb.sub(0.5).mul(2);
  const n = normalize(normalWorld.add(crater.mul(0.22)));
  const lit = saturate(dot(n, normalize(moonShadeDir)));
  const wrap = lit.mul(0.55).add(0.45);
  const shade = wrap.mul(1.15).add(0.22);
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: true,
    depthWrite: true,
    fog: false,
    side: THREE.FrontSide,
  });
  material.toneMapped = false;
  const pale = mix(albedo.rgb, vec3(0.92, 0.93, 0.9), 0.55);
  material.colorNode = pale.mul(shade);
  material.userData.rtxIgnore = true;
  return material;
}

function worldUv(repeat) {
  return positionWorld.xz.mul(vec2(repeat, repeat));
}

function applyCloudShadow(baseColor, point = positionWorld, strength = 1) {
  const shadow = cloudShadowNode(point).mul(strength);
  const coolShade = vec3(0.52, 0.61, 0.72);
  return baseColor.mul(mix(vec3(1), coolShade, shadow));
}

function noise01(point, scale, seed) {
  return mx_fractal_noise_float(
    point.add(vec3(seed * 13.17, seed * 0.4, seed * -8.03)).mul(vec3(scale, scale * 0.18, scale * 0.94)),
    4,
    2.07,
    0.51,
  ).mul(0.5).add(0.5);
}

function rotateUv(uv, angle) {
  const c = cos(angle);
  const s = sin(angle);
  const p = uv.sub(vec2(0.5));
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c))).add(vec2(0.5));
}

function hashedSpin(point, cells, seed) {
  const cell = floor(point.xz.mul(cells));
  const h1 = mx_noise_float(vec3(cell.x.add(seed * 2.13), seed * 0.37, cell.y.add(seed * 5.71)));
  const h2 = mx_noise_float(vec3(cell.x.add(8.4 + seed), seed * 1.9, cell.y.add(3.2)));
  return h1.mul(3.883).add(h2.mul(2.399));
}

function stochasticUv(baseUv, point, cells, seed) {
  const cell = floor(point.xz.mul(cells));
  const h1 = mx_noise_float(vec3(cell.x, seed, cell.y));
  const h2 = mx_noise_float(vec3(cell.x.add(4.7 + seed), seed + 2.2, cell.y.add(9.1)));
  const angle = hashedSpin(point, cells, seed);
  const scale = mix(float(0.78), float(1.24), h2.mul(0.5).add(0.5));
  const skew = vec2(cos(angle.mul(0.35)), sin(angle.mul(0.51))).mul(0.08);
  return rotateUv(baseUv.mul(scale).add(skew), angle).add(vec2(h1, h2).mul(0.33));
}

function terrainVariation(point) {
  const patch = noise01(point, 0.021, 1);
  const blotch = noise01(point, 0.062, 3);
  const grain = noise01(point, 0.21, 6);
  const warp = point.x.mul(0.071).add(point.z.mul(0.053));
  const diagonal = mx_noise_float(vec3(
    warp.mul(cos(float(1.17))),
    0.4,
    point.z.mul(0.067).add(point.x.mul(sin(float(0.83)))),
  )).mul(0.5).add(0.5);
  const blend = smoothstep(0.28, 0.72, blotch.mul(0.55).add(diagonal.mul(0.45)));
  const blur = smoothstep(0.38, 0.9, noise01(point, 0.024, 8).mul(0.65).add(diagonal.mul(0.35)));
  const darken = mix(float(0.74), float(1.07), patch.mul(0.7).add(grain.mul(0.3)));
  return { patch, blotch, grain, blend, blur, darken };
}

function sampleVariedRgb(map, baseUv, point, variation, cells = 0.086) {
  const uvA = stochasticUv(baseUv, point, cells, 1.0);
  const uvB = stochasticUv(baseUv, point.add(vec3(7.2, 0, -5.8)), cells * 0.83, 4.6);
  const uvC = stochasticUv(baseUv.mul(0.91), point.add(vec3(-4.1, 0, 9.3)), cells * 1.17, 8.2);
  const a = texture(map, uvA).rgb;
  const b = texture(map, uvB).rgb;
  const c = texture(map, uvC).rgb;
  const soft = texture(map, rotateUv(baseUv.mul(0.37), variation.patch.mul(2.2)).add(vec2(0.13, 0.21))).rgb;
  const ab = mix(a, b, variation.blend);
  const abc = mix(ab, c, variation.blotch.mul(0.55));
  return mix(abc, mix(abc, soft, 0.5), variation.blur);
}

function sampleVariedNormal(map, baseUv, point, variation, strength, cells = 0.086) {
  const uvA = stochasticUv(baseUv, point, cells, 1.0);
  const uvB = stochasticUv(baseUv, point.add(vec3(7.2, 0, -5.8)), cells * 0.83, 4.6);
  const uvC = stochasticUv(baseUv.mul(0.91), point.add(vec3(-4.1, 0, 9.3)), cells * 1.17, 8.2);
  const nA = normalMap(texture(map, uvA).rgb, vec2(strength, strength));
  const nB = normalMap(texture(map, uvB).rgb, vec2(strength, strength));
  const nC = normalMap(texture(map, uvC).rgb, vec2(strength, strength));
  const nSoft = normalMap(
    texture(map, rotateUv(baseUv.mul(0.37), variation.patch.mul(2.2)).add(vec2(0.13, 0.21))).rgb,
    vec2(strength * 0.4, strength * 0.4),
  );
  const ab = normalize(mix(nA, nB, variation.blend));
  const abc = normalize(mix(ab, nC, variation.blotch.mul(0.55)));
  const blurred = normalize(mix(abc, nSoft, variation.blur.mul(0.48)));
  const macro = bumpMap(
    variation.patch.mul(0.16).add(variation.blotch.mul(0.07)),
    0.48,
  );
  return normalize(mix(blurred, macro, 0.2));
}

export function createMappedMaterial(maps, options = {}) {
  const repeat = options.repeat ?? 0.28;
  const uvScale = options.uvScale ?? [repeat, repeat];
  const uvNode = options.objectUv ? uv().mul(vec2(uvScale[0], uvScale[1])) : worldUv(repeat);
  const albedoSample = texture(maps.albedo, uvNode);
  const heightSample = texture(maps.heightMap, uvNode).r;
  const mappedNormal = normalMap(
    texture(maps.normal, uvNode).rgb,
    vec2(options.normalScale ?? 1, options.normalScale ?? 1),
  );
  const tintNode = Array.isArray(options.tint) ? vec3(...options.tint) : options.tint ?? vec3(1, 1, 1);
  const colorNode = applyCloudShadow(albedoSample.rgb.mul(tintNode), positionWorld, 0.48);
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
  let velX = float(0);
  let velZ = float(0);
  let horizontalXX = float(0);
  let horizontalXZ = float(0);
  let horizontalZZ = float(0);
  let divergence = float(0);
  let curvature = float(0);
  let front = float(0);
  for (const wave of WAVES) {
    const phase = wavePhase(point, wave, timeNode);
    const waveSin = sin(phase);
    const waveCos = cos(phase);
    const amplitude = envelope.mul(wave.amplitude);
    const k = wave.frequency;
    const omega = wave.speed;
    height = height.add(waveSin.mul(amplitude));
    derivativeX = derivativeX.add(waveCos.mul(amplitude).mul(k * wave.x));
    derivativeZ = derivativeZ.add(waveCos.mul(amplitude).mul(k * wave.z));
    chopX = chopX.add(waveCos.mul(amplitude).mul(wave.chop * wave.x));
    chopZ = chopZ.add(waveCos.mul(amplitude).mul(wave.chop * wave.z));
    velX = velX.add(waveSin.mul(amplitude).mul(-wave.chop * omega * wave.x));
    velZ = velZ.add(waveSin.mul(amplitude).mul(-wave.chop * omega * wave.z));
    const compression = waveSin.mul(amplitude).mul(wave.chop * k);
    horizontalXX = horizontalXX.add(compression.mul(wave.x * wave.x));
    horizontalXZ = horizontalXZ.add(compression.mul(wave.x * wave.z));
    horizontalZZ = horizontalZZ.add(compression.mul(wave.z * wave.z));
    divergence = divergence.add(waveCos.mul(amplitude).mul(-wave.chop * omega * k));
    curvature = curvature.add(waveSin.mul(amplitude).mul(-k * k));
    const travelSign = Math.sign(omega) || 1;
    front = front.add(max(waveCos.mul(travelSign), float(0)).mul(amplitude).mul(k));
  }
  const jacobianXX = float(1).sub(horizontalXX);
  const jacobianXZ = horizontalXZ.negate();
  const jacobianZZ = float(1).sub(horizontalZZ);
  const eigenGap = jacobianXX.sub(jacobianZZ).mul(jacobianXX.sub(jacobianZZ))
    .add(jacobianXZ.mul(jacobianXZ).mul(4)).sqrt();
  const minimumStretch = jacobianXX.add(jacobianZZ).sub(eigenGap).mul(0.5);
  const foldingStrain = float(1).sub(minimumStretch).max(0);
  const slope = length(vec2(derivativeX, derivativeZ));
  return {
    height,
    derivativeX,
    derivativeZ,
    chopX,
    chopZ,
    envelope,
    velX,
    velZ,
    divergence,
    curvature,
    foldingStrain,
    slope,
    front,
  };
}

function streamCurl(point, scale, speed, strength, epsilon) {
  const psi = (px, pz) => mx_noise_float(vec3(
    px.mul(scale),
    waterTime.mul(speed),
    pz.mul(scale * 0.83),
  ));
  const eps = float(epsilon);
  const dpsidz = psi(point.x, point.z.add(eps)).sub(psi(point.x, point.z.sub(eps)));
  const dpsidx = psi(point.x.add(eps), point.z).sub(psi(point.x.sub(eps), point.z));
  const inv = float(strength / (2 * epsilon));
  return vec2(dpsidz.mul(inv), dpsidx.negate().mul(inv));
}

export function foamVelocityNode(point) {
  const waves = sampleWaves(point, waterTime);
  const particle = vec2(waves.velX, waves.velZ);
  const curl = streamCurl(point, 0.046, 0.031, 0.36, 0.7)
    .add(streamCurl(point, 0.11, 0.054, 0.2, 0.4));
  const residual = vec2(0.02, -0.18).mul(waves.envelope);
  return particle.add(curl).add(residual);
}

function crestFrame(point) {
  const along = point.x.mul(0.94).add(point.z.mul(0.34));
  const across = point.x.mul(-0.34).add(point.z.mul(0.94));
  return { along, across };
}

export function foamSourceFromWaves(point, waves, ground = null) {
  const depth = ground
    ? waterLevel.add(waves.height).sub(ground)
    : waves.envelope.mul(2.2);
  const surf = smoothstep(float(0.05), float(0.4), depth)
    .mul(float(1).sub(smoothstep(float(1.05), float(2.75), depth)));
  const shoal = float(1).add(surf.mul(0.55));
  const foldSignal = smoothstep(0.02, 0.056, waves.foldingStrain.mul(shoal));
  const steepSignal = smoothstep(0.048, 0.135, waves.slope.mul(shoal));
  const compressSignal = smoothstep(0.008, 0.042, waves.divergence.negate().mul(shoal));
  const frontSignal = smoothstep(0.014, 0.08, waves.front.mul(shoal));
  const crestSignal = smoothstep(0.012, 0.052, waves.curvature.negate().mul(shoal));
  const breaker = foldSignal.mul(mix(float(0.28), float(1), frontSignal))
    .add(steepSignal.mul(frontSignal).mul(0.7))
    .add(compressSignal.mul(frontSignal).mul(0.38))
    .add(crestSignal.mul(frontSignal).mul(foldSignal).mul(0.45));
  const { along, across } = crestFrame(point);
  const warp = mx_fractal_noise_float(
    vec3(along.mul(0.062), waterTime.mul(0.016), across.mul(0.17))
      .add(vec3(2.1, 0.4, -1.6)),
    3,
    2.05,
    0.52,
  );
  const patch = mx_fractal_noise_float(
    vec3(
      along.mul(0.14).add(warp.mul(0.7)),
      0.22,
      across.mul(0.042).add(warp.mul(-0.5)),
    ).add(vec3(waterTime.mul(0.017), 0, waterTime.mul(-0.009))),
    3,
    2.07,
    0.5,
  ).mul(0.5).add(0.5);
  const gaps = mx_noise_float(vec3(
    along.mul(0.23).add(warp.mul(0.42)),
    1.8,
    across.mul(0.055).add(waterTime.mul(-0.008)),
  ));
  const fatness = mix(
    float(0.42),
    float(1.45),
    mx_noise_float(vec3(along.mul(0.028), 2.4, across.mul(0.08))).mul(0.5).add(0.5),
  );
  const chunk = smoothstep(0.4, 0.74, patch).mul(smoothstep(-0.08, 0.38, gaps));
  const speckle = smoothstep(0.64, 0.9, patch);
  const entrainment = chunk.mul(0.84).add(speckle.mul(0.38)).saturate();
  const coverage = min(waves.envelope.mul(0.8).add(surf.mul(0.38)), float(1));
  return max(
    breaker.mul(entrainment).mul(fatness).mul(coverage).mul(2.45),
    float(0),
  );
}

export function breakingInjectionNode(point, heightMap = null) {
  const waves = sampleWaves(point, waterTime);
  const ground = heightMap ? sampleGroundHeight(heightMap, point) : null;
  return foamSourceFromWaves(point, waves, ground);
}

function foamLaceNode(mass, age, parcel, live) {
  const warpA = mx_noise_float(vec3(parcel.x.mul(0.052), 0.4, parcel.y.mul(0.047))).mul(0.9);
  const warpB = mx_noise_float(vec3(parcel.y.mul(0.108), 1.6, parcel.x.mul(0.09))).mul(0.38);
  const warped = parcel.add(vec2(warpA, warpA.mul(-0.64).add(warpB)));
  const large = mx_worley_noise_vec2(warped.mul(vec2(0.108, 0.128)), 0.94);
  const medium = mx_worley_noise_vec2(
    warped.mul(vec2(0.27, 0.232)).add(vec2(12.2, -7.4)),
    0.9,
  );
  const small = mx_worley_noise_vec2(
    warped.mul(vec2(0.66, 0.74)).add(vec2(-3.8, 19.1)),
    0.86,
  );
  const ridgeL = saturate(large.y.sub(large.x).mul(3.5));
  const ridgeM = saturate(medium.y.sub(medium.x).mul(3.9));
  const ridgeS = saturate(small.y.sub(small.x).mul(4.3));
  const holeL = smoothstep(0.14, 0.46, large.x);
  const holeM = smoothstep(0.1, 0.38, medium.x);
  const grit = mx_fractal_noise_float(
    vec3(warped.x.mul(1.62), 10.4, warped.y.mul(1.48)),
    3,
    2.11,
    0.48,
  ).mul(0.5).add(0.5);
  const tendrils = saturate(
    float(1).sub(abs(mx_noise_float(vec3(warped.x.mul(0.84), 6.1, warped.y.mul(1.05)))).mul(1.85)),
  );
  const branch = saturate(
    float(1).sub(abs(mx_noise_float(vec3(warped.y.mul(0.66), 8.8, warped.x.mul(0.9)))).mul(2.2)),
  );
  const young = float(1).sub(smoothstep(0.0, 0.18, age));
  const expanding = smoothstep(0.04, 0.2, age).mul(float(1).sub(smoothstep(0.28, 0.48, age)));
  const cellular = smoothstep(0.14, 0.34, age).mul(float(1).sub(smoothstep(0.5, 0.72, age)));
  const filament = smoothstep(0.38, 0.58, age).mul(float(1).sub(smoothstep(0.74, 0.92, age)));
  const remnant = smoothstep(0.66, 0.86, age);
  const whitewater = mix(ridgeS, float(1), 0.32)
    .mul(mix(float(0.62), float(1), grit))
    .mul(float(1).sub(holeM.mul(0.18)));
  const expanded = mix(ridgeL, float(1).sub(holeL), 0.55)
    .mul(mix(ridgeM, float(1), 0.22))
    .mul(mix(float(0.4), float(1), ridgeS));
  const laceNet = ridgeL.mul(0.46).add(ridgeM.mul(0.54))
    .mul(float(1).sub(holeL.mul(0.62)))
    .mul(mix(float(0.22), float(1), ridgeS))
    .mul(mix(float(0.4), float(1), tendrils));
  const fil = ridgeM.mul(tendrils).mul(branch.add(ridgeS).mul(0.68))
    .add(ridgeS.mul(tendrils).mul(0.52));
  const rem = smoothstep(0.28, 0.72, ridgeM.mul(tendrils).add(ridgeS.mul(0.28)));
  const structure = whitewater.mul(young)
    .add(expanded.mul(expanding))
    .add(laceNet.mul(cellular))
    .add(fil.mul(filament))
    .add(rem.mul(remnant));
  const tip = smoothstep(0.38, 0.82, live);
  const jagged = mix(float(1), mix(float(0.18), float(1.2), grit), tip.mul(young.add(0.15)));
  const filled = mix(
    structure.mul(jagged),
    mix(structure, float(1), 0.28).mul(jagged),
    young.mul(tip).mul(smoothstep(0.35, 0.9, mass)),
  );
  const coverage = saturate(mass.mul(mix(float(1.12), float(0.48), age)).add(tip.mul(0.5)));
  const optical = saturate(coverage.mul(filled));
  const footprint = fwidth(parcel.x).max(fwidth(parcel.y));
  return mix(
    saturate(mass.mul(0.52).add(tip.mul(0.22))),
    optical,
    float(1).sub(smoothstep(0.08, 0.62, footprint)),
  );
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
  const variation = terrainVariation(point);
  const dryAlbedo = sampleVariedRgb(maps["dry-sand"].albedo, dryUv, point, variation);
  const wetAlbedo = sampleVariedRgb(maps["wet-sand"].albedo, wetUv, point, variation);
  const pebbleAlbedo = sampleVariedRgb(maps["pebble-hash"].albedo, pebbleUv, point, variation, 0.15);
  const grassAlbedo = sampleVariedRgb(maps["dune-grass"].albedo, grassUv, point, variation);
  const dryNormal = sampleVariedNormal(maps["dry-sand"].normal, dryUv, point, variation, 0.85);
  const wetNormal = sampleVariedNormal(maps["wet-sand"].normal, wetUv, point, variation, 1.15);
  const pebbleNormal = sampleVariedNormal(maps["pebble-hash"].normal, pebbleUv, point, variation, 1.35, 0.15);
  const grassNormal = sampleVariedNormal(maps["dune-grass"].normal, grassUv, point, variation, 0.7);
  let albedo = mix(dryAlbedo, grassAlbedo, grassW);
  albedo = mix(albedo, wetAlbedo.mul(0.82), wetness);
  albedo = mix(albedo, pebbleAlbedo, pebbleW);
  albedo = albedo.mul(variation.darken);
  let mappedNormal = mix(dryNormal, grassNormal, grassW);
  mappedNormal = mix(mappedNormal, wetNormal, wetness);
  mappedNormal = mix(mappedNormal, pebbleNormal, pebbleW);
  const roughness = mix(
    mix(float(0.93), float(0.8), grassW),
    float(0.13),
    wetness,
  );
  const pebbleRough = mix(
    mix(roughness, roughness.add(0.07), float(1).sub(variation.patch)),
    float(0.46),
    pebbleW,
  );
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.7,
    color: 0xc4a574,
  });
  material.colorNode = applyCloudShadow(albedo, point, 0.56);
  material.normalNode = normalize(mappedNormal);
  material.roughnessNode = pebbleRough;
  return tag(material, 0.28, { terrain: true });
}

export function createWaterMaterial(heightMap, persistentFoamSample = null, options = {}) {
  const point = positionWorld;
  const waves = sampleWaves(point, waterTime);
  const ground = sampleGroundHeight(heightMap, point);
  const localPool = options.localPool === true;
  const waveScale = float(localPool ? 0.055 : 1);
  const depth = localPool
    ? float(options.depth ?? 0.12)
    : waterLevel.add(waves.height).sub(ground);
  const optical = smoothstep(float(0.04), float(2.6), depth);
  const coverage = localPool ? float(1) : smoothstep(float(-0.03), float(0.045), depth);
  const live = localPool ? float(0) : foamSourceFromWaves(point, waves, ground);
  const field = typeof persistentFoamSample === "function"
    ? persistentFoamSample(point)
    : vec4(live, float(0), point.x, point.z);
  const mass = field.x;
  const age = field.y;
  const parcel = field.zw;
  const rimX = smoothstep(float(HEIGHT_BOUNDS.maxX - 24), float(HEIGHT_BOUNDS.maxX - 5), abs(point.x));
  const rimFar = smoothstep(float(HEIGHT_BOUNDS.maxZ - 32), float(HEIGHT_BOUNDS.maxZ - 6), point.z);
  const rimNear = float(1).sub(smoothstep(float(HEIGHT_BOUNDS.minZ + 10), float(HEIGHT_BOUNDS.minZ + 28), point.z));
  const planeFade = localPool ? float(1) : float(1).sub(max(rimX, max(rimFar, rimNear)));
  const foam = foamLaceNode(mass, age, parcel, live).mul(coverage).mul(planeFade);
  const deep = vec3(0.012, 0.07, 0.12);
  const shallow = vec3(0.08, 0.32, 0.34);
  const waterColor = mix(shallow, deep, optical);
  const young = float(1).sub(smoothstep(0.0, 0.28, age));
  const foamColor = mix(
    vec3(0.7, 0.81, 0.86),
    vec3(0.93, 0.95, 0.97),
    saturate(young.mul(0.75).add(live.mul(0.45))),
  );
  // Gerstner derivatives are evaluated from positionWorld, so this normal is
  // world-space. NodeMaterial.normalNode and bumpMap() both operate in view
  // space; transform it before combining the two or the normal will appear to
  // rotate with the camera.
  const waterNormalView = normalize(
    vec3(
      waves.derivativeX.mul(waveScale).negate(),
      float(1),
      waves.derivativeZ.mul(waveScale).negate(),
    )
      .transformDirection(cameraViewMatrix),
  );
  const foamBump = bumpMap(
    foam.mul(0.42).add(live.mul(0.22)).add(young.mul(mass).mul(0.12)),
    mix(0.22, 0.85, saturate(live.add(young.mul(0.6)))),
  );
  const shadedNormalView = normalize(
    mix(waterNormalView, foamBump, saturate(foam.mul(0.7).add(live.mul(0.2)))),
  );
  // normalWorld resolves the material's final view-space normal back into
  // world space. Keep the hand-authored sun lobe entirely in world space so
  // camera yaw cannot rotate the highlight across the water surface.
  const toSun = normalize(celestialLightDir);
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const sunSpec = pow(
    saturate(dot(normalWorld, normalize(toSun.add(viewDir)))),
    72,
  )
    .mul(float(1).sub(foam.mul(0.65)))
    .mul(skySunGlow.add(skyNight.mul(0.2)))
    .mul(0.42);
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.22,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    color: 0x0c3d4a,
    fog: true,
  });
  material.envMapIntensity = 0;
  material.positionNode = positionLocal.add(vec3(
    waves.chopX.mul(waveScale),
    waves.height.mul(waveScale),
    waves.chopZ.mul(waveScale),
  ));
  material.colorNode = applyCloudShadow(mix(waterColor, foamColor, foam), point, 0.34);
  material.emissiveNode = vec3(1, 0.9, 0.72).mul(sunSpec);
  material.normalNode = shadedNormalView;
  material.roughnessNode = mix(float(0.18), mix(float(0.32), float(0.48), young), foam);
  material.opacityNode = saturate(
    mix(float(0.2), float(0.84), optical).add(foam.mul(0.4)),
  ).mul(coverage).mul(planeFade);
  return tag(material, 0, { water: true, rtxIgnore: true });
}

export function syncSkyUniforms(sample) {
  skySunDirection.value.set(sample.sun.x, sample.sun.y, sample.sun.z);
  skyMoonDirection.value.set(sample.moon.x, sample.moon.y, sample.moon.z);
  skyZenith.value.set(sample.zenith[0], sample.zenith[1], sample.zenith[2]);
  skyHorizon.value.set(sample.horizon[0], sample.horizon[1], sample.horizon[2]);
  skySunColor.value.set(sample.sun.color[0], sample.sun.color[1], sample.sun.color[2]);
  skyMoonColor.value.set(sample.moon.color[0], sample.moon.color[1], sample.moon.color[2]);
  skyNight.value = sample.night;
  skySunGlow.value = sample.sun.intensity > 0.05 ? Math.min(1, sample.sun.intensity / 3.2) : 0;
  if (sample.keyIsSun) {
    celestialLightDir.value.set(sample.sun.x, sample.sun.y, sample.sun.z);
  } else {
    celestialLightDir.value.set(sample.moon.x, sample.moon.y, sample.moon.z);
  }
  moonShadeDir.value.set(sample.sun.x, sample.sun.y, sample.sun.z);
}

export function createSkyMaterial() {
  const dir = normalize(positionLocal);
  const elevation = saturate(dir.y.mul(0.5).add(0.5));
  const sunDot = saturate(dot(dir, normalize(skySunDirection)));
  const sunCore = pow(sunDot, mix(float(28), float(220), saturate(skySunDirection.y)));
  const sunHalo = pow(sunDot, 8).mul(0.18);
  const scatter = pow(saturate(float(1).sub(abs(dir.y))), 3)
    .mul(skySunGlow)
    .mul(0.22);
  const dither = mx_noise_float(dir.mul(1600)).mul(0.0035);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    depthTest: false,
  });
  material.toneMapped = false;
  material.colorNode = mix(skyHorizon, skyZenith, pow(elevation, 1.2))
    .add(skySunColor.mul(sunCore.add(sunHalo).mul(skySunGlow.mul(1.7))))
    .add(skySunColor.mul(scatter))
    .add(dither);
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
