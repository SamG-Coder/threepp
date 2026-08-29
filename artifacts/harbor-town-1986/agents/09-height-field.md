# 09 — Minamihama height field

Do not edit sample source from this note. Parent pastes `groundHeight` into
`src/map.mjs` and the mesh / vertex-colour block into `createStudio` in
`src/main.mjs`. No new deps.

Convention: metres, `+X` east, `+Z` south (`map.mjs` header, `TOWN.md`).
Hill is north-west (Suzume-zaka). Harbor is south (Amihama). Sakae is `y = 0`.

## Why the current field fails

User-stated baseline (and `21-slope-seat.md`):

```js
if (z < -12) {
  const t = clamp((-z - 12) / 34, 0, 1);
  y += t * t * 7.2;          // quadratic — almost flat at the stairs
}
if (z > 88) y = -0.35;       // puddle
else if (z > 52) y = 0.04;   // hard dock step
```

In-tree `map.mjs` has already drifted to a **linear** `t * 8` with a 40 cm
path cut on `x ∈ [-24, -16]`, water `−0.45`, dock `0.05`, and Yokobori as a
**+2 cm bump**. Replace whichever of those is shipping. Both miss the brief:

| need | quadratic 7.2 | in-tree linear 8 | this spec |
|---|---|---|---|
| Suzume-zaka 7–9 m over 40 m | 7.2 m over 34 m, but **1.59 m at spawn** (`t²`) | 8 m over 34 m, **3.58 m at spawn** (path cut) | **8.50 m** `z = -8 → -48`, **6.38 m at spawn**, ease-out so the stairs are the steep bit |
| Stone stairs feel | 10 cm rise on the whole flight | ~2.7 m, constant grade | ~3.8 m on the existing 12 boxes, ~21° at the toe |
| Harbor | 4 cm plateau then −35 cm water | same, −45 cm water | apron −18 cm, quay −42 cm, basin **−1.30 m** |
| Yokobori | flat 0 | **+2 cm** | **−30 cm** gutter |
| X falloff | none (sakae north backs ride the ramp) | none | full west of `x = -22`, dead by `x = 4` |

`SPAWN` is `(-22, -28)` on `hillPath`. Walk Y is `groundHeight + EYE` (`EYE = 1.62`); `SPAWN.y` is unused (`28-spawn-feel.md`).

## District anchors

From `TOWN.md` / `GROUND` / catalog:

| district | origin (x, z) | size | what the field must do |
|---|---|---|---|
| suzume | −28, −36 | 40 × 36 | park, house, stone stairs — the climb |
| sakae | 0, 0 | 80 × 18 | stay at `y ≈ 0` so shop pads do not tilt |
| yokobori | 24, 22 | 28 × 12 (`GROUND.alley` 18…42 × 12…28 is authoritative, `10-yokobori.md`) | slight dip |
| amihama | 0, 64 | 90 × 50 | apron → quay step → water |

Key plants: house `(-28, -34)`, stairs boxes `x = -20`, `z = -12.4 … −24.0`,
spawn `(-22, -28)`, Galaxy sakaba `(26, 16)`, warehouses `z ≈ 70…76`,
quay waypoint `(0, 80)`, seawall `z = 87.7`, water seam `z = 88`.

## Hill mesh extent — does 96 × 72 at the origin cover the house and the quay?

**No.** Not the house footprint, and not the quay at all.

`createStudio` today:

```js
const hill = new THREE.PlaneGeometry(96, 72, 48, 36);
hill.rotateX(-Math.PI / 2);
// mesh.position left at (0,0,0)
```

`PlaneGeometry(width, height)` is XY. After `rotateX(-π/2)`, `(x, y, 0) → (x, 0, -y)`:

| axis | local | world |
|---|---|---|
| X | `width/2 = 48` | **[−48, 48]** |
| Z | `height/2 = 36` | **[−36, 36]** |

`wooden-hill-house` is planted at `z = -34` (2 m inside the north lip). Catalog
plan is 8.2 × 7.6, yaw `0.42`. Corners reach **`z ≈ -39.1`** (`21-slope-seat.md`).
The north gable hangs **~3 m off the mesh**. Park `GROUND` goes to `z = -48`.

Quay landmark `z = 82`, waypoint `z = 80`, water seam `z = 88`. Mesh ends at
**`z = +36`**. Dock patch starts `z = 52`. **`z = 36…52` is a hole** (nav
`harbor-gate` `(0, 48)` lives in it). `28-spawn-feel.md` already flags this.

`map.mjs` comment suggests `PlaneGeometry(110, 160)` covering `z = -50…110`.
A 160 m plane **centred at the origin** is `z ∈ [-80, 80]` and **still misses
`z = 88`**. Coverage that range needs a **+Z translate** of 30 m.

### Replacement mesh (copy-paste into `createStudio`)

