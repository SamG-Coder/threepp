# New stills — barber, pharmacy, scooter

Uncatalogued session stills. Criteria from `TOWN.md` / `texture_2ds_to_3ds`: **orthogonal** (buildings = cardinals; scooter = 45° custom), **magenta studio** (`#E040A0`-class, isolated), **no floor** (no non-magenta ground, no cast shadow that will survive chroma-key), **silhouette consistency** across the orbit.

Session prefix: `C:\Users\samue\.grok\sessions\C%3A%5CThreeBrowser\01a0420b-3c70-77d1-8a9b-ad22fcbf5617\images\`

Reference bar: catalogued `flower-shop/yaw-270.png` (true gable, only eave wraps) and `kei-van/yaw-090.png` (cardinal, magenta sweep, watermark patched). Catalogued `flower-shop/yaw-180.png` already has the floating-slab drop-shadow defect — do not copy it.

All eleven stills carry a Grok watermark in the empty lower-right. Patch with magenta before ingest (same as kei-van / florist). Watermarks sit off-silhouette, so they are **cleanup**, not the hull-breaker.

---

## Pass / fail per image

| file | subject | claimed | orthogonal | magenta | no floor | silhouette vs set | verdict |
|---|---|---|---|---|---|---|---|
| `98.jpg` | barber | 000 front | **pass** — dead-on shopfront | **pass** | **fail** — levitating concrete slab + grey drop-shadow | front mass, pole-left, door-right, antenna-left agree with `104`/`106` | **FAIL** |
| `101.jpg` | barber | 270 left | **pass** — orthogonal gable | **pass** | **watch** — sits on magenta, faint contact | **fail** — gable as wide as the front; **no pole, no chairs**; left flank should show both | **FAIL** |
| `104.jpg` | barber | 180 back | **pass** — orthogonal rear | **pass** | **fail** — same floating slab + drop-shadow as `98` | **pass** — width ≈ front; antenna flipped to the right; rear door / laundry rack | **FAIL** |
| `106.jpg` | barber | 090 right | **pass** — orthogonal gable, front cluster on image-left | **pass** | **pass** — plinth on magenta, no grey blob | **pass** vs `98` (pole + yellow chairs at front edge). Width is the **correct** shallow depth; `101` is the mismatch. Chairs slightly explode off the corner | **PASS** |
| `100.jpg` | pharmacy | 000 front | **pass** — dead-on shopfront | **pass** | **pass** — magenta sweep, no grey shadow | mint tile, mortar/pestle sign, bucket-right, AC-right, noren door | **PASS** (patch red `1986.11.29` stamp) |
| `102.jpg` | pharmacy | 180 back | **pass** — orthogonal rear | **pass** | **pass** | **pass** — bucket/antenna flipped to the left; width ≈ `100`; pipes / wooden door | **PASS** |
| `105.jpg` | pharmacy | 270 left | **fail** — ~40° 3/4, shopfront + signboard visible | **pass** | **pass** | **fail** — front upper window migrated onto the side gable; silhouette is a house-shaped 3/4, not a box face | **FAIL** |
| `108.jpg` | pharmacy | 090 right | **pass** — true gable, no shopfront peek | **pass** | **pass** | **pass** vs `100` — AC + bucket at front (image-left); small rear window; narrower than front | **PASS** |
| `107.jpg` | scooter | 000 front | **pass** — dead-on | **pass** | **pass** | **fail** — wide apron / headlight-in-body, not a Cub nose. Contradicts skinny step-through of `99`/`103`. One mirror vs two on `103` | **FAIL** |
| `103.jpg` | scooter | 045 | **pass** — ~45° toward the exhaust flank | **pass** | **fail** — floating wheels + grey drop-shadow | Cub identity matches `99` (crate, rust, Super Cub script). Extra second mirror | **FAIL** |
| `99.jpg` | scooter | 090 side | **pass** — true 90° left/exhaust profile | **pass** | **pass** — wheels on magenta, like kei-van | Honda Cub + 明治 milk crate. This is the **left** flank (muffler toward camera), not the right | **PASS** |

---

## Barber (`98` `101` `104` `106`) — not catalog-ready

Identity is stable and period-correct: 港町理容室 / HARU BARBER SINCE 1963, pole, two yellow chairs, 理容 noren. 2-storey stucco, tiled gable, TV antenna.

Orbit map (catalog `CARDINAL_VIEWS`: 000 front, 090 right, 180 back, 270 left):

| yaw | file | usable? |
|---|---|---|
| 000 | `98.jpg` | after magenta-fill of the drop-shadow and the gap under the slab |
| 090 | `106.jpg` | yes |
| 180 | `104.jpg` | after the same shadow fill as `98` |
| 270 | `101.jpg` | **regen** |

`101` is the blocker. A true 270 must be the **narrow** gable (same width as `106`), with the pole and chairs at the **front** edge of that wall (image-right, because 270 puts the facade on the right). Right now `101` is a blank square prism the width of the shopfront.

Do not ingest a 4-view hull until 270 matches 090’s depth.

---

## Pharmacy (`100` `102` `105` `108`) — not catalog-ready

Identity is stable: 港町薬局 / HARU PHARMACY 1986 / 昭和61年創業, mint square tiles, mortar-and-pestle enamel, red 薬 noren, roof bucket, rusty AC. Time lock holds (Showa 61 = 1986).

| yaw | file | usable? |
|---|---|---|
| 000 | `100.jpg` | yes, after magenta-patch of the red date stamp + Grok mark |
| 090 | `108.jpg` | yes — this is the 270 template (mirror it) |
| 180 | `102.jpg` | yes |
| 270 | `105.jpg` | **regen** |

`105` is a 3/4, not a cardinal. Regenerating 270: copy `108`’s camera (orthogonal gable, no shopfront, no signboard), but from the **left**. Front (bucket, AC, 薬 curtain) belongs on the **image-right**. Side wall should stay mostly tile, with only wrap of the AC/pipes — not the upstairs front window transplanted onto the gable.

`100`/`102`/`108` already meet the florist-270 quality bar and are better orthogonals than catalogued `flower-shop/yaw-000.png` (which is itself a 3/4).

---

## Scooter — custom 8-view (Honda Super Cub + milk crate)

`TOWN.md`: parked 80s scooters are **custom** → `HUMANOID_VIEWS` (8 yaws at 45°).

User mapping (followed below):

| yaw | file | status |
|---|---|---|
| 000 front | `107.jpg` | **FAIL** — regen as a Cub front (round lamp on the fork, skinny fender, visible wheel/step-through). Must be as narrow as `99`’s nose |
| 045 | `103.jpg` | angle OK; **FAIL** floor (de-float, kill shadow, park it on magenta like `99`) |
| 090 side | `99.jpg` | **PASS** — keep. Exhaust / engine / 牛乳 crate facing camera |
| 135 | — | **missing** |
| 180 | — | **missing** |
| 225 | — | **missing** |
| 270 | — | **missing** |
| 315 | — | **missing** |

Remaining yaws, continuing **this** orbit (000 → exhaust-side 045/090, so 090 is the Cub’s **left** flank, even though the catalog label for 090 is “right”):

- **135** back-left: crate + rear wheel + left flank, muffler still visible
- **180** back: crate from behind, taillight, rear tyre only — no 3/4
- **225** back-right: crate + **right** flank, **no** muffler
- **270** right: dead-on opposite of `99` — no exhaust, engine hidden, one side panel
- **315** front-right: headlight + right flank, no exhaust

Do not generate another exhaust-side photo for 270. Pin: same crate (明治 牛乳), same rust, same faded red, kickstand down, wheels on magenta, no shadow, no Grok mark. After `107` is a real Cub front, lock mirror count (recommend **one** left mirror, as on `99`/`107`, not the second mirror that appeared on `103`).

Not catalog-ready until the five missing yaws exist **and** 000/045 are regenerated.

---

## Suggested catalog entries

South row: `z ≈ 8.6`, `yaw = Math.PI`, facades face **north** toward Sakae. Existing florist is the datum (`flower-shop` at `x: -6, z: 8.6, yaw: Math.PI`, 6.8 × 6.6 × 7.8 m). North-row centres sit at x = −25 / −14 / −4 / 8 / 20. Phone booth (`x: 2.4, z: 6.2`) stays in the sidewalk gap.

Do not add these to `catalog.mjs` until the stills pass (barber 270 regen + shadow fill; pharmacy 270 regen). Sample source is untouched.

```js
{
  id: "barber-shop",
  folder: "barber-shop",
  label: "Haru barber",
  kind: "rectangle",
  district: "sakae",
  x: -18,
  z: 8.6,
  yaw: Math.PI,
  realHeight: 7.2,
  realWidth: 6.5,
  realDepth: 7.6,
},
{
  id: "pharmacy-shop",
  folder: "pharmacy-shop",
  label: "Haru pharmacy",
  kind: "rectangle",
  district: "sakae",
  x: 8,
  z: 8.6,
  yaw: Math.PI,
  realHeight: 6.8,
  realWidth: 6.4,
  realDepth: 7.4,
},
```

Placement:

- Barber at x = −18 occupies ≈ −21.3…−14.8, west of florist (−9.3…−2.7), across from Nishiya soba / Kamimura tobacco.
- Pharmacy at x = 8 occupies ≈ 4.8…11.2, east of florist, directly across Starlight Arcade. Sidewalk vending at x = 12.4 stays just off the east corner.
- Depths match the florist so the south facade line stays straight at z ≈ 8.6 − depth/2.

Scooter (only after the 8-view is complete). Honda Super Cub C50-class + rear crate: ~1.85 m long, 0.66 m wide, 1.15 m to mirror. `kind: "custom"`. Park on Sakae asphalt in front of the south row, e.g. `x: -10.5, z: 4.6, yaw: Math.PI * 0.5` (nose east, beside the florist):

```js
{
  id: "honda-cub",
  folder: "honda-cub",
  label: "Meiji milk Cub",
  kind: "custom",
  district: "sakae",
  x: -10.5,
  z: 4.6,
  yaw: Math.PI * 0.5,
  realHeight: 1.15,
  realWidth: 0.66,
  realDepth: 1.85,
},
```

---

## Ingest checklist (when stills pass)

Folders under `samples/harbor_town_1986/assets/`:

- `barber-shop/yaw-000.png` ← `98.jpg` (shadow filled)
- `barber-shop/yaw-090.png` ← `106.jpg`
- `barber-shop/yaw-180.png` ← `104.jpg` (shadow filled)
- `barber-shop/yaw-270.png` ← **new**
- `pharmacy-shop/yaw-000.png` ← `100.jpg` (date stamp filled)
- `pharmacy-shop/yaw-090.png` ← `108.jpg`
- `pharmacy-shop/yaw-180.png` ← `102.jpg`
- `pharmacy-shop/yaw-270.png` ← **new**
- `honda-cub/yaw-000.png` … `yaw-315.png` ← 107 regen, 103 de-floated, 99 as 090, plus 135/180/225/270/315

Convert to PNG, magenta-patch watermarks, then add the two shop objects to `ORBIT_SUBJECTS`. Do not edit sample source in this pass.
