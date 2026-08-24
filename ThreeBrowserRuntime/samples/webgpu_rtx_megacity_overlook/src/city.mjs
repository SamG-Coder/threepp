import * as THREE from "three/webgpu";

const TAU = Math.PI * 2;
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1, 1, 1);
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const yAxis = new THREE.Vector3(0, 1, 0);

function createChamferedPrismGeometry() {
  const shape = new THREE.Shape();
  const corners = [
    [-0.44, -0.5], [0.44, -0.5], [0.5, -0.44], [0.5, 0.44],
    [0.44, 0.5], [-0.44, 0.5], [-0.5, 0.44], [-0.5, -0.44],
  ];
  shape.moveTo(corners[0][0], corners[0][1]);
  for (let index = 1; index < corners.length; ++index) shape.lineTo(corners[index][0], corners[index][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Shared chamfered architectural prism";
  return geometry;
}

const CHAMFERED_BOX = createChamferedPrismGeometry();

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function matrixFor(position, scale, yaw = 0, pitch = 0, roll = 0) {
  tempPosition.set(position[0], position[1], position[2]);
  tempQuaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
  tempScale.set(scale[0], scale[1], scale[2]);
  return tempMatrix.compose(tempPosition, tempQuaternion, tempScale).clone();
}

class InstanceBuckets {
  constructor(group, namePrefix, rtxIgnore = true, boxGeometry = CHAMFERED_BOX) {
    this.group = group;
    this.namePrefix = namePrefix;
    this.rtxIgnore = rtxIgnore;
    this.boxGeometry = boxGeometry;
    this.boxes = new Map();
    this.planes = new Map();
    this.meshes = [];
    this.instances = 0;
  }

  box(material, x, y, z, width, height, depth, yaw = 0) {
    if (!material || width <= 0 || height <= 0 || depth <= 0) return;
    if (!this.boxes.has(material)) this.boxes.set(material, []);
    this.boxes.get(material).push(matrixFor([x, y, z], [width, height, depth], yaw));
    this.instances += 1;
  }

  plane(material, x, y, z, width, height, yaw = 0, pitch = 0, roll = 0) {
    if (!material || width <= 0 || height <= 0) return;
    if (!this.planes.has(material)) this.planes.set(material, []);
    this.planes.get(material).push(matrixFor([x, y, z], [width, height, 1], yaw, pitch, roll));
    this.instances += 1;
  }

  finalize() {
    const append = (geometry, material, matrices, kind) => {
      if (matrices.length === 0) return;
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      mesh.name = `${this.namePrefix} ${kind} (${matrices.length})`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.userData.rtxIgnore = this.rtxIgnore;
      for (let index = 0; index < matrices.length; ++index) mesh.setMatrixAt(index, matrices[index]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere?.();
      this.group.add(mesh);
      this.meshes.push(mesh);
    };
    for (const [material, matrices] of this.boxes) append(this.boxGeometry, material, matrices, "masses");
    for (const [material, matrices] of this.planes) append(UNIT_PLANE, material, matrices, "panels");
    return this.meshes;
  }
}

function addDirectBox(group, material, name, x, y, z, width, height, depth, yaw = 0) {
  const mesh = new THREE.Mesh(CHAMFERED_BOX, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.rtxIgnore = true;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, material, name, x, y, z, radius, height, sides = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, height, sides, 2), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.rtxIgnore = true;
  group.add(mesh);
  return mesh;
}

function addProxyBox(bucket, material, x, y, z, width, height, depth, yaw = 0) {
  bucket.box(material, x, y, z, width, height, depth, yaw);
}

function windowMaterial(materials, random, warmBias = 0.2) {
  const roll = random();
  if (roll < warmBias) return materials.windowWarm;
  if (roll < 0.72) return materials.windowCool;
  return materials.windowSparse ?? materials.windowCool;
}

function addCorrelatedWindows(bucket, materials, random, tower, options = {}) {
  const {
    x, z, width, height, depth, base = 0, yaw = 0,
  } = tower;
  const bay = options.bay ?? 4.8;
  const floor = options.floor ?? 4.6;
  const occupancy = options.occupancy ?? 0.15;
  const warmBias = options.warmBias ?? 0.22;
  const margin = Math.min(width * 0.13, 12);
  const frontZ = z + depth * 0.5 + 0.36;
  const floorCount = Math.max(2, Math.floor((height - 8) / floor));
  const bayCount = Math.max(2, Math.floor((width - margin * 2) / bay));

  for (let floorIndex = 1; floorIndex < floorCount; ++floorIndex) {
    if (floorIndex % 13 === 0 || floorIndex % 17 === 0) continue;
    if (random() > occupancy) continue;
    const runCount = random() < 0.24 ? 2 : 1;
    for (let run = 0; run < runCount; ++run) {
      const runLength = Math.max(1, Math.min(bayCount, 1 + Math.floor(random() * 4)));
      const start = Math.floor(random() * Math.max(1, bayCount - runLength));
      const localY = base + 4 + floorIndex * floor;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const material = windowMaterial(materials, random, warmBias);
      // A lit department is correlated as one run, but its mullions remain
      // real dark gaps. Continuous emissive bars made the first pass read as a
      // miniature; individual 2–4 m panes preserve office scale at telephoto.
      for (let pane = 0; pane < runLength; ++pane) {
        const localX = -width * 0.5 + margin + (start + pane + 0.5) * bay;
        bucket.plane(
          material,
          x + localX * cos + depth * 0.5 * sin,
          localY,
          frontZ - depth * 0.5 * (1 - cos) - localX * sin,
          Math.min(3.5, bay * 0.62),
          Math.min(1.82, floor * 0.36),
          yaw,
        );
      }
    }
  }

  if (options.side === false) return;
  const sideBays = Math.max(2, Math.floor((depth - 8) / bay));
  for (let floorIndex = 2; floorIndex < floorCount; floorIndex += 2) {
    if (random() > occupancy * 0.72 || floorIndex % 13 === 0) continue;
    const runLength = Math.max(1, Math.min(sideBays, 1 + Math.floor(random() * 3)));
    const localZ = -depth * 0.5 + 4 + (Math.floor(random() * Math.max(1, sideBays - runLength)) + runLength * 0.5) * bay;
    const sideX = x + width * 0.5 * Math.cos(yaw) + localZ * Math.sin(yaw);
    const sideZ = z - width * 0.5 * Math.sin(yaw) + localZ * Math.cos(yaw);
    const material = windowMaterial(materials, random, warmBias);
    for (let pane = 0; pane < runLength; ++pane) {
      const paneOffset = (pane - (runLength - 1) * 0.5) * bay;
      bucket.plane(
        material,
        sideX + Math.cos(yaw) * 0.37 + Math.sin(yaw) * paneOffset,
        base + 4 + floorIndex * floor,
        sideZ - Math.sin(yaw) * 0.37 + Math.cos(yaw) * paneOffset,
        Math.min(3.5, bay * 0.62),
        Math.min(1.82, floor * 0.36),
        yaw + Math.PI * 0.5,
      );
    }
  }
}

function addBillboard(group, materials, descriptor) {
  const {
    x, y, z, width, height, yaw = 0, tile = 0, intensity = 1,
    vertical = false,
  } = descriptor;
  const housing = addDirectBox(
    group,
    materials.blackFrame,
    "Billboard weatherproof housing",
    x,
    y,
    z - Math.cos(yaw) * 0.65,
    width + 2.4,
    height + 2.4,
    1.15,
    yaw,
  );
  housing.castShadow = true;
  const faceMaterial = materials.billboardTiles[tile % materials.billboardTiles.length];
  const face = new THREE.Mesh(UNIT_PLANE, faceMaterial);
  face.name = vertical ? "Vertical district display" : "Rooftop district display";
  face.position.set(x, y, z + Math.cos(yaw) * 0.04);
  face.rotation.y = yaw;
  face.scale.set(width, height, 1);
  face.renderOrder = 2;
  face.userData.rtxIgnore = true;
  face.material.emissiveIntensity = (face.material.userData.baseAtlasIntensity ?? 2.4) * intensity;
  group.add(face);

  const mountMaterial = materials.structuralMetal;
  const mountHeight = Math.max(4, Math.min(20, height * 0.7));
  addDirectBox(group, mountMaterial, "Billboard left mount", x - width * 0.33, y - height * 0.5 - mountHeight * 0.5, z - 0.7, 0.7, mountHeight, 0.7, yaw);
  addDirectBox(group, mountMaterial, "Billboard right mount", x + width * 0.33, y - height * 0.5 - mountHeight * 0.5, z - 0.7, 0.7, mountHeight, 0.7, yaw);
  return face;
}

function addFacadeSkin(context, tower, tile, intensity = 0.62) {
  const { visual, materials, ownedFacadeMaterials } = context;
  const source = materials.billboardTiles[tile % materials.billboardTiles.length];
  const material = source.clone();
  material.name = `Low-energy occupied facade atlas ${tile}`;
  material.emissiveIntensity = intensity;
  material.roughness = 0.58;
  material.metalness = 0.02;
  material.rtxReflectionMask = 0;
  material.userData = { ...source.userData, rtxIgnore: true, baseAtlasIntensity: intensity };
  ownedFacadeMaterials.push(material);

  const distance = tower.depth * 0.5 + 0.16;
  const mesh = new THREE.Mesh(UNIT_PLANE, material);
  mesh.name = "Recessed 2D occupied-room facade field";
  mesh.position.set(
    tower.x + Math.sin(tower.yaw ?? 0) * distance,
    (tower.base ?? 0) + tower.height * 0.54,
    tower.z + Math.cos(tower.yaw ?? 0) * distance,
  );
  mesh.rotation.y = tower.yaw ?? 0;
  mesh.scale.set(tower.width * 0.84, tower.height * 0.78, 1);
  mesh.renderOrder = 1;
  mesh.userData.rtxIgnore = true;
  visual.add(mesh);
  return mesh;
}

function addHeroTower(context, descriptor) {
  const { visual, proxies, windows, materials, random } = context;
  const {
    x, z, width, depth, height, base = 0, yaw = 0,
    crown = "warm", occupancy = 0.25, seedOffset = 0,
  } = descriptor;
  const localRandom = mulberry32((0x8e13a51 + seedOffset * 7919) >>> 0);
  const podiumHeight = Math.max(24, height * 0.075);
  const shaftHeight = height - podiumHeight;
  addDirectBox(visual, materials.concrete, "Hero tower podium", x, base + podiumHeight * 0.5, z, width * 1.15, podiumHeight, depth * 1.14, yaw);
  addDirectBox(visual, materials.darkBuilding, "Hero tower shaft", x, base + podiumHeight + shaftHeight * 0.5, z, width, shaftHeight, depth, yaw);

  const insetWidth = width * 0.78;
  addDirectBox(visual, materials.darkBuildingAlt, "Hero tower recessed core", x, base + height * 0.55, z + depth * 0.52, insetWidth, height * 0.76, 2.5, yaw);
  const mechanicalY = base + height * (0.58 + localRandom() * 0.08);
  addDirectBox(visual, materials.structuralMetal, "Hero mechanical interruption", x, mechanicalY, z, width * 1.035, 7.5, depth * 1.035, yaw);

  const finCount = Math.max(5, Math.floor(width / 14));
  for (let index = 0; index < finCount; ++index) {
    const along = -width * 0.46 + index * (width * 0.92 / Math.max(1, finCount - 1));
    addDirectBox(
      visual,
      materials.structuralMetal,
      "Hero vertical facade fin",
      x + along * Math.cos(yaw) + depth * 0.505 * Math.sin(yaw),
      base + podiumHeight + shaftHeight * 0.5,
      z - along * Math.sin(yaw) + depth * 0.505 * Math.cos(yaw),
      1.1,
      shaftHeight * 0.96,
      1.7,
      yaw,
    );
  }

  const crownMaterial = crown === "cool" ? materials.crownCool : materials.crownWarm;
  const crownBaseY = base + height;
  addDirectBox(visual, materials.structuralMetal, "Crown mechanical collar", x, crownBaseY + 5, z, width * 0.88, 10, depth * 0.86, yaw);
  addDirectBox(
    visual,
    crownMaterial,
    "Crown front grazing-light slot",
    x + depth * 0.515 * Math.sin(yaw),
    crownBaseY + 10.5,
    z + depth * 0.515 * Math.cos(yaw),
    width * 0.66,
    3.4,
    1.5,
    yaw,
  );
  const crownMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.28, width * 0.48, 30, 6, 1, false),
    materials.darkBuildingAlt,
  );
  crownMesh.name = "Chamfered megacity crown";
  crownMesh.position.set(x, crownBaseY + 22, z);
  crownMesh.rotation.y = yaw + Math.PI / 6;
  crownMesh.scale.z = Math.max(0.7, depth / width);
  crownMesh.castShadow = true;
  crownMesh.userData.rtxIgnore = true;
  visual.add(crownMesh);
  const crownEdge = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.285, width * 0.285, 2.6, 6, 1, false),
    crownMaterial,
  );
  crownEdge.name = "Restrained illuminated crown roof edge";
  crownEdge.position.set(x, crownBaseY + 37.4, z);
  crownEdge.rotation.y = yaw + Math.PI / 6;
  crownEdge.scale.z = Math.max(0.7, depth / width);
  crownEdge.userData.rtxIgnore = true;
  visual.add(crownEdge);
  addCylinder(visual, materials.structuralMetal, "Crown antenna mast", x, crownBaseY + 62, z, 1.1, 66, 8);
  addCylinder(visual, crownMaterial, "Crown aviation beacon", x, crownBaseY + 96, z, 1.8, 3.2, 10);

  addCorrelatedWindows(windows, materials, localRandom, { x, z, width, depth, height: shaftHeight, base: podiumHeight, yaw }, {
    occupancy,
    warmBias: crown === "warm" ? 0.34 : 0.14,
    bay: 5.0,
    floor: 4.55,
  });
  addFacadeSkin(context, { x, z, width, depth, height: shaftHeight, base: podiumHeight, yaw }, crown === "warm" ? seedOffset % 2 : 12, 0.54);

  addProxyBox(proxies, materials.darkBuilding, x, base + height * 0.5, z, width, height, depth, yaw);
  addProxyBox(proxies, crownMaterial, x, crownBaseY + 8, z, width * 0.82, 16, depth * 0.82, yaw);
  random();
}

