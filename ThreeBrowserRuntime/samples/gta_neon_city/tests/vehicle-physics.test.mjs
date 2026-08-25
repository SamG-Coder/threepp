import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createVehicleSystem, stepVehiclePhysics } from "../src/actors/vehicles.mjs";
import { createRoadsideResponseSystem } from "../src/game/roadside-response.mjs";
import { buildCity } from "../src/world/city.mjs";

function baseState(overrides = {}) {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    steering: 0,
    lateralSpeed: 0,
    radius: 1,
    ...overrides,
  };
}

function intersectionWorld() {
  return {
    bounds: { minX: -90, maxX: 90, minZ: -90, maxZ: 90 },
    roads: [
      { id: "vertical", axis: "z", center: [0, 0, 0], halfExtents: [6, 0.05, 80] },
      { id: "horizontal", axis: "x", center: [0, 0, 0], halfExtents: [80, 0.05, 6] },
    ],
    roadRoutes: [
      {
        id: "vertical-lane", roadId: "vertical", axis: "z", direction: -1, speedLimit: 16,
        points: [[0, 0, 70], [0, 0, -70]],
      },
      {
        id: "horizontal-lane", roadId: "horizontal", axis: "x", direction: 1, speedLimit: 16,
        points: [[-70, 0, 0], [70, 0, 0]],
      },
    ],
    spawnPoints: {
      vehicles: [
        { id: "civilian-red", position: [0, 0, 24], heading: 0, traffic: true, roadId: "vertical" },
        { id: "civilian-green", position: [-24, 0, 0], heading: -Math.PI / 2, traffic: true, roadId: "horizontal" },
      ],
      police: [
        { id: "emergency", position: [0, 0, 24], heading: 0, police: true, roadId: "vertical" },
      ],
    },
    sampleGround() { return { height: 0 }; },
    isRoad() { return true; },
    isBlockedCircle() { return false; },
    resolveCircleMotion(position, displacement) {
      return new THREE.Vector3(position.x + displacement.x, 0, position.z + displacement.z);
    },
  };
}

function blockedRecoveryWorld() {
  return {
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    roadRoutes: [
      { id: "blocked-lane", axis: "z", direction: -1, speedLimit: 14, points: [[0, 0, 40], [0, 0, -40]] },
    ],
    spawnPoints: {
      vehicles: [{ id: "stuck-car", position: [0, 0, 8], heading: 0, traffic: true }],
    },
    sampleGround() { return { height: 0 }; },
    isRoad() { return true; },
    isBlockedCircle(x, z, radius) { return z - radius < 0; },
  };
}

function isolateVehicles(system, activeVehicles) {
  const active = new Set(activeVehicles);
  let index = 0;
  for (const vehicle of system.vehicles) {
    if (active.has(vehicle)) continue;
    vehicle.driver = null;
    vehicle.aiMode = "parked";
    vehicle.state.speed = 0;
    vehicle.state.lateralSpeed = 0;
    vehicle.state.x = -75 + index % 10 * 15;
    vehicle.state.z = -75 + Math.floor(index / 10) * 15;
    index += 1;
  }
}

test("arcade acceleration is deterministic, bounded, and immutable", () => {
  const initial = Object.freeze(baseState());
  let first = initial;
  let second = initial;
  for (let index = 0; index < 600; ++index) {
    first = stepVehiclePhysics(first, { throttle: 1 }, 1 / 60);
    second = stepVehiclePhysics(second, { throttle: 1 }, 1 / 60);
  }
  assert.equal(initial.speed, 0, "the pure step must not mutate its input");
  assert.deepEqual(first, second);
  assert.ok(first.speed > 17 && first.speed <= 25);
  assert.ok(first.z < -120, "yaw zero should drive along negative Z");
});

test("speed-dependent steering turns forward and reverses its yaw direction while backing", () => {
  let forward = baseState({ speed: 14 });
  let reverse = baseState({ speed: -5 });
  for (let index = 0; index < 45; ++index) {
    forward = stepVehiclePhysics(forward, { throttle: 1, steer: 1 }, 1 / 120);
    reverse = stepVehiclePhysics(reverse, { reverse: 1, steer: 1 }, 1 / 120);
  }
  assert.ok(forward.yaw < -0.15, "right steering should rotate a forward car clockwise");
  assert.ok(reverse.yaw > 0.08, "the same steering should rotate a reversing car oppositely");
  assert.ok(forward.x > 0, "the forward car should arc toward the right");
});

test("service braking stops without selecting reverse and reverse input backs up", () => {
  let braking = baseState({ speed: 12 });
  for (let index = 0; index < 120; ++index) braking = stepVehiclePhysics(braking, { brake: 1 }, 1 / 120);
  assert.ok(Math.abs(braking.speed) < 0.2, `brake should nearly stop the car, got ${braking.speed}`);

  let reversing = baseState();
  for (let index = 0; index < 180; ++index) reversing = stepVehiclePhysics(reversing, { reverse: 1 }, 1 / 120);
  assert.ok(reversing.speed < -4 && reversing.speed >= -8.5);
  assert.ok(reversing.z > 3, "negative speed should move opposite the forward axis");
});

test("handbrake creates bounded lateral slip and stronger rotation", () => {
  let gripped = baseState({ speed: 18 });
  let drifting = baseState({ speed: 18 });
  for (let index = 0; index < 50; ++index) {
    gripped = stepVehiclePhysics(gripped, { throttle: 1, steer: 0.8 }, 1 / 120);
    drifting = stepVehiclePhysics(drifting, { throttle: 1, steer: 0.8, handbrake: true }, 1 / 120);
  }
  assert.ok(Math.abs(drifting.lateralSpeed) > Math.abs(gripped.lateralSpeed) + 0.25);
  assert.ok(Math.abs(drifting.yaw) > Math.abs(gripped.yaw));
  assert.ok(Number.isFinite(drifting.x) && Number.isFinite(drifting.z));
});

