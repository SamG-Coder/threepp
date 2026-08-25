import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createPlayer } from "../src/actors/player.mjs";

function harness({ onMelee = null } = {}) {
  const held = new Set();
  const pressed = new Set();
  const move = { x: 0, z: 0 };
  const input = {
    movement: () => ({ ...move }),
    actionDown: action => held.has(action),
    actionPressed: action => pressed.delete(action),
  };
  const world = {
    spawnPoints: { player: [0, 0, 0] },
    terrainHeight: () => 0,
    sampleGround: () => ({ surfaceId: "road" }),
    resolveCircleMotion: (position, displacement) => position.clone().add(displacement),
  };
  const scene = new THREE.Scene();
  const sounds = [];
  const meleeEvents = [];
  const shots = [];
  const player = createPlayer({
    scene,
    world,
    input,
    onMelee: request => {
      meleeEvents.push(request);
      return onMelee?.(request) ?? { hit: true, hitCivilian: true, crimeHandled: true };
    },
    onShoot: request => {
      shots.push(request);
      return { hit: false, crimeHandled: true };
    },
    onSound: (name, volume) => sounds.push({ name, volume }),
  });
  return { player, scene, input, held, pressed, move, sounds, meleeEvents, shots };
}

test("player starts with a GTA-style pistol and minigun loadout", () => {
  const { player } = harness();
  try {
    assert.equal(player.snapshot().weapon, "pistol");
    assert.deepEqual(player.snapshot().ammo, { clip: 12, reserve: 180, reloading: false, reload: 0 });
    assert.deepEqual(player.snapshot().weapons.minigun, { clip: 200, reserve: 1_000_000 });
    assert.equal(player.selectWeapon("minigun"), true);
    assert.deepEqual(player.snapshot().ammo, { clip: 200, reserve: 1_000_000, reloading: false, reload: 0 });
    assert.equal(player.selectWeapon("pistol"), true);
    assert.deepEqual(player.snapshot().ammo, { clip: 12, reserve: 180, reloading: false, reload: 0 });
  } finally {
    player.dispose();
  }
});

test("pistol fire requires a completed aim-down-sights state", () => {
  const { player, held, shots } = harness();
  try {
    held.add("fire");
    player.update(1 / 60, { elapsed: 0, aimDirection: new THREE.Vector3(0, 0, -1) });
    assert.equal(player.snapshot().ammo.clip, 12, "hip fire must be blocked");
    assert.equal(shots.length, 0);

    held.add("aim");
    player.update(1 / 60, { elapsed: 0.1, aimDirection: new THREE.Vector3(0, 0, -1), canShoot: false });
    assert.equal(player.snapshot().ammo.clip, 12, "raising the sights must not release an early shot");
    player.update(1 / 60, { elapsed: 0.2, aimDirection: new THREE.Vector3(0, 0, -1), canShoot: true });
    assert.equal(player.snapshot().ammo.clip, 11);
    assert.equal(shots.length, 1);
    assert.equal(shots[0].aiming, true);

    const visual = player.root.children[0];
    assert.equal(player.setFirstPerson(true), true);
    assert.equal(visual.visible, false);
    assert.equal(player.setFirstPerson(false), false);
    assert.equal(visual.visible, true);
  } finally {
    player.dispose();
  }
});

test("weapon slots swap to a sustained minigun while preserving pistol ammunition", () => {
  const { player, held, pressed, shots } = harness();
  try {
    pressed.add("weaponMinigun");
    player.update(1 / 60, { elapsed: 0 });
    assert.equal(player.snapshot().weapon, "minigun");
    held.add("aim");
    held.add("fire");
    for (let frame = 0; frame < 12; ++frame) {
      player.update(0.06, { elapsed: 0.1 + frame * 0.06, canShoot: true, aimDirection: new THREE.Vector3(0, 0, -1) });
    }
    assert.ok(shots.length >= 10, `expected sustained automatic fire, got ${shots.length} shots`);
    assert.ok(shots.every(shot => shot.weapon === "minigun" && shot.damage === 24));
    assert.equal(player.snapshot().ammo.clip, 200 - shots.length);
    held.clear();
    pressed.add("weaponPistol");
    player.update(1 / 60, { elapsed: 1 });
    assert.equal(player.snapshot().weapon, "pistol");
    assert.deepEqual(player.snapshot().ammo, { clip: 12, reserve: 180, reloading: false, reload: 0 });
  } finally {
    player.dispose();
  }
});

