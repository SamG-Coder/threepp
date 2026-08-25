import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_ACTIVITY_SAVE_VERSION,
  LIFE_ACTIVITY_DEFINITIONS,
  LIFE_STAGES,
  createLifeActivitySystem,
} from "../src/game/life-activities.mjs";

function advanceTo(system, position, context = {}) {
  for (let index = 0; index < 10; ++index) system.update(0.1, { position, speed: 0, ...context });
  return system.snapshot();
}

function dwellAt(system, position, context = {}, steps = 10) {
  let state = system.snapshot();
  for (let index = 0; index < steps; ++index) {
    state = system.update(0.25, { position, speed: 0, ...context });
  }
  return state;
}

function assertDeepFrozenFinite(value, seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `snapshot number must be finite, received ${value}`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, "snapshot objects and nested values must be frozen");
  for (const nested of Object.values(value)) assertDeepFrozenFinite(nested, seen);
}

test("parcel work requires its legitimate van and pays after three real stops", () => {
  const life = createLifeActivitySystem();
  assert.equal(life.begin("pulse_parcels", { vehicleKind: "sedan" }).accepted, false);
  let state = life.begin("pulse_parcels", { vehicleKind: "van" });
  assert.equal(state.stage, LIFE_STAGES.ACTIVE);
  for (let stop = 0; stop < 3; ++stop) {
    state = life.snapshot();
    state = advanceTo(life, state.targetPosition, { vehicleKind: "van" });
  }
  assert.equal(state.stage, LIFE_STAGES.COMPLETE);
  assert.ok(state.payout >= 720);
  assert.equal(state.trustReward, 2);
});

test("photo walk and volunteering require an on-foot interaction at each authored place", () => {
  const life = createLifeActivitySystem();
  assert.equal(life.begin("city_lens", { inVehicle: true }).accepted, false);
  let state = life.begin("city_lens", { inVehicle: false });
  life.notify({ type: "interact", position: [0, 0, 0] });
  assert.equal(life.snapshot().stopIndex, 0);
  while (state.status === "active") {
    state = life.notify({ type: "interact", position: state.targetPosition });
  }
  assert.equal(state.status, "completed");
  assert.equal(state.stopCount, 3);
});

test("fitness has a clock, ordered checkpoints, and exact save restoration", () => {
  const life = createLifeActivitySystem();
  let state = life.begin("pulse_park_run", { inVehicle: false });
  state = advanceTo(life, state.targetPosition, { inVehicle: false });
  assert.equal(state.stopIndex, 1);
  const saved = life.save();
  const restored = createLifeActivitySystem();
  restored.restore(saved);
  assert.deepEqual(restored.save(), saved);
  restored.update(116, { position: [999, 0, 999], inVehicle: false });
  // update is clamped by design; advance deterministically past the time limit.
  for (let index = 0; index < 500; ++index) restored.update(0.25, { position: [999, 0, 999], inVehicle: false });
  assert.equal(restored.snapshot().stage, LIFE_STAGES.FAILED);
});

test("all peaceful activities are discoverable from their hubs", () => {
  const life = createLifeActivitySystem();
  const available = life.available();
  assert.equal(available.length, 6);
  for (const activity of available) {
    const nearby = life.nearby(activity.hubPosition, 0.1);
    assert.equal(nearby.id, activity.id);
    assert.ok(activity.description.length > 20);
  }
});

test("Pulse Line is an authored westbound Street 04 service with a dedicated lawful van", () => {
  const definition = LIFE_ACTIVITY_DEFINITIONS.find(activity => activity.id === "pulse_line");
  assert.ok(definition);
  assert.deepEqual(definition.hub, [48, 0.2, -16.5]);
  assert.equal(definition.requiredVehicleKind, "van");
  assert.equal(definition.requiredVehicleAccess, "pulse-line");
  assert.equal(definition.timeLimit, 150);
  assert.equal(definition.baseReward, 340);
  assert.equal(definition.trustReward, 2);
  assert.match(definition.description, /community shuttle/i);
  assert.match(definition.description, /time to board safely/i);
  assert.equal(definition.stops.length, 5);
  assert.ok(definition.stops.every(routeStop => routeStop.position[1] === 0.04 && routeStop.position[2] === -21.35),
    "every stop must remain on Street 04's legal westbound lane centre");
  for (let index = 1; index < definition.stops.length; ++index) {
    assert.ok(definition.stops[index].position[0] < definition.stops[index - 1].position[0],
      "the route must continue west without teleporting or doubling back");
  }
  assert.ok(definition.stops.at(-1).position[0] < -72, "the terminus must reach Westside");

  const listed = createLifeActivitySystem().available().find(activity => activity.id === "pulse_line");
  assert.equal(listed.requiredVehicleKind, "van");
  assert.equal(listed.requiredVehicleAccess, "pulse-line");
  assert.equal(Object.isFrozen(listed), true);
});

