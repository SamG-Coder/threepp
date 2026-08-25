import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { stageConversationSeparation } from "../src/game/interaction-staging.mjs";

function actorAt(x, z) {
  const root = new THREE.Group();
  root.position.set(x, 0.2, z);
  return { root };
}

function playerAt(x, z) {
  const root = new THREE.Group();
  root.position.set(x, 0.2, z);
  const teleports = [];
  return {
    root,
    teleports,
    teleport(nextX, nextZ) {
      teleports.push([nextX, nextZ]);
      root.position.set(nextX, 0.2, nextZ);
      return root.position.clone();
    },
    snapshot() {
      return { position: root.position.toArray(), yaw: root.rotation.y };
    },
  };
}

const CLEAR_WORLD = Object.freeze({
  isRoad: () => false,
  isBlockedCircle: () => false,
});
test("an overlapping native interaction moves Kai to the authored clear conversation mark", () => {
  const player = playerAt(-44, -16.5);
  const actor = actorAt(-44, -16.5);
  const result = stageConversationSeparation({
    player,
    actor,
    world: CLEAR_WORLD,
    preferredPlayerPosition: [-41, 0.2, -17],
  });

  assert.equal(result.moved, true);
  assert.equal(player.teleports.length, 1);
  assert.deepEqual(player.teleports[0], [-41, -17]);
  assert.ok(result.finalDistance >= result.minimumSeparation);
  assert.deepEqual(player.snapshot().position, result.playerPosition,
    "logical/save position must match the staged render position");
  assert.equal(result.faced, true);
  assert.ok(Number.isFinite(player.root.rotation.y));
  assert.ok(Number.isFinite(actor.root.rotation.y));
});

test("a safely separated pair only turns to face and never teleports", () => {
  const player = playerAt(-180.35, -136);
  const actor = actorAt(-183.1, -138.2);
  const original = player.snapshot().position;
  const result = stageConversationSeparation({
    player,
    actor,
    world: CLEAR_WORLD,
    preferredPlayerPosition: [-180.35, 0.2, -136],
    minimumSeparation: 2.2,
  });

  assert.equal(result.moved, false);
  assert.equal(player.teleports.length, 0);
  assert.deepEqual(player.snapshot().position, original);
  assert.ok(result.finalDistance > 3.5, result);
  assert.equal(result.faced, true);
});

test("blocked authored footing falls back deterministically around the actor", () => {
  const world = {
    isRoad: () => false,
    isBlockedCircle: x => x > 1,
  };
  const run = () => {
    const player = playerAt(0, 0);
    const actor = actorAt(0, 0);
    return {
      player,
      result: stageConversationSeparation({
        player,
        actor,
        world,
        preferredPlayerPosition: [3, 0.2, 0],
      }),
    };
  };
  const first = run();
  const second = run();

  assert.equal(first.result.moved, true);
  assert.deepEqual(first.player.teleports, second.player.teleports);
  assert.deepEqual(first.player.teleports[0], [0, 2.35]);
  assert.ok(first.result.finalDistance >= first.result.minimumSeparation);
});

test("an unsafe world never forces a teleport or produces invalid facing", () => {
  const player = playerAt(2, 2);
  const actor = actorAt(2, 2);
  const result = stageConversationSeparation({
    player,
    actor,
    world: { isRoad: () => true, isBlockedCircle: () => true },
    preferredPlayerPosition: [4, 0.2, 2],
  });

  assert.equal(result.moved, false);
  assert.equal(result.faced, false);
  assert.equal(player.teleports.length, 0);
  assert.equal(player.root.rotation.y, 0);
  assert.equal(actor.root.rotation.y, 0);
});
