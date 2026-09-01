import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";

function loadSlice(relative, extras = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const context = {
    ArrayBuffer, Uint8Array, Uint32Array, Float32Array, Map, Set, Object, Number, String, Math,
    console, process, Promise, queueMicrotask,
    performance: { now: () => 0 },
    setTimeout, clearTimeout,
  };
  context.globalThis = context;
  context.__TN = extras.TN || {};
  Object.assign(context, extras.globals || {});
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return context;
}

test("native runtime skips composer revisits after one city prepare", () => {
  const context = loadSlice("../../host/ThreeBrowser/web/three/10-renderer.js", {
    globals: { __threeBrowserNativeRuntime: true, __threeBrowserDisplayFrame: 4 },
    TN: {
      Color: class {},
      Vector2: class {},
      Vector3: class {},
      Vector4: class {},
      MathUtils: { generateUUID: () => "u" },
      PCFShadowMap: 1,
    },
  });
  const decide = context.__TN._nativeOffscreenDecision;
  const renderer = {};
  const city = { children: [1, 2, 3] };
  const perspective = { isPerspectiveCamera: true };
  const ortho = { isPerspectiveCamera: false };
  const target = { _h: 9 };

  assert.equal(decide(renderer, city, perspective, target), "prepare");
  renderer._nativePreparedFrame = 4;
  assert.equal(decide(renderer, city, perspective, target), "skip");
  assert.equal(decide(renderer, { children: [1] }, perspective, target, true), "prepare-overlay");
  assert.equal(decide(renderer, { children: [] }, ortho, target), "skip");
  assert.equal(decide(renderer, city, perspective, null), "present");
});

test("non-runtime hosts still evaluate offscreen passes", () => {
  const context = loadSlice("../../host/ThreeBrowser/web/three/10-renderer.js", {
    TN: {
      Color: class {},
      Vector2: class {},
      Vector3: class {},
      Vector4: class {},
      MathUtils: { generateUUID: () => "u" },
      PCFShadowMap: 1,
    },
  });
  const decide = context.__TN._nativeOffscreenDecision;
  assert.equal(decide({}, { children: [] }, { isPerspectiveCamera: true }, { _h: 1 }), "evaluate");
});

test("shader materials flush once per display frame unless defines change", () => {
  const context = loadSlice("../../host/ThreeBrowser/web/three/06-materials.js", {
    globals: { __threeBrowserDisplayFrame: 3 },
    TN: {
      EventDispatcher: class {},
      Color: class {},
      Vector2: class {},
      Vector3: class {},
      FrontSide: 0,
      MathUtils: { generateUUID: () => "u" },
    },
  });
  const shouldFlush = context.__TN._nativeShouldFlushShader;
  const mat = { _nativeFlushFrame: 3 };
  assert.equal(shouldFlush(mat, 3, false), false);
  assert.equal(shouldFlush(mat, 4, false), true);
  assert.equal(shouldFlush(mat, 3, true), true);
});
