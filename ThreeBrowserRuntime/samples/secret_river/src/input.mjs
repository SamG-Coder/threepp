export function createInput() {
  const keys = new Set();

  function bind(event) {
    const code = String(event.code || "");
    const key = String(event.key || "").toLowerCase();
    if (event.type === "keydown") {
      keys.add(code);
      if (key) keys.add(key);
    } else {
      keys.delete(code);
      keys.delete(key);
    }
  }

  globalThis.addEventListener("keydown", bind);
  globalThis.addEventListener("keyup", bind);

  return {
    axis() {
      let x = 0;
      let z = 0;
      if (keys.has("KeyA") || keys.has("ArrowLeft") || keys.has("a")) x -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight") || keys.has("d")) x += 1;
      if (keys.has("KeyW") || keys.has("ArrowUp") || keys.has("w")) z += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown") || keys.has("s")) z -= 1;
      const length = Math.hypot(x, z);
      if (length > 1) {
        x /= length;
        z /= length;
      }
      return {
        x,
        z,
        sprint: keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("shift"),
      };
    },
    wasPressed(code) {
      return keys.has(code);
    },
    dispose() {
      globalThis.removeEventListener("keydown", bind);
      globalThis.removeEventListener("keyup", bind);
      keys.clear();
    },
  };
}
