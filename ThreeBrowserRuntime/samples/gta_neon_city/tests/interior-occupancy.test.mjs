import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createPopulationSystem } from "../src/actors/population.mjs";
import {
  createInteriorOccupancyDirector,
  createInteriorOccupancySystem,
  INTERIOR_OCCUPANCY_PHASES,
  INTERIOR_OCCUPANCY_SAVE_VERSION,
} from "../src/game/interior-occupancy.mjs";

const MINUTES_PER_TEST_DAY = 24 * 60;

function createWorld() {
  return {
    pedestrianNodes: [
      [0, 0, 0], [4, 0, 0], [8, 0, 0], [12, 0, 0], [16, 0, 0], [20, 0, 0],
    ],
    spawnPoints: { pedestrians: [], police: [] },
    terrainHeight: () => 0,
    isBlockedCircle: () => false,
    resolveCircleMotion(position, displacement) {
      return position.clone().add(displacement);
    },
  };
}

function buildingContract(overrides = {}) {
  return {
    id: "common-ground",
    exterior: [4, 0, 0],
    threshold: [8, 0, 0],
    capacity: 2,
    visitChance: 1,
    dwellMinutes: [2, 4],
    occupancySlots: [
      { id: "window-seat", position: [12, 0, 0], activity: "coffee", idleMode: "coffee" },
      { id: "community-table", position: [16, 0, 0], activity: "meal", idleMode: "hands" },
      { id: "quiet-seat", position: [20, 0, 0], activity: "reading", idleMode: "phone" },
    ],
    ...overrides,
  };
}

function fixture({ civilianCount = 0, actorIds = [], buildings = [buildingContract()], seed = 740 } = {}) {
  const scene = new THREE.Scene();
  const world = createWorld();
  const population = createPopulationSystem({ scene, world, civilianCount, policeCount: 0 });
  const actors = [];
  for (let index = 0; index < actorIds.length; ++index) {
    actors.push(population.spawn({
      id: actorIds[index],
      name: `Dedicated Civilian ${index + 1}`,
      x: 0,
      z: 0,
    }));
  }
  const occupancy = createInteriorOccupancySystem({
    population,
    buildings,
    actorIds,
    seed,
    bucketMinutes: 30,
  });
  return { scene, world, population, occupancy, actors };
}

function countSceneObjects(scene) {
  let count = 0;
  scene.traverse(() => { count += 1; });
  return count;
}

function occupantEssentials(value) {
  return value.occupants.map(entry => ({
    actorId: entry.actorId,
    buildingId: entry.buildingId,
    slotId: entry.slotId,
    phase: entry.phase,
    phaseSerial: entry.phaseSerial,
    startedBucket: entry.startedBucket,
    dwellDeadline: entry.dwellDeadline,
    requestKey: entry.requestKey,
    reservationKey: entry.reservationKey,
    position: entry.position,
    yaw: entry.yaw,
    state: entry.state,
    idleMode: entry.idleMode,
    destination: entry.destination,
    locationId: entry.locationId,
    activity: entry.activity,
    arrivalRadius: entry.arrivalRadius,
    speedScale: entry.speedScale,
    arrived: entry.arrived,
    dwelling: entry.dwelling,
  }));
}

function runUntil(fixtureValue, predicate, {
  dayIndex = 2,
  minuteOfDay = 8 * 60,
  maximumSteps = 800,
  onStep = null,
} = {}) {
  const { population, occupancy } = fixtureValue;
  for (let step = 0; step < maximumSteps; ++step) {
    const searchesBeforeDirector = population.routineRouteSearches;
    occupancy.update(0.1, { dayIndex, minuteOfDay, captureSnapshot: false });
    assert.equal(population.routineRouteSearches, searchesBeforeDirector,
      "the occupancy update must never search the pedestrian graph");
    const searchesBeforeDrain = population.routineRouteSearches;
    population.flushRoutineRouteSearches(1);
    assert.ok(population.routineRouteSearches - searchesBeforeDrain <= 1,
      "the external drain must perform at most one assignment or repair search");
    const searchesBeforePopulation = population.routineRouteSearches;
    population.update(0.1, { timeHours: minuteOfDay / 60, captureSnapshot: false });
    assert.equal(population.routineRouteSearches, searchesBeforePopulation,
      "population.update must never search the pedestrian graph");
    onStep?.(step);
    if (predicate()) return step + 1;
  }
  return null;
}

