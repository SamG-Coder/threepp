# 59 — Hull vs still (silhouette QA)

Do **not** edit sample source from this note.

Question: does each reconstructed mesh **look like its still** — silhouette / massing, not smeared paint. Melted 瓦 at res 48 is town baseline (`hardware-v5`, `kissa-v5`). Fail = over-carve holes, melted-off gable, cab-only van, hover, wrong facing, or a blob that is not the object.

Stills: `ThreeBrowserRuntime/samples/harbor_town_1986/assets/<folder>/yaw-000.png` (+ siblings).  
Runtime: v5 tour `artifacts/harbor-town-1986/*-v5.png` plus older close-ups (`barber-v3`, `flower-v4`, `house-v4`, `soba-front`, `arcade-front`, `pharmacy`, `sakae-north`).

Pipeline (`main.mjs` `reconstructSubject`): catalog `shape` forced, `forceCount: catalog.length`, **`photoIterations: 0` on rectangle/square**, 4 on custom/humanoid. `resolution` 48 except `realHeight < 2.2` → **32** (Cub, Hiro). `forceCount` is already wired; it will not un-carve a bad still.

---

## Scoreboard

| id | still silhouette | in-game blob | flags | **verdict** | cheapest fix |
|---|---|---|---|---|---|
| `pharmacy` | mint 2F box, mortar fascia, solid 090 gable | `sakae-v5` / `pharmacy.png`: sky through fascia + 2F | **holes**, ¾ `yaw-270` | **FAIL** | **new ortho `yaw-270`** (mirror of 090) |
| `you-arcade` | mosaic 2F prism, parapet, fascia | `sakae-v5` / `arcade-front.png`: box, fascia readable | west chew; `yaw-270` ≈ 090 | **PASS** | optional true west `yaw-270` (not hull-breaker) |
| `wooden-hill-house` | 2F stacked kirizuma; 090/270 now twins | `hill-v5` / `house-v4`: stacked gables, lattice, seated on slope | eave melt (baseline) | **PASS** | none (090 warehouse still is gone) |
| `kei-van` | Carry 3.2 m, full `yaw-090` | `kissa-v5`: white **cab stub**; `street-east-v5`: cube speck | **cab-only**, `yaw-270` crop | **FAIL** | **new full `yaw-270`** (twin of 090) |
| `harbor-warehouse-8` | corrugated gable cube; **`yaw-000` still ¾** | `seawall-v5`: **box not silo**, wavy sides, 倉 smeared | melted gable; ¾ front | **PASS*** | **new ortho `yaw-000`** |
| `kissaten` | 2F timber, lace 2F, mug poster, noren | `kissa-v5` centre: same layout; van hides GF | lumpy roof (baseline) | **PASS** | none (move van is placement, not hull) |
| `hardware-shop` | 2F ochre, mid-eave, 3-bay paint | `hardware-v5`: mid-eave + tins + laundry | left undercut, lid roof | **PASS** | none |
| `soba-shop` | street-facing kirizuma + flag | `soba-v5` / `soba-front.png`: **flat melted cap**, flag wisp | **melted gable**; 270≠090 | **FAIL** | **new ortho `yaw-270`** (twin of 090, flag on **image-right**) |
| `flower-shop` | mint clapboard, みどり, awning, pots | `flower-v4`: 2F green box, sign reads, not a wedge | chewed corners, no awning volume | **PASS** | optional magenta-void already on 180 |
| `barber-shop` | cream 2F, **pole left**, two yellow chairs | `kissa-v5` / `barber-v3`: torn cutout, **no pole**, chairs = paint | no pole; blank 270; 180 shadow | **FAIL** | **new `yaw-270` with pole + chairs on front edge** |
| `city-bus` | full 000/090/180/270, matching 南浜 | **no runtime shot** (`bus` landmark unused in t13) | contact **shadows** on all 4 | **UNVERIFIED** | magenta-fill the four contact shadows; shoot `bus` |
| `zelkova` | sparse Nov crown, thin trunk, 8 yaws | `soba-front` gap: grey smear; v5 street: **no trees** | over-carve / filled envelope | **FAIL** | **`photoIterations: 0`** (custom still runs 4) |
| `honda-cub` | Super Cub + 牛乳 crate, skinny step-through | `soba-front` / `sakae-north`: **two red wheel discs**, no body | wheel-only; **hover** on 270 | **FAIL** | **de-hover `yaw-270` + opaque wheels** (then `kind: custom`) |
| `civilian-hiro` | 8-view blazer A-stance on cyc | `sakae-v5` / `street-east-v5`: **not in the PNG** | floor/chroma; res 32 | **FAIL** | **magenta-fill cyclorama under shoes** |

