import * as THREE from "three/webgpu";
import {
  applySurfaceTexture,
  createInteriorTextureSet,
  createSurfaceTextureSet,
  disposeSurfaceTextureSets,
} from "./surface-textures.mjs";
import { createInteriorMappedMaterial } from "./interior-mapping.mjs";

const DEFAULT_SEED = 0x4e454f4e;
const CELESTIAL_SHADOW_RADIUS = 84;
const CELESTIAL_SHADOW_MAP_SIZE = 2048;
const ROAD_HALF_WIDTH = 6;
const ROAD_TOP = 0.04;
const SIDEWALK_TOP = 0.20;
const STREET_LEVEL_PLINTH_HEIGHT = 0.82;
const COAST_X = 156;
const WATER_LEVEL = -0.34;
const X_ROADS = Object.freeze([-168, -120, -72, -24, 24, 72, 120]);
const Z_ROADS = Object.freeze([-168, -120, -72, -24, 24, 72, 120, 168]);
const X_BLOCKS = Object.freeze([-144, -96, -48, 0, 48, 96]);
const Z_BLOCKS = Object.freeze([-144, -96, -48, 0, 48, 96, 144]);
const CITY_BOUNDS = Object.freeze({ minX: -192, maxX: 155, minZ: -192, maxZ: 192 });
const TRAVERSABLE_BOUNDS = Object.freeze({ minX: -192, maxX: 192, minZ: -192, maxZ: 620 });

const PARK_BLOCK = Object.freeze([-48, -48]);
const PLAZA_BLOCK = Object.freeze([0, 0]);
const GARAGE_BLOCK = Object.freeze([-144, 96]);

const DISTRICTS = Object.freeze([
  Object.freeze({
    id: "pulse-core",
    name: "Pulse Core",
    kind: "downtown",
    bounds: Object.freeze({ minX: -72, maxX: 72, minZ: -72, maxZ: 72 }),
    heightScale: 1.24,
    facadeStyles: Object.freeze([0, 1, 4]),
    pavementStyle: 0,
    tags: Object.freeze(["nightlife", "high-rise", "commercial"]),
  }),
  Object.freeze({
    id: "harbour-mile",
    name: "Harbour Mile",
    kind: "waterfront",
    bounds: Object.freeze({ minX: 78, maxX: CITY_BOUNDS.maxX, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ }),
    heightScale: 0.76,
    facadeStyles: Object.freeze([0, 2, 5]),
    pavementStyle: 2,
    tags: Object.freeze(["industrial", "tourism", "docks"]),
  }),
  Object.freeze({
    id: "north-market",
    name: "North Market",
    kind: "mixed-use",
    bounds: Object.freeze({ minX: CITY_BOUNDS.minX, maxX: 77.99, minZ: 96, maxZ: CITY_BOUNDS.maxZ }),
    heightScale: 0.88,
    facadeStyles: Object.freeze([2, 3, 5]),
    pavementStyle: 1,
    tags: Object.freeze(["market", "residential", "garage"]),
  }),
  Object.freeze({
    id: "westside",
    name: "Westside",
    kind: "residential",
    bounds: Object.freeze({ minX: CITY_BOUNDS.minX, maxX: -72.01, minZ: CITY_BOUNDS.minZ, maxZ: 95.99 }),
    heightScale: 0.68,
    facadeStyles: Object.freeze([2, 3, 5]),
    pavementStyle: 1,
    tags: Object.freeze(["apartments", "old-city", "local"]),
  }),
  Object.freeze({
    id: "midtown-loop",
    name: "Midtown Loop",
    kind: "commercial",
    bounds: Object.freeze({ minX: -72, maxX: 77.99, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ }),
    heightScale: 0.98,
    facadeStyles: Object.freeze([0, 1, 2, 4]),
    pavementStyle: 0,
    tags: Object.freeze(["offices", "transit", "retail"]),
  }),
]);

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

