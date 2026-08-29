# v9 scout — `sakae` (`sakae-v9.png`)

Visual QA only. Do **not** edit sample source from this note.

Shot: `C:\ThreeBrowser\artifacts\harbor-town-1986\sakae-v9.png`  
Landmark `sakae` in `scout.mjs`: `{ x: 0, z: 11, yaw: Math.PI, pitch: 0.04 }`  
South sidewalk, looking **north** across the zebra at the north row (Yaoya / 港町薬局 / Starlight Arcade). Command `t17`.

Stills for the three façades: `assets/pharmacy/yaw-000.png`, `assets/greengrocer/yaw-000.png`, `assets/you-arcade/yaw-000.png`.  
Pipeline on this run (`main.mjs` `reconstructSubject`): rectangle shops `photoIterations: 0`, `resolution: 48`, `silhouetteSize: 96`, `mapSize: 128` (unused). Display material is `MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide })`. Humanoid / `custom` / `realHeight < 2.2` drop to `32³` / 64 px silhouettes and keep `photoIterations: 4`.

---

## Score

The landmark is still the pharmacy, and the pharmacy is still a mint sponge with sky in it. Three identical Hiros occupy the zebra axis. South-curb zelkovas sit 4 m in front of this camera as brown lollipops. Gap-fill cubes read as black shop-backs through every hole. Enamel vending is a tiled 32³ smear. Road paint z-fights the height field.

Not a beauty still. Do not reshoot `sakae` until the ranked list below moves.

| # | defect | in this PNG | severity |
|---|---|---|---|
| 1 | Pharmacy holes | Sky / black through 2F sash, mortar disc, 1F windows, west party wall | **blocker** |
| 2 | Identical Hiros | Three same blazer A-stances: one fills the near third, two stand on the zebra | **blocker** |
| 3 | Tree lollipops | Brown stick + brown disc over Yaoya and in the near-right third | **blocker** |
| 4 | Black shop-backs | Unlit `0x6a6560` cubes behind / between shops, also through the holes | high |
| 5 | Melted signs | 「港町薬局」 readable around a void; HARU / mortar gone; arcade fascia mush; Yaoya noren mush | high |
| 6 | Vending tiling | Cream/red box at Yaoya is a button-grid tile, not 自動販売機 | mid |
| 7 | Road moire | Asphalt plane + height field coplanar at `y = 0`; yellow dashes through the zebra | mid |

Honourable, not ranked: Haru barber (`x: 6, z: 8.6`) is a white potato in the near-right clip (camera is **inside** its north mass). White Carry instance `(-8, 3.35)` is a cab loaf on the left curb. Phone-booth instance `(8.6, -6.6)` is a brown egg under the arcade tree. Steel bin unique `(-12, 6.6)` is a grey cylinder, fine.

---

## 1. Pharmacy holes — **FAIL (worst hull, same as v5)**

Still `pharmacy/yaw-000.png`: solid mint 2F tile box, open sash with curtains / calendar / plant, rusty AC, roof bucket, mortar-and-pestle enamel, 「港町薬局」, 昭和61年創業 HARU PHARMACY 1986, packed 1F windows, red 薬 noren. It is a **closed box** with one open window, not a ruin.

Mesh in `sakae-v9` (centre, on the zebra axis, catalog `(0, −8.5)` yaw `0`):

- Through-holes at the **mortar disc**, the **2F sash**, the **2F right of the sash** (AC/curtain bay), **both 1F shop windows**, and the **west party wall**. Sky and the dark gap-fill cube show through the building.
- West bay is chopped; the hull does not meet Yaoya. East bay melts into the arcade slot.
- Roof is a chewed sponge. No tiles, no ridge, no eaves, no bucket, no antenna.

Cause is still silhouette intersection + Laplacian, **not** photo-carve (`photoIterations` is already 0). Open 2F interior in yaw-000 disagrees with a solid 090 gable, so the visual hull punches the sash to air. A ¾ `yaw-270` (if still the shopfront transplanted onto the left wall) shears the west-south corner where the mortar sits.

**File-level fix lead — `main.mjs` material / reconstruct, not more clones.**

- `reconstructSubject`: keep `photoIterations: 0` on rectangle. Raise `resolution` / `silhouetteSize` on `pharmacy` only (48/96 is why thin fascia becomes a hole). Do **not** bump `forceCount`.
- Stop treating an open interior window as a silhouette void: opaque glass in the still, or a post-carve cap.
- `MeshBasicMaterial` + `DoubleSide` is why a hole is a black tunnel (you see the inner sheet with cake-slice back colours). `FrontSide` would at least not draw the interior; a lit `MeshStandardMaterial` would stop the unlit/lit mismatch with gap-fill (defect 4).
- `mapSize: 128` is still computed and discarded. Binding the bake will not close holes.

