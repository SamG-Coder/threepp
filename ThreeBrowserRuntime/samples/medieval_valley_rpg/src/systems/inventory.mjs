import { getItem } from "./items.mjs";

const DEFAULT_BASE_STATS = Object.freeze({
  health: 100,
  stamina: 100,
  attack: 5,
  defense: 0,
  poise: 10,
  stability: 0,
  moveSpeed: 1,
  blockReduction: 0,
});

const SCALAR_EQUIPMENT_STATS = new Set([
  "health", "stamina", "attack", "defense", "poise", "stability", "moveSpeed",
]);

/**
 * Stack-based inventory with atomic transactions and equipment-derived combat
 * stats. Equipped objects remain in the owned stacks and are locked against
 * removal until unequipped.
 */
export class Inventory {
  constructor({ maxSlots = 32, weightCapacity = 65, baseStats = {}, itemResolver = getItem } = {}) {
    if (!Number.isInteger(maxSlots) || maxSlots <= 0) throw new RangeError("maxSlots must be a positive integer");
    if (!Number.isFinite(weightCapacity) || weightCapacity <= 0) throw new RangeError("weightCapacity must be positive");
    this.maxSlots = maxSlots;
    this.weightCapacity = weightCapacity;
    this.baseStats = { ...DEFAULT_BASE_STATS, ...baseStats };
    this._resolve = itemResolver;
    this._stacks = [];
    this._equipment = new Map();
    this._listeners = new Set();
  }

  get stacks() {
    return this._stacks.map(stack => ({ ...stack }));
  }

  get equipment() {
    return Object.fromEntries([...this._equipment].map(([slot, value]) => [slot, { ...value }]));
  }

  get usedSlots() {
    return this._stacks.length;
  }

  get totalWeight() {
    return round(this._stacks.reduce((sum, stack) => sum + this._resolve(stack.itemId).weight * stack.quantity, 0));
  }

  get remainingWeight() {
    return Math.max(0, round(this.weightCapacity - this.totalWeight));
  }

  count(itemId) {
    this._resolve(itemId);
    return this._stacks.reduce((sum, stack) => sum + (stack.itemId === itemId ? stack.quantity : 0), 0);
  }

  /** Common dialogue/condition convenience; equipped items still count as owned. */
  has(itemId, quantity = 1) {
    return this.count(itemId) >= validateQuantity(quantity);
  }

  availableCount(itemId) {
    return this.count(itemId) - this._equippedCount(itemId);
  }

  canAdd(itemId, quantity = 1) {
    const result = this._additionCapacity(itemId);
    return validateQuantity(quantity) <= result;
  }

  add(itemId, quantity = 1, reason = "add") {
    const requested = validateQuantity(quantity);
    const definition = this._resolve(itemId);
    const added = Math.min(requested, this._additionCapacity(itemId));
    let remaining = added;
    for (const stack of this._stacks) {
      if (remaining <= 0) break;
      if (stack.itemId !== itemId || stack.quantity >= definition.maxStack) continue;
      const amount = Math.min(remaining, definition.maxStack - stack.quantity);
      stack.quantity += amount;
      remaining -= amount;
    }
    while (remaining > 0) {
      const amount = Math.min(remaining, definition.maxStack);
      this._stacks.push({ itemId, quantity: amount });
      remaining -= amount;
    }
    if (added > 0) this._emit({ type: "inventory:add", itemId, quantity: added, reason });
    return { itemId, requested, added, rejected: requested - added };
  }

  addExact(itemId, quantity = 1, reason = "add") {
    const before = this.snapshot();
    const result = this.add(itemId, quantity, reason);
    if (result.rejected > 0) {
      this.restore(before, { silent: true });
      throw new RangeError(`not enough inventory capacity for ${quantity} ${itemId}`);
    }
    return result;
  }

  remove(itemId, quantity = 1, reason = "remove") {
    const requested = validateQuantity(quantity);
    if (this.availableCount(itemId) < requested) {
      throw new RangeError(`not enough unequipped ${itemId}`);
    }
    let remaining = requested;
    for (let index = this._stacks.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const stack = this._stacks[index];
      if (stack.itemId !== itemId) continue;
      const amount = Math.min(remaining, stack.quantity);
      stack.quantity -= amount;
      remaining -= amount;
      if (stack.quantity === 0) this._stacks.splice(index, 1);
    }
    this._emit({ type: "inventory:remove", itemId, quantity: requested, reason });
    return requested;
  }

