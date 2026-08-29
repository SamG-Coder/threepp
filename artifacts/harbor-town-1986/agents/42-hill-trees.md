# 42 — Suzume-zaka park trees (oak / willow grid)

Do **not** edit sample source from this note. Parent copies the two
orbit folders, appends two `ORBIT_SUBJECTS`, appends five `INSTANCES`,
moves one skyline box, and reseats trees on the trunk.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Feel: Shenmue Chapter 1 **Sakuragaoka** — stone stairs, timber houses,
one park you turn in, not a forest demo. Original place names.

Convention: `+X` east, `+Z` south, yaw `0` faces `+Z`. `EYE = 1.62`.
`PerspectiveCamera(55, …)`.

Stills read: `artifacts/harbor-town-1986/hill-v5.png` (`go: "hill"`) and
`house-v4.png` (`go: "house"`).

---

## What the stills show

`LANDMARKS.hill` is `{ x: -36, z: -35, yaw: 0.52, pitch: -0.14 }`.
Look ray `(sin 0.52, cos 0.52) ≈ (0.50, 0.87)` — SSE, down the park
toward the stairs and Sakae.

`hill-v5.png`:

- Left: `wooden-hill-house` unique A `(-28, -34)` so close the west
  gable fills the frame (camera is ~3 m west of the west eaves).
- Centre: clipped A/C roofs, the 12 stone treads, grey `0x8894a0` sky.
- Foreground: empty khaki grass. No trunks. No canopy. A 40 × 36 m
  hill with nothing to walk between.
- Right half: a **perfectly planar, untextured, near-black vertical
  wall** from turf to the top of the 55° frame. A cream gable fragment
  peeks around its right edge.

`LANDMARKS.house` is `{ x: -16, z: -20, yaw: -2.43, pitch: -0.12 }`.
Camera stands on the east stair lip looking WNW at A.

`house-v4.png`:

- Foreground: the 6.5 m stair boxes, camera is *in* the flight.
- Mid: A floating on the slope (agent 21 min-corner seat — downhill
  flush, uphill hovering). Hull is the 1324-tri remnant (agent 02).
- Left: another dark slab, house B peeking around it.
- Upper right: a second dark slab sitting on the crest.

Floating / clipped timber is **not** this note (02 + 21). Empty grass
and the black wall are.

---

## The black wall is skyline box #5 — move it

`addSkyline` in `main.mjs` (agent 24 paste, minus the shoulders):

```
{ x: -36.0, z: -24.5, w: 7.4, d: 6.8, h: 9.6, color: 0x68625c }  // #5
```

AABB `x −39.7…−32.3`, `z −27.9…−21.1`. Planted at
`groundHeight + h/2`. `MeshStandardMaterial` `0x68625c`, roughness
0.95. Houses are unlit `MeshBasicMaterial` vertex colours
(`toneMapped: false`), so the same overcast sun (0.34) + hemi (1.42)
renders the box **near-black** against photo plaster.

From the hill camera the south face is 6–10 m ahead, east edge on the
optical axis:

| corner | world | fwd m | screen-right m |
|---|---|---:|---:|
| south centre | (−36.0, −27.9) | 6.2 | 3.5 |
| south-east | (−32.3, −27.9) | 8.0 | **0.3** |
| east face | (−32.3, −24.5) | 11.0 | 2.0 |

`atan(0.3/8) ≈ 2°` — the left edge of #5 *is* the vertical cut in
`hill-v5`. Top of the 9.6 m box is above the frustum, so it reads as a
skyline wall, not a 2-storey neighbour.

It is **not** the ridge plane (`name = "skyline ridge"`, z = −92…−36,
vertex-coloured grass→fog). The ridge never presents a vertical face
to a camera at z = −35 looking *south*. Agent 24’s shoulder boxes were
never pasted.

