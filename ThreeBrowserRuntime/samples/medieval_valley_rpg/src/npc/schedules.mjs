/**
 * Named villagers and their location-key schedules. Location keys are resolved
 * through services.locations/world.getLocation by npc.mjs.
 */
export const DEFAULT_NPC_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "elder_mara", name: "Elder Mara", role: "elder", dialogue: "elder",
    essential: true,
    home: "herbalists_house", work: "chapel", shelter: "chapel",
    palette: { skin: 0x956d58, cloth: 0x4a4458, leather: 0x3a2d2a, hair: 0xc4bba8 },
    relationships: { "sister-elian": 0.7, "captain-rusk": 0.55, "hunter_cael": 0.35 },
    schedule: [
      { start: 5.5, end: 8, activity: "chapel-prayer", location: "chapel" },
      { start: 8, end: 12, activity: "hear-villagers", location: "market" },
      { start: 12, end: 15, activity: "study-beacon", location: "chapel" },
      { start: 15, end: 19, activity: "council", location: "market" },
      { start: 19, end: 21.5, activity: "chapel-prayer", location: "chapel" },
      { start: 21.5, end: 24, activity: "home", location: "herbalists_house" },
      { start: 0, end: 5.5, activity: "sleep", location: "herbalists_house" },
    ],
  }),
  Object.freeze({
    id: "hunter_cael", name: "Hunter Cael", role: "hunter", dialogue: "hunter",
    essential: true,
    home: "hunter_camp", work: "old_north_road", shelter: "hunter_camp",
    palette: { skin: 0x9a7058, cloth: 0x344537, leather: 0x35271f, hair: 0x3b2a20 },
    relationships: { elder_mara: 0.35, "mira-fen": 0.2 },
    schedule: [
      { start: 5, end: 7, activity: "check-traps", location: "hunter_camp" },
      { start: 7, end: 13, activity: "hunt", location: "old_north_road" },
      { start: 13, end: 16, activity: "resin-grove", location: "shadow_cave" },
      { start: 16, end: 20, activity: "dress-game", location: "hunter_camp" },
      { start: 20, end: 24, activity: "camp", location: "hunter_camp" },
      { start: 0, end: 5, activity: "sleep", location: "hunter_camp" },
    ],
  }),
  Object.freeze({
    id: "merchant_elin", name: "Merchant Elin", role: "merchant", dialogue: "merchant",
    essential: true,
    home: "inn", work: "market", shelter: "inn",
    palette: { skin: 0xaa795e, cloth: 0x524568, leather: 0x3d2d23, hair: 0x2c211c },
    relationships: { elder_mara: 0.25, "tomas-hearth": 0.4 },
    schedule: [
      { start: 6, end: 8, activity: "prepare-stock", location: "inn" },
      { start: 8, end: 18, activity: "trade", location: "market" },
      { start: 18, end: 21, activity: "supper", location: "inn" },
      { start: 21, end: 24, activity: "home", location: "inn" },
      { start: 0, end: 6, activity: "sleep", location: "inn" },
    ],
  }),
  Object.freeze({
    id: "brynna-vale", name: "Brynna Vale", role: "blacksmith", dialogue: "blacksmith",
    essential: true,
    home: "brynnaHome", work: "forge", shelter: "forgeInterior",
    palette: { skin: 0x9a6f55, cloth: 0x483027, leather: 0x35231c, hair: 0x211714 },
    relationships: { "captain-rusk": 0.45, "mira-fen": 0.25 },
    schedule: [
      { start: 6, end: 7.5, activity: "breakfast", location: "brynnaHome" },
      { start: 7.5, end: 12, activity: "smithing", location: "forge" },
      { start: 12, end: 13, activity: "market-break", location: "market" },
      { start: 13, end: 18.5, activity: "smithing", location: "forge" },
      { start: 18.5, end: 21, activity: "supper", location: "inn" },
      { start: 21, end: 24, activity: "home", location: "brynnaHome" },
      { start: 0, end: 6, activity: "sleep", location: "brynnaHome" },
    ],
  }),
  Object.freeze({
    id: "tomas-hearth", name: "Tomas Hearth", role: "innkeeper", dialogue: "innkeeper",
    home: "innUpperFloor", work: "innCounter", shelter: "inn",
    palette: { skin: 0xb8896b, cloth: 0x4d392a, leather: 0x38271d, hair: 0x5b3b26 },
    relationships: { "sister-elian": 0.3, "orren-pike": 0.2 },
    schedule: [
      { start: 5.5, end: 8, activity: "prepare-inn", location: "innKitchen" },
      { start: 8, end: 15, activity: "serve", location: "innCounter" },
      { start: 15, end: 16, activity: "supplies", location: "market" },
      { start: 16, end: 23, activity: "serve", location: "innCounter" },
      { start: 23, end: 24, activity: "close-inn", location: "inn" },
      { start: 0, end: 5.5, activity: "sleep", location: "innUpperFloor" },
    ],
  }),
  Object.freeze({
    id: "sister-elian", name: "Sister Elian", role: "healer", dialogue: "healer",
    home: "chapelCell", work: "chapel", shelter: "chapel",
    palette: { skin: 0xa97c61, cloth: 0x5a5d55, leather: 0x3c332b, hair: 0xc0b9a0 },
    relationships: { "tomas-hearth": 0.3, "mira-fen": 0.4 },
    schedule: [
      { start: 5, end: 7, activity: "prayer", location: "shrine" },
      { start: 7, end: 12, activity: "tend-sick", location: "chapel" },
      { start: 12, end: 14, activity: "gather-herbs", location: "herbGarden" },
      { start: 14, end: 19, activity: "tend-sick", location: "chapel" },
      { start: 19, end: 21, activity: "prayer", location: "shrine" },
      { start: 21, end: 24, activity: "home", location: "chapelCell" },
      { start: 0, end: 5, activity: "sleep", location: "chapelCell" },
    ],
  }),
  Object.freeze({
    id: "captain-rusk", name: "Captain Rusk", role: "guard", dialogue: "guardCaptain",
    home: "guardBarracks", work: "villageGate", shelter: "guardTower",
    guardPost: "villageGate", defensePost: "beaconSquare",
    palette: { skin: 0x8b654f, cloth: 0x263543, leather: 0x38281f, plate: 0x59636b, hair: 0x25201e },
    relationships: { "brynna-vale": 0.45, "mira-fen": 0.35 },
    schedule: [
      { start: 5, end: 8, activity: "gate-watch", location: "villageGate" },
      { start: 8, end: 11, activity: "patrol", location: "market" },
      { start: 11, end: 13, activity: "briefing", location: "guardBarracks" },
      { start: 13, end: 18, activity: "road-watch", location: "bridge" },
      { start: 18, end: 24, activity: "night-guard", location: "villageGate" },
      { start: 0, end: 2, activity: "night-guard", location: "guardTower" },
      { start: 2, end: 5, activity: "rest", location: "guardBarracks" },
    ],
  }),
  Object.freeze({
    id: "mira-fen", name: "Mira Fen", role: "farmer-merchant", dialogue: "farmerMerchant",
    home: "miraFarmhouse", work: "eastField", shelter: "miraFarmhouse",
    palette: { skin: 0x9f7359, cloth: 0x485132, leather: 0x443022, hair: 0x3c271a },
    relationships: { "sister-elian": 0.4, "captain-rusk": 0.35 },
    schedule: [
      { start: 5, end: 7, activity: "feed-livestock", location: "stable" },
      { start: 7, end: 12, activity: "farm", location: "eastField" },
      { start: 12, end: 15, activity: "sell-produce", location: "market" },
      { start: 15, end: 19, activity: "farm", location: "eastField" },
      { start: 19, end: 21, activity: "supper", location: "miraFarmhouse" },
      { start: 21, end: 24, activity: "home", location: "miraFarmhouse" },
      { start: 0, end: 5, activity: "sleep", location: "miraFarmhouse" },
    ],
  }),
  Object.freeze({
    id: "orren-pike", name: "Orren Pike", role: "miller", dialogue: "miller",
    home: "millHouse", work: "mill", shelter: "mill",
    palette: { skin: 0xb17e5f, cloth: 0x665b42, leather: 0x3b2a20, hair: 0x31241d },
    relationships: { "tomas-hearth": 0.2, "brynna-vale": 0.15 },
    schedule: [
      { start: 5.5, end: 7, activity: "inspect-river", location: "millBridge" },
      { start: 7, end: 13, activity: "milling", location: "mill" },
      { start: 13, end: 15, activity: "deliver-flour", location: "inn" },
      { start: 15, end: 19, activity: "milling", location: "mill" },
      { start: 19, end: 22, activity: "home", location: "millHouse" },
      { start: 22, end: 24, activity: "sleep", location: "millHouse" },
      { start: 0, end: 5.5, activity: "sleep", location: "millHouse" },
    ],
  }),
]);