test("Pulse Line rejects the wrong vehicle kind and every van without pulse-line access", () => {
  const life = createLifeActivitySystem();
  const wrongKind = life.begin("pulse_line", {
    vehicleKind: "sedan",
    vehicleAccess: "pulse-line",
    inVehicle: true,
  });
  assert.deepEqual(wrongKind, {
    accepted: false,
    reason: "van_required",
    activity: "pulse_line",
    requiredVehicleKind: "van",
    requiredVehicleAccess: "pulse-line",
  });
  for (const vehicleAccess of [null, "pulse-parcels", "pulse-roadside"]) {
    const rejected = life.begin("pulse_line", { vehicleKind: "van", vehicleAccess, inVehicle: true });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, "vehicle_access_required");
    assert.equal(rejected.requiredVehicleAccess, "pulse-line");
  }

  const started = life.begin("pulse_line", {
    vehicleKind: "van",
    vehicleAccess: "pulse-line",
    inVehicle: true,
  });
  assert.equal(started.stage, LIFE_STAGES.ACTIVE);
  assert.equal(started.requiredVehicleAccess, "pulse-line");
});

test("Pulse Line rejects drive-throughs and bounds and resets its accessibility dwell", () => {
  const life = createLifeActivitySystem();
  const authorized = { vehicleKind: "van", vehicleAccess: "pulse-line", inVehicle: true };
  let state = life.begin("pulse_line", authorized);
  const target = state.targetPosition;

  for (let index = 0; index < 16; ++index) {
    state = life.update(0.25, { ...authorized, position: target, speed: 4.2 });
  }
  assert.equal(state.stopIndex, 0, "crossing the stop at road speed must never count as service");
  assert.equal(state.dwell, 0);

  state = life.update(99, { ...authorized, position: target, speed: 0 });
  assert.equal(state.dwell, 0.25, "a frame hitch must be clamped instead of completing the dwell");
  state = dwellAt(life, target, authorized, 3);
  assert.equal(state.dwell, 1);
  state = life.update(0.25, { ...authorized, position: [999, 0.2, 999], speed: 0 });
  assert.equal(state.dwell, 0, "leaving the stop radius must restart the finite dwell");

  state = dwellAt(life, target, authorized, 5);
  assert.equal(state.dwell, 1.25);
  state = life.update(0.25, {
    vehicleKind: "van",
    vehicleAccess: "pulse-parcels",
    inVehicle: true,
    position: target,
    speed: 0,
  });
  assert.equal(state.dwell, 0, "changing to an unauthorized parcel van must reset dwell progress");
  assert.equal(state.lastEvent, "return_to_authorized_vehicle");

  state = dwellAt(life, target, authorized, 9);
  assert.equal(state.stopIndex, 0);
  assert.equal(state.dwell, 2.25);
  state = dwellAt(life, target, authorized, 1);
  assert.equal(state.stopIndex, 1);
  assert.equal(state.dwell, 0);
});

