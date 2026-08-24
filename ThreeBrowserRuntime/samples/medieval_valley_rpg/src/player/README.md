# Player integration contract

Import from `player/index.mjs` and construct one actor:

```js
const player = createPlayer({ world, services, input, camera, position });
player.update(deltaSeconds);
```

`createPlayer` returns a visible procedural humanoid with `root`, `visual`,
`equipment`, `controller`, `combat`, `stats`, `receiveHit()`, `heal()`,
`setLoadout()`, `cycleWeapon()`, `snapshot()` and `dispose()`. The equipment rig
has named hand, belt, back and shield sockets and keeps owned sword, shield,
two-handed sword, crossbow and quiver visible in their equipped or stowed
locations. All dynamic objects carry `userData.rtxIgnore = true`.

## Required and optional adapters

- `world` is required. The root attaches to `world.addDynamicActor`,
  `world.actorsRoot`, `world.root`, `world.scene` or `world` (first available).
- Character collision can be supplied as
  `world.resolveCharacterMotion(request)` or
  `world.physics.resolveCharacterMotion(request)`. Without it, the controller
  uses `world.sampleGround`, `world.terrain.sampleGround` or
  `world.terrainHeight`, plus `world.blockers` AABBs. Optional bridge/deck
  records in `world.walkableSurfaces` use `center`/`halfExtents` (or
  min/max X/Z plus `height`) and override lower terrain. The request includes the
  actor, position, velocity, displacement, capsule, step height and slope limit.
- Optional `world.clipCamera({ actor, target, desired, radius })` keeps the
  third-person camera out of geometry.
- `services.actors` may implement `register(actor)` and
  `queryRadius(origin, radius, request)`. Combat also accepts
  `services.combat.queryTargets(request)` or `world.queryCombatTargets(request)`.
- Optional services are `projectiles.spawn`, `loot.spawn`,
  `interaction.interact`, `navigation`, `locations` and `events`.
- `events` accepts `emit(type, payload)`/`on(type, listener)`, matching the
  sample `EventBus`.

`createActorRegistry()` is provided as a ready-to-use implementation of that
shared `services.actors` contract.

The input adapter can expose `actionDown`/`isDown`,
`consumePressed`/`actionPressed`, and `consumeLookDelta`. Default action names
match `core/input.mjs`: `moveForward`, `moveBackward`, `moveLeft`, `moveRight`,
`sprint`, `jump`, `dodge`, `lightAttack`, `heavyAttack`, `block`, `interact` and
`nextWeapon`. Call the sample input's `endFrame()` after all gameplay updates.

Combat uses explicit `windup -> active -> recovery` states, one-hit sets per
attack, stamina costs and delayed regeneration, shield guard arcs, dodge
i-frames, armor, poise/stagger, death and loot events. Useful event families are
`player:*`, `combat:*`, `actor:*` and `loot:drop`.
`player:step` and `player:step-up` are semantic VFX/gameplay hooks carrying the
sampled surface ID; they do not assume an audible playback service.

These modules do not create DOM, UI or audio. UI should consume immutable
`snapshot()` results/events and render through the sample's GPU UI path.
