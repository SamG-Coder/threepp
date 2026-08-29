# 02 — Wooden hill house stills (visual-hull audit)

Subject: `wooden-hill-house` / Suzume-zaka timber house.
Catalog: `x = -28`, `z = -34`, `yaw = 0.42`, `realHeight = 7.4 m`, `realWidth = 8.2`, `realDepth = 7.6`, `kind = rectangle`, 4 cardinals.
Hill: `plantMesh` sits the AABB on `groundHeight(-28, -34) ≈ 3.01 m` (`map.mjs`: north of `z = -12`, `t² × 7.2`). Stills must not contain hill, turf, or a studio floor — the slope is applied at plant time.

Reported mesh: **1324 triangles** at `resolution = 48`. A consistent two-storey rectangle at that voxel size should be a filled boxy hull (many thousands of isosurface tris, or a large greedy volume). 1324 is a chewed remnant. The four stills are not the same building.

Orbit PNGs are the source JPEGs (57 / 86 / 73 / 69) with the Grok watermark already in the corner. Pipeline chroma-keys hot magenta and punches the bottom-right watermark tile (`chroma-key.mjs`).

Each view independently maps its own alpha-bbox height to world `Y ∈ [0, 1]` (`worldPerPixel = 1 / bounds.height` in `silhouette.mjs`). A shorter silhouette is stretched to the same unit height as a taller one. Detached pixels below the house inflate that bbox and shift the whole facade up in Y. Intersection then keeps only voxels that land inside **every** silhouette.

## Verdict

| Yaw | File | Source JPEG | Orthogonal? | Same two-storey height? | Ground / shadow | Magenta isolation | Hull |
|---|---|---|---|---|---|---|---|
| 000 | `yaw-000.png` | `57.jpg` front | **pass** — true front elevation | **pass** — two stacked roofs | **pass** — step + planter are attached; no floor | **pass** | keep |
| 090 | `yaw-090.png` | `86.jpg` 90 retry | **pass** — true gable elevation | **fail** — single warehouse gable | **pass** — pots sit on the plinth | **pass** | **regenerate** |
| 180 | `yaw-180.png` | `73.jpg` 180 | **pass** — true rear elevation | **pass** — two stacked roofs | **pass** — five pots at grade, overlapping the foundation | **pass** | keep |
| 270 | `yaw-270.png` | `69.jpg` 270 | **pass** — true gable elevation | **pass** — two stacked gables (the reference side) | **fail** — three pots float in a magenta gap | **pass** (house cutout is clean; pots are not planted) | **regenerate** (pots only — keep the facade) |

**Must regenerate: yaw-090.** It is a different building. 90 vs 270 have to be matching two-storey stacked-roof gables like 270, not a single warehouse / kura triangle. `86.jpg` was already a retry and still came out as the warehouse; the camera instruction below has to lock the 270 silhouette.

**Also regenerate: yaw-270**, same camera, but plant the three pots on the foundation with no gap. Do not change the stacked-gable architecture.

Keep 000 and 180.

---

## Per-yaw notes

### yaw-000 — front — KEEP

True orthographic south elevation, not 3/4. Two full storeys. Upper hip/irimoya roof + lower eave roof (stacked). Genkan with 玄関 noren, balcony with laundry, CMU planter on the **right** (east) with three pots and a winter shrub, slippers on a concrete step. Magenta void, no floor, no cast shadow. Pots and planter are fused to the house, so they do not open a hull gap.

This is the height and roof language 090 and 270 must share.

### yaw-090 — right — FAIL (wrong building)

True orthogonal gable, so the camera angle is not the problem. The **silhouette is a one-storey warehouse / dozo**: one big kirizuma triangle, blank plaster with a timber grid, full-width CMU plinth, no upper storey, no mid-eave, no balcony wrap, no lattice window. Peak-to-plinth is one attic, not two stacked gables.

Because each view is height-normalized on its own bbox, this squat triangle is stretched onto the same `Y = 0…1` as the two-storey 000/180/270. The hull intersection is then:

- triangle (090) ∩ stacked-gable (270) ∩ hip-box (000/180)

That carves off the second storey, the mid-eave overhangs, and the 270 waist. Photo-consistency then eats leftover voxels whose plaster-warehouse colour disagrees with the timber house. Result: ~1324 tris.