test("Pulse Line completes in order, pays once, and enforces its finite shift clock", () => {
  const authorized = { vehicleKind: "van", vehicleAccess: "pulse-line", inVehicle: true };
  const life = createLifeActivitySystem();
  let state = life.begin("pulse_line", authorized);
  while (state.stage === LIFE_STAGES.ACTIVE) {
    state = dwellAt(life, state.targetPosition, authorized);
  }
  assert.equal(state.stage, LIFE_STAGES.COMPLETE);
  assert.equal(state.stopIndex, 5);
  assert.ok(state.payout >= 340 && state.payout <= 422, `expected modest one-shot pay, received ${state.payout}`);
  assert.equal(state.trustReward, 2);
  assert.equal(state.completedCount, 1);
  const paid = state.payout;
  life.update(100, { ...authorized, position: [-144, 0.2, -21.35], speed: 0 });
  life.notify({ type: "interact", position: [-144, 0.2, -21.35], inVehicle: false });
  state = life.snapshot();
  assert.equal(state.payout, paid);
  assert.equal(state.completedCount, 1, "a completed shift must never pay a second time");

  const expired = createLifeActivitySystem();
  state = expired.begin("pulse_line", authorized);
  for (let index = 0; index < 600; ++index) {
    state = expired.update(0.25, { ...authorized, position: [999, 0.2, 999], speed: 0 });
  }
  assert.equal(state.stage, LIFE_STAGES.ACTIVE, "the route remains valid through the stated 150 seconds");
  state = expired.update(0.25, { ...authorized, position: [999, 0.2, 999], speed: 0 });
  assert.equal(state.stage, LIFE_STAGES.FAILED);
  assert.equal(state.failureReason, "time_expired");
  assert.equal(state.payout, 0);
});

test("Pulse Line save, restore, cancellation, and snapshots preserve exact authorized progress", () => {
  const authorized = { vehicleKind: "van", vehicleAccess: "pulse-line", inVehicle: true };
  const life = createLifeActivitySystem();
  let state = life.begin("pulse_line", authorized);
  state = dwellAt(life, state.targetPosition, authorized, 4);
  assert.equal(state.dwell, 1);
  const saved = life.save();
  assert.equal(saved.version, LIFE_ACTIVITY_SAVE_VERSION);
  assert.equal(saved.requiredVehicleKind, "van");
  assert.equal(saved.requiredVehicleAccess, "pulse-line");

  const restored = createLifeActivitySystem();
  state = restored.restore(saved);
  assert.deepEqual(restored.save(), saved);
  assert.equal(state.stopIndex, 0);
  assert.equal(state.dwell, 1);
  assert.equal(state.dwellRemaining, 1.5);
  assert.equal(state.requiredVehicleAccess, "pulse-line");
  assertDeepFrozenFinite(state);

  const cancelled = restored.notify({ type: "cancel" });
  assert.equal(cancelled.stage, LIFE_STAGES.FAILED);
  assert.equal(cancelled.failureReason, "cancelled");
  assert.equal(cancelled.stopIndex, 0);
  assert.equal(cancelled.dwell, 1);
  assert.equal(cancelled.requiredVehicleKind, "van");
  assert.equal(cancelled.requiredVehicleAccess, "pulse-line");
  assert.equal(cancelled.payout, 0);
  assertDeepFrozenFinite(cancelled);

  const cancelledSave = restored.save();
  const cancelledRestore = createLifeActivitySystem();
  const cancelledAgain = cancelledRestore.restore(cancelledSave);
  assert.deepEqual(cancelledRestore.save(), cancelledSave);
  assert.deepEqual(cancelledAgain, cancelled);

  const hostileRestore = createLifeActivitySystem();
  const sanitized = hostileRestore.restore({
    ...saved,
    elapsed: Infinity,
    activeElapsed: Infinity,
    dwell: Infinity,
    payout: Infinity,
    completedCount: Infinity,
    failedCount: Infinity,
  });
  assertDeepFrozenFinite(sanitized);
});

test("roadside work alternates legitimate van travel with on-foot repairs", () => {
  const life = createLifeActivitySystem();
  assert.equal(life.begin("pulse_roadside", { vehicleKind: "sedan" }).accepted, false);
  let state = life.begin("pulse_roadside", { vehicleKind: "van", inVehicle: true });
  assert.equal(state.stopCount, 6);
  while (state.status === "active") {
    if (state.targetKind === "destination") {
      state = advanceTo(life, state.targetPosition, { vehicleKind: "van", inVehicle: true });
    } else {
      const refused = life.notify({ type: "interact", position: state.targetPosition, inVehicle: true });
      assert.equal(refused.lastEvent, "leave_vehicle");
      state = life.notify({ type: "interact", position: state.targetPosition, inVehicle: false });
    }
  }
  assert.equal(state.status, "completed");
  assert.ok(state.payout >= 960);
  assert.equal(state.trustReward, 3);
});

