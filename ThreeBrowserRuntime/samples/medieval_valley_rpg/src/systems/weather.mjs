import { createSeededRng } from "./rng.mjs";

export const WEATHER_PRESETS = deepFreeze({
  clear: {
    cloudCover: 0.12, precipitation: 0, fogDensity: 0.05, visibility: 1,
    windSpeed: 3.5, wetnessTarget: 0, fireExposure: 0, npcShelterDemand: 0,
    enemyAggression: 1, lightningChance: 0, ambience: "clear-valley",
  },
  cloudy: {
    cloudCover: 0.68, precipitation: 0, fogDensity: 0.12, visibility: 0.82,
    windSpeed: 6.5, wetnessTarget: 0.16, fireExposure: 0, npcShelterDemand: 0.12,
    enemyAggression: 1.04, lightningChance: 0, ambience: "cloudy-valley",
  },
  rain: {
    cloudCover: 0.92, precipitation: 0.68, fogDensity: 0.24, visibility: 0.6,
    windSpeed: 9, wetnessTarget: 0.9, fireExposure: 0.78, npcShelterDemand: 0.9,
    enemyAggression: 1.12, lightningChance: 0.02, ambience: "steady-rain",
  },
  storm: {
    cloudCover: 1, precipitation: 1, fogDensity: 0.31, visibility: 0.4,
    windSpeed: 20, wetnessTarget: 1, fireExposure: 1.35, npcShelterDemand: 1,
    enemyAggression: 1.28, lightningChance: 0.18, ambience: "valley-storm",
  },
  fog: {
    cloudCover: 0.78, precipitation: 0.06, fogDensity: 0.72, visibility: 0.25,
    windSpeed: 1.8, wetnessTarget: 0.42, fireExposure: 0.05, npcShelterDemand: 0.3,
    enemyAggression: 1.18, lightningChance: 0, ambience: "dense-fog",
  },
});

/** Continuous weather state shared by surfaces, NPCs, fires and spawning. */
export class WeatherSystem {
  constructor({ mode = "cloudy", seed = "medieval-valley-weather", autoCycle = false } = {}) {
    if (!WEATHER_PRESETS[mode]) throw new RangeError(`unknown weather mode: ${mode}`);
    this.rng = createSeededRng(seed);
    this.mode = mode;
    this.targetMode = mode;
    this.autoCycle = autoCycle;
    this.elapsedInMode = 0;
    this.modeDuration = this.rng.float(90, 220);
    this.transitionMinutes = 0;
    this.transitionElapsed = 0;
    this.windDirection = this.rng.float(0, Math.PI * 2);
    this.wetness = WEATHER_PRESETS[mode].wetnessTarget;
    this.lightning = false;
    this._from = numericPreset(WEATHER_PRESETS[mode]);
    this._state = numericPreset(WEATHER_PRESETS[mode]);
    this._listeners = new Set();
  }

  setWeather(mode, { transitionMinutes = 12, reason = "script" } = {}) {
    if (!WEATHER_PRESETS[mode]) throw new RangeError(`unknown weather mode: ${mode}`);
    if (!Number.isFinite(transitionMinutes) || transitionMinutes < 0) throw new RangeError("transitionMinutes must be non-negative");
    const previous = this.targetMode;
    this.mode = transitionMinutes === 0 ? mode : this.mode;
    this.targetMode = mode;
    this.transitionMinutes = transitionMinutes;
    this.transitionElapsed = 0;
    this._from = { ...this._state };
    if (transitionMinutes === 0) this._state = numericPreset(WEATHER_PRESETS[mode]);
    this.elapsedInMode = 0;
    this.modeDuration = this.rng.float(90, 220);
    this._emit({ type: "weather:change", previous, mode, transitionMinutes, reason });
    return this.snapshot();
  }

  advance(gameMinutes) {
    if (!Number.isFinite(gameMinutes) || gameMinutes < 0) throw new RangeError("gameMinutes must be non-negative");
    this.elapsedInMode += gameMinutes;
    if (this.transitionMinutes > 0 && this.transitionElapsed < this.transitionMinutes) {
      this.transitionElapsed = Math.min(this.transitionMinutes, this.transitionElapsed + gameMinutes);
      const t = smoothstep(this.transitionElapsed / this.transitionMinutes);
      const target = numericPreset(WEATHER_PRESETS[this.targetMode]);
      for (const key of Object.keys(target)) this._state[key] = lerp(this._from[key], target[key], t);
      if (this.transitionElapsed >= this.transitionMinutes) this.mode = this.targetMode;
    }

    const wetnessTarget = this._state.wetnessTarget;
    const wetnessRate = wetnessTarget > this.wetness ? 0.035 : 0.012;
    this.wetness = moveTowards(this.wetness, wetnessTarget, wetnessRate * gameMinutes);
    this.windDirection = wrapRadians(this.windDirection + Math.sin((this.elapsedInMode + 17) * 0.031) * gameMinutes * 0.0018);
    const strikeChance = clamp(this._state.lightningChance * gameMinutes * 0.04, 0, 0.85);
    this.lightning = this.targetMode === "storm" && this.rng.chance(strikeChance);

    if (this.autoCycle && this.elapsedInMode >= this.modeDuration && this.mode === this.targetMode) {
      this.setWeather(this.chooseNext(), { transitionMinutes: this.rng.float(12, 28), reason: "cycle" });
    }
    return this.snapshot();
  }

