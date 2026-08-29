# 27 — Route 16 strip

West-edge arterial of Minamihama. Spec only — do not edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20, overcast winter, wet asphalt from earlier drizzle.

## Bounds

`TOWN.md`: **route16** origin **(-48, 8)** size **24 × 80**. Metres, +X east, +Z south.

Treat origin as the north-west corner (min X, min Z):

| | x | z |
|---|---|---|
| NW origin | -48 | 8 |
| SE far corner | -24 | 88 |
| AABB | -48 … -24 | 8 … 88 |

Sakae-dori is the E–W shopping street; this strip is the N–S national-highway shoulder that meets it at the west end and runs south along the harbour. Nav node already exists: `route16` at **(-40, 4)** edged to `sakae-west`.

```
        x=-48                         x=-24
    z=8   +---- T-junction with Sakae (asphalt already here) ----+
          | W verge | 2 lanes N-S | walk | lot / bus / parking  |
    z=16  |         |             | stop |                     |
    z=24  |         |             |      | kei bays            |
    z=52  | waterfront lanes west of Amihama dock              |
    z=84  | asphalt ends before water (z=88)                   |
    z=88  +----------------------------------------------------+
```

## Current occupancy (almost empty)

Nothing in catalog is tagged `district: "route16"`. The strip currently borrows two nearby Sakae props:

| what | pose | notes |
|---|---|---|
| `vending-enamel` **instance** | x **-31**, z **6.0**, yaw `π` | South sidewalk of Sakae, front faces north into the street. On the north lip of this AABB (2 m north of z=8). **Keep.** |
| `telephone-pole` unique | x **-22**, z **5.6**, yaw 0 | Just east of the district line. Do not move. |

Sakae E–W asphalt already covers `minX -48, maxX 48, minZ -8, maxZ 12`. Sidewalk S stops at `minX -40`. South of z=12 the west corridor is bare height-field until Amihama dock (`minZ 52, minX -40`). That gap is this district.

## 1. Road patch (N–S asphalt)

Add two `GROUND` patches (same `addGroundPatch` path as Sakae). Colour **0x3a3a3c**, y **0**, match existing wet asphalt. Overlap Sakae by ~2 m so the T-junction has no seam. Stop before water at z=88.

```
route16Road: {
  minX: -46.5, maxX: -36.5, minZ: 10, maxZ: 52,
  y: 0, color: 0x3a3a3c,
}
route16Quay: {
  minX: -47.0, maxX: -40.2, minZ: 50, maxZ: 84,
  y: 0, color: 0x3a3a3c,
}
```

`route16Quay` sits **west of the dock** (`dock.minX = -40`) so the highway becomes a waterfront service road without covering Warehouse 8/3.

Optional third patch — parking apron, slightly browner so stall paint reads:

```
route16Lot: {
  minX: -34.5, maxX: -25.5, minZ: 20, maxZ: 34,
  y: 0.02, color: 0x4c4a46,
}
```

Sidewalk, same raised concrete as Sakae south:

```
route16Walk: {
  minX: -36.5, maxX: -34.5, minZ: 10, maxZ: 50,
  y: 0.08, color: 0xb7b1a4,
}
```

### Cross-section (z = 16, west → east)

| x | band | width |
|---|---|---|
| -48.0 … -47.2 | grass verge | 0.8 |
| -47.2 | W-beam guardrail (boxes) | — |
| -46.5 … -42.5 | southbound lane | 4.0 |
| -42.5 | yellow dashed centreline | — |
| -42.5 … -36.5 | northbound lane | 6.0 |
| -36.5 … -34.5 | sidewalk | 2.0 |
| -34.5 … -25.5 | bus platform + parking lot | 9.0 |
| -25.5 … -24.0 | east verge toward town | 1.5 |

Northbound is the wider town-side lane so a bus bay can sit in it without a new mesh.

### Centreline dashes

Sakae dashes are E–W gold boxes at z=2: `BoxGeometry(1.85, 0.03, 0.14)`, colour **0xc9b56a**, step 4.4 m.

Route 16 dashes run **N–S** on x = **-42.5**:

