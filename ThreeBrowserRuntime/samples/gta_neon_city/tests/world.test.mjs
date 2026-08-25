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
    assert.ok(first.stats.instances >= 5_000 && first.stats.instances <= 5_600, first.stats);
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
    assert.equal(first.stats.groundFloorInteriorBanks, 240);
    assert.equal(first.stats.streetLevelPlinths, 47);
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

test("pooled building bases reveal occupied ground floors without adding render work", () => withCity(city => {
  assert.equal(city.stats.instancedMeshes, 64);
  assert.equal(city.stats.instances, 5_535);
  assert.equal(city.stats.windowBanks, 1_938,
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
  assert.equal(city.stats.instances, 5_535);
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
  assert.ok(city.stats.instances < 5_600, city.stats);

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
    [-40, 0.2, -13.75],
    [145.75, 0.2, 148],
    [-132, 0.2, -108.05],
  ]);
  assert.deepEqual(frontages.map(frontage => frontage.yaw), [Math.PI, Math.PI * 0.5, Math.PI]);
  assert.equal(city.stats.businessLocations, 4);
  assert.equal(city.stats.businessFrontages, 3);
  assert.equal(city.stats.businessFrontagePropInstances, 27);
  assert.equal(city.stats.businessFrontageAllocatedInstances, 30);
  assert.equal(city.stats.businessPracticalLights, 3);
  assert.equal(city.stats.instancedMeshes, 64, "frontages must append to existing render pools");
  assert.equal(city.stats.instances, 5_535);
  assert.equal(city.stats.staticLights, 80);
  assert.ok(city.stats.instances <= 5_600 && city.stats.staticLights <= 80, city.stats);

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
    ) <= 5.25, `${frontage.id} frontage must remain within the interaction radius`);
  }
  const frontageBlockers = city.blockers.filter(blocker => blocker.kind === "business-frontage");
  assert.equal(frontageBlockers.length, 3);
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
  assert.equal(city.stats.instances, 5_535);
  assert.equal(city.stats.streetDetailInstances, 1_270);
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
  assert.deepEqual(chapter.leahAnchor, [-44, 0.2, -16.5]);
  assert.deepEqual(chapter.leahInteractionAnchor, [-41, 0.2, -17]);
  assert.deepEqual(chapter.manifestInteractionAnchor, chapter.manifestDesk);
  assert.deepEqual(chapter.keeperWitnessAnchor, [-183.1, 0.2, -138.2]);
  assert.ok(Math.hypot(
    chapter.leahAnchor[0] - chapter.leahInteractionAnchor[0],
    chapter.leahAnchor[2] - chapter.leahInteractionAnchor[2],
  ) >= 3, "Leah and Kai must have distinct physical conversation marks");
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
    Math.hypot(node[0] - position[0], node[2] - position[2]) < 1e-9)));
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
  assert.ok(Math.hypot(
    chapter.leahAnchor[0] - commonGround.position[0],
    chapter.leahAnchor[2] - commonGround.position[2],
  ) <= 4.01, "Leah should wait beside Common Ground rather than at a detached marker");

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
