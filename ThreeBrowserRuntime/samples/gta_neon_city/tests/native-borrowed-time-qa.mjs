import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3];
const branchOrderArgument = process.argv[4] ?? "report-first";
if (!pipePath || !outputDirectory) {
  throw new TypeError("Usage: node tests/native-borrowed-time-qa.mjs <pipe> <output-directory> [report-first|recall-first]");
}
if (!["report-first", "recall-first", "--report-first", "--recall-first"].includes(branchOrderArgument)) {
  throw new RangeError(`Unknown Borrowed Time branch order: ${branchOrderArgument}`);
}
const recallFirst = branchOrderArgument.includes("recall");
const branchOrder = Object.freeze(recallFirst
  ? ["recall_then_report", "report_now"]
  : ["report_now", "recall_then_report"]);

const GARAGE_CLUES = Object.freeze({
  failed_brake_hose: Object.freeze([-151.5, 79.6]),
  supplier_invoice: Object.freeze([-144, 79.6]),
  service_log: Object.freeze([-136.5, 79.6]),
});
const LEAH = Object.freeze([-44, -16.5]);
const DEPOT_MANIFEST = Object.freeze([-180.35, -136]);
const CHOICE_LEDGERS = Object.freeze({
  report_now: Object.freeze({
    knownDriversProtected: 11,
    unknownDriversAtRisk: 0,
    evidenceAtRisk: 0,
    peoplePubliclyExposed: 11,
    garageSuspensionDays: 30,
    vossLeadHours: 0,
  }),
  recall_then_report: Object.freeze({
    knownDriversProtected: 7,
    unknownDriversAtRisk: 4,
    evidenceAtRisk: 1,
    peoplePubliclyExposed: 7,
    garageSuspensionDays: 30,
    vossLeadHours: 6,
  }),
});

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = new Map();
    this.sequence = 0;
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.consume(chunk));
    socket.on("error", error => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
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
      else pending.reject(new Error(response.error || "native Borrowed Time request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native Borrowed Time request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

async function connect(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const socket = net.createConnection(pipePath);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("native Borrowed Time pipe did not become ready");
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function capture(client, filename) {
  const destination = path.resolve(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 35_000, `${filename} is unexpectedly small`);
  return result.path;
}

function assertSinglePresent(state, label) {
  assert.equal(state.diagnostics.presentation.path, "single-surface-offscreen-composite", `${label} changed the presentation path`);
  assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1, `${label} rendered the swap chain more than once`);
}

function assertNoCivilianInjury(state, label) {
  const injured = state.population
    .filter(actor => !actor.police && (!actor.alive || actor.health + 1e-6 < actor.maxHealth))
    .map(actor => ({ id: actor.id, health: actor.health, maxHealth: actor.maxHealth, alive: actor.alive }));
  assert.deepEqual(injured, [], `${label} injured a civilian during a nonviolent investigation`);
}

function assertNoCrimeOrReward(state, baseline, label) {
  assert.equal(state.player.cash, baseline.cash, `${label} incorrectly paid or charged Kai`);
  assert.equal(state.communityTrust, baseline.communityTrust, `${label} incorrectly granted community trust`);
  assert.equal(state.wanted.stars, 0, `${label} created wanted heat during a nonviolent investigation`);
  assertNoCivilianInjury(state, label);
  assertSinglePresent(state, label);
}

function verifyFirstUseTiming(label, timing, roundTripMs) {
  assert.ok(timing.samples >= 20, `${label} collected only ${timing.samples} real native frames`);
  assert.ok(timing.p95Ms < 50, `${label} p95 was ${timing.p95Ms.toFixed(1)}ms`);
  assert.ok(timing.stallFrames <= 1, `${label} contained ${timing.stallFrames} >50ms scheduling frames`);
  const compileClassStalls = timing.maximumMs >= 250 ? 1 : 0;
  assert.equal(compileClassStalls, 0,
    `${label} contained a ${timing.maximumMs.toFixed(1)}ms compile-class stall after startup prewarm`);
  assert.ok(roundTripMs < 250, `${label} public-control transition took ${roundTripMs.toFixed(1)}ms`);
  return Object.freeze({ label, roundTripMs, compileClassStalls, frameTiming: timing });
}

async function measureFirstUse(client, label, trigger, settleMs = 1_000) {
  await client.request("resetFrameTiming");
  const started = performance.now();
  const triggerResult = await trigger();
  const roundTripMs = performance.now() - started;
  await wait(settleMs);
  const deadline = Date.now() + 5_000;
  let state = await client.request("snapshot");
  // A screenshot readback or a briefly occluded native window can straddle
  // the reset and leave the first poll empty even though the animation loop
  // resumes immediately. Wait for a real-sized window; never replace it with
  // synthetic fixed-step timings.
  while (state.diagnostics.frameTiming.samples < 20 && Date.now() < deadline) {
    await wait(250);
    state = await client.request("snapshot");
  }
  const measurement = verifyFirstUseTiming(label, state.diagnostics.frameTiming, roundTripMs);
  assertSinglePresent(state, label);
  return { triggerResult, state, measurement };
}

async function physicalInteract(client) {
  await client.request("action", { action: "interact" });
  return (await client.request("advance", { steps: 1 })).state;
}

async function chooseThroughInput(client, digit) {
  // Injected actions persist until a fixed update consumes them. Raw injected
  // key edges can be cleared by a render-only animation frame between the pipe
  // request and the controlled fixed step, making them unsuitable for an
  // exact native choice fork.
  await client.request("action", { action: digit === "Digit1" ? "left" : "right" });
  return (await client.request("advance", { steps: 1 })).state;
}

async function ensureChapterOneDecision(client, preferredChoice = "publish") {
  let state = await client.request("snapshot");
  if (state.story.chapterCompleted && ["publish", "protect"].includes(state.story.choiceResult)) return state.story;
  await client.request("story", { action: "notify", event: "force_recovery" });
  let story = await client.request("story", { action: "notify", event: "vehicle_delivered" });
  assert.equal(story.sequenceId, "garage_return");
  story = await client.request("story", { action: "advance", skip: true });
  assert.equal(story.choice?.id, "audit_drive_release");
  story = await client.request("story", { action: "choose", option: preferredChoice });
  assert.equal(story.choiceResult, preferredChoice);
  story = await client.request("story", { action: "advance", skip: true });
  assert.equal(story.chapterCompleted, true);
  assert.equal(story.choiceResult, preferredChoice);
  return story;
}

async function positionAtClue(client, clueId) {
  const [x, z] = GARAGE_CLUES[clueId];
  await client.request("teleport", { x, z: z - 2.6 });
  await client.request("face", { x, z });
  await client.request("advance", { steps: 2 });
}

async function finishConsequence(client) {
  const completed = await client.request("chapterTwo", { action: "advance", skip: true });
  assert.equal(completed.phase, "complete");
  assert.equal(completed.chapterCompleted, true);
  return client.request("snapshot");
}

function assertExclusiveAftermath(state, expectedId, rejectedId) {
  const available = state.lifeActivities.map(activity => activity.id);
  assert.ok(available.includes(expectedId), `${expectedId} should be playable after this decision`);
  assert.ok(!available.includes(rejectedId), `${rejectedId} must remain mutually exclusive`);
  assert.equal(state.chapterTwo.aftermathHook.id, expectedId);
}

async function completeAftermathAndOpenEpilogue(client, activityId, baseline) {
  let state = await client.request("snapshot");
  const definition = state.lifeActivities.find(activity => activity.id === activityId);
  assert.ok(definition, `${activityId} must be available before its human epilogue`);
  let workVehicleId = null;
  if (definition.requiredVehicleKind) {
    const workVehicle = state.vehicles.find(vehicle =>
      vehicle.kind === definition.requiredVehicleKind && vehicle.authorized && vehicle.health > 0);
    assert.ok(workVehicle, `${activityId} requires a surviving authorized ${definition.requiredVehicleKind}`);
    workVehicleId = workVehicle.id;
    if (state.player.inVehicle && state.player.inVehicle !== workVehicleId) await client.request("exitVehicle");
    if (state.player.inVehicle !== workVehicleId) await client.request("enterVehicle", { vehicleId: workVehicleId });
  } else if (state.player.inVehicle) {
    await client.request("exitVehicle");
  }

  let activity = await client.request("startLife", { activityId });
  assert.equal(activity.status, "active");
  let epilogueFirstUse = null;
  for (let guard = 0; guard < 24 && activity.status === "active"; ++guard) {
    const [x, , z] = activity.targetPosition;
    if (activity.targetKind === "destination") {
      state = await client.request("snapshot");
      if (!state.player.inVehicle) await client.request("enterVehicle", { vehicleId: workVehicleId });
      await client.request("teleport", { x, z });
      await client.request("advance", { steps: 60 });
    } else {
      state = await client.request("snapshot");
      if (state.player.inVehicle) await client.request("exitVehicle");
      await client.request("teleport", { x, z });
      await client.request("face", { x: x + 0.01, z });
      if (activity.stopIndex === activity.stopCount - 1) {
        epilogueFirstUse = await measureFirstUse(
          client,
          `${activityId} human epilogue`,
          () => physicalInteract(client),
        );
      } else {
        await physicalInteract(client);
      }
    }
    state = await client.request("snapshot");
    activity = state.activity;
  }

  assert.equal(activity.status, "completed", `${activityId} did not complete its authored route`);
  assert.ok(epilogueFirstUse, `${activityId} completion never opened its epilogue`);
  state = epilogueFirstUse.state;
  const expectedSequence = activityId === "open_ledger" ? "open_ledger_epilogue" : "missing_four_epilogue";
  assert.equal(state.chapterTwo.sequenceId, expectedSequence);
  assert.equal(state.chapterTwo.active, true);
  assert.equal(state.chapterTwo.controlsLocked, true);
  assert.equal(state.chapterTwo.aftermathEpilogue.hookId, activityId);
  assert.equal(state.chapterTwo.aftermathEpilogue.started, true);
  assert.equal(state.chapterTwo.aftermathEpilogue.completed, false);
  assert.equal(state.communityTrust, baseline.communityTrust + 4,
    "the route may build community trust, but the epilogue itself must not add another reward");
  assert.ok(state.player.cash > baseline.cash, "completed consequence work should pay its authored route once");
  assert.equal(state.wanted.stars, 0);
  assertNoCivilianInjury(state, `${activityId} epilogue`);

  const captureName = activityId === "open_ledger"
    ? "08-open-ledger-people-behind-the-recall.png"
    : "09-missing-four-dispatch-records-epilogue.png";
  const screenshot = await capture(client, captureName);
  const rewardedCash = state.player.cash;
  const rewardedTrust = state.communityTrust;
  const completed = await client.request("chapterTwo", { action: "advance", skip: true });
  assert.equal(completed.active, false);
  assert.equal(completed.aftermathEpilogue.completed, true);
  state = await client.request("snapshot");
  assert.equal(state.player.cash, rewardedCash, "epilogue dialogue cannot pay the route twice");
  assert.equal(state.communityTrust, rewardedTrust, "epilogue dialogue cannot grant trust twice");
  return {
    sequenceId: expectedSequence,
    activityId,
    payout: activity.payout,
    trustReward: activity.trustReward,
    firstUse: epilogueFirstUse.measurement,
    capture: screenshot,
    completed: true,
  };
}

async function runChoiceBranch(client, {
  optionId,
  digit,
  expectedAftermath,
  rejectedAftermath,
  captureName,
  baseline,
}) {
  const firstUse = await measureFirstUse(client, optionId, () => chooseThroughInput(client, digit));
  let state = firstUse.state;
  assert.equal(state.chapterTwo.choiceResult, optionId);
  assert.equal(state.chapterTwo.sequenceId, optionId);
  assert.deepEqual(state.chapterTwo.moralLedger, CHOICE_LEDGERS[optionId]);
  assertNoCrimeOrReward(state, baseline, `${optionId} consequence dialogue`);
  const screenshot = await capture(client, captureName);

  state = await finishConsequence(client);
  assert.equal(state.chapterTwo.choiceResult, optionId);
  assert.deepEqual(state.chapterTwo.moralLedger, CHOICE_LEDGERS[optionId]);
  assertExclusiveAftermath(state, expectedAftermath, rejectedAftermath);
  assertNoCrimeOrReward(state, baseline, `${optionId} completed branch`);
  const epilogue = await completeAftermathAndOpenEpilogue(client, expectedAftermath, baseline);
  return {
    choiceResult: optionId,
    ledger: state.chapterTwo.moralLedger,
    aftermath: state.chapterTwo.aftermathHook,
    firstUse: firstUse.measurement,
    capture: screenshot,
    epilogue,
  };
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  const captures = {};
  const firstUse = [];
  let initialSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.capture.locked, true);
    assert.equal(state.capture.synthetic, true);
    assertSinglePresent(state, "startup");
    assertNoCivilianInjury(state, "startup");
    assert.equal(state.world.stats.chapterTwoDepot, true);
    assert.equal(state.world.stats.chapterTwoGarageClues, 3);
    assert.equal(state.world.stats.chapterTwoLeahAnchor, true);
    assert.equal(state.world.stats.chapterTwoEvidenceAnchors, 4);
    assert.equal(state.world.stats.chapterTwoConversationAnchors, 2);
    assert.equal(state.world.stats.chapterTwoEvidencePartInstances, 10);
    assert.equal(state.world.stats.chapterTwoPropInstances, 20);
    assert.equal(state.world.stats.authoredDepotTexture, true,
      "Southline's corrugated cladding must be decoded before startup pipeline warmup");
    initialSave = await client.request("save");

    const rendererWarmup = state.diagnostics.pipelineWarmup;
    const chapterWarmup = state.diagnostics.simulationWarmup.chapterTwoPrepared;
    const aftermathWarmup = state.diagnostics.simulationWarmup.aftermathPrepared;
    assert.equal(rendererWarmup.ready, true);
    assert.equal(rendererWarmup.storage, "memory-only");
    assert.equal(rendererWarmup.diskCache, false);
    assert.equal(rendererWarmup.queueSettledBeforePlay, true);
    assert.equal(rendererWarmup.passes.length, 2);
    assert.equal(chapterWarmup.ready, true);
    assert.equal(chapterWarmup.storage, "memory-only");
    assert.equal(chapterWarmup.rendererResources, 0);
    assert.equal(chapterWarmup.sequencesPrepared, 11);
    assert.equal(chapterWarmup.dialogueLinesPrepared, 47);
    assert.equal(chapterWarmup.aftermathEpiloguesPrepared, 2);
    assert.equal(chapterWarmup.clueStatesPrepared, 3);
    assert.equal(chapterWarmup.priorChoiceStatesPrepared, 2);
    assert.equal(chapterWarmup.branchStatesPrepared, 2);
    assert.equal(chapterWarmup.aftermathHooksPrepared, 2);
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("borrowed-time-investigation-and-both-costly-decisions"));
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("borrowed-time-both-aftermath-routes"));
    assert.equal(aftermathWarmup.ready, true);
    assert.equal(aftermathWarmup.storage, "memory-only");
    assert.equal(aftermathWarmup.rendererResources, 0);
    assert.equal(aftermathWarmup.diskResources, 0);
    assert.equal(aftermathWarmup.activitiesPrepared, 3);
    assert.equal(aftermathWarmup.completionsPrepared, 3);
    assert.equal(aftermathWarmup.stopsPrepared, 15);
    assert.equal(aftermathWarmup.accessRoutesPrepared, 1);
    assert.equal(aftermathWarmup.vehicleAccessRejectionsPrepared, 1);
    assert.equal(aftermathWarmup.incompatibleBranchesRejected, 2);
    assert.equal(aftermathWarmup.liveStatePreserved, true);

    if (state.player.inVehicle) await client.request("exitVehicle");
    if (state.activity?.status === "active") await client.request("cancelActivity");
    await client.request("closeBusiness");
    await client.request("clearWanted");
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 14 });
    const chapterOne = await ensureChapterOneDecision(client, "publish");
    assert.equal(chapterOne.chapterCompleted, true);
    assert.equal(chapterOne.choiceResult, "publish");

    state = await client.request("snapshot");
    assert.equal(state.chapterTwo.chapterStarted, false);
    assert.equal(state.chapterTwoMission.status, "available");
    await client.request("teleport", {
      x: state.chapterTwoMission.targetPosition[0],
      z: state.chapterTwoMission.targetPosition[2],
    });
    await client.request("advance", { steps: 2 });
    state = await client.request("snapshot");
    assert.match(state.prompt, /START CHAPTER TWO/i);

    const opening = await measureFirstUse(client, "opening", () => physicalInteract(client));
    firstUse.push(opening.measurement);
    state = opening.state;
    assert.equal(state.chapterTwo.chapterStarted, true);
    assert.equal(state.chapterTwo.phase, "opening");
    assert.equal(state.chapterTwo.sequenceId, "failure_after_publish");
    assert.equal(state.narrative.chapter.id, "borrowed_time");
    assert.equal(state.narrative.cinematic, true);
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.match(state.chapterTwo.line.text, /same standard|brake pedal|S-17/i);
    captures.opening = await capture(client, "01-borrowed-time-opening.png");

    // A persistent save in the middle of the real opening dialogue must come
    // back on the same character, line and elapsed fraction without replaying
    // the already-consumed chapter-start command.
    const midDialogueSave = await client.request("save");
    assert.equal(midDialogueSave.chapterTwo.activeSequenceId, "failure_after_publish");
    assert.ok(midDialogueSave.chapterTwo.lineElapsed > 0);
    await client.request("chapterTwo", { action: "advance", skip: true });
    assert.equal((await client.request("chapterTwo")).phase, "investigate_garage");
    const restoredDialogue = await client.request("restore", { snapshot: midDialogueSave });
    assert.deepEqual(restoredDialogue.chapterTwo, midDialogueSave.chapterTwo,
      "mid-dialogue Chapter Two state must restore bit-for-bit");
    state = await client.request("snapshot");
    assert.equal(state.chapterTwo.sequenceId, "failure_after_publish");
    assert.equal(state.chapterTwo.lineIndex, midDialogueSave.chapterTwo.lineIndex);
    assert.ok(state.chapterTwo.lineElapsed >= midDialogueSave.chapterTwo.lineElapsed,
      "the restored dialogue clock must continue from, never precede, the saved instant");
    await client.request("chapterTwo", { action: "advance", skip: true });

    // Service log first is deliberately not the objective's default order.
    const clueOrder = ["service_log", "failed_brake_hose", "supplier_invoice"];
    for (let index = 0; index < clueOrder.length; ++index) {
      const clueId = clueOrder[index];
      await positionAtClue(client, clueId);
      if (index === 0) {
        const evidence = await measureFirstUse(client, "garage evidence", () => physicalInteract(client));
        firstUse.push(evidence.measurement);
        state = evidence.state;
        captures.evidence = await capture(client, "02-service-log-first-physical-evidence.png");
      } else {
        state = await physicalInteract(client);
      }
      assert.equal(state.chapterTwo.sequenceId, clueId);
      assert.deepEqual(state.chapterTwo.inspectedClues, clueOrder.slice(0, index + 1));
      assert.equal(state.chapterTwo.clueProgress, `${index + 1}/3`);
      assert.equal(state.wanted.stars, 0);
      await client.request("chapterTwo", { action: "advance", skip: true });
    }
    state = await client.request("snapshot");
    assert.equal(state.chapterTwo.phase, "speak_to_leah");
    assert.deepEqual(state.chapterTwo.inspectedClues, clueOrder);

    // Leah stands four metres from the open Common Ground counter. The same E
    // press must choose the witness conversation before the nearby shop route.
    await client.request("setTime", { hours: 10 });
    await client.request("teleport", { x: LEAH[0], z: LEAH[1] });
    await client.request("face", { target: "leah_moreno" });
    await client.request("advance", { steps: 2 });
    state = await client.request("snapshot");
    assert.equal(state.neighbourhood.businesses.find(value => value.id === "common_ground_cafe")?.open, true);
    assert.equal(state.neighbourhood.menuOpen, false);
    assert.match(state.prompt, /SPEAK TO LEAH MORENO/i);
    const leah = await measureFirstUse(client, "Leah at Common Ground", () => physicalInteract(client));
    firstUse.push(leah.measurement);
    state = leah.state;
    assert.equal(state.chapterTwo.sequenceId, "leah_account");
    assert.equal(state.chapterTwo.affectedPersonSpoken, true);
    assert.equal(state.neighbourhood.menuOpen, false, "Leah must win interaction priority over Common Ground's shop menu");
    assert.equal(state.chapterTwo.line.speaker, "LEAH");
    assert.equal(state.diagnostics.cinematic.active, true);
    const leahActor = state.population.find(actor => actor.id === "leah_moreno");
    assert.ok(leahActor?.alive);
    assert.ok(Math.hypot(
      state.player.position[0] - leahActor.position[0],
      state.player.position[2] - leahActor.position[2],
    ) >= 1.8, "physical interaction must separate Kai from Leah before their two-shot");
    const stagedLeahSave = await client.request("save");
    assert.deepEqual(stagedLeahSave.player.position, state.player.position,
      "the safe conversation mark must be Kai's real persisted position, not a render-only offset");
    captures.leah = await capture(client, "03-leah-priority-over-common-ground.png");
    await client.request("chapterTwo", { action: "advance", skip: true });

    await client.request("teleport", { x: DEPOT_MANIFEST[0], z: DEPOT_MANIFEST[1] });
    await client.request("face", { target: "dara-ibarra" });
    await client.request("advance", { steps: 2 });
    state = await client.request("snapshot");
    assert.match(state.prompt, /SOUTHLINE'S MANIFEST/i);
    const depot = await measureFirstUse(client, "Southline manifest", () => physicalInteract(client));
    firstUse.push(depot.measurement);
    state = depot.state;
    assert.equal(state.chapterTwo.sequenceId, "depot_manifest");
    assert.equal(state.chapterTwo.manifestMethod, "photograph");
    const daraActor = state.population.find(actor => actor.id === "dara-ibarra");
    assert.ok(daraActor?.alive);
    assert.ok(Math.hypot(
      state.player.position[0] - daraActor.position[0],
      state.player.position[2] - daraActor.position[2],
    ) >= 3.5, "Dara, Kai and the desk manifest must remain visually distinct");
    captures.depot = await capture(client, "04-southline-manifest-physical-interaction.png");

    const choicePresentation = await measureFirstUse(client, "moral choice", () =>
      client.request("chapterTwo", { action: "advance", skip: true }));
    firstUse.push(choicePresentation.measurement);
    state = choicePresentation.state;
    assert.equal(state.chapterTwo.phase, "decision");
    assert.equal(state.chapterTwo.choice.id, "brake_hose_response");
    assert.equal(state.chapterTwo.active, true);
    assert.equal(state.chapterTwo.controlsLocked, true);
    assert.deepEqual(state.chapterTwo.choice.options.map(option => option.id), ["report_now", "recall_then_report"]);
    captures.choice = await capture(client, "05-borrowed-time-costly-choice.png");

    const preChoiceSave = await client.request("save");
    assert.equal(preChoiceSave.chapterTwo.activeChoiceId, "brake_hose_response");
    assert.equal(preChoiceSave.chapterTwo.choiceResult, null);
    const baseline = Object.freeze({
      cash: preChoiceSave.player.cash,
      communityTrust: preChoiceSave.communityTrust,
    });
    assertNoCrimeOrReward(state, baseline, "pre-choice state");

    const branchDefinitions = Object.freeze({
      report_now: Object.freeze({
        optionId: "report_now",
        digit: "Digit1",
        expectedAftermath: "open_ledger",
        rejectedAftermath: "the_missing_four",
        captureName: "06-report-now-public-recall-consequence.png",
        captureKey: "reportNow",
      }),
      recall_then_report: Object.freeze({
        optionId: "recall_then_report",
        digit: "Digit2",
        expectedAftermath: "the_missing_four",
        rejectedAftermath: "open_ledger",
        captureName: "07-recall-seven-then-report-consequence.png",
        captureKey: "recallThenReport",
      }),
    });
    const branchResults = {};
    for (let index = 0; index < branchOrder.length; ++index) {
      if (index > 0) {
        // Restore the exact persistent decision point, not a handcrafted
        // Chapter Two object, before taking the mutually exclusive fork.
        const restoredChoice = await client.request("restore", { snapshot: preChoiceSave });
        assert.deepEqual(restoredChoice.chapterTwo, preChoiceSave.chapterTwo,
          "pre-choice persistent state must restore exactly before the second fork");
        state = await client.request("snapshot");
        assert.equal(state.chapterTwo.choice.id, "brake_hose_response");
        assert.equal(state.chapterTwo.choiceResult, null);
        assert.equal(state.lifeActivities.some(activity => activity.id === "open_ledger"), false);
        assert.equal(state.lifeActivities.some(activity => activity.id === "the_missing_four"), false);
        // Persistent restore rebuilds vehicle/player bindings and follows a
        // GPU readback capture. Let caller-owned restore work retire before
        // reset; the modal choice cannot exercise the other branch meanwhile.
        await wait(500);
      }
      const definition = branchDefinitions[branchOrder[index]];
      const result = await runChoiceBranch(client, { ...definition, baseline });
      branchResults[definition.captureKey] = result;
      firstUse.push(result.firstUse);
      firstUse.push(result.epilogue.firstUse);
      captures[definition.captureKey] = result.capture;
      captures[`${definition.captureKey}Epilogue`] = result.epilogue.capture;
    }
    const reportNow = branchResults.reportNow;
    const recallThenReport = branchResults.recallThenReport;

    state = await client.request("snapshot");
    assert.equal(state.wanted.stars, 0, "the final human epilogue must remain nonviolent");
    assertNoCivilianInjury(state, "final human epilogue");
    assertSinglePresent(state, "final human epilogue");
    assert.equal(firstUse.reduce((sum, sample) => sum + sample.compileClassStalls, 0), 0);

    console.log(JSON.stringify({
      ready: state.ready,
      backend: state.diagnostics.backend,
      chapterOneChoice: chapterOne.choiceResult,
      branchOrder,
      physicalClueOrder: clueOrder,
      leahPriorityVerified: true,
      manifestMethod: preChoiceSave.chapterTwo.manifestMethod,
      midDialogueRestoreVerified: true,
      preChoiceForkRestoreVerified: true,
      noCashOrTrustReward: true,
      noWantedOrCivilianInjury: true,
      presentation: state.diagnostics.presentation,
      rendererWarmup,
      chapterWarmup,
      aftermathWarmup,
      firstUse,
      branches: { reportNow, recallThenReport },
      captures,
    }, null, 2));
  } finally {
    await client.request("key", { code: "Digit1", down: false }).catch(() => {});
    await client.request("key", { code: "Digit2", down: false }).catch(() => {});
    await client.request("closeBusiness").catch(() => {});
    await client.request("clearWanted").catch(() => {});
    if (initialSave) await client.request("restore", { snapshot: initialSave }).catch(() => {});
    client.close();
  }
}

await main();
