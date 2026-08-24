import * as THREE_DEFAULT from "three/webgpu";
import { createCombatController, COMBAT_STATES } from "../player/combat.mjs";
import { createEquipmentRig } from "../player/equipment.mjs";
import {
  actorAlive,
  actorPosition,
  clampDelta,
  emitEvent,
  listenEvent,
  makeRuntimeId,
  resolveLocation,
} from "../player/runtime-contracts.mjs";
import { createNavigator } from "../ai/navigation.mjs";
import { createPerception } from "../ai/perception.mjs";
import { createDialogueService } from "./dialogue.mjs";
import { createScheduleResolver, DEFAULT_NPC_DEFINITIONS } from "./schedules.mjs";

function vectorFrom(THREE, value, fallback = null) {
  if (!value) return fallback?.clone?.() ?? new THREE.Vector3();
  if (Array.isArray(value)) return new THREE.Vector3().fromArray(value);
  return value.clone?.() ?? new THREE.Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

function addRoot(world, root) {
  if (world?.addDynamicActor) world.addDynamicActor(root);
  else if (world?.actorsRoot?.add) world.actorsRoot.add(root);
  else if (world?.root?.add) world.root.add(root);
  else if (world?.scene?.add) world.scene.add(root);
  else world?.add?.(root);
}

function registerActor(services, actor) {
  const registry = services?.actors;
  const result = typeof registry?.register === "function" ? registry.register(actor)
    : typeof registry?.add === "function" ? registry.add(actor) : null;
  if (typeof result === "function") return result;
  return () => registry?.unregister?.(actor) ?? registry?.remove?.(actor);
}

function clockHour(services, world) {
  const value = typeof services?.time?.hour === "function" ? services.time.hour() : services?.time?.hour ?? services?.time?.timeOfDay;
  return Number(value ?? world?.time?.hour ?? 12);
}

function currentWeather(services, world) {
  const value = typeof services?.weather?.current === "function" ? services.weather.current() : services?.weather?.current ?? services?.weather?.type;
  return value ?? world?.weather ?? "clear";
}

function worldFlag(services, world, key) {
  const progress = services?.progress?.snapshot?.() ?? services?.progress?.state ?? world?.state?.progress;
  return services?.worldState?.get?.(key) ?? services?.worldState?.[key] ?? progress?.[key] ?? world?.state?.get?.(key) ?? world?.state?.[key] ?? false;
}

function npcLoadout(definition) {
  if (definition.role === "guard") return { mainHand: "sword", offHand: "shield", armor: "plate", owned: ["sword", "shield"] };
  if (definition.role === "blacksmith") return { mainHand: "none", offHand: null, armor: "leather", owned: ["sword"] };
  return { mainHand: "none", offHand: null, armor: "cloth", owned: [] };
}

export class VillageNpc {
  constructor({
    THREE: THREE_NS = THREE_DEFAULT,
    definition,
    world,
    services = {},
    input = services?.input ?? null,
    events = services?.events,
    dialogue = null,
    scheduleResolver = null,
    position = null,
  } = {}) {
    if (!definition || !world) throw new TypeError("VillageNpc requires definition and world");
    this.THREE = THREE_NS;
    this.definition = definition;
    this.id = definition.id ?? makeRuntimeId("npc");
    this.type = "npc";
    this.name = definition.name ?? this.id;
    this.role = definition.role ?? "villager";
    this.dialogueId = definition.dialogue ?? this.role;
    this.team = "village";
    this.world = world;
    this.services = services;
    this.input = input;
    this.events = events;
    this.dialogue = dialogue ?? createDialogueService({ services, world, events });
    this.scheduleResolver = scheduleResolver ?? createScheduleResolver({ clock: services?.time, weather: services?.weather, worldState: services?.worldState });
    this.root = new THREE_NS.Group();
    this.root.name = `${this.name} NPC actor`;
    this.root.userData.rtxIgnore = true;
    this.root.userData.dynamicActor = true;
    this.root.position.copy(vectorFrom(THREE_NS, position ?? resolveLocation(world, services, definition.home)));
    this.visual = createEquipmentRig({
      THREE: THREE_NS,
      name: `${this.name}, visible ${this.role}`,
      palette: definition.palette,
      loadout: npcLoadout(definition),
    });
    this.root.add(this.visual.root);
    this.equipment = this.visual;
    this.stats = this.role === "guard"
      ? { maxHealth: 135, health: 135, maxStamina: 105, stamina: 105, staminaRegen: 22, armor: 24, poise: 85 }
      : { maxHealth: 75, health: 75, maxStamina: 70, stamina: 70, staminaRegen: 18, armor: 3, poise: 42 };
    this.alive = true;
    this.active = true;
    this.yaw = this.root.rotation.y;
    this.aimHeight = 1.34;
    this.lootTable = [];
    this.relationships = new Map(Object.entries(definition.relationships ?? {}));
    this.activity = "home";
    this.schedule = null;
    this.awareness = 0;
    this.threat = null;
    this.scheduleTimer = 0;
    this.routineTimer = 1 + Math.random() * 2;
    this.attackCooldown = 0;
    this.lastDialogue = null;
    this._location = null;
    this._position = new THREE_NS.Vector3();
    this._offset = new THREE_NS.Vector3();
    this._disposers = [];
    this.combat = createCombatController({ THREE: THREE_NS, owner: this, world, services, events, team: this.team });
    this.navigator = createNavigator({ THREE: THREE_NS, actor: this, world, services, events, config: { speed: this.role === "guard" ? 3 : 2.15 } });
    this.perception = createPerception({
      THREE: THREE_NS,
      actor: this,
      world,
      services,
      events,
      hostile: candidate => candidate?.team === "enemy" || candidate?.type === "enemy",
      config: { sightRange: this.role === "guard" ? 24 : 15, hearingRange: this.role === "guard" ? 18 : 12, memoryDuration: this.role === "guard" ? 7 : 4 },
    });
    this.receiveHit = hit => this._receiveHit(hit);
    this.onDeath = detail => {
      this.navigator.stop();
      this.activity = "dead";
      emitEvent(events, "npc:died", { npc: this, ...detail });
    };
    this._disposers.push(listenEvent(events, "combat:hit", detail => this._noticeCombat(detail)));
    this.root.userData.actor = this;
    this._unregister = registerActor(services, this);
  }

  update(delta, context = {}) {
    if (!this.active) return this.snapshot();
    const dt = clampDelta(delta);
    if (dt <= 0) return this.snapshot();
    const combat = this.combat.update(dt);
    if (combat.dead) {
      this.visual.updatePose(dt, { speed: 0, combat });
      return this.snapshot();
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    const perception = this.perception.update(dt);
    if (perception.target && actorAlive(perception.target)) this.threat = perception.target;
    else if (this.threat && !actorAlive(this.threat)) this.threat = null;
    this.awareness = Math.max(perception.awareness, this.awareness - dt * 0.12);

    if (this.threat) {
      if (this.role === "guard") this._guardReaction(this.threat);
      else this._civilianReaction(this.threat, context);
    } else {
      this.combat.setBlocking(false);
      this._routine(dt, context);
    }
    const target = this.role === "guard" && this.threat ? actorPosition(this.threat, this._position) : null;
    const motion = this.navigator.update(dt, { speed: this.role === "guard" && this.threat ? 3.35 : 2.15, faceTarget: target });
    this.visual.updatePose(dt, { speed: Math.hypot(motion.velocity.x, motion.velocity.z), combat });
    return this.snapshot();
  }

  interact(player, overrides = {}) {
    if (!this.alive) return null;
    if (this.awareness >= 0.8 && this.role !== "guard") {
      const session = Object.freeze({ npc: this, player, nodeId: "fleeing", text: "Not now—get to shelter!", choices: [] });
      emitEvent(this.events, "dialogue:begin", session);
      return session;
    }
    const offeredQuest = this.id === "elder_mara" ? "light_against_the_dark"
      : this.id === "merchant_elin" ? "roads_of_trade" : null;
    if (offeredQuest && typeof this.services?.quests?.start === "function") {
      try {
        if (this.services.quests.get(offeredQuest)?.status === "available") this.services.quests.start(offeredQuest);
      } catch {
        // The host may intentionally omit one of the optional quest definitions.
      }
    }
    this.lastDialogue = this.dialogue.begin(this, player, overrides);
    const talkEvent = { type: "talk", target: this.id, amount: 1, npc: this, player };
    const returnEvent = { type: "return", target: this.id, amount: 1, npc: this, player };
    this.services?.quests?.notify?.(talkEvent);
    this.services?.quests?.notify?.(returnEvent);
    emitEvent(this.events, "quest:event", talkEvent);
    emitEvent(this.events, "quest:event", returnEvent);
    return this.lastDialogue;
  }

  relationshipWith(other) {
    const id = typeof other === "string" ? other : other?.id;
    return Number(this.relationships.get(id) ?? 0);
  }

  changeRelationship(other, amount) {
    const id = typeof other === "string" ? other : other?.id;
    if (!id) return 0;
    const value = Math.max(-1, Math.min(1, this.relationshipWith(id) + (Number(amount) || 0)));
    this.relationships.set(id, value);
    emitEvent(this.events, "npc:relationship", { npc: this, other: id, value });
    return value;
  }

  snapshot() {
    return Object.freeze({
      id: this.id,
      name: this.name,
      role: this.role,
      activity: this.activity,
      awareness: this.awareness,
      threat: this.threat,
      position: this.root.position.clone(),
      destination: this.navigator.destination?.clone() ?? null,
      alive: this.alive,
      combat: this.combat.snapshot(),
    });
  }

  dispose() {
    this.active = false;
    for (const dispose of this._disposers.splice(0)) dispose?.();
    this.perception.dispose();
    this._unregister?.();
    this.visual.dispose();
    this.root.removeFromParent();
  }

  _receiveHit(hit) {
    const incoming = this.definition.essential
      ? {
          ...hit,
          damage: Math.min(
            Math.max(0, Number(hit?.damage) || 0),
            Math.max(0, this.stats.health - 1),
          ),
        }
      : hit;
    const result = this.combat.receiveHit(incoming);
    const source = hit?.source;
    if (source?.team === "player" || source?.type === "player") {
      this.changeRelationship(source, -0.5);
      if (typeof this.services?.reputation?.modify === "function") this.services.reputation.modify(-15, { reason: "assault", npc: this, source });
      else this.services?.reputation?.add?.("village", -15, "npc-assault");
      emitEvent(this.events, "npc:crime", { kind: "assault", npc: this, source, result });
    }
    if (source && actorAlive(source)) {
      this.threat = source;
      this.awareness = 1;
      this.perception.notifyNoise({ source, position: actorPosition(source, this._position), radius: 4 });
    }
    return result;
  }

  _noticeCombat(detail) {
    if (!detail?.actor && !detail?.source) return;
    const pointActor = detail.actor ?? detail.source;
    actorPosition(pointActor, this._position);
    if (this.root.position.distanceToSquared(this._position) > 14 * 14) return;
    this.awareness = Math.max(this.awareness, 0.62);
    const hostile = [detail.actor, detail.source].find(candidate => candidate?.team === "enemy");
    if (hostile && actorAlive(hostile)) this.threat = hostile;
    const criminal = detail.actor?.type === "npc" && (detail.source?.team === "player" || detail.source?.type === "player")
      ? detail.source : null;
    if (criminal && this.role === "guard" && actorAlive(criminal)) {
      this.threat = criminal;
      this.awareness = 1;
      emitEvent(this.events, "npc:guard-alert", { npc: this, criminal, victim: detail.actor });
    }
    emitEvent(this.events, "npc:noticed-combat", { npc: this, combat: detail });
  }

  _guardReaction(target) {
    this.activity = "defend";
    const distance = this.root.position.distanceTo(actorPosition(target, this._position));
    const targetState = target.combat?.state ?? target.combat?.snapshot?.()?.state;
    const block = distance < 2.35 && [COMBAT_STATES.WINDUP, COMBAT_STATES.ACTIVE].includes(targetState) && this.stats.stamina > 12;
    this.combat.setBlocking(block);
    if (!block && !this.combat.isBusy() && distance <= 1.65 && this.attackCooldown <= 0) {
      if (this.combat.requestAttack(this.attackCooldown === 0 && this.stats.stamina > 55 ? "heavy" : "light")) this.attackCooldown = 1.15;
    } else if (distance > 1.45) this.navigator.setDestination(this._position);
    emitEvent(this.events, "npc:guard-reaction", { npc: this, target, distance, blocking: block });
  }

  _civilianReaction(target, context) {
    this.activity = "seek-shelter";
    this.combat.setBlocking(false);
    const shelter = resolveLocation(this.world, this.services, this.definition.shelter, this.root.position);
    this.navigator.setDestination(vectorFrom(this.THREE, shelter, this.root.position));
    emitEvent(this.events, "npc:flee", { npc: this, target, shelter: this.definition.shelter, context });
  }

  _routine(dt, context) {
    this.scheduleTimer -= dt;
    if (this.scheduleTimer <= 0) {
      this.scheduleTimer = 0.75 + Math.random() * 0.25;
      const next = this.scheduleResolver(this.definition, {
        hour: context.hour ?? clockHour(this.services, this.world),
        weather: context.weather ?? currentWeather(this.services, this.world),
        beaconLit: context.beaconLit ?? worldFlag(this.services, this.world, "beaconLit"),
        threat: context.threat,
        nearbyEnemy: Boolean(this.threat),
      });
      if (!this.schedule || next.activity !== this.schedule.activity || next.location !== this.schedule.location) {
        const previous = this.schedule;
        this.schedule = next;
        this.activity = next.activity;
        this._location = next.location;
        const location = resolveLocation(this.world, this.services, next.location, this.root.position);
        this.navigator.setDestination(vectorFrom(this.THREE, location, this.root.position), { immediate: true });
        emitEvent(this.events, "npc:schedule", { npc: this, previous, schedule: next });
      }
    }
    this.routineTimer -= dt;
    if (this.navigator.arrived && this.routineTimer <= 0 && !["sleep", "rest", "home", "seek-shelter"].includes(this.activity)) {
      this.routineTimer = 3.5 + Math.random() * 4;
      const anchor = resolveLocation(this.world, this.services, this._location, this.root.position);
      const angle = Math.random() * Math.PI * 2;
      this._offset.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(0.55 + Math.random() * 0.75);
      this.navigator.setDestination(vectorFrom(this.THREE, anchor, this.root.position).add(this._offset));
    }
  }
}

export class NpcSystem {
  constructor({
    THREE: THREE_NS = THREE_DEFAULT,
    world,
    services = {},
    input = services?.input ?? null,
    events = services?.events,
    definitions = DEFAULT_NPC_DEFINITIONS,
    spawn = true,
  } = {}) {
    if (!world) throw new TypeError("NpcSystem requires world");
    this.THREE = THREE_NS;
    this.world = world;
    this.services = services;
    this.input = input;
    this.events = events;
    this.definitions = Array.from(definitions);
    this.root = new THREE_NS.Group();
    this.root.name = "Named dynamic village NPCs";
    this.root.userData.rtxIgnore = true;
    this.root.userData.dynamicActor = true;
    this.npcs = [];
    this.byId = new Map();
    this.dialogue = createDialogueService({ services, world, events });
    this.scheduleResolver = createScheduleResolver({ clock: services?.time, weather: services?.weather, worldState: services?.worldState });
    this.threat = null;
    addRoot(world, this.root);
    if (spawn) this.spawnAll();
  }

  spawnAll() {
    for (const definition of this.definitions) if (!this.byId.has(definition.id)) this.spawn(definition);
    return this.npcs;
  }

  spawn(definition, options = {}) {
    if (this.byId.has(definition.id)) return this.byId.get(definition.id);
    const fallback = new this.THREE.Vector3((this.npcs.length % 3) * 1.3, 0, Math.floor(this.npcs.length / 3) * 1.3);
    const position = options.position ?? resolveLocation(this.world, this.services, definition.home, fallback);
    const npc = new VillageNpc({
      THREE: this.THREE,
      definition,
      world: this.world,
      services: this.services,
      input: this.input,
      events: this.events,
      dialogue: this.dialogue,
      scheduleResolver: this.scheduleResolver,
      position,
    });
    this.root.add(npc.root);
    this.npcs.push(npc);
    this.byId.set(npc.id, npc);
    emitEvent(this.events, "npc:spawned", { npc });
    return npc;
  }

  setThreat(threat) {
    this.threat = threat?.active === false ? null : threat;
    emitEvent(this.events, "npc:threat", { threat: this.threat });
  }

  update(delta) {
    const context = {
      hour: clockHour(this.services, this.world),
      weather: currentWeather(this.services, this.world),
      beaconLit: worldFlag(this.services, this.world, "beaconLit"),
      threat: this.threat,
    };
    for (const npc of this.npcs) npc.update(delta, context);
  }

  get(idOrName) {
    return this.byId.get(idOrName) ?? this.npcs.find(npc => npc.name === idOrName) ?? null;
  }

  nearest(position, radius = 2.4) {
    let result = null;
    let best = radius * radius;
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const distance = npc.root.position.distanceToSquared(position);
      if (distance < best) { best = distance; result = npc; }
    }
    return result;
  }

  interact(idOrNpc, player, overrides = {}) {
    const npc = typeof idOrNpc === "string" ? this.get(idOrNpc) : idOrNpc;
    return npc?.interact(player, overrides) ?? null;
  }

  queryRadius(origin, radius) {
    const radiusSquared = radius * radius;
    return this.npcs.filter(npc => npc.alive && npc.root.position.distanceToSquared(origin) <= radiusSquared);
  }

  dispose() {
    for (const npc of this.npcs) npc.dispose();
    this.npcs.length = 0;
    this.byId.clear();
    this.root.removeFromParent();
  }
}

export function createNpcSystem(options) {
  return new NpcSystem(options);
}

export function createNpc(options) {
  const npc = new VillageNpc(options);
  addRoot(options.world, npc.root);
  return npc;
}
