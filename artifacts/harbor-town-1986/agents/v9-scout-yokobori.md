# v9 scout — `yokobori`

Read-only still report. Do **not** edit sample source from this note.

Still: `C:\ThreeBrowser\artifacts\harbor-town-1986\yokobori-v9.png`  
Landmark `yokobori` `{ x: 20.2, z: 10.4, yaw: 0.18, pitch: 0.07 }` (`scout.mjs`; alias `bar` is the same pose).  
`command.json` t17 `go: yokobori` → `yokobori-v9`.

Time lock: Saturday 29 November 1986, 15:20, overcast.  
Convention: `+X` east, `+Z` south. Yaw `0` looks `+Z`.

**Score: 3/10.** Same film-set as `yokobori-v6` / `v7` / `v8`. One reconstructed sakaba glued to a court of unlit brown cubes, dock crates in the walk slot, Amihama still in the vanishing point. Not a 横丁.

---

## Frame (left → right)

| region | what reads |
|---|---|
| Left third | `yokobori-bar` / Galaxy sakaba hull. Vertical 酒場 blade, indigo たこ焼き noren, yellow poster. Timber cladding. The only photoreal façade. |
| Near left, at the bar’s south-west corner | Two **blank brown `BoxGeometry` cubes** (primitive `yokobori crate` from `main.mjs` `addGroundClutter`). No grain, no label, no strap. Sit on `GROUND.alley` like furniture cubes. |
| Centre lane | `vending-enamel` instance `{ x: 21.94, z: 18.6, yaw: −π/2 }`. Readable kit. Stands in open plaza, not in a door niche. |
| Mid-right, occupying the walk | Two reconstructed **`crate-stack`** piles (corrugated harbour crates, ~1.4 × 1.6 × 0.9 m). A third blank wood cube peeks under the near pile (`fill-world` `yokobori crate` at `(22.4, 14.8)` / `(23.1, 14.5)`). |
| Mid / south wall | One **tall unlit brown cube** filling the look (≈ 2-storey, no window, no door, no eave). A second darker cube behind it. Grey cubes on the right jamb. |
| Far right slit | `harbor-warehouse` gable (倉 lettering, corrugated green) at `z ≈ 70`. Next district through the set. |
| Right of the stacks | One `civilian-hiro` clone (`INSTANCES` `{ x: 18, z: 18, yaw: 0.8 }`). Standing in the court, not walking a 4 m lane. |
| Sky / floor | Steel `0x8894a0` background. Brown `GROUND.alley` slab `18…42 × 10…28`. No wet sheen, no centre drain, no cobble from `roads.mjs` `yokobori-cobble`. |

No telephone pole at the mouth (`18.35, 11.4` from agent 10 is not in this frustum). No 赤提灯, no `OPEN 17:00`, no `GALAXY` roof box (cropped or unlit). No opposite-wall snack.

---

## Blank brown cubes vs bar hull

Galaxy is a reconstructed rectangle (`catalog.mjs` `yokobori-bar`, `(26, 16)`, `yaw: −π/2`, `5.2 × 7.6 × 5.5`). Front plane **`x ≈ 23.25`**, façade **`z ≈ 13.25…18.75`**. Mass, noren, and blade still read — same PARTIAL as v5/v6: corners soft, but it is a *shop*.

Everything else that should be the alley wall is **`MeshStandardMaterial` boxes with no albedo still**:

Live in this shot (wired through `addWorldFill` → `addYokoboriMassing` in `fill-world.mjs`):

| name (mesh) | x | z | w × h × d | colour |
|---|---:|---:|---|---|
| yokobori fill | 20.2 | 22.0 | 5.0 × 6.8 × 5.2 | `0x4a3a32` |
| yokobori fill | 32.4 | 16.4 | 5.4 × 7.4 × 5.6 | `0x6a5c50` |
| yokobori fill | 38.6 | 16.2 | 5.2 × 6.6 × 5.4 | `0x3a4a3c` |
| yokobori fill | 32.0 | 24.0 | 5.6 × 8.2 × 5.4 | `0x5a5048` |
| yokobori fill | 22.0 | 27.2 | 8.4 × 7.6 × 4.2 | `0x4a4640` |

