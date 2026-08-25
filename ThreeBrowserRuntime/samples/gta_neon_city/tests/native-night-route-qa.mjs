import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-night-route-qa.mjs <pipe> [output-directory]");
}

const SIGNED_LEDGER = Object.freeze({
  serviceDaysSecured: 365,
  fullTimetableMonths: 12,
  publicRiderRecords: 5,
  lateRunsCut: 0,
  weeklyCountingHours: 0,
});
const PARTICIPANTS = Object.freeze([
  ["malik_reed", "MALIK REED"],
  ["evelyn_cho", "EVELYN CHO"],
  ["desmond_vale", "DESMOND VALE"],
  ["nadiya_khoury", "NADIYA KHOURY"],
]);
const DINER_OFFSETS = Object.freeze({
  malik_reed: Object.freeze([-2.40, 0.90]),
  evelyn_cho: Object.freeze([-2.60, -1.10]),
  desmond_vale: Object.freeze([-0.80, -2.00]),
  nadiya_khoury: Object.freeze([1.00, -1.10]),
});

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
      else pending.reject(new Error(response.error || "native Night Count request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native Night Count request timed out: ${op}`));
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
  throw lastError ?? new Error("native Night Count pipe did not become ready");
}

async function capture(client, filename) {
  if (!outputDirectory) return null;
  const destination = path.join(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 30_000, `${filename} is unexpectedly small`);
  // GPU readback is an explicit development operation, not a gameplay frame.
  // Keep it out of the following real-play stall window.
  await client.request("resetFrameTiming");
  return result.path;
}

function assertSinglePresent(state, label) {
  assert.equal(state.diagnostics.presentation.path, "single-surface-offscreen-composite", `${label} path`);
  assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1, `${label} presented more than once`);
}

function assertLogicalPlayerPosition(actual, expected, label) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), `${label}: player position is unavailable`);
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-6 && Math.abs(actual[2] - expected[2]) < 1e-6,
    `${label}: render-only staging moved Kai across the ground plane`);
  assert.ok(Math.abs(actual[1] - expected[1]) < 0.02,
    `${label}: vertical grounding drifted by ${(actual[1] - expected[1]).toFixed(4)}m`);
}

function assertNoStall(state, label) {
  assertSinglePresent(state, label);
  const timing = state.diagnostics.frameTiming;
  if (!timing.samples) return 0;
  if (timing.stallFrames > 0 || timing.maximumMs >= 50) {
    console.error(JSON.stringify({ label, timing }, null, 2));
  }
  assert.equal(timing.stallFrames, 0, `${label} produced ${timing.stallFrames} frame(s) over 50ms`);
  assert.ok(timing.maximumMs < 50, `${label} produced a ${timing.maximumMs.toFixed(2)}ms frame`);
  return timing.maximumMs;
}

function stagedParticipants(state) {
  return state.population.filter(actor =>
    actor.staged === true && actor.presentationKind === "night-route-participant");
}

function participantIds(state) {
  return Object.fromEntries(state.diagnostics.nightRoute.participants.map(value =>
    [value.characterId, value.actorId]));
}

function pulseTransitVehicle(state) {
  const id = state.diagnostics.nightRoute.pulseTransitVehicleId ?? state.world.pulseTransit.vehicleId;
  const vehicle = state.vehicles.find(value => value.id === id);
  assert.ok(vehicle, `Pulse Line vehicle ${id} is absent from the stable vehicle set`);
  return vehicle;
}

