# 16 — realHeight / realWidth / realDepth vs stills vs 1986 Japan

Catalog metres from `src/catalog.mjs`. Stills from `assets/<id>/yaw-000.png` (and yaw-090 for plan). No sample source edited.

`realWorldScale` (`texture_2ds_to_3ds/src/real-scale.mjs`) sets **Y from `realHeight`** and **both X and Z from `realWidth`**. `realDepth` is authored but unused at plant time. Table below is the authored HxWxD, not the squeezed XZ the scaler currently emits.

Rulers: Hiro is 1.72 m. Where he is absent, stills are read with 1986 street objects (door 1.8–2.0 m, kei plate 330×165 mm, 350 ml can, NTT handset, 下駄箱 slippers, コンクリートブロック 390×190, LP crate, 7-Eleven bag). Antennas, roof signs, and dishes sit inside the height AABB.

1986 norms used: kei box still 3.20 × 1.40 m (3.30 m only from 1990); Carry van 1.765–1.895 m tall; コンクリート電柱 10 m × ~0.25–0.35 m 元口; enamel 自販機 1.82 m; NTT ボックス ~2.2–2.4 × 0.9 × 0.9; two-storey 店舗併用 棟高 **6.5–8 m** (brief), 間口 2–4 間 (3.6–7.3 m), 奥行 5–10 m.

## Table

| id | catalog H×W×D (m) | visual guess from still (m) | verdict | suggested (m) |
|---|---|---|---|---|
| civilian-hiro | 1.72 × 0.52 × 0.32 | **1.72 × 0.50 × 0.32** — he is the ruler. Side shoe ~0.28 m → chest depth ~0.32; school jacket silhouette ~0.48–0.52 | OK | 1.72 × 0.50 × 0.32 |
| kei-van | 1.78 × 1.40 × 3.20 | **1.78 × 1.40 × 3.20** — plate 330 mm is ~1/4.2 of body → 1.39 m wide. Side L/H ≈ 1.80 → 3.20 m. 12″ wheel vs body OK. 1985 Carry van 3.195 × 1.395 × 1.765 (high-roof 1.895) | OK | 1.78 × 1.40 × 3.20 |
| telephone-pole | 10 × 0.35 × 0.35 | **10 × 0.30 shaft, ~1.8 crossarm, ~0.6 transformer** — full pole in frame; transformer ~2× shaft → shaft ~0.25–0.30; 10 m 電柱 is the shopping-street size. Catalog 0.35 is a fat 元口, correct as a cylinder diameter | OK vs brief / TEPCO shaft. **Too small** if `realWidth` is applied to the mesh AABB (crossarm) | 10 × 0.35 × 0.35 (shaft). If hull keeps hardware: 10 × 2.0 × 0.9 |
| vending-enamel | 1.82 × 0.90 × 0.72 | **1.82 × 0.90 × 0.72** — front H/W ≈ 2; side H/D ≈ 2.5. Four-row 350 ml cans sit at machine scale. JIS-era cabinet 1830 mm | OK | 1.82 × 0.90 × 0.72 |
| phone-booth | 2.40 × 0.90 × 0.90 | **2.35 × 0.90 × 0.90** — H/W ≈ 2.65. Handset 0.20 m / phone 0.40 m. A 1.72 m person clears the テレホン lamp by ~0.3–0.4 m. NTT ボックス often 2.2–2.3 m; brief asked 2.4 | OK | 2.40 × 0.90 × 0.90 |
| soba-shop | 7.2 × 6.4 × 8.2 | **7.4 × 6.4 × 6.8** — double door ~2.0 m, three bays ~6.0–6.5 m front. 2F windows ~1.2 m. Antenna in AABB. Side ¾ is one lattice bay, not an 8 m machiya | depth too big; H in 6.5–8 | 7.4 × 6.4 × 6.8 |
| you-arcade | 7.8 × 8.0 × 10 | **7.8 × 8.0 × 8.5** — glass doors ~2.1 m ≈ 27% of parapet → 7.8 H. Three front bays ~8 m. Side: two windows + 0.8 m 室外機 → ~8–9 m, not 10. Dishes in H | depth slightly too big | 7.8 × 8.0 × 8.5 |
| flower-shop | 6.8 × 6.6 × 7.8 | **6.8 × 6.4 × 7.4** — camellia in pot ~1.1 m; door ~1.85 m; low shutters (a 1.72 m person almost fills GF). Side gable ≈ H including 軒. Squat two-storey at the bottom of the 6.5–8 band | OK | 6.8 × 6.4 × 7.4 |
| cassette-shop | 7.1 × 6.8 × 8.0 | **7.1 × 6.2 × 4.8** — LP crate ~1.0 m is ~1/7 of ridge → H 7.0. 7-Eleven bag ~0.35 m on the side corner. Front crates+door+poster ~6.0–6.5 m. **Gable end is a single-room wall** (~4–5 m), not 8 m deep | depth too big; width slightly too big | 7.1 × 6.2 × 4.8 |
| greengrocer | 6.9 × 6.2 × 7.4 | **6.9 × 5.4 × 6.2** — cabbage 0.25 m, daikon 0.40 m, table 0.75 m (pile ~1.1 m, half the noren opening). Front is a 2.5–3 間 yaoya (~5.0–5.6 m). Side gable ~6 m with 軒 | width too big; depth slightly too big | 6.9 × 5.4 × 6.2 |
| tobacco-shop | 7.0 × 6.4 × 7.2 | **7.0 × 5.2 × 5.6** — glass door 2.0 × 0.85 m + magazine window. 週刊誌 grid and 0.8 m 室外機. H (tall shop GF + 2F + 瓦) matches 7.0. Front closer to 3 間 than 3.5; side gable brick is narrower than 7.2 | width and depth too big | 7.0 × 5.2 × 5.6 |
| yokobori-bar | 8.1 × 6.2 × 7.4 | **7.6 × 5.2 × 5.5** — 1-升 bottles 0.30 m, B2 poster, 2F window ~1.5 m. GALAXY plate sits on the ridge so AABB > 棟高. Front is an alley 2.5–3 間. Side gable is tall-and-thin (H/D ≈ 1.5), not 7.4 m deep. 8.1 m is just over the 6.5–8 shop band | too big (W, D); H slightly too big | 7.6 × 5.2 × 5.5 |
| wooden-hill-house | 7.4 × 8.2 × 7.6 | **7.4 × 7.4 × 7.6** — slippers 0.27 m; 玄関 1.8 m; 4 courses of 390×190 block ≈ 0.9 m planter. Two 瓦 roofs → H 7.2–7.8. Front still is ~1:1 W:H, not 8.2/7.4. Side gable matches 7.6 D | width slightly too big | 7.4 × 7.4 × 7.6 |
| harbor-warehouse-8 | 9.5 × 14 × 18 | **8.2 × 8.5 × 11** — 0.45 m 分電盤 is ~1/12–1/14 of the gable → frontage ~6–8 m, not 14. Cargo doors read ~3.2 m, ~40% of ridge → H ~8–8.5. Both stills are a compact 上屋 / large garage, not a 14×18 m shed | **too big** (footprint ~1.7–2×) | 8.2 × 8.5 × 11 |
| harbor-warehouse-3 | 8.2 × 16 × 12 | **8.2 × 16 × 12** — personnel door 2.0 × 0.85 m is ~24% of ridge → 8.3 H. Door is ~1/19 of the long facade → ~16 m. Side length/height ~1.5–1.6 → D ~12–13. Ladder and 0.5 m cabinets agree | OK | 8.2 × 16 × 12 |