test("the chapter decision unlocks a different playable consequence, never both", () => {
  const life = createLifeActivitySystem();
  assert.equal(life.begin("safe_passage", { vehicleKind: "van" }).reason, "story_choice_required");
  const publish = life.available({ choiceResult: "publish" });
  assert.ok(publish.some(activity => activity.id === "safe_passage"));
  assert.ok(!publish.some(activity => activity.id === "paper_trail"));
  const protect = life.available({ choiceResult: "protect" });
  assert.ok(protect.some(activity => activity.id === "paper_trail"));
  assert.ok(!protect.some(activity => activity.id === "safe_passage"));
  assert.match(publish.find(activity => activity.id === "safe_passage").description, /exposed coerced sources/i);
  assert.match(protect.find(activity => activity.id === "paper_trail").description, /harm your delay allows/i);
});

test("Borrowed Time unlocks one costly aftermath without disturbing Chapter One consequences", () => {
  const life = createLifeActivitySystem();
  assert.equal(life.begin("open_ledger", { vehicleKind: "van" }).reason, "story_choice_required");
  assert.equal(life.begin("the_missing_four", { inVehicle: false }).reason, "story_choice_required");

  const immediate = life.available({
    choiceResult: "protect",
    chapterTwoChoice: "report_now",
    chapterTwoCompleted: true,
  });
  assert.ok(immediate.some(activity => activity.id === "paper_trail"),
    "Chapter One's protected-source consequence must remain independently unlocked");
  assert.ok(immediate.some(activity => activity.id === "open_ledger"));
  assert.ok(!immediate.some(activity => activity.id === "the_missing_four"));

  const recalled = life.available({
    choiceResult: "publish",
    chapterTwoChoice: "recall_then_report",
    chapterTwoCompleted: true,
  });
  assert.ok(recalled.some(activity => activity.id === "safe_passage"),
    "Chapter One's public-release consequence must remain independently unlocked");
  assert.ok(recalled.some(activity => activity.id === "the_missing_four"));
  assert.ok(!recalled.some(activity => activity.id === "open_ledger"));

  const openLedger = immediate.find(activity => activity.id === "open_ledger");
  assert.equal(openLedger.consequenceOf, "report_now");
  assert.deepEqual(openLedger.consequence, {
    chapterId: "borrowed_time",
    choiceId: "report_now",
    unresolvedCost: openLedger.consequence.unresolvedCost,
  });
  assert.match(openLedger.description, /publicly grounded eleven customers/i);
  assert.match(openLedger.consequence.unresolvedCost, /without warning/i);

  const missingFour = recalled.find(activity => activity.id === "the_missing_four");
  assert.equal(missingFour.consequenceOf, "recall_then_report");
  assert.equal(missingFour.consequence.chapterId, "borrowed_time");
  assert.match(missingFour.description, /four drivers unnamed/i);
  assert.match(missingFour.consequence.unresolvedCost, /six hours/i);
});

test("available life-activity views are frozen and cached by the two story choices", () => {
  const life = createLifeActivitySystem();
  const immediate = life.available({
    choiceResult: "publish",
    chapterTwoChoice: "report_now",
    chapterTwoCompleted: true,
  });
  const semanticallyUnchanged = life.available({
    chapterOneChoice: "publish",
    chapterTwo: { choiceResult: "report_now" },
    chapterTwoCompleted: false,
    unrelatedRuntimeValue: 99,
  });

  assert.strictEqual(semanticallyUnchanged, immediate,
    "new context objects with the same two choices must reuse one public array");
  assert.equal(Object.isFrozen(immediate), true);
  assert.ok(immediate.every(activity => Object.isFrozen(activity)));
  assert.ok(immediate.some(activity => activity.id === "safe_passage"));
  assert.ok(immediate.some(activity => activity.id === "open_ledger"));
  assert.ok(!immediate.some(activity => activity.id === "the_missing_four"));

  const delayed = life.available({
    choiceResult: "publish",
    chapterTwoChoice: "recall_then_report",
  });
  assert.notStrictEqual(delayed, immediate,
    "changing a branch choice must publish the corresponding activity set");
  assert.equal(Object.isFrozen(delayed), true);
  assert.ok(delayed.every(activity => Object.isFrozen(activity)));
  assert.ok(delayed.some(activity => activity.id === "safe_passage"));
  assert.ok(delayed.some(activity => activity.id === "the_missing_four"));
  assert.ok(!delayed.some(activity => activity.id === "open_ledger"));

  assert.strictEqual(life.available({ chapterOneChoice: "publish", chapterTwoChoice: "report_now" }), immediate,
    "returning to a prior story key must reuse its original frozen publication");
});

