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
  return mesh;
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
  const background = makePanel(width, height, 0x071016, 0.76, 1000);
  const borderTop = makePanel(width, 1, 0x6b8792, 0.32, 1001);
  const indicator = makePanel(4, height, active ? 0xffad55 : 0x45616d, active ? 1 : 0.42, 1003);
  const key = makeText(shortcut, atlas, active ? 0xffcf8b : 0x90afbb, 3, 1);
  const caption = makeText(label, atlas, 0xc9d8dc, 2, 0.92);

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
      indicator.material.color.set(this.active ? 0xffad55 : 0x45616d);
      indicator.material.opacity = this.active ? 1 : 0.42;
      key.material.color.set(this.active ? 0xffcf8b : 0x90afbb);
    },
    toggle() {
      this.setActive(!this.active);
      onToggle?.(this.active);
    },
  };
  return button;
}

export function createGlasshouseHud({
  renderer,
  nativeRtxAvailable = false,
  nativeReflectionsActive = false,
  onAutoCamera,
  onRain,
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
  target.texture.name = "Midnight Glasshouse transparent HUD";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;

  // H controls only the controls/text group. The transparent target remains a
  // valid compositor input when the HUD is hidden.
  const hudRoot = new THREE.Group();
  hudRoot.name = "JS-only HUD controls";
  scene.add(hudRoot);

  const topPanel = makePanel(360, 74, 0x02070b, 0.62);
  const accent = makePanel(5, 74, 0xffad55, 0.95, 1003);
  const title = makeText("MIDNIGHT GLASSHOUSE", atlas, 0xf0d8b4, 3, 1);
  const subtitle = makeText("WEBGPU REFLECTION STUDY", atlas, 0x86aab8, 2, 0.92);
  const bridgeStatus = makeText(
    nativeRtxAvailable ? "RTX BRIDGE READY" : "RTX BRIDGE UNAVAILABLE",
    atlas,
    nativeRtxAvailable ? 0x8fc4d7 : 0x74848a,
    2,
    0.9,
  );
  const nativeStatus = makeText("RTX RAY REFLECTIONS ACTIVE", atlas, 0x8fc4d7, 2, 0.94);
  const rasterTechniques = makeText("PLANAR X3 / GGX IBL / CHROME", atlas, 0xa7b7ba, 2, 0.88);
  const nativeTechniques = makeText("MRT X3 / WORLD NORMAL / HDR", atlas, 0xa7b7ba, 2, 0.88);
  const footer = makeText("DRAG LOOK  WHEEL DOLLY  H HIDE HUD", atlas, 0x8ba0a7, 2, 0.88);
  hudRoot.add(
    topPanel,
    accent,
    title,
    subtitle,
    bridgeStatus,
    nativeStatus,
    rasterTechniques,
    nativeTechniques,
    footer,
  );

  const controlsPanel = makePanel(252, 166, 0x02070b, 0.58);
  hudRoot.add(controlsPanel);
  const buttons = [
    createButton({ id: "auto", label: "AUTO CAMERA", shortcut: "A", atlas, active: true, onToggle: onAutoCamera }),
    createButton({ id: "rain", label: "EXTERIOR RAIN", shortcut: "R", atlas, active: true, onToggle: onRain }),
    createButton({ id: "quality", label: "FULL REFLECTIONS", shortcut: "Q", atlas, active: true, onToggle: onReflectionQuality }),
  ];
  for (const button of buttons) hudRoot.add(button.group);

  let width = 1;
  let height = 1;
  let visible = true;

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
    title.position.set(43, 37, 0.3);
    subtitle.position.set(43, 61, 0.3);
    bridgeStatus.position.set(24, 112, 0.3);
    nativeStatus.position.set(24, 112, 0.3);
    rasterTechniques.position.set(24, 132, 0.3);
    nativeTechniques.position.set(24, 132, 0.3);
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

    const compact = width < 760;
    controlsPanel.visible = !compact;
    for (const button of buttons) button.group.visible = !compact;
    subtitle.visible = width >= 520;
    rasterTechniques.visible = !nativeReflectionsActive && width >= 620;
    nativeTechniques.visible = nativeReflectionsActive && width >= 620;
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
    else if (key === "r") buttons[1].toggle();
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
    rasterTechniques.visible = !nativeReflectionsActive && width >= 620;
    nativeTechniques.visible = nativeReflectionsActive && width >= 620;
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