test("contracts prewarm without live mutation and deterministically reserve only caller-supplied actor ids", () => {
  assert.equal(createInteriorOccupancyDirector, createInteriorOccupancySystem);
  const first = fixture({ actorIds: ["guest-c", "guest-a", "guest-b"], seed: 901 });
  const beforePopulation = first.population.snapshot();
  const beforeObjects = countSceneObjects(first.scene);
  const beforeSearches = first.population.routineRouteSearches;
  const prepared = first.occupancy.prewarm();
  assert.deepEqual(prepared, {
    ready: true,
    storage: "memory-only",
    diskResources: 0,
    rendererResources: 0,
    runtimeActorAllocations: 0,
    routeSearches: 0,
    liveStateMutations: 0,
    buildingsPrepared: 1,
    slotsPrepared: 3,
    actorIdsPrepared: 3,
    checksum: prepared.checksum,
  });
  assert.ok(Object.isFrozen(prepared));
  assert.strictEqual(first.occupancy.prewarm(), prepared);
  assert.deepEqual(first.population.snapshot(), beforePopulation);
  assert.equal(first.population.routineRouteSearches, beforeSearches);
  assert.equal(countSceneObjects(first.scene), beforeObjects);

  const runtime = first.occupancy.update(0, {
    dayIndex: 2, minuteOfDay: 8 * 60, captureSnapshot: false,
  });
  assert.equal(runtime.occupantCount, 2);
  assert.equal(runtime.reservationCount, 2);
  assert.equal(runtime.pendingRouteCount, 2);
  assert.strictEqual(first.occupancy.update(0, {
    dayIndex: 2, minuteOfDay: 8 * 60, captureSnapshot: false,
  }), runtime, "the live occupancy update must reuse one runtime view");
  assert.equal(first.population.routineRouteSearches, beforeSearches,
    "the initial bucket may queue routes but must not search them");
  assert.equal(countSceneObjects(first.scene), beforeObjects,
    "leasing and queueing occupants must reuse the existing renderer graph");
  const firstSnapshot = first.occupancy.snapshot();
  assert.equal(firstSnapshot.saveVersion, INTERIOR_OCCUPANCY_SAVE_VERSION);
  assert.equal(firstSnapshot.occupants.length, 2);
  assert.equal(new Set(firstSnapshot.occupants.map(entry => entry.actorId)).size, 2);
  assert.equal(new Set(firstSnapshot.occupants.map(entry => entry.slotId)).size, 2,
    "two occupants must never reserve the same physical slot");
  assert.ok(firstSnapshot.occupants.every(entry => ["guest-a", "guest-b", "guest-c"].includes(entry.actorId)));
  const unleased = first.actors.find(actor => !firstSnapshot.occupants.some(entry => entry.actorId === actor.id));
  assert.equal(unleased.managedRoutineOwner, null);
  assert.ok(Object.isFrozen(firstSnapshot));

  const second = fixture({ actorIds: ["guest-b", "guest-c", "guest-a"], seed: 901 });
  second.occupancy.update(0, { dayIndex: 2, minuteOfDay: 8 * 60 });
  assert.deepEqual(
    second.occupancy.snapshot().occupants.map(({ actorId, buildingId, slotId, phase, startedBucket }) => ({
      actorId, buildingId, slotId, phase, startedBucket,
    })),
    firstSnapshot.occupants.map(({ actorId, buildingId, slotId, phase, startedBucket }) => ({
      actorId, buildingId, slotId, phase, startedBucket,
    })),
    "seed/day/time/actor/building must select the same leases and slots regardless of input order",
  );

  first.occupancy.dispose();
  second.occupancy.dispose();
  first.population.dispose();
  second.population.dispose();
});

