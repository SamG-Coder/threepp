import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NEIGHBOURHOOD_BUSINESSES,
  NEIGHBOURHOOD_ROUTINE_SAVE_VERSION,
  PAY_FORWARD_ITEM,
  WEEKLY_GROCERY_BAG,
  createNeighbourhoodRoutine,
  createNeighbourhoodRoutineSystem,
  isBusinessOpen,
} from "../src/game/neighbourhood-routine.mjs";

test("four authored businesses have distinct people, fixed menus, and both kinds of opening hours", () => {
  assert.equal(DEFAULT_NEIGHBOURHOOD_BUSINESSES.length, 4);
  assert.equal(new Set(DEFAULT_NEIGHBOURHOOD_BUSINESSES.map(value => value.id)).size, 4);
  assert.equal(new Set(DEFAULT_NEIGHBOURHOOD_BUSINESSES.map(value => value.name)).size, 4);
  assert.equal(new Set(DEFAULT_NEIGHBOURHOOD_BUSINESSES.map(value => value.keeperName)).size, 4);
  assert.ok(DEFAULT_NEIGHBOURHOOD_BUSINESSES.some(value => value.openingHours.overnight));
  assert.ok(DEFAULT_NEIGHBOURHOOD_BUSINESSES.some(value => !value.openingHours.overnight));
  for (const definition of DEFAULT_NEIGHBOURHOOD_BUSINESSES) {
    assert.equal(definition.items.length, 3);
    assert.ok(definition.items.every(value => value.payForward === false));
    assert.ok(definition.position.every(Number.isFinite));
  }
  const market = DEFAULT_NEIGHBOURHOOD_BUSINESSES.find(value => value.id === "mina_market_kitchen");
  assert.deepEqual(market.householdItems, [WEEKLY_GROCERY_BAG]);
  assert.ok(DEFAULT_NEIGHBOURHOOD_BUSINESSES
    .filter(value => value !== market)
    .every(value => value.householdItems.length === 0));

  const daytime = DEFAULT_NEIGHBOURHOOD_BUSINESSES[0];
  const overnight = DEFAULT_NEIGHBOURHOOD_BUSINESSES.find(value => value.id === "harbour_lantern");
  assert.equal(isBusinessOpen(daytime, 8), true);
  assert.equal(isBusinessOpen(daytime, 22), false);
  assert.equal(isBusinessOpen(overnight, 23), true);
  assert.equal(isBusinessOpen(overnight, 2.5), true);
  assert.equal(isBusinessOpen(overnight, 12), false);
});

test("world positions override independently while nearby reports live opening state", () => {
  const override = Object.freeze([321, 1.25, -456]);
  const routine = createNeighbourhoodRoutineSystem({
    businessPositions: { common_ground_cafe: override },
  });
  assert.equal(createNeighbourhoodRoutineSystem, createNeighbourhoodRoutine);
  assert.deepEqual(routine.businesses[0].position, override);
  assert.notDeepEqual(DEFAULT_NEIGHBOURHOOD_BUSINESSES[0].position, override, "the authored default must stay immutable");

  const morning = routine.nearby([320, 0, -456], 4, { dayIndex: 2, timeHours: 8 });
  assert.equal(morning.id, "common_ground_cafe");
  assert.equal(morning.open, true);
  assert.ok(morning.distance < 2);
  const midnight = routine.nearby([320, 0, -456], { dayIndex: 2, timeHours: 0 });
  assert.equal(midnight.open, false);
  assert.equal(routine.nearby([0, 0, 0], 1, { timeHours: 8 }), null);
});