function addSlabTower(context, descriptor) {
  const { visualMasses, windows, proxies, materials, random } = context;
  const { x, z, width, depth, height, yaw = 0, occupancy = 0.1, style = 0 } = descriptor;
  const podium = Math.max(12, Math.min(34, height * 0.09));
  visualMasses.box(materials.concrete, x, podium * 0.5, z, width * 1.08, podium, depth * 1.08, yaw);
  visualMasses.box(style % 2 ? materials.darkBuildingAlt : materials.darkBuilding, x, podium + (height - podium) * 0.5, z, width, height - podium, depth, yaw);
  const bandCount = Math.max(1, Math.floor(height / 105));
  for (let band = 1; band <= bandCount; ++band) {
    visualMasses.box(materials.structuralMetal, x, height * band / (bandCount + 1), z, width * 1.015, 3.8, depth * 1.015, yaw);
  }
  const finCount = THREE.MathUtils.clamp(Math.floor(width / 22), 3, 9);
  for (let fin = 0; fin < finCount; ++fin) {
    const localX = -width * 0.44 + fin * (width * 0.88 / Math.max(1, finCount - 1));
    const fx = x + localX * Math.cos(yaw) + depth * 0.505 * Math.sin(yaw);
    const fz = z - localX * Math.sin(yaw) + depth * 0.505 * Math.cos(yaw);
    visualMasses.box(
      materials.structuralMetal,
      fx,
      podium + (height - podium) * 0.5,
      fz,
      0.72,
      (height - podium) * 0.94,
      1.55,
      yaw,
    );
  }
  // Parapets and clustered plant rooms stop the roofline from reading as the
  // lid of a toy block while preserving a controlled distant silhouette.
  visualMasses.box(materials.structuralMetal, x, height + 1.4, z - depth * 0.45, width * 0.92, 2.8, 1.4, yaw);
  visualMasses.box(materials.structuralMetal, x, height + 1.4, z + depth * 0.45, width * 0.92, 2.8, 1.4, yaw);
  const plantCount = 1 + Math.floor(random() * 3);
  for (let plant = 0; plant < plantCount; ++plant) {
    const plantWidth = 9 + random() * 17;
    const plantDepth = 8 + random() * 14;
    const plantHeight = 5 + random() * 9;
    const localX = (random() - 0.5) * Math.max(0, width - plantWidth - 12);
    const localZ = (random() - 0.5) * Math.max(0, depth - plantDepth - 12);
    visualMasses.box(
      plant % 2 ? materials.wetMetal : materials.structuralMetal,
      x + localX * Math.cos(yaw) + localZ * Math.sin(yaw),
      height + plantHeight * 0.5 + 2.5,
      z - localX * Math.sin(yaw) + localZ * Math.cos(yaw),
      plantWidth,
      plantHeight,
      plantDepth,
      yaw,
    );
  }
  if (height > 330 && random() < 0.58) {
    visualMasses.box(materials.structuralMetal, x + width * 0.18, height + 22, z, 0.8, 40, 0.8, yaw);
    visualMasses.box(materials.redAccent, x + width * 0.18, height + 42.5, z, 1.6, 1.6, 1.6, yaw);
  }
  addCorrelatedWindows(windows, materials, random, { x, z, width, depth, height: height - podium, base: podium, yaw }, {
    occupancy,
    warmBias: style % 3 === 0 ? 0.27 : 0.13,
    bay: 5.1,
    floor: 4.65,
  });
  if (height > 300 && style % 3 === 0) {
    const facadeTiles = [6, 7, 12, 13, 14, 15];
    addFacadeSkin(context, { x, z, width, depth, height: height - podium, base: podium, yaw }, facadeTiles[style % facadeTiles.length], 0.34);
  }
  addProxyBox(proxies, materials.darkBuilding, x, height * 0.5, z, width, height, depth, yaw);
}

