import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createEnemyDirector } from "../src/ai/index.mjs";
import { createActorRegistry } from "../src/core/actor-registry.mjs";
import { createEventBus } from "../src/core/events.mjs";
import { createGameSession } from "../src/core/game-session.mjs";
import { createRuntimeServices } from "../src/core/runtime-services.mjs";
import { attachWorldPhysics } from "../src/core/world-physics.mjs";
import { createNpcSystem } from "../src/npc/index.mjs";
import { createPlayer } from "../src/player/index.mjs";
import { buildWorld } from "../src/world/index.mjs";

class TestInput {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
  }
  isDown(action) { return this.down.has(action); }
  actionDown(action) { return this.down.has(action); }
  actionPressed(action) { return this.pressed.delete(action); }
  consumePressed(action) { return this.pressed.delete(action); }
  consumeLookDelta() { return { x: 0, y: 0 }; }
  endFrame() { this.pressed.clear(); }
}

function harness() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.08, 520);
  const events = createEventBus();
  const input = new TestInput();
  const actors = createActorRegistry();
  const session = createGameSession({ events, input });
  const services = {
    events, input, camera, actors,
    combat: { queryTargets: request => actors.queryTargets(request) },
    ...session.services,
  };
  const world = buildWorld(scene, { ...services, progress: session.progression });
  attachWorldPhysics(world, scene);
  services.locations = world.locations;
  session.attachWorld(world);
  const runtime = createRuntimeServices({
    world, actors, events, inventory: session.inventory, economy: session.economy,
  });
  services.projectiles = runtime.projectiles;
  services.loot = runtime.loot;
  services.interaction = { interact: () => session.interact() };
  world.interactions = runtime.interactions;
  const spawn = new THREE.Vector3(0, world.sampleGround(0, 178).height, 178);
  const player = createPlayer({ THREE, world, services, input, events, camera, position: spawn });
  services.player = player;
  runtime.setPlayer(player);
  const npcs = createNpcSystem({ THREE, world, services, input, events });
  const enemies = createEnemyDirector({ THREE, world, services, events });
  session.attachActors({ player, npcs, enemies });
  return {
    scene, camera, events, input, actors, session, services, world, runtime, player, npcs, enemies,
    dispose() {
      enemies.dispose();
      npcs.dispose();
      player.dispose();
      runtime.dispose();
      session.dispose();
      actors.clear();
      world.dispose();
    },
  };
}

test("vertical slice world, traversal, actors and complete quest bridge integrate", () => {
  const game = harness();
  try {
    const { world, player, input, npcs, enemies, session } = game;
    assert.ok(Object.keys(world.landmarks).length >= 24, "continuous world should expose substantial landmark data");
    assert.ok(world.interactables.length >= 28, "world should contain real gameplay interactions");
    assert.ok(world.landmarks.village_beacon, "village beacon must be a physical landmark");
    assert.ok(world.interactables.some(item => item.id === "village_beacon"));
    assert.ok(world.interactables.some(item => item.metadata?.itemId === "pine_resin"));
    assert.ok(world.interactables.some(item => item.metadata?.itemId === "seasoned_wood"));
    assert.ok(world.interactables.some(item => item.id === "wolf_den_heart"));
    assert.ok(world.fireDefinitions.some(item => item.id === "village_beacon" && item.type === "beacon"));
    assert.ok(world.walkableSurfaces.length >= 3, "bridge approaches and deck should be walkable surfaces");

    const bridge = world.landmarks.stone_bridge.position;
    const sampledBridge = world.sampleGround(bridge[0], bridge[2]);
    assert.ok(sampledBridge.surfaceId, "bridge-aware ground sampler should select an authored walkable surface");

    const before = player.root.position.clone();
    input.down.add("moveForward");
    for (let frame = 0; frame < 120; ++frame) player.update(1 / 60);
    input.down.clear();
    assert.ok(player.root.position.distanceTo(before) > 3, "third-person movement should traverse the authored world");
    assert.equal(player.controller.grounded, true);

    const elder = npcs.get("elder_mara");
    assert.ok(elder, "the main-quest elder must be a scheduled named NPC");
    player.root.position.copy(elder.root.position).add(new THREE.Vector3(0, 0, 1));
    session.interact();
    assert.equal(session.quests.get("light_against_the_dark").stageId, "inspect_beacon");
    session.interact(); // close the dialogue before using world interactions

    const interactAt = (id, times = 1) => {
      const interactable = world.interactables.find(item => item.id === id);
      assert.ok(interactable, `missing world interaction: ${id}`);
      player.root.position.fromArray(interactable.position);
      let result = null;
      for (let use = 0; use < times; ++use) {
        result = session.interact();
        assert.equal(result?.id, id, `${id} should remain usable for interaction ${use + 1}`);
      }
      return interactable;
    };

    interactAt("village_beacon");
    assert.equal(session.quests.get("light_against_the_dark").stageId, "obtain_resin");
    const resin = interactAt("pine_resin", 3);
    const wood = interactAt("seasoned_wood", 2);
    interactAt("west_field_crop");
    assert.equal(session.inventory.count("pine_resin"), 3);
    assert.equal(session.inventory.count("seasoned_wood"), 2);
    assert.equal(resin.enabled, true, "five-use resin grove should remain available after the quest's three gathers");
    assert.equal(wood.enabled, true, "five-use wood pile should remain available after the quest's two gathers");
    interactAt("hunter_camp_bedroll");
    assert.equal(session.quests.get("light_against_the_dark").stageId, "obtain_iron_fittings");

    const brynna = npcs.get("brynna-vale");
    player.root.position.copy(brynna.root.position).add(new THREE.Vector3(0, 0, 1));
    session.interact();
    assert.equal(session.quests.get("light_against_the_dark").stageId, "defend_repairs");
    session.interact(); // close Brynna's dialogue

    session.quests.notify({ type: "defend", target: "beacon_repair_site" });
    interactAt("village_beacon");
    assert.equal(session.progression.get("beaconLit"), true);
    assert.equal(session.progression.get("fortressRouteUnlocked"), true);
    const gateBlocker = world.blockers.find(blocker => blocker.id === "fortress_portcullis");
    assert.equal(gateBlocker.active, false, "lighting the shared beacon system should open the fortress route");

    session.quests.notify({ type: "reach", target: "fortress_gate" });
    assert.equal(session.quests.get("light_against_the_dark").stageId, "defeat_warden");
    const warden = enemies.spawn("fortressWarden", {
      position: new THREE.Vector3(0, world.sampleGround(0, -195).height, -195),
    });
    assert.ok(warden?.active);
    session.quests.notify({ type: "kill", target: "fortress_warden" });
    player.root.position.copy(elder.root.position).add(new THREE.Vector3(0, 0, 1));
    session.interact();
    assert.equal(session.quests.get("light_against_the_dark").status, "completed");
    assert.equal(session.progression.get("postVictory"), true);
    assert.equal(session.progression.get("corruptionStrength"), 0);

    const wolf = enemies.spawn("wolf", {
      position: player.root.position.clone().add(new THREE.Vector3(0, 0, -1.25)),
      home: player.root.position.clone(),
    });
    const healthBefore = wolf.stats.health;
    player.root.rotation.y = 0;
    player.yaw = 0;
    assert.equal(player.combat.requestAttack("light"), true);
    for (let frame = 0; frame < 90; ++frame) player.combat.update(1 / 60);
    assert.ok(wolf.stats.health < healthBefore, "timed combat hit window should damage a registered enemy");
  } finally {
    game.dispose();
  }
});
