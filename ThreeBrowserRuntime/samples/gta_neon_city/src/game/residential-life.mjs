export const RESIDENTIAL_LIFE_SAVE_VERSION = 3;

export const RESIDENTIAL_SKILLS = Object.freeze({
  MECHANICS: "mechanics",
  DRIVING: "driving",
  FITNESS: "fitness",
  PHOTOGRAPHY: "photography",
  COMMUNITY: "community",
  HOSPITALITY: "hospitality",
});

const SKILL_IDS = Object.freeze(Object.values(RESIDENTIAL_SKILLS));
const SKILL_ID_SET = new Set(SKILL_IDS);
const MINUTES_PER_DAY = 24 * 60;
const DAYS_PER_RENT_PERIOD = 7;

export const RESIDENTIAL_LIMITS = Object.freeze({
  maxLedgerEntries: 256,
  maxOwnedHomes: 3,
  maxRelationshipMagnitude: 100,
  maxGroceries: 12,
  maxPreparedMeals: 8,
  maxCarriedGroceries: 10,
});

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

function boundedInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.max(minimum, Math.min(maximum, integer(value, minimum)));
}

function cleanId(value, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 96);
}

function uint32(value, fallback = 0x51f15e) {
  const number = finite(value, fallback);
  return Math.trunc(number) >>> 0;
}

