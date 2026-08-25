import * as THREE from "three/webgpu";
import {
  createEnergyMaterial,
  createGrainMaterial,
  createOxideMaterial,
  createSurfaceSteelMaterial,
  palette,
} from "./materials.mjs";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function smoother(value) {
  const x = clamp01(value);
  return clamp01(x * x * x * (x * (x * 6 - 15) + 10));
}

function makeCameraSampler(cameraPoints, targetPoints, fov = [43, 51], clip = [0.008, 70]) {
  const cameraCurve = new THREE.CatmullRomCurve3(
    cameraPoints.map(point => new THREE.Vector3(...point)),
    false,
    "catmullrom",
    0.42,
  );
  const targetCurve = new THREE.CatmullRomCurve3(
    targetPoints.map(point => new THREE.Vector3(...point)),
    false,
    "catmullrom",
    0.42,
  );
  return (t, camera, target) => {
    const progress = smoother(t);
    cameraCurve.getPointAt(progress, camera.position);
    targetCurve.getPointAt(progress, target);
    camera.fov = THREE.MathUtils.lerp(fov[0], fov[1], progress);
    camera.near = THREE.MathUtils.lerp(clip[0] * 5, clip[0], progress);
    camera.far = clip[1];
  };
}

function disposeHierarchy(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
  root.clear();
}

function scratchHeight(x, y) {
  const wandering = Math.sin(y * 0.31) * 0.42 + Math.sin(y * 0.79 + 1.1) * 0.13;
  const distance = Math.abs(x - wandering);
  const narrowCut = -1.36 * Math.exp(-Math.pow(distance / 0.22, 2));
  const shoulder = 0.34 * Math.exp(-Math.pow(distance / 0.58, 2));
  const pitX = x - 0.04;
  const pitY = y + 3.65;
  const pitRadius = Math.sqrt(pitX * pitX + pitY * pitY);
  const pit = -2.18 * Math.exp(-Math.pow(pitRadius / 1.05, 3.1));
  const hammer = Math.sin(x * 1.7 + y * 0.8) * 0.045 + Math.sin(x * 4.1 - y * 2.3) * 0.018;
  const polish = Math.sin(x * 46.0 + Math.sin(y * 0.8) * 2.2) * 0.008;
  return narrowCut + shoulder + pit + hammer + polish;
}

function buildSurfaceTerrain(root) {
  const geometry = new THREE.PlaneGeometry(20, 22, 176, 192);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; ++index) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    positions.setZ(index, scratchHeight(x, y));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const terrain = new THREE.Mesh(geometry, createSurfaceSteelMaterial());
  terrain.name = "Blade relief — texture detail resolved as geometry";
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  root.add(terrain);
  return terrain;
}

