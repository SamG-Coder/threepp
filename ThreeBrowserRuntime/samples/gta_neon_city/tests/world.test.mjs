import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import {
  CITY_ROAD_CENTERS,
  CITY_SEED,
  buildCity,
} from "../src/world/city.mjs";
import { createVehicleSystem } from "../src/actors/vehicles.mjs";

function withCity(run, options) {
  const scene = new THREE.Scene();
  const city = buildCity(scene, options);
  try {
    return run(city, scene);
  } finally {
    city.dispose();
  }
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, value);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function deterministicSummary(city) {
  return {
    seed: city.seed,
    stats: city.stats,
    bounds: city.bounds,
    roads: city.roads,
    routes: city.routes,
    districts: city.districts,
    buildings: city.buildings,
    blockers: city.blockers,
    pedestrianNodes: city.pedestrianNodes,
    spawnPoints: city.spawnPoints,
    missionPoints: city.missionPoints,
    businesses: city.businesses,
    businessFrontages: city.businessFrontages,
    residentialInterior: city.residentialInterior,
    communityHub: city.communityHub,
    commonGroundCafe: city.commonGroundCafe,
    minaMarketKitchen: city.minaMarketKitchen,
    pulseGarageInterior: city.pulseGarageInterior,
    chapterTwo: city.chapterTwo,
    pulseTransit: city.pulseTransit,
    northMarket: city.northMarket,
  };
}

