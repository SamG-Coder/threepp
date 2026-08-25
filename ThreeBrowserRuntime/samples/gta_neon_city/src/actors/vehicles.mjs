import * as THREE from "three/webgpu";

const FIXED_VEHICLE_STEP = 1 / 120;
const MAX_FRAME_DELTA = 0.25;
const MAX_VEHICLES = 24;
const EPSILON = 1e-7;
const TRAFFIC_SIGNAL_CYCLE = 20;
const ROADSIDE_SERVICE_ROLE = "pulse-roadside";
const ROADSIDE_HOLD = "hold";
const ROADSIDE_DISPATCH = "dispatch";
const ROADSIDE_REPAIR = "repair";
const ROADSIDE_CLEAR = "clear";
const ROADSIDE_CANCEL = "cancel";

export const DEFAULT_VEHICLE_PHYSICS = Object.freeze({
  radius: 1.15,
  wheelBase: 2.65,
  maxSpeed: 25,
  maxReverseSpeed: 8.5,
  acceleration: 10.5,
  reverseAcceleration: 6.4,
  brakeDeceleration: 19,
  rollingResistance: 1.25,
  aerodynamicDrag: 0.012,
  maximumSteerAngle: 0.56,
  steeringFalloff: 0.034,
  steeringResponse: 10,
  maximumYawRate: 2.25,
  lateralGrip: 10.5,
  handbrakeGrip: 1.15,
  handbrakeDrag: 2.4,
  handbrakeYaw: 1.15,
  corneringLimit: 11.5,
  bodyResponse: 7.5,
  bodyPitchScale: 0.007,
  bodyRollScale: 0.0055,
  collisionBounce: 0.08,
});

