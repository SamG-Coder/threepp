import * as THREE from "three/webgpu";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function smootherStep(value) {
  const x = clamp01(value);
  return clamp01(x * x * x * (x * (x * 6 - 15) + 10));
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

function gaussian(random) {
  const u = Math.max(1e-8, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function makeCameraSampler(
  cameraControlPoints,
  targetControlPoints,
  fov = [46, 41],
  clip = [0.002, 90],
) {
  const cameraCurve = new THREE.CatmullRomCurve3(
    cameraControlPoints.map(point => new THREE.Vector3(...point)),
    false,
    "centripetal",
    0.5,
  );
  const targetCurve = new THREE.CatmullRomCurve3(
    targetControlPoints.map(point => new THREE.Vector3(...point)),
    false,
    "centripetal",
    0.5,
  );
  const sampledCamera = new THREE.Vector3();
  const sampledTarget = new THREE.Vector3();

  return (t, camera, target) => {
    const progress = smootherStep(t);
    cameraCurve.getPointAt(progress, sampledCamera);
    targetCurve.getPointAt(progress, sampledTarget);
    camera.position.copy(sampledCamera);
    if (target?.copy) target.copy(sampledTarget);
    camera.fov = THREE.MathUtils.lerp(fov[0], fov[1], progress);
    camera.near = THREE.MathUtils.lerp(clip[0] * 5, clip[0], progress);
    camera.far = clip[1];
    camera.lookAt(sampledTarget);
  };
}

function makePointField({
  name,
  positions,
  colors,
  size,
  opacity = 1,
  blending = THREE.AdditiveBlending,
}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colors?.length) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  const material = new THREE.PointsNodeMaterial({
    color: colors?.length ? 0xffffff : 0xb9e6ff,
    vertexColors: Boolean(colors?.length),
    size,
    sizeAttenuation: true,
    transparent: opacity < 1 || blending === THREE.AdditiveBlending,
    opacity,
    depthWrite: false,
    blending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.frustumCulled = false;
  points.userData.rtxIgnore = true;
  return points;
}

function disposeOwnedTree(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material ? [object.material] : [];
    for (const material of objectMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
  root.clear();
}

function setCylinderBetween(dummy, start, end, radiusScale = 1) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  dummy.position.copy(start).add(end).multiplyScalar(0.5);
  dummy.quaternion.setFromUnitVectors(UP, direction.multiplyScalar(1 / Math.max(length, 1e-6)));
  dummy.scale.set(radiusScale, length, radiusScale);
  dummy.updateMatrix();
}

function makeDomainResult(id, root, sampleCamera, update) {
  let disposed = false;
  return {
    id,
    root,
    sampleCamera,
    update(time = 0, delta = 0, t = 0) {
      if (!disposed) update(Number(time) || 0, Number(delta) || 0, clamp01(t));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeOwnedTree(root);
    },
  };
}

/**
 * Build a physically inspired iron BCC lattice. Each body-centred site is
 * joined to the eight corners of its own unit cell; corner and body sites use
 * different tints only to make the two interpenetrating sets legible.
 */
export function buildBccCrystalDomain() {
  const root = new THREE.Group();
  root.name = "CRYSTAL domain — body-centred cubic iron lattice";
  root.userData.scaleDomain = "CRYSTAL";
  const latticeContent = new THREE.Group();
  latticeContent.name = "Slowly precessing BCC lattice contents";
  root.add(latticeContent);

  const cells = { x: 7, y: 5, z: 11 };
  const spacing = 1.55;
  const corners = [];
  const centers = [];

  for (let iz = 0; iz <= cells.z; ++iz) {
    for (let iy = 0; iy <= cells.y; ++iy) {
      for (let ix = 0; ix <= cells.x; ++ix) {
        corners.push(new THREE.Vector3(
          (ix - cells.x * 0.5) * spacing,
          (iy - cells.y * 0.5) * spacing,
          (iz - cells.z * 0.5) * spacing,
        ));
      }
    }
  }
  for (let iz = 0; iz < cells.z; ++iz) {
    for (let iy = 0; iy < cells.y; ++iy) {
      for (let ix = 0; ix < cells.x; ++ix) {
        centers.push(new THREE.Vector3(
          (ix + 0.5 - cells.x * 0.5) * spacing,
          (iy + 0.5 - cells.y * 0.5) * spacing,
          (iz + 0.5 - cells.z * 0.5) * spacing,
        ));
      }
    }
  }

  const atomGeometry = new THREE.IcosahedronGeometry(0.175, 2);
  const cornerMaterial = new THREE.MeshStandardNodeMaterial({
    name: "BCC iron corner sites",
    color: 0x96b9cf,
    roughness: 0.2,
    metalness: 0.72,
    emissive: 0x173b54,
    emissiveIntensity: 1.45,
  });
  const centerMaterial = new THREE.MeshStandardNodeMaterial({
    name: "BCC iron body-centre sites",
    color: 0xffb06c,
    roughness: 0.2,
    metalness: 0.62,
    emissive: 0x7d2c0d,
    emissiveIntensity: 1.85,
  });
  const cornerAtoms = new THREE.InstancedMesh(atomGeometry, cornerMaterial, corners.length);
  const centerAtoms = new THREE.InstancedMesh(atomGeometry, centerMaterial, centers.length);
  cornerAtoms.name = "BCC shared corner atoms";
  centerAtoms.name = "BCC body-centre atoms";
  const dummy = new THREE.Object3D();
  corners.forEach((position, index) => {
    dummy.position.copy(position);
    dummy.quaternion.identity();
    dummy.scale.setScalar(0.82 + 0.18 * Math.sin(index * 2.399963));
    dummy.updateMatrix();
    cornerAtoms.setMatrixAt(index, dummy.matrix);
  });
  centers.forEach((position, index) => {
    dummy.position.copy(position);
    dummy.quaternion.identity();
    dummy.scale.setScalar(1.06);
    dummy.updateMatrix();
    centerAtoms.setMatrixAt(index, dummy.matrix);
  });
  cornerAtoms.instanceMatrix.needsUpdate = true;
  centerAtoms.instanceMatrix.needsUpdate = true;
  latticeContent.add(cornerAtoms, centerAtoms);

  const bondGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
  const bondMaterial = new THREE.MeshBasicNodeMaterial({
    name: "BCC nearest-neighbour bonds",
    color: 0x6bbfe2,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bondCount = cells.x * cells.y * cells.z * 8;
  const bonds = new THREE.InstancedMesh(bondGeometry, bondMaterial, bondCount);
  bonds.name = "Eight nearest neighbours per BCC body site";
  bonds.userData.rtxIgnore = true;
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  let bondIndex = 0;
  for (let iz = 0; iz < cells.z; ++iz) {
    for (let iy = 0; iy < cells.y; ++iy) {
      for (let ix = 0; ix < cells.x; ++ix) {
        start.set(
          (ix + 0.5 - cells.x * 0.5) * spacing,
          (iy + 0.5 - cells.y * 0.5) * spacing,
          (iz + 0.5 - cells.z * 0.5) * spacing,
        );
        for (let dz = 0; dz <= 1; ++dz) {
          for (let dy = 0; dy <= 1; ++dy) {
            for (let dx = 0; dx <= 1; ++dx) {
              end.set(
                (ix + dx - cells.x * 0.5) * spacing,
                (iy + dy - cells.y * 0.5) * spacing,
                (iz + dz - cells.z * 0.5) * spacing,
              );
              setCylinderBetween(dummy, start, end);
              bonds.setMatrixAt(bondIndex++, dummy.matrix);
            }
          }
        }
      }
    }
  }
  bonds.instanceMatrix.needsUpdate = true;
  latticeContent.add(bonds);

  const selectedMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Selected iron atom transition halo",
    color: 0xffcf8a,
    wireframe: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const selectedHalo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.54, 2), selectedMaterial);
  selectedHalo.name = "Selected central body-centred iron atom";
  selectedHalo.userData.rtxIgnore = true;
  latticeContent.add(selectedHalo);

  const sampleCamera = makeCameraSampler(
    [[3.8, 2.5, 14.4], [2.35, 1.25, 10.2], [0.95, 0.48, 5.8], [0.12, 0.05, 1.22]],
    [[0.4, 0.2, 4.2], [0.25, 0.12, 1.4], [0.08, 0.03, 0.2], [0, 0, -0.65]],
  );

  return makeDomainResult("crystal", root, sampleCamera, (time, _delta, t) => {
    latticeContent.rotation.y = Math.sin(time * 0.09) * 0.055;
    latticeContent.rotation.x = Math.sin(time * 0.071 + 0.8) * 0.025;
    const pulse = 1 + Math.sin(time * 2.1) * (0.025 + t * 0.025);
    selectedHalo.scale.setScalar(pulse);
    selectedHalo.rotation.x = time * 0.31;
    selectedHalo.rotation.y = time * 0.43;
    selectedMaterial.opacity = 0.44 + 0.28 * (0.5 + 0.5 * Math.sin(time * 2.1));
  });
}

function electronCloudSample(random, index) {
  const lobeDirections = [
    [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
    [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
    [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
  ];
  const orbital = index % 10;
  const radial = Math.min(
    8.2,
    -Math.log(Math.max(1e-8, random() * random() * random())) * (orbital < 4 ? 0.72 : 1.05),
  );
  let direction;
  if (random() < 0.56) {
    const z = random() * 2 - 1;
    const angle = random() * TAU;
    const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
    direction = new THREE.Vector3(Math.cos(angle) * horizontal, z, Math.sin(angle) * horizontal);
  } else {
    const lobe = lobeDirections[Math.floor(random() * lobeDirections.length)];
    direction = new THREE.Vector3(...lobe).normalize();
    direction.x += gaussian(random) * 0.17;
    direction.y += gaussian(random) * 0.17;
    direction.z += gaussian(random) * 0.17;
    direction.normalize();
  }
  return direction.multiplyScalar(0.18 + radial);
}

/** Build one iron atom as a volumetric probability-density visualisation. */
export function buildAtomicDomain() {
  const root = new THREE.Group();
  root.name = "ATOMIC domain — electron probability density";
  root.userData.scaleDomain = "ATOMIC";
  const random = mulberry32(0xa70f1e1d);
  const positions = [];
  const colors = [];
  const count = 10500;
  const position = new THREE.Vector3();
  for (let index = 0; index < count; ++index) {
    position.copy(electronCloudSample(random, index));
    positions.push(position.x, position.y, position.z);
    const radius = position.length();
    const core = Math.exp(-radius * 0.55);
    const lobe = 0.5 + 0.5 * Math.sin(Math.atan2(position.z, position.x) * 4 + radius * 1.35);
    colors.push(
      0.26 + core * 0.74 + lobe * 0.08,
      0.34 + core * 0.52 + (1 - lobe) * 0.18,
      0.72 + core * 0.28,
    );
  }
  const density = makePointField({
    name: "Volumetric iron electron-density samples",
    positions,
    colors,
    size: 0.078,
    opacity: 0.52,
  });
  root.add(density);

  const innerPositions = [];
  const innerColors = [];
  for (let index = 0; index < 2400; ++index) {
    const z = random() * 2 - 1;
    const angle = random() * TAU;
    const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = Math.pow(random(), 1.8) * 2.2;
    innerPositions.push(
      Math.cos(angle) * horizontal * radius,
      z * radius,
      Math.sin(angle) * horizontal * radius,
    );
    const heat = 1 - radius / 2.2;
    innerColors.push(1, 0.38 + heat * 0.52, 0.24 + heat * 0.72);
  }
  const innerDensity = makePointField({
    name: "High-probability inner electron density",
    positions: innerPositions,
    colors: innerColors,
    size: 0.105,
    opacity: 0.72,
  });
  root.add(innerDensity);

  const nucleusMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Atomic nucleus transition core",
    color: 0xffc4a0,
    roughness: 0.2,
    metalness: 0.15,
    emissive: 0xff431f,
    emissiveIntensity: 4.8,
  });
  const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 4), nucleusMaterial);
  nucleus.name = "Iron nucleus transition seed";
  nucleus.userData.rtxStatic = true;
  root.add(nucleus);

  const orbitalMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Electron-density isosurface wisps",
    color: 0x65cfff,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const wisps = new THREE.Group();
  wisps.name = "Probability-density isosurface wisps";
  for (let index = 0; index < 7; ++index) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.2 + index * 0.52, 0.014 + index * 0.002, 5, 128),
      orbitalMaterial,
    );
    ring.name = `Electron-density wisp ${index + 1}`;
    ring.rotation.set(index * 0.41, index * 0.73, index * 0.29);
    ring.userData.rtxIgnore = true;
    wisps.add(ring);
  }
  root.add(wisps);

  const sampleCamera = makeCameraSampler(
    [[3.2, 1.9, 12.8], [2.0, 1.05, 8.7], [0.72, 0.38, 4.3], [0.05, 0.02, 0.78]],
    [[0.25, 0.12, 3.1], [0.14, 0.08, 1.45], [0.04, 0.02, 0.12], [0, 0, -0.45]],
  );

  return makeDomainResult("atomic", root, sampleCamera, (time, _delta, t) => {
    density.rotation.y = time * 0.045;
    density.rotation.x = Math.sin(time * 0.13) * 0.08;
    innerDensity.rotation.y = -time * 0.075;
    innerDensity.rotation.z = Math.sin(time * 0.17) * 0.09;
    wisps.rotation.y = time * 0.12;
    wisps.rotation.x = Math.sin(time * 0.23) * 0.13;
    const pulse = 1 + Math.sin(time * 3.4) * (0.035 + t * 0.02);
    nucleus.scale.setScalar(pulse);
    nucleus.rotation.y = time * 0.38;
    orbitalMaterial.opacity = 0.075 + 0.075 * (0.5 + 0.5 * Math.sin(time * 0.73));
  });
}

