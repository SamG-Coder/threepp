# 04 — Sakae north-row stills and catalog placement

Stills + envelopes only. Do not edit sample source from this note.

North row is `z = -8.5`, `yaw = 0` (fronts face +Z / south, toward the street).
Envelope along the street is `x ± realWidth/2`. `realWorldScale` never reads
`realDepth`: both X and Z are scaled so `max(meshXZ) = realWidth`
(`texture_2ds_to_3ds/src/real-scale.mjs`). Gap metres below are **catalog
envelopes**, not the chewed hulls in `sakae-north.png`.

The five shops in the brief were the previous drop (`tobacco -25`, `soba -14`,
`greengrocer -4`, `arcade 8`, `cassette 20`). Current `catalog.mjs` has already
slid those and planted **pharmacy** on the same row. Barber is south-row
(`z = 8.6`, `yaw = π`) and is out of this table.

Pipeline: magenta key + 24 % × 7.5 % watermark punch (`chroma-key.mjs`).
Orthographic visual hull (`views.mjs` `worldToPixel`). A ¾ still labelled as a
cardinal is the usual wrecker (see `03-flower-shop.md`, `13-hull-params.md`,
`29-color-bake.md`).

---

## Verdict

| Shop | yaw-000 | yaw-090 | Hull | Brand | Catalog `realWidth` vs still |
|---|---|---|---|---|---|
| `tobacco-shop` | orthogonal front | orthogonal gable | keep stills; floor is keyed magenta | `三菱` on the AC; manga in the window | front ~0.5–1 m narrower than 6.4; gable much shallower than `realDepth` 7.2 |
| `soba-shop` | orthogonal front | **¾ wreck** | **regenerate yaw-090** | catalog “Nishiya soba”; fascia is 横浜港町ラーメン | front close to 6.4; 090 cannot be used as depth |
| `greengrocer` | orthogonal front | orthogonal gable | keep; produce table is attached | original 八百果; date lock 昭和61年11月29日 | front ~5.4 vs 6.2; gable ~5.3 vs `realDepth` 7.4 |
| `pharmacy` | orthogonal front | orthogonal gable | keep | original 港町薬局 / HARU 1986 | similar overstated depth |
| `you-arcade` | **¾ wreck** | orthogonal side | **regenerate yaw-000** | SPACE INVADER '86 (Taito); folder `you-arcade` (Shenmue YOU); catalog “Starlight Arcade” | 000 span is front+side, not 8.0 m elevation; gable/side ~6.5 vs `realDepth` 10 |
| `cassette-shop` | orthogonal front | orthogonal gable | keep; bins + 7-Eleven bag bump the hull | 7-Eleven bag | bins inflate frontage; gable ~4.5–5 vs `realDepth` 8.0 |

**Must reshoot (will wreck the hull): `you-arcade/yaw-000.png`, `soba-shop/yaw-090.png`.**

Everything else on this row is a true elevation with a magenta cyclorama floor
and a bottom-right watermark. Floor is `#E040A0`-class and should key.
Contact-shadow pixels (arcade 000, cassette leaves) will not.

---

## Gap table — catalog envelopes (`x ± realWidth/2`)

Current `ORBIT_SUBJECTS`, west → east, all `z = -8.5`, `yaw = 0`.
Sidewalk band is `GROUND.sidewalkN` `minX = -40`, `maxX = 40`.

| id | label | x | realWidth | left | right | gap to next (m) | vs 1.5–2.5 |
|---|---|---:|---:|---:|---:|---:|---|
| *(sidewalk west)* | | | | −40.0 | | **10.8** to tobacco | empty lot — needs a shop |
| `tobacco-shop` | Kamimura tobacco | −26 | 6.4 | **−29.2** | **−22.8** | **2.6** | 0.1 over |
| `soba-shop` | Nishiya soba | −17 | 6.4 | **−20.2** | **−13.8** | **1.7** | in range |
| `greengrocer` | Yaoya | −9 | 6.2 | **−12.1** | **−5.9** | **2.6** | 0.1 over |
| `pharmacy` | Minato-machi pharmacy | 0 | 6.6 | **−3.3** | **3.3** | **2.7** | 0.2 over |
| `you-arcade` | Starlight Arcade | 10 | 8.0 | **6.0** | **14.0** | **3.6** | too wide |
| `cassette-shop` | Minato-machi records | 21 | 6.8 | **17.6** | **24.4** | **15.6** to +40 | empty lots — needs shops |
| *(sidewalk east)* | | | | | 40.0 | | |

Previous five-shop drop (brief): tobacco −25 (−28.2…−21.8), soba −14 (−17.2…−10.8),
yaoya −4 (−7.1…−0.9), arcade 8 (4.0…12.0), cassette 20 (16.6…23.4) → internal
gaps **4.6 / 3.7 / 4.9 / 4.6**. Pharmacy ate the old 4.9 m yaoya–arcade hole.
The remaining street-scale holes are the **wings** and the **arcade–records 3.6 m**.

