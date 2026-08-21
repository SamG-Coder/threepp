import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEntry, loadThreeShim, start, stop } from "./browser-host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2] || path.join(here, "..", "demo", "cubes.mjs");

try {
  const three = loadThreeShim();
  if (process.env.THREEBROWSER_TRACE_SCENE) {
    const originalAdd = three.Object3D.prototype.add;
    three.Object3D.prototype.add = function (...objects) {
      for (const object of objects) {
        console.error(`ThreeBrowser scene add: ${this.type || "Object3D"}#${this._h || 0} <- ${object?.type || typeof object}#${object?._h || 0}`);
      }
      return originalAdd.apply(this, objects);
    };
  }
  await loadEntry(entry);
  start();
} catch (error) {
  console.error(error?.stack || error);
  stop();
  process.exitCode = 1;
}
