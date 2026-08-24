import * as THREE from "three/webgpu";
import {
  color,
  float,
  fract,
  mix,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import {
  graphicsTime,
  worldNight,
  worldRain,
  worldStorm,
} from "./state.mjs";
import { createFireMaterial } from "./materials.mjs";

export const WEATHER_PRESETS = Object.freeze({
  clear: Object.freeze({ type: "clear", rain: 0, storm: 0, fog: 0.12, wetness: 0.08, wind: [0.45, 0.12] }),
  cloudy: Object.freeze({ type: "cloudy", rain: 0, storm: 0.25, fog: 0.26, wetness: 0.22, wind: [0.72, 0.2] }),
  rain: Object.freeze({ type: "rain", rain: 0.72, storm: 0.48, fog: 0.42, wetness: 0.88, wind: [1.05, 0.38] }),
  storm: Object.freeze({ type: "storm", rain: 1, storm: 1, fog: 0.62, wetness: 1, wind: [1.85, 0.74] }),
  fog: Object.freeze({ type: "fog", rain: 0.08, storm: 0.15, fog: 0.9, wetness: 0.5, wind: [0.18, 0.06] }),
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value, 0), 0, 1);
}

function weatherObject(value) {
  if (typeof value === "string") return { ...(WEATHER_PRESETS[value] ?? WEATHER_PRESETS.clear) };
  const source = value && typeof value === "object" ? value : {};
  const preset = WEATHER_PRESETS[source.type] ?? WEATHER_PRESETS.clear;
  const wind = source.wind ?? preset.wind;
  return {
    type: String(source.type ?? preset.type),
    rain: clamp01(source.rain ?? source.precipitation ?? preset.rain),
    storm: clamp01(source.storm ?? source.storminess ?? preset.storm),
    fog: clamp01(source.fog ?? source.fogDensity ?? preset.fog),
    wetness: clamp01(source.wetness ?? preset.wetness),
    wind: [
      finite(Array.isArray(wind) ? wind[0] : wind?.x, preset.wind[0]),
      finite(Array.isArray(wind) ? wind[1] : (wind?.z ?? wind?.y), preset.wind[1]),
    ],
    lightningFlash: source.lightningFlash === undefined ? null : clamp01(source.lightningFlash),
  };
}

function createSkyDome() {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Valley procedural atmosphere dome",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const horizon = smoothstep(-0.32, 0.36, positionLocal.y.div(440));
  const dayHorizon = mix(color(0xb6c4b9), color(0x7595aa), horizon);
  const nightSky = mix(color(0x161d2a), color(0x04070d), horizon);
  const stormSky = mix(color(0x4f5b5b), color(0x202a32), horizon);
  material.colorNode = mix(
    mix(dayHorizon, stormSky, worldStorm.mul(0.88)),
    nightSky,
    worldNight,
  );
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(430, 32, 18), material);
  mesh.name = "Procedural sky and storm vault";
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.userData.rtxIgnore = true;
  return mesh;
}

function createRain() {
  const count = 1200;
  const positions = new Float32Array(count * 3);
  let state = 0x7261696e;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < count; ++index) {
    positions[index * 3] = (random() * 2 - 1) * 48;
    positions[index * 3 + 1] = random() * 74 - 18;
    positions[index * 3 + 2] = (random() * 2 - 1) * 48;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsNodeMaterial({
    name: "GPU recycled rain points",
    size: 0.082,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    color: 0xa9c8d5,
  });
  const fallingY = fract(
    positionLocal.y.add(18).div(74)
      .sub(graphicsTime.mul(worldStorm.mul(0.36).add(0.45))),
  ).mul(74).sub(18);
  material.positionNode = vec3(
    positionLocal.x.add(sin(graphicsTime.add(positionLocal.y)).mul(worldStorm).mul(0.6)),
    fallingY,
    positionLocal.z,
  );
  material.opacityNode = worldRain.mul(0.74);
  const points = new THREE.Points(geometry, material);
  points.name = "Camera-following rain volume";
  points.frustumCulled = false;
  points.userData.rtxIgnore = true;
  return points;
}

