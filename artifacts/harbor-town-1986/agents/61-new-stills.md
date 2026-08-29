# New stills — boat, bench, bicycle, sedan, mika

Copied session JPEGs into `ThreeBrowserRuntime/samples/harbor_town_1986/assets/` as PNGs via ffmpeg (`jpg` → `png`, 1024×1024 rgb24). Not added to `catalog.mjs` / `main.mjs`.

Session prefix: `C:\Users\samue\.grok\sessions\C%3A%5CThreeBrowser\01a0420b-3c70-77d1-8a9b-ad22fcbf5617\images\`

## Mapping

| dest | source | why |
|---|---|---|
| `fishing-boat/yaw-000.png` | `157.jpg` | front / bow |
| `fishing-boat/yaw-090.png` | `162.jpg` | true side (port, cabin + stern to image-right) |
| `fishing-boat/yaw-180.png` | `161.jpg` | stern / transom + ladder |
| `park-bench/yaw-000.png` | `164.jpg` | front bench (dead-on slats); `156.jpg` is a 3/4, unused |
| `city-bicycle/yaw-000.png` | `159.jpg` | as mapped (3/4, not a true cardinal) |
| `city-bicycle/yaw-090.png` | `167.jpg` | true side |
| `kei-sedan/yaw-000.png` | `166.jpg` | front (dead-on grille); `158.jpg` is a 3/4, unused |
| `civilian-mika/yaw-000.png` | `160.jpg` | front |
| `civilian-mika/yaw-045.png` | `165.jpg` | ~45° |
| `civilian-mika/yaw-090.png` | `163.jpg` | true side |

Unused: `156.jpg` (bench 3/4), `158.jpg` (sedan 3/4).

## What exists in each new folder

### `fishing-boat/`

- `yaw-000.png` (966555 bytes)
- `yaw-090.png` (764718 bytes)
- `yaw-180.png` (919807 bytes)

**Missing:** `yaw-270` (starboard, opposite of `162`).

### `park-bench/`

- `yaw-000.png` (982768 bytes)

**Missing:** `yaw-090`, `yaw-180`, `yaw-270`.

### `city-bicycle/`

- `yaw-000.png` (995549 bytes) — 3/4, **not** a true 000 cardinal
- `yaw-090.png` (963056 bytes) — true side

**Missing true cardinals:** `yaw-000` (dead-on front wheel / bars), `yaw-180` (rear / crate from behind), `yaw-270` (opposite flank of `167`).

### `kei-sedan/`

- `yaw-000.png` (637499 bytes)

**Missing:** `yaw-090`, `yaw-180`, `yaw-270`.

### `civilian-mika/`

- `yaw-000.png` (985268 bytes)
- `yaw-045.png` (855322 bytes)
- `yaw-090.png` (892880 bytes)

**Missing:** `yaw-135`, `yaw-180`, `yaw-225`, `yaw-270`, `yaw-315`.

## Catalog

Do not add these folders to the catalog until the missing yaws exist (and bicycle 000 is a true cardinal).
