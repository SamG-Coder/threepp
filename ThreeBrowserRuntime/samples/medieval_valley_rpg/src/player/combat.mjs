import * as THREE_DEFAULT from "three/webgpu";
import {
  actorAlive,
  actorPosition,
  clampDelta,
  emitEvent,
  queryActors,
} from "./runtime-contracts.mjs";

export const COMBAT_STATES = Object.freeze({
  IDLE: "idle",
  WINDUP: "windup",
  ACTIVE: "active",
  RECOVERY: "recovery",
  BLOCKING: "blocking",
  DODGING: "dodging",
  STAGGERED: "staggered",
  DEAD: "dead",
});

export const WEAPON_PROFILES = Object.freeze({
  sword: Object.freeze({
    light: Object.freeze({ windup: 0.16, active: 0.12, recovery: 0.28, stamina: 14, damage: 22, poise: 24, reach: 1.55, arc: 1.35 }),
    heavy: Object.freeze({ windup: 0.38, active: 0.16, recovery: 0.5, stamina: 30, damage: 43, poise: 52, reach: 1.72, arc: 1.12 }),
  }),
  twoHanded: Object.freeze({
    light: Object.freeze({ windup: 0.27, active: 0.17, recovery: 0.43, stamina: 24, damage: 39, poise: 48, reach: 2.05, arc: 1.5 }),
    heavy: Object.freeze({ windup: 0.62, active: 0.2, recovery: 0.72, stamina: 44, damage: 72, poise: 92, reach: 2.32, arc: 1.28, breaksProps: true }),
  }),
  crossbow: Object.freeze({
    light: Object.freeze({ windup: 0.34, active: 0.06, recovery: 0.4, stamina: 12, damage: 34, poise: 28, reach: 55, arc: 0.08, projectile: true, speed: 42 }),
    heavy: Object.freeze({ windup: 0.72, active: 0.06, recovery: 0.56, stamina: 22, damage: 58, poise: 46, reach: 70, arc: 0.05, projectile: true, speed: 52 }),
  }),
  claws: Object.freeze({
    light: Object.freeze({ windup: 0.19, active: 0.11, recovery: 0.31, stamina: 8, damage: 16, poise: 15, reach: 1.38, arc: 1.15 }),
    heavy: Object.freeze({ windup: 0.31, active: 0.14, recovery: 0.42, stamina: 18, damage: 29, poise: 31, reach: 1.62, arc: 0.95 }),
  }),
  warden: Object.freeze({
    light: Object.freeze({ windup: 0.2, active: 0.14, recovery: 0.3, stamina: 15, damage: 31, poise: 34, reach: 2.15, arc: 1.45 }),
    heavy: Object.freeze({ windup: 0.56, active: 0.24, recovery: 0.58, stamina: 34, damage: 64, poise: 78, reach: 2.8, arc: 1.75, breaksProps: true }),
  }),
});

function ensureStats(owner) {
  owner.stats ??= {};
  const stats = owner.stats;
  stats.maxHealth = Math.max(1, Number(stats.maxHealth ?? stats.health ?? 100));
  stats.health = Math.max(0, Math.min(stats.maxHealth, Number(stats.health ?? stats.maxHealth)));
  stats.maxStamina = Math.max(1, Number(stats.maxStamina ?? stats.stamina ?? 100));
  stats.stamina = Math.max(0, Math.min(stats.maxStamina, Number(stats.stamina ?? stats.maxStamina)));
  stats.staminaRegen = Math.max(0, Number(stats.staminaRegen ?? 22));
  stats.staminaRegenDelay = Math.max(0, Number(stats.staminaRegenDelay ?? 0));
  stats.armor = Math.max(0, Number(stats.armor ?? 0));
  stats.poise = Math.max(1, Number(stats.poise ?? 60));
  stats.currentPoise = Math.max(0, Math.min(stats.poise, Number(stats.currentPoise ?? stats.poise)));
  stats.poiseRegen = Math.max(0, Number(stats.poiseRegen ?? 13));
  return stats;
}

function weaponProfile(owner, kind) {
  const weapon = owner?.weapon ?? owner?.equipment?.primaryWeapon ?? "sword";
  const family = WEAPON_PROFILES[weapon] ?? WEAPON_PROFILES.sword;
  const base = family[kind] ?? family.light;
  const modifiers = owner?.combatProfile?.[kind] ?? owner?.combatProfile ?? {};
  return { ...base, ...modifiers, weapon, kind };
}

