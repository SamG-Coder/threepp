import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RESIDENTIAL_HOMES,
  DEFAULT_RESIDENTIAL_RESIDENTS,
  RESIDENTIAL_HOME_ACTIONS,
  RESIDENTIAL_LIFE_SAVE_VERSION,
  RESIDENTIAL_LIMITS,
  RESIDENTIAL_SKILLS,
  createResidentialLife,
  createResidentialLifeSystem,
} from "../src/game/residential-life.mjs";

function assertDeepFrozenFinite(value, path = "snapshot", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozenFinite(child, `${path}.${key}`, seen);
}

test("the authored roster seeds real rooms, fixtures, market homes, and persistent named residents", () => {
  assert.equal(createResidentialLifeSystem, createResidentialLife);
  assert.equal(DEFAULT_RESIDENTIAL_HOMES.length, 6);
  assert.equal(DEFAULT_RESIDENTIAL_RESIDENTS.length, 3);
  assert.equal(new Set(DEFAULT_RESIDENTIAL_HOMES.map(home => home.id)).size, 6);
  assert.equal(new Set(DEFAULT_RESIDENTIAL_RESIDENTS.map(resident => resident.name)).size, 3);
  assert.equal(DEFAULT_RESIDENTIAL_HOMES.filter(home => home.market.available).length, 3);
  assert.equal(DEFAULT_RESIDENTIAL_HOMES.filter(home => !home.market.available).length, 3);
  assert.ok(DEFAULT_RESIDENTIAL_HOMES.every(home => home.address && home.buildingId && home.rooms.length >= 3));
  assert.ok(DEFAULT_RESIDENTIAL_HOMES.every(home => home.rooms.every(room => room.fixtures.length >= 1)));

  const fixtureKinds = new Set(DEFAULT_RESIDENTIAL_HOMES.flatMap(home =>
    home.rooms.flatMap(room => room.fixtures.map(fixture => fixture.kind))));
  for (const required of ["bed", "shower", "stove", "table", "sink", "desk", "sofa"]) {
    assert.equal(fixtureKinds.has(required), true, `${required} fixture must be authored`);
  }
  for (const resident of DEFAULT_RESIDENTIAL_RESIDENTS) {
    assert.ok(DEFAULT_RESIDENTIAL_HOMES.some(home => home.id === resident.homeId));
    assert.deepEqual(new Set(resident.schedule.map(entry => entry.activity)),
      new Set(["home", "work", "leisure", "sleep"]));
  }
  assert.deepEqual(Object.values(RESIDENTIAL_SKILLS), [
    "mechanics", "driving", "fitness", "photography", "community", "hospitality",
  ]);
});

