import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  ROADSIDE_OBSERVER_RADIUS,
  ROADSIDE_OBSERVER_STATES,
} from "../src/actors/population.mjs";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-night-shift-roadside-qa.mjs <pipe> [output-directory]");
}

// Planned stable presentation contract shared with population.stage():
// - the curb actor remains in population snapshots while its presentation is
//   moved through pickup -> on-board -> arrived;
// - presentationKind is "night-shift-passenger";
// - presentationVisible is false only while the matching in-cab mesh is shown.
// The HUD has no separate public scene-graph diagnostic. Its stable black-card
// condition is the active activity.dialogue payload asserted below together
// with captured input and an unlocked authored narrative.
const TAXI_FARE_ID = "night-shift-harbour";
const TAXI_PRESENTATION_KIND = "night-shift-passenger";
const ROADSIDE_PHASE_ORDER = Object.freeze([
  "reported",
  "responding",
  "repairing",
  "clearing",
  "cooldown",
]);

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = new Map();
    this.serial = 0;
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "native Night Shift/Roadside request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native Night Shift/Roadside request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function connect(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const socket = await new Promise((resolve, reject) => {
        const candidate = net.createConnection(pipePath);
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }
  throw lastError ?? new Error("native Night Shift/Roadside pipe did not become ready");
}

async function capture(client, filename) {
  if (!outputDirectory) return null;
  const destination = path.join(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 30_000, `${filename} is unexpectedly small`);
  return result.path;
}

async function advance(client, steps) {
  return (await client.request("advance", { steps })).state;
}

async function clearPresentation(client) {
  let state = await client.request("snapshot");
  if (state.activity?.status === "active") {
    await client.request("cancelActivity");
    state = await advance(client, 200);
  }
  if (state.player.inVehicle) {
    await client.request("exitVehicle");
    state = await advance(client, 2);
  }
  for (let guard = 0; guard < 24 && state.narrative?.controlsLocked; ++guard) {
    if (state.chapterTwo?.chapterStarted) {
      if (state.chapterTwo.choice) {
        await client.request("chapterTwo", {
          action: "choose",
          option: state.chapterTwo.choice.options[0].id,
        });
      } else {
        await client.request("chapterTwo", { action: "advance", skip: true });
      }
    } else if (state.story?.choice) {
      await client.request("story", { action: "choose", option: state.story.choice.options[0].id });
    } else {
      await client.request("story", { action: "advance", skip: true });
    }
    state = await advance(client, 2);
  }
  assert.equal(state.narrative?.controlsLocked, false,
    "authored presentation did not release for Night Shift/Roadside QA");
  return state;
}

function taxiPassengerActors(state) {
  return state.population.filter(actor =>
    actor.staged === true && actor.presentationKind === TAXI_PRESENTATION_KIND);
}

function assertTaxiPassenger(state, { id = null, name, phase, visible }) {
  const actors = taxiPassengerActors(state);
  assert.equal(actors.length, 1, `expected exactly one staged taxi passenger during ${phase}`);
  const actor = actors[0];
  if (id !== null) assert.equal(actor.id, id, "the curb actor identity changed during boarding");
  assert.equal(actor.displayName, name);
  assert.equal(actor.presentationPhase, phase);
  assert.equal(actor.presentationVisible, visible);
  assert.equal(actor.storyLocked, true);
  assert.equal(actor.storyProtected, true);
  return actor;
}

function assertFareDialogueCard(state, expectedKind, previousSerial) {
  const activity = state.activity;
  assert.equal(activity?.kind, "taxi");
  assert.equal(activity.dialogue.active, true);
  assert.equal(activity.dialogue.kind, expectedKind);
  assert.equal(activity.dialogue.speaker, activity.passenger);
  assert.equal(activity.dialogue.role, activity.passengerRole);
  assert.ok(activity.dialogue.text.length >= 12, activity.dialogue);
  assert.ok(activity.dialogue.remaining > 0, activity.dialogue);
  assert.equal(activity.dialogue.serial, activity.dialogueSerial);
  assert.ok(activity.dialogueSerial > previousSerial,
    `the ${expectedKind} line did not advance the dialogue serial`);
  assert.equal(state.capture.locked, true);
  assert.equal(state.narrative.controlsLocked, false,
    "authored dialogue must not replace the non-blocking taxi conversation card");
  return activity.dialogue;
}

function assertSinglePresent(state, label) {
  assert.equal(state.diagnostics.presentation.path, "single-surface-offscreen-composite", `${label} presentation path`);
  assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1,
    `${label} rendered the native swap chain more than once`);
}

