# Park / stairs continuity

Edited only:

- `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-park.mjs`
- stone-stairs loop inside `addStreetFurniture` in `src/main.mjs`

Did not touch `map.mjs`, `addGroundPatch`, the height-field mesh, `catalog.mjs`, or `scout.mjs`. `GROUND.park` stays a buried `y = 0.02` card; the drape sits on top of it.

Time lock: Saturday 29 November 1986, 15:20. `+X` east, `+Z` south.

---

## Bug

Hill stairs were twelve 0.24 m slabs on a 1.05 m run. Each box sat
`groundHeight(-20, downhill) + 0.12`, so the downhill lip was flush but the
**riser face was a 1 cm air gap** (linear field `dy/dz ≈ 0.224`, next slab
starts ~0.235 m higher). No 石垣. From `stairs` / `soba` they read as floating
cards, not a 坂 climb.

`GROUND.park` is a flat patch at `y = 0.02` over `x −44…−12, z −48…−16`. The
height field is 1–8 m there. Park colour never showed; khaki vertex colour did.
The gravel walk was twelve **level** boxes, downhill-seated, so the uphill lip
buried ~0.24 m per segment and the strip stair-stepped.

---

## Stairs (`addStreetFurniture`)

Keep the 12-step envelope (centreline **x = −20**, width **6.5 m**, run
**1.05 m**, tread **1.12 m**, `z = −12.4 … −23.95`). Do not extend treads under
spawn `(−20, −26)`.

Per step, sample downhill / uphill lips, then thicken the box so the front
face is a riser and adjacent slabs overlap:

```
yDown = groundHeight(-20, z + 0.56)
yUp   = groundHeight(-20, z - 0.56)
rise  = max(0.24, yUp - yDown + 0.10)
y     = yDown + rise * 0.5
```

Shared `BoxGeometry(6.5, 1, 1.12)` with `scale.y = rise`. Named `hill stair`.

Cheek walls (石垣) on both sides, flush with the tread edges:

| | |
|---|---|
| x | **−23.45** and **−16.55** (`±(3.25 + 0.20)`) |
| section | **0.40 × run 1.05** |
| height | `max(0.70, treadTop + 0.58 − groundHeight(x, zDown))` |
| cap | **0.48 × 0.08 × 1.05**, stone `0x9a958c` |
| extra | **2** segments past the last tread (`z = −25.0`, `−26.05`) so the park lip is framed |

Walls sit on `groundHeight` at the cheek, not the centreline. Named
`hill stair cheek` / `hill stair cheek cap`. Colour `0x7a7670`.

Keep-out in `fill-park.mjs` is still `x −23.4…−16.6, z −24…−12`. Cheeks sit
just outside that band; south hedges still skip the mouth.

---

## Park grass + path (`fill-park.mjs`)

`drapePlane` displaces a `PlaneGeometry` (already `rotateX(-π/2)`) so each
vertex is `groundHeight(worldX, worldZ) + lift`. World sample uses the same
yaw as `mesh.rotation.y`.

| mesh | AABB / line | segs | lift | colour |
|---|---|---|---:|---|
| `park-grass` | `GROUND.park` **−44…−12 × −48…−16** | 32 × 32 | **0.04** | `0x4a5c3a` |
| `park-path-{i}` | `(−20, −16) → (−26.5, −29)`, 12 pieces, **1.36 m** wide | 1 × 4 | **0.06** | `0x9a9488` |

Grass uses `polygonOffsetFactor = −1` (height field is `+1`). Path is `−2`.
Path names stay `park-path-0…11`. Benches, hedges, lanterns, sandbox unchanged
and still seat on `groundHeight`.

Layers, bottom to top: height field → draped grass → gravel → stair treads /
cheeks. Tread thickness (~0.34 m on this field) hides grass in the mouth.

---

## What should read

| go | expect |
|---|---|
| `stairs` (−18, −14) | level treads with closed risers; 石垣 cheeks + caps; lantern 0 west of the west cheek; no hedge across the flight |
| `park` | winter `0x4a5c3a` lawn following the hill, not a buried card; gravel ribbon leaving the top landing toward the houses |
| spawn (−20, −26) | last two cheek segments in the near field; path benches 10/11 still on grade; unique house genkan open |

---

## Out of scope

- `groundHeight` formula / height-field verts (parent `09-height-field`)
- deleting `GROUND.park` from `addGroundPatch`
- densifying to 24 steps or running treads to `z = −28`
- house terrace pads (`12-suzume` 石垣 under plots)
- `fill-world.mjs` duplicate benches / hedges
