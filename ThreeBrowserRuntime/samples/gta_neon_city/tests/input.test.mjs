import test from "node:test";
import assert from "node:assert/strict";
import { createInput } from "../src/core/input.mjs";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, values = {}) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
}

function harness(options = {}) {
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  documentTarget.pointerLockElement = null;
  documentTarget.exitPointerLock = () => {
    documentTarget.pointerLockElement = null;
    documentTarget.dispatch("pointerlockchange");
  };
  const canvas = new FakeEventTarget();
  canvas.style = {};
  canvas.captureRequests = 0;
  canvas.requestPointerLock = () => { canvas.captureRequests += 1; };

  const previous = {
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
    document: globalThis.document,
  };
  globalThis.addEventListener = windowTarget.addEventListener.bind(windowTarget);
  globalThis.removeEventListener = windowTarget.removeEventListener.bind(windowTarget);
  globalThis.document = documentTarget;

  const input = createInput(canvas, options);
  return {
    input,
    canvas,
    document: documentTarget,
    keyDown(code, extra = {}) { return windowTarget.dispatch("keydown", { code, ...extra }); },
    keyUp(code) { return windowTarget.dispatch("keyup", { code }); },
    blur() { return windowTarget.dispatch("blur"); },
    lock() {
      documentTarget.pointerLockElement = canvas;
      documentTarget.dispatch("pointerlockchange");
    },
    unlock() {
      documentTarget.pointerLockElement = null;
      documentTarget.dispatch("pointerlockchange");
    },
    pointerDown(button) { return canvas.dispatch("pointerdown", { button }); },
    pointerUp(button) { return canvas.dispatch("pointerup", { button }); },
    wheel(deltaY) { return canvas.dispatch("wheel", { deltaY }); },
    restore() {
      input.dispose();
      if (previous.addEventListener === undefined) delete globalThis.addEventListener;
      else globalThis.addEventListener = previous.addEventListener;
      if (previous.removeEventListener === undefined) delete globalThis.removeEventListener;
      else globalThis.removeEventListener = previous.removeEventListener;
      if (previous.document === undefined) delete globalThis.document;
      else globalThis.document = previous.document;
    },
  };
}

test("phone pointer mode releases capture and turns clicks into UI actions", () => {
  const game = harness();
  try {
    game.lock();
    assert.equal(game.input.pointer.locked, true);
    game.input.setUiPointerMode(true);
    assert.equal(game.input.pointer.locked, false);
    assert.equal(game.input.uiPointerMode, true);
    assert.equal(game.canvas.style.cursor, "default");
    game.pointerDown(0);
    assert.equal(game.canvas.captureRequests, 0, "a phone tap must not recapture the camera");
    assert.equal(game.input.actionPressed("fire"), true, "the phone should receive the click edge");
    game.pointerUp(0);
    assert.equal(game.input.actionReleased("fire"), true, "the phone should activate on the release edge");
    assert.equal(game.input.actionReleased("fire"), false, "a release edge should be consumed once");
    const wheel = game.wheel(120);
    assert.equal(wheel.defaultPrevented, true, "phone scrolling must not reach the host window");
    assert.equal(game.input.consumeWheel(), 1, "the phone should receive one normalized scroll step");
    assert.equal(game.input.consumeLookDelta().wheel, 0, "consumed phone scroll must not zoom the camera");
  } finally {
    game.restore();
  }
});

test("quick car, interaction and story taps survive render-only frames and consume once", () => {
  let time = 0;
  const game = harness({ now: () => time });
  try {
    for (const code of ["KeyF", "KeyE", "KeyM"]) {
      game.keyDown(code);
      game.keyUp(code);
    }

    time = 16;
    game.input.endFrame(); // A rendered frame with no fixed simulation update.
    assert.equal(game.input.actionDown("enterExit"), false, "a released tap must not become held input");
    assert.equal(game.input.actionPressed("enterExit"), true, "F should reach the vehicle interaction tick");
    assert.equal(game.input.actionPressed("enterExit"), false, "one F edge should be consumed once");
    assert.equal(game.input.actionPressed("interact"), true, "E should reach the story interaction tick");
    assert.equal(game.input.actionPressed("interact"), false, "one E edge should be consumed once");
    assert.equal(game.input.actionPressed("mission"), true, "M should reach the story-start tick");
    assert.equal(game.input.actionPressed("mission"), false, "one M edge should be consumed once");
    assert.deepEqual([...game.input.pressed], [], "the compatibility pressed set mirrors consumed queues");
  } finally {
    game.restore();
  }
});

test("held keys do not auto-repeat while distinct rapid taps retain distinct edges", () => {
  const game = harness();
  try {
    game.keyDown("KeyE");
    game.keyDown("KeyE", { repeat: true });
    assert.equal(game.input.actionPressed("interact"), true);
    assert.equal(game.input.actionPressed("interact"), false, "OS key repeat must not enqueue another edge");
    game.input.endFrame();
    assert.equal(game.input.actionDown("interact"), true);
    assert.equal(game.input.actionPressed("interact"), false, "a held key must remain level-only");

    game.keyUp("KeyE");
    game.keyDown("KeyE");
    game.keyUp("KeyE");
    game.keyDown("KeyE");
    game.keyUp("KeyE");
    assert.equal(game.input.actionPressed("interact"), true);
    assert.equal(game.input.actionPressed("interact"), true, "two real taps should not collapse into one Set entry");
    assert.equal(game.input.actionPressed("interact"), false);
  } finally {
    game.restore();
  }
});

