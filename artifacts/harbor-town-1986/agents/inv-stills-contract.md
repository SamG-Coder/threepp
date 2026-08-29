# inv-stills-contract

Visual hull stills vs `TOWN.md` reconstruction rules. Inspected `ThreeBrowserRuntime/samples/harbor_town_1986/assets/<folder>/yaw-*.png`. No source edits.

**Contract (AND).** Magenta studio `#E040A0`-class, isolated, no floor, no cast shadow. Subject fully in frame. No Grok watermark and no leftover magenta-patch rectangle. Rectangle shops: 4 true cardinals (not 3/4). Custom / organic / parked 80s vehicles / trees: 8 yaws at 45°. Cylinder: `000` + `090`. Humanoid: 8 yaws at 45°. Folder **PASS** only if every required yaw exists and every file meets the still.

**Kinds used for missing-yaw counts.** `TOWN.md` cheat-sheet, not catalog `kind` (Cub and kei vehicles are catalogued `rectangle` but the town rule is custom). Uncatalogued folders use the same cheat-sheet.

Highlight set (user): `zelkova`, `honda-cub`, `kei-van`, `pharmacy`, `city-bicycle`, `civilian-mika`, `fishing-boat`, `kei-sedan`, `park-bench`, `english-oak`.

**Scoreboard: 0 PASS / 32 FAIL.**