```js
const hill = new THREE.PlaneGeometry(120, 176, 60, 88);
hill.rotateX(-Math.PI / 2);
hill.translate(0, 0, 32); // world X ∈ [-60, 60], Z ∈ [-56, 120]
const pos = hill.attributes.position;
for (let i = 0; i < pos.count; i++) {
  pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
}
hill.computeVertexNormals();
```

| | 96 × 72 at origin (now) | 120 × 176 translated +32 Z |
|---|---|---|
| X | [−48, 48] | [−60, 60] |
| Z | [−36, 36] | [−56, 120] |
| house `z = -34` (footprint to −39) | point yes, footprint **clips** | yes, 17 m of skirt |
| park `z = -48` | **no** | yes |
| quay `z = 88` | **no** (52 m south of lip) | yes |
| water `z = 88…120` | **no** | yes, south edge on `GROUND.water.maxZ` |
| gap `z = 36…52` | **void** | closed |
| segment size | 2 m | 2 m (60 / 88 segs) |

Translate the **geometry**, not `mesh.position`, so `getX` / `getZ` stay world
metres when sampling `groundHeight`. 2 m verts will not draw the stone stairs —
keep the box treads in `addStreetFurniture`. Do not raise segment density for
this pass.

`GROUND` park / path / dock / water patches are **flat cards** at a fixed `y`.
Once the height field covers those districts they will slice the hill (park at
`y = 0.02` under an 8 m terrace) or float (dock `y = 0.06` over a −0.4 m quay).
Drape them (per-vertex `groundHeight + ε`) or drop them and rely on vertex
colours. `roads.mjs` Yokobori cobble at `(30, 0.05, 20)` has the same problem
once the alley dips.

## Target profiles

`y` metres. Every 8 m in `z`. Ease-out hill west of Sakae, −30 cm Yokobori
gutter, Amihama apron → quay step → basin.

```
 y
 8.5 |█                 park terrace (x = -22)
 7.1 |  █               house band
 5.4 |    █             upper stairs
 3.1 |      █           lower stairs
 0.0 |        █████     Sakae
-0.3 |         ░        Yokobori (x = 24 only)
-0.2 |            ██    apron / warehouses
-0.4 |              █   quay
-1.3 |               ██ water
     +--+--+--+--+--+--+
      -48 -24  0  48  88 104
```

### Along Z, every 8 m

| z | x = 0 (Sakae → quay) | x = −22 (stairs / spawn) | x = 24 (Yokobori) |
|---:|---:|---:|---:|
| −56 | 0.54 | **8.50** | 0.00 |
| −48 | 0.54 | **8.50** | 0.00 |
| −40 | 0.52 | 8.16 | 0.00 |
| −32 | 0.46 | 7.14 | 0.00 |
| −24 | 0.35 | **5.44** | 0.00 |
| −16 | 0.20 | **3.06** | 0.00 |
| −8 | 0.00 | 0.00 | 0.00 |
| 0 | 0.00 | 0.00 | 0.00 |
| 8 | 0.00 | 0.00 | 0.00 |
| 16 | 0.00 | 0.00 | **−0.30** |
| 24 | 0.00 | 0.00 | **−0.30** |
| 32 | −0.02 | −0.02 | −0.02 |
| 40 | −0.08 | −0.08 | −0.08 |
| 48 | −0.15 | −0.15 | −0.15 |
| 56 | −0.18 | −0.18 | −0.18 |
| 64 | −0.18 | −0.18 | −0.18 |
| 72 | −0.18 | −0.18 | −0.18 |
| 80 | **−0.38** | −0.38 | −0.38 |
| 88 | **−0.49** | −0.49 | −0.49 |
| 96 | **−1.30** | −1.30 | −1.30 |
| 104 | −1.30 | −1.30 | −1.30 |

Sakae column is the **flank** of Suzume-zaka (5 % of crest), not a second hill.
Looking north from `LANDMARKS.sakae` you see ground rising to the **north-west**,
not a wall behind the arcade.

### Off-grid landmarks (same formula)

| pose | (x, z) | quadratic now | this spec |
|---|---|---:|---:|
| stair foot | −22, −12 | 0.00 | **1.62** |
| `LANDMARKS.stairs` | −18, −14 | 0.03 | 2.21 |
| `SPAWN` / hill node | −22, −28 | **1.59** | **6.38** |
| house plant | −28, −34 | 3.01 | **7.46** |
| park crest on the zaka | −22, −48 | 7.20 | **8.50** |
| Galaxy sakaba | 26, 16 | 0.00 | **−0.30** |
| harbor-gate | 0, 48 | 0.00 | −0.15 |
| Warehouse 8 | −12, 72 | 0.04 | −0.18 |
| quay waypoint | 0, 80 | 0.04 | **−0.38** |
| `LANDMARKS.quay` | 0, 82 | 0.04 | −0.42 |
| seawall centre | 4, 87.7 | 0.04 | −0.44 |
| water | 0, 96 | −0.35 | **−1.30** |

