# v9 scout — `seawall`

Visual pass on `C:\ThreeBrowser\artifacts\harbor-town-1986\seawall-v9.png`.
No sample source edited from this note.

Landmark `seawall` `{ x: -38.5, z: 86.6, yaw: 1.62 }` (agent 31, pitch
−0.12). West apron, looking **east along the cap**. Water should sit
camera-right; warehouses camera-left; bollard beat receding.

Frame is the same photograph as `seawall-v8.png` — no visible v8→v9
delta on this look.

**Score 4/10.** Camera is no longer inside a willow (v6 was 0). Near-field
crates and a rust drum exist (v5 was 1, empty slab). It is still a warehouse
product shot on an infinite concrete table: melted sheds, clone Hiro,
broccoli willows, and a basin with **zero boats**.

---

## Dock clutter quality

Clutter **exists** in the frustum. It does not read as a working quay.

**Readable (keep the uniques):**

- Unique `oil-drum` left-foreground: rust orange, rings, stencil. This is
  the one hull that still looks like a 200 L drum.
- Timber `crate-stack` / `dock-crates` against the west shed wall. Grain
  and stacked modules survive at this FOV. A second pile sits further east.
- Two loose tires on the slab (cap-side). Small, correct scale.
- Receding primitive drums + black bitts (`roads` `z = 86`) give a beat
  down the walk.

**Fails:**

- **Camera is inside a drum.** Lower-right third of the frame is a maroon
  `CylinderGeometry` the size of a silo. Agent 47 keep-out was
  `LANDMARKS.seawall` — *nothing at the camera*. A primitive at ~1–2 m
  eats the near clip and makes every other drum look like a toy.
- **Hiro stands on the cargo.** Unique drum + pallet + crate is a
  pedestal, not a pile. The stack is the only vertical in the near field
  and it is occupied by a person.
- **Marching clones, not work.** Brown cylinders in a line, crate piles
  in a line, bollards in a line. Same props, same yaw, same spacing.
  No coil at a bitt, no hawser snake, no カゴ, no forklift, no ice
  boxes. The green “net” is a flat `BoxGeometry` tarp (fill-quay net
  pile). The tan sheet is a cardboard pancake.
- **Cap side is bald.** Everything hugs the warehouse eaves. Between the
  giant foreground drum and the wall is empty grey dock. Tires/ladders
  that should hang on the **south face** (agent 31, 16 m beat) are not
  in this along-wall shot — only two tires *on the deck*.
- Lower 40 % of the still is unmodulated `GROUND.dock`. Density is a
  strip, not a yard.

Verdict: uniques are good enough to instance; primitives at the camera
and the NPC-on-crate kill the read. Pull the near cylinder off
`(−38.5, 86.6)`, get the body off the drum, add one rope coil + one
pallet that is *not* a stool, and stop lining drums like bowling pins.

---

## Warehouse melt

Left half is still the pancake sheds from `seawall-v5` / agent 59.

- **Near clip:** west face of W8-W (`harbor-warehouse-8` inst `(−32, 72,
  π)`) is a green corrugated cliff. Camera at `x = −38.5` is ~2 m outside
  the AABB (`x ≈ −36.3…−27.8`). Ribs smear into cloth waves; the gable is
  a blob; 倉 / 42 is a beige smear, not lettering.
- **Mid:** same hull continues as a melted 上屋. Sides are wavy, not
  rectangle. Force-shape killed the cylinder snap (agent 59 PASS* on
  box-not-silo) but the ¾ still is still a potato.
- **East of the gap:** brown W3 (`harbor-warehouse-3` unique `(16, 70)`)
  reads as a better box, then a pale green third shed (W8-A) as another
  soft loaf. Three potatoes in a line, same crime as v5.

Doors face north (town), so this eastbound look only gets gable + long
wall. That is correct facing. The hulls are wrong: corrugated should be
a sharp rectangle, not an isosurface. Cheapest fix remains a new ortho
`yaw-000` still (agent 59), not more `forceCount`. Until then every
Amihama still is a warehouse product shot of melted tin.

---

## Willow scale

v6 planted a 12 m canopy on `(−32, 86)` — **6.5 m** down this look, radius
6 m, camera inside the tree (score 0). v9 is **clear of the canopy**.
Willows sit inland of the cap on the right, three receding blobs. That
placement fix landed.