test("renting and buying are gated progression transactions whose cash remains caller-owned", () => {
  const housing = createResidentialLife({ initialHomeId: null, initialTenure: "none" });
  const external = Object.freeze({ cash: 50_000, progressionTier: 0 });
  assert.equal(housing.snapshot().player.currentHomeId, null);
  assert.equal(housing.acquireHome("riverside_flat_6a", external).reason, "progression_required");
  assert.equal(housing.acquireHome("amara_home_4d", external).reason, "not_on_market");
  assert.equal(housing.acquireHome("southline_studio_3b", { cash: 100, progressionTier: 0 }).reason, "insufficient_cash");

  const lease = housing.acquireHome("southline_studio_3b", {
    mode: "rent",
    cash: external.cash,
    progressionTier: external.progressionTier,
    dayIndex: 4,
    sourceId: "lease-3b",
  });
  assert.equal(lease.accepted, true);
  assert.equal(lease.cost, 420);
  assert.equal(lease.previousHomeId, null);
  assert.equal(external.cash, 50_000);
  assert.equal(housing.acquireHome("southline_studio_3b", {
    mode: "rent", cash: 50_000, sourceId: "lease-3b",
  }).reason, "duplicate_source");

  const purchase = housing.acquireHome("southline_studio_3b", {
    mode: "buy",
    cash: 50_000,
    progressionTier: 0,
    dayIndex: 5,
    sourceId: "purchase-3b",
  });
  assert.equal(purchase.accepted, true);
  assert.equal(purchase.depositCredit, 420);
  assert.equal(purchase.cost, 18_080);
  assert.equal(housing.snapshot().player.tenure, "owned");
  assert.deepEqual(housing.snapshot().player.ownedHomeIds, ["southline_studio_3b"]);

  const upgraded = housing.acquireHome("riverside_flat_6a", {
    mode: "buy", cash: 50_000, progressionTier: 1, sourceId: "purchase-6a",
  });
  assert.equal(upgraded.accepted, true);
  assert.deepEqual(housing.snapshot().player.ownedHomeIds, ["southline_studio_3b", "riverside_flat_6a"]);
  assert.equal(housing.snapshot().player.currentHomeId, "riverside_flat_6a");
  const savedAfterPurchase = housing.save();
  const restoredAfterPurchase = createResidentialLife();
  restoredAfterPurchase.restore(structuredClone(savedAfterPurchase));
  assert.deepEqual(restoredAfterPurchase.save(), savedAfterPurchase,
    "the canonical property transaction must survive an exact save round trip");
});

test("weekly rent accrues from world days and the allocation-free update view is reused", () => {
  const housing = createResidentialLife({ initialDayIndex: 3, initialMinuteOfDay: 8 * 60 });
  const first = housing.update(1 / 60, { dayIndex: 9, timeHours: 12, captureSnapshot: false });
  const second = housing.update(1 / 60, { dayIndex: 10, timeHours: 12.25, captureSnapshot: false });
  assert.strictEqual(second, first);
  assert.deepEqual(Object.keys(first), [
    "dayIndex", "minuteOfDay", "currentHomeId", "visitorActive", "visitorResidentId", "rentDue",
  ]);
  assert.equal(first.rentDue, 294, "seven days of the starter home's daily rent are billed together");
  assert.equal(housing.snapshot().player.delinquent, true);
  assert.equal(housing.payRent({ cash: 100, dayIndex: 10 }).reason, "insufficient_cash");
  const paid = housing.payRent({ cash: 1_000, dayIndex: 10, sourceId: "week-one-rent" });
  assert.equal(paid.accepted, true);
  assert.equal(paid.amount, 294);
  assert.equal(paid.cost, 294);
  assert.equal(housing.snapshot().player.outstandingRent, 0);
  assert.equal(housing.payRent({ cash: 1_000, dayIndex: 10 }).reason, "nothing_due");
  const savedAfterRent = housing.save();
  const restoredAfterRent = createResidentialLife();
  restoredAfterRent.restore(structuredClone(savedAfterRent));
  assert.deepEqual(restoredAfterRent.save(), savedAfterRent,
    "rent receipts retain their exact amount and canonical transaction shape");
});

