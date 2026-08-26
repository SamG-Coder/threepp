export const COMMUNITY_HUB_SAVE_VERSION = 1;

export const COMMUNITY_HUB_SKILLS = Object.freeze({
  MECHANICS: "mechanics",
  PHOTOGRAPHY: "photography",
  COMMUNITY: "community",
  HOSPITALITY: "hospitality",
});

const VALID_SKILLS = new Set(Object.values(COMMUNITY_HUB_SKILLS));
const MINUTES_PER_DAY = 24 * 60;

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

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function frozenCopy(value) {
  return deepFreeze(clone(value));
}

const WORLD_STATION_FOR_LOGICAL = Object.freeze({
  kitchen_hygiene: "kitchenPrep",
  kitchen_prepare: "kitchenPrep",
  kitchen_cook: "kitchenPrep",
  kitchen_pack: "kitchenServe",
  repair_intake: "repairIntake",
  repair_isolate: "repairBench",
  repair_diagnose: "repairBench",
  repair_mend: "repairBench",
  repair_return: "repairBench",
  archive_consent: "classroom",
  archive_capture: "photoDesk",
  archive_catalogue: "classroom",
  archive_review: "classroom",
});

const NEED_EFFECTS_FOR_LOGICAL = deepFreeze({
  kitchen_hygiene: { energy: -1, hygiene: 1, appetite: -1 },
  kitchen_prepare: { energy: -2, hygiene: -1, appetite: -2 },
  kitchen_cook: { energy: -2, hygiene: -1, appetite: -2 },
  kitchen_pack: { energy: -2, hygiene: -1, appetite: -2 },
  repair_intake: { energy: -1, hygiene: 0, appetite: -1 },
  repair_isolate: { energy: -1, hygiene: -1, appetite: -1 },
  repair_diagnose: { energy: -2, hygiene: -1, appetite: -2 },
  repair_mend: { energy: -3, hygiene: -3, appetite: -2 },
  repair_return: { energy: -1, hygiene: -1, appetite: -1 },
  archive_consent: { energy: -1, hygiene: 0, appetite: -1 },
  archive_capture: { energy: -2, hygiene: 0, appetite: -2 },
  archive_catalogue: { energy: -2, hygiene: 0, appetite: -2 },
  archive_review: { energy: -1, hygiene: 0, appetite: -1 },
});

function station(id, roleId, roomId, name, {
  gameMinutes,
  realSeconds,
  primarySkill,
  minimumQuality,
  safetyRequired = false,
  instruction,
  honestLine,
  passLine,
  reworkLine,
}) {
  return deepFreeze({
    id,
    worldStationId: WORLD_STATION_FOR_LOGICAL[id],
    needEffects: NEED_EFFECTS_FOR_LOGICAL[id],
    roleId,
    roomId,
    name,
    gameMinutes,
    realSeconds,
    primarySkill,
    minimumQuality,
    safetyRequired,
    instruction,
    honestLine,
    passLine,
    reworkLine,
  });
}

function hours(openMinute, lastStartMinute, closeMinute, openDays, label) {
  return deepFreeze({ openMinute, lastStartMinute, closeMinute, openDays, label });
}

function skillAward(skillId, experience) {
  return deepFreeze({ skillId, experience });
}

function role(id, name, roomId, staffIds, postedHours, stationIds, baseWage, skillAwards, briefing, completionLine) {
  return deepFreeze({
    id,
    name,
    roomId,
    staffIds,
    postedHours,
    stationIds,
    baseWage,
    skillAwards,
    lawful: true,
    briefing,
    completionLine,
  });
}

function scheduleSegment(activity, startMinute, endMinute, locationId, roomId = null) {
  return deepFreeze({ activity, startMinute, endMinute, locationId, roomId });
}

function staff(id, name, jobTitle, roleId, homeLocationId, leisureLocationId, workDays, schedule, dialogue) {
  return deepFreeze({
    id,
    name,
    jobTitle,
    roleId,
    homeLocationId,
    leisureLocationId,
    workDays,
    schedule,
    dialogue,
  });
}

