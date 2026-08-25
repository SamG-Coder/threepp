import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import {
  DOMAIN_DEFINITIONS,
  HANDOFF_SECONDS,
  SETTLEMENT_SECONDS,
  sampleJourney,
} from "../src/scale-model.mjs";
import { createScaleSystem } from "../src/scale-system.mjs";

function directedSample(seconds, direction) {
  return { ...sampleJourney(seconds), direction, cycle: 0 };
}

function frame(system, sample, time) {
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.001, 100);
  const target = new THREE.Vector3();
  const scaleState = system.update(sample, time, 1 / 60, camera, target);
  return {
    position: camera.position.clone(),
    target: target.clone(),
    direction: target.clone().sub(camera.position).normalize(),
    fov: camera.fov,
    scaleState,
  };
}

test("forward and reverse rebases preserve the visible frame at all seven boundaries", () => {
  let boundary = 0;
  const epsilon = 1e-5;
  for (const definition of DOMAIN_DEFINITIONS) {
    boundary += definition.seconds;
    const forwardSystem = createScaleSystem(new THREE.Scene());
    const forwardBefore = frame(forwardSystem, directedSample(boundary - epsilon, 1), boundary);
    const forwardAfter = frame(forwardSystem, directedSample(boundary + epsilon, 1), boundary + 1 / 60);
    assert.ok(forwardBefore.position.distanceTo(forwardAfter.position) < 0.03, definition.id);
    assert.ok(forwardBefore.direction.dot(forwardAfter.direction) > 0.9999, definition.id);
    assert.ok(Math.abs(forwardBefore.fov - forwardAfter.fov) < 0.02, definition.id);
    forwardSystem.dispose();

    const reverseSystem = createScaleSystem(new THREE.Scene());
    const reverseBefore = frame(reverseSystem, directedSample(boundary + epsilon, -1), boundary);
    const reverseAfter = frame(reverseSystem, directedSample(boundary - epsilon, -1), boundary + 1 / 60);
    assert.ok(reverseBefore.position.distanceTo(reverseAfter.position) < 0.03, definition.id);
    assert.ok(reverseBefore.direction.dot(reverseAfter.direction) > 0.9999, definition.id);
    assert.ok(Math.abs(reverseBefore.fov - reverseAfter.fov) < 0.02, definition.id);
    reverseSystem.dispose();
  }
});

test("reversing during an overlap unwinds the same neighbor without a one-frame cut", () => {
  const system = createScaleSystem(new THREE.Scene());
  const duration = DOMAIN_DEFINITIONS[0].seconds;
  const overlapSecond = duration - HANDOFF_SECONDS * 0.5;
  const forward = frame(system, directedSample(overlapSecond, 1), 1).scaleState;
  const reversed = frame(system, directedSample(overlapSecond - 0.001, -1), 1 + 1 / 60).scaleState;
  assert.equal(forward.next.id, "surface");
  assert.equal(reversed.next.id, "surface");
  assert.ok(reversed.transitionAmount > 0);
  assert.equal(reversed.streaming.find(item => item.id === "surface")?.state, "transition");
  system.dispose();
});

test("the outgoing root retires while the incoming similarity transform settles", () => {
  const system = createScaleSystem(new THREE.Scene());
  const boundary = DOMAIN_DEFINITIONS[0].seconds;
  frame(system, directedSample(boundary - 1e-5, 1), 1);
  const after = frame(system, directedSample(boundary + 1e-5, 1), 1 + 1 / 60).scaleState;
  assert.equal(after.settling, true);
  assert.equal(after.streaming.find(item => item.id === "forge")?.state, "retiring");
  assert.equal(after.streaming.find(item => item.id === "forge")?.visible, true);
  const settled = frame(
    system,
    directedSample(boundary + SETTLEMENT_SECONDS + 0.01, 1),
    1 + SETTLEMENT_SECONDS + 0.01,
  ).scaleState;
  assert.equal(settled.settling, false);
  assert.notEqual(settled.streaming.find(item => item.id === "forge")?.state, "retiring");
  system.dispose();
});

test("the incoming world begins near matched projection and behind the focal surface", () => {
  const system = createScaleSystem(new THREE.Scene());
  const duration = DOMAIN_DEFINITIONS[0].seconds;
  const shot = frame(
    system,
    directedSample(duration - HANDOFF_SECONDS + 0.12, 1),
    1,
  );
  const forge = system.byId.get("forge");
  const surface = system.byId.get("surface");
  const gateway = forge.gatewayPosition.clone()
    .multiplyScalar(forge.root.scale.x)
    .applyQuaternion(forge.root.quaternion)
    .add(forge.root.position);
  const canonicalCamera = new THREE.PerspectiveCamera(48, 16 / 9, 0.001, 100);
  const canonicalTarget = new THREE.Vector3();
  forge.sampleCamera(1, canonicalCamera, canonicalTarget);
  const focusDistanceRatio = shot.position.distanceTo(gateway) /
    canonicalCamera.position.distanceTo(forge.gatewayPosition);
  assert.ok(focusDistanceRatio <= 0.241, focusDistanceRatio);
  const finalScale = shot.position.distanceTo(gateway) / surface.entryFrame.distance;
  const projectionRatio = surface.root.scale.x / finalScale;
  assert.ok(projectionRatio >= 0.65 && projectionRatio <= 1, projectionRatio);

  const exitDirection = gateway.clone().sub(shot.position).normalize();
  const scaledEntryTarget = surface.entryFrame.target.clone()
    .multiplyScalar(surface.root.scale.x)
    .applyQuaternion(surface.root.quaternion);
  const alignedPosition = gateway.clone().sub(scaledEntryTarget);
  const depthOffset = surface.root.position.clone().sub(alignedPosition).dot(exitDirection);
  assert.ok(depthOffset > 0, depthOffset);
  system.dispose();
});
