import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import {
  createPopulationSystem,
  ROADSIDE_OBSERVER_RADIUS,
  ROADSIDE_OBSERVER_STATES,
} from "../src/actors/population.mjs";

function createTestWorld({ emptySpawns = false, wall = false } = {}) {
  const state = { wall };
  const blocked = (x, z, radius = 0) => state.wall && Math.abs(z - 5) < 0.45 + radius;
  const world = {
    spawnPoints: {
      pedestrians: emptySpawns ? [] : [[0, 0, 0], [20, 0, 0], [0, 0, 20], [-20, 0, 0]],
      police: emptySpawns ? [] : [[0, 0, 10], [10, 0, 12], [-10, 0, 12]],
    },
    terrainHeight: () => 0,
    isBlockedCircle: blocked,
    resolveCircleMotion(position, displacement, radius) {
      const next = position.clone();
      if (!blocked(next.x + displacement.x, next.z, radius)) next.x += displacement.x;
      if (!blocked(next.x, next.z + displacement.z, radius)) next.z += displacement.z;
      return next;
    },
  };
  return { world, state };
}

function countSceneObjects(scene) {
  let count = 0;
  scene.traverse(() => { count += 1; });
  return count;
}

function visibleRenderableMetrics(root, referenceRoot) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().makeEmpty();
  const meshBounds = new THREE.Box3();
  let meshes = 0;
  root.traverse(object => {
    if (!object.isMesh) return;
    for (let ancestor = object; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible) return;
      if (ancestor === root) break;
    }
    object.geometry.computeBoundingBox();
    meshBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    bounds.union(meshBounds);
    meshes += 1;
  });
  const referencePosition = referenceRoot.getWorldPosition(new THREE.Vector3());
  return Object.freeze({
    meshes,
    minY: bounds.min.y - referencePosition.y,
    maxY: bounds.max.y - referencePosition.y,
    height: bounds.max.y - bounds.min.y,
  });
}

test("population accepts native control-pipe position shapes and normalized hitscan rays", () => {
  const { world } = createTestWorld({ emptySpawns: true });
  const scene = new THREE.Scene();
  const population = createPopulationSystem({ scene, world, civilianCount: 1, policeCount: 1 });
  const pedestrian = population.spawn({ x: 0, z: 0 });

  const hit = population.raycast({ x: 0, y: 1.1, z: 5 }, [0, 0, -7], 10);
  assert.equal(hit?.actor, pedestrian);
  assert.ok(hit.distance > 4 && hit.distance < 5);
  assert.ok(hit.point.isVector3);
  assert.equal(population.raycast([0, 1, 5], [0, 0, 0], 10), null);

  assert.doesNotThrow(() => population.alert({ x: 0, y: 0, z: 0 }, "gunfire"));
  assert.doesNotThrow(() => population.update(0.1, { targetPosition: [0, 0, 0], wantedStars: 1 }));
  const snapshot = population.snapshot();
  assert.ok(snapshot.some(actor => actor.police && actor.active));
  for (const actor of snapshot) {
    assert.ok(actor.position.every(Number.isFinite));
    assert.ok(Number.isFinite(actor.yaw));
    assert.ok(Number.isFinite(actor.speed));
    assert.ok(Object.isFrozen(actor.position));
  }

  population.dispose();
  assert.doesNotThrow(() => population.dispose(), "disposal should be idempotent");
});

test("hidden spawn reserves preserve authored snapshots and prevent first-use render allocation", () => {
  const { world } = createTestWorld({ emptySpawns: true });
  const scene = new THREE.Scene();
  const population = createPopulationSystem({ scene, world, civilianCount: 2, policeCount: 1 });
  const countSceneObjects = () => {
    let count = 0;
    scene.traverse(() => { count += 1; });
    return count;
  };
  const authoredActors = population.actors.length;
  const authoredSnapshot = population.snapshot();
  const objectsBeforeReserve = countSceneObjects();

  const prepared = population.ensureSpawnReserve(2);
  assert.deepEqual(prepared, {
    ready: true,
    storage: "memory-only",
    prepared: 2,
    available: 2,
    claimed: 0,
    runtimeActorAllocations: 0,
  });
  assert.ok(Object.isFrozen(prepared));
  assert.equal(population.actors.length, authoredActors,
    "hidden reserve actors must not change the authored simulation population");
  assert.deepEqual(population.snapshot(), authoredSnapshot,
    "hidden reserve actors must not leak into public world snapshots");
  assert.ok(countSceneObjects() > objectsBeforeReserve,
    "reserve visuals must already exist in the renderer scene before play");

  const reserveRoots = [];
  scene.traverse(object => {
    if (object.userData.spawnReserve === true) reserveRoots.push(object);
  });
  assert.equal(reserveRoots.length, 2);
  assert.ok(reserveRoots.every(object => object.visible === false));
  const objectsAfterReserve = countSceneObjects();
  assert.deepEqual(population.ensureSpawnReserve(2), prepared,
    "repeated startup preparation should be allocation-free and deterministic");
  assert.equal(countSceneObjects(), objectsAfterReserve);

  const first = population.spawn({ id: "reserved-ped-1", x: 4, z: 5 });
  const second = population.spawn({ id: "reserved-ped-2", x: 6, z: 5 });
  assert.ok(reserveRoots.includes(first.root) && reserveRoots.includes(second.root));
  assert.ok(first.active && first.root.visible && second.active && second.root.visible);
  assert.equal(first.root.userData.spawnReserve, false);
  assert.equal(second.root.userData.spawnReserve, false);
  assert.equal(countSceneObjects(), objectsAfterReserve,
    "claiming a prepared actor must not add any renderer objects");
  assert.equal(population.actors.length, authoredActors + 2);
  assert.equal(population.snapshot().length, authoredSnapshot.length + 2);
  assert.deepEqual(population.spawnReserveSnapshot(), {
    ready: true,
    storage: "memory-only",
    prepared: 2,
    available: 0,
    claimed: 2,
    runtimeActorAllocations: 0,
  });

  population.dispose();
});

