import assert from "node:assert/strict";
import test from "node:test";
import {
  ASHA_PATEL,
  CAFE_SHIFT_SAVE_VERSION,
  CAFE_SHIFT_STATIONS,
  COMMON_GROUND_CAFE,
  COMMON_GROUND_CAFE_HOURS,
  COMMON_GROUND_CAFE_STAFF,
  COMMON_GROUND_SHIFT_ROLE,
  createCafeShiftSystem,
  createCafeDailyBriefing,
  createCommonGroundCafeShift,
  migrateCafeShiftSave,
} from "../src/game/cafe-shift.mjs";

function assertDeepFrozenFinite(value, path = "value", seen = new Set()) {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozenFinite(child, `${path}.${key}`, seen);
}

const SHIFT_CLOCK = Object.freeze({ dayIndex: 2, minuteOfDay: 7 * 60 });

function completeShift(system, prefix = "complete", clock = SHIFT_CLOCK) {
  assert.equal(system.begin({ ...clock, sourceId: `${prefix}:begin` }).accepted, true);
  for (let index = 0; index < CAFE_SHIFT_STATIONS.length; ++index) {
    const station = CAFE_SHIFT_STATIONS[index];
    const started = system.performStation(station.id, {
      ...clock,
      insideCafe: true,
      safetyConfirmed: true,
      quality: 97,
      skillLevels: { [station.primarySkill]: 80 },
      sourceId: `${prefix}:${station.id}:${index}`,
    });
    assert.equal(started.accepted, true);
    system.update(started.durationSeconds + 0.01, clock);
    assert.equal(system.snapshot().lastStationResult.passed, true);
  }
  return system.snapshot().lastTransaction;
}

test("Common Ground definitions align with the physical cafe and remain recursively immutable", () => {
  assert.equal(createCommonGroundCafeShift, createCafeShiftSystem);
  assert.equal(COMMON_GROUND_CAFE.id, "common_ground_cafe");
  assert.equal(COMMON_GROUND_CAFE.buildingId, "common-ground-cafe-building");
  assert.equal(COMMON_GROUND_CAFE.name, "COMMON GROUND CAFE");
  assert.equal(COMMON_GROUND_CAFE.address, "16 Common Ground Lane");
  assert.equal(COMMON_GROUND_CAFE.districtId, "pulse-core");
  assert.equal(COMMON_GROUND_CAFE.keeperId, "asha_patel");
  assert.deepEqual(COMMON_GROUND_CAFE.prohibitedActivities, ["combat", "weapons", "crime"]);
  assert.equal(COMMON_GROUND_CAFE_HOURS.openMinute, 360);
  assert.equal(COMMON_GROUND_CAFE_HOURS.closeMinute, 1080);
  assert.match(COMMON_GROUND_CAFE_HOURS.label, /06:00-18:00/);
  assert.deepEqual(CAFE_SHIFT_STATIONS.map(value => value.id), [
    "cafe-handover", "cafe-till", "cafe-prep", "cafe-serve", "cafe-dishes", "cafe-stock",
  ]);
  assert.deepEqual(CAFE_SHIFT_STATIONS.map(value => value.actionId), [
    "clock_in", "take_order", "prepare_order", "serve_order", "wash_dishes", "restock",
  ]);
  assert.ok(CAFE_SHIFT_STATIONS.every(value => value.worldStationId === value.id));
  assert.ok(CAFE_SHIFT_STATIONS.every(value => value.safetyRequired && value.checks.length >= 3));
  assert.ok(CAFE_SHIFT_STATIONS.every(value => value.instruction && value.honestLine && value.passLine && value.reworkLine));
  for (const definition of [COMMON_GROUND_CAFE, COMMON_GROUND_CAFE_HOURS, CAFE_SHIFT_STATIONS,
    COMMON_GROUND_SHIFT_ROLE, ASHA_PATEL, COMMON_GROUND_CAFE_STAFF]) assertDeepFrozenFinite(definition);
});