test("home activities return bounded needs and six-skill effects while fixtures and pantry stay persistent", () => {
  const housing = createResidentialLife();
  const external = Object.freeze({ energy: 94, hygiene: 97 });
  const shower = housing.perform("shower", {
    atHome: true,
    cash: 100,
    dayIndex: 2,
    needs: external,
    sourceId: "shower-day-2",
  });
  assert.equal(shower.accepted, true);
  assert.equal(shower.effects.energy, 4);
  assert.equal(shower.effects.hygiene, 3, "returned effects stop at the caller's 100-point cap");
  assert.deepEqual(external, { energy: 94, hygiene: 97 });

  const beforeKitchen = housing.snapshot().homes.find(home => home.playerResidence);
  const cooked = housing.performActivity("cook", {
    atHome: true, cash: 100, dayIndex: 2, needs: { energy: 50, hygiene: 50 }, sourceId: "cook-day-2",
  });
  assert.equal(cooked.accepted, true);
  assert.deepEqual(cooked.effects.skills, [{ skillId: "hospitality", experience: 12 }]);
  let home = housing.snapshot().homes.find(value => value.playerResidence);
  assert.equal(home.groceries, beforeKitchen.groceries - 1);
  assert.equal(home.preparedMeals, 2);
  const ate = housing.perform("eat", {
    atHome: true, cash: 100, dayIndex: 2, needs: { energy: 80, hygiene: 80, appetite: 80 },
  });
  assert.equal(ate.accepted, true);
  assert.equal(ate.effects.energy, 20);
  assert.equal(ate.effects.appetite, 20, "the caller can route meal effects to the separate appetite owner");
  assert.equal(housing.snapshot().homes.find(value => value.playerResidence).preparedMeals, 1);

  const studied = housing.perform("study", {
    atHome: true, cash: 0, dayIndex: 2, skillId: RESIDENTIAL_SKILLS.DRIVING, sourceId: "study-driving",
  });
  assert.deepEqual(studied.effects.skills, [{ skillId: "driving", experience: 16 }]);
  const sameDayStudy = housing.perform("study", { atHome: true, cash: 0, dayIndex: 2, skillId: "photography" });
  assert.deepEqual(sameDayStudy.effects.skills, [], "daily care remains useful without becoming an XP exploit");
  const nextDayStudy = housing.perform("study", { atHome: true, cash: 0, dayIndex: 3, skillId: "photography" });
  assert.deepEqual(nextDayStudy.effects.skills, [{ skillId: "photography", experience: 16 }]);

  home = housing.snapshot().homes.find(value => value.playerResidence);
  assert.ok(home.fixtures.some(fixture => fixture.useCount > 0));
  assert.ok(home.condition < 100);
  assertDeepFrozenFinite(housing.snapshot());
  assert.equal(RESIDENTIAL_HOME_ACTIONS.length, 7);
});

test("cleaning, grocery restocking, and fixture maintenance have contextual, caller-applied costs", () => {
  const housing = createResidentialLife();
  assert.equal(housing.restockHome({ atHome: false, cash: 100 }).reason, "inside_home_required");
  assert.equal(housing.restockHome({ atHome: true, cash: 1 }).reason, "insufficient_cash");
  const stocked = housing.restockHome({ atHome: true, cash: 100, sourceId: "weekly-shop" });
  assert.equal(stocked.accepted, true);
  assert.equal(stocked.cost, 18);
  assert.ok(stocked.groceriesAdded > 0);

  const before = housing.snapshot().homes.find(home => home.playerResidence);
  const kitchenSink = before.fixtures.find(fixture => fixture.kind === "sink");
  const cleaned = housing.perform("clean", {
    atHome: true, cash: 10, dayIndex: 4, roomId: kitchenSink.roomId, sourceId: "clean-kitchen",
  });
  assert.equal(cleaned.accepted, true);
  assert.deepEqual(cleaned.effects.skills, [
    { skillId: "community", experience: 8 },
    { skillId: "fitness", experience: 4 },
  ]);
  const after = housing.snapshot().homes.find(home => home.playerResidence);
  const cleanedSink = after.fixtures.find(fixture => fixture.id === kitchenSink.id);
  assert.ok(cleanedSink.cleanliness >= kitchenSink.cleanliness);

  const maintained = housing.maintainFixture(after.id, cleanedSink.id, {
    atHome: true, cash: 100, sourceId: "maintain-sink",
  });
  assert.equal(maintained.accepted, true);
  assert.equal(maintained.fixtureId, cleanedSink.id);
  assert.deepEqual(maintained.effects.skills, [{ skillId: "mechanics", experience: 10 }]);
  assert.equal(housing.snapshot().homes.find(home => home.playerResidence)
    .fixtures.find(fixture => fixture.id === cleanedSink.id).condition, 100);
});

