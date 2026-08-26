import * as THREE from "three/webgpu";
import {
  accretionPower,
  createAccretionDiskMaterial,
  createCoronaMaterial,
  createJetMaterial,
  createPhotosphereMaterial,
  createProminenceMaterial,
  createVacuumMaterial,
  stellarOpacity,
  stellarRadiance,
  stellarShift,
  updateMaterialClock,
} from "./celestial-materials.mjs";
import {
  disruptionEnvelope,
  encounterPhase,
  gravitationalRedshift,
  localGeodesicSpeedFraction,
  relativisticDopplerFactor,
  sampleCaptureTrajectory,
  trajectoryCartesian,
} from "./relativity-model.mjs";

const STREAM_PARTICLES = 1_600;
const DEBRIS_CHUNKS = 120;
const STREAM_QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);

const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = (minimum, maximum, value) => {
  const t = clamp01((value - minimum) / Math.max(1e-9, maximum - minimum));
  return t * t * (3 - 2 * t);
};

function seededRandom(seed = 0x53554e) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function celestialQuadGeometry(records) {
  const positions = new Float32Array(records.length * 4 * 3);
  const colors = new Float32Array(records.length * 4 * 3);
  const indices = new Uint32Array(records.length * 6);
  const direction = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const alternate = new THREE.Vector3(1, 0, 0);
  for (let index = 0; index < records.length; ++index) {
    const record = records[index];
    direction.copy(record.position).normalize();
    tangent.crossVectors(direction, Math.abs(direction.y) > 0.92 ? alternate : up).normalize();
    bitangent.crossVectors(direction, tangent).normalize();
    const half = record.size * 0.5;
    const corners = [
      [-1, -1], [1, -1], [1, 1], [-1, 1],
    ];
    for (let corner = 0; corner < 4; ++corner) {
      const vertex = index * 4 + corner;
      const offset = vertex * 3;
      const [tx, ty] = corners[corner];
      positions[offset] = record.position.x + tangent.x * tx * half + bitangent.x * ty * half;
      positions[offset + 1] = record.position.y + tangent.y * tx * half + bitangent.y * ty * half;
      positions[offset + 2] = record.position.z + tangent.z * tx * half + bitangent.z * ty * half;
      colors[offset] = record.color.r;
      colors[offset + 1] = record.color.g;
      colors[offset + 2] = record.color.b;
    }
    const vertex = index * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], index * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createStarField() {
  const random = seededRandom(0x474c454e);
  const count = 7_200;
  const records = [];
  for (let index = 0; index < count; ++index) {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = 155 + random() * 9;
    const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
    const warmth = random();
    const rare = Math.pow(random(), 10);
    const brightness = 0.18 + Math.pow(random(), 6) * 1.15 + rare * 2.6;
    records.push({
      position: new THREE.Vector3(
        Math.cos(angle) * horizontal * radius,
        z * radius,
        Math.sin(angle) * horizontal * radius,
      ),
      color: new THREE.Color().setRGB(
        brightness * (0.74 + warmth * 0.34),
        brightness * (0.83 + warmth * 0.13),
        brightness * (1.09 - warmth * 0.28),
      ),
      size: 0.10 + Math.pow(random(), 7) * 0.46,
    });
  }
  const geometry = celestialQuadGeometry(records);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "HDR stellar lensing reference field",
    vertexColors: true,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = true;
  const stars = new THREE.Mesh(geometry, material);
  stars.name = "Procedural background stars bent by the Schwarzschild pass";
  stars.frustumCulled = false;
  stars.renderOrder = -900;
  stars.userData.rtxIgnore = true;
  return stars;
}

function createMilkyWayDust() {
  const random = seededRandom(0x4d494c4b);
  const count = 1_500;
  const records = [];
  for (let index = 0; index < count; ++index) {
    const longitude = random() * Math.PI * 2;
    const latitude = (random() + random() + random() - 1.5) * 0.11
      + Math.sin(longitude * 2.7) * 0.035;
    const radius = 151 + random() * 6;
    const horizontal = Math.cos(latitude);
    const brightness = 0.09 + Math.pow(random(), 2.8) * 0.42;
    records.push({
      position: new THREE.Vector3(
        Math.cos(longitude) * horizontal * radius,
        Math.sin(latitude) * radius,
        Math.sin(longitude) * horizontal * radius,
      ),
      color: new THREE.Color().setRGB(brightness * 1.08, brightness * 0.78, brightness * 1.18),
      size: 0.24 + random() * 0.58,
    });
  }
  const geometry = celestialQuadGeometry(records);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Sparse galactic dust resolved into points",
    vertexColors: true,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = true;
  const dust = new THREE.Mesh(geometry, material);
  dust.name = "Milky Way band revealing gravitational shear";
  dust.frustumCulled = false;
  dust.renderOrder = -890;
  dust.userData.rtxIgnore = true;
  return dust;
}

function createRadialTexture(size = 192) {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const px = (x + 0.5) / size * 2 - 1;
      const py = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(px, py);
      const core = Math.exp(-radius * radius * 8.5);
      const halo = Math.exp(-radius * 4.1) * 0.43;
      const alpha = clamp01((core + halo) * (1 - smoothstep(0.72, 1.04, radius)));
      const offset = (y * size + x) * 4;
      bytes[offset] = 255;
      bytes[offset + 1] = 187;
      bytes[offset + 2] = 83;
      bytes[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Procedural HDR solar corona falloff";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createSoftDiscTexture(size = 64) {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const px = (x + 0.5) / size * 2 - 1;
      const py = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(px, py);
      const alpha = Math.exp(-radius * radius * 5.8) * (1 - smoothstep(0.76, 1.04, radius));
      const offset = (y * size + x) * 4;
      bytes[offset] = 255;
      bytes[offset + 1] = 255;
      bytes[offset + 2] = 255;
      bytes[offset + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Procedural soft plasma mote";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createSun(system, sceneScale) {
  const root = new THREE.Group();
  root.name = "Tidally disrupted solar twin";
  const deformation = new THREE.Group();
  deformation.name = "Volume-preserving Roche deformation frame";
  root.add(deformation);

  const radius = system.starRadiusM * sceneScale;
  const photosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    createPhotosphereMaterial(),
  );
  photosphere.name = "True-scale solar photosphere";
  photosphere.renderOrder = 20;
  deformation.add(photosphere);

  const chromosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.055, 72, 48),
    createCoronaMaterial({ inner: true }),
  );
  chromosphere.name = "Chromospheric limb emission";
  chromosphere.renderOrder = 21;
  deformation.add(chromosphere);

  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.32, 64, 40),
    createCoronaMaterial(),
  );
  corona.name = "Resolved inner corona";
  corona.renderOrder = 22;
  deformation.add(corona);

  const prominenceMaterial = createProminenceMaterial();
  const random = seededRandom(0x50524f4d);
  const prominences = [];
  for (let index = 0; index < 5; ++index) {
    const arc = Math.PI * (0.22 + random() * 0.36);
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (1.07 + random() * 0.19), radius * (0.018 + random() * 0.018), 7, 36, arc),
      prominenceMaterial,
    );
    mesh.name = `Solar magnetic prominence ${index + 1}`;
    mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    mesh.renderOrder = 23;
    deformation.add(mesh);
    prominences.push(mesh);
  }

  const glowTexture = createRadialTexture();
  const glowMaterial = new THREE.SpriteNodeMaterial({
    name: "Extended optically thin solar corona",
    map: glowTexture,
    color: new THREE.Color(0xffa13b).multiplyScalar(2.7),
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  glowMaterial.toneMapped = true;
  const glow = new THREE.Sprite(glowMaterial);
  glow.name = "Camera-facing extended solar corona";
  glow.scale.setScalar(radius * 7.6);
  glow.renderOrder = 19;

  const light = new THREE.PointLight(0xffb65d, 115, 18, 1.6);
  light.name = "Solar debris key light";
  light.castShadow = false;

  root.traverse(object => { object.userData.rtxIgnore = true; });
  return { root, deformation, photosphere, chromosphere, corona, prominences, glow, glowTexture, light, radius };
}

function createBlackHole(sceneScale) {
  const root = new THREE.Group();
  root.name = "Schwarzschild black hole and relativistic flow";

  const horizonMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Non-emissive event horizon absorber",
    color: 0x000000,
    depthWrite: true,
    depthTest: true,
  });
  horizonMaterial.toneMapped = false;
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(2 * sceneScale, 80, 56),
    horizonMaterial,
  );
  horizon.name = "Physical 2M event horizon (shadow is generated by lensing)";
  horizon.renderOrder = 50;
  root.add(horizon);

  const disk = new THREE.Mesh(
    new THREE.RingGeometry(6, 44, 320, 72),
    createAccretionDiskMaterial(),
  );
  disk.name = "6M ISCO to 44M relativistic debris disk";
  disk.scale.setScalar(sceneScale);
  disk.rotation.x = -Math.PI * 0.5;
  disk.renderOrder = 8;
  root.add(disk);

  const veil = new THREE.Mesh(
    new THREE.RingGeometry(5.8, 46, 256, 56),
    createAccretionDiskMaterial({ veil: true }),
  );
  veil.name = "Optically thin disk atmosphere";
  veil.scale.setScalar(sceneScale);
  veil.scale.z = 1.08;
  veil.rotation.x = -Math.PI * 0.5;
  veil.position.y = 0.012;
  veil.renderOrder = 9;
  root.add(veil);

  const impactMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Circularization shock at L squared",
    color: new THREE.Color(0xcfeeff).multiplyScalar(4.2),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  impactMaterial.toneMapped = true;
  const impact = new THREE.Mesh(
    new THREE.TorusGeometry(15.84 * sceneScale, 0.095, 10, 128, Math.PI * 1.3),
    impactMaterial,
  );
  impact.name = "Ballistic stream self-intersection shock near 15.84M";
  impact.rotation.x = Math.PI * 0.5;
  impact.rotation.z = -0.85;
  impact.renderOrder = 18;
  root.add(impact);

  const jets = [];
  const jetDefinitions = [
    [0x69c8ff, 0.075, 0.46, 20],
    [0xd9f5ff, 0.12, 0.20, 15],
  ];
  for (const [colorValue, opacity, radius, height] of jetDefinitions) {
    for (const direction of [-1, 1]) {
      const material = createJetMaterial(colorValue, opacity);
      material.opacity = 0;
      const jet = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 32, 1, true),
        material,
      );
      jet.name = `${direction > 0 ? "North" : "South"} polar outflow`;
      jet.position.y = direction * height * 0.5;
      jet.rotation.z = direction < 0 ? Math.PI : 0;
      jet.renderOrder = 7;
      root.add(jet);
      jets.push(jet);
    }
  }

  root.traverse(object => { object.userData.rtxIgnore = true; });
  return { root, horizon, disk, veil, impact, jets };
}