test("Asha has opening setup, service, a real break, close-down, commute, home, and a deterministic day off", () => {
  assert.equal(ASHA_PATEL.name, "Asha Patel");
  assert.equal(ASHA_PATEL.worldAnchorId, "cafe-staff-manager");
  assert.deepEqual(ASHA_PATEL.workSchedule.map(value => value.activity), [
    "sleep", "home", "commute", "opening_setup", "service", "break", "service", "close_down", "commute", "home",
  ]);
  const cafe = createCafeShiftSystem();
  assert.equal(cafe.staffState("asha_patel", { dayIndex: 0, minuteOfDay: 5 * 60 + 40 }).activity, "opening_setup");
  assert.equal(cafe.staffState("asha_patel", { dayIndex: 0, minuteOfDay: 9 * 60 }).activity, "service");
  const breakState = cafe.staffState("asha_patel", { dayIndex: 0, minuteOfDay: 11 * 60 + 40 });
  assert.equal(breakState.activity, "break");
  assert.match(breakState.dialogue, /break/i);
  assert.equal(cafe.staffState("asha_patel", { dayIndex: 0, minuteOfDay: 18 * 60 + 10 }).activity, "close_down");
  const dayOff = cafe.staffState("asha_patel", { dayIndex: ASHA_PATEL.dayOff, minuteOfDay: 12 * 60 });
  assert.equal(dayOff.workingDay, false);
  assert.equal(dayOff.activity, "errands");
  assert.notEqual(dayOff.locationId, COMMON_GROUND_CAFE.id);
  assert.strictEqual(cafe.staffState("missing"), null);
  assertDeepFrozenFinite(breakState);
});

test("daily availability respects opening and realistic last clock-in times", () => {
  const cafe = createCafeShiftSystem();
  assert.equal(cafe.availability({ dayIndex: 3, minuteOfDay: 5 * 60 + 59 }).reason, "cafe_closed");
  assert.equal(cafe.availability({ dayIndex: 3, minuteOfDay: 6 * 60 }).canBegin, true);
  assert.equal(cafe.availability({ dayIndex: 3, minuteOfDay: 14 * 60 }).canBegin, true);
  const late = cafe.availability({ dayIndex: 3, minuteOfDay: 15 * 60 });
  assert.equal(late.businessOpen, true);
  assert.equal(late.reason, "outside_clock_in_hours");
  assert.equal(cafe.availability({ dayIndex: 3, minuteOfDay: 18 * 60 }).reason, "cafe_closed");
  const dayOff = cafe.availability({ dayIndex: ASHA_PATEL.dayOff, minuteOfDay: 9 * 60 });
  assert.equal(dayOff.businessOpen, true, "the public cafe can remain open while Asha is off");
  assert.equal(dayOff.supervisor.workingDay, false);
  assert.equal(dayOff.supervisedShiftOpen, false);
  assert.equal(dayOff.canBegin, false,
    "the paid training shift must not be advertised when its named supervisor is off");
  assert.equal(dayOff.reason, "supervisor_off_day");
  assert.equal(cafe.begin({
    dayIndex: ASHA_PATEL.dayOff, minuteOfDay: 9 * 60, sourceId: "day-off:begin",
  }).reason, "supervisor_off_day");
  const pausedCafe = createCafeShiftSystem();
  assert.equal(pausedCafe.begin({ dayIndex: 0, minuteOfDay: 9 * 60, sourceId: "day-off-pause:begin" }).accepted, true);
  assert.equal(pausedCafe.pause({ dayIndex: 0, minuteOfDay: 9 * 60, sourceId: "day-off-pause:pause" }).accepted, true);
  assert.equal(pausedCafe.resume({
    dayIndex: ASHA_PATEL.dayOff, minuteOfDay: 9 * 60, sourceId: "day-off-pause:resume",
  }).reason, "supervisor_off_day");
  assert.equal(pausedCafe.snapshot().activeShift.status, "paused");
  const context = cafe.context({ dayIndex: 0, minuteOfDay: 7 * 60 });
  assert.equal(context.cafe.id, COMMON_GROUND_CAFE.id);
  assert.equal(context.staff.find(value => value.id === "asha_patel").activity, "service");
  assertDeepFrozenFinite(context);
});

