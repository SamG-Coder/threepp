export function createHud() {
  const root = document.createElement("div");
  root.setAttribute("aria-label", "Morpho Iridescence X10000 renderer and biology status");
  Object.assign(root.style, {
    position: "fixed",
    left: "clamp(14px,2.2vw,38px)",
    top: "clamp(14px,2.2vw,34px)",
    zIndex: "10",
    color: "#e8f7ff",
    fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace",
    textShadow: "0 0 18px rgba(77,167,255,.82)",
    pointerEvents: "none",
    userSelect: "none",
    letterSpacing: ".08em",
  });

  const title = document.createElement("div");
  title.textContent = "MORPHO IRIDESCENCE  ·  RTX ×10000";
  Object.assign(title.style, {
    fontSize: "clamp(14px,1.32vw,23px)",
    fontWeight: "850",
    letterSpacing: ".18em",
  });
  const status = document.createElement("div");
  Object.assign(status.style, {
    marginTop: "7px",
    color: "#9fdcff",
    fontSize: "clamp(9px,.72vw,12px)",
    lineHeight: "1.68",
    whiteSpace: "pre-line",
  });
  const controls = document.createElement("div");
  controls.textContent = "MOVE GAZE / LIGHT  ·  DRAG ORBIT  ·  WHEEL ×1–×10000\nSPACE FLAP  ·  L LIGHT RIG  ·  P PAUSE  ·  X RTX  ·  R RESET";
  Object.assign(controls.style, {
    marginTop: "9px",
    padding: "8px 11px",
    borderLeft: "2px solid rgba(82,190,255,.82)",
    background: "linear-gradient(90deg,rgba(2,9,20,.76),rgba(2,9,20,0))",
    color: "rgba(225,245,255,.78)",
    fontSize: "clamp(8px,.62vw,10px)",
    lineHeight: "1.68",
    whiteSpace: "pre-line",
  });
  root.append(title, status, controls);
  document.body.append(root);

  return Object.freeze({
    update(worldStats, renderStatus, state) {
      const path = String(renderStatus.lastPresentedPath ?? renderStatus.lastPath ?? "starting")
        .replaceAll("-", " ").toUpperCase();
      const native = state.nativeConfigured && !state.forceRaster ? "NATIVE RAYS" : "EXACT WEBGPU";
      status.textContent =
        `DETAIL ×${Math.max(1, Math.round(state.magnification)).toLocaleString()}  ·  ${native}  ·  ${path}\n` +
        `${worldStats.photonicScales.toLocaleString()} PHOTONIC SCALES  ·  ${worldStats.ommatidia.toLocaleString()} OMMATIDIA  ·  PEAK ${worldStats.peakWavelengthNm.toFixed(0)} NM\n` +
        `${worldStats.studioRigName}  ·  ${state.paused ? "BIOLOGY FROZEN" : "HOVER LIVE"}  ·  SEED ${worldStats.seedHex}`;
    },
    dispose() { root.remove(); },
  });
}