test("available business views are frozen and cached by their live opening mask", () => {
  const routine = createNeighbourhoodRoutine();
  const morning = routine.available({ dayIndex: 2, timeHours: 8 });
  const sameOpenMask = routine.available({ dayIndex: 9, timeHours: 12, weather: "RAIN" });

  assert.strictEqual(sameOpenMask, morning,
    "time and weather changes that leave every door unchanged must reuse one array");
  assert.equal(Object.isFrozen(morning), true);
  assert.ok(morning.every(business => Object.isFrozen(business)));
  assert.deepEqual(morning.filter(business => business.open).map(business => business.id), [
    "common_ground_cafe",
    "mina_market_kitchen",
  ]);

  const evening = routine.available({ dayIndex: 9, timeHours: 19 });
  assert.notStrictEqual(evening, morning, "a changed open mask must publish a different valid array");
  assert.equal(Object.isFrozen(evening), true);
  assert.ok(evening.every(business => Object.isFrozen(business)));
  assert.deepEqual(evening.filter(business => business.open).map(business => business.id), [
    "mina_market_kitchen",
    "harbour_lantern",
  ]);

  assert.strictEqual(routine.available({ timeHours: 10 }), morning,
    "returning to a known opening mask must reuse its original frozen publication");
});

test("capture-free neighbourhood updates reuse one accurate lightweight runtime view", () => {
  const routine = createNeighbourhoodRoutine({ initialAppetite: 43, appetiteDecayPerSecond: 1 });
  const first = routine.update(0, { dayIndex: 4, timeHours: 8, captureSnapshot: false });
  assert.deepEqual(Object.keys(first), ["menuOpen", "recoveryMultiplier"]);
  assert.equal(first.menuOpen, false);
  assert.equal(first.recoveryMultiplier, routine.snapshot().recoveryMultiplier);
  assert.equal(first.recoveryMultiplier, 1);

  const cafe = routine.businesses.find(business => business.id === "common_ground_cafe");
  routine.openMenu(cafe.id, { position: cafe.position, dayIndex: 4, timeHours: 8 });
  const second = routine.update(2, { dayIndex: 4, timeHours: 8, captureSnapshot: false });
  assert.strictEqual(second, first, "the fixed-step path must mutate and reuse its lightweight view");
  assert.equal(second.menuOpen, true);
  assert.equal(second.recoveryMultiplier, 0.92);
  assert.equal(second.recoveryMultiplier, routine.snapshot().recoveryMultiplier);

  routine.close();
  const third = routine.update(0, { dayIndex: 4, timeHours: 8, captureSnapshot: false });
  assert.strictEqual(third, first);
  assert.equal(third.menuOpen, false);
  assert.equal(third.recoveryMultiplier, routine.snapshot().recoveryMultiplier);
  assert.equal("appetite" in third, false, "the hot-path view must not grow back into a full snapshot");
});

test("menu navigation wraps and successful purchases are one-shot caller-owned transactions", () => {
  const routine = createNeighbourhoodRoutine({ initialAppetite: 35 });
  const business = routine.businesses[0];
  let state = routine.openMenu(business.id, { position: business.position, dayIndex: 4, timeHours: 8 });
  assert.equal(state.menuOpen, true);
  assert.equal(state.menuItems.length, 4);
  assert.equal(state.menuItems[3], PAY_FORWARD_ITEM);
  assert.equal(state.selectionIndex, 0);

  state = routine.moveSelection("up");
  assert.equal(state.selectionIndex, 3);
  state = routine.moveSelection("next");
  assert.equal(state.selectionIndex, 0);
  routine.moveSelection(2);
  const selected = routine.snapshot().selectedItem;

  const external = Object.freeze({
    cash: 999,
    inVehicle: false,
    player: Object.freeze({ health: 41, stamina: 23 }),
    dayIndex: 4,
    timeHours: 8,
  });
  const transaction = routine.purchase(external);
  assert.deepEqual(Object.keys(transaction), [
    "accepted", "serial", "businessId", "itemId", "cost", "heal", "stamina", "appetite", "line",
  ]);
  assert.equal(transaction.accepted, true);
  assert.equal(transaction.serial, 1);
  assert.equal(transaction.itemId, selected.id);
  assert.equal(transaction.cost, selected.cost);
  assert.equal(transaction.heal, selected.heal);
  assert.equal(transaction.stamina, selected.stamina);
  assert.equal(transaction.appetite, selected.appetite);
  assert.match(transaction.line, new RegExp(business.keeperName));
  assert.deepEqual(external.player, { health: 41, stamina: 23 }, "the routine must not mutate player state");
  assert.equal(external.cash, 999, "the routine must not subtract external cash");
  assert.equal(routine.snapshot().transactionSerial, 1);
  assert.equal("transaction" in routine.snapshot(), false, "snapshots must not replay a transaction");

  assert.equal(routine.purchase(external).reason, "still_consuming");
  routine.update(20, { dayIndex: 4, timeHours: 8 });
  routine.moveSelection(1);
  assert.equal(routine.purchase({ ...external, cash: 0 }).reason, "insufficient_cash");
  assert.equal(routine.purchase({ ...external, inVehicle: true }).reason, "on_foot_required");
  assert.equal(routine.snapshot().transactionSerial, 1, "rejections cannot consume a serial");
});