Catalog pose is fine (`x: 0, z: -8.5`, south face on paper `z ≈ −4.7`). Do not slide the shop to hide the sponge.

---

## 2. Identical Hiros — **FAIL (clone army in the beauty frustum)**

One unique `civilian-hiro` in `ORBIT_SUBJECTS`: `(-9.2, -7.3)`, yaw `π` (Yaoya doorway, facing north).  
`main.mjs` then `plantMesh`s every `INSTANCES` row that shares that proto. Same 32³ blazer, same A-stance, same vertex colours.

In this PNG, three copies share the 55° frustum:

| row | x, z | yaw | where it sits vs camera `(0, 11)` |
|---|---|---|---|
| instance | **−1.4, 8.2** | 3.1 | **4 m in front of the lens**, back to camera, fills the lower-left third |
| instance | **−2.2, 1.4** | 0.4 | **in the carriageway** (`z ∈ [−6, 6]` forbidden), on the zebra, face-ish to camera |
| instance | **2.6, 2.8** | 3.4 | **in the carriageway**, east zebra, same jacket |

Also in or on the edge of this look, not all readable: unique `(−9.2, −7.3)`, north-curb clones `(−4, −6.9)` and `(2, −7.0)`, arcade clone `(8, −6.8)`.

Agent 49 already said: do not instance Hiro; a second unique humanoid is the density path. v9 ignored that and put two clones **on the asphalt the landmark is meant to show**.

**File-level fix lead — `catalog.mjs` `INSTANCES`, not a new still.**

- Delete from `INSTANCES` (or keep off this frustum): `(-1.4, 8.2)`, `(-2.2, 1.4)`, `(2.6, 2.8)`, and the other sakae-curb Hiros that land in `go('sakae')`.
- Never plant `civilian-hiro` in `z ∈ [−6, 6]`.
- Unique at Yaoya can stay. One body in a Saturday 15:20 still is enough until Watanabe exists.
- `main.mjs`: Hiro is `kind: "humanoid"` so `realHeight 1.72 < 2.2` → **32³**. Even one Hiro is a melted mannequin at that grid. If a single unique remains, lift him out of the `small` branch.

---

## 3. Tree lollipops — **FAIL**

Still `zelkova/yaw-000.png`: thin November street tree, grey trunk, sparse brown leaves on twigs, magenta studio. Not a candy apple.

Mesh: `kind: "custom"` → 8 views + **`photoIterations: 4`**. Visual hull of a sparse crown is a **solid brown disc on a stick**. Vertex colours average the dead leaves across the envelope. That is the lollipop.

Catalog unique: `zelkova` `(-20, -6.7)`, `7.5 × 6 × 6` m.  
`INSTANCES` stamps the same proto on **both** curbs at `z = ±6.7`.

What this camera actually hits:

| row | x, z | distance from `(0, 11)` | in PNG |
|---|---|---|---|
| instance | **4, 6.7** | **~4.3 m** (south curb, in front of the lens) | giant brown trunk + canopy, right third, hides the arcade |
| instance | **−8, 6.7** | ~4.3 m, left-south | left-frame brown mass / planter neighbour |
| instance | **−12, −6.7** | ~18 m, north curb at Yaoya | **floating brown disc** over the greengrocer roof |
| instance | **−2, −6.7** | ~18 m, pharmacy west lot | second lollipop in the pharmacy slot |
| instance | **8, −6.7** | arcade north curb | extra brown behind the near tree |

`fill-street.mjs` already puts a box planter at `(-2.2, -6.92)` — the lollipop grows out of (or floats above) that crate.

**File-level fix lead — `catalog.mjs` instances first, `main.mjs` reconstruct second.**

- Strip south-curb `zelkova` rows at `z: 6.7` that sit inside the `sakae` near clip (`x ≈ −8, 4, 12` at minimum). This camera cannot live 4 m behind a 6 m canopy.
- Strip or thin north-curb clones at `x: −12` and `x: −2` so the greengrocer / pharmacy roofs are not brown mushrooms.
- If any zelkova stays: `reconstructSubject` must not run `photoIterations: 4` on a sparse winter tree (`custom` currently always gets 4). `photoIterations: 0` still yields a silhouette blob; the honest cheap is **zero street zelkovas** until the hull is twigs, not a disc.
- Do not “fix” this by raising `map.mjs` `y`. The trees are seated on `groundHeight` ≈ 0; they are not a height-field bug.

---

## 4. Black shop-backs — **FAIL**

Two systems, both visible in this frame:

