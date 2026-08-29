# v9 scout — `street-west`

Visual scout only. Do **not** edit sample source from this note.

Shot: `C:\ThreeBrowser\artifacts\harbor-town-1986\street-west-v7.png`  
No `street-west-v8.png` / `street-west-v9.png` on disk. `command.json` `t17` (sakae / street-east / hill / park / town / quay / seawall / yokobori / bus) **omitted** this landmark, so the v9 tour never reshot it.

Live `scout.mjs` `LANDMARKS["street-west"]`:

```js
"street-west": { x: 22, z: 2.0, yaw: -Math.PI / 2 - 0.1, pitch: -0.08 },
```

Eye `1.62`. `PerspectiveCamera(55, …)` → vFOV 55°, ~16:9 hFOV **85.5°**, half-hFOV **42.75°**.  
Convention: `+X` east, `+Z` south. `yaw = 0` looks +Z (south). Look XZ `(sin yaw, cos yaw)`.

v6 used `{ x: 30, z: 2.0, yaw: -π/2 - 0.16 }` (agent 14 / 62). v7 composition matches the **live** `x = 22` seat, not the old `x = 30` box.

---

## Camera

`yaw = −π/2 − 0.1` ≈ **−100.3°** from +Z → look is **due west + 5.7° north**, 4.6° down.

| | |
|---|---|
| Eye | `(22.00, 1.62, 2.00)` |
| Look XZ | `(−0.9950, −0.0998)` |
| Right XZ | `(+0.0998, −0.9950)` (north, slight east) |
| Left | south row + S sidewalk (`z ≈ 5…10`) |
| Right | north row + N sidewalk (`z ≈ −12…−3`) |
| Centre | carriageway running −X (west) |

North bias puts Starlight Arcade on the hero-right and shoves Kissa Miharu into the left near clip. Agent 62’s “pull `x` to `26` or `z` to `1.2`” was the beige-plane fix; **`x = 22` overcorrected**.

---

## 1. Camera clipping buildings

v6 left third was a featureless beige `south fill` / yokobori plane (score 2/10, camera-in-a-box). v7 replaced that plaster with a reconstructed hull — and planted the eye **against** it.

### Kissa Miharu in the near clip (left)

`kissaten` `(14, 8.6)`, `yaw π`, `realWidth 6.0`, `realDepth 6.4`.

| | x | z |
|---|---:|---:|
| envelope | 11.0 … 17.0 | 5.4 … 11.8 |
| NE corner (street + east jamb) | 17.0 | ≈ 5.4 |
| camera | 22.0 | 2.0 |

NE corner vs eye: **Δ = (−5.0, +3.4)**. Forward ≈ **4.6 m**, right/fwd ≈ **−0.84** (left, inside hFOV). That is shop-front distance, not street-west distance. The brown photo-hull (mug poster, 洗 fascia, scalloped eave) fills the left third. Pole `(16, 5.6)` stands in the same bay and reads as a silver mast through the glass.

Not inside the AABB, but the near plane is a wall. This is the same class of bug as v6 `sakae` vs barber and v6 `street-west` vs beige massing.

### Zelkova crowns (top-left / top-right)

Winter colonnade on `z = ±6.7`. From `(22, 2)`:

| tree | Δxz | dist | where in PNG |
|---|---|---:|---|
| `(12, 6.7)` | (−10, +4.7) | 11.0 m | top-left blob, ahead-left |
| `(24, 6.7)` | (+2, +4.7) | **5.1 m** | behind-left; canopy in camera |
| `(16, −6.7)` | (−6, −8.7) | 10.6 m | top-right blob |
| `(26, −6.7)` | (+4, −8.7) | 9.6 m | behind-right |

v7 has brown organic caps cutting both top corners. `(24, 6.7)` at 5.1 m is the left one: the camera sits in the crown, not on the carriageway.

### Cassette / east-cap slab (far right)

`cassette-shop` `(17.8, −8.5)`, span **14.7 … 20.9**. East face is **1.1 m west** of the camera’s easting, 10.5 m north. Forward is small; the east gable should be the first north-row return. v7 right edge is a **dark unlit plane** (records hull failing as a side, or `south fill` east cap `(28, −8.5)` / gap-fill bay). Arcade’s mosaic is the first *readable* north shop because cassette does not read as a shop.

### Landmine beside the eye (not in frame)

