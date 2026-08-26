export const CAFE_SHIFT_SAVE_VERSION = 1;

const MINUTES_PER_DAY = 24 * 60;
const VALID_SKILL_IDS = new Set(["hospitality", "community"]);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

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

function normalizeMinute(value) {
  const minute = integer(value);
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function cleanId(value, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 128);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function frozenCopy(value) {
  return deepFreeze(clone(value));
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

function skillAward(skillId, experience) {
  if (!VALID_SKILL_IDS.has(skillId)) throw new RangeError(`Unknown cafe life skill: ${skillId}`);
  return deepFreeze({ skillId, experience });
}

function schedule(activity, startMinute, endMinute, locationId, roomId = null) {
  return deepFreeze({ activity, startMinute, endMinute, locationId, roomId });
}

export const CAFE_SERVICE_MENU = deepFreeze([
  { id: "asha_breakfast_roll", name: "ASHA'S BREAKFAST ROLL", allergens: ["gluten", "egg"] },
  { id: "ginger_oat_bowl", name: "GINGER OAT BOWL", allergens: ["oats"] },
  { id: "cardamom_coffee", name: "CARDAMOM COFFEE", allergens: [] },
  { id: "tomato_lentil_toast", name: "TOMATO AND LENTIL TOAST", allergens: ["gluten"] },
]);

const CAFE_CUSTOMERS = deepFreeze(["MIRA COLE", "OWEN PARK", "LEILA HADDAD", "DEV SINGH", "INEZ BELL", "SAM KIM"]);
const ALLERGEN_NOTICES = deepFreeze([
  "The replacement oat drink is made on a line that also handles tree nuts; use the updated carton label and ask before substituting.",
  "The breakfast-roll sauce now contains sesame; the old counter card has been removed and every verbal recommendation must use the new sheet.",
  "A supplier substituted wheat wraps for the usual gluten-free pack. The sealed gluten-free reserve is marked on the upper shelf.",
  "No supplier change today. Continue separate tongs, boards, cloths, and storage for declared allergen orders.",
]);
const ACCESSIBILITY_REQUESTS = deepFreeze([
  "Keep the approach to table two fully clear for a wheelchair user booked at 08:15, and offer table service without making it a spectacle.",
  "The large-print menu is requested at the counter this morning; place it within reach instead of waiting for the customer to ask twice.",
  "One regular uses a communication card. Give them time to point, repeat the order once, and do not finish the sentence for them.",
  "Maintain the low-counter position and clear floor route all shift; ask before moving a customer's mobility aid.",
]);
const STOCK_ALERTS = deepFreeze([
  "Cardamom is low. Measure the remaining jar, mark the true count, and do not quietly weaken the recipe.",
  "The first oat-drink crate expires today. Use first-in-first-out rotation and record any sealed waste at close.",
  "Breakfast rolls are limited after a short delivery. The till count is authoritative; do not promise stock the kitchen has not confirmed.",
  "The under-counter refrigerator ran warm overnight but passed its morning check. Record every later reading and isolate stock if it rises again.",
]);
const ORDER_MODIFIERS = deepFreeze([
  "no substitution without asking",
  "takeaway with the allergen label visible",
  "serve at the accessible table",
  "half-strength coffee; confirm before making",
  "separate utensils requested",
  "eat-in; reusable ware only",
]);

export function createCafeDailyBriefing(dayIndexValue, { seed = hash32("common-ground-cafe-shift") } = {}) {
  const dayIndex = Math.max(0, integer(dayIndexValue));
  const key = hash32(`${integer(seed) >>> 0}:${dayIndex}:common-ground-service`);
  const tickets = Array.from({ length: 3 }, (_, index) => {
    const item = CAFE_SERVICE_MENU[(key + index * 5) % CAFE_SERVICE_MENU.length];
    const customerName = CAFE_CUSTOMERS[(key * 3 + index * 7) % CAFE_CUSTOMERS.length];
    const modifier = ORDER_MODIFIERS[(key + index * 11) % ORDER_MODIFIERS.length];
    const payForward = ((key >>> (index * 3)) & 7) === 3;
    return {
      id: `cg-${dayIndex}-${index + 1}`,
      customerName,
      itemId: item.id,
      itemName: item.name,
      declaredAllergens: [...item.allergens],
      modifier,
      payForward,
    };
  });
  return deepFreeze({
    dayIndex,
    allergenNotice: ALLERGEN_NOTICES[key % ALLERGEN_NOTICES.length],
    accessibilityRequest: ACCESSIBILITY_REQUESTS[(key >>> 3) % ACCESSIBILITY_REQUESTS.length],
    stockAlert: STOCK_ALERTS[(key >>> 6) % STOCK_ALERTS.length],
    openingTillFloat: 120,
    openingPayForwardCredits: (key >>> 9) % 5,
    tickets,
    purchaseLedgerOwner: "neighbourhood-routine",
    purchaseLedgerReadOnly: true,
  });
}

export const COMMON_GROUND_CAFE_HOURS = deepFreeze({
  openMinute: 6 * 60,
  lastClockInMinute: 14 * 60,
  closeMinute: 18 * 60,
  openDays: [0, 1, 2, 3, 4, 5, 6],
  label: "DAILY 06:00-18:00 / LAST SHIFT 14:00",
});

function cafeStation(id, actionId, roomId, name, {
  gameMinutes,
  realSeconds,
  minimumQuality,
  safetyRequired,
  primarySkill,
  needEffects,
  checks,
  instruction,
  honestLine,
  passLine,
  reworkLine,
}) {
  return deepFreeze({
    id,
    worldStationId: id,
    actionId,
    roomId,
    name,
    gameMinutes,
    realSeconds,
    minimumQuality,
    safetyRequired,
    primarySkill,
    needEffects,
    checks,
    instruction,
    honestLine,
    passLine,
    reworkLine,
  });
}

export const CAFE_SHIFT_STATIONS = deepFreeze([
  cafeStation("cafe-handover", "clock_in", "cafe-back-counter", "SHIFT HANDOVER", {
    gameMinutes: 16,
    realSeconds: 1.8,
    minimumQuality: 56,
    safetyRequired: true,
    primarySkill: "hospitality",
    needEffects: { energy: -1, hygiene: 0, appetite: -1 },
    checks: ["ALLERGEN CHANGES", "ACCESSIBILITY REQUESTS", "EQUIPMENT AND INCIDENT LOG"],
    instruction: "Clock in with Asha, read every allergen change and accessibility request aloud, then inspect the incident and equipment log.",
    honestLine: "ASHA: Never nod through a handover. If a note is unclear, we ask before a customer has to carry the risk.",
    passLine: "The shift notes, allergen changes, accessibility requests, and equipment state are understood.",
    reworkLine: "ASHA: Stop here. Read the missing handover notes again and tell me what changes in the way we serve today.",
  }),
  cafeStation("cafe-till", "take_order", "cafe-front-counter", "TILL AND ORDER QUEUE", {
    gameMinutes: 38,
    realSeconds: 3,
    minimumQuality: 60,
    safetyRequired: true,
    primarySkill: "hospitality",
    needEffects: { energy: -2, hygiene: 0, appetite: -2 },
    checks: ["ORDER READ-BACK", "ALLERGEN QUESTION", "ACCESSIBLE SERVICE", "PAY-FORWARD CREDIT CONFIRMATION"],
    instruction: "Greet each customer without rushing them, read the order back, ask rather than assume about allergens, adapt accessible service, and honour a pay-forward credit only against the caller-owned board count.",
    honestLine: "ASHA: Speed matters after accuracy. A queue can wait ten seconds; a person should not have to fight the counter to be heard.",
    passLine: "The order queue is recorded accurately and customers receive clear, accessible service.",
    reworkLine: "ASHA: The docket and what the customer asked for do not agree. Correct it with them before a drink or meal is prepared.",
  }),
  cafeStation("cafe-prep", "prepare_order", "cafe-kitchen", "FOOD AND DRINK PREPARATION", {
    gameMinutes: 52,
    realSeconds: 3.7,
    minimumQuality: 64,
    safetyRequired: true,
    primarySkill: "hospitality",
    needEffects: { energy: -3, hygiene: -2, appetite: -3 },
    checks: ["HAND HYGIENE", "ALLERGEN SEPARATION", "TEMPERATURE AND RECIPE"],
    instruction: "Wash and reset the bench, prepare the docket exactly, keep allergen tools separate, and record any safe-temperature check instead of guessing.",
    honestLine: "ASHA: We can remake an order. We cannot pretend cross-contact did not happen because the room is busy.",
    passLine: "The batch matches its dockets, uses separated tools, and meets its temperature and recipe checks.",
    reworkLine: "ASHA: This order cannot leave the preparation bench. Reset the tools, remake the unsafe item, and write down what went wrong.",
  }),
  cafeStation("cafe-serve", "serve_order", "cafe-customer-floor", "SERVICE PASS AND TABLES", {
    gameMinutes: 42,
    realSeconds: 3,
    minimumQuality: 61,
    safetyRequired: true,
    primarySkill: "community",
    needEffects: { energy: -2, hygiene: -1, appetite: -2 },
    checks: ["CUSTOMER MATCH", "ALLERGEN CONFIRMATION", "ACCESSIBLE TABLE ROUTE"],
    instruction: "Match every order to its customer, state the allergen-safe item clearly, use an unobstructed table route, and check that seated customers can reach what they need.",
    honestLine: "ASHA: Hospitality is not a performance. Notice the person, say what you are carrying, and fix a mistake without blaming them for it.",
    passLine: "Orders reach the correct customers with clear allergen confirmation and accessible table service.",
    reworkLine: "ASHA: The handoff is ambiguous or the route is blocked. Bring the order back, clear the path, and identify it properly.",
  }),
  cafeStation("cafe-dishes", "wash_dishes", "cafe-wash-up", "DISHES AND SANITISING", {
    gameMinutes: 34,
    realSeconds: 3.1,
    minimumQuality: 60,
    safetyRequired: true,
    primarySkill: "hospitality",
    needEffects: { energy: -3, hygiene: -3, appetite: -2 },
    checks: ["CHEMICAL SEPARATION", "WASH TEMPERATURE", "DRY STORAGE"],
    instruction: "Scrape and sort, keep chemicals away from food contact, verify the wash temperature, air-dry, and return only clean unchipped ware.",
    honestLine: "ASHA: A cup looking clean is not the same as it being clean. Follow the wash, rinse, sanitise, and dry order every time.",
    passLine: "The dish cycle is separated, temperature-checked, air-dried, and safely stored.",
    reworkLine: "ASHA: The sanitising cycle is incomplete. Run the affected rack again and correct the chemical or temperature check.",
  }),
  cafeStation("cafe-stock", "restock", "cafe-stock-room", "CLEAN, CLOSE, COUNT, AND RESTOCK", {
    gameMinutes: 30,
    realSeconds: 2.7,
    minimumQuality: 59,
    safetyRequired: true,
    primarySkill: "community",
    needEffects: { energy: -2, hygiene: -1, appetite: -2 },
    checks: ["USE-BY AND FIFO ROTATION", "COLD CHAIN", "WASTE LOG", "TILL AND PAY-FORWARD BOARD RECONCILIATION", "ACCESSIBLE AND CLEAR AISLES"],
    instruction: "Clean the station, record real waste, rotate dated stock, verify cold storage, reconcile the till and pay-forward board without changing their external ledger, and leave every accessible route clear.",
    honestLine: "ASHA: Record the real count. Hiding a shortage only hands tomorrow's worker a worse morning.",
    passLine: "The cafe is clean, waste and stock are honestly recorded, the till and pay-forward board reconcile, cold storage is sound, and routes remain clear.",
    reworkLine: "ASHA: The count, waste log, till, pay-forward board, date rotation, or route does not agree yet. Correct it before signing the close-down sheet.",
  }),
]);

const STATION_BY_ID = new Map(CAFE_SHIFT_STATIONS.map(value => [value.id, value]));

export const ASHA_PATEL = deepFreeze({
  id: "asha_patel",
  name: "Asha Patel",
  displayName: "ASHA PATEL",
  jobTitle: "OWNER AND SHIFT LEAD",
  businessId: "common_ground_cafe",
  worldAnchorId: "cafe-staff-manager",
  homeLocationId: "asha-patel-home",
  workDays: [0, 2, 3, 4, 5, 6],
  dayOff: 1,
  workSchedule: [
    schedule("sleep", 0, 300, "asha-patel-home"),
    schedule("home", 300, 310, "asha-patel-home"),
    schedule("commute", 310, 330, "pulse-core-walk"),
    schedule("opening_setup", 330, 360, "common_ground_cafe", "cafe-kitchen"),
    schedule("service", 360, 690, "common_ground_cafe", "cafe-front-counter"),
    schedule("break", 690, 720, "common_ground_cafe", "cafe-break-room"),
    schedule("service", 720, 1080, "common_ground_cafe", "cafe-front-counter"),
    schedule("close_down", 1080, 1110, "common_ground_cafe", "cafe-back-counter"),
    schedule("commute", 1110, 1140, "pulse-core-walk"),
    schedule("home", 1140, 1440, "asha-patel-home"),
  ],
  dayOffSchedule: [
    schedule("sleep", 0, 480, "asha-patel-home"),
    schedule("home", 480, 600, "asha-patel-home"),
    schedule("errands", 600, 780, "north-market"),
    schedule("leisure", 780, 960, "river-walk"),
    schedule("home", 960, 1440, "asha-patel-home"),
  ],
  dialogue: {
    handover: "The allergy sheet changed after yesterday's delivery, and table two needs the clear approach kept open. Read both before you clock in.",
    break: "I am taking the break I tell everyone else to take. Dani has the counter for thirty minutes.",
    close: "A real count helps tomorrow. Write down what is missing; do not make the shelves look fuller on paper.",
    dayOff: "Asha is off today. The cafe is open under the deputy lead, and her next shift is posted in the staff room.",
  },
});

export const COMMON_GROUND_CAFE_STAFF = deepFreeze([
  ASHA_PATEL,
  {
    id: "dani_okoro",
    name: "Dani Okoro",
    displayName: "DANI OKORO",
    jobTitle: "BARISTA AND DEPUTY LEAD",
    businessId: "common_ground_cafe",
    worldAnchorId: "cafe-staff-barista",
    workDays: [0, 1, 2, 3, 4],
  },
  {
    id: "rafael_chen",
    name: "Rafael Chen",
    displayName: "RAFAEL CHEN",
    jobTitle: "KITCHEN HAND",
    businessId: "common_ground_cafe",
    worldAnchorId: "cafe-staff-kitchen",
    workDays: [1, 2, 3, 4, 5, 6],
  },
]);

export const COMMON_GROUND_CAFE = deepFreeze({
  id: "common_ground_cafe",
  buildingId: "common-ground-cafe-building",
  name: "COMMON GROUND CAFE",
  label: "COMMON GROUND CAFE",
  address: "16 Common Ground Lane",
  districtId: "pulse-core",
  keeperId: ASHA_PATEL.id,
  activityId: "common_ground_shift",
  openingHours: COMMON_GROUND_CAFE_HOURS,
  stationIds: CAFE_SHIFT_STATIONS.map(value => value.id),
  staffIds: COMMON_GROUND_CAFE_STAFF.map(value => value.id),
  lawfulWorkplace: true,
  prohibitedActivities: ["combat", "weapons", "crime"],
});

export const COMMON_GROUND_SHIFT_ROLE = deepFreeze({
  id: "common_ground_shift",
  name: "COMMON GROUND CAFE SHIFT",
  businessId: COMMON_GROUND_CAFE.id,
  stationIds: COMMON_GROUND_CAFE.stationIds,
  baseWage: 72,
  trustReward: 2,
  skillAwards: [skillAward("hospitality", 34), skillAward("community", 10)],
  briefing: "ASHA: This is paid work because care, cleaning, and attention are work. Read the handover, ask when you are unsure, and never hide a remake or a shortage.",
  completionLine: "ASHA: Thank you. The service notes, wash log, and stock count agree. That is what lets the next shift begin without inheriting a lie.",
});

function dayOfWeek(dayIndex) {
  return ((integer(dayIndex) % 7) + 7) % 7;
}

function clockFrom(context, fallbackDay, fallbackMinute) {
  const dayValue = context?.dayIndex ?? context?.gameDay ?? context?.day;
  const minuteValue = context?.minuteOfDay ?? context?.timeMinutes
    ?? (context?.timeHours == null ? null : finite(context.timeHours) * 60);
  return {
    dayIndex: dayValue == null ? fallbackDay : Math.max(0, integer(dayValue)),
    minuteOfDay: minuteValue == null ? fallbackMinute : normalizeMinute(minuteValue),
  };
}

function staffScheduleState(definition, dayIndex, minuteOfDay) {
  if (definition.id !== ASHA_PATEL.id) {
    const working = definition.workDays.includes(dayOfWeek(dayIndex));
    const onShift = working && minuteOfDay >= COMMON_GROUND_CAFE_HOURS.openMinute
      && minuteOfDay < COMMON_GROUND_CAFE_HOURS.closeMinute;
    return deepFreeze({
      id: definition.id,
      name: definition.name,
      jobTitle: definition.jobTitle,
      worldAnchorId: definition.worldAnchorId,
      workingDay: working,
      activity: onShift ? "service" : "home",
      locationId: onShift ? COMMON_GROUND_CAFE.id : `${definition.id}-home`,
      roomId: onShift ? (definition.id === "dani_okoro" ? "cafe-front-counter" : "cafe-kitchen") : null,
      dialogue: onShift ? "The cafe is busy, but the handover sheet is current." : "Not rostered at Common Ground right now.",
    });
  }
  const working = definition.workDays.includes(dayOfWeek(dayIndex));
  const source = working ? definition.workSchedule : definition.dayOffSchedule;
  const segment = source.find(value => minuteOfDay >= value.startMinute && minuteOfDay < value.endMinute)
    ?? source[source.length - 1];
  let dialogue = definition.dialogue.handover;
  if (!working) dialogue = definition.dialogue.dayOff;
  else if (segment.activity === "break") dialogue = definition.dialogue.break;
  else if (segment.activity === "close_down") dialogue = definition.dialogue.close;
  return deepFreeze({
    id: definition.id,
    name: definition.name,
    jobTitle: definition.jobTitle,
    worldAnchorId: definition.worldAnchorId,
    workingDay: working,
    activity: segment.activity,
    locationId: segment.locationId,
    roomId: segment.roomId,
    startMinute: segment.startMinute,
    endMinute: segment.endMinute,
    dialogue,
  });
}

function rejected(reason, extra = {}) {
  return deepFreeze({ accepted: false, reason, ...extra });
}

function accepted(extra = {}) {
  return deepFreeze({ accepted: true, reason: null, ...extra });
}

function qualityInput(context) {
  return clamp(context?.quality ?? context?.workQuality ?? context?.care ?? 70, 0, 100);
}

function skillLevel(context, skillId) {
  const source = context?.skillLevels ?? context?.skills ?? {};
  const raw = source?.[skillId];
  if (raw && typeof raw === "object") return clamp(raw.level ?? raw.value ?? 0, 0, 100);
  return clamp(raw ?? context?.skillLevel ?? 0, 0, 100);
}

function safeJson(value, label, depth = 0) {
  if (depth > 8) throw new RangeError(`${label} is too deeply nested.`);
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must contain finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((child, index) => safeJson(child, `${label}[${index}]`, depth + 1));
  if (typeof value !== "object") throw new TypeError(`${label} must be JSON-safe.`);
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = safeJson(child, `${label}.${key}`, depth + 1);
  return result;
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside its valid range.`);
  }
  return value;
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || !entry || entry.length > 256) throw new RangeError(`${label}[${index}] is invalid.`);
    return entry;
  });
  if (new Set(result).size !== result.length) throw new RangeError(`${label} must not contain duplicates.`);
  return result;
}

function parseShift(value) {
  if (value == null) return null;
  requireRecord(value, "cafe shift");
  if (typeof value.id !== "string" || !value.id) throw new RangeError("cafe shift id is invalid.");
  if (!["active", "paused"].includes(value.status)) throw new RangeError("cafe shift status is invalid.");
  const taskIndex = requireInteger(value.taskIndex, 0, CAFE_SHIFT_STATIONS.length - 1, "cafe shift task index");
  if (!Array.isArray(value.stationAttempts) || value.stationAttempts.length !== CAFE_SHIFT_STATIONS.length) {
    throw new RangeError("cafe station attempts do not match the shift definition.");
  }
  const stationAttempts = value.stationAttempts.map((attempt, index) =>
    requireInteger(attempt, 0, 100000, `cafe station attempt ${index}`));
  const completedStationIds = uniqueStrings(value.completedStationIds, "cafe completed stations");
  if (completedStationIds.length !== taskIndex
    || completedStationIds.some((id, index) => id !== CAFE_SHIFT_STATIONS[index].id)) {
    throw new RangeError("cafe completed stations are out of order.");
  }
  let task = null;
  if (value.task != null) {
    requireRecord(value.task, "cafe active task");
    const station = CAFE_SHIFT_STATIONS[taskIndex];
    if (value.task.stationId !== station.id) throw new RangeError("cafe active task is at the wrong station.");
    const elapsedSeconds = finite(value.task.elapsedSeconds, NaN);
    const durationSeconds = finite(value.task.durationSeconds, NaN);
    if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0 || elapsedSeconds < 0 || elapsedSeconds >= durationSeconds + 0.000001) {
      throw new RangeError("cafe active task timing is invalid.");
    }
    task = {
      stationId: station.id,
      sourceId: value.task.sourceId == null ? null : cleanId(value.task.sourceId),
      elapsedSeconds,
      durationSeconds,
      inputQuality: clamp(value.task.inputQuality, 0, 100),
      skillLevel: clamp(value.task.skillLevel, 0, 100),
      score: clamp(value.task.score, 0, 100),
      safetyConfirmed: value.task.safetyConfirmed === true,
      attemptNumber: requireInteger(value.task.attemptNumber, 1, 100001, "cafe task attempt"),
      gameMinutes: station.gameMinutes,
    };
  }
  return {
    id: value.id,
    dayIndex: requireInteger(value.dayIndex, 0, Number.MAX_SAFE_INTEGER, "cafe shift day"),
    startMinute: requireInteger(value.startMinute, 0, 1439, "cafe shift start minute"),
    status: value.status,
    taskIndex,
    totalGameMinutes: requireInteger(value.totalGameMinutes, 0, 1000000, "cafe shift minutes"),
    qualityTotal: clamp(value.qualityTotal, 0, 10000000),
    qualitySamples: requireInteger(value.qualitySamples, 0, 100000, "cafe quality samples"),
    safetyPasses: requireInteger(value.safetyPasses, 0, 100000, "cafe safety passes"),
    reworkCount: requireInteger(value.reworkCount, 0, 100000, "cafe rework count"),
    stationAttempts,
    completedStationIds,
    task,
  };
}

function migrateLegacySave(value) {
  requireRecord(value, "cafe save");
  if (value.version !== 0) return value;
  const completedDays = Array.from(value.completedDays ?? []).map(day => Math.max(0, integer(day)));
  const transactionSources = completedDays.map(day => `common-ground-shift:${day}`);
  return {
    version: CAFE_SHIFT_SAVE_VERSION,
    seed: Number.isSafeInteger(value.seed) ? value.seed >>> 0 : hash32("common-ground-cafe-shift"),
    clock: { dayIndex: Math.max(0, integer(value.dayIndex)), minuteOfDay: normalizeMinute(value.minuteOfDay ?? 8 * 60) },
    serials: { shift: 0, command: 0, transaction: completedDays.length },
    completedDays,
    shift: null,
    sourceLedger: Array.from(value.sourceLedger ?? []),
    transactionSources,
    lastEvent: "cafe_shift_v0_migrated",
    lastStationResult: null,
    lastTransaction: null,
  };
}

function parseSave(input) {
  const value = migrateLegacySave(input);
  requireRecord(value, "cafe save");
  if (value.version !== CAFE_SHIFT_SAVE_VERSION) {
    throw new RangeError(`Unsupported cafe shift save version: ${String(value.version)}.`);
  }
  const clock = requireRecord(value.clock, "cafe clock");
  const serials = requireRecord(value.serials, "cafe serials");
  if (!Array.isArray(value.completedDays)) throw new TypeError("cafe completedDays must be an array.");
  const completedDays = value.completedDays.map((day, index) =>
    requireInteger(day, 0, Number.MAX_SAFE_INTEGER, `cafe completed day ${index}`));
  if (new Set(completedDays).size !== completedDays.length) throw new RangeError("cafe completed days must be unique.");
  const sourceLedger = uniqueStrings(value.sourceLedger, "cafe source ledger");
  const transactionSources = uniqueStrings(value.transactionSources, "cafe transaction source ledger");
  const parsed = {
    version: CAFE_SHIFT_SAVE_VERSION,
    seed: requireInteger(value.seed, 0, 0xffffffff, "cafe seed") >>> 0,
    clock: {
      dayIndex: requireInteger(clock.dayIndex, 0, Number.MAX_SAFE_INTEGER, "cafe clock day"),
      minuteOfDay: requireInteger(clock.minuteOfDay, 0, 1439, "cafe clock minute"),
    },
    serials: {
      shift: requireInteger(serials.shift, 0, Number.MAX_SAFE_INTEGER, "cafe shift serial"),
      command: requireInteger(serials.command, 0, Number.MAX_SAFE_INTEGER, "cafe command serial"),
      transaction: requireInteger(serials.transaction, 0, Number.MAX_SAFE_INTEGER, "cafe transaction serial"),
    },
    completedDays,
    shift: parseShift(value.shift),
    sourceLedger,
    transactionSources,
    lastEvent: String(value.lastEvent ?? "cafe_shift_ready").slice(0, 256),
    lastStationResult: value.lastStationResult == null ? null : safeJson(value.lastStationResult, "cafe last station result"),
    lastTransaction: value.lastTransaction == null ? null : safeJson(value.lastTransaction, "cafe last transaction"),
  };
  if (!parsed.lastEvent) throw new RangeError("cafe last event is invalid.");
  const expectedSources = new Set(completedDays.map(day => `common-ground-shift:${day}`));
  if (parsed.serials.transaction !== transactionSources.length
    || expectedSources.size !== transactionSources.length
    || transactionSources.some(source => !expectedSources.has(source))) {
    throw new RangeError("cafe completion and transaction ledgers do not agree.");
  }
  if (parsed.shift && expectedSources.has(`common-ground-shift:${parsed.shift.dayIndex}`)) {
    throw new RangeError("cafe save cannot contain a completed and active shift for the same day.");
  }
  if (parsed.lastTransaction != null) {
    if (parsed.lastTransaction.serial !== parsed.serials.transaction
      || parsed.lastTransaction.sourceId !== transactionSources[transactionSources.length - 1]
      || parsed.lastTransaction.kind !== "lawful_cafe_shift_wage"
      || parsed.lastTransaction.callerOwned !== true) {
      throw new RangeError("cafe last transaction is inconsistent with its exact ledger.");
    }
  }
  return parsed;
}

export function migrateCafeShiftSave(value) {
  return frozenCopy(parseSave(value));
}

/**
 * Deterministic, renderer-independent paid shift simulation. Cash, needs,
 * community trust, world time, and life-skill progression remain caller-owned.
 */
export function createCafeShiftSystem({
  seed = hash32("common-ground-cafe-shift"),
  initialDayIndex = 0,
  initialMinuteOfDay = 8 * 60,
} = {}) {
  let runtimeSeed = integer(seed) >>> 0;
  let dayIndex = Math.max(0, integer(initialDayIndex));
  let minuteOfDay = normalizeMinute(initialMinuteOfDay);
  let shiftSerial = 0;
  let commandSerial = 0;
  let transactionSerial = 0;
  let shift = null;
  let lastEvent = "cafe_shift_ready";
  let lastStationResult = null;
  let lastTransaction = null;
  const completedDays = new Set();
  const sourceLedger = new Set();
  const transactionSources = new Set();
  let stateRevision = 0;
  let cachedSnapshotRevision = -1;
  let cachedSnapshot = null;
  let prewarmResult = null;
  const runtimeView = {
    dayIndex,
    minuteOfDay,
    status: "idle",
    stationId: null,
    taskProgress: 0,
    taskActive: false,
    commandSerial,
    transactionSerial,
    lastStationResultSerial: 0,
    lastEvent,
    stateRevision,
  };

  function markDirty() {
    stateRevision += 1;
  }

  function syncClock(context = {}) {
    const next = clockFrom(context, dayIndex, minuteOfDay);
    if (next.dayIndex !== dayIndex || next.minuteOfDay !== minuteOfDay) markDirty();
    dayIndex = next.dayIndex;
    minuteOfDay = next.minuteOfDay;
  }

  function duplicateSource(context) {
    const sourceId = cleanId(context?.sourceId);
    return sourceId && sourceLedger.has(sourceId) ? sourceId : null;
  }

  function recordSource(context) {
    const requested = cleanId(context?.sourceId);
    if (requested) sourceLedger.add(requested);
    commandSerial += 1;
    markDirty();
    return requested || `cafe:auto:${commandSerial}`;
  }

  function expectedStation() {
    return shift ? CAFE_SHIFT_STATIONS[shift.taskIndex] ?? null : null;
  }

  function staffState(staffId = ASHA_PATEL.id, context = {}) {
    const definition = COMMON_GROUND_CAFE_STAFF.find(value => value.id === cleanId(staffId));
    if (!definition) return null;
    const clock = clockFrom(context, dayIndex, minuteOfDay);
    return staffScheduleState(definition, clock.dayIndex, clock.minuteOfDay);
  }

  function availability(context = {}) {
    const clock = clockFrom(context, dayIndex, minuteOfDay);
    const supervisor = staffScheduleState(ASHA_PATEL, clock.dayIndex, clock.minuteOfDay);
    const businessOpen = clock.minuteOfDay >= COMMON_GROUND_CAFE_HOURS.openMinute
      && clock.minuteOfDay < COMMON_GROUND_CAFE_HOURS.closeMinute;
    const withinClockIn = clock.minuteOfDay >= COMMON_GROUND_CAFE_HOURS.openMinute
      && clock.minuteOfDay <= COMMON_GROUND_CAFE_HOURS.lastClockInMinute;
    const completedToday = completedDays.has(clock.dayIndex);
    const active = shift?.status === "active";
    const paused = shift?.status === "paused";
    let reason = null;
    if (completedToday) reason = "already_completed_today";
    else if (active) reason = "already_active";
    else if (!supervisor.workingDay) reason = "supervisor_off_day";
    else if (paused && supervisor.locationId !== COMMON_GROUND_CAFE.id) reason = "supervisor_unavailable";
    else if (!paused && !businessOpen) reason = "cafe_closed";
    else if (!paused && !withinClockIn) reason = "outside_clock_in_hours";
    return deepFreeze({
      businessId: COMMON_GROUND_CAFE.id,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      dayIndex: clock.dayIndex,
      minuteOfDay: clock.minuteOfDay,
      businessOpen,
      withinClockIn,
      completedToday,
      active,
      paused,
      supervisedShiftOpen: supervisor.workingDay && supervisor.locationId === COMMON_GROUND_CAFE.id,
      available: reason == null,
      canBegin: reason == null,
      reason,
      postedHours: COMMON_GROUND_CAFE_HOURS,
      supervisor,
      dailyBriefing: createCafeDailyBriefing(clock.dayIndex, { seed: runtimeSeed }),
      nextStationId: shift ? expectedStation()?.id ?? null : CAFE_SHIFT_STATIONS[0].id,
    });
  }

  function context(contextValue = {}) {
    const clock = clockFrom(contextValue, dayIndex, minuteOfDay);
    return deepFreeze({
      cafe: COMMON_GROUND_CAFE,
      role: COMMON_GROUND_SHIFT_ROLE,
      clock,
      dailyBriefing: createCafeDailyBriefing(clock.dayIndex, { seed: runtimeSeed }),
      availability: availability(clock),
      staff: COMMON_GROUND_CAFE_STAFF.map(value => staffScheduleState(value, clock.dayIndex, clock.minuteOfDay)),
      currentShiftId: shift?.id ?? null,
      nextStationId: expectedStation()?.id ?? null,
    });
  }

  function begin(contextValue = {}) {
    syncClock(contextValue);
    const duplicate = duplicateSource(contextValue);
    if (duplicate) return rejected("duplicate_source", { sourceId: duplicate });
    if (shift?.status === "paused") {
      const state = availability({ dayIndex, minuteOfDay });
      if (!state.canBegin) return rejected(state.reason, { availability: state });
      const sourceId = recordSource(contextValue);
      shift.status = "active";
      lastEvent = "cafe_shift_resumed";
      return accepted({
        event: lastEvent,
        sourceId,
        shiftId: shift.id,
        activityId: COMMON_GROUND_SHIFT_ROLE.id,
        resumed: true,
        taskPreserved: shift.task != null,
        nextStationId: expectedStation()?.id ?? null,
        dailyBriefing: createCafeDailyBriefing(shift.dayIndex, { seed: runtimeSeed }),
        dialogue: COMMON_GROUND_SHIFT_ROLE.briefing,
      });
    }
    const state = availability({ dayIndex, minuteOfDay });
    if (!state.canBegin) return rejected(state.reason, { availability: state });
    const sourceId = recordSource(contextValue);
    shiftSerial += 1;
    shift = {
      id: `common-ground:${dayIndex}:${shiftSerial}`,
      dayIndex,
      startMinute: minuteOfDay,
      status: "active",
      taskIndex: 0,
      totalGameMinutes: 0,
      qualityTotal: 0,
      qualitySamples: 0,
      safetyPasses: 0,
      reworkCount: 0,
      stationAttempts: new Array(CAFE_SHIFT_STATIONS.length).fill(0),
      completedStationIds: [],
      task: null,
    };
    lastEvent = "cafe_shift_begun";
    lastStationResult = null;
    return accepted({
      event: lastEvent,
      sourceId,
      shiftId: shift.id,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      resumed: false,
      taskPreserved: false,
      nextStationId: expectedStation().id,
      dailyBriefing: createCafeDailyBriefing(dayIndex, { seed: runtimeSeed }),
      dialogue: COMMON_GROUND_SHIFT_ROLE.briefing,
    });
  }

  function resume(contextValue = {}) {
    if (shift?.status !== "paused") return rejected(shift ? "already_active" : "no_paused_shift");
    return begin(contextValue);
  }

  function performStation(stationId, contextValue = {}) {
    syncClock(contextValue);
    const duplicate = duplicateSource(contextValue);
    if (duplicate) return rejected("duplicate_source", { sourceId: duplicate });
    if (!shift) return rejected("no_active_shift", { stationId: cleanId(stationId) });
    if (shift.status !== "active") return rejected("shift_paused", { shiftId: shift.id });
    if (contextValue?.insideCafe !== true && contextValue?.atCafe !== true) {
      return rejected("inside_common_ground_cafe_required", { businessId: COMMON_GROUND_CAFE.id });
    }
    if (shift.task) return rejected("task_in_progress", {
      stationId: shift.task.stationId,
      progress: shift.task.elapsedSeconds / shift.task.durationSeconds,
    });
    const requested = STATION_BY_ID.get(cleanId(stationId));
    if (!requested) return rejected("unknown_station", { stationId: cleanId(stationId) });
    const expected = expectedStation();
    if (requested.id !== expected.id) return rejected("wrong_station", {
      stationId: requested.id,
      expectedStationId: expected.id,
      expectedRoomId: expected.roomId,
    });
    const sourceId = recordSource(contextValue);
    const attemptNumber = shift.stationAttempts[shift.taskIndex] + 1;
    const inputQuality = qualityInput(contextValue);
    const level = skillLevel(contextValue, expected.primarySkill);
    const jitter = (hash32(`${runtimeSeed}:${shift.id}:${expected.id}:${attemptNumber}`) % 9) - 4;
    const score = clamp(Math.round(inputQuality * 0.65 + level * 0.2 + 15 + jitter), 0, 100);
    const durationSeconds = Math.max(0.35, expected.realSeconds * (1 - level * 0.0015));
    shift.task = {
      stationId: expected.id,
      sourceId,
      elapsedSeconds: 0,
      durationSeconds,
      inputQuality,
      skillLevel: level,
      score,
      safetyConfirmed: contextValue?.safetyConfirmed === true,
      attemptNumber,
      gameMinutes: expected.gameMinutes,
    };
    lastEvent = "cafe_station_started";
    return accepted({
      event: lastEvent,
      sourceId,
      shiftId: shift.id,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      stationId: expected.id,
      actionId: expected.actionId,
      roomId: expected.roomId,
      durationSeconds,
      gameMinutes: expected.gameMinutes,
      needEffects: expected.needEffects,
      safetyRequired: expected.safetyRequired,
      checks: expected.checks,
      dailyBriefing: createCafeDailyBriefing(shift.dayIndex, { seed: runtimeSeed }),
      instruction: expected.instruction,
      honestLine: expected.honestLine,
    });
  }

  function createCompletionTransaction(finalStation, outcome) {
    const quality = shift.qualitySamples ? Math.round(shift.qualityTotal / shift.qualitySamples) : 0;
    const qualityAdjustment = Math.max(-4, Math.min(6, Math.round((quality - 65) / 8)));
    const reworkAdjustment = Math.min(4, shift.reworkCount);
    const wage = Math.max(COMMON_GROUND_SHIFT_ROLE.baseWage - 6,
      COMMON_GROUND_SHIFT_ROLE.baseWage + qualityAdjustment - reworkAdjustment);
    const sourceId = `common-ground-shift:${shift.dayIndex}`;
    if (transactionSources.has(sourceId) || completedDays.has(shift.dayIndex)) {
      throw new Error(`Duplicate cafe shift completion transaction: ${sourceId}`);
    }
    transactionSerial += 1;
    transactionSources.add(sourceId);
    completedDays.add(shift.dayIndex);
    lastTransaction = deepFreeze({
      serial: transactionSerial,
      sourceId,
      kind: "lawful_cafe_shift_wage",
      callerOwned: true,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      businessId: COMMON_GROUND_CAFE.id,
      shiftId: shift.id,
      dayIndex: shift.dayIndex,
      wage,
      gameMinutes: shift.totalGameMinutes,
      quality,
      safetyPasses: shift.safetyPasses,
      reworkCount: shift.reworkCount,
      trustReward: COMMON_GROUND_SHIFT_ROLE.trustReward,
      externalLedgerEffects: { customerPurchases: 0, payForwardCredits: 0 },
      skillEffects: COMMON_GROUND_SHIFT_ROLE.skillAwards.map(value => ({ ...value })),
      dialogue: COMMON_GROUND_SHIFT_ROLE.completionLine,
      finalStationId: finalStation.id,
      stationOutcome: outcome,
    });
    return lastTransaction;
  }

  function finishTask() {
    const station = expectedStation();
    const task = shift.task;
    shift.task = null;
    shift.stationAttempts[shift.taskIndex] += 1;
    shift.totalGameMinutes += station.gameMinutes;
    shift.qualityTotal += task.score;
    shift.qualitySamples += 1;
    let outcome = "passed";
    if (station.safetyRequired && !task.safetyConfirmed) outcome = "safety_rework";
    else if (task.score < station.minimumQuality) outcome = "quality_rework";
    if (outcome !== "passed") {
      shift.reworkCount += 1;
      lastEvent = outcome === "safety_rework" ? "cafe_station_safety_rework" : "cafe_station_quality_rework";
      lastStationResult = deepFreeze({
        serial: commandSerial,
        sourceId: task.sourceId,
        activityId: COMMON_GROUND_SHIFT_ROLE.id,
        stationId: station.id,
        outcome,
        passed: false,
        score: task.score,
        minimumQuality: station.minimumQuality,
        safetyRequired: station.safetyRequired,
        safetyConfirmed: task.safetyConfirmed,
        gameMinutes: station.gameMinutes,
        needEffects: station.needEffects,
        effects: { gameMinutes: station.gameMinutes, needs: station.needEffects },
        nextStationId: station.id,
        reworkCount: shift.reworkCount,
        line: station.reworkLine,
        transaction: null,
      });
      return;
    }
    if (station.safetyRequired) shift.safetyPasses += 1;
    shift.completedStationIds.push(station.id);
    shift.taskIndex += 1;
    const complete = shift.taskIndex >= CAFE_SHIFT_STATIONS.length;
    const transaction = complete ? createCompletionTransaction(station, outcome) : null;
    lastEvent = complete ? "cafe_shift_completed" : "cafe_station_completed";
    lastStationResult = deepFreeze({
      serial: commandSerial,
      sourceId: task.sourceId,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      stationId: station.id,
      outcome,
      passed: true,
      score: task.score,
      minimumQuality: station.minimumQuality,
      safetyRequired: station.safetyRequired,
      safetyConfirmed: task.safetyConfirmed,
      gameMinutes: station.gameMinutes,
      needEffects: station.needEffects,
      effects: { gameMinutes: station.gameMinutes, needs: station.needEffects },
      nextStationId: complete ? null : CAFE_SHIFT_STATIONS[shift.taskIndex].id,
      reworkCount: shift.reworkCount,
      line: station.passLine,
      transaction,
    });
    if (complete) shift = null;
  }

  function update(deltaSeconds = 0, contextValue = {}) {
    syncClock(contextValue);
    const delta = Math.max(0, finite(deltaSeconds));
    if (shift?.status === "active" && shift.task && delta > 0) {
      markDirty();
      shift.task.elapsedSeconds = Math.min(shift.task.durationSeconds, shift.task.elapsedSeconds + delta);
      if (shift.task.elapsedSeconds + 1e-9 >= shift.task.durationSeconds) finishTask();
    }
    if (contextValue?.captureSnapshot === false) {
      runtimeView.dayIndex = dayIndex;
      runtimeView.minuteOfDay = minuteOfDay;
      runtimeView.status = shift?.status ?? "idle";
      runtimeView.stationId = expectedStation()?.id ?? null;
      runtimeView.taskProgress = shift?.task ? shift.task.elapsedSeconds / shift.task.durationSeconds : 0;
      runtimeView.taskActive = shift?.task != null;
      runtimeView.commandSerial = commandSerial;
      runtimeView.transactionSerial = transactionSerial;
      runtimeView.lastStationResultSerial = lastStationResult?.serial ?? 0;
      runtimeView.lastEvent = lastEvent;
      runtimeView.stateRevision = stateRevision;
      return runtimeView;
    }
    return snapshot();
  }

  function pause(contextValue = {}) {
    syncClock(contextValue);
    const duplicate = duplicateSource(contextValue);
    if (duplicate) return rejected("duplicate_source", { sourceId: duplicate });
    if (!shift) return rejected("no_active_shift");
    if (shift.status === "paused") return rejected("already_paused", { shiftId: shift.id });
    const sourceId = recordSource(contextValue);
    shift.status = "paused";
    lastEvent = "cafe_shift_paused";
    return accepted({
      event: lastEvent,
      sourceId,
      shiftId: shift.id,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      taskPreserved: shift.task != null,
      taskProgress: shift.task ? shift.task.elapsedSeconds / shift.task.durationSeconds : 0,
      nextStationId: expectedStation()?.id ?? null,
    });
  }

  function shiftView() {
    if (!shift) return null;
    const station = expectedStation();
    return {
      id: shift.id,
      activityId: COMMON_GROUND_SHIFT_ROLE.id,
      dayIndex: shift.dayIndex,
      startMinute: shift.startMinute,
      status: shift.status,
      taskIndex: shift.taskIndex,
      taskCount: CAFE_SHIFT_STATIONS.length,
      completedStationIds: [...shift.completedStationIds],
      nextStationId: station?.id ?? null,
      nextActionId: station?.actionId ?? null,
      nextRoomId: station?.roomId ?? null,
      totalGameMinutes: shift.totalGameMinutes,
      quality: shift.qualitySamples ? Math.round(shift.qualityTotal / shift.qualitySamples) : null,
      safetyPasses: shift.safetyPasses,
      reworkCount: shift.reworkCount,
      stationAttempts: [...shift.stationAttempts],
      task: shift.task ? {
        stationId: shift.task.stationId,
        elapsedSeconds: shift.task.elapsedSeconds,
        durationSeconds: shift.task.durationSeconds,
        progress: shift.task.elapsedSeconds / shift.task.durationSeconds,
        safetyConfirmed: shift.task.safetyConfirmed,
      } : null,
    };
  }

  function snapshot() {
    if (cachedSnapshot && cachedSnapshotRevision === stateRevision) return cachedSnapshot;
    cachedSnapshot = deepFreeze({
      saveVersion: CAFE_SHIFT_SAVE_VERSION,
      cafe: COMMON_GROUND_CAFE,
      role: COMMON_GROUND_SHIFT_ROLE,
      clock: { dayIndex, minuteOfDay },
      dailyBriefing: createCafeDailyBriefing(dayIndex, { seed: runtimeSeed }),
      availability: availability({ dayIndex, minuteOfDay }),
      staff: COMMON_GROUND_CAFE_STAFF.map(value => staffScheduleState(value, dayIndex, minuteOfDay)),
      activeShift: shiftView(),
      completedDays: [...completedDays].sort((a, b) => a - b),
      serials: { shift: shiftSerial, command: commandSerial, transaction: transactionSerial },
      ledger: { sourceCount: sourceLedger.size, transactionSourceCount: transactionSources.size },
      lastEvent,
      lastStationResult,
      lastTransaction,
    });
    cachedSnapshotRevision = stateRevision;
    return cachedSnapshot;
  }

  function save() {
    return {
      version: CAFE_SHIFT_SAVE_VERSION,
      seed: runtimeSeed,
      clock: { dayIndex, minuteOfDay },
      serials: { shift: shiftSerial, command: commandSerial, transaction: transactionSerial },
      completedDays: [...completedDays].sort((a, b) => a - b),
      shift: shift ? clone(shift) : null,
      sourceLedger: [...sourceLedger],
      transactionSources: [...transactionSources],
      lastEvent,
      lastStationResult: clone(lastStationResult),
      lastTransaction: clone(lastTransaction),
    };
  }

  function restore(value) {
    const parsed = parseSave(value);
    runtimeSeed = parsed.seed;
    dayIndex = parsed.clock.dayIndex;
    minuteOfDay = parsed.clock.minuteOfDay;
    shiftSerial = parsed.serials.shift;
    commandSerial = parsed.serials.command;
    transactionSerial = parsed.serials.transaction;
    shift = parsed.shift;
    completedDays.clear();
    for (const day of parsed.completedDays) completedDays.add(day);
    sourceLedger.clear();
    for (const source of parsed.sourceLedger) sourceLedger.add(source);
    transactionSources.clear();
    for (const source of parsed.transactionSources) transactionSources.add(source);
    lastEvent = parsed.lastEvent;
    lastStationResult = parsed.lastStationResult == null ? null : deepFreeze(parsed.lastStationResult);
    lastTransaction = parsed.lastTransaction == null ? null : deepFreeze(parsed.lastTransaction);
    markDirty();
    return snapshot();
  }

  function prewarm() {
    if (prewarmResult) return prewarmResult;
    const before = JSON.stringify(save());
    let checksum = 2166136261;
    let dialoguePrepared = 0;
    for (const station of CAFE_SHIFT_STATIONS) {
      checksum ^= hash32(`${station.id}:${station.actionId}:${station.instruction}:${station.honestLine}:${station.passLine}:${station.reworkLine}`);
      dialoguePrepared += 4;
    }
    for (const segment of ASHA_PATEL.workSchedule) checksum ^= hash32(`${segment.activity}:${segment.startMinute}:${segment.locationId}`);
    for (let day = 0; day < 7; ++day) checksum ^= hash32(JSON.stringify(createCafeDailyBriefing(day, { seed: runtimeSeed })));
    checksum ^= hash32(`${COMMON_GROUND_SHIFT_ROLE.briefing}:${COMMON_GROUND_SHIFT_ROLE.completionLine}`);
    dialoguePrepared += 2 + Object.keys(ASHA_PATEL.dialogue).length;
    prewarmResult = deepFreeze({
      ready: true,
      storage: "memory-only",
      diskResources: 0,
      rendererResources: 0,
      stationsPrepared: CAFE_SHIFT_STATIONS.length,
      outcomesPrepared: CAFE_SHIFT_STATIONS.length * 3,
      dailyBriefingsPrepared: 7,
      staffSchedulesPrepared: ASHA_PATEL.workSchedule.length + ASHA_PATEL.dayOffSchedule.length,
      dialoguePrepared,
      saveRestorePrepared: true,
      liveStatePreserved: JSON.stringify(save()) === before,
      checksum: checksum >>> 0,
    });
    return prewarmResult;
  }

  return Object.freeze({
    cafe: COMMON_GROUND_CAFE,
    role: COMMON_GROUND_SHIFT_ROLE,
    stations: CAFE_SHIFT_STATIONS,
    staff: COMMON_GROUND_CAFE_STAFF,
    availability,
    context,
    staffState,
    begin,
    resume,
    performStation,
    update,
    pause,
    cancel: pause,
    snapshot,
    save,
    restore,
    prewarm,
  });
}

export const createCommonGroundCafeShift = createCafeShiftSystem;