function createStreamField() {
  const random = seededRandom(0x54444542);
  const positions = new Float32Array(STREAM_PARTICLES * 4 * 3);
  const colors = new Float32Array(STREAM_PARTICLES * 4 * 3);
  const uvs = new Float32Array(STREAM_PARTICLES * 4 * 2);
  const indices = new Uint32Array(STREAM_PARTICLES * 6);
  const descriptors = [];
  for (let index = 0; index < STREAM_PARTICLES; ++index) {
    const arm = index % 2 === 0 ? 1 : -1;
    descriptors.push({
      arm,
      lag: Math.pow(random(), 0.72),
      birth: Math.pow(random(), 1.35),
      lateral: (random() * 2 - 1) * (0.18 + random() * 0.82),
      vertical: (random() * 2 - 1) * (0.12 + random() * 0.88),
      phase: random() * Math.PI * 2,
      heat: random(),
    });
    const vertex = index * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], index * 6);
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], index * 8);
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", colorAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const texture = createSoftDiscTexture();
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Ballistic stellar plasma stream",
    map: texture,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Leading and trailing tidal debris arms";
  mesh.frustumCulled = false;
  mesh.renderOrder = 28;
  mesh.userData.rtxIgnore = true;
  return { mesh, geometry, positions, colors, descriptors, texture };
}