function targetIdentity(target) {
  return target?.id ?? target?.root?.uuid ?? target;
}

export class CombatStateMachine {
  constructor({
    THREE: THREE_NS = THREE_DEFAULT,
    owner,
    world = null,
    services = {},
    events = services?.events ?? null,
    team = owner?.team ?? "neutral",
  } = {}) {
    if (!owner) throw new TypeError("CombatStateMachine requires an owner");
    this.THREE = THREE_NS;
    this.owner = owner;
    this.world = world;
    this.services = services;
    this.events = events;
    this.team = team;
    this.stats = ensureStats(owner);
    this.state = COMBAT_STATES.IDLE;
    this.elapsed = 0;
    this.duration = Infinity;
    this.attack = null;
    this.attackId = 0;
    this.hitTargets = new Set();
    this.queuedAction = null;
    this.blockHeld = false;
    this.dodgeDirection = new THREE_NS.Vector3(0, 0, -1);
    this.dodgeIFrames = [0.12, 0.48];
    this.lastDamageAt = -Infinity;
    this._origin = new THREE_NS.Vector3();
    this._targetPosition = new THREE_NS.Vector3();
    this._forward = new THREE_NS.Vector3();
    this._toTarget = new THREE_NS.Vector3();
    this._activeStarted = false;
    this._lootDropped = false;
  }

  isDead() { return this.state === COMBAT_STATES.DEAD; }
  isBusy() { return ![COMBAT_STATES.IDLE, COMBAT_STATES.BLOCKING].includes(this.state); }
  isAttacking() { return [COMBAT_STATES.WINDUP, COMBAT_STATES.ACTIVE, COMBAT_STATES.RECOVERY].includes(this.state); }
  isInvulnerable() {
    if (this.state !== COMBAT_STATES.DODGING || this.duration <= 0) return false;
    const normalized = this.elapsed / this.duration;
    return normalized >= this.dodgeIFrames[0] && normalized <= this.dodgeIFrames[1];
  }

  spendStamina(amount, reason = "action") {
    const cost = Math.max(0, Number(amount) || 0);
    if (this.stats.stamina + 1e-6 < cost) return false;
    this.stats.stamina = Math.max(0, this.stats.stamina - cost);
    this.stats.staminaRegenDelay = Math.max(this.stats.staminaRegenDelay, reason === "sprint" ? 0.32 : 0.72);
    emitEvent(this.events, "combat:stamina", { actor: this.owner, amount: -cost, reason, stamina: this.stats.stamina });
    return true;
  }

  requestAttack(kind = "light") {
    if (this.isDead() || this.state === COMBAT_STATES.STAGGERED || this.state === COMBAT_STATES.DODGING) return false;
    if (this.isAttacking()) {
      if (this.state === COMBAT_STATES.RECOVERY && this.elapsed >= this.duration * 0.55) {
        this.queuedAction = kind === "heavy" ? "heavy" : "light";
        return true;
      }
      return false;
    }
    const profile = weaponProfile(this.owner, kind === "heavy" ? "heavy" : "light");
    if (!this.spendStamina(profile.stamina, profile.kind)) return false;
    this.attack = profile;
    this.attackId += 1;
    this.hitTargets.clear();
    this._activeStarted = false;
    this._setState(COMBAT_STATES.WINDUP, profile.windup);
    emitEvent(this.events, "combat:telegraph", {
      actor: this.owner,
      attackId: this.attackId,
      attack: { ...profile },
      duration: profile.windup,
    });
    return true;
  }

  setBlocking(enabled) {
    this.blockHeld = Boolean(enabled);
    if (this.isDead()) return false;
    if (this.blockHeld && this.state === COMBAT_STATES.IDLE && this.owner?.equipment?.offHand === "shield") {
      this._setState(COMBAT_STATES.BLOCKING, Infinity);
      emitEvent(this.events, "combat:block-start", { actor: this.owner });
      return true;
    }
    if (!this.blockHeld && this.state === COMBAT_STATES.BLOCKING) {
      this._setState(COMBAT_STATES.IDLE, Infinity);
      emitEvent(this.events, "combat:block-end", { actor: this.owner });
    }
    return this.state === COMBAT_STATES.BLOCKING;
  }

