function positionOf(actor) {
  return actor?.position ?? actor?.root?.position ?? actor?.object3D?.position ?? null;
}

function alive(actor) {
  return Boolean(actor) && actor.alive !== false && !actor.dead &&
    !actor.combat?.isDead?.() && Number(actor.stats?.health ?? 1) > 0;
}

export function createActorRegistry() {
  const actors = new Map();

  function register(actor) {
    if (!actor?.id) throw new TypeError("Registered actors require a stable id.");
    if (actors.has(actor.id) && actors.get(actor.id) !== actor) {
      throw new RangeError(`Actor id already registered: ${actor.id}`);
    }
    actors.set(actor.id, actor);
    return () => actors.delete(actor.id);
  }

  function queryRadius(origin, radius, request = {}) {
    const maximum = Math.max(0, Number(radius) || 0);
    const radiusSquared = maximum * maximum;
    const results = [];
    for (const actor of actors.values()) {
      if (request.actor === actor || request.attacker === actor) continue;
      if (request.team && actor.team === request.team && request.includeTeam !== true) continue;
      if (request.alive !== false && !alive(actor)) continue;
      const position = positionOf(actor);
      if (!position) continue;
      const dx = Number(position.x) - Number(origin.x);
      const dy = Number(position.y) - Number(origin.y);
      const dz = Number(position.z) - Number(origin.z);
      if (dx * dx + dy * dy + dz * dz <= radiusSquared) results.push(actor);
    }
    return results;
  }

  return {
    register,
    add: register,
    unregister(actor) {
      return actors.delete(typeof actor === "string" ? actor : actor?.id);
    },
    remove(actor) {
      return actors.delete(typeof actor === "string" ? actor : actor?.id);
    },
    get(id) {
      return actors.get(id) ?? null;
    },
    values() {
      return [...actors.values()];
    },
    queryRadius,
    queryTargets(request) {
      return queryRadius(request.origin, request.radius ?? request.reach ?? 0, request);
    },
    nearest(origin, predicate = () => true, maximumDistance = Infinity) {
      let result = null;
      let nearestSquared = maximumDistance * maximumDistance;
      for (const actor of actors.values()) {
        if (!predicate(actor) || !alive(actor)) continue;
        const position = positionOf(actor);
        if (!position) continue;
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        const dz = position.z - origin.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared < nearestSquared) {
          result = actor;
          nearestSquared = distanceSquared;
        }
      }
      return result;
    },
    snapshot() {
      return [...actors.values()].map(actor => ({
        id: actor.id,
        type: actor.type,
        team: actor.team,
        alive: alive(actor),
        health: Number(actor.stats?.health ?? 0),
        position: positionOf(actor)?.toArray?.() ?? null,
      }));
    },
    clear() {
      actors.clear();
    },
  };
}
