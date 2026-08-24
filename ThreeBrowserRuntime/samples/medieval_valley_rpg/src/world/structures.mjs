import * as THREE from "three/webgpu";
import { createCorruptionMaterial } from "../graphics/materials.mjs";
import { createWindBanner } from "../graphics/vegetation.mjs";
import { riverCenterZ, terrainHeight, trailCenterX } from "./terrain.mjs";
import { riverSurfaceHeight, riverWidth } from "../graphics/water.mjs";

function vectorAt(x, z, yOffset = 0) {
  return new THREE.Vector3(x, terrainHeight(x, z) + yOffset, z);
}

function meshFromUnit(geometry, material, name, position, scale, rotationY = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.scale.copy(scale);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createGableGeometry() {
  const positions = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5,
    -0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0.5, 0, 0.5, 0.5, 0,
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0.5, 0,
    -0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0.5, 0,
  ];
  const indices = [
    0, 2, 1, 1, 2, 3,
    4, 5, 6, 5, 7, 6,
    8, 9, 10,
    11, 12, 13,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWedgeGeometry() {
  const geometry = new THREE.ConeGeometry(1, 1, 4);
  geometry.rotateY(Math.PI * 0.25);
  return geometry;
}

function composeMatrix(transform, target = new THREE.Matrix4()) {
  const position = new THREE.Vector3(...transform.position);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    transform.rotation?.[0] ?? 0,
    transform.rotation?.[1] ?? 0,
    transform.rotation?.[2] ?? 0,
  ));
  const scale = new THREE.Vector3(...(transform.scale ?? [1, 1, 1]));
  return target.compose(position, quaternion, scale);
}

