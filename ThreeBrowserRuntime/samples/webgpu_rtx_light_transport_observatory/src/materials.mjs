import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraPosition,
  color,
  dot,
  float,
  fract,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

export const observatoryClock = uniform(0);

export const palette = Object.freeze({
  void: 0x030608,
  graphite: 0x0b1014,
  limestone: 0xc7c1b2,
  plaster: 0x817f78,
  silver: 0xd6e0df,
  bronze: 0x9b5f29,
  amber: 0xffa33a,
  cyan: 0x55d8ff,
  crimson: 0xff355f,
  violet: 0x8a63ff,
  moss: 0x385d4c,
});

function tag(material, reflectionMask = 0) {
  material.rtxReflectionMask = THREE.MathUtils.clamp(reflectionMask, 0, 1);
  return material;
}

function viewFresnel(powerValue = 5) {
  const toEye = normalize(cameraPosition.sub(positionWorld));
  return pow(saturate(float(1).sub(abs(dot(normalWorld, toEye)))), powerValue);
}

function stoneNoise(scale = 0.7) {
  return mx_fractal_noise_float(
    positionWorld.mul(vec3(scale, scale * 0.42, scale)),
    4,
    2.07,
    0.51,
  ).mul(0.5).add(0.5);
}

export function createPlasterMaterial(hex = palette.plaster, roughnessValue = 0.82) {
  const broad = stoneNoise(0.38);
  const pores = stoneNoise(3.4);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Hand-finished mineral plaster",
    color: hex,
    roughness: roughnessValue,
    metalness: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.76,
  });
  material.colorNode = color(hex).mul(broad.mul(0.13).add(0.91));
  material.roughnessNode = float(roughnessValue)
    .add(pores.sub(0.5).mul(0.1))
    .clamp(0.55, 0.98);
  material.normalNode = bumpMap(broad.mul(0.055).add(pores.mul(0.012)), 0.13);
  material.userData.rtxTriangleRadiance = [0.008, 0.008, 0.0075, 1];
  return tag(material, 0.025);
}

export function createPolishedFloorMaterial(environment = null) {
  const broad = stoneNoise(0.16);
  const fine = stoneNoise(2.2);
  const veinA = pow(
    saturate(float(1).sub(abs(sin(
      positionWorld.x.mul(0.52)
        .add(positionWorld.z.mul(0.31))
        .add(broad.mul(5.8)),
    )))),
    8,
  );
  const veinB = pow(
    saturate(float(1).sub(abs(sin(
      positionWorld.x.mul(-0.19)
        .add(positionWorld.z.mul(0.63))
        .add(fine.mul(4.2)),
    )))),
    10,
  );
  const veins = max(veinA, veinB.mul(0.7));
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Mirror-polished black terrazzo",
    color: 0x090d10,
    roughness: 0.12,
    metalness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.075,
    envMap: environment,
    envMapIntensity: 1.5,
  });
  material.colorNode = mix(
    color(0x05080a),
    color(0x20272b),
    broad.mul(0.26),
  ).add(color(0xb9a98c).mul(veins.mul(0.045)));
  material.roughnessNode = mix(float(0.09), float(0.16), fine.mul(0.55));
  material.normalNode = bumpMap(broad.mul(0.025).add(veins.mul(0.009)), 0.055);
  material.userData.rtxTriangleRadiance = [0.001, 0.0015, 0.0018, 1];
  return tag(material, 0.99);
}

export function createMetalMaterial(
  hex = palette.bronze,
  roughnessValue = 0.18,
  environment = null,
) {
  const brushed = sin(
    positionWorld.y.mul(18)
      .add(positionWorld.x.mul(4.1))
      .add(stoneNoise(7.0).mul(1.8)),
  ).mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Brushed architectural metal",
    color: hex,
    roughness: roughnessValue,
    metalness: 1,
    clearcoat: 0.12,
    clearcoatRoughness: 0.16,
    envMap: environment,
    envMapIntensity: 2.1,
  });
  material.colorNode = color(hex).mul(brushed.mul(0.06).add(0.94));
  material.roughnessNode = float(roughnessValue)
    .add(brushed.sub(0.5).mul(0.025))
    .clamp(0.035, 0.52);
  material.normalNode = bumpMap(brushed.mul(0.004), 0.025);
  material.userData.rtxTriangleRadiance = [0.004, 0.003, 0.002, 1];
  return tag(material, 0.94);
}