86.jpg is this same still. A retry that says “side of the hill house” without locking **270’s stacked gables** will keep emitting a kura.

### yaw-180 — back — KEEP

True orthogonal north elevation. Same two-storey stacked hip roofs as 000 (eave bands, not a gable). Rear door, wall lamp, metre, one upper window with laundry. Five pots sit **at the foundation line**, overlapping the plinth in the silhouette — not a magenta slab. No floor, no drop shadow. Keep. Do not “clean up” the pots by floating them.

### yaw-270 — left — KEEP facade / FAIL pots

True orthogonal west gable, and this is the **correct side of the 000/180 house**: two stacked kirizuma gables, onigawara on both ridges, upper timber frame with peeling plaster, lower lattice window over wood wainscot, balcony rails wrapping front and back, downpipes. Silhouette height matches 000/180 (two storeys + two roofs).

**Floating pots will carve.** Three pots hang well below the foundation with a full-width magenta band (~8–12 % of the frame). Effects in `carveVisualHull` + `keepGroundConnected`:

1. Alpha-bbox grows to include pots + gap + house. `worldPerPixel` shrinks. The house body maps to a **higher** slice of unit Y than 000/180 (where Y = 0 is the step/plinth).
2. The magenta gap is empty occupancy, so that Y-band is carved out of the **whole** volume — a through-slab across the first storey of the other views.
3. Pot blobs at Y ≈ 0 only survive if they also sit inside 000/180/090 silhouettes. 000’s pots are in the east planter; 270’s are centred under the west gable. They mostly miss. If nothing remains at Y = 0, the lowest occupied slab is the elevated 270 foundation and the bottom of the other views is already gone. If a pot speck survives, flood-fill from lowest Y cannot cross the gap and **drops the house**.

090’s pots (on the warehouse plinth) are attached, so they do not open a gap — they are irrelevant once 090 is the wrong building. After 090 is remade as stacked gables, pots must sit on the foundation like 000, not float like 270.

---

## What to regenerate

### 1. yaw-090 (required)

Replace `yaw-090.png`. Do not reuse 86.jpg.

**Camera**

- True **orthographic right / east elevation**. Camera on +X, looking −X. Not 3/4, not a roof three-quarter, not a street photo.
- Same lens height and subject scale as `yaw-270.png` / `69.jpg`. Ridge and plinth must land on the same frame rows as 000/180/270 so bbox heights agree.
- Hot magenta studio (`#E040A0`-class). Isolated. **No floor, no turf, no hill, no cast shadow.**

**Building (must match 270, not a warehouse)**

- The **other gable end of the same two-storey Suzume-zaka house** as 270.
- **Two stacked kirizuma gables**: upper roof + lower roof, two onigawara, mid-eave waist. Same silhouette height as 270. Forbidden: single warehouse triangle, kura, dozo, one-storey plaster barn, harbor-warehouse-8 language.
- Cream plaster, dark timber frame, grey-green ceramic tile, peeling lime, winter 1986 overcast. Lower storey: wood wainscot or a window, not a blank grid wall on a full-width CMU warehouse plinth.
- Front of the house is **camera-left** on this still (yaw-90 `right` vector is −Z). The **CMU planter from 000** lives on the front-east corner — a low box on the left edge, not a foundation under the whole gable.
- Back of the house is camera-right. Small eave / downpipe ok; no extra wing that 180 does not have.

**Pots**

- If pots are in the shot, they sit **on the foundation / planter**, touching the building. No magenta between pot rim and plinth.

### 2. yaw-270 (required, pots only)

Re-shoot or inpaint `yaw-270.png` from `69.jpg` **without moving the house**.

- Same stacked-gable elevation, same framing as now for the **house**.
- Either drop the three pots or plant them on the grey foundation so they overlap the plinth the way 180 does.
- No magenta gap under the house. House bottom is the alpha-bbox bottom (plus a few pixels of attached pots, not a second island).

### 3. Do not regenerate

- `yaw-000.png` / 57.jpg
- `yaw-180.png` / 73.jpg

---

## Hull checklist after the new stills

All four silhouettes: two-storey, stacked roofs, ridge and plinth at the same fraction of the frame, one connected alpha blob, magenta only in the void. 90 and 270 are gable twins; 000 and 180 are eave twins. Then `tris` should jump well above 1324 and the mesh should read as a rectangular two-storey house on the Suzume-zaka hill, not a carved shard.