test("police, protected, story-locked, staged, and unlisted civilians never enter occupancy leases", () => {
  const world = createWorld();
  const population = createPopulationSystem({
    scene: new THREE.Scene(), world, civilianCount: 2, policeCount: 1,
  });
  const eligible = population.actors.find(actor => actor.id === "civilian-1");
  const unlisted = population.actors.find(actor => actor.id === "civilian-2");
  const police = population.spawn({ police: true, x: 0, z: 0 });
  const protectedActor = population.spawn({ id: "protected", name: "Protected", protected: true, x: 0, z: 0 });
  const lockedActor = population.spawn({ id: "locked", name: "Locked", stationary: true, x: 0, z: 0 });
  const stagedActor = population.spawn({ id: "staged", name: "Staged", x: 0, z: 0 });
  assert.equal(population.stage(stagedActor, { key: "eligibility", position: [0, 0, 0] }).accepted, true);
  const occupancy = createInteriorOccupancySystem({
    population,
    buildings: [buildingContract({ capacity: 6 })],
    actorIds: [eligible.id, police.id, protectedActor.id, lockedActor.id, stagedActor.id],
    seed: 41,
  });
  occupancy.update(0, { dayIndex: 0, minuteOfDay: 9 * 60 });
  assert.deepEqual(occupancy.snapshot().occupants.map(entry => entry.actorId), [eligible.id]);
  assert.equal(unlisted.managedRoutineOwner, null,
    "an ordinary civilian omitted from actorIds must never be discovered or leased implicitly");
  assert.equal(police.managedRoutineOwner, null);
  assert.equal(protectedActor.managedRoutineOwner, null);
  assert.equal(lockedActor.managedRoutineOwner, null);
  assert.equal(stagedActor.managedRoutineOwner, null);
  occupancy.dispose();
  population.release(stagedActor);
  population.dispose();
});

