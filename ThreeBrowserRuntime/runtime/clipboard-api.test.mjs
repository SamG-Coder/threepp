import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const addonPath = path.resolve(here, "../build/bin/three_browser_runtime.node");

test("native browser host exposes the asynchronous clipboard write contract", {
  skip: fs.existsSync(addonPath) ? false : "native addon is not built",
}, async testContext => {
  const native = createRequire(import.meta.url)(addonPath);
  if (typeof native.clipboardWriteText !== "function") {
    testContext.skip("native addon predates clipboard writing");
    return;
  }
  process.env.THREEBROWSER_RUNTIME_ADDON = addonPath;
  const host = await import(`${pathToFileURL(path.join(here, "browser-host.mjs")).href}?clipboard-api-test`);
  assert.equal(typeof navigator.clipboard, "object");
  assert.equal(typeof navigator.clipboard.writeText, "function");
  host.stop();
});
