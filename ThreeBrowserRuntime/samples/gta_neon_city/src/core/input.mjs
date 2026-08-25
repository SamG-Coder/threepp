const ACTION_CODES = Object.freeze({
  forward: ["KeyW", "ArrowUp"],
  backward: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  jump: ["Space"],
  handbrake: ["Space"],
  enterExit: ["KeyF"],
  interact: ["KeyE"],
  reload: ["KeyR"],
  melee: ["KeyQ"],
  mission: ["KeyM"],
  restart: ["KeyT"],
  camera: ["KeyC"],
  horn: ["KeyH"],
  pause: ["KeyP"],
  quickSave: ["KeyK"],
  quickLoad: ["KeyL"],
});

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  const released = new Set();
  const injected = new Set();
  const injectedHeld = new Set();
  const mouseHeld = new Set();
  const mousePressed = new Set();
  const pointer = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    wheel: 0,
    locked: false,
    engaged: false,
    everLocked: false,
    justLocked: false,
    lockError: null,
  };
  let disposed = false;

  const prevent = event => event.preventDefault?.();
  const onKeyDown = event => {
    if (!held.has(event.code)) pressed.add(event.code);
    held.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) prevent(event);
  };
  const onKeyUp = event => {
    held.delete(event.code);
    released.add(event.code);
  };
  const clearHeld = () => {
    for (const code of held) released.add(code);
    held.clear();
    mouseHeld.clear();
    pointer.dx = 0;
    pointer.dy = 0;
  };
  const onPointerMove = event => {
    pointer.x = Number(event.clientX) || 0;
    pointer.y = Number(event.clientY) || 0;
    pointer.dx += Number(event.movementX) || 0;
    pointer.dy += Number(event.movementY) || 0;
  };
  const onPointerDown = event => {
    pointer.engaged = true;
    pointer.lockError = null;
    if (document.pointerLockElement !== canvas) {
      // The first click is a play/resume gesture, never an accidental shot or
      // aim transition. Pointer Lock requires a user gesture, so this is the
      // one reliable place to capture the cursor in both native and web hosts.
      canvas.requestPointerLock?.();
      prevent(event);
      return;
    }
    if (!mouseHeld.has(event.button)) mousePressed.add(event.button);
    mouseHeld.add(event.button);
    if (event.button === 2) prevent(event);
  };
  const onPointerUp = event => mouseHeld.delete(event.button);
  const onWheel = event => {
    pointer.wheel += Math.sign(Number(event.deltaY) || 0);
    prevent(event);
  };
  const onPointerLockChange = () => {
    const locked = document.pointerLockElement === canvas;
    pointer.justLocked = locked && !pointer.locked;
    pointer.locked = locked;
    pointer.everLocked ||= locked;
    if (!pointer.locked) clearHeld();
  };
  const onPointerLockError = event => {
    pointer.locked = false;
    pointer.lockError = String(event?.message ?? "pointer-lock-denied");
    clearHeld();
  };

  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("keyup", onKeyUp);
  globalThis.addEventListener("blur", clearHeld);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", prevent);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onPointerLockError);

  const codesFor = action => ACTION_CODES[action] ?? [String(action)];
  const consumeCodes = action => codesFor(action).some(code => pressed.delete(code));

  return {
    held,
    pressed,
    released,
    pointer,
    actionDown(action) {
      if (injectedHeld.has(String(action))) return true;
      if (action === "fire") return mouseHeld.has(0);
      if (action === "aim") return mouseHeld.has(2);
      return codesFor(action).some(code => held.has(code));
    },
    actionPressed(action) {
      const name = String(action);
      if (injected.delete(name)) return true;
      if (name === "fire") return mousePressed.delete(0);
      if (name === "aim") return mousePressed.delete(2);
      return consumeCodes(name);
    },
    consumeCode(code) { return pressed.delete(code); },
    movement() {
      return {
        x: Number(held.has("KeyD") || held.has("ArrowRight")) - Number(held.has("KeyA") || held.has("ArrowLeft")),
        z: Number(held.has("KeyW") || held.has("ArrowUp")) - Number(held.has("KeyS") || held.has("ArrowDown")),
      };
    },
    consumeLookDelta() {
      const look = { x: pointer.dx, y: pointer.dy, wheel: pointer.wheel };
      pointer.dx = 0;
      pointer.dy = 0;
      pointer.wheel = 0;
      return look;
    },
    injectAction(action) { injected.add(String(action)); },
    injectHeldAction(action, down = true) {
      const name = String(action);
      if (down) injectedHeld.add(name);
      else injectedHeld.delete(name);
    },
    injectLook(x = 0, y = 0, wheel = 0) {
      pointer.dx += Number(x) || 0;
      pointer.dy += Number(y) || 0;
      pointer.wheel += Number(wheel) || 0;
    },
    injectKey(code, down = true) {
      const key = String(code);
      if (down) {
        if (!held.has(key)) pressed.add(key);
        held.add(key);
      } else {
        held.delete(key);
        released.add(key);
      }
    },
    requestCapture() {
      pointer.engaged = true;
      pointer.lockError = null;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      return pointer.locked;
    },
    captureSnapshot() {
      return Object.freeze({
        locked: pointer.locked,
        engaged: pointer.engaged,
        everLocked: pointer.everLocked,
        justLocked: pointer.justLocked,
        error: pointer.lockError,
      });
    },
    endFrame() {
      pressed.clear();
      released.clear();
      mousePressed.clear();
      pointer.dx = 0;
      pointer.dy = 0;
      pointer.wheel = 0;
      pointer.justLocked = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", clearHeld);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", prevent);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("pointerlockerror", onPointerLockError);
      injectedHeld.clear();
      clearHeld();
    },
  };
}

export { ACTION_CODES };
