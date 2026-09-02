import * as THREE from "three/webgpu";
import {
  Break,
  Fn,
  If,
  cameraPosition,
  cos,
  dot,
  exp,
  float,
  mix,
  normalize,
  pow,
  saturate,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { RaymarchingBox } from "three/addons/tsl/utils/Raymarching.js";
import { terrainHeight } from "./terrain.mjs";

const CLOUD_BASE = 140;
const CLOUD_TOP = 260;
const CLOUD_CENTRE_Y = (CLOUD_BASE + CLOUD_TOP) * 0.5;
const CLOUD_SPAN_Y = CLOUD_TOP - CLOUD_BASE;
const RAIN_COUNT = 1800;
const RAIN_RADIUS_X = 92;
const RAIN_RADIUS_Z = 118;

export const weatherTime = uniform(0);
export const stormAmount = uniform(0);
export const cloudWind = uniform(new THREE.Vector2(3.2, 0.82));
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
  const px = x + seconds * 3.2;
  const pz = z + seconds * 0.82;
  const a = 0.5 + 0.5 * Math.sin(px * 0.019 + Math.sin(pz * 0.013) * 1.4);
  const b = 0.5 + 0.5 * Math.cos(pz * 0.023 - px * 0.011);
  const c = 0.5 + 0.5 * Math.sin((px + pz) * 0.008 + seconds * 0.07);
  return clamp01(a * 0.48 + b * 0.32 + c * 0.2);
}

export function rainPotentialAt(x, z, seconds, storm = stormEnvelope(seconds)) {
  const field = cloudCellDensity(x, z, seconds);
  const coverage = smoothstepNumber(0.46 - storm * 0.12, 0.75, field);
  return clamp01(coverage * smoothstepNumber(0.34, 0.7, storm));
}

function cloudFieldNode(point) {
  const advected = point.xz.add(cloudWind.mul(weatherTime));
  const a = sin(advected.x.mul(0.019).add(sin(advected.y.mul(0.013)).mul(1.4)))
    .mul(0.5).add(0.5);
  const b = cos(advected.y.mul(0.023).sub(advected.x.mul(0.011)))
    .mul(0.5).add(0.5);
  const c = sin(
    advected.x.add(advected.y).mul(0.008).add(weatherTime.mul(0.07)),
  ).mul(0.5).add(0.5);
  return a.mul(0.48).add(b.mul(0.32)).add(c.mul(0.2));
}

function cloudDensityNode(point) {
  const wind = cloudWind.mul(weatherTime);
  const advected = vec3(point.x.add(wind.x), point.y, point.z.add(wind.y));
  const broad = cloudFieldNode(point);

  // Differently oriented 3D waves create changing cauliflower-scale lobes
  // instead of extruding a flat weather map through the whole cloud layer.
  const lobeA = sin(
    advected.x.mul(0.033)
      .add(advected.y.mul(0.057))
      .add(sin(advected.z.mul(0.027)).mul(1.8)),
  ).mul(0.5).add(0.5);
  const lobeB = cos(
    advected.z.mul(0.052)
      .sub(advected.y.mul(0.071))
      .add(sin(advected.x.mul(0.041)).mul(1.35)),
  ).mul(0.5).add(0.5);
  const erosion = sin(
    advected.x.add(advected.z).mul(0.113)
      .add(advected.y.mul(0.137))
      .sub(weatherTime.mul(0.16)),
  ).mul(0.5).add(0.5);
  const shape = broad.mul(0.55)
    .add(lobeA.mul(0.24))
    .add(lobeB.mul(0.15))
    .add(erosion.mul(0.06));

  const height = point.y.sub(CLOUD_BASE).div(CLOUD_SPAN_Y);
  const flatRainBase = smoothstep(0, 0.075, height);
  const softTops = float(1).sub(smoothstep(0.52, 1, height));
  const anvil = float(1).sub(smoothstep(0.76, 1, height))
    .mul(mix(0.76, 1, stormAmount));
  const verticalProfile = flatRainBase.mul(softTops).mul(anvil);
  const threshold = float(0.47)
    .sub(stormAmount.mul(0.13))
    .add(height.mul(0.055));
  const body = smoothstep(threshold, 0.75, shape);
  const wispyErosion = smoothstep(0.08, 0.82, erosion.add(body.mul(0.64)));

  return body
    .mul(wispyErosion)
    .mul(verticalProfile)
    .mul(mix(0.68, 1.38, stormAmount));
}

function createCloudVolume() {
  const cloudRaymarch = Fn(() => {
    const finalColor = vec4(0).toVar();
    RaymarchingBox(32, ({ positionRay }) => {
      // RaymarchingBox works in the mesh's unit-box coordinates. Reconstruct
      // the same absolute world field sampled by rainPotentialAt().
      const point = vec3(
        positionRay.x.mul(760),
        positionRay.y.mul(CLOUD_SPAN_Y).add(CLOUD_CENTRE_Y),
        positionRay.z.mul(760).add(54),
      );
      const density = cloudDensityNode(point);
      const sampleAlpha = density.mul(0.105);

      // A forward density probe approximates Beer-Lambert self-shadowing.
      // It creates dark rain-bearing cores while sun-facing edges stay bright.
      const lightProbe = cloudDensityNode(point.add(cloudKeyDirection.mul(16)));
      const lightTransmission = exp(lightProbe.mul(-2.8));
      const viewToCamera = normalize(cameraPosition.sub(point));
      const phase = pow(saturate(dot(viewToCamera, cloudKeyDirection)), 10);
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
  material.depthTest = false;
  material.fog = false;

  const volume = new THREE.Mesh(
    // RaymarchingBox intersects the canonical local cube [-0.5, 0.5]. Keep
    // that geometry canonical and put the world dimensions on the object's
    // transform so modelWorldMatrixInverse maps the camera into the same box.
    new THREE.BoxGeometry(1, 1, 1),
    material,
  );
  volume.name = "Ray-marched coastal storm clouds";
  volume.position.set(0, CLOUD_CENTRE_Y, 54);
  volume.scale.set(760, CLOUD_SPAN_Y, 760);
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

export function createBeachWeather(scene, camera) {
  const random = mulberry32(0xc10d5eed);
  const clouds = createCloudVolume();
  const rain = createRain(random);
  scene.add(clouds, rain.lines);

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
    get storm() {
      return stormAmount.value;
    },
    update(dt, sky, world) {
      elapsed += Math.max(0, Math.min(0.05, Number(dt) || 0));
      weatherTime.value = elapsed;
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
        drop.y -= drop.speed * dt;
        drop.x += drop.drift * dt;
        drop.z += 0.82 * dt;
        const ground = terrainHeight(drop.x, drop.z);
        if (drop.y < ground || Math.abs(drop.x - camera.position.x) > RAIN_RADIUS_X * 1.15
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

      // Weather acts on the lighting after the day/night cycle has established
      // its physically meaningful baseline.
      const cloudShadow = clamp01(localRain * 0.68 + storm * 0.22);
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
    },
  };
}