## Extra-attention items

| subject | brief target | catalog | still + 1986 | action |
|---|---|---|---|---|
| kei-van | 3.2–3.4 L, 1.4 W, 1.7–1.9 H | 3.20 × 1.40 × 1.78 | Plate, side ratio, and 1986 kei **max 3.20 m** (3.40 m is 1998). Carry van 1.765–1.895 m | keep |
| telephone-pole | 10 × 0.35 | 10 × 0.35 | Shaft matches a 10 m コンクリート柱. Crossarm/transformer make the hull much wider than 0.35 m | keep 0.35 only if XZ is the shaft; otherwise raise `realWidth` to ~2.0 m |
| vending-enamel | 1.82 H | 1.82 × 0.90 × 0.72 | 1830 mm cabinet, 0.9 m is a wide 4-row enamel face | keep |
| phone-booth | 2.4 H | 2.40 × 0.90 × 0.90 | Square NTT box; 2.4 m is the tall end of the range | keep |
| shops (two-storey) | 6.5–8 m H | 6.8–8.1 | All ridge heights sit in-band except **yokobori-bar 8.1** (roof sign). **Widths 6.2–8.0 are systematically wide** vs 2–3.5 間 fronts in the stills. **Depths 7.2–8.2 overstate** cassette, tobacco, soba, yokobori | drop H on Galaxy to ~7.6; shrink several 間口 / 奥行 (see table) |

## Pipeline vs authored metres

- `realDepth` does not affect the mesh. `meshExtents.width` is `max(X,Z)`, so the **longer plan axis is scaled to `realWidth`**. A van catalogued 1.4 × 3.2 m becomes **1.4 m on its long axis** (~0.6 × 1.4 m footprint, 1.78 m tall) unless the scaler starts using `realDepth`.
- Same squeeze hits every building with D > W (most of Sakae).
- Pole `realWidth` 0.35 m applied to a crossarm AABB yields a ~10 m needle. Cylinder snap would drop the hardware the stills were drawn to keep.

## What is already right

Hiro, the Carry, the enamel machine, the NTT box, warehouse-3, and the two-storey **heights** (except Galaxy) match the stills and 1986 Kanagawa harbour-town fabric. The misses are almost all **plan**: warehouse-8 is a small 上屋 catalogued as a medium shed; several shotengai depths are double the gable still; a few fronts are a 間 too wide.