  requestDodge(direction = null, { duration = 0.54, stamina = 24 } = {}) {
    if (this.isDead() || this.state === COMBAT_STATES.STAGGERED || this.state === COMBAT_STATES.ACTIVE) return false;
    if (!this.spendStamina(stamina, "dodge")) return false;
    if (direction?.lengthSq?.() > 1e-5) this.dodgeDirection.copy(direction).setY(0).normalize();
    else this._ownerForward(this.dodgeDirection);
    this.attack = null;
    this.hitTargets.clear();
    this._setState(COMBAT_STATES.DODGING, Math.max(0.2, Number(duration) || 0.54));
    emitEvent(this.events, "combat:dodge", { actor: this.owner, direction: this.dodgeDirection.clone(), duration: this.duration });
    return true;
  }

  stagger(duration = 0.48, source = null) {
    if (this.isDead()) return false;
    this.attack = null;
    this.queuedAction = null;
    this._setState(COMBAT_STATES.STAGGERED, Math.max(0.15, Number(duration) || 0.48));
    emitEvent(this.events, "combat:stagger", { actor: this.owner, source, duration: this.duration });
    return true;
  }

  receiveHit(hit = {}) {
    if (this.isDead()) return { accepted: false, dead: true, reason: "dead" };
    if (this.isInvulnerable()) {
      emitEvent(this.events, "combat:dodge-avoided", { actor: this.owner, hit });
      return { accepted: false, avoided: true, reason: "dodge-i-frame" };
    }

    const rawDamage = Math.max(0, Number(hit.damage) || 0);
    let damage = rawDamage;
    let poiseDamage = Math.max(0, Number(hit.poiseDamage ?? hit.poise ?? rawDamage * 0.8));
    let blocked = false;

    if (this.state === COMBAT_STATES.BLOCKING && this._insideGuardArc(hit)) {
      const blockCost = Math.max(6, Number(hit.blockStaminaDamage ?? rawDamage * 0.72));
      const remaining = this.stats.stamina - blockCost;
      this.stats.stamina = Math.max(0, remaining);
      this.stats.staminaRegenDelay = Math.max(this.stats.staminaRegenDelay, 0.9);
      blocked = remaining >= 0;
      damage *= blocked ? 0.14 : 0.52;
      poiseDamage *= blocked ? 0.28 : 0.78;
      emitEvent(this.events, "combat:block", { actor: this.owner, source: hit.source, blocked, stamina: this.stats.stamina });
      if (!blocked) this.stagger(0.78, hit.source);
    }

    const mitigation = Math.min(0.72, this.stats.armor / (this.stats.armor + 100));
    damage *= 1 - mitigation;
    this.stats.health = Math.max(0, this.stats.health - damage);
    this.stats.currentPoise = Math.max(0, this.stats.currentPoise - poiseDamage);
    this.lastDamageAt = Number(hit.time ?? performance.now() * 0.001);

    const result = {
      accepted: true,
      actor: this.owner,
      source: hit.source ?? null,
      damage,
      rawDamage,
      blocked,
      health: this.stats.health,
      poise: this.stats.currentPoise,
      dead: this.stats.health <= 0,
    };
    emitEvent(this.events, "combat:hit", result);
    this.owner.onDamaged?.(result);

    if (result.dead) this.kill(hit.source, hit);
    else if (this.stats.currentPoise <= 0 && this.state !== COMBAT_STATES.STAGGERED) {
      this.stats.currentPoise = this.stats.poise * 0.34;
      this.stagger(Math.max(0.32, Number(hit.staggerDuration ?? 0.56)), hit.source);
    }
    return result;
  }

  kill(source = null, hit = null) {
    if (this.isDead()) return false;
    this.stats.health = 0;
    this.owner.alive = false;
    this.attack = null;
    this.queuedAction = null;
    this._setState(COMBAT_STATES.DEAD, 1.2);
    const detail = { actor: this.owner, source, hit, loot: this.owner.lootTable ?? [] };
    emitEvent(this.events, "combat:death", detail);
    this.owner.onDeath?.(detail);
    this._dropLoot(detail);
    return true;
  }