function createDebrisChunks() {
  const random = seededRandom(0x4348554e);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Dense incandescent stellar knots",
    color: 0xffffff,
  });
  material.toneMapped = true;
  const mesh = new THREE.InstancedMesh(geometry, material, DEBRIS_CHUNKS);
  mesh.name = "Resolved knots embedded in the tidal stream";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 27;
  mesh.userData.rtxIgnore = true;
  const descriptors = [];
  for (let index = 0; index < DEBRIS_CHUNKS; ++index) {
    const arm = index % 3 === 0 ? -1 : 1;
    const heat = random();
    descriptors.push({
      arm,
      lag: Math.pow(random(), 0.8),
      birth: Math.pow(random(), 1.2),
      lateral: random() * 2 - 1,
      vertical: random() * 2 - 1,
      phase: random() * Math.PI * 2,
      shortRadius: 0.010 + random() * 0.014,
      longRadius: 0.025 + random() * 0.045,
      spin: 0.4 + random() * 2.4,
    });
    mesh.setColorAt(index, new THREE.Color().setRGB(
      1.45 + heat * 1.25,
      0.28 + heat * 0.88,
      0.04 + heat * heat * 0.72,
    ));
  }
  mesh.instanceColor.needsUpdate = true;
  return { mesh, descriptors };
}

