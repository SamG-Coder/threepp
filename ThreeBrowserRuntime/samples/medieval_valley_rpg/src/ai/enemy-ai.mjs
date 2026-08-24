import * as THREE_DEFAULT from "three/webgpu";
import { createCombatController, COMBAT_STATES } from "../player/combat.mjs";
import { createEquipmentRig } from "../player/equipment.mjs";
import { actorAlive, actorPosition, clampDelta, emitEvent, makeRuntimeId } from "../player/runtime-contracts.mjs";
import { createNavigator } from "./navigation.mjs";
import { createPerception } from "./perception.mjs";

export const ENEMY_ARCHETYPES = Object.freeze({
  wolf: Object.freeze({
    name: "Vale Wolf", team: "enemy", weapon: "claws", scale: 0.9,
    stats: { maxHealth: 62, health: 62, maxStamina: 90, stamina: 90, staminaRegen: 30, armor: 2, poise: 32, poiseRegen: 10 },
    speed: 5.2, sightRange: 21, attackRange: 1.45, cooldown: 0.78,
    loot: [{ item: "wolf-pelt", chance: 0.75, quantity: [1, 1] }, { item: "raw-meat", chance: 0.6, quantity: [1, 2] }],
  }),
  hollowSoldier: Object.freeze({
    name: "Hollow Soldier", team: "enemy", weapon: "sword", scale: 1,
    stats: { maxHealth: 105, health: 105, maxStamina: 95, stamina: 95, staminaRegen: 21, armor: 18, poise: 68, poiseRegen: 12 },
    speed: 2.9, sightRange: 22, attackRange: 1.68, cooldown: 1,
    loot: [{ item: "old-coin", chance: 0.85, quantity: [2, 7] }, { item: "iron-scrap", chance: 0.45, quantity: [1, 2] }],
  }),
  brute: Object.freeze({
    name: "Ashen Brute", team: "enemy", weapon: "twoHanded", scale: 1.34,
    stats: { maxHealth: 245, health: 245, maxStamina: 130, stamina: 130, staminaRegen: 19, armor: 28, poise: 145, poiseRegen: 16 },
    speed: 2.15, sightRange: 19, attackRange: 2.2, cooldown: 1.48,
    loot: [{ item: "brute-token", chance: 1, quantity: [1, 1] }, { item: "steel-ingot", chance: 0.65, quantity: [1, 3] }],
  }),
  fortressWarden: Object.freeze({
    name: "Fortress Warden", team: "enemy", weapon: "warden", scale: 1.48, boss: true,
    stats: { maxHealth: 850, health: 850, maxStamina: 240, stamina: 240, staminaRegen: 31, armor: 38, poise: 235, poiseRegen: 24 },
    speed: 2.75, sightRange: 32, attackRange: 2.75, cooldown: 1.12,
    loot: [{ item: "warden-sigil", chance: 1, quantity: [1, 1] }, { item: "fortress-key", chance: 1, quantity: [1, 1] }],
  }),
});

const wolfAssetsByThree = new WeakMap();
const telegraphAssetsByThree = new WeakMap();

function material(THREE, cache, key, color, roughness = 0.85, metalness = 0) {
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return cache.get(key);
}

function wolfAssets(THREE) {
  let assets = wolfAssetsByThree.get(THREE);
  if (assets) return assets;
  assets = {
    geometries: {
      body: new THREE.CapsuleGeometry(0.36, 0.78, 4, 8),
      chest: new THREE.SphereGeometry(0.42, 10, 8),
      head: new THREE.BoxGeometry(0.48, 0.43, 0.55),
      muzzle: new THREE.BoxGeometry(0.3, 0.22, 0.35),
      ear: new THREE.ConeGeometry(0.11, 0.32, 4),
      leg: new THREE.CapsuleGeometry(0.075, 0.5, 3, 6),
      paw: new THREE.BoxGeometry(0.16, 0.12, 0.28),
      tail: new THREE.CapsuleGeometry(0.07, 0.68, 3, 6),
      eye: new THREE.SphereGeometry(0.035, 6, 4),
    },
    materials: new Map(),
  };
  wolfAssetsByThree.set(THREE, assets);
  return assets;
}

function visibleMesh(THREE, geometry, mat, name) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.rtxIgnore = true;
  mesh.userData.dynamicActor = true;
  return mesh;
}

