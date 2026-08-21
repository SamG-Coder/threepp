import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEntry, loadThreeShim, start, stop } from "./browser-host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2] || path.join(here, "..", "demo", "cubes.mjs");

try {
  loadThreeShim();
  await loadEntry(entry);
  start();
} catch (error) {
  console.error(error?.stack || error);
  stop();
  process.exitCode = 1;
}
