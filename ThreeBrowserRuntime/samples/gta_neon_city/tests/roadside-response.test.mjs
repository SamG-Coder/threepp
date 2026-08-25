import test from "node:test";
import assert from "node:assert/strict";
import {
  ROADSIDE_KINDS,
  ROADSIDE_OBSERVE_COMMANDS,
  ROADSIDE_PHASES,
  ROADSIDE_VEHICLE_COMMANDS,
  createRoadsideResponseSystem,
} from "../src/game/roadside-response.mjs";

const OPEN_CONTEXT = Object.freeze({
  enabled: true,
  wantedStars: 0,
  narrativeBusy: false,
  activityBusy: false,
  paused: false,
  playerX: 0,
  playerZ: 0,
  rain: 0,
  timeHours: 12,
});

const FAST_CONFIG = Object.freeze({
  initialDelaySeconds: 4,
  reportedSeconds: 1,
  responseTimeoutSeconds: 4,
  repairSeconds: 2,
  clearingSeconds: 1,
  cooldownSeconds: 2,
  ambientIntervalSeconds: 10,
  ambientJitterSeconds: 0,
  rainIntervalReduction: 0.25,
  nightIntervalMultiplier: 1.1,
  arrivalDistance: 6,
  arrivalSpeed: 1,
  impactSpeedThreshold: 7,
  minimumTargetDistance: 10,
  maximumTargetDistance: 100,
});

function createAdapters() {
  const entries = new Map([
    ["traffic-car", { available: true, playerControlled: false, x: 30, z: 4, speed: 8 }],
    ["roadside-van", { available: true, playerControlled: false, x: 60, z: 4, speed: 7 }],
  ]);
  const commands = [];
  const observations = [];
  const statusOutputs = new Set();
  let selectionCount = 0;

  const vehicles = {
    selectTarget(playerX, playerZ, minimumDistance, maximumDistance, ordinal) {
      selectionCount += 1;
      assert.equal(playerX, 0);
      assert.equal(playerZ, 0);
      assert.equal(minimumDistance, FAST_CONFIG.minimumTargetDistance);
      assert.equal(maximumDistance, FAST_CONFIG.maximumTargetDistance);
      assert.ok(ordinal > 0);
      return "traffic-car";
    },
    status(id, output) {
      statusOutputs.add(output);
      const value = entries.get(id);
      if (!value) return false;
      Object.assign(output, value);
      return true;
    },
    command(action, incidentId, targetId, responderId, kind) {
      commands.push({ action, incidentId, targetId, responderId, kind });
      if (action === ROADSIDE_VEHICLE_COMMANDS.HOLD) {
        const target = entries.get(targetId);
        if (!target || target.playerControlled) return false;
        target.speed = 0;
        return true;
      }
      if (action === ROADSIDE_VEHICLE_COMMANDS.DISPATCH) {
        return responderId ?? "roadside-van";
      }
      if (action === ROADSIDE_VEHICLE_COMMANDS.CLEAR) {
        entries.get(targetId).speed = 5;
      }
      return true;
    },
  };

  const population = {
    observe(action, incidentId, kind, x, z) {
      observations.push({ action, incidentId, kind, x, z });
      return action === ROADSIDE_OBSERVE_COMMANDS.BEGIN ? "civilian-reporter" : null;
    },
  };

  return {
    vehicles,
    population,
    entries,
    commands,
    observations,
    statusOutputs,
    get selectionCount() { return selectionCount; },
  };
}

function createSystem(adapters, config = FAST_CONFIG) {
  return createRoadsideResponseSystem({
    vehicles: adapters.vehicles,
    population: adapters.population,
    config,
  });
}

