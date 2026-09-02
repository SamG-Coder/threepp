import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TILE_SPECS } from "../src/tile-relief.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24], colorType: bytes[25] };
}

for (const name of Object.keys(TILE_SPECS)) {
  test(`${name} albedo/height/normal are 1024 square PNGs`, async () => {
    const albedo = pngSize(await readFile(join(sampleRoot, "assets", "textures", `${name}-albedo.png`)));
    const height = pngSize(await readFile(join(sampleRoot, "assets", "textures", `${name}-height.png`)));
    const normal = pngSize(await readFile(join(sampleRoot, "assets", "textures", `${name}-normal.png`)));
    assert.deepEqual(albedo, { width: 1024, height: 1024, bitDepth: 8, colorType: 2 });
    assert.deepEqual(height, { width: 1024, height: 1024, bitDepth: 8, colorType: 0 });
    assert.deepEqual(normal, { width: 1024, height: 1024, bitDepth: 8, colorType: 2 });
  });
}
