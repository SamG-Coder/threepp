export const MISSION_STAGES = Object.freeze({
  AVAILABLE: "available",
  STEAL: "steal_target",
  ESCAPE: "escape_police",
  DELIVER: "deliver_target",
  COMPLETE: "complete",
});

function normalizePosition(value) {
  if (Array.isArray(value)) return value.slice(0, 3).map(component => Number(component) || 0);
  if (value && typeof value === "object") return [Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0];
  return [0, 0, 0];
}

export function createVehicleRecoveryMission({
  id = "vehicle_recovery",
  title = "VEHICLE RECOVERY",
  reward = 5000,
  targetVehicleId = null,
  startPosition = [0, 0, 0],
  dropoffPosition = [0, 0, 0],
  legalRecovery = false,
  objectives = {},
} = {}) {
  let stage = MISSION_STAGES.AVAILABLE;
  let targetId = targetVehicleId ? String(targetVehicleId) : null;
  let completedCount = 0;
  let startedAt = null;
  let completedAt = null;
  let elapsed = 0;
  let lastEvent = null;
  const start = normalizePosition(startPosition);
  const dropoff = normalizePosition(dropoffPosition);
  const missionId = String(id || "vehicle_recovery");
  const missionTitle = String(title || "VEHICLE RECOVERY");
  const labels = Object.freeze({
    available: String(objectives.available ?? "MEET THE GARAGE CONTACT"),
    steal: String(objectives.steal ?? "RECOVER THE MARKED VEHICLE"),
    escape: String(objectives.escape ?? "LOSE THE POLICE"),
    deliver: String(objectives.deliver ?? "DELIVER THE CAR TO THE GARAGE"),
    complete: String(objectives.complete ?? "JOB COMPLETE - PRESS M FOR ANOTHER RUN"),
  });

  function begin(vehicleId = targetId) {
    if (stage !== MISSION_STAGES.AVAILABLE && stage !== MISSION_STAGES.COMPLETE) return snapshot();
    if (!vehicleId) throw new TypeError("The vehicle recovery mission requires a target vehicle id");
    targetId = String(vehicleId);
    stage = MISSION_STAGES.STEAL;
    startedAt = elapsed;
    completedAt = null;
    lastEvent = "mission_started";
    return snapshot();
  }

  function notify(event = {}) {
    const type = String(event.type || "");
    if (stage === MISSION_STAGES.STEAL && type === "vehicle_entered" && String(event.vehicleId) === targetId) {
      stage = Number(event.wantedStars) > 0 ? MISSION_STAGES.ESCAPE : MISSION_STAGES.DELIVER;
      lastEvent = "target_recovered";
    } else if (stage === MISSION_STAGES.ESCAPE && type === "wanted_changed" && Number(event.stars) === 0) {
      stage = MISSION_STAGES.DELIVER;
      lastEvent = "police_lost";
    } else if (stage === MISSION_STAGES.DELIVER && type === "vehicle_delivered" && String(event.vehicleId) === targetId) {
      stage = MISSION_STAGES.COMPLETE;
      completedAt = elapsed;
      completedCount += 1;
      lastEvent = "mission_complete";
      return { ...snapshot(), reward };
    } else if (type === "target_destroyed" && String(event.vehicleId) === targetId) {
      stage = MISSION_STAGES.AVAILABLE;
      lastEvent = "target_destroyed";
    }
    return snapshot();
  }

  function update(delta, context = {}) {
    elapsed += Math.max(0, Math.min(0.25, Number(delta) || 0));
    if (stage === MISSION_STAGES.ESCAPE && Number(context.wantedStars) === 0) {
      notify({ type: "wanted_changed", stars: 0 });
    }
    return snapshot();
  }

  function reset(nextVehicleId = targetId) {
    stage = MISSION_STAGES.AVAILABLE;
    if (nextVehicleId) targetId = String(nextVehicleId);
    startedAt = null;
    completedAt = null;
    lastEvent = "mission_reset";
    return snapshot();
  }

  function restore(value = {}) {
    stage = Object.values(MISSION_STAGES).includes(value.stage) ? value.stage : MISSION_STAGES.AVAILABLE;
    targetId = value.targetVehicleId ? String(value.targetVehicleId) : targetId;
    completedCount = Math.max(0, Math.trunc(Number(value.completedCount) || 0));
    startedAt = value.startedAt !== null && value.startedAt !== undefined && Number.isFinite(Number(value.startedAt))
      ? Number(value.startedAt) : null;
    completedAt = value.completedAt !== null && value.completedAt !== undefined && Number.isFinite(Number(value.completedAt))
      ? Number(value.completedAt) : null;
    elapsed = Math.max(0, Number(value.elapsed) || 0);
    lastEvent = value.lastEvent ? String(value.lastEvent) : null;
    return snapshot();
  }

  function objective() {
    switch (stage) {
      case MISSION_STAGES.AVAILABLE: return labels.available;
      case MISSION_STAGES.STEAL: return labels.steal;
      case MISSION_STAGES.ESCAPE: return labels.escape;
      case MISSION_STAGES.DELIVER: return labels.deliver;
      case MISSION_STAGES.COMPLETE: return labels.complete;
      default: return "FREE ROAM";
    }
  }

  function targetKind() {
    if (stage === MISSION_STAGES.AVAILABLE) return "contact";
    if (stage === MISSION_STAGES.STEAL) return "vehicle";
    if (stage === MISSION_STAGES.DELIVER) return "dropoff";
    return null;
  }

  function snapshot() {
    return Object.freeze({
      id: missionId,
      title: missionTitle,
      legalRecovery: Boolean(legalRecovery),
      stage,
      status: stage === MISSION_STAGES.COMPLETE ? "completed" : stage === MISSION_STAGES.AVAILABLE ? "available" : "active",
      objective: objective(),
      targetKind: targetKind(),
      targetVehicleId: targetId,
      startPosition: [...start],
      dropoffPosition: [...dropoff],
      reward,
      completedCount,
      startedAt,
      completedAt,
      elapsed,
      lastEvent,
    });
  }

  return { begin, notify, update, reset, restore, snapshot };
}

// Preserve the original exported factory name for older snapshots and callers.
export const createVehicleTheftMission = createVehicleRecoveryMission;
