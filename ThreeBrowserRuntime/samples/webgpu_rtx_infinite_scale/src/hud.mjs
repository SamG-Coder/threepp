import * as THREE from "three/webgpu";

const GLYPHS = Object.freeze({
  " ": ["000", "000", "000", "000", "000"],
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"], J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"], P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"], V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"],
  2: ["110", "001", "010", "100", "111"], 3: ["110", "001", "010", "001", "110"],
  4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "110", "001", "110"],
  6: ["011", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "110"],
  ":": ["000", "010", "000", "010", "000"], ".": ["000", "000", "000", "000", "010"],
  "-": ["000", "000", "111", "000", "000"], "/": ["001", "001", "010", "100", "100"],
  "+": ["000", "010", "111", "010", "000"], "?": ["110", "001", "010", "000", "010"],
  "×": ["000", "101", "010", "101", "000"], "μ": ["000", "000", "101", "101", "111"],
  "Å": ["010", "010", "101", "111", "101"], "—": ["000", "000", "111", "000", "000"],
  "⁻": ["000", "000", "110", "000", "000"], "⁰": ["110", "101", "110", "000", "000"],
  "¹": ["010", "110", "010", "000", "000"], "²": ["110", "001", "111", "000", "000"],
  "³": ["110", "011", "110", "000", "000"], "⁴": ["101", "111", "001", "000", "000"],
  "⁵": ["111", "110", "011", "000", "000"], "⁶": ["011", "110", "111", "000", "000"],
  "⁷": ["111", "001", "010", "000", "000"], "⁸": ["111", "111", "111", "000", "000"],
  "⁹": ["111", "111", "001", "000", "000"],
});

const CELL_WIDTH = 5;
const ATLAS_WIDTH = 512;
const ATLAS_HEIGHT = 8;

function createFontAtlas() {
  const bytes = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const cells = new Map();
  let cell = 0;
  for (const [character, rows] of Object.entries(GLYPHS)) {
    const originX = cell * CELL_WIDTH;
    cells.set(character, { x: originX });
    for (let row = 0; row < 5; ++row) {
      for (let column = 0; column < 3; ++column) {
        if (rows[row][column] !== "1") continue;
        const offset = ((row + 1) * ATLAS_WIDTH + originX + column + 1) * 4;
        bytes[offset] = bytes[offset + 1] = bytes[offset + 2] = bytes[offset + 3] = 255;
      }
    }
    cell += 1;
  }
  const texture = new THREE.DataTexture(bytes, ATLAS_WIDTH, ATLAS_HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Infinite Descent project-owned bitmap font";
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, cells };
}

function normalizedCharacter(raw) {
  if (GLYPHS[raw]) return raw;
  const upper = String(raw).toUpperCase();
  return GLYPHS[upper] ? upper : "?";
}

function writeTextGeometry(geometry, text, atlas, pixelSize = 2, tracking = 1, capacity = 128) {
  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  const width = 3 * pixelSize;
  const height = 5 * pixelSize;
  const advance = (3 + tracking) * pixelSize;
  let cursor = 0;
  let glyph = 0;
  for (const raw of String(text).slice(0, capacity)) {
    const character = normalizedCharacter(raw);
    const cell = atlas.cells.get(character);
    if (character !== " ") {
      const vertex = glyph * 4;
      positionAttribute.setXYZ(vertex, cursor, 0, 0);
      positionAttribute.setXYZ(vertex + 1, cursor + width, 0, 0);
      positionAttribute.setXYZ(vertex + 2, cursor + width, height, 0);
      positionAttribute.setXYZ(vertex + 3, cursor, height, 0);
      const u0 = (cell.x + 1) / ATLAS_WIDTH;
      const u1 = (cell.x + 4) / ATLAS_WIDTH;
      uvAttribute.setXY(vertex, u0, 1 / ATLAS_HEIGHT);
      uvAttribute.setXY(vertex + 1, u1, 1 / ATLAS_HEIGHT);
      uvAttribute.setXY(vertex + 2, u1, 6 / ATLAS_HEIGHT);
      uvAttribute.setXY(vertex + 3, u0, 6 / ATLAS_HEIGHT);
      glyph += 1;
    }
    cursor += advance;
  }
  positionAttribute.needsUpdate = true;
  uvAttribute.needsUpdate = true;
  geometry.setDrawRange(0, glyph * 6);
  return { width: Math.max(0, cursor - tracking * pixelSize), height };
}

