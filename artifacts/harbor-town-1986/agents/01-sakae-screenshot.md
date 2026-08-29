# Sakae landmark screenshot — `sakae-north.png`

Shot under review: `C:\ThreeBrowser\artifacts\harbor-town-1986\sakae-north.png`  
Landmark `sakae` in `scout.mjs`: `{ x: 0, z: 1.5, yaw: Math.PI, pitch: 0.06 }`  
Camera: eye `1.62 m`, `PerspectiveCamera(55, …)` (vertical FOV 55°). `yaw = π` looks due north (−Z). `+X` east, `+Z` south.  
North-row shops: `z = -8.5`, `yaw = 0` (fronts face +Z / south, toward the street).

This is not a shopping street. It is two visual-hull walls and a vacant lot.

---

## 1) What the screenshot actually shows

### Left wall — Yaoya greengrocer (`greengrocer`, catalog `x: -4`, `z: -8.5`)

Matches `assets/greengrocer/yaw-000.png` and `yaw-090.png`:

- Ground floor: tattered blue 八百果 / 青果 noren, wooden crate table with cabbage / mikan / daikon, the 本日のおすすめ board (白菜 98円, 大根 50円, みかん 250円/箱, 昭和61年11月29日).
- Second floor: yellow lace curtains smeared into a single yellow blotch. The 住居 plaque and tiled gable are gone — the isosurface ate the eaves.
- Right-hand (east) face: pale vertical boards, the `yaw-090` gable wall, reconstructed as a stepped sponge rather than planks.

Footprint from catalog (`realWidth: 6.2`, `realDepth: 7.4`):

| | metres |
|---|---|
| x span | **−7.1 … −0.9** |
| z span | **−12.2 … −4.8** |
| south (street) face | **z = −4.8** |
| height | 6.9 |

Near corner (SE, `x ≈ −0.9`, `z ≈ −4.8`) to camera `(0, 1.5)`: **6.4 m**.

The building fills the left ~45% of the frame, roof clipped off the top. At 6.4 m and 55° vFOV the visible vertical slice is only ~6.7 m, so a 6.9 m shop cannot fit. That is doorway distance, not street distance.

### Right wall — Starlight Arcade (`you-arcade`, catalog `x: 8`, `z: -8.5`)

Not the front. The camera is staring at the **west party wall** (`assets/you-arcade/yaw-270.png`): 2×2 beige-blind windows, mosaic tile, centre downpipe. A sliver of the south glass (`yaw-000`, 本日休業 posters) is on the far-right edge. The ファミリーゲームセンター / SPACE INVADER '86 fascia is **not in frame**.

Footprint (`realWidth: 8.0`, `realDepth: 10`):

| | metres |
|---|---|
| x span | **4.0 … 12.0** |
| z span | **−13.5 … −3.5** |
| south face | **z = −3.5** (2.5 m into the asphalt) |
| height | 7.8 |

Near corner (SW, `x = 4.0`, `z = −3.5`) to camera: **6.4 m** again. The arcade is 1.3 m closer in Z than the yaoya because it is 2.6 m deeper, so you get a side wall in the face instead of a shop front.

### Far-left red lump — enamel vending, not a barrel

`vending-enamel` at `x: -6.2`, `z: -5.4` (`realHeight: 1.82`). Sits on the yaoya’s west-front. The hull from this ¾ angle collapses to the machine’s red kick-panel; the cream upper body is the pale flake above it. Possibly merged with the yaoya’s red 青果 lantern.

`civilian-hiro` at `x: -8.5`, `z: -5.2` is **out of frustum** (bearing ~51° left; half-hFOV at 16:9 is ~43°). He is not in this shot.

### Centre — vacant lot, not a street

Clear gap between yaoya east face `x = −0.9` and arcade west face `x = 4.0` = **4.9 m**. That slot is the entire middle of the image:

