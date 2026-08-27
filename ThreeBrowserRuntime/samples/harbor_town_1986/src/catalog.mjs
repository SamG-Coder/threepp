import { DOCK_SURFACE_Y, STAIR_SPEC, groundHeight, stairSurfaceHeight } from "./map.mjs";

const QUAY_SEAWALL_HEIGHT = 2.7;
const QUAY_SEAWALL_SUPPORT_Y = DOCK_SURFACE_Y - QUAY_SEAWALL_HEIGHT;

export const CARDINAL_VIEWS = Object.freeze([
  { yaw: 0, file: "yaw-000.png", label: "front" },
  { yaw: 90, file: "yaw-090.png", label: "right" },
  { yaw: 180, file: "yaw-180.png", label: "back" },
  { yaw: 270, file: "yaw-270.png", label: "left" },
]);

export const CYLINDER_VIEWS = Object.freeze([
  { yaw: 0, file: "yaw-000.png", label: "front" },
  { yaw: 90, file: "yaw-090.png", label: "right" },
]);

export const HUMANOID_VIEWS = Object.freeze([
  { yaw: 0, file: "yaw-000.png", label: "front" },
  { yaw: 45, file: "yaw-045.png", label: "front-right" },
  { yaw: 90, file: "yaw-090.png", label: "right" },
  { yaw: 135, file: "yaw-135.png", label: "back-right" },
  { yaw: 180, file: "yaw-180.png", label: "back" },
  { yaw: 225, file: "yaw-225.png", label: "back-left" },
  { yaw: 270, file: "yaw-270.png", label: "left" },
  { yaw: 315, file: "yaw-315.png", label: "front-left" },
]);

/**
 * Authored layout records. Composite ids in this list supply only their original
 * dimensions and world transforms; their old whole-object folders are never put
 * into the active reconstruction stream.
 */
