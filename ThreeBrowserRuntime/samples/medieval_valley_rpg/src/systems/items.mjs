const rawItems = [
  weapon("village_sword", "Village Arming Sword", "A balanced iron blade issued to the valley watch.", 12, {
    value: 72, weight: 3.1, speed: 1, staminaCost: 16, poiseDamage: 8, range: 1.75,
    windup: 0.22, active: 0.14, recovery: 0.34, worldModel: "models/items/village-sword.glb",
  }),
  weapon("warden_blade", "Warden's Black Blade", "A dark fortress blade made serviceable at the village forge.", 18, {
    value: 230, weight: 3.8, rarity: "rare", speed: 0.92, staminaCost: 19, poiseDamage: 12,
    range: 1.9, windup: 0.28, active: 0.16, recovery: 0.39,
    worldModel: "models/items/warden-blade.glb",
  }),
  weapon("iron_greatsword", "Iron Greatsword", "A two-handed blade that trades speed for reach and stagger.", 24, {
    value: 138, weight: 7.6, rarity: "uncommon", speed: 0.68, staminaCost: 29, poiseDamage: 23,
    range: 2.25, windup: 0.48, active: 0.21, recovery: 0.62, twoHanded: true,
    tags: ["weapon", "melee", "two-handed", "metal"], worldModel: "models/items/iron-greatsword.glb",
  }),
  weapon("hunting_crossbow", "Hunter's Crossbow", "A slow mechanical bow with strong ranged impact.", 19, {
    value: 126, weight: 4.9, rarity: "uncommon", speed: 0.55, staminaCost: 20, poiseDamage: 14,
    range: 38, windup: 0.36, active: 0.08, recovery: 0.82, twoHanded: true,
    projectile: "crossbow_bolt", tags: ["weapon", "ranged", "two-handed", "wood"],
    worldModel: "models/items/hunting-crossbow.glb",
  }),
  item("iron_shield", "Iron-Rimmed Shield", "Oak planks bound with an iron rim.", "shield", {
    description: "Oak planks bound with an iron rim.", maxStack: 1, weight: 5.2, value: 84,
    equipmentSlot: "offHand", worldModel: "models/items/iron-shield.glb",
    stats: { defense: 4, blockReduction: 0.62, stability: 18, poise: 7 },
    tags: ["shield", "wood", "metal"], durability: 110,
  }),
  item("leather_jerkin", "Waxed Leather Jerkin", "Layered leather that stays supple in rain.", "armour", {
    maxStack: 1, weight: 4.2, value: 68, equipmentSlot: "body",
    worldModel: "models/items/leather-jerkin.glb", stats: { defense: 8, poise: 4, stamina: 6 },
    tags: ["armour", "leather", "light"], durability: 90,
  }),
  item("mail_hauberk", "Village Mail Hauberk", "Riveted mail over a padded wool coat.", "armour", {
    maxStack: 1, weight: 10.8, value: 180, rarity: "uncommon", equipmentSlot: "body",
    worldModel: "models/items/mail-hauberk.glb", stats: { defense: 17, poise: 13, stamina: -5 },
    tags: ["armour", "metal", "medium"], durability: 150,
  }),
  item("warden_plate", "Warden Plate", "Corroded fortress plate reclaimed from the Warden.", "armour", {
    maxStack: 1, weight: 15.5, value: 330, rarity: "rare", equipmentSlot: "body",
    worldModel: "models/items/warden-plate.glb", stats: { defense: 27, poise: 24, stamina: -12 },
    tags: ["armour", "metal", "heavy"], durability: 190,
  }),
  item("leather_gloves", "Leather Work Gloves", "Forge-safe gloves with reinforced palms.", "armour", {
    maxStack: 1, weight: 0.7, value: 24, equipmentSlot: "hands",
    worldModel: "models/items/leather-gloves.glb", stats: { defense: 2, stamina: 2 },
    tags: ["armour", "leather", "light"], durability: 55,
  }),
  item("trail_boots", "Hobnailed Trail Boots", "Stout boots made for the fortress road.", "armour", {
    maxStack: 1, weight: 1.8, value: 42, equipmentSlot: "feet",
    worldModel: "models/items/trail-boots.glb", stats: { defense: 3, stamina: 4, moveSpeed: 0.03 },
    tags: ["armour", "leather", "light"], durability: 75,
  }),
  consumable("healing_draught", "Redleaf Draught", "Restores health over a short interval.", 42, {
    value: 28, effect: { health: 45 }, worldModel: "models/items/redleaf-draught.glb",
  }),
  consumable("stamina_tonic", "Bitterroot Tonic", "Restores stamina and briefly improves recovery.", 32, {
    value: 24, effect: { stamina: 55, staminaRecoveryMultiplier: 1.2, duration: 20 },
    worldModel: "models/items/bitterroot-tonic.glb",
  }),
  consumable("smoke_bomb", "Pitch Smoke Bomb", "Breaks enemy sight for several seconds.", 8, {
    value: 38, rarity: "uncommon", effect: { concealment: 7 }, worldModel: "models/items/smoke-bomb.glb",
  }),
  material("iron_ingot", "Iron Ingot", "A workable bar of local iron.", 18, 1.8, 14, ["metal"]),
  material("leather", "Cured Leather", "Tanned hide for armour and repairs.", 24, 0.55, 10, ["leather"]),
  material("seasoned_wood", "Seasoned Wood", "Dry ash and yew suitable for tools and weapons.", 24, 0.8, 8, ["wood"]),
  material("cloth", "Wool Cloth", "Dense village-woven cloth.", 32, 0.2, 5, ["cloth"]),
  material("medicinal_herbs", "Medicinal Herbs", "Redleaf, comfrey and bitterroot.", 32, 0.1, 7, ["herb"]),
  material("pine_resin", "Pine Resin", "Sticky forest resin that burns hot even in damp air.", 16, 0.35, 12, ["resin", "flammable"]),
  material("charcoal", "Forge Charcoal", "Clean-burning charcoal from the mill kiln.", 24, 0.45, 6, ["fuel"]),
  material("monster_fang", "Corrupted Fang", "A fang carrying a trace of cold corruption.", 20, 0.15, 16, ["monster-part"]),
  material("crossbow_bolt", "Crossbow Bolt", "A short ash bolt with an iron head.", 40, 0.08, 2, ["ammunition", "metal", "wood"]),
  item("beacon_resin_bundle", "Beacon Resin Bundle", "Resin, cloth and kindling prepared for the beacon.", "quest", {
    maxStack: 1, weight: 2.2, value: 0, rarity: "quest", worldModel: "models/items/beacon-resin.glb",
    tags: ["quest", "resin", "flammable"],
  }),
  item("beacon_iron_fittings", "Beacon Iron Fittings", "Brackets and a new wind guard forged for the beacon.", "quest", {
    maxStack: 1, weight: 4.5, value: 0, rarity: "quest", worldModel: "models/items/beacon-fittings.glb",
    tags: ["quest", "metal"],
  }),
  item("warden_sigil", "Warden's Sigil", "Proof that the source of the corruption was defeated.", "quest", {
    maxStack: 1, weight: 0.1, value: 0, rarity: "quest", worldModel: "models/items/warden-sigil.glb",
    tags: ["quest", "boss-loot"],
  }),
];

