# Fix — dress anonymous fill boxes (1986 facades)

New module: `ThreeBrowserRuntime/samples/harbor_town_1986/src/facades.mjs`.
One import + one call in `createStudio` after `addGapFill`. Did **not**
rewrite `catalog.mjs`.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south. No HUD. No
`Math.random`. Cheap `BoxGeometry` / `CylinderGeometry` +
`MeshStandardMaterial` overlays, same language as gap fill / skyline.

---

## Bug

Grey `gap fill` / `south fill` / `skyline block` / `yokobori fill` boxes
read as unpainted massing: no windows, no roof, no eaves. From Sakae
looking north they are a concrete slab behind the photo hulls. From
Yokobori they are brown cubes. Winter 15:20 Kanagawa shops and
apartments are cream / ochre / soot plaster with dark glass, kawara,
drainpipes, and the odd balcony.

---

## File

```js
export function addFacades(scene, { THREE, groundHeight })
export function restyleFillMeshes(scene, { THREE, groundHeight })
```

`addFacades` is the studio entry (calls the helper). Same injection shape
as `addRoads` / `addWorldFill`.

`restyleFillMeshes` walks the scene for meshes named **`gap fill`**,
**`south fill`**, **`skyline block`**, **`yokobori fill`**. Each box is
recoloured (vertex-coloured plaster, soot heavier at the base) and
dressed. If a known centre is missing, the helper spawns a matching
dressed box. Idempotent: a child group named `facade dress` skips a
second pass.

### Dressing (offset `0.06 m` outward — no z-fight)

| part | how |
|---|---|
| plaster | cream `0xd6c8b0` / dirty cream `0xc4b496` / ochre `0xc8a878`–`0xb8925c` / soot `0xa09080`–`0x7a7268`, hashed per `x,z` |
| window grid | dark glass `0x2a3238` boxes, 2–5 floors × 2–5 cols, all four faces; shop ground-floor street panes slightly taller, faint tungsten emissive `0.05` |
| tiled roof | shallow extra box, overhang `0.32 m`, kawara `0x4a3028` / `0x3a2420` / `0x5a3830` / `0x2c221c` |
| eaves | street-face strip under the roof; shop-style also gets a 3 m canopy |
| drainpipes | two `r = 0.045` cylinders on the street-face corners |
| balcony | occasional (hash), upper street face, slab + rail — not on every bay |

Street face is the side toward Sakae (`z = 0`): `+Z` when `z < 0`, `−Z`
when `z ≥ 0`. Window / eave / pipe / balcony centres sit
`face + 0.06 m`. Roof sits `0.06 m` above the box top.

### Known spawn lists (fallback)

Copied from live `addGapFill` / `addSkyline` in `main.mjs` and
`addSouthMassing` / `addYokoboriMassing` in `fill-world.mjs`. Spawn only
when no mesh of that name already sits on the centre (`x,z` to 2 dp).

---

## Wire-up

In `createStudio`, after gap fill:

```js
import { addFacades } from "./facades.mjs";
// ...
addGapFill(scene);
addFacades(scene, { THREE, groundHeight });
```

`groundHeight` is already imported from `./map.mjs`. `THREE` is
`import * as THREE from "three/webgpu"`. No catalog entries. No HUD.

Live `addWorldFill` (next line) also plants `south fill` / `yokobori fill`
at those same centres. The helper therefore **spawns** those lots when
called after gap fill (they are not in the scene yet). A later
`restyleFillMeshes` pass would dress any extra greys; the first call
already covers the lots.

---

## Keep-out

- Do not instance unique shop photo hulls as fill.
- Do not add dummy noren / enamel / lettering (Yokobori already has
  those in `fill-yokobori.mjs`).
- Do not touch `catalog.mjs`.
- Do not HUD.
- Overlays stay `0.06 m` off the box faces so they do not z-fight the
  grey body or the existing `gap fill window` panes (`0.04 m`).

---

## Verify

Re-run scout:

```json
{"id":"t-facades","shots":[
  {"go":"sakae","screenshot":"sakae-facades"},
  {"go":"street-east","screenshot":"street-east-facades"},
  {"go":"yokobori","screenshot":"yokobori-facades"},
  {"go":"hill","screenshot":"hill-facades"}
]}
```

Pass: north-row gaps and the far ridge show cream/ochre/soot plaster,
dark window grids, tiled roofs and eaves, not bare grey cubes; Yokobori
side walls have shop panes + drainpipes; unique reconstructed façades
untouched. Fail: z-fighting flicker on a fill face, a HUD, a catalog
rewrite, or neon.
