import * as THREE from "three/webgpu";
import {
  color,
  dot,
  float,
  mix,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  vec3,
} from "three/tsl";
import {
  GORGE_BOUNDS,
  bedHeight,
  channelCenterX,
  channelHalfWidth,
} from "./gorge.mjs";

// The sun is only a few degrees above the upstream ridge. Its grazing angle
// produces long readable shadows and a warm reflection path down the flood,
// while the moon sits in the cooler eastern half of the blue-hour sky.
export const SUN_DIRECTION = Object.freeze(new THREE.Vector3(0.22, 0.24, -0.946).normalize());
export const MOON_DIRECTION = Object.freeze(new THREE.Vector3(-0.29, 0.46, 0.839).normalize());

function seededRandom(seed = 0x6e696768) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createSkyDome() {
  const ray = normalize(positionLocal);
  const altitude = ray.y;
  const horizon = smoothstep(-0.075, 0.32, altitude);
  const zenith = smoothstep(0.16, 0.82, altitude);
  const sunDirection = normalize(vec3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z));
  const sunAlignment = dot(ray, sunDirection).max(0);
  const sunsetGlow = pow(sunAlignment, 3.4)
    .mul(float(1).sub(smoothstep(0.04, 0.48, altitude)))
    .mul(0.82);
  const afterglow = pow(sunAlignment, 1.35)
    .mul(float(1).sub(smoothstep(-0.02, 0.31, altitude)))
    .mul(0.34);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Directional late-sunset blue-hour gorge sky",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const baseSky = mix(
    mix(color(0xd85f3e), color(0x544267), horizon),
    color(0x07162c),
    zenith,
  );
  material.colorNode = mix(
    mix(baseSky, color(0xf08a4e), afterglow),
    color(0xffbd6a),
    sunsetGlow,
  ).mul(float(0.92));
  material.toneMapped = false;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1700, 72, 36), material);
  sky.name = "Camera-centred directional sunset and blue-hour dome";
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.userData.rtxIgnore = true;
  return sky;
}

function createStars() {
  const random = seededRandom(0x73746172);
  const count = 1450;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; ++i) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.035 + Math.pow(random(), 0.74) * 0.965;
    const radius = 1605 + random() * 42;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const p = i * 3;
    positions[p] = Math.cos(azimuth) * horizontal * radius;
    positions[p + 1] = elevation * radius;
    positions[p + 2] = Math.sin(azimuth) * horizontal * radius;
    const temperature = random();
    const brightness = 0.13 + Math.pow(random(), 8.1) * 0.87;
    colors[p] = brightness * (0.76 + temperature * 0.24);
    colors[p + 1] = brightness * (0.84 + temperature * 0.15);
    colors[p + 2] = brightness * (1 - temperature * 0.09);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsNodeMaterial({
    name: "First stars emerging through blue hour",
    vertexColors: true,
    size: 0.92,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  const stars = new THREE.Points(geometry, material);
  stars.name = "Restrained first-star field above the sunset gorge";
  stars.renderOrder = -950;
  stars.frustumCulled = false;
  stars.userData.rtxIgnore = true;
  return stars;
}

function diskMaterial(hex, opacity = 1, blending = THREE.NormalBlending) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    blending,
  });
  material.toneMapped = false;
  return material;
}

