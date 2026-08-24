import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraPosition,
  color,
  cos,
  dot,
  float,
  fract,
  max,
  mix,
  mx_fractal_noise_float,
  normalMap,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflector,
  saturate,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import {
  disposeProceduralTextureCache,
  getProceduralTextureSet,
  getProceduralTextureStats,
} from "./procedural-textures.mjs";

export {
  disposeProceduralTextureCache as disposeDistrictProceduralTextures,
  getProceduralTextureStats as getDistrictProceduralTextureStats,
};

export const palette = Object.freeze({
  night: 0x01040a,
  storm: 0x07101a,
  asphalt: 0x080b10,
  asphaltLift: 0x161b21,
  concrete: 0x25282c,
  blueConcrete: 0x18242c,
  steel: 0x48535c,
  rain: 0x9bc9df,
  cyan: 0x39e7ff,
  blue: 0x3a72ff,
  magenta: 0xff2ebc,
  red: 0xff365c,
  amber: 0xffa43b,
  warm: 0xffd2a0,
  jade: 0x38f0b3,
});

export const districtClock = uniform(0);
export const rasterReflectionStrength = uniform(1);

function tag(material, reflectionMask = 0) {
  material.rtxReflectionMask = reflectionMask;
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  return material;
}

function viewFresnel(powerValue = 5) {
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  return pow(
    saturate(float(1).sub(abs(dot(normalWorld, viewDirection)))),
    powerValue,
  );
}

function asphaltField() {
  const broad = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.17, 0.05, 0.21)),
    4,
    2.03,
    0.53,
  ).mul(0.5).add(0.5);
  const aggregate = mx_fractal_noise_float(
    positionWorld.add(vec3(11.3, 0, -7.9)).mul(vec3(1.72, 0.16, 1.94)),
    3,
    2.11,
    0.48,
  ).mul(0.5).add(0.5);
  const patched = mx_fractal_noise_float(
    positionWorld.add(vec3(-21.4, 0, 18.2)).mul(vec3(0.065, 0.02, 0.083)),
    3,
    2.0,
    0.56,
  ).mul(0.5).add(0.5);
  const wheelRut = pow(
    saturate(float(1).sub(abs(sin(positionWorld.x.mul(0.73))).mul(1.7))),
    3,
  );
  // Most exposed aggregate remains rain-darkened but microscopically rough.
  // Connected high-noise patches and the wheel ruts carry the standing film;
  // this prevents the native roughness cutoff from selecting the whole road.
  const moisture = broad.mul(0.44)
    .add(aggregate.mul(0.16))
    .add(patched.mul(0.18))
    .add(wheelRut.mul(0.26));
  const wetness = smoothstep(0.47, 0.76, moisture);
  return { broad, aggregate, patched, wheelRut, wetness };
}

/**
 * One authored planar capture is the non-RTX fallback for the whole avenue.
 * Its contribution is spatially masked by puddles, patched asphalt and wheel
 * ruts, so the road never reads as a uniformly polished mirror.
 */
