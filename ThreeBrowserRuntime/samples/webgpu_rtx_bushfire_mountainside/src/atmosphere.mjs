import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  positionLocal,
  pow,
  smoothstep,
} from "three/tsl";

function seededRandom(seed = 0x73746172) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createSkyDome() {
  const height = smoothstep(-35, 245, positionLocal.y);
  const upper = pow(height, 0.72);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "9 PM moonlit sky gradient",
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  material.colorNode = mix(
    mix(color(0x111822), color(0x071120), height),
    color(0x01040b),
    upper,
  ).mul(float(0.92));
  material.toneMapped = false;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1120, 64, 32), material);
  sky.name = "Deep blue procedural night dome";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.userData.rtxIgnore = true;
  return sky;
}

function createStars() {
  const random = seededRandom(0x39a7f11d);
  const positions = [];
  const colors = [];
  const count = 1850;
  for (let index = 0; index < count; ++index) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.08 + Math.pow(random(), 0.78) * 0.92;
    const radius = 1000 + random() * 38;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    positions.push(
      Math.cos(azimuth) * horizontal * radius,
      elevation * radius,
      Math.sin(azimuth) * horizontal * radius,
    );
    const warmth = random();
    const brightness = 0.17 + Math.pow(random(), 7.2) * 0.83;
    colors.push(
      brightness * (0.78 + warmth * 0.22),
      brightness * (0.86 + warmth * 0.13),
      brightness * (1 - warmth * 0.07),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsNodeMaterial({
    name: "Moon-exposed stellar field",
    size: 0.72,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  const stars = new THREE.Points(geometry, material);
  stars.name = "Procedural stars visible at 9 PM";
  stars.frustumCulled = false;
  stars.renderOrder = -900;
  stars.userData.rtxIgnore = true;
  return stars;
}

function diskMaterial(hex, opacity = 1, blending = THREE.NormalBlending) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    blending,
  });
  material.toneMapped = false;
  return material;
}

function createMoon() {
  const group = new THREE.Group();
  group.name = "Detailed gibbous moon and atmospheric halo";

  const haloOuter = new THREE.Mesh(
    new THREE.CircleGeometry(8.8, 96),
    diskMaterial(0x7390a8, 0.018, THREE.AdditiveBlending),
  );
  const haloInner = new THREE.Mesh(
    new THREE.CircleGeometry(4.3, 96),
    diskMaterial(0xb9d0dd, 0.045, THREE.AdditiveBlending),
  );
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(2.15, 128),
    diskMaterial(0xfff0d0, 1),
  );
  haloOuter.position.z = -0.08;
  haloInner.position.z = -0.04;
  group.add(haloOuter, haloInner, disk);

  const mariaMaterial = diskMaterial(0x7c8584, 0.18);
  const maria = [
    [-0.62, 0.55, 0.38, 0.62],
    [0.41, 0.62, 0.31, 0.74],
    [0.72, -0.25, 0.42, 0.68],
    [-0.36, -0.61, 0.27, 0.58],
    [0.05, 0.03, 0.18, 0.72],
    [-0.94, -0.02, 0.17, 0.51],
    [0.22, -0.82, 0.13, 0.64],
  ];
  for (const [x, y, radius, squash] of maria) {
    const crater = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), mariaMaterial);
    crater.position.set(x, y, 0.025);
    crater.scale.y = squash;
    crater.rotation.z = x * 0.23;
    group.add(crater);
  }
  group.traverse(object => { object.userData.rtxIgnore = true; });
  group.renderOrder = -800;
  return group;
}

function createHighHaze() {
  const geometry = new THREE.BufferGeometry();
  const random = seededRandom(0x68617a65);
  const positions = [];
  for (let index = 0; index < 420; ++index) {
    const angle = random() * Math.PI * 2;
    const radius = 110 + random() * 155;
    positions.push(
      Math.cos(angle) * radius,
      24 + Math.pow(random(), 0.72) * 58,
      Math.sin(angle) * radius,
    );
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsNodeMaterial({
    color: 0x66717a,
    size: 2.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.018,
    depthWrite: false,
    fog: false,
    blending: THREE.NormalBlending,
  });
  material.toneMapped = false;
  const haze = new THREE.Points(geometry, material);
  haze.name = "Sparse high night haze";
  haze.frustumCulled = false;
  haze.userData.rtxIgnore = true;
  return haze;
}

export function createNightAtmosphere(scene) {
  const root = new THREE.Group();
  root.name = "Camera-centred 9 PM sky";
  const sky = createSkyDome();
  const stars = createStars();
  const moon = createMoon();
  const haze = createHighHaze();

  // Keep the moon inside the opening ridge composition rather than just above
  // its 51-degree vertical field of view.
  const moonDirection = new THREE.Vector3(-0.32, 0.40, -0.858).normalize();
  moon.position.copy(moonDirection).multiplyScalar(920);
  // Preserve the authored angular size after moving the celestial shell
  // beyond the enlarged mountain terrain.
  moon.scale.setScalar(920 / 273);
  root.add(sky, stars, haze, moon);
  scene.add(root);

  const moonLight = new THREE.DirectionalLight(0xb3c0c3, 2.2);
  moonLight.name = "Cold gibbous moon key";
  moonLight.position.copy(moonDirection).multiplyScalar(92);
  moonLight.target.position.set(-4, 8, -42);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  moonLight.shadow.camera.left = -175;
  moonLight.shadow.camera.right = 175;
  moonLight.shadow.camera.top = 175;
  moonLight.shadow.camera.bottom = -175;
  moonLight.shadow.camera.near = 0.5;
  moonLight.shadow.camera.far = 520;
  moonLight.shadow.bias = -0.00022;
  moonLight.shadow.normalBias = 0.032;

  const hemisphere = new THREE.HemisphereLight(0x304555, 0x1d1812, 0.46);
  hemisphere.name = "Night sky and warm earth hemisphere";
  const ambient = new THREE.AmbientLight(0x202a2d, 0.08);
  scene.add(moonLight, moonLight.target, hemisphere, ambient);

  return {
    root,
    sky,
    stars,
    moon,
    haze,
    moonDirection,
    moonLight,
    update(time, camera) {
      root.position.copy(camera.position);
      moon.quaternion.copy(camera.quaternion);
      stars.rotation.y = time * 0.000035;
      haze.rotation.y = time * 0.0018;
    },
    dispose() {
      root.traverse(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
        else object.material?.dispose?.();
      });
      scene.remove(root, moonLight, moonLight.target, hemisphere, ambient);
    },
  };
}
