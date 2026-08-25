import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createChaseCamera } from "../src/core/chase-camera.mjs";

test("spring chase camera follows driving yaw, speed FOV, aiming, and shake", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const look = { x: 0, y: 0, wheel: 0 };
  const input = {
    pointer: { locked: true },
    consumeLookDelta() { return { ...look }; },
    actionPressed() { return false; },
  };
  const world = { clipCamera(_anchor, desired) { return desired.clone(); } };
  const chase = createChaseCamera(camera, input, world);
  const target = {
    isVehicle: true,
    root: { position: new THREE.Vector3(12, 0, -8), rotation: { y: Math.PI * 0.5 } },
    state: { yaw: Math.PI * 0.5 },
  };
  for (let index = 0; index < 120; ++index) {
    chase.update(1 / 60, target, { driving: true, speed: 28, steering: 0.7, lateralSpeed: 2 });
  }
  assert.ok(camera.fov > 66, camera.fov);
  assert.ok(Math.abs(chase.snapshot().yaw - Math.PI * 0.5) < 0.35, chase.snapshot());
  assert.ok(Math.abs(chase.snapshot().roll) > 0.005, chase.snapshot());
  chase.shake(0.2, 0.5);
  chase.update(1 / 60, target, { driving: true, speed: 28 });
  assert.ok(chase.snapshot().shake > 0);

  target.isVehicle = false;
  for (let index = 0; index < 120; ++index) chase.update(1 / 60, target, { aiming: true });
  assert.ok(camera.fov < 49, camera.fov);
  assert.equal(chase.snapshot().perspective, "first-person-aim");
  assert.equal(chase.snapshot().aimBlend, 1);
  const eye = new THREE.Vector3(12, 1.65, -8);
  assert.ok(camera.position.distanceTo(eye) < 0.45, `aim camera should be at eye level, got ${camera.position.toArray()}`);
  const ray = chase.aimRay();
  assert.ok(Math.abs(ray.direction.length() - 1) < 1e-9);
  assert.ok(camera.position.toArray().every(Number.isFinite));
});

test("mouse orbit keeps a stable upright third-person pivot with intuitive vertical control", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const look = { x: 0, y: 0, wheel: 0 };
  const input = {
    pointer: { locked: true },
    consumeLookDelta() {
      const value = { ...look };
      look.x = 0;
      look.y = 0;
      return value;
    },
    actionPressed() { return false; },
  };
  const world = { clipCamera(_anchor, desired) { return desired.clone(); } };
  const chase = createChaseCamera(camera, input, world);
  const target = {
    root: { position: new THREE.Vector3(0, 0, 0), rotation: { y: 0 } },
    getCameraAnchor(output) { return output.set(0, 1.45, 0); },
  };
  for (let frame = 0; frame < 30; ++frame) chase.update(1 / 60, target);
  assert.ok(camera.position.y > 2.4, `default third-person camera should sit above the shoulders, got ${camera.position.y}`);
  const beforeYaw = chase.snapshot().yaw;
  const beforePitch = chase.snapshot().pitch;
  look.x = 120;
  look.y = 80;
  chase.update(1 / 60, target);
  for (let frame = 0; frame < 20; ++frame) chase.update(1 / 60, target);
  assert.ok(chase.snapshot().yaw < beforeYaw - 0.2, chase.snapshot());
  assert.ok(chase.snapshot().pitch > beforePitch + 0.12, chase.snapshot());
  assert.ok(Math.abs(camera.rotation.z) < 1e-12, "mouse orbit must never roll the on-foot camera");
  assert.ok(camera.position.y > 2.8, "dragging down should orbit upward and look down at the pivot");
  const ray = chase.aimRay();
  assert.ok(ray.direction.y < 0, "a camera above the player should aim down toward the street");
});

test("third- and first-person rigs share one world-up yaw/pitch orientation across a full orbit", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const input = {
    pointer: { locked: true },
    consumeLookDelta() { return { x: 0, y: 0, wheel: 0 }; },
    actionPressed() { return false; },
  };
  const chase = createChaseCamera(camera, input, { clipCamera(_anchor, desired) { return desired.clone(); } });
  const target = {
    root: { position: new THREE.Vector3(3, 0, -5), rotation: { y: 0 } },
    getCameraAnchor(output) { return output.set(3, 1.45, -5); },
  };
  const actualForward = new THREE.Vector3();
  const actualUp = new THREE.Vector3();
  const localUp = new THREE.Vector3(0, 1, 0);
  for (const [yaw, pitch] of [
    [0, 0.22],
    [Math.PI * 0.5, 0.48],
    [Math.PI, -0.08],
    [-Math.PI * 0.5, 0.64],
    [Math.PI * 1.75, 0.3],
  ]) {
    chase.state.targetYaw = yaw;
    chase.state.targetPitch = pitch;
    for (let frame = 0; frame < 90; ++frame) chase.update(1 / 60, target);
    camera.getWorldDirection(actualForward);
    assert.ok(actualForward.dot(chase.forward) > 0.999999, {
      yaw,
      pitch,
      actual: actualForward.toArray(),
      expected: chase.forward.toArray(),
    });
    actualUp.copy(localUp).applyQuaternion(camera.quaternion);
    assert.ok(actualUp.y > 0.72, `camera must remain upright at yaw=${yaw}, pitch=${pitch}: ${actualUp.toArray()}`);
    assert.ok(Math.abs(camera.rotation.z) < 1e-9, `on-foot roll leaked into orbit: ${camera.rotation.z}`);
  }

  const directionBeforeAim = camera.getWorldDirection(new THREE.Vector3());
  for (let frame = 0; frame < 90; ++frame) chase.update(1 / 60, target, { aiming: true });
  const directionInAim = camera.getWorldDirection(new THREE.Vector3());
  assert.equal(chase.snapshot().perspective, "first-person-aim");
  assert.ok(directionBeforeAim.dot(directionInAim) > 0.999999, "switching perspective must not reinterpret yaw or pitch");
  for (let frame = 0; frame < 90; ++frame) chase.update(1 / 60, target, { aiming: false });
  assert.equal(chase.snapshot().perspective, "third-person");
  assert.ok(directionInAim.dot(camera.getWorldDirection(new THREE.Vector3())) > 0.999999);
  assert.equal(camera.rotation.order, "YXZ");
});

