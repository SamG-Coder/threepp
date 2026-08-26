import * as THREE from "three/webgpu";

const EMPTY_VEHICLE_IMPACTS = Object.freeze([]);

const CIVILIAN_RADIUS = 0.32;
const POLICE_RADIUS = 0.35;
const ALERT_LIFETIME = 9;
const POLICE_MEMORY = 3.5;
const TRAFFIC_SIGNAL_CYCLE = 20;
const POLICE_MAGAZINE_SIZE = 8;
const VEHICLE_OBSERVATION_LIMIT = 48;
const FULL_RIG_BODY_ROOT_Y = -0.29;
// One authored city block: close enough to read as a neighbour noticing the
// stopped car, broad enough that sparse nighttime pavement remains eligible.
export const ROADSIDE_OBSERVER_RADIUS = 48;
export const ROADSIDE_OBSERVER_STATES = Object.freeze([
  "wander",
  "idle",
  "transit_approach",
  "transit_wait",
  "crosswalk_approach",
  "crosswalk_wait",
  "return",
  "yield",
]);
const ROADSIDE_OBSERVER_STATE_SET = new Set(ROADSIDE_OBSERVER_STATES);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function positionVector(value, fallback = null) {
  const source = value?.position ?? value;
  if (source?.isVector3) return source.clone();
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    if (!Number.isFinite(Number(source[0])) || !Number.isFinite(Number(source[2]))) return fallback?.clone?.() ?? null;
    return new THREE.Vector3(finite(source[0]), finite(source[1]), finite(source[2]));
  }
  if (source && typeof source === "object" &&
      Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.z))) {
    return new THREE.Vector3(finite(source.x), finite(source.y), finite(source.z));
  }
  return fallback?.clone?.() ?? null;
}

function normalizePoints(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  const points = source.map(value => positionVector(value)).filter(Boolean);
  return points.length ? points : fallback.map(value => positionVector(value)).filter(Boolean);
}

function seededRandom(seed = 0x4e454f4e) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function angleDelta(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function raySphere(origin, direction, center, radius, maxDistance) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const projection = -(ox * direction.x + oy * direction.y + oz * direction.z);
  if (projection < 0 || projection > maxDistance) return null;
  const closestSq = ox * ox + oy * oy + oz * oz - projection * projection;
  const radiusSq = radius * radius;
  if (closestSq > radiusSq) return null;
  return Math.max(0, projection - Math.sqrt(Math.max(0, radiusSq - closestSq)));
}

function createDistantBodyGeometry() {
  // One shared, shallow full-body extrusion keeps both legs readable at driving
  // distance without adding another mesh, material, or per-actor allocation.
  const outline = new THREE.Shape();
  outline.moveTo(-0.18, 0.033);
  outline.lineTo(-0.16, 0.72);
  outline.lineTo(-0.25, 0.82);
  outline.lineTo(-0.31, 0.90);
  outline.lineTo(-0.31, 1.35);
  outline.lineTo(-0.26, 1.47);
  outline.lineTo(-0.13, 1.54);
  outline.lineTo(0.13, 1.54);
  outline.lineTo(0.26, 1.47);
  outline.lineTo(0.31, 1.35);
  outline.lineTo(0.31, 0.90);
  outline.lineTo(0.25, 0.82);
  outline.lineTo(0.16, 0.72);
  outline.lineTo(0.18, 0.033);
  outline.lineTo(0.055, 0.033);
  outline.lineTo(0.055, 0.68);
  outline.lineTo(-0.055, 0.68);
  outline.lineTo(-0.055, 0.033);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: 0.25,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.018,
    bevelThickness: 0.018,
  });
  geometry.translate(0, 0, -0.125);
  geometry.name = "shared grounded distant pedestrian body";
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSharedResources() {
  const geometries = {
    torso: new THREE.CapsuleGeometry(0.24, 0.62, 5, 8),
    pelvis: new THREE.CapsuleGeometry(0.2, 0.2, 4, 8),
    neck: new THREE.CylinderGeometry(0.075, 0.095, 0.16, 8),
    head: new THREE.SphereGeometry(0.2, 16, 12),
    hair: new THREE.SphereGeometry(0.207, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairBun: new THREE.SphereGeometry(0.095, 9, 7),
    eye: new THREE.SphereGeometry(0.024, 8, 6),
    nose: new THREE.ConeGeometry(0.026, 0.072, 7),
    mouth: new THREE.BoxGeometry(0.074, 0.014, 0.014),
    glasses: new THREE.TorusGeometry(0.048, 0.007, 5, 14),
    limb: new THREE.CapsuleGeometry(0.075, 0.42, 4, 7),
    hand: new THREE.SphereGeometry(0.082, 8, 6),
    shoe: new THREE.BoxGeometry(0.16, 0.11, 0.28),
    shirtPanel: new THREE.BoxGeometry(0.22, 0.38, 0.028),
    badge: new THREE.BoxGeometry(0.12, 0.14, 0.025),
    backpack: new THREE.CapsuleGeometry(0.22, 0.34, 4, 8),
    phone: new THREE.BoxGeometry(0.085, 0.16, 0.022),
    cup: new THREE.CylinderGeometry(0.052, 0.044, 0.16, 9),
    umbrellaCanopy: new THREE.ConeGeometry(0.64, 0.20, 12, 1, true),
    umbrellaPole: new THREE.CylinderGeometry(0.012, 0.012, 1.43, 7),
    umbrellaHandle: new THREE.TorusGeometry(0.064, 0.012, 5, 10, Math.PI * 1.15),
    distantBody: createDistantBodyGeometry(),
  };
  const skin = [0x6f3f2d, 0x94583b, 0xb97655, 0xd5a17c, 0xe0b18b].map((color, index) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.74 + index * 0.025 }));
  const clothing = [0x25365f, 0x7b2436, 0x31705b, 0xc28932, 0x522b6d, 0x30343e, 0xd4d0c7].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.76 }));
  const police = new THREE.MeshStandardMaterial({ color: 0x101a36, roughness: 0.58, metalness: 0.08 });
  const policeAccent = new THREE.MeshStandardMaterial({ color: 0x47b9ff, emissive: 0x0b3c61, emissiveIntensity: 0.7, roughness: 0.36 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.68 });
  const umbrella = [0x263c58, 0x6c3039, 0x365345, 0xb49a68].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.76, side: THREE.DoubleSide }));
  const phoneScreen = new THREE.MeshStandardMaterial({
    color: 0x18262e, emissive: 0x163f52, emissiveIntensity: 0.38, roughness: 0.34,
  });
  const cup = new THREE.MeshStandardMaterial({ color: 0xd7d0c2, roughness: 0.82 });
  return { geometries, skin, clothing, police, policeAccent, dark, umbrella, phoneScreen, cup };
}

