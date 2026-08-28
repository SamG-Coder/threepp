import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MENU_OPTIONS,
  menuOptionAtPoint,
  menuSelectionAfter,
} from "../src/modes/main-menu.mjs";

test("main-menu selection wraps cleanly across Game and Demo", () => {
  assert.deepEqual(MENU_OPTIONS.map(option => option.id), ["game", "demo"]);
  assert.equal(menuSelectionAfter(0, 1), 1);
  assert.equal(menuSelectionAfter(1, 1), 0);
  assert.equal(menuSelectionAfter(0, -1), 1);
  assert.equal(menuSelectionAfter(1, -1), 0);
});

test("main-menu hit targets match the authored card artwork at every scale", () => {
  assert.equal(menuOptionAtPoint(1000, 500, 1600, 900), 0);
  assert.equal(menuOptionAtPoint(1000, 650, 1600, 900), 1);
  assert.equal(menuOptionAtPoint(500, 500, 1600, 900), -1);
  assert.equal(menuOptionAtPoint(500, 250, 800, 450), 0, "half-size canvas keeps the Game hit target");
  assert.equal(menuOptionAtPoint(500, 325, 800, 450), 1, "half-size canvas keeps the Demo hit target");
});

test("main-menu artwork uses the generated map and remains GPU canvas-only", async () => {
  const source = await readFile(new URL("../src/modes/main-menu.mjs", import.meta.url), "utf8");
  assert.match(source, /MAP_DATA/);
  assert.match(source, /map-data\.generated\.mjs/);
  assert.match(source, /MAP \(C\) STATE OF NEW SOUTH WALES \(SPATIAL SERVICES\)/);
  assert.match(source, /top \+ point\[1\] \* height/);
  assert.doesNotMatch(source, /top \+ \(1 - point\[1\]\)/, "screen-normalized map Y must not be flipped");
  assert.match(source, /new THREE\.CanvasTexture/);
  assert.match(source, /texture\.colorSpace\s*=\s*THREE\.SRGBColorSpace/);
  assert.match(source, /material\.toneMapped\s*=\s*false/);
  assert.match(source, /retainedSelectionTextures/);
  assert.match(source, /renderer\.initTexture\(retainedTexture\)/);
  assert.doesNotMatch(source, /createElement\(["'](?:button|div|dialog|input)["']\)/i);
  assert.match(source, /removeEventListener\("pointermove"/);
  assert.match(source, /removeEventListener\("pointerup"/);
});