function createCloudBanks() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    name: "Low storm cloud banks",
    color: 0x9aa2a0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    roughness: 1,
  });
  const count = 22;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "Instanced drifting cloud banks";
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < count; ++index) {
    const angle = index / count * Math.PI * 2;
    position.set(Math.cos(angle) * (125 + (index % 4) * 22), 76 + (index % 5) * 7, Math.sin(angle) * (125 + (index % 3) * 24));
    scale.set(23 + (index % 3) * 6, 6 + (index % 4), 13 + (index % 5) * 3);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.userData.rtxIgnore = true;
  return mesh;
}

function lightningPulse(timeSeconds) {
  const phase = ((timeSeconds + 1.7) % 19.4 + 19.4) % 19.4;
  const pulse = (center, width, strength) => Math.exp(-Math.pow((phase - center) / width, 2)) * strength;
  return Math.max(pulse(0.14, 0.032, 0.64), pulse(0.29, 0.045, 1), pulse(0.48, 0.075, 0.42));
}

/**
 * Scene-level sky, rain, cloud, fog and day/night lighting. Weather changes
 * cross-fade rather than replacing resources.
 */
export function createAtmosphere(scene, services = {}) {
  const group = new THREE.Group();
  group.name = "Reusable valley weather and atmosphere";
  const sky = createSkyDome();
  const rain = createRain();
  const clouds = createCloudBanks();
  group.add(sky, rain, clouds);

  const hemisphere = new THREE.HemisphereLight(0xbfd4df, 0x263021, 1.4);
  hemisphere.name = "Valley sky fill";
  const sun = new THREE.DirectionalLight(0xffe4bd, 2.5);
  sun.name = "Valley sun and moon key";
  sun.position.set(-95, 130, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0003;
  const lightning = new THREE.PointLight(0xc8deff, 0, 410, 1.2);
  lightning.name = "Storm lightning flash";
  lightning.position.set(-70, 125, -115);
  group.add(hemisphere, sun, lightning);

  const originalFog = scene.fog;
  if (!scene.fog || !scene.fog.isFogExp2) scene.fog = new THREE.FogExp2(0x9ba7a0, 0.0022);
  let target = weatherObject(services.weather?.snapshot?.() ?? services.weather?.state ?? "clear");
  const current = weatherObject(target);
  let lastNight = 0;

  function applyWeather(next) {
    target = weatherObject(next);
    return { ...target, wind: [...target.wind] };
  }

  function update(timeSeconds, deltaSeconds, context = {}) {
    const delta = Math.min(0.1, Math.max(0, finite(deltaSeconds, 0)));
    const response = 1 - Math.exp(-delta * 1.6);
    for (const property of ["rain", "storm", "fog", "wetness"]) {
      current[property] = THREE.MathUtils.lerp(current[property], target[property], response);
    }
    current.wind[0] = THREE.MathUtils.lerp(current.wind[0], target.wind[0], response);
    current.wind[1] = THREE.MathUtils.lerp(current.wind[1], target.wind[1], response);
    current.type = target.type;
    current.lightningFlash = target.lightningFlash;

    const camera = context.camera ?? services.camera ?? null;
    if (camera?.getWorldPosition) {
      const cameraPosition = new THREE.Vector3();
      camera.getWorldPosition(cameraPosition);
      rain.position.set(cameraPosition.x, cameraPosition.y + 12, cameraPosition.z);
      sky.position.copy(cameraPosition);
    }
    clouds.rotation.y += delta * (0.003 + Math.hypot(...current.wind) * 0.006);
    clouds.material.opacity = 0.10 + current.storm * 0.35 + current.fog * 0.12;

    const timeOfDay = ((finite(context.timeOfDay ?? services.time?.timeOfDay ?? services.time?.hour, 9) % 24) + 24) % 24;
    const daylight = THREE.MathUtils.smoothstep(Math.sin((timeOfDay - 6) / 12 * Math.PI), -0.08, 0.42);
    lastNight = 1 - daylight;
    const angle = (timeOfDay - 6) / 24 * Math.PI * 2;
    sun.position.set(Math.cos(angle) * 130, Math.max(18, Math.sin(angle) * 150), 72);
    sun.color.setHex(lastNight > 0.62 ? 0x99b9db : 0xffe4bd);
    sun.intensity = (0.28 + daylight * 2.55) * (1 - current.storm * 0.58);
    hemisphere.intensity = (0.38 + daylight * 1.15) * (1 - current.storm * 0.36);
    scene.fog.color.setHex(lastNight > 0.58 ? 0x26313d : (current.storm > 0.55 ? 0x58666a : 0x9ba7a0));
    scene.fog.density = THREE.MathUtils.lerp(0.0017, 0.0092, current.fog);

    const flash = current.storm * (current.lightningFlash ?? lightningPulse(finite(timeSeconds, 0)));
    lightning.intensity = flash * 115;
    rain.visible = current.rain > 0.015;
    return {
      ...current,
      wind: [...current.wind],
      night: lastNight,
      lightningFlash: flash,
    };
  }

  return {
    group,
    sky,
    rain,
    lights: [hemisphere, sun, lightning],
    applyWeather,
    update,
    get state() {
      return { ...current, wind: [...current.wind], night: lastNight };
    },
    dispose() {
      sky.geometry.dispose();
      sky.material.dispose();
      rain.geometry.dispose();
      rain.material.dispose();
      clouds.geometry.dispose();
      clouds.material.dispose();
      scene.fog = originalFog;
    },
  };
}

function createEmbers(intensityUniform, seed) {
  const count = 18;
  const positions = new Float32Array(count * 3);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < count; ++index) {
    const angle = random() * Math.PI * 2;
    const radius = random() * 0.8;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = random() * 4.6;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsNodeMaterial({
    name: "Reusable fire embers",
    size: 0.085,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const rising = fract(positionLocal.y.div(4.6).sub(graphicsTime.mul(0.42))).mul(4.6);
  material.positionNode = vec3(
    positionLocal.x.add(sin(graphicsTime.mul(2).add(positionLocal.y)).mul(0.16)),
    rising,
    positionLocal.z,
  );
  material.colorNode = mix(color(0xff5a22), color(0xffe2a1), smoothstep(0, 4.6, rising));
  material.opacityNode = intensityUniform.mul(float(1).sub(smoothstep(2.0, 4.6, rising)));
  const points = new THREE.Points(geometry, material);
  points.userData.rtxIgnore = true;
  return points;
}

function createFireVisual(definition, sharedGeometry, services) {
  const group = new THREE.Group();
  group.name = `Fire: ${definition.id}`;
  const position = definition.position?.isVector3
    ? definition.position.clone()
    : new THREE.Vector3(...(definition.position ?? [0, 0, 0]));
  group.position.copy(position);
  group.userData.rtxIgnore = true;
  const intensityUniform = uniform(definition.lit === false ? 0 : 1);
  const flameMaterial = createFireMaterial(intensityUniform, definition.seed ?? position.x * 0.17 + position.z * 0.11);
  const flameA = new THREE.Mesh(sharedGeometry.flame, flameMaterial);
  const flameB = new THREE.Mesh(sharedGeometry.flame, flameMaterial);
  flameA.scale.set(0.7, 1.45, 0.7);
  flameB.scale.set(0.55, 1.08, 0.55);
  flameB.rotation.y = Math.PI * 0.5;
  flameA.position.y = 0.65;
  flameB.position.y = 0.52;
  group.add(flameA, flameB);
  const embers = createEmbers(intensityUniform, definition.seed ?? 0x66697265);
  group.add(embers);

  const smokeMaterial = new THREE.MeshBasicMaterial({
    name: `Smoke: ${definition.id}`,
    color: 0x33383a,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  const smoke = [];
  for (let index = 0; index < 3; ++index) {
    const puff = new THREE.Mesh(sharedGeometry.smoke, smokeMaterial);
    puff.scale.setScalar(0.32 + index * 0.18);
    puff.userData.phase = index / 3;
    group.add(puff);
    smoke.push(puff);
  }
  const light = definition.light === false
    ? null
    : new THREE.PointLight(definition.color ?? 0xff8b38, 0, definition.radius ?? 18, 1.65);
  if (light) {
    light.name = `${definition.id} warm fire light`;
    light.position.y = 1.25;
    light.castShadow = Boolean(definition.castShadow);
    group.add(light);
  }

  let requestedLit = definition.lit !== false;
  let visualIntensity = requestedLit ? 1 : 0;
  const record = {
    id: String(definition.id),
    kind: definition.kind ?? "fire",
    position,
    group,
    light,
    protectedFromRain: Boolean(definition.protectedFromRain),
    get lit() {
      return requestedLit;
    },
    get intensity() {
      return visualIntensity;
    },
    setLit(lit, reason = "world") {
      const next = Boolean(lit);
      if (next === requestedLit) return requestedLit;
      requestedLit = next;
      services.onWorldEvent?.("fire-changed", { id: record.id, lit: next, reason });
      return requestedLit;
    },
    update(timeSeconds, deltaSeconds, weather) {
      const rainSuppression = record.protectedFromRain ? 1 : THREE.MathUtils.lerp(1, 0.08, clamp01(weather.rain));
      const targetIntensity = requestedLit ? rainSuppression : 0;
      visualIntensity = THREE.MathUtils.damp(visualIntensity, targetIntensity, 6, Math.max(0, deltaSeconds));
      intensityUniform.value = visualIntensity;
      group.visible = visualIntensity > 0.006;
      if (light) {
        const flicker = 0.86 + Math.sin(timeSeconds * 12.7 + position.x) * 0.09 + Math.sin(timeSeconds * 21.4 + position.z) * 0.05;
        light.intensity = visualIntensity * finite(definition.intensity, 8) * flicker;
      }
      smokeMaterial.opacity = visualIntensity * (0.055 + (1 - clamp01(weather.rain)) * 0.08);
      for (let index = 0; index < smoke.length; ++index) {
        const puff = smoke[index];
        const phase = (timeSeconds * 0.13 + puff.userData.phase) % 1;
        puff.position.set(
          Math.sin(timeSeconds * 0.7 + index) * phase * 0.45,
          1.2 + phase * 5.4,
          Math.cos(timeSeconds * 0.61 + index) * phase * 0.3,
        );
        puff.scale.setScalar((0.28 + phase * 1.4) * visualIntensity);
      }
    },
    dispose() {
      flameMaterial.dispose();
      embers.geometry.dispose();
      embers.material.dispose();
      smokeMaterial.dispose();
    },
  };
  return record;
}

/**
 * A small pooled fire renderer. Definitions are data-only and resulting fire
 * records expose `setLit`, making them easy to bind to the gameplay FireSystem.
 */
export function createFireVisuals(definitions = [], services = {}) {
  const group = new THREE.Group();
  group.name = "Reusable village, camp and beacon fires";
  const sharedGeometry = {
    flame: new THREE.SphereGeometry(0.62, 8, 10),
    smoke: new THREE.DodecahedronGeometry(0.8, 0),
  };
  const fires = definitions.map((definition) => createFireVisual(definition, sharedGeometry, services));
  for (const fire of fires) group.add(fire.group);
  return {
    group,
    fires,
    lights: fires.map((fire) => fire.light).filter(Boolean),
    get(id) {
      return fires.find((fire) => fire.id === id) ?? null;
    },
    update(timeSeconds, deltaSeconds, weather) {
      for (const fire of fires) {
        const serviceKnowsFire = typeof services.fire?.has === "function"
          ? services.fire.has(fire.id)
          : typeof services.fire?.isLit === "function";
        const external = serviceKnowsFire ? services.fire?.isLit?.(fire.id) : undefined;
        if (typeof external === "boolean" && external !== fire.lit) fire.setLit(external, "fire-service");
        fire.update(timeSeconds, deltaSeconds, weather);
      }
    },
    dispose() {
      for (const fire of fires) fire.dispose();
      sharedGeometry.flame.dispose();
      sharedGeometry.smoke.dispose();
    },
  };
}
