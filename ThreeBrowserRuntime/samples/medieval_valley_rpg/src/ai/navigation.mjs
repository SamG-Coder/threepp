import * as THREE_DEFAULT from "three/webgpu";
import { clampDelta, emitEvent, resolveCharacterMotion } from "../player/runtime-contracts.mjs";

function toVector3(THREE, value) {
  if (!value) return null;
  if (Array.isArray(value)) return new THREE.Vector3().fromArray(value);
  return value.clone?.() ?? new THREE.Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

/** Lightweight path follower which defers navmesh/path/capsule work to world services. */
export class ActorNavigator {
  constructor({ THREE: THREE_NS = THREE_DEFAULT, actor, world, services = {}, events = services?.events, config = {} } = {}) {
    if (!actor?.root) throw new TypeError("ActorNavigator requires an actor with root");
    this.THREE = THREE_NS;
    this.actor = actor;
    this.world = world;
    this.services = services;
    this.events = events;
    this.config = {
      speed: 2.6,
      acceleration: 8,
      turnSpeed: 8,
      arrivalRadius: 0.35,
      repathInterval: 1.25,
      stepHeight: 0.4,
      slopeLimit: Math.PI * 0.34,
      capsule: { radius: 0.36, height: 1.7 },
      ...config,
    };
    this.config.capsule = { radius: 0.36, height: 1.7, ...(config.capsule ?? {}) };
    this.destination = null;
    this.path = [];
    this.pathIndex = 0;
    this.velocity = new THREE_NS.Vector3();
    this.direction = new THREE_NS.Vector3(0, 0, -1);
    this._target = new THREE_NS.Vector3();
    this._delta = new THREE_NS.Vector3();
    this._displacement = new THREE_NS.Vector3();
    this._repath = 0;
    this._stuckTime = 0;
    this._lastPosition = actor.root.position.clone();
    this.arrived = true;
    this.blocked = false;
  }

  setDestination(destination, { immediate = false } = {}) {
    const next = toVector3(this.THREE, destination);
    if (!next) return false;
    const changed = !this.destination || this.destination.distanceToSquared(next) > 0.16;
    this.destination = next;
    this.arrived = false;
    if (changed || immediate) this._rebuildPath();
    return true;
  }

  stop() {
    this.destination = null;
    this.path.length = 0;
    this.pathIndex = 0;
    this.velocity.x = this.velocity.z = 0;
    this.arrived = true;
  }

  update(delta, { speed = this.config.speed, faceTarget = null } = {}) {
    const dt = clampDelta(delta);
    if (dt <= 0) return this.snapshot();
    this._repath -= dt;
    if (!this.destination) {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * this.config.acceleration));
      return this.snapshot();
    }
    if (this._repath <= 0) this._rebuildPath();

    const waypoint = this.path[this.pathIndex] ?? this.destination;
    this._target.copy(waypoint);
    this._delta.copy(this._target).sub(this.actor.root.position);
    const vertical = this._delta.y;
    this._delta.y = 0;
    const distance = this._delta.length();
    const finalWaypoint = this.pathIndex >= this.path.length - 1;
    if (distance <= (finalWaypoint ? this.config.arrivalRadius : 0.28) && Math.abs(vertical) < 1.2) {
      if (!finalWaypoint) {
        this.pathIndex += 1;
        return this.update(dt, { speed, faceTarget });
      }
      this.arrived = true;
      this.velocity.x = this.velocity.z = 0;
      emitEvent(this.events, "navigation:arrived", { actor: this.actor, destination: this.destination.clone() });
      this.destination = null;
      return this.snapshot();
    }

    if (distance > 0.001) this.direction.copy(this._delta).multiplyScalar(1 / distance);
    const blend = 1 - Math.exp(-this.config.acceleration * dt);
    this.velocity.x = this.THREE.MathUtils.lerp(this.velocity.x, this.direction.x * speed, blend);
    this.velocity.z = this.THREE.MathUtils.lerp(this.velocity.z, this.direction.z * speed, blend);
    this.velocity.y -= Number(this.config.gravity ?? 22) * dt;
    this._displacement.copy(this.velocity).multiplyScalar(dt);
    const resolved = resolveCharacterMotion({
      THREE: this.THREE,
      world: this.world,
      actor: this.actor,
      position: this.actor.root.position,
      velocity: this.velocity,
      displacement: this._displacement,
      capsule: this.config.capsule,
      stepHeight: this.config.stepHeight,
      slopeLimit: this.config.slopeLimit,
      delta: dt,
    });
    this.actor.root.position.copy(resolved.position);
    this.velocity.copy(resolved.velocity);
    if (resolved.grounded && this.velocity.y < 0) this.velocity.y = 0;
    this.blocked = resolved.blocked;

    const facing = faceTarget ? this._target.copy(faceTarget).sub(this.actor.root.position).setY(0) : this.direction;
    if (facing.lengthSq() > 1e-5) {
      const yaw = Math.atan2(-facing.x, -facing.z);
      const difference = Math.atan2(Math.sin(yaw - this.actor.root.rotation.y), Math.cos(yaw - this.actor.root.rotation.y));
      this.actor.root.rotation.y += difference * (1 - Math.exp(-this.config.turnSpeed * dt));
      this.actor.yaw = this.actor.root.rotation.y;
    }

    const moved = this.actor.root.position.distanceTo(this._lastPosition);
    this._stuckTime = moved < 0.006 && distance > 0.8 ? this._stuckTime + dt : 0;
    this._lastPosition.copy(this.actor.root.position);
    if (this._stuckTime > 0.85) {
      this._stuckTime = 0;
      this._rebuildPath();
      emitEvent(this.events, "navigation:stuck", { actor: this.actor, destination: this.destination?.clone() });
    }
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      destination: this.destination?.clone() ?? null,
      velocity: this.velocity.clone(),
      arrived: this.arrived,
      blocked: this.blocked,
      pathIndex: this.pathIndex,
      pathLength: this.path.length,
    });
  }

  _rebuildPath() {
    if (!this.destination) return;
    this._repath = this.config.repathInterval;
    const request = { actor: this.actor, from: this.actor.root.position.clone(), to: this.destination.clone() };
    const path = this.services?.navigation?.findPath?.(request)
      ?? this.world?.findPath?.(request)
      ?? this.world?.navigation?.findPath?.(request.from, request.to, this.actor);
    this.path = Array.from(path ?? [this.destination]).map(point => toVector3(this.THREE, point)).filter(Boolean);
    if (this.path.length === 0) this.path.push(this.destination.clone());
    this.pathIndex = 0;
  }
}

export function createNavigator(options) {
  return new ActorNavigator(options);
}