function addSurfaceDetail(root, random) {
  const scratchMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0x798287,
    metalness: 1,
    roughness: 0.27,
  });
  scratchMaterial.rtxReflectionMask = 0.95;
  const scratchGeometry = new THREE.BoxGeometry(0.018, 0.42, 0.016);
  const scratchCount = 620;
  const scratches = new THREE.InstancedMesh(scratchGeometry, scratchMaterial, scratchCount);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < scratchCount; ++index) {
    const x = (random() - 0.5) * 18;
    const y = (random() - 0.5) * 20;
    const z = scratchHeight(x, y) + 0.028;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, (random() - 0.5) * 0.35);
    dummy.scale.set(0.5 + random(), 0.35 + random() * 1.8, 0.6 + random() * 0.8);
    dummy.updateMatrix();
    scratches.setMatrixAt(index, dummy.matrix);
  }
  scratches.instanceMatrix.needsUpdate = true;
  scratches.name = "Real polishing-groove microgeometry";
  scratches.castShadow = true;
  root.add(scratches);

  const dropletMaterial = new THREE.MeshPhysicalNodeMaterial({
    color: 0x9dd9ea,
    roughness: 0.045,
    metalness: 0,
    transmission: 0.74,
    thickness: 0.08,
    ior: 1.33,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
  });
  dropletMaterial.rtxReflectionMask = 0.74;
  dropletMaterial.userData.rtxIgnore = true;
  const droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 14, 8), dropletMaterial, 148);
  for (let index = 0; index < droplets.count; ++index) {
    const x = (random() - 0.5) * 17;
    const y = (random() - 0.5) * 18;
    if (Math.abs(x - Math.sin(y * 0.31) * 0.42) < 0.55) {
      dummy.position.set(x + Math.sign(x || 1) * 0.8, y, scratchHeight(x, y) + 0.11);
    } else {
      dummy.position.set(x, y, scratchHeight(x, y) + 0.11);
    }
    dummy.scale.set(0.45 + random() * 1.1, 0.45 + random() * 1.1, 0.18 + random() * 0.34);
    dummy.rotation.set(random() * 0.12, random() * 0.12, random() * Math.PI);
    dummy.updateMatrix();
    droplets.setMatrixAt(index, dummy.matrix);
  }
  droplets.instanceMatrix.needsUpdate = true;
  droplets.name = "Microscopic oil and water residue";
  droplets.castShadow = true;
  root.add(droplets);

  const oxideMaterial = createOxideMaterial();
  const oxideGeometry = new THREE.DodecahedronGeometry(0.12, 0);
  const oxide = new THREE.InstancedMesh(oxideGeometry, oxideMaterial, 390);
  for (let index = 0; index < oxide.count; ++index) {
    const angle = random() * Math.PI * 2;
    const radius = 0.8 + Math.pow(random(), 0.62) * 8.6;
    const x = Math.cos(angle) * radius;
    const y = -3.3 + Math.sin(angle) * radius * 0.7;
    dummy.position.set(x, y, scratchHeight(x, y) + 0.035);
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    dummy.scale.set(0.15 + random() * 1.2, 0.08 + random() * 0.42, 0.05 + random() * 0.18);
    dummy.updateMatrix();
    oxide.setMatrixAt(index, dummy.matrix);
  }
  oxide.instanceMatrix.needsUpdate = true;
  oxide.name = "Oxide and embedded dirt islands";
  root.add(oxide);

  // Partially exposed inclusions make the scratch read as a cut through a
  // volume rather than decoration laid on a plane. They remain opaque,
  // instanced geometry so the RTX collector can include their real profiles.
  const inclusionMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Subsurface steel and carbide inclusions",
    color: 0xb1a58d,
    metalness: 0.92,
    roughness: 0.31,
    emissive: 0x241106,
    emissiveIntensity: 0.2,
  });
  inclusionMaterial.rtxReflectionMask = 0.82;
  const inclusionGeometry = new THREE.DodecahedronGeometry(0.12, 0);
  const inclusions = new THREE.InstancedMesh(inclusionGeometry, inclusionMaterial, 340);
  const inclusionColors = [
    new THREE.Color(0x73808a),
    new THREE.Color(0xb49a6b),
    new THREE.Color(0xc1c8c9),
    new THREE.Color(0x6c5545),
  ];
  for (let index = 0; index < inclusions.count; ++index) {
    let x;
    let y;
    if (index < 270) {
      y = -9.4 + random() * 18.6;
      const center = Math.sin(y * 0.31) * 0.42 + Math.sin(y * 0.79 + 1.1) * 0.13;
      const side = random() < 0.5 ? -1 : 1;
      x = center + side * (0.11 + Math.pow(random(), 1.7) * 0.9);
    } else {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 1.25;
      x = 0.04 + Math.cos(angle) * radius;
      y = -3.65 + Math.sin(angle) * radius;
    }
    const relief = scratchHeight(x, y);
    dummy.position.set(x, y, relief + 0.012 + random() * 0.07);
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    dummy.scale.set(
      0.24 + random() * 1.35,
      0.18 + random() * 0.78,
      0.12 + random() * 0.42,
    );
    dummy.updateMatrix();
    inclusions.setMatrixAt(index, dummy.matrix);
    inclusions.setColorAt(index, inclusionColors[index % inclusionColors.length]);
  }
  inclusions.instanceMatrix.needsUpdate = true;
  if (inclusions.instanceColor) inclusions.instanceColor.needsUpdate = true;
  inclusions.name = "Subsurface inclusions exposed by the scratch and pit";
  inclusions.castShadow = true;
  inclusions.receiveShadow = true;
  inclusions.computeBoundingSphere?.();
  root.add(inclusions);

  // Loose metallic fines hover just above the valley floor. The field is one
  // Points draw, and is deliberately excluded from RTX because it is a
  // transparent screen-space density cue rather than triangle geometry.
  const metalDustCount = 1850;
  const metalDustPositions = new Float32Array(metalDustCount * 3);
  const metalDustColors = new Float32Array(metalDustCount * 3);
  const dustPalette = [
    new THREE.Color(0xbcc9ce),
    new THREE.Color(0xe0b16f),
    new THREE.Color(0x7f9aa8),
    new THREE.Color(0xa45128),
  ];
  for (let index = 0; index < metalDustCount; ++index) {
    const offset = index * 3;
    let x;
    let y;
    if (index % 5) {
      y = -9.6 + random() * 19.2;
      const center = Math.sin(y * 0.31) * 0.42 + Math.sin(y * 0.79 + 1.1) * 0.13;
      x = center + (random() + random() + random() - 1.5) * 0.82;
    } else {
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.72) * 1.5;
      x = 0.04 + Math.cos(angle) * radius;
      y = -3.65 + Math.sin(angle) * radius;
    }
    metalDustPositions[offset] = x;
    metalDustPositions[offset + 1] = y;
    metalDustPositions[offset + 2] = scratchHeight(x, y) + 0.045 + random() * 0.19;
    const tint = dustPalette[(index + Math.floor(random() * dustPalette.length)) % dustPalette.length];
    const brightness = 0.58 + random() * 0.42;
    metalDustColors[offset] = tint.r * brightness;
    metalDustColors[offset + 1] = tint.g * brightness;
    metalDustColors[offset + 2] = tint.b * brightness;
  }
  const metalDustGeometry = new THREE.BufferGeometry();
  metalDustGeometry.setAttribute("position", new THREE.BufferAttribute(metalDustPositions, 3));
  metalDustGeometry.setAttribute("color", new THREE.BufferAttribute(metalDustColors, 3));
  const metalDustMaterial = new THREE.PointsNodeMaterial({
    name: "Metallic polishing dust",
    color: 0xffffff,
    vertexColors: true,
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  metalDustMaterial.toneMapped = false;
  metalDustMaterial.userData.rtxIgnore = true;
  const metalDust = new THREE.Points(metalDustGeometry, metalDustMaterial);
  metalDust.name = "Metallic dust suspended inside the scratch";
  metalDust.frustumCulled = false;
  metalDust.userData.rtxIgnore = true;
  root.add(metalDust);

  return { scratches, droplets, oxide, inclusions, metalDust };
}

function addScaleLighting(root) {
  const orange = new THREE.PointLight(palette.fire, 8.5, 45, 1.4);
  orange.position.set(-11, 12, 16);
  orange.name = "Distant forge illumination carried across scale";
  const blue = new THREE.PointLight(palette.moon, 6.2, 48, 1.2);
  blue.position.set(13, 5, 12);
  blue.name = "Distant moon illumination carried across scale";
  const ambient = new THREE.HemisphereLight(0x315a76, 0x3a1208, 0.54);
  root.add(orange, blue, ambient);
  return { orange, blue, ambient };
}

export function buildSurfaceDomain() {
  const root = new THREE.Group();
  root.name = "SURFACE domain · millimetre coordinates";
  root.userData.scaleDomain = "SURFACE";
  const random = seededRandom(0x53555246);
  const terrain = buildSurfaceTerrain(root);
  const details = addSurfaceDetail(root, random);
  const lights = addScaleLighting(root);

  const gatewayPosition = new THREE.Vector3(0.04, -3.65, -1.92);
  const sampleCamera = makeCameraSampler(
    [
      // The entry target sits on the actual displaced relief at (0, 0).
      // Translate the camera by the same amount so the entry projection stays
      // identical while real steel, rather than empty local space, maps onto
      // the forge blade face.
      [0.0, 4.82, 8.066088],
      [1.7, 2.35, 6.15],
      [0.82, -0.42, 3.7],
      [0.16, -2.72, 0.92],
      [0.07, -3.16, -1.05],
    ],
    [
      [0, 0, -0.703912],
      [0.28, -1.05, -0.18],
      [0.15, -2.35, -0.58],
      [0.05, -3.5, -1.52],
      [0.04, -3.65, -1.92],
    ],
    [40, 55],
    [0.0025, 55],
  );

  function update(time, _delta, t) {
    details.droplets.rotation.z = Math.sin(time * 0.08) * 0.003;
    details.oxide.rotation.z = Math.sin(time * 0.045 + 1) * 0.0015;
    details.metalDust.position.z = Math.sin(time * 0.62) * 0.012;
    details.metalDust.material.opacity = 0.34 + t * 0.2 + Math.sin(time * 1.7) * 0.035;
    lights.orange.intensity = 8.5 - t * 2.2 + Math.sin(time * 0.7) * 0.25;
    lights.blue.intensity = 6.2 + t * 0.8;
    terrain.material.envMapIntensity = 1.2 + t * 0.45;
  }

  return {
    id: "surface",
    root,
    gatewayPosition,
    sampleCamera,
    update,
    dispose() { disposeHierarchy(root); },
  };
}

function makeGrainField(root, random) {
  const geometry = new THREE.DodecahedronGeometry(0.74, 0);
  const materials = [
    createGrainMaterial(0x84918f, 0.2),
    createGrainMaterial(0xb0a698, 1.3),
    createGrainMaterial(0x768b96, 2.1),
    createGrainMaterial(0x9c887a, 3.2),
  ];
  const transforms = materials.map(() => []);
  const colors = [new THREE.Color(0x829599), new THREE.Color(0xb4a68e), new THREE.Color(0x7891a1), new THREE.Color(0x987d6b)];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let zLayer = -7; zLayer <= 8; ++zLayer) {
    for (let yLayer = -5; yLayer <= 5; ++yLayer) {
      for (let xLayer = -7; xLayer <= 7; ++xLayer) {
        const x = xLayer * 1.12 + (random() - 0.5) * 0.38;
        const y = yLayer * 1.06 + (random() - 0.5) * 0.38;
        const z = zLayer * 1.12 + (random() - 0.5) * 0.38;
        const tunnelRadius = Math.sqrt(x * x + y * y * 1.35);
        const meander = Math.sin(z * 0.36) * 0.7;
        if (Math.sqrt(Math.pow(x - meander, 2) + y * y * 1.25) < 1.22 + Math.max(0, z) * 0.018) continue;
        if (tunnelRadius > 8.4) continue;
        const materialIndex = Math.floor(random() * materials.length);
        position.set(x, y, z);
        quaternion.setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI));
        scale.set(0.72 + random() * 0.34, 0.65 + random() * 0.43, 0.75 + random() * 0.31);
        transforms[materialIndex].push(matrix.compose(position, quaternion, scale).clone());
      }
    }
  }

  const meshes = transforms.map((list, materialIndex) => {
    const mesh = new THREE.InstancedMesh(geometry, materials[materialIndex], list.length);
    list.forEach((transform, index) => {
      mesh.setMatrixAt(index, transform);
      mesh.setColorAt?.(index, colors[materialIndex]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = `Oriented iron grain family ${materialIndex + 1}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere?.();
    root.add(mesh);
    return mesh;
  });
  return meshes;
}

function makeGrainBoundaries(root, random) {
  const positions = [];
  const colors = [];
  for (let line = 0; line < 1850; ++line) {
    const z = -8 + random() * 18;
    const angle = random() * Math.PI * 2;
    const radius = 1.15 + random() * 6.4;
    const length = 0.08 + random() * 0.26;
    for (let endpoint = 0; endpoint < 2; ++endpoint) {
      positions.push(
        Math.cos(angle) * (radius + endpoint * length),
        Math.sin(angle) * (radius + endpoint * length) * 0.78,
        z + (random() - 0.5) * 0.14,
      );
      colors.push(0.35 + random() * 0.3, 0.65 + random() * 0.25, 0.8 + random() * 0.2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicNodeMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.23,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  material.toneMapped = false;
  const boundaries = new THREE.LineSegments(geometry, material);
  boundaries.name = "Intergranular boundary energy";
  boundaries.userData.rtxIgnore = true;
  root.add(boundaries);
  return boundaries;
}

function makeBoundaryMembranes(root, random) {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Translucent intergranular boundary membranes",
    color: 0x63c7e3,
    transparent: true,
    opacity: 0.045,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  material.userData.rtxIgnore = true;
  const geometry = new THREE.CircleGeometry(1, 7);
  const count = 260;
  const membranes = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const planeNormal = new THREE.Vector3(0, 0, 1);
  for (let index = 0; index < count; ++index) {
    const z = -7.8 + random() * 17.2;
    const angle = random() * Math.PI * 2;
    const radius = 1.3 + random() * 6.1;
    position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, z);
    normal.set(Math.cos(angle), Math.sin(angle) * 0.72, (random() - 0.5) * 0.85).normalize();
    quaternion.setFromUnitVectors(planeNormal, normal);
    scale.set(0.32 + random() * 1.12, 0.2 + random() * 0.78, 1);
    membranes.setMatrixAt(index, matrix.compose(position, quaternion, scale));
  }
  membranes.instanceMatrix.needsUpdate = true;
  membranes.name = "Thin grain-boundary reveal membranes";
  membranes.frustumCulled = false;
  membranes.userData.rtxIgnore = true;
  root.add(membranes);
  return membranes;
}

function makeLatticeForeshadow(root) {
  const material = createEnergyMaterial(0xffc685, 1.4, 0.65);
  const geometry = new THREE.IcosahedronGeometry(0.07, 1);
  const count = 9 * 9 * 6;
  const instances = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let z = 0; z < 6; ++z) {
    for (let y = -4; y <= 4; ++y) {
      for (let x = -4; x <= 4; ++x) {
        dummy.position.set(x * 0.31, y * 0.31, -1.1 - z * 0.32);
        dummy.scale.setScalar(0.75 + ((x + y + z) & 1) * 0.32);
        dummy.updateMatrix();
        instances.setMatrixAt(index++, dummy.matrix);
      }
    }
  }
  instances.instanceMatrix.needsUpdate = true;
  instances.name = "Lattice resolving inside a crystal grain";
  instances.userData.rtxIgnore = true;
  root.add(instances);
  return instances;
}

function makeBccTransitionReveal(root) {
  // The first lattice field supplies shared corners. This second layer reveals
  // the body-centred basis and its eight nearest-neighbour connections, so the
  // microstructure hands off to the crystal domain with the same BCC grammar.
  const group = new THREE.Group();
  group.name = "BCC basis and nearest-neighbour transition reveal";
  group.userData.rtxIgnore = true;
  root.add(group);

  const centerMaterial = createEnergyMaterial(0x70d2ff, 1.2, 0.12);
  centerMaterial.name = "Emerging BCC body-centre sites";
  centerMaterial.userData.rtxIgnore = true;
  const centerGeometry = new THREE.IcosahedronGeometry(0.052, 1);
  const centerCount = 8 * 8 * 5;
  const centers = new THREE.InstancedMesh(centerGeometry, centerMaterial, centerCount);
  const dummy = new THREE.Object3D();
  let centerIndex = 0;
  for (let z = 0; z < 5; ++z) {
    for (let y = -4; y < 4; ++y) {
      for (let x = -4; x < 4; ++x) {
        dummy.position.set((x + 0.5) * 0.31, (y + 0.5) * 0.31, -1.26 - z * 0.32);
        dummy.scale.setScalar(0.82 + ((x + y + z) & 1) * 0.22);
        dummy.updateMatrix();
        centers.setMatrixAt(centerIndex++, dummy.matrix);
      }
    }
  }
  centers.instanceMatrix.needsUpdate = true;
  centers.name = "Emerging BCC body-centre atoms";
  centers.userData.rtxIgnore = true;
  group.add(centers);

  const positions = [];
  const colors = [];
  for (let z = 0; z < 5; ++z) {
    for (let y = -4; y < 4; ++y) {
      for (let x = -4; x < 4; ++x) {
        const centerX = (x + 0.5) * 0.31;
        const centerY = (y + 0.5) * 0.31;
        const centerZ = -1.26 - z * 0.32;
        for (let dz = 0; dz <= 1; ++dz) {
          for (let dy = 0; dy <= 1; ++dy) {
            for (let dx = 0; dx <= 1; ++dx) {
              positions.push(
                centerX, centerY, centerZ,
                (x + dx) * 0.31, (y + dy) * 0.31, -1.1 - (z + dz) * 0.32,
              );
              const warm = (dx + dy + dz) / 3;
              colors.push(0.28, 0.66, 1, 0.48 + warm * 0.45, 0.72 + warm * 0.2, 1);
            }
          }
        }
      }
    }
  }
  const connectionGeometry = new THREE.BufferGeometry();
  connectionGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  connectionGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const connectionMaterial = new THREE.LineBasicNodeMaterial({
    name: "Emerging BCC nearest-neighbour bonds",
    vertexColors: true,
    transparent: true,
    opacity: 0.04,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  connectionMaterial.toneMapped = false;
  connectionMaterial.userData.rtxIgnore = true;
  const connections = new THREE.LineSegments(connectionGeometry, connectionMaterial);
  connections.name = "Eight-neighbour BCC bond reveal";
  connections.userData.rtxIgnore = true;
  group.add(connections);
  return { group, centers, connections };
}

export function buildMicrostructureDomain() {
  const root = new THREE.Group();
  root.name = "MICROSTRUCTURE domain · micrometre coordinates";
  root.userData.scaleDomain = "MICROSTRUCTURE";
  const random = seededRandom(0x47524149);
  const grains = makeGrainField(root, random);
  const boundaries = makeGrainBoundaries(root, random);
  const boundaryMembranes = makeBoundaryMembranes(root, random);
  const lattice = makeLatticeForeshadow(root);
  const bccReveal = makeBccTransitionReveal(root);
  const lights = addScaleLighting(root);
  lights.orange.position.set(-8, 7, 13);
  lights.blue.position.set(9, 3, 9);
  const gatewayPosition = new THREE.Vector3(0, 0, -1.32);

  const sampleCamera = makeCameraSampler(
    [
      [0.22, 0.42, 8.78],
      [0.74, 0.34, 7.1],
      [0.56, 0.28, 4.7],
      [0.18, 0.25, 2.25],
      [0.02, 0.03, -0.29],
    ],
    [
      [0, 0, 0],
      [0.35, 0.2, -0.4],
      [0.2, 0.08, -0.8],
      [0.05, 0.02, -1.16],
      [0, 0, -1.32],
    ],
    [50, 43],
    [0.002, 50],
  );

  function update(time, _delta, t) {
    boundaries.rotation.z = Math.sin(time * 0.13) * 0.008;
    boundaries.material.opacity = 0.17 + t * 0.22 + Math.sin(time * 1.2) * 0.025;
    const boundaryReveal = smoother((t - 0.08) / 0.62);
    boundaryMembranes.material.opacity = 0.025 + boundaryReveal * 0.075 + Math.sin(time * 0.83) * 0.012;
    boundaryMembranes.rotation.z = Math.sin(time * 0.09) * 0.006;
    lattice.rotation.z = time * 0.025;
    const reveal = smoother((t - 0.48) / 0.5);
    lattice.scale.setScalar(0.62 + reveal * 0.38);
    lattice.material.opacity = 0.15 + reveal * 0.5;
    const basisReveal = smoother((t - 0.58) / 0.38);
    bccReveal.group.rotation.z = time * 0.025;
    bccReveal.group.scale.setScalar(0.68 + basisReveal * 0.32);
    bccReveal.centers.material.opacity = 0.06 + basisReveal * 0.56;
    bccReveal.connections.material.opacity = 0.025 + basisReveal * 0.28;
    grains.forEach((mesh, index) => {
      mesh.rotation.z = Math.sin(time * 0.035 + index) * 0.002;
    });
    lights.orange.intensity = 6.4 - t * 1.3;
    lights.blue.intensity = 6.8 + t * 1.1;
  }

  return {
    id: "microstructure",
    root,
    gatewayPosition,
    sampleCamera,
    update,
    dispose() { disposeHierarchy(root); },
  };
}
