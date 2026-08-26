import * as THREE from "three/webgpu";

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
const ATLAS_WIDTH = 256;
const ATLAS_HEIGHT = 8;

function createAtlas() {
  const bytes = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const cells = new Map();
  let cell = 0;
  for (const [character, rows] of Object.entries(GLYPHS)) {
    const originX = cell * CELL_WIDTH;
    cells.set(character, originX);
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
  texture.name = "Tennis macro 3x5 HUD font";
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
    const originX = atlas.cells.get(character);
    if (character !== " ") {
      const base = positions.length / 3;
      positions.push(
        cursor, 0, 0,
        cursor + glyphWidth, 0, 0,
        cursor + glyphWidth, glyphHeight, 0,
        cursor, glyphHeight, 0,
      );
      const u0 = (originX + 1) / ATLAS_WIDTH;
      const u1 = (originX + 4) / ATLAS_WIDTH;
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
  return { geometry, width: Math.max(0, cursor - tracking * pixelSize), height: glyphHeight };
}

function makeText(text, atlas, color, pixelSize = 2, opacity = 1) {
  const value = textGeometry(text, atlas, pixelSize);
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
  const mesh = new THREE.Mesh(value.geometry, material);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  mesh.userData.text = text;
  mesh.userData.pixelSize = pixelSize;
  mesh.userData.width = value.width;
  return mesh;
}

function setText(mesh, text, atlas) {
  if (mesh.userData.text === text) return;
  const value = textGeometry(text, atlas, mesh.userData.pixelSize);
  mesh.geometry.dispose();
  mesh.geometry = value.geometry;
  mesh.userData.text = text;
  mesh.userData.width = value.width;
}

function makePanel(width, height, color, opacity) {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.userData.width = width;
  mesh.userData.height = height;
  return mesh;
}

function positionPanel(mesh, x, y) {
  mesh.position.set(x + mesh.userData.width * 0.5, y + mesh.userData.height * 0.5, 0);
}

export function createMacroHud(renderer, stats) {
  const atlas = createAtlas();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
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
  target.texture.name = "Transparent tennis macro HUD";
  target.texture.colorSpace = THREE.NoColorSpace;

  const topPanel = makePanel(430, 88, 0x050806, 0.76);
  const topAccent = makePanel(4, 88, 0xb8dc4b, 0.9);
  const bottomPanel = makePanel(720, 70, 0x050806, 0.72);
  const title = makeText("RTX TENNIS FELT / MACRO", atlas, 0xeaf5d6, 3);
  const topology = makeText(
    `${stats.fibreCount} GPU FIBRES / ${stats.triangleCount} DYNAMIC TRIANGLES`,
    atlas,
    0x9ca991,
    2,
  );
  const statusText = makeText("INITIALIZING RAY QUERY", atlas, 0xc7e563, 2);
  const distanceText = makeText("SURFACE 0.0 MM", atlas, 0xf0e8cb, 2);
  const controlsText = makeText(
    "WHEEL MACRO / DRAG ORBIT / MOVE BRUSH / SPACE GUST / X RTX / H HUD",
    atlas,
    0xa8b3a4,
    2,
  );
  scene.add(topPanel, topAccent, bottomPanel, title, topology, statusText, distanceText, controlsText);

  let width = 1;
  let height = 1;
  let visible = true;

  function layout() {
    positionPanel(topPanel, 18, height - 106);
    positionPanel(topAccent, 18, height - 106);
    title.position.set(38, height - 58, 0.2);
    topology.position.set(38, height - 86, 0.2);
    const panelWidth = Math.min(720, Math.max(360, width - 36));
    if (bottomPanel.userData.width !== panelWidth) {
      bottomPanel.geometry.dispose();
      bottomPanel.geometry = new THREE.PlaneGeometry(panelWidth, 70);
      bottomPanel.userData.width = panelWidth;
    }
    positionPanel(bottomPanel, 18, 18);
    statusText.position.set(36, 61, 0.2);
    distanceText.position.set(Math.max(36, panelWidth - distanceText.userData.width - 2), 61, 0.2);
    controlsText.position.set(36, 35, 0.2);
  }

  function resize(nextWidth, nextHeight) {
    width = Math.max(1, Math.trunc(nextWidth));
    height = Math.max(1, Math.trunc(nextHeight));
    target.setSize(width, height);
    camera.left = 0;
    camera.right = width;
    camera.top = height;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
    layout();
  }

  function update({ status, surfaceMillimetres = 0, gust = 0 }) {
    const mode = status.active
      ? status.raysEnabled
        ? `${status.customPipeline ? "FIBRE TRANSPORT" : "RAY LIGHTING"} / ${status.lightSamples}+${status.aoSamples} PATHS / REFIT ${status.refitCount}`
        : `RTX GEOMETRY ACTIVE / RAYS A-B DISABLED / REFIT ${status.refitCount}`
      : "WEBGPU EXACT FIBRES / RASTER LIGHTING FALLBACK";
    setText(statusText, mode, atlas);
    statusText.material.color.set(status.active && status.raysEnabled ? 0xc7e563 : 0xe0ba6a);
    const distance = Math.max(0, Number(surfaceMillimetres) || 0);
    const readout = distance < 10
      ? `SURFACE ${distance.toFixed(2)} MM / GUST ${Math.round(gust * 100)}`
      : `SURFACE ${distance.toFixed(1)} MM / GUST ${Math.round(gust * 100)}`;
    setText(distanceText, readout, atlas);
    layout();
  }

  function renderToTexture() {
    if (!visible) return null;
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    const previousToneMapping = renderer.toneMapping;
    const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;
    const previousClearColor = renderer.getClearColor?.(new THREE.Color()) ?? new THREE.Color(0);
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.toneMapping = previousToneMapping;
    }
    return target.texture;
  }

  function setVisible(next) {
    visible = Boolean(next);
  }

  function dispose() {
    target.dispose();
    atlas.texture.dispose();
    scene.traverse(object => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
  }

  return {
    target,
    resize,
    update,
    renderToTexture,
    setVisible,
    get visible() { return visible; },
    dispose,
  };
}
