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
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

export const palette = Object.freeze({
  night: 0x020307,
  moon: 0x9fc9e8,
  moonDeep: 0x18314a,
  fire: 0xff7a1a,
  coal: 0x160806,
  ember: 0xffb247,
  stone: 0x252527,
  mortar: 0x111114,
  timber: 0x24140d,
  steel: 0x87929a,
  steelDark: 0x252c31,
  oxide: 0x6f2b15,
  grain: 0x9da5a4,
  electron: 0x63cfff,
  proton: 0xff674f,
  neutron: 0x7db5de,
  energy: 0xdca7ff,
});

export const materialClock = uniform(0);
export const forgeInfluence = uniform(1);
export const thermalActivity = uniform(0.28);

function tagReflection(material, mask = 0.15) {
  material.rtxReflectionMask = mask;
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  return material;
}

function viewFresnel(power = 4) {
  const view = normalize(cameraPosition.sub(positionWorld));
  return pow(saturate(float(1).sub(abs(dot(normalWorld, view)))), power);
}

export function createStoneMaterial({ wet = false, colorHex = palette.stone } = {}) {
  const broad = mx_fractal_noise_float(positionWorld.mul(vec3(0.34, 0.47, 0.34)), 4, 2.03, 0.52)
    .mul(0.5).add(0.5);
  const pores = mx_fractal_noise_float(positionWorld.mul(vec3(3.7, 5.1, 3.7)), 3, 2.13, 0.47)
    .mul(0.5).add(0.5);
  const damp = smoothstep(0.38, 0.77, broad.mul(0.74).add(pores.mul(0.26)));
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: colorHex,
    roughness: wet ? 0.24 : 0.84,
    metalness: wet ? 0.04 : 0,
    clearcoat: wet ? 0.72 : 0,
    clearcoatRoughness: 0.18,
  });
  material.colorNode = mix(
    color(colorHex).mul(broad.mul(0.24).add(0.78)),
    color(0x07090d),
    damp.mul(wet ? 0.5 : 0.12),
  );
  material.normalNode = bumpMap(broad.mul(0.09).add(pores.mul(0.032)), wet ? 0.22 : 0.42);
  material.roughnessNode = wet
    ? mix(float(0.42), float(0.12), damp).add(pores.mul(0.05))
    : mix(float(0.72), float(0.96), pores);
  return tagReflection(material, wet ? 0.78 : 0.05);
}

export function createTimberMaterial() {
  const rings = sin(positionWorld.x.mul(5.8).add(positionWorld.y.mul(0.75)))
    .mul(0.5).add(0.5);
  const warp = mx_fractal_noise_float(positionWorld.mul(vec3(1.1, 0.22, 1.1)), 4, 2.04, 0.5)
    .mul(0.5).add(0.5);
  const grain = pow(saturate(rings.mul(0.74).add(warp.mul(0.36))), 1.7);
  const material = new THREE.MeshStandardNodeMaterial({
    color: palette.timber,
    roughness: 0.78,
    metalness: 0,
  });
  material.colorNode = mix(color(0x120a07), color(0x4a2b18), grain);
  material.normalNode = bumpMap(grain.mul(0.065), 0.34);
  material.roughnessNode = mix(float(0.66), float(0.92), warp);
  return tagReflection(material, 0.04);
}

export function createSteelMaterial({ ancient = true, roughness = 0.22 } = {}) {
  const longGrain = mx_fractal_noise_float(
    positionWorld.mul(vec3(9.2, 1.4, 38.0)),
    4,
    2.08,
    0.49,
  ).mul(0.5).add(0.5);
  const pits = mx_fractal_noise_float(
    positionWorld.add(vec3(4.8, -1.7, 8.1)).mul(vec3(18, 11, 18)),
    3,
    2.17,
    0.47,
  ).mul(0.5).add(0.5);
  const polish = abs(sin(positionWorld.x.mul(96).add(longGrain.mul(4.2))));
  const oxide = smoothstep(0.68, 0.91, pits.mul(0.68).add(longGrain.mul(0.32)));
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: palette.steel,
    metalness: 1,
    roughness,
    clearcoat: ancient ? 0.18 : 0.35,
    clearcoatRoughness: 0.32,
    envMapIntensity: 1.28,
  });
  material.colorNode = mix(
    mix(color(0x48535b), color(0xc5cbd0), longGrain.mul(0.62)),
    color(palette.oxide),
    oxide.mul(ancient ? 0.58 : 0.08),
  );
  material.normalNode = bumpMap(
    longGrain.mul(0.032).add(pits.mul(0.018)).add(polish.mul(0.006)),
    ancient ? 0.48 : 0.24,
  );
  material.roughnessNode = mix(float(roughness * 0.55), float(roughness * 2.3), pits)
    .add(oxide.mul(0.31)).clamp(0.045, 0.86);
  return tagReflection(material, 1);
}