function assertDinerRenderSuppression(state, expected, label) {
  const route = state.diagnostics.nightRoute;
  const presentation = state.diagnostics.presentation;
  assert.equal(route.pulseTransitVehicleVisible, true,
    `${label}: render-only state leaked into the live Pulse Line root`);
  assert.equal(presentation.renderOnlyVisibilityRestored, true,
    `${label}: drawable visibility was not restored`);
  assert.equal(presentation.renderOnlyIntensityRestored, true,
    `${label}: headlight intensity was not restored`);
  if (expected) {
    assert.ok(route.pulseTransitRenderDrawables > 0, `${label}: no Pulse Line drawables were discovered`);
    assert.ok(route.pulseTransitRenderLights > 0, `${label}: no resident Pulse Line lights were discovered`);
    assert.equal(presentation.lastStageRenderOnlyHidden, route.pulseTransitRenderDrawables,
      `${label}: the bus silhouette was not suppressed`);
    assert.equal(presentation.lastStageRenderOnlyZeroIntensity, route.pulseTransitRenderLights,
      `${label}: the hidden bus left floating headlight spill`);
  } else {
    assert.equal(presentation.lastStageRenderOnlyHidden, 0, `${label}: bus drawables stayed suppressed`);
    assert.equal(presentation.lastStageRenderOnlyZeroIntensity, 0, `${label}: bus lights stayed suppressed`);
  }
}

function assertParticipants(state, expectedIds, populationCount) {
  assert.equal(state.population.length, populationCount, "The Night Count changed the public population count");
  const actors = stagedParticipants(state);
  assert.equal(actors.length, 4, "The Night Count must borrow exactly four ordinary actors");
  for (const [characterId, name] of PARTICIPANTS) {
    const diagnostic = state.diagnostics.nightRoute.participants.find(value => value.characterId === characterId);
    assert.ok(diagnostic?.staged, `${name} is not staged`);
    assert.equal(diagnostic.name, name);
    assert.equal(diagnostic.actorId, expectedIds[characterId], `${name} changed ambient identity`);
    const actor = actors.find(value => value.id === diagnostic.actorId);
    assert.ok(actor, `${name}'s actor is absent from the stable population`);
    assert.equal(actor.displayName, name);
    assert.equal(actor.presentationKey, `night-route:${characterId}`);
    assert.equal(actor.storyLocked, true);
    assert.equal(actor.storyProtected, true);
    assert.equal(actor.presentationVisible, true);
  }
  const rosa = state.population.find(actor => actor.id === state.diagnostics.nightRoute.rosaActorId);
  assert.equal(rosa?.id, "shopkeeper-southline_diner");
  assert.equal(rosa?.displayName, "ROSA ALVAREZ");
  assert.equal(rosa?.staged, false, "Rosa must reuse her existing protected shopkeeper actor");
}

function participantDiagnostics(state) {
  return Object.fromEntries(state.diagnostics.nightRoute.participants.map(value =>
    [value.characterId, value]));
}

function assertDinerTableau(state, hubPosition, expectedPhase) {
  assert.equal(state.diagnostics.nightRoute.participantLayout, `diner:${expectedPhase}`);
  const staged = participantDiagnostics(state);
  for (const [characterId, offset] of Object.entries(DINER_OFFSETS)) {
    assert.ok(Math.abs(staged[characterId].position[0] - (hubPosition[0] + offset[0])) < 0.01,
      `${characterId} is not on its authored diner x mark`);
    assert.ok(Math.abs(staged[characterId].position[2] - (hubPosition[2] + offset[1])) < 0.01,
      `${characterId} is not on its authored diner z mark`);
  }
}

function assertRouteLayout(state, hubPosition, waitingZ, expectedPhase) {
  assert.equal(state.diagnostics.nightRoute.participantLayout, `route:${expectedPhase}`);
  const staged = participantDiagnostics(state);
  assert.ok(Math.abs(staged.malik_reed.position[0] - 48) < 0.01);
  assert.ok(Math.abs(staged.desmond_vale.position[0]) < 0.01);
  assert.ok(Math.abs(staged.nadiya_khoury.position[0] + 96) < 0.01);
  for (const characterId of ["malik_reed", "desmond_vale", "nadiya_khoury"]) {
    assert.ok(Math.abs(staged[characterId].position[2] - waitingZ) < 0.01,
      `${characterId} is not on the safe Pulse Line waiting edge`);
  }
  assert.ok(Math.hypot(
    staged.evelyn_cho.position[0] - hubPosition[0],
    staged.evelyn_cho.position[2] - hubPosition[2],
  ) < 3, "Evelyn is not staged at a safe diner conversation offset");
}

