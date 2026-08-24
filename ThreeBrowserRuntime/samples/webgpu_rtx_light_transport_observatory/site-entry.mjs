// Portable Runtime entry. The gallery, shaders, camera, interaction and HUD
// are project-owned JavaScript; native code only provides the generic RTX ABI.
globalThis.__threeBrowserSourceURL =
  "https://webgpu-rtx-light-transport-observatory.runtime.threebrowser.local/";
await import("./src/main.mjs");
