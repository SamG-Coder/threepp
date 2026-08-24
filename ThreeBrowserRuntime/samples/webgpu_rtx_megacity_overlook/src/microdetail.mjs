const TAU = Math.PI * 2;
const CITY_SEED = 0x05eede11;
const MIN_INSTANCE_TARGET = 1500;
const MAX_INSTANCE_TARGET = 4000;

const CANAL_SEGMENTS = Object.freeze([
  Object.freeze({ x: -38, z: -390, width: 520, length: 780, yaw: -0.015 }),
  Object.freeze({ x: -6, z: -1070, width: 310, length: 720, yaw: 0.015 }),
  Object.freeze({ x: 58, z: -1625, width: 262, length: 520, yaw: 0.10 }),
]);

const TRANSIT_DECKS = Object.freeze([
  Object.freeze({ x: 0, y: 54, z: -690, width: 1680, depth: 18, yaw: 0.015 }),
  Object.freeze({ x: -330, y: 30, z: -470, width: 720, depth: 16, yaw: -0.42 }),
  Object.freeze({ x: 390, y: 82, z: -1280, width: 1120, depth: 15, yaw: 0.035 }),
]);

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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createFanRotorGeometry(THREE) {
  const positions = [];
  const inner = 0.19;
  const outer = 1;
  const halfWidth = 0.16;
  for (let blade = 0; blade < 4; ++blade) {
    const angle = blade * Math.PI * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (along, across) => [
      along * cos - across * sin,
      0,
      along * sin + across * cos,
    ];
    const a = point(inner, -halfWidth);
    const b = point(outer, -halfWidth * 0.72);
    const c = point(outer, halfWidth * 0.72);
    const d = point(inner, halfWidth);
    // Clockwise in XZ produces an upward-facing rotor surface.
    positions.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const uvs = [];
  for (let index = 0; index < positions.length; index += 3) {
    uvs.push(positions[index] * 0.5 + 0.5, positions[index + 2] * 0.5 + 0.5);
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Megacity four-blade rooftop fan rotor";
  return geometry;
}

function createDishGeometry(THREE) {
  const geometry = new THREE.CircleGeometry(1, 18);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; ++index) {
    const x = position.getX(index);
    const y = position.getY(index);
    const radiusSquared = x * x + y * y;
    position.setZ(index, -0.24 * (1 - Math.min(1, radiusSquared)));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Megacity shallow service antenna dish";
  return geometry;
}

function rectanglesOverlap(a, b, margin = 0) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const cos = Math.cos(b.yaw);
  const sin = Math.sin(b.yaw);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const relativeYaw = a.yaw - b.yaw;
  const roofExtentX = Math.abs(Math.cos(relativeYaw)) * a.width * 0.5 +
    Math.abs(Math.sin(relativeYaw)) * a.depth * 0.5;
  const roofExtentZ = Math.abs(Math.sin(relativeYaw)) * a.width * 0.5 +
    Math.abs(Math.cos(relativeYaw)) * a.depth * 0.5;
  return Math.abs(localX) <= b.width * 0.5 + margin + roofExtentX &&
    Math.abs(localZ) <= b.depth * 0.5 + margin + roofExtentZ;
}

function overlapsCanal(roof) {
  return CANAL_SEGMENTS.some((segment) => rectanglesOverlap(roof, {
    x: segment.x,
    z: segment.z,
    width: segment.width,
    depth: segment.length,
    yaw: segment.yaw,
  }, 16));
}

function conflictsWithTransitDeck(roof) {
  return TRANSIT_DECKS.some((deck) => {
    if (roof.y < deck.y - 10 || roof.y > deck.y + 11) return false;
    return rectanglesOverlap(roof, deck, 5);
  });
}

function reconstructIndustrialRoofAnchors() {
  const random = mulberry32(CITY_SEED);
  // buildMegacity() consumes exactly one random X offset for each of its three
  // train consists before creating the 78 low industrial masses.
  random();
  random();
  random();
  const accepted = [];
  let canalRejected = 0;
  let deckRejected = 0;
  for (let index = 0; index < 78; ++index) {
    const side = index % 2 === 0 ? -1 : 1;
    const z = -120 - random() * 1050;
    const canalCenter = -38 + Math.max(0, (-z - 250) * 0.045);
    // Keep this identical to buildMegacity(): the wider centered canal moved
    // both low districts outward while retaining the original seeded skyline.
    const x = canalCenter + side * (355 + random() * 485);
    const width = 42 + random() * 116;
    const depth = 34 + random() * 104;
    const height = 16 + random() * 66;
    const yaw = (random() - 0.5) * 0.09;
    const capped = index % 4 === 0;
    const roof = {
      id: index,
      x,
      y: capped ? height + 4.4 : height,
      z,
      width: capped ? width * 0.82 : width,
      depth: capped ? depth * 0.78 : depth,
      yaw,
      baseHeight: height,
      capped,
    };
    if (overlapsCanal(roof)) {
      canalRejected += 1;
      continue;
    }
    if (conflictsWithTransitDeck(roof)) {
      deckRejected += 1;
      continue;
    }
    accepted.push(roof);
  }
  return { roofs: accepted, canalRejected, deckRejected };
}

/**
 * Adds dense but deliberately low-key physical scale cues to the raster city.
 * All meshes are ignored by RTX; the coarse city proxy remains the sole ray
 * representation so this module cannot inflate native BLAS/TLAS work.
 */
export function createMegacityMicroDetail({ THREE, scene, materials }) {
  if (!THREE?.InstancedMesh || !THREE?.Matrix4 || !scene?.add) {
    throw new TypeError("createMegacityMicroDetail requires THREE and a Three.js scene");
  }
  const requiredMaterials = [
    "wetMetal",
    "structuralMetal",
    "blackFrame",
    "concrete",
    "redAccent",
  ];
  for (const key of requiredMaterials) {
    if (!materials?.[key]) throw new TypeError(`Megacity microdetail requires materials.${key}`);
  }

  const group = new THREE.Group();
  group.name = "Megacity deterministic rooftop and utility microdetail";
  group.userData.rtxIgnore = true;

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.name = "Megacity shared microdetail box";
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
  cylinderGeometry.name = "Megacity shared microdetail cylinder";
  const fanGeometry = createFanRotorGeometry(THREE);
  const dishGeometry = createDishGeometry(THREE);
  const lightGeometry = new THREE.SphereGeometry(1, 10, 6);
  lightGeometry.name = "Megacity obstruction lamp globe";
  const ownedGeometries = new Set([
    boxGeometry,
    cylinderGeometry,
    fanGeometry,
    dishGeometry,
    lightGeometry,
  ]);

  const pools = Object.freeze({
    weatheredBoxes: { geometry: boxGeometry, material: materials.wetMetal, matrices: [] },
    darkBoxes: { geometry: boxGeometry, material: materials.blackFrame, matrices: [] },
    concreteBoxes: { geometry: boxGeometry, material: materials.concrete, matrices: [] },
    metalCylinders: { geometry: cylinderGeometry, material: materials.structuralMetal, matrices: [] },
    darkCylinders: { geometry: cylinderGeometry, material: materials.blackFrame, matrices: [] },
    wetCylinders: { geometry: cylinderGeometry, material: materials.wetMetal, matrices: [] },
    fans: { geometry: fanGeometry, material: materials.structuralMetal, matrices: [], dynamic: true },
    dishes: { geometry: dishGeometry, material: materials.structuralMetal, matrices: [] },
    obstructionLights: { geometry: lightGeometry, material: materials.redAccent, matrices: [], dynamic: true },
  });

  const counts = {
    parapetSegments: 0,
    hvacUnits: 0,
    fanRotors: 0,
    ventStacks: 0,
    waterTanks: 0,
    utilitySegments: 0,
    antennaMasts: 0,
    dishes: 0,
    obstructionLights: 0,
    cranes: 0,
    serviceGantries: 0,
  };

  const tempPosition = new THREE.Vector3();
  const tempScale = new THREE.Vector3();
  const tempQuaternion = new THREE.Quaternion();
  const tempEuler = new THREE.Euler();
  const tempMatrix = new THREE.Matrix4();
  const tempDirection = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const detailFootprints = [];

  function recordFootprint(x, z, width, depth, yaw = 0) {
    detailFootprints.push({
      x,
      z,
      width: Math.max(0.001, width),
      depth: Math.max(0.001, depth),
      yaw,
    });
  }

  function composeTemporaryMatrix(x, y, z, sx, sy, sz, yaw = 0, pitch = 0, roll = 0) {
    tempPosition.set(x, y, z);
    tempEuler.set(pitch, yaw, roll, "YXZ");
    tempQuaternion.setFromEuler(tempEuler);
    tempScale.set(sx, sy, sz);
    return tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
  }

  function composeMatrix(x, y, z, sx, sy, sz, yaw = 0, pitch = 0, roll = 0) {
    return composeTemporaryMatrix(x, y, z, sx, sy, sz, yaw, pitch, roll).clone();
  }

  function composeQuaternionMatrix(position, quaternion, scale) {
    tempPosition.set(position[0], position[1], position[2]);
    tempScale.set(scale[0], scale[1], scale[2]);
    return tempMatrix.compose(tempPosition, quaternion, tempScale).clone();
  }

  function addBox(pool, x, y, z, width, height, depth, yaw = 0, pitch = 0, roll = 0) {
    pool.matrices.push(composeMatrix(x, y, z, width, height, depth, yaw, pitch, roll));
    // No pitched boxes in this authored layer project farther than their XZ
    // dimensions; segment helpers below handle the crane braces separately.
    recordFootprint(x, z, width, depth, yaw);
  }

  function addVerticalCylinder(pool, x, y, z, radius, height) {
    pool.matrices.push(composeMatrix(x, y, z, radius, height, radius));
    recordFootprint(x, z, radius * 2, radius * 2);
  }

  function addCylinderSegment(pool, start, end, radius) {
    tempDirection.set(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const length = tempDirection.length();
    if (length <= 1e-5) return;
    tempDirection.multiplyScalar(1 / length);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, tempDirection);
    pool.matrices.push(composeQuaternionMatrix([
      (start[0] + end[0]) * 0.5,
      (start[1] + end[1]) * 0.5,
      (start[2] + end[2]) * 0.5,
    ], quaternion, [radius, length, radius]));
    const projectedLength = Math.hypot(end[0] - start[0], end[2] - start[2]);
    recordFootprint(
      (start[0] + end[0]) * 0.5,
      (start[2] + end[2]) * 0.5,
      projectedLength + radius * 2,
      radius * 2,
      projectedLength > 1e-5 ? Math.atan2(-(end[2] - start[2]), end[0] - start[0]) : 0,
    );
  }

  function addBoxSegment(pool, start, end, thickness) {
    tempDirection.set(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const length = tempDirection.length();
    if (length <= 1e-5) return;
    tempDirection.multiplyScalar(1 / length);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(xAxis, tempDirection);
    pool.matrices.push(composeQuaternionMatrix([
      (start[0] + end[0]) * 0.5,
      (start[1] + end[1]) * 0.5,
      (start[2] + end[2]) * 0.5,
    ], quaternion, [length, thickness, thickness]));
    const projectedLength = Math.hypot(end[0] - start[0], end[2] - start[2]);
    recordFootprint(
      (start[0] + end[0]) * 0.5,
      (start[2] + end[2]) * 0.5,
      projectedLength + thickness,
      thickness,
      projectedLength > 1e-5 ? Math.atan2(-(end[2] - start[2]), end[0] - start[0]) : 0,
    );
  }

  function roofPoint(roof, localX, localZ, y = roof.y) {
    const cos = Math.cos(roof.yaw);
    const sin = Math.sin(roof.yaw);
    return [
      roof.x + localX * cos + localZ * sin,
      y,
      roof.z - localX * sin + localZ * cos,
    ];
  }

  function addRoofBox(pool, roof, localX, y, localZ, width, height, depth, yawOffset = 0) {
    const world = roofPoint(roof, localX, localZ, y);
    addBox(pool, world[0], world[1], world[2], width, height, depth, roof.yaw + yawOffset);
  }

  const fanRecords = [];
  const lightRecords = [];

  function addFan(roof, localX, localZ, y, radius, phase, speed) {
    const world = roofPoint(roof, localX, localZ, y);
    const record = {
      x: world[0],
      y: world[1],
      z: world[2],
      radius,
      yaw: roof.yaw,
      phase,
      speed,
    };
    fanRecords.push(record);
    pools.fans.matrices.push(composeMatrix(
      record.x,
      record.y,
      record.z,
      radius,
      1,
      radius,
      record.yaw + phase,
    ));
    recordFootprint(record.x, record.z, radius * 2, radius * 2);
    counts.fanRotors += 1;
  }

  function addDish(roof, localX, localZ, y, radius, azimuth, elevation) {
    const world = roofPoint(roof, localX, localZ, y);
    const heading = roof.yaw + azimuth;
    tempDirection.set(
      Math.sin(heading) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(heading) * Math.cos(elevation),
    ).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(zAxis, tempDirection);
    pools.dishes.matrices.push(composeQuaternionMatrix(world, quaternion, [radius, radius, radius]));
    recordFootprint(world[0], world[2], radius * 2, radius * 2);
    counts.dishes += 1;
  }

  function addObstructionLight(position, radius, phase) {
    lightRecords.push({ position, radius, phase });
    pools.obstructionLights.matrices.push(composeMatrix(
      position[0],
      position[1],
      position[2],
      radius,
      radius,
      radius,
    ));
    recordFootprint(position[0], position[2], radius * 2, radius * 2);
    counts.obstructionLights += 1;
  }

  // These are coordinate anchors only. No roof slab, building mass, or RTX
  // proxy is emitted by this module; city.mjs remains their single owner.
  const { roofs, canalRejected, deckRejected } = reconstructIndustrialRoofAnchors();
  const detailRandom = mulberry32(0x4d494352);

  function addParapets(roof) {
    const edge = 0.46;
    const height = 0.68 + detailRandom() * 0.34;
    addRoofBox(
      pools.weatheredBoxes,
      roof,
      0,
      roof.y + height * 0.5,
      -roof.depth * 0.5 + edge * 0.5,
      Math.max(2, roof.width - edge * 2),
      height,
      edge,
    );
    addRoofBox(
      pools.weatheredBoxes,
      roof,
      0,
      roof.y + height * 0.5,
      roof.depth * 0.5 - edge * 0.5,
      Math.max(2, roof.width - edge * 2),
      height,
      edge,
    );
    addRoofBox(
      pools.weatheredBoxes,
      roof,
      -roof.width * 0.5 + edge * 0.5,
      roof.y + height * 0.5,
      0,
      edge,
      height,
      roof.depth,
    );
    addRoofBox(
      pools.weatheredBoxes,
      roof,
      roof.width * 0.5 - edge * 0.5,
      roof.y + height * 0.5,
      0,
      edge,
      height,
      roof.depth,
    );
    counts.parapetSegments += 4;
  }

  function addHvacCluster(roof) {
    const area = roof.width * roof.depth;
    const count = clamp(Math.floor(area / 2450) + 2, 2, 7);
    const usableWidth = Math.max(12, roof.width - 12);
    const usableDepth = Math.max(10, roof.depth - 12);
    const columns = Math.max(1, Math.ceil(Math.sqrt(count * usableWidth / usableDepth)));
    const rows = Math.ceil(count / columns);
    const cellWidth = usableWidth / columns;
    const cellDepth = usableDepth / rows;
    for (let index = 0; index < count; ++index) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const localX = -usableWidth * 0.5 + (column + 0.5) * cellWidth +
        (detailRandom() - 0.5) * Math.min(2.2, cellWidth * 0.18);
      const localZ = -usableDepth * 0.5 + (row + 0.5) * cellDepth +
        (detailRandom() - 0.5) * Math.min(2.0, cellDepth * 0.18);
      const width = clamp(cellWidth * (0.34 + detailRandom() * 0.16), 2.4, 6.6);
      const depth = clamp(cellDepth * (0.34 + detailRandom() * 0.18), 2.3, 6.4);
      const height = 1.25 + detailRandom() * 1.65;
      addRoofBox(
        pools.weatheredBoxes,
        roof,
        localX,
        roof.y + 0.12 + height * 0.5,
        localZ,
        width,
        height,
        depth,
      );
      addRoofBox(
        pools.darkBoxes,
        roof,
        localX,
        roof.y + height + 0.19,
        localZ,
        width * 0.74,
        0.13,
        depth * 0.74,
      );
      counts.hvacUnits += 1;
      if ((index + roof.id) % 4 !== 0) {
        addFan(
          roof,
          localX,
          localZ,
          roof.y + height + 0.28,
          Math.min(width, depth) * 0.27,
          detailRandom() * TAU,
          0.72 + detailRandom() * 0.72,
        );
      }
    }
  }

  function addVentBank(roof) {
    const count = clamp(Math.floor(roof.width * roof.depth / 1850) + 2, 3, 9);
    for (let index = 0; index < count; ++index) {
      const localX = -roof.width * 0.38 + (index + 0.5) * roof.width * 0.76 / count +
        (detailRandom() - 0.5) * 1.3;
      const localZ = roof.depth * (0.29 + (detailRandom() - 0.5) * 0.10);
      const radius = 0.25 + detailRandom() * 0.34;
      const height = 0.85 + detailRandom() * 1.65;
      const world = roofPoint(roof, localX, localZ, roof.y + height * 0.5 + 0.08);
      addVerticalCylinder(pools.metalCylinders, world[0], world[1], world[2], radius, height);
      const cap = roofPoint(roof, localX, localZ, roof.y + height + 0.12);
      addVerticalCylinder(pools.darkCylinders, cap[0], cap[1], cap[2], radius * 1.34, 0.18);
      counts.ventStacks += 1;
    }
  }

  function addRoofConduits(roof) {
    const count = 4 + roof.id % 4;
    for (let index = 0; index < count; ++index) {
      const alongX = index % 2 === 0;
      const length = alongX
        ? clamp(roof.width * (0.15 + detailRandom() * 0.19), 5, 18)
        : clamp(roof.depth * (0.16 + detailRandom() * 0.20), 5, 18);
      const localX = (detailRandom() - 0.5) * roof.width * 0.66;
      const localZ = (detailRandom() - 0.5) * roof.depth * 0.62;
      addRoofBox(
        pools.weatheredBoxes,
        roof,
        localX,
        roof.y + 0.22,
        localZ,
        alongX ? length : 0.38,
        0.34 + detailRandom() * 0.18,
        alongX ? 0.38 : length,
      );
      counts.utilitySegments += 1;
    }

    if (roof.y < 76) {
      const riserCount = roof.id % 3 === 0 ? 2 : 1;
      for (let index = 0; index < riserCount; ++index) {
        const localX = -roof.width * 0.28 + index * roof.width * 0.22;
        const localZ = -roof.depth * 0.5 - 0.34;
        const bottom = roofPoint(roof, localX, localZ, 2.2);
        const top = roofPoint(roof, localX, localZ, roof.y + 0.42);
        addCylinderSegment(pools.metalCylinders, bottom, top, 0.18 + detailRandom() * 0.08);
        const elbowEnd = roofPoint(roof, localX, -roof.depth * 0.5 + 2.8, roof.y + 0.42);
        addCylinderSegment(pools.metalCylinders, top, elbowEnd, 0.18 + detailRandom() * 0.08);
        counts.utilitySegments += 2;
      }
    }
  }

  function addTank(roof) {
    const localX = roof.width * (0.22 + (detailRandom() - 0.5) * 0.12);
    const localZ = -roof.depth * (0.20 + (detailRandom() - 0.5) * 0.14);
    const radius = clamp(Math.min(roof.width, roof.depth) * 0.035, 1.25, 2.9);
    const height = 2.8 + detailRandom() * 3.8;
    addRoofBox(
      pools.concreteBoxes,
      roof,
      localX,
      roof.y + 0.22,
      localZ,
      radius * 2.5,
      0.42,
      radius * 2.5,
    );
    const body = roofPoint(roof, localX, localZ, roof.y + 0.42 + height * 0.5);
    addVerticalCylinder(pools.wetCylinders, body[0], body[1], body[2], radius, height);
    for (const band of [0.24, 0.76]) {
      const bandPoint = roofPoint(roof, localX, localZ, roof.y + 0.42 + height * band);
      addVerticalCylinder(pools.darkCylinders, bandPoint[0], bandPoint[1], bandPoint[2], radius * 1.035, 0.16);
    }
    counts.waterTanks += 1;
  }

  function addAntenna(roof) {
    const localX = -roof.width * (0.20 + detailRandom() * 0.11);
    const localZ = -roof.depth * (0.10 + detailRandom() * 0.15);
    const mastHeight = 4.5 + detailRandom() * 8.5;
    const base = roofPoint(roof, localX, localZ, roof.y + 0.2);
    const top = roofPoint(roof, localX, localZ, roof.y + mastHeight);
    addCylinderSegment(pools.metalCylinders, base, top, 0.11 + detailRandom() * 0.09);
    const crossY = roof.y + mastHeight * 0.74;
    const crossA = roofPoint(roof, localX - 1.45, localZ, crossY);
    const crossB = roofPoint(roof, localX + 1.45, localZ, crossY);
    addBoxSegment(pools.weatheredBoxes, crossA, crossB, 0.16);
    counts.antennaMasts += 1;
    if (roof.id % 12 === 0) {
      addDish(
        roof,
        localX,
        localZ,
        roof.y + mastHeight * 0.57,
        0.82 + detailRandom() * 0.78,
        (detailRandom() - 0.5) * 1.8,
        0.18 + detailRandom() * 0.32,
      );
    }
    if (roof.y > 58 && roof.id % 11 === 0) {
      addObstructionLight(top, 0.23 + detailRandom() * 0.08, detailRandom() * TAU);
    }
  }

  function addCrane(roof, ordinal) {
    const localX = (ordinal % 2 ? -1 : 1) * roof.width * 0.28;
    const localZ = roof.depth * 0.24;
    const towerHeight = 11 + ordinal * 2.2;
    const base = roofPoint(roof, localX, localZ, roof.y + 0.1);
    const topY = roof.y + towerHeight;
    const legSpread = 1.35;
    for (const offset of [-legSpread, legSpread]) {
      const bottom = roofPoint(roof, localX + offset, localZ, roof.y + 0.1);
      const top = roofPoint(roof, localX + offset * 0.38, localZ, topY);
      addBoxSegment(pools.weatheredBoxes, bottom, top, 0.34);
    }
    const craneYaw = roof.yaw + (ordinal % 2 ? -0.48 : 0.58);
    const boomLength = clamp(roof.width * 0.34, 16, 28);
    const boomDirection = [Math.cos(craneYaw), 0, -Math.sin(craneYaw)];
    const boomStart = [base[0] - boomDirection[0] * 5, topY, base[2] - boomDirection[2] * 5];
    const boomEnd = [base[0] + boomDirection[0] * boomLength, topY, base[2] + boomDirection[2] * boomLength];
    addBoxSegment(pools.weatheredBoxes, boomStart, boomEnd, 0.52);
    const tieTop = [base[0], topY + 5.2, base[2]];
    addBoxSegment(pools.weatheredBoxes, [base[0], topY, base[2]], tieTop, 0.33);
    addBoxSegment(pools.weatheredBoxes, tieTop, boomEnd, 0.22);
    const trolley = [
      base[0] + boomDirection[0] * boomLength * 0.62,
      topY,
      base[2] + boomDirection[2] * boomLength * 0.62,
    ];
    const hook = [trolley[0], roof.y + 3.2, trolley[2]];
    addCylinderSegment(pools.metalCylinders, trolley, hook, 0.08);
    addBox(pools.darkBoxes, hook[0], hook[1] - 0.32, hook[2], 0.6, 0.65, 0.6, craneYaw);
    addObstructionLight(tieTop, 0.22, ordinal * 1.73);
    counts.cranes += 1;
  }

  function addServiceGantry(roof, ordinal) {
    const centerX = (ordinal % 3 - 1) * roof.width * 0.16;
    const centerZ = -roof.depth * 0.30;
    const span = clamp(roof.width * 0.22, 9, 18);
    const height = 4.2 + ordinal % 2 * 1.4;
    const leftBottom = roofPoint(roof, centerX - span * 0.5, centerZ, roof.y + 0.1);
    const rightBottom = roofPoint(roof, centerX + span * 0.5, centerZ, roof.y + 0.1);
    const leftTop = roofPoint(roof, centerX - span * 0.5, centerZ, roof.y + height);
    const rightTop = roofPoint(roof, centerX + span * 0.5, centerZ, roof.y + height);
    addBoxSegment(pools.weatheredBoxes, leftBottom, leftTop, 0.31);
    addBoxSegment(pools.weatheredBoxes, rightBottom, rightTop, 0.31);
    addBoxSegment(pools.weatheredBoxes, leftTop, rightTop, 0.42);
    addBoxSegment(pools.weatheredBoxes, leftBottom, rightTop, 0.18);
    addBoxSegment(pools.weatheredBoxes, rightBottom, leftTop, 0.18);
    counts.serviceGantries += 1;
  }

  for (const roof of roofs) {
    addParapets(roof);
    addHvacCluster(roof);
    addVentBank(roof);
    addRoofConduits(roof);
    if (roof.id % 5 === 0 && roof.width > 55 && roof.depth > 48) addTank(roof);
    if (roof.id % 6 === 0 && roof.y > 36) addAntenna(roof);
  }

  const craneRoofs = roofs
    .filter((roof) => roof.width > 105 && roof.depth > 72 && roof.y < 86)
    .filter((roof) => !overlapsCanal({
      ...roof,
      width: roof.width + 60,
      depth: roof.depth + 60,
    }))
    .sort((a, b) => b.width * b.depth - a.width * a.depth)
    .slice(0, 3);
  craneRoofs.forEach(addCrane);

  const gantryRoofs = roofs
    .filter((roof) => roof.width > 78 && roof.depth > 58 && !craneRoofs.includes(roof))
    .filter((_, index) => index % 7 === 0)
    .slice(0, 5);
  gantryRoofs.forEach(addServiceGantry);

  function totalInstances() {
    return Object.values(pools).reduce((sum, pool) => sum + pool.matrices.length, 0);
  }

  // Small cable trays are the deterministic safety margin that keeps the
  // authored scale layer dense enough across future seed-preserving city edits.
  for (let index = 0; totalInstances() < MIN_INSTANCE_TARGET; ++index) {
    const roof = roofs[index % roofs.length];
    const row = Math.floor(index / roofs.length);
    const localZ = -roof.depth * 0.18 + (row % 5) * 1.1;
    addRoofBox(
      pools.weatheredBoxes,
      roof,
      (index % 3 - 1) * roof.width * 0.16,
      roof.y + 0.16,
      localZ,
      clamp(roof.width * 0.18, 5, 14),
      0.24,
      0.28,
    );
    counts.utilitySegments += 1;
  }

  const instanceCount = totalInstances();
  if (instanceCount > MAX_INSTANCE_TARGET) {
    throw new RangeError(`Megacity microdetail generated ${instanceCount} instances; maximum is ${MAX_INSTANCE_TARGET}`);
  }
  if (detailFootprints.length !== instanceCount) {
    throw new RangeError(
      `Megacity microdetail validated ${detailFootprints.length} of ${instanceCount} instance footprints`,
    );
  }
  const detailCanalIntrusions = detailFootprints.filter((footprint) =>
    CANAL_SEGMENTS.some((segment) => rectanglesOverlap(footprint, {
      x: segment.x,
      z: segment.z,
      width: segment.width,
      depth: segment.length,
      yaw: segment.yaw,
    })),
  ).length;
  if (detailCanalIntrusions !== 0) {
    throw new RangeError(`Megacity microdetail projected ${detailCanalIntrusions} instances into the canal`);
  }

  const meshes = [];
  const meshesByPool = new Map();
  for (const [key, pool] of Object.entries(pools)) {
    if (pool.matrices.length === 0) continue;
    const mesh = new THREE.InstancedMesh(pool.geometry, pool.material, pool.matrices.length);
    mesh.name = `Megacity ${key} (${pool.matrices.length})`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.userData.rtxIgnore = true;
    for (let index = 0; index < pool.matrices.length; ++index) {
      mesh.setMatrixAt(index, pool.matrices[index]);
    }
    if (pool.dynamic && THREE.DynamicDrawUsage !== undefined) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere?.();
    group.add(mesh);
    meshes.push(mesh);
    meshesByPool.set(key, mesh);
  }
  if (meshes.length > 12) {
    throw new RangeError(`Megacity microdetail created ${meshes.length} draw calls; maximum is 12`);
  }
  scene.add(group);

  let disposed = false;
  function update(elapsed) {
    if (disposed) return;
    const time = Number(elapsed);
    if (!Number.isFinite(time)) return;

    const fanMesh = meshesByPool.get("fans");
    if (fanMesh) {
      for (let index = 0; index < fanRecords.length; ++index) {
        const fan = fanRecords[index];
        fanMesh.setMatrixAt(index, composeTemporaryMatrix(
          fan.x,
          fan.y,
          fan.z,
          fan.radius,
          1,
          fan.radius,
          fan.yaw + fan.phase + time * fan.speed,
        ));
      }
      fanMesh.instanceMatrix.needsUpdate = true;
    }

    const lightMesh = meshesByPool.get("obstructionLights");
    if (lightMesh) {
      for (let index = 0; index < lightRecords.length; ++index) {
        const light = lightRecords[index];
        const pulse = 0.70 + 0.30 * Math.pow(0.5 + 0.5 * Math.sin(time * 1.7 + light.phase), 3);
        const radius = light.radius * pulse;
        lightMesh.setMatrixAt(index, composeTemporaryMatrix(
          light.position[0],
          light.position[1],
          light.position[2],
          radius,
          radius,
          radius,
        ));
      }
      lightMesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(0);

  const stats = Object.freeze({
    drawCalls: meshes.length,
    instances: instanceCount,
    acceptedRoofs: roofs.length,
    canalRejectedRoofs: canalRejected,
    deckRejectedRoofs: deckRejected,
    canalIntrusions: detailCanalIntrusions,
    validatedFootprints: detailFootprints.length,
    emitsBuildingMasses: false,
    animatedInstances: fanRecords.length + lightRecords.length,
    ...counts,
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent?.();
    if (group.parent) group.parent.remove(group);
    group.clear();
    for (const geometry of ownedGeometries) geometry.dispose();
    meshes.length = 0;
    meshesByPool.clear();
    fanRecords.length = 0;
    lightRecords.length = 0;
  }

  return Object.freeze({ group, update, dispose, stats });
}
