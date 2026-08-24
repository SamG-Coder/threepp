# Medieval Valley systems

These modules are renderer-free simulation services. They use serializable data,
explicit time, and seeded randomness so the game can run them from either the
real frame loop or a deterministic test/control harness.

```js
import {
  Inventory, WorldProgression, ReputationSystem, createDefaultFireSystem,
  WeatherSystem, TimeSystem, EconomySystem, CraftingSystem, QuestSystem,
  createDefaultQuestDefinitions,
} from "./systems/index.mjs";

const progression = new WorldProgression();
const reputation = new ReputationSystem();
const inventory = new Inventory();
const fire = createDefaultFireSystem({ progression });
const economy = new EconomySystem({ inventory, progression, reputation });
const crafting = new CraftingSystem({ inventory, progression, reputation });
const quests = new QuestSystem({ inventory, progression, reputation, economy, fireSystem: fire });
quests.registerMany(createDefaultQuestDefinitions());
quests.start("light_against_the_dark");
```

## Runtime contracts

- `Inventory` owns stacks, weight, equipped-item durability/upgrades, derived
  stats and attack timing. `transaction()` rolls back all inventory mutations
  if a recipe or other multi-step operation fails. `has(id, quantity)`,
  `count(id)`, `equipped(slot)`, `derivedStats()`, and `attackProfile()` are the
  condition/UI/combat-facing read APIs.
- `QuestSystem.notify({ type, target, amount })` is the only progression input.
  Supported objective types are `talk`, `interact`, `collect`, `craft`, `kill`,
  `defend`, `reach`, `ignite`, `return`, and `custom`. Quest/stage effects target
  world progression, inventory, reputation, economy, or the shared fire system.
- `TimeSystem.advance(gameMinutes)` and `WeatherSystem.advance(gameMinutes)`
  never consult the wall clock. `resolveNpcSchedule(role, time, weather, context)`
  provides the common work/home/shelter/combat decision. Runtime adapters can
  read `time.hour()`, `time.timeOfDay`, `weather.current()`, or serializable
  `snapshot()` values.
- `FireSystem.advance(gameMinutes, weather.snapshot())` applies the same
  exposure model to candles, torches, campfires, braziers, hearths, and the
  village beacon. `lightState(id)` is a renderer-ready intensity/radius value.
- `EconomySystem.advance(gameMinutes)` restocks limited merchant inventories.
  `quote`, `buy`, and `sell` apply reputation and restored-route discounts while
  preserving item, stock, merchant-gold, and player-gold conservation.
- Every stateful service offers `snapshot()`; RNG, inventory, quests, economy,
  weather, time, fire, reputation, and progression also support `restore()`.

## Main-quest event bridge

The game loop advances **Light Against the Dark** only through the following
ordered `QuestSystem.notify()` events. Item collection is checked against real
inventory ownership, so pickup/crafting adapters should add the item before
notifying the matching `collect` event.

```js
quests.notify({ type: "talk", target: "elder_mara" });
quests.notify({ type: "interact", target: "village_beacon" });
quests.notify({ type: "collect", target: "beacon_resin_bundle" });
quests.notify({ type: "collect", target: "beacon_iron_fittings" });
quests.notify({ type: "defend", target: "beacon_repair_site" });
quests.notify({ type: "ignite", target: "village_beacon" });
quests.notify({ type: "reach", target: "fortress_gate" });
quests.notify({ type: "kill", target: "fortress_warden" });
quests.notify({ type: "return", target: "elder_mara" });
```

`QuestSystem.status(id)` intentionally returns `null` for an unknown ID so
optional dialogue content can query quest conditions without throwing.

The main quest uses IDs rather than scene references. World/rendering adapters
should map progression events such as `beaconLit`, `fortressRouteUnlocked`,
`corruptionStrength`, `townEnemySpawnMultiplier`, and `postVictory` to visuals,
AI spawning, navigation gates, and dialogue.
