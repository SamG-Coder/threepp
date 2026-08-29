# Harbor Town 1986 — sample tests

Did **not** edit `sample-contract.test.mjs`. Added
`ThreeBrowserRuntime/samples/harbor_town_1986/tests/world-guards.test.mjs`.

## New cases

| test | source | notes |
|---|---|---|
| wired fill modules are imported and called from `main.mjs` | `src/main.mjs` + fill modules | Requires `addWorldFill`, `addQuayFill`, `addParkFill`, `addRoute16Fill` imported and called. Dead `addStreetFill` / `addSouthFill` / `addYokoboriFill` are **not** required unless `main` wires them (it does not). |
| asphalt vs height field ≥ 0.015 on `z = -8..12` | `GROUND.asphalt`, `groundHeight`, height-field offset parse in `main.mjs` | Passes because `GROUND.asphalt.y` is **−0.03**, terrain is 0 on Sakae (except alley bump `x > 18, z = 12` → 0.02). Min delta 0.03. |
| no two `civilian-hiro` instances within 2.5 m | `INSTANCES` | Unique catalog Hiro is not in this pair check. Closest clones are ~5 m. |
| chroma-key interior non-magenta red survives | `texture_2ds_to_3ds/src/chroma-key.mjs` | Harbor sample has no local `chroma-key.mjs`; test imports the reconstruction sibling. Magenta studio keys out; brick red `(176, 32, 28)` stays opaque. |
| `nav-graph.json` parses; every edge target exists | `src/nav-graph.json` | 19 nodes, all `edges[]` ids resolve. |
| ambient-life exports `createAmbientLife` or `addAmbientLife` | `src/ambient-life.mjs` | **Skipped** — file not present. |

## Wiring (reality)

`main.mjs` today:

```
import { addWorldFill } from "./fill-world.mjs";
import { addQuayFill } from "./fill-quay.mjs";
import { addParkFill } from "./fill-park.mjs";
import { addRoute16Fill } from "./fill-route16.mjs";
…
addWorldFill(scene, { THREE, groundHeight });
addQuayFill(scene, { THREE, groundHeight });
addParkFill(scene, { THREE, groundHeight });
addRoute16Fill(scene, { THREE, groundHeight });
```

`fill-street.mjs`, `fill-south.mjs`, `fill-yokobori.mjs` exist as dead modules and are not imported. If a later consolidate wires them, the fill test will require import + call.

## Run

```
node --test `
  C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\tests\sample-contract.test.mjs `
  C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\tests\world-guards.test.mjs
```

`node --test <tests-dir>` on this Node (v24.19.0) treats the directory as a CJS module and fails; pass the two `*.test.mjs` files.

**13 tests: 12 pass, 1 skip, 0 fail.**

Existing contract (7) all still pass. New guards (6): 5 pass, ambient-life skipped.

## Not done

- Did not change `map.mjs` / catalog / fills / nav-graph.
- Did not add `src/ambient-life.mjs`.
- Did not load PNGs or boot WebGPU.