const AUTHORED_ASSET_LAYOUT = Object.freeze([
  {
    id: "soba-shop",
    folder: "soba-shop",
    label: "Nishiya soba",
    kind: "rectangle",
    district: "sakae",
    x: -17,
    y: 0,
    z: -12.6,
    yaw: 0,
    realHeight: 7.2,
    realWidth: 6.4,
    realDepth: 8.2,
  },
  {
    id: "you-arcade",
    folder: "you-arcade",
    label: "Starlight Arcade",
    kind: "rectangle",
    district: "sakae",
    x: 8.4,
    y: 0,
    z: -13.5,
    yaw: 0,
    realHeight: 7.8,
    realWidth: 8.0,
    realDepth: 10,
  },
  {
    id: "harbor-warehouse-8",
    folder: "harbor-warehouse-8",
    label: "Warehouse 8",
    kind: "rectangle",
    district: "amihama",
    x: -12,
    z: 72,
    yaw: Math.PI,
    realHeight: 8.2,
    realWidth: 8.5,
    realDepth: 11,
  },
  {
    id: "vending-enamel",
    folder: "vending-enamel",
    label: "Enamel vending machine",
    kind: "rectangle",
    district: "sakae",
    x: -5.2,
    z: -8.1,
    yaw: 0,
    realHeight: 1.82,
    realWidth: 0.9,
    realDepth: 0.72,
  },
  {
    id: "phone-booth",
    folder: "phone-booth",
    label: "Green phone booth",
    kind: "rectangle",
    district: "sakae",
    x: 16.5,
    z: 8.05,
    yaw: Math.PI,
    realHeight: 2.4,
    realWidth: 0.9,
    realDepth: 0.9,
  },
  {
    id: "telephone-pole",
    folder: "telephone-pole",
    label: "Concrete telephone pole",
    kind: "cylinder",
    district: "sakae",
    x: -22,
    z: 5.6,
    yaw: 0,
    realHeight: 10,
    realWidth: 0.35,
    realDepth: 0.35,
  },
  {
    id: "civilian-hiro",
    folder: "civilian-hiro",
    label: "Hiro",
    kind: "humanoid",
    district: "sakae",
    x: -9.2,
    z: -7.3,
    yaw: Math.PI,
    realHeight: 1.72,
    realWidth: 0.52,
    realDepth: 0.32,
    ambientOnly: true,
  },
  {
    id: "wooden-hill-house",
    folder: "wooden-hill-house",
    label: "Suzume-zaka house",
    kind: "rectangle",
    district: "suzume",
    x: -28,
    z: -34,
    yaw: 0.42,
    realHeight: 7.4,
    realWidth: 8.2,
    realDepth: 7.6,
  },
  {
    id: "yokobori-bar",
    folder: "yokobori-bar",
    label: "Galaxy sakaba",
    kind: "rectangle",
    district: "yokobori",
    x: 26,
    z: 16,
    yaw: -Math.PI / 2,
    realHeight: 7.6,
    realWidth: 5.2,
    realDepth: 5.5,
  },
  {
    id: "flower-shop",
    folder: "flower-shop",
    label: "Midori florist",
    kind: "rectangle",
    district: "sakae",
    x: -10,
    y: 0,
    z: 12.4,
    yaw: Math.PI,
    realHeight: 6.8,
    realWidth: 6.6,
    realDepth: 7.8,
  },
  {
    id: "cassette-shop",
    folder: "cassette-shop",
    label: "Minato-machi records",
    kind: "rectangle",
    district: "sakae",
    x: 17.8,
    y: 0,
    z: -10.9,
    yaw: 0,
    realHeight: 7.1,
    realWidth: 6.2,
    realDepth: 4.8,
  },
  {
    id: "greengrocer",
    folder: "greengrocer",
    label: "Yaoya",
    kind: "rectangle",
    district: "sakae",
    x: -9,
    y: 0,
    z: -11.6,
    yaw: 0,
    realHeight: 6.9,
    realWidth: 5.4,
    realDepth: 6.2,
  },
  {
    id: "tobacco-shop",
    folder: "tobacco-shop",
    label: "Kamimura tobacco",
    kind: "rectangle",
    district: "sakae",
    x: -26,
    y: 0,
    z: -11.3,
    yaw: 0,
    realHeight: 7.0,
    realWidth: 5.2,
    realDepth: 5.6,
  },
  {
    id: "harbor-warehouse-3",
    folder: "harbor-warehouse-3",
    label: "Warehouse 3",
    kind: "rectangle",
    district: "amihama",
    x: 16,
    z: 70,
    yaw: Math.PI,
    realHeight: 8.2,
    realWidth: 16,
    realDepth: 12,
  },
  {
    id: "kei-van",
    folder: "kei-van",
    label: "Suzuki Carry",
    kind: "rectangle",
    district: "sakae",
    x: 6,
    z: -4.4,
    yaw: Math.PI / 2,
    realHeight: 1.78,
    realWidth: 1.4,
    realDepth: 3.2,
  },
  {
    id: "pharmacy",
    folder: "pharmacy",
    label: "Minato-machi pharmacy",
    kind: "rectangle",
    district: "sakae",
    x: 0,
    y: 0,
    z: -12.3,
    yaw: 0,
    realHeight: 7.0,
    realWidth: 6.6,
    realDepth: 7.6,
  },
  {
    id: "barber-shop",
    folder: "barber-shop",
    label: "Haru barber",
    kind: "rectangle",
    district: "sakae",
    x: 6,
    y: 0,
    z: 12.2,
    yaw: Math.PI,
    realHeight: 7.0,
    realWidth: 6.2,
    realDepth: 7.4,
  },
  {
    id: "hardware-shop",
    folder: "hardware-shop",
    label: "Yamato kanagu",
    kind: "rectangle",
    district: "sakae",
    x: -34,
    y: 0,
    z: -11.9,
    yaw: 0,
    realHeight: 7.0,
    realWidth: 6.4,
    realDepth: 6.8,
  },
  {
    id: "kissaten",
    folder: "kissaten",
    label: "Kissa Miharu",
    kind: "rectangle",
    district: "sakae",
    x: 14,
    y: 0,
    z: 11.7,
    yaw: Math.PI,
    realHeight: 6.8,
    realWidth: 6.0,
    realDepth: 6.4,
  },
  {
    id: "english-oak",
    folder: "english-oak",
    label: "English oak",
    kind: "custom",
    district: "suzume",
    x: -42,
    z: -44,
    yaw: 0.2,
    realHeight: 7,
    realWidth: 7,
    realDepth: 7,
    collisionWidth: 1.4,
    collisionDepth: 1.4,
  },
  {
    id: "weeping-willow",
    folder: "weeping-willow",
    label: "Weeping willow",
    kind: "custom",
    district: "amihama",
    x: 46,
    z: 84,
    yaw: 0.4,
    realHeight: 6,
    realWidth: 5.5,
    realDepth: 5.5,
    collisionWidth: 0.9,
    collisionDepth: 0.9,
  },
  {
    id: "steel-bin",
    folder: "steel-bin",
    label: "Steel bin",
    kind: "custom",
    district: "sakae",
    x: -12,
    z: 6.6,
    yaw: 0,
    realHeight: 0.75,
    realWidth: 0.54,
    realDepth: 0.54,
  },
  {
    id: "zelkova",
    folder: "zelkova",
    label: "Street zelkova",
    kind: "custom",
    district: "suzume",
    x: -28,
    z: -20,
    yaw: 0,
    realHeight: 5.5,
    realWidth: 4.5,
    realDepth: 4.5,
    collisionWidth: 0.8,
    collisionDepth: 0.8,
  },
  {
    id: "honda-cub",
    folder: "honda-cub",
    label: "Delivery cub",
    kind: "custom",
    district: "sakae",
    x: -14.6,
    z: -6.35,
    yaw: Math.PI / 2,
    realHeight: 1.05,
    realWidth: 0.62,
    realDepth: 1.82,
  },
  {
    id: "oil-drum",
    folder: "oil-drum",
    label: "Kerosene drum",
    kind: "cylinder",
    district: "amihama",
    x: -20,
    z: 80,
    yaw: 0,
    realHeight: 0.88,
    realWidth: 0.58,
    realDepth: 0.58,
  },
  {
    id: "crate-stack",
    folder: "crate-stack",
    label: "Harbor crates",
    kind: "rectangle",
    district: "amihama",
    x: -4,
    z: 78,
    yaw: 0.2,
    realHeight: 1.6,
    realWidth: 1.4,
    realDepth: 0.9,
  },
  {
    id: "city-bus",
    folder: "city-bus",
    label: "Minamihama bus",
    kind: "rectangle",
    district: "route16",
    x: -38.2,
    z: 22,
    yaw: 0,
    realHeight: 3.05,
    realWidth: 2.5,
    realDepth: 10.4,
  },
  {
    id: "civilian-mika",
    folder: "civilian-mika",
    label: "Mika",
    kind: "humanoid",
    district: "sakae",
    x: -2.2,
    z: 6.9,
    yaw: Math.PI,
    realHeight: 1.62,
    realWidth: 0.48,
    realDepth: 0.3,
    ambientOnly: true,
  },
  {
    id: "civilian-dock-worker",
    folder: "civilian-dock-worker",
    label: "Dock worker",
    kind: "humanoid",
    district: "amihama",
    x: -14,
    z: 80,
    yaw: 2.8,
    realHeight: 1.68,
    realWidth: 0.56,
    realDepth: 0.34,
    ambientOnly: true,
  },
  {
    id: "city-bicycle",
    folder: "city-bicycle",
    label: "City bicycle",
    kind: "custom",
    district: "sakae",
    x: 11.6,
    z: -6.35,
    yaw: Math.PI / 2,
    realHeight: 1.12,
    realWidth: 0.58,
    realDepth: 1.82,
  },
  {
    id: "kei-sedan",
    folder: "kei-sedan",
    label: "Kei sedan",
    kind: "rectangle",
    district: "sakae",
    x: 30,
    z: 5.2,
    yaw: -Math.PI / 2,
    realHeight: 1.38,
    realWidth: 1.42,
    realDepth: 3.25,
  },
  {
    id: "park-bench",
    folder: "park-bench",
    label: "Park bench",
    kind: "rectangle",
    district: "suzume",
    x: -14.4,
    z: -17.2,
    yaw: Math.PI,
    realHeight: 0.86,
    realWidth: 1.82,
    realDepth: 0.68,
  },
  {
    id: "dock-forklift",
    folder: "dock-forklift",
    label: "Dock forklift",
    kind: "rectangle",
    district: "amihama",
    x: 4,
    z: 68,
    yaw: Math.PI / 2,
    realHeight: 2.15,
    realWidth: 1.25,
    realDepth: 2.65,
  },
  {
    id: "fishing-boat",
    folder: "fishing-boat",
    label: "Fishing boat",
    kind: "custom",
    district: "amihama",
    x: 0,
    // Keel datum: 0.55 m below the authored -0.40 m water surface.
    y: -0.95,
    z: 98,
    yaw: 0,
    realHeight: 3.9,
    realWidth: 2.15,
    realDepth: 7.2,
    ambientOnly: true,
  },
  {
    id: "civilian-shopper",
    folder: "civilian-shopper",
    label: "Saturday shopper",
    kind: "humanoid",
    district: "sakae",
    x: -8.4,
    z: 6.9,
    yaw: 1.4,
    realHeight: 1.58,
    realWidth: 0.48,
    realDepth: 0.32,
    ambientOnly: true,
  },
  {
    id: "civilian-student",
    folder: "civilian-student",
    label: "Student",
    kind: "humanoid",
    district: "sakae",
    x: 10.8,
    z: -6.9,
    yaw: -1.2,
    realHeight: 1.66,
    realWidth: 0.5,
    realDepth: 0.32,
    ambientOnly: true,
  },
  {
    id: "civilian-shopkeeper",
    folder: "civilian-shopkeeper",
    label: "Shopkeeper",
    kind: "humanoid",
    district: "yokobori",
    x: 19.4,
    z: 14.8,
    yaw: 3.2,
    realHeight: 1.69,
    realWidth: 0.54,
    realDepth: 0.34,
    ambientOnly: true,
  },
  {
    id: "harbor-gull",
    folder: "harbor-gull",
    label: "Harbor gull in flight",
    kind: "custom",
    district: "amihama",
    x: 0,
    y: 18,
    z: 118,
    yaw: 0,
    realHeight: 0.42,
    realWidth: 1.35,
    realDepth: 0.58,
    ambientOnly: true,
  },
  {
    id: "shop-hanging-sign",
    folder: "shop-hanging-sign",
    label: "Hanging shop sign",
    kind: "rectangle",
    district: "yokobori",
    x: 0,
    y: 3.4,
    z: 0,
    yaw: 0,
    realHeight: 0.95,
    realWidth: 0.58,
    realDepth: 0.12,
    ambientOnly: true,
  },
  {
    id: "dock-handcart",
    folder: "dock-handcart",
    label: "Dock handcart",
    kind: "rectangle",
    district: "amihama",
    x: -7,
    z: 78,
    yaw: 0.25,
    realHeight: 1.15,
    realWidth: 0.92,
    realDepth: 1.7,
  },
  {
    id: "hill-stairway",
    folder: "hill-stairway",
    label: "Suzume-zaka stone stairway",
    kind: "custom",
    district: "suzume",
    x: -20,
    y: 0,
    z: -18.18,
    yaw: 0,
    realHeight: 3.5,
    realWidth: 7.2,
    realDepth: 13,
    walkable: true,
  },
  {
    id: "quay-seawall-segment",
    folder: "quay-seawall-segment",
    label: "Amihama quay wall segment",
    kind: "rectangle",
    district: "amihama",
    x: -40,
    y: QUAY_SEAWALL_SUPPORT_Y,
    z: 88.55,
    yaw: Math.PI,
    realHeight: QUAY_SEAWALL_HEIGHT,
    realWidth: 8,
    realDepth: 1.8,
  },
]);

