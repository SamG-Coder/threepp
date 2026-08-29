# 51 — Suzume-zaka park fill

New module only: `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-park.mjs`.
Do **not** edit `catalog.mjs`, `main.mjs`, `scout.mjs`, or `map.mjs` from
this note. Parent wires `addParkFill` in a later pass.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south. `groundHeight` from
`map.mjs`. Cheap language: `BoxGeometry` / `CylinderGeometry` +
`MeshStandardMaterial`, named meshes, cast/receive shadow. No HUD. No
`Math.random`. No `reconstructOrbitAsset`.

```js
export function addParkFill(scene, { THREE, groundHeight })
```

Seat recipe (stairs / skyline):

```
y = groundHeight(x, z) + height * 0.5
```

N–S strips (hedges, gravel) sample the **south / downhill** end of each
box, then add half-height, so lips do not float on the hill.

---

## Ground facts

`GROUND.park`: **x −44…−12, z −48…−16**, grass `0x4a5c3a`.

Stone stairs (`addStreetFurniture`): centreline **x = −20**, width **6.5 m**
→ **x −23.25…−16.75**, **z −12.4…−23.95**. Keep-out used here:
**x −23.4…−16.6, z −24…−12**. South-edge hedges skip that mouth.

Hill houses (`wooden-hill-house`, ~8 m boxes, keep-out ±4.2 m):

| id | x | z | yaw | keep-out x × z |
|---|---:|---:|---:|---|
| unique | −28 | −34 | 0.42 | **−32.2…−23.8 × −38.2…−29.8** |
| inst NW | −38 | −40 | 0.2 | **−42.2…−33.8 × −44.2…−35.8** |
| inst SW | −38 | −22 | 0.35 | **−42.2…−33.8 × −26.2…−17.8** |
| inst E | −10.5 | −30 | −1.35 | **−14.7…−6.3 × −34.2…−25.8** |
| inst W | −42 | −30 | 0.7 | **−46.2…−37.8 × −34.2…−25.8** |

Oaks sit on a 10 m grid (`INSTANCES` `english-oak` plus unique at
`(−32, −44)`). Benches may sit under canopy. They must **not** sit in
house boxes, on stair treads, or outside the park AABB.

West hedge gaps **z −34.3…−25.7** (house at −42, −30). East hedge gaps
the same band (house at −10.5, −30).

---

## Kit (metres)

| piece | parts | size | colour |
|---|---|---|---|
| bench | seat + 2 legs + backrest | seat **1.52 × 0.07 × 0.40**; legs **0.07 × 0.40 × 0.36** at x ±0.58; back **1.52 × 0.40 × 0.06** at z = −0.17 | wood `0x3c2a1c` / legs `0x2a1c12` |
| hedge | box row | **0.42 × 0.60 × ~1.6–2.4** | dark green `0x1a3520` |
| lantern | base + post + firebox + roof | base 0.40×0.16×0.40; post r 0.09–0.11 h 0.78; box 0.26³; roof 0.42×0.08×0.42 | stone `0x8a8680` |
| gravel path | 12 thin boxes | **1.36 × 0.06 × ~1.21** | `0x9a9488` |
| sandbox | frame + sand cap | frame **2.15 × 0.30 × 2.15**; sand **1.85 × 0.08 × 1.85** | timber `0x5c4634` / sand `0xc2b280` |

Shared geometries per family. Mesh names: `park-bench-N-seat|back|leg-l|leg-r`,
`park-lantern-N-base|post|box|roof`, `park-hedge-{strip}-{i}`,
`park-path-{i}`, `park-sandbox`, `park-sandbox-sand`. Root group
`park-fill`.

---

## 12 benches

Along park edges (inward-facing) and the gravel path. Seat y from
`groundHeight` at the origin. Local +Z is the sitting direction.

| # | x | z | yaw | faces | sits |
|---:|---:|---:|---:|---|---|
| 0 | −40.20 | −17.15 | π | north | south edge, west of stairs |
| 1 | −33.00 | −17.15 | π | north | south edge, mid |
| 2 | −14.40 | −17.20 | π | north | south edge, **east** of stairs (x > −16.6) |
| 3 | −43.15 | −18.60 | π/2 | east | west edge, south of house (−42, −30) |
| 4 | −43.15 | −37.80 | π/2 | east | west edge, north of house (−42, −30) |
| 5 | −34.60 | −46.55 | 0 | south | north edge, west |
| 6 | −24.80 | −46.55 | 0 | south | north edge, centre |
| 7 | −15.40 | −46.55 | 0 | south | north edge, east |
| 8 | −13.15 | −41.20 | −π/2 | west | east edge, north of house (−10.5, −30) |
| 9 | −13.20 | −18.80 | −π/2 | west | east edge, south of that house |
| 10 | −26.10 | −24.95 | **2.034** | path | path west shoulder, t ≈ 0.48 |
| 11 | −24.86 | −29.07 | **−1.107** | path | path east shoulder, t ≈ 0.62 |