1. **`addGapFill` in `main.mjs`** — untextured `MeshStandardMaterial` boxes, colours `0x6a6560` / `0x5c5852`, planted at **`z = −10.5`**, `d = 7` → south face `z = −7.0`. In front of them sit reconstructed shops at `z = −8.5` with `realDepth` 6–10 m. Through every pharmacy hole, and in the Yaoya–pharmacy slot, you see the **lit-dark cube**, not an alley and not a party wall.
   - Relevant boxes in this look: `{ x: -6.4, z: -10.5, w: 7.2, h: 9.6 }` (Yaoya–pharmacy) and `{ x: 0.8, z: -10.5 }` (behind the pharmacy itself).
2. **Shop interiors / backs.** `MeshBasicMaterial` `DoubleSide` draws the inner isosurface. Cake-slice on `yaw-180` is a dark rear still. Holes therefore read as black caves. Gap-fill is `MeshStandardMaterial` under a dim sun (`0xe4ddd2` × 0.34) so it is even darker than the unlit vertex-coloured fronts.

Agent 46 asked for gap-fill at **`z = −8.5`** in empty lots, colour `0x6a6560`, 0.12 m air off unique envelopes. Live code parked the cubes **behind** the row (`z = −10.5`) and let them peek through a gutted pharmacy. That is a black shop-back, not a filled lot.

**File-level fix lead — `main.mjs` material + gap-fill `y`/`z`, not catalog.**

- Material: same as defect 1. `FrontSide` (or a standard material that matches gap-fill lighting) so holes do not draw an interior. Vertex-coloured fronts vs Lambert backs will always look like two movies.
- Gap-fill: do not put a dark box **behind** a holed unique. Either pull those two cubes out of the pharmacy / Yaoya AABBs, or seat them on the **frontage line** only in true ≥ 3 m gaps (Yaoya right `x = −6.3` → pharmacy left `x = −3.3` is the 3 m slot — one narrow box, not a 7.2 m block centred at `−6.4` that swallows both shops).
- `map.mjs` `y` does not cause the black. Street `groundHeight` is 0; boxes sit at `y0 + h/2`. Recolour / relight, do not lift.

---

## 5. Melted signs — **FAIL (paint, not pose)**

| façade | still | mesh in `sakae-v9` |
|---|---|---|
| pharmacy | mortar disc + 「港町薬局」 + HARU PHARMACY 1986 | kanji survive as a ring around a **hole**; mortar is air; HARU / 昭和61 gone |
| arcade | ファミリーゲームセンター / SPACE INVADER '86 | mint mosaic ok-ish; fascia is a beige smear; クラブ・ゲ blade is a wisp |
| Yaoya | 八百果 noren + 本日のおすすめ board | blue-white flap; specials board is an orange blob |

Cause is `main.mjs` `reconstructSubject` (`resolution: 48`, eight Laplacian steps, `projectVertexColors` cake-slice, `mapSize: 128` thrown away) plus `MeshBasicMaterial` vertex colours only. Corner vertices at ±45° sample the side still; GPU interpolation melts lettering into tile. Open mortar / 2F sash are holes, so the sign is a stencil.

**File-level fix lead — `main.mjs` material / reconstruct.**

- Bind the albedo map the pipeline already bakes, or stop Laplacian-smoothing vertices **before** the colour projection on rectangle shops.
- `mapSize: 128` is too small for 港町薬局 at street distance even if bound; 256+ on the three north-row shops in this shot.
- Catalog instances will not un-melt a unique fascia. Do not clone shops.

---

## 6. Vending tiling — **FAIL**

Still `vending-enamel/yaw-000.png`: one cream cabinet, red 自動販売機 bar, four button rows, coin slot, red kick plate. A **machine**.

Mesh: `kind: "rectangle"`, `realHeight: 1.82` → `small` branch in `reconstructSubject` → **32³ / silhouette 64**. The button grid becomes a repeating red/white **tile**. `DoubleSide` Basic then shows both sheets.

Plants in this look:

| row | x, z | yaw |
|---|---|---|
| unique `ORBIT_SUBJECTS` | **−6.8, −5.9** | 0 | Yaoya east bay — the cream/red box in the PNG |
| instance | **−10.8, −6.7** | 0 | Yaoya west lot, in the crate pile |
| instance | **10.2, −6.7** | 0 | arcade west, mostly behind the near zelkova |

`crate-stack` instance `(-9.5, -5.9)` sits on the same pad, so the unique vending + clone + crates read as one tiled appliance cluster, not a single enamel machine.

**File-level fix lead — `main.mjs` small-threshold + `catalog.mjs` instances.**

- Take `vending-enamel` out of `realHeight < 2.2` → 32³. A 0.9 m face at 32 cells is why the buttons tile. 48³ (shop path) is the minimum.
- Keep **one** machine on the Yaoya pad (the unique). Drop `INSTANCES` `(-10.8, -6.7)` so the crate spill is produce, not a second cabinet.
- `map.mjs` `y` is unrelated (`groundHeight` 0, sidewalkN `y: 0.08`; vending is seated on the group `y` from `footprintSeatY`).

