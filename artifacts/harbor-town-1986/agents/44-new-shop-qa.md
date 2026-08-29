# 44 — New-shop mesh QA (shape vs still)

Criterion: does each reconstructed mesh **look like the still** — **shape**, not just smeared colour. Photo-carve scallops and melted 瓦 are the town baseline (`soba-v5.png`, `flower-v4.png`); a pass still has to be the same building/vehicle, not a textured blob.

Stills: `ThreeBrowserRuntime/samples/harbor_town_1986/assets/<id>/yaw-000.png` (and siblings).  
Meshes: v5 scout shots in `artifacts/harbor-town-1986/`. Sample source was not edited.

| id | still `yaw-000` | mesh shot | looks like the still (shape)? |
|---|---|---|---|
| `kissaten` | 2F timber kissa, kirizuma, lace 2F, cream 港風 noren, coffee-mug board | `kissa-v5.png` centre | **PASS** |
| `hardware-shop` | 2F ochre kanagu, mid-eave, 3-bay green paint window | `hardware-v5.png` centre | **PASS** |
| `barber-shop` | 2F cream, tiled gable, **pole left**, two yellow chairs, door right | `kissa-v5.png` right; `barber-v3.png` | **FAIL** |
| `kei-van` | Suzuki Carry, round lamps, 3.2 m box | `kissa-v5.png` foreground; `street-east-v5.png` | **FAIL** |
| `yokobori-bar` | 2F timber Galaxy, vertical 銀河酒場 blade, たこ焼き noren | `kissa-v5.png` left; `yokobori-v5.png` | **PASS** |

Van **blocks** the kissa landmark. Kei-van scale **reads ~1.4 m long**, not 3.2 m.

---

## Shots and poses

v5 tour (`command.json` `t13`): `kissa-v5`, `hardware-v5`, `street-east-v5`, `yokobori-v5`.  
`barber-v3` / `barber-v3b` are older but the only clean front of Haru.

| landmark | camera (`scout.mjs`) | subject (`catalog.mjs`) |
|---|---|---|
| `kissa` | `(14, −2.5)`, yaw `0` (look south) | kissaten `(14, 8.6)`, yaw `π` |
| `hardware` | `(−34, 8)`, yaw `π` (look north) | hardware `(−34, −8.5)`, yaw `0` |
| `barber` | `(6, −2.5)`, yaw `0` | barber `(6, 8.6)`, yaw `π` |
| `yokobori` | `(20.2, 10.4)`, yaw `0.18` | Galaxy `(26, 16)`, yaw `−π/2` |
| `street-east` | `(−38, 1.8)`, yaw `π/2+0.16` | looks east down Sakae |

Kei-van is `(14.5, 3.4)`, yaw `−0.18`, `1.78 × 1.4 × 3.2` m. Same easting as the kissa. `realWorldScale` now uses `realWidth` on X and `realDepth` on Z when `realDepth > 0`.

Rectangle subjects pass `shape: { kind: "rectangle" }` and `photoIterations: 0`. That stops the silo snap; it does not invent missing silhouette.

---

## `kissaten` / Kissa Miharu — **PASS**

Still `yaw-000`: square-on 2F weathered timber. Kirizuma 瓦, green 喫茶みはる fascia, lace 2F window, balcony (red-white chair,  gull on the mid-eave), cream 喫茶 港風 / KISSATEN noren, red 珈琲 lantern, 港の珈琲 1986 board, blue コーヒー専門 mug poster, chalkboard, stone plinth. `yaw-090` / `yaw-270` are matching narrow gables (lantern + gull on the front edge of 090; lace window + meter on 270). `yaw-180` is the rear eave (door, bin, bottle crate). Best new orbit in this set — true cardinals, same building.

Mesh in `kissa-v5.png` (centre, behind the van):

- 2F timber box, not a wedge or billboard.
- Facade **layout** matches the still: centred lace 2F, mid-eave balcony, cream banners on the left bay, blue mug poster on the right bay, wood GF.
- Mid-eave is geometry (a waist), not only a colour band.
- Roof is lumpy (res 48) but there is a 2F mass under a ridge, not a flat slab.

Missing as **volumes** (expected at this resolution): gull, folding chair, lantern, antenna. Those are 000-only jewellery; 090 keeps a sliver of lantern/gull that the isosurface can drop.

**The van is in the way.** Catalog van `x: 14.5` vs kissa `x: 14`. Landmark `kissa` sits at `(14, −2.5)` looking south, so the Carry is in the south lane **between camera and shop**. GF doors / noren / chalkboard are hidden. That is placement, not a hull miss — the 2F that clears the roof of the van is still Miharu.

