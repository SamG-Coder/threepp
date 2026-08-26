export const GARAGE_SHIFT_SAVE_VERSION = 1;

export const GARAGE_SHIFT_STAGES = Object.freeze({
  CLOCK_IN: "clock_in",
  CUSTOMER_GREETING: "customer_greeting",
  INSPECTION: "inspection",
  DIAGNOSIS: "diagnosis",
  PARTS: "parts",
  REPAIR: "repair",
  SAFETY_CHECK: "safety_check",
  INVOICE: "invoice",
  COMPLETE: "complete",
});

export const PULSE_GARAGE_POSTED_HOURS = Object.freeze({
  openMinute: 7 * 60 + 30,
  lastClockInMinute: 16 * 60,
  closeMinute: 18 * 60,
  openDays: Object.freeze([0, 1, 2, 3, 4, 5]),
  dayLabels: Object.freeze(["MON", "TUE", "WED", "THU", "FRI", "SAT"]),
  label: "MON-SAT 07:30-18:00 / LAST CLOCK-IN 16:00",
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function point(value, fallback) {
  const source = value?.position ?? value ?? fallback;
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    const result = [Number(source[0]), Number(source[1]), Number(source[2])];
    if (result.every(Number.isFinite)) return Object.freeze(result);
  } else if (source && typeof source === "object") {
    const result = [Number(source.x), Number(source.y), Number(source.z)];
    if (result.every(Number.isFinite)) return Object.freeze(result);
  }
  throw new TypeError("Garage anchor positions must contain three finite coordinates.");
}

export const PULSE_GARAGE_ANCHORS = deepFreeze({
  clockIn: [-83, 0.2, 72],
  serviceDesk: [-78.5, 0.2, 68],
  inspectionBay: [-69, 0.2, 70],
  partsCounter: [-76, 0.2, 61],
  liftBay: [-61, 0.2, 70],
  safetyLane: [-52, 0.2, 70],
  office: [-78.5, 0.2, 64],
});

const PARTS = deepFreeze({
  battery_12v: { id: "battery_12v", label: "12 V AGM BATTERY" },
  terminal_kit: { id: "terminal_kit", label: "BATTERY TERMINAL SERVICE KIT" },
  front_pad_set: { id: "front_pad_set", label: "FRONT BRAKE PAD SET" },
  brake_hardware: { id: "brake_hardware", label: "BRAKE HARDWARE KIT" },
  upper_coolant_hose: { id: "upper_coolant_hose", label: "UPPER COOLANT HOSE" },
  long_life_coolant: { id: "long_life_coolant", label: "LONG-LIFE COOLANT" },
  serpentine_belt: { id: "serpentine_belt", label: "SERPENTINE BELT" },
  ignition_coil: { id: "ignition_coil", label: "IGNITION COIL" },
  spark_plug: { id: "spark_plug", label: "IRIDIUM SPARK PLUG" },
});

function clue(id, novice, trained, expert) {
  return deepFreeze({ id, novice, trained, expert });
}

function fault(id, label, request, parts, repairSeconds, clues) {
  return deepFreeze({ id, label, request, parts, repairSeconds, clues });
}

export const GARAGE_FAULTS = deepFreeze([
  fault("weak_battery", "WEAK BATTERY AND CORRODED TERMINAL",
    "It cranks slowly in the morning, and yesterday I needed a jump.",
    ["battery_12v", "terminal_kit"], 9,
    [
      clue("slow_crank", "The starter sounds slow and heavy.", "Cranking speed is low even with accessories off.", "Cranking voltage falls to 8.9 V, below the healthy loaded range."),
      clue("terminal_corrosion", "There is pale crust around one battery post.", "The positive terminal has visible corrosion and heat staining.", "Voltage drop across the positive terminal reaches 0.62 V under crank."),
      clue("resting_voltage", "The cabin lights look dim before starting.", "Battery resting voltage is lower than expected.", "Resting voltage stabilises at 11.7 V after surface charge is removed."),
    ]),
  fault("worn_front_brakes", "WORN FRONT BRAKE PADS",
    "There is a scrape when I slow down, especially coming off the motorway.",
    ["front_pad_set", "brake_hardware"], 12,
    [
      clue("brake_noise", "A sharp scrape comes from the front when the wheel turns slowly.", "The front brakes produce a rotational wear-indicator scrape.", "Noise tracks rotor speed and the wear indicator contacts the left-front rotor."),
      clue("pad_thickness", "The front pads look much thinner than the rear ones.", "Both front friction linings are close to their service limit.", "Front linings measure 2.1 mm and 2.4 mm; the rear set remains at 6.8 mm."),
      clue("pedal_feel", "The pedal feels normal, but stopping takes more effort.", "Pedal is firm with no hydraulic fade; braking effort is biased rearward.", "Hydraulics hold pressure and rotor run-out is in tolerance, isolating normal pad wear."),
    ]),
  fault("coolant_hose_leak", "LEAKING UPPER COOLANT HOSE",
    "I smell something sweet after parking, and the temperature crept up in traffic.",
    ["upper_coolant_hose", "long_life_coolant"], 11,
    [
      clue("sweet_residue", "There is a sweet smell and coloured residue near the radiator.", "Dried coolant tracks begin below the upper radiator hose.", "UV residue follows the upper-hose neck; the radiator core stays dry."),
      clue("pressure_loss", "A wet patch forms when the engine warms up.", "Cooling-system pressure drops slowly and the upper hose becomes wet.", "At 110 kPa test pressure, the hose seam beads coolant while pressure falls 9 kPa/min."),
      clue("hose_condition", "The upper hose feels swollen near its clamp.", "The hose is softened and cracked at the outlet neck.", "Heat ageing has delaminated the hose wall; clamp and outlet neck remain serviceable."),
    ]),
  fault("worn_serpentine_belt", "WORN SERPENTINE BELT",
    "There is a chirp when it rains, and the battery light flickered once at idle.",
    ["serpentine_belt"], 8,
    [
      clue("belt_chirp", "A chirp follows engine speed at the front of the motor.", "The accessory-drive chirp changes with belt load.", "A water-mist test briefly quiets the rib-side chirp, indicating belt slip rather than a bearing."),
      clue("belt_ribs", "The rubber belt has small cracks and shiny patches.", "The belt ribs are glazed and cracked across multiple ribs.", "Rib cracking exceeds the service gauge and glazing spans the alternator contact arc."),
      clue("charging_load", "The lights pulse slightly with the fan running.", "Charging voltage dips when electrical load is applied at idle.", "Alternator output is healthy when driven; belt slip causes the transient 12.4 V loaded reading."),
    ]),
  fault("failed_ignition_coil", "FAILED IGNITION COIL",
    "It shakes at traffic lights and the engine light started flashing on the way here.",
    ["ignition_coil", "spark_plug"], 10,
    [
      clue("rough_idle", "The engine shakes at idle but smooths out a little with speed.", "One cylinder contributes very little at idle.", "Cylinder three power-balance contribution is 74% below the others."),
      clue("misfire_counter", "The warning light flashes while the engine stumbles.", "The scan tool counts repeated misfires on cylinder three.", "Live data records P0303 with the cylinder-three counter rising under load."),
      clue("coil_swap", "Moving one coil makes the rough running move too.", "The misfire follows the cylinder-three coil when swapped.", "Secondary waveform shows internal coil breakdown; the plug is fuel-fouled from the sustained misfire."),
    ]),
]);

export const GARAGE_PARTS = deepFreeze(Object.values(PARTS));

const CUSTOMERS = deepFreeze([
  { id: "nadia_chen", name: "NADIA CHEN", pronouns: "she/her" },
  { id: "omar_haddad", name: "OMAR HADDAD", pronouns: "he/him" },
  { id: "leila_morgan", name: "LEILA MORGAN", pronouns: "she/her" },
  { id: "arthur_bell", name: "ARTHUR BELL", pronouns: "he/him" },
  { id: "imani_reyes", name: "IMANI REYES", pronouns: "they/them" },
  { id: "dev_singh", name: "DEV SINGH", pronouns: "he/him" },
]);

const VEHICLES = deepFreeze([
  { make: "Kobayashi", model: "Mica", year: 2014, colour: "silver" },
  { make: "Albion", model: "Comet", year: 2018, colour: "blue" },
  { make: "Tamarack", model: "Tourer", year: 2011, colour: "white" },
  { make: "Vela", model: "Cross", year: 2020, colour: "red" },
  { make: "Northstar", model: "Hatch", year: 2016, colour: "charcoal" },
  { make: "Morrow", model: "Estate", year: 2013, colour: "green" },
]);

const SAFETY_CHECKS = deepFreeze([
  { id: "fastener_torque", label: "VERIFY FASTENERS AND TORQUE MARKS" },
  { id: "leak_and_clearance", label: "CHECK LEAKS, ROUTING AND CLEARANCE" },
  { id: "operating_test", label: "COMPLETE CONTROLLED OPERATING TEST" },
]);

const STAGE_VALUES = new Set(Object.values(GARAGE_SHIFT_STAGES));
const FAULT_BY_ID = new Map(GARAGE_FAULTS.map(value => [value.id, value]));
const PART_BY_ID = new Map(GARAGE_PARTS.map(value => [value.id, value]));
const SAFETY_BY_ID = new Map(SAFETY_CHECKS.map(value => [value.id, value]));
const EMPTY_EVENTS = Object.freeze([]);
const EVENT_TYPES = new Set([
  "garage_shift_clocked_in", "garage_customer_greeted", "garage_clue_found", "garage_inspection_completed",
  "garage_diagnosis_rework", "garage_diagnosis_confirmed", "garage_parts_rework", "garage_parts_collected",
  "garage_repair_started", "garage_repair_completed", "garage_safety_check_completed", "garage_vehicle_safe",
  "garage_invoice_submitted", "garage_shift_completed",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}

function requiredInteger(value, minimum, label) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${label} must be a safe integer.`);
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function normalizeMinute(value) {
  const result = integer(value) % 1440;
  return result < 0 ? result + 1440 : result;
}

function hash32(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function configureAnchors(supplied = {}) {
  if (supplied == null || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw new TypeError("Garage anchors descriptor must be an object.");
  }
  return deepFreeze(Object.fromEntries(Object.entries(PULSE_GARAGE_ANCHORS).map(([key, fallback]) => [
    key,
    point(supplied[key] ?? fallback, fallback),
  ])));
}

function dayIsOpen(dayIndex, hours = PULSE_GARAGE_POSTED_HOURS) {
  const dayOfWeek = ((integer(dayIndex) % 7) + 7) % 7;
  return hours.openDays.includes(dayOfWeek);
}

function workOrderInternal(seed, dayIndex, slot) {
  const key = hash32(`${String(seed)}:${dayIndex}`);
  const fault = GARAGE_FAULTS[(key + slot * 3) % GARAGE_FAULTS.length];
  const customer = CUSTOMERS[(key * 3 + slot * 5) % CUSTOMERS.length];
  const vehicle = VEHICLES[(key * 7 + slot * 5) % VEHICLES.length];
  const odometerKm = 48000 + ((key >>> (slot * 3)) % 1720) * 100;
  const workOrderId = `pg-${dayIndex}-${slot + 1}-${(key + slot * 97).toString(36)}`;
  return deepFreeze({
    id: workOrderId,
    workOrderId,
    dayIndex,
    queueNumber: slot + 1,
    customerId: customer.id,
    customerName: customer.name,
    customer: { ...customer },
    request: fault.request,
    vehicle: {
      id: `${workOrderId}-vehicle`,
      ...vehicle,
      odometerKm,
    },
    _faultId: fault.id,
  });
}

function publicOrder(order) {
  const { _faultId, ...visible } = order;
  return deepFreeze(visible);
}

export function createGarageDailyWorkOrders(dayIndex, { seed = "neon-city", count = 3 } = {}) {
  const day = Math.max(0, integer(dayIndex));
  const total = Math.max(1, Math.min(GARAGE_FAULTS.length, integer(count, 3)));
  return deepFreeze(Array.from({ length: total }, (_, slot) => publicOrder(workOrderInternal(seed, day, slot))));
}

function rejected(reason, stage, detail = null) {
  return deepFreeze({ accepted: false, reason, stage, detail });
}

function accepted(stage, detail = null) {
  return deepFreeze({ accepted: true, reason: null, stage, detail });
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new RangeError(`${label} has an invalid shape.`);
  }
}

function exactStringArray(value, valid, label, { unique = true } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const result = value.map(item => String(item));
  if (result.some(item => !valid.has(item))) throw new RangeError(`${label} contains an unknown id.`);
  if (unique && new Set(result).size !== result.length) throw new RangeError(`${label} cannot contain duplicates.`);
  return result;
}

function canonicalParts(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.map(item => String(item));
  if (new Set(ids).size !== ids.length || ids.some(id => !PART_BY_ID.has(id))) return null;
  return ids.sort().join("+");
}

function sameSet(first, second) {
  return first.length === second.length && canonicalParts(first) === canonicalParts(second);
}

function distanceSquared(first, second) {
  const a = point(first, [0, 0, 0]);
  const dx = a[0] - second[0];
  const dz = a[2] - second[2];
  return dx * dx + dz * dz;
}

/**
 * Deterministic, renderer-independent apprentice job. The host owns player
 * cash/skills and applies the one-shot invoice transaction from submitInvoice.
 * Optional position fields enforce the supplied physical anchors.
 */
export function createGarageShiftSystem(options = {}) {
  const anchors = configureAnchors(options.anchors ?? {});
  const seed = String(options.seed ?? "neon-city");
  const interactionRadius = Math.max(0.5, finite(options.interactionRadius, 4.5));
  const radiusSquared = interactionRadius ** 2;
  const repairTimeScale = Math.max(0.01, finite(options.repairTimeScale, 1));
  const baseWage = Math.max(0, integer(options.baseWage, 110));
  const boardCache = new Map();

  let stage;
  let active;
  let completed;
  let dayIndex;
  let workOrderId;
  let mechanicSkill;
  let quality;
  let workMinutes;
  let timePenaltyMinutes;
  let reworkCount;
  let revealedClueIds;
  let attemptedDiagnosisIds;
  let attemptedPartsSignatures;
  let repairElapsedSeconds;
  let repairDurationSeconds;
  let safetyCheckIds;
  let payoutIssued;
  let payoutSerial;
  let totalEarned;
  let totalXp;
  let lastCompletedDay;
  let eventSerial;
  let pendingEvents;
  let lastEvent;
  let mutationSerial;
  let cachedSnapshot;
  let cachedSnapshotSerial;
  let prewarmResult = null;

  function initialize() {
    stage = GARAGE_SHIFT_STAGES.CLOCK_IN;
    active = false;
    completed = false;
    dayIndex = -1;
    workOrderId = null;
    mechanicSkill = 0;
    quality = 100;
    workMinutes = 0;
    timePenaltyMinutes = 0;
    reworkCount = 0;
    revealedClueIds = [];
    attemptedDiagnosisIds = [];
    attemptedPartsSignatures = [];
    repairElapsedSeconds = 0;
    repairDurationSeconds = 0;
    safetyCheckIds = [];
    payoutIssued = false;
    payoutSerial = 0;
    totalEarned = 0;
    totalXp = 0;
    lastCompletedDay = -1;
    eventSerial = 0;
    pendingEvents = [];
    lastEvent = "garage_ready";
    mutationSerial = 0;
    cachedSnapshot = null;
    cachedSnapshotSerial = -1;
  }

  initialize();

  function touch() {
    mutationSerial += 1;
    cachedSnapshot = null;
  }

  function emit(type, detail = {}) {
    eventSerial += 1;
    const event = deepFreeze({ serial: eventSerial, type, ...detail });
    pendingEvents.push(event);
    lastEvent = type;
    touch();
    return event;
  }

  function internalBoard(day) {
    const normalizedDay = Math.max(0, integer(day));
    let board = boardCache.get(normalizedDay);
    if (!board) {
      board = deepFreeze(Array.from({ length: 3 }, (_, slot) => workOrderInternal(seed, normalizedDay, slot)));
      boardCache.set(normalizedDay, board);
    }
    return board;
  }

  function dailyWorkOrders(day = 0) {
    return deepFreeze(internalBoard(day).map(publicOrder));
  }

  function currentInternalOrder() {
    if (workOrderId === null || dayIndex < 0) return null;
    return internalBoard(dayIndex).find(order => order.id === workOrderId) ?? null;
  }

  function currentFault() {
    return FAULT_BY_ID.get(currentInternalOrder()?._faultId) ?? null;
  }

  function availability(context = {}) {
    const day = Math.max(0, integer(context.dayIndex ?? context.gameDay ?? 0));
    const minute = normalizeMinute(context.minuteOfDay ?? finite(context.timeHours, 12) * 60);
    const isWorkDay = dayIsOpen(day);
    const doorsOpen = isWorkDay && minute >= PULSE_GARAGE_POSTED_HOURS.openMinute && minute < PULSE_GARAGE_POSTED_HOURS.closeMinute;
    const canClockIn = doorsOpen && minute <= PULSE_GARAGE_POSTED_HOURS.lastClockInMinute && !active && lastCompletedDay !== day;
    return deepFreeze({
      open: doorsOpen,
      canClockIn,
      reason: active ? "shift_active" : lastCompletedDay === day ? "one_shift_per_day" :
        !isWorkDay ? "closed_day" : minute < PULSE_GARAGE_POSTED_HOURS.openMinute ? "not_open_yet" :
          minute > PULSE_GARAGE_POSTED_HOURS.lastClockInMinute ? "clock_in_closed" : null,
      dayIndex: day,
      minuteOfDay: minute,
      postedHours: PULSE_GARAGE_POSTED_HOURS,
      workOrders: dailyWorkOrders(day),
    });
  }

  function targetForStage(value = stage) {
    const key = value === GARAGE_SHIFT_STAGES.CLOCK_IN ? "clockIn" :
      value === GARAGE_SHIFT_STAGES.CUSTOMER_GREETING ? "serviceDesk" :
      value === GARAGE_SHIFT_STAGES.INSPECTION || value === GARAGE_SHIFT_STAGES.DIAGNOSIS ? "inspectionBay" :
      value === GARAGE_SHIFT_STAGES.PARTS ? "partsCounter" :
      value === GARAGE_SHIFT_STAGES.REPAIR ? "liftBay" :
      value === GARAGE_SHIFT_STAGES.SAFETY_CHECK ? "safetyLane" :
      value === GARAGE_SHIFT_STAGES.INVOICE ? "office" : null;
    return key ? { key, position: anchors[key] } : { key: null, position: null };
  }

  function locationRejection(context, anchorKey) {
    if (context?.inVehicle === true) return "on_foot_required";
    if (context?.position != null && distanceSquared(context.position, anchors[anchorKey]) > radiusSquared) return "too_far";
    return null;
  }

  function clockIn(context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.CLOCK_IN || active) return rejected("shift_already_active", stage);
    const access = availability(context);
    if (!access.canClockIn) return rejected(access.reason ?? "unavailable", stage);
    const locationReason = locationRejection(context, "clockIn");
    if (locationReason) return rejected(locationReason, stage, anchors.clockIn);
    const requestedId = String(context.workOrderId ?? access.workOrders[0].id);
    const selected = internalBoard(access.dayIndex).find(order => order.id === requestedId);
    if (!selected) return rejected("unknown_work_order", stage, requestedId);
    active = true;
    completed = false;
    dayIndex = access.dayIndex;
    workOrderId = selected.id;
    mechanicSkill = clamp(context.mechanicSkill ?? context.skills?.mechanic ?? 0, 0, 100);
    quality = 100;
    workMinutes = 0;
    timePenaltyMinutes = 0;
    reworkCount = 0;
    revealedClueIds = [];
    attemptedDiagnosisIds = [];
    attemptedPartsSignatures = [];
    repairElapsedSeconds = 0;
    repairDurationSeconds = 0;
    safetyCheckIds = [];
    payoutIssued = false;
    stage = GARAGE_SHIFT_STAGES.CUSTOMER_GREETING;
    emit("garage_shift_clocked_in", { dayIndex, workOrderId, customerId: selected.customerId });
    return accepted(stage, publicOrder(selected));
  }

  function greetCustomer(context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.CUSTOMER_GREETING) return rejected("wrong_stage", stage);
    const locationReason = locationRejection(context, "serviceDesk");
    if (locationReason) return rejected(locationReason, stage, anchors.serviceDesk);
    const order = currentInternalOrder();
    stage = GARAGE_SHIFT_STAGES.INSPECTION;
    workMinutes += 3;
    emit("garage_customer_greeted", {
      workOrderId,
      customerId: order.customerId,
      request: order.request,
    });
    return accepted(stage, deepFreeze({ customerId: order.customerId, customerName: order.customerName, request: order.request }));
  }

  function clueView(source) {
    const tier = mechanicSkill >= 70 ? "expert" : mechanicSkill >= 30 ? "trained" : "novice";
    return deepFreeze({
      id: source.id,
      tier,
      clarity: tier === "expert" ? 0.95 : tier === "trained" ? 0.72 : 0.45,
      observation: source[tier],
    });
  }

  function inspect(context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.INSPECTION) return rejected("wrong_stage", stage);
    const locationReason = locationRejection(context, "inspectionBay");
    if (locationReason) return rejected(locationReason, stage, anchors.inspectionBay);
    const faultValue = currentFault();
    const next = faultValue.clues.find(value => !revealedClueIds.includes(value.id));
    if (!next) return rejected("inspection_complete", stage);
    revealedClueIds.push(next.id);
    workMinutes += mechanicSkill >= 70 ? 3 : mechanicSkill >= 30 ? 4 : 5;
    const result = clueView(next);
    emit("garage_clue_found", { workOrderId, clueId: next.id, clueTier: result.tier });
    if (revealedClueIds.length === faultValue.clues.length) {
      stage = GARAGE_SHIFT_STAGES.DIAGNOSIS;
      emit("garage_inspection_completed", { workOrderId, clueCount: revealedClueIds.length });
    }
    return accepted(stage, result);
  }

  function diagnose(diagnosisId, context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.DIAGNOSIS) return rejected("wrong_stage", stage);
    const locationReason = locationRejection(context, "inspectionBay");
    if (locationReason) return rejected(locationReason, stage, anchors.inspectionBay);
    const id = String(diagnosisId ?? "");
    if (!FAULT_BY_ID.has(id)) return rejected("unknown_diagnosis", stage, id);
    if (attemptedDiagnosisIds.includes(id)) return rejected("diagnosis_already_tried", stage, id);
    const correct = id === currentFault().id;
    if (!correct) {
      attemptedDiagnosisIds.push(id);
      quality = Math.max(40, quality - 9);
      timePenaltyMinutes += 12;
      workMinutes += 12;
      reworkCount += 1;
      emit("garage_diagnosis_rework", { workOrderId, attemptedDiagnosisId: id, safe: true, harm: false });
      return accepted(stage, deepFreeze({ correct: false, reworkRequired: true, safe: true, harm: false }));
    }
    stage = GARAGE_SHIFT_STAGES.PARTS;
    workMinutes += 4;
    emit("garage_diagnosis_confirmed", { workOrderId, diagnosisId: id });
    return accepted(stage, deepFreeze({ correct: true, diagnosisId: id }));
  }

  function collectParts(partIds, context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.PARTS) return rejected("wrong_stage", stage);
    const locationReason = locationRejection(context, "partsCounter");
    if (locationReason) return rejected(locationReason, stage, anchors.partsCounter);
    const signature = canonicalParts(partIds);
    if (signature === null) return rejected("invalid_parts", stage);
    if (attemptedPartsSignatures.includes(signature)) return rejected("parts_already_tried", stage, signature);
    const correct = sameSet(partIds, currentFault().parts);
    if (!correct) {
      attemptedPartsSignatures.push(signature);
      quality = Math.max(40, quality - 6);
      timePenaltyMinutes += 8;
      workMinutes += 8;
      reworkCount += 1;
      emit("garage_parts_rework", { workOrderId, partIds: [...partIds].sort(), safe: true, installed: false });
      return accepted(stage, deepFreeze({ correct: false, reworkRequired: true, installed: false, safe: true }));
    }
    stage = GARAGE_SHIFT_STAGES.REPAIR;
    repairDurationSeconds = currentFault().repairSeconds * repairTimeScale * (1.08 - mechanicSkill * 0.0028);
    repairElapsedSeconds = 0;
    workMinutes += 5;
    emit("garage_parts_collected", { workOrderId, partIds: [...partIds].sort() });
    emit("garage_repair_started", { workOrderId, durationSeconds: repairDurationSeconds });
    return accepted(stage, deepFreeze({ partIds: [...partIds].sort(), durationSeconds: repairDurationSeconds }));
  }

  function update(deltaSeconds = 0, context = {}) {
    const dt = clamp(deltaSeconds, 0, 1);
    if (stage === GARAGE_SHIFT_STAGES.REPAIR && context.working !== false && dt > 0) {
      const before = repairElapsedSeconds;
      repairElapsedSeconds = Math.min(repairDurationSeconds, repairElapsedSeconds + dt);
      workMinutes += (repairElapsedSeconds - before) * 2;
      if (repairElapsedSeconds >= repairDurationSeconds) {
        stage = GARAGE_SHIFT_STAGES.SAFETY_CHECK;
        emit("garage_repair_completed", { workOrderId });
      } else touch();
    }
    return context.captureSnapshot === false ? null : snapshot();
  }

  function performSafetyCheck(checkId, context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.SAFETY_CHECK) return rejected("wrong_stage", stage);
    const locationReason = locationRejection(context, "safetyLane");
    if (locationReason) return rejected(locationReason, stage, anchors.safetyLane);
    const id = String(checkId ?? "");
    if (!SAFETY_BY_ID.has(id)) return rejected("unknown_safety_check", stage, id);
    if (safetyCheckIds.includes(id)) return rejected("safety_check_already_done", stage, id);
    safetyCheckIds.push(id);
    workMinutes += 4;
    emit("garage_safety_check_completed", { workOrderId, checkId: id });
    if (safetyCheckIds.length === SAFETY_CHECKS.length) {
      stage = GARAGE_SHIFT_STAGES.INVOICE;
      emit("garage_vehicle_safe", { workOrderId, checkCount: safetyCheckIds.length });
    }
    return accepted(stage, SAFETY_BY_ID.get(id));
  }

  function payoutForCurrentState() {
    const wage = baseWage + Math.round(quality * 0.7);
    const xp = 15 + Math.round(quality * 0.5);
    return deepFreeze({
      serial: payoutSerial + 1,
      workOrderId,
      wage,
      mechanicXp: xp,
      quality,
      reworkCount,
      workMinutes: Math.round(workMinutes * 1000) / 1000,
    });
  }

  function submitInvoice(context = {}) {
    if (stage !== GARAGE_SHIFT_STAGES.INVOICE) return rejected(payoutIssued ? "invoice_already_submitted" : "wrong_stage", stage);
    const locationReason = locationRejection(context, "office");
    if (locationReason) return rejected(locationReason, stage, anchors.office);
    if (payoutIssued) return rejected("invoice_already_submitted", stage);
    const transaction = payoutForCurrentState();
    payoutSerial = transaction.serial;
    payoutIssued = true;
    totalEarned += transaction.wage;
    totalXp += transaction.mechanicXp;
    active = false;
    completed = true;
    lastCompletedDay = dayIndex;
    stage = GARAGE_SHIFT_STAGES.COMPLETE;
    emit("garage_invoice_submitted", { workOrderId, payoutSerial });
    emit("garage_shift_completed", {
      transactionSerial: transaction.serial,
      workOrderId: transaction.workOrderId,
      wage: transaction.wage,
      mechanicXp: transaction.mechanicXp,
      quality: transaction.quality,
      reworkCount: transaction.reworkCount,
      workMinutes: transaction.workMinutes,
    });
    return accepted(stage, transaction);
  }

  function objective() {
    return stage === GARAGE_SHIFT_STAGES.CLOCK_IN ? "CLOCK IN AT PULSE GARAGE" :
      stage === GARAGE_SHIFT_STAGES.CUSTOMER_GREETING ? "GREET THE CUSTOMER AND LISTEN" :
      stage === GARAGE_SHIFT_STAGES.INSPECTION ? "INSPECT THE VEHICLE METHODICALLY" :
      stage === GARAGE_SHIFT_STAGES.DIAGNOSIS ? "CHOOSE A DIAGNOSIS FROM THE EVIDENCE" :
      stage === GARAGE_SHIFT_STAGES.PARTS ? "COLLECT THE CORRECT PARTS" :
      stage === GARAGE_SHIFT_STAGES.REPAIR ? "COMPLETE THE REPAIR" :
      stage === GARAGE_SHIFT_STAGES.SAFETY_CHECK ? "PROVE THE VEHICLE IS SAFE" :
      stage === GARAGE_SHIFT_STAGES.INVOICE ? "WRITE AN HONEST INVOICE" : "SHIFT COMPLETE";
  }

  function snapshot() {
    if (cachedSnapshot && cachedSnapshotSerial === mutationSerial) return cachedSnapshot;
    const order = currentInternalOrder();
    const faultValue = currentFault();
    const target = targetForStage();
    cachedSnapshot = deepFreeze({
      version: GARAGE_SHIFT_SAVE_VERSION,
      id: "pulse_garage_apprentice",
      kind: "mechanic",
      title: "PULSE GARAGE APPRENTICE",
      status: active ? "active" : completed ? "completed" : "available",
      postedHours: PULSE_GARAGE_POSTED_HOURS,
      stage,
      active,
      completed,
      objective: objective(),
      dayIndex,
      workOrder: order ? publicOrder(order) : null,
      customerId: order?.customerId ?? null,
      customerName: order?.customerName ?? null,
      request: order?.request ?? null,
      mechanicSkill,
      clueTier: mechanicSkill >= 70 ? "expert" : mechanicSkill >= 30 ? "trained" : "novice",
      inspectionClues: faultValue ? faultValue.clues.filter(value => revealedClueIds.includes(value.id)).map(clueView) : [],
      inspectionProgress: faultValue ? revealedClueIds.length / faultValue.clues.length : 0,
      diagnosisChoices: GARAGE_FAULTS.map(value => ({ id: value.id, label: value.label })),
      partsCatalog: GARAGE_PARTS,
      safetyChecks: SAFETY_CHECKS.map(value => ({ ...value, completed: safetyCheckIds.includes(value.id) })),
      quality,
      workMinutes,
      timePenaltyMinutes,
      reworkCount,
      repairProgress: repairDurationSeconds > 0 ? repairElapsedSeconds / repairDurationSeconds : 0,
      repairElapsedSeconds,
      repairDurationSeconds,
      targetAnchorKey: target.key,
      targetPosition: target.position,
      targetKind: target.position ? "interaction" : null,
      payoutIssued,
      payoutSerial,
      totalEarned,
      totalXp,
      lastCompletedDay,
      eventSerial,
      pendingEventCount: pendingEvents.length,
      lastEvent,
      storage: "memory-only",
    });
    cachedSnapshotSerial = mutationSerial;
    return cachedSnapshot;
  }

  const SAVE_KEYS = [
    "version", "stage", "active", "completed", "dayIndex", "workOrderId", "mechanicSkill", "quality",
    "workMinutes", "timePenaltyMinutes", "reworkCount", "revealedClueIds", "attemptedDiagnosisIds",
    "attemptedPartsSignatures", "repairElapsedSeconds", "repairDurationSeconds", "safetyCheckIds",
    "payoutIssued", "payoutSerial", "totalEarned", "totalXp", "lastCompletedDay", "eventSerial",
    "pendingEvents", "lastEvent",
  ];

  function save() {
    return deepFreeze({
      version: GARAGE_SHIFT_SAVE_VERSION,
      stage, active, completed, dayIndex, workOrderId, mechanicSkill, quality, workMinutes,
      timePenaltyMinutes, reworkCount, revealedClueIds: [...revealedClueIds],
      attemptedDiagnosisIds: [...attemptedDiagnosisIds], attemptedPartsSignatures: [...attemptedPartsSignatures],
      repairElapsedSeconds, repairDurationSeconds, safetyCheckIds: [...safetyCheckIds], payoutIssued,
      payoutSerial, totalEarned, totalXp, lastCompletedDay, eventSerial,
      pendingEvents: pendingEvents.map(event => ({ ...event })), lastEvent,
    });
  }

  function restore(value) {
    assertRecord(value, "Garage shift save");
    assertExactKeys(value, SAVE_KEYS, "Garage shift save");
    if (value.version !== GARAGE_SHIFT_SAVE_VERSION) throw new RangeError("Unsupported Garage shift save version.");
    if (!STAGE_VALUES.has(value.stage)) throw new RangeError("Garage shift save has an unknown stage.");
    if (typeof value.active !== "boolean" || typeof value.completed !== "boolean" || typeof value.payoutIssued !== "boolean") {
      throw new TypeError("Garage shift save flags must be boolean.");
    }
    const restoredDay = requiredInteger(value.dayIndex, -1, "Garage dayIndex");
    const restoredOrderId = value.workOrderId === null ? null : String(value.workOrderId);
    const restoredOrder = restoredOrderId === null || restoredDay < 0 ? null : internalBoard(restoredDay).find(order => order.id === restoredOrderId);
    if ((value.stage === GARAGE_SHIFT_STAGES.CLOCK_IN) !== (restoredOrder === null)) throw new RangeError("Garage shift stage and work order disagree.");
    if (restoredOrderId !== null && !restoredOrder) throw new RangeError("Garage shift save references an unknown work order.");
    const skill = finite(value.mechanicSkill, NaN);
    const restoredQuality = finite(value.quality, NaN);
    const restoredWorkMinutes = finite(value.workMinutes, NaN);
    const restoredPenalty = finite(value.timePenaltyMinutes, NaN);
    const restoredRepairElapsed = finite(value.repairElapsedSeconds, NaN);
    const restoredRepairDuration = finite(value.repairDurationSeconds, NaN);
    if (![skill, restoredQuality, restoredWorkMinutes, restoredPenalty, restoredRepairElapsed, restoredRepairDuration].every(Number.isFinite) ||
        skill < 0 || skill > 100 || restoredQuality < 0 || restoredQuality > 100 || restoredWorkMinutes < 0 || restoredPenalty < 0 ||
        restoredRepairElapsed < 0 || restoredRepairDuration < 0 || restoredRepairElapsed > restoredRepairDuration) {
      throw new RangeError("Garage shift save contains invalid numeric progress.");
    }
    const faultValue = restoredOrder ? FAULT_BY_ID.get(restoredOrder._faultId) : null;
    const clueIds = exactStringArray(value.revealedClueIds, new Set(faultValue?.clues.map(item => item.id) ?? []), "Garage revealed clues");
    const diagnosisIds = exactStringArray(value.attemptedDiagnosisIds, new Set(GARAGE_FAULTS.map(item => item.id)), "Garage diagnosis attempts");
    if (faultValue && diagnosisIds.includes(faultValue.id)) throw new RangeError("Correct diagnosis cannot be recorded as rework.");
    if (!Array.isArray(value.attemptedPartsSignatures) || new Set(value.attemptedPartsSignatures).size !== value.attemptedPartsSignatures.length ||
        value.attemptedPartsSignatures.some(signature => {
          if (typeof signature !== "string") return true;
          const ids = signature.split("+");
          return ids.length === 0 || ids.some(id => !PART_BY_ID.has(id)) || ids.sort().join("+") !== signature;
        })) {
      throw new RangeError("Garage parts attempts are invalid.");
    }
    const checkIds = exactStringArray(value.safetyCheckIds, new Set(SAFETY_CHECKS.map(item => item.id)), "Garage safety checks");
    const restoredRework = requiredInteger(value.reworkCount, 0, "Garage reworkCount");
    if (restoredRework !== diagnosisIds.length + value.attemptedPartsSignatures.length ||
        restoredPenalty !== diagnosisIds.length * 12 + value.attemptedPartsSignatures.length * 8 ||
        restoredQuality !== Math.max(40, 100 - diagnosisIds.length * 9 - value.attemptedPartsSignatures.length * 6)) {
      throw new RangeError("Garage rework, time and quality ledger disagree.");
    }
    const stageOrder = Object.values(GARAGE_SHIFT_STAGES);
    const stageIndex = stageOrder.indexOf(value.stage);
    const expectedCluePrefix = faultValue?.clues.slice(0, clueIds.length).map(item => item.id) ?? [];
    if (clueIds.some((id, index) => id !== expectedCluePrefix[index])) {
      throw new RangeError("Garage revealed clues must preserve inspection order.");
    }
    if (stageIndex >= stageOrder.indexOf(GARAGE_SHIFT_STAGES.DIAGNOSIS) && clueIds.length !== (faultValue?.clues.length ?? 0)) {
      throw new RangeError("Garage diagnosis requires a complete inspection.");
    }
    if (stageIndex < stageOrder.indexOf(GARAGE_SHIFT_STAGES.PARTS) && restoredRepairDuration !== 0) {
      throw new RangeError("Garage repair duration cannot precede a confirmed diagnosis and parts collection.");
    }
    if (stageIndex >= stageOrder.indexOf(GARAGE_SHIFT_STAGES.REPAIR) && restoredRepairDuration <= 0) {
      throw new RangeError("Garage repair stages require a duration.");
    }
    if (stageIndex >= stageOrder.indexOf(GARAGE_SHIFT_STAGES.REPAIR)) {
      const expectedDuration = faultValue.repairSeconds * repairTimeScale * (1.08 - skill * 0.0028);
      if (Math.abs(restoredRepairDuration - expectedDuration) > 1e-9) {
        throw new RangeError("Garage repair duration does not match fault and skill.");
      }
    }
    if (value.stage === GARAGE_SHIFT_STAGES.REPAIR && restoredRepairElapsed >= restoredRepairDuration) {
      throw new RangeError("A completed repair cannot remain in repair stage.");
    }
    if (stageIndex > stageOrder.indexOf(GARAGE_SHIFT_STAGES.REPAIR) && restoredRepairElapsed !== restoredRepairDuration) {
      throw new RangeError("Post-repair stages require completed repair progress.");
    }
    if (stageIndex < stageOrder.indexOf(GARAGE_SHIFT_STAGES.SAFETY_CHECK) && checkIds.length) {
      throw new RangeError("Safety checks cannot precede repair completion.");
    }
    if (stageIndex >= stageOrder.indexOf(GARAGE_SHIFT_STAGES.INVOICE) && checkIds.length !== SAFETY_CHECKS.length) {
      throw new RangeError("Invoice requires every safety check.");
    }
    const shouldBeActive = value.stage !== GARAGE_SHIFT_STAGES.CLOCK_IN && value.stage !== GARAGE_SHIFT_STAGES.COMPLETE;
    if (value.completed !== (value.stage === GARAGE_SHIFT_STAGES.COMPLETE) || value.payoutIssued !== value.completed ||
        value.active !== shouldBeActive) {
      throw new RangeError("Garage completion flags disagree.");
    }
    const restoredPayoutSerial = requiredInteger(value.payoutSerial, 0, "Garage payoutSerial");
    const restoredEarned = requiredInteger(value.totalEarned, 0, "Garage totalEarned");
    const restoredXp = requiredInteger(value.totalXp, 0, "Garage totalXp");
    if (value.payoutIssued && (restoredPayoutSerial < 1 || restoredEarned < baseWage || restoredXp < 1)) {
      throw new RangeError("Garage payout ledger is invalid.");
    }
    if (!Array.isArray(value.pendingEvents)) throw new TypeError("Garage pendingEvents must be an array.");
    const restoredEventSerial = requiredInteger(value.eventSerial, 0, "Garage eventSerial");
    let previousSerial = 0;
    for (const event of value.pendingEvents) {
      assertRecord(event, "Garage pending event");
      const serial = requiredInteger(event.serial, 1, "Garage pending event serial");
      if (serial <= previousSerial || serial > restoredEventSerial || !EVENT_TYPES.has(event.type)) {
        throw new RangeError("Garage pending events must have ordered valid serials.");
      }
      previousSerial = serial;
    }
    if (typeof value.lastEvent !== "string" || (value.pendingEvents.length && value.lastEvent !== value.pendingEvents.at(-1).type)) {
      throw new RangeError("Garage lastEvent does not match pending event order.");
    }

    stage = value.stage; active = value.active; completed = value.completed; dayIndex = restoredDay;
    workOrderId = restoredOrderId; mechanicSkill = skill; quality = restoredQuality; workMinutes = restoredWorkMinutes;
    timePenaltyMinutes = restoredPenalty; reworkCount = restoredRework; revealedClueIds = clueIds;
    attemptedDiagnosisIds = diagnosisIds; attemptedPartsSignatures = [...value.attemptedPartsSignatures];
    repairElapsedSeconds = restoredRepairElapsed; repairDurationSeconds = restoredRepairDuration; safetyCheckIds = checkIds;
    payoutIssued = value.payoutIssued; payoutSerial = restoredPayoutSerial; totalEarned = restoredEarned;
    const restoredLastCompletedDay = requiredInteger(value.lastCompletedDay, -1, "Garage lastCompletedDay");
    if (value.completed && restoredLastCompletedDay !== restoredDay) throw new RangeError("Completed garage day ledger is invalid.");
    totalXp = restoredXp; lastCompletedDay = restoredLastCompletedDay; eventSerial = restoredEventSerial;
    pendingEvents = value.pendingEvents.map(event => deepFreeze(structuredClone(event)));
    lastEvent = String(value.lastEvent);
    touch();
    return snapshot();
  }

  function drainEvents() {
    if (!pendingEvents.length) return EMPTY_EVENTS;
    const result = Object.freeze(pendingEvents.splice(0, pendingEvents.length));
    touch();
    return result;
  }

  function reset() {
    if (active) throw new RangeError("Cannot reset an active Garage shift.");
    const earned = totalEarned;
    const xp = totalXp;
    const payoutCount = payoutSerial;
    const completedDay = lastCompletedDay;
    const serial = eventSerial;
    const events = pendingEvents;
    const eventName = lastEvent;
    initialize();
    totalEarned = earned;
    totalXp = xp;
    payoutSerial = payoutCount;
    lastCompletedDay = completedDay;
    eventSerial = serial;
    pendingEvents = events;
    lastEvent = eventName;
    touch();
    return snapshot();
  }

  function prewarm() {
    if (prewarmResult) return prewarmResult;
    const before = JSON.stringify(save());
    let checksum = 0;
    for (const faultValue of GARAGE_FAULTS) {
      for (const clueValue of faultValue.clues) {
        checksum = (checksum + hash32(clueValue.novice) + hash32(clueValue.trained) + hash32(clueValue.expert)) >>> 0;
      }
      checksum = (checksum + hash32(faultValue.id) + faultValue.parts.reduce((sum, id) => sum + hash32(id), 0)) >>> 0;
    }
    for (let day = 0; day < 7; ++day) {
      for (const order of internalBoard(day)) checksum = (checksum + hash32(order.id) + hash32(order.request)) >>> 0;
    }
    if (JSON.stringify(save()) !== before) throw new Error("Garage prewarm mutated live shift state.");
    prewarmResult = deepFreeze({
      ready: true,
      storage: "memory-only",
      faultsPrepared: GARAGE_FAULTS.length,
      cluesPrepared: GARAGE_FAULTS.reduce((sum, value) => sum + value.clues.length, 0),
      partsPrepared: GARAGE_PARTS.length,
      stagesPrepared: Object.keys(GARAGE_SHIFT_STAGES).length,
      boardDaysPrepared: 7,
      runtimeAssetsCreated: 0,
      liveStateUnchanged: true,
      checksum,
    });
    return prewarmResult;
  }

  return Object.freeze({
    availability,
    dailyWorkOrders,
    clockIn,
    greetCustomer,
    inspect,
    diagnose,
    collectParts,
    update,
    advance: update,
    performSafetyCheck,
    submitInvoice,
    snapshot,
    save,
    restore,
    drainEvents,
    reset,
    prewarm,
    anchors,
    postedHours: PULSE_GARAGE_POSTED_HOURS,
    faults: GARAGE_FAULTS,
    parts: GARAGE_PARTS,
    safetyChecks: SAFETY_CHECKS,
  });
}

export const createPulseGarageShift = createGarageShiftSystem;