test("forced Pulse Roadside response follows the exact deterministic lifecycle", () => {
  const adapters = createAdapters();
  const system = createSystem(adapters);
  assert.equal(system.force("traffic-car"), true);

  const stableView = system.update(0, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.REPORTED);
  assert.equal(stableView.incidentId, 1);
  assert.equal(stableView.reporterId, "civilian-reporter");
  assert.equal(Object.isFrozen(stableView), true);
  assert.equal(stableView, system.update(0.4, OPEN_CONTEXT), "update must reuse its frozen runtime view");
  assert.equal(stableView.phase, ROADSIDE_PHASES.REPORTED);

  system.update(0.6, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.RESPONDING);
  assert.equal(stableView.responderVehicleId, "roadside-van");

  system.update(0.5, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.RESPONDING);
  adapters.entries.get("roadside-van").x = 35;
  adapters.entries.get("roadside-van").speed = 0.4;
  system.update(0, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.REPAIRING);

  system.update(1, OPEN_CONTEXT);
  system.update(1, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.CLEARING);
  system.update(1, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.COOLDOWN);
  assert.equal(stableView.completedIncidents, 1);
  system.update(1, OPEN_CONTEXT);
  system.update(1, OPEN_CONTEXT);
  assert.equal(stableView.phase, ROADSIDE_PHASES.IDLE);

  assert.deepEqual(adapters.commands.map(value => value.action), [
    ROADSIDE_VEHICLE_COMMANDS.HOLD,
    ROADSIDE_VEHICLE_COMMANDS.DISPATCH,
    ROADSIDE_VEHICLE_COMMANDS.REPAIR,
    ROADSIDE_VEHICLE_COMMANDS.CLEAR,
  ]);
  assert.deepEqual(adapters.observations.map(value => value.action), [
    ROADSIDE_OBSERVE_COMMANDS.BEGIN,
    ROADSIDE_OBSERVE_COMMANDS.CLEAR,
  ]);
  assert.ok(adapters.statusOutputs.size <= 2, "status reads must reuse the two construction-time output objects");
  assert.equal(system.snapshot().storage, "memory-only");
});

test("wanted, narrative and activity gates defer starts and cancel active response once", () => {
  const adapters = createAdapters();
  const system = createSystem(adapters);
  assert.equal(system.force("traffic-car"), true);

  system.update(1, { ...OPEN_CONTEXT, wantedStars: 1 });
  assert.equal(system.snapshot().phase, ROADSIDE_PHASES.IDLE);
  assert.equal(adapters.commands.length, 0);
  system.update(0, OPEN_CONTEXT);
  assert.equal(system.snapshot().phase, ROADSIDE_PHASES.REPORTED);

  system.update(0.1, { ...OPEN_CONTEXT, narrativeBusy: true });
  assert.equal(system.snapshot().phase, ROADSIDE_PHASES.COOLDOWN);
  assert.equal(system.snapshot().cancelledIncidents, 1);
  assert.equal(adapters.commands.filter(value => value.action === ROADSIDE_VEHICLE_COMMANDS.CANCEL).length, 1);
  assert.equal(adapters.observations.filter(value => value.action === ROADSIDE_OBSERVE_COMMANDS.CLEAR).length, 1);

  system.update(1, { ...OPEN_CONTEXT, activityBusy: true });
  assert.equal(system.snapshot().phase, ROADSIDE_PHASES.COOLDOWN);
  assert.equal(adapters.commands.filter(value => value.action === ROADSIDE_VEHICLE_COMMANDS.CANCEL).length, 1);
});

test("impact reports are thresholded, urgent, and never replace an active incident", () => {
  const adapters = createAdapters();
  const system = createSystem(adapters);
  assert.equal(system.report({ vehicleId: "traffic-car", speed: 6.99 }), false);
  assert.equal(system.report({ vehicle: { id: "traffic-car" }, speed: 9.5 }), true);
  assert.equal(system.report({ vehicleId: "traffic-car", speed: 12 }), false, "a queued report is coalesced");
  system.update(0, OPEN_CONTEXT);
  assert.equal(system.snapshot().kind, ROADSIDE_KINDS.COLLISION);
  assert.equal(system.report({ vehicleId: "traffic-car", speed: 12 }), false, "one active incident is invariant");
  assert.equal(system.force("traffic-car"), false);
});

