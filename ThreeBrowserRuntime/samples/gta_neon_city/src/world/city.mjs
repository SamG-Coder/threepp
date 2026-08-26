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

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
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
    shelterGlass: ownMaterial(standardMaterial(0x233842, 0.16, 0.16, {
      transparent: true,
      opacity: 0.28,
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
  const chapterTwoKeeperWitnessAnchor = freezePosition([-183.10, SIDEWALK_TOP, -138.2]);
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
  let residentialInteriorHost = null;
  let communityHubHost = null;
  let commonGroundCafeHost = null;
  let minaMarketHost = null;

  function addBuilding(x, z, width, depth, height, style, id, options = {}) {
    const district = districtAt(x, z);
    const hasPhysicalResidentialInterior = options.residentialInteriorHost === true;
    const hasPhysicalCommunityHub = options.communityHubHost === true;
    const hasPhysicalCommonGroundCafe = options.commonGroundCafeHost === true;
    const hasPhysicalMinaMarket = options.minaMarketHost === true;
    const hasPhysicalGroundFloor = hasPhysicalResidentialInterior || hasPhysicalCommunityHub ||
      hasPhysicalCommonGroundCafe || hasPhysicalMinaMarket;
    const form = height >= 66 ? "tower" : height >= 34 ? "mid-rise" : height >= 20 ? "apartment" : "low-rise";
    const crownHeight = height >= 58 ? 3.8 + detailRandom() * 4.2 : 0;
    const totalHeight = height + crownHeight;
    const y = SIDEWALK_TOP + height * 0.5;
    if (hasPhysicalGroundFloor) {
      // Leave a true 3.4 m ground-floor volume beneath the pooled upper
      // building shell. The show-flat below supplies its own exterior walls,
      // openings and fixtures through the same resident instancing batches.
      const clearHeight = 3.42;
      const upperHeight = Math.max(1.0, height - clearHeight);
      buildingTransforms[style].push(transform(
        [x, SIDEWALK_TOP + clearHeight + upperHeight * 0.5, z],
        [width, upperHeight, depth],
      ));
      const physicalHost = {
        id,
        x,
        z,
        width,
        depth,
        height,
        totalHeight,
        style,
        clearHeight,
        districtId: district.id,
      };
      if (hasPhysicalResidentialInterior) residentialInteriorHost = physicalHost;
      if (hasPhysicalCommunityHub) communityHubHost = physicalHost;
      if (hasPhysicalCommonGroundCafe) commonGroundCafeHost = physicalHost;
      if (hasPhysicalMinaMarket) minaMarketHost = physicalHost;
    } else {
      buildingTransforms[style].push(transform([x, y, z], [width, height, depth]));
    }
    if (crownHeight > 0) {
      buildingTransforms[style].push(transform(
        [x, SIDEWALK_TOP + height + crownHeight * 0.5, z],
        [width * 0.72, crownHeight, depth * 0.72],
      ));
    }
    if (!hasPhysicalGroundFloor) addBlocker(id, "building", x, z, width, depth, totalHeight);
    const windowStyle = district.kind === "residential" ? 1 :
      district.kind === "waterfront" && detailRandom() < 0.48 ? 0 : Math.floor(random() * material.windows.length);
    const floorCount = Math.max(2, Math.floor((height - 4) / 4));
    let windowRows = 0;
    let groundFloorOccupied = false;
    let physicalGroundFloorBucket = -1;
    let physicalGroundFloorTransformStart = -1;
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
      const firstOccupiedRow = !groundFloorOccupied;
      const bucketStart = windowTransforms[bucket].length;
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
      if (hasPhysicalGroundFloor && firstOccupiedRow) {
        physicalGroundFloorBucket = bucket;
        physicalGroundFloorTransformStart = bucketStart;
      }
    }
    if (hasPhysicalGroundFloor) {
      // Consume the identical seeded facade stream as the procedural version,
      // then replace only its first projected room bank with the real rooms.
      // This keeps every later building and street asset bit-for-bit stable.
      if (physicalGroundFloorBucket >= 0) {
        windowTransforms[physicalGroundFloorBucket].splice(physicalGroundFloorTransformStart, 4);
        groundFloorInteriorBankCount -= 4;
      } else {
        groundFloorOccupied = true;
        occupiedGroundFloorCount += 1;
      }
    }

    // The old 4.1 m podium hid the occupied room-box projection at walking
    // and driving height. Keep its pooled concrete geometry as a shallow,
    // rain-stained plinth so the facade still has a grounded PBR transition
    // without adding a material, texture, instance, or render batch.
    if (height >= 26 && !hasPhysicalGroundFloor) {
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
    if (hasStorefront && !hasPhysicalCommunityHub && !hasPhysicalCommonGroundCafe && !hasPhysicalMinaMarket) {
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
          buildingId: id,
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
    } else if (hasPhysicalCommunityHub || hasPhysicalCommonGroundCafe || hasPhysicalMinaMarket) {
      // Preserve the storefront/detail random streams and fixed practical
      // light budget that this occupied harbour frontage formerly consumed,
      // but omit its opaque procedural bay. The authored public rooms below
      // now provide the real glass, door aperture and depth at street level.
      const shopBucket = district.kind === "downtown" ? 2 : detailRandom() < 0.5 ? 0 : 1;
      const frontage = width * 0.74;
      const storefrontSide = z >= 0 ? -1 : 1;
      const storefrontZ = z + storefrontSide * (depth * 0.5 + 0.245);
      facadeRandom();
      facadeRandom();
      if (storefrontCount % 3 === 0) {
        storefrontLightPositions.push(Object.freeze({
          buildingId: id,
          position: freezePosition([x, SIDEWALK_TOP + 2.72, storefrontZ + storefrontSide * 1.18]),
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
      streetLevelPlinthHeight: height >= 26 && !hasPhysicalGroundFloor ? STREET_LEVEL_PLINTH_HEIGHT : 0,
      storefront: hasStorefront,
      physicalInterior: hasPhysicalResidentialInterior ? "southline_studio_3b" : hasPhysicalCommunityHub ?
        "harbour-skills-house" : hasPhysicalCommonGroundCafe ? "common_ground_cafe" : hasPhysicalMinaMarket ?
          "mina_market_kitchen" : null,
      propertyBuildingId: hasPhysicalResidentialInterior ? "southline_court" : hasPhysicalCommunityHub ?
        "harbour-skills-house-building" : hasPhysicalCommonGroundCafe ? "common-ground-cafe-building" : hasPhysicalMinaMarket ?
          "mina-market-building" : null,
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
      const residentialInteriorBlock = blockX === -144 && blockZ === 0;
      const communityHubBlock = blockX === 96 && blockZ === 48;
      const commonGroundCafeBlock = blockX === -48 && blockZ === 0;
      const minaMarketBlock = blockX === -144 && blockZ === 144;
      const singleTowerRoll = random();
      if (communityHubBlock || commonGroundCafeBlock || minaMarketBlock ||
          (!residentialInteriorBlock && singleTowerRoll < singleTowerChance)) {
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
          {
            communityHubHost: communityHubBlock,
            commonGroundCafeHost: commonGroundCafeBlock,
            minaMarketHost: minaMarketBlock,
          },
        );
      } else {
        const splitXRoll = random();
        const splitX = residentialInteriorBlock ? false : splitXRoll < 0.5;
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
            { residentialInteriorHost: residentialInteriorBlock && side < 0 },
          );
        }
      }
    }
  }

  // Harbour View 01 is the first truly enterable home in the life-sim layer.
  // It occupies the street level deliberately opened by addBuilding above,
  // while every floor, wall, cabinet and furnishing appends to an already
  // resident PBR instance batch. The result adds no draw type, runtime asset,
  // light or emissive material and is ready before the first playable frame.
  if (!residentialInteriorHost) throw new Error("Residential show-flat host building was not generated.");
  const residentialInteriorSeed = (resolvedSeed ^ 0x484f4d45) >>> 0;
  const residentialInteriorRandom = mulberry32(residentialInteriorSeed);
  const residentialInteriorParts = [];
  const residentialInteriorGlassTransforms = [];
  const residentialInteriorBlockerIds = [];
  const host = residentialInteriorHost;
  const homeFloorY = SIDEWALK_TOP;
  const homeMinX = host.x - host.width * 0.5;
  const homeMaxX = host.x + host.width * 0.5;
  const homeMinZ = host.z - host.depth * 0.5;
  const homeMaxZ = host.z + host.depth * 0.5;
  const entranceX = host.x + Math.min(7.0, host.width * 0.30);
  const doorwayWidth = 1.46;
  const wallHeight = 3.22;
  const wallCenterY = homeFloorY + wallHeight * 0.5;
  const coffeeTableYaw = (residentialInteriorRandom() - 0.5) * 0.14;
  const stoolSpread = 0.82 + residentialInteriorRandom() * 0.10;
  const upholsteryStyle = [0, 1, 2][Math.floor(residentialInteriorRandom() * 3)];
  const linenStyle = [1, 2, 5][Math.floor(residentialInteriorRandom() * 3)];
  const cabinetryStyle = [2, 3, 5][Math.floor(residentialInteriorRandom() * 3)];

  const residentialPools = {
    plaster: { transforms: buildingTransforms[5], batch: "Instanced city buildings style 6" },
    timber: { transforms: buildingTransforms[3], batch: "Instanced city buildings style 4" },
    upholstery: { transforms: buildingTransforms[upholsteryStyle], batch: `Instanced city buildings style ${upholsteryStyle + 1}` },
    linen: { transforms: buildingTransforms[linenStyle], batch: `Instanced city buildings style ${linenStyle + 1}` },
    cabinetry: { transforms: buildingTransforms[cabinetryStyle], batch: `Instanced city buildings style ${cabinetryStyle + 1}` },
    concrete: { transforms: podiumTransforms, batch: "Instanced ground-floor podiums" },
    trim: { transforms: facadeRibTransforms, batch: "Instanced facade corner ribs" },
    metal: { transforms: balconyTransforms, batch: "Instanced apartment balconies" },
    casework: { transforms: rooftopTransforms, batch: "Instanced rooftop mechanical housings" },
    pole: { transforms: antennaTransforms, batch: "Instanced rooftop antennas" },
  };
  function addResidentialPart(id, poolName, position, scale, rotation = [0, 0, 0]) {
    const pool = residentialPools[poolName];
    const item = transform(position, scale, rotation);
    pool.transforms.push(item);
    residentialInteriorParts.push({
      id,
      pool: poolName,
      batch: pool.batch,
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addResidentialGlass(id, position, scale, rotation = [0, 0, 0]) {
    const item = transform(position, scale, rotation);
    residentialInteriorGlassTransforms.push(item);
    residentialInteriorParts.push({
      id,
      pool: "glass",
      batch: "Pulse Street bus shelter glass",
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addResidentialBlocker(id, kind, x, z, width, depth, height = wallHeight) {
    addBlocker(id, kind, x, z, width, depth, height, homeFloorY);
    residentialInteriorBlockerIds.push(id);
  }

  // Architecture: a timber-toned floor, matte ceiling, solid side/rear walls
  // and a street facade with a real door aperture and a broad dark-glass
  // living-room window. There is no luminous glass or decorative neon.
  addResidentialPart("floor", "timber", [host.x, homeFloorY + 0.055, host.z],
    [host.width - 0.34, 0.11, host.depth - 0.34]);
  addResidentialPart("ceiling", "plaster", [host.x, homeFloorY + host.clearHeight - 0.07, host.z],
    [host.width - 0.28, 0.14, host.depth - 0.28]);
  addResidentialPart("west-exterior-wall", "plaster", [homeMinX + 0.11, wallCenterY, host.z],
    [0.22, wallHeight, host.depth]);
  addResidentialPart("east-exterior-wall", "plaster", [homeMaxX - 0.11, wallCenterY, host.z],
    [0.22, wallHeight, host.depth]);
  addResidentialPart("north-exterior-wall", "plaster", [host.x, wallCenterY, homeMaxZ - 0.11],
    [host.width, wallHeight, 0.22]);

  const livingWindowLeft = host.x - 0.90;
  const livingWindowRight = host.x + 3.80;
  const doorLeft = entranceX - doorwayWidth * 0.5;
  const doorRight = entranceX + doorwayWidth * 0.5;
  const southWallZ = homeMinZ + 0.11;
  const southWallSegments = [
    ["south-wall-west", homeMinX, livingWindowLeft, wallCenterY, wallHeight],
    ["living-window-sill", livingWindowLeft, livingWindowRight, homeFloorY + 0.39, 0.78],
    ["living-window-header", livingWindowLeft, livingWindowRight, homeFloorY + 2.88, 0.68],
    ["south-wall-window-to-door", livingWindowRight, doorLeft, wallCenterY, wallHeight],
    ["front-door-lintel", doorLeft, doorRight, homeFloorY + 3.00, 0.44],
    ["south-wall-east", doorRight, homeMaxX, wallCenterY, wallHeight],
  ];
  for (const [id, fromX, toX, y, height] of southWallSegments) {
    addResidentialPart(id, "plaster", [(fromX + toX) * 0.5, y, southWallZ],
      [toX - fromX, height, 0.22]);
  }
  addResidentialPart("living-window-west-jamb", "trim", [livingWindowLeft, wallCenterY, southWallZ - 0.025],
    [0.10, wallHeight, 0.12]);
  addResidentialPart("living-window-east-jamb", "trim", [livingWindowRight, wallCenterY, southWallZ - 0.025],
    [0.10, wallHeight, 0.12]);
  addResidentialPart("front-door-west-jamb", "trim", [doorLeft, homeFloorY + 1.45, southWallZ - 0.03],
    [0.12, 2.90, 0.14]);
  addResidentialPart("front-door-east-jamb", "trim", [doorRight, homeFloorY + 1.45, southWallZ - 0.03],
    [0.12, 2.90, 0.14]);
  addResidentialPart("weathered-entry-threshold", "concrete", [entranceX, homeFloorY + 0.025, homeMinZ - 0.36],
    [doorwayWidth + 0.48, 0.05, 0.92]);
  addResidentialGlass("living-room-dark-glass", [(livingWindowLeft + livingWindowRight) * 0.5, homeFloorY + 1.70, homeMinZ - 0.015],
    [livingWindowRight - livingWindowLeft - 0.16, 1.68, 1], [0, Math.PI, 0]);

  // Interior partitions define a private bedroom and bathroom while leaving
  // an open kitchen/living plan. Each doorway is wider than a player-sized
  // circle and represented by a matching split in both geometry and collision.
  const bedroomEastX = host.x - 2.55;
  const bedroomSouthZ = host.z + 0.84;
  const bedroomDoorX = host.x - 4.25;
  const bedroomDoorWidth = 1.12;
  const bedroomSouthSegments = [
    [homeMinX + 0.11, bedroomDoorX - bedroomDoorWidth * 0.5],
    [bedroomDoorX + bedroomDoorWidth * 0.5, bedroomEastX],
  ];
  for (const [index, [fromX, toX]] of bedroomSouthSegments.entries()) {
    addResidentialPart(`bedroom-south-wall-${index + 1}`, "plaster", [(fromX + toX) * 0.5, wallCenterY, bedroomSouthZ],
      [toX - fromX, wallHeight, 0.16]);
  }
  addResidentialPart("bedroom-east-wall", "plaster", [bedroomEastX, wallCenterY, (bedroomSouthZ + homeMaxZ) * 0.5],
    [0.16, wallHeight, homeMaxZ - bedroomSouthZ]);

  const bathroomWestX = host.x - 1.20;
  const bathroomEastX = host.x + 2.62;
  const bathroomSouthZ = host.z + 2.02;
  const bathroomDoorX = host.x + 0.34;
  const bathroomDoorWidth = 0.98;
  for (const [index, [fromX, toX]] of [
    [bathroomWestX, bathroomDoorX - bathroomDoorWidth * 0.5],
    [bathroomDoorX + bathroomDoorWidth * 0.5, bathroomEastX],
  ].entries()) {
    addResidentialPart(`bathroom-south-wall-${index + 1}`, "plaster", [(fromX + toX) * 0.5, wallCenterY, bathroomSouthZ],
      [toX - fromX, wallHeight, 0.16]);
  }
  addResidentialPart("bathroom-west-wall", "plaster", [bathroomWestX, wallCenterY, (bathroomSouthZ + homeMaxZ) * 0.5],
    [0.16, wallHeight, homeMaxZ - bathroomSouthZ]);
  addResidentialPart("bathroom-east-wall", "plaster", [bathroomEastX, wallCenterY, (bathroomSouthZ + homeMaxZ) * 0.5],
    [0.16, wallHeight, homeMaxZ - bathroomSouthZ]);

  // Living room: a grounded fabric sofa, rug, table and media wall. The
  // television is a dark reflective panel, never an emissive rectangle.
  const sofaX = host.x + 4.55;
  const sofaZ = host.z + 1.02;
  addResidentialPart("living-rug", "metal", [sofaX, homeFloorY + 0.075, host.z - 0.15], [4.85, 0.025, 3.30]);
  addResidentialPart("sofa-seat", "upholstery", [sofaX, homeFloorY + 0.46, sofaZ], [3.35, 0.46, 0.92]);
  addResidentialPart("sofa-back", "upholstery", [sofaX, homeFloorY + 0.91, sofaZ + 0.39], [3.35, 0.90, 0.20]);
  addResidentialPart("sofa-west-arm", "upholstery", [sofaX - 1.59, homeFloorY + 0.66, sofaZ], [0.18, 0.68, 0.94]);
  addResidentialPart("sofa-east-arm", "upholstery", [sofaX + 1.59, homeFloorY + 0.66, sofaZ], [0.18, 0.68, 0.94]);
  addResidentialPart("coffee-table", "casework", [host.x + 4.55, homeFloorY + 0.39, host.z - 1.02],
    [1.55, 0.12, 0.78], [0, coffeeTableYaw, 0]);
  addResidentialPart("media-console", "casework", [homeMaxX - 0.43, homeFloorY + 0.41, host.z + 0.10], [0.58, 0.62, 2.52]);
  addResidentialPart("television-dark-panel", "metal", [homeMaxX - 0.20, homeFloorY + 1.55, host.z + 0.10], [0.08, 1.18, 1.98]);

  // Kitchen: full-height fridge and cabinet run, stone worktop, island and
  // two stools. Small seeded offsets make different world seeds feel lived-in
  // without moving doorways or invalidating the navigation contract.
  const kitchenRunX = homeMinX + 0.49;
  addResidentialPart("kitchen-base-cabinets", "cabinetry", [kitchenRunX, homeFloorY + 0.47, host.z - 2.20], [0.70, 0.86, 3.15]);
  addResidentialPart("kitchen-countertop", "concrete", [kitchenRunX + 0.03, homeFloorY + 0.93, host.z - 2.20], [0.82, 0.10, 3.30]);
  addResidentialPart("kitchen-upper-cabinet-1", "cabinetry", [kitchenRunX, homeFloorY + 1.76, host.z - 2.90], [0.50, 0.72, 1.28]);
  addResidentialPart("kitchen-upper-cabinet-2", "cabinetry", [kitchenRunX, homeFloorY + 1.76, host.z - 1.50], [0.50, 0.72, 1.28]);
  addResidentialPart("kitchen-stove", "metal", [kitchenRunX + 0.44, homeFloorY + 0.995, host.z - 2.72], [0.06, 0.06, 0.62]);
  addResidentialPart("kitchen-sink", "plaster", [kitchenRunX + 0.44, homeFloorY + 0.995, host.z - 1.58], [0.06, 0.06, 0.58]);
  addResidentialPart("kitchen-fridge", "metal", [homeMinX + 0.55, homeFloorY + 1.00, host.z + 0.03], [0.90, 2.00, 0.86]);
  const islandX = host.x - 4.55;
  const islandZ = host.z - 2.05;
  addResidentialPart("kitchen-island-base", "cabinetry", [islandX, homeFloorY + 0.44, islandZ], [3.05, 0.82, 0.80]);
  addResidentialPart("kitchen-island-worktop", "concrete", [islandX, homeFloorY + 0.90, islandZ], [3.26, 0.10, 0.98]);
  for (const [index, offset] of [-stoolSpread, stoolSpread].entries()) {
    addResidentialPart(`kitchen-stool-seat-${index + 1}`, "casework", [islandX + offset, homeFloorY + 0.67, islandZ + 0.88], [0.48, 0.12, 0.48]);
    addResidentialPart(`kitchen-stool-stem-${index + 1}`, "pole", [islandX + offset, homeFloorY + 0.35, islandZ + 0.88], [0.10, 0.58, 0.10]);
  }
  const diningTableX = host.x - 0.18;
  const diningTableZ = host.z - 0.42;
  addResidentialPart("dining-table", "casework", [diningTableX, homeFloorY + 0.73, diningTableZ], [1.62, 0.12, 1.02]);

  // Bedroom: realistically scaled double bed, separate linen layer, side
  // tables, wardrobe and dresser. Its door remains clear at the south wall.
  const bedX = host.x - 7.18;
  const bedZ = host.z + 3.68;
  addResidentialPart("bed-base", "casework", [bedX, homeFloorY + 0.24, bedZ], [3.18, 0.38, 2.10]);
  addResidentialPart("bed-mattress", "plaster", [bedX, homeFloorY + 0.55, bedZ], [3.02, 0.28, 1.96]);
  addResidentialPart("bed-linen", "linen", [bedX, homeFloorY + 0.72, bedZ - 0.28], [2.92, 0.08, 1.28]);
  addResidentialPart("bed-headboard", "timber", [bedX, homeFloorY + 0.88, bedZ + 1.00], [3.38, 1.12, 0.18]);
  addResidentialPart("bedside-table-west", "casework", [bedX - 1.92, homeFloorY + 0.32, bedZ + 0.55], [0.56, 0.58, 0.54]);
  addResidentialPart("bedside-table-east", "casework", [bedX + 1.92, homeFloorY + 0.32, bedZ + 0.55], [0.56, 0.58, 0.54]);
  addResidentialPart("bedroom-wardrobe", "cabinetry", [homeMinX + 0.48, homeFloorY + 1.08, host.z + 2.20], [0.76, 2.16, 2.34]);
  addResidentialPart("study-desk", "casework", [bedroomEastX - 0.45, homeFloorY + 0.43, host.z + 4.30], [0.72, 0.82, 1.46]);

  // Bathroom fixtures stay matte and domestic: vanity, basin, toilet and a
  // clear shower enclosure. Transparent panes reuse the resident glass batch.
  addResidentialPart("bathroom-vanity", "cabinetry", [host.x - 0.18, homeFloorY + 0.43, homeMaxZ - 0.43], [1.52, 0.80, 0.58]);
  addResidentialPart("bathroom-basin", "plaster", [host.x - 0.18, homeFloorY + 0.88, homeMaxZ - 0.43], [1.34, 0.10, 0.52]);
  addResidentialPart("bathroom-toilet-base", "plaster", [host.x - 0.24, homeFloorY + 0.31, host.z + 3.24], [0.58, 0.50, 0.76]);
  addResidentialPart("bathroom-toilet-cistern", "plaster", [host.x - 0.24, homeFloorY + 0.72, host.z + 3.55], [0.56, 0.72, 0.24]);
  addResidentialPart("shower-tray", "concrete", [host.x + 1.75, homeFloorY + 0.07, host.z + 4.35], [1.48, 0.12, 1.58]);
  addResidentialGlass("shower-glass-west", [host.x + 1.02, homeFloorY + 1.12, host.z + 4.35], [1.72, 1.92, 1], [0, Math.PI * 0.5, 0]);
  addResidentialGlass("shower-glass-south", [host.x + 1.75, homeFloorY + 1.12, host.z + 3.57], [1.38, 1.92, 1]);

  // Entry storage gives the threshold a domestic transition instead of
  // dropping the player directly into an empty room.
  addResidentialPart("entry-bench", "casework", [homeMaxX - 0.45, homeFloorY + 0.27, host.z - 3.78], [0.62, 0.48, 1.54]);
  addResidentialPart("entry-shoe-cabinet", "cabinetry", [homeMaxX - 0.40, homeFloorY + 0.78, host.z - 2.62], [0.54, 1.42, 0.92]);
  addResidentialPart("entry-coat-rail", "pole", [homeMaxX - 0.22, homeFloorY + 1.72, host.z - 3.78], [0.07, 1.40, 0.07]);
  addResidentialPart("living-ceiling-practical", "plaster", [host.x + 4.20, homeFloorY + host.clearHeight - 0.16, host.z - 0.10], [1.22, 0.05, 0.38]);
  addResidentialPart("kitchen-ceiling-practical", "plaster", [host.x - 5.10, homeFloorY + host.clearHeight - 0.16, host.z - 1.90], [1.04, 0.05, 0.34]);

  // Compound shell collision preserves the front door; room partitions use
  // the same split dimensions as their visible walls. Furniture blockers are
  // conservative at foot height without closing the circulation spine.
  addResidentialBlocker("harbour-view-west-wall", "residential-wall", homeMinX + 0.11, host.z, 0.22, host.depth);
  addResidentialBlocker("harbour-view-east-wall", "residential-wall", homeMaxX - 0.11, host.z, 0.22, host.depth);
  addResidentialBlocker("harbour-view-north-wall", "residential-wall", host.x, homeMaxZ - 0.11, host.width, 0.22);
  addResidentialBlocker("harbour-view-south-wall-west", "residential-wall", (homeMinX + doorLeft) * 0.5, southWallZ,
    doorLeft - homeMinX, 0.22);
  addResidentialBlocker("harbour-view-south-wall-east", "residential-wall", (doorRight + homeMaxX) * 0.5, southWallZ,
    homeMaxX - doorRight, 0.22);
  for (const [index, [fromX, toX]] of bedroomSouthSegments.entries()) {
    addResidentialBlocker(`harbour-view-bedroom-south-${index + 1}`, "residential-partition",
      (fromX + toX) * 0.5, bedroomSouthZ, toX - fromX, 0.16);
  }
  addResidentialBlocker("harbour-view-bedroom-east", "residential-partition", bedroomEastX,
    (bedroomSouthZ + homeMaxZ) * 0.5, 0.16, homeMaxZ - bedroomSouthZ);
  for (const [index, [fromX, toX]] of [
    [bathroomWestX, bathroomDoorX - bathroomDoorWidth * 0.5],
    [bathroomDoorX + bathroomDoorWidth * 0.5, bathroomEastX],
  ].entries()) {
    addResidentialBlocker(`harbour-view-bathroom-south-${index + 1}`, "residential-partition",
      (fromX + toX) * 0.5, bathroomSouthZ, toX - fromX, 0.16);
  }
  addResidentialBlocker("harbour-view-bathroom-west", "residential-partition", bathroomWestX,
    (bathroomSouthZ + homeMaxZ) * 0.5, 0.16, homeMaxZ - bathroomSouthZ);
  addResidentialBlocker("harbour-view-bathroom-east", "residential-partition", bathroomEastX,
    (bathroomSouthZ + homeMaxZ) * 0.5, 0.16, homeMaxZ - bathroomSouthZ);
  for (const fixture of [
    ["kitchen-run", kitchenRunX, host.z - 2.20, 0.82, 3.30, 2.15],
    ["kitchen-fridge", homeMinX + 0.55, host.z + 0.03, 0.90, 0.86, 2.00],
    ["kitchen-island", islandX, islandZ, 3.26, 0.98, 1.00],
    ["dining-table", diningTableX, diningTableZ, 1.62, 1.02, 0.86],
    ["sofa", sofaX, sofaZ, 3.35, 0.94, 1.36],
    ["coffee-table", host.x + 4.55, host.z - 1.02, 1.70, 0.92, 0.52],
    ["media-console", homeMaxX - 0.43, host.z + 0.10, 0.58, 2.52, 1.60],
    ["bed", bedX, bedZ, 3.38, 2.20, 1.45],
    ["wardrobe", homeMinX + 0.48, host.z + 2.20, 0.76, 2.34, 2.16],
    ["bathroom-vanity", host.x - 0.18, homeMaxZ - 0.43, 1.52, 0.58, 0.98],
    ["bathroom-toilet", host.x - 0.24, host.z + 3.38, 0.64, 1.02, 1.10],
    ["shower", host.x + 1.75, host.z + 4.35, 1.48, 1.58, 2.10],
    ["entry-storage", homeMaxX - 0.42, host.z - 3.15, 0.66, 2.25, 1.55],
  ]) {
    addResidentialBlocker(`harbour-view-${fixture[0]}`, "residential-fixture",
      fixture[1], fixture[2], fixture[3], fixture[4], fixture[5]);
  }

  const residentialInterior = deepFreeze({
    id: "southline_studio_3b",
    homeId: "southline_studio_3b",
    label: "SOUTHLINE STUDIO 3B",
    address: "18 Calder Street, Apt 3B",
    buildingId: "southline_court",
    hostBuildingRecordId: host.id,
    districtId: host.districtId,
    seed: residentialInteriorSeed,
    bounds: {
      minX: homeMinX,
      maxX: homeMaxX,
      minZ: homeMinZ,
      maxZ: homeMaxZ,
      floorY: homeFloorY,
      ceilingY: homeFloorY + host.clearHeight,
    },
    entrance: {
      exterior: [entranceX, homeFloorY, homeMinZ - 1.25],
      threshold: [entranceX, homeFloorY, homeMinZ - 0.18],
      interior: [entranceX, homeFloorY, homeMinZ + 1.16],
      heading: 0,
      clearWidth: doorwayWidth,
    },
    zones: {
      entry: { id: "entry", label: "ENTRY", position: [entranceX, homeFloorY, host.z - 4.18], bounds: { minX: host.x + 4.20, maxX: homeMaxX - 0.22, minZ: homeMinZ + 0.22, maxZ: host.z - 2.40 } },
      living: { id: "living", label: "LIVING ROOM", position: [host.x + 7.25, homeFloorY, host.z + 2.05], bounds: { minX: host.x + 2.82, maxX: homeMaxX - 0.22, minZ: host.z - 2.38, maxZ: homeMaxZ - 0.22 } },
      kitchen: { id: "kitchen", label: "KITCHEN", position: [host.x - 6.35, homeFloorY, host.z - 0.58], bounds: { minX: homeMinX + 0.22, maxX: host.x - 2.65, minZ: homeMinZ + 0.22, maxZ: host.z + 0.62 } },
      bathroom: { id: "bathroom", label: "BATHROOM", position: [host.x + 1.30, homeFloorY, host.z + 2.84], bounds: { minX: bathroomWestX + 0.16, maxX: bathroomEastX - 0.16, minZ: bathroomSouthZ + 0.16, maxZ: homeMaxZ - 0.22 } },
      bedroom: { id: "bedroom", label: "BEDROOM", position: [host.x - 4.05, homeFloorY, host.z + 3.05], bounds: { minX: homeMinX + 0.22, maxX: bedroomEastX - 0.16, minZ: bedroomSouthZ + 0.16, maxZ: homeMaxZ - 0.22 } },
    },
    doorways: {
      exterior: { position: [entranceX, homeFloorY, southWallZ], clearWidth: doorwayWidth },
      bedroom: { position: [bedroomDoorX, homeFloorY, bedroomSouthZ], clearWidth: bedroomDoorWidth },
      bathroom: { position: [bathroomDoorX, homeFloorY, bathroomSouthZ], clearWidth: bathroomDoorWidth },
    },
    interactionAnchors: {
      frontDoor: [entranceX, homeFloorY, homeMinZ - 0.48],
      sofa: [sofaX - 2.08, homeFloorY, sofaZ],
      television: [homeMaxX - 1.18, homeFloorY, host.z + 0.10],
      kitchenCounter: [kitchenRunX + 1.18, homeFloorY, host.z - 2.20],
      kitchenIsland: [islandX, homeFloorY, islandZ + 1.18],
      bed: [bedX + 2.18, homeFloorY, bedZ],
      wardrobe: [homeMinX + 1.36, homeFloorY, host.z + 2.20],
      bathroomSink: [host.x - 0.18, homeFloorY, homeMaxZ - 1.25],
      shower: [host.x + 1.75, homeFloorY, host.z + 3.17],
    },
    stations: {
      entry: { id: "home-entry", action: "enter", label: "FRONT DOOR", position: [entranceX, homeFloorY, homeMinZ - 0.48] },
      visitor: { id: "home-visitor", action: "visit", label: "VISITOR SPOT", position: [host.x + 7.35, homeFloorY, host.z - 0.72] },
      resident: { id: "home-resident", action: "resident", label: "RESIDENT SPOT", position: [host.x + 7.35, homeFloorY, host.z + 2.12] },
      bed: { id: "home-bed", action: "sleep", label: "SLEEP", position: [bedX + 2.18, homeFloorY, bedZ], fixtureId: "bed-base" },
      shower: { id: "home-shower", action: "shower", label: "SHOWER", position: [host.x + 1.75, homeFloorY, host.z + 3.17], fixtureId: "shower-tray" },
      stove: { id: "home-stove", action: "cook", label: "COOK", position: [kitchenRunX + 1.18, homeFloorY, host.z - 2.72], fixtureId: "kitchen-stove" },
      table: { id: "home-table", action: "eat", label: "EAT", position: [diningTableX, homeFloorY, diningTableZ - 0.92], fixtureId: "dining-table" },
      sink: { id: "home-sink", action: "clean", label: "CLEAN", position: [kitchenRunX + 1.18, homeFloorY, host.z - 1.58], fixtureId: "kitchen-sink" },
      desk: { id: "home-desk", action: "study", label: "STUDY", position: [bedroomEastX - 1.36, homeFloorY, host.z + 4.30], fixtureId: "study-desk" },
      sofa: { id: "home-sofa", action: "relax", label: "RELAX", position: [sofaX - 2.08, homeFloorY, sofaZ], fixtureId: "sofa-seat" },
    },
    spawnPoints: {
      player: { position: [entranceX, homeFloorY, host.z - 3.62], heading: 0 },
      resident: { id: "resident-avery-bell", name: "Avery Bell", position: [host.x + 7.35, homeFloorY, host.z + 2.12], heading: -Math.PI * 0.5 },
    },
    variant: {
      upholsteryStyle,
      linenStyle,
      cabinetryStyle,
      coffeeTableYaw,
      stoolSpread,
    },
    lighting: {
      kind: "bounded-warm-residential-practical",
      position: [host.x + 4.20, homeFloorY + 2.20, host.z - 0.10],
      color: 0xffd7ad,
      intensity: 8,
      range: 11.5,
      reallocates: "occupied-storefront-practical",
    },
    renderParts: residentialInteriorParts,
    collisionIds: residentialInteriorBlockerIds,
    stats: {
      renderInstances: residentialInteriorParts.length,
      glassPanels: residentialInteriorGlassTransforms.length,
      collisionVolumes: residentialInteriorBlockerIds.length,
      rooms: 5,
      doorways: 3,
      interactionAnchors: 9,
      stations: 10,
      residentSpawns: 1,
      playerSpawns: 1,
      practicalLights: 1,
      emissiveMaterials: 0,
    },
  });

  // Harbour Skills House turns an existing occupied Harbour Mile ground
  // floor into a genuine public-life interior. Its shell, furniture and
  // fixtures append only to city pools that already exist at startup: there
  // is no loading screen, lazy mesh creation, new material or extra batch.
  if (!communityHubHost) throw new Error("Harbour Skills House host building was not generated.");
  const communityHubSeed = (resolvedSeed ^ 0x534b494c) >>> 0;
  const communityHubRandom = mulberry32(communityHubSeed);
  const communityHubParts = [];
  const communityHubGlassTransforms = [];
  const communityHubBlockerIds = [];
  const hubHost = communityHubHost;
  const hubFloorY = SIDEWALK_TOP;
  const hubMinX = hubHost.x - hubHost.width * 0.5;
  const hubMaxX = hubHost.x + hubHost.width * 0.5;
  const hubMinZ = hubHost.z - hubHost.depth * 0.5;
  const hubMaxZ = hubHost.z + hubHost.depth * 0.5;
  const hubEntranceX = hubHost.x;
  const hubDoorWidth = 2.24;
  const hubWallHeight = 3.22;
  const hubWallCenterY = hubFloorY + hubWallHeight * 0.5;
  const hubWestPartitionX = hubHost.x - 1.64;
  const hubEastPartitionX = hubHost.x + 1.64;
  const hubPartitionStartZ = hubMinZ + 5.54;
  const hubWestDividerZ = hubMinZ + 12.92;
  const hubEastDividerZ = hubMinZ + 15.54;
  const hubKitchenDoorZ = hubMinZ + 8.18;
  const hubClassroomDoorZ = hubMinZ + 17.10;
  const hubWorkshopDoorZ = hubMinZ + 10.15;
  const hubBreakDoorZ = hubMinZ + 19.52;
  const hubCabinetStyle = [2, 3, 5][Math.floor(communityHubRandom() * 3)];
  const hubSeatStyle = [0, 1, 2][Math.floor(communityHubRandom() * 3)];
  const hubTableYaw = (communityHubRandom() - 0.5) * 0.08;
  const hubChairSpacing = 1.02 + communityHubRandom() * 0.10;
  const hubPhotoBackdropOffset = (communityHubRandom() - 0.5) * 0.26;

  const communityHubPools = {
    plaster: { transforms: buildingTransforms[5], batch: "Instanced city buildings style 6" },
    timber: { transforms: buildingTransforms[3], batch: "Instanced city buildings style 4" },
    upholstery: { transforms: buildingTransforms[hubSeatStyle], batch: `Instanced city buildings style ${hubSeatStyle + 1}` },
    cabinetry: { transforms: buildingTransforms[hubCabinetStyle], batch: `Instanced city buildings style ${hubCabinetStyle + 1}` },
    concrete: { transforms: podiumTransforms, batch: "Instanced ground-floor podiums" },
    trim: { transforms: facadeRibTransforms, batch: "Instanced facade corner ribs" },
    metal: { transforms: balconyTransforms, batch: "Instanced apartment balconies" },
    casework: { transforms: rooftopTransforms, batch: "Instanced rooftop mechanical housings" },
    pole: { transforms: antennaTransforms, batch: "Instanced rooftop antennas" },
    paper: { transforms: crosswalks, batch: "Downtown pedestrian crossings" },
  };
  function addCommunityHubPart(id, poolName, position, scale, rotation = [0, 0, 0]) {
    const pool = communityHubPools[poolName];
    const item = transform(position, scale, rotation);
    pool.transforms.push(item);
    communityHubParts.push({
      id,
      pool: poolName,
      batch: pool.batch,
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addCommunityHubGlass(id, position, scale, rotation = [0, 0, 0]) {
    const item = transform(position, scale, rotation);
    communityHubGlassTransforms.push(item);
    communityHubParts.push({
      id,
      pool: "dark-glass",
      batch: "Pulse Street bus shelter glass",
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addCommunityHubBlocker(id, kind, x, z, width, depth, height = hubWallHeight) {
    addBlocker(id, kind, x, z, width, depth, height, hubFloorY);
    communityHubBlockerIds.push(id);
  }
  function addHubPartitionSegments(prefix, x, fromZ, toZ, doors) {
    let cursor = fromZ;
    for (const door of [...doors].sort((a, b) => a.center - b.center)) {
      const doorStart = door.center - door.width * 0.5;
      if (doorStart > cursor) {
        const id = `${prefix}-${communityHubBlockerIds.length + 1}`;
        addCommunityHubPart(id, "plaster", [x, hubWallCenterY, (cursor + doorStart) * 0.5],
          [0.16, hubWallHeight, doorStart - cursor]);
        addCommunityHubBlocker(id, "community-partition", x, (cursor + doorStart) * 0.5,
          0.16, doorStart - cursor);
      }
      cursor = door.center + door.width * 0.5;
    }
    if (cursor < toZ) {
      const id = `${prefix}-${communityHubBlockerIds.length + 1}`;
      addCommunityHubPart(id, "plaster", [x, hubWallCenterY, (cursor + toZ) * 0.5],
        [0.16, hubWallHeight, toZ - cursor]);
      addCommunityHubBlocker(id, "community-partition", x, (cursor + toZ) * 0.5, 0.16, toZ - cursor);
    }
  }

  // Continuous public floor and ceiling under the retained upper building.
  addCommunityHubPart("hub-floor", "timber", [hubHost.x, hubFloorY + 0.03, hubHost.z],
    [hubHost.width - 0.18, 0.06, hubHost.depth - 0.18]);
  addCommunityHubPart("hub-ceiling", "plaster", [hubHost.x, hubFloorY + hubHost.clearHeight - 0.07, hubHost.z],
    [hubHost.width - 0.18, 0.14, hubHost.depth - 0.18]);

  // Street frontage: broad dark glass reads as normal daytime glazing, with
  // a real 2.24 m double-door aperture and a shallow weather threshold.
  const hubDoorLeft = hubEntranceX - hubDoorWidth * 0.5;
  const hubDoorRight = hubEntranceX + hubDoorWidth * 0.5;
  const hubSouthWallZ = hubMinZ + 0.11;
  const hubLeftWindowLeft = hubMinX + 0.62;
  const hubLeftWindowRight = hubDoorLeft - 0.18;
  const hubRightWindowLeft = hubDoorRight + 0.18;
  const hubRightWindowRight = hubMaxX - 0.62;
  for (const [id, fromX, toX] of [
    ["hub-south-west-column", hubMinX, hubLeftWindowLeft],
    ["hub-south-east-column", hubRightWindowRight, hubMaxX],
  ]) {
    addCommunityHubPart(id, "plaster", [(fromX + toX) * 0.5, hubWallCenterY, hubSouthWallZ],
      [toX - fromX, hubWallHeight, 0.22]);
  }
  for (const [side, fromX, toX] of [
    ["west", hubLeftWindowLeft, hubLeftWindowRight],
    ["east", hubRightWindowLeft, hubRightWindowRight],
  ]) {
    addCommunityHubPart(`hub-${side}-window-sill`, "concrete", [(fromX + toX) * 0.5, hubFloorY + 0.37, hubSouthWallZ],
      [toX - fromX, 0.74, 0.22]);
    addCommunityHubPart(`hub-${side}-window-header`, "plaster", [(fromX + toX) * 0.5, hubFloorY + 2.89, hubSouthWallZ],
      [toX - fromX, 0.66, 0.22]);
    addCommunityHubGlass(`hub-${side}-dark-glass`, [(fromX + toX) * 0.5, hubFloorY + 1.70, hubMinZ - 0.015],
      [toX - fromX - 0.12, 1.72, 1], [0, Math.PI, 0]);
  }
  addCommunityHubPart("hub-door-lintel", "plaster", [hubEntranceX, hubFloorY + 3.00, hubSouthWallZ],
    [hubDoorWidth + 0.18, 0.44, 0.22]);
  for (const [side, x] of [["west", hubDoorLeft], ["east", hubDoorRight]]) {
    addCommunityHubPart(`hub-door-${side}-jamb`, "trim", [x, hubFloorY + 1.45, hubSouthWallZ - 0.03],
      [0.13, 2.90, 0.15]);
  }
  addCommunityHubPart("hub-weathered-threshold", "concrete", [hubEntranceX, hubFloorY + 0.026, hubMinZ - 0.46],
    [hubDoorWidth + 0.74, 0.052, 1.12]);
  addCommunityHubPart("hub-rain-canopy", "metal", [hubEntranceX, hubFloorY + 3.16, hubMinZ - 0.72],
    [hubDoorWidth + 3.1, 0.16, 1.55], [-0.035, 0, 0]);
  addCommunityHubPart("hub-restrained-sign-backing", "timber", [hubEntranceX, hubFloorY + 2.71, hubMinZ - 0.035],
    [5.8, 0.38, 0.08]);

  addCommunityHubPart("hub-west-wall", "plaster", [hubMinX + 0.11, hubWallCenterY, hubHost.z],
    [0.22, hubWallHeight, hubHost.depth]);
  addCommunityHubPart("hub-east-wall", "plaster", [hubMaxX - 0.11, hubWallCenterY, hubHost.z],
    [0.22, hubWallHeight, hubHost.depth]);
  addCommunityHubPart("hub-north-wall", "plaster", [hubHost.x, hubWallCenterY, hubMaxZ - 0.11],
    [hubHost.width, hubWallHeight, 0.22]);

  addCommunityHubBlocker("hub-west-shell", "community-wall", hubMinX + 0.11, hubHost.z, 0.22, hubHost.depth);
  addCommunityHubBlocker("hub-east-shell", "community-wall", hubMaxX - 0.11, hubHost.z, 0.22, hubHost.depth);
  addCommunityHubBlocker("hub-north-shell", "community-wall", hubHost.x, hubMaxZ - 0.11, hubHost.width, 0.22);
  addCommunityHubBlocker("hub-south-shell-west", "community-wall", (hubMinX + hubDoorLeft) * 0.5,
    hubSouthWallZ, hubDoorLeft - hubMinX, 0.22);
  addCommunityHubBlocker("hub-south-shell-east", "community-wall", (hubDoorRight + hubMaxX) * 0.5,
    hubSouthWallZ, hubMaxX - hubDoorRight, 0.22);

  // A wide central circulation spine connects four full-height room doors.
  // Side rooms receive their own dividing wall, so their labels correspond
  // to real architecture rather than arbitrary trigger rectangles.
  addHubPartitionSegments("hub-west-corridor-wall", hubWestPartitionX, hubPartitionStartZ, hubMaxZ - 0.11, [
    { center: hubKitchenDoorZ, width: 1.34 },
    { center: hubClassroomDoorZ, width: 1.38 },
  ]);
  addHubPartitionSegments("hub-east-corridor-wall", hubEastPartitionX, hubPartitionStartZ, hubMaxZ - 0.11, [
    { center: hubWorkshopDoorZ, width: 1.42 },
    { center: hubBreakDoorZ, width: 1.30 },
  ]);
  addCommunityHubPart("hub-west-room-divider", "plaster", [(hubMinX + hubWestPartitionX) * 0.5,
    hubWallCenterY, hubWestDividerZ], [hubWestPartitionX - hubMinX, hubWallHeight, 0.16]);
  addCommunityHubBlocker("hub-west-room-divider", "community-partition", (hubMinX + hubWestPartitionX) * 0.5,
    hubWestDividerZ, hubWestPartitionX - hubMinX, 0.16);
  addCommunityHubPart("hub-east-room-divider", "plaster", [(hubEastPartitionX + hubMaxX) * 0.5,
    hubWallCenterY, hubEastDividerZ], [hubMaxX - hubEastPartitionX, hubWallHeight, 0.16]);
  addCommunityHubBlocker("hub-east-room-divider", "community-partition", (hubEastPartitionX + hubMaxX) * 0.5,
    hubEastDividerZ, hubMaxX - hubEastPartitionX, 0.16);

  // Reception desk and grounded office storage.
  const hubReceptionX = hubHost.x - 4.15;
  const hubReceptionZ = hubMinZ + 3.30;
  addCommunityHubPart("hub-reception-desk-base", "cabinetry", [hubReceptionX, hubFloorY + 0.47, hubReceptionZ], [3.45, 0.86, 0.72]);
  addCommunityHubPart("hub-reception-desk-top", "casework", [hubReceptionX, hubFloorY + 0.94, hubReceptionZ], [3.66, 0.10, 0.86]);
  addCommunityHubPart("hub-reception-monitor", "metal", [hubReceptionX + 0.58, hubFloorY + 1.32, hubReceptionZ + 0.18], [0.68, 0.58, 0.10]);
  addCommunityHubPart("hub-reception-files", "cabinetry", [hubMinX + 0.48, hubFloorY + 0.78, hubMinZ + 4.68], [0.72, 1.42, 1.15]);

  // Teaching kitchen: domestic-scaled cabinets, distinct preparation and
  // service surfaces, sink, hob and a full-height refrigerator.
  const hubKitchenRunX = hubMinX + 0.48;
  const hubKitchenRunZ = hubMinZ + 8.55;
  addCommunityHubPart("hub-kitchen-base-cabinets", "cabinetry", [hubKitchenRunX, hubFloorY + 0.47, hubKitchenRunZ], [0.72, 0.86, 4.65]);
  addCommunityHubPart("hub-kitchen-worktop", "concrete", [hubKitchenRunX + 0.04, hubFloorY + 0.93, hubKitchenRunZ], [0.84, 0.10, 4.82]);
  addCommunityHubPart("hub-kitchen-upper-1", "cabinetry", [hubKitchenRunX, hubFloorY + 1.78, hubKitchenRunZ - 1.20], [0.54, 0.72, 1.62]);
  addCommunityHubPart("hub-kitchen-upper-2", "cabinetry", [hubKitchenRunX, hubFloorY + 1.78, hubKitchenRunZ + 1.28], [0.54, 0.72, 1.62]);
  addCommunityHubPart("hub-kitchen-fridge", "metal", [hubMinX + 0.54, hubFloorY + 1.02, hubMinZ + 5.55], [0.92, 2.04, 0.88]);
  addCommunityHubPart("hub-kitchen-hob", "metal", [hubKitchenRunX + 0.47, hubFloorY + 0.995, hubKitchenRunZ - 1.10], [0.06, 0.06, 0.68]);
  addCommunityHubPart("hub-kitchen-sink", "plaster", [hubKitchenRunX + 0.47, hubFloorY + 0.995, hubKitchenRunZ + 1.12], [0.06, 0.06, 0.64]);
  const hubServeX = hubHost.x - 5.08;
  const hubServeZ = hubWestDividerZ - 1.20;
  addCommunityHubPart("hub-serving-counter-base", "cabinetry", [hubServeX, hubFloorY + 0.46, hubServeZ], [3.15, 0.84, 0.76]);
  addCommunityHubPart("hub-serving-counter-top", "concrete", [hubServeX, hubFloorY + 0.92, hubServeZ], [3.34, 0.10, 0.92]);

  // Repair workshop: steel bench, real parts storage, intake desk, pegboard
  // and stable seeded tools. The colours are matte industrial pools, never
  // signage/emissive materials.
  const hubRepairBenchX = hubMaxX - 0.49;
  const hubRepairBenchZ = hubMinZ + 10.70;
  addCommunityHubPart("hub-repair-workbench", "metal", [hubRepairBenchX, hubFloorY + 0.48, hubRepairBenchZ], [0.76, 0.92, 4.10]);
  addCommunityHubPart("hub-repair-pegboard", "timber", [hubMaxX - 0.115, hubFloorY + 1.69, hubRepairBenchZ], [0.055, 1.28, 4.28]);
  for (let tool = 0; tool < 6; ++tool) {
    addCommunityHubPart(`hub-wall-tool-${tool + 1}`, tool % 3 === 0 ? "pole" : "trim",
      [hubMaxX - 0.075, hubFloorY + 1.40 + Math.floor(tool / 3) * 0.50 + (communityHubRandom() - 0.5) * 0.06,
        hubRepairBenchZ - 1.35 + (tool % 3) * 1.34],
      [0.08, 0.34 + communityHubRandom() * 0.12, 0.07], [0, 0, tool % 2 ? -0.17 : 0.17]);
  }
  const hubShelfX = hubMaxX - 0.47;
  const hubShelfZ = hubEastDividerZ - 1.34;
  for (let level = 0; level < 3; ++level) {
    addCommunityHubPart(`hub-parts-shelf-${level + 1}`, "trim", [hubShelfX, hubFloorY + 0.35 + level * 0.68, hubShelfZ], [0.72, 0.08, 2.28]);
  }
  for (let bin = 0; bin < 4; ++bin) {
    addCommunityHubPart(`hub-labelled-parts-bin-${bin + 1}`, "metal",
      [hubMaxX - 0.54, hubFloorY + 0.51 + (bin % 2) * 0.68, hubShelfZ - 0.64 + Math.floor(bin / 2) * 1.28],
      [0.54, 0.25, 0.48]);
  }
  const hubIntakeX = hubHost.x + 4.10;
  addCommunityHubPart("hub-repair-intake-desk", "casework", [hubIntakeX, hubFloorY + 0.72, hubReceptionZ], [2.45, 0.12, 0.88]);
  addCommunityHubPart("hub-repair-intake-pedestal", "cabinetry", [hubIntakeX, hubFloorY + 0.36, hubReceptionZ], [0.34, 0.66, 0.52]);

  // Classroom and photography desk: two shared worktables, proper chairs,
  // a computer, camera body and a matte backdrop rail.
  const hubClassX = hubMinX + 3.30;
  const hubClassTableZs = [hubWestDividerZ + 2.35, hubWestDividerZ + 6.24];
  for (const [tableIndex, tableZ] of hubClassTableZs.entries()) {
    addCommunityHubPart(`hub-class-table-${tableIndex + 1}`, "casework", [hubClassX, hubFloorY + 0.73, tableZ], [3.25, 0.12, 1.12], [0, hubTableYaw, 0]);
    for (const [chairIndex, offset] of [-hubChairSpacing, hubChairSpacing].entries()) {
      addCommunityHubPart(`hub-class-${tableIndex + 1}-chair-${chairIndex + 1}-seat`, "upholstery",
        [hubClassX + offset, hubFloorY + 0.48, tableZ - 1.05], [0.52, 0.12, 0.52]);
      addCommunityHubPart(`hub-class-${tableIndex + 1}-chair-${chairIndex + 1}-back`, "upholstery",
        [hubClassX + offset, hubFloorY + 0.84, tableZ - 1.29], [0.52, 0.68, 0.10]);
    }
  }
  const hubPhotoDeskZ = hubMaxZ - 1.54;
  addCommunityHubPart("hub-photo-desk", "casework", [hubMinX + 0.48, hubFloorY + 0.72, hubPhotoDeskZ], [0.72, 0.12, 2.15]);
  addCommunityHubPart("hub-photo-monitor", "metal", [hubMinX + 0.90, hubFloorY + 1.30, hubPhotoDeskZ], [0.08, 0.64, 0.82]);
  addCommunityHubPart("hub-photo-camera", "metal", [hubMinX + 0.93, hubFloorY + 1.02, hubPhotoDeskZ - 0.72], [0.18, 0.16, 0.28]);
  addCommunityHubPart("hub-photo-backdrop", "plaster", [hubWestPartitionX - 0.68 + hubPhotoBackdropOffset,
    hubFloorY + 1.52, hubMaxZ - 0.18], [2.16, 2.68, 0.08]);
  addCommunityHubPart("hub-photo-backdrop-rail", "pole", [hubWestPartitionX - 0.68 + hubPhotoBackdropOffset,
    hubFloorY + 2.92, hubMaxZ - 0.30], [2.42, 0.08, 0.08]);

  // Staff break room with fabric sofa, coffee table, lockers and kitchenette.
  const hubBreakSofaX = hubMaxX - 2.35;
  const hubBreakSofaZ = hubMaxZ - 2.05;
  addCommunityHubPart("hub-break-sofa-seat", "upholstery", [hubBreakSofaX, hubFloorY + 0.46, hubBreakSofaZ], [3.05, 0.46, 0.92]);
  addCommunityHubPart("hub-break-sofa-back", "upholstery", [hubBreakSofaX, hubFloorY + 0.91, hubBreakSofaZ + 0.38], [3.05, 0.88, 0.18]);
  addCommunityHubPart("hub-break-table", "casework", [hubHost.x + 4.48, hubFloorY + 0.39, hubMaxZ - 4.05], [1.45, 0.12, 0.78]);
  addCommunityHubPart("hub-staff-lockers", "cabinetry", [hubEastPartitionX + 0.48, hubFloorY + 1.04, hubMaxZ - 1.42], [0.72, 2.08, 2.24]);
  addCommunityHubPart("hub-break-counter", "cabinetry", [hubMaxX - 0.48, hubFloorY + 0.47, hubEastDividerZ + 1.68], [0.72, 0.86, 2.35]);
  addCommunityHubPart("hub-break-countertop", "concrete", [hubMaxX - 0.44, hubFloorY + 0.93, hubEastDividerZ + 1.68], [0.82, 0.10, 2.48]);

  for (const [id, x, z, width, depth, height] of [
    ["hub-reception-desk", hubReceptionX, hubReceptionZ, 3.66, 0.86, 1.0],
    ["hub-reception-files", hubMinX + 0.48, hubMinZ + 4.68, 0.72, 1.15, 1.5],
    ["hub-kitchen-run", hubKitchenRunX, hubKitchenRunZ, 0.84, 4.82, 2.15],
    ["hub-kitchen-fridge", hubMinX + 0.54, hubMinZ + 5.55, 0.92, 0.88, 2.04],
    ["hub-serving-counter", hubServeX, hubServeZ, 3.34, 0.92, 1.0],
    ["hub-repair-bench", hubRepairBenchX, hubRepairBenchZ, 0.76, 4.10, 1.0],
    ["hub-parts-shelf", hubShelfX, hubShelfZ, 0.72, 2.28, 2.0],
    ["hub-intake-desk", hubIntakeX, hubReceptionZ, 2.45, 0.88, 0.9],
    ["hub-class-table-1", hubClassX, hubClassTableZs[0], 3.35, 1.22, 0.86],
    ["hub-class-table-2", hubClassX, hubClassTableZs[1], 3.35, 1.22, 0.86],
    ["hub-photo-desk", hubMinX + 0.48, hubPhotoDeskZ, 0.72, 2.15, 1.0],
    ["hub-break-sofa", hubBreakSofaX, hubBreakSofaZ, 3.05, 0.94, 1.36],
    ["hub-staff-lockers", hubEastPartitionX + 0.48, hubMaxZ - 1.42, 0.72, 2.24, 2.08],
    ["hub-break-counter", hubMaxX - 0.48, hubEastDividerZ + 1.68, 0.82, 2.48, 1.0],
  ]) addCommunityHubBlocker(id, "community-fixture", x, z, width, depth, height);

  // Preallocated ceiling practical housings visually identify the working
  // rooms. Their two actual lights are borrowed from the fixed storefront
  // light pool below and are focus-bounded to this interior.
  addCommunityHubPart("hub-kitchen-ceiling-practical", "plaster", [hubMinX + 3.5,
    hubFloorY + hubHost.clearHeight - 0.16, hubMinZ + 8.7], [1.25, 0.05, 0.36]);
  addCommunityHubPart("hub-workshop-ceiling-practical", "plaster", [hubMaxX - 3.5,
    hubFloorY + hubHost.clearHeight - 0.16, hubMinZ + 10.7], [1.25, 0.05, 0.36]);
  addCommunityHubPart("hub-classroom-ceiling-practical", "plaster", [hubMinX + 3.5,
    hubFloorY + hubHost.clearHeight - 0.16, hubMaxZ - 5.4], [1.25, 0.05, 0.36]);

  const communityHub = deepFreeze({
    id: "harbour-skills-house",
    buildingId: "harbour-skills-house-building",
    label: "HARBOUR SKILLS HOUSE",
    address: "42 Mariner Walk",
    districtId: hubHost.districtId,
    hostBuildingRecordId: hubHost.id,
    seed: communityHubSeed,
    bounds: {
      minX: hubMinX,
      maxX: hubMaxX,
      minZ: hubMinZ,
      maxZ: hubMaxZ,
      floorY: hubFloorY,
      ceilingY: hubFloorY + hubHost.clearHeight,
    },
    entrance: {
      exterior: [hubEntranceX, hubFloorY, hubMinZ - 1.45],
      threshold: [hubEntranceX, hubFloorY, hubMinZ - 0.18],
      interior: [hubEntranceX, hubFloorY, hubMinZ + 1.52],
      heading: 0,
      clearWidth: hubDoorWidth,
    },
    zones: {
      reception: { id: "reception", label: "RECEPTION", position: [hubHost.x, hubFloorY, hubMinZ + 3.12], bounds: { minX: hubMinX + 0.22, maxX: hubMaxX - 0.22, minZ: hubMinZ + 0.22, maxZ: hubPartitionStartZ - 0.10 } },
      kitchen: { id: "kitchen", label: "TEACHING KITCHEN", position: [hubWestPartitionX - 1.18, hubFloorY, hubKitchenDoorZ], bounds: { minX: hubMinX + 0.22, maxX: hubWestPartitionX - 0.16, minZ: hubPartitionStartZ, maxZ: hubWestDividerZ - 0.16 } },
      workshop: { id: "workshop", label: "REPAIR WORKSHOP", position: [hubEastPartitionX + 1.22, hubFloorY, hubWorkshopDoorZ], bounds: { minX: hubEastPartitionX + 0.16, maxX: hubMaxX - 0.22, minZ: hubPartitionStartZ, maxZ: hubEastDividerZ - 0.16 } },
      classroom: { id: "classroom", label: "CLASSROOM + PHOTO LAB", position: [hubWestPartitionX - 1.18, hubFloorY, hubClassroomDoorZ], bounds: { minX: hubMinX + 0.22, maxX: hubWestPartitionX - 0.16, minZ: hubWestDividerZ + 0.16, maxZ: hubMaxZ - 0.22 } },
      breakRoom: { id: "break-room", label: "STAFF BREAK ROOM", position: [hubEastPartitionX + 1.18, hubFloorY, hubBreakDoorZ], bounds: { minX: hubEastPartitionX + 0.16, maxX: hubMaxX - 0.22, minZ: hubEastDividerZ + 0.16, maxZ: hubMaxZ - 0.22 } },
    },
    doorways: {
      exterior: { position: [hubEntranceX, hubFloorY, hubSouthWallZ], clearWidth: hubDoorWidth },
      kitchen: { position: [hubWestPartitionX, hubFloorY, hubKitchenDoorZ], clearWidth: 1.34 },
      workshop: { position: [hubEastPartitionX, hubFloorY, hubWorkshopDoorZ], clearWidth: 1.42 },
      classroom: { position: [hubWestPartitionX, hubFloorY, hubClassroomDoorZ], clearWidth: 1.38 },
      breakRoom: { position: [hubEastPartitionX, hubFloorY, hubBreakDoorZ], clearWidth: 1.30 },
    },
    stations: {
      reception: { id: "hub-reception", action: "check_in", label: "RECEPTION", position: [hubReceptionX, hubFloorY, hubReceptionZ - 1.08], fixtureId: "hub-reception-desk-base" },
      kitchenPrep: { id: "hub-kitchen-prep", action: "prepare_meal", label: "PREPARE A MEAL", position: [hubKitchenRunX + 1.30, hubFloorY, hubKitchenRunZ - 1.10], fixtureId: "hub-kitchen-hob" },
      kitchenServe: { id: "hub-kitchen-serve", action: "serve_meal", label: "SERVE A MEAL", position: [hubServeX, hubFloorY, hubServeZ - 1.02], fixtureId: "hub-serving-counter-top" },
      kitchenClean: { id: "hub-kitchen-clean", action: "clean_kitchen", label: "CLEAN THE KITCHEN", position: [hubKitchenRunX + 1.30, hubFloorY, hubKitchenRunZ + 1.12], fixtureId: "hub-kitchen-sink" },
      repairIntake: { id: "hub-repair-intake", action: "intake_repair", label: "REPAIR INTAKE", position: [hubIntakeX, hubFloorY, hubReceptionZ - 1.08], fixtureId: "hub-repair-intake-desk" },
      repairBench: { id: "hub-repair-bench", action: "repair", label: "REPAIR BENCH", position: [hubRepairBenchX - 1.32, hubFloorY, hubRepairBenchZ], fixtureId: "hub-repair-workbench" },
      classroom: { id: "hub-classroom", action: "learn", label: "JOIN A CLASS", position: [hubWestPartitionX - 1.20, hubFloorY, hubClassTableZs[0]], fixtureId: "hub-class-table-1" },
      photoDesk: { id: "hub-photo-desk", action: "photography", label: "PHOTO DESK", position: [hubMinX + 1.42, hubFloorY, hubPhotoDeskZ], fixtureId: "hub-photo-desk" },
      breakArea: { id: "hub-break-area", action: "rest", label: "TAKE A BREAK", position: [hubBreakSofaX - 1.98, hubFloorY, hubBreakSofaZ], fixtureId: "hub-break-sofa-seat" },
    },
    spawnPoints: {
      public: [
        { id: "hub-public-1", position: [hubHost.x - 0.58, hubFloorY, hubMinZ + 2.10], heading: 0 },
        { id: "hub-public-2", position: [hubWestPartitionX - 1.18, hubFloorY, hubKitchenDoorZ + 0.92], heading: Math.PI * 0.5 },
        { id: "hub-public-3", position: [hubWestPartitionX - 1.18, hubFloorY, hubClassroomDoorZ + 0.92], heading: Math.PI * 0.5 },
      ],
      staff: [
        { id: "hub-staff-reception", role: "reception", position: [hubReceptionX, hubFloorY, hubReceptionZ + 1.02], heading: Math.PI },
        { id: "hub-staff-kitchen", role: "kitchen", position: [hubKitchenRunX + 1.30, hubFloorY, hubKitchenRunZ], heading: -Math.PI * 0.5 },
        { id: "hub-staff-repair", role: "repair", position: [hubRepairBenchX - 1.32, hubFloorY, hubRepairBenchZ + 1.14], heading: Math.PI * 0.5 },
        { id: "hub-staff-teacher", role: "teacher", position: [hubWestPartitionX - 1.18, hubFloorY, hubClassTableZs[1] + 1.20], heading: Math.PI },
      ],
    },
    navigationNodes: [
      [hubEntranceX, hubFloorY, hubMinZ - 1.45],
      [hubEntranceX, hubFloorY, hubMinZ - 0.18],
      [hubEntranceX, hubFloorY, hubMinZ + 1.52],
      [hubHost.x, hubFloorY, hubPartitionStartZ + 0.60],
      [hubHost.x, hubFloorY, hubWestDividerZ + 1.0],
      [hubHost.x, hubFloorY, hubEastDividerZ + 1.0],
      [hubHost.x, hubFloorY, hubMaxZ - 1.0],
    ],
    variant: {
      cabinetStyle: hubCabinetStyle,
      seatStyle: hubSeatStyle,
      tableYaw: hubTableYaw,
      chairSpacing: hubChairSpacing,
      photoBackdropOffset: hubPhotoBackdropOffset,
    },
    glass: {
      kind: "dark-neutral-public-glazing",
      panels: 2,
      emissive: false,
      neon: false,
    },
    lighting: {
      kind: "bounded-warm-public-practical",
      positions: [
        [hubMinX + 3.5, hubFloorY + 2.58, hubMinZ + 8.7],
        [hubMaxX - 3.5, hubFloorY + 2.58, hubMinZ + 10.7],
      ],
      colors: [0xffd5a8, 0xdbeaff],
      intensities: [12, 13],
      ranges: [12.5, 12.5],
      reallocates: "two-occupied-storefront-practicals",
    },
    renderParts: communityHubParts,
    collisionIds: communityHubBlockerIds,
    stats: {
      rooms: 5,
      doorways: 5,
      stations: 9,
      publicSpawns: 3,
      staffSpawns: 4,
      renderInstances: communityHubParts.length,
      glassPanels: communityHubGlassTransforms.length,
      collisionVolumes: communityHubBlockerIds.length,
      practicalLights: 2,
      emissiveMaterials: 0,
    },
  });

  // Common Ground is the first ordinary hospitality workplace that is also a
  // complete street-connected building. The former nine-piece pavement bay
  // has been removed below; these rooms occupy the ground floor opened in the
  // original tower shell, with no portal, scene swap or runtime asset work.
  // Every surface and fixture appends to an existing resident GPU pool.
  if (!commonGroundCafeHost) throw new Error("Common Ground Cafe host building was not generated.");
  const commonGroundCafeSeed = (resolvedSeed ^ 0x43414645) >>> 0;
  const commonGroundCafeRandom = mulberry32(commonGroundCafeSeed);
  const commonGroundCafeParts = [];
  const commonGroundCafeGlassTransforms = [];
  const commonGroundCafeBlockerIds = [];
  const cafeHost = commonGroundCafeHost;
  const cafeFloorY = SIDEWALK_TOP;
  const cafeMinX = cafeHost.x - cafeHost.width * 0.5;
  const cafeMaxX = cafeHost.x + cafeHost.width * 0.5;
  const cafeMinZ = cafeHost.z - cafeHost.depth * 0.5;
  const cafeMaxZ = cafeHost.z + cafeHost.depth * 0.5;
  // This is the exact long-standing Open Doors interaction coordinate on the
  // south pavement. Keeping it as the physical doorway preserves story/NPC
  // identity while finally giving that marker a place behind it.
  const cafeEntranceX = -40;
  const cafeDoorWidth = 1.62;
  const cafeDoorLeft = cafeEntranceX - cafeDoorWidth * 0.5;
  const cafeDoorRight = cafeEntranceX + cafeDoorWidth * 0.5;
  const cafeWallHeight = 3.22;
  const cafeWallCenterY = cafeFloorY + cafeWallHeight * 0.5;
  const cafeSouthWallZ = cafeMinZ + 0.11;
  const cafeBackOfHouseZ = cafeHost.z - 1.12;
  const cafeKitchenDishX = cafeHost.x + 5.35;
  const cafeRearRoomsZ = cafeHost.z + 6.86;
  const cafeStockDividerX = cafeHost.x - 4.05;
  const cafeToiletDividerX = cafeHost.x + 5.75;
  const cafeCabinetStyle = [2, 3, 5][Math.floor(commonGroundCafeRandom() * 3)];
  const cafeSeatStyle = [0, 1, 2][Math.floor(commonGroundCafeRandom() * 3)];
  const cafeTableYaw = (commonGroundCafeRandom() - 0.5) * 0.075;
  const cafeChairOffset = 0.92 + commonGroundCafeRandom() * 0.08;
  const cafeShelfJitter = (commonGroundCafeRandom() - 0.5) * 0.10;

  const commonGroundCafePools = {
    plaster: { transforms: buildingTransforms[5], batch: "Instanced city buildings style 6" },
    timber: { transforms: buildingTransforms[3], batch: "Instanced city buildings style 4" },
    upholstery: { transforms: buildingTransforms[cafeSeatStyle], batch: `Instanced city buildings style ${cafeSeatStyle + 1}` },
    cabinetry: { transforms: buildingTransforms[cafeCabinetStyle], batch: `Instanced city buildings style ${cafeCabinetStyle + 1}` },
    concrete: { transforms: podiumTransforms, batch: "Instanced ground-floor podiums" },
    trim: { transforms: facadeRibTransforms, batch: "Instanced facade corner ribs" },
    metal: { transforms: balconyTransforms, batch: "Instanced apartment balconies" },
    casework: { transforms: rooftopTransforms, batch: "Instanced rooftop mechanical housings" },
    pole: { transforms: antennaTransforms, batch: "Instanced rooftop antennas" },
  };
  function addCommonGroundCafePart(id, poolName, position, scale, rotation = [0, 0, 0]) {
    const pool = commonGroundCafePools[poolName];
    const item = transform(position, scale, rotation);
    pool.transforms.push(item);
    commonGroundCafeParts.push({
      id,
      pool: poolName,
      batch: pool.batch,
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addCommonGroundCafeGlass(id, position, scale, rotation = [0, 0, 0]) {
    const item = transform(position, scale, rotation);
    commonGroundCafeGlassTransforms.push(item);
    commonGroundCafeParts.push({
      id,
      pool: "glass",
      batch: "Pulse Street bus shelter glass",
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addCommonGroundCafeBlocker(id, kind, x, z, width, depth, height = cafeWallHeight) {
    addBlocker(id, kind, x, z, width, depth, height, cafeFloorY);
    commonGroundCafeBlockerIds.push(id);
  }
  function addCafeHorizontalWall(prefix, z, fromX, toX, doorways = []) {
    let cursor = fromX;
    const sorted = [...doorways].sort((a, b) => a.center - b.center);
    for (const opening of sorted) {
      const left = clamp(opening.center - opening.width * 0.5, fromX, toX);
      const right = clamp(opening.center + opening.width * 0.5, fromX, toX);
      if (left > cursor + 0.01) {
        const id = `${prefix}-${commonGroundCafeBlockerIds.length + 1}`;
        addCommonGroundCafePart(id, "plaster", [(cursor + left) * 0.5, cafeWallCenterY, z],
          [left - cursor, cafeWallHeight, 0.16]);
        addCommonGroundCafeBlocker(id, "cafe-partition", (cursor + left) * 0.5, z, left - cursor, 0.16);
      }
      cursor = Math.max(cursor, right);
    }
    if (cursor < toX - 0.01) {
      const id = `${prefix}-${commonGroundCafeBlockerIds.length + 1}`;
      addCommonGroundCafePart(id, "plaster", [(cursor + toX) * 0.5, cafeWallCenterY, z],
        [toX - cursor, cafeWallHeight, 0.16]);
      addCommonGroundCafeBlocker(id, "cafe-partition", (cursor + toX) * 0.5, z, toX - cursor, 0.16);
    }
  }
  function addCafeVerticalWall(prefix, x, fromZ, toZ, doorways = []) {
    let cursor = fromZ;
    const sorted = [...doorways].sort((a, b) => a.center - b.center);
    for (const opening of sorted) {
      const near = clamp(opening.center - opening.width * 0.5, fromZ, toZ);
      const far = clamp(opening.center + opening.width * 0.5, fromZ, toZ);
      if (near > cursor + 0.01) {
        const id = `${prefix}-${commonGroundCafeBlockerIds.length + 1}`;
        addCommonGroundCafePart(id, "plaster", [x, cafeWallCenterY, (cursor + near) * 0.5],
          [0.16, cafeWallHeight, near - cursor]);
        addCommonGroundCafeBlocker(id, "cafe-partition", x, (cursor + near) * 0.5, 0.16, near - cursor);
      }
      cursor = Math.max(cursor, far);
    }
    if (cursor < toZ - 0.01) {
      const id = `${prefix}-${commonGroundCafeBlockerIds.length + 1}`;
      addCommonGroundCafePart(id, "plaster", [x, cafeWallCenterY, (cursor + toZ) * 0.5],
        [0.16, cafeWallHeight, toZ - cursor]);
      addCommonGroundCafeBlocker(id, "cafe-partition", x, (cursor + toZ) * 0.5, 0.16, toZ - cursor);
    }
  }

  // Shell and street facade. The broad glazing is neutral dark glass with a
  // conventional sill/header and mullions; only the wider city may use neon.
  addCommonGroundCafePart("cafe-floor", "timber", [cafeHost.x, cafeFloorY + 0.055, cafeHost.z],
    [cafeHost.width - 0.34, 0.11, cafeHost.depth - 0.34]);
  addCommonGroundCafePart("cafe-ceiling", "plaster", [cafeHost.x,
    cafeFloorY + cafeHost.clearHeight - 0.07, cafeHost.z], [cafeHost.width - 0.28, 0.14, cafeHost.depth - 0.28]);
  addCommonGroundCafePart("cafe-west-shell", "plaster", [cafeMinX + 0.11, cafeWallCenterY, cafeHost.z],
    [0.22, cafeWallHeight, cafeHost.depth]);
  addCommonGroundCafePart("cafe-east-shell", "plaster", [cafeMaxX - 0.11, cafeWallCenterY, cafeHost.z],
    [0.22, cafeWallHeight, cafeHost.depth]);
  addCommonGroundCafePart("cafe-north-shell", "plaster", [cafeHost.x, cafeWallCenterY, cafeMaxZ - 0.11],
    [cafeHost.width, cafeWallHeight, 0.22]);
  const cafeWindowLeft = cafeMinX + 0.42;
  const cafeWindowRight = cafeDoorLeft - 0.52;
  for (const [id, fromX, toX, y, height] of [
    ["cafe-front-west-return", cafeMinX, cafeWindowLeft, cafeWallCenterY, cafeWallHeight],
    ["cafe-front-window-sill", cafeWindowLeft, cafeWindowRight, cafeFloorY + 0.34, 0.68],
    ["cafe-front-window-header", cafeWindowLeft, cafeWindowRight, cafeFloorY + 2.93, 0.58],
    ["cafe-front-window-to-door", cafeWindowRight, cafeDoorLeft, cafeWallCenterY, cafeWallHeight],
    ["cafe-front-door-lintel", cafeDoorLeft, cafeDoorRight, cafeFloorY + 3.01, 0.42],
    ["cafe-front-east-return", cafeDoorRight, cafeMaxX, cafeWallCenterY, cafeWallHeight],
  ]) addCommonGroundCafePart(id, "plaster", [(fromX + toX) * 0.5, y, cafeSouthWallZ],
    [toX - fromX, height, 0.22]);
  const cafeGlassPanelWidth = (cafeWindowRight - cafeWindowLeft) / 3;
  for (let panel = 0; panel < 3; ++panel) {
    const panelLeft = cafeWindowLeft + panel * cafeGlassPanelWidth;
    const panelRight = panelLeft + cafeGlassPanelWidth;
    addCommonGroundCafeGlass(`cafe-front-dark-glass-${panel + 1}`,
      [(panelLeft + panelRight) * 0.5, cafeFloorY + 1.69, cafeMinZ - 0.015],
      [panelRight - panelLeft - 0.12, 1.78, 1], [0, Math.PI, 0]);
    addCommonGroundCafePart(`cafe-window-mullion-${panel + 1}`, "trim",
      [panelLeft, cafeFloorY + 1.70, cafeSouthWallZ - 0.03], [0.10, 2.62, 0.12]);
  }
  addCommonGroundCafePart("cafe-window-mullion-east", "trim",
    [cafeWindowRight, cafeFloorY + 1.70, cafeSouthWallZ - 0.03], [0.10, 2.62, 0.12]);
  addCommonGroundCafePart("cafe-door-west-jamb", "trim",
    [cafeDoorLeft, cafeFloorY + 1.46, cafeSouthWallZ - 0.03], [0.12, 2.92, 0.14]);
  addCommonGroundCafePart("cafe-door-east-jamb", "trim",
    [cafeDoorRight, cafeFloorY + 1.46, cafeSouthWallZ - 0.03], [0.12, 2.92, 0.14]);
  addCommonGroundCafePart("cafe-weathered-threshold", "concrete",
    [cafeEntranceX, cafeFloorY + 0.025, cafeMinZ - 0.42], [cafeDoorWidth + 0.52, 0.05, 1.06]);
  addCommonGroundCafePart("cafe-awning", "metal", [cafeHost.x, cafeFloorY + 3.06, cafeMinZ - 0.72],
    [cafeHost.width - 1.10, 0.15, 1.56], [-0.035, 0, 0]);
  addCommonGroundCafePart("cafe-name-board", "timber", [cafeHost.x - 1.20, cafeFloorY + 2.66, cafeMinZ - 0.22],
    [7.20, 0.46, 0.12]);

  addCommonGroundCafeBlocker("cafe-west-shell", "cafe-wall", cafeMinX + 0.11, cafeHost.z, 0.22, cafeHost.depth);
  addCommonGroundCafeBlocker("cafe-east-shell", "cafe-wall", cafeMaxX - 0.11, cafeHost.z, 0.22, cafeHost.depth);
  addCommonGroundCafeBlocker("cafe-north-shell", "cafe-wall", cafeHost.x, cafeMaxZ - 0.11, cafeHost.width, 0.22);
  addCommonGroundCafeBlocker("cafe-south-shell-west", "cafe-wall", (cafeMinX + cafeDoorLeft) * 0.5,
    cafeSouthWallZ, cafeDoorLeft - cafeMinX, 0.22);
  addCommonGroundCafeBlocker("cafe-south-shell-east", "cafe-wall", (cafeDoorRight + cafeMaxX) * 0.5,
    cafeSouthWallZ, cafeMaxX - cafeDoorRight, 0.22);

  // Back-of-house architecture. Staff can walk from the public entrance past
  // the counter through a 1.5 m door, then into kitchen, dish, stock, staff
  // nook and an actual toilet. All door gaps exceed Kai's full collision
  // diameter and are identical in visible geometry and blockers.
  const cafeStaffDoorX = cafeEntranceX;
  const cafeStaffDoorWidth = 1.50;
  const cafeKitchenDishDoorZ = cafeHost.z + 3.78;
  const cafeKitchenDishDoorWidth = 1.34;
  const cafeStockDoorX = cafeHost.x - 8.25;
  const cafeBreakDoorX = cafeHost.x + 0.15;
  const cafeToiletDoorX = cafeHost.x + 8.75;
  addCafeHorizontalWall("cafe-boh-wall", cafeBackOfHouseZ, cafeMinX + 0.11, cafeMaxX - 0.11,
    [{ center: cafeStaffDoorX, width: cafeStaffDoorWidth }]);
  addCafeVerticalWall("cafe-kitchen-dish-wall", cafeKitchenDishX, cafeBackOfHouseZ, cafeRearRoomsZ,
    [{ center: cafeKitchenDishDoorZ, width: cafeKitchenDishDoorWidth }]);
  addCafeHorizontalWall("cafe-rear-room-wall", cafeRearRoomsZ, cafeMinX + 0.11, cafeMaxX - 0.11, [
    { center: cafeStockDoorX, width: 1.26 },
    { center: cafeBreakDoorX, width: 1.30 },
    { center: cafeToiletDoorX, width: 1.08 },
  ]);
  addCafeVerticalWall("cafe-stock-divider", cafeStockDividerX, cafeRearRoomsZ, cafeMaxZ - 0.11);
  addCafeVerticalWall("cafe-toilet-divider", cafeToiletDividerX, cafeRearRoomsZ, cafeMaxZ - 0.11);

  // Customer room: a long upholstered wall seat, four two-person tables and
  // eight proper chairs. Chair dressing stays visual/movable while table and
  // banquette footprints use conservative physical collision.
  const cafeBanquetteX = cafeMinX + 0.49;
  const cafeBanquetteZ = cafeMinZ + 5.65;
  addCommonGroundCafePart("cafe-banquette-seat", "upholstery",
    [cafeBanquetteX, cafeFloorY + 0.46, cafeBanquetteZ], [0.74, 0.46, 7.70]);
  addCommonGroundCafePart("cafe-banquette-back", "upholstery",
    [cafeMinX + 0.20, cafeFloorY + 0.91, cafeBanquetteZ], [0.18, 0.90, 7.70]);
  const cafeTablePositions = [
    [cafeMinX + 3.15, cafeMinZ + 4.05],
    [cafeMinX + 7.65, cafeMinZ + 4.05],
    [cafeMinX + 3.15, cafeMinZ + 8.25],
    [cafeMinX + 7.65, cafeMinZ + 8.25],
  ];
  for (const [tableIndex, [tableX, tableZ]] of cafeTablePositions.entries()) {
    addCommonGroundCafePart(`cafe-table-${tableIndex + 1}-top`, "casework",
      [tableX, cafeFloorY + 0.73, tableZ], [1.42, 0.11, 0.90], [0, cafeTableYaw * (tableIndex % 2 ? -1 : 1), 0]);
    addCommonGroundCafePart(`cafe-table-${tableIndex + 1}-stem`, "pole",
      [tableX, cafeFloorY + 0.37, tableZ], [0.12, 0.68, 0.12]);
    for (const [chairIndex, direction] of [-1, 1].entries()) {
      const chairX = tableX + direction * cafeChairOffset;
      addCommonGroundCafePart(`cafe-table-${tableIndex + 1}-chair-${chairIndex + 1}-seat`, "upholstery",
        [chairX, cafeFloorY + 0.48, tableZ], [0.48, 0.12, 0.48]);
      addCommonGroundCafePart(`cafe-table-${tableIndex + 1}-chair-${chairIndex + 1}-back`, "upholstery",
        [chairX + direction * 0.22, cafeFloorY + 0.84, tableZ], [0.10, 0.68, 0.48]);
    }
    addCommonGroundCafeBlocker(`cafe-table-${tableIndex + 1}`, "cafe-fixture", tableX, tableZ, 1.48, 0.96, 0.86);
  }
  addCommonGroundCafeBlocker("cafe-banquette", "cafe-fixture", cafeBanquetteX, cafeBanquetteZ, 0.76, 7.70, 1.36);

  // Service counter: customer side, staff working face, point-of-sale and
  // espresso equipment are individually legible without emissive screens.
  const cafeCounterX = cafeHost.x - 0.30;
  // A full 1.32 m staff aisle separates the counter from the back-room wall;
  // this is intentionally wider than Kai's 0.76 m collision diameter.
  const cafeCounterZ = cafeBackOfHouseZ - 1.80;
  addCommonGroundCafePart("cafe-service-counter-base", "cabinetry",
    [cafeCounterX, cafeFloorY + 0.47, cafeCounterZ], [9.60, 0.86, 0.78]);
  addCommonGroundCafePart("cafe-service-counter-top", "concrete",
    [cafeCounterX, cafeFloorY + 0.94, cafeCounterZ], [9.84, 0.10, 0.96]);
  addCommonGroundCafeGlass("cafe-food-display-dark-glass",
    [cafeCounterX - 2.75, cafeFloorY + 1.28, cafeCounterZ - 0.18], [3.16, 0.54, 1], [0, Math.PI, 0]);
  addCommonGroundCafePart("cafe-pos-terminal", "metal",
    [cafeCounterX + 3.56, cafeFloorY + 1.28, cafeCounterZ - 0.02], [0.54, 0.54, 0.12], [0.08, 0, 0]);
  addCommonGroundCafePart("cafe-espresso-machine", "metal",
    [cafeCounterX + 0.35, cafeFloorY + 1.22, cafeCounterZ + 0.10], [1.32, 0.48, 0.46]);
  addCommonGroundCafePart("cafe-coffee-grinder", "casework",
    [cafeCounterX + 1.52, cafeFloorY + 1.30, cafeCounterZ + 0.08], [0.32, 0.64, 0.34]);
  addCommonGroundCafeBlocker("cafe-service-counter", "cafe-fixture", cafeCounterX, cafeCounterZ, 9.84, 0.96, 1.48);

  // Working kitchen and preparation island.
  const cafeKitchenRunX = cafeMinX + 0.49;
  const cafeKitchenRunZ = cafeHost.z + 2.18;
  addCommonGroundCafePart("cafe-kitchen-base-cabinets", "cabinetry",
    [cafeKitchenRunX, cafeFloorY + 0.47, cafeKitchenRunZ], [0.74, 0.86, 5.15]);
  addCommonGroundCafePart("cafe-kitchen-worktop", "concrete",
    [cafeKitchenRunX + 0.04, cafeFloorY + 0.93, cafeKitchenRunZ], [0.86, 0.10, 5.34]);
  addCommonGroundCafePart("cafe-kitchen-hob", "metal",
    [cafeKitchenRunX + 0.48, cafeFloorY + 0.995, cafeKitchenRunZ - 1.36], [0.06, 0.06, 0.72]);
  addCommonGroundCafePart("cafe-kitchen-oven", "metal",
    [cafeKitchenRunX + 0.46, cafeFloorY + 0.52, cafeKitchenRunZ - 1.36], [0.06, 0.72, 0.72]);
  addCommonGroundCafePart("cafe-kitchen-fridge", "metal",
    [cafeMinX + 0.56, cafeFloorY + 1.02, cafeBackOfHouseZ + 1.10], [0.94, 2.04, 0.90]);
  const cafePrepX = cafeHost.x - 4.15;
  const cafePrepZ = cafeHost.z + 2.25;
  addCommonGroundCafePart("cafe-prep-island-base", "cabinetry",
    [cafePrepX, cafeFloorY + 0.45, cafePrepZ], [4.35, 0.84, 0.90]);
  addCommonGroundCafePart("cafe-prep-island-worktop", "concrete",
    [cafePrepX, cafeFloorY + 0.91, cafePrepZ], [4.58, 0.10, 1.08]);
  addCommonGroundCafePart("cafe-prep-board", "timber",
    [cafePrepX - 0.65, cafeFloorY + 0.985, cafePrepZ], [1.12, 0.045, 0.62], [0, cafeTableYaw, 0]);
  addCommonGroundCafeBlocker("cafe-kitchen-run", "cafe-fixture", cafeKitchenRunX, cafeKitchenRunZ, 0.86, 5.34, 2.15);
  addCommonGroundCafeBlocker("cafe-kitchen-fridge", "cafe-fixture", cafeMinX + 0.56,
    cafeBackOfHouseZ + 1.10, 0.94, 0.90, 2.04);
  addCommonGroundCafeBlocker("cafe-prep-island", "cafe-fixture", cafePrepX, cafePrepZ, 4.58, 1.08, 1.0);

  // Dish return and sanitation area on the opposite wall.
  const cafeDishRunX = cafeMaxX - 0.49;
  const cafeDishRunZ = cafeHost.z + 2.16;
  addCommonGroundCafePart("cafe-dish-base-cabinets", "cabinetry",
    [cafeDishRunX, cafeFloorY + 0.47, cafeDishRunZ], [0.74, 0.86, 4.72]);
  addCommonGroundCafePart("cafe-dish-worktop", "concrete",
    [cafeDishRunX - 0.04, cafeFloorY + 0.93, cafeDishRunZ], [0.86, 0.10, 4.92]);
  addCommonGroundCafePart("cafe-double-sink", "plaster",
    [cafeDishRunX - 0.48, cafeFloorY + 0.995, cafeDishRunZ - 0.72], [0.06, 0.06, 1.26]);
  addCommonGroundCafePart("cafe-dishwasher", "metal",
    [cafeDishRunX - 0.48, cafeFloorY + 0.48, cafeDishRunZ + 1.30], [0.06, 0.80, 0.82]);
  addCommonGroundCafePart("cafe-dish-drying-rack", "trim",
    [cafeDishRunX - 0.52, cafeFloorY + 1.52, cafeDishRunZ - 0.45], [0.10, 0.80, 1.82]);
  addCommonGroundCafeBlocker("cafe-dish-run", "cafe-fixture", cafeDishRunX, cafeDishRunZ, 0.86, 4.92, 1.72);

  // Stock room, staff nook and toilet complete the workplace rather than
  // using abstract back-room triggers.
  const cafeStockShelfX = cafeMinX + 0.48;
  const cafeStockShelfZ = cafeRearRoomsZ + 3.35;
  for (let level = 0; level < 3; ++level) {
    addCommonGroundCafePart(`cafe-stock-shelf-${level + 1}`, "trim",
      [cafeStockShelfX, cafeFloorY + 0.38 + level * 0.69, cafeStockShelfZ + cafeShelfJitter],
      [0.72, 0.08, 4.25]);
  }
  for (let crate = 0; crate < 4; ++crate) {
    addCommonGroundCafePart(`cafe-stock-crate-${crate + 1}`, "casework",
      [cafeMinX + 1.10 + (crate % 2) * 1.08, cafeFloorY + 0.32,
        cafeRearRoomsZ + 1.32 + Math.floor(crate / 2) * 1.20], [0.76, 0.58, 0.72]);
  }
  addCommonGroundCafeBlocker("cafe-stock-shelves", "cafe-fixture", cafeStockShelfX,
    cafeStockShelfZ, 0.76, 4.35, 2.05);

  const cafeBreakX = cafeHost.x + 0.70;
  const cafeBreakZ = cafeMaxZ - 2.25;
  addCommonGroundCafePart("cafe-staff-bench-seat", "upholstery",
    [cafeBreakX, cafeFloorY + 0.46, cafeBreakZ], [3.20, 0.46, 0.86]);
  addCommonGroundCafePart("cafe-staff-bench-back", "upholstery",
    [cafeBreakX, cafeFloorY + 0.89, cafeBreakZ + 0.34], [3.20, 0.84, 0.18]);
  addCommonGroundCafePart("cafe-staff-table", "casework",
    [cafeBreakX, cafeFloorY + 0.70, cafeRearRoomsZ + 1.50], [1.38, 0.11, 0.82]);
  addCommonGroundCafePart("cafe-staff-lockers", "cabinetry",
    [cafeStockDividerX + 0.49, cafeFloorY + 1.04, cafeRearRoomsZ + 2.20], [0.72, 2.08, 2.30]);
  addCommonGroundCafeBlocker("cafe-staff-bench", "cafe-fixture", cafeBreakX, cafeBreakZ, 3.20, 0.92, 1.34);
  addCommonGroundCafeBlocker("cafe-staff-lockers", "cafe-fixture", cafeStockDividerX + 0.49,
    cafeRearRoomsZ + 2.20, 0.72, 2.30, 2.08);

  const cafeToiletX = cafeMaxX - 2.16;
  addCommonGroundCafePart("cafe-toilet-base", "plaster",
    [cafeToiletX, cafeFloorY + 0.31, cafeMaxZ - 1.52], [0.58, 0.50, 0.76]);
  addCommonGroundCafePart("cafe-toilet-cistern", "plaster",
    [cafeToiletX, cafeFloorY + 0.72, cafeMaxZ - 1.23], [0.56, 0.72, 0.24]);
  addCommonGroundCafePart("cafe-toilet-vanity", "cabinetry",
    [cafeMaxX - 0.49, cafeFloorY + 0.43, cafeRearRoomsZ + 2.10], [0.72, 0.80, 1.45]);
  addCommonGroundCafePart("cafe-toilet-basin", "plaster",
    [cafeMaxX - 0.54, cafeFloorY + 0.88, cafeRearRoomsZ + 2.10], [0.74, 0.10, 1.24]);
  addCommonGroundCafeBlocker("cafe-toilet", "cafe-fixture", cafeToiletX, cafeMaxZ - 1.40, 0.66, 1.08, 1.10);
  addCommonGroundCafeBlocker("cafe-toilet-vanity", "cafe-fixture", cafeMaxX - 0.49,
    cafeRearRoomsZ + 2.10, 0.72, 1.45, 0.98);

  // Resident housings make the single reallocated Open Doors practical read
  // as deliberate warm task lighting; no extra light or shader is created.
  for (const [index, [x, z]] of [
    [cafeCounterX, cafeCounterZ + 1.25],
    [cafePrepX, cafePrepZ],
    [cafeDishRunX - 1.65, cafeDishRunZ],
  ].entries()) addCommonGroundCafePart(`cafe-ceiling-practical-${index + 1}`, "plaster",
    [x, cafeFloorY + cafeHost.clearHeight - 0.16, z], [1.18, 0.05, 0.34]);

  const cafeHandoverPosition = [cafeCounterX + 5.62, cafeFloorY, cafeCounterZ - 0.86];
  const cafeTillPosition = [cafeCounterX + 3.55, cafeFloorY, cafeCounterZ + 0.92];
  const cafePrepPosition = [cafePrepX, cafeFloorY, cafePrepZ - 1.05];
  const cafeServePosition = [cafeCounterX, cafeFloorY, cafeCounterZ + 0.94];
  const cafeDishesPosition = [cafeDishRunX - 1.30, cafeFloorY, cafeDishRunZ - 0.72];
  const cafeStockPosition = [cafeMinX + 2.35, cafeFloorY, cafeStockShelfZ];
  const cafeBreakPosition = [cafeBreakX - 2.05, cafeFloorY, cafeBreakZ];
  const cafeKeeperPosition = cafeTillPosition;
  const cafeCustomerAnchors = {
    queue: [
      [cafeCounterX + 3.55, cafeFloorY, cafeCounterZ - 1.24],
      [cafeCounterX + 5.38, cafeFloorY, cafeCounterZ - 2.15],
      [cafeCounterX + 5.38, cafeFloorY, cafeCounterZ - 4.05],
    ],
    pickup: [cafeCounterX - 0.35, cafeFloorY, cafeCounterZ - 1.24],
    seating: [
      [cafeTablePositions[0][0], cafeFloorY, cafeTablePositions[0][1] - 1.18],
      [cafeTablePositions[1][0], cafeFloorY, cafeTablePositions[1][1] - 1.18],
      [cafeTablePositions[2][0], cafeFloorY, cafeTablePositions[2][1] + 1.18],
      [cafeTablePositions[3][0], cafeFloorY, cafeTablePositions[3][1] + 1.18],
    ],
    story: {
      leah: [cafeTablePositions[3][0] + 1.40, cafeFloorY, cafeTablePositions[3][1]],
      interaction: [cafeTablePositions[3][0] + 3.90, cafeFloorY, cafeTablePositions[3][1]],
    },
  };
  const cafeJobAnchors = {
    handover: cafeHandoverPosition,
    till: cafeTillPosition,
    prep: cafePrepPosition,
    serve: cafeServePosition,
    dishes: cafeDishesPosition,
    stock: cafeStockPosition,
    break: cafeBreakPosition,
  };
  const cafeFrontagePartIds = [
    "cafe-front-west-return", "cafe-front-window-sill", "cafe-front-window-header",
    "cafe-front-window-to-door", "cafe-front-door-lintel", "cafe-front-east-return",
    "cafe-front-dark-glass-1", "cafe-front-dark-glass-2", "cafe-front-dark-glass-3",
    "cafe-window-mullion-1", "cafe-window-mullion-2", "cafe-window-mullion-3",
    "cafe-window-mullion-east", "cafe-door-west-jamb", "cafe-door-east-jamb",
    "cafe-weathered-threshold", "cafe-awning", "cafe-name-board",
  ];
  const commonGroundCafe = deepFreeze({
    id: "common_ground_cafe",
    businessId: "common_ground_cafe",
    buildingId: "common-ground-cafe-building",
    label: "COMMON GROUND CAFE",
    address: "16 Common Ground Lane",
    districtId: cafeHost.districtId,
    hostBuildingRecordId: cafeHost.id,
    seed: commonGroundCafeSeed,
    bounds: {
      minX: cafeMinX,
      maxX: cafeMaxX,
      minZ: cafeMinZ,
      maxZ: cafeMaxZ,
      floorY: cafeFloorY,
      ceilingY: cafeFloorY + cafeHost.clearHeight,
    },
    entrance: {
      exterior: [cafeEntranceX, cafeFloorY, -16.5],
      threshold: [cafeEntranceX, cafeFloorY, cafeMinZ - 0.18],
      interior: [cafeEntranceX, cafeFloorY, cafeMinZ + 1.38],
      heading: 0,
      clearWidth: cafeDoorWidth,
      transition: "continuous-world",
      loading: false,
      teleport: false,
    },
    keeperAnchor: cafeKeeperPosition,
    zones: {
      dining: { id: "dining", label: "CUSTOMER DINING", position: [cafeHost.x - 0.2, cafeFloorY, cafeMinZ + 6.0], bounds: { minX: cafeMinX + 0.22, maxX: cafeMaxX - 0.22, minZ: cafeMinZ + 0.22, maxZ: cafeBackOfHouseZ - 0.08 } },
      service: { id: "service", label: "SERVICE COUNTER", position: [cafeCounterX + 5.45, cafeFloorY, cafeCounterZ + 0.95], bounds: { minX: cafeMinX + 0.22, maxX: cafeMaxX - 0.22, minZ: cafeCounterZ - 1.80, maxZ: cafeBackOfHouseZ - 0.08 } },
      kitchen: { id: "kitchen", label: "WORKING KITCHEN", position: [cafeKitchenDishX - 2.0, cafeFloorY, cafeBackOfHouseZ + 1.10], bounds: { minX: cafeMinX + 0.22, maxX: cafeKitchenDishX - 0.16, minZ: cafeBackOfHouseZ + 0.16, maxZ: cafeRearRoomsZ - 0.16 } },
      dishes: { id: "dishes", label: "DISH + SANITATION", position: [cafeKitchenDishX + 1.32, cafeFloorY, cafeBackOfHouseZ + 1.15], bounds: { minX: cafeKitchenDishX + 0.16, maxX: cafeMaxX - 0.22, minZ: cafeBackOfHouseZ + 0.16, maxZ: cafeRearRoomsZ - 0.16 } },
      stock: { id: "stock", label: "DRY + COLD STOCK", position: [cafeStockDoorX, cafeFloorY, cafeRearRoomsZ + 1.12], bounds: { minX: cafeMinX + 0.22, maxX: cafeStockDividerX - 0.16, minZ: cafeRearRoomsZ + 0.16, maxZ: cafeMaxZ - 0.22 } },
      staffNook: { id: "staff-nook", label: "STAFF NOOK", position: [cafeBreakDoorX, cafeFloorY, cafeRearRoomsZ + 1.12], bounds: { minX: cafeStockDividerX + 0.16, maxX: cafeToiletDividerX - 0.16, minZ: cafeRearRoomsZ + 0.16, maxZ: cafeMaxZ - 0.22 } },
      toilet: { id: "toilet", label: "ACCESSIBLE TOILET", position: [cafeToiletDoorX, cafeFloorY, cafeRearRoomsZ + 1.12], bounds: { minX: cafeToiletDividerX + 0.16, maxX: cafeMaxX - 0.22, minZ: cafeRearRoomsZ + 0.16, maxZ: cafeMaxZ - 0.22 } },
    },
    doorways: {
      exterior: { position: [cafeEntranceX, cafeFloorY, cafeSouthWallZ], clearWidth: cafeDoorWidth },
      backOfHouse: { position: [cafeStaffDoorX, cafeFloorY, cafeBackOfHouseZ], clearWidth: cafeStaffDoorWidth },
      kitchenDishes: { position: [cafeKitchenDishX, cafeFloorY, cafeKitchenDishDoorZ], clearWidth: cafeKitchenDishDoorWidth },
      stock: { position: [cafeStockDoorX, cafeFloorY, cafeRearRoomsZ], clearWidth: 1.26 },
      staffNook: { position: [cafeBreakDoorX, cafeFloorY, cafeRearRoomsZ], clearWidth: 1.30 },
      toilet: { position: [cafeToiletDoorX, cafeFloorY, cafeRearRoomsZ], clearWidth: 1.08 },
    },
    stations: {
      handover: { id: "cafe-handover", action: "clock_in", label: "SHIFT HANDOVER", position: cafeHandoverPosition, fixtureId: "cafe-service-counter-top" },
      till: { id: "cafe-till", action: "take_order", label: "TAKE AN ORDER", position: cafeTillPosition, fixtureId: "cafe-pos-terminal" },
      prep: { id: "cafe-prep", action: "prepare_order", label: "PREPARE ORDER", position: cafePrepPosition, fixtureId: "cafe-prep-island-worktop" },
      serve: { id: "cafe-serve", action: "serve_order", label: "SERVE ORDER", position: cafeServePosition, fixtureId: "cafe-espresso-machine" },
      dishes: { id: "cafe-dishes", action: "wash_dishes", label: "WASH + SANITISE", position: cafeDishesPosition, fixtureId: "cafe-double-sink" },
      stock: { id: "cafe-stock", action: "restock", label: "ROTATE STOCK", position: cafeStockPosition, fixtureId: "cafe-stock-shelf-2" },
      break: { id: "cafe-break", action: "take_break", label: "TAKE A BREAK", position: cafeBreakPosition, fixtureId: "cafe-staff-bench-seat" },
      customerTable1: { id: "cafe-customer-table-1", action: "sit", label: "WINDOW TABLE", position: cafeCustomerAnchors.seating[0], fixtureId: "cafe-table-1-top" },
      customerTable2: { id: "cafe-customer-table-2", action: "sit", label: "COMMUNITY TABLE", position: cafeCustomerAnchors.seating[3], fixtureId: "cafe-table-4-top" },
    },
    jobAnchors: cafeJobAnchors,
    customerAnchors: cafeCustomerAnchors,
    spawnPoints: {
      customers: [
        { id: "cafe-customer-1", position: cafeCustomerAnchors.seating[0], heading: 0 },
        { id: "cafe-customer-2", position: cafeCustomerAnchors.seating[1], heading: 0 },
        { id: "cafe-customer-3", position: cafeCustomerAnchors.queue[0], heading: Math.PI },
        { id: "cafe-customer-4", position: cafeCustomerAnchors.queue[1], heading: Math.PI },
      ],
      staff: [
        { id: "cafe-staff-manager", role: "manager", position: cafeKeeperPosition, heading: Math.PI },
        { id: "cafe-staff-barista", role: "barista", position: cafeServePosition, heading: Math.PI },
        { id: "cafe-staff-kitchen", role: "kitchen", position: cafePrepPosition, heading: 0 },
      ],
    },
    navigationNodes: [
      [cafeEntranceX, cafeFloorY, -16.5],
      [cafeEntranceX, cafeFloorY, cafeMinZ - 0.18],
      [cafeEntranceX, cafeFloorY, cafeMinZ + 1.38],
      [cafeCounterX + 5.45, cafeFloorY, cafeCounterZ - 1.85],
      [cafeStaffDoorX, cafeFloorY, cafeBackOfHouseZ + 0.72],
      [cafeKitchenDishX, cafeFloorY, cafeKitchenDishDoorZ],
      [cafeStockDoorX, cafeFloorY, cafeRearRoomsZ + 0.72],
      [cafeBreakDoorX, cafeFloorY, cafeRearRoomsZ + 0.72],
      [cafeToiletDoorX, cafeFloorY, cafeRearRoomsZ + 0.72],
    ],
    variant: {
      cabinetStyle: cafeCabinetStyle,
      seatStyle: cafeSeatStyle,
      tableYaw: cafeTableYaw,
      chairOffset: cafeChairOffset,
      shelfJitter: cafeShelfJitter,
    },
    glass: {
      kind: "dark-neutral-ordinary-glazing",
      panels: commonGroundCafeGlassTransforms.length,
      emissive: false,
      neon: false,
    },
    lighting: {
      kind: "bounded-warm-hospitality-practical",
      position: [cafeHost.x - 0.30, cafeFloorY + 2.68, cafeHost.z + 0.40],
      color: 0xffd1a0,
      intensity: 46,
      range: 18,
      reallocates: "existing-open-doors-business-practical",
    },
    renderParts: commonGroundCafeParts,
    frontagePartIds: cafeFrontagePartIds,
    collisionIds: commonGroundCafeBlockerIds,
    renderBudget: {
      geometriesAdded: 0,
      materialsAdded: 0,
      instancedBatchesAdded: 0,
      lightsAdded: 0,
    },
    stats: {
      rooms: 7,
      doorways: 6,
      stations: 9,
      customerSpawns: 4,
      staffSpawns: 3,
      renderInstances: commonGroundCafeParts.length,
      frontageRenderInstances: cafeFrontagePartIds.length,
      glassPanels: commonGroundCafeGlassTransforms.length,
      collisionVolumes: commonGroundCafeBlockerIds.length,
      practicalLights: 1,
      emissiveMaterials: 0,
    },
  });

  // Mina's Market Kitchen turns the occupied brick ground floor behind North
  // Market's four long-standing stalls into a real neighbourhood shop. The
  // central 2.28 m gap between stalls two and three remains the public route:
  // pavement, arcade, rear apron, threshold and vestibule are one continuous
  // collision field, with no scene swap or teleport. The outdoor counters stay
  // intact as Mina's produce/takeaway frontage while the grocery, deli and
  // working rooms occupy the tower volume opened by addBuilding above.
  if (!minaMarketHost) throw new Error("Mina's Market Kitchen host building was not generated.");
  const minaMarketSeed = (resolvedSeed ^ 0x4d494e41) >>> 0;
  const minaMarketRandom = mulberry32(minaMarketSeed);
  const minaMarketParts = [];
  const minaMarketGlassTransforms = [];
  const minaMarketBlockerIds = [];
  const marketHost = minaMarketHost;
  const marketFloorY = SIDEWALK_TOP;
  const marketMinX = marketHost.x - marketHost.width * 0.5;
  const marketMaxX = marketHost.x + marketHost.width * 0.5;
  const marketMinZ = marketHost.z - marketHost.depth * 0.5;
  const marketMaxZ = marketHost.z + marketHost.depth * 0.5;
  const marketEntranceX = -144;
  const marketDoorWidth = 1.72;
  const marketDoorLeft = marketEntranceX - marketDoorWidth * 0.5;
  const marketDoorRight = marketEntranceX + marketDoorWidth * 0.5;
  const marketWallHeight = 3.22;
  const marketWallCenterY = marketFloorY + marketWallHeight * 0.5;
  const marketSouthWallZ = marketMinZ + 0.11;
  const marketBackOfHouseZ = marketHost.z - 0.27;
  const marketRearRoomsZ = marketHost.z + 4.63;
  const marketKitchenWashX = marketHost.x + 3.65;
  const marketStockDividerX = marketHost.x - 2.80;
  const marketToiletDividerX = marketHost.x + 6.50;
  const marketCabinetStyle = [2, 3, 5][Math.floor(minaMarketRandom() * 3)];
  const marketAccentStyle = [0, 1, 2][Math.floor(minaMarketRandom() * 3)];
  const marketAisleOffset = (minaMarketRandom() - 0.5) * 0.12;
  const marketCrateYaw = (minaMarketRandom() - 0.5) * 0.16;
  const marketBasketSpread = 0.16 + minaMarketRandom() * 0.04;

  const minaMarketPools = {
    plaster: { transforms: buildingTransforms[5], batch: "Instanced city buildings style 6" },
    brick: { transforms: buildingTransforms[3], batch: "Instanced city buildings style 4" },
    accent: { transforms: buildingTransforms[marketAccentStyle], batch: `Instanced city buildings style ${marketAccentStyle + 1}` },
    cabinetry: { transforms: buildingTransforms[marketCabinetStyle], batch: `Instanced city buildings style ${marketCabinetStyle + 1}` },
    concrete: { transforms: podiumTransforms, batch: "Instanced ground-floor podiums" },
    trim: { transforms: facadeRibTransforms, batch: "Instanced facade corner ribs" },
    metal: { transforms: balconyTransforms, batch: "Instanced apartment balconies" },
    casework: { transforms: rooftopTransforms, batch: "Instanced rooftop mechanical housings" },
    pole: { transforms: antennaTransforms, batch: "Instanced rooftop antennas" },
  };
  function addMinaMarketPart(id, poolName, position, scale, rotation = [0, 0, 0]) {
    const pool = minaMarketPools[poolName];
    const item = transform(position, scale, rotation);
    pool.transforms.push(item);
    minaMarketParts.push({
      id,
      pool: poolName,
      batch: pool.batch,
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addMinaMarketGlass(id, position, scale, rotation = [0, 0, 0]) {
    const item = transform(position, scale, rotation);
    minaMarketGlassTransforms.push(item);
    minaMarketParts.push({
      id,
      pool: "glass",
      batch: "Pulse Street bus shelter glass",
      position: [...position],
      scale: [...scale],
      rotation: [...rotation],
    });
  }
  function addMinaMarketBlocker(id, kind, x, z, width, depth, height = marketWallHeight) {
    addBlocker(id, kind, x, z, width, depth, height, marketFloorY);
    minaMarketBlockerIds.push(id);
  }
  function addMarketHorizontalWall(prefix, z, fromX, toX, doorways = []) {
    let cursor = fromX;
    const sorted = [...doorways].sort((a, b) => a.center - b.center);
    for (const opening of sorted) {
      const left = clamp(opening.center - opening.width * 0.5, fromX, toX);
      const right = clamp(opening.center + opening.width * 0.5, fromX, toX);
      if (left > cursor + 0.01) {
        const id = `${prefix}-${minaMarketBlockerIds.length + 1}`;
        addMinaMarketPart(id, "plaster", [(cursor + left) * 0.5, marketWallCenterY, z],
          [left - cursor, marketWallHeight, 0.16]);
        addMinaMarketBlocker(id, "market-partition", (cursor + left) * 0.5, z, left - cursor, 0.16);
      }
      cursor = Math.max(cursor, right);
    }
    if (cursor < toX - 0.01) {
      const id = `${prefix}-${minaMarketBlockerIds.length + 1}`;
      addMinaMarketPart(id, "plaster", [(cursor + toX) * 0.5, marketWallCenterY, z],
        [toX - cursor, marketWallHeight, 0.16]);
      addMinaMarketBlocker(id, "market-partition", (cursor + toX) * 0.5, z, toX - cursor, 0.16);
    }
  }
  function addMarketVerticalWall(prefix, x, fromZ, toZ, doorways = []) {
    let cursor = fromZ;
    const sorted = [...doorways].sort((a, b) => a.center - b.center);
    for (const opening of sorted) {
      const near = clamp(opening.center - opening.width * 0.5, fromZ, toZ);
      const far = clamp(opening.center + opening.width * 0.5, fromZ, toZ);
      if (near > cursor + 0.01) {
        const id = `${prefix}-${minaMarketBlockerIds.length + 1}`;
        addMinaMarketPart(id, "plaster", [x, marketWallCenterY, (cursor + near) * 0.5],
          [0.16, marketWallHeight, near - cursor]);
        addMinaMarketBlocker(id, "market-partition", x, (cursor + near) * 0.5, 0.16, near - cursor);
      }
      cursor = Math.max(cursor, far);
    }
    if (cursor < toZ - 0.01) {
      const id = `${prefix}-${minaMarketBlockerIds.length + 1}`;
      addMinaMarketPart(id, "plaster", [x, marketWallCenterY, (cursor + toZ) * 0.5],
        [0.16, marketWallHeight, toZ - cursor]);
      addMinaMarketBlocker(id, "market-partition", x, (cursor + toZ) * 0.5, 0.16, toZ - cursor);
    }
  }

  // Complete shell and ordinary glazed market frontage. The facade remains
  // warm brick, neutral glass and painted metal rather than neon signage.
  addMinaMarketPart("mina-market-floor", "concrete",
    [marketHost.x, marketFloorY + 0.055, marketHost.z],
    [marketHost.width - 0.34, 0.11, marketHost.depth - 0.34]);
  addMinaMarketPart("mina-market-ceiling", "plaster",
    [marketHost.x, marketFloorY + marketHost.clearHeight - 0.07, marketHost.z],
    [marketHost.width - 0.28, 0.14, marketHost.depth - 0.28]);
  addMinaMarketPart("mina-market-west-shell", "brick",
    [marketMinX + 0.11, marketWallCenterY, marketHost.z], [0.22, marketWallHeight, marketHost.depth]);
  addMinaMarketPart("mina-market-east-shell", "brick",
    [marketMaxX - 0.11, marketWallCenterY, marketHost.z], [0.22, marketWallHeight, marketHost.depth]);
  addMinaMarketPart("mina-market-north-shell", "brick",
    [marketHost.x, marketWallCenterY, marketMaxZ - 0.11], [marketHost.width, marketWallHeight, 0.22]);
  addMinaMarketBlocker("mina-market-west-shell", "market-wall", marketMinX + 0.11,
    marketHost.z, 0.22, marketHost.depth);
  addMinaMarketBlocker("mina-market-east-shell", "market-wall", marketMaxX - 0.11,
    marketHost.z, 0.22, marketHost.depth);
  addMinaMarketBlocker("mina-market-north-shell", "market-wall", marketHost.x,
    marketMaxZ - 0.11, marketHost.width, 0.22);
  addMinaMarketBlocker("mina-market-south-shell-west", "market-wall",
    (marketMinX + marketDoorLeft) * 0.5, marketSouthWallZ, marketDoorLeft - marketMinX, 0.22);
  addMinaMarketBlocker("mina-market-south-shell-east", "market-wall",
    (marketDoorRight + marketMaxX) * 0.5, marketSouthWallZ, marketMaxX - marketDoorRight, 0.22);

  for (const [side, fromX, toX] of [
    ["west", marketMinX, marketDoorLeft],
    ["east", marketDoorRight, marketMaxX],
  ]) {
    addMinaMarketPart(`mina-market-front-${side}-sill`, "brick",
      [(fromX + toX) * 0.5, marketFloorY + 0.31, marketSouthWallZ],
      [toX - fromX, 0.62, 0.22]);
    addMinaMarketPart(`mina-market-front-${side}-header`, "brick",
      [(fromX + toX) * 0.5, marketFloorY + 2.96, marketSouthWallZ],
      [toX - fromX, 0.52, 0.22]);
    const panelCount = 3;
    const panelWidth = (toX - fromX) / panelCount;
    for (let panel = 0; panel < panelCount; ++panel) {
      const left = fromX + panel * panelWidth;
      const right = left + panelWidth;
      addMinaMarketGlass(`mina-market-front-${side}-glass-${panel + 1}`,
        [(left + right) * 0.5, marketFloorY + 1.64, marketMinZ - 0.015],
        [Math.max(0.30, right - left - 0.12), 2.02, 1], [0, Math.PI, 0]);
      if (panel > 0) addMinaMarketPart(`mina-market-front-${side}-mullion-${panel}`,
        "trim", [left, marketFloorY + 1.65, marketSouthWallZ - 0.03], [0.10, 2.34, 0.12]);
    }
  }
  addMinaMarketPart("mina-market-door-west-jamb", "trim",
    [marketDoorLeft, marketFloorY + 1.46, marketSouthWallZ - 0.03], [0.12, 2.92, 0.14]);
  addMinaMarketPart("mina-market-door-east-jamb", "trim",
    [marketDoorRight, marketFloorY + 1.46, marketSouthWallZ - 0.03], [0.12, 2.92, 0.14]);
  addMinaMarketPart("mina-market-door-lintel", "brick",
    [marketEntranceX, marketFloorY + 3.01, marketSouthWallZ], [marketDoorWidth, 0.42, 0.22]);
  addMinaMarketPart("mina-market-weathered-threshold", "concrete",
    [marketEntranceX, marketFloorY + 0.025, marketMinZ - 0.42], [marketDoorWidth + 0.52, 0.05, 1.06]);
  addMinaMarketPart("mina-market-awning", "metal",
    [marketHost.x, marketFloorY + 3.06, marketMinZ - 0.72],
    [marketHost.width - 1.10, 0.15, 1.56], [-0.035, 0, 0]);
  addMinaMarketPart("mina-market-name-board", "brick",
    [marketHost.x, marketFloorY + 2.66, marketMinZ - 0.22], [8.40, 0.48, 0.12]);

  // A glazed wind lobby protects the grocery floor without narrowing the
  // public route. Its 2.68 m internal opening is wider than the street door.
  const marketVestibuleLeft = marketEntranceX - 1.46;
  const marketVestibuleRight = marketEntranceX + 1.46;
  const marketVestibuleEndZ = marketMinZ + 3.16;
  for (const [side, x] of [["west", marketVestibuleLeft], ["east", marketVestibuleRight]]) {
    addMinaMarketGlass(`mina-market-vestibule-${side}-glass`,
      [x, marketFloorY + 1.54, marketMinZ + 1.68], [3.02, 2.32, 1], [0, Math.PI * 0.5, 0]);
    addMinaMarketPart(`mina-market-vestibule-${side}-rail`, "trim",
      [x, marketFloorY + 1.54, marketMinZ + 1.68], [0.10, 2.46, 3.12]);
    addMinaMarketBlocker(`mina-market-vestibule-${side}`, "market-partition",
      x, marketMinZ + 1.68, 0.10, 3.12);
  }
  addMinaMarketPart("mina-market-entry-mat", "accent",
    [marketEntranceX, marketFloorY + 0.064, marketMinZ + 1.15], [1.46, 0.018, 1.72]);

  // Back-of-house partitions use the same dimensions for visible surfaces and
  // AABB collision. Every aperture is at least 1.08 m, including the WC.
  const marketStaffDoorX = marketEntranceX;
  const marketStaffDoorWidth = 1.56;
  const marketKitchenWashDoorZ = marketHost.z + 2.10;
  const marketKitchenWashDoorWidth = 1.34;
  const marketStockDoorX = marketHost.x - 8.05;
  const marketBreakDoorX = marketHost.x + 0.25;
  const marketToiletDoorX = marketHost.x + 9.20;
  addMarketHorizontalWall("mina-market-boh-wall", marketBackOfHouseZ,
    marketMinX + 0.11, marketMaxX - 0.11,
    [{ center: marketStaffDoorX, width: marketStaffDoorWidth }]);
  addMarketVerticalWall("mina-market-kitchen-wash-wall", marketKitchenWashX,
    marketBackOfHouseZ, marketRearRoomsZ,
    [{ center: marketKitchenWashDoorZ, width: marketKitchenWashDoorWidth }]);
  addMarketHorizontalWall("mina-market-rear-room-wall", marketRearRoomsZ,
    marketMinX + 0.11, marketMaxX - 0.11, [
      { center: marketStockDoorX, width: 1.28 },
      { center: marketBreakDoorX, width: 1.22 },
      { center: marketToiletDoorX, width: 1.08 },
    ]);
  addMarketVerticalWall("mina-market-stock-divider", marketStockDividerX,
    marketRearRoomsZ, marketMaxZ - 0.11);
  addMarketVerticalWall("mina-market-toilet-divider", marketToiletDividerX,
    marketRearRoomsZ, marketMaxZ - 0.11);

  // Produce wall: four low angled bins, a readable scale and stacked hand
  // baskets. Only the consolidated footprints collide, leaving a 1.45 m aisle.
  const marketProduceX = marketMinX + 0.72;
  for (let bin = 0; bin < 4; ++bin) {
    const z = marketMinZ + 3.90 + bin * 1.45 + marketAisleOffset;
    addMinaMarketPart(`mina-market-produce-bin-${bin + 1}-base`, "cabinetry",
      [marketProduceX, marketFloorY + 0.38, z], [1.04, 0.70, 1.16]);
    addMinaMarketPart(`mina-market-produce-bin-${bin + 1}-tray`, "accent",
      [marketProduceX + 0.20, marketFloorY + 0.82, z], [0.82, 0.14, 1.04], [0, 0, -0.12]);
  }
  addMinaMarketPart("mina-market-produce-scale-base", "casework",
    [marketMinX + 2.05, marketFloorY + 0.52, marketMinZ + 5.86], [0.72, 1.02, 0.62]);
  addMinaMarketPart("mina-market-produce-scale-head", "metal",
    [marketMinX + 2.05, marketFloorY + 1.24, marketMinZ + 5.86], [0.58, 0.36, 0.18]);
  addMinaMarketBlocker("mina-market-produce-wall", "market-fixture", marketProduceX,
    marketMinZ + 6.08 + marketAisleOffset, 1.10, 5.72, 1.02);
  addMinaMarketBlocker("mina-market-produce-scale", "market-fixture", marketMinX + 2.05,
    marketMinZ + 5.86, 0.72, 0.62, 1.42);

  const marketBasketX = marketVestibuleLeft - 0.72;
  const marketBasketZ = marketMinZ + 1.22;
  addMinaMarketPart("mina-market-basket-corral", "trim",
    [marketBasketX, marketFloorY + 0.42, marketBasketZ], [1.12, 0.82, 1.18]);
  for (let basket = 0; basket < 5; ++basket) addMinaMarketPart(`mina-market-basket-${basket + 1}`,
    "accent", [marketBasketX, marketFloorY + 0.20 + basket * marketBasketSpread,
      marketBasketZ], [0.82 - basket * 0.035, 0.12, 0.72 - basket * 0.025]);
  addMinaMarketBlocker("mina-market-basket-corral", "market-fixture",
    marketBasketX, marketBasketZ, 1.12, 1.18, 0.96);

  // Two stocked gondolas make a legible grocery floor. Shelves, end caps and
  // small product blocks are detailed separately while collision remains one
  // conservative footprint per aisle.
  const marketGondolaXs = [marketMinX + 5.45, marketMinX + 9.05];
  const marketGondolaZ = marketMinZ + 7.05;
  for (const [aisle, x] of marketGondolaXs.entries()) {
    addMinaMarketPart(`mina-market-gondola-${aisle + 1}-base`, "cabinetry",
      [x, marketFloorY + 0.13, marketGondolaZ], [1.22, 0.24, 4.82]);
    addMinaMarketPart(`mina-market-gondola-${aisle + 1}-spine`, "trim",
      [x, marketFloorY + 0.92, marketGondolaZ], [0.10, 1.62, 4.70]);
    for (let shelf = 0; shelf < 3; ++shelf) {
      const y = marketFloorY + 0.45 + shelf * 0.53;
      addMinaMarketPart(`mina-market-gondola-${aisle + 1}-shelf-${shelf + 1}`, "metal",
        [x, y, marketGondolaZ], [1.34, 0.08, 4.72]);
      for (const side of [-1, 1]) addMinaMarketPart(
        `mina-market-gondola-${aisle + 1}-goods-${shelf + 1}-${side < 0 ? "west" : "east"}`,
        aisle === 0 ? "accent" : "casework",
        [x + side * 0.40, y + 0.18, marketGondolaZ + (shelf - 1) * 0.10],
        [0.34, 0.30, 3.92]);
    }
    for (const [end, z] of [["south", marketGondolaZ - 2.42], ["north", marketGondolaZ + 2.42]]) {
      addMinaMarketPart(`mina-market-gondola-${aisle + 1}-${end}-cap`, "trim",
        [x, marketFloorY + 0.90, z], [1.28, 1.58, 0.10]);
    }
    addMinaMarketBlocker(`mina-market-gondola-${aisle + 1}`, "market-fixture",
      x, marketGondolaZ, 1.36, 4.88, 1.82);
  }

  // Refrigerated groceries and a compact customer bench occupy the east wall.
  const marketColdCaseX = marketMaxX - 0.58;
  const marketColdCaseZ = marketMinZ + 5.42;
  addMinaMarketPart("mina-market-cold-case-base", "metal",
    [marketColdCaseX, marketFloorY + 0.92, marketColdCaseZ], [0.92, 1.84, 4.30]);
  for (let door = 0; door < 3; ++door) addMinaMarketGlass(`mina-market-cold-case-door-${door + 1}`,
    [marketColdCaseX - 0.48, marketFloorY + 1.16,
      marketColdCaseZ - 1.36 + door * 1.36], [1.18, 1.24, 1], [0, -Math.PI * 0.5, 0]);
  addMinaMarketPart("mina-market-cold-case-header", "trim",
    [marketColdCaseX - 0.50, marketFloorY + 1.91, marketColdCaseZ], [0.12, 0.18, 4.36]);
  addMinaMarketBlocker("mina-market-cold-case", "market-fixture",
    marketColdCaseX, marketColdCaseZ, 0.96, 4.34, 2.02);
  const marketCustomerBenchX = marketMaxX - 0.66;
  const marketCustomerBenchZ = marketMinZ + 1.62;
  addMinaMarketPart("mina-market-customer-bench-seat", "accent",
    [marketCustomerBenchX, marketFloorY + 0.46, marketCustomerBenchZ], [0.82, 0.46, 2.78]);
  addMinaMarketPart("mina-market-customer-bench-back", "accent",
    [marketMaxX - 0.24, marketFloorY + 0.90, marketCustomerBenchZ], [0.18, 0.86, 2.78]);
  addMinaMarketBlocker("mina-market-customer-bench", "market-fixture",
    marketCustomerBenchX, marketCustomerBenchZ, 0.86, 2.82, 1.36);

  // Deli and checkout share one long staffed counter but retain separate
  // customer stations. Groceries are packed at the east end; hot food is
  // ordered at the west display, so neither transaction masquerades as the
  // other in the life-sim contract.
  const marketCounterX = marketHost.x + 7.70;
  const marketCounterZ = marketBackOfHouseZ - 1.52;
  addMinaMarketPart("mina-market-service-counter-base", "cabinetry",
    [marketCounterX, marketFloorY + 0.47, marketCounterZ], [7.65, 0.86, 0.82]);
  addMinaMarketPart("mina-market-service-counter-top", "concrete",
    [marketCounterX, marketFloorY + 0.94, marketCounterZ], [7.88, 0.10, 1.00]);
  addMinaMarketGlass("mina-market-deli-display-glass",
    [marketCounterX - 1.80, marketFloorY + 1.30, marketCounterZ - 0.20],
    [3.12, 0.58, 1], [0, Math.PI, 0]);
  addMinaMarketPart("mina-market-hot-hold", "metal",
    [marketCounterX - 1.72, marketFloorY + 1.20, marketCounterZ + 0.10], [2.68, 0.42, 0.46]);
  addMinaMarketPart("mina-market-pos-terminal", "metal",
    [marketCounterX + 2.40, marketFloorY + 1.28, marketCounterZ - 0.02], [0.54, 0.54, 0.12], [0.08, 0, 0]);
  addMinaMarketPart("mina-market-card-reader", "casework",
    [marketCounterX + 2.92, marketFloorY + 1.10, marketCounterZ - 0.40], [0.24, 0.28, 0.18], [-0.12, 0, 0]);
  addMinaMarketPart("mina-market-packing-shelf", "metal",
    [marketCounterX + 3.32, marketFloorY + 0.72, marketCounterZ - 1.02], [1.24, 0.12, 1.14]);
  for (let bag = 0; bag < 3; ++bag) addMinaMarketPart(`mina-market-paper-bag-${bag + 1}`, "accent",
    [marketCounterX + 3.04 + bag * 0.28, marketFloorY + 0.98,
      marketCounterZ - 1.02], [0.22, 0.42 + bag * 0.05, 0.28]);
  addMinaMarketBlocker("mina-market-service-counter", "market-fixture",
    marketCounterX, marketCounterZ, 7.90, 1.00, 1.52);
  addMinaMarketBlocker("mina-market-packing-shelf", "market-fixture",
    marketCounterX + 3.32, marketCounterZ - 1.02, 1.24, 1.14, 0.90);

  // Working prep kitchen with wall run, hob, hood, upright fridge and central
  // island. The central staff spine from the public door remains clear.
  const marketKitchenRunX = marketMinX + 0.52;
  const marketKitchenRunZ = marketHost.z + 2.08;
  addMinaMarketPart("mina-market-kitchen-base-cabinets", "cabinetry",
    [marketKitchenRunX, marketFloorY + 0.47, marketKitchenRunZ], [0.78, 0.86, 3.58]);
  addMinaMarketPart("mina-market-kitchen-worktop", "concrete",
    [marketKitchenRunX + 0.04, marketFloorY + 0.93, marketKitchenRunZ], [0.90, 0.10, 3.76]);
  addMinaMarketPart("mina-market-kitchen-hob", "metal",
    [marketKitchenRunX + 0.50, marketFloorY + 0.995, marketKitchenRunZ - 0.75], [0.06, 0.06, 0.82]);
  addMinaMarketPart("mina-market-kitchen-oven", "metal",
    [marketKitchenRunX + 0.48, marketFloorY + 0.52, marketKitchenRunZ - 0.75], [0.06, 0.72, 0.82]);
  addMinaMarketPart("mina-market-kitchen-hood", "metal",
    [marketKitchenRunX + 0.42, marketFloorY + 2.18, marketKitchenRunZ - 0.75], [0.72, 0.46, 1.24]);
  addMinaMarketPart("mina-market-kitchen-fridge", "metal",
    [marketMinX + 0.60, marketFloorY + 1.02, marketBackOfHouseZ + 0.86], [1.02, 2.04, 0.94]);
  const marketPrepX = marketHost.x - 6.10;
  const marketPrepZ = marketHost.z + 2.18;
  addMinaMarketPart("mina-market-prep-island-base", "cabinetry",
    [marketPrepX, marketFloorY + 0.45, marketPrepZ], [4.00, 0.84, 0.92]);
  addMinaMarketPart("mina-market-prep-island-worktop", "concrete",
    [marketPrepX, marketFloorY + 0.91, marketPrepZ], [4.24, 0.10, 1.10]);
  addMinaMarketPart("mina-market-prep-board", "brick",
    [marketPrepX - 0.62, marketFloorY + 0.985, marketPrepZ], [1.18, 0.045, 0.64], [0, marketCrateYaw, 0]);
  addMinaMarketBlocker("mina-market-kitchen-run", "market-fixture",
    marketKitchenRunX, marketKitchenRunZ, 0.92, 3.82, 2.42);
  addMinaMarketBlocker("mina-market-kitchen-fridge", "market-fixture",
    marketMinX + 0.60, marketBackOfHouseZ + 0.86, 1.02, 0.94, 2.04);
  addMinaMarketBlocker("mina-market-prep-island", "market-fixture",
    marketPrepX, marketPrepZ, 4.28, 1.12, 1.02);

  // Separate wash-up room keeps dirty return, sink and drying rack out of the
  // food-prep circulation line.
  const marketDishRunX = marketMaxX - 0.52;
  const marketDishRunZ = marketHost.z + 2.18;
  addMinaMarketPart("mina-market-dish-base-cabinets", "cabinetry",
    [marketDishRunX, marketFloorY + 0.47, marketDishRunZ], [0.78, 0.86, 3.58]);
  addMinaMarketPart("mina-market-dish-worktop", "concrete",
    [marketDishRunX - 0.04, marketFloorY + 0.93, marketDishRunZ], [0.90, 0.10, 3.76]);
  addMinaMarketPart("mina-market-double-sink", "plaster",
    [marketDishRunX - 0.50, marketFloorY + 0.995, marketDishRunZ - 0.70], [0.06, 0.06, 1.34]);
  addMinaMarketPart("mina-market-dishwasher", "metal",
    [marketDishRunX - 0.49, marketFloorY + 0.48, marketDishRunZ + 0.95], [0.06, 0.80, 0.84]);
  addMinaMarketPart("mina-market-drying-rack", "trim",
    [marketDishRunX - 0.54, marketFloorY + 1.54, marketDishRunZ - 0.42], [0.10, 0.82, 1.92]);
  addMinaMarketBlocker("mina-market-dish-run", "market-fixture",
    marketDishRunX, marketDishRunZ, 0.92, 3.82, 1.78);

  // Cold/dry receiving stock: tall shelving, cold cabinet, delivery crates
  // and a proper trolley all remain physically legible and navigable.
  const marketStockShelfX = marketMinX + 0.52;
  const marketStockShelfZ = marketRearRoomsZ + 2.62;
  for (let level = 0; level < 3; ++level) addMinaMarketPart(`mina-market-stock-shelf-${level + 1}`,
    "trim", [marketStockShelfX, marketFloorY + 0.42 + level * 0.68, marketStockShelfZ],
    [0.78, 0.08, 3.86]);
  addMinaMarketPart("mina-market-stock-cold-cabinet", "metal",
    [marketHost.x - 6.20, marketFloorY + 1.03, marketMaxZ - 0.55], [4.22, 2.06, 0.86]);
  for (let crate = 0; crate < 6; ++crate) addMinaMarketPart(`mina-market-stock-crate-${crate + 1}`,
    crate % 2 ? "casework" : "accent",
    [marketMinX + 2.05 + (crate % 3) * 1.10, marketFloorY + 0.31,
      marketRearRoomsZ + 0.90 + Math.floor(crate / 3) * 1.05],
    [0.78, 0.58, 0.74], [0, marketCrateYaw * (crate % 2 ? -1 : 1), 0]);
  const marketTrolleyX = marketHost.x - 4.25;
  const marketTrolleyZ = marketRearRoomsZ + 1.25;
  addMinaMarketPart("mina-market-delivery-trolley-deck", "metal",
    [marketTrolleyX, marketFloorY + 0.30, marketTrolleyZ], [1.52, 0.12, 0.86]);
  addMinaMarketPart("mina-market-delivery-trolley-handle", "trim",
    [marketTrolleyX + 0.68, marketFloorY + 0.83, marketTrolleyZ], [0.10, 1.02, 0.78]);
  for (const [wheel, x, z] of [
    [1, marketTrolleyX - 0.56, marketTrolleyZ - 0.29],
    [2, marketTrolleyX - 0.56, marketTrolleyZ + 0.29],
    [3, marketTrolleyX + 0.56, marketTrolleyZ - 0.29],
    [4, marketTrolleyX + 0.56, marketTrolleyZ + 0.29],
  ]) addMinaMarketPart(`mina-market-delivery-trolley-wheel-${wheel}`, "pole",
    [x, marketFloorY + 0.13, z], [0.18, 0.18, 0.18], [Math.PI * 0.5, 0, 0]);
  addMinaMarketBlocker("mina-market-stock-shelves", "market-fixture",
    marketStockShelfX, marketStockShelfZ, 0.82, 3.94, 2.05);
  addMinaMarketBlocker("mina-market-stock-cold-cabinet", "market-fixture",
    marketHost.x - 6.20, marketMaxZ - 0.55, 4.24, 0.90, 2.08);
  addMinaMarketBlocker("mina-market-delivery-trolley", "market-fixture",
    marketTrolleyX, marketTrolleyZ, 1.56, 0.90, 1.34);

  // Staff nook and accessible WC complete the occupied workplace.
  const marketBreakX = marketHost.x + 1.22;
  const marketBreakZ = marketMaxZ - 1.45;
  addMinaMarketPart("mina-market-staff-bench-seat", "accent",
    [marketBreakX, marketFloorY + 0.46, marketBreakZ], [3.10, 0.46, 0.86]);
  addMinaMarketPart("mina-market-staff-bench-back", "accent",
    [marketBreakX, marketFloorY + 0.90, marketBreakZ + 0.34], [3.10, 0.84, 0.18]);
  addMinaMarketPart("mina-market-staff-table", "casework",
    [marketBreakX, marketFloorY + 0.70, marketRearRoomsZ + 1.35], [1.42, 0.11, 0.84]);
  addMinaMarketPart("mina-market-staff-lockers", "cabinetry",
    [marketStockDividerX + 0.50, marketFloorY + 1.04, marketRearRoomsZ + 2.15], [0.74, 2.08, 2.42]);
  addMinaMarketBlocker("mina-market-staff-bench", "market-fixture",
    marketBreakX, marketBreakZ, 3.12, 0.92, 1.36);
  addMinaMarketBlocker("mina-market-staff-lockers", "market-fixture",
    marketStockDividerX + 0.50, marketRearRoomsZ + 2.15, 0.76, 2.44, 2.08);

  const marketToiletX = marketMaxX - 2.10;
  addMinaMarketPart("mina-market-toilet-base", "plaster",
    [marketToiletX, marketFloorY + 0.31, marketMaxZ - 1.48], [0.60, 0.50, 0.78]);
  addMinaMarketPart("mina-market-toilet-cistern", "plaster",
    [marketToiletX, marketFloorY + 0.72, marketMaxZ - 1.18], [0.58, 0.72, 0.24]);
  addMinaMarketPart("mina-market-accessible-grab-rail", "trim",
    [marketToiletX - 0.70, marketFloorY + 0.78, marketMaxZ - 1.36], [1.12, 0.10, 0.10]);
  addMinaMarketPart("mina-market-toilet-vanity", "cabinetry",
    [marketMaxX - 0.50, marketFloorY + 0.43, marketRearRoomsZ + 1.82], [0.74, 0.80, 1.42]);
  addMinaMarketPart("mina-market-toilet-basin", "plaster",
    [marketMaxX - 0.54, marketFloorY + 0.88, marketRearRoomsZ + 1.82], [0.76, 0.10, 1.20]);
  addMinaMarketBlocker("mina-market-toilet", "market-fixture",
    marketToiletX, marketMaxZ - 1.36, 0.68, 1.10, 1.10);
  addMinaMarketBlocker("mina-market-toilet-vanity", "market-fixture",
    marketMaxX - 0.50, marketRearRoomsZ + 1.82, 0.76, 1.44, 0.98);

  // Three non-emissive housings correspond to one reallocated entrance light
  // plus two tightly bounded room practicals created with the world lights.
  const marketLightingPositions = [
    [marketHost.x + 3.10, marketFloorY + 2.76, marketMinZ + 6.45],
    [marketHost.x - 4.85, marketFloorY + 2.76, marketHost.z + 2.02],
    [marketHost.x - 4.90, marketFloorY + 2.76, marketRearRoomsZ + 2.12],
  ];
  for (const [index, [x, y, z]] of marketLightingPositions.entries()) addMinaMarketPart(
    `mina-market-ceiling-practical-${index + 1}`, "plaster", [x, y + 0.40, z], [1.24, 0.05, 0.36]);

  const marketCheckoutCustomer = [marketCounterX + 1.85, marketFloorY, marketCounterZ - 1.52];
  const marketOrderCustomer = [marketCounterX - 1.80, marketFloorY, marketCounterZ - 1.38];
  const marketKeeperPosition = [marketCounterX + 2.40, marketFloorY, marketCounterZ + 0.92];
  const marketPrepPosition = [marketPrepX + 0.20, marketFloorY, marketPrepZ - 1.08];
  const marketWashPosition = [marketDishRunX - 1.35, marketFloorY, marketDishRunZ - 0.68];
  const marketStockPosition = [marketMinX + 2.05, marketFloorY, marketStockShelfZ];
  const marketBreakPosition = [marketBreakX - 2.04, marketFloorY, marketBreakZ];
  const marketReceivingPosition = [marketTrolleyX - 1.32, marketFloorY, marketTrolleyZ];
  const marketProducePosition = [marketMinX + 3.00, marketFloorY, marketMinZ + 5.86];
  const marketColdCasePosition = [marketColdCaseX - 1.40, marketFloorY, marketColdCaseZ];
  const marketPantryPosition = [marketGondolaXs[1] + 1.52, marketFloorY, marketGondolaZ];
  const marketPackingPosition = [marketCounterX + 3.20, marketFloorY, marketCounterZ - 2.10];
  const marketCustomerAnchors = {
    browse: [
      marketProducePosition,
      [marketGondolaXs[0] + 1.25, marketFloorY, marketGondolaZ - 1.35],
      [marketGondolaXs[1] + 1.30, marketFloorY, marketGondolaZ + 1.20],
      marketColdCasePosition,
    ],
    queue: [
      marketCheckoutCustomer,
      [marketCounterX + 2.40, marketFloorY, marketCounterZ - 3.05],
      marketOrderCustomer,
    ],
    checkout: marketCheckoutCustomer,
    order: marketOrderCustomer,
    seating: [
      [marketCustomerBenchX - 1.02, marketFloorY, marketCustomerBenchZ - 0.72],
      [marketCustomerBenchX - 1.02, marketFloorY, marketCustomerBenchZ + 0.72],
    ],
    exit: [marketEntranceX, marketFloorY, marketMinZ + 1.36],
  };
  const marketStaffAnchors = {
    keeper: marketKeeperPosition,
    checkout: marketKeeperPosition,
    order: [marketCounterX - 1.80, marketFloorY, marketCounterZ + 0.92],
    prep: marketPrepPosition,
    wash: marketWashPosition,
    stock: marketStockPosition,
    receiving: marketReceivingPosition,
    break: marketBreakPosition,
  };
  const marketOccupancySlots = [
    { id: "mina-market-keeper", role: "keeper", zoneId: "deli-checkout", position: marketKeeperPosition, heading: Math.PI },
    { id: "mina-market-deli-worker", role: "deli-worker", zoneId: "deli-checkout", position: marketStaffAnchors.order, heading: Math.PI },
    { id: "mina-market-kitchen-worker", role: "kitchen-worker", zoneId: "prep-kitchen", position: marketPrepPosition, heading: 0 },
    { id: "mina-market-stock-worker", role: "stock-worker", zoneId: "stock-receiving", position: marketReceivingPosition, heading: Math.PI * 0.5 },
    ...marketCustomerAnchors.browse.map((position, index) => ({
      id: `mina-market-shopper-browse-${index + 1}`, role: "shopper", zoneId: "sales-floor", position, heading: index % 2 ? -Math.PI * 0.5 : Math.PI * 0.5,
    })),
    ...marketCustomerAnchors.queue.map((position, index) => ({
      id: `mina-market-shopper-queue-${index + 1}`, role: "shopper", zoneId: "deli-checkout", position, heading: 0,
    })),
    ...marketCustomerAnchors.seating.map((position, index) => ({
      id: `mina-market-customer-seat-${index + 1}`, role: "customer", zoneId: "vestibule", position, heading: Math.PI * 0.5,
    })),
  ];
  const marketItineraries = [
    {
      id: "mina-market-shopper-loop",
      role: "shopper",
      loop: false,
      stops: [
        { anchorId: "arcade-gap", position: [marketEntranceX, marketFloorY, 132.20] },
        { anchorId: "produce", position: marketCustomerAnchors.browse[0] },
        { anchorId: "pantry", position: marketCustomerAnchors.browse[2] },
        { anchorId: "checkout", position: marketCustomerAnchors.checkout },
        { anchorId: "exit", position: marketCustomerAnchors.exit },
      ],
    },
    {
      id: "mina-market-takeaway-loop",
      role: "customer",
      loop: false,
      stops: [
        { anchorId: "arcade-gap", position: [marketEntranceX, marketFloorY, 132.20] },
        { anchorId: "order", position: marketCustomerAnchors.order },
        { anchorId: "seat", position: marketCustomerAnchors.seating[0] },
        { anchorId: "exit", position: marketCustomerAnchors.exit },
      ],
    },
    {
      id: "mina-market-keeper-shift",
      role: "keeper",
      loop: true,
      stops: [
        { anchorId: "checkout", position: marketStaffAnchors.checkout },
        { anchorId: "order", position: marketStaffAnchors.order },
        { anchorId: "prep", position: marketStaffAnchors.prep },
        { anchorId: "break", position: marketStaffAnchors.break },
      ],
    },
    {
      id: "mina-market-stock-loop",
      role: "stock-worker",
      loop: true,
      stops: [
        { anchorId: "receiving", position: marketStaffAnchors.receiving },
        { anchorId: "stock", position: marketStaffAnchors.stock },
        { anchorId: "pantry", position: marketPantryPosition },
      ],
    },
  ];
  const minaMarketKitchen = deepFreeze({
    id: "mina_market_kitchen",
    businessId: "mina_market_kitchen",
    buildingId: "mina-market-building",
    label: "MINA'S MARKET KITCHEN",
    address: "84 Market Street",
    districtId: marketHost.districtId,
    hostBuildingRecordId: marketHost.id,
    seed: minaMarketSeed,
    openingHours: { opens: 7, closes: 21 },
    arcade: {
      id: "north-market-street-arcade",
      retainedStallIds: [
        "north-market-stall-1-counter",
        "north-market-stall-2-counter",
        "north-market-stall-3-counter",
        "north-market-stall-4-counter",
      ],
      minaStallId: "north-market-stall-2-counter",
      stallPosition: [-148, marketFloorY, 130.60],
      visitorPosition: [-148, marketFloorY, 127.70],
      keeperPosition: [-148, marketFloorY, 131.35],
    },
    bounds: {
      minX: marketMinX,
      maxX: marketMaxX,
      minZ: marketMinZ,
      maxZ: marketMaxZ,
      floorY: marketFloorY,
      ceilingY: marketFloorY + marketHost.clearHeight,
    },
    entrance: {
      street: [marketEntranceX, marketFloorY, 127.70],
      arcadeGap: [marketEntranceX, marketFloorY, 130.60],
      apron: [marketEntranceX, marketFloorY, 132.20],
      exterior: [marketEntranceX, marketFloorY, 132.20],
      threshold: [marketEntranceX, marketFloorY, marketMinZ - 0.18],
      interior: [marketEntranceX, marketFloorY, marketMinZ + 1.36],
      heading: 0,
      clearWidth: marketDoorWidth,
      arcadeGapBounds: { minX: -145.14, maxX: -142.86, width: 2.28 },
      transition: "continuous-world",
      loading: false,
      teleport: false,
    },
    keeperAnchor: marketKeeperPosition,
    zones: {
      vestibule: { id: "vestibule", label: "WEATHER VESTIBULE", position: [marketEntranceX, marketFloorY, marketMinZ + 1.55], bounds: { minX: marketVestibuleLeft + 0.10, maxX: marketVestibuleRight - 0.10, minZ: marketMinZ + 0.22, maxZ: marketVestibuleEndZ } },
      salesFloor: { id: "sales-floor", label: "PRODUCE + GROCERY SALES", position: [marketHost.x - 1.35, marketFloorY, marketMinZ + 7.15], bounds: { minX: marketMinX + 0.22, maxX: marketHost.x + 2.20, minZ: marketMinZ + 0.22, maxZ: marketBackOfHouseZ - 0.08 } },
      deliCheckout: { id: "deli-checkout", label: "DELI + CHECKOUT", position: [marketCounterX - 0.20, marketFloorY, marketCounterZ - 1.48], bounds: { minX: marketHost.x + 2.20, maxX: marketMaxX - 0.22, minZ: marketMinZ + 0.22, maxZ: marketBackOfHouseZ - 0.08 } },
      prepKitchen: { id: "prep-kitchen", label: "PREP KITCHEN", position: [marketHost.x - 2.15, marketFloorY, marketBackOfHouseZ + 1.22], bounds: { minX: marketMinX + 0.22, maxX: marketKitchenWashX - 0.16, minZ: marketBackOfHouseZ + 0.16, maxZ: marketRearRoomsZ - 0.16 } },
      washUp: { id: "wash-up", label: "WASH-UP + SANITATION", position: [marketKitchenWashX + 1.42, marketFloorY, marketBackOfHouseZ + 1.18], bounds: { minX: marketKitchenWashX + 0.16, maxX: marketMaxX - 0.22, minZ: marketBackOfHouseZ + 0.16, maxZ: marketRearRoomsZ - 0.16 } },
      stockReceiving: { id: "stock-receiving", label: "COLD + DRY RECEIVING", position: [marketStockDoorX, marketFloorY, marketRearRoomsZ + 1.02], bounds: { minX: marketMinX + 0.22, maxX: marketStockDividerX - 0.16, minZ: marketRearRoomsZ + 0.16, maxZ: marketMaxZ - 0.22 } },
      staffNook: { id: "staff-nook", label: "STAFF NOOK", position: [marketBreakDoorX, marketFloorY, marketRearRoomsZ + 1.02], bounds: { minX: marketStockDividerX + 0.16, maxX: marketToiletDividerX - 0.16, minZ: marketRearRoomsZ + 0.16, maxZ: marketMaxZ - 0.22 } },
      toilet: { id: "toilet", label: "ACCESSIBLE WC", position: [marketToiletDoorX, marketFloorY, marketRearRoomsZ + 1.02], bounds: { minX: marketToiletDividerX + 0.16, maxX: marketMaxX - 0.22, minZ: marketRearRoomsZ + 0.16, maxZ: marketMaxZ - 0.22 } },
    },
    doorways: {
      exterior: { position: [marketEntranceX, marketFloorY, marketSouthWallZ], clearWidth: marketDoorWidth },
      vestibuleInner: { position: [marketEntranceX, marketFloorY, marketVestibuleEndZ], clearWidth: 2.68 },
      backOfHouse: { position: [marketStaffDoorX, marketFloorY, marketBackOfHouseZ], clearWidth: marketStaffDoorWidth },
      kitchenWash: { position: [marketKitchenWashX, marketFloorY, marketKitchenWashDoorZ], clearWidth: marketKitchenWashDoorWidth },
      stock: { position: [marketStockDoorX, marketFloorY, marketRearRoomsZ], clearWidth: 1.28 },
      staffNook: { position: [marketBreakDoorX, marketFloorY, marketRearRoomsZ], clearWidth: 1.22 },
      toilet: { position: [marketToiletDoorX, marketFloorY, marketRearRoomsZ], clearWidth: 1.08 },
    },
    stations: {
      groceryCheckout: { id: "mina-grocery-checkout", action: "buy_groceries", label: "BUY WEEKLY GROCERIES", position: marketCheckoutCustomer, fixtureId: "mina-market-pos-terminal", transactionKind: "household_supplies" },
      orderCounter: { id: "mina-order-counter", action: "open_menu", label: "ORDER FROM MINA", position: marketOrderCustomer, fixtureId: "mina-market-deli-display-glass", transactionKind: "prepared_food" },
      produceScale: { id: "mina-produce-scale", action: "weigh_produce", label: "WEIGH PRODUCE", position: marketProducePosition, fixtureId: "mina-market-produce-scale-head" },
      coldCase: { id: "mina-cold-case", action: "browse_groceries", label: "BROWSE CHILLED GOODS", position: marketColdCasePosition, fixtureId: "mina-market-cold-case-base" },
      pantryShelf: { id: "mina-pantry-shelf", action: "stock_shelves", label: "FACE THE PANTRY AISLE", position: marketPantryPosition, fixtureId: "mina-market-gondola-2-shelf-2" },
      kitchenPrep: { id: "mina-kitchen-prep", action: "prepare_food", label: "PREPARE MARKET FOOD", position: marketPrepPosition, fixtureId: "mina-market-prep-island-worktop" },
      dishSink: { id: "mina-dish-sink", action: "wash_dishes", label: "WASH + SANITISE", position: marketWashPosition, fixtureId: "mina-market-double-sink" },
      packingBench: { id: "mina-packing-bench", action: "pack_groceries", label: "PACK GROCERIES", position: marketPackingPosition, fixtureId: "mina-market-packing-shelf" },
    },
    staffAnchors: marketStaffAnchors,
    customerAnchors: marketCustomerAnchors,
    spawnPoints: {
      customers: [
        { id: "mina-customer-1", position: marketCustomerAnchors.browse[0], heading: Math.PI * 0.5 },
        { id: "mina-customer-2", position: marketCustomerAnchors.browse[1], heading: -Math.PI * 0.5 },
        { id: "mina-customer-3", position: marketCustomerAnchors.browse[2], heading: Math.PI * 0.5 },
        { id: "mina-customer-4", position: marketCustomerAnchors.queue[0], heading: 0 },
        { id: "mina-customer-5", position: marketCustomerAnchors.queue[1], heading: 0 },
        { id: "mina-customer-6", position: marketCustomerAnchors.seating[0], heading: Math.PI * 0.5 },
      ],
      staff: [
        { id: "mina-staff-keeper", role: "keeper", position: marketStaffAnchors.keeper, heading: Math.PI },
        { id: "mina-staff-deli", role: "deli-worker", position: marketStaffAnchors.order, heading: Math.PI },
        { id: "mina-staff-kitchen", role: "kitchen-worker", position: marketStaffAnchors.prep, heading: 0 },
        { id: "mina-staff-stock", role: "stock-worker", position: marketStaffAnchors.receiving, heading: Math.PI * 0.5 },
      ],
    },
    occupancySlots: marketOccupancySlots,
    occupancy: {
      capacity: marketOccupancySlots.length,
      staffCapacity: marketOccupancySlots.filter(slot => slot.role !== "shopper" && slot.role !== "customer").length,
      customerCapacity: marketOccupancySlots.filter(slot => slot.role === "shopper" || slot.role === "customer").length,
    },
    itineraries: marketItineraries,
    navigationNodes: [
      [marketEntranceX, marketFloorY, 127.70],
      [marketEntranceX, marketFloorY, 130.60],
      [marketEntranceX, marketFloorY, 132.20],
      [marketEntranceX, marketFloorY, marketMinZ - 0.18],
      [marketEntranceX, marketFloorY, marketMinZ + 1.36],
      [marketEntranceX, marketFloorY, marketVestibuleEndZ + 0.68],
      [marketHost.x - 0.20, marketFloorY, marketMinZ + 6.10],
      [marketHost.x - 0.20, marketFloorY, marketBackOfHouseZ - 1.20],
      [marketStaffDoorX, marketFloorY, marketBackOfHouseZ + 0.72],
      [marketHost.x - 1.20, marketFloorY, marketHost.z + 2.08],
      [marketKitchenWashX, marketFloorY, marketKitchenWashDoorZ],
      [marketStockDoorX, marketFloorY, marketRearRoomsZ + 0.68],
      [marketBreakDoorX, marketFloorY, marketRearRoomsZ + 0.68],
      [marketToiletDoorX, marketFloorY, marketRearRoomsZ + 0.68],
    ],
    variant: {
      cabinetStyle: marketCabinetStyle,
      accentStyle: marketAccentStyle,
      aisleOffset: marketAisleOffset,
      crateYaw: marketCrateYaw,
      basketSpread: marketBasketSpread,
    },
    glass: {
      kind: "dark-neutral-ordinary-glazing",
      panels: minaMarketGlassTransforms.length,
      emissive: false,
      neon: false,
    },
    lighting: {
      kind: "focus-bounded-warm-market-practicals",
      positions: marketLightingPositions,
      colors: [0xffcf9d, 0xffdfbb, 0xdcecff],
      intensities: [70, 64, 54],
      ranges: [15, 12, 10],
      reallocates: "host-occupied-storefront-practical",
      lightsAdded: 2,
      opens: 7,
      closes: 21,
    },
    renderParts: minaMarketParts,
    collisionIds: minaMarketBlockerIds,
    renderBudget: {
      geometriesAdded: 0,
      materialsAdded: 0,
      instancedBatchesAdded: 0,
      lightsAdded: 2,
    },
    stats: {
      rooms: 8,
      doorways: 7,
      stations: 8,
      customerSpawns: 6,
      staffSpawns: 4,
      occupancySlots: marketOccupancySlots.length,
      itineraries: marketItineraries.length,
      renderInstances: minaMarketParts.length,
      glassPanels: minaMarketGlassTransforms.length,
      collisionVolumes: minaMarketBlockerIds.length,
      practicalLights: 3,
      reallocatedPracticalLights: 1,
      addedPracticalLights: 2,
      emissiveMaterials: 0,
    },
  });

  // Chapter Two's Common Ground conversation now happens at a real table in
  // the café instead of beside the old detached pavement prop. Actor and
  // interaction marks deliberately remain separate for clean two-shots.
  const chapterTwoConversationAnchors = Object.freeze({
    leah: commonGroundCafe.customerAnchors.story.interaction,
    manifest: chapterTwoInteractAnchors.manifestDesk,
  });
  const chapterTwoLeahAnchor = commonGroundCafe.customerAnchors.story.leah;
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
      position: commonGroundCafe.entrance.exterior,
      keeperPosition: commonGroundCafe.keeperAnchor,
      keeperYaw: Math.PI,
      physicalInteriorId: commonGroundCafe.id,
      buildingId: commonGroundCafe.buildingId,
    }),
    Object.freeze({
      id: "mina_market_kitchen",
      district: "north-market",
      position: minaMarketKitchen.entrance.street,
      interactionPosition: minaMarketKitchen.stations.orderCounter.position,
      keeperPosition: minaMarketKitchen.keeperAnchor,
      keeperYaw: Math.PI,
      arcadeStallPosition: northMarketVisitorAnchors[1],
      arcadeKeeperPosition: northMarketBusinessAnchors[1],
      physicalInteriorId: minaMarketKitchen.id,
      buildingId: minaMarketKitchen.buildingId,
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
      kind: "walk-in-cafe",
      center: freezePosition([cafeHost.x, SIDEWALK_TOP, cafeMinZ - 0.10]),
      interactionPosition: businessById.get("common_ground_cafe").position,
      yaw: Math.PI,
      width: cafeHost.width - 0.66,
      interiorStyle: 0,
      signStyle: 0,
      practicalPosition: commonGroundCafe.lighting.position,
      practicalColor: commonGroundCafe.lighting.color,
      practicalIntensity: commonGroundCafe.lighting.intensity,
      practicalRange: commonGroundCafe.lighting.range,
      physicalInteriorId: commonGroundCafe.id,
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
  const businessOpenStates = new Map(businesses.map(business => [business.id, false]));

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
    if (frontage.id === commonGroundCafe.id) continue;
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
    openHours: minaMarketKitchen.openingHours,
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
  // and a visibly sloped arrival ramp. The left street-facing bay is a real,
  // prebuilt workshop; compound collision leaves its entrance and work aisle
  // traversable without weakening the rest of the garage shell.
  const pulseGarageInteriorSeed = (resolvedSeed ^ 0x50554c53) >>> 0;
  const pulseGarageRandom = mulberry32(pulseGarageInteriorSeed);
  const pulseGarageFloorY = SIDEWALK_TOP + 0.18;
  const pulseGarageCeilingY = SIDEWALK_TOP + 3.84;
  const pulseGarageLiftZ = 87.15 + (pulseGarageRandom() - 0.5) * 0.34;
  const pulseGarageBenchZ = 84.05 + (pulseGarageRandom() - 0.5) * 0.28;
  const pulseGarageShelfZ = 89.75 + (pulseGarageRandom() - 0.5) * 0.20;
  const pulseGarageBayBounds = {
    minX: -155.68,
    maxX: -150.32,
    minZ: 80.18,
    maxZ: 91.48,
    floorY: pulseGarageFloorY,
    ceilingY: pulseGarageCeilingY,
  };
  const garageDecks = [];
  for (let level = 0; level < 4; ++level) {
    if (level === 0) {
      // Keep the pooled ground deck out of the workshop aperture. The bay owns
      // a lower, gently ramped service floor while the rest of the garage
      // retains its original slab.
      garageDecks.push(transform([-139.85, pulseGarageFloorY - 0.18, 96], [20.7, 0.36, 30]));
    } else {
      garageDecks.push(transform([-144, SIDEWALK_TOP + 0.35 + level * 4.0, 96], [29, 0.55, 30]));
    }
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
    if (index !== 1) {
      addStaticMesh(`Pulse Garage dark service bay ${index}`, boxGeometry, material.concreteDark,
        [x, SIDEWALK_TOP + 1.85, 80.48], [6.2, 3.25, 0.48], [0, 0, 0], { castShadow: true });
      addStaticMesh(`Pulse Garage open service bay illusion ${index}`, planeGeometry, material.windows[index % material.windows.length],
        [x, SIDEWALK_TOP + 1.78, 80.18], [5.35, 2.82, 1], [0, Math.PI, 0], { receiveShadow: false });
    }
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

  let pulseGarageInteriorMeshCount = 0;
  function addPulseGarageMesh(name, meshMaterial, position, scale, rotation = [0, 0, 0], options = {}) {
    pulseGarageInteriorMeshCount += 1;
    return addStaticMesh(name, boxGeometry, meshMaterial, position, scale, rotation, {
      castShadow: options.castShadow ?? true,
      receiveShadow: options.receiveShadow ?? true,
      rtxIgnore: options.rtxIgnore ?? false,
      rtxStatic: options.rtxStatic ?? true,
    });
  }

  // Raised sealed service floor and a shallow threshold ramp. All meshes use
  // city-owned geometry/materials, so startup reveal-all warming discovers no
  // new gameplay-time topology or texture upload.
  addPulseGarageMesh("Pulse Garage left service bay raised floor", material.concrete,
    [-153, pulseGarageFloorY - 0.07, 85.83], [5.36, 0.14, 11.30], [0, 0, 0], { castShadow: false });
  addPulseGarageMesh("Pulse Garage left service bay threshold ramp", material.concrete,
    [-153, SIDEWALK_TOP + 0.02, 79.84], [5.02, 0.14, 1.62], [-0.11, 0, 0], { castShadow: false });
  addPulseGarageMesh("Pulse Garage left service bay ceiling", material.concreteDark,
    [-153, pulseGarageCeilingY, 85.83], [5.62, 0.18, 11.34]);
  addPulseGarageMesh("Pulse Garage left service bay west wall", material.concreteDark,
    [-155.79, 2.13, 85.83], [0.22, 3.68, 11.34]);
  addPulseGarageMesh("Pulse Garage left service bay east wall", material.concreteDark,
    [-150.21, 2.13, 85.83], [0.22, 3.68, 11.34]);
  addPulseGarageMesh("Pulse Garage left service bay rear wall", material.concreteDark,
    [-153, 2.13, 91.59], [5.80, 3.68, 0.22]);
  addPulseGarageMesh("Pulse Garage left service bay washable west wainscot", material.buildings[5],
    [-155.665, 1.08, 85.83], [0.035, 1.34, 10.96], [0, 0, 0], { castShadow: false });
  addPulseGarageMesh("Pulse Garage left service bay washable east wainscot", material.buildings[5],
    [-150.335, 1.08, 85.83], [0.035, 1.34, 10.96], [0, 0, 0], { castShadow: false });

  // Two-post lift, grounded arms and overhead crossmember establish a usable
  // mechanic station rather than decorative garage dressing.
  const liftPostXs = [-154.88, -151.12];
  for (const [index, x] of liftPostXs.entries()) {
    addPulseGarageMesh(`Pulse Garage service lift post ${index + 1}`, material.pole,
      [x, pulseGarageFloorY + 1.42, pulseGarageLiftZ], [0.28, 2.84, 0.34]);
    addPulseGarageMesh(`Pulse Garage service lift foot ${index + 1}`, material.facadeTrim,
      [x, pulseGarageFloorY + 0.055, pulseGarageLiftZ], [0.62, 0.11, 0.74]);
    addPulseGarageMesh(`Pulse Garage service lift arm ${index + 1}`, material.facadeTrim,
      [(x - 153) * 0.42 - 153, pulseGarageFloorY + 0.16, pulseGarageLiftZ - 0.44], [1.45, 0.09, 0.18], [0, (index ? -1 : 1) * 0.16, 0]);
  }
  addPulseGarageMesh("Pulse Garage service lift overhead crossmember", material.pole,
    [-153, pulseGarageFloorY + 2.79, pulseGarageLiftZ], [4.04, 0.22, 0.30]);

  // Workbench, pegboard, shelves and physically separate parts bins are all
  // seeded once from the city seed. Their stable layout becomes gameplay data
  // through the contract below.
  addPulseGarageMesh("Pulse Garage mechanic workbench", material.utility,
    [-155.20, pulseGarageFloorY + 0.46, pulseGarageBenchZ], [0.72, 0.92, 2.36]);
  addPulseGarageMesh("Pulse Garage mechanic pegboard", material.buildings[3],
    [-155.61, pulseGarageFloorY + 1.72, pulseGarageBenchZ], [0.055, 1.32, 2.60]);
  for (let tool = 0; tool < 8; ++tool) {
    const z = pulseGarageBenchZ - 0.96 + (tool % 4) * 0.62;
    const y = pulseGarageFloorY + 1.45 + Math.floor(tool / 4) * 0.48 + (pulseGarageRandom() - 0.5) * 0.08;
    addPulseGarageMesh(`Pulse Garage wall tool ${tool + 1}`, tool % 3 === 0 ? material.hydrant : material.facadeTrim,
      [-155.565, y, z], [0.09, 0.34 + pulseGarageRandom() * 0.16, 0.07], [0, 0, (tool % 2 ? -1 : 1) * 0.18]);
  }
  for (let shelf = 0; shelf < 3; ++shelf) {
    addPulseGarageMesh(`Pulse Garage parts shelf ${shelf + 1}`, material.facadeTrim,
      [-150.73, pulseGarageFloorY + 0.40 + shelf * 0.66, pulseGarageShelfZ], [0.68, 0.08, 2.06]);
  }
  for (let part = 0; part < 6; ++part) {
    const level = part % 3;
    const z = pulseGarageShelfZ - 0.72 + Math.floor(part / 3) * 1.34 + (pulseGarageRandom() - 0.5) * 0.12;
    addPulseGarageMesh(`Pulse Garage labelled parts bin ${part + 1}`, material.containers[part % material.containers.length],
      [-150.78, pulseGarageFloorY + 0.55 + level * 0.66, z], [0.52, 0.26, 0.46], [0, (pulseGarageRandom() - 0.5) * 0.08, 0]);
  }

  // A framed glass office nook and occupied-room projection retain sightline
  // depth on the east wall while the bay itself remains physically open.
  const garageOfficeGlass = addStaticMesh("Pulse Garage service office glazing", planeGeometry, material.shelterGlass,
    [-150.075, pulseGarageFloorY + 1.70, 83.48], [2.76, 2.22, 1], [0, -Math.PI * 0.5, 0], {
      receiveShadow: false, rtxIgnore: true, rtxStatic: false,
    });
  pulseGarageInteriorMeshCount += 1;
  const garageOfficeRoom = addStaticMesh("Pulse Garage service office occupied room", planeGeometry, material.windows[0],
    [-150.105, pulseGarageFloorY + 1.70, 83.48], [2.64, 2.10, 1], [0, -Math.PI * 0.5, 0], {
      receiveShadow: false,
    });
  pulseGarageInteriorMeshCount += 1;
  for (const [index, z] of [82.06, 84.90].entries()) {
    addPulseGarageMesh(`Pulse Garage office glazing jamb ${index + 1}`, material.facadeTrim,
      [-150.11, pulseGarageFloorY + 1.70, z], [0.14, 2.34, 0.14]);
  }
  addPulseGarageMesh("Pulse Garage office glazing sill", material.facadeTrim,
    [-150.11, pulseGarageFloorY + 0.59, 83.48], [0.14, 0.14, 2.98]);
  addPulseGarageMesh("Pulse Garage office glazing header", material.facadeTrim,
    [-150.11, pulseGarageFloorY + 2.81, 83.48], [0.14, 0.14, 2.98]);
  for (const [index, [x, z]] of [[-154.25, 84.05], [-151.65, 88.55]].entries()) {
    addPulseGarageMesh(`Pulse Garage service bay ceiling luminaire ${index + 1}`, material.laneWhite,
      [x, pulseGarageCeilingY - 0.105, z], [1.55, 0.035, 0.42], [0, 0, 0], { castShadow: false });
  }

  // The former single AABB made both painted service doors impossible to
  // enter. Three shell volumes preserve identical outer coverage everywhere
  // except the authored left aperture; only real fixtures block its aisle.
  addBlocker("pulse-garage-west-structure", "garage-structure", -157.15, 96, 2.70, 30, 15.2);
  addBlocker("pulse-garage-east-structure", "garage-structure", -139.85, 96, 20.70, 30, 15.2);
  addBlocker("pulse-garage-bay-rear-structure", "garage-structure", -153, 101.30, 5.60, 19.40, 15.2);
  addBlocker("pulse-garage-service-workbench", "garage-fixture", -155.20, pulseGarageBenchZ, 0.72, 2.36, 0.92, pulseGarageFloorY);
  for (const [index, x] of liftPostXs.entries()) {
    addBlocker(`pulse-garage-service-lift-post-${index + 1}`, "garage-fixture", x, pulseGarageLiftZ, 0.28, 0.34, 2.84, pulseGarageFloorY);
  }
  addBlocker("pulse-garage-service-parts-shelf", "garage-fixture", -150.73, pulseGarageShelfZ, 0.68, 2.06, 2.08, pulseGarageFloorY);

  const pulseGarageInterior = deepFreeze({
    id: "pulse-garage-left-service-bay",
    buildingId: "pulse-garage",
    seed: pulseGarageInteriorSeed,
    entrance: {
      exterior: [-153, SIDEWALK_TOP, 78.90],
      threshold: [-153, SIDEWALK_TOP + 0.09, 79.90],
      interior: [-153, pulseGarageFloorY, 81.45],
      heading: Math.PI,
      clearWidth: 5.02,
    },
    bounds: pulseGarageBayBounds,
    layout: {
      kind: "seeded-two-post-service-bay",
      seed: pulseGarageInteriorSeed,
      floorHeight: pulseGarageFloorY,
      ceilingHeight: pulseGarageCeilingY,
      ramp: { minZ: 79.03, maxZ: 80.65, lowY: SIDEWALK_TOP, highY: pulseGarageFloorY },
      liftZ: pulseGarageLiftZ,
      benchZ: pulseGarageBenchZ,
      shelfZ: pulseGarageShelfZ,
    },
    stations: {
      diagnostics: { id: "garage-diagnostics", label: "DIAGNOSTICS BENCH", position: [-154.10, pulseGarageFloorY, pulseGarageBenchZ], fixturePosition: [-155.20, pulseGarageFloorY, pulseGarageBenchZ] },
      lift: { id: "garage-lift", label: "TWO-POST SERVICE LIFT", position: [-153, pulseGarageFloorY, pulseGarageLiftZ - 1.55], fixturePosition: [-153, pulseGarageFloorY, pulseGarageLiftZ] },
      parts: { id: "garage-parts", label: "LABELLED PARTS SHELVES", position: [-151.75, pulseGarageFloorY, pulseGarageShelfZ - 0.15], fixturePosition: [-150.73, pulseGarageFloorY, pulseGarageShelfZ] },
      office: { id: "garage-office", label: "SERVICE OFFICE WINDOW", position: [-151.20, pulseGarageFloorY, 83.48], fixturePosition: [-150.11, pulseGarageFloorY + 1.70, 83.48] },
    },
    customerAnchor: [-153, pulseGarageFloorY, 82.12],
    stats: {
      renderMeshes: pulseGarageInteriorMeshCount,
      collisionVolumes: 7,
      stations: 4,
      liftPosts: 2,
      shelves: 3,
      wallTools: 8,
      partsBins: 6,
      officeGlazingPanels: 1,
      practicalLights: 2,
    },
  });

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
  shelterGlass.push(...residentialInteriorGlassTransforms);
  shelterGlass.push(...communityHubGlassTransforms);
  shelterGlass.push(...commonGroundCafeGlassTransforms);
  shelterGlass.push(...minaMarketGlassTransforms);
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
    if (frontage.id === commonGroundCafe.id) {
      light.name = "Common Ground Cafe bounded warm practical";
      light.userData.cafeId = commonGroundCafe.id;
      light.userData.physicalInterior = true;
    }
    root.add(light);
    staticLights.push(light);
  }
  const communityHubPracticalReallocationStart = storefrontLightPositions.length - 3;
  const residentialInteriorPracticalReallocationIndex = storefrontLightPositions.length - 1;
  for (const [index, entry] of storefrontLightPositions.entries()) {
    const communityHubPracticalIndex = index - communityHubPracticalReallocationStart;
    const isCommunityHubPractical = communityHubPracticalIndex >= 0 && communityHubPracticalIndex < 2;
    const isResidentialPractical = index === residentialInteriorPracticalReallocationIndex;
    const isMinaMarketPractical = entry.buildingId === minaMarketKitchen.hostBuildingRecordId;
    const hubLightPosition = isCommunityHubPractical ? communityHub.lighting.positions[communityHubPracticalIndex] : null;
    const hubLightColor = isCommunityHubPractical ? communityHub.lighting.colors[communityHubPracticalIndex] : null;
    const hubLightIntensity = isCommunityHubPractical ? communityHub.lighting.intensities[communityHubPracticalIndex] : null;
    const hubLightRange = isCommunityHubPractical ? communityHub.lighting.ranges[communityHubPracticalIndex] : null;
    const light = new THREE.PointLight(
      isMinaMarketPractical ? minaMarketKitchen.lighting.colors[0] : isResidentialPractical ?
        residentialInterior.lighting.color : isCommunityHubPractical ? hubLightColor : entry.color,
      isMinaMarketPractical ? minaMarketKitchen.lighting.intensities[0] : isResidentialPractical ?
        residentialInterior.lighting.intensity : isCommunityHubPractical ? hubLightIntensity : entry.baseIntensity,
      isMinaMarketPractical ? minaMarketKitchen.lighting.ranges[0] : isResidentialPractical ?
        residentialInterior.lighting.range : isCommunityHubPractical ? hubLightRange : 17,
      2,
    );
    light.name = isMinaMarketPractical
      ? "Mina's Market bounded practical 1"
      : isResidentialPractical
      ? "Southline Studio bounded warm practical"
      : isCommunityHubPractical
        ? `Harbour Skills House bounded practical ${communityHubPracticalIndex + 1}`
      : `Occupied storefront entrance practical ${index + 1}`;
    light.position.fromArray(isMinaMarketPractical ? minaMarketKitchen.lighting.positions[0] : isResidentialPractical ?
      residentialInterior.lighting.position : isCommunityHubPractical ? hubLightPosition : entry.position);
    light.userData.staticWorld = true;
    light.userData.baseIntensity = isMinaMarketPractical ? minaMarketKitchen.lighting.intensities[0] : isResidentialPractical ?
      residentialInterior.lighting.intensity : isCommunityHubPractical ? hubLightIntensity : entry.baseIntensity;
    if (isMinaMarketPractical) {
      light.userData.practicalKind = "mina-market-interior";
      light.userData.marketId = minaMarketKitchen.id;
      light.userData.businessId = minaMarketKitchen.businessId;
      light.userData.physicalInterior = true;
      light.userData.bounded = true;
    } else if (isResidentialPractical) {
      light.userData.practicalKind = "residential-interior";
      light.userData.homeId = residentialInterior.homeId;
      light.userData.bounded = true;
    } else if (isCommunityHubPractical) {
      light.userData.practicalKind = "community-hub-interior";
      light.userData.hubId = communityHub.id;
      light.userData.bounded = true;
    }
    root.add(light);
    staticLights.push(light);
  }
  for (let index = 1; index < minaMarketKitchen.lighting.positions.length; ++index) {
    const light = new THREE.PointLight(
      minaMarketKitchen.lighting.colors[index],
      minaMarketKitchen.lighting.intensities[index],
      minaMarketKitchen.lighting.ranges[index],
      2,
    );
    light.name = `Mina's Market bounded practical ${index + 1}`;
    light.position.fromArray(minaMarketKitchen.lighting.positions[index]);
    light.castShadow = false;
    light.userData.staticWorld = true;
    light.userData.baseIntensity = minaMarketKitchen.lighting.intensities[index];
    light.userData.practicalKind = "mina-market-interior";
    light.userData.marketId = minaMarketKitchen.id;
    light.userData.businessId = minaMarketKitchen.businessId;
    light.userData.physicalInterior = true;
    light.userData.bounded = true;
    root.add(light);
    staticLights.push(light);
  }
  const pulseGaragePracticalSpecs = [
    { position: [-144, SIDEWALK_TOP + 3.75, 78.3], kind: "canopy", color: 0xffd0a0, intensity: 88, range: 19 },
    { position: [-154.25, pulseGarageCeilingY - 0.28, 84.05], kind: "service-bay", color: 0xffe1ba, intensity: 118, range: 10.5 },
    { position: [-151.65, pulseGarageCeilingY - 0.28, 88.55], kind: "service-bay", color: 0xd9edff, intensity: 108, range: 10.5 },
  ];
  for (const [index, spec] of pulseGaragePracticalSpecs.entries()) {
    const baseIntensity = spec.intensity;
    const light = new THREE.PointLight(spec.color, baseIntensity, spec.range, 2);
    light.name = spec.kind === "service-bay"
      ? `Pulse Garage service bay practical ${index}`
      : "Pulse Garage canopy practical";
    light.position.set(...spec.position);
    light.userData.staticWorld = true;
    light.userData.baseIntensity = baseIntensity;
    light.userData.practicalKind = `pulse-garage-${spec.kind}`;
    light.userData.bounded = true;
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
  function addPedestrianNode(xValue, zValue, yValue = SIDEWALK_TOP) {
    const x = Math.round(finite(xValue) * 100) / 100;
    const z = Math.round(finite(zValue) * 100) / 100;
    if (x < CITY_BOUNDS.minX + 0.5 || x > CITY_BOUNDS.maxX - 0.5 ||
        z < CITY_BOUNDS.minZ + 0.5 || z > CITY_BOUNDS.maxZ - 0.5) return;
    if (isBlockedCircle(x, z, 0.38)) return;
    const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
    if (!pedestrianNodeMap.has(key)) {
      pedestrianNodeMap.set(key, Object.freeze([x, finite(yValue, SIDEWALK_TOP), z]));
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
  for (const [x, y, z] of [
    residentialInterior.entrance.exterior,
    residentialInterior.entrance.threshold,
    residentialInterior.entrance.interior,
    ...Object.values(residentialInterior.doorways).map(doorway => doorway.position),
    ...Object.values(residentialInterior.zones).map(zone => zone.position),
    ...Object.values(residentialInterior.interactionAnchors),
    ...Object.values(residentialInterior.stations).map(station => station.position),
    residentialInterior.spawnPoints.player.position,
    residentialInterior.spawnPoints.resident.position,
  ]) addPedestrianNode(x, z, y);
  for (const [x, y, z] of [
    communityHub.entrance.exterior,
    communityHub.entrance.threshold,
    communityHub.entrance.interior,
    ...Object.values(communityHub.doorways).map(doorway => doorway.position),
    ...Object.values(communityHub.zones).map(zone => zone.position),
    ...Object.values(communityHub.stations).map(station => station.position),
    ...communityHub.navigationNodes,
    ...communityHub.spawnPoints.public.map(entry => entry.position),
    ...communityHub.spawnPoints.staff.map(entry => entry.position),
  ]) addPedestrianNode(x, z, y);
  for (const [x, y, z] of [
    commonGroundCafe.entrance.exterior,
    commonGroundCafe.entrance.threshold,
    commonGroundCafe.entrance.interior,
    commonGroundCafe.keeperAnchor,
    ...Object.values(commonGroundCafe.doorways).map(doorway => doorway.position),
    ...Object.values(commonGroundCafe.zones).map(zone => zone.position),
    ...Object.values(commonGroundCafe.stations).map(station => station.position),
    ...Object.values(commonGroundCafe.jobAnchors),
    ...commonGroundCafe.customerAnchors.queue,
    commonGroundCafe.customerAnchors.pickup,
    ...commonGroundCafe.customerAnchors.seating,
    commonGroundCafe.customerAnchors.story.leah,
    commonGroundCafe.customerAnchors.story.interaction,
    ...commonGroundCafe.navigationNodes,
    ...commonGroundCafe.spawnPoints.customers.map(entry => entry.position),
    ...commonGroundCafe.spawnPoints.staff.map(entry => entry.position),
  ]) addPedestrianNode(x, z, y);
  for (const [x, y, z] of [
    minaMarketKitchen.entrance.street,
    minaMarketKitchen.entrance.arcadeGap,
    minaMarketKitchen.entrance.apron,
    minaMarketKitchen.entrance.threshold,
    minaMarketKitchen.entrance.interior,
    minaMarketKitchen.keeperAnchor,
    ...Object.values(minaMarketKitchen.doorways).map(doorway => doorway.position),
    ...Object.values(minaMarketKitchen.zones).map(zone => zone.position),
    ...Object.values(minaMarketKitchen.stations).map(station => station.position),
    ...Object.values(minaMarketKitchen.staffAnchors),
    ...minaMarketKitchen.customerAnchors.browse,
    ...minaMarketKitchen.customerAnchors.queue,
    minaMarketKitchen.customerAnchors.checkout,
    minaMarketKitchen.customerAnchors.order,
    ...minaMarketKitchen.customerAnchors.seating,
    minaMarketKitchen.customerAnchors.exit,
    ...minaMarketKitchen.navigationNodes,
    ...minaMarketKitchen.spawnPoints.customers.map(entry => entry.position),
    ...minaMarketKitchen.spawnPoints.staff.map(entry => entry.position),
    ...minaMarketKitchen.occupancySlots.map(entry => entry.position),
    ...minaMarketKitchen.itineraries.flatMap(itinerary => itinerary.stops.map(stop => stop.position)),
  ]) addPedestrianNode(x, z, y);
  for (const [x, y, z] of [
    pulseGarageInterior.entrance.exterior,
    pulseGarageInterior.entrance.threshold,
    pulseGarageInterior.entrance.interior,
    pulseGarageInterior.customerAnchor,
    ...Object.values(pulseGarageInterior.stations).map(station => station.position),
  ]) addPedestrianNode(x, z, y);
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

  function residentialInteriorGroundAt(xValue, zValue) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    const bounds = residentialInterior.bounds;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return bounds.floorY;
    return null;
  }

  function communityHubGroundAt(xValue, zValue) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    const bounds = communityHub.bounds;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return bounds.floorY;
    return null;
  }

  function commonGroundCafeGroundAt(xValue, zValue) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    const bounds = commonGroundCafe.bounds;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return bounds.floorY;
    return null;
  }

  function minaMarketGroundAt(xValue, zValue) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    const bounds = minaMarketKitchen.bounds;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return bounds.floorY;
    return null;
  }

  function pulseGarageGroundAt(xValue, zValue) {
    const x = finite(xValue, Infinity);
    const z = finite(zValue, Infinity);
    const ramp = pulseGarageInterior.layout.ramp;
    const rampHalfWidth = pulseGarageInterior.entrance.clearWidth * 0.5;
    if (Math.abs(x + 153) <= rampHalfWidth && z >= ramp.minZ && z <= ramp.maxZ) {
      const progress = clamp((z - ramp.minZ) / Math.max(1e-6, ramp.maxZ - ramp.minZ), 0, 1);
      return THREE.MathUtils.lerp(ramp.lowY, ramp.highY, progress);
    }
    const bounds = pulseGarageInterior.bounds;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return bounds.floorY;
    return null;
  }

  function terrainHeight(x, z) {
    const homeGround = residentialInteriorGroundAt(x, z);
    if (homeGround != null) return homeGround;
    const hubGround = communityHubGroundAt(x, z);
    if (hubGround != null) return hubGround;
    const cafeGround = commonGroundCafeGroundAt(x, z);
    if (cafeGround != null) return cafeGround;
    const marketGround = minaMarketGroundAt(x, z);
    if (marketGround != null) return marketGround;
    const garageGround = pulseGarageGroundAt(x, z);
    if (garageGround != null) return garageGround;
    if (z > CITY_BOUNDS.maxZ) return 0.12 + Math.sin(x * 0.035) * 0.18 + Math.sin(z * 0.021) * 0.12;
    if (isRoad(x, z)) return ROAD_TOP;
    const court = x >= harbourCourt.bounds.minX && x <= harbourCourt.bounds.maxX &&
      z >= harbourCourt.bounds.minZ && z <= harbourCourt.bounds.maxZ;
    return court ? SIDEWALK_TOP + 0.14 : SIDEWALK_TOP;
  }

  function sampleGround(x, z) {
    const homeGround = residentialInteriorGroundAt(x, z);
    if (homeGround != null) return {
      height: homeGround,
      normal: new THREE.Vector3(0, 1, 0),
      surfaceId: "southline-studio-floor",
      districtId: residentialInterior.districtId,
    };
    const hubGround = communityHubGroundAt(x, z);
    if (hubGround != null) return {
      height: hubGround,
      normal: new THREE.Vector3(0, 1, 0),
      surfaceId: "harbour-skills-house-floor",
      districtId: communityHub.districtId,
    };
    const cafeGround = commonGroundCafeGroundAt(x, z);
    if (cafeGround != null) return {
      height: cafeGround,
      normal: new THREE.Vector3(0, 1, 0),
      surfaceId: "common-ground-cafe-floor",
      districtId: commonGroundCafe.districtId,
    };
    const marketGround = minaMarketGroundAt(x, z);
    if (marketGround != null) return {
      height: marketGround,
      normal: new THREE.Vector3(0, 1, 0),
      surfaceId: "mina-market-floor",
      districtId: minaMarketKitchen.districtId,
    };
    const garageGround = pulseGarageGroundAt(x, z);
    if (garageGround != null) {
      const ramp = pulseGarageInterior.layout.ramp;
      const onRamp = z >= ramp.minZ && z <= ramp.maxZ;
      const rise = onRamp ? (ramp.highY - ramp.lowY) / Math.max(1e-6, ramp.maxZ - ramp.minZ) : 0;
      return {
        height: garageGround,
        normal: new THREE.Vector3(0, 1, -rise).normalize(),
        surfaceId: onRamp ? "pulse-garage-service-ramp" : "pulse-garage-service-floor",
        districtId: "north-market",
      };
    }
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
    const focusValue = focusPosition?.position ?? focusPosition;
    const focusInsideResidential = Boolean(focusValue) &&
      finite(focusValue.x ?? focusValue[0], Infinity) >= residentialInterior.bounds.minX - 0.2 &&
      finite(focusValue.x ?? focusValue[0], -Infinity) <= residentialInterior.bounds.maxX + 0.2 &&
      finite(focusValue.z ?? focusValue[2], Infinity) >= residentialInterior.bounds.minZ - 0.2 &&
      finite(focusValue.z ?? focusValue[2], -Infinity) <= residentialInterior.bounds.maxZ + 0.2;
    const focusInsideCommunityHub = Boolean(focusValue) &&
      finite(focusValue.x ?? focusValue[0], Infinity) >= communityHub.bounds.minX - 0.2 &&
      finite(focusValue.x ?? focusValue[0], -Infinity) <= communityHub.bounds.maxX + 0.2 &&
      finite(focusValue.z ?? focusValue[2], Infinity) >= communityHub.bounds.minZ - 0.2 &&
      finite(focusValue.z ?? focusValue[2], -Infinity) <= communityHub.bounds.maxZ + 0.2;
    const focusInsideCommonGroundCafe = Boolean(focusValue) &&
      finite(focusValue.x ?? focusValue[0], Infinity) >= commonGroundCafe.bounds.minX - 0.2 &&
      finite(focusValue.x ?? focusValue[0], -Infinity) <= commonGroundCafe.bounds.maxX + 0.2 &&
      finite(focusValue.z ?? focusValue[2], Infinity) >= commonGroundCafe.bounds.minZ - 0.2 &&
      finite(focusValue.z ?? focusValue[2], -Infinity) <= commonGroundCafe.bounds.maxZ + 0.2;
    const focusInsideMinaMarket = Boolean(focusValue) &&
      finite(focusValue.x ?? focusValue[0], Infinity) >= minaMarketKitchen.bounds.minX - 0.2 &&
      finite(focusValue.x ?? focusValue[0], -Infinity) <= minaMarketKitchen.bounds.maxX + 0.2 &&
      finite(focusValue.z ?? focusValue[2], Infinity) >= minaMarketKitchen.bounds.minZ - 0.2 &&
      finite(focusValue.z ?? focusValue[2], -Infinity) <= minaMarketKitchen.bounds.maxZ + 0.2;
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
      const practicalKind = staticLights[index].userData.practicalKind;
      const practicalFactor = (practicalKind === "residential-interior" && focusInsideResidential) ||
        (practicalKind === "community-hub-interior" && focusInsideCommunityHub) ||
        (staticLights[index].userData.cafeId === commonGroundCafe.id && focusInsideCommonGroundCafe) ||
        (staticLights[index].userData.marketId === minaMarketKitchen.id && focusInsideMinaMarket)
        ? 1 : practical;
      staticLights[index].intensity = baseIntensity * (0.97 + Math.sin(elapsed * 0.31 + index * 1.9) * 0.03) * practicalFactor * openFactor;
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
  // One immutable, renderer-free GPS contract is shared by the HUD minimap
  // and the phone map. It describes the authored geometry directly: roads are
  // offset by 24 m from the world origin, so consumers must never reconstruct
  // them from a generic `n * spacing` grid.
  const mapFeatures = deepFreeze({
    version: 1,
    northAxis: "+z",
    bounds: { ...TRAVERSABLE_BOUNDS },
    cityBounds: { ...CITY_BOUNDS },
    coastX: COAST_X,
    roads: {
      halfWidth: ROAD_HALF_WIDTH,
      bounds: { ...CITY_BOUNDS },
      x: [...X_ROADS],
      z: [...Z_ROADS],
    },
    districts: DISTRICTS.map(district => ({
      id: district.id,
      kind: district.kind,
      bounds: { ...district.bounds },
    })),
    areas: [
      { id: "pulse-park", kind: "park", bounds: { minX: -66, maxX: -30, minZ: -66, maxZ: -30 } },
      { id: "pulse-plaza", kind: "plaza", bounds: { minX: -18, maxX: 18, minZ: -18, maxZ: 18 } },
      { id: "harbour-water", kind: "water", bounds: { minX: COAST_X, maxX: 292, minZ: CITY_BOUNDS.minZ - 24, maxZ: CITY_BOUNDS.maxZ + 24 } },
      { id: "harbour-court", kind: "recreation", bounds: { minX: 127.8, maxX: 152.2, minZ: -112.8, maxZ: -79.2 } },
      { id: "ashwind-desert", kind: "desert", bounds: { minX: -192, maxX: 192, minZ: 192, maxZ: 620 } },
      { id: "ashwind-ruins", kind: "ruins", bounds: { minX: -52, maxX: 52, minZ: 456, maxZ: 548 } },
    ],
    buildings: buildingRecords.map(building => ({
      id: building.id,
      position: [building.position[0], building.position[2]],
      size: [building.size[0], building.size[2]],
      district: building.district,
      storefront: building.storefront,
      destination: Boolean(building.physicalInterior),
    })),
  });
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
    storefrontPracticalLights: storefrontLightPositions.length - residentialInterior.stats.practicalLights -
      communityHub.stats.practicalLights - minaMarketKitchen.stats.reallocatedPracticalLights,
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
    pulseGarageInterior: true,
    pulseGarageInteriorMeshes: pulseGarageInterior.stats.renderMeshes,
    pulseGarageInteriorCollisionVolumes: pulseGarageInterior.stats.collisionVolumes,
    pulseGarageInteriorStations: pulseGarageInterior.stats.stations,
    pulseGarageInteriorPracticalLights: pulseGarageInterior.stats.practicalLights,
    residentialInterior: true,
    residentialInteriorInstances: residentialInterior.stats.renderInstances,
    residentialInteriorCollisionVolumes: residentialInterior.stats.collisionVolumes,
    residentialInteriorRooms: residentialInterior.stats.rooms,
    residentialInteriorStations: residentialInterior.stats.stations,
    residentialInteriorPracticalLights: residentialInterior.stats.practicalLights,
    communityHub: true,
    communityHubInstances: communityHub.stats.renderInstances,
    communityHubCollisionVolumes: communityHub.stats.collisionVolumes,
    communityHubRooms: communityHub.stats.rooms,
    communityHubStations: communityHub.stats.stations,
    communityHubPracticalLights: communityHub.stats.practicalLights,
    commonGroundCafe: true,
    commonGroundCafeInstances: commonGroundCafe.stats.renderInstances,
    commonGroundCafeFrontageInstances: commonGroundCafe.stats.frontageRenderInstances,
    commonGroundCafeCollisionVolumes: commonGroundCafe.stats.collisionVolumes,
    commonGroundCafeRooms: commonGroundCafe.stats.rooms,
    commonGroundCafeStations: commonGroundCafe.stats.stations,
    commonGroundCafePracticalLights: commonGroundCafe.stats.practicalLights,
    minaMarketKitchen: true,
    minaMarketKitchenInstances: minaMarketKitchen.stats.renderInstances,
    minaMarketKitchenCollisionVolumes: minaMarketKitchen.stats.collisionVolumes,
    minaMarketKitchenRooms: minaMarketKitchen.stats.rooms,
    minaMarketKitchenStations: minaMarketKitchen.stats.stations,
    minaMarketKitchenOccupancySlots: minaMarketKitchen.stats.occupancySlots,
    minaMarketKitchenItineraries: minaMarketKitchen.stats.itineraries,
    minaMarketKitchenPracticalLights: minaMarketKitchen.stats.practicalLights,
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
    roadCenters: mapFeatures.roads,
    mapFeatures,
    buildings: buildingRecords,
    districts: DISTRICTS,
    districtAt,
    spawnPoints,
    pedestrianNodes,
    missionPoints,
    businesses,
    businessFrontages,
    residentialInterior,
    communityHub,
    commonGroundCafe,
    minaMarketKitchen,
    pulseGarageInterior,
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