test("surface traction and sprung-body weight transfer remain deterministic", () => {
  let asphalt = baseState();
  let loose = baseState();
  let cornering = baseState();
  for (let frame = 0; frame < 120; ++frame) {
    asphalt = stepVehiclePhysics(asphalt, { throttle: 1 }, 1 / 120, { surfaceGrip: 1 });
    loose = stepVehiclePhysics(loose, { throttle: 1 }, 1 / 120, { surfaceGrip: 0.4 });
    cornering = stepVehiclePhysics(cornering, { throttle: 1, steer: 0.75 }, 1 / 120);
  }
  assert.ok(asphalt.speed > loose.speed + 1.5, "loose surfaces should reduce usable traction");
  assert.ok(loose.surfaceGrip < 0.45);
  assert.ok(cornering.bodyPitch > 0.015, "acceleration should pitch the body rearward");
  assert.ok(Math.abs(cornering.bodyRoll) > 0.012, "cornering should load the outside suspension");
  assert.ok(Math.abs(cornering.yawRate) > 0.2);

  const braking = stepVehiclePhysics(baseState({ speed: 18 }), { brake: 1 }, 0.2);
  assert.ok(braking.bodyPitch < -0.02, "braking should produce visible nose dive");
  assert.equal(braking.brakeLights, true);
  assert.equal(braking.reverseLights, false);
});

test("substepped circle collision prevents tunnelling through authored blockers", () => {
  const wall = {
    isBlockedCircle(x, z, radius) {
      return z - radius < -3;
    },
  };
  const result = stepVehiclePhysics(baseState({ speed: 28 }), { throttle: 1 }, 0.25, wall);
  assert.equal(result.collided, true);
  assert.ok(result.z >= -2.01, `vehicle crossed the wall: z=${result.z}`);
  assert.ok(result.impactSpeed > 20);
  assert.ok(result.collisionCount >= 1);
  assert.ok(result.suspensionJolt > 0, "an impact should compress the visual suspension state");
});

test("bounds and host motion resolvers are honored", () => {
  const bounded = stepVehiclePhysics(
    baseState({ x: 3.8, yaw: -Math.PI / 2, speed: 12 }),
    { throttle: 1 },
    0.2,
    { bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 } },
  );
  assert.ok(bounded.x <= 4.000001);
  assert.equal(bounded.collided, true);

  let calls = 0;
  const resolved = stepVehiclePhysics(baseState({ speed: 8 }), { throttle: 1 }, 0.1, {
    resolveCircleMotion(request) {
      calls += 1;
      return {
        x: request.x + request.dx * 0.5,
        z: request.z + request.dz * 0.5,
        blocked: true,
      };
    },
  });
  assert.ok(calls >= 12, "the host resolver should run for fixed substeps");
  assert.equal(resolved.collided, true);
  assert.ok(Number.isFinite(resolved.x) && Number.isFinite(resolved.z));

  const fallback = stepVehiclePhysics(
    baseState({ yaw: -Math.PI / 2, speed: 20 }),
    {},
    0.2,
    {
      resolveCircleMotion() { throw new Error("optional host resolver unavailable"); },
      isBlockedCircle(x) { return x > 0.5; },
    },
  );
  assert.equal(fallback.collided, true);
  assert.ok(fallback.x <= 0.5);
});