```
BoxGeometry(0.14, 0.03, 1.85)
for (z = 14; z <= 80; z += 4.4)  position ( -42.5, 0.03, z )
```

Skip z ∈ [16, 24] in the northbound lane if the bus bay paint is drawn there (bay edge is more useful than a dash through the stop).

## 2. Bus-stop simple boxes

No unique mesh this pass. Same language as stairs / harbour wall: `BoxGeometry` + `MeshStandardMaterial`, cast/receive shadow, sit on `groundHeight`.

Place on the **east (town) shoulder**, just south of the Sakae T, so a walk from `sakae-west` hits it in seconds.

**Sakae-nishi stop** — shelter origin **(-35.2, 18.5)**. Open side faces the road (west, -X).

| piece | geometry (x, y, z) | world position | material |
|---|---|---|---|
| Platform slab | 8.0 × 0.12 × 1.9 | (-35.2, 0.06, 18.5) | stone **0x8a8680**, roughness 0.92 |
| Post ×4 | 0.08 × 2.15 × 0.08 | corners of 3.6 × 1.35 rectangle around (-35.2, 18.5) | steel **0x6a6e68** |
| Roof | 4.0 × 0.07 × 1.55 | (-35.2, 2.22, 18.5) | faded green **0x3d5a44**, slight -X tilt ~4° so rain dumps toward the kerb |
| Bench seat | 2.2 × 0.07 × 0.34 | (-34.55, 0.46, 18.5) | timber **0x6b5340** |
| Bench legs ×2 | 0.06 × 0.42 × 0.30 | under seat, ±0.9 m in Z | steel |
| Sign pole | 0.07 × 3.2 × 0.07 | (-36.15, 1.6, 16.6) | steel |
| Sign blade | 0.92 × 0.62 × 0.05 | (-36.15, 2.85, 16.6) | enamel green **0x1f5c3a** (blank — no shop brand, no Dobuita type) |
| Timetable box | 0.28 × 0.42 × 0.08 | (-35.55, 1.35, 16.85) | **0xcfc6b0** |
| Kerb of bus bay | 0.35 × 0.18 × 10.0 | (-36.55, 0.09, 19.0) | stone |

Bay paint (optional, same gold as dashes, thinner): a 10 × 2.6 rectangle of four edge boxes in the northbound lane, z=14.5…24.5, x=-39.2…-36.6. This is the layover slot for the **future bus mesh**.

Do not put a bus body out of boxes. A 10 m box reads as a cargo container, not a 1986 city bus.

## 3. Parking slots + kei van instance

Lot on the town side, immediately **south of the shelter**, so one south-looking camera sees stop then van.

Three perpendicular bays, nose-in toward the highway (front faces west, -X).

Kei van unique is already on Sakae (`4.2, 3.8`, yaw -0.18). **Instance a second Carry** here — do not move the unique. Catalog size: **1.4 × 3.2 × 1.78 m**. Yaw-000 is the grille; `rotation.y = -π/2` points the nose at -X.

Bay size **2.3 × 4.6 m**, aisle on the east. Wheel-stop at the west (highway) end of each bay.

| slot | bay centre (x, z) | yaw | occupant |
|---|---|---|---|
| A | -29.6, 24.4 | -π/2 | empty |
| B | -29.4, 27.6 | -π/2 + 0.10 | **`kei-van` instance** (crooked, Saturday errand) |
| C | -29.6, 30.8 | -π/2 | empty |

Add to `INSTANCES`:

```
{ asset: "kei-van", x: -29.4, z: 27.6, yaw: -Math.PI / 2 + 0.10 }
```

Stall paint: faded white **0xd0ccc4**, roughness 0.85, y=0.04 on the lot patch. Each bay = two 4.4×0.04×0.08 side lines + one 2.1×0.04×0.08 back line. Wheel-stop: `1.55 × 0.12 × 0.14`, stone, at x=-31.6 for each slot.

Leave ≥1.2 m between van body and shelter posts (van depth 3.2 m, nose at ~-31.0). No collision with the vending at z=6.

## 4. Other boxes / instances (cheap highway read)

Guardrail along the **west verge**, z=12…82, x=-47.2. Same trick as the harbour wall — boxes, not a mesh.

