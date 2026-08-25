import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  positionLocal,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.399963229728653;
// The forest intentionally stops before the outer terrain edge.  That leaves
// a broad, bare mountain horizon behind the wooded valley instead of drawing
// a rectangular wall of trees at the procedural landscape boundary.
const WORLD_BOUNDS = Object.freeze({ minX: -210, maxX: 210, minZ: -330, maxZ: 150 });
const CAMERA_CLEARINGS = Object.freeze([
  // Primary valley overlook.
  Object.freeze({ x: 92, z: 102, radiusX: 30, radiusZ: 27 }),
  // Low fireline view on the management track.
  Object.freeze({ x: 9, z: -23, radiusX: 13, radiusZ: 11 }),
  // Preserve the original foreground clearing for slow camera drift.
  Object.freeze({ x: 25, z: 34, radiusX: 15, radiusZ: 13 }),
]);
const HEALTHY_CROWNS = Object.freeze([0x456247, 0x536f50, 0x617958, 0x3d5a43]);
const HEALTHY_BARK = Object.freeze([0x6c645a, 0x766d61, 0x5d5851, 0x817568]);

const LOD_SPECS = Object.freeze({
  hero: Object.freeze({
    archetypes: 2,
    height: 13.2,
    crownRadius: 5.65,
    stemSegments: 7,
    majorLimbs: 7,
    secondaryPerLimb: 2,
    trunkSides: 10,
    limbSides: 8,
    twigSides: 6,
    padSides: 10,
    padRings: 4,
    padsPerLimb: 2,
    leafCards: 240,
  }),
  mid: Object.freeze({
    archetypes: 3,
    height: 11.4,
    crownRadius: 4.75,
    stemSegments: 6,
    majorLimbs: 6,
    secondaryPerLimb: 1,
    trunkSides: 8,
    limbSides: 6,
    twigSides: 4,
    padSides: 8,
    padRings: 3,
    padsPerLimb: 2,
    leafCards: 56,
  }),
  far: Object.freeze({
    archetypes: 2,
    height: 9.6,
    crownRadius: 4.05,
    stemSegments: 4,
    majorLimbs: 4,
    secondaryPerLimb: 0,
    trunkSides: 6,
    limbSides: 4,
    twigSides: 4,
    padSides: 6,
    padRings: 2,
    padsPerLimb: 1,
    leafCards: 0,
  }),
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mixNumber(a, b, t) {
  return a + (b - a) * t;
}

function smoothstepNumber(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function snagAmountForBurn(value) {
  return smoothstepNumber(0.70, 0.94, clamp01(value));
}

function windingTrackX(z) {
  return 13 + Math.sin(z * 0.052) * 5;
}

function safeHeight(heightAt, x, z) {
  try {
    const value = Number(heightAt?.(x, z));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function terrainSlopeY(heightAt, x, z) {
  const epsilon = 1.25;
  const left = safeHeight(heightAt, x - epsilon, z);
  const right = safeHeight(heightAt, x + epsilon, z);
  const back = safeHeight(heightAt, x, z - epsilon);
  const front = safeHeight(heightAt, x, z + epsilon);
  if ([left, right, back, front].some((value) => value === null)) return 0;
  const dx = (right - left) / (epsilon * 2);
  const dz = (front - back) / (epsilon * 2);
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

function inCameraClearing(x, z) {
  for (const clearing of CAMERA_CLEARINGS) {
    const dx = (x - clearing.x) / clearing.radiusX;
    const dz = (z - clearing.z) / clearing.radiusZ;
    if (dx * dx + dz * dz < 1) return true;
  }
  return false;
}

function validTreeSite(heightAt, x, z) {
  if (
    x < WORLD_BOUNDS.minX + 2.5 || x > WORLD_BOUNDS.maxX - 2.5 ||
    z < WORLD_BOUNDS.minZ + 2.5 || z > WORLD_BOUNDS.maxZ - 2.5
  ) return false;
  if (inCameraClearing(x, z)) return false;
  if (Math.abs(x - windingTrackX(z)) < 5.2) return false;
  if (safeHeight(heightAt, x, z) === null) return false;
  return terrainSlopeY(heightAt, x, z) > 0.61;
}

function enoughSpacing(x, z, spacing, placements) {
  for (const item of placements) {
    const minimum = Math.min(spacing, item.spacing) * 0.88;
    const dx = x - item.x;
    const dz = z - item.z;
    if (dx * dx + dz * dz < minimum * minimum) return false;
  }
  return true;
}

function weightedPatch(random, patches) {
  let total = 0;
  for (const patch of patches) total += patch.weight;
  let value = random() * total;
  for (const patch of patches) {
    value -= patch.weight;
    if (value <= 0) return patch;
  }
  return patches[patches.length - 1];
}

function samplePatchPoint(random, patch) {
  const angle = random() * TAU;
  const distance = Math.pow(random(), 0.66) * patch.radius;
  const localX = Math.cos(angle) * distance * (patch.stretchX ?? 1);
  const localZ = Math.sin(angle) * distance * (patch.stretchZ ?? 1);
  const rotation = patch.rotation ?? 0;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  return {
    x: patch.x + localX * cosRotation - localZ * sinRotation,
    z: patch.z + localX * sinRotation + localZ * cosRotation,
  };
}

function findNearSite(heightAt, placements, x, z, spacing, random) {
  for (let attempt = 0; attempt < 36; ++attempt) {
    const radius = attempt === 0 ? 0 : 1.5 + Math.sqrt(attempt) * 1.15;
    const angle = attempt * GOLDEN_ANGLE + random() * 0.18;
    const px = x + Math.cos(angle) * radius;
    const pz = z + Math.sin(angle) * radius;
    if (
      validTreeSite(heightAt, px, pz) &&
      enoughSpacing(px, pz, spacing, placements)
    ) return { x: px, z: pz };
  }
  return null;
}

function mapFireCell(fireCellAt, x, z) {
  if (typeof fireCellAt !== "function") return { cell: null, index: -1 };
  try {
    const mapped = fireCellAt(x, z);
    if (Number.isInteger(mapped)) return { cell: null, index: mapped };
    const index = Number.isInteger(mapped?.index) ? mapped.index : -1;
    return { cell: mapped && typeof mapped === "object" ? mapped : null, index };
  } catch {
    return { cell: null, index: -1 };
  }
}

function createPlacements(heightAt, fireCellAt, seed) {
  const random = mulberry32(seed ^ 0x706c6163);
  const placements = [];
  const heroSites = [
    // Mature trees closely bracket the established diagonal fire front.
    [-72, -59], [-61, -67], [-49, -72], [-37, -76], [-24, -80],
    [-12, -84], [1, -88], [17, -93], [31, -99],
    // A few large flank trees give the close cameras natural framing.
    [-82, -91], [46, -72], [-54, -116], [53, -119], [-32, -145],
  ];

  const addPlacement = (point, lod, forcedScale = null) => {
    const scaleRange = lod === "hero" ? [0.96, 1.23] : lod === "mid" ? [0.70, 1.15] : [0.40, 0.91];
    const scale = forcedScale ?? mixNumber(scaleRange[0], scaleRange[1], Math.pow(random(), 0.86));
    const y = safeHeight(heightAt, point.x, point.z);
    if (y === null) return false;
    const mapped = mapFireCell(fireCellAt, point.x, point.z);
    const yaw = random() * TAU;
    const phase = random() * TAU;
    const snagVariation = 0.5 + 0.5 * Math.sin(phase * 1.73 + placements.length * 0.91);
    placements.push({
      id: placements.length,
      x: point.x,
      y: y + 0.015,
      z: point.z,
      spacing: lod === "hero" ? 5.2 : lod === "mid" ? 4.15 : 3.15,
      lod,
      archetype: Math.floor(random() * LOD_SPECS[lod].archetypes),
      scale,
      yaw,
      phase,
      // The same healthy tube geometry becomes a broken, non-uniform snag in
      // the aftermath.  Per-record proportions prevent a repeated cut-stump
      // profile without adding another mesh bucket or RTX root.
      snagHeightScale: mixNumber(0.50, 0.67, snagVariation),
      snagWidthX: mixNumber(0.41, 0.55, 0.5 + 0.5 * Math.sin(phase * 2.11 + 0.7)),
      snagWidthZ: mixNumber(0.39, 0.53, 0.5 + 0.5 * Math.cos(phase * 1.89 - 0.4)),
      snagYawOffset: Math.sin(phase * 2.47) * 0.20,
      snagLeanX: Math.sin(phase * 1.31 + 0.6) * 0.085,
      snagLeanZ: Math.cos(phase * 1.57 - 0.3) * 0.085,
      snagAmount: 0,
      healthyCrown: new THREE.Color(HEALTHY_CROWNS[Math.floor(random() * HEALTHY_CROWNS.length)]),
      healthyBark: new THREE.Color(HEALTHY_BARK[Math.floor(random() * HEALTHY_BARK.length)]),
      fireCell: mapped.cell,
      fireCellIndex: mapped.index,
      cellIndex: mapped.index,
      visualBurn: -1,
      maximumBurn: 0,
      leafInstances: [],
      scrubInstances: [],
    });
    return true;
  };

  for (const [x, z] of heroSites) {
    const point = findNearSite(heightAt, placements, x, z, 5.2, random);
    if (point) addPlacement(point, "hero");
  }

  const midPatches = [
    // Detail is concentrated along the fireline and the three camera sightlines.
    { x: -27, z: -78, radius: 48, stretchX: 1.28, stretchZ: 0.62, rotation: -0.18, weight: 3.8, scaleMin: 0.78, scaleMax: 1.18 },
    { x: -20, z: -124, radius: 55, stretchX: 1.04, stretchZ: 0.78, rotation: 0.14, weight: 2.35, scaleMin: 0.70, scaleMax: 1.10 },
    { x: -43, z: 16, radius: 47, stretchX: 0.90, stretchZ: 0.78, rotation: -0.22, weight: 1.15, scaleMin: 0.72, scaleMax: 1.08 },
    { x: 53, z: 28, radius: 46, stretchX: 0.73, stretchZ: 1.06, rotation: 0.31, weight: 1.25, scaleMin: 0.68, scaleMax: 1.06 },
    { x: 15, z: -24, radius: 46, stretchX: 0.92, stretchZ: 1.16, rotation: -0.13, weight: 1.85, scaleMin: 0.72, scaleMax: 1.11 },
    { x: -83, z: -87, radius: 58, stretchX: 0.61, stretchZ: 1.14, rotation: -0.18, weight: 0.86, scaleMin: 0.66, scaleMax: 1.02 },
    { x: 79, z: -105, radius: 58, stretchX: 0.62, stretchZ: 1.18, rotation: 0.16, weight: 0.84, scaleMin: 0.66, scaleMax: 1.02 },
    { x: -14, z: -181, radius: 55, stretchX: 1.18, stretchZ: 0.65, rotation: 0.08, weight: 1.05, scaleMin: 0.62, scaleMax: 0.96 },
    { x: 126, z: 57, radius: 39, stretchX: 0.65, stretchZ: 1.03, rotation: -0.26, weight: 0.45, scaleMin: 0.62, scaleMax: 0.92 },
  ];
  const farPatches = [
    // Broad valley layers.  Overlap is deliberate: it creates irregular copses
    // and negative-space gullies rather than even Poisson rows.
    { x: -18, z: 48, radius: 69, stretchX: 1.25, stretchZ: 0.60, rotation: -0.15, weight: 1.00, scaleMin: 0.50, scaleMax: 0.88 },
    { x: -20, z: -18, radius: 75, stretchX: 1.24, stretchZ: 0.68, rotation: 0.12, weight: 1.32, scaleMin: 0.48, scaleMax: 0.88 },
    { x: -19, z: -91, radius: 76, stretchX: 1.30, stretchZ: 0.69, rotation: -0.08, weight: 1.46, scaleMin: 0.46, scaleMax: 0.86 },
    { x: -8, z: -165, radius: 78, stretchX: 1.32, stretchZ: 0.70, rotation: 0.11, weight: 1.30, scaleMin: 0.43, scaleMax: 0.82 },
    { x: 5, z: -238, radius: 78, stretchX: 1.30, stretchZ: 0.66, rotation: -0.10, weight: 1.08, scaleMin: 0.39, scaleMax: 0.76 },
    { x: -4, z: -301, radius: 70, stretchX: 1.46, stretchZ: 0.42, rotation: 0.04, weight: 0.86, scaleMin: 0.35, scaleMax: 0.67 },

    // Long, rotated ridgeline bands on both sides of the valley.
    { x: -137, z: 38, radius: 71, stretchX: 0.50, stretchZ: 1.18, rotation: -0.20, weight: 0.76, scaleMin: 0.43, scaleMax: 0.79 },
    { x: -151, z: -92, radius: 78, stretchX: 0.48, stretchZ: 1.25, rotation: -0.10, weight: 0.92, scaleMin: 0.40, scaleMax: 0.76 },
    { x: -144, z: -224, radius: 81, stretchX: 0.50, stretchZ: 1.18, rotation: 0.12, weight: 0.78, scaleMin: 0.35, scaleMax: 0.69 },
    { x: 142, z: 42, radius: 70, stretchX: 0.50, stretchZ: 1.16, rotation: 0.18, weight: 0.71, scaleMin: 0.42, scaleMax: 0.78 },
    { x: 154, z: -91, radius: 79, stretchX: 0.47, stretchZ: 1.24, rotation: 0.08, weight: 0.88, scaleMin: 0.39, scaleMax: 0.75 },
    { x: 146, z: -225, radius: 82, stretchX: 0.49, stretchZ: 1.20, rotation: -0.14, weight: 0.76, scaleMin: 0.34, scaleMax: 0.68 },

    // Broken rear ridges make several depth planes against the bare horizon.
    { x: -112, z: -306, radius: 72, stretchX: 0.94, stretchZ: 0.38, rotation: -0.08, weight: 0.58, scaleMin: 0.32, scaleMax: 0.61 },
    { x: 94, z: -310, radius: 75, stretchX: 1.00, stretchZ: 0.36, rotation: 0.10, weight: 0.61, scaleMin: 0.31, scaleMax: 0.60 },
    { x: -177, z: -157, radius: 62, stretchX: 0.42, stretchZ: 1.10, rotation: -0.14, weight: 0.43, scaleMin: 0.34, scaleMax: 0.66 },
    { x: 181, z: -170, radius: 63, stretchX: 0.42, stretchZ: 1.08, rotation: 0.16, weight: 0.42, scaleMin: 0.33, scaleMax: 0.65 },
  ];

  const scatter = (target, lod, patches) => {
    let added = 0;
    for (let attempt = 0; attempt < target * 95 && added < target; ++attempt) {
      const patch = weightedPatch(random, patches);
      const point = samplePatchPoint(random, patch);
      const spacing = lod === "mid" ? 4.15 : 3.15;
      if (!validTreeSite(heightAt, point.x, point.z)) continue;
      if (!enoughSpacing(point.x, point.z, spacing, placements)) continue;
      const forcedScale = Number.isFinite(patch.scaleMin) && Number.isFinite(patch.scaleMax)
        ? mixNumber(patch.scaleMin, patch.scaleMax, Math.pow(random(), 0.82))
        : null;
      if (addPlacement(point, lod, forcedScale)) added += 1;
    }
  };

  scatter(236, "mid", midPatches);
  scatter(1150, "far", farPatches);
  return placements;
}

function createBuffers() {
  return { positions: [], normals: [], colors: [], uvs: [], indices: [] };
}

function pushVertex(buffers, position, normal, colorValue, u, v) {
  buffers.positions.push(position.x, position.y, position.z);
  buffers.normals.push(normal.x, normal.y, normal.z);
  buffers.colors.push(colorValue[0], colorValue[1], colorValue[2]);
  buffers.uvs.push(u, v);
}

function appendBranchPath(buffers, points, radii, sides, phase) {
  if (points.length < 2) return;
  const base = buffers.positions.length / 3;
  const ringVertices = sides + 1;
  const tangents = [];
  const distances = [0];
  for (let index = 0; index < points.length; ++index) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    tangents.push(after.clone().sub(before).normalize());
    if (index) distances.push(distances[index - 1] + points[index].distanceTo(points[index - 1]));
  }

  const helper = Math.abs(tangents[0].y) < 0.92
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  let side = new THREE.Vector3().crossVectors(helper, tangents[0]).normalize();
  let up = new THREE.Vector3().crossVectors(tangents[0], side).normalize();
  for (let ring = 0; ring < points.length; ++ring) {
    const tangent = tangents[ring];
    side.sub(tangent.clone().multiplyScalar(side.dot(tangent)));
    if (side.lengthSq() < 1e-5) {
      const fallback = Math.abs(tangent.y) < 0.92
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      side.crossVectors(fallback, tangent);
    }
    side.normalize();
    up = new THREE.Vector3().crossVectors(tangent, side).normalize();
    const maturity = 1 - ring / Math.max(1, points.length - 1);
    const tone = 0.82 + maturity * 0.14;
    for (let edge = 0; edge <= sides; ++edge) {
      const u = edge / sides;
      const angle = u * TAU;
      const relief = 1 + 0.035 * Math.sin(angle * 2 + phase) + 0.018 * Math.sin(angle * 5 - phase * 0.7);
      const radial = side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).normalize();
      const position = points[ring].clone().addScaledVector(radial, radii[ring] * relief);
      pushVertex(buffers, position, radial, [tone * 0.94, tone * 0.98, tone], u, distances[ring]);
    }
  }
  for (let ring = 0; ring < points.length - 1; ++ring) {
    for (let edge = 0; edge < sides; ++edge) {
      const a = base + ring * ringVertices + edge;
      const b = a + 1;
      const c = a + ringVertices;
      const d = c + 1;
      buffers.indices.push(a, c, d, a, d, b);
    }
  }
}

function appendCrownPad(buffers, pad, sides, rings, random) {
  const flatDirection = pad.direction.clone().setY(0);
  const major = flatDirection.lengthSq() > 1e-5 ? flatDirection.normalize() : new THREE.Vector3(1, 0, 0);
  const minor = new THREE.Vector3(-major.z, 0, major.x);
  const up = new THREE.Vector3(0, 1, 0);
  const base = buffers.positions.length / 3;
  const bottom = pad.center.clone().addScaledVector(up, -pad.verticalRadius);
  pushVertex(buffers, bottom, up.clone().negate(), [0.72, 0.82, 0.70], 0.5, 0);
  const firstRing = buffers.positions.length / 3;
  const phase = random() * TAU;
  for (let ring = 0; ring < rings; ++ring) {
    const latitude = -0.72 + (ring + 0.5) * (1.44 / rings);
    const profile = Math.sqrt(Math.max(0, 1 - latitude * latitude));
    for (let edge = 0; edge < sides; ++edge) {
      const angle = edge / sides * TAU + phase;
      const irregular = 0.88 + 0.075 * Math.sin(angle * 3 + phase * 0.7) + 0.045 * Math.sin(angle * 5 - ring * 0.9);
      const localMajor = Math.cos(angle) * pad.majorRadius * profile * irregular;
      const localMinor = Math.sin(angle) * pad.minorRadius * profile * (0.93 + random() * 0.08);
      const localY = latitude * pad.verticalRadius * (0.95 + 0.06 * Math.sin(angle * 2 + phase));
      const position = pad.center.clone()
        .addScaledVector(major, localMajor)
        .addScaledVector(minor, localMinor)
        .addScaledVector(up, localY);
      const normal = major.clone().multiplyScalar(localMajor / Math.max(0.01, pad.majorRadius * pad.majorRadius))
        .addScaledVector(minor, localMinor / Math.max(0.01, pad.minorRadius * pad.minorRadius))
        .addScaledVector(up, localY / Math.max(0.01, pad.verticalRadius * pad.verticalRadius))
        .normalize();
      const tone = 0.83 + 0.13 * Math.sin(angle * 4 + ring * 1.7 + phase);
      pushVertex(buffers, position, normal, [tone * 0.79, tone, tone * 0.78], edge / sides, (latitude + 1) * 0.5);
    }
  }
  const top = buffers.positions.length / 3;
  pushVertex(
    buffers,
    pad.center.clone().addScaledVector(up, pad.verticalRadius),
    up,
    [0.76, 0.88, 0.73],
    0.5,
    1,
  );
  for (let edge = 0; edge < sides; ++edge) {
    const next = (edge + 1) % sides;
    buffers.indices.push(base, firstRing + next, firstRing + edge);
  }
  for (let ring = 0; ring < rings - 1; ++ring) {
    for (let edge = 0; edge < sides; ++edge) {
      const next = (edge + 1) % sides;
      const a = firstRing + ring * sides + edge;
      const b = firstRing + ring * sides + next;
      const c = a + sides;
      const d = b + sides;
      buffers.indices.push(a, c, d, a, d, b);
    }
  }
  const lastRing = firstRing + (rings - 1) * sides;
  for (let edge = 0; edge < sides; ++edge) {
    const next = (edge + 1) % sides;
    buffers.indices.push(lastRing + edge, lastRing + next, top);
  }
}

function geometryFromBuffers(buffers, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffers.indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.55;
  return geometry;
}

function stemPointAt(points, fraction) {
  const scaled = clamp01(fraction) * (points.length - 1);
  const first = Math.min(points.length - 2, Math.floor(scaled));
  return points[first].clone().lerp(points[first + 1], scaled - first);
}

function makeLeafSites(pads, count, seed) {
  const random = mulberry32(seed ^ 0x6c656166);
  const sites = [];
  const up = new THREE.Vector3(0, 1, 0);
  const leafUp = new THREE.Vector3(0, 1, 0);
  const sprays = Math.ceil(count / 4);
  for (let spray = 0; spray < sprays && sites.length < count; ++spray) {
    const pad = pads[Math.floor(random() * pads.length)];
    const major = pad.direction.clone().setY(0).normalize();
    if (major.lengthSq() < 1e-5) major.set(1, 0, 0);
    const minor = new THREE.Vector3(-major.z, 0, major.x);
    const theta = random() * TAU;
    const vertical = mixNumber(-0.55, 0.92, random());
    const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const shell = mixNumber(0.64, 0.98, Math.pow(random(), 0.35));
    const center = pad.center.clone()
      .addScaledVector(major, Math.cos(theta) * pad.majorRadius * horizontal * shell)
      .addScaledVector(minor, Math.sin(theta) * pad.minorRadius * horizontal * shell)
      .addScaledVector(up, vertical * pad.verticalRadius * shell);
    for (let leaf = 0; leaf < 4 && sites.length < count; ++leaf) {
      const fan = (leaf - 1.5) * 0.43 + (random() - 0.5) * 0.17;
      const direction = major.clone().multiplyScalar(0.48 + random() * 0.36)
        .addScaledVector(minor, fan)
        .addScaledVector(up, mixNumber(-0.28, 0.44, random()))
        .normalize();
      const position = center.clone()
        .addScaledVector(minor, (random() - 0.5) * 0.22)
        .addScaledVector(up, (random() - 0.5) * 0.16);
      const align = new THREE.Quaternion().setFromUnitVectors(leafUp, direction);
      const roll = new THREE.Quaternion().setFromAxisAngle(direction, random() * TAU);
      sites.push({
        position,
        quaternion: roll.multiply(align),
        scale: mixNumber(0.62, 1.08, random()),
        phase: random() * TAU,
      });
    }
  }
  return sites;
}

function createArchetype(lod, variant, seed) {
  const spec = LOD_SPECS[lod];
  const random = mulberry32(seed ^ (variant * 0x9e3779b9) ^ (lod === "hero" ? 0x6865726f : lod === "mid" ? 0x6d696420 : 0x66617220));
  const branchBuffers = createBuffers();
  const crownBuffers = createBuffers();
  const branches = [];
  const pads = [];
  const phase = random() * TAU;
  const leanAngle = random() * TAU;
  const stemHeight = spec.height * (lod === "far" ? 0.68 : 0.73);
  const stemPoints = [];
  const stemRadii = [];
  for (let segment = 0; segment <= spec.stemSegments; ++segment) {
    const q = segment / spec.stemSegments;
    const crook = Math.sin(q * Math.PI * 2.15 + phase) * 0.17 * q + Math.sin(q * Math.PI * 4.6 - phase) * 0.055;
    const drift = q * q * mixNumber(0.18, 0.52, random());
    stemPoints.push(new THREE.Vector3(
      Math.cos(leanAngle) * drift + Math.cos(leanAngle + Math.PI * 0.5) * crook,
      stemHeight * q,
      Math.sin(leanAngle) * drift + Math.sin(leanAngle + Math.PI * 0.5) * crook,
    ));
    const taper = Math.pow(Math.max(0.07, 1 - q * 0.86), 1.12);
    const buttress = 1 + Math.exp(-q * 7.5) * (0.34 + 0.08 * Math.sin(q * 18 + phase));
    stemRadii.push(spec.height * 0.038 * taper * buttress);
  }
  branches.push({ points: stemPoints, radii: stemRadii, sides: spec.trunkSides, phase });

  const dominant = random() * TAU;
  for (let limb = 0; limb < spec.majorLimbs; ++limb) {
    const fraction = 0.25 + (limb / Math.max(1, spec.majorLimbs - 1)) * 0.34 + (random() - 0.5) * 0.025;
    const origin = stemPointAt(stemPoints, fraction);
    const angle = dominant + limb * GOLDEN_ANGLE + (random() - 0.5) * 0.42;
    const horizontal = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const lateral = new THREE.Vector3(-horizontal.z, 0, horizontal.x);
    const unequal = limb === 0 ? 1.14 : limb === spec.majorLimbs - 1 ? 0.82 : mixNumber(0.88, 1.08, random());
    const length = spec.crownRadius * unequal * mixNumber(0.78, 1.04, random());
    const rise = mixNumber(0.20, 0.48, random()) + limb / spec.majorLimbs * 0.08;
    const limbPoints = [
      origin,
      origin.clone().addScaledVector(horizontal, length * 0.28).addScaledVector(lateral, (random() - 0.5) * 0.34).add(new THREE.Vector3(0, length * rise * 0.38, 0)),
      origin.clone().addScaledVector(horizontal, length * 0.65).addScaledVector(lateral, (random() - 0.5) * 0.52).add(new THREE.Vector3(0, length * rise * 0.72, 0)),
      origin.clone().addScaledVector(horizontal, length).addScaledVector(lateral, (random() - 0.5) * 0.62).add(new THREE.Vector3(0, length * rise - (limb < 2 ? length * 0.07 : 0), 0)),
    ];
    if (lod === "far") limbPoints.splice(1, 1);
    const originRadius = spec.height * mixNumber(0.014, 0.021, random()) * (1.06 - limb / spec.majorLimbs * 0.18);
    const limbRadii = limbPoints.map((_, index) => originRadius * Math.pow(Math.max(0.12, 1 - index / (limbPoints.length - 1) * 0.86), 1.1));
    branches.push({ points: limbPoints, radii: limbRadii, sides: spec.limbSides, phase: phase + limb * 0.71 });

    const padStart = lod === "far" ? 0.62 : 0.48;
    for (let padIndex = 0; padIndex < spec.padsPerLimb; ++padIndex) {
      const along = spec.padsPerLimb === 1 ? 0.72 : padStart + padIndex * 0.35;
      const center = limbPoints[1].clone().lerp(limbPoints[limbPoints.length - 1], along)
        .addScaledVector(horizontal, -spec.crownRadius * (padIndex === 0 ? 0.05 : 0.015))
        .add(new THREE.Vector3(0, spec.height * mixNumber(0.015, 0.055, random()), 0));
      const size = mixNumber(0.82, 1.12, random()) * (padIndex ? 0.92 : 1);
      pads.push({
        center,
        direction: limbPoints[limbPoints.length - 1].clone().sub(origin),
        majorRadius: spec.crownRadius * (lod === "far" ? 0.31 : 0.24) * size,
        minorRadius: spec.crownRadius * (lod === "far" ? 0.20 : 0.17) * size,
        verticalRadius: spec.height * (lod === "far" ? 0.115 : 0.095) * size,
      });
    }

    for (let secondary = 0; secondary < spec.secondaryPerLimb; ++secondary) {
      const sourceIndex = secondary === 0 ? 1 : 2;
      const source = limbPoints[Math.min(sourceIndex, limbPoints.length - 2)];
      const sideSign = (limb + secondary) & 1 ? 1 : -1;
      const direction = horizontal.clone().multiplyScalar(0.48)
        .addScaledVector(lateral, sideSign * mixNumber(0.68, 0.92, random()))
        .add(new THREE.Vector3(0, mixNumber(0.16, 0.42, random()), 0))
        .normalize();
      const secondaryLength = length * mixNumber(0.35, 0.52, random());
      const middle = source.clone().addScaledVector(direction, secondaryLength * 0.48)
        .addScaledVector(lateral, (random() - 0.5) * 0.24);
      const tip = middle.clone().addScaledVector(direction, secondaryLength * 0.52)
        .add(new THREE.Vector3(0, (random() - 0.5) * 0.23, 0));
      branches.push({
        points: [source, middle, tip],
        radii: [originRadius * 0.46, originRadius * 0.27, originRadius * 0.09],
        sides: spec.twigSides,
        phase: phase + limb * 0.91 + secondary,
      });
      pads.push({
        center: middle.clone().lerp(tip, 0.68),
        direction: tip.clone().sub(source),
        majorRadius: spec.crownRadius * mixNumber(0.18, 0.24, random()),
        minorRadius: spec.crownRadius * mixNumber(0.12, 0.17, random()),
        verticalRadius: spec.height * mixNumber(0.070, 0.096, random()),
      });

      if (lod === "hero" && secondary === 0 && (limb & 1) === 0) {
        const twigDirection = direction.clone().multiplyScalar(0.55)
          .addScaledVector(lateral, -sideSign * 0.68)
          .add(new THREE.Vector3(0, 0.22, 0))
          .normalize();
        const twigTip = middle.clone().addScaledVector(twigDirection, secondaryLength * 0.38);
        branches.push({
          points: [middle, middle.clone().lerp(twigTip, 0.52), twigTip],
          radii: [originRadius * 0.24, originRadius * 0.13, originRadius * 0.045],
          sides: 4,
          phase: phase + limb * 1.37,
        });
      }
    }
  }

  // Offset interior masses join the scaffold without sealing every crown window.
  const centralPadCount = lod === "far" ? 1 : lod === "mid" ? 2 : 3;
  for (let index = 0; index < centralPadCount; ++index) {
    const angle = dominant + 0.38 + index * 2.18;
    pads.push({
      center: new THREE.Vector3(
        Math.cos(angle) * spec.crownRadius * mixNumber(0.04, 0.17, random()),
        stemHeight + spec.height * mixNumber(0.035, 0.14, random()),
        Math.sin(angle) * spec.crownRadius * mixNumber(0.04, 0.17, random()),
      ),
      direction: new THREE.Vector3(Math.cos(angle), 0.18, Math.sin(angle)),
      majorRadius: spec.crownRadius * mixNumber(lod === "far" ? 0.30 : 0.24, lod === "far" ? 0.39 : 0.34, random()),
      minorRadius: spec.crownRadius * mixNumber(0.18, 0.26, random()),
      verticalRadius: spec.height * mixNumber(0.09, 0.14, random()),
    });
  }

  for (const branch of branches) appendBranchPath(branchBuffers, branch.points, branch.radii, branch.sides, branch.phase);
  for (const pad of pads) appendCrownPad(crownBuffers, pad, spec.padSides, spec.padRings, random);
  const branchGeometry = geometryFromBuffers(branchBuffers, `${lod} tree branch archetype ${variant + 1}`);
  const crownGeometry = geometryFromBuffers(crownBuffers, `${lod} tree crown-pad archetype ${variant + 1}`);
  const leafSites = spec.leafCards > 0 ? makeLeafSites(pads, spec.leafCards, seed ^ variant) : [];
  return {
    lod,
    variant,
    branchGeometry,
    crownGeometry,
    leafSites,
    crownAnchorY: spec.height * 0.43,
    branchTriangles: branchBuffers.indices.length / 3,
    crownTriangles: crownBuffers.indices.length / 3,
  };
}

function createLanceolateLeafGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.name = "Five-leaf irregular lanceolate gum foliage spray";
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let leaf = 0; leaf < 5; ++leaf) {
    const angle = leaf * GOLDEN_ANGLE + (leaf & 1 ? 0.18 : -0.12);
    const length = 0.54 + (leaf % 3) * 0.105;
    const width = 0.065 + ((leaf * 7) % 4) * 0.012;
    const direction = new THREE.Vector3(
      Math.cos(angle) * (0.22 + (leaf & 1) * 0.08),
      0.91 + (leaf % 2) * 0.05,
      Math.sin(angle) * (0.22 + ((leaf + 1) & 1) * 0.08),
    ).normalize();
    const side = new THREE.Vector3(-Math.sin(angle), 0.035 * Math.sin(angle * 2), Math.cos(angle)).normalize();
    const basePosition = new THREE.Vector3(
      Math.cos(angle) * 0.035,
      (leaf % 2) * 0.055,
      Math.sin(angle) * 0.035,
    );
    const point = (along, lateral, curl) => basePosition.clone()
      .addScaledVector(direction, length * along)
      .addScaledVector(side, width * lateral)
      .add(new THREE.Vector3(0, 0, curl));
    const vertices = [
      point(0, 0, 0),
      point(0.24, -0.68, 0.004),
      point(0.58, -1, 0.017),
      point(1, 0, 0.046),
      point(0.58, 1, 0.017),
      point(0.24, 0.68, 0.004),
    ];
    const base = positions.length / 3;
    for (const vertex of vertices) positions.push(vertex.x, vertex.y, vertex.z);
    uvs.push(0.5, 0, 0, 0.24, 0, 0.58, 0.5, 1, 1, 0.58, 1, 0.24);
    indices.push(
      base, base + 1, base + 5,
      base + 1, base + 2, base + 5,
      base + 2, base + 4, base + 5,
      base + 2, base + 3, base + 4,
    );
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.16;
  return geometry;
}

function createMaterials(forestTime) {
  const bark = new THREE.MeshPhysicalNodeMaterial({
    name: "Rough grey-brown procedural gum bark",
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  });
  const crown = new THREE.MeshPhysicalNodeMaterial({
    name: "Opaque wind-reactive crown pads and RTX proxies",
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.89,
    metalness: 0,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  const treePhase = attribute("treePhase", "float");
  const crownFlex = smoothstep(2.2, 11.5, positionLocal.y);
  const crownGust = sin(forestTime.mul(0.82).add(treePhase).add(positionLocal.y.mul(0.19)));
  const crownCross = sin(forestTime.mul(1.17).add(treePhase.mul(1.71)).add(positionLocal.x.mul(0.13)));
  crown.positionNode = vec3(
    positionLocal.x.add(crownGust.mul(crownFlex).mul(0.070)),
    positionLocal.y.sub(abs(crownGust).mul(crownFlex).mul(0.017)),
    positionLocal.z.add(crownCross.mul(crownFlex).mul(0.046)),
  );

  const leaf = new THREE.MeshPhysicalNodeMaterial({
    name: "Wind-reactive literal lanceolate hero leaves",
    color: 0xffffff,
    roughness: 0.84,
    metalness: 0,
    // Keep this close-detail overlay out of generic opaque-scene RTX scans as
    // well as the explicit rtxRoots contract below.
    transparent: true,
    opacity: 0.998,
    depthWrite: true,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  leaf.userData.rtxIgnore = true;
  const leafPhase = attribute("leafPhase", "float");
  const leafFlex = pow(smoothstep(0.0, 0.62, positionLocal.y), 1.45);
  const leafGust = sin(forestTime.mul(1.62).add(leafPhase).add(positionLocal.y.mul(3.7)));
  const leafFlutter = sin(forestTime.mul(3.24).add(leafPhase.mul(1.87)));
  leaf.positionNode = vec3(
    positionLocal.x.add(leafFlutter.mul(leafFlex).mul(0.018)),
    positionLocal.y.sub(abs(leafGust).mul(leafFlex).mul(0.012)),
    positionLocal.z.add(leafGust.mul(leafFlex).mul(0.032)),
  );
  return { bark, crown, leaf };
}

function resolveCell(record, fireModel) {
  if (fireModel?.cells && record.fireCellIndex >= 0) {
    const indexed = fireModel.cells[record.fireCellIndex];
    if (indexed) return indexed;
  }
  if (typeof fireModel?.cellAtWorld === "function") {
    try {
      const mapped = fireModel.cellAtWorld(record.x, record.z);
      if (Number.isInteger(mapped)) {
        record.fireCellIndex = mapped;
        record.cellIndex = mapped;
        return fireModel.cells?.[mapped] ?? record.fireCell;
      }
      if (mapped && typeof mapped === "object") {
        if (Number.isInteger(mapped.index)) {
          record.fireCellIndex = mapped.index;
          record.cellIndex = mapped.index;
        }
        record.fireCell = mapped;
        return mapped;
      }
    } catch {
      // The stable callback mapping remains a valid fallback.
    }
  }
  return record.fireCell;
}

function cellBurnState(cell) {
  if (!cell || typeof cell !== "object") return { burn: 0, active: false, spent: false };
  const stateName = typeof cell.state === "string" ? cell.state.toLowerCase() : "";
  const numericState = Number.isFinite(Number(cell.state)) ? Number(cell.state) : -1;
  const active = /^(burning|flaming|active|crown-fire|surface-fire)$/.test(stateName) || numericState === 1 || numericState === 2;
  const fuel = Number.isFinite(Number(cell.fuel)) ? clamp01(cell.fuel) : 1;
  const depleted = fuel <= 0.055;
  const spent = /^(burned|burnt|spent|ash|charred|consumed)$/.test(stateName) || numericState >= 3 || depleted;
  let burn = clamp01(cell.burn);
  if (active) burn = Math.max(burn, 0.10);
  if (spent) burn = Math.max(burn, 0.96);
  burn = Math.max(burn, (1 - fuel) * 0.36);
  return { burn, active, spent };
}

function setDynamicInstanceUsage(mesh) {
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
}

function composeTreeInstance(record, archetype, branchMesh, crownMesh, charAmount, scratch) {
  const snagAmount = snagAmountForBurn(charAmount);
  record.snagAmount = snagAmount;
  scratch.position.set(record.x, record.y, record.z);
  scratch.rotation.set(
    record.snagLeanX * snagAmount,
    record.yaw + record.snagYawOffset * snagAmount,
    record.snagLeanZ * snagAmount,
    "YXZ",
  );
  scratch.scale.set(
    record.scale * mixNumber(1, record.snagWidthX, snagAmount),
    record.scale * mixNumber(1, record.snagHeightScale, snagAmount),
    record.scale * mixNumber(1, record.snagWidthZ, snagAmount),
  );
  scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
  branchMesh.setMatrixAt(record.branchInstance, scratch.matrix);

  // Crown proxies remain through the active flame/scorch phase, then collapse
  // completely once the tree becomes a spent snag.  A tiny non-zero matrix is
  // used instead of a singular transform for stable instance/RTX traversal.
  const canopySurvival = 1 - snagAmount;
  const horizontalScale = Math.max(0.0001, (1 - charAmount * 0.69) * canopySurvival);
  const verticalScale = Math.max(0.0001, (1 - charAmount * 0.49) * canopySurvival);
  scratch.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, record.yaw);
  scratch.position.y = record.y + archetype.crownAnchorY * record.scale * (1 - verticalScale);
  scratch.scale.set(record.scale * horizontalScale, record.scale * verticalScale, record.scale * horizontalScale);
  scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
  crownMesh.setMatrixAt(record.crownInstance, scratch.matrix);
}

function composeLeafInstance(
  leafInstance,
  charAmount,
  leafMesh,
  scratch,
  localScratch,
  treeRotationScratch,
) {
  const { record, site, index, archetype } = leafInstance;
  const canopySurvival = 1 - snagAmountForBurn(charAmount);
  const horizontalScale = Math.max(0.0001, (1 - charAmount * 0.71) * canopySurvival);
  const verticalScale = Math.max(0.0001, (1 - charAmount * 0.50) * canopySurvival);
  const local = localScratch.copy(site.position);
  local.x *= horizontalScale;
  local.z *= horizontalScale;
  local.y = archetype.crownAnchorY + (local.y - archetype.crownAnchorY) * verticalScale;
  local.multiplyScalar(record.scale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, record.yaw);
  scratch.position.set(record.x + local.x, record.y + local.y, record.z + local.z);
  treeRotationScratch.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, record.yaw);
  scratch.quaternion.copy(treeRotationScratch).multiply(site.quaternion);
  const leafScale = record.scale * site.scale * Math.max(
    0.0001,
    (1 - charAmount * 0.94) * canopySurvival,
  );
  scratch.scale.setScalar(leafScale);
  scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
  leafMesh.setMatrixAt(index, scratch.matrix);
}

function createUnderstoreyInstances(records, heightAt, seed) {
  const random = mulberry32(seed ^ 0x73637275);
  const colors = [0x314a35, 0x3b563b, 0x455f42, 0x2d4532];
  const instances = [];
  for (const record of records) {
    if (record.lod === "far") continue;
    const desired = record.lod === "hero" ? 5 : 2;
    let placed = 0;
    for (let attempt = 0; attempt < desired * 8 && placed < desired; ++attempt) {
      const angle = random() * TAU;
      const distance = mixNumber(1.45, record.lod === "hero" ? 4.9 : 3.8, Math.sqrt(random()));
      const x = record.x + Math.cos(angle) * distance;
      const z = record.z + Math.sin(angle) * distance;
      if (!validTreeSite(heightAt, x, z)) continue;
      const y = safeHeight(heightAt, x, z);
      if (y === null) continue;
      const item = {
        record,
        index: instances.length,
        x,
        y: y + 0.025,
        z,
        yaw: random() * TAU,
        scaleX: mixNumber(1.15, 2.05, random()),
        scaleY: mixNumber(0.82, 1.52, random()),
        scaleZ: mixNumber(1.05, 1.85, random()),
        phase: random() * TAU,
        healthyColor: new THREE.Color(colors[Math.floor(random() * colors.length)]),
      };
      record.scrubInstances.push(item);
      instances.push(item);
      placed += 1;
    }
  }
  return instances;
}

function composeScrubInstance(item, charAmount, scrubMesh, scratch) {
  const survival = 1 - smoothstepNumber(0.66, 0.92, charAmount);
  const consumed = Math.max(0.0001, (1 - charAmount * 0.90) * survival);
  scratch.position.set(item.x, item.y, item.z);
  scratch.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.yaw);
  scratch.scale.set(
    item.scaleX * Math.max(0.0001, (1 - charAmount * 0.82) * survival),
    item.scaleY * consumed,
    item.scaleZ * Math.max(0.0001, (1 - charAmount * 0.82) * survival),
  );
  scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
  scrubMesh.setMatrixAt(item.index, scratch.matrix);
}

/**
 * Builds a deterministic, asset-free mountainside forest.
 *
 * `fireCellAt(x,z)` may return a stable fire-cell object or its integer index.
 * `update` accepts the live model whose cells expose `{index,x,z,burn,state,fuel}`
 * and whose optional `cellAtWorld(x,z)` resolves a cell or index.
 */
export function createProceduralForest({
  heightAt = () => 0,
  fireCellAt = null,
  seed = 0x62757368,
} = {}) {
  const root = new THREE.Group();
  root.name = "Deterministic instanced eucalypt mountainside forest";
  const forestTime = uniform(0);
  const materials = createMaterials(forestTime);
  const placements = createPlacements(heightAt, fireCellAt, Number(seed) >>> 0);
  const archetypes = new Map();
  for (const lod of Object.keys(LOD_SPECS)) {
    for (let variant = 0; variant < LOD_SPECS[lod].archetypes; ++variant) {
      const key = `${lod}:${variant}`;
      archetypes.set(key, createArchetype(lod, variant, (Number(seed) >>> 0) ^ (variant + 1) * 0x45d9f3b));
    }
  }

  const recordsByArchetype = new Map();
  for (const record of placements) {
    const key = `${record.lod}:${record.archetype}`;
    if (!recordsByArchetype.has(key)) recordsByArchetype.set(key, []);
    recordsByArchetype.get(key).push(record);
  }

  const rtxRoots = [];
  const bucketMeshes = [];
  const scratch = new THREE.Object3D();
  const leafLocalScratch = new THREE.Vector3();
  const leafTreeRotationScratch = new THREE.Quaternion();
  const healthyBranch = new THREE.Color();
  const healthyCrown = new THREE.Color();
  for (const [key, records] of recordsByArchetype) {
    const archetype = archetypes.get(key);
    const phases = new Float32Array(records.map((record) => record.phase));
    archetype.crownGeometry.setAttribute("treePhase", new THREE.InstancedBufferAttribute(phases, 1));
    const branches = new THREE.InstancedMesh(archetype.branchGeometry, materials.bark, records.length);
    const crowns = new THREE.InstancedMesh(archetype.crownGeometry, materials.crown, records.length);
    branches.name = `${archetype.lod} shared opaque branch tubes (${records.length})`;
    crowns.name = `${archetype.lod} irregular opaque crown proxies (${records.length})`;
    branches.castShadow = true;
    branches.receiveShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    branches.userData.rtxStaticProxy = true;
    crowns.userData.rtxStaticProxy = true;
    branches.userData.forestLod = archetype.lod;
    crowns.userData.forestLod = archetype.lod;
    for (let index = 0; index < records.length; ++index) {
      const record = records[index];
      record.archetypeKey = key;
      record.branchMesh = branches;
      record.crownMesh = crowns;
      record.branchInstance = index;
      record.crownInstance = index;
      scratch.position.set(record.x, record.y, record.z);
      scratch.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, record.yaw);
      scratch.scale.setScalar(record.scale);
      scratch.updateMatrix();
      branches.setMatrixAt(index, scratch.matrix);
      crowns.setMatrixAt(index, scratch.matrix);
      healthyBranch.copy(record.healthyBark);
      healthyCrown.copy(record.healthyCrown);
      branches.setColorAt(index, healthyBranch);
      crowns.setColorAt(index, healthyCrown);
    }
    branches.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (branches.instanceColor) branches.instanceColor.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    setDynamicInstanceUsage(branches);
    setDynamicInstanceUsage(crowns);
    branches.computeBoundingSphere?.();
    crowns.computeBoundingSphere?.();
    root.add(branches, crowns);
    rtxRoots.push(branches, crowns);
    bucketMeshes.push({ branches, crowns, archetype });
  }

  const leafGeometry = createLanceolateLeafGeometry();
  const leafInstances = [];
  for (const record of placements) {
    if (record.lod === "far") continue;
    const archetype = archetypes.get(record.archetypeKey);
    for (const site of archetype.leafSites) {
      const leafInstance = { record, site, archetype, index: leafInstances.length, mesh: null };
      record.leafInstances.push(leafInstance);
      leafInstances.push(leafInstance);
    }
  }
  const leafPhases = new Float32Array(leafInstances.map((item) => item.record.phase + item.site.phase));
  leafGeometry.setAttribute("leafPhase", new THREE.InstancedBufferAttribute(leafPhases, 1));
  const heroLeaves = new THREE.InstancedMesh(leafGeometry, materials.leaf, leafInstances.length);
  heroLeaves.name = `Raster-only hero and mid-canopy gum foliage sprays (${leafInstances.length})`;
  heroLeaves.castShadow = false;
  heroLeaves.receiveShadow = true;
  heroLeaves.userData.rtxIgnore = true;
  heroLeaves.userData.optionalAnimatedDetail = true;
  const leafColor = new THREE.Color();
  for (const item of leafInstances) {
    item.mesh = heroLeaves;
    composeLeafInstance(
      item,
      0,
      heroLeaves,
      scratch,
      leafLocalScratch,
      leafTreeRotationScratch,
    );
    leafColor.copy(item.record.healthyCrown).offsetHSL(0.015, 0.035, (item.site.phase / TAU - 0.5) * 0.09);
    heroLeaves.setColorAt(item.index, leafColor);
  }
  heroLeaves.instanceMatrix.needsUpdate = true;
  if (heroLeaves.instanceColor) heroLeaves.instanceColor.needsUpdate = true;
  setDynamicInstanceUsage(heroLeaves);
  heroLeaves.computeBoundingSphere?.();
  root.add(heroLeaves);

  const scrubInstances = createUnderstoreyInstances(placements, heightAt, Number(seed) >>> 0);
  const scrubGeometry = leafGeometry.clone();
  scrubGeometry.name = "Shared five-leaf understorey scrub tuft";
  const scrubPhases = new Float32Array(scrubInstances.map((item) => item.phase));
  scrubGeometry.setAttribute("leafPhase", new THREE.InstancedBufferAttribute(scrubPhases, 1));
  const understorey = new THREE.InstancedMesh(scrubGeometry, materials.leaf, scrubInstances.length);
  understorey.name = `Fire-reactive clustered mountainside understorey (${scrubInstances.length})`;
  understorey.castShadow = false;
  understorey.receiveShadow = true;
  understorey.userData.rtxIgnore = true;
  understorey.userData.optionalAnimatedDetail = true;
  const scrubColor = new THREE.Color();
  for (const item of scrubInstances) {
    composeScrubInstance(item, 0, understorey, scratch);
    scrubColor.copy(item.healthyColor).offsetHSL(0.005, 0.02, (item.phase / TAU - 0.5) * 0.08);
    understorey.setColorAt(item.index, scrubColor);
  }
  understorey.instanceMatrix.needsUpdate = true;
  if (understorey.instanceColor) understorey.instanceColor.needsUpdate = true;
  setDynamicInstanceUsage(understorey);
  understorey.computeBoundingSphere?.();
  root.add(understorey);

  const charBark = new THREE.Color(0x100d0b);
  const scorchedCrown = new THREE.Color(0x4a2818);
  const charCrown = new THREE.Color(0x0d0b09);
  const branchColor = new THREE.Color();
  const crownColor = new THREE.Color();
  const changedMeshes = new Set();
  let previousTime = null;

  const applyRecordAppearance = (record, amount) => {
    const archetype = archetypes.get(record.archetypeKey);
    composeTreeInstance(record, archetype, record.branchMesh, record.crownMesh, amount, scratch);
    branchColor.copy(record.healthyBark).lerp(charBark, Math.pow(amount, 1.12));
    crownColor.copy(record.healthyCrown)
      .lerp(scorchedCrown, Math.min(1, amount * 1.35))
      .lerp(charCrown, Math.pow(amount, 1.58));
    record.branchMesh.setColorAt(record.branchInstance, branchColor);
    record.crownMesh.setColorAt(record.crownInstance, crownColor);
    changedMeshes.add(record.branchMesh);
    changedMeshes.add(record.crownMesh);
    for (const leafInstance of record.leafInstances) {
      composeLeafInstance(
        leafInstance,
        amount,
        heroLeaves,
        scratch,
        leafLocalScratch,
        leafTreeRotationScratch,
      );
      leafColor.copy(record.healthyCrown)
        .lerp(scorchedCrown, Math.min(1, amount * 1.5))
        .lerp(charCrown, Math.pow(amount, 1.45));
      heroLeaves.setColorAt(leafInstance.index, leafColor);
    }
    for (const scrubInstance of record.scrubInstances) {
      composeScrubInstance(scrubInstance, amount, understorey, scratch);
      scrubColor.copy(scrubInstance.healthyColor)
        .lerp(scorchedCrown, Math.min(1, amount * 1.42))
        .lerp(charCrown, Math.pow(amount, 1.38));
      understorey.setColorAt(scrubInstance.index, scrubColor);
    }
  };

  const update = (time = 0, fireModel = null) => {
    const seconds = Number.isFinite(Number(time)) ? Number(time) : 0;
    forestTime.value = seconds;
    const dt = previousTime === null ? 1 / 60 : Math.max(0, Math.min(0.12, seconds - previousTime));
    previousTime = seconds;
    changedMeshes.clear();
    let burningTrees = 0;
    let charredTrees = 0;
    let totalBurn = 0;
    let leavesChanged = false;
    let scrubChanged = false;
    for (const record of placements) {
      const state = cellBurnState(resolveCell(record, fireModel));
      record.maximumBurn = Math.max(record.maximumBurn, state.burn);
      const target = state.spent ? 1 : record.maximumBurn;
      if (state.active) burningTrees += 1;
      if (target > 0.72) charredTrees += 1;
      const next = record.visualBurn < 0
        ? target
        : mixNumber(record.visualBurn, target, 1 - Math.exp(-dt * (state.active ? 4.2 : 1.55)));
      totalBurn += next;
      if (record.visualBurn < 0 || Math.abs(next - record.visualBurn) > 0.0007) {
        record.visualBurn = next;
        applyRecordAppearance(record, next);
        leavesChanged ||= record.leafInstances.length > 0;
        scrubChanged ||= record.scrubInstances.length > 0;
      }
    }
    for (const mesh of changedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (leavesChanged) {
      heroLeaves.instanceMatrix.needsUpdate = true;
      if (heroLeaves.instanceColor) heroLeaves.instanceColor.needsUpdate = true;
    }
    if (scrubChanged) {
      understorey.instanceMatrix.needsUpdate = true;
      if (understorey.instanceColor) understorey.instanceColor.needsUpdate = true;
    }
    return {
      burningTrees,
      charredTrees,
      meanBurn: placements.length ? totalBurn / placements.length : 0,
    };
  };

  update(0, null);

  let uniqueBranchTriangles = 0;
  let uniqueCrownTriangles = 0;
  let effectiveRtxTriangles = 0;
  for (const [key, records] of recordsByArchetype) {
    const archetype = archetypes.get(key);
    uniqueBranchTriangles += archetype.branchTriangles;
    uniqueCrownTriangles += archetype.crownTriangles;
    effectiveRtxTriangles += records.length * (archetype.branchTriangles + archetype.crownTriangles);
  }
  const heroCount = placements.filter((record) => record.lod === "hero").length;
  const midCount = placements.filter((record) => record.lod === "mid").length;
  const farCount = placements.filter((record) => record.lod === "far").length;
  const heroFoliageSprays = leafInstances.filter((item) => item.record.lod === "hero").length;
  const midFoliageSprays = leafInstances.length - heroFoliageSprays;
  const leafTriangles = leafGeometry.index.count / 3;
  const scrubTriangles = scrubGeometry.index.count / 3;
  root.userData.forestStats = Object.freeze({
    seed: Number(seed) >>> 0,
    trees: placements.length,
    heroTrees: heroCount,
    midTrees: midCount,
    farTrees: farCount,
    drawCalls: bucketMeshes.length * 2 + (leafInstances.length ? 1 : 0) + (scrubInstances.length ? 1 : 0),
    rtxDrawRoots: rtxRoots.length,
    uniqueBranchTriangles,
    uniqueCrownTriangles,
    uniqueLeafTriangles: leafTriangles,
    uniqueScrubTriangles: scrubTriangles,
    effectiveRtxTriangles,
    heroLeafCards: heroFoliageSprays * 5,
    heroFoliageSprays,
    midFoliageSprays,
    detailFoliageInstances: leafInstances.length,
    understoreyScrub: scrubInstances.length,
    effectiveRasterTriangles: effectiveRtxTriangles +
      leafInstances.length * leafTriangles + scrubInstances.length * scrubTriangles,
  });

  return {
    group: root,
    rtxRoots,
    treeRecords: placements,
    update,
    dispose() {
      root.remove(...root.children);
      for (const archetype of archetypes.values()) {
        archetype.branchGeometry.dispose();
        archetype.crownGeometry.dispose();
      }
      leafGeometry.dispose();
      scrubGeometry.dispose();
      materials.bark.dispose();
      materials.crown.dispose();
      materials.leaf.dispose();
    },
  };
}