  equip(itemId, requestedSlot = null) {
    const definition = this._resolve(itemId);
    const slot = requestedSlot ?? definition.equipmentSlot;
    if (!definition.equipmentSlot || slot !== definition.equipmentSlot) {
      throw new RangeError(`${itemId} cannot be equipped in ${slot ?? "any slot"}`);
    }
    const existingInSlot = this._equipment.get(slot);
    const alreadyLocked = existingInSlot?.itemId === itemId ? 1 : 0;
    if (this.availableCount(itemId) + alreadyLocked < 1) throw new RangeError(`${itemId} is not available to equip`);

    const removed = [];
    if (slot === "mainHand" && definition.stats.twoHanded && this._equipment.has("offHand")) {
      removed.push(this.unequip("offHand"));
    }
    if (slot === "offHand") {
      const main = this._equipment.get("mainHand");
      if (main && this._resolve(main.itemId).stats.twoHanded) removed.push(this.unequip("mainHand"));
    }
    if (existingInSlot && existingInSlot.itemId !== itemId) removed.push(this.unequip(slot));

    const current = existingInSlot?.itemId === itemId ? existingInSlot : null;
    const equipped = {
      itemId,
      durability: current?.durability ?? definition.durability ?? 100,
      maxDurability: current?.maxDurability ?? definition.durability ?? 100,
      upgradeLevel: current?.upgradeLevel ?? 0,
    };
    this._equipment.set(slot, equipped);
    this._emit({ type: "inventory:equip", slot, itemId, removed: removed.filter(Boolean).map(entry => entry.itemId) });
    return { slot, ...equipped };
  }

  unequip(slot) {
    const equipped = this._equipment.get(slot);
    if (!equipped) return null;
    this._equipment.delete(slot);
    this._emit({ type: "inventory:unequip", slot, itemId: equipped.itemId });
    return { slot, ...equipped };
  }

  equipped(slot) {
    const value = this._equipment.get(slot);
    return value ? { slot, ...value, definition: this._resolve(value.itemId) } : null;
  }

  derivedStats() {
    const stats = { ...this.baseStats };
    for (const equipped of this._equipment.values()) {
      const definition = this._resolve(equipped.itemId);
      const condition = equipped.maxDurability > 0 ? clamp(equipped.durability / equipped.maxDurability, 0, 1) : 1;
      const conditionMultiplier = condition <= 0 ? 0.25 : 0.65 + condition * 0.35;
      const upgradeMultiplier = 1 + equipped.upgradeLevel * 0.1;
      for (const [key, rawValue] of Object.entries(definition.stats)) {
        if (!SCALAR_EQUIPMENT_STATS.has(key) || !Number.isFinite(rawValue)) continue;
        const improvesWithUpgrade = key === "attack" || key === "defense" || key === "poise";
        stats[key] = (stats[key] ?? 0) + rawValue * conditionMultiplier * (improvesWithUpgrade ? upgradeMultiplier : 1);
      }
      if (Number.isFinite(definition.stats.blockReduction)) {
        stats.blockReduction = Math.max(stats.blockReduction ?? 0,
          definition.stats.blockReduction * conditionMultiplier);
      }
    }
    const encumbrance = clamp(this.totalWeight / this.weightCapacity, 0, 1.5);
    stats.encumbrance = encumbrance;
    stats.moveSpeedMultiplier = clamp((stats.moveSpeed ?? 1) * (1 - Math.max(0, encumbrance - 0.55) * 0.42), 0.55, 1.25);
    stats.dodgeStaminaCostMultiplier = 1 + Math.max(0, encumbrance - 0.65) * 0.8;
    for (const key of Object.keys(stats)) if (Number.isFinite(stats[key])) stats[key] = round(stats[key]);
    return stats;
  }

