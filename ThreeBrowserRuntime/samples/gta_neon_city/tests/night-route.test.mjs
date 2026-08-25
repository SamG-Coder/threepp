import test from "node:test";
import assert from "node:assert/strict";
import { LIFE_ACTIVITY_DEFINITIONS } from "../src/game/life-activities.mjs";
import { DEFAULT_NEIGHBOURHOOD_BUSINESSES } from "../src/game/neighbourhood-routine.mjs";
import {
  NIGHT_ROUTE_AFTERMATH,
  NIGHT_ROUTE_ANCHORS,
  NIGHT_ROUTE_CHARACTERS,
  NIGHT_ROUTE_CHOICE,
  NIGHT_ROUTE_PHASES,
  NIGHT_ROUTE_REQUIREMENTS,
  NIGHT_ROUTE_SEQUENCES,
  NIGHT_ROUTE_STORY,
  createNightRouteStory,
} from "../src/game/night-route.mjs";

const FULL_PROGRESS = Object.freeze({
  lifeActivitiesCompleted: NIGHT_ROUTE_REQUIREMENTS.lifeActivitiesCompleted,
  taxiFaresCompleted: NIGHT_ROUTE_REQUIREMENTS.taxiFaresCompleted,
  southlineFamiliarity: NIGHT_ROUTE_REQUIREMENTS.southlineFamiliarity,
});

function settleDialogue(story) {
  let guard = 0;
  while (story.snapshot().dialogue.active && guard++ < 128) {
    story.update(0, { skip: true, captureSnapshot: false });
  }
  assert.ok(guard < 128, "Night Route dialogue did not settle");
  return story.snapshot();
}

function reachDecision(story) {
  assert.equal(story.begin(FULL_PROGRESS).accepted, true);
  settleDialogue(story);
  for (const stop of story.surveyStops) {
    assert.equal(story.snapshot().phase, NIGHT_ROUTE_PHASES.SURVEY);
    assert.deepEqual(story.snapshot().targetPosition, stop.position);
    const result = story.interact({
      position: stop.position,
      inVehicle: true,
      vehicleAccess: "pulse-line",
      speed: 0,
    });
    assert.equal(result.accepted, true, stop.id);
    settleDialogue(story);
  }
  const state = story.snapshot();
  assert.equal(state.phase, NIGHT_ROUTE_PHASES.DECISION);
  assert.strictEqual(state.choice, NIGHT_ROUTE_CHOICE);
  return state;
}

function completeBranch(story, choiceId) {
  reachDecision(story);
  assert.equal(story.choose(choiceId).accepted, true);
  settleDialogue(story);
  const branch = story.aftermath[choiceId];
  for (const task of branch.tasks) {
    assert.equal(story.snapshot().phase, NIGHT_ROUTE_PHASES.AFTERMATH);
    assert.deepEqual(story.snapshot().targetPosition, task.position);
    assert.equal(story.interact({ position: task.position, inVehicle: false }).accepted, true, task.id);
    settleDialogue(story);
  }
  assert.equal(story.snapshot().completed, true);
  return story.snapshot();
}

