import * as THREE from "three/webgpu";
import {
  float,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  uniform,
} from "three/tsl";
import { dayBlendAt, dayProgressAt } from "./day-cycle.mjs";

const LIGHT_DISTANCE = 60;
const SKY_RADIUS = 220;
const DEFAULT_PRESET = "afternoon";
const CAMPFIRE_POSITION = Object.freeze([3.6, 1.68, 17.8]);

function freezeVec(value) {
  return Object.freeze([value[0], value[1], value[2]]);
}

function freezePreset(preset) {
  const frozen = {
    name: preset.name,
    sunDirection: freezeVec(preset.sunDirection),
    sunColor: preset.sunColor,
    sunIntensity: preset.sunIntensity,
    hemiSky: preset.hemiSky,
    hemiGround: preset.hemiGround,
    hemiIntensity: preset.hemiIntensity,
    fogColor: preset.fogColor,
    fogDensity: preset.fogDensity,
    skyHorizon: preset.skyHorizon,
    skyZenith: preset.skyZenith,
    exposure: preset.exposure,
    treeTint: freezeVec(preset.treeTint),
    rtxCelestialIntensity: preset.rtxCelestialIntensity,
    rtxShadowStrength: preset.rtxShadowStrength,
    rtxAoStrength: preset.rtxAoStrength,
  };
  if (preset.moon) {
    frozen.moon = Object.freeze({
      direction: freezeVec(preset.moon.direction),
      color: preset.moon.color,
      intensity: preset.moon.intensity,
    });
  }
  if (preset.campfire) frozen.campfire = true;
  return Object.freeze(frozen);
}

function configureShadow(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.near = 4;
  light.shadow.camera.far = 140;
  light.shadow.camera.left = -40;
  light.shadow.camera.right = 40;
  light.shadow.camera.top = 24;
  light.shadow.camera.bottom = -24;
  light.shadow.bias = -0.0008;
}

function placeDirectional(light, direction, focus, distance = LIGHT_DISTANCE) {
  light.position.copy(focus).addScaledVector(direction, distance);
  light.target.position.copy(focus);
}

function mixNumber(a, b, amount) {
  return a + (b - a) * amount;
}

