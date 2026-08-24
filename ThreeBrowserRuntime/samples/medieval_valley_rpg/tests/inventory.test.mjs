import test from "node:test";
import assert from "node:assert/strict";

import { Inventory } from "../src/systems/inventory.mjs";
import { getItem } from "../src/systems/items.mjs";
import { createSeededRng } from "../src/systems/rng.mjs";

test("seeded RNG is deterministic, restorable and forkable", () => {
  const left = createSeededRng("valley-seed");
  const right = createSeededRng("valley-seed");
  assert.deepEqual(
    Array.from({ length: 16 }, () => left.nextUint32()),
    Array.from({ length: 16 }, () => right.nextUint32()),
  );

  const snapshot = left.snapshot();
  const expected = [left.next(), left.int(2, 8), left.pick(["rain", "fog", "clear"])];
  left.restore(snapshot);
  assert.deepEqual([left.next(), left.int(2, 8), left.pick(["rain", "fog", "clear"])], expected);
  const forkLeft = createSeededRng("fork-source");
  const forkRight = createSeededRng("fork-source");
  assert.deepEqual(forkLeft.fork("wolves").shuffle([1, 2, 3, 4]), forkRight.fork("wolves").shuffle([1, 2, 3, 4]));
});

test("item catalogue exposes each playable equipment family and functional supplies", () => {
  assert.equal(getItem("village_sword").stats.twoHanded, false);
  assert.equal(getItem("iron_shield").equipmentSlot, "offHand");
  assert.equal(getItem("iron_greatsword").stats.twoHanded, true);
  assert.equal(getItem("hunting_crossbow").stats.projectile, "crossbow_bolt");
  assert.equal(getItem("mail_hauberk").type, "armour");
  assert.ok(getItem("healing_draught").effect.health > 0);
  assert.equal(getItem("beacon_resin_bundle").rarity, "quest");
  assert.ok(getItem("pine_resin").tags.includes("crafting"));
});

test("inventory conserves quantities across stacks, capacity and equipped locks", () => {
  const inventory = new Inventory({ maxSlots: 4, weightCapacity: 12 });
  const herbs = inventory.add("medicinal_herbs", 35);
  assert.deepEqual(herbs, { itemId: "medicinal_herbs", requested: 35, added: 35, rejected: 0 });
  assert.equal(inventory.stacks.length, 2);
  assert.equal(inventory.count("medicinal_herbs"), 35);
  assert.equal(inventory.has("medicinal_herbs", 35), true);
  assert.equal(inventory.has("medicinal_herbs", 36), false);

  inventory.addExact("village_sword", 1);
  inventory.equip("village_sword");
  assert.throws(() => inventory.remove("village_sword", 1), /not enough unequipped/);
  inventory.unequip("mainHand");
  inventory.remove("village_sword", 1);
  assert.equal(inventory.count("village_sword"), 0);

  const before = inventory.count("iron_ingot");
  const limited = inventory.add("iron_ingot", 20);
  assert.equal(limited.added + limited.rejected, 20);
  assert.equal(inventory.count("iron_ingot"), before + limited.added);
  assert.ok(inventory.totalWeight <= inventory.weightCapacity);
});

test("equipment materially changes attack, blocking, poise and encumbrance", () => {
  const inventory = new Inventory({ maxSlots: 20, weightCapacity: 65 });
  for (const itemId of ["village_sword", "iron_shield", "iron_greatsword", "hunting_crossbow", "leather_jerkin", "mail_hauberk"]) {
    inventory.addExact(itemId, 1);
  }

  const unarmed = inventory.attackProfile();
  inventory.equip("village_sword");
  inventory.equip("iron_shield");
  inventory.equip("leather_jerkin");
  const sword = inventory.attackProfile();
  const swordStats = inventory.derivedStats();
  assert.ok(sword.damage > unarmed.damage);
  assert.ok(swordStats.blockReduction >= 0.6);
  assert.ok(swordStats.defense >= 12);

  inventory.equip("iron_greatsword");
  assert.equal(inventory.equipped("offHand"), null, "a two-handed weapon must clear the shield");
  const greatsword = inventory.attackProfile();
  assert.ok(greatsword.damage > sword.damage);
  assert.ok(greatsword.staminaCost > sword.staminaCost);
  assert.ok(greatsword.windup > sword.windup);
  assert.ok(greatsword.poiseDamage > sword.poiseDamage);

  inventory.equip("hunting_crossbow");
  const crossbow = inventory.attackProfile();
  assert.equal(crossbow.kind, "ranged");
  assert.equal(crossbow.projectile, "crossbow_bolt");
  assert.equal(crossbow.twoHanded, true);
  assert.ok(crossbow.range > greatsword.range);

  const lightStamina = inventory.derivedStats().stamina;
  inventory.equip("mail_hauberk");
  const mailStats = inventory.derivedStats();
  assert.ok(mailStats.defense > swordStats.defense);
  assert.ok(mailStats.poise > swordStats.poise);
  assert.ok(mailStats.stamina < lightStamina);

  const pristineDamage = inventory.attackProfile().damage;
  inventory.damageDurability("mainHand", 120);
  assert.ok(inventory.attackProfile().damage < pristineDamage);
});

test("consumables are functional and snapshots restore exact state", () => {
  const inventory = new Inventory();
  inventory.addExact("healing_draught", 2);
  const before = inventory.snapshot();
  const effect = inventory.consume("healing_draught");
  assert.equal(effect.health, 45);
  assert.equal(inventory.count("healing_draught"), 1);
  inventory.restore(before);
  assert.equal(inventory.count("healing_draught"), 2);
});