Shop widths sum to 40.4 m (six buildings). Span −29.2 … 24.4 = 53.6 m.
Internal air = 13.2 m. Target 2.0 m × 5 party walls = 10.0 m, so **3.2 m still
to close** by sliding, not by inserting another 6 m shop into the 3.6 m slot.

`sakae-north.png` is the old 4.9 m yaoya–arcade hole (camera `x=0, z=1.5,
yaw=π`). That lot is now pharmacy. The current wide shot is arcade east face
`x=14.0` to cassette west `x=17.6`.

---

## Empty metres that need another shop

Internal gaps of 2.6–2.7 m are a one-person alley, not a building lot. Do not
force a 6.2–8.0 m shop into them — slide instead (next section).

| Span | metres | Fit | Recommendation |
|---|---:|---|---|
| −40.0 → tobacco −29.2 | **10.8** | one 6.4 m shop + 2.0 m walls, or 6.4 + a 3 m kiosk | **new north-row shop** (snack / denki / liquor). Keep 2 m off the sidewalk end. |
| tobacco → soba | 2.6 | too tight for 6 m | close to 2.0 (or 1.7 like soba–yaoya) |
| soba → yaoya | 1.7 | kiosk / cub only | keep; already in range |
| yaoya → pharmacy | 2.6 | too tight for 6 m | close to 2.0 |
| pharmacy → arcade | 2.7 | too tight for 6 m | close to 2.0 |
| arcade → cassette | **3.6** | 3.2 m snack stall *or* close | **close.** A 3.4 m building with 0.1 m air will z-fight the arcade’s ¾ hull. |
| cassette 24.4 → +40 | **15.6** | two ~6.4 m shops + 2.0 m walls | **two new north-row shops** |

West keep-out: stone stairs at `x = -20 ± 3.25`, `z = -12.4 … -24` sit *behind*
the row, not in the frontage. Tobacco at `x = -26` can stay.

Furniture that rides the current fronts (move if x changes):

- `vending-enamel` unique at `x = -6.8, z = -5.9` (yaoya spill)
- `vending-enamel` instance at `x = 18.5, z = -5.4` (cassette spill)
- `telephone-pole` instance at `x = -22, z = -6.2` (tobacco east party line)
- `civilian-hiro` at `x = -9.2, z = -6.6` (yaoya)

---

## Stills that will wreck the hull

Visual hull keeps a voxel only if it sits inside **every** keyed silhouette.
`worldToPixel` is orthographic. A ¾ photo filed as yaw 0 or 90 is the wrong
shape on the wrong ray. Cake-slice bake then paints that photo onto a 90°
wedge (`29-color-bake.md`).

### 1. `you-arcade/yaw-000.png` — **wreck** (must reshoot)

¾ of front *and* right wall. Corner, rooftop 3D, クラブゲ blade, glass
trapezoid. Pipeline treats it as a +Z elevation.

Effects already in `sakae-north.png` / `arcade.png`:

- West party wall shows the ファミリーゲームセンター fascia smeared onto
  mosaic tile (cake-slice of a ¾ still).
- Hull is a rounded potato, not a box (`13-hull-params.md`: 65 124 tris,
  classified `custom` not rectangle).
- Dark contact shadow on the cyclorama is not magenta — extra foot silhouette.

`yaw-090.png` is a usable orthogonal side (2×2 blinds, downpipe, AC, satellite).
`yaw-180.png` is a usable back (fire escape). `yaw-270.png` is **the same wall
as 090** (クラブゲ on image-left, same window grid). The true left elevation
was never shot. After 000 is remade as a true front, 270 still needs a unique
left.

Reshoot 000: orthographic south elevation, camera on +Z looking −Z, fascia
parallel to the picture plane, no right-wall return, no floor, no shadow, no
Grok mark. Drop SPACE INVADER / YOU. Keep the mint mosaic and 本日休業 glass
as original “Starlight Arcade”.

### 2. `soba-shop/yaw-090.png` — **wreck** (must reshoot)

¾ of front *and* right wall: 横浜港町ラーメン fascia, noren, striped flag,
*and* the lattice side windows. Filed as yaw 90, so the “side” silhouette is
the diagonal of the building. Intersection with a true front (000) and a true
back (180) chamfers the box into a diamond; photoconsistency then eats the
disagreement. Same failure mode as flower-shop 000 (`03-flower-shop.md`).

`yaw-000.png` is a true front. `yaw-180.png` is a true back. `yaw-270.png` is
closer to a left elevation but sits on a **concrete pad** that is not magenta
(pad also on 180). 000 does not include that pad, so intersection should trim
it — unless a dark plinth strip survives in every view and `keepGroundConnected`
grows a skirt.