test("seeded daily handovers contain real tickets, allergen, accessibility, stock, and read-only pay-forward context", () => {
  const first = createCafeDailyBriefing(4, { seed: 740 });
  const second = createCafeDailyBriefing(4, { seed: 740 });
  const nextDay = createCafeDailyBriefing(5, { seed: 740 });
  assert.deepEqual(second, first);
  assert.notDeepEqual(nextDay, first);
  assert.equal(first.tickets.length, 3);
  assert.ok(first.tickets.every(value => value.customerName && value.itemId && value.modifier));
  assert.ok(first.allergenNotice && first.accessibilityRequest && first.stockAlert);
  assert.equal(first.purchaseLedgerOwner, "neighbourhood-routine");
  assert.equal(first.purchaseLedgerReadOnly, true);
  assertDeepFrozenFinite(first);
});

test("shift work is physically ordered and cannot run from outside the cafe", () => {
  const cafe = createCafeShiftSystem({ seed: 740 });
  assert.equal(cafe.begin({ ...SHIFT_CLOCK, sourceId: "physical:begin" }).accepted, true);
  assert.equal(cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, safetyConfirmed: true, sourceId: "physical:outside",
  }).reason, "inside_common_ground_cafe_required");
  const wrong = cafe.performStation("cafe-till", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: true, sourceId: "physical:wrong",
  });
  assert.equal(wrong.reason, "wrong_station");
  assert.equal(wrong.expectedStationId, "cafe-handover");
  const started = cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: true, quality: 95, sourceId: "physical:handover",
  });
  assert.equal(started.accepted, true);
  assert.deepEqual(started.checks, CAFE_SHIFT_STATIONS[0].checks);
  assert.equal(cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, sourceId: "physical:double",
  }).reason, "task_in_progress");
  const runtime = cafe.update(started.durationSeconds + 0.01, { ...SHIFT_CLOCK, captureSnapshot: false });
  assert.equal(runtime.lastEvent, "cafe_station_completed");
  assert.equal(runtime.taskActive, false);
  assert.ok(runtime.lastStationResultSerial > 0);
  assert.equal(cafe.snapshot().activeShift.nextStationId, "cafe-till");
});

test("missed safety and low-quality service consume time and require honest rework", () => {
  const cafe = createCafeShiftSystem({ seed: 740 });
  cafe.begin({ ...SHIFT_CLOCK, sourceId: "rework:begin" });
  let started = cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: false, quality: 100, skillLevel: 100,
    sourceId: "rework:unsafe",
  });
  cafe.update(started.durationSeconds, SHIFT_CLOCK);
  let result = cafe.snapshot().lastStationResult;
  assert.equal(result.outcome, "safety_rework");
  assert.equal(result.nextStationId, "cafe-handover");
  assert.deepEqual(result.effects, { gameMinutes: CAFE_SHIFT_STATIONS[0].gameMinutes, needs: CAFE_SHIFT_STATIONS[0].needEffects });

  started = cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: true, quality: 0, skillLevel: 0,
    sourceId: "rework:careless",
  });
  cafe.update(started.durationSeconds, SHIFT_CLOCK);
  result = cafe.snapshot().lastStationResult;
  assert.equal(result.outcome, "quality_rework");
  assert.equal(cafe.snapshot().activeShift.reworkCount, 2);
  assert.equal(cafe.snapshot().activeShift.totalGameMinutes, CAFE_SHIFT_STATIONS[0].gameMinutes * 2);
  assert.match(result.line, /read|handover|missing/i);
});

