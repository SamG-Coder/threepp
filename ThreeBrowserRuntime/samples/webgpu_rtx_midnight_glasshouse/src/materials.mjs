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
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflector,
  saturate,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  viewportSafeUV,
  viewportSharedTexture,
} from "three/tsl";

export const palette = Object.freeze({
  night: 0x03070b,
  storm: 0x08131c,
  charcoal: 0x101417,
  slate: 0x273137,
  silver: 0xb9c5c8,
  rain: 0x86bad1,
  pool: 0x163b47,
  amber: 0xffad55,
  warm: 0xffd69a,
  leaf: 0x173b32,
});

export const waterClock = uniform(0);
export const rasterReflectionStrength = uniform(1);

function rainTrackedGlassNormal() {
  // A stable, analytic condensation layer: long gravity trails carry tiny
  // beads, while a second frequency prevents the pane reading like brushed
  // metal.  It is evaluated in the material graph, so no per-frame geometry or
  // texture upload is required.
  const lateral = fract(
    positionWorld.x.mul(2.73)
      .add(sin(positionWorld.y.mul(0.41)).mul(0.19)),
  );
  const track = pow(
    saturate(float(1).sub(abs(lateral.sub(0.5)).mul(2))),
    18,
  );
  const beadPhase = fract(
    positionWorld.y.mul(0.57)
      .sub(waterClock.mul(0.045))
      .add(sin(positionWorld.x.mul(4.7)).mul(0.31)),
  );
  const bead = pow(
    saturate(float(1).sub(abs(beadPhase.sub(0.5)).mul(2))),
    24,
  ).mul(track);
  const mist = mx_fractal_noise_float(
    positionWorld.mul(vec3(3.1, 1.8, 3.1)),
    3,
    2.09,
    0.49,
  ).mul(0.5).add(0.5);
  return bumpMap(track.mul(0.010).add(bead.mul(0.021)).add(mist.mul(0.003)), 0.12);
}

function tagReflectionMaterial(material, mask) {
  material.rtxReflectionMask = mask;
  if (!Number.isFinite(material.roughness)) material.roughness = 1;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  return material;
}

function viewFresnel(power = 4) {
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  return pow(
    saturate(float(1).sub(abs(dot(normalWorld, viewDirection)))),
    power,
  );
}

export function createWetFloorMaterial() {
  const reflection = reflector({
    resolutionScale: 0.58,
    generateMipmaps: true,
    bounces: false,
    samples: 1,
  });
  reflection.levelNode = float(0.85);

  const broad = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.24, 0.08, 0.24)),
    4,
    2.03,
    0.52,
  ).mul(0.5).add(0.5);
  const fine = mx_fractal_noise_float(
    positionWorld.add(vec3(9.7, 0, -4.2)).mul(vec3(1.7, 0.18, 1.7)),
    3,
    2.11,
    0.48,
  ).mul(0.5).add(0.5);
  const tileX = abs(fract(positionWorld.x.mul(0.285)).sub(0.5));
  const tileZ = abs(fract(positionWorld.z.mul(0.285)).sub(0.5));
  const grout = smoothstep(0.475, 0.497, max(tileX, tileZ));
  const wetness = smoothstep(0.28, 0.76, broad.mul(0.72).add(fine.mul(0.28)));
  const stone = mix(color(palette.charcoal), color(palette.slate), broad.mul(0.58));

  const distortion = vec2(
    fine.sub(0.5),
    broad.sub(0.5),
  ).mul(0.0018);
  const rainRippleHeight = sin(
    positionWorld.x.mul(2.17)
      .add(positionWorld.z.mul(1.63))
      .sub(waterClock.mul(3.4))
      .add(fine.mul(5.7)),
  ).mul(fine.mul(0.5).add(0.5));
  const worldXZ = vec2(positionWorld.x, positionWorld.z);
  let impactRipples = float(0);
  const impacts = [
    [-9.2, 4.7, 0.08],
    [7.8, 5.8, 0.41],
    [9.6, -5.1, 0.73],
    [-8.4, -5.6, 0.92],
  ];
  for (const [x, z, phase] of impacts) {
    const radius = fract(waterClock.mul(0.19).add(phase)).mul(2.8);
    const distanceToRing = abs(length(worldXZ.sub(vec2(x, z))).sub(radius));
    const ring = float(1).sub(smoothstep(0.018, 0.085, distanceToRing))
      .mul(float(1).sub(radius.mul(1 / 2.8)));
    impactRipples = impactRipples.add(ring);
  }
  const wetMicroNormal = bumpMap(
    broad.mul(0.09)
      .add(fine.mul(0.035))
      .add(rainRippleHeight.mul(0.006))
      .add(impactRipples.mul(0.018)),
    0.18,
  );
  reflection.uvNode = reflection.uvNode.add(distortion);

  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Rain-polished charcoal stone",
    color: palette.charcoal,
    metalness: 0.08,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
  });
  material.colorNode = mix(stone, color(0x080a0c), grout.mul(0.68));
  material.normalNode = wetMicroNormal;
  material.roughnessNode = mix(float(0.29), float(0.105), wetness).add(grout.mul(0.32));
  material.emissiveNode = reflection.rgb.mul(
    wetness.mul(0.38).add(viewFresnel(4).mul(0.42)),
  ).mul(0.82).mul(rasterReflectionStrength);
  tagReflectionMaterial(material, 0.96);

  // The native MRT must never build a ReflectorNode. Reuse only the procedural
  // stone nodes which are independent of the planar capture, and leave the
  // specular contribution to OP84.
  const nativeMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Native guide — rain-polished charcoal stone",
    color: palette.charcoal,
    metalness: 0.08,
    roughness: 0.18,
    clearcoat: 0,
    envMapIntensity: 0,
  });
  nativeMaterial.colorNode = material.colorNode;
  nativeMaterial.normalNode = wetMicroNormal;
  nativeMaterial.roughnessNode = material.roughnessNode;
  tagReflectionMaterial(nativeMaterial, 0.96);

  return { material, nativeMaterial, reflection };
}