test("grounded full and distant pedestrian rigs share a 1.9m envelope without LOD allocations", () => {
  const { world } = createTestWorld();
  const scene = new THREE.Scene();
  const population = createPopulationSystem({ scene, world, civilianCount: 2, policeCount: 0 });
  const actor = population.actors[0];
  const otherActor = population.actors[1];
  const objectsBeforeSwitches = countSceneObjects(scene);

  assert.equal(actor.root.position.y, 0, "simulation and collision root must stay on terrain");
  assert.equal(actor.visual.position.y, -0.29, "only the full authored body rig receives the grounding offset");
  const full = visibleRenderableMetrics(actor.visual, actor.root);
  assert.equal(full.meshes, 15, "the full-detail renderer mesh count must remain unchanged");
  assert.ok(Math.abs(full.minY - 0.015) < 1e-6, full);
  assert.ok(Math.abs(full.maxY - 1.902) < 1e-6, full);
  assert.ok(Math.abs(full.height - 1.887) < 1e-6, full);

  const distantBody = actor.distantVisual.getObjectByName("distance full-body silhouette");
  const otherDistantBody = otherActor.distantVisual.getObjectByName("distance full-body silhouette");
  assert.ok(distantBody?.isMesh);
  assert.strictEqual(distantBody.geometry, otherDistantBody.geometry,
    "all driving-distance pedestrians must reuse one silhouette geometry");
  assert.strictEqual(distantBody.material, actor.visual.userData.bodyMaterial,
    "the corrected LOD must reuse the existing authored clothing material");

  // Transfer a representative breathing offset to prove the two rigs do not
  // jump vertically when the hysteresis boundary changes their visibility.
  actor.visual.position.y += 0.009;
  const breathingFull = visibleRenderableMetrics(actor.visual, actor.root);
  population.update(0, { targetPosition: [100, 0, 0], rain: 0 });
  assert.equal(actor.detailLevel, "distant");
  const distantDry = visibleRenderableMetrics(actor.distantVisual, actor.root);
  assert.equal(distantDry.meshes, 2, "dry distant rendering must stay body plus head");
  assert.ok(Math.abs(distantDry.minY - breathingFull.minY) < 1e-6,
    { full: breathingFull, distant: distantDry });
  assert.ok(Math.abs(distantDry.maxY - breathingFull.maxY) < 1e-6,
    { full: breathingFull, distant: distantDry });

  population.update(0, { targetPosition: [100, 0, 0], rain: 1 });
  const distantRain = visibleRenderableMetrics(actor.distantVisual, actor.root);
  assert.equal(distantRain.meshes, 3, "rain may reveal only the already-pooled umbrella mesh");
  assert.ok(Math.abs(distantRain.minY - breathingFull.minY) < 1e-6, distantRain);
  assert.ok(Math.abs(distantRain.maxY - 2.289) < 1e-6, distantRain);

  for (let index = 0; index < 600; ++index) {
    population.update(0, {
      targetPosition: index % 2 ? [0, 0, 0] : [100, 0, 0],
      rain: index % 3 === 0 ? 1 : 0,
    });
  }
  assert.equal(countSceneObjects(scene), objectsBeforeSwitches,
    "repeated full/distant/weather switches must not allocate renderer objects");
  assert.equal(actor.detailLevel, "full");
  assert.equal(visibleRenderableMetrics(actor.visual, actor.root).meshes, 15);
  population.dispose();
});

test("named story actors receive distinct close-up facial and role details", () => {
  const { world } = createTestWorld();
  const population = createPopulationSystem({ scene: new THREE.Scene(), world, civilianCount: 0, policeCount: 0 });
  const juno = population.spawn({
    id: "juno", role: "sister-and-mechanic", stationary: true, protected: true, x: 0, z: 0,
  });
  const rin = population.spawn({
    id: "rin", role: "friend-and-data-analyst", stationary: true, protected: true, x: 2, z: 0,
  });
  for (const actor of [juno, rin]) {
    assert.ok(actor.visual.getObjectByName("story left eye"));
    assert.ok(actor.visual.getObjectByName("story right eye"));
    assert.ok(actor.visual.getObjectByName("story defined nose"));
    assert.ok(actor.visual.getObjectByName("story mouth"));
  }
  assert.ok(juno.visual.getObjectByName("Juno tied-back hair"));
  assert.ok(juno.visual.getObjectByName("Juno garage workwear patch"));
  assert.ok(rin.visual.getObjectByName("left analyst glasses lens"));
  assert.ok(rin.visual.getObjectByName("right analyst glasses lens"));
  assert.equal(juno.storyProtected && rin.storyProtected, true);
  population.dispose();
});

