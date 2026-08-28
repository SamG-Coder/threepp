import * as THREE from "three/webgpu";
import { MAP_DATA } from "../game/map-data.generated.mjs";

const DESIGN_WIDTH = 1600;
const DESIGN_HEIGHT = 900;
const CARD_LEFT = 930;
const CARD_WIDTH = 500;
const CARD_HEIGHT = 116;
const CARD_TOP = 454;
const CARD_GAP = 26;

export const MENU_OPTIONS = Object.freeze([
  Object.freeze({ id: "game", title: "PLAY THE GAME", detail: "THE BROAD REACH  |  FIRST BRANCH" }),
  Object.freeze({ id: "demo", title: "RIVERBANK DEMO", detail: "THE ORIGINAL WALKING STUDY" }),
]);

export function menuSelectionAfter(index, direction, count = MENU_OPTIONS.length) {
  const size = Math.max(1, Math.trunc(Number(count) || 1));
  const next = Math.trunc(Number(index) || 0) + Math.sign(Number(direction) || 0);
  return ((next % size) + size) % size;
}

export function menuOptionAtPoint(x, y, width, height) {
  const scaledX = Number(x) * DESIGN_WIDTH / Math.max(1, Number(width) || 1);
  const scaledY = Number(y) * DESIGN_HEIGHT / Math.max(1, Number(height) || 1);
  if (scaledX < CARD_LEFT || scaledX > CARD_LEFT + CARD_WIDTH) return -1;
  for (let index = 0; index < MENU_OPTIONS.length; ++index) {
    const top = CARD_TOP + index * (CARD_HEIGHT + CARD_GAP);
    if (scaledY >= top && scaledY <= top + CARD_HEIGHT) return index;
  }
  return -1;
}

function makeSurface() {
  const canvas = document.createElement("canvas");
  canvas.width = DESIGN_WIDTH;
  canvas.height = DESIGN_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Secret River main menu needs the Canvas2D texture bridge.");
  return { canvas, context };
}

function eventPoint(event, canvas) {
  const bounds = canvas.getBoundingClientRect?.() ?? {
    left: 0,
    top: 0,
    width: Number(canvas.clientWidth || innerWidth || 1),
    height: Number(canvas.clientHeight || innerHeight || 1),
  };
  return {
    x: Number(event.clientX || 0) - Number(bounds.left || 0),
    y: Number(event.clientY || 0) - Number(bounds.top || 0),
    width: Math.max(1, Number(bounds.width || canvas.clientWidth || innerWidth || 1)),
    height: Math.max(1, Number(bounds.height || canvas.clientHeight || innerHeight || 1)),
  };
}

function friendlyError(error) {
  const message = String(error?.message || error || "The selected mode could not start.");
  if (/game-mode|cannot find module|failed to fetch dynamically imported module/i.test(message)) {
    return "THE GAME WORLD IS STILL BEING BUILT.  THE RIVERBANK DEMO IS READY.";
  }
  return `COULD NOT START: ${message}`.slice(0, 108).toUpperCase();
}

function traceNormalisedPoints(context, points, left, top, width, height, close = false) {
  if (!Array.isArray(points) || points.length === 0) return false;
  const first = points[0];
  context.beginPath();
  context.moveTo(left + first[0] * width, top + first[1] * height);
  for (let index = 1; index < points.length; ++index) {
    const point = points[index];
    context.lineTo(left + point[0] * width, top + point[1] * height);
  }
  if (close) context.closePath();
  return true;
}

