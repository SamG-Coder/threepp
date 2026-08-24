const ACTION_CODES = Object.freeze({
  jump: ["Space"],
  dodge: ["AltLeft", "AltRight"],
  interact: ["KeyE"],
  heavyAttack: ["KeyQ"],
  lockOn: ["KeyF"],
  quickItem: ["KeyR"],
  inventory: ["KeyI"],
  equipment: ["KeyU"],
  crafting: ["KeyC"],
  dialogueAdvance: ["Enter"],
  questLog: ["KeyJ"],
  settings: ["KeyO"],
  cancel: ["Escape"],
  quickSave: ["KeyK"],
  quickLoad: ["KeyL"],
  moveForward: ["KeyW", "ArrowUp"],
  moveBackward: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  nextWeapon: ["KeyX"],
});

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  const released = new Set();
  const injectedActions = new Set();
  const mouseHeld = new Set();
  const mousePressed = new Set();
  const pointer = { dx: 0, dy: 0, wheel: 0, x: 0, y: 0, locked: false };
  let disposed = false;

  const prevent = event => event.preventDefault?.();
  const onKeyDown = event => {
    if (!held.has(event.code)) pressed.add(event.code);
    held.add(event.code);
    if (["Space", "AltLeft", "AltRight"].includes(event.code)) prevent(event);
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
    if (!mouseHeld.has(event.button)) mousePressed.add(event.button);
    mouseHeld.add(event.button);
    if (event.button === 0 && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
    if (event.button === 2) prevent(event);
  };
  const onPointerUp = event => mouseHeld.delete(event.button);
  const onWheel = event => {
    pointer.wheel += Math.sign(Number(event.deltaY) || 0);
    prevent(event);
  };
  const onPointerLockChange = () => {
    pointer.locked = document.pointerLockElement === canvas;
    if (!pointer.locked) clearHeld();
  };
  const onBlur = clearHeld;

  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("keyup", onKeyUp);
  globalThis.addEventListener("blur", onBlur);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", prevent);
  document.addEventListener("pointerlockchange", onPointerLockChange);

  function actionPressed(name) {
    if (injectedActions.delete(name)) return true;
    if (name === "lightAttack" && !held.has("ShiftLeft") && !held.has("ShiftRight")) {
      return mousePressed.delete(0);
    }
    if (name === "heavyAttack") {
      if ((held.has("ShiftLeft") || held.has("ShiftRight")) && mousePressed.delete(0)) return true;
      return (ACTION_CODES.heavyAttack ?? []).some(code => pressed.delete(code));
    }
    return (ACTION_CODES[name] ?? []).some(code => pressed.delete(code));
  }

  function actionDown(name) {
    if (name === "block") return mouseHeld.has(2);
    return (ACTION_CODES[name] ?? [name]).some(code => held.has(code));
  }

  return {
    held,
    pointer,
    isDown(codeOrAction) {
      return held.has(codeOrAction) || actionDown(codeOrAction);
    },
    consumeCode(code) {
      return pressed.delete(code);
    },
    actionPressed,
    actionDown,
    consumePressed(name) {
      return actionPressed(name);
    },
    consumeLookDelta() {
      return { x: pointer.dx, y: pointer.dy };
    },
    movement() {
      return {
        x: Number(held.has("KeyD")) - Number(held.has("KeyA")),
        z: Number(held.has("KeyW")) - Number(held.has("KeyS")),
      };
    },
    injectAction(name) {
      injectedActions.add(String(name));
    },
    injectKey(code, down) {
      if (down) {
        if (!held.has(code)) pressed.add(code);
        held.add(code);
      } else {
        held.delete(code);
        released.add(code);
      }
    },
    endFrame() {
      pressed.clear();
      released.clear();
      mousePressed.clear();
      pointer.dx = 0;
      pointer.dy = 0;
      pointer.wheel = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", prevent);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      clearHeld();
    },
  };
}