test("ambient civilians stage through a taxi ride without changing population or renderer allocation", () => {
  const { world } = createTestWorld();
  const scene = new THREE.Scene();
  const population = createPopulationSystem({ scene, world, civilianCount: 3, policeCount: 1 });
  const actor = population.actors.find(entry => !entry.police);
  actor.root.position.set(3, 0, 4);
  actor.homePosition.set(-2, 0, 1);
  actor.root.rotation.y = 0.41;
  actor.velocity.set(0.2, 0, -0.1);
  actor.steering.set(-0.4, 0, 0.3);
  actor.speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  actor.state = "wander";
  actor.stateTime = 0.73;
  actor.idleMode = "look";
  const original = {
    id: actor.id,
    displayName: actor.displayName,
    rootName: actor.root.name,
    routine: actor.routine,
    position: actor.root.position.toArray(),
    home: actor.homePosition.toArray(),
    yaw: actor.root.rotation.y,
    velocity: actor.velocity.toArray(),
    steering: actor.steering.toArray(),
    speed: actor.speed,
    state: actor.state,
    stateTime: actor.stateTime,
    idleMode: actor.idleMode,
    visible: actor.root.visible,
  };
  const actorCount = population.actors.length;
  const snapshotCount = population.snapshot().length;
  const sceneObjects = countSceneObjects(scene);

  const curb = population.stage(actor, {
    key: "taxi:night-shift-1",
    kind: "taxi-passenger",
    name: "Amaya Singh",
    phase: "curb",
    position: [6, 0, 5],
    yaw: 1.2,
    visible: true,
  });
  assert.ok(Object.isFrozen(curb));
  assert.ok(Object.isFrozen(curb.position));
  assert.deepEqual(curb, {
    accepted: true,
    reason: null,
    actorId: original.id,
    displayName: "Amaya Singh",
    presentationKind: "taxi-passenger",
    presentationKey: "taxi:night-shift-1",
    phase: "curb",
    visible: true,
    position: [6, 0, 5],
    observationIncidentId: null,
    observationKind: null,
  });
  assert.equal(actor.id, original.id, "presentation must not replace the ambient actor's stable id");
  assert.equal(actor.storyLocked, true);
  assert.equal(actor.storyProtected, true);
  assert.deepEqual(population.damage(actor, 10, "player"), {
    accepted: false,
    protected: true,
    id: actor.id,
    health: actor.health,
    alive: true,
    police: false,
  });
  population.update(0.1, { captureSnapshot: false });
  assert.equal(actor.root.visible, true);
  assert.deepEqual(actor.root.position.toArray(), [6, 0, 5]);

  const onboard = population.stage(actor.id, {
    key: "taxi:night-shift-1",
    phase: "onboard",
    visible: false,
  });
  assert.equal(onboard.accepted, true);
  assert.equal(onboard.visible, false);
  population.update(0.1, { captureSnapshot: false });
  assert.equal(actor.root.visible, false,
    "the locked-actor update must not reveal an explicitly hidden onboard passenger");
  const onboardSnapshot = population.snapshot().find(entry => entry.id === actor.id);
  assert.equal(onboardSnapshot.staged, true);
  assert.equal(onboardSnapshot.presentationVisible, false);
  assert.equal(onboardSnapshot.presentationKind, "taxi-passenger");
  assert.equal(onboardSnapshot.presentationPhase, "onboard");

  const dropoff = population.stage(actor, {
    key: "taxi:night-shift-1",
    phase: "dropoff",
    position: [11, 0, -3],
    yaw: -0.7,
    visible: true,
  });
  assert.equal(dropoff.accepted, true);
  population.update(0.1, { captureSnapshot: false });
  assert.equal(actor.root.visible, true);
  assert.deepEqual(actor.root.position.toArray(), [11, 0, -3]);

  const released = population.release(actor.id);
  assert.equal(released.accepted, true);
  assert.deepEqual({
    id: actor.id,
    displayName: actor.displayName,
    rootName: actor.root.name,
    routine: actor.routine,
    position: actor.root.position.toArray(),
    home: actor.homePosition.toArray(),
    yaw: actor.root.rotation.y,
    velocity: actor.velocity.toArray(),
    steering: actor.steering.toArray(),
    speed: actor.speed,
    state: actor.state,
    stateTime: actor.stateTime,
    idleMode: actor.idleMode,
    visible: actor.root.visible,
  }, original, "release must restore the borrowed actor's identity and ambient routine exactly");
  assert.equal(actor.storyLocked, false);
  assert.equal(actor.storyProtected, false);
  assert.equal(actor.presentationStaged, false);
  assert.equal(population.actors.length, actorCount);
  assert.equal(population.snapshot().length, snapshotCount);
  assert.equal(countSceneObjects(scene), sceneObjects,
    "curb, onboard, drop-off, and release must reuse the existing actor root");
  assert.deepEqual(population.presentationSnapshot(), {
    publicActorCount: actorCount,
    stagedCount: 0,
    hiddenCount: 0,
    observationCount: 0,
    stageClaims: 1,
    stageUpdates: 2,
    stageReleases: 1,
    runtimeNodeAllocations: 0,
    entries: [],
  });
  assert.ok(Object.isFrozen(population.presentationSnapshot()));
  assert.ok(Object.isFrozen(population.presentationSnapshot().entries));

  const storyActor = population.spawn({
    id: "protected-story-actor",
    name: "Juno",
    role: "sister-and-mechanic",
    stationary: true,
    protected: true,
    x: 0,
    z: 0,
  });
  const storyBefore = population.snapshot().find(entry => entry.id === storyActor.id);
  assert.equal(population.stage(storyActor, { name: "Taxi passenger" }).reason, "actor_reserved");
  assert.deepEqual(population.snapshot().find(entry => entry.id === storyActor.id), storyBefore,
    "authored story actors must never be repurposed by presentation staging");
  population.dispose();
});

