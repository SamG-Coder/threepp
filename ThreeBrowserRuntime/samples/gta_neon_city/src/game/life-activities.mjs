export const LIFE_ACTIVITY_SAVE_VERSION = 3;

export const LIFE_STAGES = Object.freeze({
  IDLE: "idle",
  ACTIVE: "active",
  COMPLETE: "complete",
  FAILED: "failed",
});

function point(value) {
  const source = value?.position ?? value;
  if (Array.isArray(source)) return Object.freeze([Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0]);
  return Object.freeze([Number(source?.x) || 0, Number(source?.y) || 0, Number(source?.z) || 0]);
}

function stop(label, position, action = "arrive", seconds = 0.7) {
  return Object.freeze({ label: String(label), position: point(position), action: String(action), seconds: Math.max(0, Number(seconds) || 0) });
}

function consequence(chapterId, choiceId, unresolvedCost) {
  return Object.freeze({
    chapterId: String(chapterId),
    choiceId: String(choiceId),
    unresolvedCost: String(unresolvedCost),
  });
}

export const LIFE_ACTIVITY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "pulse_parcels",
    kind: "courier",
    title: "PULSE PARCELS",
    description: "Help Juno deliver repaired parts and neighbourhood orders.",
    hub: point([-144, 0.2, 68]),
    hubLabel: "PULSE GARAGE DISPATCH",
    requiredVehicleKind: "van",
    timeLimit: 210,
    baseReward: 720,
    trustReward: 2,
    stops: Object.freeze([
      stop("NORTH MARKET PARTS COUNTER", [-144, 0.2, 120], "arrive", 0.8),
      stop("PULSE PARK COMMUNITY KITCHEN", [-57, 0.2, -48], "arrive", 0.8),
      stop("HARBOUR NIGHT WORKSHOP", [150, 0.2, 100], "arrive", 0.8),
    ]),
  }),
  Object.freeze({
    id: "city_lens",
    kind: "photography",
    title: "CITY LENS",
    description: "Photograph everyday Neon City for Rin's community archive.",
    hub: point([150, 0.2, 100]),
    hubLabel: "HARBOUR PHOTO WALK",
    onFoot: true,
    timeLimit: 0,
    baseReward: 420,
    trustReward: 2,
    stops: Object.freeze([
      stop("FRAME THE HARBOUR AND MOON GATE", [148, 0.2, 82], "interact"),
      stop("FRAME THE PULSE PARK FOUNTAIN", [-48, 0.2, -48], "interact"),
      stop("FRAME THE NORTH MARKET MURAL", [-144, 0.2, 120], "interact"),
    ]),
  }),
  Object.freeze({
    id: "pulse_park_run",
    kind: "fitness",
    title: "PULSE PARK 5K",
    description: "Run a safe marked circuit and beat your personal time.",
    hub: point([-57, 0.2, -48]),
    hubLabel: "PARK RUN START",
    onFoot: true,
    timeLimit: 115,
    baseReward: 280,
    trustReward: 1,
    stops: Object.freeze([
      stop("EAST GATE", [-31, 0.2, -48], "arrive", 0),
      stop("RIVER PATH", [-48, 0.2, -77], "arrive", 0),
      stop("WEST GARDEN", [-78, 0.2, -48], "arrive", 0),
      stop("FOUNTAIN FINISH", [-57, 0.2, -24], "arrive", 0),
    ]),
  }),
  Object.freeze({
    id: "neighbourhood_hands",
    kind: "volunteer",
    title: "NEIGHBOURHOOD HANDS",
    description: "Collect litter and report damaged street furniture.",
    hub: point([8, 0.2, 7]),
    hubLabel: "COMMUNITY NOTICEBOARD",
    onFoot: true,
    timeLimit: 0,
    baseReward: 180,
    trustReward: 3,
    stops: Object.freeze([
      stop("CLEAR THE BUS SHELTER", [48, 0.2, -16.5], "interact"),
      stop("REPORT THE BROKEN PARK BENCH", [-56, 0.2, -40], "interact"),
      stop("SORT THE WATERFRONT RECYCLING", [139, 0.2, 28], "interact"),
    ]),
  }),
  Object.freeze({
    id: "pulse_line",
    kind: "transit",
    title: "PULSE LINE",
    description: "Run the free westbound community shuttle from Pulse Station. Stop fully, lower the ramp, and give people time to board safely.",
    hub: point([48, 0.2, -16.5]),
    hubLabel: "PULSE STATION COMMUNITY SHUTTLE",
    requiredVehicleKind: "van",
    requiredVehicleAccess: "pulse-line",
    timeLimit: 150,
    baseReward: 340,
    trustReward: 2,
    stops: Object.freeze([
      stop("PULSE STATION — LOWER THE ACCESS RAMP", [48, 0.04, -21.35], "arrive", 2.5),
      stop("CIVIC PLAZA — WAIT FOR THE MOBILITY AID", [0, 0.04, -21.35], "arrive", 2.5),
      stop("PULSE PARK — LET THE SCHOOL GROUP SETTLE", [-48, 0.04, -21.35], "arrive", 2.5),
      stop("WESTSIDE CLINIC — HOLD FOR THE CARE WORKER", [-96, 0.04, -21.35], "arrive", 2.5),
      stop("WESTSIDE TERMINUS — CHECK EVERYONE IS CLEAR", [-144, 0.04, -21.35], "arrive", 2.5),
    ]),
  }),
  Object.freeze({
    id: "pulse_roadside",
    kind: "mechanic",
    title: "PULSE ROADSIDE",
    description: "Take the service van to stranded drivers, diagnose the fault on foot, and get ordinary people home.",
    hub: point([-132, 0.2, 68]),
    hubLabel: "PULSE GARAGE SERVICE DESK",
    requiredVehicleKind: "van",
    timeLimit: 240,
    baseReward: 960,
    trustReward: 3,
    stops: Object.freeze([
      stop("THE STALLED TAXI BY PULSE STATION", [48, 0.2, -16.5], "arrive", 0.8),
      stop("EXIT AND FIT THE TAXI'S SPARE BELT", [48, 0.2, -16.5], "interact"),
      stop("THE MARKET VENDOR'S FLAT BATTERY", [-96, 0.2, 120], "arrive", 0.8),
      stop("EXIT AND TEST THE CHARGING CIRCUIT", [-96, 0.2, 120], "interact"),
      stop("THE NIGHT-SHIFT WORKER AT THE HARBOUR", [139, 0.2, 28], "arrive", 0.8),
      stop("EXIT AND REPLACE THE FAILED FUSE", [139, 0.2, 28], "interact"),
    ]),
  }),
  Object.freeze({
    id: "safe_passage",
    kind: "aftermath",
    title: "SAFE PASSAGE",
    description: "The release stopped Voss but exposed coerced sources. Move Nia's records and help the people named by your decision.",
    hub: point([-132, 0.2, 78]),
    hubLabel: "JUNO'S WITNESS-SAFETY BOARD",
    requiredVehicleKind: "van",
    requiresChoice: "publish",
    consequence: consequence(
      "home_again",
      "publish",
      "The public release stopped Voss's vote but exposed coerced people who never chose to become witnesses.",
    ),
    timeLimit: 220,
    baseReward: 640,
    trustReward: 4,
    stops: Object.freeze([
      stop("NIA'S SHUTTERED NORTH MARKET SHOP", [-144, 0.2, 120], "arrive", 0.8),
      stop("EXIT AND SECURE NIA'S CUSTOMER RECORDS", [-144, 0.2, 120], "interact"),
      stop("THE UNION COUNSEL'S WESTSIDE OFFICE", [-132, 0.2, -112], "arrive", 0.8),
      stop("EXIT AND HAND THE RECORDS TO COUNSEL", [-132, 0.2, -112], "interact"),
    ]),
  }),
  Object.freeze({
    id: "paper_trail",
    kind: "aftermath",
    title: "PAPER TRAIL",
    description: "You protected the sources and bought Voss time. Document the new harm your delay allows before the injunction closes.",
    hub: point([-176, 0.2, -152]),
    hubLabel: "WESTSIDE SEALED CASE TABLE",
    onFoot: true,
    requiresChoice: "protect",
    consequence: consequence(
      "home_again",
      "protect",
      "Sealing the source list protected coerced people but bought Voss time to create harm the delay could not name in advance.",
    ),
    timeLimit: 0,
    baseReward: 640,
    trustReward: 4,
    stops: Object.freeze([
      stop("RECORD THE HARBOUR SAFETY BARRIER VOSS REMOVED", [139, 0.2, 28], "interact"),
      stop("INTERVIEW THE DISPLACED PULSE STREET TENANT", [48, 0.2, -16.5], "interact"),
      stop("PHOTOGRAPH THE FALSE NOTICE AT NORTH MARKET", [-144, 0.2, 120], "interact"),
    ]),
  }),
  Object.freeze({
    id: "open_ledger",
    kind: "aftermath",
    title: "THE OPEN LEDGER",
    description: "The immediate report froze Southline's evidence but publicly grounded eleven customers and closed Pulse for thirty days. Take the service van to support owners stranded by the open recall.",
    hub: point([-160, 0.2, -128]),
    hubLabel: "WESTSIDE PUBLIC RECALL SUPPORT DESK",
    requiredVehicleKind: "van",
    requiresChapterTwoChoice: "report_now",
    consequence: consequence(
      "borrowed_time",
      "report_now",
      "The broad notice may reach four unknown drivers, but it exposed named customers, grounded innocent owners without warning, and left Pulse workers without shifts.",
    ),
    timeLimit: 240,
    baseReward: 620,
    trustReward: 4,
    stops: Object.freeze([
      stop("MARA'S CAR, GROUNDED BEFORE HER NIGHT-BUS SHIFT", [-160, 0.2, -112], "arrive", 0.8),
      stop("EXIT, VERIFY THE BATCH AND BOOK A SAFE TOW", [-160, 0.2, -112], "interact"),
      stop("THE HOME-CARE NURSE STRANDED AT PULSE STATION", [48, 0.2, -16.5], "arrive", 0.8),
      stop("EXIT, ISSUE A LOANER—DO NOT CLEAR THE CAR", [48, 0.2, -16.5], "interact"),
      stop("THE MARKET CATERER'S GROUNDED FAMILY VAN", [-160, 0.2, 127.7], "arrive", 0.8),
      stop("EXIT, LOG THE LOST SHIFT AND ARRANGE A RIDE HOME", [-160, 0.2, 127.7], "interact"),
    ]),
  }),
  Object.freeze({
    id: "the_missing_four",
    kind: "aftermath",
    title: "THE MISSING FOUR",
    description: "The six-hour recall parked seven known cars, but gave Voss time to move the manifest and left four drivers unnamed. Trace the missing fleet records without treating the seven calls as a clean ending.",
    hub: point([-160, 0.2, -152]),
    hubLabel: "SOUTHLINE FLEET-RECORDS TABLE",
    onFoot: true,
    requiresChapterTwoChoice: "recall_then_report",
    consequence: consequence(
      "borrowed_time",
      "recall_then_report",
      "Seven known drivers were protected first, while four unknown drivers remained at risk and Southline gained six hours to remove original evidence.",
    ),
    timeLimit: 0,
    baseReward: 620,
    trustReward: 4,
    stops: Object.freeze([
      stop("PHOTOGRAPH THE FOUR CUT-OUT MANIFEST ROWS", [-151.5, 0.2, -128], "interact"),
      stop("RECOVER THE NIGHT DRIVER'S CARBON COPY", [-160, 0.2, -112], "interact"),
      stop("MATCH THE MUNICIPAL FLEET VINS TO THE RECALL", [-80, 0.2, -152], "interact"),
      stop("FILE THE GAPS—FOUR UNKNOWN DRIVERS ARE STILL AT RISK", [-176, 0.2, -136], "interact"),
    ]),
  }),
]);

