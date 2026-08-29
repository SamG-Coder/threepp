# 52 — Sakae-dori street fill (lamps, planters, boards, racks)

Shipped: `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-street.mjs`

```js
export function addStreetFill(scene, { THREE, groundHeight })
```

Do **not** edit `catalog.mjs`, `main.mjs`, `scout.mjs`, or `map.mjs` from
this note. Parent wires the import in a later pass.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south. Cheap language
same as `roads.mjs` / skyline: `BoxGeometry` + `CylinderGeometry` +
`SphereGeometry`, `MeshStandardMaterial`, cast/receive shadow, named
meshes, no `Math.random`.

Live `GROUND` (do not change):

| patch | z | y |
|---|---|---|
| asphalt | −8…12 | 0 |
| sidewalkN | −12…−6 | 0.08 |
| sidewalkS | 6…10 | 0.08 |

North shops `z = −8.5`. South shops `z = 8.6`. Travel lanes `z = −6…6`
stay empty.

---

## Why this pass

Agent 41: Sakae from `street-east` is poles and vending on a grey slab.
No 街灯 rhythm, no sidewalk planters, no 新聞スタンド / 琺瑯看板, no
自転車置き場. Ch.1 density at arm’s length is those cheap verticals
between the reconstructed hulls — not another shop.

No `reconstructOrbitAsset`. No catalog rows. Lamps are municipal
concrete, not the existing telephone-pole stills.

---

## Wire-up (parent)

```js
import { addStreetFill } from "./fill-street.mjs";
// createStudio, after addRoads:
addStreetFill(scene, { THREE, groundHeight });
```

Root group name: `sakae-street-fill`. Returns the group.

---

## Kit (metres)

| piece | geometry | size | material |
|---|---|---|---|
| lamp pole | `CylinderGeometry` | r 0.11→0.075, **h = 5.5** | concrete `0x9c9890` r 0.92 |
| lamp base / cap | `CylinderGeometry` | r 0.18 / 0.09 | concrete / dark arm paint |
| lamp arm | `CylinderGeometry` | r 0.038, **len 0.86** | `0x3e4240` r 0.62 m 0.18 |
| globe | `SphereGeometry` | **r = 0.20** | pale `0xe4dfd2`, emissive 0.12 (frosted, not a PointLight) |
| planter | `BoxGeometry` | **0.74 × 0.32 × 0.46** | CMU `0x9a8f80` |
| soil | `BoxGeometry` | 0.62 × 0.07 × 0.34 | dirt `0x3a3228` |
| newsstand | `BoxGeometry` | 0.50 × 1.04 × 0.28 + lid | orange enamel `0xc45a2a` / `0xb8442c` |
| signboard | thin boxes | board 0.64 × 0.90 × **0.04** | cream `0xe4d9c4` + red header `0x8b2c28` |
| bike rails | `CylinderGeometry` | r 0.026, **len 1.42**, h 0.36 | galvanised `0x6a6e70` m 0.55 |

Seat:

```
lamps:    y = groundHeight(x, z)            // pole bottom on the height field
walk kit: y = groundHeight(x, z) + 0.08     // sidewalk slab
```

North lamps: arm toward **+Z** (street). South lamps: arm toward **−Z**.
Globe hangs at the arm tip, ~5.22 m above ground. Overcast 15:20 — no
extra `PointLight` (would punch the steel-blue hemisphere).

---

## 1. Street lamps

Every **~12 m**, both curbs, **x = −40…40**. 8 per curb (ends included).

Telephone poles already on the curb (do not sit on these x):

| curb | z | x |
|---|---|---|
| north | −6.2 / −6.4 | −38, −22, −8, **8**, 18, 28, 38 |
| south | 5.6 / 6.4 | −36, −22, −4, 6, 16, 36, **40** |

Unique `telephone-pole` is south (`−22, 5.6`). Yokobori pole `(18.35, 11.4)`
is off this street.

Grid `x += 12` from −40, then **~2 m** off a known pole x. Two extra
nudges so lamps miss sidewalk kit:

| side | z | x | notes |
|---|---|---|---|
| N | **−6.45** | −40, −28, −16, −4, **6**, 20, 32, 40 | 8 was on a pole; +2 → 10 hits vending `(10.2, −6.7)` so **−2 → 6** |
| S | **6.45** | −40, −28, −16, **−2**, **10**, 20, 32, **38** | −4 on a pole; 8 on bin `(8, 6.6)`; 40 on a pole |

Names: `sakae-lamp-n-${x}-pole|arm|globe|base|cap` (same for `s-`).

---

## 2. Planter boxes (8)

Low CMU + dirt cap. On the sidewalk **in front of shops**, **not** on
the door x. Flank ~2 m. Keep-out: poles, vending, Hiro, bins, booth,
bike racks, lamp x.

