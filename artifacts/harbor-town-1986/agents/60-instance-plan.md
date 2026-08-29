# 60 — Additional `INSTANCES` (fill the town)

Do **not** edit `catalog.mjs` from this note. Parent **appends** the
array below to the live `INSTANCES` list. Do not replace uniques in
`ORBIT_SUBJECTS`. Do not re-paste rows that already exist.

Time lock: Saturday 29 November 1986, 15:20. `+X` east, `+Z` south.
Yaw `0` faces south, `Math.PI` north, `Math.PI / 2` east,
`-Math.PI / 2` west.

`honda-cub` **is** in `ORBIT_SUBJECTS` — sidewalk cubs are included.
Assets used (existing ids only): `zelkova`, `english-oak`,
`weeping-willow`, `civilian-hiro`, `kei-van`, `honda-cub`, `steel-bin`,
`oil-drum`, `crate-stack`, `telephone-pole`, `wooden-hill-house`,
`harbor-warehouse-8`, `harbor-warehouse-3`. No new shop facades.

---

## Live occupancy (do not clone these origins)

North shops at `z = -8.5` (front ≈ `-5.5` … `-3.5`). South shops at
`z = 8.6`. Travel lane `z ∈ [-6, 6]`; lane centre `z = 2` stays empty.
Sidewalks: N `z -12…-6`, S `z 6…10`. Park `x -44…-12`, `z -48…-16`.
Dock `x -40…48`, `z 52…88`. Truck lane `x ∈ (-5, 8)` on the apron.
Route 16 `x -48…-24`, `z 8…88`.

Hill houses already planted (8 m boxes = centre ±4 m):

| pose | AABB (8 m) |
|---|---|
| unique `(-28, -34)` | `[-32,-24] × [-38,-30]` |
| `(-38, -40)` | `[-42,-34] × [-44,-36]` |
| `(-38, -22)` | `[-42,-34] × [-26,-18]` |
| `(-10.5, -30)` | `[-14.5,-6.5] × [-34,-26]` |
| `(-42, -30)` | `[-46,-38] × [-34,-26]` |
| `(-16, -42)` | `[-20,-12] × [-46,-38]` |
| `(-44, -36)` | `[-48,-40] × [-40,-32]` |

Warehouses: W8 `(-12,72)` / `(-32,72)` / `(36,72)` / `(-24,58)` /
`(8,58)`; W3 `(16,70)` / `(28,56)`. Zelkovas already sit on both curbs
at ~10 m (`z = ±6.7`). This list fills the **8 m** beat, park holes,
seawall gaps, and empty lots.

Curb trees stay at **`z = -6.6` / `6.7`** (sidewalk, south of north-row
fronts). Extra zelkova `x` is in façade **gaps** so trunks are not
inside shop plan: hardware `[-37.2,-30.8]`, tobacco `[-28.6,-23.4]`,
soba `[-20.2,-13.8]`, yaoya `[-11.7,-6.3]`, pharmacy `[-3.3,3.3]`,
arcade `[4.4,12.4]`, cassette `[14.7,20.9]`; south flower
`[-13.3,-6.7]`, barber `[2.9,9.1]`, kissa `[11.0,17.0]`.

Four new houses are off the 8 m boxes, off the stair ribbon
`x -24…-16`, and off spawn `(-20, -26)`. Two sheds sit in dock gaps:
the 11.5 m slit between W8-W and W8-A, and the west north-apron pad.

Kei vans: parallel park at **`z ≈ -3.2` and `3.2`**, `yaw ±π/2` (long
axis along Sakae). Not at `z = 2`. Clear of unique Carry `(14.5, 3.4)`
and the five vans already in `INSTANCES`.

Hiro clones stay off `z ∈ [-6, 6]`. Varied yaw. Cub on sidewalks only.

---

## Ready to paste (append only)

