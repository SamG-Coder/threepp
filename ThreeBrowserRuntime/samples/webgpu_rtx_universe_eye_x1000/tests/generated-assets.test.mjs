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
  "sclera-microvascular.png": Object.freeze({
    width: 1254,
    height: 1254,
    bytes: 2438446,
    sha256: "7994d8e98e904d0170628f461677b850d4cd711779cba0a245697c9a30998469",
  }),
  "universe-spiral-iris.png": Object.freeze({
    width: 1254,
    height: 1254,
    bytes: 2753070,
    sha256: "ce6e7ef7fdcd47014c1c8dcdab90f690dcde8a8ba296eaa3a4929fe336fe6884",
  }),
});

test("generated asset directory contains exactly the two project-owned albedos", async () => {
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

test("both generated albedos are distinct and wired by exact local filenames", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  assert.match(main, /assets\/universe-spiral-iris\.png/);
  assert.match(main, /assets\/sclera-microvascular\.png/);
  assert.match(main, /Promise\.all\s*\(/);
  assert.doesNotMatch(main, /https?:\/\//i);
});
