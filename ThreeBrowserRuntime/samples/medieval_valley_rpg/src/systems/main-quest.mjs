export const LIGHT_AGAINST_THE_DARK = deepFreeze({
  id: "light_against_the_dark",
  name: "Light Against the Dark",
  description: "Restore the village beacon, open the fortress road and end the corruption.",
  dialogue: ["elder_can_offer_beacon_quest"],
  stages: [
    {
      id: "speak_to_elder",
      name: "A Village Under Siege",
      dialogue: ["elder_beacon_introduction"],
      objectives: [objective("speak_elder", "talk", "elder_mara", "Speak to Elder Mara in the chapel square.")],
    },
    {
      id: "inspect_beacon",
      name: "The Broken Beacon",
      dialogue: ["elder_explains_beacon"],
      objectives: [objective("inspect_beacon_mechanism", "interact", "village_beacon", "Inspect the damaged beacon tower.")],
      onCompleteEffects: [world("set", "beaconInspected", true)],
    },
    {
      id: "obtain_resin",
      name: "Resin from the Old Pines",
      dialogue: ["hunter_marks_resin_grove"],
      objectives: [
        objective("collect_beacon_resin", "collect", "beacon_resin_bundle", "Prepare resin and kindling in the forest."),
        { ...objective("clear_resin_grove", "kill", "corrupted_wolf", "Drive the wolves from the resin grove.", 3), optional: true },
      ],
      onCompleteEffects: [
        inventory("remove", "beacon_resin_bundle", 1),
        world("add", "beaconRepairProgress", 0.35),
      ],
    },
    {
      id: "obtain_iron_fittings",
      name: "Iron for the Flame",
      dialogue: ["blacksmith_beacon_fittings"],
      objectives: [objective("collect_iron_fittings", "collect", "beacon_iron_fittings", "Obtain new iron fittings from the blacksmith.")],
      onCompleteEffects: [
        inventory("remove", "beacon_iron_fittings", 1),
        world("add", "beaconRepairProgress", 0.35),
      ],
    },
    {
      id: "defend_repairs",
      name: "Hold the Village Wall",
      dialogue: ["guards_prepare_beacon_defense"],
      objectives: [
        objective("defend_beacon_crew", "defend", "beacon_repair_site", "Defend the repair crew until the beacon is ready."),
        { ...objective("keep_barricades", "defend", "barricades_intact", "Keep both eastern barricades standing."), optional: true },
      ],
      failureConditions: [
        { type: "worldAtMost", key: "villageIntegrity", value: 0, reason: "the_village_fell" },
      ],
      onCompleteEffects: [
        world("set", "villageDefended", true),
        world("set", "beaconRepairProgress", 1),
        world("add", "guardMorale", 0.12),
      ],
      onFailEffects: [world("multiply", "guardMorale", 0.5)],
    },
    {
      id: "light_beacon",
      name: "Light Against the Dark",
      dialogue: ["elder_calls_for_the_flame"],
      objectives: [objective("ignite_village_beacon", "ignite", "village_beacon", "Light the restored beacon.")],
      onCompleteEffects: [
        fire("ignite", "village_beacon"),
        world("set", "beaconLit", true),
        world("set", "valleyBeaconIntensity", 1),
        world("set", "fortressRouteUnlocked", true),
        world("set", "townEnemySpawnMultiplier", 0.46),
        world("multiply", "corruptionStrength", 0.7),
        world("add", "villageSafety", 0.24),
        world("add", "guardMorale", 0.28),
        reputation("add", "village", 12),
      ],
    },
    {
      id: "follow_signal",
      name: "The Road Revealed",
      dialogue: ["guards_open_fortress_road"],
      objectives: [
        objective("reach_fortress_gate", "reach", "fortress_gate", "Follow the beacon's line through the forest to the fortress."),
        { ...objective("visit_watchtower", "reach", "old_watchtower", "Search the old watchtower for supplies."), optional: true },
      ],
    },
    {
      id: "defeat_warden",
      name: "The Fortress Warden",
      dialogue: ["warden_confrontation"],
      objectives: [objective("slay_fortress_warden", "kill", "fortress_warden", "Defeat the creature controlling the corruption.")],
      onCompleteEffects: [
        world("set", "wardenDefeated", true),
        world("set", "corruptionStrength", 0),
        world("set", "townEnemySpawnMultiplier", 0.18),
        world("add", "villageSafety", 0.28),
      ],
    },
    {
      id: "return_to_village",
      name: "A Safer Dawn",
      dialogue: ["village_awaits_warden_news"],
      objectives: [objective("return_to_elder", "return", "elder_mara", "Return to Elder Mara with news of the Warden's defeat.")],
    },
  ],
  rewards: {
    currency: 300,
    reputation: { village: 30, guards: 20 },
    items: { warden_sigil: 1, warden_blade: 1 },
  },
  onCompleteEffects: [
    world("set", "postVictory", true),
    world("set", "mainQuestComplete", true),
    world("set", "villageSafety", 0.95),
    world("set", "guardMorale", 1),
  ],
});

export const ROADS_OF_TRADE = deepFreeze({
  id: "roads_of_trade",
  name: "Roads of Trade",
  description: "Clear the corrupted wolf den so merchants can reach the settlement again.",
  stages: [
    {
      id: "find_wolf_den",
      name: "A Dangerous Road",
      objectives: [objective("talk_to_merchant", "talk", "merchant_elin", "Ask Elin why the trade cart is late.")],
    },
    {
      id: "clear_wolf_den",
      name: "The Wolf Den",
      objectives: [
        objective("kill_den_wolves", "kill", "corrupted_wolf", "Defeat the wolves around the den.", 5),
        objective("destroy_den_heart", "interact", "wolf_den_heart", "Destroy the corruption inside the den."),
      ],
    },
    {
      id: "report_safe_road",
      name: "Trade Restored",
      objectives: [objective("return_to_merchant", "return", "merchant_elin", "Tell Elin that the road is safe.")],
    },
  ],
  rewards: { currency: 95, reputation: { village: 12 }, items: { healing_draught: 2 } },
  onCompleteEffects: [
    world("set", "wolfDenCleared", true),
    world("set", "merchantRouteOpen", true),
    world("add", "merchantStockTier", 1),
    world("add", "villageSafety", 0.1),
  ],
});

export function createLightAgainstDarkQuest() {
  return structuredClone(LIGHT_AGAINST_THE_DARK);
}

export function createRoadsOfTradeQuest() {
  return structuredClone(ROADS_OF_TRADE);
}

export function createDefaultQuestDefinitions() {
  return [createLightAgainstDarkQuest(), createRoadsOfTradeQuest()];
}

function objective(id, type, target, description, amount = 1) {
  return { id, type, target, amount, description };
}

function world(op, key, value) {
  return { service: "world", op, key, value };
}

function fire(op, id) {
  return { service: "fire", op, id };
}

function reputation(op, faction, value) {
  return { service: "reputation", op, faction, value };
}

function inventory(op, itemId, quantity) {
  return { service: "inventory", op, itemId, quantity };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
