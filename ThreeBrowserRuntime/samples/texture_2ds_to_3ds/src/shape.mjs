function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function coefficientOfVariation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  if (average <= 1e-8) return 0;
  let sumSq = 0;
  for (const value of values) {
    const d = value - average;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length) / average;
}

export function silhouetteStats(view) {
  const { occupancy, width, height, bounds } = view;
  let area = 0;
  let perimeter = 0;
  const minX = bounds?.minX ?? 0;
  const maxX = bounds?.maxX ?? width - 1;
  const minY = bounds?.minY ?? 0;
  const maxY = bounds?.maxY ?? height - 1;
  for (let y = minY; y <= maxY; y++) {
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      if (!occupancy[row + x]) continue;
      area += 1;
      if (x === 0 || !occupancy[row + x - 1]) perimeter += 1;
      if (x === width - 1 || !occupancy[row + x + 1]) perimeter += 1;
      if (y === 0 || !occupancy[row + x - width]) perimeter += 1;
      if (y === height - 1 || !occupancy[row + x + width]) perimeter += 1;
    }
  }
  const spanX = Math.max(1, (bounds?.width ?? (maxX - minX + 1)));
  const spanY = Math.max(1, (bounds?.height ?? (maxY - minY + 1)));
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  return {
    area,
    perimeter,
    spanX,
    spanY,
    aspect: spanX / spanY,
    circularity,
  };
}

export function silhouetteIoU(a, b) {
  const left = a.occupancy;
  const right = b.occupancy;
  const count = Math.min(left.length, right.length);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < count; i++) {
    const hit = left[i] || right[i];
    if (!hit) continue;
    union += 1;
    if (left[i] && right[i]) inter += 1;
  }
  return union > 0 ? inter / union : 0;
}

function viewByYaw(views, yaw) {
  return views.find(view => Math.abs((view.yaw ?? 0) - yaw) < 1);
}