function normalizedHour(value) {
  const hour = Number(value);
  return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;
}

function scheduledEntry(definition, hour) {
  return definition.schedule?.find(entry => hour >= entry.start && hour < entry.end)
    ?? { activity: "home", location: definition.home };
}

/** Resolves the current intent, with danger/weather taking precedence over routine. */
export function resolveNpcSchedule(definition, context = {}) {
  const hour = normalizedHour(context.hour);
  const weather = String(context.weather?.type ?? context.weather ?? "clear").toLowerCase();
  const threat = context.threat ?? null;
  const isGuard = definition.role === "guard";
  if (threat?.active || context.nearbyEnemy) {
    return Object.freeze({
      activity: isGuard ? "defend" : "seek-shelter",
      location: isGuard ? (threat?.location ?? definition.defensePost ?? definition.guardPost ?? definition.work) : definition.shelter,
      reason: "threat",
      hour,
    });
  }
  if (["storm", "heavy-rain", "blizzard"].includes(weather)) {
    return Object.freeze({
      activity: isGuard ? "storm-watch" : "seek-shelter",
      location: isGuard ? (definition.guardPost ?? definition.shelter) : definition.shelter,
      reason: "weather",
      hour,
    });
  }
  const base = scheduledEntry(definition, hour);
  if ((weather === "rain" || weather === "snow") && ["farm", "gather-herbs", "inspect-river", "road-watch"].includes(base.activity)) {
    return Object.freeze({ activity: isGuard ? "covered-watch" : "indoor-work", location: definition.shelter, reason: "weather", hour });
  }
  if (isGuard && (hour >= 20 || hour < 5) && context.beaconLit) {
    return Object.freeze({ ...base, activity: "night-guard", location: definition.guardPost ?? base.location, reason: "beacon-watch", hour });
  }
  return Object.freeze({ ...base, reason: "routine", hour });
}

export function createScheduleResolver({ clock = null, weather = null, worldState = null } = {}) {
  return (definition, overrides = {}) => resolveNpcSchedule(definition, {
    hour: overrides.hour ?? (typeof clock?.hour === "function" ? clock.hour() : clock?.hour ?? clock?.timeOfDay) ?? 12,
    weather: overrides.weather ?? (typeof weather?.current === "function" ? weather.current() : weather?.current ?? weather?.type) ?? "clear",
    beaconLit: overrides.beaconLit ?? worldState?.get?.("beaconLit") ?? worldState?.beaconLit ?? false,
    ...overrides,
  });
}