test("purchased groceries are carried idempotently, survive saves, and unpack only into available pantry space", () => {
  const source = createResidentialLife();
  const initial = source.snapshot();
  const home = initial.homes.find(value => value.playerResidence);
  assert.equal(initial.player.carriedSupplies.groceries, 0);
  assert.equal(RESIDENTIAL_LIMITS.maxCarriedGroceries, 10);

  assert.deepEqual(source.quoteSupplyReceipt({ groceries: 5 }), {
    accepted: true,
    reason: null,
    groceriesRequested: 5,
    carriedGroceries: 0,
    remainingCapacity: 10,
    carriedGroceriesAfter: 5,
  });
  assert.equal(source.quoteSupplyReceipt({ groceries: 0 }).reason, "no_supplies");
  assert.equal(source.snapshot().homes.find(value => value.playerResidence).groceries, home.groceries,
    "quoting and receiving a bag cannot stock the pantry remotely");

  const received = source.receiveSupplies({ groceries: 5 }, { sourceId: "mina-sale:41" });
  assert.equal(received.accepted, true);
  assert.equal(received.kind, "supply_receipt");
  assert.equal(received.groceriesReceived, 5);
  assert.equal(received.carriedGroceries, 5);
  const carriedSave = structuredClone(source.save());
  assert.equal(carriedSave.version, 3);
  assert.equal(carriedSave.player.carriedSupplies.groceries, 5);

  const housing = createResidentialLife();
  housing.restore(carriedSave);
  assert.deepEqual(housing.save(), carriedSave, "an errand can be saved exactly before the bag reaches home");
  const beforeDuplicate = housing.save();
  const duplicate = housing.receiveSupplies({ groceries: 1 }, { sourceId: "mina-sale:41" });
  assert.equal(duplicate.reason, "duplicate_source",
    "the original source rejects a replay even when its payload changes");
  assert.deepEqual(housing.save(), beforeDuplicate);

  assert.equal(housing.receiveSupplies({ groceries: 5 }, { sourceId: "mina-sale:42" }).accepted, true);
  assert.equal(housing.snapshot().player.carriedSupplies.groceries, 10);
  assert.equal(housing.quoteSupplyReceipt({ groceries: 1 }).reason, "carrying_capacity");
  const fullCarry = housing.save();
  assert.equal(housing.receiveSupplies({ groceries: 1 }, { sourceId: "mina-sale:43" }).reason, "carrying_capacity");
  assert.deepEqual(housing.save(), fullCarry, "capacity rejection cannot consume a source or transaction serial");

  const legacy = housing.restockHome({
    atHome: true,
    cash: 18,
    homeId: home.id,
    sourceId: "legacy-restock",
  });
  assert.equal(legacy.accepted, true, "the compatibility restock path remains available");
  const pantryBefore = housing.snapshot().homes.find(value => value.playerResidence).groceries;
  assert.equal(housing.unpackSupplies({ atHome: false, homeId: home.id, sourceId: "unpack:outside" }).reason,
    "inside_home_required");
  assert.equal(housing.unpackSupplies({ atHome: true, inVehicle: true, homeId: home.id }).reason,
    "inside_home_required");

  const unpacked = housing.unpackSupplies({ atHome: true, homeId: home.id, sourceId: "unpack:weekly" });
  assert.equal(unpacked.accepted, true);
  assert.equal(unpacked.groceriesAdded, RESIDENTIAL_LIMITS.maxGroceries - pantryBefore);
  assert.equal(unpacked.groceries, RESIDENTIAL_LIMITS.maxGroceries);
  assert.equal(unpacked.carriedGroceries, 10 - unpacked.groceriesAdded,
    "overflow remains physically carried instead of disappearing");
  const afterPartial = housing.save();
  assert.equal(housing.unpackSupplies({ atHome: true, homeId: home.id, sourceId: "unpack:weekly" }).reason,
    "duplicate_source");
  assert.deepEqual(housing.save(), afterPartial);
  assert.equal(housing.unpackSupplies({ atHome: true, homeId: home.id, sourceId: "unpack:full" }).reason,
    "pantry_full");

  assert.equal(housing.perform("cook", {
    atHome: true,
    homeId: home.id,
    cash: 0,
    dayIndex: 1,
    sourceId: "make-pantry-space",
  }).accepted, true);
  const remainder = housing.unpackSupplies({ atHome: true, homeId: home.id, sourceId: "unpack:remainder" });
  assert.equal(remainder.accepted, true);
  assert.equal(remainder.groceriesAdded, 1);
  assert.equal(remainder.carriedGroceries, unpacked.carriedGroceries - 1);
  assertDeepFrozenFinite(housing.snapshot());
});