function addSkyblock(context, descriptor) {
  const { visual, windows, proxies, materials, random } = context;
  const { x, z, width, depth, height, yaw = 0, occupancy = 0.16, tile = 6 } = descriptor;
  const coreHeight = height * 0.72;
  const topHeight = height * 0.34;
  addDirectBox(visual, materials.darkBuilding, "Skyblock narrow support core", x, coreHeight * 0.5, z, width * 0.42, coreHeight, depth * 0.6, yaw);
  addDirectBox(visual, materials.darkBuildingAlt, "Cantilevered skyblock volume", x, height - topHeight * 0.5, z, width, topHeight, depth, yaw);
  addDirectBox(visual, materials.structuralMetal, "Skyblock lower truss", x, height - topHeight - 5, z, width * 0.92, 10, depth * 0.88, yaw);
  for (let level = 0; level < 4; ++level) {
    const levelY = height - topHeight + 18 + level * ((topHeight - 30) / 4);
    addDirectBox(visual, level % 2 ? materials.windowCool : materials.windowSparse, "Skyblock luminous occupied floor", x, levelY, z + depth * 0.505, width * 0.84, 3.1, 1.0, yaw);
  }
  addCorrelatedWindows(windows, materials, random, {
    x, z, width, depth, height: topHeight, base: height - topHeight, yaw,
  }, { occupancy, warmBias: 0.12, bay: 5.25, floor: 4.75 });
  addFacadeSkin(context, {
    x,
    z,
    width,
    depth,
    height: topHeight * 0.82,
    base: height - topHeight + topHeight * 0.08,
    yaw,
  }, tile, 0.38);
  addProxyBox(proxies, materials.darkBuilding, x, coreHeight * 0.5, z, width * 0.42, coreHeight, depth * 0.6, yaw);
  addProxyBox(proxies, materials.darkBuildingAlt, x, height - topHeight * 0.5, z, width, topHeight, depth, yaw);
}