function distanceSquared(a, b) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

function normalizedPosition(value) {
  return point(value?.position ?? value ?? [0, 0, 0]);
}

function definitionFor(id) {
  return LIFE_ACTIVITY_DEFINITIONS.find(definition => definition.id === String(id ?? "")) ?? null;
}

function unlocked(definition, context = {}) {
  if (definition?.requiresChoice && definition.requiresChoice !== String(context.choiceResult ?? context.chapterOneChoice ?? "")) {
    return false;
  }
  const chapterTwoChoice = context.chapterTwoChoice ?? context.chapterTwo?.choiceResult ?? null;
  if (definition?.requiresChapterTwoChoice && definition.requiresChapterTwoChoice !== String(chapterTwoChoice ?? "")) {
    return false;
  }
  return true;
}

const LIFE_ACTIVITY_PREWARM_ROUTES = Object.freeze([
  Object.freeze({
    id: "pulse_line",
    context: Object.freeze({ vehicleKind: "van", vehicleAccess: "pulse-line", inVehicle: true }),
  }),
  Object.freeze({
    id: "open_ledger",
    incompatibleId: "the_missing_four",
    context: Object.freeze({ chapterTwoChoice: "report_now", vehicleKind: "van", inVehicle: true }),
  }),
  Object.freeze({
    id: "the_missing_four",
    incompatibleId: "open_ledger",
    context: Object.freeze({ chapterTwoChoice: "recall_then_report", inVehicle: false }),
  }),
]);

