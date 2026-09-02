import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, grayToRgba } from "../src/tile-png.mjs";
import { TILE_SPECS, bakeTileMaps } from "../src/tile-relief.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, "assets", "source");
const outDir = join(root, "assets", "textures");

async function bakeOne(name, spec) {
  const source = decodePng(await readFile(join(sourceDir, `${name}.png`)));
  const maps = bakeTileMaps(source.data, source.width, source.height, spec);
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
for (const [name, spec] of Object.entries(TILE_SPECS)) {
  await bakeOne(name, spec);
}
