import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assetRoot = join(sampleRoot, "assets");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const expected = Object.freeze({
  "morpho-wing-lamellae.png": Object.freeze({
    width: 928,
    height: 928,
    bytes: 2323376,
    sha256: "d49556ef23a14fd6ba8d4f58c64afae9affac1513b05e5733a08c12e03085cb1",
  }),
  "compound-eye-mosaic.png": Object.freeze({
    width: 928,
    height: 928,
    bytes: 1802647,
    sha256: "d8c002c452a53af7c18409a5208fae092123f9f51934148270ea9fa71fcadee0",
  }),
  "greenhouse-moss.png": Object.freeze({
    width: 928,
    height: 928,
    bytes: 2113683,
    sha256: "20a77b08bfe24b3b42c94f518025b79dc6393ed665302211ed7000f0a15f0341",
  }),
});

test("generated asset directory contains exactly the three project-owned albedos", async () => {
  assert.deepEqual((await readdir(assetRoot)).sort(), Object.keys(expected).sort());
});

for (const [filename, contract] of Object.entries(expected)) {
  test(`${filename} is the expected full-resolution RGB PNG`, async () => {
    const bytes = await readFile(join(assetRoot, filename));
    assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE);
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(bytes.readUInt32BE(16), contract.width);
    assert.equal(bytes.readUInt32BE(20), contract.height);
    assert.equal(bytes[24], 8, "expected 8-bit channels");
    assert.equal(bytes[25], 2, "expected truecolor RGB PNG");
    assert.equal(bytes.length, contract.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), contract.sha256);
  });
}

test("all three generated albedos are distinct and wired by exact local filenames", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  assert.match(main, /assets\/morpho-wing-lamellae\.png/);
  assert.match(main, /assets\/compound-eye-mosaic\.png/);
  assert.match(main, /assets\/greenhouse-moss\.png/);
  assert.match(main, /Promise\.all\s*\(/);
  assert.doesNotMatch(main, /https?:\/\//i);
});
