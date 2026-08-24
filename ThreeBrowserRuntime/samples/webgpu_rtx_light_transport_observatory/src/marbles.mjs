import * as THREE from "three/webgpu";

const MAX_MARBLES = 48;
const FLOOR_Y = 0.005;
const ROOM_X = 11.85;
const ROOM_Z_MIN = -13.35;
const ROOM_Z_MAX = 13.15;
const FIXED_STEP = 1 / 120;
const MAX_STEPS = 6;
const RTX_INSTANCE_GROUP_ID = "observatory-marbles";

// A fixed seed makes the same sequence of Space presses reproducible while
// still giving every marble a different drop point, radius, tint and impulse.
function createRandom(seed = 0x4d415242) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function makeMarbleMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Polished observatory marble",
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.82,
    roughness: 0.075,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 2.6,
  });
  // The shared sphere geometry is registered once with the generic RTX
  // instance-group bridge; JS updates only each marble's transform and mask.
  material.rtxReflectionMask = 0.98;
  material.userData.rtxTriangleRadiance = [0.002, 0.0025, 0.003, 1];
  return material;
}

function chooseDropPoint(random) {
  // Keep the drop clear of the central kinetic sculpture and its plinth. This
  // preserves clean deterministic sphere physics without letting marbles pass
  // through an arbitrarily animated display object.
  for (let attempt = 0; attempt < 12; ++attempt) {
    const x = THREE.MathUtils.lerp(-8.8, 8.8, random());
    const z = THREE.MathUtils.lerp(-9.8, 10.6, random());
    const dx = x;
    const dz = z + 1.15;
    if (dx * dx + dz * dz > 12.25) return { x, z };
  }
  return { x: -7.2, z: 5.5 };
}

/**
 * One-draw-call marble pool with deterministic lightweight rigid-body motion.
 * The system owns no input listener: main.mjs forwards Space so existing
 * camera and Runtime overlay key handling remain authoritative.
 */
