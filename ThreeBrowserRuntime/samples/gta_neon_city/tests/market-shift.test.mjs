import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKET_SHIFT_SAVE_VERSION,
  MARKET_SURPLUS_DECISIONS,
  MINA_MARKET_HOURS,
  MINA_MARKET_SHIFT_ROLE,
  MINA_MARKET_STAFF,
  MINA_MARKET_STATIONS,
  MINA_MARKET_WORKPLACE,
  MINA_OKAFOR,
  createMarketShiftSystem,
  createMinaMarketDailyScenario,
  createMinaMarketShift,
  migrateMarketShiftSave,
} from "../src/game/market-shift.mjs";

const CLOCK = Object.freeze({ dayIndex: 4, minuteOfDay: 8 * 60 });

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

function stationContext(station, sourceId, extra = {}) {
  return {
    ...CLOCK,
    onFoot: true,
    nearbyStationId: station.worldStationId,
    safetyConfirmed: true,
    quality: 94,
    skillLevels: { hospitality: 70, community: 70, fitness: 70 },
    sourceId,
    ...extra,
  };
}

function startShift(system, prefix = "shift", clock = CLOCK) {
  return system.begin({
    ...clock,
    onFoot: true,
    nearbyStationId: "mina-order-counter",
    sourceId: `${prefix}:begin`,
  });
}

function finishStation(system, station, prefix, clock = CLOCK, extra = {}) {
  const started = system.performStation(station.id, stationContext(station, `${prefix}:${station.id}`, {
    ...clock,
    ...extra,
  }));
  assert.equal(started.accepted, true, `${station.id} should start: ${started.reason}`);
  const runtime = system.update(started.durationSeconds + 0.001, { ...clock, captureSnapshot: false });
  assert.equal(runtime.taskActive, false);
  assert.equal(system.snapshot().lastStationResult.passed, true, `${station.id} should pass`);
  return system.snapshot().lastStationResult;
}

function completeShift(system, decisionId, prefix = decisionId, clock = CLOCK) {
  assert.equal(startShift(system, prefix, clock).accepted, true);
  for (let index = 0; index < MINA_MARKET_STATIONS.length; ++index) {
    if (index === 4) {
      const choice = system.chooseSurplus(decisionId, {
        ...clock,
        onFoot: true,
        nearbyStationId: "mina-pantry-shelf",
        sourceId: `${prefix}:surplus:${decisionId}`,
      });
      assert.equal(choice.accepted, true);
    }
    finishStation(system, MINA_MARKET_STATIONS[index], prefix, clock);
  }
  return system.snapshot().lastTransaction;
}

test("Mina's Market definitions match the forthcoming physical building and stay recursively immutable", () => {
  assert.equal(createMinaMarketShift, createMarketShiftSystem);
  assert.equal(MINA_MARKET_WORKPLACE.id, "mina_market_kitchen");
  assert.equal(MINA_MARKET_WORKPLACE.propertyId, "mina-market-building");
  assert.equal(MINA_MARKET_WORKPLACE.buildingId, "building-009");
  assert.equal(MINA_MARKET_WORKPLACE.address, "84 Market Street");
  assert.equal(MINA_MARKET_WORKPLACE.districtId, "north-market");
  assert.equal(MINA_MARKET_WORKPLACE.keeperId, "mina_okafor");
  assert.equal(MINA_MARKET_SHIFT_ROLE.id, "mina_market_shift");
  assert.deepEqual(MINA_MARKET_WORKPLACE.prohibitedActivities, ["combat", "weapons", "crime"]);
  assert.deepEqual(MINA_MARKET_STATIONS.map(value => value.id), [
    "mina-order-counter",
    "mina-cold-case",
    "mina-produce-scale",
    "mina-pantry-shelf",
    "mina-packing-bench",
    "mina-grocery-checkout",
    "mina-dish-sink",
  ]);
  assert.ok(MINA_MARKET_STATIONS.every(value => value.safetyRequired && value.checks.length >= 3));
  assert.ok(MINA_MARKET_STATIONS.every(value => value.instruction && value.supervisorLine
    && value.passLine && value.reworkLine));
  assert.deepEqual(MINA_MARKET_SHIFT_ROLE.skillAwards.map(value => value.skillId), [
    "hospitality", "community", "fitness",
  ]);
  for (const definition of [MINA_MARKET_HOURS, MINA_MARKET_STATIONS, MARKET_SURPLUS_DECISIONS,
    MINA_OKAFOR, MINA_MARKET_STAFF, MINA_MARKET_WORKPLACE, MINA_MARKET_SHIFT_ROLE]) {
    assertDeepFrozenFinite(definition);
  }
});