export function createLifeActivitySystem({ reachRadius = 4.4, interactionRadius = 3.4 } = {}) {
  const reachSquared = Math.max(0.5, Number(reachRadius) || 4.4) ** 2;
  const interactSquared = Math.max(0.5, Number(interactionRadius) || 3.4) ** 2;
  let definition = null;
  let stage = LIFE_STAGES.IDLE;
  let stopIndex = 0;
  let elapsed = 0;
  let activeElapsed = 0;
  let dwell = 0;
  let payout = 0;
  let completedCount = 0;
  let failedCount = 0;
  let lastEvent = null;
  let failureReason = null;
  let eventSerial = 0;
  const emitted = [];
  const availableCache = new Map();
  const publicViews = new Map(LIFE_ACTIVITY_DEFINITIONS.map(candidate => [candidate.id, Object.freeze({
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    description: candidate.description,
    hubPosition: candidate.hub,
    hubLabel: candidate.hubLabel,
    requiredVehicleKind: candidate.requiredVehicleKind ?? null,
    requiredVehicleAccess: candidate.requiredVehicleAccess ?? null,
    onFoot: Boolean(candidate.onFoot),
    reward: candidate.baseReward,
    trustReward: candidate.trustReward,
    consequenceOf: candidate.requiresChoice ?? candidate.requiresChapterTwoChoice ?? null,
    consequence: candidate.consequence ?? null,
  })]));

  function emit(type, detail = {}) {
    eventSerial += 1;
    const event = Object.freeze({ type: String(type), eventSerial, ...detail });
    emitted.push(event);
    return event;
  }

  function requiredVehicleRejection(candidate, context = {}) {
    if (candidate.requiredVehicleKind && String(context.vehicleKind ?? "") !== candidate.requiredVehicleKind) {
      return Object.freeze({
        accepted: false,
        reason: `${candidate.requiredVehicleKind}_required`,
        activity: candidate.id,
        requiredVehicleKind: candidate.requiredVehicleKind,
        requiredVehicleAccess: candidate.requiredVehicleAccess ?? null,
      });
    }
    if (candidate.requiredVehicleAccess && String(context.vehicleAccess ?? "") !== candidate.requiredVehicleAccess) {
      return Object.freeze({
        accepted: false,
        reason: "vehicle_access_required",
        activity: candidate.id,
        requiredVehicleKind: candidate.requiredVehicleKind ?? null,
        requiredVehicleAccess: candidate.requiredVehicleAccess,
      });
    }
    return null;
  }

  function nearby(value, radius = 7, context = {}) {
    const position = normalizedPosition(value);
    const maximum = Math.max(0, Number(radius) || 7) ** 2;
    let nearest = null;
    let nearestDistance = maximum;
    for (const candidate of LIFE_ACTIVITY_DEFINITIONS) {
      if (!unlocked(candidate, context)) continue;
      const squared = distanceSquared(position, candidate.hub);
      if (squared <= nearestDistance) {
        nearest = candidate;
        nearestDistance = squared;
      }
    }
    return nearest ? Object.freeze({ ...nearest, distance: Math.sqrt(nearestDistance) }) : null;
  }

  function begin(id, context = {}) {
    const candidate = definitionFor(id);
    if (!candidate) throw new RangeError(`Unknown life activity: ${id}`);
    if (!unlocked(candidate, context)) {
      return Object.freeze({ accepted: false, reason: "story_choice_required", activity: candidate.id });
    }
    if (stage === LIFE_STAGES.ACTIVE) return snapshot();
    if (candidate.onFoot && context.inVehicle) return Object.freeze({ accepted: false, reason: "on_foot_required", activity: candidate.id });
    const vehicleRejection = requiredVehicleRejection(candidate, context);
    if (vehicleRejection) return vehicleRejection;
    definition = candidate;
    stage = LIFE_STAGES.ACTIVE;
    stopIndex = 0;
    activeElapsed = 0;
    dwell = 0;
    payout = 0;
    failureReason = null;
    lastEvent = "activity_started";
    return snapshot();
  }

  function completeStop() {
    if (!definition || stage !== LIFE_STAGES.ACTIVE) return snapshot();
    lastEvent = "stop_completed";
    stopIndex += 1;
    dwell = 0;
    if (stopIndex >= definition.stops.length) {
      stage = LIFE_STAGES.COMPLETE;
      const timeBonus = definition.timeLimit > 0
        ? Math.round(definition.baseReward * 0.24 * Math.max(0, 1 - activeElapsed / definition.timeLimit))
        : 0;
      payout = definition.baseReward + timeBonus;
      completedCount += 1;
      lastEvent = "activity_completed";
      if (definition.kind === "aftermath" && definition.consequence?.chapterId === "borrowed_time") {
        emit("aftermath_completed", {
          chapterId: definition.consequence.chapterId,
          choiceId: definition.consequence.choiceId,
          hookId: definition.id,
          activityId: definition.id,
        });
      }
    }
    return snapshot();
  }

  function fail(reason = "activity_failed") {
    if (stage !== LIFE_STAGES.ACTIVE) return snapshot();
    stage = LIFE_STAGES.FAILED;
    failureReason = String(reason || "activity_failed");
    payout = 0;
    failedCount += 1;
    lastEvent = "activity_failed";
    return snapshot();
  }

  function notify(event = {}) {
    const type = String(event.type ?? event.kind ?? "");
    if (type === "cancel" || type === "activity_cancelled") return fail("cancelled");
    if (type !== "interact" || stage !== LIFE_STAGES.ACTIVE || !definition) return snapshot();
    const current = definition.stops[stopIndex];
    if (current.action !== "interact") return snapshot();
    if (event.inVehicle) {
      lastEvent = "leave_vehicle";
      return snapshot();
    }
    const position = normalizedPosition(event.position);
    if (distanceSquared(position, current.position) > interactSquared) {
      lastEvent = "interaction_too_far";
      return snapshot();
    }
    return completeStop();
  }

  function update(deltaValue, context = {}) {
    const delta = Math.max(0, Math.min(0.25, Number(deltaValue) || 0));
    elapsed += delta;
    if (stage !== LIFE_STAGES.ACTIVE || !definition) return snapshot();
    activeElapsed += delta;
    if (definition.timeLimit > 0 && activeElapsed > definition.timeLimit + 1e-9) return fail("time_expired");
    if (definition.onFoot && context.inVehicle) {
      dwell = 0;
      lastEvent = "leave_vehicle";
      return snapshot();
    }
    if (definition.requiredVehicleKind && String(context.vehicleKind ?? "") !== definition.requiredVehicleKind) {
      dwell = 0;
      lastEvent = "return_to_work_vehicle";
      return snapshot();
    }
    if (definition.requiredVehicleAccess && String(context.vehicleAccess ?? "") !== definition.requiredVehicleAccess) {
      dwell = 0;
      lastEvent = "return_to_authorized_vehicle";
      return snapshot();
    }
    const current = definition.stops[stopIndex];
    if (current.action === "interact") return snapshot();
    const position = normalizedPosition(context.position);
    const nearbyTarget = distanceSquared(position, current.position) <= reachSquared;
    const stopped = Math.abs(Number(context.speed) || 0) <= 1.1;
    if (!nearbyTarget || (!definition.onFoot && !stopped)) {
      dwell = 0;
      return snapshot();
    }
    dwell += delta;
    if (dwell + 1e-9 >= current.seconds) return completeStop();
    return snapshot();
  }

  function reset() {
    definition = null;
    stage = LIFE_STAGES.IDLE;
    stopIndex = 0;
    activeElapsed = 0;
    dwell = 0;
    payout = 0;
    failureReason = null;
    lastEvent = "activity_reset";
    return snapshot();
  }

  function save() {
    return {
      version: LIFE_ACTIVITY_SAVE_VERSION,
      definitionId: definition?.id ?? null,
      stage,
      stopIndex,
      elapsed,
      activeElapsed,
      dwell,
      payout,
      completedCount,
      failedCount,
      lastEvent,
      failureReason,
      eventSerial,
      pendingEvents: emitted.map(event => ({ ...event })),
      requiredVehicleKind: definition?.requiredVehicleKind ?? null,
      requiredVehicleAccess: definition?.requiredVehicleAccess ?? null,
    };
  }

  function restore(value = {}) {
    const version = Math.trunc(Number(value.version) || 0);
    if (version !== 2 && version !== LIFE_ACTIVITY_SAVE_VERSION) {
      throw new RangeError(`Unsupported life activity save version: ${value.version}`);
    }
    definition = definitionFor(value.definitionId);
    stage = Object.values(LIFE_STAGES).includes(value.stage) && definition ? value.stage : LIFE_STAGES.IDLE;
    stopIndex = definition ? Math.max(0, Math.min(definition.stops.length, Math.trunc(Number(value.stopIndex) || 0))) : 0;
    elapsed = Number.isFinite(Number(value.elapsed)) ? Math.max(0, Number(value.elapsed)) : 0;
    activeElapsed = Number.isFinite(Number(value.activeElapsed)) ? Math.max(0, Number(value.activeElapsed)) : 0;
    dwell = Number.isFinite(Number(value.dwell)) ? Math.max(0, Number(value.dwell)) : 0;
    payout = Number.isFinite(Number(value.payout)) ? Math.max(0, Math.round(Number(value.payout))) : 0;
    completedCount = Number.isFinite(Number(value.completedCount)) ? Math.max(0, Math.trunc(Number(value.completedCount))) : 0;
    failedCount = Number.isFinite(Number(value.failedCount)) ? Math.max(0, Math.trunc(Number(value.failedCount))) : 0;
    lastEvent = value.lastEvent ? String(value.lastEvent) : null;
    failureReason = value.failureReason ? String(value.failureReason) : null;
    eventSerial = version >= 3 && Number.isFinite(Number(value.eventSerial))
      ? Math.max(0, Math.trunc(Number(value.eventSerial)))
      : 0;
    emitted.length = 0;
    if (version >= 3 && Array.isArray(value.pendingEvents)) {
      const seenSerials = new Set();
      for (const candidate of value.pendingEvents) {
        const activity = definitionFor(candidate?.hookId ?? candidate?.activityId);
        const serial = Math.max(0, Math.trunc(Number(candidate?.eventSerial) || 0));
        if (!activity || activity.kind !== "aftermath" || activity.consequence?.chapterId !== "borrowed_time" ||
            candidate?.type !== "aftermath_completed" || serial < 1 || serial > eventSerial || seenSerials.has(serial)) continue;
        if (String(candidate.chapterId ?? "") !== activity.consequence.chapterId ||
            String(candidate.choiceId ?? "") !== activity.consequence.choiceId) continue;
        seenSerials.add(serial);
        emitted.push(Object.freeze({
          type: "aftermath_completed",
          eventSerial: serial,
          chapterId: activity.consequence.chapterId,
          choiceId: activity.consequence.choiceId,
          hookId: activity.id,
          activityId: activity.id,
        }));
      }
      emitted.sort((left, right) => left.eventSerial - right.eventSerial);
    }
    return snapshot();
  }

  function snapshot() {
    const current = definition?.stops[Math.min(stopIndex, Math.max(0, (definition?.stops.length ?? 1) - 1))] ?? null;
    const status = stage === LIFE_STAGES.IDLE ? "available" : stage === LIFE_STAGES.COMPLETE ? "completed" : stage === LIFE_STAGES.FAILED ? "failed" : "active";
    const action = current?.action === "interact" ? "PRESS E" : definition?.onFoot ? "REACH" : "STOP AT";
    return Object.freeze({
      id: definition?.id ?? null,
      kind: definition?.kind ?? "life",
      title: definition?.title ?? "CITY LIFE",
      description: definition?.description ?? "",
      stage,
      status,
      objective: current && stage === LIFE_STAGES.ACTIVE
        ? `${action} ${current.label}`
        : stage === LIFE_STAGES.COMPLETE ? "ACTIVITY COMPLETE" : stage === LIFE_STAGES.FAILED ? `FAILED — ${String(failureReason).replaceAll("_", " ").toUpperCase()}` : "CHOOSE A CITY ACTIVITY",
      targetKind: current?.action === "interact" ? "interaction" : "destination",
      targetPosition: current && stage === LIFE_STAGES.ACTIVE ? current.position : null,
      hubPosition: definition?.hub ?? null,
      stopIndex,
      stopCount: definition?.stops.length ?? 0,
      activeElapsed,
      dwell,
      dwellRequired: current && stage === LIFE_STAGES.ACTIVE && current.action !== "interact" ? current.seconds : 0,
      dwellRemaining: current && stage === LIFE_STAGES.ACTIVE && current.action !== "interact" ? Math.max(0, current.seconds - dwell) : 0,
      timeRemaining: definition?.timeLimit > 0 ? Math.max(0, definition.timeLimit - activeElapsed) : null,
      payout,
      estimatedReward: definition?.baseReward ?? 0,
      trustReward: definition?.trustReward ?? 0,
      requiredVehicleKind: definition?.requiredVehicleKind ?? null,
      requiredVehicleAccess: definition?.requiredVehicleAccess ?? null,
      consequenceOf: definition?.requiresChoice ?? definition?.requiresChapterTwoChoice ?? null,
      consequence: definition?.consequence ?? null,
      completedCount,
      failedCount,
      failureReason,
      lastEvent,
      eventSerial,
      pendingEventCount: emitted.length,
    });
  }

  function drainEvents() {
    return emitted.splice(0, emitted.length);
  }

  function available(context = {}) {
    const chapterOneChoice = String(context.choiceResult ?? context.chapterOneChoice ?? "");
    const chapterTwoChoice = String(context.chapterTwoChoice ?? context.chapterTwo?.choiceResult ?? "");
    const cacheKey = `${chapterOneChoice}|${chapterTwoChoice}`;
    let views = availableCache.get(cacheKey);
    if (!views) {
      views = Object.freeze(LIFE_ACTIVITY_DEFINITIONS
        .filter(candidate => unlocked(candidate, context))
        .map(candidate => publicViews.get(candidate.id)));
      availableCache.set(cacheKey, views);
    }
    return views;
  }

  function prewarm() {
    // Warm gameplay transitions in throwaway systems. The live system is never
    // advanced or restored, so an active route and its one-shot event state stay
    // bit-for-bit identical even if prewarm is called during play.
    const liveStateBits = JSON.stringify(save());
    const liveEventBits = JSON.stringify({ lastEvent, failureReason, eventSerial, emitted });
    let beginsPrepared = 0;
    let activitiesPrepared = 0;
    let branchContextsPrepared = 0;
    let vehicleRoutesPrepared = 0;
    let onFootRoutesPrepared = 0;
    let destinationStopsPrepared = 0;
    let interactionStopsPrepared = 0;
    let updateStepsPrepared = 0;
    let completionsPrepared = 0;
    let incompatibleBranchesRejected = 0;
    let accessRoutesPrepared = 0;
    let vehicleAccessRejectionsPrepared = 0;

    for (const route of LIFE_ACTIVITY_PREWARM_ROUTES) {
      const candidate = definitionFor(route.id);
      if (!candidate) throw new Error(`Missing life-activity definition: ${route.id}`);

      const simulation = createLifeActivitySystem({
        reachRadius: Math.sqrt(reachSquared),
        interactionRadius: Math.sqrt(interactSquared),
      });
      const availableIds = simulation.available(route.context).map(activity => activity.id);
      if (!availableIds.includes(route.id) || (route.incompatibleId && availableIds.includes(route.incompatibleId))) {
        throw new Error(`Aftermath branch exclusivity failed for ${route.id}`);
      }
      if (route.incompatibleId) branchContextsPrepared += 1;

      if (route.incompatibleId) {
        const rejected = simulation.begin(route.incompatibleId, route.context);
        if (rejected.accepted !== false || rejected.reason !== "story_choice_required") {
          throw new Error(`Incompatible aftermath branch was not rejected for ${route.id}`);
        }
        incompatibleBranchesRejected += 1;
      }

      if (candidate.requiredVehicleAccess) {
        const rejected = simulation.begin(route.id, { ...route.context, vehicleAccess: "prewarm-wrong-access" });
        if (rejected.accepted !== false || rejected.reason !== "vehicle_access_required") {
          throw new Error(`Vehicle-access gate was not prepared for ${route.id}`);
        }
        accessRoutesPrepared += 1;
        vehicleAccessRejectionsPrepared += 1;
      }

      let state = simulation.begin(route.id, route.context);
      if (state.stage !== LIFE_STAGES.ACTIVE) throw new Error(`Aftermath warmup could not begin ${route.id}`);
      beginsPrepared += 1;
      activitiesPrepared += 1;
      if (candidate.requiredVehicleKind) vehicleRoutesPrepared += 1;
      if (candidate.onFoot) onFootRoutesPrepared += 1;

      while (state.stage === LIFE_STAGES.ACTIVE) {
        const preparedStopIndex = state.stopIndex;
        if (state.targetKind === "destination") {
          destinationStopsPrepared += 1;
          do {
            updateStepsPrepared += 1;
            state = simulation.update(0.25, {
              position: state.targetPosition,
              speed: 0,
              vehicleKind: candidate.requiredVehicleKind ?? null,
              vehicleAccess: candidate.requiredVehicleAccess ?? null,
              inVehicle: !candidate.onFoot,
            });
          } while (state.stage === LIFE_STAGES.ACTIVE && state.stopIndex === preparedStopIndex);
        } else {
          interactionStopsPrepared += 1;
          state = simulation.notify({
            type: "interact",
            position: state.targetPosition,
            inVehicle: false,
          });
        }
        if (state.stage === LIFE_STAGES.ACTIVE && state.stopIndex !== preparedStopIndex + 1) {
          throw new Error(`Aftermath warmup did not advance ${route.id} stop ${preparedStopIndex}`);
        }
      }

      if (state.stage !== LIFE_STAGES.COMPLETE || state.stopIndex !== candidate.stops.length) {
        throw new Error(`Aftermath warmup did not complete ${route.id}`);
      }
      completionsPrepared += 1;
    }

    const liveStatePreserved = JSON.stringify(save()) === liveStateBits;
    const liveEventStatePreserved = JSON.stringify({ lastEvent, failureReason, eventSerial, emitted }) === liveEventBits;
    if (!liveStatePreserved || !liveEventStatePreserved) {
      throw new Error("Aftermath warmup mutated the live life-activity system");
    }

    return Object.freeze({
      ready: completionsPrepared === LIFE_ACTIVITY_PREWARM_ROUTES.length,
      storage: "memory-only",
      rendererResources: 0,
      diskResources: 0,
      activitiesPrepared,
      branchContextsPrepared,
      routeKindsPrepared: Number(vehicleRoutesPrepared > 0) + Number(onFootRoutesPrepared > 0),
      vehicleRoutesPrepared,
      onFootRoutesPrepared,
      beginsPrepared,
      destinationStopsPrepared,
      interactionStopsPrepared,
      stopsPrepared: destinationStopsPrepared + interactionStopsPrepared,
      updateStepsPrepared,
      completionsPrepared,
      incompatibleBranchesRejected,
      accessRoutesPrepared,
      vehicleAccessRejectionsPrepared,
      liveStatePreserved,
      liveEventStatePreserved,
    });
  }

  return { begin, notify, update, reset, nearby, available, save, restore, snapshot, drainEvents, prewarm };
}
