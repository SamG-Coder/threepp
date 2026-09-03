import * as THREE from "three/webgpu";
import { moonShadeDir } from "./materials.mjs";

/** One real second advances one game minute. A full day lasts 24 real minutes. */
export const GAME_MINUTES_PER_REAL_SECOND = 1;
export const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_START_HOUR = 16.5;

const SUN_DISTANCE = 140;
const MOON_DISTANCE = 720;
const STAR_RADIUS = 520;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function directionFromHour(hours, radius) {
  const wrapped = ((hours % 24) + 24) % 24;
  const elevation = Math.sin((wrapped - 6) / 24 * Math.PI * 2) * 1.32;
  const azimuth = Math.PI * 0.5 - (wrapped - 6) / 24 * Math.PI * 2;
  const cosE = Math.cos(elevation);
  return {
    x: cosE * Math.sin(azimuth) * radius,
    y: Math.sin(elevation) * radius,
    z: cosE * Math.cos(azimuth) * radius,
    elevation,
    azimuth,
  };
}

export function sampleSkyCycle(hours) {
  const wrapped = ((hours % 24) + 24) % 24;
  const sun = directionFromHour(wrapped, 1);
  const moon = directionFromHour(wrapped + 13.15, 1);
  const sunHeight = clamp01((sun.elevation + 0.04) / 1.28);
  const moonHeight = clamp01((moon.elevation + 0.02) / 1.2);
  const day = smoothstep(-0.06, 0.22, sun.elevation);
  const night = 1 - smoothstep(-0.02, 0.18, sun.elevation);
  const twilight = smoothstep(-0.18, 0.02, sun.elevation)
    * (1 - smoothstep(0.08, 0.34, sun.elevation));
  const sunrise = twilight * (wrapped < 12 ? 1 : 0.15);
  const sunset = twilight * (wrapped >= 12 ? 1 : 0.15);

  const zenith = [
    lerp(0.016, 0.23, day) + sunrise * 0.16 + sunset * 0.12,
    lerp(0.028, 0.52, day) + sunrise * 0.06,
    lerp(0.07, 0.86, day) + sunrise * 0.08,
  ];
  const horizon = [
    lerp(0.03, 0.78, day) + sunrise * 0.45 + sunset * 0.65,
    lerp(0.045, 0.86, day) + sunrise * 0.18 + sunset * 0.16,
    lerp(0.08, 0.94, day) + sunrise * 0.04,
  ];

  const sunColor = [
    lerp(1.0, 1.0, day) * (0.72 + sunset * 0.28 + sunrise * 0.2),
    lerp(0.55, 0.88, day) * (0.65 + (1 - sunset) * 0.35),
    lerp(0.28, 0.72, day) * (0.45 + (1 - sunset) * 0.55),
  ];
  const moonColor = [0.72, 0.8, 0.92];
  const fogColor = [
    lerp(0.04, 0.62, day) + sunset * 0.28 + sunrise * 0.18,
    lerp(0.05, 0.75, day) + sunset * 0.08,
    lerp(0.08, 0.86, day),
  ];
  const hemiSky = [
    lerp(0.08, 0.77, day) + sunset * 0.2,
    lerp(0.1, 0.87, day),
    lerp(0.16, 0.96, day),
  ];
  const hemiGround = [
    lerp(0.04, 0.69, day),
    lerp(0.035, 0.54, day),
    lerp(0.03, 0.35, day),
  ];

  const sunIntensity = 4.4 * Math.pow(sunHeight, 1.15);
  const moonIntensity = 0.42 * moonHeight * (0.35 + night * 0.65);
  const hemiIntensity = lerp(0.12, 1.35, day);
  const bounceIntensity = lerp(0.03, 0.28, day);
  const envIntensity = lerp(0.04, 0.62, day);
  const exposure = lerp(0.82, 1.12, day);
  const shadowStrength = lerp(0.06, 0.26, day);
  const rtxSunIntensity = sunIntensity > 0.35 ? sunIntensity * 0.77 : moonIntensity * 2.4;
  const keyIsSun = sun.elevation > 0.04;

  return {
    hours: wrapped,
    day,
    night,
    twilight,
    sunrise,
    sunset,
    sun: {
      x: sun.x,
      y: sun.y,
      z: sun.z,
      elevation: sun.elevation,
      intensity: sunIntensity,
      color: sunColor,
    },
    moon: {
      x: moon.x,
      y: moon.y,
      z: moon.z,
      elevation: moon.elevation,
      intensity: moonIntensity,
      color: moonColor,
    },
    zenith,
    horizon,
    fogColor,
    hemiSky,
    hemiGround,
    hemiIntensity,
    bounceIntensity,
    envIntensity,
    exposure,
    shadowStrength,
    rtxSunIntensity,
    keyIsSun,
    starVisibility: night * night,
  };
}

