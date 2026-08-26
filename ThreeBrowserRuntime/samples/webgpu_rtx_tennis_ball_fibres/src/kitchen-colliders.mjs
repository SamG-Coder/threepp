import * as THREE from "three/webgpu";
import {
  KITCHEN_BENCH_HALF_X,
  KITCHEN_BENCH_HALF_Z,
  KITCHEN_FLOOR_HEIGHT,
  STUDIO_ROOM_EXTENT,
  STUDIO_ROOM_TOP,
  STUDIO_TABLE_HEIGHT,
} from "./tennis-ball.mjs";

// Collision follows the compressed rubber shell, not the longest flyaway
// fibre.  This preserves the ball's authored resting pose while allowing the
// visible nap to bend into a surface during a hard impact.
export const TENNIS_COLLISION_RADIUS = 1.0015;

const CONTACT_TOLERANCE = 0.004;
const AXIS_EPSILON = 1e-10;

function makeAabb(name, centre, size, {
  restitution = 0.28,
  friction = 0.04,
  kind = "fixture",
  supports = true,
} = {}) {
  const halfX = size[0] * 0.5;
  const halfY = size[1] * 0.5;
  const halfZ = size[2] * 0.5;
  return Object.freeze({
    name,
    kind,
    restitution,
    friction,
    supports,
    min: new THREE.Vector3(centre[0] - halfX, centre[1] - halfY, centre[2] - halfZ),
    max: new THREE.Vector3(centre[0] + halfX, centre[1] + halfY, centre[2] + halfZ),
  });
}

function colliderOptionsForName(name) {
  const lowerName = name.toLowerCase();
  if (/sink|basin/.test(lowerName)) {
    return { kind: "sink", restitution: 0.34, friction: 0.035 };
  }
  if (/tap|faucet/.test(lowerName)) {
    return { kind: "tap", restitution: 0.50, friction: 0.025 };
  }
  if (/worktop|counter|cooktop/.test(lowerName)) {
    return { kind: "counter", restitution: 0.30, friction: 0.09 };
  }
  if (/board/.test(lowerName)) {
    return { kind: "prop", restitution: 0.22, friction: 0.13 };
  }
  if (/refrigerator|fridge|hood|oven|dishwasher|appliance/.test(lowerName)) {
    return { kind: "appliance", restitution: 0.50, friction: 0.04 };
  }
  if (/cabinet|door|drawer|handle/.test(lowerName)) {
    return { kind: "cabinet", restitution: 0.44, friction: 0.08 };
  }
  return { kind: "fixture", restitution: 0.42, friction: 0.06 };
}

function addBoundsCollider(colliders, name, bounds, options) {
  if (bounds.isEmpty()) return;
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  if (size.x < 1e-5 && size.y < 1e-5 && size.z < 1e-5) return;
  // AABB resolution also supports thin plates, but a microscopic minimum
  // gives the solver an unambiguous inside/outside face at exact contact.
  size.set(Math.max(size.x, 0.002), Math.max(size.y, 0.002), Math.max(size.z, 0.002));
  colliders.push(makeAabb(name, centre.toArray(), size.toArray(), options));
}

function addTubeMeshVolumes(colliders, mesh) {
  const positions = mesh.geometry.getAttribute("position");
  const parameters = mesh.geometry.parameters ?? {};
  const tubularSegments = Math.max(1, parameters.tubularSegments ?? 1);
  const radialSegments = Math.max(3, parameters.radialSegments ?? 8);
  const ringStride = radialSegments + 1;
  const worldPoint = new THREE.Vector3();
  const segmentsPerVolume = Math.max(1, Math.ceil(tubularSegments / 10));
  for (let start = 0; start < tubularSegments; start += segmentsPerVolume) {
    const end = Math.min(tubularSegments, start + segmentsPerVolume);
    const bounds = new THREE.Box3().makeEmpty();
    for (let ring = start; ring <= end; ++ring) {
      for (let radial = 0; radial <= radialSegments; ++radial) {
        const vertex = ring * ringStride + radial;
        if (vertex >= positions.count) break;
        worldPoint.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld);
        bounds.expandByPoint(worldPoint);
      }
    }
    bounds.expandByScalar(0.018);
    addBoundsCollider(
      colliders,
      `${mesh.name || "Curved tube fixture"} segment ${Math.floor(start / segmentsPerVolume) + 1}`,
      bounds,
      colliderOptionsForName(mesh.name),
    );
  }
}

