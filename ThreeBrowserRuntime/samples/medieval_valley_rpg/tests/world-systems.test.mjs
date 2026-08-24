import test from "node:test";
import assert from "node:assert/strict";

import { FireSystem } from "../src/systems/fire.mjs";
import { ReputationSystem, WorldProgression } from "../src/systems/reputation.mjs";
import { TimeSystem, resolveNpcSchedule } from "../src/systems/time.mjs";
import { WeatherSystem } from "../src/systems/weather.mjs";

test("reputation and declarative world effects remain bounded and restorable", () => {
  const reputation = new ReputationSystem();
  reputation.set("village", 24);
  assert.equal(reputation.level("village"), "trusted");
  assert.equal(reputation.merchantDiscount("village"), 0.06);
  reputation.add("village", 500);
  assert.equal(reputation.get("village"), 100);
  assert.equal(reputation.merchantDiscount("village"), 0.25);

  const progression = new WorldProgression();
  progression.applyEffects([
    { op: "set", key: "beaconLit", value: true },
    { op: "add", key: "guardMorale", value: 0.15 },
    { op: "multiply", key: "corruptionStrength", value: 0.7 },
  ], "test");
  assert.equal(progression.get("beaconLit"), true);
  assert.equal(progression.get("guardMorale"), 0.5);
  assert.equal(progression.get("corruptionStrength"), 0.7);
  const snapshot = progression.snapshot();
  progression.set("beaconLit", false);
  assert.deepEqual(new WorldProgression().restore(snapshot).snapshot(), snapshot);
});

test("time phases continuously change light, enemies, windows and schedules", () => {
  const time = new TimeSystem({ day: 2, hour: 6 });
  assert.equal(time.hour(), 6);
  assert.equal(time.timeOfDay, 6);
  assert.equal(time.snapshot().phase, "dawn");
  time.set(2, 12);
  const day = time.snapshot();
  assert.equal(day.phase, "day");
  assert.equal(resolveNpcSchedule("blacksmith", day).location, "forge");
  assert.equal(resolveNpcSchedule("merchant", day).location, "market");

  time.set(2, 18);
  assert.equal(time.snapshot().phase, "sunset");
  assert.equal(resolveNpcSchedule("guard", time.snapshot()).activity, "light_braziers");
  time.set(2, 23);
  const night = time.snapshot();
  assert.equal(night.phase, "night");
  assert.ok(night.windowLightFactor > day.windowLightFactor);
  assert.ok(night.enemyAggression > day.enemyAggression);
  assert.equal(resolveNpcSchedule("guard", night).activity, "night_watch");
  assert.equal(resolveNpcSchedule("blacksmith", night).activity, "rest");
});

test("time and weather snapshots restore exact deterministic continuation", () => {
  const time = new TimeSystem({ day: 3, hour: 23.125, timeScale: 17 });
  time.advanceRealSeconds(1 / 3);
  const timeSnapshot = time.snapshot();
  const restoredTime = new TimeSystem().restore(timeSnapshot);
  assert.deepEqual(restoredTime.snapshot(), timeSnapshot);

  const weather = new WeatherSystem({ mode: "clear", seed: "restore-weather", autoCycle: true });
  weather.setWeather("storm", { transitionMinutes: 17.25 });
  weather.advance(3.14159);
  const weatherSnapshot = weather.snapshot();
  assert.deepEqual(weather.snapshot(), weatherSnapshot, "observing weather does not consume RNG");
  const restoredWeather = new WeatherSystem({ mode: "fog", seed: "different" }).restore(weatherSnapshot);
  for (const minutes of [0.125, 2.75, 19, 113]) {
    assert.deepEqual(restoredWeather.advance(minutes), weather.advance(minutes));
  }
});

test("rain and storms drive wetness, roughness, reflections and shelter behavior", () => {
  const weather = new WeatherSystem({ mode: "clear", seed: 8128 });
  const dry = weather.snapshot();
  assert.equal(dry.wetness, 0);
  weather.setWeather("rain", { transitionMinutes: 0 });
  weather.advance(20);
  const rain = weather.snapshot();
  assert.equal(rain.mode, "rain");
  assert.ok(rain.wetness > 0.6);
  assert.ok(rain.surfaceRoughnessMultiplier < dry.surfaceRoughnessMultiplier);
  assert.ok(rain.reflectionStrength > dry.reflectionStrength);
  assert.equal(resolveNpcSchedule("merchant", { phase: "day" }, rain).activity, "trade_indoors");

  const stableSnapshot = weather.snapshot();
  assert.deepEqual(weather.snapshot(), stableSnapshot, "observing weather must not advance its RNG or simulation");
});

test("shared fire model extinguishes exposed flames but preserves sheltered hearths and beacon", () => {
  const fires = new FireSystem();
  fires.register({ id: "road_torch", type: "torch", lit: true, exposed: true });
  fires.register({ id: "inn_hearth", type: "fireplace", lit: true, exposed: false });
  fires.register({ id: "village_beacon", type: "beacon", lit: true, exposed: true, rainResistance: 0.96 });
  const weather = new WeatherSystem({ mode: "storm", seed: 99 });
  const storm = weather.snapshot();
  fires.advance(6, storm);
  assert.equal(fires.get("road_torch").lit, false);
  assert.equal(fires.get("inn_hearth").lit, true);
  assert.equal(fires.get("village_beacon").lit, true);
  assert.ok(fires.lightState("village_beacon").intensity > fires.lightState("inn_hearth").intensity);
});

test("wind increases fuel use while rain exposure controls extinguishing", () => {
  const calm = new FireSystem();
  const windy = new FireSystem();
  calm.register({ id: "torch", type: "torch", lit: true, exposed: true });
  windy.register({ id: "torch", type: "torch", lit: true, exposed: true });
  calm.advance(10, { windSpeed: 0, fireExposure: 0 });
  windy.advance(10, { windSpeed: 30, fireExposure: 0 });
  assert.ok(windy.get("torch").fuel < calm.get("torch").fuel);
  assert.equal(windy.get("torch").lit, true, "wind alone accelerates fuel use but does not fake rainfall");
});

test("seeded weather cycles produce identical states", () => {
  const left = new WeatherSystem({ mode: "cloudy", seed: "same", autoCycle: true });
  const right = new WeatherSystem({ mode: "cloudy", seed: "same", autoCycle: true });
  for (let step = 0; step < 30; step += 1) {
    assert.deepEqual(left.advance(15), right.advance(15));
  }
});