  attackProfile({ heavy = false } = {}) {
    const equipped = this._equipment.get("mainHand");
    const definition = equipped ? this._resolve(equipped.itemId) : null;
    const weapon = definition?.type === "weapon" ? definition : null;
    const stats = this.derivedStats();
    const heavyMultiplier = heavy ? 1.65 : 1;
    const timingMultiplier = heavy ? 1.38 : 1;
    return {
      itemId: weapon?.id ?? "unarmed",
      kind: weapon?.stats.projectile ? "ranged" : "melee",
      projectile: weapon?.stats.projectile ?? null,
      twoHanded: Boolean(weapon?.stats.twoHanded),
      damage: round(stats.attack * heavyMultiplier),
      staminaCost: round((weapon?.stats.staminaCost ?? 9) * (heavy ? 1.45 : 1)),
      poiseDamage: round((weapon?.stats.poiseDamage ?? 4) * heavyMultiplier),
      range: weapon?.stats.range ?? 1.15,
      windup: round((weapon?.stats.windup ?? 0.18) * timingMultiplier),
      active: round((weapon?.stats.active ?? 0.12) * (heavy ? 1.15 : 1)),
      recovery: round((weapon?.stats.recovery ?? 0.3) * timingMultiplier),
      speed: weapon?.stats.speed ?? 1.1,
    };
  }

  damageDurability(slot, amount) {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError("durability damage must be non-negative");
    const equipped = this._equipment.get(slot);
    if (!equipped) throw new RangeError(`nothing equipped in ${slot}`);
    equipped.durability = clamp(equipped.durability - amount, 0, equipped.maxDurability);
    this._emit({ type: "inventory:durability", slot, itemId: equipped.itemId, durability: equipped.durability });
    return equipped.durability;
  }

  repairEquipped(slot, amount = Infinity) {
    const equipped = this._equipment.get(slot);
    if (!equipped) throw new RangeError(`nothing equipped in ${slot}`);
    const repaired = Math.min(equipped.maxDurability - equipped.durability, Math.max(0, amount));
    equipped.durability += repaired;
    this._emit({ type: "inventory:repair", slot, itemId: equipped.itemId, repaired });
    return repaired;
  }

  upgradeEquipped(slot, maxLevel = 3) {
    const equipped = this._equipment.get(slot);
    if (!equipped) throw new RangeError(`nothing equipped in ${slot}`);
    if (equipped.upgradeLevel >= maxLevel) throw new RangeError(`${equipped.itemId} is already fully upgraded`);
    equipped.upgradeLevel += 1;
    equipped.maxDurability = Math.round(equipped.maxDurability * 1.08);
    equipped.durability = equipped.maxDurability;
    this._emit({ type: "inventory:upgrade", slot, itemId: equipped.itemId, level: equipped.upgradeLevel });
    return equipped.upgradeLevel;
  }

  consume(itemId) {
    const definition = this._resolve(itemId);
    if (definition.type !== "consumable") throw new RangeError(`${itemId} is not consumable`);
    this.remove(itemId, 1, "consume");
    return structuredClone(definition.effect);
  }

  transaction(callback) {
    const before = this.snapshot();
    try {
      return callback(this);
    } catch (error) {
      this.restore(before, { silent: true });
      throw error;
    }
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return {
      maxSlots: this.maxSlots,
      weightCapacity: this.weightCapacity,
      baseStats: { ...this.baseStats },
      stacks: this.stacks,
      equipment: this.equipment,
    };
  }

  restore(snapshot, { silent = false } = {}) {
    if (!snapshot || !Array.isArray(snapshot.stacks)) throw new TypeError("invalid inventory snapshot");
    this.maxSlots = snapshot.maxSlots;
    this.weightCapacity = snapshot.weightCapacity;
    this.baseStats = { ...DEFAULT_BASE_STATS, ...snapshot.baseStats };
    this._stacks = snapshot.stacks.map(stack => ({ itemId: stack.itemId, quantity: stack.quantity }));
    this._equipment = new Map(Object.entries(snapshot.equipment ?? {}).map(([slot, value]) => [slot, { ...value }]));
    if (!silent) this._emit({ type: "inventory:restore" });
    return this;
  }

  _additionCapacity(itemId) {
    const definition = this._resolve(itemId);
    const existingSpace = this._stacks.reduce((sum, stack) =>
      sum + (stack.itemId === itemId ? definition.maxStack - stack.quantity : 0), 0);
    const slotSpace = (this.maxSlots - this.usedSlots) * definition.maxStack;
    const bySlots = Math.max(0, existingSpace + slotSpace);
    const byWeight = definition.weight <= 0
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Math.floor((this.weightCapacity - this.totalWeight + 1e-9) / definition.weight));
    return Math.min(bySlots, byWeight);
  }

  _equippedCount(itemId) {
    let count = 0;
    for (const equipped of this._equipment.values()) if (equipped.itemId === itemId) count += 1;
    return count;
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

function validateQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError("quantity must be a positive integer");
  return quantity;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