function createTerminatorGeometry(radius, segments = 96) {
  // A slim gibbous phase shadow bounded by the lunar limb and a curved
  // terminator. It sits only over the disc, so no black card contaminates sky.
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices = new Uint16Array(segments * 6);
  for (let i = 0; i <= segments; ++i) {
    const t = i / segments;
    const y = THREE.MathUtils.lerp(-radius, radius, t);
    const limb = -Math.sqrt(Math.max(0, radius * radius - y * y));
    // The terminator remains close to the western limb: roughly 82% of the
    // apparent lunar disc stays illuminated, appropriate for a 9 PM gibbous.
    const curve = limb * 0.62;
    const p = i * 6;
    positions[p] = limb;
    positions[p + 1] = y;
    positions[p + 2] = 0;
    positions[p + 3] = curve;
    positions[p + 4] = y;
    positions[p + 5] = 0;
    if (i < segments) {
      const k = i * 6;
      const a = i * 2;
      indices[k] = a;
      indices[k + 1] = a + 2;
      indices[k + 2] = a + 1;
      indices[k + 3] = a + 1;
      indices[k + 4] = a + 2;
      indices[k + 5] = a + 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function createMoon() {
  const group = new THREE.Group();
  group.name = "Blue-hour waxing gibbous moon and optical halo";
  const radius = 6.15;

  const outerHalo = new THREE.Mesh(
    new THREE.CircleGeometry(25, 128),
    diskMaterial(0x7392ae, 0.014, THREE.AdditiveBlending),
  );
  const middleHalo = new THREE.Mesh(
    new THREE.CircleGeometry(14, 128),
    diskMaterial(0x91afc1, 0.025, THREE.AdditiveBlending),
  );
  const innerHalo = new THREE.Mesh(
    new THREE.CircleGeometry(8.7, 128),
    diskMaterial(0xd5e6e9, 0.045, THREE.AdditiveBlending),
  );
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 160),
    diskMaterial(0xffedcf),
  );
  outerHalo.position.z = -0.12;
  middleHalo.position.z = -0.08;
  innerHalo.position.z = -0.04;
  group.add(outerHalo, middleHalo, innerHalo, disk);

  const mariaMaterial = diskMaterial(0x687478, 0.19);
  const highlandMaterial = diskMaterial(0xfff5dc, 0.11, THREE.AdditiveBlending);
  const craterMaterial = diskMaterial(0x626b6b, 0.16);
  const maria = [
    [-2.0, 1.55, 1.23, 0.62, -0.18],
    [1.15, 2.05, 0.92, 0.73, 0.31],
    [2.38, 0.22, 1.35, 0.58, -0.36],
    [-0.88, -1.82, 0.78, 0.68, 0.12],
    [0.28, 0.28, 0.58, 0.74, -0.15],
    [-2.84, -0.12, 0.62, 0.53, 0.27],
    [1.17, -2.51, 0.47, 0.72, -0.09],
    [3.32, -1.46, 0.54, 0.65, 0.18],
    [-0.21, 2.83, 0.51, 0.52, -0.33],
  ];
  for (const [x, y, size, squash, rotation] of maria) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(size, 38), mariaMaterial);
    patch.position.set(x, y, 0.025);
    patch.scale.y = squash;
    patch.rotation.z = rotation;
    group.add(patch);
  }

  const random = seededRandom(0x63726174);
  for (let i = 0; i < 22; ++i) {
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(random()) * radius * 0.79;
    const size = 0.09 + Math.pow(random(), 2.1) * 0.36;
    const x = Math.cos(angle) * radial;
    const y = Math.sin(angle) * radial;
    const rim = new THREE.Mesh(new THREE.RingGeometry(size * 0.72, size, 24), highlandMaterial);
    rim.position.set(x - size * 0.07, y + size * 0.08, 0.041);
    const bowl = new THREE.Mesh(new THREE.CircleGeometry(size * 0.64, 24), craterMaterial);
    bowl.position.set(x, y, 0.043);
    bowl.scale.y = 0.72 + random() * 0.22;
    group.add(rim, bowl);
  }

  const terminator = new THREE.Mesh(
    createTerminatorGeometry(radius),
    diskMaterial(0x07101a, 0.87),
  );
  terminator.position.z = 0.06;
  group.add(terminator);
  group.position.copy(MOON_DIRECTION).multiplyScalar(1500);
  // Preserve the physically correct direction while slightly exaggerating
  // angular size so lunar surface detail survives a 720p cinematic overview.
  group.scale.setScalar(1.38);
  group.lookAt(0, 0, 0);
  group.renderOrder = -850;
  group.traverse(object => { object.userData.rtxIgnore = true; });
  return group;
}

function createSunsetSun() {
  const group = new THREE.Group();
  group.name = "Low sunset disc and atmospheric aureole";
  const outerHalo = new THREE.Mesh(
    new THREE.CircleGeometry(28, 128),
    diskMaterial(0xff7a3f, 0.026, THREE.AdditiveBlending),
  );
  const innerHalo = new THREE.Mesh(
    new THREE.CircleGeometry(12, 128),
    diskMaterial(0xffb45f, 0.075, THREE.AdditiveBlending),
  );
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(5.7, 160),
    diskMaterial(0xffd18a),
  );
  outerHalo.position.z = -0.09;
  innerHalo.position.z = -0.04;
  group.add(outerHalo, innerHalo, disc);
  group.position.copy(SUN_DIRECTION).multiplyScalar(1500);
  group.lookAt(0, 0, 0);
  group.renderOrder = -860;
  group.traverse(object => { object.userData.rtxIgnore = true; });
  return group;
}

