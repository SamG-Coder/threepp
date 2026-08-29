# 30 — Denser pole / vending / warehouse `INSTANCES`

Do **not** edit `catalog.mjs` from this note. Parent replaces the
`INSTANCES` array. Unique `ORBIT_SUBJECTS` poses stay as the one-off
meshes; this list is clones only.

## Rules honoured

- Poles on both Sakae curbs, **x = −36 … 36**, **z = 5.6** (south) and
  **z = −6.2** (north), beat **~18–22 m**.
- Enamel vending **flanks** arcade, soba, records (both lot lines) and
  the Yokobori **alley mouth** (both jambs).
- **One extra** warehouse, and only because its pad is clear.
- **No** unique shop facades (`soba-shop`, `you-arcade`, `cassette-shop`,
  `tobacco-shop`, `greengrocer`, `flower-shop`, `yokobori-bar`,
  `wooden-hill-house`, …). Repeatable kit only: pole, vending,
  `harbor-warehouse-8`.

`ORBIT_SUBJECTS` already plants the master pole at **(−22, 5.6)**, the
master vending at **(−6.2, −5.4)** (Yaoya, not a requested flank),
Warehouse 8 at **(−12, 72)**, Warehouse 3 at **(16, 70)**. Do not clone
those origins.

## Poles

South curb keeps the three clones that already exist (**−4, 16, 36**)
and adds the west terminus **−36**. The unique pole fills **−22**, so
the west span is 14 m — that is the unique mesh, not a second clone on
top of it.

| curb | z | x | spacings (m) |
|---|---|---|---|
| south | 5.6 | **−36**, (−22 unique), **−4**, **16**, **36** | 14, 18, 20, 20 |
| north | −6.2 | **−36**, **−20**, **0**, **20**, **36** | 16, 20, 20, 16 |

North is a 20 m interior grid, staggered 2–4 m vs south so the street
does not read as a ladder. End spans sit a little under 18 m because
72 m / 20 m does not land on both termini; 5 poles per curb is the
18–22 m count (4 poles would be 24 m). North **−20** (not **−18**)
keeps a 2.1 m gap to the soba-west vending.

Dropped: north clones at **−22** and **28** (too close to the new grid).

## Vending

North-row machines share the unique enamel pose: **z = −5.4**, **yaw = 0**
(face south onto Sakae). Centres sit ~0.5–0.8 m outside each façade.

| shop | façade x | west clone | east clone |
|---|---|---|---|
| Nishiya soba | −17.2 … −10.8 | −17.8 | −10.3 |
| Starlight Arcade | 4.0 … 12.0 | 3.5 | 12.5 |
| Minato-machi records | 16.6 … 23.4 | 15.9 | 24.1 |

Yokobori mouth is the north face of Galaxy sakaba (**x = 26, z = 16**,
plan 6.2 × 7.4 → x 22.9…29.1, z 12.3…19.7) where the alley cobble meets
Sakae at **z ≈ 12**. Pair at the jambs, **yaw = 0**, facing into the
alley:

- **(22.2, 11.2)** and **(29.8, 11.2)**

Dropped the unfocused clones at **(18.5, −5.4)**, **(−31, 6.0)**,
**(12.4, 6.8)**. Unique Yaoya machine stays.

Hiro **(−8.5, −5.2)** stands 1.8 m from soba-east; pole **x = 0** is
3.5 m from arcade-west. No other kit collides.

## Extra warehouse

Keep the two Amihama clones. Pads (catalog plan, Three.js `rotation.y`:
`extX = hx|cos| + hz|sin|`, `extZ = hx|sin| + hz|cos|`):

| pose | AABB x | AABB z |
|---|---|---|
| WH8 unique (−12, 72, π) 14×18 | −19 … −5 | 63 … 81 |
| WH3 unique (16, 70, π) 16×12 | 8 … 24 | 64 … 76 |
| WH8 (22, 76, 0.08π) | 13.0 … 31.0 | 65.5 … 86.5 |
| WH8 (40, 68, −0.42π) | 29.5 … 50.5 | 59.0 … 77.0 |

East clones already nick WH3 / each other; this note does not restyle
them. The only clear extra pad on the dock (`GROUND.dock` −40…48 × 52…88)
is **west of Warehouse 8**:

`harbor-warehouse-8` at **(−32, 70, π)** → AABB **x −39…−25, z 61…79**.
Six-metre service alley to the unique shed (**−25** vs **−19**). On-dock,
north of the seawall line (z ≈ 88), south of the harbor-gate apron.

A second extra would have to sit in the 13 m gap at x −5…8 (too tight
for 14 m or 16 m) or north of z = 63 (WH8 depth 18 m does not fit
before z = 52). Stop at one.

## Ready to paste

Replace `export const INSTANCES = Object.freeze([ … ]);` in
`src/catalog.mjs` with:

```js
export const INSTANCES = Object.freeze([
  { asset: "vending-enamel", x: -17.8, z: -5.4, yaw: 0 },
  { asset: "vending-enamel", x: -10.3, z: -5.4, yaw: 0 },
  { asset: "vending-enamel", x: 3.5, z: -5.4, yaw: 0 },
  { asset: "vending-enamel", x: 12.5, z: -5.4, yaw: 0 },
  { asset: "vending-enamel", x: 15.9, z: -5.4, yaw: 0 },
  { asset: "vending-enamel", x: 24.1, z: -5.4, yaw: 0 },
  { asset: "vending-enamel", x: 22.2, z: 11.2, yaw: 0 },
  { asset: "vending-enamel", x: 29.8, z: 11.2, yaw: 0 },
  { asset: "telephone-pole", x: -36, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: -4, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: 16, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: 36, z: 5.6, yaw: 0 },
  { asset: "telephone-pole", x: -36, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: -20, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: 0, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: 20, z: -6.2, yaw: 0 },
  { asset: "telephone-pole", x: 36, z: -6.2, yaw: 0 },
  { asset: "harbor-warehouse-8", x: 22, z: 76, yaw: Math.PI * 0.08 },
  { asset: "harbor-warehouse-8", x: 40, z: 68, yaw: -Math.PI * 0.42 },
  { asset: "harbor-warehouse-8", x: -32, z: 70, yaw: Math.PI },
]);
```

Counts vs today: vending 3 → 8, poles 5 → 9, warehouse 2 → 3.
Assets used: `vending-enamel`, `telephone-pole`, `harbor-warehouse-8` only.
