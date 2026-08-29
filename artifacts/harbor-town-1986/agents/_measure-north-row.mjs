import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodePng } from "../../../ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/png.mjs";
import { keyedViewFromRgba } from "../../../ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/silhouette.mjs";
import { magentaKeyAlpha } from "../../../ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/chroma-key.mjs";

const root = "C:/ThreeBrowser/ThreeBrowserRuntime/samples/harbor_town_1986/assets";
const shops = [
  { id: "tobacco-shop", realHeight: 7.0, realWidth: 6.4, realDepth: 7.2 },
  { id: "soba-shop", realHeight: 7.2, realWidth: 6.4, realDepth: 8.2 },
  { id: "greengrocer", realHeight: 6.9, realWidth: 6.2, realDepth: 7.4 },
  { id: "you-arcade", realHeight: 7.8, realWidth: 8.0, realDepth: 10 },
  { id: "cassette-shop", realHeight: 7.1, realWidth: 6.8, realDepth: 8.0 },
];
const files = ["yaw-000.png", "yaw-090.png"];

function grokWatermark(data, width, height) {
  const x0 = Math.floor(width * 0.72);
  const y0 = Math.floor(height * 0.90);
  let dark = 0;
  let total = 0;
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      const i = (y * width + x) * 4;
      total += 1;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma < 90 && magentaKeyAlpha(r, g, b) !== 0) dark += 1;
    }
  }
  return { dark, total, frac: dark / Math.max(1, total) };
}

function bottomRowKeyed(occupancy, width, height) {
  const y = height - 1;
  let filled = 0;
  for (let x = 0; x < width; x++) filled += occupancy[y * width + x];
  const midY = Math.floor(height * 0.55);
  let mid = 0;
  for (let x = 0; x < width; x++) mid += occupancy[midY * width + x];
  return { bottomFrac: filled / width, midFrac: mid / width };
}

for (const shop of shops) {
  for (const file of files) {
    const buf = await readFile(join(root, shop.id, file));
    const png = decodePng(buf);
    const view = keyedViewFromRgba(png.data, png.width, png.height, { yaw: file.includes("000") ? 0 : 90 });
    const b = view.bounds;
    const aspect = b.width / b.height;
    const catalogFront = shop.realWidth / shop.realHeight;
    const catalogSide = shop.realDepth / shop.realHeight;
    const catalog = file.includes("000") ? catalogFront : catalogSide;
    const impliedWidth = aspect * shop.realHeight;
    const wm = grokWatermark(png.data, png.width, png.height);
    const floor = bottomRowKeyed(view.occupancy, png.width, png.height);
    const impliedMetres = {
      spanX: (b.width * view.worldPerPixel) * shop.realHeight,
      spanY: shop.realHeight,
    };
    console.log(JSON.stringify({
      shop: shop.id,
      file,
      canvas: `${png.width}x${png.height}`,
      bounds: { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, w: b.width, h: b.height },
      fill: Number((b.width * b.height / (png.width * png.height)).toFixed(3)),
      aspect: Number(aspect.toFixed(3)),
      catalogAspect: Number(catalog.toFixed(3)),
      impliedMetresIfHeightLocked: Number(impliedWidth.toFixed(2)),
      catalogMetres: file.includes("000") ? shop.realWidth : shop.realDepth,
      deltaM: Number((impliedWidth - (file.includes("000") ? shop.realWidth : shop.realDepth)).toFixed(2)),
      watermarkDarkFrac: Number(wm.frac.toFixed(4)),
      bottomRowFill: Number(floor.bottomFrac.toFixed(3)),
      midRowFill: Number(floor.midFrac.toFixed(3)),
      maxCamX: Number(view.maxCamX.toFixed(3)),
    }));
  }
}
