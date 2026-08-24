import { getItem } from "./items.mjs";
import { createSeededRng } from "./rng.mjs";

export const DEFAULT_MERCHANTS = deepFreeze({
  blacksmith: {
    name: "Tomas the Blacksmith", faction: "village", buyMarkup: 1.24, sellRate: 0.52, gold: 420,
    restockMinutes: 1440,
    stock: [
      stock("village_sword", 1, 1, 1),
      stock("iron_shield", 1, 1, 1),
      stock("leather_gloves", 1, 1, 1),
      stock("iron_ingot", 8, 3, 12),
      stock("charcoal", 8, 4, 14),
      stock("mail_hauberk", 0, 1, 1, { minTier: 1 }),
      stock("iron_greatsword", 0, 1, 1, { minTier: 1, reputation: 20 }),
    ],
  },
  herbalist: {
    name: "Sister Aveline", faction: "village", buyMarkup: 1.18, sellRate: 0.48, gold: 260,
    restockMinutes: 720,
    stock: [
      stock("healing_draught", 3, 2, 5),
      stock("stamina_tonic", 2, 1, 4),
      stock("medicinal_herbs", 8, 4, 12),
      stock("cloth", 5, 3, 9),
    ],
  },
  merchant_elin: {
    name: "Elin's Trade Cart", faction: "village", buyMarkup: 1.3, sellRate: 0.5, gold: 500,
    restockMinutes: 1440,
    stock: [
      stock("seasoned_wood", 3, 3, 9),
      stock("leather", 2, 3, 8),
      stock("crossbow_bolt", 0, 12, 30, { world: "merchantRouteOpen" }),
      stock("hunting_crossbow", 0, 1, 1, { world: "merchantRouteOpen", minTier: 1 }),
      stock("smoke_bomb", 0, 1, 3, { world: "merchantRouteOpen" }),
    ],
  },
});

/** Limited merchant stock, currency flow, restocking and reputation pricing. */
export class EconomySystem {
  constructor({
    inventory,
    progression = null,
    reputation = null,
    seed = "medieval-valley-economy",
    startingGold = 90,
    merchants = DEFAULT_MERCHANTS,
  } = {}) {
    if (!inventory) throw new TypeError("EconomySystem requires an inventory");
    if (!Number.isSafeInteger(startingGold) || startingGold < 0) throw new RangeError("startingGold must be non-negative");
    this.inventory = inventory;
    this.progression = progression;
    this.reputation = reputation;
    this.rng = createSeededRng(seed);
    this.gold = startingGold;
    this.elapsed = 0;
    this._merchants = new Map();
    this._listeners = new Set();
    for (const [id, definition] of Object.entries(merchants)) this.registerMerchant(id, definition);
  }

  registerMerchant(id, definition) {
    if (!id || this._merchants.has(id)) throw new RangeError(`merchant id must be unique: ${id}`);
    const state = {
      id,
      name: definition.name,
      faction: definition.faction ?? "village",
      buyMarkup: definition.buyMarkup ?? 1.25,
      sellRate: definition.sellRate ?? 0.5,
      gold: definition.gold ?? 300,
      restockMinutes: definition.restockMinutes ?? 1440,
      restockElapsed: 0,
      entries: new Map(),
    };
    for (const entry of definition.stock ?? []) {
      getItem(entry.itemId);
      state.entries.set(entry.itemId, {
        ...entry,
        quantity: this._entryUnlocked(entry) ? entry.initial : 0,
        unlocked: this._entryUnlocked(entry),
      });
    }
    this._merchants.set(id, state);
    return this.merchant(id);
  }

  merchant(id) {
    const merchant = this._require(id);
    this._refreshUnlocks(merchant);
    return {
      id: merchant.id,
      name: merchant.name,
      faction: merchant.faction,
      gold: merchant.gold,
      stock: Object.fromEntries([...merchant.entries].map(([itemId, entry]) => [itemId, entry.quantity])),
    };
  }

  addGold(amount, reason = "reward") {
    if (!Number.isSafeInteger(amount) || this.gold + amount < 0) throw new RangeError("gold change is invalid");
    const previous = this.gold;
    this.gold += amount;
    this._emit({ type: "economy:gold", previous, value: this.gold, delta: amount, reason });
    return this.gold;
  }

  quote(merchantId, itemId, { buying = true } = {}) {
    const merchant = this._require(merchantId);
    this._refreshUnlocks(merchant);
    const definition = getItem(itemId);
    if (definition.value <= 0 || definition.rarity === "quest") {
      throw new RangeError(`${itemId} is not tradeable`);
    }
    const entry = merchant.entries.get(itemId);
    const scarcity = buying && entry ? 1 + Math.max(0, 1 - entry.quantity / Math.max(1, entry.max)) * 0.08 : 1;
    const discount = buying ? this._discount(merchant) : 0;
    const multiplier = buying ? merchant.buyMarkup * scarcity * (1 - discount) : merchant.sellRate;
    return Math.max(1, Math.round(definition.value * multiplier));
  }

  buy(merchantId, itemId, quantity = 1) {
    quantity = positiveInteger(quantity, "quantity");
    const merchant = this._require(merchantId);
    this._refreshUnlocks(merchant);
    const entry = merchant.entries.get(itemId);
    if (!entry?.unlocked || entry.quantity < quantity) throw new RangeError(`${itemId} is not in stock`);
    const unitPrice = this.quote(merchantId, itemId, { buying: true });
    const total = unitPrice * quantity;
    if (this.gold < total) throw new RangeError("not enough gold");
    if (!this.inventory.canAdd(itemId, quantity)) throw new RangeError("not enough inventory capacity");

    this.inventory.addExact(itemId, quantity, `buy:${merchantId}`);
    this.gold -= total;
    merchant.gold += total;
    entry.quantity -= quantity;
    const receipt = { type: "buy", merchantId, itemId, quantity, unitPrice, total, playerGold: this.gold };
    this._emit(receipt);
    return receipt;
  }

