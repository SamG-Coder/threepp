import * as THREE from "three/webgpu";
import { MAP_DATA } from "./map-data.generated.mjs";

const MAP_COLORS = Object.freeze({
  paper: "#d8c89e",
  paperEdge: "#59452d",
  road: "#866846",
  ferry: "#f1c45f",
  water: "#355f59",
  waterEdge: "#203f3c",
});

function makeCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const canvas = new OffscreenCanvas(width, height);
  return canvas;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function fitFont(context, text, maxWidth, startSize, family) {
  let size = startSize;
  do {
    context.font = `${size}px ${family}`;
    if (context.measureText(text).width <= maxWidth) return size;
    size -= 1;
  } while (size > 12);
  return size;
}

function drawPolyline(context, points, box) {
  if (!points?.length) return;
  context.beginPath();
  points.forEach(([x, y], index) => {
    const px = box.x + x * box.width;
    const py = box.y + y * box.height;
    if (index) context.lineTo(px, py);
    else context.moveTo(px, py);
  });
}

function drawMap(context, box, activeLocationId) {
  context.save();
  roundedRect(context, box.x, box.y, box.width, box.height, 18);
  context.fillStyle = MAP_COLORS.paper;
  context.fill();
  context.strokeStyle = MAP_COLORS.paperEdge;
  context.lineWidth = 2;
  context.stroke();
  context.clip();

  context.fillStyle = "rgba(96,113,71,0.13)";
  for (let index = 0; index < 34; index++) {
    const x = box.x + ((index * 47) % 101) / 100 * box.width;
    const y = box.y + ((index * 71) % 97) / 96 * box.height;
    context.beginPath();
    context.arc(x, y, 1.5 + (index % 3), 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = MAP_COLORS.road;
  context.lineWidth = 1.4;
  for (const road of MAP_DATA.roads) {
    drawPolyline(context, road.points, box);
    context.stroke();
  }

  for (const waterway of MAP_DATA.waterways) {
    for (const ring of waterway.rings) {
      drawPolyline(context, ring, box);
      context.closePath();
      context.fillStyle = MAP_COLORS.water;
      context.fill();
      context.strokeStyle = MAP_COLORS.waterEdge;
      context.lineWidth = 1.2;
      context.stroke();
    }
  }

  context.strokeStyle = MAP_COLORS.ferry;
  context.lineWidth = 3.2;
  context.setLineDash([7, 5]);
  for (const ferry of MAP_DATA.ferries) {
    drawPolyline(context, ferry.points, box);
    context.stroke();
  }
  context.setLineDash([]);

  for (const landmark of MAP_DATA.landmarks) {
    const [nx, ny] = landmark.point;
    const x = box.x + nx * box.width;
    const y = box.y + ny * box.height;
    const active = landmark.id === activeLocationId;
    context.beginPath();
    context.arc(x, y, active ? 7 : 4.5, 0, Math.PI * 2);
    context.fillStyle = active ? "#f4c96b" : "#e8ead5";
    context.fill();
    context.strokeStyle = active ? "#392815" : "#4b5944";
    context.lineWidth = 2;
    context.stroke();
  }

  context.restore();
}

export function createGameHud(width, height) {
  const canvas = makeCanvas(Math.max(1, width), Math.max(1, height));
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  // NativeRtxRenderer's HUD quad already reverses V for the presentation
  // target. Disable CanvasTexture's own upload flip so painted text stays
  // upright instead of being flipped a second time.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.name = "Secret River game HUD";
  let lastSignature = "";

  function resize(nextWidth, nextHeight) {
    const w = Math.max(1, Math.round(nextWidth));
    const h = Math.max(1, Math.round(nextHeight));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    lastSignature = "";
  }

  function draw(state) {
    const signature = JSON.stringify([
      canvas.width,
      canvas.height,
      state.location?.id,
      state.location?.title,
      state.objective,
      state.prompt,
      state.progress,
      state.complete,
    ]);
    if (signature === lastSignature) return texture;
    lastSignature = signature;

    const widthValue = canvas.width;
    const heightValue = canvas.height;
    const scale = Math.max(0.72, Math.min(1.35, heightValue / 900));
    context.clearRect(0, 0, widthValue, heightValue);

    const panelX = 34 * scale;
    const panelY = 32 * scale;
    const panelWidth = Math.min(widthValue * 0.52, 650 * scale);
    const panelHeight = 126 * scale;
    roundedRect(context, panelX, panelY, panelWidth, panelHeight, 18 * scale);
    context.fillStyle = "rgba(15,23,18,0.90)";
    context.fill();
    context.strokeStyle = "rgba(229,215,174,0.34)";
    context.lineWidth = 1.5 * scale;
    context.stroke();

    const title = state.location?.title || "Secret River";
    context.fillStyle = "#f0dfb4";
    fitFont(context, title, panelWidth - 40 * scale, Math.round(29 * scale), "Georgia, serif");
    context.fillText(title, panelX + 20 * scale, panelY + 38 * scale);
    context.fillStyle = "rgba(235,239,220,0.92)";
    context.font = `${Math.round(17 * scale)}px Segoe UI, sans-serif`;
    context.fillText(state.objective || "Follow the river", panelX + 20 * scale, panelY + 72 * scale);
    if (state.progress) {
      context.fillStyle = "#d8bc72";
      context.font = `600 ${Math.round(15 * scale)}px Segoe UI, sans-serif`;
      context.fillText(state.progress, panelX + 20 * scale, panelY + 101 * scale);
    }

    const mapWidth = Math.min(330 * scale, widthValue * 0.30);
    const mapHeight = mapWidth * 0.70;
    const mapBox = {
      x: widthValue - mapWidth - 34 * scale,
      y: 32 * scale,
      width: mapWidth,
      height: mapHeight,
    };
    drawMap(context, mapBox, state.location?.id);
    context.fillStyle = "rgba(22,28,21,0.82)";
    context.font = `600 ${Math.round(12 * scale)}px Segoe UI, sans-serif`;
    context.textAlign = "right";
    context.fillText("NSW SPATIAL SERVICES | CC BY", mapBox.x + mapBox.width - 8, mapBox.y + mapBox.height - 8);
    context.textAlign = "left";

    const controls = "A D / arrows  WALK     SHIFT  MOVE FASTER     E  OBSERVE / TRAVEL     ESC  MENU";
    context.font = `600 ${Math.round(13 * scale)}px Segoe UI, sans-serif`;
    const controlsWidth = context.measureText(controls).width + 30 * scale;
    roundedRect(context, 28 * scale, heightValue - 54 * scale, controlsWidth, 31 * scale, 12 * scale);
    context.fillStyle = "rgba(17,22,18,0.84)";
    context.fill();
    context.fillStyle = "rgba(238,231,204,0.82)";
    context.fillText(controls, 43 * scale, heightValue - 33 * scale);

    if (state.prompt) {
      context.font = `600 ${Math.round(18 * scale)}px Segoe UI, sans-serif`;
      const promptWidth = Math.min(widthValue - 40 * scale, context.measureText(state.prompt).width + 62 * scale);
      const x = (widthValue - promptWidth) * 0.5;
      const y = heightValue - 118 * scale;
      roundedRect(context, x, y, promptWidth, 52 * scale, 18 * scale);
      context.fillStyle = "rgba(13,21,17,0.94)";
      context.fill();
      context.strokeStyle = "rgba(242,205,112,0.62)";
      context.stroke();
      context.fillStyle = "#f4dfaa";
      context.textAlign = "center";
      context.fillText(state.prompt, widthValue * 0.5, y + 33 * scale);
      context.textAlign = "left";
    }

    texture.needsUpdate = true;
    return texture;
  }

  return {
    texture,
    resize,
    draw,
    dispose() {
      texture.dispose();
    },
  };
}