Reshoot 090: orthographic east gable of the *same* two-storey irimoya as 000,
ridge centred, front = image-left, no fascia, no floor, no Grok mark. Plant
any pad as the building plinth, overlapping the walls, not a floating slab.

### 3. Leftover ground / watermark — damage, not a wreck on the orthogonal stills

| Still | Floor | Watermark | Extra silhouette |
|---|---|---|---|
| tobacco 000 / 090 | magenta cyclorama (should key) | magenta rectangle (keys) | antenna on 000 inflates bbox height |
| soba 000 | thin plinth + cyclorama | **Grok logo** (punch should catch it) | flag + antenna |
| soba 090 | sidewalk strip + cyclorama | Grok logo | **¾** (wreck, above) |
| greengrocer 000 / 090 | cyclorama | magenta rectangle | produce table (000, mostly in the façade span); eaves on 090 |
| pharmacy 000 / 090 | cyclorama | magenta rectangle | roof bucket + antenna; meter boxes on 090 image-left |
| arcade 000 | cyclorama + **dark contact shadow** | Grok logo | **¾** (wreck, above) |
| arcade 090 | cyclorama | Grok logo | blade sign |
| cassette 000 / 090 | cyclorama | magenta rectangle | record bins, chalkboard, **7-Eleven bag**, leaves |

`TOWN.md`: isolated, no floor, no cast shadow. Orthogonal shops survive because
the floor is still hot magenta. The wreckers are the ¾ cameras, not the
cyclorama. Do not “clean” the produce table or record bins off the fronts —
they are attached street furniture and should stay in the silhouette. Do
remove the 7-Eleven bag and the Grok mark.

### 4. Width vs `realWidth` (all six)

Each view maps its own alpha-bbox height to unit Y (`worldPerPixel = 1 /
bounds.height`). Antennas, flags, buckets, and dishes stretch that bbox and
shrink implied metres of width (`aspect × realHeight`).

Catalog `realDepth` is systematically larger than the gable stills (tobacco
7.2, soba 8.2, yaoya 7.4, pharmacy 7.6, arcade 10, cassette 8.0). The gables
read ~4.5–6.5 m if height is locked. Because scale uses `realWidth` for **both**
XZ axes and `extents.width = max(widthX, depthZ)`:

- If the hull is deeper than wide, planted frontage **shrinks** below
  `realWidth` and the party-wall gaps in world grow past this table.
- If a ¾ still bloats the hull toward a cube, both axes squash to `realWidth`
  (arcade catalogued 8 × 10 becomes ~8 × 8, and the ¾ smear stays).

Arcade at `z = -8.5`, `realDepth = 10` already puts the south face at
**z = −3.5** (2.5 m into `GROUND.asphalt`). Yaoya south face **z = −4.8**.
North sidewalk ends at `z = −6`. Until `realDepth` matches the gable stills
(~6–7 m) or `z` moves north, fronts sit in the lane. That is placement, not a
still-angle wreck, but it is why `sakae-north.png` shows arcade *side* in the
road.

---

## Per-shop still notes (yaw-000 / yaw-090)

### tobacco-shop — Kamimura — keep

- **000:** true front. Yellow tile, たばこ TOBACCO / KAMIMURA SINCE 1963, balcony
  laundry, 上村 plaque. Orthogonal. Usable.
- **090:** true east gable, balcony wrap image-left (front), small rear eave
  image-right. Orthogonal. Usable.
- Brand: `三菱` on the outdoor unit; window is a wall of 1986 manga covers.
- Watermark is already a magenta patch. Floor should key.

### soba-shop — Nishiya — reshoot 090

- **000:** true front. Irimoya, 中華そば ラーメン noren, number 11. Orthogonal.
  Identity is ramen, not the catalog label “Nishiya soba”. Original place-name
  is fine; the English label is wrong.
- **090:** ¾. Wreck, above.
- Grok logo on both. Concrete pad on 180/270.

### greengrocer — Yaoya — keep

- **000:** true front. 八百果 noren, 青果 lantern, crate table, 本日のおすすめ
  with 昭和61年11月29日. Best north-row elevation. Produce table is attached —
  keep it on a reshoot.
- **090:** true gable, pale vertical boards, antenna. Orthogonal. Usable.
- This is why Yaoya in `sakae-north.png` is readable next to the arcade smear.

### pharmacy — addendum (now on this row)

- **000 / 090:** both true elevations. Mint tile, 港町薬局 / HARU PHARMACY 1986,
  薬 noren, bucket on the ridge. Same cyclorama + magenta watermark as tobacco.
  Not a wrecker. Do not use it to plug a 3.6 m hole; it is already 6.6 m wide
  at `x = 0`.

