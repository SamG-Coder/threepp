import * as THREE from "three/webgpu";
import { keyedCanvasFromImage } from "./chroma-key.mjs";
import { clampToBank, spawnOnRoad, terrainHeight } from "./path.mjs";

const WALKER_HEIGHT = 1.78;
const WALK_SPEED = 2.3;
const SPRINT_SPEED = 3.8;
const WALK_FPS = 12;
const WALK_FRAME_FIRST = 1;
const WALK_FRAME_LAST = 73;

function makeCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  throw new Error("Walker cutouts need a 2D canvas.");
}

async function loadImage(url) {
  const href = url.href || String(url);
  if (typeof fetch === "function" && typeof createImageBitmap === "function") {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Failed to load walker (${response.status})`);
    return createImageBitmap(await response.blob());
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load walker"));
    image.src = href;
  });
}

async function loadKeyed(url) {
  const image = await loadImage(url);
  try {
    return keyedCanvasFromImage(image, { padding: 2 });
  } finally {
    if (typeof image.close === "function") image.close();
  }
}

async function tryLoadKeyed(url) {
  try {
    return await loadKeyed(url);
  } catch {
    return null;
  }
}

function copyToCard(keyed, width, height, targetHeight) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  const scale = targetHeight / Math.max(1, keyed.height);
  const drawWidth = keyed.width * scale;
  const drawHeight = targetHeight;
  const x = Math.round((width - drawWidth) / 2);
  const y = Math.round(height - drawHeight);
  context.drawImage(keyed.canvas, 0, 0, keyed.width, keyed.height, x, y, drawWidth, drawHeight);
  return canvas;
}

export async function createWalker() {
  const idleKeyed = await loadKeyed(new URL("../assets/walker/profile.jpg", import.meta.url));
  const walkKeyed = (await Promise.all(
    Array.from({ length: WALK_FRAME_LAST - WALK_FRAME_FIRST + 1 }, (_, offset) => {
      const index = WALK_FRAME_FIRST + offset;
      const file = `walk_${String(index).padStart(2, "0")}.png`;
      return tryLoadKeyed(new URL(`../assets/walker/walk/${file}`, import.meta.url));
    }),
  )).filter(Boolean);

  const bodyHeight = idleKeyed.height;
  const cardHeight = bodyHeight;
  const cardWidth = Math.max(
    idleKeyed.width,
    ...walkKeyed.map(frame => Math.round(frame.width * (bodyHeight / Math.max(1, frame.height)))),
  );
  const idleCanvas = copyToCard(idleKeyed, cardWidth, cardHeight, bodyHeight);
  const walkCanvases = walkKeyed.map(frame => copyToCard(frame, cardWidth, cardHeight, bodyHeight));

  // Keep one CanvasTexture bound: WebGPU compiles MeshBasicNodeMaterial.map into
  // the pipeline, so swapping maps each frame can keep the first binding.
  const displayCanvas = makeCanvas(cardWidth, cardHeight);
  const displayContext = displayCanvas.getContext("2d");
  displayContext.drawImage(idleCanvas, 0, 0);
  const texture = new THREE.CanvasTexture(displayCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.name = "Walker card";

  const width = WALKER_HEIGHT * (cardWidth / Math.max(1, cardHeight));
  const geometry = new THREE.PlaneGeometry(width, WALKER_HEIGHT);
  geometry.name = "Walker card";
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Walker sprite",
    map: texture,
    transparent: true,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.userData.rtxIgnore = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Walker";
  mesh.userData.rtxIgnore = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.rotation.y = Math.PI;

  const spawn = spawnOnRoad(-4);
  const position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  let facing = 1;
  let moving = false;
  let bob = 0;
  let walkTime = 0;
  let shown = idleCanvas;

  function showCanvas(source) {
    if (shown === source) return;
    shown = source;
    displayContext.clearRect(0, 0, cardWidth, cardHeight);
    displayContext.drawImage(source, 0, 0);
    texture.needsUpdate = true;
  }

  function place() {
    mesh.position.set(position.x, position.y + WALKER_HEIGHT * 0.5 + bob, position.z);
    // rotation.y = PI maps local +X to world -X, so a +X run uses scale.x = -1.
    mesh.scale.set(facing, 1, 1);
  }
  place();

  return {
    mesh,
    position,
    get moving() { return moving; },
    update(delta, axis) {
      const speed = axis.sprint ? SPRINT_SPEED : WALK_SPEED;
      // Camera looks inland (+Z), so world +X is screen-left. Invert X so
      // A walks left and D walks right.
      const nextX = position.x - axis.x * speed * delta;
      const nextZ = position.z + axis.z * speed * delta;
      const clamped = clampToBank(nextX, nextZ);
      moving = Math.hypot(axis.x, axis.z) > 0.01;
      if (axis.x > 0.12) facing = 1;
      else if (axis.x < -0.12) facing = -1;
      position.set(clamped.x, terrainHeight(clamped.x, clamped.z), clamped.z);

      if (moving && walkCanvases.length > 0) {
        bob = 0;
        walkTime += Math.max(0, delta);
        const frameIndex = Math.floor(walkTime * WALK_FPS) % walkCanvases.length;
        showCanvas(walkCanvases[frameIndex]);
      } else {
        walkTime = 0;
        showCanvas(idleCanvas);
        bob = moving ? Math.abs(Math.sin(performance.now() * 0.011)) * 0.035 : 0;
      }
      place();
      return { moving, facing, speed };
    },
    setTint(color) {
      material.color.set(color);
    },
    dispose() {
      geometry.dispose();
      texture.dispose();
      material.dispose();
    },
  };
}