test("roadside observation deterministically borrows a calm phone-watching civilian and releases it", () => {
  const { world } = createTestWorld();
  const scene = new THREE.Scene();
  let crimes = 0;
  const population = createPopulationSystem({
    scene,
    world,
    civilianCount: 3,
    policeCount: 0,
    onCrime: () => { crimes += 1; },
  });
  const [first, second, third] = population.actors;
  first.root.position.set(2, 0, 0);
  first.homePosition.set(6, 0, 6);
  second.root.position.set(-2, 0, 0);
  second.homePosition.set(-6, 0, 6);
  third.root.position.set(18, 0, 0);
  third.homePosition.set(18, 0, 6);
  for (const actor of population.actors) {
    actor.state = "wander";
    actor.panicUntil = 0;
    actor.witnessUntil = 0;
    actor.pendingAlert = null;
    actor.socialPartner = null;
  }
  const storyActor = population.spawn({
    id: "roadside-story-actor",
    name: "Juno",
    role: "sister-and-mechanic",
    stationary: true,
    protected: true,
    x: 0.25,
    z: 0,
  });
  const originalFirst = {
    name: first.displayName,
    routine: first.routine,
    position: first.root.position.toArray(),
    home: first.homePosition.toArray(),
    yaw: first.root.rotation.y,
    state: first.state,
    idleMode: first.idleMode,
  };
  const actorCount = population.actors.length;
  const sceneObjects = countSceneObjects(scene);

  const observation = population.observe("begin", "roadside-flat-7", "flat-tire", 0, 0);
  assert.equal(observation, first.id,
    "the closest story actor must be preserved, then equal-distance ambient candidates resolve by stable order");
  assert.equal(storyActor.displayName, "Juno");
  assert.equal(storyActor.storyRole, "sister-and-mechanic");
  assert.ok(Math.abs(first.root.rotation.y - Math.PI / 2) < 1e-9,
    "the observer should face the incident without approaching or panicking");
  population.update(0.1, { captureSnapshot: false });
  assert.equal(first.state, "idle");
  assert.equal(first.idleMode, "phone");
  assert.equal(first.visual.userData.props.phone.visible, true);
  assert.equal(first.panicUntil, 0);
  assert.equal(first.witnessUntil, 0);
  assert.equal(first.pendingAlert, null);
  assert.equal(population.crimesWitnessed, 0);
  assert.equal(crimes, 0);
  assert.equal(population.damage(first, 10, "player").protected, true);
  assert.equal(population.crimesWitnessed, 0,
    "a protected documentary observer must not become a crime/panic source");
  assert.equal(crimes, 0);

  const repeat = population.observe("watch", "roadside-flat-7", "flat-tire", 0, 0);
  assert.equal(repeat, first.id, "repeated incident updates must be idempotent");
  assert.deepEqual(population.presentationSnapshot(), {
    publicActorCount: actorCount,
    stagedCount: 1,
    hiddenCount: 0,
    observationCount: 1,
    stageClaims: 1,
    stageUpdates: 1,
    stageReleases: 0,
    runtimeNodeAllocations: 0,
    entries: [{
      actorId: first.id,
      displayName: first.displayName,
      kind: "roadside-observer",
      key: "roadside:roadside-flat-7",
      phase: "phone-watch",
      visible: true,
      observationIncidentId: "roadside-flat-7",
      observationKind: "flat-tire",
      position: [2, 0, 0],
    }],
  });
  const observedSnapshot = population.snapshot().find(entry => entry.id === first.id);
  assert.equal(observedSnapshot.observationIncidentId, "roadside-flat-7");
  assert.equal(observedSnapshot.observationKind, "flat-tire");
  assert.equal(observedSnapshot.idleMode, "phone");
  assert.equal(observedSnapshot.storyProtected, true);

  const cleared = population.observe("clear", "roadside-flat-7", "flat-tire", 0, 0);
  assert.equal(cleared, first.id);
  assert.deepEqual({
    name: first.displayName,
    routine: first.routine,
    position: first.root.position.toArray(),
    home: first.homePosition.toArray(),
    yaw: first.root.rotation.y,
    state: first.state,
    idleMode: first.idleMode,
  }, originalFirst);
  assert.equal(first.storyLocked, false);
  assert.equal(first.storyProtected, false);
  assert.equal(population.presentationSnapshot().observationCount, 0);
  assert.equal(population.observe("begin", "too-far", "flat-tire", 500, 500), null);
  assert.equal(population.actors.length, actorCount);
  assert.equal(countSceneObjects(scene), sceneObjects);
  population.dispose();
});

