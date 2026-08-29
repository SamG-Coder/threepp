# v9 scout — `warehouse`

Visual only. Do **not** edit sample source from this note.

Shots: `C:\ThreeBrowser\artifacts\harbor-town-1986\harbor-warehouses.png`, `seawall-v9.png`, `quay-v9.png`.  
Compared: `seawall-v8.png` (identical to v9 from this camera), `quay-v8.png` (different frustum), `harbor-approach.png` (same pad as `harbor-warehouses`, slightly wider).  
Live poses: `catalog.mjs` `ORBIT_SUBJECTS` + `INSTANCES`. Cameras: `scout.mjs` `LANDMARKS`.

Convention: `+X` east, `+Z` south. Mesh `yaw: 0` presents yaw-000 to `+Z` (south). `yaw: π` aims the catalog front **north** (inland). Eye 1.62 m unless `y` is set.

Tour `command.json` t17 never calls `go: warehouse`. There is **no `warehouse-v9.png`**. The warehouse landmark is audited from the three stills above.

**Verdict: melted 上屋 on empty brown pads, not a 1986 Amihama row.** W8 is a scalloped green loaf with 倉 smeared around. W3 is a better timber box but still rounded. `harbor-warehouses` is a product shot of two hulls across a virgin court. `seawall-v9` is the only v9 camera that actually sees the row (eave clutter yes, quay walk empty). `quay-v9` looks **seaward** from `y = 3.15` and shows **zero warehouses**. v8 → v9 on `seawall` is no visible delta.

---

## Live warehouse poses

Catalog metres, yaw `π` so local width is X and depth is Z. `footprintSeatY` uses both `realWidth` and `realDepth`. W8 live size is the agent-16 shrink (`8.2 × 8.5 × 11`), not the old `9.5 × 14 × 18`. Drum keep-outs in `main.mjs` match `hx 4.25 / hz 5.5` and `hx 8 / hz 6`.

| tag | asset | x | z | yaw | plan (m) | AABB x × z | role |
|---|---|---:|---:|---|---|---|---|
| **W8-A** | `harbor-warehouse-8` unique | **−12** | **72** | π | 8.5 × 11 | **[−16.25, −7.75] × [66.5, 77.5]** | inland doors on the approach; landmark `warehouse` aims here |
| **W3** | `harbor-warehouse-3` unique | **16** | **70** | π | 16 × 12 | **[8.00, 24.00] × [64.0, 76.0]** | long timber shed, east of the truck lane |
| **W8-W** | inst | **−32** | **72** | π | 8.5 × 11 | **[−36.25, −27.75] × [66.5, 77.5]** | west eave; **hero of `seawall-v9`** (left cliff) |
| **W8-E** | inst | **36** | **72** | π | 8.5 × 11 | **[31.75, 40.25] × [66.5, 77.5]** | east eave; **hero of `harbor-warehouses.png`** (right mass) |
| **W8-NW** | inst | **−24** | **58** | π | 8.5 × 11 | **[−28.25, −19.75] × [52.5, 63.5]** | north-apron filler; **not in any of the three PNGs** |
| **W8-N** | inst | **8** | **58** | π | 8.5 × 11 | **[3.75, 12.25] × [52.5, 63.5]** | **clips truck lane** `x ∈ (−5, 8)`; not in the three PNGs |
| **W3-N** | inst | **28** | **56** | π | 16 × 12 | **[20.00, 36.00] × [50.0, 62.0]** | north-apron east; would fill the W3/W8-E sky gap if the camera were far enough; **not in the three PNGs** |

Landmark cameras that should see this kit:

| name | pose | looks | warehouses in v9 still? |
|---|---|---|---|
| `warehouse` | `{ x: −12, z: 52, yaw: 0, pitch: 0.08 }` | south at W8-A north doors, 20 m | **not shot** (t17 skipped it) |
| `seawall` | `{ x: −36, z: 82, yaw: 1.45, pitch: −0.08 }` | east along south eaves | **yes** — W8-W, W8-A, W3 |
| `quay` | `{ x: 6, z: 87.2, y: 3.15, yaw: 0.06, pitch: −0.22 }` | almost south, **over the water** | **no** — row is behind the lens |
| `harbor` | `{ x: 0, z: 48, yaw: 0.05 }` | south through the gate | not in this pass |

