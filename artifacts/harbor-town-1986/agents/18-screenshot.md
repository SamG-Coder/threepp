# 18 — Scout screenshot path

Path: `ThreeBrowserRuntime/samples/harbor_town_1986/src/scout.mjs`.
On-disk shots: `C:\ThreeBrowser\artifacts\harbor-town-1986\`.

## Why `sakae.png` was black

`renderer.domElement.toDataURL("image/png")` is the on-screen WebGPU canvas. In ThreeBrowserRuntime that method encodes the unused **Canvas2D** surface (`browser-host.mjs` `HTMLCanvasElement.toDataURL` → `canvas2dEncodePng(this._surface())`), not the swapchain. Result: a valid PNG of empty black pixels.

Working path (what produced `arcade.png` and `sakae-north.png`):

1. Offscreen `THREE.RenderTarget` (RGBA8, sRGB, depth).
2. `renderer.setRenderTarget(target); renderer.render(scene, camera)`.
3. `await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)`.
4. Pack rows → `putImageData` on a **2D** canvas → `toBuffer("image/png")` / `encodePng`.

Do not screenshot the GPU canvas. Always read a RenderTarget.

## Y-flip: not needed

WebGPU texture origin is **top-left** (`copyTextureToBuffer` origin `{x,y}` is top-left). Canvas2D `putImageData` and PNG are also top-left. WebGL `readPixels` is bottom-left — that is the usual flip source, and it does not apply here.

`gta_neon_city/src/core/capture.mjs` already notes: *ThreeBrowserRuntime's WebGPU readback is already top-down.*

Visual check of `sakae-north.png`: sky in the upper half, asphalt at the **bottom**, shop signs and produce crates right-side up, phone-booth-adjacent building not inverted. `arcade.png` same (horizon above ground, green booth standing). If we Y-flipped, ground would sit at the top.

**Do not flip.** `rgbaImageData` copies row 0 → canvas row 0.

## `command.json` polling

`attachScout` starts `setInterval(tick, 400)`. Each tick:

- Reads `C:\ThreeBrowser\artifacts\harbor-town-1986\command.json` as UTF-8.
- Strips a leading U+FEFF, then `JSON.parse`.
- Requires a non-empty `id`. If `id === lastCommandId`, skip (idempotent until you change `id`).
- `inflight` lock: a slow GPU readback / `shots` queue will not overlap the next 400 ms tick. The next distinct `id` is picked up on the first free tick after the queue finishes.
- Missing file / other I/O errors stay silent. `SyntaxError` logs `[Minamihama] command.json is not JSON (UTF-8 BOM?).`.

`go` is synchronous (`placeCamera()` then return). The following `screenshot` renders immediately into the RenderTarget — no extra animation-loop frame is required.

Order inside a shot: `go` → `setLocation` → `screenshot`. `setLocation` overrides pose fields after `go` if both are present.

## Multi-shot queue (implemented)

Backward compatible. A single command is still:

```json
{ "id": "t4", "go": "sakae", "screenshot": "sakae-north" }
```

`{ "id", "setLocation": { "x", "y?", "z", "yaw", "pitch" }, "screenshot" }` still works.

To queue several captures in one poll, set a new `id` and a `shots` array. When `shots` is a non-empty array it **replaces** the top-level `go` / `setLocation` / `screenshot` (those keys on the root object are ignored).

```json
{
  "id": "tour-1",
  "shots": [
    { "go": "sakae", "screenshot": "sakae-north" },
    { "go": "arcade", "screenshot": "arcade" },
    { "go": "harbor", "screenshot": "harbor" },
    { "setLocation": { "x": 0, "z": 1.5, "yaw": 0, "pitch": 0.06 }, "screenshot": "sakae-south" }
  ]
}
```

Each element is `{ go?, setLocation?, screenshot? }`. Landmark names: `spawn`, `hill`, `house`, `stairs`, `sakae`, `tobacco`, `soba`, `produce`, `arcade`, `records`, `van`, `flower`, `booth`, `bar`, `harbor`, `warehouse`, `quay`. Filenames are sanitized with `[^\w.-]+` → `-`.

Must bump `id` every drop or the poller no-ops. Restarting the sample resets `lastCommandId` to `""`, so the same id would fire once more.

## Pixel format / premultiplied alpha

| Stage | Format |
|---|---|
| RenderTarget | `RGBAFormat` + `UnsignedByteType` + `SRGBColorSpace` (matches `renderer.outputColorSpace`) |
| WebGPU copy | `copyTextureToBuffer`; **rows padded to 256 bytes** (`WebGPUTextureUtils.copyTextureToBuffer`) |
| Canvas2D | straight (non-premultiplied) RGBA8 (`canvas2d.h`: writePixels = putImageData semantics) |
| PNG | straight RGBA8 via `canvas2dEncodePng` |

`rgbaImageData` unpacks padded rows when `byteLength !== width * height * 4`. Typical 1280×720 / 1920×1080 already align (`width * 4` is a multiple of 256); odd window widths (e.g. 1366) would previously throw inside `ImageData` and the empty `catch` swallowed it.

The old `new Uint8ClampedArray(pixels.buffer ? pixels : pixels)` ternary was a no-op and would have used a larger `ArrayBuffer` if anyone had switched it to `pixels.buffer`.

Premultiply: opaque MeshBasic / MeshStandard + opaque `setClearColor(0x8aa0b4, 1)` write A=255, so PMA vs straight is invisible. If a future pass renders translucent geometry into this target, GPU blending is typically premultiplied; feeding those bytes to `putImageData` would darken fringes. Un-premultiply only if we start capturing A<255.

Channel order is RGBA, not BGRA: `arcade.png` / `sakae-north.png` have correct greens and sky blue (a BGRA swap would tint the booth magenta and the sky yellow).

The offscreen target is not MSAA (`samples` unset). Edges look a bit harder than the on-screen antialiased swapchain. Acceptable for agent review.

## PowerShell BOM

Windows PowerShell 5.x `Set-Content -Encoding utf8` and `Out-File -Encoding utf8` write a UTF-8 **BOM** (`EF BB BF`). `JSON.parse` then throws `Unexpected token ﻿ in JSON`. Before the SyntaxError log, the 400 ms poller ate that and the command never ran.

Write without a BOM:

```powershell
$path = 'C:\ThreeBrowser\artifacts\harbor-town-1986\command.json'
$json = '{"id":"tour-1","shots":[{"go":"sakae","screenshot":"sakae-north"},{"go":"arcade","screenshot":"arcade"}]}'
[System.IO.File]::WriteAllText($path, $json)  # .NET default UTF-8 no BOM
```

PowerShell 7+: `Set-Content -Encoding utf8NoBOM`. Scout now strips a leading `\uFEFF` as a belt-and-suspenders, but keep writing no-BOM JSON.

`node -e "require('fs').writeFileSync(r'C:\ThreeBrowser\artifacts\harbor-town-1986\command.json', JSON.stringify({id:'t5',go:'arcade',screenshot:'arcade'}))"` is also BOM-free.

## Patch recap (`scout.mjs`)

- Keep RenderTarget readback; never `domElement.toDataURL`.
- No Y-flip.
- Pack 256-aligned GPU rows into ImageData.
- `shots[]` queue; single `{go,screenshot}` still works.
- Strip UTF-8 BOM; warn on `SyntaxError`; `inflight` so a tour does not overlap the next poll.