export function createWetAsphaltMaterial() {
  const maps = getProceduralTextureSet("asphalt");
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  const mappedNormal = normalMap(texture(maps.normal).rgb, vec2(0.42, 0.42));
  const reflection = reflector({
    resolutionScale: 0.62,
    generateMipmaps: true,
    bounces: false,
    samples: 1,
  });

  const field = asphaltField();
  const wetReflection = smoothstep(0.12, 0.90, field.wetness);
  // Wet aggregate is still glossy, but it is not a sheet of polished glass.
  // Read a blurrier mip over drier aggregate and retain a little more detail
  // only in the connected wet patches and wheel ruts.
  reflection.levelNode = mix(float(1.7), float(0.86), wetReflection);
  const ripple = sin(
    positionWorld.x.mul(2.41)
      .add(positionWorld.z.mul(1.73))
      .sub(districtClock.mul(3.5))
      .add(field.aggregate.mul(6.2)),
  ).mul(field.wetness).mul(0.0045);
  const microNormal = bumpMap(
    field.broad.mul(0.07)
      .add(field.aggregate.mul(0.024))
      .add(field.patched.mul(0.018))
      .add(ripple),
    0.14,
  );
  // Both perturbations resolve to view-space normals. A restrained blend adds
  // texel-scale aggregate without replacing the authored world-space field.
  const combinedNormal = normalize(mix(microNormal, mappedNormal, float(0.34)));
  reflection.uvNode = reflection.uvNode.add(vec2(
    field.aggregate.sub(0.5),
    field.broad.sub(0.5),
  ).mul(0.00155));

  const base = mix(
    color(0x0c0e11),
    color(0x24272a),
    field.aggregate.mul(0.31).add(field.patched.mul(0.14)),
  );
  const texturedBase = base.mul(mix(vec3(1), mappedAlbedo, float(0.34)));
  // Keep the guide continuous across the macro road. A high native cutoff can
  // then let perceptual roughness soften dry aggregate instead of revealing a
  // binary trace boundary. Wheel ruts still form long glossy highlight paths.
  const roughnessNode = mix(float(0.64), float(0.22), field.wetness)
    .add(field.aggregate.sub(0.5).mul(0.055))
    .add(field.patched.sub(0.5).mul(0.03))
    .add(mappedRoughness.sub(0.59).mul(0.15))
    .clamp(0.19, 0.69);
  const reflectionWeight = wetReflection.mul(0.38)
    .add(wetReflection.mul(viewFresnel(4)).mul(0.13))
    .mul(rasterReflectionStrength);
  const reflectionLuma = dot(reflection.rgb, vec3(0.2126, 0.7152, 0.0722));
  const restrainedReflection = mix(vec3(reflectionLuma), reflection.rgb, float(0.46))
    .mul(vec3(0.90, 0.96, 1));

  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Rain-saturated patched asphalt",
    color: palette.asphalt,
    roughness: 0.54,
    metalness: 0.012,
    clearcoat: 0.5,
    clearcoatRoughness: 0.24,
  });
  material.colorNode = texturedBase.mul(mix(float(0.98), float(0.68), wetReflection));
  material.normalNode = combinedNormal;
  material.roughnessNode = roughnessNode;
  material.clearcoatNode = mix(float(0.07), float(0.52), wetReflection);
  material.clearcoatRoughnessNode = mix(float(0.36), float(0.16), wetReflection);
  material.emissiveNode = restrainedReflection.mul(reflectionWeight).mul(0.44);
  material.userData.proceduralTextureSet = maps.kind;
  tag(material, 0.52);

  // The native MRT records only procedural material guides. It must not build
  // or sample the public ReflectorNode while OP84 owns the specular result.
  const nativeMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Native guide — rain-saturated patched asphalt",
    color: palette.asphalt,
    roughness: 0.54,
    metalness: 0.012,
    clearcoat: 0,
    envMapIntensity: 0,
  });
  nativeMaterial.colorNode = material.colorNode;
  nativeMaterial.normalNode = combinedNormal;
  nativeMaterial.roughnessNode = roughnessNode;
  nativeMaterial.userData.proceduralTextureSet = maps.kind;
  tag(nativeMaterial, 0.52);

  return { material, nativeMaterial, reflection };
}

export function createPuddleMaterial(environment = null) {
  const broad = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.55, 0.08, 0.69)),
    3,
    2.05,
    0.51,
  ).mul(0.5).add(0.5);
  const rainRing = sin(
    positionWorld.x.mul(4.1)
      .add(positionWorld.z.mul(3.7))
      .sub(districtClock.mul(4.8))
      .add(broad.mul(8.0)),
  );
  const puddleRoughness = float(0.082)
    .add(broad.mul(0.055))
    .add(abs(rainRing).mul(0.022))
    .clamp(0.08, 0.17);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Thin standing road water",
    color: 0x10171d,
    roughness: 0.115,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    clearcoat: 0.82,
    clearcoatRoughness: 0.085,
    envMap: environment,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  });
  material.normalNode = bumpMap(broad.mul(0.012).add(rainRing.mul(0.0035)), 0.1);
  material.roughnessNode = puddleRoughness;
  return tag(material, 0.58);
}

