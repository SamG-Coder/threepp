// Portable ThreeBrowserRuntime entry. All game, world, graphics and gameplay
// decisions stay in this project and use only public JavaScript runtime APIs.
globalThis.__threeBrowserSourceURL =
  "https://medieval-valley-rpg.runtime.threebrowser.local/";
await import("./src/main.mjs");