- Posts every 2.0 m: `0.08 × 0.72 × 0.08`, galvanised **0x8a9088**, y=0.36
- W-beam: one long `0.04 × 0.32 × 2.0` per span, y=0.55, or a single run broken at the T-junction
- Gap the rail at z=8…12 (Sakae mouth) so the street opens west

Telephone poles — TOWN.md feel list. Instance the existing cylinder every ~20 m on the **east verge**, skipping the shelter:

```
{ asset: "telephone-pole", x: -34.2, z: 32, yaw: 0 }
{ asset: "telephone-pole", x: -34.2, z: 52, yaw: 0 }
{ asset: "telephone-pole", x: -34.2, z: 72, yaw: 0 }
```

Do not add a second vending; the corner machine at (-31, 6) already marks the junction.

## 5. Landmark

Add `LANDMARKS.route16` for `minamihamaGo('route16')` / `command.json` `{ "go": "route16" }`. Keys 1–9 already map the first nine insertion-order landmarks; this one is named, not numbered.

Stand on the east sidewalk at the T, look **south-southwest** down the highway so the shelter, stall paint, and van fill the frame, with Sakae vending at the left shoulder.

```
route16: { x: -33.0, z: 11.8, yaw: -0.38, pitch: 0.05 }
```

Yaw 0 looks +Z (south); -0.38 yaws a little west toward the carriageway.

Optional close-up (not required): `route16-stop: { x: -33.4, z: 16.2, yaw: -1.15, pitch: 0.08 }` looking at the sign + bench.

Nav: keep `{ id: "route16", x: -40, z: 4 }`. Optional extra node `route16-stop` at **(-34, 18)** edged from `route16` — only if someone is already touching `nav-graph.json`.

## 6. Next unique mesh: bus, not guardrail

**Generate a 1986 city bus.** Leave the guardrail as boxes.

| | bus | guardrail |
|---|---|---|
| District promise | TOWN.md feel is “Bus, parking, telephone poles” | trim |
| Silhouette from Sakae-west | 10 m body, the only large thing on this strip | a line on the far verge |
| Visual hull | boxy 80s bus (Isuzu Cubic / Fuso MK class) is a **rectangle** — 4 cardinals, same as the Carry | thin W-beam; studio stills collapse to a card; better as the harbour-wall boxes already specified |
| Instancing | one layover in the bay at z≈19 | would need 30+ copies of a bad hull |
| Overlap with existing | Carry already covers small parked vehicle; bus is the missing scale | poles already give verticals |

### Bus stills (when an asset agent picks this up)

- Folder `city-bus`, id `city-bus`, kind **rectangle**, district **route16**
- Magenta studio (#E040A0), isolated, no floor, no cast shadow, 4 cardinals
- Real metres: **height 3.05, width 2.49, depth 10.4**
- Two-tone cream over dark green, destination blind **南浜** / **Amihama** (original names — not a Yokosuka / Dobuita clone)
- Parked in the painted bay, heading south so the front reads from the landmark:

```
{ id: "city-bus", x: -38.2, z: 19.5, yaw: 0, … }
```

`yaw: 0` → grille faces +Z (southbound layover). Clearance: ≥0.4 m from kerb box, ≥1 m from shelter posts.

Guardrail unique is not worth a stills pass. If a second mesh is needed after the bus, a **Route 16 roadside shield** (square enamel, ~1.1 m, 4 cardinals) is cheaper than a rail segment and hangs on the existing sign pole.

## Implementation map (later agent)

| change | file |
|---|---|
| `GROUND.route16Road`, `route16Quay`, `route16Walk`, `route16Lot` | `src/map.mjs` |
| N–S dashes, shelter boxes, bay paint, stall lines, wheel-stops, west guardrail | `addStreetFurniture` in `src/main.mjs` |
| kei-van instance + 3 poles | `INSTANCES` in `src/catalog.mjs` |
| `LANDMARKS.route16` | `src/scout.mjs` |
| bus orbit stills + catalog subject | assets + catalog, **after** this furniture exists |

Do not retag the unique Carry or the (-31, 6) vending. Do not invent a bus out of boxes.