test("The Open Ledger alternates service-van travel with safe public-recall support", () => {
  const life = createLifeActivitySystem();
  const unlocked = { chapterTwoChoice: "report_now" };
  assert.equal(life.begin("open_ledger", { ...unlocked, vehicleKind: "sedan" }).accepted, false);
  let state = life.begin("open_ledger", { ...unlocked, vehicleKind: "van", inVehicle: true });
  assert.equal(state.stopCount, 6);
  assert.match(state.description, /closed Pulse for thirty days/i);
  while (state.status === "active") {
    if (state.targetKind === "destination") {
      state = advanceTo(life, state.targetPosition, { vehicleKind: "van", inVehicle: true });
    } else {
      const refused = life.notify({ type: "interact", position: state.targetPosition, inVehicle: true });
      assert.equal(refused.lastEvent, "leave_vehicle");
      state = life.notify({ type: "interact", position: state.targetPosition, inVehicle: false });
    }
  }
  assert.equal(state.status, "completed");
  assert.ok(state.payout >= 620);
  assert.equal(state.consequence.choiceId, "report_now");
});

test("The Missing Four traces removed evidence on foot and records the unresolved risk", () => {
  const life = createLifeActivitySystem();
  const unlocked = { chapterTwoChoice: "recall_then_report" };
  assert.equal(life.begin("the_missing_four", { ...unlocked, inVehicle: true }).reason, "on_foot_required");
  let state = life.begin("the_missing_four", { ...unlocked, inVehicle: false });
  assert.equal(state.stopCount, 4);
  while (state.status === "active") {
    state = life.notify({ type: "interact", position: state.targetPosition, inVehicle: false });
  }
  assert.equal(state.status, "completed");
  assert.match(state.description, /gave Voss time to move the manifest/i);
  assert.match(state.consequence.unresolvedCost, /four unknown drivers remained at risk/i);
});

test("Borrowed Time aftermath completion is a durable exactly-once handoff to Chapter Two", () => {
  for (const route of [
    {
      id: "open_ledger",
      choiceId: "report_now",
      context: { chapterTwoChoice: "report_now", vehicleKind: "van", inVehicle: true },
    },
    {
      id: "the_missing_four",
      choiceId: "recall_then_report",
      context: { chapterTwoChoice: "recall_then_report", inVehicle: false },
    },
  ]) {
    const life = createLifeActivitySystem();
    let state = life.begin(route.id, route.context);
    while (state.status === "active") {
      if (state.targetKind === "destination") state = advanceTo(life, state.targetPosition, route.context);
      else state = life.notify({ type: "interact", position: state.targetPosition, inVehicle: false });
    }
    assert.equal(state.status, "completed");
    assert.equal(state.eventSerial, 1);
    assert.equal(state.pendingEventCount, 1);

    const completedSave = life.save();
    assert.equal(completedSave.version, LIFE_ACTIVITY_SAVE_VERSION);
    assert.equal(completedSave.pendingEvents.length, 1);
    const restored = createLifeActivitySystem();
    assert.deepEqual(restored.restore(completedSave), state);
    assert.deepEqual(restored.save(), completedSave, "a pending story handoff must survive an exact save round trip");

    const events = restored.drainEvents();
    assert.deepEqual(events, [{
      type: "aftermath_completed",
      eventSerial: 1,
      chapterId: "borrowed_time",
      choiceId: route.choiceId,
      hookId: route.id,
      activityId: route.id,
    }]);
    assert.equal(Object.isFrozen(events[0]), true);
    assert.deepEqual(restored.drainEvents(), [], "the durable handoff can be consumed only once");

    restored.update(30, { ...route.context, position: state.targetPosition, speed: 0 });
    restored.notify({ type: "interact", position: state.targetPosition, inVehicle: false });
    assert.equal(restored.snapshot().eventSerial, 1);
    assert.equal(restored.snapshot().pendingEventCount, 0);
    const consumedSave = restored.save();
    const consumedRestore = createLifeActivitySystem();
    consumedRestore.restore(consumedSave);
    assert.deepEqual(consumedRestore.drainEvents(), [], "restoring after consumption cannot replay the epilogue handoff");
  }

  const chapterOneRoute = createLifeActivitySystem();
  let chapterOneState = chapterOneRoute.begin("paper_trail", { choiceResult: "protect", inVehicle: false });
  while (chapterOneState.status === "active") {
    chapterOneState = chapterOneRoute.notify({
      type: "interact",
      position: chapterOneState.targetPosition,
      inVehicle: false,
    });
  }
  assert.deepEqual(chapterOneRoute.drainEvents(), [], "Chapter One aftermaths do not address Chapter Two's epilogue API");
});

