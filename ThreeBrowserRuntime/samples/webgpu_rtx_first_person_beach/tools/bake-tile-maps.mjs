import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, grayToRgba } from "../src/tile-png.mjs";
import { TILE_SPECS, bakeTileMaps } from "../src/tile-relief.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, "assets", "source");
const outDir = join(root, "assets", "textures");

function resizeRgba(source, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) return source;
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = ((y + 0.5) * height / targetHeight) - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sourceY - Math.floor(sourceY);
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = ((x + 0.5) * width / targetWidth) - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sourceX - Math.floor(sourceX);
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source[(y0 * width + x0) * 4 + channel] * (1 - fx)
          + source[(y0 * width + x1) * 4 + channel] * fx;
        const bottom = source[(y1 * width + x0) * 4 + channel] * (1 - fx)
          + source[(y1 * width + x1) * 4 + channel] * fx;
        output[(y * targetWidth + x) * 4 + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return output;
}

async function bakeOne(name, spec) {
  const source = decodePng(await readFile(join(sourceDir, `${name}.png`)));
  const outputSize = spec.outputSize ?? source.width;
  const square = resizeRgba(source.data, source.width, source.height, outputSize, outputSize);
  const maps = bakeTileMaps(square, outputSize, outputSize, spec);
  await writeFile(join(outDir, `${name}-albedo.png`), encodePng(maps.width, maps.height, maps.albedo));
  if (maps.heightMap) {
    await writeFile(
      join(outDir, `${name}-height.png`),
      encodePng(maps.width, maps.height, grayToRgba(maps.heightMap), { grayscale: true }),
    );
  }
  if (maps.normal) {
    await writeFile(join(outDir, `${name}-normal.png`), encodePng(maps.width, maps.height, maps.normal));
  }
  if (maps.preview) {
    await writeFile(
      join(outDir, `${name}-tile-preview.png`),
      encodePng(maps.preview.width, maps.preview.height, maps.preview.data),
    );
  }
  console.log(
    `[bake-tile-maps] ${name}: ${maps.width}x${maps.height}` +
    ` albedo/height/normal mode=${spec.mode} gain=${spec.heightGain}`,
  );
}

await mkdir(outDir, { recursive: true });
const requested = new Set(process.argv.slice(2));
for (const [name, spec] of Object.entries(TILE_SPECS)) {
  if (requested.size && !requested.has(name)) continue;
  await bakeOne(name, spec);
}