function addSceneFixtureVolumes(colliders, studioRoom) {
  studioRoom.updateWorldMatrix(true, true);
  studioRoom.traverse(object => {
    if (!object.isMesh || !object.geometry || object.userData.rtxIgnore) return;
    const name = String(object.name || "Kitchen fixture");
    let ancestor = object.parent;
    while (ancestor) {
      if (/World-axis deformable tennis ball pose|Rolling regulation tennis ball/i.test(ancestor.name)) {
        return;
      }
      ancestor = ancestor.parent;
    }
    // These broad surfaces already have exact room-shell volumes. Ignoring
    // their zero-thickness render geometry avoids duplicate contact normals.
    if (/wall$|wall below|wall above|wall behind|wall ahead|ceiling|checkerboard kitchen floor|recessed grout|backsplash|grout joint|planar-reflective polished kitchen island bench|solid charcoal quartz kitchen bench slab|soft contact underlay/i.test(name)) {
      return;
    }
    object.updateWorldMatrix(true, false);
    if (object.geometry.type === "TubeGeometry") {
      addTubeMeshVolumes(colliders, object);
      return;
    }
    const bounds = new THREE.Box3().setFromObject(object, true);
    addBoundsCollider(colliders, name, bounds, colliderOptionsForName(name));
  });
}

function addRoomVolumes(colliders, roomExtent, floorHeight, roomTop) {
  const roomSize = roomExtent * 2;
  colliders.push(
    makeAabb("Checkerboard kitchen floor", [0, floorHeight - 0.5, 0], [roomSize, 1, roomSize], {
      kind: "floor",
      restitution: 0.28,
      friction: 0.10,
    }),
    makeAabb("Kitchen ceiling", [0, roomTop + 0.5, 0], [roomSize, 1, roomSize], {
      kind: "ceiling",
      restitution: 0.30,
      friction: 0.03,
      supports: false,
    }),
    makeAabb("Kitchen rear wall", [0, (floorHeight + roomTop) * 0.5, -roomExtent - 0.5], [roomSize, roomTop - floorHeight, 1], {
      kind: "wall",
      restitution: 0.72,
      friction: 0.04,
      supports: false,
    }),
    makeAabb("Kitchen front wall", [0, (floorHeight + roomTop) * 0.5, roomExtent + 0.5], [roomSize, roomTop - floorHeight, 1], {
      kind: "wall",
      restitution: 0.72,
      friction: 0.04,
      supports: false,
    }),
    makeAabb("Kitchen left wall and window glazing", [-roomExtent - 0.5, (floorHeight + roomTop) * 0.5, 0], [1, roomTop - floorHeight, roomSize], {
      kind: "wall",
      restitution: 0.68,
      friction: 0.04,
      supports: false,
    }),
    makeAabb("Kitchen right wall", [roomExtent + 0.5, (floorHeight + roomTop) * 0.5, 0], [1, roomTop - floorHeight, roomSize], {
      kind: "wall",
      restitution: 0.72,
      friction: 0.04,
      supports: false,
    }),
  );
}