async function neutralize(client) {
  let state = await client.request("snapshot");
  if (state.paused) state = await setPaused(client, false);
  if (state.selectedActivity === "nightRoute") {
    await client.request("nightRoute", { action: "reset" });
    state = await client.request("snapshot");
  } else if (state.activity) {
    await client.request("cancelActivity");
    await wait(80);
    state = await client.request("snapshot");
  }
  if (state.player.inVehicle) {
    await client.request("exitVehicle");
    state = await client.request("snapshot");
  }
  for (let guard = 0; guard < 48 && state.narrative?.controlsLocked; ++guard) {
    if (state.chapterTwo?.chapterStarted) {
      await client.request("chapterTwo", state.chapterTwo.choice
        ? { action: "choose", option: state.chapterTwo.choice.options[0].id }
        : { action: "advance", skip: true });
    } else {
      await client.request("story", state.story.choice
        ? { action: "choose", option: state.story.choice.options[0].id }
        : { action: "advance", skip: true });
    }
    state = await client.request("snapshot");
  }
  assert.equal(state.narrative?.controlsLocked, false, "another authored scene still owns controls");
  if (state.neighbourhood?.menuOpen) await client.request("closeBusiness");
  await client.request("clearWanted");
  await client.request("nightRoute", { action: "reset" });
  return client.request("snapshot");
}

function progressionSave(base, unlocked) {
  const value = structuredClone(base);
  assert.equal(value.version, 7, "native runtime did not migrate to persistent save v7");
  value.activities.selected = null;
  value.activities.life.completedCount = unlocked ? 2 : 0;
  value.activities.taxi.completedCount = unlocked ? 1 : 0;
  value.activities.presentationUntil = 0;
  value.neighbourhood.menuOpen = false;
  value.neighbourhood.activeBusinessId = null;
  value.neighbourhood.familiarity[value.neighbourhood.familiarity.length - 1] = unlocked ? 2 : 0;
  return value;
}

async function skipDialogue(client, expectedSelection = "nightRoute") {
  let state = await client.request("snapshot");
  for (let guard = 0; state.activity?.dialogue?.active && guard < 96; ++guard) {
    await client.request("nightRoute", { action: "advance", skip: true });
    await wait(45);
    state = await client.request("snapshot");
  }
  assert.ok(!state.activity?.dialogue?.active, "Night Count dialogue did not settle");
  // Synchronize camera ownership and render-only participant layout through a
  // real fixed update. Native windows may intentionally throttle animation
  // callbacks while unfocused, so a sleep alone is not a reliable boundary.
  state = (await client.request("advance", { steps: 1 })).state;
  if (!state.nightRoute.completed) assert.equal(state.selectedActivity, expectedSelection);
  return state;
}

async function finishCurrentSequence(client) {
  let state = await client.request("snapshot");
  const sequenceId = state.activity?.activeSequenceId;
  assert.ok(sequenceId, "Night Count has no active sequence to finish");
  for (let guard = 0;
    state.activity?.dialogue?.active && state.activity.activeSequenceId === sequenceId && guard < 96;
    ++guard) {
    await client.request("nightRoute", { action: "advance", skip: true });
    await wait(45);
    state = await client.request("snapshot");
  }
  assert.notEqual(state.activity?.activeSequenceId, sequenceId,
    `Night Count sequence ${sequenceId} did not settle`);
  return (await client.request("advance", { steps: 1 })).state;
}

async function press(client, action, settleMs = 120) {
  await client.request("action", { action });
  await client.request("advance", { steps: 1 });
  await wait(settleMs);
  // Return a synchronized presented state, not whichever state the
  // potentially throttled animation callback last happened to publish.
  return client.request("render");
}

async function setPaused(client, paused) {
  let state = await client.request("snapshot");
  if (state.paused !== paused) {
    await client.request("action", { action: "pause" });
    // Process the injected edge through the same fixed update as gameplay.
    // A wall-clock wait is not deterministic while native GPU readback or a
    // debugger temporarily frame-paces the animation callback.
    state = (await client.request("advance", { steps: 1 })).state;
  }
  assert.equal(state.paused, paused, `native pause state did not become ${paused}`);
  return state;
}

