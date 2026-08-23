import * as THREE from "three/webgpu";
import {
  breakingInjectionNode,
  celestialDirection,
  createOceanWaterMaterial,
  createSkyMaterial,
  GEOMETRY_WAVE_COUNT,
  MOON_DIRECT_RADIANCE_RGB,
  MOON_DIRECTION,
  MOON_WATER_EMITTER_INTENSITY,
  moonSkyDirection,
  OCEAN_WAVES,
  setMoonEmitterVisibility,
  starVisibilityNode,
  updateMaterialTime,
} from "./materials.mjs";
import { sampleMoonCloudTransmission } from "./cloud-model.mjs";
import { createOceanFoamField } from "./foam-field.mjs";

const WATER_LEVEL = 0;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleOceanWaveState(x, z, time, energy = 1) {
  let offsetX = 0;
  let height = 0;
  let offsetZ = 0;
  let slopeX = 0;
  let slopeZ = 0;
  for (let index = 0; index < GEOMETRY_WAVE_COUNT; ++index) {
    const wave = OCEAN_WAVES[index];
    const phase = (x * wave.x + z * wave.z) * wave.frequency + time * wave.speed;
    const angle = phase + (wave.offset ?? 0);
    const waveSin = Math.sin(angle);
    const waveCos = Math.cos(angle);
    height += waveSin * wave.amplitude;
    offsetX += waveCos * wave.amplitude * wave.choppiness * wave.x;
    offsetZ += waveCos * wave.amplitude * wave.choppiness * wave.z;
    slopeX += waveCos * wave.amplitude * wave.frequency * wave.x;
    slopeZ += waveCos * wave.amplitude * wave.frequency * wave.z;
  }
  return {
    offsetX: offsetX * energy,
    height: height * energy,
    offsetZ: offsetZ * energy,
    slopeX: slopeX * energy,
    slopeZ: slopeZ * energy,
  };
}

function sampleOceanWaveHeight(x, z, time, energy = 1) {
  return sampleOceanWaveState(x, z, time, energy).height;
}

function createOceanWater(persistentFoamSample) {
  // Carry the displaced surface beyond the marine atmosphere's useful optical
  // range. The former 520 x 460 m patch still transmitted about 40% of its far
  // edge through the scene fog, exposing a ruler-straight false horizon. At
  // roughly 1.45 km the same Beer-Lambert falloff makes this edge imperceptible,
  // while ~3.1 m cells continue to resolve the shortest authored wave train.
  const geometry = new THREE.PlaneGeometry(1600, 1800, 512, 576);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.translate(0, 0, -650);

  const surface = new THREE.Mesh(
    geometry,
    createOceanWaterMaterial(persistentFoamSample),
  );
  surface.name = "Moonlit open-ocean JS/TSL surface";
  surface.position.y = WATER_LEVEL;
  surface.renderOrder = 20;
  // The animated water stays out of the static TLAS. Generic RTX reflection
  // rays begin at its depth/normal guide and may hit only registered scene
  // geometry; the water shader itself remains entirely Three.js/TSL.
  surface.userData.rtxIgnore = true;
  surface.frustumCulled = false;
  return { geometry, surface };
}

function createDeepOceanFloor() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Deep ocean extinction receiver",
    color: 0x031018,
    roughness: 0.98,
    metalness: 0,
  });
  material.rtxReflectionMask = 0;
  // Cover the complete animated interface. The former 520 x 460 m receiver
  // ended behind the aerial camera and left near refraction rays with no
  // physical terminal surface, which collapsed the foreground toward black.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1800, 1, 1), material);
  floor.name = "Deep ocean floor";
  floor.rotation.x = -Math.PI * 0.5;
  floor.position.set(0, -26, -650);
  floor.receiveShadow = true;
  floor.userData.rtxStatic = true;
  return floor;
}

