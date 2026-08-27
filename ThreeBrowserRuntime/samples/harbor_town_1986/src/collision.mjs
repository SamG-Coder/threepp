function isNonBlockingDefinition(definition) {
  return definition.moduleOnly
    || definition.ambientOnly
    || definition.walkable
    || definition.id.startsWith("civilian-");
}

function obstacleFor(definition, pose, padding) {
  const width = Number(definition?.collisionWidth ?? definition?.realWidth);
  const depth = Number(definition?.collisionDepth ?? definition?.realDepth);
  if (!(width > 0) || !(depth > 0)) return null;
  const yaw = Number(pose?.yaw) || 0;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const halfX = (width * c + depth * s) * 0.5 + padding;
  const halfZ = (width * s + depth * c) * 0.5 + padding;
  return {
    id: definition.id,
    x: Number(pose.x) || 0,
    z: Number(pose.z) || 0,
    halfX,
    halfZ,
  };
}

export function buildAssetObstacles(subjects, instances, assembliesOrPadding = [], padding = 0.28) {
  // Keep the former (subjects, instances, padding) call shape valid while
  // allowing logical assemblies to contribute one whole-object footprint.
  const assemblies = Array.isArray(assembliesOrPadding) ? assembliesOrPadding : [];
  const resolvedPadding = typeof assembliesOrPadding === "number" && Number.isFinite(assembliesOrPadding)
    ? Number(assembliesOrPadding)
    : padding;
  const definitions = [...subjects, ...assemblies];
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const result = [];
  for (const definition of definitions) {
    if (isNonBlockingDefinition(definition)) continue;
    const obstacle = obstacleFor(definition, definition, resolvedPadding);
    if (obstacle) result.push(obstacle);
  }
  for (const pose of instances) {
    const definition = byId.get(pose.asset);
    if (!definition || isNonBlockingDefinition(definition)) continue;
    const obstacle = obstacleFor(definition, pose, resolvedPadding);
    if (obstacle) result.push(obstacle);
  }
  return Object.freeze(result.map(Object.freeze));
}

export function pointBlocked(x, z, obstacles) {
  return obstacles.some(obstacle => (
    Math.abs(x - obstacle.x) < obstacle.halfX
    && Math.abs(z - obstacle.z) < obstacle.halfZ
  ));
}

/** Resolve a short movement with axis sliding, then apply the world-pad clamp. */
export function resolveWalk(from, target, obstacles, clamp) {
  const clampPoint = point => (typeof clamp === "function" ? clamp(point.x, point.z) : point);
  const desired = clampPoint(target);
  if (!pointBlocked(desired.x, desired.z, obstacles)) return desired;

  const alongX = clampPoint({ x: desired.x, z: from.z });
  const alongZ = clampPoint({ x: from.x, z: desired.z });
  const candidates = [];
  if (!pointBlocked(alongX.x, alongX.z, obstacles)) candidates.push(alongX);
  if (!pointBlocked(alongZ.x, alongZ.z, obstacles)) candidates.push(alongZ);
  if (!candidates.length) return clampPoint(from);
  candidates.sort((a, b) => (
    Math.hypot(b.x - from.x, b.z - from.z) - Math.hypot(a.x - from.x, a.z - from.z)
  ));
  return candidates[0];
}