export function createConcreteMaterial(hex = palette.concrete, roughnessValue = 0.76) {
  const maps = getProceduralTextureSet("concrete");
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  const mappedNormal = normalMap(texture(maps.normal).rgb, vec2(0.38, 0.38));
  const grain = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.44, 0.28, 0.44)),
    4,
    2.06,
    0.52,
  ).mul(0.5).add(0.5);
  const staining = mx_fractal_noise_float(
    positionWorld.add(vec3(13.1, -3.7, 8.6)).mul(vec3(0.11, 0.17, 0.11)),
    3,
    2.02,
    0.55,
  ).mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    roughness: roughnessValue,
    metalness: 0.025,
    clearcoat: 0.12,
    clearcoatRoughness: 0.46,
  });
  material.colorNode = color(hex)
    .mul(grain.mul(0.17).add(0.86))
    .mul(staining.mul(0.12).add(0.91))
    .mul(mix(vec3(1), mappedAlbedo, float(0.42)));
  material.roughnessNode = float(roughnessValue)
    .add(grain.sub(0.5).mul(0.12))
    .add(mappedRoughness.sub(0.73).mul(0.20))
    .clamp(0.18, 1);
  const authoredNormal = bumpMap(grain.mul(0.045).add(staining.mul(0.018)), 0.13);
  material.normalNode = normalize(mix(authoredNormal, mappedNormal, float(0.36)));
  material.userData.proceduralTextureSet = maps.kind;
  // Concrete remains useful secondary-hit geometry and shadow occlusion, but
  // it does not need a costly primary reflection ray across every facade.
  return tag(material, 0);
}

export function createWetPavementMaterial() {
  const broad = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.31, 0.06, 0.31)),
    4,
    2.04,
    0.51,
  ).mul(0.5).add(0.5);
  const seamX = abs(fract(positionWorld.x.mul(0.31)).sub(0.5));
  const seamZ = abs(fract(positionWorld.z.mul(0.31)).sub(0.5));
  const seam = smoothstep(0.472, 0.498, max(seamX, seamZ));
  const wet = smoothstep(0.36, 0.74, broad);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Wet modular pavement",
    color: 0x20252a,
    roughness: 0.31,
    metalness: 0.06,
    clearcoat: 0.84,
    clearcoatRoughness: 0.12,
  });
  material.colorNode = mix(color(0x15191d), color(0x30373d), broad.mul(0.46))
    .mul(mix(float(1), float(0.68), wet))
    .mul(mix(float(1), float(0.56), seam));
  material.roughnessNode = mix(float(0.39), float(0.13), wet)
    .add(seam.mul(0.34));
  material.normalNode = bumpMap(broad.mul(0.05).add(seam.mul(0.035)), 0.15);
  return tag(material, 0.74);
}

export function createMetalMaterial(hex = palette.steel, roughnessValue = 0.28, metalnessValue = 0.92) {
  const maps = getProceduralTextureSet("paintedMetal");
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  const mappedNormal = normalMap(texture(maps.normal).rgb, vec2(0.32, 0.32));
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    roughness: roughnessValue,
    metalness: metalnessValue,
    clearcoat: metalnessValue < 0.55 ? 0.52 : 0,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.8,
  });
  material.colorNode = color(hex).mul(mix(vec3(1), mappedAlbedo, float(0.34)));
  material.roughnessNode = float(roughnessValue)
    .add(mappedRoughness.sub(0.42).mul(0.34))
    .clamp(0.035, 1);
  material.normalNode = mappedNormal;
  material.userData.proceduralTextureSet = maps.kind;
  return tag(material, 0.48 + metalnessValue * 0.48);
}

export function createGlassMaterial(hex = 0x18313e, opacity = 0.24) {
  const maps = getProceduralTextureSet("glassGrime");
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  const mappedNormal = normalMap(texture(maps.normal).rgb, vec2(0.18, 0.18));
  const requestedOpacity = Number.isFinite(Number(opacity)) ? Number(opacity) : 0.24;
  const resolvedOpacity = THREE.MathUtils.clamp(requestedOpacity * 1.12 + 0.1, 0.26, 0.62);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Rain-darkened closed glazing",
    color: hex,
    roughness: 0.145,
    metalness: 0,
    transparent: true,
    opacity: resolvedOpacity,
    // Closed vehicle cabin volumes need their nearest shell to own depth;
    // otherwise all six transparent faces accumulate into a hollow cyan box.
    depthWrite: true,
    clearcoat: 0.58,
    clearcoatRoughness: 0.105,
    side: THREE.FrontSide,
    envMapIntensity: 1.25,
    ior: 1.45,
    specularIntensity: 0.82,
  });
  material.colorNode = color(hex).mul(mix(vec3(1), mappedAlbedo, float(0.28)));
  material.roughnessNode = float(0.085).add(mappedRoughness.mul(0.27)).clamp(0.09, 0.28);
  material.normalNode = mappedNormal;
  material.userData.proceduralTextureSet = maps.kind;
  return tag(material, 0.28);
}

