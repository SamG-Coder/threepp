// ThreeBrowser Runtime export entry. Native WebGPU is configured by the
// sibling manifest before the project-owned MJS scene evaluates.
globalThis.__threeBrowserSourceURL = "https://webgpu-rtx-flash-flood-gorge.runtime.threebrowser.local/";
await import("./src/main.mjs");