const COMPOSITE_IDS = new Set([
  "soba-shop",
  "you-arcade",
  "yokobori-bar",
  "flower-shop",
  "cassette-shop",
  "greengrocer",
  "tobacco-shop",
  "pharmacy",
  "barber-shop",
  "hardware-shop",
  "kissaten",
  "wooden-hill-house",
  "harbor-warehouse-8",
  "harbor-warehouse-3",
  "kei-sedan",
  "kei-van",
  "city-bus",
  "hill-stairway",
  "quay-seawall-segment",
]);

const AUTHORED_BY_ID = new Map(AUTHORED_ASSET_LAYOUT.map(subject => [subject.id, subject]));

function authored(id) {
  const subject = AUTHORED_BY_ID.get(id);
  if (!subject) throw new Error(`Missing authored layout record for ${id}`);
  return subject;
}

function reconstructedModule(id, label, realWidth, realHeight, realDepth, options = {}) {
  return Object.freeze({
    id,
    folder: id,
    label,
    kind: options.kind ?? "rectangle",
    viewSet: options.viewSet ?? "cardinal",
    district: "component-library",
    realWidth,
    realHeight,
    realDepth,
    moduleOnly: true,
  });
}

const STREET_BUILDINGS = Object.freeze([
  { id: "soba-shop", facade: "facade-soba-shop", wall: "town-wall-window-tile" },
  {
    id: "you-arcade",
    facade: "facade-you-arcade",
    wall: "town-wall-window-tile",
    serviceShutter: true,
  },
  { id: "yokobori-bar", facade: "facade-yokobori-bar", wall: "town-wall-window-plaster" },
  { id: "flower-shop", facade: "facade-flower-shop", wall: "town-wall-window-plaster" },
  { id: "cassette-shop", facade: "facade-cassette-shop", wall: "town-wall-window-tile" },
  { id: "greengrocer", facade: "facade-greengrocer", wall: "town-wall-window-plaster" },
  { id: "tobacco-shop", facade: "facade-tobacco-shop", wall: "town-wall-window-tile" },
  { id: "pharmacy", facade: "facade-pharmacy", wall: "town-wall-window-tile" },
  { id: "barber-shop", facade: "facade-barber-shop", wall: "town-wall-window-plaster" },
  {
    id: "hardware-shop",
    facade: "facade-hardware-shop",
    wall: "town-wall-window-plaster",
    serviceShutter: true,
  },
  { id: "kissaten", facade: "facade-kissaten", wall: "town-wall-window-plaster" },
]);

