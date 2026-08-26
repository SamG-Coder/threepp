import * as THREE from "three/webgpu";

function metric(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "--";
}

export function createTidalDisruptionHud() {
  const canvas = document.createElement("canvas");
  canvas.width = 1152;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "Tidal Rupture in-canvas telemetry";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicNodeMaterial({
    name: "Tidal Rupture HUD composite",
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.431), material);
  mesh.name = "GPU telemetry plate";
  mesh.position.z = 2;
  mesh.renderOrder = 10_000;
  mesh.frustumCulled = false;

  let previous = "";
  let visible = true;

  function update({
    phase,
    radiusSchwarzschild,
    speedFraction,
    tidalStress,
    observedShift,
    coordinateTime,
    progress,
    paused,
    playbackRate,
    rtxLabel,
    lensing,
    autoCamera,
    fps,
    soundState,
  }) {
    const serialized = [
      phase,
      radiusSchwarzschild?.toFixed?.(2),
      speedFraction?.toFixed?.(3),
      tidalStress?.toFixed?.(2),
      observedShift?.toFixed?.(3),
      coordinateTime,
      progress?.toFixed?.(4),
      paused,
      playbackRate,
      rtxLabel,
      lensing,
      autoCamera,
      fps,
      soundState,
    ].join("|");
    if (serialized === previous) return;
    previous = serialized;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createLinearGradient(0, 0, 1080, 0);
    gradient.addColorStop(0, "rgba(1, 3, 9, 0.82)");
    gradient.addColorStop(0.72, "rgba(2, 5, 13, 0.66)");
    gradient.addColorStop(1, "rgba(2, 5, 13, 0.03)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1128, 232);
    context.fillStyle = "rgba(255, 178, 82, 0.95)";
    context.fillRect(0, 0, 7, 232);
    context.strokeStyle = "rgba(255, 207, 141, 0.26)";
    context.lineWidth = 2;
    context.strokeRect(21, 18, 1058, 180);

    context.font = "700 31px monospace";
    context.fillStyle = "#fff2dc";
    context.fillText("TIDAL RUPTURE", 46, 52);
    context.font = "700 18px monospace";
    context.fillStyle = "#ffad55";
    context.fillText(String(phase || "BOUND APPROACH"), 46, 82);
    context.font = "600 15px monospace";
    context.fillStyle = "#91b9cf";
    context.fillText("SCHWARZSCHILD / 300,000 M-SUN / E=1 / L=3.98M", 46, 108);
    context.textAlign = "right";
    context.fillStyle = String(soundState).includes("SOUND ON") ? "#b8ebff" : "#7892a2";
    context.fillText(String(soundState || "SOUND OFF / M ENABLE"), 1054, 108);
    context.textAlign = "left";

    context.font = "700 18px monospace";
    context.fillStyle = "#f6e1c5";
    context.fillText(`r ${metric(radiusSchwarzschild)} r_s`, 46, 142);
    context.fillText(`v ${metric(speedFraction, 3)} c`, 250, 142);
    context.fillText(`TIDE ${metric(tidalStress, 1)}x`, 430, 142);
    context.fillText(`g ${metric(observedShift, 3)}`, 635, 142);
    context.fillText(String(coordinateTime || "0.0 S"), 807, 142);

    const status = `${paused ? "PAUSED" : `${metric(playbackRate, 1)}X TIME-LAPSE`} / ${
      autoCamera ? "AUTO CAMERA" : "MANUAL CAMERA"
    } / ${lensing ? "GR LENSING" : "RAW VIEW"}`;
    context.font = "600 14px monospace";
    context.fillStyle = "#94aebd";
    context.fillText(status, 46, 174);
    context.fillStyle = String(rtxLabel).includes("ACTIVE") ? "#b8ebff" : "#7892a2";
    context.fillText(`${String(rtxLabel || "WEBGPU HDR")} / ${Math.round(fps || 0)} FPS`, 714, 174);

    context.fillStyle = "rgba(76, 101, 117, 0.44)";
    context.fillRect(46, 192, 1008, 3);
    context.fillStyle = "rgba(255, 170, 77, 0.95)";
    context.fillRect(46, 192, 1008 * Math.min(1, Math.max(0, progress || 0)), 3);
    context.font = "600 13px monospace";
    context.fillStyle = "rgba(160, 177, 188, 0.78)";
    context.fillText("A AUTO  1-3 SHOTS  DRAG ORBIT  WHEEL DOLLY  SPACE PAUSE  T SPEED  X LENS  M SOUND  R RESTART  H HUD", 46, 220);
    texture.needsUpdate = true;
  }

  function resize(aspect) {
    mesh.position.x = -Math.max(0.95, Number(aspect) || 1) + 1.06;
    mesh.position.y = 0.755;
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

  return Object.freeze({
    mesh,
    update,
    resize,
    setVisible,
    dispose,
    get visible() { return visible; },
  });
}