function createStars() {
  const random = mulberry32(0x51a7c0de);
  const positions = [];
  const colors = [];
  for (let index = 0; index < 1250; ++index) {
    const azimuth = random() * Math.PI * 2;
    // Keep stars above the bright marine aerosol layer at the horizon.
    const elevation = 0.11 + Math.pow(random(), 0.72) * 0.89;
    const radius = 305 + random() * 18;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    positions.push(
      Math.cos(azimuth) * horizontal * radius,
      elevation * radius,
      Math.sin(azimuth) * horizontal * radius,
    );
    const temperature = random();
    // Full-moon exposure erases most of the stellar background. Preserve a
    // long faint tail and only a handful of bright points instead of a field
    // of uniformly luminous additive pixels.
    const intensity = 0.035 + Math.pow(random(), 10) * 0.965;
    colors.push(
      intensity * (0.78 + temperature * 0.22),
      intensity * (0.86 + temperature * 0.14),
      intensity,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsNodeMaterial({
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    vertexColors: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  // Reuse the procedural atmosphere's optical-depth model in the star
  // fragment path. Clouds, marine haze, and the Moon now occlude stars as one
  // coherent sky instead of independent additive point sprites.
  material.opacityNode = starVisibilityNode().mul(0.42);
  material.toneMapped = false;
  const stars = new THREE.Points(geometry, material);
  stars.name = "Procedural marine night stars";
  stars.frustumCulled = false;
  stars.renderOrder = -12;
  stars.userData.rtxIgnore = true;
  return stars;
}

function diskMaterial(hex, opacity) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  material.toneMapped = false;
  return material;
}

function createMoon() {
  const moon = new THREE.Group();
  moon.name = "Physically scaled full moon";
  const haloOuter = new THREE.Mesh(new THREE.CircleGeometry(5.2, 96), diskMaterial(0x7ba9c4, 0.008));
  const haloInner = new THREE.Mesh(new THREE.CircleGeometry(2.3, 96), diskMaterial(0xb7dbea, 0.018));
  const disk = new THREE.Mesh(new THREE.CircleGeometry(1.31, 128), diskMaterial(0xfff5df, 1));
  haloOuter.position.z = -0.05;
  haloInner.position.z = -0.035;
  moon.add(haloOuter, haloInner, disk);

  const craterMaterial = diskMaterial(0x84919a, 0.16);
  const craters = [
    [-0.31, 0.22, 0.18, 0.72],
    [0.24, 0.28, 0.14, 0.62],
    [0.28, -0.24, 0.21, 0.78],
    [-0.18, -0.31, 0.12, 0.64],
    [-0.01, 0.01, 0.09, 0.70],
    [-0.44, -0.04, 0.08, 0.55],
  ];
  for (const [x, y, radius, squash] of craters) {
    const crater = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), craterMaterial);
    crater.position.set(x, y, 0.025);
    crater.scale.y = squash;
    moon.add(crater);
  }
  moon.traverse(object => { object.userData.rtxIgnore = true; });
  moon.renderOrder = -5;
  return moon;
}

function createNavigationBuoy() {
  const group = new THREE.Group();
  group.name = "Distant weather buoy scale reference";
  // Keep one restrained scale cue in the mid-distance. At the previous
  // ninety-metre placement the silhouette collapsed to a sub-pixel speck at
  // deck height, which made the wave scale read like a miniature surface.
  group.position.set(18, 0, -72);

  const hullMaterial = new THREE.MeshPhysicalNodeMaterial({
    color: 0xbc551f,
    roughness: 0.46,
    metalness: 0.12,
    clearcoat: 0.18,
  });
  hullMaterial.rtxReflectionMask = 0.38;
  const darkMetal = new THREE.MeshPhysicalNodeMaterial({
    color: 0x171d20,
    roughness: 0.35,
    metalness: 0.78,
  });
  darkMetal.rtxReflectionMask = 0.54;
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.55, 16), hullMaterial);
  hull.position.y = 0.10;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.50, 0.085, 8, 24), darkMetal);
  collar.rotation.x = Math.PI * 0.5;
  collar.position.y = 0.42;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.052, 2.15, 8), darkMetal);
  mast.position.y = 1.42;
  const cage = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.78, 4, 1, true), darkMetal);
  cage.position.y = 1.63;
  cage.rotation.y = Math.PI * 0.25;
  const beaconMaterial = diskMaterial(0xffa04a, 1);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), beaconMaterial);
  beacon.position.y = 2.52;
  beacon.userData.rtxIgnore = true;
  const haloMaterial = diskMaterial(0xff6f1f, 0.04);
  haloMaterial.blending = THREE.AdditiveBlending;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 10), haloMaterial);
  halo.position.copy(beacon.position);
  halo.userData.rtxIgnore = true;
  // Three.js PointLight intensity is luminous intensity (candela) and a zero
  // distance keeps its physically based inverse-square falloff unbounded.
  // The former 52 m cutoff ended before the camera, so the visible beacon and
  // its reflected path could disagree about whether the emitter existed.
  const beaconLight = new THREE.PointLight(0xff7a24, 6, 0, 2);
  beaconLight.name = "Distant buoy navigation light";
  beaconLight.position.y = 2.52;
  group.add(hull, collar, mast, cage, beacon, halo, beaconLight);
  group.scale.setScalar(0.92);
  group.traverse(object => {
    // The complete buoy follows the animated JS wave spectrum every frame.
    // Do not bake a stale startup transform or light into the static RTX
    // snapshot; generic RTX still handles the genuinely static ocean floor.
    object.userData.rtxIgnore = true;
    if (object.isMesh && object !== beacon) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return { group, beacon, halo, light: beaconLight };
}

function createNightEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x020711);
  // Generate specular lighting from the exact same procedural atmosphere and
  // moon uniform as the visible dome. Previously the flat blue room and an
  // unrelated moon card made the reflections describe a different sky.
  const environmentSky = new THREE.Mesh(
    new THREE.SphereGeometry(24, 96, 48),
    createSkyMaterial(),
  );
  environmentSky.frustumCulled = false;
  environmentScene.add(environmentSky);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(environmentScene, 0.032, 0.1, 50, {
    size: 256,
    position: new THREE.Vector3(0, 0, 0),
  });
  generator.dispose();
  environmentScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