  revive({ health = null, stamina = null } = {}) {
    this.stats.health = Math.max(1, Math.min(this.stats.maxHealth, Number(health ?? this.stats.maxHealth)));
    this.stats.stamina = Math.max(0, Math.min(this.stats.maxStamina, Number(stamina ?? this.stats.maxStamina)));
    this.stats.currentPoise = this.stats.poise;
    this.owner.alive = true;
    this._lootDropped = false;
    this._setState(COMBAT_STATES.IDLE, Infinity);
  }

  update(delta) {
    const dt = clampDelta(delta);
    if (dt <= 0) return this.snapshot();
    this._updateResources(dt);
    this.elapsed += dt;

    if (this.state === COMBAT_STATES.ACTIVE) this._resolveActiveAttack();
    if (this.state === COMBAT_STATES.WINDUP && this.elapsed >= this.duration) {
      this._setState(COMBAT_STATES.ACTIVE, this.attack?.active ?? 0.1);
      this._activeStarted = true;
      emitEvent(this.events, "combat:active", { actor: this.owner, attackId: this.attackId, attack: this.attack });
      this.owner.onAttackActive?.({ combat: this, attack: this.attack, attackId: this.attackId });
      this._resolveActiveAttack();
    } else if (this.state === COMBAT_STATES.ACTIVE && this.elapsed >= this.duration) {
      this._setState(COMBAT_STATES.RECOVERY, this.attack?.recovery ?? 0.25);
      emitEvent(this.events, "combat:recovery", { actor: this.owner, attackId: this.attackId, attack: this.attack });
    } else if (this.state === COMBAT_STATES.RECOVERY && this.elapsed >= this.duration) {
      const queued = this.queuedAction;
      this.queuedAction = null;
      this.attack = null;
      this._setState(this.blockHeld && this.owner?.equipment?.offHand === "shield" ? COMBAT_STATES.BLOCKING : COMBAT_STATES.IDLE, Infinity);
      if (queued) this.requestAttack(queued);
    } else if ([COMBAT_STATES.DODGING, COMBAT_STATES.STAGGERED].includes(this.state) && this.elapsed >= this.duration) {
      this._setState(this.blockHeld && this.owner?.equipment?.offHand === "shield" ? COMBAT_STATES.BLOCKING : COMBAT_STATES.IDLE, Infinity);
    }
    return this.snapshot();
  }

  snapshot() {
    const finiteDuration = Number.isFinite(this.duration) && this.duration > 0;
    return Object.freeze({
      state: this.state,
      progress: finiteDuration ? Math.max(0, Math.min(1, this.elapsed / this.duration)) : 0,
      elapsed: this.elapsed,
      duration: this.duration,
      attackId: this.attackId,
      attack: this.attack ? { ...this.attack } : null,
      health: this.stats.health,
      maxHealth: this.stats.maxHealth,
      stamina: this.stats.stamina,
      maxStamina: this.stats.maxStamina,
      poise: this.stats.currentPoise,
      maxPoise: this.stats.poise,
      invulnerable: this.isInvulnerable(),
      blocking: this.state === COMBAT_STATES.BLOCKING,
      dead: this.isDead(),
    });
  }

  _setState(state, duration) {
    this.state = state;
    this.elapsed = 0;
    this.duration = duration;
    emitEvent(this.events, "combat:state", { actor: this.owner, state, duration, attackId: this.attackId });
  }

  _updateResources(dt) {
    if (this.stats.staminaRegenDelay > 0) this.stats.staminaRegenDelay = Math.max(0, this.stats.staminaRegenDelay - dt);
    else if (!this.owner.controller?.isSprinting && this.state !== COMBAT_STATES.WINDUP && this.state !== COMBAT_STATES.ACTIVE) {
      this.stats.stamina = Math.min(this.stats.maxStamina, this.stats.stamina + this.stats.staminaRegen * dt);
    }
    if (![COMBAT_STATES.STAGGERED, COMBAT_STATES.DEAD].includes(this.state)) {
      this.stats.currentPoise = Math.min(this.stats.poise, this.stats.currentPoise + this.stats.poiseRegen * dt);
    }
  }

  _ownerForward(target = this._forward) {
    const yaw = Number(this.owner.yaw ?? this.owner.root?.rotation?.y ?? 0);
    return target.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  }

