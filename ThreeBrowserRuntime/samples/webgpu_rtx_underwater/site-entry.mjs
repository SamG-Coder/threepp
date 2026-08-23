// ThreeBrowser Runtime export entry. WebGPU is enabled from the manifest
// before this module is evaluated, so navigator.gpu.threeBrowserRTX is live.
globalThis.__threeBrowserSourceURL = "https://webgpu-rtx-underwater.runtime.threebrowser.local/";
await import("./src/main.mjs");