test("The Night Count grows from existing ordinary-life anchors and named relationships", () => {
  const pulseLine = LIFE_ACTIVITY_DEFINITIONS.find(activity => activity.id === "pulse_line");
  const hands = LIFE_ACTIVITY_DEFINITIONS.find(activity => activity.id === "neighbourhood_hands");
  const diner = DEFAULT_NEIGHBOURHOOD_BUSINESSES.find(business => business.id === "southline_diner");
  assert.strictEqual(NIGHT_ROUTE_ANCHORS.southlineDiner, diner.position);
  assert.strictEqual(NIGHT_ROUTE_ANCHORS.pulseStation, pulseLine.stops[0].position);
  assert.strictEqual(NIGHT_ROUTE_ANCHORS.civicPlaza, pulseLine.stops[1].position);
  assert.strictEqual(NIGHT_ROUTE_ANCHORS.westsideClinic, pulseLine.stops[3].position);
  assert.strictEqual(NIGHT_ROUTE_ANCHORS.communityNoticeboard, hands.hub);

  assert.equal(NIGHT_ROUTE_STORY.kind, "ordinary_story");
  assert.equal(NIGHT_ROUTE_STORY.primaryPath, "peaceful");
  assert.match(NIGHT_ROUTE_STORY.title, /NIGHT COUNT/);
  assert.deepEqual(Object.values(NIGHT_ROUTE_CHARACTERS).map(character => character.name), [
    "KAI",
    "ROSA ALVAREZ",
    "MALIK REED",
    "EVELYN CHO",
    "DESMOND VALE",
    "NADIYA KHOURY",
  ]);
  assert.ok(Object.values(NIGHT_ROUTE_CHARACTERS).every(character => character.role.length > 12));
  assert.ok(Object.isFrozen(NIGHT_ROUTE_CHARACTERS));
  assert.ok(Object.isFrozen(NIGHT_ROUTE_SEQUENCES));
  assert.ok(Object.values(NIGHT_ROUTE_SEQUENCES).every(value =>
    Object.isFrozen(value) && Object.isFrozen(value.lines) && value.lines.every(line => Object.isFrozen(line))));
  assert.match(NIGHT_ROUTE_SEQUENCES.briefing.lines[0].text, /not because dinner put you in my debt/i);
  assert.match(NIGHT_ROUTE_SEQUENCES.clinic_count.lines[0].text, /Do not write that as free consent/i);
  assert.match(NIGHT_ROUTE_SEQUENCES.anonymous_diner.lines[1].text, /does not become free because it is voluntary/i);
  assert.match(NIGHT_ROUTE_SEQUENCES.signed_epilogue.lines[1].text, /safer than my record/i);

  assert.equal(NIGHT_ROUTE_CHOICE.options.length, 2);
  assert.deepEqual(NIGHT_ROUTE_CHOICE.options.map(option => option.id), ["anonymous_trial", "signed_year"]);
  for (const option of NIGHT_ROUTE_CHOICE.options) {
    assert.equal("correct" in option, false);
    assert.equal("reward" in option, false);
    assert.ok(option.unresolvedCost.length > 80);
  }
  assert.deepEqual(NIGHT_ROUTE_CHOICE.options[0].ledger, {
    serviceDaysSecured: 60,
    fullTimetableMonths: 0,
    publicRiderRecords: 0,
    lateRunsCut: 2,
    weeklyCountingHours: 8,
  });
  assert.deepEqual(NIGHT_ROUTE_CHOICE.options[1].ledger, {
    serviceDaysSecured: 365,
    fullTimetableMonths: 12,
    publicRiderRecords: 5,
    lateRunsCut: 0,
    weeklyCountingHours: 0,
  });
});

test("ordinary work, one night fare, and Southline familiarity unlock the story without a campaign gate", () => {
  const story = createNightRouteStory();
  const lockedSave = story.save();
  const first = story.availability({});
  assert.deepEqual(first.missing, [
    "complete_two_city_activities",
    "complete_one_night_fare",
    "become_a_southline_regular",
  ]);
  assert.equal(first.unlocked, false);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.missing));
  assert.equal(story.begin({}).reason, "ordinary_progress_required");
  assert.deepEqual(story.save(), lockedSave, "a failed unlock must not mutate story or pending events");

  assert.deepEqual(story.availability({
    life: { completedCount: 2 },
    taxi: { completedCount: 1 },
    neighbourhood: { businessId: "southline_diner", familiarity: 2 },
  }).missing, []);
  assert.equal(story.availability({
    life: { completedCount: 2 },
    taxi: { completedCount: 1 },
    neighbourhoodSave: { familiarity: [0, 0, 0, 2] },
  }).unlocked, true, "the integration may pass the existing neighbourhood save without inventing another counter");
  assert.equal(story.availability(FULL_PROGRESS).unlocked, true);
  assert.equal(story.begin(FULL_PROGRESS).accepted, true);
  let state = story.snapshot();
  assert.equal(state.phase, NIGHT_ROUTE_PHASES.BRIEFING);
  assert.equal(state.controlsLocked, true);
  assert.deepEqual(Object.keys(state.dialogue), ["active", "serial", "speaker", "role", "text", "remaining"]);
  assert.equal(state.dialogue.active, true);
  assert.equal(state.dialogue.speaker, "ROSA ALVAREZ");
  assert.equal(state.dialogue.role, NIGHT_ROUTE_CHARACTERS.rosa.role);
  assert.ok(state.dialogue.remaining > 0);
  assert.equal(state.dialogue.serial, state.dialogueSerial);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.dialogue));

  const firstSerial = state.dialogue.serial;
  const firstText = state.dialogue.text;
  story.update(100, { captureSnapshot: false });
  state = story.snapshot();
  assert.equal(state.dialogue.serial, firstSerial, "one recovered hitch must not skip authored lines");
  assert.equal(state.dialogue.text, firstText);
  assert.ok(state.dialogue.remaining > 6.9, "the recovered hitch is capped to one quarter second");
  settleDialogue(story);
  assert.equal(story.snapshot().phase, NIGHT_ROUTE_PHASES.SURVEY);
});

