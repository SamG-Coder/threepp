import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("phone pointer mode advances cached UI while the gameplay simulation stays paused", async () => {
  const main = await readFile(path.join(sampleRoot, "src", "main.mjs"), "utf8");
  assert.match(main, /const interactive = gameplayCaptured \|\| Boolean\(input\.uiPointerMode\)/,
    "released pointer-lock must not stop phone mouse-up, hover, or navigation input");
  assert.match(main, /const dt = paused \|\| !gameplayCaptured \|\| input\.uiPointerMode \? 0 : delta/,
    "phone interaction must not advance traffic, combat, needs, or story time");
  assert.match(main, /presentationElapsed \+= Math\.max\(0, Number\(delta\) \|\| 0\)/,
    "phone presentation needs an independent clock for smooth open and app transitions");
  assert.match(main, /presentationElapsed - phoneOpenedAt/);
  assert.match(main, /presentationElapsed - phoneAppTransitionAt/);
});
