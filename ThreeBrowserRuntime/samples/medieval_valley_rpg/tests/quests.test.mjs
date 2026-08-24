import test from "node:test";
import assert from "node:assert/strict";

import { EconomySystem } from "../src/systems/economy.mjs";
import { createDefaultFireSystem } from "../src/systems/fire.mjs";
import { Inventory } from "../src/systems/inventory.mjs";
import { createLightAgainstDarkQuest } from "../src/systems/main-quest.mjs";
import { QuestSystem } from "../src/systems/quests.mjs";
import { ReputationSystem, WorldProgression } from "../src/systems/reputation.mjs";

function gameServices() {
  const inventory = new Inventory({ maxSlots: 48, weightCapacity: 120 });
  const progression = new WorldProgression();
  const reputation = new ReputationSystem();
  const fireSystem = createDefaultFireSystem({ progression });
  const economy = new EconomySystem({ inventory, progression, reputation, startingGold: 90 });
  const quests = new QuestSystem({ inventory, progression, reputation, fireSystem, economy });
  quests.register(createLightAgainstDarkQuest());
  return { inventory, progression, reputation, fireSystem, economy, quests };
}

test("Light Against the Dark enforces ordering and couples the beacon to world state", () => {
  const services = gameServices();
  const { quests, inventory, progression, reputation, fireSystem, economy } = services;
  quests.start("light_against_the_dark");
  assert.equal(quests.status("light_against_the_dark"), "active");
  assert.equal(quests.status("dialogue-only-quest-id"), null);
  assert.equal(quests.get("light_against_the_dark").stageId, "speak_to_elder");

  quests.notify({ type: "kill", target: "fortress_warden" });
  assert.equal(quests.get("light_against_the_dark").stageId, "speak_to_elder", "future events cannot skip stages");

  quests.notify({ type: "talk", target: "elder_mara" });
  quests.notify({ type: "interact", target: "village_beacon" });
  assert.equal(progression.get("beaconInspected"), true);
  assert.equal(quests.get("light_against_the_dark").stageId, "obtain_resin");

  inventory.addExact("beacon_resin_bundle", 1);
  quests.notify({ type: "collect", target: "beacon_resin_bundle" });
  assert.equal(inventory.count("beacon_resin_bundle"), 0, "resin is transferred into the repair, not duplicated");
  assert.equal(progression.get("beaconRepairProgress"), 0.35);

  inventory.addExact("beacon_iron_fittings", 1);
  quests.notify({ type: "collect", target: "beacon_iron_fittings" });
  assert.equal(inventory.count("beacon_iron_fittings"), 0);
  assert.equal(progression.get("beaconRepairProgress"), 0.7);

  quests.notify({ type: "defend", target: "beacon_repair_site" });
  assert.equal(progression.get("villageDefended"), true);
  assert.equal(progression.get("beaconRepairProgress"), 1);
  assert.equal(fireSystem.get("village_beacon").lit, false);

  quests.notify({ type: "ignite", target: "village_beacon" });
  assert.equal(quests.get("light_against_the_dark").stageId, "follow_signal");
  assert.equal(fireSystem.get("village_beacon").lit, true);
  assert.equal(progression.get("beaconLit"), true);
  assert.equal(progression.get("valleyBeaconIntensity"), 1);
  assert.equal(progression.get("fortressRouteUnlocked"), true);
  assert.equal(progression.get("townEnemySpawnMultiplier"), 0.46);
  assert.ok(progression.get("guardMorale") > 0.7);
  assert.equal(reputation.get("village"), 12);

  quests.notify({ type: "reach", target: "fortress_gate" });
  quests.notify({ type: "kill", target: "fortress_warden" });
  assert.equal(progression.get("wardenDefeated"), true);
  assert.equal(progression.get("corruptionStrength"), 0);
  quests.notify({ type: "return", target: "elder_mara" });

  const completed = quests.get("light_against_the_dark");
  assert.equal(completed.status, "completed");
  assert.equal(progression.get("mainQuestComplete"), true);
  assert.equal(progression.get("postVictory"), true);
  assert.equal(progression.get("villageSafety"), 0.95);
  assert.equal(economy.gold, 390);
  assert.equal(reputation.get("village"), 42);
  assert.equal(inventory.count("warden_sigil"), 1);
  assert.equal(inventory.count("warden_blade"), 1);
});

test("pre-owned collection objectives settle in order without duplicate items", () => {
  const { quests, inventory, progression } = gameServices();
  inventory.addExact("beacon_resin_bundle", 1);
  quests.start("light_against_the_dark");
  quests.notify({ type: "talk", target: "elder_mara" });
  quests.notify({ type: "interact", target: "village_beacon" });
  assert.equal(quests.get("light_against_the_dark").stageId, "obtain_iron_fittings");
  assert.equal(inventory.count("beacon_resin_bundle"), 0);
  assert.equal(progression.get("beaconRepairProgress"), 0.35);
});

test("generic dependencies, optional objectives, dialogue conditions and rewards work", () => {
  const inventory = new Inventory();
  const progression = new WorldProgression();
  const reputation = new ReputationSystem();
  const quests = new QuestSystem({ inventory, progression, reputation });
  quests.register({
    id: "first", name: "First", stages: [{
      id: "work", dialogue: ["first_started"], objectives: [
        { id: "required", type: "custom", target: "required", amount: 2 },
        { id: "optional", type: "custom", target: "optional", optional: true },
      ],
    }], rewards: { reputation: { village: 5 } },
  });
  quests.register({
    id: "second", name: "Second", dependencies: ["first"],
    stages: [{ id: "finish", objectives: [{ id: "done", type: "talk", target: "elder_mara" }] }],
  });

  assert.equal(quests.get("second").status, "locked");
  assert.throws(() => quests.start("second"), /dependencies/);
  quests.start("first");
  assert.equal(quests.conditionMet({ type: "dialogue", questId: "first", tag: "first_started" }), true);
  quests.notify({ type: "custom", target: "required" });
  assert.equal(quests.get("first").status, "active");
  quests.notify({ type: "custom", target: "required" });
  assert.equal(quests.get("first").status, "completed", "optional objectives do not block completion");
  assert.equal(quests.get("second").status, "available");
  assert.equal(reputation.get("village"), 5);
});

test("stage failure conditions produce an explicit restartable failure", () => {
  const { quests, progression, inventory } = gameServices();
  quests.start("light_against_the_dark");
  quests.notify({ type: "talk", target: "elder_mara" });
  quests.notify({ type: "interact", target: "village_beacon" });
  inventory.addExact("beacon_resin_bundle", 1);
  quests.notify({ type: "collect", target: "beacon_resin_bundle" });
  inventory.addExact("beacon_iron_fittings", 1);
  quests.notify({ type: "collect", target: "beacon_iron_fittings" });
  assert.equal(quests.get("light_against_the_dark").stageId, "defend_repairs");
  progression.set("villageIntegrity", 0);
  quests.tick(0.1);
  assert.equal(quests.get("light_against_the_dark").status, "failed");
  assert.equal(quests.get("light_against_the_dark").failureReason, "the_village_fell");
  progression.set("villageIntegrity", 1);
  quests.restart("light_against_the_dark");
  assert.equal(quests.get("light_against_the_dark").stageId, "speak_to_elder");
});
