# Minamihama — 1986 harbor town

An original 1986 Kanagawa harbor town in the spirit of Shenmue Chapter 1
(Dobuita / Sakuragaoka / New Yokosuka Harbor), not a clone of named shops
or characters.

## Time lock (every asset)

- Date: Saturday 29 November 1986
- Clock: 15:20
- Light: overcast winter afternoon, cool steel-blue sky, low sun west
- Shop interiors already warm tungsten; street still daylight
- No rain, wet asphalt from earlier drizzle, no snow
- Photoreal product/architecture stills, same as the oak/bin pipeline

## Districts (metres, +X east, +Z south)

| id | name | origin (x,z) | size | feel |
|---|---|---|---|---|
| sakae | Sakae-dori | 0, 0 | 80 × 18 | Main shopping street, 2-storey mixed shops |
| yokobori | Yokobori alley | 24, 22 | 28 × 12 | Narrow bar alley, neon dormant in daylight |
| suzume | Suzume-zaka | -28, -36 | 40 × 36 | Hill houses, park, stone stairs |
| amihama | Amihama docks | 0, 64 | 90 × 50 | Warehouses, quay, water |
| route16 | Route 16 strip | -48, 8 | 24 × 80 | Bus, parking, telephone poles |

Sakae-dori runs east–west. Harbor is south. Residential hill is north-west.

## Reconstruction rules (from texture_2ds_to_3ds)

- Magenta studio (#E040A0-class), isolated, no floor, no cast shadow
- Custom / organic: 8 yaws at 45°
- Square / rectangle buildings: 4 cardinals
- Cylinder / capsule: 2 orthogonal stills (0° and 90°), snap hull to round
- Cylinder UV: two islands, front still / back still
- Scale from real-world metres
- Canvas-only WebGPU sample, no HUD

## Primitive cheat-sheet

- Shop buildings, houses, warehouses, phone booth, vending: **rectangle / square**
- Telephone pole, drum, bollard, bin: **cylinder**
- Parked 80s cars, scooters, trees, irregular signs: **custom**