export function buildMoonlitOcean(scene, renderer) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(340, 96, 48), createSkyMaterial());
  sky.name = "Moonlit open-ocean sky dome";
  sky.frustumCulled = false;
  sky.renderOrder = -20;
  sky.userData.rtxIgnore = true;
  scene.add(sky);

  const stars = createStars();
  const moonDisk = createMoon();
  // The procedural atmosphere owns the visible lunar disc so cloud density
  // can attenuate it coherently and the PMREM sees exactly the same emitter.
  // Keep this authored mesh available for future close shots, but do not draw
  // a second depth-independent moon over the cloud layer.
  moonDisk.visible = false;
  // Persistent white water is a pure Three.js/TSL compute field. It records
  // current Gerstner folding, then advects, spreads and decays the resulting
  // bubble rafts independently of the much faster carrier-wave phase.
  const foamField = createOceanFoamField(renderer, {
    injectionNode: breakingInjectionNode,
    // A one-and-a-quarter metre history cell is fine enough to preserve a
    // breaker envelope near the camera. Sub-metre optical structure is
    // reconstructed by the water material rather than paid for in the
    // screen-independent history field. Thirty updates per second keep the
    // advected envelope temporally smooth at the sample's high render rate.
    size: 512,
    worldSize: 512,
    originX: 0,
    originZ: -192,
    driftX: -0.090,
    driftZ: -0.266,
    stepHz: 30,
    decaySeconds: 5.5,
    spread: 0.48,
  });
  foamField.clear();
  const water = createOceanWater(point => foamField.sampleNode(point));
  const floor = createDeepOceanFloor();
  const buoy = createNavigationBuoy();
  scene.add(stars, moonDisk, floor, buoy.group, water.surface);

  const hemisphere = new THREE.HemisphereLight(0x4c7894, 0x010407, 0.045);
  hemisphere.name = "Marine night ambient";
  const moon = new THREE.DirectionalLight(0xe3e9ed, 0.18);
  moon.name = "Moon key light";
  moon.target.position.set(0, 0, -82);
  moon.position.copy(moon.target.position).addScaledVector(MOON_DIRECTION, 90);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -75;
  moon.shadow.camera.right = 75;
  moon.shadow.camera.top = 65;
  moon.shadow.camera.bottom = -30;
  moon.shadow.camera.near = 2;
  moon.shadow.camera.far = 210;
  moon.shadow.bias = -0.0002;
  moon.shadow.normalBias = 0.035;
  scene.add(hemisphere, moon, moon.target);

  const environmentTarget = createNightEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.08;
  scene.environmentRotation.y = 0;

  const moonDirection = new THREE.Vector3();
  const buoyAnchor = Object.freeze({ x: 18, z: -72 });
  let nativeMode = false;
  let waveAmount = 1;
  let previousFoamTime = null;

  function updateBuoyMotion(time) {
    const sample = sampleOceanWaveState(
      buoyAnchor.x,
      buoyAnchor.z,
      time,
      waveAmount,
    );

    // A floating marker follows the same spectrum as the rendered surface.
    // Its translation and analytic slope use the same resolved directional
    // components as the TSL vertex path, including horizontal drift.
    buoy.group.position.set(
      buoyAnchor.x + sample.offsetX,
      sample.height,
      buoyAnchor.z + sample.offsetZ,
    );
    buoy.group.rotation.x = Math.atan(-sample.slopeZ) * 0.82;
    buoy.group.rotation.z = Math.atan(sample.slopeX) * 0.82;
  }

  function setNativeMode(enabled) {
    nativeMode = Boolean(enabled);
  }

  function setWaveEnergy(value) {
    waveAmount = THREE.MathUtils.clamp(Number(value) || 0, 0, 1.25);
  }

  function update(time, delta, _transition, camera, debugMode = 0) {
    updateMaterialTime(time, 1, waveAmount, debugMode);
    const foamTimeAdvanced = previousFoamTime === null || time > previousFoamTime + 1e-7;
    foamField.update(delta, foamTimeAdvanced);
    previousFoamTime = time;
    updateBuoyMotion(time);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    // Sidereal rotation: 2*pi per 23 h 56 min.
    stars.rotation.y = time * 7.2921159e-5;
    moonSkyDirection.value.copy(MOON_DIRECTION);
    moonDisk.position.copy(camera.position).addScaledVector(MOON_DIRECTION, 300);
    moonDisk.lookAt(camera.position);

    // A navigation-grade amber pulse with a smooth, readable rise and fall.
    // Animate the actual physical Three.js light and feed the same candela
    // value to the JS/TSL water emitter so direct light and reflection agree.
    const flashPeriod = 3.8;
    const flashDuration = 0.82;
    const flashPhase = ((time + 0.16) % flashPeriod + flashPeriod) % flashPeriod;
    const flash = flashPhase < flashDuration
      ? Math.pow(Math.sin(Math.PI * flashPhase / flashDuration), 2)
      : 0;
    // The lantern is modelled as an omnidirectional point source. Keep its
    // peak in the low-kilocandela range: the previous 48 kcd value belonged
    // to a tightly collimated beam and flooded the whole sea when interpreted
    // as isotropic candela by Three.js. This remains brighter than moonlight
    // at the nearby water surface without clipping the amber trail white.
    const beaconIntensity = 0.5 + flash * 1_800;
    buoy.light.intensity = beaconIntensity;
    buoy.beacon.scale.setScalar(1 + flash * 0.32);
    buoy.halo.material.opacity = 0.025 + flash * 0.72;
    buoy.halo.scale.setScalar(1 + flash * 0.55);
    moonDirection.copy(moon.position).sub(moon.target.position).normalize();
    celestialDirection.value.copy(moonDirection);
    const moonCloudTransmission = sampleMoonCloudTransmission(
      camera.position,
      time,
      moonDirection,
    );
    setMoonEmitterVisibility(moonCloudTransmission);
    return {
      celestialDirection: moonDirection,
      celestialColor: MOON_DIRECT_RADIANCE_RGB,
      // Irradiance supplied to the generic RTX microfacet emitter. Moonlight
      // is a small, low-energy source; keeping this calibrated below the
      // visible sky radiance prevents the GGX path from clipping into white
      // blobs while retaining a continuous silver trail.
      celestialIntensity: MOON_WATER_EMITTER_INTENSITY
        * moonCloudTransmission,
      transition: 1,
      nativeMode,
      debugMode,
    };
  }

  function dispose() {
    foamField.dispose();
    environmentTarget.dispose();
    const geometries = new Set();
    const materials = new Set();
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => material.dispose?.());
  }

  setNativeMode(false);
  return {
    water,
    sky,
    stars,
    moonDisk,
    buoy,
    foamField,
    lights: { hemisphere, moon },
    staticRoots: [floor],
    staticLights: [],
    setNativeMode,
    setWaveEnergy,
    update,
    dispose,
    get nativeMode() {
      return nativeMode;
    },
    get waveEnergy() {
      return waveAmount;
    },
  };
}

export { WATER_LEVEL, sampleOceanWaveHeight };