test("player sprint stamina, footsteps, aim facing, and jump have physical state", () => {
  const testbed = harness();
  const { player, held, pressed, move, sounds } = testbed;
  try {
    move.z = 1;
    held.add("sprint");
    for (let index = 0; index < 120; ++index) player.update(1 / 60, { elapsed: index / 60 });
    const sprinted = player.snapshot();
    assert.ok(sprinted.distanceWalked > 8, sprinted);
    assert.ok(sprinted.stamina < 70 && sprinted.stamina > 50, sprinted);
    assert.ok(sounds.some(sound => sound.name === "footstep"));

    held.delete("sprint");
    move.z = 0;
    for (let index = 0; index < 180; ++index) player.update(1 / 60, { elapsed: 2 + index / 60 });
    assert.ok(player.snapshot().stamina > sprinted.stamina);

    held.add("aim");
    for (let index = 0; index < 30; ++index) {
      player.update(1 / 60, { elapsed: 5 + index / 60, aimDirection: new THREE.Vector3(-1, 0, 0) });
    }
    assert.equal(player.snapshot().aiming, true);
    assert.ok(Math.abs(player.root.rotation.y - Math.PI * 0.5) < 0.05, player.root.rotation.y);

    held.delete("aim");
    pressed.add("jump");
    player.update(1 / 60, { elapsed: 6 });
    assert.equal(player.snapshot().grounded, false);
    assert.ok(player.root.position.y > 0);
    for (let index = 0; index < 90; ++index) player.update(1 / 60, { elapsed: 6 + index / 60 });
    assert.equal(player.snapshot().grounded, true);
    assert.equal(player.root.position.y, 0);
  } finally {
    player.dispose();
  }
});

test("player damage and restore expose HUD feedback without invalid state", () => {
  const { player, sounds } = harness();
  try {
    const damaged = player.damage(30);
    assert.equal(damaged.accepted, true);
    assert.ok(player.snapshot().damageFlash > 0);
    assert.ok(sounds.some(sound => sound.name === "hurt"));
    assert.equal(player.heal(12), 12);
    assert.equal(player.snapshot().health, 82);
    assert.equal(player.heal(500), 18);
    assert.equal(player.snapshot().health, 100);
    player.restore({ ...player.snapshot(), stamina: 34 });
    assert.equal(player.restoreStamina(21), 21);
    assert.equal(player.snapshot().stamina, 55);
    assert.equal(player.restoreStamina(500), 45);
    assert.equal(player.snapshot().stamina, 100);
    player.restore({ ...player.snapshot(), stamina: 0 });
    for (let step = 0; step < 10; ++step) player.update(0.1, { elapsed: step * 0.1, staminaRecoveryMultiplier: 0.6 });
    const hungryRecovery = player.snapshot().stamina;
    player.restore({ ...player.snapshot(), stamina: 0 });
    for (let step = 0; step < 10; ++step) player.update(0.1, { elapsed: 1 + step * 0.1, staminaRecoveryMultiplier: 1 });
    assert.ok(hungryRecovery > 7.7 && hungryRecovery < 7.9);
    assert.ok(player.snapshot().stamina > hungryRecovery + 5, "appetite may gently affect recovery without draining stamina");
    player.update(1, { elapsed: 1 });
    assert.ok(player.snapshot().damageFlash < 0.72);
    const saved = player.snapshot();
    player.teleport(40, -20);
    player.restore(saved);
    const restored = player.snapshot();
    assert.deepEqual(restored.position, saved.position);
    assert.ok(Number.isFinite(restored.stamina));
    assert.ok(Number.isFinite(restored.verticalVelocity));
  } finally {
    player.dispose();
  }
});