function drawMap(context) {
  const left = 110;
  const top = 328;
  const width = 690;
  const height = 426;
  context.fillStyle = "rgba(8,16,17,0.76)";
  context.fillRect(left - 18, top - 48, width + 36, height + 78);
  context.strokeStyle = "rgba(215,197,151,0.42)";
  context.lineWidth = 2;
  context.strokeRect(left - 18, top - 48, width + 36, height + 78);
  context.fillStyle = "#c7ba94";
  context.font = "18px sans-serif";
  context.fillText("HAWKESBURY / MACDONALD  |  TWO CONNECTED LOCATIONS", left, top - 18);

  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  context.fillStyle = "rgba(111,132,103,0.34)";
  context.fillRect(left, top, width, height);

  context.fillStyle = "rgba(54,87,91,0.96)";
  context.strokeStyle = "rgba(157,185,178,0.72)";
  context.lineWidth = 1.3;
  for (const waterway of MAP_DATA.waterways ?? []) {
    for (const ring of waterway.rings ?? []) {
      if (!traceNormalisedPoints(context, ring, left, top, width, height, true)) continue;
      context.fill();
      context.stroke();
    }
  }

  context.strokeStyle = "rgba(197,185,147,0.48)";
  context.lineWidth = 1.2;
  for (const road of MAP_DATA.roads ?? []) {
    if (traceNormalisedPoints(context, road.points, left, top, width, height)) context.stroke();
  }

  context.strokeStyle = "#dfc36f";
  context.lineWidth = 3;
  context.setLineDash?.([9, 7]);
  for (const ferry of MAP_DATA.ferries ?? []) {
    if (traceNormalisedPoints(context, ferry.points, left, top, width, height)) context.stroke();
  }
  context.setLineDash?.([]);
  context.restore();

  for (const landmark of MAP_DATA.landmarks ?? []) {
    const x = left + landmark.point[0] * width;
    const y = top + landmark.point[1] * height;
    const firstBranch = landmark.id === "first-branch";
    context.fillStyle = firstBranch ? "#efe0a4" : "#d18f58";
    context.beginPath();
    context.arc(x, y, firstBranch ? 7 : 8, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#101718";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#f0e5c7";
    context.font = "700 16px sans-serif";
    context.fillText(
      firstBranch ? "FIRST BRANCH" : "WISEMANS FERRY",
      x + (firstBranch ? -142 : 14),
      y + (firstBranch ? -13 : 5),
    );
  }

  context.fillStyle = "#798881";
  context.font = "13px sans-serif";
  context.fillText(
    "MAP (C) STATE OF NEW SOUTH WALES (SPATIAL SERVICES)",
    left,
    top + height + 22,
  );
}

export function createMainMenu({ renderer, onSelect }) {
  if (!renderer) throw new TypeError("Secret River main menu needs the shared renderer.");
  if (typeof onSelect !== "function") throw new TypeError("Secret River main menu needs an onSelect callback.");

  const { canvas: surface, context } = makeSurface();
  const texture = new THREE.CanvasTexture(surface);
  texture.name = "Secret River main-screen artwork";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  scene.name = "Secret River main screen";
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  // Menu artwork is already authored in display-referred sRGB. Bypassing the
  // riverbank's ACES pass keeps its blacks and ochres from looking washed out.
  material.toneMapped = false;
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);

  let selectedIndex = 0;
  let busy = false;
  let status = "";
  let disposed = false;
  const retainedSelectionTextures = [];

  function useArtwork(nextTexture) {
    if (material.map === nextTexture) return;
    material.map = nextTexture;
    material.needsUpdate = true;
  }

  function drawBackground() {
    const sky = context.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
    sky.addColorStop(0, "#17313a");
    sky.addColorStop(0.48, "#6e7565");
    sky.addColorStop(1, "#151b1c");
    context.fillStyle = sky;
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    context.globalAlpha = 0.28;
    context.fillStyle = "#d7bf83";
    context.beginPath();
    context.arc(260, 174, 76, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;

    context.fillStyle = "#1b2927";
    context.beginPath();
    context.moveTo(0, 418);
    context.quadraticCurveTo(270, 300, 540, 430);
    context.quadraticCurveTo(760, 525, 970, 400);
    context.quadraticCurveTo(1240, 280, 1600, 430);
    context.lineTo(1600, 900);
    context.lineTo(0, 900);
    context.closePath();
    context.fill();

    const water = context.createLinearGradient(0, 520, 0, 900);
    water.addColorStop(0, "#5d695b");
    water.addColorStop(0.22, "#31443f");
    water.addColorStop(1, "#10191b");
    context.fillStyle = water;
    context.beginPath();
    context.moveTo(0, 570);
    context.quadraticCurveTo(410, 520, 780, 596);
    context.quadraticCurveTo(1110, 650, 1600, 548);
    context.lineTo(1600, 900);
    context.lineTo(0, 900);
    context.closePath();
    context.fill();

    context.globalAlpha = 0.18;
    context.strokeStyle = "#d9c797";
    context.lineWidth = 3;
    for (let index = 0; index < 12; ++index) {
      const y = 620 + index * 19;
      const inset = 38 + (index % 4) * 46;
      context.beginPath();
      context.moveTo(inset, y);
      context.quadraticCurveTo(430, y - 12, 790, y + 5);
      context.stroke();
    }
    context.globalAlpha = 1;

    const shade = context.createLinearGradient(700, 0, 1500, 0);
    shade.addColorStop(0, "rgba(8,14,15,0)");
    shade.addColorStop(1, "rgba(8,14,15,0.78)");
    context.fillStyle = shade;
    context.fillRect(620, 0, 980, DESIGN_HEIGHT);
  }

  function draw() {
    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    drawBackground();

    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#efe2bd";
    context.font = "700 79px serif";
    context.fillText("SECRET RIVER", 112, 208);
    context.fillStyle = "#c7ba94";
    context.font = "24px sans-serif";
    context.fillText("A 2.5D HAWKESBURY JOURNEY", 119, 258);

    drawMap(context);

    context.fillStyle = "rgba(11,18,19,0.62)";
    context.fillRect(CARD_LEFT - 42, CARD_TOP - 72, CARD_WIDTH + 84, 354);
    context.fillStyle = "#b7ac8d";
    context.font = "19px sans-serif";
    context.fillText("CHOOSE WHERE TO BEGIN", CARD_LEFT, CARD_TOP - 32);

    for (let index = 0; index < MENU_OPTIONS.length; ++index) {
      const option = MENU_OPTIONS[index];
      const top = CARD_TOP + index * (CARD_HEIGHT + CARD_GAP);
      const selected = index === selectedIndex;
      context.fillStyle = selected ? "rgba(218,192,125,0.18)" : "rgba(9,15,16,0.66)";
      context.fillRect(CARD_LEFT, top, CARD_WIDTH, CARD_HEIGHT);
      context.strokeStyle = selected ? "#e0c77e" : "#657069";
      context.lineWidth = selected ? 4 : 2;
      context.strokeRect(CARD_LEFT, top, CARD_WIDTH, CARD_HEIGHT);
      context.fillStyle = selected ? "#f3dfaa" : "#c8c4b5";
      context.font = "700 31px sans-serif";
      context.fillText(`${selected ? ">  " : "   "}${option.title}`, CARD_LEFT + 28, top + 49);
      context.fillStyle = selected ? "#c9bd96" : "#8f9992";
      context.font = "17px sans-serif";
      context.fillText(option.detail, CARD_LEFT + 64, top + 82);
    }

    context.fillStyle = status ? "#e7c681" : "#9aa9a2";
    context.font = "18px sans-serif";
    context.fillText(
      status || "W / S OR ARROWS TO CHOOSE    ENTER / SPACE TO BEGIN",
      CARD_LEFT,
      792,
    );
    texture.needsUpdate = true;
  }

  function buildRetainedSelections() {
    const previousSelection = selectedIndex;
    const previousBusy = busy;
    const previousStatus = status;
    busy = false;
    status = "";
    for (let index = 0; index < MENU_OPTIONS.length; index++) {
      selectedIndex = index;
      draw();
      const retainedCanvas = document.createElement("canvas");
      retainedCanvas.width = DESIGN_WIDTH;
      retainedCanvas.height = DESIGN_HEIGHT;
      retainedCanvas.getContext("2d").drawImage(surface, 0, 0);
      const retainedTexture = new THREE.CanvasTexture(retainedCanvas);
      retainedTexture.name = `Secret River retained menu choice ${MENU_OPTIONS[index].id}`;
      retainedTexture.colorSpace = THREE.SRGBColorSpace;
      retainedTexture.generateMipmaps = false;
      retainedTexture.minFilter = THREE.LinearFilter;
      retainedTexture.magFilter = THREE.LinearFilter;
      retainedTexture.userData.retainedMenuArtwork = true;
      retainedTexture.needsUpdate = true;
      renderer.initTexture(retainedTexture);
      retainedSelectionTextures.push(retainedTexture);
    }
    selectedIndex = previousSelection;
    busy = previousBusy;
    status = previousStatus;
    useArtwork(retainedSelectionTextures[selectedIndex]);
  }

  function showRetainedSelection() {
    useArtwork(retainedSelectionTextures[selectedIndex] ?? texture);
  }

  function moveSelection(direction) {
    if (busy || disposed) return;
    selectedIndex = menuSelectionAfter(selectedIndex, direction);
    status = "";
    showRetainedSelection();
  }

  async function beginSelection() {
    if (busy || disposed) return false;
    const option = MENU_OPTIONS[selectedIndex];
    busy = true;
    status = `LOADING ${option.title}...`;
    useArtwork(texture);
    draw();
    try {
      const started = await onSelect(option.id);
      if (!started && !disposed && !status) {
        status = "THAT MODE COULD NOT START.  CHOOSE ANOTHER.";
      }
      return Boolean(started);
    } catch (error) {
      if (!disposed) {
        busy = false;
        status = friendlyError(error);
        draw();
      }
      return false;
    }
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const code = String(event.code || "");
    const key = String(event.key || "").toLowerCase();
    if (code === "ArrowUp" || code === "KeyW" || key === "w") {
      event.preventDefault?.();
      moveSelection(-1);
    } else if (code === "ArrowDown" || code === "KeyS" || key === "s") {
      event.preventDefault?.();
      moveSelection(1);
    } else if (code === "Enter" || code === "Space" || key === "enter" || key === " ") {
      event.preventDefault?.();
      void beginSelection();
    }
  }

  function onPointerMove(event) {
    if (busy || disposed) return;
    const point = eventPoint(event, renderer.domElement);
    const hit = menuOptionAtPoint(point.x, point.y, point.width, point.height);
    if (hit >= 0 && hit !== selectedIndex) {
      selectedIndex = hit;
      status = "";
      showRetainedSelection();
    }
  }

  function onPointerUp(event) {
    if (busy || disposed) return;
    const point = eventPoint(event, renderer.domElement);
    const hit = menuOptionAtPoint(point.x, point.y, point.width, point.height);
    if (hit < 0) return;
    selectedIndex = hit;
    showRetainedSelection();
    void beginSelection();
  }

  globalThis.addEventListener("keydown", onKeyDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  buildRetainedSelections();

  return {
    id: "menu",
    resize() {},
    frame() {
      if (disposed) return;
      renderer.info.reset();
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    },
    setLoading(modeId) {
      if (disposed) return;
      busy = Boolean(modeId);
      status = modeId ? `LOADING ${String(modeId).toUpperCase()}...` : "";
      if (busy || status) {
        useArtwork(texture);
        draw();
      } else {
        showRetainedSelection();
      }
    },
    setError(error) {
      if (disposed) return;
      busy = false;
      status = friendlyError(error);
      useArtwork(texture);
      draw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      globalThis.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      scene.clear();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      for (const retainedTexture of retainedSelectionTextures) {
        const retainedCanvas = retainedTexture.image;
        retainedTexture.dispose();
        if (retainedCanvas) {
          retainedCanvas.width = 1;
          retainedCanvas.height = 1;
        }
      }
      surface.width = 1;
      surface.height = 1;
    },
  };
}
