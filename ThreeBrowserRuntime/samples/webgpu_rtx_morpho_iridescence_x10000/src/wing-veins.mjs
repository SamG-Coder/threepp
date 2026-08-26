import * as THREE from "three/webgpu";

import { MORPHO_SEED, createSeededRandom } from "./morpho-model.mjs";

const VEIN_COLOR = 0x1a120c;
const VEIN_ROUGHNESS = 0.45;
const CAPSULE_RADIUS = 1;
const CAPSULE_LENGTH = 16;
const CAPSULE_HEIGHT = CAPSULE_LENGTH + CAPSULE_RADIUS * 2;
const SEGMENT_LENGTH = 0.028;
const MIN_SEGMENT_LENGTH = 1e-5;
const FOREWING_SPAN = 0.14;
const VEIN_TO_WING = 1.05 / FOREWING_SPAN;
const HINGE = Object.freeze({ x: 0.0065, y: 0.0038, z: 0.0012 });
const UNIT_Y = new THREE.Vector3(0, 1, 0);

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function veinHeight(x, z) {
  const u = THREE.MathUtils.clamp(finite(x) / FOREWING_SPAN, 0, 1);
  const chord = THREE.MathUtils.clamp(Math.abs(finite(z)) / 0.072, 0, 1);
  return 0.00048 + 0.0031 * Math.sin(Math.PI * u) * (1 - chord * 0.42);
}

function toPoint(x, z) {
  const px = finite(x) * VEIN_TO_WING;
  const pz = finite(z) * VEIN_TO_WING;
  return { x: px, y: veinHeight(finite(x), finite(z)) * VEIN_TO_WING, z: pz };
}

function pushSegment(from, to, radius, segments) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!(distance > MIN_SEGMENT_LENGTH)) return;
  const pieces = Math.max(1, Math.round(distance / SEGMENT_LENGTH));
  for (let index = 0; index < pieces; ++index) {
    const t0 = index / pieces;
    const t1 = (index + 1) / pieces;
    segments.push({
      ax: from.x + dx * t0,
      ay: from.y + dy * t0,
      az: from.z + dz * t0,
      bx: from.x + dx * t1,
      by: from.y + dy * t1,
      bz: from.z + dz * t1,
      radius,
    });
  }
}

function pushPolyline(points, radius, segments) {
  for (let index = 0; index < points.length - 1; ++index) {
    pushSegment(points[index], points[index + 1], radius, segments);
  }
}

function jittered(point, random, amount) {
  const span = finite(amount);
  if (!(span > 0)) return point;
  return toPoint(
    point.x + (random() - 0.5) * span,
    point.z + (random() - 0.5) * span,
  );
}

function lateral(points, radius, random, amount, segments) {
  const chain = points.map((point, index) => (
    index === 0 ? point : jittered(point, random, amount)
  ));
  const scaled = radius * (0.9 + random() * 0.18);
  pushPolyline(chain, scaled, segments);
}