export const ITEMS = deepFreeze(Object.fromEntries(rawItems.map(definition => [definition.id, definition])));

export function getItem(id) {
  const definition = ITEMS[id];
  if (!definition) throw new RangeError(`unknown item: ${id}`);
  return definition;
}

export function findItems(predicate) {
  return Object.values(ITEMS).filter(predicate);
}

export function itemHasTag(itemOrId, tag) {
  const definition = typeof itemOrId === "string" ? getItem(itemOrId) : itemOrId;
  return definition.tags.includes(tag);
}

function weapon(id, name, description, attack, options) {
  return item(id, name, description, "weapon", {
    maxStack: 1,
    weight: options.weight,
    value: options.value,
    rarity: options.rarity,
    equipmentSlot: "mainHand",
    worldModel: options.worldModel,
    durability: options.durability ?? 120,
    tags: options.tags ?? ["weapon", "melee", "one-handed", "metal"],
    stats: {
      attack,
      speed: options.speed,
      staminaCost: options.staminaCost,
      poiseDamage: options.poiseDamage,
      range: options.range,
      windup: options.windup,
      active: options.active,
      recovery: options.recovery,
      twoHanded: Boolean(options.twoHanded),
      projectile: options.projectile ?? null,
    },
  });
}

function consumable(id, name, description, maxStack, options) {
  return item(id, name, description, "consumable", {
    maxStack,
    weight: options.weight ?? 0.3,
    value: options.value,
    rarity: options.rarity,
    effect: options.effect,
    worldModel: options.worldModel,
    tags: ["consumable"],
  });
}

function material(id, name, description, maxStack, weight, value, tags) {
  return item(id, name, description, "material", {
    maxStack, weight, value, tags: ["crafting", ...tags], worldModel: `models/items/${id}.glb`,
  });
}

function item(id, name, description, type, options = {}) {
  if (!id || !name || !type) throw new TypeError("item definitions require id, name and type");
  return {
    id,
    name,
    type,
    description: options.description ?? description,
    maxStack: options.maxStack ?? 1,
    weight: options.weight ?? 0,
    value: options.value ?? 0,
    rarity: options.rarity ?? "common",
    stats: options.stats ?? {},
    effect: options.effect ?? null,
    worldModel: options.worldModel ?? null,
    equipmentSlot: options.equipmentSlot ?? null,
    durability: options.durability ?? null,
    tags: [...new Set(options.tags ?? [type])],
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