test("RAM-only prewarm completes the lawful shuttle and both exclusive aftermath routes without touching live state", () => {
  const life = createLifeActivitySystem();
  let live = life.begin("open_ledger", {
    chapterTwoChoice: "report_now",
    vehicleKind: "van",
    inVehicle: true,
  });
  live = advanceTo(life, live.targetPosition, { vehicleKind: "van", inVehicle: true });
  assert.equal(live.stopIndex, 1);
  life.notify({
    type: "interact",
    position: [999, 0, 999],
    inVehicle: false,
  });
  assert.equal(life.snapshot().lastEvent, "interaction_too_far");

  const before = life.save();
  const beforeBits = JSON.stringify(before);
  const warmed = life.prewarm();

  assert.deepEqual(warmed, {
    ready: true,
    storage: "memory-only",
    rendererResources: 0,
    diskResources: 0,
    activitiesPrepared: 3,
    branchContextsPrepared: 2,
    routeKindsPrepared: 2,
    vehicleRoutesPrepared: 2,
    onFootRoutesPrepared: 1,
    beginsPrepared: 3,
    destinationStopsPrepared: 8,
    interactionStopsPrepared: 7,
    stopsPrepared: 15,
    updateStepsPrepared: 62,
    completionsPrepared: 3,
    incompatibleBranchesRejected: 2,
    accessRoutesPrepared: 1,
    vehicleAccessRejectionsPrepared: 1,
    liveStatePreserved: true,
    liveEventStatePreserved: true,
  });
  assert.equal(JSON.stringify(life.save()), beforeBits);
  assert.deepEqual(life.save(), before);
  assert.equal(life.snapshot().lastEvent, "interaction_too_far");
  assert.equal(life.snapshot().stopIndex, 1);
});

test("aftermath prewarm remains branch-exclusive from either live Chapter Two outcome", () => {
  for (const [choice, expected, excluded] of [
    ["report_now", "open_ledger", "the_missing_four"],
    ["recall_then_report", "the_missing_four", "open_ledger"],
  ]) {
    const life = createLifeActivitySystem();
    const before = JSON.stringify(life.save());
    const warmed = life.prewarm();
    const available = life.available({ chapterTwoChoice: choice });
    assert.ok(available.some(activity => activity.id === expected));
    assert.ok(!available.some(activity => activity.id === excluded));
    assert.equal(warmed.incompatibleBranchesRejected, 2);
    assert.equal(JSON.stringify(life.save()), before);
  }
});

test("aftermath hubs remain separated from every Open Doors business", () => {
  const businesses = [
    [-40, -16.5],
    [-148, 127.7],
    [148, 99],
    [-128, -111],
  ];
  const ids = ["paper_trail", "open_ledger", "the_missing_four"];
  const definitions = ids.map(id => LIFE_ACTIVITY_DEFINITIONS.find(activity => activity.id === id));
  assert.ok(definitions.every(Boolean));
  assert.deepEqual(definitions.find(activity => activity.id === "paper_trail").hub, [-176, 0.2, -152]);
  for (const definition of definitions) {
    for (const [x, z] of businesses) {
      assert.ok(Math.hypot(definition.hub[0] - x, definition.hub[2] - z) > 7,
        `${definition.id} hub must not be captured by an Open Doors interaction radius`);
    }
    const nearby = createLifeActivitySystem().nearby(definition.hub, 0.1, {
      choiceResult: definition.requiresChoice,
      chapterTwoChoice: definition.requiresChapterTwoChoice,
    });
    assert.equal(nearby.id, definition.id);
  }
});