test("city generation is deterministic, substantial and render-efficient", () => {
  const firstScene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  const first = buildCity(firstScene);
  const second = buildCity(secondScene);
  try {
    assert.equal(first.seed, CITY_SEED);
    assert.deepEqual(deterministicSummary(first), deterministicSummary(second));
    assert.equal(first.root.userData.staticWorld, true);
    assert.equal(first.root.userData.rtxStatic, true);
    assert.equal(first.root.parent, firstScene);

    assert.equal(first.stats.roads, CITY_ROAD_CENTERS.x.length + CITY_ROAD_CENTERS.z.length);
    assert.equal(first.stats.routes, first.stats.roads * 2);
    assert.ok(first.stats.buildings >= 45, first.stats);
    assert.ok(first.stats.blockers >= first.stats.buildings, first.stats);
    assert.ok(first.stats.trees >= 24, first.stats);
    assert.ok(first.stats.instances >= 5_000 && first.stats.instances <= 5_900, first.stats);
    assert.ok(first.stats.instancedMeshes <= 64, first.stats);
    assert.equal(first.stats.districts, 5);
    assert.ok(first.stats.streetDetailInstances >= 1_000, first.stats);
    assert.ok(first.stats.laneArrows >= 30, first.stats);
    assert.equal(first.stats.linearLaneDividers, 0, "two-lane roads must not carry duplicate internal dividers");
    assert.equal(first.stats.intersectionAsphaltCaps,
      CITY_ROAD_CENTERS.x.length * CITY_ROAD_CENTERS.z.length);
    assert.ok(first.stats.junctionMarkingClearance >= 10, first.stats);
    assert.ok(first.stats.storefronts >= 28, first.stats);
    assert.ok(first.stats.storefrontPracticalLights >= 10, first.stats);
    assert.equal(first.stats.plazaPracticalLights, 4);
    assert.equal(first.stats.harbourCourt, true);
    assert.equal(first.stats.harbourCourtPracticalLights, 2);
    assert.equal(first.stats.harbourCourtShotSpots, 5);
    assert.ok(first.stats.facadeMullions >= 300, first.stats);
    assert.ok(first.stats.windowBanks >= 1_600, first.stats);
    assert.equal(first.stats.occupiedGroundFloors, 60);
    assert.equal(first.stats.groundFloorInteriorBanks, 224,
      "the home, public hub, cafe and market replace four projected ground-floor room banks");
    assert.equal(first.stats.streetLevelPlinths, 44);
    assert.equal(first.stats.streetLevelPlinthHeight, 0.82);
    assert.ok(first.stats.benches >= 12 && first.stats.planters >= 8, first.stats);
    assert.ok(first.stats.cafeFurniture >= 24 && first.stats.streetClutter >= 20, first.stats);
    assert.ok(first.stats.pedestrianNodes >= 800, first.stats);
    assert.equal(first.stats.pedestrianNodes, first.pedestrianNodes.length);
    assert.ok(first.pedestrianNodes.every(point =>
      point.length === 3 && !first.isBlockedCircle(point[0], point[2], 0.38)),
    "the ambient navigation graph must remain on clear pedestrian ground");
    assert.ok(first.stats.puddles >= 60, first.stats);
    assert.ok(first.stats.distantBuildings >= 60, first.stats);
    assert.ok(first.stats.staticLights >= 20, first.stats);
    assert.equal(first.stats.virtualInteriorStyles, 3);
    assert.ok(first.stats.litInteriorRooms >= 10 && first.stats.unlitInteriorRooms >= 10, first.stats);

    const ids = first.blockers.map(blocker => blocker.id);
    assert.equal(new Set(ids).size, ids.length, "collision IDs must remain unique");
    assert.ok(first.blockers.every(blocker =>
      blocker.shape === "aabb" && blocker.center.length === 3 && blocker.halfExtents.length === 3));
    assert.ok(first.buildings.some(building => building.size[1] > 60), "skyline needs at least one tall tower");
    assert.ok(new Set(first.buildings.map(building => building.form)).size >= 3, "skyline should use varied building forms");
    assert.ok(first.buildings.every(building => first.districts.some(district => district.id === building.district)));
    assert.equal(Object.values(first.stats.districtBuildingCounts).reduce((sum, count) => sum + count, 0), first.stats.buildings);

    const detailNames = new Set(first.root.children.filter(object => object.isInstancedMesh).map(object => object.name));
    for (const name of [
      "Instanced facade corner ribs",
      "Instanced apartment balconies",
      "Irregular shallow street puddles",
      "Traffic signal heads",
      "Pulse Street bus shelter glass",
      "Harbour cargo containers style 1",
      "Distant skyline occupied window rooms",
      "Warm practical streetlight pavement pools",
      "Occupied storefront entrance light pools",
      "Plaza and park benches",
      "Sidewalk cabinets bins meters and parcel boxes",
      "Layered coastal ground haze",
    ]) assert.equal(detailNames.has(name), true, `missing realism batch: ${name}`);

    const interiorMeshes = first.root.children.filter(object =>
      object.isInstancedMesh && object.material?.userData?.interiorMapping?.technique === "view-ray room-box projection");
    assert.equal(interiorMeshes.length, 4, "three near styles plus the distant occupied-room batch should use projection");
    for (const mesh of interiorMeshes) {
      assert.equal(mesh.material.isMeshBasicNodeMaterial, true);
      assert.ok(mesh.material.colorNode);
      assert.equal(mesh.material.depthWrite, true);
      assert.equal(mesh.material.userData.interiorMapping.layers, 2);
      assert.ok(mesh.material.userData.interiorMapping.litRooms > 0);
      assert.ok(mesh.material.userData.interiorMapping.unlitRooms > 0);
    }
    const facadeMeshes = first.root.children.filter(object => object.name.startsWith("Instanced city buildings style"));
    assert.ok(facadeMeshes.every(mesh => mesh.material.map && mesh.material.normalMap && mesh.material.roughnessMap),
      "building shells should retain textured PBR facades behind the projected glass");
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("world exposes one immutable professional GPS contract with exact roads and Ashwind bounds", () => withCity(city => {
  assertDeepFrozen(city.mapFeatures);
  assert.equal(city.mapFeatures.version, 1);
  assert.equal(city.mapFeatures.northAxis, "+z");
  assert.deepEqual(city.mapFeatures.bounds, city.traversableBounds);
  assert.equal(city.mapFeatures.bounds.maxZ, 620, "phone navigation must include the remote ruins");
  assert.deepEqual(city.mapFeatures.roads.x, [...CITY_ROAD_CENTERS.x]);
  assert.deepEqual(city.mapFeatures.roads.z, [...CITY_ROAD_CENTERS.z]);
  assert.equal(city.mapFeatures.roads.halfWidth, 6);
  assert.deepEqual(city.mapFeatures.roads.bounds, city.bounds,
    "city road strokes must stop at the city edge instead of crossing the desert");
  assert.equal(city.mapFeatures.buildings.length, city.buildings.length);
  assert.ok(city.mapFeatures.buildings.every(building =>
    building.position.length === 2 && building.size.length === 2));
  const areaKinds = new Set(city.mapFeatures.areas.map(area => area.kind));
  for (const kind of ["water", "park", "plaza", "recreation", "desert", "ruins"]) {
    assert.equal(areaKinds.has(kind), true, `GPS context is missing ${kind}`);
  }
}));

test("pooled building bases reveal occupied ground floors without adding render work", () => withCity(city => {
  assert.equal(city.stats.instancedMeshes, 64);
  assert.equal(city.stats.instances, 5_858);
  assert.equal(city.stats.windowBanks, 1_912,
    "street-level occupancy must relocate existing room banks rather than allocate more panels");

  const occupiedBuildings = city.buildings.filter(building => building.groundFloorOccupied);
  const plinthBuildings = city.buildings.filter(building => building.streetLevelPlinthHeight > 0);
  assert.equal(occupiedBuildings.length, city.stats.occupiedGroundFloors);
  assert.equal(plinthBuildings.length, city.stats.streetLevelPlinths);
  assert.ok(occupiedBuildings.length >= city.buildings.length - 1,
    "procedural facades should read as occupied at pedestrian height");
  assert.ok(plinthBuildings.every(building => building.streetLevelPlinthHeight === 0.82));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let groundFloorPanels = 0;
  for (const mesh of city.root.children.filter(object =>
    object.name.startsWith("Instanced projected occupied interiors style"))) {
    for (let index = 0; index < mesh.count; ++index) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      if (Math.abs(position.y - 3.2) < 1e-4) groundFloorPanels += 1;
    }
  }
  assert.equal(groundFloorPanels, city.stats.groundFloorInteriorBanks,
    "each occupied procedural ground floor should expose four projected room banks");

  const podiums = city.root.getObjectByName("Instanced ground-floor podiums");
  assert.ok(podiums?.isInstancedMesh);
  for (const building of plinthBuildings) {
    let found = false;
    for (let index = 0; index < podiums.count && !found; ++index) {
      podiums.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      found = Math.abs(position.x - building.position[0]) < 1e-4 &&
        Math.abs(position.z - building.position[2]) < 1e-4 &&
        Math.abs(position.y - 0.61) < 1e-4 &&
        Math.abs(scale.x - (building.size[0] + 0.28)) < 1e-4 &&
        Math.abs(scale.y - 0.82) < 1e-4 &&
        Math.abs(scale.z - (building.size[2] + 0.28)) < 1e-4;
    }
    assert.equal(found, true, `missing shallow pooled plinth for ${building.id}`);
  }
}));

test("Southline Studio 3B is a deterministic, furnished and seamlessly enterable home", () => withCity(city => {
  const home = city.residentialInterior;
  assert.ok(home);
  assertDeepFrozen(home);
  assert.equal(home.id, "southline_studio_3b");
  assert.equal(home.homeId, "southline_studio_3b");
  assert.equal(home.buildingId, "southline_court");
  assert.equal(home.label, "SOUTHLINE STUDIO 3B");
  assert.equal(home.address, "18 Calder Street, Apt 3B");
  assert.equal(home.seed, (CITY_SEED ^ 0x484f4d45) >>> 0);
  assert.equal(home.districtId, "westside");
  assert.ok(home.bounds.maxX - home.bounds.minX >= 22, home.bounds);
  assert.ok(home.bounds.maxZ - home.bounds.minZ >= 12, home.bounds);
  assert.ok(home.bounds.ceilingY - home.bounds.floorY >= 3.3, home.bounds);

  const host = city.buildings.find(building => building.id === home.hostBuildingRecordId);
  assert.ok(host, "physical home must retain a real skyline host record");
  assert.equal(host.physicalInterior, home.homeId);
  assert.equal(host.propertyBuildingId, home.buildingId);
  assert.equal(city.blockers.some(blocker => blocker.id === home.hostBuildingRecordId), false,
    "the former whole-building collider would make the home impossible to enter");

  assert.deepEqual(Object.keys(home.zones), ["entry", "living", "kitchen", "bathroom", "bedroom"]);
  assert.equal(new Set(Object.values(home.zones).map(zone => zone.label)).size, 5);
  for (const zone of Object.values(home.zones)) {
    assert.ok(zone.position[0] >= zone.bounds.minX && zone.position[0] <= zone.bounds.maxX, zone);
    assert.ok(zone.position[2] >= zone.bounds.minZ && zone.position[2] <= zone.bounds.maxZ, zone);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(home.stations).map(([id, station]) => [id, station.action])), {
    entry: "enter",
    visitor: "visit",
    resident: "resident",
    bed: "sleep",
    shower: "shower",
    stove: "cook",
    table: "eat",
    sink: "clean",
    desk: "study",
    sofa: "relax",
  });
  assert.equal(home.stats.rooms, 5);
  assert.equal(home.stats.doorways, 3);
  assert.equal(home.stats.stations, 10);
  assert.equal(home.stats.renderInstances, 66);
  assert.equal(home.stats.glassPanels, 3);
  assert.equal(home.stats.collisionVolumes, 25);
  assert.equal(home.stats.emissiveMaterials, 0);
  assert.equal(home.stats.practicalLights, 1);
  assert.equal(home.renderParts.length, home.stats.renderInstances);
  assert.equal(new Set(home.renderParts.map(part => part.id)).size, home.renderParts.length,
    "every pooled home part needs a stable semantic identity");
  assert.ok(home.renderParts.every(part => part.scale.every(value => Number.isFinite(value) && value > 0)));
  assert.ok(home.renderParts.every(part => !part.batch.toLowerCase().includes("neon")),
    "domestic geometry must not borrow the neon-sign material batch");

  const requiredParts = [
    "floor", "ceiling", "front-door-lintel", "living-room-dark-glass",
    "sofa-seat", "television-dark-panel", "kitchen-stove", "kitchen-sink",
    "dining-table", "bed-base", "study-desk", "bathroom-vanity",
    "shower-glass-south", "entry-bench", "living-ceiling-practical",
  ];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const id of requiredParts) {
    const part = home.renderParts.find(candidate => candidate.id === id);
    assert.ok(part, `missing authored home part ${id}`);
    const mesh = city.root.getObjectByName(part.batch);
    assert.ok(mesh?.isInstancedMesh, `missing resident pool ${part.batch}`);
    let found = false;
    for (let index = 0; index < mesh.count && !found; ++index) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      found = Math.hypot(
        position.x - part.position[0],
        position.y - part.position[1],
        position.z - part.position[2],
      ) < 1e-4 && Math.hypot(
        scale.x - part.scale[0],
        scale.y - part.scale[1],
        scale.z - part.scale[2],
      ) < 1e-4;
    }
    assert.equal(found, true, `semantic home part ${id} must exist in its declared GPU pool`);
  }

  const homeBlockers = city.blockers.filter(blocker => home.collisionIds.includes(blocker.id));
  assert.equal(homeBlockers.length, home.stats.collisionVolumes);
  assert.ok(homeBlockers.every(blocker => ["residential-wall", "residential-partition", "residential-fixture"].includes(blocker.kind)));
  assert.equal(city.isBlockedCircle(home.bounds.minX + 0.11, (home.bounds.minZ + home.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle(home.bounds.maxX - 0.11, (home.bounds.minZ + home.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle((home.bounds.minX + home.bounds.maxX) * 0.5, home.bounds.maxZ - 0.11, 0.20), true);
  for (const doorway of Object.values(home.doorways)) {
    assert.ok(doorway.clearWidth >= 0.98, doorway);
    assert.equal(city.isBlockedCircle(doorway.position[0], doorway.position[2], 0.38), false, doorway);
  }

  const navigationPoints = [
    home.entrance.exterior,
    home.entrance.threshold,
    home.entrance.interior,
    ...Object.values(home.doorways).map(doorway => doorway.position),
    ...Object.values(home.zones).map(zone => zone.position),
    ...Object.values(home.interactionAnchors),
    ...Object.values(home.stations).map(station => station.position),
    ...Object.values(home.spawnPoints).map(entry => entry.position),
  ];
  for (const point of navigationPoints) {
    assert.equal(city.isBlockedCircle(point[0], point[2], 0.38), false, point);
    assert.ok(city.pedestrianNodes.some(node =>
      Math.hypot(node[0] - point[0], node[2] - point[2]) < 0.011 && Math.abs(node[1] - point[1]) < 0.011),
    `missing collision-safe residential navigation node ${point}`);
  }

  // Flood the actual player-circle collision field from the exterior. This
  // proves the front threshold and both interior door gaps are connected; a
  // list of individually clear teleport anchors would be weaker evidence.
  const floodStep = 0.18;
  const floodStart = home.entrance.exterior;
  const minX = home.bounds.minX - 1.7;
  const maxX = home.bounds.maxX + 1.7;
  const minZ = home.bounds.minZ - 1.8;
  const maxZ = home.bounds.maxZ + 0.6;
  const queue = [[0, 0]];
  const visited = new Set(["0:0"]);
  const visitedPoints = [[floodStart[0], floodStart[2]]];
  for (let cursor = 0; cursor < queue.length; ++cursor) {
    const [ix, iz] = queue[cursor];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx;
      const nz = iz + dz;
      const key = `${nx}:${nz}`;
      if (visited.has(key)) continue;
      const x = floodStart[0] + nx * floodStep;
      const z = floodStart[2] + nz * floodStep;
      if (x < minX || x > maxX || z < minZ || z > maxZ || city.isBlockedCircle(x, z, 0.38)) continue;
      visited.add(key);
      queue.push([nx, nz]);
      visitedPoints.push([x, z]);
    }
  }
  assert.ok(visitedPoints.length >= 4_000, `unexpectedly small home navigation flood: ${visitedPoints.length}`);
  for (const target of [
    home.entrance.interior,
    ...Object.values(home.zones).map(zone => zone.position),
    ...Object.values(home.stations).map(station => station.position),
  ]) {
    assert.ok(visitedPoints.some(([x, z]) => Math.hypot(x - target[0], z - target[2]) <= floodStep * 1.45),
      `exterior player path cannot reach ${target}`);
  }

  let walker = new THREE.Vector3(...home.entrance.exterior);
  for (let step = 0; step < 8; ++step) {
    walker = city.resolveCircleMotion(walker, new THREE.Vector3(0, 0, 0.48), 0.38);
    walker.y = city.terrainHeight(walker.x, walker.z);
  }
  assert.ok(walker.z > home.entrance.interior[2] + 0.35, walker,
    "normal resolved movement must cross the exterior threshold without teleporting");
  const floorSample = city.sampleGround(home.zones.living.position[0], home.zones.living.position[2]);
  assert.equal(floorSample.height, home.bounds.floorY);
  assert.equal(floorSample.surfaceId, "southline-studio-floor");
  assert.equal(floorSample.districtId, "westside");

  const homeLights = city.staticLights.filter(light => light.userData.practicalKind === "residential-interior");
  assert.equal(homeLights.length, 1);
  assert.equal(homeLights[0].name, "Southline Studio bounded warm practical");
  assert.equal(homeLights[0].userData.homeId, home.homeId);
  assert.equal(homeLights[0].userData.bounded, true);
  assert.equal(homeLights[0].castShadow, false);
  city.setTimeOfDay(12);
  city.update(0.1, new THREE.Vector3(...home.zones.living.position));
  assert.ok(homeLights[0].intensity > 7,
    "the bounded domestic practical should remain readable while the player is inside during daylight");
  city.update(0.2, new THREE.Vector3(0, 0, 0));
  assert.ok(homeLights[0].intensity < 0.1,
    "the domestic practical must not spill through the city when the player leaves at noon");
  assert.equal(city.stats.staticLights, 82,
    "Mina's Market adds only its two focus-bounded back-room practicals");
  assert.equal(city.stats.instancedMeshes, 64,
    "the furnished apartment must not create a 65th resident draw batch");
  assert.equal(city.stats.instances, 5_858);
  assert.ok(city.stats.instances <= 5_900, city.stats);

  const variant = buildCity(new THREE.Scene(), { seed: CITY_SEED + 1 });
  try {
    assert.equal(variant.residentialInterior.id, home.id);
    assert.equal(variant.residentialInterior.seed, ((CITY_SEED + 1) ^ 0x484f4d45) >>> 0);
    assert.notDeepEqual(variant.residentialInterior.variant, home.variant,
      "a new city seed should produce a stable but visibly distinct furnishing palette");
    assert.equal(variant.residentialInterior.stats.renderInstances, home.stats.renderInstances);
    assert.equal(variant.stats.instancedMeshes, city.stats.instancedMeshes);
  } finally {
    variant.dispose();
  }
}));

test("Harbour Skills House is a seeded, furnished and seamlessly walkable public life-sim interior", () => withCity(city => {
  const hub = city.communityHub;
  assert.ok(hub);
  assertDeepFrozen(hub);
  assert.equal(hub.id, "harbour-skills-house");
  assert.equal(hub.buildingId, "harbour-skills-house-building");
  assert.equal(hub.label, "HARBOUR SKILLS HOUSE");
  assert.equal(hub.address, "42 Mariner Walk");
  assert.equal(hub.districtId, "harbour-mile");
  assert.equal(hub.seed, (CITY_SEED ^ 0x534b494c) >>> 0);
  assert.ok(hub.bounds.maxX - hub.bounds.minX >= 19, hub.bounds);
  assert.ok(hub.bounds.maxZ - hub.bounds.minZ >= 24, hub.bounds);
  assert.ok(hub.bounds.ceilingY - hub.bounds.floorY >= 3.3, hub.bounds);

  const host = city.buildings.find(building => building.id === hub.hostBuildingRecordId);
  assert.ok(host, "the public interior must retain its original skyline host");
  assert.equal(host.physicalInterior, hub.id);
  assert.equal(host.propertyBuildingId, hub.buildingId);
  assert.equal(host.storefront, true, "the opened ground floor remains a real occupied public frontage");
  assert.equal(city.blockers.some(blocker => blocker.id === host.id), false,
    "a whole-building AABB would make the public rooms impossible to enter");

  assert.deepEqual(Object.keys(hub.zones), ["reception", "kitchen", "workshop", "classroom", "breakRoom"]);
  assert.equal(new Set(Object.values(hub.zones).map(zone => zone.label)).size, 5);
  for (const zone of Object.values(hub.zones)) {
    assert.ok(zone.position[0] >= zone.bounds.minX && zone.position[0] <= zone.bounds.maxX, zone);
    assert.ok(zone.position[2] >= zone.bounds.minZ && zone.position[2] <= zone.bounds.maxZ, zone);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(hub.stations).map(([id, station]) => [id, station.action])), {
    reception: "check_in",
    kitchenPrep: "prepare_meal",
    kitchenServe: "serve_meal",
    kitchenClean: "clean_kitchen",
    repairIntake: "intake_repair",
    repairBench: "repair",
    classroom: "learn",
    photoDesk: "photography",
    breakArea: "rest",
  });
  assert.deepEqual(hub.spawnPoints.staff.map(spawnPoint => spawnPoint.role),
    ["reception", "kitchen", "repair", "teacher"]);
  assert.equal(hub.stats.rooms, 5);
  assert.equal(hub.stats.doorways, 5);
  assert.equal(hub.stats.stations, 9);
  assert.equal(hub.stats.publicSpawns, 3);
  assert.equal(hub.stats.staffSpawns, 4);
  assert.equal(hub.stats.renderInstances, 81);
  assert.equal(hub.stats.glassPanels, 2);
  assert.equal(hub.stats.collisionVolumes, 27);
  assert.equal(hub.stats.practicalLights, 2);
  assert.equal(hub.stats.emissiveMaterials, 0);
  assert.equal(hub.renderParts.length, hub.stats.renderInstances);
  assert.equal(new Set(hub.renderParts.map(part => part.id)).size, hub.renderParts.length,
    "every public-interior part needs a stable semantic identity");
  assert.ok(hub.renderParts.every(part => part.scale.every(value => Number.isFinite(value) && value > 0)));
  assert.ok(hub.renderParts.every(part => !part.batch.toLowerCase().includes("neon")),
    "ordinary public rooms must not borrow a neon-sign material batch");
  assert.deepEqual(hub.glass, {
    kind: "dark-neutral-public-glazing",
    panels: 2,
    emissive: false,
    neon: false,
  });

  const requiredParts = [
    "hub-floor", "hub-ceiling", "hub-door-lintel", "hub-west-dark-glass",
    "hub-reception-desk-base", "hub-kitchen-hob", "hub-kitchen-sink",
    "hub-serving-counter-top", "hub-repair-workbench", "hub-repair-pegboard",
    "hub-class-table-1", "hub-photo-camera", "hub-break-sofa-seat",
    "hub-staff-lockers", "hub-classroom-ceiling-practical",
  ];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const id of requiredParts) {
    const part = hub.renderParts.find(candidate => candidate.id === id);
    assert.ok(part, `missing authored community part ${id}`);
    const mesh = city.root.getObjectByName(part.batch);
    assert.ok(mesh?.isInstancedMesh, `missing preallocated resident pool ${part.batch}`);
    let found = false;
    for (let index = 0; index < mesh.count && !found; ++index) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      found = Math.hypot(
        position.x - part.position[0],
        position.y - part.position[1],
        position.z - part.position[2],
      ) < 1e-4 && Math.hypot(
        scale.x - part.scale[0],
        scale.y - part.scale[1],
        scale.z - part.scale[2],
      ) < 1e-4;
    }
    assert.equal(found, true, `semantic public-interior part ${id} must exist in its declared GPU pool`);
  }

  const hubBlockers = city.blockers.filter(blocker => hub.collisionIds.includes(blocker.id));
  assert.equal(hubBlockers.length, hub.stats.collisionVolumes);
  assert.ok(hubBlockers.every(blocker =>
    ["community-wall", "community-partition", "community-fixture"].includes(blocker.kind)));
  assert.equal(city.isBlockedCircle(hub.bounds.minX + 0.11, (hub.bounds.minZ + hub.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle(hub.bounds.maxX - 0.11, (hub.bounds.minZ + hub.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle((hub.bounds.minX + hub.bounds.maxX) * 0.5, hub.bounds.maxZ - 0.11, 0.20), true);
  for (const doorway of Object.values(hub.doorways)) {
    assert.ok(doorway.clearWidth >= 1.30, doorway);
    assert.equal(city.isBlockedCircle(doorway.position[0], doorway.position[2], 0.38), false, doorway);
  }

  const navigationPoints = [
    hub.entrance.exterior,
    hub.entrance.threshold,
    hub.entrance.interior,
    ...Object.values(hub.doorways).map(doorway => doorway.position),
    ...Object.values(hub.zones).map(zone => zone.position),
    ...Object.values(hub.stations).map(station => station.position),
    ...hub.navigationNodes,
    ...hub.spawnPoints.public.map(spawnPoint => spawnPoint.position),
    ...hub.spawnPoints.staff.map(spawnPoint => spawnPoint.position),
  ];
  for (const point of navigationPoints) {
    assert.equal(city.isBlockedCircle(point[0], point[2], 0.38), false, point);
    assert.ok(city.pedestrianNodes.some(node =>
      Math.hypot(node[0] - point[0], node[2] - point[2]) < 0.011 && Math.abs(node[1] - point[1]) < 0.011),
    `missing collision-safe public-interior navigation node ${point}`);
  }

  // Flood the exact player collision field from the public sidewalk. This
  // proves every named room, fixture and staff position is connected through
  // the real front threshold and partition door gaps without teleporting.
  const floodStep = 0.18;
  const floodStart = hub.entrance.exterior;
  const minX = hub.bounds.minX - 1.8;
  const maxX = hub.bounds.maxX + 1.8;
  const minZ = hub.bounds.minZ - 2.0;
  const maxZ = hub.bounds.maxZ + 0.7;
  const queue = [[0, 0]];
  const visited = new Set(["0:0"]);
  const visitedPoints = [[floodStart[0], floodStart[2]]];
  for (let cursor = 0; cursor < queue.length; ++cursor) {
    const [ix, iz] = queue[cursor];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx;
      const nz = iz + dz;
      const key = `${nx}:${nz}`;
      if (visited.has(key)) continue;
      const x = floodStart[0] + nx * floodStep;
      const z = floodStart[2] + nz * floodStep;
      if (x < minX || x > maxX || z < minZ || z > maxZ || city.isBlockedCircle(x, z, 0.38)) continue;
      visited.add(key);
      queue.push([nx, nz]);
      visitedPoints.push([x, z]);
    }
  }
  assert.ok(visitedPoints.length >= 12_000, `unexpectedly small public-interior navigation flood: ${visitedPoints.length}`);
  for (const target of navigationPoints.slice(2)) {
    assert.ok(visitedPoints.some(([x, z]) => Math.hypot(x - target[0], z - target[2]) <= floodStep * 1.45),
      `public sidewalk path cannot reach ${target}`);
  }

  // The classroom tables intentionally block a straight doorway-to-photo-
  // desk line. Prove the actual 0.43 m player collider can use the open east
  // aisle and then cross the clear north end of the classroom to the desk.
  const photoDesk = hub.stations.photoDesk.position;
  const classroom = hub.zones.classroom;
  const photoRoute = [
    [classroom.bounds.maxX - 1.10, hub.bounds.floorY, photoDesk[2] - 0.45],
    photoDesk,
  ];
  let photoWalker = new THREE.Vector3(...classroom.position);
  for (const target of photoRoute) {
    for (let step = 0; step < 240; ++step) {
      const dx = target[0] - photoWalker.x;
      const dz = target[2] - photoWalker.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 0.62) break;
      const stride = Math.min(0.12, distance);
      photoWalker = city.resolveCircleMotion(photoWalker,
        new THREE.Vector3(dx / distance * stride, 0, dz / distance * stride), 0.43);
    }
    assert.ok(Math.hypot(photoWalker.x - target[0], photoWalker.z - target[2]) <= 0.72,
      `player collider could not follow the classroom photo-desk aisle to ${target}`);
  }
  assert.equal(city.isBlockedCircle(photoWalker.x, photoWalker.z, 0.43), false);

  let walker = new THREE.Vector3(...hub.entrance.exterior);
  for (let step = 0; step < 10; ++step) {
    walker = city.resolveCircleMotion(walker, new THREE.Vector3(0, 0, 0.5), 0.38);
    walker.y = city.terrainHeight(walker.x, walker.z);
  }
  assert.ok(walker.z > hub.entrance.interior[2] + 1.8, walker,
    "normal resolved player movement must cross the public threshold without a loading transition");
  const floorSample = city.sampleGround(hub.zones.classroom.position[0], hub.zones.classroom.position[2]);
  assert.equal(floorSample.height, hub.bounds.floorY);
  assert.equal(floorSample.surfaceId, "harbour-skills-house-floor");
  assert.equal(floorSample.districtId, "harbour-mile");

  const hubLights = city.staticLights.filter(light => light.userData.practicalKind === "community-hub-interior");
  assert.equal(hubLights.length, 2);
  assert.ok(hubLights.every(light => light.userData.hubId === hub.id && light.userData.bounded === true));
  assert.ok(hubLights.every(light => light.castShadow === false));
  city.setTimeOfDay(12);
  city.update(0.1, new THREE.Vector3(...hub.zones.kitchen.position));
  assert.ok(hubLights.every(light => light.intensity > 11),
    "focus-bounded public practicals remain readable during daytime classes");
  city.update(0.2, new THREE.Vector3(0, 0, 0));
  assert.ok(hubLights.every(light => light.intensity < 0.2),
    "public practicals must not leak through the city when the player leaves at noon");
  assert.equal(city.stats.staticLights, 82,
    "the Skills House remains reallocated while Mina's Market adds two bounded room lights");
  assert.equal(city.stats.instancedMeshes, 64,
    "the public rooms must append to resident batches instead of creating a 65th draw");
  assert.equal(city.stats.instances, 5_858);
  assert.ok(city.stats.instances <= 5_900, city.stats);

  const variant = buildCity(new THREE.Scene(), { seed: CITY_SEED + 1 });
  try {
    assert.equal(variant.communityHub.id, hub.id);
    assert.equal(variant.communityHub.seed, ((CITY_SEED + 1) ^ 0x534b494c) >>> 0);
    assert.notDeepEqual(variant.communityHub.variant, hub.variant,
      "a new city seed should produce a stable but visibly distinct public-room arrangement");
    assert.equal(variant.communityHub.stats.renderInstances, hub.stats.renderInstances);
    assert.equal(variant.communityHub.stats.collisionVolumes, hub.stats.collisionVolumes);
    assert.equal(variant.stats.instancedMeshes, city.stats.instancedMeshes);
  } finally {
    variant.dispose();
  }
}));

test("Common Ground Cafe is a seeded seamless workplace with reachable public and back rooms", () => withCity(city => {
  const cafe = city.commonGroundCafe;
  assert.ok(cafe);
  assertDeepFrozen(cafe);
  assert.equal(cafe.id, "common_ground_cafe");
  assert.equal(cafe.businessId, "common_ground_cafe");
  assert.equal(cafe.buildingId, "common-ground-cafe-building");
  assert.equal(cafe.label, "COMMON GROUND CAFE");
  assert.equal(cafe.address, "16 Common Ground Lane");
  assert.equal(cafe.districtId, "pulse-core");
  assert.equal(cafe.seed, (CITY_SEED ^ 0x43414645) >>> 0);
  assert.equal(cafe.entrance.transition, "continuous-world");
  assert.equal(cafe.entrance.loading, false);
  assert.equal(cafe.entrance.teleport, false);
  assert.ok(cafe.entrance.clearWidth >= 1.60);
  assert.ok(cafe.bounds.maxX - cafe.bounds.minX >= 25);
  assert.ok(cafe.bounds.maxZ - cafe.bounds.minZ >= 26);
  assert.ok(cafe.bounds.ceilingY - cafe.bounds.floorY >= 3.3);

  const host = city.buildings.find(building => building.id === cafe.hostBuildingRecordId);
  assert.ok(host, "the cafe must retain its original tower host");
  assert.equal(host.physicalInterior, cafe.id);
  assert.equal(host.propertyBuildingId, cafe.buildingId);
  assert.equal(host.storefront, true);
  assert.equal(host.streetLevelPlinthHeight, 0);
  assert.equal(city.blockers.some(blocker => blocker.id === host.id), false,
    "the old whole-tower collider would make the cafe impossible to enter");
  assert.equal(city.blockers.some(blocker => blocker.id === "open-doors-common_ground_cafe-counter"), false,
    "the detached nine-piece frontage must not overlap the real cafe");

  const business = city.businesses.find(entry => entry.id === cafe.businessId);
  const frontage = city.businessFrontages.find(entry => entry.id === cafe.businessId);
  assert.ok(business && frontage);
  assert.equal(business.position, cafe.entrance.exterior);
  assert.equal(business.keeperPosition, cafe.keeperAnchor);
  assert.equal(business.physicalInteriorId, cafe.id);
  assert.equal(business.buildingId, cafe.buildingId);
  assert.equal(frontage.interactionPosition, cafe.entrance.exterior);
  assert.equal(frontage.practicalPosition, cafe.lighting.position);
  assert.equal(frontage.physicalInteriorId, cafe.id);
  assert.equal(frontage.kind, "walk-in-cafe");

  assert.deepEqual(Object.keys(cafe.zones), [
    "dining", "service", "kitchen", "dishes", "stock", "staffNook", "toilet",
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(cafe.stations).map(([key, station]) => [key, station.action])), {
    handover: "clock_in",
    till: "take_order",
    prep: "prepare_order",
    serve: "serve_order",
    dishes: "wash_dishes",
    stock: "restock",
    break: "take_break",
    customerTable1: "sit",
    customerTable2: "sit",
  });
  assert.deepEqual(Object.fromEntries(Object.entries(cafe.jobAnchors).map(([key, position]) =>
    [key, cafe.stations[key].position === position])), {
    handover: true, till: true, prep: true, serve: true, dishes: true, stock: true, break: true,
  });
  assert.deepEqual(cafe.spawnPoints.staff.map(entry => entry.role), ["manager", "barista", "kitchen"]);
  assert.equal(cafe.spawnPoints.staff[0].position, cafe.keeperAnchor);
  assert.equal(cafe.customerAnchors.queue.length, 3);
  assert.equal(cafe.customerAnchors.seating.length, 4);
  assert.equal(cafe.spawnPoints.customers.length, 4);
  assert.equal(city.chapterTwo.leahAnchor, cafe.customerAnchors.story.leah);
  assert.equal(city.chapterTwo.leahInteractionAnchor, cafe.customerAnchors.story.interaction);

  assert.deepEqual(cafe.glass, {
    kind: "dark-neutral-ordinary-glazing",
    panels: 4,
    emissive: false,
    neon: false,
  });
  assert.deepEqual(cafe.renderBudget, {
    geometriesAdded: 0,
    materialsAdded: 0,
    instancedBatchesAdded: 0,
    lightsAdded: 0,
  });
  assert.equal(cafe.stats.rooms, 7);
  assert.equal(cafe.stats.doorways, 6);
  assert.equal(cafe.stats.stations, 9);
  assert.equal(cafe.stats.customerSpawns, 4);
  assert.equal(cafe.stats.staffSpawns, 3);
  assert.equal(cafe.stats.renderInstances, 96);
  assert.equal(cafe.stats.frontageRenderInstances, 18);
  assert.equal(cafe.stats.glassPanels, 4);
  assert.equal(cafe.stats.collisionVolumes, 30);
  assert.equal(cafe.stats.practicalLights, 1);
  assert.equal(cafe.stats.emissiveMaterials, 0);
  assert.ok(Object.values(cafe.stats).every(value => Number.isFinite(value) && value >= 0), cafe.stats);
  assert.equal(cafe.renderParts.length, cafe.stats.renderInstances);
  assert.equal(new Set(cafe.renderParts.map(part => part.id)).size, cafe.renderParts.length);
  assert.equal(cafe.frontagePartIds.length, cafe.stats.frontageRenderInstances);
  assert.ok(cafe.frontagePartIds.every(id => cafe.renderParts.some(part => part.id === id)));
  assert.ok(cafe.renderParts.every(part => part.position.every(Number.isFinite) &&
    part.scale.every(value => Number.isFinite(value) && value > 0) &&
    part.rotation.every(Number.isFinite)));
  assert.ok(cafe.renderParts.every(part => !part.batch.toLowerCase().includes("neon")),
    "an ordinary cafe must not borrow neon-sign materials");

  const requiredParts = [
    "cafe-floor", "cafe-ceiling", "cafe-front-door-lintel", "cafe-front-dark-glass-1",
    "cafe-awning", "cafe-banquette-seat", "cafe-service-counter-top", "cafe-pos-terminal",
    "cafe-espresso-machine", "cafe-kitchen-hob", "cafe-prep-island-worktop", "cafe-double-sink",
    "cafe-dishwasher", "cafe-stock-shelf-2", "cafe-staff-lockers", "cafe-toilet-base",
  ];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const id of requiredParts) {
    const part = cafe.renderParts.find(candidate => candidate.id === id);
    assert.ok(part, `missing authored cafe part ${id}`);
    const mesh = city.root.getObjectByName(part.batch);
    assert.ok(mesh?.isInstancedMesh, `missing resident cafe pool ${part.batch}`);
    let found = false;
    for (let index = 0; index < mesh.count && !found; ++index) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      found = Math.hypot(position.x - part.position[0], position.y - part.position[1],
        position.z - part.position[2]) < 1e-4 &&
        Math.hypot(scale.x - part.scale[0], scale.y - part.scale[1],
          scale.z - part.scale[2]) < 1e-4;
    }
    assert.equal(found, true, `semantic cafe part ${id} must exist in its declared GPU pool`);
  }

  const cafeBlockers = city.blockers.filter(blocker => cafe.collisionIds.includes(blocker.id));
  assert.equal(cafeBlockers.length, cafe.stats.collisionVolumes);
  assert.ok(cafeBlockers.every(blocker => ["cafe-wall", "cafe-partition", "cafe-fixture"].includes(blocker.kind)));
  assert.equal(city.isBlockedCircle(cafe.bounds.minX + 0.11,
    (cafe.bounds.minZ + cafe.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle(cafe.bounds.maxX - 0.11,
    (cafe.bounds.minZ + cafe.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle((cafe.bounds.minX + cafe.bounds.maxX) * 0.5,
    cafe.bounds.maxZ - 0.11, 0.20), true);
  for (const doorway of Object.values(cafe.doorways)) {
    assert.ok(doorway.clearWidth >= 1.08, doorway);
    assert.equal(city.isBlockedCircle(doorway.position[0], doorway.position[2], 0.38), false, doorway);
  }

  const navigationPoints = [
    cafe.entrance.exterior,
    cafe.entrance.threshold,
    cafe.entrance.interior,
    cafe.keeperAnchor,
    ...Object.values(cafe.doorways).map(doorway => doorway.position),
    ...Object.values(cafe.zones).map(zone => zone.position),
    ...Object.values(cafe.stations).map(station => station.position),
    ...Object.values(cafe.jobAnchors),
    ...cafe.customerAnchors.queue,
    cafe.customerAnchors.pickup,
    ...cafe.customerAnchors.seating,
    cafe.customerAnchors.story.leah,
    cafe.customerAnchors.story.interaction,
    ...cafe.navigationNodes,
    ...cafe.spawnPoints.customers.map(entry => entry.position),
    ...cafe.spawnPoints.staff.map(entry => entry.position),
  ];
  for (const point of navigationPoints) {
    assert.ok(point.every(Number.isFinite), point);
    assert.equal(city.isBlockedCircle(point[0], point[2], 0.38), false, point);
    assert.ok(city.pedestrianNodes.some(node =>
      Math.hypot(node[0] - point[0], node[2] - point[2]) < 0.011 &&
      Math.abs(node[1] - point[1]) < 0.011), `missing grounded cafe navigation node ${point}`);
  }

  // Flood the exact Kai-radius collision field from the public pavement. The
  // flood must reach every room, keeper/customer spawn and job station; clear
  // teleport markers alone would not establish a seamless walk-in building.
  const floodStep = 0.18;
  const floodStart = cafe.entrance.exterior;
  const minX = cafe.bounds.minX - 2.0;
  const maxX = cafe.bounds.maxX + 2.0;
  const minZ = cafe.bounds.minZ - 4.0;
  const maxZ = cafe.bounds.maxZ + 0.7;
  const queue = [[0, 0]];
  const visited = new Set(["0:0"]);
  const visitedPoints = [[floodStart[0], floodStart[2]]];
  for (let cursor = 0; cursor < queue.length; ++cursor) {
    const [ix, iz] = queue[cursor];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx;
      const nz = iz + dz;
      const key = `${nx}:${nz}`;
      if (visited.has(key)) continue;
      const x = floodStart[0] + nx * floodStep;
      const z = floodStart[2] + nz * floodStep;
      if (x < minX || x > maxX || z < minZ || z > maxZ || city.isBlockedCircle(x, z, 0.38)) continue;
      visited.add(key);
      queue.push([nx, nz]);
      visitedPoints.push([x, z]);
    }
  }
  assert.ok(visitedPoints.length >= 20_000, `unexpectedly small cafe navigation flood: ${visitedPoints.length}`);
  for (const target of navigationPoints.slice(2)) {
    assert.ok(visitedPoints.some(([x, z]) => Math.hypot(x - target[0], z - target[2]) <= floodStep * 1.45),
      `public pavement path cannot reach cafe point ${target}`);
  }

  let walker = new THREE.Vector3(...cafe.entrance.exterior);
  for (let step = 0; step < 12; ++step) {
    walker = city.resolveCircleMotion(walker, new THREE.Vector3(0, 0, 0.5), 0.38);
    walker.y = city.terrainHeight(walker.x, walker.z);
  }
  assert.ok(walker.z > cafe.entrance.interior[2] + 0.9, walker,
    "normal resolved movement must cross the cafe threshold without teleporting");
  const floorSample = city.sampleGround(cafe.zones.kitchen.position[0], cafe.zones.kitchen.position[2]);
  assert.equal(floorSample.height, cafe.bounds.floorY);
  assert.equal(floorSample.surfaceId, "common-ground-cafe-floor");
  assert.equal(floorSample.districtId, cafe.districtId);

  const cafeLights = city.staticLights.filter(light => light.userData.cafeId === cafe.id);
  assert.equal(cafeLights.length, 1);
  assert.equal(cafeLights[0].name, "Common Ground Cafe bounded warm practical");
  assert.equal(cafeLights[0].userData.businessId, cafe.businessId);
  assert.equal(cafeLights[0].userData.physicalInterior, true);
  assert.equal(cafeLights[0].userData.bounded, true);
  assert.equal(cafeLights[0].castShadow, false);
  city.setBusinessOpenStates([{ id: cafe.businessId, open: true }]);
  city.setTimeOfDay(12);
  city.update(0.1, new THREE.Vector3(...cafe.zones.kitchen.position));
  assert.ok(cafeLights[0].intensity > 42,
    "the bounded cafe practical should remain readable while an open daytime shift is active");
  city.update(0.2, new THREE.Vector3(0, 0, 0));
  assert.ok(cafeLights[0].intensity < 0.1,
    "the cafe practical must not spill through the city when Kai leaves at noon");

  assert.equal(city.stats.commonGroundCafe, true);
  assert.equal(city.stats.commonGroundCafeInstances, cafe.stats.renderInstances);
  assert.equal(city.stats.commonGroundCafeCollisionVolumes, cafe.stats.collisionVolumes);
  assert.equal(city.stats.commonGroundCafeRooms, cafe.stats.rooms);
  assert.equal(city.stats.commonGroundCafeStations, cafe.stats.stations);
  assert.equal(city.stats.commonGroundCafePracticalLights, 1);
  assert.equal(city.stats.instancedMeshes, 64,
    "the cafe must append to existing resident batches instead of creating a 65th draw");
  assert.equal(city.stats.staticLights, 82,
    "the cafe still reuses its practical; only Mina's two bounded back-room lights grow the pool");
  assert.equal(city.stats.instances, 5_858);
  assert.ok(city.stats.instances <= 5_900, city.stats);

  const variant = buildCity(new THREE.Scene(), { seed: CITY_SEED + 1 });
  try {
    assert.equal(variant.commonGroundCafe.id, cafe.id);
    assert.equal(variant.commonGroundCafe.seed, ((CITY_SEED + 1) ^ 0x43414645) >>> 0);
    assert.notDeepEqual(variant.commonGroundCafe.variant, cafe.variant,
      "a different city seed should keep the plan but vary the cafe furnishing details");
    assert.equal(variant.commonGroundCafe.stats.renderInstances, cafe.stats.renderInstances);
    assert.equal(variant.commonGroundCafe.stats.collisionVolumes, cafe.stats.collisionVolumes);
    assert.equal(variant.stats.instancedMeshes, city.stats.instancedMeshes);
    assert.ok(variant.stats.staticLights <= city.stats.staticLights,
      "variant seeds must remain inside the established bounded-light ceiling");
    assert.equal(variant.staticLights.filter(light => light.userData.cafeId === cafe.id).length, 1);
  } finally {
    variant.dispose();
  }
}));

test("Mina's Market Kitchen is a seeded occupied ground floor reached through the retained arcade gap", () => withCity(city => {
  const market = city.minaMarketKitchen;
  assert.ok(market);
  assertDeepFrozen(market);
  assert.equal(market.id, "mina_market_kitchen");
  assert.equal(market.businessId, "mina_market_kitchen");
  assert.equal(market.buildingId, "mina-market-building");
  assert.equal(market.label, "MINA'S MARKET KITCHEN");
  assert.equal(market.address, "84 Market Street");
  assert.equal(market.districtId, "north-market");
  assert.equal(market.seed, (CITY_SEED ^ 0x4d494e41) >>> 0);
  assert.deepEqual(market.openingHours, { opens: 7, closes: 21 });
  assert.equal(market.entrance.transition, "continuous-world");
  assert.equal(market.entrance.loading, false);
  assert.equal(market.entrance.teleport, false);
  assert.deepEqual(market.entrance.street, [-144, 0.2, 127.7]);
  assert.deepEqual(market.entrance.arcadeGap, [-144, 0.2, 130.6]);
  assert.deepEqual(market.entrance.apron, [-144, 0.2, 132.2]);
  assert.deepEqual(market.entrance.exterior, market.entrance.apron);
  assert.equal(market.entrance.clearWidth, 1.72);
  assert.deepEqual(market.entrance.arcadeGapBounds, { minX: -145.14, maxX: -142.86, width: 2.28 });

  const host = city.buildings.find(building => building.id === market.hostBuildingRecordId);
  assert.ok(host, "Mina's occupied market must retain the original North Market tower record");
  assert.equal(host.id, "building-009");
  assert.deepEqual(host.position, [-144.14720055852086, 0.2, 144.72307274038903]);
  assert.deepEqual(host.size, [26.60089847818017, 47.83504267461392, 20.027916694059968]);
  assert.equal(host.style, 3);
  assert.equal(host.physicalInterior, market.id);
  assert.equal(host.propertyBuildingId, market.buildingId);
  assert.equal(host.storefront, true);
  assert.equal(host.streetLevelPlinthHeight, 0);
  assert.equal(market.bounds.minX, host.position[0] - host.size[0] * 0.5);
  assert.equal(market.bounds.maxX, host.position[0] + host.size[0] * 0.5);
  assert.equal(market.bounds.minZ, host.position[2] - host.size[2] * 0.5);
  assert.equal(market.bounds.maxZ, host.position[2] + host.size[2] * 0.5);
  assert.ok(market.bounds.ceilingY - market.bounds.floorY >= 3.4);
  assert.equal(city.blockers.some(blocker => blocker.id === host.id), false,
    "the former whole-tower AABB would make Mina's ground floor impossible to enter");

  const business = city.businesses.find(entry => entry.id === market.businessId);
  assert.ok(business);
  assert.equal(business.position, market.entrance.street);
  assert.equal(business.interactionPosition, market.stations.orderCounter.position);
  assert.equal(business.keeperPosition, market.keeperAnchor);
  assert.equal(business.arcadeStallPosition, city.northMarket.visitorAnchors[1]);
  assert.equal(business.arcadeKeeperPosition, city.northMarket.businessAnchors[1]);
  assert.equal(business.physicalInteriorId, market.id);
  assert.equal(business.buildingId, market.buildingId);
  assert.equal(city.northMarket.openHours, market.openingHours,
    "the arcade, business menu and interior practicals must agree on 07:00–21:00");

  assert.equal(market.arcade.id, city.northMarket.id);
  assert.deepEqual(market.arcade.retainedStallIds, [
    "north-market-stall-1-counter",
    "north-market-stall-2-counter",
    "north-market-stall-3-counter",
    "north-market-stall-4-counter",
  ]);
  const retainedStalls = market.arcade.retainedStallIds.map(id =>
    city.blockers.find(blocker => blocker.id === id));
  assert.ok(retainedStalls.every(Boolean), "all four outdoor stall blockers must survive the interior conversion");
  assert.ok(retainedStalls.every(blocker => blocker.kind === "market-stall"));
  const stallTwo = retainedStalls[1];
  const stallThree = retainedStalls[2];
  const gapMinX = stallTwo.center[0] + stallTwo.halfExtents[0];
  const gapMaxX = stallThree.center[0] - stallThree.halfExtents[0];
  assert.ok(Math.abs(gapMinX - market.entrance.arcadeGapBounds.minX) < 1e-9);
  assert.ok(Math.abs(gapMaxX - market.entrance.arcadeGapBounds.maxX) < 1e-9);
  assert.ok(Math.abs(gapMaxX - gapMinX - 2.28) < 1e-9);
  assert.ok(market.entrance.arcadeGap[0] - 0.38 > gapMinX &&
    market.entrance.arcadeGap[0] + 0.38 < gapMaxX,
  "Kai's full 0.76 m collision diameter must have generous clearance through the retained counters");

  assert.deepEqual(Object.keys(market.zones), [
    "vestibule", "salesFloor", "deliCheckout", "prepKitchen",
    "washUp", "stockReceiving", "staffNook", "toilet",
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(market.stations).map(([key, station]) =>
    [key, [station.id, station.action]])), {
    groceryCheckout: ["mina-grocery-checkout", "buy_groceries"],
    orderCounter: ["mina-order-counter", "open_menu"],
    produceScale: ["mina-produce-scale", "weigh_produce"],
    coldCase: ["mina-cold-case", "browse_groceries"],
    pantryShelf: ["mina-pantry-shelf", "stock_shelves"],
    kitchenPrep: ["mina-kitchen-prep", "prepare_food"],
    dishSink: ["mina-dish-sink", "wash_dishes"],
    packingBench: ["mina-packing-bench", "pack_groceries"],
  });
  assert.equal(market.stations.groceryCheckout.transactionKind, "household_supplies");
  assert.equal(market.stations.orderCounter.transactionKind, "prepared_food");
  assert.notEqual(market.stations.groceryCheckout.position, market.stations.orderCounter.position,
    "take-home groceries and prepared-food ordering must stay physically distinct");
  assert.ok(Object.values(market.stations).every(station =>
    market.renderParts.some(part => part.id === station.fixtureId)),
  "every market station must name a real prewarmed fixture");

  assert.deepEqual(Object.keys(market.staffAnchors), [
    "keeper", "checkout", "order", "prep", "wash", "stock", "receiving", "break",
  ]);
  assert.equal(market.staffAnchors.keeper, market.keeperAnchor);
  assert.equal(market.customerAnchors.browse.length, 4);
  assert.equal(market.customerAnchors.queue.length, 3);
  assert.equal(market.customerAnchors.seating.length, 2);
  assert.equal(market.spawnPoints.customers.length, 6);
  assert.deepEqual(market.spawnPoints.staff.map(entry => entry.role), [
    "keeper", "deli-worker", "kitchen-worker", "stock-worker",
  ]);
  assert.equal(market.spawnPoints.staff[0].position, market.keeperAnchor);

  assert.equal(market.occupancySlots.length, 13);
  assert.deepEqual(market.occupancy, { capacity: 13, staffCapacity: 4, customerCapacity: 9 });
  assert.equal(market.occupancy.capacity, market.occupancySlots.length);
  assert.equal(new Set(market.occupancySlots.map(slot => slot.id)).size, market.occupancySlots.length);
  assert.deepEqual(Object.fromEntries([...new Set(market.occupancySlots.map(slot => slot.role))].map(role => [
    role,
    market.occupancySlots.filter(slot => slot.role === role).length,
  ])), {
    keeper: 1,
    "deli-worker": 1,
    "kitchen-worker": 1,
    "stock-worker": 1,
    shopper: 7,
    customer: 2,
  });
  assert.ok(market.occupancySlots.every(slot => Object.values(market.zones).some(zone => zone.id === slot.zoneId)));
  assert.ok(market.occupancySlots.every(slot => Number.isFinite(slot.heading) && slot.position.every(Number.isFinite)));
  assert.deepEqual(market.itineraries.map(itinerary => itinerary.id), [
    "mina-market-shopper-loop", "mina-market-takeaway-loop",
    "mina-market-keeper-shift", "mina-market-stock-loop",
  ]);
  assert.ok(market.itineraries.every(itinerary => itinerary.stops.length >= 3 &&
    itinerary.stops.every(stop => stop.anchorId && stop.position.every(Number.isFinite))));

  assert.deepEqual(market.glass, {
    kind: "dark-neutral-ordinary-glazing",
    panels: 12,
    emissive: false,
    neon: false,
  });
  assert.deepEqual(market.renderBudget, {
    geometriesAdded: 0,
    materialsAdded: 0,
    instancedBatchesAdded: 0,
    lightsAdded: 2,
  });
  assert.deepEqual(market.stats, {
    rooms: 8,
    doorways: 7,
    stations: 8,
    customerSpawns: 6,
    staffSpawns: 4,
    occupancySlots: 13,
    itineraries: 4,
    renderInstances: 141,
    glassPanels: 12,
    collisionVolumes: 37,
    practicalLights: 3,
    reallocatedPracticalLights: 1,
    addedPracticalLights: 2,
    emissiveMaterials: 0,
  });
  assert.equal(market.renderParts.length, market.stats.renderInstances);
  assert.equal(new Set(market.renderParts.map(part => part.id)).size, market.renderParts.length);
  assert.ok(market.renderParts.every(part => part.position.every(Number.isFinite) &&
    part.scale.every(value => Number.isFinite(value) && value > 0) &&
    part.rotation.every(Number.isFinite)));
  assert.ok(market.renderParts.every(part => !part.batch.toLowerCase().includes("neon")),
    "an ordinary grocery and kitchen must not borrow neon-sign materials");

  const requiredParts = [
    "mina-market-floor", "mina-market-ceiling", "mina-market-front-west-glass-1",
    "mina-market-awning", "mina-market-basket-3", "mina-market-produce-bin-2-tray",
    "mina-market-produce-scale-head", "mina-market-gondola-1-shelf-2",
    "mina-market-cold-case-door-2", "mina-market-service-counter-top",
    "mina-market-deli-display-glass", "mina-market-pos-terminal", "mina-market-packing-shelf",
    "mina-market-kitchen-hob", "mina-market-kitchen-hood", "mina-market-kitchen-fridge",
    "mina-market-prep-island-worktop", "mina-market-double-sink", "mina-market-drying-rack",
    "mina-market-stock-shelf-2", "mina-market-stock-cold-cabinet",
    "mina-market-delivery-trolley-deck", "mina-market-staff-lockers",
    "mina-market-accessible-grab-rail", "mina-market-toilet-base",
  ];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const id of requiredParts) {
    const part = market.renderParts.find(candidate => candidate.id === id);
    assert.ok(part, `missing authored market part ${id}`);
    const mesh = city.root.getObjectByName(part.batch);
    assert.ok(mesh?.isInstancedMesh, `missing resident market pool ${part.batch}`);
    let found = false;
    for (let index = 0; index < mesh.count && !found; ++index) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      found = Math.hypot(position.x - part.position[0], position.y - part.position[1],
        position.z - part.position[2]) < 1e-4 &&
        Math.hypot(scale.x - part.scale[0], scale.y - part.scale[1],
          scale.z - part.scale[2]) < 1e-4;
    }
    assert.equal(found, true, `semantic market part ${id} must exist in its declared GPU pool`);
  }
  const glassBatch = city.root.getObjectByName("Pulse Street bus shelter glass");
  const brickBatch = city.root.getObjectByName("Instanced city buildings style 4");
  assert.ok(glassBatch?.isInstancedMesh && glassBatch.material.isMeshStandardNodeMaterial);
  assert.equal(glassBatch.material.transparent, true);
  assert.ok(brickBatch?.material.map && brickBatch.material.normalMap && brickBatch.material.roughnessMap,
    "Mina's retained brick shell and casework must keep the existing textured PBR response");

  const marketBlockers = city.blockers.filter(blocker => market.collisionIds.includes(blocker.id));
  assert.equal(marketBlockers.length, market.stats.collisionVolumes);
  assert.equal(new Set(market.collisionIds).size, market.collisionIds.length);
  assert.ok(marketBlockers.every(blocker =>
    ["market-wall", "market-partition", "market-fixture"].includes(blocker.kind)));
  assert.equal(city.isBlockedCircle(market.bounds.minX + 0.11,
    (market.bounds.minZ + market.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle(market.bounds.maxX - 0.11,
    (market.bounds.minZ + market.bounds.maxZ) * 0.5, 0.20), true);
  assert.equal(city.isBlockedCircle((market.bounds.minX + market.bounds.maxX) * 0.5,
    market.bounds.maxZ - 0.11, 0.20), true);
  for (const doorway of Object.values(market.doorways)) {
    assert.ok(doorway.clearWidth >= 1.08, doorway);
    assert.equal(city.isBlockedCircle(doorway.position[0], doorway.position[2], 0.38), false, doorway);
  }

  const navigationPoints = [
    market.entrance.street,
    market.entrance.arcadeGap,
    market.entrance.apron,
    market.entrance.threshold,
    market.entrance.interior,
    market.keeperAnchor,
    ...Object.values(market.doorways).map(doorway => doorway.position),
    ...Object.values(market.zones).map(zone => zone.position),
    ...Object.values(market.stations).map(station => station.position),
    ...Object.values(market.staffAnchors),
    ...market.customerAnchors.browse,
    ...market.customerAnchors.queue,
    market.customerAnchors.checkout,
    market.customerAnchors.order,
    ...market.customerAnchors.seating,
    market.customerAnchors.exit,
    ...market.navigationNodes,
    ...market.spawnPoints.customers.map(entry => entry.position),
    ...market.spawnPoints.staff.map(entry => entry.position),
    ...market.occupancySlots.map(entry => entry.position),
    ...market.itineraries.flatMap(itinerary => itinerary.stops.map(stop => stop.position)),
  ];
  for (const point of navigationPoints) {
    assert.ok(point.every(Number.isFinite), point);
    assert.equal(city.isBlockedCircle(point[0], point[2], 0.38), false, point);
    assert.ok(city.pedestrianNodes.some(node =>
      Math.hypot(node[0] - point[0], node[2] - point[2]) < 0.011 &&
      Math.abs(node[1] - point[1]) < 0.011), `missing grounded market navigation node ${point}`);
  }

  // Flood the actual Kai-radius field from the street side of the arcade. It
  // must cross the retained counter gap and reach every public/staff room,
  // station, spawn and explicit occupancy itinerary without teleporting.
  const floodStep = 0.18;
  const floodStart = market.entrance.street;
  const minX = market.bounds.minX - 2.0;
  const maxX = market.bounds.maxX + 2.0;
  const minZ = floodStart[2] - 0.8;
  const maxZ = market.bounds.maxZ + 0.7;
  const queue = [[0, 0]];
  const visited = new Set(["0:0"]);
  const visitedPoints = [[floodStart[0], floodStart[2]]];
  for (let cursor = 0; cursor < queue.length; ++cursor) {
    const [ix, iz] = queue[cursor];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx;
      const nz = iz + dz;
      const key = `${nx}:${nz}`;
      if (visited.has(key)) continue;
      const x = floodStart[0] + nx * floodStep;
      const z = floodStart[2] + nz * floodStep;
      if (x < minX || x > maxX || z < minZ || z > maxZ || city.isBlockedCircle(x, z, 0.38)) continue;
      visited.add(key);
      queue.push([nx, nz]);
      visitedPoints.push([x, z]);
    }
  }
  assert.ok(visitedPoints.length >= 18_000, `unexpectedly small Mina market flood: ${visitedPoints.length}`);
  for (const target of navigationPoints.slice(1)) {
    assert.ok(visitedPoints.some(([x, z]) => Math.hypot(x - target[0], z - target[2]) <= floodStep * 1.45),
      `street path cannot reach Mina market point ${target}`);
  }
  let walker = new THREE.Vector3(...market.entrance.street);
  for (let step = 0; step < 22; ++step) {
    walker = city.resolveCircleMotion(walker, new THREE.Vector3(0, 0, 0.5), 0.38);
    walker.y = city.terrainHeight(walker.x, walker.z);
  }
  assert.ok(walker.z > market.entrance.interior[2] + 1.0, walker,
    "resolved movement must walk from the street through the arcade gap and open market door");
  const floorSample = city.sampleGround(market.zones.prepKitchen.position[0], market.zones.prepKitchen.position[2]);
  assert.equal(floorSample.height, market.bounds.floorY);
  assert.equal(floorSample.surfaceId, "mina-market-floor");
  assert.equal(floorSample.districtId, market.districtId);

  const marketLights = city.staticLights.filter(light => light.userData.marketId === market.id);
  assert.equal(marketLights.length, 3);
  assert.deepEqual(marketLights.map(light => light.name), [
    "Mina's Market bounded practical 1",
    "Mina's Market bounded practical 2",
    "Mina's Market bounded practical 3",
  ]);
  assert.ok(marketLights.every(light => light.isPointLight && light.decay === 2 && !light.castShadow));
  assert.ok(marketLights.every(light => light.userData.businessId === market.businessId &&
    light.userData.practicalKind === "mina-market-interior" &&
    light.userData.physicalInterior === true && light.userData.bounded === true));
  city.setTimeOfDay(12);
  city.setBusinessOpenStates([{ id: market.businessId, open: true }]);
  city.update(0.1, new THREE.Vector3(...market.zones.salesFloor.position));
  assert.ok(marketLights.every(light => light.intensity > 50),
    "an open occupied market must remain readable while Kai is inside during daytime");
  city.update(0.2, new THREE.Vector3(0, 0, 0));
  assert.ok(marketLights.every(light => light.intensity < 0.1),
    "bounded market practicals must not spill across the daytime city");
  city.setBusinessOpenStates([{ id: market.businessId, open: false }]);
  city.update(0.3, new THREE.Vector3(...market.zones.salesFloor.position));
  assert.ok(marketLights.every(light => light.intensity < 0.1),
    "the complete interior light group must obey Mina's opening state");

  assert.equal(city.stats.minaMarketKitchen, true);
  assert.equal(city.stats.minaMarketKitchenInstances, market.stats.renderInstances);
  assert.equal(city.stats.minaMarketKitchenCollisionVolumes, market.stats.collisionVolumes);
  assert.equal(city.stats.minaMarketKitchenRooms, market.stats.rooms);
  assert.equal(city.stats.minaMarketKitchenStations, market.stats.stations);
  assert.equal(city.stats.minaMarketKitchenOccupancySlots, market.stats.occupancySlots);
  assert.equal(city.stats.minaMarketKitchenItineraries, market.stats.itineraries);
  assert.equal(city.stats.minaMarketKitchenPracticalLights, market.stats.practicalLights);
  assert.equal(city.stats.instancedMeshes, 64);
  assert.equal(city.stats.instances, 5_858);
  assert.equal(city.stats.staticLights, 82);
  assert.equal(city.stats.windowBanks, 1_912);
  assert.equal(city.stats.groundFloorInteriorBanks, 224);
  assert.equal(city.stats.streetLevelPlinths, 44);
  assert.ok(city.stats.instances <= 5_900 && city.stats.staticLights <= 82, city.stats);

  const variant = buildCity(new THREE.Scene(), { seed: CITY_SEED + 1 });
  try {
    assert.equal(variant.minaMarketKitchen.id, market.id);
    assert.equal(variant.minaMarketKitchen.seed, ((CITY_SEED + 1) ^ 0x4d494e41) >>> 0);
    assert.equal(variant.minaMarketKitchen.businessId, market.businessId);
    assert.notDeepEqual(variant.minaMarketKitchen.variant, market.variant,
      "a new city seed should preserve the market plan while varying stocked-room dressing");
    assert.equal(variant.minaMarketKitchen.stats.renderInstances, market.stats.renderInstances);
    assert.equal(variant.minaMarketKitchen.stats.collisionVolumes, market.stats.collisionVolumes);
    assert.equal(variant.minaMarketKitchen.stats.occupancySlots, market.stats.occupancySlots);
    assert.equal(variant.stats.instancedMeshes, city.stats.instancedMeshes);
    assert.equal(variant.staticLights.filter(light =>
      light.userData.marketId === market.id).length, market.stats.practicalLights);
  } finally {
    variant.dispose();
  }
}));

test("Pulse Garage left service bay is a seeded, raised and physically navigable interior", () => withCity(city => {
  const bay = city.pulseGarageInterior;
  assert.ok(bay);
  assertDeepFrozen(bay);
  assert.equal(bay.id, "pulse-garage-left-service-bay");
  assert.equal(bay.seed, (CITY_SEED ^ 0x50554c53) >>> 0);
  assert.equal(bay.layout.seed, bay.seed);
  assert.equal(bay.layout.kind, "seeded-two-post-service-bay");
  assert.equal(bay.stats.stations, Object.keys(bay.stations).length);
  assert.equal(bay.stats.collisionVolumes, 7);
  assert.ok(bay.stats.renderMeshes >= 40, bay.stats);
  assert.equal(bay.stats.wallTools, 8);
  assert.equal(bay.stats.partsBins, 6);
  const variant = buildCity(new THREE.Scene(), { seed: CITY_SEED + 1 });
  try {
    assert.equal(variant.pulseGarageInterior.seed, ((CITY_SEED + 1) ^ 0x50554c53) >>> 0);
    assert.notEqual(variant.pulseGarageInterior.layout.liftZ, bay.layout.liftZ,
      "a different city seed should produce a different stable equipment layout");
  } finally {
    variant.dispose();
  }

  assert.equal(city.root.getObjectByName("Pulse Garage dark service bay 1"), undefined,
    "the open left bay must not retain its opaque fake back wall");
  assert.equal(city.root.getObjectByName("Pulse Garage open service bay illusion 1"), undefined,
    "the open left bay must not retain its projected fake pane");
  assert.ok(city.root.getObjectByName("Pulse Garage dark service bay 2"),
    "the untouched right service frontage should keep its existing depth illusion");
  for (const name of [
    "Pulse Garage left service bay raised floor",
    "Pulse Garage left service bay threshold ramp",
    "Pulse Garage left service bay ceiling",
    "Pulse Garage left service bay west wall",
    "Pulse Garage left service bay east wall",
    "Pulse Garage left service bay rear wall",
    "Pulse Garage service lift post 1",
    "Pulse Garage mechanic workbench",
    "Pulse Garage parts shelf 1",
    "Pulse Garage wall tool 1",
    "Pulse Garage labelled parts bin 1",
    "Pulse Garage service office glazing",
    "Pulse Garage service office occupied room",
  ]) assert.ok(city.root.getObjectByName(name), `missing prebuilt bay detail: ${name}`);

  const oldGarageBlocker = city.blockers.find(blocker => blocker.id === "pulse-garage");
  assert.equal(oldGarageBlocker, undefined, "the former conservative whole-garage AABB must be removed");
  const garageBlockers = city.blockers.filter(blocker => blocker.id.startsWith("pulse-garage"));
  assert.deepEqual(garageBlockers.map(blocker => blocker.id), [
    "pulse-garage-west-structure",
    "pulse-garage-east-structure",
    "pulse-garage-bay-rear-structure",
    "pulse-garage-service-workbench",
    "pulse-garage-service-lift-post-1",
    "pulse-garage-service-lift-post-2",
    "pulse-garage-service-parts-shelf",
  ]);

  const traversalPoints = [
    bay.entrance.exterior,
    bay.entrance.threshold,
    bay.entrance.interior,
    bay.customerAnchor,
    ...Object.values(bay.stations).map(station => station.position),
  ];
  for (const point of traversalPoints) {
    assert.equal(city.isBlockedCircle(point[0], point[2], 0.38), false, point);
    assert.ok(city.pedestrianNodes.some(node =>
      Math.hypot(node[0] - point[0], node[2] - point[2]) < 0.011 && Math.abs(node[1] - point[1]) < 0.011),
    `missing collision-safe interior navigation anchor ${point}`);
  }

  let walker = new THREE.Vector3(...bay.entrance.exterior);
  for (let step = 0; step < 27; ++step) {
    walker = city.resolveCircleMotion(walker, new THREE.Vector3(0, 0, 0.45), 0.38);
    walker.y = city.terrainHeight(walker.x, walker.z);
  }
  assert.ok(walker.z > bay.stations.lift.position[2] + 2.2, walker,
    "the player-sized circle must pass through the entrance and between the lift posts");
  assert.equal(city.isBlockedCircle(walker.x, walker.z, 0.38), false);
  const rearStopped = city.resolveCircleMotion(walker, new THREE.Vector3(0, 0, 5), 0.38);
  assert.ok(rearStopped.z <= bay.bounds.maxZ - 0.20, rearStopped,
    "the real rear wall must stop motion after the navigable service aisle");

  assert.equal(city.terrainHeight(...bay.customerAnchor.filter((_, index) => index !== 1)), bay.bounds.floorY);
  const floorSample = city.sampleGround(bay.customerAnchor[0], bay.customerAnchor[2]);
  assert.equal(floorSample.height, bay.bounds.floorY);
  assert.equal(floorSample.surfaceId, "pulse-garage-service-floor");
  assert.equal(floorSample.districtId, "north-market");
  const ramp = bay.layout.ramp;
  const rampSample = city.sampleGround(-153, (ramp.minZ + ramp.maxZ) * 0.5);
  assert.equal(rampSample.surfaceId, "pulse-garage-service-ramp");
  assert.ok(rampSample.height > ramp.lowY && rampSample.height < ramp.highY, rampSample);
  assert.ok(rampSample.normal.z < 0 && rampSample.normal.y > 0.99, rampSample.normal);

  const bayLights = city.staticLights.filter(light => light.userData.practicalKind === "pulse-garage-service-bay");
  assert.equal(bayLights.length, bay.stats.practicalLights);
  assert.ok(bayLights.every(light => light.userData.staticWorld && light.userData.bounded));
  assert.equal(city.stats.staticLights, 82, "only Mina's back rooms extend the fixed interior-light budget");
  assert.equal(city.stats.instances, 5_858, "the garage must retain the established world total after the pooled market upgrade");
}));

test("authored facade, stone and brick albedos integrate with mipmapped repeat settings and remain optional", () => {
  const scene = new THREE.Scene();
  const bytes = new Uint8Array([
    96, 101, 106, 255, 110, 113, 116, 255,
    86, 91, 95, 255, 103, 106, 109, 255,
  ]);
  const texture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const stoneTexture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const brickTexture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const roadTexture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const pavementTexture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const courtTexture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const depotTexture = new THREE.DataTexture(bytes.slice(), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "test weathered facade";
  const city = buildCity(scene, {
    authoredFacadeTexture: texture,
    authoredStoneTexture: stoneTexture,
    authoredBrickTexture: brickTexture,
    authoredRoadTexture: roadTexture,
    authoredPavementTexture: pavementTexture,
    authoredCourtTexture: courtTexture,
    authoredDepotTexture: depotTexture,
  });
  try {
    assert.equal(city.stats.authoredFacadeTexture, true);
    assert.equal(city.stats.authoredStoneTexture, true);
    assert.equal(city.stats.authoredBrickTexture, true);
    assert.equal(city.stats.authoredRoadTexture, true);
    assert.equal(city.stats.authoredPavementTexture, true);
    assert.equal(city.stats.authoredCourtTexture, true);
    assert.equal(city.stats.authoredDepotTexture, true);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [3, 5]);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.anisotropy, 8);
    assert.deepEqual(brickTexture.repeat.toArray(), [3, 5]);
    assert.deepEqual(stoneTexture.repeat.toArray(), [3, 5]);
    const texturedStyles = city.root.children.filter(object => object.isInstancedMesh && [
      "Instanced city buildings style 3",
      "Instanced city buildings style 6",
    ].includes(object.name));
    assert.equal(texturedStyles.length, 2);
    assert.ok(texturedStyles.every(mesh => mesh.material.map === texture));
    const stoneStyles = city.root.children.filter(object => object.isInstancedMesh && [
      "Instanced city buildings style 1",
      "Instanced city buildings style 2",
      "Instanced city buildings style 5",
    ].includes(object.name));
    assert.equal(stoneStyles.length, 3);
    assert.ok(stoneStyles.every(mesh => mesh.material.map === stoneTexture));
    const brickStyle = city.root.children.find(object => object.name === "Instanced city buildings style 4");
    assert.equal(brickStyle.material.map, brickTexture);
    const roadMesh = city.root.children.find(object => object.name === "Instanced wet road grid");
    const pavementMesh = city.root.children.find(object => object.name === "Raised district sidewalks style 1");
    assert.equal(roadMesh.material.map, roadTexture);
    assert.equal(pavementMesh.material.map, pavementTexture);
    assert.deepEqual(roadTexture.repeat.toArray(), [10, 72]);
    assert.deepEqual(pavementTexture.repeat.toArray(), [8, 8]);
    assert.deepEqual(courtTexture.repeat.toArray(), [2, 3]);
    assert.deepEqual(depotTexture.repeat.toArray(), [6, 2]);
    const courtMesh = city.root.children.find(object => object.name === "Harbour Court authored painted asphalt");
    assert.equal(courtMesh.material.map, courtTexture);
    const depotMesh = city.root.children.find(object => object.name === "Southline authored corrugated east facade");
    assert.equal(depotMesh.material.map, depotTexture);
    assert.equal(depotMesh.material.normalMap !== null, true);
  } finally {
    city.dispose();
  }
});