function addNeedleSpire(context, descriptor) {
  const { visual, materials } = context;
  const { x, z, width, height, tile = 0, cool = true } = descriptor;
  addDirectBox(visual, materials.blackFrame, "Advertisement spire core", x, height * 0.43, z, width, height * 0.86, width * 0.8);
  const segmentHeight = Math.min(82, height * 0.12);
  for (let index = 0; index < 4; ++index) {
    addBillboard(visual, materials, {
      x,
      y: height * 0.28 + index * (segmentHeight + 10),
      z: z + width * 0.42,
      width: width * 1.28,
      height: segmentHeight,
      tile: tile + index,
      intensity: index === 2 ? 1.35 : 0.8,
      vertical: true,
    });
  }
  addCylinder(visual, materials.structuralMetal, "Needle mast", x, height * 0.93, z, width * 0.08, height * 0.3, 8);
  addCylinder(visual, cool ? materials.crownCool : materials.redAccent, "Needle beacon", x, height * 1.08, z, width * 0.13, 4, 8);
}

function addTransitInfrastructure(context) {
  const { visualMasses, windows, proxies, materials, random, visual } = context;
  const deckRuns = [
    { x: 0, y: 54, z: -690, w: 1680, d: 18, yaw: 0.015 },
    { x: -330, y: 30, z: -470, w: 720, d: 16, yaw: -0.42 },
    { x: 390, y: 82, z: -1280, w: 1120, d: 15, yaw: 0.035 },
  ];
  for (const deck of deckRuns) {
    visualMasses.box(materials.transitDeck, deck.x, deck.y, deck.z, deck.w, 8, deck.d, deck.yaw);
    visualMasses.box(materials.structuralMetal, deck.x, deck.y - 5.5, deck.z, deck.w, 3.5, deck.d * 0.72, deck.yaw);
    addProxyBox(proxies, materials.transitDeck, deck.x, deck.y, deck.z, deck.w, 8, deck.d, deck.yaw);
    const pylonCount = Math.floor(deck.w / 52);
    for (let index = 0; index < pylonCount; ++index) {
      const localX = -deck.w * 0.5 + 26 + index * 52;
      const px = deck.x + localX * Math.cos(deck.yaw);
      const pz = deck.z - localX * Math.sin(deck.yaw);
      visualMasses.box(materials.concrete, px, deck.y * 0.5 - 1, pz, 3.8, deck.y - 8, 5.6, deck.yaw);
      if (index % 3 === 0) addProxyBox(proxies, materials.concrete, px, deck.y * 0.5 - 1, pz, 4, deck.y - 8, 6, deck.yaw);
    }
    for (let index = 0; index < pylonCount * 2; ++index) {
      const localX = -deck.w * 0.5 + 12 + index * 26;
      const px = deck.x + localX * Math.cos(deck.yaw);
      const pz = deck.z - localX * Math.sin(deck.yaw);
      windows.box(index % 7 === 0 ? materials.redAccent : materials.windowCool, px, deck.y + 1, pz + deck.d * 0.52, 1.3, 1.1, 0.7, deck.yaw);
    }
  }

  // A believable station/junction reads as a long glazed volume nested in a
  // much heavier structural shell, rather than a floating luminous stripe.
  addDirectBox(visual, materials.concrete, "Transit interchange foundation", -405, 31, -700, 190, 50, 72, 0.02);
  addDirectBox(visual, materials.darkBuildingAlt, "Transit interchange hall", -405, 68, -700, 176, 38, 58, 0.02);
  for (let section = 0; section < 8; ++section) {
    windows.plane(materials.windowCool, -475 + section * 20, 69, -668.8, 14, 16, 0.02);
  }
  addDirectBox(visual, materials.structuralMetal, "Transit interchange canopy", -405, 91, -700, 206, 7, 82, 0.02);
  addProxyBox(proxies, materials.darkBuildingAlt, -405, 55, -700, 190, 84, 68, 0.02);

  // Sparse train consists give scale without turning the deck into a neon line.
  for (let train = 0; train < 3; ++train) {
    const x = -480 + train * 410 + random() * 80;
    visualMasses.box(materials.paintedMetal ?? materials.structuralMetal, x, 62, -689, 72, 10, 10, 0.015);
    for (let pane = 0; pane < 6; ++pane) {
      windows.plane(materials.windowWarm, x - 27 + pane * 11, 63, -683.7, 7.2, 3.3, 0.015);
    }
  }

  const skyBridges = [
    { x: -515, y: 214, z: -1505, width: 188, yaw: 0.02 },
    { x: 215, y: 182, z: -1430, width: 236, yaw: -0.015 },
    { x: 690, y: 248, z: -1760, width: 205, yaw: 0.01 },
  ];
  for (const [bridgeIndex, bridge] of skyBridges.entries()) {
    visualMasses.box(materials.structuralMetal, bridge.x, bridge.y, bridge.z, bridge.width, 8.5, 13, bridge.yaw);
    visualMasses.box(materials.darkBuildingAlt, bridge.x, bridge.y + 8.2, bridge.z, bridge.width * 0.96, 8, 10.5, bridge.yaw);
    const paneCount = Math.max(5, Math.floor(bridge.width / 15));
    for (let pane = 0; pane < paneCount; ++pane) {
      const px = bridge.x - bridge.width * 0.43 + pane * (bridge.width * 0.86 / Math.max(1, paneCount - 1));
      windows.plane(
        (pane + bridgeIndex) % 5 === 0 ? materials.windowWarm : materials.windowSparse,
        px,
        bridge.y + 8.5,
        bridge.z + 5.45,
        7.2,
        2.5,
        bridge.yaw,
      );
    }
    addProxyBox(proxies, materials.structuralMetal, bridge.x, bridge.y, bridge.z, bridge.width, 15, 13, bridge.yaw);
  }
}

