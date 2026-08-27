export const FLY_SPEED = 5.2;
export const FLY_BOOST_SPEED = 15;
export const FLY_BOUNDS = Object.freeze({
  minX: -180,
  maxX: 180,
  minY: -1.5,
  maxY: 100,
  minZ: -120,
  maxZ: 280,
});

export function normalizedControlKey(event) {
  const code = String(event?.code || "");
  if (code === "KeyW") return "w";
  if (code === "KeyA") return "a";
  if (code === "KeyS") return "s";
  if (code === "KeyD") return "d";
  if (code === "Space") return "space";
  if (code === "ControlLeft" || code === "ControlRight") return "control";
  if (code === "ShiftLeft" || code === "ShiftRight") return "shift";
  return String(event?.key || "").toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Advance a free-fly pose. W/S follow view pitch; Space/Ctrl remain world-up/down. */
export function advanceFly(state, keys, dt, bounds = FLY_BOUNDS) {
  const step = Number(dt);
  if (!Number.isFinite(step) || step <= 0) return { x: state.x, y: state.y, z: state.z };
  const has = key => typeof keys?.has === "function" && keys.has(key);
  const forward = (has("w") ? 1 : 0) - (has("s") ? 1 : 0);
  const strafe = (has("d") ? 1 : 0) - (has("a") ? 1 : 0);
  const lift = (has("space") ? 1 : 0) - (has("control") ? 1 : 0);
  if (!forward && !strafe && !lift) return { x: state.x, y: state.y, z: state.z };

  const yaw = Number(state.yaw) || 0;
  const pitch = Number(state.pitch) || 0;
  const cp = Math.cos(pitch);
  // Three's camera looks down local -Z, so view-right is forward × world-up.
  let x = Math.sin(yaw) * cp * forward - Math.cos(yaw) * strafe;
  let y = Math.sin(pitch) * forward + lift;
  let z = Math.cos(yaw) * cp * forward + Math.sin(yaw) * strafe;
  const length = Math.hypot(x, y, z) || 1;
  const distance = (has("shift") ? FLY_BOOST_SPEED : FLY_SPEED) * step;
  x = x / length * distance;
  y = y / length * distance;
  z = z / length * distance;
  return {
    x: clamp(state.x + x, bounds.minX, bounds.maxX),
    y: clamp(state.y + y, bounds.minY, bounds.maxY),
    z: clamp(state.z + z, bounds.minZ, bounds.maxZ),
  };
}
