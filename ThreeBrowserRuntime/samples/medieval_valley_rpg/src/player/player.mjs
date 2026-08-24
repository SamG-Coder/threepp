import * as THREE_DEFAULT from "three/webgpu";
import { createCombatController } from "./combat.mjs";
import { createPlayerController } from "./controller.mjs";
import { createEquipmentRig } from "./equipment.mjs";
import { actorPosition, emitEvent, makeRuntimeId, queryActors } from "./runtime-contracts.mjs";

function attachToWorld(world, root) {
  const result = world?.addDynamicActor?.(root) ?? world?.actorsRoot?.add?.(root) ?? world?.root?.add?.(root);
  if (!result && world?.scene?.add) world.scene.add(root);
  else if (!result && world?.add) world.add(root);
}

function registerActor(services, actor) {
  const registry = services?.actors;
  if (!registry) return () => {};
  const result = typeof registry.register === "function" ? registry.register(actor)
    : typeof registry.add === "function" ? registry.add(actor) : null;
  if (typeof result === "function") return result;
  return () => registry.unregister?.(actor) ?? registry.remove?.(actor);
}

/**
 * Creates the complete visible player actor. No browser globals are touched;
 * callers supply input, camera, world collision, events and optional services.
 */
export function createPlayer({
  THREE: THREE_NS = THREE_DEFAULT,
  world,
  services = {},
  input = services?.input ?? null,
  events = services?.events ?? null,
  camera = services?.camera ?? world?.camera ?? null,
  id = "player",
  name = "The Wayfarer",
  position = null,
  stats = {},
  palette = {},
  loadout = {},
  controller: controllerConfig = {},
} = {}) {
  if (!world) throw new TypeError("createPlayer requires world");
  const root = new THREE_NS.Group();
  root.name = `${name} root`;
  root.userData.rtxIgnore = true;
  root.userData.dynamicActor = true;
  if (position) {
    if (Array.isArray(position)) root.position.fromArray(position);
    else root.position.copy(position);
  }

  const visual = createEquipmentRig({ THREE: THREE_NS, name: `${name} visible humanoid`, palette, loadout });
  root.add(visual.root);
  const actor = {
    id: id || makeRuntimeId("player"),
    type: "player",
    name,
    team: "player",
    root,
    visual,
    equipment: visual,
    stats: {
      maxHealth: 120,
      health: 120,
      maxStamina: 110,
      stamina: 110,
      staminaRegen: 24,
      armor: 14,
      poise: 70,
      ...stats,
    },
    alive: true,
    yaw: root.rotation.y,
    aimHeight: 1.36,
    lootTable: [],
    world,
    services,
    events,
  };
  actor.combat = createCombatController({ THREE: THREE_NS, owner: actor, world, services, events, team: actor.team });
  actor.controller = createPlayerController({
    THREE: THREE_NS,
    owner: actor,
    camera,
    input,
    world,
    services,
    events,
    config: controllerConfig,
  });
  actor.receiveHit = hit => actor.combat.receiveHit(hit);
  actor.heal = amount => {
    const previous = actor.stats.health;
    actor.stats.health = Math.min(actor.stats.maxHealth, previous + Math.max(0, Number(amount) || 0));
    emitEvent(events, "player:healed", { actor, amount: actor.stats.health - previous, health: actor.stats.health });
    return actor.stats.health - previous;
  };
  actor.setLoadout = next => {
    const value = visual.setLoadout(next);
    emitEvent(events, "player:loadout", { actor, loadout: value });
    return value;
  };
  actor.cycleWeapon = () => {
    const current = visual.getLoadout();
    const weapons = (current.owned ?? []).filter(value => ["sword", "twoHanded", "crossbow"].includes(value));
    if (weapons.length === 0) return current;
    const next = weapons[(weapons.indexOf(current.mainHand) + 1) % weapons.length];
    return actor.setLoadout({ mainHand: next, offHand: next === "sword" && current.owned.includes("shield") ? "shield" : null });
  };
  actor.nearbyInteractables = (radius = 2.2) => queryActors(services, world, {
    origin: actorPosition(actor, new THREE_NS.Vector3()),
    radius,
    actor,
    kind: "interactable",
  });
  actor.update = delta => {
    const motion = actor.controller.update(delta);
    const combat = actor.combat.update(delta);
    visual.updatePose(delta, {
      speed: Math.hypot(motion.velocity.x, motion.velocity.z),
      grounded: motion.grounded,
      sprinting: motion.sprinting,
      combat,
    });
    return actor.snapshot();
  };
  actor.snapshot = () => Object.freeze({
    id: actor.id,
    name: actor.name,
    position: root.position.clone(),
    yaw: root.rotation.y,
    alive: actor.alive,
    loadout: visual.getLoadout(),
    combat: actor.combat.snapshot(),
    motion: actor.controller.snapshot(),
  });

  attachToWorld(world, root);
  const unregister = registerActor(services, actor);
  actor.dispose = () => {
    unregister();
    visual.dispose();
    root.removeFromParent();
    emitEvent(events, "actor:removed", { actor });
  };
  root.userData.actor = actor;
  emitEvent(events, "actor:spawned", { actor });
  return actor;
}

export const createThirdPersonPlayer = createPlayer;