const VEHICLE_STYLES = Object.freeze({
  sedan: Object.freeze({
    width: 1.82, length: 4.42, height: 1.37, wheelBase: 2.68,
    wheelRadius: 0.36, radius: 1.18, maxSpeed: 24, acceleration: 9.8,
    color: 0x28526d, roughness: 0.24, health: 115,
  }),
  sports: Object.freeze({
    width: 1.94, length: 4.30, height: 1.10, wheelBase: 2.62,
    wheelRadius: 0.38, radius: 1.16, maxSpeed: 33, acceleration: 14.2,
    color: 0xcf2438, roughness: 0.16, health: 100,
  }),
  taxi: Object.freeze({
    width: 1.84, length: 4.48, height: 1.42, wheelBase: 2.72,
    wheelRadius: 0.36, radius: 1.20, maxSpeed: 23, acceleration: 9.4,
    color: 0xf0b51d, roughness: 0.25, health: 120,
  }),
  police: Object.freeze({
    width: 1.89, length: 4.62, height: 1.42, wheelBase: 2.78,
    wheelRadius: 0.37, radius: 1.23, maxSpeed: 31, acceleration: 13.2,
    color: 0x111923, roughness: 0.21, health: 150,
  }),
  van: Object.freeze({
    width: 2.02, length: 4.88, height: 2.06, wheelBase: 2.92,
    wheelRadius: 0.39, radius: 1.32, maxSpeed: 20, acceleration: 7.8,
    color: 0x56616c, roughness: 0.34, health: 175,
  }),
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function wrapAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function damp(current, target, response, delta) {
  return target + (current - target) * Math.exp(-Math.max(0, response) * delta);
}

function physicsValue(state, key) {
  const value = state?.[key] ?? state?.config?.[key];
  return Number.isFinite(Number(value)) ? Number(value) : DEFAULT_VEHICLE_PHYSICS[key];
}

function controlsFrom(input = {}) {
  const steer = input.steer ?? input.steering ??
    finite(input.right || 0) - finite(input.left || 0);
  return {
    throttle: clamp01(input.throttle ?? input.accelerate ?? input.forward ?? 0),
    reverse: clamp01(input.reverse ?? input.backward ?? 0),
    brake: clamp01(input.brake ?? 0),
    steer: clamp(steer, -1, 1),
    handbrake: Boolean(input.handbrake),
  };
}

function boundsOf(environment) {
  const bounds = environment?.bounds ?? environment?.worldBounds ?? null;
  if (!bounds) return null;
  const minimum = bounds.min ?? bounds.minimum;
  const maximum = bounds.max ?? bounds.maximum;
  const minX = finite(bounds.minX ?? minimum?.x ?? minimum?.[0], -Infinity);
  const maxX = finite(bounds.maxX ?? maximum?.x ?? maximum?.[0], Infinity);
  const minZ = finite(bounds.minZ ?? minimum?.z ?? minimum?.[2] ?? minimum?.[1], -Infinity);
  const maxZ = finite(bounds.maxZ ?? maximum?.z ?? maximum?.[2] ?? maximum?.[1], Infinity);
  return { minX, maxX, minZ, maxZ };
}

function blockedCircle(environment, x, z, radius) {
  const callback = environment?.isBlockedCircle;
  if (typeof callback !== "function") return false;
  try {
    // The city contract is positional. Always include radius even though a
    // defaulted third parameter makes Function.length report only two.
    return Boolean(callback.call(environment, x, z, radius));
  } catch {
    try { return Boolean(callback.call(environment, { x, z, radius })); }
    catch { return false; }
  }
}

function resultPosition(value, currentX, currentZ) {
  if (!value) return null;
  const source = value.position ?? value.end ?? value.to ?? value;
  if (Array.isArray(source)) {
    return {
      x: finite(source[0], currentX),
      z: finite(source.length >= 3 ? source[2] : source[1], currentZ),
    };
  }
  if (source && (Number.isFinite(Number(source.x)) || Number.isFinite(Number(source.z)))) {
    return { x: finite(source.x, currentX), z: finite(source.z, currentZ) };
  }
  const displacement = value.displacement ?? value.motion;
  if (displacement) {
    return {
      x: currentX + finite(displacement.x ?? displacement[0]),
      z: currentZ + finite(displacement.z ?? displacement[2] ?? displacement[1]),
    };
  }
  return null;
}

function resolveMotion(environment, x, z, dx, dz, radius, state) {
  const desiredX = x + dx;
  const desiredZ = z + dz;
  let nextX = desiredX;
  let nextZ = desiredZ;
  let blocked = false;
  let normal = null;
  let resolvedByHost = false;
  const resolver = environment?.resolveCircleMotion;

  if (typeof resolver === "function") {
    const request = {
      x, z, dx, dz, radius,
      from: { x, z },
      to: { x: desiredX, z: desiredZ },
      position: { x, z },
      displacement: { x: dx, z: dz },
      state: { ...state },
    };
    try {
      let result;
      if (resolver.length >= 4) result = resolver.call(environment, x, z, dx, dz, radius, request);
      else if (resolver.length >= 2) result = resolver.call(environment, request.position, request.displacement, radius, request);
      else result = resolver.call(environment, request);
      const resolved = resultPosition(result, x, z);
      if (resolved) {
        resolvedByHost = true;
        nextX = resolved.x;
        nextZ = resolved.z;
        blocked = Boolean(result?.blocked ?? result?.collided) ||
          Math.abs(nextX - desiredX) > 1e-5 || Math.abs(nextZ - desiredZ) > 1e-5;
        normal = result?.normal ?? result?.collisionNormal ?? null;
      }
    } catch {
      // A host can omit or temporarily replace the optional resolver. The
      // metadata collision path below remains deterministic and safe.
    }
  }
  if (!resolvedByHost && blockedCircle(environment, desiredX, desiredZ, radius)) {
    blocked = true;
    let moved = false;
    if (Math.abs(dx) > EPSILON && !blockedCircle(environment, desiredX, z, radius)) {
      nextX = desiredX;
      nextZ = z;
      moved = true;
    }
    if (Math.abs(dz) > EPSILON && !blockedCircle(environment, moved ? nextX : x, desiredZ, radius)) {
      nextX = moved ? nextX : x;
      nextZ = desiredZ;
      moved = true;
    }
    if (!moved) {
      nextX = x;
      nextZ = z;
    }
  }

  const bounds = boundsOf(environment);
  if (bounds) {
    const clampedX = clamp(nextX, bounds.minX + radius, bounds.maxX - radius);
    const clampedZ = clamp(nextZ, bounds.minZ + radius, bounds.maxZ - radius);
    blocked ||= Math.abs(clampedX - nextX) > EPSILON || Math.abs(clampedZ - nextZ) > EPSILON;
    nextX = clampedX;
    nextZ = clampedZ;
  }
  return { x: nextX, z: nextZ, blocked, normal };
}

function surfaceGripAt(environment, state, x, z) {
  const source = state?.surfaceGripOverride ?? environment?.surfaceGrip;
  if (typeof source === "function") {
    try {
      return clamp(source.call(environment, x, z, state), 0.28, 1.15);
    } catch {
      try { return clamp(source.call(environment, { x, z, state }), 0.28, 1.15); }
      catch { /* Optional terrain metadata can disappear during world reloads. */ }
    }
  } else if (Number.isFinite(Number(source))) {
    return clamp(source, 0.28, 1.15);
  }
  if (typeof environment?.isRoad === "function") {
    try { return environment.isRoad(x, z) ? 1 : 0.56; }
    catch { /* Default asphalt grip is the safe deterministic fallback. */ }
  }
  return 1;
}

/**
 * Deterministic, renderer-free arcade car dynamics. The input state is never
 * mutated. `environment` may provide bounds, `isBlockedCircle`, or
 * `resolveCircleMotion`; all are optional so Node tests can use plain objects.
 */
export function stepVehiclePhysics(state = {}, input = {}, delta = 0, environment = null) {
  const duration = clamp(delta, 0, MAX_FRAME_DELTA);
  const controls = controlsFrom(input);
  const next = {
    ...state,
    x: finite(state.x),
    z: finite(state.z),
    yaw: wrapAngle(finite(state.yaw)),
    speed: finite(state.speed),
    steering: clamp(state.steering, -1, 1),
    lateralSpeed: finite(state.lateralSpeed),
    longitudinalAcceleration: finite(state.longitudinalAcceleration),
    yawRate: finite(state.yawRate),
    bodyPitch: clamp(state.bodyPitch, -0.16, 0.16),
    bodyRoll: clamp(state.bodyRoll, -0.18, 0.18),
    suspensionJolt: clamp(state.suspensionJolt, 0, 0.22),
    surfaceGrip: clamp(state.surfaceGrip ?? 1, 0.28, 1.15),
    brakeLights: Boolean(state.brakeLights),
    reverseLights: Boolean(state.reverseLights),
    collided: false,
    impactSpeed: 0,
    collisionCount: Math.max(0, Math.trunc(finite(state.collisionCount))),
  };
  if (duration <= 0) return next;

  const steps = Math.max(1, Math.ceil(duration / FIXED_VEHICLE_STEP));
  const dt = duration / steps;
  const maxSpeed = Math.max(1, physicsValue(state, "maxSpeed"));
  const maxReverse = Math.max(0.5, physicsValue(state, "maxReverseSpeed"));
  const radius = Math.max(0.1, physicsValue(state, "radius"));

  for (let step = 0; step < steps; ++step) {
    const speedBeforeForces = next.speed;
    const sampledGrip = surfaceGripAt(environment, state, next.x, next.z);
    next.surfaceGrip = damp(next.surfaceGrip, sampledGrip, 9, dt);
    const traction = clamp(next.surfaceGrip, 0.28, 1.15);
    next.steering = damp(
      next.steering,
      controls.steer,
      physicsValue(state, "steeringResponse"),
      dt,
    );

    let longitudinalAcceleration = 0;
    if (controls.throttle > 0) {
      if (next.speed < -0.25) {
        longitudinalAcceleration += physicsValue(state, "brakeDeceleration") * controls.throttle;
      } else {
        const falloff = 1 - Math.min(0.88, Math.max(0, next.speed) / maxSpeed * 0.88);
        longitudinalAcceleration += physicsValue(state, "acceleration") * controls.throttle * falloff *
          (0.42 + traction * 0.58);
      }
    }
    if (controls.reverse > 0) {
      if (next.speed > 0.25) {
        longitudinalAcceleration -= physicsValue(state, "brakeDeceleration") * controls.reverse;
      } else {
        const falloff = 1 - Math.min(0.82, Math.max(0, -next.speed) / maxReverse * 0.82);
        longitudinalAcceleration -= physicsValue(state, "reverseAcceleration") * controls.reverse * falloff *
          (0.42 + traction * 0.58);
      }
    }
    if (controls.brake > 0 && Math.abs(next.speed) > 0.015) {
      longitudinalAcceleration -= Math.sign(next.speed) *
        physicsValue(state, "brakeDeceleration") * controls.brake * (0.56 + traction * 0.44);
    }

    const activelyDriven = controls.throttle > 0 || controls.reverse > 0 || controls.brake > 0;
    if (!activelyDriven && Math.abs(next.speed) > 0.001) {
      const resistance = physicsValue(state, "rollingResistance") +
        physicsValue(state, "aerodynamicDrag") * next.speed * next.speed +
        Math.max(0, 1 - traction) * 3.2;
      const change = Math.min(Math.abs(next.speed), resistance * dt);
      next.speed -= Math.sign(next.speed) * change;
    }
    next.speed += longitudinalAcceleration * dt;
    if (controls.brake > 0 && speedBeforeForces * next.speed < 0) next.speed = 0;
    if (controls.handbrake) {
      const handbrakeChange = Math.min(Math.abs(next.speed), physicsValue(state, "handbrakeDrag") * dt);
      next.speed -= Math.sign(next.speed) * handbrakeChange;
    }
    const surfaceSpeed = maxSpeed * (0.62 + Math.min(1, traction) * 0.38);
    next.speed = clamp(next.speed, -maxReverse, surfaceSpeed);
    if (Math.abs(next.speed) < 0.012 && !activelyDriven) next.speed = 0;

    const speedMagnitude = Math.abs(next.speed);
    const steerAngle = next.steering * physicsValue(state, "maximumSteerAngle") /
      (1 + speedMagnitude * physicsValue(state, "steeringFalloff") / Math.max(0.45, traction));
    let yawRate = speedMagnitude > 0.035
      ? -(next.speed / Math.max(0.5, physicsValue(state, "wheelBase"))) * Math.tan(steerAngle)
      : 0;
    if (controls.handbrake && speedMagnitude > 2) {
      yawRate -= next.steering * Math.sign(next.speed || 1) *
        physicsValue(state, "handbrakeYaw") * Math.min(1, speedMagnitude / 12);
      next.lateralSpeed -= next.steering * speedMagnitude * 1.55 * dt;
    }
    yawRate = clamp(yawRate, -physicsValue(state, "maximumYawRate"), physicsValue(state, "maximumYawRate"));
    next.yaw = wrapAngle(next.yaw + yawRate * dt);

    const lateralDemand = yawRate * next.speed;
    const excessCornering = Math.max(0, Math.abs(lateralDemand) - physicsValue(state, "corneringLimit") * traction);
    if (excessCornering > 0 && !controls.handbrake) {
      next.lateralSpeed -= Math.sign(lateralDemand) * excessCornering * dt * 0.42;
    }

    const grip = controls.handbrake
      ? physicsValue(state, "handbrakeGrip")
      : physicsValue(state, "lateralGrip") * traction;
    next.lateralSpeed *= Math.exp(-Math.max(0, grip) * dt);
    if (!controls.handbrake && Math.abs(next.lateralSpeed) < 0.008) next.lateralSpeed = 0;

    const measuredAcceleration = (next.speed - speedBeforeForces) / dt;
    next.longitudinalAcceleration = damp(next.longitudinalAcceleration, measuredAcceleration, 12, dt);
    next.yawRate = damp(next.yawRate, yawRate, 14, dt);
    const pitchTarget = clamp(
      next.longitudinalAcceleration * physicsValue(state, "bodyPitchScale"),
      -0.105,
      0.105,
    );
    const rollTarget = clamp(
      next.yawRate * next.speed * physicsValue(state, "bodyRollScale"),
      -0.135,
      0.135,
    );
    next.bodyPitch = damp(next.bodyPitch, pitchTarget, physicsValue(state, "bodyResponse"), dt);
    next.bodyRoll = damp(next.bodyRoll, rollTarget, physicsValue(state, "bodyResponse"), dt);
    next.suspensionJolt = damp(next.suspensionJolt, 0, 8.5, dt);
    next.brakeLights = controls.brake > 0.04 ||
      controls.reverse > 0.04 && speedBeforeForces > 0.2 ||
      controls.throttle > 0.04 && speedBeforeForces < -0.2;
    next.reverseLights = next.speed < -0.18;

    const forwardX = -Math.sin(next.yaw);
    const forwardZ = -Math.cos(next.yaw);
    const rightX = Math.cos(next.yaw);
    const rightZ = -Math.sin(next.yaw);
    const dx = (forwardX * next.speed + rightX * next.lateralSpeed) * dt;
    const dz = (forwardZ * next.speed + rightZ * next.lateralSpeed) * dt;
    const impactBeforeResolution = Math.hypot(next.speed, next.lateralSpeed);
    const resolved = resolveMotion(environment, next.x, next.z, dx, dz, radius, next);
    next.x = resolved.x;
    next.z = resolved.z;
    if (resolved.blocked) {
      next.collided = true;
      next.impactSpeed = Math.max(next.impactSpeed, impactBeforeResolution);
      next.collisionCount += 1;
      next.speed *= -Math.max(0, physicsValue(state, "collisionBounce"));
      next.lateralSpeed *= 0.18;
      next.bodyPitch = clamp(next.bodyPitch - Math.min(0.12, impactBeforeResolution * 0.004), -0.16, 0.16);
      next.suspensionJolt = Math.min(0.22, next.suspensionJolt + impactBeforeResolution * 0.006);
    }
  }
  return next;
}

function pointXZ(value, fallbackX = 0, fallbackZ = 0) {
  if (Array.isArray(value)) {
    return {
      x: finite(value[0], fallbackX),
      z: finite(value.length >= 3 ? value[2] : value[1], fallbackZ),
    };
  }
  if (value?.position) return pointXZ(value.position, fallbackX, fallbackZ);
  return { x: finite(value?.x, fallbackX), z: finite(value?.z, fallbackZ) };
}

function groundHeight(world, x, z) {
  const sample = world?.sampleGround?.(x, z) ??
    world?.groundHeight?.(x, z) ?? world?.terrainHeight?.(x, z) ?? 0;
  return finite(sample?.height ?? sample?.y ?? sample, 0);
}

function actionDown(input, action) {
  if (!input) return false;
  if (typeof input.actionDown === "function") return Boolean(input.actionDown(action));
  if (typeof input.isDown === "function") return Boolean(input.isDown(action));
  if (input.actions instanceof Set) return input.actions.has(action);
  return Boolean(input.actions?.[action] ?? input[action]);
}

function makeDefaultRoutes(world) {
  const bounds = boundsOf(world) ?? { minX: -64, maxX: 64, minZ: -64, maxZ: 64 };
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const halfX = Math.max(10, Math.min(48, (bounds.maxX - bounds.minX) * 0.5 - 7));
  const halfZ = Math.max(10, Math.min(48, (bounds.maxZ - bounds.minZ) * 0.5 - 7));
  const innerX = Math.max(7, halfX * 0.46);
  const innerZ = Math.max(7, halfZ * 0.46);
  const rectangle = (hx, hz, reverse = false, inset = 0) => {
    const points = [
      { x: centerX - hx + inset, z: centerZ - hz + inset },
      { x: centerX - hx + inset, z: centerZ + hz - inset },
      { x: centerX + hx - inset, z: centerZ + hz - inset },
      { x: centerX + hx - inset, z: centerZ - hz + inset },
    ];
    return reverse ? points.reverse() : points;
  };
  return [
    rectangle(halfX, halfZ, false, 0),
    rectangle(halfX, halfZ, true, 3.4),
    rectangle(innerX, innerZ, false, 0),
    rectangle(innerX, innerZ, true, 3.2),
  ];
}

function normalizeRoutes(source, world) {
  const routes = [];
  function addRoute(candidate) {
    const raw = candidate?.points ?? candidate?.waypoints ?? candidate?.path ?? candidate;
    if (!Array.isArray(raw)) return;
    const points = raw.map(point => pointXZ(point)).filter(point => Number.isFinite(point.x) && Number.isFinite(point.z));
    if (points.length >= 2) {
      points.id = candidate?.id ?? `route-${routes.length + 1}`;
      points.roadId = candidate?.roadId ?? null;
      points.axis = candidate?.axis === "x" || candidate?.axis === "z" ? candidate.axis : null;
      points.direction = Math.sign(finite(candidate?.direction));
      points.speedLimit = finite(candidate?.speedLimit, 0);
      routes.push(points);
    }
  }
  if (Array.isArray(source)) {
    const looksLikeOneRoute = source.length >= 2 && source.every(entry =>
      Array.isArray(entry) && entry.every(component => typeof component === "number") ||
      entry && typeof entry === "object" && !Array.isArray(entry) &&
        (Number.isFinite(Number(entry.x)) || Array.isArray(entry.position)),
    );
    if (looksLikeOneRoute) addRoute(source);
    else for (const route of source) addRoute(route);
  } else if (source && typeof source === "object") {
    for (const route of Object.values(source)) addRoute(route);
  }
  return routes.length > 0 ? routes : makeDefaultRoutes(world);
}

function normalizedRouteAxis(route) {
  if (route?.axis === "x" || route?.axis === "z") return route.axis;
  if (!route || route.length < 2) return null;
  const first = route[0];
  const last = route[route.length - 1];
  return Math.abs(last.x - first.x) >= Math.abs(last.z - first.z) ? "x" : "z";
}

function normalizedRouteDirection(route, axis = normalizedRouteAxis(route)) {
  if (route?.direction) return Math.sign(route.direction);
  if (!route || route.length < 2 || axis !== "x" && axis !== "z") return 0;
  return Math.sign(route[route.length - 1][axis] - route[0][axis]);
}

function currentVehicleRouteDirection(vehicle, axis = normalizedRouteAxis(vehicle?.route)) {
  if (!vehicle || axis !== "x" && axis !== "z") return 0;
  const heading = axis === "x" ? -Math.sin(vehicle.state.yaw) : -Math.cos(vehicle.state.yaw);
  if (Math.abs(heading) > 0.25) return Math.sign(heading);
  return normalizedRouteDirection(vehicle.route, axis);
}

function routeLaneCoordinate(route, axis = normalizedRouteAxis(route)) {
  if (!route?.length) return 0;
  return axis === "x" ? route[0].z : route[0].x;
}

function routeCoversCoordinate(route, axis, coordinate, padding = 6) {
  if (!route?.length || axis !== "x" && axis !== "z") return false;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const point of route) {
    minimum = Math.min(minimum, point[axis]);
    maximum = Math.max(maximum, point[axis]);
  }
  return coordinate >= minimum - padding && coordinate <= maximum + padding;
}

function normalizeRoads(source) {
  if (!Array.isArray(source)) return [];
  const roads = [];
  for (const candidate of source) {
    if (!candidate || candidate.axis !== "x" && candidate.axis !== "z") continue;
    const center = pointXZ(candidate.center ?? candidate.position ?? candidate);
    const extents = candidate.halfExtents ?? candidate.extents ?? candidate.halfSize ?? [];
    const halfX = Math.max(1, finite(extents.x ?? extents[0] ?? candidate.halfWidth, 6));
    const halfZ = Math.max(1, finite(extents.z ?? extents[2] ?? extents[1] ?? candidate.halfWidth, 6));
    roads.push({
      id: String(candidate.id ?? `road-${roads.length + 1}`),
      axis: candidate.axis,
      x: center.x,
      z: center.z,
      halfX,
      halfZ,
    });
  }
  return roads;
}

function buildIntersections(source) {
  const roads = normalizeRoads(source);
  const horizontal = roads.filter(road => road.axis === "x");
  const vertical = roads.filter(road => road.axis === "z");
  const intersections = [];
  for (const zRoad of vertical) {
    for (const xRoad of horizontal) {
      const x = zRoad.x;
      const z = xRoad.z;
      const withinHorizontal = Math.abs(x - xRoad.x) <= xRoad.halfX + EPSILON;
      const withinVertical = Math.abs(z - zRoad.z) <= zRoad.halfZ + EPSILON;
      if (!withinHorizontal || !withinVertical) continue;
      intersections.push(Object.freeze({
        id: `${zRoad.id}--${xRoad.id}`,
        x,
        z,
        zRoadId: zRoad.id,
        xRoadId: xRoad.id,
        zStopHalfWidth: xRoad.halfZ,
        xStopHalfWidth: zRoad.halfX,
        conflictRadius: Math.max(4.5, xRoad.halfZ, zRoad.halfX) + 0.8,
      }));
    }
  }
  intersections.sort((a, b) => a.x - b.x || a.z - b.z || a.id.localeCompare(b.id));
  return Object.freeze(intersections);
}

function signalPhaseAt(time) {
  const phase = ((finite(time) % TRAFFIC_SIGNAL_CYCLE) + TRAFFIC_SIGNAL_CYCLE) % TRAFFIC_SIGNAL_CYCLE;
  if (phase < 7) return { x: "green", z: "red", name: "east-west" };
  if (phase < 8.5) return { x: "yellow", z: "red", name: "east-west-clearance" };
  if (phase < 10) return { x: "red", z: "red", name: "all-red" };
  if (phase < 17) return { x: "red", z: "green", name: "north-south" };
  if (phase < 18.5) return { x: "red", z: "yellow", name: "north-south-clearance" };
  return { x: "red", z: "red", name: "all-red" };
}

function routePose(route, segment = 0, amount = 0, lateral = 0) {
  const from = route[((segment % route.length) + route.length) % route.length];
  const to = route[(segment + 1 + route.length) % route.length];
  const t = clamp01(amount);
  const x = from.x + (to.x - from.x) * t;
  const z = from.z + (to.z - from.z) * t;
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  return {
    x: x + Math.cos(yaw) * lateral,
    z: z - Math.sin(yaw) * lateral,
    yaw,
  };
}

function flattenSpawnPoints(source) {
  const entries = [];
  function visit(value, category = "") {
    if (Array.isArray(value)) {
      const numericPoint = value.length >= 2 && value.every(component => typeof component === "number");
      if (numericPoint) entries.push({ position: value, category });
      else for (const child of value) visit(child, category);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.position || Number.isFinite(Number(value.x)) || Number.isFinite(Number(value.z))) {
      entries.push({ ...value, category: value.category ?? category });
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, key);
  }
  visit(source);
  return entries;
}

function defaultDescriptors(routes) {
  const outer = routes[0];
  const counter = routes[1] ?? outer;
  const inner = routes[2] ?? outer;
  const innerCounter = routes[3] ?? counter;
  const mission = routePose(inner, 0, 0.34, 2.9);
  const parkedA = routePose(inner, 1, 0.20, 2.9);
  const parkedB = routePose(innerCounter, 2, 0.55, 2.8);
  const parkedC = routePose(counter, 3, 0.24, 2.9);
  const parkedD = routePose(outer, 2, 0.72, 2.9);
  const descriptors = [
    { id: "mission-comet", kind: "sports", ...mission, mode: "parked", missionTarget: true, color: 0xf0182f },
    { id: "parked-sedan", kind: "sedan", ...parkedA, mode: "parked", color: 0x256b89 },
    { id: "parked-taxi", kind: "taxi", ...parkedB, mode: "parked" },
    { id: "parked-van", kind: "van", ...parkedC, mode: "parked", color: 0x52606a },
    { id: "parked-sport", kind: "sports", ...parkedD, mode: "parked", color: 0x7d32b2 },
  ];
  const trafficKinds = [
    "sedan", "taxi", "sedan", "van", "sports", "taxi", "sedan",
    "van", "sedan", "taxi", "sports",
  ];
  for (let index = 0; index < trafficKinds.length; ++index) {
    const routeSlot = index % routes.length;
    const route = routes[routeSlot];
    // Authored two-point road lines are directed lanes, not ping-pong paths.
    // Spawning odd-index traffic on segment 1 used to reverse its live yaw
    // against route.direction and routeCursor. In the native city that put
    // the roadside van southbound on a northbound lane, directly behind a
    // parked car. Keep every directed actor on point 0 -> point 1 and wrap it
    // back to point 0 only after reaching the far boundary.
    const directedLine = route.length === 2;
    const spawnSegment = directedLine ? 0 : index % route.length;
    const pose = routePose(route, spawnSegment, 0.12 + (index % 3) * 0.25, 0);
    descriptors.push({
      id: `traffic-${trafficKinds[index]}-${index + 1}`,
      kind: trafficKinds[index],
      ...pose,
      mode: "traffic",
      routeSlot,
      routeCursor: directedLine ? 1 : (spawnSegment + 1) % route.length,
      ...(index === 3 || index === 7 ? {
        serviceRole: ROADSIDE_SERVICE_ROLE,
        displayName: `Pulse Roadside Response ${index === 3 ? "North" : "Central"}`,
        color: 0x304852,
      } : null),
    });
  }
  for (let index = 0; index < 3; ++index) {
    const routeSlot = (index + 1) % routes.length;
    const route = routes[routeSlot];
    const directedLine = route.length === 2;
    const spawnSegment = directedLine ? 0 : (index + 2) % route.length;
    const pose = routePose(route, spawnSegment, 0.48, 0);
    descriptors.push({
      id: `police-${index + 1}`,
      kind: "police",
      ...pose,
      mode: "police",
      police: true,
      routeSlot,
      routeCursor: directedLine ? 1 : (spawnSegment + 1) % route.length,
    });
  }
  return descriptors;
}

function spawnDescriptors(world, routes) {
  const defaults = defaultDescriptors(routes);
  const provided = flattenSpawnPoints(world?.spawnPoints).filter(point => {
    const category = String(point.category ?? point.role ?? point.mode ?? "").toLowerCase();
    return !category.includes("player") && !category.includes("pedestrian") && !category.includes("npc");
  });
  if (provided.length === 0) return defaults;
  const providedPolice = provided.filter(point => {
    const category = String(point.category ?? point.role ?? point.mode ?? "").toLowerCase();
    return point.police === true || category.includes("police");
  });
  const providedCivilian = provided.filter(point => !providedPolice.includes(point));
  let policeCursor = 0;
  let civilianCursor = 0;
  const descriptors = defaults.map(descriptor => {
    const point = descriptor.police
      ? providedPolice[policeCursor++]
      : providedCivilian[civilianCursor++];
    if (!point) return descriptor;
    const position = pointXZ(point, descriptor.x, descriptor.z);
    const category = String(point.category ?? point.role ?? point.mode ?? "").toLowerCase();
    const police = point.police === true || category.includes("police");
    const missionTarget = point.missionTarget === true || category.includes("mission");
    const traffic = point.traffic === true || category.includes("traffic");
    const kind = VEHICLE_STYLES[point.kind] ? point.kind : police ? "police" : descriptor.kind;
    const matchedRoute = point.roadId
      ? routes.findIndex(route => route.roadId === point.roadId || route.id === point.roadId)
      : -1;
    return {
      ...descriptor,
      ...point,
      ...position,
      yaw: finite(point.yaw ?? point.heading ?? point.rotation, descriptor.yaw),
      kind,
      police: police || descriptor.police,
      missionTarget: missionTarget || descriptor.missionTarget,
      mode: police ? "police" : traffic ? "traffic" : point.parked === true ? "parked" : descriptor.mode,
      routeSlot: matchedRoute >= 0 ? matchedRoute : descriptor.routeSlot,
    };
  });
  const unused = [...providedCivilian.slice(civilianCursor), ...providedPolice.slice(policeCursor)];
  for (let index = 0; index < Math.min(MAX_VEHICLES - descriptors.length, unused.length); ++index) {
    const point = unused[index];
    const position = pointXZ(point);
    const category = String(point.category ?? point.role ?? point.mode ?? "").toLowerCase();
    const police = point.police === true || category.includes("police");
    const matchedRoute = point.roadId
      ? routes.findIndex(route => route.roadId === point.roadId || route.id === point.roadId)
      : -1;
    descriptors.push({
      id: String(point.id ?? `city-vehicle-${descriptors.length + 1}`),
      kind: VEHICLE_STYLES[point.kind] ? point.kind : police ? "police" : "sedan",
      ...position,
      yaw: finite(point.yaw ?? point.heading ?? point.rotation),
      mode: police ? "police" : point.parked ? "parked" : "traffic",
      police,
      authorized: Boolean(point.authorized),
      access: point.access ? String(point.access) : null,
      displayName: point.displayName ? String(point.displayName) : null,
      color: point.color,
      routeSlot: matchedRoute >= 0 ? matchedRoute : descriptors.length % routes.length,
      routeCursor: 1,
    });
  }
  if (!descriptors.some(descriptor => descriptor.missionTarget)) descriptors[0].missionTarget = true;
  return descriptors.slice(0, MAX_VEHICLES);
}

function findOpenSpawn(world, x, z, radius) {
  const bounds = boundsOf(world);
  const clampPoint = point => ({
    x: bounds ? clamp(point.x, bounds.minX + radius, bounds.maxX - radius) : point.x,
    z: bounds ? clamp(point.z, bounds.minZ + radius, bounds.maxZ - radius) : point.z,
  });
  let point = clampPoint({ x, z });
  if (!blockedCircle(world, point.x, point.z, radius)) return point;
  for (let ring = 1; ring <= 6; ++ring) {
    for (let slot = 0; slot < 12; ++slot) {
      const angle = slot / 12 * Math.PI * 2;
      point = clampPoint({ x: x + Math.cos(angle) * ring * 3.2, z: z + Math.sin(angle) * ring * 3.2 });
      if (!blockedCircle(world, point.x, point.z, radius)) return point;
    }
  }
  return point;
}

function findUnoccupiedSpawn(world, x, z, radius, existing) {
  const open = findOpenSpawn(world, x, z, radius);
  const available = point => !blockedCircle(world, point.x, point.z, radius) &&
    existing.every(vehicle => Math.hypot(vehicle.state.x - point.x, vehicle.state.z - point.z) >=
      (vehicle.radius + radius) * 1.08);
  if (available(open)) return open;
  for (let ring = 1; ring <= 5; ++ring) {
    for (let slot = 0; slot < 16; ++slot) {
      const angle = slot / 16 * Math.PI * 2;
      const candidate = findOpenSpawn(
        world,
        x + Math.cos(angle) * ring * (radius * 2.35),
        z + Math.sin(angle) * ring * (radius * 2.35),
        radius,
      );
      if (available(candidate)) return candidate;
    }
  }
  return open;
}

function createVisualAssets() {
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    head: new THREE.SphereGeometry(1, 10, 7),
    wheel: new THREE.CylinderGeometry(1, 1, 1, 20),
    rim: new THREE.CylinderGeometry(1, 1, 1.02, 12),
    marker: new THREE.TorusGeometry(1, 0.035, 8, 48),
  };
  const materials = new Set();
  const cache = new Map();
  function own(material) {
    materials.add(material);
    return material;
  }
  function cached(key, factory) {
    if (!cache.has(key)) cache.set(key, own(factory()));
    return cache.get(key);
  }
  const common = {
    rubber: own(new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.92, metalness: 0.02 })),
    rim: own(new THREE.MeshStandardMaterial({ color: 0xa5b2ba, roughness: 0.24, metalness: 0.84 })),
    dark: own(new THREE.MeshStandardMaterial({ color: 0x0b1015, roughness: 0.46, metalness: 0.58 })),
    glass: own(new THREE.MeshStandardMaterial({
      color: 0x173847, roughness: 0.08, metalness: 0.12, transparent: true, opacity: 0.74,
    })),
    headlight: own(new THREE.MeshStandardMaterial({
      color: 0xe9fbff, emissive: 0xbfeeff, emissiveIntensity: 8.5, roughness: 0.18,
    })),
    tailLight: own(new THREE.MeshStandardMaterial({
      color: 0xff273b, emissive: 0xff1027, emissiveIntensity: 6.4, roughness: 0.22,
    })),
    indicator: own(new THREE.MeshStandardMaterial({
      color: 0xffa51d, emissive: 0xff7b0c, emissiveIntensity: 8, roughness: 0.2,
    })),
    reverseLight: own(new THREE.MeshStandardMaterial({
      color: 0xf5fbff, emissive: 0xdff6ff, emissiveIntensity: 7, roughness: 0.2,
    })),
    white: own(new THREE.MeshStandardMaterial({ color: 0xe7edf0, roughness: 0.27, metalness: 0.35 })),
    occupantSkin: own(new THREE.MeshStandardMaterial({ color: 0x9b715b, roughness: 0.86, metalness: 0.01 })),
    occupantClothing: [
      own(new THREE.MeshStandardMaterial({ color: 0x2b4054, roughness: 0.82, metalness: 0.02 })),
      own(new THREE.MeshStandardMaterial({ color: 0x604032, roughness: 0.84, metalness: 0.015 })),
      own(new THREE.MeshStandardMaterial({ color: 0x3d5140, roughness: 0.86, metalness: 0.01 })),
      own(new THREE.MeshStandardMaterial({ color: 0x51405f, roughness: 0.83, metalness: 0.02 })),
    ],
    policeUniform: own(new THREE.MeshStandardMaterial({ color: 0x182b43, roughness: 0.72, metalness: 0.08 })),
    taxiSign: own(new THREE.MeshStandardMaterial({
      color: 0xffd862, emissive: 0xe9a817, emissiveIntensity: 1.8, roughness: 0.32,
    })),
    policeRed: own(new THREE.MeshStandardMaterial({
      color: 0xff213d, emissive: 0xff0b31, emissiveIntensity: 8, roughness: 0.18,
    })),
    policeBlue: own(new THREE.MeshStandardMaterial({
      color: 0x2478ff, emissive: 0x1458ff, emissiveIntensity: 8, roughness: 0.18,
    })),
    mission: own(new THREE.MeshBasicMaterial({ color: 0xff1d3f, transparent: true, opacity: 0.9, depthWrite: false })),
  };
  return {
    geometries,
    common,
    cloneMaterial(material) { return own(material.clone()); },
    paint(color, roughness) {
      const hex = Number(color) >>> 0;
      return cached(`paint-${hex}-${roughness}`, () => new THREE.MeshStandardMaterial({
        color: hex, metalness: 0.68, roughness, emissive: new THREE.Color(hex).multiplyScalar(0.025),
      }));
    },
    dispose() {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      for (const material of materials) material.dispose();
      materials.clear();
      cache.clear();
    },
  };
}