export const COMMUNITY_HUB_STATIONS = deepFreeze([
  station("kitchen_hygiene", "community_kitchen", "training_kitchen", "HYGIENE AND ALLERGEN BOARD", {
    gameMinutes: 12, realSeconds: 1.8, primarySkill: "hospitality", minimumQuality: 55, safetyRequired: true,
    instruction: "Wash, sanitise, read today's allergy notes, and separate the labelled utensils before food comes out.",
    honestLine: "We do not guess about allergies. If a label is unclear, stop and ask.",
    passLine: "The surfaces, hands, and allergen tools are properly separated.",
    reworkLine: "Reset the bench and repeat the hygiene check. A rushed start is not worth making somebody ill.",
  }),
  station("kitchen_prepare", "community_kitchen", "training_kitchen", "PREPARATION BENCH", {
    gameMinutes: 28, realSeconds: 2.6, primarySkill: "hospitality", minimumQuality: 58,
    instruction: "Inspect the produce, trim only what is unusable, and cut an even batch so it cooks at the same rate.",
    honestLine: "Keep good food out of the bin. We have a budget and people donated this produce in good faith.",
    passLine: "The batch is even, usable, and waste has been recorded honestly.",
    reworkLine: "Sort the tray again and correct the uneven cuts before it reaches the cooker.",
  }),
  station("kitchen_cook", "community_kitchen", "training_kitchen", "RANGE AND TEMPERATURE PROBE", {
    gameMinutes: 35, realSeconds: 3.2, primarySkill: "hospitality", minimumQuality: 62, safetyRequired: true,
    instruction: "Cook the community meal evenly, verify its safe centre temperature, and write the actual reading in the log.",
    honestLine: "Write the number you measured, not the number you hoped to see. We can heat it longer.",
    passLine: "The meal is evenly cooked and the recorded temperature is safe.",
    reworkLine: "The temperature or handling check is not sound. Correct the batch and measure it again.",
  }),
  station("kitchen_pack", "community_kitchen", "packing_room", "MEAL PACKING TABLE", {
    gameMinutes: 24, realSeconds: 2.3, primarySkill: "community", minimumQuality: 60, safetyRequired: true,
    instruction: "Portion the meals fairly, seal them, and apply the correct date and allergen label to every container.",
    honestLine: "Every container goes to a real household. Check each label instead of hiding a mistake under the next one.",
    passLine: "The portions are fair, sealed, dated, and clearly labelled.",
    reworkLine: "Some packs cannot be safely identified. Reopen the batch, correct it, and count it again.",
  }),

  station("repair_intake", "repair_cafe", "repair_workshop", "REPAIR INTAKE DESK", {
    gameMinutes: 16, realSeconds: 1.9, primarySkill: "community", minimumQuality: 54,
    instruction: "Listen to the owner, record the fault in their words, inspect existing damage, and agree on what may be attempted.",
    honestLine: "Do not promise a repair before you inspect it. A clear no is kinder than a false guarantee.",
    passLine: "The owner, condition, reported fault, and limits of the repair are all recorded.",
    reworkLine: "The intake note is incomplete. Ask again and record the condition without making assumptions.",
  }),
  station("repair_isolate", "repair_cafe", "repair_workshop", "ISOLATION AND TOOL BENCH", {
    gameMinutes: 12, realSeconds: 1.8, primarySkill: "mechanics", minimumQuality: 58, safetyRequired: true,
    instruction: "Disconnect the power source, discharge stored energy where required, and choose intact protective tools.",
    honestLine: "If you cannot make it safe, tag it and stop. The café does not trade safety for a success count.",
    passLine: "The item is isolated and the selected tools are appropriate and intact.",
    reworkLine: "Isolation is incomplete. Step back, make the item safe, and verify it before touching the mechanism.",
  }),
  station("repair_diagnose", "repair_cafe", "repair_workshop", "DIAGNOSTIC MAT", {
    gameMinutes: 30, realSeconds: 2.8, primarySkill: "mechanics", minimumQuality: 62,
    instruction: "Trace the symptom, test the simplest likely causes first, and distinguish the failed part from nearby wear.",
    honestLine: "Replace evidence, not guesses. Parts and somebody else's time both cost money.",
    passLine: "The diagnosis explains the reported fault without inventing extra work.",
    reworkLine: "The evidence does not support that diagnosis yet. Return to the measurements and narrow it down.",
  }),
  station("repair_mend", "repair_cafe", "repair_workshop", "COMMUNITY REPAIR BENCH", {
    gameMinutes: 42, realSeconds: 3.5, primarySkill: "mechanics", minimumQuality: 64,
    instruction: "Make the smallest durable repair, route and fasten everything correctly, and preserve serviceable original parts.",
    honestLine: "A neat-looking shortcut is still a shortcut. Make it durable or explain why the item cannot be saved.",
    passLine: "The repair is secure, restrained, and no unnecessary part was discarded.",
    reworkLine: "The repair will not hold up in ordinary use. Undo the weak work and make the joint properly.",
  }),
  station("repair_return", "repair_cafe", "repair_workshop", "FUNCTION TEST AND RETURN DESK", {
    gameMinutes: 22, realSeconds: 2.4, primarySkill: "community", minimumQuality: 62, safetyRequired: true,
    instruction: "Reassemble guards, complete a controlled function test, and tell the owner exactly what changed and what still needs care.",
    honestLine: "A working test does not erase the limits of an old item. Put those limits on the return note.",
    passLine: "The item passes its controlled test and the owner receives a truthful condition note.",
    reworkLine: "The return check is incomplete. Do not hand it back until the guard, test, and written limits agree.",
  }),

  station("archive_consent", "local_archive", "archive_studio", "STORY AND CONSENT DESK", {
    gameMinutes: 18, realSeconds: 2, primarySkill: "community", minimumQuality: 58, safetyRequired: true,
    instruction: "Explain how the record may be used, capture the contributor's own description, and record their consent and restrictions.",
    honestLine: "It is their memory before it is our record. A person can say no, limit access, or change their mind.",
    passLine: "The contributor's words, permissions, and restrictions are clear.",
    reworkLine: "The permission is ambiguous. Pause the record and ask the contributor to choose in their own words.",
  }),
  station("archive_capture", "local_archive", "archive_studio", "COPY STAND AND LIGHT TABLE", {
    gameMinutes: 32, realSeconds: 3, primarySkill: "photography", minimumQuality: 64,
    instruction: "Set neutral light, square the camera to the object, protect the original, and make a sharp colour-reference frame.",
    honestLine: "Do not beautify the evidence. The fading, handwriting, and repairs are part of the object's history.",
    passLine: "The capture is sharp, square, colour-referenced, and leaves the original unharmed.",
    reworkLine: "The image cannot serve as a faithful record. Correct the light or alignment and capture it again.",
  }),
  station("archive_catalogue", "local_archive", "archive_studio", "CATALOGUE TERMINAL", {
    gameMinutes: 34, realSeconds: 2.9, primarySkill: "photography", minimumQuality: 60,
    instruction: "Transcribe visible facts, separate them from oral recollection, add accessible search terms, and cite the contributor.",
    honestLine: "Mark uncertainty as uncertainty. A tidy database is not an excuse to turn a guess into a fact.",
    passLine: "Facts, recollections, uncertainty, access terms, and credit are clearly distinguished.",
    reworkLine: "The record blurs fact and recollection. Correct the fields and keep the uncertainty visible.",
  }),
  station("archive_review", "local_archive", "reading_room", "CONTRIBUTOR REVIEW TABLE", {
    gameMinutes: 20, realSeconds: 2.2, primarySkill: "community", minimumQuality: 60, safetyRequired: true,
    instruction: "Show the completed record to the contributor, correct their name and restrictions, and provide the reference number.",
    honestLine: "Accuracy includes letting people see how the archive represents them.",
    passLine: "The contributor approves the record and leaves with its reference and access terms.",
    reworkLine: "The record does not yet match the contributor's account or restrictions. Correct it before publication.",
  }),
]);