function createNucleonLayout() {
  const random = mulberry32(0x1f0e56aa);
  const kinds = Array.from({ length: 56 }, (_, index) => index < 26 ? "proton" : "neutron");
  for (let index = kinds.length - 1; index > 0; --index) {
    const swap = Math.floor(random() * (index + 1));
    [kinds[index], kinds[swap]] = [kinds[swap], kinds[index]];
  }
  const golden = 0.618033988749895;
  return kinds.map((kind, index) => {
    const unitZ = 1 - 2 * ((index * golden + 0.19) % 1);
    const angle = TAU * ((index * 0.754877666246693 + 0.31) % 1);
    const horizontal = Math.sqrt(Math.max(0, 1 - unitZ * unitZ));
    const radius = index === 0 ? 0 : 2.38 * Math.cbrt((index + 0.22) / 56);
    const base = new THREE.Vector3(
      Math.cos(angle) * horizontal * radius,
      unitZ * radius,
      Math.sin(angle) * horizontal * radius,
    );
    return {
      kind,
      base,
      phase: random() * TAU,
      frequency: 2.1 + random() * 1.5,
      vibration: new THREE.Vector3(gaussian(random), gaussian(random), gaussian(random)).normalize(),
    };
  });
}

/** Build an iron-56 nucleus: 26 protons and 30 neutrons in one packed cluster. */
export function buildNucleusDomain() {
  const root = new THREE.Group();
  root.name = "NUCLEUS domain — iron-56 nucleon cluster";
  root.userData.scaleDomain = "NUCLEUS";
  root.userData.protons = 26;
  root.userData.neutrons = 30;

  const layout = createNucleonLayout();
  const protons = layout.filter(item => item.kind === "proton");
  const neutrons = layout.filter(item => item.kind === "neutron");
  const nucleonGeometry = new THREE.IcosahedronGeometry(0.43, 2);
  const protonMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Protons",
    color: 0xff795f,
    roughness: 0.24,
    metalness: 0.08,
    emissive: 0xb51d17,
    emissiveIntensity: 2.5,
  });
  const neutronMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Neutrons",
    color: 0x76b6ff,
    roughness: 0.26,
    metalness: 0.1,
    emissive: 0x174d9b,
    emissiveIntensity: 2.1,
  });
  const protonMesh = new THREE.InstancedMesh(nucleonGeometry, protonMaterial, protons.length);
  const neutronMesh = new THREE.InstancedMesh(nucleonGeometry, neutronMaterial, neutrons.length);
  protonMesh.name = "26 instanced protons";
  neutronMesh.name = "30 instanced neutrons";
  // Their small strong-force vibration remains honest raster geometry instead
  // of being baked at one pose into the immutable scale-atlas TLAS.
  protonMesh.userData.rtxIgnore = true;
  neutronMesh.userData.rtxIgnore = true;
  protonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  neutronMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(protonMesh, neutronMesh);

  const random = mulberry32(0x56c1a55e);
  const fieldPositions = [];
  const fieldColors = [];
  for (let index = 0; index < 5200; ++index) {
    const z = random() * 2 - 1;
    const angle = random() * TAU;
    const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
    const shell = index % 5;
    const radius = 0.7 + shell * 0.72 + Math.pow(random(), 1.7) * 1.1;
    fieldPositions.push(
      Math.cos(angle) * horizontal * radius,
      z * radius,
      Math.sin(angle) * horizontal * radius,
    );
    const mix = shell / 4;
    fieldColors.push(1 - mix * 0.42, 0.25 + mix * 0.44, 0.38 + mix * 0.62);
  }
  const forceField = makePointField({
    name: "Stylised short-range nuclear force field",
    positions: fieldPositions,
    colors: fieldColors,
    size: 0.055,
    opacity: 0.48,
  });
  root.add(forceField);

  const shellMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Nuclear energy shells",
    color: 0xff9bd9,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shells = new THREE.Group();
  for (let index = 0; index < 4; ++index) {
    const shell = new THREE.Mesh(
      new THREE.TorusGeometry(3.25 + index * 0.64, 0.025, 6, 144),
      shellMaterial,
    );
    shell.name = `Nuclear interaction shell ${index + 1}`;
    shell.rotation.set(0.35 + index * 0.49, index * 0.63, index * 0.27);
    shell.userData.rtxIgnore = true;
    shells.add(shell);
  }
  root.add(shells);

  const dummy = new THREE.Object3D();
  function updateInstances(mesh, items, time, amplitude) {
    items.forEach((item, index) => {
      const displacement = Math.sin(time * item.frequency + item.phase) * amplitude;
      dummy.position.copy(item.base).addScaledVector(item.vibration, displacement);
      dummy.quaternion.setFromAxisAngle(item.vibration, time * 0.08 + item.phase);
      dummy.scale.setScalar(1 + Math.sin(time * 2.8 + item.phase) * 0.035);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  updateInstances(protonMesh, protons, 0, 0);
  updateInstances(neutronMesh, neutrons, 0, 0);

  const sampleCamera = makeCameraSampler(
    [[3.1, 2.0, 10.8], [1.8, 1.05, 7.0], [0.62, 0.34, 3.5], [0.06, 0.03, 0.66]],
    [[0.25, 0.16, 2.6], [0.12, 0.07, 1.15], [0.03, 0.02, 0.02], [0, 0, -0.52]],
  );

  return makeDomainResult("nucleus", root, sampleCamera, (time, _delta, t) => {
    const amplitude = 0.028 + t * 0.025;
    updateInstances(protonMesh, protons, time, amplitude);
    updateInstances(neutronMesh, neutrons, time, amplitude);
    forceField.rotation.y = time * 0.11;
    forceField.rotation.x = Math.sin(time * 0.15) * 0.13;
    shells.rotation.y = -time * 0.17;
    shells.rotation.z = Math.sin(time * 0.21) * 0.16;
    shellMaterial.opacity = 0.09 + 0.08 * (0.5 + 0.5 * Math.sin(time * 1.15));
  });
}

function pushColoredPoint(positions, colors, x, y, z, color, jitter, random) {
  positions.push(
    x + gaussian(random) * jitter,
    y + gaussian(random) * jitter,
    z + gaussian(random) * jitter * 0.55,
  );
  colors.push(color[0], color[1], color[2]);
}

function buildForgeSilhouette(random) {
  const positions = [];
  const colors = [];
  const planeZ = -6.4;
  const moon = [0.34, 0.76, 1.0];
  const fire = [1.0, 0.34, 0.08];
  const steel = [0.82, 0.94, 1.0];

  // A cold arched doorway on the left: two piers, an opening and an arch.
  for (let index = 0; index < 1900; ++index) {
    const selector = random();
    let x;
    let y;
    if (selector < 0.38) {
      x = selector < 0.19 ? -5.7 : -1.9;
      y = -2.45 + random() * 5.55;
    } else if (selector < 0.73) {
      const angle = random() * Math.PI;
      x = -3.8 + Math.cos(angle) * 1.9;
      y = 3.05 + Math.sin(angle) * 1.9;
    } else {
      x = -5.7 + random() * 3.8;
      y = -2.45 + random() * 0.24;
    }
    pushColoredPoint(positions, colors, x, y, planeZ, moon, 0.075, random);
  }

  // A readable anvil mass: cap, waist, foot and a tapered horn.
  let accepted = 0;
  while (accepted < 2300) {
    const x = -0.8 + random() * 6.0;
    const y = -2.7 + random() * 3.25;
    const inCap = x < 3.5 && y > -0.3 && y < 0.38;
    const inHorn = x >= 3.25 && y > -0.18 && y < 0.32 - (x - 3.25) * 0.22;
    const inWaist = x > 0.25 && x < 2.55 && y > -1.82 && y <= -0.3 &&
      Math.abs(x - 1.4) < 0.58 + Math.abs(y + 1.05) * 0.42;
    const inFoot = x > -0.15 && x < 3.0 && y >= -2.55 && y <= -1.82;
    if (!(inCap || inHorn || inWaist || inFoot)) continue;
    const ember = 0.55 + random() * 0.45;
    pushColoredPoint(
      positions,
      colors,
      x,
      y,
      planeZ + 0.08,
      [fire[0] * ember, fire[1] * ember, fire[2] * ember],
      0.052,
      random,
    );
    accepted += 1;
  }

  // The hero sword crosses the anvil diagonally; particles define blade,
  // fuller, guard, grip and pommel instead of hiding a solid mesh in the field.
  const bladeStart = new THREE.Vector2(-1.72, 0.28);
  const bladeEnd = new THREE.Vector2(4.72, 1.26);
  const bladeDirection = bladeEnd.clone().sub(bladeStart);
  const bladeLength = bladeDirection.length();
  bladeDirection.normalize();
  const bladeNormal = new THREE.Vector2(-bladeDirection.y, bladeDirection.x);
  for (let index = 0; index < 1700; ++index) {
    const along = Math.pow(random(), 0.82);
    const taper = (1 - along) * 0.15 + 0.035;
    const point = bladeStart.clone()
      .addScaledVector(bladeDirection, along * bladeLength)
      .addScaledVector(bladeNormal, (random() * 2 - 1) * taper);
    const gleam = 0.72 + random() * 0.28;
    pushColoredPoint(positions, colors, point.x, point.y, planeZ + 0.18, [steel[0] * gleam, steel[1] * gleam, gleam], 0.025, random);
  }
  for (let index = 0; index < 420; ++index) {
    const guardOffset = (random() * 2 - 1) * 1.05;
    const point = bladeStart.clone().addScaledVector(bladeNormal, guardOffset);
    pushColoredPoint(positions, colors, point.x, point.y, planeZ + 0.2, fire, 0.035, random);
  }
  for (let index = 0; index < 520; ++index) {
    const along = random() * 1.38;
    const point = bladeStart.clone().addScaledVector(bladeDirection, -along);
    pushColoredPoint(positions, colors, point.x, point.y, planeZ + 0.2, [0.78, 0.3, 0.12], 0.07, random);
  }
  for (let index = 0; index < 260; ++index) {
    const angle = random() * TAU;
    const radius = Math.sqrt(random()) * 0.25;
    const pommel = bladeStart.clone().addScaledVector(bladeDirection, -1.48);
    pushColoredPoint(
      positions,
      colors,
      pommel.x + Math.cos(angle) * radius,
      pommel.y + Math.sin(angle) * radius,
      planeZ + 0.2,
      fire,
      0.025,
      random,
    );
  }

  return { positions, colors };
}

/** Build the abstract energy tunnel that resolves into the original forge. */
export function buildEnergyDomain() {
  const root = new THREE.Group();
  root.name = "ENERGY domain — recursive forge silhouette";
  root.userData.scaleDomain = "ENERGY";
  const random = mulberry32(0xe11e6f0e);

  const tunnelPositions = [];
  const tunnelColors = [];
  for (let index = 0; index < 12000; ++index) {
    const depth = -13 + random() * 27;
    const normalizedDepth = (depth + 13) / 27;
    const radius = 1.6 + Math.pow(random(), 0.52) * (5.2 + normalizedDepth * 4.8);
    const angle = random() * TAU + depth * 0.52 + Math.sin(depth * 0.31) * 0.8;
    tunnelPositions.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.72,
      depth,
    );
    const hot = Math.pow(random(), 3.5);
    tunnelColors.push(
      0.18 + hot * 0.82,
      0.2 + hot * 0.3 + normalizedDepth * 0.16,
      0.52 + (1 - hot) * 0.48,
    );
  }
  const tunnel = makePointField({
    name: "Procedural energy-scattering tunnel",
    positions: tunnelPositions,
    colors: tunnelColors,
    size: 0.075,
    opacity: 0.54,
  });
  root.add(tunnel);

  // A restrained opaque proxy field gives the project ray-query shader real
  // energy-domain intersections without turning twenty thousand luminous
  // points into independent acceleration-structure objects. One shared low-poly
  // geometry becomes 256 instances in the immutable scale-atlas TLAS.
  const rayProxyGeometry = new THREE.IcosahedronGeometry(0.16, 0);
  const rayProxyMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Energy-field ray-query proxies",
    color: 0xb78cff,
    metalness: 0.76,
    roughness: 0.14,
    emissive: 0x51207c,
    emissiveIntensity: 3.2,
  });
  rayProxyMaterial.rtxReflectionMask = 0.94;
  rayProxyMaterial.userData.rtxTriangleRadiance = [1.8, 0.42, 3.6, 1];
  const rayProxies = new THREE.InstancedMesh(rayProxyGeometry, rayProxyMaterial, 256);
  rayProxies.name = "Bounded RTX energy scattering proxy field";
  const proxyDummy = new THREE.Object3D();
  for (let index = 0; index < rayProxies.count; ++index) {
    const depth = -12.5 + (index / (rayProxies.count - 1)) * 25;
    const angle = index * 2.399963 + depth * 0.47;
    const radius = 2.1 + (index % 13) * 0.27;
    proxyDummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72, depth);
    proxyDummy.rotation.set(angle * 0.17, angle * 0.29, angle * 0.11);
    proxyDummy.scale.setScalar(0.55 + (index % 7) * 0.11);
    proxyDummy.updateMatrix();
    rayProxies.setMatrixAt(index, proxyDummy.matrix);
  }
  rayProxies.instanceMatrix.needsUpdate = true;
  root.add(rayProxies);

  const forge = buildForgeSilhouette(random);
  const silhouette = makePointField({
    name: "Particle memory of forge doorway, anvil and sword",
    positions: forge.positions,
    colors: forge.colors,
    size: 0.085,
    opacity: 0.08,
  });
  silhouette.position.y = 0.05;
  silhouette.rotation.z = 0.16;
  silhouette.scale.setScalar(0.84);
  root.add(silhouette);

  const emberPositions = [];
  const emberColors = [];
  for (let index = 0; index < 1800; ++index) {
    const angle = random() * TAU;
    const radius = Math.pow(random(), 0.68) * 4.8;
    emberPositions.push(
      1.0 + Math.cos(angle) * radius,
      -1.1 + Math.sin(angle) * radius * 0.48,
      -6.1 + gaussian(random) * 0.7,
    );
    const heat = random();
    emberColors.push(1, 0.12 + heat * 0.58, 0.03 + heat * 0.12);
  }
  const embers = makePointField({
    name: "Quantum field resolving into forge embers",
    positions: emberPositions,
    colors: emberColors,
    size: 0.095,
    opacity: 0.62,
  });
  root.add(embers);

  const sampleCamera = makeCameraSampler(
    [[2.8, 1.9, 13.8], [1.65, 1.0, 9.0], [0.62, 0.46, -2.8], [0.02, 0.18, -5.35]],
    [[0.3, 0.22, 4.4], [0.18, 0.12, 0.4], [0.05, 0.05, -5.4], [0, 0.05, -6.45]],
  );

  return makeDomainResult("energy", root, sampleCamera, (time, _delta, t) => {
    tunnel.rotation.z = time * 0.035;
    tunnel.rotation.y = Math.sin(time * 0.09) * 0.07;
    embers.rotation.z = Math.sin(time * 0.16) * 0.055;
    embers.position.y = Math.sin(time * 0.7) * 0.08;
    const reveal = smootherStep((t - 0.24) / 0.66);
    silhouette.material.opacity = 0.06 + reveal * 0.9;
    silhouette.rotation.z = (1 - reveal) * 0.16 + Math.sin(time * 0.18) * (1 - reveal) * 0.025;
    silhouette.scale.setScalar(0.84 + reveal * 0.16);
    tunnel.material.opacity = 0.58 - reveal * 0.25;
    rayProxyMaterial.emissiveIntensity = 2.7 + Math.sin(time * 2.2) * 0.5 + t * 1.1;
  });
}

// Concise aliases make the module convenient for domain registries while the
// explicit builder names keep the physical representation clear to readers.
export const createBccCrystalDomain = buildBccCrystalDomain;
export const createCrystalDomain = buildBccCrystalDomain;
export const createAtomicDomain = buildAtomicDomain;
export const createNucleusDomain = buildNucleusDomain;
export const createEnergyDomain = buildEnergyDomain;
