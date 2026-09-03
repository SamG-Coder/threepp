import * as THREE from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  cameraPosition,
  cos,
  dot,
  exp,
  float,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { createSurfaceWaterSystem } from "./surface-water.mjs";
import { WATER_LEVEL, terrainHeight } from "./terrain.mjs";

// World units are metres. Keep the tropical low-cloud deck well above every
// prop and terrain feature instead of letting it read as ground fog.
const CLOUD_BASE = 650;
const CLOUD_TOP = 950;
const CLOUD_SPAN_Y = CLOUD_TOP - CLOUD_BASE;
const CLOUD_SHELL_RADIUS = 3900;
const CLOUD_VIEW_STEPS = 48;
const CLOUD_MAX_DISTANCE = 3800;
const RAIN_COUNT = 1800;
const RAIN_RADIUS_X = 92;
const RAIN_RADIUS_Z = 118;

export const weatherTime = uniform(0);
export const stormAmount = uniform(0);
export const cloudWind = uniform(new THREE.Vector2(12, 3.5));
export const cloudDaylight = uniform(1);
export const cloudKeyDirection = uniform(new THREE.Vector3(0.2, 0.8, 0.5).normalize());
export const cloudKeyColor = uniform(new THREE.Color(1, 0.9, 0.72));
export const cloudKeyStrength = uniform(1);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstepNumber(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Slow autonomous weather cycle. It starts stormy so rain is visible immediately. */
export function stormEnvelope(seconds) {
  const carrier = 0.5 + 0.5 * Math.sin(seconds * 0.018 + 1.2);
  const variation = 0.5 + 0.5 * Math.sin(seconds * 0.0061 + 0.35);
  return smoothstepNumber(0.24, 0.78, carrier * 0.78 + variation * 0.22);
}

/**
 * World-space storm cell shared by cloud rendering and CPU rain emission.
 * The waves deliberately match cloudFieldNode() below.
 */
export function cloudCellDensity(x, z, seconds) {
  const px = x + seconds * 12;
  const pz = z + seconds * 3.5;
  const a = 0.5 + 0.5 * Math.sin(px * 0.0011 + Math.sin(pz * 0.0007) * 1.4);
  const b = 0.5 + 0.5 * Math.cos(pz * 0.0014 - px * 0.00065);
  const c = 0.5 + 0.5 * Math.sin((px + pz) * 0.00048 + seconds * 0.015);
  return clamp01(a * 0.48 + b * 0.32 + c * 0.2);
}

export function rainPotentialAt(x, z, seconds, storm = stormEnvelope(seconds)) {
  const field = cloudCellDensity(x, z, seconds);
  const coverage = smoothstepNumber(0.46 - storm * 0.12, 0.75, field);
  return clamp01(coverage * smoothstepNumber(0.34, 0.7, storm));
}

function cloudFieldNode(point) {
  const advected = point.xz.add(cloudWind.mul(weatherTime));
  const a = sin(advected.x.mul(0.0011).add(sin(advected.y.mul(0.0007)).mul(1.4)))
    .mul(0.5).add(0.5);
  const b = cos(advected.y.mul(0.0014).sub(advected.x.mul(0.00065)))
    .mul(0.5).add(0.5);
  const c = sin(
    advected.x.add(advected.y).mul(0.00048).add(weatherTime.mul(0.015)),
  ).mul(0.5).add(0.5);
  return a.mul(0.48).add(b.mul(0.32)).add(c.mul(0.2));
}

function cloudDensityNode(point) {
  const wind = cloudWind.mul(weatherTime);
  const deckHeight = point.y.sub(CLOUD_BASE);
  const advected = vec3(
    point.x.add(wind.x),
    deckHeight,
    point.z.add(wind.y),
  );
  const broad = cloudFieldNode(point);

  // True 3D coherent noise replaces the stacked sine sheets used by the old
  // finite box. A coarse body plus a higher-frequency erosion octave produces
  // kilometre-scale banks with soft, irregular cauliflower edges.
  const coarseCoord = advected.mul(vec3(0.00105, 0.0021, 0.00105));
  const coarse = mx_noise_float(coarseCoord).mul(0.5).add(0.5);
  const erosion = mx_noise_float(
    coarseCoord.mul(3.17).add(vec3(7.3, -2.1, 11.7)),
  ).mul(0.5).add(0.5);
  const shape = coarse.mul(0.72).add(broad.mul(0.4)).sub(erosion.mul(0.16));

  const height = point.y.sub(CLOUD_BASE).div(CLOUD_SPAN_Y);
  const flatRainBase = smoothstep(0, 0.075, height);
  const softTops = float(1).sub(smoothstep(0.52, 1, height));
  const anvil = float(1).sub(smoothstep(0.76, 1, height))
    .mul(mix(0.76, 1, stormAmount));
  const verticalProfile = flatRainBase.mul(softTops).mul(anvil);
  const threshold = float(0.49).sub(stormAmount.mul(0.14));
  const body = smoothstep(threshold, threshold.add(0.16), shape);
  const wispyErosion = smoothstep(0.12, 0.88, erosion.add(body.mul(0.7)));

  return body
    .mul(wispyErosion)
    .mul(verticalProfile)
    .mul(mix(0.68, 1.38, stormAmount));
}

/**
 * Low-cost spatial transmittance for surface materials. Project the receiving
 * world point into the cloud deck along the current key-light direction, then
 * sample the same advected regional weather map used by cloud density and rain.
 */
export function cloudShadowNode(point) {
  const shadowHeight = float(CLOUD_BASE + CLOUD_SPAN_Y * 0.34);
  const travel = shadowHeight.sub(point.y).max(0)
    .div(cloudKeyDirection.y.max(0.08));
  const projected = point.add(cloudKeyDirection.mul(travel));
  const regional = cloudFieldNode(projected);
  const softDetail = mx_noise_float(vec3(
    projected.x.mul(0.00135).add(weatherTime.mul(0.016)),
    3.7,
    projected.z.mul(0.00135).add(weatherTime.mul(0.0045)),
  )).mul(0.5).add(0.5);
  const structure = regional.mul(0.76).add(softDetail.mul(0.24));
  const coverage = smoothstep(
    float(0.51).sub(stormAmount.mul(0.13)),
    0.72,
    structure,
  );
  const daylightStrength = mix(0.16, 1, cloudDaylight);
  return coverage.mul(stormAmount).mul(daylightStrength).saturate();
}

function createCloudVolume() {
  const cloudRaymarch = Fn(() => {
    const ray = normalize(positionWorld.sub(cameraPosition));
    const safeUp = ray.y.max(0.001);
    const entry = float(CLOUD_BASE).sub(cameraPosition.y).div(safeUp).max(0);
    const exit = float(CLOUD_TOP).sub(cameraPosition.y).div(safeUp)
      .max(0).min(CLOUD_MAX_DISTANCE);
    const segmentLength = exit.sub(entry).max(0).mul(step(0.001, ray.y));
    const stepLength = segmentLength.div(CLOUD_VIEW_STEPS);
    const finalColor = vec4(0).toVar();
    Loop(CLOUD_VIEW_STEPS, ({ i }) => {
      const distance = entry.add(float(i).add(0.5).mul(stepLength));
      const point = cameraPosition.add(ray.mul(distance));
      const density = cloudDensityNode(point);
      const sampleAlpha = float(1).sub(exp(density.mul(stepLength).mul(-0.0065)));

      // A forward density probe approximates Beer-Lambert self-shadowing.
      // It creates dark rain-bearing cores while sun-facing edges stay bright.
      const lightProbe = cloudDensityNode(point.add(cloudKeyDirection.mul(16)));
      const lightTransmission = exp(lightProbe.mul(-2.8));
      const phase = pow(saturate(dot(ray.negate(), cloudKeyDirection)), 10);
      const edge = pow(float(1).sub(saturate(density)), 2);
      const ambient = mix(
        vec3(0.055, 0.075, 0.12),
        vec3(0.46, 0.54, 0.63),
        cloudDaylight,
      );
      const direct = cloudKeyColor
        .mul(cloudKeyStrength)
        .mul(lightTransmission.mul(0.82).add(0.12));
      const silverLining = cloudKeyColor
        .mul(phase)
        .mul(edge)
        .mul(cloudKeyStrength)
        .mul(1.75);
      const stormCore = mix(vec3(1), vec3(0.48, 0.55, 0.64), stormAmount.mul(0.72));
      const cloudColor = ambient.add(direct).add(silverLining).mul(stormCore);
      const remaining = finalColor.a.oneMinus();
      finalColor.rgb.addAssign(remaining.mul(sampleAlpha).mul(cloudColor));
      finalColor.a.addAssign(remaining.mul(sampleAlpha));
      If(finalColor.a.greaterThanEqual(0.96), () => {
        Break();
      });
    });
    return finalColor;
  });

  // The ray march returns pre-multiplied RGB and accumulated alpha as one
  // final fragment. A bare NodeMaterial preserves that vec4 output exactly.
  const material = new THREE.NodeMaterial();
  material.colorNode = cloudRaymarch();
  material.side = THREE.BackSide;
  material.transparent = true;
  material.depthWrite = false;
  // The box's back faces are behind normal scene geometry. Depth testing them
  // keeps the accumulated cloud colour behind palms, rocks and terrain while
  // retaining the pre-multiplied ray-marched result.
  material.depthTest = true;
  material.fog = false;

  const volume = new THREE.Mesh(
    new THREE.SphereGeometry(CLOUD_SHELL_RADIUS, 48, 24),
    material,
  );
  volume.name = "Atmospheric-shell coastal storm clouds";
  volume.renderOrder = -850;
  volume.frustumCulled = false;
  volume.userData.rtxIgnore = true;
  return volume;
}

function createRain(random) {
  const positions = new Float32Array(RAIN_COUNT * 2 * 3);
  const drops = Array.from({ length: RAIN_COUNT }, () => ({
    active: false,
    x: 0,
    y: -1000,
    z: 0,
    speed: 24 + random() * 19,
    length: 0.42 + random() * 0.92,
    drift: -0.7 + random() * 0.45,
  }));
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  const material = new THREE.LineBasicMaterial({
    color: 0xa9d0e5,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "Cloud-sourced rain streaks";
  lines.frustumCulled = false;
  lines.renderOrder = 30;
  lines.userData.rtxIgnore = true;
  return { lines, positions, attribute, drops, material };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBeachWeather(scene, camera, world) {
  const random = mulberry32(0xc10d5eed);
  const clouds = createCloudVolume();
  const rain = createRain(random);
  scene.add(clouds, rain.lines);
  const surfaceWater = createSurfaceWaterSystem(scene, world, random);

  let elapsed = 0;
  let cursor = 0;

  function respawn(drop) {
    let x = camera.position.x;
    let z = camera.position.z;
    let potential = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      x = camera.position.x + (random() * 2 - 1) * RAIN_RADIUS_X;
      z = camera.position.z + (random() * 2 - 1) * RAIN_RADIUS_Z;
      potential = rainPotentialAt(x, z, elapsed, stormAmount.value);
      if (random() < potential) break;
    }
    drop.x = x;
    drop.z = z;
    drop.active = potential > 0.12;
    drop.y = drop.active ? CLOUD_BASE + 2 + random() * 18 : -1000;
    drop.speed = 24 + random() * 19;
    drop.length = 0.42 + random() * 0.92;
    drop.drift = -0.7 + random() * 0.45;
  }

  for (const drop of rain.drops) respawn(drop);

  return {
    clouds,
    rain: rain.lines,
    surfaceWater,
    get storm() {
      return stormAmount.value;
    },
    update(dt, sky, world) {
      elapsed += Math.max(0, Math.min(0.05, Number(dt) || 0));
      weatherTime.value = elapsed;
      // The shell is only a depth-aware screen surface. Density is evaluated
      // from cameraPosition along an analytic world-space cloud-layer segment,
      // so there are no box walls, seams, or camera-relative cloud motion.
      clouds.position.copy(camera.position);
      const storm = stormEnvelope(elapsed);
      stormAmount.value = storm;
      cloudDaylight.value = sky?.day ?? 1;
      const key = sky?.keyIsSun ? sky.sun : sky?.moon;
      if (key) {
        cloudKeyDirection.value.set(key.x, key.y, key.z).normalize();
        cloudKeyColor.value.setRGB(key.color[0], key.color[1], key.color[2]);
        cloudKeyStrength.value = sky.keyIsSun
          ? 0.3 + clamp01(key.intensity / 4.4) * 0.95
          : 0.08 + clamp01(key.intensity / 0.42) * 0.24;
      }
      const localRain = rainPotentialAt(camera.position.x, camera.position.z, elapsed, storm);

      // Keep enough drops cycling each frame without a bursty full-field reset.
      const refreshes = Math.max(4, Math.round(18 + localRain * 46));
      for (let i = 0; i < rain.drops.length; i += 1) {
        const drop = rain.drops[i];
        const index = i * 6;
        if (!drop.active) {
          rain.positions[index] = rain.positions[index + 3] = camera.position.x;
          rain.positions[index + 1] = rain.positions[index + 4] = -1000;
          rain.positions[index + 2] = rain.positions[index + 5] = camera.position.z;
          continue;
        }
        const previousY = drop.y;
        drop.y -= drop.speed * dt;
        drop.x += drop.drift * dt;
        drop.z += 0.82 * dt;
        const ground = terrainHeight(drop.x, drop.z);
        const objectHit = surfaceWater.findObjectImpact(drop.x, drop.z, previousY, drop.y);
        const overWater = ground < WATER_LEVEL - 0.025;
        const surfaceY = overWater ? WATER_LEVEL : ground;
        if (objectHit) {
          surfaceWater.impact({ ...objectHit, intensity: drop.speed / 34 });
          respawn(drop);
        } else if (drop.y < surfaceY) {
          surfaceWater.impact({
            x: drop.x,
            y: surfaceY + 0.025,
            z: drop.z,
            kind: overWater ? "water" : "terrain",
            intensity: drop.speed / 34,
          });
          respawn(drop);
        } else if (Math.abs(drop.x - camera.position.x) > RAIN_RADIUS_X * 1.15
          || Math.abs(drop.z - camera.position.z) > RAIN_RADIUS_Z * 1.15) {
          respawn(drop);
        }
        rain.positions[index] = drop.x;
        rain.positions[index + 1] = drop.y;
        rain.positions[index + 2] = drop.z;
        rain.positions[index + 3] = drop.x - 0.045;
        rain.positions[index + 4] = drop.y + drop.length;
        rain.positions[index + 5] = drop.z - 0.018;
      }
      for (let i = 0; i < refreshes; i += 1) {
        cursor = (cursor + 97) % rain.drops.length;
        if (!rain.drops[cursor].active) respawn(rain.drops[cursor]);
      }
      rain.attribute.needsUpdate = true;
      rain.material.opacity = 0.08 + localRain * 0.62;
      rain.lines.visible = localRain > 0.025 || storm > 0.38;
      surfaceWater.update(dt);

      // Weather acts on the lighting after the day/night cycle has established
      // its physically meaningful baseline.
      // Spatial shadows are evaluated per surface by cloudShadowNode(). This
      // residual term represents only broad atmospheric loss above the scene.
      const cloudShadow = clamp01(storm * 0.12);
      if (world?.sun) world.sun.intensity *= 1 - cloudShadow * 0.62;
      if (world?.moonLight) world.moonLight.intensity *= 1 - cloudShadow * 0.3;
      if (world?.lights?.hemi) world.lights.hemi.intensity *= 1 - cloudShadow * 0.34;
      if (world?.lights?.bounce) world.lights.bounce.intensity *= 1 - cloudShadow * 0.46;
      scene.environmentIntensity = Math.max(0.08, (0.18 + (sky?.day ?? 1) * 0.44) * (1 - cloudShadow * 0.48));
      if (scene.fog?.isFogExp2) scene.fog.density = 0.0088 + localRain * 0.0075;
      return { storm, localRain, cloudShadow };
    },
    dispose() {
      scene.remove(clouds, rain.lines);
      clouds.geometry.dispose();
      clouds.material.dispose();
      rain.lines.geometry.dispose();
      rain.material.dispose();
      surfaceWater.dispose();
    },
  };
}
