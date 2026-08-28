import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  creekOpacity,
  creekReflectionWeight,
  mixCreekColour,
} from "../src/creek-mix.mjs";

const src = dirname(dirname(fileURLToPath(import.meta.url)));

test("creek mix always blends reflector colour into the tannin body", () => {
  const glancing = creekReflectionWeight(1, 1);
  const facing = creekReflectionWeight(0, 1);
  assert.ok(facing > 0.15 && facing < 0.5, `facing ${facing}`);
  assert.ok(glancing > facing && glancing < 0.95, `glancing ${glancing}`);
  const body = [0.1, 0.16, 0.1];
  const sky = [0.7, 0.75, 0.85];
  const mixed = mixCreekColour(body, sky, glancing);
  assert.ok(mixed[2] > body[2], "blue from sky reflection reaches the body");
  assert.ok(mixed[0] < sky[0], "body still tints the reflection");
});

test("shipped river material mixes reflector.rgb rather than a flat mud colour", async () => {
  const river = await readFile(join(src, "src", "river.mjs"), "utf8");
  assert.match(river, /reflector\s*\(/);
  assert.match(river, /CREEK_FRESNEL_SCALE/);
  assert.match(river, /mix\(\s*bodyShallow,\s*reflected,\s*reflectionWeight\)/);
  assert.doesNotMatch(river, /material\.colorNode\s*=\s*color\(/);
  assert.match(river, /shoreDistance/);
  assert.doesNotMatch(river, /riverEdgeZ\(x\)\s*\+\s*1\.6/);
  assert.match(river, /resolutionScale:\s*0\.62/);
  assert.match(river, /mx_fractal_noise_float/g);
  assert.doesNotMatch(river, /const phase[A-Z]/, "surface motion is not built from parallel sine bands");
  assert.doesNotMatch(river, /\bsin\s*\(/, "creek shader has no periodic line-wave masks");
  assert.match(river, /normalMap\s*\(/, "procedural surface fields drive a real tangent normal");
});

test("creek is translucent at the wet bank and gains opacity with depth", () => {
  const bank = creekOpacity(0);
  const wading = creekOpacity(1.5);
  const channel = creekOpacity(9);
  assert.ok(bank >= 0.1 && bank < 0.25, `bank opacity ${bank}`);
  assert.ok(wading > bank && wading < channel, `${bank} < ${wading} < ${channel}`);
  assert.ok(channel > 0.9 && channel < 1, `channel opacity ${channel}`);
});
