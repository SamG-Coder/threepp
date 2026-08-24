import * as THREE from "three/webgpu";

function activeBlockers(world) {
  return (world?.blockers ?? []).filter(blocker => blocker?.active !== false && blocker.shape === "aabb");
}

function overlapsBlocker(x, y, z, radius, height, blocker) {
  const [cx, cy, cz] = blocker.center;
  const [hx, hy, hz] = blocker.halfExtents;
  const horizontal = x >= cx - hx - radius && x <= cx + hx + radius &&
    z >= cz - hz - radius && z <= cz + hz + radius;
  const vertical = y + height >= cy - hy && y <= cy + hy;
  return horizontal && vertical;
}

export function attachWorldPhysics(world, scene) {
  if (!world || typeof world.terrainHeight !== "function") throw new TypeError("World physics requires terrainHeight.");
  const authoredSampleGround = typeof world.sampleGround === "function"
    ? world.sampleGround.bind(world)
    : null;
  const groundNormal = new THREE.Vector3(0, 1, 0);
  const sample = 0.55;

  world.scene = scene;
  world.actorsRoot = new THREE.Group();
  world.actorsRoot.name = "Dynamic gameplay actors";
  world.actorsRoot.userData.rtxIgnore = true;
  scene.add(world.actorsRoot);
  world.addDynamicActor = object => {
    world.actorsRoot.add(object);
    return object;
  };
  world.sampleGround = (x, z) => {
    if (authoredSampleGround) {
      const authored = authoredSampleGround(x, z);
      const height = Number(authored?.height ?? authored?.y ?? authored);
      if (Number.isFinite(height)) {
        const normal = authored?.normal?.clone?.() ?? new THREE.Vector3(0, 1, 0);
        return { ...authored, height, normal };
      }
    }
    const height = world.terrainHeight(x, z);
    const left = world.terrainHeight(x - sample, z);
    const right = world.terrainHeight(x + sample, z);
    const back = world.terrainHeight(x, z - sample);
    const front = world.terrainHeight(x, z + sample);
    groundNormal.set(left - right, sample * 2, back - front).normalize();
    return { height, normal: groundNormal.clone() };
  };

  world.resolveCharacterMotion = request => {
    const radius = Number(request.capsule?.radius ?? 0.38);
    const height = Number(request.capsule?.height ?? 1.72);
    const start = request.position;
    const desired = start.clone().add(request.displacement);
    const bounds = world.bounds ?? { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
    desired.x = THREE.MathUtils.clamp(desired.x, bounds.minX + radius, bounds.maxX - radius);
    desired.z = THREE.MathUtils.clamp(desired.z, bounds.minZ + radius, bounds.maxZ - radius);
    const blockers = activeBlockers(world);
    let blocked = false;

    const nextX = desired.x;
    if (blockers.some(blocker => overlapsBlocker(nextX, start.y, start.z, radius, height, blocker))) {
      desired.x = start.x;
      blocked = true;
    }
    const nextZ = desired.z;
    if (blockers.some(blocker => overlapsBlocker(desired.x, start.y, nextZ, radius, height, blocker))) {
      desired.z = start.z;
      blocked = true;
    }

    const ground = world.sampleGround(desired.x, desired.z);
    const currentGround = world.sampleGround(start.x, start.z).height;
    const rise = ground.height - Math.max(start.y, currentGround);
    const walkableSlope = ground.normal.y >= Math.cos(Number(request.slopeLimit ?? Math.PI * 0.34));
    if ((!walkableSlope || rise > Number(request.stepHeight ?? 0.42)) &&
        Math.hypot(desired.x - start.x, desired.z - start.z) > 0.001) {
      desired.x = start.x;
      desired.z = start.z;
      blocked = true;
    }

    const finalGround = world.sampleGround(desired.x, desired.z);
    const grounded = desired.y <= finalGround.height + 0.12 && Number(request.velocity.y) <= 0.5;
    if (grounded) desired.y = finalGround.height;
    const velocity = request.velocity.clone();
    if (grounded && velocity.y < 0) velocity.y = 0;
    if (blocked) {
      if (desired.x === start.x) velocity.x = 0;
      if (desired.z === start.z) velocity.z = 0;
    }
    return {
      position: desired,
      velocity,
      grounded,
      groundNormal: finalGround.normal,
      stepped: grounded && finalGround.height - currentGround > 0.035,
      blocked,
    };
  };

  world.clipCamera = ({ target, desired, radius = 0.18 }) => {
    const delta = desired.clone().sub(target);
    const steps = 28;
    let safeFraction = 1;
    const point = new THREE.Vector3();
    const blockers = activeBlockers(world);
    for (let step = 2; step <= steps; ++step) {
      const fraction = step / steps;
      point.copy(target).addScaledVector(delta, fraction);
      const belowTerrain = point.y < world.terrainHeight(point.x, point.z) + radius;
      const inStructure = blockers.some(blocker => overlapsBlocker(point.x, point.y, point.z, radius, radius * 2, blocker));
      if (belowTerrain || inStructure) {
        safeFraction = Math.max(0.12, (step - 2) / steps);
        break;
      }
    }
    return { position: target.clone().addScaledVector(delta, safeFraction) };
  };

  return world;
}
