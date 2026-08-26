import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMUNITY_HUB_ROLES,
  COMMUNITY_HUB_SAVE_VERSION,
  COMMUNITY_HUB_SKILLS,
  COMMUNITY_HUB_STAFF,
  COMMUNITY_HUB_STATIONS,
  HARBOUR_SKILLS_HOUSE,
  createCommunityHub,
  createCommunityHubSystem,
  migrateCommunityHubSave,
} from "../src/game/community-hub.mjs";

function assertDeepFrozenFinite(value, path = "value", seen = new Set()) {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, `${path} should be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} should be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozenFinite(child, `${path}.${key}`, seen);
}

function stationFor(id) {
  return COMMUNITY_HUB_STATIONS.find(value => value.id === id);
}

function openClock(role, dayOffset = 0) {
  let dayIndex = dayOffset;
  while (!role.postedHours.openDays.includes(dayIndex % 7)) dayIndex += 1;
  return { dayIndex, minuteOfDay: role.postedHours.openMinute + 5 };
}

function completeRole(system, roleId, { dayIndex, minuteOfDay, prefix = roleId, quality = 96 } = {}) {
  const role = COMMUNITY_HUB_ROLES.find(value => value.id === roleId);
  const clock = dayIndex == null ? openClock(role) : { dayIndex, minuteOfDay };
  const started = system.begin(roleId, { ...clock, sourceId: `${prefix}:begin` });
  assert.equal(started.accepted, true);
  for (let index = 0; index < role.stationIds.length; ++index) {
    const station = stationFor(role.stationIds[index]);
    const action = system.performStation(station.id, {
      ...clock,
      atHouse: true,
      safetyConfirmed: true,
      quality,
      skillLevels: { [station.primarySkill]: 80 },
      sourceId: `${prefix}:${station.id}:${index}`,
    });
    assert.equal(action.accepted, true);
    system.update(action.durationSeconds + 0.01, { ...clock });
    assert.equal(system.snapshot().lastStationResult.passed, true);
  }
  return system.snapshot().lastTransaction;
}

test("Harbour Skills House is a frozen lawful multi-room workplace with three distinct grounded roles", () => {
  assert.equal(createCommunityHub, createCommunityHubSystem);
  assert.equal(HARBOUR_SKILLS_HOUSE.id, "harbour-skills-house");
  assert.equal(HARBOUR_SKILLS_HOUSE.name, "Harbour Skills House");
  assert.equal(HARBOUR_SKILLS_HOUSE.label, "Harbour Skills House");
  assert.equal(HARBOUR_SKILLS_HOUSE.buildingId, "harbour-skills-house-building");
  assert.equal(HARBOUR_SKILLS_HOUSE.address, "42 Mariner Walk");
  assert.ok(HARBOUR_SKILLS_HOUSE.rooms.length >= 6);
  assert.deepEqual(HARBOUR_SKILLS_HOUSE.prohibitedActivities, ["combat", "weapons", "crime"]);
  assert.equal(COMMUNITY_HUB_ROLES.length, 3);
  assert.equal(COMMUNITY_HUB_STAFF.length, 3);
  assert.ok(COMMUNITY_HUB_STATIONS.length >= 12);
  assert.equal(new Set(COMMUNITY_HUB_ROLES.map(value => value.roomId)).size, 3);
  assert.equal(new Set(COMMUNITY_HUB_ROLES.map(value => value.baseWage)).size, 3);
  assert.ok(COMMUNITY_HUB_ROLES.every(value => value.lawful && value.baseWage >= 40 && value.baseWage <= 80));
  assert.ok(COMMUNITY_HUB_ROLES.every(value => value.postedHours.label && value.postedHours.openDays.length >= 5));
  assert.ok(COMMUNITY_HUB_ROLES.every(value => /not|never|actual|ordinary|permission|evidence|truth|guess/i
    .test(`${value.briefing} ${value.completionLine}`)));
  assert.ok(COMMUNITY_HUB_STATIONS.every(value => value.instruction && value.honestLine && value.passLine && value.reworkLine));
  assert.ok(COMMUNITY_HUB_STATIONS.every(value => value.worldStationId && value.needEffects
    && Object.values(value.needEffects).every(Number.isFinite)));
  assert.ok(COMMUNITY_HUB_STATIONS.every(value => VALID_SKILL_IDS.has(value.primarySkill)));
  assert.ok(COMMUNITY_HUB_STAFF.every(value => value.name && value.jobTitle && value.homeLocationId && value.schedule.length >= 5));
  assert.deepEqual(Object.values(COMMUNITY_HUB_SKILLS), ["mechanics", "photography", "community", "hospitality"]);
  for (const definition of [HARBOUR_SKILLS_HOUSE, COMMUNITY_HUB_ROLES, COMMUNITY_HUB_STAFF, COMMUNITY_HUB_STATIONS]) {
    assertDeepFrozenFinite(definition);
  }
});

const VALID_SKILL_IDS = new Set(["mechanics", "photography", "community", "hospitality"]);

test("availability obeys posted days and last-start times while staff follow authored schedules", () => {
  const system = createCommunityHubSystem();
  const kitchen = COMMUNITY_HUB_ROLES[0];
  const open = system.availability(kitchen.id, { dayIndex: 0, minuteOfDay: 9 * 60 });
  assert.equal(open.canBegin, true);
  assert.equal(open.staff[0].activity, "work");
  assert.equal(open.staff[0].locationId, HARBOUR_SKILLS_HOUSE.id);
  assert.equal(system.availability(kitchen.id, { dayIndex: 0, minuteOfDay: 7 * 60 }).reason, "outside_start_hours");
  assert.equal(system.availability(kitchen.id, { dayIndex: 0, minuteOfDay: 12 * 60 }).reason, "outside_start_hours");
  assert.equal(system.availability(kitchen.id, { dayIndex: 6, minuteOfDay: 9 * 60 }).reason, "closed_day");
  assert.equal(system.availability("missing", { dayIndex: 0, minuteOfDay: 9 * 60 }).reason, "unknown_role");

  const sunday = system.context({ dayIndex: 6, minuteOfDay: 11 * 60 });
  const asha = sunday.staff.find(value => value.id === "asha_malik");
  const tomas = sunday.staff.find(value => value.id === "tomas_varga");
  assert.notEqual(asha.activity, "work");
  assert.equal(tomas.activity, "work");
  assertDeepFrozenFinite(sunday);
});

test("physical stations are ordered and require presence in the Skills House", () => {
  const system = createCommunityHubSystem({ seed: 740 });
  const role = COMMUNITY_HUB_ROLES[0];
  const clock = openClock(role);
  assert.equal(system.begin(role.id, { ...clock, sourceId: "ordered:begin" }).accepted, true);
  assert.equal(system.performStation(role.stationIds[0], {
    ...clock, sourceId: "ordered:outside", safetyConfirmed: true,
  }).reason, "inside_harbour_skills_house_required");
  const wrong = system.performStation(role.stationIds[1], {
    ...clock, atHouse: true, sourceId: "ordered:wrong", safetyConfirmed: true,
  });
  assert.equal(wrong.reason, "wrong_station");
  assert.equal(wrong.expectedStationId, role.stationIds[0]);
  const started = system.performStation(role.stationIds[0], {
    ...clock, atHouse: true, sourceId: "ordered:first", safetyConfirmed: true, quality: 90,
  });
  assert.equal(started.accepted, true);
  assert.equal(system.performStation(role.stationIds[0], {
    ...clock, atHouse: true, sourceId: "ordered:double",
  }).reason, "task_in_progress");
  const runtime = system.update(started.durationSeconds + 0.01, { ...clock, captureSnapshot: false });
  assert.ok(runtime.lastStationResultSerial > 0);
  assert.equal(runtime.lastEvent, "community_station_completed");
  assert.equal(runtime.taskActive, false);
  assert.equal(system.snapshot().activeShift.nextStationId, role.stationIds[1]);
});

test("unsafe and careless work consumes honest time and returns to the same station for rework", () => {
  const system = createCommunityHubSystem({ seed: 740 });
  const role = COMMUNITY_HUB_ROLES[1];
  const clock = openClock(role);
  system.begin(role.id, { ...clock, sourceId: "rework:begin" });

  let station = stationFor(role.stationIds[0]);
  let task = system.performStation(station.id, {
    ...clock, atHouse: true, quality: 0, sourceId: "rework:low-quality",
  });
  system.update(task.durationSeconds, clock);
  let result = system.snapshot().lastStationResult;
  assert.equal(result.outcome, "quality_rework");
  assert.equal(result.nextStationId, station.id);
  assert.equal(system.snapshot().activeShift.totalGameMinutes, station.gameMinutes);
  assert.deepEqual(result.needEffects, station.needEffects);
  assert.deepEqual(result.effects, { gameMinutes: station.gameMinutes, needs: station.needEffects });

  task = system.performStation(station.id, {
    ...clock, atHouse: true, quality: 100, skillLevel: 100, sourceId: "rework:intake-corrected",
  });
  system.update(task.durationSeconds, clock);
  assert.equal(system.snapshot().lastStationResult.passed, true);

  station = stationFor(role.stationIds[1]);
  task = system.performStation(station.id, {
    ...clock, atHouse: true, quality: 100, skillLevel: 100, safetyConfirmed: false,
    sourceId: "rework:unsafe",
  });
  system.update(task.durationSeconds, clock);
  result = system.snapshot().lastStationResult;
  assert.equal(result.outcome, "safety_rework");
  assert.equal(result.nextStationId, station.id);
  assert.match(result.line, /safe|isolation/i);
  assert.equal(system.snapshot().activeShift.reworkCount, 2);
});

test("completion emits one modest caller-owned wage and life-skill transaction per role per day", () => {
  const system = createCommunityHubSystem({ seed: 740 });
  const role = COMMUNITY_HUB_ROLES[2];
  const clock = openClock(role, 2);
  const externalWallet = Object.freeze({ cash: 125 });
  const transaction = completeRole(system, role.id, { ...clock, prefix: "archive-day-two" });
  assert.equal(transaction.kind, "lawful_shift_wage");
  assert.equal(transaction.callerOwned, true);
  assert.ok(transaction.wage >= role.baseWage - 6 && transaction.wage <= role.baseWage + 6);
  assert.deepEqual(externalWallet, { cash: 125 });
  assert.ok(transaction.gameMinutes >= role.stationIds.reduce((total, id) => total + stationFor(id).gameMinutes, 0));
  assert.ok(transaction.skillEffects.every(value => VALID_SKILL_IDS.has(value.skillId) && value.experience > 0));
  assert.equal(system.snapshot().serials.transaction, 1);
  assert.equal(system.snapshot().ledger.transactionSourceCount, 1);
  assert.equal(system.begin(role.id, { ...clock, sourceId: "archive:again" }).reason, "already_completed_today");
  assert.equal(system.snapshot().serials.transaction, 1);

  const nextOpenDay = clock.dayIndex + 1;
  const nextClock = openClock(role, nextOpenDay);
  assert.equal(system.begin(role.id, { ...nextClock, sourceId: "archive:next-day" }).accepted, true);
});

test("all three authored roles follow different station sequences and award their intended skills", () => {
  for (let index = 0; index < COMMUNITY_HUB_ROLES.length; ++index) {
    const role = COMMUNITY_HUB_ROLES[index];
    const system = createCommunityHubSystem({ seed: 100 + index });
    const clock = openClock(role, index);
    const transaction = completeRole(system, role.id, { ...clock, prefix: `role-${index}` });
    assert.equal(transaction.roleId, role.id);
    assert.deepEqual(transaction.skillEffects, role.skillAwards);
    assert.equal(system.snapshot().roles.find(value => value.roleId === role.id).completedToday, true);
  }
});

test("pause and resume preserve an in-progress physical task exactly", () => {
  const system = createCommunityHubSystem({ seed: 740 });
  const role = COMMUNITY_HUB_ROLES[1];
  const clock = openClock(role);
  system.begin(role.id, { ...clock, sourceId: "pause:begin" });
  const station = stationFor(role.stationIds[0]);
  const task = system.performStation(station.id, {
    ...clock, atHouse: true, safetyConfirmed: true, quality: 93, skillLevel: 70, sourceId: "pause:station",
  });
  system.update(task.durationSeconds * 0.43, { ...clock, captureSnapshot: false });
  const beforePause = system.snapshot().activeShift.task;
  const paused = system.cancel({ ...clock, sourceId: "pause:command" });
  assert.equal(paused.accepted, true);
  assert.equal(paused.taskPreserved, true);
  system.update(20, clock);
  assert.deepEqual(system.snapshot().activeShift.task, beforePause, "paused work must not progress off-screen");
  assert.equal(system.begin(COMMUNITY_HUB_ROLES[0].id, {
    ...openClock(COMMUNITY_HUB_ROLES[0]), sourceId: "pause:other-role",
  }).reason, "paused_shift_pending");
  const resumed = system.begin(role.id, { ...clock, sourceId: "pause:resume" });
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.taskPreserved, true);
  assert.deepEqual(system.snapshot().activeShift.task, beforePause);
});

test("mid-task v1 save restores bit-for-bit and produces the same deterministic outcome", () => {
  const source = createCommunityHubSystem({ seed: 991 });
  const role = COMMUNITY_HUB_ROLES[1];
  const clock = openClock(role, 2);
  source.begin(role.id, { ...clock, sourceId: "save:begin" });
  const station = stationFor(role.stationIds[0]);
  const task = source.performStation(station.id, {
    ...clock, atHouse: true, safetyConfirmed: true, quality: 81, skillLevel: 34, sourceId: "save:station",
  });
  source.update(task.durationSeconds * 0.37, { ...clock, captureSnapshot: false });
  const saved = source.save();
  assert.equal(saved.version, COMMUNITY_HUB_SAVE_VERSION);

  const restored = createCommunityHubSystem({ seed: 1 });
  restored.restore(structuredClone(saved));
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.snapshot(), source.snapshot());
  source.update(task.durationSeconds, clock);
  restored.update(task.durationSeconds, clock);
  assert.deepEqual(restored.save(), source.save());
  assert.deepEqual(restored.snapshot(), source.snapshot());
});

test("source ids are idempotent and rejected retries never advance command or transaction serials", () => {
  const system = createCommunityHubSystem();
  const role = COMMUNITY_HUB_ROLES[0];
  const clock = openClock(role);
  const begin = system.begin(role.id, { ...clock, sourceId: "ledger:begin" });
  assert.equal(begin.accepted, true);
  const serials = system.snapshot().serials;
  assert.equal(system.cancel({ ...clock, sourceId: "ledger:begin" }).reason, "duplicate_source");
  assert.deepEqual(system.snapshot().serials, serials);
  const station = stationFor(role.stationIds[0]);
  const started = system.performStation(station.id, {
    ...clock, atHouse: true, safetyConfirmed: true, sourceId: "ledger:station",
  });
  assert.equal(started.accepted, true);
  const afterStart = system.snapshot().serials;
  assert.equal(system.performStation(station.id, {
    ...clock, atHouse: true, safetyConfirmed: true, sourceId: "ledger:station",
  }).reason, "duplicate_source");
  assert.deepEqual(system.snapshot().serials, afterStart);
  assert.equal(system.snapshot().ledger.sourceCount, 2);
});

test("version-zero data migrates to v1 while invalid saves fail transactionally", () => {
  const legacy = {
    version: 0,
    seed: 740,
    dayIndex: 9,
    minuteOfDay: 735,
    completedDays: { community_kitchen: [2, 8], repair_cafe: [3] },
    sourceLedger: ["legacy:receipt"],
  };
  const migrated = migrateCommunityHubSave(legacy);
  assert.equal(migrated.version, COMMUNITY_HUB_SAVE_VERSION);
  assert.deepEqual(migrated.completed.find(value => value.roleId === "community_kitchen").days, [2, 8]);
  assertDeepFrozenFinite(migrated);

  const system = createCommunityHubSystem();
  system.restore(structuredClone(legacy));
  assert.deepEqual(system.save(), structuredClone(migrated));
  const before = system.save();
  const badSaves = [
    { ...before, version: 99 },
    { ...before, clock: { dayIndex: Infinity, minuteOfDay: 10 } },
    { ...before, completed: [] },
    { ...before, sourceLedger: ["same", "same"] },
    { ...before, serials: { ...before.serials, transaction: before.serials.transaction + 1 } },
    { ...before, transactionSources: [] },
    { ...before, shift: { roleId: "invented" } },
  ];
  for (const bad of badSaves) {
    assert.throws(() => system.restore(bad));
    assert.deepEqual(system.save(), before, "failed restore must not partially alter live work state");
  }
});

test("snapshot is recursively immutable and allocation-free update views are reused", () => {
  const system = createCommunityHubSystem();
  const snapshot = system.snapshot();
  assertDeepFrozenFinite(snapshot);
  assert.strictEqual(system.snapshot(), snapshot, "unchanged presentation snapshots should remain cached");
  const first = system.update(0, { dayIndex: 3, minuteOfDay: 700, captureSnapshot: false });
  const second = system.update(0.1, { captureSnapshot: false });
  assert.strictEqual(first, second);
  const changedSnapshot = system.snapshot();
  assert.notStrictEqual(changedSnapshot, snapshot);
  assert.strictEqual(system.snapshot(), changedSnapshot);
  assert.deepEqual(Object.keys(first), [
    "dayIndex", "minuteOfDay", "activeRoleId", "status", "stationId", "taskProgress", "taskActive",
    "commandSerial", "transactionSerial", "lastStationResultSerial", "lastEvent", "stateRevision",
  ]);
});

test("RAM-only prewarm covers roles, rooms, staff, dialogue, outcomes, and save branches without mutation", () => {
  const system = createCommunityHubSystem({ seed: 740 });
  const role = COMMUNITY_HUB_ROLES[0];
  const clock = openClock(role);
  system.begin(role.id, { ...clock, sourceId: "prewarm:begin" });
  const before = system.save();
  const bits = JSON.stringify(before);
  const prepared = system.prewarm();
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.diskResources, 0);
  assert.equal(prepared.rendererResources, 0);
  assert.equal(prepared.houseRoomsPrepared, HARBOUR_SKILLS_HOUSE.rooms.length);
  assert.equal(prepared.rolesPrepared, COMMUNITY_HUB_ROLES.length);
  assert.equal(prepared.stationsPrepared, COMMUNITY_HUB_STATIONS.length);
  assert.equal(prepared.staffPrepared, COMMUNITY_HUB_STAFF.length);
  assert.ok(prepared.dialoguePrepared >= COMMUNITY_HUB_STATIONS.length * 4);
  assert.equal(prepared.outcomeBranchesPrepared, COMMUNITY_HUB_STATIONS.length * 3);
  assert.equal(prepared.saveRestorePrepared, true);
  assert.equal(prepared.liveStatePreserved, true);
  assert.ok(prepared.checksum > 0);
  assert.strictEqual(system.prewarm(), prepared);
  assert.equal(JSON.stringify(system.save()), bits);
  assert.deepEqual(system.save(), before);
  assertDeepFrozenFinite(prepared);
});