### Suzume-zaka — real climb, stone stairs

8.50 m over 40 m (`z = -8` north kerb → `z = -48` park crest) at `x = -22`.
That is 12° mean, **inside 7–9 m**.

Ease-out `t(2 − t)` puts the steep part on the flight, then a terrace:

| z | role | y | grade `dy/dz` |
|---:|---|---:|---:|
| −8 | Sakae north kerb | 0.00 | 21° |
| −12 | stair foot (first box `z = -12.4`) | 1.62 | 21° |
| −16 | lower stairs | 3.06 | 19° |
| −24 | last box today (`z ≈ -24.0`) | 5.44 | 17° |
| −28 | spawn | 6.38 | 12° |
| −34 | house | 7.46 | 8° |
| −48 | park crest | 8.50 | 0° |

Existing 12 boxes (`z = -12.4`, step `−1.05`, 0.24 m thick, `x = -20`) pick up
**3.8 m** of that. Toe slope 0.38 over a 1.12 m tread is ~21 cm — almost the
slab thickness. Parent should later densify the loop (not this file):

```js
for (let i = 0; i < 24; i++) {
  const z = -12.3 - i * 0.66; // z ≈ -12.3 … -27.5, onto the spawn terrace
  const step = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.18, 0.70), stone);
  step.position.set(-20, groundHeight(-20, z) + 0.09, z);
  scene.add(step);
}
```

West of `x = -22` the crest is the full 8.50 m (house `x = -28`). East of the
stairs the gaussian-smoothstep dies by `x = 4`, so tobacco / soba plant points
at `z = -8.5` stay within ~0.2 m of grade 0.

House corner Δh on this ease-out is **~1.5 m** (quadratic was 2.82 m) because
the terrace is flatter. Still use the min-of-four seat from `21-slope-seat.md`
when that lands — the mesh is not pitched.

Spawn eye becomes `6.38 + 1.62 = 8.00 m`. `28-spawn-feel.md` pitch `−0.2` is
no longer optional: level pitch from 8 m looks over the shop roofs.

### Harbor — slight step down to quay, then water

Not the 4 cm toy lip. Not the 2.26 m freeboard in `11-amihama.md` either
(that is furniture / water-plane work). Walkable field:

```
y =  0.00   Sakae
y = -0.18   warehouse apron   z ≈ 52…74   (W8 / W3 stay here)
y = -0.42   quay deck         z ≈ 80…87   (waypoint, bollards, seawall)
y = -1.30   winter basin      z ≥ 91      (below 31's seawall foot −1.15)
```

- Street → apron: **18 cm** (almost unnoticed while walking).
- Apron → quay: **24 cm** at `z = 74…82`, after the sheds, so cargo doors do
  not sit on the step. One stair-like drop onto the quay.
- Quay lip `z = 88` is **−0.49 m**; water finishes at **−1.30 m** by `z = 91.5`
  (0.8 m basin, not a cliff, not a puddle).

`31-water-edge.md` visual planes (`y = -0.28 / -0.58`) can still overlay this.
If both ship, sit those planes on the **field water** (`−1.30` and `−1.60`) or
leave them as a surface film and keep the height-field as the basin the wall
stands in. Do not keep `groundHeight` at `−0.35` or the vertex-coloured water
will be a stain on the quay.

### Yokobori — slight dip

`GROUND.alley` `x ∈ [18, 42]`, `z ∈ [12, 28]`. `10-yokobori.md` already wants a
4 cm lip at the mouth vs sidewalkS (`y = 0.08`). This field goes further, as a
filled side-moat:

- Mouth `z = 12…16` ramps 0 → **−0.30 m**
- Lane and bar pad `z = 16…26`, `x ≈ 22…38`: **−0.30 m**
- South mouth `z = 26…30` ramps back toward the harbor apron

30 cm is one step down off Sakae, enough to read as 横堀, not a ravine.
Galaxy at `(26, 16)` sits on the floor of the dip. East court (`x → 42`) fades
so the unused back-paving in 10 is not a pit.

## Replacement `groundHeight` (copy-paste into `map.mjs`)

