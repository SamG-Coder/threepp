import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createJellyPhysics, DEFAULT_FIXED_TIME_STEP } from "../src/jelly-physics.mjs";

const snapshot = simulation => simulation.bodies.map(body => ({
  position: body.position.toArray(),
  velocity: body.velocity.toArray(),
  quaternion: body.quaternion.toArray(),
  scale: body.scale.toArray(),
  relativeScale: body.relativeScale.toArray(),
}));

const assertArrayClose = (actual, expected, tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `value ${index}: expected ${expected[index]}, received ${actual[index]}`,
    );
  }
};

test("fixed-step jelly motion is deterministic across equivalent frame partitions", () => {
  const options = { count: 5, seed: 0xdecafbad, maximumSubSteps: 32 };
  const sixtyFps = createJellyPhysics(options);
  const thirtyFps = createJellyPhysics(options);

  for (let frame = 0; frame < 120; frame += 1) sixtyFps.update(1 / 60);
  for (let frame = 0; frame < 60; frame += 1) thirtyFps.update(1 / 30);

  const first = snapshot(sixtyFps);
  const second = snapshot(thirtyFps);
  assert.equal(sixtyFps.fixedTimeStep, DEFAULT_FIXED_TIME_STEP);
  assert.equal(sixtyFps.time, thirtyFps.time);
  for (let index = 0; index < first.length; index += 1) {
    assertArrayClose(first[index].position, second[index].position);
    assertArrayClose(first[index].velocity, second[index].velocity);
    assertArrayClose(first[index].quaternion, second[index].quaternion);
    assertArrayClose(first[index].scale, second[index].scale);
    assertArrayClose(first[index].relativeScale, second[index].relativeScale);
  }
});

test("reset restores every dynamic pose and its deterministic continuation", () => {
  const simulation = createJellyPhysics({ count: 3, seed: 99 });
  const pristine = snapshot(simulation);
  simulation.impulseAt([0, 0, 0], 8, 20);
  simulation.update(0.1, { beatImpulse: 0.8, energy: 1 });
  simulation.reset();

  const restored = snapshot(simulation);
  assert.deepEqual(restored, pristine);
  assert.equal(simulation.time, 0);
  assert.equal(simulation.interpolationAlpha, 0);

  const twin = createJellyPhysics({ count: 3, seed: 99 });
  for (let frame = 0; frame < 90; frame += 1) {
    simulation.update(1 / 60);
    twin.update(1 / 60);
  }
  assert.deepEqual(snapshot(simulation), snapshot(twin));
});

test("floor, ceiling, wall and blob contacts keep bodies inside the arena", () => {
  const simulation = createJellyPhysics({
    arena: { minX: -2, maxX: 2, minZ: -2, maxZ: 2, floorY: 0, ceilingY: 5 },
    gravity: [0, -25, 0],
    restitution: 0.45,
    bodies: [
      { id: "left", radius: 0.6, position: [-1.25, 2.5, 0], velocity: [9, -5, 0] },
      { id: "right", radius: 0.7, position: [0.45, 2.4, 0], velocity: [-7, 6, 0] },
    ],
  });

  for (let frame = 0; frame < 360; frame += 1) simulation.update(1 / 120);
  for (const body of simulation.bodies) {
    assert.ok(body.position.x - body.radius >= simulation.arena.minX - 1e-6);
    assert.ok(body.position.x + body.radius <= simulation.arena.maxX + 1e-6);
    assert.ok(body.position.z - body.radius >= simulation.arena.minZ - 1e-6);
    assert.ok(body.position.z + body.radius <= simulation.arena.maxZ + 1e-6);
    assert.ok(body.position.y - body.radius >= simulation.arena.floorY - 1e-6);
    assert.ok(body.position.y + body.radius <= simulation.arena.ceilingY + 1e-6);
    assert.ok(Number.isFinite(body.position.length()));
  }
  const separation = simulation.bodies[0].position.distanceTo(simulation.bodies[1].position);
  assert.ok(separation >= simulation.bodies[0].radius + simulation.bodies[1].radius - 1e-5);
});

