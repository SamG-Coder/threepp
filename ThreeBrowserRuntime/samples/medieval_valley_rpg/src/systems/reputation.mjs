export const DEFAULT_WORLD_STATE = Object.freeze({
  beaconInspected: false,
  beaconLit: false,
  beaconRepairProgress: 0,
  fortressRouteUnlocked: false,
  corruptionStrength: 1,
  townEnemySpawnMultiplier: 1,
  villageSafety: 0.22,
  villageIntegrity: 1,
  guardMorale: 0.35,
  wolfDenCleared: false,
  merchantRouteOpen: false,
  merchantStockTier: 0,
  wardenDefeated: false,
  postVictory: false,
  valleyBeaconIntensity: 0,
  mainQuestComplete: false,
});

export class ReputationSystem {
  constructor(initial = {}) {
    this._scores = new Map(Object.entries({ village: 0, hunters: 0, guards: 0, ...initial }));
    this._listeners = new Set();
  }

  get(faction) {
    return this._scores.get(faction) ?? 0;
  }

  set(faction, value, reason = "set") {
    if (!faction) throw new TypeError("faction is required");
    if (!Number.isFinite(value)) throw new TypeError("reputation must be finite");
    const previous = this.get(faction);
    const next = clamp(Math.round(value), -100, 100);
    this._scores.set(faction, next);
    if (next !== previous) this._emit({ type: "reputation", faction, previous, value: next, delta: next - previous, reason });
    return next;
  }

  add(faction, delta, reason = "event") {
    if (!Number.isFinite(delta)) throw new TypeError("reputation delta must be finite");
    return this.set(faction, this.get(faction) + delta, reason);
  }

  level(faction) {
    const score = this.get(faction);
    if (score <= -60) return "hostile";
    if (score <= -20) return "wary";
    if (score < 20) return "neutral";
    if (score < 60) return "trusted";
    return "honoured";
  }

  merchantDiscount(faction = "village") {
    const score = this.get(faction);
    if (score <= 0) return 0;
    return clamp(score * 0.0025, 0, 0.25);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return Object.fromEntries([...this._scores].sort(([left], [right]) => left.localeCompare(right)));
  }

  restore(snapshot) {
    this._scores = new Map(Object.entries(snapshot ?? {}));
    return this;
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

export class WorldProgression {
  constructor(initial = {}) {
    this._state = { ...DEFAULT_WORLD_STATE, ...initial };
    this._listeners = new Set();
  }

  get(key) {
    return this._state[key];
  }

  has(key, expected = true) {
    return this.get(key) === expected;
  }

  set(key, value, reason = "set") {
    if (!key) throw new TypeError("world-state key is required");
    const previous = this._state[key];
    this._state[key] = value;
    if (!Object.is(previous, value)) this._emit({ type: "world", key, previous, value, reason });
    return value;
  }

  add(key, delta, reason = "add") {
    const current = Number(this.get(key) ?? 0);
    if (!Number.isFinite(current) || !Number.isFinite(delta)) throw new TypeError(`${key} must be numeric`);
    return this.set(key, current + delta, reason);
  }

  applyEffects(effects = [], reason = "effect") {
    const changes = [];
    for (const effect of effects) {
      if ((effect.service ?? "world") !== "world") continue;
      const previous = this.get(effect.key);
      let next;
      switch (effect.op ?? "set") {
        case "set": next = effect.value; break;
        case "add": next = Number(previous ?? 0) + Number(effect.value); break;
        case "multiply": next = Number(previous ?? 0) * Number(effect.value); break;
        case "min": next = Math.min(Number(previous), Number(effect.value)); break;
        case "max": next = Math.max(Number(previous), Number(effect.value)); break;
        default: throw new RangeError(`unsupported world effect operation: ${effect.op}`);
      }
      this.set(effect.key, next, reason);
      changes.push({ key: effect.key, previous, value: next });
    }
    return changes;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return { ...this._state };
  }

  restore(snapshot) {
    this._state = { ...DEFAULT_WORLD_STATE, ...snapshot };
    return this;
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

export function createWorldProgression(initial) {
  return new WorldProgression(initial);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