test("player scalar getters mirror snapshot state through representative changes", () => {
  const { player, held, move, shots } = harness();
  const assertGetterParity = label => {
    const state = player.snapshot();
    assert.equal(player.health, state.health, `${label}: health`);
    assert.equal(player.armor, state.armor, `${label}: armor`);
    assert.equal(player.cash, state.cash, `${label}: cash`);
    assert.equal(player.stamina, state.stamina, `${label}: stamina`);
    assert.equal(player.muzzleFlash, state.muzzleFlash, `${label}: muzzle flash`);
    assert.equal(player.speed, state.speed, `${label}: speed`);
    return state;
  };
  try {
    assertGetterParity("spawn");

    player.addArmor(36);
    player.addCash(275);
    player.restore({ ...player.snapshot(), stamina: 42 });
    const equipped = assertGetterParity("equipment and restored stamina");
    assert.equal(equipped.armor, 36);
    assert.equal(equipped.cash, 1525);
    assert.equal(equipped.stamina, 42);

    const damaged = player.damage(20);
    assert.equal(damaged.accepted, true);
    const afterDamage = assertGetterParity("armor-absorbed damage");
    assert.ok(afterDamage.health < 100);
    assert.ok(afterDamage.armor < equipped.armor);

    move.z = 1;
    held.add("sprint");
    for (let frame = 0; frame < 18; ++frame) player.update(1 / 60, { elapsed: frame / 60 });
    const moving = assertGetterParity("sprinting");
    assert.ok(moving.speed > 0);
    assert.ok(moving.stamina < equipped.stamina);

    move.z = 0;
    held.delete("sprint");
    held.add("aim");
    held.add("fire");
    player.update(1 / 60, {
      elapsed: 1,
      aimDirection: new THREE.Vector3(0, 0, -1),
      canShoot: true,
    });
    const fired = assertGetterParity("muzzle flash");
    assert.equal(fired.muzzleFlash, true);
    assert.equal(shots.length, 1);

    held.delete("fire");
    player.update(0.1, {
      elapsed: 1.1,
      aimDirection: new THREE.Vector3(0, 0, -1),
      canShoot: true,
    });
    assert.equal(assertGetterParity("muzzle flash expiry").muzzleFlash, false);

    player.heal(5);
    assertGetterParity("healing");
    player.teleport(12, -8);
    assert.equal(assertGetterParity("teleport velocity reset").speed, 0);
    player.respawn();
    const respawned = assertGetterParity("respawn");
    assert.equal(respawned.health, 100);
    assert.equal(respawned.armor, 0);
    assert.equal(respawned.stamina, 100);
  } finally {
    player.dispose();
  }
});

test("player silhouette uses a detailed hierarchical street-character rig", () => {
  const { player } = harness();
  try {
    const visual = player.root.children[0];
    const rig = visual.userData.rig;
    assert.equal(visual.name, "Kai Mercer articulated street rig");
    assert.ok(rig.hips?.isGroup && rig.spine?.isGroup && rig.head?.isGroup);
    for (const limb of [rig.leftArm, rig.rightArm]) {
      assert.ok(limb.shoulder?.isGroup && limb.elbow?.isGroup && limb.hand?.isGroup);
      assert.equal(limb.elbow.parent, limb.shoulder);
      assert.equal(limb.hand.parent, limb.elbow);
    }
    for (const limb of [rig.leftLeg, rig.rightLeg]) {
      assert.ok(limb.hip?.isGroup && limb.knee?.isGroup && limb.foot?.isGroup);
      assert.equal(limb.knee.parent, limb.hip);
      assert.equal(limb.foot.parent, limb.knee);
    }
    for (const name of [
      "tapered fitted jacket", "left jacket lapel", "subtle jacket back yoke",
      "defined jaw", "left eyebrow", "ordinary canvas-strap watch", "right sneaker sole",
      "pistol slide", "pistol barrel", "pistol front sight", "massive black minigun receiver", "minigun barrel 6", "right hip holster",
    ]) assert.ok(visual.getObjectByName(name), `missing procedural detail: ${name}`);
    let meshCount = 0;
    visual.traverse(object => { if (object.isMesh) meshCount += 1; });
    assert.ok(meshCount >= 40, `expected a substantial silhouette, found ${meshCount} meshes`);
    assert.equal(visual.userData.muzzleAnchor.parent, rig.gun);
  } finally {
    player.dispose();
  }
});