test("vehicle system exposes enter, exit, chase, damage, raycast, teleport, and snapshots", () => {
  const scene = new THREE.Scene();
  const world = {
    bounds: { minX: -70, maxX: 70, minZ: -70, maxZ: 70 },
    roadRoutes: [
      { id: "loop", speedLimit: 18, points: [[-50, 0, -50], [-50, 0, 50], [50, 0, 50], [50, 0, -50]] },
    ],
    spawnPoints: {
      vehicles: [
        { id: "custom-car", position: [-40, 0, -30], heading: 0 },
        { id: "custom-taxi", position: [-40, 0, 20], heading: 0 },
      ],
      police: [{ id: "custom-police", position: [40, 0, 30], heading: Math.PI }],
    },
    sampleGround() { return { height: 0 }; },
    isBlockedCircle() { return false; },
    resolveCircleMotion(position, displacement) {
      return new THREE.Vector3(position.x + displacement.x, 0, position.z + displacement.z);
    },
  };
  const crimes = [];
  const impacts = [];
  const actions = new Set();
  const system = createVehicleSystem({
    scene,
    world,
    input: { actions },
    onCrime: event => crimes.push(event),
    onImpact: event => impacts.push(event),
  });
  assert.ok(system.vehicles.length >= 12);
  assert.equal(system.targetVehicle.kind, "sports");
  assert.equal(system.targetVehicle.missionTarget, true);
  assert.equal(system.get("custom-police")?.police, true);

  const target = system.targetVehicle;
  assert.equal(system.nearestEnterable(target.root.position, 3), target);
  assert.equal(system.enter(target), target);
  assert.equal(system.playerVehicle, target);
  assert.equal(crimes.length, 1);
  actions.add("forward");
  actions.add("right");
  let redStrobeSeen = false;
  let blueStrobeSeen = false;
  for (let frame = 0; frame < 36; ++frame) {
    system.update(1 / 60, { targetPosition: target.root.position, wantedStars: 2 });
    for (const beacon of system.get("custom-police").visual.emergencyLights) {
      if (!beacon.visible) continue;
      if (beacon.userData.flashChannel === 0) redStrobeSeen = true;
      if (beacon.userData.flashChannel === 1) blueStrobeSeen = true;
    }
  }
  assert.ok(target.state.speed > 0.5);
  assert.ok(Math.abs(target.visual.bodyRoot.rotation.x) > 0.005);
  assert.ok(Math.abs(target.visual.bodyRoot.rotation.z) > 0.001);
  assert.equal(target.visual.wheels.every(wheel => Number.isFinite(wheel.steerRoot.position.y)), true);
  const frontLeft = target.visual.wheels.find(wheel => wheel.front && wheel.side < 0);
  const frontRight = target.visual.wheels.find(wheel => wheel.front && wheel.side > 0);
  assert.ok(Math.abs(frontRight.steerRoot.rotation.y) > Math.abs(frontLeft.steerRoot.rotation.y),
    "the inside front wheel should take the tighter Ackermann angle");
  assert.equal(target.visual.wheels.filter(wheel => !wheel.front).every(wheel => wheel.steerRoot.rotation.y === 0), true);
  const policeVisual = system.get("custom-police").visual;
  assert.equal(policeVisual.emergencyLights.length, 6);
  assert.equal(policeVisual.occupants.length, 2);
  assert.ok(policeVisual.occupants.every(occupant => occupant.visible));
  assert.equal(system.get("custom-police").snapshot().visibleOccupants, 2);
  assert.equal(redStrobeSeen && blueStrobeSeen, true);
  assert.equal(system.get("custom-police").root.userData.emergencyActive, true);
  assert.equal(policeVisual.headlights.filter(light => light.visible).length, 1, "pursuit headlights should wig-wag");
  assert.ok(policeVisual.headlightThrow.intensity > 0, "night traffic should cast a real low-beam pool");

  system.update(1 / 60, { targetPosition: target.root.position, wantedStars: 0, lightLevel: 0 });
  assert.equal(target.visual.headlights.every(light => light.visible === false), true,
    "ordinary low beams should switch off in full daylight");
  assert.equal(target.visual.headlightThrow.intensity, 0);

  const frontSpinBefore = frontLeft.spinAngle;
  const rearWheel = target.visual.wheels.find(wheel => !wheel.front);
  const rearSpinBefore = rearWheel.spinAngle;
  actions.clear();
  actions.add("handbrake");
  system.update(1 / 30, { targetPosition: target.root.position, wantedStars: 2 });
  const frontSpinDelta = Math.abs(Math.atan2(
    Math.sin(frontLeft.spinAngle - frontSpinBefore),
    Math.cos(frontLeft.spinAngle - frontSpinBefore),
  ));
  const rearSpinDelta = Math.abs(Math.atan2(
    Math.sin(rearWheel.spinAngle - rearSpinBefore),
    Math.cos(rearWheel.spinAngle - rearSpinBefore),
  ));
  assert.ok(rearSpinDelta < frontSpinDelta * 0.15, "the handbrake should visibly lock the rear wheels");
  actions.clear();
  actions.add("backward");
  system.update(1 / 30, { targetPosition: target.root.position, wantedStars: 2 });
  assert.equal(target.state.brakeLights, true);
  assert.ok(target.visual.tailLights[0].material.emissiveIntensity > 10);
  actions.clear();
  assert.ok(system.get("custom-police").state.speed > 0);
  const exitPosition = system.exit();
  assert.equal(exitPosition.isVector3, true);
  assert.equal(system.playerVehicle, null);

  system.teleport(target.id, 0, 0, 0);
  const hit = system.raycast([0, 1, 12], [0, 0, -1], 30);
  assert.equal(hit?.vehicle, target);
  const damaged = system.damage(target, 35);
  assert.equal(damaged.health, target.maxHealth - 35);
  system.update(0);
  assert.equal(target.visual.damagePanel.visible, true);

  const traffic = system.vehicles.filter(vehicle => vehicle.driver === "traffic").slice(0, 2);
  assert.equal(traffic.length, 2);
  system.teleport(traffic[0].id, -20, 10, 0);
  system.teleport(traffic[1].id, -20, 3, 0);
  traffic[0].state.speed = 16;
  traffic[1].state.speed = 2;
  system.update(1 / 30);
  assert.ok(Number.isFinite(traffic[0].followingDistance));
  assert.ok(traffic[0].lastControls.brake > 0.1, "traffic should brake predictively for a slower car");
  for (const item of system.snapshot()) {
    for (const key of ["id", "kind", "position", "yaw", "speed", "health", "driver", "police", "missionTarget"]) {
      assert.ok(Object.hasOwn(item, key), `snapshot is missing ${key}`);
    }
  }
  system.dispose();
  assert.equal(system.vehicles.length, 0);
  assert.equal(impacts.length, 0);
});

test("external player headlights suppress only the duplicate throw while diagnostics stay truthful", () => {
  const scene = new THREE.Scene();
  const system = createVehicleSystem({
    scene,
    world: intersectionWorld(),
    externalPlayerHeadlights: true,
  });
  const playerCar = system.get("civilian-red");
  const trafficCar = system.get("civilian-green");
  assert.equal(system.enter(playerCar, { authorized: true }), playerCar);

  let sceneObjects = 0;
  scene.traverse(() => { sceneObjects += 1; });
  system.update(0, { lightLevel: 1, captureSnapshot: false });
  assert.equal(playerCar.visual.headlightThrow.intensity, 0,
    "the controlled car must not stack its generic spot over main's twin rig");
  assert.equal(system.setExternalPlayerHeadlightsActive(true), true);
  assert.equal(playerCar.snapshot().headlightsOn, true,
    "headlightsOn describes visible light even when the external rig owns the throw");
  assert.ok(trafficCar.visual.headlightThrow.intensity > 0,
    "external ownership must not remove ordinary traffic low beams");
  assert.equal(trafficCar.snapshot().headlightsOn, true);

  const taxiSign = system.vehicles
    .map(vehicle => vehicle.visual.bodyRoot.getObjectByName("Illuminated TAXI roof sign"))
    .find(Boolean);
  assert.ok(taxiSign);
  assert.equal(taxiSign.material.emissiveIntensity, 1.8);

  system.update(0, { lightLevel: 0, captureSnapshot: false });
  assert.equal(system.setExternalPlayerHeadlightsActive(false), false);
  assert.equal(playerCar.snapshot().headlightsOn, false);
  assert.equal(trafficCar.snapshot().headlightsOn, false);
  let sceneObjectsAfter = 0;
  scene.traverse(() => { sceneObjectsAfter += 1; });
  assert.equal(sceneObjectsAfter, sceneObjects, "ownership switching must not create or remove renderer objects");
  system.dispose();
});

