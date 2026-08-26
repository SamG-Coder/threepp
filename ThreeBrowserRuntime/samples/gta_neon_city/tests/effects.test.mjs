import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createGameEffects } from "../src/game/effects.mjs";

test("gameplay effects pool tracers, blood, impacts, exhaust, tyre marks, wet spray, and pickups", () => {
  const scene = new THREE.Scene();
  const world = { terrainHeight: () => 0 };
  const effects = createGameEffects({ scene, world });
  try {
    const tracer = effects.shot(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0, 1.2, -8), { hit: true, hitVehicle: true });
    assert.equal(tracer.visible, true);
    const impact = effects.impact(new THREE.Vector3(1, 1, -2), { hitCivilian: true, heavy: true });
    assert.ok(impact.length >= 15, "a heavy human impact should include pooled spray and a ground stain");
    assert.ok(impact.every(object => object.visible));
    assert.ok(impact.some(object => object.name.includes("blood droplet")));
    assert.ok(impact.some(object => object.name.includes("blood ground stain")));
    const puff = effects.exhaust(new THREE.Vector3(2, 0, 3), Math.PI * 0.5, 0.8);
    assert.ok(puff?.visible);
    assert.equal(effects.exhaust(new THREE.Vector3(), 0, 1), null, "exhaust should be rate-limited");
    const damagePuffs = effects.vehicleDamage(new THREE.Vector3(3, 0, -4), 0.25, 0.92, { id: "wreck-1", burning: true });
    assert.equal(damagePuffs.length, 2);
    assert.ok(damagePuffs.every(effect => effect.visible && effect.position.toArray().every(Number.isFinite)));
    assert.equal(effects.vehicleDamage(new THREE.Vector3(), 0, 1, { id: "wreck-1", burning: true }).length, 0,
      "damage smoke should be rate-limited per vehicle");
    const marks = effects.skid(new THREE.Vector3(4, 0, 5), 0.3, 1.3, 0.9);
    assert.equal(marks.length, 2);
    assert.ok(marks.every(mark => mark.visible && mark.position.toArray().every(Number.isFinite)));
    assert.equal(effects.skid(new THREE.Vector3(), 0, 1, 1).length, 0, "skids should be rate-limited");
    const spray = effects.tireSpray(new THREE.Vector3(4, 0, 5), 0.3, 1.3, 0.9);
    assert.equal(spray.length, 4);
    assert.ok(spray.every(puff => puff.visible && puff.position.toArray().every(Number.isFinite)));
    assert.equal(effects.tireSpray(new THREE.Vector3(), 0, 1, 1).length, 0, "wet spray should be rate-limited");
    effects.update(0.1, 0.1);
    assert.equal(tracer.visible, false);
    assert.ok(spray.some(puff => puff.visible), "wet spray should fade over multiple frames");

    effects.setMissionTarget("interior", new THREE.Vector3(8, 0, -11));
    assert.equal(effects.marker.scale.x, 0.36, "indoor work stations should use a compact guidance marker");
    effects.setMissionTarget("contact", new THREE.Vector3(9, 0, -12));
    assert.equal(effects.marker.scale.x, 1, "street guidance must restore the full-size marker");
    assert.equal(effects.marker.visible, true);
    effects.update(0.1, 0.2, { guidanceVisible: false });
    assert.equal(effects.marker.visible, false,
      "authored presentation must suppress the pooled 3D guidance beam before rendering");

    const healthPickup = effects.pickups.find(pickup => pickup.type === "health");
    const collected = effects.collect(healthPickup.object.position);
    assert.equal(collected[0].type, "health");
    assert.equal(healthPickup.object.visible, false);
    effects.update(0.1, 25);
    assert.equal(healthPickup.object.visible, false);
    for (let index = 0; index < 241; ++index) effects.update(0.1, 25 + index * 0.1);
    assert.equal(healthPickup.object.visible, true);
    assert.equal(effects.root.parent, scene);
  } finally {
    effects.dispose();
  }
  assert.equal(effects.root.parent, null);
});