function addCanal(context) {
  const { visual, visualMasses, windows, proxies, materials } = context;
  const segments = [
    { x: -38, z: -390, width: 520, length: 780, yaw: -0.015 },
    { x: -6, z: -1070, width: 310, length: 720, yaw: 0.015 },
    { x: 58, z: -1625, width: 262, length: 520, yaw: 0.10 },
  ];
  const waterMeshes = [];
  for (const [index, segment] of segments.entries()) {
    const water = new THREE.Mesh(UNIT_BOX, materials.canalWaterRaster);
    water.name = `Black canal water segment ${index + 1}`;
    water.position.set(segment.x, 0.2, segment.z);
    water.scale.set(segment.width, 0.75, segment.length);
    water.rotation.y = segment.yaw;
    water.receiveShadow = true;
    water.userData.rtxIgnore = true;
    visual.add(water);
    waterMeshes.push(water);

    const bankOffset = segment.width * 0.5 + 8;
    const dx = Math.cos(segment.yaw) * bankOffset;
    const dz = -Math.sin(segment.yaw) * bankOffset;
    for (const side of [-1, 1]) {
      visualMasses.box(materials.canalWall, segment.x + dx * side, 8, segment.z + dz * side, 14, 18, segment.length, segment.yaw);
      addProxyBox(proxies, materials.canalWall, segment.x + dx * side, 8, segment.z + dz * side, 14, 18, segment.length, segment.yaw);
    }

    const lampCount = Math.max(5, Math.floor(segment.length / 72));
    for (let lamp = 0; lamp < lampCount; ++lamp) {
      const localZ = -segment.length * 0.5 + 34 + lamp * ((segment.length - 68) / Math.max(1, lampCount - 1));
      for (const side of [-1, 1]) {
        const localX = side * (segment.width * 0.5 + 0.8);
        const px = segment.x + localX * Math.cos(segment.yaw) + localZ * Math.sin(segment.yaw);
        const pz = segment.z - localX * Math.sin(segment.yaw) + localZ * Math.cos(segment.yaw);
        const lampMaterial = (lamp + index + (side > 0 ? 1 : 0)) % 6 === 0
          ? materials.windowWarm
          : materials.windowCool;
        visualMasses.box(materials.structuralMetal, px, 14, pz, 1.2, 12, 1.2, segment.yaw);
        windows.box(lampMaterial, px, 19.7, pz, 2.4, 0.9, 1.0, segment.yaw);
        if (lamp % 3 === 0) {
          // A sparse set of broad native radiance quads is enough for broken,
          // vertically stretched color in the rough canal reflection.
          addProxyBox(proxies, lampMaterial, px, 16, pz, 2.4, 4.8, 0.8, segment.yaw);
        }
      }
    }
  }

  addBillboard(visual, materials, {
    x: -360,
    y: 58,
    z: -510,
    width: 52,
    height: 29,
    yaw: 0.08,
    tile: 6,
    intensity: 0.88,
  });
  addProxyBox(proxies, materials.crownWarm, -360, 58, -508, 46, 23, 1.0, 0.08);
  // Reflectively useful static plane; it is not rasterized, but gives rays a
  // coherent secondary surface at the basin rather than an empty void.
  for (const segment of segments) {
    addProxyBox(proxies, materials.canalWaterNative, segment.x, -0.6, segment.z, segment.width, 1.2, segment.length, segment.yaw);
  }
  return waterMeshes;
}