test("civilian signals stop and release coherently while pursuit police bypass cautiously", () => {
  const scene = new THREE.Scene();
  const system = createVehicleSystem({ scene, world: intersectionWorld() });
  const redApproach = system.get("civilian-red");
  const greenApproach = system.get("civilian-green");
  isolateVehicles(system, [redApproach, greenApproach]);

  let greenCleared = false;
  for (let frame = 0; frame < 480; ++frame) {
    system.update(1 / 60);
    greenCleared ||= greenApproach.state.x > 8;
  }
  assert.equal(greenCleared, true, "east-west traffic should clear during its green phase");
  assert.equal(redApproach.trafficControl.signal, "red");
  assert.equal(redApproach.stoppedForSignal, true);
  assert.equal(redApproach.recoveryAttempts, 0, "a legal signal stop must never trigger collision recovery");
  assert.ok(redApproach.state.speed < 0.1);
  assert.ok(redApproach.state.z > 7.5, "the civilian should remain behind the stop line");
  assert.equal(redApproach.state.brakeLights, true);
  const stoppedZ = redApproach.state.z;

  for (let frame = 0; frame < 240; ++frame) system.update(1 / 60);
  assert.ok(redApproach.state.z < 0, "the queued civilian should resume and clear on green");
  assert.ok(redApproach.state.speed > 3);
  assert.ok(redApproach.state.z < stoppedZ - 5);
  assert.equal(redApproach.root.parent.userData.trafficSignalPhase.z, "green");
  system.dispose();

  const pursuitScene = new THREE.Scene();
  const pursuit = createVehicleSystem({ scene: pursuitScene, world: intersectionWorld() });
  const police = pursuit.get("emergency");
  isolateVehicles(pursuit, [police]);
  let bypassObserved = false;
  let maximumConflictSpeed = 0;
  for (let frame = 0; frame < 300; ++frame) {
    pursuit.update(1 / 60, { targetPosition: [0, 0, -60], wantedStars: 3 });
    if (police.trafficControl?.bypass) {
      bypassObserved = true;
      if (Math.abs(police.state.z) < 16) maximumConflictSpeed = Math.max(maximumConflictSpeed, police.state.speed);
    }
  }
  assert.equal(bypassObserved, true);
  assert.ok(maximumConflictSpeed > 3 && maximumConflictSpeed < 7.2);
  assert.ok(police.state.z < 0, "the emergency unit should clear an empty red-light conflict box");
  pursuit.dispose();

  const blockedScene = new THREE.Scene();
  const blockedPursuit = createVehicleSystem({ scene: blockedScene, world: intersectionWorld() });
  const cautiousPolice = blockedPursuit.get("emergency");
  const obstruction = blockedPursuit.get("civilian-red");
  isolateVehicles(blockedPursuit, [cautiousPolice, obstruction]);
  obstruction.driver = null;
  obstruction.aiMode = "parked";
  obstruction.state.x = 0;
  obstruction.state.z = 0;
  obstruction.state.speed = 0;
  let unsafeBypass = false;
  for (let frame = 0; frame < 300; ++frame) {
    blockedPursuit.update(1 / 60, { targetPosition: [0, 0, -60], wantedStars: 3 });
    unsafeBypass ||= Boolean(cautiousPolice.trafficControl?.bypass);
  }
  assert.equal(unsafeBypass, false, "emergency traffic must yield to an occupied conflict box");
  assert.ok(cautiousPolice.state.z > 7.5);
  assert.ok(cautiousPolice.state.speed < 0.2);
  blockedPursuit.dispose();
});

test("autonomous collision recovery reverses and steers without teleporting", () => {
  const scene = new THREE.Scene();
  const world = blockedRecoveryWorld();
  const system = createVehicleSystem({ scene, world });
  const vehicle = system.get("stuck-car");
  let parkedIndex = 0;
  for (const other of system.vehicles) {
    if (other === vehicle) continue;
    other.driver = null;
    other.aiMode = "parked";
    other.state.speed = 0;
    other.state.x = -50 + parkedIndex % 8 * 13;
    other.state.z = 30 + Math.floor(parkedIndex / 8) * 12;
    parkedIndex += 1;
  }

  let recoveryObserved = false;
  let reverseObserved = false;
  let recoveryFlagObserved = false;
  let maximumRecoveryZ = -Infinity;
  for (let frame = 0; frame < 260; ++frame) {
    system.update(1 / 60);
    if (!vehicle.recovering) continue;
    recoveryObserved = true;
    reverseObserved ||= vehicle.state.speed < -0.2;
    recoveryFlagObserved ||= vehicle.root.userData.recovering === true;
    maximumRecoveryZ = Math.max(maximumRecoveryZ, vehicle.state.z);
  }
  assert.equal(recoveryObserved, true);
  assert.equal(reverseObserved, true);
  assert.equal(recoveryFlagObserved, true);
  assert.equal(vehicle.recoveryAttempts, 1);
  assert.ok(maximumRecoveryZ > 3.5, "the recovery maneuver should create clearance from the obstacle");
  assert.equal(world.isBlockedCircle(vehicle.state.x, vehicle.state.z, vehicle.radius), false);
  assert.ok(vehicle.health > 90, "a low-speed recovery should not destroy the vehicle");
  system.dispose();
});

