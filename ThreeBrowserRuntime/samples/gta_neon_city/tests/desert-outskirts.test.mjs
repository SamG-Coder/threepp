import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createDesertOutskirts } from "../src/world/desert-outskirts.mjs";

test("Ashwind desert reveals distant ruins and wakes finite husks only near the site", () => {
  const scene = new THREE.Scene();
  const damage = [];
  const world = { blockers: [] };
  const outskirts = createDesertOutskirts({ scene, world, onPlayerDamage: amount => damage.push(amount) });
  try {
    assert.ok(outskirts.root.getObjectByName("traversable wind-rippled desert floor"));
    assert.ok(outskirts.root.getObjectByName("weathered ruin column 6"));
    assert.equal(outskirts.snapshot().remainingHusks, 10);
    assert.equal(outskirts.snapshot().discovered, false);
    assert.equal(world.blockers.length, 10, "breach walls, columns and lintels must all enter collision world");
    assert.equal(outskirts.supportHeightAt(0, 505, 1.2, 0.12), 1.35,
      "the buried foundation must be a landable platform");
    outskirts.update(1 / 60, new THREE.Vector3(0, 0, 250));
    assert.equal(outskirts.snapshot().activeHusks, 0);
    assert.equal(outskirts.snapshot().cutsceneActive, true);
    assert.equal(outskirts.presentation()?.line.shot, "desert_arrival_wide");
    const mara = {
      root: new THREE.Group(),
      homePosition: new THREE.Vector3(),
      active: true,
      storyLocked: false,
      storyProtected: false,
    };
    scene.add(mara.root);
    assert.equal(outskirts.bindFriend(mara, { returnPosition: new THREE.Vector3(0, 0.2, 180) }), true);
    assert.equal(mara.root.position.y, 1.35, "Mara must spawn on top of the ruin foundation collider");
    assert.ok(mara.root.getObjectByName("Mara Velez floating name tag"));
    outskirts.update(1 / 60, new THREE.Vector3(0, 0, 505));
    assert.equal(outskirts.snapshot().activeHusks, 10);
    const first = outskirts.husks[0];
    const origin = first.root.position.clone().add(new THREE.Vector3(0, 1.2, -8));
    const hit = outskirts.raycast(origin, new THREE.Vector3(0, 0, 1), 20);
    assert.equal(hit?.actor, first);
    assert.equal(outskirts.damage(first, 100).defeated, true);
    assert.equal(outskirts.damage({ id: "mara-desert-friend", friend: true }, 100).protected, true);
    assert.equal(outskirts.snapshot().remainingHusks, 9);
    for (const husk of outskirts.husks) outskirts.damage(husk, 100);
    outskirts.update(1 / 60, new THREE.Vector3(0, 0, 505));
    assert.equal(outskirts.presentation()?.line.text, "Thank you, Kai. I can make it back through the breach now.");
    assert.equal(outskirts.snapshot().friend.returning, true);
  } finally {
    outskirts.dispose();
  }
  assert.equal(outskirts.root.parent, null);
  assert.equal(world.blockers.length, 0);
});