test("buffer expiry accepts either elapsed time or simulation-frame age and rejects stale resume input", () => {
  let time = 0;
  const game = harness({ now: () => time, actionBufferMs: 100, actionBufferFrames: 3 });
  try {
    game.keyDown("KeyF");
    game.keyUp("KeyF");
    time = 1_000;
    game.input.endFrame();
    assert.equal(game.input.actionPressed("enterExit"), false,
      "an old tap must not execute after a long minimize or application stall");

    time = 1_000;
    game.keyDown("KeyE");
    game.keyUp("KeyE");
    for (const nextTime of [1_010, 1_020, 1_030]) {
      time = nextTime;
      game.input.endFrame();
    }
    assert.equal(game.input.actionPressed("interact"), false,
      "an unhandled edge must expire after its bounded time and frame budget");
    assert.equal(game.input.pressed.has("KeyE"), false);
  } finally {
    game.restore();
  }
});

test("render-only frames preserve action edges and look deltas until a simulation frame", () => {
  let time = 0;
  const game = harness({ now: () => time });
  try {
    game.keyDown("KeyF");
    game.keyUp("KeyF");
    game.input.injectLook(9, -4, 1);
    for (let frame = 0; frame < 4; ++frame) {
      time += 4;
      game.input.endFrame({ simulationAdvanced: false });
    }

    assert.equal(game.input.actionPressed("enterExit"), true,
      "four high-refresh presents must not clear F before the 60 Hz update");
    assert.deepEqual(game.input.consumeLookDelta(), { x: 9, y: -4, wheel: 1 },
      "mouse look and wheel input must reach the same simulation update");
    game.input.endFrame({ simulationAdvanced: true });
    assert.equal(game.input.actionPressed("enterExit"), false);
    assert.deepEqual(game.input.consumeLookDelta(), { x: 0, y: 0, wheel: 0 });
  } finally {
    game.restore();
  }
});

test("blur and pointer-lock loss clear physical edges without losing control-pipe injections", () => {
  const game = harness();
  try {
    game.lock();
    game.keyDown("KeyF");
    game.input.injectAction("interact");
    game.input.injectHeldAction("aim", true);
    game.input.injectLook(12, -7, 1);
    game.blur();
    assert.equal(game.input.actionDown("enterExit"), false);
    assert.equal(game.input.actionPressed("enterExit"), false, "an old F press must not fire after refocus");
    assert.equal(game.input.actionPressed("interact"), true,
      "native control injection is independent of desktop focus");
    assert.equal(game.input.actionDown("aim"), true, "held control injection keeps its existing semantics");
    assert.deepEqual(game.input.consumeLookDelta(), { x: 0, y: 0, wheel: 0 },
      "focus loss cannot replay stale camera or zoom motion");

    game.pointerDown(2);
    assert.equal(game.input.actionPressed("aim"), true);
    game.pointerUp(2);
    game.keyDown("KeyE");
    game.unlock();
    assert.equal(game.input.actionPressed("interact"), false,
      "capture loss clears actions entered in the abandoned focus session");
    assert.equal(game.input.actionPressed("aim"), false,
      "capture loss also clears pending physical mouse edges");
    assert.equal(game.input.actionDown("aim"), true,
      "capture loss does not alter explicit native held-action injection");
  } finally {
    game.restore();
  }
});

test("the capture click stays inert, then locked fire and aim retain edge/down behavior", () => {
  const game = harness();
  try {
    const captureClick = game.pointerDown(0);
    assert.equal(game.canvas.captureRequests, 1);
    assert.equal(captureClick.defaultPrevented, true);
    assert.equal(game.input.actionPressed("fire"), false, "the play gesture must never become a shot");

    game.lock();
    game.pointerDown(2);
    assert.equal(game.input.actionDown("aim"), true);
    assert.equal(game.input.actionPressed("aim"), true);
    assert.equal(game.input.actionPressed("aim"), false);
    game.input.endFrame();
    assert.equal(game.input.actionDown("aim"), true, "right mouse stays held across frames");
    assert.equal(game.input.actionPressed("aim"), false, "held aim does not repeat its edge");
    game.pointerUp(2);
    assert.equal(game.input.actionDown("aim"), false);

    game.pointerDown(0);
    game.pointerUp(0);
    assert.equal(game.input.actionPressed("fire"), true);
    assert.equal(game.input.actionPressed("fire"), false);
  } finally {
    game.restore();
  }
});

test("injected actions and keys use the same buffered, ordered, consume-once contract", () => {
  let time = 0;
  const game = harness({ now: () => time, actionBufferMs: 80, actionBufferFrames: 2 });
  try {
    game.input.injectAction("interact");
    game.input.injectAction("interact");
    game.input.injectKey("KeyF", true);
    game.input.injectKey("KeyF", false);
    time = 16;
    game.input.endFrame();
    assert.equal(game.input.actionPressed("interact"), true);
    assert.equal(game.input.actionPressed("interact"), true,
      "two control requests represent two distinct action edges");
    assert.equal(game.input.actionPressed("interact"), false);
    assert.equal(game.input.actionPressed("enterExit"), true);
    assert.equal(game.input.actionPressed("enterExit"), false);

    game.input.injectAction("mission");
    for (const nextTime of [56, 106]) {
      time = nextTime;
      game.input.endFrame();
    }
    assert.equal(game.input.actionPressed("mission"), false, "stale injected edges obey bounded expiry too");
  } finally {
    game.restore();
  }
});

test("consumeCode shares the action queue without duplicating numeric choice presses", () => {
  const game = harness();
  try {
    game.keyDown("Digit1");
    game.keyUp("Digit1");
    game.input.endFrame();
    assert.equal(game.input.consumeCode("Digit1"), true);
    assert.equal(game.input.consumeCode("Digit1"), false);
    assert.equal(game.input.pressed.has("Digit1"), false);
  } finally {
    game.restore();
  }
});