function createStaticLights(scene, materials) {
  const lights = [];
  const addPoint = (name, color, intensity, distance, position) => {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.name = name;
    light.position.set(...position);
    scene.add(light);
    lights.push(light);
    return light;
  };
  addPoint("Cyan canal interchange fill", 0x4bb8ca, 58, 440, [-180, 72, -650]);
  addPoint("Warm crown smog source", 0xff9c54, 65, 440, [250, 520, -2120]);
  addPoint("Left advertising district fill", 0x4a9fb8, 34, 300, [-500, 210, -1380]);
  addPoint("Sparse red junction accent", 0xd93628, 25, 210, [370, 110, -1010]);

  const storm = new THREE.DirectionalLight(0xb5c9cc, 1.72);
  storm.name = "Cool storm ceiling key";
  storm.position.set(-680, 1050, -850);
  storm.target.position.set(100, 120, -1900);
  scene.add(storm, storm.target);

  const hemisphere = new THREE.HemisphereLight(0x314b54, 0x040608, 0.74);
  hemisphere.name = "Megacity sky floor";
  scene.add(hemisphere);
  return { lights, storm, hemisphere };
}

export function buildMegacity(scene, materials) {
  const random = mulberry32(0x5eede11);
  const visual = new THREE.Group();
  visual.name = "Megacity raster architecture";
  scene.add(visual);

  const visualMasses = new InstanceBuckets(visual, "Megacity architecture");
  const windows = new InstanceBuckets(visual, "Correlated occupied windows");
  const proxyRoot = new THREE.Group();
  proxyRoot.name = "Deliberate coarse static RTX city proxy";
  const proxies = new InstanceBuckets(proxyRoot, "RTX static city proxy", false, UNIT_BOX);
  const ownedFacadeMaterials = [];
  const context = {
    visual,
    visualMasses,
    windows,
    proxies,
    materials,
    random,
    ownedFacadeMaterials,
  };

  const ground = new THREE.Mesh(UNIT_BOX, materials.wetConcrete);
  ground.name = "Wet industrial city datum";
  ground.position.set(0, -7.5, -1600);
  ground.scale.set(2600, 15, 3900);
  ground.receiveShadow = true;
  ground.userData.rtxIgnore = true;
  visual.add(ground);
  addProxyBox(proxies, materials.wetConcrete, 0, -7.5, -1250, 2200, 15, 3000);

  const waterMeshes = addCanal(context);
  addTransitInfrastructure(context);

  // Near industrial roofs establish the almost-black lower fifth of the frame.
  for (let index = 0; index < 78; ++index) {
    const side = index % 2 === 0 ? -1 : 1;
    const z = -120 - random() * 1050;
    const canalCenter = -38 + Math.max(0, (-z - 250) * 0.045);
    const x = canalCenter + side * (355 + random() * 485);
    const width = 42 + random() * 116;
    const depth = 34 + random() * 104;
    const height = 16 + random() * 66;
    const yaw = (random() - 0.5) * 0.09;
    visualMasses.box(index % 4 === 0 ? materials.wetMetal : materials.darkBuilding, x, height * 0.5, z, width, height, depth, yaw);
    if (index % 4 === 0) {
      visualMasses.box(materials.structuralMetal, x, height + 2.2, z, width * 0.82, 4.4, depth * 0.78, yaw);
    }
    if (index % 6 === 0) addProxyBox(proxies, materials.darkBuilding, x, height * 0.5, z, width, height, depth, yaw);
  }

  // Hero triad: deliberately irregular widths, heights, depth and spacing.
  const heroes = [
    { x: 110, z: -2140, width: 126, depth: 118, height: 515, yaw: -0.025, crown: "warm", occupancy: 0.27, seedOffset: 1 },
    { x: 292, z: -2300, width: 154, depth: 132, height: 622, yaw: 0.035, crown: "warm", occupancy: 0.30, seedOffset: 2 },
    { x: 454, z: -2205, width: 104, depth: 102, height: 568, yaw: -0.06, crown: "cool", occupancy: 0.22, seedOffset: 3 },
  ];
  for (const descriptor of heroes) addHeroTower(context, descriptor);

  const slabs = [
    [-610, -1210, 154, 98, 395, -0.02, 0.12],
    [-415, -1530, 228, 112, 472, 0.025, 0.15],
    [-320, -1290, 178, 92, 332, -0.01, 0.13],
    [330, -1470, 226, 115, 390, 0.02, 0.16],
    [380, -1400, 185, 130, 346, -0.03, 0.11],
    [650, -1510, 248, 118, 420, 0.025, 0.12],
    [780, -1060, 190, 120, 360, -0.02, 0.09],
    [-780, -1780, 215, 120, 465, 0.04, 0.08],
    [-310, -1860, 142, 104, 438, -0.04, 0.16],
    [690, -1900, 208, 156, 492, 0.02, 0.10],
    [-920, -960, 210, 130, 310, 0.02, 0.07],
    [930, -1780, 195, 150, 455, -0.025, 0.07],
  ];
  slabs.forEach((item, index) => addSlabTower(context, {
    x: item[0], z: item[1], width: item[2], depth: item[3], height: item[4], yaw: item[5], occupancy: item[6], style: index,
  }));

  const skyblocks = [
    { x: 590, z: -1200, width: 275, depth: 138, height: 410, yaw: -0.025, occupancy: 0.19, tile: 6 },
    { x: -680, z: -2050, width: 250, depth: 132, height: 455, yaw: 0.03, occupancy: 0.13, tile: 12 },
    { x: 790, z: -2250, width: 288, depth: 160, height: 520, yaw: -0.02, occupancy: 0.14, tile: 7 },
    { x: -320, z: -2250, width: 230, depth: 128, height: 390, yaw: 0.05, occupancy: 0.16, tile: 13 },
  ];
  for (const descriptor of skyblocks) addSkyblock(context, descriptor);

  // Narrow ribbed towers fill the city wall but retain deliberate gaps for fog.
  for (let index = 0; index < 20; ++index) {
    const z = -980 - random() * 1400;
    let x = -930 + random() * 1860;
    const channelCenter = z < -1450 ? 55 : 0;
    if (Math.abs(x - channelCenter) < 270) {
      x = channelCenter + (x < channelCenter ? -1 : 1) * (300 + random() * 190);
    }
    const width = 54 + random() * 70;
    const depth = 62 + random() * 70;
    const height = 220 + random() * 260;
    addSlabTower(context, {
      x,
      z,
      width,
      depth,
      height,
      yaw: (random() - 0.5) * 0.08,
      occupancy: 0.055 + random() * 0.09,
      style: index + 20,
    });
  }

  // Far skyline is deliberately simple, low-occupancy and heavily fogged.
  for (let index = 0; index < 46; ++index) {
    const z = -2600 - random() * 1450;
    const x = -1250 + random() * 2500;
    const width = 65 + random() * 130;
    const depth = 70 + random() * 160;
    const height = 140 + random() * 360;
    visualMasses.box(index % 3 === 0 ? materials.darkBuildingAlt : materials.darkBuilding, x, height * 0.5, z, width, height, depth);
    if (index % 3 === 0) {
      const bandCount = 2 + Math.floor(random() * 5);
      for (let band = 0; band < bandCount; ++band) {
        const bandY = 30 + random() * (height - 45);
        windows.plane(random() < 0.22 ? materials.windowWarm : materials.windowSparse, x, bandY, z + depth * 0.505, width * (0.32 + random() * 0.48), 2.0 + random() * 1.8);
      }
    }
    if (index % 4 === 0) addProxyBox(proxies, materials.darkBuilding, x, height * 0.5, z, width, height, depth);
  }

  addNeedleSpire(context, { x: -260, z: -2460, width: 24, height: 790, tile: 2, cool: true });
  addNeedleSpire(context, { x: 640, z: -2550, width: 28, height: 860, tile: 8, cool: false });
  addNeedleSpire(context, { x: 20, z: -2850, width: 18, height: 720, tile: 12, cool: true });

  const boards = [
    [-720, 275, -1080, 54, 118, 10, true],
    [-520, 248, -1500, 92, 36, 5, false],
    [-260, 212, -1250, 78, 28, 1, false],
    [255, 292, -1435, 92, 34, 6, false],
    [520, 282, -1355, 76, 31, 9, false],
    [760, 335, -1590, 110, 42, 3, false],
    [190, 398, -1990, 78, 25, 14, false],
    [-620, 360, -2030, 66, 26, 4, false],
    [920, 240, -1900, 84, 34, 7, false],
    [-255, 138, -980, 58, 24, 11, false],
  ];
  boards.forEach((item, index) => addBillboard(visual, materials, {
    x: item[0], y: item[1], z: item[2], width: item[3], height: item[4], tile: item[5], vertical: item[6], intensity: index === 0 ? 1.4 : 0.75 + (index % 3) * 0.12,
  }));

  // The extreme right foreground service tower is a compositional bookend.
  addDirectBox(visual, materials.darkBuilding, "Cropped right foreground service tower", 560, 390, -360, 320, 800, 310, -0.03);
  addDirectBox(visual, materials.blackFrame, "Right service tower black sidewall", 405, 390, -300, 28, 790, 340, -0.03);
  for (let level = 0; level < 13; ++level) {
    if (level % 3 !== 0) continue;
    windows.plane(materials.windowSparse, 395, 120 + level * 44, -128, 10, 2.4, Math.PI * 0.5);
  }
  addProxyBox(proxies, materials.darkBuilding, 560, 390, -360, 320, 800, 310, -0.03);

  visualMasses.finalize();
  windows.finalize();
  proxies.finalize();
  proxyRoot.updateWorldMatrix(true, true);

  const lighting = createStaticLights(scene, materials);
  const animatedBoards = visual.children.filter(child => child.name?.includes("display"));
  const stats = {
    architectureInstances: visualMasses.instances,
    windowAndLightInstances: windows.instances,
    proxyInstances: proxies.instances,
    billboards: boards.length + 12,
    waterSegments: waterMeshes.length,
  };

  function setNativeMode(enabled) {
    const waterMaterial = materials.setNativeMode?.(enabled)
      ?? (enabled ? materials.canalWaterNative : materials.canalWaterRaster);
    for (const water of waterMeshes) {
      water.material = waterMaterial;
    }
  }

  function update(elapsed) {
    materials.update?.(elapsed);
    for (let index = 0; index < animatedBoards.length; ++index) {
      const board = animatedBoards[index];
      const base = board.material.userData.baseAtlasIntensity ?? 2.4;
      const pulse = 0.94 + Math.sin(elapsed * (0.22 + index * 0.017) + index * 2.1) * 0.035;
      board.material.emissiveIntensity = base * pulse;
    }
  }

  function dispose() {
    scene.remove(visual, lighting.storm, lighting.storm.target, lighting.hemisphere, ...lighting.lights);
    proxyRoot.traverse(object => {
      if (object.geometry && object.geometry !== UNIT_BOX && object.geometry !== UNIT_PLANE) object.geometry.dispose?.();
    });
    visual.traverse(object => {
      if (object.geometry && object.geometry !== UNIT_BOX && object.geometry !== UNIT_PLANE) object.geometry.dispose?.();
    });
    for (const material of ownedFacadeMaterials) material.dispose();
    ownedFacadeMaterials.length = 0;
  }

  return {
    group: visual,
    staticRoots: [proxyRoot],
    staticLights: lighting.lights,
    stormLight: lighting.storm,
    waterMeshes,
    stats,
    update,
    setNativeMode,
    dispose,
  };
}
