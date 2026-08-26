import * as THREE from "three/webgpu";
import {
  abs,
  atan,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  mix,
  normalView,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from "three/tsl";

export const cosmicTime = uniform(0);
export const accretionPower = uniform(0.12);
export const stellarShift = uniform(1);
export const stellarRadiance = uniform(1);
export const stellarOpacity = uniform(1);

export function updateMaterialClock(timeSeconds) {
  cosmicTime.value = Math.max(0, Number(timeSeconds) || 0);
}

export function createVacuumMaterial() {
  const direction = normalize(positionLocal);
  const bentBand = direction.y
    .add(sin(direction.x.mul(8.7).add(direction.z.mul(3.1))).mul(0.045))
    .add(sin(direction.z.mul(13.2).sub(direction.x.mul(2.7))).mul(0.018));
  const milkyWay = exp(abs(bentBand).mul(-17.5));
  const cloud = sin(direction.x.mul(31).add(direction.z.mul(18.7)))
    .mul(sin(direction.z.mul(47).sub(direction.y.mul(11))))
    .mul(0.5).add(0.5);
  const dustLane = exp(abs(bentBand.add(sin(direction.x.mul(23)).mul(0.015))).mul(-58));
  const horizonGlow = exp(abs(direction.y.add(0.18)).mul(-6.5));
  const base = mix(color(0x000104), color(0x07101d), direction.y.mul(0.5).add(0.5));
  const galaxy = mix(color(0x17223a), color(0x6b3652), cloud)
    .mul(milkyWay.mul(0.34))
    .mul(float(1).sub(dustLane.mul(0.72)));
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Procedural deep-space radiance",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  material.colorNode = base
    .add(galaxy)
    .add(color(0x161230).mul(horizonGlow.mul(0.035)));
  material.toneMapped = false;
  material.userData.rtxIgnore = true;
  return material;
}

export function createPhotosphereMaterial() {
  const p = normalize(positionLocal);
  const broad = sin(p.x.mul(46).add(sin(p.y.mul(21).add(cosmicTime.mul(0.21))).mul(2.7)))
    .mul(sin(p.y.mul(53).sub(p.z.mul(29)).sub(cosmicTime.mul(0.34))))
    .mul(0.5).add(0.5);
  const fine = sin(p.x.mul(137).add(p.z.mul(91)).add(cosmicTime.mul(0.83)))
    .mul(sin(p.y.mul(121).sub(p.x.mul(67)).sub(cosmicTime.mul(0.61))))
    .mul(0.5).add(0.5);
  const cells = pow(abs(broad.sub(0.5)).mul(2), 0.58)
    .mul(0.64)
    .add(fine.mul(0.36));
  const limb = pow(clamp(abs(normalView.z), 0, 1), 0.34).mul(0.34).add(0.66);

  const warm = mix(color(0xff3508), color(0xffad37), cells);
  const neutral = mix(warm, color(0xfff2bd), pow(cells, 2.1));
  const redshifted = mix(color(0x8f1004), neutral, smoothstep(0.34, 1, stellarShift));
  const shifted = mix(redshifted, color(0xd8efff), smoothstep(1, 1.42, stellarShift));

  const material = new THREE.MeshBasicNodeMaterial({
    name: "5772 K relativistically shifted photosphere",
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: true,
  });
  material.colorNode = shifted
    .mul(limb)
    .mul(stellarRadiance)
    .mul(cells.mul(0.26).add(0.92));
  material.opacityNode = stellarOpacity;
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  return material;
}

export function createCoronaMaterial({ inner = false } = {}) {
  const p = normalize(positionLocal);
  const radialNoise = sin(p.x.mul(31).add(cosmicTime.mul(0.71)))
    .mul(sin(p.y.mul(39).sub(cosmicTime.mul(0.47))))
    .mul(0.5).add(0.5);
  const rim = pow(float(1).sub(clamp(abs(normalView.z), 0, 1)), inner ? 1.8 : 3.4);
  const material = new THREE.MeshBasicNodeMaterial({
    name: inner ? "Solar chromosphere" : "Solar scattering corona",
    color: 0xffffff,
    transparent: true,
    opacity: inner ? 0.28 : 0.12,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(
    color(inner ? 0xff5a10 : 0xff7b2a),
    color(inner ? 0xffe2a0 : 0xffc66b),
    radialNoise,
  ).mul(rim.mul(inner ? 3.2 : 2.1).add(inner ? 0.15 : 0.04));
  material.opacityNode = stellarOpacity.mul(inner ? 0.42 : 0.2).mul(rim.add(0.08));
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  return material;
}

export function createProminenceMaterial() {
  const pulse = sin(positionWorld.x.mul(3.7).add(positionWorld.z.mul(4.3)).add(cosmicTime.mul(4.1)))
    .mul(0.5).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Magnetically arched solar prominence",
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(color(0xff2a06), color(0xffd17c), pow(pulse, 1.8)).mul(2.4);
  material.opacityNode = stellarOpacity.mul(pulse.mul(0.38).add(0.55));
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  return material;
}

export function createAccretionDiskMaterial({ veil = false } = {}) {
  const radial = length(positionLocal.xy);
  const azimuth = atan(positionLocal.y, positionLocal.x);
  const innerRadius = float(6);
  const safeRadius = max(radial, innerRadius.add(0.001));
  const zeroTorque = max(float(0), float(1).sub(sqrt(innerRadius.div(safeRadius))));
  const flux = pow(safeRadius.div(8.17), -3).mul(zeroTorque).mul(5.92);
  const temperature = pow(max(flux, 0.00001), 0.25);
  const orbitalPhase = azimuth.mul(13)
    .sub(cosmicTime.mul(6.8).div(pow(safeRadius, 1.5)))
    .add(radial.mul(veil ? 8.2 : 12.7));
  const turbulence = sin(orbitalPhase)
    .mul(sin(orbitalPhase.mul(0.47).add(radial.mul(19.1))))
    .mul(0.5).add(0.5);
  const filaments = pow(fract(turbulence.mul(3.7).add(radial.mul(0.73))), veil ? 1.2 : 2.4);

  const beta = float(1).div(sqrt(max(safeRadius.sub(2), 1.001)));
  const gamma = float(1).div(sqrt(max(float(0.001), float(1).sub(beta.mul(beta)))));
  const worldTangent = normalize(vec3(positionWorld.z.negate(), 0, positionWorld.x));
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const mu = dot(worldTangent, toCamera);
  const gravitational = sqrt(max(float(0), float(1).sub(float(2).div(safeRadius))));
  const shift = gravitational.div(gamma.mul(float(1).sub(beta.mul(mu))));
  const beaming = pow(clamp(shift, 0.28, 1.9), 3);

  const thermal = mix(color(0x8a1205), color(0xff7317), clamp(temperature, 0, 1));
  const hot = mix(thermal, color(0xfff1c8), smoothstep(0.62, 1.12, temperature));
  const redshifted = mix(color(0x4c0803), hot, smoothstep(0.34, 0.95, shift));
  const observed = mix(redshifted, color(0xcde9ff), smoothstep(1.02, 1.58, shift));
  const innerFade = smoothstep(6, veil ? 8.5 : 6.8, radial);
  const outerFade = float(1).sub(smoothstep(veil ? 32 : 37, veil ? 46 : 44, radial));
  const opacity = innerFade.mul(outerFade).mul(filaments.mul(veil ? 0.18 : 0.34).add(veil ? 0.035 : 0.11));

  const material = new THREE.MeshBasicNodeMaterial({
    name: veil ? "Optically thin relativistic disk veil" : "Relativistic thin-disk emission",
    transparent: true,
    opacity: veil ? 0.22 : 0.92,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = observed
    .mul(beaming)
    .mul(temperature.mul(veil ? 0.54 : 1.72).add(0.045))
    .mul(accretionPower.mul(veil ? 0.54 : 0.92).add(0.10));
  material.opacityNode = opacity.mul(accretionPower.mul(0.62).add(0.14));
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  return material;
}

export function createJetMaterial(colorValue, opacity) {
  const rise = smoothstep(-1, 1, positionLocal.y);
  const pulse = sin(positionLocal.y.mul(11).sub(cosmicTime.mul(5.2)))
    .mul(0.5).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Late-time magnetically collimated polar plasma",
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(color(colorValue), color(0xe5f7ff), pow(rise, 1.7))
    .mul(pulse.mul(0.42).add(1.1));
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  return material;
}
