import * as THREE from "three/webgpu";

function targetAnchor(target, output) {
  if (target?.getCameraAnchor) return target.getCameraAnchor(output);
  const position = target?.root?.position ?? target?.position ?? target;
  output.copy(position?.isVector3 ? position : new THREE.Vector3());
  output.y += target?.isVehicle ? 1.25 : 1.45;
  return output;
}

function angleDelta(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

const OBSTRUCTION_MIN_DISTANCE = 3.2;
const OBSTRUCTION_HOLD_SECONDS = 0.22;
const OBSTRUCTION_SWITCH_MARGIN = 0.06;

export function createChaseCamera(camera, input, world) {
  camera.rotation.order = "YXZ";
  const state = {
    yaw: 0,
    targetYaw: 0,
    pitch: 0.22,
    targetPitch: 0.22,
    distance: 6.2,
    targetDistance: 6.2,
    mode: 0,
    fov: Number(camera.fov) || 58,
    aimBlend: 0,
    roll: 0,
    shake: 0,
    shakeTime: 0,
    obstructionChoice: 0,
    obstructionHold: 0,
    obstructionDistance: Infinity,
  };
  const anchor = new THREE.Vector3();
  const smoothAnchor = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const thirdPersonPosition = new THREE.Vector3();
  const normalClippedPosition = new THREE.Vector3();
  const rearLeftDesired = new THREE.Vector3();
  const rearRightDesired = new THREE.Vector3();
  const highQuarterDesired = new THREE.Vector3();
  const rearLeftClipped = new THREE.Vector3();
  const rearRightClipped = new THREE.Vector3();
  const highQuarterClipped = new THREE.Vector3();
  const firstPersonPosition = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const flatForward = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const localRollAxis = new THREE.Vector3(0, 0, 1);
  const cameraEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const baseQuaternion = new THREE.Quaternion();
  const rollQuaternion = new THREE.Quaternion();
  const clipResult = { position: normalClippedPosition, safeFraction: 1, distance: Infinity };
  const clipRequest = {
    target: smoothAnchor,
    desired: thirdPersonPosition,
    radius: 0.22,
    output: normalClippedPosition,
    result: clipResult,
  };
  let anchorReady = false;

  function clipInto(target, desiredPosition, output) {
    output.copy(desiredPosition);
    if (typeof world?.clipCamera !== "function") return output;
    let clipped = null;
    try {
      clipped = world.clipCamera(target, desiredPosition, 0.22, output);
    } catch {
      clipRequest.target = target;
      clipRequest.desired = desiredPosition;
      clipRequest.output = output;
      clipResult.position = output;
      try { clipped = world.clipCamera(clipRequest); } catch { return output.copy(desiredPosition); }
    }
    const position = clipped?.position?.isVector3 ? clipped.position : clipped?.isVector3 ? clipped : null;
    if (position && position !== output) output.copy(position);
    return output;
  }

  function updateVectors() {
    const cosPitch = Math.cos(state.pitch);
    forward.set(
      -Math.sin(state.yaw) * cosPitch,
      -Math.sin(state.pitch),
      -Math.cos(state.yaw) * cosPitch,
    ).normalize();
    flatForward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw)).normalize();
    right.crossVectors(flatForward, up).normalize();
  }

  function update(delta, target, { driving = false, speed = 0, aiming = false, steering = 0, lateralSpeed = 0 } = {}) {
    const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
    const look = input.consumeLookDelta();
    const sensitivity = input.pointer.locked ? 0.00235 : 0.0012;
    state.targetYaw -= look.x * sensitivity;
    state.targetPitch = THREE.MathUtils.clamp(state.targetPitch + look.y * sensitivity, -0.12, driving ? 0.58 : 0.68);
    if (look.wheel) state.targetDistance = THREE.MathUtils.clamp(state.targetDistance + look.wheel * 0.65, 3.4, 11.5);
    if (input.actionPressed("camera")) state.mode = (state.mode + 1) % 2;

    const targetYaw = Number(target?.state?.yaw ?? target?.root?.rotation?.y);
    if (driving && !aiming && Math.abs(look.x) < 0.01 && Number.isFinite(targetYaw)) {
      const followRate = 0.58 + Math.min(1.5, Math.abs(Number(speed) || 0) * 0.035);
      state.targetYaw += angleDelta(targetYaw, state.targetYaw) * (1 - Math.exp(-dt * followRate));
    }
    const orbitResponse = input.pointer.locked ? 20 : 14;
    state.yaw += angleDelta(state.targetYaw, state.yaw) * (1 - Math.exp(-dt * orbitResponse));
    state.pitch += (state.targetPitch - state.pitch) * (1 - Math.exp(-dt * orbitResponse));

    const firstPersonAim = Boolean(aiming && !driving);
    state.aimBlend += ((firstPersonAim ? 1 : 0) - state.aimBlend) *
      (1 - Math.exp(-dt * (firstPersonAim ? 18 : 13)));
    if (firstPersonAim && state.aimBlend > 0.997) state.aimBlend = 1;
    if (!firstPersonAim && state.aimBlend < 0.003) state.aimBlend = 0;

    const baseDistance = driving ? (state.mode === 0 ? 8.2 : 5.7) : (state.mode === 0 ? 6.2 : 4.2);
    if (!look.wheel) state.targetDistance += (baseDistance - state.targetDistance) * (1 - Math.exp(-dt * 2.5));
    state.distance += (state.targetDistance - state.distance) * (1 - Math.exp(-dt * 10));
    updateVectors();
    targetAnchor(target, anchor);
    if (driving) anchor.y += 0.45;
    if (!anchorReady || dt <= 0) {
      smoothAnchor.copy(anchor);
      anchorReady = true;
    } else {
      smoothAnchor.lerp(anchor, 1 - Math.exp(-dt * (driving ? 8 : 16)));
    }

    const speedPullback = driving ? Math.min(2.2, Math.abs(Number(speed) || 0) * 0.065) : 0;
    thirdPersonPosition.copy(smoothAnchor).addScaledVector(forward, -(state.distance + speedPullback));
    thirdPersonPosition.y += driving ? 0.8 : 0.35;
    clipInto(smoothAnchor, thirdPersonPosition, normalClippedPosition);
    const normalDistance = normalClippedPosition.distanceTo(smoothAnchor);
    state.obstructionHold = Math.max(0, state.obstructionHold - dt);
    let chasedPosition = normalClippedPosition;
    let chosenObstruction = 0;
    let chosenDistance = normalDistance;
    const normalCollapsed = normalDistance < OBSTRUCTION_MIN_DISTANCE;
    const thirdPersonOnly = state.aimBlend <= 0.001 && !firstPersonAim;
    const retainingFallback = state.obstructionChoice !== 0 && state.obstructionHold > 0;
    if (thirdPersonOnly && (normalCollapsed || retainingFallback)) {
      const sideOffset = THREE.MathUtils.clamp((state.distance + speedPullback) * 0.24, 1.45, 2.15);
      rearLeftDesired.copy(thirdPersonPosition).addScaledVector(right, -sideOffset).addScaledVector(up, 0.18);
      rearRightDesired.copy(thirdPersonPosition).addScaledVector(right, sideOffset).addScaledVector(up, 0.18);
      clipInto(smoothAnchor, rearLeftDesired, rearLeftClipped);
      clipInto(smoothAnchor, rearRightDesired, rearRightClipped);
      const leftDistance = rearLeftClipped.distanceTo(smoothAnchor);
      const rightDistance = rearRightClipped.distanceTo(smoothAnchor);
      const leftClearance = leftDistance / Math.max(0.001, rearLeftDesired.distanceTo(smoothAnchor));
      const rightClearance = rightDistance / Math.max(0.001, rearRightDesired.distanceTo(smoothAnchor));
      const highSide = state.obstructionChoice === -1 ? -1 : state.obstructionChoice === 1 ? 1 : rightDistance >= leftDistance ? 1 : -1;
      highQuarterDesired.copy(thirdPersonPosition).addScaledVector(up, 2.05).addScaledVector(right, highSide * 0.85);
      clipInto(smoothAnchor, highQuarterDesired, highQuarterClipped);
      const highDistance = highQuarterClipped.distanceTo(smoothAnchor);
      const highClearance = highDistance / Math.max(0.001, highQuarterDesired.distanceTo(smoothAnchor));

      let bestChoice = 0;
      let bestDistance = normalDistance;
      let bestClearance = normalDistance / Math.max(0.001, thirdPersonPosition.distanceTo(smoothAnchor));
      if (leftDistance >= OBSTRUCTION_MIN_DISTANCE && leftClearance > bestClearance + 0.015) {
        bestChoice = -1;
        bestDistance = leftDistance;
        bestClearance = leftClearance;
      }
      if (rightDistance >= OBSTRUCTION_MIN_DISTANCE && rightClearance > bestClearance + 0.015) {
        bestChoice = 1;
        bestDistance = rightDistance;
        bestClearance = rightClearance;
      }
      if (highDistance >= OBSTRUCTION_MIN_DISTANCE && highClearance > bestClearance + 0.015) {
        bestChoice = 2;
        bestDistance = highDistance;
        bestClearance = highClearance;
      }
      const heldDistance = state.obstructionChoice === -1 ? leftDistance : state.obstructionChoice === 1 ? rightDistance :
        state.obstructionChoice === 2 ? highDistance : normalDistance;
      const heldClearance = state.obstructionChoice === -1 ? leftClearance : state.obstructionChoice === 1 ? rightClearance :
        state.obstructionChoice === 2 ? highClearance : bestClearance;
      if (retainingFallback && heldDistance >= OBSTRUCTION_MIN_DISTANCE &&
          (!normalCollapsed || heldClearance + OBSTRUCTION_SWITCH_MARGIN >= bestClearance)) {
        bestChoice = state.obstructionChoice;
        bestDistance = heldDistance;
      }
      if (bestChoice !== 0) {
        chosenObstruction = bestChoice;
        chosenDistance = bestDistance;
        chasedPosition = bestChoice === -1 ? rearLeftClipped : bestChoice === 1 ? rearRightClipped : highQuarterClipped;
        if (normalCollapsed) state.obstructionHold = OBSTRUCTION_HOLD_SECONDS;
      } else {
        state.obstructionHold = 0;
      }
    } else if (!thirdPersonOnly) {
      state.obstructionHold = 0;
    }
    state.obstructionChoice = chosenObstruction;
    state.obstructionDistance = chosenDistance;
    // Aim from Kai's eye line, slightly ahead of the face.  The tiny right-eye
    // offset aligns the pistol sights without turning this into an orbiting
    // shoulder camera.  Blending avoids a one-frame teleport when RMB changes.
    firstPersonPosition.copy(smoothAnchor)
      .addScaledVector(up, 0.2)
      .addScaledVector(forward, 0.24)
      .addScaledVector(right, 0.035);
    desired.copy(chasedPosition).lerp(firstPersonPosition, state.aimBlend);
    camera.position.lerp(desired, 1 - Math.exp(-dt * (driving ? 9 : firstPersonAim ? 22 : 14)));
    state.shakeTime = Math.max(0, state.shakeTime - dt);
    if (state.shakeTime > 0 && state.shake > 0.001) {
      const decay = Math.min(1, state.shakeTime * 5);
      camera.position.x += Math.sin(state.shakeTime * 83 + 0.7) * state.shake * decay;
      camera.position.y += Math.sin(state.shakeTime * 97 + 2.1) * state.shake * 0.65 * decay;
      camera.position.z += Math.sin(state.shakeTime * 71 + 4.2) * state.shake * 0.45 * decay;
      state.shake *= Math.exp(-dt * 6.5);
    }
    if (state.aimBlend > 0.001) aimPoint.copy(camera.position).addScaledVector(forward, 60);
    else aimPoint.copy(smoothAnchor).addScaledVector(forward, 35);
    const desiredRoll = driving
      ? THREE.MathUtils.clamp(-(Number(steering) || 0) * Math.min(0.052, Math.abs(Number(speed) || 0) * 0.0022) -
        (Number(lateralSpeed) || 0) * 0.0025, -0.075, 0.075)
      : 0;
    state.roll += (desiredRoll - state.roll) * (1 - Math.exp(-dt * (driving ? 5.5 : 14)));
    // Compose a pan/tilt rig directly: yaw is always around world Y and pitch
    // is always around the camera's local X. Mutating Euler Z after lookAt()
    // changed its quaternion at oblique yaw angles and caused the inverted,
    // under-the-character view. YXZ preserves world-up; vehicle lean is an
    // explicit local-Z layer and can never leak into on-foot camera state.
    cameraEuler.set(-state.pitch, state.yaw, 0, "YXZ");
    baseQuaternion.setFromEuler(cameraEuler);
    camera.quaternion.copy(baseQuaternion);
    if (driving && Math.abs(state.roll) > 1e-7) {
      rollQuaternion.setFromAxisAngle(localRollAxis, state.roll);
      camera.quaternion.multiply(rollQuaternion);
    }
    camera.up.set(0, 1, 0);
    const targetFov = firstPersonAim ? 47 : driving ? 60 + Math.min(13, Math.abs(Number(speed) || 0) * 0.42) : 58;
    state.fov += (targetFov - state.fov) * (1 - Math.exp(-dt * 4.5));
    if (Math.abs(camera.fov - state.fov) > 0.01) {
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    return snapshot();
  }

  function snapBehind(yaw) {
    state.yaw = Number(yaw) || 0;
    state.targetYaw = state.yaw;
    state.obstructionChoice = 0;
    state.obstructionHold = 0;
    updateVectors();
  }

  function shake(amount = 0.1, duration = 0.22) {
    state.shake = Math.max(state.shake, THREE.MathUtils.clamp(Number(amount) || 0, 0, 0.55));
    state.shakeTime = Math.max(state.shakeTime, THREE.MathUtils.clamp(Number(duration) || 0, 0, 1.2));
  }

  function aimRay(origin = new THREE.Vector3(), direction = new THREE.Vector3()) {
    origin.copy(camera.position);
    direction.copy(aimPoint).sub(camera.position).normalize();
    return { origin, direction };
  }

  function snapshot() {
    return Object.freeze({
      yaw: state.yaw,
      targetYaw: state.targetYaw,
      pitch: state.pitch,
      targetPitch: state.targetPitch,
      distance: state.distance,
      mode: state.mode,
      fov: state.fov,
      aimBlend: state.aimBlend,
      perspective: state.aimBlend > 0.92 ? "first-person-aim" : "third-person",
      roll: state.roll,
      shake: state.shake,
      obstructionFallback: state.obstructionChoice === -1 ? "rear-left" : state.obstructionChoice === 1 ? "rear-right" :
        state.obstructionChoice === 2 ? "high-quarter" : "normal",
      obstructionDistance: state.obstructionDistance,
      obstructionHold: state.obstructionHold,
    });
  }

  updateVectors();
  return { state, forward, flatForward, right, update, snapBehind, shake, aimRay, snapshot };
}