test("locomotion, aim, recoil, and reload poses blend without snapping", () => {
  const { player, held, pressed, move } = harness();
  try {
    const visual = player.root.children[0];
    const { rig, poseState } = visual.userData;
    move.z = 1;
    held.add("sprint");
    for (let frame = 0; frame < 50; ++frame) player.update(1 / 60, { elapsed: frame / 60 });
    assert.ok(poseState.sprint > 0.98 && poseState.locomotion > 0.98);
    assert.ok(rig.spine.rotation.x < -0.09, "sprint should lean the articulated spine forward");
    assert.ok(Math.abs(rig.leftLeg.hip.rotation.x - rig.rightLeg.hip.rotation.x) > 0.4);

    held.delete("sprint");
    move.z = 0;
    player.update(1 / 60, { elapsed: 1 });
    assert.ok(poseState.sprint > 0.7, "the first idle frame should retain momentum in the pose blend");
    for (let frame = 0; frame < 90; ++frame) player.update(1 / 60, { elapsed: 1 + frame / 60 });
    assert.ok(poseState.sprint < 0.001 && poseState.locomotion < 0.001);
    assert.ok(Math.abs(rig.spine.rotation.x) < 0.002);

    held.add("aim");
    for (let frame = 0; frame < 30; ++frame) {
      player.update(1 / 60, { elapsed: 3 + frame / 60, aimDirection: new THREE.Vector3(0, 0, -1) });
    }
    assert.ok(poseState.aim > 0.98);
    assert.ok(rig.leftArm.shoulder.rotation.x > 0.9 && rig.rightArm.shoulder.rotation.x > 1);
    assert.ok(rig.leftArm.elbow.rotation.x > 0.4, "supporting hand should brace the pistol");
    assert.ok(rig.gun.rotation.x < -1.2, "pistol should counter-rotate through the arm chain and keep a level barrel");

    held.add("fire");
    player.update(1 / 60, { elapsed: 3.6, aimDirection: new THREE.Vector3(0, 0, -1) });
    held.delete("fire");
    assert.ok(poseState.recoil > 0.95);
    assert.equal(visual.userData.muzzleFlash.visible, true);

    player.setAmmo(4, 20);
    pressed.add("reload");
    for (let frame = 0; frame < 25; ++frame) {
      player.update(1 / 60, { elapsed: 4 + frame / 60, aimDirection: new THREE.Vector3(0, 0, -1) });
    }
    assert.equal(player.snapshot().ammo.reloading, true);
    assert.ok(poseState.reload > 0.98);
    assert.ok(rig.leftArm.elbow.rotation.x > 0.9);
    assert.ok(rig.gun.rotation.z > 0.25);
    assert.ok(rig.grip.position.y < -0.14, "magazine should visibly drop during the handoff");

    for (let frame = 0; frame < 50; ++frame) {
      player.update(1 / 60, { elapsed: 4.5 + frame / 60, aimDirection: new THREE.Vector3(0, 0, -1) });
    }
    assert.deepEqual(player.snapshot().ammo, { clip: 12, reserve: 12, reloading: false, reload: 0 });
    held.delete("aim");
    for (let frame = 0; frame < 70; ++frame) player.update(1 / 60, { elapsed: 5.5 + frame / 60 });
    assert.ok(poseState.reload < 0.001 && poseState.aim < 0.001);
    assert.ok(Math.abs(rig.gun.rotation.z) < 0.002);
  } finally {
    player.dispose();
  }
});

test("jump, landing, death, and respawn transition through readable body poses", () => {
  const { player, pressed } = harness();
  try {
    const visual = player.root.children[0];
    const { rig, poseState } = visual.userData;
    pressed.add("jump");
    player.update(1 / 60, { elapsed: 0 });
    for (let frame = 0; frame < 12; ++frame) player.update(1 / 60, { elapsed: frame / 60 });
    assert.equal(player.snapshot().grounded, false);
    assert.ok(poseState.airborne > 0.8);
    assert.ok(rig.leftLeg.knee.rotation.x > 0.35 && rig.rightLeg.knee.rotation.x > 0.25);

    let frames = 0;
    while (!player.snapshot().grounded && frames++ < 120) player.update(1 / 60, { elapsed: 1 + frames / 60 });
    assert.ok(frames < 120, "player should land within the bounded jump arc");
    assert.ok(poseState.landing > 0.45);
    assert.ok(rig.hips.position.y < 0.95, "landing should compress the hips");
    assert.ok(rig.leftLeg.knee.rotation.x > 0.55 && rig.rightLeg.knee.rotation.x > 0.55);

    for (let frame = 0; frame < 60; ++frame) player.update(1 / 60, { elapsed: 3 + frame / 60 });
    assert.equal(poseState.landing, 0);
    assert.ok(Math.abs(rig.hips.position.y - 0.96) < 0.002);

    player.damage(500, { ignoreArmor: true });
    for (let frame = 0; frame < 30; ++frame) player.update(1 / 60, { elapsed: 4 + frame / 60 });
    assert.equal(player.snapshot().alive, false);
    assert.ok(player.root.rotation.z < -1.2);
    assert.ok(Math.abs(rig.spine.rotation.z) > 0.18);
    assert.ok(Math.abs(rig.leftArm.shoulder.rotation.x - rig.rightArm.shoulder.rotation.x) > 0.5);

    player.respawn();
    assert.equal(player.snapshot().alive, true);
    assert.equal(player.root.rotation.z, 0);
    assert.equal(Math.abs(rig.spine.rotation.x) + Math.abs(rig.spine.rotation.y) + Math.abs(rig.spine.rotation.z), 0);
    assert.equal(Math.abs(rig.leftLeg.knee.rotation.x) + Math.abs(rig.leftLeg.knee.rotation.y) + Math.abs(rig.leftLeg.knee.rotation.z), 0);
    assert.equal(poseState.airborne, 0);
  } finally {
    player.dispose();
  }
});