```js
[
  { asset: "zelkova", x: -32.2, z: -6.6, yaw: 0.55 },
  { asset: "zelkova", x: -21.4, z: -6.6, yaw: 1.35 },
  { asset: "zelkova", x: -12.6, z: -6.6, yaw: 2.05 },
  { asset: "zelkova", x: -4.8, z: -6.6, yaw: 0.7 },
  { asset: "zelkova", x: 13.5, z: -6.6, yaw: 1.15 },
  { asset: "zelkova", x: 22.4, z: -6.6, yaw: 0.25 },
  { asset: "zelkova", x: 32.2, z: -6.6, yaw: 2.35 },
  { asset: "zelkova", x: 39.6, z: -6.6, yaw: 0.95 },
  { asset: "zelkova", x: -24.2, z: 6.7, yaw: 1.45 },
  { asset: "zelkova", x: -13.9, z: 6.7, yaw: 0.35 },
  { asset: "zelkova", x: 0.4, z: 6.7, yaw: 2.15 },
  { asset: "zelkova", x: 18.8, z: 6.7, yaw: 0.85 },
  { asset: "zelkova", x: 30.2, z: 6.7, yaw: 1.75 },

  { asset: "english-oak", x: -36.2, z: -32.4, yaw: 0.45 },
  { asset: "english-oak", x: -28.2, z: -48.0, yaw: 1.05 },
  { asset: "english-oak", x: -28.4, z: -40.2, yaw: 0.2 },
  { asset: "english-oak", x: -28.0, z: -24.2, yaw: 0.88 },
  { asset: "english-oak", x: -12.2, z: -48.0, yaw: 1.55 },
  { asset: "english-oak", x: -44.0, z: -23.6, yaw: 0.6 },
  { asset: "english-oak", x: -43.6, z: -16.4, yaw: 1.25 },
  { asset: "english-oak", x: -16.4, z: -32.2, yaw: 0.15 },
  { asset: "english-oak", x: -20.2, z: -32.0, yaw: 2.05 },
  { asset: "english-oak", x: -36.4, z: -28.2, yaw: 0.72 },
  { asset: "english-oak", x: -24.2, z: -16.2, yaw: 0.38 },
  { asset: "english-oak", x: -16.2, z: -27.6, yaw: 1.42 },

  { asset: "weeping-willow", x: -26.0, z: 86, yaw: 0.55 },
  { asset: "weeping-willow", x: -16.0, z: 86, yaw: 1.1 },
  { asset: "weeping-willow", x: -4.0, z: 86, yaw: 0.25 },
  { asset: "weeping-willow", x: 4.0, z: 86, yaw: 1.45 },
  { asset: "weeping-willow", x: 12.0, z: 86, yaw: 0.7 },
  { asset: "weeping-willow", x: 40.0, z: 86, yaw: 0.15 },

  { asset: "civilian-hiro", x: -36.2, z: -7.35, yaw: Math.PI },
  { asset: "civilian-hiro", x: -17.0, z: -7.28, yaw: Math.PI / 2 },
  { asset: "civilian-hiro", x: 13.2, z: -7.22, yaw: Math.PI },
  { asset: "civilian-hiro", x: 26.8, z: -7.3, yaw: -Math.PI / 2 },
  { asset: "civilian-hiro", x: -23.8, z: 7.25, yaw: Math.PI / 2 },
  { asset: "civilian-hiro", x: 0.8, z: 7.22, yaw: 0 },
  { asset: "civilian-hiro", x: 14.2, z: 7.28, yaw: 0 },
  { asset: "civilian-hiro", x: 30.6, z: 7.2, yaw: 2.45 },
  { asset: "civilian-hiro", x: -34.0, z: -38.5, yaw: 0.85 },
  { asset: "civilian-hiro", x: -32.8, z: -44.2, yaw: 0.2 },
  { asset: "civilian-hiro", x: -40.4, z: -24.0, yaw: 1.75 },
  { asset: "civilian-hiro", x: -14.4, z: -24.8, yaw: -0.55 },
  { asset: "civilian-hiro", x: 22.5, z: 13.8, yaw: -Math.PI / 2 },
  { asset: "civilian-hiro", x: 30.4, z: 20.6, yaw: 0.65 },
  { asset: "civilian-hiro", x: 25.2, z: 24.4, yaw: Math.PI },
  { asset: "civilian-hiro", x: -10.6, z: 61.8, yaw: 0 },
  { asset: "civilian-hiro", x: -30.0, z: 84.5, yaw: Math.PI / 2 },
  { asset: "civilian-hiro", x: 20.6, z: 62.2, yaw: Math.PI },
  { asset: "civilian-hiro", x: 32.8, z: 80.5, yaw: 0.35 },
  { asset: "civilian-hiro", x: -36.4, z: 62.5, yaw: 0.2 },
  { asset: "civilian-hiro", x: 10.4, z: 62.0, yaw: 0 },
  { asset: "civilian-hiro", x: -34.8, z: 16.4, yaw: Math.PI },

  { asset: "kei-van", x: -36.4, z: -3.2, yaw: Math.PI / 2 },
  { asset: "kei-van", x: -12.2, z: -3.2, yaw: Math.PI / 2 },
  { asset: "kei-van", x: 4.2, z: -3.2, yaw: -Math.PI / 2 },
  { asset: "kei-van", x: 6.6, z: 3.25, yaw: Math.PI / 2 },
  { asset: "kei-van", x: 24.4, z: 3.3, yaw: Math.PI / 2 },
  { asset: "kei-van", x: 38.2, z: -3.2, yaw: -Math.PI / 2 },
  { asset: "kei-van", x: -16.4, z: 3.3, yaw: Math.PI / 2 },

  { asset: "honda-cub", x: -26.4, z: -6.38, yaw: Math.PI / 2 },
  { asset: "honda-cub", x: -0.5, z: -6.4, yaw: Math.PI / 2 },
  { asset: "honda-cub", x: 24.4, z: -6.38, yaw: -Math.PI / 2 },
  { asset: "honda-cub", x: 34.6, z: -6.42, yaw: Math.PI / 2 },
  { asset: "honda-cub", x: -19.8, z: 6.48, yaw: -Math.PI / 2 },
  { asset: "honda-cub", x: -26.8, z: 6.5, yaw: Math.PI / 2 },

  { asset: "steel-bin", x: -35.0, z: 12.4, yaw: 0 },
  { asset: "steel-bin", x: -35.0, z: 22.8, yaw: 0.4 },
  { asset: "steel-bin", x: -35.0, z: 40.2, yaw: 1.1 },
  { asset: "steel-bin", x: -18.4, z: 64.2, yaw: 0 },
  { asset: "steel-bin", x: 20.4, z: 64.2, yaw: 0.6 },
  { asset: "steel-bin", x: 34.2, z: 64.0, yaw: 0.2 },
  { asset: "steel-bin", x: -30.4, z: 64.2, yaw: 0.9 },
  { asset: "steel-bin", x: 14.2, z: 83.8, yaw: 0 },
  { asset: "steel-bin", x: -8.4, z: 83.6, yaw: 0.35 },
  { asset: "steel-bin", x: 26.2, z: 14.2, yaw: 0.15 },

  { asset: "oil-drum", x: -28.2, z: 21.6, yaw: 0.4 },
  { asset: "oil-drum", x: -26.4, z: 32.2, yaw: 1.1 },
  { asset: "oil-drum", x: -33.2, z: 48.4, yaw: 0.2 },
  { asset: "oil-drum", x: -24.2, z: 64.4, yaw: 0.7 },
  { asset: "oil-drum", x: 32.4, z: 80.2, yaw: 1.4 },
  { asset: "oil-drum", x: 10.2, z: 84.0, yaw: 0.3 },
  { asset: "oil-drum", x: -34.2, z: 82.2, yaw: 2.0 },
  { asset: "oil-drum", x: 18.4, z: 78.2, yaw: 0.5 },
  { asset: "oil-drum", x: -14.2, z: 64.2, yaw: 1.6 },
  { asset: "oil-drum", x: 22.6, z: 64.4, yaw: 0.8 },

  { asset: "crate-stack", x: -27.2, z: 20.4, yaw: 0.3 },
  { asset: "crate-stack", x: -32.4, z: 30.2, yaw: 0.9 },
  { asset: "crate-stack", x: -26.2, z: 26.4, yaw: 0.15 },
  { asset: "crate-stack", x: -34.4, z: 65.8, yaw: 0.2 },
  { asset: "crate-stack", x: 14.2, z: 63.6, yaw: 0.55 },
  { asset: "crate-stack", x: 30.4, z: 78.2, yaw: -0.2 },
  { asset: "crate-stack", x: -26.4, z: 82.4, yaw: 0.4 },
  { asset: "crate-stack", x: 36.2, z: 82.2, yaw: 0.7 },
  { asset: "crate-stack", x: 10.6, z: 83.4, yaw: -0.3 },
  { asset: "crate-stack", x: 24.8, z: 18.6, yaw: 0.25 },

  { asset: "telephone-pole", x: -34.8, z: 14, yaw: 0 },
  { asset: "telephone-pole", x: -34.8, z: 28, yaw: 0 },
  { asset: "telephone-pole", x: -34.8, z: 42, yaw: 0 },
  { asset: "telephone-pole", x: -34.8, z: 56, yaw: 0 },
  { asset: "telephone-pole", x: -34.8, z: 72, yaw: 0 },
  { asset: "telephone-pole", x: -36.0, z: 66, yaw: 0 },
  { asset: "telephone-pole", x: 20.0, z: 66, yaw: 0 },
  { asset: "telephone-pole", x: 40.0, z: 66, yaw: 0 },

  { asset: "wooden-hill-house", x: -26.5, z: -21.5, yaw: 0.32 },
  { asset: "wooden-hill-house", x: -31.5, z: -13.8, yaw: 0.48 },
  { asset: "wooden-hill-house", x: -12.2, z: -16.2, yaw: -1.05 },
  { asset: "wooden-hill-house", x: -46.0, z: -47.5, yaw: 0.18 },

  { asset: "harbor-warehouse-8", x: -22, z: 72, yaw: Math.PI },
  { asset: "harbor-warehouse-8", x: -38, z: 56, yaw: Math.PI },
]
```