```js
/** Walkable Minamihama plan, metres. +X east, +Z south. Hill north, harbor south. */
export function groundHeight(x, z) {
  x = Number(x);
  z = Number(z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;

  const saturate = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const smoother = (t) => {
    t = saturate(t);
    return t * t * (3 - 2 * t);
  };

  // Suzume-zaka: 8.5 m over 40 m (z = -8 → -48). Ease-out = steep stairs, terrace park.
  // west = 1 on the zaka (x ≤ -22), 0 by Sakae x = 4.
  const climbT = saturate((-z - 8) / 40);
  const climb = climbT * (2 - climbT);
  const west = 1 - smoother((x + 22) / 26);
  let y = 8.5 * climb * west;

  // Yokobori: old side-moat, −0.30 m in GROUND.alley.
  const alleyX = smoother((x - 18) / 4) * (1 - smoother((x - 38) / 6));
  const alleyZ = smoother((z - 12) / 4) * (1 - smoother((z - 26) / 4));
  y -= 0.30 * alleyX * alleyZ;

  // Amihama: apron, then a step onto the quay, then the basin.
  y -= 0.18 * smoother((z - 26) / 30); // 0 at z=26, −0.18 by z=56
  y -= 0.24 * smoother((z - 74) / 8);  // extra −0.24 by z=82 (after warehouses)
  y -= 0.88 * smoother((z - 87.4) / 3.6); // extra −0.88 by z=91 (water)

  return y;
}
```

Helpers are local. No `THREE`, no imports.

Spot checks (must match the tables):

```js
groundHeight(-22, -48); // 8.50  crest
groundHeight(-22, -28); // 6.375 spawn
groundHeight(-28, -34); // 7.459 house
groundHeight(-22, -12); // 1.615 stair foot
groundHeight(0, 0);     // 0     sakae
groundHeight(24, 16);   // -0.30 yokobori
groundHeight(0, 72);    // -0.18 warehouse apron
groundHeight(0, 80);    // -0.3825 quay
groundHeight(0, 96);    // -1.30 water
```

## Vertex colour rules

Today the loop is binary (`z < -12 || y > 0.3` → khaki grass, else grey).
Replace it so the one mesh reads as four surfaces. First match wins.

| rule | test | rgb | hex cousin |
|---|---|---|---|
| **dark water** | `z >= 88` | `0.10, 0.16, 0.22` | darker than `GROUND.water` `0x2a4458` |
| **grey dock** | `z > 52` | `0.54, 0.53, 0.50` | `GROUND.dock` `0x8a8680` |
| **packed dirt (path)** | `GROUND.hillPath` `x ∈ [-24, -16]`, `z ∈ [-36, -12]` | `0.60, 0.58, 0.53` | `0x9a9488` |
| **packed dirt (alley)** | `GROUND.alley` `x ∈ [18, 42]`, `z ∈ [12, 28]` | `0.42, 0.37, 0.32` | `0x6a5e52` |
| **grass on hill** | `z < -10 && y > 0.35` (and not the path) | `0.32, 0.38, 0.22` | current mesh / winter park |
| else | Sakae fill | `0.24, 0.24, 0.25` | current non-grass |

Copy-paste, immediately after `computeVertexNormals()`:

```js
const colors = new Float32Array(pos.count * 3);
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const y = pos.getY(i);
  const z = pos.getZ(i);
  let r = 0.24, g = 0.24, b = 0.25;
  const onPath = x >= -24 && x <= -16 && z >= -36 && z <= -12;
  const onAlley = x >= 18 && x <= 42 && z >= 12 && z <= 28;
  if (z >= 88) {
    r = 0.10; g = 0.16; b = 0.22; // dark water
  } else if (z > 52) {
    r = 0.54; g = 0.53; b = 0.50; // grey dock
  } else if (onPath) {
    r = 0.60; g = 0.58; b = 0.53; // packed dirt, Suzume-zaka
  } else if (onAlley) {
    r = 0.42; g = 0.37; b = 0.32; // packed dirt, Yokobori
  } else if (z < -10 && y > 0.35) {
    r = 0.32; g = 0.38; b = 0.22; // winter grass
  }
  colors[i * 3] = r;
  colors[i * 3 + 1] = g;
  colors[i * 3 + 2] = b;
}
hill.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
```

Keep `MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })`.
Do not encode height in the colour (the old `y > 0.3` grass test painted the
quay green once Y was used as a proxy).

Asphalt / sidewalk patches may stay as thin overlays on Sakae (`y = 0` /
`0.08`) — those districts are still flat. Park, hillPath, dock, and water
patches fight the field; they are the ones to drape or delete.

## Parent checklist

1. Replace `groundHeight` in `map.mjs` with the function above.
2. Replace the 96 × 72 plane with `PlaneGeometry(120, 176, 60, 88)` +
   `translate(0, 0, 32)` **before** `setY`.
3. Replace the vertex-colour loop with the four-surface rules.
4. Do **not** keep `GROUND.park` / `hillPath` / `dock` / `water` at fixed `y`
   on top of the new mesh.
5. Later, not this note: densify the 12 stair boxes; `SPAWN.pitch = -0.2`
   (`28`); min-corner `plantMesh` (`21`); seawall foot vs `y = -1.30` (`31`);
   drape `roads.mjs` cobble.

Leave sample source untouched until parent applies this.