function createWolfRig(THREE, { color = 0x4b443d } = {}) {
  const assets = wolfAssets(THREE);
  const fur = material(THREE, assets.materials, `fur-${color}`, color, 0.96);
  const dark = material(THREE, assets.materials, "wolf-dark", 0x171514, 0.92);
  const eyeMaterial = material(THREE, assets.materials, "wolf-eye", 0xd98a35, 0.44);
  const root = new THREE.Group();
  root.name = "Visible procedural wolf";
  const body = visibleMesh(THREE, assets.geometries.body, fur, "Wolf body");
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.77;
  const chest = visibleMesh(THREE, assets.geometries.chest, fur, "Wolf chest");
  chest.position.set(0, 0.84, -0.35);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.08, -0.74);
  const head = visibleMesh(THREE, assets.geometries.head, fur, "Wolf head");
  const muzzle = visibleMesh(THREE, assets.geometries.muzzle, dark, "Wolf muzzle");
  muzzle.position.set(0, -0.08, -0.36);
  const leftEar = visibleMesh(THREE, assets.geometries.ear, fur, "Wolf left ear");
  const rightEar = visibleMesh(THREE, assets.geometries.ear, fur, "Wolf right ear");
  leftEar.position.set(-0.15, 0.34, 0.03);
  rightEar.position.set(0.15, 0.34, 0.03);
  const leftEye = visibleMesh(THREE, assets.geometries.eye, eyeMaterial, "Wolf left eye");
  const rightEye = visibleMesh(THREE, assets.geometries.eye, eyeMaterial, "Wolf right eye");
  leftEye.position.set(-0.13, 0.06, -0.29);
  rightEye.position.set(0.13, 0.06, -0.29);
  headPivot.add(head, muzzle, leftEar, rightEar, leftEye, rightEye);
  const legs = [];
  for (const [x, z] of [[-0.25, -0.37], [0.25, -0.37], [-0.24, 0.38], [0.24, 0.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.61, z);
    const leg = visibleMesh(THREE, assets.geometries.leg, fur, "Wolf leg");
    leg.position.y = -0.3;
    const paw = visibleMesh(THREE, assets.geometries.paw, dark, "Wolf paw");
    paw.position.set(0, -0.64, -0.06);
    pivot.add(leg, paw);
    root.add(pivot);
    legs.push(pivot);
  }
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.9, 0.68);
  tailPivot.rotation.x = -0.68;
  const tail = visibleMesh(THREE, assets.geometries.tail, fur, "Wolf tail");
  tail.position.y = 0.36;
  tailPivot.add(tail);
  root.add(body, chest, headPivot, tailPivot);
  root.traverse(object => { object.userData.rtxIgnore = true; object.userData.dynamicActor = true; });
  let gait = 0;
  return {
    root,
    primaryWeapon: "claws",
    offHand: null,
    updatePose(delta, { speed = 0, combat = {} } = {}) {
      gait += delta * Math.max(3, speed * 3.2);
      const stride = Math.sin(gait) * Math.min(0.72, speed * 0.16);
      legs[0].rotation.x = stride;
      legs[3].rotation.x = stride;
      legs[1].rotation.x = -stride;
      legs[2].rotation.x = -stride;
      tailPivot.rotation.z = Math.sin(gait * 0.45) * 0.3;
      headPivot.rotation.x = combat.state === "windup" ? -0.22 : combat.state === "active" ? 0.38 : 0;
      root.rotation.z = combat.state === "dead" ? -Math.min(Math.PI / 2, combat.progress * 2) : 0;
    },
    setLoadout() {},
    getLoadout() { return { mainHand: "claws", offHand: null, owned: ["claws"] }; },
    dispose() { root.removeFromParent(); },
  };
}

function telegraphAssets(THREE) {
  let assets = telegraphAssetsByThree.get(THREE);
  if (!assets) {
    assets = {
      geometry: new THREE.RingGeometry(0.63, 1, 32),
      materials: new Map(),
    };
    telegraphAssetsByThree.set(THREE, assets);
  }
  return assets;
}

function createTelegraph(THREE, archetype) {
  const assets = telegraphAssets(THREE);
  const color = archetype === "fortressWarden" ? 0xe65e35 : archetype === "brute" ? 0xdf8b31 : 0xc94b3c;
  if (!assets.materials.has(archetype)) {
    assets.materials.set(archetype, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide }));
  }
  const mesh = visibleMesh(THREE, assets.geometry, assets.materials.get(archetype), `${archetype} attack telegraph`);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.035;
  mesh.visible = false;
  return mesh;
}