test("Pulse Line van reuses fixed vehicle assets for an authorized occupied community minibus", () => {
  const scene = new THREE.Scene();
  const world = {
    bounds: { minX: -70, maxX: 70, minZ: -70, maxZ: 70 },
    roadRoutes: [
      { id: "pulse-loop", speedLimit: 14, points: [[-50, 0, -20], [50, 0, -20], [50, 0, 20], [-50, 0, 20]] },
    ],
    spawnPoints: {
      vehicles: [
        {
          id: "pulse-line-minibus",
          kind: "van",
          access: "pulse-line",
          displayName: "Pulse Line Community Minibus",
          position: [-30, 0, -20],
          heading: -Math.PI / 2,
          traffic: true,
        },
      ],
    },
    sampleGround() { return { height: 0 }; },
    isRoad() { return true; },
    isBlockedCircle() { return false; },
    resolveCircleMotion(position, displacement) {
      return new THREE.Vector3(position.x + displacement.x, 0, position.z + displacement.z);
    },
  };
  let unauthorizedCrimes = 0;
  const system = createVehicleSystem({
    scene,
    world,
    onCrime() { unauthorizedCrimes += 1; },
  });
  const minibus = system.get("pulse-line-minibus");
  assert.ok(minibus);
  assert.equal(minibus.kind, "van");
  assert.equal(minibus.access, "pulse-line");
  assert.equal(minibus.authorized, true, "public Pulse Line access should not be treated as vehicle theft");
  assert.equal(minibus.visual.transitParts.length, 8, "the complete transit treatment stays under ten fixed parts");
  assert.equal(minibus.visual.occupants.length, 4);
  assert.ok(minibus.visual.occupants.every(occupant => occupant.visible));
  for (const name of [
    "Pulse Line front route panel",
    "Left Pulse Line side glazing",
    "Right Pulse Line side glazing",
    "Pulse Line kerbside boarding door",
    "Visible Pulse Line driver silhouette",
  ]) {
    assert.ok(minibus.visual.bodyRoot.getObjectByName(name), `${name} should live under the sprung visual hierarchy`);
  }

  // Every transit addition must share a geometry/material pipeline that a
  // normal vehicle already created; the branch owns no unique render asset.
  const routePanel = minibus.visual.bodyRoot.getObjectByName("Pulse Line front route panel");
  const leftGlass = minibus.visual.bodyRoot.getObjectByName("Left Pulse Line side glazing");
  const door = minibus.visual.bodyRoot.getObjectByName("Pulse Line kerbside boarding door");
  const driver = minibus.visual.bodyRoot.getObjectByName("Visible Pulse Line driver silhouette");
  const taxiSign = system.vehicles
    .map(vehicle => vehicle.visual.bodyRoot.getObjectByName("Illuminated TAXI roof sign"))
    .find(Boolean);
  assert.equal(routePanel.geometry, door.geometry);
  assert.equal(routePanel.material, taxiSign.material);
  assert.equal(leftGlass.material, minibus.visual.bodyRoot.getObjectByName("Tinted continuous cabin").material);
  assert.ok(minibus.visual.occupants.every(occupant => occupant.geometry === driver.geometry));
  assert.equal(driver.material, minibus.visual.bodyRoot.getObjectByName("Van rear door seam").material);

  const firstSnapshot = minibus.snapshot();
  assert.equal(firstSnapshot.access, "pulse-line");
  assert.equal(firstSnapshot.transitService, true);
  assert.equal(firstSnapshot.transitVisualParts, 8);
  assert.equal(firstSnapshot.visibleOccupants, 4);
  assert.equal(firstSnapshot.displayName, "Pulse Line Community Minibus");
  assert.equal(Object.isFrozen(firstSnapshot), true);

  let nodeCount = 0;
  let meshCount = 0;
  minibus.root.traverse(node => {
    nodeCount += 1;
    meshCount += Number(node.isMesh);
  });
  const vehicleCount = system.vehicles.length;
  for (let frame = 0; frame < 240; ++frame) {
    system.update(1 / 60, { lightLevel: 0.8, captureSnapshot: false });
  }
  let nodeCountAfter = 0;
  let meshCountAfter = 0;
  minibus.root.traverse(node => {
    nodeCountAfter += 1;
    meshCountAfter += Number(node.isMesh);
  });
  assert.equal(system.vehicles.length, vehicleCount);
  assert.equal(nodeCountAfter, nodeCount, "updates must not lazily add transit nodes");
  assert.equal(meshCountAfter, meshCount, "updates must not lazily add transit meshes");
  assert.equal(minibus.snapshot().visibleOccupants, 4);

  system.enter(minibus);
  assert.equal(unauthorizedCrimes, 0);
  system.update(0, { captureSnapshot: false });
  assert.equal(minibus.snapshot().visibleOccupants, 4, "the precreated passenger presentation survives player control");
  system.exit();
  const vehicleRoot = minibus.root;
  system.dispose();
  assert.equal(system.vehicles.length, 0);
  assert.equal(vehicleRoot.parent, null);
  assert.equal(vehicleRoot.children.length, 0);
});

test("ordinary traffic has precreated drivers and taxi fares toggle one rear passenger without scene growth", () => {
  const scene = new THREE.Scene();
  const world = {
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
    roadRoutes: [
      { id: "city-loop", speedLimit: 15, points: [[-60, 0, -40], [60, 0, -40], [60, 0, 40], [-60, 0, 40]] },
    ],
    spawnPoints: {
      vehicles: [
        { id: "occupied-traffic", kind: "sedan", position: [-20, 0, -40], heading: -Math.PI / 2, traffic: true },
        {
          id: "night-shift-taxi",
          kind: "taxi",
          position: [10, 0, 40],
          heading: Math.PI / 2,
          parked: true,
          authorized: true,
          access: "licensed-taxi-shift",
        },
      ],
    },
    sampleGround() { return { height: 0 }; },
    isRoad() { return true; },
    isBlockedCircle() { return false; },
    resolveCircleMotion(position, displacement) {
      return new THREE.Vector3(position.x + displacement.x, 0, position.z + displacement.z);
    },
  };
  const system = createVehicleSystem({ scene, world });
  const traffic = system.get("occupied-traffic");
  const taxi = system.get("night-shift-taxi");
  assert.ok(traffic && taxi);

  system.update(0, { lightLevel: 0.5, captureSnapshot: false });
  assert.equal(traffic.snapshot().visibleDrivers, 1, "a moving civilian vehicle must not look empty");
  assert.ok(traffic.visual.bodyRoot.getObjectByName("Visible civilian driver"));
  assert.ok(traffic.visual.bodyRoot.getObjectByName("Cabin dashboard"));
  assert.ok(traffic.visual.bodyRoot.getObjectByName("Visible steering wheel"));
  assert.equal(taxi.snapshot().visibleOccupants, 0, "an empty parked taxi should show only its fixed cabin furniture");
  assert.equal(taxi.snapshot().taxiPassengerVisible, false);

  let nodeCount = 0;
  let meshCount = 0;
  taxi.root.traverse(node => {
    nodeCount += 1;
    meshCount += Number(node.isMesh);
  });
  system.enter(taxi);
  system.update(0, { taxiPassengerVehicleId: null, captureSnapshot: false });
  assert.equal(taxi.snapshot().visibleDrivers, 1, "Kai should have a prewarmed in-cab silhouette");
  assert.equal(taxi.snapshot().visibleOccupants, 1);

  for (let frame = 0; frame < 180; ++frame) {
    system.update(1 / 60, {
      taxiPassengerVehicleId: frame % 2 === 0 ? taxi.id : null,
      captureSnapshot: false,
    });
  }
  system.update(0, { taxiPassengerVehicleId: taxi.id, captureSnapshot: false });
  assert.equal(taxi.snapshot().taxiPassengerVisible, true);
  assert.equal(taxi.snapshot().visibleOccupants, 2, "driver and fare should both be readable through the cabin glass");
  system.update(0, { taxiPassengerVehicleId: null, captureSnapshot: false });
  assert.equal(taxi.snapshot().visibleOccupants, 1);

  let nodeCountAfter = 0;
  let meshCountAfter = 0;
  taxi.root.traverse(node => {
    nodeCountAfter += 1;
    meshCountAfter += Number(node.isMesh);
  });
  assert.equal(nodeCountAfter, nodeCount, "fare visibility must not lazily create vehicle nodes");
  assert.equal(meshCountAfter, meshCount, "fare visibility must not lazily create vehicle meshes");
  system.exit();
  system.update(0, { taxiPassengerVehicleId: null, captureSnapshot: false });
  assert.equal(taxi.snapshot().visibleOccupants, 0);
  system.dispose();
});