function addScaledBox(parent, assets, material, name, size, position) {
  const mesh = new THREE.Mesh(assets.geometries.box, material);
  mesh.name = name;
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildVehicleVisual(assets, descriptor, style) {
  const root = new THREE.Group();
  root.name = `${descriptor.kind} ${descriptor.id}`;
  root.userData.rtxIgnore = true;
  root.userData.dynamicActor = true;
  const paintColor = descriptor.missionTarget ? 0xf0182f : descriptor.color ?? style.color;
  const paint = assets.paint(paintColor, descriptor.missionTarget ? 0.13 : style.roughness);
  const bodyY = style.wheelRadius + 0.34;
  const lowerHeight = descriptor.kind === "van" ? 0.62 : descriptor.kind === "sports" ? 0.42 : 0.52;
  addScaledBox(root, assets, paint, "Sculpted lower body", [style.width, lowerHeight, style.length], [0, bodyY, 0]);
  const frontIntake = addScaledBox(root, assets, assets.common.dark, "Front lower intake", [style.width * 0.64, 0.13, 0.08], [0, bodyY - 0.09, -style.length * 0.51]);
  addScaledBox(root, assets, assets.common.dark, "Rear diffuser", [style.width * 0.72, 0.12, 0.08], [0, bodyY - 0.08, style.length * 0.51]);
  const hood = addScaledBox(root, assets, paint, "Hood volume", [style.width * 0.91, descriptor.kind === "sports" ? 0.18 : 0.25, style.length * 0.29], [0, bodyY + lowerHeight * 0.48, -style.length * 0.33]);
  addScaledBox(root, assets, paint, "Rear deck", [style.width * 0.90, 0.20, style.length * 0.19], [0, bodyY + lowerHeight * 0.48, style.length * 0.40]);

  const cabinLength = descriptor.kind === "van" ? style.length * 0.72 : style.length * (descriptor.kind === "sports" ? 0.43 : 0.50);
  const cabinHeight = descriptor.kind === "van" ? 1.22 : descriptor.kind === "sports" ? 0.47 : 0.66;
  const cabinZ = descriptor.kind === "van" ? 0.15 : 0.12;
  addScaledBox(root, assets, assets.common.glass, "Tinted continuous cabin", [style.width * 0.78, cabinHeight, cabinLength], [0, bodyY + lowerHeight * 0.53 + cabinHeight * 0.48, cabinZ]);
  addScaledBox(root, assets, paint, "Roof panel", [style.width * 0.72, 0.10, cabinLength * 0.73], [0, bodyY + lowerHeight * 0.55 + cabinHeight, cabinZ + 0.05]);

  const occupants = [];
  const transitParts = [];
  const occupantMaterial = assets.common.occupantClothing[
    Math.floor(deterministicUnit(`${descriptor.id}-driver-clothes`) * assets.common.occupantClothing.length) %
      assets.common.occupantClothing.length
  ];
  const seatBaseY = bodyY + lowerHeight * 0.40;

  function addCabinOccupant(name, x, z, clothing = occupantMaterial, role = "driverOccupant") {
    const person = new THREE.Group();
    person.name = name;
    const torso = addScaledBox(person, assets, clothing, `${name} torso`, [0.29, 0.38, 0.22], [0, 0.18, 0]);
    torso.castShadow = false;
    const head = new THREE.Mesh(assets.geometries.head, assets.common.occupantSkin);
    head.name = `${name} head`;
    head.scale.set(0.14, 0.17, 0.14);
    head.position.set(0, 0.53, -0.035);
    head.castShadow = false;
    head.receiveShadow = false;
    person.add(head);
    for (const side of [-1, 1]) {
      const arm = addScaledBox(
        person,
        assets,
        clothing,
        `${name} ${side < 0 ? "left" : "right"} arm`,
        [0.09, 0.30, 0.09],
        [side * 0.18, 0.17, -0.07],
      );
      arm.rotation.x = -0.76;
      arm.rotation.z = side * -0.18;
      arm.castShadow = false;
    }
    person.position.set(x, seatBaseY, z);
    person.rotation.x = -0.08;
    person.userData[role] = true;
    person.visible = false;
    root.add(person);
    occupants.push(person);
    return person;
  }

  // A dashboard, front seats and steering wheel remain visible through the
  // tint even when a parked car is empty. They make the cabin read as a real
  // volume instead of a translucent painted box.
  const dashboard = addScaledBox(
    root,
    assets,
    assets.common.dark,
    "Cabin dashboard",
    [style.width * 0.68, 0.13, 0.18],
    [0, seatBaseY + 0.19, cabinZ - cabinLength * 0.38],
  );
  dashboard.castShadow = false;
  for (const side of [-1, 1]) {
    const seat = addScaledBox(
      root,
      assets,
      assets.common.dark,
      `${side < 0 ? "Driver" : "front passenger"} seat`,
      [style.width * 0.24, 0.34, 0.30],
      [side * style.width * 0.19, seatBaseY + 0.02, cabinZ - cabinLength * 0.08],
    );
    seat.castShadow = false;
  }
  const steeringWheel = new THREE.Mesh(assets.geometries.marker, assets.common.dark);
  steeringWheel.name = "Visible steering wheel";
  steeringWheel.scale.setScalar(0.18);
  steeringWheel.position.set(-style.width * 0.19, seatBaseY + 0.31, cabinZ - cabinLength * 0.30);
  steeringWheel.rotation.x = 1.02;
  steeringWheel.castShadow = false;
  root.add(steeringWheel);

  if (descriptor.police || descriptor.kind === "police") {
    for (const [seat, x] of [["driver", -style.width * 0.19], ["partner", style.width * 0.19]]) {
      const officer = new THREE.Group();
      officer.name = `Visible ${seat} police occupant`;
      const torso = addScaledBox(
        officer,
        assets,
        assets.common.policeUniform,
        `${seat} officer uniform torso`,
        [0.30, 0.43, 0.24],
        [0, 0.18, 0],
      );
      torso.castShadow = false;
      const head = new THREE.Mesh(assets.geometries.head, assets.common.occupantSkin);
      head.name = `${seat} officer head`;
      head.scale.set(0.14, 0.18, 0.14);
      head.position.set(0, 0.54, -0.015);
      head.castShadow = false;
      const cap = addScaledBox(
        officer,
        assets,
        assets.common.policeUniform,
        `${seat} officer cap`,
        [0.30, 0.075, 0.25],
        [0, 0.69, -0.018],
      );
      cap.castShadow = false;
      officer.position.set(x, bodyY + 0.46, cabinZ - cabinLength * 0.16);
      officer.rotation.x = -0.08;
      root.add(officer);
      occupants.push(officer);
    }
  } else if (descriptor.access !== "pulse-line") {
    addCabinOccupant(
      "Visible civilian driver",
      -style.width * 0.19,
      cabinZ - cabinLength * 0.14,
      occupantMaterial,
      "driverOccupant",
    );
    if (descriptor.mode === "traffic" && deterministicUnit(`${descriptor.id}-ambient-passenger`) > 0.64) {
      const passengerMaterial = assets.common.occupantClothing[
        (assets.common.occupantClothing.indexOf(occupantMaterial) + 2) % assets.common.occupantClothing.length
      ];
      addCabinOccupant(
        "Visible ambient front passenger",
        style.width * 0.19,
        cabinZ - cabinLength * 0.10,
        passengerMaterial,
        "ambientPassenger",
      );
    }
    if (descriptor.kind === "taxi") {
      const taxiMaterial = assets.common.occupantClothing[
        (assets.common.occupantClothing.indexOf(occupantMaterial) + 1) % assets.common.occupantClothing.length
      ];
      addCabinOccupant(
        "Visible taxi rear passenger",
        style.width * 0.19,
        cabinZ + cabinLength * 0.24,
        taxiMaterial,
        "taxiPassenger",
      );
    }
  }
  addScaledBox(root, assets, assets.common.dark, "Left side sill", [0.09, 0.12, style.length * 0.76], [-style.width * 0.50, bodyY - 0.09, 0]);
  addScaledBox(root, assets, assets.common.dark, "Right side sill", [0.09, 0.12, style.length * 0.76], [style.width * 0.50, bodyY - 0.09, 0]);

  const wheels = [];
  for (const z of [-style.wheelBase * 0.5, style.wheelBase * 0.5]) {
    for (const side of [-1, 1]) {
      const steerRoot = new THREE.Group();
      steerRoot.position.set(side * style.width * 0.51, style.wheelRadius, z);
      const spinRoot = new THREE.Group();
      const tire = new THREE.Mesh(assets.geometries.wheel, assets.common.rubber);
      tire.name = "Low-profile tire";
      tire.scale.set(style.wheelRadius, 0.14, style.wheelRadius);
      tire.rotation.z = Math.PI * 0.5;
      tire.castShadow = true;
      const rim = new THREE.Mesh(assets.geometries.rim, assets.common.rim);
      rim.name = "Alloy wheel face";
      rim.scale.set(style.wheelRadius * 0.53, 0.145, style.wheelRadius * 0.53);
      rim.rotation.z = Math.PI * 0.5;
      spinRoot.add(tire, rim);
      steerRoot.add(spinRoot);
      root.add(steerRoot);
      wheels.push({ steerRoot, spinRoot, front: z < 0, side, baseY: style.wheelRadius, spinAngle: 0 });
    }
  }

  const headlights = [];
  const tailLights = [];
  const reverseLights = [];
  const turnSignals = [];
  const tailMaterial = assets.cloneMaterial(assets.common.tailLight);
  for (const side of [-1, 1]) {
    headlights.push(addScaledBox(root, assets, assets.common.headlight, "LED headlamp", [style.width * 0.24, 0.13, 0.055], [side * style.width * 0.27, bodyY + 0.08, -style.length * 0.515]));
    tailLights.push(addScaledBox(root, assets, tailMaterial, "LED tail and brake lamp", [style.width * 0.25, 0.12, 0.055], [side * style.width * 0.27, bodyY + 0.08, style.length * 0.515]));
    const reverse = addScaledBox(root, assets, assets.common.reverseLight, "Reverse lamp", [0.13, 0.075, 0.058], [side * style.width * 0.10, bodyY + 0.08, style.length * 0.518]);
    reverse.visible = false;
    reverseLights.push(reverse);
    for (const z of [-style.length * 0.518, style.length * 0.518]) {
      const indicator = addScaledBox(root, assets, assets.common.indicator, `${side < 0 ? "Left" : "Right"} turn signal`, [0.115, 0.085, 0.06], [side * style.width * 0.43, bodyY + 0.08, z]);
      indicator.visible = false;
      turnSignals.push({ mesh: indicator, side });
    }
  }

  const damagePanel = addScaledBox(
    root,
    assets,
    assets.common.dark,
    "Progressive hood damage and scrape panel",
    [style.width * 0.62, 0.026, style.length * 0.20],
    [0, bodyY + lowerHeight * 0.62 + 0.03, -style.length * 0.34],
  );
  damagePanel.visible = false;

  if (descriptor.kind === "taxi") {
    addScaledBox(root, assets, assets.common.dark, "Taxi checker belt", [style.width * 1.01, 0.12, style.length * 0.58], [0, bodyY + 0.28, 0.06]);
    addScaledBox(root, assets, assets.common.taxiSign, "Illuminated TAXI roof sign", [0.66, 0.21, 0.30], [0, bodyY + lowerHeight * 0.55 + cabinHeight + 0.19, 0.05]);
  }
  if (descriptor.kind === "police") {
    addScaledBox(root, assets, assets.common.white, "Left police door panel", [0.035, 0.43, style.length * 0.34], [-style.width * 0.515, bodyY + 0.17, 0.12]);
    addScaledBox(root, assets, assets.common.white, "Right police door panel", [0.035, 0.43, style.length * 0.34], [style.width * 0.515, bodyY + 0.17, 0.12]);
  }
  if (descriptor.kind === "sports") {
    addScaledBox(root, assets, assets.common.dark, "Sports rear wing", [style.width * 0.82, 0.08, 0.20], [0, bodyY + 0.72, style.length * 0.43]);
    addScaledBox(root, assets, assets.common.dark, "Rear wing pylons", [style.width * 0.47, 0.23, 0.055], [0, bodyY + 0.59, style.length * 0.43]);
  }
  if (descriptor.kind === "van") {
    addScaledBox(root, assets, paint, "Van cargo shell", [style.width * 0.93, 1.34, style.length * 0.61], [0, bodyY + 0.82, style.length * 0.16]);
    addScaledBox(root, assets, assets.common.dark, "Van rear door seam", [0.035, 0.92, 0.04], [0, bodyY + 0.86, style.length * 0.475]);
    if (descriptor.access === "pulse-line") {
      const routePanel = addScaledBox(
        root,
        assets,
        assets.common.taxiSign,
        "Pulse Line front route panel",
        [1.16, 0.18, 0.052],
        [0, bodyY + 1.24, -style.length * 0.505],
      );
      transitParts.push(routePanel);
      for (const side of [-1, 1]) {
        const glazing = addScaledBox(
          root,
          assets,
          assets.common.glass,
          `${side < 0 ? "Left" : "Right"} Pulse Line side glazing`,
          [0.034, 0.56, style.length * 0.52],
          [side * style.width * 0.508, bodyY + 1.02, 0.12],
        );
        glazing.castShadow = false;
        transitParts.push(glazing);
      }
      transitParts.push(addScaledBox(
        root,
        assets,
        paint,
        "Pulse Line kerbside boarding door",
        [0.038, 0.56, 1.18],
        [style.width * 0.512, bodyY + 0.39, 0.62],
      ));

      // Four single-mesh busts keep the minibus visibly occupied without a
      // new geometry, skin, material, or runtime-created node. Their subdued
      // material reads as people behind tint rather than detailed passengers.
      const seats = [
        ["driver", -0.34, -0.74],
        ["front passenger", 0.34, -0.36],
        ["rear passenger left", -0.34, 0.54],
        ["rear passenger right", 0.34, 1.20],
      ];
      for (const [seat, x, z] of seats) {
        const silhouette = new THREE.Mesh(assets.geometries.head, assets.common.dark);
        silhouette.name = `Visible Pulse Line ${seat} silhouette`;
        silhouette.scale.set(0.18, 0.32, 0.14);
        silhouette.position.set(x, bodyY + 1.01, z);
        silhouette.castShadow = false;
        silhouette.receiveShadow = false;
        silhouette.userData.transitOccupant = true;
        root.add(silhouette);
        occupants.push(silhouette);
        transitParts.push(silhouette);
      }
    }
  }

  const emergencyLights = [];
  if (descriptor.police || descriptor.kind === "police") {
    const lightY = bodyY + lowerHeight * 0.55 + cabinHeight + 0.17;
    addScaledBox(root, assets, assets.common.dark, "Police lightbar base", [0.98, 0.08, 0.22], [0, lightY, 0.08]);
    const addEmergencyLight = (material, name, size, position, channel, role) => {
      const light = addScaledBox(root, assets, material, name, size, position);
      light.userData.flashChannel = channel;
      light.userData.flashRole = role;
      light.userData.baseScaleY = light.scale.y;
      emergencyLights.push(light);
    };
    addEmergencyLight(assets.common.policeRed, "Red emergency lightbar", [0.42, 0.12, 0.20], [-0.25, lightY + 0.08, 0.08], 0, "roof");
    addEmergencyLight(assets.common.policeBlue, "Blue emergency lightbar", [0.42, 0.12, 0.20], [0.25, lightY + 0.08, 0.08], 1, "roof");
    addEmergencyLight(assets.common.policeRed, "Red grille strobe", [0.22, 0.075, 0.045], [-0.24, bodyY - 0.02, -style.length * 0.525], 0, "grille");
    addEmergencyLight(assets.common.policeBlue, "Blue grille strobe", [0.22, 0.075, 0.045], [0.24, bodyY - 0.02, -style.length * 0.525], 1, "grille");
    addEmergencyLight(assets.common.policeRed, "Red rear-deck strobe", [0.20, 0.07, 0.045], [-0.22, bodyY + 0.28, style.length * 0.515], 0, "rear");
    addEmergencyLight(assets.common.policeBlue, "Blue rear-deck strobe", [0.20, 0.07, 0.045], [0.22, bodyY + 0.28, style.length * 0.515], 1, "rear");
  }

  // The Pulse Roadside unit is a dormant member of ordinary traffic until an
  // incident claims it. Every lamp is built with the shared box geometry and
  // indicator material here, so dispatch only toggles visibility and never
  // creates a node, material, geometry, or WebGPU pipeline during play.
  const roadsideBeacons = [];
  if (descriptor.serviceRole === ROADSIDE_SERVICE_ROLE) {
    const beaconY = bodyY + lowerHeight * 0.55 + cabinHeight + 0.18;
    addScaledBox(
      root,
      assets,
      assets.common.dark,
      "Pulse Roadside amber beacon base",
      [0.86, 0.075, 0.24],
      [0, beaconY, 0.08],
    );
    for (const [name, x, z, channel] of [
      ["left roof beacon", -0.25, 0.08, 0],
      ["right roof beacon", 0.25, 0.08, 1],
      ["front amber responder strobe", 0, -style.length * 0.526, 0],
      ["rear amber responder strobe", 0, style.length * 0.526, 1],
    ]) {
      const roof = name.includes("roof");
      const beacon = addScaledBox(
        root,
        assets,
        assets.common.indicator,
        `Pulse Roadside ${name}`,
        roof ? [0.34, 0.12, 0.20] : [0.42, 0.085, 0.05],
        roof ? [x, beaconY + 0.08, z] : [x, bodyY + 0.16, z],
      );
      beacon.visible = false;
      beacon.userData.flashChannel = channel;
      beacon.userData.baseScaleY = beacon.scale.y;
      roadsideBeacons.push(beacon);
    }
  }

  let missionMarker = null;
  if (descriptor.missionTarget) {
    missionMarker = new THREE.Mesh(assets.geometries.marker, assets.common.mission);
    missionMarker.name = "Pulsing red mission vehicle marker";
    missionMarker.rotation.x = Math.PI * 0.5;
    missionMarker.position.y = 2.65;
    missionMarker.scale.setScalar(1.52);
    missionMarker.renderOrder = 30;
    missionMarker.frustumCulled = false;
    root.add(missionMarker);
  }
  const bodyRoot = new THREE.Group();
  bodyRoot.name = "Sprung vehicle body";
  const wheelRoots = new Set(wheels.map(wheel => wheel.steerRoot));
  for (const child of [...root.children]) {
    if (!wheelRoots.has(child) && child !== missionMarker) bodyRoot.add(child);
  }
  root.add(bodyRoot);
  // One bounded, shadow-free throw per car gives moving traffic a real pool
  // of light on wet roads.  It is intentionally centred rather than doubled:
  // the two visible lamp meshes sell the width while one SpotLight keeps the
  // native clustered-light cost predictable for a whole avenue of traffic.
  const headlightTarget = new THREE.Object3D();
  headlightTarget.name = "Vehicle headlight throw target";
  headlightTarget.position.set(0, 0.10, -16);
  const headlightThrow = new THREE.SpotLight(0xd9efff, 0, 24, 0.47, 0.72, 1.6);
  headlightThrow.name = "Vehicle low-beam road throw";
  headlightThrow.position.set(0, bodyY + 0.12, -style.length * 0.43);
  headlightThrow.target = headlightTarget;
  headlightThrow.castShadow = false;
  root.add(headlightThrow, headlightTarget);
  return {
    root,
    bodyRoot,
    wheels,
    headlights,
    headlightThrow,
    tailLights,
    reverseLights,
    turnSignals,
    emergencyLights,
    roadsideBeacons,
    occupants,
    transitParts,
    missionMarker,
    damagePanel,
    hood,
    frontIntake,
  };
}

function deterministicUnit(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function desiredControls(vehicle, target, aggressive = false, output = null) {
  const controls = output ?? {};
  if (!target) {
    controls.throttle = 0;
    controls.reverse = 0;
    controls.brake = 0.35;
    controls.steer = 0;
    controls.handbrake = false;
    return controls;
  }
  const dx = target.x - vehicle.state.x;
  const dz = target.z - vehicle.state.z;
  const distance = Math.hypot(dx, dz);
  const desiredYaw = Math.atan2(-dx, -dz);
  const difference = wrapAngle(desiredYaw - vehicle.state.yaw);
  const steeringGain = aggressive ? 1.72 : 1.28 + Math.min(0.22, Math.abs(vehicle.state.speed) * 0.008);
  const steer = clamp(-difference * steeringGain, -1, 1);
  const sharpTurn = Math.abs(difference);
  const personality = vehicle.aiTemperament ?? 1;
  const cruiseSpeed = Math.max(4, (aggressive ? vehicle.baseMaxSpeed : vehicle.patrolMaxSpeed) * personality);
  const cornerRatio = clamp(sharpTurn / (aggressive ? 2.15 : 1.45), 0, 1);
  const cornerSpeed = cruiseSpeed * (1 - cornerRatio * (aggressive ? 0.42 : 0.68));
  const approachSpeed = distance < 8 ? Math.max(2.2, cornerSpeed * (0.28 + distance / 11)) : cornerSpeed;
  const speedError = approachSpeed - Math.max(0, vehicle.state.speed);
  let brake = clamp(-speedError / Math.max(4, approachSpeed * 0.42), 0, 1);
  if (sharpTurn > (aggressive ? 1.55 : 1.12)) brake = Math.max(brake, clamp(sharpTurn / Math.PI, 0, 0.88));
  if (distance < 2.5) brake = Math.max(brake, 0.72);
  let throttle = brake > 0.22
    ? 0
    : clamp(speedError / Math.max(3.5, cruiseSpeed * 0.36), aggressive ? 0.25 : 0.08, aggressive ? 1 : 0.82);
  // A car cannot rotate in place. Feed in a little torque when it spawns or
  // reaches a tight corner facing away from its path, otherwise "brake for
  // corner" logic can deadlock at zero speed forever.
  if (Math.abs(vehicle.state.speed) < 1.25 && distance > 3) {
    brake = 0;
    throttle = aggressive ? 0.42 : 0.24;
  }
  controls.throttle = throttle;
  controls.reverse = 0;
  controls.brake = brake;
  controls.steer = steer;
  controls.handbrake = aggressive && sharpTurn > 1.7 && Math.abs(vehicle.state.speed) > 10;
  return controls;
}

function routeTarget(vehicle) {
  const route = vehicle.route;
  if (!route?.length) return null;
  let target = route[vehicle.routeCursor % route.length];
  const reach = 3.8 + Math.min(5.5, Math.abs(vehicle.state.speed) * 0.28);
  if (Math.hypot(target.x - vehicle.state.x, target.z - vehicle.state.z) < reach) {
    if (route.length === 2) {
      // City lane records are directed line segments. Wrap at the far edge,
      // like the existing neon traffic sample, instead of attempting a wide
      // U-turn through the pavement and adjacent buildings.
      const restart = route[(vehicle.routeCursor + 1) % 2];
      vehicle.state.x = restart.x;
      vehicle.state.z = restart.z;
      vehicle.state.yaw = Math.atan2(-(target.x - restart.x), -(target.z - restart.z));
      return target;
    }
    vehicle.routeCursor = (vehicle.routeCursor + 1) % route.length;
    target = route[vehicle.routeCursor];
  }
  if (route.length > 2) {
    const next = route[(vehicle.routeCursor + 1) % route.length];
    const segmentX = next.x - target.x;
    const segmentZ = next.z - target.z;
    const segmentLength = Math.hypot(segmentX, segmentZ);
    const distance = Math.hypot(target.x - vehicle.state.x, target.z - vehicle.state.z);
    const rounding = clamp((reach * 1.35 - distance) / Math.max(1, reach), 0, 1) * Math.min(3.2, segmentLength * 0.12);
    if (segmentLength > EPSILON && rounding > 0) {
      return {
        x: target.x + segmentX / segmentLength * rounding,
        z: target.z + segmentZ / segmentLength * rounding,
      };
    }
  }
  return target;
}

function trafficAwareness(vehicle, vehicles) {
  const forwardX = -Math.sin(vehicle.state.yaw);
  const forwardZ = -Math.cos(vehicle.state.yaw);
  let nearestGap = Infinity;
  let nearestClosingSpeed = 0;
  for (const other of vehicles) {
    if (other === vehicle || other.health <= 0) continue;
    const dx = other.state.x - vehicle.state.x;
    const dz = other.state.z - vehicle.state.z;
    const forward = dx * forwardX + dz * forwardZ;
    const sightDistance = 12 + Math.max(0, vehicle.state.speed) * 0.82;
    if (forward <= 0 || forward > sightDistance) continue;
    const lateral = Math.abs(dx * forwardZ - dz * forwardX);
    if (lateral >= (vehicle.radius + other.radius) * 0.82) continue;
    const gap = Math.max(0, forward - vehicle.radius - other.radius);
    if (gap >= nearestGap) continue;
    const otherForwardX = -Math.sin(other.state.yaw);
    const otherForwardZ = -Math.cos(other.state.yaw);
    const otherSpeedAlongLane = other.state.speed * (otherForwardX * forwardX + otherForwardZ * forwardZ);
    nearestGap = gap;
    nearestClosingSpeed = Math.max(0, vehicle.state.speed - otherSpeedAlongLane);
  }
  if (!Number.isFinite(nearestGap)) return { gap: Infinity, closingSpeed: 0, throttleScale: 1, brake: 0 };
  const safeGap = 2.2 + Math.max(0, vehicle.state.speed) * 0.72 + nearestClosingSpeed * 0.38;
  const timeToCollision = nearestClosingSpeed > 0.05 ? nearestGap / nearestClosingSpeed : Infinity;
  const proximityBrake = clamp((safeGap - nearestGap) / Math.max(1, safeGap), 0, 1);
  const predictiveBrake = timeToCollision < 2.4 ? clamp((2.4 - timeToCollision) / 1.7, 0, 1) : 0;
  const brake = Math.max(proximityBrake, predictiveBrake);
  return {
    gap: nearestGap,
    closingSpeed: nearestClosingSpeed,
    throttleScale: clamp(nearestGap / Math.max(1, safeGap), 0, 1) * (1 - brake),
    brake,
  };
}

function travelAxis(vehicle, preferRoute = true) {
  if (preferRoute && vehicle.roadsideResponding &&
      (vehicle.roadsideNavigationAxis === "x" || vehicle.roadsideNavigationAxis === "z")) {
    return vehicle.roadsideNavigationAxis;
  }
  if (preferRoute && (vehicle.route?.axis === "x" || vehicle.route?.axis === "z")) return vehicle.route.axis;
  const forwardX = -Math.sin(vehicle.state.yaw);
  const forwardZ = -Math.cos(vehicle.state.yaw);
  return Math.abs(forwardX) > Math.abs(forwardZ) ? "x" : "z";
}

function upcomingIntersection(vehicle, intersections, freeDriving = false) {
  if (!intersections.length) return null;
  const axis = travelAxis(vehicle, !freeDriving);
  const forwardX = -Math.sin(vehicle.state.yaw);
  const forwardZ = -Math.cos(vehicle.state.yaw);
  const roadId = freeDriving
    ? null
    : vehicle.roadsideResponding && vehicle.roadsideNavigationRoadId
      ? vehicle.roadsideNavigationRoadId
      : vehicle.route?.roadId ?? null;
  let nearest = null;
  for (const intersection of intersections) {
    if (roadId && (axis === "x" ? intersection.xRoadId : intersection.zRoadId) !== roadId) continue;
    const lateralDistance = axis === "x"
      ? Math.abs(vehicle.state.z - intersection.z)
      : Math.abs(vehicle.state.x - intersection.x);
    if (!roadId && lateralDistance > 8.5) continue;
    const dx = intersection.x - vehicle.state.x;
    const dz = intersection.z - vehicle.state.z;
    const centerDistance = dx * forwardX + dz * forwardZ;
    const stopHalfWidth = axis === "x" ? intersection.xStopHalfWidth : intersection.zStopHalfWidth;
    const stopDistance = centerDistance - stopHalfWidth - vehicle.radius - 0.72;
    if (stopDistance < -1.1 || centerDistance < -intersection.conflictRadius) continue;
    if (!nearest || centerDistance < nearest.centerDistance) {
      nearest = { intersection, axis, centerDistance, stopDistance, lateralDistance };
    }
  }
  return nearest;
}

function intersectionIsClear(approach, vehicle, vehicles) {
  const { intersection, axis } = approach;
  for (const other of vehicles) {
    if (other === vehicle) continue;
    const dx = other.state.x - intersection.x;
    const dz = other.state.z - intersection.z;
    if (Math.hypot(dx, dz) < intersection.conflictRadius + other.radius) return false;
    const otherAxis = travelAxis(other);
    if (otherAxis === axis || other.health <= 0) continue;
    const otherForwardX = -Math.sin(other.state.yaw);
    const otherForwardZ = -Math.cos(other.state.yaw);
    const projected = -dx * otherForwardX - dz * otherForwardZ;
    const lateral = otherAxis === "x" ? Math.abs(dz) : Math.abs(dx);
    const threatDistance = 8 + Math.max(0, other.state.speed) * 1.35;
    if (projected > -1.5 && projected < threatDistance && lateral < 8.5) return false;
  }
  return true;
}

function intersectionControls(vehicle, intersections, vehicles, time, emergency = false) {
  const approach = upcomingIntersection(vehicle, intersections, emergency);
  if (!approach) return null;
  const phase = signalPhaseAt(time);
  const signal = phase[approach.axis];
  const speed = Math.max(0, vehicle.state.speed);
  const comfortableBrake = vehicle.kind === "van" ? 3.4 : 4.2;
  const stoppingDistance = speed * speed / (2 * comfortableBrake) + speed * 0.18 + 0.8;
  const lookAhead = Math.max(15, stoppingDistance + 9);
  const detail = {
    intersectionId: approach.intersection.id,
    axis: approach.axis,
    signal,
    phase: phase.name,
    stopDistance: approach.stopDistance,
    active: approach.stopDistance <= lookAhead,
    stopped: false,
    bypass: false,
    brake: 0,
    throttleScale: 1,
  };
  if (!detail.active || signal === "green") return detail;

  const yellowCanStop = approach.stopDistance > stoppingDistance * 0.82;
  let mustStop = signal === "red" || signal === "yellow" && yellowCanStop;
  if (emergency && mustStop && intersectionIsClear(approach, vehicle, vehicles)) {
    const bypassSpeed = 6.8;
    detail.bypass = true;
    detail.brake = speed > bypassSpeed
      ? clamp((speed - bypassSpeed) / Math.max(2.5, bypassSpeed * 0.45), 0, 0.82)
      : 0;
    detail.throttleScale = speed > bypassSpeed ? 0 : 0.42;
    return detail;
  }

  // Cars already committed during late yellow keep clearing the box. This is
  // important both for realism and to prevent an all-red phase from trapping
  // an actor in the middle of the intersection.
  if (!mustStop) return detail;
  const available = Math.max(0, approach.stopDistance - 0.42);
  const targetSpeed = Math.sqrt(2 * comfortableBrake * available);
  detail.brake = clamp((speed - targetSpeed) / Math.max(1.8, speed * 0.34), 0, 1);
  detail.throttleScale = targetSpeed > speed + 1.2
    ? clamp(approach.stopDistance / Math.max(1, lookAhead * 0.72), 0.18, 1)
    : 0;
  if (approach.stopDistance < 1.25) {
    detail.brake = Math.max(detail.brake, clamp(1.2 - approach.stopDistance * 0.28, 0.78, 1));
    detail.throttleScale = 0;
  }
  detail.stopped = speed < 0.32 && approach.stopDistance < 1.35;
  if (detail.stopped) detail.brake = 1;
  return detail;
}

function ackermannVisualAngle(vehicle, wheel) {
  if (!wheel.front) return 0;
  const steering = clamp(vehicle.state.steering, -1, 1);
  if (Math.abs(steering) < 1e-4) return 0;
  const style = VEHICLE_STYLES[vehicle.kind];
  const centerAngle = Math.abs(steering) * Math.min(0.56, finite(vehicle.state.maximumSteerAngle, 0.52));
  const wheelBase = Math.max(0.5, finite(vehicle.state.wheelBase, style.wheelBase));
  const track = style.width * 1.02;
  const turnRadius = wheelBase / Math.max(0.02, Math.tan(centerAngle));
  const steeringSide = Math.sign(steering);
  const inner = Math.atan(wheelBase / Math.max(0.22, turnRadius - track * 0.5));
  const outer = Math.atan(wheelBase / (turnRadius + track * 0.5));
  const angle = wheel.side === steeringSide ? inner : outer;
  return -steeringSide * angle;
}

function individualSnapshot(vehicle) {
  return Object.freeze({
    id: vehicle.id,
    kind: vehicle.kind,
    position: Object.freeze([vehicle.state.x, vehicle.root.position.y, vehicle.state.z]),
    yaw: vehicle.state.yaw,
    speed: vehicle.state.speed,
    health: vehicle.health,
    driver: vehicle.driver,
    police: vehicle.police,
    missionTarget: vehicle.missionTarget,
    authorized: vehicle.authorized,
    access: vehicle.access,
    displayName: vehicle.displayName,
    serviceRole: vehicle.serviceRole,
    roadsideRole: vehicle.roadsideRole,
    roadsideIncidentId: vehicle.roadsideIncidentId,
    roadsideTargetId: vehicle.roadsideTargetId,
    roadsideHeld: vehicle.roadsideHeld,
    roadsideResponding: vehicle.roadsideResponding,
    roadsideRepairing: vehicle.roadsideRepairing,
    roadsideHazards: vehicle.roadsideHazards,
    roadsideRouteMode: vehicle.roadsideRouteMode,
    roadsideWaypointCount: vehicle.roadsideWaypointCount,
    roadsideWaypointCursor: vehicle.roadsideWaypointCursor,
    roadsideNavigationAxis: vehicle.roadsideNavigationAxis,
    roadsideNavigationRoadId: vehicle.roadsideNavigationRoadId,
    roadsidePendingNavigationAxis: vehicle.roadsidePendingNavigationAxis,
    roadsidePendingNavigationRoadId: vehicle.roadsidePendingNavigationRoadId,
    roadsideTurnApproach: vehicle.roadsideTurnApproach,
    roadsideTurnDistance: vehicle.roadsideTurnDistance,
    roadsideTurnReach: vehicle.roadsideTurnReach,
    roadsideBeaconCount: vehicle.visual?.roadsideBeacons?.length ?? 0,
    visibleRoadsideBeacons: vehicle.visual?.roadsideBeacons?.reduce(
      (count, beacon) => count + Number(beacon.visible),
      0,
    ) ?? 0,
    transitService: vehicle.kind === "van" && vehicle.access === "pulse-line",
    transitVisualParts: vehicle.visual?.transitParts?.length ?? 0,
    visibleOccupants: vehicle.visual?.occupants?.reduce((count, occupant) => count + Number(occupant.visible), 0) ?? 0,
    visibleDrivers: vehicle.visual?.occupants?.reduce((count, occupant) =>
      count + Number(occupant.visible && (occupant.userData.driverOccupant || vehicle.driver === "police" && !occupant.userData.transitOccupant)), 0) ?? 0,
    taxiPassengerVisible: vehicle.visual?.occupants?.some(occupant =>
      occupant.userData.taxiPassenger && occupant.visible) ?? false,
    // Main's prewarmed twin-spot rig can own the controlled car's road throw.
    // Keep this public flag about visible lighting, not about which resident
    // SpotLight supplies it, so native diagnostics remain truthful.
    headlightsOn: Boolean(vehicle.visual?.headlightThrow?.intensity > 0.1 || vehicle.externalHeadlightsActive),
  });
}

export function createVehicleSystem({
  scene,
  world = {},
  input = null,
  onCrime = null,
  onImpact = null,
  externalPlayerHeadlights = false,
} = {}) {
  if (!scene?.add) throw new TypeError("createVehicleSystem requires a Three.js scene");
  const assets = createVisualAssets();
  const root = new THREE.Group();
  root.name = "Bounded procedural city vehicles";
  root.userData.rtxIgnore = true;
  root.userData.dynamicActor = true;
  scene.add(root);

  const routes = normalizeRoutes(world.roadRoutes ?? world.routes ?? world.roadLines, world);
  const intersections = buildIntersections(world.roads);
  root.userData.intersectionCount = intersections.length;
  const descriptors = spawnDescriptors(world, routes);
  const vehicles = [];
  const byId = new Map();
  let targetVehicle = null;
  let playerVehicle = null;
  let elapsed = 0;
  let disposed = false;
  let trafficLightLevel = 1;
  let taxiPassengerVehicleId = null;
  let lastPursuitTarget = null;
  const playerHeadlightsOwnedExternally = Boolean(externalPlayerHeadlights);
  const pursuitVelocity = { x: 0, z: 0 };

  for (let index = 0; index < descriptors.length; ++index) {
    const descriptor = descriptors[index];
    const kind = VEHICLE_STYLES[descriptor.kind] ? descriptor.kind : "sedan";
    const style = VEHICLE_STYLES[kind];
    let id = String(descriptor.id ?? `${kind}-${index + 1}`);
    if (byId.has(id)) id = `${id}-${index + 1}`;
    const open = findUnoccupiedSpawn(world, finite(descriptor.x), finite(descriptor.z), style.radius, vehicles);
    const police = Boolean(descriptor.police || kind === "police");
    const visual = buildVehicleVisual(assets, { ...descriptor, id, kind, police }, style);
    const mode = descriptor.mode === "parked" ? "parked" : police ? "police" : "traffic";
    const assignedRoute = routes[Math.abs(Math.trunc(finite(descriptor.routeSlot, index))) % routes.length];
    const patrolMaxSpeed = assignedRoute?.speedLimit > 0
      ? Math.min(style.maxSpeed, assignedRoute.speedLimit)
      : Math.min(style.maxSpeed, police ? 22 : style.maxSpeed);
    const vehicle = {
      id,
      kind,
      root: visual.root,
      visual,
      radius: style.radius,
      health: Math.max(1, finite(descriptor.health, style.health)),
      maxHealth: Math.max(1, finite(descriptor.health, style.health)),
      driver: mode === "traffic" ? "traffic" : mode === "police" ? "police" : null,
      police,
      missionTarget: Boolean(descriptor.missionTarget),
      authorized: Boolean(descriptor.authorized || descriptor.access === "pulse-line"),
      access: descriptor.access ? String(descriptor.access) : null,
      displayName: descriptor.displayName ? String(descriptor.displayName) : null,
      serviceRole: descriptor.serviceRole === ROADSIDE_SERVICE_ROLE ? ROADSIDE_SERVICE_ROLE : null,
      roadsideAmbientEligible: mode === "traffic" && !police && !descriptor.missionTarget &&
        descriptor.serviceRole !== ROADSIDE_SERVICE_ROLE && descriptor.access !== "pulse-line",
      aiMode: mode,
      route: assignedRoute,
      routeCursor: Math.max(0, Math.trunc(finite(descriptor.routeCursor, 1))),
      baseMaxSpeed: style.maxSpeed,
      patrolMaxSpeed,
      aiTemperament: 0.9 + deterministicUnit(id) * 0.16,
      followingDistance: Infinity,
      trafficControl: null,
      stoppedForSignal: false,
      stuckTime: 0,
      recoveryTime: 0,
      recoveryCooldown: 0,
      recoveryAttempts: 0,
      recoveryDirection: deterministicUnit(`${id}-recovery`) < 0.5 ? -1 : 1,
      recovering: false,
      signalPhase: deterministicUnit(`${id}-signal`) * Math.PI * 2,
      lastControls: { throttle: 0, reverse: 0, brake: 0, steer: 0, handbrake: false },
      roadsideIncidentId: 0,
      roadsideKind: null,
      roadsideRole: null,
      roadsideTargetId: null,
      roadsideHeld: false,
      roadsideResponding: false,
      roadsideRepairing: false,
      roadsideHazards: false,
      roadsideStandOffSide: deterministicUnit(`${id}-roadside-side`) < 0.5 ? -1 : 1,
      roadsideStandOffSign: -1,
      roadsideApproachPoint: { x: 0, z: 0 },
      roadsideWaypoints: [
        { x: 0, z: 0, nextAxis: null, nextRoadId: null, turnReach: 4.8 },
        { x: 0, z: 0, nextAxis: null, nextRoadId: null, turnReach: 4.8 },
      ],
      roadsideWaypointCount: 0,
      roadsideWaypointCursor: 0,
      roadsideRouteMode: "idle",
      roadsideNavigationAxis: null,
      roadsideNavigationRoadId: null,
      roadsidePendingNavigationAxis: null,
      roadsidePendingNavigationRoadId: null,
      roadsideTurnApproach: false,
      roadsideTurnDistance: Infinity,
      roadsideTurnReach: 4.8,
      roadsideControls: { throttle: 0, reverse: 0, brake: 0, steer: 0, handbrake: false },
      damagePulse: 0,
      externalHeadlightsActive: false,
      wheelAngle: 0,
      state: {
        x: open.x,
        z: open.z,
        yaw: wrapAngle(finite(descriptor.yaw)),
        speed: mode === "traffic" ? 4.5 + index % 3 : mode === "police" ? 5.5 : 0,
        steering: 0,
        lateralSpeed: 0,
        collisionCount: 0,
        radius: style.radius,
        wheelBase: style.wheelBase,
        maxSpeed: patrolMaxSpeed,
        maxReverseSpeed: kind === "van" ? 6.5 : 9,
        acceleration: style.acceleration,
        brakeDeceleration: police ? 22 : kind === "sports" ? 21 : 18,
        maximumSteerAngle: kind === "van" ? 0.48 : 0.56,
      },
      snapshot() { return individualSnapshot(vehicle); },
    };
    visual.root.userData.vehicle = vehicle;
    root.add(visual.root);
    vehicles.push(vehicle);
    byId.set(id, vehicle);
    if (vehicle.missionTarget && !targetVehicle) targetVehicle = vehicle;
  }
  targetVehicle ??= vehicles.find(vehicle => vehicle.kind === "sports") ?? vehicles[0] ?? null;
  if (targetVehicle) targetVehicle.missionTarget = true;

  function syncVisual(vehicle, delta, wantedStars = 0) {
    const sampledY = groundHeight(world, vehicle.state.x, vehicle.state.z);
    vehicle.visualGroundY = Number.isFinite(vehicle.visualGroundY)
      ? damp(vehicle.visualGroundY, sampledY, 18, Math.max(0, delta))
      : sampledY;
    vehicle.root.position.set(vehicle.state.x, vehicle.visualGroundY + 0.02, vehicle.state.z);
    vehicle.root.rotation.y = vehicle.state.yaw;
    const damageRatio = clamp(1 - vehicle.health / vehicle.maxHealth, 0, 1);
    const bodyPitch = finite(vehicle.state.bodyPitch);
    const bodyRoll = finite(vehicle.state.bodyRoll);
    const jolt = finite(vehicle.state.suspensionJolt);
    vehicle.visual.bodyRoot.position.y = -jolt * 0.42 - damageRatio * 0.025;
    vehicle.visual.bodyRoot.rotation.x = bodyPitch - (vehicle.health <= 0 ? 0.035 : 0);
    vehicle.visual.bodyRoot.rotation.z = bodyRoll + (vehicle.health <= 0 ? 0.045 : 0);
    const style = VEHICLE_STYLES[vehicle.kind];
    const wheelRadius = Math.max(0.1, style.wheelRadius);
    const groundSpin = -vehicle.state.speed * delta / wheelRadius;
    vehicle.wheelAngle = wrapAngle(vehicle.wheelAngle + groundSpin);
    for (const wheel of vehicle.visual.wheels) {
      let spinDelta = groundSpin;
      if (!wheel.front && vehicle.lastControls.handbrake && Math.abs(vehicle.state.speed) > 0.5) {
        spinDelta *= 0.06;
      } else if (!wheel.front) {
        const driveInput = clamp01(vehicle.lastControls.throttle) - clamp01(vehicle.lastControls.reverse);
        const launchSlip = Math.abs(driveInput) * clamp(1 - Math.abs(vehicle.state.speed) / 5, 0, 1) *
          (0.1 + Math.max(0, 1 - finite(vehicle.state.surfaceGrip, 1)) * 0.55);
        spinDelta -= Math.sign(driveInput) * launchSlip * delta * 7;
      }
      wheel.spinAngle = wrapAngle(finite(wheel.spinAngle) + spinDelta);
      wheel.spinRoot.rotation.x = wheel.spinAngle;
      wheel.steerRoot.rotation.y = ackermannVisualAngle(vehicle, wheel);
      const pitchTravel = (wheel.front ? -bodyPitch : bodyPitch) * 0.18;
      const rollTravel = wheel.side * bodyRoll * 0.12;
      wheel.steerRoot.position.y = wheel.baseY + clamp(pitchTravel + rollTravel - jolt * 0.28, -0.075, 0.065);
    }
    const braking = vehicle.health > 0 && Boolean(vehicle.state.brakeLights || vehicle.lastControls.brake > 0.08);
    for (const lamp of vehicle.visual.tailLights) {
      lamp.material.emissiveIntensity = braking ? 14 : 0.65 + trafficLightLevel * 4.15;
      lamp.scale.z = braking ? 0.071 : 0.055;
    }
    for (const lamp of vehicle.visual.reverseLights) lamp.visible = vehicle.health > 0 && Boolean(vehicle.state.reverseLights);
    const hazard = vehicle.health <= 0 || damageRatio > 0.82 || vehicle.roadsideHazards;
    const signalDirection = Math.abs(vehicle.state.steering) > 0.23 ? Math.sign(vehicle.state.steering) : 0;
    const signalFlash = Math.sin(elapsed * 6.2 + vehicle.signalPhase) > -0.12;
    for (const signal of vehicle.visual.turnSignals) {
      signal.mesh.visible = signalFlash && (hazard || vehicle !== playerVehicle && signal.side === signalDirection);
    }
    const sirenActive = vehicle.police && wantedStars > 0 && vehicle.health > 0;
    for (const occupant of vehicle.visual.occupants) {
      occupant.visible = vehicle.health > 0 && (occupant.userData.transitOccupant
        ? vehicle.kind === "van" && vehicle.access === "pulse-line"
        : occupant.userData.taxiPassenger
          ? vehicle.id === taxiPassengerVehicleId
          : occupant.userData.driverOccupant
            ? Boolean(vehicle.driver)
            : occupant.userData.ambientPassenger
              ? vehicle.driver === "traffic"
              : vehicle.driver === "police");
      occupant.rotation.z = bodyRoll * -0.26;
      occupant.rotation.x = -0.08 + bodyPitch * 0.2;
    }
    const emergencyTime = (elapsed * 7.8 + vehicle.signalPhase) % 4;
    for (const beacon of vehicle.visual.emergencyLights) {
      const channel = beacon.userData.flashChannel ?? 0;
      const localTime = (emergencyTime + (beacon.userData.flashRole === "rear" ? 0.09 : 0)) % 4;
      const flash = channel === 0
        ? localTime < 0.34 || localTime > 0.58 && localTime < 0.88
        : localTime > 2 && localTime < 2.34 || localTime > 2.58 && localTime < 2.88;
      beacon.visible = sirenActive && flash;
      beacon.scale.y = finite(beacon.userData.baseScaleY, 0.1) * (flash ? 1.16 : 0.72);
    }
    const roadsideActive = vehicle.serviceRole === ROADSIDE_SERVICE_ROLE &&
      vehicle.roadsideResponding && vehicle.health > 0;
    const amberTime = (elapsed * 6.4 + vehicle.signalPhase) % 2;
    for (const beacon of vehicle.visual.roadsideBeacons) {
      const channel = beacon.userData.flashChannel ?? 0;
      const flash = channel === 0
        ? amberTime < 0.24 || amberTime > 0.42 && amberTime < 0.68
        : amberTime > 1 && amberTime < 1.24 || amberTime > 1.42 && amberTime < 1.68;
      beacon.visible = roadsideActive && flash;
      beacon.scale.y = finite(beacon.userData.baseScaleY, 0.1) * (flash ? 1.14 : 0.76);
    }
    vehicle.visual.damagePanel.visible = damageRatio > 0.28;
    vehicle.visual.damagePanel.scale.x = VEHICLE_STYLES[vehicle.kind].width * (0.44 + damageRatio * 0.18);
    vehicle.visual.hood.rotation.x = damageRatio > 0.35 ? -Math.min(0.13, (damageRatio - 0.35) * 0.19) : 0;
    vehicle.visual.frontIntake.rotation.z = damageRatio * 0.055;
    vehicle.visual.frontIntake.position.y = VEHICLE_STYLES[vehicle.kind].wheelRadius + 0.25 - damageRatio * 0.055;
    const wigWagIndex = Math.sin(elapsed * 10.5 + vehicle.signalPhase) >= 0 ? 0 : 1;
    const lowBeamDemand = Math.max(trafficLightLevel, sirenActive ? 0.48 : 0);
    for (let index = 0; index < vehicle.visual.headlights.length; ++index) {
      const healthy = vehicle.health > 0 && !(damageRatio > 0.68 && index === 1);
      vehicle.visual.headlights[index].visible = healthy && lowBeamDemand > 0.025 && (!sirenActive || index === wigWagIndex);
    }
    const externalPlayerThrow = playerHeadlightsOwnedExternally && vehicle === playerVehicle;
    vehicle.visual.headlightThrow.intensity = !externalPlayerThrow && vehicle.health > 0 && lowBeamDemand > 0.025
      ? (18 + lowBeamDemand * (vehicle === playerVehicle ? 210 : 152)) * (1 - damageRatio * 0.76)
      : 0;
    if (vehicle.visual.missionMarker) {
      vehicle.visual.missionMarker.visible = vehicle.health > 0;
      const pulse = 1.38 + Math.sin(elapsed * 3.5) * 0.14;
      vehicle.visual.missionMarker.scale.setScalar(pulse);
      vehicle.visual.missionMarker.rotation.z += delta * 0.8;
    }
    vehicle.damagePulse = Math.max(0, vehicle.damagePulse - Math.max(0, delta) * 2.6);
    vehicle.root.userData.destroyed = vehicle.health <= 0;
    vehicle.root.userData.damage = damageRatio;
    vehicle.root.userData.emergencyActive = sirenActive;
    vehicle.root.userData.recovering = vehicle.recovering;
    vehicle.root.userData.roadsideServiceRole = vehicle.serviceRole;
    vehicle.root.userData.roadsideRole = vehicle.roadsideRole;
    vehicle.root.userData.roadsideIncidentId = vehicle.roadsideIncidentId;
    vehicle.root.userData.roadsideActive = vehicle.roadsideHeld || vehicle.roadsideResponding;
    vehicle.root.userData.roadsideRouteMode = vehicle.roadsideRouteMode;
    vehicle.root.userData.roadsideWaypointCount = vehicle.roadsideWaypointCount;
    vehicle.root.userData.roadsideWaypointCursor = vehicle.roadsideWaypointCursor;
  }

  function fireImpact(detail) {
    if (typeof onImpact !== "function") return;
    try { onImpact(detail); } catch { /* Host callbacks cannot break simulation. */ }
  }

  function separateVehicles() {
    for (let first = 0; first < vehicles.length; ++first) {
      const a = vehicles[first];
      if (a.health <= 0) continue;
      for (let second = first + 1; second < vehicles.length; ++second) {
        const b = vehicles[second];
        if (b.health <= 0) continue;
        let dx = b.state.x - a.state.x;
        let dz = b.state.z - a.state.z;
        const minimum = (a.radius + b.radius) * 0.88;
        let distance = Math.hypot(dx, dz);
        if (distance >= minimum) continue;
        if (distance < 1e-5) {
          const sign = (first + second) % 2 ? -1 : 1;
          dx = sign;
          dz = 0;
          distance = 1;
        }
        const normalX = dx / distance;
        const normalZ = dz / distance;
        const overlap = minimum - distance;
        const mobilityA = a.aiMode === "parked" && a.driver !== "player" ? 0.22 : 1;
        const mobilityB = b.aiMode === "parked" && b.driver !== "player" ? 0.22 : 1;
        const total = mobilityA + mobilityB;
        const aX = a.state.x - normalX * overlap * mobilityA / total;
        const aZ = a.state.z - normalZ * overlap * mobilityA / total;
        const bX = b.state.x + normalX * overlap * mobilityB / total;
        const bZ = b.state.z + normalZ * overlap * mobilityB / total;
        if (!blockedCircle(world, aX, aZ, a.radius)) { a.state.x = aX; a.state.z = aZ; }
        if (!blockedCircle(world, bX, bZ, b.radius)) { b.state.x = bX; b.state.z = bZ; }
        const aForwardX = -Math.sin(a.state.yaw);
        const aForwardZ = -Math.cos(a.state.yaw);
        const aRightX = Math.cos(a.state.yaw);
        const aRightZ = -Math.sin(a.state.yaw);
        const bForwardX = -Math.sin(b.state.yaw);
        const bForwardZ = -Math.cos(b.state.yaw);
        const bRightX = Math.cos(b.state.yaw);
        const bRightZ = -Math.sin(b.state.yaw);
        const relativeX = aForwardX * a.state.speed + aRightX * a.state.lateralSpeed -
          bForwardX * b.state.speed - bRightX * b.state.lateralSpeed;
        const relativeZ = aForwardZ * a.state.speed + aRightZ * a.state.lateralSpeed -
          bForwardZ * b.state.speed - bRightZ * b.state.lateralSpeed;
        const impact = Math.max(0, relativeX * normalX + relativeZ * normalZ);
        a.state.speed *= 0.72;
        b.state.speed *= 0.72;
        a.state.lateralSpeed *= 0.55;
        b.state.lateralSpeed *= 0.55;
        a.state.collisionCount += 1;
        b.state.collisionCount += 1;
        if (impact > 2.5) fireImpact({ type: "vehicle", vehicle: a, other: b, speed: impact });
        if (impact > 7) {
          damage(a, Math.min(12, (impact - 7) * 0.38));
          damage(b, Math.min(12, (impact - 7) * 0.38));
        }
      }
    }
  }

  function playerControls(vehicle) {
    const forward = actionDown(input, "forward");
    const backward = actionDown(input, "backward");
    return {
      throttle: forward ? 1 : 0,
      reverse: backward && vehicle.state.speed <= 0.35 ? 1 : 0,
      brake: backward && vehicle.state.speed > 0.35 ? 1 : 0,
      steer: Number(actionDown(input, "right")) - Number(actionDown(input, "left")),
      handbrake: actionDown(input, "handbrake"),
    };
  }

  function updateVehicle(vehicle, delta, context) {
    if (vehicle.health <= 0) {
      vehicle.lastControls = { throttle: 0, reverse: 0, brake: 0, steer: 0, handbrake: false };
      vehicle.trafficControl = null;
      vehicle.stoppedForSignal = false;
      vehicle.stuckTime = 0;
      vehicle.recoveryTime = 0;
      vehicle.recovering = false;
      vehicle.state.speed = damp(vehicle.state.speed, 0, 4, delta);
      vehicle.state.lateralSpeed = damp(vehicle.state.lateralSpeed, 0, 4, delta);
      syncVisual(vehicle, delta, context.wantedStars);
      return;
    }
    vehicle.recoveryCooldown = Math.max(0, vehicle.recoveryCooldown - delta);
    const recoveryActive = vehicle !== playerVehicle && vehicle.recoveryTime > 0;
    if (recoveryActive) vehicle.recoveryTime = Math.max(0, vehicle.recoveryTime - delta);
    let controls = { throttle: 0, brake: 0.25, steer: 0 };
    let autonomous = false;
    let emergencyBypass = false;
    if (recoveryActive) {
      autonomous = true;
      vehicle.recovering = true;
      const reversingPhase = vehicle.recoveryTime > 0.72;
      if (reversingPhase) {
        const mustStopForwardMotion = vehicle.state.speed > 0.28;
        controls = {
          throttle: 0,
          reverse: mustStopForwardMotion ? 0 : 0.68,
          brake: mustStopForwardMotion ? 1 : 0,
          steer: vehicle.recoveryDirection,
          handbrake: false,
        };
      } else {
        const mustStopReverseMotion = vehicle.state.speed < -0.28;
        controls = {
          throttle: mustStopReverseMotion ? 0 : 0.48,
          reverse: 0,
          brake: mustStopReverseMotion ? 1 : 0,
          steer: -vehicle.recoveryDirection * 0.58,
          handbrake: false,
        };
      }
    } else if (vehicle === playerVehicle) {
      vehicle.recovering = false;
      vehicle.stuckTime = 0;
      vehicle.recoveryTime = 0;
      vehicle.state.maxSpeed = vehicle.baseMaxSpeed;
      controls = playerControls(vehicle);
    } else if (vehicle.roadsideHeld) {
      vehicle.recovering = false;
      vehicle.stuckTime = 0;
      vehicle.recoveryTime = 0;
      vehicle.followingDistance = Infinity;
      vehicle.state.maxSpeed = vehicle.patrolMaxSpeed;
      controls = vehicle.roadsideControls;
      controls.throttle = 0;
      controls.reverse = 0;
      controls.brake = 1;
      controls.steer = 0;
      controls.handbrake = Math.abs(vehicle.state.speed) < 0.28;
    } else if (vehicle.roadsideResponding) {
      vehicle.recovering = false;
      vehicle.recoveryTime = 0;
      vehicle.followingDistance = Infinity;
      vehicle.state.maxSpeed = Math.min(vehicle.patrolMaxSpeed, 18);
      controls = vehicle.roadsideControls;
      const roadsideTarget = byId.get(vehicle.roadsideTargetId);
      if (!roadsideTarget || roadsideTarget === playerVehicle || vehicle.roadsideRepairing) {
        controls.throttle = 0;
        controls.reverse = 0;
        controls.brake = 1;
        controls.steer = 0;
        controls.handbrake = Math.abs(vehicle.state.speed) < 0.28;
      } else {
        autonomous = true;
        writeRoadsideDestination(vehicle, roadsideTarget);
        desiredControls(vehicle, vehicle.roadsideApproachPoint, false, controls);
        if (vehicle.roadsideTurnApproach &&
            vehicle.roadsideTurnDistance < vehicle.roadsideTurnReach + 18) {
          const turnSpeed = clamp(
            3.1 + (vehicle.roadsideTurnDistance - vehicle.roadsideTurnReach) * 0.28,
            3.1,
            6.8,
          );
          const overspeed = Math.max(0, Math.abs(vehicle.state.speed) - turnSpeed);
          if (overspeed > 0) {
            controls.throttle = 0;
            controls.brake = Math.max(controls.brake, clamp(overspeed / 4.5, 0, 0.92));
          }
        }
        const approachDistance = Math.hypot(
          vehicle.roadsideApproachPoint.x - vehicle.state.x,
          vehicle.roadsideApproachPoint.z - vehicle.state.z,
        );
        if (approachDistance < 1.75) {
          controls.throttle = 0;
          controls.brake = Math.max(controls.brake, 0.9);
          controls.handbrake = Math.abs(vehicle.state.speed) < 0.28;
        }
      }
    } else if (vehicle.police && context.wantedStars > 0 && context.targetPosition) {
      vehicle.recovering = false;
      autonomous = true;
      emergencyBypass = true;
      vehicle.state.maxSpeed = vehicle.baseMaxSpeed;
      const pursuitDistance = Math.hypot(
        context.targetPosition.x - vehicle.state.x,
        context.targetPosition.z - vehicle.state.z,
      );
      const leadTime = clamp(pursuitDistance / Math.max(12, vehicle.baseMaxSpeed * 1.35), 0.12, 1.25);
      controls = desiredControls(vehicle, {
        x: context.targetPosition.x + context.targetVelocity.x * leadTime,
        z: context.targetPosition.z + context.targetVelocity.z * leadTime,
      }, true);
    } else if (vehicle.aiMode === "traffic" || vehicle.aiMode === "police") {
      vehicle.recovering = false;
      autonomous = true;
      vehicle.state.maxSpeed = vehicle.patrolMaxSpeed;
      controls = desiredControls(vehicle, routeTarget(vehicle), false);
      const awareness = trafficAwareness(vehicle, vehicles);
      vehicle.followingDistance = awareness.gap;
      controls.throttle *= awareness.throttleScale;
      controls.brake = Math.max(controls.brake, awareness.brake);
    }
    vehicle.trafficControl = autonomous && !recoveryActive
      ? intersectionControls(vehicle, intersections, vehicles, elapsed, emergencyBypass)
      : null;
    vehicle.stoppedForSignal = Boolean(vehicle.trafficControl?.stopped);
    if (vehicle.trafficControl?.active) {
      controls.throttle *= vehicle.trafficControl.throttleScale;
      controls.brake = Math.max(controls.brake, vehicle.trafficControl.brake);
      if (vehicle.trafficControl.stopped) controls.handbrake = false;
    }
    vehicle.lastControls = { ...controls };
    const before = vehicle.state;
    vehicle.state = stepVehiclePhysics(vehicle.state, controls, delta, world);
    const progress = Math.hypot(vehicle.state.x - before.x, vehicle.state.z - before.z);
    const queuedBehindTraffic = Number.isFinite(vehicle.followingDistance) && vehicle.followingDistance < 4.2;
    const heldBySignal = Boolean(vehicle.trafficControl?.active &&
      vehicle.trafficControl.signal !== "green" && vehicle.trafficControl.throttleScale <= 0.01);
    const requestingProgress = controls.throttle > 0.16 && controls.brake < 0.35;
    if (autonomous && !recoveryActive && vehicle.recoveryCooldown <= 0 && requestingProgress &&
        !queuedBehindTraffic && !heldBySignal && Math.abs(vehicle.state.speed) < 0.58 && progress < 0.025) {
      vehicle.stuckTime += delta + (vehicle.state.collided ? 0.008 : 0);
    } else if (!recoveryActive) {
      vehicle.stuckTime = Math.max(0, vehicle.stuckTime - delta * 1.8);
    }
    if (!recoveryActive && vehicle.stuckTime > 1.75) {
      const baseDirection = deterministicUnit(`${vehicle.id}-recovery`) < 0.5 ? -1 : 1;
      vehicle.recoveryDirection = vehicle.recoveryAttempts % 2 === 0 ? baseDirection : -baseDirection;
      vehicle.recoveryAttempts += 1;
      vehicle.recoveryTime = 2.2;
      vehicle.recoveryCooldown = 9;
      vehicle.stuckTime = 0;
      vehicle.recovering = true;
    }
    if (recoveryActive && vehicle.recoveryTime <= 0) vehicle.recovering = false;
    if (vehicle.state.collided && vehicle.state.impactSpeed > 2.5) {
      fireImpact({
        type: "world",
        vehicle,
        speed: vehicle.state.impactSpeed,
        position: { x: vehicle.state.x, z: vehicle.state.z },
        previous: { x: before.x, z: before.z },
      });
      if (vehicle.state.impactSpeed > 8) {
        damage(vehicle, Math.min(18, (vehicle.state.impactSpeed - 8) * 0.48));
      }
    }
    syncVisual(vehicle, delta, context.wantedStars);
  }

  function get(id) {
    if (id && typeof id === "object" && id.id) return byId.get(String(id.id)) ?? null;
    return byId.get(String(id ?? "")) ?? null;
  }

  function roadsideVehicle(id) {
    if (typeof id === "string") return byId.get(id) ?? null;
    if (Number.isFinite(id)) return byId.get(String(id)) ?? null;
    return null;
  }

  function resetRoadsideRoute(vehicle, mode = "direct-fallback") {
    vehicle.roadsideWaypointCount = 0;
    vehicle.roadsideWaypointCursor = 0;
    vehicle.roadsideRouteMode = mode;
    vehicle.roadsideNavigationAxis = normalizedRouteAxis(vehicle.route);
    vehicle.roadsideNavigationRoadId = vehicle.route?.roadId ?? null;
    vehicle.roadsidePendingNavigationAxis = null;
    vehicle.roadsidePendingNavigationRoadId = null;
    vehicle.roadsideTurnApproach = false;
    vehicle.roadsideTurnDistance = Infinity;
    vehicle.roadsideTurnReach = 4.8;
    for (const waypoint of vehicle.roadsideWaypoints) {
      waypoint.x = 0;
      waypoint.z = 0;
      waypoint.nextAxis = null;
      waypoint.nextRoadId = null;
      waypoint.turnReach = 4.8;
    }
  }

  function turnInitiationReach(incomingAxis, incomingDirection, outgoingAxis, outgoingDirection) {
    if (!incomingDirection || !outgoingDirection || incomingAxis === outgoingAxis) return 4.8;
    const incomingX = incomingAxis === "x" ? incomingDirection : 0;
    const incomingZ = incomingAxis === "z" ? incomingDirection : 0;
    const outgoingX = outgoingAxis === "x" ? outgoingDirection : 0;
    const outgoingZ = outgoingAxis === "z" ? outgoingDirection : 0;
    const cross = incomingX * outgoingZ - incomingZ * outgoingX;
    return cross > 0 ? 7.8 : 3.4;
  }

  function setRoadsideWaypoint(vehicle, index, x, z, nextAxis, nextRoadId, turnReach = 4.8) {
    const waypoint = vehicle.roadsideWaypoints[index];
    waypoint.x = x;
    waypoint.z = z;
    waypoint.nextAxis = nextAxis;
    waypoint.nextRoadId = nextRoadId ?? null;
    waypoint.turnReach = turnReach;
  }

  function chooseRoadsideStandOffSign(responder, target, targetAxis) {
    const reference = responder.roadsideWaypointCount > 0
      ? responder.roadsideWaypoints[responder.roadsideWaypointCount - 1]
      : responder.state;
    const forwardX = -Math.sin(target.state.yaw);
    const forwardZ = -Math.cos(target.state.yaw);
    const projection = (reference.x - target.state.x) * forwardX +
      (reference.z - target.state.z) * forwardZ;
    responder.roadsideStandOffSign = Math.abs(projection) < 0.1
      ? responder.roadsideStandOffSide
      : Math.sign(projection);
  }

  /**
   * Builds at most two Manhattan turns entirely into responder-owned storage.
   * Parallel roads use one authored perpendicular lane as a connector;
   * perpendicular roads need only their shared junction. Same-road incidents
   * retain the direct approach used by the ordinary traffic model.
   */
  function planRoadsideRoute(responder, target) {
    resetRoadsideRoute(responder);
    const responderRoute = responder.route;
    const targetRoute = target.route;
    const responderAxis = normalizedRouteAxis(responderRoute);
    const targetAxis = normalizedRouteAxis(targetRoute);
    if (!responderAxis || !targetAxis) {
      chooseRoadsideStandOffSign(responder, target, targetAxis);
      return;
    }

    const sameRoad = responderRoute === targetRoute ||
      responderRoute?.roadId && responderRoute.roadId === targetRoute?.roadId;
    if (sameRoad) {
      responder.roadsideRouteMode = "direct-same-road";
      responder.roadsideNavigationAxis = targetAxis;
      responder.roadsideNavigationRoadId = targetRoute?.roadId ?? null;
      chooseRoadsideStandOffSign(responder, target, targetAxis);
      return;
    }

    const responderLane = routeLaneCoordinate(responderRoute, responderAxis);
    const targetLane = routeLaneCoordinate(targetRoute, targetAxis);
    // Spawn staggering can place a two-point route actor on its return leg.
    // Its current yaw is therefore authoritative; the route's authored
    // direction describes the lane, not necessarily this live traversal.
    const responderDirection = currentVehicleRouteDirection(responder, responderAxis);
    const targetDirection = currentVehicleRouteDirection(target, targetAxis);
    if (responderAxis !== targetAxis) {
      const intersectionX = responderAxis === "z" ? responderLane : targetLane;
      const intersectionZ = responderAxis === "x" ? responderLane : targetLane;
      const responderAlong = responderAxis === "x" ? intersectionX : intersectionZ;
      const targetAlong = targetAxis === "x" ? intersectionX : intersectionZ;
      if (routeCoversCoordinate(responderRoute, responderAxis, responderAlong) &&
          routeCoversCoordinate(targetRoute, targetAxis, targetAlong)) {
        setRoadsideWaypoint(
          responder,
          0,
          intersectionX,
          intersectionZ,
          targetAxis,
          targetRoute?.roadId ?? null,
          turnInitiationReach(responderAxis, responderDirection, targetAxis, targetDirection),
        );
        responder.roadsideWaypointCount = 1;
        responder.roadsideRouteMode = "perpendicular-grid";
      }
      chooseRoadsideStandOffSign(responder, target, targetAxis);
      return;
    }

    const connectorAxis = responderAxis === "x" ? "z" : "x";
    const responderAlong = responderAxis === "x" ? responder.state.x : responder.state.z;
    const targetAlong = targetAxis === "x" ? target.state.x : target.state.z;
    const desiredConnectorDirection = Math.sign(targetLane - responderLane);
    let connector = null;
    let connectorCoordinate = 0;
    let bestCost = Infinity;
    for (const candidate of routes) {
      if (normalizedRouteAxis(candidate) !== connectorAxis) continue;
      if (!routeCoversCoordinate(candidate, connectorAxis, responderLane) ||
          !routeCoversCoordinate(candidate, connectorAxis, targetLane)) continue;
      const coordinate = routeLaneCoordinate(candidate, connectorAxis);
      if (!routeCoversCoordinate(responderRoute, responderAxis, coordinate) ||
          !routeCoversCoordinate(targetRoute, targetAxis, coordinate)) continue;
      let cost = Math.abs(coordinate - responderAlong) + Math.abs(targetAlong - coordinate);
      const candidateDirection = normalizedRouteDirection(candidate, connectorAxis);
      if (candidateDirection && desiredConnectorDirection && candidateDirection !== desiredConnectorDirection) {
        cost += 80;
      }
      if (responderDirection && (coordinate - responderAlong) * responderDirection < -1) {
        cost += 48 + Math.abs(coordinate - responderAlong) * 1.5;
      }
      if (targetDirection && (targetAlong - coordinate) * targetDirection < -1) {
        cost += 32 + Math.abs(targetAlong - coordinate);
      }
      if (cost + EPSILON >= bestCost) continue;
      connector = candidate;
      connectorCoordinate = coordinate;
      bestCost = cost;
    }
    if (connector) {
      const connectorDirection = normalizedRouteDirection(connector, connectorAxis);
      const firstTurnReach = turnInitiationReach(
        responderAxis,
        responderDirection,
        connectorAxis,
        connectorDirection,
      );
      const secondTurnReach = turnInitiationReach(
        connectorAxis,
        connectorDirection,
        targetAxis,
        targetDirection,
      );
      if (responderAxis === "z") {
        setRoadsideWaypoint(
          responder,
          0,
          responderLane,
          connectorCoordinate,
          connectorAxis,
          connector.roadId ?? null,
          firstTurnReach,
        );
        setRoadsideWaypoint(
          responder,
          1,
          targetLane,
          connectorCoordinate,
          targetAxis,
          targetRoute?.roadId ?? null,
          secondTurnReach,
        );
      } else {
        setRoadsideWaypoint(
          responder,
          0,
          connectorCoordinate,
          responderLane,
          connectorAxis,
          connector.roadId ?? null,
          firstTurnReach,
        );
        setRoadsideWaypoint(
          responder,
          1,
          connectorCoordinate,
          targetLane,
          targetAxis,
          targetRoute?.roadId ?? null,
          secondTurnReach,
        );
      }
      responder.roadsideWaypointCount = 2;
      responder.roadsideRouteMode = "parallel-grid";
    }
    chooseRoadsideStandOffSign(responder, target, targetAxis);
  }

  function writeRoadsideDestination(responder, target) {
    responder.roadsideTurnApproach = false;
    responder.roadsideTurnDistance = Infinity;
    if (responder.roadsidePendingNavigationAxis) {
      const outgoingAlignment = responder.roadsidePendingNavigationAxis === "x"
        ? Math.abs(Math.sin(responder.state.yaw))
        : Math.abs(Math.cos(responder.state.yaw));
      if (outgoingAlignment > 0.82) {
        responder.roadsideNavigationAxis = responder.roadsidePendingNavigationAxis;
        responder.roadsideNavigationRoadId = responder.roadsidePendingNavigationRoadId;
        responder.roadsidePendingNavigationAxis = null;
        responder.roadsidePendingNavigationRoadId = null;
      }
    }
    while (responder.roadsideWaypointCursor < responder.roadsideWaypointCount) {
      const waypoint = responder.roadsideWaypoints[responder.roadsideWaypointCursor];
      const distance = Math.hypot(waypoint.x - responder.state.x, waypoint.z - responder.state.z);
      const turnReach = waypoint.turnReach;
      if (distance > turnReach) {
        responder.roadsideApproachPoint.x = waypoint.x;
        responder.roadsideApproachPoint.z = waypoint.z;
        responder.roadsideTurnApproach = true;
        responder.roadsideTurnDistance = distance;
        responder.roadsideTurnReach = turnReach;
        return responder.roadsideApproachPoint;
      }
      responder.roadsideWaypointCursor += 1;
      responder.roadsidePendingNavigationAxis = waypoint.nextAxis;
      responder.roadsidePendingNavigationRoadId = waypoint.nextRoadId;
    }

    const targetAxis = normalizedRouteAxis(target.route);
    const targetDirection = currentVehicleRouteDirection(target, targetAxis);
    let forwardX = -Math.sin(target.state.yaw);
    let forwardZ = -Math.cos(target.state.yaw);
    if (targetDirection && targetAxis === "x") {
      forwardX = targetDirection;
      forwardZ = 0;
    } else if (targetDirection && targetAxis === "z") {
      forwardX = 0;
      forwardZ = targetDirection;
    }
    const clearance = responder.radius + target.radius + 0.82;
    responder.roadsideApproachPoint.x = target.state.x +
      forwardX * clearance * responder.roadsideStandOffSign;
    responder.roadsideApproachPoint.z = target.state.z +
      forwardZ * clearance * responder.roadsideStandOffSign;
    return responder.roadsideApproachPoint;
  }

  function canBeRoadsideTarget(vehicle, playerX, playerZ, minimumSquared, maximumSquared) {
    if (!vehicle || !vehicle.roadsideAmbientEligible || vehicle.health <= 0 || vehicle === playerVehicle ||
        vehicle.driver !== "traffic" ||
        vehicle.aiMode !== "traffic" || vehicle.police || vehicle.missionTarget || vehicle.roadsideIncidentId > 0 ||
        vehicle.serviceRole || vehicle.access === "pulse-line") return false;
    const dx = vehicle.state.x - playerX;
    const dz = vehicle.state.z - playerZ;
    const distanceSquared = dx * dx + dz * dz;
    return distanceSquared >= minimumSquared && distanceSquared <= maximumSquared;
  }

  /**
   * Selects one normal moving civilian without building a candidate array.
   * The ordinal is stable against frame timing and wraps over the eligible
   * vehicles in their authored spawn order.
   */
  function selectRoadsideTarget(playerX, playerZ, minimumDistance = 0, maximumDistance = Infinity, ordinal = 1) {
    if (disposed) return null;
    const x = finite(playerX);
    const z = finite(playerZ);
    const minimum = Math.max(0, finite(minimumDistance));
    const suppliedMaximum = Number(maximumDistance);
    const maximum = Number.isFinite(suppliedMaximum) ? Math.max(minimum, suppliedMaximum) : Infinity;
    const minimumSquared = minimum * minimum;
    const maximumSquared = maximum * maximum;
    let count = 0;
    for (const vehicle of vehicles) {
      if (canBeRoadsideTarget(vehicle, x, z, minimumSquared, maximumSquared)) count += 1;
    }
    if (count === 0) return null;
    const requested = Math.max(1, Math.abs(Math.trunc(finite(ordinal, 1))));
    let selectedIndex = (requested - 1) % count;
    for (const vehicle of vehicles) {
      if (!canBeRoadsideTarget(vehicle, x, z, minimumSquared, maximumSquared)) continue;
      if (selectedIndex === 0) return vehicle.id;
      selectedIndex -= 1;
    }
    return null;
  }

  /** Writes the coordinator status contract into its borrowed output object. */
  function roadsideStatus(id, output) {
    if (!output || typeof output !== "object") return false;
    const vehicle = disposed ? null : roadsideVehicle(id);
    if (!vehicle) {
      output.available = false;
      output.playerControlled = false;
      output.x = 0;
      output.z = 0;
      output.speed = 0;
      return false;
    }
    output.available = vehicle.health > 0 || vehicle.roadsideRole === "target" ||
      vehicle.roadsideAmbientEligible && vehicle.driver !== "player";
    output.playerControlled = vehicle === playerVehicle || vehicle.driver === "player";
    output.x = vehicle.state.x;
    output.z = vehicle.state.z;
    output.speed = vehicle.state.speed;
    return true;
  }

  function releaseRoadsideVehicle(vehicle, incidentId, repairTarget, kind) {
    if (!vehicle || vehicle.roadsideIncidentId !== incidentId) return false;
    const wasTarget = vehicle.roadsideRole === "target";
    if (repairTarget && wasTarget) {
      const roadworthyRatio = kind === "collision" ? 0.62 : 0.38;
      vehicle.health = Math.max(vehicle.health, vehicle.maxHealth * roadworthyRatio);
      vehicle.damagePulse = 0;
    }
    vehicle.roadsideIncidentId = 0;
    vehicle.roadsideKind = null;
    vehicle.roadsideRole = null;
    vehicle.roadsideTargetId = null;
    vehicle.roadsideHeld = false;
    vehicle.roadsideResponding = false;
    vehicle.roadsideRepairing = false;
    vehicle.roadsideHazards = false;
    vehicle.roadsidePendingNavigationAxis = null;
    vehicle.roadsidePendingNavigationRoadId = null;
    vehicle.stuckTime = 0;
    vehicle.recoveryTime = 0;
    vehicle.recoveryCooldown = Math.max(vehicle.recoveryCooldown, 1.5);
    vehicle.recovering = false;
    if (vehicle !== playerVehicle && vehicle.health > 0) {
      if (repairTarget && wasTarget && vehicle.roadsideAmbientEligible) {
        vehicle.driver = "traffic";
        vehicle.aiMode = "traffic";
      }
      if (vehicle.driver === "traffic") {
        vehicle.aiMode = "traffic";
        vehicle.state.maxSpeed = vehicle.patrolMaxSpeed;
      }
    }
    return true;
  }

  /**
   * Edge-command adapter used by roadside-response.mjs. Calls mutate only
   * preallocated vehicle state; all visual resources already exist.
   */
  function roadsideCommand(action, incidentValue, targetId, responderId, requestedKind = "breakdown") {
    if (disposed) return action === ROADSIDE_DISPATCH ? null : false;
    const incidentId = Math.max(1, Math.trunc(finite(incidentValue, 1)));
    const kind = requestedKind === "collision" ? "collision" : "breakdown";
    const target = roadsideVehicle(targetId);

    if (action === ROADSIDE_HOLD) {
      const activeTraffic = target?.health > 0 && target.driver === "traffic" && target.aiMode === "traffic";
      const collisionWreck = kind === "collision" && target?.roadsideAmbientEligible && target.health <= 0 &&
        target.driver !== "player";
      if (!target || target === playerVehicle || !target.roadsideAmbientEligible ||
          !activeTraffic && !collisionWreck || target.police || target.missionTarget || target.serviceRole ||
          target.access === "pulse-line") return false;
      if (target.roadsideIncidentId > 0) return target.roadsideIncidentId === incidentId && target.roadsideHeld;
      target.roadsideIncidentId = incidentId;
      target.roadsideKind = kind;
      target.roadsideRole = "target";
      target.roadsideTargetId = null;
      target.roadsideHeld = true;
      target.roadsideResponding = false;
      target.roadsideRepairing = false;
      target.roadsideHazards = true;
      target.stuckTime = 0;
      target.recoveryTime = 0;
      target.recoveryCooldown = Math.max(target.recoveryCooldown, 1.5);
      target.recovering = false;
      return true;
    }

    if (action === ROADSIDE_DISPATCH) {
      if (!target || target.roadsideIncidentId !== incidentId || !target.roadsideHeld) return null;
      let responder = roadsideVehicle(responderId);
      if (responder?.roadsideIncidentId === incidentId && responder.roadsideResponding) return responder.id;
      if (!responder || responder.serviceRole !== ROADSIDE_SERVICE_ROLE || responder.health <= 0 ||
          responder === playerVehicle || responder.roadsideIncidentId > 0 || responder.driver !== "traffic") {
        responder = null;
        let nearestDistanceSquared = Infinity;
        for (const candidate of vehicles) {
          if (candidate.serviceRole !== ROADSIDE_SERVICE_ROLE || candidate.health <= 0 ||
              candidate === playerVehicle || candidate.roadsideIncidentId > 0 ||
              candidate.driver !== "traffic" || candidate.aiMode !== "traffic") continue;
          const dx = candidate.state.x - target.state.x;
          const dz = candidate.state.z - target.state.z;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared + EPSILON >= nearestDistanceSquared) continue;
          responder = candidate;
          nearestDistanceSquared = distanceSquared;
        }
      }
      if (!responder) return null;
      responder.roadsideIncidentId = incidentId;
      responder.roadsideKind = kind;
      responder.roadsideRole = "responder";
      responder.roadsideTargetId = target.id;
      responder.roadsideHeld = false;
      responder.roadsideResponding = true;
      responder.roadsideRepairing = false;
      responder.roadsideHazards = true;
      responder.stuckTime = 0;
      responder.recoveryTime = 0;
      responder.recoveryCooldown = Math.max(responder.recoveryCooldown, 1.5);
      responder.recovering = false;
      planRoadsideRoute(responder, target);
      return responder.id;
    }

    const responder = roadsideVehicle(responderId);
    if (action === ROADSIDE_REPAIR) {
      if (!target || !responder || target.roadsideIncidentId !== incidentId ||
          responder.roadsideIncidentId !== incidentId || !target.roadsideHeld ||
          !responder.roadsideResponding) return false;
      target.roadsideRepairing = true;
      responder.roadsideRepairing = true;
      target.roadsideHazards = true;
      responder.roadsideHazards = true;
      return true;
    }

    if (action === ROADSIDE_CLEAR || action === ROADSIDE_CANCEL) {
      const repairTarget = action === ROADSIDE_CLEAR;
      const releasedTarget = releaseRoadsideVehicle(target, incidentId, repairTarget, kind);
      const releasedResponder = releaseRoadsideVehicle(responder, incidentId, false, kind);
      return releasedTarget || releasedResponder;
    }
    return false;
  }

  function nearestEnterable(position, radius = 3.2) {
    const point = pointXZ(position);
    let nearest = null;
    let nearestSquared = Math.max(0, finite(radius, 3.2)) ** 2;
    for (const vehicle of vehicles) {
      if (vehicle.health <= 0 || vehicle === playerVehicle) continue;
      const dx = vehicle.state.x - point.x;
      const dz = vehicle.state.z - point.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < nearestSquared) {
        nearest = vehicle;
        nearestSquared = distanceSquared;
      }
    }
    return nearest;
  }

  function enter(value, options = {}) {
    const vehicle = typeof value === "string" ? get(value) : get(value?.id) ?? value;
    if (!vehicle || !vehicles.includes(vehicle) || vehicle.health <= 0) return null;
    if (playerVehicle === vehicle) return vehicle;
    if (playerVehicle) exit();
    const previousDriver = vehicle.driver;
    vehicle.driver = "player";
    vehicle.aiMode = "parked";
    vehicle.trafficControl = null;
    vehicle.stoppedForSignal = false;
    vehicle.stuckTime = 0;
    vehicle.recoveryTime = 0;
    vehicle.recoveryCooldown = 0;
    vehicle.recovering = false;
    playerVehicle = vehicle;
    vehicle.externalHeadlightsActive = false;
    const authorized = options.authorized === undefined ? vehicle.authorized : Boolean(options.authorized);
    if (!authorized && typeof onCrime === "function") {
      try {
        onCrime({
          type: "vehicle_theft",
          kind: "vehicle_theft",
          amount: vehicle.police ? 34 : previousDriver ? 20 : 14,
          vehicle,
          previousDriver,
        });
      } catch { /* Crime integration is optional. */ }
    }
    return vehicle;
  }

  function positionIsSafe(x, z, radius = 0.48, excluded = null) {
    if (blockedCircle(world, x, z, radius)) return false;
    const bounds = boundsOf(world);
    if (bounds && (x < bounds.minX + radius || x > bounds.maxX - radius || z < bounds.minZ + radius || z > bounds.maxZ - radius)) return false;
    return !vehicles.some(vehicle => vehicle !== excluded && vehicle.health > 0 &&
      Math.hypot(vehicle.state.x - x, vehicle.state.z - z) < vehicle.radius + radius);
  }

  function exit() {
    if (!playerVehicle) return null;
    const vehicle = playerVehicle;
    const rightX = Math.cos(vehicle.state.yaw);
    const rightZ = -Math.sin(vehicle.state.yaw);
    const forwardX = -Math.sin(vehicle.state.yaw);
    const forwardZ = -Math.cos(vehicle.state.yaw);
    const side = vehicle.radius + 1.05;
    const candidates = [
      { x: vehicle.state.x + rightX * side, z: vehicle.state.z + rightZ * side },
      { x: vehicle.state.x - rightX * side, z: vehicle.state.z - rightZ * side },
      { x: vehicle.state.x - forwardX * side, z: vehicle.state.z - forwardZ * side },
      { x: vehicle.state.x + forwardX * side, z: vehicle.state.z + forwardZ * side },
    ];
    const chosen = candidates.find(candidate => positionIsSafe(candidate.x, candidate.z, 0.48, vehicle)) ??
      findOpenSpawn(world, candidates[0].x, candidates[0].z, 0.48);
    vehicle.driver = null;
    vehicle.aiMode = "parked";
    vehicle.trafficControl = null;
    vehicle.stoppedForSignal = false;
    vehicle.stuckTime = 0;
    vehicle.recoveryTime = 0;
    vehicle.recovering = false;
    vehicle.externalHeadlightsActive = false;
    vehicle.state.speed = 0;
    vehicle.state.lateralSpeed = 0;
    playerVehicle = null;
    return new THREE.Vector3(chosen.x, groundHeight(world, chosen.x, chosen.z), chosen.z);
  }

  function update(delta, {
    targetPosition = null,
    wantedStars = 0,
    lightLevel = trafficLightLevel,
    taxiPassengerVehicleId: requestedTaxiPassengerVehicleId = taxiPassengerVehicleId,
    captureSnapshot = true,
  } = {}) {
    if (disposed) return captureSnapshot ? snapshot() : null;
    const dt = clamp(delta, 0, MAX_FRAME_DELTA);
    trafficLightLevel = clamp01(lightLevel);
    taxiPassengerVehicleId = requestedTaxiPassengerVehicleId === null || requestedTaxiPassengerVehicleId === undefined
      ? null
      : String(requestedTaxiPassengerVehicleId);
    elapsed += dt;
    const phase = signalPhaseAt(elapsed);
    root.userData.trafficSignalPhase = {
      elapsed: ((elapsed % TRAFFIC_SIGNAL_CYCLE) + TRAFFIC_SIGNAL_CYCLE) % TRAFFIC_SIGNAL_CYCLE,
      x: phase.x,
      z: phase.z,
      name: phase.name,
    };
    const target = targetPosition ? pointXZ(targetPosition) : playerVehicle
      ? { x: playerVehicle.state.x, z: playerVehicle.state.z }
      : null;
    if (target && lastPursuitTarget && dt > EPSILON) {
      let velocityX = (target.x - lastPursuitTarget.x) / dt;
      let velocityZ = (target.z - lastPursuitTarget.z) / dt;
      const magnitude = Math.hypot(velocityX, velocityZ);
      if (magnitude > 45) {
        velocityX *= 45 / magnitude;
        velocityZ *= 45 / magnitude;
      }
      pursuitVelocity.x = damp(pursuitVelocity.x, velocityX, 5.5, dt);
      pursuitVelocity.z = damp(pursuitVelocity.z, velocityZ, 5.5, dt);
    } else if (!target) {
      pursuitVelocity.x = damp(pursuitVelocity.x, 0, 5.5, dt);
      pursuitVelocity.z = damp(pursuitVelocity.z, 0, 5.5, dt);
    }
    lastPursuitTarget = target ? { ...target } : null;
    const context = {
      targetPosition: target,
      targetVelocity: pursuitVelocity,
      wantedStars: Math.max(0, Math.trunc(finite(wantedStars))),
    };
    for (const vehicle of vehicles) updateVehicle(vehicle, dt, context);
    separateVehicles();
    for (const vehicle of vehicles) syncVisual(vehicle, 0, context.wantedStars);
    return captureSnapshot ? snapshot() : null;
  }

  function setExternalPlayerHeadlightsActive(value) {
    const active = playerHeadlightsOwnedExternally && Boolean(value) && Boolean(playerVehicle?.health > 0);
    if (playerVehicle) playerVehicle.externalHeadlightsActive = active;
    return active;
  }

  function damage(value, amount) {
    const vehicle = typeof value === "string" ? get(value) : get(value?.id) ?? value;
    if (!vehicle || !vehicles.includes(vehicle)) return null;
    vehicle.health = Math.max(0, vehicle.health - Math.max(0, finite(amount)));
    vehicle.damagePulse = 1;
    if (vehicle.health <= 0) {
      vehicle.state.speed = 0;
      vehicle.state.lateralSpeed = 0;
      vehicle.driver = null;
      vehicle.aiMode = "parked";
      vehicle.stuckTime = 0;
      vehicle.recoveryTime = 0;
      vehicle.recovering = false;
      if (vehicle === playerVehicle) {
        vehicle.externalHeadlightsActive = false;
        playerVehicle = null;
      }
    }
    return individualSnapshot(vehicle);
  }

  function raycast(origin, direction, maxDistance = 100) {
    const from = pointXZ(origin);
    const vector = pointXZ(direction);
    const length = Math.hypot(vector.x, vector.z);
    if (length <= EPSILON) return null;
    const dx = vector.x / length;
    const dz = vector.z / length;
    const maximum = Math.max(0, finite(maxDistance, 100));
    let best = null;
    let bestDistance = maximum;
    for (const vehicle of vehicles) {
      if (vehicle.health <= 0) continue;
      const ox = vehicle.state.x - from.x;
      const oz = vehicle.state.z - from.z;
      const projection = ox * dx + oz * dz;
      if (projection < 0 || projection > bestDistance) continue;
      const perpendicularSquared = ox * ox + oz * oz - projection * projection;
      const radiusSquared = vehicle.radius * vehicle.radius;
      if (perpendicularSquared > radiusSquared) continue;
      const distance = Math.max(0, projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared)));
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = {
          vehicle,
          id: vehicle.id,
          distance,
          point: new THREE.Vector3(from.x + dx * distance, vehicle.root.position.y + 0.7, from.z + dz * distance),
        };
      }
    }
    return best;
  }

  function teleport(id, x, z, yaw = null) {
    const vehicle = get(id);
    if (!vehicle) return null;
    const open = findOpenSpawn(world, finite(x, vehicle.state.x), finite(z, vehicle.state.z), vehicle.radius);
    vehicle.state.x = open.x;
    vehicle.state.z = open.z;
    if (yaw !== null && yaw !== undefined) vehicle.state.yaw = wrapAngle(finite(yaw, vehicle.state.yaw));
    vehicle.state.speed = 0;
    vehicle.state.lateralSpeed = 0;
    vehicle.state.longitudinalAcceleration = 0;
    vehicle.state.yawRate = 0;
    vehicle.state.bodyPitch = 0;
    vehicle.state.bodyRoll = 0;
    vehicle.state.suspensionJolt = 0;
    vehicle.trafficControl = null;
    vehicle.stoppedForSignal = false;
    vehicle.stuckTime = 0;
    vehicle.recoveryTime = 0;
    vehicle.recoveryCooldown = 0;
    vehicle.recovering = false;
    syncVisual(vehicle, 0, 0);
    return individualSnapshot(vehicle);
  }

  function snapshot() {
    return Object.freeze(vehicles.map(individualSnapshot));
  }

  const roadsideAdapter = Object.freeze({
    selectTarget: selectRoadsideTarget,
    status: roadsideStatus,
    command: roadsideCommand,
  });

  function createRoadsideAdapter() {
    return roadsideAdapter;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    playerVehicle = null;
    targetVehicle = null;
    lastPursuitTarget = null;
    pursuitVelocity.x = 0;
    pursuitVelocity.z = 0;
    root.removeFromParent();
    for (const vehicle of vehicles) vehicle.root.clear();
    vehicles.length = 0;
    byId.clear();
    root.clear();
    assets.dispose();
  }

  for (const vehicle of vehicles) syncVisual(vehicle, 0, 0);
  return {
    vehicles,
    get targetVehicle() { return targetVehicle; },
    get playerVehicle() { return playerVehicle; },
    roadsideAdapter,
    createRoadsideAdapter,
    selectRoadsideTarget,
    roadsideStatus,
    roadsideCommand,
    nearestEnterable,
    enter,
    exit,
    update,
    setExternalPlayerHeadlightsActive,
    damage,
    raycast,
    get,
    teleport,
    snapshot,
    dispose,
  };
}
