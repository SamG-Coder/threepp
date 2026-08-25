import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_SAVE_VERSION,
  RACE_STAGES,
  TAXI_ACTIVITY_SAVE_VERSION,
  TAXI_DIALOGUE_KINDS,
  TAXI_STAGES,
  createStreetRaceActivity,
  createTaxiActivity,
  createTaxiFareActivity,
} from "../src/game/activities.mjs";

const FARES = Object.freeze([
  Object.freeze({
    id: "fare-a",
    passenger: "Ari",
    pickup: Object.freeze([0, 0, 0]),
    dropoff: Object.freeze([30, 0, 0]),
    allowedSeconds: 12,
    baseReward: 200,
  }),
  Object.freeze({
    id: "fare-b",
    passenger: "Bo",
    pickup: Object.freeze([-10, 0, 5]),
    dropoff: Object.freeze([20, 0, -15]),
    allowedSeconds: 15,
    baseReward: 240,
  }),
]);

const COURSE = Object.freeze({
  id: "test-loop",
  title: "TEST LOOP",
  start: Object.freeze([0, 0, 0]),
  checkpoints: Object.freeze([
    Object.freeze([10, 0, 10]),
    Object.freeze([20, 0, 0]),
    Object.freeze([30, 0, 0]),
  ]),
  timeLimit: 12,
  baseReward: 1000,
});