\*Warehouse 8 is a **pass vs the old silo** (force-shape worked). It is still a wavy pancake vs the still’s cube — fix the ¾ front, do not bump `forceCount`.

**5 PASS / 8 FAIL / 1 UNVERIFIED.**

---

## Pipeline notes (do not re-litigate)

```396:419:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
async function reconstructSubject(subject) {
  …
    forceCount: catalog.length,
    photoIterations: subject.kind === "rectangle" || subject.kind === "square" ? 0 : 4,
    shape: { kind: subject.kind, generic: …, recommendedCount: catalog.length },
```

- Rectangle shops already skip photo-carve. Holes in the pharmacy are **silhouette intersection + Laplacian**, not photo-carve.
- `forceCount` only feeds `chooseOrbitAngles`’s report. Passing 8 on a 4-file folder does nothing. Cub/bus/van need **new PNGs**, not a bigger count.
- `realHeight < 2.2` drops Cub and Hiro to **32³**. That is fatal for a spoke wheel and a 1.72 m person; it is not the first Cub fix (270 is).

---

## Per asset

### `pharmacy` — **FAIL (holes)**

Still `yaw-000`: mint tile, mortar/pestle, 「港町薬局」, packed 1F, open 2F sash. `yaw-090` is a **true** gable (solid tile, vent, rear window). **`yaw-270` is still the ¾ wreck** (shopfront + 港町薬局 board + upstairs sash transplanted onto the left wall).

Mesh in `sakae-v5` / `pharmacy.png`: through-holes at the mortar logo, 2F sash, 1F orange puncture, west party wall chopped. Sky in the building.

**Cheapest fix: new orthographic `yaw-270`.** Copy `yaw-090`’s camera; put AC / bucket / 薬 noren on **image-right**; side wall is tile only. Do not transplant the front sash. Isolated `#E040A0`, no floor. `photoIterations` is already 0; `forceCount` is already 4.

---

### `you-arcade` — **PASS**