const CORE_MODULE_SUBJECTS = Object.freeze([
  reconstructedModule("stone-step-slab", "Weathered stone step slab", 1.08, 0.30, 1.12),
  reconstructedModule("stone-side-wall-course", "Stone stair side-wall course", 0.75, 0.55, 1.12),
  reconstructedModule("stone-cap-slab", "Stone wall cap slab", 0.85, 0.15, 1.16),
  reconstructedModule("quay-wall-block", "Amihama quay wall block", 4.0, 0.86, 1.6),
  reconstructedModule("quay-edge-cap", "Amihama quay edge cap", 2.0, 0.12, 1.9),

  reconstructedModule("town-wall-window-plaster", "Plaster town window bay", 2.0, 3.0, 0.32),
  reconstructedModule("town-wall-window-tile", "Tile town window bay", 2.0, 3.0, 0.32),
  reconstructedModule("town-wall-blank", "Blank town wall bay", 2.0, 3.0, 0.32),
  reconstructedModule("town-corner-post", "Town corner post", 0.35, 3.0, 0.35),
  reconstructedModule("town-roof-slab", "Town roof slab", 2.0, 0.32, 2.0),
  reconstructedModule("town-shopfront-shutter", "Rear shop shutter bay", 2.0, 3.0, 0.45),

  reconstructedModule("wood-house-wall-window", "Wood house window bay", 2.0, 3.0, 0.32),
  reconstructedModule("wood-house-wall-blank", "Blank wood house wall bay", 2.0, 3.0, 0.32),
  reconstructedModule("wood-house-door-bay", "Wood house door bay", 2.0, 3.0, 0.42),
  reconstructedModule(
    "wood-house-roof-bay",
    "Gabled wood house roof bay",
    2.0,
    1.4,
    7.8,
    { kind: "custom", viewSet: "cardinal" },
  ),

  reconstructedModule("warehouse-wall-bay", "Harbor warehouse wall bay", 2.5, 7.0, 0.4),
  reconstructedModule("warehouse-door-bay", "Harbor warehouse door bay", 3.0, 4.2, 0.5),
  reconstructedModule("warehouse-upper-bay", "Harbor warehouse upper bay", 3.0, 2.8, 0.4),
  reconstructedModule(
    "warehouse-roof-bay",
    "Gabled harbor warehouse roof bay",
    2.5,
    1.2,
    12.0,
    { kind: "custom", viewSet: "cardinal" },
  ),

  reconstructedModule(
    "road-wheel",
    "Kei vehicle road wheel",
    0.22,
    0.52,
    0.52,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "bus-wheel",
    "City bus wheel",
    0.30,
    0.84,
    0.84,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "kei-sedan-body",
    "Kei sedan lower body",
    1.42,
    0.72,
    3.25,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "kei-sedan-cabin",
    "Kei sedan cabin",
    1.22,
    0.66,
    1.65,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "kei-van-lower-body",
    "Kei van lower body",
    1.40,
    0.64,
    3.20,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "kei-van-cab",
    "Kei van cab",
    1.28,
    1.13,
    1.32,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "kei-van-cargo-box",
    "Kei van cargo box",
    1.34,
    0.98,
    1.55,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "city-bus-lower-body",
    "City bus lower body",
    2.50,
    0.92,
    10.4,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "city-bus-passenger-body",
    "City bus passenger body",
    2.42,
    1.76,
    9.65,
    { kind: "custom", viewSet: "cardinal" },
  ),
  reconstructedModule(
    "city-bus-roof",
    "City bus roof",
    2.34,
    0.32,
    9.5,
    { kind: "custom", viewSet: "cardinal" },
  ),
]);

const FACADE_MODULE_SUBJECTS = Object.freeze(STREET_BUILDINGS.map(spec => {
  const source = authored(spec.id);
  return reconstructedModule(
    spec.facade,
    `${source.label} complete street facade`,
    source.realWidth,
    source.realHeight,
    0.45,
  );
}));

/** Active Grok-orbit reconstructions. Modules are reconstructed but never planted by themselves. */
export const ORBIT_SUBJECTS = Object.freeze([
  ...AUTHORED_ASSET_LAYOUT.filter(subject => !COMPOSITE_IDS.has(subject.id)),
  ...CORE_MODULE_SUBJECTS,
  ...FACADE_MODULE_SUBJECTS,
]);

/**
 * Fill a span without overlapping reconstructed modules. Full bays retain their
 * source scale; a single fractional end bay closes only the indivisible remainder.
 */