test("Mina and coworker Emi expose named, room-level schedules including real breaks", () => {
  const market = createMarketShiftSystem();
  const opening = market.staffState("mina_okafor", { dayIndex: 1, minuteOfDay: 6 * 60 + 30 });
  assert.equal(opening.activity, "opening_checks");
  assert.equal(opening.roomId, "mina-cold-stock");
  const minaBreak = market.staffState("mina_okafor", { dayIndex: 1, minuteOfDay: 12 * 60 + 10 });
  assert.equal(minaBreak.activity, "meal_break");
  assert.match(minaBreak.dialogue, /break/i);
  const coworker = market.staffState("emi_sato", { dayIndex: 1, minuteOfDay: 9 * 60 });
  assert.equal(coworker.name, "Emi Sato");
  assert.equal(MINA_MARKET_STAFF[1].homeLocationId, "emi-sato-home");
  assert.equal(coworker.activity, "stock_and_checkout");
  assert.equal(coworker.roomId, "mina-grocery-checkout");
  assert.strictEqual(market.staffState("missing"), null);
  assertDeepFrozenFinite(coworker);
});

test("posted hours are 07:00-21:00 with a realistic last clock-in", () => {
  const market = createMarketShiftSystem();
  assert.equal(MINA_MARKET_HOURS.openMinute, 420);
  assert.equal(MINA_MARKET_HOURS.lastClockInMinute, 960);
  assert.equal(MINA_MARKET_HOURS.closeMinute, 1260);
  assert.match(MINA_MARKET_HOURS.label, /07:00-21:00/);
  assert.equal(market.availability({ dayIndex: 2, minuteOfDay: 419 }).reason, "market_closed");
  assert.equal(market.availability({ dayIndex: 2, minuteOfDay: 420 }).canBegin, true);
  assert.equal(market.availability({ dayIndex: 2, minuteOfDay: 960 }).canBegin, true);
  const late = market.availability({ dayIndex: 2, minuteOfDay: 961 });
  assert.equal(late.businessOpen, true);
  assert.equal(late.reason, "outside_clock_in_hours");
  assert.equal(market.availability({ dayIndex: 2, minuteOfDay: 1260 }).reason, "market_closed");
});

test("daily stock, order, cold-chain, till, and surplus scenarios are deterministic by seed and day", () => {
  const first = createMinaMarketDailyScenario(8, { seed: 740 });
  const repeated = createMinaMarketDailyScenario(8, { seed: 740 });
  const anotherDay = createMinaMarketDailyScenario(9, { seed: 740 });
  const anotherSeed = createMinaMarketDailyScenario(8, { seed: 741 });
  assert.deepEqual(repeated, first);
  assert.notDeepEqual(anotherDay, first);
  assert.notDeepEqual(anotherSeed, first);
  assert.equal(first.coldChain.releaseAllowed, true);
  assert.equal(first.till.callerOwnedLedger, true);
  assert.equal(first.customerOrder.substitutionConsentRequired, true);
  assert.deepEqual(first.surplus.choices, ["mark_down", "donate", "discard"]);
  assertDeepFrozenFinite(first);
});

test("clock-in and every job step require on-foot proximity to the correct physical station", () => {
  const market = createMarketShiftSystem({ seed: 740 });
  assert.equal(market.begin({ ...CLOCK, nearbyStationId: "mina-order-counter", sourceId: "physical:car" }).reason,
    "on_foot_required");
  assert.equal(market.begin({ ...CLOCK, onFoot: true, nearbyStationId: "mina-cold-case", sourceId: "physical:wrong" }).reason,
    "wrong_physical_station");
  assert.equal(market.begin({
    ...CLOCK, onFoot: true, nearbyStationId: "mina-order-counter", distanceToStation: 5, sourceId: "physical:far",
  }).reason, "station_too_far");
  assert.equal(startShift(market, "physical").accepted, true);
  assert.equal(market.performStation("mina-cold-case", stationContext(MINA_MARKET_STATIONS[1], "physical:out-of-order")).reason,
    "wrong_station");
  assert.equal(market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "physical:vehicle", {
    onFoot: false,
  })).reason, "on_foot_required");
  assert.equal(market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "physical:other-room", {
    nearbyStationId: "mina-grocery-checkout",
  })).reason, "wrong_physical_station");
  const acceptedByPosition = market.performStation("mina-order-counter", {
    ...CLOCK,
    onFoot: true,
    playerPosition: [1.2, 0, 1.2],
    stationPositions: { "mina-order-counter": [1, 0, 1] },
    safetyConfirmed: true,
    quality: 90,
    sourceId: "physical:position",
  });
  assert.equal(acceptedByPosition.accepted, true);
});

