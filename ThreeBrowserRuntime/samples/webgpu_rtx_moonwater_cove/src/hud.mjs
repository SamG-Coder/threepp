import * as THREE from "three/webgpu";

// Compact JS-generated bitmap typography keeps every visible control inside
// the WebGPU canvas. No DOM nodes, browser fonts, Canvas2D or downloaded assets
// enter the Runtime presentation path.
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
  V: ["101", "101", "010", "010", "010"],
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
const ATLAS_WIDTH = 256;
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
        bytes[offset] = 255;
        bytes[offset + 1] = 255;
        bytes[offset + 2] = 255;
        bytes[offset + 3] = 255;
      }
    }
    cell += 1;
  }
  const texture = new THREE.DataTexture(bytes, ATLAS_WIDTH, ATLAS_HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Moonwater JS bitmap HUD atlas";
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
  for (const raw of String(text).toUpperCase()) {
    const character = GLYPHS[raw] ? raw : "?";
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
  const data = textGeometry(text, atlas, pixelSize);
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
  const mesh = new THREE.Mesh(data.geometry, material);
  mesh.renderOrder = 1003;
  mesh.frustumCulled = false;
  mesh.userData.width = data.width;
  mesh.userData.height = data.height;
  mesh.userData.text = String(text);
  mesh.setText = nextText => {
    const value = String(nextText);
    if (mesh.userData.text === value) return;
    const next = textGeometry(value, atlas, pixelSize);
    mesh.geometry.dispose();
    mesh.geometry = next.geometry;
    mesh.userData.width = next.width;
    mesh.userData.height = next.height;
    mesh.userData.text = value;
  };
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

function createButton({ id, shortcut, label, atlas, onPress }) {
  const group = new THREE.Group();
  const width = 254;
  const height = 34;
  const background = makePanel(width, height, 0x04111b, 0.76);
  const top = makePanel(width, 1, 0x72b5c7, 0.22, 1001);
  const indicator = makePanel(4, height, 0x365e6b, 0.5, 1004);
  const key = makeText(shortcut, atlas, 0x90cdda, 2, 1);
  const caption = makeText(label, atlas, 0xbdd6dc, 2, 0.94);
  placePanel(background, 0, 0);
  placePanel(top, 0, 0);
  placePanel(indicator, 0, 0);
  key.position.set(14, 12, 0.3);
  caption.position.set(40, 12, 0.3);
  group.add(background, top, indicator, key, caption);
  return {
    id,
    group,
    width,
    height,
    bounds: { x: 0, y: 0, width, height },
    active: false,
    setActive(active) {
      this.active = Boolean(active);
      indicator.material.color.set(this.active ? 0x6dffe2 : 0x365e6b);
      indicator.material.opacity = this.active ? 1 : 0.5;
      key.material.color.set(this.active ? 0xd5fff6 : 0x90cdda);
    },
    press() {
      onPress?.(id);
    },
  };
}

export function createMoonwaterHud({ renderer, callbacks = {} }) {
  const atlas = createFontAtlas();
  const scene = new THREE.Scene();
  scene.name = "Moonwater JS-only orthographic HUD";
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
  target.texture.name = "Moonwater transparent JS HUD";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;

  const root = new THREE.Group();
  root.name = "Moonwater visible controls";
  scene.add(root);

  const titlePanel = makePanel(430, 96, 0x020913, 0.68);
  const titleAccent = makePanel(5, 96, 0x62ffe0, 0.95, 1004);
  const title = makeText("MOONLIT OPEN OCEAN", atlas, 0xe4fff9, 3, 1);
  const subtitle = makeText("JS/TSL OCEAN + GENERIC RTX", atlas, 0x8cb7c4, 2, 0.94);
  const pathLabel = makeText("PATH: PROBING RTX BRIDGE", atlas, 0x80e6d2, 2, 0.96);
  const shotLabel = makeText("DECK / MOONLIGHT / BEAUTY", atlas, 0xa6bec9, 2, 0.9);
  const footer = makeText("DRAG LOOK  WHEEL DOLLY  H HIDE HUD", atlas, 0x91aab4, 2, 0.88);
  root.add(titlePanel, titleAccent, title, subtitle, pathLabel, shotLabel, footer);

  const controlsPanel = makePanel(278, 286, 0x020913, 0.61);
  root.add(controlsPanel);
  const buttonDefinitions = [
    ["aerial", "1", "AERIAL CAMERA"],
    ["deck", "2", "DECK CAMERA"],
    ["wave", "3", "WAVE LEVEL CAMERA"],
    ["time", "T", "OCEAN MOTION"],
    ["rtx", "X", "RTX QUERIES"],
    ["debug", "D", "DEBUG VIEW"],
    ["waves", "W", "WAVE ENERGY"],
  ];
  const buttons = buttonDefinitions.map(([id, shortcut, label]) => createButton({
    id,
    shortcut,
    label,
    atlas,
    onPress: pressed => callbacks.onPress?.(pressed),
  }));
  buttons.forEach(button => root.add(button.group));

  let width = 1;
  let height = 1;
  let visible = true;
  let dirty = true;
  let layoutReady = false;
  let stateApplied = false;
  let state = {
    cameraMode: "deck",
    timeFlow: true,
    rtxRequested: true,
    rtxAvailable: false,
    waves: true,
    debugMode: 0,
    path: "WEBGPU FALLBACK",
    timeLabel: "MOONLIGHT",
    debugLabel: "BEAUTY",
  };

  function setState(next) {
    const merged = { ...state, ...next };
    const changed = !stateApplied || Object.keys(merged).some(key => merged[key] !== state[key]);
    state = merged;
    if (!changed) return;
    stateApplied = true;
    buttons[0].setActive(state.cameraMode === "aerial");
    buttons[1].setActive(state.cameraMode === "deck");
    buttons[2].setActive(state.cameraMode === "wave");
    buttons[3].setActive(state.timeFlow);
    buttons[4].setActive(state.rtxRequested && state.rtxAvailable);
    buttons[5].setActive(state.debugMode > 0);
    buttons[6].setActive(state.waves);
    const pathPrefix = state.rtxRequested && state.rtxAvailable ? "PATH: " : "FALLBACK: ";
    pathLabel.setText(pathPrefix + state.path);
    pathLabel.material.color.set(state.rtxRequested && state.rtxAvailable ? 0x72ffe2 : 0x91a7af);
    shotLabel.setText(`${String(state.cameraMode).toUpperCase()} / ${state.timeLabel} / ${state.debugLabel}`);
    dirty = true;
  }

  function resize(nextWidth, nextHeight) {
    const resizedWidth = Math.max(1, nextWidth);
    const resizedHeight = Math.max(1, nextHeight);
    if (layoutReady && resizedWidth === width && resizedHeight === height) return;
    width = resizedWidth;
    height = resizedHeight;
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    target.setSize(width, height);

    placePanel(titlePanel, 24, 24);
    placePanel(titleAccent, 24, 24);
    title.position.set(43, 38, 0.3);
    subtitle.position.set(43, 63, 0.3);
    pathLabel.position.set(24, 134, 0.3);
    shotLabel.position.set(24, 154, 0.3);
    footer.position.set(24, height - 29, 0.3);

    const controlsX = Math.max(24, width - 302);
    const controlsY = 24;
    placePanel(controlsPanel, controlsX, controlsY);
    buttons.forEach((button, index) => {
      const x = controlsX + 12;
      const y = controlsY + 11 + index * 39;
      button.group.position.set(x, y, 0.2);
      Object.assign(button.bounds, { x, y, width: button.width, height: button.height });
    });

    const compact = width < 790 || height < 470;
    controlsPanel.visible = !compact;
    buttons.forEach(button => { button.group.visible = !compact; });
    subtitle.visible = width >= 520;
    shotLabel.visible = width >= 620;
    layoutReady = true;
    dirty = true;
  }

  function pointerCoordinates(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * height / Math.max(1, rect.height),
    };
  }

  function onPointerDown(event) {
    if (!visible) return;
    const point = pointerCoordinates(event);
    for (const button of buttons) {
      const bounds = button.bounds;
      if (!button.group.visible) continue;
      if (point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y && point.y <= bounds.y + bounds.height) {
        event.preventDefault?.();
        button.press();
        return;
      }
    }
  }

  function setVisible(next) {
    const nextVisible = Boolean(next);
    if (nextVisible === visible) return;
    visible = nextVisible;
    root.visible = visible;
    dirty = true;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  const initial = renderer.getSize(new THREE.Vector2());
  resize(initial.x, initial.y);
  setState(state);

  return {
    scene,
    camera,
    target,
    buttons,
    resize,
    setState,
    setVisible,
    toggleVisible() {
      setVisible(!visible);
      return visible;
    },
    get texture() {
      return target.texture;
    },
    renderToTexture() {
      if (!dirty) return target.texture;
      const previousTarget = renderer.getRenderTarget();
      const previousMrt = renderer.getMRT();
      const previousColor = renderer.getClearColor(new THREE.Color());
      const previousAlpha = renderer.getClearAlpha();
      const previousAutoClear = renderer.autoClear;
      try {
        renderer.setMRT(null);
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        renderer.clear(true, false, false);
        if (visible) renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setMRT(previousMrt);
        renderer.setClearColor(previousColor, previousAlpha);
        renderer.autoClear = previousAutoClear;
      }
      dirty = false;
      return target.texture;
    },
    render() {
      if (visible) renderer.render(scene, camera);
    },
    dispose() {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      atlas.texture.dispose();
      target.dispose();
      scene.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    },
  };
}