function assertDeepFrozenFinite(value, path = "snapshot", seen = new Set()) {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDeepFrozenFinite(entry, `${path}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) assertDeepFrozenFinite(entry, `${path}.${key}`, seen);
  }
}

function advance(activity, seconds, context, step = 0.25) {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const delta = Math.min(step, remaining);
    activity.update(delta, context);
    remaining -= delta;
  }
  return activity.snapshot();
}

function boardPassenger(taxi, fare, vehicleId = "taxi-1") {
  taxi.update(0.1, { position: fare.pickup, speed: 0, vehicleId, isTaxi: true });
  assert.equal(taxi.snapshot().stage, TAXI_STAGES.BOARDING);
  return advance(taxi, 0.5, { position: fare.pickup, speed: 0, vehicleId, isTaxi: true });
}

function pointAlong(fare, progress) {
  return fare.pickup.map((value, index) => value + (fare.dropoff[index] - value) * progress);
}

function completeFare(taxi, state, vehicleId = "taxi-1") {
  return taxi.update(0.5, {
    position: state.fare.dropoff,
    speed: 0,
    vehicleId,
    isTaxi: true,
  });
}

function startRace(race, vehicleId = "coupe-1") {
  race.begin({ vehicleId });
  race.update(0, { position: COURSE.start, speed: 0, vehicleId });
  assert.equal(race.snapshot().stage, RACE_STAGES.COUNTDOWN);
  return advance(race, 1, { position: COURSE.start, speed: 0, vehicleId });
}

test("taxi fares select deterministically and snapshots are deeply frozen and finite", () => {
  assert.equal(createTaxiFareActivity, createTaxiActivity);
  const first = createTaxiActivity({ fares: FARES, seed: 77, boardingSeconds: 0.5 });
  const second = createTaxiActivity({ fares: FARES, seed: 77, boardingSeconds: 0.5 });
  const firstSequence = [];
  const secondSequence = [];
  for (let run = 0; run < 6; ++run) {
    firstSequence.push(first.begin({ vehicleId: "taxi-1" }).fareId);
    secondSequence.push(second.begin({ vehicleId: "taxi-1" }).fareId);
    assertDeepFrozenFinite(first.snapshot());
    first.reset();
    second.reset();
  }
  assert.deepEqual(firstSequence, secondSequence);
  for (let index = 1; index < firstSequence.length; ++index) {
    assert.notEqual(firstSequence[index], firstSequence[index - 1], "repeatable selector should avoid immediate duplicate fares");
  }
});

test("Night Shift Stories exposes three named, deeply frozen fare profiles without changing fare RNG", () => {
  const taxi = createTaxiActivity({ seed: 77 });
  assert.equal(taxi.snapshot().title, "NIGHT SHIFT STORIES");
  assert.deepEqual(taxi.fares.map(fare => [fare.id, fare.passenger, fare.role]), [
    ["night-shift-harbour", "Samira Cole", "Home-care assistant"],
    ["market-to-pulse", "Tomas Okafor", "Market kitchen runner"],
    ["westside-red-eye", "Inez Park", "Session guitarist"],
  ]);
  for (const fare of taxi.fares) {
    assert.ok(Object.isFrozen(fare));
    assert.ok(Object.isFrozen(fare.dialogue));
    assert.ok(Object.isFrozen(fare.dialogue.story));
    assert.ok(Object.isFrozen(fare.dialogue.story.chapterOne));
    assert.ok(Object.isFrozen(fare.dialogue.story.chapterTwo));
    for (const key of ["board", "cruise", "jolt", "safe", "rough"]) {
      assert.ok(fare.dialogue[key].length >= 20, `${fare.id}.${key} should be an authored line`);
    }
  }

  const sequence = [];
  for (let run = 0; run < 6; ++run) {
    sequence.push(taxi.begin().fareId);
    taxi.reset();
  }
  assert.deepEqual(sequence, [
    "night-shift-harbour",
    "market-to-pulse",
    "westside-red-eye",
    "market-to-pulse",
    "westside-red-eye",
    "market-to-pulse",
  ]);
});

test("taxi dialogue emits board, story-context and rate-limited jolt beats exactly once", () => {
  const taxi = createTaxiActivity({ boardingSeconds: 0.5, dropoffSeconds: 0.5 });
  let state = taxi.begin({
    fareId: "night-shift-harbour",
    vehicleId: "taxi-story",
    chapterOneChoice: "publish",
    chapterTwoChoice: "report_now",
  });
  state = boardPassenger(taxi, state.fare, "taxi-story");
  assert.equal(state.stage, TAXI_STAGES.DROPOFF);
  assert.equal(state.passenger, "Samira Cole");
  assert.equal(state.passengerRole, "Home-care assistant");
  assert.equal(state.passengerOnBoard, true);
  assert.equal(state.dialogueSerial, 1);
  assert.deepEqual(state.dialogue, {
    serial: 1,
    active: true,
    kind: TAXI_DIALOGUE_KINDS.BOARD,
    speaker: "Samira Cole",
    role: "Home-care assistant",
    text: state.fare.dialogue.board,
    context: null,
    remaining: 4.8,
  });

  state = taxi.update(0.25, {
    position: state.fare.pickup,
    speed: 0,
    vehicleId: "taxi-story",
    isTaxi: true,
  });
  assert.equal(state.dialogueSerial, 1, "ordinary updates at the kerb must not replay boarding");
  state = taxi.update(0.25, {
    position: pointAlong(state.fare, 0.31),
    speed: 9,
    vehicleId: "taxi-story",
    isTaxi: true,
  });
  assert.equal(state.routeProgress, 0.31);
  assert.equal(state.dialogueSerial, 2);
  assert.equal(state.dialogue.kind, TAXI_DIALOGUE_KINDS.STORY_CONTEXT);
  assert.equal(state.dialogue.context, "borrowed_time:report_now",
    "the newest chapter consequence should take precedence over the older branch");
  assert.match(state.dialogue.text, /safer parked.*lost two shifts/i);
  state = taxi.update(0.25, {
    position: pointAlong(state.fare, 0.45),
    speed: 9,
    vehicleId: "taxi-story",
    isTaxi: true,
  });
  assert.equal(state.dialogueSerial, 2, "crossing the cruise threshold again must not duplicate the line");

  const qualityBeforeImpact = state.quality;
  state = taxi.notify({ type: "collision", severity: 5 });
  assert.equal(state.dialogueSerial, 3);
  assert.equal(state.dialogue.kind, TAXI_DIALOGUE_KINDS.JOLT);
  assert.match(state.dialogue.text, /insulin pen/i);
  assert.equal(state.incidents, 1);
  assert.ok(Math.abs(state.quality - (qualityBeforeImpact - 0.115)) < 1e-12,
    "dialogue must not alter the existing collision quality formula");
  const afterSecondImpact = taxi.notify({ type: "collision", severity: 5 });
  assert.equal(afterSecondImpact.dialogueSerial, 3, "jolt speech should be rate-limited");
  assert.equal(afterSecondImpact.incidents, 2, "rate limiting speech must not suppress the gameplay penalty");
  assert.ok(afterSecondImpact.quality < state.quality);
});

test("taxi cruise dialogue falls back to ordinary life and selects each older story branch deterministically", () => {
  const cases = [
    { fareId: "market-to-pulse", context: { chapterOneChoice: "publish" }, pattern: /closed the stall/i },
    { fareId: "market-to-pulse", context: { chapterOneChoice: "protect" }, pattern: /notice is still on the wall/i },
    { fareId: "night-shift-harbour", context: { chapterTwoChoice: "recall_then_report" }, pattern: /Seven is not eleven/i },
    { fareId: "westside-red-eye", context: {}, pattern: /paid us in exposure/i, kind: TAXI_DIALOGUE_KINDS.CRUISE },
  ];
  for (const [index, entry] of cases.entries()) {
    const taxi = createTaxiActivity({ boardingSeconds: 0.5 });
    const vehicleId = `taxi-context-${index}`;
    let state = taxi.begin({ fareId: entry.fareId, vehicleId, ...entry.context });
    state = boardPassenger(taxi, state.fare, vehicleId);
    state = taxi.update(0.25, {
      position: pointAlong(state.fare, 0.31),
      speed: 8,
      vehicleId,
      isTaxi: true,
    });
    assert.equal(state.dialogue.kind, entry.kind ?? TAXI_DIALOGUE_KINDS.STORY_CONTEXT);
    assert.match(state.dialogue.text, entry.pattern);
  }
});

test("safe and rough taxi endings use the existing quality and payout math at the exact boundary", () => {
  function run(qualityLoss) {
    const taxi = createTaxiActivity({ boardingSeconds: 0.5, dropoffSeconds: 0.5 });
    const vehicleId = `taxi-ending-${qualityLoss}`;
    let state = taxi.begin({ fareId: "westside-red-eye", vehicleId });
    state = boardPassenger(taxi, state.fare, vehicleId);
    state = taxi.notify({ type: "reckless_driving", amount: qualityLoss });
    const quality = state.quality;
    state = completeFare(taxi, state, vehicleId);
    const remainingRatio = (state.fare.allowedSeconds - state.fareElapsed) / state.fare.allowedSeconds;
    const oldFormulaPayout = Math.round((state.fare.baseReward +
      Math.round(state.fare.baseReward * 0.35 * remainingRatio)) * quality);
    assert.equal(state.payout, oldFormulaPayout);
    assert.equal(state.passengerOnBoard, false);
    assert.equal(state.routeProgress, 1);
    return state;
  }

  const safe = run(0.28);
  assert.ok(Math.abs(safe.quality - 0.72) < 1e-12);
  assert.equal(safe.dialogue.kind, TAXI_DIALOGUE_KINDS.SAFE);
  assert.match(safe.dialogue.text, /Meter receipt/i);
  const rough = run(0.281);
  assert.ok(rough.quality < 0.72);
  assert.equal(rough.dialogue.kind, TAXI_DIALOGUE_KINDS.ROUGH);
  assert.match(rough.dialogue.text, /Pull over/i);
});

test("taxi pickup, boarding, quality penalties, drop-off and reward form a repeatable loop", () => {
  const taxi = createTaxiActivity({
    fares: FARES,
    seed: 4,
    boardingSeconds: 0.5,
    dropoffSeconds: 0.5,
    pickupTimeLimit: 20,
  });
  let state = taxi.begin({ fareId: "fare-a", vehicleId: "taxi-7" });
  assert.equal(state.stage, TAXI_STAGES.PICKUP);
  assert.deepEqual(state.targetPosition, FARES[0].pickup);

  state = boardPassenger(taxi, state.fare, "taxi-7");
  assert.equal(state.stage, TAXI_STAGES.DROPOFF);
  assert.equal(state.targetKind, "dropoff");
  assert.deepEqual(state.targetPosition, FARES[0].dropoff);

  taxi.update(1, { position: [12, 0, 0], speed: 12, vehicleId: "taxi-7", offRoad: true, wantedStars: 2 });
  taxi.notify({ type: "collision", severity: 5 });
  const penalized = taxi.snapshot();
  assert.ok(penalized.quality < 0.9, penalized);
  assert.equal(penalized.incidents, 1);
  assert.notEqual(penalized.qualityGrade, "S");

  taxi.update(0.25, { position: FARES[0].dropoff, speed: 0, vehicleId: "taxi-7" });
  state = taxi.update(0.25, { position: FARES[0].dropoff, speed: 0, vehicleId: "taxi-7" });
  assert.equal(state.stage, TAXI_STAGES.COMPLETE);
  assert.equal(state.completedCount, 1);
  assert.ok(state.payout > 0 && state.payout < 270, state);
  assert.equal(state.earnedTotal, state.payout);
  assert.equal(state.lastEvent, "fare_complete");
  assertDeepFrozenFinite(state);

  taxi.reset();
  state = taxi.begin({ fareId: "fare-b", vehicleId: "taxi-7" });
  assert.equal(state.stage, TAXI_STAGES.PICKUP);
  assert.equal(state.completedCount, 1, "reset preserves lifetime activity results");
});

test("taxi failure and save/restore preserve exact deterministic continuation", () => {
  const options = { fares: FARES, boardingSeconds: 0.5, dropoffSeconds: 0.5, pickupTimeLimit: 5 };
  const original = createTaxiActivity(options);
  const fare = original.begin({ fareId: "fare-b", vehicleId: "taxi-save" }).fare;
  boardPassenger(original, fare, "taxi-save");
  original.update(1.25, { position: [0, 0, 0], speed: 8, vehicleId: "taxi-save", wantedStars: 1 });

  const saved = JSON.parse(JSON.stringify(original.save()));
  const restored = createTaxiActivity(options);
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  const context = { position: [8, 0, -2], speed: 7, vehicleId: "taxi-save", offRoad: true };
  assert.deepEqual(restored.update(0.25, context), original.update(0.25, context));

  const failed = restored.notify({ type: "vehicle_destroyed" });
  assert.equal(failed.stage, TAXI_STAGES.FAILED);
  assert.equal(failed.failureReason, "vehicle_destroyed");
  assert.equal(failed.failedCount, 1);
  assert.equal(restored.reset().stage, TAXI_STAGES.IDLE);
  assert.throws(() => restored.restore({ version: TAXI_ACTIVITY_SAVE_VERSION + 1 }), /Unsupported taxi/);
});

test("taxi v2 saves restore dialogue exactly and v1 drop-off saves migrate without replaying boarding", () => {
  const options = { boardingSeconds: 0.5, dropoffSeconds: 0.5 };
  const original = createTaxiActivity(options);
  let state = original.begin({
    fareId: "market-to-pulse",
    vehicleId: "taxi-save-story",
    chapterOneChoice: "protect",
  });
  state = boardPassenger(original, state.fare, "taxi-save-story");
  state = original.update(0.25, {
    position: pointAlong(state.fare, 0.31),
    speed: 7,
    vehicleId: "taxi-save-story",
    isTaxi: true,
  });
  assert.equal(state.dialogue.kind, TAXI_DIALOGUE_KINDS.STORY_CONTEXT);
  original.update(1.125, {
    position: pointAlong(state.fare, 0.4),
    speed: 7,
    vehicleId: "taxi-save-story",
    isTaxi: true,
  });
  const saved = JSON.parse(JSON.stringify(original.save()));
  assert.equal(saved.version, TAXI_ACTIVITY_SAVE_VERSION);
  const restored = createTaxiActivity(options);
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), original.snapshot(), "active caption time and story context must restore bit-for-bit");
  const continuation = {
    position: pointAlong(state.fare, 0.55),
    speed: 8,
    vehicleId: "taxi-save-story",
    isTaxi: true,
  };
  assert.deepEqual(restored.update(0.375, continuation), original.update(0.375, continuation));
  assert.deepEqual(restored.notify({ type: "collision", severity: 2 }),
    original.notify({ type: "collision", severity: 2 }));

  const legacySource = createTaxiActivity(options);
  let legacyState = legacySource.begin({ fareId: "night-shift-harbour", vehicleId: "taxi-v1" });
  legacyState = boardPassenger(legacySource, legacyState.fare, "taxi-v1");
  const legacy = JSON.parse(JSON.stringify(legacySource.save()));
  legacy.version = ACTIVITY_SAVE_VERSION;
  legacy.fare = {
    id: "night-shift-harbour",
    passenger: "Harbour night worker",
    pickup: [-56, 0.2, -48],
    dropoff: [150, 0.2, 100],
    allowedSeconds: 82,
    baseReward: 420,
  };
  delete legacy.storyContext;
  delete legacy.dialogueSerial;
  delete legacy.dialogue;
  delete legacy.seenDialogueMask;
  delete legacy.joltLineCooldown;
  delete legacy.routeProgress;
  const migrated = createTaxiActivity(options);
  let migratedState = migrated.restore(legacy);
  assert.equal(migratedState.version, TAXI_ACTIVITY_SAVE_VERSION);
  assert.equal(migratedState.stage, TAXI_STAGES.DROPOFF);
  assert.equal(migratedState.passenger, "Samira Cole",
    "stable fare ids should upgrade anonymous v1 riders to the authored profile");
  assert.equal(migratedState.dialogueSerial, 0);
  assert.equal(migratedState.dialogue.active, false);
  migratedState = migrated.update(0.25, {
    position: migratedState.fare.pickup,
    speed: 0,
    vehicleId: "taxi-v1",
    isTaxi: true,
  });
  assert.equal(migratedState.dialogueSerial, 0, "migration must not replay the already-completed board beat");
  migratedState = migrated.update(0.25, {
    position: pointAlong(migratedState.fare, 0.31),
    speed: 7,
    vehicleId: "taxi-v1",
    isTaxi: true,
  });
  assert.equal(migratedState.dialogueSerial, 1);
  assert.equal(migratedState.dialogue.kind, TAXI_DIALOGUE_KINDS.CRUISE,
    "a legacy ride may still receive its new ordinary-life cruise beat once");
});

test("taxi dialogue serial stays monotonic across reset and repeatable fares", () => {
  const taxi = createTaxiActivity({ boardingSeconds: 0.5 });
  let state = taxi.begin({ fareId: "night-shift-harbour", vehicleId: "taxi-repeat" });
  state = boardPassenger(taxi, state.fare, "taxi-repeat");
  assert.equal(state.dialogueSerial, 1);
  state = taxi.reset();
  assert.equal(state.dialogueSerial, 1);
  assert.equal(state.dialogue.active, false);
  state = taxi.begin({ fareId: "market-to-pulse", vehicleId: "taxi-repeat" });
  state = boardPassenger(taxi, state.fare, "taxi-repeat");
  assert.equal(state.dialogueSerial, 2,
    "main integration can use one monotonic serial without special-casing fare resets");
  assert.equal(state.dialogue.speaker, "Tomas Okafor");
});

test("street race enforces staging and ordered checkpoints while detecting fast crossings", () => {
  const race = createStreetRaceActivity({
    course: COURSE,
    countdownSeconds: 1,
    checkpointRadius: 1.2,
    startRadius: 2,
  });
  race.begin({ vehicleId: "coupe-1" });
  race.update(0.2, { position: COURSE.checkpoints[2], speed: 0, vehicleId: "coupe-1" });
  assert.equal(race.snapshot().stage, RACE_STAGES.STAGING, "finish cannot be taken before the start grid");
  let state = startRace(race);
  assert.equal(state.stage, RACE_STAGES.RACING);
  assert.equal(state.checkpointIndex, 0);

  // Each fixed update jumps completely across a narrow marker. Segment-based
  // detection must still accept the ordered checkpoint.
  state = race.update(0.25, { position: [20, 0, 20], speed: 28, vehicleId: "coupe-1" });
  assert.equal(state.checkpointIndex, 1);
  state = race.update(0.25, { position: [20, 0, -6], speed: 28, vehicleId: "coupe-1" });
  assert.equal(state.checkpointIndex, 2);
  state = race.update(0.25, { position: [35, 0, 3], speed: 28, vehicleId: "coupe-1" });
  assert.equal(state.stage, RACE_STAGES.COMPLETE);
  assert.equal(state.progress, 1);
  assert.equal(state.completedCount, 1);
  assert.ok(state.payout > COURSE.baseReward, state);
  assert.equal(state.bestTime, state.raceTime);
  assertDeepFrozenFinite(state);

  race.reset();
  state = race.begin({ vehicleId: "coupe-1" });
  assert.equal(state.attempts, 2);
  assert.equal(state.completedCount, 1);
});

test("street race save/restore, timeout, vehicle failure and reset are exact", () => {
  const options = { course: COURSE, countdownSeconds: 0, checkpointRadius: 1.5, startRadius: 2 };
  const original = createStreetRaceActivity(options);
  original.begin({ vehicleId: "race-save" });
  original.update(0, { position: COURSE.start, speed: 0, vehicleId: "race-save" });
  original.update(0.5, { position: [20, 0, 20], speed: 25, vehicleId: "race-save" });
  assert.equal(original.snapshot().checkpointIndex, 1);

  const copy = createStreetRaceActivity(options);
  copy.restore(JSON.parse(JSON.stringify(original.save())));
  assert.deepEqual(copy.snapshot(), original.snapshot());
  const next = { position: [20, 0, -4], speed: 22, vehicleId: "race-save" };
  assert.deepEqual(copy.update(0.25, next), original.update(0.25, next));
  assert.equal(copy.notify({ type: "vehicle_destroyed" }).failureReason, "vehicle_destroyed");
  assert.equal(copy.reset().stage, RACE_STAGES.IDLE);

  const timeout = createStreetRaceActivity({
    course: { ...COURSE, id: "short", timeLimit: 5 },
    countdownSeconds: 0,
    checkpointRadius: 1,
  });
  timeout.begin("slow-car");
  timeout.update(0, { position: COURSE.start, speed: 0, vehicleId: "slow-car" });
  advance(timeout, 6, { position: COURSE.start, speed: 0, vehicleId: "slow-car" }, 1);
  assert.equal(timeout.snapshot().stage, RACE_STAGES.FAILED);
  assert.equal(timeout.snapshot().failureReason, "time_limit");
  assert.throws(() => copy.restore({ version: ACTIVITY_SAVE_VERSION + 1 }), /Unsupported street race/);
});