The centre slab is the `(20.2, 22)` box: same height band as Galaxy, **zero shop language**. Overcast `HemisphereLight` + weak west sun (`0xe4ddd2` × 0.34) leaves them as silhouettes against the sky. They do not pick up the timber, noren, or enamel of the hull they stand next to. The contrast is the shot: photoreal left, CSG massing right.

These are **not** the `fill-yokobori.mjs` named izakaya boxes (`yokobori-izakaya-west` cream/green/brown, noren, signboard). See wiring below.

---

## Crate stacks

Three systems occupy the same mouth. They fight.

**1. Reconstructed `crate-stack` (amihama unique, instanced into the alley)**

```
{ asset: "crate-stack", x: 20, z: 14, yaw: 0.2 }   // unique is (−4, 78), 1.6 m tall
{ asset: "crate-stack", x: 32, z: 18, yaw: 0.7 }
```

The `(20, 14)` clone is the corrugated double pile in the **walk slot** (`x ≈ 19.2…22.5`, `z 10…19` — agent 54 keep-out). Harbour cargo, not beer crates against a sakaba. Scale is dock: 1.4 m wide, 1.6 m high. It owns the mid-right third and hides the lane.

**2. Primitive `yokobori crate` in `main.mjs` `addGroundClutter`**

```
stackCrates(20.0, 14.0, 2, 0.42, "yokobori crate");   // 0.58 × 0.48 × 0.52, wood 0x6b5344
stackCrates(20.58, 13.68, 1, -0.18, "yokobori crate");
stackCrates(19.48, 14.32, 2, 0.12, "yokobori crate");
```

Same `(20, 14)` nest as the reconstructed stack. These are the **blank brown cubes** at Galaxy’s near corner. Untextured, unlabelled, overlapping the photoreal pile.

**3. Primitive pair in `fill-world.mjs` `addYokoboriMassing`**

`(22.4, 14.8)` 0.7×0.5×0.62 and `(23.1, 14.5)` 0.7×0.9×0.62. The extra wood cube under the corrugated stack.

**Not in frame (authored, unwired):** `fill-yokobori.mjs` wall-hugging stacks A–D (2–3 high, 0.58×0.48×0.52) and four `yokobori-barrel` drums. Those would sit against izakaya faces, not in the mouth.

Result: a loading-dock still. Beer-crate language (small modules against the west front, south of the vending) is missing. The walk is a cargo island.

---

## Missing awnings / signs

Galaxy carries the only fascia. The massing cubes have:

- no fabric awning / 庇
- no noren
- no hanging enamel
- no vertical blade
- no 赤提灯 (neon-dormant daylight still needs the *object*)
- no door cut, window, or AC box

`fill-yokobori.mjs` already authored two cheap stand-ins that **do not appear** because the file is not called:

| mesh | pose | size | colour |
|---|---|---|---|
| `yokobori-noren` | `(20.1, 19.28)`, y ≈ 2.12 | 1.72 × 1.38 × 0.05 | indigo `0x243056` |
| `yokobori-signboard` | `(21.55, 19.22)`, y ≈ 3.22 | 1.18 × 0.58 × 0.08 | enamel `0x7a3028` |

Agent 54 pass criterion was “noren + signboard readable on the closer box.” v9 fails that test. The west izakaya north face (whether fill-world `(20.2, 22)` or unwired `(20, 21.85)`) is a flat brown card.

Even wiring those two boxes would not match Galaxy; they are untextured cheats. What the still proves: **without any fascia the cubes cannot read as snacks**, so the alley has one shop and a lot.

---

## Alley identity

`TOWN.md`: Yokobori = *narrow bar alley, neon dormant in daylight*, district origin `(24, 22)`, sketch size 28×12.

Live floor (`map.mjs` `GROUND.alley`): **`18…42 × 10…28`** — 24 m east–west × 18 m north–south, colour `0x6a5e52`. A plaza, not a 4 m 横丁. Agent 10 wanted the walk slot `x = 18…22.3` (~4.3 m) with the rest as back-court. v9 still photographs the full court.

Identity failures visible in this still:

