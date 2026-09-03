export const EYE_HEIGHT = 1.64;
export const WALK_SPEED = 3.25;
export const SPRINT_SPEED = 5.7;
export const LOOK_SENSITIVITY = 0.00215;
export const MAX_WADE_DEPTH = 0.92;
export const JUMP_SPEED = 5.25;
export const GRAVITY = 14.8;

export function createViewState(x = 0, z = -18, yaw = Math.PI, pitch = -0.06) {
  return {
    x, y: 0, z, yaw, pitch,
    grounded: true,
    wading: false,
    speed: 0,
    verticalVelocity: 0,
    landingImpact: 0,
  };
}

export function applyLook(state, dx, dy, sensitivity = LOOK_SENSITIVITY) {
  state.yaw -= dx * sensitivity;
  state.pitch = Math.max(-1.38, Math.min(1.22, state.pitch - dy * sensitivity));
  return state;
}

export function planarDelta(yaw, strafe, forward) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: strafe * cos - forward * sin,
    z: -strafe * sin - forward * cos,
  };
}

export function wadeFactor(waterDepth) {
  if (waterDepth <= 0.02) return 1;
  if (waterDepth >= MAX_WADE_DEPTH) return 0;
  return Math.max(0.28, 1 - waterDepth * 0.72);
}

export function stepFirstPerson(state, input, heightAt, waterLevel, dt, collisionWorld = null) {
  const delta = Math.max(0, Math.min(0.05, Number(dt) || 0));
  state.landingImpact = 0;
  applyLook(state, input.lookX || 0, input.lookY || 0, input.sensitivity);
  const forward = (input.forward || 0) - (input.back || 0);
  const strafe = (input.right || 0) - (input.left || 0);
  const length = Math.hypot(forward, strafe);
  const nx = length > 1e-5 ? forward / length : 0;
  const nz = length > 1e-5 ? strafe / length : 0;
  const wish = planarDelta(state.yaw, nz, nx);
  const ground = heightAt(state.x, state.z);
  const waterDepth = Math.max(0, waterLevel - ground);
  state.wading = waterDepth > 0.04;
  const blocked = waterDepth >= MAX_WADE_DEPTH;
  const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * wadeFactor(waterDepth);
  state.speed = length > 0 && !blocked ? speed : 0;
  if (!blocked && length > 0) {
    const nextX = state.x + wish.x * speed * delta;
    const nextZ = state.z + wish.z * speed * delta;
    const nextGround = heightAt(nextX, nextZ);
    const nextDepth = Math.max(0, waterLevel - nextGround);
    if (nextDepth < MAX_WADE_DEPTH) {
      const resolved = collisionWorld?.resolveMovement
        ? collisionWorld.resolveMovement(
          state.x,
          state.z,
          nextX,
          nextZ,
          state.y - EYE_HEIGHT,
        )
        : { x: nextX, z: nextZ };
      state.x = resolved.x;
      state.z = resolved.z;
    }
  }
  const floorY = heightAt(state.x, state.z) + EYE_HEIGHT;
  if (state.grounded) {
    state.y = floorY;
    state.verticalVelocity = 0;
    if (input.jump && !state.wading) {
      state.grounded = false;
      state.verticalVelocity = JUMP_SPEED;
    }
  }
  if (!state.grounded) {
    state.verticalVelocity -= GRAVITY * delta;
    state.y += state.verticalVelocity * delta;
    if (state.y <= floorY && state.verticalVelocity <= 0) {
      state.landingImpact = Math.max(0, -state.verticalVelocity);
      state.y = floorY;
      state.verticalVelocity = 0;
      state.grounded = true;
    }
  }
  return state;
}

export function cameraOrientation(state) {
  return {
    yaw: state.yaw,
    pitch: state.pitch,
    position: { x: state.x, y: state.y, z: state.z },
  };
}
