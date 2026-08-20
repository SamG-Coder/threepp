# ThreeBrowser ↔ three.js parity

This fork’s WebView2 host (`host/ThreeBrowser`) intercepts `three.js` / `three.module.js`
and injects a native `window.THREE`. Page scripts keep the three.js API; draws go to
threepp’s OpenGL worker behind a transparent WebView.

Reference pages used while bringing this up:

* [webgl_interactive_cubes](https://threejs.org/examples/webgl_interactive_cubes.html)
* [webgl_interactive_cubes_ortho](https://threejs.org/examples/webgl_interactive_cubes_ortho.html)

The cubes test (`three_native_cubes`) packs that scene (2000 Lambert meshes, shared box,
perspective camera, directional light, one orbit pose) as an 8-byte-aligned command
stream and checks camera/cube poses after `tn_cmd_submit`.

## How a frame actually runs

```
page JS  (unchanged three.js example)
  → injected THREE (host/ThreeBrowser/web/three/*.js)
  → aligned binary commands in a WebView2 SharedBuffer
  → one CmdSubmit / tn_cmd_submit per frame
  → threepp GLRenderer on a worker thread
  → GLFW HWND parented under the WebView
```

JS allocates handles locally. Geometry is raw `float32` / `uint32` bytes, not base64.
Vsync is off; `setAnimationLoop` uses a `MessageChannel` pump so Stats is not locked
to 60 Hz the way Chrome `requestAnimationFrame` is.

## API vs three.js

| three.js | ThreeBrowser GPU | Notes |
|---|---|---|
| `Scene`, background, Fog / FogExp2 | yes | Fog via command ops |
| `PerspectiveCamera` | yes | |
| `OrthographicCamera` | yes | |
| `BoxGeometry` and other BufferGeometries | yes | Uploaded as `OP_BUF_GEO` / `OP_BOX_GEO` |
| `Mesh` + `MeshLambertMaterial` / Basic / Standard | yes | Unique materials stay unique draws |
| `MeshPhongMaterial` / Toon / Physical | JS shape; GPU is Standard/Lambert stand-in | |
| `DirectionalLight`, Ambient, Hemi, Point, Spot | yes | |
| `Group`, `Line` / `LineSegments` / `LineLoop` | yes | |
| `Points`, `Sprite` | yes | Sprite requires `SpriteMaterial` |
| `InstancedMesh` `setMatrixAt` / `setColorAt` | yes | Binary 16-float matrix |
| `SkinnedMesh` / `Bone` / `Skeleton` | native ABI yes | Not on the command ring yet (COM) |
| Helpers (Axes, Grid, Box, Arrow) | native ABI yes | COM, not the ring |
| `LOD` | native ABI yes | COM |
| `ShaderMaterial` | native ABI yes | Vertex/fragment strings; uniforms not a C ABI |
| `WebGLRenderer.render` | yes | Flushes dirty poses, one submit |
| `Raycaster` + `Mesh.raycast` | **no** | `Mesh.raycast` is a no-op; picking / red hover on the cubes demo does not run |
| Shadows, `EffectComposer`, `OrbitControls` (addons) | no | Addons are not intercepted |
| Iframe gallery (`#viewer`) | **not supported** | Overlay is top-level documents only |

JS still exposes the usual three.js class names so examples *construct*. Anything
marked “no” or “stand-in” will not match Chrome visually.

## webgl_interactive_cubes.html

The example is:

* 2000 `Mesh`es, **each with its own `MeshLambertMaterial`** (no instancing)
* `PerspectiveCamera(70, …)`, `DirectionalLight(0xffffff, 3)`
* camera orbits `radius = 5` every frame
* `raycaster.intersectObjects(scene.children, false)` then emissive highlight
* `renderer.setAnimationLoop`

**What matches:** scene graph, shared box geometry, 2000 unique Lambert colors,
transforms, perspective camera, directional light, orbit `lookAt` origin, native
draw of 2000 meshes.

**What does not:** hover picking. Stock three.js raycasts 2000 boxes on the CPU
every frame. ThreeBrowser walks the list and calls empty `raycast()`, so
`intersects` is always empty and cubes never go red.

**FPS vs Chrome:** a 2× Stats reading on this page is plausible. Chrome pays
2000 JS `drawElements` plus 2000 CPU raycasts and is vsync-locked. ThreeBrowser
submits one binary blob, draws in C++, skips raycasts, and is not vsync-locked.
On a 60 Hz panel the *displayed* frames can still be DWM-capped; Stats counts
submits.

## Performance knobs (intentional)

* `sortObjects = false` on the GL renderer
* GLFW `vsync(false)`
* Dirty-pose list: only changed objects are packed
* Idle worker waits on a condition variable (no 16 ms poll)

## Tests

| Target | What it covers |
|---|---|
| `three_native_smoke` | Start / one mesh / spin / shutdown |
| `three_native_cubes` | Aligned command packing of the 2000-cube scene + pose round-trip + render |

```
cmake --build build --target three_native_cubes
./build/bin/three_native_cubes
```

On the Windows host build: `.\build.ps1` then `.\run.ps1`, open the example URL.

## Not in scope

* Per-site CSS / URL rewrites
* Compositing native GL into a Chromium iframe
* Replacing three.js addons (`jsm/`)
* Vulkan as the ThreeBrowser backend (GL only for now)