test("one actor continuously traverses exterior, threshold, interior dwell, and the same exit path", () => {
  const value = fixture({
    actorIds: ["walking-guest"],
    buildings: [buildingContract({
      capacity: 1,
      dwellMinutes: 1,
      occupancySlots: [{
        id: "counter-seat", position: [12, 0, 0], dwellMinutes: 1, activity: "coffee", idleMode: "coffee",
      }],
    })],
    seed: 72,
  });
  const { population, occupancy, actors } = value;
  const actor = actors[0];
  const initialPosition = actor.root.position.clone();
  const initialObjectCount = countSceneObjects(value.scene);
  occupancy.update(0, { dayIndex: 1, minuteOfDay: 8 * 60, captureSnapshot: false });
  assert.deepEqual(actor.root.position.toArray(), initialPosition.toArray(),
    "starting a visit must queue travel without teleporting the actor");
  assert.equal(population.routineRouteSearches, 0);
  const phaseHistory = [occupancy.snapshot().occupants[0].phase];
  let maximumStepDistance = 0;
  let prior = actor.root.position.clone();
  const entered = runUntil(value, () => occupancy.snapshot().occupants[0]?.phase === INTERIOR_OCCUPANCY_PHASES.DWELL, {
    dayIndex: 1,
    minuteOfDay: 8 * 60,
    onStep() {
      maximumStepDistance = Math.max(maximumStepDistance, actor.root.position.distanceTo(prior));
      prior.copy(actor.root.position);
      const phase = occupancy.snapshot().occupants[0]?.phase;
      if (phase && phase !== phaseHistory.at(-1)) phaseHistory.push(phase);
    },
  });
  assert.ok(entered, "the actor did not reach its interior dwell slot");
  assert.deepEqual(phaseHistory, [
    INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR,
    INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD,
    INTERIOR_OCCUPANCY_PHASES.TO_INTERIOR,
    INTERIOR_OCCUPANCY_PHASES.DWELL,
  ]);
  assert.ok(maximumStepDistance > 0 && maximumStepDistance < 0.5,
    `managed motion must be visibly continuous; largest 100ms step was ${maximumStepDistance}`);
  const dwelling = occupancy.snapshot().occupants[0];
  assert.equal(dwelling.slotId, "counter-seat");
  assert.equal(dwelling.idleMode, "coffee");
  assert.equal(dwelling.arrived, true);
  assert.equal(dwelling.dwelling, true);
  population.update(0, { timeHours: 8, captureSnapshot: false });
  assert.equal(actor.state, "routine_dwell");
  assert.equal(actor.visual.userData.props.coffee.visible, true,
    "a dwell mode should visibly inhabit the slot instead of using a motionless travel pose");
  assert.equal(dwelling.dwellDeadline, MINUTES_PER_TEST_DAY + 8 * 60 + 1);
  const held = occupantEssentials(occupancy.snapshot());
  for (let repeat = 0; repeat < 8; ++repeat) {
    occupancy.update(0.1, { dayIndex: 1, minuteOfDay: 8 * 60 });
  }
  assert.deepEqual(occupantEssentials(occupancy.snapshot()), held,
    "dwell must not advance from per-frame updates before its clock deadline");

  occupancy.update(0, {
    dayIndex: Math.floor(dwelling.dwellDeadline / MINUTES_PER_TEST_DAY),
    minuteOfDay: dwelling.dwellDeadline % MINUTES_PER_TEST_DAY,
  });
  assert.equal(occupancy.snapshot().occupants[0].phase, INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT);
  phaseHistory.push(INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT);
  const exited = runUntil(value, () => occupancy.occupantCount === 0, {
    dayIndex: Math.floor(dwelling.dwellDeadline / MINUTES_PER_TEST_DAY),
    minuteOfDay: dwelling.dwellDeadline % MINUTES_PER_TEST_DAY,
    onStep() {
      const phase = occupancy.snapshot().occupants[0]?.phase;
      if (phase && phase !== phaseHistory.at(-1)) phaseHistory.push(phase);
    },
  });
  assert.ok(exited, "the actor did not complete its exit itinerary");
  assert.deepEqual(phaseHistory, [
    INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR,
    INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD,
    INTERIOR_OCCUPANCY_PHASES.TO_INTERIOR,
    INTERIOR_OCCUPANCY_PHASES.DWELL,
    INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT,
    INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR_EXIT,
  ]);
  assert.equal(actor.managedRoutineOwner, null);
  assert.equal(actor.routineDestinationActive, false);
  assert.notEqual(actor.idleMode, "coffee",
    "releasing a managed visit must not leak its interior dwell presentation into ambient life");
  assert.ok(Math.abs(actor.root.position.x - 4) <= 0.6,
    "release must occur only after the actor visibly returns to the exterior anchor");
  assert.equal(countSceneObjects(value.scene), initialObjectCount,
    "the complete itinerary must reuse the existing actor and renderer graph");

  for (let repeat = 0; repeat < 6; ++repeat) {
    occupancy.update(0, {
      dayIndex: Math.floor(dwelling.dwellDeadline / MINUTES_PER_TEST_DAY),
      minuteOfDay: dwelling.dwellDeadline % MINUTES_PER_TEST_DAY,
    });
  }
  assert.equal(occupancy.occupantCount, 0,
    "an exited actor must not be reconsidered until the clock enters a new bucket");
  occupancy.update(0, { dayIndex: 1, minuteOfDay: 8 * 60 + 30 });
  assert.equal(occupancy.occupantCount, 1,
    "a new clock bucket is the only idle-state trigger for another deterministic visit");
  occupancy.dispose();
  population.dispose();
});

