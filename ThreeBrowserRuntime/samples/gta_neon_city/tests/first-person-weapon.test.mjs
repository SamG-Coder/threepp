import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createFirstPersonWeapon } from "../src/actors/first-person-weapon.mjs";

test("first-person weapon raises aligned iron sights and owns camera-space recoil", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const scene = new THREE.Scene();
  scene.add(camera);
  const weapon = createFirstPersonWeapon(camera);
  try {
    assert.equal(weapon.root.parent, camera);
    assert.equal(weapon.snapshot().visible, false);
    assert.ok(weapon.root.scale.x < 0.8, "the ADS viewmodel must leave an open sight picture");
    for (let frame = 0; frame < 60; ++frame) {
      weapon.update(1 / 60, { aiming: true, speed: 1.2, elapsed: frame / 60 });
    }
    assert.equal(weapon.snapshot().mode, "pistol-sight");
    assert.equal(weapon.snapshot().visible, true);
    for (const name of [
      "FPS pistol machined slide",
      "FPS rear sight left post",
      "FPS rear sight right post",
      "FPS front sight centered post",
      "FPS support hand",
      "FPS trigger hand",
    ]) assert.ok(weapon.root.getObjectByName(name), `missing viewmodel part: ${name}`);
    const muzzle = weapon.getMuzzleWorld();
    assert.ok(muzzle.toArray().every(Number.isFinite));
    assert.ok(muzzle.z < -0.8, muzzle.toArray());

    weapon.update(1 / 60, { aiming: true, weapon: "minigun", elapsed: 1.05 });
    assert.equal(weapon.snapshot().mode, "minigun-sight");
    assert.ok(weapon.root.getObjectByName("FPS massive black minigun asset"));
    assert.ok(weapon.root.getObjectByName("FPS minigun huge ammunition drum"));
    assert.ok(weapon.root.getObjectByName("FPS minigun long black barrel 6"));
    assert.ok(weapon.root.getObjectByName("FPS rotating six-barrel cluster"));

    weapon.update(1 / 60, { aiming: true, muzzleFlash: true, elapsed: 1.1 });
    assert.equal(weapon.snapshot().muzzleFlash, true);
    assert.ok(weapon.snapshot().recoil > 0);
    for (let frame = 0; frame < 20; ++frame) weapon.update(1 / 60, { aiming: false, elapsed: 1.2 + frame / 60 });
    assert.equal(weapon.snapshot().visible, false);
  } finally {
    weapon.dispose();
  }
  assert.equal(weapon.root.parent, null);
});