export function createMirrorMaterial(environment = null, tint = 0xdbe4e8) {
  const fresnel = viewFresnel(6);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Optical mirror portal",
    color: tint,
    metalness: 1,
    roughness: 0.018,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    envMap: environment,
    envMapIntensity: 3.2,
  });
  material.colorNode = mix(color(0x7f8e95), color(tint), fresnel.mul(0.35).add(0.52));
  material.userData.rtxTriangleRadiance = [0.002, 0.003, 0.004, 1];
  return tag(material, 1);
}

export function createSatinMetalMaterial(environment = null) {
  const patina = stoneNoise(1.35);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Oxidised nickel sculpture",
    color: 0x6e807f,
    roughness: 0.12,
    metalness: 1,
    envMap: environment,
    envMapIntensity: 2.7,
  });
  material.colorNode = mix(color(0x314b49), color(0xb7a16e), patina.mul(0.42));
  material.roughnessNode = mix(float(0.07), float(0.22), patina.mul(0.58));
  material.normalNode = bumpMap(patina.mul(0.014), 0.07);
  material.userData.rtxTriangleRadiance = [0.006, 0.007, 0.006, 1];
  return tag(material, 0.97);
}

export function createEmissiveMaterial(hex, intensity = 8, name = "Architectural emitter") {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color: hex,
    fog: false,
    toneMapped: false,
  });
  material.userData.rtxTriangleRadiance = [
    new THREE.Color(hex).r * intensity,
    new THREE.Color(hex).g * intensity,
    new THREE.Color(hex).b * intensity,
    1,
  ];
  material.roughness = 0.28;
  material.metalness = 0;
  return tag(material, 0.06);
}

export function createVelvetMaterial(hex = 0x29131d) {
  const nap = stoneNoise(8.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Acoustic velvet",
    color: hex,
    roughness: 0.96,
    metalness: 0,
    sheen: 1,
    sheenColor: new THREE.Color(hex).offsetHSL(0, 0.08, 0.13),
    sheenRoughness: 0.72,
  });
  material.colorNode = color(hex).mul(nap.mul(0.16).add(0.86));
  material.normalNode = bumpMap(nap.mul(0.02), 0.11);
  material.userData.rtxTriangleRadiance = [0.003, 0.001, 0.0015, 1];
  return tag(material, 0.01);
}

export function createGlassMaterial() {
  const fresnel = viewFresnel(5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Museum low-iron portal glazing",
    color: 0xb9e7eb,
    roughness: 0.08,
    metalness: 0,
    // Native reflections are composited from an offscreen MRT. Three's
    // transmission path re-samples an intermediate color target and can make
    // the far side of a portal fall back to an unresolved/flat material.
    // A physically thin pane only needs Fresnel alpha and clearcoat here; it
    // preserves the complete rendered scene behind the doorway from either
    // side and remains intentionally absent from the static ray-query TLAS.
    transmission: 0,
    thickness: 0,
    ior: 1.46,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 0.72,
    clearcoatRoughness: 0.06,
  });
  material.opacityNode = mix(float(0.025), float(0.14), fresnel);
  material.userData.rtxIgnore = true;
  return tag(material, 0);
}

export function createCarpetMaterial(hex = 0x17191c) {
  const weaveA = abs(fract(positionWorld.x.mul(7.5)).sub(0.5));
  const weaveB = abs(fract(positionWorld.z.mul(7.5)).sub(0.5));
  const weave = smoothstep(0.43, 0.5, max(weaveA, weaveB));
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Woven gallery runner",
    color: hex,
    roughness: 0.94,
    metalness: 0,
    sheen: 0.55,
    sheenColor: new THREE.Color(0x43353c),
  });
  material.colorNode = mix(color(hex), color(0x33262d), weave.mul(0.28));
  material.normalNode = bumpMap(weave.mul(0.018), 0.12);
  material.userData.rtxTriangleRadiance = [0.002, 0.0015, 0.002, 1];
  return tag(material, 0);
}
