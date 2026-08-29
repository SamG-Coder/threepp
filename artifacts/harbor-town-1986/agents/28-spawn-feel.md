# 28 — Spawn feel (hill to Sakae)

Do not edit sample source from this note. Parent applies SPAWN / `clampWalk` / walk-loop glue.

Convention: `+X` east, `+Z` south (`map.mjs` header, `TOWN.md`). Camera look is `(sin(yaw), cos(yaw))` on XZ, so **yaw `0` faces south** and **yaw `Math.PI` faces north**. `EYE = 1.62` (`scout.mjs`). Walk loop never uses `SPAWN.y`.

## Controls (as shipped)

WASD in `main.mjs` animation loop. `W` walks along the look vector. Shift is `9` m/s, otherwise `3.6` m/s. Drag look: `yaw -= dx * 0.005`, `pitch += dy * 0.004`, pitch clamped `[-0.5, 0.9]`. Pitch starts at `0` even if a landmark has one.

```184:204:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
  const walk = {
    x: SPAWN.x,
    y: groundHeight(SPAWN.x, SPAWN.z) + EYE,
    z: SPAWN.z,
    yaw: SPAWN.yaw,
    pitch: 0,
    ...
  };

  function placeCamera() {
    const cp = Math.cos(walk.pitch);
    camera.position.set(walk.x, walk.y, walk.z);
    camera.lookAt(
      walk.x + Math.sin(walk.yaw) * cp,
      walk.y + Math.sin(walk.pitch),
      walk.z + Math.cos(walk.yaw) * cp,
    );
  }
```

```263:280:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
    if (walk.keys.has("w")) dz += 1;
    ...
      const speed = (walk.keys.has("shift") ? 9 : 3.6) * dt;
      const sin = Math.sin(walk.yaw);
      const cos = Math.cos(walk.yaw);
      walk.x += ((dx / len) * cos + (dz / len) * sin) * speed;
      walk.z += ((-dx / len) * sin + (dz / len) * cos) * speed;
      walk.y = groundHeight(walk.x, walk.z) + EYE;
```

No bounds, no building colliders, no gravity. `Y` is glued to `groundHeight + EYE` every move.

## Is spawn facing the town or the void?

**Town.** Not the void.

```36:41:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\map.mjs
export const SPAWN = Object.freeze({
  x: -22,
  y: 1.6,
  z: -28,
  yaw: 0.4,
});
```

- Position is on Suzume-zaka `hillPath` (`x ∈ [-24, -16]`, `z ∈ [-36, -12]`), 2 m west of the stone stair centreline (`x = -20`) and ~4 m north of the top step (`z ≈ -23.95`).
- `yaw = 0.4` rad = **22.9° east of south**. The guess is correct.
- Forward `(sin 0.4, cos 0.4) ≈ (0.389, 0.921)`. Bearing from spawn to Nishiya soba `(-14, -8.5)` is `atan2(8, 19.5) = 0.389` rad — look ray is dead on the north-row soba, not empty sky.
- Hill house `(-28, -34)` is behind-left. Harbor warehouses (~100 m south) sit in fog (`40–140`).
- `vFOV 55°`, typical 16:9 `hFOV ~85°`. Tobacco `(-25, -8.5)` through arcade `(8, -8.5)` are in the first frame. Stairs sit left-of-centre, under the look ray.

`README.md` already says spawn looks toward the shopping street. That is true. What is *not* true is that the first seconds read as “stairs down to Sakae.”

`SPAWN.y = 1.6` is unused. Actual camera Y is `groundHeight(-22, -28) + 1.62`. With the current ramp `t * 8` and path dip `−0.4 t` on `x ∈ [-24, -16]`:

`t = (28 − 12) / 34 ≈ 0.471` → ground `≈ 3.58` m → eye **`≈ 5.20` m**.

Pitch `0` from that height looks level at shop upper floors / sky. Street and steps sit ~13° down (`atan(5.2 / 23)`), inside the frustum but not the subject.

Scout `LANDMARKS.spawn` is a different pose: `{ x: -22, z: -28, yaw: 0.55, pitch: -0.12 }`. `minamihamaGo('spawn')` does **not** restore map `SPAWN` (more east, and it actually looks down).

## Suggested SPAWN (Shenmue hill-to-street)

Want: hold `W` for three seconds and the stone stairs are the path, Sakae north row fills the far plane, house stays behind you.

Walk 3.6 m/s × 3 s = **10.8 m** along look.

**Preferred (small move, same hill node):** keep the hill coordinates, aim down the flight, pitch down.

```js
export const SPAWN = Object.freeze({
  x: -22,
  y: 1.6,
  z: -28,
  yaw: 0.18,
  pitch: -0.2,
});
```

- `yaw 0.18` ≈ 10° east of south: stairs (`x = -20`) left-centre, tobacco | soba | yaoya reading L→R.
- `pitch -0.2` ≈ −11.5°, matches `LANDMARKS.stairs` and puts the treads + shop fronts in the middle of the 55° frame.
- 3 s of `W`: `Δ ≈ (1.93, 10.63)` → **`(-20.1, -17.4)`**, on the stair boxes (width 6.5 m about `x = -20`, treads `z ≈ -24 … -12`), looking at Sakae. That is the hill-to-street beat.
- Init `walk.pitch` from `SPAWN.pitch ?? 0` or the pitch is ignored again.

