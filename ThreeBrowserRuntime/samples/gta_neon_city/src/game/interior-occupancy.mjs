export const INTERIOR_OCCUPANCY_SAVE_VERSION = 1;

export const INTERIOR_OCCUPANCY_PHASES = Object.freeze({
  TO_EXTERIOR: "to_exterior",
  TO_THRESHOLD: "to_threshold",
  TO_INTERIOR: "to_interior",
  DWELL: "dwell",
  TO_THRESHOLD_EXIT: "to_threshold_exit",
  TO_EXTERIOR_EXIT: "to_exterior_exit",
});

const MINUTES_PER_DAY = 24 * 60;
const VALID_PHASES = new Set(Object.values(INTERIOR_OCCUPANCY_PHASES));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
}

function cleanId(value, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 128);
}

function cleanRequestKey(value) {
  return String(value ?? "").trim().slice(0, 160);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function hash32(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function point(value, label) {
  const source = value?.position ?? value;
  const x = Array.isArray(source) || ArrayBuffer.isView(source) ? source[0] : source?.x;
  const y = Array.isArray(source) || ArrayBuffer.isView(source) ? source[1] : source?.y;
  const z = Array.isArray(source) || ArrayBuffer.isView(source) ? source[2] : source?.z;
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
    throw new TypeError(`${label} requires a finite x/z position.`);
  }
  return Object.freeze([finite(x), finite(y), finite(z)]);
}

function dwellRange(value, fallback = [6, 12]) {
  const source = value ?? fallback;
  let minimum;
  let maximum;
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    minimum = integer(source[0], fallback[0]);
    maximum = integer(source[1], minimum);
  } else if (source && typeof source === "object") {
    minimum = integer(source.minimum ?? source.min, fallback[0]);
    maximum = integer(source.maximum ?? source.max, minimum);
  } else {
    minimum = integer(source, fallback[0]);
    maximum = minimum;
  }
  minimum = Math.max(1, minimum);
  maximum = Math.max(minimum, maximum);
  return Object.freeze([minimum, Math.min(240, maximum)]);
}

function normalizedMinute(value) {
  const minute = integer(value);
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function normalizeOpenDays(value) {
  const source = Array.isArray(value) ? value : [0, 1, 2, 3, 4, 5, 6];
  const unique = new Set();
  for (const item of source) unique.add(((integer(item) % 7) + 7) % 7);
  return Object.freeze([...unique].sort((left, right) => left - right));
}

function normalizeBuilding(value, index) {
  const id = cleanId(value?.id, `building_${index + 1}`);
  if (!id) throw new RangeError(`Interior occupancy building ${index + 1} requires an id.`);
  const exteriorSource = value?.exterior ?? value?.exteriorAnchor ?? value?.entryExterior;
  const thresholdSource = value?.threshold ?? value?.thresholdAnchor ??
    value?.entrance?.position ?? value?.entrance;
  const defaultDwell = dwellRange(value?.dwellMinutes);
  const slotSource = value?.occupancySlots ?? value?.interiorSlots ?? value?.slots;
  if (!Array.isArray(slotSource) || slotSource.length === 0) {
    throw new RangeError(`Interior occupancy building ${id} requires at least one occupancy slot.`);
  }
  const slotIds = new Set();
  const slots = slotSource.map((slot, slotIndex) => {
    const slotId = cleanId(slot?.id, `${id}_slot_${slotIndex + 1}`);
    if (!slotId || slotIds.has(slotId)) {
      throw new RangeError(`Interior occupancy building ${id} has a duplicate or empty slot id: ${slotId}`);
    }
    slotIds.add(slotId);
    return Object.freeze({
      id: slotId,
      position: point(slot, `${id}.${slotId}`),
      dwellMinutes: dwellRange(slot?.dwellMinutes, defaultDwell),
      activity: cleanId(slot?.activity, "dwell") || "dwell",
      idleMode: cleanId(slot?.idleMode, "hands") || "hands",
    });
  }).sort((left, right) => left.id.localeCompare(right.id));
  const capacity = Math.max(1, Math.min(
    slots.length,
    integer(value?.capacity ?? value?.maximumVisitors, slots.length),
  ));
  const hours = value?.openingHours ?? value?.hours ?? {};
  return Object.freeze({
    id,
    exterior: point(exteriorSource, `${id}.exterior`),
    threshold: point(thresholdSource, `${id}.threshold`),
    slots: Object.freeze(slots),
    capacity,
    visitChance: clamp(value?.visitChance ?? 1, 0, 1),
    openMinute: normalizedMinute(hours.openMinute ?? finite(hours.open, 0) * 60),
    closeMinute: normalizedMinute(hours.closeMinute ?? finite(hours.close, 24) * 60),
    openDays: normalizeOpenDays(hours.openDays ?? value?.openDays),
    arrivalRadius: clamp(value?.arrivalRadius ?? 0.58, 0.35, 1.8),
    speedScale: clamp(value?.speedScale ?? 1, 0.55, 1.65),
  });
}

function normalizeBuildings(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError("createInteriorOccupancySystem requires at least one building contract.");
  }
  const ids = new Set();
  const buildings = values.map((value, index) => {
    const building = normalizeBuilding(value, index);
    if (ids.has(building.id)) throw new RangeError(`Duplicate interior occupancy building id: ${building.id}`);
    ids.add(building.id);
    return building;
  });
  buildings.sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze(buildings);
}

