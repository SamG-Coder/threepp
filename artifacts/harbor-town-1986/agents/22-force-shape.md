# 22 — Force catalog shape through reconstructOrbitAsset

## Verdict

`reconstructOrbitAsset` **already accepts a forced shape**. The option name is **`shape`**, not `forceShape`.

There is no `forceShape` option anywhere in `texture_2ds_to_3ds`. Passing `forceShape: subject.kind` today is a silent no-op.

`reconstructOrbitAsset` forwards the whole `options` object into `reconstructFromViews`, which binds classification with:

```js
const shape = options.shape ?? classifyOrbitShape(working);
```

(`C:\ThreeBrowser\ThreeBrowserRuntime\samples\texture_2ds_to_3ds\src\tree-asset.mjs` line 76)

`options.shape` is the classifyOrbitShape return shape: at minimum `{ kind }`, and for a faithful override also `{ generic, recommendedCount }`. Downstream only reads:

| consumer | fields used |
|---|---|
| `pickViewsForShape` | `kind`, `recommendedCount` |
| `chooseOrbitAngles` | `recommendedCount`, `generic` (town already passes `forceCount`) |
| `snapOccupancyToPrimitive` | `kind === "cylinder" \|\| "capsule"` |
| photoconsistency vs primitive snap | `kind` |
| `extractIsosurface` / `bakeMaterialMaps` / `wrapUv` | `kind` (rectangle → `boxUv`, cylinder → `cylinderUv`) |
| `assetReport` | `kind`, `generic` |

`texture_2ds_to_3ds` was **not** edited. Harbor town was not passing `shape`, so `classifyOrbitShape` was free to disagree with `catalog.mjs`.

## Why the two misclassifications happen

### harbor-warehouse-8 (`kind: "rectangle"`) → cylinder

Warehouse ships four cardinals only (`CARDINAL_VIEWS`). `classifyOrbitShape` looks up yaw 45 to detect corners:

```js
const diagonalRatio = frontStats && diagonalStats
  ? diagonalStats.spanX / Math.max(1, frontStats.spanX)
  : 1;
const hasCorners = diagonalRatio > 1.16;
```

No 45° still ⇒ `diagonalRatio = 1` ⇒ `hasCorners = false`.

Then:

- `rotationallySymmetric = aspectCv < 0.12 && meanCardinalIoU > 0.85 && !hasCorners`
- `cylinderLike = rotationallySymmetric && !capsuleLike`
- `rectangleLike` needs `hasCorners` **or** `planDelta > 0.18 && !rotationallySymmetric`

A box whose four silhouettes are similar (or whose front/side aspect delta is modest) therefore classifies **cylinder**. Reconstruction then hits:

```js
if (shape.kind === "cylinder" || shape.kind === "capsule") {
  snapOccupancyToPrimitive(volume, shape);
}
```

`snapOccupancyToPrimitive` only acts on cylinder/capsule. It carves the visual-hull square prism down to an inscribed round volume — Warehouse 8 becomes a silo.

### telephone-pole (`kind: "cylinder"`) → custom

Pole ships two orthogonals (`CYLINDER_VIEWS`). Crossarms / a skinny irregular silhouette trip `organic` (`meanCircularity < 0.22`) or `flared`, both of which short-circuit to `kind = "custom"` before `cylinderLike`. Custom skips `snapOccupancyToPrimitive`, so two cards leave a square prism instead of a round pole, and UVs go through `customUv` not `cylinderUv`.

Catalog is the source of truth (`TOWN.md`: warehouses rectangle, poles cylinder). Silhouette heuristics are for the oak/willow/trash-can studio sample, which has no `subject.kind`.

## Oak / willow / trash-can — why a town-only pass is safe

`C:\ThreeBrowser\ThreeBrowserRuntime\samples\texture_2ds_to_3ds\src\main.mjs` reconstructs `ORBIT_SUBJECTS` (english-oak, weeping-willow, steel-trash-can) **without** passing `shape`. Those three keep `classifyOrbitShape`.

`assets.test.mjs` asserts:

