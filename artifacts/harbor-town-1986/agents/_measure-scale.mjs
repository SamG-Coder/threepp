import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodePng } from "../../../ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/png.mjs";
import { keyedViewFromRgba } from "../../../ThreeBrowserRuntime/samples/texture_2ds_to_3ds/src/silhouette.mjs";

const root = "C:/ThreeBrowser/ThreeBrowserRuntime/samples/harbor_town_1986/assets";
const subjects = [
  { id: "soba-shop", realHeight: 7.2, realWidth: 6.4, realDepth: 8.2 },
  { id: "you-arcade", realHeight: 7.8, realWidth: 8.0, realDepth: 10 },
  { id: "harbor-warehouse-8", realHeight: 9.5, realWidth: 14, realDepth: 18 },
  { id: "vending-enamel", realHeight: 1.82, realWidth: 0.9, realDepth: 0.72 },
  { id: "phone-booth", realHeight: 2.4, realWidth: 0.9, realDepth: 0.9 },
  { id: "telephone-pole", realHeight: 10, realWidth: 0.35, realDepth: 0.35 },
  { id: "civilian-hiro", realHeight: 1.72, realWidth: 0.52, realDepth: 0.32 },
  { id: "wooden-hill-house", realHeight: 7.4, realWidth: 8.2, realDepth: 7.6 },
  { id: "yokobori-bar", realHeight: 8.1, realWidth: 6.2, realDepth: 7.4 },
  { id: "flower-shop", realHeight: 6.8, realWidth: 6.6, realDepth: 7.8 },
  { id: "cassette-shop", realHeight: 7.1, realWidth: 6.8, realDepth: 8.0 },
  { id: "greengrocer", realHeight: 6.9, realWidth: 6.2, realDepth: 7.4 },
  { id: "tobacco-shop", realHeight: 7.0, realWidth: 6.4, realDepth: 7.2 },
  { id: "harbor-warehouse-3", realHeight: 8.2, realWidth: 16, realDepth: 12 },
  { id: "kei-van", realHeight: 1.78, realWidth: 1.4, realDepth: 3.2 },
];

function measure(view) {
  const b = view.bounds;
  const aspect = b.width / b.height;
  const occ = view.occupancy;
  const w = view.width;
  const h = view.height;
  let filled = 0;
  for (let i = 0; i < occ.length; i++) filled += occ[i];
  const yBottom = b.maxY;
  const yMid = Math.round((b.minY + b.maxY) / 2);
  const yDoor = Math.round(b.maxY - b.height * 0.22);
  const rowFill = (y) => {
    let n = 0;
    for (let x = b.minX; x <= b.maxX; x++) n += occ[y * w + x];
    return n / Math.max(1, b.width);
  };
  const colFill = (x) => {
    let n = 0;
    for (let y = b.minY; y <= b.maxY; y++) n += occ[y * w + x];
    return n / Math.max(1, b.height);
  };
  let leftSolid = b.minX;
  let rightSolid = b.maxX;
  while (leftSolid < b.maxX && colFill(leftSolid) < 0.08) leftSolid += 1;
  while (rightSolid > b.minX && colFill(rightSolid) < 0.08) rightSolid -= 1;
  const solidW = rightSolid - leftSolid + 1;
  return {
    canvas: `${w}x${h}`,
    bounds: { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, w: b.width, h: b.height },
    aspect: Number(aspect.toFixed(3)),
    fill: Number((filled / (w * h)).toFixed(3)),
    bboxFill: Number((filled / (b.width * b.height)).toFixed(3)),
    bottomRow: Number(rowFill(Math.min(h - 1, yBottom)).toFixed(3)),
    midRow: Number(rowFill(yMid).toFixed(3)),
    doorRow: Number(rowFill(Math.min(h - 1, Math.max(0, yDoor))).toFixed(3)),
    solidAspect: Number((solidW / b.height).toFixed(3)),
    marginTop: b.minY,
    marginBottom: h - 1 - b.maxY,
  };
}

for (const subject of subjects) {
  for (const file of ["yaw-000.png", "yaw-090.png"]) {
    const path = join(root, subject.id, file);
    let buf;
    try {
      buf = await readFile(path);
    } catch {
      continue;
    }
    const png = decodePng(buf);
    const view = keyedViewFromRgba(png.data, png.width, png.height, {
      yaw: file.includes("000") ? 0 : 90,
    });
    const m = measure(view);
    const catalogSpan = file.includes("000") ? subject.realWidth : subject.realDepth;
    const implied = m.aspect * subject.realHeight;
    const impliedSolid = m.solidAspect * subject.realHeight;
    console.log(JSON.stringify({
      id: subject.id,
      file,
      catalog: `${subject.realHeight}x${subject.realWidth}x${subject.realDepth}`,
      catalogSpan,
      impliedIfHLocked: Number(implied.toFixed(2)),
      impliedSolidIfHLocked: Number(impliedSolid.toFixed(2)),
      delta: Number((implied - catalogSpan).toFixed(2)),
      ...m,
    }));
  }
}