function assertNoFirstUseStall(state, label) {
  const timing = state.diagnostics.frameTiming;
  if (timing.samples === 0) return timing;
  assert.equal(timing.stallFrames, 0,
    `${label} produced ${timing.stallFrames} frame(s) over 50ms after memory warmup`);
  assert.ok(timing.maximumMs < 50,
    `${label} produced a ${timing.maximumMs.toFixed(2)}ms first-use frame`);
  return timing;
}

function roadsideVehicle(state, id) {
  return state.vehicles.find(vehicle => vehicle.id === id);
}

async function runRoadsideLifecycle(client, baselineCounts, captures) {
  const initialState = await client.request("snapshot");
  const serviceVehicles = initialState.vehicles.filter(vehicle =>
    vehicle.serviceRole === "pulse-roadside");
  assert.deepEqual(serviceVehicles.map(vehicle => vehicle.id), ["traffic-van-4", "traffic-van-8"],
    "the two-unit preauthored Pulse Roadside fleet is incomplete");
  assert.ok(serviceVehicles.every(vehicle => vehicle.roadsideBeaconCount === 4));
  const serviceVehicleIds = new Set(serviceVehicles.map(vehicle => vehicle.id));
  const calmObservers = initialState.population.filter(actor =>
    actor.roadsideObserverEligible === true && ROADSIDE_OBSERVER_STATES.includes(actor.state));
  assert.ok(calmObservers.length > 0, "no calm ordinary civilian can report a roadside incident");
  const targetCandidates = initialState.vehicles
    .filter(vehicle => vehicle.driver === "traffic" && !vehicle.police &&
      vehicle.serviceRole !== "pulse-roadside" && vehicle.health > 0)
    .map(vehicle => {
      let observerDistance = Infinity;
      let observerId = null;
      for (const actor of calmObservers) {
        const distance = Math.hypot(
          actor.position[0] - vehicle.position[0],
          actor.position[2] - vehicle.position[2],
        );
        if (distance < observerDistance) {
          observerDistance = distance;
          observerId = actor.id;
        }
      }
      let responderDistance = Infinity;
      let nearestResponderId = null;
      for (const responder of serviceVehicles) {
        const distance = Math.hypot(
          vehicle.position[0] - responder.position[0],
          vehicle.position[2] - responder.position[2],
        );
        if (distance >= responderDistance) continue;
        responderDistance = distance;
        nearestResponderId = responder.id;
      }
      return {
        vehicle,
        observerDistance,
        observerId,
        responderDistance,
        nearestResponderId,
      };
    });
  // Prefer a four-metre buffer because pedestrians keep walking between this
  // startup snapshot and the forced incident tick. Fall back to the exact
  // exported runtime boundary without inventing a second eligibility radius.
  const observerSafeCandidates = targetCandidates.filter(candidate =>
    candidate.observerDistance <= ROADSIDE_OBSERVER_RADIUS - 4);
  const observerEdgeCandidates = targetCandidates.filter(candidate =>
    candidate.observerDistance <= ROADSIDE_OBSERVER_RADIUS);
  const targetChoice = (observerSafeCandidates.length ? observerSafeCandidates : observerEdgeCandidates)
    .sort((left, right) =>
      Math.abs(left.responderDistance - 42) - Math.abs(right.responderDistance - 42) ||
      left.observerDistance - right.observerDistance ||
      String(left.vehicle.id).localeCompare(String(right.vehicle.id)))[0];
  assert.ok(targetChoice,
    `no eligible traffic car has a calm ordinary civilian inside the ${ROADSIDE_OBSERVER_RADIUS}m observer radius`);
  const targetVehicle = targetChoice.vehicle;

  const reset = await client.request("roadside", { action: "reset" });
  assert.equal(reset.phase, "idle");
  await client.request("resetFrameTiming");
  const forced = await client.request("roadside", {
    action: "force",
    kind: "breakdown",
    vehicleId: targetVehicle.id,
  });
  assert.equal(forced.phase, "idle");
  assert.equal(forced.pending, true);
  assert.equal(forced.pendingKind, "breakdown");

  const phases = [];
  const phaseEvidence = {};
  let lastPhase = null;
  let reporterObserved = false;
  let amberBeaconObserved = false;
  let cameraStaged = false;
  let maximumFrameMs = 0;
  let finalState = null;
  const roadsideTrace = [];
  let nextTraceAt = 0;
  const deadline = Date.now() + 50_000;

  while (Date.now() < deadline) {
    await wait(100);
    const state = await client.request("snapshot");
    finalState = state;
    assert.equal(state.vehicles.length, baselineCounts.vehicles,
      "an ambient incident changed the authored vehicle count");
    assert.equal(state.population.length, baselineCounts.population,
      "an ambient incident changed the authored population count");
    assertSinglePresent(state, `roadside ${state.roadside.phase}`);
    const timing = assertNoFirstUseStall(state, `roadside ${state.roadside.phase}`);
    maximumFrameMs = Math.max(maximumFrameMs, timing.maximumMs);

    const roadside = state.roadside;
    if (roadside.phase !== lastPhase) {
      lastPhase = roadside.phase;
      phases.push(roadside.phase);
      phaseEvidence[roadside.phase] = Object.freeze({
        incidentId: roadside.incidentId,
        kind: roadside.kind,
        targetVehicleId: roadside.targetVehicleId,
        responderVehicleId: roadside.responderVehicleId,
        reporterId: roadside.reporterId,
      });
    }

    if (["reported", "responding", "repairing"].includes(roadside.phase)) {
      assert.equal(roadside.active, true);
      assert.equal(roadside.kind, "breakdown");
      const target = roadsideVehicle(state, roadside.targetVehicleId);
      assert.ok(target, "roadside target disappeared");
      assert.equal(serviceVehicleIds.has(target.id), false, "a service van selected itself as the breakdown");
      assert.equal(target.roadsideRole, "target");
      assert.equal(target.roadsideIncidentId, roadside.incidentId);
      assert.equal(target.roadsideHeld, true);
      assert.equal(target.roadsideHazards, true);

      const reporter = state.population.find(actor => actor.id === roadside.reporterId);
      assert.ok(reporter, "the reporting neighbour disappeared from the stable population");
      assert.equal(reporter.staged, true);
      assert.equal(reporter.presentationKind, "roadside-observer");
      assert.equal(reporter.presentationPhase, "phone-watch");
      assert.equal(reporter.presentationVisible, true);
      assert.equal(reporter.idleMode, "phone");
      assert.equal(reporter.observationIncidentId, String(roadside.incidentId));
      assert.equal(reporter.observationKind, roadside.kind);
      reporterObserved = true;

      if (!cameraStaged) {
        cameraStaged = true;
        await client.request("teleport", {
          x: roadside.position[0] + 8,
          z: roadside.position[2] + 10,
        });
        await client.request("face", { target: roadside.targetVehicleId });
      }
    }

    if (roadside.phase === "responding" || roadside.phase === "repairing") {
      const responder = roadsideVehicle(state, roadside.responderVehicleId);
      assert.ok(responder, "dispatched roadside responder disappeared");
      assert.equal(serviceVehicleIds.has(responder.id), true, "dispatch did not choose a preauthored service unit");
      assert.equal(responder.roadsideRole, "responder");
      assert.equal(responder.roadsideIncidentId, roadside.incidentId);
      assert.equal(responder.roadsideResponding, true);
      assert.equal(responder.roadsideBeaconCount, 4);
      amberBeaconObserved ||= responder.visibleRoadsideBeacons > 0;
      if (roadside.phase === "repairing") assert.equal(responder.roadsideRepairing, true);
      if (Date.now() >= nextTraceAt) {
        nextTraceAt = Date.now() + 1_000;
        const target = roadsideVehicle(state, roadside.targetVehicleId);
        roadsideTrace.push({
          phase: roadside.phase,
          responder: responder.position,
          target: target?.position ?? null,
          distance: target ? Math.hypot(
            responder.position[0] - target.position[0],
            responder.position[2] - target.position[2],
          ) : null,
          speed: responder.speed,
          route: responder.roadsideRouteMode,
          waypoint: `${responder.roadsideWaypointCursor}/${responder.roadsideWaypointCount}`,
          navigation: `${responder.roadsideNavigationRoadId ?? "none"}:${responder.roadsideNavigationAxis ?? "none"}`,
          turn: responder.roadsideTurnApproach
            ? `${responder.roadsideTurnDistance.toFixed(2)}/${responder.roadsideTurnReach.toFixed(2)}`
            : null,
        });
      }
    }

    if (roadside.phase === "clearing" && outputDirectory && !captures.roadsideClearing) {
      captures.roadsideClearing = await capture(client, "04-pulse-roadside-clearing.png");
    }
    if (roadside.phase === "cooldown") break;
  }

  assert.ok(finalState, "no native roadside state was observed");
  const observedOrderedPhases = phases.filter(phase => ROADSIDE_PHASE_ORDER.includes(phase));
  assert.deepEqual(observedOrderedPhases, ROADSIDE_PHASE_ORDER,
    `roadside lifecycle was incomplete: ${phases.join(" -> ")}\n` +
    `target=${targetVehicle.id}, initialResponderDistance=${targetChoice.responderDistance.toFixed(2)}\n` +
    JSON.stringify(roadsideTrace, null, 2));
  assert.equal(finalState.roadside.completedIncidents, 1);
  assert.equal(finalState.roadside.cancelledIncidents, 0);
  assert.equal(finalState.roadside.totalIncidents, 1);
  assert.equal(reporterObserved, true, "no neighbour visibly reported the incident");
  assert.equal(amberBeaconObserved, true, "the responder's four pooled amber beacons never illuminated");
  assert.ok(finalState.population.every(actor => actor.observationIncidentId === null),
    "the reporting neighbour did not return to ambient life after clearing");
  for (const serviceVehicle of serviceVehicles) {
    const clearedResponder = roadsideVehicle(finalState, serviceVehicle.id);
    assert.equal(clearedResponder.roadsideRole, null);
    assert.equal(clearedResponder.roadsideResponding, false);
    assert.equal(clearedResponder.roadsideRepairing, false);
    assert.equal(clearedResponder.visibleRoadsideBeacons, 0);
  }
  assert.ok(finalState.diagnostics.frameTiming.samples >= 20, finalState.diagnostics.frameTiming);
  assertNoFirstUseStall(finalState, "complete roadside lifecycle");
  return {
    phases,
    phaseEvidence,
    forcedTargetVehicleId: targetVehicle.id,
    expectedObserverId: targetChoice.observerId,
    expectedObserverDistance: targetChoice.observerDistance,
    initialResponderDistance: targetChoice.responderDistance,
    reporterObserved,
    amberBeaconObserved,
    maximumFrameMs,
    timing: finalState.diagnostics.frameTiming,
    completed: finalState.roadside,
  };
}

