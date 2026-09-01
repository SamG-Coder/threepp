import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const loaderURL = pathToFileURL(fileURLToPath(new URL("./module-loader.mjs", import.meta.url))).href;

test("loads legacy raw JSON localized with a .json.mjs suffix", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threebrowser-module-loader-"));
  const jsonPath = path.join(temporaryRoot, "config.json.mjs");
  try {
    await writeFile(jsonPath, '{"enabled":true}');
    const jsonURL = pathToFileURL(jsonPath).href;
    const script = [
      `await import(${JSON.stringify(loaderURL)});`,
      `const loaded = await import(${JSON.stringify(jsonURL)}, { with: { type: "json" } });`,
      "process.stdout.write(JSON.stringify(loaded.default));",
    ].join("\n");

    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script]);
    assert.deepEqual(JSON.parse(stdout), { enabled: true });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