function tiledSpan(length, bayWidth) {
  const safeLength = Math.max(0, Number(length) || 0);
  const safeBay = Math.max(1e-6, Number(bayWidth) || 0);
  const fullCount = Math.floor((safeLength + 1e-6) / safeBay);
  const result = [];
  let cursor = -safeLength * 0.5;
  for (let index = 0; index < fullCount; index++) {
    result.push(Object.freeze({ center: cursor + safeBay * 0.5, scale: 1, fractional: false }));
    cursor += safeBay;
  }
  const remainder = Math.max(0, safeLength - fullCount * safeBay);
  if (remainder > 1e-6) {
    result.push(Object.freeze({
      center: cursor + remainder * 0.5,
      scale: remainder / safeBay,
      fractional: true,
    }));
  }
  return result;
}

function tiledInterval(min, max, bayWidth) {
  const length = Math.max(0, max - min);
  const offset = (min + max) * 0.5;
  return tiledSpan(length, bayWidth).map(tile => Object.freeze({
    ...tile,
    center: tile.center + offset,
  }));
}

function tiledHeight(height, bayHeight) {
  const safeHeight = Math.max(0, Number(height) || 0);
  const safeBay = Math.max(1e-6, Number(bayHeight) || 0);
  const fullCount = Math.floor((safeHeight + 1e-6) / safeBay);
  const result = Array.from({ length: fullCount }, (_, index) => Object.freeze({
    y: index * safeBay,
    scale: 1,
    fractional: false,
  }));
  const remainder = Math.max(0, safeHeight - fullCount * safeBay);
  if (remainder > 1e-6) {
    result.push(Object.freeze({
      y: fullCount * safeBay,
      scale: remainder / safeBay,
      fractional: true,
    }));
  }
  return result;
}

function freezeAssembly(spec) {
  return Object.freeze({
    ...spec,
    parts: Object.freeze(spec.parts.map(part => Object.freeze({
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      ...part,
    }))),
  });
}

function assemblyFromAuthored(source, parts, overrides = {}) {
  return freezeAssembly({
    id: source.id,
    label: source.label,
    district: source.district,
    x: source.x,
    y: source.y,
    z: source.z,
    yaw: source.yaw ?? 0,
    realWidth: source.realWidth,
    realHeight: source.realHeight,
    realDepth: source.realDepth,
    collisionWidth: source.collisionWidth ?? source.realWidth,
    collisionDepth: source.collisionDepth ?? source.realDepth,
    ...overrides,
    parts,
  });
}

function townBuildingAssembly(config) {
  const source = authored(config.id);
  const parts = [{
    module: config.facade,
    z: source.realDepth * 0.5 - 0.225,
    label: `${source.label} front facade`,
  }];
  const shellHeight = source.realHeight;
  const rows = tiledHeight(shellHeight, 3.0);
  const backX = tiledSpan(source.realWidth, 2.0);
  // Side bays fill only between the inner faces of the sealed front/back
  // modules, so reconstructed wall volumes meet instead of intersecting.
  const sideZ = tiledInterval(
    -source.realDepth * 0.5 + 0.32,
    source.realDepth * 0.5 - 0.45,
    2.0,
  );

  for (const [rowIndex, row] of rows.entries()) {
    for (const [index, bay] of backX.entries()) {
      parts.push({
        module: row.fractional || bay.fractional || (index + rowIndex) % 3 === 0
          ? "town-wall-blank"
          : config.wall,
        x: bay.center,
        y: row.y,
        z: -source.realDepth * 0.5 + 0.16,
        yaw: Math.PI,
        scaleX: bay.scale,
        scaleY: row.scale,
      });
    }
    for (const [index, bay] of sideZ.entries()) {
      const module = row.fractional || bay.fractional || (index + rowIndex) % 4 === 0
        ? "town-wall-blank"
        : config.wall;
      const common = {
        module,
        y: row.y,
        z: bay.center,
        scaleX: bay.scale,
        scaleY: row.scale,
      };
      parts.push({ ...common, x: source.realWidth * 0.5 - 0.16, yaw: Math.PI / 2 });
      parts.push({ ...common, x: -source.realWidth * 0.5 + 0.16, yaw: -Math.PI / 2 });
    }
    // Posts sit 12 mm proud of both wall planes, avoiding coplanar trim/facade faces.
    for (const sideX of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        parts.push({
          module: "town-corner-post",
          x: sideX * (source.realWidth * 0.5 - 0.175 + 0.012),
          y: row.y,
          z: sideZ * (source.realDepth * 0.5 - 0.175 + 0.012),
          scaleY: row.scale,
        });
      }
    }
  }

  // A small inset keeps the roof's vertical edge faces behind the sealed wall shell.
  for (const xBay of tiledSpan(source.realWidth - 0.08, 2.0)) {
    for (const zBay of tiledSpan(source.realDepth - 0.08, 2.0)) {
      parts.push({
        module: "town-roof-slab",
        x: xBay.center,
        y: source.realHeight,
        z: zBay.center,
        scaleX: xBay.scale,
        scaleZ: zBay.scale,
      });
    }
  }
  if (config.serviceShutter) {
    parts.push({
      module: "town-shopfront-shutter",
      y: 0,
      z: -source.realDepth * 0.5 - 0.08,
      yaw: Math.PI,
      label: `${source.label} rear service shutter`,
    });
  }
  return assemblyFromAuthored(source, parts, {
    realHeight: source.realHeight + 0.32,
    // Proud corner posts add 12 mm at each edge. A rear shutter reaches
    // 0.305 m beyond its back datum, so its centered whole-object footprint
    // needs 0.61 m extra depth independent of caller-selected padding.
    collisionWidth: source.realWidth + 0.024,
    collisionDepth: source.realDepth + (config.serviceShutter ? 0.61 : 0.024),
  });
}

