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

Relative ESM imports, `.js` modules, and HTML import maps are supported. The
bare `three` import resolves to the native ThreeBrowser compatibility API rather
than stock WebGL; addon paths continue through the page's import map so their
JavaScript can import that native core. Press Escape in the native window or
Ctrl+C in the terminal to exit.

At configure time CMake reads the installed Node version and downloads its
matching official Node-API headers and Windows import library from nodejs.org.
Node supplies V8; no WebView or browser renderer process is used.

## Current compatibility boundary

This milestone is a three.js application runtime, not a general HTML/CSS
browser. It supports the browser primitives needed by the included native demo.
HTTP module loading, network `fetch`, images, wheel/text input, import-map
scopes, rendered HTML/CSS overlays, and broader DOM widgets are the next
compatibility layers. DOM controls can execute, but this native-only milestone
does not paint those controls over the GPU surface yet.
