function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function planarPosition(value) {
  const source = value?.root?.position ?? value?.position ?? value;
  if (Array.isArray(source)) return { x: finite(source[0]), z: finite(source[2]) };
  return { x: finite(source?.x), z: finite(source?.z) };
}

function clearFooting(world, x, z, radius) {
  try {
    if (world?.isRoad?.(x, z)) return false;
    if (world?.isBlockedCircle?.(x, z, radius)) return false;
    return true;
  } catch {
    return false;
  }
}

function faceEachOther(playerRoot, actorRoot) {
  const dx = finite(playerRoot?.position?.x) - finite(actorRoot?.position?.x);
  const dz = finite(playerRoot?.position?.z) - finite(actorRoot?.position?.z);
  if (dx * dx + dz * dz <= 1e-8) return false;
  actorRoot.rotation.y = Math.atan2(-dx, -dz);
  playerRoot.rotation.y = Math.atan2(dx, dz);
  return true;
}

/**
 * Keeps a physical story interaction from placing two character meshes at the
 * same transform. Relocation is deliberately logical: it uses player.teleport
 * so the position subsequently captured by player.snapshot()/save is exactly
 * the position rendered by gameplay. Actors are never moved from authored
 * world anchors.
 */
export function stageConversationSeparation({
  player,
  actor,
  world,
  preferredPlayerPosition = null,
  minimumSeparation = 1.8,
  playerRadius = 0.43,
} = {}) {
  const playerRoot = player?.root;
  const actorRoot = actor?.root;
  if (!playerRoot?.position || !playerRoot?.rotation || !actorRoot?.position || !actorRoot?.rotation) {
    throw new TypeError("stageConversationSeparation requires player and actor roots");
  }

  const minimum = Math.max(0.8, finite(minimumSeparation, 1.8));
  const radius = Math.max(0.2, finite(playerRadius, 0.43));
  const actorPosition = planarPosition(actorRoot);
  let playerPosition = planarPosition(playerRoot);
  const initialDistance = Math.hypot(playerPosition.x - actorPosition.x, playerPosition.z - actorPosition.z);
  let moved = false;

  if (initialDistance < minimum && typeof player.teleport === "function") {
    const preferred = preferredPlayerPosition == null
      ? { x: playerPosition.x, z: playerPosition.z }
      : planarPosition(preferredPlayerPosition);
    let directionX = preferred.x - actorPosition.x;
    let directionZ = preferred.z - actorPosition.z;
    let directionLength = Math.hypot(directionX, directionZ);
    if (directionLength < 1e-6) {
      directionX = 1;
      directionZ = 0;
      directionLength = 1;
    }
    directionX /= directionLength;
    directionZ /= directionLength;
    const fallbackDistance = minimum + 0.55;
    const candidates = [
      preferred,
      { x: actorPosition.x + directionX * fallbackDistance, z: actorPosition.z + directionZ * fallbackDistance },
      { x: actorPosition.x - directionZ * fallbackDistance, z: actorPosition.z + directionX * fallbackDistance },
      { x: actorPosition.x + directionZ * fallbackDistance, z: actorPosition.z - directionX * fallbackDistance },
      { x: actorPosition.x - directionX * fallbackDistance, z: actorPosition.z - directionZ * fallbackDistance },
    ];
    const candidate = candidates.find(value =>
      Math.hypot(value.x - actorPosition.x, value.z - actorPosition.z) >= minimum &&
      clearFooting(world, value.x, value.z, radius));
    if (candidate) {
      player.teleport(candidate.x, candidate.z);
      playerPosition = planarPosition(playerRoot);
      moved = true;
    }
  }

  const faced = faceEachOther(playerRoot, actorRoot);
  const finalDistance = Math.hypot(playerPosition.x - actorPosition.x, playerPosition.z - actorPosition.z);
  return Object.freeze({
    moved,
    faced,
    initialDistance,
    finalDistance,
    minimumSeparation: minimum,
    playerPosition: Object.freeze([playerPosition.x, finite(playerRoot.position.y), playerPosition.z]),
    actorPosition: Object.freeze([actorPosition.x, finite(actorRoot.position.y), actorPosition.z]),
  });
}
