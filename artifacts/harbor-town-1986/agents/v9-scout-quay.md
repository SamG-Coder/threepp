# v9 scout — `quay`

Still: `C:\ThreeBrowser\artifacts\harbor-town-1986\quay-v9.png`  
Camera (`scout.mjs` `LANDMARKS.quay`): `{ x: 6, z: 87.2, y: 3.15, yaw: 0.06, pitch: -0.22 }`  
Look: +Z south, ~12.6° down, eye 3.15 m (1.5 m above cap `y = 1.51`). Standing on the seawall line (`addQuayEdge` wall `z = 88.35`), looking into the basin.  
No source edits.

**Score 2/10.** The raised pose finally clears the cap (v7–v8 were willow interiors or a grey wall card). What it shows is a pond of untextured boxes, hanging willow mush, a paper water sheet, and a hard sky lip. Amihama does not read as a 1986 fishing quay from this still.

---

## Frame (what the pixels actually are)

| band | contents |
|---|---|
| top ~30% | flat overcast sky, no cloud, no far shore |
| upper-left / upper-centre | lime weeping-willow isosurface, grey trunk through the middle |
| far right | second willow, cut by the frame |
| mid | navy water plane, empty from centre-right to the horizon |
| lower-centre | stepped grey **BoxGeometry** hull + cabin + thin mast |
| left | more grey steps, a dark green cube, another mast |
| right mid | brown deck slab + grey cabin + mast, willow over it |
| bottom ~18% | featureless grey dock / cap strip — the only shoreline |

No workers, lines, fenders, ladders, tires, foam, ripples, reflections, or distant land.

---

## Water vs block boats

Two live boat systems sit in this look: `fill-quay.mjs` (seven hull/keel/deck/cabin/roof boxes, four with masts, `z 94–108`) and `fill-world.mjs` `addQuayBoats` (six more 2.2×0.85×7.4 hulls at `y = 0.05`, `z 97–106`). From `y = 3.15` they are **Minecraft docks**, not boats.

- Centre mass is a two-step grey prism (long hull, cube cabin on top, black stick mast). Overcast lighting kills the white/brown paint; it reads as untextured concrete.
- Left: L-shaped grey platforms plus a dark green cube (green hull or net pile). Same box language.
- Right: brown timber **deck** of a `fill-quay` boat (`deck` `0x8a7048`) with a grey cabin — the only colour cue that these are meant to be vessels. From this pitch you see the lid, not a hull in water.
- `addQuayBoats` seats hulls at **`y = 0.05`**, ~33 cm above the water surface (`y = −0.28`). Those boxes sit *on* the sheet, not *in* it. Keels do not cut a waterline.
- No sheer, stem, gunwale, gunnel, or cabin windows. Beam ~2 m at 8 m range is a shoebox.
- Duplicate fleets stack in the same basin (e.g. fill-quay `(−2.4, 95.4)` vs fill-world `(8, 97)` / `(−8, 102)`), so the stepped grey lumps may be two boats occupying one silhouette.

A Kanagawa fishing quay at 15:20 on a Saturday would show hulls with freeboard, wet sides, and a mooring gap. This still shows **grey furniture parked on a blue floor**.

---

## Willow occlusion

Willows are **in the water**, not on the apron. Live `INSTANCES`:

| pose | dist from camera `(6, 87.2)` | in frame |
|---|---|---|
| `(−6, 98)` yaw 1.2 | ~12 m W, 11 m S | hanging lime mass + trunk, upper-left / centre |
| `(12, 99)` yaw 0.5 | 6 m E, 12 m S | same canopy, fills the look |
| `(32, 97.5)` yaw 0.2 | 26 m E, 10 m S | right-edge foliage |
| `(−28, 97)` yaw 0.35 | 34 m W | mostly off-left |

Canopy **12 × 12 m** (`agent 45`). Camera is inside that radius of `(12, 99)` and `(−6, 98)`. The unique is a melted lime isosurface (v6–v8 language); v9 only moved the lens *up*, not *out* of the trees.

Agent 45 rule was **no willow on the seawall; trunks on dock `z ∈ [80, 86]`**. Live poses are `z 97–99` — south of the water seam (`z = 88`). They read as trees growing in the basin and they **eat the sky and the far boats**. v7 was 100% willow wall; v8 still hid the water; v9 trades a wall of leaves for a hanging curtain over box boats.

---

## Exposed world edges

