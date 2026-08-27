import { classifyOrbitShape } from "./shape.mjs";
import { CANDIDATE_VIEW_COUNTS, equallySpacedSubset } from "./views.mjs";
import { carveVisualHull } from "./visual-hull.mjs";
import { matchAllSlices } from "./slice-match.mjs";

export function scoreViewSet(carveViews, probeViews = carveViews, options = {}) {
  const volume = carveVisualHull(carveViews, options);
  const slices = matchAllSlices(volume, probeViews, options);
  const fill = volume.filled / Math.max(1, volume.occupancy.length);
  const tightness = 1 - fill;
  const score = slices.meanIoU * 0.72 + tightness * 0.28;
  return {
    viewCount: carveViews.length,
    yaws: carveViews.map(view => view.yaw),
    filled: volume.filled,
    fill,
    tightness,
    meanIoU: slices.meanIoU,
    minIoU: slices.minIoU,
    score,
    volume,
    slices,
  };
}

export function chooseOrbitAngles(views, options = {}) {
  const shape = options.shape ?? classifyOrbitShape(views);
  const counts = options.counts ?? CANDIDATE_VIEW_COUNTS;
  const candidates = counts
    .map(count => equallySpacedSubset(views, count))
    .filter(set => set.length >= 2)
    .map(set => scoreViewSet(set, views, options));

  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.02) return b.score - a.score;
    if (Math.abs(b.meanIoU - a.meanIoU) > 0.015) return b.meanIoU - a.meanIoU;
    return b.viewCount - a.viewCount;
  });

  const preferredCount = options.forceCount
    ?? shape.recommendedCount
    ?? (shape.generic ? 4 : 8);
  const preferred = candidates.find(candidate => candidate.viewCount === preferredCount)
    ?? candidates[0];

  return {
    chosen: preferred,
    candidates,
    recommendedCount: preferred.viewCount,
    shape,
  };
}
