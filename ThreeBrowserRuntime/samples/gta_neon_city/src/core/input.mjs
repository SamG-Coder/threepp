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
  weaponPistol: ["Digit1"],
  weaponMinigun: ["Digit2"],
  melee: ["KeyQ"],
  mission: ["KeyM"],
  phone: ["Tab"],
  restart: ["KeyT"],
  camera: ["KeyC"],
  horn: ["KeyH"],
  pause: ["KeyP"],
  quickSave: ["KeyK"],
  quickLoad: ["KeyL"],
});

const DEFAULT_ACTION_BUFFER_MS = 240;
const DEFAULT_ACTION_BUFFER_FRAMES = 12;

export function createInput(canvas, options = {}) {
  const held = new Set();
  const pressed = new Set();
  const released = new Set();
  const injectedHeld = new Set();
  const mouseHeld = new Set();
  const keyEdges = [];
  const injectedEdges = [];
  const mouseEdges = [];
  const mouseReleased = new Set();
  const now = typeof options.now === "function"
    ? options.now
    : () => Number(globalThis.performance?.now?.() ?? Date.now());
  const actionBufferMs = Math.max(0, Number(options.actionBufferMs ?? DEFAULT_ACTION_BUFFER_MS) || 0);
  const actionBufferFrames = Math.max(
    1,
    Math.trunc(Number(options.actionBufferFrames ?? DEFAULT_ACTION_BUFFER_FRAMES) || 0),
  );
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
  let inputFrame = 0;
  let disposed = false;
  let uiPointerMode = false;

  const addEdge = (queue, value, mirror = null) => {
    queue.push({ value, time: Number(now()) || 0, frame: inputFrame });
    mirror?.add(value);
  };
  const edgeExpired = (edge, currentTime) =>
    inputFrame - edge.frame >= actionBufferFrames || currentTime - edge.time >= actionBufferMs;
  const syncMirrorValue = (queue, mirror, value) => {
    if (!mirror) return;
    if (queue.some(edge => edge.value === value)) mirror.add(value);
    else mirror.delete(value);
  };
  const pruneEdges = (queue, mirror = null, currentTime = Number(now()) || 0) => {
    for (let index = queue.length - 1; index >= 0; --index) {
      const edge = queue[index];
      if (!edgeExpired(edge, currentTime)) continue;
      queue.splice(index, 1);
      syncMirrorValue(queue, mirror, edge.value);
    }
  };
  const consumeEdge = (queue, predicate, mirror = null) => {
    pruneEdges(queue, mirror);
    const index = queue.findIndex(edge => predicate(edge.value));
    if (index < 0) return false;
    const [edge] = queue.splice(index, 1);
    syncMirrorValue(queue, mirror, edge.value);
    return true;
  };
  const clearEdges = (queue, mirror = null) => {
    queue.length = 0;
    mirror?.clear();
  };

  const prevent = event => event.preventDefault?.();
  const onKeyDown = event => {
    if (!held.has(event.code)) addEdge(keyEdges, event.code, pressed);
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
    pointer.wheel = 0;
  };
  const clearPhysicalInput = () => {
    clearHeld();
    clearEdges(keyEdges, pressed);
    clearEdges(mouseEdges);
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
    if (uiPointerMode) {
      if (!mouseHeld.has(event.button)) addEdge(mouseEdges, event.button);
      mouseHeld.add(event.button);
      prevent(event);
      return;
    }
    if (document.pointerLockElement !== canvas) {
      // The first click is a play/resume gesture, never an accidental shot or
      // aim transition. Pointer Lock requires a user gesture, so this is the
      // one reliable place to capture the cursor in both native and web hosts.
      canvas.requestPointerLock?.();
      prevent(event);
      return;
    }
    if (!mouseHeld.has(event.button)) addEdge(mouseEdges, event.button);
    mouseHeld.add(event.button);
    if (event.button === 2) prevent(event);
  };
  const onPointerUp = event => {
    if (mouseHeld.has(event.button)) mouseReleased.add(event.button);
    mouseHeld.delete(event.button);
  };
  const onWheel = event => {
    pointer.wheel += Math.sign(Number(event.deltaY) || 0);
    prevent(event);
  };
  const onPointerLockChange = () => {
    const locked = document.pointerLockElement === canvas;
    pointer.justLocked = locked && !pointer.locked;
    pointer.locked = locked;
    pointer.everLocked ||= locked;
    if (!pointer.locked) clearPhysicalInput();
  };
  const onPointerLockError = event => {
    pointer.locked = false;
    pointer.lockError = String(event?.message ?? "pointer-lock-denied");
    clearPhysicalInput();
  };

  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("keyup", onKeyUp);
  globalThis.addEventListener("blur", clearPhysicalInput);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", prevent);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onPointerLockError);

  const codesFor = action => ACTION_CODES[action] ?? [String(action)];
  const consumeCodes = action => {
    const codes = codesFor(action);
    return consumeEdge(keyEdges, code => codes.includes(code), pressed);
  };

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
      if (consumeEdge(injectedEdges, value => value === name)) return true;
      if (name === "fire") return consumeEdge(mouseEdges, button => button === 0);
      if (name === "aim") return consumeEdge(mouseEdges, button => button === 2);
      return consumeCodes(name);
    },
    actionReleased(action) {
      const name = String(action);
      const button = name === "fire" ? 0 : name === "aim" ? 2 : null;
      if (button !== null && mouseReleased.has(button)) {
        mouseReleased.delete(button);
        return true;
      }
      return false;
    },
    consumeCode(code) {
      const key = String(code);
      return consumeEdge(keyEdges, value => value === key, pressed);
    },
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
    consumeWheel() {
      const wheel = pointer.wheel;
      pointer.wheel = 0;
      return wheel;
    },
    injectAction(action) { addEdge(injectedEdges, String(action)); },
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
    setUiPointerMode(value) {
      uiPointerMode = Boolean(value);
      if (canvas.style) canvas.style.cursor = uiPointerMode ? "default" : "none";
      if (uiPointerMode && document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!uiPointerMode) mouseHeld.clear();
      return uiPointerMode;
    },
    get uiPointerMode() { return uiPointerMode; },
    injectKey(code, down = true) {
      const key = String(code);
      if (down) {
        if (!held.has(key)) addEdge(keyEdges, key, pressed);
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
    endFrame({ simulationAdvanced = true } = {}) {
      // Native WebGPU may present several frames between 60 Hz simulation
      // ticks. Keep one-shot actions and mouse motion intact until gameplay
      // has actually had a chance to consume them.
      if (!simulationAdvanced) return;
      inputFrame += 1;
      const currentTime = Number(now()) || 0;
      pruneEdges(keyEdges, pressed, currentTime);
      pruneEdges(injectedEdges, null, currentTime);
      pruneEdges(mouseEdges, null, currentTime);
      released.clear();
      mouseReleased.clear();
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
      globalThis.removeEventListener("blur", clearPhysicalInput);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", prevent);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("pointerlockerror", onPointerLockError);
      injectedHeld.clear();
      clearEdges(injectedEdges);
      clearPhysicalInput();
    },
  };
}

export { ACTION_CODES };
