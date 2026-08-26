import * as THREE from "three/webgpu";

const POND_OFFSET = Object.freeze({ x: -0.6, y: 0, z: 0.4 });
const INNER_WIDTH = 2.2;
const INNER_LENGTH = 1.4;
const WATER_DEPTH = 0.12;
const WALL_THICKNESS = 0.12;
const FLOOR_THICKNESS = 0.07;
const FREEBOARD = 0.04;
const RIM_HEIGHT = WATER_DEPTH + FREEBOARD;

const KOI_POSES = Object.freeze([
  Object.freeze({
    name: "Kohaku koi",
    color: 0xf2e4d4,
    finColor: 0xc44722,
    x: -0.46,
    z: 0.22,
    yaw: 0.52,
    scale: 1,
  }),
  Object.freeze({
    name: "Ogon koi",
    color: 0xd4a03c,
    finColor: 0xe8c56a,
    x: 0.38,
    z: -0.28,
    yaw: -1.92,
    scale: 0.88,
  }),
  Object.freeze({
    name: "Showa koi",
    color: 0x2a1c16,
    finColor: 0xb33a1c,
    x: 0.54,
    z: 0.30,
    yaw: 2.42,
    scale: 0.78,
  }),
]);

function ignoreRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function createBasinStoneMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered pond limestone",
    color: 0x6d675c,
    roughness: 0.78,
    metalness: 0.02,
    transmission: 0,
    transparent: false,
  });
  material.rtxReflectionMask = 0.12;
  return material;
}

function createPondWaterMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Shallow greenhouse pond water",
    color: 0x4a7c88,
    roughness: 0.04,
    metalness: 0,
    transmission: 0.95,
    thickness: WATER_DEPTH,
    ior: 1.333,
    attenuationColor: new THREE.Color(0x2a6a72),
    attenuationDistance: 1.35,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  // Raster transmission stands in for refraction; this plane stays out of the BLAS.
  material.rtxPreserveTransparency = 1;
  material.rtxReflectionMask = 0.12;
  return material;
}

function createWetKoiMaterial(name, hex) {
  return new THREE.MeshPhysicalNodeMaterial({
    name,
    color: hex,
    roughness: 0.22,
    metalness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transmission: 0,
    transparent: false,
  });
}

function configureWaterMaterial(material) {
  material.transmission = 0.95;
  material.ior = 1.333;
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  if (!Number.isFinite(material.thickness) || material.thickness <= 0) {
    material.thickness = WATER_DEPTH;
  }
  material.rtxPreserveTransparency = 1;
  if (!Number.isFinite(material.rtxReflectionMask)) material.rtxReflectionMask = 0.12;
  return material;
}