  chooseNext() {
    const transitions = {
      clear: [{ value: "cloudy", weight: 6 }, { value: "fog", weight: 1 }],
      cloudy: [{ value: "clear", weight: 3 }, { value: "rain", weight: 5 }, { value: "fog", weight: 2 }],
      rain: [{ value: "cloudy", weight: 5 }, { value: "storm", weight: 2 }, { value: "fog", weight: 1 }],
      storm: [{ value: "rain", weight: 5 }, { value: "cloudy", weight: 2 }],
      fog: [{ value: "cloudy", weight: 4 }, { value: "clear", weight: 2 }, { value: "rain", weight: 1 }],
    };
    return this.rng.weighted(transitions[this.targetMode]);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  get type() {
    return this.mode;
  }

  get state() {
    return this.snapshot();
  }

  /** NPC and dialogue adapters conventionally request weather.current(). */
  current() {
    return this.snapshot();
  }

  snapshot() {
    const preset = WEATHER_PRESETS[this.targetMode];
    const wetness = clamp(this.wetness, 0, 1);
    const windSpeed = this._state.windSpeed;
    const storminess = clamp(
      (windSpeed - WEATHER_PRESETS.cloudy.windSpeed) / (WEATHER_PRESETS.storm.windSpeed - WEATHER_PRESETS.cloudy.windSpeed),
      0,
      1,
    );
    return {
      type: this.mode,
      mode: this.mode,
      targetMode: this.targetMode,
      transitionProgress: this.transitionMinutes <= 0 ? 1 : clamp(this.transitionElapsed / this.transitionMinutes, 0, 1),
      ...Object.fromEntries(Object.entries(this._state).map(([key, value]) => [key, round(value)])),
      rain: round(this._state.precipitation),
      storm: round(storminess),
      storminess: round(storminess),
      fog: round(this._state.fogDensity),
      wetness: round(wetness),
      puddleDepth: round(Math.max(0, wetness - 0.28) * 0.85),
      surfaceRoughnessMultiplier: round(1 - wetness * 0.52),
      reflectionStrength: round(0.25 + wetness * 0.75),
      windDirection: round(this.windDirection),
      wind: [
        round(Math.cos(this.windDirection) * windSpeed / 10),
        round(Math.sin(this.windDirection) * windSpeed / 10),
      ],
      ambience: preset.ambience,
      lightning: this.lightning,
      lightningFlash: this.lightning ? 1 : 0,
      autoCycle: this.autoCycle,
      elapsedInMode: round(this.elapsedInMode),
      modeDuration: round(this.modeDuration),
      transitionMinutes: round(this.transitionMinutes),
      transitionElapsed: round(this.transitionElapsed),
      transitionFrom: { ...this._from },
      simulation: {
        state: { ...this._state },
        from: { ...this._from },
        wetness: this.wetness,
        windDirection: this.windDirection,
        elapsedInMode: this.elapsedInMode,
        modeDuration: this.modeDuration,
        transitionMinutes: this.transitionMinutes,
        transitionElapsed: this.transitionElapsed,
      },
      rng: this.rng.snapshot(),
    };
  }

  restore(snapshot) {
    if (!snapshot || !WEATHER_PRESETS[snapshot.targetMode ?? snapshot.mode]) throw new TypeError("invalid weather snapshot");
    this.mode = snapshot.mode;
    this.targetMode = snapshot.targetMode ?? snapshot.mode;
    this.autoCycle = snapshot.autoCycle ?? this.autoCycle;
    const simulation = snapshot.simulation ?? snapshot;
    this.transitionMinutes = simulation.transitionMinutes ?? 0;
    this.transitionElapsed = simulation.transitionElapsed ?? 0;
    this.elapsedInMode = simulation.elapsedInMode ?? 0;
    this.modeDuration = simulation.modeDuration ?? this.modeDuration;
    this._state = numericPreset(WEATHER_PRESETS[this.targetMode]);
    const preciseState = simulation.state ?? snapshot;
    for (const key of Object.keys(this._state)) if (Number.isFinite(preciseState[key])) this._state[key] = preciseState[key];
    this._from = simulation.from
      ? { ...simulation.from }
      : snapshot.transitionFrom
        ? { ...snapshot.transitionFrom }
        : { ...this._state };
    this.wetness = simulation.wetness ?? snapshot.wetness ?? this._state.wetnessTarget;
    this.windDirection = simulation.windDirection ?? snapshot.windDirection ?? this.windDirection;
    this.lightning = Boolean(snapshot.lightning);
    if (snapshot.rng) this.rng.restore(snapshot.rng);
    return this;
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

function numericPreset(preset) {
  return Object.fromEntries(Object.entries(preset).filter(([, value]) => Number.isFinite(value)));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function moveTowards(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapRadians(value) {
  const full = Math.PI * 2;
  return ((value % full) + full) % full;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