test("closed and distant businesses reject entry without corrupting an existing activity context", () => {
  const routine = createNeighbourhoodRoutine();
  const cafe = routine.businesses[0];
  const selectedActivity = Object.freeze({ id: "pulse_park_run", stage: "active", stopIndex: 2 });
  assert.equal(routine.open(cafe.id, {
    position: cafe.position,
    dayIndex: 1,
    timeHours: 23,
    selectedActivity,
  }).reason, "closed");
  assert.equal(routine.open(cafe.id, {
    position: [cafe.position[0] + 100, 0, cafe.position[2]],
    dayIndex: 1,
    timeHours: 8,
    selectedActivity,
  }).reason, "too_far");
  assert.equal(routine.open(cafe.id, {
    position: cafe.position,
    dayIndex: 1,
    timeHours: 8,
    inVehicle: true,
    selectedActivity,
  }).reason, "on_foot_required");
  assert.deepEqual(selectedActivity, { id: "pulse_park_run", stage: "active", stopIndex: 2 });
  assert.equal(routine.snapshot().menuOpen, false);
});

test("Mina keeps Pay Forward at index 3 and sells one non-consuming take-home grocery bag at index 4", () => {
  const routine = createNeighbourhoodRoutine({ initialAppetite: 35 });
  const market = routine.businesses.find(value => value.id === "mina_market_kitchen");
  let state = routine.openMenu(market.id, {
    position: market.position,
    dayIndex: 4,
    timeHours: 12,
  });
  assert.equal(state.menuItems.length, 5);
  assert.equal(state.menuItems[3], PAY_FORWARD_ITEM);
  assert.equal(state.menuItems[4].id, WEEKLY_GROCERY_BAG.id);
  assert.equal(state.menuItems[4].kind, "household_supplies");
  assert.deepEqual(state.menuItems[4].inventoryEffects, { groceries: 5 });

  // Leave a completed meal's consume record in place so the household sale
  // proves it does not rewrite either active or historical consumption state.
  assert.equal(routine.purchase({ cash: 100, dayIndex: 4, timeHours: 12 }).accepted, true);
  routine.update(10, { dayIndex: 4, timeHours: 12 });
  routine.moveSelection(4);
  const before = routine.snapshot();
  const consumeBefore = {
    consuming: before.consuming,
    consumeItemId: before.consumeItemId,
    consumeBusinessId: before.consumeBusinessId,
    consumeElapsed: before.consumeElapsed,
    consumeDuration: before.consumeDuration,
    consumeProgress: before.consumeProgress,
  };
  const transaction = routine.purchase({ cash: 100, dayIndex: 4, timeHours: 12 });
  const after = routine.snapshot();
  assert.deepEqual(transaction, {
    accepted: true,
    serial: 2,
    businessId: market.id,
    itemId: WEEKLY_GROCERY_BAG.id,
    kind: "household_supplies",
    inventoryEffects: { groceries: 5 },
    cost: 18,
    heal: 0,
    stamina: 0,
    appetite: 0,
    line: `${market.keeperName}: ${WEEKLY_GROCERY_BAG.purchaseLine}`,
  });
  assert.equal(after.appetite, before.appetite);
  assert.deepEqual({
    consuming: after.consuming,
    consumeItemId: after.consumeItemId,
    consumeBusinessId: after.consumeBusinessId,
    consumeElapsed: after.consumeElapsed,
    consumeDuration: after.consumeDuration,
    consumeProgress: after.consumeProgress,
  }, consumeBefore);
  assert.equal(after.lineReason, "household_purchase");
  assert.equal(after.lastEvent, "household_supplies_purchased");
  assert.equal(Object.isFrozen(transaction.inventoryEffects), true);
});