1. Bottom ~30%: untextured asphalt `GROUND.asphalt` `0x3a3a3c` (`z = −8 … 12`, `y = 0`).
2. A muddy grey band where `sidewalkN` (`0xb7b1a4`, `z = −12 … −6`, `y = 0.08`) should read as concrete and does not.
3. Olive-green rectangle: height-field vertex colour `(0.32, 0.38, 0.22)` for `z < -12` in `main.mjs` `createStudio`. Park grass in a shop gap.
4. Steel-blue sky `0x8aa0b4` from mid-frame up. Pitch `+0.06` (~3.4° **up**) aims at shop cornices, not pavement.

Nothing else is in the shot. South-row florist, kei-van, phone booth, yellow dashes, poles, cassette shop, soba, tobacco: all behind the camera or off the sides.

### Scale / too close or too far

**Too close. Not borderline — alley-close.**

| quantity | value |
|---|---|
| Camera | `(0, 1.62, 1.5)`, look −Z, pitch +0.06 |
| Dist. to both near corners | **6.4 m** |
| Dist. to yaoya south face | 6.3 m |
| Dist. to arcade south face | 5.0 m |
| vFOV / ~16:9 hFOV | 55° / ~86° |
| Width visible at 6.4 m | ~12 m |
| 4.9 m shop gap as fraction of frame | **~40% of width** |
| Building heights vs visible height | 6.9–7.8 m vs ~6.7 m → roofs clipped |

A 1986 Kanagawa shotengai the player walks down wants **12–18 m** to the opposite facade (Sakae is specified `80 × 18` in `TOWN.md`). 5–6 m is standing in the shop’s produce spill. The 55° lens plus +3.4° pitch turns two 2-storey fronts into canyon walls with a golf-course hole between them.

---

## 2) Landmark must pull back — and it must yaw

Keeping `yaw: Math.PI` and sliding `z` south does **not** produce a street. South-row blockers sit immediately behind this camera:

| object | pose | north face | problem if `z` increases |
|---|---|---|---|
| Midori florist | `x: -6`, `z: 8.6`, depth 7.8 | **z = 4.7** | becomes the new left wall at ~4 m |
| Suzuki Carry | `x: 4.2`, `z: 3.8` | ~z = 2.2 | occupies the roadway |
| Phone booth | `x: 2.4`, `z: 6.2` | ~z = 5.75 | 2 m in front of a `z ≈ 8` camera |
| Pole instance | `x: -4`, `z: 5.6` | — | south sidewalk line |

Usable north-facing corridor at `x ≈ 0` is roughly `z ∈ [-2, 2]`. Current `z = 1.5` is already at the south edge of that slot. There is nowhere to pull back while still staring at the north row.

Sakae-dori runs **east–west**. The landmark has to look **along** it.

**Suggested `sakae` pose** (do not keep `yaw: Math.PI`):

```js
sakae: { x: -11, z: 2.4, yaw: 1.62, pitch: -0.06 }
```

| | why |
|---|---|
| `x: -11` | 3 m east of Nishiya soba (`x: -14`), 7 m west of Yaoya. First full facade on the left is the greengrocer, then the 4.9 m hole, then the arcade **front**, then records. |
| `z: 2.4` | On asphalt, 0.4 m south of the yellow dashes (`z = 2` in `addStreetFurniture`). Centreline runs under the look. North curb 8.4 m to the left; south curb 3.6 m to the right. Van at `(4.2, 3.8)` is 15 m ahead as furniture, not a blocker. |
| `yaw: 1.62` | `π/2 = 1.5708` is due east (+X). **+0.05 rad (~3°) north of east** so north-row fronts are ¾ views, not slabs. Look vector `(sin 1.62, cos 1.62) ≈ (+1.00, −0.05)`. |
| `pitch: -0.06` | Opposite of current. 3.4° **down**. At 15–20 m the look hits doorways (~1.0 m) and wet asphalt, not sky. |

Distances from that pose:

| target | dist |
|---|---|
| Yaoya centre `(-4, -8.5)` | 13 m |
| Arcade centre `(8, -8.5)` | **22 m** |
| Arcade south-west corner | 20 m |
| Cassette shop `(20, -8.5)` | 33 m |

At 22 m, 55° vFOV shows ~23 m of height — 7.8 m arcade sits in the lower half with sky as sky, not as a gap between walls. Horizontal slice ~40 m: soba (edge) → yaoya → **gap** → arcade fascia → records. That is a street.