function addBox(parent, geometry, material, x, y, z, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createBasin(stoneMaterial) {
  const basin = new THREE.Group();
  basin.name = "Stone pond basin";

  const outerWidth = INNER_WIDTH + WALL_THICKNESS * 2;
  const outerLength = INNER_LENGTH + WALL_THICKNESS * 2;
  const floorTop = FLOOR_THICKNESS;
  const wallCenterY = floorTop + RIM_HEIGHT * 0.5;
  const longWallZ = (INNER_LENGTH + WALL_THICKNESS) * 0.5;
  const shortWallX = (INNER_WIDTH + WALL_THICKNESS) * 0.5;

  const floorGeometry = new THREE.BoxGeometry(outerWidth, FLOOR_THICKNESS, outerLength);
  floorGeometry.name = "Pond basin floor";
  addBox(basin, floorGeometry, stoneMaterial, 0, FLOOR_THICKNESS * 0.5, 0, "Pond limestone floor");

  const longWallGeometry = new THREE.BoxGeometry(outerWidth, RIM_HEIGHT, WALL_THICKNESS);
  longWallGeometry.name = "Pond basin long wall";
  addBox(basin, longWallGeometry, stoneMaterial, 0, wallCenterY, longWallZ, "Pond north rim");
  addBox(basin, longWallGeometry, stoneMaterial, 0, wallCenterY, -longWallZ, "Pond south rim");

  const shortWallGeometry = new THREE.BoxGeometry(WALL_THICKNESS, RIM_HEIGHT, INNER_LENGTH);
  shortWallGeometry.name = "Pond basin short wall";
  addBox(basin, shortWallGeometry, stoneMaterial, shortWallX, wallCenterY, 0, "Pond east rim");
  addBox(basin, shortWallGeometry, stoneMaterial, -shortWallX, wallCenterY, 0, "Pond west rim");

  return basin;
}

function createKoi({ name, color, finColor, x, z, yaw, scale }, y, geometries) {
  const root = new THREE.Group();
  root.name = name;

  const bodyMaterial = createWetKoiMaterial(`${name} wet skin`, color);
  const finMaterial = createWetKoiMaterial(`${name} wet fins`, finColor);
  finMaterial.side = THREE.DoubleSide;

  const body = new THREE.Mesh(geometries.body, bodyMaterial);
  body.name = `${name} ellipsoid`;
  body.scale.set(0.19 * scale, 0.048 * scale, 0.072 * scale);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const tail = new THREE.Mesh(geometries.tail, finMaterial);
  tail.name = `${name} caudal fin`;
  tail.position.set(-0.175 * scale, 0.004 * scale, 0);
  tail.scale.setScalar(scale);
  tail.castShadow = true;
  root.add(tail);

  const dorsal = new THREE.Mesh(geometries.dorsal, finMaterial);
  dorsal.name = `${name} dorsal fin`;
  dorsal.position.set(0.01 * scale, 0.055 * scale, 0);
  dorsal.scale.setScalar(scale);
  dorsal.castShadow = true;
  root.add(dorsal);

  const pectoralLeft = new THREE.Mesh(geometries.pectoral, finMaterial);
  pectoralLeft.name = `${name} left pectoral fin`;
  pectoralLeft.position.set(0.04 * scale, -0.004 * scale, 0.062 * scale);
  pectoralLeft.rotation.set(0.42, 0.18, -0.55);
  pectoralLeft.scale.setScalar(scale);
  root.add(pectoralLeft);

  const pectoralRight = new THREE.Mesh(geometries.pectoral, finMaterial);
  pectoralRight.name = `${name} right pectoral fin`;
  pectoralRight.position.set(0.04 * scale, -0.004 * scale, -0.062 * scale);
  pectoralRight.rotation.set(-0.42, -0.18, 0.55);
  pectoralRight.scale.setScalar(scale);
  root.add(pectoralRight);

  root.position.set(x, y, z);
  root.rotation.y = yaw;
  ignoreRtx(root);
  return root;
}

/**
 * Shallow stone basin, transmissive water plane, and three idle koi.
 * The basin is opaque BLAS geometry; water and koi stay on the raster path.
 */
export function createPond({ materials } = {}) {
  const group = new THREE.Group();
  group.name = "Greenhouse stone pond";
  group.position.set(POND_OFFSET.x, POND_OFFSET.y, POND_OFFSET.z);

  const stoneMaterial = materials?.stone ?? createBasinStoneMaterial();
  const waterMaterial = configureWaterMaterial(materials?.water ?? createPondWaterMaterial());

  const basin = createBasin(stoneMaterial);
  group.add(basin);

  const floorTop = FLOOR_THICKNESS;
  const waterGeometry = new THREE.PlaneGeometry(INNER_WIDTH - 0.04, INNER_LENGTH - 0.04, 1, 1);
  waterGeometry.name = "Pond water plane";
  const water = ignoreRtx(new THREE.Mesh(waterGeometry, waterMaterial));
  water.name = "Transmissive pond water";
  water.rotation.x = -Math.PI * 0.5;
  water.position.y = floorTop + WATER_DEPTH;
  water.receiveShadow = true;
  water.renderOrder = 4;
  group.add(water);

  const koi = ignoreRtx(new THREE.Group());
  koi.name = "Idle koi";
  const koiGeometries = {
    body: new THREE.SphereGeometry(1, 24, 16),
    tail: new THREE.PlaneGeometry(0.13, 0.11),
    dorsal: new THREE.PlaneGeometry(0.12, 0.055),
    pectoral: new THREE.PlaneGeometry(0.08, 0.045),
  };
  koiGeometries.body.name = "Koi ellipsoid body";
  koiGeometries.tail.name = "Koi caudal fin";
  koiGeometries.dorsal.name = "Koi dorsal fin";
  koiGeometries.pectoral.name = "Koi pectoral fin";

  const koiY = floorTop + WATER_DEPTH * 0.46;
  for (const pose of KOI_POSES) {
    koi.add(createKoi(pose, koiY, koiGeometries));
  }
  group.add(koi);

  return Object.freeze({ group, water, basin, koi });
}
