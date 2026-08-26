export const LIFE_PROFILE_SAVE_VERSION = 2;

export const LIFE_SKILLS = Object.freeze({
  MECHANICS: "mechanics",
  DRIVING: "driving",
  FITNESS: "fitness",
  PHOTOGRAPHY: "photography",
  COMMUNITY: "community",
  HOSPITALITY: "hospitality",
});

export const LIFE_SKILL_LEVEL_THRESHOLDS = Object.freeze([0, 100, 280, 600, 1_050, 1_650]);

const LEVEL_NAMES = Object.freeze(["NOVICE", "CAPABLE", "SKILLED", "EXPERIENCED", "TRUSTED", "EXPERT"]);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function skill(id, name, wageStep, description) {
  return deepFreeze({ id, name, wageStep, description });
}

export const LIFE_SKILL_DEFINITIONS = Object.freeze([
  skill(LIFE_SKILLS.MECHANICS, "MECHANICS", 0.055, "Diagnosis, safe repair, tools, and vehicle systems."),
  skill(LIFE_SKILLS.DRIVING, "DRIVING", 0.040, "Safe, smooth, lawful work behind the wheel."),
  skill(LIFE_SKILLS.FITNESS, "FITNESS", 0.025, "Stamina, movement, sport, and physical work."),
  skill(LIFE_SKILLS.PHOTOGRAPHY, "PHOTOGRAPHY", 0.035, "Observation, composition, and documentary work."),
  skill(LIFE_SKILLS.COMMUNITY, "COMMUNITY", 0.030, "Reliable service, volunteering, and neighbourhood trust."),
  skill(LIFE_SKILLS.HOSPITALITY, "HOSPITALITY", 0.035, "Listening, food service, care, and working with people."),
]);

const SKILL_DEFINITION_BY_ID = new Map(LIFE_SKILL_DEFINITIONS.map(definition => [definition.id, definition]));

function weight(skillId, amount) {
  if (!SKILL_DEFINITION_BY_ID.has(skillId)) throw new RangeError(`Unknown life skill: ${skillId}`);
  return Object.freeze({ skillId, weight: amount });
}

export const ACTIVITY_SKILL_MAP = deepFreeze({
  garage_apprentice: [weight(LIFE_SKILLS.MECHANICS, 0.85), weight(LIFE_SKILLS.HOSPITALITY, 0.15)],
  pulse_roadside: [weight(LIFE_SKILLS.MECHANICS, 0.75), weight(LIFE_SKILLS.COMMUNITY, 0.25)],
  pulse_parcels: [weight(LIFE_SKILLS.DRIVING, 0.70), weight(LIFE_SKILLS.COMMUNITY, 0.30)],
  pulse_line: [weight(LIFE_SKILLS.DRIVING, 0.65), weight(LIFE_SKILLS.COMMUNITY, 0.35)],
  night_shift_stories: [weight(LIFE_SKILLS.DRIVING, 0.65), weight(LIFE_SKILLS.HOSPITALITY, 0.35)],
  taxi: [weight(LIFE_SKILLS.DRIVING, 0.65), weight(LIFE_SKILLS.HOSPITALITY, 0.35)],
  harbour_loop: [weight(LIFE_SKILLS.DRIVING, 0.90), weight(LIFE_SKILLS.FITNESS, 0.10)],
  city_lens: [weight(LIFE_SKILLS.PHOTOGRAPHY, 0.85), weight(LIFE_SKILLS.COMMUNITY, 0.15)],
  pulse_park_run: [weight(LIFE_SKILLS.FITNESS, 1)],
  harbour_court: [weight(LIFE_SKILLS.FITNESS, 1)],
  neighbourhood_hands: [weight(LIFE_SKILLS.COMMUNITY, 0.75), weight(LIFE_SKILLS.FITNESS, 0.25)],
  common_ground_shift: [weight(LIFE_SKILLS.HOSPITALITY, 0.80), weight(LIFE_SKILLS.COMMUNITY, 0.20)],
  mina_market_shift: [
    weight(LIFE_SKILLS.HOSPITALITY, 28 / 68),
    weight(LIFE_SKILLS.COMMUNITY, 22 / 68),
    weight(LIFE_SKILLS.FITNESS, 18 / 68),
  ],
  home_cooking: [weight(LIFE_SKILLS.HOSPITALITY, 0.70), weight(LIFE_SKILLS.COMMUNITY, 0.30)],
  community_kitchen: [weight(LIFE_SKILLS.HOSPITALITY, 2 / 3), weight(LIFE_SKILLS.COMMUNITY, 1 / 3)],
  repair_cafe: [weight(LIFE_SKILLS.MECHANICS, 0.75), weight(LIFE_SKILLS.COMMUNITY, 0.25)],
  local_archive: [weight(LIFE_SKILLS.PHOTOGRAPHY, 0.65), weight(LIFE_SKILLS.COMMUNITY, 0.35)],
});