export function createPoolWaterMaterial() {
  const reflection = reflector({
    resolutionScale: 0.68,
    generateMipmaps: true,
    bounces: false,
    samples: 1,
  });
  reflection.levelNode = float(0.35);

  const phaseA = positionWorld.x.mul(1.24)
    .add(positionWorld.z.mul(0.47))
    .add(waterClock.mul(0.72));
  const phaseB = positionWorld.x.mul(-0.62)
    .add(positionWorld.z.mul(1.58))
    .sub(waterClock.mul(0.93));
  const phaseC = positionWorld.x.mul(3.1)
    .add(positionWorld.z.mul(-2.6))
    .add(waterClock.mul(1.43));
  const slopeX = cos(phaseA).mul(0.72)
    .add(cos(phaseB).mul(-0.31))
    .add(cos(phaseC).mul(0.08));
  const slopeZ = cos(phaseA).mul(0.25)
    .add(cos(phaseB).mul(0.79))
    .add(cos(phaseC).mul(-0.07));
  const waveHeight = sin(phaseA).mul(0.28)
    .add(sin(phaseB).mul(0.19))
    .add(sin(phaseC).mul(0.035));
  const waveNormal = bumpMap(waveHeight, 0.14);
  const distortion = vec2(slopeX, slopeZ).mul(0.0042);
  reflection.uvNode = reflection.uvNode.add(distortion);

  const refraction = viewportSharedTexture(
    viewportSafeUV(screenUV.add(distortion.mul(0.72))),
  );
  const shimmer = sin(phaseA.mul(5.1).add(sin(phaseB.mul(4.4))))
    .mul(0.5).add(0.5);
  const fresnel = viewFresnel(5);
  const reflectionWeight = fresnel.mul(0.68).add(0.20).saturate()
    .mul(rasterReflectionStrength);

  const material = new THREE.MeshBasicNodeMaterial({
    name: "Shallow reflecting pool",
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  material.colorNode = mix(
    refraction.rgb.mul(color(0x7395a0)).mul(0.56),
    reflection.rgb,
    reflectionWeight,
  ).add(color(palette.warm).mul(pow(shimmer, 18).mul(0.055)));
  material.opacityNode = mix(float(0.88), float(0.97), fresnel);
  tagReflectionMaterial(material, 0.95);
  material.roughness = 0.055;

  // The fallback water also samples the viewport for refraction. Neither that
  // copy nor its ReflectorNode belongs in the native guide pass, whose three
  // attachments must stay same-format and same-size for the OP84 bridge.
  const nativeMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Native guide — shallow reflecting pool",
    color: palette.pool,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  nativeMaterial.colorNode = color(0x102b35)
    .add(color(palette.warm).mul(pow(shimmer, 18).mul(0.035)));
  nativeMaterial.normalNode = waveNormal;
  nativeMaterial.roughness = 0.055;
  nativeMaterial.metalness = 0.02;
  tagReflectionMaterial(nativeMaterial, 0.95);

  return { material, nativeMaterial, reflection };
}

export function createPoolBasinMaterial() {
  const broad = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.82, 0.2, 0.82)),
    4,
    2.03,
    0.51,
  ).mul(0.5).add(0.5);
  const phaseA = positionWorld.x.mul(1.24)
    .add(positionWorld.z.mul(0.47))
    .add(waterClock.mul(0.72));
  const phaseB = positionWorld.x.mul(-0.62)
    .add(positionWorld.z.mul(1.58))
    .sub(waterClock.mul(0.93));
  const phaseC = positionWorld.x.mul(3.1)
    .sub(positionWorld.z.mul(2.6))
    .add(waterClock.mul(1.43));
  const ridgeA = pow(
    saturate(float(1).sub(abs(sin(phaseA.mul(5.4).add(sin(phaseB).mul(0.9)))))),
    9,
  );
  const ridgeB = pow(
    saturate(float(1).sub(abs(sin(phaseB.mul(4.7).sub(sin(phaseC).mul(0.7)))))),
    8,
  );
  const caustic = saturate(
    ridgeA.mul(ridgeB).mul(1.9)
      .add(ridgeA.add(ridgeB).mul(0.045)),
  );
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Submerged charcoal aggregate",
    color: 0x17272d,
    roughness: 0.46,
    metalness: 0.03,
    clearcoat: 0.22,
    clearcoatRoughness: 0.31,
  });
  material.colorNode = mix(
    color(0x102127),
    color(0x29464d),
    broad.mul(0.54),
  ).add(color(0x9ed7da).mul(caustic.mul(0.15)));
  material.roughnessNode = mix(float(0.52), float(0.33), caustic.mul(0.46));
  material.normalNode = bumpMap(broad.mul(0.055).add(caustic.mul(0.011)), 0.16);
  material.userData.rtxTriangleRadiance = [0.006, 0.011, 0.013, 1];
  return tagReflectionMaterial(material, 0.17);
}