test("Pulse Roadside adapter deterministically holds, responds, repairs, and clears with precreated visuals", () => {
  const scene = new THREE.Scene();
  const world = {
    bounds: { minX: -110, maxX: 110, minZ: -110, maxZ: 110 },
    roadRoutes: [
      {
        id: "response-loop",
        speedLimit: 14,
        points: [[-85, 0, -55], [85, 0, -55], [85, 0, 55], [-85, 0, 55]],
      },
    ],
    sampleGround() { return { height: 0 }; },
    isRoad() { return true; },
    isBlockedCircle() { return false; },
    resolveCircleMotion(position, displacement) {
      return new THREE.Vector3(position.x + displacement.x, 0, position.z + displacement.z);
    },
  };
  const system = createVehicleSystem({ scene, world });
  const adapter = system.createRoadsideAdapter();
  assert.equal(adapter, system.roadsideAdapter, "the coordinator receives one construction-time adapter object");
  assert.equal(system.createRoadsideAdapter(), adapter);
  assert.equal(Object.isFrozen(adapter), true);

  const responder = system.vehicles.find(vehicle => vehicle.serviceRole === "pulse-roadside");
  assert.ok(responder, "the default traffic roster should contain one dormant response van");
  assert.equal(responder.kind, "van");
  assert.equal(responder.visual.roadsideBeacons.length, 4);
  assert.ok(responder.visual.roadsideBeacons.every(beacon => !beacon.visible));
  assert.ok(responder.visual.roadsideBeacons.every(beacon =>
    beacon.geometry === responder.visual.turnSignals[0].mesh.geometry &&
    beacon.material === responder.visual.turnSignals[0].mesh.material));

  const selected = system.selectRoadsideTarget(0, 0, 0, 1_000, 1);
  assert.equal(selected, adapter.selectTarget(0, 0, 0, 1_000, 1));
  const target = system.get(selected);
  assert.ok(target);
  assert.equal(target.police, false);
  assert.equal(target.missionTarget, false);
  assert.notEqual(target, responder);
  assert.equal(system.selectRoadsideTarget(0, 0, 0, 1_000, 1), selected, "selection must not depend on frame time");

  const status = { available: false, playerControlled: true, x: NaN, z: NaN, speed: NaN };
  assert.equal(system.roadsideStatus(target.id, status), true);
  assert.equal(status.available, true);
  assert.equal(status.playerControlled, false);
  assert.equal(status.x, target.state.x);
  assert.equal(status.z, target.state.z);
  assert.equal(status.speed, target.state.speed);
  assert.equal(adapter.status("missing-roadside-id", status), false);
  assert.deepEqual(status, { available: false, playerControlled: false, x: 0, z: 0, speed: 0 });

  isolateVehicles(system, [target, responder]);
  system.teleport(target.id, 0, 0, 0);
  system.teleport(responder.id, 0, 20, 0);
  target.driver = "traffic";
  target.aiMode = "traffic";
  target.state.speed = 10;
  responder.driver = "traffic";
  responder.aiMode = "traffic";
  const damagedHealth = system.damage(target, target.maxHealth * 0.68).health;
  assert.ok(damagedHealth > 0 && damagedHealth < target.maxHealth * 0.62);

  let nodeCount = 0;
  let meshCount = 0;
  responder.root.traverse(node => {
    nodeCount += 1;
    meshCount += Number(node.isMesh);
  });

  assert.equal(adapter.command("hold", 41, target.id, null, "collision"), true);
  for (let frame = 0; frame < 120; ++frame) {
    system.update(1 / 60, { captureSnapshot: false });
  }
  assert.ok(Math.abs(target.state.speed) < 0.3, "the held traffic actor should stop without despawning");
  assert.equal(target.snapshot().roadsideHeld, true);
  assert.equal(target.snapshot().roadsideHazards, true);

  const responderId = adapter.command("dispatch", 41, target.id, null, "collision");
  assert.equal(responderId, responder.id);
  assert.equal(responder.snapshot().roadsideRouteMode, "direct-same-road");
  assert.equal(responder.snapshot().roadsideWaypointCount, 0);
  let beaconObserved = false;
  let arrived = false;
  for (let frame = 0; frame < 1_200; ++frame) {
    system.update(1 / 60, { lightLevel: 0.75, captureSnapshot: false });
    beaconObserved ||= responder.visual.roadsideBeacons.some(beacon => beacon.visible);
    const distance = Math.hypot(responder.state.x - target.state.x, responder.state.z - target.state.z);
    if (distance <= 6.5 && Math.abs(responder.state.speed) <= 1.1) {
      arrived = true;
      break;
    }
  }
  assert.equal(beaconObserved, true, "the prewarmed amber presentation should flash during response");
  assert.equal(arrived, true, "the responder should reach a deterministic safe stand-off and stop");
  assert.equal(responder.snapshot().visibleDrivers, 1, "the service vehicle must arrive with a visible driver");
  assert.equal(responder.snapshot().roadsideTargetId, target.id);

  assert.equal(adapter.command("repair", 41, target.id, responder.id, "collision"), true);
  for (let frame = 0; frame < 45; ++frame) system.update(1 / 60, { captureSnapshot: false });
  assert.equal(target.snapshot().roadsideRepairing, true);
  assert.equal(responder.snapshot().roadsideRepairing, true);
  assert.ok(Math.abs(responder.state.speed) < 0.35);
  assert.equal(adapter.command("clear", 41, target.id, responder.id, "collision"), true);
  assert.ok(target.health >= target.maxHealth * 0.62, "collision repair should make the target roadworthy");
  assert.equal(target.roadsideHeld, false);
  assert.equal(responder.roadsideResponding, false);
  assert.equal(target.aiMode, "traffic");
  assert.equal(responder.aiMode, "traffic");
  system.update(0, { captureSnapshot: false });
  assert.ok(responder.visual.roadsideBeacons.every(beacon => !beacon.visible));

  let nodeCountAfter = 0;
  let meshCountAfter = 0;
  responder.root.traverse(node => {
    nodeCountAfter += 1;
    meshCountAfter += Number(node.isMesh);
  });
  assert.equal(nodeCountAfter, nodeCount, "dispatch must not lazily add scene nodes");
  assert.equal(meshCountAfter, meshCount, "dispatch must not lazily add renderable meshes");
  system.dispose();
});

