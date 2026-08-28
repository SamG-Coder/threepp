import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCATION_IDS,
  LOCATION_REGISTRY,
  START_LOCATION_ID,
} from "../src/game/locations.mjs";
import {
  completeLocationObjective,
  createLocationProgress,
  getAvailableObjectives,
  getLocation,
  getLocationExit,
  getSpawnPoint,
  resolveLocationTravel,
  validateLocationRegistry,
} from "../src/game/location-graph.mjs";

test("the location registry is valid, immutable JSON data", () => {
  const validation = validateLocationRegistry(LOCATION_REGISTRY);
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.ok(Object.isFrozen(LOCATION_REGISTRY));
  assert.deepEqual(JSON.parse(JSON.stringify(LOCATION_REGISTRY)), LOCATION_REGISTRY);

  assert.equal(LOCATION_REGISTRY.locations.length, 2);
  assert.equal(START_LOCATION_ID, LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH);
  assert.deepEqual(
    getLocation(LOCATION_REGISTRY, LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH).source.coordinate,
    [150.9868024, -33.3852776],
  );
  assert.deepEqual(
    getLocation(LOCATION_REGISTRY, LOCATION_IDS.MACDONALD_RIVER_FIRST_BRANCH).source.coordinate,
    [150.984994, -33.3783594],
  );
});

test("map views and game targets retain their real river coordinates", () => {
  const broadReach = getLocation(LOCATION_REGISTRY, LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH);
  const firstBranch = getLocation(LOCATION_REGISTRY, LOCATION_IDS.MACDONALD_RIVER_FIRST_BRANCH);

  assert.deepEqual(broadReach.mapView.origin, [150.9868024, -33.3852776]);
  assert.equal(broadReach.mapView.metresToWorld, 0.1);
  assert.deepEqual(broadReach.spawnPoints[0].sourceCoordinate, [150.9868024, -33.3852776]);
  assert.deepEqual(broadReach.objectives[0].completion.sourceCoordinate, [150.9892372, -33.3818903]);
  assert.deepEqual(broadReach.exits[0].trigger.sourceCoordinate, [150.989, -33.3793]);

  assert.deepEqual(firstBranch.mapView.origin, [150.984994, -33.3783594]);
  assert.equal(firstBranch.mapView.metresToWorld, 0.1);
  assert.deepEqual(firstBranch.spawnPoints[0].sourceCoordinate, [150.984994, -33.3783594]);
  assert.deepEqual(firstBranch.objectives[0].completion.sourceCoordinate, [150.9857723, -33.3755297]);
  assert.deepEqual(firstBranch.exits[0].trigger.sourceCoordinate, [150.984994, -33.3783594]);
});

test("locations have distinct seeded path profiles and reciprocal connections", () => {
  const broadReach = getLocation(LOCATION_REGISTRY, LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH);
  const firstBranch = getLocation(LOCATION_REGISTRY, LOCATION_IDS.MACDONALD_RIVER_FIRST_BRANCH);

  assert.notEqual(broadReach.pathProfile.seed, firstBranch.pathProfile.seed);
  assert.notDeepEqual(broadReach.pathProfile.knots, firstBranch.pathProfile.knots);

  const outbound = getLocationExit(broadReach, "east-bank-to-first-branch");
  const inbound = getLocationExit(firstBranch, outbound.reciprocalExitId);
  assert.equal(outbound.destination.locationId, firstBranch.id);
  assert.equal(inbound.destination.locationId, broadReach.id);
  assert.equal(inbound.reciprocalExitId, outbound.id);
  assert.equal(getSpawnPoint(firstBranch, outbound.destination.spawnId).id, "from-broad-reach");
});

test("validation reports broken destinations and reciprocal edges", () => {
  const broken = JSON.parse(JSON.stringify(LOCATION_REGISTRY));
  broken.locations[0].exits[0].destination.locationId = "missing-location";

  const validation = validateLocationRegistry(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("unknown destination location")));
  assert.ok(validation.errors.some((error) => error.includes("missing reciprocal exit")));
});

test("progression unlocks travel in both directions without mutating prior state", () => {
  const initial = createLocationProgress(LOCATION_REGISTRY);
  assert.deepEqual(initial, {
    schemaVersion: 1,
    currentLocationId: LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH,
    currentSpawnId: "ferry-bank",
    visitedLocationIds: [LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH],
    completedObjectiveIds: [],
  });
  assert.deepEqual(
    getAvailableObjectives(LOCATION_REGISTRY, initial).map((objective) => objective.id),
    ["survey-broad-reach"],
  );

  const lockedOutbound = resolveLocationTravel(
    LOCATION_REGISTRY,
    initial,
    "east-bank-to-first-branch",
  );
  assert.equal(lockedOutbound.ok, false);
  assert.equal(lockedOutbound.reason, "exit-locked");
  assert.deepEqual(lockedOutbound.missingObjectiveIds, ["survey-broad-reach"]);

  const surveyed = completeLocationObjective(LOCATION_REGISTRY, initial, "survey-broad-reach");
  assert.equal(surveyed.ok, true);
  assert.equal(surveyed.changed, true);
  assert.deepEqual(initial.completedObjectiveIds, []);

  const outbound = resolveLocationTravel(
    LOCATION_REGISTRY,
    surveyed.progress,
    "east-bank-to-first-branch",
  );
  assert.equal(outbound.ok, true);
  assert.deepEqual(outbound.transition, {
    fromLocationId: LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH,
    exitId: "east-bank-to-first-branch",
    toLocationId: LOCATION_IDS.MACDONALD_RIVER_FIRST_BRANCH,
    spawnId: "from-broad-reach",
    spawn: {
      position: { x: -89, z: 20.92 },
      sourceCoordinate: [150.984994, -33.3783594],
      facing: "east",
    },
  });
  assert.deepEqual(outbound.progress.visitedLocationIds, [
    LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH,
    LOCATION_IDS.MACDONALD_RIVER_FIRST_BRANCH,
  ]);
  assert.deepEqual(
    getAvailableObjectives(LOCATION_REGISTRY, outbound.progress).map((objective) => objective.id),
    ["trace-first-branch"],
  );

  const lockedReturn = resolveLocationTravel(
    LOCATION_REGISTRY,
    outbound.progress,
    "west-bank-to-broad-reach",
  );
  assert.equal(lockedReturn.ok, false);
  assert.deepEqual(lockedReturn.missingObjectiveIds, ["trace-first-branch"]);

  const traced = completeLocationObjective(
    LOCATION_REGISTRY,
    outbound.progress,
    "trace-first-branch",
  );
  const returned = resolveLocationTravel(
    LOCATION_REGISTRY,
    traced.progress,
    "west-bank-to-broad-reach",
  );
  assert.equal(returned.ok, true);
  assert.equal(returned.progress.currentLocationId, LOCATION_IDS.WISEMANS_FERRY_BROAD_REACH);
  assert.equal(returned.progress.currentSpawnId, "from-first-branch");
  assert.equal(returned.progress.visitedLocationIds.length, 2);
  assert.deepEqual(returned.progress.completedObjectiveIds, [
    "survey-broad-reach",
    "trace-first-branch",
  ]);
});

test("objectives cannot be completed from the wrong location", () => {
  const initial = createLocationProgress(LOCATION_REGISTRY);
  const result = completeLocationObjective(LOCATION_REGISTRY, initial, "trace-first-branch");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "objective-not-in-current-location");
  assert.equal(result.progress, initial);
});