function normalizeActorIds(values) {
  const ids = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = cleanId(value?.actorId ?? value?.id ?? value);
    if (id) ids.add(id);
  }
  return Object.freeze([...ids].sort((left, right) => left.localeCompare(right)));
}

function clockValue(context = {}, fallbackDay = 0, fallbackMinute = 12 * 60) {
  const source = context?.clock && typeof context.clock === "object" ? context.clock : context;
  let dayIndex = Math.max(0, integer(source?.dayIndex ?? source?.day, fallbackDay));
  let rawMinute;
  if (Number.isFinite(Number(source?.minuteOfDay))) rawMinute = integer(source.minuteOfDay);
  else if (Number.isFinite(Number(source?.timeHours))) rawMinute = Math.floor(Number(source.timeHours) * 60);
  else rawMinute = integer(fallbackMinute);
  if (rawMinute >= MINUTES_PER_DAY) {
    dayIndex += Math.floor(rawMinute / MINUTES_PER_DAY);
  }
  const minuteOfDay = normalizedMinute(rawMinute);
  return Object.freeze({
    dayIndex,
    minuteOfDay,
    absoluteMinute: dayIndex * MINUTES_PER_DAY + minuteOfDay,
  });
}

function isOpen(building, dayIndex, minuteOfDay) {
  if (!building.openDays.includes(dayIndex % 7)) return false;
  if (building.openMinute === building.closeMinute) return true;
  if (building.closeMinute > building.openMinute) {
    return minuteOfDay >= building.openMinute && minuteOfDay < building.closeMinute;
  }
  return minuteOfDay >= building.openMinute || minuteOfDay < building.closeMinute;
}

function reservationKey(buildingId, slotId) {
  return `${buildingId}:${slotId}`;
}

function phaseTarget(entry, phase) {
  switch (phase) {
    case INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR:
    case INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR_EXIT:
      return entry.building.exterior;
    case INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD:
    case INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT:
      return entry.building.threshold;
    case INTERIOR_OCCUPANCY_PHASES.TO_INTERIOR:
    case INTERIOR_OCCUPANCY_PHASES.DWELL:
      return entry.slot.position;
    default:
      return null;
  }
}