function attachDirectorRoot(world, root) {
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

function createHumanoidRig(THREE, archetype, definition) {
  const palette = archetype === "hollowSoldier"
    ? { skin: 0x766a5c, cloth: 0x32383b, leather: 0x34251d, plate: 0x50595d, hair: 0x191615 }
    : archetype === "brute"
      ? { skin: 0x725b4c, cloth: 0x4c2922, leather: 0x3b281e, plate: 0x4b4642, hair: 0x211713 }
      : { skin: 0x65554c, cloth: 0x282832, leather: 0x291f1b, plate: 0x343b44, hair: 0x171518 };
  const mainHand = definition.weapon === "warden" ? "twoHanded" : definition.weapon;
  return createEquipmentRig({
    THREE,
    name: `${definition.name} visible humanoid`,
    scale: definition.scale,
    palette,
    loadout: {
      mainHand,
      offHand: archetype === "hollowSoldier" ? "shield" : null,
      armor: archetype === "hollowSoldier" || archetype === "fortressWarden" ? "plate" : "leather",
      owned: [mainHand, ...(archetype === "hollowSoldier" ? ["shield"] : [])],
    },
  });
}

class EnemyActor {
  constructor({ THREE, archetype, definition, director, world, services, input, events }) {
    this.THREE = THREE;
    this.id = makeRuntimeId(archetype);
    this.type = "enemy";
    this.archetype = archetype;
    this.name = definition.name;
    this.team = definition.team;
    this.definition = definition;
    this.questTarget = archetype === "wolf" ? "corrupted_wolf"
      : archetype === "fortressWarden" ? "fortress_warden"
        : archetype === "hollowSoldier" ? "hollow_soldier" : "ashen_brute";
    this.director = director;
    this.world = world;
    this.services = services;
    this.input = input;
    this.events = events;
    this.root = new THREE.Group();
    this.root.name = `${this.name} actor`;
    this.root.userData.rtxIgnore = true;
    this.root.userData.dynamicActor = true;
    this.visual = archetype === "wolf" ? createWolfRig(THREE) : createHumanoidRig(THREE, archetype, definition);
    this.root.add(this.visual.root);
    this.equipment = this.visual;
    this.telegraph = createTelegraph(THREE, archetype);
    this.root.add(this.telegraph);
    this.stats = { ...definition.stats };
    this.weapon = definition.weapon;
    this.aimHeight = archetype === "wolf" ? 0.8 : 1.35 * definition.scale;
    this.lootTable = definition.loot.map(item => ({ ...item }));
    this.alive = false;
    this.active = false;
    this.yaw = 0;
    this.state = "dormant";
    this.home = new THREE.Vector3();
    this.spawnPosition = new THREE.Vector3();
    this.attackCooldown = 0;
    this.deathTimer = 0;
    this.brainTimer = 0;
    this.phase = 1;
    this.pattern = 0;
    this.circleSign = Math.random() < 0.5 ? -1 : 1;
    this._targetPosition = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._unregister = registerActor(services, this);
    this.combat = createCombatController({ THREE, owner: this, world, services, events, team: this.team });
    this.navigator = createNavigator({ THREE, actor: this, world, services, events, config: { speed: definition.speed, capsule: { radius: archetype === "brute" || archetype === "fortressWarden" ? 0.56 : 0.36, height: archetype === "wolf" ? 0.9 : 1.72 * definition.scale } } });
    this.perception = createPerception({
      THREE, actor: this, world, services, events,
      hostile: candidate => candidate?.team === "player" || candidate?.team === "village" || candidate?.type === "player" || candidate?.type === "npc",
      config: { sightRange: definition.sightRange, loseRange: definition.sightRange * 1.45, hearingRange: definition.sightRange * 0.62, eyeHeight: this.aimHeight },
    });
    this.receiveHit = hit => {
      const result = this.combat.receiveHit(hit);
      if (hit?.source && actorAlive(hit.source)) this.perception.notifyNoise({ source: hit.source, position: actorPosition(hit.source, this._targetPosition), radius: 3 });
      return result;
    };
    this.onDeath = detail => {
      this.state = "dead";
      this.deathTimer = definition.boss ? 8 : 4.5;
      this.navigator.stop();
      const questEvent = { type: "kill", target: this.questTarget, amount: 1, enemy: this, killer: detail.source ?? null };
      services?.quests?.notify?.(questEvent);
      emitEvent(events, "quest:event", questEvent);
      emitEvent(events, definition.boss ? "boss:defeated" : "enemy:defeated", { enemy: this, target: this.questTarget, ...detail });
    };
    this.root.userData.actor = this;
    this.root.visible = false;
  }

  activate({ position, yaw = 0, home = position, level = 1, lootTable = null, name = null } = {}) {
    this.active = true;
    this.alive = true;
    this.root.visible = true;
    const spawn = position ?? this.spawnPosition.set(0, 0, 0);
    if (Array.isArray(spawn)) this.root.position.fromArray(spawn);
    else this.root.position.copy(spawn);
    this.root.rotation.set(0, yaw, 0);
    this.yaw = yaw;
    const homePosition = home ?? this.root.position;
    if (Array.isArray(homePosition)) this.home.fromArray(homePosition);
    else this.home.copy(homePosition);
    this.spawnPosition.copy(this.root.position);
    this.name = name ?? this.definition.name;
    const healthScale = 1 + Math.max(0, Number(level) - 1) * 0.12;
    Object.assign(this.stats, this.definition.stats);
    this.stats.maxHealth = Math.round(this.definition.stats.maxHealth * healthScale);
    this.stats.health = this.stats.maxHealth;
    this.stats.stamina = this.stats.maxStamina;
    this.stats.currentPoise = this.stats.poise;
    this.lootTable = (lootTable ?? this.definition.loot).map(item => ({ ...item }));
    this.attackCooldown = 0.4 + Math.random() * 0.4;
    this.deathTimer = 0;
    this.phase = 1;
    this.pattern = 0;
    this.state = "patrol";
    this.telegraph.visible = false;
    this.combat.revive({ health: this.stats.maxHealth, stamina: this.stats.maxStamina });
    emitEvent(this.events, this.definition.boss ? "boss:spawned" : "enemy:spawned", { enemy: this });
    return this;
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.alive = false;
    this.root.visible = false;
    this.navigator.stop();
    this.perception.target = null;
    this.telegraph.visible = false;
    emitEvent(this.events, "enemy:despawned", { enemy: this });
  }

  update(delta) {
    if (!this.active) return;
    const dt = clampDelta(delta);
    if (dt <= 0) return;
    const combat = this.combat.update(dt);
    if (combat.dead) {
      this.deathTimer -= dt;
      this.visual.updatePose(dt, { speed: 0, combat });
      if (this.deathTimer <= 0) this.deactivate();
      return;
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.brainTimer -= dt;
    const perception = this.perception.update(dt);
    const target = perception.target;
    if (target && actorAlive(target)) this._fight(target, dt);
    else this._idle(perception, dt);
    const navigation = this.navigator.update(dt, { speed: this._movementSpeed(), faceTarget: target ? actorPosition(target, this._targetPosition) : null });
    this.telegraph.visible = combat.state === COMBAT_STATES.WINDUP;
    if (this.telegraph.visible) {
      const reach = Math.max(1, Number(combat.attack?.reach ?? this.definition.attackRange));
      const pulse = 0.86 + combat.progress * 0.22;
      this.telegraph.scale.setScalar(reach * pulse);
    }
    this.visual.updatePose(dt, { speed: Math.hypot(navigation.velocity.x, navigation.velocity.z), combat });
  }

  snapshot() {
    return Object.freeze({
      id: this.id, archetype: this.archetype, name: this.name, active: this.active,
      questTarget: this.questTarget,
      position: this.root.position.clone(), state: this.state, phase: this.phase,
      combat: this.combat.snapshot(), perception: this.perception.snapshot(),
    });
  }

  dispose() {
    this.perception.dispose();
    this._unregister?.();
    this.visual.dispose();
    this.root.removeFromParent();
  }

  _movementSpeed() {
    if (this.combat.state === COMBAT_STATES.STAGGERED) return 0;
    if (this.combat.state === COMBAT_STATES.WINDUP) return this.definition.speed * 0.22;
    if (this.combat.state === COMBAT_STATES.RECOVERY) return this.definition.speed * 0.42;
    if (this.combat.state === COMBAT_STATES.BLOCKING) return this.definition.speed * 0.36;
    return this.definition.speed * (this.archetype === "fortressWarden" ? 1 + (this.phase - 1) * 0.12 : 1);
  }

  _distanceTo(target) {
    actorPosition(target, this._targetPosition);
    this._offset.copy(this._targetPosition).sub(this.root.position).setY(0);
    return this._offset.length();
  }

  _fight(target, dt) {
    const distance = this._distanceTo(target);
    this.state = "engaged";
    if (this.archetype === "wolf") this._wolfBrain(target, distance, dt);
    else if (this.archetype === "hollowSoldier") this._soldierBrain(target, distance);
    else if (this.archetype === "brute") this._bruteBrain(target, distance);
    else this._wardenBrain(target, distance);
  }

  _idle(perception) {
    this.combat.setBlocking(false);
    if (perception.lastKnownPosition && perception.memory > 0) {
      this.state = "search";
      this.navigator.setDestination(perception.lastKnownPosition);
      return;
    }
    if (this.root.position.distanceToSquared(this.home) > 2.25) {
      this.state = "returning";
      this.navigator.setDestination(this.home);
      return;
    }
    this.state = "patrol";
    if (!this.navigator.destination && this.brainTimer <= 0) {
      this.brainTimer = 2.5 + Math.random() * 3;
      const angle = Math.random() * Math.PI * 2;
      this._targetPosition.copy(this.home).add(this._offset.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(1.5 + Math.random() * 3));
      this.navigator.setDestination(this._targetPosition);
    }
  }

  _wolfBrain(target, distance) {
    this.combat.setBlocking(false);
    if (this.combat.isBusy()) return;
    if (distance <= this.definition.attackRange && this.attackCooldown <= 0) {
      const heavy = this.pattern++ % 3 === 2;
      if (this.combat.requestAttack(heavy ? "heavy" : "light")) {
        this.attackCooldown = heavy ? 1.35 : this.definition.cooldown;
        emitEvent(this.events, "enemy:wolf-lunge", { enemy: this, target, heavy });
      }
      return;
    }
    actorPosition(target, this._targetPosition);
    if (distance < 2.4 && this.attackCooldown > 0.45) {
      this._offset.copy(this.root.position).sub(this._targetPosition).setY(0).normalize().multiplyScalar(2.9);
      this.navigator.setDestination(this._targetPosition.clone().add(this._offset));
    } else {
      this._offset.copy(this.root.position).sub(this._targetPosition).setY(0).normalize();
      const x = this._offset.x;
      this._offset.set(-this._offset.z * this.circleSign, 0, x * this.circleSign).multiplyScalar(0.75);
      this.navigator.setDestination(this._targetPosition.clone().add(this._offset));
    }
  }

  _soldierBrain(target, distance) {
    const targetCombat = target.combat?.snapshot?.() ?? target.combat;
    const shouldBlock = distance < 2.3 && [COMBAT_STATES.WINDUP, COMBAT_STATES.ACTIVE].includes(targetCombat?.state) && this.stats.stamina > 14;
    this.combat.setBlocking(shouldBlock);
    if (shouldBlock || this.combat.isBusy()) return;
    if (distance <= this.definition.attackRange && this.attackCooldown <= 0) {
      const heavy = this.pattern++ % 4 === 3;
      if (this.combat.requestAttack(heavy ? "heavy" : "light")) this.attackCooldown = heavy ? 1.35 : this.definition.cooldown;
    } else this.navigator.setDestination(actorPosition(target, this._targetPosition));
  }

  _bruteBrain(target, distance) {
    this.combat.setBlocking(false);
    if (this.combat.isBusy()) return;
    if (distance <= this.definition.attackRange && this.attackCooldown <= 0) {
      const heavy = this.pattern++ % 3 !== 1;
      if (this.combat.requestAttack(heavy ? "heavy" : "light")) {
        this.attackCooldown = heavy ? 2 : 1.22;
        if (heavy) emitEvent(this.events, "enemy:brute-smash-telegraph", { enemy: this, target, duration: this.combat.duration });
      }
    } else this.navigator.setDestination(actorPosition(target, this._targetPosition));
  }

  _wardenBrain(target, distance) {
    const ratio = this.stats.health / this.stats.maxHealth;
    const desiredPhase = ratio <= 0.33 ? 3 : ratio <= 0.66 ? 2 : 1;
    const nextPhase = Math.min(desiredPhase, this.phase + 1);
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      this.combat.stats.currentPoise = this.combat.stats.poise;
      emitEvent(this.events, "boss:phase", { boss: this, phase: this.phase, healthRatio: ratio });
      this.world?.activateBossHazard?.({ boss: this, phase: this.phase });
      if (this.phase === 2) emitEvent(this.events, "boss:warden-braziers", { boss: this, active: true });
      if (this.phase === 3) emitEvent(this.events, "boss:warden-reinforcements", { boss: this, count: 2 });
    }
    this.combat.setBlocking(false);
    if (this.combat.isBusy()) return;
    if (distance <= this.definition.attackRange + (this.phase - 1) * 0.35 && this.attackCooldown <= 0) {
      const heavy = this.pattern++ % (this.phase === 1 ? 3 : 2) === 0;
      if (this.combat.requestAttack(heavy ? "heavy" : "light")) {
        this.attackCooldown = Math.max(0.58, this.definition.cooldown - (this.phase - 1) * 0.17);
        if (heavy && this.phase >= 2) {
          emitEvent(this.events, "boss:shockwave-telegraph", { boss: this, target, phase: this.phase, duration: this.combat.duration, radius: 3.8 + this.phase });
          this.world?.queueBossHazard?.({ kind: "warden-shockwave", source: this, delay: this.combat.duration, radius: 3.8 + this.phase });
        }
      }
    } else {
      actorPosition(target, this._targetPosition);
      if (this.phase >= 2 && distance < 1.8) {
        this._offset.copy(this.root.position).sub(this._targetPosition).setY(0).normalize().multiplyScalar(2.5);
        this._targetPosition.add(this._offset);
      }
      this.navigator.setDestination(this._targetPosition);
    }
  }
}

/** Fixed-capacity enemy pools; inactive actors are hidden and reused. */
export class EnemyDirector {
  constructor({ THREE: THREE_NS = THREE_DEFAULT, world, services = {}, input = services?.input ?? null, events = services?.events, capacities = {} } = {}) {
    if (!world) throw new TypeError("EnemyDirector requires world");
    this.THREE = THREE_NS;
    this.world = world;
    this.services = services;
    this.input = input;
    this.events = events;
    this.capacities = { wolf: 18, hollowSoldier: 14, brute: 6, fortressWarden: 1, ...capacities };
    this.root = new THREE_NS.Group();
    this.root.name = "Pooled dynamic enemies";
    this.root.userData.rtxIgnore = true;
    this.root.userData.dynamicActor = true;
    this.pools = new Map(Object.keys(ENEMY_ARCHETYPES).map(key => [key, []]));
    attachDirectorRoot(world, this.root);
  }

  spawn(archetype, options = {}) {
    const definition = ENEMY_ARCHETYPES[archetype];
    if (!definition) throw new RangeError(`Unknown enemy archetype: ${archetype}`);
    const pool = this.pools.get(archetype);
    let enemy = pool.find(candidate => !candidate.active);
    if (!enemy && pool.length < this.capacities[archetype]) {
      enemy = new EnemyActor({ THREE: this.THREE, archetype, definition, director: this, world: this.world, services: this.services, input: this.input, events: this.events });
      pool.push(enemy);
      this.root.add(enemy.root);
    }
    if (!enemy) {
      emitEvent(this.events, "enemy:pool-exhausted", { archetype, capacity: this.capacities[archetype] });
      return null;
    }
    return enemy.activate(options);
  }

  update(delta) {
    for (const pool of this.pools.values()) for (const enemy of pool) enemy.update(delta);
  }

  active(archetype = null) {
    const pools = archetype ? [this.pools.get(archetype) ?? []] : this.pools.values();
    return Array.from(pools).flatMap(pool => pool.filter(enemy => enemy.active));
  }

  queryRadius(origin, radius, { team = null } = {}) {
    const radiusSquared = radius * radius;
    return this.active().filter(enemy => (!team || enemy.team !== team) && enemy.root.position.distanceToSquared(origin) <= radiusSquared);
  }

  despawnAll() {
    for (const enemy of this.active()) enemy.deactivate();
  }

  dispose() {
    for (const pool of this.pools.values()) for (const enemy of pool) enemy.dispose();
    this.pools.clear();
    this.root.removeFromParent();
  }
}

export function createEnemyDirector(options) {
  return new EnemyDirector(options);
}

export function createEnemy({ archetype, ...options } = {}) {
  const director = options.director ?? new EnemyDirector(options);
  return director.spawn(archetype, options.spawn ?? options);
}