function woodenHouseAssembly() {
  const source = authored("wooden-hill-house");
  const parts = [];
  const acrossWidth = tiledSpan(source.realWidth, 2.0);
  const alongDepth = tiledInterval(
    -source.realDepth * 0.5 + 0.32,
    source.realDepth * 0.5 - 0.32,
    2.0,
  );
  const frontWindowZ = source.realDepth * 0.5 - 0.16;
  const frontDoorZ = source.realDepth * 0.5 - 0.21;
  const backZ = -source.realDepth * 0.5 + 0.16;
  const doorBay = acrossWidth
    .filter(bay => !bay.fractional)
    .reduce((best, bay) => (!best || Math.abs(bay.center) < Math.abs(best.center) ? bay : best), null);

  for (const y of [0, 3.0]) {
    for (const bay of acrossWidth) {
      const lowerDoor = y === 0 && bay === doorBay;
      parts.push({
        module: lowerDoor
          ? "wood-house-door-bay"
          : bay.fractional ? "wood-house-wall-blank" : "wood-house-wall-window",
        x: bay.center,
        y,
        z: lowerDoor ? frontDoorZ : frontWindowZ,
        scaleX: bay.scale,
      });
      parts.push({
        module: y === 0 || bay.fractional ? "wood-house-wall-blank" : "wood-house-wall-window",
        x: bay.center,
        y,
        z: backZ,
        yaw: Math.PI,
        scaleX: bay.scale,
      });
    }
    for (const [index, bay] of alongDepth.entries()) {
      const module = bay.fractional || (index + (y > 0 ? 1 : 0)) % 3 === 0
        ? "wood-house-wall-blank"
        : "wood-house-wall-window";
      const common = { module, y, z: bay.center, scaleX: bay.scale };
      parts.push({ ...common, x: source.realWidth * 0.5 - 0.16, yaw: Math.PI / 2 });
      parts.push({ ...common, x: -source.realWidth * 0.5 + 0.16, yaw: -Math.PI / 2 });
    }
  }
  for (const bay of acrossWidth) {
    parts.push({
      module: "wood-house-roof-bay",
      x: bay.center,
      y: 6.0,
      z: 0,
      scaleX: bay.scale,
    });
  }
  return assemblyFromAuthored(source, parts, {
    collisionDepth: 7.8,
  });
}

function warehouseAssembly(id) {
  const source = authored(id);
  const parts = [];
  const halfWidth = source.realWidth * 0.5;
  const frontZ = source.realDepth * 0.5 - 0.25;
  const backZ = -source.realDepth * 0.5 + 0.2;

  for (const bay of tiledInterval(-halfWidth, -1.5, 2.5)) {
    parts.push({ module: "warehouse-wall-bay", x: bay.center, z: frontZ, scaleX: bay.scale });
  }
  for (const bay of tiledInterval(1.5, halfWidth, 2.5)) {
    parts.push({ module: "warehouse-wall-bay", x: bay.center, z: frontZ, scaleX: bay.scale });
  }
  parts.push({ module: "warehouse-door-bay", x: 0, y: 0, z: frontZ - 0.05 });
  parts.push({ module: "warehouse-upper-bay", x: 0, y: 4.2, z: frontZ });

  for (const bay of tiledSpan(source.realWidth, 2.5)) {
    parts.push({
      module: "warehouse-wall-bay",
      x: bay.center,
      z: backZ,
      yaw: Math.PI,
      scaleX: bay.scale,
    });
  }
  for (const bay of tiledInterval(
    -source.realDepth * 0.5 + 0.40,
    source.realDepth * 0.5 - 0.45,
    2.5,
  )) {
    const common = { module: "warehouse-wall-bay", z: bay.center, scaleX: bay.scale };
    parts.push({ ...common, x: halfWidth - 0.2, yaw: Math.PI / 2 });
    parts.push({ ...common, x: -halfWidth + 0.2, yaw: -Math.PI / 2 });
  }
  for (const bay of tiledSpan(source.realWidth, 2.5)) {
    parts.push({
      module: "warehouse-roof-bay",
      x: bay.center,
      y: 7.0,
      z: 0,
      scaleX: bay.scale,
      scaleZ: Math.min(1, (source.realDepth + 0.4) / 12.0),
    });
  }
  return assemblyFromAuthored(source, parts, {
    collisionDepth: Math.min(12.0, source.realDepth + 0.4),
  });
}

function vehicleAssembly(id, parts) {
  return assemblyFromAuthored(authored(id), parts);
}

function keiSedanAssembly() {
  const wheelX = 0.60;
  const wheelZ = 1.08;
  const parts = [
    { module: "kei-sedan-body", y: 0.20 },
    { module: "kei-sedan-cabin", y: 0.72, z: -0.12 },
  ];
  for (const x of [-wheelX, wheelX]) {
    for (const z of [-wheelZ, wheelZ]) parts.push({ module: "road-wheel", x, y: 0, z });
  }
  return vehicleAssembly("kei-sedan", parts);
}

function keiVanAssembly() {
  const parts = [
    { module: "kei-van-lower-body", y: 0.20 },
    // Cab and cargo meet at z=0.115 with equal 0.165 m bumper margins
    // inside the 3.20 m lower body; the previous transforms left a 0.28 m gap.
    { module: "kei-van-cab", y: 0.64, z: 0.775 },
    { module: "kei-van-cargo-box", y: 0.64, z: -0.66 },
  ];
  for (const x of [-0.59, 0.59]) {
    for (const z of [-1.05, 1.05]) parts.push({ module: "road-wheel", x, y: 0, z });
  }
  return vehicleAssembly("kei-van", parts);
}

function cityBusAssembly() {
  const parts = [
    { module: "city-bus-lower-body", y: 0.34 },
    { module: "city-bus-passenger-body", y: 0.92 },
    { module: "city-bus-roof", y: 2.68 },
  ];
  for (const x of [-1.10, 1.10]) {
    for (const z of [-3.60, 3.60]) parts.push({ module: "bus-wheel", x, y: 0, z });
  }
  return vehicleAssembly("city-bus", parts);
}