const STATION_BY_ID = new Map(COMMUNITY_HUB_STATIONS.map(value => [value.id, value]));

export const COMMUNITY_HUB_ROLES = deepFreeze([
  role(
    "community_kitchen", "COMMUNITY KITCHEN SHIFT", "training_kitchen", ["asha_malik"],
    hours(7 * 60 + 30, 11 * 60 + 15, 13 * 60 + 30, [0, 1, 2, 3, 4, 5], "MON-SAT 07:30-13:30 / LAST START 11:15"),
    ["kitchen_hygiene", "kitchen_prepare", "kitchen_cook", "kitchen_pack"], 54,
    [skillAward("hospitality", 24), skillAward("community", 12)],
    "Asha: We are preparing ordinary food for neighbours, not performing charity for applause. Work cleanly, waste little, and label what you actually made.",
    "Asha: Thank you. The count and labels agree, so these meals can leave the kitchen with somebody willing to stand behind the work.",
  ),
  role(
    "repair_cafe", "REPAIR CAFE SHIFT", "repair_workshop", ["tomas_varga"],
    hours(10 * 60, 15 * 60 + 30, 18 * 60, [1, 2, 3, 4, 5, 6], "TUE-SUN 10:00-18:00 / LAST START 15:30"),
    ["repair_intake", "repair_isolate", "repair_diagnose", "repair_mend", "repair_return"], 66,
    [skillAward("mechanics", 30), skillAward("community", 10)],
    "Tomas: People bring us things they cannot casually replace. Listen first, isolate the hazard, and never disguise a temporary fix as a permanent one.",
    "Tomas: Good. The item is safer than when it arrived, and the owner gets the limits in writing instead of a sales pitch.",
  ),
  role(
    "local_archive", "LOCAL PHOTO AND ARCHIVE DESK", "archive_studio", ["priya_nwosu"],
    hours(11 * 60, 16 * 60, 18 * 60 + 30, [0, 2, 3, 4, 5], "MON, WED-SAT 11:00-18:30 / LAST START 16:00"),
    ["archive_consent", "archive_capture", "archive_catalogue", "archive_review"], 58,
    [skillAward("photography", 26), skillAward("community", 14)],
    "Priya: The archive is not ours to take. Explain the choice, preserve the object as it is, and distinguish what we know from what somebody remembers.",
    "Priya: That record is useful because it is careful, credited, and reviewable. Thank you for treating the contributor as part of the process.",
  ),
]);

const ROLE_BY_ID = new Map(COMMUNITY_HUB_ROLES.map(value => [value.id, value]));

export const COMMUNITY_HUB_STAFF = deepFreeze([
  staff("asha_malik", "ASHA MALIK", "KITCHEN COORDINATOR", "community_kitchen", "asha_home", "harbour_garden",
    [0, 1, 2, 3, 4, 5], [
      scheduleSegment("sleep", 0, 360, "asha_home"),
      scheduleSegment("home", 360, 405, "asha_home"),
      scheduleSegment("commute", 405, 450, "harbour_walk"),
      scheduleSegment("work", 450, 810, "harbour-skills-house", "training_kitchen"),
      scheduleSegment("leisure", 810, 990, "harbour_garden"),
      scheduleSegment("home", 990, 1440, "asha_home"),
    ], {
      greeting: "Morning. Aprons are clean, the delivery sheet is by the sink, and nothing leaves without a real label.",
      unavailable: "The kitchen shift is closed, but tomorrow's hours are posted on the street board.",
    }),
  staff("tomas_varga", "TOMAS VARGA", "REPAIR CAFE LEAD", "repair_cafe", "tomas_home", "canal_bench",
    [1, 2, 3, 4, 5, 6], [
      scheduleSegment("sleep", 0, 420, "tomas_home"),
      scheduleSegment("home", 420, 540, "tomas_home"),
      scheduleSegment("commute", 540, 600, "foundry_lane"),
      scheduleSegment("work", 600, 1080, "harbour-skills-house", "repair_workshop"),
      scheduleSegment("leisure", 1080, 1200, "canal_bench"),
      scheduleSegment("home", 1200, 1440, "tomas_home"),
    ], {
      greeting: "Put the owner's words on the card before you pick up a tool. The symptom matters more than showing what you know.",
      unavailable: "The benches are shut down and isolated. The posted hours show the next intake.",
    }),
  staff("priya_nwosu", "PRIYA NWOSU", "COMMUNITY ARCHIVIST", "local_archive", "priya_home", "market_library",
    [0, 2, 3, 4, 5], [
      scheduleSegment("sleep", 0, 450, "priya_home"),
      scheduleSegment("home", 450, 600, "priya_home"),
      scheduleSegment("commute", 600, 660, "market_library"),
      scheduleSegment("work", 660, 1110, "harbour-skills-house", "archive_studio"),
      scheduleSegment("leisure", 1110, 1260, "market_library"),
      scheduleSegment("home", 1260, 1440, "priya_home"),
    ], {
      greeting: "Before the camera, we start with consent. A detailed record made without permission is still a bad record.",
      unavailable: "The originals are secured for the evening. Desk hours and access conditions are on the notice board.",
    }),
]);

const STAFF_BY_ID = new Map(COMMUNITY_HUB_STAFF.map(value => [value.id, value]));