test("roadside observer borrowing uses the exported one-block boundary without teleporting", () => {
  assert.equal(ROADSIDE_OBSERVER_RADIUS, 48);
  assert.deepEqual(ROADSIDE_OBSERVER_STATES, [
    "wander",
    "idle",
    "transit_approach",
    "transit_wait",
    "crosswalk_approach",
    "crosswalk_wait",
    "return",
    "yield",
  ]);
  assert.ok(Object.isFrozen(ROADSIDE_OBSERVER_STATES));
  const { world } = createTestWorld();
  const scene = new THREE.Scene();
  const population = createPopulationSystem({ scene, world, civilianCount: 1, policeCount: 0 });
  const actor = population.actors[0];
  actor.root.position.set(0, 0, 0);
  actor.homePosition.set(7, 0, -3);
  actor.state = "wander";
  actor.panicUntil = 0;
  actor.witnessUntil = 0;
  actor.pendingAlert = null;
  const originalPosition = actor.root.position.toArray();
  const originalHome = actor.homePosition.toArray();
  const actorCount = population.actors.length;
  const sceneObjects = countSceneObjects(scene);

  for (const state of ROADSIDE_OBSERVER_STATES) {
    actor.state = state;
    actor.panicUntil = 0;
    actor.witnessUntil = 0;
    actor.pendingAlert = null;
    actor.socialPartner = null;
    actor.root.visible = true;
    assert.equal(population.snapshot()[0].roadsideObserverEligible, true, state);
    assert.equal(population.observe("begin", `safe-${state}`, "breakdown", 1, 0), actor.id, state);
    assert.deepEqual(actor.root.position.toArray(), originalPosition, `${state} observer moved to the incident`);
    assert.equal(population.observe("clear", `safe-${state}`, "breakdown", 1, 0), actor.id, state);
    assert.equal(actor.state, state, `${state} routine was not restored`);
  }

  for (const state of ["crosswalk_cross", "flee", "witness", "social", "hit", "stumble", "down", "ragdoll"]) {
    actor.state = state;
    assert.equal(population.snapshot()[0].roadsideObserverEligible, false, state);
    assert.equal(population.observe("begin", `unsafe-${state}`, "breakdown", 1, 0), null, state);
  }

  actor.state = "wander";
  actor.panicUntil = 10;
  assert.equal(population.snapshot()[0].roadsideObserverEligible, false, "panic timer");
  assert.equal(population.observe("begin", "unsafe-panic", "breakdown", 1, 0), null);
  actor.panicUntil = 0;
  actor.witnessUntil = 10;
  assert.equal(population.snapshot()[0].roadsideObserverEligible, false, "witness timer");
  assert.equal(population.observe("begin", "unsafe-witness-timer", "breakdown", 1, 0), null);
  actor.witnessUntil = 0;
  actor.pendingAlert = { serial: 1 };
  assert.equal(population.snapshot()[0].roadsideObserverEligible, false, "queued alert");
  assert.equal(population.observe("begin", "unsafe-alert", "breakdown", 1, 0), null);
  actor.pendingAlert = null;
  actor.socialPartner = actor;
  assert.equal(population.snapshot()[0].roadsideObserverEligible, false, "social partner");
  assert.equal(population.observe("begin", "unsafe-social-link", "breakdown", 1, 0), null);
  actor.socialPartner = null;

  assert.equal(
    population.observe("begin", "one-block-edge", "breakdown", ROADSIDE_OBSERVER_RADIUS, 0),
    actor.id,
    "the exact exported radius must remain eligible",
  );
  assert.deepEqual(actor.root.position.toArray(), originalPosition,
    "an observer faces the incident from their existing pavement position");
  assert.equal(population.observe("clear", "one-block-edge", "breakdown", ROADSIDE_OBSERVER_RADIUS, 0), actor.id);
  assert.deepEqual(actor.root.position.toArray(), originalPosition);
  assert.deepEqual(actor.homePosition.toArray(), originalHome);

  assert.equal(
    population.observe("begin", "outside-one-block", "breakdown", ROADSIDE_OBSERVER_RADIUS + 0.01, 0),
    null,
    "an incident beyond the named boundary must not borrow or teleport a civilian",
  );
  assert.equal(population.presentationSnapshot().stagedCount, 0);
  assert.equal(population.actors.length, actorCount);
  assert.equal(countSceneObjects(scene), sceneObjects);
  population.dispose();
});

test("civilians accelerate into panic, separate as a crowd, animate, and recover", () => {
  const { world } = createTestWorld();
  const population = createPopulationSystem({ scene: new THREE.Scene(), world, civilianCount: 0, policeCount: 0 });
  const first = population.spawn({ x: 0, z: 0 });
  const second = population.spawn({ x: 0, z: 0 });
  population.alert([0, 0, 0], "gunfire");

  for (let step = 0; step < 15; ++step) population.update(0.1);
  assert.equal(first.state, "flee");
  assert.equal(second.state, "flee");
  assert.ok(first.speed > 4 && second.speed > 4, "panicked civilians should reach a run");
  assert.ok(first.root.position.distanceTo(second.root.position) > 1, "overlapping pedestrians should fan out");
  assert.ok(first.distanceTravelled > 4);
  const pivots = first.visual.userData.pivots;
  assert.ok(Math.abs(pivots.leftLeg.rotation.x) + Math.abs(pivots.rightLeg.rotation.x) > 0.02);

  for (let step = 0; step < 100; ++step) population.update(0.1);
  assert.match(first.state, /^(wander|idle)$/);
  assert.match(second.state, /^(wander|idle)$/);
  population.dispose();
});

test("police flank blocked sightlines, fire controlled bursts, and retire after pursuit", () => {
  const { world, state } = createTestWorld({ wall: true });
  const damageEvents = [];
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 0,
    policeCount: 1,
    onPlayerDamage: event => damageEvents.push(event),
  });

  for (let step = 0; step < 50; ++step) {
    population.update(0.1, { targetPosition: [0, 0, 0], wantedStars: 1 });
  }
  const officer = population.actors.find(actor => actor.police);
  assert.equal(officer.active, true);
  assert.equal(officer.state, "flank");
  assert.equal(officer.shotsFired, 0, "solid blockers must suppress gunfire");
  assert.equal(damageEvents.length, 0);

  state.wall = false;
  for (let step = 0; step < 70; ++step) {
    population.update(0.1, { targetPosition: { x: 0, y: 0, z: 0 }, wantedStars: 1 });
  }
  assert.ok(officer.shotsFired >= 2);
  assert.ok(officer.reloadCount >= 1, "officers should pause to reload after a finite magazine");
  assert.ok(officer.roundsInMagazine >= 0 && officer.roundsInMagazine <= 8);
  assert.ok(damageEvents.length > 0);
  assert.ok(damageEvents.every(event => event.kind === "police_fire" && event.amount > 0 && Number.isFinite(event.distance)));

  for (let step = 0; step < 70; ++step) {
    population.update(0.1, { targetPosition: [0, 0, 0], wantedStars: 0 });
  }
  assert.equal(officer.active, false);
  assert.equal(officer.state, "reserve");
  population.dispose();
});

