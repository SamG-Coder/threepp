import * as THREE from "three/webgpu";
import { keyedCanvasFromImage } from "./chroma-key.mjs";

const FILES = Object.freeze({
  dirt: "dirt.jpg",
  grass: "grass.jpg",
  litter: "litter.jpg",
  mud: "mud.jpg",
});

function patchWatermark(image) {
  const width = image.width || image.displayWidth;
  const height = image.height || image.displayHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const stampW = Math.floor(width * 0.22);
  const stampH = Math.floor(height * 0.08);
  const sx = Math.max(0, width - stampW * 3);
  const sy = Math.max(0, height - stampH * 3);
  context.drawImage(canvas, sx, sy, stampW, stampH, width - stampW, height - stampH, stampW, stampH);
  return canvas;
}

async function loadMap(file) {
  const url = new URL(`../assets/ground/${file}`, import.meta.url);
  const texture = await new THREE.TextureLoader().loadAsync(url.href);
  if (texture.image) texture.image = patchWatermark(texture.image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.name = file;
  return texture;
}

async function loadBankFace() {
  const url = new URL("../assets/ground/bank-face.jpg", import.meta.url);
  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`Failed to load bank-face (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  const keyed = keyedCanvasFromImage(bitmap, { padding: 1, erode: 1 });
  if (typeof bitmap.close === "function") bitmap.close();
  const texture = new THREE.CanvasTexture(keyed.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.name = "bank-face.jpg";
  return texture;
}

export async function loadGroundTextures() {
  const maps = {};
  for (const [key, file] of Object.entries(FILES)) {
    maps[key] = await loadMap(file);
  }
  try {
    maps.bank = await loadBankFace();
  } catch (error) {
    console.warn(`[Secret River] bank-face texture skipped: ${error?.message || error}`);
  }
  return maps;
}