export function createReflectiveGlassMaterial() {
  const reflection = reflector({
    resolutionScale: 0.40,
    generateMipmaps: true,
    bounces: false,
    samples: 1,
  });
  reflection.levelNode = float(0.55);
  const fresnel = viewFresnel(5);

  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Rain-darkened structural glass",
    color: 0x29414b,
    metalness: 0,
    roughness: 0.075,
    transparent: true,
    opacity: 0.15,
    // The exterior must remain visible through the pane.  Writing the glass
    // depth made later transparent layers fight the opaque building depth and
    // turned the rear wall into a dark slab in the native MRT pass.
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  material.opacityNode = mix(float(0.09), float(0.42), fresnel);
  material.normalNode = rainTrackedGlassNormal();
  material.emissiveNode = reflection.rgb.mul(fresnel.mul(0.48).add(0.035))
    .mul(rasterReflectionStrength);
  tagReflectionMaterial(material, 0.84);

  // OP84 currently consumes one blended beauty + guide MRT.  An opaque guide
  // preserves a clean normal, but it also destroys the transmitted beauty
  // behind the window.  Keep this no-Reflector guide transparent and disable
  // its reflection mask; floor/pool rays still see the exterior while glass
  // remains a cheap raster Fresnel layer.
  const nativeMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Native transmissive guide — rear structural glass",
    color: 0x1b3039,
    roughness: 0.075,
    metalness: 0,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  nativeMaterial.colorNode = mix(color(0x122128), color(0x29414b), fresnel.mul(0.32));
  nativeMaterial.normalNode = rainTrackedGlassNormal();
  tagReflectionMaterial(nativeMaterial, 0);

  return { material, nativeMaterial, reflection };
}

export function createSideGlassMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Cool structural glass",
    color: 0x36545f,
    metalness: 0,
    roughness: 0.09,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
  material.normalNode = rainTrackedGlassNormal();
  return tagReflectionMaterial(material, 0.72);
}

export function createStoneMaterial(hex = palette.charcoal, roughness = 0.72) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    metalness: 0.04,
    roughness,
    clearcoat: 0.22,
    clearcoatRoughness: 0.3,
  });
  const grain = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.72, 0.32, 0.72)),
    3,
    2.07,
    0.52,
  ).mul(0.5).add(0.5);
  material.colorNode = color(hex).mul(grain.mul(0.18).add(0.88));
  material.roughnessNode = float(roughness).add(grain.sub(0.5).mul(0.11)).saturate();
  return tagReflectionMaterial(material, Math.max(0.06, (1 - roughness) * 0.34));
}

export function createMetalMaterial(hex = 0x768187, roughness = 0.24, metalness = 1) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    metalness,
    roughness,
    clearcoat: metalness < 0.5 ? 0.55 : 0,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.65,
  });
  return tagReflectionMaterial(material, 0.56 + metalness * 0.42);
}

export function createChromeMaterial(environment = null, roughness = 0.055) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Gallery chrome",
    color: 0xdce6e8,
    metalness: 1,
    roughness,
    envMap: environment,
    envMapIntensity: 2.7,
  });
  return tagReflectionMaterial(material, 1);
}

export function createLeafMaterial(hex = palette.leaf) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    metalness: 0,
    roughness: 0.67,
    clearcoat: 0.42,
    clearcoatRoughness: 0.24,
    side: THREE.DoubleSide,
  });
  const variegation = mx_fractal_noise_float(
    positionWorld.mul(vec3(1.7, 0.54, 1.7)),
    3,
    2.03,
    0.52,
  ).mul(0.5).add(0.5);
  material.colorNode = mix(color(hex), color(0x3d6653), variegation.mul(0.34));
  return tagReflectionMaterial(material, 0.13);
}

export function createEmissiveMaterial(hex, intensity = 1) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: intensity,
    roughness: 0.38,
    metalness: 0.08,
  });
  return tagReflectionMaterial(material, 0.08);
}

export function createSkyMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const height = saturate(positionWorld.y.add(8).mul(0.027));
  const cloud = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.035, 0.018, 0.035)),
    4,
    2.04,
    0.53,
  ).mul(0.5).add(0.5);
  material.colorNode = mix(color(0x101c25), color(palette.night), pow(height, 0.52))
    .add(color(0x203a49).mul(smoothstep(0.58, 0.82, cloud).mul(0.11)));
  return tagReflectionMaterial(material, 0);
}