Verdict: the mesh **looks like** the kissa. Move the van (or the `kissa` camera) before using this landmark as a shop shot.

---

## `hardware-shop` / Yamato kanagu — **PASS**

Still `yaw-000`: square-on 2F ochre plaster, tiled roof, **mid-eave** over 大和金物塗料店 / YAMATO KANAGU & PAINT, two 2F windows (pot left, laundry balcony right), green 3-bay shop (paint-can stacks, red ペイント金物 noren, chalkboard). `yaw-090` / `yaw-270` are ochre gables with the mid-eave returning on the front edge. `yaw-180` is the rear gable (laundry, meters, wooden door). Same-building cardinals.

Mesh in `hardware-v5.png` (centre; tobacco to the east / image-right):

- 2F rectangular shop, ochre over green GF — the still’s massing.
- Mid-eave + fascia exist as a step, not a decal on a cube.
- Three GF bays, paint tins, door, chalkboard sit in the same places as `yaw-000`.
- 2F: left window and right laundry balcony are readable.
- East return in `street-east-v5.png` (far left) is a green shop-window wrap with depth, not a cardboard front.

Defects (town-baseline, not a fail): left GF undercut, ridge melted, antenna gone, jagged photo-hull outline. Compare tobacco in `soba-v5.png` — same class of box.

Verdict: the mesh **looks like** Yamato kanagu. Shape pass.

---

## `barber-shop` / Haru barber — **FAIL**

Still `yaw-000`: cream 2F, tiled kirizuma, antenna, 床屋 港町理容室 / HARU BARBER SINCE 1963, gold BARBER, **red-white-blue pole on the left**, two yellow chairs in the window, 理容 noren / door on the right, chalkboard. The pole is part of the silhouette, not trim.

`yaw-090` is the correct shallow gable with pole + chairs on the **front** (image-left) edge.  
`yaw-270` is agent 07’s blocker, **ingested anyway**: blank cream gable, **no pole, no chairs**, no front cluster. Visual hull intersects 000/090 jewellery against a empty 270 slab and **deletes the pole**.  
`yaw-180` still has the floating-slab **drop shadow** agent 07 said to magenta-fill. Dark pixels stay in alpha and chew the plinth.

Mesh in `kissa-v5.png` (right) and `barber-v3.png`:

- Cream 2F with a shop window — identity is the **front photo** (garbled 床屋 sign, yellow chairs as vertex colour on a pane).
- Left outline is a torn bite. **No pole volume.** The still’s strongest shape cue is gone.
- Roof is a ragged cap, not a kirizuma. Right of the fascia is a melt blob (mailbox / eave wrap).
- `barber-v3.png` reads as a cardboard elevation with thickness, not a gable shop. Chairs and gold BARBER are smeared colour.

What would pass: a cream 2F box **plus** a pole standing off the left jamb, chairs as a front-bay bump or at least a rectangular window hole, tiled gable. None of that is in the hull.

Verdict: **does not look like the still.** Fail is the 270 blank gable (and leftover 180 shadow), not the catalog pose.

---

## `kei-van` / Suzuki Carry — **FAIL** (shape and length)

Still `yaw-000`: square-on Carry — round lamps, chrome grille, yellow 品川 88-26, blue stripe, Ajinomoto boxes, 11/29 calendar. `yaw-090` is a **full** left-to-right side (~3.2 m, wheelbase, cargo). `yaw-180` is barn doors. `yaw-270` is still the **cab crop** from agent 05: rear half and wheels off-frame, height-normalized to the cab. Intersection of a full 090 with a cab-only 270 **carves the cargo off**. Kind is `rectangle`, four cardinals only — no 45° stills, so arches fill and corners square (`TOWN.md` wanted `custom` / 8 yaws).

Mesh in `kissa-v5.png` (foreground, ¾ rear) and `street-east-v5.png` (distant white cube):

- White appliance with a yellow plate and a blue rump stripe. That is **paint**.
- No cab vs cargo, no windshield rake, no wheel arches, no wheels.
- ¾ rear is about as deep as it is wide. A 3.2 × 1.4 Carry from this angle is a long box; this is a cube.
- `street-east-v5.png` looks east at a van whose long axis is N–S, so the image should show the **side**. It shows a white speck, not a 3.2 m van.

### 3.2 m or 1.4 m?

**Looks ~1.4 m long.**

| ruler | 3.2 m Carry would… | shot shows… |
|---|---|---|
| Length vs height (1.78 m) | side ~1.8× taller | depth ≈ height → cube |
| Length vs rear width (1.4 m) | ~2.3× the rear | ~1× the rear |
| `kissa-v5` gap to the shop | van front near the curb at `z ≈ 5` if 3.2 m along Z | compact stub in the lane, kissa clearly behind |
| `street-east-v5` | small **van** from the side | small **cube** |