Do **not** treat agent 11’s old 14 × 18 pads or agent 60’s unpushed `(−22, 72)` / `(−38, 56)` as live. Those rows are not in `INSTANCES`.

---

## 1) `harbor-warehouses.png` — south court, looking north

Camera is **south of W3 / W8-E**, on the loading court (`z ≈ 80–84`), looking **north** (east = frame right). W3 timber is a left sliver; W8-E green fills the right half. Tiny cap posts on the horizon. Same pair, slightly wider, in `harbor-approach.png`.

This is **not** landmark `warehouse` (that stands at `(−12, 52)` looking south at W8-A). It is a close product shot of two south eaves.

### Melted hulls

- **W8-E (right):** green corrugated **loaf**, not a gable shed. Ridge and eave are one rounded cap. South contact is a **scalloped undercut** — 0.5–1 m of air between paint and the brown slab; the mesh does not sit. `倉42` / `港運倉庫` / rust doors are a **white smear on the quay-facing wall**. Catalog `yaw: π` puts yaw-000 doors **north**; seeing 倉 on the **south** face is bake wrap from the ¾ `yaw-000` still (agent 05 / 59), not a second door. Not a silo (force-shape held). Still a pancake vs the still’s cube.
- **W3 (left):** orange timber reads more like a **box**. Eaves still melt. Dark opening + yellow post are a chewed loading mouth, not a square door. `harbor-approach` shows the same hull with a **baked concrete lip** hanging off the south-west corner (the quay slab that agent 05 told `yaw-000` to drop).
- Gap between them is **sky**, not W3-N or a dock office. Camera is glued to W8-E’s south wall (`z = 77.5`), so `(28, 56)` and shack `(26.2, 64)` sit behind the W3 mass / outside this tight frustum.

### Empty dock pad

Lower ~45 % of the frame is **virgin brown `GROUND.dock`**. No crate stack at the W3 south court (agent 43 hero `crate-stack` `(12.6, 77.4)`), no pallet `(14.8, 79.8)`, no drum, no forklift, no hawser, no Hiro. The court `z 76…86` between W3’s south wall and the cap is an empty table with two potatoes on it.

### Scale

W8 live **8.2 m** ridge vs **8.5 m** south frontage is a near-square elevation. The PNG agrees: the green mass is about as tall as the visible width, then cropped. It is an 上屋 / large garage, **not** a 14 × 18 m medium shed — the agent-16 shrink is what we are looking at. Camera distance is ~8–12 m from W8-E’s south face (55° vFOV, building fills half the frame). W3’s 16 m long wall is mostly out of frame, so this still cannot audit W3 plan.

---

## 2) `seawall-v9.png` — west apron, looking east

Landmark `seawall`. Same picture as `seawall-v8.png`.

Left: **W8-W** as a green cliff (south-west corner + long south eave receding). Mid: distant **W8-A** loaf, then orange **W3**. Right: cap, water, three melted willows. People and drums sit on the **south-eave** strip (`z ≈ 78–84`), not on the quay walk.

### Melted hulls

- **W8-W (hero):** same loaf as W8-E. Horizontal corrugation is **texture on a wavy isosurface**, not ribs. Roof is a rounded tube. Base **does not meet the dock** — the left edge is a vertical cutout hanging over the slab. Rust patch and a cream blob stand in for 倉 / 分電盤. Height vs Hiro (below) is believable; silhouette is not a kirizuma 上屋.
- **W8-A (mid):** green blob, same family, ~20 m east. No readable doors.
- **W3 (gap):** orange gable-ish mass, more rectangular than W8, still melted at the ridge. Reads as the unique `(16, 70)` from this yaw, not as a 16 m wall (we see a short end / ¾).
- W8-E, W8-NW, W8-N, W3-N: **out of this look** (east of the vanishing point, or north of the eave line behind W8-W).