test("road routes and authored spawns remain on valid, unobstructed ground", () => withCity(city => {
  for (const route of city.routes) {
    assert.equal(route.points.length, 2);
    assert.ok(route.points.every(point => city.isRoad(point[0], point[2])), route);
    const axisIndex = route.axis === "x" ? 0 : 2;
    assert.equal(Math.sign(route.points[1][axisIndex] - route.points[0][axisIndex]), route.direction);
  }

  for (const point of [...city.spawnPoints.vehicles, ...city.spawnPoints.police]) {
    assert.equal(city.isRoad(point.position[0], point.position[2]), true, point);
    assert.equal(city.isBlockedCircle(point.position[0], point.position[2], 0.8), false, point);
  }
  for (const point of [city.spawnPoints.player, ...city.spawnPoints.pedestrians]) {
    assert.equal(city.isBlockedCircle(point.position[0], point.position[2], 0.42), false, point);
  }
  for (const point of Object.values(city.missionPoints)) {
    assert.ok(point.position[0] >= city.bounds.minX && point.position[0] <= city.bounds.maxX, point);
    assert.ok(point.position[2] >= city.bounds.minZ && point.position[2] <= city.bounds.maxZ, point);
    assert.equal(city.isBlockedCircle(point.position[0], point.position[2], 0.35), false, point);
  }
}));

