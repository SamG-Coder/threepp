import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(root, "assets", "maps", "source");
const output = join(root, "src", "game", "map-data.generated.mjs");

const BOUNDS = Object.freeze({
  west: 150.955,
  south: -33.410,
  east: 151.010,
  north: -33.345,
});

const EPSILON = 0.000018;

function inside([x, y]) {
  return x >= BOUNDS.west && x <= BOUNDS.east
    && y >= BOUNDS.south && y <= BOUNDS.north;
}

function intersection(a, b, axis, value) {
  const delta = b[axis] - a[axis];
  const t = Math.abs(delta) < 1e-12 ? 0 : (value - a[axis]) / delta;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipRing(input) {
  const boundaries = [
    { axis: 0, value: BOUNDS.west, keep: point => point[0] >= BOUNDS.west },
    { axis: 0, value: BOUNDS.east, keep: point => point[0] <= BOUNDS.east },
    { axis: 1, value: BOUNDS.south, keep: point => point[1] >= BOUNDS.south },
    { axis: 1, value: BOUNDS.north, keep: point => point[1] <= BOUNDS.north },
  ];
  let points = input.slice();
  for (const boundary of boundaries) {
    if (!points.length) break;
    const clipped = [];
    let previous = points[points.length - 1];
    let previousInside = boundary.keep(previous);
    for (const current of points) {
      const currentInside = boundary.keep(current);
      if (currentInside !== previousInside) {
        clipped.push(intersection(previous, current, boundary.axis, boundary.value));
      }
      if (currentInside) clipped.push(current);
      previous = current;
      previousInside = currentInside;
    }
    points = clipped;
  }
  return points;
}

function squareDistance(point, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx || dy) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplify(points, epsilon = EPSILON) {
  if (points.length <= 2) return points;
  const threshold = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = threshold;
    let index = -1;
    for (let cursor = first + 1; cursor < last; cursor++) {
      const distance = squareDistance(points[cursor], points[first], points[last]);
      if (distance > farthest) {
        farthest = distance;
        index = cursor;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function project([longitude, latitude]) {
  const x = (longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west);
  const y = 1 - (latitude - BOUNDS.south) / (BOUNDS.north - BOUNDS.south);
  return [Number(x.toFixed(5)), Number(y.toFixed(5))];
}

function outCode([x, y]) {
  let code = 0;
  if (x < BOUNDS.west) code |= 1;
  else if (x > BOUNDS.east) code |= 2;
  if (y < BOUNDS.south) code |= 4;
  else if (y > BOUNDS.north) code |= 8;
  return code;
}

function clipSegment(start, end) {
  let a = start.slice();
  let b = end.slice();
  let codeA = outCode(a);
  let codeB = outCode(b);
  while (true) {
    if (!(codeA | codeB)) return [a, b];
    if (codeA & codeB) return null;
    const code = codeA || codeB;
    let point;
    if (code & 8) point = intersection(a, b, 1, BOUNDS.north);
    else if (code & 4) point = intersection(a, b, 1, BOUNDS.south);
    else if (code & 2) point = intersection(a, b, 0, BOUNDS.east);
    else point = intersection(a, b, 0, BOUNDS.west);
    if (code === codeA) {
      a = point;
      codeA = outCode(a);
    } else {
      b = point;
      codeB = outCode(b);
    }
  }
}

function clipLine(points) {
  const parts = [];
  let active = [];
  for (let index = 1; index < points.length; index++) {
    const clipped = clipSegment(points[index - 1], points[index]);
    if (!clipped) {
      if (active.length > 1) parts.push(active);
      active = [];
      continue;
    }
    const [a, b] = clipped;
    if (!active.length) active.push(a, b);
    else if (Math.abs(active.at(-1)[0] - a[0]) < 1e-9 && Math.abs(active.at(-1)[1] - a[1]) < 1e-9) {
      active.push(b);
    } else {
      if (active.length > 1) parts.push(active);
      active = [a, b];
    }
  }
  if (active.length > 1) parts.push(active);
  return parts;
}

function polygonFeatures(collection) {
  return collection.features.flatMap(feature => {
    const polygons = feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
    return polygons.map(polygon => ({
      name: feature.properties.hydroname
        ? `${title(feature.properties.hydroname)} ${title(feature.properties.hydronametype || "")}`.trim()
        : "Waterway",
      rings: polygon
        .map(ring => simplify(clipRing(ring)))
        .filter(ring => ring.length >= 3)
        .map(ring => ring.map(project)),
    })).filter(featureValue => featureValue.rings.length);
  });
}

function lineFeatures(collection, property, filter = () => true) {
  return collection.features.filter(filter).flatMap(feature => {
    const lines = feature.geometry.type === "MultiLineString"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
    return lines.flatMap(line => clipLine(line).map(part => ({
      name: title(feature.properties[property] || ""),
      points: simplify(part).map(project),
    })));
  });
}

function title(value) {
  return String(value || "").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function midpoint(points) {
  const point = points[Math.floor(points.length / 2)] ?? points[0] ?? [0, 0];
  return project(point);
}

const [hydro, roads, ferries] = await Promise.all([
  readFile(join(sourceRoot, "nsw-hydro-area-main.geojson"), "utf8").then(JSON.parse),
  readFile(join(sourceRoot, "nsw-road-segments.geojson"), "utf8").then(JSON.parse),
  readFile(join(sourceRoot, "nsw-ferry-routes.geojson"), "utf8").then(JSON.parse),
]);

const ferryFeatures = lineFeatures(ferries, "generalname");
const wisemansFeature = ferries.features.find(feature => feature.properties.generalname === "WISEMANS FERRY");
const compact = {
  bounds: BOUNDS,
  waterways: polygonFeatures(hydro),
  roads: lineFeatures(
    roads,
    "roadnamebase",
    feature => Number(feature.properties.functionhierarchy || 9) <= 5,
  ),
  ferries: ferryFeatures,
  landmarks: [
    {
      id: "wisemans-ferry",
      name: "Wisemans Ferry",
      point: midpoint(wisemansFeature?.geometry?.coordinates ?? []),
      coordinate: [150.9891, -33.3794],
    },
    {
      id: "first-branch",
      name: "Macdonald River · First Branch",
      point: project([150.9849940, -33.3783594]),
      coordinate: [150.9849940, -33.3783594],
    },
  ],
};

const banner = `// Generated by scripts/build-map-data.mjs from the bundled NSW Spatial Services\n`
  + `// GeoJSON slice. Do not hand-edit; see assets/maps/MAP_SOURCES.md.\n\n`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${banner}export const MAP_DATA = Object.freeze(${JSON.stringify(compact)});\n`, "utf8");
console.log(`Wrote ${output}`);
console.log(`${compact.waterways.length} waterways · ${compact.roads.length} roads · ${compact.ferries.length} ferries`);