---

## 7. Road moire — **FAIL (coplanar slabs)**

Zebra at `x = 0, z = 2` is the only road read that works (eight white `BoxGeometry` stripes, `roads.mjs` `STRIPE_H = 0.04`, `y = surfaceY + 0.02`). Everything under it fights.

Live stack on Sakae asphalt (`z ∈ [−8, 12]`, `groundHeight` **returns 0**):

| surface | file | y |
|---|---|---|
| `GROUND.asphalt` `PlaneGeometry` colour `0x3a3a3c` | `map.mjs` `y: 0` + `main.mjs` `addGroundPatch` | **0** |
| height-field `PlaneGeometry(120, 200, 60, 80)` vertex colours | `main.mjs` `createStudio` | **0** (same `groundHeight`) |
| sidewalkN `y: 0.08` / sidewalkS `y: 0.08` | `map.mjs` | 0.08, but only `|z| ≥ 6` |
| yellow dashes `BoxGeometry(1.85, 0.03, 0.14)` | `main.mjs` `addStreetFurniture`, `z = 2`, `x` −38…38 step 4.4 | **0.03** |
| zebra stripes | `roads.mjs` | 0.02 |
| white lane edges | `roads.mjs` `z = −0.5 / 4.5` | 0.02 |

Two full-width planes at **exactly `y = 0`** z-fight. Frozen in this PNG as a “slight sheen” / uneven grey, not a wet 1986 spec. Yellow dashes run **through the zebra** at the same `z = 2`.

**File-level fix lead — `map.mjs` `y` first, then paint in `main.mjs` / `roads.mjs`.**

- `map.mjs`: drop `GROUND.asphalt` under the height field (or set `asphalt.y` negative enough to die), **or** stop drawing the height field on the carriageway. One writer for `y = 0`.
- Height-field vertex colours already paint the road grey (`grass = z < -12 \|\| y > 0.3` → else `0.24, 0.24, 0.25`). The extra `0x3a3a3c` patch is the moire.
- Skip yellow dashes whose `x` overlaps `sakae-crosswalk-0` (`|x| < 2.5`). Zebra owns `z = 2` at the landmark.
- Stripe `y` can stay `groundHeight + 0.02` once the double plane is gone. Do not lift the whole street in `groundHeight` — shops already seat on 0.

---

## File-level fix leads (summary)

Do not reshoot `sakae-v9`. The camera is the right sidewalk look.

### `main.mjs` — material / reconstruct

- `reconstructSubject` `MeshBasicMaterial({ vertexColors, DoubleSide })` is the black interior, the unlit/lit gap-fill clash, and the melted vertex-colour fascia. `FrontSide` at minimum; a standard material if gap-fill stays Lambert.
- `small = realHeight < 2.2` is fatal for `vending-enamel` and `civilian-hiro` (32³). Carve them out of that branch.
- `custom` → `photoIterations: 4` is why zelkova is a lollipop. Do not photo-carve winter twigs.
- Pharmacy holes: more resolution / opaque 2F glass in the still, not more Laplacian. `mapSize: 128` is unused; bind it or stop paying for it.
- `addGapFill` boxes at `z = −10.5` must not sit behind a holed unique. Recentre on true frontage gaps only.
- Yellow dashes at `z = 2` must not cross the zebra.

### `map.mjs` — `y`

- `GROUND.asphalt.y: 0` + height field `y = groundHeight = 0` is the road moire. One plane.
- Do not change `groundHeight` on Sakae (`z ≥ −12`) to paper over trees, Hiros, or shops. Those are catalog seats, not a slope bug.
- Sidewalk patches at `y: 0.08` are fine; keep paint / curbs on `groundHeight + epsilon`.

### `catalog.mjs` — `INSTANCES` (unique `ORBIT_SUBJECTS` stay)

- **Hiro:** remove sakae-frustum clones, especially `(-1.4, 8.2)`, `(-2.2, 1.4)`, `(2.6, 2.8)`. No humanoid in `z ∈ [−6, 6]`.
- **Zelkova:** remove south-curb clones at `z: 6.7` that sit in this near clip; thin north-curb `x: −12` / `x: −2` off the shop roofs.
- **Vending:** drop the second Yaoya machine `(-10.8, -6.7)`. One unique enamel at `(-6.8, -5.9)` is the still.
- Do not instance shops, Hiro, or zelkova to “fill” a hole in a unique hull.

Reshoot only `pharmacy/yaw-270` if it is still the ¾ wreck (true ortho gable, tile only, mortar / sash stay on **000**). Everything else in this PNG is a runtime / instance defect.
