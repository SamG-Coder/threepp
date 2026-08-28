import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const game = await readFile(new URL("../src/modes/game-mode.mjs", import.meta.url), "utf8");
const world = await readFile(new URL("../src/game/location-world.mjs", import.meta.url), "utf8");

test("Game owns progression, connected travel and replacement-safe RTX presentation", () => {
  assert.match(game, /createLocationProgress/);
  assert.match(game, /completeLocationObjective/);
  assert.match(game, /resolveLocationTravel/);
  assert.match(game, /setPathProfile\(runtimePathProfile\(activeTransition\.destination\)\)/);
  assert.match(game, /nativeRenderer\?\.dispose\(\)/);
  assert.match(game, /await configureNative\(world, generation\)/);
  assert.match(game, /nativeRenderer\.renderRaster\(scene, camera\)/);
  assert.match(game, /nativeRenderer\.present\(hudTexture, 0, transition\?\.alpha \?\? 0\)/);
  assert.match(game, /skipLighting:\s*false/);
  assert.match(game, /setPathProfile\(null\)/);
  assert.doesNotMatch(game, /toggleRtx|rtxRequested|PRESET_KEYS/);
  assert.doesNotMatch(game, /new THREE\.WebGPURenderer|setAnimationLoop|appendChild/);
  assert.match(game, /createRetainedGameLoader/);
  assert.match(game, /Exactly the retained-phone pattern used by GTA Neon/);
  assert.match(game, /const initialNativeSetup = configureNative\(world, swapGeneration\)/);
  assert.doesNotMatch(game, /await configureNative\(world, swapGeneration\)/);
});

test("new locations remain painted 2.5D and add no 3D rocks", () => {
  assert.match(world, /createTreeFlats/);
  assert.match(world, /createFlora/);
  assert.match(world, /PlaneGeometry/);
  assert.match(world, /2\.5D waypoint/);
  assert.doesNotMatch(world, /BoxGeometry|SphereGeometry|DodecahedronGeometry|\brocks?\b/i);
});