test("completion returns exactly one caller-owned modest wage, trust, needs, and existing life-skill awards", () => {
  const cafe = createCafeShiftSystem({ seed: 740 });
  const external = Object.freeze({ cash: 900, communityTrust: 7, energy: 80, hygiene: 80, appetite: 80 });
  const transaction = completeShift(cafe, "paid");
  assert.equal(transaction.kind, "lawful_cafe_shift_wage");
  assert.equal(transaction.callerOwned, true);
  assert.equal(transaction.activityId, "common_ground_shift");
  assert.ok(transaction.wage >= COMMON_GROUND_SHIFT_ROLE.baseWage - 6
    && transaction.wage <= COMMON_GROUND_SHIFT_ROLE.baseWage + 6);
  assert.equal(transaction.trustReward, 2);
  assert.deepEqual(transaction.externalLedgerEffects, { customerPurchases: 0, payForwardCredits: 0 });
  assert.deepEqual(transaction.skillEffects, [
    { skillId: "hospitality", experience: 34 }, { skillId: "community", experience: 10 },
  ]);
  assert.ok(transaction.gameMinutes >= CAFE_SHIFT_STATIONS.reduce((sum, value) => sum + value.gameMinutes, 0));
  assert.deepEqual(external, { cash: 900, communityTrust: 7, energy: 80, hygiene: 80, appetite: 80 });
  assert.equal(cafe.snapshot().serials.transaction, 1);
  assert.equal(cafe.snapshot().ledger.transactionSourceCount, 1);
  assert.equal(cafe.begin({ ...SHIFT_CLOCK, sourceId: "paid:again" }).reason, "already_completed_today");
  assert.equal(cafe.snapshot().serials.transaction, 1);
  assert.equal(cafe.begin({ dayIndex: SHIFT_CLOCK.dayIndex + 1, minuteOfDay: 7 * 60, sourceId: "paid:tomorrow" }).accepted, true);
});

test("pause and resume preserve a partly completed timed task without off-screen progress", () => {
  const cafe = createCafeShiftSystem({ seed: 740 });
  cafe.begin({ ...SHIFT_CLOCK, sourceId: "pause:begin" });
  const started = cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: true, quality: 91, skillLevel: 60, sourceId: "pause:task",
  });
  cafe.update(started.durationSeconds * 0.42, { ...SHIFT_CLOCK, captureSnapshot: false });
  const before = cafe.snapshot().activeShift.task;
  const paused = cafe.pause({ ...SHIFT_CLOCK, sourceId: "pause:pause" });
  assert.equal(paused.accepted, true);
  assert.equal(paused.taskPreserved, true);
  cafe.update(100, SHIFT_CLOCK);
  assert.deepEqual(cafe.snapshot().activeShift.task, before);
  const resumed = cafe.resume({ ...SHIFT_CLOCK, sourceId: "pause:resume" });
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.taskPreserved, true);
  assert.deepEqual(cafe.snapshot().activeShift.task, before);
  assert.equal(cafe.cancel, cafe.pause);
});

test("v1 mid-task save and restore are bit-exact and continue deterministically", () => {
  const source = createCafeShiftSystem({ seed: 119 });
  source.begin({ ...SHIFT_CLOCK, sourceId: "save:begin" });
  const started = source.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: true, quality: 83, skillLevel: 37, sourceId: "save:task",
  });
  source.update(started.durationSeconds * 0.37, { ...SHIFT_CLOCK, captureSnapshot: false });
  const saved = source.save();
  assert.equal(saved.version, CAFE_SHIFT_SAVE_VERSION);
  const restored = createCafeShiftSystem({ seed: 1 });
  restored.restore(structuredClone(saved));
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.snapshot(), source.snapshot());
  source.update(started.durationSeconds, SHIFT_CLOCK);
  restored.update(started.durationSeconds, SHIFT_CLOCK);
  assert.deepEqual(restored.save(), source.save());
  assert.deepEqual(restored.snapshot(), source.snapshot());
});

test("source IDs make commands idempotent without advancing serials on retries", () => {
  const cafe = createCafeShiftSystem();
  const started = cafe.begin({ ...SHIFT_CLOCK, sourceId: "ledger:begin" });
  assert.equal(started.accepted, true);
  const serials = cafe.snapshot().serials;
  assert.equal(cafe.pause({ ...SHIFT_CLOCK, sourceId: "ledger:begin" }).reason, "duplicate_source");
  assert.deepEqual(cafe.snapshot().serials, serials);
  const task = cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, safetyConfirmed: true, sourceId: "ledger:task",
  });
  assert.equal(task.accepted, true);
  const afterTask = cafe.snapshot().serials;
  assert.equal(cafe.performStation("cafe-handover", {
    ...SHIFT_CLOCK, insideCafe: true, sourceId: "ledger:task",
  }).reason, "duplicate_source");
  assert.deepEqual(cafe.snapshot().serials, afterTask);
  assert.equal(cafe.snapshot().ledger.sourceCount, 2);
});