function addIslandVolumes(colliders, { includeFallbackBody = true } = {}) {
  colliders.push(
    // Match the visible shader plane rather than the slightly recessed quartz
    // edge mesh, so the ball does not hover or clip when it starts at y = 0.
    makeAabb(
      "Polished kitchen island worktop",
      [0, STUDIO_TABLE_HEIGHT - 0.33, 0],
      [KITCHEN_BENCH_HALF_X * 2, 0.66, KITCHEN_BENCH_HALF_Z * 2],
      { kind: "counter", restitution: 0.28, friction: 0.08 },
    ),
  );
  if (!includeFallbackBody) return;
  colliders.push(
    makeAabb("Kitchen island cabinet base", [0, -7.42, 0], [34.0, 12.25, 16.8], {
      kind: "cabinet",
      restitution: 0.46,
      friction: 0.07,
    }),
    // Shaker fronts and their handles extend beyond the carcass. One shallow
    // deterministic volume prevents the ball from visually entering either.
    makeAabb("Kitchen island front doors and hardware", [0, -7.18, 8.64], [34.0, 11.35, 0.48], {
      kind: "cabinet",
      restitution: 0.44,
      friction: 0.08,
    }),
  );
}

function addRearKitchenVolumes(colliders, floorHeight) {
  colliders.push(
    makeAabb("Rear base cabinet bank", [0, -7.30, -32.50], [61.0, 12.60, 7.0], {
      kind: "cabinet",
      restitution: 0.44,
      friction: 0.08,
    }),
    makeAabb("Rear honed worktop", [0, -0.68, -32.0], [62.0, 0.64, 8.0], {
      kind: "counter",
      restitution: 0.30,
      friction: 0.09,
    }),
    makeAabb("Full-height refrigerator", [27.0, (floorHeight + 18.0) * 0.5, -32.5], [10.0, 18.0 - floorHeight, 7.0], {
      kind: "appliance",
      restitution: 0.52,
      friction: 0.035,
    }),
    makeAabb("Left upper cabinet", [-14.5, 14.2, -33.7], [9.5, 12.5, 4.0], {
      kind: "cabinet",
      restitution: 0.44,
      friction: 0.08,
    }),
    makeAabb("Centre upper cabinet", [-4.2, 14.2, -33.7], [9.5, 12.5, 4.0], {
      kind: "cabinet",
      restitution: 0.44,
      friction: 0.08,
    }),
    makeAabb("Range hood body", [10.0, 11.3, -33.0], [8.8, 3.5, 4.4], {
      kind: "appliance",
      restitution: 0.50,
      friction: 0.04,
    }),
    makeAabb("Range hood chimney", [10.0, 17.6, -34.0], [3.6, 9.5, 2.5], {
      kind: "appliance",
      restitution: 0.48,
      friction: 0.04,
    }),
    makeAabb("Oak chopping board", [-3.0, -0.08, -31.6], [9.8, 0.34, 4.8], {
      kind: "prop",
      restitution: 0.22,
      friction: 0.13,
    }),
  );
}