### you-arcade — Starlight Arcade — reshoot 000 (and 270)

- **000:** ¾ wreck, above. SPACE INVADER '86.
- **090:** orthogonal side. Keep as the side reference for the reshoot.
- Folder name `you-arcade` is a Dobuita clone tell against `TOWN.md` / README
  (“not a clone of named shops”).

### cassette-shop — Minato-machi records — keep (strip the bag)

- **000:** true front. 港町レコード / CASSETTE & DISC 昭和61年11月, bins, idol
  poster, chalkboard 松田聖子 (period, not a shop brand). Orthogonal.
- **090:** true gable. Bins and blue awning on image-left (front). Orthogonal.
- 7-Eleven bag on the front-right plinth is a real brand and a white blob the
  key will keep. Inpaint it. Leaves at the plinth are small.

---

## Recommended x — tighten to ~2.0 m party walls

Keep order and `z = -8.5`, `yaw = 0`. Anchor tobacco at **x = -26** (west of
the stairs). Nominal gap **2.0 m** (middle of 1.5–2.5). New `x` is
`previous_right + gap + realWidth/2`.

| id | current x | **new x** | left | right | gap after (m) | Δx |
|---|---:|---:|---:|---:|---:|---:|
| `tobacco-shop` | −26 | **−26.0** | −29.2 | −22.8 | 2.0 | 0 |
| `soba-shop` | −17 | **−17.6** | −20.8 | −14.4 | 2.0 | −0.6 |
| `greengrocer` | −9 | **−9.3** | −12.4 | −6.2 | 2.0 | −0.3 |
| `pharmacy` | 0 | **−0.9** | −4.2 | 2.4 | 2.0 | −0.9 |
| `you-arcade` | 10 | **8.4** | 4.4 | 12.4 | 2.0 | −1.6 |
| `cassette-shop` | 21 | **17.8** | 14.4 | 21.2 | — | −3.2 |

Packed span −29.2 … 21.2 = 50.4 m (was 53.6). The 3.6 m arcade–records hole
becomes 2.0 m. Soba–yaoya stays a 2.0 m alley instead of tightening further
(already 1.7).

Move the yaoya vending / Hiro with the greengrocer (~0.3 m). Move the cassette
vending instance to `x ≈ 15.3`. Pole at `x = -22` can stay (still in the
tobacco–soba 2.0 m slot, 0.8 m east of tobacco’s east face).

### Alternate — abutting (slight overlap −0.2 m)

If the brief’s “slight overlaps as abutting shops” is the look (shared wall,
no alley). Gap −0.2 m:

| id | x | left | right |
|---|---:|---:|---:|
| `tobacco-shop` | −26.0 | −29.2 | −22.8 |
| `soba-shop` | −19.8 | −23.0 | −16.6 |
| `greengrocer` | −13.7 | −16.8 | −10.6 |
| `pharmacy` | −7.5 | −10.8 | −4.2 |
| `you-arcade` | −0.4 | −4.4 | 3.6 |
| `cassette-shop` | 6.8 | 3.4 | 10.2 |

Overlap hides the hull crack between boxes. Do **not** abut until arcade 000
and soba 090 are true elevations — a ¾ potato overlapping a neighbour is a
worse smear than a 2 m alley.

### Fill the wings after the slide (2.0 m pack)

Do not edit catalog from this note; this is the lot list.

| new shop | x | realWidth | left | right | notes |
|---|---:|---:|---:|---:|---|
| west infill | **−34.4** | 6.4 | −37.6 | −31.2 | 2.0 m to tobacco; 2.4 m leftover to −40 |
| east infill A | **26.4** | 6.4 | 23.2 | 29.6 | 2.0 m after cassette 21.2 |
| east infill B | **34.8** | 6.4 | 31.6 | 38.0 | 2.0 m after A; 2.0 m leftover to +40 |

Three new 2-storey fronts. That is a shotengai. Sliding the existing six
without the wings just makes a 50 m clump on an 80 m sidewalk.

1.5 m pack (low end of the brief) if 2.0 still reads as an alley: subtract
0.5 m from each of the five gaps, which pulls cassette to **x = 15.3**
(right 18.7) and frees another 2.5 m on the east for the infill.

---

## What not to do

- Do not cram a 6 m shop into the 3.6 m arcade–cassette slot. Slide cassette
  west (and arcade a little west) instead.
- Do not treat catalog `realWidth` as the planted mesh width until
  `realWorldScale` uses `realWidth` on X and `realDepth` on Z, and the stills
  are elevations whose bbox aspect matches those metres.
- Do not keep arcade 000 or soba 090. They will wreck any x you pick.
- Do not edit `catalog.mjs` / stills from this note.