function homeAction(id, name, cost, gameMinutes, energy, hygiene, skillId = null, experience = 0) {
  return deepFreeze({ id, name, cost, gameMinutes, energy, hygiene, skillId, experience });
}

export const HOME_CARE_ACTIONS = Object.freeze([
  homeAction("sleep", "SLEEP", 0, 480, 100, -4),
  homeAction("shower", "TAKE A SHOWER", 2, 25, 4, 100),
  homeAction("laundry", "DO THE LAUNDRY", 5, 55, -5, 18, LIFE_SKILLS.COMMUNITY, 8),
  homeAction("tidy_up", "TIDY THE FLAT", 0, 35, -7, 10, LIFE_SKILLS.COMMUNITY, 8),
  homeAction("cook_meal", "COOK A MEAL", 8, 45, 18, -3, LIFE_SKILLS.HOSPITALITY, 12),
]);

const HOME_ACTION_BY_ID = new Map(HOME_CARE_ACTIONS.map(action => [action.id, action]));
const ACTIVITY_IDS = Object.freeze(Object.keys(ACTIVITY_SKILL_MAP));
const SKILL_IDS = Object.freeze(LIFE_SKILL_DEFINITIONS.map(definition => definition.id));
const HOME_ACTION_IDS = Object.freeze(HOME_CARE_ACTIONS.map(action => action.id));
const MAX_SHIFT_HISTORY = 24;
const MAX_RECORDED_SHIFT_IDS = 256;
const MAX_EXPERIENCE_SOURCES = 256;

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

function boundedInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.max(minimum, Math.min(maximum, integer(value, minimum)));
}

function levelForExperience(value) {
  const experience = Math.max(0, integer(value));
  let levelIndex = 0;
  for (let index = 1; index < LIFE_SKILL_LEVEL_THRESHOLDS.length; ++index) {
    if (experience < LIFE_SKILL_LEVEL_THRESHOLDS[index]) break;
    levelIndex = index;
  }
  return levelIndex + 1;
}

function cleanId(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text.slice(0, 96);
}

function statusForEnergy(value) {
  if (value >= 76) return "RESTED";
  if (value >= 44) return "STEADY";
  if (value >= 18) return "TIRED";
  return "EXHAUSTED";
}

function statusForHygiene(value) {
  if (value >= 76) return "FRESH";
  if (value >= 44) return "PRESENTABLE";
  if (value >= 18) return "WORN";
  return "NEEDS CARE";
}

function skillView(definition, experience) {
  const xp = Math.max(0, integer(experience));
  const level = levelForExperience(xp);
  const currentThreshold = LIFE_SKILL_LEVEL_THRESHOLDS[level - 1];
  const nextThreshold = LIFE_SKILL_LEVEL_THRESHOLDS[level] ?? null;
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    experience: xp,
    level,
    levelName: LEVEL_NAMES[level - 1],
    currentLevelExperience: xp - currentThreshold,
    nextLevelExperience: nextThreshold,
    experienceToNextLevel: nextThreshold === null ? 0 : Math.max(0, nextThreshold - xp),
    levelProgress: nextThreshold === null ? 1 : clamp((xp - currentThreshold) / (nextThreshold - currentThreshold), 0, 1),
    wageMultiplier: 1 + (level - 1) * definition.wageStep,
  };
}