test("squash and wobble preserve each jelly's volume", () => {
  const radius = 0.9;
  const simulation = createJellyPhysics({
    gravity: [0, -30, 0],
    bodies: [{ radius, position: [0, 5, 0], velocity: [0, -14, 0] }],
  });
  let strongestImpact = 0;
  let greatestAnisotropy = 0;
  for (let step = 0; step < 180; step += 1) {
    simulation.update(1 / 120, step === 90 ? { beatImpulse: 1 } : {});
    const body = simulation.bodies[0];
    const volume = body.scale.x * body.scale.y * body.scale.z;
    const relativeVolume = body.relativeScale.x * body.relativeScale.y * body.relativeScale.z;
    assert.ok(Math.abs(volume - radius ** 3) < 1e-10);
    assert.ok(Math.abs(relativeVolume - 1) < 1e-10);
    assertArrayClose(body.relativeScale.toArray(), body.scale.toArray().map(value => value / radius));
    strongestImpact = Math.max(strongestImpact, body.uniforms.impact);
    greatestAnisotropy = Math.max(
      greatestAnisotropy,
      Math.max(body.scale.x, body.scale.y, body.scale.z)
        - Math.min(body.scale.x, body.scale.y, body.scale.z),
    );
  }
  assert.ok(strongestImpact > 0.05, "landing should feed the impact envelope");
  assert.ok(greatestAnisotropy > 0.025, "landing should visibly squash/stretch the blob");
});

test("beat impulses are edge-triggered while explicit pulses always fire", () => {
  const simulation = createJellyPhysics({
    gravity: [0, 0, 0],
    airDrag: 0,
    bodies: [{ radius: 1, mass: 1, position: [0, 4, 0] }],
  });
  const body = simulation.bodies[0];
  simulation.update(0, { beat: 1 });
  const firstVelocity = body.velocity.y;
  simulation.update(0, { beat: 1 });
  assert.equal(body.velocity.y, firstVelocity, "a held beat signal must not retrigger");
  simulation.update(0, { beat: 0 });
  simulation.update(0, { beat: 1 });
  assert.ok(body.velocity.y > firstVelocity * 1.9);
  const secondVelocity = body.velocity.y;
  simulation.update(0, { beatImpulse: 0.5 });
  simulation.update(0, { beatImpulse: 0.5 });
  assert.ok(body.velocity.y > secondVelocity);
  assert.equal(body.uniforms.beat, 1);
});

test("pointer shockwaves use smooth distance falloff and accept Vector3 input", () => {
  const simulation = createJellyPhysics({
    gravity: [0, 0, 0],
    bodies: [
      { radius: 0.5, mass: 1, position: [1, 2, 0] },
      { radius: 0.5, mass: 1, position: [4, 2, 0] },
      { radius: 0.5, mass: 1, position: [9, 2, 0] },
    ],
  });
  const affected = simulation.impulseAt(new THREE.Vector3(0, 2, 0), 10, 6, { verticalLift: 0 });
  assert.equal(affected, 2);
  assert.ok(simulation.bodies[0].velocity.length() > simulation.bodies[1].velocity.length());
  assert.equal(simulation.bodies[2].velocity.length(), 0);

  simulation.reset();
  simulation.update(0, {
    pointerShockwave: { position: [0, 2, 0], strength: 5, radius: 3, verticalLift: 0.4 },
  });
  assert.ok(simulation.bodies[0].velocity.y > 0);
  assert.equal(simulation.bodies[1].velocity.length(), 0);
});

test("bad deltas and inverted arenas fail loudly instead of poisoning poses", () => {
  const simulation = createJellyPhysics({ count: 1 });
  assert.throws(() => simulation.update(-0.1), RangeError);
  assert.throws(() => simulation.update(Number.NaN), RangeError);
  assert.throws(
    () => createJellyPhysics({ arena: { minX: 2, maxX: -2 } }),
    RangeError,
  );
});