function shiftedPlasmaColor(shift, heat, intensity) {
  const g = Math.min(1.8, Math.max(0.24, shift));
  const warm = new THREE.Color(0xff3208);
  const solar = new THREE.Color(0xffc45e);
  const white = new THREE.Color(0xfff1cd);
  const blue = new THREE.Color(0xbddfff);
  const result = g < 1
    ? warm.clone().lerp(solar, smoothstep(0.28, 1, g))
    : white.clone().lerp(blue, smoothstep(1, 1.62, g));
  result.lerp(white, heat * 0.24);
  return result.multiplyScalar(intensity * Math.pow(g, 3));
}

function trajectoryWorld(trajectory, progress, sceneScale, target = new THREE.Vector3()) {
  const sample = sampleCaptureTrajectory(trajectory, progress);
  const point = trajectoryCartesian(sample, sceneScale);
  return target.set(point.x, point.y, point.z);
}

export function createTidalDisruptionScene(scene, {
  system,
  trajectory,
  sceneScale = 0.15,
} = {}) {
  const world = new THREE.Group();
  world.name = "RTX Tidal Rupture world";
  scene.add(world);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 80, 48), createVacuumMaterial());
  sky.name = "Procedural vacuum and Milky Way dome";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.userData.rtxIgnore = true;
  const stars = createStarField();
  const galacticDust = createMilkyWayDust();
  world.add(sky, stars, galacticDust);

  const blackHole = createBlackHole(sceneScale);
  world.add(blackHole.root);

  const sun = createSun(system, sceneScale);
  world.add(sun.root, sun.glow, sun.light);

  const stream = createStreamField();
  const chunks = createDebrisChunks();
  world.add(stream.mesh, chunks.mesh);

  const starToHole = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const following = new THREE.Vector3();
  const particlePosition = new THREE.Vector3();
  const chunkMatrix = new THREE.Matrix4();
  const chunkQuaternion = new THREE.Quaternion();
  const chunkSpinQuaternion = new THREE.Quaternion();
  const chunkScale = new THREE.Vector3();
  const streamRight = new THREE.Vector3();
  const streamUp = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  let lastTelemetry = null;

  function velocityAt(progress, target = new THREE.Vector3()) {
    trajectoryWorld(trajectory, Math.max(0, progress - 0.00035), sceneScale, previous);
    trajectoryWorld(trajectory, Math.min(1, progress + 0.00035), sceneScale, following);
    return target.copy(following).sub(previous).normalize();
  }

  function streamPosition(descriptor, progress, stripped, time, target) {
    const reach = (0.025 + stripped * 0.34) * descriptor.lag;
    const sampleProgress = clamp01(progress + descriptor.arm * reach);
    trajectoryWorld(trajectory, sampleProgress, sceneScale, target);
    radial.copy(target).normalize();
    tangent.set(-radial.z, 0, radial.x);
    const thickness = sun.radius * (
      0.08 + (1 - descriptor.lag) * 0.28 + descriptor.lag * descriptor.lag * 0.18
    );
    const wave = Math.sin(descriptor.phase + time * (0.9 + descriptor.heat * 0.8));
    target.addScaledVector(tangent, descriptor.lateral * thickness * (0.45 + stripped));
    target.y += descriptor.vertical * thickness * 0.72 + wave * thickness * 0.18;
    return { sampleProgress, target };
  }

  function updateStream(progress, envelope, time, camera) {
    const activation = smoothstep(0.015, 0.98, envelope.strippedFraction);
    streamRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    streamUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    let activeStreamParticles = 0;
    for (let index = 0; index < STREAM_PARTICLES; ++index) {
      const descriptor = stream.descriptors[index];
      if (descriptor.birth > activation) continue;
      const offset = activeStreamParticles * 4 * 3;
      const result = streamPosition(descriptor, progress, activation, time, particlePosition);

      const sample = sampleCaptureTrajectory(trajectory, result.sampleProgress);
      velocityAt(result.sampleProgress, velocity);
      toCamera.copy(camera.position).sub(particlePosition).normalize();
      const beta = localGeodesicSpeedFraction(sample.rM, trajectory.energy);
      const shift = gravitationalRedshift(sample.rM)
        * relativisticDopplerFactor(beta, velocity.dot(toCamera));
      const intensity = 0.65 + activation * 1.85 + descriptor.heat * 0.46;
      const tint = shiftedPlasmaColor(shift, descriptor.heat, intensity);
      const halfSize = Math.min(0.042, sun.radius
        * (0.05 + 0.055 * (1 - descriptor.lag) + 0.045 * descriptor.heat)
        * (0.55 + 0.45 * activation));
      for (let corner = 0; corner < 4; ++corner) {
        const cornerOffset = offset + corner * 3;
        const horizontal = STREAM_QUAD_CORNERS[corner * 2] * halfSize;
        const vertical = STREAM_QUAD_CORNERS[corner * 2 + 1] * halfSize;
        stream.positions[cornerOffset] = particlePosition.x
          + streamRight.x * horizontal + streamUp.x * vertical;
        stream.positions[cornerOffset + 1] = particlePosition.y
          + streamRight.y * horizontal + streamUp.y * vertical;
        stream.positions[cornerOffset + 2] = particlePosition.z
          + streamRight.z * horizontal + streamUp.z * vertical;
        stream.colors[cornerOffset] = tint.r;
        stream.colors[cornerOffset + 1] = tint.g;
        stream.colors[cornerOffset + 2] = tint.b;
      }
      activeStreamParticles += 1;
    }
    stream.geometry.setDrawRange(0, activeStreamParticles * 6);
    stream.geometry.getAttribute("position").needsUpdate = true;
    stream.geometry.getAttribute("color").needsUpdate = true;

    for (let index = 0; index < DEBRIS_CHUNKS; ++index) {
      const descriptor = chunks.descriptors[index];
      if (descriptor.birth > activation * 0.92) {
        chunkMatrix.makeScale(0, 0, 0);
        chunks.mesh.setMatrixAt(index, chunkMatrix);
        continue;
      }
      streamPosition({ ...descriptor, heat: 0.5 }, progress, activation, time, particlePosition);
      chunkQuaternion.setFromUnitVectors(xAxis, tangent);
      chunkSpinQuaternion.setFromAxisAngle(
        tangent,
        time * descriptor.spin + descriptor.phase,
      );
      chunkQuaternion.premultiply(chunkSpinQuaternion);
      const reveal = 0.55 + activation * 0.45;
      const shortRadius = descriptor.shortRadius * reveal;
      const longRadius = descriptor.longRadius * reveal;
      chunkScale.set(longRadius, shortRadius, shortRadius * 0.82);
      chunkMatrix.compose(particlePosition, chunkQuaternion, chunkScale);
      chunks.mesh.setMatrixAt(index, chunkMatrix);
    }
    chunks.mesh.instanceMatrix.needsUpdate = true;
  }

  function update({ time = 0, progress = 0, camera }) {
    updateMaterialClock(time);
    const sample = sampleCaptureTrajectory(trajectory, progress);
    const envelope = disruptionEnvelope(sample.rM, system);
    const point = trajectoryCartesian(sample, sceneScale);
    sun.root.position.set(point.x, point.y, point.z);
    sun.glow.position.copy(sun.root.position);
    sun.light.position.copy(sun.root.position);

    starToHole.copy(sun.root.position).negate().normalize();
    sun.deformation.quaternion.setFromUnitVectors(xAxis, starToHole);
    sun.deformation.scale.set(envelope.stretch, envelope.transverse, envelope.transverse);
    const glowStretch = Math.sqrt(envelope.stretch);
    sun.glow.scale.set(
      sun.radius * 7.6 * glowStretch,
      sun.radius * 7.6 * Math.max(0.62, envelope.transverse),
      1,
    );
    sun.glow.material.opacity = 0.22 + envelope.boundFraction * 0.54;
    sun.light.intensity = 18 + envelope.boundFraction * 105;
    sun.light.distance = 12 + envelope.stretch * 1.2;
    sun.prominences.forEach((prominence, index) => {
      prominence.rotation.z += 0.0018 * (index % 2 ? -1 : 1);
    });

    velocityAt(progress, velocity);
    toCamera.copy(camera.position).sub(sun.root.position).normalize();
    const beta = localGeodesicSpeedFraction(sample.rM, trajectory.energy);
    const shift = gravitationalRedshift(sample.rM)
      * relativisticDopplerFactor(beta, velocity.dot(toCamera));
    stellarShift.value = Math.min(1.55, Math.max(0.28, shift));
    stellarRadiance.value = Math.min(3.4, Math.max(0.06, Math.pow(shift, 4) * 0.92));
    stellarOpacity.value = envelope.boundFraction;

    updateStream(progress, envelope, time, camera);
    const latePower = smoothstep(0.20, 0.92, envelope.strippedFraction);
    accretionPower.value = 0.12 + latePower * 1.08;
    blackHole.disk.rotation.z = time * 0.006;
    blackHole.veil.rotation.z = -time * 0.009;
    blackHole.impact.rotation.z = -0.85 + time * 0.035;
    blackHole.impact.material.opacity = latePower * 0.84;
    const jetPower = smoothstep(0.7, 1, envelope.strippedFraction)
      * smoothstep(0.58, 0.98, progress);
    for (const jet of blackHole.jets) {
      jet.material.opacity = jetPower * (jet.geometry.parameters.radius > 0.3 ? 0.075 : 0.13);
      jet.scale.y = 0.18 + jetPower * 0.82;
    }

    lastTelemetry = {
      sample,
      envelope,
      phase: encounterPhase(sample.rM, system),
      speedFraction: beta,
      observedShift: shift,
      starPosition: sun.root.position.clone(),
      progress,
    };
    return lastTelemetry;
  }

  function dispose() {
    world.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
      else object.material?.dispose?.();
    });
    sun.glowTexture.dispose();
    stream.texture.dispose();
    scene.remove(world);
  }

  return {
    world,
    sky,
    stars,
    galacticDust,
    blackHole,
    sun,
    stream,
    chunks,
    sceneScale,
    update,
    dispose,
    get telemetry() { return lastTelemetry; },
  };
}