export function createSkyClock(startHour = DEFAULT_START_HOUR) {
  let minutes = (((Number(startHour) || 0) * 60) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let lastLoggedHour = -1;

  return {
    get minutes() {
      return minutes;
    },
    get hours() {
      return minutes / 60;
    },
    advance(realSeconds) {
      const delta = Math.max(0, Number(realSeconds) || 0) * GAME_MINUTES_PER_REAL_SECOND;
      minutes = (minutes + delta) % MINUTES_PER_DAY;
      const hour = Math.floor(this.hours);
      if (hour !== lastLoggedHour) {
        lastLoggedHour = hour;
        const minute = Math.floor(minutes % 60);
        console.log(
          `[First-Person Beach] ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        );
      }
      return sampleSkyCycle(this.hours);
    },
  };
}

export function applySkyCycle(sample, {
  sun,
  moonLight,
  hemi,
  bounce,
  moon,
  stars,
  camera,
  scene,
  renderer,
} = {}) {
  const origin = sun?.target?.position ?? new THREE.Vector3(0, 0, 4);
  if (sun) {
    sun.position.set(
      origin.x + sample.sun.x * SUN_DISTANCE,
      origin.y + sample.sun.y * SUN_DISTANCE,
      origin.z + sample.sun.z * SUN_DISTANCE,
    );
    sun.color.setRGB(sample.sun.color[0], sample.sun.color[1], sample.sun.color[2]);
    sun.intensity = sample.sun.intensity;
    // Keep the shadow render graph stable across sunrise and sunset. Toggling
    // castShadow here destroys/recreates WebGPU shadow attachments while an
    // offscreen MRT frame is active and can leave ShadowNode without a depth
    // texture. The smoothly fading light intensity already disables its visual
    // contribution below the horizon.
    sun.castShadow = true;
  }
  if (moonLight) {
    moonLight.position.set(
      origin.x + sample.moon.x * SUN_DISTANCE,
      origin.y + sample.moon.y * SUN_DISTANCE,
      origin.z + sample.moon.z * SUN_DISTANCE,
    );
    moonLight.color.setRGB(sample.moon.color[0], sample.moon.color[1], sample.moon.color[2]);
    moonLight.intensity = sample.moon.intensity;
  }
  if (hemi) {
    hemi.color.setRGB(sample.hemiSky[0], sample.hemiSky[1], sample.hemiSky[2]);
    hemi.groundColor.setRGB(sample.hemiGround[0], sample.hemiGround[1], sample.hemiGround[2]);
    hemi.intensity = sample.hemiIntensity;
  }
  if (bounce) bounce.intensity = sample.bounceIntensity;
  if (camera && moon) {
    moon.position.set(
      camera.position.x + sample.moon.x * MOON_DISTANCE,
      camera.position.y + sample.moon.y * MOON_DISTANCE,
      camera.position.z + sample.moon.z * MOON_DISTANCE,
    );
    moon.lookAt(camera.position);
    // Keep the moon shader warm; its world position naturally moves it below
    // the horizon instead of lazily compiling it during the transition.
    moon.visible = true;
    if (sun) {
      moonShadeDir.value.copy(sun.position).sub(moon.position).normalize();
    }
  }
  if (camera && stars) {
    stars.position.copy(camera.position);
    // opacityNode performs the daylight fade. Persistent visibility prevents
    // the star shader from compiling on the first twilight frame.
    stars.visible = true;
  }
  if (scene?.fog?.color) {
    scene.fog.color.setRGB(sample.fogColor[0], sample.fogColor[1], sample.fogColor[2]);
    scene.fog.density = lerp(0.011, 0.0088, sample.day);
  }
  if (scene?.background?.isColor) {
    scene.background.setRGB(sample.horizon[0], sample.horizon[1], sample.horizon[2]);
  }
  if (scene) scene.environmentIntensity = sample.envIntensity;
  if (renderer) renderer.toneMappingExposure = sample.exposure;
  return sample;
}

export function createStarField(THREERef = THREE) {
  const random = (function mulberry(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }(0x51a75bee));
  const positions = [];
  const colors = [];
  for (let i = 0; i < 2200; i += 1) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.08 + random() ** 0.65 * 0.92;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const radius = STAR_RADIUS + random() * 40;
    positions.push(
      Math.cos(azimuth) * horizontal * radius,
      elevation * radius,
      Math.sin(azimuth) * horizontal * radius,
    );
    const temperature = random();
    const intensity = 0.12 + random() ** 8 * 0.88;
    colors.push(
      intensity * (0.72 + temperature * 0.28),
      intensity * (0.82 + temperature * 0.16),
      intensity,
    );
  }
  const geometry = new THREERef.BufferGeometry();
  geometry.setAttribute("position", new THREERef.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREERef.Float32BufferAttribute(colors, 3));
  const material = new THREERef.PointsNodeMaterial({
    size: 1.35,
    sizeAttenuation: false,
    transparent: true,
    opacity: 1,
    vertexColors: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREERef.AdditiveBlending,
  });
  material.toneMapped = false;
  const stars = new THREERef.Points(geometry, material);
  stars.name = "Night stars";
  stars.frustumCulled = false;
  stars.renderOrder = -900;
  stars.userData.rtxIgnore = true;
  return stars;
}

export function createMoonGlobe(THREERef, material) {
  const moon = new THREERef.Mesh(
    new THREERef.SphereGeometry(9.2, 64, 48),
    material,
  );
  moon.name = "Textured moon";
  moon.userData.rtxIgnore = true;
  moon.renderOrder = -800;
  moon.frustumCulled = false;
  moon.castShadow = false;
  moon.receiveShadow = false;
  return moon;
}
