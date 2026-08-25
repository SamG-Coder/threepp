export const ROADSIDE_PHASES = Object.freeze({
  IDLE: "idle",
  REPORTED: "reported",
  RESPONDING: "responding",
  REPAIRING: "repairing",
  CLEARING: "clearing",
  COOLDOWN: "cooldown",
});

export const ROADSIDE_KINDS = Object.freeze({
  BREAKDOWN: "breakdown",
  COLLISION: "collision",
});

export const ROADSIDE_VEHICLE_COMMANDS = Object.freeze({
  HOLD: "hold",
  DISPATCH: "dispatch",
  REPAIR: "repair",
  CLEAR: "clear",
  CANCEL: "cancel",
});

export const ROADSIDE_OBSERVE_COMMANDS = Object.freeze({
  BEGIN: "begin",
  CLEAR: "clear",
});

const ACTIVE_PHASES = new Set([
  ROADSIDE_PHASES.REPORTED,
  ROADSIDE_PHASES.RESPONDING,
  ROADSIDE_PHASES.REPAIRING,
  ROADSIDE_PHASES.CLEARING,
]);
const EMPTY_CONTEXT = Object.freeze({});

const DEFAULT_CONFIG = Object.freeze({
  initialDelaySeconds: 72,
  reportedSeconds: 2.4,
  responseTimeoutSeconds: 28,
  repairSeconds: 7.5,
  clearingSeconds: 2,
  cooldownSeconds: 64,
  ambientIntervalSeconds: 105,
  ambientJitterSeconds: 31,
  rainIntervalReduction: 0.28,
  nightIntervalMultiplier: 1.12,
  arrivalDistance: 6.5,
  arrivalSpeed: 1.1,
  impactSpeedThreshold: 7.5,
  minimumTargetDistance: 22,
  maximumTargetDistance: 92,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback) {
  return Math.max(0, finite(value, fallback));
}

function positive(value, fallback) {
  return Math.max(1e-6, finite(value, fallback));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function wrappedHour(value) {
  const hour = finite(value, 12) % 24;
  return hour < 0 ? hour + 24 : hour;
}

function validId(value) {
  return typeof value === "string" && value.length > 0 || Number.isFinite(value);
}

function phaseIsActive(phase) {
  return ACTIVE_PHASES.has(phase);
}

function makeStatusBuffer() {
  return {
    available: false,
    playerControlled: false,
    x: 0,
    z: 0,
    speed: 0,
  };
}

function resetStatusBuffer(value) {
  value.available = false;
  value.playerControlled = false;
  value.x = 0;
  value.z = 0;
  value.speed = 0;
  return value;
}

function normalizeConfig(options) {
  const source = options?.config ?? options ?? {};
  return Object.freeze({
    initialDelaySeconds: nonNegative(source.initialDelaySeconds, DEFAULT_CONFIG.initialDelaySeconds),
    reportedSeconds: nonNegative(source.reportedSeconds, DEFAULT_CONFIG.reportedSeconds),
    responseTimeoutSeconds: positive(source.responseTimeoutSeconds, DEFAULT_CONFIG.responseTimeoutSeconds),
    repairSeconds: nonNegative(source.repairSeconds, DEFAULT_CONFIG.repairSeconds),
    clearingSeconds: nonNegative(source.clearingSeconds, DEFAULT_CONFIG.clearingSeconds),
    cooldownSeconds: nonNegative(source.cooldownSeconds, DEFAULT_CONFIG.cooldownSeconds),
    ambientIntervalSeconds: positive(source.ambientIntervalSeconds, DEFAULT_CONFIG.ambientIntervalSeconds),
    ambientJitterSeconds: nonNegative(source.ambientJitterSeconds, DEFAULT_CONFIG.ambientJitterSeconds),
    rainIntervalReduction: clamp(source.rainIntervalReduction ?? DEFAULT_CONFIG.rainIntervalReduction, 0, 0.8),
    nightIntervalMultiplier: Math.max(0.5, finite(source.nightIntervalMultiplier, DEFAULT_CONFIG.nightIntervalMultiplier)),
    arrivalDistance: positive(source.arrivalDistance, DEFAULT_CONFIG.arrivalDistance),
    arrivalSpeed: nonNegative(source.arrivalSpeed, DEFAULT_CONFIG.arrivalSpeed),
    impactSpeedThreshold: nonNegative(source.impactSpeedThreshold, DEFAULT_CONFIG.impactSpeedThreshold),
    minimumTargetDistance: nonNegative(source.minimumTargetDistance, DEFAULT_CONFIG.minimumTargetDistance),
    maximumTargetDistance: Math.max(
      nonNegative(source.minimumTargetDistance, DEFAULT_CONFIG.minimumTargetDistance),
      nonNegative(source.maximumTargetDistance, DEFAULT_CONFIG.maximumTargetDistance),
    ),
  });
}

/**
 * Deterministic, renderer-independent coordinator for one ambient roadside
 * response at a time.
 *
 * Vehicle adapter contract:
 * - selectTarget(playerX, playerZ, minimumDistance, maximumDistance, ordinal)
 *     -> vehicle id or null.
 * - status(vehicleId, reusableOutput) -> truthy when the id exists. The adapter
 *     writes { available, playerControlled, x, z, speed } into reusableOutput.
 * - command(action, incidentId, targetId, responderId, kind) -> result.
 *     HOLD returns truthy on acceptance. DISPATCH returns the responder id.
 *     REPAIR, CLEAR, and CANCEL are edge-triggered notifications.
 *     On restore, DISPATCH receives the saved responder id as a preference.
 *
 * Population adapter contract:
 * - observe(action, incidentId, kind, x, z) -> reporter id for BEGIN, if any.
 *     CLEAR ends the matching calm observation. It must not create crime panic.
 */
export function createRoadsideResponseSystem(options = {}) {
  const vehicles = options.vehicles;
  const population = options.population;
  if (!vehicles || typeof vehicles.selectTarget !== "function" || typeof vehicles.status !== "function" ||
      typeof vehicles.command !== "function") {
    throw new TypeError("createRoadsideResponseSystem requires a vehicle adapter");
  }
  if (!population || typeof population.observe !== "function") {
    throw new TypeError("createRoadsideResponseSystem requires a population observation adapter");
  }

  const config = normalizeConfig(options);
  const targetStatus = makeStatusBuffer();
  const responderStatus = makeStatusBuffer();
  let phase = ROADSIDE_PHASES.IDLE;
  let phaseElapsed = 0;
  let elapsed = 0;
  let nextAmbientAt = config.initialDelaySeconds;
  let serial = 0;
  let incidentId = 0;
  let kind = null;
  let targetVehicleId = null;
  let responderVehicleId = null;
  let reporterId = null;
  let incidentX = 0;
  let incidentZ = 0;
  let totalIncidents = 0;
  let completedIncidents = 0;
  let cancelledIncidents = 0;
  let pendingTargetId = null;
  let pendingKind = null;
  let pendingForced = false;

  // A frozen borrowed view avoids both per-tick snapshot allocation and the
  // possibility that an adapter or caller can corrupt coordinator state.
  const view = Object.freeze({
    get phase() { return phase; },
    get active() { return phaseIsActive(phase); },
    get incidentId() { return incidentId; },
    get kind() { return kind; },
    get targetVehicleId() { return targetVehicleId; },
    get responderVehicleId() { return responderVehicleId; },
    get reporterId() { return reporterId; },
    get x() { return incidentX; },
    get z() { return incidentZ; },
    get phaseElapsed() { return phaseElapsed; },
    get elapsed() { return elapsed; },
    get nextAmbientIn() { return Math.max(0, nextAmbientAt - elapsed); },
    get totalIncidents() { return totalIncidents; },
    get completedIncidents() { return completedIncidents; },
    get cancelledIncidents() { return cancelledIncidents; },
    get pending() { return pendingKind !== null; },
  });

  function syncView() {
    return view;
  }

  function readStatus(id, output) {
    resetStatusBuffer(output);
    if (!validId(id)) return false;
    const found = vehicles.status(id, output);
    output.available = Boolean(found && output.available !== false);
    output.playerControlled = Boolean(output.playerControlled);
    output.x = finite(output.x);
    output.z = finite(output.z);
    output.speed = finite(output.speed);
    return output.available;
  }

  function clearPending() {
    pendingTargetId = null;
    pendingKind = null;
    pendingForced = false;
  }

  function intervalFor(context) {
    // Serial-derived jitter is stable across machines and save/restore. There
    // is deliberately no Math.random() or wall-clock dependency.
    const bucket = ((serial + 1) * 37) % 11;
    const jitter = config.ambientJitterSeconds * bucket / 10;
    const rain = clamp(context?.rain, 0, 1);
    const hour = wrappedHour(context?.timeHours);
    const nightScale = hour < 6 || hour >= 22 ? config.nightIntervalMultiplier : 1;
    return Math.max(1, (config.ambientIntervalSeconds + jitter) *
      (1 - rain * config.rainIntervalReduction) * nightScale);
  }

  function scheduleNext(context) {
    nextAmbientAt = elapsed + intervalFor(context);
  }

  function observeClear() {
    if (incidentId > 0) {
      population.observe(ROADSIDE_OBSERVE_COMMANDS.CLEAR, incidentId, kind, incidentX, incidentZ);
    }
  }

  function setCooldown(context, cancelled) {
    if (cancelled) cancelledIncidents += 1;
    phase = ROADSIDE_PHASES.COOLDOWN;
    phaseElapsed = 0;
    scheduleNext(context);
    clearPending();
  }

  function cancelActive(context) {
    if (!phaseIsActive(phase)) return false;
    vehicles.command(
      ROADSIDE_VEHICLE_COMMANDS.CANCEL,
      incidentId,
      targetVehicleId,
      responderVehicleId,
      kind,
    );
    observeClear();
    setCooldown(context, true);
    return true;
  }

  function startIncident(requestedId, requestedKind, context) {
    let selected = requestedId;
    if (!validId(selected)) {
      selected = vehicles.selectTarget(
        finite(context?.playerX),
        finite(context?.playerZ),
        config.minimumTargetDistance,
        config.maximumTargetDistance,
        serial + 1,
      );
    }
    if (!validId(selected) || !readStatus(selected, targetStatus) || targetStatus.playerControlled) {
      clearPending();
      scheduleNext(context);
      return false;
    }

    const nextId = serial + 1;
    const resolvedKind = requestedKind === ROADSIDE_KINDS.COLLISION
      ? ROADSIDE_KINDS.COLLISION
      : ROADSIDE_KINDS.BREAKDOWN;
    const held = vehicles.command(ROADSIDE_VEHICLE_COMMANDS.HOLD, nextId, selected, null, resolvedKind);
    if (!held) {
      clearPending();
      scheduleNext(context);
      return false;
    }

    serial = nextId;
    incidentId = nextId;
    kind = resolvedKind;
    targetVehicleId = selected;
    responderVehicleId = null;
    incidentX = targetStatus.x;
    incidentZ = targetStatus.z;
    reporterId = population.observe(
      ROADSIDE_OBSERVE_COMMANDS.BEGIN,
      incidentId,
      kind,
      incidentX,
      incidentZ,
    ) ?? null;
    totalIncidents += 1;
    phase = ROADSIDE_PHASES.REPORTED;
    phaseElapsed = 0;
    clearPending();
    return true;
  }

  function targetRemainsUsable() {
    return readStatus(targetVehicleId, targetStatus) && !targetStatus.playerControlled;
  }

  function responderRemainsUsable() {
    return readStatus(responderVehicleId, responderStatus) && !responderStatus.playerControlled;
  }

  function gateIsClosed(context) {
    return context?.enabled === false || finite(context?.wantedStars) > 0 ||
      Boolean(context?.narrativeBusy) || Boolean(context?.activityBusy);
  }

  function update(delta, context = EMPTY_CONTEXT) {
    if (context.paused) return syncView();
    const dt = clamp(delta, 0, 1);
    elapsed += dt;

    const gated = gateIsClosed(context);
    if (gated && phaseIsActive(phase)) {
      cancelActive(context);
      return syncView();
    }

    if (phase === ROADSIDE_PHASES.COOLDOWN && pendingKind !== null && !gated) {
      // Forced QA and real impact reports are urgent and may bypass only the
      // inactive cooldown. They can never replace an active incident.
      phase = ROADSIDE_PHASES.IDLE;
      phaseElapsed = 0;
    }

    if (phase === ROADSIDE_PHASES.IDLE) {
      if (!gated && pendingKind !== null) {
        startIncident(pendingTargetId, pendingKind, context);
      } else if (!gated && elapsed >= nextAmbientAt) {
        startIncident(null, ROADSIDE_KINDS.BREAKDOWN, context);
      }
      return syncView();
    }

    if (phase === ROADSIDE_PHASES.COOLDOWN) {
      phaseElapsed += dt;
      if (phaseElapsed + 1e-9 >= config.cooldownSeconds) {
        phase = ROADSIDE_PHASES.IDLE;
        phaseElapsed = 0;
      }
      return syncView();
    }

    if (!targetRemainsUsable()) {
      cancelActive(context);
      return syncView();
    }
    incidentX = targetStatus.x;
    incidentZ = targetStatus.z;
    phaseElapsed += dt;

    if (phase === ROADSIDE_PHASES.REPORTED) {
      if (phaseElapsed + 1e-9 >= config.reportedSeconds) {
        const dispatched = vehicles.command(
          ROADSIDE_VEHICLE_COMMANDS.DISPATCH,
          incidentId,
          targetVehicleId,
          null,
          kind,
        );
        if (!validId(dispatched)) {
          cancelActive(context);
          return syncView();
        }
        responderVehicleId = dispatched;
        phase = ROADSIDE_PHASES.RESPONDING;
        phaseElapsed = 0;
      }
      return syncView();
    }

    if (phase === ROADSIDE_PHASES.RESPONDING) {
      if (!responderRemainsUsable()) {
        cancelActive(context);
        return syncView();
      }
      const distance = Math.hypot(responderStatus.x - targetStatus.x, responderStatus.z - targetStatus.z);
      if (distance <= config.arrivalDistance && Math.abs(responderStatus.speed) <= config.arrivalSpeed) {
        vehicles.command(
          ROADSIDE_VEHICLE_COMMANDS.REPAIR,
          incidentId,
          targetVehicleId,
          responderVehicleId,
          kind,
        );
        phase = ROADSIDE_PHASES.REPAIRING;
        phaseElapsed = 0;
      } else if (phaseElapsed + 1e-9 >= config.responseTimeoutSeconds) {
        cancelActive(context);
      }
      return syncView();
    }

    if (phase === ROADSIDE_PHASES.REPAIRING) {
      if (!responderRemainsUsable()) {
        cancelActive(context);
        return syncView();
      }
      if (phaseElapsed + 1e-9 >= config.repairSeconds) {
        vehicles.command(
          ROADSIDE_VEHICLE_COMMANDS.CLEAR,
          incidentId,
          targetVehicleId,
          responderVehicleId,
          kind,
        );
        phase = ROADSIDE_PHASES.CLEARING;
        phaseElapsed = 0;
      }
      return syncView();
    }

    if (phase === ROADSIDE_PHASES.CLEARING) {
      if (phaseElapsed + 1e-9 >= config.clearingSeconds) {
        observeClear();
        completedIncidents += 1;
        setCooldown(context, false);
      }
      return syncView();
    }

    return syncView();
  }

  function force(vehicleId = null, requestedKind = ROADSIDE_KINDS.BREAKDOWN) {
    if (phaseIsActive(phase) || pendingForced) return false;
    pendingTargetId = validId(vehicleId) ? vehicleId : null;
    pendingKind = requestedKind === ROADSIDE_KINDS.COLLISION
      ? ROADSIDE_KINDS.COLLISION
      : ROADSIDE_KINDS.BREAKDOWN;
    pendingForced = true;
    return true;
  }

  function report(detail = {}) {
    if (phaseIsActive(phase) || pendingForced || pendingKind !== null) return false;
    const speed = Math.abs(finite(detail.speed ?? detail.impactSpeed));
    const vehicleId = detail.vehicleId ?? detail.vehicle?.id ?? detail.targetId ?? null;
    if (speed + 1e-9 < config.impactSpeedThreshold || !validId(vehicleId)) return false;
    pendingTargetId = vehicleId;
    pendingKind = ROADSIDE_KINDS.COLLISION;
    pendingForced = false;
    return true;
  }

  function reset() {
    if (phaseIsActive(phase)) {
      vehicles.command(
        ROADSIDE_VEHICLE_COMMANDS.CANCEL,
        incidentId,
        targetVehicleId,
        responderVehicleId,
        kind,
      );
      observeClear();
    }
    phase = ROADSIDE_PHASES.IDLE;
    phaseElapsed = 0;
    elapsed = 0;
    nextAmbientAt = config.initialDelaySeconds;
    serial = 0;
    incidentId = 0;
    kind = null;
    targetVehicleId = null;
    responderVehicleId = null;
    reporterId = null;
    incidentX = 0;
    incidentZ = 0;
    totalIncidents = 0;
    completedIncidents = 0;
    cancelledIncidents = 0;
    clearPending();
    return syncView();
  }

  function save() {
    return Object.freeze({
      version: 1,
      phase,
      phaseElapsed,
      elapsed,
      nextAmbientAt,
      serial,
      incidentId,
      kind,
      targetVehicleId,
      responderVehicleId,
      reporterId,
      incidentX,
      incidentZ,
      totalIncidents,
      completedIncidents,
      cancelledIncidents,
      pendingTargetId,
      pendingKind,
      pendingForced,
    });
  }

  function restore(value = {}) {
    if (phaseIsActive(phase)) {
      vehicles.command(
        ROADSIDE_VEHICLE_COMMANDS.CANCEL,
        incidentId,
        targetVehicleId,
        responderVehicleId,
        kind,
      );
      observeClear();
    }

    const restoredPhase = Object.values(ROADSIDE_PHASES).includes(value.phase)
      ? value.phase
      : ROADSIDE_PHASES.IDLE;
    phase = restoredPhase;
    phaseElapsed = nonNegative(value.phaseElapsed, 0);
    elapsed = nonNegative(value.elapsed, 0);
    nextAmbientAt = Math.max(elapsed, finite(value.nextAmbientAt, elapsed + config.initialDelaySeconds));
    serial = Math.max(0, Math.trunc(finite(value.serial, value.incidentId)));
    incidentId = Math.max(0, Math.trunc(finite(value.incidentId)));
    kind = value.kind === ROADSIDE_KINDS.COLLISION ? ROADSIDE_KINDS.COLLISION :
      value.kind === ROADSIDE_KINDS.BREAKDOWN ? ROADSIDE_KINDS.BREAKDOWN : null;
    targetVehicleId = validId(value.targetVehicleId) ? value.targetVehicleId : null;
    responderVehicleId = validId(value.responderVehicleId) ? value.responderVehicleId : null;
    reporterId = validId(value.reporterId) ? value.reporterId : null;
    incidentX = finite(value.incidentX);
    incidentZ = finite(value.incidentZ);
    totalIncidents = Math.max(0, Math.trunc(finite(value.totalIncidents)));
    completedIncidents = Math.max(0, Math.trunc(finite(value.completedIncidents)));
    cancelledIncidents = Math.max(0, Math.trunc(finite(value.cancelledIncidents)));
    pendingTargetId = validId(value.pendingTargetId) ? value.pendingTargetId : null;
    pendingKind = value.pendingKind === ROADSIDE_KINDS.COLLISION ? ROADSIDE_KINDS.COLLISION :
      value.pendingKind === ROADSIDE_KINDS.BREAKDOWN ? ROADSIDE_KINDS.BREAKDOWN : null;
    pendingForced = Boolean(value.pendingForced && pendingKind);

    if (phaseIsActive(phase)) {
      if (!incidentId || !kind || !targetVehicleId || !readStatus(targetVehicleId, targetStatus) ||
          targetStatus.playerControlled || !vehicles.command(
            ROADSIDE_VEHICLE_COMMANDS.HOLD,
            incidentId,
            targetVehicleId,
            responderVehicleId,
            kind,
          )) {
        phase = ROADSIDE_PHASES.COOLDOWN;
        phaseElapsed = 0;
        targetVehicleId = null;
        responderVehicleId = null;
        reporterId = null;
        kind = null;
        incidentId = 0;
        clearPending();
        return syncView();
      }
      incidentX = targetStatus.x;
      incidentZ = targetStatus.z;
      reporterId = population.observe(
        ROADSIDE_OBSERVE_COMMANDS.BEGIN,
        incidentId,
        kind,
        incidentX,
        incidentZ,
      ) ?? reporterId;

      if (phase === ROADSIDE_PHASES.RESPONDING || phase === ROADSIDE_PHASES.REPAIRING ||
          phase === ROADSIDE_PHASES.CLEARING) {
        const dispatched = vehicles.command(
          ROADSIDE_VEHICLE_COMMANDS.DISPATCH,
          incidentId,
          targetVehicleId,
          responderVehicleId,
          kind,
        );
        if (!validId(dispatched)) {
          vehicles.command(
            ROADSIDE_VEHICLE_COMMANDS.CANCEL,
            incidentId,
            targetVehicleId,
            responderVehicleId,
            kind,
          );
          observeClear();
          phase = ROADSIDE_PHASES.COOLDOWN;
          phaseElapsed = 0;
          cancelledIncidents += 1;
          return syncView();
        }
        responderVehicleId = dispatched;
      }
      if (phase === ROADSIDE_PHASES.REPAIRING) {
        vehicles.command(
          ROADSIDE_VEHICLE_COMMANDS.REPAIR,
          incidentId,
          targetVehicleId,
          responderVehicleId,
          kind,
        );
      } else if (phase === ROADSIDE_PHASES.CLEARING) {
        vehicles.command(
          ROADSIDE_VEHICLE_COMMANDS.CLEAR,
          incidentId,
          targetVehicleId,
          responderVehicleId,
          kind,
        );
      }
    }
    return syncView();
  }

  function snapshot() {
    return Object.freeze({
      phase,
      active: phaseIsActive(phase),
      incidentId,
      kind,
      targetVehicleId,
      responderVehicleId,
      reporterId,
      position: Object.freeze([incidentX, 0, incidentZ]),
      phaseElapsed,
      elapsed,
      nextAmbientIn: Math.max(0, nextAmbientAt - elapsed),
      totalIncidents,
      completedIncidents,
      cancelledIncidents,
      pending: pendingKind !== null,
      pendingKind,
      storage: "memory-only",
    });
  }

  function prewarm() {
    // The core owns no renderer resource. Touch every phase/command constant so
    // startup diagnostics can prove the complete state vocabulary was prepared
    // without mutating the live incident or issuing adapter commands.
    let checksum = 0;
    for (const value of Object.values(ROADSIDE_PHASES)) checksum += value.length;
    for (const value of Object.values(ROADSIDE_VEHICLE_COMMANDS)) checksum += value.length;
    for (const value of Object.values(ROADSIDE_OBSERVE_COMMANDS)) checksum += value.length;
    return Object.freeze({
      ready: true,
      storage: "memory-only",
      rendererResources: 0,
      phasesPrepared: Object.keys(ROADSIDE_PHASES).length,
      vehicleCommandsPrepared: Object.keys(ROADSIDE_VEHICLE_COMMANDS).length,
      populationCommandsPrepared: Object.keys(ROADSIDE_OBSERVE_COMMANDS).length,
      liveStatePreserved: true,
      checksum,
    });
  }

  syncView();
  return Object.freeze({
    update,
    force,
    report,
    reset,
    save,
    restore,
    snapshot,
    prewarm,
    get config() { return config; },
  });
}