test("the survey is a legitimate stopped Pulse Line run and its conversations stay non-blocking", () => {
  const story = createNightRouteStory();
  assert.equal(story.begin(FULL_PROGRESS).accepted, true);
  settleDialogue(story);
  const stop = story.surveyStops[0];
  const initial = story.snapshot();

  assert.equal(story.interact({ position: stop.position, inVehicle: false }).reason, "pulse_line_vehicle_required");
  assert.equal(story.interact({ position: stop.position, inVehicle: true, vehicleAccess: "taxi", speed: 0 }).reason,
    "pulse_line_vehicle_required");
  assert.equal(story.interact({ position: stop.position, inVehicle: true, vehicleAccess: "pulse-line", speed: 2 }).reason,
    "vehicle_must_stop");
  assert.equal(story.interact({ position: [500, 0, 500], inVehicle: true, vehicleAccess: "pulse-line", speed: 0 }).reason,
    "too_far");
  assert.equal(story.snapshot().surveyIndex, initial.surveyIndex);
  assert.equal(story.snapshot().eventSerial, initial.eventSerial);

  assert.equal(story.interact({
    position: stop.position,
    inVehicle: true,
    vehicle: { activityAccess: "pulse-line" },
    vehicleSpeed: 0,
  }).accepted, true);
  let state = story.snapshot();
  assert.equal(state.surveyIndex, 1);
  assert.equal(state.dialogue.active, true);
  assert.equal(state.dialogue.speaker, "MALIK REED");
  assert.equal(state.controlsLocked, false,
    "route conversations should use the reusable card while leaving driving controls available");
  settleDialogue(story);

  for (const next of story.surveyStops.slice(1)) {
    assert.equal(story.interact({ position: next.position, inVehicle: true, vehicleAccess: "pulse-line", speed: 0 }).accepted, true);
    settleDialogue(story);
  }
  state = story.snapshot();
  assert.equal(state.phase, NIGHT_ROUTE_PHASES.DECISION);
  assert.equal(state.controlsLocked, true, "the explicit evidence choice owns controls");
  assert.strictEqual(state.choice, NIGHT_ROUTE_CHOICE);
  assert.equal(state.objective, NIGHT_ROUTE_CHOICE.prompt);
  assert.equal(state.surveyIndex, state.surveyCount);
  assert.deepEqual(state.surveyedStopIds, story.surveyStops.map(value => value.id));
});

test("anonymous counts preserve privacy but durably retain the temporary service and labour costs", () => {
  const story = createNightRouteStory();
  reachDecision(story);
  assert.equal(story.choose("anonymous_trial").accepted, true);
  let state = story.snapshot();
  assert.equal(state.choiceResult, "anonymous_trial");
  assert.deepEqual(state.moralLedger, NIGHT_ROUTE_CHOICE.options[0].ledger);
  assert.equal(state.consequence.durable, true);
  assert.equal(state.consequence.completed, false);
  assert.match(state.consequence.unresolvedCost, /two driver shifts disappear/i);
  settleDialogue(story);
  assert.equal(story.snapshot().phase, NIGHT_ROUTE_PHASES.AFTERMATH);

  for (const task of story.aftermath.anonymous_trial.tasks) {
    assert.equal(story.interact({ position: task.position, inVehicle: true }).reason, "continue_on_foot");
    assert.equal(story.interact({ position: [900, 0, 900], inVehicle: false }).reason, "too_far");
    assert.equal(story.interact({ position: task.position, inVehicle: false }).accepted, true);
    settleDialogue(story);
  }
  state = story.snapshot();
  assert.equal(state.phase, NIGHT_ROUTE_PHASES.COMPLETE);
  assert.equal(state.completed, true);
  assert.equal(state.consequence.completed, true);
  assert.deepEqual(state.moralLedger, {
    serviceDaysSecured: 60,
    fullTimetableMonths: 0,
    publicRiderRecords: 0,
    lateRunsCut: 2,
    weeklyCountingHours: 8,
  });
  assert.equal("payout" in state, false);
  assert.equal("reward" in state, false);
  const events = story.drainEvents();
  const completionEvents = events.filter(event => event.type === "ordinary_story_completed");
  assert.equal(completionEvents.length, 1);
  assert.equal(completionEvents[0].choiceId, "anonymous_trial");
  assert.deepEqual(completionEvents[0].moralLedger, state.moralLedger);
  assert.ok(Object.isFrozen(events));
  assert.strictEqual(story.drainEvents(), story.drainEvents(), "empty event drains reuse one immutable result");
  assert.equal(story.interact({ position: NIGHT_ROUTE_ANCHORS.southlineDiner }).reason, "story_complete");
  story.update(100, { skip: true });
  assert.equal(story.drainEvents().filter(event => event.type === "ordinary_story_completed").length, 0,
    "completion is durable and exactly once");
});