`kei-van` instance `(22, −3.15)`, yaw `−π/2`: Δ `(0, −5.15)` → forward **≈ 0.51 m**, right **≈ 5.1 m**. `abs(right/fwd) ≈ 10` → **out of hFOV**, riding the north lane next to the camera. Any extra north yaw puts a loaf in the near clip.

`civilian-hiro` `(22, 6.9)` is 4.9 m due south (left-near if yaw eases south).

### Fix (camera only)

Do not keep `x = 22`. Do not go back to `x = 30`.

```js
"street-west": { x: 26, z: 1.2, yaw: -Math.PI / 2, pitch: -0.08 },
```

- `x = 26` — ~9 m east of kissa east (17.0), ~5 m east of cassette east (20.9), 4 m east of van instance `x = 22`.
- `z = 1.2` — middle of the travel lanes (`z = −6…6`), off both curbs and off the `(24, 6.7)` crown.
- yaw **due west** — drop the `−0.1` north bias so arcade is a 3/4 on the right, not a billboard, and kissa sits mid-left instead of on the near plane.

Reshoot as `street-west-v9`. Keep `street-west` out of the next tour until that pose is in `scout.mjs`.

---

## 2. Kissa / arcade facing

Both street-facing yaws are **correct**. The clip is distance, not a backwards shop.

| id | catalog | yaw | faces | should face |
|---|---|---|---|---|
| `kissaten` Kissa Miharu | `(14, 8.6)` | `π` | north (−Z), toward asphalt | street (north) |
| `you-arcade` Starlight | `(8.4, −8.5)` | `0` | south (+Z), toward asphalt | street (south) |
| `barber-shop` Haru | `(6, 8.6)` | `π` | north | street |
| `cassette-shop` records | `(17.8, −8.5)` | `0` | south | street |
| `pharmacy` | `(0, −8.5)` | `0` | south | street (north row — not a south-row bay) |

Scout shop cameras agree: `kissa {14, −2.5, yaw 0}` looks south at Miharu; `arcade {8.4, 8, yaw π}` looks north at Starlight. `kissa-v8.png` shows the north timber front (cream 港風, mug poster) with Haru’s yellow chairs on image-right — same hull as the left wall of `street-west-v7`.

In this west look:

- **Left (south):** Miharu’s *north* facade at 3/4, not an east-facing front. Cardinal wrap still paints 000 jewellery onto the east return (scalloped signs). That is bake, not a `yaw` error. Do **not** set kissa yaw to `±π/2`.
- **Right (north):** arcade *south* fascia is readable — `ファミリーゲームセンター` / `SPACE INVADER '86`, mint mosaic, glass with 休業 posters. East return is the mosaic gable (090). Agent 40: arcade `yaw-270` is a duplicate of 090 (クラブ・ゲ on the west). From street-west we see the **east** wall, so that duplicate does not face us. Facing of the unique is still `yaw 0`.

Galaxy in `kissa-v8` (left alley, vertical 銀河酒場) is `yokobori-bar (26, 16)`, yaw `−π/2` (faces west). Out of the v7 west frustum (behind / right-rear of `x = 22`).

---

## 3. Vans

`kei-van` unique + five `INSTANCES`. Hull is still the agent 44 **FAIL**: rectangle carve of a cab-only 270 against a full 090, visual length ~1.4 m not 3.2, no wheels, loaf hovers.

| pose | yaw | vs camera `(22, 2)` | in `street-west-v7` |
|---|---|---|---|
| unique `(14.5, 3.4)` | `−0.18` (almost +Z) | fwd **7.3 m**, 2.1 m left | **hero loaf on the zebra**, rear 33 plate, blue stripe, cargo melted |
| instance `(22, −3.15)` | `−π/2` (west) | fwd 0.5 m, 5.1 m right | **out of frame**, beside the eye |
| instance `(32, 3.4)` | `−0.12` | behind (+10 m east) | out |
| instance `(−8, 3.35)` | `π/2` | ~30 m west, on-axis | far white speck |
| instance `(−22, −3.2)` | `π/2` | ~44 m west, north lane | vanishing-point speck |
| instance `(−30, 3.35)` | `π/2` | ~52 m west | fog |

v6 (`x = 30`) showed **two** loafs: unique on the zebra and `(22, −3.15)` as the right-curb Carry in front of the arcade. Pulling the camera to `x = 22` hid the north-lane instance by standing next to it.

Unique `x = 14.5` is the same easting as Kissa Miharu. `yaw −0.18` parks it across the south travel lane / zebra, so every west look and every `kissa` look hits a potato. That is placement plus hull. Moving `street-west` does not fix `kissa-v8`.