function addPart(parent, geometry, material, name, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createPersonVisual(resources, random, policeOfficer, paletteIndex) {
  const root = new THREE.Group();
  root.name = "full pedestrian body root";
  root.position.y = FULL_RIG_BODY_ROOT_Y;
  const bodyMaterial = policeOfficer ? resources.police : resources.clothing[paletteIndex % resources.clothing.length];
  const skinMaterial = resources.skin[Math.floor(random() * resources.skin.length)];
  const torso = addPart(root, resources.geometries.torso, bodyMaterial, "torso", [0, 1.25, 0]);
  torso.scale.set(1, 1, 0.72);
  const undershirtMaterial = policeOfficer
    ? resources.policeAccent
    : resources.clothing[(paletteIndex + 3) % resources.clothing.length];
  const shirtPanel = addPart(root, resources.geometries.shirtPanel, undershirtMaterial, "layered shirt front", [0, 1.3, -0.178]);
  shirtPanel.scale.set(0.72, 0.78, 1);
  const pelvis = addPart(root, resources.geometries.pelvis, resources.dark, "trouser waist and hips", [0, 0.9, 0]);
  pelvis.scale.set(1, 1, 0.76);
  addPart(root, resources.geometries.neck, skinMaterial, "neck", [0, 1.73, 0]);
  const head = addPart(root, resources.geometries.head, skinMaterial, "head", [0, 1.94, -0.01]);
  head.scale.set(0.92, 1.06, 0.94);
  const hair = addPart(root, resources.geometries.hair, resources.dark, "hair", [0, 1.985, -0.01]);
  hair.scale.set(0.96, 1, 0.98);
  if (!policeOfficer && paletteIndex % 3 === 1) {
    addPart(root, resources.geometries.hairBun, resources.dark, "hair bun", [0, 2.02, 0.17]);
  }
  if (policeOfficer) addPart(root, resources.geometries.badge, resources.policeAccent, "police badge", [-0.1, 1.43, -0.19]);
  const pivots = {};
  for (const [name, x, y, material] of [
    ["leftArm", -0.31, 1.53, bodyMaterial], ["rightArm", 0.31, 1.53, bodyMaterial],
    ["leftLeg", -0.13, 0.88, resources.dark], ["rightLeg", 0.13, 0.88, resources.dark],
  ]) {
    const pivot = new THREE.Group();
    pivot.name = `${name} pivot`;
    pivot.position.set(x, y, 0);
    addPart(pivot, resources.geometries.limb, material, name, [0, -0.27, 0]);
    if (name.includes("Arm")) addPart(pivot, resources.geometries.hand, skinMaterial, `${name} hand`, [0, -0.56, 0]);
    root.add(pivot);
    pivots[name] = pivot;
  }
  addPart(pivots.leftLeg, resources.geometries.shoe, resources.dark, "left shoe", [0, -0.52, -0.06]);
  addPart(pivots.rightLeg, resources.geometries.shoe, resources.dark, "right shoe", [0, -0.52, -0.06]);
  let backpack = null;
  if (!policeOfficer && paletteIndex % 3 !== 2) {
    backpack = addPart(root, resources.geometries.backpack,
      resources.clothing[(paletteIndex + 2) % resources.clothing.length], "everyday backpack", [0, 1.27, 0.22]);
    backpack.scale.set(0.88, 1, 0.52);
    backpack.rotation.x = 0.05;
  }
  const phone = addPart(pivots.rightArm, resources.geometries.phone, resources.phoneScreen,
    "handheld phone", [0, -0.58, -0.09]);
  phone.rotation.x = -0.18;
  phone.visible = false;
  const coffee = addPart(pivots.rightArm, resources.geometries.cup, resources.cup,
    "takeaway coffee cup", [0, -0.58, -0.09]);
  coffee.rotation.z = 0.08;
  coffee.visible = false;
  const umbrella = new THREE.Group();
  umbrella.name = "weather-reactive umbrella";
  umbrella.position.x = paletteIndex % 2 ? -0.34 : 0.34;
  const umbrellaMaterial = resources.umbrella[paletteIndex % resources.umbrella.length];
  addPart(umbrella, resources.geometries.umbrellaCanopy, umbrellaMaterial,
    "umbrella fabric canopy", [0, 2.47, 0]);
  addPart(umbrella, resources.geometries.umbrellaPole, resources.dark,
    "umbrella shaft", [0, 1.75, 0]);
  const handle = addPart(umbrella, resources.geometries.umbrellaHandle, resources.dark,
    "umbrella curved handle", [0, 1.04, 0]);
  handle.rotation.y = Math.PI * 0.5;
  umbrella.visible = false;
  root.add(umbrella);
  root.userData.pivots = pivots;
  root.userData.torso = torso;
  root.userData.head = head;
  root.userData.skinMaterial = skinMaterial;
  root.userData.bodyMaterial = bodyMaterial;
  root.userData.bodyRootOffsetY = FULL_RIG_BODY_ROOT_Y;
  root.userData.props = { umbrella, phone, coffee, backpack };
  return root;
}

function createDistantPersonVisual(resources, detailed, paletteIndex) {
  const root = new THREE.Group();
  root.name = "distance pedestrian silhouette";
  addPart(root, resources.geometries.distantBody,
    detailed.userData.bodyMaterial, "distance full-body silhouette", [0, 0, 0]);
  const head = addPart(root, resources.geometries.head,
    detailed.userData.skinMaterial, "distance head", [0, 1.694, 0]);
  head.scale.set(0.9, 1.04, 0.92);
  const umbrella = addPart(root, resources.geometries.umbrellaCanopy,
    resources.umbrella[paletteIndex % resources.umbrella.length], "distance umbrella canopy", [0, 2.18, 0]);
  umbrella.visible = false;
  root.userData.umbrella = umbrella;
  root.visible = false;
  return root;
}

function defaultPedestrianNodes() {
  const nodes = [];
  for (const road of [-96, -48, 0, 48, 96]) {
    for (const along of [-112, -72, -24, 24, 72, 112]) {
      nodes.push([road - 8.5, 0.12, along], [road + 8.5, 0.12, along]);
      nodes.push([along, 0.12, road - 8.5], [along, 0.12, road + 8.5]);
    }
  }
  return nodes;
}

const DEFAULT_POLICE_SPAWNS = Object.freeze([
  [-104, 0.1, -104], [104, 0.1, 104], [-104, 0.1, 104], [104, 0.1, -104],
]);

function roadHalfWidth(road, axis) {
  const extents = road?.halfExtents ?? road?.extents ?? [];
  if (Array.isArray(extents) || ArrayBuffer.isView(extents)) return Math.max(1, finite(extents[axis === "x" ? 0 : 2], 7.5));
  return Math.max(1, finite(extents?.[axis], 7.5));
}

function buildCrossings(roads = []) {
  if (!Array.isArray(roads)) return [];
  const alongZ = [];
  const alongX = [];
  for (const road of roads) {
    const center = positionVector(road?.center ?? road?.position);
    if (!center) continue;
    if (road.axis === "z") alongZ.push({ road, center, halfWidth: roadHalfWidth(road, "x") });
    else if (road.axis === "x") alongX.push({ road, center, halfWidth: roadHalfWidth(road, "z") });
  }
  const crossings = [];
  for (const vertical of alongZ) {
    for (const horizontal of alongX) {
      const x = vertical.center.x;
      const z = horizontal.center.z;
      const northZ = z - horizontal.halfWidth - 0.65;
      const eastX = x + vertical.halfWidth + 0.65;
      crossings.push({
        roadAxis: "z",
        roadCenter: x,
        center: new THREE.Vector3(x, 0, northZ),
        a: new THREE.Vector3(x - vertical.halfWidth - 0.9, 0, northZ),
        b: new THREE.Vector3(x + vertical.halfWidth + 0.9, 0, northZ),
      });
      crossings.push({
        roadAxis: "x",
        roadCenter: z,
        center: new THREE.Vector3(eastX, 0, z),
        a: new THREE.Vector3(eastX, 0, z - horizontal.halfWidth - 0.9),
        b: new THREE.Vector3(eastX, 0, z + horizontal.halfWidth + 0.9),
      });
    }
  }
  return crossings;
}

function vehicleSignalAt(time, axis) {
  const phase = ((finite(time) % TRAFFIC_SIGNAL_CYCLE) + TRAFFIC_SIGNAL_CYCLE) % TRAFFIC_SIGNAL_CYCLE;
  if (axis === "x") return phase < 7 ? "green" : phase < 8.5 ? "yellow" : "red";
  return phase >= 10 && phase < 17 ? "green" : phase >= 17 && phase < 18.5 ? "yellow" : "red";
}

export function createPopulationSystem({ scene, world, onCrime = null, onPlayerDamage = null, civilianCount = 16, policeCount = 7 } = {}) {
  if (!scene || !world) throw new TypeError("createPopulationSystem requires scene and world");
  const random = seededRandom();
  const resources = createSharedResources();
  const root = new THREE.Group();
  root.name = "Neon City pedestrians and police";
  root.userData.rtxIgnore = true;
  scene.add(root);
  const nodes = normalizePoints(world.pedestrianNodes ?? world.spawnPoints?.pedestrians, defaultPedestrianNodes());
  const policeSpawns = normalizePoints(world.spawnPoints?.police, DEFAULT_POLICE_SPAWNS);
  const crossings = buildCrossings(world.roads);
  const actors = [];
  // Presentation claims borrow already-authored ambient actors. The saved
  // state contains only simulation values and references to existing visuals;
  // staging never creates a renderer node, geometry, or material.
  const stagedOriginals = new Map();
  const observationByIncident = new Map();
  let stageClaims = 0;
  let stageUpdates = 0;
  let stageReleases = 0;
  // These actors already belong to the scene so startup reveal-all rendering
  // can prepare their forward and shadow render objects, but they do not join
  // simulation or public snapshots until spawn() claims them.
  const spawnReserve = [];
  let actorSerial = 0;
  let spawnReserveReady = false;
  let spawnReservePrepared = 0;
  let spawnReserveClaims = 0;
  let runtimeActorAllocations = 0;
  // Keep a fixed, reused observation pool so pedestrians can anticipate live
  // traffic without allocating vectors every simulation tick.
  const vehicleObservations = [];
  let observedVehicleCount = 0;
  let elapsed = 0;
  let lastAlert = null;
  let alertSerial = 0;
  let crimesWitnessed = 0;
  let timeHours = 12;
  let rainAmount = 0;
  let daylightAmount = 1;
  let disposed = false;

  const tempDirection = new THREE.Vector3();
  const tempDisplacement = new THREE.Vector3();
  const tempCenter = new THREE.Vector3();
  const tempBefore = new THREE.Vector3();
  const tempTarget = new THREE.Vector3();
  const tempAvoidance = new THREE.Vector3();
  const northMarketFocus = positionVector(
    world.northMarket?.focus,
    new THREE.Vector3(-144, 0, 127.7),
  );
  function collisionSafeTransitAnchors(values) {
    const anchors = normalizePoints(values, []);
    return anchors.filter(anchor => {
      try {
        return !world.isBlockedCircle?.(anchor.x, anchor.z, CIVILIAN_RADIUS + 0.08);
      } catch {
        return true;
      }
    });
  }
  // Pulse Line stop positions are authored by the world and copied once at
  // construction. Frozen world contracts therefore stay untouched, and the
  // pedestrian tick never has to normalize or allocate route data.
  const pulseTransitWaitingAnchors = collisionSafeTransitAnchors(world.pulseTransit?.waitingAnchors);
  const pulseTransitCoveredAnchors = collisionSafeTransitAnchors(world.pulseTransit?.coveredWaitingAnchors);
  const pulseTransitWaitingSnapshots = pulseTransitWaitingAnchors.map(anchor => Object.freeze(anchor.toArray()));
  const pulseTransitCoveredSnapshots = pulseTransitCoveredAnchors.map(anchor => Object.freeze(anchor.toArray()));
  const routineFoci = Object.freeze({
    core: new THREE.Vector3(0, 0, 0),
    park: new THREE.Vector3(-48, 0, -48),
    market: northMarketFocus,
    harbour: new THREE.Vector3(142, 0, 24),
    garage: new THREE.Vector3(-144, 0, 96),
    westside: new THREE.Vector3(-144, 0, 0),
    midtown: new THREE.Vector3(24, 0, -96),
  });

  // Derive a small local graph once.  Neighbour links follow clear sidewalk
  // segments and cross only the short road gap between facing curbs; this
  // prevents the old long diagonal routes through whole buildings.
  const nodeLinks = nodes.map(() => []);
  for (let first = 0; first < nodes.length; ++first) {
    for (let second = first + 1; second < nodes.length; ++second) {
      const distanceSq = nodes[first].distanceToSquared(nodes[second]);
      if (distanceSq < 2.5 * 2.5 || distanceSq > 15.75 * 15.75) continue;
      if (!clearLineOfSight(nodes[first], nodes[second])) continue;
      nodeLinks[first].push(second);
      nodeLinks[second].push(first);
    }
  }
  const navigationLinkCount = Math.trunc(nodeLinks.reduce((sum, links) => sum + links.length, 0) / 2);
  root.userData.navigation = Object.freeze({ nodes: nodes.length, links: navigationLinkCount });
  // Routine routes are authored at schedule changes or by the explicitly
  // budgeted repair drain. One shared search workspace and one fixed route
  // buffer per actor keep resident travel deterministic and allocation-stable.
  const routineSearchDistance = new Float64Array(nodes.length);
  const routineSearchPrevious = new Int32Array(nodes.length);
  const routineSearchVisited = new Uint8Array(nodes.length);
  const routineSearchRoute = new Int32Array(Math.max(1, nodes.length));
  // Schedule boundaries can move several named residents in one frame. The
  // old Dijkstra implementation found the next node by scanning the complete
  // graph for every visit, turning that frame into O(V²) work per resident.
  // This fixed-capacity binary heap keeps the same deterministic distance /
  // node-index ordering at O((V + E) log V), with no runtime allocations.
  const routineSearchHeapCapacity = Math.max(2, navigationLinkCount * 2 + nodes.length + 2);
  const routineSearchHeapNodes = new Int32Array(routineSearchHeapCapacity);
  const routineSearchHeapDistances = new Float64Array(routineSearchHeapCapacity);
  let routineSearchHeapLength = 0;
  let routineSearchPoppedNode = -1;
  let routineSearchPoppedDistance = Infinity;
  let routineRouteSearches = 0;

  function routineHeapBefore(distance, node, otherDistance, otherNode) {
    return distance < otherDistance - 1e-12 ||
      (Math.abs(distance - otherDistance) <= 1e-12 && node < otherNode);
  }

  function pushRoutineSearchNode(node, distance) {
    if (routineSearchHeapLength >= routineSearchHeapCapacity) return false;
    let index = routineSearchHeapLength++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentNode = routineSearchHeapNodes[parent];
      const parentDistance = routineSearchHeapDistances[parent];
      if (!routineHeapBefore(distance, node, parentDistance, parentNode)) break;
      routineSearchHeapNodes[index] = parentNode;
      routineSearchHeapDistances[index] = parentDistance;
      index = parent;
    }
    routineSearchHeapNodes[index] = node;
    routineSearchHeapDistances[index] = distance;
    return true;
  }

  function popRoutineSearchNode() {
    if (routineSearchHeapLength <= 0) {
      routineSearchPoppedNode = -1;
      routineSearchPoppedDistance = Infinity;
      return false;
    }
    routineSearchPoppedNode = routineSearchHeapNodes[0];
    routineSearchPoppedDistance = routineSearchHeapDistances[0];
    routineSearchHeapLength -= 1;
    if (routineSearchHeapLength <= 0) return true;
    const tailNode = routineSearchHeapNodes[routineSearchHeapLength];
    const tailDistance = routineSearchHeapDistances[routineSearchHeapLength];
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= routineSearchHeapLength) break;
      const right = left + 1;
      let child = left;
      if (right < routineSearchHeapLength && routineHeapBefore(
        routineSearchHeapDistances[right],
        routineSearchHeapNodes[right],
        routineSearchHeapDistances[left],
        routineSearchHeapNodes[left],
      )) child = right;
      if (!routineHeapBefore(
        routineSearchHeapDistances[child],
        routineSearchHeapNodes[child],
        tailDistance,
        tailNode,
      )) break;
      routineSearchHeapNodes[index] = routineSearchHeapNodes[child];
      routineSearchHeapDistances[index] = routineSearchHeapDistances[child];
      index = child;
    }
    routineSearchHeapNodes[index] = tailNode;
    routineSearchHeapDistances[index] = tailDistance;
    return true;
  }

  function invoke(callback, detail) {
    if (typeof callback !== "function") return undefined;
    try { return callback(detail); } catch { return undefined; }
  }

  function groundHeight(x, z, fallback = 0) {
    try { return finite(world.terrainHeight?.(x, z), fallback); } catch { return fallback; }
  }

  function setState(actor, next) {
    if (actor.state === next) return;
    actor.state = next;
    actor.stateTime = 0;
  }

  function resetVisual(actor) {
    actor.visual.visible = true;
    actor.distantVisual.visible = false;
    actor.detailLevel = "full";
    actor.visual.position.set(0, actor.visual.userData.bodyRootOffsetY ?? FULL_RIG_BODY_ROOT_Y, 0);
    actor.visual.rotation.set(0, 0, 0);
    actor.root.rotation.z = 0;
    const { pivots, torso, head } = actor.visual.userData;
    for (const pivot of Object.values(pivots)) pivot.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
  }

  function resetActor(actor, position, state) {
    clearSocial(actor);
    actor.root.position.copy(position);
    actor.root.position.y = groundHeight(position.x, position.z, position.y);
    actor.health = actor.maxHealth;
    actor.alive = true;
    actor.active = true;
    actor.root.visible = true;
    actor.velocity.set(0, 0, 0);
    actor.steering.set(0, 0, 0);
    actor.knockback.set(0, 0, 0);
    actor.ragdollVelocity.set(0, 0, 0);
    actor.ragdollActive = false;
    actor.ragdollAge = 0;
    actor.ragdollHeight = 0;
    actor.ragdollBounces = 0;
    actor.ragdollImpact = 0;
    actor.ragdollAngularVelocity = 0;
    actor.speed = 0;
    actor.respawn = 0;
    actor.downUntil = 0;
    actor.stateUntil = 0;
    actor.panicUntil = 0;
    actor.idleUntil = 0;
    actor.socialUntil = 0;
    actor.witnessUntil = 0;
    actor.pendingAlert = null;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    if (actor.routineDestination) {
      actor.routineDestination.set(0, 0, 0);
      actor.routineDestinationActive = false;
      actor.routineDestinationArrived = false;
      actor.routineDestinationNodeIndex = -1;
      actor.routineRouteLength = 0;
      actor.routineRouteCursor = 0;
      actor.routineRouteRepairPending = false;
      actor.routineCrossingWaypoint = -1;
      actor.routineArrivalRadius = 0.72;
      actor.routineTravelSpeedScale = 1;
      actor.routineLocation = null;
      actor.routineActivity = null;
      actor.managedRoutineOwner = null;
      actor.managedRoutineRequestPending = false;
      actor.managedRoutineRequestKey = null;
      actor.managedRoutineAppliedRequestKey = null;
      actor.managedRoutineRequestStatus = "idle";
      actor.managedRoutineLastRequestReason = null;
      actor.managedRoutineDwelling = false;
      actor.managedRoutineOriginalIdleMode = null;
    }
    actor.yieldDirection.set(0, 0, 0);
    actor.yieldSpeed = 0;
    actor.stuckFor = 0;
    actor.shotCooldown = 0.35 + random() * 0.45;
    actor.burstRemaining = 2 + actor.index % 2;
    actor.roundsInMagazine = POLICE_MAGAZINE_SIZE;
    actor.reloadUntil = 0;
    actor.reloadCount = 0;
    actor.coverUntil = 0;
    actor.hasCover = false;
    setState(actor, state);
    resetVisual(actor);
  }

  function wrappedHour(value = timeHours) {
    return ((finite(value, 12) % 24) + 24) % 24;
  }

  function scheduleFor(actor) {
    const hour = wrappedHour();
    switch (actor.routine) {
      case "market-shift":
        if (hour < 5) return "home";
        if (hour < 7) return "commute";
        if (hour < 19.5) return "work";
        if (hour < 20.5) return "commute-home";
        return "home";
      case "harbour-shift":
        if (hour < 6) return "home";
        if (hour < 8) return "commute";
        if (hour < 17) return "work";
        if (hour < 20.5) return "leisure";
        return "home";
      case "student":
        if (hour < 7) return "home";
        if (hour < 9) return "commute";
        if (hour < 15.5) return "study";
        if (hour < 22) return "leisure";
        return "home";
      case "jogger":
        if ((hour >= 5.5 && hour < 8) || (hour >= 17 && hour < 19.5)) return "exercise";
        if (hour >= 9 && hour < 17) return "work";
        return hour >= 20 || hour < 5.5 ? "home" : "leisure";
      case "nightlife":
        if (hour >= 18 || hour < 2) return "nightlife";
        if (hour < 10) return "home";
        if (hour < 17) return "errands";
        return "commute";
      default:
        if (hour < 6.5) return "home";
        if (hour < 8.5) return "commute";
        if (hour < 17) return "work";
        if (hour < 19) return "commute-home";
        if (hour < 22.5) return "leisure";
        return "home";
    }
  }

  function transitPhaseFor(actor, schedule = scheduleFor(actor)) {
    if (!actor.transitEligible || actor.police || actor.storyRole) return null;
    const hour = wrappedHour();
    if (schedule === "commute" && hour >= 6.25 && hour < 9.25) return "morning";
    if (schedule === "commute-home" && hour >= 17 && hour < 18.25) return "evening";
    return null;
  }

  function transitAnchorPoolFor(actor, schedule = scheduleFor(actor)) {
    if (!transitPhaseFor(actor, schedule)) return null;
    if (rainAmount > 0.3 && pulseTransitCoveredAnchors.length) return pulseTransitCoveredAnchors;
    if (pulseTransitWaitingAnchors.length) return pulseTransitWaitingAnchors;
    return pulseTransitCoveredAnchors.length ? pulseTransitCoveredAnchors : null;
  }

  function transitAnchorFor(actor, schedule = scheduleFor(actor)) {
    const pool = transitAnchorPoolFor(actor, schedule);
    return pool?.[actor.transitAnchorSlot % pool.length] ?? null;
  }

  function transitAnchorIsCovered(anchor) {
    return Boolean(anchor && pulseTransitCoveredAnchors.includes(anchor));
  }

  function transitAnchorSnapshot(anchor) {
    let index = pulseTransitWaitingAnchors.indexOf(anchor);
    if (index >= 0) return pulseTransitWaitingSnapshots[index];
    index = pulseTransitCoveredAnchors.indexOf(anchor);
    return index >= 0 ? pulseTransitCoveredSnapshots[index] : null;
  }

  function routineFocusFor(actor, schedule = scheduleFor(actor)) {
    const transitAnchor = transitAnchorFor(actor, schedule);
    if (transitAnchor) return transitAnchor;
    if (schedule === "home" || schedule === "commute-home") return actor.homePosition;
    if (actor.routine === "market-shift") return routineFoci.market;
    if (schedule === "exercise") return actor.index % 2 ? routineFoci.park : routineFoci.harbour;
    if (schedule === "nightlife") return routineFoci.core;
    if (schedule === "study") return actor.index % 2 ? routineFoci.core : routineFoci.park;
    if (schedule === "errands" || schedule === "leisure") {
      return actor.index % 3 === 0 ? routineFoci.market : actor.index % 3 === 1 ? routineFoci.park : routineFoci.harbour;
    }
    if (actor.routine === "harbour-shift") return routineFoci.harbour;
    if (actor.routine === "jogger") return routineFoci.midtown;
    return routineFoci.core;
  }

  function routineSpeedScale(actor) {
    const schedule = scheduleFor(actor);
    if (schedule === "exercise") return 1.48;
    if (schedule === "commute" || schedule === "commute-home") return 1.18;
    if (rainAmount > 0.35) return 1.12;
    return 1;
  }

  function routineNameFor(index, policeOfficer = false) {
    if (policeOfficer) return "public-safety";
    return ["commuter", "market-shift", "harbour-shift", "student", "jogger", "nightlife"][index % 6];
  }

  function nodeNear(focus, index, radiusBias = 0) {
    const angle = index * 2.399963229728653;
    const radius = 4 + ((index * 7 + radiusBias) % 5) * 3.1;
    const targetX = focus.x + Math.cos(angle) * radius;
    const targetZ = focus.z + Math.sin(angle) * radius;
    let selected = nodes[(index * 17 + 3) % nodes.length];
    let best = Infinity;
    for (const node of nodes) {
      const dx = node.x - targetX;
      const dz = node.z - targetZ;
      const score = dx * dx + dz * dz;
      if (score < best) { best = score; selected = node; }
    }
    return selected;
  }

  function initialFocusFor(routine, index) {
    if (routine === "market-shift") return routineFoci.market;
    if (routine === "harbour-shift") return routineFoci.harbour;
    if (routine === "student") return index % 2 ? routineFoci.park : routineFoci.core;
    if (routine === "jogger") return routineFoci.park;
    return routineFoci.core;
  }

  function homeNodeFor(index) {
    return nodeNear(index % 2 ? routineFoci.market : routineFoci.westside, index, 3);
  }

  function decorateStoryActor(actor) {
    if (!actor?.storyRole || actor.visual.userData.storyDecorated) return;
    const skinMaterial = actor.visual.userData.skinMaterial ?? resources.skin[2];
    addPart(actor.visual, resources.geometries.eye, resources.dark, "story left eye", [-0.067, 1.985, -0.194]);
    addPart(actor.visual, resources.geometries.eye, resources.dark, "story right eye", [0.067, 1.985, -0.194]);
    const nose = addPart(actor.visual, resources.geometries.nose, skinMaterial, "story defined nose", [0, 1.925, -0.218]);
    nose.rotation.x = -Math.PI * 0.5;
    addPart(actor.visual, resources.geometries.mouth, resources.dark, "story mouth", [0, 1.865, -0.205]);
    if (actor.storyRole.includes("mechanic")) {
      addPart(actor.visual, resources.geometries.hairBun, resources.dark, "Juno tied-back hair", [0, 2.045, 0.16]);
      const patch = addPart(actor.visual, resources.geometries.badge, resources.policeAccent,
        "Juno garage workwear patch", [0.13, 1.39, -0.19]);
      patch.scale.set(0.72, 0.60, 0.75);
    }
    if (actor.storyRole.includes("analyst")) {
      for (const x of [-0.062, 0.062]) {
        addPart(actor.visual, resources.geometries.glasses, resources.dark,
          `${x < 0 ? "left" : "right"} analyst glasses lens`, [x, 1.985, -0.214]);
      }
      const bridge = addPart(actor.visual, resources.geometries.mouth, resources.dark,
        "analyst glasses bridge", [0, 1.985, -0.215]);
      bridge.scale.set(0.38, 0.52, 0.70);
    }
    actor.visual.userData.storyDecorated = true;
  }

  function makeActor(index, policeOfficer, register = true) {
    const routine = routineNameFor(index, policeOfficer);
    const visual = createPersonVisual(resources, random, policeOfficer, index);
    const distantVisual = createDistantPersonVisual(resources, visual, index);
    const actorRoot = new THREE.Group();
    actorRoot.name = policeOfficer ? `Police officer ${index + 1}` : `Civilian ${index + 1}`;
    actorRoot.userData.dynamicActor = true;
    actorRoot.userData.rtxIgnore = true;
    actorRoot.add(visual, distantVisual);
    root.add(actorRoot);
    const spawn = policeOfficer ? policeSpawns[index % policeSpawns.length] : nodeNear(initialFocusFor(routine, index), index);
    actorRoot.position.copy(spawn);
    actorRoot.position.y = groundHeight(spawn.x, spawn.z, spawn.y);
    const actor = {
      id: policeOfficer ? `officer-${index + 1}` : `civilian-${index + 1}`,
      index: actorSerial++,
      kind: policeOfficer ? "police" : "civilian",
      police: policeOfficer,
      root: actorRoot,
      visual,
      distantVisual,
      detailLevel: "full",
      radius: policeOfficer ? POLICE_RADIUS : CIVILIAN_RADIUS,
      health: policeOfficer ? 120 : 65,
      maxHealth: policeOfficer ? 120 : 65,
      alive: true,
      active: !policeOfficer,
      assigned: false,
      state: policeOfficer ? "reserve" : "wander",
      stateTime: 0,
      stateUntil: 0,
      panicUntil: 0,
      idleUntil: 0,
      idleMode: ["look", "phone", "stretch", "hands"][(index + (policeOfficer ? 1 : 0)) % 4],
      routine,
      transitEligible: !policeOfficer && (routine === "commuter" || routine === "student"),
      transitAnchorSlot: Math.trunc(index / 3),
      accessory: visual.userData.props?.backpack ? "backpack" : "none",
      carryingUmbrella: false,
      socialPartner: null,
      socialUntil: 0,
      witnessUntil: 0,
      witnessMode: ["freeze", "cower", "report"][index % 3],
      pendingAlert: null,
      returnUntil: 0,
      manualUntil: 0,
      memoryUntil: 0,
      nodeIndex: (index * 7 + 11) % nodes.length,
      previousNodeIndex: -1,
      speed: 0,
      preferredSpeed: 1.18 + (index % 5) * 0.11 + random() * 0.14,
      shotCooldown: 0.45 + random() * 0.8,
      burstRemaining: 2 + index % 2,
      shotsFired: 0,
      roundsInMagazine: POLICE_MAGAZINE_SIZE,
      reloadUntil: 0,
      reloadCount: 0,
      coverUntil: 0,
      hasCover: false,
      respawn: 0,
      downUntil: 0,
      distanceTravelled: 0,
      animationTime: random() * Math.PI * 2,
      stuckFor: 0,
      evadeSign: index % 2 ? -1 : 1,
      fallDirection: index % 2 ? -1 : 1,
      lastAlertSerial: -1,
      velocity: new THREE.Vector3(),
      steering: new THREE.Vector3(),
      knockback: new THREE.Vector3(),
      ragdollVelocity: new THREE.Vector3(),
      ragdollDisplacement: new THREE.Vector3(),
      ragdollActive: false,
      ragdollAge: 0,
      ragdollHeight: 0,
      ragdollBounces: 0,
      ragdollImpact: 0,
      ragdollAngularVelocity: 0,
      ragdollPose: index * 2.399963,
      yieldDirection: new THREE.Vector3(),
      yieldSpeed: 0,
      coverPosition: new THREE.Vector3(),
      threatPosition: spawn.clone(),
      lastKnownTarget: spawn.clone(),
      homePosition: policeOfficer ? spawn.clone() : homeNodeFor(index).clone(),
      crossing: null,
      crossingDestinationIndex: -1,
      routineDestination: new THREE.Vector3(),
      routineDestinationActive: false,
      routineDestinationArrived: false,
      routineDestinationNodeIndex: -1,
      routineRoute: new Int32Array(Math.max(1, nodes.length)),
      routineRouteLength: 0,
      routineRouteCursor: 0,
      routineRouteRepairPending: false,
      routineCrossingWaypoint: -1,
      routineArrivalRadius: 0.72,
      routineTravelSpeedScale: 1,
      routineLocation: null,
      routineActivity: null,
      managedRoutineOwner: null,
      managedRoutineRequestPending: false,
      managedRoutineRequestKey: null,
      managedRoutineAppliedRequestKey: null,
      managedRoutineRequestStatus: "idle",
      managedRoutineLastRequestReason: null,
      managedRoutineDwelling: false,
      managedRoutineOriginalIdleMode: null,
      routineCrossing: {
        roadAxis: null,
        roadCenter: 0,
        center: null,
        entry: null,
        exit: null,
        stage: "approach",
        waitUntil: 0,
      },
      displayName: actorRoot.name,
      storyRole: null,
      storyLocked: false,
      storyProtected: false,
      presentationStaged: false,
      presentationVisible: true,
      presentationKind: null,
      presentationKey: null,
      presentationPhase: null,
      observationIncidentId: null,
      observationKind: null,
    };
    actorRoot.userData.actor = actor;
    actorRoot.visible = actor.active;
    if (register) actors.push(actor);
    actor.nodeIndex = nearestNodeIndex(spawn);
    chooseNextNode(actor);
    return actor;
  }

  const civilians = Math.max(0, Math.trunc(finite(civilianCount, 16)));
  const officers = Math.max(0, Math.trunc(finite(policeCount, 7)));
  for (let index = 0; index < civilians; ++index) makeActor(index, false);
  for (let index = 0; index < officers; ++index) makeActor(index, true);
  root.userData.pulseTransit = Object.freeze({
    waitingAnchors: pulseTransitWaitingAnchors.length,
    coveredWaitingAnchors: pulseTransitCoveredAnchors.length,
    eligibleActors: actors.reduce((count, actor) => count + Number(actor.transitEligible), 0),
    actorCountUnchanged: true,
  });

  function addCrowdAvoidance(actor, direction) {
    const range = actor.police ? 1.7 : 1.45;
    const rangeSq = range * range;
    tempAvoidance.set(0, 0, 0);
    for (const other of actors) {
      if (other === actor || !other.active || !other.alive || !other.root.visible) continue;
      let dx = actor.root.position.x - other.root.position.x;
      let dz = actor.root.position.z - other.root.position.z;
      let distanceSq = dx * dx + dz * dz;
      if (distanceSq >= rangeSq) continue;
      if (distanceSq < 1e-7) {
        const side = actor.index < other.index ? -1 : 1;
        dx = side;
        dz = ((actor.index + other.index) & 1) ? side * 0.37 : -side * 0.37;
        distanceSq = dx * dx + dz * dz;
      }
      const distance = Math.sqrt(distanceSq);
      const strength = (range - distance) / range;
      tempAvoidance.x += dx / distance * strength;
      tempAvoidance.z += dz / distance * strength;
    }
    if (tempAvoidance.lengthSq() > 1e-6) direction.addScaledVector(tempAvoidance.normalize(), actor.police ? 0.82 : 1.08);
  }

  function stopActor(actor, delta, response = 9) {
    actor.velocity.multiplyScalar(Math.exp(-Math.max(0, response) * delta));
    if (actor.velocity.lengthSq() < 0.0025) actor.velocity.set(0, 0, 0);
    actor.speed = actor.velocity.length();
  }

  function moveActor(actor, desiredDirection, desiredSpeed, delta, response = 8) {
    actor.steering.copy(desiredDirection).setY(0);
    if (actor.steering.lengthSq() < 1e-7 || desiredSpeed <= 0 || delta <= 0) {
      stopActor(actor, delta);
      return 0;
    }
    actor.steering.normalize();
    addCrowdAvoidance(actor, actor.steering);
    if (actor.steering.lengthSq() < 1e-7) return 0;
    actor.steering.normalize();
    tempDirection.copy(actor.steering).multiplyScalar(Math.max(0, desiredSpeed));
    actor.velocity.lerp(tempDirection, 1 - Math.exp(-Math.max(0.1, response) * delta));
    tempDisplacement.copy(actor.velocity).multiplyScalar(delta);
    tempBefore.copy(actor.root.position);

    let resolved = null;
    try { resolved = world.resolveCircleMotion?.(actor.root.position, tempDisplacement, actor.radius); } catch {}
    const resolvedPosition = positionVector(resolved);
    if (resolvedPosition) {
      actor.root.position.x = resolvedPosition.x;
      actor.root.position.z = resolvedPosition.z;
    } else {
      let blocked = false;
      try { blocked = Boolean(world.isBlockedCircle?.(actor.root.position.x + tempDisplacement.x, actor.root.position.z + tempDisplacement.z, actor.radius)); } catch {}
      if (!blocked) actor.root.position.add(tempDisplacement);
    }
    actor.root.position.y = groundHeight(actor.root.position.x, actor.root.position.z, actor.root.position.y);
    const dx = actor.root.position.x - tempBefore.x;
    const dz = actor.root.position.z - tempBefore.z;
    const travelled = Math.hypot(dx, dz);
    const expected = Math.hypot(tempDisplacement.x, tempDisplacement.z);
    actor.distanceTravelled += travelled;
    actor.speed = delta > 0 ? travelled / delta : 0;
    actor.stuckFor = expected > 0.015 && travelled < expected * 0.12 ? actor.stuckFor + delta : Math.max(0, actor.stuckFor - delta * 2);
    const facingX = travelled > 0.001 ? dx : actor.steering.x;
    const facingZ = travelled > 0.001 ? dz : actor.steering.z;
    const targetYaw = Math.atan2(-facingX, -facingZ);
    actor.root.rotation.y += angleDelta(targetYaw, actor.root.rotation.y) * (1 - Math.exp(-delta * 11));
    return travelled;
  }

  function chooseNextNode(actor) {
    if (nodes.length <= 1) { actor.nodeIndex = 0; actor.crossingDestinationIndex = -1; return; }
    const current = Math.max(0, Math.min(nodes.length - 1, actor.nodeIndex));
    const linked = nodeLinks[current] ?? [];
    const focus = routineFocusFor(actor);
    let best = linked.find(index => index !== actor.previousNodeIndex) ?? linked[0] ?? (current + 1) % nodes.length;
    let bestScore = Infinity;
    const candidates = linked.length ? linked : nodes.map((_, index) => index);
    for (let attempt = 0; attempt < (linked.length ? candidates.length : Math.min(14, nodes.length * 2)); ++attempt) {
      const candidateIndex = linked.length ? candidates[attempt] : Math.floor(random() * nodes.length);
      if (candidateIndex === current) continue;
      const candidate = nodes[candidateIndex];
      const distanceSq = candidate.distanceToSquared(actor.root.position);
      if (!linked.length && (distanceSq < 36 || distanceSq > 58 * 58 || !clearLineOfSight(actor.root.position, candidate))) continue;
      const alertPenalty = lastAlert && candidate.distanceToSquared(lastAlert.position) < 18 * 18 ? 1200 : 0;
      const backtrackPenalty = candidateIndex === actor.previousNodeIndex ? 180 : 0;
      const routineScore = focus ? candidate.distanceToSquared(focus) * 0.045 : 0;
      const score = routineScore + alertPenalty + backtrackPenalty + random() * 48;
      if (score < bestScore) { best = candidateIndex; bestScore = score; }
    }
    actor.previousNodeIndex = current;
    actor.nodeIndex = best;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
  }

  function nearestNodeIndex(position) {
    let nearest = 0;
    let distance = Infinity;
    for (let index = 0; index < nodes.length; ++index) {
      const candidate = nodes[index].distanceToSquared(position);
      if (candidate < distance) { nearest = index; distance = candidate; }
    }
    return nearest;
  }

  function namedRoutineResident(actor) {
    if (!actor || !actors.includes(actor) || actor.police) return false;
    if (actor.storyRole) return true;
    return Boolean(actor.displayName && !/^Civilian \d+$/.test(actor.displayName));
  }

  function nearestVisibleNodeIndex(position) {
    // Authored residents and work anchors normally sit beside a navigation
    // node. Prove that closest node first; when it is visible this is exactly
    // the result the exhaustive scan below would choose, while avoiding up to
    // a thousand blocker line tests for every schedule-boundary route.
    const nearestCandidate = nearestNodeIndex(position);
    if (nodes[nearestCandidate] && clearLineOfSight(position, nodes[nearestCandidate])) return nearestCandidate;
    let nearest = -1;
    let distance = Infinity;
    for (let index = 0; index < nodes.length; ++index) {
      const candidate = nodes[index].distanceToSquared(position);
      if (candidate >= distance || !clearLineOfSight(position, nodes[index])) continue;
      nearest = index;
      distance = candidate;
    }
    return nearest;
  }

  function buildRoutineRoute(actor, destination) {
    routineRouteSearches += 1;
    const direct = clearLineOfSight(actor.root.position, destination);
    const start = nearestVisibleNodeIndex(actor.root.position);
    const end = nearestVisibleNodeIndex(destination);
    if (start < 0 || end < 0) {
      if (!direct) return false;
      actor.routineRouteLength = 0;
      actor.routineRouteCursor = 0;
      actor.routineDestinationNodeIndex = -1;
      return true;
    }

    routineSearchDistance.fill(Infinity);
    routineSearchPrevious.fill(-1);
    routineSearchVisited.fill(0);
    routineSearchDistance[start] = 0;
    routineSearchHeapLength = 0;
    pushRoutineSearchNode(start, 0);
    while (popRoutineSearchNode()) {
      const current = routineSearchPoppedNode;
      const best = routineSearchPoppedDistance;
      if (current < 0) break;
      if (routineSearchVisited[current] || best > routineSearchDistance[current] + 1e-9) continue;
      routineSearchVisited[current] = 1;
      if (current === end) break;
      const links = nodeLinks[current];
      for (let link = 0; link < links.length; ++link) {
        const next = links[link];
        if (routineSearchVisited[next]) continue;
        const dx = nodes[next].x - nodes[current].x;
        const dz = nodes[next].z - nodes[current].z;
        const distance = best + Math.hypot(dx, dz);
        if (distance + 1e-9 >= routineSearchDistance[next]) continue;
        routineSearchDistance[next] = distance;
        routineSearchPrevious[next] = current;
        if (!pushRoutineSearchNode(next, distance)) return false;
      }
    }

    if (!Number.isFinite(routineSearchDistance[end])) {
      if (!direct) return false;
      actor.routineRouteLength = 0;
      actor.routineRouteCursor = 0;
      actor.routineDestinationNodeIndex = -1;
      return true;
    }

    let length = 0;
    let current = end;
    while (current >= 0 && length < routineSearchRoute.length) {
      routineSearchRoute[length++] = current;
      if (current === start) break;
      current = routineSearchPrevious[current];
    }
    if (length <= 0 || routineSearchRoute[length - 1] !== start) return false;
    for (let left = 0, right = length - 1; left < right; ++left, --right) {
      const swap = routineSearchRoute[left];
      routineSearchRoute[left] = routineSearchRoute[right];
      routineSearchRoute[right] = swap;
    }
    for (let index = 0; index < length; ++index) actor.routineRoute[index] = routineSearchRoute[index];
    actor.routineRouteLength = length;
    actor.routineRouteCursor = 0;
    actor.routineDestinationNodeIndex = end;
    return true;
  }

  function routineDestinationResult(actor, accepted, reason = null) {
    return Object.freeze({
      accepted: Boolean(accepted),
      reason,
      actorId: actor?.id ?? null,
      destination: actor?.routineDestinationActive
        ? Object.freeze(actor.routineDestination.toArray())
        : null,
      location: actor?.routineLocation ?? null,
      locationId: actor?.routineLocation ?? null,
      activity: actor?.routineActivity ?? null,
      speedScale: finite(actor?.routineTravelSpeedScale, 1),
      arrived: Boolean(actor?.routineDestinationActive && actor.routineDestinationArrived),
    });
  }

  function managedRoutineResult(actor, accepted, reason = null) {
    return Object.freeze({
      accepted: Boolean(accepted),
      reason,
      actorId: actor?.id ?? null,
      ownerId: actor?.managedRoutineOwner ?? null,
      queued: Boolean(actor?.managedRoutineRequestPending),
      requestKey: actor?.managedRoutineRequestKey ?? actor?.managedRoutineAppliedRequestKey ?? null,
      status: actor?.managedRoutineRequestStatus ?? "idle",
      destination: actor?.routineDestinationActive
        ? Object.freeze(actor.routineDestination.toArray())
        : null,
      locationId: actor?.routineLocation ?? null,
      activity: actor?.routineActivity ?? null,
      arrived: Boolean(actor?.routineDestinationActive && actor.routineDestinationArrived),
    });
  }

  function managedRoutineOwnerId(value) {
    const source = value && typeof value === "object" ? value.ownerId ?? value.owner : value;
    const ownerId = String(source ?? "").trim();
    return ownerId ? ownerId.slice(0, 128) : null;
  }

  function managedRoutineEligibilityReason(actor) {
    if (!actor || !actors.includes(actor)) return "actor_not_found";
    if (actor.police) return "actor_police";
    if (actor.presentationStaged || stagedOriginals.has(actor)) return "actor_staged";
    if (actor.storyProtected) return "actor_protected";
    if (actor.storyLocked) return "actor_story_locked";
    if (!actor.active || !actor.alive || actor.ragdollActive) return "actor_unavailable";
    return null;
  }

  function clearRoutineContract(actor, nextState = "wander") {
    actor.routineDestinationActive = false;
    actor.routineDestinationArrived = false;
    actor.routineDestinationNodeIndex = -1;
    actor.routineRouteLength = 0;
    actor.routineRouteCursor = 0;
    actor.routineRouteRepairPending = false;
    actor.routineCrossingWaypoint = -1;
    actor.routineLocation = null;
    actor.routineActivity = null;
    actor.routineTravelSpeedScale = 1;
    actor.managedRoutineDwelling = false;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    actor.nodeIndex = nearestNodeIndex(actor.root.position);
    actor.previousNodeIndex = -1;
    actor.idleUntil = 0;
    setState(actor, nextState);
  }

  /**
   * Lease a caller-selected civilian to one deterministic routine owner.
   * Population never searches for a candidate: an actor id must be supplied
   * explicitly by the higher-level occupancy system.
   */
  function leaseManagedRoutineActor(target, ownerValue) {
    const actor = resolveActor(target);
    if (!actor) return managedRoutineResult(null, false, "actor_not_found");
    const ownerId = managedRoutineOwnerId(ownerValue);
    if (!ownerId) return managedRoutineResult(actor, false, "owner_required");
    if (actor.managedRoutineOwner && actor.managedRoutineOwner !== ownerId) {
      return managedRoutineResult(actor, false, "actor_managed");
    }
    const eligibilityReason = managedRoutineEligibilityReason(actor);
    if (eligibilityReason) return managedRoutineResult(actor, false, eligibilityReason);
    if (!actor.managedRoutineOwner) actor.managedRoutineOriginalIdleMode = actor.idleMode;
    actor.managedRoutineOwner = ownerId;
    actor.managedRoutineLastRequestReason = null;
    return managedRoutineResult(actor, true);
  }

  /**
   * Queue, but never search, a managed graph destination. The actor remains
   * stationary in routine_route_pending until the external route-search drain
   * accepts this request. Request and stuck repair work therefore share the
   * same caller-owned frame budget.
   */
  function queueManagedRoutineDestination(target, ownerValue, destination, options = {}) {
    const actor = resolveActor(target);
    if (!actor) return managedRoutineResult(null, false, "actor_not_found");
    const ownerId = managedRoutineOwnerId(ownerValue);
    if (!ownerId) return managedRoutineResult(actor, false, "owner_required");
    if (!actor.managedRoutineOwner) return managedRoutineResult(actor, false, "actor_not_leased");
    if (actor.managedRoutineOwner !== ownerId) return managedRoutineResult(actor, false, "owner_mismatch");
    const eligibilityReason = managedRoutineEligibilityReason(actor);
    if (eligibilityReason) return managedRoutineResult(actor, false, eligibilityReason);

    let request = options && typeof options === "object" ? options : {};
    let requestedPosition = destination;
    if (destination && typeof destination === "object" &&
        (destination.destination !== undefined || destination.position !== undefined)) {
      request = destination;
      requestedPosition = destination.destination ?? destination.position;
    }
    const position = positionVector(requestedPosition);
    if (!position) return managedRoutineResult(actor, false, "invalid_destination");
    position.y = groundHeight(position.x, position.z, position.y);
    let blocked = false;
    try { blocked = Boolean(world.isBlockedCircle?.(position.x, position.z, actor.radius + 0.08)); } catch {}
    if (blocked) return managedRoutineResult(actor, false, "destination_blocked");

    const arrivalRadius = clamp(request.arrivalRadius ?? 0.72, 0.35, 1.8);
    const speedScale = clamp(request.speedScale ?? 1, 0.55, 1.65);
    const location = request.locationId ?? request.location;
    const locationId = location === undefined || location === null ? null : String(location);
    const activity = request.activity === undefined || request.activity === null
      ? "managed_travel"
      : String(request.activity);
    const requestKeySource = request.requestKey ?? request.key;
    const requestKey = requestKeySource === undefined || requestKeySource === null
      ? null
      : String(requestKeySource).slice(0, 160);
    const rebuildRoute = request.rebuildRoute === true || request.forceRouteRebuild === true;

    if (!rebuildRoute && actor.routineDestinationActive &&
        actor.routineDestination.distanceToSquared(position) <= 1e-8) {
      actor.routineArrivalRadius = arrivalRadius;
      actor.routineTravelSpeedScale = speedScale;
      actor.routineLocation = locationId;
      actor.routineActivity = activity;
      actor.managedRoutineRequestKey = requestKey;
      if (!actor.managedRoutineRequestPending) actor.managedRoutineAppliedRequestKey = requestKey;
      actor.managedRoutineRequestStatus = actor.managedRoutineRequestPending ? "queued" : "accepted";
      actor.managedRoutineLastRequestReason = null;
      actor.managedRoutineDwelling = false;
      if (actor.routineDestinationArrived) setState(actor, "routine_arrived");
      return managedRoutineResult(actor, true);
    }

    clearSocial(actor);
    actor.routineDestination.copy(position);
    actor.routineDestinationActive = true;
    actor.routineDestinationArrived = false;
    actor.routineDestinationNodeIndex = -1;
    actor.routineRouteLength = 0;
    actor.routineRouteCursor = 0;
    actor.routineRouteRepairPending = false;
    actor.routineCrossingWaypoint = -1;
    actor.routineArrivalRadius = arrivalRadius;
    actor.routineTravelSpeedScale = speedScale;
    actor.routineLocation = locationId;
    actor.routineActivity = activity;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    actor.idleUntil = 0;
    actor.stuckFor = 0;
    actor.managedRoutineRequestPending = true;
    actor.managedRoutineRequestKey = requestKey;
    actor.managedRoutineRequestStatus = "queued";
    actor.managedRoutineLastRequestReason = null;
    actor.managedRoutineDwelling = false;
    setState(actor, "routine_route_pending");
    return managedRoutineResult(actor, true);
  }

  function setManagedRoutineDwell(target, ownerValue, options = {}) {
    const actor = resolveActor(target);
    if (!actor) return managedRoutineResult(null, false, "actor_not_found");
    const ownerId = managedRoutineOwnerId(ownerValue);
    if (!ownerId) return managedRoutineResult(actor, false, "owner_required");
    if (!actor.managedRoutineOwner) return managedRoutineResult(actor, false, "actor_not_leased");
    if (actor.managedRoutineOwner !== ownerId) return managedRoutineResult(actor, false, "owner_mismatch");
    const eligibilityReason = managedRoutineEligibilityReason(actor);
    if (eligibilityReason) return managedRoutineResult(actor, false, eligibilityReason);
    if (actor.managedRoutineRequestPending) return managedRoutineResult(actor, false, "route_pending");
    if (!actor.routineDestinationActive || !actor.routineDestinationArrived) {
      return managedRoutineResult(actor, false, "actor_not_arrived");
    }
    const location = options.locationId ?? options.location;
    if (location !== undefined) actor.routineLocation = location === null ? null : String(location);
    if (options.activity !== undefined) {
      actor.routineActivity = options.activity === null ? null : String(options.activity);
    }
    if (options.idleMode !== undefined && options.idleMode !== null) {
      actor.idleMode = String(options.idleMode);
    }
    actor.managedRoutineRequestStatus = "accepted";
    actor.managedRoutineLastRequestReason = null;
    actor.managedRoutineDwelling = true;
    setState(actor, "routine_dwell");
    return managedRoutineResult(actor, true);
  }

  function restoreManagedRoutineActor(target, ownerValue, value = {}) {
    const actor = resolveActor(target);
    if (!actor) return managedRoutineResult(null, false, "actor_not_found");
    const ownerId = managedRoutineOwnerId(ownerValue);
    if (!ownerId) return managedRoutineResult(actor, false, "owner_required");
    if (!actor.managedRoutineOwner) return managedRoutineResult(actor, false, "actor_not_leased");
    if (actor.managedRoutineOwner !== ownerId) return managedRoutineResult(actor, false, "owner_mismatch");
    const eligibilityReason = managedRoutineEligibilityReason(actor);
    if (eligibilityReason) return managedRoutineResult(actor, false, eligibilityReason);

    const restoredPosition = positionVector(value.position);
    if (!restoredPosition) return managedRoutineResult(actor, false, "invalid_position");
    let blocked = false;
    try {
      blocked = Boolean(world.isBlockedCircle?.(
        restoredPosition.x,
        restoredPosition.z,
        actor.radius + 0.08,
      ));
    } catch {}
    if (blocked) return managedRoutineResult(actor, false, "position_blocked");

    actor.root.position.copy(restoredPosition);
    actor.root.rotation.y = finite(value.yaw, actor.root.rotation.y);
    actor.velocity.set(0, 0, 0);
    actor.steering.set(0, 0, 0);
    actor.speed = 0;
    actor.stuckFor = 0;
    actor.nodeIndex = nearestNodeIndex(actor.root.position);
    actor.previousNodeIndex = -1;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    if (value.idleMode !== undefined && value.idleMode !== null) actor.idleMode = String(value.idleMode);

    const restoredDestination = positionVector(value.destination);
    if (!restoredDestination) {
      clearRoutineContract(actor, String(value.state ?? "wander"));
      actor.managedRoutineRequestPending = false;
      actor.managedRoutineRequestStatus = "accepted";
      actor.managedRoutineLastRequestReason = null;
      return managedRoutineResult(actor, true);
    }

    const request = {
      position: restoredDestination,
      locationId: value.locationId ?? value.location,
      activity: value.activity,
      arrivalRadius: value.arrivalRadius,
      speedScale: value.speedScale,
      requestKey: value.requestKey,
      rebuildRoute: true,
    };
    if (value.arrived === true) {
      actor.routineDestination.copy(restoredDestination);
      actor.routineDestinationActive = true;
      actor.routineDestinationArrived = true;
      actor.routineDestinationNodeIndex = nearestNodeIndex(restoredDestination);
      actor.routineRouteLength = 0;
      actor.routineRouteCursor = 0;
      actor.routineRouteRepairPending = false;
      actor.routineCrossingWaypoint = -1;
      actor.routineArrivalRadius = clamp(value.arrivalRadius ?? 0.72, 0.35, 1.8);
      actor.routineTravelSpeedScale = clamp(value.speedScale ?? 1, 0.55, 1.65);
      const location = value.locationId ?? value.location;
      actor.routineLocation = location === undefined || location === null ? null : String(location);
      actor.routineActivity = value.activity === undefined || value.activity === null
        ? "managed_dwell"
        : String(value.activity);
      actor.managedRoutineRequestPending = false;
      actor.managedRoutineRequestKey = request.requestKey ?? null;
      actor.managedRoutineAppliedRequestKey = request.requestKey ?? null;
      actor.managedRoutineRequestStatus = "accepted";
      actor.managedRoutineLastRequestReason = null;
      actor.managedRoutineDwelling = value.dwelling === true || value.state === "routine_dwell";
      setState(actor, String(value.state ?? (actor.managedRoutineDwelling ? "routine_dwell" : "routine_arrived")));
      return managedRoutineResult(actor, true);
    }

    const queued = queueManagedRoutineDestination(actor, ownerId, request);
    if (queued.accepted && value.state !== undefined && value.state !== null) {
      actor.state = String(value.state);
      actor.stateTime = 0;
    }
    return managedRoutineResult(actor, queued.accepted, queued.reason);
  }

  function releaseManagedRoutineActor(target, ownerValue) {
    const actor = resolveActor(target);
    if (!actor) return managedRoutineResult(null, false, "actor_not_found");
    const ownerId = managedRoutineOwnerId(ownerValue);
    if (!ownerId) return managedRoutineResult(actor, false, "owner_required");
    if (!actor.managedRoutineOwner) return managedRoutineResult(actor, false, "actor_not_leased");
    if (actor.managedRoutineOwner !== ownerId) return managedRoutineResult(actor, false, "owner_mismatch");
    clearSocial(actor);
    actor.managedRoutineOwner = null;
    actor.managedRoutineRequestPending = false;
    actor.managedRoutineRequestKey = null;
    actor.managedRoutineAppliedRequestKey = null;
    actor.managedRoutineRequestStatus = "idle";
    actor.managedRoutineLastRequestReason = null;
    actor.managedRoutineDwelling = false;
    if (actor.managedRoutineOriginalIdleMode !== null) actor.idleMode = actor.managedRoutineOriginalIdleMode;
    actor.managedRoutineOriginalIdleMode = null;
    clearRoutineContract(actor);
    return managedRoutineResult(actor, true);
  }

  function setRoutineDestination(target, destination, options = {}) {
    const actor = resolveActor(target);
    if (!actor) return routineDestinationResult(null, false, "actor_not_found");
    if (!namedRoutineResident(actor)) return routineDestinationResult(actor, false, "resident_identity_required");
    if (actor.managedRoutineOwner) return routineDestinationResult(actor, false, "actor_managed");
    if (actor.presentationStaged) return routineDestinationResult(actor, false, "actor_staged");
    if (!actor.active || !actor.alive || actor.ragdollActive) {
      return routineDestinationResult(actor, false, "actor_unavailable");
    }

    let request = options && typeof options === "object" ? options : {};
    let requestedPosition = destination;
    if (destination && typeof destination === "object" &&
        (destination.destination !== undefined || destination.position !== undefined)) {
      request = destination;
      requestedPosition = destination.destination ?? destination.position;
    }
    const position = positionVector(requestedPosition);
    if (!position) return routineDestinationResult(actor, false, "invalid_destination");
    position.y = groundHeight(position.x, position.z, position.y);
    let blocked = false;
    try { blocked = Boolean(world.isBlockedCircle?.(position.x, position.z, actor.radius + 0.08)); } catch {}
    if (blocked) return routineDestinationResult(actor, false, "destination_blocked");
    const arrivalRadius = clamp(request.arrivalRadius ?? 0.72, 0.35, 1.8);
    const speedScale = clamp(request.speedScale ?? 1, 0.55, 1.65);
    const location = request.locationId ?? request.location;
    const locationId = location === undefined || location === null ? null : String(location);
    const activity = request.activity === undefined || request.activity === null
      ? "travel"
      : String(request.activity);
    const rebuildRoute = request.rebuildRoute === true || request.forceRouteRebuild === true;
    if (!rebuildRoute && actor.routineDestinationActive && actor.routineDestination.distanceToSquared(position) <= 1e-8) {
      // Schedule evaluators may repeat the same assignment every tick. Treat
      // that as an in-place metadata refresh so an arrived resident never
      // restarts a route and no graph search enters the frame loop.
      actor.routineArrivalRadius = arrivalRadius;
      actor.routineTravelSpeedScale = speedScale;
      actor.routineLocation = locationId;
      actor.routineActivity = activity;
      return routineDestinationResult(actor, true);
    }
    if (!buildRoutineRoute(actor, position)) {
      return routineDestinationResult(actor, false, "destination_unreachable");
    }

    clearSocial(actor);
    actor.routineDestination.copy(position);
    actor.routineDestinationActive = true;
    actor.routineDestinationArrived = false;
    actor.routineArrivalRadius = arrivalRadius;
    actor.routineLocation = locationId;
    actor.routineActivity = activity;
    actor.routineTravelSpeedScale = speedScale;
    actor.routineRouteRepairPending = false;
    actor.routineCrossingWaypoint = -1;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    actor.idleUntil = 0;
    actor.stuckFor = 0;
    setState(actor, "routine_travel");
    return routineDestinationResult(actor, true);
  }

  function clearRoutineDestination(target) {
    const actor = resolveActor(target);
    if (!actor) return routineDestinationResult(null, false, "actor_not_found");
    if (!namedRoutineResident(actor)) return routineDestinationResult(actor, false, "resident_identity_required");
    if (actor.managedRoutineOwner) return routineDestinationResult(actor, false, "actor_managed");
    if (actor.presentationStaged) return routineDestinationResult(actor, false, "actor_staged");
    clearRoutineContract(actor);
    return routineDestinationResult(actor, true);
  }

  function clearSocial(actor) {
    if (!actor) return;
    const partner = actor.socialPartner;
    actor.socialPartner = null;
    actor.socialUntil = 0;
    if (partner?.socialPartner === actor) {
      partner.socialPartner = null;
      partner.socialUntil = 0;
    }
  }

  function chooseIdleBehavior(actor) {
    clearSocial(actor);
    const schedule = scheduleFor(actor);
    const morning = wrappedHour() >= 6 && wrappedHour() < 11;
    const modes = morning ? ["look", "phone", "coffee", "hands"] : ["look", "phone", "stretch", "hands"];
    actor.idleMode = modes[Math.floor(random() * modes.length)];
    let partner = null;
    let partnerDistanceSq = 4.6 * 4.6;
    const canSocialize = rainAmount < 0.3 && !["commute", "commute-home", "exercise"].includes(schedule);
    if (canSocialize) {
      for (const other of actors) {
        if (other === actor || other.police || !other.active || !other.alive || other.socialPartner ||
            other.panicUntil > elapsed || other.state === "hit" || other.state === "stumble") continue;
        const distanceSq = actor.root.position.distanceToSquared(other.root.position);
        if (distanceSq < partnerDistanceSq) { partner = other; partnerDistanceSq = distanceSq; }
      }
    }
    // A stable subset initiates conversations. The index gate prevents every
    // pedestrian in a dense group from pairing on the same frame.
    if (partner && ((actor.index + Math.floor(elapsed * 2)) & 1) === 0) {
      const duration = 1.45 + random() * 1.65;
      actor.socialPartner = partner;
      partner.socialPartner = actor;
      actor.socialUntil = partner.socialUntil = elapsed + duration;
      actor.idleUntil = partner.idleUntil = actor.socialUntil;
      actor.idleMode = actor.index % 2 ? "hands" : "talk";
      partner.idleMode = partner.index % 2 ? "talk" : "hands";
      setState(actor, "social");
      setState(partner, "social");
      return;
    }
    const dwellScale = rainAmount > 0.3 ? 0.38 : schedule === "leisure" || schedule === "nightlife" ? 1.25 : 1;
    actor.idleUntil = elapsed + (0.65 + random() * 2.25) * dwellScale;
    setState(actor, "idle");
  }

  function planCrossing(actor, destination, reuse = null) {
    if (!crossings.length) return null;
    let choiceCrossing = null;
    let choiceEntry = null;
    let choiceExit = null;
    let bestScore = Infinity;
    for (const crossing of crossings) {
      const actorSide = crossing.roadAxis === "z"
        ? actor.root.position.x - crossing.roadCenter
        : actor.root.position.z - crossing.roadCenter;
      const destinationSide = crossing.roadAxis === "z"
        ? destination.x - crossing.roadCenter
        : destination.z - crossing.roadCenter;
      if (actorSide * destinationSide >= -1) continue;
      const entry = actorSide < 0 ? crossing.a : crossing.b;
      const exit = actorSide < 0 ? crossing.b : crossing.a;
      const score = actor.root.position.distanceTo(entry) + exit.distanceTo(destination);
      if (score < bestScore) {
        bestScore = score;
        choiceCrossing = crossing;
        choiceEntry = entry;
        choiceExit = exit;
      }
    }
    if (!choiceCrossing) return null;
    const result = reuse ?? {};
    result.roadAxis = choiceCrossing.roadAxis;
    result.roadCenter = choiceCrossing.roadCenter;
    result.center = choiceCrossing.center;
    result.entry = choiceEntry;
    result.exit = choiceExit;
    result.stage = "approach";
    result.waitUntil = 0;
    return result;
  }

  function crossingHasTraffic(crossing) {
    for (let index = 0; index < observedVehicleCount; ++index) {
      const vehicle = vehicleObservations[index];
      if (vehicle.speed < 1.5 || vehicle.position.distanceToSquared(crossing.center) > 12 * 12) continue;
      return true;
    }
    return false;
  }

  function updateCrossing(actor, delta) {
    const crossing = actor.crossing;
    if (!crossing) return false;
    if (crossing.stage === "approach") {
      tempDirection.copy(crossing.entry).sub(actor.root.position).setY(0);
      if (tempDirection.lengthSq() > 1.35 * 1.35) {
        setState(actor, "crosswalk_approach");
        moveActor(actor, tempDirection, actor.preferredSpeed, delta, 6.5);
        return true;
      }
      crossing.stage = "wait";
      crossing.waitUntil = elapsed + 0.16 + (actor.index % 4) * 0.055;
    }
    if (crossing.stage === "wait") {
      const safeSignal = vehicleSignalAt(elapsed, crossing.roadAxis) === "red";
      if (elapsed >= crossing.waitUntil && safeSignal && !crossingHasTraffic(crossing)) crossing.stage = "cross";
      else {
        setState(actor, "crosswalk_wait");
        stopActor(actor, delta, 11);
        turnToward(actor, crossing.exit, delta, 9);
        return true;
      }
    }
    tempDirection.copy(crossing.exit).sub(actor.root.position).setY(0);
    // Keep walking until the capsule is genuinely clear of the carriageway;
    // a broad waypoint radius leaves feet visibly stranded in the live lane.
    if (tempDirection.lengthSq() <= 0.52 * 0.52) {
      actor.crossing = null;
      setState(actor, "wander");
      return false;
    }
    // Once committed, finish the crossing even if the signal changes. Stopping
    // in a live lane is less safe and looks less natural than clearing it.
    setState(actor, "crosswalk_cross");
    moveActor(actor, tempDirection, Math.max(1.7, actor.preferredSpeed * 1.18), delta, 8);
    return true;
  }

  function vehicleThreatFor(actor) {
    let best = null;
    let bestScore = Infinity;
    for (let index = 0; index < observedVehicleCount; ++index) {
      const vehicle = vehicleObservations[index];
      if (vehicle.speed < 2.2) continue;
      const dx = actor.root.position.x - vehicle.position.x;
      const dz = actor.root.position.z - vehicle.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > 13 * 13) continue;
      const velocitySq = vehicle.velocity.x * vehicle.velocity.x + vehicle.velocity.z * vehicle.velocity.z;
      let time = 0;
      let closestSq = distanceSq;
      if (velocitySq > 0.25) {
        time = clamp((dx * vehicle.velocity.x + dz * vehicle.velocity.z) / velocitySq, 0, 1.45);
        const closestX = dx - vehicle.velocity.x * time;
        const closestZ = dz - vehicle.velocity.z * time;
        closestSq = closestX * closestX + closestZ * closestZ;
      }
      const clearance = vehicle.radius + actor.radius + 1.15;
      if (closestSq > clearance * clearance || (velocitySq <= 0.25 && distanceSq > (clearance + 0.7) ** 2)) continue;
      const score = closestSq + time * 1.8;
      if (score < bestScore) { bestScore = score; best = vehicle; }
    }
    return best;
  }

  function updateVehicleObservations(sources, playerVehicle = null) {
    observedVehicleCount = 0;
    if (!Array.isArray(sources)) return;
    for (const source of sources) {
      if (!source || observedVehicleCount >= VEHICLE_OBSERVATION_LIMIT) break;
      const state = source.state ?? source;
      const rawPosition = source.root?.position ?? source.position ?? state.position ?? state;
      const hasPosition = rawPosition?.isVector3 || Array.isArray(rawPosition) || ArrayBuffer.isView(rawPosition) ||
        (rawPosition && typeof rawPosition === "object" &&
          (Number.isFinite(Number(rawPosition.x)) || Number.isFinite(Number(state.x))));
      if (!hasPosition) continue;
      let observation = vehicleObservations[observedVehicleCount];
      if (!observation) {
        observation = {
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          speed: 0,
          radius: 1.4,
          playerDriven: false,
        };
        vehicleObservations.push(observation);
      }
      if (rawPosition?.isVector3) observation.position.copy(rawPosition);
      else if (Array.isArray(rawPosition) || ArrayBuffer.isView(rawPosition)) {
        observation.position.set(finite(rawPosition[0]), finite(rawPosition[1]), finite(rawPosition[2]));
      } else {
        observation.position.set(finite(rawPosition.x ?? state.x), finite(rawPosition.y), finite(rawPosition.z ?? state.z));
      }
      const rawVelocity = source.velocity ?? state.velocity;
      if (rawVelocity?.isVector3) observation.velocity.copy(rawVelocity);
      else if (Array.isArray(rawVelocity) || ArrayBuffer.isView(rawVelocity)) {
        observation.velocity.set(finite(rawVelocity[0]), finite(rawVelocity[1]), finite(rawVelocity[2]));
      } else if (rawVelocity && typeof rawVelocity === "object") {
        observation.velocity.set(finite(rawVelocity.x), finite(rawVelocity.y), finite(rawVelocity.z));
      } else {
        const yaw = finite(source.yaw ?? state.yaw);
        const forwardSpeed = finite(source.speed ?? state.speed);
        const lateralSpeed = finite(source.lateralSpeed ?? state.lateralSpeed);
        observation.velocity.set(
          -Math.sin(yaw) * forwardSpeed + Math.cos(yaw) * lateralSpeed,
          0,
          -Math.cos(yaw) * forwardSpeed - Math.sin(yaw) * lateralSpeed,
        );
      }
      observation.speed = Math.hypot(observation.velocity.x, observation.velocity.z);
      observation.radius = Math.max(0.6, finite(source.radius ?? state.radius, 1.4));
      observation.playerDriven = source === playerVehicle || Boolean(source.playerDriven) ||
        (playerVehicle?.id !== undefined && String(source.id) === String(playerVehicle.id));
      observedVehicleCount += 1;
    }
  }

  function beginYield(actor, vehicle) {
    const velocitySq = vehicle.velocity.x * vehicle.velocity.x + vehicle.velocity.z * vehicle.velocity.z;
    if (velocitySq > 0.25) {
      actor.yieldDirection.set(-vehicle.velocity.z, 0, vehicle.velocity.x).normalize();
      tempDirection.copy(actor.root.position).sub(vehicle.position).setY(0);
      if (actor.yieldDirection.dot(tempDirection) < 0) actor.yieldDirection.negate();
    } else {
      actor.yieldDirection.copy(actor.root.position).sub(vehicle.position).setY(0);
      if (actor.yieldDirection.lengthSq() < 0.01) actor.yieldDirection.set(actor.evadeSign, 0, 0);
      else actor.yieldDirection.normalize();
    }
    clearSocial(actor);
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    actor.stateUntil = Math.max(actor.stateUntil, elapsed + 0.68);
    actor.yieldSpeed = 3.8 + (actor.index % 3) * 0.18;
    if (vehicle.playerDriven && vehicle.speed > 7) actor.panicUntil = Math.max(actor.panicUntil, elapsed + 1.25);
    setState(actor, "yield");
  }

  function queueAlertReaction(actor) {
    if (!lastAlert || actor.lastAlertSerial === lastAlert.serial) return;
    const distanceSq = actor.root.position.distanceToSquared(lastAlert.position);
    if (distanceSq > lastAlert.radius * lastAlert.radius) return;
    const direct = clearLineOfSight(actor.root.position, lastAlert.position);
    const audible = /gunfire|shot|explosion|vehicle|horn/i.test(lastAlert.reason);
    let propagated = false;
    if (!direct && !audible) {
      propagated = actors.some(other => other !== actor && !other.police && other.active && other.alive &&
        other.lastAlertSerial === lastAlert.serial && other.root.position.distanceToSquared(actor.root.position) < 8 * 8);
      if (!propagated) return;
    }
    actor.lastAlertSerial = lastAlert.serial;
    const cadence = ((actor.index * 17 + lastAlert.serial * 7) % 11) * 0.032;
    actor.pendingAlert = {
      serial: lastAlert.serial,
      position: lastAlert.position.clone(),
      activateAt: elapsed + (direct ? 0.1 : propagated ? 0.28 : 0.34) + cadence,
      direct,
      reason: lastAlert.reason,
    };
  }

  function updateAlertReaction(actor, delta) {
    const reaction = actor.pendingAlert;
    if (reaction && elapsed >= reaction.activateAt) {
      clearSocial(actor);
      actor.crossing = null;
      actor.crossingDestinationIndex = -1;
      actor.threatPosition.copy(reaction.position);
      if (/horn/i.test(reaction.reason)) {
        actor.yieldDirection.copy(actor.root.position).sub(reaction.position).setY(0);
        if (actor.yieldDirection.lengthSq() < 0.01) actor.yieldDirection.set(actor.evadeSign, 0, 0);
        else actor.yieldDirection.normalize();
        actor.yieldSpeed = 1.55;
        actor.stateUntil = Math.max(actor.stateUntil, elapsed + 0.72);
        actor.pendingAlert = null;
        setState(actor, "yield");
        return false;
      }
      actor.witnessUntil = elapsed + (reaction.direct ? 0.28 + (actor.index % 3) * 0.09 : 0.13);
      actor.panicUntil = Math.max(actor.panicUntil, actor.witnessUntil + 4.5 + (actor.index % 5) * 0.42);
      actor.pendingAlert = null;
      setState(actor, "witness");
    }
    if (elapsed >= actor.witnessUntil) return false;
    setState(actor, "witness");
    stopActor(actor, delta, 12);
    turnToward(actor, actor.threatPosition, delta, actor.witnessMode === "cower" ? 7 : 12);
    return true;
  }

  function updateTransitRoutine(actor, delta) {
    const schedule = scheduleFor(actor);
    const anchor = transitAnchorFor(actor, schedule);
    if (!anchor) return false;
    if (actor.socialPartner) clearSocial(actor);
    actor.idleUntil = 0;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    tempDirection.copy(anchor).sub(actor.root.position).setY(0);
    const distanceSq = tempDirection.lengthSq();
    if (distanceSq <= 0.72 * 0.72) {
      setState(actor, "transit_wait");
      stopActor(actor, delta, 11);
      return true;
    }

    setState(actor, "transit_approach");
    if (clearLineOfSight(actor.root.position, anchor)) {
      moveActor(actor, tempDirection, actor.preferredSpeed * 1.16 * (1 + rainAmount * 0.1), delta, 6.5);
    } else {
      // Authored sidewalk nodes remain the fallback around a real blocker;
      // routineFocusFor biases each fixed graph choice toward this stop.
      const destination = nodes[actor.nodeIndex] ?? nodes[0];
      tempDirection.copy(destination).sub(actor.root.position).setY(0);
      if (tempDirection.lengthSq() < 1.6) {
        chooseNextNode(actor);
        stopActor(actor, delta, 10);
      } else {
        moveActor(actor, tempDirection, actor.preferredSpeed * 1.16, delta, 5.5);
      }
    }
    if (actor.stuckFor > 0.75) {
      chooseNextNode(actor);
      actor.stuckFor = 0;
    }
    return true;
  }

  function updateRoutineDestination(actor, delta) {
    if (!actor.routineDestinationActive) return false;
    clearSocial(actor);
    actor.idleUntil = 0;
    if (actor.managedRoutineRequestPending) {
      setState(actor, "routine_route_pending");
      stopActor(actor, delta, 11);
      return true;
    }
    if (actor.routineDestinationArrived) {
      setState(actor, actor.managedRoutineDwelling ? "routine_dwell" : "routine_arrived");
      stopActor(actor, delta, 11);
      return true;
    }

    let target = actor.routineDestination;
    let waypointKey = actor.routineRouteLength;
    while (actor.routineRouteCursor < actor.routineRouteLength) {
      const routeIndex = actor.routineRoute[actor.routineRouteCursor];
      const waypoint = nodes[routeIndex];
      if (!waypoint || actor.root.position.distanceToSquared(waypoint) <= 1.18 * 1.18) {
        actor.routineRouteCursor += 1;
        actor.routineCrossingWaypoint = -1;
        actor.crossing = null;
        continue;
      }
      target = waypoint;
      waypointKey = actor.routineRouteCursor;
      break;
    }

    const onFinalLeg = actor.routineRouteCursor >= actor.routineRouteLength;
    tempDirection.copy(target).sub(actor.root.position).setY(0);
    if (onFinalLeg && tempDirection.lengthSq() <= actor.routineArrivalRadius * actor.routineArrivalRadius) {
      actor.routineDestinationArrived = true;
      actor.routineCrossingWaypoint = -1;
      actor.crossing = null;
      actor.crossingDestinationIndex = -1;
      actor.velocity.set(0, 0, 0);
      actor.speed = 0;
      actor.idleMode = "hands";
      setState(actor, "routine_arrived");
      return true;
    }

    if (actor.routineCrossingWaypoint !== waypointKey) {
      actor.crossing = planCrossing(actor, target, actor.routineCrossing);
      actor.routineCrossingWaypoint = waypointKey;
    }
    if (updateCrossing(actor, delta)) return true;

    setState(actor, "routine_travel");
    tempDirection.copy(target).sub(actor.root.position).setY(0);
    moveActor(actor, tempDirection,
      actor.preferredSpeed * actor.routineTravelSpeedScale * (1 + rainAmount * 0.08), delta, 6.5);
    if (actor.stuckFor > 0.9) {
      // A full graph search here used to put every simultaneously blocked
      // resident's Dijkstra pass inside the actor hot loop. Queue the repair;
      // the caller drains a deterministic fixed budget before the next update.
      actor.routineRouteRepairPending = true;
      actor.stuckFor = 0;
    }
    return true;
  }

  function flushRoutineRouteSearches(maxSearches = 1) {
    const budget = Math.max(0, Math.min(actors.length, Math.trunc(finite(maxSearches, 1))));
    let searched = 0;
    for (const actor of actors) {
      if (searched >= budget) break;
      if (actor.managedRoutineRequestPending) {
        const eligibilityReason = managedRoutineEligibilityReason(actor);
        if (eligibilityReason || !actor.managedRoutineOwner || !actor.routineDestinationActive) {
          actor.managedRoutineRequestPending = false;
          actor.managedRoutineRequestStatus = "rejected";
          actor.managedRoutineLastRequestReason = eligibilityReason ?? "actor_not_leased";
          actor.routineDestinationActive = false;
          actor.routineDestinationArrived = false;
          actor.routineRouteLength = 0;
          actor.routineRouteCursor = 0;
          actor.routineRouteRepairPending = false;
          continue;
        }
        actor.managedRoutineRequestPending = false;
        searched += 1;
        if (buildRoutineRoute(actor, actor.routineDestination)) {
          actor.managedRoutineAppliedRequestKey = actor.managedRoutineRequestKey;
          actor.managedRoutineRequestStatus = "accepted";
          actor.managedRoutineLastRequestReason = null;
          actor.routineCrossingWaypoint = -1;
          actor.crossing = null;
          actor.crossingDestinationIndex = -1;
          setState(actor, "routine_travel");
        } else {
          actor.managedRoutineRequestStatus = "rejected";
          actor.managedRoutineLastRequestReason = "destination_unreachable";
          actor.routineDestinationActive = false;
          actor.routineDestinationArrived = false;
          actor.routineDestinationNodeIndex = -1;
          actor.routineRouteLength = 0;
          actor.routineRouteCursor = 0;
          setState(actor, "wander");
        }
        continue;
      }
      if (!actor.routineRouteRepairPending) continue;
      if (!actor.active || !actor.alive || actor.ragdollActive ||
          !actor.routineDestinationActive || actor.routineDestinationArrived) {
        actor.routineRouteRepairPending = false;
        continue;
      }
      if (actor.storyLocked || actor.presentationStaged) continue;
      actor.routineRouteRepairPending = false;
      searched += 1;
      if (buildRoutineRoute(actor, actor.routineDestination)) {
        actor.routineCrossingWaypoint = -1;
        actor.crossing = null;
        actor.crossingDestinationIndex = -1;
      }
    }
    return searched;
  }

  // Historical callers already drain this hook once per frame. Keep the name
  // as a compatibility alias while including both managed assignments and
  // stuck-route repairs in its single deterministic search budget.
  function flushRoutineRouteRepairs(maxSearches = 1) {
    return flushRoutineRouteSearches(maxSearches);
  }

  function updateCivilian(actor, delta, targetPosition, wantedStars) {
    if (lastAlert && elapsed - lastAlert.time <= ALERT_LIFETIME) queueAlertReaction(actor);
    if (wantedStars > 0 && targetPosition) {
      const dangerRadius = 16 + Math.min(5, wantedStars) * 2.2;
      if (actor.root.position.distanceToSquared(targetPosition) < dangerRadius * dangerRadius) {
        actor.threatPosition.copy(targetPosition);
        actor.panicUntil = Math.max(actor.panicUntil, elapsed + 1.35);
      }
    }
    if ((actor.state === "hit" || actor.state === "stumble") && elapsed < actor.stateUntil) {
      if (actor.state === "stumble" && actor.knockback.lengthSq() > 1e-5) {
        moveActor(actor, actor.knockback, Math.max(1.2, actor.knockback.length()), delta, 13);
        actor.knockback.multiplyScalar(Math.exp(-delta * 6));
      } else stopActor(actor, delta, 14);
      return;
    }
    const vehicleThreat = vehicleThreatFor(actor);
    if (vehicleThreat) beginYield(actor, vehicleThreat);
    if (updateAlertReaction(actor, delta)) return;
    if (actor.state === "yield" && elapsed < actor.stateUntil) {
      moveActor(actor, actor.yieldDirection, actor.yieldSpeed || 2.2, delta, 12);
      return;
    }
    if (elapsed < actor.panicUntil) {
      clearSocial(actor);
      actor.crossing = null;
      actor.crossingDestinationIndex = -1;
      setState(actor, "flee");
      tempDirection.copy(actor.root.position).sub(actor.threatPosition).setY(0);
      if (tempDirection.lengthSq() < 0.05) {
        const angle = actor.index * 2.399963 + actor.panicUntil * 0.17;
        tempDirection.set(Math.cos(angle), 0, Math.sin(angle));
      }
      tempDirection.normalize();
      const sideX = -tempDirection.z * actor.evadeSign;
      const sideZ = tempDirection.x * actor.evadeSign;
      tempDirection.x += sideX * 0.24;
      tempDirection.z += sideZ * 0.24;
      moveActor(actor, tempDirection, 5.15 + (actor.index % 3) * 0.22, delta, 11);
      if (actor.stuckFor > 0.45) { actor.evadeSign *= -1; actor.stuckFor = 0; }
      return;
    }
    if (rainAmount > 0.3 && actor.socialPartner) clearSocial(actor);
    if (actor.socialPartner) {
      const partner = actor.socialPartner;
      if (partner.active && partner.alive && partner.socialPartner === actor && elapsed < actor.socialUntil) {
        setState(actor, "social");
        stopActor(actor, delta, 10);
        turnToward(actor, partner.root.position, delta, 8);
        return;
      }
      clearSocial(actor);
    }
    if (updateRoutineDestination(actor, delta)) return;
    if (updateTransitRoutine(actor, delta)) return;
    if (elapsed < actor.idleUntil) {
      setState(actor, "idle");
      stopActor(actor, delta, 8);
      return;
    }
    setState(actor, "wander");
    const destination = nodes[actor.nodeIndex] ?? nodes[0];
    if (actor.crossingDestinationIndex !== actor.nodeIndex) {
      actor.crossing = planCrossing(actor, destination);
      actor.crossingDestinationIndex = actor.nodeIndex;
    }
    if (updateCrossing(actor, delta)) return;
    tempDirection.copy(destination).sub(actor.root.position).setY(0);
    if (tempDirection.lengthSq() < 1.6) {
      chooseNextNode(actor);
      chooseIdleBehavior(actor);
      stopActor(actor, delta, 10);
      return;
    }
    const weatherStride = 1 + rainAmount * 0.12;
    moveActor(actor, tempDirection, actor.preferredSpeed * routineSpeedScale(actor) * weatherStride, delta, 5.5);
    if (actor.stuckFor > 0.75) { chooseNextNode(actor); actor.stuckFor = 0; }
  }

  function choosePoliceSpawn(targetPosition, actor) {
    if (!targetPosition) return policeSpawns[actor.index % policeSpawns.length].clone();
    let chosen = policeSpawns[actor.index % policeSpawns.length];
    let bestScore = Infinity;
    for (let index = 0; index < policeSpawns.length; ++index) {
      const candidate = policeSpawns[(index + actor.index) % policeSpawns.length];
      const distance = Math.sqrt(candidate.distanceToSquared(targetPosition));
      const score = distance < 24 ? 1000 - distance : Math.abs(distance - 48);
      if (score < bestScore) { bestScore = score; chosen = candidate; }
    }
    return chosen.clone();
  }

  function activatePolice(wantedStars, targetPosition) {
    const desired = wantedStars <= 0 ? 0 : Math.min(officers, 1 + Math.trunc(wantedStars) * 2);
    const policeActors = actors.filter(actor => actor.police);
    for (let index = 0; index < policeActors.length; ++index) {
      const actor = policeActors[index];
      const shouldBeAssigned = index < desired || elapsed < actor.manualUntil;
      const wasAssigned = actor.assigned;
      actor.assigned = shouldBeAssigned;
      if (shouldBeAssigned) {
        if (actor.alive && !actor.active) {
          const spawn = choosePoliceSpawn(targetPosition, actor);
          actor.homePosition.copy(spawn);
          resetActor(actor, spawn, "pursue");
        } else if (actor.alive && actor.state === "return") setState(actor, "pursue");
      } else if (wasAssigned && actor.active && actor.alive) {
        actor.returnUntil = elapsed + 4.5 + random();
        setState(actor, "return");
      } else if (!actor.active) {
        actor.root.visible = false;
        setState(actor, "reserve");
      }
    }
  }

  function clearLineOfSight(from, to) {
    if (typeof world.isBlockedCircle !== "function") return true;
    tempDirection.copy(to).sub(from).setY(0);
    const distance = tempDirection.length();
    if (distance < 0.01) return true;
    // Sampling below a metre keeps narrow alley walls and lamp-base blockers
    // from falling between samples without requiring a world-specific ray API.
    const steps = Math.min(32, Math.max(2, Math.ceil(distance / 0.9)));
    for (let step = 1; step < steps; ++step) {
      const amount = step / steps;
      const x = from.x + tempDirection.x * amount;
      const z = from.z + tempDirection.z * amount;
      try { if (world.isBlockedCircle(x, z, 0.16)) return false; } catch { return true; }
    }
    return true;
  }

  function turnToward(actor, target, delta, response = 15) {
    tempDirection.copy(target).sub(actor.root.position).setY(0);
    if (tempDirection.lengthSq() < 1e-7) return 0;
    const targetYaw = Math.atan2(-tempDirection.x, -tempDirection.z);
    const difference = angleDelta(targetYaw, actor.root.rotation.y);
    actor.root.rotation.y += difference * (1 - Math.exp(-delta * response));
    return Math.abs(angleDelta(targetYaw, actor.root.rotation.y));
  }

  function firePoliceWeapon(actor, target, distance, wantedStars, delta, hasDirectTarget) {
    const aimError = turnToward(actor, target, delta, 18);
    if (!hasDirectTarget || actor.reloadUntil > elapsed || actor.shotCooldown > 0 || aimError > 0.32 || distance > 19) return;
    actor.shotsFired += 1;
    actor.burstRemaining -= 1;
    actor.roundsInMagazine = Math.max(0, actor.roundsInMagazine - 1);
    const hitChance = clamp(0.88 - distance * 0.023 + wantedStars * 0.025, 0.43, 0.91);
    if (random() < hitChance) {
      const amount = 4.5 + random() * 3.5 + Math.min(5, wantedStars) * 0.38;
      invoke(onPlayerDamage, { amount, source: actor, kind: "police_fire", distance, hitChance });
    }
    if (actor.roundsInMagazine <= 0) {
      actor.reloadUntil = elapsed + 1.35 + (actor.index % 3) * 0.12;
      actor.reloadCount += 1;
      actor.burstRemaining = 2 + actor.index % 2;
      actor.shotCooldown = 0;
    } else if (actor.burstRemaining > 0) actor.shotCooldown = 0.18 + random() * 0.14;
    else {
      actor.burstRemaining = 2 + Math.floor(random() * 2);
      actor.shotCooldown = 0.82 + random() * 0.62;
    }
  }

  function updateReturningOfficer(actor, delta) {
    tempDirection.copy(actor.homePosition).sub(actor.root.position).setY(0);
    if (tempDirection.lengthSq() < 1.6 || elapsed >= actor.returnUntil) {
      actor.active = false;
      actor.root.visible = false;
      actor.velocity.set(0, 0, 0);
      actor.speed = 0;
      setState(actor, "reserve");
      return;
    }
    setState(actor, "return");
    moveActor(actor, tempDirection, 2.8, delta, 6);
  }

  function updatePolice(actor, delta, targetPosition, wantedStars, playerStatus = null) {
    if (!actor.assigned) { updateReturningOfficer(actor, delta); return; }
    actor.shotCooldown -= delta;
    if (targetPosition) {
      actor.lastKnownTarget.copy(targetPosition);
      actor.memoryUntil = elapsed + POLICE_MEMORY;
    }
    const pursuitTarget = targetPosition ?? (elapsed < actor.memoryUntil ? actor.lastKnownTarget : null);
    if (actor.reloadUntil > 0) {
      if (elapsed < actor.reloadUntil) {
        setState(actor, "reload");
        stopActor(actor, delta, 10);
        if (pursuitTarget) turnToward(actor, pursuitTarget, delta, 8);
        return;
      }
      actor.reloadUntil = 0;
      actor.roundsInMagazine = POLICE_MAGAZINE_SIZE;
      actor.shotCooldown = 0.22 + (actor.index % 3) * 0.04;
    }
    if (!pursuitTarget) {
      setState(actor, "search");
      stopActor(actor, delta, 5);
      actor.root.rotation.y += actor.evadeSign * delta * 0.55;
      return;
    }
    if ((actor.state === "hit" || actor.state === "stumble") && elapsed < actor.stateUntil) {
      stopActor(actor, delta, 13);
      turnToward(actor, pursuitTarget, delta, 8);
      return;
    }
    tempDirection.copy(pursuitTarget).sub(actor.root.position).setY(0);
    const distance = tempDirection.length();
    const lineOfSight = distance <= 24 && clearLineOfSight(actor.root.position, pursuitTarget);
    if (playerStatus?.arrestable && lineOfSight) {
      setState(actor, "arrest");
      if (distance > 1.75) moveActor(actor, tempDirection, 3.25, delta, 11);
      else stopActor(actor, delta, 13);
      turnToward(actor, pursuitTarget, delta, 18);
      return;
    }
    if (distance > 14.5 || !lineOfSight) {
      setState(actor, lineOfSight ? "pursue" : "flank");
      const angle = actor.index * 2.399963 + (lineOfSight ? 0 : actor.evadeSign * 0.55);
      const ring = lineOfSight ? 3.2 : 6.5;
      tempTarget.copy(pursuitTarget);
      tempTarget.x += Math.cos(angle) * ring;
      tempTarget.z += Math.sin(angle) * ring;
      tempDirection.copy(tempTarget).sub(actor.root.position).setY(0);
      moveActor(actor, tempDirection, 5.0 + Math.min(5, wantedStars) * 0.18, delta, 9);
      if (actor.stuckFor > 0.55) { actor.evadeSign *= -1; actor.stuckFor = 0; }
      return;
    }
    setState(actor, "shoot");
    if (distance < 5.6) {
      tempDirection.copy(actor.root.position).sub(pursuitTarget).setY(0);
      const originalX = tempDirection.x;
      tempDirection.x += -tempDirection.z * actor.evadeSign * 0.36;
      tempDirection.z += originalX * actor.evadeSign * 0.36;
      moveActor(actor, tempDirection, 2.7, delta, 10);
    } else {
      tempDirection.copy(pursuitTarget).sub(actor.root.position).setY(0).normalize();
      const forwardX = tempDirection.x;
      tempDirection.x = -tempDirection.z * actor.evadeSign;
      tempDirection.z = forwardX * actor.evadeSign;
      moveActor(actor, tempDirection, 1.05 + (actor.index % 3) * 0.18, delta, 7);
    }
    firePoliceWeapon(actor, pursuitTarget, distance, wantedStars, delta, Boolean(targetPosition));
  }

  function updatePose(actor, delta) {
    actor.stateTime += delta;
    actor.animationTime += delta * (2.5 + actor.speed * 1.35);
    const { pivots, torso, head, props = {} } = actor.visual.userData;
    const bodyRootY = actor.visual.userData.bodyRootOffsetY ?? FULL_RIG_BODY_ROOT_Y;
    const propSafeState = !["flee", "witness", "hit", "stumble", "down", "shoot", "pursue", "flank"].includes(actor.state);
    const umbrellaVisible = !actor.police && !actor.storyLocked && actor.alive && rainAmount > 0.16 && propSafeState;
    actor.carryingUmbrella = umbrellaVisible;
    if (props.umbrella) {
      props.umbrella.visible = umbrellaVisible;
      props.umbrella.rotation.z = umbrellaVisible
        ? Math.sin(actor.animationTime * 0.38 + actor.index) * (0.018 + rainAmount * 0.022)
        : 0;
    }
    const dwelling = actor.state === "routine_dwell";
    if (props.phone) props.phone.visible = actor.alive && !umbrellaVisible &&
      (actor.state === "idle" || dwelling) && actor.idleMode === "phone";
    if (props.coffee) props.coffee.visible = actor.alive && !umbrellaVisible &&
      (actor.state === "idle" || dwelling) && actor.idleMode === "coffee";
    if (actor.ragdollActive) {
      // A bounded articulated ragdoll: the root follows a ballistic capsule,
      // while every major limb settles toward a deterministic impact pose.
      // It gives vehicle hits real momentum without introducing a native or
      // sample-specific physics dependency.
      const energy = Math.min(1, actor.ragdollImpact / 12);
      const settle = 1 - Math.exp(-delta * (5.5 + energy * 2));
      const phase = actor.ragdollPose;
      actor.visual.rotation.x += ((0.18 + Math.sin(phase) * 0.22) - actor.visual.rotation.x) * settle;
      actor.visual.rotation.z += ((actor.fallDirection * (1.12 + energy * 0.38)) - actor.visual.rotation.z) * settle;
      actor.visual.position.y += ((bodyRootY - 0.08 + actor.ragdollHeight * 0.24) - actor.visual.position.y) * settle;
      torso.rotation.x += ((-0.24 - energy * 0.22) - torso.rotation.x) * settle;
      torso.rotation.z += ((Math.sin(phase * 1.7) * 0.28) - torso.rotation.z) * settle;
      head.rotation.x += ((0.24 + Math.cos(phase) * 0.18) - head.rotation.x) * settle;
      head.rotation.y += ((Math.sin(phase * 0.83) * 0.42) - head.rotation.y) * settle;
      pivots.leftArm.rotation.x += ((-1.24 + Math.sin(phase) * 0.48) - pivots.leftArm.rotation.x) * settle;
      pivots.rightArm.rotation.x += ((0.82 + Math.cos(phase) * 0.56) - pivots.rightArm.rotation.x) * settle;
      pivots.leftArm.rotation.z += ((-0.48 - energy * 0.25) - pivots.leftArm.rotation.z) * settle;
      pivots.rightArm.rotation.z += ((0.38 + energy * 0.3) - pivots.rightArm.rotation.z) * settle;
      pivots.leftLeg.rotation.x += ((0.72 + Math.cos(phase * 1.2) * 0.38) - pivots.leftLeg.rotation.x) * settle;
      pivots.rightLeg.rotation.x += ((-0.64 + Math.sin(phase * 1.3) * 0.4) - pivots.rightLeg.rotation.x) * settle;
      return;
    }
    if (!actor.alive || actor.state === "down") {
      const fallTarget = actor.fallDirection * 1.47;
      actor.visual.rotation.z += (fallTarget - actor.visual.rotation.z) * (1 - Math.exp(-delta * 7));
      actor.visual.position.y += ((bodyRootY - 0.18) - actor.visual.position.y) * (1 - Math.exp(-delta * 6));
      pivots.leftArm.rotation.x = -0.45;
      pivots.rightArm.rotation.x = 0.35;
      pivots.leftLeg.rotation.x = 0.18;
      pivots.rightLeg.rotation.x = -0.24;
      return;
    }
    actor.visual.rotation.z *= Math.exp(-delta * 9);
    const breathing = Math.sin(actor.animationTime * 0.62 + actor.index) * (actor.speed < 0.25 ? 0.012 : 0.004);
    actor.visual.position.y += ((bodyRootY + breathing) - actor.visual.position.y) * (1 - Math.exp(-delta * 8));
    const running = actor.state === "flee" || actor.state === "pursue" || actor.state === "flank";
    const strideAmount = Math.min(running ? 0.9 : 0.62, actor.speed * 0.14);
    const swing = Math.sin(actor.animationTime) * strideAmount;
    pivots.leftLeg.rotation.x = swing;
    pivots.rightLeg.rotation.x = -swing;
    pivots.leftArm.rotation.x = -swing * 0.72;
    pivots.rightArm.rotation.x = swing * 0.72;
    torso.rotation.z *= Math.exp(-delta * 9);
    torso.rotation.x *= Math.exp(-delta * 9);
    head.rotation.x *= Math.exp(-delta * 7);
    if (actor.state === "shoot") {
      pivots.leftArm.rotation.x = -1.08 + Math.sin(actor.animationTime * 2) * 0.025;
      pivots.rightArm.rotation.x = -1.24 + Math.sin(actor.animationTime * 2 + 0.4) * 0.035;
      torso.rotation.x = -0.08;
    } else if (actor.state === "flee") {
      pivots.leftArm.rotation.x = -0.55 - swing * 0.45;
      pivots.rightArm.rotation.x = -0.55 + swing * 0.45;
    } else if (actor.state === "hit" || actor.state === "stumble") {
      torso.rotation.z = actor.fallDirection * 0.16;
      pivots.leftArm.rotation.x = -0.7;
      pivots.rightArm.rotation.x = 0.5;
    } else if (actor.state === "reload") {
      const magazinePhase = Math.sin(actor.stateTime * 5.4);
      pivots.leftArm.rotation.x = -0.76 + magazinePhase * 0.08;
      pivots.rightArm.rotation.x = -0.54 - magazinePhase * 0.06;
      torso.rotation.x = 0.08;
      head.rotation.x = 0.18;
    } else if (actor.state === "social") {
      const gesture = Math.sin(actor.animationTime * 0.72 + actor.index) * 0.28;
      pivots.leftArm.rotation.x = -0.22 + gesture;
      pivots.rightArm.rotation.x = -0.18 - gesture * 0.7;
      torso.rotation.z = gesture * 0.06;
    } else if (actor.state === "witness") {
      const cowering = actor.witnessMode === "cower";
      pivots.leftArm.rotation.x = cowering ? -1.18 : -0.62;
      pivots.rightArm.rotation.x = cowering ? -1.08 : -0.42;
      torso.rotation.x = cowering ? 0.19 : 0.08;
      head.rotation.x = cowering ? 0.16 : -0.04;
    } else if (actor.state === "idle" || dwelling) {
      if (actor.idleMode === "phone") {
        pivots.rightArm.rotation.x = -1.08;
        pivots.leftArm.rotation.x = -0.16;
        head.rotation.x = 0.11;
      } else if (actor.idleMode === "stretch") {
        const stretch = 0.08 + Math.sin(actor.stateTime * 1.7) * 0.08;
        pivots.leftArm.rotation.x = -1.72 - stretch;
        pivots.rightArm.rotation.x = -1.72 + stretch;
        torso.rotation.x = -0.05;
      } else if (actor.idleMode === "hands") {
        pivots.leftArm.rotation.x = -0.3;
        pivots.rightArm.rotation.x = -0.3;
      } else if (actor.idleMode === "coffee") {
        pivots.rightArm.rotation.x = -1.02;
        pivots.leftArm.rotation.x = -0.18;
        head.rotation.x = 0.06;
      }
    }
    if (umbrellaVisible) {
      pivots.rightArm.rotation.x = -0.34;
      pivots.rightArm.rotation.z = props.umbrella.position.x < 0 ? -0.24 : 0.24;
      head.rotation.x = -0.025;
    } else pivots.rightArm.rotation.z *= Math.exp(-delta * 9);
    const headTurn = actor.state === "idle" || dwelling || actor.state === "search" || actor.state === "crosswalk_wait"
      ? Math.sin(elapsed * (actor.state === "crosswalk_wait" ? 2.1 : 0.75) + actor.index * 1.7) *
        (actor.state === "crosswalk_wait" ? 0.58 : 0.34)
      : 0;
    head.rotation.y += (headTurn - head.rotation.y) * (1 - Math.exp(-delta * 5));
  }

  function updateDetailLevel(actor, targetPosition) {
    let useDistant = false;
    if (targetPosition && !actor.storyLocked && actor.alive && !actor.ragdollActive) {
      const dx = actor.root.position.x - targetPosition.x;
      const dz = actor.root.position.z - targetPosition.z;
      const threshold = actor.detailLevel === "distant" ? 32 : 38;
      useDistant = dx * dx + dz * dz > threshold * threshold;
    }
    actor.detailLevel = useDistant ? "distant" : "full";
    actor.visual.visible = !useDistant;
    actor.distantVisual.visible = useDistant;
    const bodyRootY = actor.visual.userData.bodyRootOffsetY ?? FULL_RIG_BODY_ROOT_Y;
    actor.distantVisual.position.y = actor.visual.position.y - bodyRootY;
    actor.distantVisual.userData.umbrella.visible = useDistant && actor.carryingUmbrella;
  }

  function respawnPosition(actor) {
    let chosen = nodes[(actor.index * 13 + Math.floor(elapsed)) % nodes.length];
    if (!lastAlert) return chosen;
    for (let offset = 0; offset < nodes.length; ++offset) {
      const candidate = nodes[(actor.index * 13 + offset + Math.floor(elapsed)) % nodes.length];
      if (candidate.distanceToSquared(lastAlert.position) > 34 * 34) { chosen = candidate; break; }
    }
    return chosen;
  }

  function beginRagdoll(actor, directionX, directionZ, impactSpeed) {
    if (!actor || actor.storyProtected) return false;
    let dx = finite(directionX);
    let dz = finite(directionZ);
    if (dx * dx + dz * dz < 0.01) {
      const angle = actor.index * 2.399963 + elapsed * 0.17;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
    }
    const inverseLength = 1 / Math.max(0.001, Math.hypot(dx, dz));
    const energy = clamp(impactSpeed, 3, 18);
    actor.ragdollVelocity.set(
      dx * inverseLength * (1.2 + energy * 0.34),
      1.35 + energy * 0.18,
      dz * inverseLength * (1.2 + energy * 0.34),
    );
    actor.ragdollActive = true;
    actor.ragdollAge = 0;
    actor.ragdollHeight = 0.03;
    actor.ragdollBounces = 0;
    actor.ragdollImpact = energy;
    actor.ragdollAngularVelocity = actor.fallDirection * (1.5 + energy * 0.17);
    actor.ragdollPose = actor.index * 2.399963 + elapsed * 0.31;
    actor.velocity.set(0, 0, 0);
    actor.speed = 0;
    actor.visual.visible = true;
    actor.distantVisual.visible = false;
    actor.detailLevel = "full";
    setState(actor, "ragdoll");
    return true;
  }

  function updateRagdoll(actor, delta) {
    actor.ragdollAge += delta;
    if (!actor.alive) actor.respawn = Math.max(0, actor.respawn - delta);
    actor.ragdollVelocity.y -= 13.5 * delta;
    actor.ragdollDisplacement.set(
      actor.ragdollVelocity.x * delta,
      0,
      actor.ragdollVelocity.z * delta,
    );
    const beforeX = actor.root.position.x;
    const beforeZ = actor.root.position.z;
    const resolved = world.resolveCircleMotion?.(
      actor.root.position,
      actor.ragdollDisplacement,
      actor.radius * 0.72,
    );
    if (resolved?.isVector3) {
      actor.root.position.x = resolved.x;
      actor.root.position.z = resolved.z;
    } else {
      actor.root.position.x += actor.ragdollDisplacement.x;
      actor.root.position.z += actor.ragdollDisplacement.z;
    }
    if (Math.abs(actor.root.position.x - beforeX) < Math.abs(actor.ragdollDisplacement.x) * 0.2) {
      actor.ragdollVelocity.x *= -0.22;
    }
    if (Math.abs(actor.root.position.z - beforeZ) < Math.abs(actor.ragdollDisplacement.z) * 0.2) {
      actor.ragdollVelocity.z *= -0.22;
    }
    actor.ragdollHeight += actor.ragdollVelocity.y * delta;
    if (actor.ragdollHeight <= 0) {
      actor.ragdollHeight = 0;
      if (actor.ragdollVelocity.y < -3.2 && actor.ragdollBounces < 1) {
        actor.ragdollVelocity.y *= -0.22;
        actor.ragdollBounces += 1;
      } else actor.ragdollVelocity.y = 0;
      const friction = Math.exp(-delta * 6.5);
      actor.ragdollVelocity.x *= friction;
      actor.ragdollVelocity.z *= friction;
      actor.ragdollAngularVelocity *= Math.exp(-delta * 7);
    }
    actor.root.rotation.y += actor.ragdollAngularVelocity * delta;
    actor.root.position.y = groundHeight(actor.root.position.x, actor.root.position.z) + actor.ragdollHeight;
    updatePose(actor, delta);
    const planarSpeed = Math.hypot(actor.ragdollVelocity.x, actor.ragdollVelocity.z);
    const settled = actor.ragdollHeight <= 0 && planarSpeed < 0.34 && actor.ragdollAge > 0.72;
    if (!settled && actor.ragdollAge < 2.4) return;
    actor.ragdollActive = false;
    actor.ragdollVelocity.set(0, 0, 0);
    actor.root.position.y = groundHeight(actor.root.position.x, actor.root.position.z);
    if (actor.alive) {
      resetVisual(actor);
      actor.stateUntil = elapsed + 0.58;
      setState(actor, "hit");
    } else {
      actor.downUntil = Math.max(actor.downUntil, elapsed + 0.8);
      setState(actor, "down");
    }
  }

  function updateDeadActor(actor, delta, targetPosition) {
    actor.respawn -= delta;
    updatePose(actor, delta);
    if (elapsed >= actor.downUntil) actor.root.visible = false;
    if (actor.police && !actor.assigned && elapsed >= actor.downUntil) actor.active = false;
    if (actor.respawn > 0) return;
    if (actor.police) {
      if (!actor.assigned) return;
      const spawn = choosePoliceSpawn(targetPosition, actor);
      actor.homePosition.copy(spawn);
      resetActor(actor, spawn, "pursue");
      return;
    }
    const spawn = respawnPosition(actor);
    actor.nodeIndex = nearestNodeIndex(spawn);
    chooseNextNode(actor);
    resetActor(actor, spawn, "wander");
  }

  function update(delta, {
    targetPosition = null,
    wantedStars = 0,
    vehicles = null,
    playerVehicle = null,
    playerStatus = null,
    timeHours: timeValue = timeHours,
    rain: rainValue = rainAmount,
    daylight: daylightValue = daylightAmount,
    captureSnapshot = true,
  } = {}) {
    const dt = clamp(delta, 0, 0.1);
    if (disposed) return captureSnapshot ? snapshot() : null;
    elapsed += dt;
    timeHours = wrappedHour(timeValue);
    rainAmount = clamp(rainValue, 0, 1);
    daylightAmount = clamp(daylightValue, 0, 1);
    updateVehicleObservations(vehicles, playerVehicle);
    const target = positionVector(targetPosition);
    const stars = clamp(wantedStars, 0, 5);
    activatePolice(stars, target);
    for (const actor of actors) {
      if (actor.ragdollActive) {
        updateRagdoll(actor, dt);
        updateDetailLevel(actor, target);
        continue;
      }
      if (!actor.alive) {
        updateDeadActor(actor, dt, target);
        updateDetailLevel(actor, target);
        continue;
      }
      if (!actor.active) continue;
      if (actor.storyLocked) {
        // A resident routine lock freezes the actor exactly where the story
        // took control; ordinary stationary/story presentation keeps its
        // historical authored home anchor behaviour.
        if (!actor.routineDestinationActive) actor.root.position.copy(actor.homePosition);
        actor.root.position.y = groundHeight(actor.root.position.x, actor.root.position.z, actor.root.position.y);
        // A taxi passenger remains part of the public population while riding,
        // but its already-created root must stay explicitly hidden. Authored
        // story actors keep the historical always-visible locked behaviour.
        actor.root.visible = actor.presentationStaged ? actor.presentationVisible : true;
        actor.velocity.set(0, 0, 0);
        actor.speed = 0;
        setState(actor, "idle");
        updatePose(actor, dt);
        updateDetailLevel(actor, target);
        continue;
      }
      if (actor.police) updatePolice(actor, dt, target, stars, playerStatus);
      else updateCivilian(actor, dt, target, stars);
      updatePose(actor, dt);
      updateDetailLevel(actor, target);
    }
    return captureSnapshot ? snapshot() : null;
  }

  function alert(position, reason = "gunfire") {
    const value = positionVector(position, new THREE.Vector3());
    const label = String(reason ?? "alert");
    const radius = /explosion|vehicle/.test(label) ? 52 : /gunfire|shot/.test(label) ? 44 : 36;
    lastAlert = { position: value, reason: label, time: elapsed, radius, serial: ++alertSerial };
    return { position: value.toArray(), reason: label, time: elapsed };
  }

  function resolveActor(target) {
    if (typeof target === "string") return actors.find(entry => entry.id === target) ?? null;
    return target?.userData?.actor ?? target?.actor ?? target ?? null;
  }

  function ordinaryPresentationActor(actor) {
    return Boolean(actor && actors.includes(actor) && !actor.police && !actor.storyRole &&
      !actor.storyLocked && !actor.storyProtected && actor.active && actor.alive &&
      !actor.ragdollActive && !actor.socialPartner && !actor.managedRoutineOwner && !stagedOriginals.has(actor));
  }

  function calmPresentationActor(actor) {
    return ordinaryPresentationActor(actor) && actor.root.visible &&
      ROADSIDE_OBSERVER_STATE_SET.has(actor.state) &&
      actor.panicUntil <= elapsed && actor.witnessUntil <= elapsed && !actor.pendingAlert;
  }

  function selectPresentationActor(position = null, radius = Infinity) {
    const radiusSq = Number.isFinite(radius) ? Math.max(0, radius) ** 2 : Infinity;
    let selected = null;
    let selectedDistanceSq = Infinity;
    for (const actor of actors) {
      if (!calmPresentationActor(actor)) continue;
      const distanceSq = position ? actor.root.position.distanceToSquared(position) : 0;
      if (distanceSq > radiusSq) continue;
      if (distanceSq < selectedDistanceSq ||
          (distanceSq === selectedDistanceSq && actor.index < (selected?.index ?? Infinity))) {
        selected = actor;
        selectedDistanceSq = distanceSq;
      }
    }
    return selected;
  }

  function capturePresentationState(actor) {
    const props = actor.visual.userData.props ?? {};
    return {
      id: actor.id,
      displayName: actor.displayName,
      rootName: actor.root.name,
      routine: actor.routine,
      storyRole: actor.storyRole,
      storyLocked: actor.storyLocked,
      storyProtected: actor.storyProtected,
      active: actor.active,
      alive: actor.alive,
      rootVisible: actor.root.visible,
      positionX: actor.root.position.x,
      positionY: actor.root.position.y,
      positionZ: actor.root.position.z,
      homeX: actor.homePosition.x,
      homeY: actor.homePosition.y,
      homeZ: actor.homePosition.z,
      yaw: actor.root.rotation.y,
      state: actor.state,
      stateTime: actor.stateTime,
      stateUntil: actor.stateUntil,
      panicUntil: actor.panicUntil,
      idleUntil: actor.idleUntil,
      idleMode: actor.idleMode,
      witnessUntil: actor.witnessUntil,
      pendingAlert: actor.pendingAlert,
      returnUntil: actor.returnUntil,
      manualUntil: actor.manualUntil,
      memoryUntil: actor.memoryUntil,
      nodeIndex: actor.nodeIndex,
      previousNodeIndex: actor.previousNodeIndex,
      crossing: actor.crossing,
      crossingDestinationIndex: actor.crossingDestinationIndex,
      routineDestinationX: actor.routineDestination.x,
      routineDestinationY: actor.routineDestination.y,
      routineDestinationZ: actor.routineDestination.z,
      routineDestinationActive: actor.routineDestinationActive,
      routineDestinationArrived: actor.routineDestinationArrived,
      routineDestinationNodeIndex: actor.routineDestinationNodeIndex,
      routineRoute: actor.routineRoute.slice(0, actor.routineRouteLength),
      routineRouteLength: actor.routineRouteLength,
      routineRouteCursor: actor.routineRouteCursor,
      routineRouteRepairPending: actor.routineRouteRepairPending,
      routineCrossingWaypoint: actor.routineCrossingWaypoint,
      routineArrivalRadius: actor.routineArrivalRadius,
      routineTravelSpeedScale: actor.routineTravelSpeedScale,
      routineLocation: actor.routineLocation,
      routineActivity: actor.routineActivity,
      speed: actor.speed,
      velocityX: actor.velocity.x,
      velocityY: actor.velocity.y,
      velocityZ: actor.velocity.z,
      steeringX: actor.steering.x,
      steeringY: actor.steering.y,
      steeringZ: actor.steering.z,
      carryingUmbrella: actor.carryingUmbrella,
      detailLevel: actor.detailLevel,
      visualVisible: actor.visual.visible,
      distantVisible: actor.distantVisual.visible,
      phoneVisible: Boolean(props.phone?.visible),
      coffeeVisible: Boolean(props.coffee?.visible),
      umbrellaVisible: Boolean(props.umbrella?.visible),
      distantUmbrellaVisible: Boolean(actor.distantVisual.userData.umbrella?.visible),
    };
  }

  function presentationResult(actor, accepted, reason = null, extra = null) {
    const position = actor ? Object.freeze(actor.root.position.toArray()) : null;
    return Object.freeze({
      accepted: Boolean(accepted),
      reason,
      actorId: actor?.id ?? null,
      displayName: actor?.displayName ?? null,
      presentationKind: actor?.presentationKind ?? null,
      presentationKey: actor?.presentationKey ?? null,
      phase: actor?.presentationPhase ?? null,
      visible: actor ? Boolean(actor.root.visible) : false,
      position,
      observationIncidentId: actor?.observationIncidentId ?? extra?.observationIncidentId ?? null,
      observationKind: actor?.observationKind ?? extra?.observationKind ?? null,
    });
  }

  /**
   * Borrow an existing ordinary civilian for authored live presentation.
   * Passing null as target selects the nearest calm civilian to request.position
   * (request.radius is optional). Repeating stage for the same actor and key
   * updates visibility/position without replacing its saved ambient state.
   */
  function stage(target, request = {}) {
    const requestedPosition = positionVector(request.position ?? request);
    const radiusValue = Number(request.radius);
    const selectionRadius = Number.isFinite(radiusValue) ? Math.max(0, radiusValue) : Infinity;
    let actor = resolveActor(target);
    if (!actor && (target === null || target === undefined)) {
      actor = selectPresentationActor(requestedPosition, selectionRadius);
    }
    if (!actor) return presentationResult(null, false, "no_actor_available");

    const original = stagedOriginals.get(actor);
    if (!original) {
      if (actor.managedRoutineOwner) return presentationResult(actor, false, "actor_managed");
      if (actor.police || actor.storyRole || actor.storyLocked || actor.storyProtected) {
        return presentationResult(actor, false, "actor_reserved");
      }
      if (!actor.active || !actor.alive || actor.ragdollActive || actor.socialPartner) {
        return presentationResult(actor, false, "actor_busy");
      }
      stagedOriginals.set(actor, capturePresentationState(actor));
      stageClaims += 1;
    } else {
      const requestedKey = request.key === undefined || request.key === null ? null : String(request.key);
      if (requestedKey && actor.presentationKey && requestedKey !== actor.presentationKey) {
        return presentationResult(actor, false, "claim_key_mismatch");
      }
      stageUpdates += 1;
    }

    const position = requestedPosition ?? (original ? null : actor.root.position);
    if (position) {
      actor.homePosition.copy(position);
      actor.homePosition.y = groundHeight(position.x, position.z, position.y);
      actor.root.position.copy(actor.homePosition);
    }
    if (request.name !== undefined && request.name !== null) {
      actor.displayName = String(request.name);
      actor.root.name = actor.displayName;
    }
    if (request.kind !== undefined && request.kind !== null) actor.presentationKind = String(request.kind);
    else if (!actor.presentationKind) actor.presentationKind = "staged-civilian";
    if (request.key !== undefined && request.key !== null) actor.presentationKey = String(request.key);
    if (request.phase !== undefined && request.phase !== null) actor.presentationPhase = String(request.phase);
    if (Number.isFinite(Number(request.yaw))) actor.root.rotation.y = Number(request.yaw);

    actor.presentationStaged = true;
    actor.presentationVisible = request.visible === undefined
      ? (original ? actor.presentationVisible : true)
      : Boolean(request.visible);
    actor.storyLocked = request.locked !== false;
    actor.storyProtected = request.protected !== false;
    actor.active = true;
    actor.root.visible = actor.presentationVisible;
    actor.velocity.set(0, 0, 0);
    actor.steering.set(0, 0, 0);
    actor.speed = 0;
    actor.crossing = null;
    actor.crossingDestinationIndex = -1;
    actor.panicUntil = 0;
    actor.witnessUntil = 0;
    actor.pendingAlert = null;
    actor.idleMode = request.idleMode === undefined
      ? (original ? actor.idleMode : "hands")
      : String(request.idleMode);
    setState(actor, "idle");
    return presentationResult(actor, true);
  }

  function release(target) {
    const actor = resolveActor(target);
    const original = actor ? stagedOriginals.get(actor) : null;
    if (!actor || !original) return presentationResult(actor, false, "not_staged");
    const incidentId = actor.observationIncidentId;
    const observationKind = actor.observationKind;
    if (incidentId && observationByIncident.get(incidentId) === actor) observationByIncident.delete(incidentId);

    actor.id = original.id;
    actor.displayName = original.displayName;
    actor.root.name = original.rootName;
    actor.routine = original.routine;
    actor.storyRole = original.storyRole;
    actor.storyLocked = original.storyLocked;
    actor.storyProtected = original.storyProtected;
    actor.active = original.active;
    actor.alive = original.alive;
    actor.root.position.set(original.positionX, original.positionY, original.positionZ);
    actor.homePosition.set(original.homeX, original.homeY, original.homeZ);
    actor.root.rotation.y = original.yaw;
    actor.root.visible = original.rootVisible;
    actor.state = original.state;
    actor.stateTime = original.stateTime;
    actor.stateUntil = original.stateUntil;
    actor.panicUntil = original.panicUntil;
    actor.idleUntil = original.idleUntil;
    actor.idleMode = original.idleMode;
    actor.witnessUntil = original.witnessUntil;
    actor.pendingAlert = original.pendingAlert;
    actor.returnUntil = original.returnUntil;
    actor.manualUntil = original.manualUntil;
    actor.memoryUntil = original.memoryUntil;
    actor.nodeIndex = original.nodeIndex;
    actor.previousNodeIndex = original.previousNodeIndex;
    actor.crossing = original.crossing;
    actor.crossingDestinationIndex = original.crossingDestinationIndex;
    actor.routineDestination.set(
      original.routineDestinationX,
      original.routineDestinationY,
      original.routineDestinationZ,
    );
    actor.routineDestinationActive = original.routineDestinationActive;
    actor.routineDestinationArrived = original.routineDestinationArrived;
    actor.routineDestinationNodeIndex = original.routineDestinationNodeIndex;
    actor.routineRoute.fill(0);
    actor.routineRoute.set(original.routineRoute);
    actor.routineRouteLength = original.routineRouteLength;
    actor.routineRouteCursor = original.routineRouteCursor;
    actor.routineRouteRepairPending = original.routineRouteRepairPending;
    actor.routineCrossingWaypoint = original.routineCrossingWaypoint;
    actor.routineArrivalRadius = original.routineArrivalRadius;
    actor.routineTravelSpeedScale = original.routineTravelSpeedScale;
    actor.routineLocation = original.routineLocation;
    actor.routineActivity = original.routineActivity;
    actor.speed = original.speed;
    actor.velocity.set(original.velocityX, original.velocityY, original.velocityZ);
    actor.steering.set(original.steeringX, original.steeringY, original.steeringZ);
    actor.carryingUmbrella = original.carryingUmbrella;
    actor.detailLevel = original.detailLevel;
    actor.visual.visible = original.visualVisible;
    actor.distantVisual.visible = original.distantVisible;
    const props = actor.visual.userData.props ?? {};
    if (props.phone) props.phone.visible = original.phoneVisible;
    if (props.coffee) props.coffee.visible = original.coffeeVisible;
    if (props.umbrella) props.umbrella.visible = original.umbrellaVisible;
    if (actor.distantVisual.userData.umbrella) {
      actor.distantVisual.userData.umbrella.visible = original.distantUmbrellaVisible;
    }
    actor.presentationStaged = false;
    actor.presentationVisible = true;
    actor.presentationKind = null;
    actor.presentationKey = null;
    actor.presentationPhase = null;
    actor.observationIncidentId = null;
    actor.observationKind = null;
    stagedOriginals.delete(actor);
    stageReleases += 1;
    return presentationResult(actor, true, null, {
      observationIncidentId: incidentId,
      observationKind,
    });
  }

  /** Calmly stage one nearby civilian as a phone-watching roadside witness. */
  function observe(action, incidentId, kind = "roadside", x = 0, z = 0) {
    const command = String(action ?? "start").trim().toLowerCase();
    const incident = String(incidentId ?? "").trim();
    if (!incident) return null;
    if (command === "clear" || command === "release" || command === "stop") {
      const actor = observationByIncident.get(incident) ?? null;
      if (!actor) return null;
      const actorId = actor.id;
      return release(actor).accepted ? actorId : null;
    }
    if (command !== "begin" && command !== "start" && command !== "watch" && command !== "set") return null;
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) return null;

    const incidentPosition = tempCenter.set(finite(x), groundHeight(finite(x), finite(z)), finite(z));
    let actor = observationByIncident.get(incident) ?? null;
    if (!actor) actor = selectPresentationActor(incidentPosition, ROADSIDE_OBSERVER_RADIUS);
    if (!actor) return null;
    const dx = incidentPosition.x - actor.root.position.x;
    const dz = incidentPosition.z - actor.root.position.z;
    const yaw = dx * dx + dz * dz > 1e-8 ? Math.atan2(-dx, -dz) : actor.root.rotation.y;
    const result = stage(actor, {
      key: `roadside:${incident}`,
      kind: "roadside-observer",
      phase: "phone-watch",
      idleMode: "phone",
      visible: true,
      protected: true,
      locked: true,
      yaw,
    });
    if (!result.accepted) return null;
    actor.observationIncidentId = incident;
    actor.observationKind = String(kind ?? "roadside");
    observationByIncident.set(incident, actor);
    return actor.id;
  }

  function damage(target, amount, source = "player") {
    const actor = resolveActor(target);
    if (!actor?.alive || !actor.active) return { accepted: false };
    if (actor.storyProtected) return {
      accepted: false,
      protected: true,
      id: actor.id,
      health: actor.health,
      alive: actor.alive,
      police: actor.police,
    };
    const applied = Math.max(0, finite(amount));
    actor.health = Math.max(0, actor.health - applied);
    actor.threatPosition.copy(actor.root.position);
    actor.panicUntil = Math.max(actor.panicUntil, elapsed + 4.5 + random() * 2);
    actor.stateUntil = elapsed + 0.24;
    actor.fallDirection = (actor.index + Math.floor(elapsed * 10)) % 2 ? -1 : 1;
    setState(actor, "hit");
    alert(actor.root.position, "assault");
    if (source === "player") {
      crimesWitnessed += 1;
      invoke(onCrime, { type: actor.police ? "assault_police" : "assault_civilian", heat: actor.police ? 42 : 26, target: actor });
    }
    if (actor.health <= 0) {
      actor.alive = false;
      actor.velocity.set(0, 0, 0);
      actor.speed = 0;
      actor.downUntil = elapsed + 2.4;
      actor.respawn = actor.police ? 20 : 14;
      actor.root.visible = true;
      setState(actor, "down");
    }
    if (actor.health <= 0 || applied >= 55) {
      const phase = actor.index * 2.399963 + elapsed * 0.41;
      beginRagdoll(actor, Math.cos(phase), Math.sin(phase), clamp(applied * 0.12, 4.5, 12));
    }
    return {
      accepted: true,
      id: actor.id,
      damage: applied,
      health: actor.health,
      alive: actor.alive,
      police: actor.police,
      ragdoll: actor.ragdollActive,
      position: actor.root.position.toArray(),
    };
  }

  function raycast(origin, direction, maxDistance = 120) {
    const rayOrigin = positionVector(origin);
    const rayDirection = positionVector(direction);
    if (!rayOrigin || !rayDirection || rayDirection.lengthSq() < 1e-9) return null;
    rayDirection.normalize();
    let hit = null;
    let distance = Math.max(0, finite(maxDistance, 120));
    for (const actor of actors) {
      if (!actor.active || !actor.alive || !actor.root.visible) continue;
      tempCenter.copy(actor.root.position).setY(actor.root.position.y + 1.1);
      const candidate = raySphere(rayOrigin, rayDirection, tempCenter, 0.58, distance);
      if (candidate === null) continue;
      distance = candidate;
      hit = { actor, distance, point: rayOrigin.clone().addScaledVector(rayDirection, candidate) };
    }
    return hit;
  }

  function hitByVehicle(position, radius, speed, playerDriven = false, bodyBounds = null) {
    const impactSpeed = Math.abs(finite(speed));
    if (impactSpeed < 2.5) return EMPTY_VEHICLE_IMPACTS;
    const center = positionVector(position);
    if (!center) return EMPTY_VEHICLE_IMPACTS;
    let results = null;
    const vehicleRadius = Math.max(0, finite(radius));
    for (const actor of actors) {
      if (!actor.active || !actor.alive || !actor.root.visible || actor.ragdollActive) continue;
      const dx = actor.root.position.x - center.x;
      const dz = actor.root.position.z - center.z;
      if (bodyBounds && Number.isFinite(bodyBounds.width) && Number.isFinite(bodyBounds.length)) {
        const yaw = finite(bodyBounds.yaw);
        const cosine = Math.cos(yaw);
        const sine = Math.sin(yaw);
        const localX = dx * cosine - dz * sine;
        const localZ = dx * sine + dz * cosine;
        if (Math.abs(localX) > bodyBounds.width * 0.5 + actor.radius + 0.12 ||
            Math.abs(localZ) > bodyBounds.length * 0.5 + actor.radius + 0.12) continue;
      } else if (dx * dx + dz * dz > (vehicleRadius + actor.radius + 0.18) ** 2) continue;
      const result = damage(actor, Math.min(120, Math.max(8, (impactSpeed - 1.5) * 7.5)), playerDriven ? "player" : "traffic");
      if (result.accepted && impactSpeed >= 4) {
        beginRagdoll(actor, dx, dz, impactSpeed);
        result.ragdoll = true;
        result.impactSpeed = impactSpeed;
        result.position = actor.root.position.toArray();
      } else if (result.accepted && actor.alive) {
        actor.knockback.set(dx, 0, dz);
        if (actor.knockback.lengthSq() < 0.01) {
          const angle = actor.index * 2.399963;
          actor.knockback.set(Math.cos(angle), 0, Math.sin(angle));
        }
        actor.knockback.normalize().multiplyScalar(Math.min(5.5, impactSpeed * 0.34));
        actor.stateUntil = elapsed + 0.5;
        setState(actor, "stumble");
      }
      (results ??= []).push(result);
    }
    return results ?? EMPTY_VEHICLE_IMPACTS;
  }

  function spawnReserveSnapshot() {
    return Object.freeze({
      ready: spawnReserveReady,
      storage: "memory-only",
      prepared: spawnReservePrepared,
      available: spawnReserve.length,
      claimed: spawnReserveClaims,
      runtimeActorAllocations,
    });
  }

  function ensureSpawnReserve(count = 2) {
    spawnReserveReady = true;
    if (disposed) return spawnReserveSnapshot();
    const desired = Math.max(0, Math.min(8, Math.trunc(finite(count, 2))));
    while (spawnReserve.length < desired) {
      const civilianIndex = actors.reduce((total, actor) => total + Number(!actor.police), 0) + spawnReserve.length;
      const actor = makeActor(civilianIndex, false, false);
      actor.active = false;
      actor.assigned = false;
      actor.spawnReserved = true;
      actor.root.visible = false;
      actor.root.userData.spawnReserve = true;
      setState(actor, "reserve");
      spawnReserve.push(actor);
      spawnReservePrepared += 1;
    }
    return spawnReserveSnapshot();
  }

  function spawn({ police = false, x = 0, z = 0, id = null, name = null, role = null, stationary = false, protected: protectedActor = false, yaw = null } = {}) {
    const policeOfficer = Boolean(police);
    let actor = actors.find(entry => entry.police === policeOfficer && (!entry.active || !entry.alive));
    if (!actor && !policeOfficer && spawnReserve.length > 0) {
      actor = spawnReserve.shift();
      actor.spawnReserved = false;
      actor.root.userData.spawnReserve = false;
      actors.push(actor);
      spawnReserveClaims += 1;
    }
    if (!actor) {
      actor = makeActor(actors.filter(entry => entry.police === policeOfficer).length, policeOfficer);
      if (spawnReserveReady) runtimeActorAllocations += 1;
    }
    const px = finite(x);
    const pz = finite(z);
    const position = new THREE.Vector3(px, groundHeight(px, pz), pz);
    actor.nodeIndex = nearestNodeIndex(position);
    chooseNextNode(actor);
    actor.assigned = policeOfficer;
    actor.manualUntil = policeOfficer ? elapsed + 5 : 0;
    actor.homePosition.copy(position);
    resetActor(actor, position, policeOfficer ? "pursue" : "wander");
    if (id) actor.id = String(id);
    if (name) {
      actor.displayName = String(name);
      actor.root.name = actor.displayName;
    }
    actor.storyRole = role ? String(role) : null;
    actor.storyLocked = Boolean(stationary);
    actor.storyProtected = Boolean(protectedActor);
    if (actor.storyLocked) actor.idleMode = actor.storyRole?.includes("analyst") ? "phone" : "hands";
    decorateStoryActor(actor);
    if (Number.isFinite(Number(yaw))) actor.root.rotation.y = Number(yaw);
    return actor;
  }

  function pin(target, request = {}) {
    const actor = resolveActor(target);
    if (!actor) return null;
    const position = positionVector(request.position ?? request, actor.root.position);
    if (position) {
      actor.homePosition.copy(position);
      actor.root.position.copy(position);
      actor.root.position.y = groundHeight(position.x, position.z, position.y);
    }
    actor.storyLocked = request.locked !== false;
    actor.storyProtected = request.protected !== false;
    actor.storyRole = request.role ? String(request.role) : actor.storyRole;
    decorateStoryActor(actor);
    if (request.name) {
      actor.displayName = String(request.name);
      actor.root.name = actor.displayName;
    }
    if (Number.isFinite(Number(request.yaw))) actor.root.rotation.y = Number(request.yaw);
    actor.active = true;
    actor.alive = true;
    actor.root.visible = true;
    return actor;
  }

  function snapshot() {
    return actors.map(actor => {
      const schedule = actor.police ? "public-safety" : scheduleFor(actor);
      const transitAnchor = actor.police ? null : transitAnchorFor(actor, schedule);
      return Object.freeze({
        id: actor.id,
        kind: actor.kind,
        displayName: actor.displayName,
        storyRole: actor.storyRole,
        storyLocked: actor.storyLocked,
        storyProtected: actor.storyProtected,
        police: actor.police,
        position: Object.freeze(actor.root.position.toArray()),
        yaw: finite(actor.root.rotation.y),
        health: finite(actor.health),
        maxHealth: actor.maxHealth,
        alive: actor.alive,
        active: actor.active,
        state: actor.state,
        idleMode: actor.idleMode,
        staged: actor.presentationStaged,
        presentationVisible: actor.presentationStaged ? actor.presentationVisible : null,
        presentationKind: actor.presentationKind,
        presentationKey: actor.presentationKey,
        presentationPhase: actor.presentationPhase,
        observationIncidentId: actor.observationIncidentId,
        observationKind: actor.observationKind,
        roadsideObserverEligible: calmPresentationActor(actor),
        ragdoll: actor.ragdollActive,
        ragdollSpeed: actor.ragdollActive ? actor.ragdollVelocity.length() : 0,
        speed: finite(actor.speed),
        routine: actor.routine,
        schedule,
        destination: actor.routineDestinationActive
          ? Object.freeze(actor.routineDestination.toArray())
          : null,
        location: actor.routineLocation,
        locationId: actor.routineLocation,
        activity: actor.routineActivity,
        speedScale: actor.routineTravelSpeedScale,
        arrived: Boolean(actor.routineDestinationActive && actor.routineDestinationArrived),
        routeRepairPending: Boolean(actor.routineRouteRepairPending),
        managedRoutineOwner: actor.managedRoutineOwner,
        managedRoutineRequestPending: Boolean(actor.managedRoutineRequestPending),
        managedRoutineRequestKey: actor.managedRoutineRequestKey,
        managedRoutineRequestStatus: actor.managedRoutineRequestStatus,
        managedRoutineLastRequestReason: actor.managedRoutineLastRequestReason,
        managedRoutineDwelling: Boolean(actor.managedRoutineDwelling),
        transitPhase: actor.police ? null : transitPhaseFor(actor, schedule),
        transitAnchor: transitAnchorSnapshot(transitAnchor),
        transitCovered: transitAnchorIsCovered(transitAnchor),
        transitWaiting: actor.state === "transit_wait",
        accessory: actor.accessory,
        carryingUmbrella: Boolean(actor.carryingUmbrella),
        detailLevel: actor.detailLevel,
        roundsInMagazine: actor.police ? actor.roundsInMagazine : null,
        reloading: actor.police && actor.reloadUntil > elapsed,
        reloadCount: actor.police ? actor.reloadCount : 0,
      });
    });
  }

  function presentationSnapshot() {
    const entries = [];
    let hiddenCount = 0;
    for (const actor of actors) {
      if (!actor.presentationStaged) continue;
      hiddenCount += Number(!actor.presentationVisible);
      entries.push(Object.freeze({
        actorId: actor.id,
        displayName: actor.displayName,
        kind: actor.presentationKind,
        key: actor.presentationKey,
        phase: actor.presentationPhase,
        visible: actor.presentationVisible,
        observationIncidentId: actor.observationIncidentId,
        observationKind: actor.observationKind,
        position: Object.freeze(actor.root.position.toArray()),
      }));
    }
    return Object.freeze({
      publicActorCount: actors.length,
      stagedCount: entries.length,
      hiddenCount,
      observationCount: observationByIncident.size,
      stageClaims,
      stageUpdates,
      stageReleases,
      runtimeNodeAllocations: 0,
      entries: Object.freeze(entries),
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stagedOriginals.clear();
    observationByIncident.clear();
    root.removeFromParent();
    for (const geometry of Object.values(resources.geometries)) geometry.dispose();
    for (const material of [
      ...resources.skin, ...resources.clothing, ...resources.umbrella,
      resources.police, resources.policeAccent, resources.dark, resources.phoneScreen, resources.cup,
    ]) material.dispose();
    root.clear();
  }

  return {
    actors,
    update,
    alert,
    damage,
    raycast,
    hitByVehicle,
    ensureSpawnReserve,
    spawnReserveSnapshot,
    spawn,
    pin,
    setRoutineDestination,
    clearRoutineDestination,
    leaseManagedRoutineActor,
    queueManagedRoutineDestination,
    setManagedRoutineDwell,
    restoreManagedRoutineActor,
    releaseManagedRoutineActor,
    flushRoutineRouteSearches,
    flushRoutineRouteRepairs,
    stage,
    release,
    observe,
    snapshot,
    presentationSnapshot,
    dispose,
    get crimesWitnessed() { return crimesWitnessed; },
    get navigationNodes() { return nodes.length; },
    get navigationLinks() { return navigationLinkCount; },
    get routineRouteSearches() { return routineRouteSearches; },
    get pendingRoutineRouteRepairs() {
      let pending = 0;
      for (const actor of actors) pending += Number(actor.routineRouteRepairPending);
      return pending;
    },
    get pendingRoutineRouteRequests() {
      let pending = 0;
      for (const actor of actors) pending += Number(actor.managedRoutineRequestPending);
      return pending;
    },
    get pendingRoutineRouteSearches() {
      let pending = 0;
      for (const actor of actors) {
        pending += Number(actor.managedRoutineRequestPending || actor.routineRouteRepairPending);
      }
      return pending;
    },
    get pulseTransit() { return root.userData.pulseTransit; },
  };
}