test("the work sequence has distinct checks and requires a surplus decision after stock rotation", () => {
  const market = createMarketShiftSystem({ seed: 740 });
  startShift(market, "sequence");
  assert.equal(market.chooseSurplus("donate", {
    ...CLOCK, onFoot: true, nearbyStationId: "mina-pantry-shelf", sourceId: "sequence:too-soon",
  }).reason, "surplus_decision_not_ready");
  for (let index = 0; index < 4; ++index) finishStation(market, MINA_MARKET_STATIONS[index], "sequence");
  assert.equal(market.snapshot().activeShift.surplusDecisionRequired, true);
  assert.equal(market.performStation("mina-packing-bench", stationContext(MINA_MARKET_STATIONS[4], "sequence:skip-decision")).reason,
    "surplus_decision_required");
  assert.equal(market.chooseSurplus("donate", {
    ...CLOCK, onFoot: true, nearbyStationId: "mina-grocery-checkout", sourceId: "sequence:wrong-place",
  }).reason, "wrong_physical_station");
  const decision = market.chooseSurplus("donate", {
    ...CLOCK, onFoot: true, nearbyStationId: "mina-pantry-shelf", sourceId: "sequence:donate",
  });
  assert.equal(decision.accepted, true);
  assert.equal(decision.result.decisionId, "donate");
  assert.match(decision.result.tradeoff, /extra|feeds|cold-chain/i);
  assert.equal(market.snapshot().activeShift.nextStationId, "mina-packing-bench");
  assert.equal(market.chooseSurplus("mark_down", {
    ...CLOCK, onFoot: true, nearbyStationId: "mina-pantry-shelf", sourceId: "sequence:second-choice",
  }).reason, "surplus_decision_already_recorded");
});

test("unsafe or careless work consumes time and forces honest station rework", () => {
  const market = createMarketShiftSystem({ seed: 740 });
  startShift(market, "rework");
  let started = market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "rework:unsafe", {
    safetyConfirmed: false,
    quality: 100,
    skillLevel: 100,
  }));
  market.update(started.durationSeconds, { ...CLOCK, captureSnapshot: false });
  let result = market.snapshot().lastStationResult;
  assert.equal(result.outcome, "safety_rework");
  assert.equal(result.nextStationId, "mina-order-counter");
  assert.deepEqual(result.effects, {
    gameMinutes: MINA_MARKET_STATIONS[0].gameMinutes,
    needs: MINA_MARKET_STATIONS[0].needEffects,
  });
  started = market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "rework:careless", {
    safetyConfirmed: true,
    quality: 0,
    skillLevel: 0,
  }));
  market.update(started.durationSeconds, { ...CLOCK, captureSnapshot: false });
  result = market.snapshot().lastStationResult;
  assert.equal(result.outcome, "quality_rework");
  assert.equal(market.snapshot().activeShift.reworkCount, 2);
  assert.match(result.line, /read|again|risk/i);
});

test("surplus choices have honest wage, quality, community, and waste tradeoffs", () => {
  const mark = completeShift(createMarketShiftSystem({ seed: 740 }), "mark_down", "mark");
  const donate = completeShift(createMarketShiftSystem({ seed: 740 }), "donate", "donate");
  const discard = completeShift(createMarketShiftSystem({ seed: 740 }), "discard", "discard");
  assert.equal(mark.kind, "lawful_market_shift_wage");
  assert.equal(mark.callerOwned, true);
  assert.equal(mark.callerMustApplyOnce, true);
  assert.ok(mark.wage > donate.wage, "donation has extra paid-time tradeoff in this bounded wage transaction");
  assert.ok(mark.quality > discard.quality);
  assert.ok(donate.communityTrust > mark.communityTrust);
  assert.ok(mark.communityTrust > discard.communityTrust);
  assert.equal(donate.stockEffects.edibleUnitsSaved, 6);
  assert.equal(discard.stockEffects.discardedUnits, 6);
  assert.deepEqual(donate.skillEffects.map(value => value.skillId), ["hospitality", "community", "fitness"]);
  assert.ok(donate.skillEffects.find(value => value.skillId === "community").experience
    > mark.skillEffects.find(value => value.skillId === "community").experience);
  assert.deepEqual(donate.externalLedgerEffects, { customerPurchases: 0, tillCents: 0, householdGroceries: 0 });
  assert.match(donate.transactionId, /^mina-market-wage:4:1$/);
  assert.equal(donate.sourceId, donate.transactionId);
  assert.equal(donate.idempotencySourceId, donate.transactionId);
  assertDeepFrozenFinite(donate);
});