Do not add more Carry clones on Sakae until the 8-view `custom` hull exists. If this landmark must see a vehicle, keep **one** in the north lane around `x ≈ 8…10`, `z ≈ −3.2`, yaw `−π/2`, and take the unique off `x = 14.5`.

---

## 4. South-row gaps

South row is supposed to be the **continuous right wall** when walking east, left wall when looking west. Live catalog is three bays on `z = 8.6`, `yaw π`:

| shop | x | w | span | gap after |
|---|---:|---:|---|---:|
| `flower-shop` Midori | −10 | 6.6 | **−13.3 … −6.7** | **9.6 m** to barber |
| `barber-shop` Haru | 6 | 6.2 | **2.9 … 9.1** | **1.9 m** to kissa |
| `kissaten` Miharu | 14 | 6.0 | **11.0 … 17.0** | Yokobori mouth (`x ≥ 18`) |

West of Midori: sidewalkS **−40 … −13.3** = **26.7 m** of empty south curb (the `street-east` grey slab, still live).

Agent 26 five-bay wall (never planted): party gaps **1.5–2.5 m**, frontage −26.5 … 15.3, barber at **−14.7**, Midori at **−6**, pharmacy on the **south** at **2.8**, reserved east bay at **11.9**. Live world did the opposite:

- Midori sat at `−10` not `−6`.
- Barber sat at `+6` (across from the arcade) not `−14.7`.
- Pharmacy went to the **north** row `(0, −8.5)`.
- Kissa occupied the reserved east bay.

`addSouthFill` / `fill-world` `addSouthMassing` boxes sit at **`z = 18.5…30`** (backing ranks) and north-row end caps at `z = −8.5`. They do **not** plug `z = 8.6` lots. From street-west they are far-left grey cubes behind the three hulls, not party walls.

### What v7 actually shows on the left

West-looking, near → far, south curb:

1. **Kissa** — near-clip front (see §1).
2. **1.9 m slit** to Haru (reads as a black vertical, Hiro `(10, 6.8)` / pole `(6, 6.4)` in it).
3. **Haru barber** — cream 2F, torn gable, yellow chair colour. Receding.
4. **9.6 m vacant lot** — asphalt + sky between barber east (9.1) and nothing until Midori west (−6.7). This is the hole. Mint mass further down the left is Midori’s east return, isolated, same language as `street-east`’s “one gable in a field.”
5. **26 m empty** west of Midori — fog / Route 16 T. Hardware / tobacco are the *north* closer; they do not fill this side.

North curb (right) is the denser wall (arcade → 1.1 m slit → pharmacy → 3.0 m Yaoya–pharmacy gap-fill → Yaoya → soba → tobacco). Street-west therefore reads as **arcade street with a kissa billboard**, not as a two-sided Sakae.

Until south-row unique shops exist (`yamaguchi-denki`, `minato-sakaya`, `horiuchi-tokei`, `sato-sakana` — agent 58 / 62), anonymous **`z = 8.6`** boxes in the 9.6 m barber–florist hole and the −13.3…−40 west walk would do more for this still than another backing cube at `z = 20`. Depth ~7 m, height 7.4–8.6 m, 0.12 m air off Midori and Haru. Do not put them at `z = −8.5` (already gap-filled) and do not slide kissa.

---

## Verdict

`street-west-v7` is **not** the v6 camera-in-a-box. It is **kissa-in-the-near-clip + Carry loaf + south-row missing lots**. Facing of kissa (`π`) and arcade (`0`) is right. The landmark seat is wrong (`x = 22` too west, `z = 2.0` too close to the south wall, yaw north-biased). No v9 still exists until `go('street-west')` is in the tour after the camera moves.

Score **4/10** (v6 was 2/10). Do not ship this pose as the east-mouth hero.

| rank | action |
|---|---|
| 1 | Move landmark to `{26, 1.2, yaw: −π/2, pitch: −0.08}`. Reshoot `street-west-v9`. |
| 2 | Take unique Carry off `(14.5, 3.4)` so `kissa` and this look share a clear lane. |
| 3 | Plug south-row **street-line** gaps at `z = 8.6` (9.6 m + west 26.7 m), not more `z = 18` fill. |
| 4 | Leave kissa / arcade yaws. Fix arcade `yaw-270` and Carry 8-view in a reconstruct pass, not here. |
