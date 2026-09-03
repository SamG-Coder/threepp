import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canInteractWithCarryable, carryableDropPoint } from "../src/carryable-system.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function glbJson(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

test("Studio shovel GLB preserves its detailed assembly and PBR material roles", async () => {
  const bytes = await readFile(join(sampleRoot, "assets", "models", "detailed-beach-shovel.glb"));
  const json = glbJson(bytes);
  assert.equal(json.nodes.length, 19);
  assert.equal(json.meshes.length, 18);
  for (const name of ["Digging Spade Blade", "Spade Centre Rib", "Left Spade Step", "Ash Shaft", "D Grip", "Lower Rivet"]) {
    assert.ok(json.nodes.some(node => node.name === name), `${name} is missing`);
  }
  const grip = json.nodes.find(node => node.name === "D Grip");
  assert.deepEqual(grip.rotation.map(value => Math.round(value * 1e12) / 1e12), [0.5, 0.5, -0.5, 0.5]);
  for (const name of ["Forged Blade", "Blade Spine", "Left Foot Tread", "Right Foot Tread"]) {
    assert.equal(json.nodes.find(node => node.name === name)?.extras?.studioVisible, false, `${name} must stay retired`);
  }
  assert.deepEqual(new Set(json.materials.map(material => material.extras?.studioMaterialId)), new Set([
    "material/shovel-forged-steel",
    "material/shovel-dark-steel",
    "material/shovel-ash-wood",
    "material/shovel-grip",
  ]));
});

test("carrying the shovel presents an unobstructed ready-to-dig pose", async () => {
  const [carryable, shovel] = await Promise.all([
    readFile(join(sampleRoot, "src", "carryable-system.mjs"), "utf8"),
    readFile(join(sampleRoot, "src", "shovel-system.mjs"), "utf8"),
  ]);
  assert.match(carryable, /camera\.add\(object\)/);
  assert.match(shovel, /object\.userData\.studioVisible === false/);
  assert.match(shovel, /READY_POSITION = new THREE\.Vector3\(-0\.58, 0\.06, -0\.68\)/);
  assert.match(shovel, /HELD_SCALE = 0\.82/);
  assert.match(shovel, /READY_ROTATION = new THREE\.Euler\(-0\.18, 0\.12, -2\.02/);
  assert.doesNotMatch(shovel, /FirstPersonShovelHands|first-person-hands|heldVisual/);
});

test("digging uses a simple right-to-left swing and shoulder follow-through", async () => {
  const shovel = await readFile(join(sampleRoot, "src", "shovel-system.mjs"), "utf8");
  assert.match(shovel, /digAnimation\.trigger\(\)/);
  assert.match(shovel, /camera\.getWorldDirection\(aimDirection\)/);
  assert.match(shovel, /collisionWorld\.sweepPoint\(aimOrigin, aimEnd, 0\.035\)/);
  assert.match(shovel, /MAX_DIG_HORIZONTAL_REACH = 1\.5/);
  assert.match(shovel, /collisionWorld\.groundHeightAt\(targetWorld\.x, targetWorld\.z\)/);
  assert.match(shovel, /aimDirection\.y > -0\.12/);
  assert.match(shovel, /SWING_START_POSITION = new THREE\.Vector3\(0\.36/);
  assert.match(shovel, /SWING_END_POSITION = new THREE\.Vector3\(-0\.54/);
  assert.match(shovel, /SHOULDER_POSITION = new THREE\.Vector3\(-0\.38, 0\.32/);
  assert.match(shovel, /phase === "windup"/);
  assert.match(shovel, /phase === "swing"/);
  assert.match(shovel, /phase === "shoulder"/);
  assert.match(shovel, /phase === "shoulderHold"/);
  assert.match(shovel, /Math\.sin\(t \* Math\.PI\) \* 0\.09/);
  assert.match(shovel, /onDig\?\.\(\{/);
  assert.match(shovel, /forwardX: aimDirection\.x \/ horizontalLength/);
  assert.doesNotMatch(shovel, /solveTipAndGrip/);
});

test("carryable interaction requires reach and facing while drop follows view yaw", () => {
  const view = { x: 0, z: 0, yaw: Math.PI };
  assert.equal(canInteractWithCarryable(view, 0.5, 1.5), true);
  assert.equal(canInteractWithCarryable(view, 0, -1.5), false);
  assert.equal(canInteractWithCarryable(view, 0, 3), false);
  const drop = carryableDropPoint(view, 1.35);
  assert.ok(Math.abs(drop.x) < 1e-8);
  assert.ok(Math.abs(drop.z - 1.35) < 1e-8);
});
