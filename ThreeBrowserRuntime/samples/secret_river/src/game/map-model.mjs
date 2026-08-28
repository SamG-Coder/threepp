import { MAP_DATA } from "./map-data.generated.mjs";

const EARTH_RADIUS_METRES = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-9;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(EPSILON, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function validCoordinate(value, label) {
  if (!Array.isArray(value) || value.length < 2
      || !Number.isFinite(Number(value[0])) || !Number.isFinite(Number(value[1]))) {
    throw new TypeError(`${label} must be a [longitude, latitude] WGS84 coordinate.`);
  }
  return [Number(value[0]), Number(value[1])];
}

function normaliseCrop(crop, fallback) {
  if (Array.isArray(crop)) {
    if (crop.length < 4) throw new TypeError("Map crop needs west, south, east and north.");
    crop = { west: crop[0], south: crop[1], east: crop[2], north: crop[3] };
  }
  const result = {
    west: Number(crop?.west ?? fallback.west),
    south: Number(crop?.south ?? fallback.south),
    east: Number(crop?.east ?? fallback.east),
    north: Number(crop?.north ?? fallback.north),
  };
  if (!Object.values(result).every(Number.isFinite)
      || result.west >= result.east || result.south >= result.north) {
    throw new RangeError("Map crop must be a valid WGS84 bounding box.");
  }
  return Object.freeze(result);
}

function normaliseBounds(bounds) {
  if (!bounds) return null;
  const result = {
    minX: Number(bounds.minX),
    maxX: Number(bounds.maxX),
    minZ: Number(bounds.minZ),
    maxZ: Number(bounds.maxZ),
  };
  if (!Object.values(result).every(Number.isFinite)
      || result.minX >= result.maxX || result.minZ >= result.maxZ) {
    throw new RangeError("Map worldBounds must contain finite, increasing X/Z limits.");
  }
  return Object.freeze(result);
}

function featureBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function boundsOverlap(a, b) {
  return a.maxX >= b.minX && a.minX <= b.maxX
    && a.maxZ >= b.minZ && a.minZ <= b.maxZ;
}

function segmentDistanceSquared(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > EPSILON
    ? clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSquared, 0, 1)
    : 0;
  const nearestX = a.x + dx * t;
  const nearestZ = a.z + dz * t;
  const offsetX = x - nearestX;
  const offsetZ = z - nearestZ;
  return offsetX * offsetX + offsetZ * offsetZ;
}

function distanceToLines(x, z, lines) {
  let nearestSquared = Infinity;
  for (const line of lines) {
    if (x < line.bounds.minX - Math.sqrt(nearestSquared)
        || x > line.bounds.maxX + Math.sqrt(nearestSquared)
        || z < line.bounds.minZ - Math.sqrt(nearestSquared)
        || z > line.bounds.maxZ + Math.sqrt(nearestSquared)) continue;
    for (let index = 1; index < line.points.length; index++) {
      nearestSquared = Math.min(
        nearestSquared,
        segmentDistanceSquared(x, z, line.points[index - 1], line.points[index]),
      );
    }
  }
  return Math.sqrt(nearestSquared);
}

function outCode(point, bounds) {
  let code = 0;
  if (point.x < bounds.minX) code |= 1;
  else if (point.x > bounds.maxX) code |= 2;
  if (point.z < bounds.minZ) code |= 4;
  else if (point.z > bounds.maxZ) code |= 8;
  return code;
}

function clipSegment(a, b, bounds) {
  let start = { ...a };
  let end = { ...b };
  let startCode = outCode(start, bounds);
  let endCode = outCode(end, bounds);
  while (true) {
    if (!(startCode | endCode)) return [start, end];
    if (startCode & endCode) return null;
    const code = startCode || endCode;
    let x;
    let z;
    if (code & 8) {
      z = bounds.maxZ;
      const delta = end.z - start.z;
      x = start.x + (end.x - start.x) * (z - start.z) / (Math.abs(delta) < EPSILON ? EPSILON : delta);
    } else if (code & 4) {
      z = bounds.minZ;
      const delta = end.z - start.z;
      x = start.x + (end.x - start.x) * (z - start.z) / (Math.abs(delta) < EPSILON ? EPSILON : delta);
    } else if (code & 2) {
      x = bounds.maxX;
      const delta = end.x - start.x;
      z = start.z + (end.z - start.z) * (x - start.x) / (Math.abs(delta) < EPSILON ? EPSILON : delta);
    } else {
      x = bounds.minX;
      const delta = end.x - start.x;
      z = start.z + (end.z - start.z) * (x - start.x) / (Math.abs(delta) < EPSILON ? EPSILON : delta);
    }
    const point = { x, z };
    if (code === startCode) {
      start = point;
      startCode = outCode(start, bounds);
    } else {
      end = point;
      endCode = outCode(end, bounds);
    }
  }
}

