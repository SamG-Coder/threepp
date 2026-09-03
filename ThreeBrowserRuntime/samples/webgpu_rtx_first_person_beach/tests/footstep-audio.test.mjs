import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FOOTSTEP_SURFACES } from "../src/footstep-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every walking surface ships two valid, distinct native PCM WAVs", async () => {
  for (const surface of FOOTSTEP_SURFACES) {
    const variants = await Promise.all([1, 2].map(variant => readFile(
      path.join(root, "assets", "audio", `footstep-${surface}-${variant}.wav`),
    )));
    for (const wav of variants) {
      assert.equal(wav.toString("ascii", 0, 4), "RIFF");
      assert.equal(wav.toString("ascii", 8, 12), "WAVE");
      assert.equal(wav.readUInt16LE(20), 1, "audio must be PCM");
      assert.equal(wav.readUInt16LE(22), 1, "audio must be mono");
      assert.equal(wav.readUInt32LE(24), 32_000);
      assert.ok(wav.length > 8_000);
    }
    assert.notDeepEqual(variants[0], variants[1], `${surface} variants must differ`);
  }
});