test("roadside cancellation releases flags without overriding player ownership", () => {
  const scene = new THREE.Scene();
  const world = {
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    roadRoutes: [
      { id: "cancel-loop", speedLimit: 14, points: [[-70, 0, -50], [70, 0, -50], [70, 0, 50], [-70, 0, 50]] },
    ],
    sampleGround() { return { height: 0 }; },
    isRoad() { return true; },
    isBlockedCircle() { return false; },
  };
  const system = createVehicleSystem({ scene, world });
  const targetId = system.selectRoadsideTarget(0, 0, 0, 1_000, 2);
  const target = system.get(targetId);
  assert.equal(system.roadsideCommand("hold", 7, target.id, null, "breakdown"), true);
  const responderId = system.roadsideCommand("dispatch", 7, target.id, null, "breakdown");
  const responder = system.get(responderId);
  assert.equal(responder.serviceRole, "pulse-roadside");

  system.enter(responder, { authorized: true });
  const status = {};
  assert.equal(system.roadsideStatus(responder.id, status), true);
  assert.equal(status.playerControlled, true);
  assert.equal(system.roadsideCommand("cancel", 7, target.id, responder.id, "breakdown"), true);
  assert.equal(system.playerVehicle, responder);
  assert.equal(responder.driver, "player");
  assert.equal(responder.aiMode, "parked");
  assert.equal(responder.roadsideIncidentId, 0);
  assert.equal(target.roadsideIncidentId, 0);
  system.exit();
  system.dispose();
});

test("Pulse Roadside follows a two-turn city grid route before the coordinator timeout", () => {
  const scene = new THREE.Scene();
  const roadHalfWidth = 5.2;
  const world = {
    bounds: { minX: -90, maxX: 90, minZ: -90, maxZ: 90 },
    roads: [
      { id: "east-avenue", axis: "z", center: [30, 0, 0], halfExtents: [roadHalfWidth, 0.05, 85] },
      { id: "west-avenue", axis: "z", center: [-30, 0, 0], halfExtents: [roadHalfWidth, 0.05, 85] },
      { id: "connector-street", axis: "x", center: [0, 0, -20], halfExtents: [85, 0.05, roadHalfWidth] },
    ],
    roadRoutes: [
      {
        id: "east-northbound", roadId: "east-avenue", axis: "z", direction: 1, speedLimit: 14,
        points: [[32.65, 0, -82], [32.65, 0, 82]],
      },
      {
        id: "east-southbound", roadId: "east-avenue", axis: "z", direction: -1, speedLimit: 14,
        points: [[27.35, 0, 82], [27.35, 0, -82]],
      },
      {
        id: "connector-eastbound", roadId: "connector-street", axis: "x", direction: 1, speedLimit: 14,
        points: [[-82, 0, -22.65], [82, 0, -22.65]],
      },
      {
        id: "west-northbound", roadId: "west-avenue", axis: "z", direction: 1, speedLimit: 14,
        points: [[-27.35, 0, -82], [-27.35, 0, 82]],
      },
    ],
    sampleGround() { return { height: 0 }; },
    isRoad(x, z) {
      return Math.abs(x - 30) <= roadHalfWidth || Math.abs(x + 30) <= roadHalfWidth ||
        Math.abs(z + 20) <= roadHalfWidth;
    },
    isBlockedCircle(x, z, radius = 0) {
      return !(Math.abs(x - 30) + radius <= roadHalfWidth ||
        Math.abs(x + 30) + radius <= roadHalfWidth ||
        Math.abs(z + 20) + radius <= roadHalfWidth);
    },
  };
  const system = createVehicleSystem({ scene, world });
  const responder = system.vehicles.find(vehicle => vehicle.serviceRole === "pulse-roadside");
  const targetId = system.selectRoadsideTarget(0, 0, 0, 1_000, 1);
  const target = system.get(targetId);
  assert.equal(responder.route.roadId, "west-avenue");
  assert.equal(target.route.roadId, "east-avenue");
  isolateVehicles(system, [target, responder]);
  system.teleport(responder.id, -27.35, -36, Math.PI);
  system.teleport(target.id, 32.65, 12, Math.PI);
  responder.driver = "traffic";
  responder.aiMode = "traffic";
  target.driver = "traffic";
  target.aiMode = "traffic";
  const initialDistance = Math.hypot(responder.state.x - target.state.x, responder.state.z - target.state.z);
  assert.ok(initialDistance >= 40 && initialDistance <= 80);

  const response = createRoadsideResponseSystem({
    vehicles: system.roadsideAdapter,
    population: { observe(action) { return action === "begin" ? "grid-witness" : null; } },
  });
  assert.equal(response.force(target.id, "breakdown"), true);
  const context = {
    enabled: true,
    wantedStars: 0,
    narrativeBusy: false,
    activityBusy: false,
    playerX: 0,
    playerZ: 0,
    timeHours: 21,
    rain: 0.4,
  };
  let elapsed = 0;
  let respondingAt = null;
  let repairingAt = null;
  let stoppedAtSignal = false;
  for (let frame = 0; frame < 2_100; ++frame) {
    const state = response.update(1 / 60, context);
    system.update(1 / 60, { captureSnapshot: false });
    elapsed += 1 / 60;
    if (state.phase === "responding" && respondingAt === null) respondingAt = elapsed;
    stoppedAtSignal ||= responder.stoppedForSignal;
    if (state.phase === "repairing") {
      repairingAt = elapsed;
      break;
    }
    assert.notEqual(state.phase, "cooldown", `grid response cancelled at ${elapsed.toFixed(2)}s: ` +
      `${responder.state.x.toFixed(2)},${responder.state.z.toFixed(2)} ` +
      `speed=${responder.state.speed.toFixed(2)} cursor=${responder.roadsideWaypointCursor}/` +
      `${responder.roadsideWaypointCount} mode=${responder.roadsideRouteMode} ` +
      `collisions=${responder.state.collisionCount} recovery=${responder.recoveryAttempts} ` +
      `yaw=${responder.state.yaw.toFixed(2)} steer=${responder.lastControls.steer.toFixed(2)} ` +
      `throttle=${responder.lastControls.throttle.toFixed(2)} brake=${responder.lastControls.brake.toFixed(2)}`);
  }

  assert.notEqual(respondingAt, null);
  assert.notEqual(repairingAt, null, "the service van should reach the target without a teleport");
  assert.ok(repairingAt - respondingAt < 28, `grid response took ${repairingAt - respondingAt}s`);
  const routeSnapshot = responder.snapshot();
  assert.equal(routeSnapshot.roadsideRouteMode, "parallel-grid");
  assert.equal(routeSnapshot.roadsideWaypointCount, 2);
  assert.equal(routeSnapshot.roadsideWaypointCursor, 2);
  assert.equal(routeSnapshot.roadsideNavigationAxis, "z");
  assert.equal(routeSnapshot.roadsideNavigationRoadId, "east-avenue");
  assert.equal(stoppedAtSignal, true, "route legs should continue honoring authored intersection signals");
  assert.ok(Math.hypot(responder.state.x - target.state.x, responder.state.z - target.state.z) <= 6.5);
  assert.ok(Math.abs(responder.state.speed) <= 1.1);
  system.dispose();
});

