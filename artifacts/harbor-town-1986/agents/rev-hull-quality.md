# rev-hull-quality — stills vs v9 (melt / stretch)

Read-only. Do **not** edit sample source, stills, or catalog from this note.

Question: does each reconstructed mesh **look like its still**, or is it melted / stretched / degenerate? Verdict is one of **keep** / **reshoot** / **replace with procedural**.

Stills: `ThreeBrowserRuntime/samples/harbor_town_1986/assets/<folder>/yaw-*.png`.  
Runtime: t17 v9 tour in `artifacts/harbor-town-1986/` (`command.json` `sakae` `street-east` `hill` `park` `town` `quay` `seawall` `yokobori` `bus`) plus older close-ups `pharmacy.png` `arcade-front.png` `harbor-warehouses.png` `hill-house.png`. `kissa-v8.png` used only for the Carry (no `kissa-v9`).

Pipeline (`main.mjs` `reconstructSubject`): catalog `shape` forced; `photoIterations: 0` on rectangle/square, 4 on custom/humanoid; `resolution` 48 (64 on custom/humanoid). Force-shape does not un-carve a bad still. 24-tri / 72-tri meshes are occupancy collapse, not a lighting bug.

Fail = over-carve holes, cab-only / wheel-less loaf, hover, ¾ still vs ortho hull, degenerate lollipop, dripping canopy, stretched humanoid back. Eave Laplacian chew on an otherwise closed box is town baseline, not a fail.

---

## Scoreboard

| id | still silhouette | v9 blob | flags | **verdict** |
|---|---|---|---|---|
| `pharmacy` | mint 2F box; 090 true gable; **270 is ¾** (front sash on the side) | `sakae-v9` / `pharmacy.png`: sky through fascia + 2F sash + 1F puncture | **holes**, ¾ `yaw-270` | **RESHOOT** |
| `kei-van` | Carry 3.2 m; 000/090/180 full; **270 cab crop, empty wheel well** | `street-east-v9` loaves; `kissa-v8` white stub, **no wheels** | **cab-only**, hover, melt | **RESHOOT** |
| `zelkova` | sparse Nov crown, thin trunk, 8 yaws, magenta through twigs | `sakae-v9` / `street-east-v9`: **brown lollipops** (disc on a stick). **24 tris** | degenerate; photo-carve 4 | **REPLACE WITH PROCEDURAL** |
| `honda-cub` | Super Cub + 牛乳 crate; 090 planted; **270 hovers**; spokes open | `arcade-front.png` / `pharmacy.png`: **two red wheel discs**. **72 tris**. Invisible in `sakae-v9` | wheel-only, hover, spokes | **REPLACE WITH PROCEDURAL** |
| `wooden-hill-house` | 2F stacked kirizuma; 090/270 twins; pots on plinth | `hill-v9` / `park-v9` / `town-v9`: stacked gables, lattice, **eave melt** | eave melt (baseline) | **KEEP** |
| `harbor-warehouse-8` | corrugated gable; **`yaw-000` still ¾ cube** | `seawall-v9` left: wavy melted gable; `harbor-warehouses.png`: rounded pancake, chewed plinth | ¾ front, melt | **RESHOOT** |
| `harbor-warehouse-3` | true ortho 000/090/180, long red slab | `seawall-v9` behind 8: **box**, 3 readable | mild gable chew | **KEEP** |
| `english-oak` | 8-view English oak, fat trunk, asymmetric crown | `hill-v9` / `park-v9` / `town-v9`: **stretched trunk columns**, swirling canopy, camera inside | melt / stretch | **REPLACE WITH PROCEDURAL** |
| `weeping-willow` | 8-view hanging filaments, lean trunk | `quay-v9`: **lime isosurface filling the lens**; `seawall-v9`: three green blobs with vertical slashes | melt; photo-carve | **REPLACE WITH PROCEDURAL** |
| `civilian-hiro` (back) | 180 is a clean A-stance back; **cyc floor under shoes on all 8** | `sakae-v9` fg + `hill-v9` stairs: **melted back**, no neck, hole in jacket, legs drip into treads | stretch, cyc, res 64 | **RESHOOT** |
| `you-arcade` | mosaic 2F prism; 000/090/180/270 true elevations | `sakae-v9` / `arcade-front.png`: box, fascia readable, antenna | west/parapet chew (baseline) | **KEEP** |

**3 KEEP / 4 RESHOOT / 4 REPLACE WITH PROCEDURAL.**

Do not bump `forceCount`. Do not add 45° stills to rectangle shops. Do not “replant” zelkova or Cub until the mesh has real tris.

---

## Per asset

### `pharmacy` — **RESHOOT**

Still `yaw-000`: mint tile, mortar/pestle, 「港町薬局」, packed 1F, open 2F sash. `yaw-090` / `yaw-180` are true elevations. **`yaw-270` is still the ¾ wreck** (shopfront + 薬局 board + upstairs sash on the left wall).