From the house camera, #5 is the left slab (~16 m, 33–36° left of
centre). The upper-right slab is **#10** `{ x: -15.5, z: -40.0, w: 8.2,
d: 7.0, h: 11.8 }` — bottom at `groundHeight(-15.5, -40) ≈ 6.6 m`,
camera eye ≈ 3.4 m, so it floats.

### Verdict

- **#5: move.** Do not delete the whole `addSkyline` pass. Do not leave
  #5 on the park lawn. It was authored as “west of tobacco / stairs”
  for `sakae-north` (looking −Z from z = 1.5). On the hill it is a
  cardboard wall in the walk.
- New pose: **`x = -48, z = -48`**, same `w d h colour`. Far-rank west
  terminator, north of house E, behind the new oaks. Still in the left
  of `sakae-north`; gone from `hill-v5` and `house-v4`.
- **#10: move z −40 → −48** (`x` stays −15.5). Same job (“north of
  park, east of house”), no longer a hovering slab in `house-v4`.
- **#7 `{ x: -8.2, z: -34.0 }` overlaps house C** (C AABB
  `x −15.1…−5.9`, `z −34.8…−25.2`; #7 `x −11.8…−4.6`,
  `z −37.2…−30.8`). Move to **`x = -1.5, z = -38.0`** (east of C, still
  the yaoya far-rank). Not the `hill-v5` wall; fix it in the same
  touch so C is not a house inside a box.

Keep-out from agent 24 still holds after the moves: stairs, path, and
the five house footprints below.

---

## Reuse oak + willow. No pine this pass.

`texture_2ds_to_3ds` already has the magenta-studio 8-yaw orbits:

| id | folder (source) | stills | catalog metres there |
|---|---|---|---|
| `english-oak` | `samples/texture_2ds_to_3ds/assets/tree/` | yaw-000…315, 45° | 15 × 14 |
| `weeping-willow` | `samples/texture_2ds_to_3ds/assets/willow/` | yaw-000…315, 45° | 12 × 12 |

Copy into the town (harbor `reconstructOrbitAsset` loads
`../assets/${folder}/` from `src/main.mjs`):

```
assets/english-oak/yaw-000.png … yaw-315.png
assets/weeping-willow/yaw-000.png … yaw-315.png
```

`kind: "custom"` → existing `HUMANOID_VIEWS` (8 files). Do **not**
import `ORBIT_SUBJECTS` from `tree-asset.mjs` (that also pulls the
trash can and the studio poses). Do **not** add `TREE_SPECIES`
(agent 32).

Scale **down**. A 15 × 14 m English-park oak has a 7 m canopy radius
and swallows the 8.2 × 7.6 m houses and the 6.5 m stair. Suzume-zaka
is a 40 × 36 m hillside, houses 7.4 m to the ridge. Japanese 1986
residential park trees sit ~8–12 m.

| id | realHeight | realWidth | realDepth | canopy radius |
|---|---:|---:|---:|---:|
| english-oak | **11** | **9** | **9** | 4.5 m |
| weeping-willow | **9** | **7.5** | **7.5** | 3.75 m |

Stills are full summer green. Time lock is 29 November. Live with it
this pass — the empty lawn is worse than a leafy crown. A winter
retake of the same folders is optional later.

**No new pine.** Kuromatsu would be the seasonal evergreen and a
narrower stair-flank, but it needs a new custom-8 unique. Oak + willow
already exist. If willow 2’s 3.75 m droop ever reads as eating the
east treads, that one pose is the pine swap — not a third species now.

Agent 15’s `suzume-zelkova` unique at `(-38, -22)` landed on **house B**.
Superseded by this grid; do not also unique a zelkova.

Reconstruction knobs (only these two subjects; do not lift the town):

- `shape.kind = "custom"`, `forceCount: 8`
- `resolution: 64`, `silhouetteSize: 128`, `mapSize: 256`
- `photoIterations: 4`
- **`hollowCanopy: true`** — `reconstructSubject` does not pass this
  today; without it the canopy fills into a potato (agent 13 / 29)

Seat on the **trunk**, not the 9 m canopy AABB. `footprintSeatY` min of
four 4.5 m corners on this ramp is a 1–2 m Y error and the trunk
hovers or buries. `kind === "custom"` → `groundHeight(pose.x, pose.z)`
(origin). Keep `realWidth` 9 / 7.5 for `realWorldScale`.

---

## Keep-outs (trunks)

User box, slightly wider than the 6.5 m slabs:

```
stairs: x = -20 ± 3.5  →  [-23.5, -16.5]
        z = -12 … -24