function textGeometry(text, atlas, pixelSize = 2, tracking = 1, capacity = 128) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
  const uvs = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 2), 2);
  positions.setUsage(THREE.DynamicDrawUsage);
  uvs.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("uv", uvs);
  const indices = new Uint16Array(capacity * 6);
  for (let glyph = 0; glyph < capacity; ++glyph) {
    const vertex = glyph * 4;
    const offset = glyph * 6;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], offset);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry, ...writeTextGeometry(geometry, text, atlas, pixelSize, tracking, capacity), capacity };
}

function makeText(text, atlas, color, pixelSize = 2, opacity = 1, order = 1002, capacity = 128) {
  const shaped = textGeometry(text, atlas, pixelSize, 1, capacity);
  const material = new THREE.MeshBasicNodeMaterial({
    map: atlas.texture,
    color,
    transparent: true,
    opacity,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(shaped.geometry, material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  Object.assign(mesh.userData, {
    text,
    pixelSize,
    width: shaped.width,
    height: shaped.height,
    capacity: shaped.capacity,
  });
  return mesh;
}

function setText(mesh, text, atlas) {
  if (mesh.userData.text === text) return;
  const value = String(text);
  if (value.length > mesh.userData.capacity) {
    const capacity = Math.max(value.length, mesh.userData.capacity * 2);
    const shaped = textGeometry(value, atlas, mesh.userData.pixelSize, 1, capacity);
    mesh.geometry.dispose();
    mesh.geometry = shaped.geometry;
    Object.assign(mesh.userData, { capacity: shaped.capacity, width: shaped.width, height: shaped.height });
  } else {
    const shaped = writeTextGeometry(
      mesh.geometry,
      value,
      atlas,
      mesh.userData.pixelSize,
      1,
      mesh.userData.capacity,
    );
    Object.assign(mesh.userData, { width: shaped.width, height: shaped.height });
  }
  mesh.userData.text = value;
}

function panel(width, height, color, opacity, order = 1000) {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  Object.assign(mesh.userData, { width, height });
  return mesh;
}

function place(mesh, x, y) {
  mesh.position.set(x + mesh.userData.width * 0.5, y + mesh.userData.height * 0.5, 0);
}

function activeRtxLabel(status = {}, nativeFrame = false) {
  const active = [];
  if (nativeFrame && status.nativeRayTracingActive) active.push("RAYS");
  if (nativeFrame && status.rayReconstructionActive) active.push("RR");
  else if (nativeFrame && status.superResolutionActive) active.push("DLSS");
  if (nativeFrame && status.frameGenerationActive) active.push("FG");
  if (status.reflexActive) active.push("REFLEX");
  if (active.length) return `RTX ${active.join(" / ")} ACTIVE`;
  if (nativeFrame && (status.rayReconstructionRequested || status.superResolutionRequested)) return "RTX ADAPTIVE WARMUP";
  return nativeFrame ? "RTX RAY PATH WARMUP" : "RASTER DOMAIN";
}

export function createInfiniteScaleHud({ renderer, onKey = null } = {}) {
  const atlas = createFontAtlas();
  const scene = new THREE.Scene();
  scene.name = "Infinite Descent in-canvas HUD";
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  camera.position.z = 5;
  const target = new THREE.RenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  target.texture.name = "Infinite Descent transparent HUD";

  const root = new THREE.Group();
  const cinematic = new THREE.Group();
  const debug = new THREE.Group();
  root.add(cinematic, debug);
  scene.add(root);
  debug.visible = false;

  const scaleBackdrop = panel(268, 86, 0x02050a, 0.52);
  const scaleAccent = panel(3, 86, 0xe39048, 0.95, 1003);
  const scaleText = makeText("4.47 m", atlas, 0xf4e4d0, 5, 1);
  const domainText = makeText("FORGE", atlas, 0x9bbcd0, 2, 0.94);
  const rtxText = makeText("RASTER DOMAIN", atlas, 0x7794a4, 2, 0.88);
  const footerText = makeText("SPACE PAUSE  R REVERSE  WHEEL SPEED  D CONTROLS", atlas, 0x81929d, 2, 0.68);
  const progressTrack = panel(1, 2, 0x21313e, 0.66);
  const progressFill = panel(1, 2, 0xe39048, 0.92, 1003);
  cinematic.add(scaleBackdrop, scaleAccent, scaleText, domainText, rtxText, footerText, progressTrack, progressFill);

  const debugBackdrop = panel(388, 196, 0x02050a, 0.86);
  const debugAccent = panel(3, 196, 0x6eb6d5, 0.95, 1003);
  const debugTitle = makeText("DESCENT CONTROL", atlas, 0xe1edf1, 3, 1);
  const debugLines = [
    makeText("AUTO / PLAYING / 1.00X", atlas, 0x9fc9da, 2, 0.92),
    makeText("DOMAIN 1/7 / REBASE 0", atlas, 0xb8c4c8, 2, 0.88),
    makeText("STREAM PREV / CURRENT / NEXT", atlas, 0xb8c4c8, 2, 0.88),
    makeText("1-7 JUMP / +/- SPEED / H HIDE", atlas, 0x8da1a8, 2, 0.82),
    makeText("D CLOSE CONTROLS", atlas, 0x8da1a8, 2, 0.82),
  ];
  debug.add(debugBackdrop, debugAccent, debugTitle, ...debugLines);

  let width = 1;
  let height = 1;
  let debugVisible = false;
  let visible = true;
  let stateKey = "";

  function resize(nextWidth, nextHeight) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    target.setSize(width, height);

    place(scaleBackdrop, 24, 24);
    place(scaleAccent, 24, 24);
    scaleText.position.set(44, 42, 0.3);
    domainText.position.set(44, 76, 0.3);
    rtxText.position.set(Math.max(24, width - rtxText.userData.width - 24), 30, 0.3);
    footerText.position.set(24, height - 27, 0.3);
    const trackWidth = Math.max(1, width - 48);
    progressTrack.scale.x = trackWidth;
    progressTrack.position.set(24 + trackWidth * 0.5, height - 7, 0);
    progressFill.position.set(24, height - 7, 0);

    const debugX = Math.max(24, width - 412);
    place(debugBackdrop, debugX, 62);
    place(debugAccent, debugX, 62);
    debugTitle.position.set(debugX + 22, 80, 0.3);
    debugLines.forEach((line, index) => line.position.set(debugX + 22, 116 + index * 25, 0.3));
    footerText.visible = width > 700;
  }

  function update(state) {
    const label = activeRtxLabel(state.rtxStatus, state.nativeFrame);
    const key = [
      state.scale,
      state.domain,
      label,
      state.paused,
      state.direction,
      Number(state.speed).toFixed(2),
      state.index,
      state.rebaseCount,
      state.progress?.toFixed(4),
      state.fps,
    ].join("|");
    if (key === stateKey) return;
    stateKey = key;
    setText(scaleText, state.scale, atlas);
    setText(domainText, state.domain, atlas);
    setText(rtxText, label, atlas);
    rtxText.material.color.set(label.includes("ACTIVE") ? 0x82d5e5 : 0x7794a4);
    rtxText.position.x = Math.max(24, width - rtxText.userData.width - 24);
    const fillWidth = Math.max(0.001, width - 48) * Math.min(1, Math.max(0, state.progress ?? 0));
    progressFill.scale.x = fillWidth;
    progressFill.position.x = 24 + fillWidth * 0.5;
    setText(
      debugLines[0],
      `${state.paused ? "PAUSED" : "AUTO"} / ${state.direction < 0 ? "REVERSE" : "DESCENDING"} / ${Number(state.speed).toFixed(2)}X`,
      atlas,
    );
    setText(debugLines[1], `DOMAIN ${(state.index ?? 0) + 1}/7 / REBASE ${state.rebaseCount ?? 0} / ${state.fps ?? 0} FPS`, atlas);
    const streams = (state.streaming ?? [])
      .filter(item => item.state !== "dormant")
      .map(item => `${item.id.toUpperCase()}:${String(item.state).replace("warm-", "")}`)
      .join(" / ");
    setText(debugLines[2], streams || "STREAM INITIALIZING", atlas);
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "d") {
      debugVisible = !debugVisible;
      debug.visible = debugVisible;
      event.preventDefault?.();
    } else if (key === "h") {
      visible = !visible;
      root.visible = visible;
      event.preventDefault?.();
    }
    onKey?.(key, event);
  }
  globalThis.addEventListener("keydown", onKeyDown);

  resize(renderer.getSize(new THREE.Vector2()).x, renderer.getSize(new THREE.Vector2()).y);
  const savedClearColor = new THREE.Color();

  function renderToTexture() {
    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT();
    const previousColor = renderer.getClearColor(savedClearColor);
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.setMRT(null);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.clear(true, false, false);
    if (visible) renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setMRT(previousMrt);
    renderer.setClearColor(previousColor, previousAlpha);
    renderer.autoClear = previousAutoClear;
    return target.texture;
  }

  return {
    scene,
    camera,
    target,
    update,
    resize,
    renderToTexture,
    render() { if (visible) renderer.render(scene, camera); },
    dispose() {
      globalThis.removeEventListener("keydown", onKeyDown);
      atlas.texture.dispose();
      target.dispose();
      scene.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    },
  };
}