function widthProfile(view, bins = 8) {
  const { occupancy, width, bounds } = view;
  const spanY = Math.max(1, bounds?.height ?? 1);
  const minY = bounds?.minY ?? 0;
  const minX = bounds?.minX ?? 0;
  const maxX = bounds?.maxX ?? width - 1;
  const profile = [];
  for (let bin = 0; bin < bins; bin++) {
    const y0 = minY + Math.floor(bin * spanY / bins);
    const y1 = minY + Math.floor((bin + 1) * spanY / bins);
    let left = width;
    let right = -1;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = minX; x <= maxX; x++) {
        if (!occupancy[row + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    profile.push(right >= left ? right - left + 1 : 0);
  }
  return profile;
}

function meanProfile(views) {
  const profiles = views.map(view => widthProfile(view));
  if (!profiles.length) return [];
  const bins = profiles[0].length;
  const output = [];
  for (let bin = 0; bin < bins; bin++) {
    output.push(mean(profiles.map(profile => profile[bin])));
  }
  return output;
}

function bandWidth(view, t0, t1) {
  const { occupancy, width, bounds } = view;
  const spanY = Math.max(1, bounds?.height ?? 1);
  const minY = bounds?.minY ?? 0;
  const minX = bounds?.minX ?? 0;
  const maxX = bounds?.maxX ?? width - 1;
  const y0 = minY + Math.floor(Math.min(t0, t1) * spanY);
  const y1 = minY + Math.max(1, Math.floor(Math.max(t0, t1) * spanY));
  let left = width;
  let right = -1;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      if (!occupancy[row + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return right >= left ? right - left + 1 : 0;
}

/**
 * Detect capsule / cylinder / square / rectangle / custom from orbit silhouettes.
 * Generic primitives reconstruct from 4 cardinal sides; custom shapes use 8.
 */
export function classifyOrbitShape(views) {
  const list = Array.isArray(views) ? views : [];
  const stats = list.map(silhouetteStats);
  const aspects = stats.map(item => item.aspect);
  const circularities = stats.map(item => item.circularity);
  const aspectCv = coefficientOfVariation(aspects);
  const meanCircularity = mean(circularities);

  const pairs = [];
  const cardinal = [0, 90, 180, 270]
    .map(yaw => viewByYaw(list, yaw))
    .filter(Boolean);
  for (let i = 0; i < cardinal.length; i++) {
    const next = cardinal[(i + 1) % cardinal.length];
    if (next && cardinal[i] !== next) pairs.push(silhouetteIoU(cardinal[i], next));
  }
  if (!pairs.length && list.length >= 2) {
    for (let i = 0; i < list.length; i++) {
      pairs.push(silhouetteIoU(list[i], list[(i + 1) % list.length]));
    }
  }
  const meanCardinalIoU = mean(pairs);

  const front = viewByYaw(list, 0) ?? list[0];
  const side = viewByYaw(list, 90) ?? list[Math.min(1, list.length - 1)];
  const back = viewByYaw(list, 180);
  const diagonal = viewByYaw(list, 45);
  const frontStats = front ? silhouetteStats(front) : null;
  const sideStats = side ? silhouetteStats(side) : null;
  const backStats = back ? silhouetteStats(back) : null;
  const diagonalStats = diagonal ? silhouetteStats(diagonal) : null;
  const planDelta = frontStats && sideStats
    ? Math.abs(frontStats.aspect - sideStats.aspect) / Math.max(frontStats.aspect, sideStats.aspect, 1e-6)
    : 0;
  const diagonalRatio = frontStats && diagonalStats
    ? diagonalStats.spanX / Math.max(1, frontStats.spanX)
    : 1;
  const hasCorners = diagonalRatio > 1.16;

  const profile = meanProfile(list);
  const crown = mean(profile.slice(0, 3));
  const trunk = mean(profile.slice(-2));
  const flared = trunk > 1 && crown > trunk * 1.35;
  const pole = mean(list.map(view => bandWidth(view, 0, 0.05)));
  const waist = mean(list.map(view => bandWidth(view, 0.42, 0.58)));
  const foot = mean(list.map(view => bandWidth(view, 0.95, 1)));
  const taperCrown = waist > 1 ? pole / waist : 1;
  const taperBase = waist > 1 ? foot / waist : 1;
  const organic = meanCircularity < 0.22;
  const rotationallySymmetric = aspectCv < 0.12 && meanCardinalIoU > 0.85 && !hasCorners;
  const capsuleLike = rotationallySymmetric
    && taperCrown < 0.78
    && taperBase < 0.78
    && Math.abs(taperCrown - taperBase) < 0.25;
  const cylinderLike = rotationallySymmetric && !capsuleLike;
  const squareLike = hasCorners && planDelta < 0.14 && !flared && !organic;
  const rectangleLike = !organic && (
    (hasCorners && planDelta >= 0.14)
    || (planDelta > 0.18 && !rotationallySymmetric)
  );

  const skinny = mean(stats.map(item => item.aspect)) < 0.55;
  const humanoidLike = organic && skinny && !flared && planDelta > 0.1;

  let kind = "custom";
  if (humanoidLike) kind = "humanoid";
  else if (organic || flared) kind = "custom";
  else if (capsuleLike) kind = "capsule";
  else if (cylinderLike) kind = "cylinder";
  else if (squareLike) kind = "square";
  else if (rectangleLike) kind = "rectangle";

  const generic = kind !== "custom" && kind !== "humanoid";
  const recommendedCount = kind === "cylinder" || kind === "capsule"
    ? 2
    : kind === "humanoid" || kind === "custom"
      ? 8
      : generic
        ? 4
        : 8;
  return {
    generic,
    kind,
    recommendedCount,
    aspectCv,
    meanCircularity,
    meanCardinalIoU,
    flared,
    taperCrown,
    taperBase,
    planDelta,
    diagonalRatio,
  };
}