test("ground sampling distinguishes roads, sidewalks, park and waterfront", () => withCity(city => {
  assert.equal(city.isRoad(CITY_ROAD_CENTERS.x[0], 0), true);
  assert.equal(city.isRoad(0, CITY_ROAD_CENTERS.z[0]), true);
  assert.equal(city.isRoad(0, 0), false);
  assert.equal(city.isRoad(city.bounds.maxX + 1, 0), false);

  const road = city.sampleGround(CITY_ROAD_CENTERS.x[0], 0);
  const sidewalk = city.sampleGround(0, 8);
  const park = city.sampleGround(-56, -48);
  const waterfront = city.sampleGround(150, 100);
  const court = city.sampleGround(140, -96);
  assert.equal(road.surfaceId, "road");
  assert.equal(court.surfaceId, "court");
  assert.ok(court.height > waterfront.height);
  assert.equal(sidewalk.surfaceId, "sidewalk");
  assert.equal(park.surfaceId, "park");
  assert.equal(waterfront.surfaceId, "waterfront");
  assert.equal(road.districtId, "westside");
  assert.equal(waterfront.districtId, "harbour-mile");
  assert.ok(road.height < sidewalk.height, { road, sidewalk });
  assert.ok(road.normal.isVector3 && road.normal.equals(new THREE.Vector3(0, 1, 0)));
  assert.equal(city.terrainHeight(CITY_ROAD_CENTERS.x[0], 0), road.height);
}));

