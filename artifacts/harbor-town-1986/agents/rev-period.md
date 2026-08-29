# Period lock — Saturday 29 November 1986, 15:20 JST

Winter / clothing / sign critic. Do **not** edit sample source from this note.

Time lock (`TOWN.md`): **Saturday 29 November 1986, 15:20**, overcast Kanagawa
harbor town (Minamihama / Yokosuka stand-in 35.28°N). No rain, wet asphalt from
earlier drizzle, **no snow**. Shops still daylight; interiors tungsten. +X east,
+Z south.

Sources: v9 scout stills in `artifacts/harbor-town-1986/` (`sakae-v9`,
`street-east-v9`, `hill-v9`, `park-v9`, `quay-v9`, `seawall-v9`, `yokobori-v9`,
`bus-v9`, `town-v9`), magenta stills under `assets/{weeping-willow,english-oak,
zelkova,civilian-hiro,civilian-mika,park-bench,flower-shop,greengrocer,
you-arcade,kei-van,vending-enamel}/`, live `catalog.mjs` (`ORBIT_SUBJECTS` +
`INSTANCES`), `fill-world.mjs` `addStreetTrees` / `addParkBenches`,
`fill-park.mjs`, `fill-south.mjs`, `main.mjs` `addSkyline` / `addGapFill`.

**Headline: the clock says late November. The trees say June. The sidewalk
says one boy cloned twenty times. The skyline says unlabelled foamcore.**

Yokosuka 15:20 on this date is ~69 min before sunset, sun **11°**, air typically
**8–14 °C**, steel overcast. School コート weather. Deciduous canopies are
bare or russet, not lime curtains. That is the bar.

---

## 1. Trees — lush green willows in late November

### Amihama `weeping-willow` — **fail. June, not 29 Nov.**

Magenta still `assets/weeping-willow/yaw-000.png`: full **lime hanging
curtains**, photosynthetic, no autumn yellow, no leaf-fall. Catalog unique
`(46, 98)` plus four clones at `z ≈ 97–99` (west–east apron). `quay-v9` and
`seawall-v9` show the reconstructed hulls as **melted chartreuse drapes** over
the cap.

*Salix babylonica* / シダレヤナギ is a legal quay species. The **phenology is
not**. Kanto weeping willow yellows in late October and is **bare twigs by the
last week of November**. 15:20 overcast would read grey-brown cords, maybe a
few straw flags in the inner crown, water showing through. Lime curtains are
May–July.

Winter-correct still: grey fissured trunk, hanging bare branchlets, no summer
leaf mass. Do not tint the current still brown and call it done — the **volume**
is the summer tree.

### Suzume `english-oak` — **fail. Wrong species and wrong season.**

Magenta still: a full-leaf English oak (*Quercus robur*), June green, one
dead limb. Catalog unique `(−42, −44)` plus eleven clones on the park grid.
`hill-v9` / `park-v9` / `town-v9` show green-brown melted canopies over khaki
is wrong; the still itself is midsummer.

Kanagawa 1986 hill parks are **欅 (zelkova), 桜 (bare), 銀杏 (gold then drop
by mid–late Nov), 楠 (evergreen), 松**, not a European park oak. If an oak
must stay, it is クヌギ / コナラ with **marcescent brown leaves or a bare
scaffold**, not a 15 × 14 m June crown.

### Street `zelkova` still vs what the street shows

Magenta still `assets/zelkova/yaw-000.png` is the **only winter-correct tree
in the catalog**: thin trunk, twig fan, hanging russet 欅 leaves. That is 29
Nov. Keep that still.

It does **not** reach the camera. Agent 62 logged `zelkova` at **24 tris**
(invisible). What `sakae-v9` and `street-east-v9` actually photograph is the
geo lollipop pass (next section). Unique + 16 curb clones at `z = ±6.7` are
air or a smear. The winter keyaki never became a street colonnade.

### Lawn / hedge (tree-adjacent)

`GROUND.park` `0x4a5c3a` and the height-field grass vertex `rgb(0.32, 0.38,
0.22)` are a **June football pitch**. Late-November Kanagawa turf is khaki /
olive-dead, short, some mud at the stair mouth. `park-v9` is a putting green.

Hedges `0x1a3520` / `0x3a4a32` can stay dark (inutsuge / sakaki hold leaf).
They must not read as the same lush as the lawn.

### What *is* winter-correct on a shop still

`flower-shop/yaw-000.png`: **sazanka/tsubaki in pot, bare twig, cyclamen**.
That is 29 Nov. Honour it. Do not fill Midori’s spill with summer bunches.

Yaoya chalkboard: **白菜 98円/kg, 大根, みかん, 昭和61年11月29日(土)**. Produce
and date are the lock. Keep.