export const HARBOUR_SKILLS_HOUSE = deepFreeze({
  id: "harbour-skills-house",
  name: "Harbour Skills House",
  label: "Harbour Skills House",
  address: "42 Mariner Walk",
  buildingId: "harbour-skills-house-building",
  lawfulPublicBuilding: true,
  prohibitedActivities: ["combat", "weapons", "crime"],
  rooms: [
    { id: "welcome_hall", name: "WELCOME HALL", purpose: "posted hours, reception, lockers, and accessible toilets", stationIds: [] },
    { id: "training_kitchen", name: "TRAINING KITCHEN", purpose: "community meal preparation", stationIds: ["kitchen_hygiene", "kitchen_prepare", "kitchen_cook"] },
    { id: "packing_room", name: "PACKING ROOM", purpose: "fair portioning, labels, and collection", stationIds: ["kitchen_pack"] },
    { id: "repair_workshop", name: "REPAIR WORKSHOP", purpose: "supervised household-item repair", stationIds: ["repair_intake", "repair_isolate", "repair_diagnose", "repair_mend", "repair_return"] },
    { id: "archive_studio", name: "PHOTO AND ARCHIVE STUDIO", purpose: "consent, faithful capture, and cataloguing", stationIds: ["archive_consent", "archive_capture", "archive_catalogue"] },
    { id: "reading_room", name: "READING AND REVIEW ROOM", purpose: "contributor review and public access", stationIds: ["archive_review"] },
    { id: "staff_room", name: "STAFF ROOM", purpose: "breaks, schedules, and private records", stationIds: [] },
  ],
  roleIds: COMMUNITY_HUB_ROLES.map(value => value.id),
  staffIds: COMMUNITY_HUB_STAFF.map(value => value.id),
  stationIds: COMMUNITY_HUB_STATIONS.map(value => value.id),
});

function clockFrom(context, fallbackDay, fallbackMinute) {
  const dayValue = context?.dayIndex ?? context?.gameDay ?? context?.day;
  const minuteValue = context?.minuteOfDay ?? context?.timeMinutes
    ?? (context?.timeHours == null ? null : finite(context.timeHours) * 60);
  return {
    dayIndex: dayValue == null ? fallbackDay : Math.max(0, integer(dayValue)),
    minuteOfDay: minuteValue == null ? fallbackMinute : normalizeMinute(minuteValue),
  };
}

function dayOfWeek(dayIndex) {
  return ((integer(dayIndex) % 7) + 7) % 7;
}

function roleOpenOnDay(definition, dayIndex) {
  return definition.postedHours.openDays.includes(dayOfWeek(dayIndex));
}

function roleWithinStartHours(definition, minuteOfDay) {
  return minuteOfDay >= definition.postedHours.openMinute
    && minuteOfDay <= definition.postedHours.lastStartMinute;
}