test("appetite decays gently, changes recovery rather than health, and food replenishes it", () => {
  const routine = createNeighbourhoodRoutine({ initialAppetite: 80, appetiteDecayPerSecond: 0.02 });
  const player = Object.freeze({ health: 37, stamina: 12 });
  const before = routine.snapshot();
  const after = routine.update(60, { timeHours: 8, dayIndex: 1, player });
  assert.ok(after.appetite < before.appetite);
  assert.ok(after.appetite > 78, "one minute should not empty the appetite meter");
  assert.equal(after.statusLabel, "WELL FED");
  assert.equal(after.appetiteStatus, "WELL FED");
  assert.equal(after.recoveryMultiplier, 1.08);
  assert.equal(player.health, 37, "low or decaying appetite can never inflict health damage");

  const hungrySave = { ...routine.save(), appetite: 5 };
  routine.restore(hungrySave);
  assert.equal(routine.snapshot().statusLabel, "HUNGRY");
  assert.equal(routine.snapshot().recoveryMultiplier, 0.82);
  routine.update(60, { timeHours: 8, dayIndex: 1, player });
  assert.ok(routine.snapshot().appetite >= 0);
  assert.equal(player.health, 37);

  const cafe = routine.businesses[0];
  routine.openMenu(cafe.id, { position: cafe.position, timeHours: 8, dayIndex: 1 });
  const appetiteBeforeFood = routine.snapshot().appetite;
  const bought = routine.purchase({ cash: 500, timeHours: 8, dayIndex: 1 });
  assert.equal(bought.accepted, true);
  assert.ok(routine.snapshot().appetite > appetiteBeforeFood);
  assert.ok(routine.snapshot().appetite <= 100);

  const beforeHomeMeal = routine.snapshot().appetite;
  const homeMeal = routine.applyAppetiteEffect(24);
  assert.equal(homeMeal.accepted, true);
  assert.equal(routine.snapshot().appetite, Math.min(100, beforeHomeMeal + 24));
  assert.equal(Object.isFrozen(homeMeal), true);
  const clamped = routine.applyAppetiteEffect(-500);
  assert.equal(clamped.value, 0, "household appetite effects remain bounded and non-lethal");
});

test("familiarity advances once per game day and keeper writing reacts deterministically", () => {
  const first = createNeighbourhoodRoutine();
  const second = createNeighbourhoodRoutine();
  const cafe = first.businesses[0];
  const morning = { position: cafe.position, dayIndex: 8, timeHours: 8, weather: "CLEAR" };
  const lineA = first.openMenu(cafe.id, morning).keeperLine;
  const lineB = second.openMenu(cafe.id, morning).keeperLine;
  assert.equal(lineA, lineB);
  assert.equal(first.snapshot().lineReason, "time_morning");
  assert.equal(first.snapshot().familiarity, 1);
  first.close();
  first.openMenu(cafe.id, morning);
  assert.equal(first.snapshot().familiarity, 1, "reopening cannot farm familiarity on the same day");
  first.close();
  first.openMenu(cafe.id, { ...morning, dayIndex: 9 });
  assert.equal(first.snapshot().familiarity, 2);

  first.close();
  let state = first.openMenu(cafe.id, { ...morning, dayIndex: 10, timeHours: 14, weather: "STORM" });
  assert.equal(state.lineReason, "weather_storm");
  assert.match(state.keeperLine, /thunder|storm/i);
  first.close();
  state = first.openMenu(cafe.id, { ...morning, dayIndex: 11, timeHours: 14, weather: "CLEAR", choiceResult: "publish" });
  assert.equal(state.lineReason, "story_publish");
  assert.match(state.keeperLine, /truth|danger/i);
});

