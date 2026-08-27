/** Shared helpers for a later ambient walker. Metres, seconds. No Math.random. */

/** Horizontal speed below 1/limit m/s counts as stuck. Default 0.1 m/s. */
export const STUCK_LIMIT = 10;

/** Six walkers are cheap; keep them moving throughout the full visible fog range. */
export const UPDATE_DISTANCE = 190;

export function seededRng(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function xz(point) {
  if (Array.isArray(point) || ArrayBuffer.isView(point)) {
    const x = Number(point[0]);
    const z = Number(point.length >= 3 ? point[2] : point[1]);
    return [x, z];
  }
  return [Number(point?.x), Number(point?.z)];
}

export function isStuck(prev, cur, dt, limit = STUCK_LIMIT) {
  const t = Number(dt);
  const cap = Number(limit);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(cap) || cap <= 0) return false;
  const [px, pz] = xz(prev);
  const [cx, cz] = xz(cur);
  if (![px, pz, cx, cz].every(Number.isFinite)) return true;
  return Math.hypot(cx - px, cz - pz) * cap < t;
}

export function shouldUpdate(distanceToCamera) {
  const d = Number(distanceToCamera);
  return Number.isFinite(d) && d >= 0 && d < UPDATE_DISTANCE;
}