Water overlay from `addQuayEdge`: `PlaneGeometry(112, 44)` at `(4, −0.28, 111.2)` → **z = 89.2 … 133.2**, **x = −52 … 56**.  
`GROUND.water` is smaller: `x −50…55`, `z 88…120`, `y −0.4`.

From `z = 87.2` the far lip is **46 m** (overlay) / **33 m** (`GROUND.water` maxZ). Fog 40–140 does not kill a 46 m horizon. The still’s south edge is a **ruler-straight navy/sky cut** across the full width. No opposite shore, breakwater, breakwater piles, ships, or Suzume ridge. The bay is a finite card.

East (right) is empty sheet to the same lip. West (left) is grey boxes then the same lip. No land returning. The world ends as a rectangle of water.

Sky is a single grey-blue fill — no horizon haze, no sun disk, no cloud. Combined with the hard water edge it reads as a studio cyclorama, not Sagami Bay.

---

## Empty static water

~45% of the still (centre-right through the horizon) is **one unshaded navy plane**.

- `waterTop` `0x3d5c6e` roughness 0.22 should spec; in this overcast shot it is dead matte navy (closer to `waterDark` `0x1a2e3c`). No sun glitter, no sky reflection, no wake.
- No foam line at the wall, no chop, no UV, no vertex displace.
- No mooring buoys, running hawsers, dinghies, or debris between the centre box and the right brown deck. The gap is unused basin.
- Two water planes (surface −0.28, dark −0.58) exist to give thickness when grazing the wall. This camera looks *down onto* the top plane, so the thickness cheat does nothing. You see a sheet, not a volume.

Empty water is the dominant subject. The landmark is named quay; the photograph is **open ocean with three shoeboxes**.

---

## Shoreline

Camera `z = 87.2` is **1.15 m north of the seawall centre** and **~2 m north of the south face** (`faceZ = 89.25`). `y = 3.15` is **1.64 m above the cap**. Pitch −0.22 looks over the wall, so the vertical face, wet band, tires, and ladders are **under the near clip / behind the look**.

What remains of the land/water meeting:

- A **grey horizontal bar** across the bottom (dock slab `y = 0.06` and/or cap `0x9a958c`). No coping joint, no painted safety line, no bollard in frame (bollards sit at `z = 87.72`, `y = 1.83` — beside/below the lens).
- Hard 90° meet of grey slab and navy plane. No wet band (`0.42 × 0.05` strip on the south face, invisible from this height).
- No cap overhang, no tire fenders (they hang on `faceZ + 0.13`), no ladder rails.
- No people, crates, or coils on the near apron. Clutter from `fill-quay` lives at `z 76–86` **behind the camera**.

v8 at least showed a cap, a black bollard, and a wall. v9 trades that for an aerial of the sheet. The shoreline is a **paper edge**, not a gravity seawall.

---

## vs v7 / v8

| still | pose | result |
|---|---|---|
| `quay-v7` | lower, into willows | 100% lime canopy over a grey cap; no water |
| `quay-v8` | still on the apron | grey cap + one bollard; willows as a hedge south of the wall; no boats |
| `quay-v9` | `{6, 87.2, y: 3.15}` | over the wall: water yes, boats as boxes, willows still in the upper third, world lip, empty sheet |

Raising Y and pushing Z to the seam solved the “camera inside a tree on the dock” failure. It did not solve planting willows at `z ≈ 98`, box hulls, a 44 m water card, or a shoreline you cannot see from 3 m up.

---

## Failures (priority)

1. **Willows in the basin** `(−6, 98)`, `(12, 99)`, `(32, 97.5)` — 12 m canopies on the look. Pull trunks north of the cap (`z ≤ 86`) or drop them from this shot’s frustum.
2. **Box boats / double fleet** — `fill-quay` + `fill-world` `addQuayBoats`. Primitive boxes from `y = 3.15` are cargo, not hulls. Seat in the water (`y ≈ −0.3`), one set only, or unique hulls.
3. **Empty static water** — unused right half; no chop, no reflection, no mooring.
4. **Exposed south/east lip** — 112×44 plane dies at ~46 m as a straight horizon. Extend + fog, or put a breakwater / far shore in the look.
5. **Shoreline not in frame** — `y = 3.15` at `z = 87.2` skips the face, wet band, tires, ladders, bollards. Drop to eye (~1.62) a few metres north (`z ≈ 84`) if the card is meant to be a quay, not a seaplane.

Quay is still a failed camera for the district: we can now *see* the basin, and the basin is a toy.
