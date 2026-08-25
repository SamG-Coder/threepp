import * as THREE from "three/webgpu";

const TAU = Math.PI * 2;
const DEFAULT_SEED = 0x5241494e;
const SKY_DAY_COLOR = new THREE.Color(0x3d7da7);
const SKY_SUNSET_COLOR = new THREE.Color(0xa45242);
const FOG_DAY_COLOR = new THREE.Color(0x91a7b6);
const FOG_SUNSET_COLOR = new THREE.Color(0xb06452);
const FOG_RAIN_COLOR = new THREE.Color(0x223746);
const SUN_DAY_COLOR = new THREE.Color(0xfff2d2);
const SUN_SUNSET_COLOR = new THREE.Color(0xffa665);
const SUN_RAIN_COLOR = new THREE.Color(0xb2c7d5);
const SKY_HORIZON_WARM_COLOR = new THREE.Color(0xe07455);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function wrap(value, maximum) {
  return ((value % maximum) + maximum) % maximum;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatClock(hours) {
  const totalMinutes = Math.floor(wrap(Number(hours) || 0, 24) * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function createSolarState() {
  return {
    time: 0,
    elevation: 0,
    azimuth: 0,
    daylight: 0,
    sunStrength: 0,
    civilTwilight: 0,
    night: 0,
    streetlight: 0,
    windowLight: 0,
    horizonWarmth: 0,
    phase: "night",
    sunDirection: [0, 0, -1],
    moonDirection: [0, 0, 1],
  };
}

function writeSolarCycle(output, hours) {
  const time = wrap(Number(hours) || 0, 24);
  // A stylised southern-coast solar arc.  Keeping solar noon below the
  // zenith is important in a street game: a perfectly vertical key light
  // illuminates rooftops but leaves every tower wall black.  This 56-degree
  // peak resembles a temperate latitude and still crosses the horizon near
  // 06:00/18:00, while the below-horizon angle supplies civil twilight.
  const dayAngle = ((time - 6) / 12) * Math.PI;
  const elevation = Math.sin(dayAngle) * 0.83;
  const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
  const eastWest = Math.cos(dayAngle);
  const eastComponent = eastWest * 0.90;
  const northComponent = -Math.sqrt(Math.max(0, 1 - eastComponent * eastComponent));
  const azimuth = Math.atan2(northComponent, eastComponent);
  const sunDirection = output.sunDirection;
  sunDirection[0] = eastComponent * horizontal;
  sunDirection[1] = elevation;
  sunDirection[2] = northComponent * horizontal;
  const daylight = smoothstep(-0.055, 0.22, elevation);
  const sunStrength = smoothstep(0.005, 0.34, elevation);
  const civilTwilight = smoothstep(-0.23, 0.045, elevation);
  const streetlight = 1 - smoothstep(-0.09, 0.115, elevation);
  const windowLight = clamp(0.035 + streetlight * 0.965, 0, 1);
  const horizonWarmth = clamp(
    Math.exp(-((time - 6.15) ** 2) / 1.05) + Math.exp(-((time - 18.55) ** 2) / 1.28),
    0,
    1,
  );
  const phase = elevation < -0.23 ? "night" : elevation < -0.055 ? (time < 12 ? "pre-dawn" : "blue-hour") :
    elevation < 0.16 ? (time < 12 ? "sunrise" : "sunset") : time < 10 ? "morning" : time < 16.5 ? "day" : "golden-hour";
  output.time = time;
  output.elevation = elevation;
  output.azimuth = azimuth;
  output.daylight = daylight;
  output.sunStrength = sunStrength;
  output.civilTwilight = civilTwilight;
  output.night = 1 - civilTwilight;
  output.streetlight = streetlight;
  output.windowLight = windowLight;
  output.horizonWarmth = horizonWarmth;
  output.phase = phase;
  output.moonDirection[0] = -sunDirection[0];
  output.moonDirection[1] = -sunDirection[1];
  output.moonDirection[2] = -sunDirection[2];
  return output;
}

export function solarCycleAt(hours) {
  const output = writeSolarCycle(createSolarState(), hours);
  Object.freeze(output.sunDirection);
  Object.freeze(output.moonDirection);
  return Object.freeze(output);
}

function createAtmosphereState() {
  return {
    ...createSolarState(),
    hours: 0,
    wetness: 0,
    sky: new THREE.Color(),
    fog: new THREE.Color(),
    sunColor: new THREE.Color(),
    ambientIntensity: 0,
    keyIntensity: 0,
    fogDensity: 0,
    neonStrength: 0,
  };
}

function writeAtmosphere(output, hours, rain = 0) {
  const solar = writeSolarCycle(output, hours);
  const time = solar.time;
  const wetness = clamp(rain, 0, 1);
  const daylight = solar.daylight;
  const night = solar.night;
  const stormDarkening = 1 - wetness * 0.42;
  output.sky.setHex(0x071321)
    .lerp(SKY_DAY_COLOR, daylight * stormDarkening)
    .lerp(SKY_SUNSET_COLOR, solar.horizonWarmth * 0.24 * stormDarkening);
  output.fog.setHex(0x10263a)
    .lerp(FOG_DAY_COLOR, daylight * 0.66 * stormDarkening)
    .lerp(FOG_SUNSET_COLOR, solar.horizonWarmth * 0.15)
    .lerp(FOG_RAIN_COLOR, wetness * 0.34);
  output.sunColor.setHex(0x9bc5ff)
    .lerp(SUN_DAY_COLOR, daylight)
    .lerp(SUN_SUNSET_COLOR, solar.horizonWarmth * 0.58)
    .lerp(SUN_RAIN_COLOR, wetness * 0.36);
  output.hours = time;
  output.wetness = wetness;
  output.ambientIntensity = (0.48 + solar.civilTwilight * 0.42 + daylight * 0.92) * (1 - wetness * 0.22);
  output.keyIntensity = (0.62 + solar.sunStrength * 4.25) * (1 - wetness * 0.38);
  output.fogDensity = 0.00245 + wetness * 0.0018 + night * 0.0003;
  output.neonStrength = 0.20 + solar.streetlight * 1.10;
  return output;
}

export function atmosphereAt(hours, rain = 0) {
  const output = writeAtmosphere(createAtmosphereState(), hours, rain);
  Object.freeze(output.sunDirection);
  Object.freeze(output.moonDirection);
  return Object.freeze(output);
}

export function createCityEnvironment({ scene, world, seed = DEFAULT_SEED, rainCount = 420 } = {}) {
  if (!scene?.add) throw new TypeError("createCityEnvironment requires a scene");
  const random = mulberry32(Number(seed) >>> 0);
  const root = new THREE.Group();
  root.name = "Neon City dynamic atmosphere";
  root.userData.rtxIgnore = true;
  scene.add(root);

  const materials = [];
  const geometries = [];
  const state = {
    hours: 7.2,
    // One game minute per real second: a full day takes 24 real minutes.
    timeScale: 1 / 60,
    rain: 0.44,
    targetRain: 0.44,
    windX: 2.8,
    windZ: -1.15,
    lightning: 0,
    elapsed: 0,
  };

  const ownGeometry = geometry => (geometries.push(geometry), geometry);
  const ownMaterial = material => (materials.push(material), material);

  const skyGeometry = ownGeometry(new THREE.SphereGeometry(520, 32, 18));
  const skyColors = new Float32Array(skyGeometry.getAttribute("position").count * 3);
  skyGeometry.setAttribute("color", new THREE.BufferAttribute(skyColors, 3));
  const skyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }));
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = "Dynamic coastal sky gradient";
  sky.renderOrder = -100;
  sky.userData.rtxIgnore = true;
  root.add(sky);

  const rainGeometry = ownGeometry(new THREE.BoxGeometry(0.018, 0.82, 0.018));
  const rainMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
    color: 0x9fd9ff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }));
  rainMaterial.toneMapped = false;
  const resolvedRainCount = Math.max(32, Math.min(900, Math.trunc(Number(rainCount) || 420)));
  const rain = new THREE.InstancedMesh(rainGeometry, rainMaterial, resolvedRainCount);
  rain.name = "Camera-local rain field";
  rain.frustumCulled = false;
  rain.renderOrder = 80;
  rain.userData.rtxIgnore = true;
  root.add(rain);

  const drops = Array.from({ length: resolvedRainCount }, () => ({
    x: (random() - 0.5) * 52,
    y: random() * 25,
    z: (random() - 0.5) * 52,
    speed: 20 + random() * 15,
    stretch: 0.55 + random() * 0.9,
    phase: random() * TAU,
  }));
  const position = new THREE.Vector3();
  const rainQuaternion = new THREE.Quaternion();
  // Clouds and stars never rotate. Keeping a second identity quaternion is
  // cheaper than constructing one for every instance on every fixed update.
  const identityQuaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const rainTilt = new THREE.Euler(0.05, 0, -0.12);
  rainQuaternion.setFromEuler(rainTilt);

  const cloudGeometry = ownGeometry(new THREE.SphereGeometry(1, 10, 7));
  const cloudMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial({
    color: 0x304050,
    roughness: 1,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }));
  const cloudCount = 28;
  const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudCount);
  clouds.name = "Low moving storm clouds";
  clouds.frustumCulled = false;
  clouds.userData.rtxIgnore = true;
  const cloudData = Array.from({ length: cloudCount }, (_, index) => ({
    x: -260 + random() * 520,
    y: 88 + random() * 28,
    z: -245 + random() * 490,
    sx: 18 + random() * 34,
    sy: 3.5 + random() * 7,
    sz: 11 + random() * 25,
    speed: 0.35 + random() * 0.48,
    phase: index * 0.73,
  }));
  root.add(clouds);

  const sunMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0xfff0c2 }));
  sunMaterial.toneMapped = false;
  const sun = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(10, 24, 16)), sunMaterial);
  sun.name = "Orbiting coastal sun";
  sun.userData.rtxIgnore = true;
  root.add(sun);
  const sunHaloMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
    color: 0xffbf73,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sunHaloMaterial.toneMapped = false;
  const sunHalo = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(18, 20, 12)), sunHaloMaterial);
  sunHalo.name = "Sun atmospheric halo";
  sunHalo.userData.rtxIgnore = true;
  root.add(sunHalo);

  const moonMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0xc9e3ff }));
  moonMaterial.toneMapped = false;
  const moon = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(12, 24, 16)), moonMaterial);
  moon.name = "Coastal moon";
  moon.position.set(-195, 175, -300);
  moon.userData.rtxIgnore = true;
  root.add(moon);
  const moonHaloMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
    color: 0x8fcaff,
    transparent: true,
    opacity: 0.085,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  moonHaloMaterial.toneMapped = false;
  const moonHalo = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(18, 20, 12)), moonHaloMaterial);
  moonHalo.name = "Moon atmospheric halo";
  moonHalo.position.copy(moon.position);
  moonHalo.userData.rtxIgnore = true;
  root.add(moonHalo);

  const starGeometry = ownGeometry(new THREE.IcosahedronGeometry(0.44, 0));
  const starMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0xd9edff }));
  starMaterial.toneMapped = false;
  const stars = new THREE.InstancedMesh(starGeometry, starMaterial, 96);
  stars.name = "Procedural night stars";
  stars.userData.rtxIgnore = true;
  for (let index = 0; index < stars.count; ++index) {
    const azimuth = random() * TAU;
    const elevation = 0.18 + random() * 0.66;
    const distance = 330 + random() * 95;
    position.set(
      Math.cos(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.sin(azimuth) * Math.cos(elevation) * distance,
    );
    scale.setScalar(0.35 + random() * 1.15);
    matrix.compose(position, identityQuaternion, scale);
    stars.setMatrixAt(index, matrix);
  }
  stars.instanceMatrix.needsUpdate = true;
  root.add(stars);

  const lightning = new THREE.DirectionalLight(0xd8edff, 0);
  lightning.name = "Distant storm lightning";
  lightning.position.set(80, 145, -120);
  root.add(lightning, lightning.target);

  const atmosphereLights = (world?.staticLights ?? []).filter(light => light?.isLight);
  const hemisphere = atmosphereLights.find(light => light.isHemisphereLight);
  const keyLight = atmosphereLights.find(light => light.isDirectionalLight);
  const worldOwnsLightCycle = typeof world?.setTimeOfDay === "function";
  let disposed = false;
  let lastSkyHourStep = null;
  let lastSkyRainStep = null;
  const skyZenith = new THREE.Color();
  const skyHorizon = new THREE.Color();
  const skyLower = new THREE.Color();
  const skyVertexColor = new THREE.Color();
  const atmosphereState = createAtmosphereState();
  let atmosphereReady = false;
  let atmosphereHours = 0;
  let atmosphereRain = 0;
  let cachedSnapshot = null;
  let snapshotHours = 0;
  let snapshotRain = 0;
  let snapshotTargetRain = 0;
  let snapshotLightning = 0;
  let snapshotWindX = 0;
  let snapshotWindZ = 0;
  let atmosphereComputations = 0;
  let atmosphereCacheHits = 0;
  let snapshotBuilds = 0;
  let snapshotCacheHits = 0;

  const allocationDiagnostics = Object.freeze({
    policy: "preallocated-environment-hot-path",
    storage: "memory-only",
    cloudQuaternionStorage: "single-preallocated-identity",
    cloudQuaternionAllocationsPerUpdate: 0,
    publicSnapshotsImmutable: true,
    get atmosphereComputations() { return atmosphereComputations; },
    get atmosphereCacheHits() { return atmosphereCacheHits; },
    get snapshotBuilds() { return snapshotBuilds; },
    get snapshotCacheHits() { return snapshotCacheHits; },
  });

  function currentAtmosphere() {
    if (atmosphereReady && Object.is(atmosphereHours, state.hours) && Object.is(atmosphereRain, state.rain)) {
      atmosphereCacheHits += 1;
      return atmosphereState;
    }
    writeAtmosphere(atmosphereState, state.hours, state.rain);
    atmosphereHours = state.hours;
    atmosphereRain = state.rain;
    atmosphereReady = true;
    atmosphereComputations += 1;
    return atmosphereState;
  }

  function snapshotMatchesState() {
    return cachedSnapshot &&
      Object.is(snapshotHours, state.hours) &&
      Object.is(snapshotRain, state.rain) &&
      Object.is(snapshotTargetRain, state.targetRain) &&
      Object.is(snapshotLightning, state.lightning) &&
      Object.is(snapshotWindX, state.windX) &&
      Object.is(snapshotWindZ, state.windZ);
  }

  function updateSky(atmosphere) {
    const hourStep = Math.round(state.hours * 12);
    const rainStep = Math.round(state.rain * 20);
    if (hourStep === lastSkyHourStep && rainStep === lastSkyRainStep) return;
    lastSkyHourStep = hourStep;
    lastSkyRainStep = rainStep;
    const positions = skyGeometry.getAttribute("position");
    const colors = skyGeometry.getAttribute("color");
    skyZenith.copy(atmosphere.sky).multiplyScalar(0.64 + atmosphere.daylight * 0.32);
    skyHorizon.copy(atmosphere.fog).multiplyScalar(0.82 + atmosphere.daylight * 0.27)
      .lerp(SKY_HORIZON_WARM_COLOR, atmosphere.horizonWarmth * 0.28 * (1 - state.rain * 0.55));
    skyLower.copy(atmosphere.fog).multiplyScalar(0.32);
    for (let index = 0; index < positions.count; ++index) {
      const normalizedY = clamp(positions.getY(index) / 520 * 0.5 + 0.5, 0, 1);
      if (normalizedY < 0.48) skyVertexColor.copy(skyLower).lerp(skyHorizon, normalizedY / 0.48);
      else skyVertexColor.copy(skyHorizon).lerp(skyZenith, ((normalizedY - 0.48) / 0.52) ** 0.7);
      colors.setXYZ(index, skyVertexColor.r, skyVertexColor.g, skyVertexColor.b);
    }
    colors.needsUpdate = true;
  }

  function setRain(amount, immediate = false) {
    state.targetRain = clamp(amount, 0, 1);
    if (immediate) state.rain = state.targetRain;
    return snapshot();
  }

  function setTime(hours) {
    state.hours = wrap(Number(hours) || 0, 24);
    return snapshot();
  }

  function updateRain(dt, focus) {
    rain.visible = state.rain > 0.025;
    rainMaterial.opacity = 0.12 + state.rain * 0.46;
    if (!rain.visible) return;
    const baseX = Number(focus?.x) || 0;
    const baseZ = Number(focus?.z) || 0;
    for (let index = 0; index < drops.length; ++index) {
      const drop = drops[index];
      drop.y -= drop.speed * dt;
      drop.x += state.windX * dt;
      drop.z += state.windZ * dt;
      if (drop.y < 0) {
        drop.y += 25;
        drop.x = (random() - 0.5) * 52;
        drop.z = (random() - 0.5) * 52;
      }
      if (drop.x > 26) drop.x -= 52;
      if (drop.x < -26) drop.x += 52;
      if (drop.z > 26) drop.z -= 52;
      if (drop.z < -26) drop.z += 52;
      position.set(baseX + drop.x, drop.y + 0.25, baseZ + drop.z);
      scale.set(1, drop.stretch * (0.45 + state.rain * 0.8), 1);
      matrix.compose(position, rainQuaternion, scale);
      rain.setMatrixAt(index, matrix);
    }
    rain.instanceMatrix.needsUpdate = true;
  }

  function updateClouds(dt, atmosphere) {
    cloudMaterial.opacity = 0.12 + state.rain * 0.46;
    for (let index = 0; index < cloudData.length; ++index) {
      const cloud = cloudData[index];
      cloud.x += (cloud.speed + state.windX * 0.08) * dt;
      if (cloud.x > 280) cloud.x = -280;
      position.set(cloud.x, cloud.y + Math.sin(state.elapsed * 0.08 + cloud.phase), cloud.z);
      scale.set(cloud.sx, cloud.sy, cloud.sz);
      matrix.compose(position, identityQuaternion, scale);
      clouds.setMatrixAt(index, matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    clouds.visible = state.rain > 0.08 || atmosphere.daylight > 0.15;
  }

  function update(delta, elapsed, focus = null) {
    const dt = clamp(delta, 0, 0.1);
    state.elapsed = Math.max(state.elapsed, Number(elapsed) || 0);
    state.hours = wrap(state.hours + dt * state.timeScale, 24);
    state.rain += (state.targetRain - state.rain) * (1 - Math.exp(-dt * 0.42));
    const atmosphere = currentAtmosphere();
    updateSky(atmosphere);
    scene.background?.copy?.(atmosphere.sky);
    if (scene.fog?.color) scene.fog.color.copy(atmosphere.fog);
    if (scene.fog && "density" in scene.fog) scene.fog.density = atmosphere.fogDensity;
    if (hemisphere && !worldOwnsLightCycle) {
      hemisphere.intensity = atmosphere.ambientIntensity;
      hemisphere.color.copy(atmosphere.sunColor).multiplyScalar(0.72);
    }
    if (keyLight && !worldOwnsLightCycle) {
      keyLight.intensity = atmosphere.keyIntensity;
      keyLight.color.copy(atmosphere.sunColor);
      const direction = atmosphere.sunStrength > 0.02 ? atmosphere.sunDirection : atmosphere.moonDirection;
      keyLight.position.set(direction[0] * 165, Math.max(18, Math.abs(direction[1]) * 175), direction[2] * 165);
    }
    const lightningPhase = Math.sin(state.elapsed * 0.113 + 2.7) + Math.sin(state.elapsed * 0.071 + 0.8);
    const flash = state.rain > 0.78 && lightningPhase > 1.88
      ? ((lightningPhase - 1.88) / 0.12) ** 2 * state.rain : 0;
    state.lightning = clamp(flash, 0, 1);
    lightning.intensity = state.lightning * 16;
    const skyRadius = 390;
    sun.position.fromArray(atmosphere.sunDirection).multiplyScalar(skyRadius);
    sun.visible = atmosphere.elevation > -0.09 && state.rain < 0.92;
    sunMaterial.color.copy(atmosphere.sunColor);
    sunHalo.position.copy(sun.position);
    sunHalo.visible = sun.visible && state.rain < 0.75;
    sunHaloMaterial.opacity = (0.045 + atmosphere.horizonWarmth * 0.12) * (1 - state.rain * 0.75);
    moon.position.fromArray(atmosphere.moonDirection).multiplyScalar(skyRadius);
    moon.visible = atmosphere.night > 0.08 && moon.position.y > -45;
    moonMaterial.opacity = clamp(atmosphere.night * 1.15, 0, 1);
    moonHalo.position.copy(moon.position);
    moonHalo.visible = moon.visible && state.rain < 0.82;
    moonHaloMaterial.opacity = atmosphere.night * (0.055 + (1 - state.rain) * 0.055);
    moonHalo.scale.setScalar(1 + Math.sin(state.elapsed * 0.18) * 0.035);
    stars.visible = atmosphere.night > 0.38 && state.rain < 0.72;
    updateRain(dt, focus);
    updateClouds(dt, atmosphere);
    return snapshot();
  }

  function snapshot() {
    const atmosphere = currentAtmosphere();
    if (snapshotMatchesState()) {
      snapshotCacheHits += 1;
      return cachedSnapshot;
    }
    cachedSnapshot = Object.freeze({
      timeHours: state.hours,
      timeLabel: formatClock(state.hours),
      weather: state.rain < 0.08 ? "CLEAR" : state.rain < 0.38 ? "DRIZZLE" : state.rain < 0.76 ? "RAIN" : "STORM",
      rain: state.rain,
      targetRain: state.targetRain,
      wetness: state.rain,
      daylight: atmosphere.daylight,
      night: atmosphere.night,
      sunElevation: atmosphere.elevation,
      // The mutable atmosphere scratch never escapes. Each newly published
      // snapshot owns frozen direction arrays, so an older save/control
      // snapshot cannot change when the next frame advances the sun.
      sunDirection: Object.freeze([
        atmosphere.sunDirection[0], atmosphere.sunDirection[1], atmosphere.sunDirection[2],
      ]),
      moonDirection: Object.freeze([
        atmosphere.moonDirection[0], atmosphere.moonDirection[1], atmosphere.moonDirection[2],
      ]),
      streetlight: atmosphere.streetlight,
      windowLight: atmosphere.windowLight,
      phase: atmosphere.phase,
      lightning: state.lightning,
      wind: Object.freeze([state.windX, state.windZ]),
    });
    snapshotHours = state.hours;
    snapshotRain = state.rain;
    snapshotTargetRain = state.targetRain;
    snapshotLightning = state.lightning;
    snapshotWindX = state.windX;
    snapshotWindZ = state.windZ;
    snapshotBuilds += 1;
    return cachedSnapshot;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    root.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  update(0, 0, new THREE.Vector3());
  return {
    root,
    state,
    sky,
    rain,
    clouds,
    sun,
    sunHalo,
    moon,
    moonHalo,
    stars,
    allocationDiagnostics,
    setRain,
    setTime,
    update,
    snapshot,
    dispose,
  };
}