function createInstancedBoxes(name, transforms, geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < transforms.length; ++index) {
    mesh.setMatrixAt(index, composeMatrix(transforms[index], matrix));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rotatedExtents(width, depth, rotation) {
  const c = Math.abs(Math.cos(rotation));
  const s = Math.abs(Math.sin(rotation));
  return [width * c + depth * s, depth * c + width * s];
}

/**
 * Builds every permanent landmark from shared primitive geometry. Dynamic
 * effects (water, trees, weather and fire) are supplied by graphics modules.
 */
export function createWorldStructures(materials, services = {}) {
  const group = new THREE.Group();
  group.name = "Valley architecture and landmarks";
  group.userData.worldStatic = true;
  const landmarks = Object.create(null);
  const blockers = [];
  const walkableSurfaces = [];
  const interactables = [];
  const fireDefinitions = [];
  const disposables = [];
  const ownedMaterials = [];
  const corruptionMaterial = createCorruptionMaterial();
  ownedMaterials.push(corruptionMaterial);
  const shared = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    sphere: new THREE.SphereGeometry(0.5, 12, 8),
    roof: createGableGeometry(),
    wedge: createWedgeGeometry(),
    rock: new THREE.DodecahedronGeometry(1, 0),
  };

  function addLandmark(id, object, x, z, options = {}) {
    const position = vectorAt(x, z, options.yOffset ?? 0);
    const record = {
      id,
      name: options.name ?? id.replaceAll("_", " "),
      kind: options.kind ?? "landmark",
      zone: options.zone ?? "valley",
      position: [position.x, position.y, position.z],
      radius: options.radius ?? 5,
      object,
      tags: [...(options.tags ?? [])],
    };
    landmarks[id] = record;
    object.userData.landmarkId = id;
    object.userData.zone = record.zone;
    services.registerLandmark?.(record);
    return record;
  }

  function addBlocker(id, x, z, width, depth, height, options = {}) {
    const [extentX, extentZ] = rotatedExtents(width * 0.5, depth * 0.5, options.rotation ?? 0);
    const ground = Number.isFinite(options.baseY) ? options.baseY : terrainHeight(x, z);
    const blocker = {
      id,
      shape: "aabb",
      center: [x, ground + height * 0.5, z],
      halfExtents: [extentX, height * 0.5, extentZ],
      active: options.active !== false,
      tags: [...(options.tags ?? ["structure"])],
      object: options.object ?? null,
    };
    blockers.push(blocker);
    return blocker;
  }

  function addInteractable(id, kind, x, z, options = {}) {
    const interactable = {
      id,
      kind,
      position: [x, Number.isFinite(options.worldY) ? options.worldY : terrainHeight(x, z) + (options.yOffset ?? 1.2), z],
      radius: options.radius ?? 3.2,
      prompt: options.prompt ?? `Use ${id.replaceAll("_", " ")}`,
      landmarkId: options.landmarkId ?? id,
      tags: [...(options.tags ?? [])],
      metadata: { ...(options.metadata ?? {}) },
      enabled: options.enabled !== false,
    };
    interactables.push(interactable);
    services.registerInteractable?.(interactable);
    return interactable;
  }

  function addFire(id, x, z, options = {}) {
    const kind = options.kind ?? "fire";
    const type = options.type ?? (
      ["beacon", "brazier", "campfire", "fireplace", "torch", "candle"].includes(kind)
        ? kind
        : id.includes("campfire")
          ? "campfire"
          : id.includes("votive")
            ? "candle"
            : "torch"
    );
    const definition = {
      id,
      kind,
      type,
      position: [x, Number.isFinite(options.worldY) ? options.worldY : terrainHeight(x, z) + (options.yOffset ?? 0.25), z],
      protectedFromRain: Boolean(options.protectedFromRain),
      exposed: !options.protectedFromRain,
      rainResistance: options.rainResistance ?? (options.protectedFromRain ? 1 : 0),
      lit: options.lit !== false,
      light: options.light !== false,
      castShadow: Boolean(options.castShadow),
      intensity: options.intensity ?? 7.5,
      radius: options.radius ?? 17,
      color: options.color ?? 0xff8b38,
      seed: options.seed,
    };
    fireDefinitions.push(definition);
    return definition;
  }

  function addWindow(parent, localX, localY, localZ, width, height, rotationY = 0) {
    const windowMesh = meshFromUnit(
      shared.box,
      materials.window,
      "Warm leaded window",
      new THREE.Vector3(localX, localY, localZ),
      new THREE.Vector3(width, height, 0.12),
      rotationY,
    );
    windowMesh.castShadow = false;
    parent.add(windowMesh);
  }

  function addTimberFrame(parent, width, height, depth) {
    const beam = 0.34;
    for (const x of [-width * 0.42, width * 0.42]) {
      for (const z of [-depth * 0.505, depth * 0.505]) {
        parent.add(meshFromUnit(shared.box, materials.wood, "Oak frame post", new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(beam, height, beam)));
      }
    }
    for (const y of [0.6, height - 0.45]) {
      for (const z of [-depth * 0.51, depth * 0.51]) {
        parent.add(meshFromUnit(shared.box, materials.wood, "Oak cross beam", new THREE.Vector3(0, y, z), new THREE.Vector3(width * 0.9, beam, beam)));
      }
    }
  }

  function createBuilding(spec) {
    const {
      id,
      x,
      z,
      width,
      depth,
      height = 6.5,
      rotation = 0,
      material = materials.plaster,
      roofMaterial = materials.thatch,
      roofHeight = 3.5,
      timberFrame = true,
    } = spec;
    const building = new THREE.Group();
    building.name = spec.name ?? id.replaceAll("_", " ");
    building.position.set(x, terrainHeight(x, z), z);
    building.rotation.y = rotation;
    const body = meshFromUnit(shared.box, material, `${building.name} walls`, new THREE.Vector3(0, height * 0.5, 0), new THREE.Vector3(width, height, depth));
    building.add(body);
    if (timberFrame) addTimberFrame(building, width, height, depth);
    const roof = meshFromUnit(
      shared.roof,
      roofMaterial,
      `${building.name} roof`,
      new THREE.Vector3(0, height, 0),
      new THREE.Vector3(width + 1.7, roofHeight * 2, depth + 1.7),
    );
    building.add(roof);
    const door = meshFromUnit(shared.box, materials.wood, `${building.name} door`, new THREE.Vector3(0, 1.35, depth * 0.505), new THREE.Vector3(1.65, 2.7, 0.18));
    building.add(door);
    addWindow(building, -width * 0.27, height * 0.52, depth * 0.515, 1.2, 1.45);
    addWindow(building, width * 0.27, height * 0.52, depth * 0.515, 1.2, 1.45);
    group.add(building);
    addLandmark(id, building, x, z, {
      name: spec.name,
      kind: spec.kind ?? "building",
      zone: spec.zone ?? "village",
      radius: Math.max(width, depth) * 0.65,
      tags: spec.tags,
    });
    addBlocker(`${id}_walls`, x, z, width, depth, height, { rotation, object: building, tags: ["building", id] });
    if (spec.interactive !== false) {
      const forwardX = Math.sin(rotation) * depth * 0.62;
      const forwardZ = Math.cos(rotation) * depth * 0.62;
      addInteractable(id, spec.interactionKind ?? "door", x + forwardX, z + forwardZ, {
        landmarkId: id,
        prompt: spec.prompt ?? `Enter ${spec.name ?? id.replaceAll("_", " ")}`,
        tags: spec.interactionTags,
      });
    }
    return building;
  }

  // --- Village core -------------------------------------------------------
  const blacksmith = createBuilding({
    id: "blacksmith",
    name: "Rowan's Blacksmith",
    x: -28,
    z: 17,
    width: 17,
    depth: 13,
    height: 6.2,
    rotation: 0.08,
    material: materials.stone,
    interactionKind: "crafting",
    prompt: "Use the blacksmith forge",
    interactionTags: ["crafting", "repair"],
  });
  const chimney = meshFromUnit(shared.box, materials.stone, "Blacksmith chimney", new THREE.Vector3(-4.8, 8.1, -1.7), new THREE.Vector3(2, 7, 2));
  blacksmith.add(chimney);
  const forge = meshFromUnit(shared.box, materials.stone, "Working forge hearth", new THREE.Vector3(4.2, 1.05, 4.7), new THREE.Vector3(3, 2.1, 2.1));
  blacksmith.add(forge);
  addFire("forge_hearth", -23.3, 21.7, { kind: "fireplace", protectedFromRain: true, intensity: 9, radius: 20, yOffset: 1.25 });

  createBuilding({
    id: "inn",
    name: "The Stag and Lantern Inn",
    x: 25,
    z: 15,
    width: 23,
    depth: 16,
    height: 10.4,
    roofHeight: 4.3,
    rotation: -0.06,
    interactionKind: "inn",
    prompt: "Enter the Stag and Lantern",
    interactionTags: ["rest", "trade", "rumours"],
  });
  addFire("inn_fireplace", 25, 15, { kind: "fireplace", protectedFromRain: true, light: false, yOffset: 1.3 });

  const houseSpecs = [
    ["weavers_house", -51, -8, 13, 10, 0.19],
    ["herbalists_house", -23, -18, 12, 10, -0.12],
    ["bakers_house", 12, -21, 14, 10, 0.07],
    ["reeves_house", 57, 19, 15, 11, -0.18],
    ["riverside_house", 54, 46, 12, 9, 0.16],
  ];
  for (const [id, x, z, width, depth, rotation] of houseSpecs) {
    createBuilding({ id, x, z, width, depth, height: 6.7, rotation, interactionKind: "home", prompt: "Knock on the door" });
  }

  const chapel = createBuilding({
    id: "chapel",
    name: "Chapel of the First Light",
    x: 46,
    z: -14,
    width: 14,
    depth: 22,
    height: 9,
    roofHeight: 5.2,
    rotation: 0,
    material: materials.stone,
    roofMaterial: materials.roofTile,
    timberFrame: false,
    interactionKind: "shrine",
    prompt: "Pray at the chapel",
    interactionTags: ["blessing", "lore"],
  });
  const chapelTower = meshFromUnit(shared.box, materials.stone, "Chapel bell tower", new THREE.Vector3(0, 12, -6), new THREE.Vector3(7, 15, 7));
  chapel.add(chapelTower);
  const chapelSpire = meshFromUnit(shared.wedge, materials.roofTile, "Chapel slate spire", new THREE.Vector3(0, 21, -6), new THREE.Vector3(5.8, 8.5, 5.8), Math.PI * 0.25);
  chapel.add(chapelSpire);
  addFire("chapel_votives", 46, -10, { protectedFromRain: true, light: false, intensity: 3.2, yOffset: 1.1 });

  createBuilding({
    id: "stable",
    name: "Village Stable",
    x: -53,
    z: 43,
    width: 24,
    depth: 14,
    height: 6.2,
    rotation: 0.11,
    material: materials.wood,
    interactionKind: "stable",
    prompt: "Inspect the stable",
    interactionTags: ["mount", "feed"],
  });
  for (const [id, x, z, rotation] of [
    ["grain_shed", -88, 82, 0.04],
    ["tool_shed", 85, 88, -0.08],
    ["riverside_shed", -81, 57, 0.16],
  ]) {
    createBuilding({ id, x, z, width: 11, depth: 8, height: 4.5, roofHeight: 2.4, rotation, material: materials.wood, interactive: false, kind: "shed", zone: "farms" });
  }

  const market = new THREE.Group();
  market.name = "Village market square";
  market.position.copy(vectorAt(0, 40));
  const stallTransforms = [];
  for (let index = 0; index < 5; ++index) {
    const angle = index / 5 * Math.PI * 2;
    const stall = new THREE.Group();
    stall.name = `Market stall ${index + 1}`;
    stall.position.set(Math.cos(angle) * 9, 0, Math.sin(angle) * 6.5);
    stall.rotation.y = -angle + Math.PI * 0.5;
    stall.add(meshFromUnit(shared.box, materials.wood, "Market counter", new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(4.2, 0.35, 1.8)));
    stall.add(meshFromUnit(shared.box, materials.thatch, "Market canopy", new THREE.Vector3(0, 3.5, 0), new THREE.Vector3(5, 0.25, 3)));
    for (const x of [-1.9, 1.9]) stall.add(meshFromUnit(shared.box, materials.wood, "Market canopy post", new THREE.Vector3(x, 2, 0), new THREE.Vector3(0.17, 4, 0.17)));
    market.add(stall);
    for (let crate = 0; crate < 3; ++crate) {
      stallTransforms.push({ position: [Math.cos(angle) * 9 + crate * 0.72 - 0.72, terrainHeight(Math.cos(angle) * 9, 40 + Math.sin(angle) * 6.5) + 0.4, 40 + Math.sin(angle) * 6.5 + 1.5], scale: [0.65, 0.65, 0.65], rotation: [0, angle, 0] });
    }
  }
  group.add(market);
  const crates = createInstancedBoxes("Instanced market crates", stallTransforms, shared.box, materials.wood);
  group.add(crates);
  addLandmark("market", market, 0, 40, { name: "Market Square", kind: "market", zone: "village", radius: 13, tags: ["trade", "gathering"] });
  addInteractable("market_stalls", "trade", 0, 40, { landmarkId: "market", prompt: "Browse the market stalls", radius: 11, tags: ["trade"] });
  addFire("village_brazier_west", -6.5, 40, { kind: "brazier", lit: false, intensity: 6, radius: 15 });
  addFire("village_brazier_east", 6.5, 40, { kind: "brazier", lit: false, intensity: 6, radius: 15 });

  // Fields use one shared instanced fence allocation; the crop blades live in
  // the merged vegetation draw call.
  const fenceTransforms = [];
  const addFenceRectangle = (centerX, centerZ, width, depth) => {
    const step = 4;
    for (let x = centerX - width * 0.5; x <= centerX + width * 0.5; x += step) {
      for (const z of [centerZ - depth * 0.5, centerZ + depth * 0.5]) {
        fenceTransforms.push({ position: [x, terrainHeight(x, z) + 0.8, z], scale: [0.16, 1.6, 0.16] });
      }
    }
    for (let z = centerZ - depth * 0.5; z <= centerZ + depth * 0.5; z += step) {
      for (const x of [centerX - width * 0.5, centerX + width * 0.5]) {
        fenceTransforms.push({ position: [x, terrainHeight(x, z) + 0.8, z], scale: [0.16, 1.6, 0.16] });
      }
    }
  };
  addFenceRectangle(-72, 111, 52, 46);
  addFenceRectangle(72, 113, 54, 45);
  const fieldFences = createInstancedBoxes("Instanced field fences", fenceTransforms, shared.box, materials.wood);
  group.add(fieldFences);
  addLandmark("west_field", fieldFences, -72, 111, { name: "West Barley Field", kind: "field", zone: "farms", radius: 34, tags: ["harvest"] });
  addLandmark("east_field", fieldFences, 72, 113, { name: "East Barley Field", kind: "field", zone: "farms", radius: 35, tags: ["harvest"] });
  addInteractable("west_field_crop", "harvest", -72, 111, { landmarkId: "west_field", radius: 24, prompt: "Harvest barley" });
  addInteractable("east_field_crop", "harvest", 72, 113, { landmarkId: "east_field", radius: 25, prompt: "Harvest barley" });

  // The damaged village beacon is the visual anchor of the main quest. It is
  // deliberately visible from the southern road and separate from the final
  // fortress corruption focus.
  const villageBeaconX = -20;
  const villageBeaconZ = -37;
  const villageBeacon = new THREE.Group();
  villageBeacon.name = "Village Beacon of the First Light";
  villageBeacon.position.copy(vectorAt(villageBeaconX, villageBeaconZ));
  const villageBeaconTowerGeometry = new THREE.CylinderGeometry(4.8, 6.2, 12, 8);
  disposables.push(villageBeaconTowerGeometry);
  const villageBeaconTower = new THREE.Mesh(villageBeaconTowerGeometry, materials.stone);
  villageBeaconTower.name = "Octagonal village beacon tower";
  villageBeaconTower.position.y = 6;
  villageBeaconTower.rotation.y = Math.PI * 0.125;
  villageBeaconTower.castShadow = true;
  villageBeaconTower.receiveShadow = true;
  villageBeacon.add(villageBeaconTower);
  for (let index = 0; index < 4; ++index) {
    const angle = index * Math.PI * 0.5 + Math.PI * 0.25;
    villageBeacon.add(meshFromUnit(
      shared.box,
      materials.fortress,
      "Beacon iron buttress",
      new THREE.Vector3(Math.cos(angle) * 4.5, 5.1, Math.sin(angle) * 4.5),
      new THREE.Vector3(0.65, 9.4, 0.65),
      -angle,
    ));
  }
  const villageBeaconCrystalGeometry = new THREE.OctahedronGeometry(2.2, 1);
  disposables.push(villageBeaconCrystalGeometry);
  const villageBeaconCrystal = new THREE.Mesh(villageBeaconCrystalGeometry, materials.beacon);
  villageBeaconCrystal.name = "Restorable village beacon focus";
  villageBeaconCrystal.position.y = 15.1;
  villageBeaconCrystal.userData.rtxIgnore = true;
  villageBeacon.add(villageBeaconCrystal);
  const beaconRouteSignalGeometry = new THREE.CylinderGeometry(0.45, 4.4, 92, 12, 1, true);
  disposables.push(beaconRouteSignalGeometry);
  const beaconRouteSignal = new THREE.Mesh(beaconRouteSignalGeometry, materials.beacon);
  beaconRouteSignal.name = "Village beacon route signal";
  beaconRouteSignal.position.y = 60;
  beaconRouteSignal.visible = false;
  beaconRouteSignal.renderOrder = 5;
  beaconRouteSignal.userData.rtxIgnore = true;
  villageBeacon.add(beaconRouteSignal);
  group.add(villageBeacon);
  const villageBeaconWorldY = villageBeacon.position.y + villageBeaconCrystal.position.y;
  addLandmark("village_beacon", villageBeacon, villageBeaconX, villageBeaconZ, {
    name: "Village Beacon of the First Light",
    kind: "beacon",
    zone: "village",
    radius: 8,
    tags: ["quest", "light", "repair"],
  });
  addBlocker("village_beacon_tower", villageBeaconX, villageBeaconZ, 10, 10, 12, {
    object: villageBeacon,
    tags: ["beacon", "tower"],
  });
  addInteractable("village_beacon", "beacon", villageBeaconX, villageBeaconZ + 6.2, {
    landmarkId: "village_beacon",
    worldY: villageBeacon.position.y + 1.2,
    radius: 4.5,
    prompt: "Inspect the damaged village beacon",
    tags: ["quest", "repair", "ignite"],
  });
  addFire("village_beacon", villageBeaconX, villageBeaconZ, {
    kind: "beacon",
    worldY: villageBeaconWorldY,
    lit: false,
    protectedFromRain: true,
    intensity: 25,
    radius: 65,
    color: 0xffd48a,
    castShadow: true,
  });

  // A compact herb garden gives the herbalist schedule a physical destination
  // and the crafting loop a stable gather node.
  const herbGardenX = -39;
  const herbGardenZ = -22;
  const herbTransforms = [];
  for (let index = 0; index < 24; ++index) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const x = herbGardenX - 3.2 + column * 1.25;
    const z = herbGardenZ - 2.1 + row * 1.35;
    herbTransforms.push({
      position: [x, terrainHeight(x, z) + 0.34, z],
      scale: [0.42 + (index % 3) * 0.08, 0.62 + (index % 4) * 0.08, 0.42 + (index % 2) * 0.08],
      rotation: [0, index * 1.7, 0],
    });
  }
  const herbGarden = createInstancedBoxes("Instanced medicinal herb garden", herbTransforms, shared.sphere, materials.leaf);
  group.add(herbGarden);
  addLandmark("herb_garden", herbGarden, herbGardenX, herbGardenZ, { name: "Herbalist's Garden", kind: "resource", zone: "village", radius: 7, tags: ["herb", "gather"] });
  addBlocker("herb_garden_vegetation_spacing", herbGardenX, herbGardenZ, 9, 8, 1, { active: false, object: herbGarden, tags: ["vegetation_exclusion"] });
  addInteractable("medicinal_herbs", "gather", herbGardenX, herbGardenZ, {
    landmarkId: "herb_garden",
    radius: 5.5,
    prompt: "Gather medicinal herbs",
    tags: ["resource", "gather", "herb"],
    metadata: { itemId: "medicinal_herbs", quantity: 1, maxUses: 6, respawnSeconds: 150 },
  });

  // Village watch posts and guards establish the safe perimeter.
  function createWatchPost(id, x, z, rotation, zone = "village") {
    const post = new THREE.Group();
    post.name = id.replaceAll("_", " ");
    post.position.copy(vectorAt(x, z));
    post.rotation.y = rotation;
    for (const px of [-2, 2]) for (const pz of [-2, 2]) post.add(meshFromUnit(shared.box, materials.wood, "Watch post leg", new THREE.Vector3(px, 4, pz), new THREE.Vector3(0.38, 8, 0.38)));
    post.add(meshFromUnit(shared.box, materials.wood, "Watch platform", new THREE.Vector3(0, 7.3, 0), new THREE.Vector3(5.6, 0.45, 5.6)));
    post.add(meshFromUnit(shared.roof, materials.thatch, "Watch post roof", new THREE.Vector3(0, 9.1, 0), new THREE.Vector3(6.7, 3.8, 6.7)));
    group.add(post);
    addLandmark(id, post, x, z, { kind: "watch_post", zone, radius: 5.5, tags: ["guard"] });
    addBlocker(`${id}_legs`, x, z, 5, 5, 8, { object: post, tags: ["watch_post"] });
    addInteractable(id, "watch_post", x, z, { yOffset: 1.2, prompt: "Speak with the watch", tags: ["guard"] });
    addFire(`${id}_torch`, x + Math.sin(rotation) * 2.4, z + Math.cos(rotation) * 2.4, { intensity: 5.5, radius: 13, yOffset: 4.7 });
    return post;
  }
  createWatchPost("south_watch_post", -10, 51, 0);
  createWatchPost("north_watch_post", 8, -45, Math.PI);
  createWatchPost("farm_watch_post", 116, 109, -Math.PI * 0.5, "farms");

  const guardMaterial = new THREE.MeshStandardMaterial({ name: "Village guard livery", color: 0x6b252a, roughness: 0.82 });
  ownedMaterials.push(guardMaterial);
  const guardPositions = [[-5, 50, 0], [6, 47, Math.PI], [4, -41, Math.PI], [111, 107, -Math.PI * 0.5]];
  for (let index = 0; index < guardPositions.length; ++index) {
    const [x, z, rotation] = guardPositions[index];
    const guard = new THREE.Group();
    guard.name = `Village guard ${index + 1}`;
    guard.position.copy(vectorAt(x, z));
    guard.rotation.y = rotation;
    guard.add(meshFromUnit(shared.cylinder, guardMaterial, "Guard torso", new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(1.1, 2.2, 1.1)));
    guard.add(meshFromUnit(shared.sphere, materials.iron, "Guard helmet", new THREE.Vector3(0, 3.25, 0), new THREE.Vector3(1.2, 1.1, 1.2)));
    guard.add(meshFromUnit(shared.cylinder, materials.wood, "Guard spear", new THREE.Vector3(0.9, 2.5, 0), new THREE.Vector3(0.14, 5, 0.14)));
    group.add(guard);
    addInteractable(`guard_${index + 1}`, "npc", x, z, { prompt: "Speak with the guard", radius: 2.2, tags: ["guard", "npc"] });
  }

  // --- River, bridge and mill --------------------------------------------
  const bridgeX = 0;
  const bridgeZ = riverCenterZ(bridgeX);
  const bridgeY = Math.max(terrainHeight(bridgeX, bridgeZ - riverWidth(bridgeX) * 0.55), terrainHeight(bridgeX, bridgeZ + riverWidth(bridgeX) * 0.55), riverSurfaceHeight(bridgeX) + 1.7);
  const bridge = new THREE.Group();
  bridge.name = "Old stone river bridge";
  bridge.position.set(bridgeX, bridgeY, bridgeZ);
  const deck = meshFromUnit(shared.box, materials.stone, "Stone bridge deck", new THREE.Vector3(0, 0, 0), new THREE.Vector3(7.5, 1.2, riverWidth(bridgeX) + 8));
  bridge.add(deck);
  for (const side of [-1, 1]) {
    bridge.add(meshFromUnit(shared.box, materials.stone, "Stone bridge parapet", new THREE.Vector3(side * 3.35, 1.3, 0), new THREE.Vector3(0.65, 1.5, riverWidth(bridgeX) + 8)));
    for (const z of [-6.5, 0, 6.5]) bridge.add(meshFromUnit(shared.box, materials.stone, "Bridge coping", new THREE.Vector3(side * 3.35, 2.35, z), new THREE.Vector3(0.95, 0.45, 1.3)));
  }
  for (const side of [-1, 1]) bridge.add(meshFromUnit(shared.cylinder, materials.stone, "Bridge pier", new THREE.Vector3(side * 2.15, -2.2, 0), new THREE.Vector3(2.2, 5.2, 2.2), 0));
  group.add(bridge);
  const bridgeDeckHeight = bridgeY + 0.6;
  const bridgeHalfLength = (riverWidth(bridgeX) + 8) * 0.5;
  walkableSurfaces.push({
    id: "stone_bridge_deck",
    shape: "aabb",
    center: [bridgeX, bridgeY, bridgeZ],
    halfExtents: [3.0, 0.6, bridgeHalfLength],
    active: true,
    tags: ["bridge", "walkable", "crossing"],
  });
  for (const side of [-1, 1]) {
    const outerZ = bridgeZ + side * (bridgeHalfLength + 5);
    const outerHeight = terrainHeight(bridgeX, outerZ) + 0.06;
    for (let segment = 0; segment < 5; ++segment) {
      const fromDeck = (segment + 0.5) / 5;
      const z = bridgeZ + side * (bridgeHalfLength + segment + 0.5);
      const top = THREE.MathUtils.lerp(bridgeDeckHeight, outerHeight, fromDeck);
      group.add(meshFromUnit(
        shared.box,
        materials.stone,
        "Stone bridge approach slab",
        new THREE.Vector3(bridgeX, top - 0.12, z),
        new THREE.Vector3(6, 0.24, 1.04),
      ));
      walkableSurfaces.push({
        id: `stone_bridge_${side < 0 ? "south" : "north"}_approach_${segment + 1}`,
        shape: "aabb",
        center: [bridgeX, top - 0.12, z],
        halfExtents: [3.0, 0.12, 0.52],
        active: true,
        tags: ["bridge", "walkable", "approach"],
      });
    }
  }
  addLandmark("stone_bridge", bridge, bridgeX, bridgeZ, { name: "Old Stone Bridge", kind: "bridge", zone: "river", radius: 13, yOffset: bridgeY - terrainHeight(bridgeX, bridgeZ), tags: ["crossing"] });
  addInteractable("bridge_inscription", "lore", 3, bridgeZ, { landmarkId: "stone_bridge", yOffset: bridgeY - terrainHeight(3, bridgeZ) + 1.1, prompt: "Read the bridge inscription", tags: ["lore"] });
  addBlocker("bridge_west_parapet", -3.35, bridgeZ, 0.65, riverWidth(bridgeX) + 8, 2.6, { baseY: bridgeY, tags: ["bridge_rail"] });
  addBlocker("bridge_east_parapet", 3.35, bridgeZ, 0.65, riverWidth(bridgeX) + 8, 2.6, { baseY: bridgeY, tags: ["bridge_rail"] });

  const millX = 120;
  const millZ = riverCenterZ(millX) + riverWidth(millX) * 0.72;
  createBuilding({
    id: "watermill",
    name: "Greywater Mill",
    x: millX,
    z: millZ,
    width: 19,
    depth: 15,
    height: 9,
    rotation: -0.07,
    material: materials.stone,
    interactionKind: "mill",
    prompt: "Inspect the working watermill",
    interactionTags: ["crafting", "trade"],
    zone: "river",
  });
  addFire("mill_lantern", millX - 5, millZ - 4, { protectedFromRain: true, intensity: 5.5, radius: 14, yOffset: 2.6 });

  // --- Forest destinations ------------------------------------------------
  const campX = -112;
  const campZ = -69;
  const hunterCamp = new THREE.Group();
  hunterCamp.name = "Hunter camp";
  hunterCamp.position.copy(vectorAt(campX, campZ));
  for (const [x, z, rotation] of [[-5, 0, 0.2], [4.5, -2, -0.4]]) {
    const tent = meshFromUnit(shared.wedge, materials.thatch, "Hunter canvas lean-to", new THREE.Vector3(x, 2.2, z), new THREE.Vector3(5, 4.4, 6), rotation);
    hunterCamp.add(tent);
  }
  hunterCamp.add(meshFromUnit(shared.box, materials.wood, "Hunter drying rack", new THREE.Vector3(0, 2.1, 5), new THREE.Vector3(6, 0.18, 0.18)));
  group.add(hunterCamp);
  addLandmark("hunter_camp", hunterCamp, campX, campZ, { name: "Hunter Camp", kind: "camp", zone: "west_forest", radius: 10, tags: ["rest", "hunting"] });
  addInteractable("hunter_camp_bedroll", "rest", campX - 3, campZ, { landmarkId: "hunter_camp", prompt: "Rest at the hunter camp", radius: 3.5 });
  addFire("hunter_campfire", campX, campZ + 2.5, { intensity: 7.5, radius: 17 });

  const woodPileX = campX + 10;
  const woodPileZ = campZ + 4;
  const woodPile = new THREE.Group();
  woodPile.name = "Seasoned hunter wood pile";
  woodPile.position.copy(vectorAt(woodPileX, woodPileZ));
  for (let index = 0; index < 9; ++index) {
    const log = meshFromUnit(
      shared.cylinder,
      materials.wood,
      "Seasoned ash log",
      new THREE.Vector3((index % 3 - 1) * 0.7, 0.38 + Math.floor(index / 3) * 0.5, (Math.floor(index / 3) - 1) * 0.62),
      new THREE.Vector3(0.48, 2.7, 0.48),
    );
    log.rotation.z = Math.PI * 0.5;
    woodPile.add(log);
  }
  group.add(woodPile);
  addLandmark("seasoned_wood_pile", woodPile, woodPileX, woodPileZ, { name: "Seasoned Wood Pile", kind: "resource", zone: "west_forest", radius: 4, tags: ["wood", "gather"] });
  addInteractable("seasoned_wood", "gather", woodPileX, woodPileZ, {
    landmarkId: "seasoned_wood_pile",
    radius: 3.2,
    prompt: "Take seasoned wood",
    tags: ["resource", "gather", "wood"],
    metadata: { itemId: "seasoned_wood", quantity: 1, maxUses: 5, respawnSeconds: 210 },
  });

  const resinX = -73;
  const resinZ = -104;
  const resinGrove = new THREE.Group();
  resinGrove.name = "Tapped old-pine resin grove";
  resinGrove.position.copy(vectorAt(resinX, resinZ));
  for (let index = 0; index < 5; ++index) {
    const angle = index / 5 * Math.PI * 2;
    const radius = index === 0 ? 0 : 5.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    resinGrove.add(meshFromUnit(shared.cylinder, materials.wood, "Tapped pine trunk", new THREE.Vector3(x, 4.4, z), new THREE.Vector3(1.25, 8.8, 1.25)));
    resinGrove.add(meshFromUnit(shared.box, materials.iron, "Resin tapping cup", new THREE.Vector3(x + 0.72, 1.45, z), new THREE.Vector3(0.45, 0.62, 0.65), angle));
  }
  group.add(resinGrove);
  addLandmark("resin_grove", resinGrove, resinX, resinZ, { name: "Old Pine Resin Grove", kind: "resource_grove", zone: "west_forest", radius: 12, tags: ["resin", "gather", "quest"] });
  addBlocker("resin_grove_vegetation_spacing", resinX, resinZ, 17, 17, 9, { active: false, object: resinGrove, tags: ["vegetation_exclusion"] });
  addInteractable("pine_resin", "gather", resinX, resinZ, {
    landmarkId: "resin_grove",
    radius: 7,
    prompt: "Collect pine resin",
    tags: ["resource", "gather", "resin", "quest"],
    metadata: { itemId: "pine_resin", quantity: 1, maxUses: 5, respawnSeconds: 180 },
  });

  const caveX = 116;
  const caveZ = -93;
  const cave = new THREE.Group();
  cave.name = "Eastern shadow cave";
  cave.position.copy(vectorAt(caveX, caveZ));
  cave.rotation.y = -0.36;
  const caveDarkMaterial = new THREE.MeshBasicMaterial({ name: "Cave darkness", color: 0x050607, side: THREE.DoubleSide });
  ownedMaterials.push(caveDarkMaterial);
  const caveMouth = new THREE.Mesh(new THREE.CircleGeometry(5.2, 20), caveDarkMaterial);
  caveMouth.name = "Cave mouth darkness";
  caveMouth.position.set(0, 4.7, 0.3);
  cave.add(caveMouth);
  disposables.push(caveMouth.geometry);
  const caveRocks = [];
  for (let index = 0; index < 15; ++index) {
    const angle = THREE.MathUtils.lerp(-0.15, Math.PI + 0.15, index / 14);
    caveRocks.push({ position: [Math.cos(angle) * 5.2, 4.7 + Math.sin(angle) * 4.6, 0], scale: [1.8 + (index % 3) * 0.45, 1.6 + (index % 4) * 0.3, 2.2], rotation: [0, index * 0.41, index * 0.17] });
  }
  cave.add(createInstancedBoxes("Instanced cave arch rocks", caveRocks, shared.rock, materials.fortress));
  const wolfDenHeartGeometry = new THREE.OctahedronGeometry(1.45, 1);
  disposables.push(wolfDenHeartGeometry);
  const wolfDenHeart = new THREE.Mesh(wolfDenHeartGeometry, corruptionMaterial);
  wolfDenHeart.name = "Corrupted wolf den heart";
  wolfDenHeart.position.set(0, 2.3, -0.7);
  wolfDenHeart.scale.set(0.72, 1.5, 0.72);
  wolfDenHeart.userData.rtxIgnore = true;
  cave.add(wolfDenHeart);
  group.add(cave);
  addLandmark("shadow_cave", cave, caveX, caveZ, { name: "Shadow Cave", kind: "cave", zone: "east_forest", radius: 9, tags: ["dungeon", "dark"] });
  landmarks.wolf_den = { ...landmarks.shadow_cave, id: "wolf_den", name: "Corrupted Wolf Den", aliasOf: "shadow_cave" };
  addBlocker("shadow_cave_rock", caveX, caveZ + 2.5, 14, 5, 9, { rotation: -0.36, object: cave, tags: ["cave", "rock"] });
  addInteractable("shadow_cave_entrance", "dungeon", caveX, caveZ - 1, { landmarkId: "shadow_cave", yOffset: 1, radius: 5, prompt: "Enter the shadow cave", tags: ["dungeon"] });
  addInteractable("wolf_den_heart", "destroy", caveX, caveZ, {
    landmarkId: "wolf_den",
    worldY: cave.position.y + 2.3,
    radius: 3,
    prompt: "Destroy the corruption heart",
    tags: ["quest", "corruption", "destructible"],
    metadata: { objectiveId: "destroy_den_heart", health: 45, oneShot: true },
  });

  const forestTowerX = trailCenterX(-111) + 20;
  const forestTowerZ = -111;
  createWatchPost("forest_watchtower", forestTowerX, forestTowerZ, Math.PI, "north_forest");
  landmarks.forest_watchtower.name = "Abandoned Forest Watchtower";
  landmarks.old_watchtower = {
    ...landmarks.forest_watchtower,
    id: "old_watchtower",
    name: "Old Forest Watchtower",
    aliasOf: "forest_watchtower",
  };

  // --- Architecturally distinct ruined fortress --------------------------
  const fortress = new THREE.Group();
  fortress.name = "Ruined basalt fortress of Keepfall";
  fortress.position.copy(vectorAt(0, -190));
  group.add(fortress);
  const fortressGroundY = fortress.position.y;
  const localTerrainOffset = (x, z) => terrainHeight(x, z) - fortressGroundY;
  const wallSpecs = [
    { name: "Fortress south wall west", x: -20, z: 30, w: 24, d: 5, h: 12 },
    { name: "Fortress south wall east", x: 20, z: 30, w: 24, d: 5, h: 12 },
    { name: "Fortress north wall", x: 0, z: -30, w: 62, d: 5, h: 15 },
    { name: "Fortress west wall", x: -31, z: 0, w: 5, d: 61, h: 14 },
    { name: "Ruined east wall south", x: 31, z: 18, w: 5, d: 21, h: 11, rz: -0.06 },
    { name: "Ruined east wall north", x: 31, z: -19, w: 5, d: 18, h: 8, rz: 0.08 },
  ];
  for (const wall of wallSpecs) {
    const worldX = wall.x;
    const worldZ = -190 + wall.z;
    const mesh = meshFromUnit(shared.box, materials.fortress, wall.name, new THREE.Vector3(wall.x, localTerrainOffset(worldX, worldZ) + wall.h * 0.5, wall.z), new THREE.Vector3(wall.w, wall.h, wall.d));
    mesh.rotation.z = wall.rz ?? 0;
    fortress.add(mesh);
    addBlocker(wall.name.toLowerCase().replaceAll(" ", "_"), worldX, worldZ, wall.w, wall.d, wall.h, { object: mesh, tags: ["fortress", "wall"] });
  }

  const towerPositions = [[-31, -30], [31, -30], [-31, 30], [31, 30]];
  for (let index = 0; index < towerPositions.length; ++index) {
    const [x, z] = towerPositions[index];
    const height = index === 3 ? 12 : 21;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 9.2, height, 8), materials.fortress);
    tower.name = index === 3 ? "Collapsed southeast octagonal tower" : `Fortress octagonal tower ${index + 1}`;
    tower.position.set(x, localTerrainOffset(x, -190 + z) + height * 0.5, z);
    tower.rotation.y = Math.PI * 0.125;
    tower.castShadow = true;
    tower.receiveShadow = true;
    fortress.add(tower);
    disposables.push(tower.geometry);
    addBlocker(`fortress_tower_${index + 1}`, x, -190 + z, 15, 15, height, { object: tower, tags: ["fortress", "tower"] });
  }

  const battlements = [];
  for (let x = -28; x <= 28; x += 5.5) {
    battlements.push({ position: [x, localTerrainOffset(x, -220) + 16.3, -30], scale: [2.4, 2.6, 2.4] });
    if (Math.abs(x) > 8) battlements.push({ position: [x, localTerrainOffset(x, -160) + 13.3, 30], scale: [2.4, 2.6, 2.4] });
  }
  for (let z = -25; z <= 25; z += 5.5) {
    battlements.push({ position: [-31, localTerrainOffset(-31, -190 + z) + 15.3, z], scale: [2.4, 2.6, 2.4] });
    if (z < -5 || z > 9) battlements.push({ position: [31, localTerrainOffset(31, -190 + z) + 11.3, z], scale: [2.4, 2.6, 2.4] });
  }
  fortress.add(createInstancedBoxes("Instanced fortress battlements", battlements, shared.box, materials.fortress));

  const gate = meshFromUnit(shared.box, materials.iron, "Fortress portcullis", new THREE.Vector3(0, 7.1, 29.5), new THREE.Vector3(9, 12, 0.7));
  fortress.add(gate);
  const gateBlocker = addBlocker("fortress_portcullis", 0, -160.5, 9, 1.2, 12, { baseY: fortressGroundY + gate.position.y - 6, object: gate, tags: ["fortress", "gate", "progress"] });
  addInteractable("fortress_gate", "gate", 0, -155, { landmarkId: "ruined_fortress", prompt: "Inspect the sealed fortress gate", radius: 6, tags: ["quest", "gate"] });

  const keep = meshFromUnit(shared.box, materials.fortress, "Fortress ruined central keep", new THREE.Vector3(-5, 9, -4), new THREE.Vector3(24, 18, 19), 0.04);
  fortress.add(keep);
  fortress.add(meshFromUnit(shared.box, materials.fortress, "Collapsed keep wing", new THREE.Vector3(14, 3.5, -4), new THREE.Vector3(12, 7, 17), -0.17));
  const signalTower = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 7.4, 26, 8), materials.fortress);
  signalTower.name = "Warden's octagonal signal tower";
  signalTower.position.set(8, 13, -17);
  signalTower.rotation.y = Math.PI * 0.125;
  signalTower.castShadow = true;
  signalTower.receiveShadow = true;
  fortress.add(signalTower);
  disposables.push(signalTower.geometry);
  const wardenFocus = new THREE.Mesh(new THREE.OctahedronGeometry(2.8, 1), corruptionMaterial);
  wardenFocus.name = "Fortress warden corruption focus";
  wardenFocus.position.set(8, 29.5, -17);
  wardenFocus.userData.rtxIgnore = true;
  fortress.add(wardenFocus);
  disposables.push(wardenFocus.geometry);
  const wardenFocusWorldY = fortressGroundY + wardenFocus.position.y;
  addLandmark("warden_focus", wardenFocus, 8, -207, { name: "Warden's Corruption Focus", kind: "corruption_focus", zone: "fortress", radius: 7, yOffset: wardenFocusWorldY - terrainHeight(8, -207), tags: ["quest", "dark"] });
  addInteractable("warden_focus", "quest", 8, -207, { landmarkId: "warden_focus", worldY: wardenFocusWorldY - 2.5, radius: 5, prompt: "Examine the Warden's corruption focus", tags: ["quest", "combat"] });
  addFire("fortress_gate_west_torch", -7, -160, { intensity: 8, radius: 19, yOffset: 4.5 });
  addFire("fortress_gate_east_torch", 7, -160, { intensity: 8, radius: 19, yOffset: 4.5 });

  const corruptionGroup = new THREE.Group();
  corruptionGroup.name = "Fortress corruption crystals";
  const corruptionGeometry = new THREE.OctahedronGeometry(1, 0);
  disposables.push(corruptionGeometry);
  const corruptionTransforms = [];
  for (let index = 0; index < 28; ++index) {
    const angle = index * 2.399963;
    const radius = 9 + (index % 7) * 4.1;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    corruptionTransforms.push({ position: [x, localTerrainOffset(x, -190 + z) + 1.2 + (index % 3) * 0.5, z], scale: [0.65 + (index % 4) * 0.22, 1.5 + (index % 5) * 0.55, 0.65 + (index % 3) * 0.18], rotation: [0, angle, 0.13 * (index % 4)] });
  }
  const corruptionCrystals = createInstancedBoxes("Instanced fortress corruption crystals", corruptionTransforms, corruptionGeometry, corruptionMaterial);
  corruptionCrystals.userData.rtxIgnore = true;
  corruptionGroup.add(corruptionCrystals);
  fortress.add(corruptionGroup);

  addLandmark("ruined_fortress", fortress, 0, -190, { name: "Keepfall Ruined Fortress", kind: "fortress", zone: "fortress", radius: 46, tags: ["dungeon", "finale"] });
  addInteractable("fortress_courtyard", "quest", 0, -190, { landmarkId: "ruined_fortress", radius: 18, prompt: "Search the ruined courtyard", tags: ["quest", "combat"] });

  const villageBanner = createWindBanner(materials, { name: "Village guard banner", colorValue: 0x852f32, phase: 0.4, width: 2.2, height: 4.4 });
  villageBanner.group.position.copy(vectorAt(-2, -42));
  group.add(villageBanner.group);
  const fortressBannerA = createWindBanner(materials, { name: "Torn fortress banner west", colorValue: 0x351d42, phase: 1.7, width: 3.2, height: 6.8 });
  fortressBannerA.group.position.set(-25, localTerrainOffset(-25, -218), -28);
  fortress.add(fortressBannerA.group);
  const fortressBannerB = createWindBanner(materials, { name: "Torn fortress banner north", colorValue: 0x351d42, phase: 3.4, width: 2.8, height: 6.2 });
  fortressBannerB.group.position.set(24, localTerrainOffset(24, -219), -29);
  fortress.add(fortressBannerB.group);
  disposables.push(villageBanner, fortressBannerA, fortressBannerB);

  // The old road has a physical breadcrumb trail of cairns between forest and
  // fortress, preserving visual continuity even in fog.
  const cairnTransforms = [];
  for (let z = -68; z >= -154; z -= 13) {
    const x = trailCenterX(z) + (Math.round(Math.abs(z)) % 2 ? 5.2 : -5.2);
    cairnTransforms.push({ position: [x, terrainHeight(x, z) + 0.65, z], scale: [1.1, 1.3, 1.1], rotation: [0, z * 0.1, 0] });
  }
  const trailCairns = createInstancedBoxes("Instanced old-road cairns", cairnTransforms, shared.rock, materials.stone);
  group.add(trailCairns);
  addLandmark("old_north_road", trailCairns, trailCenterX(-100), -100, { name: "Old North Road", kind: "trail", zone: "north_forest", radius: 60, tags: ["route"] });

  return {
    group,
    landmarks,
    blockers,
    walkableSurfaces,
    interactables,
    fireDefinitions,
    progressTargets: {
      fortressGate: gate,
      fortressGateBlocker: gateBlocker,
      corruptionGroup,
      beaconCrystal: villageBeaconCrystal,
      beaconRouteSignal,
      villageBanner: villageBanner.group,
      fortress,
    },
    dispose() {
      for (const disposable of disposables) {
        if (typeof disposable?.dispose === "function") disposable.dispose();
      }
      for (const material of ownedMaterials) material.dispose();
      for (const geometry of Object.values(shared)) geometry.dispose();
    },
  };
}
