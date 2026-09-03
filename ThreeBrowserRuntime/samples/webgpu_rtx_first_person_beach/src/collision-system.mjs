import * as THREE from "three/webgpu";
import { terrainHeight } from "./terrain.mjs";

export const PLAYER_RADIUS = 0.31;
const STEP_CLEARANCE = 0.08;

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

  function supportAt(x, z) {
    let height = terrainHeight(x, z);
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

  return {
    colliders,
    groundHeightAt(x, z) {
      return supportAt(x, z).height;
    },
    surfaceAt(x, z) {
      return supportAt(x, z);
    },
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