test("melee has a single deterministic strike window, articulated pose, combo damage, and cooldown", () => {
  const { player, pressed, sounds, meleeEvents } = harness();
  try {
    const visual = player.root.children[0];
    const { rig, poseState } = visual.userData;
    pressed.add("melee");
    player.update(1 / 60, { elapsed: 0, aimDirection: new THREE.Vector3(-1, 0, 0) });
    assert.equal(player.snapshot().melee.active, true);
    assert.equal(player.snapshot().melee.count, 1);
    assert.ok(Math.abs(player.root.rotation.y - Math.PI * 0.5) < 0.001);
    assert.ok(sounds.some(sound => sound.name === "melee"));

    for (let frame = 0; frame < 8; ++frame) player.update(1 / 60, { elapsed: (frame + 1) / 60 });
    assert.ok(poseState.melee > 0.8, poseState);
    assert.ok(Math.abs(rig.spine.rotation.y) > 0.04, "the torso should wind through the strike");
    assert.ok(Math.abs(rig.rightArm.shoulder.rotation.x - rig.leftArm.shoulder.rotation.x) > 0.35);
    for (let frame = 0; frame < 12; ++frame) player.update(1 / 60, { elapsed: (frame + 9) / 60 });
    assert.equal(meleeEvents.length, 1, "one input must create exactly one damage window");
    assert.equal(meleeEvents[0].comboIndex, 1);
    assert.equal(meleeEvents[0].damage, 32);
    assert.ok(Math.abs(meleeEvents[0].direction.length() - 1) < 1e-6);
    assert.ok(meleeEvents[0].origin.toArray().every(Number.isFinite));

    pressed.add("melee");
    player.update(1 / 60, { elapsed: 0.4 });
    assert.equal(player.snapshot().melee.count, 1, "cooldown should reject button mashing");
    for (let frame = 0; frame < 30; ++frame) player.update(1 / 60, { elapsed: 0.5 + frame / 60 });
    pressed.add("melee");
    player.update(1 / 60, { elapsed: 1.1 });
    assert.equal(player.snapshot().melee.count, 2);
    player.enterVehicle({ id: "test-car", root: new THREE.Group() });
    assert.equal(player.snapshot().melee.active, false);
    player.exitVehicle(new THREE.Vector3());
    player.respawn();
    assert.equal(player.snapshot().melee.cooldown, 0);
  } finally {
    player.dispose();
  }
});