function normalizeMinute(value) {
  const minute = integer(value);
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function minuteFromContext(context, fallback) {
  if (context?.minuteOfDay != null) return normalizeMinute(context.minuteOfDay);
  if (context?.timeMinutes != null) return normalizeMinute(context.timeMinutes);
  if (context?.timeHours != null) return normalizeMinute(finite(context.timeHours) * 60);
  if (context?.hours != null) return normalizeMinute(finite(context.hours) * 60);
  return fallback;
}

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hashText(seed, value) {
  let hash = (uint32(seed) ^ 0x811c9dc5) >>> 0;
  const text = String(value);
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function fixture(id, name, kind, roomId, { condition = 96, cleanliness = 88 } = {}) {
  return deepFreeze({ id, name, kind, roomId, condition, cleanliness });
}

function room(id, name, fixtures) {
  return deepFreeze({ id, name, fixtures });
}

function market(unlockTier, deposit, dailyRent, purchasePrice) {
  return deepFreeze({ available: true, unlockTier, deposit, dailyRent, purchasePrice });
}

function occupiedMarket() {
  return deepFreeze({ available: false, unlockTier: 99, deposit: 0, dailyRent: 0, purchasePrice: 0 });
}

function home(id, name, address, buildingId, marketTerms, rooms) {
  return deepFreeze({ id, name, address, buildingId, market: marketTerms, rooms });
}

function compactStudioRooms(prefix = "") {
  const key = value => `${prefix}${value}`;
  return [
    room(key("living"), "LIVING ROOM", [
      fixture(key("bed"), "BED", "bed", key("living")),
      fixture(key("sofa"), "SOFA", "sofa", key("living")),
      fixture(key("desk"), "STUDY DESK", "desk", key("living")),
    ]),
    room(key("kitchen"), "KITCHEN", [
      fixture(key("stove"), "STOVE", "stove", key("kitchen")),
      fixture(key("table"), "DINING TABLE", "table", key("kitchen")),
      fixture(key("sink"), "KITCHEN SINK", "sink", key("kitchen")),
    ]),
    room(key("bathroom"), "BATHROOM", [
      fixture(key("shower"), "SHOWER", "shower", key("bathroom")),
    ]),
  ];
}

function fullApartmentRooms(prefix = "") {
  const key = value => `${prefix}${value}`;
  return [
    room(key("bedroom"), "BEDROOM", [fixture(key("bed"), "BED", "bed", key("bedroom"))]),
    room(key("living"), "LIVING ROOM", [
      fixture(key("sofa"), "SOFA", "sofa", key("living")),
      fixture(key("desk"), "STUDY DESK", "desk", key("living")),
    ]),
    room(key("kitchen"), "KITCHEN", [
      fixture(key("stove"), "STOVE", "stove", key("kitchen")),
      fixture(key("table"), "DINING TABLE", "table", key("kitchen")),
      fixture(key("sink"), "KITCHEN SINK", "sink", key("kitchen")),
    ]),
    room(key("bathroom"), "BATHROOM", [fixture(key("shower"), "SHOWER", "shower", key("bathroom"))]),
  ];
}

/**
 * Authored units share building identifiers with the world without importing any
 * world or renderer code. The first three are player-market homes. The final
 * three keep named residents anchored to real addresses even when off-screen.
 */
export const DEFAULT_RESIDENTIAL_HOMES = deepFreeze([
  home(
    "southline_studio_3b",
    "SOUTHLINE STUDIO 3B",
    "18 Calder Street, Apt 3B",
    "southline_court",
    market(0, 420, 42, 18_500),
    compactStudioRooms(),
  ),
  home(
    "riverside_flat_6a",
    "RIVERSIDE FLAT 6A",
    "61 River Walk, Apt 6A",
    "riverside_house",
    market(1, 1_150, 78, 36_000),
    fullApartmentRooms(),
  ),
  home(
    "harbour_loft_9c",
    "HARBOUR LOFT 9C",
    "9 Lantern Quay, Loft 9C",
    "lantern_quay",
    market(2, 2_600, 132, 72_000),
    fullApartmentRooms("loft_"),
  ),
  home(
    "amara_home_4d",
    "AMARA'S FLAT",
    "22 Cypress Avenue, Apt 4D",
    "cypress_house",
    occupiedMarket(),
    compactStudioRooms("amara_"),
  ),
  home(
    "luis_home_2a",
    "LUIS'S FLAT",
    "7 Foundry Lane, Apt 2A",
    "foundry_house",
    occupiedMarket(),
    compactStudioRooms("luis_"),
  ),
  home(
    "nia_home_5f",
    "NIA'S FLAT",
    "84 Market Street, Apt 5F",
    "market_house",
    occupiedMarket(),
    compactStudioRooms("nia_"),
  ),
]);

function segment(activity, startMinute, endMinute, locationId) {
  return deepFreeze({ activity, startMinute, endMinute, locationId });
}

function resident(id, name, role, homeId, workplaceId, workDays, schedule, leisureLocations, initialBond) {
  return deepFreeze({
    id,
    name,
    role,
    homeId,
    workplaceId,
    workDays,
    schedule,
    leisureLocations,
    initialBond,
  });
}

export const DEFAULT_RESIDENTIAL_RESIDENTS = deepFreeze([
  resident(
    "amara_chen",
    "AMARA CHEN",
    "PARAMEDIC",
    "amara_home_4d",
    "mercy_clinic",
    [0, 1, 2, 3, 4],
    [
      segment("work", 0, 120, "mercy_clinic"),
      segment("leisure", 120, 300, "cypress_night_garden"),
      segment("home", 300, 540, "amara_home_4d"),
      segment("sleep", 540, 900, "amara_home_4d"),
      segment("home", 900, 1080, "amara_home_4d"),
      segment("work", 1080, 1440, "mercy_clinic"),
    ],
    ["cypress_night_garden", "harbour_lantern"],
    14,
  ),
  resident(
    "luis_moreno",
    "LUIS MORENO",
    "VEHICLE TECHNICIAN",
    "luis_home_2a",
    "pulse_garage",
    [0, 1, 2, 3, 4],
    [
      segment("sleep", 0, 390, "luis_home_2a"),
      segment("home", 390, 450, "luis_home_2a"),
      segment("work", 450, 990, "pulse_garage"),
      segment("leisure", 990, 1230, "southline_diner"),
      segment("home", 1230, 1440, "luis_home_2a"),
    ],
    ["southline_diner", "harbour_court"],
    10,
  ),
  resident(
    "nia_okafor",
    "NIA OKAFOR",
    "FREELANCE PHOTOGRAPHER",
    "nia_home_5f",
    "city_lens_studio",
    [1, 2, 3, 4, 5],
    [
      segment("sleep", 0, 480, "nia_home_5f"),
      segment("home", 480, 600, "nia_home_5f"),
      segment("work", 600, 1020, "city_lens_studio"),
      segment("leisure", 1020, 1260, "market_square"),
      segment("home", 1260, 1440, "nia_home_5f"),
    ],
    ["market_square", "common_ground_cafe", "river_walk"],
    8,
  ),
]);

function skillAward(skillId, experience) {
  return deepFreeze({ skillId, experience });
}

function activity(id, name, fixtureKind, gameMinutes, energy, hygiene, appetite, cost, skillAwards, fixtureWear, fixtureSoil) {
  return deepFreeze({
    id,
    name,
    fixtureKind,
    gameMinutes,
    energy,
    hygiene,
    appetite,
    cost,
    skillAwards,
    fixtureWear,
    fixtureSoil,
  });
}

export const RESIDENTIAL_HOME_ACTIONS = deepFreeze([
  activity("sleep", "SLEEP", "bed", 480, 76, -4, 0, 0, [], 0.035, 0.08),
  activity("shower", "TAKE A SHOWER", "shower", 25, 4, 68, 0, 2, [], 0.08, 0.16),
  activity("cook", "COOK A MEAL", "stove", 45, 12, -3, 0, 0, [skillAward("hospitality", 12)], 0.12, 0.26),
  activity("eat", "EAT AT HOME", "table", 25, 28, -1, 34, 0, [skillAward("hospitality", 2)], 0.02, 0.12),
  activity("clean", "CLEAN A ROOM", "sink", 40, -8, 18, 0, 1, [skillAward("community", 8), skillAward("fitness", 4)], 0.06, -18),
  activity("study", "STUDY", "desk", 75, -9, -2, 0, 0, [], 0.025, 0.05),
  activity("relax", "RELAX AT HOME", "sofa", 60, 18, -1, 0, 0, [skillAward("community", 3)], 0.015, 0.04),
]);

const ACTION_BY_ID = new Map(RESIDENTIAL_HOME_ACTIONS.map(value => [value.id, value]));
const ACTION_IDS = Object.freeze(RESIDENTIAL_HOME_ACTIONS.map(value => value.id));
const INTERACTION_BOND = Object.freeze({ talk: 2, help: 8, shared_meal: 6, gift: 4, apologize: 5, conflict: -10 });

function sanitizeDefinitions(homesValue, residentsValue) {
  const homes = Array.isArray(homesValue) && homesValue.length ? homesValue : DEFAULT_RESIDENTIAL_HOMES;
  const residents = Array.isArray(residentsValue) && residentsValue.length ? residentsValue : DEFAULT_RESIDENTIAL_RESIDENTS;
  const homeIds = new Set();
  const fixedHomes = homes.map((sourceHome, homeIndex) => {
    const id = cleanId(sourceHome?.id, `home_${homeIndex}`);
    if (!id || homeIds.has(id)) throw new RangeError(`Duplicate residential home id: ${id}`);
    homeIds.add(id);
    const fixtureIds = new Set();
    const rooms = Array.from(sourceHome?.rooms ?? []).map((sourceRoom, roomIndex) => {
      const roomId = cleanId(sourceRoom?.id, `${id}_room_${roomIndex}`);
      const fixtures = Array.from(sourceRoom?.fixtures ?? []).map((sourceFixture, fixtureIndex) => {
        const fixtureId = cleanId(sourceFixture?.id, `${roomId}_fixture_${fixtureIndex}`);
        if (fixtureIds.has(fixtureId)) throw new RangeError(`Duplicate fixture id ${fixtureId} in ${id}`);
        fixtureIds.add(fixtureId);
        return fixture(
          fixtureId,
          String(sourceFixture?.name ?? fixtureId).toUpperCase(),
          cleanId(sourceFixture?.kind, "utility"),
          roomId,
          {
            condition: clamp(sourceFixture?.condition ?? 96, 0, 100),
            cleanliness: clamp(sourceFixture?.cleanliness ?? 88, 0, 100),
          },
        );
      });
      return room(roomId, String(sourceRoom?.name ?? roomId).toUpperCase(), fixtures);
    });
    const terms = sourceHome?.market ?? occupiedMarket();
    return home(
      id,
      String(sourceHome?.name ?? id).toUpperCase(),
      String(sourceHome?.address ?? "UNLISTED ADDRESS"),
      cleanId(sourceHome?.buildingId, id),
      terms?.available
        ? market(
          boundedInteger(terms.unlockTier, 0, 20),
          boundedInteger(terms.deposit),
          boundedInteger(terms.dailyRent),
          boundedInteger(terms.purchasePrice),
        )
        : occupiedMarket(),
      rooms,
    );
  });

  const residentIds = new Set();
  const fixedResidents = residents.map((sourceResident, residentIndex) => {
    const id = cleanId(sourceResident?.id, `resident_${residentIndex}`);
    if (!id || residentIds.has(id)) throw new RangeError(`Duplicate residential resident id: ${id}`);
    residentIds.add(id);
    const homeId = cleanId(sourceResident?.homeId);
    if (!homeIds.has(homeId)) throw new RangeError(`Resident ${id} references unknown home ${homeId}`);
    const schedule = Array.from(sourceResident?.schedule ?? []).map(sourceSegment => segment(
      ["home", "work", "leisure", "sleep"].includes(sourceSegment?.activity) ? sourceSegment.activity : "home",
      clamp(sourceSegment?.startMinute, 0, MINUTES_PER_DAY),
      clamp(sourceSegment?.endMinute, 0, MINUTES_PER_DAY),
      cleanId(sourceSegment?.locationId, homeId),
    ));
    if (!schedule.length) throw new RangeError(`Resident ${id} requires a daily schedule`);
    return resident(
      id,
      String(sourceResident?.name ?? id).toUpperCase(),
      String(sourceResident?.role ?? "RESIDENT").toUpperCase(),
      homeId,
      cleanId(sourceResident?.workplaceId, homeId),
      Array.from(sourceResident?.workDays ?? [0, 1, 2, 3, 4]).map(value => boundedInteger(value, 0, 6)),
      schedule,
      Array.from(sourceResident?.leisureLocations ?? [homeId]).map(value => cleanId(value, homeId)),
      clamp(sourceResident?.initialBond, -100, 100),
    );
  });
  return { homes: Object.freeze(fixedHomes), residents: Object.freeze(fixedResidents) };
}

function rejected(reason, extra = {}) {
  return deepFreeze({ accepted: false, reason, ...extra });
}

/**
 * Renderer-independent residential simulation. It owns housing, fixture,
 * household and relationship persistence. Cash and player skill/need values
 * remain caller-owned: successful transactions return exact effects to apply.
 */
export function createResidentialLife({
  homes: suppliedHomes = DEFAULT_RESIDENTIAL_HOMES,
  residents: suppliedResidents = DEFAULT_RESIDENTIAL_RESIDENTS,
  seed = 0x51f15e,
  initialHomeId = "southline_studio_3b",
  initialTenure = "rented",
  initialDayIndex = 0,
  initialMinuteOfDay = 8 * 60,
} = {}) {
  const configured = sanitizeDefinitions(suppliedHomes, suppliedResidents);
  const homes = configured.homes;
  const residents = configured.residents;
  const homeIndexById = new Map(homes.map((value, index) => [value.id, index]));
  const residentIndexById = new Map(residents.map((value, index) => [value.id, index]));
  const actionIndexById = new Map(ACTION_IDS.map((value, index) => [value, index]));
  let runtimeSeed = uint32(seed);
  let dayIndex = boundedInteger(initialDayIndex);
  let minuteOfDay = normalizeMinute(initialMinuteOfDay);
  let previousMinuteOfDay = minuteOfDay;
  let currentHomeIndex = homeIndexById.get(cleanId(initialHomeId)) ?? -1;
  let tenure = currentHomeIndex >= 0 && ["rented", "owned"].includes(initialTenure) ? initialTenure : "none";
  let depositHeld = tenure === "rented" ? homes[currentHomeIndex].market.deposit : 0;
  let nextRentDueDay = tenure === "rented" ? dayIndex + DAYS_PER_RENT_PERIOD : -1;
  let outstandingRent = 0;
  let carriedGroceries = 0;
  let transactionSerial = 0;
  let interactionSerial = 0;
  let lastEvent = "residential_ready";
  let lastAction = null;
  let lastTransaction = null;
  let activeVisitorIndex = -1;
  let visitorHomeIndex = -1;
  let visitorDepartureMinute = -1;
  let visitorStartedMinute = -1;

  const owned = new Array(homes.length).fill(false);
  if (tenure === "owned" && currentHomeIndex >= 0) owned[currentHomeIndex] = true;
  const groceries = new Array(homes.length).fill(0);
  const preparedMeals = new Array(homes.length).fill(0);
  const lastActivityDay = Array.from({ length: homes.length }, () => new Array(ACTION_IDS.length).fill(-1));
  const fixtureOffsets = new Array(homes.length).fill(0);
  const fixtureCounts = new Array(homes.length).fill(0);
  const flattenedFixtures = [];
  const fixtureIndexByHomeAndId = new Map();
  for (let homeIndex = 0; homeIndex < homes.length; ++homeIndex) {
    fixtureOffsets[homeIndex] = flattenedFixtures.length;
    for (const sourceRoom of homes[homeIndex].rooms) {
      for (const sourceFixture of sourceRoom.fixtures) {
        const fixtureIndex = flattenedFixtures.length;
        flattenedFixtures.push(sourceFixture);
        fixtureIndexByHomeAndId.set(`${homeIndex}:${sourceFixture.id}`, fixtureIndex);
      }
    }
    fixtureCounts[homeIndex] = flattenedFixtures.length - fixtureOffsets[homeIndex];
    groceries[homeIndex] = homes[homeIndex].market.available ? 3 : 5;
  }
  const fixtureCondition = new Array(flattenedFixtures.length);
  const fixtureCleanliness = new Array(flattenedFixtures.length);
  const fixtureUseCount = new Array(flattenedFixtures.length).fill(0);
  for (let index = 0; index < flattenedFixtures.length; ++index) {
    const sourceFixture = flattenedFixtures[index];
    const variance = hashText(runtimeSeed, `fixture:${sourceFixture.id}`) % 8;
    fixtureCondition[index] = clamp(sourceFixture.condition - variance, 72, 100);
    fixtureCleanliness[index] = clamp(sourceFixture.cleanliness - (variance % 5), 60, 100);
  }
  const initialFixtureCondition = fixtureCondition.slice();
  const initialFixtureCleanliness = fixtureCleanliness.slice();

  const relationshipBond = residents.map(value => value.initialBond);
  const relationshipFamiliarity = new Array(residents.length).fill(0);
  const relationshipInteractions = new Array(residents.length).fill(0);
  const relationshipLastDay = new Array(residents.length).fill(-1);
  const currentScheduleIndex = new Int16Array(residents.length);
  const recordedSources = new Set();
  const runtimeView = {
    dayIndex,
    minuteOfDay,
    currentHomeId: currentHomeIndex >= 0 ? homes[currentHomeIndex].id : null,
    visitorActive: false,
    visitorResidentId: null,
    rentDue: 0,
  };

  function trimLedger() {
    while (recordedSources.size > RESIDENTIAL_LIMITS.maxLedgerEntries) {
      recordedSources.delete(recordedSources.values().next().value);
    }
  }

  function ledgerKey(prefix, sourceId) {
    const source = cleanId(sourceId);
    return source ? `${prefix}:${source}` : null;
  }

  function syncClock(context = {}) {
    const nextMinute = minuteFromContext(context, minuteOfDay);
    const explicitDay = context.dayIndex ?? context.gameDay ?? context.day;
    let nextDay = explicitDay == null ? dayIndex : boundedInteger(explicitDay);
    if (explicitDay == null && nextMinute < previousMinuteOfDay - MINUTES_PER_DAY / 2) nextDay += 1;
    previousMinuteOfDay = nextMinute;
    minuteOfDay = nextMinute;
    if (nextDay !== dayIndex) {
      dayIndex = nextDay;
      accrueRent();
    }
  }

  function accrueRent() {
    if (tenure !== "rented" || currentHomeIndex < 0 || nextRentDueDay < 0) return;
    const terms = homes[currentHomeIndex].market;
    let guard = 0;
    while (dayIndex >= nextRentDueDay && guard++ < 520) {
      outstandingRent += terms.dailyRent * DAYS_PER_RENT_PERIOD;
      nextRentDueDay += DAYS_PER_RENT_PERIOD;
      lastEvent = "rent_became_due";
    }
  }

  function absoluteMinute() {
    return dayIndex * MINUTES_PER_DAY + minuteOfDay;
  }

  function workDay(definition, requestedDay = dayIndex) {
    const weekDay = ((boundedInteger(requestedDay) % 7) + 7) % 7;
    return definition.workDays.includes(weekDay);
  }

  function scheduleIndexFor(residentIndex, requestedDay = dayIndex, requestedMinute = minuteOfDay) {
    const definition = residents[residentIndex];
    const minute = normalizeMinute(requestedMinute);
    for (let index = 0; index < definition.schedule.length; ++index) {
      const entry = definition.schedule[index];
      if (minute >= entry.startMinute && minute < entry.endMinute) return index;
    }
    return definition.schedule.length - 1;
  }

  function resolvedSchedule(residentIndex, requestedDay = dayIndex, requestedMinute = minuteOfDay) {
    const definition = residents[residentIndex];
    const scheduleIndex = scheduleIndexFor(residentIndex, requestedDay, requestedMinute);
    const entry = definition.schedule[scheduleIndex];
    let activityName = entry.activity;
    let locationId = entry.locationId;
    if (activityName === "work" && !workDay(definition, requestedDay)) {
      activityName = "leisure";
      const choice = hashText(runtimeSeed, `${definition.id}:weekend:${requestedDay}`) % definition.leisureLocations.length;
      locationId = definition.leisureLocations[choice];
    } else if (activityName === "leisure" && definition.leisureLocations.length) {
      const choice = hashText(runtimeSeed, `${definition.id}:leisure:${requestedDay}`) % definition.leisureLocations.length;
      locationId = definition.leisureLocations[choice];
    }
    return { scheduleIndex, activity: activityName, locationId };
  }

  function refreshSchedules() {
    for (let index = 0; index < residents.length; ++index) {
      currentScheduleIndex[index] = scheduleIndexFor(index);
    }
  }

  function refreshVisitor() {
    if (activeVisitorIndex < 0) return;
    if (absoluteMinute() >= visitorDepartureMinute || visitorHomeIndex !== currentHomeIndex) {
      activeVisitorIndex = -1;
      visitorHomeIndex = -1;
      visitorDepartureMinute = -1;
      visitorStartedMinute = -1;
      lastEvent = "visitor_departed";
    }
  }

  function fixtureIndexForKind(homeIndex, kind) {
    const start = fixtureOffsets[homeIndex] ?? 0;
    const end = start + (fixtureCounts[homeIndex] ?? 0);
    for (let index = start; index < end; ++index) {
      if (flattenedFixtures[index].kind === kind) return index;
    }
    return -1;
  }

  function homeIndexFrom(value, fallbackCurrent = false) {
    const id = typeof value === "object" ? value?.id ?? value?.homeId : value;
    if ((id == null || id === "") && fallbackCurrent) return currentHomeIndex;
    return homeIndexById.get(cleanId(id)) ?? -1;
  }

  function residentIndexFrom(value) {
    const id = typeof value === "object" ? value?.id ?? value?.residentId : value;
    return residentIndexById.get(cleanId(id)) ?? -1;
  }

  function acquireHome(homeIdValue, context = {}) {
    syncClock(context);
    const homeIndex = homeIndexFrom(homeIdValue);
    const requestedId = cleanId(homeIdValue?.id ?? homeIdValue);
    if (homeIndex < 0) return rejected("unknown_home", { homeId: requestedId || null });
    const definition = homes[homeIndex];
    if (!definition.market.available) return rejected("not_on_market", { homeId: definition.id });
    const mode = cleanId(context.mode, "rent").toLowerCase();
    if (mode !== "rent" && mode !== "buy") return rejected("invalid_tenure", { homeId: definition.id, mode });
    if (boundedInteger(context.progressionTier) < definition.market.unlockTier) {
      return rejected("progression_required", {
        homeId: definition.id,
        requiredTier: definition.market.unlockTier,
      });
    }
    const source = ledgerKey("home", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { homeId: definition.id });
    if (mode === "rent" && currentHomeIndex === homeIndex && tenure === "rented") {
      return rejected("already_tenant", { homeId: definition.id });
    }
    if (mode === "buy" && owned[homeIndex]) return rejected("already_owned", { homeId: definition.id });
    const depositCredit = mode === "buy" && currentHomeIndex === homeIndex && tenure === "rented" ? depositHeld : 0;
    const cost = mode === "rent" ? definition.market.deposit : Math.max(0, definition.market.purchasePrice - depositCredit);
    if (Math.max(0, finite(context.cash)) + 1e-9 < cost) {
      return rejected("insufficient_cash", { homeId: definition.id, mode, cost });
    }
    const previousHomeId = currentHomeIndex >= 0 ? homes[currentHomeIndex].id : null;
    currentHomeIndex = homeIndex;
    tenure = mode === "buy" ? "owned" : "rented";
    if (mode === "buy") {
      owned[homeIndex] = true;
      depositHeld = 0;
      nextRentDueDay = -1;
      outstandingRent = 0;
    } else {
      depositHeld = definition.market.deposit;
      nextRentDueDay = dayIndex + DAYS_PER_RENT_PERIOD;
      outstandingRent = 0;
    }
    groceries[homeIndex] = Math.max(groceries[homeIndex], 3);
    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = mode === "buy" ? "home_purchased" : "tenancy_started";
    lastTransaction = {
      serial: transactionSerial,
      kind: mode,
      homeId: definition.id,
      previousHomeId,
      cost,
      amount: cost,
      depositCredit,
      dayIndex,
    };
    return deepFreeze({ accepted: true, reason: null, ...lastTransaction });
  }

  function payRent(context = {}) {
    syncClock(context);
    if (tenure !== "rented" || currentHomeIndex < 0) return rejected("not_renting", { amount: 0 });
    accrueRent();
    if (outstandingRent <= 0) return rejected("nothing_due", { amount: 0, nextRentDueDay });
    const source = ledgerKey("rent", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { amount: 0 });
    if (Math.max(0, finite(context.cash)) + 1e-9 < outstandingRent) {
      return rejected("insufficient_cash", { amount: outstandingRent });
    }
    const amount = outstandingRent;
    outstandingRent = 0;
    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "rent_paid";
    lastTransaction = {
      serial: transactionSerial,
      kind: "rent_payment",
      homeId: homes[currentHomeIndex].id,
      previousHomeId: null,
      cost: amount,
      amount,
      depositCredit: 0,
      dayIndex,
    };
    return deepFreeze({ accepted: true, reason: null, ...lastTransaction });
  }

  function quoteSupplyReceipt(effects = {}) {
    const groceriesRequested = boundedInteger(effects?.groceries);
    const remainingCapacity = Math.max(0, RESIDENTIAL_LIMITS.maxCarriedGroceries - carriedGroceries);
    if (groceriesRequested <= 0) {
      return rejected("no_supplies", {
        groceriesRequested: 0,
        carriedGroceries,
        remainingCapacity,
      });
    }
    if (groceriesRequested > remainingCapacity) {
      return rejected("carrying_capacity", {
        groceriesRequested,
        carriedGroceries,
        remainingCapacity,
      });
    }
    return deepFreeze({
      accepted: true,
      reason: null,
      groceriesRequested,
      carriedGroceries,
      remainingCapacity,
      carriedGroceriesAfter: carriedGroceries + groceriesRequested,
    });
  }

  function receiveSupplies(effects = {}, context = {}) {
    const source = ledgerKey("supply", context.sourceId);
    if (source && recordedSources.has(source)) {
      return rejected("duplicate_source", {
        kind: "supply_receipt",
        sourceId: cleanId(context.sourceId),
        groceriesReceived: 0,
        carriedGroceries,
      });
    }
    const quote = quoteSupplyReceipt(effects);
    if (!quote.accepted) return quote;
    carriedGroceries = quote.carriedGroceriesAfter;
    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "household_supplies_received";
    lastTransaction = {
      serial: transactionSerial,
      kind: "supply_receipt",
      homeId: null,
      previousHomeId: null,
      cost: 0,
      amount: 0,
      depositCredit: 0,
      dayIndex,
      groceriesReceived: quote.groceriesRequested,
      carriedGroceries,
    };
    return deepFreeze({
      accepted: true,
      reason: null,
      sourceId: context.sourceId == null ? null : cleanId(context.sourceId),
      ...lastTransaction,
    });
  }

  function unpackSupplies(context = {}) {
    syncClock(context);
    const homeIndex = homeIndexFrom(context.homeId, true);
    if (homeIndex < 0 || homeIndex !== currentHomeIndex) {
      return rejected("current_home_required", {
        homeId: homeIndex >= 0 ? homes[homeIndex].id : null,
        groceriesAdded: 0,
        carriedGroceries,
      });
    }
    if (context.atHome === false || context.inVehicle) {
      return rejected("inside_home_required", {
        homeId: homes[homeIndex].id,
        groceriesAdded: 0,
        carriedGroceries,
      });
    }
    const source = ledgerKey("unpack", context.sourceId);
    if (source && recordedSources.has(source)) {
      return rejected("duplicate_source", {
        kind: "supplies_unpacked",
        sourceId: cleanId(context.sourceId),
        homeId: homes[homeIndex].id,
        groceriesAdded: 0,
        carriedGroceries,
      });
    }
    if (carriedGroceries <= 0) {
      return rejected("no_carried_groceries", {
        homeId: homes[homeIndex].id,
        groceriesAdded: 0,
        carriedGroceries,
      });
    }
    const pantrySpace = Math.max(0, RESIDENTIAL_LIMITS.maxGroceries - groceries[homeIndex]);
    if (pantrySpace <= 0) {
      return rejected("pantry_full", {
        homeId: homes[homeIndex].id,
        groceriesAdded: 0,
        carriedGroceries,
      });
    }
    const groceriesAdded = Math.min(carriedGroceries, pantrySpace);
    groceries[homeIndex] += groceriesAdded;
    carriedGroceries -= groceriesAdded;
    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "household_supplies_unpacked";
    lastTransaction = {
      serial: transactionSerial,
      kind: "supplies_unpacked",
      homeId: homes[homeIndex].id,
      previousHomeId: null,
      cost: 0,
      amount: 0,
      depositCredit: 0,
      dayIndex,
      groceriesAdded,
      groceries: groceries[homeIndex],
      carriedGroceries,
    };
    return deepFreeze({
      accepted: true,
      reason: null,
      sourceId: context.sourceId == null ? null : cleanId(context.sourceId),
      ...lastTransaction,
    });
  }

  function restockHome(context = {}) {
    syncClock(context);
    const homeIndex = homeIndexFrom(context.homeId, true);
    if (homeIndex < 0 || homeIndex !== currentHomeIndex) return rejected("current_home_required", { cost: 0 });
    if (context.atHome === false || context.inVehicle) return rejected("inside_home_required", { cost: 0 });
    const source = ledgerKey("restock", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { cost: 0 });
    if (groceries[homeIndex] >= RESIDENTIAL_LIMITS.maxGroceries) return rejected("pantry_full", { cost: 0 });
    const cost = 18;
    if (Math.max(0, finite(context.cash)) + 1e-9 < cost) return rejected("insufficient_cash", { cost });
    const before = groceries[homeIndex];
    groceries[homeIndex] = Math.min(RESIDENTIAL_LIMITS.maxGroceries, groceries[homeIndex] + 5);
    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "groceries_restocked";
    return deepFreeze({
      accepted: true,
      reason: null,
      serial: transactionSerial,
      homeId: homes[homeIndex].id,
      cost,
      groceriesAdded: groceries[homeIndex] - before,
      groceries: groceries[homeIndex],
    });
  }

  function actualNeedDelta(currentValue, requested) {
    if (currentValue == null || !Number.isFinite(Number(currentValue))) return requested;
    const current = clamp(currentValue, 0, 100);
    return clamp(current + requested, 0, 100) - current;
  }

  function performHomeActivity(actionIdValue, context = {}) {
    syncClock(context);
    const actionId = cleanId(actionIdValue);
    const definition = ACTION_BY_ID.get(actionId);
    if (!definition) return rejected("unknown_activity", { actionId });
    if (currentHomeIndex < 0 || tenure === "none") return rejected("home_required", { actionId });
    const requestedHomeIndex = homeIndexFrom(context.homeId, true);
    if (requestedHomeIndex !== currentHomeIndex || context.atHome === false) {
      return rejected("current_home_required", { actionId, homeId: homes[currentHomeIndex].id });
    }
    if (context.busy) return rejected("busy", { actionId });
    if (context.inVehicle) return rejected("on_foot_required", { actionId });
    const source = ledgerKey("activity", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { actionId });
    if (Math.max(0, finite(context.cash)) + 1e-9 < definition.cost) {
      return rejected("insufficient_cash", { actionId, cost: definition.cost });
    }
    if (actionId === "cook" && groceries[currentHomeIndex] <= 0) return rejected("groceries_required", { actionId });
    if (actionId === "eat" && preparedMeals[currentHomeIndex] <= 0) return rejected("prepared_meal_required", { actionId });
    const fixtureIndex = fixtureIndexForKind(currentHomeIndex, definition.fixtureKind);
    if (fixtureIndex < 0) return rejected("fixture_missing", { actionId, fixtureKind: definition.fixtureKind });
    if (fixtureCondition[fixtureIndex] < 20) {
      return rejected("fixture_needs_repair", { actionId, fixtureId: flattenedFixtures[fixtureIndex].id });
    }

    const needs = context.needs ?? context.player ?? {};
    const energy = actualNeedDelta(needs.energy, definition.energy);
    const hygiene = actualNeedDelta(needs.hygiene, definition.hygiene);
    const appetite = actualNeedDelta(needs.appetite, definition.appetite);
    const actionIndex = actionIndexById.get(actionId);
    const earnsExperience = lastActivityDay[currentHomeIndex][actionIndex] !== dayIndex;
    const skills = [];
    if (earnsExperience) {
      if (actionId === "study") {
        const requestedSkill = cleanId(context.skillId, RESIDENTIAL_SKILLS.COMMUNITY);
        const skillId = SKILL_ID_SET.has(requestedSkill) ? requestedSkill : RESIDENTIAL_SKILLS.COMMUNITY;
        skills.push({ skillId, experience: 16 });
      } else {
        for (const award of definition.skillAwards) skills.push({ ...award });
      }
      lastActivityDay[currentHomeIndex][actionIndex] = dayIndex;
    }

    if (actionId === "cook") {
      groceries[currentHomeIndex] -= 1;
      preparedMeals[currentHomeIndex] = Math.min(RESIDENTIAL_LIMITS.maxPreparedMeals, preparedMeals[currentHomeIndex] + 2);
    } else if (actionId === "eat") preparedMeals[currentHomeIndex] -= 1;

    fixtureCondition[fixtureIndex] = clamp(fixtureCondition[fixtureIndex] - definition.fixtureWear, 0, 100);
    fixtureUseCount[fixtureIndex] += 1;
    if (actionId === "clean") {
      const targetRoomId = cleanId(context.roomId, flattenedFixtures[fixtureIndex].roomId);
      const start = fixtureOffsets[currentHomeIndex];
      const end = start + fixtureCounts[currentHomeIndex];
      for (let index = start; index < end; ++index) {
        if (flattenedFixtures[index].roomId === targetRoomId) {
          fixtureCleanliness[index] = clamp(fixtureCleanliness[index] + 18, 0, 100);
        }
      }
    } else fixtureCleanliness[fixtureIndex] = clamp(fixtureCleanliness[fixtureIndex] - definition.fixtureSoil, 0, 100);

    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "home_activity_completed";
    lastAction = {
      serial: transactionSerial,
      actionId,
      homeId: homes[currentHomeIndex].id,
      fixtureId: flattenedFixtures[fixtureIndex].id,
      roomId: flattenedFixtures[fixtureIndex].roomId,
      dayIndex,
      cost: definition.cost,
      gameMinutes: definition.gameMinutes,
      effects: { energy, hygiene, appetite, skills },
    };
    return deepFreeze({ accepted: true, reason: null, ...lastAction });
  }

  function maintainFixture(homeIdValue, fixtureIdValue, context = {}) {
    syncClock(context);
    const homeIndex = homeIndexFrom(homeIdValue, true);
    if (homeIndex < 0 || homeIndex !== currentHomeIndex || context.atHome === false) {
      return rejected("current_home_required", { homeId: homeIndex >= 0 ? homes[homeIndex].id : null });
    }
    const fixtureId = cleanId(fixtureIdValue);
    const fixtureIndex = fixtureIndexByHomeAndId.get(`${homeIndex}:${fixtureId}`) ?? -1;
    if (fixtureIndex < 0) return rejected("unknown_fixture", { fixtureId });
    const missingCondition = 100 - fixtureCondition[fixtureIndex];
    const cost = Math.max(1, Math.ceil(missingCondition * 0.65));
    if (missingCondition < 0.01) return rejected("fixture_healthy", { fixtureId, cost: 0 });
    if (Math.max(0, finite(context.cash)) + 1e-9 < cost) return rejected("insufficient_cash", { fixtureId, cost });
    const source = ledgerKey("fixture", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { fixtureId, cost: 0 });
    fixtureCondition[fixtureIndex] = 100;
    fixtureCleanliness[fixtureIndex] = Math.max(fixtureCleanliness[fixtureIndex], 82);
    transactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "fixture_maintained";
    return deepFreeze({
      accepted: true,
      reason: null,
      serial: transactionSerial,
      homeId: homes[homeIndex].id,
      fixtureId,
      cost,
      effects: { energy: -4, hygiene: -2, appetite: 0, skills: [{ skillId: RESIDENTIAL_SKILLS.MECHANICS, experience: 10 }] },
    });
  }

  function residentState(residentIdValue, context = {}) {
    const residentIndex = residentIndexFrom(residentIdValue);
    if (residentIndex < 0) return null;
    const requestedDay = boundedInteger(context.dayIndex ?? context.gameDay ?? dayIndex);
    const requestedMinute = minuteFromContext(context, minuteOfDay);
    const definition = residents[residentIndex];
    const visiting = activeVisitorIndex === residentIndex
      && visitorHomeIndex === currentHomeIndex
      && requestedDay * MINUTES_PER_DAY + requestedMinute >= visitorStartedMinute
      && requestedDay * MINUTES_PER_DAY + requestedMinute < visitorDepartureMinute;
    const schedule = resolvedSchedule(residentIndex, requestedDay, requestedMinute);
    const activityName = visiting ? "visiting" : schedule.activity;
    const locationId = visiting && currentHomeIndex >= 0 ? homes[currentHomeIndex].id : schedule.locationId;
    return deepFreeze({
      id: definition.id,
      name: definition.name,
      role: definition.role,
      homeId: definition.homeId,
      workplaceId: definition.workplaceId,
      dayIndex: requestedDay,
      minuteOfDay: requestedMinute,
      scheduleIndex: schedule.scheduleIndex,
      activity: activityName,
      locationId,
      awake: activityName !== "sleep",
      availableForVisit: activityName === "home" || activityName === "leisure",
      relationship: {
        bond: relationshipBond[residentIndex],
        familiarity: relationshipFamiliarity[residentIndex],
        interactions: relationshipInteractions[residentIndex],
        lastInteractionDay: relationshipLastDay[residentIndex],
      },
    });
  }

  function recordResidentInteraction(residentIdValue, context = {}) {
    syncClock(context);
    const residentIndex = residentIndexFrom(residentIdValue);
    const requestedId = cleanId(residentIdValue?.id ?? residentIdValue);
    if (residentIndex < 0) return rejected("unknown_resident", { residentId: requestedId || null });
    const kind = cleanId(context.kind, "talk").toLowerCase();
    if (!Object.hasOwn(INTERACTION_BOND, kind)) return rejected("unknown_interaction", { residentId: residents[residentIndex].id, kind });
    const source = ledgerKey("relationship", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { residentId: residents[residentIndex].id, kind });
    const delta = INTERACTION_BOND[kind];
    relationshipBond[residentIndex] = clamp(
      relationshipBond[residentIndex] + delta,
      -RESIDENTIAL_LIMITS.maxRelationshipMagnitude,
      RESIDENTIAL_LIMITS.maxRelationshipMagnitude,
    );
    relationshipInteractions[residentIndex] += 1;
    if (relationshipLastDay[residentIndex] !== dayIndex) relationshipFamiliarity[residentIndex] += 1;
    relationshipLastDay[residentIndex] = dayIndex;
    interactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "relationship_changed";
    return deepFreeze({
      accepted: true,
      reason: null,
      serial: interactionSerial,
      residentId: residents[residentIndex].id,
      kind,
      bondDelta: delta,
      bond: relationshipBond[residentIndex],
      skillEffects: kind === "help" || kind === "shared_meal"
        ? [{ skillId: RESIDENTIAL_SKILLS.COMMUNITY, experience: kind === "help" ? 6 : 4 }]
        : [],
    });
  }

  function inviteVisitor(residentIdValue, context = {}) {
    syncClock(context);
    refreshVisitor();
    const residentIndex = residentIndexFrom(residentIdValue);
    const requestedId = cleanId(residentIdValue?.id ?? residentIdValue);
    if (residentIndex < 0) return rejected("unknown_resident", { residentId: requestedId || null });
    if (currentHomeIndex < 0 || context.atHome === false) return rejected("current_home_required", { residentId: residents[residentIndex].id });
    if (activeVisitorIndex >= 0) return rejected("visitor_already_present", { residentId: residents[activeVisitorIndex].id });
    if (relationshipBond[residentIndex] < 5) return rejected("relationship_too_low", { residentId: residents[residentIndex].id });
    const state = residentState(residents[residentIndex].id);
    if (!state.availableForVisit) return rejected(`resident_${state.activity}`, { residentId: state.id });
    const source = ledgerKey("visitor", context.sourceId);
    if (source && recordedSources.has(source)) return rejected("duplicate_source", { residentId: state.id });
    const durationMinutes = clamp(finite(context.durationMinutes, 90), 15, 240);
    activeVisitorIndex = residentIndex;
    visitorHomeIndex = currentHomeIndex;
    visitorStartedMinute = absoluteMinute();
    visitorDepartureMinute = visitorStartedMinute + durationMinutes;
    relationshipBond[residentIndex] = clamp(relationshipBond[residentIndex] + 1, -100, 100);
    interactionSerial += 1;
    if (source) {
      recordedSources.add(source);
      trimLedger();
    }
    lastEvent = "visitor_arrived";
    return deepFreeze({
      accepted: true,
      reason: null,
      serial: interactionSerial,
      residentId: state.id,
      residentName: state.name,
      homeId: homes[currentHomeIndex].id,
      durationMinutes,
      departureMinute: visitorDepartureMinute,
      line: `${state.name}: Thanks for inviting me in. It feels good to sit somewhere the city cannot hurry us.`,
    });
  }

  function update(deltaValue, context = {}) {
    // Delta is accepted to mirror the other simulation systems. Residential
    // state is driven by the authoritative world clock, not render cadence.
    finite(deltaValue);
    syncClock(context);
    accrueRent();
    refreshSchedules();
    refreshVisitor();
    runtimeView.dayIndex = dayIndex;
    runtimeView.minuteOfDay = minuteOfDay;
    runtimeView.currentHomeId = currentHomeIndex >= 0 ? homes[currentHomeIndex].id : null;
    runtimeView.visitorActive = activeVisitorIndex >= 0;
    runtimeView.visitorResidentId = activeVisitorIndex >= 0 ? residents[activeVisitorIndex].id : null;
    runtimeView.rentDue = outstandingRent;
    return context.captureSnapshot === false ? runtimeView : snapshot();
  }

  function fixtureView(index) {
    const definition = flattenedFixtures[index];
    return {
      id: definition.id,
      name: definition.name,
      kind: definition.kind,
      roomId: definition.roomId,
      condition: fixtureCondition[index],
      cleanliness: fixtureCleanliness[index],
      useCount: fixtureUseCount[index],
      usable: fixtureCondition[index] >= 20,
    };
  }

  function homeView(homeIndex) {
    const definition = homes[homeIndex];
    const start = fixtureOffsets[homeIndex];
    const end = start + fixtureCounts[homeIndex];
    const fixtures = [];
    let totalCondition = 0;
    let totalCleanliness = 0;
    for (let index = start; index < end; ++index) {
      fixtures.push(fixtureView(index));
      totalCondition += fixtureCondition[index];
      totalCleanliness += fixtureCleanliness[index];
    }
    const namedOccupants = residents.filter(value => value.homeId === definition.id).map(value => value.id);
    return {
      id: definition.id,
      name: definition.name,
      address: definition.address,
      buildingId: definition.buildingId,
      market: definition.market,
      roomCount: definition.rooms.length,
      rooms: definition.rooms,
      fixtures,
      condition: fixtures.length ? totalCondition / fixtures.length : 100,
      cleanliness: fixtures.length ? totalCleanliness / fixtures.length : 100,
      groceries: groceries[homeIndex],
      preparedMeals: preparedMeals[homeIndex],
      playerResidence: currentHomeIndex === homeIndex,
      playerOwned: owned[homeIndex],
      namedOccupants,
    };
  }

  function visitorView() {
    if (activeVisitorIndex < 0) return null;
    return {
      residentId: residents[activeVisitorIndex].id,
      residentName: residents[activeVisitorIndex].name,
      homeId: homes[visitorHomeIndex].id,
      startedMinute: visitorStartedMinute,
      departureMinute: visitorDepartureMinute,
      remainingMinutes: Math.max(0, visitorDepartureMinute - absoluteMinute()),
    };
  }

  function snapshot() {
    const homeViews = homes.map((_, index) => homeView(index));
    const residentViews = residents.map((value, index) => residentState(value.id));
    return deepFreeze({
      version: RESIDENTIAL_LIFE_SAVE_VERSION,
      seed: runtimeSeed,
      clock: { dayIndex, minuteOfDay, timeHours: minuteOfDay / 60 },
      player: {
        currentHomeId: currentHomeIndex >= 0 ? homes[currentHomeIndex].id : null,
        tenure,
        ownedHomeIds: homes.filter((_, index) => owned[index]).map(value => value.id),
        depositHeld,
        nextRentDueDay,
        outstandingRent,
        delinquent: outstandingRent > 0,
        carriedSupplies: { groceries: carriedGroceries },
      },
      homes: homeViews,
      residents: residentViews,
      visitor: visitorView(),
      transactionSerial,
      interactionSerial,
      lastEvent,
      lastAction: lastAction ? structuredClone(lastAction) : null,
      lastTransaction: lastTransaction ? { ...lastTransaction } : null,
    });
  }

  function save() {
    return {
      version: RESIDENTIAL_LIFE_SAVE_VERSION,
      seed: runtimeSeed,
      clock: { dayIndex, minuteOfDay, previousMinuteOfDay },
      player: {
        currentHomeId: currentHomeIndex >= 0 ? homes[currentHomeIndex].id : null,
        tenure,
        ownedHomeIds: homes.filter((_, index) => owned[index]).map(value => value.id),
        depositHeld,
        nextRentDueDay,
        outstandingRent,
        carriedSupplies: { groceries: carriedGroceries },
      },
      homes: homes.map((definition, homeIndex) => {
        const start = fixtureOffsets[homeIndex];
        const end = start + fixtureCounts[homeIndex];
        return {
          id: definition.id,
          groceries: groceries[homeIndex],
          preparedMeals: preparedMeals[homeIndex],
          lastActivityDay: Object.fromEntries(ACTION_IDS.map((id, index) => [id, lastActivityDay[homeIndex][index]])),
          fixtures: flattenedFixtures.slice(start, end).map((sourceFixture, offset) => ({
            id: sourceFixture.id,
            condition: fixtureCondition[start + offset],
            cleanliness: fixtureCleanliness[start + offset],
            useCount: fixtureUseCount[start + offset],
          })),
        };
      }),
      relationships: residents.map((definition, index) => ({
        residentId: definition.id,
        bond: relationshipBond[index],
        familiarity: relationshipFamiliarity[index],
        interactions: relationshipInteractions[index],
        lastInteractionDay: relationshipLastDay[index],
      })),
      visitor: activeVisitorIndex < 0 ? null : {
        residentId: residents[activeVisitorIndex].id,
        homeId: homes[visitorHomeIndex].id,
        startedMinute: visitorStartedMinute,
        departureMinute: visitorDepartureMinute,
      },
      transactionSerial,
      interactionSerial,
      recordedSources: [...recordedSources],
      lastEvent,
      lastAction: lastAction ? structuredClone(lastAction) : null,
      lastTransaction: lastTransaction ? { ...lastTransaction } : null,
    };
  }

  function restore(value = {}) {
    const source = plainRecord(value);
    const version = integer(source.version);
    if (version !== 1 && version !== 2 && version !== RESIDENTIAL_LIFE_SAVE_VERSION) {
      throw new RangeError(`Unsupported residential life save version: ${source.version}`);
    }
    runtimeSeed = uint32(source.seed, runtimeSeed);
    const clock = plainRecord(source.clock);
    dayIndex = boundedInteger(clock.dayIndex ?? source.dayIndex);
    minuteOfDay = normalizeMinute(clock.minuteOfDay ?? source.minuteOfDay ?? minuteOfDay);
    previousMinuteOfDay = normalizeMinute(clock.previousMinuteOfDay ?? minuteOfDay);
    const player = version === 1 ? source : plainRecord(source.player);
    currentHomeIndex = homeIndexFrom(player.currentHomeId ?? player.playerHomeId);
    tenure = currentHomeIndex >= 0 && ["rented", "owned"].includes(player.tenure) ? player.tenure : "none";
    owned.fill(false);
    const ownedIds = Array.isArray(player.ownedHomeIds) ? player.ownedHomeIds : Array.isArray(player.ownedHomes) ? player.ownedHomes : [];
    for (const id of ownedIds.slice(0, RESIDENTIAL_LIMITS.maxOwnedHomes)) {
      const index = homeIndexFrom(id);
      if (index >= 0 && homes[index].market.available) owned[index] = true;
    }
    if (tenure === "owned" && currentHomeIndex >= 0) owned[currentHomeIndex] = true;
    depositHeld = tenure === "rented" ? boundedInteger(player.depositHeld, 0, homes[currentHomeIndex]?.market.deposit ?? 0) : 0;
    nextRentDueDay = tenure === "rented" ? Math.max(dayIndex, integer(player.nextRentDueDay, dayIndex + DAYS_PER_RENT_PERIOD)) : -1;
    outstandingRent = tenure === "rented" ? boundedInteger(player.outstandingRent) : 0;
    carriedGroceries = version >= 3
      ? boundedInteger(
        plainRecord(player.carriedSupplies).groceries ?? player.carriedGroceries,
        0,
        RESIDENTIAL_LIMITS.maxCarriedGroceries,
      )
      : 0;

    const homeStates = Array.isArray(source.homes) ? source.homes : Array.isArray(source.roomState) ? source.roomState : [];
    for (let homeIndex = 0; homeIndex < homes.length; ++homeIndex) {
      const homeState = homeStates.find(value => cleanId(value?.id ?? value?.homeId) === homes[homeIndex].id) ?? {};
      groceries[homeIndex] = boundedInteger(homeState.groceries, 0, RESIDENTIAL_LIMITS.maxGroceries);
      preparedMeals[homeIndex] = boundedInteger(homeState.preparedMeals, 0, RESIDENTIAL_LIMITS.maxPreparedMeals);
      const actionDays = plainRecord(homeState.lastActivityDay);
      for (let actionIndex = 0; actionIndex < ACTION_IDS.length; ++actionIndex) {
        lastActivityDay[homeIndex][actionIndex] = integer(actionDays[ACTION_IDS[actionIndex]], -1);
      }
      const fixtureStates = Array.isArray(homeState.fixtures) ? homeState.fixtures : [];
      const start = fixtureOffsets[homeIndex];
      const end = start + fixtureCounts[homeIndex];
      for (let fixtureIndex = start; fixtureIndex < end; ++fixtureIndex) {
        const definition = flattenedFixtures[fixtureIndex];
        const fixtureState = fixtureStates.find(value => cleanId(value?.id ?? value?.fixtureId) === definition.id);
        fixtureCondition[fixtureIndex] = initialFixtureCondition[fixtureIndex];
        fixtureCleanliness[fixtureIndex] = initialFixtureCleanliness[fixtureIndex];
        fixtureUseCount[fixtureIndex] = 0;
        if (fixtureState) {
          fixtureCondition[fixtureIndex] = clamp(fixtureState.condition, 0, 100);
          fixtureCleanliness[fixtureIndex] = clamp(fixtureState.cleanliness, 0, 100);
          fixtureUseCount[fixtureIndex] = boundedInteger(fixtureState.useCount);
        }
      }
    }

    relationshipBond.length = residents.length;
    const relationshipStates = Array.isArray(source.relationships) ? source.relationships : [];
    for (let index = 0; index < residents.length; ++index) {
      const relationship = relationshipStates.find(value => cleanId(value?.residentId ?? value?.id) === residents[index].id) ?? {};
      relationshipBond[index] = clamp(finite(relationship.bond, residents[index].initialBond), -100, 100);
      relationshipFamiliarity[index] = boundedInteger(relationship.familiarity);
      relationshipInteractions[index] = boundedInteger(relationship.interactions);
      relationshipLastDay[index] = integer(relationship.lastInteractionDay, -1);
    }

    activeVisitorIndex = -1;
    visitorHomeIndex = -1;
    visitorDepartureMinute = -1;
    visitorStartedMinute = -1;
    const visitor = plainRecord(source.visitor);
    const restoredVisitorIndex = residentIndexFrom(visitor.residentId);
    const restoredVisitorHomeIndex = homeIndexFrom(visitor.homeId);
    const restoredDeparture = integer(visitor.departureMinute, -1);
    if (restoredVisitorIndex >= 0 && restoredVisitorHomeIndex === currentHomeIndex && restoredDeparture > absoluteMinute()) {
      activeVisitorIndex = restoredVisitorIndex;
      visitorHomeIndex = restoredVisitorHomeIndex;
      visitorStartedMinute = Math.max(0, integer(visitor.startedMinute));
      visitorDepartureMinute = restoredDeparture;
    }
    transactionSerial = boundedInteger(source.transactionSerial);
    interactionSerial = boundedInteger(source.interactionSerial);
    recordedSources.clear();
    const sourceIds = Array.isArray(source.recordedSources) ? source.recordedSources : [];
    for (const entry of sourceIds.slice(-RESIDENTIAL_LIMITS.maxLedgerEntries)) {
      const id = cleanId(entry);
      if (id) recordedSources.add(id);
    }
    lastEvent = cleanId(source.lastEvent, "residential_restored") || "residential_restored";
    lastAction = plainRecord(source.lastAction).actionId && ACTION_BY_ID.has(cleanId(source.lastAction.actionId))
      ? {
        serial: boundedInteger(source.lastAction.serial),
        actionId: cleanId(source.lastAction.actionId),
        homeId: homeIndexFrom(source.lastAction.homeId) >= 0 ? cleanId(source.lastAction.homeId) : null,
        fixtureId: cleanId(source.lastAction.fixtureId),
        roomId: cleanId(source.lastAction.roomId),
        dayIndex: boundedInteger(source.lastAction.dayIndex),
        cost: boundedInteger(source.lastAction.cost),
        gameMinutes: clamp(source.lastAction.gameMinutes, 0, MINUTES_PER_DAY),
        effects: {
          energy: clamp(source.lastAction.effects?.energy, -100, 100),
          hygiene: clamp(source.lastAction.effects?.hygiene, -100, 100),
          appetite: clamp(source.lastAction.effects?.appetite, -100, 100),
          skills: Array.isArray(source.lastAction.effects?.skills)
            ? source.lastAction.effects.skills
              .filter(value => SKILL_ID_SET.has(cleanId(value?.skillId)))
              .slice(0, 6)
              .map(value => ({ skillId: cleanId(value.skillId), experience: boundedInteger(value.experience) }))
            : [],
        },
      }
      : null;
    const transaction = plainRecord(source.lastTransaction);
    if (transaction.kind) {
      const transactionKind = cleanId(transaction.kind);
      lastTransaction = {
        serial: boundedInteger(transaction.serial),
        kind: transactionKind,
        homeId: homeIndexFrom(transaction.homeId) >= 0 ? cleanId(transaction.homeId) : null,
        previousHomeId: homeIndexFrom(transaction.previousHomeId) >= 0 ? cleanId(transaction.previousHomeId) : null,
        cost: boundedInteger(transaction.cost),
        amount: boundedInteger(transaction.amount ?? transaction.cost),
        depositCredit: boundedInteger(transaction.depositCredit),
        dayIndex: boundedInteger(transaction.dayIndex),
        ...(transactionKind === "supply_receipt" ? {
          groceriesReceived: boundedInteger(transaction.groceriesReceived, 0, RESIDENTIAL_LIMITS.maxCarriedGroceries),
          carriedGroceries: boundedInteger(transaction.carriedGroceries, 0, RESIDENTIAL_LIMITS.maxCarriedGroceries),
        } : {}),
        ...(transactionKind === "supplies_unpacked" ? {
          groceriesAdded: boundedInteger(transaction.groceriesAdded, 0, RESIDENTIAL_LIMITS.maxGroceries),
          groceries: boundedInteger(transaction.groceries, 0, RESIDENTIAL_LIMITS.maxGroceries),
          carriedGroceries: boundedInteger(transaction.carriedGroceries, 0, RESIDENTIAL_LIMITS.maxCarriedGroceries),
        } : {}),
      };
    } else lastTransaction = null;
    refreshSchedules();
    refreshVisitor();
    return snapshot();
  }

  function prewarm() {
    const liveBits = JSON.stringify(save());
    let acquisitionsPrepared = 0;
    let activitiesPrepared = 0;
    let schedulesPrepared = 0;
    let relationshipsPrepared = 0;
    const simulation = createResidentialLife({
      homes,
      residents,
      seed: runtimeSeed,
      initialHomeId: null,
      initialTenure: "none",
      initialDayIndex: dayIndex,
      initialMinuteOfDay: 12 * 60,
    });
    for (let index = 0; index < homes.length; ++index) {
      if (!homes[index].market.available) continue;
      const result = simulation.acquireHome(homes[index].id, {
        mode: index === 0 ? "rent" : "buy",
        cash: 999_999,
        progressionTier: 20,
        dayIndex: dayIndex + index,
        sourceId: `prewarm-home-${index}`,
      });
      if (result.accepted) acquisitionsPrepared += 1;
    }
    simulation.acquireHome(homes.find(value => value.market.available)?.id, {
      mode: "rent",
      cash: 999_999,
      progressionTier: 20,
      dayIndex,
      sourceId: "prewarm-active-home",
    });
    simulation.restockHome({ atHome: true, cash: 999, sourceId: "prewarm-pantry" });
    for (const definition of RESIDENTIAL_HOME_ACTIONS) {
      const result = simulation.performHomeActivity(definition.id, {
        atHome: true,
        cash: 999,
        dayIndex: dayIndex + activitiesPrepared,
        needs: { energy: 40, hygiene: 40 },
        skillId: SKILL_IDS[activitiesPrepared % SKILL_IDS.length],
        sourceId: `prewarm-activity-${definition.id}`,
      });
      if (result.accepted) activitiesPrepared += 1;
    }
    for (const definition of residents) {
      simulation.residentState(definition.id, { dayIndex, minuteOfDay: 8 * 60 });
      simulation.residentState(definition.id, { dayIndex: dayIndex + 6, minuteOfDay: 18 * 60 });
      schedulesPrepared += 2;
      const result = simulation.recordResidentInteraction(definition.id, {
        kind: "help",
        dayIndex,
        sourceId: `prewarm-relationship-${definition.id}`,
      });
      if (result.accepted) relationshipsPrepared += 1;
    }
    const saved = simulation.save();
    const restored = createResidentialLife({ homes, residents, seed: runtimeSeed });
    restored.restore(saved);
    const saveRestorePrepared = JSON.stringify(restored.save()) === JSON.stringify(saved);

    // Exercise the actual cross-system household contract in its real order:
    // a shop receipt is carried through a save/load boundary, unpacked into
    // the current pantry, cooked, and finally eaten. The throwaway simulation
    // keeps every exactly-once source and live residential state isolated.
    const marketHome = homes.find(value => value.market.available) ?? homes[0];
    const household = createResidentialLife({
      homes,
      residents,
      seed: runtimeSeed,
      initialHomeId: marketHome?.id ?? null,
      initialTenure: marketHome ? "rented" : "none",
      initialDayIndex: dayIndex,
      initialMinuteOfDay: 17 * 60,
    });
    const receiptQuote = household.quoteSupplyReceipt({ groceries: 5 });
    const receipt = household.receiveSupplies(
      { groceries: 5 },
      { sourceId: "prewarm-market-receipt" },
    );
    const carriedSave = household.save();
    const householdRestored = createResidentialLife({ homes, residents, seed: runtimeSeed });
    householdRestored.restore(carriedSave);
    const carriedSaveRestorePrepared = JSON.stringify(householdRestored.save()) === JSON.stringify(carriedSave);
    const duplicateReceipt = householdRestored.receiveSupplies(
      { groceries: 5 },
      { sourceId: "prewarm-market-receipt" },
    );
    const unpacked = householdRestored.unpackSupplies({
      atHome: true,
      homeId: marketHome?.id ?? null,
      sourceId: "prewarm-unpack",
    });
    const cooked = householdRestored.performHomeActivity("cook", {
      atHome: true,
      homeId: marketHome?.id ?? null,
      cash: 999,
      dayIndex,
      needs: { energy: 40, hygiene: 40, appetite: 40 },
      sourceId: "prewarm-household-cook",
    });
    const eaten = householdRestored.performHomeActivity("eat", {
      atHome: true,
      homeId: marketHome?.id ?? null,
      cash: 999,
      dayIndex,
      needs: { energy: 40, hygiene: 40, appetite: 40 },
      sourceId: "prewarm-household-eat",
    });
    const householdLoopPrepared = Boolean(
      receiptQuote.accepted
      && receipt.accepted
      && carriedSaveRestorePrepared
      && duplicateReceipt.reason === "duplicate_source"
      && unpacked.accepted
      && unpacked.groceriesAdded === 5
      && cooked.accepted
      && eaten.accepted,
    );
    const liveStatePreserved = JSON.stringify(save()) === liveBits;
    if (!liveStatePreserved) throw new Error("Residential prewarm mutated the live simulation");
    return deepFreeze({
      ready: acquisitionsPrepared > 0
        && activitiesPrepared === RESIDENTIAL_HOME_ACTIONS.length
        && schedulesPrepared === residents.length * 2
        && saveRestorePrepared
        && householdLoopPrepared,
      storage: "memory-only",
      rendererResources: 0,
      diskResources: 0,
      homesPrepared: homes.length,
      acquisitionsPrepared,
      activitiesPrepared,
      schedulesPrepared,
      relationshipsPrepared,
      saveRestorePrepared,
      supplyReceiptsPrepared: Number(receipt.accepted),
      supplyUnpacksPrepared: Number(unpacked.accepted),
      carriedSaveRestorePrepared,
      householdLoopPrepared,
      liveStatePreserved,
    });
  }

  refreshSchedules();

  return Object.freeze({
    acquireHome,
    payRent,
    quoteSupplyReceipt,
    receiveSupplies,
    unpackSupplies,
    restockHome,
    perform: performHomeActivity,
    performActivity: performHomeActivity,
    performHomeActivity,
    maintainFixture,
    residentState,
    scheduleForResident: residentState,
    recordResidentInteraction,
    relationshipHook: recordResidentInteraction,
    inviteVisitor,
    update,
    save,
    restore,
    snapshot,
    prewarm,
    homes,
    residents,
  });
}

export const createResidentialLifeSystem = createResidentialLife;
