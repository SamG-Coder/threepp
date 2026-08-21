# ThreeBrowserRuntime

ThreeBrowserRuntime is the WebView-free execution path for ThreeBrowser. V8 is
provided by Node, while a Node-API addon calls the existing threepp and native
WebGPU hosts directly in-process and owns the rendering window.

The first milestone includes:

- a custom native threepp window;
- an in-process V8-to-C++ command path using `ArrayBuffer` memory;
- native display-clock `requestAnimationFrame` scheduling;
- a minimal `window`, `document`, canvas and `EventTarget` environment;
- mouse, button and keyboard event dispatch into JavaScript;
- JavaScript and simple HTML module entry points;
- reuse of the existing ThreeBrowser `THREE` compatibility slices; and
- reuse of the existing `three_webgpu.dll` command ring for stock Three.js
  WebGPU/TSL applications such as Poseidon.

## Build and run

Install x64 Node, .NET 10, CMake and the MSYS2 UCRT64 toolchain. The project
uses the normal .NET CLI workflow from its own directory:

```powershell
cd C:\ThreeBrowser\ThreeBrowserRuntime
dotnet build
dotnet run
```

Pass a `.mjs`, `.js`, or simple `.html` entry after `--` to launch another page:

```powershell
dotnet run -- .\pages\example.html
```

A `threebrowser.local` page can be copied into an isolated runtime project and
launched with one command:

```powershell
dotnet run -- import https://threebrowser.local/demos/poseidon/index.html
```

The imported files are stored under `ThreeBrowserRuntime\projects\<name>` with
a `.threebrowser-project.json` manifest. Running the same import refreshes the
copied files from the browser web root without editing the originals.

## Pull and unpack a website

From a new empty folder, `pull` downloads a website and walks its Vite/ESM
dependency graph. JavaScript modules are localized as `.mjs`, referenced chunks
and assets are copied, available source maps are expanded, and Three.js sources
inside source maps are separated under `unpacked\three`.

```powershell
mkdir C:\Sites\pulled-demo
cd C:\Sites\pulled-demo
dotnet run --project C:\ThreeBrowser\ThreeBrowserRuntime\ThreeBrowserRuntime.csproj -- pull https://example.com/
dotnet run --project C:\ThreeBrowser\ThreeBrowserRuntime\ThreeBrowserRuntime.csproj -- .\site-entry.mjs
```

The command writes `site-entry.mjs` and `threebrowser.pull.json`. It refuses to
write into a non-empty destination unless `--force` is supplied. `unpack` is an
alias for `pull`.

Relative ESM imports, `.js` modules, and HTML import maps are supported. The
bare `three` import resolves to the native ThreeBrowser compatibility API rather
than stock WebGL; addon paths continue through the page's import map so their
JavaScript can import that native core. Escape releases pointer lock, while
Ctrl+C in the terminal exits the runtime.

At configure time CMake reads the installed Node version and downloads its
matching official Node-API headers and Windows import library from nodejs.org.
Node supplies V8; no WebView or browser renderer process is used.

## Current compatibility boundary

This milestone is a three.js application runtime, not a general HTML/CSS
browser. Localized ESM graphs, import maps, local and network `fetch`, image
decoding, HDR environments, DRACO workers, skeletal animation, pointer/keyboard
input, and the WebGPU/TSL command path are supported. DOM controls can execute,
but this native-only milestone does not paint general HTML/CSS widgets over the
GPU surface yet.

## Visually verified official examples

The following pages have been pulled from `threejs.org`, run in Release mode,
and visually checked in the native window:

- `webgl_geometry_cube.html` — image decode, textured geometry, animation;
- `webgl_instancing_performance.html` — 1,000 meshes and pointer orbit;
- `webgl_loader_gltf.html` — GLB, embedded textures, UltraHDR and PMREM;
- `webgl_animation_keyframes.html` — DRACO WASM worker and skinned animation;
- `webgpu_compute_particles.html` — stock WebGPU/TSL compute and rendering.
- `webgpu_postprocessing.html` — TSL render pipeline, dot-screen and RGB shift.