async function main() {
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  const captures = {};
  let originalSave = null;
  let maximumFrameMs = 0;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.diagnostics.pipelineWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.simulationWarmup.nightRoutePrepared.ready, true);
    assert.equal(state.diagnostics.simulationWarmup.nightRoutePresentationPrepared.accepted, true);
    assert.equal(state.diagnostics.simulationWarmup.nightRoutePresentationPrepared.released, 4);
    originalSave = await client.request("save");

    state = await neutralize(client);
    const cleanSave = await client.request("save");
    const populationCount = state.population.length;
    const vehicleCount = state.vehicles.length;

    await client.request("restore", { snapshot: progressionSave(cleanSave, false) });
    let availability = await client.request("nightRoute", { action: "availability" });
    assert.equal(availability.unlocked, false);
    assert.deepEqual(availability.missing, [
      "complete_two_city_activities",
      "complete_one_night_fare",
      "become_a_southline_regular",
    ]);
    const rejected = await client.request("startNightRoute", { force: true });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, "ordinary_progress_required");
    assert.equal((await client.request("snapshot")).selectedActivity, null);

    await client.request("restore", { snapshot: progressionSave(cleanSave, true) });
    availability = await client.request("nightRoute", { action: "availability" });
    assert.equal(availability.unlocked, true);
    assert.deepEqual(availability.progress, {
      lifeActivitiesCompleted: 2,
      taxiFaresCompleted: 1,
      southlineFamiliarity: 2,
    });
    await client.request("setTime", { hours: 21.5 });
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("teleport", { x: availability.hubPosition[0], z: availability.hubPosition[2] });
    await client.request("resetFrameTiming");
    const ambientBeforeMeeting = await client.request("snapshot");

    // Exercise the real E path at Southline. It must win this one-time authored
    // meeting instead of silently opening the ordinary diner menu.
    state = await press(client, "interact", 950);
    assert.equal(state.selectedActivity, "nightRoute");
    assert.equal(state.activity.kind, "ordinary_story");
    assert.equal(state.activity.phase, "briefing");
    assert.equal(state.neighbourhood.menuOpen, false);
    assert.equal(state.activity.controlsLocked, true);
    assert.equal(state.narrative.active, true);
    assert.equal(state.narrative.line.text, state.activity.dialogue.text);
    assert.equal(state.narrative.line.speaker, state.activity.dialogue.speaker);
    assert.equal(state.diagnostics.cinematic.active, true,
      "the Night Count briefing did not take camera ownership");
    assert.equal(state.diagnostics.cinematic.shot, "night_diner_group");
    assertLogicalPlayerPosition(state.player.position, ambientBeforeMeeting.player.position,
      "the diner cutscene changed Kai's logical player position");
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true,
      "render-only suppression leaked into the Pulse Line scene node");
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden,
      state.diagnostics.nightRoute.pulseTransitRenderDrawables,
      "the Pulse Line was not omitted from the diner world render");
    assert.ok(state.diagnostics.nightRoute.pulseTransitRenderDrawables > 0);
    assert.equal(state.diagnostics.presentation.renderOnlyVisibilityRestored, true);
    assertDinerRenderSuppression(state, true, "briefing");
    assert.equal(state.capture.locked, true);
    assert.equal(state.vehicles.length, vehicleCount);
    const stableParticipantIds = participantIds(state);
    assert.equal(new Set(Object.values(stableParticipantIds)).size, 4);
    const originalAmbientById = Object.fromEntries(Object.values(stableParticipantIds).map(actorId => {
      const actor = ambientBeforeMeeting.population.find(value => value.id === actorId);
      assert.ok(actor, `borrowed actor ${actorId} did not exist before the meeting`);
      return [actorId, {
        displayName: actor.displayName,
        routine: actor.routine,
        storyLocked: actor.storyLocked,
        storyProtected: actor.storyProtected,
      }];
    }));
    assertParticipants(state, stableParticipantIds, populationCount);
    const waitingZ = state.world.pulseTransit.waitingAnchors[0][2];
    assertDinerTableau(state, availability.hubPosition, "briefing");
    maximumFrameMs = Math.max(maximumFrameMs, assertNoStall(state, "first Night Count briefing frame"));

    // Freeze simulation around one explicit render. The presenter may hide
    // the existing Pulse Line only inside renderer.render; the complete save,
    // player and vehicle state must remain byte-for-byte identical afterward.
    state = await setPaused(client, true);
    const beforeSuppressedRender = await client.request("save");
    const pulseBeforeSuppressedRender = structuredClone(pulseTransitVehicle(state));
    state = await client.request("render");
    const afterSuppressedRender = await client.request("save");
    assert.deepEqual(afterSuppressedRender, beforeSuppressedRender,
      "a render-only diner frame mutated persistent gameplay state");
    assert.deepEqual(pulseTransitVehicle(state), pulseBeforeSuppressedRender,
      "a render-only diner frame mutated the live Pulse Line snapshot");
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true,
      "the explicit diner render failed to restore Pulse Line visibility");
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden,
      state.diagnostics.nightRoute.pulseTransitRenderDrawables);
    assert.equal(state.diagnostics.presentation.renderOnlyVisibilityRestored, true);
    state = await setPaused(client, false);
    captures.briefing = await capture(client, "01-night-count-briefing.png");

    await client.request("nightRoute", { action: "advance", skip: true });
    await wait(120);
    state = await client.request("snapshot");
    assert.equal(state.activity.dialogue.speaker, "MALIK REED");
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.equal(state.diagnostics.cinematic.shot, "night_diner_speaker",
      "a named participant line retained the ordinary chase camera");
    assertLogicalPlayerPosition(state.player.position, ambientBeforeMeeting.player.position,
      "the speaker reverse changed Kai's logical player position");
    assertDinerTableau(state, availability.hubPosition, "briefing");
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden,
      state.diagnostics.nightRoute.pulseTransitRenderDrawables);
    captures.speaker = await capture(client, "02-night-count-speaker.png");

    state = await skipDialogue(client);
    assert.equal(state.activity.phase, "survey");
    assert.equal(state.narrative.controlsLocked, false);
    assert.equal(state.diagnostics.cinematic.active, false);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden, 0,
      "the Pulse Line did not return to ordinary route rendering");
    assertDinerRenderSuppression(state, false, "survey gameplay");
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true);
    assertRouteLayout(state, availability.hubPosition, waitingZ, "survey");
    assertLogicalPlayerPosition(state.player.position, ambientBeforeMeeting.player.position,
      "returning to route play did not restore Kai's logical position");
    const pulseLineId = state.world.pulseTransit.vehicleId;
    await client.request("enterVehicle", { vehicleId: pulseLineId });
    state = await client.request("snapshot");
    assert.equal(state.player.inVehicle, pulseLineId);

    for (let stopIndex = 0; stopIndex < 4; ++stopIndex) {
      const target = state.activity.targetPosition;
      assert.ok(Array.isArray(target), `survey stop ${stopIndex + 1} has no target`);
      await client.request("teleport", { x: target[0], z: target[2], yaw: Math.PI * 0.5 });
      state = await press(client, "interact", 150);
      assert.equal(state.activity.surveyIndex, stopIndex + 1, `E missed survey stop ${stopIndex + 1}`);
      assert.equal(state.activity.dialogue.active, true);
      assert.equal(state.activity.controlsLocked, false, "route conversation unexpectedly stopped driving controls");
      assert.equal(state.narrative.controlsLocked, false);
      assertParticipants(state, stableParticipantIds, populationCount);
      assertRouteLayout(state, availability.hubPosition, waitingZ, "survey");
      if (stopIndex === 0) captures.survey = await capture(client, "03-night-count-route-line.png");
      state = await finishCurrentSequence(client);
      maximumFrameMs = Math.max(maximumFrameMs, assertNoStall(state, `survey stop ${stopIndex + 1}`));
    }

    assert.equal(state.activity.phase, "decision");
    assert.equal(state.activity.controlsLocked, true);
    assert.equal(state.narrative.active, true);
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.equal(state.diagnostics.cinematic.shot, "night_diner_speaker");
    assertDinerTableau(state, availability.hubPosition, "decision");
    const decisionLogicalPosition = state.player.position;
    state = await skipDialogue(client);
    assert.ok(state.activity.choice, "evidence decision did not become available");
    assert.equal(state.narrative.choice.prompt, "WHAT EVIDENCE DOES KAI FILE?");
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.equal(state.diagnostics.cinematic.shot, "night_diner_choice");
    assertLogicalPlayerPosition(state.player.position, decisionLogicalPosition,
      "the evidence tableau changed Kai's logical position");
    assertDinerTableau(state, availability.hubPosition, "decision");
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden,
      state.diagnostics.nightRoute.pulseTransitRenderDrawables);
    assert.equal(state.diagnostics.presentation.renderOnlyVisibilityRestored, true);
    assertDinerRenderSuppression(state, true, "evidence choice");
    captures.decision = await capture(client, "04-night-count-choice-tableau.png");

    // D is the second authored option: the full year with five public records.
    state = await press(client, "right", 160);
    assert.equal(state.activity.choiceResult, "signed_year");
    assert.deepEqual(state.activity.moralLedger, SIGNED_LEDGER);
    assert.equal(state.activity.dialogue.active, true);
    assert.equal(state.activity.controlsLocked, true);
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.equal(state.diagnostics.cinematic.shot, "night_diner_kai");
    assertLogicalPlayerPosition(state.player.position, decisionLogicalPosition,
      "choosing a branch changed Kai's logical position");
    assertDinerTableau(state, availability.hubPosition, "decision");
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden,
      state.diagnostics.nightRoute.pulseTransitRenderDrawables);
    captures.choice = await capture(client, "05-night-count-signed-ledger.png");

    // Freeze a real branch line, round-trip the full persistent save, and prove
    // the precise line/ledger plus all four borrowed ambient identities return.
    state = await press(client, "pause", 100);
    assert.equal(state.paused, true);
    const beforeRestore = state;
    const midLineSave = await client.request("save");
    const restoredPersistent = await client.request("restore", { snapshot: midLineSave });
    assert.deepEqual(restoredPersistent.activities.nightRoute, midLineSave.activities.nightRoute);
    state = await client.request("snapshot");
    assert.equal(state.paused, true);
    assert.equal(state.activity.dialogue.serial, beforeRestore.activity.dialogue.serial);
    assert.equal(state.activity.dialogue.text, beforeRestore.activity.dialogue.text);
    assert.equal(state.activity.dialogue.remaining, beforeRestore.activity.dialogue.remaining);
    assertLogicalPlayerPosition(state.player.position, beforeRestore.player.position,
      "save/restore changed Kai's logical position during render-only staging");
    assert.deepEqual(state.activity.moralLedger, SIGNED_LEDGER);
    assert.deepEqual(participantIds(state), stableParticipantIds);
    assertParticipants(state, stableParticipantIds, populationCount);
    assert.equal(state.diagnostics.nightRoute.completionEventsHandled, 0);
    state = await press(client, "pause", 100);
    assert.equal(state.paused, false);

    state = await skipDialogue(client);
    assert.equal(state.activity.phase, "aftermath");
    assert.equal(state.diagnostics.cinematic.active, false);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden, 0);
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true,
      "the Pulse Line did not reappear when aftermath gameplay resumed");
    assertRouteLayout(state, availability.hubPosition, waitingZ, "aftermath");
    await client.request("exitVehicle");
    state = await client.request("snapshot");
    assert.equal(state.player.inVehicle, null);

    for (let taskIndex = 0; taskIndex < 3; ++taskIndex) {
      const target = state.activity.targetPosition;
      assert.ok(Array.isArray(target), `aftermath task ${taskIndex + 1} has no target`);
      await client.request("teleport", { x: target[0], z: target[2] });
      state = await press(client, "interact", 150);
      assert.equal(state.activity.aftermathIndex, taskIndex + 1, `E missed aftermath task ${taskIndex + 1}`);
      assert.equal(state.activity.dialogue.active, true);
      assertParticipants(state, stableParticipantIds, populationCount);
      assertRouteLayout(state, availability.hubPosition, waitingZ, "aftermath");
      state = await finishCurrentSequence(client);
      maximumFrameMs = Math.max(maximumFrameMs, assertNoStall(state, `aftermath task ${taskIndex + 1}`));
    }

    // The final task flows into a blocking epilogue, then releases the exact
    // borrowed actors without a spawn, payout, or second completion event.
    assert.equal(state.activity.activeSequenceId, "signed_epilogue");
    assert.equal(state.activity.controlsLocked, true);
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.equal(state.diagnostics.cinematic.shot, "night_diner_group");
    assertDinerTableau(state, availability.hubPosition, "aftermath");
    assertParticipants(state, stableParticipantIds, populationCount);
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden,
      state.diagnostics.nightRoute.pulseTransitRenderDrawables);
    assert.equal(state.diagnostics.presentation.renderOnlyVisibilityRestored, true);
    assertDinerRenderSuppression(state, true, "epilogue");
    captures.epilogue = await capture(client, "06-night-count-epilogue.png");
    state = await skipDialogue(client);
    // Let the spring camera complete its authored-cinematic hand-back before
    // taking the free-roam evidence frame. The player sees this interpolation
    // in real time; a control-pipe capture should not freeze its first tick.
    await client.request("advance", { steps: 45 });
    state = await client.request("render");
    assert.equal(state.nightRoute.completed, true);
    assert.equal(state.nightRoute.choiceResult, "signed_year");
    assert.deepEqual(state.nightRoute.moralLedger, SIGNED_LEDGER);
    assert.equal(state.diagnostics.nightRoute.completionEventsHandled, 1);
    assert.equal(stagedParticipants(state).length, 0);
    assert.ok(state.diagnostics.nightRoute.participants.every(value => value.actorId === null));
    for (const [actorId, original] of Object.entries(originalAmbientById)) {
      const released = state.population.find(actor => actor.id === actorId);
      assert.ok(released, `released ambient actor ${actorId} disappeared`);
      assert.equal(released.staged, false);
      assert.equal(released.displayName, original.displayName);
      assert.equal(released.routine, original.routine);
      assert.equal(released.storyLocked, original.storyLocked);
      assert.equal(released.storyProtected, original.storyProtected);
    }
    assert.equal(state.population.length, populationCount);
    assert.equal(state.vehicles.length, vehicleCount);
    assert.equal(state.diagnostics.nightRoute.pulseTransitVehicleVisible, true);
    assert.equal(state.diagnostics.presentation.lastStageRenderOnlyHidden, 0,
      "completed Night Count left the Pulse Line suppressed from gameplay rendering");
    assertDinerRenderSuppression(state, false, "completed free roam");
    captures.complete = await capture(client, "07-night-count-complete.png");

    const completedSave = await client.request("save");
    await client.request("restore", { snapshot: completedSave });
    await wait(900);
    state = await client.request("snapshot");
    assert.deepEqual(state.nightRoute.moralLedger, SIGNED_LEDGER);
    assert.equal(state.diagnostics.nightRoute.completionEventsHandled, 1,
      "loading a completed branch replayed the durable completion event");
    assert.equal(stagedParticipants(state).length, 0);
    maximumFrameMs = Math.max(maximumFrameMs, assertNoStall(state, "completed save restore"));
    assert.ok(state.diagnostics.frameTiming.samples >= 20, state.diagnostics.frameTiming);

    console.log(JSON.stringify({
      backend: state.diagnostics.backend,
      persistentVersion: completedSave.version,
      selector: "nightRoute",
      storyKind: state.nightRoute.kind,
      unlockProgress: availability.progress,
      stableCounts: { population: populationCount, vehicles: vehicleCount },
      participantActorIds: stableParticipantIds,
      rosaActorId: state.diagnostics.nightRoute.rosaActorId,
      branch: state.nightRoute.choiceResult,
      moralLedger: state.nightRoute.moralLedger,
      completionEventsHandled: state.diagnostics.nightRoute.completionEventsHandled,
      maximumFrameMs,
      presentation: state.diagnostics.presentation,
      captures,
    }, null, 2));
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "KeyS", down: false }).catch(() => {});
    await client.request("clearWanted").catch(() => {});
    if (originalSave) await client.request("restore", { snapshot: originalSave }).catch(() => {});
    client.close();
  }
}

await main();
