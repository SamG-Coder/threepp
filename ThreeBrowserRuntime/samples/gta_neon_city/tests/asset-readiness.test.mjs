import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textureRoot = path.join(sampleRoot, "assets", "textures");

test("every authored bitmap is valid and awaited before world creation and pipeline warmup", async () => {
  const files = (await readdir(textureRoot))
    .filter(name => name.toLowerCase().endsWith(".png"))
    .sort();
  const main = await readFile(path.join(sampleRoot, "src", "main.mjs"), "utf8");
  const referenced = [...main.matchAll(/["']\.\.\/assets\/textures\/([^"']+\.png)["']/g)]
    .map(match => match[1])
    .sort();
  assert.deepEqual(referenced, files,
    "the startup Promise.all must decode every authored bitmap and no missing file may silently escape preload");

  const loadBarrier = main.indexOf("await Promise.all([");
  const worldCreation = main.indexOf("const world = buildCity");
  const pipelineWarmup = main.indexOf("await warmRendererPipelines");
  assert.ok(loadBarrier >= 0 && worldCreation > loadBarrier && pipelineWarmup > worldCreation,
    "bitmap decode must finish before world materials are built and rendered by startup warmup");
  for (const name of files) {
    const reference = main.indexOf(`../assets/textures/${name}`);
    assert.ok(reference > loadBarrier && reference < worldCreation, `${name} is not inside the pre-world decode barrier`);
    const bytes = await readFile(path.join(textureRoot, name));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${name} does not have a PNG signature`);
    assert.ok(bytes.readUInt32BE(16) >= 1024 && bytes.readUInt32BE(20) >= 1024,
      `${name} must retain production texture resolution`);
  }
});

test("no gameplay subsystem owns a late bitmap loader", async () => {
  const sourceRoots = ["actors", "core", "game", "ui", "world"];
  const offenders = [];
  for (const directory of sourceRoots) {
    const absolute = path.join(sampleRoot, "src", directory);
    for (const name of await readdir(absolute)) {
      if (!name.endsWith(".mjs")) continue;
      const source = await readFile(path.join(absolute, name), "utf8");
      if (/\b(?:TextureLoader|ImageLoader|ImageBitmapLoader)\b/.test(source)) offenders.push(`${directory}/${name}`);
    }
  }
  assert.deepEqual(offenders, [],
    "runtime gameplay modules must use startup-created memory resources, never decode a bitmap on first use");
});
