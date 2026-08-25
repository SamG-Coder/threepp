import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { atmosphereAt, createCityEnvironment, formatClock, solarCycleAt } from "../src/game/environment.mjs";

test("city clock and atmosphere remain finite across day, night, and rain", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(25.5), "01:30");
  assert.equal(formatClock(-0.25), "23:45");
  const night = atmosphereAt(23, 0.15);
  const day = atmosphereAt(12, 0.15);
  const storm = atmosphereAt(12, 1);
  assert.ok(day.daylight > night.daylight);
  assert.ok(day.keyIntensity > night.keyIntensity);
  assert.ok(storm.keyIntensity < day.keyIntensity);
  assert.ok(storm.fogDensity > day.fogDensity);
  assert.ok(day.streetlight < 0.01);
  assert.ok(night.streetlight > 0.98);
  assert.ok(solarCycleAt(7).sunDirection[1] > 0);
  assert.ok(solarCycleAt(23).moonDirection[1] > 0);
  assert.notEqual(solarCycleAt(6.2).phase, solarCycleAt(12).phase);
  for (const value of [night.ambientIntensity, day.keyIntensity, storm.fogDensity, storm.neonStrength]) {
    assert.ok(Number.isFinite(value));
  }
});

test("native atmosphere updates deterministic rain and disposes cleanly", () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0, 0.001);
  const hemisphere = new THREE.HemisphereLight();
  const moon = new THREE.DirectionalLight();
  const environment = createCityEnvironment({
    scene,
    world: { staticLights: [hemisphere, moon] },
    seed: 1234,
    rainCount: 48,
  });
  environment.setTime(4.5);
  environment.setRain(0.9, true);
  const first = environment.update(1 / 60, 10, new THREE.Vector3(12, 0, -8));
  assert.equal(first.weather, "STORM");
  assert.equal(first.timeLabel, "04:30");
  assert.equal(environment.rain.count, 48);
  assert.equal(environment.rain.instanceMatrix.needsUpdate, undefined);
  assert.ok(scene.fog.density > 0.003);
  assert.ok(moon.intensity > 0);
  assert.equal(environment.root.parent, scene);
  environment.dispose();
  environment.dispose();
  assert.equal(environment.root.parent, null);
});

test("environment hot path reuses atmosphere, snapshots, and cloud rotation storage", () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0, 0.001);
  const environment = createCityEnvironment({
    scene,
    world: { staticLights: [new THREE.HemisphereLight(), new THREE.DirectionalLight()] },
    seed: 4321,
    rainCount: 32,
  });
  try {
    environment.setTime(4.5);
    const stable = environment.setRain(0.9, true);
    const diagnostics = environment.allocationDiagnostics;
    assert.ok(Object.isFrozen(diagnostics));
    assert.equal(diagnostics.policy, "preallocated-environment-hot-path");
    assert.equal(diagnostics.storage, "memory-only");
    assert.equal(diagnostics.cloudQuaternionStorage, "single-preallocated-identity");
    assert.equal(diagnostics.cloudQuaternionAllocationsPerUpdate, 0);
    assert.equal(diagnostics.publicSnapshotsImmutable, true);
    assert.ok(Object.isFrozen(stable));
    assert.ok(Object.isFrozen(stable.sunDirection));
    assert.ok(Object.isFrozen(stable.moonDirection));
    assert.ok(Object.isFrozen(stable.wind));

    const computationsBefore = diagnostics.atmosphereComputations;
    const buildsBefore = diagnostics.snapshotBuilds;
    const atmosphereHitsBefore = diagnostics.atmosphereCacheHits;
    const snapshotHitsBefore = diagnostics.snapshotCacheHits;
    for (let index = 0; index < 64; ++index) assert.strictEqual(environment.snapshot(), stable);
    assert.equal(diagnostics.atmosphereComputations, computationsBefore,
      "reading an unchanged environment must not recompute atmosphere colors or solar vectors");
    assert.equal(diagnostics.snapshotBuilds, buildsBefore,
      "reading an unchanged environment must not rebuild immutable public snapshots");
    assert.equal(diagnostics.atmosphereCacheHits, atmosphereHitsBefore + 64);
    assert.equal(diagnostics.snapshotCacheHits, snapshotHitsBefore + 64);

    // A zero-delta visual refresh still rewrites instance matrices, but the
    // stable public state and its immutable arrays are reused bit-for-bit.
    const zeroDeltaComputations = diagnostics.atmosphereComputations;
    const zeroDeltaBuilds = diagnostics.snapshotBuilds;
    assert.strictEqual(environment.update(0, 0, new THREE.Vector3(5, 0, -3)), stable);
    assert.equal(diagnostics.atmosphereComputations, zeroDeltaComputations);
    assert.equal(diagnostics.snapshotBuilds, zeroDeltaBuilds);

    const oldTime = stable.timeHours;
    const oldSunDirection = [...stable.sunDirection];
    const updated = environment.update(1 / 60, 10, new THREE.Vector3(5, 0, -3));
    assert.notStrictEqual(updated, stable);
    assert.equal(diagnostics.atmosphereComputations, zeroDeltaComputations + 1,
      "one changing update should perform exactly one scratch-atmosphere computation");
    assert.equal(diagnostics.snapshotBuilds, zeroDeltaBuilds + 1,
      "one changing update should publish exactly one immutable snapshot");
    assert.strictEqual(environment.snapshot(), updated);
    assert.equal(stable.timeHours, oldTime, "an older snapshot must remain a true point-in-time value");
    assert.deepEqual(stable.sunDirection, oldSunDirection,
      "the mutable internal solar scratch must never leak into an older public snapshot");

    // The state object remains part of the public API. Direct mutation must
    // invalidate both caches just as setTime/setRain do.
    const directComputations = diagnostics.atmosphereComputations;
    const directBuilds = diagnostics.snapshotBuilds;
    environment.state.hours = 13;
    const externallyChanged = environment.snapshot();
    assert.equal(externallyChanged.timeHours, 13);
    assert.equal(diagnostics.atmosphereComputations, directComputations + 1);
    assert.equal(diagnostics.snapshotBuilds, directBuilds + 1);
  } finally {
    environment.dispose();
  }
});
