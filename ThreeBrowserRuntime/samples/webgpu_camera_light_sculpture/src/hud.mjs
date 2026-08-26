import * as THREE from "three/webgpu";

export const GESTURE_LEGEND = Object.freeze([
  "POINT = FOLLOW",
  "CLOSED = CHARGE",
  "OPEN = RELEASE",
  "SWIPE = THROW",
]);

function controlsOnly(hint) {
  return String(hint || "")
    .split(/\s*(?:•|\/)\s*/)
    .map(part => part.trim())
    .filter(part => !/^(?:POINT|CLOSED|OPEN|SWIPE|FAST SWIPE)\b/i.test(part))
    .filter(Boolean)
    .join(" / ");
}

export function createLightSculptureHud() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 200;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicNodeMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.316), material);
  mesh.position.z = 2;
  mesh.renderOrder = 20;
  mesh.frustumCulled = false;

  let previous = "";
  let visible = true;

  function update({ status, detail = "", hint = "", gestures = [] }) {
    const compactHint = controlsOnly(hint);
    const activeGestures = new Set(
      (Array.isArray(gestures) ? gestures : [gestures])
        .map(value => String(value || "").trim().toUpperCase())
        .filter(Boolean),
    );
    const serialized = [status, detail, compactHint, ...activeGestures].join("\n");
    if (serialized === previous) return;
    previous = serialized;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(3, 2, 12, 0.70)";
    context.fillRect(0, 0, 1000, 188);
    context.fillStyle = "rgba(221, 61, 255, 0.90)";
    context.fillRect(0, 0, 8, 188);
    context.strokeStyle = "rgba(199, 116, 255, 0.38)";
    context.lineWidth = 2;
    context.strokeRect(20, 16, 958, 156);

    context.font = "700 31px monospace";
    context.fillStyle = "#fff3ff";
    context.fillText("LIGHT SCULPTURE", 44, 47);
    context.font = "700 19px monospace";
    context.fillStyle = "#ee78ff";
    context.fillText(String(status || ""), 44, 79);
    context.font = "600 16px monospace";
    context.fillStyle = "#b9a8d1";
    context.fillText(String(detail || ""), 44, 106);

    function drawGesture(text, key, x, width, colour) {
      const active = activeGestures.has(key);
      if (active) {
        context.fillStyle = "rgba(255, 79, 231, 0.22)";
        context.fillRect(x - 10, 116, width, 28);
        context.strokeStyle = colour;
        context.lineWidth = 2;
        context.strokeRect(x - 10, 116, width, 28);
      }
      context.font = `${active ? 800 : 700} 15px monospace`;
      context.fillStyle = active ? "#ffffff" : colour;
      context.fillText(`${active ? "> " : "  "}${text}`, x, 137);
    }
    drawGesture(GESTURE_LEGEND[0], "POINT", 44, 208, "#8eeeff");
    drawGesture(GESTURE_LEGEND[1], "CLOSED", 283, 211, "#d59bff");
    drawGesture(GESTURE_LEGEND[2], "OPEN", 526, 195, "#ff70dd");
    drawGesture(GESTURE_LEGEND[3], "SWIPE", 752, 204, "#ffd7fb");

    context.font = "600 15px monospace";
    context.fillStyle = /^CAMERA:/i.test(compactHint) ? "#ffadc4" : "#887b9e";
    context.fillText(compactHint, 44, 163);
    texture.needsUpdate = true;
  }

  function resize(aspect) {
    mesh.position.x = -Math.max(0.95, Number(aspect) || 1) + 0.89;
    mesh.position.y = 0.795;
  }

  function setVisible(next) {
    visible = Boolean(next);
    mesh.visible = visible;
  }

  function dispose() {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return Object.freeze({ mesh, update, resize, setVisible, dispose, get visible() { return visible; } });
}