export const PRESETS = Object.freeze({
  morning: freezePreset({
    name: "Morning",
    sunDirection: [-0.76, 0.36, 0.18],
    sunColor: 0xffe2c4,
    sunIntensity: 1.95,
    hemiSky: 0xd2e4f2,
    hemiGround: 0x7d6a4e,
    hemiIntensity: 0.58,
    fogColor: 0xd0d4c8,
    fogDensity: 0.014,
    skyHorizon: 0xf0cbb0,
    skyZenith: 0x7aadd0,
    exposure: 1.04,
    treeTint: [0.94, 0.97, 1.02],
    rtxCelestialIntensity: 3.6,
    rtxShadowStrength: 0.34,
    rtxAoStrength: 0.12,
  }),
  midday: freezePreset({
    name: "Midday",
    sunDirection: [0.18, 0.96, 0.20],
    sunColor: 0xfff3dc,
    sunIntensity: 2.9,
    hemiSky: 0xc5def0,
    hemiGround: 0x9a8860,
    hemiIntensity: 0.95,
    fogColor: 0xd5d2c6,
    fogDensity: 0.0055,
    skyHorizon: 0xc5d6e4,
    skyZenith: 0x4a90c8,
    exposure: 1.20,
    treeTint: [1.04, 1.02, 0.96],
    rtxCelestialIntensity: 5.8,
    rtxShadowStrength: 0.20,
    rtxAoStrength: 0.055,
  }),
  afternoon: freezePreset({
    name: "Late afternoon",
    sunDirection: [0.74, 0.40, 0.22],
    sunColor: 0xffd4a0,
    sunIntensity: 1.85,
    hemiSky: 0xd8e8f4,
    hemiGround: 0xb08a55,
    hemiIntensity: 1.35,
    fogColor: 0x9eb0a4,
    fogDensity: 0.0048,
    skyHorizon: 0xd7c19a,
    skyZenith: 0x6a9cc8,
    exposure: 1.28,
    treeTint: [1.02, 1.0, 0.94],
    rtxCelestialIntensity: 4.4,
    rtxShadowStrength: 0.28,
    rtxAoStrength: 0.085,
  }),
  sunset: freezePreset({
    name: "Sunset",
    sunDirection: [0.86, 0.22, 0.14],
    sunColor: 0xff8c4a,
    sunIntensity: 1.85,
    hemiSky: 0xffb07a,
    hemiGround: 0x6e4030,
    hemiIntensity: 0.48,
    fogColor: 0xd8a07a,
    fogDensity: 0.016,
    skyHorizon: 0xff9a5c,
    skyZenith: 0x2e3e68,
    exposure: 1.16,
    treeTint: [1.22, 0.72, 0.48],
    rtxCelestialIntensity: 3.2,
    rtxShadowStrength: 0.38,
    rtxAoStrength: 0.14,
  }),
  night: freezePreset({
    name: "Night",
    sunDirection: [-0.35, 0.68, -0.44],
    sunColor: 0xa8b8c8,
    sunIntensity: 0,
    hemiSky: 0x1c2a38,
    hemiGround: 0x121014,
    hemiIntensity: 0.22,
    fogColor: 0x161c24,
    fogDensity: 0.018,
    skyHorizon: 0x1a2430,
    skyZenith: 0x05070c,
    exposure: 0.82,
    treeTint: [0.52, 0.62, 0.82],
    rtxCelestialIntensity: 1.15,
    rtxShadowStrength: 0.42,
    rtxAoStrength: 0.16,
    moon: {
      direction: [-0.35, 0.68, -0.44],
      color: 0xc5d2de,
      intensity: 0.88,
    },
    campfire: true,
  }),
});

export const SUN_DIRECTION = PRESETS.afternoon.sunDirection;

