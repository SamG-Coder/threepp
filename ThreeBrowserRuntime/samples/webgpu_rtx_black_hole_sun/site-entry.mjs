// Portable, project-owned WebGPU visualization. General-relativistic orbital
// and lensing math, procedural emission, debris, post processing and controls
// remain inside this sample; it needs no sample-specific Runtime native code.
globalThis.__threeBrowserSourceURL =
  "https://webgpu-rtx-black-hole-sun.runtime.threebrowser.local/";
await import("./src/main.mjs");