Catalog is `1.78 × 1.4 × 3.2`. `realWorldScale` will stretch mesh Z to `realDepth` 3.2 m **if** a depth axis exists. A cab-only hull has almost no Z to honour; stretching a cube to 3.2 m would still look like a stretched cab, not a Carry. The v5 stills do not even show that stretch — they show a **1.4 m-class stub**. Width vs the 6.2 m barber in `barber-v3b.png` is about ¼, so **width ~1.4 m is the part that landed**.

Verdict: **does not look like the still.** Not a 1986 kei box. Fix: reshoot `yaw-270` as a full left twin of 090, add 045/135/225/315, `kind: "custom"`. Until then it will not be 3.2 m of van.

---

## `yokobori-bar` / Galaxy sakaba — **PASS**

Still `yaw-000`: **¾** (~30° toward 090) of 2F dark timber, kirizuma, BAR GALAXY ridge plate, vertical 銀河酒場 / わるえさとふ blade, blue 酒場 たこ焼き / OPEN 17:00 noren, lantern, yellow poster, green 2F shutters. `yaw-090` / `yaw-270` are matching gables (090: green window + vertical GF boards; 270: balcony + green shutter). `yaw-180` is the rear eave. Identity is stable; 000 is the flower-shop ¾ failure mode.

Mesh in `kissa-v5.png` (left, east of the kissa) and `yokobori-v5.png` (alley mouth, west front):

- 2F timber box with the Galaxy blade and たこ焼き noren in the still’s places.
- Green 2F shutter / window readable. Not a silo, not the 68k candy of agent 13 — rectangle force-shape kept a shop.
- `yokobori-v5.png` ¾ of the west face has depth (corner, return). `kissa-v5.png` shows the same front from the street.

Watches, not a fail: 000 ¾ still smears the blade onto the box instead of a projecting sign; close `bar` / `yokobori-bar.png` cameras melt into voxel timber (res 48 + ¾ bake). Kirizuma is a lump. Same class as the passing kissa / kanagu.

Verdict: the mesh **looks like** Galaxy. Do not treat `bar-front.png` (tight, melted) as the shape test.

---

## Van vs kissa (placement)

This is a **shot fail** on top of the van’s mesh fail.

```
kissa camera   x = 14.0   z = -2.5   yaw = 0     (look south)
kei-van        x = 14.5   z =  3.4   yaw = -0.18
kissaten       x = 14.0   z =  8.6   yaw = π     (front north)
```

South lane is `z ≈ 0…6`. The Carry sits on the kissa’s easting in that lane. `kissa-v5.png` is a van portrait with a coffee shop peeking over the roof. GF of Miharu is unreadable.

`van` landmark is still `{ x: 5.2, z: 9, yaw: π }` — the **old** `(4.2, 3.8)` slot, not `(14.5, 3.4)`.

To un-block: slide the van off `x = 14` (e.g. back toward `x ≈ 4–5` in front of the barber/florist gap, or east of the kissa past `x ≈ 18`), or move landmark `kissa` off-axis (`x ≈ 11` or `17`). Do not edit that in this pass.

---

## Still defects that explain the fails

| file | defect | hull effect |
|---|---|---|
| `barber-shop/yaw-270.png` | blank gable, no pole / chairs | pole and chair-bay carved off |
| `barber-shop/yaw-180.png` | grey drop-shadow under floating slab | plinth / skirt chew |
| `kei-van/yaw-270.png` | cab close-up, cargo cropped | cargo deleted; stub cube |
| `kei-van` missing 045/135/225/315 | rectangle 4-view of a rounded van | square corners, filled arches |
| `yokobori-bar/yaw-000.png` | ¾ labelled front | blade flattened; watch, not a fail this drop |

Kissaten and hardware stills are true elevations and that is why those two **pass**.

---

## Scoreboard

| id | shape vs still | notes |
|---|---|---|
| `kissaten` | **PASS** | 2F timber kissa. Van hides GF in `kissa-v5.png`. |
| `hardware-shop` | **PASS** | 2F ochre kanagu with mid-eave and paint bays. |
| `barber-shop` | **FAIL** | No pole; 270 blank gable; front is a textured cutout. |
| `kei-van` | **FAIL** | Cab stub. **Reads ~1.4 m long, not 3.2 m.** |
| `yokobori-bar` | **PASS** | 2F Galaxy timber. ¾ front is a smear-watch, not a blob. |

Two of five new/adjacent uniques look like their stills. The barber and the van do not. The van also sits in front of the one kissa shot we have.