Mesh in `sakae-v9` and `pharmacy.png`: through-holes at the mortar logo, 2F sash, 1F orange puncture, west party wall chopped. Sky in the building. That is the Sakae civic axis.

`kind: rectangle`, `photoIterations: 0` — holes are silhouette intersection + Laplacian, not photo-carve. A ¾ 270 vs a true 090 gable punches cavities. Open 2F sash in 000 is a second hole source.

**Do:** new orthographic `yaw-270`. Copy `yaw-090`’s camera; AC / bucket / 薬 noren on **image-right**; side wall is tile only. Do not transplant the front sash. Paint the 2F sash **opaque** (no interior). Isolated `#E040A0`, no floor. If 270 is ortho and the fascia still Swiss-cheeses, then (and only then) replace with a procedural closed 2F box and bake the 000 still onto the front. Do not raise `forceCount`.

### `kei-van` — **RESHOOT**

Still `yaw-000` / `yaw-090` / `yaw-180`: full 1985 Carry, wheels on magenta, 88-26, blue stripe. **`yaw-270` is still the cab crop** (rear half and wheels off-frame; empty wheel well). Height-normalize a close-up against a full side → cargo carved off.

`street-east-v9`: four white **melted loaves** in the lanes, no wheel discs, sit like hovercraft. `kissa-v8`: depth ≈ width ≈ height, plate smeared, cab stub. `sakae-v9` left edge: van fragment.

`kind: rectangle`, 4 views, photoIterations 0 — cannot invent the missing half.

**Do:** reshoot `yaw-270` as a full left twin of 090 (nose camera-left, both wheels, barn-door tail in frame, wheels on magenta, no shadow). After that, if the loaf still has no wheels, replace with a procedural rectangle + four wheel discs. Do not flip to `custom` / 45° until 270 is a full side.

### `zelkova` — **REPLACE WITH PROCEDURAL**

Eight custom yaws, sparse November crown, magenta through every branch. Unique `(-20, -6.7)` + 16 curb clones at `z = ±6.7`.

v6 called them invisible. v9 prints them: `sakae-v9` right foreground is a **brown disc on a brown stick**; `street-east-v9` repeats the lollipop down both curbs. That is a **24-tri** occupancy speck, not a winter colonnade.

Stills are already the right object. Visual hull at 64³ with `photoIterations: 4` on a sparse silhouette ∩ to nothing, then Laplacian leaves a lollipop. New stills cannot put 3D twigs in this hull. `photoIterations: 0` would only keep a convex envelope blob.

**Do:** drop the orbit mesh. Procedural trunk (tapered cylinder, ~7.5 m, grey bark) + 6–10 branch cards or a sparse instanced twig. Keep the 16 curb poses. Do not reconstruct this folder again.

### `honda-cub` — **REPLACE WITH PROCEDURAL**

Still `yaw-000` / `yaw-090` / `yaw-180`: Super Cub + 明治 crate, skinny step-through. **`yaw-270` floats** (grey contact shadow, wheels off the plane). Spokes are open (magenta through the tyre on 000/180). Catalog `kind: rectangle`, four cardinals (`TOWN.md` wanted custom / 8).

In-game: `arcade-front.png` and `pharmacy.png` show **two concentric red wheel discs**, no tank, no crate, no wheelbase. `sakae-v9` has zero Cub pixels. Logged **72 tris**.

A 48³ visual hull cannot hold a step-through bike. Filling 270 and the spokes is necessary hygiene and still will not un-degenerate 72 tris.

**Do:** procedural Cub — two opaque wheel discs, box tank, box crate, cylinder forks. Plant on sidewalks only. Keep the six poses. Do not spend another 8-view orbit on this id.

### `wooden-hill-house` — **KEEP**

Stills 000/090/180/270 are stacked-gable twins (agent 02’s 090-as-warehouse is gone). Pots sit on the plinth.

`hill-v9` (behind oaks): two storeys, timber lattice, seated on the slope. `park-v9`: same house as side walls, readable bays. `town-v9` right: kirizuma + mid-eave, Laplacian **eave melt** (wavy tile, oak fused to the ridge). That chew is town baseline (`hardware` / `kissa` same class), not holes, not a potato, not hover.

Older `hill-house.png` yellow rounded shaft is a previous reconstruct; v9 is the current hull.

**Do:** none. Stop cloning it on an 8 m grid (placement, not hull). Do not reshoot.

### `harbor-warehouse-8` — **RESHOOT**

Still `yaw-090` / `yaw-180` are true corrugated gables. **`yaw-000` is still a perspective ¾ cube** (倉42 + long wall in frame). Visual hull assumes orthographic yaw; a ¾ silhouette is almost as wide as a side, so corners round off.

`seawall-v9`: green **melted loaf** filling the left third, wavy sides, no square plinth. `harbor-warehouses.png`: pancake with a chewed waterline. `yokobori-v9` distant 倉 is a box from far away — close-up is the fail. Force-shape already killed the silo snap; the remaining melt is the ¾ front.