  _insideGuardArc(hit) {
    this._ownerForward(this._forward);
    if (hit.source) {
      actorPosition(this.owner, this._origin);
      actorPosition(hit.source, this._targetPosition);
      this._toTarget.copy(this._targetPosition).sub(this._origin).setY(0);
    } else if (hit.direction) {
      this._toTarget.copy(hit.direction).multiplyScalar(-1).setY(0);
    } else return true;
    if (this._toTarget.lengthSq() < 1e-6) return true;
    this._toTarget.normalize();
    return this._forward.dot(this._toTarget) >= Math.cos(Number(hit.guardArc ?? 1.3) * 0.5);
  }

  _resolveActiveAttack() {
    if (!this.attack) return;
    if (this.attack.projectile) {
      if (this.hitTargets.has("__projectile__")) return;
      this.hitTargets.add("__projectile__");
      this._spawnProjectile();
      return;
    }

    actorPosition(this.owner, this._origin);
    this._ownerForward(this._forward);
    const candidates = queryActors(this.services, this.world, {
      origin: this._origin,
      direction: this._forward,
      radius: this.attack.reach,
      reach: this.attack.reach,
      arc: this.attack.arc,
      attacker: this.owner,
      team: this.team,
      attackId: this.attackId,
    });
    const minimumDot = Math.cos(this.attack.arc * 0.5);
    for (const target of candidates) {
      if (!target || target === this.owner || !actorAlive(target) || target.team === this.team) continue;
      const identity = targetIdentity(target);
      if (this.hitTargets.has(identity)) continue;
      actorPosition(target, this._targetPosition);
      this._toTarget.copy(this._targetPosition).sub(this._origin);
      const vertical = Math.abs(this._toTarget.y);
      this._toTarget.y = 0;
      const distance = this._toTarget.length();
      if (distance > this.attack.reach || vertical > 1.6) continue;
      if (distance > 0.001 && this._forward.dot(this._toTarget.multiplyScalar(1 / distance)) < minimumDot) continue;
      this.hitTargets.add(identity);
      const hit = {
        source: this.owner,
        attackId: this.attackId,
        weapon: this.attack.weapon,
        kind: this.attack.kind,
        damage: this.attack.damage,
        poiseDamage: this.attack.poise,
        direction: this._forward.clone(),
        point: this._targetPosition.clone(),
        staggerDuration: this.attack.kind === "heavy" ? 0.72 : 0.42,
      };
      const result = target.receiveHit?.(hit) ?? target.combat?.receiveHit?.(hit) ?? null;
      emitEvent(this.events, "combat:attack-hit", { actor: this.owner, target, hit, result });
    }

    if (this.attack.breaksProps) {
      this.world?.breakProps?.({ origin: this._origin, radius: this.attack.reach, source: this.owner, attack: this.attack });
    }
  }

  _spawnProjectile() {
    actorPosition(this.owner, this._origin);
    this._origin.y += Number(this.owner.aimHeight ?? 1.35);
    this._ownerForward(this._forward);
    const descriptor = {
      kind: "crossbow-bolt",
      source: this.owner,
      team: this.team,
      attackId: this.attackId,
      origin: this._origin.clone(),
      direction: this._forward.clone(),
      speed: this.attack.speed,
      range: this.attack.reach,
      damage: this.attack.damage,
      poiseDamage: this.attack.poise,
    };
    const spawned = this.services?.projectiles?.spawn?.(descriptor) ?? this.world?.spawnProjectile?.(descriptor);
    emitEvent(this.events, "combat:projectile", { ...descriptor, projectile: spawned ?? null });
  }

  _dropLoot(detail) {
    if (this._lootDropped || !Array.isArray(this.owner.lootTable) || this.owner.lootTable.length === 0) return;
    this._lootDropped = true;
    actorPosition(this.owner, this._origin);
    const drop = { source: this.owner, position: this._origin.clone(), table: this.owner.lootTable, killer: detail.source };
    this.services?.loot?.spawn?.(drop) ?? this.world?.spawnLoot?.(drop);
    emitEvent(this.events, "loot:drop", drop);
  }
}

export function createCombatController(options) {
  return new CombatStateMachine(options);
}