function createHighHaze() {
  const random = seededRandom(0x68617a65);
  const count = 560;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; ++i) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.08 + Math.pow(random(), 0.78) * 0.63;
    const radius = 1210 + random() * 180;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const p = i * 3;
    positions[p] = Math.cos(azimuth) * horizontal * radius;
    positions[p + 1] = elevation * radius;
    positions[p + 2] = Math.sin(azimuth) * horizontal * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsNodeMaterial({
    name: "Sunset-tinted high cirrus",
    color: 0xb48687,
    size: 5.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.019,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const haze = new THREE.Points(geometry, material);
  haze.name = "Sparse blue-hour high haze";
  haze.frustumCulled = false;
  haze.userData.rtxIgnore = true;
  return haze;
}

function createMistRibbon(layer, material) {
  const segments = 164;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices = new Uint16Array(segments * 6);
  const startZ = GORGE_BOUNDS.minZ + 28 + layer * 7;
  const endZ = GORGE_BOUNDS.maxZ - 18 - layer * 11;
  for (let i = 0; i <= segments; ++i) {
    const t = i / segments;
    const z = THREE.MathUtils.lerp(startZ, endZ, t);
    const center = channelCenterX(z) + Math.sin(t * 13.4 + layer * 1.7) * (2.2 + layer * 0.45);
    const halfWidth = channelHalfWidth(z) * (0.72 + layer * 0.12)
      * (0.82 + Math.sin(t * 17.1 + layer) * 0.12);
    const height = bedHeight(center, z) + 1.2 + layer * 1.05
      + Math.sin(t * 9.2 + layer * 0.8) * 0.65;
    const p = i * 6;
    positions[p] = center - halfWidth;
    positions[p + 1] = height;
    positions[p + 2] = z;
    positions[p + 3] = center + halfWidth;
    positions[p + 4] = height + 0.13;
    positions[p + 5] = z;
    if (i < segments) {
      const k = i * 6;
      const a = i * 2;
      indices[k] = a;
      indices[k + 1] = a + 2;
      indices[k + 2] = a + 1;
      indices[k + 3] = a + 1;
      indices[k + 4] = a + 2;
      indices[k + 5] = a + 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.name = `Low river mist ribbon ${layer + 1}`;
  ribbon.userData.rtxIgnore = true;
  ribbon.renderOrder = 80 + layer;
  return ribbon;
}

function createLowMist() {
  const group = new THREE.Group();
  group.name = "Low floodplain mist foundation";
  const materials = [];
  for (let layer = 0; layer < 7; ++layer) {
    const material = new THREE.MeshBasicNodeMaterial({
      name: `Depth-faded river mist layer ${layer + 1}`,
      color: layer < 3 ? 0xb79a9b : 0x817a90,
      transparent: true,
      opacity: 0.012 + layer * 0.0019,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
      blending: THREE.NormalBlending,
    });
    material.toneMapped = false;
    material.userData.baseOpacity = material.opacity;
    materials.push(material);
    group.add(createMistRibbon(layer, material));
  }

  const random = seededRandom(0x73707279);
  const sprayCount = 310;
  const positions = new Float32Array(sprayCount * 3);
  for (let i = 0; i < sprayCount; ++i) {
    const upperFall = i < sprayCount * 0.62;
    const z = (upperFall ? -395 : 108) + (random() - 0.5) * (upperFall ? 58 : 39);
    const center = channelCenterX(z);
    const halfWidth = channelHalfWidth(z);
    const x = center + (random() * 2 - 1) * halfWidth * 0.9;
    const p = i * 3;
    positions[p] = x;
    positions[p + 1] = bedHeight(x, z) + 1.4 + Math.pow(random(), 0.65) * 10;
    positions[p + 2] = z;
  }
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const sprayMaterial = new THREE.PointsNodeMaterial({
    name: "Sunset-lit waterfall aerosol",
    color: 0xd7c5bd,
    size: 2.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.055,
    depthWrite: false,
    fog: true,
  });
  const spray = new THREE.Points(sprayGeometry, sprayMaterial);
  spray.name = "Fine mist above two natural rapid lips";
  spray.userData.rtxIgnore = true;
  spray.renderOrder = 92;
  group.add(spray);
  return { group, materials, spray, sprayCount };
}

/**
 * Camera-centred celestial shell plus world-space low mist and stable sunset
 * lighting. Lighting intensity never pulses; water motion supplies animation.
 */
export function createGorgeSunsetAtmosphere(scene, options = {}) {
  if (!scene?.add) throw new TypeError("createGorgeSunsetAtmosphere requires a THREE.Scene");
  const skyRoot = new THREE.Group();
  skyRoot.name = "Camera-centred late-sunset and blue-hour gorge atmosphere";
  const sky = createSkyDome();
  const stars = createStars();
  const sun = createSunsetSun();
  const moon = createMoon();
  const haze = createHighHaze();
  skyRoot.add(sky, stars, sun, moon, haze);

  const lowMist = createLowMist();
  scene.add(skyRoot, lowMist.group);

  const sunTarget = new THREE.Object3D();
  sunTarget.name = "Sunset gorge light target";
  sunTarget.position.set(channelCenterX(-180), 25, -180);
  const sunLight = new THREE.DirectionalLight(0xffad69, options.sunIntensity ?? 2.35);
  sunLight.name = "Stable grazing amber sunset key";
  sunLight.position.copy(sunTarget.position).addScaledVector(SUN_DIRECTION, 760);
  sunLight.target = sunTarget;
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -430;
  sunLight.shadow.camera.right = 430;
  sunLight.shadow.camera.top = 430;
  sunLight.shadow.camera.bottom = -430;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1450;
  sunLight.shadow.bias = -0.00018;
  sunLight.shadow.normalBias = 0.045;

  const moonTarget = new THREE.Object3D();
  moonTarget.name = "Blue-hour moonlight target";
  moonTarget.position.copy(sunTarget.position);
  const moonLight = new THREE.DirectionalLight(0x9ebbd2, options.moonIntensity ?? 0.58);
  moonLight.name = "Stable cool blue-hour moon fill";
  moonLight.position.copy(moonTarget.position).addScaledVector(MOON_DIRECTION, 640);
  moonLight.target = moonTarget;
  moonLight.castShadow = false;

  const hemisphere = new THREE.HemisphereLight(0x7686aa, 0x593026, 1.12);
  hemisphere.name = "Violet sky and warm gorge bounce fill";
  const ambient = new THREE.AmbientLight(0x58485e, 0.24);
  ambient.name = "Blue-hour ambient floor";
  scene.add(sunLight, sunTarget, moonLight, moonTarget, hemisphere, ambient);

  const previousFog = scene.fog;
  const managedFog = options.fog === false
    ? previousFog
    : new THREE.FogExp2(options.fogColor ?? 0x392b3d, options.fogDensity ?? 0.00122);
  if (options.fog !== false) scene.fog = managedFog;

  const stats = Object.freeze({
    stars: stars.geometry.getAttribute("position").count,
    mistRibbons: lowMist.materials.length,
    sprayParticles: lowMist.sprayCount,
    timeOfDay: "late-sunset-blue-hour",
    sunAltitudeDegrees: THREE.MathUtils.radToDeg(Math.asin(SUN_DIRECTION.y)),
    moonPhase: "waxing-gibbous",
    moonAltitudeDegrees: THREE.MathUtils.radToDeg(Math.asin(MOON_DIRECTION.y)),
  });

  return {
    root: skyRoot,
    skyRoot,
    lowMist: lowMist.group,
    sky,
    stars,
    sun,
    moon,
    haze,
    sunDirection: SUN_DIRECTION.clone(),
    moonDirection: MOON_DIRECTION.clone(),
    sunLight,
    moonLight,
    hemisphere,
    ambient,
    fog: managedFog,
    stats,
    getStats() {
      return { ...stats };
    },
    update(time, camera) {
      if (camera) skyRoot.position.copy(camera.position);
      stars.rotation.y = time * 0.000041;
      haze.rotation.y = time * 0.00012;
      // Only the nearly imperceptible mist opacity breathes. Direct lighting is
      // deliberately invariant to avoid large-area RTX illumination flashes.
      for (let i = 0; i < lowMist.materials.length; ++i) {
        const material = lowMist.materials[i];
        const base = material.userData.baseOpacity;
        material.opacity = base * (0.985 + Math.sin(time * 0.075 + i * 1.31) * 0.015);
      }
    },
    dispose() {
      const roots = [skyRoot, lowMist.group];
      const geometries = new Set();
      const materials = new Set();
      for (const root of roots) {
        root.traverse(object => {
          if (object.geometry) geometries.add(object.geometry);
          if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
          else if (object.material) materials.add(object.material);
        });
      }
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
      scene.remove(
        skyRoot,
        lowMist.group,
        sunLight,
        sunTarget,
        moonLight,
        moonTarget,
        hemisphere,
        ambient,
      );
      if (options.fog !== false && scene.fog === managedFog) scene.fog = previousFog;
    },
  };
}

// Preserve the earlier API names for sample-local imports and contract probes.
export const createGorgeNightAtmosphere = createGorgeSunsetAtmosphere;
export const createNightAtmosphere = createGorgeSunsetAtmosphere;