| # | x | z | shop | why this bay |
|---|---:|---:|---|---|
| 0 | −32.05 | −6.92 | hardware east of door −34 | bin is on the door at (−34, −6.6) |
| 1 | −24.15 | −6.92 | tobacco east of door −26 | vending west at −28.6 |
| 2 | −14.55 | −6.92 | soba east of door −17 | stairs occupy the west third |
| 3 | −2.20 | −6.92 | pharmacy west of door 0 | bin at (2, −6.6) |
| 4 | 16.25 | −6.42 | cassette west of door 17.8 | south face ≈ −6.1; pole 18; vending 18.5 |
| 5 | −11.45 | 7.05 | flower west of door −10 | bin (−12, 6.6); rack at −8 |
| 6 | 4.20 | 6.88 | barber west of door 6 | pole (6, 6.4); bin (8, 6.6) |
| 7 | 15.50 | 7.10 | kissaten east of door 14 | vending 12.4; booth 16.5 |

Names: `sakae-planter-${i}`, `sakae-planter-soil-${i}`.

Yaoya is already crate-dense (agent 47) — no planter on that door.

---

## 3. Newspaper stands / enamel signboards

Thin boxes on the walk. Three orange 新聞 boxes + three cream 琺瑯看板
(post + plate + red header). Face the street (north yaw ~0, south ~π).

| kind | name | x | z | bay |
|---|---|---:|---:|---|
| news | `sakae-newsstand-0` | −27.55 | −6.72 | Kamimura, between vending and door |
| news | `sakae-newsstand-1` | 2.95 | −6.55 | pharmacy east edge (alt red) |
| news | `sakae-newsstand-2` | 13.35 | 6.95 | kissa, between vending 12.4 and door |
| sign | `sakae-signboard-0` | −18.55 | −6.80 | Nishiya west of door |
| sign | `sakae-signboard-1` | 3.55 | 6.78 | Haru west of door / pole |
| sign | `sakae-signboard-2` | −8.95 | 7.12 | Midori east, north of the south rack |

---

## 4. Bike-rack rails

Low galvanised pair (not inverted-U). Two rails along X, four posts,
steel plate.

| name prefix | x | z | vs the requested pose |
|---|---:|---:|---|
| `sakae-bike-rack-n` | **11.6** | **−6.32** | requested ~`(10, −6.4)`; vending `(10.2, −6.7)` owns that x. 1.4 m rail → 10.9…12.3, 0.25 m east of the machine, still on Starlight’s curb |
| `sakae-bike-rack-s` | **−8.0** | **6.50** | as specified. Flower east face −6.7, pole −4, bin −12 |

---

## Keep-out (already on the walk)

Do not sit on these. The lists above already miss them.

North walk (`z ≈ −6.4…−7.3`):

| what | (x, z) |
|---|---|
| poles | −38/−22/−8/8/18/28/38 at z ≈ −6.3 |
| vending | (−6.8, −5.9), (18.5, −5.4), (10.2, −6.7), (−28.6, −6.7), (−10.8, −6.7) |
| Hiro | (−9.2, −7.3), (8, −6.8) |
| bins | −34/−16/2/22 at z = −6.6 |

South walk (`z ≈ 6.0…7.3`):

| what | (x, z) |
|---|---|
| poles | −36/−22/−4/6/16/36/40 at z ≈ 5.6…6.4 |
| vending | (−31, 6.0), (12.4, 6.8) |
| booth | (16.5, 6.8) |
| Hiro | (−16, 6.8) |
| bins | −12/−24/−4/8/26 at z = 6.6 |

Shop door x = catalog `x` (hardware −34, tobacco −26, soba −17, Yaoya −9,
pharmacy 0, arcade 8.4, cassette 17.8, flower −10, barber 6, kissa 14).

---

## Mesh count

16 lamps × 5 + 8 planters × 2 + 3 news × 2 + 3 signs × 3 + 2 racks × 7
= **125** named meshes. Shared geometries.

---

## What should read in screenshots

| go | expect |
|---|---|
| `street-east` | pale globes every bay on both curbs, not glued to the concrete poles; orange stand at Kamimura; CMU box east of Yamato |
| `sakae` | looking north, lamps on the near south curb (z = 6.45) with arms over the asphalt; barber sign + kissa stand |
| `arcade` | north rack east of the 10.2 vending, lamp at x = 6 not on the x = 8 pole |
| `flower` | south rack at (−8, 6.5), planter west of the door, cream board east |
| `records` | cassette planter west of the door, not inside the shallow hull |

Overcast: globes read as milky glass, not sodium night lights.

---

## Out of scope

- Do not edit `catalog.mjs`, `main.mjs`, `scout.mjs`, `map.mjs`.
- Do not add `PointLight` / `SpotLight` per globe.
- Do not instance telephone-pole stills as lamps.
- Do not plant in `z ∈ (−6, 6)` (lanes) except the lamp bases on the
  curb line at z = ±6.45.
- Do not unique a mamachari for the racks this pass.
