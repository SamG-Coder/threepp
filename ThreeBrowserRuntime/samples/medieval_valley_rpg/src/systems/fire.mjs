import { WorldProgression } from "./reputation.mjs";

export const FIRE_PROFILES = deepFreeze({
  candle: { maxHeat: 20, maxFuel: 90, burnRate: 0.35, recovery: 8, rainSensitivity: 2.4, lightIntensity: 0.65, radius: 3 },
  torch: { maxHeat: 55, maxFuel: 120, burnRate: 0.72, recovery: 15, rainSensitivity: 1.8, lightIntensity: 2.2, radius: 8 },
  campfire: { maxHeat: 110, maxFuel: 180, burnRate: 1.25, recovery: 22, rainSensitivity: 1.15, lightIntensity: 4.4, radius: 13 },
  brazier: { maxHeat: 125, maxFuel: 210, burnRate: 1.05, recovery: 25, rainSensitivity: 0.72, lightIntensity: 5.1, radius: 15 },
  fireplace: { maxHeat: 100, maxFuel: 240, burnRate: 0.8, recovery: 22, rainSensitivity: 0, lightIntensity: 3.8, radius: 12 },
  beacon: { maxHeat: 420, maxFuel: 500, burnRate: 1.8, recovery: 70, rainSensitivity: 0.08, lightIntensity: 28, radius: 120 },
});

/** A shared simulation model for torches, braziers, hearths and the beacon. */
export class FireSystem {
  constructor({ progression = null } = {}) {
    if (progression && !(progression instanceof WorldProgression) && typeof progression.set !== "function") {
      throw new TypeError("progression must expose set()");
    }
    this.progression = progression;
    this._fires = new Map();
    this._listeners = new Set();
  }

  register({ id, type = "torch", lit = false, exposed = true, fuel, heat, rainResistance = 0, metadata = {} }) {
    if (!id || this._fires.has(id)) throw new RangeError(`fire id must be unique: ${id}`);
    const profile = FIRE_PROFILES[type];
    if (!profile) throw new RangeError(`unknown fire type: ${type}`);
    const state = {
      id,
      type,
      lit: Boolean(lit),
      exposed: Boolean(exposed),
      fuel: clamp(fuel ?? profile.maxFuel, 0, profile.maxFuel),
      maxFuel: profile.maxFuel,
      heat: clamp(heat ?? (lit ? profile.maxHeat : 0), 0, profile.maxHeat),
      maxHeat: profile.maxHeat,
      rainResistance: clamp(rainResistance, 0, 1),
      lightIntensity: profile.lightIntensity,
      radius: profile.radius,
      metadata: { ...metadata },
    };
    this._fires.set(id, state);
    this._syncBeacon(state, "register");
    return this.get(id);
  }

  has(id) {
    return this._fires.has(id);
  }

  /** Lightweight compatibility query for renderer/world adapters. */
  isLit(id) {
    return this._fires.get(id)?.lit ?? false;
  }

  get state() {
    return this.snapshot();
  }

  get(id) {
    const fire = this._fires.get(id);
    if (!fire) throw new RangeError(`unknown fire: ${id}`);
    return publicState(fire);
  }

  ignite(id, { fuel = 0, reason = "interaction" } = {}) {
    const fire = this._require(id);
    fire.fuel = clamp(fire.fuel + Math.max(0, fuel), 0, fire.maxFuel);
    if (fire.fuel <= 0) throw new RangeError(`${id} has no fuel`);
    fire.lit = true;
    fire.heat = Math.max(fire.heat, fire.maxHeat * 0.35);
    this._syncBeacon(fire, reason);
    this._emit({ type: "fire:lit", id, fire: publicState(fire), reason });
    return publicState(fire);
  }

  extinguish(id, reason = "interaction") {
    const fire = this._require(id);
    if (!fire.lit) return publicState(fire);
    fire.lit = false;
    fire.heat = 0;
    this._syncBeacon(fire, reason);
    this._emit({ type: "fire:extinguished", id, fire: publicState(fire), reason });
    return publicState(fire);
  }

