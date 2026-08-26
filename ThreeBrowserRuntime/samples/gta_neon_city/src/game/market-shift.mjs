export const MARKET_SHIFT_SAVE_VERSION = 1;

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_SEED = 740;
const INTERACTION_RADIUS = 2.35;
const VALID_SKILL_IDS = new Set(["hospitality", "community", "fitness"]);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function frozenCopy(value) {
  return deepFreeze(clone(value));
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
  return String(value ?? fallback).trim().slice(0, 160);
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

function schedule(activity, startMinute, endMinute, locationId, roomId = null) {
  return deepFreeze({ activity, startMinute, endMinute, locationId, roomId });
}

function skillAward(skillId, experience) {
  if (!VALID_SKILL_IDS.has(skillId)) throw new RangeError(`Unknown Mina's Market life skill: ${skillId}`);
  return deepFreeze({ skillId, experience });
}

export const MINA_MARKET_HOURS = deepFreeze({
  openMinute: 7 * 60,
  lastClockInMinute: 16 * 60,
  closeMinute: 21 * 60,
  openDays: [0, 1, 2, 3, 4, 5, 6],
  label: "DAILY 07:00-21:00 / LAST SHIFT 16:00",
});

function marketStation(id, actionId, roomId, name, {
  alternateWorldStationIds = [],
  gameMinutes,
  realSeconds,
  minimumQuality,
  primarySkill,
  needEffects,
  checks,
  instruction,
  supervisorLine,
  passLine,
  reworkLine,
}) {
  return deepFreeze({
    id,
    worldStationId: id,
    alternateWorldStationIds,
    actionId,
    roomId,
    name,
    gameMinutes,
    realSeconds,
    minimumQuality,
    primarySkill,
    needEffects,
    safetyRequired: true,
    checks,
    instruction,
    supervisorLine,
    passLine,
    reworkLine,
  });
}

export const MINA_MARKET_STATIONS = deepFreeze([
  marketStation("mina-order-counter", "clock_in", "mina-staff-nook", "CLOCK IN AND READ HANDOVER", {
    alternateWorldStationIds: ["mina-staff-nook"],
    gameMinutes: 14,
    realSeconds: 1.8,
    minimumQuality: 54,
    primarySkill: "hospitality",
    needEffects: { energy: -1, hygiene: 0, appetite: -1 },
    checks: ["ROSTER AND BREAK COVER", "RECALL AND COLD-CHAIN NOTES", "ACCESSIBLE AISLES"],
    instruction: "Clock in beside the staff nook, read the delivery, recall, break-cover, and accessibility notes, then repeat the two safety priorities to Mina.",
    supervisorLine: "MINA: Signing in means you have read the handover, not merely found the pen. Ask now if a note is unclear.",
    passLine: "The roster, recalls, cold-chain note, break cover, and clear routes are understood.",
    reworkLine: "MINA: Stop and read it again. A missed recall or uncovered break becomes somebody else's risk.",
  }),
  marketStation("mina-cold-case", "check_cold_chain", "mina-cold-stock", "CHECK COLD-CASE TEMPERATURES", {
    gameMinutes: 24,
    realSeconds: 2.5,
    minimumQuality: 61,
    primarySkill: "hospitality",
    needEffects: { energy: -2, hygiene: 0, appetite: -1 },
    checks: ["PROBE SANITISED", "DISPLAY AND DELIVERY TEMPERATURE", "QUARANTINE IF OUT OF RANGE"],
    instruction: "Sanitise the probe, compare the delivery and display readings with the daily limit, record the real number, and quarantine anything unsafe instead of rounding it down.",
    supervisorLine: "MINA: A tidy number is worthless if the food was warm. Record what the probe says and protect the customer first.",
    passLine: "Cold stock is measured, recorded, and either released or isolated against the correct limit.",
    reworkLine: "MINA: That temperature check cannot be signed. Clean the probe, measure again, and isolate the affected stock while we verify it.",
  }),
  marketStation("mina-produce-scale", "rotate_produce", "mina-produce-floor", "GRADE, WEIGH, AND ROTATE PRODUCE", {
    gameMinutes: 36,
    realSeconds: 3.2,
    minimumQuality: 58,
    primarySkill: "fitness",
    needEffects: { energy: -3, hygiene: -1, appetite: -2 },
    checks: ["FIRST IN FIRST OUT", "TRUE SCALE TARE", "BRUISED PRODUCE SEPARATION"],
    instruction: "Move the older safe crate forward, tare the scale before weighing, keep bruised edible produce separate for markdown or donation, and record genuine spoilage.",
    supervisorLine: "MINA: Rotation is not hiding old fruit under new fruit. Customers should see what they are buying, and the scale must start at zero.",
    passLine: "Produce is honestly graded, accurately weighed, and rotated first-in-first-out.",
    reworkLine: "MINA: The tare, date order, or grading is wrong. Reset the scale and rebuild this bay before it opens.",
  }),
  marketStation("mina-pantry-shelf", "rotate_pantry_stock", "mina-dry-stock", "ROTATE PANTRY STOCK", {
    gameMinutes: 33,
    realSeconds: 3,
    minimumQuality: 59,
    primarySkill: "fitness",
    needEffects: { energy: -3, hygiene: -1, appetite: -2 },
    checks: ["DATE FACING", "RECALL CODE", "SAFE LIFT AND CLEAR AISLE"],
    instruction: "Match the lot code to the handover, bring short-dated stock forward without disguising its date, lift from the trolley safely, and leave the aisle passable.",
    supervisorLine: "MINA: Full shelves are not the goal if the dates lie or a wheelchair cannot pass. Leave the bay truthful and usable.",
    passLine: "Pantry stock is lot-checked, date-rotated, safely lifted, and the aisle remains clear.",
    reworkLine: "MINA: The shelf count, lot code, date order, or aisle clearance does not agree. Correct the whole bay before moving on.",
  }),
  marketStation("mina-packing-bench", "pack_customer_order", "mina-packing-bench", "PICK AND PACK A CUSTOMER ORDER", {
    alternateWorldStationIds: ["mina-basket-packing", "mina-basket-rack"],
    gameMinutes: 44,
    realSeconds: 3.6,
    minimumQuality: 62,
    primarySkill: "hospitality",
    needEffects: { energy: -3, hygiene: -1, appetite: -3 },
    checks: ["ORDER READ-BACK", "ALLERGEN AND SUBSTITUTION CONSENT", "COLD AND FRAGILE PACKING"],
    instruction: "Read the order back, ask before substituting, keep cold goods together, protect bread and produce from heavy items, and put the receipt where the customer can find it.",
    supervisorLine: "MINA: An unavailable item is a question, not permission to choose for somebody. Call them and record their answer.",
    passLine: "The basket matches the order, substitutions are consented to, and cold and fragile goods are packed safely.",
    reworkLine: "MINA: The packed basket and the customer's order disagree. Unpack it, contact them where needed, and rebuild it carefully.",
  }),
  marketStation("mina-grocery-checkout", "reconcile_checkout", "mina-checkout", "SERVE AND RECONCILE THE TILL", {
    gameMinutes: 38,
    realSeconds: 3.3,
    minimumQuality: 63,
    primarySkill: "hospitality",
    needEffects: { energy: -2, hygiene: 0, appetite: -2 },
    checks: ["PRICE AND DISCOUNT LABEL", "PAYMENT READ-BACK", "CASH AND RECEIPT RECONCILIATION"],
    instruction: "Greet the customer, scan the actual item, honour only clearly labelled markdowns, read back cash or payment, offer a receipt, and reconcile the caller-owned till total without changing it yourself.",
    supervisorLine: "MINA: Correct a pricing error in front of the customer. Quietly making the till match later is not reconciliation.",
    passLine: "Customers receive accurate prices and receipts, and the checkout count reconciles honestly.",
    reworkLine: "MINA: The basket, markdown, payment, or till record is inconsistent. Trace it openly before signing the count.",
  }),
  marketStation("mina-dish-sink", "clean_and_handover", "mina-wash-up", "CLEAN PREP, SINK, AND HAND OVER", {
    alternateWorldStationIds: ["mina-kitchen-prep"],
    gameMinutes: 34,
    realSeconds: 3.1,
    minimumQuality: 60,
    primarySkill: "community",
    needEffects: { energy: -3, hygiene: -3, appetite: -2 },
    checks: ["FOOD AND CHEMICAL SEPARATION", "WASH RINSE SANITISE", "WASTE AND SURPLUS LOG"],
    instruction: "Separate food from chemicals, wash, rinse, sanitise, and air-dry the prep tools, then reconcile the waste and surplus log with the decision made earlier.",
    supervisorLine: "MINA: The next worker deserves a safe bench and a true log. Closing work counts even after the last customer leaves.",
    passLine: "The prep area and sink are sanitised, tools are dry, and the surplus and waste handover agrees.",
    reworkLine: "MINA: The sanitising or surplus record is incomplete. Redo the affected cycle and correct the handover before clocking out.",
  }),
]);

const STATION_BY_ID = new Map(MINA_MARKET_STATIONS.map(station => [station.id, station]));
const STATION_ALIAS_TO_ID = new Map();
for (const station of MINA_MARKET_STATIONS) {
  STATION_ALIAS_TO_ID.set(station.id, station.id);
  for (const alias of station.alternateWorldStationIds) STATION_ALIAS_TO_ID.set(alias, station.id);
}

export const MARKET_SURPLUS_DECISIONS = deepFreeze([
  {
    id: "mark_down",
    label: "MARK DOWN TODAY",
    wageAdjustment: 3,
    qualityAdjustment: 4,
    communityTrust: 1,
    communityExperience: 4,
    edibleUnitsSaved: 4,
    discardedUnits: 0,
    gameMinutes: 8,
    needEffects: { energy: -1, hygiene: 0, appetite: -1 },
    tradeoff: "Accurate labels make affordable food available today, but unsold items still need a safe end-of-day plan.",
    line: "MINA: Date it clearly and price it fairly. A markdown is useful only when the customer can see exactly what it is.",
  },
  {
    id: "donate",
    label: "DONATE SAFELY",
    wageAdjustment: -2,
    qualityAdjustment: 3,
    communityTrust: 4,
    communityExperience: 12,
    edibleUnitsSaved: 6,
    discardedUnits: 0,
    gameMinutes: 14,
    needEffects: { energy: -2, hygiene: -1, appetite: -1 },
    tradeoff: "Safe donation takes extra sorting, cold-chain records, and paid time, but feeds neighbours without hiding the store's responsibility.",
    line: "MINA: Donation is not a bin with better publicity. Check every date, temperature, seal, and collection record.",
  },
  {
    id: "discard",
    label: "DISCARD THE LOT",
    wageAdjustment: 0,
    qualityAdjustment: -8,
    communityTrust: -2,
    communityExperience: 0,
    edibleUnitsSaved: 0,
    discardedUnits: 6,
    gameMinutes: 5,
    needEffects: { energy: -1, hygiene: -1, appetite: 0 },
    tradeoff: "Discarding avoids a rushed unsafe handoff, but wastes edible stock when lawful markdown and donation routes were available.",
    line: "MINA: I will never ask you to donate unsafe food. This lot is safe, though, so write down why you chose the bin.",
  },
]);

const DECISION_BY_ID = new Map(MARKET_SURPLUS_DECISIONS.map(decision => [decision.id, decision]));

export const MINA_OKAFOR = deepFreeze({
  id: "mina_okafor",
  name: "Mina Okafor",
  displayName: "MINA OKAFOR",
  jobTitle: "OWNER AND SHIFT SUPERVISOR",
  businessId: "mina_market_kitchen",
  worldAnchorId: "mina-order-counter",
  homeLocationId: "mina-okafor-home",
  workDays: [0, 1, 2, 3, 4, 5, 6],
  workSchedule: [
    schedule("sleep", 0, 330, "mina-okafor-home"),
    schedule("commute", 330, 370, "north-market-walk"),
    schedule("opening_checks", 370, 420, "mina_market_kitchen", "mina-cold-stock"),
    schedule("supervise_floor", 420, 720, "mina_market_kitchen", "mina-produce-floor"),
    schedule("meal_break", 720, 750, "mina_market_kitchen", "mina-staff-nook"),
    schedule("orders_and_till", 750, 1050, "mina_market_kitchen", "mina-checkout"),
    schedule("admin_break", 1050, 1080, "mina_market_kitchen", "mina-staff-nook"),
    schedule("supervise_close", 1080, 1260, "mina_market_kitchen", "mina-wash-up"),
    schedule("commute", 1260, 1300, "north-market-walk"),
    schedule("home", 1300, 1440, "mina-okafor-home"),
  ],
});

export const MINA_MARKET_STAFF = deepFreeze([
  MINA_OKAFOR,
  {
    id: "emi_sato",
    name: "Emi Sato",
    displayName: "EMI SATO",
    jobTitle: "GROCER AND CHECKOUT LEAD",
    businessId: "mina_market_kitchen",
    worldAnchorId: "mina-grocery-checkout",
    homeLocationId: "emi-sato-home",
    workDays: [0, 1, 2, 3, 4],
    weekdaySchedule: [
      schedule("home", 0, 450, "emi-sato-home"),
      schedule("commute", 450, 480, "north-market-walk"),
      schedule("stock_and_checkout", 480, 720, "mina_market_kitchen", "mina-grocery-checkout"),
      schedule("meal_break", 720, 750, "mina_market_kitchen", "mina-staff-nook"),
      schedule("stock_and_checkout", 750, 960, "mina_market_kitchen", "mina-grocery-checkout"),
      schedule("commute", 960, 990, "north-market-walk"),
      schedule("home", 990, 1440, "emi-sato-home"),
    ],
    weekendSchedule: [
      schedule("home", 0, 690, "emi-sato-home"),
      schedule("commute", 690, 720, "north-market-walk"),
      schedule("orders_and_packing", 720, 960, "mina_market_kitchen", "mina-packing-bench"),
      schedule("meal_break", 960, 990, "mina_market_kitchen", "mina-staff-nook"),
      schedule("checkout_close", 990, 1200, "mina_market_kitchen", "mina-grocery-checkout"),
      schedule("commute", 1200, 1230, "north-market-walk"),
      schedule("home", 1230, 1440, "emi-sato-home"),
    ],
  },
]);

export const MINA_MARKET_WORKPLACE = deepFreeze({
  id: "mina_market_kitchen",
  physicalId: "mina_market_kitchen",
  propertyId: "mina-market-building",
  buildingId: "building-009",
  name: "MINA'S MARKET",
  address: "84 Market Street",
  districtId: "north-market",
  keeperId: MINA_OKAFOR.id,
  activityId: "mina_market_shift",
  openingHours: MINA_MARKET_HOURS,
  stationIds: MINA_MARKET_STATIONS.map(station => station.id),
  staffIds: MINA_MARKET_STAFF.map(staff => staff.id),
  lawfulWorkplace: true,
  prohibitedActivities: ["combat", "weapons", "crime"],
});

export const MINA_MARKET_SHIFT_ROLE = deepFreeze({
  id: "mina_market_shift",
  name: "MINA'S MARKET STOCK AND TILL SHIFT",
  businessId: MINA_MARKET_WORKPLACE.id,
  supervisorId: MINA_OKAFOR.id,
  stationIds: MINA_MARKET_WORKPLACE.stationIds,
  baseWage: 86,
  skillAwards: [
    skillAward("hospitality", 28),
    skillAward("community", 10),
    skillAward("fitness", 18),
  ],
  briefing: "MINA: Paid grocery work is care with receipts: truthful dates, safe temperatures, consent before substitutions, a till that agrees, and no pretending edible surplus is somebody else's problem.",
  completionLine: "MINA: The cold log, shelf count, customer order, till, wash-up, and surplus record agree. Thank you for leaving the next shift the truth.",
});

const PRODUCE_LOTS = deepFreeze([
  ["tomatoes", "silverbeet", "pears"],
  ["oranges", "zucchini", "bananas"],
  ["apples", "broccoli", "avocados"],
  ["carrots", "spinach", "nectarines"],
]);
const PANTRY_LOTS = deepFreeze(["chickpeas", "brown rice", "oat milk", "tomato tins", "wholemeal pasta"]);
const CUSTOMER_NAMES = deepFreeze(["Jo Bell", "Ravi Shah", "Noura Haddad", "Tess Nguyen", "Owen Park", "Mara Vale"]);
const ORDER_NOTES = deepFreeze([
  "Call before substituting oat milk; keep bread above the produce.",
  "No plastic bag; separate the chilled items for a short bus trip.",
  "Large-print receipt requested; do not substitute the low-sodium tins.",
  "Leave the heavy rice out of the basket until the customer arrives with a trolley.",
]);
const SURPLUS_ITEMS = deepFreeze(["ripe bananas", "day-dated yoghurt", "bruised pears", "sealed sandwich rolls"]);

export function createMinaMarketDailyScenario(dayIndexValue, { seed = DEFAULT_SEED } = {}) {
  const dayIndex = Math.max(0, integer(dayIndexValue));
  const scenarioKey = hash32(`${integer(seed) >>> 0}:${dayIndex}:mina-market-real-work`);
  const produceLot = PRODUCE_LOTS[scenarioKey % PRODUCE_LOTS.length];
  const displayTemperatureC = 2.8 + ((scenarioKey >>> 4) % 13) / 10;
  const deliveryTemperatureC = 2.4 + ((scenarioKey >>> 9) % 16) / 10;
  const expectedTillCents = 18420 + ((scenarioKey >>> 6) % 6400);
  const cashVarianceCents = [0, 0, 0, 5, -5][(scenarioKey >>> 13) % 5];
  return deepFreeze({
    id: `mina-market-day-${dayIndex}-${scenarioKey.toString(16).padStart(8, "0")}`,
    dayIndex,
    coldChain: {
      maximumC: 5,
      displayTemperatureC,
      deliveryTemperatureC,
      releaseAllowed: displayTemperatureC <= 5 && deliveryTemperatureC <= 5,
    },
    produce: {
      lotCode: `PR-${String((scenarioKey >>> 16) % 10000).padStart(4, "0")}`,
      items: [...produceLot],
      olderCrates: 2 + ((scenarioKey >>> 2) % 4),
      trueTareGrams: 380 + ((scenarioKey >>> 18) % 5) * 20,
    },
    pantry: {
      item: PANTRY_LOTS[(scenarioKey >>> 7) % PANTRY_LOTS.length],
      lotCode: `PN-${String((scenarioKey >>> 12) % 10000).padStart(4, "0")}`,
      shortDatedUnits: 4 + ((scenarioKey >>> 20) % 5),
    },
    customerOrder: {
      id: `mina-order-${dayIndex}-${(scenarioKey >>> 21) % 1000}`,
      customerName: CUSTOMER_NAMES[(scenarioKey >>> 3) % CUSTOMER_NAMES.length],
      itemCount: 7 + ((scenarioKey >>> 17) % 7),
      note: ORDER_NOTES[(scenarioKey >>> 11) % ORDER_NOTES.length],
      substitutionConsentRequired: true,
    },
    till: {
      openingFloatCents: 15000,
      expectedTillCents,
      countedTillCents: expectedTillCents + cashVarianceCents,
      varianceCents: cashVarianceCents,
      callerOwnedLedger: true,
    },
    surplus: {
      item: SURPLUS_ITEMS[(scenarioKey >>> 15) % SURPLUS_ITEMS.length],
      units: 6,
      safeToDonate: true,
      collectionWindowMinute: 19 * 60 + 15,
      requiresTemperatureRecord: ((scenarioKey >>> 24) & 1) === 1,
      choices: MARKET_SURPLUS_DECISIONS.map(decision => decision.id),
    },
  });
}

function dayOfWeek(dayIndex) {
  return ((integer(dayIndex) % 7) + 7) % 7;
}

function clockFrom(context, fallbackDay = 0, fallbackMinute = MINA_MARKET_HOURS.openMinute) {
  const dayValue = context?.dayIndex ?? context?.gameDay ?? context?.day;
  const minuteValue = context?.minuteOfDay ?? context?.timeMinutes
    ?? (context?.timeHours == null ? null : finite(context.timeHours) * 60);
  return {
    dayIndex: dayValue == null ? fallbackDay : Math.max(0, integer(dayValue)),
    minuteOfDay: minuteValue == null ? fallbackMinute : normalizeMinute(minuteValue),
  };
}

function staffScheduleState(definition, dayIndex, minuteOfDay) {
  const workingDay = definition.workDays.includes(dayOfWeek(dayIndex));
  let source;
  if (definition.id === MINA_OKAFOR.id) source = definition.workSchedule;
  else source = workingDay ? definition.weekdaySchedule : definition.weekendSchedule;
  const segment = source.find(value => minuteOfDay >= value.startMinute && minuteOfDay < value.endMinute)
    ?? source[source.length - 1];
  const atWork = segment.locationId === MINA_MARKET_WORKPLACE.id;
  return deepFreeze({
    id: definition.id,
    name: definition.name,
    displayName: definition.displayName,
    jobTitle: definition.jobTitle,
    worldAnchorId: definition.worldAnchorId,
    workingDay,
    activity: segment.activity,
    locationId: segment.locationId,
    roomId: segment.roomId,
    startMinute: segment.startMinute,
    endMinute: segment.endMinute,
    atWork,
    dialogue: definition.id === MINA_OKAFOR.id
      ? (segment.activity.includes("break")
        ? "Mina is taking her posted break; Emi has the floor and the handover sheet says when Mina returns."
        : "Mina is supervising the real cold, stock, customer, and till records for this shift.")
      : (atWork ? "Emi is following the posted stock, checkout, and break roster." : "Emi is not on the market floor right now."),
  });
}

function rejected(reason, extra = {}) {
  return deepFreeze({ accepted: false, reason, ...extra });
}

function accepted(extra = {}) {
  return deepFreeze({ accepted: true, reason: null, ...extra });
}

function qualityInput(context) {
  return clamp(context?.quality ?? context?.workQuality ?? context?.care ?? 72, 0, 100);
}

function skillLevel(context, skillId) {
  const source = context?.skillLevels ?? context?.skills ?? {};
  const raw = source?.[skillId];
  if (raw && typeof raw === "object") return clamp(raw.level ?? raw.value ?? 0, 0, 100);
  return clamp(raw ?? context?.skillLevel ?? 0, 0, 100);
}

function stationWorldIds(station) {
  return [station.worldStationId, ...station.alternateWorldStationIds];
}

function vector3(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const result = [Number(value[0]), Number(value[1]), Number(value[2])];
    return result.every(Number.isFinite) ? result : null;
  }
  if (value && typeof value === "object") {
    const result = [Number(value.x), Number(value.y), Number(value.z)];
    return result.every(Number.isFinite) ? result : null;
  }
  return null;
}

