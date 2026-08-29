# 03 — Flower-shop reconstruction audit (Midori florist)

Stills only. Do not edit sample source from this note.

Subject: `flower-shop` / Midori florist / `assets/flower-shop/yaw-{000,090,180,270}.png`.

Catalog (`src/catalog.mjs`):

```144:155:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\catalog.mjs
    id: "flower-shop",
    folder: "flower-shop",
    label: "Midori florist",
    kind: "rectangle",
    district: "sakae",
    x: -6,
    z: 8.6,
    yaw: Math.PI,
    realHeight: 6.8,
    realWidth: 6.6,
    realDepth: 7.8,
```

Current hull: **5248 tris, thin** (res 48 isosurface, 4 cardinals, photo-carve). The stills, not the catalog pose, are why.

## Verdict

| Question | Answer |
|---|---|
| Re-shoot? | **Yes — yaw-000 and yaw-180.** 090/270 optional (cloth / soft shadow). |
| South-row `yaw: Math.PI`? | **Correct.** Facade faces the street (north). Do not flip it to “fix” the thin hull. |
| `realHeight: 6.8`? | **Sane** for this 2F wooden shop. Height will land; plan depth will not until the hull is no longer thin. |

Peer cardinals (soba / greengrocer / tobacco `yaw-000`) are square-on elevations. Midori `yaw-000` is not.

## Per-yaw defects

Orbit camera (`texture_2ds_to_3ds/src/views.mjs`): yaw 0 sits at `+Z` looking `−Z`, so the **front still is the shop façade**. Visual hull extrudes each silhouette along that assumed ray. A mislabelled 3/4 still is the main thinner.

### yaw-000 — front — **fail (re-shoot)**

- **Slight 3/4 toward yaw-270 (left gable), ~25–35° off cardinal.** Left return, downstairs side window and soil pipe are in frame; the right awning corner recedes; `花屋 みどり` is not parallel to the picture plane. Soba / tobacco / greengrocer `yaw-000` are true fronts for comparison.
- Tighter crop than 090/180/270 (roof near the top, left wall clipped). Hull and bake assume the same subject scale in every still.
- Concrete porch + three pots exist only in this view. Other cardinals have no pots; hull intersection deletes them and smears the leftover texture on a flat front.
- Magenta “floor” under the porch (studio ground, not a void). `TOWN.md`: isolated, no floor, no cast shadow.
- Identity itself is good: 花屋みどり, OPEN 9-6, 生花, noren, striped awning. Keep on the reshoot.

**Effect:** pipeline treats this silhouette as yaw 0 and extrudes along `+Z`. A 3/4 outline is a foreshortened parallelogram. Intersection with true 090/180/270 gable/back elevations collapses depth into a diamond/wedge. Photoconsistency then sees a 3/4 photo on a “front” ray that disagrees with the gable/back colours and carves further. That is the thin 5248-tri hull.

### yaw-090 — right / east gable — watch

- Cardinal enough: ridge centred, both roof planes, front-bay overhang on the image-left (correct for a right-side view).
- Magenta is wrinkled cloth, not a flat `#E040A0` void. Chroma key can leave cloth islands or chew eaves.
- Soft contact shade under the foundation slab.
- Slab that sticks out on the left is real front-bay thickness — keep it, just don’t sit it on a floor shadow.

Usable. Re-shoot only if flattening the cloth and killing the shade is cheap while 000/180 are open.

### yaw-180 — back — **fail (re-shoot)**

- Elevation is the best cardinal of the four: rear door centred, boarded upper windows, antenna, downpipe, side pent roof.
- **Dirt is gone; the contact shadow is not.** Dark oval blob under a floating building. Greengrocer `yaw-180` plants a stone plinth as geometry with no oval. Midori’s blob is leftover shade on the cyclorama.
- Shadow pixels are dark purple-brown, not hot magenta. `magentaKeyAlpha` keeps them as subject → extra foot silhouette. 000/090/270 do not share that blob, so hull intersection at the base becomes a thin skirt or a disconnected pedestal (`keepGroundConnected` will stick it on).
- Magenta floor gradient (studio cyclorama) instead of a void.

### yaw-270 — left / west gable — watch

- Cardinal: ridge centred, lace upper window, downstairs window + shutter, pipes, BS dish.
- Magenta cloth wrinkles (same as 090). Base is the cleanest of the four — no oval.
- Dish is period-plausible (BS 1984+). Keep.
- No shop identity on this face, which is correct.

Usable. Same optional cloth flatten as 090.

## Which angles to re-shoot