export function createAtmosphere(scene) {
  if (!scene.background?.isColor) scene.background = new THREE.Color();
  if (!scene.fog?.isFogExp2) scene.fog = new THREE.FogExp2(0xc4c0ae, 0.011);

  const hemi = new THREE.HemisphereLight(0xcfe4f4, 0x8a6e4a, 0.72);
  hemi.name = "Australian sky hemisphere";
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd4a0, 2.35);
  sun.name = "Late-afternoon sun";
  configureShadow(sun);
  scene.add(sun);
  scene.add(sun.target);

  const moon = new THREE.DirectionalLight(0xc5d2de, 0);
  moon.name = "Moonlight";
  configureShadow(moon);
  moon.castShadow = false;
  moon.visible = true;
  scene.add(moon);
  scene.add(moon.target);

  const campfire = new THREE.PointLight(0xff7a32, 0, 11, 2);
  campfire.name = "Night campfire";
  campfire.position.set(CAMPFIRE_POSITION[0], CAMPFIRE_POSITION[1], CAMPFIRE_POSITION[2]);
  campfire.visible = true;
  scene.add(campfire);

  const skyHorizon = uniform(new THREE.Color(PRESETS.afternoon.skyHorizon));
  const skyZenith = uniform(new THREE.Color(PRESETS.afternoon.skyZenith));
  const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const skyMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const up = normalize(positionWorld).y;
  skyMaterial.colorNode = mix(
    skyHorizon,
    skyZenith,
    smoothstep(float(-0.02), float(0.58), up),
  );
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = "Late-day sky dome";
  sky.userData.rtxIgnore = true;
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const moonDiscGeometry = new THREE.CircleGeometry(3.4, 32);
  const moonDiscMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xc5d2de,
    transparent: true,
    fog: false,
    depthWrite: false,
    toneMapped: false,
  });
  const moonDisc = new THREE.Mesh(moonDiscGeometry, moonDiscMaterial);
  moonDisc.name = "Moon disc";
  moonDisc.userData.rtxIgnore = true;
  moonDisc.frustumCulled = false;
  moonDisc.renderOrder = -900;
  moonDisc.visible = true;
  scene.add(moonDisc);

  const sunDirection = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const colorScratch = new THREE.Color();
  const defaultMoonDirection = PRESETS.night.moon.direction;
  const moonDirection = new THREE.Vector3(-0.35, 0.68, -0.44).normalize();
  const shadowFocus = new THREE.Vector3(0, 1.2, 34);
  const desiredShadowFocus = new THREE.Vector3();
  const runtimePreset = {
    name: PRESETS[DEFAULT_PRESET].name,
    exposure: PRESETS[DEFAULT_PRESET].exposure,
    treeTint: [...PRESETS[DEFAULT_PRESET].treeTint],
    rtxCelestialIntensity: PRESETS[DEFAULT_PRESET].rtxCelestialIntensity,
    rtxShadowStrength: PRESETS[DEFAULT_PRESET].rtxShadowStrength,
    rtxAoStrength: PRESETS[DEFAULT_PRESET].rtxAoStrength,
  };
  let dayProgress = dayProgressAt(0);
  let rayTracedShadows = false;

  function syncShadowMode() {
    sun.castShadow = sun.intensity > 0.02 && !rayTracedShadows;
    moon.castShadow = moon.intensity > 0.01 && !rayTracedShadows;
  }

  function applyExposure(value) {
    const renderer = scene.userData.renderer;
    if (renderer && "toneMappingExposure" in renderer) {
      renderer.toneMappingExposure = value;
    }
  }

  function mixColor(target, from, to, amount) {
    target.setHex(from);
    colorScratch.setHex(to);
    target.lerp(colorScratch, amount);
  }

  function applyBlend(fromName, toName, amount = 0) {
    const from = PRESETS[fromName];
    const to = PRESETS[toName];
    if (!from || !to) throw new RangeError(`Unknown atmosphere blend: ${fromName} -> ${toName}`);
    const blend = THREE.MathUtils.clamp(Number(amount) || 0, 0, 1);

    sunDirection.set(
      mixNumber(from.sunDirection[0], to.sunDirection[0], blend),
      mixNumber(from.sunDirection[1], to.sunDirection[1], blend),
      mixNumber(from.sunDirection[2], to.sunDirection[2], blend),
    );
    if (sunDirection.y <= 0) sunDirection.y = 0.02;
    sunDirection.normalize();

    mixColor(sun.color, from.sunColor, to.sunColor, blend);
    sun.intensity = mixNumber(from.sunIntensity, to.sunIntensity, blend);
    sun.visible = true;
    sun.castShadow = sun.intensity > 0.02 && !rayTracedShadows;
    sun.name = `${from.name} to ${to.name} sun`;
    placeDirectional(sun, sunDirection, shadowFocus);

    mixColor(hemi.color, from.hemiSky, to.hemiSky, blend);
    mixColor(hemi.groundColor, from.hemiGround, to.hemiGround, blend);
    hemi.intensity = mixNumber(from.hemiIntensity, to.hemiIntensity, blend);

    mixColor(scene.background, from.fogColor, to.fogColor, blend);
    scene.fog.color.copy(scene.background);
    scene.fog.density = mixNumber(from.fogDensity, to.fogDensity, blend);
    mixColor(skyHorizon.value, from.skyHorizon, to.skyHorizon, blend);
    mixColor(skyZenith.value, from.skyZenith, to.skyZenith, blend);
    sky.name = `${from.name} to ${to.name} sky dome`;

    runtimePreset.name = fromName === toName
      ? from.name
      : `${from.name} → ${to.name}`;
    runtimePreset.exposure = mixNumber(from.exposure, to.exposure, blend);
    runtimePreset.treeTint[0] = mixNumber(from.treeTint[0], to.treeTint[0], blend);
    runtimePreset.treeTint[1] = mixNumber(from.treeTint[1], to.treeTint[1], blend);
    runtimePreset.treeTint[2] = mixNumber(from.treeTint[2], to.treeTint[2], blend);
    runtimePreset.rtxCelestialIntensity = mixNumber(
      from.rtxCelestialIntensity,
      to.rtxCelestialIntensity,
      blend,
    );
    runtimePreset.rtxShadowStrength = mixNumber(
      from.rtxShadowStrength,
      to.rtxShadowStrength,
      blend,
    );
    runtimePreset.rtxAoStrength = mixNumber(from.rtxAoStrength, to.rtxAoStrength, blend);
    applyExposure(runtimePreset.exposure);

    const fromMoon = from.moon;
    const toMoon = to.moon;
    const fromMoonDirection = fromMoon?.direction ?? toMoon?.direction ?? defaultMoonDirection;
    const toMoonDirection = toMoon?.direction ?? fromMoon?.direction ?? defaultMoonDirection;
    scratch.set(
      mixNumber(fromMoonDirection[0], toMoonDirection[0], blend),
      mixNumber(fromMoonDirection[1], toMoonDirection[1], blend),
      mixNumber(fromMoonDirection[2], toMoonDirection[2], blend),
    );
    if (scratch.y <= 0) scratch.y = 0.02;
    moonDirection.copy(scratch.normalize());
    moon.intensity = mixNumber(fromMoon?.intensity ?? 0, toMoon?.intensity ?? 0, blend);
    moon.visible = true;
    moon.castShadow = moon.intensity > 0.01 && !rayTracedShadows;
    mixColor(
      moon.color,
      fromMoon?.color ?? toMoon?.color ?? 0xc5d2de,
      toMoon?.color ?? fromMoon?.color ?? 0xc5d2de,
      blend,
    );
    placeDirectional(moon, moonDirection, shadowFocus);
    moonDisc.position.copy(moonDirection).multiplyScalar(SKY_RADIUS * 0.84);
    moonDisc.lookAt(0, 0, 0);
    moonDiscMaterial.color.copy(moon.color);
    moonDiscMaterial.opacity = THREE.MathUtils.clamp(moon.intensity / 0.88, 0, 1);
    moonDisc.visible = true;

    campfire.intensity = mixNumber(from.campfire ? 2.6 : 0, to.campfire ? 2.6 : 0, blend);
    campfire.visible = true;
    syncShadowMode();
    return runtimePreset;
  }

  function applyPreset(name) {
    return applyBlend(name, name, 0);
  }

  applyPreset(DEFAULT_PRESET);

  return {
    sun,
    hemi,
    sky,
    moon,
    campfire,
    applyPreset,
    updateCycle(elapsedSeconds) {
      dayProgress = dayProgressAt(elapsedSeconds);
      const phase = dayBlendAt(dayProgress);
      return applyBlend(phase.from, phase.to, phase.mix);
    },
    get dayProgress() {
      return dayProgress;
    },
    getPreset() {
      return runtimePreset;
    },
    sunDirection,
    updateFocus(position, delta = 1 / 60) {
      desiredShadowFocus.set(position.x, 1.2, position.z + 22);
      shadowFocus.lerp(desiredShadowFocus, 1 - Math.exp(-Math.max(0, delta) * 7));
      placeDirectional(sun, sunDirection, shadowFocus);
      if (moon.visible) placeDirectional(moon, moonDirection, shadowFocus);
    },
    setRayTracedShadows(enabled) {
      rayTracedShadows = Boolean(enabled);
      syncShadowMode();
    },
    dispose() {
      skyGeometry.dispose();
      skyMaterial.dispose();
      moonDiscGeometry.dispose();
      moonDiscMaterial.dispose();
      scene.remove(sun, sun.target, hemi, sky, moon, moon.target, campfire, moonDisc);
    },
  };
}
