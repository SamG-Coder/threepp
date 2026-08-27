const MOVEMENT_CODES = new Set([
  "KeyA", "KeyD", "KeyW", "KeyS",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "ShiftLeft", "ShiftRight", "Space", "ControlLeft", "ControlRight",
]);

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0 };
  let flyMode = false;

  function onKeyDown(event) {
    if (!held.has(event.code)) pressed.add(event.code);
    held.add(event.code);
    if (MOVEMENT_CODES.has(event.code)) event.preventDefault();
  }

  function onKeyUp(event) {
    held.delete(event.code);
    if (MOVEMENT_CODES.has(event.code)) event.preventDefault();
  }

  function onBlur() {
    held.clear();
    pressed.clear();
    mouse.x = 0;
    mouse.y = 0;
  }

  function onMouseMove(event) {
    if (!flyMode) return;
    mouse.x += Number(event.movementX) || 0;
    mouse.y += Number(event.movementY) || 0;
  }

  function onCanvasClick() {
    if (flyMode && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  }

  globalThis.addEventListener("keydown", onKeyDown, { passive: false });
  globalThis.addEventListener("keyup", onKeyUp, { passive: false });
  globalThis.addEventListener("blur", onBlur);
  globalThis.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("click", onCanvasClick);

  function down(...codes) {
    return codes.some(code => held.has(code));
  }

  return {
    get flyMode() {
      return flyMode;
    },
    setFlyMode(enabled) {
      flyMode = Boolean(enabled);
      mouse.x = 0;
      mouse.y = 0;
      if (!flyMode && document.pointerLockElement === canvas) document.exitPointerLock?.();
    },
    consume(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    walkAxis() {
      const x = (down("KeyD", "ArrowRight") ? 1 : 0) - (down("KeyA", "ArrowLeft") ? 1 : 0);
      const z = (down("KeyW", "ArrowUp") ? 1 : 0) - (down("KeyS", "ArrowDown") ? 1 : 0);
      const length = Math.hypot(x, z);
      const scale = length > 1 ? 1 / length : 1;
      return {
        x: x * scale,
        z: z * scale,
        boost: down("ShiftLeft", "ShiftRight"),
      };
    },
    flyAxis() {
      const x = (down("KeyD") ? 1 : 0) - (down("KeyA") ? 1 : 0);
      const forward = (down("KeyW") ? 1 : 0) - (down("KeyS") ? 1 : 0);
      const vertical = (down("Space") ? 1 : 0) - (down("ControlLeft", "ControlRight") ? 1 : 0);
      return {
        x,
        forward,
        vertical,
        boost: down("ShiftLeft", "ShiftRight"),
      };
    },
    takeMouseDelta() {
      const result = { x: mouse.x, y: mouse.y };
      mouse.x = 0;
      mouse.y = 0;
      return result;
    },
    dispose() {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", onBlur);
      globalThis.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onCanvasClick);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    },
  };
}