| folder | kind (contract) | files | missing yaws | cropped | floor / shadow | pink ≠ `#E040A0` | watermark | 3/4 vs cardinal | **verdict** |
|---|---|---|---|---|---|---|---|---|---|
| barber-shop | rectangle | 000 090 180 270 | none | no | **fail** 180 grey drop-shadow + hover slab | gradient cyc | patch BR on all | 270 is blank gable (no pole/chairs), not the 090 twin | **FAIL** |
| cassette-shop | rectangle | 000 090 180 270 | none | no | faint plinth contact | dusty / gradient | patch BR | 090 now ortho gable; 000 mostly ortho | **FAIL** |
| city-bicycle | custom | 000 090 | **045 135 180 225 270 315** | no | gradient floor | dusty rose | **Grok** BR | **000 is 3/4**, not dead-on front; 090 is true side | **FAIL** |
| city-bus | rectangle (TOWN: custom car) | 000 090 180 270 | none for 4-cardinal; **045 135 225 315** if custom | no | **fail** grey contact ovals on all 4 | dusty rose | patch BR | 000/090/180/270 are true cardinals | **FAIL** |
| civilian-hiro | humanoid | 000 045 090 135 180 225 270 315 | none | no | **fail** cyc floor under shoes | dusty rose cyc | **Grok** BR | 45s OK for humanoid | **FAIL** |
| civilian-mika | humanoid | 000 045 090 | **135 180 225 270 315** | no | **fail** painted floor | dusty rose wall+floor | **Grok** BR | 000/090 cardinals OK; 045 is a legal 45 | **FAIL** |
| crate-stack | rectangle | 000 090 180 270 | none | no | gradient floor | dusty rose | patch BR | 000 mostly ortho | **FAIL** |
| english-oak | custom | 000 045 090 135 180 225 270 315 | none | **fail** canopy / dead limb off-frame on 000 045 090 180 270 | isolated, no floor | hot magenta, closest to `#E040A0` | **Grok** BR on all 8 | 45s OK | **FAIL** |
| fishing-boat | custom | 000 090 180 | **045 135 225 270 315** | no | gradient floor | dusty rose | **Grok** BR | 000/090/180 usable as cardinals; 090 slight perspective | **FAIL** |
| flower-shop | rectangle | 000 090 180 270 | none | 000 left mass tight | 000 cyc floor; 180 void after shadow fill | gradient / curtain | patch BR | 000 still reads slight 3/4 + backdrop folds; 090 gable OK | **FAIL** |
| greengrocer | rectangle | 000 090 180 270 | none | no | gradient floor | dusty / gradient | patch BR | 000 ortho | **FAIL** |
| harbor-warehouse-3 | rectangle | 000 090 180 270 | none | no | **fail** concrete quay slab attached | dusty | patch BR | 000 ortho eave | **FAIL** |
| harbor-warehouse-8 | rectangle | 000 090 180 270 | none | no | isolated-ish | hot-ish magenta | **Grok** BR | **000 is 3/4 cube**; 090 true gable | **FAIL** |
| hardware-shop | rectangle | 000 090 180 270 | none | no | gradient floor | dusty / gradient | patch BR | 000 ortho | **FAIL** |
| honda-cub | custom (catalog: rectangle) | 000 090 180 270 | **045 135 225 315** | no | **fail** 270 hover + grey oval; 090 wheels on cyc | gradient cyc | patch BR | 000/090/180/270 angles OK; silhouette mismatch (000 one mirror, 180 two) | **FAIL** |
| kei-sedan | custom | 000 | **045 090 135 180 225 270 315** | no | gradient floor, faint contact | dusty rose | **Grok** BR | 000 is true front | **FAIL** |
| kei-van | custom (catalog: rectangle) | 000 090 180 270 | **045 135 225 315** if custom | **fail 270** — cab/door only, wheels gone | 000/180 cyc paper + contact | dusty / cyc wrinkles | patch BR | 000/090/180 cardinals; 270 not a left elevation | **FAIL** |
| kissaten | rectangle | 000 090 180 270 | none | no | gradient floor | dusty rose | patch BR | 000 ortho | **FAIL** |
| oil-drum | cylinder | 000 090 | none | no | isolated | dusty | patch BR | n/a (cylinder) | **FAIL** |
| park-bench | rectangle | 000 | **090 180 270** | no | gradient cyc | dusty rose | **Grok** BR | 000 is true front | **FAIL** |
| pharmacy | rectangle | 000 090 180 270 | none | no | gradient floor (no grey blob) | dusty / gradient | patch BR | **270 is ~40° 3/4** (shopfront + 薬 noren wrap); 000/090/180 ortho | **FAIL** |
| phone-booth | rectangle | 000 090 180 270 | none | 090 roof/plinth tight | isolated | hot-ish | **Grok** BR | **000 is 3/4** (door + side); 090 is a face | **FAIL** |
| soba-shop | rectangle | 000 090 180 270 | none | no | 270 concrete pad; cyc curtain | dusty rose | **Grok** on 270; patch on 090 | 090 better gable; **270 is a wide face + flag wrap, not 090 twin** | **FAIL** |
| steel-bin | custom (TOWN: cylinder) | 000 045 090 135 180 225 270 315 | none for 8; none for cylinder | no | isolated | hot magenta | **Grok** BR | 000 slight 3/4 (both handles) | **FAIL** |
| telephone-pole | cylinder | 000 090 | none | base/crossarm tight | isolated | dusty | **Grok** BR | n/a | **FAIL** |
| tobacco-shop | rectangle | 000 090 180 270 | none | no | gradient floor | dusty / gradient | patch BR | 000 ortho; 090 now gable (balcony as thin profile) | **FAIL** |
| vending-enamel | rectangle | 000 090 180 270 | none | no | gradient floor | dusty / gradient | **Grok** BR | 000 slight 3/4 (side visible); 090 true side | **FAIL** |
| weeping-willow | custom | 000 045 090 135 180 225 270 315 | none | **fail** hanging foliage off-frame on 000 | isolated | hot magenta | **Grok** BR | 45s OK | **FAIL** |
| wooden-hill-house | rectangle | 000 090 180 270 | none | **fail** 090 pots disconnected below CMU; 000 pots hang off bottom | 090 magenta gap under pots | 000 hot; 270 gradient | patch BR | 090/270 stacked-gable twins (warehouse-090 is gone) | **FAIL** |
| yokobori-bar | rectangle | 000 090 180 270 | none | no | gradient floor | dusty / gradient | patch BR | **000 is 3/4**; 090 gable OK | **FAIL** |
| you-arcade | rectangle | 000 090 180 270 | none | no | gradient floor | dusty / gradient | patch BR on 000; **Grok** on 270 | 000/270 reasonably ortho | **FAIL** |
| zelkova | custom | 000 045 090 135 180 225 270 315 | none | **fail** trunk cut at frame on all 8; tips tight | isolated | **fail** dusty rose, not `#E040A0` | **fail** BR rectangle is a different (hotter) pink — watermark fill | 45s exist and look like an orbit | **FAIL** |

