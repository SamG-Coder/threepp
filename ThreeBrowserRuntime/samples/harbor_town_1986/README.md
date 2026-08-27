# Minamihama 1986

A Shenmue-chapter-1-style harbor town reconstructed with the same
**2D-orbit → 3D visual hull** pipeline as `texture_2ds_to_3ds`.

Time is locked: **Saturday 29 November 1986, 15:20**, overcast winter
afternoon. Original place names (Sakae-dori, Yokobori, Suzume-zaka,
Amihama) — not a clone of Dobuita shop brands.

## Vertical slice (this drop)

Reconstructed unique meshes:

- Nishiya soba, Yaoya greengrocer, Kamimura tobacco, Minato-machi pharmacy, Starlight Arcade, Minato-machi records (Sakae north row)
- Midori florist and Haru barber (Sakae south row)
- Galaxy sakaba (Yokobori)
- Suzume-zaka timber house
- Warehouse 8 and Warehouse 3 (Amihama)
- Enamel vending, green phone booth, concrete pole, civilians, Suzuki Carry, Honda Cub
- Grok-authored orbit sets for bicycles, benches, dock equipment, boats, trees, and harbor life

Instances of vending machines and poles line Sakae-dori. Grok-authored
seamless tiles cover the street, sidewalks, park, dock, markings, and water.

Fly: **W/S** forward/back through the current view pitch, **A** screen-left,
**D** screen-right, **Space** world-up, **Ctrl** world-down,
**Shift** to boost, and drag to look. Spawn is on Suzume-zaka looking toward
the shopping street; head south for the harbor.

There are no teleport keys, command-file controls, or automated scout paths.
Verification is performed by flying the native game with its real controls.

## Reconstruction rules

Every raised or recognizable object starts as Grok-generated 2D
magenta-studio stills and is reconstructed through the orbit visual-hull
pipeline; there are no impostors, imported models, or procedural substitute
3D assets. Buildings, vehicles, stairs, and the quay are composed from reusable
Grok-orbit components reconstructed into meshes. Scale is real metres. Ground,
water, and road markings are flat UV
surfaces using Grok-generated tile images; navigation/collision data is invisible.

```powershell
node C:\ThreeBrowser\ThreeBrowserRuntime\build\bin\runtime\launch.mjs C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\site-entry.mjs
```
