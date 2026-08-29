# Harbor Town 1986 — additional tests (agent 32)

Plan only. Do **not** implement these unless a case is a few-line `node:test` with no PNG load, no WebGPU, and no `reconstructOrbitAsset`. Prefer this document over growing `sample-contract.test.mjs`.

Existing file: `ThreeBrowserRuntime/samples/harbor_town_1986/tests/sample-contract.test.mjs`.

## Already covered

`sample-contract.test.mjs` (two tests):

1. Canvas-only MJS: `site-entry.mjs` exists; `src/main.mjs` uses `reconstructOrbitAsset`, `ORBIT_SUBJECTS`, `attachScout`; `src/scout.mjs` exposes `minamihamaSetLocation` / `minamihamaGo` / `minamihamaScreenshot`; main does not import a HUD/UI module.
2. Catalog stills: every `ORBIT_SUBJECTS` entry has the PNGs its `kind` needs (`CARDINAL_VIEWS` / `CYLINDER_VIEWS` / `HUMANOID_VIEWS`).

Gaps: no `map.mjs` / catalog pose invariants, no leftover-tree guard (the `texture_2ds_to_3ds` parent sample has one), no scout `command.json` contract, no optional `roads.mjs`.

Suggested home for the cases below: the same file, extra `test(...)` blocks. All of them import sample modules or read UTF-8; none need images.

Convention used throughout: `+X` east, `+Z` south (`map.mjs`, `TOWN.md`). Camera look is `sin(yaw)` on X and `cos(yaw)` on Z, so **yaw `0` faces south** and **yaw `Math.PI` faces north**.

---

## 1. `groundHeight` is a monotonic hill

**File:** `src/map.mjs` (`export function groundHeight(x, z)`).

**Why:** Walk, `plantMesh`, stairs, and the height-field all sit on this function. A non-monotonic north slope would bury the Suzume-zaka house or leave floating stairs.

**Current implementation:** for `z < -12`, `t = clamp((-z - 12) / 34, 0, 1)` then `y = t * t * 7.2`. Dock `z > 52` is `0.04`; water `z > 88` is `-0.35`. No `x` term.

**Assert (pure, ~20 samples, no images):**

- Along several eastings (`x ∈ {-40, -22, 0, 22, 40}`), walk south from `z = -46` to `z = -12` in 1 m steps. Each step: `groundHeight(x, z) <= groundHeight(x, z - 1) + 1e-9` (height never rises while walking south on the hill).
- Peak is actually high: `groundHeight(-22, -46) > 6` (approaches `7.2`).
- Hill toe is street level: `groundHeight(-22, -12) === 0` and `groundHeight(0, 0) === 0`.
- Independent of `x` on the hill: `groundHeight(-40, -30) === groundHeight(40, -30)`.
- Water is below dock: `groundHeight(0, 100) < groundHeight(0, 70)`.

**Status today:** would pass.

**Do not:** tessellate the `PlaneGeometry` in `createStudio` or compare GPU vertices.

---

## 2. North-row shop yaw is `0`

**File:** `src/catalog.mjs` `ORBIT_SUBJECTS` (and `INSTANCES` if they sit on the north curb).

**Why:** Sakae-dori is east–west. North-row fronts must face the street (south). Wrong yaw puts the reconstructed shop back/side onto the sidewalk.

**Row rule (keep this in the test, not a new export unless catalog grows):**

```js
const northRow = ORBIT_SUBJECTS.filter(s => s.district === "sakae" && s.z <= -6);
```

Today that is exactly the README north row: `tobacco-shop`, `soba-shop`, `greengrocer`, `you-arcade`, `cassette-shop` (all `z: -8.5`). Excludes street furniture (`vending-enamel` at `z: -5.4`).

**Assert:** `northRow.length >= 5` and every `subject.yaw === 0`.

Optional same rule on `INSTANCES` with `z <= -6` (none today).

**Status today:** would pass.

---

## 3. South-row shop yaw is `Math.PI`

**Same file / catalog.**

**Row rule:**

```js
const southRow = ORBIT_SUBJECTS.filter(s => s.district === "sakae" && s.z >= 6);
```

Today: `flower-shop` (`z: 8.6`) and `phone-booth` (`z: 6.2`). Both already `yaw: Math.PI`.

**Assert:** `southRow.length >= 1` and every `subject.yaw === Math.PI` (use `===`, not `==`, so `0` cannot sneak through).

`INSTANCES` on the south curb should match: vending at `z: 6.0` and `z: 6.8` are already `Math.PI`. Poles at `z: 5.6` are in the street, not the row — do not include them.

**Status today:** would pass.

Do not yaw-lock `kei-van` (`z: 3.8`, `yaw: -0.18`), `civilian-hiro`, warehouses, or `wooden-hill-house`.

---

## 4. Every subject `realHeight` is positive

**File:** `src/catalog.mjs`. `main.mjs` logs `${subject.realHeight}m` and passes the subject into `realWorldScale`.