function mappedAwards(activityId, totalExperience) {
  const mapping = ACTIVITY_SKILL_MAP[activityId];
  const total = Math.max(0, integer(totalExperience));
  if (!mapping || !total) return [];
  const draft = mapping.map((entry, index) => {
    const exact = total * entry.weight;
    return { skillId: entry.skillId, experience: Math.floor(exact), fraction: exact - Math.floor(exact), index };
  });
  let remaining = total - draft.reduce((sum, entry) => sum + entry.experience, 0);
  const priority = [...draft].sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remaining > 0; ++index, --remaining) priority[index % priority.length].experience += 1;
  return draft.map(({ skillId, experience }) => ({ skillId, experience }));
}

function sanitizedAwards(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const awards = [];
  for (const item of value) {
    const skillId = cleanId(item?.skillId);
    if (!SKILL_DEFINITION_BY_ID.has(skillId) || seen.has(skillId)) continue;
    seen.add(skillId);
    awards.push({ skillId, experience: boundedInteger(item?.experience) });
  }
  return awards;
}

function sanitizedShift(value, fallbackSerial = 0) {
  const id = cleanId(value?.id ?? value?.shiftId);
  if (!id) return null;
  const activityId = cleanId(value?.activityId);
  return {
    id,
    serial: boundedInteger(value?.serial, 1),
    activityId,
    dayIndex: boundedInteger(value?.dayIndex),
    durationMinutes: clamp(value?.durationMinutes, 0, 24 * 60),
    quality: clamp(value?.quality, 0, 1),
    baseWage: boundedInteger(value?.baseWage),
    wageMultiplier: clamp(value?.wageMultiplier, 0.5, 4),
    qualityMultiplier: clamp(value?.qualityMultiplier, 0.5, 1.5),
    wage: boundedInteger(value?.wage),
    experience: boundedInteger(value?.experience),
    awards: sanitizedAwards(value?.awards),
    completedAt: Math.max(0, finite(value?.completedAt, fallbackSerial)),
  };
}

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function skillWeightsForActivity(activityId) {
  return ACTIVITY_SKILL_MAP[cleanId(activityId)] ?? Object.freeze([]);
}

