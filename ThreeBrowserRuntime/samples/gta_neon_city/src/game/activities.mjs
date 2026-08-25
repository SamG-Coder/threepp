export const ACTIVITY_SAVE_VERSION = 1;
export const TAXI_ACTIVITY_SAVE_VERSION = 2;

export const TAXI_DIALOGUE_KINDS = Object.freeze({
  BOARD: "board",
  CRUISE: "cruise",
  STORY_CONTEXT: "story_context",
  JOLT: "jolt",
  SAFE: "safe",
  ROUGH: "rough",
});

export const TAXI_STAGES = Object.freeze({
  IDLE: "idle",
  PICKUP: "pickup",
  BOARDING: "boarding",
  DROPOFF: "dropoff",
  COMPLETE: "complete",
  FAILED: "failed",
});

export const RACE_STAGES = Object.freeze({
  IDLE: "idle",
  STAGING: "staging",
  COUNTDOWN: "countdown",
  RACING: "racing",
  COMPLETE: "complete",
  FAILED: "failed",
});

function optionalDialogueLine(value) {
  if (value === null || value === undefined) return null;
  const line = String(value).trim();
  return line || null;
}

function fareDialogue({
  board,
  cruise,
  jolt,
  safe,
  rough,
  chapterOne = {},
  chapterTwo = {},
} = {}) {
  return Object.freeze({
    board: String(board ?? "Thanks for stopping."),
    cruise: String(cruise ?? "Steady is fine. I would rather arrive than race the clock."),
    jolt: String(jolt ?? "Easy. I am riding back here."),
    safe: String(safe ?? "Thank you. That was a good ride."),
    rough: String(rough ?? "This is close enough. I will walk."),
    story: Object.freeze({
      chapterOne: Object.freeze({
        publish: optionalDialogueLine(chapterOne.publish),
        protect: optionalDialogueLine(chapterOne.protect),
      }),
      chapterTwo: Object.freeze({
        report_now: optionalDialogueLine(chapterTwo.report_now),
        recall_then_report: optionalDialogueLine(chapterTwo.recall_then_report),
      }),
    }),
  });
}

const DEFAULT_FARES = Object.freeze([
  Object.freeze({
    id: "night-shift-harbour",
    passenger: "Samira Cole",
    role: "Home-care assistant",
    pickup: Object.freeze([-56, 0.2, -48]),
    dropoff: Object.freeze([150, 0.2, 100]),
    allowedSeconds: 82,
    baseReward: 420,
    dialogue: fareDialogue({
      board: "Harbour gate three, please. Mrs Vale locks the chain if I am more than ten minutes late.",
      cruise: "The agency moved my start time. The bus route did not move with it.",
      chapterTwo: {
        report_now: "My neighbour's car is safer parked. She also lost two shifts. She keeps saying both.",
        recall_then_report: "Seven people got calls. Her cousin drives the same fleet and did not. Seven is not eleven.",
      },
      jolt: "Easy—her insulin pen is in this bag.",
      safe: "Made it. I will call the route office tomorrow. Again.",
      rough: "Stop here. Late is cheaper than injured.",
    }),
  }),
  Object.freeze({
    id: "market-to-pulse",
    passenger: "Tomas Okafor",
    role: "Market kitchen runner",
    pickup: Object.freeze([-144, 0.04, 120]),
    dropoff: Object.freeze([8, 0.2, 7]),
    allowedSeconds: 74,
    baseReward: 390,
    dialogue: fareDialogue({
      board: "Pulse Street side entrance. Keep the trays level.",
      cruise: "The shelter can take food or fill out forms, apparently not both after six.",
      chapterOne: {
        publish: "Nia's name went online. People called her brave; she closed the stall in real life.",
        protect: "Nia's stall is open. Voss's notice is still on the wall. Do not call either fact a win.",
      },
      jolt: "Those lids are not sealed. Someone's dinner is in the footwell now.",
      safe: "Side door. No photo, please. People came to eat.",
      rough: "Here is fine. I can carry the rest.",
    }),
  }),
  Object.freeze({
    id: "westside-red-eye",
    passenger: "Inez Park",
    role: "Session guitarist",
    pickup: Object.freeze([-165.35, 0.04, -96]),
    dropoff: Object.freeze([120, 0.04, -21.35]),
    allowedSeconds: 96,
    baseReward: 510,
    dialogue: fareDialogue({
      board: "Moon Gate. The club kept us late and the night bus kept its schedule.",
      cruise: "They paid us in exposure. I still loved the set. Both things can be true.",
      jolt: "Give the brakes some warning. That guitar is older than I am.",
      safe: "Meter receipt, please. The union wants every unpaid hour and every trip home.",
      rough: "Pull over. I can replace a fare.",
    }),
  }),
]);