test("resident routines follow the authoritative clock, weekday work, seeded leisure, and overnight sleep", () => {
  const first = createResidentialLife({ seed: 740 });
  const second = createResidentialLife({ seed: 740 });
  const luisAtWork = first.residentState("luis_moreno", { dayIndex: 2, timeHours: 9 });
  assert.equal(luisAtWork.activity, "work");
  assert.equal(luisAtWork.locationId, "pulse_garage");
  assert.equal(luisAtWork.availableForVisit, false);

  const luisWeekend = first.scheduleForResident("luis_moreno", { dayIndex: 6, timeHours: 9 });
  assert.equal(luisWeekend.activity, "leisure");
  assert.ok(DEFAULT_RESIDENTIAL_RESIDENTS.find(value => value.id === "luis_moreno")
    .leisureLocations.includes(luisWeekend.locationId));
  assert.deepEqual(second.residentState("luis_moreno", { dayIndex: 6, timeHours: 9 }), luisWeekend);

  assert.equal(first.residentState("amara_chen", { dayIndex: 2, timeHours: 1 }).activity, "work");
  assert.equal(first.residentState("amara_chen", { dayIndex: 2, timeHours: 10 }).activity, "sleep");
  assert.equal(first.residentState("nia_okafor", { dayIndex: 2, timeHours: 13 }).activity, "work");
  assert.equal(first.residentState("missing", { timeHours: 12 }), null);
});

test("relationship and visitor hooks are source-idempotent, schedule-aware, and expire on world time", () => {
  const housing = createResidentialLife({ initialDayIndex: 2, initialMinuteOfDay: 18 * 60 });
  const helped = housing.recordResidentInteraction("luis_moreno", {
    kind: "help", dayIndex: 2, timeHours: 18, sourceId: "roadside-help-luis",
  });
  assert.equal(helped.accepted, true);
  assert.equal(helped.bondDelta, 8);
  assert.deepEqual(helped.skillEffects, [{ skillId: "community", experience: 6 }]);
  assert.equal(housing.relationshipHook("luis_moreno", {
    kind: "help", dayIndex: 2, timeHours: 18, sourceId: "roadside-help-luis",
  }).reason, "duplicate_source");

  const invitation = housing.inviteVisitor("luis_moreno", {
    atHome: true, dayIndex: 2, timeHours: 18, durationMinutes: 90, sourceId: "visit-luis-day-2",
  });
  assert.equal(invitation.accepted, true);
  assert.equal(invitation.durationMinutes, 90);
  assert.match(invitation.line, /Thanks for inviting me in/);
  assert.equal(housing.residentState("luis_moreno").activity, "visiting");
  assert.equal(housing.snapshot().visitor.remainingMinutes, 90);
  assert.equal(housing.inviteVisitor("nia_okafor", { atHome: true }).reason, "visitor_already_present");

  housing.update(0.25, { dayIndex: 2, timeHours: 19.6, captureSnapshot: false });
  assert.equal(housing.snapshot().visitor, null);
  assert.equal(housing.snapshot().lastEvent, "visitor_departed");
  assert.notEqual(housing.residentState("luis_moreno").activity, "visiting");

  const workTime = createResidentialLife({ initialDayIndex: 2, initialMinuteOfDay: 9 * 60 });
  assert.equal(workTime.inviteVisitor("luis_moreno", { atHome: true, dayIndex: 2, timeHours: 9 }).reason, "resident_work");
  workTime.recordResidentInteraction("luis_moreno", { kind: "conflict", sourceId: "argument" });
  for (let index = 0; index < 20; ++index) {
    workTime.recordResidentInteraction("luis_moreno", { kind: "conflict", sourceId: `argument-${index}` });
  }
  assert.equal(workTime.snapshot().residents.find(value => value.id === "luis_moreno").relationship.bond, -100);
  assert.equal(workTime.inviteVisitor("luis_moreno", { atHome: true, dayIndex: 6, timeHours: 18 }).reason, "relationship_too_low");
});