North-facing fallback if someone refuses to change yaw — still worse, listed only to kill it:

```js
{ x: 2.0, z: 9.5, yaw: 2.92, pitch: -0.10 }  // π-0.22, NNE
```

13 m from the arcade, but Midori’s north face at `z = 4.7` is 4.8 m ahead on the left: two walls again, just a different pair. Do not use.

Also drop pitch on the per-shop landmarks (`produce`, `arcade`, `soba`, `records`, `tobacco` are all `z: -1.5`, `yaw: π`, `pitch: 0.08`). They repeat this shot at each facade.

---

## 3) Missing mid-block shops (greengrocer `x = -4` → arcade `x = 8`)

North row as planted, west → east, all `z = -8.5`, `yaw = 0`:

| id | x | width | x-span | gap to next |
|---|---|---|---|---|
| `tobacco-shop` | −25 | 6.4 | −28.2 … −21.8 | **4.6 m** |
| `soba-shop` | −14 | 6.4 | −17.2 … −10.8 | **3.7 m** |
| `greengrocer` | −4 | 6.2 | −7.1 … −0.9 | **4.9 m ← this screenshot** |
| `you-arcade` | 8 | 8.0 | 4.0 … 12.0 | **4.6 m** |
| `cassette-shop` | 20 | 6.8 | 16.6 … 23.4 | — |

The 4.9 m hole is a **full shop lot**. It is the olive rectangle in the screenshot. A continuous 1986 shotengai has 0.3–1.0 m party-wall gaps, not 5 m of park.

Stills already on disk, **not in `ORBIT_SUBJECTS`**:

- `assets/pharmacy/` — 港町薬局 / HARU PHARMACY 1986, mint tile, 薬 noren. Width in the still is a standard ~6 m 2-storey. Colour break between white yaoya wood and arcade mosaic.
- `assets/barber-shop/` — 床屋 港町理容室 / HARU BARBER SINCE 1963, pole, yellow chairs.

Neither is referenced in `catalog.mjs`. `grep` over the sample finds zero `barber` / `pharmacy` hits outside the PNG folders. `honda-cub/` stills are also unused (sidewalk furniture, not a lot-filler).

**Do not try to cram both into the 4.9 m slot.** One building:

```text
id: pharmacy
x: 1.55          # midpoint of −0.9 … 4.0
z: -8.5
yaw: 0
realWidth: 4.6   # 0.2 m air each side
realDepth: 7.4   # match yaoya, not the arcade’s 10 m
realHeight: 7.0
```

If pharmacy stills are composed at ~6.2 m wide, **move the arcade east** instead of squeezing:

```text
you-arcade.x: 8  →  10.2     # west face 6.2, 1.3 m gap after a 6.2 m pharmacy at x=1.55
```

Put the barber in the next hole, arcade east `x = 12` → cassette west `x = 16.6` (4.6 m), or bump cassette to `x: 22` and plant barber at `x: 14.3`, `realWidth: 5.0`.

Soba→yaoya 3.7 m is too tight for a 2-storey; fill with the cub, a crate stack, and the existing vending — not a building.

Until something occupies `x ≈ 1.5`, `z = -8.5`, every north-facing camera on Sakae will show this same vacant lot.

---

## 4) Road / sidewalk / curb problems visible in this frame

`roads.mjs` exists (`sakae-curb-north` at `z = -6.15`, 18 cm × 28 cm concrete, white lane edges at `z = −0.5 / 4.5`, crosswalk at `x = 0, z = 2`, manholes). **`main.mjs` never imports or calls `addRoads`.** The screenshot matches dead code: no curb, no white paint, no manhole, no zebra.

What *is* in the frame:

1. **Asphalt is a flat `MeshStandardMaterial` `0x3a3a3c`.** `TOWN.md` lock is “wet asphalt from earlier drizzle”. There is no puddle, no spec, no tyre sheen, no texture. Dry grey CG plane.

2. **Shops stand in the roadway.** North sidewalk is `minZ: -12, maxZ: -6` (street edge `z = −6`). Shop south faces: yaoya **−4.8**, soba **−4.4**, arcade **−3.5**. The arcade overhangs the sidewalk by **2.5 m** and sits on the driving lane. That is why the right-hand wall is a side elevation in the road, not a front on a pavement.