1. **You can see the next district.** Warehouse at `z ≈ 70` (look ray from `(20.2, 10.4)` yaw 0.18 lands near `(31, 70)` — `harbor-warehouse` `(36, 72)`). A yokochō hides the harbour until the south gap. The fill-world dead-end `(22.0, 27.2)` `w = 8.4` only covers `x ≈ 17.8…26.2`. The east close (`fill-yokobori` `yokobori-deadend-east` at `(33.9, 27.1)`, `w = 16.2` → `x = 25.8…42.0`) is **not in the scene**.
2. **One hull, no opposite wall.** Lane centre-line `x = 20.2`. Left = Galaxy. Right/south = blank cubes. No second snack (`snack-akane` from agent 58 never planted).
3. **Occupation is dock kit, not alley kit.** Enamel in the plaza, Hiro clone, harbour `crate-stack`. No pole, no wire over the mouth, no drain strip, no chōchin, no cobble read.
4. **Mouth is a yard.** Camera stands on the sidewalkS / alley seam and looks into volume, not into a slot. v5 called this a film-set plaza (2/10). v9 added cubes and cargo; the type did not change.

A 横丁 is: tight lane, two shop walls, stuff hugging those walls, harbour *not* in the first look. This is a sakaba product shot in a brown box canyon with a dock pile.

---

## `fill-yokobori.mjs` is unwired

File exists: `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-yokobori.mjs`  
`export function addYokoboriFill(scene, { THREE, groundHeight })`  
Group name `yokobori-fill`. Named izakaya / shop / dead-end boxes, noren, signboard, crates, barrels.

`createStudio` in `main.mjs` currently:

```
addWorldFill(...)   // includes addYokoboriMassing — the cubes in this still
addQuayFill(...)
addParkFill(...)
addRoute16Fill(...)
addRoads(...)
```

There is **no** `import { addYokoboriFill } from "./fill-yokobori.mjs"` and **no** `addYokoboriFill(...)` call. Same as agent 54’s “wire-up (later pass)” — that pass did not happen. Grep of runtime `*.mjs` only finds the export.

Also unwired (out of this still, same pattern): `fill-south.mjs` `addSouthFill`, `fill-street.mjs` `addStreetFill`.

What v9 is showing is the **fill-world substitute**, not the fill-yokobori kit:

| | `addYokoboriMassing` (live) | `addYokoboriFill` (file only) |
|---|---|---|
| West closer box | `(20.2, 22)` brown 6.8 m | `yokobori-izakaya-west` `(20, 21.85)` brown 6.6 m |
| East court | three brown/green-black cubes | cream + green shops at `x = 32 / 38` |
| Dead-end | `(22, 27.2)` `w = 8.4` — warehouse slit stays | west cream + **east `w = 16.2`** closes `x = 26…42` |
| Noren / sign | none | indigo noren + enamel board on west north face |
| Barrels | none | four rust drums |
| Crates | two wood boxes at `(22.4, 14.8)` | wall stacks A–D, keep-out of the mouth |

Wiring `addYokoboriFill` **on top of** `addYokoboriMassing` would double-plant at `x = 20 / 32 / 38`. Do not paste boxes into `main.mjs` (agent 54). If a later pass wires the file, drop or skip the fill-world yokobori massing first.

Even then: fill-yokobori is still cheap untextured `BoxGeometry`. It can close the warehouse look and hang a fake noren. It cannot stand next to Galaxy without reading as a different species. Alley identity needs either more reconstructed snacks on the opposite wall, or the cubes dressed (awning, fascia, door) until they stop losing to the hull.

---

## Verdict

| check | v9 |
|---|---|
| Galaxy hull readable | **PASS** (PARTIAL potato, fascia survives) |
| Opposite alley wall as shops | **FAIL** — blank brown cubes |
| Awning / noren / sign on fill | **FAIL** — authored in unwired file |
| Crate language = beer crates on walls | **FAIL** — dock `crate-stack` + primitive cubes in the walk |
| 4 m lane, harbour hidden | **FAIL** — 24 m court, warehouse in the slit |
| `addYokoboriFill` in `createStudio` | **FAIL** — file on disk, not called |

v6→v9 delta for this landmark: **none**. Same pixels, same massing path. Score stays 3/10 until the alley is a lane of shops, not a bar plus unlit cubes.