function stairAssembly() {
  const parts = [];
  const centreZ = STAIR_SPEC.z0 - (STAIR_SPEC.steps - 1) * STAIR_SPEC.run * 0.5;
  const slabXs = Array.from({ length: 6 }, (_, index) => (index - 2.5) * 1.08);
  let maxTop = 0;
  for (let step = 0; step < STAIR_SPEC.steps; step++) {
    const worldZ = STAIR_SPEC.z0 - step * STAIR_SPEC.run;
    const sampled = Number(stairSurfaceHeight(STAIR_SPEC.x, worldZ));
    const top = Number.isFinite(sampled)
      ? sampled
      : groundHeight(STAIR_SPEC.x, worldZ) + 0.30;
    maxTop = Math.max(maxTop, top + 0.55);
    for (const x of slabXs) {
      parts.push({ module: "stone-step-slab", x, y: top - 0.30, z: worldZ - centreZ });
    }
    for (const x of [
      -STAIR_SPEC.width * 0.5 - 0.375,
      STAIR_SPEC.width * 0.5 + 0.375,
    ]) {
      parts.push({
        module: "stone-side-wall-course",
        x,
        y: top - 0.15,
        z: worldZ - centreZ,
      });
      parts.push({
        module: "stone-cap-slab",
        x,
        y: top + 0.40,
        z: worldZ - centreZ,
      });
    }
  }
  return freezeAssembly({
    id: "hill-stairway",
    label: "Suzume-zaka modular stone stairway",
    district: "suzume",
    x: STAIR_SPEC.x,
    y: 0,
    z: centreZ,
    yaw: 0,
    // Cap slabs overhang the 0.75 m side courses by 0.05 m per outer edge.
    realWidth: STAIR_SPEC.width + 1.6,
    realHeight: maxTop,
    realDepth: (STAIR_SPEC.steps - 1) * STAIR_SPEC.run + 1.16,
    collisionWidth: STAIR_SPEC.width + 1.6,
    collisionDepth: (STAIR_SPEC.steps - 1) * STAIR_SPEC.run + 1.16,
    walkable: true,
    parts,
  });
}

function quayAssembly() {
  const parts = [];
  for (let course = 0; course < 3; course++) {
    const centres = course === 1
      ? Array.from({ length: 25 }, (_, index) => -48 + index * 4)
      : Array.from({ length: 24 }, (_, index) => -46 + index * 4);
    for (const x of centres) {
      parts.push({ module: "quay-wall-block", x, y: course * 0.86, z: 0 });
    }
  }
  for (let index = 0; index < 48; index++) {
    parts.push({ module: "quay-edge-cap", x: -47 + index * 2, y: 2.58, z: 0 });
  }
  return freezeAssembly({
    id: "quay-seawall",
    label: "Amihama modular quay wall",
    district: "amihama",
    x: 4,
    y: QUAY_SEAWALL_SUPPORT_Y,
    z: 88.55,
    yaw: Math.PI,
    // The staggered middle course projects one half-block beyond each end;
    // model and collision bounds include that full reconstructed footprint.
    realWidth: 100,
    realHeight: QUAY_SEAWALL_HEIGHT,
    realDepth: 1.9,
    collisionWidth: 100,
    collisionDepth: 1.9,
    parts,
  });
}

/** Logical whole objects assembled exclusively from reconstructed Grok-image modules. */
export const WORLD_ASSEMBLIES = Object.freeze([
  ...STREET_BUILDINGS.map(townBuildingAssembly),
  woodenHouseAssembly(),
  warehouseAssembly("harbor-warehouse-8"),
  warehouseAssembly("harbor-warehouse-3"),
  keiSedanAssembly(),
  keiVanAssembly(),
  cityBusAssembly(),
  stairAssembly(),
  quayAssembly(),
]);