test("the signed case protects a full year while keeping five public rider records in the ledger", () => {
  const story = createNightRouteStory();
  const state = completeBranch(story, "signed_year");
  assert.equal(state.choiceResult, "signed_year");
  assert.deepEqual(state.moralLedger, {
    serviceDaysSecured: 365,
    fullTimetableMonths: 12,
    publicRiderRecords: 5,
    lateRunsCut: 0,
    weeklyCountingHours: 0,
  });
  assert.match(state.consequence.unresolvedCost, /make their working lives public/i);
  assert.match(NIGHT_ROUTE_SEQUENCES.signed_epilogue.lines[3].text, /do not call this clean/i);
  const events = story.drainEvents();
  assert.equal(events.filter(event => event.type === "choice_made").length, 1);
  assert.equal(events.filter(event => event.type === "ordinary_story_completed").length, 1);
  assert.equal(events.find(event => event.type === "ordinary_story_completed").choiceId, "signed_year");
  assert.equal(NIGHT_ROUTE_AFTERMATH.signed_year.tasks.length, NIGHT_ROUTE_AFTERMATH.anonymous_trial.tasks.length);
});

test("save and restore preserve an exact line, route, choice, consequence, and pending event queue", () => {
  const original = createNightRouteStory();
  assert.equal(original.begin(FULL_PROGRESS).accepted, true);
  original.update(1.75, { captureSnapshot: false });
  const midLineSave = original.save();
  const restored = createNightRouteStory();
  assert.deepEqual(restored.restore(midLineSave), original.snapshot());
  assert.deepEqual(restored.save(), midLineSave);
  assert.equal(restored.snapshot().dialogue.remaining, original.snapshot().dialogue.remaining);
  assert.equal(restored.snapshot().dialogue.serial, original.snapshot().dialogue.serial);
  assert.deepEqual(restored.drainEvents(), original.drainEvents(), "pending dialogue and story events restore exactly once");
  assert.deepEqual(restored.save(), original.save());

  settleDialogue(original);
  settleDialogue(restored);
  const firstTarget = original.snapshot().targetPosition;
  for (const story of [original, restored]) {
    assert.equal(story.interact({ position: firstTarget, inVehicle: true, vehicleAccess: "pulse-line", speed: 0 }).accepted, true);
    story.update(0.9, { captureSnapshot: false });
  }
  assert.deepEqual(restored.save(), original.save(), "deterministic continuation diverged after restore");

  const branch = createNightRouteStory();
  reachDecision(branch);
  branch.choose("signed_year");
  branch.update(0.6, { captureSnapshot: false });
  const branchSave = branch.save();
  const branchRestored = createNightRouteStory();
  assert.deepEqual(branchRestored.restore(branchSave), branch.snapshot());
  assert.throws(() => branchRestored.restore({ ...branchSave, version: 99 }), /Unsupported Night Route save version/);
  assert.throws(() => branchRestored.restore({
    ...branchSave,
    moralLedger: { ...branchSave.moralLedger, publicRiderRecords: 0 },
  }), /moral ledger does not match/i);
  assert.throws(() => branchRestored.restore({ ...branchSave, choiceResult: "imaginary_route" }), /Unknown Night Route choice/);

  const completed = createNightRouteStory();
  completeBranch(completed, "signed_year");
  completed.drainEvents();
  const completedSave = completed.save();
  const completedRestored = createNightRouteStory();
  completedRestored.restore(completedSave);
  completedRestored.update(10, { skip: true });
  assert.equal(completedRestored.drainEvents().filter(event => event.type === "ordinary_story_completed").length, 0);
  assert.deepEqual(completedRestored.snapshot().moralLedger, completed.snapshot().moralLedger);
});

test("RAM-only prewarm exercises both moral branches without touching live dialogue or events", () => {
  const story = createNightRouteStory();
  story.begin(FULL_PROGRESS);
  story.update(1.1, { captureSnapshot: false });
  const beforeSave = story.save();
  const beforeSnapshot = story.snapshot();
  const prepared = story.prewarm();
  assert.deepEqual(prepared, {
    ready: true,
    storage: "memory-only",
    sequencesPrepared: 16,
    linesPrepared: 44,
    branchesPrepared: 2,
    surveyStopsPrepared: 8,
    aftermathTasksPrepared: 6,
    completionsPrepared: 2,
    runtimeAssetsCreated: 0,
    liveStateUnchanged: true,
  });
  assert.ok(Object.isFrozen(prepared));
  assert.strictEqual(story.prewarm(), prepared);
  assert.deepEqual(story.save(), beforeSave);
  assert.strictEqual(story.snapshot(), beforeSnapshot,
    "prewarm should not even invalidate the live snapshot cache");
});