test("district identity and time-of-day atmosphere are coherent", () => withCity(city => {
  assert.equal(city.districtAt(0, 0).id, "pulse-core");
  assert.equal(city.districtAt(140, 0).id, "harbour-mile");
  assert.equal(city.districtAt(-140, 140).id, "north-market");
  assert.equal(city.districtAt(-140, 0).id, "westside");
  assert.equal(city.districtAt(0, -140).id, "midtown-loop");
  assert.ok(city.districts.every(district => district.tags.length >= 3));

  const noon = city.setTimeOfDay(12);
  assert.equal(noon.phase, "day");
  assert.ok(noon.nightFactor < 0.2, noon);
  const daylightFrame = city.update(3);
  assert.equal(daylightFrame.atmosphere.phase, "day");
  assert.equal(city.staticLights.slice(2).filter(light => light.intensity > 0.1).length, 0,
    "all practical lighting should shut off during full daylight");
  const night = city.setTimeOfDay(22.5);
  assert.equal(night.phase, "deep-night");
  assert.equal(night.nightFactor, 1);
  assert.equal(city.atmosphere.timeOfDay, 22.5);
  city.update(3.1);
  assert.ok(city.staticLights.slice(2).filter(light => light.intensity > 0.1).length >= 50,
    "street, garage, and occupied storefront practicals should illuminate the night city");
}));