function stationAccess(station, context) {
  if ((context?.onFoot ?? context?.playerOnFoot) !== true) {
    return rejected("on_foot_required", { expectedStationIds: stationWorldIds(station) });
  }
  const reportedId = cleanId(context?.nearbyStationId ?? context?.nearStationId
    ?? context?.currentStationId ?? context?.worldStationId ?? context?.stationId);
  const allowedIds = stationWorldIds(station);
  if (reportedId && !allowedIds.includes(reportedId)) {
    return rejected("wrong_physical_station", { expectedStationIds: allowedIds, actualStationId: reportedId });
  }
  if (reportedId && context?.distanceToStation != null) {
    const distance = finite(context.distanceToStation, Infinity);
    if (distance > finite(context.interactionRadius, INTERACTION_RADIUS)) {
      return rejected("station_too_far", { expectedStationIds: allowedIds, distance });
    }
    return accepted({ physicalStationId: reportedId, distance });
  }
  if (reportedId) return accepted({ physicalStationId: reportedId, distance: 0 });

  const playerPosition = vector3(context?.playerPosition ?? context?.position);
  const positions = context?.stationPositions ?? context?.worldStationPositions;
  if (playerPosition && positions && typeof positions === "object") {
    let nearest = null;
    for (const id of allowedIds) {
      const position = vector3(positions[id]);
      if (!position) continue;
      const dx = playerPosition[0] - position[0];
      const dy = playerPosition[1] - position[1];
      const dz = playerPosition[2] - position[2];
      const distance = Math.hypot(dx, dy, dz);
      if (!nearest || distance < nearest.distance) nearest = { id, distance };
    }
    if (nearest && nearest.distance <= finite(context.interactionRadius, INTERACTION_RADIUS)) {
      return accepted({ physicalStationId: nearest.id, distance: nearest.distance });
    }
    if (nearest) return rejected("station_too_far", { expectedStationIds: allowedIds, distance: nearest.distance });
  }
  return rejected("physical_station_required", { expectedStationIds: allowedIds });
}