test("legacy data migrates while hostile saves fail transactionally", () => {
  const legacy = {
    version: 0,
    seed: 740,
    dayIndex: 9,
    minuteOfDay: 500,
    completedDays: [2, 8],
    sourceLedger: ["legacy:clock-in"],
  };
  const migrated = migrateCafeShiftSave(legacy);
  assert.equal(migrated.version, CAFE_SHIFT_SAVE_VERSION);
  assert.deepEqual(migrated.completedDays, [2, 8]);
  assert.equal(migrated.serials.transaction, 2);
  assertDeepFrozenFinite(migrated);

  const cafe = createCafeShiftSystem();
  cafe.restore(structuredClone(legacy));
  assert.deepEqual(cafe.save(), structuredClone(migrated));
  const before = cafe.save();
  const hostile = [
    { ...before, version: 999 },
    { ...before, seed: Infinity },
    { ...before, clock: { dayIndex: -1, minuteOfDay: 9999 } },
    { ...before, completedDays: [2, 2] },
    { ...before, sourceLedger: ["same", "same"] },
    { ...before, serials: { ...before.serials, transaction: 99 } },
    { ...before, transactionSources: [] },
    { ...before, shift: { id: "bad", status: "active", taskIndex: 999 } },
  ];
  for (const value of hostile) {
    assert.throws(() => cafe.restore(value));
    assert.deepEqual(cafe.save(), before, "invalid restore must not partially mutate live cafe state");
  }
});

test("snapshots are cached and immutable while the allocation-free update view exposes completion serials", () => {
  const cafe = createCafeShiftSystem();
  const snapshot = cafe.snapshot();
  assertDeepFrozenFinite(snapshot);
  assert.strictEqual(cafe.snapshot(), snapshot);
  const first = cafe.update(0, { dayIndex: 3, minuteOfDay: 510, captureSnapshot: false });
  const second = cafe.update(0, { captureSnapshot: false });
  assert.strictEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    "dayIndex", "minuteOfDay", "status", "stationId", "taskProgress", "taskActive", "commandSerial",
    "transactionSerial", "lastStationResultSerial", "lastEvent", "stateRevision",
  ]);
  const changed = cafe.snapshot();
  assert.notStrictEqual(changed, snapshot);
  assert.strictEqual(cafe.snapshot(), changed);
});

test("RAM-only prewarm covers every task, branch, staff schedule, and line without changing live state", () => {
  const cafe = createCafeShiftSystem({ seed: 740 });
  cafe.begin({ ...SHIFT_CLOCK, sourceId: "prewarm:begin" });
  const before = cafe.save();
  const bits = JSON.stringify(before);
  const prepared = cafe.prewarm();
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.diskResources, 0);
  assert.equal(prepared.rendererResources, 0);
  assert.equal(prepared.stationsPrepared, CAFE_SHIFT_STATIONS.length);
  assert.equal(prepared.outcomesPrepared, CAFE_SHIFT_STATIONS.length * 3);
  assert.equal(prepared.dailyBriefingsPrepared, 7);
  assert.equal(prepared.staffSchedulesPrepared, ASHA_PATEL.workSchedule.length + ASHA_PATEL.dayOffSchedule.length);
  assert.ok(prepared.dialoguePrepared >= CAFE_SHIFT_STATIONS.length * 4);
  assert.equal(prepared.saveRestorePrepared, true);
  assert.equal(prepared.liveStatePreserved, true);
  assert.ok(prepared.checksum > 0);
  assert.strictEqual(cafe.prewarm(), prepared);
  assert.equal(JSON.stringify(cafe.save()), bits);
  assert.deepEqual(cafe.save(), before);
  assertDeepFrozenFinite(prepared);
});
