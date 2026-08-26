import assert from "node:assert/strict";
import test from "node:test";
import {
  PAY_FORWARD_ITEM,
  WEEKLY_GROCERY_BAG,
  createNeighbourhoodRoutine,
} from "../src/game/neighbourhood-routine.mjs";
import { createResidentialLife } from "../src/game/residential-life.mjs";

test("a Mina purchase remains carried through save/restore before unpacking, cooking, and eating at home", () => {
  const routine = createNeighbourhoodRoutine({ initialAppetite: 32 });
  const housing = createResidentialLife();
  const market = routine.businesses.find(value => value.id === "mina_market_kitchen");
  const home = housing.snapshot().homes.find(value => value.playerResidence);
  let cash = 60;

  const menu = routine.openMenu(market.id, {
    position: market.position,
    dayIndex: 6,
    timeHours: 12,
  });
  assert.equal(menu.menuItems[3], PAY_FORWARD_ITEM);
  assert.deepEqual(menu.menuItems[4], WEEKLY_GROCERY_BAG);
  routine.moveSelection(4);

  const appetiteBefore = routine.snapshot().appetite;
  const pantryBefore = home.groceries;
  const quote = housing.quoteSupplyReceipt(routine.snapshot().selectedItem.inventoryEffects);
  assert.equal(quote.accepted, true);
  const purchase = routine.purchase({ cash, dayIndex: 6, timeHours: 12 });
  assert.equal(purchase.accepted, true);
  assert.equal(purchase.kind, "household_supplies");
  assert.deepEqual(purchase.inventoryEffects, { groceries: 5 });
  assert.equal(routine.snapshot().appetite, appetiteBefore);
  assert.equal(routine.snapshot().consuming, false);
  cash -= purchase.cost;
  assert.equal(cash, 42, "cash is charged exactly once by the integration owner");

  const sourceId = `neighbourhood:${purchase.businessId}:${purchase.serial}`;
  const received = housing.receiveSupplies(purchase.inventoryEffects, { sourceId });
  assert.equal(received.accepted, true);
  assert.equal(housing.snapshot().player.carriedSupplies.groceries, 5);
  assert.equal(housing.snapshot().homes.find(value => value.playerResidence).groceries, pantryBefore);

  const routineSave = structuredClone(routine.save());
  const housingSave = structuredClone(housing.save());
  const restoredRoutine = createNeighbourhoodRoutine();
  const restoredHousing = createResidentialLife();
  restoredRoutine.restore(routineSave);
  restoredHousing.restore(housingSave);
  assert.deepEqual(restoredRoutine.save(), routineSave);
  assert.deepEqual(restoredHousing.save(), housingSave);
  assert.equal(restoredHousing.receiveSupplies(purchase.inventoryEffects, { sourceId }).reason,
    "duplicate_source");
  assert.equal(restoredHousing.snapshot().player.carriedSupplies.groceries, 5);
  assert.equal(cash, 42, "a restored receipt replay cannot charge or mint supplies");

  const unpacked = restoredHousing.unpackSupplies({
    atHome: true,
    homeId: home.id,
    sourceId: `${sourceId}:unpack`,
  });
  assert.equal(unpacked.accepted, true);
  assert.equal(unpacked.groceriesAdded, 5);
  assert.equal(unpacked.carriedGroceries, 0);
  assert.equal(restoredHousing.snapshot().homes.find(value => value.playerResidence).groceries,
    pantryBefore + 5);

  const cooked = restoredHousing.perform("cook", {
    atHome: true,
    homeId: home.id,
    cash,
    dayIndex: 6,
    needs: { energy: 50, hygiene: 50, appetite: appetiteBefore },
    sourceId: `${sourceId}:cook`,
  });
  assert.equal(cooked.accepted, true);
  assert.deepEqual(cooked.effects.skills, [{ skillId: "hospitality", experience: 12 }]);
  const afterCook = restoredHousing.snapshot().homes.find(value => value.playerResidence);
  assert.equal(afterCook.groceries, pantryBefore + 4);
  assert.equal(afterCook.preparedMeals, home.preparedMeals + 2);

  const ate = restoredHousing.perform("eat", {
    atHome: true,
    homeId: home.id,
    cash,
    dayIndex: 6,
    needs: { energy: 50, hygiene: 50, appetite: appetiteBefore },
    sourceId: `${sourceId}:eat`,
  });
  assert.equal(ate.accepted, true);
  assert.equal(ate.effects.appetite, 34);
  assert.equal(ate.effects.energy, 28);
  assert.equal(restoredHousing.snapshot().homes.find(value => value.playerResidence).preparedMeals,
    home.preparedMeals + 1);
  const appetiteApplied = restoredRoutine.applyAppetiteEffect(ate.effects.appetite);
  assert.equal(appetiteApplied.accepted, true);
  assert.equal(appetiteApplied.appetite, 34);
  assert.equal(appetiteApplied.value, appetiteBefore + 34,
    "the caller routes the home meal into the existing appetite owner exactly once");
});