test("police close in without firing when a vulnerable player can be arrested", () => {
  const { world } = createTestWorld();
  const damageEvents = [];
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 0,
    policeCount: 1,
    onPlayerDamage: event => damageEvents.push(event),
  });
  for (let step = 0; step < 45; ++step) {
    population.update(0.1, {
      targetPosition: [0, 0, 0],
      wantedStars: 1,
      playerStatus: { arrestable: true },
    });
  }
  const officer = population.actors.find(actor => actor.police);
  assert.equal(officer.state, "arrest");
  assert.ok(officer.root.position.distanceTo(new THREE.Vector3()) < 2.6,
    "the officer should close to handcuff range");
  assert.equal(officer.shotsFired, 0);
  assert.equal(damageEvents.length, 0);
  population.dispose();
});

test("impacts cause hit and down poses before safe deterministic respawn", () => {
  const { world } = createTestWorld();
  let crimes = 0;
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 0,
    policeCount: 0,
    onCrime() {
      crimes += 1;
      throw new Error("a host callback must not break the simulation");
    },
  });
  const pedestrian = population.spawn({ x: 0, z: 0 });

  assert.deepEqual(population.hitByVehicle([0, 0, 0], 1, 2, true), []);
  const impacts = population.hitByVehicle({ x: 0, y: 0, z: 0 }, 1, 5, true);
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].ragdoll, true);
  assert.equal(pedestrian.state, "ragdoll");
  assert.ok(pedestrian.ragdollVelocity.length() > 2);
  assert.equal(crimes, 1);

  const lethal = population.damage(pedestrian.id, 500, "player");
  assert.equal(lethal.alive, false);
  assert.equal(lethal.ragdoll, true);
  assert.equal(pedestrian.state, "ragdoll");
  assert.equal(pedestrian.root.visible, true, "the fall pose should render briefly");
  assert.equal(crimes, 2);
  assert.deepEqual(population.damage("missing-pedestrian", 5), { accepted: false });

  for (let step = 0; step < 10; ++step) population.update(0.1);
  assert.ok(Math.abs(pedestrian.visual.rotation.z) > 1, "the procedural body should settle onto the ground");
  for (let step = 0; step < 20; ++step) population.update(0.1);
  assert.equal(pedestrian.root.visible, false);
  for (let step = 0; step < 150; ++step) population.update(0.1);
  assert.equal(pedestrian.alive, true);
  assert.equal(pedestrian.active, true);
  assert.equal(pedestrian.root.visible, true);
  assert.equal(pedestrian.health, pedestrian.maxHealth);
  assert.match(pedestrian.state, /^(wander|idle)$/);
  population.dispose();
});

test("vehicle misses reuse one frozen empty impact result", () => {
  const { world } = createTestWorld();
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 2,
    policeCount: 1,
  });
  try {
    const empty = population.hitByVehicle([500, 0, 500], 1.2, 9, true);
    assert.deepEqual(empty, []);
    assert.ok(Object.isFrozen(empty));
    for (let index = 0; index < 64; ++index) {
      assert.strictEqual(
        population.hitByVehicle([500 + index, 0, 500 - index], 1.2, 9, true),
        empty,
        "a no-impact traffic probe must not allocate a fresh result array",
      );
    }
    assert.strictEqual(population.hitByVehicle([0, 0, 0], 1.2, 2, true), empty,
      "the below-impact-speed fast path should share the same immutable empty result");
  } finally {
    population.dispose();
  }
});

test("civilians anticipate live traffic and treat horns as a non-criminal yield cue", () => {
  const { world } = createTestWorld({ emptySpawns: true });
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 0,
    policeCount: 0,
  });
  const pedestrian = population.spawn({ x: 0, z: 0 });
  const traffic = {
    id: "approaching-car",
    position: [0, 0, 6],
    velocity: [0, 0, -6],
    radius: 1.4,
  };

  population.update(0.1, { vehicles: [traffic] });
  assert.equal(pedestrian.state, "yield");
  assert.ok(Math.abs(pedestrian.root.position.x) > 0.05, "pedestrian should step across the vehicle trajectory");
  assert.equal(population.crimesWitnessed, 0);

  const beforeHorn = pedestrian.root.position.clone();
  population.alert([0, 0, 1], "horn");
  for (let step = 0; step < 8; ++step) population.update(0.1, { vehicles: [] });
  assert.equal(pedestrian.state, "yield");
  assert.ok(pedestrian.root.position.distanceTo(beforeHorn) > 0.1, "horn should prompt a short step aside");
  assert.equal(pedestrian.panicUntil, 0, "a horn should not create crime panic");
  assert.equal(population.crimesWitnessed, 0);
  population.dispose();
});