  refuel(id, amount) {
    if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("fuel amount must be positive");
    const fire = this._require(id);
    const accepted = Math.min(amount, fire.maxFuel - fire.fuel);
    fire.fuel += accepted;
    this._emit({ type: "fire:refuel", id, amount: accepted, fire: publicState(fire) });
    return accepted;
  }

  advance(gameMinutes, weather = {}) {
    if (!Number.isFinite(gameMinutes) || gameMinutes < 0) throw new RangeError("gameMinutes must be non-negative");
    const exposure = clamp(Number(weather.fireExposure ?? 0), 0, 2);
    const wind = Math.max(0, Number(weather.windSpeed ?? 0));
    const changed = [];
    for (const fire of this._fires.values()) {
      if (!fire.lit) continue;
      const profile = FIRE_PROFILES[fire.type];
      const windBurn = 1 + Math.min(wind / 35, 0.45);
      fire.fuel = Math.max(0, fire.fuel - profile.burnRate * windBurn * gameMinutes);
      const rainLoss = fire.exposed
        ? exposure * profile.rainSensitivity * (1 - fire.rainResistance) * gameMinutes * 12
        : 0;
      const fuelHeat = fire.fuel > 0 ? profile.recovery * gameMinutes : -profile.maxHeat * gameMinutes;
      fire.heat = clamp(fire.heat + fuelHeat - rainLoss, 0, fire.maxHeat);
      if (fire.fuel <= 0 || fire.heat <= profile.maxHeat * 0.06) {
        fire.lit = false;
        fire.heat = 0;
        this._syncBeacon(fire, fire.fuel <= 0 ? "fuel" : "weather");
        this._emit({
          type: "fire:extinguished", id: fire.id, fire: publicState(fire),
          reason: fire.fuel <= 0 ? "fuel" : "weather",
        });
      }
      changed.push(publicState(fire));
    }
    return changed;
  }

  lightState(id) {
    const fire = this._require(id);
    const strength = fire.lit ? clamp(fire.heat / fire.maxHeat, 0, 1) : 0;
    return {
      id,
      visible: fire.lit,
      intensity: round(fire.lightIntensity * strength),
      radius: round(fire.radius * (0.75 + strength * 0.25)),
      heat: round(fire.heat),
    };
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return [...this._fires.values()].map(publicState).sort((left, right) => left.id.localeCompare(right.id));
  }

  restore(snapshot) {
    this._fires.clear();
    for (const state of snapshot ?? []) {
      const registered = this.register(state);
      const fire = this._require(registered.id);
      Object.assign(fire, state, { metadata: { ...state.metadata } });
    }
    return this;
  }

  _require(id) {
    const fire = this._fires.get(id);
    if (!fire) throw new RangeError(`unknown fire: ${id}`);
    return fire;
  }

  _syncBeacon(fire, reason) {
    if (fire.id !== "village_beacon" || !this.progression) return;
    this.progression.set("beaconLit", fire.lit, `fire:${reason}`);
    this.progression.set("valleyBeaconIntensity", fire.lit ? 1 : 0, `fire:${reason}`);
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

export function createDefaultFireSystem({ progression } = {}) {
  const fire = new FireSystem({ progression });
  fire.register({ id: "village_beacon", type: "beacon", lit: false, exposed: true, rainResistance: 0.96 });
  fire.register({ id: "forge_hearth", type: "fireplace", lit: true, exposed: false });
  fire.register({ id: "inn_fireplace", type: "fireplace", lit: true, exposed: false });
  fire.register({ id: "village_brazier_east", type: "brazier", lit: false, exposed: true, rainResistance: 0.35 });
  fire.register({ id: "village_brazier_west", type: "brazier", lit: false, exposed: true, rainResistance: 0.35 });
  fire.register({ id: "hunter_campfire", type: "campfire", lit: true, exposed: true, rainResistance: 0.08 });
  return fire;
}

function publicState(fire) {
  return {
    ...fire,
    fuel: round(fire.fuel),
    heat: round(fire.heat),
    metadata: { ...fire.metadata },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
