# NPC integration contract

```js
const npcs = createNpcSystem({ world, services, input });
npcs.update(deltaSeconds);
const session = npcs.interact("brynna-vale", player);
```

The default bounded cast contains nine named, visible villagers: Elder Mara,
Hunter Cael, Merchant Elin, Brynna Vale (blacksmith), Tomas Hearth (innkeeper),
Sister Elian (healer), Captain Rusk (guard), Mira Fen (farmer/merchant) and
Orren Pike (miller). Quest-facing IDs use the exact contracts `elder_mara` and
`merchant_elin`. Each has home/work
keys, a full-day schedule, role, relationships and conditional dialogue.
`NpcSystem` exposes `spawnAll()`, `spawn()`, `setThreat()`, `update()`, `get()`,
`nearest()`, `interact()`, `queryRadius()` and `dispose()`.

Location keys resolve through `services.locations`, `world.getLocation`,
`world.locations`, the sample `world.interactables` and `world.landmarks`.
Common schedule names are aliased to the sample's landmark IDs. The time adapter
may expose `hour`, `timeOfDay` or `state.hour`; weather may expose `current`,
`type` or a state object. Beacon and route conditions read `services.worldState`,
`services.progress` or `world.state.progress`.

Routine schedules yield to storms and nearby danger. Civilians run to shelter;
Captain Rusk advances, blocks telegraphed attacks and fights. All villagers
notice nearby `combat:hit` events and hostile actors through the shared
perception service. Assaulting a villager emits `npc:crime`, lowers village
reputation and puts nearby guards into a `npc:guard-alert` response. NPCs wander around active work posts rather than remaining
at one exact point.

`createDialogueService()` returns data-only dialogue sessions for a GPU UI.
Conditions cover quests, world flags, weather/time, health, items, reputation,
activity and awareness. Optional integrations are `services.quests.offer`,
`services.progression.unlock`, `services.dialogueActions.run`, inventory and
reputation services. Dialogue never mutates DOM or claims audible speech.
Speaking to Elder Mara or Merchant Elin starts their registered quest when its
status is `available`, then sends exact `talk` and `return` objective events.

All NPC visuals use the shared procedural humanoid geometry/material cache and
are marked `rtxIgnore`; the RTX static scene should contain only the world.