**Do:** new orthographic `yaw-000` (square to 倉42, long wall invisible, isolated `#E040A0`). Do not raise `forceCount`. If 000 is ortho and the close-up is still a pancake, replace with a procedural gable box and stamp 倉42 on the front.

### `harbor-warehouse-3` — **KEEP**

Stills are true elevations (000 第3倉庫, 090 long red side, 180 gable + door). `seawall-v9` shows the red slab behind warehouse-8 as a **closed box**, 3 readable. Mild gable chew. Not a silo, not holes.

**Do:** none.

### `english-oak` — **REPLACE WITH PROCEDURAL**

Stills are a dense English oak (fat trunk, lightning scar, asymmetric crown), 8 custom yaws. That is the wrong primitive for visual hull.

`hill-v9` / `park-v9`: **stretched trunk columns** with swirling vertex colour, no branch forks, canopy a melted cloud. `town-v9` top-right: the same smear fused to the house eave. `park-v9` camera is inside a trunk. `photoIterations: 4` at 64³ on a leafy silhouette → organic candy, then Laplacian stretch.

**Do:** procedural oak (trunk + 2–3 ellipsoid canopy chunks, or billboard crown). 4–6 trees, not a 8 m grid. Do not reconstruct this folder.

### `weeping-willow` — **REPLACE WITH PROCEDURAL**

Stills: hanging filaments, lean trunk, 8 yaws. `quay-v9` is planted **inside** a willow — lime isosurface with a grey slash, no trunk, no drip lines, water visible only as leftover. `seawall-v9` right: three green blobs with vertical cavities. v6 already called this 90 % lime isosurface; v9 did not fix the mesh.

A weeping canopy is holes by definition. Visual hull ∩ photo-carve either fills the envelope (blob) or carves to slime. New stills will not print filaments.

**Do:** procedural willow (lean trunk + hanging card strips or a translucent shell). Slide clones inland so `quay` / `seawall` have an 8 m gap; do not add more on `z = 86`.

### `civilian-hiro` (back) — **RESHOOT**

Still `yaw-180` is a clean blazer back, A-stance, hair, centre vent. 000/090/270 match. **All eight stills stand on a pink cyclorama**, not a magenta void. Contact-shadow / floor pixels survive chroma-key.

Front clones in `sakae-v9` / `seawall-v9` / `bus-v9` / `yokobori-v9` read as cardboard people (face, briefcase, shoes). The **back** does not: `sakae-v9` foreground Hiro is a jacket with a hole, melted skull, no neck; `hill-v9` on the stairs is the same back stretched into the treads (legs drip, shoes gone). That is the cyc floor + 64³ Laplacian, not a bad 180 pose.

**Do:** magenta-fill the cyclorama under the shoes on all eight stills (feet overlap `#E040A0`, no shadow disc). Rebuild once. Do not instance more Hiros until the back has a neck. If fill still leaves a drip, replace with a procedural A-stance (capsule torso, cylinder legs, still-projected jacket) — second step, not first.

### `you-arcade` — **KEEP**

Stills 000/090/180/270 are true elevations (mosaic, SPACE INVADER '86 fascia, クラブ・ゲ blade, rear stair). `sakae-v9` mid-right and `arcade-front.png`: 2F tiled **box**, fascia readable, antenna present. Top-left parapet chewed; west edge melts into the pharmacy slot. Not holes, not a potato.

`yaw-270` is a near-duplicate of 090 (east paint on the west wall). Shape intersection still agrees.

**Do:** none for hull. Optional true west `yaw-270` later. Do not replace with a primitive — the mosaic is the north-row landmark.

---

## Ranked actions

| # | asset | action |
|---|---|---|
| 1 | `zelkova` | **replace with procedural** trunk + branch cards (24 tris is why Sakae has lollipops) |
| 2 | `honda-cub` | **replace with procedural** wheels + tank + crate (72 tris is why the Cub is two red discs) |
| 3 | `pharmacy` | **reshoot** ortho `yaw-270` + opaque 2F sash |
| 4 | `kei-van` | **reshoot** full `yaw-270` twin of 090 |
| 5 | `english-oak` | **replace with procedural** trunk + canopy chunks |
| 6 | `weeping-willow` | **replace with procedural** lean trunk + hanging strips; move off the quay camera |
| 7 | `harbor-warehouse-8` | **reshoot** ortho `yaw-000` |
| 8 | `civilian-hiro` | **reshoot** magenta-fill cyc on all 8, then look at the back again |
| — | `wooden-hill-house` | **keep** |
| — | `harbor-warehouse-3` | **keep** |
| — | `you-arcade` | **keep** |

Trees and the Cub are not stills problems. Pharmacy, Carry, warehouse-8, and Hiro stills still have a named hull-breaker (¾ / crop / cyc). Keep the three boxes that already look like their stills.
