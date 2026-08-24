/**
 * Small adapters shared by the actor systems.  They deliberately accept
 * several common service shapes so the gameplay modules stay independent of
 * the world, quest and UI implementations.
 */

let nextRuntimeId = 1;

export function makeRuntimeId(prefix = "actor") {
  return `${prefix}-${nextRuntimeId++}`;
}

export function emitEvent(events, type, detail = {}) {
  if (!events) return false;
  if (typeof events.emit === "function") {
    events.emit(type, detail);
    return true;
  }
  if (typeof events.dispatchEvent === "function") {
    events.dispatchEvent({ type, detail });
    return true;
  }
  return false;
}

export function listenEvent(events, type, listener) {
  if (!events || typeof listener !== "function") return () => {};
  if (typeof events.on === "function") {
    const result = events.on(type, listener);
    if (typeof result === "function") return result;
    return () => events.off?.(type, listener);
  }
  if (typeof events.addEventListener === "function") {
    const wrapped = event => listener(event?.detail ?? event);
    events.addEventListener(type, wrapped);
    return () => events.removeEventListener?.(type, wrapped);
  }
  return () => {};
}

export function actorPosition(actor, target = null) {
  const source = actor?.position ?? actor?.root?.position ?? actor?.object3D?.position;
  if (!source) return target?.set?.(0, 0, 0) ?? { x: 0, y: 0, z: 0 };
  if (target?.copy) return target.copy(source);
  return { x: Number(source.x) || 0, y: Number(source.y) || 0, z: Number(source.z) || 0 };
}

export function actorAlive(actor) {
  if (!actor) return false;
  if (actor.alive === false || actor.dead === true) return false;
  if (actor.combat?.isDead?.()) return false;
  return Number(actor.stats?.health ?? 1) > 0;
}

export function actionDown(input, action) {
  if (!input) return false;
  if (typeof input.actionDown === "function") return Boolean(input.actionDown(action));
  if (typeof input.isDown === "function") return Boolean(input.isDown(action));
  if (typeof input.down === "function") return Boolean(input.down(action));
  if (typeof input.getAction === "function") return Boolean(input.getAction(action));
  if (input.actions instanceof Map) return Boolean(input.actions.get(action));
  if (input.actions instanceof Set) return input.actions.has(action);
  return Boolean(input.actions?.[action] ?? input[action]);
}

export function actionPressed(input, action) {
  if (!input) return false;
  if (typeof input.consumePressed === "function") return Boolean(input.consumePressed(action));
  if (typeof input.actionPressed === "function") return Boolean(input.actionPressed(action));
  if (typeof input.wasPressed === "function") return Boolean(input.wasPressed(action));
  if (typeof input.pressed === "function") return Boolean(input.pressed(action));
  if (input.pressed instanceof Set) return input.pressed.has(action);
  return Boolean(input.pressed?.[action]);
}

export function readAxis(input, axis, negativeAction = null, positiveAction = null) {
  let value = 0;
  if (typeof input?.axis === "function") value = Number(input.axis(axis));
  else if (typeof input?.getAxis === "function") value = Number(input.getAxis(axis));
  else if (input?.axes instanceof Map) value = Number(input.axes.get(axis));
  else value = Number(input?.axes?.[axis] ?? 0);
  if (!Number.isFinite(value)) value = 0;
  if (negativeAction && actionDown(input, negativeAction)) value -= 1;
  if (positiveAction && actionDown(input, positiveAction)) value += 1;
  return Math.max(-1, Math.min(1, value));
}

