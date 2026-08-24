# Enemy and navigation integration contract

```js
const enemies = createEnemyDirector({ world, services, capacities });
enemies.spawn("wolf", { position });
enemies.spawn("hollowSoldier", { position });
enemies.spawn("brute", { position });
enemies.spawn("fortressWarden", { position });
enemies.update(deltaSeconds);
```

`EnemyDirector` owns fixed-capacity pools (defaults: 18 wolves, 14 soldiers, 6
brutes and 1 Warden). `spawn()` returns a reusable enemy with `root`, `combat`,
`navigator`, `perception`, `receiveHit()`, `snapshot()` and `deactivate()`.
`active()`, `queryRadius()`, `despawnAll()` and `dispose()` are public director
APIs. Geometry and materials are shared; inactive actors are hidden and reused.
Every moving root/mesh is marked `rtxIgnore` and `dynamicActor`.

Kill notifications sent to `services.quests.notify` use the main-quest targets
`corrupted_wolf` and `fortress_warden` (plus `hollow_soldier` and
`ashen_brute`). Enemy snapshots expose the same value as `questTarget`.

Archetypes do not share one generic brain:

- wolves circle, lunge and retreat between attacks;
- hollow soldiers advance behind a shield and reactively guard player windups;
- brutes favour slow, highly telegraphed, prop-breaking heavy attacks;
- the Fortress Warden changes at 66% and 33% health, accelerates its pattern,
  requests environmental hazards and emits brazier, reinforcement and
  shockwave events.

`createNavigator({ actor, world, services })` uses
`services.navigation.findPath`, `world.findPath` or
`world.navigation.findPath`, then delegates capsule motion to the player
contract. Direct movement is the fallback. `createPerception()` uses an actor
registry plus optional `services.perception.lineOfSight`, `world.lineOfSight` or
`world.physics.lineOfSight`. `perception:noise` is a semantic gameplay stimulus,
not an audio implementation.

For full combat targeting, provide a shared actor registry with:

```js
{
  register(actor) { /* return optional unsubscribe */ },
  list() { return iterableOfActors; },
  queryRadius(origin, radius, request) { return iterableOfActors; }
}
```

Set `services.player` after creating the player, or ensure the player is in the
registry. The director emits `enemy:*`, `boss:*`, `combat:*`,
`navigation:*` and `perception:*` events. `world.activateBossHazard` and
`world.queueBossHazard` are optional hooks; events remain available when those
hooks are absent.