export function createLifeProfile({ initialEnergy = 84, initialHygiene = 78 } = {}) {
  const experienceBySkill = Object.fromEntries(SKILL_IDS.map(id => [id, 0]));
  const activityCounts = Object.fromEntries(ACTIVITY_IDS.map(id => [id, 0]));
  const homeCareCounts = Object.fromEntries(HOME_ACTION_IDS.map(id => [id, 0]));
  const lastHomeCareExperienceDay = Object.fromEntries(HOME_ACTION_IDS.map(id => [id, -1]));
  let elapsed = 0;
  let energy = clamp(initialEnergy, 0, 100);
  let hygiene = clamp(initialHygiene, 0, 100);
  let shiftSerial = 0;
  let homeCareSerial = 0;
  let experienceSerial = 0;
  let lastEvent = null;
  let lastHomeCare = null;
  const shiftHistory = [];
  const recordedShiftIds = new Set();
  const experienceSources = new Set();

  function trimSet(set, maximum) {
    while (set.size > maximum) set.delete(set.values().next().value);
  }

  function skillState(skillId) {
    const id = cleanId(skillId);
    const definition = SKILL_DEFINITION_BY_ID.get(id);
    if (!definition) throw new RangeError(`Unknown life skill: ${skillId}`);
    return deepFreeze(skillView(definition, experienceBySkill[id]));
  }

  function wageMultiplier(activityId) {
    const mapping = ACTIVITY_SKILL_MAP[cleanId(activityId)];
    if (!mapping) return 1;
    const value = mapping.reduce((total, entry) => {
      const definition = SKILL_DEFINITION_BY_ID.get(entry.skillId);
      const level = levelForExperience(experienceBySkill[entry.skillId]);
      return total + entry.weight * (1 + (level - 1) * definition.wageStep);
    }, 0);
    return Math.round(value * 10_000) / 10_000;
  }

  function staminaRecoveryMultiplier() {
    return 0.80 + energy * 0.002;
  }

  // Physical household simulations own the fixture, pantry, time and cost
  // transaction. This narrow bridge lets their already-clamped result change
  // Kai's persistent needs without duplicating those household rules here.
  function applyNeedEffects(value = {}) {
    const previousEnergy = energy;
    const previousHygiene = hygiene;
    energy = clamp(energy + finite(value.energy), 0, 100);
    hygiene = clamp(hygiene + finite(value.hygiene), 0, 100);
    lastEvent = "needs_adjusted";
    return deepFreeze({
      accepted: true,
      energy: energy - previousEnergy,
      hygiene: hygiene - previousHygiene,
      needs: {
        energy,
        energyStatus: statusForEnergy(energy),
        hygiene,
        hygieneStatus: statusForHygiene(hygiene),
      },
    });
  }

  function quoteWage(activityIdValue, baseWageValue, qualityValue = 0.75) {
    const activityId = cleanId(activityIdValue);
    const baseWage = boundedInteger(baseWageValue);
    const quality = clamp(qualityValue, 0, 1);
    const skillMultiplier = wageMultiplier(activityId);
    // A completed shift always receives at least 90% of the quoted base. Skill
    // and careful work add modest bonuses without turning speed into the wage.
    const qualityMultiplier = 0.9 + quality * 0.2;
    return deepFreeze({
      activityId,
      baseWage,
      quality,
      wageMultiplier: skillMultiplier,
      qualityMultiplier,
      wage: Math.max(0, Math.round(baseWage * skillMultiplier * qualityMultiplier)),
    });
  }

  function addAwards(awards) {
    for (const award of awards) experienceBySkill[award.skillId] += award.experience;
  }

  function awardExperience(skillIdValue, amountValue, { sourceId = null, activityId = null } = {}) {
    const skillId = cleanId(skillIdValue);
    if (!SKILL_DEFINITION_BY_ID.has(skillId)) throw new RangeError(`Unknown life skill: ${skillIdValue}`);
    const amount = boundedInteger(amountValue);
    const source = sourceId === null || sourceId === undefined ? null : cleanId(sourceId);
    if (source && experienceSources.has(source)) {
      return deepFreeze({ accepted: false, reason: "duplicate_source", sourceId: source, skillId, experience: 0 });
    }
    if (amount <= 0) return deepFreeze({ accepted: false, reason: "no_experience", sourceId: source, skillId, experience: 0 });
    if (source) {
      experienceSources.add(source);
      trimSet(experienceSources, MAX_EXPERIENCE_SOURCES);
    }
    experienceBySkill[skillId] += amount;
    experienceSerial += 1;
    if (activityId && Object.hasOwn(activityCounts, activityId)) activityCounts[activityId] += 1;
    lastEvent = "experience_awarded";
    return deepFreeze({
      accepted: true,
      reason: null,
      serial: experienceSerial,
      sourceId: source,
      skillId,
      experience: amount,
      skill: skillState(skillId),
    });
  }

  function awardActivityExperience(activityIdValue, amountValue, { sourceId = null, countActivity = true } = {}) {
    const activityId = cleanId(activityIdValue);
    const mapping = ACTIVITY_SKILL_MAP[activityId];
    if (!mapping) return deepFreeze({ accepted: false, reason: "unmapped_activity", activityId, experience: 0, awards: [] });
    const amount = boundedInteger(amountValue);
    const source = sourceId === null || sourceId === undefined ? null : cleanId(sourceId);
    if (source && experienceSources.has(source)) {
      return deepFreeze({ accepted: false, reason: "duplicate_source", activityId, sourceId: source, experience: 0, awards: [] });
    }
    if (amount <= 0) return deepFreeze({ accepted: false, reason: "no_experience", activityId, sourceId: source, experience: 0, awards: [] });
    const awards = mappedAwards(activityId, amount);
    if (source) {
      experienceSources.add(source);
      trimSet(experienceSources, MAX_EXPERIENCE_SOURCES);
    }
    addAwards(awards);
    if (countActivity) activityCounts[activityId] += 1;
    experienceSerial += 1;
    lastEvent = "activity_experience_awarded";
    return deepFreeze({
      accepted: true,
      reason: null,
      serial: experienceSerial,
      activityId,
      sourceId: source,
      experience: amount,
      awards: awards.map(award => ({ ...award, level: levelForExperience(experienceBySkill[award.skillId]) })),
    });
  }

  function recordShift(request = {}) {
    const id = cleanId(request.id ?? request.shiftId);
    if (!id) return deepFreeze({ accepted: false, reason: "shift_id_required", wage: 0, experience: 0 });
    if (recordedShiftIds.has(id)) return deepFreeze({ accepted: false, reason: "duplicate_shift", id, wage: 0, experience: 0 });
    const activityId = cleanId(request.activityId ?? "garage_apprentice");
    if (!ACTIVITY_SKILL_MAP[activityId]) {
      return deepFreeze({ accepted: false, reason: "unmapped_activity", id, activityId, wage: 0, experience: 0 });
    }
    const durationMinutes = clamp(request.durationMinutes, 0, 24 * 60);
    const quality = clamp(request.quality, 0, 1);
    const experience = request.experience === undefined
      ? Math.round(24 + Math.min(48, durationMinutes * 0.2) + quality * 28)
      : boundedInteger(request.experience);
    const quotedWage = quoteWage(activityId, request.baseWage, quality);
    const exactWage = request.exactWage === undefined ? null : boundedInteger(request.exactWage);
    const quote = exactWage === null ? quotedWage : {
      ...quotedWage,
      baseWage: exactWage,
      wageMultiplier: 1,
      qualityMultiplier: 1,
      wage: exactWage,
    };
    const awards = mappedAwards(activityId, experience);
    addAwards(awards);
    activityCounts[activityId] += 1;
    experienceSerial += 1;
    shiftSerial += 1;
    const entry = {
      id,
      serial: shiftSerial,
      activityId,
      dayIndex: boundedInteger(request.dayIndex),
      durationMinutes,
      quality,
      baseWage: quote.baseWage,
      wageMultiplier: quote.wageMultiplier,
      qualityMultiplier: quote.qualityMultiplier,
      wage: quote.wage,
      experience,
      awards: awards.map(award => ({ ...award })),
      completedAt: elapsed,
    };
    shiftHistory.push(entry);
    if (shiftHistory.length > MAX_SHIFT_HISTORY) shiftHistory.splice(0, shiftHistory.length - MAX_SHIFT_HISTORY);
    recordedShiftIds.add(id);
    trimSet(recordedShiftIds, MAX_RECORDED_SHIFT_IDS);
    experienceSources.add(`shift:${id}`);
    trimSet(experienceSources, MAX_EXPERIENCE_SOURCES);
    lastEvent = "shift_recorded";
    return deepFreeze({ accepted: true, reason: null, ...entry });
  }

  function performHomeCare(actionIdValue, context = {}) {
    const actionId = cleanId(actionIdValue);
    const action = HOME_ACTION_BY_ID.get(actionId);
    if (!action) throw new RangeError(`Unknown home-care action: ${actionIdValue}`);
    if (!context.atHome) return deepFreeze({ accepted: false, reason: "home_required", actionId, cost: 0 });
    if (context.busy) return deepFreeze({ accepted: false, reason: "busy", actionId, cost: 0 });
    const cash = Math.max(0, finite(context.cash));
    if (cash + 1e-9 < action.cost) {
      return deepFreeze({ accepted: false, reason: "insufficient_cash", actionId, cost: action.cost });
    }
    const sourceId = context.sourceId === undefined || context.sourceId === null ? null : cleanId(context.sourceId);
    if (sourceId && experienceSources.has(`home:${sourceId}`)) {
      return deepFreeze({ accepted: false, reason: "duplicate_source", actionId, cost: 0, sourceId });
    }
    const previousEnergy = energy;
    const previousHygiene = hygiene;
    energy = clamp(energy + action.energy, 0, 100);
    hygiene = clamp(hygiene + action.hygiene, 0, 100);
    const dayIndex = boundedInteger(context.dayIndex);
    let experience = 0;
    if (action.skillId && lastHomeCareExperienceDay[actionId] !== dayIndex) {
      experience = action.experience;
      experienceBySkill[action.skillId] += experience;
      lastHomeCareExperienceDay[actionId] = dayIndex;
      experienceSerial += 1;
    }
    if (sourceId) {
      experienceSources.add(`home:${sourceId}`);
      trimSet(experienceSources, MAX_EXPERIENCE_SOURCES);
    }
    homeCareCounts[actionId] += 1;
    homeCareSerial += 1;
    lastEvent = "home_care_completed";
    lastHomeCare = {
      serial: homeCareSerial,
      actionId,
      dayIndex,
      cost: action.cost,
      gameMinutes: action.gameMinutes,
      energy: energy - previousEnergy,
      hygiene: hygiene - previousHygiene,
      experience,
      skillId: action.skillId,
    };
    return deepFreeze({ accepted: true, reason: null, sourceId, ...lastHomeCare });
  }

  function update(deltaValue, context = {}) {
    const delta = clamp(deltaValue, 0, 1);
    elapsed += delta;
    if (!context.paused) {
      const energyRate = context.working ? 0.010 : context.sprinting ? 0.014 : 0.0035;
      const hygieneRate = context.working ? 0.006 : context.sprinting ? 0.005 : 0.0022;
      energy = clamp(energy - delta * energyRate, 0, 100);
      hygiene = clamp(hygiene - delta * hygieneRate, 0, 100);
    }
    return context.captureSnapshot === false ? null : snapshot();
  }

  function reset() {
    elapsed = 0;
    energy = clamp(initialEnergy, 0, 100);
    hygiene = clamp(initialHygiene, 0, 100);
    for (const id of SKILL_IDS) experienceBySkill[id] = 0;
    for (const id of ACTIVITY_IDS) activityCounts[id] = 0;
    for (const id of HOME_ACTION_IDS) {
      homeCareCounts[id] = 0;
      lastHomeCareExperienceDay[id] = -1;
    }
    shiftSerial = 0;
    homeCareSerial = 0;
    experienceSerial = 0;
    lastEvent = "profile_reset";
    lastHomeCare = null;
    shiftHistory.length = 0;
    recordedShiftIds.clear();
    experienceSources.clear();
    return snapshot();
  }

  function save() {
    return {
      version: LIFE_PROFILE_SAVE_VERSION,
      elapsed,
      needs: { energy, hygiene },
      skills: Object.fromEntries(SKILL_IDS.map(id => [id, experienceBySkill[id]])),
      activityCounts: { ...activityCounts },
      shiftSerial,
      shiftHistory: shiftHistory.map(entry => ({ ...entry, awards: entry.awards.map(award => ({ ...award })) })),
      recordedShiftIds: [...recordedShiftIds],
      experienceSerial,
      experienceSources: [...experienceSources],
      homeCareSerial,
      homeCareCounts: { ...homeCareCounts },
      lastHomeCareExperienceDay: { ...lastHomeCareExperienceDay },
      lastHomeCare: lastHomeCare ? { ...lastHomeCare } : null,
      lastEvent,
    };
  }

  function restore(value = {}) {
    const source = plainRecord(value);
    const version = integer(source.version);
    if (version !== 1 && version !== LIFE_PROFILE_SAVE_VERSION) {
      throw new RangeError(`Unsupported life profile save version: ${source.version}`);
    }
    elapsed = Math.max(0, finite(source.elapsed));
    const needs = plainRecord(source.needs);
    energy = clamp(needs.energy ?? source.energy ?? initialEnergy, 0, 100);
    hygiene = clamp(needs.hygiene ?? source.hygiene ?? initialHygiene, 0, 100);
    const skills = plainRecord(source.skills ?? source.experience);
    for (const id of SKILL_IDS) {
      const candidate = plainRecord(skills[id]).experience ?? skills[id];
      experienceBySkill[id] = boundedInteger(candidate);
    }
    const savedCounts = plainRecord(source.activityCounts ?? source.activities);
    for (const id of ACTIVITY_IDS) activityCounts[id] = boundedInteger(savedCounts[id]);

    shiftSerial = boundedInteger(source.shiftSerial);
    shiftHistory.length = 0;
    const shifts = Array.isArray(source.shiftHistory) ? source.shiftHistory : Array.isArray(source.shifts) ? source.shifts : [];
    const seenHistoryIds = new Set();
    for (const candidate of shifts.slice(-MAX_SHIFT_HISTORY)) {
      const entry = sanitizedShift(candidate, elapsed);
      if (!entry || seenHistoryIds.has(entry.id)) continue;
      seenHistoryIds.add(entry.id);
      shiftHistory.push(entry);
      shiftSerial = Math.max(shiftSerial, entry.serial);
    }
    recordedShiftIds.clear();
    const savedShiftIds = version >= 2 && Array.isArray(source.recordedShiftIds)
      ? source.recordedShiftIds
      : shiftHistory.map(entry => entry.id);
    for (const candidate of savedShiftIds.slice(-MAX_RECORDED_SHIFT_IDS)) {
      const id = cleanId(candidate);
      if (id) recordedShiftIds.add(id);
    }

    experienceSerial = boundedInteger(source.experienceSerial);
    experienceSources.clear();
    if (version >= 2 && Array.isArray(source.experienceSources)) {
      for (const candidate of source.experienceSources.slice(-MAX_EXPERIENCE_SOURCES)) {
        const id = cleanId(candidate);
        if (id) experienceSources.add(id);
      }
    } else {
      for (const id of recordedShiftIds) experienceSources.add(`shift:${id}`);
    }
    homeCareSerial = boundedInteger(source.homeCareSerial);
    const careCounts = plainRecord(source.homeCareCounts);
    const careDays = plainRecord(source.lastHomeCareExperienceDay);
    for (const id of HOME_ACTION_IDS) {
      homeCareCounts[id] = boundedInteger(careCounts[id]);
      lastHomeCareExperienceDay[id] = Math.max(-1, integer(careDays[id], -1));
    }
    const care = source.lastHomeCare;
    if (care && HOME_ACTION_BY_ID.has(cleanId(care.actionId))) {
      lastHomeCare = {
        serial: boundedInteger(care.serial),
        actionId: cleanId(care.actionId),
        dayIndex: boundedInteger(care.dayIndex),
        cost: boundedInteger(care.cost),
        gameMinutes: clamp(care.gameMinutes, 0, 24 * 60),
        energy: clamp(care.energy, -100, 100),
        hygiene: clamp(care.hygiene, -100, 100),
        experience: boundedInteger(care.experience),
        skillId: SKILL_DEFINITION_BY_ID.has(cleanId(care.skillId)) ? cleanId(care.skillId) : null,
      };
      homeCareSerial = Math.max(homeCareSerial, lastHomeCare.serial);
    } else lastHomeCare = null;
    lastEvent = source.lastEvent === null || source.lastEvent === undefined ? null : cleanId(source.lastEvent);
    return snapshot();
  }

  function snapshot() {
    const skills = LIFE_SKILL_DEFINITIONS.map(definition => skillView(definition, experienceBySkill[definition.id]));
    const skillById = Object.fromEntries(skills.map(value => [value.id, { ...value }]));
    return deepFreeze({
      version: LIFE_PROFILE_SAVE_VERSION,
      elapsed,
      needs: {
        energy,
        energyStatus: statusForEnergy(energy),
        hygiene,
        hygieneStatus: statusForHygiene(hygiene),
        staminaRecoveryMultiplier: 0.80 + energy * 0.002,
        socialComfortMultiplier: 0.90 + hygiene * 0.001,
        safe: true,
      },
      skills,
      skillById,
      activityCounts: { ...activityCounts },
      shiftSerial,
      shiftsCompleted: shiftSerial,
      shiftHistory: shiftHistory.map(entry => ({ ...entry, awards: entry.awards.map(award => ({ ...award })) })),
      wageMultipliers: Object.fromEntries(ACTIVITY_IDS.map(id => [id, wageMultiplier(id)])),
      homeCareSerial,
      homeCareCounts: { ...homeCareCounts },
      lastHomeCare: lastHomeCare ? { ...lastHomeCare } : null,
      lastEvent,
    });
  }

  function prewarm() {
    const before = JSON.stringify(save());
    let activitiesPrepared = 0;
    let awardsPrepared = 0;
    let homeActionsPrepared = 0;
    let shiftsPrepared = 0;
    for (const [index, activityId] of ACTIVITY_IDS.entries()) {
      const simulation = createLifeProfile({ initialEnergy, initialHygiene });
      const awarded = simulation.awardActivityExperience(activityId, 61 + index, { sourceId: `prewarm-activity-${index}` });
      if (!awarded.accepted) throw new Error(`Life profile prewarm could not award ${activityId}`);
      activitiesPrepared += 1;
      awardsPrepared += awarded.awards.length;
      const shift = simulation.recordShift({
        id: `prewarm-shift-${index}`,
        activityId,
        dayIndex: index,
        durationMinutes: 90,
        quality: 0.82,
        baseWage: 180,
      });
      if (!shift.accepted || simulation.recordShift({ ...shift }).reason !== "duplicate_shift") {
        throw new Error(`Life profile prewarm shift transaction failed for ${activityId}`);
      }
      shiftsPrepared += 1;
      const copy = createLifeProfile();
      copy.restore(JSON.parse(JSON.stringify(simulation.save())));
      if (JSON.stringify(copy.save()) !== JSON.stringify(simulation.save())) {
        throw new Error(`Life profile prewarm restore diverged for ${activityId}`);
      }
    }
    for (const [index, action] of HOME_CARE_ACTIONS.entries()) {
      const simulation = createLifeProfile({ initialEnergy: 15, initialHygiene: 12 });
      const result = simulation.performHomeCare(action.id, {
        atHome: true,
        cash: 9_999,
        dayIndex: index,
        sourceId: `prewarm-home-${index}`,
      });
      if (!result.accepted) throw new Error(`Life profile prewarm could not perform ${action.id}`);
      homeActionsPrepared += 1;
    }
    const liveStatePreserved = JSON.stringify(save()) === before;
    if (!liveStatePreserved) throw new Error("Life profile prewarm mutated live state");
    return deepFreeze({
      ready: activitiesPrepared === ACTIVITY_IDS.length && homeActionsPrepared === HOME_CARE_ACTIONS.length,
      storage: "memory-only",
      rendererResources: 0,
      diskResources: 0,
      activitiesPrepared,
      awardsPrepared,
      shiftsPrepared,
      homeActionsPrepared,
      saveRestorePrepared: activitiesPrepared,
      liveStatePreserved,
    });
  }

  return Object.freeze({
    update,
    reset,
    skill: skillState,
    wageMultiplier,
    staminaRecoveryMultiplier,
    quoteWage,
    applyNeedEffects,
    awardExperience,
    awardActivityExperience,
    recordShift,
    performHomeCare,
    save,
    restore,
    snapshot,
    prewarm,
  });
}

export const LIFE_PROFILE_LIMITS = Object.freeze({
  maxShiftHistory: MAX_SHIFT_HISTORY,
  maxRecordedShiftIds: MAX_RECORDED_SHIFT_IDS,
  maxExperienceSources: MAX_EXPERIENCE_SOURCES,
});
