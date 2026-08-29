export const ORBIT_STEP_DEGREES = 45;

export const ORBIT_VIEWS = Object.freeze([
  { yaw: 0, file: "yaw-000.png", label: "front" },
  { yaw: 45, file: "yaw-045.png", label: "front-right" },
  { yaw: 90, file: "yaw-090.png", label: "right" },
  { yaw: 135, file: "yaw-135.png", label: "back-right" },
  { yaw: 180, file: "yaw-180.png", label: "back" },
  { yaw: 225, file: "yaw-225.png", label: "back-left" },
  { yaw: 270, file: "yaw-270.png", label: "left" },
  { yaw: 315, file: "yaw-315.png", label: "front-left" },
]);

export const CANDIDATE_VIEW_COUNTS = Object.freeze([2, 4, 8]);

export function cameraBasis(yawDegrees) {
  const yaw = (Number(yawDegrees) || 0) * Math.PI / 180;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    yaw,
    yawDegrees: Number(yawDegrees) || 0,
    position: [sin, 0, cos],
    right: [cos, 0, -sin],
    up: [0, 1, 0],
    forward: [-sin, 0, -cos],
  };
}

export function projectWorld(x, y, z, basis) {
  return {
    x: x * basis.right[0] + z * basis.right[2],
    y,
    depth: x * -basis.forward[0] + z * -basis.forward[2],
  };
}

export function unprojectView(camX, y, depth, basis) {
  return {
    x: camX * basis.right[0] + depth * -basis.forward[0],
    y,
    z: camX * basis.right[2] + depth * -basis.forward[2],
  };
}

export function equallySpacedSubset(views, count) {
  const sorted = [...views].sort((a, b) => a.yaw - b.yaw);
  if (count >= sorted.length) return sorted;
  const step = sorted.length / count;
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(sorted[Math.round(i * step) % sorted.length]);
  }
  const unique = [];
  for (const view of picked) {
    if (!unique.some(existing => existing.yaw === view.yaw)) unique.push(view);
  }
  return unique;
}

function viewNearYaw(views, yaw) {
  let best = views[0];
  let bestDelta = Infinity;
  for (const view of views) {
    const delta = Math.abs((view.yaw ?? 0) - yaw);
    if (delta < bestDelta) {
      best = view;
      bestDelta = delta;
    }
  }
  return best;
}

/** Cylinders/capsules only need two orthogonal stills (0° and 90°). */
export function pickViewsForShape(views, shape) {
  const kind = shape?.kind ?? "custom";
  if (kind === "cylinder" || kind === "capsule") {
    const front = viewNearYaw(views, 0);
    const side = viewNearYaw(views, 90);
    if (front && side && front !== side) return [front, side];
  }
  if (kind === "humanoid") return equallySpacedSubset(views, Math.min(8, views.length));
  return equallySpacedSubset(views, shape?.recommendedCount ?? views.length);
}