async function main() {
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  const captures = {};
  let initialSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.capture.locked, true);
    assert.equal(state.diagnostics.pipelineWarmup.ready, true);
    assert.equal(state.diagnostics.pipelineWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.simulationWarmup.ready, true);
    assertSinglePresent(state, "startup");
    initialSave = await client.request("save");

    state = await clearPresentation(client);
    await client.request("roadside", { action: "reset" });
    await client.request("clearWanted");
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 21.5 });
    state = await advance(client, 3);

    const populationCount = state.population.length;
    const vehicleCount = state.vehicles.length;
    const taxi = state.vehicles.find(vehicle => vehicle.id === "parked-taxi" && vehicle.health > 0) ??
      state.vehicles.find(vehicle => vehicle.kind === "taxi" && vehicle.health > 0);
    assert.ok(taxi, "Night Shift Stories has no driveable taxi");
    await client.request("enterVehicle", { vehicleId: taxi.id });
    await client.request("clearWanted");
    state = await advance(client, 2);
    assert.equal(state.player.inVehicle, taxi.id);
    const enteredTaxi = roadsideVehicle(state, taxi.id);
    assert.equal(enteredTaxi.taxiPassengerVisible, false);
    assert.equal(enteredTaxi.headlightsOn, true,
      "external player low beams must remain truthful in the public vehicle snapshot");
    assert.ok(state.diagnostics.headlights.intensity >= 600 && state.diagnostics.headlights.intensity <= 715,
      `calibrated clear-night twin low beams should total about 660, got ${state.diagnostics.headlights.intensity}`);
    const startingCash = state.player.cash;

    const started = await client.request("startTaxi", { fareId: TAXI_FARE_ID });
    assert.equal(started.fareId, TAXI_FARE_ID);
    assert.equal(started.passenger, "Samira Cole");
    assert.equal(started.passengerRole, "Home-care assistant");
    assert.equal(started.stage, "pickup");
    assert.equal(started.status, "active");
    const pickup = started.targetPosition;
    await client.request("teleport", {
      x: pickup[0] + 7,
      z: pickup[2],
      yaw: Math.PI * 0.5,
    });
    state = await advance(client, 2);
    const curbPassenger = assertTaxiPassenger(state, {
      name: started.passenger,
      phase: "pickup",
      visible: true,
    });
    assert.ok(Math.hypot(
      curbPassenger.position[0] - pickup[0],
      curbPassenger.position[2] - pickup[2],
    ) < 0.75, "the named passenger was not staged at the authored curb pickup");
    assert.equal(state.population.length, populationCount);
    assert.equal(state.vehicles.length, vehicleCount);
    captures.curbPassenger = await capture(client, "01-night-shift-curb-passenger.png");

    await client.request("teleport", { x: pickup[0], z: pickup[2], yaw: Math.PI * 0.5 });
    state = await advance(client, 90);
    assert.equal(state.activity.stage, "dropoff", "Samira did not finish boarding the stopped cab");
    assert.equal(state.activity.passengerOnBoard, true);
    assertTaxiPassenger(state, {
      id: curbPassenger.id,
      name: started.passenger,
      phase: "on-board",
      visible: false,
    });
    const occupiedTaxi = roadsideVehicle(state, taxi.id);
    assert.equal(occupiedTaxi.taxiPassengerVisible, true);
    assert.ok(occupiedTaxi.visibleOccupants >= 2,
      "the player driver and named rear passenger must both read through the cabin glass");
    const boardLine = assertFareDialogueCard(state, "board", started.dialogueSerial);
    assert.equal(boardLine.text, started.fare.dialogue.board);
    assertSinglePresent(state, "taxi boarding dialogue");
    captures.onboardDialogue = await capture(client, "02-night-shift-onboard-dialogue.png");

    const boardSerial = state.activity.dialogueSerial;
    const dropoff = state.activity.targetPosition;
    await client.request("teleport", { x: dropoff[0], z: dropoff[2], yaw: Math.PI });
    state = await advance(client, 50);
    assert.equal(state.activity.status, "completed");
    assert.equal(state.activity.stage, "complete");
    assert.ok(state.activity.payout > 0, state.activity);
    assert.equal(state.player.cash, startingCash + state.activity.payout,
      "the completed named fare did not pay exactly once");
    const completionLine = assertFareDialogueCard(state, "safe", boardSerial);
    assert.equal(completionLine.text, state.activity.fare.dialogue.safe);
    const completedPayout = state.activity.payout;
    const completedSerial = state.activity.dialogueSerial;
    assertTaxiPassenger(state, {
      id: curbPassenger.id,
      name: started.passenger,
      phase: "arrived",
      visible: true,
    });
    state = await client.request("render");
    assert.equal(state.activity.payout, completedPayout,
      "rendering the completion card changed its persisted payout");
    assert.equal(state.activity.dialogueSerial, completedSerial);
    assert.equal(state.activity.dialogue.text, completionLine.text,
      "rendering the completion card dropped the passenger's final line");
    assert.equal(roadsideVehicle(state, taxi.id).taxiPassengerVisible, false);
    assertSinglePresent(state, "taxi completion dialogue");
    captures.completionDialogue = await capture(client, "03-night-shift-completion-dialogue.png");

    state = await client.request("snapshot");
    if (state.activity) await client.request("cancelActivity");
    state = await advance(client, 220);
    assert.equal(state.activity, null, "the completed taxi activity did not release after cancel/reset");
    assert.equal(taxiPassengerActors(state).length, 0,
      "the staged passenger was not returned to the ambient population after the fare");
    assert.equal(state.player.cash, startingCash + completedPayout, "taxi cleanup paid the fare twice");
    await client.request("exitVehicle");
    await client.request("clearWanted");
    await client.request("teleport", { x: 0, z: 0 });
    state = await advance(client, 3);

    const roadside = await runRoadsideLifecycle(client, {
      vehicles: vehicleCount,
      population: populationCount,
    }, captures);

    state = await client.request("snapshot");
    assert.equal(state.vehicles.length, vehicleCount);
    assert.equal(state.population.length, populationCount);
    assert.equal(state.player.cash, startingCash + completedPayout);
    assert.equal(state.wanted.stars, 0);
    assertSinglePresent(state, "final roadside cooldown");

    console.log(JSON.stringify({
      backend: state.diagnostics.backend,
      assumptions: {
        stagedPopulationFields: [
          "staged",
          "presentationKind",
          "presentationPhase",
          "presentationVisible",
        ],
        taxiPresentationKind: TAXI_PRESENTATION_KIND,
        dialogueCardCondition: "activity.dialogue.active && capture.locked && !narrative.controlsLocked",
      },
      stableCounts: { vehicles: vehicleCount, population: populationCount },
      fare: {
        id: TAXI_FARE_ID,
        passenger: started.passenger,
        curbActorId: curbPassenger.id,
        cabId: taxi.id,
        boardDialogueSerial: boardSerial,
        completionDialogueSerial: completedSerial,
        payout: completedPayout,
        completionLine: completionLine.text,
      },
      roadside,
      captures,
    }, null, 2));
  } finally {
    await client.request("roadside", { action: "reset" }).catch(() => {});
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "KeyS", down: false }).catch(() => {});
    await client.request("clearWanted").catch(() => {});
    if (initialSave) await client.request("restore", { snapshot: initialSave }).catch(() => {});
    client.close();
  }
}

await main();
