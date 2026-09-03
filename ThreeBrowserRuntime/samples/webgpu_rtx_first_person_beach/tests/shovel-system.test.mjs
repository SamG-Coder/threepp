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

test("carrying the shovel presents a synchronised two-hand first-person grip", async () => {
  const [carryable, shovel, hands] = await Promise.all([
    readFile(join(sampleRoot, "src", "carryable-system.mjs"), "utf8"),
    readFile(join(sampleRoot, "src", "shovel-system.mjs"), "utf8"),
    readFile(join(sampleRoot, "src", "first-person-hands.mjs"), "utf8"),
  ]);
  assert.match(carryable, /heldVisual\.visible = true/);
  assert.match(carryable, /syncHeldVisual\(\)/);
  assert.match(carryable, /heldVisual\.visible = false/);
  assert.match(shovel, /createFirstPersonShovelHands/);
  assert.match(shovel, /object\.userData\.studioVisible === false/);
  assert.match(hands, /First-person two-hand shovel grip/);
  assert.match(hands, /gripping palm/);
  assert.match(hands, /side: 1/);
  assert.match(hands, /side: -1/);
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