const AUTHORED_INSTANCES = Object.freeze([
  { asset: "vending-enamel", x: 18.5, z: -8.1, yaw: 0 },
  { asset: "vending-enamel", x: -31, z: 8.1, yaw: Math.PI },
  { asset: "vending-enamel", x: 12.4, z: 8.1, yaw: Math.PI },
  { asset: "telephone-pole", x: -4, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: 16, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: 36, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: -22, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: 28, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: -36, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: 8, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: -38, z: -6.4, yaw: 0 },
  { asset: "telephone-pole", x: -8, z: -6.4, yaw: 0 },
  // Keep the x=18 eastern crosswalk physically clear for pedestrians.
  { asset: "telephone-pole", x: 14.6, z: -6.4, yaw: 0 },
  { asset: "telephone-pole", x: 38, z: -6.4, yaw: 0 },
  { asset: "telephone-pole", x: 6, z: 6.4, yaw: 0 },
  { asset: "telephone-pole", x: 40, z: 6.4, yaw: 0 },
  { asset: "vending-enamel", x: 10.2, z: -8.1, yaw: 0 },
  { asset: "vending-enamel", x: -28.6, z: -8.1, yaw: 0 },
  { asset: "vending-enamel", x: -10.8, z: -8.1, yaw: 0 },
  { asset: "vending-enamel", x: 21.94, z: 18.6, yaw: -Math.PI / 2 },
  { asset: "telephone-pole", x: 18.35, z: 11.4, yaw: 0 },
  { asset: "harbor-warehouse-8", x: -32, z: 72, yaw: Math.PI },
  { asset: "harbor-warehouse-8", x: 36, z: 72, yaw: Math.PI },
  { asset: "wooden-hill-house", x: -38, z: -40, yaw: 0.2 },
  { asset: "wooden-hill-house", x: -38, z: -22, yaw: 0.35 },
  { asset: "wooden-hill-house", x: -10.5, z: -30, yaw: -1.35 },
  { asset: "wooden-hill-house", x: -42, z: -30, yaw: 0.7 },
  { asset: "english-oak", x: -34, z: -48, yaw: 0.15 },
  { asset: "english-oak", x: -26, z: -48, yaw: -0.1 },
  { asset: "english-oak", x: -20, z: -42, yaw: 0.25 },
  { asset: "english-oak", x: -44, z: -16, yaw: 0.3 },
  { asset: "weeping-willow", x: -36, z: 84, yaw: 0.35 },
  { asset: "steel-bin", x: -24, z: 6.6, yaw: 0 },
  { asset: "steel-bin", x: -4, z: 6.6, yaw: 0 },
  { asset: "steel-bin", x: 8, z: 6.6, yaw: 0 },
  { asset: "steel-bin", x: 26, z: 6.6, yaw: 0 },
  { asset: "steel-bin", x: -34, z: -6.6, yaw: 0 },
  { asset: "steel-bin", x: -16, z: -6.6, yaw: 0 },
  { asset: "steel-bin", x: 2, z: -6.6, yaw: 0 },
  { asset: "steel-bin", x: 22, z: -6.6, yaw: 0 },
  { asset: "oil-drum", x: -8, z: 80, yaw: 0.4 },
  { asset: "oil-drum", x: 12, z: 81, yaw: 1.2 },
  { asset: "oil-drum", x: 24, z: 79, yaw: 0.1 },
  { asset: "oil-drum", x: -28, z: 78, yaw: 2.1 },
  { asset: "oil-drum", x: -36, z: 64, yaw: 0.6 },
  { asset: "oil-drum", x: 8, z: 64, yaw: 1.1 },
  { asset: "oil-drum", x: 28, z: 64, yaw: 0.3 },
  { asset: "crate-stack", x: -18, z: 76, yaw: 0.3 },
  { asset: "crate-stack", x: 6, z: 77, yaw: 1.0 },
  { asset: "crate-stack", x: 22, z: 80, yaw: 0.6 },
  { asset: "crate-stack", x: 20, z: 14, yaw: 0.2 },
  { asset: "crate-stack", x: -9.5, z: -5.9, yaw: 0.15 },
  { asset: "crate-stack", x: 32, z: 18, yaw: 0.7 },
  { asset: "crate-stack", x: -20, z: 66, yaw: 1.3 },
  { asset: "crate-stack", x: 40, z: 66, yaw: 0.4 },
  { asset: "kei-van", x: -8, z: -4.4, yaw: Math.PI / 2 },
  { asset: "kei-van", x: 18, z: -4.4, yaw: Math.PI / 2 },
  { asset: "kei-van", x: -28, z: 5.15, yaw: -Math.PI / 2 },
  { asset: "honda-cub", x: -6.4, z: -6.35, yaw: Math.PI / 2 },
  { asset: "honda-cub", x: 4.8, z: 6.45, yaw: -Math.PI / 2 },
  { asset: "honda-cub", x: 13.0, z: -6.4, yaw: Math.PI / 2 },
  { asset: "honda-cub", x: -32.2, z: 6.5, yaw: -Math.PI / 2 },
  { asset: "honda-cub", x: 28.4, z: 6.45, yaw: Math.PI / 2 },
  { asset: "vending-enamel", x: -18.4, z: -8.1, yaw: 0 },
  { asset: "vending-enamel", x: 32.2, z: -8.1, yaw: 0 },
  { asset: "vending-enamel", x: -22.6, z: 8.1, yaw: Math.PI },
  { asset: "vending-enamel", x: 16.8, z: 8.1, yaw: Math.PI },
  { asset: "phone-booth", x: -14.2, z: 8.0, yaw: Math.PI },
  { asset: "phone-booth", x: 8.6, z: -8.0, yaw: 0 },
  { asset: "telephone-pole", x: -42, z: 18, yaw: 0 },
  { asset: "telephone-pole", x: -42, z: 32, yaw: 0 },
  { asset: "telephone-pole", x: -42, z: 46, yaw: 0 },
  { asset: "telephone-pole", x: -42, z: 62, yaw: 0 },
  { asset: "telephone-pole", x: -42, z: 78, yaw: 0 },
  { asset: "wooden-hill-house", x: -12, z: -46, yaw: 0.15 },
  { asset: "harbor-warehouse-8", x: -24, z: 58, yaw: Math.PI },
  { asset: "harbor-warehouse-8", x: 8, z: 58, yaw: Math.PI },
  { asset: "harbor-warehouse-3", x: 28, z: 56, yaw: Math.PI },
  { asset: "steel-bin", x: 36, z: 6.6, yaw: 0 },
  { asset: "steel-bin", x: -38, z: -6.6, yaw: 0 },
  { asset: "steel-bin", x: 14, z: 14.4, yaw: 0 },
  { asset: "city-bus", x: -38.2, z: 38, yaw: Math.PI },
  { asset: "city-bicycle", x: -8, z: 6.45, yaw: -Math.PI / 2 },
  { asset: "city-bicycle", x: 24, z: -6.45, yaw: Math.PI / 2 },
  { asset: "city-bicycle", x: 15.2, z: 6.45, yaw: -Math.PI / 2 },
  { asset: "park-bench", x: -34.6, z: -46.55, yaw: 0 },
  { asset: "park-bench", x: -24.8, z: -46.55, yaw: 0 },
  { asset: "park-bench", x: -26.1, z: -24.95, yaw: 2.034 },
  { asset: "quay-seawall-segment", x: -32, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: -24, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: -16, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: -8, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 0, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 8, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 16, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 24, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 32, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 40, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
  { asset: "quay-seawall-segment", x: 48, y: QUAY_SEAWALL_SUPPORT_Y, z: 88.55, yaw: Math.PI },
]);

/** The old repeated monolithic quay segments are replaced by one modular quay assembly. */
export const INSTANCES = Object.freeze(
  AUTHORED_INSTANCES.filter(instance => instance.asset !== "quay-seawall-segment"),
);
