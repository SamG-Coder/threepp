import * as THREE from "three/webgpu";

function targetPosition(target, output) {
  if (target?.getCameraAnchor) return target.getCameraAnchor(output);
  const position = target?.root?.position ?? target?.position ?? target;
  output.copy(position?.isVector3 ? position : new THREE.Vector3());
  output.y += 1.45;
  return output;
}

export function createThirdPersonCamera(camera, input, world, target) {
  const state = {
    yaw: Math.PI,
    pitch: 0.24,
    distance: 6.4,
    targetDistance: 6.4,
    shoulder: 0.48,
    lockedTarget: null,
  };
  const anchor = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const candidate = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function terrainSafeDistance(origin, offset, desiredDistance) {
    if (typeof world?.terrainHeight !== "function") return desiredDistance;
    let safe = desiredDistance;
    for (let step = 2; step <= 12; ++step) {
      const fraction = step / 12;
      candidate.copy(origin).addScaledVector(offset, fraction);
      const ground = world.terrainHeight(candidate.x, candidate.z) + 0.28;
      if (candidate.y < ground) {
        safe = Math.max(1.2, desiredDistance * (step - 1) / 12);
        break;
      }
    }
    return safe;
  }

  function update(delta) {
    const lookScale = input.pointer.locked ? 0.00235 : 0.0011;
    state.yaw -= input.pointer.dx * lookScale;
    state.pitch = THREE.MathUtils.clamp(state.pitch - input.pointer.dy * lookScale, -0.12, 0.72);
    if (input.pointer.wheel) {
      state.targetDistance = THREE.MathUtils.clamp(state.targetDistance + input.pointer.wheel * 0.55, 3.3, 9.2);
    }
    const smoothing = 1 - Math.exp(-Math.max(0, delta) * 12);
    state.distance = THREE.MathUtils.lerp(state.distance, state.targetDistance, smoothing);
    targetPosition(target, anchor);

    if (state.lockedTarget?.position) {
      const lockPosition = state.lockedTarget.position;
      direction.copy(lockPosition).sub(anchor);
      if (direction.lengthSq() > 0.01) {
        const lockYaw = Math.atan2(direction.x, direction.z);
        state.yaw = THREE.MathUtils.lerp(state.yaw, lockYaw + Math.PI, smoothing * 0.34);
      }
    }

    direction.set(
      Math.sin(state.yaw) * Math.cos(state.pitch),
      Math.sin(state.pitch),
      Math.cos(state.yaw) * Math.cos(state.pitch),
    );
    right.crossVectors(direction, up).normalize();
    const safeDistance = terrainSafeDistance(anchor, direction, state.distance);
    desired.copy(anchor)
      .addScaledVector(direction, safeDistance)
      .addScaledVector(right, state.shoulder);
    const minY = typeof world?.terrainHeight === "function"
      ? world.terrainHeight(desired.x, desired.z) + 0.3
      : -Infinity;
    desired.y = Math.max(desired.y, minY);
    camera.position.lerp(desired, 1 - Math.exp(-Math.max(0, delta) * 16));
    lookAt.copy(anchor);
    if (state.lockedTarget?.position) lookAt.lerp(state.lockedTarget.position, 0.42);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
  }

  return {
    state,
    get yaw() {
      return state.yaw + Math.PI;
    },
    setTarget(nextTarget) {
      target = nextTarget;
    },
    lockTo(object) {
      state.lockedTarget = object ?? null;
    },
    clearLock() {
      state.lockedTarget = null;
    },
    update,
  };
}