test("save and restore preserve dwell phase, unique reservation, deadline, pose, and destination exactly", () => {
  const source = fixture({
    actorIds: ["saved-guest"],
    buildings: [buildingContract({
      capacity: 1,
      dwellMinutes: [3, 3],
      occupancySlots: [{
        id: "saved-seat", position: [12, 0, 0], dwellMinutes: [3, 3], activity: "reading", idleMode: "phone",
      }],
    })],
    seed: 808,
  });
  assert.ok(runUntil(source, () => source.occupancy.snapshot().occupants[0]?.phase === INTERIOR_OCCUPANCY_PHASES.DWELL, {
    dayIndex: 4, minuteOfDay: 10 * 60,
  }));
  source.actors[0].root.rotation.y = 0.625;
  const sourceSnapshot = source.occupancy.snapshot();
  const saved = source.occupancy.save();
  assert.equal(saved.version, INTERIOR_OCCUPANCY_SAVE_VERSION);
  assert.equal(saved.occupants[0].dwellDeadline, 4 * MINUTES_PER_TEST_DAY + 10 * 60 + 3);

  const restored = fixture({
    actorIds: ["saved-guest"],
    buildings: [buildingContract({
      capacity: 1,
      dwellMinutes: [3, 3],
      occupancySlots: [{
        id: "saved-seat", position: [12, 0, 0], dwellMinutes: [3, 3], activity: "reading", idleMode: "phone",
      }],
    })],
    seed: 999,
  });
  const searchesBeforeRestore = restored.population.routineRouteSearches;
  restored.occupancy.restore(saved);
  assert.equal(restored.population.routineRouteSearches, searchesBeforeRestore,
    "restore may rebuild metadata but must leave graph search to the external drain");
  assert.deepEqual(occupantEssentials(restored.occupancy.snapshot()), occupantEssentials(sourceSnapshot));
  assert.deepEqual(restored.occupancy.snapshot().reservations, sourceSnapshot.reservations);
  assert.equal(restored.occupancy.snapshot().reservations.length, 1);
  assert.equal(restored.actors[0].managedRoutineOwner, restored.occupancy.ownerId);
  assert.equal(restored.actors[0].routineDestinationArrived, true,
    "an arrived dwell save must restore without inventing another route leg");
  assert.equal(restored.population.pendingRoutineRouteRequests, 0);

  restored.occupancy.update(0, {
    dayIndex: Math.floor((saved.occupants[0].dwellDeadline - 1) / MINUTES_PER_TEST_DAY),
    minuteOfDay: (saved.occupants[0].dwellDeadline - 1) % MINUTES_PER_TEST_DAY,
  });
  assert.equal(restored.occupancy.snapshot().occupants[0].phase, INTERIOR_OCCUPANCY_PHASES.DWELL);
  restored.occupancy.update(0, {
    dayIndex: Math.floor(saved.occupants[0].dwellDeadline / MINUTES_PER_TEST_DAY),
    minuteOfDay: saved.occupants[0].dwellDeadline % MINUTES_PER_TEST_DAY,
  });
  assert.equal(restored.occupancy.snapshot().occupants[0].phase,
    INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT);
  assert.equal(restored.population.pendingRoutineRouteRequests, 1);

  const duplicateSave = structuredClone(saved);
  duplicateSave.occupants.push(structuredClone(duplicateSave.occupants[0]));
  restored.occupancy.restore(duplicateSave);
  assert.equal(restored.occupancy.occupantCount, 1,
    "duplicate save entries must not duplicate an actor or physical slot reservation");
  assert.equal(restored.occupancy.reservationCount, 1);
  source.occupancy.dispose();
  restored.occupancy.dispose();
  source.population.dispose();
  restored.population.dispose();
});
