import * as THREE from "three/webgpu";

// A deliberately tiny 3x5 bitmap alphabet. The atlas is generated directly
// into RGBA bytes so the native Runtime never depends on DOM, CSS, Canvas2D,
// browser fonts or HTML painting for its visible controls.
const GLYPHS = Object.freeze({
  " ": ["000", "000", "000", "000", "000"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["110", "001", "010", "100", "111"],
  3: ["110", "001", "010", "001", "110"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "110", "001", "110"],
  6: ["011", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "110"],
  ":": ["000", "010", "000", "010", "000"],
  ".": ["000", "000", "000", "000", "010"],
  "-": ["000", "000", "111", "000", "000"],
  "/": ["001", "001", "010", "100", "100"],
  "+": ["000", "010", "111", "010", "000"],
  "?": ["110", "001", "010", "000", "010"],
});

const CELL_WIDTH = 5;
const CELL_HEIGHT = 7;
const ATLAS_WIDTH = 256;
const ATLAS_HEIGHT = 8;

function createFontAtlas() {
  const bytes = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const cells = new Map();
  let cell = 0;

  for (const [character, rows] of Object.entries(GLYPHS)) {
    const originX = cell * CELL_WIDTH;
    cells.set(character, { x: originX, y: 0 });
    for (let row = 0; row < 5; ++row) {
      for (let column = 0; column < 3; ++column) {
        if (rows[row][column] !== "1") continue;
        const x = originX + column + 1;
        const y = row + 1;
        const offset = (y * ATLAS_WIDTH + x) * 4;
        bytes[offset] = 255;
        bytes[offset + 1] = 255;
        bytes[offset + 2] = 255;
        bytes[offset + 3] = 255;
      }
    }
    cell += 1;
  }

  const texture = new THREE.DataTexture(
    bytes,
    ATLAS_WIDTH,
    ATLAS_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "JS-generated 3x5 HUD font atlas";
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, cells };
}

function textGeometry(text, atlas, pixelSize = 2, tracking = 1) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const glyphWidth = 3 * pixelSize;
  const glyphHeight = 5 * pixelSize;
  const advance = (3 + tracking) * pixelSize;
  let cursor = 0;

  for (const rawCharacter of String(text).toUpperCase()) {
    const character = GLYPHS[rawCharacter] ? rawCharacter : "?";
    const cell = atlas.cells.get(character);
    if (character !== " ") {
      const base = positions.length / 3;
      positions.push(
        cursor, 0, 0,
        cursor + glyphWidth, 0, 0,
        cursor + glyphWidth, glyphHeight, 0,
        cursor, glyphHeight, 0,
      );

      const u0 = (cell.x + 1) / ATLAS_WIDTH;
      const u1 = (cell.x + 4) / ATLAS_WIDTH;
      const v0 = 1 / ATLAS_HEIGHT;
      const v1 = 6 / ATLAS_HEIGHT;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    cursor += advance;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  return { geometry, width: Math.max(0, cursor - tracking * pixelSize), height: glyphHeight };
}

function makeText(text, atlas, color, pixelSize = 2, opacity = 1) {
  const { geometry, width, height } = textGeometry(text, atlas, pixelSize);
  const material = new THREE.MeshBasicNodeMaterial({
    map: atlas.texture,
    color,
    transparent: true,
    opacity,
    alphaTest: 0.4,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1002;
  mesh.frustumCulled = false;
  mesh.userData.width = width;
  mesh.userData.height = height;
  mesh.userData.pixelSize = pixelSize;
  mesh.userData.text = text;
  return mesh;
}

function setText(mesh, text, atlas) {
  if (mesh.userData.text === text) return;
  const { geometry, width, height } = textGeometry(
    text,
    atlas,
    mesh.userData.pixelSize ?? 2,
  );
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.userData.width = width;
  mesh.userData.height = height;
  mesh.userData.text = text;
}

function makePanel(width, height, color, opacity, order = 1000) {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  mesh.userData.width = width;
  mesh.userData.height = height;
  return mesh;
}

function placePanel(mesh, x, y) {
  mesh.position.set(x + mesh.userData.width * 0.5, y + mesh.userData.height * 0.5, 0);
}

function createButton({ id, label, shortcut, atlas, active, onToggle }) {
  const group = new THREE.Group();
  const width = 228;
  const height = 42;
  const background = makePanel(width, height, 0x070c12, 0.82, 1000);
  const borderTop = makePanel(width, 1, 0x61747d, 0.38, 1001);
  const indicator = makePanel(4, height, active ? 0xd99a58 : 0x354b56, active ? 1 : 0.42, 1003);
  const key = makeText(shortcut, atlas, active ? 0xffd4a2 : 0x89a8b4, 3, 1);
  const caption = makeText(label, atlas, 0xd6dfdf, 2, 0.94);

  placePanel(background, 0, 0);
  placePanel(borderTop, 0, 0);
  placePanel(indicator, 0, 0);
  key.position.set(15, 12, 0.3);
  caption.position.set(42, 16, 0.3);
  group.add(background, borderTop, indicator, key, caption);

  const button = {
    id,
    group,
    width,
    height,
    active: Boolean(active),
    bounds: { x: 0, y: 0, width, height },
    setActive(next) {
      this.active = Boolean(next);
      indicator.material.color.set(this.active ? 0xd99a58 : 0x354b56);
      indicator.material.opacity = this.active ? 1 : 0.42;
      key.material.color.set(this.active ? 0xffd4a2 : 0x89a8b4);
    },
    toggle() {
      this.setActive(!this.active);
      onToggle?.(this.active);
    },
  };
  return button;
}

export function createObservatoryHud({
  renderer,
  nativeRtxAvailable = false,
  nativeReflectionsActive = false,
  onAutoCamera,
  onLightPath,
  onReflectionQuality,
}) {
  const atlas = createFontAtlas();
  const scene = new THREE.Scene();
  scene.name = "JS-only orthographic HUD";
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  camera.position.z = 5;

  // The HUD is rendered into a transparent offscreen texture. The native
  // reflection presenter composites that texture with the reflected world in
  // its single, known-good canvas submission. This avoids two swapchain
  // presentations fighting each other while keeping every visible UI element
  // generated in JavaScript/Three.js.
  const target = new THREE.RenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  target.texture.name = "Light Transport Observatory transparent HUD";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;

  // H controls only the controls/text group. The transparent target remains a
  // valid compositor input when the HUD is hidden.
  const hudRoot = new THREE.Group();
  hudRoot.name = "JS-only HUD controls";
  scene.add(hudRoot);

  const topPanel = makePanel(404, 82, 0x04090e, 0.72);
  const accent = makePanel(4, 82, 0xd99a58, 0.98, 1003);
  const statusPanel = makePanel(404, 54, 0x04090e, 0.58);
  const statusAccent = makePanel(4, 54, nativeReflectionsActive ? 0x78c4d1 : 0x3f5963, 0.92, 1003);
  const title = makeText("LIGHT TRANSPORT OBSERVATORY", atlas, 0xf1dfc6, 3, 1);
  const subtitle = makeText("NATIVE RAY QUERY / JS AUTHORED", atlas, 0x86b6c2, 2, 0.94);
  const bridgeStatus = makeText(
    nativeRtxAvailable ? "RTX TRANSPORT READY" : "RTX TRANSPORT UNAVAILABLE",
    atlas,
    nativeRtxAvailable ? 0x87bdc9 : 0x74848a,
    2,
    0.94,
  );
  const nativeStatus = makeText("MULTI-BOUNCE TRANSPORT ACTIVE", atlas, 0x8dd0db, 2, 0.98);
  const rasterTechniques = makeText(
    nativeRtxAvailable ? "OFFSCREEN ROOMS READY / ENABLE RAY PATH" : "JS RASTER FALLBACK / DIRECT LIGHT ONLY",
    atlas,
    0xa7b7ba,
    2,
    0.9,
  );
  const nativeTechniques = makeText("OFFSCREEN ROOMS / SECONDARY HITS / HDR", atlas, 0xb5c5c6, 2, 0.92);
  const footer = makeText("DRAG LOOK  WHEEL DOLLY  SPACE DROP MARBLE  A TOUR  L LIGHT PATH  Q RAYS  H HIDE", atlas, 0x81979f, 2, 0.9);
  hudRoot.add(
    topPanel,
    accent,
    statusPanel,
    statusAccent,
    title,
    subtitle,
    bridgeStatus,
    nativeStatus,
    rasterTechniques,
    nativeTechniques,
    footer,
  );

  const controlsPanel = makePanel(252, 166, 0x04090e, 0.68);
  hudRoot.add(controlsPanel);
  const buttons = [
    createButton({ id: "auto", label: "AUTO TOUR", shortcut: "A", atlas, active: true, onToggle: onAutoCamera }),
    createButton({ id: "path", label: "LIGHT PATHS", shortcut: "L", atlas, active: true, onToggle: onLightPath }),
    createButton({ id: "quality", label: "CINEMATIC RAYS", shortcut: "Q", atlas, active: true, onToggle: onReflectionQuality }),
  ];
  for (const button of buttons) hudRoot.add(button.group);

  let width = 1;
  let height = 1;
  let visible = true;
  let adaptiveStatusKey = "";

  function resize(nextWidth, nextHeight) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();

    target.setSize(width, height);

    placePanel(topPanel, 24, 24);
    placePanel(accent, 24, 24);
    placePanel(statusPanel, 24, 114);
    placePanel(statusAccent, 24, 114);
    title.position.set(44, 39, 0.3);
    subtitle.position.set(44, 67, 0.3);
    bridgeStatus.position.set(44, 127, 0.3);
    nativeStatus.position.set(44, 127, 0.3);
    rasterTechniques.position.set(44, 148, 0.3);
    nativeTechniques.position.set(44, 148, 0.3);
    footer.position.set(24, height - 30, 0.3);

    const controlsX = Math.max(24, width - 276);
    const controlsY = 24;
    placePanel(controlsPanel, controlsX, controlsY);
    buttons.forEach((button, index) => {
      const x = controlsX + 12;
      const y = controlsY + 12 + index * 48;
      button.group.position.set(x, y, 0.2);
      Object.assign(button.bounds, { x, y, width: button.width, height: button.height });
    });

    const compact = width < 780;
    controlsPanel.visible = !compact;
    for (const button of buttons) button.group.visible = !compact;
    subtitle.visible = width >= 540;
    rasterTechniques.visible = !nativeReflectionsActive && width >= 700;
    nativeTechniques.visible = nativeReflectionsActive && width >= 700;
  }

  function pointerCoordinates(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const scaleX = width / Math.max(1, rect.width);
    const scaleY = height / Math.max(1, rect.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(event) {
    if (!visible) return;
    const point = pointerCoordinates(event);
    for (const button of buttons) {
      const box = button.bounds;
      if (!button.group.visible) continue;
      if (point.x >= box.x && point.x <= box.x + box.width &&
          point.y >= box.y && point.y <= box.y + box.height) {
        event.preventDefault?.();
        button.toggle();
        return;
      }
    }
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "a") buttons[0].toggle();
    else if (key === "l") buttons[1].toggle();
    else if (key === "q") buttons[2].toggle();
    else if (key === "h") {
      visible = !visible;
      hudRoot.visible = visible;
    }
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  globalThis.addEventListener("keydown", onKeyDown);

  const initial = renderer.getSize(new THREE.Vector2());
  resize(initial.x, initial.y);

  function setNativeReflectionsActive(active) {
    nativeReflectionsActive = Boolean(active);
    bridgeStatus.visible = !nativeReflectionsActive;
    nativeStatus.visible = nativeReflectionsActive;
    rasterTechniques.visible = !nativeReflectionsActive && width >= 700;
    nativeTechniques.visible = nativeReflectionsActive && width >= 700;
    statusAccent.material.color.set(nativeReflectionsActive ? 0x78c4d1 : 0x3f5963);
    statusAccent.material.opacity = nativeReflectionsActive ? 0.98 : 0.72;
  }

  function setAdaptiveStatus(status = {}) {
    if (!nativeReflectionsActive) return;
    const rrActive = Boolean(status.rayReconstructionActive);
    const srActive = Boolean(status.superResolutionActive) && !rrActive;
    const fgActive = Boolean(status.frameGenerationActive);
    const reflexActive = Boolean(status.reflexActive);
    const adaptiveRequested = Boolean(
      status.rayReconstructionRequested || status.superResolutionRequested,
    );
    const path = rrActive
      ? "DLSS RAY RECONSTRUCTION ACTIVE"
      : srActive
        ? "DLSS SUPER RESOLUTION ACTIVE"
        : adaptiveRequested
          ? "ADAPTIVE PIPELINE WARMUP"
          : "NATIVE MULTI-BOUNCE ACTIVE";
    const techniques = [
      fgActive
        ? "FG ACTIVE"
        : status.frameGenerationRequested
          ? "FG WARMUP"
          : "FG OFF",
      reflexActive
        ? "REFLEX BOOST ACTIVE"
        : status.reflexRequested
          ? "REFLEX PENDING"
          : "REFLEX OFF",
      status.renderWidth && status.outputWidth
        ? `${status.renderWidth}X${status.renderHeight} TO ${status.outputWidth}X${status.outputHeight}`
        : "HDR PRESENT",
    ].join(" / ");
    const key = `${path}|${techniques}`;
    if (key === adaptiveStatusKey) return;
    adaptiveStatusKey = key;
    setText(nativeStatus, path, atlas);
    setText(nativeTechniques, techniques, atlas);
  }
  setNativeReflectionsActive(nativeReflectionsActive);

  return {
    scene,
    camera,
    buttons,
    target,
    get texture() {
      return target.texture;
    },
    resize,
    setNativeReflectionsActive,
    setAdaptiveStatus,
    renderToTexture() {
      const previousTarget = renderer.getRenderTarget();
      const previousMrt = renderer.getMRT();
      const previousClearColor = renderer.getClearColor(new THREE.Color());
      const previousClearAlpha = renderer.getClearAlpha();
      const previousAutoClear = renderer.autoClear;

      renderer.setMRT(null);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.clear(true, false, false);
      if (visible) renderer.render(scene, camera);

      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMrt);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
      return target.texture;
    },
    render() {
      if (visible) renderer.render(scene, camera);
    },
    dispose() {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
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