function safeJson(value, label, depth = 0) {
  if (depth > 12) throw new RangeError(`${label} is too deeply nested.`);
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

function requireFiniteNumber(value, minimum, maximum, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
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

function migrateLegacySave(value) {
  const legacy = requireRecord(value, "legacy market shift save");
  const completedDays = Array.isArray(legacy.completedDays) ? legacy.completedDays : [];
  const transactionSources = completedDays.map(day => `mina-market-wage:${day}:${completedDays.indexOf(day) + 1}`);
  return {
    version: MARKET_SHIFT_SAVE_VERSION,
    seed: integer(legacy.seed, DEFAULT_SEED) >>> 0,
    clock: {
      dayIndex: Math.max(0, integer(legacy.dayIndex)),
      minuteOfDay: normalizeMinute(legacy.minuteOfDay ?? MINA_MARKET_HOURS.openMinute),
    },
    completedDays,
    sourceLedger: Array.isArray(legacy.sourceLedger) ? legacy.sourceLedger : [],
    transactionSources,
    serials: {
      command: Math.max(0, integer(legacy.commandSerial, Array.isArray(legacy.sourceLedger) ? legacy.sourceLedger.length : 0)),
      transaction: completedDays.length,
      stationResult: Math.max(0, integer(legacy.stationResultSerial)),
      event: Math.max(0, integer(legacy.eventSerial)),
    },
    shift: null,
    lastStationResult: null,
    lastDecisionResult: null,
    lastTransaction: null,
    pendingEvents: [],
    lastEvent: "market_save_migrated",
    stateRevision: Math.max(0, integer(legacy.stateRevision)),
  };
}

function parseSave(input) {
  let value = safeJson(input, "market shift save");
  if (value?.version === 0 || value?.version == null) value = migrateLegacySave(value);
  const record = requireRecord(value, "market shift save");
  if (record.version !== MARKET_SHIFT_SAVE_VERSION) throw new RangeError(`Unsupported market shift save version: ${record.version}`);
  const clock = requireRecord(record.clock, "market shift save.clock");
  const completedDays = (record.completedDays ?? []).map((day, index) => requireInteger(day, 0, 10_000_000, `completedDays[${index}]`));
  if (new Set(completedDays).size !== completedDays.length) throw new RangeError("completedDays must not contain duplicates.");
  const sourceLedger = uniqueStrings(record.sourceLedger ?? [], "sourceLedger");
  const transactionSources = uniqueStrings(record.transactionSources ?? [], "transactionSources");
  const parsedSeed = requireInteger(record.seed, 0, 0xffffffff, "seed");
  const serials = requireRecord(record.serials, "market shift save.serials");
  const parsedSerials = {
    command: requireInteger(serials.command, 0, Number.MAX_SAFE_INTEGER, "serials.command"),
    transaction: requireInteger(serials.transaction, 0, Number.MAX_SAFE_INTEGER, "serials.transaction"),
    stationResult: requireInteger(serials.stationResult, 0, Number.MAX_SAFE_INTEGER, "serials.stationResult"),
    event: requireInteger(serials.event, 0, Number.MAX_SAFE_INTEGER, "serials.event"),
  };
  if (parsedSerials.transaction !== transactionSources.length || completedDays.length !== transactionSources.length) {
    throw new RangeError("completed-day, transaction-source, and transaction-serial counts must agree.");
  }
  if (parsedSerials.command < sourceLedger.length) throw new RangeError("command serial cannot trail the source ledger.");

  let shift = null;
  if (record.shift != null) {
    shift = requireRecord(record.shift, "market shift save.shift");
    if (typeof shift.id !== "string" || !shift.id || shift.id.length > 256) throw new RangeError("shift.id is invalid.");
    const shiftDayIndex = requireInteger(shift.dayIndex, 0, 10_000_000, "shift.dayIndex");
    const nextStationIndex = requireInteger(shift.nextStationIndex, 0, MINA_MARKET_STATIONS.length, "shift.nextStationIndex");
    requireInteger(shift.startedMinute, 0, MINUTES_PER_DAY - 1, "shift.startedMinute");
    if (!["active", "paused", "completed"].includes(shift.status)) throw new RangeError("shift.status is invalid.");
    if (!Array.isArray(shift.attempts) || shift.attempts.length !== MINA_MARKET_STATIONS.length
      || shift.attempts.some(count => !Number.isSafeInteger(count) || count < 0 || count > 1000)) {
      throw new RangeError("shift.attempts is invalid.");
    }
    if (!Array.isArray(shift.stationResults) || shift.stationResults.length > 7000) {
      throw new RangeError("shift.stationResults is invalid.");
    }
    if (shift.surplusDecisionId != null && !DECISION_BY_ID.has(shift.surplusDecisionId)) {
      throw new RangeError("shift.surplusDecisionId is invalid.");
    }
    if (nextStationIndex > 4 && !shift.surplusDecisionId) throw new RangeError("advanced shifts require a surplus decision.");
    if ((shift.surplusDecisionId == null) !== (shift.decisionResult == null)) {
      throw new RangeError("shift surplus decision and result must agree.");
    }
    let decision = null;
    if (shift.surplusDecisionId != null) {
      decision = DECISION_BY_ID.get(shift.surplusDecisionId);
      const decisionResult = requireRecord(shift.decisionResult, "shift.decisionResult");
      if (decisionResult.decisionId !== decision.id || decisionResult.dayIndex !== shiftDayIndex
        || decisionResult.units !== 6 || decisionResult.edibleUnitsSaved !== decision.edibleUnitsSaved
        || decisionResult.discardedUnits !== decision.discardedUnits
        || decisionResult.wageAdjustment !== decision.wageAdjustment
        || decisionResult.qualityAdjustment !== decision.qualityAdjustment
        || decisionResult.communityTrust !== decision.communityTrust
        || decisionResult.communityExperience !== decision.communityExperience
        || decisionResult.gameMinutes !== decision.gameMinutes) {
        throw new RangeError("shift.decisionResult does not match its authored surplus choice.");
      }
      if (typeof decisionResult.sourceId !== "string" || !decisionResult.sourceId) {
        throw new RangeError("shift.decisionResult.sourceId is invalid.");
      }
    }

    const expectedScenario = createMinaMarketDailyScenario(shiftDayIndex, { seed: parsedSeed });
    if (JSON.stringify(shift.scenario) !== JSON.stringify(expectedScenario)) {
      throw new RangeError("shift.scenario does not match the deterministic day and seed.");
    }

    const simulatedAttempts = Array(MINA_MARKET_STATIONS.length).fill(0);
    let simulatedIndex = 0;
    let simulatedPassed = 0;
    let simulatedReworks = 0;
    let simulatedQualityTotal = 0;
    let simulatedGameMinutes = decision?.gameMinutes ?? 0;
    const simulatedNeeds = {
      energy: decision?.needEffects.energy ?? 0,
      hygiene: decision?.needEffects.hygiene ?? 0,
      appetite: decision?.needEffects.appetite ?? 0,
    };
    let previousResultSerial = 0;
    for (let index = 0; index < shift.stationResults.length; ++index) {
      const result = requireRecord(shift.stationResults[index], `shift.stationResults[${index}]`);
      const station = MINA_MARKET_STATIONS[simulatedIndex];
      if (!station || result.stationId !== station.id) {
        throw new RangeError(`shift.stationResults[${index}] is out of station order.`);
      }
      const resultSerial = requireInteger(result.serial, 1, parsedSerials.stationResult,
        `shift.stationResults[${index}].serial`);
      if (resultSerial <= previousResultSerial) throw new RangeError("shift station-result serials must increase.");
      previousResultSerial = resultSerial;
      simulatedAttempts[simulatedIndex] += 1;
      if (result.attempt !== simulatedAttempts[simulatedIndex]) {
        throw new RangeError(`shift.stationResults[${index}].attempt is inconsistent.`);
      }
      const resultQuality = requireInteger(result.quality, 0, 100, `shift.stationResults[${index}].quality`);
      const validOutcome = result.outcome === "passed" || result.outcome === "safety_rework"
        || result.outcome === "quality_rework";
      if (!validOutcome || result.passed !== (result.outcome === "passed")) {
        throw new RangeError(`shift.stationResults[${index}].outcome is inconsistent.`);
      }
      if (result.effects?.gameMinutes !== station.gameMinutes
        || JSON.stringify(result.effects?.needs) !== JSON.stringify(station.needEffects)) {
        throw new RangeError(`shift.stationResults[${index}].effects were altered.`);
      }
      simulatedGameMinutes += station.gameMinutes;
      simulatedNeeds.energy += station.needEffects.energy;
      simulatedNeeds.hygiene += station.needEffects.hygiene;
      simulatedNeeds.appetite += station.needEffects.appetite;
      if (result.passed) {
        simulatedQualityTotal += resultQuality;
        simulatedPassed += 1;
        simulatedIndex += 1;
        if (simulatedIndex > 4 && !decision) throw new RangeError("station work advanced without a surplus decision.");
      } else {
        simulatedReworks += 1;
      }
    }

    if (shift.task != null) {
      const task = requireRecord(shift.task, "market shift save.shift.task");
      if (!STATION_BY_ID.has(task.stationId)) throw new RangeError("shift.task.stationId is invalid.");
      if (task.stationId !== MINA_MARKET_STATIONS[nextStationIndex]?.id || nextStationIndex !== simulatedIndex) {
        throw new RangeError("shift task does not match the next station.");
      }
      if (!(task.remainingSeconds >= 0) || !(task.durationSeconds > 0) || task.remainingSeconds > task.durationSeconds) {
        throw new RangeError("shift task timing is invalid.");
      }
      const taskStation = MINA_MARKET_STATIONS[nextStationIndex];
      if (task.durationSeconds !== taskStation.realSeconds
        || !stationWorldIds(taskStation).includes(task.physicalStationId)
        || typeof task.sourceId !== "string" || !task.sourceId
        || typeof task.safetyConfirmed !== "boolean") {
        throw new RangeError("shift task metadata is invalid.");
      }
      requireFiniteNumber(task.rawQuality, 0, 100, "shift.task.rawQuality");
      requireFiniteNumber(task.skillLevel, 0, 100, "shift.task.skillLevel");
      requireInteger(task.scoredQuality, 0, 100, "shift.task.scoredQuality");
      simulatedAttempts[nextStationIndex] += 1;
      if (task.attempt !== simulatedAttempts[nextStationIndex]) throw new RangeError("shift task attempt is inconsistent.");
    }
    if (nextStationIndex !== simulatedIndex || shift.passedStations !== simulatedPassed
      || shift.reworkCount !== simulatedReworks || shift.qualityTotal !== simulatedQualityTotal
      || shift.totalGameMinutes !== simulatedGameMinutes || JSON.stringify(shift.needTotals) !== JSON.stringify(simulatedNeeds)
      || JSON.stringify(shift.attempts) !== JSON.stringify(simulatedAttempts)) {
      throw new RangeError("shift aggregate state is inconsistent with its completed work.");
    }
    if (typeof shift.beginSourceId !== "string" || !shift.beginSourceId) throw new RangeError("shift.beginSourceId is invalid.");
    if (shift.status === "completed") {
      if (nextStationIndex !== MINA_MARKET_STATIONS.length || !completedDays.includes(shiftDayIndex)) {
        throw new RangeError("completed shift state is inconsistent.");
      }
    } else if (nextStationIndex >= MINA_MARKET_STATIONS.length || completedDays.includes(shiftDayIndex)) {
      throw new RangeError("unfinished shift state is inconsistent.");
    }
    shift = clone(shift);
  }
  if (record.lastStationResult != null) {
    const result = requireRecord(record.lastStationResult, "lastStationResult");
    requireInteger(result.serial, 1, parsedSerials.stationResult, "lastStationResult.serial");
  } else if (parsedSerials.stationResult > 0 && shift?.stationResults?.length) {
    throw new RangeError("lastStationResult is required when the current shift has station results.");
  }
  if (record.lastDecisionResult != null) {
    const result = requireRecord(record.lastDecisionResult, "lastDecisionResult");
    if (!DECISION_BY_ID.has(result.decisionId)) throw new RangeError("lastDecisionResult.decisionId is invalid.");
  }
  if (record.lastTransaction != null) {
    const transaction = requireRecord(record.lastTransaction, "lastTransaction");
    const transactionSerial = requireInteger(transaction.serial, 1, parsedSerials.transaction, "lastTransaction.serial");
    if (transactionSerial !== parsedSerials.transaction || !transactionSources.includes(transaction.transactionId)
      || transaction.sourceId !== transaction.transactionId || transaction.idempotencySourceId !== transaction.transactionId
      || transaction.callerOwned !== true || transaction.callerMustApplyOnce !== true) {
      throw new RangeError("lastTransaction idempotency metadata is inconsistent.");
    }
  }
  if (!Array.isArray(record.pendingEvents)) throw new TypeError("pendingEvents must be an array.");
  const pendingEvents = clone(record.pendingEvents);
  let previousEventSerial = 0;
  for (let index = 0; index < pendingEvents.length; ++index) {
    const event = requireRecord(pendingEvents[index], `pendingEvents[${index}]`);
    const eventSerial = requireInteger(event.serial, 1, parsedSerials.event, `pendingEvents[${index}].serial`);
    if (eventSerial <= previousEventSerial) throw new RangeError("pending-event serials must increase.");
    previousEventSerial = eventSerial;
    if (typeof event.type !== "string" || !event.type) throw new RangeError(`pendingEvents[${index}].type is invalid.`);
  }
  return {
    version: MARKET_SHIFT_SAVE_VERSION,
    seed: parsedSeed,
    clock: {
      dayIndex: requireInteger(clock.dayIndex, 0, 10_000_000, "clock.dayIndex"),
      minuteOfDay: requireInteger(clock.minuteOfDay, 0, MINUTES_PER_DAY - 1, "clock.minuteOfDay"),
    },
    completedDays,
    sourceLedger,
    transactionSources,
    serials: parsedSerials,
    shift,
    lastStationResult: record.lastStationResult == null ? null : clone(record.lastStationResult),
    lastDecisionResult: record.lastDecisionResult == null ? null : clone(record.lastDecisionResult),
    lastTransaction: record.lastTransaction == null ? null : clone(record.lastTransaction),
    pendingEvents,
    lastEvent: cleanId(record.lastEvent),
    stateRevision: requireInteger(record.stateRevision ?? 0, 0, Number.MAX_SAFE_INTEGER, "stateRevision"),
  };
}

export function migrateMarketShiftSave(value) {
  return deepFreeze(parseSave(value));
}

export function createMarketShiftSystem({ seed = DEFAULT_SEED } = {}) {
  let worldSeed = integer(seed, DEFAULT_SEED) >>> 0;
  let clock = { dayIndex: 0, minuteOfDay: MINA_MARKET_HOURS.openMinute };
  let completedDays = new Set();
  let sourceLedger = new Set();
  let transactionSources = new Set();
  let serials = { command: 0, transaction: 0, stationResult: 0, event: 0 };
  let shift = null;
  let lastStationResult = null;
  let lastDecisionResult = null;
  let lastTransaction = null;
  let pendingEvents = [];
  let lastEvent = "";
  let stateRevision = 0;
  let cachedSnapshot = null;
  let cachedSave = null;
  let prewarmResult = null;
  const runtimeView = {
    dayIndex: clock.dayIndex,
    minuteOfDay: clock.minuteOfDay,
    status: "idle",
    stationId: null,
    taskProgress: 0,
    taskActive: false,
    decisionRequired: false,
    commandSerial: 0,
    transactionSerial: 0,
    stationResultSerial: 0,
    lastEvent: "",
    stateRevision: 0,
  };

  function touch(eventName = null) {
    stateRevision += 1;
    cachedSnapshot = null;
    cachedSave = null;
    if (eventName != null) lastEvent = eventName;
  }

  function syncClock(context = {}, mutate = true) {
    const next = clockFrom(context, clock.dayIndex, clock.minuteOfDay);
    if (mutate && shift && shift.status !== "completed" && next.dayIndex > shift.dayIndex) {
      const expiredShiftId = shift.id;
      const expiredDayIndex = shift.dayIndex;
      shift = null;
      emit("market_shift_expired", { shiftId: expiredShiftId, dayIndex: expiredDayIndex, expiredAtDayIndex: next.dayIndex });
      touch("market_shift_expired");
    }
    if (mutate && (next.dayIndex !== clock.dayIndex || next.minuteOfDay !== clock.minuteOfDay)) {
      clock = next;
      touch();
    }
    return next;
  }

  function sourceId(context) {
    return cleanId(context?.sourceId ?? context?.idempotencySourceId);
  }

  function duplicateSource(context) {
    const id = sourceId(context);
    return id ? sourceLedger.has(id) : false;
  }

  function recordSource(context) {
    const id = sourceId(context);
    serials.command += 1;
    if (id) sourceLedger.add(id);
    return id || `mina-market:auto:${serials.command}`;
  }

  function emit(type, payload = {}) {
    serials.event += 1;
    const event = deepFreeze({ type, serial: serials.event, ...clone(payload) });
    pendingEvents.push(event);
    lastEvent = type;
    return event;
  }

  function expectedStation() {
    return shift && shift.nextStationIndex < MINA_MARKET_STATIONS.length
      ? MINA_MARKET_STATIONS[shift.nextStationIndex]
      : null;
  }

  function staffState(staffId = MINA_OKAFOR.id, context = {}) {
    const definition = MINA_MARKET_STAFF.find(value => value.id === staffId);
    if (!definition) return null;
    const at = clockFrom(context, clock.dayIndex, clock.minuteOfDay);
    return staffScheduleState(definition, at.dayIndex, at.minuteOfDay);
  }

  function availability(context = {}) {
    const at = clockFrom(context, clock.dayIndex, clock.minuteOfDay);
    const currentDayShift = shift?.dayIndex === at.dayIndex ? shift : null;
    const openDay = MINA_MARKET_HOURS.openDays.includes(dayOfWeek(at.dayIndex));
    const businessOpen = openDay && at.minuteOfDay >= MINA_MARKET_HOURS.openMinute
      && at.minuteOfDay < MINA_MARKET_HOURS.closeMinute;
    let reason = null;
    if (!businessOpen) reason = "market_closed";
    else if (at.minuteOfDay > MINA_MARKET_HOURS.lastClockInMinute) reason = "outside_clock_in_hours";
    else if (completedDays.has(at.dayIndex)) reason = "already_completed_today";
    else if (currentDayShift && currentDayShift.status !== "completed") reason = "already_active";
    return deepFreeze({
      canBegin: reason == null,
      available: reason == null,
      reason,
      businessId: MINA_MARKET_WORKPLACE.id,
      activityId: MINA_MARKET_SHIFT_ROLE.id,
      dayIndex: at.dayIndex,
      minuteOfDay: at.minuteOfDay,
      businessOpen,
      withinClockIn: at.minuteOfDay >= MINA_MARKET_HOURS.openMinute
        && at.minuteOfDay <= MINA_MARKET_HOURS.lastClockInMinute,
      lastClockInMinute: MINA_MARKET_HOURS.lastClockInMinute,
      completedToday: completedDays.has(at.dayIndex),
      active: currentDayShift?.status === "active",
      paused: currentDayShift?.status === "paused",
      nextStationId: currentDayShift ? expectedStation()?.id ?? null : MINA_MARKET_STATIONS[0].id,
      supervisor: staffScheduleState(MINA_OKAFOR, at.dayIndex, at.minuteOfDay),
      coworker: staffScheduleState(MINA_MARKET_STAFF[1], at.dayIndex, at.minuteOfDay),
      scenario: createMinaMarketDailyScenario(at.dayIndex, { seed: worldSeed }),
    });
  }

  function context(contextValue = {}) {
    const at = clockFrom(contextValue, clock.dayIndex, clock.minuteOfDay);
    return deepFreeze({
      market: MINA_MARKET_WORKPLACE,
      role: MINA_MARKET_SHIFT_ROLE,
      availability: availability(at),
      staff: MINA_MARKET_STAFF.map(definition => staffScheduleState(definition, at.dayIndex, at.minuteOfDay)),
      scenario: createMinaMarketDailyScenario(at.dayIndex, { seed: worldSeed }),
      stations: MINA_MARKET_STATIONS,
      surplusDecisions: MARKET_SURPLUS_DECISIONS,
    });
  }

  function begin(contextValue = {}) {
    if (duplicateSource(contextValue)) return rejected("duplicate_source", { sourceId: sourceId(contextValue) });
    const at = syncClock(contextValue);
    const access = availability(at);
    if (!access.canBegin) return rejected(access.reason, { availability: access });
    const physical = stationAccess(MINA_MARKET_STATIONS[0], contextValue);
    if (!physical.accepted) return physical;
    const recordedSourceId = recordSource(contextValue);
    shift = {
      id: `mina-market-shift-${at.dayIndex}`,
      dayIndex: at.dayIndex,
      status: "active",
      startedMinute: at.minuteOfDay,
      nextStationIndex: 0,
      attempts: Array(MINA_MARKET_STATIONS.length).fill(0),
      task: null,
      stationResults: [],
      surplusDecisionId: null,
      decisionResult: null,
      qualityTotal: 0,
      passedStations: 0,
      reworkCount: 0,
      totalGameMinutes: 0,
      needTotals: { energy: 0, hygiene: 0, appetite: 0 },
      scenario: clone(access.scenario),
      beginSourceId: recordedSourceId,
    };
    emit("market_shift_started", { dayIndex: at.dayIndex, shiftId: shift.id });
    touch("market_shift_started");
    return accepted({
      event: "market_shift_started",
      sourceId: recordedSourceId,
      shiftId: shift.id,
      activityId: MINA_MARKET_SHIFT_ROLE.id,
      dayIndex: shift.dayIndex,
      nextStationId: MINA_MARKET_STATIONS[0].id,
      supervisor: access.supervisor,
      coworker: access.coworker,
      briefing: MINA_MARKET_SHIFT_ROLE.briefing,
      scenario: frozenCopy(shift.scenario),
    });
  }

  function resume(contextValue = {}) {
    if (duplicateSource(contextValue)) return rejected("duplicate_source", { sourceId: sourceId(contextValue) });
    const at = syncClock(contextValue);
    if (!shift) return rejected("no_active_shift");
    if (shift.status !== "paused") return rejected("shift_not_paused");
    if (at.dayIndex !== shift.dayIndex) return rejected("shift_day_expired");
    if (at.minuteOfDay >= MINA_MARKET_HOURS.closeMinute) return rejected("market_closed");
    const station = expectedStation();
    if (station) {
      const physical = stationAccess(station, contextValue);
      if (!physical.accepted) return physical;
    }
    recordSource(contextValue);
    shift.status = "active";
    emit("market_shift_resumed", { shiftId: shift.id });
    touch("market_shift_resumed");
    return accepted({ resumed: true, taskPreserved: shift.task != null, nextStationId: station?.id ?? null });
  }

  function performStation(stationIdValue, contextValue = {}) {
    if (duplicateSource(contextValue)) return rejected("duplicate_source", { sourceId: sourceId(contextValue) });
    const at = syncClock(contextValue);
    if (!shift) return rejected("no_active_shift");
    if (shift.status === "paused") return rejected("shift_paused");
    if (shift.status === "completed") return rejected("shift_completed");
    if (shift.task) return rejected("task_in_progress", { stationId: shift.task.stationId });
    if (at.dayIndex !== shift.dayIndex) return rejected("shift_day_expired");
    if (at.minuteOfDay >= MINA_MARKET_HOURS.closeMinute) return rejected("market_closed");
    const expected = expectedStation();
    if (!expected) return rejected("no_station_remaining");
    if (shift.nextStationIndex >= 4 && !shift.surplusDecisionId) {
      return rejected("surplus_decision_required", { decisionStationId: "mina-pantry-shelf" });
    }
    const requestedId = STATION_ALIAS_TO_ID.get(cleanId(stationIdValue)) ?? cleanId(stationIdValue);
    if (requestedId !== expected.id) {
      return rejected("wrong_station", { expectedStationId: expected.id, actualStationId: cleanId(stationIdValue) });
    }
    const physical = stationAccess(expected, contextValue);
    if (!physical.accepted) return physical;
    const safetyConfirmed = contextValue?.safetyConfirmed === true;
    const rawQuality = qualityInput(contextValue);
    const experience = skillLevel(contextValue, expected.primarySkill);
    const attempt = shift.attempts[shift.nextStationIndex] + 1;
    const jitter = (hash32(`${worldSeed}:${shift.dayIndex}:${expected.id}:${attempt}`) % 7) - 3;
    const scoredQuality = clamp(Math.round(rawQuality + experience * 0.12 + jitter), 0, 100);
    const recordedSourceId = recordSource(contextValue);
    shift.attempts[shift.nextStationIndex] = attempt;
    shift.task = {
      stationId: expected.id,
      physicalStationId: physical.physicalStationId,
      sourceId: recordedSourceId,
      remainingSeconds: expected.realSeconds,
      durationSeconds: expected.realSeconds,
      rawQuality,
      skillLevel: experience,
      scoredQuality,
      safetyConfirmed,
      attempt,
    };
    emit("market_station_started", { shiftId: shift.id, stationId: expected.id, attempt });
    touch("market_station_started");
    return accepted({
      event: "market_station_started",
      sourceId: recordedSourceId,
      shiftId: shift.id,
      activityId: MINA_MARKET_SHIFT_ROLE.id,
      stationId: expected.id,
      physicalStationId: physical.physicalStationId,
      actionId: expected.actionId,
      roomId: expected.roomId,
      durationSeconds: expected.realSeconds,
      gameMinutes: expected.gameMinutes,
      needEffects: expected.needEffects,
      safetyRequired: expected.safetyRequired,
      checks: expected.checks,
      instruction: expected.instruction,
      supervisorLine: expected.supervisorLine,
    });
  }

  function chooseSurplus(decisionIdValue, contextValue = {}) {
    if (duplicateSource(contextValue)) return rejected("duplicate_source", { sourceId: sourceId(contextValue) });
    const at = syncClock(contextValue);
    if (!shift) return rejected("no_active_shift");
    if (shift.status !== "active") return rejected(shift.status === "paused" ? "shift_paused" : "shift_completed");
    if (shift.task) return rejected("task_in_progress", { stationId: shift.task.stationId });
    if (shift.nextStationIndex < 4) return rejected("surplus_decision_not_ready");
    if (shift.surplusDecisionId) return rejected("surplus_decision_already_recorded", { decisionId: shift.surplusDecisionId });
    const decision = DECISION_BY_ID.get(cleanId(decisionIdValue));
    if (!decision) return rejected("unknown_surplus_decision", { choices: MARKET_SURPLUS_DECISIONS.map(value => value.id) });
    const access = stationAccess(MINA_MARKET_STATIONS[3], contextValue);
    if (!access.accepted) return access;
    if (at.dayIndex !== shift.dayIndex) return rejected("shift_day_expired");
    const recordedSourceId = recordSource(contextValue);
    const result = deepFreeze({
      id: `mina-surplus-${shift.dayIndex}-${decision.id}`,
      decisionId: decision.id,
      sourceId: recordedSourceId,
      dayIndex: shift.dayIndex,
      item: shift.scenario.surplus.item,
      units: shift.scenario.surplus.units,
      safeToDonate: shift.scenario.surplus.safeToDonate,
      wageAdjustment: decision.wageAdjustment,
      qualityAdjustment: decision.qualityAdjustment,
      communityTrust: decision.communityTrust,
      communityExperience: decision.communityExperience,
      edibleUnitsSaved: decision.edibleUnitsSaved,
      discardedUnits: decision.discardedUnits,
      gameMinutes: decision.gameMinutes,
      needEffects: decision.needEffects,
      tradeoff: decision.tradeoff,
      line: decision.line,
    });
    shift.surplusDecisionId = decision.id;
    shift.decisionResult = clone(result);
    shift.totalGameMinutes += decision.gameMinutes;
    shift.needTotals.energy += decision.needEffects.energy;
    shift.needTotals.hygiene += decision.needEffects.hygiene;
    shift.needTotals.appetite += decision.needEffects.appetite;
    lastDecisionResult = result;
    emit("market_surplus_decided", { shiftId: shift.id, decisionId: decision.id, sourceId: recordedSourceId });
    touch("market_surplus_decided");
    return accepted({ result, nextStationId: expectedStation()?.id ?? null });
  }

  function createCompletionTransaction() {
    const decision = DECISION_BY_ID.get(shift.surplusDecisionId);
    const baseQuality = shift.passedStations > 0 ? shift.qualityTotal / shift.passedStations : 0;
    const quality = clamp(Math.round(baseQuality + decision.qualityAdjustment), 0, 100);
    const qualityPay = Math.round((quality - 70) / 5);
    const reworkPenalty = Math.min(8, shift.reworkCount * 2);
    const wage = Math.max(60, MINA_MARKET_SHIFT_ROLE.baseWage + qualityPay + decision.wageAdjustment - reworkPenalty);
    serials.transaction += 1;
    const transactionId = `mina-market-wage:${shift.dayIndex}:${serials.transaction}`;
    transactionSources.add(transactionId);
    const communityExperience = 10 + decision.communityExperience;
    return deepFreeze({
      transactionId,
      serial: serials.transaction,
      sourceId: transactionId,
      idempotencySourceId: transactionId,
      kind: "lawful_market_shift_wage",
      callerOwned: true,
      callerMustApplyOnce: true,
      activityId: MINA_MARKET_SHIFT_ROLE.id,
      businessId: MINA_MARKET_WORKPLACE.id,
      dayIndex: shift.dayIndex,
      wage,
      cashEffect: wage,
      communityTrust: decision.communityTrust,
      needEffects: clone(shift.needTotals),
      skillEffects: [
        { skillId: "hospitality", experience: 28 },
        { skillId: "community", experience: communityExperience },
        { skillId: "fitness", experience: 18 },
      ],
      quality,
      reworkCount: shift.reworkCount,
      gameMinutes: shift.totalGameMinutes,
      surplusDecision: clone(shift.decisionResult),
      stockEffects: {
        edibleUnitsSaved: decision.edibleUnitsSaved,
        discardedUnits: decision.discardedUnits,
        callerOwnedInventoryMutation: false,
      },
      externalLedgerEffects: { customerPurchases: 0, tillCents: 0, householdGroceries: 0 },
      completionLine: MINA_MARKET_SHIFT_ROLE.completionLine,
    });
  }

  function finishTask() {
    const task = shift.task;
    const station = STATION_BY_ID.get(task.stationId);
    const passed = task.safetyConfirmed && task.scoredQuality >= station.minimumQuality;
    let outcome = "passed";
    if (!task.safetyConfirmed) outcome = "safety_rework";
    else if (!passed) outcome = "quality_rework";
    shift.totalGameMinutes += station.gameMinutes;
    shift.needTotals.energy += station.needEffects.energy;
    shift.needTotals.hygiene += station.needEffects.hygiene;
    shift.needTotals.appetite += station.needEffects.appetite;
    if (passed) {
      shift.qualityTotal += task.scoredQuality;
      shift.passedStations += 1;
      shift.nextStationIndex += 1;
    } else {
      shift.reworkCount += 1;
    }
    serials.stationResult += 1;
    const next = expectedStation();
    const result = deepFreeze({
      id: `mina-station-result-${serials.stationResult}`,
      serial: serials.stationResult,
      shiftId: shift.id,
      dayIndex: shift.dayIndex,
      stationId: station.id,
      physicalStationId: task.physicalStationId,
      sourceId: task.sourceId,
      attempt: task.attempt,
      passed,
      outcome,
      quality: task.scoredQuality,
      minimumQuality: station.minimumQuality,
      safetyConfirmed: task.safetyConfirmed,
      effects: { gameMinutes: station.gameMinutes, needs: station.needEffects },
      nextStationId: next?.id ?? null,
      decisionRequired: passed && shift.nextStationIndex === 4 && !shift.surplusDecisionId,
      line: passed ? station.passLine : station.reworkLine,
    });
    shift.stationResults.push(clone(result));
    shift.task = null;
    lastStationResult = result;
    if (passed && shift.nextStationIndex >= MINA_MARKET_STATIONS.length) {
      lastTransaction = createCompletionTransaction();
      completedDays.add(shift.dayIndex);
      shift.status = "completed";
      emit("market_shift_completed", { shiftId: shift.id, transaction: lastTransaction });
      touch("market_shift_completed");
    } else {
      emit(passed ? "market_station_completed" : "market_station_rework", {
        shiftId: shift.id,
        stationId: station.id,
        resultSerial: result.serial,
        decisionRequired: result.decisionRequired,
      });
      touch(passed ? "market_station_completed" : "market_station_rework");
    }
    return result;
  }

  function update(deltaSeconds = 0, contextValue = {}) {
    syncClock(contextValue);
    const elapsed = Math.max(0, finite(deltaSeconds));
    if (shift?.status === "active" && shift.task && elapsed > 0) {
      shift.task.remainingSeconds = Math.max(0, shift.task.remainingSeconds - elapsed);
      if (shift.task.remainingSeconds <= 0) finishTask();
      else touch();
    }
    if (contextValue?.captureSnapshot !== false) return snapshot();
    const task = shift?.task;
    runtimeView.dayIndex = clock.dayIndex;
    runtimeView.minuteOfDay = clock.minuteOfDay;
    runtimeView.status = shift?.status ?? "idle";
    runtimeView.stationId = task?.stationId ?? expectedStation()?.id ?? null;
    runtimeView.taskProgress = task ? clamp(1 - task.remainingSeconds / task.durationSeconds, 0, 1) : 0;
    runtimeView.taskActive = task != null;
    runtimeView.decisionRequired = Boolean(shift && shift.nextStationIndex >= 4 && !shift.surplusDecisionId && shift.status === "active");
    runtimeView.commandSerial = serials.command;
    runtimeView.transactionSerial = serials.transaction;
    runtimeView.stationResultSerial = serials.stationResult;
    runtimeView.lastEvent = lastEvent;
    runtimeView.stateRevision = stateRevision;
    return runtimeView;
  }

  function pause(contextValue = {}) {
    if (duplicateSource(contextValue)) return rejected("duplicate_source", { sourceId: sourceId(contextValue) });
    syncClock(contextValue);
    if (!shift) return rejected("no_active_shift");
    if (shift.status !== "active") return rejected(shift.status === "paused" ? "shift_already_paused" : "shift_completed");
    recordSource(contextValue);
    shift.status = "paused";
    emit("market_shift_paused", { shiftId: shift.id });
    touch("market_shift_paused");
    return accepted({ paused: true, taskPreserved: shift.task != null });
  }

  function abandon(contextValue = {}) {
    if (duplicateSource(contextValue)) return rejected("duplicate_source", { sourceId: sourceId(contextValue) });
    syncClock(contextValue);
    if (!shift) return rejected("no_active_shift");
    if (shift.status === "completed") return rejected("shift_completed");
    const abandonedShiftId = shift.id;
    const abandonedDayIndex = shift.dayIndex;
    const taskDiscarded = shift.task != null;
    const recordedSourceId = recordSource(contextValue);
    shift = null;
    emit("market_shift_abandoned", {
      shiftId: abandonedShiftId,
      dayIndex: abandonedDayIndex,
      sourceId: recordedSourceId,
      taskDiscarded,
    });
    touch("market_shift_abandoned");
    return accepted({
      event: "market_shift_abandoned",
      sourceId: recordedSourceId,
      shiftId: abandonedShiftId,
      dayIndex: abandonedDayIndex,
      taskDiscarded,
      wage: 0,
      completedToday: false,
    });
  }

  function shiftView() {
    if (!shift) return null;
    const station = expectedStation();
    return {
      id: shift.id,
      dayIndex: shift.dayIndex,
      status: shift.status,
      startedMinute: shift.startedMinute,
      nextStationIndex: shift.nextStationIndex,
      nextStationId: station?.id ?? null,
      nextWorldStationIds: station ? stationWorldIds(station) : [],
      task: clone(shift.task),
      taskProgress: shift.task ? clamp(1 - shift.task.remainingSeconds / shift.task.durationSeconds, 0, 1) : 0,
      attempts: [...shift.attempts],
      stationResults: clone(shift.stationResults),
      surplusDecisionId: shift.surplusDecisionId,
      surplusDecisionRequired: shift.nextStationIndex >= 4 && !shift.surplusDecisionId && shift.status !== "completed",
      decisionResult: clone(shift.decisionResult),
      qualityTotal: shift.qualityTotal,
      passedStations: shift.passedStations,
      reworkCount: shift.reworkCount,
      totalGameMinutes: shift.totalGameMinutes,
      needTotals: clone(shift.needTotals),
      scenario: clone(shift.scenario),
      beginSourceId: shift.beginSourceId,
    };
  }

  function snapshot() {
    if (cachedSnapshot) return cachedSnapshot;
    cachedSnapshot = deepFreeze({
      version: MARKET_SHIFT_SAVE_VERSION,
      seed: worldSeed,
      clock: clone(clock),
      market: MINA_MARKET_WORKPLACE,
      role: MINA_MARKET_SHIFT_ROLE,
      postedHours: MINA_MARKET_HOURS,
      staff: MINA_MARKET_STAFF.map(definition => staffScheduleState(definition, clock.dayIndex, clock.minuteOfDay)),
      availability: availability(clock),
      activeShift: shiftView(),
      completedDays: [...completedDays].sort((a, b) => a - b),
      lastStationResult,
      lastDecisionResult,
      lastTransaction,
      pendingEventCount: pendingEvents.length,
      ledger: {
        sourceCount: sourceLedger.size,
        transactionSourceCount: transactionSources.size,
        transactionSources: [...transactionSources],
      },
      serials: clone(serials),
      lastEvent,
      stateRevision,
    });
    return cachedSnapshot;
  }

  function save() {
    if (cachedSave) return cachedSave;
    cachedSave = deepFreeze({
      version: MARKET_SHIFT_SAVE_VERSION,
      seed: worldSeed,
      clock: clone(clock),
      completedDays: [...completedDays].sort((a, b) => a - b),
      sourceLedger: [...sourceLedger],
      transactionSources: [...transactionSources],
      serials: clone(serials),
      shift: clone(shift),
      lastStationResult: clone(lastStationResult),
      lastDecisionResult: clone(lastDecisionResult),
      lastTransaction: clone(lastTransaction),
      pendingEvents: clone(pendingEvents),
      lastEvent,
      stateRevision,
    });
    return cachedSave;
  }

  function restore(value) {
    const parsed = parseSave(value);
    worldSeed = parsed.seed;
    clock = parsed.clock;
    completedDays = new Set(parsed.completedDays);
    sourceLedger = new Set(parsed.sourceLedger);
    transactionSources = new Set(parsed.transactionSources);
    serials = parsed.serials;
    shift = parsed.shift;
    lastStationResult = parsed.lastStationResult == null ? null : deepFreeze(parsed.lastStationResult);
    lastDecisionResult = parsed.lastDecisionResult == null ? null : deepFreeze(parsed.lastDecisionResult);
    lastTransaction = parsed.lastTransaction == null ? null : deepFreeze(parsed.lastTransaction);
    pendingEvents = parsed.pendingEvents.map(event => deepFreeze(event));
    lastEvent = parsed.lastEvent;
    stateRevision = parsed.stateRevision;
    cachedSnapshot = null;
    cachedSave = null;
    prewarmResult = null;
    return snapshot();
  }

  function drainEvents() {
    if (pendingEvents.length === 0) return deepFreeze([]);
    const result = deepFreeze([...pendingEvents]);
    pendingEvents = [];
    touch();
    return result;
  }

  function reset() {
    clock = { dayIndex: 0, minuteOfDay: MINA_MARKET_HOURS.openMinute };
    completedDays = new Set();
    sourceLedger = new Set();
    transactionSources = new Set();
    serials = { command: 0, transaction: 0, stationResult: 0, event: 0 };
    shift = null;
    lastStationResult = null;
    lastDecisionResult = null;
    lastTransaction = null;
    pendingEvents = [];
    lastEvent = "market_shift_reset";
    stateRevision = 0;
    cachedSnapshot = null;
    cachedSave = null;
    prewarmResult = null;
    return snapshot();
  }

  function prewarm() {
    if (prewarmResult) return prewarmResult;
    const before = JSON.stringify(save());
    let checksum = 0;
    for (const station of MINA_MARKET_STATIONS) {
      checksum = (checksum + hash32(station.id) + hash32(station.instruction) + hash32(station.passLine)
        + hash32(station.reworkLine) + station.checks.reduce((sum, check) => sum + hash32(check), 0)) >>> 0;
    }
    for (const decision of MARKET_SURPLUS_DECISIONS) {
      checksum = (checksum + hash32(decision.id) + hash32(decision.tradeoff) + hash32(decision.line)) >>> 0;
    }
    for (let day = 0; day < 14; ++day) {
      const scenario = createMinaMarketDailyScenario(day, { seed: worldSeed });
      checksum = (checksum + hash32(scenario.id) + hash32(scenario.customerOrder.id)
        + hash32(scenario.produce.lotCode) + hash32(scenario.pantry.lotCode)) >>> 0;
    }
    for (const staff of MINA_MARKET_STAFF) {
      checksum = (checksum + hash32(staff.id) + hash32(staff.jobTitle)) >>> 0;
    }
    if (JSON.stringify(save()) !== before) throw new Error("Mina's Market prewarm mutated live shift state.");
    prewarmResult = deepFreeze({
      ready: true,
      storage: "memory-only",
      diskResources: 0,
      rendererResources: 0,
      runtimeAssetsCreated: 0,
      stationsPrepared: MINA_MARKET_STATIONS.length,
      stationOutcomesPrepared: MINA_MARKET_STATIONS.length * 3,
      surplusBranchesPrepared: MARKET_SURPLUS_DECISIONS.length,
      dailyScenariosPrepared: 14,
      staffSchedulesPrepared: MINA_OKAFOR.workSchedule.length
        + MINA_MARKET_STAFF[1].weekdaySchedule.length + MINA_MARKET_STAFF[1].weekendSchedule.length,
      saveRestorePrepared: true,
      liveStatePreserved: true,
      checksum,
    });
    return prewarmResult;
  }

  return Object.freeze({
    availability,
    context,
    staffState,
    begin,
    clockIn: begin,
    performStation,
    workStation: performStation,
    chooseSurplus,
    update,
    advance: update,
    pause,
    cancel: pause,
    abandon,
    resume,
    snapshot,
    save,
    restore,
    drainEvents,
    reset,
    prewarm,
    postedHours: MINA_MARKET_HOURS,
    stations: MINA_MARKET_STATIONS,
    surplusDecisions: MARKET_SURPLUS_DECISIONS,
  });
}

export const createMinaMarketShift = createMarketShiftSystem;