Still `yaw-000` is a true front (mint mosaic, ファミリーゲームセンター / SPACE INVADER '86, parapet). Mesh in `sakae-v5` / `arcade-front.png` is a 2F tiled **box**, fascia readable, antenna present. Top-left roof chewed; west edge melts into the pharmacy slot. Not holes, not a potato.

`yaw-270` is still a near-duplicate of 090 (クラブ・ゲ face-on, image-left). Bake paints the east blade on the west wall. Shape intersection still agrees, so this is polish.

**Cheapest fix:** none for hull. Optional true west elevation later.

---

### `wooden-hill-house` — **PASS**

Agent 02’s 090-as-warehouse is **gone**. Current `yaw-090` / `yaw-270` are stacked-gable twins; pots sit on the plinth (270 no longer floats a magenta slab).

`hill-v5` (close gable) and `house-v4` (from the stairs) show two storeys, lattice, timber, CMU planter, **seated on the slope** — not the 1324-tri shaft, not hover, yaw 0.42 reads as a ¾ of the genkan house.

**Cheapest fix:** none.

---

### `kei-van` — **FAIL (cab-only)**

Still `yaw-090`: full 3.2 m Carry. **`yaw-270` is still the cab crop** (rear half and wheels off-frame; empty wheel well). Height-normalize a close-up against a full side → cargo carved off.

`kissa-v5`: white appliance, yellow 88-26, blue stripe, **depth ≈ width ≈ height**. `street-east-v5`: cube speck, not a 3.2 m side. Sits on asphalt (not hover). Facing is fine (rear to the kissa camera).

`kind: rectangle`, 4 views, photoIterations 0 — cannot invent the missing half.

**Cheapest fix: reshoot `yaw-270` as a full left twin of 090** (nose camera-left, both wheels, barn-door tail in frame, wheels on magenta, no shadow). Diagonals / `kind: custom` after that, not before.

---

### `harbor-warehouse-8` — **PASS** (box, not silo)

Still `yaw-000` is still a **perspective ¾ cube** (倉42 + long wall in frame). `yaw-090` is a true gable.

`seawall-v5` / `yokobori-v5` / `harbor-approach.png`: green **rectangle** with a lumpy gable. Force-shape killed the cylinder snap. Sides are wavy pancakes; 倉 smears. Doors face the inland camera (`yaw: π` → local front north). Not wrong-facing.

**Cheapest fix: new orthographic `yaw-000`** (square to 倉42, long wall invisible). Do not raise `forceCount`.

---

### `kissaten` — **PASS**

Still `yaw-000` / 090 / 270 agree (kirizuma, lace 2F, 港風 noren, mug poster). `kissa-v5`: 2F timber box, same bay layout, mid-eave as geometry. Van at `(14.5, 3.4)` blocks GF — **placement**, not hull.

**Cheapest fix:** none.

---

### `hardware-shop` — **PASS**

`hardware-v5`: ochre over green, mid-eave step, paint-can bays, 2F laundry. Same building as `yaw-000`. Lid roof / left GF undercut = baseline.

**Cheapest fix:** none.

---

### `soba-shop` — **FAIL (melted gable)**

Still `yaw-000`: cream 2F with **street-facing kirizuma** and striped flag. `yaw-090` is now a true east elevation (flag thin on **image-left**). **`yaw-270` is not a left elevation**: gable-on-camera, flag still on image-left (should be image-right), concrete pad.

`soba-v5` / `soba-front.png`: body is a box; the triangle that is the still’s silhouette is a **melted cap**. Flag is a vertical wisp. Paint (ラーメン / noren) survives.

**Cheapest fix: new ortho `yaw-270`**, twin of 090: ridge centred, lattice, **no** ラーメン fascia facing camera, flag profile on **image-right**, plinth on magenta (no pad).

---

### `flower-shop` — **PASS**

`yaw-000` is now square-on (agent 25 #3 looks landed). `yaw-180` is a clean rear void (no oval shadow). `flower-v4`: mint 2F, 花屋みどり readable, door, depth — **not** the old thin wedge. Chewed corners, awning is paint, pots are lumps. `street-east-v5` south-right mint box matches. Front faces the street (`yaw: π`).

**Cheapest fix:** none. (`flower-front.png` is a grey teardrop filling the lens — that is a **zelkova** too close to the flower camera, not the florist hull.)

---

### `barber-shop` — **FAIL**

Still `yaw-000`: pole **left**, two yellow chairs, 理容 door right. `yaw-090` has pole + chairs on the front (image-left) edge. **`yaw-270` is a blank cream gable** — no pole, no chairs. Intersection deletes the pole. `yaw-180` still has a **grey drop-shadow** under a floating slab.

`kissa-v5` / `barber-v3` / sakae-v5 fg: cream cardboard with a torn left bite, chairs as vertex colour, **no pole volume**, ragged cap. Facing is correct (south-row, front north).

**Cheapest fix: new `yaw-270`** — shallow gable the width of 090, pole + chairs at the **front** edge (image-right). Magenta-fill the 180 shadow in the same pass if cheap; 270 is the hull-breaker.

---

### `city-bus` — **UNVERIFIED**

Stills are the best vehicle orbit in the set: square-on 南浜 front, full 090, matching 270, full rear. Kind rectangle, photoIterations 0, 3.05 m → res 48. Predicted hull: a 10.4 m box with filled arches.

All four stills carry a **contact shadow**. Those pixels survive chroma-key and either grow a dark foot or, after bbox normalize, **hover**. No `*-v5` includes landmark `bus` `(-32, 18)`.

**Cheapest fix: magenta-fill the four shadows** (wheels on `#E040A0`, no grey oval). Then shoot `bus`. Do not add 45° stills until a shot exists. `forceCount` already 4.

---

### `zelkova` — **FAIL**

Eight custom yaws, sparse November crown, magenta through every branch. Unique `(-20, -6.7)` sits in the tobacco–soba hole; 16 instances line both curbs at `z = ±6.7`.

`sakae-v5` / `soba-v5`: **treeless**. `soba-front.png` gap: a grey-green smear, not a trunk+crown. `flower-front.png`: fat grey teardrop between camera `(-10, -2.5)` and the harbor — south-curb instance at `(-8, 6.7)` filling the frustum.

Custom still runs **`photoIterations: 4`**. Sparse silhouettes ∩ photo-carve → nothing, or a convex envelope blob. `forceCount` is already 8.

**Cheapest fix: `photoIterations: 0` for this subject** so the visual-hull envelope stays a winter crown volume. New stills cannot put 3D twigs in a 48³ hull.

---

### `honda-cub` — **FAIL (wheel discs + hover)**

Still `yaw-000` is now a real Cub front (round lamp, skinny fender). `yaw-090` is a full left (crate, muffler, wheels on magenta). **`yaw-270` floats** (grey shadow, wheels off the plane). `yaw-180` has magenta **through the tyre**. Kind is **`rectangle`** with four cardinals (`TOWN.md` wanted custom / 8). Height 1.05 m → **res 32**.

In-game (`soba-front.png` right of Yaoya, `sakae-north.png` left edge, `arcade-front.png` / `barber-v3b` red rings): **two concentric wheel discs**, no tank, no crate, no wheelbase. Classic spoke-punch + 270 hover + 4-view bike.

Yaw `π/2` (nose east) is correct; the object is not a Cub.

**Cheapest fix: edit `yaw-270`** — plant wheels on magenta, delete the shadow (same pose). While open, fill spoke interiors in 000/180 so wheels are **opaque discs**. After that, `kind: "custom"` + 045/135/225/315. `photoIterations` is already 0; `forceCount` 8 without the 45° PNGs is a no-op.

---

### `civilian-hiro` — **FAIL (absent)**

Eight humanoid stills, A-stance blazer, shoes on a **pink cyclorama** (not a void). Unique `(-9.2, -7.3, π)` at Yaoya’s door, instances at arcade / south walk / dock. `realHeight: 1.72` → **res 32**, photoIterations 4.

`sakae-v5` (20 m from him) and `street-east-v5` (agent 41: in frustum): **no person**. Floor pixels either steal the ground flood-fill or chroma-key leaves a pedestal that Laplacian eats.

**Cheapest fix: magenta-fill the cyc under the shoes** on all eight stills (feet overlap a `#E040A0` void, no shadow disc). Do not instance more Hiros until one reads as a humanoid. Raising res is a second step.

---

## Ranked cheapest actions

| # | asset | action |
|---|---|---|
| 1 | `pharmacy` | **new `yaw-270`** true left gable |
| 2 | `kei-van` | **new full `yaw-270`** |
| 3 | `barber-shop` | **new `yaw-270`** with pole + chairs |
| 4 | `honda-cub` | **de-hover `yaw-270`**, opaque wheels |
| 5 | `soba-shop` | **new `yaw-270`** twin of 090 |
| 6 | `harbor-warehouse-8` | **new ortho `yaw-000`** |
| 7 | `zelkova` | **`photoIterations: 0`** (source; stills OK) |
| 8 | `civilian-hiro` | magenta-fill floor on the 8 stills |
| 9 | `city-bus` | magenta-fill contact shadows; shoot `bus` |

Not on the list: arcade / hill-house / kissa / hardware / flower — silhouettes already match. Do not spend `forceCount` on rectangles; it is already `catalog.length`.