test("current saves restore bit-for-bit with home, pantry, relationship, visitor, and idempotency state", () => {
  const source = createResidentialLife({ seed: 740, initialDayIndex: 2, initialMinuteOfDay: 18 * 60 });
  source.perform("cook", {
    atHome: true, cash: 100, dayIndex: 2, needs: { energy: 45, hygiene: 65 }, sourceId: "saved-cook",
  });
  source.recordResidentInteraction("luis_moreno", {
    kind: "shared_meal", dayIndex: 2, timeHours: 18, sourceId: "saved-meal",
  });
  source.inviteVisitor("luis_moreno", {
    atHome: true, dayIndex: 2, timeHours: 18, durationMinutes: 120, sourceId: "saved-visit",
  });
  const saved = structuredClone(source.save());
  assert.equal(saved.version, RESIDENTIAL_LIFE_SAVE_VERSION);

  const restored = createResidentialLife({ seed: 1 });
  restored.restore(saved);
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.snapshot(), source.snapshot());
  assert.equal(restored.perform("cook", {
    atHome: true, cash: 100, dayIndex: 2, sourceId: "saved-cook",
  }).reason, "duplicate_source");
  assert.equal(restored.relationshipHook("luis_moreno", {
    kind: "shared_meal", sourceId: "saved-meal",
  }).reason, "duplicate_source");
  assert.equal(restored.snapshot().visitor.residentId, "luis_moreno");
});

