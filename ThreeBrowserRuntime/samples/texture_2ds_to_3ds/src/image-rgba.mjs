import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

function makeCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  return null;
}

export async function loadRgba(url) {
  if (typeof fetch === "function" && typeof createImageBitmap === "function") {
    const href = url.href || String(url);
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Failed to load ${href} (${response.status})`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    if (canvas) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close?.();
      return { width: imageData.width, height: imageData.height, data: imageData.data };
    }
    bitmap.close?.();
  }

  const path = url instanceof URL ? fileURLToPath(url) : String(url);
  return decodePng(await readFile(path));
}