test("a thin centered obstruction selects one clear rear quarter and releases it without popping", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  scene.add(camera);
  const input = {
    pointer: { locked: true },
    consumeLookDelta() { return { x: 0, y: 0, wheel: 0 }; },
    actionPressed() { return false; },
  };
  let normalClear = false;
  const probeOutputs = new Set();
  const world = {
    clipCamera(anchor, desired, _radius, output) {
      assert.ok(output?.isVector3, "the hot path should supply a reusable clip output");
      probeOutputs.add(output);
      const side = desired.x - anchor.x;
      const lift = desired.y - anchor.y;
      const centered = Math.abs(side) < 0.45;
      const rightQuarter = side > 1;
      const highQuarter = lift > 4;
      if (centered && normalClear || rightQuarter && !highQuarter) return output.copy(desired);
      return output.copy(anchor).lerp(desired, 0.2);
    },
  };
  const chase = createChaseCamera(camera, input, world);
  const target = {
    isVehicle: true,
    root: { position: new THREE.Vector3(0, 0, 0), rotation: { y: 0 } },
    state: { yaw: 0 },
  };
  let nodes = 0;
  scene.traverse(() => { nodes += 1; });
  for (let frame = 0; frame < 60; ++frame) chase.update(1 / 60, target, { driving: true });
  assert.equal(chase.snapshot().obstructionFallback, "rear-right");
  assert.ok(chase.snapshot().obstructionDistance >= 3.2);
  assert.equal(probeOutputs.size, 4,
    "normal, rear-left, rear-right and high-quarter probes should reuse four fixed vectors");

  normalClear = true;
  for (let frame = 0; frame < 6; ++frame) chase.update(1 / 60, target, { driving: true });
  assert.equal(chase.snapshot().obstructionFallback, "rear-right",
    "a brief clear sample must not pop immediately back across the vehicle");
  assert.ok(chase.snapshot().obstructionHold > 0);
  for (let frame = 0; frame < 20; ++frame) chase.update(1 / 60, target, { driving: true });
  assert.equal(chase.snapshot().obstructionFallback, "normal");
  assert.equal(chase.snapshot().obstructionHold, 0);
  assert.ok(camera.position.toArray().every(Number.isFinite));
  let nodesAfter = 0;
  scene.traverse(() => { nodesAfter += 1; });
  assert.equal(nodesAfter, nodes, "fallback probing must not add camera or scene nodes");
});

test("a boxed-in wall keeps the nearest legal normal view and never contaminates ADS", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  scene.add(camera);
  const probeOutputs = new Set();
  const input = {
    pointer: { locked: true },
    consumeLookDelta() { return { x: 0, y: 0, wheel: 0 }; },
    actionPressed() { return false; },
  };
  const world = {
    clipCamera(anchor, desired, _radius, output) {
      probeOutputs.add(output);
      return output.copy(anchor).lerp(desired, 0.2);
    },
  };
  const chase = createChaseCamera(camera, input, world);
  const target = {
    root: { position: new THREE.Vector3(0, 0, 0), rotation: { y: 0 } },
    getCameraAnchor(output) { return output.set(0, 1.45, 0); },
  };
  for (let frame = 0; frame < 60; ++frame) chase.update(1 / 60, target);
  assert.equal(chase.snapshot().obstructionFallback, "normal",
    "when no candidate reaches the safe envelope the camera must not jump through a wall");
  assert.ok(chase.snapshot().obstructionDistance < 3.2);
  assert.equal(probeOutputs.size, 4);

  for (let frame = 0; frame < 90; ++frame) chase.update(1 / 60, target, { aiming: true });
  assert.equal(chase.snapshot().perspective, "first-person-aim");
  assert.equal(chase.snapshot().obstructionFallback, "normal");
  assert.equal(chase.snapshot().obstructionHold, 0);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(0, 1.65, 0)) < 0.45,
    `boxed-in third-person probes must not displace ADS: ${camera.position.toArray()}`);
});