test("sun and moon shadows follow a texel-stable local focus without rebuilding their projection", () => withCity((city, scene) => {
  const celestialLight = city.staticLights.find(light => light.isDirectionalLight);
  assert.ok(celestialLight?.castShadow);
  const shadowCamera = celestialLight.shadow.camera;
  const shadowTarget = celestialLight.target;
  assert.equal(shadowCamera.isOrthographicCamera, true);
  assert.deepEqual([
    shadowCamera.left, shadowCamera.right, shadowCamera.top, shadowCamera.bottom,
  ], [-84, 84, 84, -84]);
  assert.deepEqual(celestialLight.shadow.mapSize.toArray(), [2048, 2048]);
  assert.equal(celestialLight.userData.shadowCoverageRadius, 84);
  assert.equal(celestialLight.userData.shadowWorldUnitsPerTexel, 168 / 2048);

  let sceneObjects = 0;
  scene.traverse(() => { sceneObjects += 1; });
  const originalProjectionUpdate = shadowCamera.updateProjectionMatrix;
  let projectionUpdates = 0;
  shadowCamera.updateProjectionMatrix = function updateProjectionMatrixProbe() {
    projectionUpdates += 1;
    return originalProjectionUpdate.call(this);
  };
  try {
    city.setTimeOfDay(12);
    city.update(1);
    assert.deepEqual(shadowTarget.position.toArray(), [0, 0, 0],
      "the original one-argument update must retain its origin-centred behavior");
    const originalDirection = celestialLight.position.clone().sub(shadowTarget.position);
    const focus = new THREE.Vector3(31.234, 2.75, -46.789);
    city.update(1.1, focus);
    const texel = celestialLight.userData.shadowWorldUnitsPerTexel;
    assert.ok(Math.abs(shadowTarget.position.x - focus.x) <= texel * 0.5 + 1e-12);
    assert.ok(Math.abs(shadowTarget.position.z - focus.z) <= texel * 0.5 + 1e-12);
    assert.equal(shadowTarget.position.y, focus.y);
    const focusedDirection = celestialLight.position.clone().sub(shadowTarget.position);
    assert.ok(focusedDirection.distanceTo(originalDirection) < 1e-9,
      "translating the light and target together must preserve celestial direction");

    const stableTarget = celestialLight.target;
    const stableCamera = celestialLight.shadow.camera;
    for (let index = 0; index < 300; ++index) {
      city.update(1.2 + index / 60, index % 2
        ? { position: [-70.4, 1.2, 55.7] }
        : { x: 31.234, y: 2.75, z: -46.789 });
    }
    assert.strictEqual(celestialLight.target, stableTarget);
    assert.strictEqual(celestialLight.shadow.camera, stableCamera);
    assert.equal(projectionUpdates, 0,
      "moving a fixed-size orthographic shadow volume must not rebuild its projection");
    let objectsAfterUpdates = 0;
    scene.traverse(() => { objectsAfterUpdates += 1; });
    assert.equal(objectsAfterUpdates, sceneObjects,
      "focused shadow updates must not add runtime scene objects");

    city.update(7);
    assert.deepEqual(shadowTarget.position.toArray(), [0, 0, 0],
      "omitting the optional focus must remain deterministic after focused calls");
  } finally {
    shadowCamera.updateProjectionMatrix = originalProjectionUpdate;
  }
}));

