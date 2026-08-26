// Portable Runtime entry. The ball, seam, fibres, GPU physics, shaders,
// camera, controls and HUD are all project-owned JavaScript/WGSL/GLSL.
globalThis.__threeBrowserSourceURL =
  "https://webgpu-rtx-tennis-ball-fibres.runtime.threebrowser.local/";
await import("./src/main.mjs");