test("paying a meal forward has no stat reward and earns one later-day acknowledgement", () => {
  const routine = createNeighbourhoodRoutine({ initialAppetite: 44 });
  const diner = routine.businesses.find(value => value.id === "southline_diner");
  routine.openMenu(diner.id, { position: diner.position, dayIndex: 20, timeHours: 23 });
  routine.moveSelection(-1);
  const appetiteBefore = routine.snapshot().appetite;
  const transaction = routine.purchase({ cash: 100, dayIndex: 20, timeHours: 23 });
  assert.equal(transaction.accepted, true);
  assert.equal(transaction.itemId, PAY_FORWARD_ITEM.id);
  assert.equal(transaction.cost, 18);
  assert.equal(transaction.heal, 0);
  assert.equal(transaction.stamina, 0);
  assert.equal(transaction.appetite, 0);
  assert.equal(routine.snapshot().appetite, appetiteBefore);
  assert.equal(routine.snapshot().lineReason, "pay_forward_purchase");
  routine.close();

  let reopened = routine.openMenu(diner.id, { position: diner.position, dayIndex: 20, timeHours: 23 });
  assert.notEqual(reopened.lineReason, "pay_forward_acknowledgement", "the acknowledgement cannot arrive on the purchase day");
  routine.close();
  reopened = routine.openMenu(diner.id, { position: diner.position, dayIndex: 21, timeHours: 23 });
  assert.equal(reopened.lineReason, "pay_forward_acknowledgement");
  assert.match(reopened.keeperLine, /reached someone|being seen/i);
  assert.equal(reopened.pendingPayForwards, 0);
  assert.equal(reopened.acknowledgedPayForwards, 1);
  routine.close();
  reopened = routine.openMenu(diner.id, { position: diner.position, dayIndex: 22, timeHours: 23 });
  assert.notEqual(reopened.lineReason, "pay_forward_acknowledgement", "an acknowledgement is one-shot");
});

test("mid-menu and mid-consume saves restore exactly and incompatible versions fail loudly", () => {
  const source = createNeighbourhoodRoutine({ initialAppetite: 31 });
  const restored = createNeighbourhoodRoutine({ initialAppetite: 99 });
  const market = source.businesses.find(value => value.id === "mina_market_kitchen");
  source.openMenu(market.id, {
    position: market.position,
    dayIndex: 33,
    timeHours: 12.5,
    weather: "RAIN",
    choiceResult: "protect",
  });
  source.moveSelection(1);
  const midMenu = source.save();
  restored.restore(structuredClone(midMenu));
  assert.deepEqual(restored.save(), midMenu);
  assert.deepEqual(restored.snapshot(), source.snapshot());

  source.purchase({ cash: 999, dayIndex: 33, timeHours: 12.5 });
  source.update(0.4375, { dayIndex: 33, timeHours: 12.5, selectedActivity: { id: "city_lens" } });
  assert.equal(source.snapshot().consuming, true);
  const midConsume = source.save();
  restored.restore(structuredClone(midConsume));
  assert.deepEqual(restored.save(), midConsume);
  assert.deepEqual(restored.snapshot(), source.snapshot());
  assert.throws(
    () => restored.restore({ ...midConsume, version: NEIGHBOURHOOD_ROUTINE_SAVE_VERSION + 1 }),
    /Unsupported neighbourhood routine save version/,
  );
});

test("RAM prewarm exercises menus, consumption and social acknowledgement bit-for-bit", () => {
  const routine = createNeighbourhoodRoutine();
  const cafe = routine.businesses[0];
  routine.openMenu(cafe.id, { position: cafe.position, dayIndex: 7, timeHours: 8, weather: "DRIZZLE" });
  routine.moveSelection(2);
  const before = routine.save();
  const beforeBits = JSON.stringify(before);
  const warmed = routine.prewarm();
  assert.deepEqual(warmed, {
    menusPrepared: 4,
    purchasePrepared: true,
    consumePrepared: true,
    acknowledgementPrepared: true,
    householdPurchasePrepared: true,
    storage: "memory-only",
  });
  assert.equal(JSON.stringify(routine.save()), beforeBits);
  assert.deepEqual(routine.save(), before);
});
