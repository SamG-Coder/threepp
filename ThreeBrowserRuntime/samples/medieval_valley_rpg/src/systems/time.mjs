export const DAY_PHASES = Object.freeze({
  dawn: { start: 5, end: 8 },
  day: { start: 8, end: 17 },
  sunset: { start: 17, end: 20 },
  night: { start: 20, end: 29 }, // wraps through 05:00
});

/** Game-calendar clock. Units passed to advance() are in-world minutes. */
export class TimeSystem {
  constructor({ day = 0, hour = 17.5, timeScale = 12 } = {}) {
    if (!Number.isFinite(timeScale) || timeScale <= 0) throw new RangeError("timeScale must be positive");
    this.timeScale = timeScale;
    this.totalMinutes = 0;
    this._listeners = new Set();
    this.set(day, hour, { emit: false });
  }

  set(day, hour, { emit = true } = {}) {
    if (!Number.isInteger(day) || day < 0) throw new RangeError("day must be a non-negative integer");
    if (!Number.isFinite(hour)) throw new TypeError("hour must be finite");
    const previous = this.snapshot();
    this.totalMinutes = day * 1440 + wrapHour(hour) * 60;
    if (emit) this._emitTransitions(previous, this.snapshot());
    return this.snapshot();
  }

  advance(gameMinutes) {
    if (!Number.isFinite(gameMinutes) || gameMinutes < 0) throw new RangeError("gameMinutes must be non-negative");
    const previous = this.snapshot();
    this.totalMinutes += gameMinutes;
    const next = this.snapshot();
    this._emitTransitions(previous, next);
    return next;
  }

  advanceRealSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("seconds must be non-negative");
    return this.advance(seconds / 60 * this.timeScale);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** NPC adapters accept clocks exposing hour() while renderers use timeOfDay. */
  hour() {
    return this.snapshot().hour;
  }

  get timeOfDay() {
    return this.snapshot().hour;
  }

  get phase() {
    return this.snapshot().phase;
  }

  get state() {
    return this.snapshot();
  }

  snapshot() {
    const day = Math.floor(this.totalMinutes / 1440);
    const minuteOfDay = ((this.totalMinutes % 1440) + 1440) % 1440;
    const hour = minuteOfDay / 60;
    const phase = phaseAtHour(hour);
    const daylight = daylightAtHour(hour);
    const night = 1 - daylight;
    return {
      totalMinutes: this.totalMinutes,
      timeScale: this.timeScale,
      day,
      minuteOfDay: round(minuteOfDay),
      hour: round(hour),
      phase,
      daylight: round(daylight),
      moonlight: round(Math.pow(night, 1.25)),
      windowLightFactor: round(smoothstep(clamp((night - 0.2) / 0.65, 0, 1))),
      enemyAggression: round(1 + night * 0.42),
      guardReadiness: round(0.75 + night * 0.25),
    };
  }

  restore(snapshot) {
    if (!snapshot || !Number.isFinite(snapshot.hour)) throw new TypeError("invalid time snapshot");
    if (Number.isFinite(snapshot.timeScale) && snapshot.timeScale > 0) this.timeScale = snapshot.timeScale;
    if (Number.isFinite(snapshot.totalMinutes) && snapshot.totalMinutes >= 0) {
      this.totalMinutes = snapshot.totalMinutes;
    } else {
      this.set(snapshot.day, snapshot.hour, { emit: false });
    }
    return this;
  }

  _emitTransitions(previous, next) {
    if (previous.phase !== next.phase) this._emit({ type: "time:phase", previous: previous.phase, phase: next.phase, state: next });
    if (previous.day !== next.day) this._emit({ type: "time:day", previous: previous.day, day: next.day, state: next });
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

/**
 * Resolves a reusable role schedule. Explicit alerts override weather and time;
 * weather shelter overrides ordinary civilian work but not guard duty.
 */
export function resolveNpcSchedule(role, timeState, weatherState = {}, context = {}) {
  const phase = timeState.phase ?? phaseAtHour(timeState.hour);
  const shelter = Number(weatherState.npcShelterDemand ?? 0);
  if (context.combatAlert) {
    if (role === "guard") return schedule("defend", context.defensePost ?? "village_gate", "combat");
    if (role === "blacksmith") return schedule("arm_guard", "forge", "combat");
    return schedule("seek_safety", context.home ?? "nearest_shelter", "combat");
  }

  if (role === "guard") {
    if (phase === "night") return schedule("night_watch", context.defensePost ?? "village_wall", "time");
    if (phase === "sunset") return schedule("light_braziers", context.defensePost ?? "village_wall", "time");
    return schedule("patrol", context.patrol ?? "village_patrol", "time");
  }

  if (role === "blacksmith") {
    if ((phase === "day" || phase === "dawn") && shelter < 0.95) return schedule("work", "forge", "time");
    if (phase === "sunset") return schedule("supper", context.inn ?? "inn", "time");
    return schedule("rest", context.home ?? "blacksmith_home", shelter >= 0.95 ? "weather" : "time");
  }

  if (role === "merchant") {
    if (shelter >= 0.65) return schedule("trade_indoors", context.shelter ?? "inn_market_room", "weather");
    if (phase === "day") return schedule("trade", context.work ?? "market", "time");
    return schedule("rest", context.home ?? "merchant_lodging", "time");
  }

  if (role === "hunter") {
    if (shelter >= 0.8) return schedule("maintain_gear", context.shelter ?? "hunter_camp_shelter", "weather");
    if (phase === "day" || phase === "dawn") return schedule("hunt", context.work ?? "forest_trail", "time");
    return schedule("camp", context.home ?? "hunter_camp", "time");
  }

  if (shelter >= 0.6) return schedule("shelter", context.shelter ?? context.home ?? "nearest_shelter", "weather");
  if (phase === "day") return schedule("work", context.work ?? "village_square", "time");
  if (phase === "dawn") return schedule("travel_to_work", context.work ?? "village_square", "time");
  return schedule("rest", context.home ?? "village_home", "time");
}

export function phaseAtHour(hour) {
  const value = wrapHour(hour);
  if (value >= 5 && value < 8) return "dawn";
  if (value >= 8 && value < 17) return "day";
  if (value >= 17 && value < 20) return "sunset";
  return "night";
}

function daylightAtHour(hour) {
  const value = wrapHour(hour);
  if (value < 5 || value >= 21) return 0.04;
  if (value < 8) return lerp(0.04, 1, smoothstep((value - 5) / 3));
  if (value < 17) return 1;
  if (value < 21) return lerp(1, 0.04, smoothstep((value - 17) / 4));
  return 0.04;
}

function schedule(activity, location, reason) {
  return { activity, location, reason };
}

function wrapHour(hour) {
  return ((hour % 24) + 24) % 24;
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