Willows on the water are a separate melt (custom 8-yaw over-carve). They are not warehouses.

### Empty dock pads

This is the **least empty** of the three stills, and the empty part is the wrong half.

**Occupied (south eaves, left-mid):** crate stacks against W8-W, rust drum pair, Hiro on a crate (~1.72 m ruler), more drums/crates receding, two far NPCs, a green tarp, two tires on the slab. That beat is what agent 43 asked for on `z ≈ 78–82`.

**Empty:**

- **Quay walk** (`z ≈ 84–86`, right two-thirds): grey concrete to the cap. Black `roads.mjs` bitts recede. No pallets, no net piles, no hawser coils from `fill-quay.mjs` (`z 79–85`) that **read**. A 0.04 m pallet and a torus coil vanish at this distance; the walk still photographs as a clean airport apron.
- **Cap / water** (right): knife-edge wall, pond colour, willows. No boat in this frustum (boats sit at `z 94–108`, south of the wall, while yaw 1.45 looks **along** the wall).
- **Aisles** between sheds: W8-W → W8-A is a dark slot, not a forklift lane with wall-hugging drums.

### Scale (Hiro is the ruler)

Hiro ~1.72 m stands on a crate in the left foreground, a few metres in front of W8-W’s south-west corner.

| measure | catalog | PNG |
|---|---|---|
| W8 ridge | 8.2 m | **~8 m** — eave sits ~4.5–5 Hiro-heights above the dock once perspective is allowed. **OK.** |
| W8 south frontage | 8.5 m | **OK** as a compact 上屋. The loaf’s **plan** reads square-ish; 11 m depth is plausible as the cliff running inland. |
| W8 vs W3 height | 8.2 vs 8.2 | **OK** — distant orange ridge matches the green ridge line. |
| W8 vs old 14 × 18 | — | **not** the old pad. Agent 11’s 14 m fronts would crowd the west dock lip (`minX = −40`); this hull leaves ~4 m of slab west of W8-W. |
| Drums | cylinder ~0.9 m | **OK** next to Hiro’s hip. |
| Cap bollards | 0.42 m | parking posts. Mooring bitts on the walk (~0.9 m) are the only ones that read as furniture. |
| Willows | canopy ~12 m | **too big** vs the 8 m sheds; they out-scale the row. |

W8 height/plan is no longer the “too big” problem. The problem is the **melted envelope** at that size.

---

## 3) `quay-v9.png` — no warehouses

Landmark `quay` is now **on the wall**, `{ x: 6, z: 87.2, y: 3.15 }`, yaw ~0 (south), pitch −0.22. Old `quay` (`x: −16, z: 84.5, yaw: π/2`) looked **east along bollards with warehouse roofs on the left**. This one looks **out to sea**.

Frame: melted willow hanging over the lens, grey box-boat / dock-office stacks in the water, dark basin, brown quay sliver on the right, grey cap in the immediate foreground. **Zero W8 / W3 silhouettes.**

Cannot audit hull, pad, or warehouse scale from this PNG. The row is behind the camera at `z 56–77`. `quay-v8` was a dock-level look at the cap (one bollard, two willows, empty apron) and also hid the sheds.

Primitive boats at `z 94–108` are 6.2–7.8 m boxes. They sit in the water like furniture, not against an 8 m shed, so they do not give a warehouse ruler.

---

## Empty pads — map vs the three stills

Dock slab `x ∈ [−40, 48]`, `z ∈ [52, 88]`. Truck lane `x ∈ (−5, 8)` must stay open (nav `harbor-gate (0, 48)` → `quay (0, 80)`).