| Priority | File | Why |
|---|---|---|
| **Must** | `yaw-000.png` | 3/4 still labelled front. Primary cause of the thin hull. |
| **Must** | `yaw-180.png` | Contact shadow after dirt removal. Base leak + further carve. |
| Should | `yaw-090.png` | Cloth wrinkles + soft slab shade. Elevation OK. |
| Optional | `yaw-270.png` | Cloth only. Best cardinal as-is. |

Do not re-shoot 090/270 instead of 000/180. Watermark (bottom-right) is already punched by `chroma-key.mjs`; ignore it.

### Reshoot brief (000 + 180)

Shared with `TOWN.md` / `README.md`:

- Magenta studio, isolated, **no floor, no cast/contact shadow, no dirt disc**.
- True cardinal. Camera on the face normal. Both near corners at equal distance. No visible side wall except the thickness of the wall itself.
- Same subject scale in frame as current 090/180/270 (building floating, even magenta margin).
- Same building: 2F green vertical siding, kawara gable, antenna, 花屋みどり shopfront on 000, rear door on 180.
- Unify the base: thin concrete foundation as **geometry**, not a cyclorama floor. No pots unless they appear in every yaw (they can’t on 180 — leave them off).
- Time lock stays: Saturday 29 November 1986, 15:20, overcast.

000 specifically: square-on façade, sign parallel to the picture plane, awning as a thin strip, both shopfront corners visible, no left-wall window.

180 specifically: same camera height/distance as 090/270; delete the oval; keep the float.

## South-row `yaw: Math.PI` — correct

World: `+X` east, `+Z` south (`TOWN.md`, `map.mjs`). Camera look is `sin(yaw)` on X and `cos(yaw)` on Z, so **yaw 0 faces south, yaw π faces north**.

Orbit yaw-000 (façade) is the mesh local `+Z` face. `plantMesh` does `object.rotation.y = pose.yaw`. `yaw: Math.PI` maps that façade to world `−Z` = **north**.

| | |
|---|---|
| Street | Sakae-dori, east–west. Centreline ~`z = 2`. Harbor south, hill north. |
| South sidewalk | `GROUND.sidewalkS` `z = 6…10`. |
| This shop | `x = -6`, `z = 8.6` — on the south row. |
| Street relative to shop | **North.** Façade must face `−Z`. |
| Scout `flower` | `x = -6`, `z = 5.2`, `yaw = 0` (looking south into the shopfront). Matches π-rotated mesh. |

North row (`z = -8.5`, `yaw: 0`) faces south into the same street. South-row rule is the 180° complement. Phone booth (`z = 6.2`, `yaw: Math.PI`) already follows it. Agent 32’s proposed test (`district === "sakae" && z >= 6` ⇒ `yaw === Math.PI`) would pass.

Do **not** set flower-shop yaw to 0. That would put the rear door on the sidewalk and the 花屋みどり sign facing the harbor.

Thin-ness is a still problem. Pose is right.

## Scale sanity — 6.8 m tall

Catalog metres: **H 6.8 / W 6.6 / D 7.8**.

| Check | |
|---|---|
| Programme | 2F wooden machiya-style shop + kawara gable. Ground shop ~3.0 m to awning, living floor ~2.6 m, ridge ~1.2 m above eave → **~6.8 m**. |
| Street peers | greengrocer 6.9, tobacco 7.0, cassette 7.1, soba 7.2, arcade 7.8. Midori is the shortest 2F shop — right for a modest florist. |
| Width 6.6 m | ~3.5 ken. Matches the shuttered shopfront. |
| Depth 7.8 m | Typical small shop going back. Same order as greengrocer 7.4 / tobacco 7.2. |

`realWorldScale` sets `sy = realHeight / extents.height` and **uniform XZ from `realWidth / max(widthX, depthZ)`**. It **ignores `realDepth`**.

So:

- **6.8 m height is authored correctly and will apply** (`sy` from the stills’ vertical span).
- A thin hull’s long axis (front width) is scaled to 6.6 m; the short axis stays short. **7.8 m depth is never realized** until 000/180 are re-shot and the hull is a box again.
- Plan overlap with the roadway (front would sit near `z ≈ 8.6 − 3.9 = 4.7` if depth were real) is the same approximation the north row already uses (soba front past the north curb). Not a Midori-specific bug.

Leave `realHeight: 6.8`, `realWidth: 6.6`, `realDepth: 7.8` as they are.

## Do not change from this audit

- Sample stills / catalog / `main.mjs` (parent reshoots 000 and 180).
- `yaw: Math.PI`, `x: -6`, `z: 8.6`.
- Metres above.

Reconstruct after the two must-reshoots; expect a thicker rectangle and a tri count in the same 48³ ballpark but a filled box, not a slab.