test("version-one housing data migrates and hostile values sanitize into immutable finite state", () => {
  const housing = createResidentialLife();
  const migrated = housing.restore({
    version: 1,
    seed: 740,
    dayIndex: 9,
    minuteOfDay: 750,
    playerHomeId: "riverside_flat_6a",
    tenure: "owned",
    ownedHomes: ["southline_studio_3b", "riverside_flat_6a", "invented"],
    roomState: [{
      homeId: "riverside_flat_6a",
      groceries: 9,
      preparedMeals: 2,
      fixtures: [{ fixtureId: "bed", condition: 55, cleanliness: 60, useCount: 12 }],
    }],
    relationships: [{ id: "nia_okafor", bond: 27, familiarity: 4, interactions: 8 }],
  });
  assert.equal(migrated.player.currentHomeId, "riverside_flat_6a");
  assert.equal(migrated.player.tenure, "owned");
  assert.deepEqual(migrated.player.ownedHomeIds, ["southline_studio_3b", "riverside_flat_6a"]);
  assert.equal(migrated.homes.find(home => home.id === "riverside_flat_6a").groceries, 9);
  assert.equal(migrated.residents.find(value => value.id === "nia_okafor").relationship.bond, 27);
  assert.equal(migrated.player.carriedSupplies.groceries, 0);

  const versionTwo = housing.save();
  versionTwo.version = 2;
  versionTwo.player.carriedSupplies = { groceries: 7 };
  versionTwo.player.carriedGroceries = 7;
  assert.equal(housing.restore(versionTwo).player.carriedSupplies.groceries, 0,
    "pre-v3 saves always migrate with an empty carried bag");

  const hostileSave = housing.save();
  hostileSave.seed = Infinity;
  hostileSave.clock = { dayIndex: Infinity, minuteOfDay: -Infinity, previousMinuteOfDay: NaN };
  hostileSave.player = {
    currentHomeId: "not-real",
    tenure: "owned",
    ownedHomeIds: [null, "not-real", "southline_studio_3b", "southline_studio_3b"],
    depositHeld: Infinity,
    nextRentDueDay: -Infinity,
    outstandingRent: Infinity,
    carriedSupplies: { groceries: 999 },
  };
  hostileSave.homes = [{
    id: "southline_studio_3b",
    groceries: Infinity,
    preparedMeals: -Infinity,
    lastActivityDay: { sleep: Infinity },
    fixtures: [{ id: "bed", condition: Infinity, cleanliness: -Infinity, useCount: Infinity }],
  }];
  hostileSave.relationships = [{ residentId: "luis_moreno", bond: Infinity, familiarity: Infinity }];
  hostileSave.recordedSources = Array.from({ length: RESIDENTIAL_LIMITS.maxLedgerEntries + 10 }, (_, index) => `id-${index}`);
  const sanitized = housing.restore(hostileSave);
  assertDeepFrozenFinite(sanitized);
  assert.equal(sanitized.player.currentHomeId, null);
  assert.equal(sanitized.player.tenure, "none");
  assert.equal(sanitized.player.carriedSupplies.groceries, RESIDENTIAL_LIMITS.maxCarriedGroceries);
  assert.ok(sanitized.homes.every(home => home.groceries >= 0 && home.groceries <= RESIDENTIAL_LIMITS.maxGroceries));
  assert.ok(sanitized.homes.every(home => home.fixtures.every(fixture =>
    fixture.condition >= 0 && fixture.condition <= 100 && fixture.cleanliness >= 0 && fixture.cleanliness <= 100)));
  assert.throws(() => housing.restore({ version: RESIDENTIAL_LIFE_SAVE_VERSION + 1 }), /Unsupported residential life/);
  assert.throws(() => housing.restore({}), /Unsupported residential life/);
});

test("RAM-only prewarm covers every home activity and resident without changing live state", () => {
  const housing = createResidentialLife({ seed: 740 });
  housing.perform("cook", { atHome: true, cash: 100, dayIndex: 3, sourceId: "live-cook" });
  housing.recordResidentInteraction("nia_okafor", { kind: "talk", sourceId: "live-talk" });
  const before = housing.save();
  const bits = JSON.stringify(before);
  const prepared = housing.prewarm();
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.rendererResources, 0);
  assert.equal(prepared.diskResources, 0);
  assert.equal(prepared.homesPrepared, DEFAULT_RESIDENTIAL_HOMES.length);
  assert.equal(prepared.acquisitionsPrepared, 3);
  assert.equal(prepared.activitiesPrepared, RESIDENTIAL_HOME_ACTIONS.length);
  assert.equal(prepared.schedulesPrepared, DEFAULT_RESIDENTIAL_RESIDENTS.length * 2);
  assert.equal(prepared.relationshipsPrepared, DEFAULT_RESIDENTIAL_RESIDENTS.length);
  assert.equal(prepared.saveRestorePrepared, true);
  assert.equal(prepared.supplyReceiptsPrepared, 1);
  assert.equal(prepared.supplyUnpacksPrepared, 1);
  assert.equal(prepared.carriedSaveRestorePrepared, true);
  assert.equal(prepared.householdLoopPrepared, true);
  assert.equal(prepared.liveStatePreserved, true);
  assert.equal(JSON.stringify(housing.save()), bits);
  assert.deepEqual(housing.save(), before);
  assertDeepFrozenFinite(prepared);
});
