import * as THREE from "three/webgpu";
import { terrainHeight } from "./terrain.mjs";

export const PLAYER_RADIUS = 0.31;
const STEP_CLEARANCE = 0.08;
const MAX_TOOL_SWEEP_STEPS = 64;

function circleIntersectsBox(x, z, radius, box) {
  const closestX = THREE.MathUtils.clamp(x, box.min.x, box.max.x);
  const closestZ = THREE.MathUtils.clamp(z, box.min.z, box.max.z);
  return Math.hypot(x - closestX, z - closestZ) < radius;
}

function containsTop(box, x, z, margin = 0) {
  return x >= box.min.x + margin && x <= box.max.x - margin
    && z >= box.min.z + margin && z <= box.max.z - margin;
}

export function createBeachCollisionWorld(world) {
  const colliders = [];
  const terrainDepressions = [];
  world.dressing?.updateWorldMatrix?.(true, true);

  for (const palm of world.palms ?? []) {
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    palm.getWorldPosition(position);
    palm.getWorldScale(scale);
    colliders.push({
      kind: "palm",
      shape: "cylinder",
      x: position.x,
      z: position.z,
      radius: 0.34 * Math.max(scale.x, scale.z),
      minY: position.y - 0.05,
      maxY: position.y + 10.8 * scale.y,
    });
  }

  for (const object of world.dressing?.children ?? []) {
    const name = String(object.name || "").toLowerCase();
    if (!name.includes("rock") && !name.includes("driftwood")) continue;
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) colliders.push({
      kind: name.includes("driftwood") ? "wood" : "rock",
      shape: "box",
      box,
      minY: box.min.y,
      maxY: box.max.y,
    });
  }

  function overlaps(collider, x, z, radius = 0) {
    if (collider.shape === "cylinder") {
      return Math.hypot(x - collider.x, z - collider.z) < collider.radius + radius;
    }
    return circleIntersectsBox(x, z, radius, collider.box);
  }

  function blockedAt(x, z, feetY) {
    for (const collider of colliders) {
      if (feetY > collider.maxY + STEP_CLEARANCE || feetY + 1.58 < collider.minY) continue;
      if (overlaps(collider, x, z, PLAYER_RADIUS)) return true;
    }
    return false;
  }

  function terrainSurfaceHeight(x, z) {
    let depression = 0;
    for (const record of terrainDepressions) {
      if (!record) continue;
      const dx = x - record.x;
      const dz = z - record.z;
      const localX = dx * record.rightX + dz * record.rightZ;
      const localZ = dx * record.forwardX + dz * record.forwardZ;
      const q = Math.pow(Math.abs(localX) / record.radiusX, 3)
        + Math.pow(Math.abs(localZ) / record.radiusZ, 3);
      if (q >= 1) continue;
      const edge = THREE.MathUtils.smoothstep(q, 0.32, 1);
      depression = Math.max(depression, record.depth * (1 - edge));
    }
    return terrainHeight(x, z) - depression;
  }

  function supportAt(x, z) {
    let height = terrainSurfaceHeight(x, z);
    let kind = "terrain";
    for (const collider of colliders) {
      // Palm trunks are walls, not walkable columns. Rock and driftwood tops
      // can support the player after a jump without snapping them upward from
      // ground level merely for approaching the object.
      if (collider.kind === "palm" || collider.shape !== "box") continue;
      if (!containsTop(collider.box, x, z, 0.035)) continue;
      if (collider.maxY > height) {
        height = collider.maxY;
        kind = collider.kind;
      }
    }
    return { height, kind };
  }

  function pointContact(x, y, z, radius = 0.055) {
    for (const collider of colliders) {
      if (y + radius < collider.minY || y - radius > collider.maxY) continue;
      if (collider.shape === "cylinder") {
        if (Math.hypot(x - collider.x, z - collider.z) <= collider.radius + radius) {
          return { kind: collider.kind, collider, x, y, z };
        }
        continue;
      }
      const box = collider.box;
      if (x >= box.min.x - radius && x <= box.max.x + radius
        && z >= box.min.z - radius && z <= box.max.z + radius) {
        return { kind: collider.kind, collider, x, y, z };
      }
    }
    const groundY = terrainSurfaceHeight(x, z);
    if (y - radius <= groundY) return { kind: "terrain", collider: null, x, y: groundY, z };
    return null;
  }

  function sweepPoint(from, to, radius = 0.055) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const stepLength = Math.max(0.018, radius * 0.6);
    const steps = Math.min(MAX_TOOL_SWEEP_STEPS, Math.max(1, Math.ceil(distance / stepLength)));
    for (let index = 0; index <= steps; index += 1) {
      const alpha = index / steps;
      const hit = pointContact(
        THREE.MathUtils.lerp(from.x, to.x, alpha),
        THREE.MathUtils.lerp(from.y, to.y, alpha),
        THREE.MathUtils.lerp(from.z, to.z, alpha),
        radius,
      );
      if (hit) return { ...hit, alpha };
    }
    return null;
  }

  return {
    colliders,
    groundHeightAt(x, z) {
      return supportAt(x, z).height;
    },
    surfaceAt(x, z) {
      return supportAt(x, z);
    },
    terrainHeightAt: terrainSurfaceHeight,
    setTerrainDepression(index, depression) {
      terrainDepressions[index] = { ...depression };
    },
    pointContact,
    sweepPoint,
    resolveMovement(fromX, fromZ, toX, toZ, feetY) {
      let x = fromX;
      let z = fromZ;
      // Axis-separated resolution naturally slides along rocks/logs instead
      // of cancelling the complete stride when only one axis is obstructed.
      if (!blockedAt(toX, z, feetY)) x = toX;
      if (!blockedAt(x, toZ, feetY)) z = toZ;
      return { x, z };
    },
  };
}