test("pedestrians socialize at idle nodes and wait for traffic before using crosswalks", () => {
  const socialWorld = createTestWorld({ emptySpawns: true }).world;
  socialWorld.spawnPoints.pedestrians = [[0, 0, 0], [1, 0, 0]];
  const socialPopulation = createPopulationSystem({
    scene: new THREE.Scene(),
    world: socialWorld,
    civilianCount: 0,
    policeCount: 0,
  });
  const first = socialPopulation.spawn({ x: 0, z: 0 });
  const second = socialPopulation.spawn({ x: 1, z: 0 });
  first.nodeIndex = 0;
  first.crossingDestinationIndex = -1;
  socialPopulation.update(0.1);
  assert.equal(first.state, "social");
  assert.equal(second.state, "social");
  assert.equal(first.socialPartner, second);
  socialPopulation.dispose();

  const crossingWorld = createTestWorld({ emptySpawns: true }).world;
  crossingWorld.spawnPoints.pedestrians = [[-10, 0, -8.15], [10, 0, -8.15]];
  crossingWorld.roads = [
    { axis: "z", center: [0, 0, 0], halfExtents: [7.5, 0.1, 100] },
    { axis: "x", center: [0, 0, 0], halfExtents: [100, 0.1, 7.5] },
  ];
  const crossingPopulation = createPopulationSystem({
    scene: new THREE.Scene(),
    world: crossingWorld,
    civilianCount: 0,
    policeCount: 0,
  });
  const walker = crossingPopulation.spawn({ x: -10, z: -8.15 });
  walker.nodeIndex = 1;
  walker.crossingDestinationIndex = -1;
  const crossingTraffic = {
    id: "crossing-traffic",
    position: [0, 0, -8.15],
    velocity: [0, 0, -5],
    radius: 1.4,
  };
  let waited = false;
  for (let step = 0; step < 24; ++step) {
    crossingPopulation.update(0.1, { vehicles: [crossingTraffic] });
    waited ||= walker.state === "crosswalk_wait";
  }
  assert.equal(waited, true);
  assert.ok(walker.root.position.x < -7.5, "pedestrian should remain at the curb while traffic occupies the crossing");
  let crossed = false;
  let cleared = false;
  let maximumX = walker.root.position.x;
  for (let step = 0; step < 130; ++step) {
    crossingPopulation.update(0.1, { vehicles: [] });
    crossed ||= walker.state === "crosswalk_cross";
    maximumX = Math.max(maximumX, walker.root.position.x);
    cleared ||= walker.root.position.x > 7.5;
  }
  assert.equal(crossed, true);
  assert.equal(cleared, true, `pedestrian should clear the road after the safe signal (maximum x ${maximumX})`);
  crossingPopulation.dispose();
});

test("dense local routes, daily routines, and weather props make street life react to the city clock", () => {
  const { world } = createTestWorld({ emptySpawns: true });
  world.pedestrianNodes = [
    [0, 0, 0], [7, 0, 0], [14, 0, 0],
    [14, 0, 7], [7, 0, 7], [0, 0, 7],
  ];
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 6,
    policeCount: 0,
  });
  assert.equal(population.navigationNodes, 6);
  assert.ok(population.navigationLinks >= 6, population.navigationLinks);

  population.update(0.1, { timeHours: 9, rain: 1, daylight: 1 });
  const wetMorning = population.snapshot();
  assert.equal(wetMorning.filter(actor => actor.carryingUmbrella).length, 6);
  assert.deepEqual(new Set(wetMorning.map(actor => actor.routine)), new Set([
    "commuter", "market-shift", "harbour-shift", "student", "jogger", "nightlife",
  ]));
  assert.ok(wetMorning.some(actor => actor.schedule === "work"));
  for (const actor of population.actors) {
    assert.equal(actor.visual.userData.props.umbrella.visible, true);
    assert.ok(actor.visual.getObjectByName("umbrella fabric canopy"));
  }
  assert.ok(population.actors.some(actor => actor.visual.getObjectByName("everyday backpack")));

  const distantWalker = population.actors.at(-1);
  distantWalker.root.position.set(80, 0, 0);
  population.update(0.1, { targetPosition: [0, 0, 0], timeHours: 9, rain: 1, daylight: 1 });
  assert.equal(distantWalker.detailLevel, "distant");
  assert.equal(distantWalker.visual.visible, false);
  assert.equal(distantWalker.distantVisual.visible, true);
  assert.equal(distantWalker.distantVisual.userData.umbrella.visible, true,
    "weather silhouette should survive the distant LOD switch");

  const phoneUser = population.actors[0];
  phoneUser.idleMode = "phone";
  phoneUser.idleUntil = 100;
  population.update(0.1, { timeHours: 13, rain: 0, daylight: 1 });
  assert.equal(phoneUser.state, "idle");
  assert.equal(phoneUser.visual.userData.props.umbrella.visible, false);
  assert.equal(phoneUser.visual.userData.props.phone.visible, true);

  population.update(0.1, { timeHours: 1, rain: 0, daylight: 0 });
  const afterMidnight = population.snapshot();
  assert.equal(afterMidnight.find(actor => actor.routine === "nightlife").schedule, "nightlife");
  assert.equal(afterMidnight.find(actor => actor.routine === "market-shift").schedule, "home");
  population.dispose();
});

test("market-shift civilians use the authored sidewalk focus through early evening", () => {
  const { world } = createTestWorld({ emptySpawns: true });
  world.northMarket = Object.freeze({ focus: Object.freeze([40, 0, 40]) });
  world.pedestrianNodes = [
    [38, 0, 38], [42, 0, 38], [38, 0, 42], [42, 0, 42],
    [-2, 0, -2], [2, 0, -2], [-2, 0, 2], [2, 0, 2],
  ];
  const population = createPopulationSystem({
    scene: new THREE.Scene(),
    world,
    civilianCount: 2,
    policeCount: 0,
  });
  const marketWorker = population.actors.find(actor => actor.routine === "market-shift");
  assert.ok(marketWorker);
  assert.ok(Math.hypot(marketWorker.root.position.x - 40, marketWorker.root.position.z - 40) < 6,
    "initial market routing should use world.northMarket.focus, not the former road coordinate");

  for (let step = 0; step < 80; ++step) {
    population.update(0.1, { timeHours: 19.25, rain: 0, daylight: 0.15 });
  }
  const earlyEvening = population.snapshot().find(actor => actor.id === marketWorker.id);
  assert.equal(earlyEvening.schedule, "work");
  assert.ok(Math.hypot(earlyEvening.position[0] - 40, earlyEvening.position[2] - 40) < 8,
    "the market shift should remain visibly local until the arcade closes");

  population.update(0.1, { timeHours: 19.6, rain: 0, daylight: 0 });
  assert.equal(population.snapshot().find(actor => actor.id === marketWorker.id).schedule, "commute-home");
  population.dispose();
});