export function consumeLookDelta(input) {
  const value = typeof input?.consumeLookDelta === "function"
    ? input.consumeLookDelta()
    : typeof input?.lookDelta === "function"
      ? input.lookDelta()
      : input?.look ?? input?.pointerDelta ?? null;
  const x = Number(value?.x ?? value?.[0] ?? 0);
  const y = Number(value?.y ?? value?.[1] ?? 0);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

export function queryActors(services, world, request) {
  const candidates =
    services?.combat?.queryTargets?.(request) ??
    world?.queryCombatTargets?.(request) ??
    services?.actors?.queryRadius?.(request.origin, request.radius, request) ??
    world?.queryActors?.(request.origin, request.radius, request) ??
    [];
  return Array.from(candidates ?? []);
}

/** Minimal shared registry used by combat, perception, NPC and interaction code. */
export class ActorRegistry {
  constructor() { this.actors = new Set(); }
  register(actor) {
    if (!actor) return () => {};
    this.actors.add(actor);
    return () => this.actors.delete(actor);
  }
  add(actor) { return this.register(actor); }
  unregister(actor) { return this.actors.delete(actor); }
  remove(actor) { return this.unregister(actor); }
  list() { return [...this.actors]; }
  values() { return this.actors.values(); }
  queryRadius(origin, radius, request = {}) {
    const point = origin?.isVector3 ? origin : { x: Number(origin?.x) || 0, y: Number(origin?.y) || 0, z: Number(origin?.z) || 0 };
    const radiusSquared = Math.max(0, Number(radius) || 0) ** 2;
    const result = [];
    for (const actor of this.actors) {
      if (!actorAlive(actor) || actor === request.exclude) continue;
      const position = actorPosition(actor);
      const dx = position.x - point.x;
      const dy = position.y - point.y;
      const dz = position.z - point.z;
      if (dx * dx + dy * dy + dz * dz <= radiusSquared) result.push(actor);
    }
    return result;
  }
  clear() { this.actors.clear(); }
}

export function createActorRegistry() {
  return new ActorRegistry();
}

export function resolveLocation(world, services, name, fallback = null) {
  const aliases = {
    brynnaHome: "weavers_house",
    forge: "blacksmith",
    forgeInterior: "blacksmith",
    innUpperFloor: "inn",
    innCounter: "inn",
    innKitchen: "inn",
    chapelCell: "chapel",
    shrine: "chapel",
    herbGarden: "herb_garden",
    guardBarracks: "reeves_house",
    villageGate: "south_watch_post",
    guardTower: "south_watch_post",
    beaconSquare: "village_beacon",
    bridge: "stone_bridge",
    miraFarmhouse: "riverside_house",
    eastField: "east_field",
    mill: "watermill",
    millHouse: "watermill",
    millBridge: "stone_bridge",
  };
  const key = aliases[name] ?? name;
  const interactable = world?.interactables?.find?.(entry => entry.id === key || entry.landmarkId === key);
  const value = services?.locations?.get?.(name) ?? services?.locations?.get?.(key) ??
    services?.locations?.[name] ?? services?.locations?.[key] ??
    interactable ??
    world?.getLocation?.(name) ?? world?.getLocation?.(key) ??
    world?.locations?.get?.(name) ?? world?.locations?.get?.(key) ??
    world?.locations?.[name] ?? world?.locations?.[key] ??
    world?.landmarks?.[key] ?? fallback;
  return value?.position ?? value;
}

export function resolveCharacterMotion({
  THREE,
  world,
  actor,
  position,
  velocity,
  displacement,
  capsule,
  stepHeight,
  slopeLimit,
  delta,
}) {
  const request = {
    actor,
    position: position.clone(),
    velocity: velocity.clone(),
    displacement: displacement.clone(),
    capsule: { ...capsule },
    stepHeight,
    slopeLimit,
    delta,
  };
  const resolved =
    world?.resolveCharacterMotion?.(request) ??
    world?.physics?.resolveCharacterMotion?.(request) ??
    null;
  if (resolved) {
    const nextPosition = resolved.position ?? resolved.end ?? request.position.add(displacement);
    const nextVelocity = resolved.velocity ?? velocity;
    return {
      position: Array.isArray(nextPosition) ? new THREE.Vector3().fromArray(nextPosition)
        : nextPosition.clone?.() ?? new THREE.Vector3(nextPosition.x, nextPosition.y, nextPosition.z),
      velocity: Array.isArray(nextVelocity) ? new THREE.Vector3().fromArray(nextVelocity)
        : nextVelocity.clone?.() ?? new THREE.Vector3(nextVelocity.x, nextVelocity.y, nextVelocity.z),
      grounded: Boolean(resolved.grounded),
      groundNormal: Array.isArray(resolved.groundNormal) ? new THREE.Vector3().fromArray(resolved.groundNormal)
        : resolved.groundNormal?.clone?.() ?? new THREE.Vector3(0, 1, 0),
      stepped: Boolean(resolved.stepped),
      blocked: Boolean(resolved.blocked),
    };
  }

  const next = position.clone().add(displacement);
  const ground =
    world?.sampleGround?.(next.x, next.z, actor) ??
    world?.terrain?.sampleGround?.(next.x, next.z, actor) ??
    world?.terrainHeight?.(next.x, next.z) ??
    null;
  let groundHeight = Number(ground?.height ?? ground?.y ?? ground);
  let groundNormal = ground?.normal?.clone?.() ?? new THREE.Vector3(0, 1, 0);
  for (const surface of world?.walkableSurfaces ?? []) {
    if (surface?.active === false) continue;
    let inside = false;
    let height = Number(surface?.height ?? surface?.y);
    if (surface?.center && surface?.halfExtents) {
      const [cx, cy, cz] = surface.center;
      const [hx, hy, hz] = surface.halfExtents;
      inside = next.x >= cx - hx && next.x <= cx + hx && next.z >= cz - hz && next.z <= cz + hz;
      height = Number(surface.height ?? (cy + hy));
    } else if ([surface?.minX, surface?.maxX, surface?.minZ, surface?.maxZ].every(Number.isFinite)) {
      inside = next.x >= surface.minX && next.x <= surface.maxX && next.z >= surface.minZ && next.z <= surface.maxZ;
    }
    if (!inside || !Number.isFinite(height) || height > position.y + stepHeight + 0.14) continue;
    if (!Number.isFinite(groundHeight) || height > groundHeight) {
      groundHeight = height;
      groundNormal = surface.normal?.clone?.() ?? new THREE.Vector3(0, 1, 0);
    }
  }
  let grounded = false;
  let stepped = false;
  let blocked = false;
  if (Number.isFinite(groundHeight) && next.y <= groundHeight + 0.08) {
    const rise = groundHeight - position.y;
    if (rise <= stepHeight + 0.02) {
      next.y = groundHeight;
      if (velocity.y < 0) velocity.y = 0;
      grounded = true;
      stepped = Math.abs(next.y - position.y) > 0.02;
    } else {
      next.x = position.x;
      next.z = position.z;
      blocked = true;
    }
  }

  // The sample world exposes static AABB blockers even when no physics service
  // is installed. Resolve their horizontal footprint and preserve axis sliding.
  const radius = Math.max(0, Number(capsule?.radius) || 0);
  const actorTop = next.y + Math.max(radius * 2, Number(capsule?.height) || 1.7);
  for (const blocker of world?.blockers ?? []) {
    if (!blocker?.active || blocker.shape !== "aabb") continue;
    const center = blocker.center ?? blocker.position;
    const half = blocker.halfExtents;
    if (!center || !half) continue;
    const [cx, cy, cz] = center;
    const [hx, hy, hz] = half;
    const minimumY = cy - hy;
    const maximumY = cy + hy;
    if (actorTop <= minimumY || next.y >= maximumY) continue;
    const inside = (x, z) => x > cx - hx - radius && x < cx + hx + radius && z > cz - hz - radius && z < cz + hz + radius;
    if (!inside(next.x, next.z)) continue;
    const obstacleRise = maximumY - next.y;
    if (obstacleRise > 0 && obstacleRise <= stepHeight + 0.02) {
      next.y = maximumY;
      grounded = true;
      stepped = true;
      continue;
    }
    const currentInside = inside(position.x, position.z);
    if (!currentInside && !inside(position.x, next.z)) next.x = position.x;
    else if (!currentInside && !inside(next.x, position.z)) next.z = position.z;
    else if (!currentInside) {
      next.x = position.x;
      next.z = position.z;
    }
    blocked = true;
  }
  const nextVelocity = velocity.clone();
  if (next.x === position.x && Math.abs(displacement.x) > 1e-7) nextVelocity.x = 0;
  if (next.z === position.z && Math.abs(displacement.z) > 1e-7) nextVelocity.z = 0;
  const horizontalMotion = displacement.x * displacement.x + displacement.z * displacement.z;
  return {
    position: next,
    velocity: nextVelocity,
    grounded,
    groundNormal,
    stepped,
    blocked: blocked || (next.x === position.x && next.z === position.z && horizontalMotion > 1e-8),
  };
}

export function clampDelta(delta, maximum = 0.05) {
  const value = Number(delta);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(maximum, value);
}