function addLeftCounterAndSinkVolumes(colliders) {
  const cabinetOptions = { kind: "cabinet", restitution: 0.44, friction: 0.08 };
  const counterOptions = { kind: "counter", restitution: 0.30, friction: 0.09 };
  const sinkOptions = { kind: "sink", restitution: 0.34, friction: 0.035 };

  colliders.push(
    makeAabb("Rear left-counter cabinet bank", [-32.75, -7.30, -21.60], [6.5, 12.6, 10.8], cabinetOptions),
    makeAabb("Front left-counter cabinet bank", [-32.75, -7.30, 0.10], [6.5, 12.6, 11.8], cabinetOptions),
    // Four separate pieces leave the authored 5.1 x 9.6 sink opening clear.
    makeAabb("Window-side sink worktop strip", [-35.65, -0.68, -10.5], [0.70, 0.64, 33.0], counterOptions),
    makeAabb("Room-side sink worktop strip", [-29.10, -0.68, -10.5], [1.20, 0.64, 33.0], counterOptions),
    makeAabb("Rear sink worktop bridge", [-32.50, -0.68, -21.60], [5.60, 0.64, 10.8], counterOptions),
    makeAabb("Front sink worktop bridge", [-32.50, -0.68, 0.10], [5.60, 0.64, 11.8], counterOptions),
    makeAabb("Deep sink basin bottom", [-32.50, -3.00, -11.0], [5.18, 0.18, 9.55], sinkOptions),
    makeAabb("Sink window-side wall", [-35.15, -1.67, -11.0], [0.18, 2.60, 9.85], sinkOptions),
    makeAabb("Sink room-side wall", [-29.85, -1.67, -11.0], [0.18, 2.60, 9.85], sinkOptions),
    makeAabb("Sink rear wall", [-32.50, -1.67, -15.85], [5.48, 2.60, 0.18], sinkOptions),
    makeAabb("Sink front wall", [-32.50, -1.67, -6.15], [5.48, 2.60, 0.18], sinkOptions),
    // Approximate the curved tap with four tight boxes. This remains stable at
    // high speed and is substantially less snag-prone than triangle contacts.
    makeAabb("Tap vertical stem", [-35.15, 1.48, -11.0], [0.50, 3.96, 0.50], {
      kind: "tap", restitution: 0.50, friction: 0.025,
    }),
    makeAabb("Tap rear arch", [-34.48, 4.02, -11.0], [1.85, 2.15, 0.50], {
      kind: "tap", restitution: 0.50, friction: 0.025,
    }),
    makeAabb("Tap forward arch", [-32.75, 4.12, -11.0], [2.60, 1.96, 0.50], {
      kind: "tap", restitution: 0.50, friction: 0.025,
    }),
    makeAabb("Tap spout", [-31.52, 2.73, -11.0], [0.70, 1.84, 0.50], {
      kind: "tap", restitution: 0.50, friction: 0.025,
    }),
  );
}

function nearestInsideFace(position, collider, normal) {
  const candidates = [
    [position.x - collider.min.x, -1, 0, 0],
    [collider.max.x - position.x, 1, 0, 0],
    [position.y - collider.min.y, 0, -1, 0],
    [collider.max.y - position.y, 0, 1, 0],
    [position.z - collider.min.z, 0, 0, -1],
    [collider.max.z - position.z, 0, 0, 1],
  ];
  let nearest = candidates[0];
  for (let index = 1; index < candidates.length; ++index) {
    if (candidates[index][0] < nearest[0]) nearest = candidates[index];
  }
  normal.set(nearest[1], nearest[2], nearest[3]);
  return nearest[0];
}