function sameBlock(x, z, block) {
  return x === block[0] && z === block[1];
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vectorFrom(value, fallbackY = 0) {
  if (value?.isVector3) return value;
  if (Array.isArray(value)) {
    return new THREE.Vector3(finite(value[0]), finite(value[1], fallbackY), finite(value[2]));
  }
  return new THREE.Vector3(finite(value?.x), finite(value?.y, fallbackY), finite(value?.z));
}

function standardMaterial(color, roughness, metalness = 0, extras = {}) {
  return new THREE.MeshStandardNodeMaterial({
    color,
    roughness,
    metalness,
    ...extras,
  });
}

function unlitMaterial(color, extras = {}) {
  const material = new THREE.MeshBasicNodeMaterial({ color, ...extras });
  material.toneMapped = false;
  return material;
}

function transform(position, scale, rotation = [0, 0, 0]) {
  return { position, scale, rotation };
}

function freezePosition(position) {
  return Object.freeze(position.map(Number));
}

function spawn(id, position, heading = 0, extras = {}) {
  return Object.freeze({
    id,
    position: freezePosition(position),
    heading,
    ...extras,
  });
}

function mission(id, label, position, radius = 4, extras = {}) {
  return Object.freeze({
    id,
    label,
    position: freezePosition(position),
    radius,
    ...extras,
  });
}

/**
 * Builds a deterministic, JS-only coastal city. Rendering data is deliberately
 * separate from collision and route records so Node tests and gameplay systems
 * can use the same world contract without initializing a renderer.
 */
export function buildCity(scene, {
  seed = DEFAULT_SEED,
  authoredFacadeTexture = null,
  authoredStoneTexture = null,
  authoredBrickTexture = null,
  authoredRoadTexture = null,
  authoredPavementTexture = null,
  authoredCourtTexture = null,
  authoredDepotTexture = null,
} = {}) {
  if (!scene?.add) throw new TypeError("buildCity(scene) requires a Three.js scene.");

  const resolvedSeed = Number(seed) >>> 0;
  const random = mulberry32(resolvedSeed);
  const detailRandom = mulberry32(resolvedSeed ^ 0xa73c5d91);
  // Facade dressing owns a separate stream so visual additions never move
  // authored buildings, blockers, routes or spawn points for an existing seed.
  const facadeRandom = mulberry32(resolvedSeed ^ 0x51f15e5d);
  const root = new THREE.Group();
  root.name = "Neon City static coastal world";
  root.userData.staticWorld = true;
  root.userData.rtxStatic = true;
  root.userData.citySeed = resolvedSeed;
  scene.add(root);

  const geometries = new Set();
  const materials = new Set();
  const staticLights = [];
  const blockers = [];
  const instanceMeshes = [];
  let disposed = false;

  function districtAt(xValue, zValue) {
    const x = finite(xValue);
    const z = finite(zValue);
    return DISTRICTS.find(district =>
      x >= district.bounds.minX && x <= district.bounds.maxX &&
      z >= district.bounds.minZ && z <= district.bounds.maxZ) ?? DISTRICTS[DISTRICTS.length - 1];
  }

  function ownGeometry(geometry) {
    geometries.add(geometry);
    return geometry;
  }

  function ownMaterial(material, name) {
    material.name = name;
    materials.add(material);
    return material;
  }

  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const planeGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
  planeGeometry.computeTangents();
  const poleGeometry = ownGeometry(new THREE.CylinderGeometry(0.5, 0.62, 1, 8));
  const treeTopGeometry = ownGeometry(new THREE.ConeGeometry(1, 1.8, 8, 1));
  const roundCanopyGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const fountainGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 24));
  const courtArcGeometry = ownGeometry(new THREE.RingGeometry(3.28, 3.40, 32, 1, Math.PI * 0.5, Math.PI));
  const basketballGeometry = ownGeometry(new THREE.SphereGeometry(1, 16, 10));
  const hoopGeometry = ownGeometry(new THREE.TorusGeometry(0.46, 0.04, 7, 24));
  const netGeometry = ownGeometry(new THREE.CylinderGeometry(0.43, 0.24, 0.58, 12, 1, true));

  const material = {
    ground: ownMaterial(standardMaterial(0x11151c, 0.94, 0.02), "Dark coastal ground"),
    road: ownMaterial(standardMaterial(0x090e15, 0.31, 0.11), "Rain-dark asphalt"),
    pavement: ownMaterial(standardMaterial(0x39424b, 0.80, 0.01), "Cool city pavement"),
    pavementWarm: ownMaterial(standardMaterial(0x514941, 0.86, 0.01), "Westside aggregate pavement"),
    pavementIndustrial: ownMaterial(standardMaterial(0x35444a, 0.74, 0.015), "Harbour salt-worn pavement"),
    promenade: ownMaterial(standardMaterial(0x53616a, 0.68, 0.01), "Waterfront promenade stone"),
    curb: ownMaterial(standardMaterial(0x737b7f, 0.78, 0.01), "Rain-polished granite curbs"),
    grass: ownMaterial(standardMaterial(0x17382c, 0.91, 0.01), "Night park grass"),
    concrete: ownMaterial(standardMaterial(0x4a535b, 0.78, 0.04), "Garage concrete"),
    concreteDark: ownMaterial(standardMaterial(0x343b40, 0.86, 0.035), "Garage shadow concrete"),
    depotCladding: ownMaterial(standardMaterial(0x46525a, 0.68, 0.30), "Southline weathered corrugated cladding"),
    court: ownMaterial(standardMaterial(0x4f7279, 0.72, 0.01), "Salt-worn painted waterfront court"),
    courtKey: ownMaterial(standardMaterial(0x6f4b43, 0.75, 0.01), "Weathered warm court key paint"),
    courtBall: ownMaterial(standardMaterial(0xc76522, 0.72, 0.01), "Scuffed public-court basketballs"),
    courtNet: ownMaterial(standardMaterial(0xd8ddd9, 0.88, 0, {
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      wireframe: true,
    }), "Woven basketball net"),
    roof: ownMaterial(standardMaterial(0x222b34, 0.73, 0.18), "Rooftop plant metal"),
    trunk: ownMaterial(standardMaterial(0x3b281f, 0.92, 0.01), "Tree bark"),
    foliage: ownMaterial(standardMaterial(0x195442, 0.82, 0.02), "Coastal park foliage"),
    pole: ownMaterial(standardMaterial(0x202a33, 0.36, 0.74), "Streetlight steel"),
    facadeTrim: ownMaterial(standardMaterial(0x687783, 0.42, 0.62), "Architectural facade trim"),
    balcony: ownMaterial(standardMaterial(0x36434c, 0.58, 0.38), "Apartment balcony slabs"),
    utility: ownMaterial(standardMaterial(0x24333a, 0.74, 0.36), "Street utility furniture"),
    civicArt: ownMaterial(standardMaterial(0x81543d, 0.56, 0.62), "Weathered civic steel"),
    hydrant: ownMaterial(standardMaterial(0xa62d32, 0.52, 0.45), "Municipal fire hydrants"),
    signalHousing: ownMaterial(standardMaterial(0x11181d, 0.46, 0.62), "Traffic signal housings"),
    laneWhite: ownMaterial(standardMaterial(0x929b98, 0.84, 0.015), "Weathered cool lane paint"),
    laneAmber: ownMaterial(standardMaterial(0xb58435, 0.74, 0.03), "Weathered amber center paint"),
    roadReflector: ownMaterial(unlitMaterial(0x8da9ad, { transparent: true, opacity: 0.76 }), "Wet-road glass reflectors"),
    puddle: ownMaterial(standardMaterial(0x112c3c, 0.08, 0.62, {
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
    }), "Shallow street puddles"),
    streetPool: ownMaterial(unlitMaterial(0xffd6a0, {
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    }), "Warm practical streetlight pavement glow"),
    shelterGlass: ownMaterial(standardMaterial(0x64b9ce, 0.12, 0.18, {
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }), "Rain-streaked bus shelter glass"),
    haze: ownMaterial(unlitMaterial(0x4d7d92, {
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    }), "Coastal ground haze"),
    water: ownMaterial(standardMaterial(0x092d42, 0.18, 0.34, {
      transparent: true,
      opacity: 0.91,
      depthWrite: false,
    }), "Neon harbour water"),
    windows: [],
    signs: [
      ownMaterial(unlitMaterial(0x33e6ff, { side: THREE.DoubleSide, transparent: true }), "Cyan neon signs"),
      ownMaterial(unlitMaterial(0xff4dab, { side: THREE.DoubleSide, transparent: true }), "Magenta neon signs"),
      ownMaterial(unlitMaterial(0xffb642, { side: THREE.DoubleSide, transparent: true }), "Amber neon signs"),
    ],
    signalLamps: [
      ownMaterial(unlitMaterial(0xff4a3f), "Traffic signal red lamps"),
      ownMaterial(unlitMaterial(0xffb43a), "Traffic signal amber lamps"),
      ownMaterial(unlitMaterial(0x48f09c), "Traffic signal green lamps"),
    ],
    containers: [
      ownMaterial(standardMaterial(0x1f6f7f, 0.54, 0.52), "Teal harbour containers"),
      ownMaterial(standardMaterial(0x8c3844, 0.60, 0.48), "Red harbour containers"),
      ownMaterial(standardMaterial(0xb7772d, 0.58, 0.50), "Ochre harbour containers"),
    ],
    buildings: [
      ownMaterial(standardMaterial(0x365464, 0.55, 0.18), "Blue-grey tower facade"),
      ownMaterial(standardMaterial(0x554b5e, 0.59, 0.12), "Plum concrete facade"),
      ownMaterial(standardMaterial(0x485a63, 0.66, 0.08), "Slate apartment facade"),
      ownMaterial(standardMaterial(0x624f49, 0.64, 0.10), "Warm brick facade"),
      ownMaterial(standardMaterial(0x315e63, 0.44, 0.22), "Teal curtain-wall facade"),
      ownMaterial(standardMaterial(0x7a7167, 0.73, 0.05), "Salt-aged stone facade"),
    ],
  };

  const surfaceTextures = [
    createSurfaceTextureSet("asphalt", { repeat: [10, 72], normalStrength: 3.1 }),
    createSurfaceTextureSet("concrete", { repeat: [8, 8], normalStrength: 2.4 }),
    createSurfaceTextureSet("facade", { repeat: [5, 9], normalStrength: 1.35 }),
    createSurfaceTextureSet("brick", { repeat: [3, 5], normalStrength: 2.65 }),
    createSurfaceTextureSet("metal", { repeat: [7, 7], normalStrength: 1.8 }),
    createSurfaceTextureSet("court", { repeat: [2, 3], normalStrength: 1.65 }),
  ];
  const [asphaltTextures, concreteTextures, facadeTextures, brickTextures, metalTextures, courtTextures] = surfaceTextures;
  const interiorTextureSets = [0, 1, 2].map(style => createInteriorTextureSet(style));
  surfaceTextures.push(...interiorTextureSets);
  const interiorMaterials = interiorTextureSets.map((textureSet, style) => {
    const controller = createInteriorMappedMaterial(textureSet, { style });
    ownMaterial(controller.material, `${textureSet.style} occupied parallax interiors`);
    material.windows.push(controller.material);
    return controller;
  });
  applySurfaceTexture(material.road, asphaltTextures, 0.72);
  for (const surface of [material.ground, material.pavement, material.pavementWarm, material.pavementIndustrial,
    material.promenade, material.curb, material.concrete, material.concreteDark]) {
    applySurfaceTexture(surface, concreteTextures, 0.52);
  }
  for (const facade of material.buildings) applySurfaceTexture(facade, facadeTextures, 0.38);
  applySurfaceTexture(material.buildings[3], brickTextures, 0.78);
  applySurfaceTexture(material.court, courtTextures, 0.62);
  applySurfaceTexture(material.courtKey, courtTextures, 0.48);

  function configureAuthoredSurface(texture, name, repeat) {
    if (!texture?.isTexture) return false;
    texture.name ||= name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    surfaceTextures.push(Object.freeze({ kind: name, textures: Object.freeze([texture]) }));
    return true;
  }

  const usesAuthoredRoadTexture = configureAuthoredSurface(
    authoredRoadTexture,
    "authored coastal asphalt",
    [10, 72],
  );
  if (usesAuthoredRoadTexture) {
    material.road.map = authoredRoadTexture;
    material.road.color.setHex(0xc5c9ca);
    material.road.needsUpdate = true;
  }

  const usesAuthoredPavementTexture = configureAuthoredSurface(
    authoredPavementTexture,
    "authored concrete aggregate pavement",
    [8, 8],
  );
  if (usesAuthoredPavementTexture) {
    for (const [surface, tint] of [
      [material.pavement, 0xaeb9bf],
      [material.pavementWarm, 0xc5b5a8],
      [material.pavementIndustrial, 0x9caeb0],
      [material.promenade, 0xafbdc1],
      [material.curb, 0xc5c9c8],
    ]) {
      surface.map = authoredPavementTexture;
      surface.color.setHex(tint);
      surface.needsUpdate = true;
    }
  }

  const usesAuthoredFacadeTexture = Boolean(authoredFacadeTexture?.isTexture);
  if (usesAuthoredFacadeTexture) {
    configureAuthoredSurface(authoredFacadeTexture, "authored weathered facade", [3, 5]);
    for (const [style, tint] of [[2, 0xb3c0c5], [5, 0xd2cbc1]]) {
      material.buildings[style].map = authoredFacadeTexture;
      material.buildings[style].color.setHex(tint);
      material.buildings[style].needsUpdate = true;
    }
  }
  const usesAuthoredStoneTexture = Boolean(authoredStoneTexture?.isTexture);
  if (usesAuthoredStoneTexture) {
    configureAuthoredSurface(authoredStoneTexture, "authored salt-aged stone facade", [3, 5]);
    for (const [style, tint] of [[0, 0xaebdc0], [1, 0xb9b0b5], [4, 0xa3b9b7]]) {
      material.buildings[style].map = authoredStoneTexture;
      material.buildings[style].color.setHex(tint);
      material.buildings[style].roughness = 0.72;
      material.buildings[style].metalness = style === 4 ? 0.08 : 0.025;
      material.buildings[style].needsUpdate = true;
    }
  }
  const usesAuthoredBrickTexture = Boolean(authoredBrickTexture?.isTexture);
  if (usesAuthoredBrickTexture) {
    configureAuthoredSurface(authoredBrickTexture, "authored aged coastal brick", [3, 5]);
    material.buildings[3].map = authoredBrickTexture;
    material.buildings[3].color.setHex(0xc8b0a2);
    material.buildings[3].roughness = 0.76;
    material.buildings[3].metalness = 0.015;
    material.buildings[3].needsUpdate = true;
  }
  const usesAuthoredCourtTexture = Boolean(authoredCourtTexture?.isTexture);
  if (usesAuthoredCourtTexture) {
    configureAuthoredSurface(authoredCourtTexture, "authored salt-worn painted basketball court", [2, 3]);
    material.court.map = authoredCourtTexture;
    material.court.color.setHex(0xb2c4c2);
    material.court.roughness = 0.72;
    material.court.metalness = 0.01;
    material.court.needsUpdate = true;
  }
  for (const metal of [material.roof, material.pole, material.facadeTrim, material.balcony, material.utility, material.civicArt,
    material.hydrant, material.signalHousing, material.depotCladding, ...material.containers]) {
    applySurfaceTexture(metal, metalTextures, 0.48);
  }
  const usesAuthoredDepotTexture = configureAuthoredSurface(
    authoredDepotTexture,
    "authored Southline corrugated steel",
    [6, 2],
  );
  if (usesAuthoredDepotTexture) {
    material.depotCladding.map = authoredDepotTexture;
    material.depotCladding.color.setHex(0xc4c8c8);
    material.depotCladding.roughness = 0.68;
    material.depotCladding.metalness = 0.30;
    material.depotCladding.needsUpdate = true;
  }

  function addStaticMesh(name, geometry, meshMaterial, position, scale, rotation = [0, 0, 0], options = {}) {
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.set(...rotation);
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.staticWorld = true;
    mesh.userData.rtxStatic = options.rtxStatic ?? true;
    if (options.rtxIgnore) mesh.userData.rtxIgnore = true;
    root.add(mesh);
    return mesh;
  }

  const tempPosition = new THREE.Vector3();
  const tempScale = new THREE.Vector3();
  const tempEuler = new THREE.Euler();
  const tempQuaternion = new THREE.Quaternion();
  const tempMatrix = new THREE.Matrix4();

  function addInstances(name, geometry, meshMaterial, transforms, options = {}) {
    if (!transforms.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, meshMaterial, transforms.length);
    mesh.name = name;
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.staticWorld = true;
    mesh.userData.rtxStatic = options.rtxStatic ?? true;
    mesh.userData.instanceCount = transforms.length;
    if (options.rtxIgnore) mesh.userData.rtxIgnore = true;
    for (let index = 0; index < transforms.length; ++index) {
      const item = transforms[index];
      tempPosition.set(...item.position);
      tempScale.set(...item.scale);
      tempEuler.set(...(item.rotation ?? [0, 0, 0]));
      tempQuaternion.setFromEuler(tempEuler);
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(index, tempMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    root.add(mesh);
    instanceMeshes.push(mesh);
    return mesh;
  }

  function addBlocker(id, kind, x, z, width, depth, height, baseY = SIDEWALK_TOP) {
    const blocker = Object.freeze({
      id,
      kind,
      shape: "aabb",
      active: true,
      center: freezePosition([x, baseY + height * 0.5, z]),
      halfExtents: freezePosition([width * 0.5, height * 0.5, depth * 0.5]),
    });
    blockers.push(blocker);
    return blocker;
  }

  // Chapter Two's physical contract lives in the otherwise-unused western
  // service strip beside Avenue 01. The yard bounds stop before all three
  // surrounding road surfaces; only roadApproach deliberately occupies a
  // legal lane point. Gameplay can later consume these named anchors without
  // coupling world construction to story state.
  const chapterTwoInteractAnchors = Object.freeze({
    manifestDesk: freezePosition([-180.35, SIDEWALK_TOP, -136]),
    suspectPallet: freezePosition([-177.80, SIDEWALK_TOP, -143]),
    loadingSeal: freezePosition([-177.00, SIDEWALK_TOP, -134]),
    customerVehicleBay: freezePosition([-179.00, SIDEWALK_TOP, -152]),
  });
  const chapterTwoPracticalPositions = Object.freeze([
    freezePosition([-183.48, SIDEWALK_TOP + 3.58, -151]),
    freezePosition([-183.48, SIDEWALK_TOP + 3.58, -137]),
  ]);
  const chapterTwoGarageClues = Object.freeze({
    failed_brake_hose: freezePosition([-151.5, SIDEWALK_TOP, 79.6]),
    supplier_invoice: freezePosition([-144, SIDEWALK_TOP, 79.6]),
    service_log: freezePosition([-136.5, SIDEWALK_TOP, 79.6]),
  });
  // Interaction anchors stay at walkable foot level. Cinematic lenses use
  // these exact centers of the already-pooled physical evidence instead of
  // looking through each prop toward the ground marker below it.
  const chapterTwoCinematicAnchors = Object.freeze({
    failed_brake_hose: freezePosition([-151.5, SIDEWALK_TOP + 0.52, 80.18]),
    supplier_invoice: freezePosition([-144, SIDEWALK_TOP + 0.83, 80.181]),
    service_log: freezePosition([-136.5, SIDEWALK_TOP + 0.59, 80.26]),
    depot_manifest: freezePosition([-181.50, SIDEWALK_TOP + 1.075, -136]),
    recall_board: freezePosition([-144, SIDEWALK_TOP + 0.83, 80.181]),
  });
  const chapterTwoAftermathAnchors = Object.freeze({
    // Mara waits on the open forecourt side of the recall board rather than
    // inside the garage shell. Dara's records position is separated from her
    // standing mark so both the person and the copied rows remain legible.
    recallCustomer: freezePosition([-140.35, SIDEWALK_TOP, 78.55]),
    recallDesk: chapterTwoCinematicAnchors.recall_board,
    fleetRecords: freezePosition([-181.50, SIDEWALK_TOP + 1.075, -135.70]),
  });
  // Story actors and interaction markers deliberately do not share a point.
  // This keeps Kai, Leah and Dara readable as separate people even when a
  // native QA/control client teleports directly onto the interaction marker.
  const chapterTwoConversationAnchors = Object.freeze({
    leah: freezePosition([-41, SIDEWALK_TOP, -17]),
    manifest: chapterTwoInteractAnchors.manifestDesk,
  });
  const chapterTwoKeeperWitnessAnchor = freezePosition([-183.10, SIDEWALK_TOP, -138.2]);
  const chapterTwoLeahAnchor = freezePosition([-44, SIDEWALK_TOP, -16.5]);
  const chapterTwo = Object.freeze({
    id: "borrowed-time",
    title: "Borrowed Time",
    depotId: "southline-parts-depot",
    focus: freezePosition([-175.70, SIDEWALK_TOP, -144]),
    roadApproach: freezePosition([-165.35, ROAD_TOP, -144]),
    bounds: Object.freeze({ minX: -191.1, maxX: -175.1, minZ: -159.3, maxZ: -128.7 }),
    interactAnchors: chapterTwoInteractAnchors,
    evidenceAnchors: chapterTwoInteractAnchors,
    manifestDesk: chapterTwoInteractAnchors.manifestDesk,
    suspectPallet: chapterTwoInteractAnchors.suspectPallet,
    loadingSeal: chapterTwoInteractAnchors.loadingSeal,
    customerVehicleBay: chapterTwoInteractAnchors.customerVehicleBay,
    keeperAnchor: chapterTwoKeeperWitnessAnchor,
    witnessAnchor: chapterTwoKeeperWitnessAnchor,
    keeperWitnessAnchor: chapterTwoKeeperWitnessAnchor,
    garageClues: chapterTwoGarageClues,
    cinematicAnchors: chapterTwoCinematicAnchors,
    aftermathAnchors: chapterTwoAftermathAnchors,
    leahAnchor: chapterTwoLeahAnchor,
    conversationAnchors: chapterTwoConversationAnchors,
    leahInteractionAnchor: chapterTwoConversationAnchors.leah,
    manifestInteractionAnchor: chapterTwoConversationAnchors.manifest,
    practicalPositions: chapterTwoPracticalPositions,
  });
  const chapterTwoBayPaintTransforms = Object.freeze([
    transform([-181.75, SIDEWALK_TOP + 0.022, -152], [0.13, 0.026, 8.2]),
    transform([-176.25, SIDEWALK_TOP + 0.022, -152], [0.13, 0.026, 8.2]),
  ]);
  // Four weathered paper surfaces share the existing non-emissive lane-paint
  // batch. They are fully allocated with the city and never appear lazily on
  // first interaction: a clipped invoice, an open service log and Southline's
  // manifest on the depot desk.
  const chapterTwoPaperTransforms = Object.freeze([
    transform([-144, SIDEWALK_TOP + 0.83, 80.181], [0.60, 0.48, 0.018]),
    transform([-136.73, SIDEWALK_TOP + 0.59, 80.26], [0.42, 0.025, 0.42], [0, 0.08, 0]),
    transform([-136.27, SIDEWALK_TOP + 0.59, 80.26], [0.42, 0.025, 0.42], [0, -0.08, 0]),
    transform([-181.50, SIDEWALK_TOP + 1.075, -136], [0.64, 0.025, 0.48], [0, -0.05, 0]),
  ]);
  // Both consequence tableaus are allocated with the city. Two compact call
  // cards sit on the public-recall board; one identified carbon copy and
  // three deliberately blank dispatch rows remain on Southline's desk. They
  // share the existing non-emissive paper batch, so completing an aftermath
  // cannot discover a new material or GPU pipeline.
  const chapterTwoAftermathPaperTransforms = Object.freeze([
    transform([-144.34, SIDEWALK_TOP + 0.71, 80.158], [0.18, 0.10, 0.020], [0, 0, 0.03]),
    transform([-143.84, SIDEWALK_TOP + 0.71, 80.158], [0.18, 0.10, 0.020], [0, 0, -0.025]),
    transform([-181.92, SIDEWALK_TOP + 1.082, -135.70], [0.13, 0.022, 0.34], [0, -0.05, 0]),
    transform([-181.62, SIDEWALK_TOP + 1.082, -135.70], [0.13, 0.022, 0.34], [0, -0.05, 0]),
    transform([-181.32, SIDEWALK_TOP + 1.082, -135.70], [0.13, 0.022, 0.34], [0, -0.05, 0]),
    transform([-181.02, SIDEWALK_TOP + 1.082, -135.70], [0.13, 0.022, 0.34], [0, -0.05, 0]),
  ]);

  // Pulse Street Exchange is a real piece of the city rather than an
  // activity marker floating beside a generic tower. The five shelters were
  // already part of Street 04, so their exact physical centres become the
  // public transit contract. Dry-weather passengers wait at the curb-facing
  // edge while the covered set sits deeper beneath the existing roofs.
  const pulseTransitShelterAnchors = Object.freeze([-144, -96, -48, 48, 96].map(x =>
    freezePosition([x, SIDEWALK_TOP, -16.65])));
  const pulseTransitWaitingAnchors = Object.freeze([-144, -96, -48, 48, 96].map(x =>
    freezePosition([x, SIDEWALK_TOP, -17.25])));
  const pulseTransitCoveredWaitingAnchors = Object.freeze([-144, -96, -48, 48, 96].map(x =>
    freezePosition([x, SIDEWALK_TOP, -16.65])));
  const pulseTransitWestboundCurbStops = Object.freeze([48, 0, -48, -96, -144].map(x =>
    freezePosition([x, ROAD_TOP, -21.35])));
  const pulseTransitPracticalPositions = Object.freeze([
    freezePosition([45.2, SIDEWALK_TOP + 3.08, -14.86]),
    freezePosition([50.8, SIDEWALK_TOP + 3.08, -14.86]),
  ]);
  const pulseLineVehicle = spawn("vehicle-06", [56, ROAD_TOP, -21.35], Math.PI * 0.5, {
    roadId: "street-04",
    kind: "van",
    authorized: true,
    parked: true,
    access: "pulse-line",
    displayName: "PULSE LINE COMMUNITY MINIBUS",
  });
  const pulseTransit = Object.freeze({
    id: "pulse-street-exchange",
    title: "Pulse Street Exchange",
    streetId: "street-04",
    entrance: freezePosition([48, SIDEWALK_TOP, -14.68]),
    hub: freezePosition([48, SIDEWALK_TOP, -16.5]),
    dispatchBay: pulseLineVehicle.position,
    shelterAnchors: pulseTransitShelterAnchors,
    waitingAnchors: pulseTransitWaitingAnchors,
    coveredWaitingAnchors: pulseTransitCoveredWaitingAnchors,
    westboundCurbStops: pulseTransitWestboundCurbStops,
    terminus: pulseTransitWestboundCurbStops[pulseTransitWestboundCurbStops.length - 1],
    bounds: Object.freeze({ minX: 39.5, maxX: 57.5, minZ: -25.5, maxZ: -13.55 }),
    practicalPositions: pulseTransitPracticalPositions,
    vehicleId: pulseLineVehicle.id,
    vehicle: pulseLineVehicle,
  });
  const pulseTransitCurbMarkingTransforms = Object.freeze([
    transform([56, ROAD_TOP + 0.022, -18.52], [12.0, 0.026, 0.13]),
    transform([50, ROAD_TOP + 0.022, -19.96], [0.13, 0.026, 3.0]),
    transform([62, ROAD_TOP + 0.022, -19.96], [0.13, 0.026, 3.0]),
  ]);

  // The base extends only to the seawall; translucent harbour water is kept
  // separate and excluded from static ray registration.
  const groundWidth = CITY_BOUNDS.maxX - CITY_BOUNDS.minX;
  const groundDepth = CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ;
  addStaticMesh(
    "Continuous city foundation",
    boxGeometry,
    material.ground,
    [(CITY_BOUNDS.minX + CITY_BOUNDS.maxX) * 0.5, -0.12, 0],
    [groundWidth, 0.24, groundDepth],
  );
  const water = addStaticMesh(
    "Eastern neon harbour",
    boxGeometry,
    material.water,
    [(COAST_X + 292) * 0.5, WATER_LEVEL - 0.12, 0],
    [292 - COAST_X, 0.24, groundDepth + 48],
    [0, 0, 0],
    { rtxStatic: false, rtxIgnore: true, receiveShadow: false },
  );

  const roads = [];
  const roadLines = [];
  const roadTransforms = [];
  for (let index = 0; index < X_ROADS.length; ++index) {
    const x = X_ROADS[index];
    const id = `avenue-${String(index + 1).padStart(2, "0")}`;
    roads.push(Object.freeze({
      id,
      name: index === X_ROADS.length - 1 ? "Harbour Avenue" : `Avenue ${index + 1}`,
      axis: "z",
      center: freezePosition([x, ROAD_TOP, 0]),
      halfExtents: freezePosition([ROAD_HALF_WIDTH, 0.05, groundDepth * 0.5]),
      speedLimit: index === X_ROADS.length - 1 ? 18 : 22,
    }));
    // Avenue and street crowns are offset by two millimetres and capped at
    // junctions below.  The old coplanar full-length boxes fought for the same
    // depth values at every crossing, which read as doubled/flickering roads.
    roadTransforms.push(transform([x, ROAD_TOP - 0.041, 0], [ROAD_HALF_WIDTH * 2, 0.10, groundDepth]));
    for (const [laneIndex, laneOffset, direction] of [[0, -2.65, -1], [1, 2.65, 1]]) {
      const startZ = direction > 0 ? CITY_BOUNDS.minZ + 8 : CITY_BOUNDS.maxZ - 8;
      const endZ = direction > 0 ? CITY_BOUNDS.maxZ - 8 : CITY_BOUNDS.minZ + 8;
      roadLines.push(Object.freeze({
        id: `${id}-lane-${laneIndex + 1}`,
        roadId: id,
        axis: "z",
        direction,
        speedLimit: index === X_ROADS.length - 1 ? 18 : 22,
        points: Object.freeze([
          freezePosition([x + laneOffset, ROAD_TOP, startZ]),
          freezePosition([x + laneOffset, ROAD_TOP, endZ]),
        ]),
      }));
    }
  }
  for (let index = 0; index < Z_ROADS.length; ++index) {
    const z = Z_ROADS[index];
    const id = `street-${String(index + 1).padStart(2, "0")}`;
    roads.push(Object.freeze({
      id,
      name: index === 3 ? "Pulse Street" : `Street ${index + 1}`,
      axis: "x",
      center: freezePosition([(CITY_BOUNDS.minX + CITY_BOUNDS.maxX) * 0.5, ROAD_TOP, z]),
      halfExtents: freezePosition([groundWidth * 0.5, 0.05, ROAD_HALF_WIDTH]),
      speedLimit: index === 3 ? 24 : 20,
    }));
    roadTransforms.push(transform(
      [(CITY_BOUNDS.minX + CITY_BOUNDS.maxX) * 0.5, ROAD_TOP - 0.039, z],
      [groundWidth, 0.10, ROAD_HALF_WIDTH * 2],
    ));
    for (const [laneIndex, laneOffset, direction] of [[0, -2.65, 1], [1, 2.65, -1]]) {
      const startX = direction > 0 ? CITY_BOUNDS.minX + 8 : CITY_BOUNDS.maxX - 8;
      const endX = direction > 0 ? CITY_BOUNDS.maxX - 8 : CITY_BOUNDS.minX + 8;
      roadLines.push(Object.freeze({
        id: `${id}-lane-${laneIndex + 1}`,
        roadId: id,
        axis: "x",
        direction,
        speedLimit: index === 3 ? 24 : 20,
        points: Object.freeze([
          freezePosition([startX, ROAD_TOP, z + laneOffset]),
          freezePosition([endX, ROAD_TOP, z + laneOffset]),
        ]),
      }));
    }
  }
  const intersectionCaps = [];
  for (const x of X_ROADS) {
    for (const z of Z_ROADS) {
      intersectionCaps.push(transform(
        [x, ROAD_TOP - 0.037, z],
        [ROAD_HALF_WIDTH * 2, 0.102, ROAD_HALF_WIDTH * 2],
      ));
    }
  }
  roadTransforms.push(...intersectionCaps);
  addInstances("Instanced wet road grid", boxGeometry, material.road, roadTransforms, { receiveShadow: true });

  const sidewalkMaterials = [material.pavement, material.pavementWarm, material.pavementIndustrial];
  const sidewalkTransforms = sidewalkMaterials.map(() => []);
  const curbTransforms = [];
  for (const x of X_BLOCKS) {
    for (const z of Z_BLOCKS) {
      const district = districtAt(x, z);
      sidewalkTransforms[district.pavementStyle].push(transform([x, SIDEWALK_TOP * 0.5, z], [36, SIDEWALK_TOP, 36]));
      curbTransforms.push(transform([x - 17.82, SIDEWALK_TOP * 0.52, z], [0.34, SIDEWALK_TOP * 1.04, 35.55]));
      curbTransforms.push(transform([x + 17.82, SIDEWALK_TOP * 0.52, z], [0.34, SIDEWALK_TOP * 1.04, 35.55]));
      curbTransforms.push(transform([x, SIDEWALK_TOP * 0.52, z - 17.82], [35.55, SIDEWALK_TOP * 1.04, 0.34]));
      curbTransforms.push(transform([x, SIDEWALK_TOP * 0.52, z + 17.82], [35.55, SIDEWALK_TOP * 1.04, 0.34]));
    }
  }
  for (let style = 0; style < sidewalkTransforms.length; ++style) {
    addInstances(`Raised district sidewalks style ${style + 1}`, boxGeometry, sidewalkMaterials[style], sidewalkTransforms[style]);
  }
  addInstances("Instanced granite curb edges", boxGeometry, material.curb, curbTransforms);

  const centerMarkings = [];
  const laneMarkings = [];
  const junctionMarkingClearance = ROAD_HALF_WIDTH + 4.2;
  function markingClearsJunction(axis, along, halfLength) {
    const crossings = axis === "z" ? Z_ROADS : X_ROADS;
    return crossings.every(value => Math.abs(along - value) > junctionMarkingClearance + halfLength);
  }
  for (const x of X_ROADS) {
    for (let z = CITY_BOUNDS.minZ + 5; z < CITY_BOUNDS.maxZ; z += 11) {
      if (!markingClearsJunction("z", z, 2.2)) continue;
      centerMarkings.push(transform([x, ROAD_TOP + 0.015, z], [0.16, 0.025, 4.4]));
    }
  }
  for (const z of Z_ROADS) {
    for (let x = CITY_BOUNDS.minX + 5; x < CITY_BOUNDS.maxX; x += 11) {
      if (!markingClearsJunction("x", x, 2.2)) continue;
      centerMarkings.push(transform([x, ROAD_TOP + 0.015, z], [4.4, 0.025, 0.16]));
    }
  }

  // Two legal approaches at each central junction receive a three-piece
  // directional arrow. Reusing the lane-paint batch makes them effectively
  // free in draw-call terms while making the driving direction legible at
  // street height.
  let laneArrowCount = 0;
  function addLaneArrow(x, z, yaw) {
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const addPart = (localX, localZ, scaleX, scaleZ, partYaw = 0) => {
      laneMarkings.push(transform(
        [x + cosine * localX + sine * localZ, ROAD_TOP + 0.021, z - sine * localX + cosine * localZ],
        [scaleX, 0.026, scaleZ],
        [0, yaw + partYaw, 0],
      ));
    };
    addPart(0, -0.18, 0.25, 1.9);
    addPart(-0.34, 1.05, 0.25, 0.95, 0.72);
    addPart(0.34, 1.05, 0.25, 0.95, -0.72);
    laneArrowCount += 1;
  }
  for (const x of X_ROADS.filter(value => Math.abs(value) <= 72)) {
    for (const z of Z_ROADS.filter(value => Math.abs(value) <= 72)) {
      addLaneArrow(x + 2.65, z - 12.2, 0);
      addLaneArrow(x + 12.2, z + 2.65, -Math.PI * 0.5);
    }
  }
  const courtLineTransforms = [
    transform([127.9, SIDEWALK_TOP + 0.164, -96], [0.14, 0.024, 33.4]),
    transform([152.1, SIDEWALK_TOP + 0.164, -96], [0.14, 0.024, 33.4]),
    transform([140, SIDEWALK_TOP + 0.164, -112.7], [24.2, 0.024, 0.14]),
    transform([140, SIDEWALK_TOP + 0.164, -79.3], [24.2, 0.024, 0.14]),
    transform([140.6, SIDEWALK_TOP + 0.168, -96], [0.14, 0.028, 8.9]),
    transform([145.0, SIDEWALK_TOP + 0.169, -91.6], [8.1, 0.028, 0.14]),
    transform([145.0, SIDEWALK_TOP + 0.169, -100.4], [8.1, 0.028, 0.14]),
  ];
  addInstances("Amber dashed road centrelines", boxGeometry, material.laneAmber, centerMarkings, { receiveShadow: false });
  // These are arrows only. The former pair of white dashed lines sat inside
  // every two-lane street and visually doubled the actual centre marking.
  addInstances("Cool directional lane arrows", boxGeometry, material.laneWhite, laneMarkings, { receiveShadow: false });

  const crosswalks = [];
  for (const x of X_ROADS.filter(value => Math.abs(value) <= 72)) {
    for (const z of Z_ROADS.filter(value => Math.abs(value) <= 72)) {
      for (let stripe = -3; stripe <= 3; stripe += 2) {
        crosswalks.push(transform([x + stripe, ROAD_TOP + 0.018, z - 7.5], [1.05, 0.028, 4.2]));
        crosswalks.push(transform([x + 7.5, ROAD_TOP + 0.018, z + stripe], [4.2, 0.028, 1.05]));
      }
    }
  }
  crosswalks.push(...courtLineTransforms);
  crosswalks.push(...chapterTwoBayPaintTransforms);
  crosswalks.push(...pulseTransitCurbMarkingTransforms);
  crosswalks.push(...chapterTwoAftermathPaperTransforms);
  // Keep Chapter Two's four evidence papers at the tail of this batch: its
  // cinematic and native regression probes intentionally address them there.
  crosswalks.push(...chapterTwoPaperTransforms);
  addInstances("Downtown pedestrian crossings", boxGeometry, material.laneWhite, crosswalks, { receiveShadow: false });

  const stopBars = [];
  const roadReflectors = [];
  const manholeTransforms = [];
  const puddleTransforms = [];
  for (const x of X_ROADS) {
    for (let z = CITY_BOUNDS.minZ + 8; z <= CITY_BOUNDS.maxZ - 8; z += 16) {
      if (!markingClearsJunction("z", z, 0.34)) continue;
      roadReflectors.push(transform([x - 3.25, ROAD_TOP + 0.036, z], [0.16, 0.055, 0.34]));
      roadReflectors.push(transform([x + 3.25, ROAD_TOP + 0.036, z], [0.16, 0.055, 0.34]));
    }
  }
  for (const z of Z_ROADS) {
    for (let x = CITY_BOUNDS.minX + 8; x <= CITY_BOUNDS.maxX - 8; x += 16) {
      if (!markingClearsJunction("x", x, 0.34)) continue;
      roadReflectors.push(transform([x, ROAD_TOP + 0.036, z - 3.25], [0.34, 0.055, 0.16]));
      roadReflectors.push(transform([x, ROAD_TOP + 0.036, z + 3.25], [0.34, 0.055, 0.16]));
    }
  }
  for (let xi = 0; xi < X_ROADS.length; ++xi) {
    for (let zi = 0; zi < Z_ROADS.length; ++zi) {
      const x = X_ROADS[xi];
      const z = Z_ROADS[zi];
      if ((xi + zi) % 2 === 0) {
        manholeTransforms.push(transform([x + 2.25, ROAD_TOP + 0.025, z - 2.1], [0.76, 0.035, 0.76], [0, detailRandom() * Math.PI, 0]));
      }
      if (Math.abs(x) <= 72 && Math.abs(z) <= 72) {
        stopBars.push(transform([x, ROAD_TOP + 0.025, z - 5.15], [9.4, 0.032, 0.34]));
        stopBars.push(transform([x + 5.15, ROAD_TOP + 0.025, z], [0.34, 0.032, 9.4]));
      }
    }
  }
  for (let index = 0; index < 68; ++index) {
    const vertical = detailRandom() < 0.52;
    if (vertical) {
      const x = X_ROADS[Math.floor(detailRandom() * X_ROADS.length)] + (detailRandom() < 0.5 ? -4.7 : 4.7);
      const z = CITY_BOUNDS.minZ + 12 + detailRandom() * (groundDepth - 24);
      puddleTransforms.push(transform(
        [x, ROAD_TOP + 0.012, z],
        [0.55 + detailRandom() * 1.35, 0.015, 1.1 + detailRandom() * 2.8],
        [0, detailRandom() * 0.42, 0],
      ));
    } else {
      const x = CITY_BOUNDS.minX + 12 + detailRandom() * (groundWidth - 24);
      const z = Z_ROADS[Math.floor(detailRandom() * Z_ROADS.length)] + (detailRandom() < 0.5 ? -4.7 : 4.7);
      puddleTransforms.push(transform(
        [x, ROAD_TOP + 0.012, z],
        [1.1 + detailRandom() * 2.8, 0.015, 0.55 + detailRandom() * 1.35],
        [0, detailRandom() * 0.42, 0],
      ));
    }
  }
  addInstances("Intersection stop bars", boxGeometry, material.laneWhite, stopBars, { receiveShadow: false });
  addInstances("Wet-road glass reflectors", boxGeometry, material.roadReflector, roadReflectors, { receiveShadow: false });
  addInstances("Cast-iron utility covers", fountainGeometry, material.utility, manholeTransforms);
  addInstances("Irregular shallow street puddles", fountainGeometry, material.puddle, puddleTransforms, {
    receiveShadow: false,
    rtxIgnore: true,
    rtxStatic: false,
  });

  const buildingTransforms = material.buildings.map(() => []);
  const windowTransforms = material.windows.map(() => []);
  const signTransforms = material.signs.map(() => []);
  const rooftopTransforms = [];
  const antennaTransforms = [];
  const podiumTransforms = [];
  const facadeRibTransforms = [];
  const balconyTransforms = [];
  const roofTankTransforms = [];
  const buildingRecords = [];
  const storefrontLightPositions = [];
  const northMarketDisplayPanes = [];
  const businessDisplayPanes = [];
  const businessUtilityTransforms = [];
  let storefrontCount = 0;
  let facadeMullionCount = 0;
  let occupiedGroundFloorCount = 0;
  let groundFloorInteriorBankCount = 0;
  let streetLevelPlinthCount = 0;

  function addBuilding(x, z, width, depth, height, style, id) {
    const district = districtAt(x, z);
    const form = height >= 66 ? "tower" : height >= 34 ? "mid-rise" : height >= 20 ? "apartment" : "low-rise";
    const crownHeight = height >= 58 ? 3.8 + detailRandom() * 4.2 : 0;
    const totalHeight = height + crownHeight;
    const y = SIDEWALK_TOP + height * 0.5;
    buildingTransforms[style].push(transform([x, y, z], [width, height, depth]));
    if (crownHeight > 0) {
      buildingTransforms[style].push(transform(
        [x, SIDEWALK_TOP + height + crownHeight * 0.5, z],
        [width * 0.72, crownHeight, depth * 0.72],
      ));
    }
    addBlocker(id, "building", x, z, width, depth, totalHeight);
    const windowStyle = district.kind === "residential" ? 1 :
      district.kind === "waterfront" && detailRandom() < 0.48 ? 0 : Math.floor(random() * material.windows.length);
    const floorCount = Math.max(2, Math.floor((height - 4) / 4));
    let windowRows = 0;
    let groundFloorOccupied = false;
    const windowHeight = district.kind === "residential" ? 1.18 : form === "tower" ? 1.62 : 1.42;
    const glazingBase = district.kind === "residential" ? 0.42 : form === "tower" ? 0.62 : 0.52;
    const skippedFloorChance = form === "tower" ? 0.08 : district.kind === "residential" ? 0.17 : 0.12;
    for (let floor = 0; floor < floorCount; ++floor) {
      if (random() < skippedFloorChance) continue;
      // A skipped first procedural floor used to leave a four-metre blank
      // concrete band at eye level. Reuse the first existing room bank at the
      // ground-floor datum, then retain the authored gaps higher up.
      const windowY = groundFloorOccupied ? SIDEWALK_TOP + 3.0 + floor * 4 : SIDEWALK_TOP + 3.0;
      if (windowY > SIDEWALK_TOP + height - 1.8) break;
      const bucket = (windowStyle + (random() < 0.12 ? 1 : 0)) % material.windows.length;
      // One room bank per face is projected into a virtual box by the window
      // shader. It contains lit and dark offices instead of a neon stripe.
      const faceWidth = width * (glazingBase + facadeRandom() * 0.10);
      const faceDepth = depth * (glazingBase + facadeRandom() * 0.10);
      const xOffset = (facadeRandom() - 0.5) * width * 0.12;
      const zOffset = (facadeRandom() - 0.5) * depth * 0.12;
      windowTransforms[bucket].push(transform([x + xOffset, windowY, z + depth * 0.5 + 0.014], [faceWidth, windowHeight, 1]));
      windowTransforms[bucket].push(transform([x - xOffset, windowY, z - depth * 0.5 - 0.014], [faceWidth, windowHeight, 1], [0, Math.PI, 0]));
      windowTransforms[bucket].push(transform([x + width * 0.5 + 0.014, windowY, z + zOffset], [faceDepth, windowHeight, 1], [0, Math.PI * 0.5, 0]));
      windowTransforms[bucket].push(transform([x - width * 0.5 - 0.014, windowY, z - zOffset], [faceDepth, windowHeight, 1], [0, -Math.PI * 0.5, 0]));
      windowRows += 1;
      if (!groundFloorOccupied) {
        groundFloorOccupied = true;
        occupiedGroundFloorCount += 1;
        groundFloorInteriorBankCount += 4;
      }
    }

    // The old 4.1 m podium hid the occupied room-box projection at walking
    // and driving height. Keep its pooled concrete geometry as a shallow,
    // rain-stained plinth so the facade still has a grounded PBR transition
    // without adding a material, texture, instance, or render batch.
    if (height >= 26) {
      podiumTransforms.push(transform(
        [x, SIDEWALK_TOP + STREET_LEVEL_PLINTH_HEIGHT * 0.5, z],
        [width + 0.28, STREET_LEVEL_PLINTH_HEIGHT, depth + 0.28],
      ));
      streetLevelPlinthCount += 1;
    }
    const ribHeight = Math.max(5, height - 1.1);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        facadeRibTransforms.push(transform(
          [x + sx * (width * 0.5 - 0.14), SIDEWALK_TOP + ribHeight * 0.5, z + sz * (depth * 0.5 - 0.14)],
          [0.22, ribHeight, 0.22],
        ));
      }
    }
    if (height >= 26) {
      const mullionHeight = height - 5.0;
      const mullionY = SIDEWALK_TOP + 4.4 + mullionHeight * 0.5;
      for (const offset of [-0.23, 0.23]) {
        facadeRibTransforms.push(transform(
          [x + width * offset, mullionY, z + depth * 0.5 + 0.035],
          [0.11, mullionHeight, 0.12],
        ));
        facadeRibTransforms.push(transform(
          [x + width * offset, mullionY, z - depth * 0.5 - 0.035],
          [0.11, mullionHeight, 0.12],
        ));
        facadeRibTransforms.push(transform(
          [x + width * 0.5 + 0.035, mullionY, z + depth * offset],
          [0.12, mullionHeight, 0.11],
        ));
        facadeRibTransforms.push(transform(
          [x - width * 0.5 - 0.035, mullionY, z + depth * offset],
          [0.12, mullionHeight, 0.11],
        ));
        facadeMullionCount += 4;
      }
    }
    if (["residential", "mixed-use"].includes(district.kind) || form === "apartment") {
      const balconyCount = clamp(Math.floor(height / 12), 1, 4);
      for (let balcony = 0; balcony < balconyCount; ++balcony) {
        const balconyY = SIDEWALK_TOP + 5.5 + balcony * Math.max(4.5, (height - 8) / balconyCount);
        if (balconyY >= SIDEWALK_TOP + height - 2) break;
        balconyTransforms.push(transform([x, balconyY, z + depth * 0.5 + 0.48], [width * 0.72, 0.16, 1.05]));
        balconyTransforms.push(transform([x, balconyY, z - depth * 0.5 - 0.48], [width * 0.72, 0.16, 1.05]));
      }
    }
    const hasStorefront = district.kind === "commercial" || district.kind === "downtown" ||
      district.kind === "waterfront" || district.kind === "mixed-use";
    if (hasStorefront) {
      const shopBucket = district.kind === "downtown" ? 2 : detailRandom() < 0.5 ? 0 : 1;
      const frontage = width * 0.74;
      const doorWidth = Math.min(1.45, frontage * 0.16);
      const panelWidth = Math.max(1.4, (frontage - doorWidth - 0.75) * 0.5);
      const storefrontSide = z >= 0 ? -1 : 1;
      const storefrontZ = z + storefrontSide * (depth * 0.5 + 0.245);
      const storefrontYaw = storefrontSide > 0 ? 0 : Math.PI;
      // The dark projecting bay, separate glass panels and canopy create real
      // parallax at walking height rather than one luminous facade sticker.
      podiumTransforms.push(transform(
        [x, SIDEWALK_TOP + 1.55, z + storefrontSide * (depth * 0.5 + 0.08)],
        [frontage + 0.55, 3.1, 0.32],
      ));
      const panelOffset = doorWidth * 0.5 + panelWidth * 0.5 + 0.18;
      windowTransforms[shopBucket].push(transform(
        [x - panelOffset, SIDEWALK_TOP + 1.55, storefrontZ],
        [panelWidth, 1.92, 1],
        [0, storefrontYaw, 0],
      ));
      windowTransforms[shopBucket].push(transform(
        [x + panelOffset, SIDEWALK_TOP + 1.55, storefrontZ],
        [panelWidth, 1.92, 1],
        [0, storefrontYaw, 0],
      ));
      windowTransforms[(shopBucket + 1) % material.windows.length].push(transform(
        [x, SIDEWALK_TOP + 1.48, storefrontZ + storefrontSide * 0.004],
        [doorWidth, 2.06, 1],
        [0, storefrontYaw, 0],
      ));
      for (const frameX of [-frontage * 0.5, -doorWidth * 0.5 - 0.08, doorWidth * 0.5 + 0.08, frontage * 0.5]) {
        facadeRibTransforms.push(transform(
          [x + frameX, SIDEWALK_TOP + 1.55, storefrontZ + storefrontSide * 0.055],
          [0.12, 2.45, 0.12],
        ));
      }
      facadeRibTransforms.push(transform(
        [x, SIDEWALK_TOP + 2.82, storefrontZ + storefrontSide * 0.055],
        [frontage, 0.14, 0.12],
      ));
      balconyTransforms.push(transform(
        [x, SIDEWALK_TOP + 3.16, z + storefrontSide * (depth * 0.5 + 0.63)],
        [frontage + 0.75, 0.16, 1.3],
        [storefrontSide * -0.045, 0, 0],
      ));
      signTransforms[shopBucket].push(transform(
        [x + (facadeRandom() - 0.5) * frontage * 0.28, SIDEWALK_TOP + 3.68,
          z + storefrontSide * (depth * 0.5 + 0.07)],
        [Math.min(5.4, frontage * (0.38 + facadeRandom() * 0.18)), 0.62, 1],
        [0, storefrontYaw, 0],
      ));
      // A limited subset of occupied shops casts a warm entrance pool. This
      // makes commercial streets readable after dark without attaching a
      // dynamic light to all 31 façades or making the glass itself neon.
      if (storefrontCount % 3 === 0) {
        storefrontLightPositions.push(Object.freeze({
          position: freezePosition([
            x,
            SIDEWALK_TOP + 2.72,
            storefrontZ + storefrontSide * 1.18,
          ]),
          outward: storefrontSide,
          color: [0xffd0a0, 0xffe0b8, 0xd5e7ff][shopBucket],
          baseIntensity: 58 + shopBucket * 4,
        }));
      }
      storefrontCount += 1;
    }
    rooftopTransforms.push(transform(
      [x + (random() - 0.5) * width * 0.22, SIDEWALK_TOP + totalHeight + 0.75, z + (random() - 0.5) * depth * 0.22],
      [Math.max(2.4, width * 0.24), 1.5, Math.max(2.4, depth * 0.24)],
    ));
    if (height > 54) {
      antennaTransforms.push(transform([x, SIDEWALK_TOP + totalHeight + 3.4, z], [0.16, 5.2, 0.16]));
    } else if (district.kind === "residential" && detailRandom() < 0.62) {
      roofTankTransforms.push(transform(
        [x + (detailRandom() - 0.5) * width * 0.25, SIDEWALK_TOP + totalHeight + 1.35, z],
        [1.45, 2.3, 1.45],
      ));
    }
    if (random() < 0.34) {
      const signStyle = Math.floor(random() * material.signs.length);
      signTransforms[signStyle].push(transform(
        [x, SIDEWALK_TOP + Math.min(height - 3, Math.max(8, height * 0.58)), z + depth * 0.5 + 0.035],
        [Math.min(width * 0.68, 9), 1.45, 1],
      ));
    }
    buildingRecords.push(Object.freeze({
      id,
      position: freezePosition([x, SIDEWALK_TOP, z]),
      size: freezePosition([width, totalHeight, depth]),
      style,
      district: district.id,
      form,
      windowRows,
      groundFloorOccupied,
      streetLevelPlinthHeight: height >= 26 ? STREET_LEVEL_PLINTH_HEIGHT : 0,
      storefront: hasStorefront,
    }));
  }

  let buildingIndex = 0;
  for (const blockX of X_BLOCKS) {
    for (const blockZ of Z_BLOCKS) {
      if (sameBlock(blockX, blockZ, PARK_BLOCK) ||
          sameBlock(blockX, blockZ, PLAZA_BLOCK) ||
          sameBlock(blockX, blockZ, GARAGE_BLOCK)) continue;
      const district = districtAt(blockX, blockZ);
      const centrality = 1 - clamp(Math.hypot(blockX, blockZ) / 250, 0, 1);
      const style = district.facadeStyles[Math.floor(random() * district.facadeStyles.length)];
      const singleTowerChance = district.kind === "downtown" ? 0.72 : district.kind === "residential" ? 0.36 : 0.54;
      if (random() < singleTowerChance) {
        const width = 19 + random() * 8;
        const depth = 19 + random() * 8;
        const height = (20 + centrality * 55 + random() * (20 + centrality * 25)) * district.heightScale;
        addBuilding(
          blockX + (random() - 0.5) * 2.6,
          blockZ + (random() - 0.5) * 2.6,
          width,
          depth,
          height,
          style,
          `building-${String(++buildingIndex).padStart(3, "0")}`,
        );
      } else {
        const splitX = random() < 0.5;
        for (const side of [-1, 1]) {
          const width = splitX ? 12 + random() * 2.6 : 22 + random() * 3.5;
          const depth = splitX ? 22 + random() * 3.5 : 12 + random() * 2.6;
          const offset = side * 8.1;
          const x = blockX + (splitX ? offset : (random() - 0.5) * 1.4);
          const z = blockZ + (splitX ? (random() - 0.5) * 1.4 : offset);
          const height = (13 + centrality * 31 + random() * 20) * district.heightScale;
          addBuilding(
            x,
            z,
            width,
            depth,
            height,
            district.facadeStyles[(district.facadeStyles.indexOf(style) + (side > 0 ? 1 : 0)) % district.facadeStyles.length],
            `building-${String(++buildingIndex).padStart(3, "0")}`,
          );
        }
      }
    }
  }

  // A low terminal gives the waterfront scale without walling off the entire
  // promenade. Its main entrance faces the open pedestrian strip to the west.
  addBuilding(140, -141, 20, 28, 13, 2, `building-${String(++buildingIndex).padStart(3, "0")}`);

  // Short inset light strips trace the coastal promenade without forming one
  // giant emissive runway. They share the existing sign batches and remain
  // below collision height.
  let waterfrontAccentCount = 0;
  for (let z = CITY_BOUNDS.minZ + 8; z <= CITY_BOUNDS.maxZ - 8; z += 12) {
    const style = waterfrontAccentCount % 4 === 3 ? 2 : 0;
    signTransforms[style].push(transform(
      [153.35, SIDEWALK_TOP + 0.032, z],
      [0.28, 5.2, 1],
      [-Math.PI * 0.5, 0, 0],
    ));
    waterfrontAccentCount += 1;
  }

  // North Market's street arcade occupies the broad sidewalk immediately
  // north of Street 07.  Its old population focus (-120, 144) sat directly on
  // Avenue 02; these public and vendor anchors deliberately straddle the
  // counters while remaining on clear pedestrian ground. Every visual reuses
  // an existing city material/instance pool, preserving the 64-batch budget.
  const northMarketStallCenters = Object.freeze([-156, -148, -140, -132].map(x =>
    freezePosition([x, SIDEWALK_TOP, 130.6])));
  const northMarketVisitorAnchors = Object.freeze(northMarketStallCenters.map(([x]) =>
    freezePosition([x, SIDEWALK_TOP, 127.7])));
  const northMarketBusinessAnchors = Object.freeze(northMarketStallCenters.map(([x]) =>
    freezePosition([x, SIDEWALK_TOP, 131.35])));
  const northMarketPracticalPositions = Object.freeze([
    freezePosition([-152, SIDEWALK_TOP + 2.62, 130.25]),
    freezePosition([-144, SIDEWALK_TOP + 2.62, 130.25]),
    freezePosition([-136, SIDEWALK_TOP + 2.62, 130.25]),
  ]);
  // Open Doors owns names, hours, menus and dialogue. The world supplies only
  // collision-checked thresholds and keeper staging points so those authored
  // businesses align with physical storefronts.
  const businesses = Object.freeze([
    Object.freeze({
      id: "common_ground_cafe",
      district: "pulse-core",
      position: freezePosition([-40, SIDEWALK_TOP, -16.5]),
      keeperPosition: freezePosition([-40, SIDEWALK_TOP, -14.8]),
    }),
    Object.freeze({
      id: "mina_market_kitchen",
      district: "north-market",
      position: northMarketVisitorAnchors[1],
      keeperPosition: northMarketBusinessAnchors[1],
    }),
    Object.freeze({
      id: "harbour_lantern",
      district: "harbour-mile",
      position: freezePosition([148, SIDEWALK_TOP, 148]),
      keeperPosition: freezePosition([144.95, SIDEWALK_TOP, 148]),
      keeperYaw: Math.PI * 0.5,
    }),
    Object.freeze({
      id: "southline_diner",
      district: "westside",
      position: freezePosition([-128, SIDEWALK_TOP, -111]),
      keeperPosition: freezePosition([-132, SIDEWALK_TOP, -109.3]),
    }),
  ]);
  const businessById = new Map(businesses.map(business => [business.id, business]));
  const businessFrontages = Object.freeze([
    Object.freeze({
      id: "common_ground_cafe",
      district: "pulse-core",
      kind: "cafe-frontage",
      center: freezePosition([-40, SIDEWALK_TOP, -13.75]),
      interactionPosition: businessById.get("common_ground_cafe").position,
      yaw: Math.PI,
      width: 6.8,
      interiorStyle: 0,
      signStyle: 0,
      practicalPosition: freezePosition([-40, SIDEWALK_TOP + 2.76, -14.8]),
      practicalColor: 0xffc98c,
      practicalIntensity: 82,
      practicalRange: 16,
    }),
    Object.freeze({
      id: "harbour_lantern",
      district: "harbour-mile",
      kind: "waterfront-kiosk",
      center: freezePosition([145.75, SIDEWALK_TOP, 148]),
      interactionPosition: businessById.get("harbour_lantern").position,
      yaw: Math.PI * 0.5,
      width: 5.4,
      interiorStyle: 2,
      signStyle: 2,
      practicalPosition: freezePosition([146.8, SIDEWALK_TOP + 2.76, 148]),
      practicalColor: 0xffb96f,
      practicalIntensity: 96,
      practicalRange: 18,
    }),
    Object.freeze({
      id: "southline_diner",
      district: "westside",
      kind: "diner-frontage",
      center: freezePosition([-132, SIDEWALK_TOP, -108.05]),
      interactionPosition: businessById.get("southline_diner").position,
      yaw: Math.PI,
      width: 6.2,
      interiorStyle: 1,
      signStyle: 2,
      practicalPosition: freezePosition([-132, SIDEWALK_TOP + 2.76, -109.1]),
      practicalColor: 0xffc17c,
      practicalIntensity: 90,
      practicalRange: 17,
    }),
  ]);
  const businessOpenStates = new Map(businessFrontages.map(frontage => [frontage.id, false]));

  function businessFrontagePoint(frontage, localX, localY, localZ) {
    const cosine = Math.cos(frontage.yaw);
    const sine = Math.sin(frontage.yaw);
    return [
      frontage.center[0] + localX * cosine + localZ * sine,
      SIDEWALK_TOP + localY,
      frontage.center[2] - localX * sine + localZ * cosine,
    ];
  }

  // Complete the visual contract of Open Doors. Mina's kitchen already owns
  // the North Market arcade; these three deterministic frontages turn the
  // remaining interaction coordinates into readable places. Every transform
  // appends to an existing material/geometry pool, so opening a menu cannot
  // discover a shader topology or create a 65th instanced draw.
  let businessFrontagePropInstances = 0;
  for (const frontage of businessFrontages) {
    const rotation = [0, frontage.yaw, 0];
    balconyTransforms.push(transform(
      businessFrontagePoint(frontage, 0, 3.03, 0.62),
      [frontage.width + 0.5, 0.18, 1.8],
      rotation,
    ));
    podiumTransforms.push(transform(
      businessFrontagePoint(frontage, 0, 0.52, 0.10),
      [frontage.width * 0.84, 1.04, 0.72],
      rotation,
    ));
    for (const localX of [-frontage.width * 0.5, 0, frontage.width * 0.5]) {
      facadeRibTransforms.push(transform(
        businessFrontagePoint(frontage, localX, 1.52, -0.03),
        [0.14, 2.80, 0.14],
        rotation,
      ));
    }
    windowTransforms[frontage.interiorStyle].push(transform(
      businessFrontagePoint(frontage, 0, 1.60, -0.06),
      [frontage.width * 0.74, 2.15, 1],
      rotation,
    ));
    businessDisplayPanes.push(transform(
      businessFrontagePoint(frontage, 0, 1.60, 0.015),
      [frontage.width * 0.78, 2.22, 1],
      rotation,
    ));
    signTransforms[frontage.signStyle].push(transform(
      businessFrontagePoint(frontage, 0, 2.60, 0.08),
      [frontage.width * 0.58, 0.42, 1],
      rotation,
    ));
    businessUtilityTransforms.push(transform(
      businessFrontagePoint(frontage, frontage.width * 0.5 + 0.52, 0.68, 1.48),
      [0.62, 1.10, 0.24],
      rotation,
    ));
    const blockerCenter = businessFrontagePoint(frontage, 0, 0, 0.10);
    const alongWorldX = Math.abs(Math.cos(frontage.yaw)) >= 0.5;
    addBlocker(
      `open-doors-${frontage.id}-counter`,
      "business-frontage",
      blockerCenter[0],
      blockerCenter[2],
      alongWorldX ? frontage.width * 0.84 : 0.72,
      alongWorldX ? 0.72 : frontage.width * 0.84,
      1.04,
    );
    businessFrontagePropInstances += 9;
  }
  const northMarketBusinesses = Object.freeze(businesses.filter(business => business.district === "north-market"));
  const northMarket = Object.freeze({
    id: "north-market-street-arcade",
    district: "north-market",
    kind: "street-arcade",
    focus: freezePosition([-144, SIDEWALK_TOP, 127.7]),
    bounds: Object.freeze({ minX: -159.2, maxX: -128.8, minZ: 127.2, maxZ: 132.4 }),
    stallCenters: northMarketStallCenters,
    visitorAnchors: northMarketVisitorAnchors,
    businessAnchors: northMarketBusinessAnchors,
    businessFriendlyAnchors: northMarketBusinessAnchors,
    businesses: northMarketBusinesses,
    practicalPositions: northMarketPracticalPositions,
    openHours: Object.freeze({ opens: 7, closes: 19.5 }),
  });
  let northMarketPropInstances = 0;
  for (const [stallIndex, [x, , z]] of northMarketStallCenters.entries()) {
    const paletteStyle = [5, 3, 2, 3][stallIndex];
    // Shallow weather roofs leave the pavement visually open while creating a
    // continuous human-scale arcade against the occupied brick frontage.
    balconyTransforms.push(transform(
      [x, SIDEWALK_TOP + 3.04, z + 0.08],
      [6.25, 0.18, 3.35],
      [0, 0, stallIndex % 2 ? 0.012 : -0.012],
    ));
    podiumTransforms.push(transform(
      [x, SIDEWALK_TOP + 0.54, z - 1.18],
      [5.6, 1.08, 0.68],
    ));
    buildingTransforms[paletteStyle].push(transform(
      [x, SIDEWALK_TOP + 1.115, z - 1.18],
      [5.82, 0.12, 0.86],
    ));
    for (const postX of [x - 2.72, x + 2.72]) {
      for (const postZ of [z - 1.20, z + 1.22]) {
        facadeRibTransforms.push(transform(
          [postX, SIDEWALK_TOP + 1.56, postZ],
          [0.15, 2.88, 0.15],
        ));
      }
    }
    for (const supportX of [x - 2.18, x + 2.18]) {
      facadeRibTransforms.push(transform(
        [supportX, SIDEWALK_TOP + 1.18, z + 1.12],
        [0.12, 1.82, 0.12],
      ));
    }
    for (const shelfY of [0.88, 1.48]) {
      rooftopTransforms.push(transform(
        [x, SIDEWALK_TOP + shelfY, z + 1.10],
        [4.82, 0.10, 0.42],
      ));
    }
    signTransforms[2].push(transform(
      [x, SIDEWALK_TOP + 2.53, z - 1.61],
      [4.35, 0.48, 1],
      [0, Math.PI, 0],
    ));
    northMarketDisplayPanes.push(transform(
      [x, SIDEWALK_TOP + 1.54, z - 1.545],
      [5.18, 0.78, 1],
      [0, Math.PI, 0],
    ));
    for (const [crateIndex, crateX] of [x - 1.72, x + 1.72].entries()) {
      buildingTransforms[(paletteStyle + crateIndex + 1) % material.buildings.length].push(transform(
        [crateX, SIDEWALK_TOP + 0.38, z + 0.82],
        [0.88, 0.72, 0.76],
        [0, (stallIndex + crateIndex) * 0.09, 0],
      ));
    }
    addBlocker(
      `north-market-stall-${stallIndex + 1}-counter`,
      "market-stall",
      x,
      z - 1.18,
      5.72,
      0.80,
      1.18,
    );
    northMarketPropInstances += 15;
  }

  // Pulse Street Exchange: a restrained, non-neon transit frontage built
  // entirely by appending to the city's existing PBR and room-box batches.
  // The glass sits behind deep concrete reveals, so the projected occupied
  // rooms read as a lobby beyond dark glazing instead of another bright sign.
  const pulseTransitLobbyGlassTransforms = [45.5, 48, 50.5].map(x => transform(
    [x, SIDEWALK_TOP + 1.48, -13.73],
    [2.18, 2.45, 1],
    [0, Math.PI, 0],
  ));
  const pulseTransitLobbyRevealTransforms = [
    transform([44.15, SIDEWALK_TOP + 1.52, -14.22], [0.42, 3.04, 1.05]),
    transform([51.85, SIDEWALK_TOP + 1.52, -14.22], [0.42, 3.04, 1.05]),
    transform([48, SIDEWALK_TOP + 3.04, -14.22], [8.12, 0.32, 1.05]),
  ];
  const pulseTransitCanopyTransforms = [
    transform([48, SIDEWALK_TOP + 3.26, -14.92], [9.10, 0.20, 1.72]),
  ];
  const pulseTransitFrameTransforms = [
    ...[44.35, 46.75, 49.25, 51.65].map(x => transform(
      [x, SIDEWALK_TOP + 1.48, -13.81], [0.10, 2.62, 0.10],
    )),
    ...[44.10, 51.90].map(x => transform(
      [x, SIDEWALK_TOP + 1.60, -15.35], [0.16, 3.20, 0.16],
    )),
    ...[41.30, 43.50].map(x => transform(
      [x, SIDEWALK_TOP + 0.95, -16.02], [0.12, 1.90, 0.12],
    )),
  ];
  const pulseTransitRoutePanelTransforms = [
    transform([42.40, SIDEWALK_TOP + 1.28, -16.02], [2.70, 1.75, 0.10]),
    transform([48, SIDEWALK_TOP + 2.65, -13.88], [4.60, 0.46, 0.10]),
  ];
  const pulseTransitRouteStripeTransforms = [
    ...[0.72, 1.08, 1.44, 1.80].map(y => transform(
      [42.40, SIDEWALK_TOP + y, -16.078], [1.80, 0.075, 0.035],
    )),
    transform([48, SIDEWALK_TOP + 2.65, -13.938], [3.60, 0.085, 0.035]),
  ];
  const pulseTransitBikeRackTransforms = [];
  for (const x of [53.2, 55.2]) {
    pulseTransitBikeRackTransforms.push(
      transform([x, SIDEWALK_TOP + 0.50, -16.80], [0.075, 1.00, 0.075]),
      transform([x, SIDEWALK_TOP + 0.50, -15.80], [0.075, 1.00, 0.075]),
      transform([x, SIDEWALK_TOP + 1.00, -16.30], [0.075, 1.00, 0.075], [Math.PI * 0.5, 0, 0]),
    );
  }
  const pulseTransitTicketMachineTransforms = [
    transform([53.20, SIDEWALK_TOP + 0.78, -14.55], [0.78, 1.56, 0.52]),
    transform([54.40, SIDEWALK_TOP + 0.78, -14.55], [0.78, 1.56, 0.52]),
  ];
  const pulseTransitMachineScreenTransforms = [53.2, 54.4].map(x => transform(
    [x, SIDEWALK_TOP + 1.12, -14.816], [0.48, 0.42, 1], [0, Math.PI, 0],
  ));
  windowTransforms[1].push(...pulseTransitLobbyGlassTransforms);
  podiumTransforms.push(...pulseTransitLobbyRevealTransforms);
  balconyTransforms.push(...pulseTransitCanopyTransforms);
  facadeRibTransforms.push(...pulseTransitFrameTransforms);
  buildingTransforms[2].push(...pulseTransitRoutePanelTransforms);
  buildingTransforms[5].push(...pulseTransitRouteStripeTransforms);
  antennaTransforms.push(...pulseTransitBikeRackTransforms);
  addBlocker("pulse-exchange-west-pier", "transit-frontage", 44.12, -14.78, 0.46, 1.74, 3.28);
  addBlocker("pulse-exchange-east-pier", "transit-frontage", 51.88, -14.78, 0.46, 1.74, 3.28);
  addBlocker("pulse-exchange-route-board", "transit-furniture", 42.40, -16.02, 2.90, 0.30, 2.20);
  addBlocker("pulse-exchange-ticket-bank", "transit-furniture", 53.80, -14.55, 2.10, 0.72, 1.60);
  addBlocker("pulse-exchange-bike-rack", "transit-furniture", 54.20, -16.30, 2.60, 1.30, 1.10);

  const pulseTransitPropInstances =
    pulseTransitCurbMarkingTransforms.length + pulseTransitLobbyGlassTransforms.length +
    pulseTransitLobbyRevealTransforms.length + pulseTransitCanopyTransforms.length +
    pulseTransitFrameTransforms.length + pulseTransitRoutePanelTransforms.length +
    pulseTransitRouteStripeTransforms.length + pulseTransitBikeRackTransforms.length +
    pulseTransitTicketMachineTransforms.length + pulseTransitMachineScreenTransforms.length;
  const pulseTransitAllocatedInstances = pulseTransitPropInstances + pulseTransitPracticalPositions.length * 2;

  // Southline Parts Depot: one compact salt-aged warehouse and a narrow
  // inspection yard. These ten authored transforms (including the two bay
  // lines pooled with crosswalk paint above) all append to existing batches.
  buildingTransforms[5].push(transform(
    [-187.35, SIDEWALK_TOP + 3.60, -144],
    [7.10, 7.20, 26.0],
  ));
  // A dedicated, preloaded material scan breaks up the warehouse's large
  // street-facing wall without adding another instancing batch or any runtime
  // texture work. The thin facade plane sits just outside the collision shell.
  addStaticMesh(
    "Southline authored corrugated east facade",
    planeGeometry,
    material.depotCladding,
    [-183.792, SIDEWALK_TOP + 3.60, -144],
    [25.70, 6.96, 1],
    [0, Math.PI * 0.5, 0],
    { castShadow: false, receiveShadow: true },
  );
  podiumTransforms.push(transform(
    [-181.70, SIDEWALK_TOP + 0.52, -136],
    [1.50, 1.04, 0.80],
  ));
  rooftopTransforms.push(transform(
    [-179.30, SIDEWALK_TOP + 0.16, -143],
    [1.80, 0.24, 1.40],
  ));
  buildingTransforms[3].push(transform(
    [-179.30, SIDEWALK_TOP + 0.78, -143],
    [1.30, 1.00, 1.05],
    [0, -0.07, 0],
  ));
  facadeRibTransforms.push(transform(
    [-175.85, SIDEWALK_TOP + 0.78, -134],
    [0.18, 1.55, 0.18],
  ));
  for (const z of [-159, -129]) {
    facadeRibTransforms.push(transform(
      [-179.30, SIDEWALK_TOP + 1.02, z],
      [7.70, 0.16, 0.18],
    ));
  }
  signTransforms[0].push(transform(
    [-183.76, SIDEWALK_TOP + 4.72, -144],
    [5.40, 0.62, 1],
    [0, Math.PI * 0.5, 0],
  ));
  // The garage clues are intentionally object-sized, not waist-to-roof slabs.
  // A three-segment failed hose rests on a low tray; the invoice is clipped to
  // a compact board; and the service log lies open on a short evidence stand.
  // Every part reuses an existing city batch, so the renderer sees no new draw
  // type and first inspection cannot compile a surprise pipeline.
  podiumTransforms.push(transform(
    [-151.5, SIDEWALK_TOP + 0.25, 80.18],
    [1.15, 0.50, 0.72],
  ));
  antennaTransforms.push(
    transform([-151.5, SIDEWALK_TOP + 0.54, 80.30], [0.075, 0.62, 0.075], [0, 0, Math.PI * 0.5]),
    transform([-151.81, SIDEWALK_TOP + 0.54, 80.05], [0.075, 0.50, 0.075], [Math.PI * 0.5, 0, 0]),
    transform([-151.19, SIDEWALK_TOP + 0.54, 80.05], [0.075, 0.50, 0.075], [Math.PI * 0.5, 0, 0]),
  );
  facadeRibTransforms.push(transform(
    [-144, SIDEWALK_TOP + 0.83, 80.22],
    [0.72, 0.56, 0.055],
  ));
  podiumTransforms.push(transform(
    [-136.5, SIDEWALK_TOP + 0.28, 80.32],
    [1.05, 0.56, 0.44],
  ));
  const chapterTwoEvidencePartInstances = 10;
  const chapterTwoPropInstances = 20;
  const chapterTwoAftermathPropInstances = chapterTwoAftermathPaperTransforms.length;
  addBlocker("southline-parts-depot-warehouse", "warehouse", -187.35, -144, 7.10, 26.0, 7.20);
  addBlocker("southline-manifest-desk", "inspection-fixture", -181.70, -136, 1.50, 0.80, 1.08);
  addBlocker("southline-suspect-pallet", "inspection-fixture", -179.30, -143, 1.80, 1.40, 1.52);
  addBlocker("southline-loading-seal", "inspection-fixture", -175.85, -134, 0.34, 0.34, 1.58);
  addBlocker("southline-yard-south-fence", "yard-fence", -179.30, -159, 7.80, 0.36, 1.20);
  addBlocker("southline-yard-north-fence", "yard-fence", -179.30, -129, 7.80, 0.36, 1.20);

  for (let style = 0; style < material.buildings.length; ++style) {
    addInstances(`Instanced city buildings style ${style + 1}`, boxGeometry, material.buildings[style], buildingTransforms[style], {
      castShadow: true,
      receiveShadow: true,
    });
  }
  for (let style = 0; style < material.windows.length; ++style) {
    addInstances(`Instanced projected occupied interiors style ${style + 1}`, planeGeometry, material.windows[style], windowTransforms[style], {
      receiveShadow: false,
    });
  }
  for (let style = 0; style < material.signs.length; ++style) {
    addInstances(`Instanced neon facade signs style ${style + 1}`, planeGeometry, material.signs[style], signTransforms[style], {
      receiveShadow: false,
    });
  }
  addInstances("Instanced rooftop mechanical housings", boxGeometry, material.roof, rooftopTransforms, { castShadow: true });
  addInstances("Instanced rooftop antennas", poleGeometry, material.pole, antennaTransforms, { castShadow: true });
  addInstances("Instanced ground-floor podiums", boxGeometry, material.concreteDark, podiumTransforms, { castShadow: true });
  addInstances("Instanced facade corner ribs", boxGeometry, material.facadeTrim, facadeRibTransforms, { castShadow: true });
  addInstances("Instanced apartment balconies", boxGeometry, material.balcony, balconyTransforms, { castShadow: true });
  addInstances("Instanced Westside rooftop water tanks", fountainGeometry, material.roof, roofTankTransforms, { castShadow: true });

  // Central plaza: a readable player spawn, grounded civic art and low
  // seating.  The old eight-metre emissive column dominated every camera
  // angle and made the district read like a debug level.
  const plazaSlab = addStaticMesh(
    "Central neon plaza",
    boxGeometry,
    material.promenade,
    [PLAZA_BLOCK[0], SIDEWALK_TOP + 0.035, PLAZA_BLOCK[1]],
    [34, 0.07, 34],
  );
  addStaticMesh("Plaza sculpture stone plinth", boxGeometry, material.concreteDark,
    [0, SIDEWALK_TOP + 0.29, 0], [3.8, 0.54, 2.5], [0, 0.20, 0], { castShadow: true });
  for (const [index, x, y, z, yaw] of [
    [1, -0.72, 1.82, 0.10, -0.46],
    [2, 0.05, 2.18, -0.05, 0.05],
    [3, 0.82, 1.62, 0.12, 0.52],
  ]) {
    addStaticMesh(`Plaza weathered steel sail ${index}`, boxGeometry, material.civicArt,
      [x, SIDEWALK_TOP + y, z], [0.22, 3.15 + (index === 2 ? 0.72 : 0), 1.34], [0.08, yaw, yaw * 0.24], { castShadow: true });
  }
  addStaticMesh("Plaza sculpture civic plaque", planeGeometry, material.signs[2],
    [0, SIDEWALK_TOP + 0.59, -1.28], [1.15, 0.22, 1], [-Math.PI * 0.10, 0, 0], { receiveShadow: false });
  addBlocker("plaza-sculpture", "street-furniture", 0, 0, 4.1, 2.9, 4.3);
  const benchTransforms = [];
  let benchCount = 0;
  function addBench(x, z, yaw) {
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const positionFromLocal = (localX, localZ, y) => [
      x + cosine * localX + sine * localZ,
      y,
      z - sine * localX + cosine * localZ,
    ];
    benchTransforms.push(transform(positionFromLocal(0, 0, SIDEWALK_TOP + 0.67), [3.35, 0.18, 0.72], [0, yaw, 0]));
    benchTransforms.push(transform(positionFromLocal(0, 0.34, SIDEWALK_TOP + 1.10), [3.35, 0.72, 0.14], [0, yaw, 0]));
    for (const localX of [-1.08, 1.08]) {
      benchTransforms.push(transform(positionFromLocal(localX, 0, SIDEWALK_TOP + 0.42), [0.20, 0.48, 0.54], [0, yaw, 0]));
    }
    benchCount += 1;
    const blockerWidth = Math.abs(cosine) * 3.35 + Math.abs(sine) * 0.72 + 0.12;
    const blockerDepth = Math.abs(sine) * 3.35 + Math.abs(cosine) * 0.72 + 0.12;
    addBlocker(`bench-${String(benchCount).padStart(2, "0")}`, "street-furniture", x, z, blockerWidth, blockerDepth, 1.22);
  }
  for (const [x, z, yaw] of [
    [-9, -9, 0], [9, 9, Math.PI], [-9, 9, Math.PI * 0.5], [9, -9, -Math.PI * 0.5],
    [-57, -55, 0], [-39, -41, Math.PI], [-55, -39, Math.PI * 0.5], [-41, -57, -Math.PI * 0.5],
    [148, -132, Math.PI * 0.5], [126.2, -96, -Math.PI * 0.5], [148, -36, Math.PI * 0.5],
    [148, 36, Math.PI * 0.5], [148, 84, Math.PI * 0.5], [148, 132, Math.PI * 0.5],
  ]) {
    addBench(x, z, yaw);
  }
  const planterPositions = [
    [-57.5, -57.5], [-38.5, -38.5], [-57.5, -38.5], [-38.5, -57.5],
    [150, -156], [150, -48], [150, 60], [150, 156],
  ];
  for (let index = 0; index < planterPositions.length; ++index) {
    const [x, z] = planterPositions[index];
    benchTransforms.push(transform([x, SIDEWALK_TOP + 0.32, z], [2.15, 0.58, 2.15]));
    addBlocker(`planter-${String(index + 1).padStart(2, "0")}`, "street-furniture", x, z, 2.15, 2.15, 0.62);
  }
  let cafeFurnitureCount = 0;
  for (const [cafeIndex, entryIndex] of [1, 4, 7, 10].entries()) {
    const entry = storefrontLightPositions[entryIndex];
    if (!entry) continue;
    const [x, , z] = entry.position;
    const tableZ = z + entry.outward * 0.72;
    const yaw = cafeIndex % 2 ? 0.08 : -0.06;
    benchTransforms.push(transform([x, SIDEWALK_TOP + 0.78, tableZ], [1.28, 0.12, 0.82], [0, yaw, 0]));
    benchTransforms.push(transform([x, SIDEWALK_TOP + 0.40, tableZ], [0.16, 0.72, 0.16], [0, yaw, 0]));
    for (const side of [-1, 1]) {
      const chairX = x + side * 1.02;
      benchTransforms.push(transform([chairX, SIDEWALK_TOP + 0.48, tableZ], [0.52, 0.12, 0.52], [0, yaw, 0]));
      benchTransforms.push(transform([
        chairX + side * 0.20,
        SIDEWALK_TOP + 0.83,
        tableZ,
      ], [0.10, 0.70, 0.58], [0, yaw, 0]));
    }
    cafeFurnitureCount += 6;
  }
  addInstances("Plaza and park benches", boxGeometry, material.roof, benchTransforms, { castShadow: true });

  // Park with collision-aware trees, crossed footpaths and a shallow fountain.
  addStaticMesh("Pulse Park lawn", boxGeometry, material.grass, [PARK_BLOCK[0], SIDEWALK_TOP + 0.045, PARK_BLOCK[1]], [34, 0.09, 34]);
  addStaticMesh("Pulse Park east-west path", boxGeometry, material.pavement, [PARK_BLOCK[0], SIDEWALK_TOP + 0.105, PARK_BLOCK[1]], [33, 0.08, 3.4]);
  addStaticMesh("Pulse Park north-south path", boxGeometry, material.pavement, [PARK_BLOCK[0], SIDEWALK_TOP + 0.106, PARK_BLOCK[1]], [3.4, 0.08, 33]);
  addStaticMesh("Pulse Park fountain basin", fountainGeometry, material.promenade, [-48, SIDEWALK_TOP + 0.42, -48], [3.4, 0.75, 3.4]);
  const fountainWater = addStaticMesh(
    "Pulse Park fountain water",
    fountainGeometry,
    material.water,
    [-48, SIDEWALK_TOP + 0.82, -48],
    [2.7, 0.12, 2.7],
    [0, 0, 0],
    { rtxIgnore: true, rtxStatic: false, receiveShadow: false },
  );
  addBlocker("pulse-park-fountain", "street-furniture", -48, -48, 6.8, 6.8, 0.9);

  const trunkTransforms = [];
  const canopyTransforms = [];
  const roundCanopyTransforms = [];
  const treePositions = [];
  for (const [x, z] of planterPositions) {
    roundCanopyTransforms.push(transform(
      [x, SIDEWALK_TOP + 1.14, z],
      [0.86, 0.70, 0.86],
      [0, facadeRandom() * Math.PI, 0],
    ));
  }
  for (let index = 0; index < 18; ++index) {
    const side = index % 4;
    const along = -13 + Math.floor(index / 4) * 6.4 + (random() - 0.5) * 1.2;
    let x;
    let z;
    if (side === 0) { x = -61; z = -48 + along; }
    else if (side === 1) { x = -35; z = -48 + along; }
    else if (side === 2) { x = -48 + along; z = -61; }
    else { x = -48 + along; z = -35; }
    treePositions.push([x, z]);
  }
  for (let z = -112; z <= 112; z += 28) {
    if (z >= -115 && z <= -77) continue;
    treePositions.push([144 + (random() - 0.5) * 1.0, z]);
  }
  for (let index = 0; index < treePositions.length; ++index) {
    const [x, z] = treePositions[index];
    const height = 2.7 + random() * 0.7;
    trunkTransforms.push(transform([x, SIDEWALK_TOP + height * 0.5, z], [0.52, height, 0.52]));
    const canopy = transform(
      [x, SIDEWALK_TOP + height + 1.75, z],
      x > 126 ? [1.9, 1.15, 1.9] : [1.45, 2.65, 1.45],
      [0, random() * Math.PI, 0],
    );
    if (x > 126 || index % 4 === 1) roundCanopyTransforms.push(canopy);
    else canopyTransforms.push(canopy);
    addBlocker(`tree-${String(index + 1).padStart(2, "0")}`, "tree", x, z, 0.9, 0.9, height + 2.2);
  }
  addInstances("Instanced coastal tree trunks", poleGeometry, material.trunk, trunkTransforms, { castShadow: true });
  addInstances("Instanced conifer tree crowns", treeTopGeometry, material.foliage, canopyTransforms, { castShadow: true });
  addInstances("Instanced broadleaf and waterfront palm crowns", roundCanopyGeometry, material.foliage, roundCanopyTransforms, { castShadow: true });

  // Four-storey parking garage with open decks, columns, emissive wayfinding
  // and a visibly sloped arrival ramp. Collision uses one conservative AABB.
  const garageDecks = [];
  for (let level = 0; level < 4; ++level) {
    garageDecks.push(transform([-144, SIDEWALK_TOP + 0.35 + level * 4.0, 96], [29, 0.55, 30]));
  }
  const garageColumns = [];
  for (const x of [-156.5, -144, -131.5]) {
    for (const z of [83, 96, 109]) {
      garageColumns.push(transform([x, SIDEWALK_TOP + 7.4, z], [0.65, 14.4, 0.65]));
    }
  }
  addInstances("Garage concrete parking decks", boxGeometry, material.concrete, garageDecks, { castShadow: true });
  addInstances("Garage structural columns", boxGeometry, material.concreteDark, garageColumns, { castShadow: true });
  // Keep the sloped ramp behind the street-facing evidence bay. Its previous
  // centre at z=80.2 extended to z=72.7, burying all three physical clues and
  // the garage cast inside a rendered box which was intentionally not a
  // blocker. Moving the same preloaded mesh deeper preserves draw/pipeline
  // counts while opening the authored pedestrian forecourt.
  addStaticMesh("Garage arrival ramp", boxGeometry, material.road, [-144, SIDEWALK_TOP + 1.25, 88.7], [13.5, 0.7, 15], [-0.12, 0, 0], { castShadow: true });
  addStaticMesh("Pulse Garage pedestrian forecourt", boxGeometry, material.pavementWarm,
    [-144, SIDEWALK_TOP + 0.04, 79.05], [29, 0.08, 2.15], [0, 0, 0], { castShadow: false });
  // The street-facing level is a real family workshop set, not a blank
  // parking-deck slab.  Dark recessed bays, a rain canopy, framed office
  // windows and a restrained sign give the briefing cutscene useful depth.
  for (const [index, x] of [[1, -153], [2, -135]]) {
    addStaticMesh(`Pulse Garage dark service bay ${index}`, boxGeometry, material.concreteDark,
      [x, SIDEWALK_TOP + 1.85, 80.48], [6.2, 3.25, 0.48], [0, 0, 0], { castShadow: true });
    addStaticMesh(`Pulse Garage open service bay illusion ${index}`, planeGeometry, material.windows[index % material.windows.length],
      [x, SIDEWALK_TOP + 1.78, 80.18], [5.35, 2.82, 1], [0, Math.PI, 0], { receiveShadow: false });
    for (const [frame, px, py, sx, sy] of [
      ["left", x - 2.78, SIDEWALK_TOP + 1.78, 0.18, 3.12],
      ["right", x + 2.78, SIDEWALK_TOP + 1.78, 0.18, 3.12],
      ["header", x, SIDEWALK_TOP + 3.38, 5.72, 0.18],
    ]) {
      addStaticMesh(`Pulse Garage bay ${index} ${frame} frame`, boxGeometry, material.facadeTrim,
        [px, py, 80.08], [sx, sy, 0.18], [0, 0, 0], { castShadow: true });
    }
  }
  addStaticMesh("Pulse Garage rain canopy", boxGeometry, material.roof,
    [-144, SIDEWALK_TOP + 4.05, 78.92], [28.4, 0.30, 3.1], [-0.035, 0, 0], { castShadow: true });
  for (const x of [-157.2, -148.8, -139.2, -130.8]) {
    addStaticMesh(`Pulse Garage frontage post ${x}`, boxGeometry, material.facadeTrim,
      [x, SIDEWALK_TOP + 2.08, 79.88], [0.22, 3.82, 0.22], [0, 0, 0], { castShadow: true });
  }
  addStaticMesh("Pulse Garage occupied office windows", planeGeometry, material.windows[0],
    [-144, 8.18, 80.54], [21.8, 1.62, 1], [0, Math.PI, 0], { receiveShadow: false });
  addStaticMesh("Pulse Garage restrained wayfinding", planeGeometry, material.signs[0],
    [-144, 5.65, 80.10], [7.6, 0.58, 1], [0, Math.PI, 0], { receiveShadow: false });
  addBlocker("pulse-garage", "garage", -144, 96, 29, 30, 15.2);

  // Promenade, seawall, piers and railings create a clear coastal edge. The
  // navigable bounds end just inside the rail, so no invisible water collider
  // is required.
  addStaticMesh("Continuous waterfront promenade", boxGeometry, material.promenade, [141, SIDEWALK_TOP * 0.5, 0], [30, SIDEWALK_TOP, groundDepth]);

  // Harbour Court turns a formerly empty length of promenade into a grounded
  // public leisure space. Its painted asphalt owns a predecoded authored map,
  // while court markings, rack balls, support and hoop remain fixed pooled
  // geometry. Gameplay uses the exact hub/hoop coordinates below.
  const harbourCourt = Object.freeze({
    center: freezePosition([140, SIDEWALK_TOP + 0.07, -96]),
    hub: freezePosition([131.2, SIDEWALK_TOP + 0.14, -96]),
    hoop: freezePosition([149.05, SIDEWALK_TOP + 2.98, -96]),
    bounds: Object.freeze({ minX: 127.7, maxX: 152.25, minZ: -113.2, maxZ: -78.8 }),
  });
  addStaticMesh("Harbour Court authored painted asphalt", boxGeometry, material.court,
    harbourCourt.center, [24.4, 0.14, 34.0], [0, 0, 0], { castShadow: false });
  addStaticMesh("Harbour Court warm painted key", boxGeometry, material.courtKey,
    [145.0, SIDEWALK_TOP + 0.148, -96], [8.1, 0.018, 8.8], [0, 0, 0], { castShadow: false });
  addStaticMesh("Harbour Court free-throw arc", courtArcGeometry, material.laneWhite,
    [140.6, SIDEWALK_TOP + 0.181, -96], [1, 1, 1], [-Math.PI * 0.5, 0, 0], { receiveShadow: false });
  addStaticMesh("Harbour Court steel hoop support", poleGeometry, material.pole,
    [151.35, SIDEWALK_TOP + 1.68, -96], [0.25, 3.35, 0.25], [0, 0, 0], { castShadow: true });
  addStaticMesh("Harbour Court backboard arm", boxGeometry, material.facadeTrim,
    [150.57, SIDEWALK_TOP + 3.06, -96], [1.55, 0.16, 0.18], [0, 0, 0], { castShadow: true });
  addStaticMesh("Harbour Court glass backboard", boxGeometry, material.shelterGlass,
    [150.28, SIDEWALK_TOP + 3.48, -96], [0.12, 1.13, 2.02], [0, 0, 0], { castShadow: false, receiveShadow: false });
  addStaticMesh("Harbour Court regulation rim", hoopGeometry, material.hydrant,
    harbourCourt.hoop, [1, 1, 1], [-Math.PI * 0.5, 0, 0], { castShadow: true });
  addStaticMesh("Harbour Court woven net", netGeometry, material.courtNet,
    [harbourCourt.hoop[0], harbourCourt.hoop[1] - 0.31, harbourCourt.hoop[2]], [1, 1, 1], [0, 0, 0], {
      castShadow: false,
      receiveShadow: false,
      rtxIgnore: true,
      rtxStatic: false,
    });
  const ballRackTransforms = [
    transform([130.0, SIDEWALK_TOP + 0.45, -99.3], [1.36, 0.12, 0.62]),
    transform([129.45, SIDEWALK_TOP + 0.78, -99.3], [0.12, 0.76, 0.58]),
    transform([130.55, SIDEWALK_TOP + 0.78, -99.3], [0.12, 0.76, 0.58]),
  ];
  for (const [index, item] of ballRackTransforms.entries()) {
    addStaticMesh(`Harbour Court community ball rack part ${index + 1}`, boxGeometry, material.facadeTrim,
      item.position, item.scale, item.rotation, { castShadow: true });
  }
  const rackBallTransforms = [-0.36, 0, 0.36].map(offset => transform(
    [130.0 + offset, SIDEWALK_TOP + 1.03, -99.3], [0.15, 0.15, 0.15], [0, offset * 2, 0],
  ));
  for (const [index, item] of rackBallTransforms.entries()) {
    addStaticMesh(`Harbour Court rack basketball ${index + 1}`, basketballGeometry, material.courtBall,
      item.position, item.scale, item.rotation, { castShadow: true });
  }
  addBlocker("harbour-court-hoop-support", "sports-furniture", 151.35, -96, 0.62, 0.62, 3.5);
  addBlocker("harbour-court-ball-rack", "sports-furniture", 130.0, -99.3, 1.6, 0.9, 1.2);

  const railPosts = [];
  for (let z = CITY_BOUNDS.minZ + 4; z <= CITY_BOUNDS.maxZ - 4; z += 8) {
    railPosts.push(transform([154.5, 0.95, z], [0.16, 1.85, 0.16]));
  }
  addInstances("Waterfront rail posts", poleGeometry, material.pole, railPosts, { castShadow: true });
  addStaticMesh("Waterfront upper rail", boxGeometry, material.pole, [154.5, 1.52, 0], [0.18, 0.18, groundDepth]);
  addStaticMesh("Waterfront lower rail", boxGeometry, material.pole, [154.5, 0.82, 0], [0.13, 0.13, groundDepth]);
  const pierTransforms = [];
  const bollardTransforms = [];
  for (const z of [-112, 0, 112]) {
    pierTransforms.push(transform([170, WATER_LEVEL + 0.44, z], [31, 0.42, 6.5]));
    for (const x of [158, 166, 174, 182]) {
      bollardTransforms.push(transform([x, WATER_LEVEL + 1.12, z - 2.2], [0.35, 1.4, 0.35]));
      bollardTransforms.push(transform([x, WATER_LEVEL + 1.12, z + 2.2], [0.35, 1.4, 0.35]));
    }
  }
  addInstances("Harbour service piers", boxGeometry, material.concreteDark, pierTransforms, { rtxIgnore: true, rtxStatic: false });
  addInstances("Harbour pier bollards", poleGeometry, material.pole, bollardTransforms, { rtxIgnore: true, rtxStatic: false });

  const containerTransforms = material.containers.map(() => []);
  for (let index = 0; index < 15; ++index) {
    const pier = index % 3;
    const row = Math.floor(index / 3);
    const x = 161.5 + row * 5.3;
    const z = [-112, 0, 112][pier] + (index % 2 === 0 ? -1.55 : 1.55);
    const stack = index % 5 === 0 ? 2 : 1;
    for (let level = 0; level < stack; ++level) {
      containerTransforms[index % material.containers.length].push(transform(
        [x, WATER_LEVEL + 1.25 + level * 1.85, z],
        [4.65, 1.7, 2.45],
        [0, pier === 1 ? 0.02 : -0.02, 0],
      ));
    }
  }
  for (let style = 0; style < containerTransforms.length; ++style) {
    addInstances(`Harbour cargo containers style ${style + 1}`, boxGeometry, material.containers[style], containerTransforms[style], {
      castShadow: true,
      rtxIgnore: true,
      rtxStatic: false,
    });
  }

  const craneTransforms = [];
  for (const z of [-112, 0, 112]) {
    craneTransforms.push(transform([184, 7.8, z], [0.65, 15.5, 0.65]));
    craneTransforms.push(transform([178.8, 15.0, z], [11.0, 0.48, 0.48]));
    craneTransforms.push(transform([174.1, 11.6, z], [0.18, 6.8, 0.18]));
  }
  addInstances("Harbour loading-crane silhouettes", boxGeometry, material.facadeTrim, craneTransforms, {
    castShadow: true,
    rtxIgnore: true,
    rtxStatic: false,
  });

  const boatHulls = [];
  const boatCabins = [];
  for (const [x, z, yaw, scale] of [
    [212, -68, 0.12, 1.0],
    [226, 42, -0.08, 0.82],
    [198, 137, 0.18, 0.72],
  ]) {
    boatHulls.push(transform([x, WATER_LEVEL + 0.18, z], [12 * scale, 1.15 * scale, 3.8 * scale], [0, yaw, -0.035]));
    boatCabins.push(transform([x - 1.1 * scale, WATER_LEVEL + 1.26 * scale, z], [4.1 * scale, 1.25 * scale, 2.7 * scale], [0, yaw, 0]));
  }
  const boatHullMesh = addInstances("Moored harbour vessel hulls", boxGeometry, material.concreteDark, boatHulls, {
    rtxIgnore: true,
    rtxStatic: false,
  });
  const boatCabinMesh = addInstances("Moored harbour vessel cabins", boxGeometry, material.promenade, boatCabins, {
    rtxIgnore: true,
    rtxStatic: false,
  });

  // Low-cost perimeter silhouettes continue the skyline beyond the gameplay
  // rectangle. They are scenery only and intentionally absent from collision
  // and native ray registration.
  const distantBuildings = [[], []];
  const distantLightTransforms = [];
  for (let index = 0; index < 42; ++index) {
    const along = CITY_BOUNDS.minX + index * (groundWidth / 41);
    const height = 18 + detailRandom() * 62;
    const centerZ = CITY_BOUNDS.maxZ + 22 + detailRandom() * 9;
    const width = 7 + detailRandom() * 10;
    const depth = 8 + detailRandom() * 8;
    distantBuildings[index % 2].push(transform(
      [along, -0.2 + height * 0.5, centerZ],
      [width, height, depth],
    ));
    const lightRows = height > 46 ? 2 : 1;
    for (let row = 0; row < lightRows; ++row) {
      distantLightTransforms.push(transform(
        [along + (facadeRandom() - 0.5) * width * 0.30,
          4.5 + ((row + 1) / (lightRows + 1)) * (height - 7), centerZ - depth * 0.5 - 0.018],
        [width * (0.20 + facadeRandom() * 0.12), 0.34, 1],
      ));
    }
  }
  for (let index = 0; index < 28; ++index) {
    const along = CITY_BOUNDS.minZ + index * (groundDepth / 27);
    const height = 15 + detailRandom() * 45;
    const centerX = CITY_BOUNDS.minX - 18 - detailRandom() * 8;
    const width = 8 + detailRandom() * 7;
    const depth = 7 + detailRandom() * 10;
    distantBuildings[index % 2].push(transform(
      [centerX, -0.2 + height * 0.5, along],
      [width, height, depth],
    ));
    const lightRows = height > 38 ? 2 : 1;
    for (let row = 0; row < lightRows; ++row) {
      distantLightTransforms.push(transform(
        [centerX + width * 0.5 + 0.018,
          4.0 + ((row + 1) / (lightRows + 1)) * (height - 6),
          along + (facadeRandom() - 0.5) * depth * 0.30],
        [depth * (0.20 + facadeRandom() * 0.12), 0.34, 1],
        [0, Math.PI * 0.5, 0],
      ));
    }
  }
  // Reallocate imperceptible far-skyline room strips to the nearby Pulse
  // Exchange frontage. Truncating after generation preserves every random
  // stream and holds the complete city below its 5,600-instance budget; the
  // remaining distant banks still carry occupied room-box depth.
  const distantLightBudget = Math.max(0, 98 - pulseTransitAllocatedInstances);
  distantLightTransforms.length = Math.min(distantLightTransforms.length, distantLightBudget);
  for (let style = 0; style < distantBuildings.length; ++style) {
    addInstances(`Distant skyline silhouettes style ${style + 1}`, boxGeometry, material.buildings[style], distantBuildings[style], {
      rtxIgnore: true,
      rtxStatic: false,
      castShadow: false,
    });
  }
  addInstances("Distant skyline occupied window rooms", planeGeometry, material.windows[1], distantLightTransforms, {
    rtxIgnore: true,
    rtxStatic: false,
    receiveShadow: false,
  });

  const hazeTransforms = [
    transform([-120, 11, 186], [105, 19, 1], [0, 0, 0]),
    transform([0, 16, 188], [120, 28, 1], [0, 0, 0]),
    transform([111, 10, 183], [80, 17, 1], [0, 0, 0]),
    transform([-186, 13, -94], [96, 22, 1], [0, Math.PI * 0.5, 0]),
    transform([-188, 17, 42], [116, 29, 1], [0, Math.PI * 0.5, 0]),
    transform([153, 6, -76], [92, 11, 1], [0, Math.PI * 0.5, 0]),
  ];
  const hazeMesh = addInstances("Layered coastal ground haze", planeGeometry, material.haze, hazeTransforms, {
    rtxIgnore: true,
    rtxStatic: false,
    receiveShadow: false,
  });

  // Streetlight meshes stay instanced, while every authored practical now
  // owns a modest local light. The native renderer has ample headroom and a
  // consistently readable road network matters more than isolated neon pools.
  const poleTransforms = [];
  const lampTransforms = [];
  const lampPositions = [];
  for (let xi = 0; xi < X_ROADS.length; ++xi) {
    for (let zi = 0; zi < Z_ROADS.length; ++zi) {
      if ((xi + zi) % 2 !== 0) continue;
      const x = X_ROADS[xi] + 7.55;
      const z = Z_ROADS[zi] + 7.55;
      if (x > 151 || z > CITY_BOUNDS.maxZ - 5) continue;
      poleTransforms.push(transform([x, SIDEWALK_TOP + 2.45, z], [0.24, 4.9, 0.24]));
      lampTransforms.push(transform([x, SIDEWALK_TOP + 4.86, z], [0.52, 0.20, 0.34]));
      lampPositions.push([x, SIDEWALK_TOP + 4.65, z]);
    }
  }
  const plazaPracticalStart = lampPositions.length;
  const plazaPracticalPositions = [
    [-14, -14], [14, -14], [-14, 14], [14, 14],
  ];
  for (const [index, [x, z]] of plazaPracticalPositions.entries()) {
    poleTransforms.push(transform([x, SIDEWALK_TOP + 1.58, z], [0.18, 3.15, 0.18]));
    lampTransforms.push(transform([x, SIDEWALK_TOP + 3.14, z], [0.46, 0.18, 0.46]));
    lampPositions.push([x, SIDEWALK_TOP + 2.98, z]);
    addBlocker(`pulse-plaza-light-${index + 1}`, "street-furniture", x, z, 0.34, 0.34, 3.2);
  }
  const plazaPracticalEnd = lampPositions.length;
  const courtPracticalStart = lampPositions.length;
  for (const [index, [x, z]] of [
    [129.1, -111.0], [129.1, -81.0],
  ].entries()) {
    poleTransforms.push(transform([x, SIDEWALK_TOP + 3.35, z], [0.26, 6.7, 0.26]));
    lampTransforms.push(transform([x + 0.62, SIDEWALK_TOP + 6.62, z], [1.42, 0.24, 0.54]));
    lampPositions.push([x + 0.62, SIDEWALK_TOP + 6.48, z]);
    addBlocker(`harbour-court-floodlight-${index + 1}`, "sports-furniture", x, z, 0.52, 0.52, 6.8);
  }
  const courtPracticalEnd = lampPositions.length;
  const northMarketPracticalStart = lampPositions.length;
  for (const [x, y, z] of northMarketPracticalPositions) {
    // Short hanging cords and compact amber luminaires read as pendants under
    // the awnings without adding a dedicated draw-call or material.
    poleTransforms.push(transform([x, y + 0.34, z], [0.055, 0.70, 0.055]));
    lampTransforms.push(transform([x, y, z], [0.48, 0.18, 0.48]));
    lampPositions.push([x, y - 0.08, z]);
  }
  const northMarketPracticalEnd = lampPositions.length;
  const chapterTwoPracticalStart = lampPositions.length;
  for (const [x, y, z] of chapterTwoPracticalPositions) {
    // Wall-mounted fittings: one warm loading lamp and one cool inspection
    // lamp, both sharing the city luminaire and pavement-pool batches.
    lampTransforms.push(transform([x, y, z], [0.20, 0.46, 0.78]));
    lampPositions.push([x + 0.10, y, z]);
  }
  const chapterTwoPracticalEnd = lampPositions.length;
  const pulseTransitPracticalStart = lampPositions.length;
  for (const [x, y, z] of pulseTransitPracticalPositions) {
    // Compact downlights live beneath the building canopy. They reuse the
    // existing luminaire and pavement-pool batches; only the two bounded warm
    // PointLights below affect nearby geometry.
    lampTransforms.push(transform([x, y, z], [0.46, 0.16, 0.34]));
    lampPositions.push([x, y - 0.10, z]);
  }
  const pulseTransitPracticalEnd = lampPositions.length;
  for (const frontage of businessFrontages) {
    const [x, y, z] = frontage.practicalPosition;
    // The dark metal fixture lives in the existing pole batch. Illumination is
    // supplied by a bounded real light below, avoiding an always-glowing fake
    // pavement pool when a business is closed.
    poleTransforms.push(transform([x, y, z], [0.28, 0.18, 0.28]));
  }
  const businessPracticalCount = businessFrontages.length;
  let waterfrontBollardCount = 0;
  for (let z = CITY_BOUNDS.minZ + 12; z <= CITY_BOUNDS.maxZ - 12; z += 24) {
    poleTransforms.push(transform([151.2, SIDEWALK_TOP + 0.56, z], [0.20, 1.06, 0.20]));
    lampTransforms.push(transform([151.2, SIDEWALK_TOP + 1.10, z], [0.42, 0.18, 0.42]));
    lampPositions.push([151.2, SIDEWALK_TOP + 1.02, z]);
    waterfrontBollardCount += 1;
  }
  addInstances("Instanced streetlight poles", poleGeometry, material.pole, poleTransforms, { castShadow: true });
  addInstances("Instanced streetlight luminaires", boxGeometry, material.signs[2], lampTransforms, { receiveShadow: false });

  const lampPoolTransforms = lampPositions.map(([x, , z], index) => transform(
    [x, SIDEWALK_TOP + 0.012, z],
    index >= courtPracticalStart && index < courtPracticalEnd
      ? [4.8, 0.012, 4.8]
      : index >= northMarketPracticalStart && index < northMarketPracticalEnd
        ? [3.4, 0.012, 2.65]
        : index >= chapterTwoPracticalStart && index < chapterTwoPracticalEnd
          ? [2.85, 0.012, 3.45]
        : index >= pulseTransitPracticalStart && index < pulseTransitPracticalEnd
          ? [2.55, 0.012, 2.10]
      : [2.6 + (index % 3) * 0.35, 0.012, 2.6 + (index % 3) * 0.35],
  ));
  addInstances("Warm practical streetlight pavement pools", fountainGeometry, material.streetPool, lampPoolTransforms, {
    receiveShadow: false,
    rtxIgnore: true,
    rtxStatic: false,
  });
  const storefrontPoolTransforms = storefrontLightPositions.map(({ position }, index) => transform(
    [position[0], SIDEWALK_TOP + 0.013, position[2]],
    [2.15 + (index % 2) * 0.24, 0.012, 1.52 + (index % 3) * 0.16],
  ));
  addInstances("Occupied storefront entrance light pools", fountainGeometry, material.streetPool, storefrontPoolTransforms, {
    receiveShadow: false,
    rtxIgnore: true,
    rtxStatic: false,
  });

  const signalPoles = [];
  const signalArms = [];
  const signalHeads = [];
  const signalLamps = material.signalLamps.map(() => []);
  const hydrants = [];
  for (let xi = 0; xi < X_ROADS.length; ++xi) {
    for (let zi = 0; zi < Z_ROADS.length; ++zi) {
      const x = X_ROADS[xi];
      const z = Z_ROADS[zi];
      if ((xi + zi) % 3 === 0 && Math.abs(x) <= 120 && Math.abs(z) <= 120) {
        const poleX = x - 7.45;
        const poleZ = z + 7.45;
        signalPoles.push(transform([poleX, SIDEWALK_TOP + 2.2, poleZ], [0.22, 4.4, 0.22]));
        signalArms.push(transform([poleX + 2.15, SIDEWALK_TOP + 4.25, poleZ], [4.4, 0.18, 0.18]));
        signalHeads.push(transform([poleX + 4.1, SIDEWALK_TOP + 3.82, poleZ], [0.48, 1.28, 0.48]));
        const activeLamp = (xi + zi) % 2 === 0 ? 2 : 0;
        signalLamps[activeLamp].push(transform(
          [poleX + 4.1, SIDEWALK_TOP + (activeLamp === 0 ? 4.18 : 3.48), poleZ - 0.255],
          [0.22, 0.22, 0.08],
        ));
        signalLamps[1].push(transform([poleX + 4.1, SIDEWALK_TOP + 3.83, poleZ - 0.256], [0.15, 0.15, 0.07]));
      }
      if ((xi * 2 + zi) % 5 === 0) {
        hydrants.push(transform([x + 7.6, SIDEWALK_TOP + 0.43, z - 7.7], [0.44, 0.82, 0.44]));
      }
    }
  }
  addInstances("Traffic signal support poles", poleGeometry, material.pole, signalPoles, { castShadow: true });
  addInstances("Traffic signal mast arms", boxGeometry, material.pole, signalArms, { castShadow: true });
  addInstances("Traffic signal heads", boxGeometry, material.signalHousing, signalHeads, { castShadow: true });
  for (let style = 0; style < signalLamps.length; ++style) {
    addInstances(`Traffic signal lamps style ${style + 1}`, boxGeometry, material.signalLamps[style], signalLamps[style], { receiveShadow: false });
  }
  addInstances("Municipal fire hydrants", poleGeometry, material.hydrant, hydrants, { castShadow: true });

  const utilityBoxes = [];
  const dumpsters = [];
  let streetClutterCount = 0;
  for (let xi = 0; xi < X_BLOCKS.length; ++xi) {
    for (let zi = 0; zi < Z_BLOCKS.length; ++zi) {
      if ((xi + zi) % 3 === 0) {
        utilityBoxes.push(transform([X_BLOCKS[xi] + 15.4, SIDEWALK_TOP + 0.72, Z_BLOCKS[zi] - 14.8], [0.85, 1.35, 0.62]));
      }
      if ((xi * 3 + zi) % 7 === 0 && !sameBlock(X_BLOCKS[xi], Z_BLOCKS[zi], PLAZA_BLOCK)) {
        dumpsters.push(transform([X_BLOCKS[xi] - 14.4, SIDEWALK_TOP + 0.65, Z_BLOCKS[zi] + 13.9], [2.2, 1.25, 1.1], [0, detailRandom() * 0.12, 0]));
      }
    }
  }
  for (let index = 0; index < storefrontLightPositions.length; ++index) {
    const entry = storefrontLightPositions[index];
    const [x, , z] = entry.position;
    const side = index % 2 ? -1 : 1;
    utilityBoxes.push(transform([
      x + side * 2.15,
      SIDEWALK_TOP + 0.48,
      z + entry.outward * 0.18,
    ], [0.58, 0.92, 0.58], [0, side * 0.06, 0]));
    streetClutterCount += 1;
    if (index % 3 === 0) {
      utilityBoxes.push(transform([
        x + side * 1.42,
        SIDEWALK_TOP + 0.36,
        z + entry.outward * 0.24,
      ], [0.48, 0.66, 0.42], [0, side * -0.04, 0]));
      streetClutterCount += 1;
    }
  }
  // The exchange ticket machines are authored fixtures, not another random
  // streetlight cabinet. Keep the old clutter sampling boundary stable.
  const tallPracticalCount = pulseTransitPracticalStart;
  for (let index = 0; index < tallPracticalCount; index += 4) {
    const [x, , z] = lampPositions[index];
    utilityBoxes.push(transform([x - 0.82, SIDEWALK_TOP + 0.62, z + 0.54], [0.18, 1.18, 0.22]));
    streetClutterCount += 1;
  }
  utilityBoxes.push(...businessUtilityTransforms);
  utilityBoxes.push(...pulseTransitTicketMachineTransforms);
  addInstances("Sidewalk cabinets bins meters and parcel boxes", boxGeometry, material.utility, utilityBoxes, { castShadow: true });
  addInstances("Service-alley dumpsters", boxGeometry, material.utility, dumpsters, { castShadow: true });

  const shelterFrames = [];
  const shelterGlass = [];
  for (const x of [-144, -96, -48, 48, 96]) {
    const z = -16.65;
    shelterFrames.push(transform([x, SIDEWALK_TOP + 2.55, z], [6.2, 0.18, 1.65]));
    shelterFrames.push(transform([x - 2.85, SIDEWALK_TOP + 1.32, z], [0.16, 2.55, 0.16]));
    shelterFrames.push(transform([x + 2.85, SIDEWALK_TOP + 1.32, z], [0.16, 2.55, 0.16]));
    // Tuck the bench against the glazed back wall, leaving the public hub and
    // both passenger anchor rows physically clear beneath the canopy.
    shelterFrames.push(transform([x, SIDEWALK_TOP + 0.58, z + 1.02], [4.7, 0.26, 0.78]));
    shelterGlass.push(transform([x, SIDEWALK_TOP + 1.36, z + 0.74], [5.6, 2.25, 1]));
    addBlocker(`pulse-street-shelter-bench-${x}`, "transit-bench", x, z + 1.02, 4.7, 0.78, 0.74);
  }
  shelterGlass.push(...northMarketDisplayPanes);
  shelterGlass.push(...businessDisplayPanes);
  shelterGlass.push(...pulseTransitMachineScreenTransforms);
  addInstances("Pulse Street bus shelter frames", boxGeometry, material.pole, shelterFrames, { castShadow: true });
  addInstances("Pulse Street bus shelter glass", planeGeometry, material.shelterGlass, shelterGlass, {
    receiveShadow: false,
    rtxIgnore: true,
    rtxStatic: false,
  });

  const hemisphere = new THREE.HemisphereLight(0x385d82, 0x11131b, 1.35);
  hemisphere.name = "Neon City night ambience";
  hemisphere.userData.staticWorld = true;
  root.add(hemisphere);
  staticLights.push(hemisphere);
  const moon = new THREE.DirectionalLight(0x91b9ff, 2.15);
  moon.name = "Coastal moonlight";
  moon.position.set(-80, 135, 65);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(CELESTIAL_SHADOW_MAP_SIZE, CELESTIAL_SHADOW_MAP_SIZE);
  moon.shadow.camera.left = -CELESTIAL_SHADOW_RADIUS;
  moon.shadow.camera.right = CELESTIAL_SHADOW_RADIUS;
  moon.shadow.camera.top = CELESTIAL_SHADOW_RADIUS;
  moon.shadow.camera.bottom = -CELESTIAL_SHADOW_RADIUS;
  moon.shadow.camera.near = 20;
  moon.shadow.camera.far = 330;
  moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -0.00015;
  moon.shadow.normalBias = 0.035;
  moon.userData.shadowCoverageRadius = CELESTIAL_SHADOW_RADIUS;
  moon.userData.shadowWorldUnitsPerTexel = CELESTIAL_SHADOW_RADIUS * 2 / CELESTIAL_SHADOW_MAP_SIZE;
  root.add(moon, moon.target);
  staticLights.push(moon);
  const atmosphereDaySkyColor = new THREE.Color(0xb9d9ee);
  const atmosphereDayGroundColor = new THREE.Color(0x6b6659);
  const atmosphereSunsetColor = new THREE.Color(0xffa05f);
  const celestialShadowTexel = CELESTIAL_SHADOW_RADIUS * 2 / CELESTIAL_SHADOW_MAP_SIZE;
  let celestialFocusX = 0;
  let celestialFocusY = 0;
  let celestialFocusZ = 0;

  function updateCelestialShadowFocus(focusPosition) {
    const source = focusPosition?.position ?? focusPosition;
    const indexed = Array.isArray(source) || ArrayBuffer.isView(source);
    const requestedX = finite(indexed ? source[0] : source?.x);
    const requestedY = finite(indexed ? source[1] : source?.y);
    const requestedZ = finite(indexed ? source[2] : source?.z);
    // Snap the horizontal anchor to one shadow texel. The light and its target
    // move together, preserving sun/moon direction while preventing sub-texel
    // camera movement from making contact shadows shimmer.
    const nextX = Math.round(requestedX / celestialShadowTexel) * celestialShadowTexel || 0;
    const nextZ = Math.round(requestedZ / celestialShadowTexel) * celestialShadowTexel || 0;
    if (nextX === celestialFocusX && requestedY === celestialFocusY && nextZ === celestialFocusZ) return;
    celestialFocusX = nextX;
    celestialFocusY = requestedY;
    celestialFocusZ = nextZ;
    moon.target.position.set(celestialFocusX, celestialFocusY, celestialFocusZ);
  }
  const tallLampCount = lampPositions.length - waterfrontBollardCount;
  for (let index = 0; index < lampPositions.length; ++index) {
    const position = lampPositions[index];
    if (!position) continue;
    const isBollard = index >= tallLampCount;
    const isPlaza = index >= plazaPracticalStart && index < plazaPracticalEnd;
    const isCourt = index >= courtPracticalStart && index < courtPracticalEnd;
    const isNorthMarket = index >= northMarketPracticalStart && index < northMarketPracticalEnd;
    const isChapterTwo = index >= chapterTwoPracticalStart && index < chapterTwoPracticalEnd;
    const isPulseTransit = index >= pulseTransitPracticalStart && index < pulseTransitPracticalEnd;
    const chapterTwoLightIndex = index - chapterTwoPracticalStart;
    const color = isCourt ? 0xe5efff : isNorthMarket ? 0xffc17a : isPulseTransit ? 0xffc486 : isChapterTwo ?
      (chapterTwoLightIndex === 0 ? 0xffc18a : 0xc9e7ff) : isPlaza ? 0xffc98b : !isBollard && index % 7 === 3 ? 0xd5e7ff : 0xffd4a0;
    const baseIntensity = isCourt ? 620 : isNorthMarket ? 104 : isPulseTransit ? 62 : isChapterTwo ?
      (chapterTwoLightIndex === 0 ? 94 : 108) : isBollard ? 38 : isPlaza ? 72 : 82;
    const light = new THREE.PointLight(color, baseIntensity,
      isCourt ? 42 : isNorthMarket ? 18 : isPulseTransit ? 11.5 : isChapterTwo ? 22 : isBollard ? 17 : isPlaza ? 24 : 34, 2);
    light.name = `${isCourt ? "Harbour Court flood" : isNorthMarket ? "North Market pendant" : isPulseTransit ?
      "Pulse Street Exchange warm practical" : isChapterTwo ?
      (chapterTwoLightIndex === 0 ? "Southline depot warm loading" : "Southline depot cool inspection") :
      isBollard ? "Promenade bollard" : isPlaza ? "Pulse Plaza pedestrian" : "Street practical"} light ${index + 1}`;
    light.position.set(...position);
    light.castShadow = false;
    light.userData.staticWorld = true;
    light.userData.baseIntensity = baseIntensity;
    if (isPulseTransit) {
      light.userData.practicalKind = "pulse-transit";
      light.userData.bounded = true;
    }
    root.add(light);
    staticLights.push(light);
  }
  for (const frontage of businessFrontages) {
    const light = new THREE.PointLight(
      frontage.practicalColor,
      0,
      frontage.practicalRange,
      2,
    );
    light.name = `Open Doors ${frontage.id} practical`;
    light.position.fromArray(frontage.practicalPosition);
    light.castShadow = false;
    light.userData.staticWorld = true;
    light.userData.baseIntensity = frontage.practicalIntensity;
    light.userData.practicalKind = "open-doors-business";
    light.userData.businessId = frontage.id;
    light.userData.bounded = true;
    root.add(light);
    staticLights.push(light);
  }
  for (const [index, entry] of storefrontLightPositions.entries()) {
    const light = new THREE.PointLight(entry.color, entry.baseIntensity, 17, 2);
    light.name = `Occupied storefront entrance practical ${index + 1}`;
    light.position.fromArray(entry.position);
    light.userData.staticWorld = true;
    light.userData.baseIntensity = entry.baseIntensity;
    root.add(light);
    staticLights.push(light);
  }
  for (const [index, position] of [
    [-153, SIDEWALK_TOP + 3.75, 78.3],
    [-144, SIDEWALK_TOP + 3.75, 78.3],
    [-135, SIDEWALK_TOP + 3.75, 78.3],
  ].entries()) {
    const baseIntensity = 88;
    const light = new THREE.PointLight(0xffd0a0, baseIntensity, 19, 2);
    light.name = `Pulse Garage canopy practical ${index + 1}`;
    light.position.set(...position);
    light.userData.staticWorld = true;
    light.userData.baseIntensity = baseIntensity;
    root.add(light);
    staticLights.push(light);
  }

  const atmosphereState = {
    timeOfDay: 7.2,
    daylight: 0.42,
    nightFactor: 0.25,
    streetlightFactor: 0.18,
    windowLightFactor: 0.22,
    sunElevation: 0.3,
    sunAzimuth: 0,
    wetness: 0.88,
    coastalWind: 0.34,
    phase: "deep-night",
  };

  function atmosphereSnapshot() {
    return Object.freeze({ ...atmosphereState });
  }

  function setTimeOfDay(hourValue) {
    const hour = ((finite(hourValue, 7.2) % 24) + 24) % 24;
    const dayAngle = ((hour - 6) / 12) * Math.PI;
    const elevation = Math.sin(dayAngle) * 0.83;
    const daylight = smoothstep(-0.055, 0.22, elevation);
    const civilTwilight = smoothstep(-0.23, 0.045, elevation);
    const streetlight = 1 - smoothstep(-0.09, 0.115, elevation);
    atmosphereState.timeOfDay = hour;
    atmosphereState.daylight = daylight;
    atmosphereState.nightFactor = 1 - civilTwilight;
    atmosphereState.streetlightFactor = streetlight;
    atmosphereState.windowLightFactor = 0.035 + streetlight * 0.965;
    atmosphereState.sunElevation = elevation;
    const eastComponent = Math.cos(dayAngle) * 0.90;
    const northComponent = -Math.sqrt(Math.max(0, 1 - eastComponent * eastComponent));
    atmosphereState.sunAzimuth = Math.atan2(northComponent, eastComponent);
    atmosphereState.phase = elevation < -0.23 ? "deep-night" : elevation < -0.055 ? (hour < 12 ? "pre-dawn" : "blue-hour") :
      elevation < 0.16 ? (hour < 12 ? "sunrise" : "sunset") : hour < 10 ? "morning" : hour < 16.5 ? "day" : "golden-hour";
    return atmosphereSnapshot();
  }
  setTimeOfDay(atmosphereState.timeOfDay);

  function setWetness(value) {
    const wetness = clamp(finite(value), 0, 1);
    atmosphereState.wetness = wetness;
    material.road.roughness = THREE.MathUtils.lerp(0.64, 0.17, wetness);
    material.road.metalness = THREE.MathUtils.lerp(0.045, 0.16, wetness);
    material.pavement.roughness = THREE.MathUtils.lerp(0.84, 0.64, wetness);
    material.pavementWarm.roughness = THREE.MathUtils.lerp(0.88, 0.66, wetness);
    material.pavementIndustrial.roughness = THREE.MathUtils.lerp(0.80, 0.59, wetness);
    material.promenade.roughness = THREE.MathUtils.lerp(0.76, 0.62, wetness);
    material.curb.roughness = THREE.MathUtils.lerp(0.82, 0.36, wetness);
    material.court.roughness = THREE.MathUtils.lerp(0.76, 0.42, wetness);
    material.courtKey.roughness = THREE.MathUtils.lerp(0.79, 0.49, wetness);
    material.puddle.opacity = 0.035 + wetness * 0.56;
    material.roadReflector.opacity = 0.24 + wetness * 0.60;
    return atmosphereSnapshot();
  }
  setWetness(atmosphereState.wetness);

  function setBusinessOpenStates(entries = []) {
    let changed = 0;
    if (entries instanceof Map) {
      for (const [idValue, openValue] of entries) {
        const id = String(idValue ?? "");
        if (!businessOpenStates.has(id)) continue;
        const open = Boolean(openValue?.open ?? openValue);
        if (businessOpenStates.get(id) === open) continue;
        businessOpenStates.set(id, open);
        changed += 1;
      }
      return changed;
    }
    if (!Array.isArray(entries) && entries && typeof entries === "object") {
      entries = Object.entries(entries).map(([id, open]) => ({ id, open }));
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
      const id = String(entry?.id ?? entry?.businessId ?? "");
      if (!businessOpenStates.has(id)) continue;
      const open = Boolean(entry?.open);
      if (businessOpenStates.get(id) === open) continue;
      businessOpenStates.set(id, open);
      changed += 1;
    }
    return changed;
  }

  // A dense sidewalk graph gives ambient pedestrians believable short hops
  // around each block instead of asking a handful of distant spawn markers to
  // double as navigation.  Points sit near block edges, connect naturally
  // across intersections, and are rejected against the same collision data
  // used by the player and camera.
  const pedestrianNodeMap = new Map();
  function addPedestrianNode(xValue, zValue) {
    const x = Math.round(finite(xValue) * 100) / 100;
    const z = Math.round(finite(zValue) * 100) / 100;
    if (x < CITY_BOUNDS.minX + 0.5 || x > CITY_BOUNDS.maxX - 0.5 ||
        z < CITY_BOUNDS.minZ + 0.5 || z > CITY_BOUNDS.maxZ - 0.5) return;
    if (isBlockedCircle(x, z, 0.38)) return;
    const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
    if (!pedestrianNodeMap.has(key)) {
      pedestrianNodeMap.set(key, Object.freeze([x, SIDEWALK_TOP, z]));
    }
  }
  for (const blockX of X_BLOCKS) {
    for (const blockZ of Z_BLOCKS) {
      for (const along of [-14, -7, 0, 7, 14]) {
        addPedestrianNode(blockX - 17, blockZ + along);
        addPedestrianNode(blockX + 17, blockZ + along);
        addPedestrianNode(blockX + along, blockZ - 17);
        addPedestrianNode(blockX + along, blockZ + 17);
      }
    }
  }
  // Special pedestrian-only interiors are not part of the ordinary perimeter
  // grid: the park paths, civic plaza and long harbour promenade.
  for (const offset of [-15, -10, -5, 5, 10, 15]) {
    addPedestrianNode(PARK_BLOCK[0] + offset, PARK_BLOCK[1]);
    addPedestrianNode(PARK_BLOCK[0], PARK_BLOCK[1] + offset);
    addPedestrianNode(PLAZA_BLOCK[0] + offset, PLAZA_BLOCK[1] - 8.5);
    addPedestrianNode(PLAZA_BLOCK[0] + offset, PLAZA_BLOCK[1] + 8.5);
  }
  for (let z = CITY_BOUNDS.minZ + 12; z <= CITY_BOUNDS.maxZ - 12; z += 12) {
    addPedestrianNode(139, z);
    addPedestrianNode(148, z);
  }
  for (const [x, z] of [
    [131.2, -96], [137.2, -105.4], [137.2, -86.6], [140.6, -96], [143.0, -109.0], [143.0, -83.0],
  ]) addPedestrianNode(x, z);
  for (const [x, , z] of [
    northMarket.focus,
    ...northMarket.visitorAnchors,
    ...northMarket.businessAnchors,
  ]) addPedestrianNode(x, z);
  for (const [x, , z] of [
    chapterTwo.focus,
    ...Object.values(chapterTwo.interactAnchors),
    chapterTwo.keeperWitnessAnchor,
    ...Object.values(chapterTwo.garageClues),
    chapterTwo.leahAnchor,
    chapterTwo.aftermathAnchors.recallCustomer,
    ...Object.values(chapterTwo.conversationAnchors),
  ]) addPedestrianNode(x, z);
  for (const [x, , z] of [
    pulseTransit.entrance,
    pulseTransit.hub,
    ...pulseTransit.shelterAnchors,
    ...pulseTransit.waitingAnchors,
    ...pulseTransit.coveredWaitingAnchors,
  ]) addPedestrianNode(x, z);
  const pedestrianNodes = Object.freeze([...pedestrianNodeMap.values()]);

  const spawnPoints = Object.freeze({
    player: spawn("player-plaza", [-8, SIDEWALK_TOP + 0.08, 7], Math.PI * 0.75, { district: "central-plaza" }),
    vehicles: Object.freeze([
      spawn("vehicle-01", [-165.35, ROAD_TOP, -148], 0, { roadId: "avenue-01" }),
      spawn("vehicle-02", [-117.35, ROAD_TOP, 142], Math.PI, {
        roadId: "avenue-02", authorized: true, access: "kai-owned", displayName: "KAI'S SENTINEL",
      }),
      spawn("vehicle-03", [-70, ROAD_TOP, -117.35], Math.PI * 0.5, {
        roadId: "street-02", authorized: true, access: "licensed-taxi-shift", displayName: "NEON TAXI FLEET CAR",
      }),
      spawn("vehicle-04", [65, ROAD_TOP, 74.65], -Math.PI * 0.5, {
        roadId: "street-06", authorized: true, access: "pulse-parcels", displayName: "PULSE PARCELS VAN",
      }),
      spawn("vehicle-05", [122.65, ROAD_TOP, -82], Math.PI, {
        roadId: "avenue-07", authorized: true, access: "harbour-motor-club", displayName: "HARBOUR CLUB LOANER",
      }),
      pulseLineVehicle,
    ]),
    police: Object.freeze([
      spawn("police-01", [-72, ROAD_TOP, 122.65], Math.PI, { roadId: "avenue-03" }),
      spawn("police-02", [92, ROAD_TOP, 26.65], -Math.PI * 0.5, { roadId: "street-05" }),
      spawn("police-03", [-165.35, ROAD_TOP, 82], 0, { roadId: "avenue-01" }),
    ]),
    pedestrians: Object.freeze([
      spawn("pedestrian-01", [-9, SIDEWALK_TOP, -7], 0, { district: "central-plaza" }),
      spawn("pedestrian-02", [9, SIDEWALK_TOP, 7], Math.PI, { district: "central-plaza" }),
      spawn("pedestrian-03", [-56, SIDEWALK_TOP, -48], Math.PI * 0.5, { district: "pulse-park" }),
      spawn("pedestrian-04", [-48, SIDEWALK_TOP, -56], 0, { district: "pulse-park" }),
      spawn("pedestrian-05", [139, SIDEWALK_TOP, 28], Math.PI, { district: "waterfront" }),
      spawn("pedestrian-06", [126.4, SIDEWALK_TOP, -106.0], -Math.PI * 0.5, { district: "harbour-court" }),
      spawn("pedestrian-07", [-130, SIDEWALK_TOP, 80], Math.PI * 0.5, { district: "garage" }),
      spawn("pedestrian-08", [30, SIDEWALK_TOP, 30], -Math.PI * 0.5, { district: "downtown" }),
    ]),
  });

  const missionPoints = Object.freeze({
    firstRide: mission("first-ride", "Borrow the street coupe", [-18, ROAD_TOP, -21.35], 4.5, { kind: "vehicle" }),
    pulseGarage: mission("pulse-garage", "Meet the mechanic", [-154, SIDEWALK_TOP, 78.20], 5, { kind: "contact" }),
    harbourRun: mission("harbour-run", "Reach the waterfront", [150, SIDEWALK_TOP, 100], 5, { kind: "destination" }),
    harbourCourt: mission("harbour-court", "Play a five-shot round", harbourCourt.hub, 5, { kind: "activity" }),
    harbourCourtHoop: mission("harbour-court-hoop", "Harbour Court rim", harbourCourt.hoop, 1, { kind: "sports-target" }),
    parkExchange: mission("park-exchange", "Make the park exchange", [-57, SIDEWALK_TOP, -48], 4, { kind: "contact" }),
    downtownHeat: mission("downtown-heat", "Lose the downtown patrol", [24, ROAD_TOP, 24], 6, { kind: "wanted" }),
  });

  function isRoad(xValue, zValue) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    if (x < CITY_BOUNDS.minX || x > CITY_BOUNDS.maxX || z < CITY_BOUNDS.minZ || z > CITY_BOUNDS.maxZ) return false;
    return X_ROADS.some(center => Math.abs(x - center) <= ROAD_HALF_WIDTH) ||
      Z_ROADS.some(center => Math.abs(z - center) <= ROAD_HALF_WIDTH);
  }

  function terrainHeight(x, z) {
    if (z > CITY_BOUNDS.maxZ) return 0.12 + Math.sin(x * 0.035) * 0.18 + Math.sin(z * 0.021) * 0.12;
    if (isRoad(x, z)) return ROAD_TOP;
    const court = x >= harbourCourt.bounds.minX && x <= harbourCourt.bounds.maxX &&
      z >= harbourCourt.bounds.minZ && z <= harbourCourt.bounds.maxZ;
    return court ? SIDEWALK_TOP + 0.14 : SIDEWALK_TOP;
  }

  function sampleGround(x, z) {
    if (z > CITY_BOUNDS.maxZ) return {
      height: terrainHeight(x, z),
      normal: new THREE.Vector3(0, 1, 0),
      surfaceId: "desert-sand",
      districtId: z > 430 ? "sunken-ruins" : "desert-outskirts",
    };
    const road = isRoad(x, z);
    const waterfront = x >= 126 && x <= CITY_BOUNDS.maxX;
    const park = Math.abs(x - PARK_BLOCK[0]) <= 17 && Math.abs(z - PARK_BLOCK[1]) <= 17;
    const court = !road && x >= harbourCourt.bounds.minX && x <= harbourCourt.bounds.maxX &&
      z >= harbourCourt.bounds.minZ && z <= harbourCourt.bounds.maxZ;
    return {
      height: road ? ROAD_TOP : court ? SIDEWALK_TOP + 0.14 : SIDEWALK_TOP,
      normal: new THREE.Vector3(0, 1, 0),
      surfaceId: road ? "road" : court ? "court" : waterfront ? "waterfront" : park ? "park" : "sidewalk",
      districtId: districtAt(x, z).id,
    };
  }

  function circleIntersectsBlocker(x, z, radius, blocker) {
    if (blocker.active === false || blocker.shape !== "aabb") return false;
    const [cx, , cz] = blocker.center;
    const [hx, , hz] = blocker.halfExtents;
    const nearestX = clamp(x, cx - hx, cx + hx);
    const nearestZ = clamp(z, cz - hz, cz + hz);
    const dx = x - nearestX;
    const dz = z - nearestZ;
    return dx * dx + dz * dz < radius * radius - 1e-9;
  }

  function isBlockedCircle(xValue, zValue, radiusValue = 0.4) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    const radius = Math.max(0, finite(radiusValue, 0.4));
    if (x - radius < TRAVERSABLE_BOUNDS.minX || x + radius > TRAVERSABLE_BOUNDS.maxX ||
        z - radius < TRAVERSABLE_BOUNDS.minZ || z + radius > TRAVERSABLE_BOUNDS.maxZ) return true;
    return blockers.some(blocker => circleIntersectsBlocker(x, z, radius, blocker));
  }

  function resolveCircleMotion(positionValue, displacementValue, radiusValue = 0.4) {
    const start = vectorFrom(positionValue);
    const displacement = vectorFrom(displacementValue);
    const radius = Math.max(0.05, finite(radiusValue, 0.4));
    const output = start.clone();
    const horizontalDistance = Math.hypot(displacement.x, displacement.z);
    const stepLength = Math.max(0.30, Math.min(1.0, radius * 0.65));
    const steps = clamp(Math.ceil(horizontalDistance / stepLength), 1, 96);
    const dx = displacement.x / steps;
    const dz = displacement.z / steps;
    const dy = displacement.y / steps;
    for (let step = 0; step < steps; ++step) {
      const candidateX = clamp(output.x + dx, TRAVERSABLE_BOUNDS.minX + radius, TRAVERSABLE_BOUNDS.maxX - radius);
      if (!isBlockedCircle(candidateX, output.z, radius)) output.x = candidateX;
      const candidateZ = clamp(output.z + dz, TRAVERSABLE_BOUNDS.minZ + radius, TRAVERSABLE_BOUNDS.maxZ - radius);
      if (!isBlockedCircle(output.x, candidateZ, radius)) output.z = candidateZ;
      output.y += dy;
    }
    return output;
  }

  function cameraPointBlocked(point, radius) {
    if (point.x - radius < TRAVERSABLE_BOUNDS.minX || point.x + radius > TRAVERSABLE_BOUNDS.maxX ||
        point.z - radius < TRAVERSABLE_BOUNDS.minZ || point.z + radius > TRAVERSABLE_BOUNDS.maxZ) return true;
    if (point.y < terrainHeight(point.x, point.z) + radius) return true;
    for (const blocker of blockers) {
      if (blocker.active === false) continue;
      const [cx, cy, cz] = blocker.center;
      const [hx, hy, hz] = blocker.halfExtents;
      if (point.x >= cx - hx - radius && point.x <= cx + hx + radius &&
        point.y >= cy - hy - radius && point.y <= cy + hy + radius &&
        point.z >= cz - hz - radius && point.z <= cz + hz + radius) return true;
    }
    return false;
  }

  const cameraClipDelta = new THREE.Vector3();
  const cameraClipPoint = new THREE.Vector3();
  function clipCamera(targetOrRequest, desiredValue, radiusValue = 0.24, outputValue = null) {
    const requestMode = targetOrRequest && !targetOrRequest.isVector3 && targetOrRequest.target && targetOrRequest.desired;
    const target = vectorFrom(requestMode ? targetOrRequest.target : targetOrRequest);
    const desired = vectorFrom(requestMode ? targetOrRequest.desired : desiredValue);
    const radius = Math.max(0.05, finite(requestMode ? targetOrRequest.radius : radiusValue, 0.24));
    const output = requestMode ? targetOrRequest.output : outputValue;
    const delta = cameraClipDelta.copy(desired).sub(target);
    const distance = delta.length();
    const steps = clamp(Math.ceil(distance / Math.max(0.25, radius * 0.75)), 2, 128);
    let safeFraction = 1;
    for (let step = 1; step <= steps; ++step) {
      const fraction = step / steps;
      cameraClipPoint.copy(target).addScaledVector(delta, fraction);
      if (!cameraPointBlocked(cameraClipPoint, radius)) continue;
      safeFraction = Math.max(0, (step - 1) / steps);
      break;
    }
    const position = output?.isVector3 ? output : new THREE.Vector3();
    position.copy(target).addScaledVector(delta, safeFraction);
    if (!requestMode) return position;
    const result = targetOrRequest.result && typeof targetOrRequest.result === "object"
      ? targetOrRequest.result
      : { position };
    result.position = position;
    result.safeFraction = safeFraction;
    result.distance = distance * safeFraction;
    return result;
  }

  function update(elapsedValue = 0, focusPosition = null) {
    const elapsed = finite(elapsedValue);
    const night = atmosphereState.nightFactor;
    const practical = atmosphereState.streetlightFactor;
    const windows = atmosphereState.windowLightFactor;
    const daylight = atmosphereState.daylight;
    const pulse = (0.78 + Math.sin(elapsed * 1.7) * 0.16) * (0.16 + practical * 0.84);
    material.signs[0].opacity = clamp(pulse, 0.08, 1);
    material.signs[1].opacity = clamp((0.83 + Math.sin(elapsed * 2.15 + 1.1) * 0.12) * (0.16 + practical * 0.84), 0.06, 1);
    material.signs[2].opacity = clamp((0.88 + Math.sin(elapsed * 1.23 + 2.4) * 0.08) * (0.025 + practical * 0.975), 0.015, 1);
    for (const controller of interiorMaterials) controller.setNight(windows);
    material.streetPool.opacity = 0.003 + practical * 0.105;
    for (let index = 2; index < staticLights.length; ++index) {
      const baseIntensity = finite(staticLights[index].userData.baseIntensity, 30);
      const businessId = staticLights[index].userData.businessId;
      const openFactor = businessId ? (businessOpenStates.get(businessId) === true ? 1 : 0) : 1;
      staticLights[index].intensity = baseIntensity * (0.97 + Math.sin(elapsed * 0.31 + index * 1.9) * 0.03) * practical * openFactor;
    }
    hemisphere.intensity = 0.55 + daylight * 1.88 + night * 0.38;
    hemisphere.color.setHex(0x365875).lerp(atmosphereDaySkyColor, daylight);
    hemisphere.groundColor.setHex(0x11131b).lerp(atmosphereDayGroundColor, daylight * 0.72);
    const elevation = atmosphereState.sunElevation;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const celestialDay = elevation > -0.04;
    const directionSign = celestialDay ? 1 : -1;
    updateCelestialShadowFocus(focusPosition);
    moon.position.set(
      celestialFocusX + Math.cos(atmosphereState.sunAzimuth) * horizontal * 165 * directionSign,
      celestialFocusY + Math.max(22, Math.abs(elevation) * 175),
      celestialFocusZ + Math.sin(atmosphereState.sunAzimuth) * horizontal * 165 * directionSign,
    );
    moon.color.setHex(celestialDay ? 0xfff1d0 : 0x91b9ff);
    if (celestialDay && (atmosphereState.phase === "sunrise" || atmosphereState.phase === "sunset")) moon.color.lerp(atmosphereSunsetColor, 0.48);
    moon.intensity = celestialDay ? 0.72 + daylight * 4.68 : 0.76 + night * 0.88;
    material.haze.opacity = 0.015 + night * 0.026 + Math.sin(elapsed * 0.11) * 0.004;
    hazeMesh.position.x = Math.sin(elapsed * 0.045) * 3.5 * atmosphereState.coastalWind;
    hazeMesh.position.y = Math.sin(elapsed * 0.08 + 1.2) * 0.18;
    water.position.y = WATER_LEVEL - 0.12 + Math.sin(elapsed * 0.38) * 0.025;
    boatHullMesh.position.y = Math.sin(elapsed * 0.52) * 0.075;
    boatCabinMesh.position.y = boatHullMesh.position.y;
    fountainWater.rotation.y = elapsed * 0.06;
    plazaSlab.userData.pulse = pulse;
    return {
      elapsed,
      neonPulse: pulse,
      waterLevel: water.position.y + 0.12,
      atmosphere: atmosphereSnapshot(),
    };
  }

  const districtBuildingCounts = Object.fromEntries(DISTRICTS.map(district => [district.id, 0]));
  for (const building of buildingRecords) districtBuildingCounts[building.district] += 1;
  Object.freeze(districtBuildingCounts);
  const streetDetailInstances = curbTransforms.length + stopBars.length + roadReflectors.length +
    manholeTransforms.length + puddleTransforms.length + signalPoles.length + hydrants.length +
    utilityBoxes.length + dumpsters.length + shelterFrames.length + shelterGlass.length +
    laneArrowCount * 3 + benchTransforms.length + waterfrontAccentCount + waterfrontBollardCount * 2 +
    courtLineTransforms.length + ballRackTransforms.length + rackBallTransforms.length +
    northMarketPropInstances - northMarketDisplayPanes.length + northMarketPracticalPositions.length * 3 +
    businessFrontagePropInstances - businessDisplayPanes.length - businessUtilityTransforms.length +
    businessPracticalCount +
    chapterTwoPropInstances + chapterTwoAftermathPropInstances + chapterTwoPracticalPositions.length * 2 +
    pulseTransitPropInstances - pulseTransitTicketMachineTransforms.length -
    pulseTransitMachineScreenTransforms.length + pulseTransitPracticalPositions.length * 2;
  const stats = Object.freeze({
    seed: resolvedSeed,
    roads: roads.length,
    routes: roadLines.length,
    buildings: buildingRecords.length,
    blockers: blockers.length,
    instancedMeshes: instanceMeshes.length,
    instances: instanceMeshes.reduce((sum, mesh) => sum + mesh.count, 0),
    staticLights: staticLights.length,
    trees: treePositions.length,
    districts: DISTRICTS.length,
    districtBuildingCounts,
    streetDetailInstances,
    laneArrows: laneArrowCount,
    linearLaneDividers: 0,
    intersectionAsphaltCaps: intersectionCaps.length,
    junctionMarkingClearance,
    storefronts: storefrontCount,
    storefrontPracticalLights: storefrontLightPositions.length,
    facadeMullions: facadeMullionCount,
    windowBanks: windowTransforms.reduce((sum, transforms) => sum + transforms.length, 0),
    occupiedGroundFloors: occupiedGroundFloorCount,
    groundFloorInteriorBanks: groundFloorInteriorBankCount,
    streetLevelPlinths: streetLevelPlinthCount,
    streetLevelPlinthHeight: STREET_LEVEL_PLINTH_HEIGHT,
    benches: benchCount,
    planters: planterPositions.length,
    cafeFurniture: cafeFurnitureCount,
    streetClutter: streetClutterCount,
    pedestrianNodes: pedestrianNodes.length,
    plazaPracticalLights: plazaPracticalPositions.length,
    harbourCourt: true,
    harbourCourtPracticalLights: courtPracticalEnd - courtPracticalStart,
    harbourCourtShotSpots: 5,
    northMarketArcade: true,
    northMarketStalls: northMarket.stallCenters.length,
    northMarketVisitorAnchors: northMarket.visitorAnchors.length,
    northMarketBusinessAnchors: northMarket.businessAnchors.length,
    northMarketPracticalLights: northMarketPracticalEnd - northMarketPracticalStart,
    northMarketPropInstances,
    businessLocations: businesses.length,
    businessFrontages: businessFrontages.length,
    businessFrontagePropInstances,
    businessFrontageAllocatedInstances: businessFrontagePropInstances +
      businessPracticalCount,
    businessPracticalLights: businessPracticalCount,
    pulseTransitExchange: true,
    pulseTransitShelters: pulseTransit.shelterAnchors.length,
    pulseTransitWaitingAnchors: pulseTransit.waitingAnchors.length,
    pulseTransitCoveredWaitingAnchors: pulseTransit.coveredWaitingAnchors.length,
    pulseTransitWestboundStops: pulseTransit.westboundCurbStops.length,
    pulseTransitLobbyInteriorPanels: pulseTransitLobbyGlassTransforms.length,
    pulseTransitRouteBoardParts: pulseTransitRoutePanelTransforms.length + pulseTransitRouteStripeTransforms.length,
    pulseTransitTicketMachines: pulseTransitTicketMachineTransforms.length,
    pulseTransitBikeRackParts: pulseTransitBikeRackTransforms.length,
    pulseTransitBenches: pulseTransit.shelterAnchors.length,
    pulseTransitPracticalLights: pulseTransitPracticalEnd - pulseTransitPracticalStart,
    pulseTransitPropInstances,
    pulseTransitAllocatedInstances,
    pulseTransitVehicleId: pulseTransit.vehicleId,
    chapterTwoDepot: true,
    chapterTwoEvidenceAnchors: Object.keys(chapterTwo.interactAnchors).length,
    chapterTwoGarageClues: Object.keys(chapterTwo.garageClues).length,
    chapterTwoLeahAnchor: true,
    chapterTwoConversationAnchors: Object.keys(chapterTwo.conversationAnchors).length,
    chapterTwoEvidencePartInstances,
    chapterTwoAftermathAnchors: Object.keys(chapterTwo.aftermathAnchors).length,
    chapterTwoAftermathPropInstances,
    chapterTwoPracticalLights: chapterTwoPracticalEnd - chapterTwoPracticalStart,
    chapterTwoPropInstances,
    waterfrontAccents: waterfrontAccentCount,
    waterfrontBollards: waterfrontBollardCount,
    puddles: puddleTransforms.length,
    distantBuildings: distantBuildings[0].length + distantBuildings[1].length,
    distantLights: distantLightTransforms.length,
    virtualInteriorStyles: interiorTextureSets.length,
    litInteriorRooms: interiorTextureSets.reduce((sum, set) => sum + set.litRooms, 0),
    unlitInteriorRooms: interiorTextureSets.reduce((sum, set) => sum + set.unlitRooms, 0),
    authoredFacadeTexture: usesAuthoredFacadeTexture,
    authoredStoneTexture: usesAuthoredStoneTexture,
    authoredBrickTexture: usesAuthoredBrickTexture,
    authoredRoadTexture: usesAuthoredRoadTexture,
    authoredPavementTexture: usesAuthoredPavementTexture,
    authoredCourtTexture: usesAuthoredCourtTexture,
    authoredDepotTexture: usesAuthoredDepotTexture,
  });
  root.userData.stats = stats;

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (root.parent) root.parent.remove(root);
    root.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const meshMaterial of materials) meshMaterial.dispose();
    disposeSurfaceTextureSets(surfaceTextures);
  }

  return {
    root,
    seed: resolvedSeed,
    // HUD/minimap bounds intentionally remain the authored city map. The
    // desert is discovered through the breach instead of shrinking the city
    // raster to fit a mostly empty expansion.
    bounds: { ...CITY_BOUNDS },
    traversableBounds: { ...TRAVERSABLE_BOUNDS },
    blockers,
    roads,
    roadLines,
    routes: roadLines,
    buildings: buildingRecords,
    districts: DISTRICTS,
    districtAt,
    spawnPoints,
    pedestrianNodes,
    missionPoints,
    businesses,
    businessFrontages,
    chapterTwo,
    pulseTransit,
    harbourCourt,
    northMarket,
    staticRoots: [root],
    staticLights,
    stats,
    terrainHeight,
    sampleGround,
    isRoad,
    isBlockedCircle,
    resolveCircleMotion,
    clipCamera,
    setTimeOfDay,
    setWetness,
    setBusinessOpenStates,
    get atmosphere() { return atmosphereSnapshot(); },
    update,
    dispose,
  };
}

export const CITY_SEED = DEFAULT_SEED;
export const CITY_ROAD_CENTERS = Object.freeze({ x: X_ROADS, z: Z_ROADS });
export const CITY_WORLD_BOUNDS = CITY_BOUNDS;
