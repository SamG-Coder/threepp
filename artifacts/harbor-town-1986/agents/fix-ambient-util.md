# Ambient util (no ambient-life yet)

`src/ambient-life.mjs` was **not** on disk. Did **not** create or rewrite it.
Walk loop stays in `main.mjs` (`walk` + `clampWalk`). New module only:

`ThreeBrowserRuntime/samples/harbor_town_1986/src/ambient-util.mjs`

Pure helpers for a later sidewalk walker. Metres, seconds. No `THREE`, no
`Math.random`, no HUD. Not wired into `main.mjs`.

Time lock: Saturday 29 November 1986, 15:20. `+X` east, `+Z` south.

---

## Why not extend ambient-life

Prefer: extend ambient-life if the walk file already exists. It did not.
`nav-graph.json` is a landmark spine, not a pedestrian graph. Hiro poses in
`catalog.mjs` `INSTANCES` are static stills. So this pass is the util only.

## API

```js
seededRng(seed)            // mulberry32 → () => [0, 1)
isStuck(prev, cur, dt, limit = 10)
shouldUpdate(distanceToCamera)
```

Also exported: `STUCK_LIMIT = 10`, `UPDATE_DISTANCE = 48`.

### `seededRng`

Same mulberry32 as `secret_river/src/path.mjs` and other runtime samples.
`seed >>> 0`. Same seed, same sequence. Use this — never `Math.random` —
for NPC start node, dwell, and yaw jitter.

### `isStuck(prev, cur, dt, limit = 10)`

Stateless XZ speed check. `prev` / `cur` are `{ x, z }` (walk state) or
`[x, y, z]` / `[x, z]`. `dt` is seconds (`Clock.getDelta`, already capped
at 0.05 in `main.mjs`).

Stuck when horizontal speed `< 1/limit` m/s (default **0.1 m/s**).
Walk stride ~1.2 m/s is not stuck. `dt <= 0` → false. Non-finite points →
true. Does **not** accumulate time — caller can `stuckFor += dt` if it
wants the gta-neon 0.75 s repair.

Y is ignored: `groundHeight` changes on Suzume-zaka without meaning a jam.

### `shouldUpdate(distanceToCamera)`

True when `0 ≤ d < 48`. Fog near is 28 m; Sakae is 80 m; camera far is 220.
48 m keeps the near curb live and freezes the far quay / hill from a Sakae
eye. Inclusive-of-zero so an NPC under the camera still ticks. NaN / inf /
negative → false.

---

## Tests

`tests/ambient-util.test.mjs` — three `node:test` cases, no PNG, no WebGPU,
no `reconstructOrbitAsset` (agent 32).

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\tests\ambient-util.test.mjs
```

Pass: seeded sequence, frozen vs 1.2 m/s stride, far-LOD cutoff.

## Left for ambient-life

- Read `nav-graph.json`, spawn from sidewalk nodes, step toward an edge.
- Call `isStuck` after the move; repath if `stuckFor` exceeds ~0.75 s.
- Gate the tick with `shouldUpdate` from camera XZ to the NPC.
- Drive Hiro / Mika instances; do not instance the unique Yaoya Hiro.
- Keep legal ground: sidewalks / dock, never `z ∈ [-6, 6]`.
