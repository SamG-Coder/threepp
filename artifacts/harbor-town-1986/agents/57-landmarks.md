# 57 — Hill / park / town / house cameras off house meshes

Minimal edit to `LANDMARKS` in `C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\scout.mjs`. Other landmarks unchanged.

Convention: `+X` east, `+Z` south. `yaw = 0` looks +Z (south). Eye is ground + `EYE` (1.62). Look ray `(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch))`.

Race: none. `scout.mjs` accepted the four replacements; file now matches the values below.

## Why

v5 `go('hill')` → `hill-v5.png` was a melted interior. Old hill `{ x: -36, z: -35 }` sat inside/beside a wooden-hill-house instance.

Houses (AABB ~8.2 × 7.6 m, circumradius ≈ 5.59 m):

| | x | z | yaw |
|---|---|---|---|
| primary | -28 | -34 | 0.42 |
| instance | -38 | -40 | 0.2 |
| instance | -38 | -22 | 0.35 |
| instance | -10.5 | -30 | -1.35 |
| instance | -42 | -30 | 0.7 |

Old hill (−36, −35) is 5.39 m from (−38, −40) — inside that mesh. Also 8.06 m from the primary, 7.81 m from (−42, −30).

## New poses

| name | x | z | yaw | pitch | intent | min dist to house centre |
|---|---|---|---|---|---|---|
| hill | -20 | -14.8 | -0.75 | -0.12 | stone stairs, look SW into park/houses | 17.9 m (−10.5, −30) |
| park | -24 | -22 | -2.35 | -0.1 | grass, look NW at houses | 12.6 m (primary) |
| town | -18 | -44 | 0.15 | -0.12 | north of park, look south toward Sakae | 14.1 m (primary) |
| house | -24 | -26 | -0.4 | -0.08 | in front of primary (south-east of genkan) | 8.94 m (primary) |

All four are outside the 5.59 m house circumradius.

```js
  hill: { x: -20, z: -14.8, yaw: -0.75, pitch: -0.12 },
  house: { x: -24, z: -26, yaw: -0.4, pitch: -0.08 },
  town: { x: -18, z: -44, yaw: 0.15, pitch: -0.12 },
  park: { x: -24, z: -22, yaw: -2.35, pitch: -0.1 },
```

## Left alone

`spawn`, `stairs`, `sakae`, `street-east`, `street-west`, shop fronts (`tobacco`…`records`), `van`, `flower`, `barber`, `kissa`, `booth`, `bar`, `yokobori`, `harbor`, `warehouse`, `quay`, `seawall`, `route16`, `bus`.