test("Pulse Street Exchange is a pooled, occupied and legally routed transit frontage", () => withCity((city, scene) => {
  const transit = city.pulseTransit;
  assertDeepFrozen(transit);
  assert.equal(transit.id, "pulse-street-exchange");
  assert.equal(transit.title, "Pulse Street Exchange");
  assert.equal(transit.streetId, "street-04");
  assert.deepEqual(transit.shelterAnchors.map(position => position[0]), [-144, -96, -48, 48, 96]);
  assert.equal(transit.waitingAnchors.length, 5);
  assert.equal(transit.coveredWaitingAnchors.length, 5);
  assert.deepEqual(transit.westboundCurbStops, [48, 0, -48, -96, -144].map(x => [x, 0.04, -21.35]));
  assert.equal(transit.terminus, transit.westboundCurbStops.at(-1));
  assert.equal(city.districtAt(transit.terminus[0], transit.terminus[2]).id, "westside");
  assert.ok(Object.values(transit.bounds).every(Number.isFinite));
  assert.ok([transit.entrance, transit.hub, transit.dispatchBay,
    ...transit.shelterAnchors, ...transit.waitingAnchors, ...transit.coveredWaitingAnchors,
    ...transit.westboundCurbStops, ...transit.practicalPositions]
    .every(position => position.length === 3 && position.every(Number.isFinite)));

  const walkable = [transit.entrance, transit.hub,
    ...transit.shelterAnchors, ...transit.waitingAnchors, ...transit.coveredWaitingAnchors];
  assert.ok(walkable.every(position => !city.isRoad(position[0], position[2])), walkable);
  assert.ok(walkable.every(position => !city.isBlockedCircle(position[0], position[2], 0.40)), walkable);
  assert.ok(walkable.every(position => city.pedestrianNodes.some(node =>
    Math.hypot(node[0] - position[0], node[2] - position[2]) < 1e-9)),
  "every public exchange anchor must belong to the ambient pedestrian graph");
  assert.ok(transit.westboundCurbStops.every(position => city.isRoad(position[0], position[2])));
  assert.ok(transit.westboundCurbStops.every(position =>
    !city.isBlockedCircle(position[0], position[2], 0.80)));
  assert.ok(city.isRoad(transit.dispatchBay[0], transit.dispatchBay[2]));
  for (let index = 1; index < transit.westboundCurbStops.length; ++index) {
    assert.ok(transit.westboundCurbStops[index][0] < transit.westboundCurbStops[index - 1][0],
      "the Street 04 service must continue west without doubling back");
  }

  const shelterMesh = city.root.getObjectByName("Pulse Street bus shelter frames");
  assert.ok(shelterMesh?.isInstancedMesh);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < transit.shelterAnchors.length; ++index) {
    shelterMesh.getMatrixAt(index * 4, matrix);
    matrix.decompose(position, rotation, scale);
    const physical = transit.shelterAnchors[index];
    assert.ok(Math.abs(position.x - physical[0]) < 1e-4);
    assert.ok(Math.abs(position.z - physical[2]) < 1e-4);
    const covered = transit.coveredWaitingAnchors[index];
    assert.ok(Math.abs(covered[0] - position.x) <= scale.x * 0.5);
    assert.ok(Math.abs(covered[2] - position.z) <= scale.z * 0.5,
      "rain waiting anchors must sit beneath their real shelter roofs");
  }

  const lobbyGlass = city.root.getObjectByName("Instanced projected occupied interiors style 2");
  const lobbyReveal = city.root.getObjectByName("Instanced ground-floor podiums");
  assert.ok(lobbyGlass?.isInstancedMesh && lobbyReveal?.isInstancedMesh);
  assert.equal(lobbyGlass.material.userData.interiorMapping.technique, "view-ray room-box projection");
  assert.match(lobbyGlass.material.name, /occupied parallax interiors/i);
  assert.doesNotMatch(lobbyGlass.material.name, /neon/i);
  assert.equal(lobbyGlass.material.toneMapped, true);
  assert.equal(lobbyGlass.material.transparent, false);
  assert.equal(lobbyReveal.material.isMeshStandardNodeMaterial, true);
  assert.equal(lobbyReveal.material.color.getHex(), 0x343b40,
    "the recessed lobby surround should remain dark concrete, not emissive signage");
  const lobbyPanelXs = [];
  for (let index = lobbyGlass.count - 3; index < lobbyGlass.count; ++index) {
    lobbyGlass.getMatrixAt(index, matrix);
    matrix.decompose(position, rotation, scale);
    assert.ok(Math.abs(position.z + 13.73) < 1e-4);
    lobbyPanelXs.push(Number(position.x.toFixed(2)));
  }
  assert.deepEqual(lobbyPanelXs, [45.5, 48, 50.5]);

  const practicals = city.staticLights.filter(light =>
    light.name.startsWith("Pulse Street Exchange warm practical"));
  assert.equal(practicals.length, 2);
  assert.ok(practicals.every(light => light.isPointLight && light.distance === 11.5));
  assert.ok(practicals.every(light => light.decay === 2 && light.castShadow === false));
  assert.ok(practicals.every(light => light.userData.bounded === true &&
    light.userData.practicalKind === "pulse-transit"));
  assert.equal(new Set(practicals.map(light => light.color.getHex())).size, 1);
  city.setTimeOfDay(12);
  city.update(0.1);
  assert.ok(practicals.every(light => light.intensity < 0.1));
  city.setTimeOfDay(19.25);
  city.update(0.1);
  assert.ok(practicals.every(light => light.intensity > 1));

  const authoredPulseVans = city.spawnPoints.vehicles.filter(vehicle => vehicle.access === "pulse-line");
  assert.equal(authoredPulseVans.length, 1);
  assert.equal(authoredPulseVans[0], transit.vehicle);
  assert.equal(transit.vehicleId, "vehicle-06");
  assert.equal(transit.vehicle.kind, "van");
  assert.equal(transit.vehicle.authorized, true);
  assert.equal(transit.vehicle.parked, true);
  assert.equal(transit.vehicle.access, "pulse-line");
  assert.equal(transit.vehicle.position, transit.dispatchBay);

  const vehicleWorld = {
    ...city,
    roadRoutes: city.routes,
    spawnPoints: {
      vehicles: city.spawnPoints.vehicles.map(value => ({ ...value, yaw: value.heading, parked: true })),
      police: city.spawnPoints.police.map(value => ({ ...value, yaw: value.heading, police: true })),
    },
  };
  const vehicleSystem = createVehicleSystem({ scene, world: vehicleWorld });
  try {
    assert.equal(vehicleSystem.vehicles.length, 19);
    const runtimePulseVans = vehicleSystem.vehicles.filter(vehicle => vehicle.access === "pulse-line");
    assert.equal(runtimePulseVans.length, 1);
    assert.equal(runtimePulseVans[0].id, transit.vehicleId);
    assert.equal(runtimePulseVans[0].kind, "van");
    assert.equal(runtimePulseVans[0].authorized, true);
    assert.equal(runtimePulseVans[0].aiMode, "parked");
  } finally {
    vehicleSystem.dispose();
  }

  assert.equal(city.stats.pulseTransitExchange, true);
  assert.equal(city.stats.pulseTransitShelters, 5);
  assert.equal(city.stats.pulseTransitWaitingAnchors, 5);
  assert.equal(city.stats.pulseTransitCoveredWaitingAnchors, 5);
  assert.equal(city.stats.pulseTransitWestboundStops, 5);
  assert.equal(city.stats.pulseTransitLobbyInteriorPanels, 3);
  assert.equal(city.stats.pulseTransitRouteBoardParts, 7);
  assert.equal(city.stats.pulseTransitTicketMachines, 2);
  assert.equal(city.stats.pulseTransitBikeRackParts, 6);
  assert.equal(city.stats.pulseTransitBenches, 5);
  assert.equal(city.stats.pulseTransitPracticalLights, 2);
  assert.equal(city.stats.pulseTransitPropInstances, 35);
  assert.equal(city.stats.pulseTransitAllocatedInstances, 39);
  assert.equal(city.stats.instancedMeshes, 64);
  assert.equal(city.stats.instances, 5_858);
  assert.equal(city.stats.distantLights, 59);
}));

test("North Market street arcade is pooled, lit and pedestrian-safe", () => withCity(city => {
  const market = city.northMarket;
  assert.equal(Object.isFrozen(market), true);
  assert.equal(Object.isFrozen(market.bounds), true);
  assert.equal(Object.isFrozen(market.stallCenters), true);
  assert.equal(Object.isFrozen(market.visitorAnchors), true);
  assert.equal(Object.isFrozen(market.businessAnchors), true);
  assert.equal(market.district, "north-market");
  assert.deepEqual(market.stallCenters.map(position => position[0]), [-156, -148, -140, -132]);
  assert.ok(market.stallCenters.every(position => Math.abs(position[2] - 130.6) < 1e-9));
  assert.equal(city.stats.northMarketArcade, true);
  assert.equal(city.stats.northMarketStalls, 4);
  assert.equal(city.stats.northMarketVisitorAnchors, 4);
  assert.equal(city.stats.northMarketBusinessAnchors, 4);
  assert.equal(city.stats.northMarketPracticalLights, 3);
  assert.equal(city.stats.northMarketPropInstances, 60);
  assert.equal(city.stats.businessLocations, 4);
  assert.equal(city.stats.instancedMeshes, 64, "the market must not add a render batch");
  assert.ok(city.stats.instances < 5_900, city.stats);

  const publicAnchors = [market.focus, ...market.visitorAnchors, ...market.businessAnchors];
  assert.ok(publicAnchors.every(position => !city.isRoad(position[0], position[2])), publicAnchors);
  assert.ok(publicAnchors.every(position => !city.isBlockedCircle(position[0], position[2], 0.38)), publicAnchors);
  assert.ok(publicAnchors.every(position => city.districtAt(position[0], position[2]).id === "north-market"));
  assert.ok(publicAnchors.every(position => city.pedestrianNodes.some(node =>
    Math.hypot(node[0] - position[0], node[2] - position[2]) < 1e-9)));

  const stallBlockers = city.blockers.filter(blocker => blocker.kind === "market-stall");
  assert.equal(stallBlockers.length, 4);
  assert.ok(stallBlockers.every(blocker => blocker.halfExtents.every(value => value > 0)));
  assert.ok(stallBlockers.every(blocker => city.isBlockedCircle(blocker.center[0], blocker.center[2], 0.25)));

  const pendants = city.staticLights.filter(light => light.name.startsWith("North Market pendant"));
  assert.equal(pendants.length, 3);
  city.setTimeOfDay(12);
  city.update(0.1);
  assert.ok(pendants.every(light => light.intensity < 0.1));
  city.setTimeOfDay(19.25);
  city.update(0.1);
  assert.ok(pendants.every(light => light.intensity > 1));

  assert.deepEqual(city.businesses.map(business => business.id), [
    "common_ground_cafe", "mina_market_kitchen", "harbour_lantern", "southline_diner",
  ]);
  assert.equal(city.northMarket.businesses[0]?.id, "mina_market_kitchen");
  assert.ok(city.businesses.every(business => Object.isFrozen(business)));
  assert.ok(city.businesses.every(business => !city.isRoad(business.position[0], business.position[2])));
  assert.ok(city.businesses.every(business => !city.isBlockedCircle(
    business.position[0], business.position[2], 0.38)));
  assert.ok(city.businesses.every(business => !city.isBlockedCircle(
    business.keeperPosition[0], business.keeperPosition[2], 0.38)));
  const harbourLantern = city.businesses.find(business => business.id === "harbour_lantern");
  const cityLensHub = city.missionPoints.harbourRun.position;
  assert.ok(Math.hypot(
    harbourLantern.position[0] - cityLensHub[0],
    harbourLantern.position[2] - cityLensHub[2],
  ) > 13, "the E-key shop radius must not mask the City Lens activity hub");
}));

test("Open Doors businesses own pooled physical frontages and opening-hour lights", () => withCity(city => {
  const frontages = city.businessFrontages;
  assertDeepFrozen(frontages);
  assert.deepEqual(frontages.map(frontage => frontage.id), [
    "common_ground_cafe", "harbour_lantern", "southline_diner",
  ]);
  assert.deepEqual(frontages.map(frontage => frontage.center), [
    [
      (city.commonGroundCafe.bounds.minX + city.commonGroundCafe.bounds.maxX) * 0.5,
      city.commonGroundCafe.bounds.floorY,
      city.commonGroundCafe.bounds.minZ - 0.10,
    ],
    [145.75, 0.2, 148],
    [-132, 0.2, -108.05],
  ]);
  assert.deepEqual(frontages.map(frontage => frontage.yaw), [Math.PI, Math.PI * 0.5, Math.PI]);
  assert.equal(city.stats.businessLocations, 4);
  assert.equal(city.stats.businessFrontages, 3);
  assert.equal(city.stats.businessFrontagePropInstances, 18,
    "the real cafe replaces its former nine detached frontage props");
  assert.equal(city.stats.businessFrontageAllocatedInstances, 21);
  assert.equal(city.stats.businessPracticalLights, 3);
  assert.equal(city.stats.instancedMeshes, 64, "frontages must append to existing render pools");
  assert.equal(city.stats.instances, 5_858);
  assert.equal(city.stats.staticLights, 82);
  assert.ok(city.stats.instances <= 5_900 && city.stats.staticLights <= 82, city.stats);

  for (const frontage of frontages) {
    const business = city.businesses.find(candidate => candidate.id === frontage.id);
    assert.ok(business);
    assert.equal(frontage.interactionPosition, business.position);
    assert.equal(city.districtAt(frontage.center[0], frontage.center[2]).id, frontage.district);
    assert.equal(city.isRoad(business.position[0], business.position[2]), false);
    assert.equal(city.isBlockedCircle(business.position[0], business.position[2], 0.38), false);
    assert.equal(city.isBlockedCircle(business.keeperPosition[0], business.keeperPosition[2], 0.38), false);
    assert.ok(Math.hypot(
      business.position[0] - frontage.center[0],
      business.position[2] - frontage.center[2],
    ) <= frontage.width * 0.5 + 4.0, `${frontage.id} frontage must remain within its physical threshold span`);
  }
  const frontageBlockers = city.blockers.filter(blocker => blocker.kind === "business-frontage");
  assert.equal(frontageBlockers.length, 2,
    "Common Ground owns a doorway and compound room collision instead of an opaque counter AABB");
  assert.ok(frontageBlockers.every(blocker => city.isBlockedCircle(
    blocker.center[0], blocker.center[2], 0.20)));

  const glassBatch = city.root.getObjectByName("Pulse Street bus shelter glass");
  const metalBatch = city.root.getObjectByName("Instanced facade corner ribs");
  assert.ok(glassBatch?.isInstancedMesh && metalBatch?.isInstancedMesh);
  assert.equal(glassBatch.material.isMeshStandardNodeMaterial, true);
  assert.ok(metalBatch.material.normalMap && metalBatch.material.roughnessMap,
    "frontage frames must retain the existing textured PBR metal response");

  const practicals = city.staticLights.filter(light =>
    light.userData.practicalKind === "open-doors-business");
  assert.deepEqual(practicals.map(light => light.userData.businessId), frontages.map(frontage => frontage.id));
  assert.ok(practicals.every(light => light.isPointLight && light.decay === 2 && light.castShadow === false));
  assert.ok(practicals.every(light => light.distance <= 18 && light.userData.bounded === true));
  assert.ok(practicals.every(light => light.intensity === 0), "business practicals start dark until schedules sync");

  assert.equal(city.setBusinessOpenStates({
    common_ground_cafe: false,
    harbour_lantern: true,
    southline_diner: true,
  }), 2);
  city.setTimeOfDay(23);
  city.update(0.25);
  assert.equal(practicals.find(light => light.userData.businessId === "common_ground_cafe").intensity, 0);
  assert.ok(practicals.find(light => light.userData.businessId === "harbour_lantern").intensity > 1);
  assert.ok(practicals.find(light => light.userData.businessId === "southline_diner").intensity > 1);
  assert.equal(city.setBusinessOpenStates([{ id: "missing-business", open: true }]), 0);

  assert.equal(city.setBusinessOpenStates(new Map([
    ["harbour_lantern", false],
    ["southline_diner", false],
    ["common_ground_cafe", true],
  ])), 3);
  city.setTimeOfDay(12);
  city.update(0.5);
  assert.ok(practicals.every(light => light.intensity < 0.1),
    "even open storefronts must not waste practical-light work at noon");
}));