test("Pulse Line commuters deterministically queue at safe stops, prefer rain cover, and disperse at midday", () => {
  const waitingAnchors = Object.freeze([
    Object.freeze([12, 0, 0]),
    Object.freeze([30, 0, 0]), // Authored badly on purpose: the system must reject it once.
  ]);
  const coveredWaitingAnchors = Object.freeze([Object.freeze([20, 0, 0])]);
  const pulseTransit = Object.freeze({
    waitingAnchors,
    coveredWaitingAnchors,
  });
  const contractBefore = JSON.stringify(pulseTransit);
  function transitWorld() {
    return {
      pulseTransit,
      pedestrianNodes: [
        [0, 0, 0], [4, 0, 0], [8, 0, 0], [12, 0, 0], [16, 0, 0], [20, 0, 0],
      ],
      spawnPoints: { pedestrians: [[0, 0, 0]], police: [] },
      terrainHeight: () => 0,
      isBlockedCircle(x, z, radius = 0) {
        return Math.abs(x - 30) < 0.45 + radius && Math.abs(z) < 0.45 + radius;
      },
      resolveCircleMotion(position, displacement, radius) {
        const next = position.clone();
        if (!this.isBlockedCircle(next.x + displacement.x, next.z, radius)) next.x += displacement.x;
        if (!this.isBlockedCircle(next.x, next.z + displacement.z, radius)) next.z += displacement.z;
        return next;
      },
    };
  }
  const first = createPopulationSystem({
    scene: new THREE.Scene(), world: transitWorld(), civilianCount: 12, policeCount: 0,
  });
  const second = createPopulationSystem({
    scene: new THREE.Scene(), world: transitWorld(), civilianCount: 12, policeCount: 0,
  });
  const initialActorCount = first.actors.length;
  const initialVisualNodes = first.actors.reduce((count, actor) => {
    actor.root.traverse(() => { count += 1; });
    return count;
  }, 0);
  assert.deepEqual(first.pulseTransit, {
    waitingAnchors: 1,
    coveredWaitingAnchors: 1,
    eligibleActors: 4,
    actorCountUnchanged: true,
  });

  for (let step = 0; step < 180; ++step) {
    first.update(0.1, { timeHours: 7.5, rain: 0, captureSnapshot: false });
    second.update(0.1, { timeHours: 7.5, rain: 0, captureSnapshot: false });
  }
  const dryMorning = first.snapshot();
  assert.deepEqual(dryMorning, second.snapshot(), "the fixed commuter assignment and motion must be exact");
  const morningRiders = dryMorning.filter(actor => actor.transitPhase === "morning");
  assert.equal(morningRiders.length, 4);
  assert.ok(morningRiders.every(actor => actor.transitAnchor === dryMorning[0].transitAnchor));
  assert.deepEqual(morningRiders[0].transitAnchor, [12, 0, 0]);
  assert.ok(morningRiders.some(actor => actor.transitWaiting), "at least one rider should settle at the stop");
  assert.ok(dryMorning.filter(actor => actor.transitPhase === null).length > morningRiders.length,
    "the service should reuse a subset of the existing crowd");

  for (let step = 0; step < 120; ++step) {
    first.update(0.1, { timeHours: 7.5, rain: 1, captureSnapshot: false });
    second.update(0.1, { timeHours: 7.5, rain: 1, captureSnapshot: false });
  }
  const wetMorning = first.snapshot();
  assert.deepEqual(wetMorning, second.snapshot());
  const shelteredRiders = wetMorning.filter(actor => actor.transitPhase === "morning");
  assert.ok(shelteredRiders.every(actor => actor.transitCovered));
  assert.ok(shelteredRiders.every(actor => actor.transitAnchor[0] === 20));

  for (let step = 0; step < 80; ++step) {
    first.update(0.1, { timeHours: 12, rain: 0, captureSnapshot: false });
    second.update(0.1, { timeHours: 12, rain: 0, captureSnapshot: false });
  }
  const midday = first.snapshot();
  assert.deepEqual(midday, second.snapshot());
  assert.ok(midday.every(actor => actor.transitPhase === null && actor.transitAnchor === null));
  assert.ok(midday.every(actor => !actor.state.startsWith("transit_")), "midday should release the queue");

  first.update(0.1, { timeHours: 17.4, rain: 0, captureSnapshot: false });
  second.update(0.1, { timeHours: 17.4, rain: 0, captureSnapshot: false });
  const evening = first.snapshot();
  assert.deepEqual(evening, second.snapshot());
  assert.equal(evening.filter(actor => actor.transitPhase === "evening").length, 2,
    "early commute-home should route the fixed commuter subset back through Pulse Line");
  first.update(0.1, { timeHours: 18.4, rain: 0, captureSnapshot: false });
  assert.ok(first.snapshot().every(actor => actor.transitPhase === null),
    "the queue should dissolve instead of occupying the stop all evening");

  const finalVisualNodes = first.actors.reduce((count, actor) => {
    actor.root.traverse(() => { count += 1; });
    return count;
  }, 0);
  assert.equal(first.actors.length, initialActorCount, "transit must never create crowd actors");
  assert.equal(finalVisualNodes, initialVisualNodes, "transit ticks must never lazily grow actor visuals");
  assert.equal(JSON.stringify(pulseTransit), contractBefore, "the frozen world contract must remain exact");
  first.dispose();
  second.dispose();
});