const DEFAULT_COURSE = Object.freeze({
  id: "harbour-loop",
  title: "HARBOUR LOOP",
  start: Object.freeze([-24, 0.04, 24]),
  checkpoints: Object.freeze([
    Object.freeze([72, 0.04, 24]),
    Object.freeze([120, 0.04, -72]),
    Object.freeze([24, 0.04, -120]),
    Object.freeze([-120, 0.04, -24]),
    Object.freeze([-24, 0.04, 24]),
  ]),
  timeLimit: 92,
  baseReward: 1800,
});

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalTime(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function point(value) {
  const source = value?.position ?? value;
  if (Array.isArray(source)) {
    return Object.freeze([
      finite(source[0]),
      finite(source[1]),
      finite(source[2]),
    ]);
  }
  return Object.freeze([
    finite(source?.x),
    finite(source?.y),
    finite(source?.z),
  ]);
}

function distanceSquared2d(a, b) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

function segmentDistanceSquared2d(start, end, target) {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return distanceSquared2d(start, target);
  const fraction = clamp(
    ((target[0] - start[0]) * dx + (target[2] - start[2]) * dz) / lengthSquared,
    0,
    1,
  );
  const closestX = start[0] + dx * fraction;
  const closestZ = start[2] + dz * fraction;
  const targetX = target[0] - closestX;
  const targetZ = target[2] - closestZ;
  return targetX * targetX + targetZ * targetZ;
}

function segmentProgress2d(start, end, target) {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return 1;
  return clamp(
    ((target[0] - start[0]) * dx + (target[2] - start[2]) * dz) / lengthSquared,
    0,
    1,
  );
}

function taxiStoryContext(value = {}) {
  const chapterOneChoice = String(
    value.chapterOneChoice ?? value.choiceResult ?? value.story?.choiceResult ?? "",
  ).trim().toLowerCase();
  const chapterTwoChoice = String(
    value.chapterTwoChoice ?? value.chapterTwo?.choiceResult ?? "",
  ).trim().toLowerCase();
  return Object.freeze({ chapterOneChoice, chapterTwoChoice });
}

function normalizedFareDialogue(value, passenger) {
  const supplied = value && typeof value === "object" ? value : {};
  const story = supplied.story && typeof supplied.story === "object" ? supplied.story : {};
  const chapterOne = supplied.chapterOne ?? story.chapterOne ?? {};
  const chapterTwo = supplied.chapterTwo ?? story.chapterTwo ?? {};
  return fareDialogue({
    board: supplied.board ?? `Thanks for stopping. I am ${passenger}.`,
    cruise: supplied.cruise,
    jolt: supplied.jolt,
    safe: supplied.safe,
    rough: supplied.rough,
    chapterOne,
    chapterTwo,
  });
}

function normalizeFare(value, index = 0) {
  const fallback = DEFAULT_FARES[index % DEFAULT_FARES.length];
  const passenger = String(value?.passenger ?? value?.label ?? fallback.passenger ?? "Night passenger");
  return Object.freeze({
    id: String(value?.id ?? fallback.id ?? `fare-${index + 1}`),
    passenger,
    role: String(value?.role ?? value?.passengerRole ?? "City passenger"),
    pickup: point(value?.pickup ?? value?.pickupPosition ?? fallback.pickup),
    dropoff: point(value?.dropoff ?? value?.dropoffPosition ?? fallback.dropoff),
    allowedSeconds: clamp(value?.allowedSeconds ?? value?.timeLimit ?? fallback.allowedSeconds, 10, 3600),
    baseReward: Math.max(0, Math.round(finite(value?.baseReward ?? value?.reward, fallback.baseReward))),
    dialogue: normalizedFareDialogue(value?.dialogue, passenger),
  });
}

function normalizeCourse(value = DEFAULT_COURSE) {
  const checkpoints = Array.isArray(value?.checkpoints) ? value.checkpoints.map(point) : DEFAULT_COURSE.checkpoints;
  if (checkpoints.length < 2) throw new RangeError("A street race requires at least two ordered checkpoints.");
  return Object.freeze({
    id: String(value?.id ?? DEFAULT_COURSE.id),
    title: String(value?.title ?? value?.name ?? DEFAULT_COURSE.title),
    start: point(value?.start ?? value?.startPosition ?? DEFAULT_COURSE.start),
    checkpoints: Object.freeze(checkpoints),
    timeLimit: clamp(value?.timeLimit ?? value?.allowedSeconds ?? DEFAULT_COURSE.timeLimit, 5, 7200),
    baseReward: Math.max(0, Math.round(finite(value?.baseReward ?? value?.reward, DEFAULT_COURSE.baseReward))),
  });
}

function qualityGrade(quality) {
  if (quality >= 0.92) return "S";
  if (quality >= 0.80) return "A";
  if (quality >= 0.65) return "B";
  if (quality >= 0.45) return "C";
  return "D";
}

function activityStatus(stage, stages) {
  if (stage === stages.IDLE) return "available";
  if (stage === stages.COMPLETE) return "completed";
  if (stage === stages.FAILED) return "failed";
  return "active";
}

function validStage(value, stages) {
  const stage = String(value ?? "");
  return Object.values(stages).includes(stage) ? stage : stages.IDLE;
}

function nonzeroSeed(value, fallback) {
  const resolved = finite(value, fallback) >>> 0;
  return resolved || fallback >>> 0 || 1;
}

function nextRandomState(state) {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return { state: value || 0x9e3779b9, value: value / 0x100000000 };
}

function vehicleMatches(assignedVehicleId, context) {
  if (context?.isTaxi === false || context?.validVehicle === false) return false;
  if (!assignedVehicleId || context?.vehicleId === null || context?.vehicleId === undefined) return true;
  return String(context.vehicleId) === assignedVehicleId;
}

const TAXI_DIALOGUE_SEEN = Object.freeze({
  BOARD: 1 << 0,
  CRUISE: 1 << 1,
  ENDING: 1 << 2,
});

const TAXI_DIALOGUE_DURATION = Object.freeze({
  [TAXI_DIALOGUE_KINDS.BOARD]: 4.8,
  [TAXI_DIALOGUE_KINDS.CRUISE]: 5.2,
  [TAXI_DIALOGUE_KINDS.STORY_CONTEXT]: 5.8,
  [TAXI_DIALOGUE_KINDS.JOLT]: 3.2,
  [TAXI_DIALOGUE_KINDS.SAFE]: 4.8,
  [TAXI_DIALOGUE_KINDS.ROUGH]: 4.2,
});

const TAXI_DIALOGUE_KIND_VALUES = new Set(Object.values(TAXI_DIALOGUE_KINDS));
const TAXI_JOLT_LINE_COOLDOWN = 4.5;
const TAXI_CRUISE_PROGRESS = 0.3;
const TAXI_CRUISE_FALLBACK_SECONDS = 10;

/**
 * Deterministic repeatable taxi work. The host only supplies a current world
 * position, speed and optional vehicle context to update(); collision/crime
 * events enter through notify(). No renderer or clock is consulted.
 */
export function createTaxiActivity(options = {}) {
  const fares = Object.freeze((options.fares?.length ? options.fares : DEFAULT_FARES)
    .map((fare, index) => normalizeFare(fare, index)));
  const config = Object.freeze({
    pickupRadius: clamp(options.pickupRadius ?? 4.2, 0.25, 50),
    dropoffRadius: clamp(options.dropoffRadius ?? 5.0, 0.25, 50),
    stopSpeed: clamp(options.stopSpeed ?? 1.1, 0, 20),
    boardingSeconds: clamp(options.boardingSeconds ?? 1.25, 0, 20),
    dropoffSeconds: clamp(options.dropoffSeconds ?? 0.75, 0, 20),
    pickupTimeLimit: clamp(options.pickupTimeLimit ?? 100, 5, 3600),
    timeBonusFraction: clamp(options.timeBonusFraction ?? 0.35, 0, 2),
    offRoadQualityRate: clamp(options.offRoadQualityRate ?? 0.012, 0, 1),
    wantedQualityRate: clamp(options.wantedQualityRate ?? 0.003, 0, 1),
  });

  let rngState = nonzeroSeed(options.seed, 0x54415849);
  let stage = TAXI_STAGES.IDLE;
  let currentFare = null;
  let lastFareId = null;
  let assignedVehicleId = null;
  let elapsed = 0;
  let activeElapsed = 0;
  let fareElapsed = 0;
  let boardingProgress = 0;
  let dropoffProgress = 0;
  let quality = 1;
  let incidents = 0;
  let completedCount = 0;
  let failedCount = 0;
  let earnedTotal = 0;
  let payout = 0;
  let startedAt = null;
  let finishedAt = null;
  let failureReason = null;
  let lastEvent = null;
  let storyContext = taxiStoryContext();
  let dialogueSerial = 0;
  let dialogueKind = null;
  let dialogueText = "";
  let dialogueContext = null;
  let dialogueRemaining = 0;
  let seenDialogueMask = 0;
  let joltLineCooldown = 0;
  let routeProgress = 0;

  function clearActiveDialogue() {
    dialogueKind = null;
    dialogueText = "";
    dialogueContext = null;
    dialogueRemaining = 0;
  }

  function tickDialogue(delta) {
    joltLineCooldown = Math.max(0, joltLineCooldown - delta);
    if (dialogueRemaining <= 0) return;
    dialogueRemaining = Math.max(0, dialogueRemaining - delta);
    if (dialogueRemaining <= 1e-9) clearActiveDialogue();
  }

  function emitDialogue(kind, text, context = null) {
    const normalizedKind = TAXI_DIALOGUE_KIND_VALUES.has(kind) ? kind : null;
    const normalizedText = optionalDialogueLine(text);
    if (!normalizedKind || !normalizedText || !currentFare) return false;
    dialogueSerial += 1;
    dialogueKind = normalizedKind;
    dialogueText = normalizedText;
    dialogueContext = context ? String(context) : null;
    dialogueRemaining = TAXI_DIALOGUE_DURATION[normalizedKind] ?? 4.2;
    return true;
  }

  function cruiseDialogue() {
    const chapterTwoChoice = storyContext.chapterTwoChoice;
    const chapterTwoLine = currentFare?.dialogue?.story?.chapterTwo?.[chapterTwoChoice] ?? null;
    if (chapterTwoLine) {
      return Object.freeze({
        kind: TAXI_DIALOGUE_KINDS.STORY_CONTEXT,
        text: chapterTwoLine,
        context: `borrowed_time:${chapterTwoChoice}`,
      });
    }
    const chapterOneChoice = storyContext.chapterOneChoice;
    const chapterOneLine = currentFare?.dialogue?.story?.chapterOne?.[chapterOneChoice] ?? null;
    if (chapterOneLine) {
      return Object.freeze({
        kind: TAXI_DIALOGUE_KINDS.STORY_CONTEXT,
        text: chapterOneLine,
        context: `home_again:${chapterOneChoice}`,
      });
    }
    return Object.freeze({
      kind: TAXI_DIALOGUE_KINDS.CRUISE,
      text: currentFare?.dialogue?.cruise ?? null,
      context: null,
    });
  }

  function emitCruiseDialogueIfReady() {
    if (!currentFare || seenDialogueMask & TAXI_DIALOGUE_SEEN.CRUISE ||
        routeProgress + 1e-9 < TAXI_CRUISE_PROGRESS && fareElapsed + 1e-9 < TAXI_CRUISE_FALLBACK_SECONDS) {
      return false;
    }
    seenDialogueMask |= TAXI_DIALOGUE_SEEN.CRUISE;
    const line = cruiseDialogue();
    return emitDialogue(line.kind, line.text, line.context);
  }

  function chooseFare(requestedId = null) {
    if (requestedId !== null && requestedId !== undefined) {
      const requested = fares.find(fare => fare.id === String(requestedId));
      if (!requested) throw new RangeError(`Unknown taxi fare: ${requestedId}`);
      return requested;
    }
    const random = nextRandomState(rngState);
    rngState = random.state;
    let index = Math.min(fares.length - 1, Math.floor(random.value * fares.length));
    if (fares.length > 1 && fares[index].id === lastFareId) index = (index + 1) % fares.length;
    return fares[index];
  }

  function begin(request = {}) {
    if ([TAXI_STAGES.PICKUP, TAXI_STAGES.BOARDING, TAXI_STAGES.DROPOFF].includes(stage)) return snapshot();
    const values = typeof request === "string" ? { vehicleId: request } : request ?? {};
    currentFare = chooseFare(values.fareId);
    lastFareId = currentFare.id;
    assignedVehicleId = values.vehicleId === null || values.vehicleId === undefined ? null : String(values.vehicleId);
    storyContext = taxiStoryContext(values);
    stage = TAXI_STAGES.PICKUP;
    activeElapsed = 0;
    fareElapsed = 0;
    boardingProgress = 0;
    dropoffProgress = 0;
    quality = 1;
    incidents = 0;
    payout = 0;
    startedAt = elapsed;
    finishedAt = null;
    failureReason = null;
    lastEvent = "fare_started";
    clearActiveDialogue();
    seenDialogueMask = 0;
    joltLineCooldown = 0;
    routeProgress = 0;
    return snapshot();
  }

  function fail(reason = "fare_failed") {
    if (![TAXI_STAGES.PICKUP, TAXI_STAGES.BOARDING, TAXI_STAGES.DROPOFF].includes(stage)) return snapshot();
    stage = TAXI_STAGES.FAILED;
    failureReason = String(reason || "fare_failed");
    failedCount += 1;
    payout = 0;
    finishedAt = elapsed;
    lastEvent = "fare_failed";
    clearActiveDialogue();
    return snapshot();
  }

  function finish() {
    if (stage !== TAXI_STAGES.DROPOFF || !currentFare) return snapshot();
    const remainingRatio = clamp((currentFare.allowedSeconds - fareElapsed) / currentFare.allowedSeconds, 0, 1);
    const timeBonus = Math.round(currentFare.baseReward * config.timeBonusFraction * remainingRatio);
    payout = Math.max(0, Math.round((currentFare.baseReward + timeBonus) * quality));
    earnedTotal += payout;
    completedCount += 1;
    stage = TAXI_STAGES.COMPLETE;
    finishedAt = elapsed;
    failureReason = null;
    lastEvent = "fare_complete";
    seenDialogueMask |= TAXI_DIALOGUE_SEEN.ENDING;
    const safeRide = quality >= 0.72;
    emitDialogue(
      safeRide ? TAXI_DIALOGUE_KINDS.SAFE : TAXI_DIALOGUE_KINDS.ROUGH,
      safeRide ? currentFare.dialogue.safe : currentFare.dialogue.rough,
    );
    return snapshot();
  }

  function notify(event = {}) {
    const type = String(event.type ?? event.kind ?? "");
    if (type === "vehicle_destroyed" || type === "passenger_abandoned") return fail(type);
    if (type === "fare_cancelled" || type === "cancel") return fail("cancelled");
    if (stage !== TAXI_STAGES.DROPOFF) return snapshot();
    if (type === "collision" || type === "impact") {
      const severity = clamp(event.severity ?? event.speed ?? event.amount ?? 1, 0, 20);
      quality = clamp(quality - 0.025 - severity * 0.018, 0.15, 1);
      incidents += 1;
      lastEvent = "passenger_jolted";
      if (joltLineCooldown <= 1e-9 && currentFare?.dialogue?.jolt) {
        emitDialogue(TAXI_DIALOGUE_KINDS.JOLT, currentFare.dialogue.jolt);
        joltLineCooldown = TAXI_JOLT_LINE_COOLDOWN;
      }
    } else if (type === "reckless_driving") {
      quality = clamp(quality - clamp(event.amount ?? 0.08, 0, 0.5), 0.15, 1);
      incidents += 1;
      lastEvent = "reckless_driving";
    }
    return snapshot();
  }

  function update(deltaValue, context = {}) {
    const delta = clamp(deltaValue, 0, 1);
    elapsed += delta;
    tickDialogue(delta);
    if (![TAXI_STAGES.PICKUP, TAXI_STAGES.BOARDING, TAXI_STAGES.DROPOFF].includes(stage) || !currentFare) {
      return snapshot();
    }
    activeElapsed += delta;
    const position = point(context.position ?? context.vehiclePosition ?? [0, 0, 0]);
    const speed = Math.max(0, finite(context.speed));
    const stopped = speed <= config.stopSpeed;
    const correctVehicle = vehicleMatches(assignedVehicleId, context);

    if (context.vehicleDestroyed) return fail("vehicle_destroyed");
    if (context.passengerAbandoned) return fail("passenger_abandoned");

    if (stage === TAXI_STAGES.PICKUP) {
      if (activeElapsed > config.pickupTimeLimit) return fail("pickup_timeout");
      if (correctVehicle && stopped && distanceSquared2d(position, currentFare.pickup) <= config.pickupRadius ** 2) {
        stage = TAXI_STAGES.BOARDING;
        boardingProgress = 0;
        lastEvent = "passenger_found";
      }
    } else if (stage === TAXI_STAGES.BOARDING) {
      const nearPickup = distanceSquared2d(position, currentFare.pickup) <= config.pickupRadius ** 2;
      if (!correctVehicle || !nearPickup) {
        stage = TAXI_STAGES.PICKUP;
        boardingProgress = 0;
        lastEvent = "pickup_interrupted";
      } else if (stopped) {
        boardingProgress = Math.min(config.boardingSeconds, boardingProgress + delta);
        if (boardingProgress + 1e-9 >= config.boardingSeconds) {
          stage = TAXI_STAGES.DROPOFF;
          fareElapsed = 0;
          dropoffProgress = 0;
          lastEvent = "passenger_boarded";
          seenDialogueMask |= TAXI_DIALOGUE_SEEN.BOARD;
          emitDialogue(TAXI_DIALOGUE_KINDS.BOARD, currentFare.dialogue.board);
        }
      }
    } else if (stage === TAXI_STAGES.DROPOFF) {
      fareElapsed += delta;
      if (!correctVehicle) return fail("wrong_vehicle");
      if (context.offRoad) quality = clamp(quality - config.offRoadQualityRate * delta, 0.15, 1);
      const wantedStars = clamp(context.wantedStars, 0, 5);
      if (wantedStars > 0) quality = clamp(quality - wantedStars * config.wantedQualityRate * delta, 0.15, 1);
      if (fareElapsed > currentFare.allowedSeconds + 1e-9) return fail("fare_timeout");
      routeProgress = Math.max(routeProgress, segmentProgress2d(currentFare.pickup, currentFare.dropoff, position));
      emitCruiseDialogueIfReady();
      const nearDropoff = distanceSquared2d(position, currentFare.dropoff) <= config.dropoffRadius ** 2;
      if (nearDropoff && stopped) {
        dropoffProgress = Math.min(config.dropoffSeconds, dropoffProgress + delta);
        if (dropoffProgress + 1e-9 >= config.dropoffSeconds) return finish();
      } else {
        dropoffProgress = 0;
      }
    }
    return snapshot();
  }

  function reset() {
    stage = TAXI_STAGES.IDLE;
    currentFare = null;
    assignedVehicleId = null;
    activeElapsed = 0;
    fareElapsed = 0;
    boardingProgress = 0;
    dropoffProgress = 0;
    quality = 1;
    incidents = 0;
    payout = 0;
    startedAt = null;
    finishedAt = null;
    failureReason = null;
    lastEvent = "fare_reset";
    storyContext = taxiStoryContext();
    clearActiveDialogue();
    seenDialogueMask = 0;
    joltLineCooldown = 0;
    routeProgress = 0;
    return snapshot();
  }

  function objective() {
    if (stage === TAXI_STAGES.IDLE) return "START A TAXI SHIFT";
    if (stage === TAXI_STAGES.PICKUP) return `PICK UP ${currentFare?.passenger ?? "THE PASSENGER"}`;
    if (stage === TAXI_STAGES.BOARDING) return "WAIT FOR THE PASSENGER";
    if (stage === TAXI_STAGES.DROPOFF) return "DRIVE TO THE DESTINATION";
    if (stage === TAXI_STAGES.COMPLETE) return "FARE COMPLETE - START ANOTHER FARE";
    return "FARE FAILED - RESET TO TRY AGAIN";
  }

  function targetPosition() {
    if (!currentFare) return null;
    if (stage === TAXI_STAGES.PICKUP || stage === TAXI_STAGES.BOARDING) return currentFare.pickup;
    if (stage === TAXI_STAGES.DROPOFF) return currentFare.dropoff;
    return null;
  }

  function estimatedReward() {
    if (!currentFare) return 0;
    if (stage === TAXI_STAGES.COMPLETE) return payout;
    if (stage === TAXI_STAGES.FAILED) return 0;
    const remainingRatio = stage === TAXI_STAGES.DROPOFF
      ? clamp((currentFare.allowedSeconds - fareElapsed) / currentFare.allowedSeconds, 0, 1)
      : 1;
    const bonus = Math.round(currentFare.baseReward * config.timeBonusFraction * remainingRatio);
    return Math.max(0, Math.round((currentFare.baseReward + bonus) * quality));
  }

  function snapshot() {
    const active = currentFare !== null;
    const target = targetPosition();
    const timeLimit = currentFare?.allowedSeconds ?? 0;
    const timeRemaining = stage === TAXI_STAGES.PICKUP || stage === TAXI_STAGES.BOARDING
      ? Math.max(0, config.pickupTimeLimit - activeElapsed)
      : stage === TAXI_STAGES.DROPOFF ? Math.max(0, timeLimit - fareElapsed) : 0;
    const activeDialogue = Boolean(currentFare && dialogueKind && dialogueText && dialogueRemaining > 1e-9);
    const dialogue = Object.freeze({
      serial: dialogueSerial,
      active: activeDialogue,
      kind: activeDialogue ? dialogueKind : null,
      speaker: currentFare?.passenger ?? null,
      role: currentFare?.role ?? null,
      text: activeDialogue ? dialogueText : "",
      context: activeDialogue ? dialogueContext : null,
      remaining: activeDialogue ? dialogueRemaining : 0,
    });
    return Object.freeze({
      version: TAXI_ACTIVITY_SAVE_VERSION,
      kind: "taxi",
      id: "neon_taxi",
      title: "NIGHT SHIFT STORIES",
      stage,
      status: activityStatus(stage, TAXI_STAGES),
      objective: objective(),
      fare: active ? currentFare : null,
      fareId: currentFare?.id ?? null,
      passenger: currentFare?.passenger ?? null,
      passengerRole: currentFare?.role ?? null,
      passengerOnBoard: stage === TAXI_STAGES.DROPOFF,
      assignedVehicleId,
      targetKind: stage === TAXI_STAGES.PICKUP || stage === TAXI_STAGES.BOARDING ? "pickup" :
        stage === TAXI_STAGES.DROPOFF ? "dropoff" : null,
      targetPosition: target,
      elapsed,
      activeElapsed,
      fareElapsed,
      timeLimit,
      timeRemaining,
      boardingProgress,
      boardingRequired: config.boardingSeconds,
      boardingRatio: config.boardingSeconds > 0 ? clamp(boardingProgress / config.boardingSeconds, 0, 1) : 1,
      dropoffProgress,
      dropoffRequired: config.dropoffSeconds,
      routeProgress,
      quality,
      qualityGrade: qualityGrade(quality),
      incidents,
      estimatedReward: estimatedReward(),
      payout,
      completedCount,
      failedCount,
      earnedTotal,
      startedAt,
      finishedAt,
      failureReason,
      lastFareId,
      lastEvent,
      rngState,
      storyContext,
      dialogueSerial,
      dialogue,
      seenDialogueMask,
      joltLineCooldown,
    });
  }

  function restore(value = {}) {
    const version = Math.trunc(Number(value.version ?? ACTIVITY_SAVE_VERSION));
    if (version !== ACTIVITY_SAVE_VERSION && version !== TAXI_ACTIVITY_SAVE_VERSION) {
      throw new RangeError("Unsupported taxi activity save version.");
    }
    stage = validStage(value.stage, TAXI_STAGES);
    const configuredFare = value.fareId ? fares.find(fare => fare.id === String(value.fareId)) ?? null : null;
    // Version-one saves embedded the old anonymous fare object. Prefer the
    // configured fare with the same stable id so migration gains its authored
    // passenger profile while preserving custom fare catalogs.
    currentFare = version === ACTIVITY_SAVE_VERSION && configuredFare
      ? configuredFare
      : value.fare ? normalizeFare(value.fare)
        : configuredFare;
    if (!currentFare && ![TAXI_STAGES.IDLE, TAXI_STAGES.COMPLETE, TAXI_STAGES.FAILED].includes(stage)) {
      stage = TAXI_STAGES.IDLE;
    }
    lastFareId = value.lastFareId ? String(value.lastFareId) : currentFare?.id ?? null;
    assignedVehicleId = value.assignedVehicleId === null || value.assignedVehicleId === undefined
      ? null : String(value.assignedVehicleId);
    elapsed = Math.max(0, finite(value.elapsed));
    activeElapsed = Math.max(0, finite(value.activeElapsed));
    fareElapsed = Math.max(0, finite(value.fareElapsed));
    boardingProgress = clamp(value.boardingProgress, 0, config.boardingSeconds);
    dropoffProgress = clamp(value.dropoffProgress, 0, config.dropoffSeconds);
    quality = clamp(value.quality ?? 1, 0.15, 1);
    incidents = Math.max(0, Math.trunc(finite(value.incidents)));
    completedCount = Math.max(0, Math.trunc(finite(value.completedCount)));
    failedCount = Math.max(0, Math.trunc(finite(value.failedCount)));
    earnedTotal = Math.max(0, Math.round(finite(value.earnedTotal)));
    payout = Math.max(0, Math.round(finite(value.payout)));
    startedAt = optionalTime(value.startedAt);
    finishedAt = optionalTime(value.finishedAt);
    failureReason = value.failureReason ? String(value.failureReason) : null;
    lastEvent = value.lastEvent ? String(value.lastEvent) : null;
    rngState = nonzeroSeed(value.rngState, rngState);
    if (version >= TAXI_ACTIVITY_SAVE_VERSION) {
      storyContext = taxiStoryContext(value.storyContext ?? value);
      dialogueSerial = Math.max(0, Math.trunc(finite(value.dialogueSerial ?? value.dialogue?.serial)));
      seenDialogueMask = Math.max(0, Math.min(7, Math.trunc(finite(value.seenDialogueMask))));
      joltLineCooldown = clamp(value.joltLineCooldown, 0, TAXI_JOLT_LINE_COOLDOWN);
      routeProgress = clamp(value.routeProgress, 0, 1);
      const restoredKind = String(value.dialogue?.kind ?? "");
      const restoredText = optionalDialogueLine(value.dialogue?.text);
      const restoredRemaining = clamp(value.dialogue?.remaining, 0, 30);
      if (currentFare && TAXI_DIALOGUE_KIND_VALUES.has(restoredKind) && restoredText && restoredRemaining > 1e-9) {
        dialogueKind = restoredKind;
        dialogueText = restoredText;
        dialogueContext = value.dialogue?.context ? String(value.dialogue.context) : null;
        dialogueRemaining = restoredRemaining;
      } else clearActiveDialogue();
    } else {
      storyContext = taxiStoryContext();
      dialogueSerial = 0;
      clearActiveDialogue();
      routeProgress = 0;
      joltLineCooldown = 0;
      seenDialogueMask = stage === TAXI_STAGES.DROPOFF
        ? TAXI_DIALOGUE_SEEN.BOARD
        : stage === TAXI_STAGES.COMPLETE || stage === TAXI_STAGES.FAILED
          ? TAXI_DIALOGUE_SEEN.BOARD | TAXI_DIALOGUE_SEEN.CRUISE | TAXI_DIALOGUE_SEEN.ENDING
          : 0;
    }
    return snapshot();
  }

  return Object.freeze({
    fares,
    config,
    begin,
    update,
    notify,
    fail,
    reset,
    save: snapshot,
    restore,
    snapshot,
  });
}

/**
 * Ordered checkpoint street race. Checkpoint detection uses the travelled line
 * segment, so a fast vehicle cannot tunnel past a narrow marker between fixed
 * updates. The host owns vehicle physics and only supplies position/speed.
 */
export function createStreetRaceActivity(options = {}) {
  const course = normalizeCourse(options.course ?? options);
  const config = Object.freeze({
    startRadius: clamp(options.startRadius ?? 5.5, 0.25, 50),
    checkpointRadius: clamp(options.checkpointRadius ?? 7.0, 0.25, 100),
    stagingSpeed: clamp(options.stagingSpeed ?? 1.25, 0, 30),
    countdownSeconds: clamp(options.countdownSeconds ?? 3, 0, 30),
    timeBonusFraction: clamp(options.timeBonusFraction ?? 0.5, 0, 3),
  });

  let stage = RACE_STAGES.IDLE;
  let assignedVehicleId = null;
  let elapsed = 0;
  let activeElapsed = 0;
  let countdownRemaining = config.countdownSeconds;
  let raceTime = 0;
  let checkpointIndex = 0;
  let previousPosition = null;
  let attempts = 0;
  let completedCount = 0;
  let failedCount = 0;
  let earnedTotal = 0;
  let payout = 0;
  let bestTime = null;
  let startedAt = null;
  let finishedAt = null;
  let failureReason = null;
  let lastEvent = null;

  function begin(request = {}) {
    if ([RACE_STAGES.STAGING, RACE_STAGES.COUNTDOWN, RACE_STAGES.RACING].includes(stage)) return snapshot();
    const values = typeof request === "string" ? { vehicleId: request } : request ?? {};
    assignedVehicleId = values.vehicleId === null || values.vehicleId === undefined ? null : String(values.vehicleId);
    stage = RACE_STAGES.STAGING;
    activeElapsed = 0;
    countdownRemaining = config.countdownSeconds;
    raceTime = 0;
    checkpointIndex = 0;
    previousPosition = null;
    payout = 0;
    attempts += 1;
    startedAt = elapsed;
    finishedAt = null;
    failureReason = null;
    lastEvent = "race_staged";
    return snapshot();
  }

  function fail(reason = "race_failed") {
    if (![RACE_STAGES.STAGING, RACE_STAGES.COUNTDOWN, RACE_STAGES.RACING].includes(stage)) return snapshot();
    stage = RACE_STAGES.FAILED;
    failureReason = String(reason || "race_failed");
    failedCount += 1;
    payout = 0;
    finishedAt = elapsed;
    lastEvent = "race_failed";
    return snapshot();
  }

  function finish() {
    if (stage !== RACE_STAGES.RACING) return snapshot();
    const remainingRatio = clamp((course.timeLimit - raceTime) / course.timeLimit, 0, 1);
    payout = Math.max(0, Math.round(course.baseReward * (1 + config.timeBonusFraction * remainingRatio)));
    earnedTotal += payout;
    completedCount += 1;
    bestTime = bestTime === null ? raceTime : Math.min(bestTime, raceTime);
    stage = RACE_STAGES.COMPLETE;
    finishedAt = elapsed;
    failureReason = null;
    lastEvent = "race_complete";
    return snapshot();
  }

  function notify(event = {}) {
    const type = String(event.type ?? event.kind ?? "");
    if (type === "vehicle_destroyed") return fail("vehicle_destroyed");
    if (type === "race_cancelled" || type === "cancel") return fail("cancelled");
    if (stage === RACE_STAGES.RACING && type === "false_route") {
      raceTime = Math.min(course.timeLimit + 1, raceTime + clamp(event.penaltySeconds ?? 2, 0, 30));
      lastEvent = "time_penalty";
      if (raceTime > course.timeLimit) return fail("time_limit");
    }
    return snapshot();
  }

  function update(deltaValue, context = {}) {
    const delta = clamp(deltaValue, 0, 1);
    elapsed += delta;
    if (![RACE_STAGES.STAGING, RACE_STAGES.COUNTDOWN, RACE_STAGES.RACING].includes(stage)) return snapshot();
    activeElapsed += delta;
    const hasPosition = context.position !== undefined || context.vehiclePosition !== undefined;
    const position = point(context.position ?? context.vehiclePosition ?? previousPosition ?? course.start);
    const speed = Math.max(0, finite(context.speed));
    const correctVehicle = assignedVehicleId === null || context.vehicleId === null || context.vehicleId === undefined ||
      String(context.vehicleId) === assignedVehicleId;

    if (context.vehicleDestroyed) return fail("vehicle_destroyed");
    if (!correctVehicle) return fail("wrong_vehicle");

    if (stage === RACE_STAGES.STAGING) {
      if (hasPosition && speed <= config.stagingSpeed && distanceSquared2d(position, course.start) <= config.startRadius ** 2) {
        stage = RACE_STAGES.COUNTDOWN;
        countdownRemaining = config.countdownSeconds;
        previousPosition = position;
        lastEvent = "countdown_started";
        if (countdownRemaining <= 1e-9) {
          stage = RACE_STAGES.RACING;
          lastEvent = "race_started";
        }
      }
    } else if (stage === RACE_STAGES.COUNTDOWN) {
      if (!hasPosition || distanceSquared2d(position, course.start) > config.startRadius ** 2) {
        stage = RACE_STAGES.STAGING;
        countdownRemaining = config.countdownSeconds;
        previousPosition = null;
        lastEvent = "countdown_interrupted";
      } else {
        countdownRemaining = Math.max(0, countdownRemaining - delta);
        previousPosition = position;
        if (countdownRemaining <= 1e-9) {
          stage = RACE_STAGES.RACING;
          raceTime = 0;
          checkpointIndex = 0;
          previousPosition = position;
          lastEvent = "race_started";
        }
      }
    } else if (stage === RACE_STAGES.RACING) {
      raceTime += delta;
      if (hasPosition) {
        const segmentStart = previousPosition ?? position;
        while (checkpointIndex < course.checkpoints.length) {
          const target = course.checkpoints[checkpointIndex];
          if (segmentDistanceSquared2d(segmentStart, position, target) > config.checkpointRadius ** 2) break;
          checkpointIndex += 1;
          lastEvent = checkpointIndex === course.checkpoints.length ? "finish_crossed" : "checkpoint_reached";
          if (checkpointIndex === course.checkpoints.length) {
            previousPosition = position;
            return finish();
          }
        }
        previousPosition = position;
      }
      if (raceTime > course.timeLimit + 1e-9) return fail("time_limit");
    }
    return snapshot();
  }

  function reset() {
    stage = RACE_STAGES.IDLE;
    assignedVehicleId = null;
    activeElapsed = 0;
    countdownRemaining = config.countdownSeconds;
    raceTime = 0;
    checkpointIndex = 0;
    previousPosition = null;
    payout = 0;
    startedAt = null;
    finishedAt = null;
    failureReason = null;
    lastEvent = "race_reset";
    return snapshot();
  }

  function objective() {
    if (stage === RACE_STAGES.IDLE) return "ENTER THE STREET RACE";
    if (stage === RACE_STAGES.STAGING) return "STOP IN THE START GRID";
    if (stage === RACE_STAGES.COUNTDOWN) return "HOLD POSITION";
    if (stage === RACE_STAGES.RACING) {
      return checkpointIndex === course.checkpoints.length - 1 ? "CROSS THE FINISH" :
        `REACH CHECKPOINT ${checkpointIndex + 1} OF ${course.checkpoints.length}`;
    }
    if (stage === RACE_STAGES.COMPLETE) return "RACE WON - RESET TO RACE AGAIN";
    return "RACE FAILED - RESET TO TRY AGAIN";
  }

  function targetPosition() {
    if (stage === RACE_STAGES.STAGING || stage === RACE_STAGES.COUNTDOWN) return course.start;
    if (stage === RACE_STAGES.RACING) return course.checkpoints[checkpointIndex] ?? null;
    return null;
  }

  function estimatedReward() {
    if (stage === RACE_STAGES.COMPLETE) return payout;
    if (stage === RACE_STAGES.FAILED || stage === RACE_STAGES.IDLE) return 0;
    const remainingRatio = clamp((course.timeLimit - raceTime) / course.timeLimit, 0, 1);
    return Math.max(0, Math.round(course.baseReward * (1 + config.timeBonusFraction * remainingRatio)));
  }

  function snapshot() {
    const target = targetPosition();
    return Object.freeze({
      version: ACTIVITY_SAVE_VERSION,
      kind: "street_race",
      id: "neon_street_race",
      title: course.title,
      stage,
      status: activityStatus(stage, RACE_STAGES),
      objective: objective(),
      course,
      courseId: course.id,
      assignedVehicleId,
      targetKind: stage === RACE_STAGES.STAGING || stage === RACE_STAGES.COUNTDOWN ? "start" :
        stage === RACE_STAGES.RACING && checkpointIndex === course.checkpoints.length - 1 ? "finish" :
          stage === RACE_STAGES.RACING ? "checkpoint" : null,
      targetPosition: target,
      elapsed,
      activeElapsed,
      countdownRemaining,
      countdownDuration: config.countdownSeconds,
      raceTime,
      timeLimit: course.timeLimit,
      timeRemaining: Math.max(0, course.timeLimit - raceTime),
      checkpointIndex,
      checkpointsPassed: checkpointIndex,
      checkpointCount: course.checkpoints.length,
      progress: clamp(checkpointIndex / course.checkpoints.length, 0, 1),
      previousPosition,
      estimatedReward: estimatedReward(),
      payout,
      attempts,
      completedCount,
      failedCount,
      earnedTotal,
      bestTime,
      startedAt,
      finishedAt,
      failureReason,
      lastEvent,
    });
  }

  function restore(value = {}) {
    if (Number(value.version ?? ACTIVITY_SAVE_VERSION) !== ACTIVITY_SAVE_VERSION) {
      throw new RangeError("Unsupported street race save version.");
    }
    if (value.course && String(value.course.id ?? course.id) !== course.id) {
      throw new RangeError(`Street race save is for a different course: ${value.course.id}`);
    }
    stage = validStage(value.stage, RACE_STAGES);
    assignedVehicleId = value.assignedVehicleId === null || value.assignedVehicleId === undefined
      ? null : String(value.assignedVehicleId);
    elapsed = Math.max(0, finite(value.elapsed));
    activeElapsed = Math.max(0, finite(value.activeElapsed));
    countdownRemaining = clamp(value.countdownRemaining, 0, config.countdownSeconds);
    raceTime = clamp(value.raceTime, 0, course.timeLimit + 1);
    checkpointIndex = clamp(Math.trunc(finite(value.checkpointIndex)), 0, course.checkpoints.length);
    previousPosition = value.previousPosition ? point(value.previousPosition) : null;
    attempts = Math.max(0, Math.trunc(finite(value.attempts)));
    completedCount = Math.max(0, Math.trunc(finite(value.completedCount)));
    failedCount = Math.max(0, Math.trunc(finite(value.failedCount)));
    earnedTotal = Math.max(0, Math.round(finite(value.earnedTotal)));
    payout = Math.max(0, Math.round(finite(value.payout)));
    bestTime = optionalTime(value.bestTime);
    startedAt = optionalTime(value.startedAt);
    finishedAt = optionalTime(value.finishedAt);
    failureReason = value.failureReason ? String(value.failureReason) : null;
    lastEvent = value.lastEvent ? String(value.lastEvent) : null;
    return snapshot();
  }

  return Object.freeze({
    course,
    config,
    begin,
    update,
    notify,
    fail,
    reset,
    save: snapshot,
    restore,
    snapshot,
  });
}

export const createTaxiFareActivity = createTaxiActivity;