- tree / willow → `generic === false`, `kind === "custom"`, 8 views
- trash-can → `generic === true`, `kind === "cylinder"`, 2 views

Adding `forceShape` to `reconstructFromViews` would also be a no-op for that sample (it would not pass the new flag), but it is a second name for an option that already exists. **Not applied.** Do not add `forceShape` to `texture_2ds_to_3ds`.

## Applied patch (town only)

`reconstructSubject` already used `subject.kind` to pick the still catalog and `forceCount`. It now also passes the existing `shape` option so classification cannot override catalog.

```diff
--- a/ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs
+++ b/ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs
@@ -129,7 +129,12 @@ async function reconstructSubject(subject) {
     resolution: 48,
     silhouetteSize: 96,
     mapSize: 128,
     forceCount: catalog.length,
+    shape: {
+      kind: subject.kind,
+      generic: subject.kind !== "custom" && subject.kind !== "humanoid",
+      recommendedCount: catalog.length,
+    },
   });
   const report = assetReport(asset);
```

Applied at `C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs` lines 125–138:

```js
  const asset = await reconstructOrbitAsset({
    assetRoot: import.meta.url,
    folder: subject.folder,
    catalog,
    resolution: 48,
    silhouetteSize: 96,
    mapSize: 128,
    forceCount: catalog.length,
    shape: {
      kind: subject.kind,
      generic: subject.kind !== "custom" && subject.kind !== "humanoid",
      recommendedCount: catalog.length,
    },
  });
```

`generic` / `recommendedCount` match `classifyOrbitShape` so `pickViewsForShape` and `assetReport` stay consistent with the still catalogs already chosen from `subject.kind`:

- rectangle / square → 4 cardinals, photoconsistency, `boxUv`
- cylinder / capsule → 2 orthogonals, `snapOccupancyToPrimitive`, `cylinderUv`
- humanoid / custom → 8 yaws, photoconsistency, `customUv`

Passing only `{ kind: subject.kind }` would already stop the warehouse snap (snap keys off `kind` alone). The two extra fields keep `report.generic` and `recommendedCount` honest.

## Rejected: add `forceShape` to texture_2ds_to_3ds

Smallest *kind-string* API, **not applied** (redundant with `shape`, and the instruction was not to edit `texture_2ds_to_3ds` once `shape` exists):

```diff
--- a/ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/tree-asset.mjs
+++ b/ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/tree-asset.mjs
@@ -73,7 +73,16 @@ export function reconstructFromViews(views, options = {}) {
   const silhouetteSize = options.silhouetteSize ?? ORBIT_ASSET.silhouetteSize;
   const resolution = options.resolution ?? ORBIT_ASSET.resolution;
   const working = views.map(view => resizeView(view, silhouetteSize));
-  const shape = options.shape ?? classifyOrbitShape(working);
+  const classified = classifyOrbitShape(working);
+  const forcedKind = options.forceShape ?? options.shape?.kind;
+  const shape = options.shape ?? (forcedKind
+    ? {
+        ...classified,
+        kind: forcedKind,
+        generic: forcedKind !== "custom" && forcedKind !== "humanoid",
+        recommendedCount: forcedKind === "cylinder" || forcedKind === "capsule" ? 2
+          : forcedKind === "humanoid" || forcedKind === "custom" ? 8 : 4,
+      }
+    : classified);
   const selection = chooseOrbitAngles(working, {
```

Town call-site that would go with it, also **not applied**:

```diff
--- a/ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs
+++ b/ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs
@@ -129,7 +129,8 @@ async function reconstructSubject(subject) {
     resolution: 48,
     silhouetteSize: 96,
     mapSize: 128,
     forceCount: catalog.length,
+    forceShape: subject.kind,
   });
```

Oak/willow/trash-can would survive that too (they never pass `forceShape`), but it duplicates `options.shape` and was therefore rejected.

## Expected log after the applied patch

```
[Minamihama] harbor-warehouse-8  shape=rectangle  views=4  …
[Minamihama] telephone-pole  shape=cylinder  views=2  …
```

Warehouse 8 no longer enters `snapOccupancyToPrimitive`. The pole does.