---

## Counts (this append)

| asset | n | where |
|---|---:|---|
| `zelkova` | 13 | curb `z = -6.6 / 6.7`, gap `x`, ~8–10 m |
| `english-oak` | 12 | park, outside 8 m house boxes |
| `weeping-willow` | 6 | seawall `z = 86`, `x -26…40` |
| `civilian-hiro` | 22 | sidewalk 8, park 4, yokobori 3, dock 6, route16 1 |
| `kei-van` | 7 | `z = ±3.2`, not `z = 2` |
| `honda-cub` | 6 | sidewalks |
| `steel-bin` | 10 | route16 walk + dock + yokobori |
| `oil-drum` | 10 | route16 lot + dock |
| `crate-stack` | 10 | route16 lot + dock + yokobori |
| `telephone-pole` | 8 | route16 walk `x = -34.8` + dock |
| `wooden-hill-house` | 4 | empty lots |
| `harbor-warehouse-8` | 2 | W8-W/W8-A slit; west north apron |
| **total** | **120** | |

House AABBs (new): `(-26.5,-21.5)` `[-30.5,-22.5]×[-25.5,-17.5]`;
`(-31.5,-13.8)` `[-35.5,-27.5]×[-17.8,-9.8]`; `(-12.2,-16.2)`
`[-16.2,-8.2]×[-20.2,-12.2]`; `(-46.0,-47.5)` `[-50,-42]×[-51.5,-43.5]`.

Warehouse AABBs (new, 8.5×11, yaw π): `(-22,72)`
`[-26.25,-17.75]×[66.5,77.5]` (1.5 m alleys to W8-W / W8-A);
`(-38,56)` `[-42.25,-33.75]×[50.5,61.5]` (west of `(-24,58)`, north of
W8-W, on route16 quay / dock lip).
