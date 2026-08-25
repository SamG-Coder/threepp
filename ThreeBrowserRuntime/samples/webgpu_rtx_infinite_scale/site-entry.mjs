// Portable Runtime entry. Every visible object, transition, shader and HUD
// element is authored inside this project; the host supplies only generic
// Three.js/WebGPU and RTX facilities.
globalThis.__threeBrowserSourceURL =
  "https://webgpu-rtx-infinite-scale.runtime.threebrowser.local/";
await import("./src/main.mjs");