---

## 2. Geo lollipop trees

`fill-world.mjs` `addStreetTrees`:

```
CylinderGeometry(0.16, 0.22, 4.2)   // trunk
SphereGeometry(1.45, 8, 6)          // crown
canopy 0x6a5a32                     // muddy brown
xs = [-34, -24, -10, 2, 14, 28, 40]
z  = ±7.15                          // 14 lollipops
```

`sakae-v9` right third and `street-east-v9` upper right are **perfect brown
spheres on sticks**. That is not 欅. It is a 1998 low-poly placeholder sitting
on a 1986 shotengai.

Brown instead of lime is the only seasonal concession, and it is not enough.
A late-November keyaki is a **forked twig silhouette** 6–8 m over the curb,
leaves as flakes, sky through the crown. A sphere occludes like a summer
lollipop even when the albedo is ochre.

Worse: the geo row sits **0.45 m outside** the catalog zelkova line
(`z = ±6.7`). Two tree systems, one invisible, one candy. Kill the
`SphereGeometry` pass. Ship the winter zelkova hull (or a cheap **Y-fork
cylinder + no crown sphere** until the 8-view reconstructs).

Do not “fix” the lollipop by painting it green. That would add a second
June crime on top of the first.

---

## 3. Clothing — identical schoolboys

### The body

`civilian-hiro` still: dark **blazer + tie + white shirt + navy trousers +
loafers**. No overcoat, no scarf, no 学生カバン, A-stance. Blazer uniforms
existed in 1986 (alongside 詰襟). The **cut is period**. The **layer is not**.

15:20, 8–14 °C, overcast, wet asphalt. Kanagawa high-school boys in November
wear the school **コート** or at least a scarf; Saturday 土曜授業 (still
common in 昭和61; some districts already 隔週休み) ends around noon, so
uniform in town at 15:20 is legal. Coatless clones on the quay are not.

`civilian-mika` still: camel **wool coat**, pleated skirt, loafers. That is
the winter civilian. She is **not in `ORBIT_SUBJECTS` or `INSTANCES`**. Four
yaws on disk, zero pixels in v9.

### The army

Catalog: unique Hiro `(−9.2, −7.3)` plus **21 `INSTANCES`**. Twenty-two
identical 1.72 m blazers.

`sakae-v9` (looking north at the zebra): **three Hiros in one frustum** —
near south-walk back, mid zebra, north-walk facer. Same face, same idle,
same coatless winter. `hill-v9`: another on the stairs. `seawall-v9`: one
standing **on a crate** in school kit, more copies receding down the apron.
`bus-v9`: one at the shelter. `yokobori-v9`: one in the alley.

Agent 49 already forbade this. Kit (poles, enamel) clones; a named schoolboy
does not. Saturday sidewalk life is **mixed silhouettes**: one gakuran *with
coat and bag*, a dock worker in 作業着, a housewife in coat (Mika), maybe a
salaryman. One blazer A-stance stamped from Yaoya to Amihama reads as a
bug, not a school.

Illegal plants vs travel lanes `z ∈ [−6, 6]`:

| x | z | note |
|---:|---:|---|
| −2.2 | **1.4** | carriageway |
| 2.6 | **2.8** | carriageway |
| −1.4 | **8.2** | south walk / shop spill — borderline |

Dock copies in blazer (`(−16, 80)`, `(12, 82)`, `(−28, 78)`, `(0, 64)`) fail
**occupation** as well as season.

Winter-correct: stop instancing Hiro. Plant Mika. Add a second unique in a
**dark school coat** and a third in dock workwear. Until those stills exist,
**one** Hiro on Sakae is more 1986 than twenty-two.

---

## 4. Signs — AKB graffiti, shop paint, plates

### Park benches — **no AKB. Keep it that way.**

Two bench languages, neither tagged:

- `fill-park.mjs`: 12 wood `BoxGeometry` seats, `0x3c2a1c`, no albedo card.
- `fill-world.mjs` `addParkBenches`: 8 more wood/concrete boxes.
- Magenta `assets/park-bench/yaw-000.png`: weathered slat bench, concrete
  feet, **no writing**. Not in `ORBIT_SUBJECTS`.

`park-v9` / `hill-v9`: blank dark L-shapes. **Zero graffiti.**

If a later pass adds tags: **AKB is forbidden.** AKB48 formed **8 Dec 2005**.
A 1986 Kanagawa park bench does not say AKB. Period tags, if any, are
bosozoku kanji, a school initial, 愛, maybe **BOØWY** / チェッカーズ /
聖飢魔II, not a 2000s idol acronym. Prefer **no tags** on municipal timber;
1986 neighbourhood parks were mostly clean slats plus bird mess.