function clipPolyline(points, bounds) {
  const parts = [];
  let active = [];
  for (let index = 1; index < points.length; index++) {
    const clipped = clipSegment(points[index - 1], points[index], bounds);
    if (!clipped) {
      if (active.length > 1) parts.push(active);
      active = [];
      continue;
    }
    const [start, end] = clipped;
    const tail = active.at(-1);
    if (tail && Math.abs(tail.x - start.x) < 1e-7 && Math.abs(tail.z - start.z) < 1e-7) {
      active.push(end);
    } else {
      if (active.length > 1) parts.push(active);
      active = [start, end];
    }
  }
  if (active.length > 1) parts.push(active);
  return parts;
}

function hash2(x, z, seed) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x, z, seed) {
  return valueNoise(x, z, seed) * 0.61
    + valueNoise(x * 2.07, z * 2.13, seed + 7) * 0.27
    + valueNoise(x * 4.19, z * 4.31, seed + 19) * 0.12;
}

/** Convert one compact-map point back to the WGS84 source coordinate. */
export function normalizedMapPointToWgs84(point, sourceBounds = MAP_DATA.bounds) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("A compact map point must contain two finite numbers.");
  }
  return [
    sourceBounds.west + x * (sourceBounds.east - sourceBounds.west),
    sourceBounds.north - y * (sourceBounds.north - sourceBounds.south),
  ];
}

/**
 * Equirectangular local projection centred on a WGS84 origin.
 * X points east; before optional rotation, +Z points south to match map pixels.
 */
export function projectWgs84ToLocal(coordinate, options) {
  const [longitude, latitude] = validCoordinate(coordinate, "coordinate");
  const [originLongitude, originLatitude] = validCoordinate(options?.origin, "origin");
  const scale = Number(options?.worldUnitsPerMetre ?? options?.worldUnitsPerMeter ?? 1);
  if (!(scale > 0)) throw new RangeError("worldUnitsPerMetre must be positive.");
  const rotation = Number(options?.rotationDegrees ?? 0) * DEG_TO_RAD;
  const offset = Array.isArray(options?.offset)
    ? { x: Number(options.offset[0]) || 0, z: Number(options.offset[1]) || 0 }
    : { x: Number(options?.offset?.x) || 0, z: Number(options?.offset?.z) || 0 };
  const eastMetres = (longitude - originLongitude) * DEG_TO_RAD
    * EARTH_RADIUS_METRES * Math.cos(originLatitude * DEG_TO_RAD);
  const northMetres = (latitude - originLatitude) * DEG_TO_RAD * EARTH_RADIUS_METRES;
  const east = eastMetres * scale;
  const south = -northMetres * scale;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: east * cosine - south * sine + offset.x,
    z: east * sine + south * cosine + offset.z,
    eastMetres,
    northMetres,
  };
}

/** Even/odd polygon-ring test with boundary points treated as inside. */
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[previous];
    const b = ring[current];
    if (segmentDistanceSquared(x, z, a, b) < 1e-12) return true;
    const crosses = (a.z > z) !== (b.z > z)
      && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(x, z, polygon) {
  if (!boundsOverlap({ minX: x, maxX: x, minZ: z, maxZ: z }, polygon.bounds)) return false;
  if (!pointInRing(x, z, polygon.rings[0])) return false;
  return !polygon.rings.slice(1).some(ring => pointInRing(x, z, ring));
}

function distanceToPolygonBoundary(x, z, polygons) {
  let nearestSquared = Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon.rings) {
      for (let index = 0; index < ring.length; index++) {
        nearestSquared = Math.min(
          nearestSquared,
          segmentDistanceSquared(x, z, ring[index], ring[(index + 1) % ring.length]),
        );
      }
    }
  }
  return Math.sqrt(nearestSquared);
}

function deriveBounds(crop, projection) {
  const corners = [
    [crop.west, crop.south],
    [crop.west, crop.north],
    [crop.east, crop.south],
    [crop.east, crop.north],
  ].map(projection);
  return Object.freeze(featureBounds(corners));
}