test("ambient scheduling is deterministic, gated, and rain advances the next response", () => {
  const dryAdapters = createAdapters();
  const wetAdapters = createAdapters();
  const dry = createSystem(dryAdapters);
  const wet = createSystem(wetAdapters);

  dry.update(1, { ...OPEN_CONTEXT, wantedStars: 2 });
  wet.update(1, { ...OPEN_CONTEXT, wantedStars: 2, rain: 1 });
  for (let index = 0; index < 3; ++index) {
    dry.update(1, { ...OPEN_CONTEXT, wantedStars: 2 });
    wet.update(1, { ...OPEN_CONTEXT, wantedStars: 2, rain: 1 });
  }
  assert.equal(dry.snapshot().phase, ROADSIDE_PHASES.IDLE);
  assert.equal(wet.snapshot().phase, ROADSIDE_PHASES.IDLE);
  assert.equal(dryAdapters.selectionCount, 0);

  dry.update(0, OPEN_CONTEXT);
  wet.update(0, { ...OPEN_CONTEXT, rain: 1 });
  assert.equal(dry.snapshot().phase, ROADSIDE_PHASES.REPORTED);
  assert.equal(wet.snapshot().phase, ROADSIDE_PHASES.REPORTED);

  // Complete both immediately with a responder already at the target, then
  // compare the deterministic post-incident schedule.
  dryAdapters.entries.get("roadside-van").x = 30;
  dryAdapters.entries.get("roadside-van").z = 4;
  dryAdapters.entries.get("roadside-van").speed = 0;
  wetAdapters.entries.get("roadside-van").x = 30;
  wetAdapters.entries.get("roadside-van").z = 4;
  wetAdapters.entries.get("roadside-van").speed = 0;
  for (let index = 0; index < 4; ++index) {
    dry.update(1, OPEN_CONTEXT);
    wet.update(1, { ...OPEN_CONTEXT, rain: 1 });
  }
  assert.equal(dry.snapshot().phase, ROADSIDE_PHASES.CLEARING);
  assert.equal(wet.snapshot().phase, ROADSIDE_PHASES.CLEARING);
  dry.update(1, OPEN_CONTEXT);
  wet.update(1, { ...OPEN_CONTEXT, rain: 1 });
  assert.ok(wet.snapshot().nextAmbientIn < dry.snapshot().nextAmbientIn);
});

test("save and restore reapply adapters and continue from the exact phase timer", () => {
  const sourceAdapters = createAdapters();
  const source = createSystem(sourceAdapters);
  source.force("traffic-car", ROADSIDE_KINDS.BREAKDOWN);
  source.update(0, OPEN_CONTEXT);
  source.update(1, OPEN_CONTEXT);
  source.update(0.75, OPEN_CONTEXT);
  assert.equal(source.snapshot().phase, ROADSIDE_PHASES.RESPONDING);
  const saved = source.save();

  const restoredAdapters = createAdapters();
  const restored = createSystem(restoredAdapters);
  const restoredView = restored.restore(saved);
  assert.equal(restoredView.phase, ROADSIDE_PHASES.RESPONDING);
  assert.equal(restoredView.phaseElapsed, 0.75);
  assert.equal(restoredView.incidentId, 1);
  assert.deepEqual(restoredAdapters.commands.map(value => value.action), [
    ROADSIDE_VEHICLE_COMMANDS.HOLD,
    ROADSIDE_VEHICLE_COMMANDS.DISPATCH,
  ]);
  assert.equal(restoredAdapters.commands[1].responderId, "roadside-van", "restore supplies the saved responder preference");
  assert.deepEqual(restoredAdapters.observations.map(value => value.action), [ROADSIDE_OBSERVE_COMMANDS.BEGIN]);

  restoredAdapters.entries.get("roadside-van").x = 34;
  restoredAdapters.entries.get("roadside-van").speed = 0;
  restored.update(0, OPEN_CONTEXT);
  assert.equal(restored.snapshot().phase, ROADSIDE_PHASES.REPAIRING);
});

test("prewarm covers the complete vocabulary without mutating live state or adapters", () => {
  const adapters = createAdapters();
  const system = createSystem(adapters);
  system.force("traffic-car");
  const before = system.save();
  const prepared = system.prewarm();
  const after = system.save();

  assert.deepEqual(after, before);
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.rendererResources, 0);
  assert.equal(prepared.phasesPrepared, 6);
  assert.equal(prepared.vehicleCommandsPrepared, 5);
  assert.equal(prepared.populationCommandsPrepared, 2);
  assert.equal(prepared.liveStatePreserved, true);
  assert.ok(prepared.checksum > 0);
  assert.equal(adapters.commands.length, 0);
  assert.equal(adapters.observations.length, 0);
});
