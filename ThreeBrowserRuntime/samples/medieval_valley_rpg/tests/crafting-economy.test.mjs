import test from "node:test";
import assert from "node:assert/strict";

import { CraftingSystem, RECIPES } from "../src/systems/crafting.mjs";
import { EconomySystem } from "../src/systems/economy.mjs";
import { Inventory } from "../src/systems/inventory.mjs";
import { ReputationSystem, WorldProgression } from "../src/systems/reputation.mjs";

test("recipes conserve inputs and outputs and roll back failed multi-output crafts", () => {
  const inventory = new Inventory({ maxSlots: 12, weightCapacity: 80 });
  inventory.addExact("pine_resin", 3);
  inventory.addExact("cloth", 1);
  inventory.addExact("seasoned_wood", 2);
  const crafting = new CraftingSystem({ inventory });
  const result = crafting.craft("beacon_resin_bundle", { station: "workbench" });
  assert.deepEqual(result.consumed, { pine_resin: 3, cloth: 1, seasoned_wood: 2 });
  assert.deepEqual(result.produced, { beacon_resin_bundle: 1 });
  assert.equal(inventory.count("pine_resin"), 0);
  assert.equal(inventory.count("beacon_resin_bundle"), 1);

  const tiny = new Inventory({ maxSlots: 1, weightCapacity: 30 });
  tiny.addExact("iron_ingot", 1);
  const custom = new CraftingSystem({
    inventory: tiny,
    recipes: {
      ...RECIPES,
      overflow: {
        id: "overflow", name: "Overflow", station: "forge",
        inputs: { iron_ingot: 1 }, outputs: { leather: 1, cloth: 1 }, unlock: null,
      },
    },
  });
  assert.throws(() => custom.craft("overflow", { station: "forge" }), /capacity/);
  assert.equal(tiny.count("iron_ingot"), 1, "failed craft restores every consumed input");
  assert.equal(tiny.count("leather"), 0);
  assert.equal(tiny.count("cloth"), 0);
});

test("repair and upgrade consume materials and alter combat-relevant equipment stats", () => {
  const inventory = new Inventory({ maxSlots: 20, weightCapacity: 100 });
  inventory.addExact("village_sword", 1);
  inventory.addExact("iron_ingot", 12);
  inventory.addExact("charcoal", 4);
  inventory.equip("village_sword");
  const crafting = new CraftingSystem({ inventory });

  inventory.damageDurability("mainHand", 60);
  const damaged = inventory.attackProfile().damage;
  const ingotsBeforeRepair = inventory.count("iron_ingot");
  const repair = crafting.repair("mainHand", { station: "forge" });
  assert.equal(repair.repaired, 60);
  assert.ok(inventory.count("iron_ingot") < ingotsBeforeRepair);
  assert.ok(inventory.attackProfile().damage > damaged);

  const beforeUpgrade = inventory.attackProfile().damage;
  const upgrade = crafting.upgrade("mainHand", { station: "forge" });
  assert.equal(upgrade.level, 1);
  assert.ok(inventory.attackProfile().damage > beforeUpgrade);
  assert.equal(inventory.equipped("mainHand").upgradeLevel, 1);
});

test("economy conserves stock and currency, discounts reputation, and restocks", () => {
  const inventory = new Inventory({ maxSlots: 30, weightCapacity: 120 });
  const progression = new WorldProgression();
  const reputation = new ReputationSystem();
  const economy = new EconomySystem({ inventory, progression, reputation, startingGold: 1000, seed: 77 });

  const priceBefore = economy.quote("blacksmith", "iron_ingot");
  const merchantBefore = economy.merchant("blacksmith");
  const playerBefore = economy.gold;
  const buy = economy.buy("blacksmith", "iron_ingot", 2);
  const merchantAfterBuy = economy.merchant("blacksmith");
  assert.equal(economy.gold, playerBefore - buy.total);
  assert.equal(merchantAfterBuy.gold, merchantBefore.gold + buy.total);
  assert.equal(merchantAfterBuy.stock.iron_ingot, merchantBefore.stock.iron_ingot - 2);
  assert.equal(inventory.count("iron_ingot"), 2);

  const sell = economy.sell("blacksmith", "iron_ingot", 1);
  assert.equal(inventory.count("iron_ingot"), 1);
  assert.equal(economy.gold, playerBefore - buy.total + sell.total);
  assert.equal(economy.merchant("blacksmith").gold, merchantAfterBuy.gold - sell.total);

  reputation.set("village", 80);
  progression.set("merchantRouteOpen", true);
  progression.set("merchantStockTier", 1);
  const priceAfter = economy.quote("blacksmith", "iron_ingot");
  assert.ok(priceAfter < priceBefore);
  const tradeStock = economy.merchant("merchant_elin").stock;
  assert.ok(tradeStock.crossbow_bolt > 0);
  assert.ok(tradeStock.hunting_crossbow > 0);

  const beforeRestock = economy.merchant("blacksmith").stock.iron_ingot;
  const restocks = economy.advance(1440);
  assert.ok(restocks.some(entry => entry.merchantId === "blacksmith"));
  assert.ok(economy.merchant("blacksmith").stock.iron_ingot >= beforeRestock);
});

test("merchants retain player-supplied goods, including across snapshots", () => {
  const inventory = new Inventory({ maxSlots: 12, weightCapacity: 80 });
  inventory.addExact("monster_fang", 3);
  inventory.addExact("warden_sigil", 1);
  const economy = new EconomySystem({ inventory, startingGold: 40, seed: 191 });
  assert.throws(() => economy.sell("herbalist", "warden_sigil"), /not tradeable/);
  assert.equal(inventory.count("warden_sigil"), 1);
  const beforeTotal = inventory.count("monster_fang") + (economy.merchant("herbalist").stock.monster_fang ?? 0);
  economy.sell("herbalist", "monster_fang", 2);
  const afterTotal = inventory.count("monster_fang") + economy.merchant("herbalist").stock.monster_fang;
  assert.equal(afterTotal, beforeTotal);

  const saved = economy.snapshot();
  const restoredInventory = new Inventory();
  const restored = new EconomySystem({ inventory: restoredInventory, seed: 1 }).restore(saved);
  assert.equal(restored.merchant("herbalist").stock.monster_fang, 2);
  restored.buy("herbalist", "monster_fang", 1);
  assert.equal(restoredInventory.count("monster_fang"), 1);
  assert.equal(restored.merchant("herbalist").stock.monster_fang, 1);
});

test("recipe unlocks respond to reputation and restored-road progression", () => {
  const inventory = new Inventory({ maxSlots: 30, weightCapacity: 120 });
  const progression = new WorldProgression();
  const reputation = new ReputationSystem();
  for (const [itemId, quantity] of Object.entries({ seasoned_wood: 6, iron_ingot: 7, leather: 2, charcoal: 4 })) {
    inventory.addExact(itemId, quantity);
  }
  const crafting = new CraftingSystem({ inventory, progression, reputation });
  assert.ok(crafting.canCraft("hunting_crossbow", { station: "workbench" }).reasons.includes("world_locked"));
  progression.set("wolfDenCleared", true);
  assert.equal(crafting.canCraft("hunting_crossbow", { station: "workbench" }).ok, true);
  assert.ok(crafting.canCraft("iron_greatsword", { station: "forge" }).reasons.includes("reputation_locked"));
  reputation.set("village", 20);
  assert.equal(crafting.canCraft("iron_greatsword", { station: "forge" }).ok, true);
});