```

Actual boxes: centreline x = −20, width 6.5 → x −23.25…−16.75,
z = −12.4 − i×1.05, i = 0…11 → z −12.4…−23.95. Path ribbon
`GROUND.hillPath` / agent 12: x −24…−16, z −36…−12. Trunks stay
**outside** the stair AABB and ≥ 2 m off the path edge
(x ≤ −26 or x ≥ −14 on z ∈ [−36, −12]). Canopies may overhang the
ribbon; they must not sit on the treads.

House footprints = catalog plan rotated, plus 2 m trunk pad:

| id | centre, yaw | plan | AABB (no pad) |
|---|---|---|---|
| A unique | −28, −34, 0.42 | 8.2 × 7.6 | x −33.3…−22.7, z −39.1…−28.9 |
| B | −38, −22, 0.35 | 8.2 × 7.6 | x −43.2…−32.8, z −27.0…−17.0 |
| C | −10.5, −30, −1.35 | 8.2 × 7.6 | x −15.1…−5.9, z −34.8…−25.2 |
| D | −42, −30, 0.70 | 8.2 × 7.6 | x −47.6…−36.4, z −35.6…−24.4 |
| E | −38, −40, 0.20 | 8.2 × 7.6 | x −42.8…−33.2, z −44.5…−35.5 |

`extX = hx|cos yaw| + hz|sin yaw|`, same as agent 30. Kogure
(`15-density`, not shipped) would occupy `x −12.9…−5.5`,
`z −30.5…−23.5` — oak 4 and willow 2 stay east/south of that pad.

Skyline after the moves above is off these AABBs. Spawn
`(-20, -26)` sits on the ribbon; no trunk there.

`GROUND.park` is `x −44…−12, z −48…−16`. Two poses sit on hill grass
just outside that card (oak 3 west, oak 4 east). Height field is
already `PlaneGeometry(120, 200)` — those world points exist.

---

## Grid — 4 oaks, 3 willows

Oaks are the park bones (crest + west lawn + west toe). Willows are
the lower, drooping pair on the stair *shoulders* plus one more at
the toe. **4 : 3**. Not a regular orchard — yaw jitter 0.2–1.1 so the
oak’s dead limb and the willow’s heavy side do not stamp.

### Unique (ORBIT_SUBJECTS)

```js
{
  id: "english-oak",
  folder: "english-oak",
  label: "English oak",
  kind: "custom",
  district: "suzume",
  x: -33.2,
  z: -28.4,
  yaw: 0.40,
  realHeight: 11,
  realWidth: 9,
  realDepth: 9,
},
{
  id: "weeping-willow",
  folder: "weeping-willow",
  label: "Weeping willow",
  kind: "custom",
  district: "suzume",
  x: -27.2,
  z: -25.2,
  yaw: 0.85,
  realHeight: 9,
  realWidth: 7.5,
  realDepth: 7.5,
},
```

### Instances

```js
{ asset: "english-oak",     x: -26.5, z: -43.5, yaw: -0.22 },
{ asset: "english-oak",     x: -44.0, z: -14.8, yaw:  0.58 },
{ asset: "english-oak",     x:  -4.2, z: -41.0, yaw:  0.18 },
{ asset: "weeping-willow",  x: -13.2, z: -19.5, yaw: -0.62 },
{ asset: "weeping-willow",  x: -31.5, z: -15.8, yaw:  1.12 },
```

### Why each pose

| # | asset | x, z, yaw | role | vs keep-outs |
|---|---|---|---|---|
| O1 unique | oak | **−33.2, −28.4, 0.40** | West lawn. Replaces #5 in `hill-v5`: 7 m SSE of the hill camera, 18° right of centre, 11 m tree in the right third. Frames stairs + town instead of a black wall. | Dist A 8.1 m (wall ~5.3, clearance 2.8). B 8.0 m. D 8.9 m. Stairs AABB 10.6 m. Path 8.8 m west of x = −24. |
| O2 | oak | **−26.5, −43.5, −0.22** | Crest, north of A, west of #10’s new pad. Behind the hill camera. Mass for `sakae-north` / `town`. | 4.4 m north of A’s north wall; canopy just kisses the uphill eaves. E 12 m. |
| O3 | oak | **−44.0, −14.8, 0.58** | SW toe, downhill of B, west skyline from Sakae. 1 m west of `GROUND.park`. | Dist B 9.4 m. Stairs 20 m west (z is in the stair band, x is not). |
| O4 | oak | **−4.2, −41.0, 0.18** | NE crest, east of C / kogure pad, north of #7’s new pad. East hill was bald from `house` / sakae. | Dist C 12.7 m. #7-moved ~8 m. Stairs 16 m east. |
| W1 unique | willow | **−27.2, −25.2, 0.85** | West stair *shoulder*, 1.2 m north of the stair AABB, 7 m west of spawn. Droop toward the ribbon, not the treads. Beside you at spawn, mid-left of the hill look at 13 m. | x = −27.2 vs −23.5 = 3.7 m west of the user box. Path 3.2 m; 3.75 m canopy overhangs the gravel ~0.6 m. A 8.9 m. |
| W2 | willow | **−13.2, −19.5, −0.62** | East stair shoulder, mid-flight. Spawn / stairs landmark: tree left of the treads. Hill look: 25 m, 26° left. | x = −13.2 vs −16.5 = 3.3 m east of the user box. Canopy west edge −16.95 — over the east *shoulder* (tread east lip −16.75), not the walking stones. C 10.8 m. Skyline #2 5.5 m. |
| W3 | willow | **−31.5, −15.8, 1.12** | Downhill west, above sidewalkN (z = −12). Toe willow as you leave the stairs toward Route 16. | Dist B 9.0 m. Stairs 8 m west. |

Clearance test (trunk vs user stair box `x=-20±3.5, z=-12…-24`):

| pose | in x-band? | in z-band? | inside box? |
|---|---|---|---|
| O1 (−33.2, −28.4) | no | no | no |
| O2 (−26.5, −43.5) | no | no | no |
| O3 (−44.0, −14.8) | no | yes | **no** (x) |
| O4 (−4.2, −41.0) | no | no | no |
| W1 (−27.2, −25.2) | no | no | no |
| W2 (−13.2, −19.5) | no | yes | **no** (x) |
| W3 (−31.5, −15.8) | no | yes | **no** (x) |

No trunk is inside a house AABB. Closest: O1–B 8.0 m centre (2.8 m
wall). O1 is the one that has to hold — if a later house instance
slides into that lawn, push O1 to `(−34.5, −29.0)`, not onto the path.

Do not instance more than these five. Eight trees on a 40 × 36 m hill
is a park; twelve is a copse that hides Sakae from `hill`.

---

## Skyline paste (only the three rows that change)

In `addSkyline`’s `blocks` array:

```js
{ x: -48.0, z: -48.0, w: 7.4, d: 6.8, h: 9.6, color: 0x68625c }, // was -36, -24.5  (#5, hill-v5 wall)
{ x:  -1.5, z: -38.0, w: 7.2, d: 6.4, h: 11.2, color: 0x6e6862 }, // was -8.2, -34.0 (#7, off house C)
{ x: -15.5, z: -48.0, w: 8.2, d: 7.0, h: 11.8, color: 0x625e58 }, // was -15.5, -40.0 (#10, house-v4 slab)
```

The other seven boxes and the ridge stay.

---

## Verify

Re-run scout (bump `command.json` `id`):

```json
{"id": "t42", "shots": [
  {"go": "hill", "screenshot": "hill-v6"},
  {"go": "house", "screenshot": "house-v5"},
  {"go": "spawn", "screenshot": "spawn-trees"},
  {"go": "sakae", "screenshot": "sakae-north-trees"}
]}
```

Pass:

- `hill-v6`: **no black wall**. O1 in the right third, A still left,
  stairs and Sakae readable through the gap. Grass is a park, not a
  putting green.
- `house-v5`: no left-wall #5, no floating #10. W2 east of the
  treads. A still the subject.
- `spawn-trees`: W1 over the right shoulder / west gravel; treads
  clear; 3 s of `W` does not walk through a trunk.
- `sakae-north-trees`: west end is canopy + a far muted box at
  z = −48, not a near cardboard face.

Fail: any trunk in `x=-20±3.5, z=-12…-24`; O1 overlapping A or D;
#5 still at `z=-24.5`; a 15 m oak scaled from the tree sample
metres; `TREE_SPECIES` in the town sources.

---

## Parent checklist

1. Copy `texture_2ds_to_3ds/assets/tree/*.png` → `harbor_town_1986/assets/english-oak/`.
   Copy `…/willow/*.png` → `…/assets/weeping-willow/`.
2. Append the two unique subjects. Append the five instances. Counts:
   **4 oaks, 3 willows**.
3. `reconstructSubject`: custom trees get `hollowCanopy: true`,
   `resolution: 64`, `silhouetteSize: 128`. Origin-seat, not canopy min.
4. Move skyline #5 / #7 / #10 as the three-row paste. #5 is the
   `hill-v5` wall.
5. Do not add a pine unique. Do not add `TREE_SPECIES`. Do not instance
   `wooden-hill-house` further. Do not edit sample source from this note.