test("precreated story phone blends a one-handed listening pose and yields safely to combat states", () => {
  const { player, held } = harness();
  try {
    const visual = player.root.children[0];
    const { rig, poseState } = visual.userData;
    const phone = rig.phone;
    const geometryRefs = [...visual.userData.geometries];
    const materialRefs = [...visual.userData.materials];
    const visualChildCount = visual.children.length;
    const phoneChildCount = phone.children.length;

    assert.equal(phone.name, "precreated story phone");
    assert.equal(phone.visible, false);
    assert.equal(phone.parent, rig.rightArm.hand);
    for (const name of [
      "phone dark ceramic body", "phone unlit glass screen", "phone earpiece speaker", "phone camera lens",
    ]) assert.ok(phone.getObjectByName(name), `missing precreated phone detail: ${name}`);

    for (let frame = 0; frame < 90; ++frame) {
      assert.equal(player.update(1 / 60, {
        elapsed: frame / 60,
        phoneCall: true,
        captureSnapshot: false,
      }), null);
    }
    const listening = player.snapshot();
    assert.deepEqual(listening.phoneCall, {
      requested: true,
      active: true,
      blend: listening.phoneCall.blend,
      visible: true,
      precreated: true,
      storage: "memory-only",
      geometryCount: 4,
      runtimeAllocations: 0,
    });
    assert.ok(listening.phoneCall.blend > 0.999);
    assert.ok(Number.isFinite(listening.phoneCall.blend));
    assert.ok(Number.isFinite(poseState.phoneCall));
    assert.equal(rig.gun.visible, false, "the held sidearm must not share the phone silhouette");
    assert.ok(rig.rightArm.shoulder.rotation.z > 2 && rig.rightArm.shoulder.rotation.z < 2.4);
    assert.ok(rig.rightArm.elbow.rotation.z > 1.9 && rig.rightArm.elbow.rotation.z < 2.3);
    player.root.updateMatrixWorld(true);
    const phonePosition = phone.getWorldPosition(new THREE.Vector3());
    const headPosition = rig.head.getWorldPosition(new THREE.Vector3());
    assert.ok(phonePosition.distanceTo(headPosition) < 0.46, { phonePosition, headPosition });

    assert.equal(visual.children.length, visualChildCount);
    assert.equal(phone.children.length, phoneChildCount);
    assert.ok(geometryRefs.every((geometry, index) => geometry === visual.userData.geometries[index]));
    assert.ok(materialRefs.every((material, index) => material === visual.userData.materials[index]));

    const raisedShoulder = rig.rightArm.shoulder.rotation.z;
    player.update(1 / 60, { elapsed: 2, phoneCall: false });
    assert.ok(rig.rightArm.shoulder.rotation.z > 1.6 && rig.rightArm.shoulder.rotation.z < raisedShoulder,
      "ending a call should begin a bounded arm blend, not snap to idle");
    assert.equal(phone.visible, true, "the prop should lower with the hand before being hidden");
    for (let frame = 0; frame < 90; ++frame) player.update(1 / 60, { elapsed: 2 + frame / 60 });
    assert.ok(poseState.phoneCall < 0.001);
    assert.ok(Math.abs(rig.rightArm.shoulder.rotation.z) < 0.002);
    assert.ok(Math.abs(rig.rightArm.elbow.rotation.z) < 0.002);
    assert.equal(phone.visible, false);

    held.add("aim");
    player.update(1 / 60, {
      elapsed: 4,
      phoneCall: true,
      aimDirection: new THREE.Vector3(0, 0, -1),
    });
    assert.equal(player.snapshot().phoneCall.active, false);
    assert.equal(phone.visible, false, "aiming must suppress the phone on its first frame");
    assert.equal(rig.gun.visible, true);
    for (let frame = 0; frame < 45; ++frame) player.update(1 / 60, {
      elapsed: 4 + frame / 60,
      phoneCall: true,
      aimDirection: new THREE.Vector3(0, 0, -1),
    });
    assert.ok(poseState.aim > 0.99);
    assert.equal(phone.visible, false);

    held.delete("aim");
    for (let frame = 0; frame < 45; ++frame) player.update(1 / 60, {
      elapsed: 5 + frame / 60,
      phoneCall: true,
    });
    assert.equal(player.snapshot().phoneCall.active, true);
    assert.equal(phone.visible, true);
    assert.equal(rig.gun.visible, false);

    player.update(1 / 60, { elapsed: 6, phoneCall: true, arrested: true });
    assert.equal(player.snapshot().phoneCall.active, false);
    assert.equal(phone.visible, false, "custody must suppress the phone immediately");
    player.damage(500, { ignoreArmor: true });
    assert.equal(player.snapshot().phoneCall.active, false);
    assert.equal(phone.visible, false, "death must suppress the phone immediately");

    player.respawn();
    assert.deepEqual(player.snapshot().phoneCall, {
      requested: false,
      active: false,
      blend: 0,
      visible: false,
      precreated: true,
      storage: "memory-only",
      geometryCount: 4,
      runtimeAllocations: 0,
    });
    assert.equal(poseState.phoneCall, 0);
  } finally {
    player.dispose();
  }
});