export function createSurfaceSteelMaterial() {
  const strata = mx_fractal_noise_float(positionLocal.mul(vec3(0.32, 0.58, 0.32)), 5, 2.02, 0.51)
    .mul(0.5).add(0.5);
  const polish = abs(sin(positionLocal.x.mul(15.7).add(strata.mul(6.2))));
  const corrosion = smoothstep(0.61, 0.83, mx_fractal_noise_float(
    positionLocal.add(vec3(13.4, 2.7, -9.8)).mul(1.4),
    4,
    2.11,
    0.48,
  ).mul(0.5).add(0.5));
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: palette.steelDark,
    metalness: 0.96,
    roughness: 0.31,
    clearcoat: 0.16,
    clearcoatRoughness: 0.38,
  });
  material.colorNode = mix(
    mix(color(0x22292e), color(0x9aa3a5), strata.mul(0.68)),
    color(0x5a2112),
    corrosion.mul(0.58),
  );
  material.normalNode = bumpMap(strata.mul(0.08).add(polish.mul(0.014)).add(corrosion.mul(0.05)), 0.62);
  material.roughnessNode = mix(float(0.16), float(0.68), strata).add(corrosion.mul(0.25)).clamp(0.08, 0.92);
  return tagReflection(material, 0.98);
}

export function createOxideMaterial() {
  const flecks = mx_fractal_noise_float(positionWorld.mul(3.8), 4, 2.12, 0.49).mul(0.5).add(0.5);
  const material = new THREE.MeshStandardNodeMaterial({
    color: palette.oxide,
    roughness: 0.91,
    metalness: 0.18,
  });
  material.colorNode = mix(color(0x30100a), color(0xa3491e), flecks);
  material.normalNode = bumpMap(flecks.mul(0.12), 0.7);
  return tagReflection(material, 0.08);
}

export function createEmberMaterial(intensity = 8) {
  const pulse = sin(materialClock.mul(3.1).add(positionWorld.x.mul(2.3))).mul(0.5).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({ color: palette.ember });
  material.colorNode = mix(color(0xff4816), color(0xffd27a), pulse).mul(intensity);
  material.toneMapped = true;
  material.userData.rtxTriangleRadiance = [8.8, 2.6, 0.45, 1];
  material.rtxReflectionMask = 0;
  return material;
}

export function createDarkMetalMaterial(roughness = 0.48) {
  return tagReflection(new THREE.MeshStandardNodeMaterial({
    color: 0x15191c,
    metalness: 0.92,
    roughness,
  }), 0.72);
}

export function createGrainMaterial(hex = palette.grain, orientation = 0) {
  const bands = sin(
    positionWorld.x.mul(3.1 + orientation * 0.7)
      .add(positionWorld.y.mul(2.2 - orientation * 0.31))
      .add(positionWorld.z.mul(4.4 + orientation * 0.19)),
  ).mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    metalness: 0.86,
    roughness: 0.38,
    clearcoat: 0.12,
  });
  material.colorNode = color(hex).mul(bands.mul(0.22).add(0.78));
  material.normalNode = bumpMap(bands.mul(0.025), 0.24);
  material.roughnessNode = mix(float(0.24), float(0.56), bands);
  return tagReflection(material, 0.84);
}

export function createAtomMaterial(hex = 0xb4c6d1, emissiveHex = 0x1f6388) {
  const fresnel = viewFresnel(2.2);
  const shimmer = sin(materialClock.mul(2.7).add(positionWorld.x.mul(2.1))).mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    metalness: 0.42,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    emissive: emissiveHex,
    emissiveIntensity: 0.7,
  });
  material.emissiveNode = color(emissiveHex).mul(
    fresnel.mul(1.9).add(shimmer.mul(0.35)).add(thermalActivity.mul(0.35)),
  );
  return tagReflection(material, 0.88);
}

export function createElectronMaterial({ colorHex = palette.electron, size = 0.055, opacity = 0.34 } = {}) {
  const material = new THREE.PointsNodeMaterial({
    color: colorHex,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  return material;
}

export function createEnergyMaterial(hex = palette.energy, intensity = 2.4, opacity = 0.68) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = color(hex).mul(
    float(intensity).mul(
      sin(materialClock.mul(2.2).add(positionWorld.x.mul(0.7))).mul(0.2).add(0.8),
    ),
  );
  material.toneMapped = false;
  material.rtxReflectionMask = 0;
  material.userData.rtxIgnore = true;
  return material;
}

export function createSmokeMaterial({ size = 0.42, opacity = 0.075 } = {}) {
  const material = new THREE.PointsNodeMaterial({
    color: 0x9aa8b2,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  material.toneMapped = false;
  return material;
}

export function updateMaterialUniforms(time, forgeWeight = 1, thermal = 0.28) {
  materialClock.value = Number(time) || 0;
  forgeInfluence.value = Math.min(1, Math.max(0, Number(forgeWeight) || 0));
  thermalActivity.value = Math.min(2, Math.max(0, Number(thermal) || 0));
}