export function createKitchenCollisionWorld({
  roomExtent = STUDIO_ROOM_EXTENT,
  floorHeight = KITCHEN_FLOOR_HEIGHT + 0.012,
  roomTop = STUDIO_ROOM_TOP,
  sceneRoot = null,
  studioRoom = null,
} = {}) {
  const colliders = [];
  const fixtureRoot = sceneRoot ?? studioRoom;
  addRoomVolumes(colliders, roomExtent, floorHeight, roomTop);
  addIslandVolumes(colliders, { includeFallbackBody: !fixtureRoot });
  if (fixtureRoot) {
    // Runtime geometry is authoritative. Building fixture AABBs from its
    // actual world bounds keeps collisions aligned as the procedural kitchen
    // is art-directed, without maintaining a second set of coordinates.
    addSceneFixtureVolumes(colliders, fixtureRoot);
  } else {
    // Deterministic fallback used by isolated tests and tooling that does not
    // instantiate the scene graph.
    addRearKitchenVolumes(colliders, floorHeight);
    addLeftCounterAndSinkVolumes(colliders);
  }

  const closest = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  function supportHeightBelow(position, radius = TENNIS_COLLISION_RADIUS) {
    let supportY = floorHeight + radius;
    for (const collider of colliders) {
      if (!collider.supports) continue;
      if (position.x < collider.min.x || position.x > collider.max.x ||
          position.z < collider.min.z || position.z > collider.max.z) continue;
      const candidate = collider.max.y + radius;
      if (candidate <= position.y + CONTACT_TOLERANCE && candidate > supportY) {
        supportY = candidate;
      }
    }
    return supportY;
  }

  function resolveSphere(position, velocity, radius = TENNIS_COLLISION_RADIUS, {
    maxPasses = 4,
  } = {}) {
    const contacts = new Map();
    let grounded = false;
    let supportY = supportHeightBelow(position, radius);
    let groundImpactSpeed = 0;
    let lateralImpactSpeed = 0;
    let ceilingImpactSpeed = 0;
    let strongestImpactSpeed = 0;
    let strongestContactName = "";

    for (let pass = 0; pass < maxPasses; ++pass) {
      let resolvedInPass = false;
      for (let colliderIndex = 0; colliderIndex < colliders.length; ++colliderIndex) {
        const collider = colliders[colliderIndex];
        closest.set(
          THREE.MathUtils.clamp(position.x, collider.min.x, collider.max.x),
          THREE.MathUtils.clamp(position.y, collider.min.y, collider.max.y),
          THREE.MathUtils.clamp(position.z, collider.min.z, collider.max.z),
        );
        delta.copy(position).sub(closest);
        const distanceSquared = delta.lengthSq();
        const contactRadius = radius + CONTACT_TOLERANCE;
        if (distanceSquared > contactRadius * contactRadius) continue;

        let distance = 0;
        let penetration = 0;
        if (distanceSquared > AXIS_EPSILON) {
          distance = Math.sqrt(distanceSquared);
          normal.copy(delta).multiplyScalar(1 / distance);
          penetration = radius - distance;
        } else {
          const insideDistance = nearestInsideFace(position, collider, normal);
          penetration = radius + insideDistance;
        }

        const incomingNormalSpeed = Math.max(0, -velocity.dot(normal));
        const isFloorContact = normal.y > 0.55;
        const isCeilingContact = normal.y < -0.55;
        const isLateralContact = Math.abs(normal.y) <= 0.55;
        const restsOnSurface = isFloorContact &&
          (incomingNormalSpeed > 0 || Math.abs(velocity.y) < 0.055);

        if (penetration > 0) {
          position.addScaledVector(normal, penetration + 1e-6);
          resolvedInPass = true;
        }

        if (incomingNormalSpeed > 0) {
          velocity.addScaledVector(normal, (1 + collider.restitution) * incomingNormalSpeed);
          tangent.copy(velocity).addScaledVector(normal, -velocity.dot(normal));
          velocity.addScaledVector(tangent, -collider.friction);
          if (incomingNormalSpeed > strongestImpactSpeed) {
            strongestImpactSpeed = incomingNormalSpeed;
            strongestContactName = collider.name;
          }
          if (isFloorContact) groundImpactSpeed = Math.max(groundImpactSpeed, incomingNormalSpeed);
          else if (isCeilingContact) ceilingImpactSpeed = Math.max(ceilingImpactSpeed, incomingNormalSpeed);
          else if (isLateralContact) lateralImpactSpeed = Math.max(lateralImpactSpeed, incomingNormalSpeed);
        }

        if (restsOnSurface) {
          grounded = true;
          supportY = Math.max(supportY, collider.max.y + radius);
        }
        if (!contacts.has(colliderIndex)) {
          contacts.set(colliderIndex, {
            name: collider.name,
            kind: collider.kind,
            normal: normal.clone(),
          });
        }
      }
      if (!resolvedInPass) break;
    }

    supportY = grounded ? position.y : supportHeightBelow(position, radius);
    return {
      contacts: [...contacts.values()],
      grounded,
      supportY,
      groundImpactSpeed,
      lateralImpactSpeed,
      ceilingImpactSpeed,
      strongestImpactSpeed,
      strongestContactName,
    };
  }

  return Object.freeze({
    colliders: Object.freeze(colliders),
    resolveSphere,
    supportHeightBelow,
  });
}
