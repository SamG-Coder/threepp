import * as THREE from "three/webgpu";

const CHITIN_IOR = 1.56;
const WING_SPAN = 1.05;
const WING_CAMBER = 0.042;
const MEMBRANE_OPACITY = 1;
const MEMBRANE_ROUGHNESS = 0.14;
const MEMBRANE_TRANSMISSION = 0;

// Morpho menelaus planform, millimetre proportions scaled to garden units.
// Leading edge is the rounded costa → apex. Trailing edge carries the hindwing
// lobe; scallops are added on top. u = 0 at the thorax, u = 1 at the apex.
const LEADING_EDGE = Object.freeze([
  Object.freeze([0.00, 0.070]),
  Object.freeze([0.06, 0.168]),
  Object.freeze([0.14, 0.262]),
  Object.freeze([0.26, 0.318]),
  Object.freeze([0.40, 0.332]),
  Object.freeze([0.55, 0.308]),
  Object.freeze([0.70, 0.252]),
  Object.freeze([0.84, 0.182]),
  Object.freeze([0.93, 0.132]),
  Object.freeze([1.00, 0.108]),
]);

const TRAILING_EDGE = Object.freeze([
  Object.freeze([0.00, -0.058]),
  Object.freeze([0.045, -0.132]),
  Object.freeze([0.10, -0.268]),
  Object.freeze([0.16, -0.358]),
  Object.freeze([0.24, -0.398]),
  Object.freeze([0.32, -0.372]),
  Object.freeze([0.40, -0.292]),
  Object.freeze([0.48, -0.176]),
  Object.freeze([0.54, -0.138]),
  Object.freeze([0.64, -0.102]),
  Object.freeze([0.76, -0.048]),
  Object.freeze([0.88, 0.018]),
  Object.freeze([0.96, 0.078]),
  Object.freeze([1.00, 0.108]),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value), 0, 1);
}

function positiveInteger(value, fallback, minimum) {
  const integer = Math.trunc(finite(value, fallback));
  return integer >= minimum ? integer : fallback;
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function sampleCurve(points, u) {
  const unit = clamp01(u);
  const last = points.length - 1;
  if (unit <= points[0][0]) return points[0][1];
  if (unit >= points[last][0]) return points[last][1];
  let index = 0;
  while (index < last && unit > points[index + 1][0]) index += 1;
  const span = points[index + 1][0] - points[index][0];
  const t = span > 1e-8 ? (unit - points[index][0]) / span : 0;
  const cosine = 0.5 - 0.5 * Math.cos(t * Math.PI);
  return THREE.MathUtils.lerp(points[index][1], points[index + 1][1], cosine);
}

function yLeading(u) {
  return sampleCurve(LEADING_EDGE, u);
}

function hindwingScallops(u) {
  const start = 0.07;
  const end = 0.50;
  if (u <= start || u >= end) return 0;
  const t = (u - start) / (end - start);
  const envelope = Math.sin(t * Math.PI);
  // Four to five rounded lobes on the Morpho hindwing trailing edge.
  const lobes = Math.sin(t * Math.PI * 8.6 + 0.52);
  const fine = Math.sin(t * Math.PI * 17.2 + 1.1) * 0.18;
  return envelope * (lobes + fine) * 0.030;
}

function tornusNotch(u) {
  const delta = (u - 0.515) / 0.038;
  return -0.022 * Math.exp(-delta * delta);
}

function yTrailing(u) {
  const unit = clamp01(u);
  const base = sampleCurve(TRAILING_EDGE, unit);
  const apexMeet = Math.pow(unit, 12);
  const trailing = base + hindwingScallops(unit) + tornusNotch(unit);
  return THREE.MathUtils.lerp(trailing, yLeading(1), apexMeet);
}

function camberZ(u, v) {
  const airfoil = 4 * v * (1 - v);
  const spanwise = Math.sin(Math.PI * u);
  const hindFlatten = 1 - 0.18 * v * v;
  return WING_CAMBER * (
    0.20 * spanwise +
    0.80 * airfoil * (0.32 + 0.68 * spanwise)
  ) * hindFlatten;
}

function createMembraneMaterial(wingTexture) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Morpho dorsal membrane",
    color: wingTexture ? 0xffffff : 0x1a5cff,
    map: wingTexture || null,
    roughness: MEMBRANE_ROUGHNESS,
    metalness: 0.12,
    transmission: 0,
    thickness: 0.012,
    ior: CHITIN_IOR,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 1,
    iridescenceIOR: CHITIN_IOR,
    iridescenceThicknessRange: [90, 380],
    sheen: 0.7,
    sheenColor: 0x14e0c8,
    sheenRoughness: 0.22,
    emissive: 0x0a38ff,
    emissiveIntensity: 0.42,
  });
  material.iridescence = 1;
  material.iridescenceIOR = CHITIN_IOR;
  material.iridescenceThicknessRange = [90, 380];
  material.rtxReflectionMask = 0.62;
  material.userData.rtxIgnore = true;
  return material;
}

function createMarginMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Morpho dark wing margin",
    color: 0x070605,
    roughness: 0.62,
    metalness: 0.04,
    sheen: 0.2,
    sheenColor: 0x2a1810,
    sheenRoughness: 0.7,
  });
  material.rtxReflectionMask = 0.08;
  material.userData.rtxIgnore = true;
  return material;
}

function applyWingTexture(material, wingTexture) {
  if (!material || !wingTexture) return material;
  material.map = wingTexture;
  if (material.color?.isColor) material.color.setHex(0xffffff);
  material.needsUpdate = true;
  return material;
}

/**
 * Morpho menelaus membrane: rounded forewing costa and a scalloped hindwing
 * trailing edge. Lies in XZ (open dorsal face toward +Y) with span along ±X,
 * chord along Z (head +Z), root at the origin, slight Y camber.
 * `side: "right"` mirrors the authored left-wing outline in X.
 */
export function createWingMembraneGeometry({
  side = "left",
  spanSegments = 48,
  chordSegments = 24,
} = {}) {
  const sideName = side === "right" ? "right" : "left";
  const sign = sideName === "right" ? 1 : -1;
  const spanCount = positiveInteger(spanSegments, 48, 8);
  const chordCount = positiveInteger(chordSegments, 24, 4);
  const columns = spanCount + 1;
  const rows = chordCount + 1;
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const indices = [];

  for (let spanIndex = 0; spanIndex < columns; ++spanIndex) {
    const u = spanIndex / spanCount;
    const lead = yLeading(u);
    const trail = yTrailing(u);
    const x = sign * WING_SPAN * u;
    for (let chordIndex = 0; chordIndex < rows; ++chordIndex) {
      const v = chordIndex / chordCount;
      const vertex = spanIndex * rows + chordIndex;
      const chord = THREE.MathUtils.lerp(lead, trail, v);
      const p = vertex * 3;
      const uv = vertex * 2;
      positions[p] = x;
      positions[p + 1] = camberZ(u, v);
      positions[p + 2] = chord;
      uvs[uv] = u;
      uvs[uv + 1] = 1 - v;
    }
  }

  for (let spanIndex = 0; spanIndex < spanCount; ++spanIndex) {
    for (let chordIndex = 0; chordIndex < chordCount; ++chordIndex) {
      const a = spanIndex * rows + chordIndex;
      const b = a + rows;
      if (sign > 0) {
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      } else {
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = sideName === "right"
    ? "Morpho menelaus right wing membrane"
    : "Morpho menelaus left wing membrane";
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData = {
    side: sideName,
    spanSegments: spanCount,
    chordSegments: chordCount,
    span: WING_SPAN,
  };
  return geometry;
}

export function createWingMembranes({ materials, textures } = {}) {
  const wingTexture = textures?.wingTexture ?? null;
  const leftGeometry = createWingMembraneGeometry({ side: "left" });
  const rightGeometry = createWingMembraneGeometry({ side: "right" });

  const membrane = materials?.membrane ?? createMembraneMaterial(wingTexture);
  applyWingTexture(membrane, wingTexture);
  const leftMaterial = materials?.left ?? membrane;
  const rightMaterial = materials?.right ?? membrane;
  if (leftMaterial !== membrane) applyWingTexture(leftMaterial, wingTexture);
  if (rightMaterial !== membrane && rightMaterial !== leftMaterial) {
    applyWingTexture(rightMaterial, wingTexture);
  }

  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Morpho menelaus wing membranes";

  const marginMaterial = createMarginMaterial();
  const left = ignoreDynamicRtx(new THREE.Mesh(leftGeometry, leftMaterial));
  left.name = "Morpho left wing membrane";
  left.castShadow = true;
  left.receiveShadow = true;
  left.renderOrder = 2;
  left.userData.side = "left";

  const right = ignoreDynamicRtx(new THREE.Mesh(rightGeometry, rightMaterial));
  right.name = "Morpho right wing membrane";
  right.castShadow = true;
  right.receiveShadow = true;
  right.renderOrder = 2;
  right.userData.side = "right";

  const leftMargin = ignoreDynamicRtx(new THREE.Mesh(leftGeometry, marginMaterial));
  leftMargin.name = "Morpho left wing dark margin";
  leftMargin.scale.set(1.045, 0.55, 1.045);
  leftMargin.position.y = -0.004;
  leftMargin.renderOrder = 1;
  left.add(leftMargin);
  const rightMargin = ignoreDynamicRtx(new THREE.Mesh(rightGeometry, marginMaterial));
  rightMargin.name = "Morpho right wing dark margin";
  rightMargin.scale.set(1.045, 0.55, 1.045);
  rightMargin.position.y = -0.004;
  rightMargin.renderOrder = 1;
  right.add(rightMargin);

  group.add(left, right);

  return Object.freeze({
    left,
    right,
    group,
    geometries: Object.freeze({ left: leftGeometry, right: rightGeometry }),
    materials: Object.freeze({
      membrane: leftMaterial,
      left: leftMaterial,
      right: rightMaterial,
    }),
  });
}
