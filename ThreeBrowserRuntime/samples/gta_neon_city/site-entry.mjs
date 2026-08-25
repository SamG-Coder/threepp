// Portable native ThreeBrowserRuntime entry. The complete game is authored in
// this sample; the host contributes only public rendering/input/runtime APIs.
globalThis.__threeBrowserSourceURL = "https://gta-neon-city.runtime.threebrowser.local/";
await import("./src/main.mjs");