What did not:

- Catalog `weeping-willow` is **12 m H × 12 m canopy**. Three clones of
  the same lime isosurface. Trunks are grey scars *through* the volume
  (you can see sky in the mesh). They read as 15–20 m broccoli, not
  waterline trees, because there is no branch structure and the nearest
  crown fills ~40 % of frame height against 1.72 m Hiro specks.
- They sit on the **apron** (`z ∈ [80, 86]` per agent 45), not the water
  side of the cap. From this eastbound seat they are a park row on the
  dock, same hull three times, not 柳 along Amihama.
- Scale vs sheds: W8 is catalogued ~8–9.5 m to ridge. The nearest willow
  overshoots the distant gables and becomes the skyline. Overlap is
  allowed (agent 45) but three 12 m clones on an 80 m quay flatten the
  district to “trees + melted tin.”

Do not add more on `z = 86`. Keep the camera gap. If the hull stays
custom-8 mush, shrink canopy toward ~8 m or thin to two, varied yaw, so
they stop matching the warehouse melt language.

---

## Missing boats in this side view

This is the shot agent 31 designed so the basin would read: water
camera-right, cap receding, tires/ladders as a beat, **漁船 in the
water**.

**Zero boats. Zero masts. Zero hulls. Zero fenders on the face.**

Right half is a knife-edge cap and empty grey that is both water and
sky. No colour break, no wet band, no far quay. Freeboard is a kerb
next to a pond that has no pond colour.

`addQuayFill` placed seven primitive boats at `z 94–108`, `x −30…40`
(nearest `(−28.0, 94.8)`, ~13 m SE of this camera, 7.4 m mast).
`quay-v9.png` (yaw 0 into the bay) at least shows those as **grey box
platforms + needle masts** on dark blue water. This along-wall seat
loses them completely:

- Wall ~2.55 m (cap `y ≈ 1.51`) hides low box cabins from eye 1.62 m
  at `z = 86.6`.
- Thin masts die against the same-grey sky.
- Water plane at grazing angle matches the sky; there is no horizon
  boat silhouette.

A side view of Amihama without a boat is a parking lot. Need one hull
**tied at the face** (`x ≈ −8…−20`, `z ≈ 92`, proud of the cap) or a
mast that actually clears the wall in this frustum. Darken the water
relative to the sky on the graze, or the boats will stay invisible even
when they exist.

---

## People clones

Three identical `civilian-hiro` hulls recede down the quay — same dark
jacket, same white shirt, same cropped head.

| # | read in still | likely pose |
|---|---|---|
| 1 | Near-left, **standing on** unique drum + crate | not agent 49 #8; planted as a statue on cargo |
| 2 | Mid, among crate stacks, walking-east silhouette | agent 49 #8 `(−30.0, 84.5, π/2)` — 8.5 m ahead of camera |
| 3 | Far speck, same jacket, same hair | extra dock clone |

Agent 49 already called unique + 8 clones **9 identical hulls** and said
do not clone Hiro further; wait for Watanabe / quay worker. This still
is the proof: a hall of mirrors on the only working waterfront walk.

Worse than the count: **#1 is on the furniture.** A 1.72 m body on a
~1 m drum+crate reads as a 2.5 m giant in the near field, then the same
mesh shrinks correctly in mid/far, so the clones advertise themselves.

Need one **different** quay-worker silhouette in this frustum, Hiro off
the drum, and no third copy on the same depth line.

---

## What to change (placement / stills, not this note)

1. Empty the `seawall` near clip — no cylinder, no NPC, no stack under
   the lens.
2. One rope coil + pallet on the cap-side walk; stop the drum bowling
   alley.
3. New ortho `harbor-warehouse-8` `yaw-000` so the left cliff is a
   rectangle.
4. Keep willows off `(−32, 86)`; thin or shrink so 12 m clones are not
   the skyline.
5. Put a boat where this side view can see it, and make water darker
   than sky on the graze.
6. Replace two of the three Hiro copies with a worker unique; get the
   remaining body on the slab.

Amihama from the west is now “cluttered film-set” instead of “empty
film-set.” The boats, the wall meeting, and the people are still fake.