**Stronger first frame** (stairs already under the nose, still on `hillPath`):

```js
export const SPAWN = Object.freeze({
  x: -20.2,
  z: -26.5,
  yaw: 0.12,
  pitch: -0.2,
});
```

3 s of `W` → `≈ (-18.9, -15.3)`, lower third of the flight. Same shot as `LANDMARKS.stairs` `{ x: -18, z: -14, yaw: 0.15, pitch: -0.2 }`, just 12 m further up.

Sync `LANDMARKS.spawn` to whichever pair ships. Do not keep `yaw: 0.55` — that aims at the arcade and skips the stairs.

Do **not** spawn on asphalt (`z ∈ [-8, 12]`). That kills the Sakuragaoka beat. Do **not** face north (`yaw ≈ π`) or you stare at the house / park / north void.

## Collision: there is none — fall off the quay?

There is **no** collision. The quay wall (`BoxGeometry(98, 1.5, 0.85)` at `(4, 0.35, 87.7)`) and the `roads.mjs` bollards (`z = 86`, not even added from `main.mjs` today) are scenery.

You will **not fall**. `walk.y` is always `groundHeight + EYE`. Past the seawall:

```12:13:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\map.mjs
  } else if (z > 88) {
    y = -0.45;
```

Water patch is `y = -0.4`, `z ∈ [88, 120]`. Eye drops ~0.5 m and you **walk on the water** out to infinity. Same for ±X: height stays ~0 and the 96 × 72 height field (`x ∈ [-48, 48]`, `z ∈ [-36, 36]` in `createStudio` today) ends, so you cruise through fog.

Other holes the clamp must care about:

| region | what happens |
|---|---|
| `z > 88` | walk on water (`y = -0.45`) |
| `36 < z < 52` | height field ends at `z = 36`; dock patch starts `z = 52`. Eye stays ~1.62 over **empty void** (nav `harbor-gate` is `(0, 48)` in that gap) |
| `z < -36` | 8 m of `S` from spawn (`z = -28`) leaves the height field. Park patch is a flat `y = 0.02` card under the hill; camera stays at hilltop ~8 m in the sky |
| buildings | walk-through |

`map.mjs` comments that the height field should be `PlaneGeometry(110, 160)` covering `z = -50 … 110`. `main.mjs` still builds `96 × 72` at the origin. Clamp should not assume that mesh was enlarged.

## Do not clamp to asphalt only

Asphalt is `x ∈ [-48, 48]`, `z ∈ [-8, 12]`. Spawn `z = -28` is **off asphalt**. So is the dock, Yokobori, and the stairs. `z < 88` is the right *water* cap; asphalt-only would freeze the player on a pose they cannot occupy and delete the hill intro.

Cap **inside the seawall** (`z ≤ 87.2`, wall centre `87.7`, thickness 0.85) and keep the union of land pads.

## Recommended `clampWalk(x, z)`

Drop in `map.mjs`. Project to the nearest land AABB. Water is not a pad. Include a 16 m harbor strip so `WALK_WAYPOINTS` `harbor-gate` / `quay` stay legal even while the `z = 36 … 52` mesh gap exists.

```js
const LAND_PADS = Object.freeze([
  { minX: -44, maxX: -12, minZ: -46, maxZ: -12 }, // park / suzume
  { minX: -24, maxX: -16, minZ: -36, maxZ: -8 },  // hillPath onto sidewalk
  { minX: -46, maxX: 46, minZ: -12, maxZ: 12 },   // sakae asphalt + walks
  { minX: 18, maxX: 42, minZ: 12, maxZ: 28 },     // yokobori
  { minX: -8, maxX: 8, minZ: 10, maxZ: 52 },      // harbor approach (mesh still missing)
  { minX: -40, maxX: 46, minZ: 52, maxZ: 87.2 },  // dock, inside seawall
]);

export function clampWalk(x, z) {
  let bestX = x;
  let bestZ = z;
  let bestD = Infinity;
  for (const p of LAND_PADS) {
    const cx = Math.min(p.maxX, Math.max(p.minX, x));
    const cz = Math.min(p.maxZ, Math.max(p.minZ, z));
    const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
    if (d < bestD) {
      bestD = d;
      bestX = cx;
      bestZ = cz;
      if (d === 0) break;
    }
  }
  return { x: bestX, z: bestZ };
}
```

Walk loop, after integrating WASD, before `groundHeight`:

```js
const held = clampWalk(walk.x, walk.z);
walk.x = held.x;
walk.z = held.z;
walk.y = groundHeight(walk.x, walk.z) + EYE;
```

Scout `setLocation` / `go` should run the same clamp so landmarks cannot teleport onto water.

This does **not** collide shops, stairs, or the seawall mesh. It only keeps the player on land. Building colliders are a later pass.

## Parent checklist

1. `SPAWN.yaw = 0.18`, `SPAWN.pitch = -0.2` (keep `x, z = -22, -28`) — or the stronger `(-20.2, -26.5)` pair.
2. `walk.pitch = SPAWN.pitch ?? 0`.
3. `LANDMARKS.spawn` copied from `SPAWN` (today `yaw 0.55` / `pitch -0.12` disagrees).
4. `clampWalk` as above; **not** asphalt-only; **yes** `z ≤ 87.2`.
5. Leave sample source untouched until parent applies this.