**Assert:** for every `ORBIT_SUBJECTS` entry:

- `Number.isFinite(subject.realHeight) && subject.realHeight > 0`
- same for `realWidth` and `realDepth` (both are present on every subject today)

Cheap extras worth folding into the same test:

- `id`, `folder`, `label` are non-empty strings
- `kind` is one of `rectangle` | `cylinder` | `humanoid` | `custom`
- every `INSTANCES[].asset` exists in `ORBIT_SUBJECTS` by `id`

**Status today:** would pass. Heights currently range `1.72` (Hiro) … `10` (pole).

Do not re-run reconstruction to prove the scaled mesh matches the metres.

---

## 5. `roads.mjs` exports `addRoads` if that file exists

**File (not present):** `src/roads.mjs`. Streets today are `GROUND.asphalt` plus dashed boxes in `addStreetFurniture` (`src/main.mjs`).

**Assert (conditional):**

```js
import { access } from "node:fs/promises";
import { constants } from "node:fs";

const roadsPath = join(sampleRoot, "src", "roads.mjs");
try {
  await access(roadsPath, constants.R_OK);
} catch {
  return; // skip — module not introduced yet
}
const roads = await import("../src/roads.mjs");
assert.equal(typeof roads.addRoads, "function");
const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
assert.match(main, /addRoads/);
```

**Status today:** skip (file missing). When someone extracts road mesh from `main.mjs`, this becomes a fail-closed contract.

Do not invent `roads.mjs` just to satisfy the test.

---

## 6. No `TREE_SPECIES` leftover

**Why:** this sample was forked from `texture_2ds_to_3ds`, whose contract test already bans `TREE_SPECIES` in `main.mjs`. A harbor town must not keep forest-demo species tables.

**Assert:** walk every `*.mjs` under the sample root (reuse the existing `walk()` helper). Join sources and `assert.doesNotMatch(all, /\bTREE_SPECIES\b/)`. Also reject imports of `tree-layout.mjs` / `trees.mjs` from `secret_river`.

**Status today:** would pass (`grep` finds zero hits under `harbor_town_1986`).

This is the best candidate if someone adds a 1-line guard to the existing canvas-only test instead of a new file.

---

## 7. `command.json` example is valid

Scout (`src/scout.mjs`) polls `C:\ThreeBrowser\artifacts\harbor-town-1986\command.json` every 400 ms:

```js
const cmd = JSON.parse(raw);
const id = String(cmd.id ?? "");
if (!id || id === lastCommandId) return;
if (cmd.go) api.go(String(cmd.go));
if (cmd.setLocation) api.setLocation(cmd.setLocation);
if (cmd.screenshot) await api.screenshot(String(cmd.screenshot));
```

Do **not** treat the live artifacts file as a sample fixture — agents overwrite it (`{"id":"t4","go":"sakae","screenshot":"sakae-north"}` at time of writing).

**Assert against the documented example** in `README.md`:

```json
{ "id": "1", "go": "arcade", "screenshot": "arcade" }
```

Checks:

1. README contains a JSON object with `"id"`, `"go"`, `"screenshot"` (regex-extract the fenced / inline example, `JSON.parse` it).
2. `id` is a non-empty string.
3. `go` is a key of `LANDMARKS` (`arcade` is).
4. `screenshot` is a non-empty string (filename stem; scout sanitizes with `[^\w.-]+`).
5. Optional `setLocation`, if present, is a plain object whose `x`/`z`/`yaw`/`pitch` are finite numbers when provided.

Parser extras (string-scan `scout.mjs`, no screenshot I/O):

- tick reads `command.json` from `artifacts/harbor-town-1986`
- duplicate `id` is ignored (`lastCommandId`)
- `LANDMARKS` keys include at least `sakae`, `arcade`, `harbor`, `spawn`

**Status today:** README example would pass. Live `artifacts/.../command.json` also happens to be valid (`go: "sakae"`), but do not pin the sample tests to that path.

---

## Implementation notes

| # | Fast `node:test`, no images | Implement now? |
|---|---|---|
| 1 hill | yes | no — keep in this plan |
| 2 north yaw | yes | no |
| 3 south yaw | yes | no |
| 4 realHeight | yes | no |
| 5 roads.mjs | yes (skip if missing) | no |
| 6 TREE_SPECIES | yes | no |
| 7 command.json | yes (README parse) | no |

If a later drop adds 1–2 cases anyway, fold **#4 + #2/#3** into one `catalog poses face the street` test, and **#1** as `groundHeight hill is monotonic`. Do not add a third file; do not load PNGs; do not boot WebGPU.

## Out of scope (do not add)

- Pixel diffs of `artifacts/harbor-town-1986/*.png`
- Reconstructing any orbit subject in CI
- Nav-graph walk reachability (nice-to-have, not requested)
- HUD absence beyond the existing import check
- Creating `src/roads.mjs`