function includesName(filter, name) {
  if (!Array.isArray(filter) || filter.length === 0) return true;
  const source = String(name || "").toLowerCase();
  return filter.some(value => source.includes(String(value).toLowerCase()));
}

/**
 * Build one immutable, location-sized world model from the bundled NSW
 * hydrography and road vectors. The crop and origin remain WGS84 so scene
 * layout can be audited directly against the source map.
 */
export function createMapModel(config, data = MAP_DATA) {
  const origin = validCoordinate(config?.origin ?? config?.sourceCoordinate, "origin");
  const crop = normaliseCrop(config?.crop, data.bounds);
  const scale = Number(config?.worldUnitsPerMetre ?? config?.worldUnitsPerMeter ?? 0.05);
  const rotationDegrees = Number(config?.rotationDegrees ?? 0);
  const offset = config?.offset ?? [0, 0];
  const projectionOptions = {
    origin,
    worldUnitsPerMetre: scale,
    rotationDegrees,
    offset,
  };
  const projectCoordinate = coordinate => {
    const projected = projectWgs84ToLocal(coordinate, projectionOptions);
    return { x: projected.x, z: projected.z };
  };
  const projectDetailed = coordinate => projectWgs84ToLocal(coordinate, projectionOptions);
  const bounds = normaliseBounds(config?.worldBounds) ?? deriveBounds(crop, projectCoordinate);
  const mapPoint = point => projectCoordinate(normalizedMapPointToWgs84(point, data.bounds));

  const waterways = data.waterways
    .filter(feature => includesName(config?.waterNames, feature.name))
    .map(feature => {
      const rings = feature.rings.map(ring => ring.map(mapPoint));
      const allPoints = rings.flat();
      return {
        name: feature.name,
        rings,
        bounds: featureBounds(allPoints),
      };
    })
    .filter(feature => feature.rings[0]?.length >= 3 && boundsOverlap(feature.bounds, bounds));

  const roads = data.roads
    .filter(feature => includesName(config?.roadNames, feature.name))
    .flatMap(feature => {
      const projected = feature.points.map(mapPoint);
      return clipPolyline(projected, bounds).map((points, part) => ({
        name: feature.name || "Road",
        sourcePart: part,
        points,
        bounds: featureBounds(points),
      }));
    });

  const waterHeight = Number(config?.waterHeight ?? 0);
  const seed = Math.trunc(Number(config?.relief?.seed ?? config?.seed ?? 1));
  const reliefType = String(config?.relief?.type ?? config?.relief ?? "broad-reach");
  const roadWidth = Math.max(0.35, Number(config?.roadWidth ?? 2.2));

  function withinBounds(x, z, margin = 0) {
    return x >= bounds.minX + margin && x <= bounds.maxX - margin
      && z >= bounds.minZ + margin && z <= bounds.maxZ - margin;
  }

  function isWater(x, z) {
    if (!withinBounds(x, z)) return false;
    return waterways.some(polygon => pointInPolygon(x, z, polygon));
  }

  function distanceToShore(x, z) {
    if (waterways.length === 0) return -Infinity;
    const distance = distanceToPolygonBoundary(x, z, waterways);
    return isWater(x, z) ? distance : -distance;
  }

  function distanceToWater(x, z) {
    const signed = distanceToShore(x, z);
    return signed >= 0 ? 0 : -signed;
  }

  function distanceToRoad(x, z) {
    return roads.length ? distanceToLines(x, z, roads) : Infinity;
  }

  function heightAt(x, z) {
    const signedShore = distanceToShore(x, z);
    if (signedShore >= 0) {
      return waterHeight - 0.42 - Math.min(1.45, signedShore * 0.055);
    }
    const shoreDistance = -signedShore;
    const detail = fbm(x * 0.055, z * 0.055, seed) - 0.5;
    const fine = fbm(x * 0.19, z * 0.18, seed + 31) - 0.5;
    const projected = projectDetailed(origin);
    const cosine = Math.cos(rotationDegrees * DEG_TO_RAD);
    const sine = Math.sin(rotationDegrees * DEG_TO_RAD);
    const localX = x - projected.x;
    const localZ = z - projected.z;
    const southUnits = -localX * sine + localZ * cosine;
    const northUnits = -southUnits;

    const bank = waterHeight + 0.26 + smoothstep(0, 4.5, shoreDistance) * 0.62;
    let height;
    if (reliefType.includes("first") || reliefType.includes("steep")) {
      const valleyWall = smoothstep(4, 46, shoreDistance) * 9.8;
      const northernRise = smoothstep(3, 72, northUnits) * 10.5;
      const escarpment = smoothstep(18, 60, shoreDistance + Math.max(0, northUnits) * 0.34) * 5.2;
      height = bank + valleyWall + northernRise + escarpment
        + detail * (0.65 + valleyWall * 0.12) + fine * 0.22;
    } else {
      const floodplain = smoothstep(5, 82, shoreDistance) * 2.25;
      const distantRise = smoothstep(58, 126, shoreDistance) * 2.6;
      height = bank + floodplain + distantRise + detail * 0.52 + fine * 0.13;
    }
    return height;
  }

  function findNearbyLand(x, z) {
    if (withinBounds(x, z, 0.2) && !isWater(x, z)) return { x, z };
    const directions = 24;
    const maximumRadius = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    for (let radius = 0.5; radius <= maximumRadius; radius += 0.65) {
      for (let index = 0; index < directions; index++) {
        const angle = index / directions * Math.PI * 2;
        const candidateX = clamp(x + Math.cos(angle) * radius, bounds.minX + 0.2, bounds.maxX - 0.2);
        const candidateZ = clamp(z + Math.sin(angle) * radius, bounds.minZ + 0.2, bounds.maxZ - 0.2);
        if (!isWater(candidateX, candidateZ)) return { x: candidateX, z: candidateZ };
      }
    }
    return { x: clamp(x, bounds.minX, bounds.maxX), z: clamp(z, bounds.minZ, bounds.maxZ) };
  }

  function resolveNumericMove(previousX, previousZ, nextX, nextZ) {
    const targetX = clamp(Number(nextX), bounds.minX + 0.2, bounds.maxX - 0.2);
    const targetZ = clamp(Number(nextZ), bounds.minZ + 0.2, bounds.maxZ - 0.2);
    if (!isWater(targetX, targetZ)) {
      return { x: targetX, z: targetZ, y: heightAt(targetX, targetZ), blocked: false };
    }
    let start = findNearbyLand(Number(previousX), Number(previousZ));
    let end = { x: targetX, z: targetZ };
    for (let iteration = 0; iteration < 18; iteration++) {
      const middle = { x: (start.x + end.x) * 0.5, z: (start.z + end.z) * 0.5 };
      if (isWater(middle.x, middle.z)) end = middle;
      else start = middle;
    }
    const shoreDistance = Math.max(0.12, distanceToWater(start.x, start.z));
    if (shoreDistance < 0.12) start = findNearbyLand(start.x, start.z);
    return { x: start.x, z: start.z, y: heightAt(start.x, start.z), blocked: true };
  }

  function clampLandMove(x, z, fallbackX = x, fallbackZ = z) {
    return resolveNumericMove(fallbackX, fallbackZ, x, z);
  }

  function spawn(position) {
    const land = findNearbyLand(Number(position?.x) || 0, Number(position?.z) || 0);
    return { x: land.x, z: land.z, y: heightAt(land.x, land.z) };
  }

  /**
   * Walker adapter contract: desired position first, previous position in the
   * context object second. Numeric legacy arguments remain accepted so the
   * model is also convenient in focused geometry tests.
   */
  function resolveMove(desiredOrPreviousX, contextOrPreviousZ, nextX, nextZ) {
    if (desiredOrPreviousX && typeof desiredOrPreviousX === "object") {
      const desired = desiredOrPreviousX;
      const previous = contextOrPreviousZ && typeof contextOrPreviousZ === "object"
        ? contextOrPreviousZ
        : desired;
      return resolveNumericMove(
        Number(previous.x),
        Number(previous.z),
        Number(desired.x),
        Number(desired.z),
      );
    }
    return resolveNumericMove(
      Number(desiredOrPreviousX),
      Number(contextOrPreviousZ),
      Number(nextX),
      Number(nextZ),
    );
  }

  return Object.freeze({
    id: String(config?.id ?? "mapped-location"),
    source: data,
    origin: Object.freeze(origin),
    crop,
    bounds,
    waterHeight,
    roadWidth,
    reliefType,
    waterways,
    roads,
    projectCoordinate,
    heightAt,
    isWater,
    distanceToWater,
    distanceToShore,
    distanceToRoad,
    withinBounds,
    navigation: Object.freeze({ spawn, resolveMove, clampLandMove, heightAt }),
    clampLandMove,
  });
}