```
z=52   dock north / landmark warehouse camera
         W8-NW (−24,58)     W8-N (8,58) [LANE CLIP]     W3-N (28,56)
z=63.5 those north-apron AABBs end
z=64   dock-office boxes in the gaps (not visible in these stills)
          W8-W           W8-A            LANE            W3             W8-E
         −32,72         −12,72         x=−5…8         16,70          36,72
z=76   W3 south wall
z=77.5 W8 south eaves     ← harbor-warehouses camera, empty court
z=82   seawall camera     ← eave clutter yes, walk empty
z=86   bitts
z=87.7 cap / quay camera looks SOUTH from here
z=88   water
```

| pad | authored to hold | in `harbor-warehouses` | in `seawall-v9` | in `quay-v9` |
|---|---|---|---|---|
| W3 / W8-E south court `z 76…86` | crate `(12.6, 77.4)`, pallet, drums | **empty brown** | n/a (west of this court) | n/a |
| W8-W / W8-A south eaves | crates, drums, Hiro | n/a | **occupied** | n/a |
| Quay walk `z 84…86` | pallets, nets, coils, bitts | empty (tiny posts only) | **empty grey** + bitts + 2 tires | foreground cap only |
| Truck lane `x −5…8` | nothing | not in frame | vanishing point, looks open | n/a |
| W3 ↔ W8-E aisle `x 24…32` | dock office `(26.2, 64)` | **sky hole** | n/a | n/a |
| North apron `z 52…64` | W8-NW, W8-N, W3-N | not in frustum | hidden behind W8-W | behind camera |
| Water `z 88…120` | 7 box boats | horizon strip | willows / pond | **boxes + empty basin** |

Headline: **south loading court and quay walk still photograph empty.** Eave clutter exists only in the seawall near field. North-apron clones exist in the catalog and **do not appear** in these stills, so they neither fill the court the cameras see nor prove the lane is still walkable.

W8-N AABB `x 3.75…12.25` **enters the truck lane**. Landmark `warehouse` at `(−12, 52)` would also have W8-NW 12 m to the west and W8-N 20 m to the east, 6 m ahead — a flanking pair the t17 tour never photographed.

---

## Scale summary

| id | catalog H×W×D (m) | from these PNGs | verdict |
|---|---|---|---|
| `harbor-warehouse-8` | **8.2 × 8.5 × 11** | ridge ~8 m vs Hiro; south face ~square; compact 上屋 | **H/plan OK.** Envelope is a loaf, not a shed. Do not grow it back to 14 × 18. |
| `harbor-warehouse-3` | **8.2 × 16 × 12** | same ridge as W8 in `seawall-v9`; 16 m wall not measurable in `harbor-warehouses` (cropped) | **H OK.** Plan unverified in these three stills. |
| dock offices | 3.0–4.2 × 2.6–2.9 × 3.0–3.2 | **absent** from all three PNGs | unverified |
| boats | 6.2–7.8 L | toy boxes in `quay-v9`, no shed in frame | cannot ruler warehouses |
| willow | — | canopy taller than the 8 m row | **over-scale** vs the sheds |

Pipeline: rectangle, `photoIterations: 0`, res 48. Melt is silhouette intersection + Laplacian on a ¾ W8 front, **not** a scale bug.

---

## What would make `warehouse` a landmark

1. **Shoot it.** t17 skipped `go: warehouse`. Until `warehouse-v9.png` exists, the inland door row (W8-A at 20 m, extras at z = 58) is un-audited.
2. **Hull, not metres.** W8 needs a true ortho `yaw-000` (square to 倉42, long wall out of frame) so the south face stops smearing doors and the plinth stops scalloping. Force-shape already killed the silo.
3. **Fill the court the cameras see.** `harbor-warehouses` / `harbor-approach` are empty `z 76…86` slabs. Crates and pallets authored for that court are not in the PNG. `seawall-v9` already proves eave clutter can read; copy that density onto the W3/W8-E court and the quay walk.
4. **Do not use `quay` to QA warehouses** while it looks south from `y = 3.15`. Point it east along the cap (old pose) or keep `seawall` as the row camera.
5. **Leave live W8 at 8.2 × 8.5 × 11.** Growing the pad would make the loaf worse.

v8 / v9 from `seawall` are the same melted row on the same empty walk.
