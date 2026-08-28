import assert from "node:assert/strict";
import test from "node:test";
import { createModeRouter } from "../src/app/mode-router.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function makeMode(id) {
  return {
    id,
    frames: [],
    viewports: [],
    loading: [],
    errors: [],
    disposeCount: 0,
    frame(value) { this.frames.push(value); },
    resize(value) { this.viewports.push(value); },
    setLoading(value) { this.loading.push(value); },
    setError(value) { this.errors.push(value); },
    dispose() { this.disposeCount += 1; },
  };
}

test("router keeps the current mode alive while loading and swaps exactly once", async () => {
  const menu = makeMode("menu");
  const demo = makeMode("demo");
  const pendingDemo = deferred();
  const router = createModeRouter({
    factories: {
      menu: () => menu,
      demo: () => pendingDemo.promise,
      game: () => makeMode("game"),
    },
  });
  const viewport = { width: 1280, height: 720, internalWidth: 1920, internalHeight: 1080 };
  router.resize(viewport);

  assert.equal(await router.activate("menu"), true);
  assert.equal(router.activeId, "menu");
  assert.deepEqual(menu.viewports, [viewport]);

  const firstFrame = { now: 10, delta: 1 / 60, wallDelta: 1 / 60 };
  assert.equal(router.frame(firstFrame), true);
  assert.deepEqual(menu.frames, [firstFrame]);

  const transition = router.activate("demo");
  assert.equal(router.transitioning, true);
  assert.equal(router.pendingId, "demo");
  assert.deepEqual(menu.loading, ["demo"]);
  assert.equal(await router.activate("game"), false, "a second selection is ignored while loading");
  router.frame({ now: 11, delta: 1 / 60, wallDelta: 1 / 60 });
  assert.equal(menu.frames.length, 2, "the menu remains renderable during asynchronous loading");

  pendingDemo.resolve(demo);
  assert.equal(await transition, true);
  assert.equal(router.activeId, "demo");
  assert.equal(menu.disposeCount, 1);
  assert.deepEqual(demo.viewports, [viewport]);
  router.frame({ now: 12, delta: 1 / 60, wallDelta: 1 / 60 });
  assert.equal(demo.frames.length, 1);

  await router.dispose();
  await router.dispose();
  assert.equal(demo.disposeCount, 1, "active mode disposal is idempotent");
  assert.equal(router.frame(firstFrame), false);
});

test("failed dynamic mode load rolls back to the live menu", async () => {
  const menu = makeMode("menu");
  const errors = [];
  const router = createModeRouter({
    factories: {
      menu: () => menu,
      game: async () => { throw new Error("Cannot find module ./game-mode.mjs"); },
    },
    onError(error, detail) {
      errors.push({ error, detail });
    },
  });

  assert.equal(await router.activate("menu"), true);
  assert.equal(await router.activate("game"), false);
  assert.equal(router.activeId, "menu");
  assert.equal(menu.disposeCount, 0);
  assert.deepEqual(menu.loading, ["game", null]);
  assert.match(menu.errors[0].message, /Cannot find module/);
  assert.deepEqual(errors[0].detail, { phase: "load", modeId: "game" });
  assert.equal(router.frame({ now: 1, delta: 0, wallDelta: 0 }), true);
});

test("invalid replacement modes are rejected without disturbing the active mode", async () => {
  const menu = makeMode("menu");
  const router = createModeRouter({
    factories: {
      menu: () => menu,
      demo: () => ({ id: "demo" }),
    },
  });

  await router.activate("menu");
  assert.equal(await router.activate("demo"), false);
  assert.equal(router.activeId, "menu");
  assert.match(menu.errors[0].message, /frame\(frameContext\)/);
  assert.equal(menu.disposeCount, 0);
});
