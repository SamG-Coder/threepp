import { chooseOrbitAngles } from "./angles.mjs";
import { bakeVoxelColors } from "./color-bake.mjs";
import { extractIsosurface } from "./isosurface.mjs";
import { loadRgba } from "./image-rgba.mjs";
import { realWorldScale } from "./real-scale.mjs";
import { classifyOrbitShape } from "./shape.mjs";
import {
  blurField,
  chamferSignedDistance,
  estimateDepthMaps,
  fuseDepthMaps,
  occupancyFromSdf,
} from "./mvs-tsdf.mjs";
import { carvePhotoconsistent } from "./photoconsistency.mjs";
import { keyedViewFromRgba, resizeView } from "./silhouette.mjs";
import { estimateCanopyStart, hollowCanopy } from "./structure.mjs";
import { matchAllSlices } from "./slice-match.mjs";
import { bakeMaterialMaps } from "./unwrap.mjs";
import { snapOccupancyToPrimitive } from "./primitive-fit.mjs";
import { ORBIT_VIEWS, pickViewsForShape } from "./views.mjs";
import { DEFAULT_RESOLUTION, carveVisualHull } from "./visual-hull.mjs";

export const ORBIT_ASSET = Object.freeze({
  resolution: DEFAULT_RESOLUTION,
  silhouetteSize: 160,
  mapSize: 512,
  views: ORBIT_VIEWS,
});

export const TREE_ASSET = ORBIT_ASSET;

export const ORBIT_SUBJECTS = Object.freeze([
  {
    id: "english-oak",
    folder: "tree",
    label: "English oak",
    x: -10,
    z: 0,
    realHeight: 15,
    realWidth: 14,
  },
  {
    id: "weeping-willow",
    folder: "willow",
    label: "Weeping willow",
    x: 10,
    z: 0,
    realHeight: 12,
    realWidth: 12,
  },
  {
    id: "steel-trash-can",
    folder: "trash-can",
    label: "Steel trash can",
    x: 0,
    z: 9,
    realHeight: 0.75,
    realWidth: 0.54,
  },
]);

export async function loadOrbitViews(assetRoot, catalog = ORBIT_VIEWS, folder = "tree") {
  const views = [];
  for (const entry of catalog) {
    const url = new URL(`../assets/${folder}/${entry.file}`, assetRoot);
    const image = await loadRgba(url);
    views.push(keyedViewFromRgba(image.data, image.width, image.height, entry));
  }
  return views;
}

export function reconstructFromViews(views, options = {}) {
  const silhouetteSize = options.silhouetteSize ?? ORBIT_ASSET.silhouetteSize;
  const resolution = options.resolution ?? ORBIT_ASSET.resolution;
  const working = views.map(view => resizeView(view, silhouetteSize));
  const shape = options.shape ?? classifyOrbitShape(working);
  const selection = chooseOrbitAngles(working, {
    resolution: options.angleResolution ?? Math.min(48, resolution),
    shape,
    forceCount: options.forceCount,
  });
  const chosen = pickViewsForShape(working, shape);
  const volume = carveVisualHull(chosen, { resolution });
  if (shape.kind === "cylinder" || shape.kind === "capsule") {
    snapOccupancyToPrimitive(volume, shape);
  } else {
    carvePhotoconsistent(volume, working, {
      iterations: options.photoIterations ?? 4,
      threshold: options.photoThreshold ?? 96,
    });
  }
  const canopyY = options.canopyY ?? estimateCanopyStart(working);
  if (options.hollowCanopy === true && shape.kind === "custom") {
    hollowCanopy(volume, canopyY, options.canopyThickness ?? 2.6);
  }
  bakeVoxelColors(volume, views);
  const afterPhoto = volume.filled;
  const snapshot = Uint8Array.from(volume.occupancy);
  let sdf = chamferSignedDistance(volume);
  if (options.mvs === true) {
    const depths = estimateDepthMaps(volume, working, { steps: options.depthSteps ?? 24 });
    sdf = fuseDepthMaps(volume, working, depths, sdf);
    volume.depthMaps = depths;
    sdf = blurField(sdf, resolution);
  }
  occupancyFromSdf(volume, sdf);
  if (volume.filled < afterPhoto * 0.4) {
    volume.occupancy.set(snapshot);
    volume.filled = afterPhoto;
    sdf = chamferSignedDistance(volume);
    occupancyFromSdf(volume, sdf);
  }
  volume.canopyY = canopyY;
  const slices = matchAllSlices(volume, working);
  const primitive = shape.kind === "cylinder" || shape.kind === "capsule";
  const mesh = extractIsosurface(volume, sdf, views, {
    smoothIterations: options.smoothIterations ?? (primitive ? 12 : 8),
    smoothLambda: options.smoothLambda ?? (primitive ? 0.5 : 0.45),
    shape,
  });
  const maps = bakeMaterialMaps(volume, {
    width: options.mapSize ?? ORBIT_ASSET.mapSize,
    height: options.mapSize ?? ORBIT_ASSET.mapSize,
    shape,
    views,
  });
  return {
    views,
    working,
    chosen,
    selection,
    shape,
    volume,
    slices,
    mesh,
    maps,
  };
}

export async function reconstructOrbitAsset(options = {}) {
  const assetRoot = options.assetRoot ?? import.meta.url;
  const views = await loadOrbitViews(
    assetRoot,
    options.catalog ?? ORBIT_VIEWS,
    options.folder ?? "tree",
  );
  return reconstructFromViews(views, options);
}

export const reconstructTreeAsset = reconstructOrbitAsset;

export function assetReport(asset) {
  const { selection, slices, volume, mesh, chosen, shape } = asset;
  return {
    recommendedCount: selection.recommendedCount,
    generic: Boolean(shape?.generic),
    kind: shape?.kind ?? selection.shape?.kind ?? "complex",
    yaws: chosen.map(view => view.yaw),
    filled: volume.filled,
    photoCarved: volume.photoCarved ?? 0,
    meanIoU: slices.meanIoU,
    minIoU: slices.minIoU,
    vertices: mesh.vertexCount,
    triangles: mesh.triangleCount,
    candidates: selection.candidates.map(candidate => ({
      viewCount: candidate.viewCount,
      meanIoU: Number(candidate.meanIoU.toFixed(4)),
      minIoU: Number(candidate.minIoU.toFixed(4)),
      filled: candidate.filled,
      score: Number(candidate.score.toFixed(4)),
    })),
    slices: slices.matches.map(match => ({
      yaw: match.yaw,
      iou: Number(match.iou.toFixed(4)),
    })),
    scale: asset.subject ? realWorldScale(mesh, asset.subject) : null,
  };
}