function authorRightWingSegments(random) {
  const segments = [];

  const costalRadius = 0.00105 + random() * 0.0001;
  const radialRadius = 0.00076 + random() * 0.00008;
  const cubitalRadius = 0.0007 + random() * 0.00008;
  const lateralRadius = 0.00046 + random() * 0.00008;
  const fineRadius = 0.00038 + random() * 0.00006;

  // Forewing trunks: costa along the leading edge, radius through the
  // discal cell, cubitus along the posterior cell margin toward the tornus.
  pushPolyline([
    toPoint(0.008, 0.038),
    toPoint(0.036, 0.058),
    toPoint(0.072, 0.066),
    toPoint(0.108, 0.054),
    toPoint(0.136, 0.028),
  ], costalRadius, segments);

  pushPolyline([
    toPoint(0.008, 0.022),
    toPoint(0.032, 0.036),
    toPoint(0.056, 0.04),
  ], radialRadius, segments);

  pushPolyline([
    toPoint(0.056, 0.04),
    toPoint(0.088, 0.052),
    toPoint(0.118, 0.044),
    toPoint(0.138, 0.022),
  ], radialRadius * 0.82, segments);

  pushPolyline([
    toPoint(0.056, 0.04),
    toPoint(0.092, 0.03),
    toPoint(0.124, 0.014),
    toPoint(0.14, 0),
  ], radialRadius * 0.78, segments);

  pushPolyline([
    toPoint(0.008, 0.008),
    toPoint(0.03, 0.006),
    toPoint(0.058, -0.006),
    toPoint(0.094, -0.022),
    toPoint(0.118, -0.032),
  ], cubitalRadius, segments);

  // Eight Morpho laterals on the forewing: R4/R5, M1–M3, Cu2, anal, discal,
  // and a costal–radial cross that closes the cell.
  lateral([
    toPoint(0.056, 0.04),
    toPoint(0.09, 0.016),
    toPoint(0.122, -0.004),
    toPoint(0.136, -0.014),
  ], lateralRadius, random, 0.0032, segments);
  lateral([
    toPoint(0.056, 0.02),
    toPoint(0.092, 0.002),
    toPoint(0.122, -0.014),
  ], lateralRadius, random, 0.0028, segments);
  lateral([
    toPoint(0.054, 0.008),
    toPoint(0.086, -0.01),
    toPoint(0.112, -0.024),
  ], lateralRadius, random, 0.0026, segments);
  lateral([
    toPoint(0.052, -0.002),
    toPoint(0.082, -0.02),
    toPoint(0.104, -0.032),
  ], fineRadius, random, 0.0024, segments);
  lateral([
    toPoint(0.03, 0.006),
    toPoint(0.056, -0.016),
    toPoint(0.078, -0.03),
  ], fineRadius, random, 0.0022, segments);
  lateral([
    toPoint(0.01, 0),
    toPoint(0.032, -0.016),
    toPoint(0.054, -0.026),
    toPoint(0.068, -0.03),
  ], fineRadius, random, 0.002, segments);
  lateral([
    toPoint(0.056, 0.04),
    toPoint(0.054, 0.018),
    toPoint(0.056, -0.002),
    toPoint(0.058, -0.006),
  ], lateralRadius * 0.92, random, 0.0016, segments);
  lateral([
    toPoint(0.036, 0.058),
    toPoint(0.04, 0.04),
    toPoint(0.056, 0.04),
  ], fineRadius, random, 0.0018, segments);

  // Hindwing trunks, slightly overlapping the forewing inner margin.
  pushPolyline([
    toPoint(0.008, 0.006),
    toPoint(0.04, 0.01),
    toPoint(0.078, 0),
    toPoint(0.104, -0.016),
  ], costalRadius * 0.88, segments);

  pushPolyline([
    toPoint(0.008, -0.008),
    toPoint(0.038, -0.006),
    toPoint(0.076, -0.018),
    toPoint(0.108, -0.034),
  ], radialRadius * 0.9, segments);

  pushPolyline([
    toPoint(0.008, -0.022),
    toPoint(0.04, -0.032),
    toPoint(0.074, -0.05),
    toPoint(0.096, -0.066),
  ], cubitalRadius * 0.92, segments);

  // Eight scallop-bound laterals on the hindwing, including the humeral spur.
  lateral([
    toPoint(0.038, -0.006),
    toPoint(0.072, -0.008),
    toPoint(0.106, -0.02),
  ], lateralRadius, random, 0.0026, segments);
  lateral([
    toPoint(0.038, -0.012),
    toPoint(0.074, -0.024),
    toPoint(0.11, -0.038),
  ], lateralRadius, random, 0.0026, segments);
  lateral([
    toPoint(0.036, -0.02),
    toPoint(0.07, -0.038),
    toPoint(0.1, -0.052),
  ], lateralRadius * 0.95, random, 0.0024, segments);
  lateral([
    toPoint(0.032, -0.028),
    toPoint(0.062, -0.05),
    toPoint(0.088, -0.066),
  ], fineRadius, random, 0.0022, segments);
  lateral([
    toPoint(0.024, -0.03),
    toPoint(0.048, -0.056),
    toPoint(0.068, -0.076),
  ], fineRadius, random, 0.002, segments);
  lateral([
    toPoint(0.014, -0.03),
    toPoint(0.03, -0.056),
    toPoint(0.046, -0.08),
  ], fineRadius, random, 0.0018, segments);
  lateral([
    toPoint(0.008, -0.028),
    toPoint(0.016, -0.052),
    toPoint(0.022, -0.078),
  ], fineRadius, random, 0.0016, segments);
  lateral([
    toPoint(0.008, 0.006),
    toPoint(0.016, 0.014),
    toPoint(0.024, 0.01),
  ], fineRadius, random, 0.0014, segments);

  return segments;
}

function composeSegmentMatrix(segment, sign) {
  const ax = segment.ax * sign;
  const bx = segment.bx * sign;
  scratchDirection.set(bx - ax, segment.by - segment.ay, segment.bz - segment.az);
  const length = scratchDirection.length();
  scratchPosition.set(
    (ax + bx) * 0.5,
    (segment.ay + segment.by) * 0.5,
    (segment.az + segment.bz) * 0.5,
  );
  scratchDirection.multiplyScalar(1 / length);
  scratchQuaternion.setFromUnitVectors(UNIT_Y, scratchDirection);
  scratchScale.set(segment.radius, length / CAPSULE_HEIGHT, segment.radius);
  scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
}

function createVeinMaterial(provided) {
  if (provided) return provided;
  return new THREE.MeshPhysicalMaterial({
    name: "Dark wing-vein chitin",
    color: VEIN_COLOR,
    roughness: VEIN_ROUGHNESS,
    metalness: 0.06,
    clearcoat: 0.2,
    clearcoatRoughness: 0.46,
  });
}

function createVeinMesh(name, geometry, material, segments, sign) {
  const mesh = ignoreDynamicRtx(new THREE.InstancedMesh(geometry, material, segments.length));
  mesh.name = name;
  mesh.count = segments.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  for (let index = 0; index < segments.length; ++index) {
    composeSegmentMatrix(segments[index], sign);
    mesh.setMatrixAt(index, scratchMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Instanced Morpho venation as dark chitin capsules. Tagged rtxIgnore because
 * the veins parent to the flapping wing and must not enter the static BLAS.
 */
export function createWingVeins({ materials } = {}) {
  const random = createSeededRandom(MORPHO_SEED);
  const segments = authorRightWingSegments(random);
  const geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 2, 6);
  geometry.name = "Morpho vein capsule";
  const material = createVeinMaterial(materials?.vein);

  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Morpho wing veins";

  const right = createVeinMesh("Right Morpho wing veins", geometry, material, segments, 1);
  right.position.set(HINGE.x, HINGE.y, HINGE.z);

  const left = createVeinMesh("Left Morpho wing veins", geometry, material, segments, -1);
  left.position.set(-HINGE.x, HINGE.y, HINGE.z);

  group.add(left, right);

  return Object.freeze({
    group,
    left,
    right,
    count: segments.length * 2,
  });
}