Do not paint English bubble-letter “AKB” on the `park-bench` still “for
youth.” That is a 19-year anachronism.

### Shop signs that honour the lock

| still | verdict |
|---|---|
| Yaoya chalkboard **昭和61年11月29日(土)** + 白菜/大根/みかん | **pass** |
| Carry windshield **昭 11月 29日 土** | **pass** (date) |
| Pharmacy **昭和61年創業 / HARU PHARMACY 1986** | date language OK; “founded this year” is on-the-nose |
| Enamel **自動販売機**, ¥100–¥110 cans, red/cream | **pass** (agent 06) |
| Pole stamps **昭和61年 / 東京電力** | **pass** (Kanagawa is TEPCO) |
| Flower **花屋みどり**, winter pots | **pass** (flora); shutters **down** vs **OPEN 9-6** at 15:20 is a lock fight — Saturday afternoon a florist is open |
| Arcade **SPACE INVADER '86** | faded 1978 marquee still hanging in 1986 is legal; **本日休業** posters on the locked Saturday are not. Either the town is closed or the clock is 15:20 Saturday — pick one |

### Plates / geography on signs

Carry / kei-van yellow kei plate **品川 541 さ 88-26**: period *format*
(yellow, 2×2, hiragana). Wrong **office**. Minamihama is Kanagawa. Agent 15:
**湘南** (or 横浜 / 川崎), not 品川. Do not letter Dobuita. 541-class kei
codes are fine; the 陸運 office is not.

No QR, no 7-digit 郵便番号 (that is 1998), no 046 mobile. Yokosuka area in
1986 is **0468**.

### Blank concrete boxes — unsigned massing

v9 stills are full of **untextured `MeshStandardMaterial` boxes** with no
看板, no eaves, no shutters, no TV antenna, no dirty stucco:

| pass | colour | where it reads |
|---|---|---|
| `addSkyline` 10 blocks | `0x5a–0x7a` greys | `town-v9` north wall of blank prisms |
| `addGapFill` 11 blocks + 4 dark panes | `0x6a6560` / `0x5c5852` | `sakae-v9` behind Yaoya/pharmacy/arcade |
| `fill-south.mjs` | same greys, **“No catalog ids, no signs”** | south backing / east caps |
| `fill-world` yokobori / route16 massing | charcoal / beige | `yokobori-v9` cliff; `bus-v9` beige slab |

1986 Kanagawa 2-storey infill is **dirty mortar, corrugated shutter, one
projecting 看板, a rusted クーラー, an antenna**. A 7–10 m raw box is a
volume placeholder, not a period façade. Gap-fill’s four `0x2a3238` panes
do not make a shop. They make a warehouse with punched holes.

Winter-correct cheap pass: break the roofline, add a 0.4 m eave slab, one
unlit 看板 box, shutter grooves. Colour toward **dirty cream / pale tile /
rusty galvanised**, not render-grey. Leave far skyline darker, but not
featureless.

---

## 5. Pass / fail (this lock)

| item | 29 Nov 1986, 15:20 | action |
|---|---|---|
| Willow still + quay hulls | **fail** — June lime | reshoot bare シダレヤナギ |
| English oak still + park grid | **fail** — species + June leaf | winter 欅/クヌギ, or brown-bare oak |
| Zelkova magenta still | **pass** — winter 欅 | keep; fix reconstruct |
| Geo `SphereGeometry` curb trees | **fail** — lollipops | delete `addStreetTrees` crowns |
| Park lawn `0x4a5c3a` | **fail** — June pitch | khaki dormant turf |
| Hiro blazer cut | **pass** | — |
| Hiro no coat / no bag | **fail** — underdressed | coat still, or park him indoors |
| 22× identical Hiro | **fail** — clone army | one unique; wait for Mika / worker |
| Hiro on quay / in lanes | **fail** | sidewalk only; dock gets workwear |
| Mika camel coat | **pass** (still) | plant her |
| AKB on benches | **absent (pass)** | never add AKB; 2005 |
| Park benches blank wood | **pass** for graffiti | optional 1986 tags only, not idol |
| Yaoya / Carry date cards | **pass** | keep 昭和61年11月29日(土) |
| Florist shutters vs OPEN 9-6 | **fail** at 15:20 Sat | open the shutter or change hours |
| Arcade 本日休業 | **fail** vs Saturday lock | drop the closed posters |
| 品川 kei plate | **fail** geography | 湘南 / 横浜 |
| Skyline / gap / south boxes | **fail** as period shops | eave + 看板 + dirt; not foamcore |

Until willows go bare, lollipops leave the curb, and the blazer stops
tiling the town, the stills are a summer diorama with a November chalkboard.