3. **Sidewalk height is 8 cm** with no granite edge, no gutter, no drain. Real 1986 shotengai curb is 12–15 cm plus a 20–30 cm granite strip. From this camera the tan patch `0xb7b1a4` occupies ~5° of a 55° vertical FOV and lights as grey under `HemisphereLight(0xc8d4e0, 0x5a5348)`. It does not read as a sidewalk.

4. **Yellow centre dashes are behind the camera.** `addStreetFurniture` plants `BoxGeometry(1.85, 0.03, 0.14)` at `z = 2`. Camera `z = 1.5` looking −Z. Zero lane paint in the shot. Crosswalk in `roads.mjs` is also `z = 2` — same fate, and uncalled anyway.

5. **Olive void north of `z = -12`.** Height-field `PlaneGeometry(96, 72)` centred at origin, grass if `z < -12`. The 4.9 m lot looks onto a park. Behind a north-row shop should be a back alley, block wall, AC condensers, or the next street’s grey — not `(0.32, 0.38, 0.22)` turf 4 m behind the yaoya’s back wall (`z = −12.2`).

6. **No threshold from pavement to shop.** Produce crates in the still sit on a wooden table at grade. In world they hover on a hull that interpenetrates the 8 cm sidewalk and the asphalt with no step, no noren-to-tile line, no drainage grate.

7. **Pitch hides the road that does exist.** `pitch: 0.06` looks *up*. Horizon sits mid-frame. Combined with 6.4 m proximity, pavement is a 30% footer instead of the thing you walk on.

---

## 5) Ranked next 5 visual fixes

1. **Plant the pharmacy in the 4.9 m hole** (`x ≈ 1.55`, `z = -8.5`, `yaw = 0`). Stills are already in `assets/pharmacy/`. This single mesh deletes the olive sky-slot that *is* the screenshot. Second: barber in the arcade–cassette 4.6 m gap (move cassette to `x: 22` if the still is ~6 m wide). Do not leave 5 m lots on the hero street.

2. **Replace landmark `sakae` with `{ x: -11, z: 2.4, yaw: 1.62, pitch: -0.06 }`.** Current pose cannot see a street; south-row geometry forbids pulling back on the same yaw. Per-shop landmarks at `z: -1.5` / `yaw: π` / `pitch: 0.08` need the same treatment (stand `z ≈ 2.5`, look along +X, pitch negative).

3. **Put shop fronts on the sidewalk, not in the lane.** Target south face `z ≈ -6.2` (behind `roads.mjs` curb `z = -6.15`). Arcade is the offender: `z: -8.5` + `realDepth: 10` → face at **−3.5**. Either `z: -11.2` or cut depth toward 7 m. Yaoya/soba need a ~1.5 m north shift. Until then every “street” shot is an alley between overhangs.

4. **Call `addRoads(scene, { THREE, groundHeight })` from `createStudio` and make the curb readable.** 15 cm sidewalk, 18 cm granite `0xa8a398` already authored, gutter, white lane edges, manhole at `(4, 2)` which would actually fall in a pulled-back east-looking frame. Raise `sidewalkN.y` from `0.08` to `0.12`. Paint the height-field **grey** for `z < -12` and `|x| < 40` (back lot), keep olive for the real park `x < -12`. The olive rectangle in this PNG is a material bug, not geography.

5. **Stop looking at hull wounds.** Greengrocer roof is a chewed sponge; arcade corners balloon; vending is a red drum. `reconstructSubject` uses `resolution: 48`, `silhouetteSize: 96`, `mapSize: 128`. Bump silhouette/map on the two buildings in this shot before taking another `sakae-north`. A pulled-back camera will still read as two melted boxes if the fascia (SPACE INVADER '86, 本日のおすすめ lettering, pharmacy mortar logo) is a 128 px vertex-colour smear.

Honourable, not top-five: wet-asphalt spec as locked in `TOWN.md`; south row is one florist on an 80 m street (even the along-street pose has a naked right side); unused `honda-cub` on the yaoya spill; Hiro is placed but never in the sakae frustum.