#10 / #11 stay west of the stair AABB and **south** of unique-house
keep-out (z = −29.8).

---

## Hedge rows (0.6 m)

Inset **0.32 m** inside `GROUND.park`. South mouth skips stairs.
N–S edges skip the two west/east house bands.

| strip | x0 | z0 | x1 | z1 | n | seg (m) |
|---|---:|---:|---:|---:|---:|---:|
| south-west | −43.68 | −16.32 | −23.50 | −16.32 | 8 | 2.4 |
| south-east | −16.55 | −16.32 | −12.32 | −16.32 | 2 | 2.2 |
| north-west | −43.68 | −47.68 | −24.20 | −47.68 | 8 | 2.4 |
| north-channel | −23.90 | −47.68 | −16.20 | −47.68 | 4 | 2.0 |
| north-east | −15.90 | −47.68 | −12.32 | −47.68 | 2 | 1.8 |
| west-north | −43.68 | −47.46 | −43.68 | −34.30 | 8 | 1.6 |
| west-south | −43.68 | −25.70 | −43.68 | −16.54 | 6 | 1.6 |
| east-north | −12.32 | −47.46 | −12.32 | −34.30 | 8 | 1.6 |
| east-south | −12.32 | −25.70 | −12.32 | −16.54 | 6 | 1.6 |

`north-channel` is a separate strip because `groundHeight` drops **0.4 m**
in x −24…−16. No hedge on the stair flight.

---

## 4 stone lanterns

| # | x | z | sits |
|---:|---:|---:|---|
| 0 | −24.55 | −16.85 | path mouth, **west** of stairs |
| 1 | −26.16 | −26.42 | path mid, west shoulder |
| 2 | −31.45 | −20.85 | sandbox north-east |
| 3 | −14.55 | −44.80 | north-east lawn |

Centres outside house boxes and stair AABB. Post sits on `groundHeight`.

---

## Gravel path

Thin box strip from the stair / park merge **(−20, −16)** into the park
**toward (−30, −36)**. Unique house keep-out clips the far end: strip
stops at **(−26.5, −29.0)** (same direction, t ≈ 0.65 of the full
22.4 m). 12 segments, yaw `atan2(−6.5, −13)` ≈ **−2.678**.

| i | x | z |
|---:|---:|---:|
| 0 | −20.27 | −16.54 |
| 1 | −20.81 | −17.63 |
| 2 | −21.35 | −18.71 |
| 3 | −21.90 | −19.79 |
| 4 | −22.44 | −20.88 |
| 5 | −22.98 | −21.96 |
| 6 | −23.52 | −23.04 |
| 7 | −24.06 | −24.13 |
| 8 | −24.60 | −25.21 |
| 9 | −25.15 | −26.29 |
| 10 | −25.69 | −27.38 |
| 11 | −26.23 | −28.46 |

i = 0…5 share the stair mouth in plan (gravel is the 6 cm landing under /
beside the 24 cm treads). Visible park path is i ≥ 6, west of x = −23.4.

---

## Sandbox

| mesh | x | z | yaw | y centre |
|---|---:|---:|---:|---|
| `park-sandbox` | −32.55 | −20.40 | 0.18 | `groundHeight + 0.15` |
| `park-sandbox-sand` | −32.55 | −20.40 | 0.18 | `groundHeight + 0.28` |

Open lawn west of the path, south of unique house, east of house
(−38, −22). dx to that house = 5.45 m (outside the 8 m box).

---

## Wire-up (later pass)

In `createStudio`, after roads:

```js
import { addParkFill } from "./fill-park.mjs";
// ...
addRoads(scene, { THREE, groundHeight });
addParkFill(scene, { THREE, groundHeight });
```

Do not paste into `main.mjs` from this note.

---

## What should read in screenshots

| go | expect |
|---|---|
| `park` (−28, −20, yaw −0.8) | sandbox + lantern 2 in the near west lawn; south-edge benches; west hedge; house (−38, −22) still clear |
| `stairs` (−18, −14) | lantern 0 west of the flight; gravel leaving the top landing toward the houses; no hedge across the treads |
| spawn (−20, −26) | path benches 10/11 and gravel underfoot; unique house genkan still open |

---

## Out of scope

- Do not edit `catalog.mjs`, `main.mjs`, `scout.mjs`, or `map.mjs`
- Do not plant benches inside the five house boxes
- Do not run hedges across the stone stairs
- Do not unique-mesh a bench, lantern, or sandbox
- Do not add HUD, labels, or `TorusGeometry`