function requirePopulationApi(population) {
  const methods = [
    "leaseManagedRoutineActor",
    "queueManagedRoutineDestination",
    "setManagedRoutineDwell",
    "restoreManagedRoutineActor",
    "releaseManagedRoutineActor",
  ];
  if (!population || !Array.isArray(population.actors)) {
    throw new TypeError("createInteriorOccupancySystem requires a population system with actors.");
  }
  for (const method of methods) {
    if (typeof population[method] !== "function") {
      throw new TypeError(`createInteriorOccupancySystem requires population.${method}().`);
    }
  }
}

/**
 * Deterministically leases only caller-supplied civilian ids and directs each
 * accepted actor through exterior -> threshold -> unique interior slot -> exit.
 * This module never drains graph searches itself; the caller must invoke the
 * population system's single external route-search drain once per frame.
 */
export function createInteriorOccupancySystem({
  population,
  buildings,
  actorIds = null,
  eligibleActorIds = actorIds,
  ownerId: ownerValue = "interior-occupancy",
  seed = hash32("neon-city-interior-occupancy"),
  bucketMinutes = 30,
} = {}) {
  requirePopulationApi(population);
  const contracts = normalizeBuildings(buildings);
  const contractById = new Map(contracts.map(building => [building.id, building]));
  const eligibleIds = normalizeActorIds(eligibleActorIds);
  const eligibleIdSet = new Set(eligibleIds);
  const ownerId = cleanId(ownerValue, "interior-occupancy");
  if (!ownerId) throw new RangeError("Interior occupancy ownerId must not be empty.");
  const visitBucketMinutes = Math.max(5, Math.min(MINUTES_PER_DAY, integer(bucketMinutes, 30)));
  let runtimeSeed = integer(seed) >>> 0;
  let dayIndex = 0;
  let minuteOfDay = 12 * 60;
  let absoluteMinute = minuteOfDay;
  let lastEvaluatedBucket = null;
  let stateRevision = 0;
  let cachedSnapshot = null;
  let cachedSnapshotRevision = -1;
  let prewarmResult = null;
  let disposed = false;
  const visits = new Map();
  const reservations = new Map();
  const runtimeView = {
    dayIndex,
    minuteOfDay,
    absoluteMinute,
    bucket: null,
    occupantCount: 0,
    reservationCount: 0,
    pendingRouteCount: 0,
    stateRevision,
  };

  function markDirty() {
    stateRevision += 1;
    cachedSnapshot = null;
  }

  function actorFor(actorId) {
    return population.actors.find(actor => actor?.id === actorId) ?? null;
  }

  function buildingOccupancy(buildingId) {
    let count = 0;
    for (const entry of visits.values()) count += Number(entry.building.id === buildingId);
    return count;
  }

  function requestKeyFor(entry, phase) {
    const fullKey = `${ownerId}:${entry.actorId}:${entry.building.id}:${entry.startedBucket}:${entry.phaseSerial}:${phase}`;
    return cleanRequestKey(
      `${ownerId.slice(0, 24)}:${entry.actorId.slice(0, 32)}:${entry.building.id.slice(0, 32)}:` +
      `${entry.startedBucket}:${entry.phaseSerial}:${phase}:${hash32(fullKey).toString(16)}`,
    );
  }

  function queuePhase(entry, phase) {
    const target = phaseTarget(entry, phase);
    if (!target) return false;
    entry.phase = phase;
    entry.phaseSerial += 1;
    entry.dwellDeadline = null;
    entry.requestKey = requestKeyFor(entry, phase);
    const result = population.queueManagedRoutineDestination(
      entry.actor,
      ownerId,
      target,
      {
        locationId: entry.building.id,
        activity: `occupancy:${entry.building.id}:${phase}:${entry.slot.id}`,
        arrivalRadius: entry.building.arrivalRadius,
        speedScale: entry.building.speedScale,
        requestKey: entry.requestKey,
      },
    );
    if (!result.accepted) return false;
    markDirty();
    return true;
  }

  function releaseEntry(entry) {
    reservations.delete(reservationKey(entry.building.id, entry.slot.id));
    visits.delete(entry.actorId);
    population.releaseManagedRoutineActor(entry.actor, ownerId);
    markDirty();
  }

  function abortEntry(entry) {
    releaseEntry(entry);
  }

  function slotForCandidate(building, actorId, bucket) {
    const candidates = building.slots
      .filter(slot => !reservations.has(reservationKey(building.id, slot.id)))
      .map(slot => ({
        slot,
        score: hash32(`${runtimeSeed}:${bucket}:${actorId}:${building.id}:${slot.id}:slot`),
      }));
    candidates.sort((left, right) => left.score - right.score || left.slot.id.localeCompare(right.slot.id));
    return candidates[0]?.slot ?? null;
  }

  function beginVisit(actorId, building, bucket) {
    if (visits.has(actorId) || buildingOccupancy(building.id) >= building.capacity) return false;
    const actor = actorFor(actorId);
    if (!actor) return false;
    const slot = slotForCandidate(building, actorId, bucket);
    if (!slot) return false;
    const lease = population.leaseManagedRoutineActor(actor, ownerId);
    if (!lease.accepted) return false;
    const entry = {
      actorId,
      actor,
      building,
      slot,
      phase: INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR,
      phaseSerial: 0,
      startedBucket: bucket,
      dwellDeadline: null,
      requestKey: null,
    };
    visits.set(actorId, entry);
    reservations.set(reservationKey(building.id, slot.id), actorId);
    if (!queuePhase(entry, INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR)) {
      releaseEntry(entry);
      return false;
    }
    return true;
  }

  function scheduleBucket(bucket) {
    const candidates = [];
    for (const actorId of eligibleIds) {
      if (visits.has(actorId)) continue;
      for (const building of contracts) {
        if (!isOpen(building, dayIndex, minuteOfDay)) continue;
        const visitHash = hash32(
          `${runtimeSeed}:${dayIndex}:${bucket}:${actorId}:${building.id}:visit`,
        );
        if (visitHash / 0x100000000 >= building.visitChance) continue;
        candidates.push({ actorId, building, score: visitHash });
      }
    }
    candidates.sort((left, right) => left.score - right.score ||
      left.actorId.localeCompare(right.actorId) || left.building.id.localeCompare(right.building.id));
    const assignedActors = new Set();
    for (const candidate of candidates) {
      if (assignedActors.has(candidate.actorId) || visits.has(candidate.actorId)) continue;
      if (buildingOccupancy(candidate.building.id) >= candidate.building.capacity) continue;
      if (beginVisit(candidate.actorId, candidate.building, bucket)) assignedActors.add(candidate.actorId);
    }
  }

  function dwellDuration(entry) {
    const [minimum, maximum] = entry.slot.dwellMinutes;
    const span = maximum - minimum + 1;
    const value = hash32(
      `${runtimeSeed}:${entry.startedBucket}:${entry.actorId}:${entry.building.id}:${entry.slot.id}:dwell`,
    );
    return minimum + value % span;
  }

  function processEntry(entry) {
    const actor = entry.actor;
    if (!actor || actor.managedRoutineOwner !== ownerId || actor.police || actor.storyProtected ||
        actor.storyLocked || actor.presentationStaged || !actor.active || !actor.alive || actor.ragdollActive) {
      abortEntry(entry);
      return;
    }
    if (actor.managedRoutineRequestStatus === "rejected" &&
        actor.managedRoutineRequestKey === entry.requestKey) {
      abortEntry(entry);
      return;
    }

    if (entry.phase === INTERIOR_OCCUPANCY_PHASES.DWELL) {
      if (entry.dwellDeadline !== null && absoluteMinute >= entry.dwellDeadline) {
        if (!queuePhase(entry, INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT)) abortEntry(entry);
      }
      return;
    }
    if (actor.managedRoutineRequestPending || actor.managedRoutineAppliedRequestKey !== entry.requestKey ||
        !actor.routineDestinationActive || !actor.routineDestinationArrived) return;

    switch (entry.phase) {
      case INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR:
        if (!queuePhase(entry, INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD)) abortEntry(entry);
        break;
      case INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD:
        if (!queuePhase(entry, INTERIOR_OCCUPANCY_PHASES.TO_INTERIOR)) abortEntry(entry);
        break;
      case INTERIOR_OCCUPANCY_PHASES.TO_INTERIOR: {
        const dwell = population.setManagedRoutineDwell(actor, ownerId, {
          locationId: entry.building.id,
          activity: `occupancy:${entry.building.id}:dwell:${entry.slot.activity}`,
          idleMode: entry.slot.idleMode,
        });
        if (!dwell.accepted) {
          abortEntry(entry);
          break;
        }
        entry.phase = INTERIOR_OCCUPANCY_PHASES.DWELL;
        entry.phaseSerial += 1;
        entry.dwellDeadline = absoluteMinute + dwellDuration(entry);
        markDirty();
        break;
      }
      case INTERIOR_OCCUPANCY_PHASES.TO_THRESHOLD_EXIT:
        if (!queuePhase(entry, INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR_EXIT)) abortEntry(entry);
        break;
      case INTERIOR_OCCUPANCY_PHASES.TO_EXTERIOR_EXIT:
        releaseEntry(entry);
        break;
      default:
        abortEntry(entry);
        break;
    }
  }

  function syncClock(context) {
    // Keep the captureSnapshot:false frame path allocation-free. clockValue()
    // remains useful for infrequent restore parsing, but the live tick writes
    // directly into scalar state.
    const source = context?.clock && typeof context.clock === "object" ? context.clock : context;
    let nextDay = Math.max(0, integer(source?.dayIndex ?? source?.day, dayIndex));
    let rawMinute;
    if (Number.isFinite(Number(source?.minuteOfDay))) rawMinute = integer(source.minuteOfDay);
    else if (Number.isFinite(Number(source?.timeHours))) rawMinute = Math.floor(Number(source.timeHours) * 60);
    else rawMinute = minuteOfDay;
    if (rawMinute >= MINUTES_PER_DAY) nextDay += Math.floor(rawMinute / MINUTES_PER_DAY);
    const nextMinute = normalizedMinute(rawMinute);
    if (nextDay !== dayIndex || nextMinute !== minuteOfDay) markDirty();
    dayIndex = nextDay;
    minuteOfDay = nextMinute;
    absoluteMinute = dayIndex * MINUTES_PER_DAY + minuteOfDay;
    return Math.floor(absoluteMinute / visitBucketMinutes);
  }

  function update(_deltaSeconds = 0, context = {}) {
    if (disposed) return context?.captureSnapshot === false ? runtimeView : snapshot();
    const bucket = syncClock(context);
    if (bucket !== lastEvaluatedBucket) {
      lastEvaluatedBucket = bucket;
      scheduleBucket(bucket);
      markDirty();
    }
    for (const actorId of eligibleIds) {
      const entry = visits.get(actorId);
      if (entry) processEntry(entry);
    }
    if (context?.captureSnapshot === false) {
      runtimeView.dayIndex = dayIndex;
      runtimeView.minuteOfDay = minuteOfDay;
      runtimeView.absoluteMinute = absoluteMinute;
      runtimeView.bucket = lastEvaluatedBucket;
      runtimeView.occupantCount = visits.size;
      runtimeView.reservationCount = reservations.size;
      let pending = 0;
      for (const entry of visits.values()) pending += Number(entry.actor.managedRoutineRequestPending);
      runtimeView.pendingRouteCount = pending;
      runtimeView.stateRevision = stateRevision;
      return runtimeView;
    }
    return snapshot();
  }

  function occupantView(entry) {
    const actor = entry.actor;
    return {
      actorId: entry.actorId,
      buildingId: entry.building.id,
      slotId: entry.slot.id,
      phase: entry.phase,
      phaseSerial: entry.phaseSerial,
      startedBucket: entry.startedBucket,
      dwellDeadline: entry.dwellDeadline,
      requestKey: entry.requestKey,
      reservationKey: reservationKey(entry.building.id, entry.slot.id),
      position: [
        finite(actor.root.position.x),
        finite(actor.root.position.y),
        finite(actor.root.position.z),
      ],
      yaw: finite(actor.root.rotation.y),
      state: actor.state,
      idleMode: actor.idleMode,
      destination: actor.routineDestinationActive
        ? [
          finite(actor.routineDestination.x),
          finite(actor.routineDestination.y),
          finite(actor.routineDestination.z),
        ]
        : null,
      locationId: actor.routineLocation,
      activity: actor.routineActivity,
      arrivalRadius: finite(actor.routineArrivalRadius, entry.building.arrivalRadius),
      speedScale: finite(actor.routineTravelSpeedScale, entry.building.speedScale),
      arrived: Boolean(actor.routineDestinationActive && actor.routineDestinationArrived),
      dwelling: Boolean(actor.managedRoutineDwelling),
      routePending: Boolean(actor.managedRoutineRequestPending),
      routeStatus: actor.managedRoutineRequestStatus,
      routeReason: actor.managedRoutineLastRequestReason,
    };
  }

  function snapshot() {
    // Actor poses are advanced by population.update(), outside this system's
    // own revision counter. Empty snapshots can be cached indefinitely; live
    // occupant views must be rebuilt on demand so save/debug consumers never
    // observe a stale position or yaw. The captureSnapshot:false hot path does
    // not call this function and remains allocation-free.
    if (visits.size === 0 && cachedSnapshot && cachedSnapshotRevision === stateRevision) return cachedSnapshot;
    const occupants = [...visits.values()]
      .sort((left, right) => left.actorId.localeCompare(right.actorId))
      .map(occupantView);
    cachedSnapshot = deepFreeze({
      saveVersion: INTERIOR_OCCUPANCY_SAVE_VERSION,
      ownerId,
      seed: runtimeSeed,
      bucketMinutes: visitBucketMinutes,
      clock: { dayIndex, minuteOfDay, absoluteMinute, bucket: lastEvaluatedBucket },
      eligibleActorIds: [...eligibleIds],
      buildings: contracts.map(building => ({
        id: building.id,
        capacity: building.capacity,
        slotIds: building.slots.map(slot => slot.id),
      })),
      occupants,
      reservations: occupants.map(entry => ({
        key: entry.reservationKey,
        actorId: entry.actorId,
        buildingId: entry.buildingId,
        slotId: entry.slotId,
      })),
      stateRevision,
    });
    cachedSnapshotRevision = stateRevision;
    return cachedSnapshot;
  }

  function save() {
    return {
      version: INTERIOR_OCCUPANCY_SAVE_VERSION,
      ownerId,
      seed: runtimeSeed,
      bucketMinutes: visitBucketMinutes,
      clock: { dayIndex, minuteOfDay, absoluteMinute },
      lastEvaluatedBucket,
      occupants: [...visits.values()]
        .sort((left, right) => left.actorId.localeCompare(right.actorId))
        .map(occupantView),
    };
  }

  function restore(value) {
    const source = value && typeof value === "object" ? clone(value) : {};
    for (const entry of [...visits.values()]) releaseEntry(entry);
    visits.clear();
    reservations.clear();
    runtimeSeed = integer(source.seed, runtimeSeed) >>> 0;
    const clock = clockValue(source.clock, 0, 12 * 60);
    dayIndex = clock.dayIndex;
    minuteOfDay = clock.minuteOfDay;
    absoluteMinute = clock.absoluteMinute;
    lastEvaluatedBucket = Number.isFinite(Number(source.lastEvaluatedBucket))
      ? integer(source.lastEvaluatedBucket)
      : Math.floor(absoluteMinute / visitBucketMinutes);

    const restoredOccupants = Array.isArray(source.occupants)
      ? [...source.occupants].sort((left, right) => cleanId(left?.actorId).localeCompare(cleanId(right?.actorId)))
      : [];
    for (const saved of restoredOccupants) {
      const actorId = cleanId(saved?.actorId);
      const building = contractById.get(cleanId(saved?.buildingId));
      const slot = building?.slots.find(candidate => candidate.id === cleanId(saved?.slotId)) ?? null;
      const phase = cleanId(saved?.phase);
      if (!eligibleIdSet.has(actorId) || !building || !slot || !VALID_PHASES.has(phase) ||
          visits.has(actorId) || reservations.has(reservationKey(building.id, slot.id)) ||
          buildingOccupancy(building.id) >= building.capacity) continue;
      const actor = actorFor(actorId);
      if (!actor) continue;
      const lease = population.leaseManagedRoutineActor(actor, ownerId);
      if (!lease.accepted) continue;
      const entry = {
        actorId,
        actor,
        building,
        slot,
        phase,
        phaseSerial: Math.max(0, integer(saved.phaseSerial)),
        startedBucket: integer(saved.startedBucket, lastEvaluatedBucket),
        dwellDeadline: saved.dwellDeadline === null || saved.dwellDeadline === undefined
          ? null
          : finite(saved.dwellDeadline),
        requestKey: cleanRequestKey(saved.requestKey) || null,
      };
      const destination = saved.destination ?? phaseTarget(entry, phase);
      const restored = population.restoreManagedRoutineActor(actor, ownerId, {
        position: saved.position,
        yaw: saved.yaw,
        state: saved.state,
        idleMode: saved.idleMode,
        destination,
        locationId: saved.locationId ?? building.id,
        activity: saved.activity,
        arrivalRadius: saved.arrivalRadius ?? building.arrivalRadius,
        speedScale: saved.speedScale ?? building.speedScale,
        arrived: saved.arrived === true,
        dwelling: phase === INTERIOR_OCCUPANCY_PHASES.DWELL || saved.dwelling === true,
        requestKey: entry.requestKey,
      });
      if (!restored.accepted) {
        population.releaseManagedRoutineActor(actor, ownerId);
        continue;
      }
      visits.set(actorId, entry);
      reservations.set(reservationKey(building.id, slot.id), actorId);
    }
    markDirty();
    return snapshot();
  }

  function prewarm() {
    if (prewarmResult) return prewarmResult;
    let checksum = hash32(`${runtimeSeed}:${ownerId}:${visitBucketMinutes}`);
    for (const actorId of eligibleIds) checksum ^= hash32(actorId);
    let slotsPrepared = 0;
    for (const building of contracts) {
      checksum ^= hash32(`${building.id}:${building.capacity}:${building.exterior}:${building.threshold}`);
      for (const slot of building.slots) {
        checksum ^= hash32(`${slot.id}:${slot.position}:${slot.dwellMinutes}:${slot.activity}:${slot.idleMode}`);
        slotsPrepared += 1;
      }
    }
    prewarmResult = deepFreeze({
      ready: true,
      storage: "memory-only",
      diskResources: 0,
      rendererResources: 0,
      runtimeActorAllocations: 0,
      routeSearches: 0,
      liveStateMutations: 0,
      buildingsPrepared: contracts.length,
      slotsPrepared,
      actorIdsPrepared: eligibleIds.length,
      checksum: checksum >>> 0,
    });
    return prewarmResult;
  }

  function dispose() {
    if (disposed) return;
    for (const entry of [...visits.values()]) releaseEntry(entry);
    visits.clear();
    reservations.clear();
    disposed = true;
    markDirty();
  }

  return {
    update,
    snapshot,
    save,
    restore,
    prewarm,
    dispose,
    get ownerId() { return ownerId; },
    get buildings() { return contracts; },
    get eligibleActorIds() { return eligibleIds; },
    get occupantCount() { return visits.size; },
    get reservationCount() { return reservations.size; },
  };
}

export const createInteriorOccupancyDirector = createInteriorOccupancySystem;