export function createMarbleDropSystem(scene) {
  const random = createRandom();
  const group = new THREE.Group();
  group.name = "Dynamic dropped marbles";
  scene.add(group);

  const geometry = new THREE.SphereGeometry(1, 32, 20);
  geometry.name = "Shared polished marble sphere";
  const material = makeMarbleMaterial();
  const instances = new THREE.InstancedMesh(geometry, material, MAX_MARBLES);
  instances.name = "Bounded reflective marble pool";
  instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instances.castShadow = true;
  instances.receiveShadow = true;
  instances.frustumCulled = false;
  group.add(instances);

  // The native bridge owns one BLAS for this shared unit sphere.  Per-marble
  // placement stays project-authored JS: each frame we only send fixed-capacity
  // affine transforms and visibility masks, which lets native refit the TLAS
  // without rebuilding geometry or knowing anything about this demo.
  const rtxPositions = new Float32Array(geometry.getAttribute("position").array);
  const rtxIndices = Uint32Array.from(geometry.index.array);
  const rtxTriangleCount = rtxIndices.length / 3;
  const rtxTriangleRadiance = new Float32Array(rtxTriangleCount * 4);
  const rtxTriangleSurface = new Float32Array(rtxTriangleCount * 4);
  for (let triangle = 0; triangle < rtxTriangleCount; ++triangle) {
    const offset = triangle * 4;
    rtxTriangleRadiance[offset] = 0.002;
    rtxTriangleRadiance[offset + 1] = 0.0025;
    rtxTriangleRadiance[offset + 2] = 0.003;
    rtxTriangleRadiance[offset + 3] = 1;
    rtxTriangleSurface[offset] = 1;
    rtxTriangleSurface[offset + 1] = 1;
    rtxTriangleSurface[offset + 2] = 1;
    rtxTriangleSurface[offset + 3] = 0.075;
  }
  const rtxInstanceGroup = Object.freeze({
    id: RTX_INSTANCE_GROUP_ID,
    capacity: MAX_MARBLES,
    positions: rtxPositions,
    indices: rtxIndices,
    triangleRadiance: rtxTriangleRadiance,
    triangleSurface: rtxTriangleSurface,
  });
  const rtxMatrices = new Float32Array(MAX_MARBLES * 12);
  const rtxMasks = new Uint32Array(MAX_MARBLES);
  for (let slot = 0; slot < MAX_MARBLES; ++slot) {
    const offset = slot * 12;
    rtxMatrices[offset] = 1;
    rtxMatrices[offset + 5] = 1;
    rtxMatrices[offset + 10] = 1;
  }

  const tints = [
    new THREE.Color(0xdde8ef),
    new THREE.Color(0xc57a32),
    new THREE.Color(0x54c7d9),
    new THREE.Color(0x8f2942),
    new THREE.Color(0x8970cc),
  ];
  const bodies = Array.from({ length: MAX_MARBLES }, (_, slot) => ({
    slot,
    active: false,
    serial: -1,
    radius: 0.2,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(),
    sleeping: false,
    sleepTime: 0,
  }));

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const hiddenScale = new THREE.Vector3(0, 0, 0);
  const hiddenPosition = new THREE.Vector3(0, -1000, 0);
  const identity = new THREE.Quaternion();
  const collisionNormal = new THREE.Vector3();
  const relativeVelocity = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const deltaRotation = new THREE.Quaternion();
  const spinAxis = new THREE.Vector3();
  const rtxLocalMatrix = new THREE.Matrix4();
  const rtxWorldMatrix = new THREE.Matrix4();
  let serial = 0;

  for (let slot = 0; slot < MAX_MARBLES; ++slot) {
    matrix.compose(hiddenPosition, identity, hiddenScale);
    instances.setMatrixAt(slot, matrix);
    instances.setColorAt(slot, tints[slot % tints.length]);
  }
  instances.instanceMatrix.needsUpdate = true;
  instances.instanceColor.needsUpdate = true;

  function syncBody(body) {
    if (!body.active) {
      matrix.compose(hiddenPosition, identity, hiddenScale);
    } else {
      scale.setScalar(body.radius);
      matrix.compose(body.position, body.orientation, scale);
    }
    instances.setMatrixAt(body.slot, matrix);
  }

  function spawn() {
    const body = bodies.find(candidate => !candidate.active)
      ?? bodies.reduce((oldest, candidate) => (
        candidate.serial < oldest.serial ? candidate : oldest
      ));
    const point = chooseDropPoint(random);
    body.active = true;
    body.serial = serial++;
    body.radius = THREE.MathUtils.lerp(0.145, 0.245, random());
    body.position.set(
      point.x,
      THREE.MathUtils.lerp(6.8, 8.1, random()),
      point.z,
    );
    body.velocity.set(
      THREE.MathUtils.lerp(-0.55, 0.55, random()),
      THREE.MathUtils.lerp(-0.15, 0.2, random()),
      THREE.MathUtils.lerp(-0.55, 0.55, random()),
    );
    body.orientation.setFromEuler(new THREE.Euler(
      random() * Math.PI,
      random() * Math.PI,
      random() * Math.PI,
    ));
    body.angularVelocity.set(
      THREE.MathUtils.lerp(-4.5, 4.5, random()),
      THREE.MathUtils.lerp(-4.5, 4.5, random()),
      THREE.MathUtils.lerp(-4.5, 4.5, random()),
    );
    body.sleeping = false;
    body.sleepTime = 0;
    instances.setColorAt(body.slot, tints[Math.floor(random() * tints.length)]);
    instances.instanceColor.needsUpdate = true;
    syncBody(body);
    instances.instanceMatrix.needsUpdate = true;
    return body;
  }

  function collideWithRoom(body) {
    const bounce = 0.54;
    const floor = FLOOR_Y + body.radius;
    if (body.position.y < floor) {
      body.position.y = floor;
      if (body.velocity.y < -0.62) {
        body.velocity.y *= -bounce;
      } else {
        body.velocity.y = 0;
      }
      const floorGrip = body.velocity.y === 0 ? 0.965 : 0.992;
      body.velocity.x *= floorGrip;
      body.velocity.z *= floorGrip;
      body.angularVelocity.multiplyScalar(0.986);
    }

    const minX = -ROOM_X + body.radius;
    const maxX = ROOM_X - body.radius;
    const minZ = ROOM_Z_MIN + body.radius;
    const maxZ = ROOM_Z_MAX - body.radius;
    if (body.position.x < minX || body.position.x > maxX) {
      body.position.x = THREE.MathUtils.clamp(body.position.x, minX, maxX);
      body.velocity.x *= -0.46;
      body.sleeping = false;
    }
    if (body.position.z < minZ || body.position.z > maxZ) {
      body.position.z = THREE.MathUtils.clamp(body.position.z, minZ, maxZ);
      body.velocity.z *= -0.46;
      body.sleeping = false;
    }
  }

  function collidePair(a, b) {
    collisionNormal.copy(b.position).sub(a.position);
    const minimumDistance = a.radius + b.radius;
    const distanceSquared = collisionNormal.lengthSq();
    if (distanceSquared >= minimumDistance * minimumDistance) return;

    let distance = Math.sqrt(distanceSquared);
    if (distance < 1e-6) {
      collisionNormal.set(((a.slot + b.slot) & 1) ? 1 : -1, 0, 0);
      distance = 0;
    } else {
      collisionNormal.multiplyScalar(1 / distance);
    }

    const inverseMassA = 1 / Math.max(0.001, a.radius ** 3);
    const inverseMassB = 1 / Math.max(0.001, b.radius ** 3);
    const inverseMassSum = inverseMassA + inverseMassB;
    const overlap = minimumDistance - distance;
    a.position.addScaledVector(collisionNormal, -overlap * inverseMassA / inverseMassSum);
    b.position.addScaledVector(collisionNormal, overlap * inverseMassB / inverseMassSum);

    relativeVelocity.copy(b.velocity).sub(a.velocity);
    const closingSpeed = relativeVelocity.dot(collisionNormal);
    if (closingSpeed >= 0) return;

    const impulse = -(1 + 0.64) * closingSpeed / inverseMassSum;
    a.velocity.addScaledVector(collisionNormal, -impulse * inverseMassA);
    b.velocity.addScaledVector(collisionNormal, impulse * inverseMassB);

    tangent.copy(relativeVelocity).addScaledVector(collisionNormal, -closingSpeed);
    const tangentLength = tangent.length();
    if (tangentLength > 1e-5) {
      tangent.multiplyScalar(1 / tangentLength);
      const frictionImpulse = Math.min(impulse * 0.11, tangentLength / inverseMassSum);
      a.velocity.addScaledVector(tangent, frictionImpulse * inverseMassA);
      b.velocity.addScaledVector(tangent, -frictionImpulse * inverseMassB);
    }
    if (Math.abs(closingSpeed) > 0.08) {
      a.sleeping = false;
      b.sleeping = false;
      a.sleepTime = 0;
      b.sleepTime = 0;
    }
  }

  function simulateStep(dt) {
    const active = bodies.filter(body => body.active);
    for (const body of active) {
      if (body.sleeping) continue;
      body.velocity.y -= 9.81 * dt;
      body.velocity.multiplyScalar(Math.exp(-0.055 * dt));
      body.position.addScaledVector(body.velocity, dt);
      if (body.angularVelocity.lengthSq() > 1e-7) {
        spinAxis.copy(body.angularVelocity);
        const angle = spinAxis.length() * dt;
        spinAxis.normalize();
        deltaRotation.setFromAxisAngle(spinAxis, angle);
        body.orientation.premultiply(deltaRotation).normalize();
      }
      collideWithRoom(body);
    }

    for (let aIndex = 0; aIndex < active.length; ++aIndex) {
      for (let bIndex = aIndex + 1; bIndex < active.length; ++bIndex) {
        collidePair(active[aIndex], active[bIndex]);
      }
    }

    for (const body of active) {
      const supported = body.position.y <= FLOOR_Y + body.radius + 0.001;
      const nearlyStill = body.velocity.lengthSq() < 0.0025;
      if (supported && nearlyStill) {
        body.sleepTime += dt;
        if (body.sleepTime > 0.8) {
          body.sleeping = true;
          body.velocity.set(0, 0, 0);
          body.angularVelocity.set(0, 0, 0);
        }
      } else {
        body.sleepTime = 0;
      }
    }
  }

  function update(delta) {
    const frameDelta = THREE.MathUtils.clamp(Number(delta) || 0, 0, 0.05);
    if (frameDelta <= 0) return;
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(frameDelta / FIXED_STEP)));
    const stepDelta = frameDelta / steps;
    for (let step = 0; step < steps; ++step) simulateStep(stepDelta);
    for (const body of bodies) syncBody(body);
    instances.instanceMatrix.needsUpdate = true;
  }

  function rayTracingInstanceUpdate() {
    // Three stores Matrix4 column-major; VkTransformMatrixKHR consumes a
    // row-major affine 3x4.  Include the InstancedMesh world transform so this
    // remains correct if the containing project moves/scales the whole pool.
    instances.updateWorldMatrix(true, false);
    for (let slot = 0; slot < MAX_MARBLES; ++slot) {
      const body = bodies[slot];
      const offset = slot * 12;
      if (!body.active) {
        rtxMasks[slot] = 0;
        rtxMatrices.fill(0, offset, offset + 12);
        rtxMatrices[offset] = 1;
        rtxMatrices[offset + 5] = 1;
        rtxMatrices[offset + 10] = 1;
        continue;
      }
      instances.getMatrixAt(slot, rtxLocalMatrix);
      rtxWorldMatrix.multiplyMatrices(instances.matrixWorld, rtxLocalMatrix);
      const e = rtxWorldMatrix.elements;
      rtxMatrices[offset] = e[0];
      rtxMatrices[offset + 1] = e[4];
      rtxMatrices[offset + 2] = e[8];
      rtxMatrices[offset + 3] = e[12];
      rtxMatrices[offset + 4] = e[1];
      rtxMatrices[offset + 5] = e[5];
      rtxMatrices[offset + 6] = e[9];
      rtxMatrices[offset + 7] = e[13];
      rtxMatrices[offset + 8] = e[2];
      rtxMatrices[offset + 9] = e[6];
      rtxMatrices[offset + 10] = e[10];
      rtxMatrices[offset + 11] = e[14];
      rtxMasks[slot] = 0xff;
    }
    return {
      id: RTX_INSTANCE_GROUP_ID,
      matrices: rtxMatrices,
      masks: rtxMasks,
    };
  }

  function dispose() {
    scene.remove(group);
    geometry.dispose();
    material.dispose();
  }

  return {
    group,
    instances,
    spawn,
    update,
    dispose,
    rtxInstanceGroup,
    rayTracingInstanceUpdate,
    maxMarbles: MAX_MARBLES,
  };
}