test("only one completed paid market shift is issued per game day", () => {
  const market = createMarketShiftSystem({ seed: 740 });
  const first = completeShift(market, "mark_down", "daily");
  assert.equal(first.dayIndex, CLOCK.dayIndex);
  assert.equal(market.snapshot().serials.transaction, 1);
  assert.equal(market.snapshot().ledger.transactionSourceCount, 1);
  assert.equal(market.begin({
    ...CLOCK, onFoot: true, nearbyStationId: "mina-order-counter", sourceId: "daily:again",
  }).reason, "already_completed_today");
  assert.equal(market.snapshot().serials.transaction, 1);
  const tomorrow = { dayIndex: CLOCK.dayIndex + 1, minuteOfDay: 8 * 60 };
  assert.equal(market.begin({
    ...tomorrow, onFoot: true, nearbyStationId: "mina-order-counter", sourceId: "daily:tomorrow",
  }).accepted, true);
});

test("unfinished work can be abandoned without erasing history and expires cleanly after midnight", () => {
  const market = createMarketShiftSystem({ seed: 740 });
  startShift(market, "abandon");
  const started = market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "abandon:task"));
  market.update(started.durationSeconds * 0.25, { ...CLOCK, captureSnapshot: false });
  const abandoned = market.abandon({ ...CLOCK, sourceId: "abandon:confirm" });
  assert.equal(abandoned.accepted, true);
  assert.equal(abandoned.taskDiscarded, true);
  assert.equal(abandoned.wage, 0);
  assert.equal(market.snapshot().activeShift, null);
  assert.deepEqual(market.snapshot().completedDays, []);
  assert.equal(market.begin({
    ...CLOCK, onFoot: true, nearbyStationId: "mina-order-counter", sourceId: "abandon:restart",
  }).accepted, true);

  const nextDay = { dayIndex: CLOCK.dayIndex + 1, minuteOfDay: 8 * 60 };
  const runtime = market.update(0, { ...nextDay, captureSnapshot: false });
  assert.equal(runtime.status, "idle");
  assert.equal(runtime.lastEvent, "market_shift_expired");
  assert.equal(market.snapshot().activeShift, null);
  assert.equal(market.begin({
    ...nextDay, onFoot: true, nearbyStationId: "mina-order-counter", sourceId: "abandon:next-day",
  }).accepted, true);
});

test("caller command source IDs are idempotent and never advance serials on retry", () => {
  const market = createMarketShiftSystem();
  const began = startShift(market, "ledger");
  assert.equal(began.accepted, true);
  const serials = market.snapshot().serials;
  assert.equal(market.pause({ ...CLOCK, sourceId: "ledger:begin" }).reason, "duplicate_source");
  assert.deepEqual(market.snapshot().serials, serials);
  const task = market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "ledger:task"));
  assert.equal(task.accepted, true);
  const afterTask = market.snapshot().serials;
  assert.equal(market.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "ledger:task")).reason,
    "duplicate_source");
  assert.deepEqual(market.snapshot().serials, afterTask);
  assert.equal(market.snapshot().ledger.sourceCount, 2);
});

test("v1 mid-task save/restore is bit-exact and continues deterministically", () => {
  const source = createMarketShiftSystem({ seed: 119 });
  startShift(source, "save");
  const started = source.performStation("mina-order-counter", stationContext(MINA_MARKET_STATIONS[0], "save:task", {
    quality: 83,
    skillLevel: 37,
  }));
  source.update(started.durationSeconds * 0.37, { ...CLOCK, captureSnapshot: false });
  const saved = source.save();
  assert.equal(saved.version, MARKET_SHIFT_SAVE_VERSION);
  const restored = createMarketShiftSystem({ seed: 1 });
  restored.restore(structuredClone(saved));
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.snapshot(), source.snapshot());
  source.update(started.durationSeconds, { ...CLOCK, captureSnapshot: false });
  restored.update(started.durationSeconds, { ...CLOCK, captureSnapshot: false });
  assert.deepEqual(restored.save(), source.save());
  assert.deepEqual(restored.snapshot(), source.snapshot());
});