test("authored directed lanes and the nearest precreated responder complete the native-city incident", () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  const vehicleWorld = {
    ...city,
    roadRoutes: city.routes,
    spawnPoints: {
      vehicles: city.spawnPoints.vehicles.map(value => ({ ...value, yaw: value.heading, parked: true })),
      police: city.spawnPoints.police.map(value => ({ ...value, yaw: value.heading, police: true })),
    },
    surfaceGrip() { return 0.8; },
  };
  const system = createVehicleSystem({ scene, world: vehicleWorld });
  const initialVehicleCount = system.vehicles.length;
  const responders = system.vehicles.filter(vehicle => vehicle.serviceRole === "pulse-roadside");
  assert.deepEqual(responders.map(vehicle => vehicle.id), ["traffic-van-4", "traffic-van-8"]);
  assert.ok(responders.every(vehicle => vehicle.visual.roadsideBeacons.length === 4));

  for (const vehicle of system.vehicles) {
    if (vehicle.driver !== "traffic") continue;
    if (!vehicle.route?.direction || vehicle.route.axis !== "x" && vehicle.route.axis !== "z") continue;
    const heading = vehicle.route.axis === "x"
      ? -Math.sin(vehicle.state.yaw)
      : -Math.cos(vehicle.state.yaw);
    assert.equal(Math.sign(heading), Math.sign(vehicle.route.direction),
      `${vehicle.id} spawned against directed lane ${vehicle.route.id}`);
    assert.equal(vehicle.routeCursor, 1, `${vehicle.id} should target the far end of its directed line`);
  }

  // Mirror the bounded native setup advance. This used to leave van-4
  // oscillating four metres behind the authored parked Sentinel while the
  // only valid route timed out.
  for (let frame = 0; frame < 370; ++frame) system.update(1 / 60, { captureSnapshot: false });
  const target = system.get("traffic-sedan-7");
  assert.ok(target?.health > 0 && target.driver === "traffic");
  const response = createRoadsideResponseSystem({
    vehicles: system.roadsideAdapter,
    population: { observe(action) { return action === "begin" ? "native-grid-witness" : null; } },
  });
  assert.equal(response.force(target.id, "breakdown"), true);
  let respondingAt = null;
  let repairingAt = null;
  let responderId = null;
  for (let frame = 0; frame < 1_900; ++frame) {
    const state = response.update(1 / 60, {
      enabled: true,
      wantedStars: 0,
      narrativeBusy: false,
      activityBusy: false,
      playerX: 0,
      playerZ: 0,
      timeHours: 21.5,
      rain: 0,
    });
    system.update(1 / 60, { captureSnapshot: false });
    if (state.phase === "responding" && respondingAt === null) {
      respondingAt = frame / 60;
      responderId = state.responderVehicleId;
    }
    if (state.phase === "repairing") {
      repairingAt = frame / 60;
      break;
    }
    assert.notEqual(state.phase, "cooldown", "authored-city response timed out before arrival");
  }
  assert.equal(responderId, "traffic-van-8", "dispatch should select the nearer central service unit");
  assert.notEqual(repairingAt, null);
  assert.ok(repairingAt - respondingAt < 28);
  assert.equal(system.vehicles.length, initialVehicleCount);
  assert.equal(system.get(responderId).roadsideRouteMode, "direct-same-road");
  assert.ok(Math.hypot(
    system.get(responderId).state.x - target.state.x,
    system.get(responderId).state.z - target.state.z,
  ) <= 6.5);
  system.dispose();
  city.dispose();
});