test("Borrowed Time depot is a pooled, road-accessible inspection yard", () => withCity(city => {
  const chapter = city.chapterTwo;
  assert.equal(Object.isFrozen(chapter), true);
  assert.equal(Object.isFrozen(chapter.bounds), true);
  assert.equal(Object.isFrozen(chapter.interactAnchors), true);
  assert.equal(Object.isFrozen(chapter.garageClues), true);
  assert.equal(Object.isFrozen(chapter.cinematicAnchors), true);
  assert.equal(Object.isFrozen(chapter.aftermathAnchors), true);
  assert.equal(Object.isFrozen(chapter.conversationAnchors), true);
  assert.equal(Object.isFrozen(chapter.practicalPositions), true);
  assert.equal(chapter.id, "borrowed-time");
  assert.equal(chapter.depotId, "southline-parts-depot");
  assert.deepEqual(Object.keys(chapter.interactAnchors), [
    "manifestDesk", "suspectPallet", "loadingSeal", "customerVehicleBay",
  ]);
  assert.equal(chapter.evidenceAnchors, chapter.interactAnchors);
  assert.equal(chapter.keeperAnchor, chapter.witnessAnchor);

  assert.equal(city.stats.chapterTwoDepot, true);
  assert.equal(city.stats.chapterTwoEvidenceAnchors, 4);
  assert.equal(city.stats.chapterTwoGarageClues, 3);
  assert.equal(city.stats.chapterTwoLeahAnchor, true);
  assert.equal(city.stats.chapterTwoConversationAnchors, 2);
  assert.equal(city.stats.chapterTwoEvidencePartInstances, 10);
  assert.equal(city.stats.chapterTwoAftermathAnchors, 3);
  assert.equal(city.stats.chapterTwoAftermathPropInstances, 6);
  assert.equal(city.stats.chapterTwoPracticalLights, 2);
  assert.equal(city.stats.chapterTwoPropInstances, 20);
  assert.equal(city.stats.instancedMeshes, 64, "the depot must append to existing render batches");
  assert.equal(city.stats.instances, 5_858);
  assert.equal(city.stats.streetDetailInstances, 1_282);
  assert.equal(city.stats.distantLights, 59);

  assert.deepEqual(chapter.garageClues, {
    failed_brake_hose: [-151.5, 0.2, 79.6],
    supplier_invoice: [-144, 0.2, 79.6],
    service_log: [-136.5, 0.2, 79.6],
  });
  assert.deepEqual(chapter.cinematicAnchors, {
    failed_brake_hose: [-151.5, 0.72, 80.18],
    supplier_invoice: [-144, 1.03, 80.181],
    service_log: [-136.5, 0.79, 80.26],
    depot_manifest: [-181.5, 1.275, -136],
    recall_board: [-144, 1.03, 80.181],
  });
  assert.deepEqual(chapter.aftermathAnchors, {
    recallCustomer: [-140.35, 0.2, 78.55],
    recallDesk: [-144, 1.03, 80.181],
    fleetRecords: [-181.5, 1.275, -135.7],
  });
  assert.equal(chapter.leahAnchor, city.commonGroundCafe.customerAnchors.story.leah);
  assert.equal(chapter.leahInteractionAnchor, city.commonGroundCafe.customerAnchors.story.interaction);
  assert.deepEqual(chapter.manifestInteractionAnchor, chapter.manifestDesk);
  assert.deepEqual(chapter.keeperWitnessAnchor, [-183.1, 0.2, -138.2]);
  assert.ok(Math.hypot(
    chapter.leahAnchor[0] - chapter.leahInteractionAnchor[0],
    chapter.leahAnchor[2] - chapter.leahInteractionAnchor[2],
  ) >= 2.4, "Leah and Kai must have distinct physical conversation marks");
  assert.ok(Math.hypot(
    chapter.keeperWitnessAnchor[0] - chapter.manifestInteractionAnchor[0],
    chapter.keeperWitnessAnchor[2] - chapter.manifestInteractionAnchor[2],
  ) >= 3.5, "Dara, the manifest and Kai must form a readable interaction triangle");

  const onFootAnchors = [
    chapter.focus,
    ...Object.values(chapter.interactAnchors),
    chapter.keeperWitnessAnchor,
    ...Object.values(chapter.garageClues),
    chapter.leahAnchor,
    chapter.aftermathAnchors.recallCustomer,
    ...Object.values(chapter.conversationAnchors),
  ];
  assert.ok(onFootAnchors.every(position => Object.isFrozen(position)));
  assert.ok(onFootAnchors.every(position => !city.isRoad(position[0], position[2])), onFootAnchors);
  assert.ok(onFootAnchors.every(position => !city.isBlockedCircle(position[0], position[2], 0.38)), onFootAnchors);
  assert.ok(onFootAnchors.every(position => city.pedestrianNodes.some(node =>
    Math.hypot(node[0] - position[0], node[2] - position[2]) < 0.011)));
  assert.equal(city.isRoad(chapter.roadApproach[0], chapter.roadApproach[2]), true,
    "the authored vehicle approach must occupy the adjacent legal road");
  assert.equal(city.isBlockedCircle(chapter.roadApproach[0], chapter.roadApproach[2], 0.70), false);

  const corners = [
    [chapter.bounds.minX, chapter.bounds.minZ], [chapter.bounds.minX, chapter.bounds.maxZ],
    [chapter.bounds.maxX, chapter.bounds.minZ], [chapter.bounds.maxX, chapter.bounds.maxZ],
  ];
  assert.ok(corners.every(([x, z]) => !city.isRoad(x, z)), chapter.bounds);
  const insideYard = position => position[0] >= chapter.bounds.minX && position[0] <= chapter.bounds.maxX &&
    position[2] >= chapter.bounds.minZ && position[2] <= chapter.bounds.maxZ;
  assert.ok(city.businesses.every(business => !insideYard(business.position)));
  assert.ok(Object.values(city.missionPoints).every(point => !insideYard(point.position)));
  assert.equal(insideYard(city.northMarket.focus), false);
  assert.equal(insideYard(city.harbourCourt.hub), false);

  const commonGround = city.businesses.find(business => business.id === "common_ground_cafe");
  assert.ok(commonGround);
  assert.equal(commonGround.position, city.commonGroundCafe.entrance.exterior);
  assert.ok(chapter.leahAnchor[0] > city.commonGroundCafe.bounds.minX &&
    chapter.leahAnchor[0] < city.commonGroundCafe.bounds.maxX &&
    chapter.leahAnchor[2] > city.commonGroundCafe.bounds.minZ &&
    chapter.leahAnchor[2] < city.commonGroundCafe.bounds.maxZ,
  "Leah should wait at a real table inside Common Ground rather than beside a detached marker");

  const depotBlockers = city.blockers.filter(blocker => blocker.id.startsWith("southline-"));
  assert.equal(depotBlockers.length, 6);
  assert.ok(depotBlockers.every(blocker => blocker.halfExtents.every(value => value > 0)));
  const practicals = city.staticLights.filter(light => light.name.startsWith("Southline depot"));
  assert.equal(practicals.length, 2);
  assert.notEqual(practicals[0].color.getHex(), practicals[1].color.getHex(),
    "loading and inspection pools should remain warm/cool distinct");

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tailScales = (name, count) => {
    const mesh = city.root.children.find(object => object.name === name);
    assert.ok(mesh?.isInstancedMesh, `${name} must stay in a precreated pooled batch`);
    const values = [];
    for (let index = mesh.count - count; index < mesh.count; ++index) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      values.push(scale.toArray());
    }
    return values;
  };
  const hoseParts = tailScales("Instanced rooftop antennas", 3);
  assert.deepEqual(hoseParts.map(value => Number(Math.max(...value).toFixed(3))), [0.62, 0.5, 0.5],
    "the failed hose should be a small three-segment U, not a full-height pole");
  const evidenceStands = tailScales("Instanced ground-floor podiums", 2);
  assert.ok(evidenceStands.every(value => value[1] <= 0.561 && Math.max(...value) <= 1.151), evidenceStands);
  const papers = tailScales("Downtown pedestrian crossings", 4);
  assert.ok(papers.every(value => Math.max(...value) <= 0.64), papers);
  assert.equal(papers.filter(value => value[1] <= 0.026).length, 3,
    "the open log and desk manifest must lie flat while the clipped invoice remains upright");

  const arrivalRamp = city.root.getObjectByName("Garage arrival ramp");
  assert.ok(arrivalRamp?.isMesh);
  city.root.updateMatrixWorld(true);
  const rampBounds = new THREE.Box3().setFromObject(arrivalRamp);
  const frontageDepth = Math.max(
    ...Object.values(chapter.cinematicAnchors)
      .filter(position => position[2] > 0)
      .map(position => position[2]),
    city.missionPoints.pulseGarage.position[2],
  );
  assert.ok(rampBounds.min.z > frontageDepth + 0.75,
    `the rendered arrival ramp must begin behind the evidence frontage (${rampBounds.min.z} <= ${frontageDepth})`);

  city.setTimeOfDay(12);
  city.update(0.1);
  assert.ok(practicals.every(light => light.intensity < 0.1));
  city.setTimeOfDay(20.5);
  city.update(0.1);
  assert.ok(practicals.every(light => light.intensity > 1));
}));

test("clear and rainy weather continuously change asphalt response and puddle visibility", () => withCity(city => {
  const roadMesh = city.root.children.find(object => object.name === "Instanced wet road grid");
  const puddleMesh = city.root.children.find(object => object.name === "Irregular shallow street puddles");
  const laneMesh = city.root.children.find(object => object.name === "Cool directional lane arrows");
  assert.ok(roadMesh && puddleMesh && laneMesh);
  assert.equal(laneMesh.count, city.stats.laneArrows * 3,
    "the cool paint batch should contain arrows, not doubled longitudinal lines");
  assert.equal(laneMesh.material.isMeshStandardNodeMaterial, true,
    "road paint should receive real daylight and practical lighting instead of glowing unlit");

  const dry = city.setWetness(0);
  const dryRoughness = roadMesh.material.roughness;
  const dryPuddleOpacity = puddleMesh.material.opacity;
  assert.equal(dry.wetness, 0);
  const soaked = city.setWetness(1);
  assert.equal(soaked.wetness, 1);
  assert.ok(roadMesh.material.roughness < dryRoughness * 0.4,
    { dryRoughness, soakedRoughness: roadMesh.material.roughness });
  assert.ok(puddleMesh.material.opacity > dryPuddleOpacity + 0.5,
    { dryPuddleOpacity, soakedPuddleOpacity: puddleMesh.material.opacity });
}));

test("circle motion prevents tunnelling, slides by axis and respects world bounds", () => withCity(city => {
  const blocker = city.blockers.find(item => item.kind === "building");
  assert.ok(blocker);
  const [cx, , cz] = blocker.center;
  const [hx] = blocker.halfExtents;
  const radius = 0.62;
  assert.equal(city.isBlockedCircle(cx, cz, radius), true);

  const start = new THREE.Vector3(cx - hx - radius - 1.2, city.terrainHeight(cx - hx - radius - 1.2, cz), cz);
  assert.equal(city.isBlockedCircle(start.x, start.z, radius), false);
  const stopped = city.resolveCircleMotion(start, new THREE.Vector3(7, 0, 0), radius);
  assert.ok(stopped.isVector3);
  assert.ok(stopped.x > start.x, { start: start.x, stopped: stopped.x });
  assert.ok(stopped.x <= cx - hx - radius + 1e-7, { stopped: stopped.x, face: cx - hx - radius });
  assert.equal(city.isBlockedCircle(stopped.x, stopped.z, radius), false);

  const boundaryStart = new THREE.Vector3(city.bounds.minX + 2, 0, CITY_ROAD_CENTERS.z[0]);
  const bounded = city.resolveCircleMotion(boundaryStart, new THREE.Vector3(-100, 0, 0), 0.8);
  assert.ok(bounded.x >= city.bounds.minX + 0.8 - 1e-9, bounded);
  assert.equal(city.isBlockedCircle(bounded.x, bounded.z, 0.8), false);
}));

test("camera clipping stops before buildings and supports the player adapter shape", () => withCity(city => {
  const blocker = city.blockers.find(item => item.kind === "building" && item.halfExtents[1] > 8);
  assert.ok(blocker);
  const [cx, , cz] = blocker.center;
  const [hx] = blocker.halfExtents;
  const target = new THREE.Vector3(cx - hx - 4, 2.4, cz);
  const desired = new THREE.Vector3(cx + hx + 4, 2.4, cz);
  const clipped = city.clipCamera(target, desired, 0.25);
  assert.ok(clipped.isVector3);
  assert.ok(clipped.distanceTo(target) < desired.distanceTo(target) - 0.5, { target, desired, clipped });
  assert.equal(city.isBlockedCircle(clipped.x, clipped.z, 0.25), false);

  const adapted = city.clipCamera({ target, desired, radius: 0.25 });
  assert.ok(adapted.position.isVector3);
  assert.ok(adapted.position.distanceTo(clipped) < 1e-9);

  const stableOutput = new THREE.Vector3();
  const stableResult = { position: stableOutput, safeFraction: 0, distance: 0 };
  const stableRequest = { target, desired, radius: 0.25, output: stableOutput, result: stableResult };
  let objectCount = 0;
  city.root.traverse(() => { objectCount += 1; });
  for (let frame = 0; frame < 300; ++frame) {
    assert.strictEqual(city.clipCamera(target, desired, 0.25, stableOutput), stableOutput);
    assert.strictEqual(city.clipCamera(stableRequest), stableResult);
    assert.strictEqual(stableResult.position, stableOutput);
    assert.ok(stableResult.safeFraction >= 0 && stableResult.safeFraction < 1);
    assert.ok(Math.abs(stableResult.distance - stableOutput.distanceTo(target)) < 1e-9);
  }
  let objectCountAfter = 0;
  city.root.traverse(() => { objectCountAfter += 1; });
  assert.equal(objectCountAfter, objectCount,
    "repeated allocation-stable camera probes must not grow the rendered world");
}));

test("animation status is finite and disposal is idempotent", () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  const frame = city.update(12.5);
  assert.ok(Number.isFinite(frame.neonPulse));
  assert.ok(Number.isFinite(frame.waterLevel));
  assert.ok(Number.isFinite(frame.atmosphere.nightFactor));
  assert.equal(city.root.parent, scene);
  city.dispose();
  city.dispose();
  assert.equal(city.root.parent, null);
});