function staffState(definition, dayIndex, minuteOfDay) {
  const workingDay = definition.workDays.includes(dayOfWeek(dayIndex));
  let segment = definition.schedule.find(value => minuteOfDay >= value.startMinute && minuteOfDay < value.endMinute)
    ?? definition.schedule[definition.schedule.length - 1];
  if (!workingDay && ["commute", "work"].includes(segment.activity)) {
    segment = {
      activity: minuteOfDay >= 10 * 60 && minuteOfDay < 17 * 60 ? "leisure" : "home",
      locationId: minuteOfDay >= 10 * 60 && minuteOfDay < 17 * 60
        ? definition.leisureLocationId : definition.homeLocationId,
      roomId: null,
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
    };
  }
  return deepFreeze({
    id: definition.id,
    name: definition.name,
    jobTitle: definition.jobTitle,
    roleId: definition.roleId,
    workingDay,
    activity: segment.activity,
    locationId: segment.locationId,
    roomId: segment.roomId,
    dialogue: segment.activity === "work" ? definition.dialogue.greeting : definition.dialogue.unavailable,
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

function safeJsonValue(value, label, depth = 0) {
  if (depth > 8) throw new RangeError(`${label} is too deeply nested.`);
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must contain only finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((child, index) => safeJsonValue(child, `${label}[${index}]`, depth + 1));
  if (typeof value !== "object") throw new TypeError(`${label} must be JSON-safe.`);
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = safeJsonValue(child, `${label}.${key}`, depth + 1);
  return result;
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requireSafeInteger(value, minimum, maximum, label) {
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
  if (new Set(result).size !== result.length) throw new RangeError(`${label} must not contain duplicate values.`);
  return result;
}

function legacyToVersionOne(value) {
  requireRecord(value, "community hub save");
  if (value.version !== 0) return value;
  const completedDays = requireRecord(value.completedDays ?? {}, "community hub v0 completedDays");
  const completed = COMMUNITY_HUB_ROLES.map(definition => ({
    roleId: definition.id,
    days: Array.from(completedDays[definition.id] ?? []).map(day => Math.max(0, integer(day))),
  }));
  const transactionSources = completed.flatMap(record => record.days.map(day =>
    `community-shift:${record.roleId}:${day}`));
  return {
    version: COMMUNITY_HUB_SAVE_VERSION,
    seed: Number.isSafeInteger(value.seed) ? value.seed >>> 0 : hash32("harbour-skills-house"),
    clock: {
      dayIndex: Math.max(0, integer(value.dayIndex)),
      minuteOfDay: normalizeMinute(value.minuteOfDay ?? 8 * 60),
    },
    serials: { shift: 0, command: 0, transaction: transactionSources.length },
    completed,
    shift: null,
    sourceLedger: Array.from(value.sourceLedger ?? []),
    transactionSources,
    lastEvent: "community_hub_v0_migrated",
    lastStationResult: null,
    lastTransaction: null,
  };
}

function parseShift(value) {
  if (value == null) return null;
  requireRecord(value, "community hub shift");
  const roleDefinition = ROLE_BY_ID.get(value.roleId);
  if (!roleDefinition) throw new RangeError("community hub shift references an unknown role.");
  const taskIndex = requireSafeInteger(value.taskIndex, 0, roleDefinition.stationIds.length - 1, "community hub shift taskIndex");
  if (!["active", "paused"].includes(value.status)) throw new RangeError("community hub shift status is invalid.");
  if (typeof value.id !== "string" || !value.id) throw new RangeError("community hub shift id is invalid.");
  const attempts = value.stationAttempts;
  if (!Array.isArray(attempts) || attempts.length !== roleDefinition.stationIds.length) {
    throw new RangeError("community hub station attempts do not match the role.");
  }
  const stationAttempts = attempts.map((attempt, index) => requireSafeInteger(attempt, 0, 100000, `community hub attempt ${index}`));
  const completedStationIds = uniqueStrings(value.completedStationIds, "community hub completed stations");
  if (completedStationIds.length !== taskIndex
    || completedStationIds.some((id, index) => id !== roleDefinition.stationIds[index])) {
    throw new RangeError("community hub completed station order is invalid.");
  }
  let task = null;
  if (value.task != null) {
    requireRecord(value.task, "community hub active task");
    const expectedId = roleDefinition.stationIds[taskIndex];
    if (value.task.stationId !== expectedId) throw new RangeError("community hub active task is not the expected station.");
    const stationDefinition = STATION_BY_ID.get(expectedId);
    const elapsedSeconds = finite(value.task.elapsedSeconds, NaN);
    const durationSeconds = finite(value.task.durationSeconds, NaN);
    if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0 || elapsedSeconds < 0 || elapsedSeconds >= durationSeconds + 0.000001) {
      throw new RangeError("community hub active task timing is invalid.");
    }
    task = {
      stationId: expectedId,
      sourceId: value.task.sourceId == null ? null : cleanId(value.task.sourceId),
      elapsedSeconds,
      durationSeconds,
      inputQuality: clamp(value.task.inputQuality, 0, 100),
      skillLevel: clamp(value.task.skillLevel, 0, 100),
      score: clamp(value.task.score, 0, 100),
      safetyConfirmed: value.task.safetyConfirmed === true,
      attemptNumber: requireSafeInteger(value.task.attemptNumber, 1, 100001, "community hub active task attempt"),
      gameMinutes: stationDefinition.gameMinutes,
    };
  }
  return {
    id: value.id,
    roleId: roleDefinition.id,
    dayIndex: requireSafeInteger(value.dayIndex, 0, Number.MAX_SAFE_INTEGER, "community hub shift day"),
    startMinute: requireSafeInteger(value.startMinute, 0, 1439, "community hub shift start minute"),
    status: value.status,
    taskIndex,
    totalGameMinutes: requireSafeInteger(value.totalGameMinutes, 0, 1000000, "community hub shift minutes"),
    qualityTotal: clamp(value.qualityTotal, 0, 10000000),
    qualitySamples: requireSafeInteger(value.qualitySamples, 0, 100000, "community hub quality samples"),
    safetyPasses: requireSafeInteger(value.safetyPasses, 0, 100000, "community hub safety passes"),
    reworkCount: requireSafeInteger(value.reworkCount, 0, 100000, "community hub rework count"),
    stationAttempts,
    completedStationIds,
    task,
  };
}

function parseVersionOneSave(input) {
  const value = legacyToVersionOne(input);
  requireRecord(value, "community hub save");
  if (value.version !== COMMUNITY_HUB_SAVE_VERSION) {
    throw new RangeError(`Unsupported community hub save version: ${String(value.version)}.`);
  }
  const clock = requireRecord(value.clock, "community hub clock");
  const serials = requireRecord(value.serials, "community hub serials");
  if (!Array.isArray(value.completed) || value.completed.length !== COMMUNITY_HUB_ROLES.length) {
    throw new RangeError("community hub completed-day records are invalid.");
  }
  const completed = COMMUNITY_HUB_ROLES.map((definition, index) => {
    const record = requireRecord(value.completed[index], `community hub completed[${index}]`);
    if (record.roleId !== definition.id) throw new RangeError("community hub completed-day role order is invalid.");
    const days = record.days;
    if (!Array.isArray(days)) throw new TypeError("community hub completed days must be an array.");
    const normalized = days.map((day, dayIndex) => requireSafeInteger(day, 0, Number.MAX_SAFE_INTEGER,
      `community hub completed day ${dayIndex}`));
    if (new Set(normalized).size !== normalized.length) throw new RangeError("community hub completed days must be unique.");
    return { roleId: definition.id, days: normalized };
  });
  const sourceLedger = uniqueStrings(value.sourceLedger, "community hub source ledger");
  const transactionSources = uniqueStrings(value.transactionSources, "community hub transaction sources");
  const lastEvent = String(value.lastEvent ?? "community_hub_ready").slice(0, 256);
  if (!lastEvent) throw new RangeError("community hub last event is invalid.");
  const parsed = {
    version: COMMUNITY_HUB_SAVE_VERSION,
    seed: requireSafeInteger(value.seed, 0, 0xffffffff, "community hub seed") >>> 0,
    clock: {
      dayIndex: requireSafeInteger(clock.dayIndex, 0, Number.MAX_SAFE_INTEGER, "community hub clock day"),
      minuteOfDay: requireSafeInteger(clock.minuteOfDay, 0, 1439, "community hub clock minute"),
    },
    serials: {
      shift: requireSafeInteger(serials.shift, 0, Number.MAX_SAFE_INTEGER, "community hub shift serial"),
      command: requireSafeInteger(serials.command, 0, Number.MAX_SAFE_INTEGER, "community hub command serial"),
      transaction: requireSafeInteger(serials.transaction, 0, Number.MAX_SAFE_INTEGER, "community hub transaction serial"),
    },
    completed,
    shift: parseShift(value.shift),
    sourceLedger,
    transactionSources,
    lastEvent,
    lastStationResult: value.lastStationResult == null ? null
      : safeJsonValue(value.lastStationResult, "community hub last station result"),
    lastTransaction: value.lastTransaction == null ? null
      : safeJsonValue(value.lastTransaction, "community hub last transaction"),
  };
  const expectedTransactionSources = new Set(parsed.completed.flatMap(record => record.days.map(day =>
    `community-shift:${record.roleId}:${day}`)));
  if (parsed.serials.transaction !== transactionSources.length
    || expectedTransactionSources.size !== transactionSources.length
    || transactionSources.some(source => !expectedTransactionSources.has(source))) {
    throw new RangeError("community hub completion and transaction ledgers do not agree.");
  }
  if (parsed.lastTransaction != null) {
    if (!Number.isSafeInteger(parsed.lastTransaction.serial)
      || parsed.lastTransaction.serial < 1
      || parsed.lastTransaction.serial !== parsed.serials.transaction) {
      throw new RangeError("community hub last transaction serial is invalid.");
    }
    if (parsed.lastTransaction.sourceId !== transactionSources[transactionSources.length - 1]
      || parsed.lastTransaction.kind !== "lawful_shift_wage"
      || parsed.lastTransaction.callerOwned !== true) {
      throw new RangeError("community hub last transaction is missing from its source ledger.");
    }
  }
  return parsed;
}

export function migrateCommunityHubSave(value) {
  return frozenCopy(parseVersionOneSave(value));
}

/**
 * Renderer-independent, deterministic lawful work simulation for the physical
 * Harbour Skills House. Money, needs, world time, and skill levels remain
 * caller-owned; the system returns a single idempotent completion transaction.
 */
export function createCommunityHubSystem({
  seed = hash32("harbour-skills-house"),
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
  let lastEvent = "community_hub_ready";
  let lastStationResult = null;
  let lastTransaction = null;
  const completedDays = new Map(COMMUNITY_HUB_ROLES.map(value => [value.id, new Set()]));
  const sourceLedger = new Set();
  const transactionSources = new Set();
  let prewarmResult = null;
  let stateRevision = 0;
  let cachedSnapshotRevision = -1;
  let cachedSnapshot = null;
  const runtimeView = {
    dayIndex,
    minuteOfDay,
    activeRoleId: null,
    status: "idle",
    stationId: null,
    taskProgress: 0,
    taskActive: false,
    commandSerial,
    transactionSerial,
    lastStationResultSerial: 0,
    lastEvent,
    stateRevision: 0,
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
    const sourceId = cleanId(context?.sourceId);
    if (sourceId) sourceLedger.add(sourceId);
    commandSerial += 1;
    markDirty();
    return sourceId || `community:auto:${commandSerial}`;
  }

  function currentStation() {
    if (!shift) return null;
    const definition = ROLE_BY_ID.get(shift.roleId);
    return STATION_BY_ID.get(definition.stationIds[shift.taskIndex]) ?? null;
  }

  function availability(roleId, context = {}) {
    const definition = ROLE_BY_ID.get(cleanId(roleId));
    const clock = clockFrom(context, dayIndex, minuteOfDay);
    if (!definition) return deepFreeze({
      roleId: cleanId(roleId), dayIndex: clock.dayIndex, minuteOfDay: clock.minuteOfDay,
      available: false, canBegin: false, reason: "unknown_role", active: false, paused: false,
      completedToday: false, staff: [], nextStationId: null,
    });
    const completedToday = completedDays.get(definition.id).has(clock.dayIndex);
    const sameShift = shift?.roleId === definition.id;
    const active = sameShift && shift.status === "active";
    const paused = sameShift && shift.status === "paused";
    const openDay = roleOpenOnDay(definition, clock.dayIndex);
    const withinPostedHours = roleWithinStartHours(definition, clock.minuteOfDay);
    let reason = null;
    if (completedToday) reason = "already_completed_today";
    else if (shift && !sameShift) reason = shift.status === "paused" ? "paused_shift_pending" : "shift_in_progress";
    else if (active) reason = "already_active";
    else if (!paused && !openDay) reason = "closed_day";
    else if (!paused && !withinPostedHours) reason = "outside_start_hours";
    const staff = definition.staffIds.map(id => staffState(STAFF_BY_ID.get(id), clock.dayIndex, clock.minuteOfDay));
    return deepFreeze({
      roleId: definition.id,
      roleName: definition.name,
      dayIndex: clock.dayIndex,
      minuteOfDay: clock.minuteOfDay,
      openDay,
      withinPostedHours,
      completedToday,
      active,
      paused,
      available: reason == null || paused,
      canBegin: reason == null || paused,
      reason,
      postedHours: definition.postedHours,
      roomId: definition.roomId,
      staff,
      nextStationId: sameShift ? currentStation()?.id ?? null : definition.stationIds[0],
    });
  }

  function context(contextValue = {}) {
    const clock = clockFrom(contextValue, dayIndex, minuteOfDay);
    return deepFreeze({
      house: HARBOUR_SKILLS_HOUSE,
      clock,
      lawful: true,
      roles: COMMUNITY_HUB_ROLES.map(definition => availability(definition.id, clock)),
      staff: COMMUNITY_HUB_STAFF.map(definition => staffState(definition, clock.dayIndex, clock.minuteOfDay)),
      currentShiftId: shift?.id ?? null,
      currentRoleId: shift?.roleId ?? null,
      nextStationId: currentStation()?.id ?? null,
    });
  }

  function begin(roleId, contextValue = {}) {
    syncClock(contextValue);
    const sourceDuplicate = duplicateSource(contextValue);
    if (sourceDuplicate) return rejected("duplicate_source", { sourceId: sourceDuplicate });
    const definition = ROLE_BY_ID.get(cleanId(roleId));
    if (!definition) return rejected("unknown_role", { roleId: cleanId(roleId) });
    const state = availability(definition.id, { dayIndex, minuteOfDay });
    if (shift?.roleId === definition.id && shift.status === "paused") {
      const sourceId = recordSource(contextValue);
      shift.status = "active";
      lastEvent = "community_shift_resumed";
      return accepted({
        event: lastEvent,
        sourceId,
        shiftId: shift.id,
        roleId: shift.roleId,
        resumed: true,
        taskPreserved: shift.task != null,
        nextStationId: currentStation()?.id ?? null,
        dialogue: definition.briefing,
      });
    }
    if (!state.canBegin) return rejected(state.reason, { roleId: definition.id, availability: state });
    const sourceId = recordSource(contextValue);
    shiftSerial += 1;
    shift = {
      id: `community:${definition.id}:${dayIndex}:${shiftSerial}`,
      roleId: definition.id,
      dayIndex,
      startMinute: minuteOfDay,
      status: "active",
      taskIndex: 0,
      totalGameMinutes: 0,
      qualityTotal: 0,
      qualitySamples: 0,
      safetyPasses: 0,
      reworkCount: 0,
      stationAttempts: new Array(definition.stationIds.length).fill(0),
      completedStationIds: [],
      task: null,
    };
    lastEvent = "community_shift_begun";
    lastStationResult = null;
    return accepted({
      event: lastEvent,
      sourceId,
      shiftId: shift.id,
      roleId: definition.id,
      resumed: false,
      taskPreserved: false,
      nextStationId: currentStation().id,
      dialogue: definition.briefing,
    });
  }

  function performStation(stationId, contextValue = {}) {
    syncClock(contextValue);
    const sourceDuplicate = duplicateSource(contextValue);
    if (sourceDuplicate) return rejected("duplicate_source", { sourceId: sourceDuplicate });
    if (!shift) return rejected("no_active_shift", { stationId: cleanId(stationId) });
    if (shift.status !== "active") return rejected("shift_paused", { shiftId: shift.id });
    if (contextValue?.atHouse !== true) return rejected("inside_harbour_skills_house_required", {
      houseId: HARBOUR_SKILLS_HOUSE.id,
    });
    if (shift.task) return rejected("task_in_progress", {
      stationId: shift.task.stationId,
      progress: shift.task.elapsedSeconds / shift.task.durationSeconds,
    });
    const requested = STATION_BY_ID.get(cleanId(stationId));
    if (!requested) return rejected("unknown_station", { stationId: cleanId(stationId) });
    const expected = currentStation();
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
    lastEvent = "community_station_started";
    return accepted({
      event: lastEvent,
      sourceId,
      shiftId: shift.id,
      roleId: shift.roleId,
      stationId: expected.id,
      roomId: expected.roomId,
      durationSeconds,
      gameMinutes: expected.gameMinutes,
      needEffects: expected.needEffects,
      safetyRequired: expected.safetyRequired,
      instruction: expected.instruction,
      honestLine: expected.honestLine,
    });
  }

  function completionTransaction(roleDefinition, stationDefinition, stationResult) {
    const quality = shift.qualitySamples > 0 ? Math.round(shift.qualityTotal / shift.qualitySamples) : 0;
    const qualityAdjustment = Math.max(-4, Math.min(6, Math.round((quality - 65) / 8)));
    const reworkAdjustment = Math.min(4, shift.reworkCount);
    const wage = Math.max(roleDefinition.baseWage - 6,
      roleDefinition.baseWage + qualityAdjustment - reworkAdjustment);
    const sourceId = `community-shift:${roleDefinition.id}:${shift.dayIndex}`;
    if (transactionSources.has(sourceId) || completedDays.get(roleDefinition.id).has(shift.dayIndex)) {
      throw new Error(`Duplicate community shift completion transaction: ${sourceId}`);
    }
    transactionSerial += 1;
    transactionSources.add(sourceId);
    completedDays.get(roleDefinition.id).add(shift.dayIndex);
    const result = deepFreeze({
      serial: transactionSerial,
      sourceId,
      kind: "lawful_shift_wage",
      callerOwned: true,
      roleId: roleDefinition.id,
      roleName: roleDefinition.name,
      shiftId: shift.id,
      dayIndex: shift.dayIndex,
      wage,
      gameMinutes: shift.totalGameMinutes,
      quality,
      safetyPasses: shift.safetyPasses,
      reworkCount: shift.reworkCount,
      skillEffects: roleDefinition.skillAwards.map(value => ({ ...value })),
      dialogue: roleDefinition.completionLine,
      finalStationId: stationDefinition.id,
      stationOutcome: stationResult.outcome,
    });
    lastTransaction = result;
    return result;
  }

  function finishTask() {
    const roleDefinition = ROLE_BY_ID.get(shift.roleId);
    const stationDefinition = currentStation();
    const task = shift.task;
    shift.task = null;
    shift.stationAttempts[shift.taskIndex] += 1;
    shift.totalGameMinutes += stationDefinition.gameMinutes;
    shift.qualityTotal += task.score;
    shift.qualitySamples += 1;
    let outcome = "passed";
    let line = stationDefinition.passLine;
    if (stationDefinition.safetyRequired && !task.safetyConfirmed) outcome = "safety_rework";
    else if (task.score < stationDefinition.minimumQuality) outcome = "quality_rework";
    if (outcome !== "passed") {
      shift.reworkCount += 1;
      line = stationDefinition.reworkLine;
      lastEvent = outcome === "safety_rework" ? "community_station_safety_rework" : "community_station_quality_rework";
      lastStationResult = deepFreeze({
        serial: commandSerial,
        sourceId: task.sourceId,
        roleId: roleDefinition.id,
        stationId: stationDefinition.id,
        outcome,
        passed: false,
        score: task.score,
        minimumQuality: stationDefinition.minimumQuality,
        safetyRequired: stationDefinition.safetyRequired,
        safetyConfirmed: task.safetyConfirmed,
        gameMinutes: stationDefinition.gameMinutes,
        needEffects: stationDefinition.needEffects,
        effects: { gameMinutes: stationDefinition.gameMinutes, needs: stationDefinition.needEffects },
        nextStationId: stationDefinition.id,
        reworkCount: shift.reworkCount,
        line,
        transaction: null,
      });
      return;
    }
    if (stationDefinition.safetyRequired) shift.safetyPasses += 1;
    shift.completedStationIds.push(stationDefinition.id);
    shift.taskIndex += 1;
    const complete = shift.taskIndex >= roleDefinition.stationIds.length;
    let transaction = null;
    if (complete) {
      transaction = completionTransaction(roleDefinition, stationDefinition, { outcome });
      lastEvent = "community_shift_completed";
    } else {
      lastEvent = "community_station_completed";
    }
    lastStationResult = deepFreeze({
      serial: commandSerial,
      sourceId: task.sourceId,
      roleId: roleDefinition.id,
      stationId: stationDefinition.id,
      outcome,
      passed: true,
      score: task.score,
      minimumQuality: stationDefinition.minimumQuality,
      safetyRequired: stationDefinition.safetyRequired,
      safetyConfirmed: task.safetyConfirmed,
      gameMinutes: stationDefinition.gameMinutes,
      needEffects: stationDefinition.needEffects,
      effects: { gameMinutes: stationDefinition.gameMinutes, needs: stationDefinition.needEffects },
      nextStationId: complete ? null : roleDefinition.stationIds[shift.taskIndex],
      reworkCount: shift.reworkCount,
      line,
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
      runtimeView.activeRoleId = shift?.roleId ?? null;
      runtimeView.status = shift?.status ?? "idle";
      runtimeView.stationId = currentStation()?.id ?? null;
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

  function cancel(contextValue = {}) {
    syncClock(contextValue);
    const sourceDuplicate = duplicateSource(contextValue);
    if (sourceDuplicate) return rejected("duplicate_source", { sourceId: sourceDuplicate });
    if (!shift) return rejected("no_active_shift");
    if (shift.status === "paused") return rejected("already_paused", { shiftId: shift.id });
    const sourceId = recordSource(contextValue);
    shift.status = "paused";
    lastEvent = "community_shift_paused";
    return accepted({
      event: lastEvent,
      sourceId,
      shiftId: shift.id,
      roleId: shift.roleId,
      taskPreserved: shift.task != null,
      taskProgress: shift.task ? shift.task.elapsedSeconds / shift.task.durationSeconds : 0,
      nextStationId: currentStation()?.id ?? null,
    });
  }

  function shiftView() {
    if (!shift) return null;
    const roleDefinition = ROLE_BY_ID.get(shift.roleId);
    const expected = currentStation();
    return {
      id: shift.id,
      roleId: shift.roleId,
      roleName: roleDefinition.name,
      dayIndex: shift.dayIndex,
      startMinute: shift.startMinute,
      status: shift.status,
      taskIndex: shift.taskIndex,
      taskCount: roleDefinition.stationIds.length,
      completedStationIds: [...shift.completedStationIds],
      nextStationId: expected?.id ?? null,
      nextRoomId: expected?.roomId ?? null,
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
      saveVersion: COMMUNITY_HUB_SAVE_VERSION,
      house: HARBOUR_SKILLS_HOUSE,
      clock: { dayIndex, minuteOfDay },
      lawful: true,
      prohibitedActivities: HARBOUR_SKILLS_HOUSE.prohibitedActivities,
      activeShift: shiftView(),
      roles: COMMUNITY_HUB_ROLES.map(definition => ({
        ...availability(definition.id, { dayIndex, minuteOfDay }),
        completedDays: [...completedDays.get(definition.id)].sort((a, b) => a - b),
      })),
      staff: COMMUNITY_HUB_STAFF.map(definition => staffState(definition, dayIndex, minuteOfDay)),
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
      version: COMMUNITY_HUB_SAVE_VERSION,
      seed: runtimeSeed,
      clock: { dayIndex, minuteOfDay },
      serials: { shift: shiftSerial, command: commandSerial, transaction: transactionSerial },
      completed: COMMUNITY_HUB_ROLES.map(definition => ({
        roleId: definition.id,
        days: [...completedDays.get(definition.id)].sort((a, b) => a - b),
      })),
      shift: shift ? clone(shift) : null,
      sourceLedger: [...sourceLedger],
      transactionSources: [...transactionSources],
      lastEvent,
      lastStationResult: clone(lastStationResult),
      lastTransaction: clone(lastTransaction),
    };
  }

  function restore(value) {
    const parsed = parseVersionOneSave(value);
    runtimeSeed = parsed.seed;
    dayIndex = parsed.clock.dayIndex;
    minuteOfDay = parsed.clock.minuteOfDay;
    shiftSerial = parsed.serials.shift;
    commandSerial = parsed.serials.command;
    transactionSerial = parsed.serials.transaction;
    shift = parsed.shift;
    for (const days of completedDays.values()) days.clear();
    for (const record of parsed.completed) {
      const target = completedDays.get(record.roleId);
      for (const day of record.days) target.add(day);
    }
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
    for (const definition of COMMUNITY_HUB_ROLES) {
      checksum ^= hash32(`${definition.id}:${definition.briefing}:${definition.completionLine}`);
      dialoguePrepared += 2;
      for (const stationId of definition.stationIds) {
        const task = STATION_BY_ID.get(stationId);
        checksum ^= hash32(`${task.id}:${task.instruction}:${task.passLine}:${task.reworkLine}`);
        dialoguePrepared += 4;
      }
    }
    for (const definition of COMMUNITY_HUB_STAFF) {
      checksum ^= hash32(`${definition.id}:${definition.dialogue.greeting}:${definition.dialogue.unavailable}`);
      dialoguePrepared += 2;
    }
    checksum >>>= 0;
    prewarmResult = deepFreeze({
      ready: true,
      storage: "memory-only",
      diskResources: 0,
      rendererResources: 0,
      houseRoomsPrepared: HARBOUR_SKILLS_HOUSE.rooms.length,
      rolesPrepared: COMMUNITY_HUB_ROLES.length,
      stationsPrepared: COMMUNITY_HUB_STATIONS.length,
      staffPrepared: COMMUNITY_HUB_STAFF.length,
      dialoguePrepared,
      outcomeBranchesPrepared: COMMUNITY_HUB_STATIONS.length * 3,
      saveRestorePrepared: true,
      liveStatePreserved: JSON.stringify(save()) === before,
      checksum,
    });
    return prewarmResult;
  }

  return Object.freeze({
    house: HARBOUR_SKILLS_HOUSE,
    roles: COMMUNITY_HUB_ROLES,
    staff: COMMUNITY_HUB_STAFF,
    stations: COMMUNITY_HUB_STATIONS,
    availability,
    context,
    begin,
    performStation,
    update,
    cancel,
    snapshot,
    save,
    restore,
    prewarm,
  });
}

export const createCommunityHub = createCommunityHubSystem;