export function createVehiclePaint(hex, environment = null, roughnessValue = 0.12) {
  const maps = getProceduralTextureSet("paintedMetal");
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  const mappedNormal = normalMap(texture(maps.normal).rgb, vec2(0.16, 0.16));
  const requestedRoughness = Number.isFinite(Number(roughnessValue)) ? Number(roughnessValue) : 0.12;
  const resolvedRoughness = THREE.MathUtils.clamp(requestedRoughness * 1.18 + 0.045, 0.16, 0.27);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Dielectric automotive paint under wet clearcoat",
    color: hex,
    roughness: resolvedRoughness,
    // Automotive color is a dielectric pigment layer. A metallic value near
    // one tints every highlight and makes traffic read as molded metal/plastic.
    metalness: 0.06,
    clearcoat: 0.86,
    clearcoatRoughness: Math.max(0.09, resolvedRoughness * 0.56),
    envMap: environment,
    envMapIntensity: 1.35,
    ior: 1.5,
    specularIntensity: 0.9,
  });
  material.colorNode = color(hex).mul(mix(vec3(1), mappedAlbedo, float(0.16)));
  material.roughnessNode = float(resolvedRoughness)
    .add(mappedRoughness.sub(0.42).mul(0.16))
    .clamp(0.11, 0.36);
  material.normalNode = mappedNormal;
  material.userData.proceduralTextureSet = maps.kind;
  return tag(material, 0.58);
}

export function createRubberMaterial() {
  const maps = getProceduralTextureSet("rubber");
  const mappedAlbedo = texture(maps.albedo).rgb;
  const mappedRoughness = texture(maps.roughness).r;
  const mappedNormal = normalMap(texture(maps.normal).rgb, vec2(0.46, 0.46));
  const edgeLift = viewFresnel(2.4).mul(0.72);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Wet readable tire sidewall",
    color: 0x111315,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.62,
  });
  material.colorNode = mix(color(0x090b0c), color(0x292d2f), edgeLift)
    .mul(mix(vec3(1), mappedAlbedo, float(0.48)));
  material.roughnessNode = mix(float(0.68), float(0.46), edgeLift)
    .add(mappedRoughness.sub(0.70).mul(0.30))
    .clamp(0.39, 0.78);
  material.normalNode = mappedNormal;
  material.userData.proceduralTextureSet = maps.kind;
  return tag(material, 0.06);
}

export function createEmissiveMaterial(hex, intensity = 4, name = "District practical emitter") {
  const material = new THREE.MeshStandardNodeMaterial({
    name,
    color: hex,
    emissive: hex,
    emissiveIntensity: intensity,
    roughness: 0.31,
    metalness: 0.08,
  });
  material.userData.rtxTriangleRadiance = [
    new THREE.Color(hex).r * intensity,
    new THREE.Color(hex).g * intensity,
    new THREE.Color(hex).b * intensity,
    1,
  ];
  // Emissive geometry contributes full HDR radiance when road/car rays hit it;
  // it does not itself need a primary reflection ray.
  return tag(material, 0);
}

export function createHaloMaterial(hex, opacity = 0.12) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.toneMapped = false;
  material.userData.rtxIgnore = true;
  return tag(material, 0);
}

export function createRainMaterial(opacity = 0.28) {
  const material = new THREE.LineBasicNodeMaterial({
    color: palette.rain,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  material.userData.rtxIgnore = true;
  return tag(material, 0);
}

export function createMistMaterial(hex = 0x5f91a8, opacity = 0.035) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.toneMapped = false;
  material.userData.rtxIgnore = true;
  return tag(material, 0);
}

export function createLaneMarkingMaterial(hex = 0xc8b893) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    roughness: 0.48,
    metalness: 0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.27,
  });
  // Painted stripes/decals should stay legible in source color without
  // becoming ray-reflection mirrors or duplicating the asphalt response.
  return tag(material, 0.08);
}

export function createSkyMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const height = saturate(positionWorld.y.add(12).mul(0.018));
  const cloud = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.024, 0.011, 0.024))
      .add(vec3(districtClock.mul(0.008), 0, districtClock.mul(-0.004))),
    4,
    2.03,
    0.54,
  ).mul(0.5).add(0.5);
  const horizon = mix(color(0x13283a), color(palette.night), pow(height, 0.48));
  material.colorNode = horizon.add(color(0x27475b).mul(smoothstep(0.63, 0.86, cloud).mul(0.08)));
  return tag(material, 0);
}