test("legacy saves migrate and invalid restores are transactional", () => {
  const legacy = {
    version: 0,
    seed: 740,
    dayIndex: 9,
    minuteOfDay: 500,
    completedDays: [2, 8],
    sourceLedger: ["legacy:clock-in"],
  };
  const migrated = migrateMarketShiftSave(legacy);
  assert.equal(migrated.version, MARKET_SHIFT_SAVE_VERSION);
  assert.deepEqual(migrated.completedDays, [2, 8]);
  assert.equal(migrated.serials.transaction, 2);
  assertDeepFrozenFinite(migrated);

  const market = createMarketShiftSystem();
  market.restore(structuredClone(legacy));
  assert.deepEqual(market.save(), migrated);
  const before = market.save();
  const hostile = [
    { ...before, version: 99 },
    { ...before, seed: Infinity },
    { ...before, clock: { dayIndex: -1, minuteOfDay: 9999 } },
    { ...before, completedDays: [2, 2] },
    { ...before, sourceLedger: ["same", "same"] },
    { ...before, transactionSources: [] },
    { ...before, serials: { ...before.serials, transaction: 99 } },
    { ...before, shift: { ...before.shift, needTotals: null } },
    { ...before, shift: { ...before.shift, qualityTotal: 99 } },
    { ...before, shift: { ...before.shift, scenario: { ...before.shift?.scenario, id: "forged" } } },
  ];
  for (const value of hostile) {
    assert.throws(() => market.restore(value));
    assert.deepEqual(market.save(), before, "invalid restore must not partially mutate the market shift");
  }

  const active = createMarketShiftSystem({ seed: 740 });
  startShift(active, "semantic-save");
  const activeBefore = active.save();
  for (const corruptedShift of [
    { ...activeBefore.shift, needTotals: null },
    { ...activeBefore.shift, qualityTotal: 99 },
    { ...activeBefore.shift, scenario: { ...activeBefore.shift.scenario, id: "forged" } },
    { ...activeBefore.shift, attempts: [1, 0, 0, 0, 0, 0, 0] },
  ]) {
    assert.throws(() => active.restore({ ...activeBefore, shift: corruptedShift }));
    assert.deepEqual(active.save(), activeBefore, "semantic restore rejection must also be transactional");
  }
});

test("snapshots are immutable and cached while update exposes one allocation-free runtime view", () => {
  const market = createMarketShiftSystem();
  const firstSnapshot = market.snapshot();
  assert.strictEqual(market.snapshot(), firstSnapshot);
  assertDeepFrozenFinite(firstSnapshot);
  const firstView = market.update(0, { ...CLOCK, captureSnapshot: false });
  const secondView = market.update(0, { captureSnapshot: false });
  assert.strictEqual(secondView, firstView);
  assert.deepEqual(Object.keys(firstView), [
    "dayIndex", "minuteOfDay", "status", "stationId", "taskProgress", "taskActive", "decisionRequired",
    "commandSerial", "transactionSerial", "stationResultSerial", "lastEvent", "stateRevision",
  ]);
  assert.notStrictEqual(market.snapshot(), firstSnapshot);
});

test("RAM-only prewarm covers all stations, decisions, daily scenarios, schedules, and save paths without mutation", () => {
  const market = createMarketShiftSystem({ seed: 740 });
  startShift(market, "prewarm");
  const before = market.save();
  const bits = JSON.stringify(before);
  const prepared = market.prewarm();
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.diskResources, 0);
  assert.equal(prepared.rendererResources, 0);
  assert.equal(prepared.runtimeAssetsCreated, 0);
  assert.equal(prepared.stationsPrepared, MINA_MARKET_STATIONS.length);
  assert.equal(prepared.stationOutcomesPrepared, MINA_MARKET_STATIONS.length * 3);
  assert.equal(prepared.surplusBranchesPrepared, MARKET_SURPLUS_DECISIONS.length);
  assert.equal(prepared.dailyScenariosPrepared, 14);
  assert.ok(prepared.staffSchedulesPrepared >= 20);
  assert.equal(prepared.saveRestorePrepared, true);
  assert.equal(prepared.liveStatePreserved, true);
  assert.ok(prepared.checksum > 0);
  assert.strictEqual(market.prewarm(), prepared);
  assert.equal(JSON.stringify(market.save()), bits);
  assert.deepEqual(market.save(), before);
  assertDeepFrozenFinite(prepared);
});