## Highlight notes

### zelkova — FAIL
Eight 45° files exist. Studio is a dusty rose gradient, not hot `#E040A0`. Every yaw has a bottom-right fill rectangle of a different magenta (watermark patch). Trunk is cropped at the bottom; no roots. No floor shadow.

### honda-cub — FAIL
Four cardinals present. Missing custom 45s: **045 135 225 315**. `yaw-270` floats with a grey drop-shadow. `yaw-000`/`090` sit on a gradient cyc. Watermark patches. Mirror count disagrees (one on 000, two on 180).

### kei-van — FAIL
`yaw-270` is a cropped cab/door crop with empty wheel wells — not a left elevation. `yaw-000`/`180` show paper-cyc wrinkles. Gradient pink + BR patches. Missing custom 45s: **045 135 225 315**.

### pharmacy — FAIL
`yaw-270` is a 3/4 (front fascia, 薬 noren, curtains on the gable). `yaw-090` is the true gable template. Gradient floor + BR patches on all four. Files present: 000 090 180 270. Missing: none as files; **true 270 cardinal** is missing in substance.

### city-bicycle — FAIL
`yaw-000` is a 3/4, not a front cardinal. `yaw-090` is a true side. Dusty rose cyc, **Grok** watermark. Missing: **045 135 180 225 270 315**. Also missing a true `000`.

### civilian-mika — FAIL
Dusty rose painted cyclorama + floor, **Grok** watermark, shoes on floor. Missing: **135 180 225 270 315**.

### fishing-boat — FAIL
Dusty rose, **Grok**, gradient floor. Bow/side/stern exist. Missing: **045 135 225 270 315** (starboard 270 is the cheapest cardinal hole).

### kei-sedan — FAIL
Only a true front. Dusty rose, **Grok**, floor. Missing: **045 090 135 180 225 270 315**.

### park-bench — FAIL
Only a true front. Dusty rose, **Grok**, cyc wrinkles. Missing: **090 180 270**.

### english-oak — FAIL
All eight yaws exist; studio is the hottest `#E040A0`-class in the set and there is no floor. **Grok** watermark on every still. Canopy (and on 045 the dead limb) is cropped off the frame on 000, 045, 090, 180, 270.

## Missing yaws (files)

| folder | missing files |
|---|---|
| city-bicycle | yaw-045, yaw-135, yaw-180, yaw-225, yaw-270, yaw-315 |
| civilian-mika | yaw-135, yaw-180, yaw-225, yaw-270, yaw-315 |
| fishing-boat | yaw-045, yaw-135, yaw-225, yaw-270, yaw-315 |
| honda-cub | yaw-045, yaw-135, yaw-225, yaw-315 |
| kei-sedan | yaw-045, yaw-090, yaw-135, yaw-180, yaw-225, yaw-270, yaw-315 |
| kei-van | yaw-045, yaw-135, yaw-225, yaw-315 |
| park-bench | yaw-090, yaw-180, yaw-270 |
| city-bus | yaw-045, yaw-135, yaw-225, yaw-315 (only if treated as custom car) |

All other folders have the file set their contract kind requires. Failures there are quality (3/4, crop, shadow, pink, watermark), not missing files.

## Watermark pattern

- **Visible Grok logo:** city-bicycle, civilian-hiro, civilian-mika, english-oak, fishing-boat, harbor-warehouse-8, kei-sedan, park-bench, phone-booth, soba-shop (270), steel-bin, telephone-pole, vending-enamel, weeping-willow, you-arcade (270).
- **BR magenta rectangle patch (wrong hue vs field):** barber-shop, cassette-shop, city-bus, crate-stack, flower-shop, greengrocer, harbor-warehouse-3, hardware-shop, honda-cub, kei-van, kissaten, oil-drum, pharmacy, tobacco-shop, yokobori-bar, you-arcade (000), zelkova, wooden-hill-house.

No folder is catalog-ready until pink is a flat `#E040A0` void, watermarks/patches are gone, shadows/floors are gone, crops are in-frame, and every claimed cardinal is an elevation.
