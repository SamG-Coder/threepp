import * as THREE_DEFAULT from "three/webgpu";
import { actorAlive, actorPosition, clampDelta, emitEvent, listenEvent } from "../player/runtime-contracts.mjs";

function registryActors(services, world) {
  const value = services?.actors?.list?.() ?? services?.actors?.values?.() ?? world?.actors ?? [];
  if (value instanceof Map) return [...value.values()];
  return Array.from(value ?? []);
}

/** Sight, semantic-noise awareness and short-term target memory. */
export class ActorPerception {
  constructor({ THREE: THREE_NS = THREE_DEFAULT, actor, world, services = {}, events = services?.events, hostile = null, config = {} } = {}) {
    if (!actor?.root) throw new TypeError("ActorPerception requires an actor with root");
    this.THREE = THREE_NS;
    this.actor = actor;
    this.world = world;
    this.services = services;
    this.events = events;
    this.hostile = hostile ?? (candidate => candidate?.team !== actor.team && candidate?.team !== "neutral");
    this.config = {
      sightRange: 18,
      loseRange: 27,
      sightAngle: Math.PI * 0.72,
      hearingRange: 12,
      memoryDuration: 5,
      scanInterval: 0.18,
      eyeHeight: 1.45,
      ...config,
    };
    this.target = null;
    this.lastKnownPosition = null;
    this.awareness = 0;
    this.memory = 0;
    this._scanTimer = 0;
    this._origin = new THREE_NS.Vector3();
    this._candidate = new THREE_NS.Vector3();
    this._toCandidate = new THREE_NS.Vector3();
    this._forward = new THREE_NS.Vector3(0, 0, -1);
    this._disposeNoise = listenEvent(events, "perception:noise", detail => this.notifyNoise(detail));
  }

  update(delta) {
    const dt = clampDelta(delta);
    if (dt <= 0) return this.snapshot();
    this._scanTimer -= dt;
    if (this.target && actorAlive(this.target)) {
      actorPosition(this.actor, this._origin);
      actorPosition(this.target, this._candidate);
      const distance = this._origin.distanceTo(this._candidate);
      if (distance <= this.config.loseRange && (this._visible(this.target, true) || this.memory > 0)) {
        this.memory = Math.max(0, this.memory - dt);
        this.lastKnownPosition ??= new this.THREE.Vector3();
        if (this._visible(this.target, true)) {
          this.lastKnownPosition.copy(this._candidate);
          this.memory = this.config.memoryDuration;
          this.awareness = Math.min(1, this.awareness + dt * 2.8);
        }
      } else this._loseTarget();
    } else if (this.target) this._loseTarget();
    if (!this.target) {
      this.memory = Math.max(0, this.memory - dt);
      this.awareness = Math.max(0, this.awareness - dt * 0.22);
    }
    if (this._scanTimer <= 0) {
      this._scanTimer = this.config.scanInterval;
      this._scan();
    }
    return this.snapshot();
  }

  notifyNoise({ source = null, position = null, radius = 1, intensity = 1 } = {}) {
    if (source === this.actor || (source && !this.hostile(source))) return false;
    actorPosition(this.actor, this._origin);
    const point = position ? (position.clone?.() ?? new this.THREE.Vector3(position.x, position.y, position.z)) : source ? actorPosition(source, this._candidate) : null;
    if (!point) return false;
    const effectiveRange = this.config.hearingRange * Math.max(0.2, Number(radius) || 1) * Math.max(0.1, Number(intensity) || 1);
    if (this._origin.distanceToSquared(point) > effectiveRange * effectiveRange) return false;
    this.lastKnownPosition ??= new this.THREE.Vector3();
    this.lastKnownPosition.copy(point);
    this.memory = Math.max(this.memory, this.config.memoryDuration * 0.65);
    this.awareness = Math.min(1, this.awareness + 0.45);
    if (source && actorAlive(source)) this._acquire(source, "noise");
    return true;
  }

  snapshot() {
    return Object.freeze({
      target: this.target,
      aware: this.awareness >= 0.65,
      awareness: this.awareness,
      memory: this.memory,
      lastKnownPosition: this.lastKnownPosition?.clone() ?? null,
    });
  }

  dispose() { this._disposeNoise?.(); }

  _scan() {
    let best = this.target;
    let bestDistance = Infinity;
    actorPosition(this.actor, this._origin);
    for (const candidate of registryActors(this.services, this.world)) {
      if (!candidate || candidate === this.actor || !actorAlive(candidate) || !this.hostile(candidate)) continue;
      actorPosition(candidate, this._candidate);
      const distance = this._origin.distanceToSquared(this._candidate);
      if (distance >= bestDistance || distance > this.config.sightRange ** 2) continue;
      if (!this._visible(candidate, false)) continue;
      best = candidate;
      bestDistance = distance;
    }
    if (!best && this.services?.player && this.hostile(this.services.player) && this._visible(this.services.player, false)) best = this.services.player;
    if (best && best !== this.target) this._acquire(best, "sight");
  }

  _visible(candidate, omitArc = false) {
    actorPosition(this.actor, this._origin);
    actorPosition(candidate, this._candidate);
    this._origin.y += this.config.eyeHeight;
    this._candidate.y += Number(candidate.aimHeight ?? 1.1);
    this._toCandidate.copy(this._candidate).sub(this._origin);
    const distance = this._toCandidate.length();
    if (distance > (omitArc ? this.config.loseRange : this.config.sightRange)) return false;
    if (!omitArc && distance > 0.001) {
      const yaw = Number(this.actor.yaw ?? this.actor.root.rotation.y ?? 0);
      this._forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      const flat = this._toCandidate.clone().setY(0).normalize();
      if (this._forward.dot(flat) < Math.cos(this.config.sightAngle * 0.5)) return false;
    }
    const request = { observer: this.actor, target: candidate, from: this._origin.clone(), to: this._candidate.clone() };
    const result = this.services?.perception?.lineOfSight?.(request)
      ?? this.world?.lineOfSight?.(request)
      ?? this.world?.physics?.lineOfSight?.(request.from, request.to, this.actor, candidate);
    return result == null ? true : Boolean(result.visible ?? result.clear ?? result);
  }

  _acquire(target, sense) {
    this.target = target;
    this.lastKnownPosition ??= new this.THREE.Vector3();
    actorPosition(target, this.lastKnownPosition);
    this.memory = this.config.memoryDuration;
    this.awareness = Math.max(this.awareness, sense === "sight" ? 1 : 0.72);
    emitEvent(this.events, "perception:acquired", { actor: this.actor, target, sense });
  }

  _loseTarget() {
    const target = this.target;
    this.target = null;
    emitEvent(this.events, "perception:lost", { actor: this.actor, target, lastKnownPosition: this.lastKnownPosition?.clone() });
  }
}

export function createPerception(options) {
  return new ActorPerception(options);
}
