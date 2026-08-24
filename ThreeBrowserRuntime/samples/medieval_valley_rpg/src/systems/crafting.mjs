import { getItem, itemHasTag } from "./items.mjs";

export const RECIPES = deepFreeze({
  beacon_resin_bundle: recipe("beacon_resin_bundle", "Prepare Beacon Resin", "workbench",
    { pine_resin: 3, cloth: 1, seasoned_wood: 2 }, { beacon_resin_bundle: 1 }),
  beacon_iron_fittings: recipe("beacon_iron_fittings", "Forge Beacon Fittings", "forge",
    { iron_ingot: 3, charcoal: 2 }, { beacon_iron_fittings: 1 }),
  healing_draught: recipe("healing_draught", "Brew Redleaf Draught", "alchemy",
    { medicinal_herbs: 3, cloth: 1 }, { healing_draught: 1 }),
  stamina_tonic: recipe("stamina_tonic", "Brew Bitterroot Tonic", "alchemy",
    { medicinal_herbs: 2, pine_resin: 1 }, { stamina_tonic: 1 }),
  crossbow_bolts: recipe("crossbow_bolts", "Fletch Crossbow Bolts", "workbench",
    { iron_ingot: 1, seasoned_wood: 2 }, { crossbow_bolt: 10 }),
  smoke_bomb: recipe("smoke_bomb", "Bind Pitch Smoke Bomb", "workbench",
    { cloth: 1, charcoal: 2, pine_resin: 1 }, { smoke_bomb: 1 }),
  iron_greatsword: recipe("iron_greatsword", "Forge Iron Greatsword", "forge",
    { iron_ingot: 7, charcoal: 4, leather: 2 }, { iron_greatsword: 1 },
    { reputation: { faction: "village", minimum: 20 } }),
  hunting_crossbow: recipe("hunting_crossbow", "Build Hunter's Crossbow", "workbench",
    { seasoned_wood: 6, iron_ingot: 2, leather: 2 }, { hunting_crossbow: 1 },
    { world: { key: "wolfDenCleared", equals: true } }),
});

export class CraftingSystem {
  constructor({ inventory, progression = null, reputation = null, recipes = RECIPES } = {}) {
    if (!inventory) throw new TypeError("CraftingSystem requires an inventory");
    this.inventory = inventory;
    this.progression = progression;
    this.reputation = reputation;
    this.recipes = recipes;
    this._listeners = new Set();
  }

  recipe(id) {
    const definition = this.recipes[id];
    if (!definition) throw new RangeError(`unknown recipe: ${id}`);
    return definition;
  }

  canCraft(id, { times = 1, station = null } = {}) {
    const definition = this.recipe(id);
    times = positiveInteger(times, "times");
    const reasons = [];
    if (station != null && station !== definition.station) reasons.push(`requires_${definition.station}`);
    if (definition.unlock?.reputation &&
        (this.reputation?.get(definition.unlock.reputation.faction) ?? 0) < definition.unlock.reputation.minimum) {
      reasons.push("reputation_locked");
    }
    if (definition.unlock?.world &&
        this.progression?.get(definition.unlock.world.key) !== definition.unlock.world.equals) {
      reasons.push("world_locked");
    }
    for (const [itemId, quantity] of Object.entries(definition.inputs)) {
      if (this.inventory.availableCount(itemId) < quantity * times) reasons.push(`missing_${itemId}`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  craft(id, { times = 1, station = null } = {}) {
    const definition = this.recipe(id);
    times = positiveInteger(times, "times");
    const check = this.canCraft(id, { times, station });
    if (!check.ok) throw new RangeError(`cannot craft ${id}: ${check.reasons.join(", ")}`);
    const result = this.inventory.transaction(inventory => {
      for (const [itemId, quantity] of Object.entries(definition.inputs)) {
        inventory.remove(itemId, quantity * times, `craft:${id}`);
      }
      for (const [itemId, quantity] of Object.entries(definition.outputs)) {
        inventory.addExact(itemId, quantity * times, `craft:${id}`);
      }
      return {
        recipeId: id,
        times,
        consumed: multiplyQuantities(definition.inputs, times),
        produced: multiplyQuantities(definition.outputs, times),
      };
    });
    this._emit({ type: "craft", ...result });
    return result;
  }

  repair(slot, { station = null } = {}) {
    const equipped = this.inventory.equipped(slot);
    if (!equipped) throw new RangeError(`nothing equipped in ${slot}`);
    const definition = equipped.definition;
    const missing = equipped.maxDurability - equipped.durability;
    if (missing <= 0) return { slot, itemId: equipped.itemId, repaired: 0, consumed: {} };
    const metal = itemHasTag(definition, "metal");
    const requiredStation = metal ? "forge" : "workbench";
    if (station != null && station !== requiredStation) throw new RangeError(`repair requires ${requiredStation}`);
    const units = Math.max(1, Math.ceil(missing / equipped.maxDurability * 3));
    const material = metal ? "iron_ingot" : "leather";
    const consumed = { [material]: units };
    const result = this.inventory.transaction(inventory => {
      inventory.remove(material, units, `repair:${equipped.itemId}`);
      const repaired = inventory.repairEquipped(slot);
      return { slot, itemId: equipped.itemId, repaired, consumed };
    });
    this._emit({ type: "repair", ...result });
    return result;
  }

  upgrade(slot, { station = null, maxLevel = 3 } = {}) {
    const equipped = this.inventory.equipped(slot);
    if (!equipped) throw new RangeError(`nothing equipped in ${slot}`);
    if (equipped.upgradeLevel >= maxLevel) throw new RangeError(`${equipped.itemId} is fully upgraded`);
    const definition = equipped.definition;
    const metal = itemHasTag(definition, "metal");
    const requiredStation = metal ? "forge" : "workbench";
    if (station != null && station !== requiredStation) throw new RangeError(`upgrade requires ${requiredStation}`);
    const nextLevel = equipped.upgradeLevel + 1;
    const consumed = metal
      ? { iron_ingot: 1 + nextLevel * 2, charcoal: nextLevel, ...(nextLevel >= 3 ? { monster_fang: 1 } : {}) }
      : { leather: 1 + nextLevel * 2, cloth: nextLevel };
    const result = this.inventory.transaction(inventory => {
      for (const [itemId, quantity] of Object.entries(consumed)) {
        inventory.remove(itemId, quantity, `upgrade:${equipped.itemId}`);
      }
      const level = inventory.upgradeEquipped(slot, maxLevel);
      return { slot, itemId: equipped.itemId, level, consumed };
    });
    this._emit({ type: "upgrade", ...result });
    return result;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

function recipe(id, name, station, inputs, outputs, unlock = null) {
  for (const itemId of [...Object.keys(inputs), ...Object.keys(outputs)]) getItem(itemId);
  return { id, name, station, inputs, outputs, unlock };
}

function multiplyQuantities(values, multiplier) {
  return Object.fromEntries(Object.entries(values).map(([id, quantity]) => [id, quantity * multiplier]));
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