  sell(merchantId, itemId, quantity = 1) {
    quantity = positiveInteger(quantity, "quantity");
    const merchant = this._require(merchantId);
    const unitPrice = this.quote(merchantId, itemId, { buying: false });
    const total = unitPrice * quantity;
    if (merchant.gold < total) throw new RangeError(`${merchantId} cannot afford that purchase`);
    if (this.inventory.availableCount(itemId) < quantity) throw new RangeError(`not enough unequipped ${itemId}`);

    this.inventory.remove(itemId, quantity, `sell:${merchantId}`);
    this.gold += total;
    merchant.gold -= total;
    let entry = merchant.entries.get(itemId);
    if (!entry) {
      // Player-supplied goods remain real merchant stock instead of vanishing.
      entry = {
        itemId, initial: 0, restock: 0, max: 0, quantity: 0,
        unlocked: true, playerSupplied: true,
      };
      merchant.entries.set(itemId, entry);
    }
    entry.quantity += quantity;
    const receipt = { type: "sell", merchantId, itemId, quantity, unitPrice, total, playerGold: this.gold };
    this._emit(receipt);
    return receipt;
  }

  advance(gameMinutes) {
    if (!Number.isFinite(gameMinutes) || gameMinutes < 0) throw new RangeError("gameMinutes must be non-negative");
    this.elapsed += gameMinutes;
    const results = [];
    for (const merchant of this._merchants.values()) {
      this._refreshUnlocks(merchant);
      merchant.restockElapsed += gameMinutes;
      while (merchant.restockElapsed >= merchant.restockMinutes) {
        merchant.restockElapsed -= merchant.restockMinutes;
        const additions = {};
        for (const entry of merchant.entries.values()) {
          if (!entry.unlocked || entry.quantity >= entry.max) continue;
          const variance = entry.restock > 1 ? this.rng.int(-1, 1) : 0;
          const amount = Math.max(1, entry.restock + variance);
          const accepted = Math.min(amount, entry.max - entry.quantity);
          entry.quantity += accepted;
          if (accepted) additions[entry.itemId] = accepted;
        }
        merchant.gold = Math.min(1200, merchant.gold + 80);
        const result = { merchantId: merchant.id, additions };
        results.push(result);
        this._emit({ type: "economy:restock", ...result });
      }
    }
    return results;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return {
      gold: this.gold,
      elapsed: this.elapsed,
      rng: this.rng.snapshot(),
      merchants: Object.fromEntries([...this._merchants].map(([id, merchant]) => [id, {
        gold: merchant.gold,
        restockElapsed: merchant.restockElapsed,
        entries: Object.fromEntries([...merchant.entries].map(([itemId, entry]) => [itemId, {
          itemId: entry.itemId,
          initial: entry.initial,
          restock: entry.restock,
          max: entry.max,
          world: entry.world,
          minTier: entry.minTier,
          reputation: entry.reputation,
          playerSupplied: Boolean(entry.playerSupplied),
          quantity: entry.quantity,
          unlocked: entry.unlocked,
        }])),
      }])),
    };
  }

  restore(snapshot) {
    this.gold = snapshot.gold;
    this.elapsed = snapshot.elapsed;
    this.rng.restore(snapshot.rng);
    for (const [id, state] of Object.entries(snapshot.merchants ?? {})) {
      const merchant = this._merchants.get(id);
      if (!merchant) continue;
      merchant.gold = state.gold;
      merchant.restockElapsed = state.restockElapsed;
      for (const [itemId, entryState] of Object.entries(state.entries ?? {})) {
        const entry = merchant.entries.get(itemId);
        if (entry) Object.assign(entry, entryState);
        else merchant.entries.set(itemId, { ...entryState, itemId });
      }
    }
    return this;
  }

  _entryUnlocked(entry) {
    if (entry.world && this.progression?.get(entry.world) !== true) return false;
    if (entry.minTier != null && Number(this.progression?.get("merchantStockTier") ?? 0) < entry.minTier) return false;
    if (entry.reputation != null && Number(this.reputation?.get("village") ?? 0) < entry.reputation) return false;
    return true;
  }

  _refreshUnlocks(merchant) {
    for (const entry of merchant.entries.values()) {
      const unlocked = this._entryUnlocked(entry);
      if (unlocked && !entry.unlocked) entry.quantity = Math.max(entry.quantity, Math.min(entry.restock, entry.max));
      entry.unlocked = unlocked;
      if (!unlocked) entry.quantity = 0;
    }
  }

  _discount(merchant) {
    const reputationDiscount = this.reputation?.merchantDiscount(merchant.faction) ?? 0;
    const routeDiscount = this.progression?.get("merchantRouteOpen") ? 0.05 : 0;
    return Math.min(0.3, reputationDiscount + routeDiscount);
  }

  _require(id) {
    const merchant = this._merchants.get(id);
    if (!merchant) throw new RangeError(`unknown merchant: ${id}`);
    return merchant;
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

function stock(itemId, initial, restockAmount, max, requirements = {}) {
  return { itemId, initial, restock: restockAmount, max, ...requirements };
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
