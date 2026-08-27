// ThreeBrowser Runtime export entry. The sibling manifest enables native
// WebGPU before this module evaluates; every scene system lives in sample MJS.
globalThis.__threeBrowserSourceURL = "https://secret-river.runtime.threebrowser.local/";
await import("./src/main.mjs");
