import * as THREE from "three/webgpu";

// Y-up, head +Z, abdomen −Z. Wingspan ~2.4; this chitin body is ~1.05 long.
const BODY_LENGTH = 1.05;
const VELVET_BROWN = 0x1a140f;
const DARK_TEAL = 0x163832;
const TEAL_SHEEN = 0x2f7a72;

const HEAD_METALNESS = 0.22;
const THORAX_METALNESS = 0.32;
const ABDOMEN_METALNESS = 0.26;
const PALP_METALNESS = 0.24;

const ABDOMEN_SEGMENTS = Object.freeze([
  Object.freeze({ z: -0.040, y: 0.000, rx: 0.072, ry: 0.076, rz: 0.048 }),
  Object.freeze({ z: -0.108, y: -0.004, rx: 0.066, ry: 0.070, rz: 0.046 }),
  Object.freeze({ z: -0.174, y: -0.008, rx: 0.059, ry: 0.063, rz: 0.044 }),
  Object.freeze({ z: -0.236, y: -0.012, rx: 0.051, ry: 0.055, rz: 0.042 }),
  Object.freeze({ z: -0.294, y: -0.016, rx: 0.043, ry: 0.046, rz: 0.040 }),
  Object.freeze({ z: -0.348, y: -0.020, rx: 0.035, ry: 0.037, rz: 0.036 }),
  Object.freeze({ z: -0.396, y: -0.024, rx: 0.026, ry: 0.027, rz: 0.034 }),
]);

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function createVelvetTealChitin({ name, color, metalness }) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name,
    color,
    roughness: 0.5,
    metalness,
    sheen: 1,
    sheenColor: new THREE.Color(TEAL_SHEEN),
    sheenRoughness: 0.55,
    clearcoat: 0.14,
    clearcoatRoughness: 0.38,
    ior: 1.56,
    specularIntensity: 0.42,
    specularColor: new THREE.Color(DARK_TEAL),
  });
  material.rtxReflectionMask = 0.2;
  return material;
}

function resolveAnatomyMaterial(source, { name, color, metalness }) {
  const material = source?.isMaterial
    ? source.clone()
    : createVelvetTealChitin({ name, color, metalness });
  material.name = name;
  material.metalness = metalness;
  if ("sheen" in material && !(material.sheen > 0.4)) {
    material.sheen = 1;
    material.sheenColor = new THREE.Color(TEAL_SHEEN);
    material.sheenRoughness = 0.55;
  }
  if (!Number.isFinite(material.rtxReflectionMask)) material.rtxReflectionMask = 0.2;
  return material;
}

function ellipsoidGeometry(rx, ry, rz, widthSegments = 40, heightSegments = 28) {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  geometry.scale(rx, ry, rz);
  return geometry;
}

function addEllipsoid(parent, material, { name, rx, ry, rz, position, rotation, widthSegments, heightSegments }) {
  const mesh = new THREE.Mesh(
    ellipsoidGeometry(rx, ry, rz, widthSegments ?? 40, heightSegments ?? 28),
    material,
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(mesh);
  return mesh;
}

function addPalp(head, sign, material) {
  const side = sign < 0 ? "left" : "right";
  const base = addEllipsoid(head, material, {
    name: `palp-${side}`,
    rx: 0.012,
    ry: 0.010,
    rz: 0.024,
    position: [0.018 * sign, -0.040, 0.052],
    rotation: [0.58, 0.22 * sign, 0.08 * sign],
    widthSegments: 20,
    heightSegments: 14,
  });
  addEllipsoid(head, material, {
    name: `palp-${side}-club`,
    rx: 0.009,
    ry: 0.009,
    rz: 0.016,
    position: [0.026 * sign, -0.054, 0.074],
    rotation: [0.72, 0.18 * sign, 0],
    widthSegments: 16,
    heightSegments: 12,
  });
  return base;
}

/**
 * Velvet Morpho menelaus chitin: head ellipsoid, two-lobe thorax, tapered
 * seven-segment abdomen, and small palps. The insect is animated, so the
 * whole group stays out of the static BLAS.
 */
export function createInsectAnatomy({ materials, textures } = {}) {
  const bodyMap = textures?.body?.isTexture ? textures.body : null;

  const headMaterial = resolveAnatomyMaterial(materials?.head, {
    name: "Morpho velvet head chitin",
    color: VELVET_BROWN,
    metalness: HEAD_METALNESS,
  });
  const thoraxMaterial = resolveAnatomyMaterial(materials?.body, {
    name: "Morpho velvet thorax chitin",
    color: DARK_TEAL,
    metalness: THORAX_METALNESS,
  });
  const abdomenMaterial = resolveAnatomyMaterial(materials?.body, {
    name: "Morpho velvet abdomen chitin",
    color: DARK_TEAL,
    metalness: ABDOMEN_METALNESS,
  });
  const palpMaterial = resolveAnatomyMaterial(materials?.body, {
    name: "Morpho velvet palp chitin",
    color: VELVET_BROWN,
    metalness: PALP_METALNESS,
  });

  if (bodyMap) {
    if (!thoraxMaterial.map) thoraxMaterial.map = bodyMap;
    if (!abdomenMaterial.map) abdomenMaterial.map = bodyMap;
  }

  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Morpho menelaus velvet chitin anatomy";
  group.userData.bodyLength = BODY_LENGTH;

  const thorax = ignoreDynamicRtx(new THREE.Group());
  thorax.name = "thorax";
  addEllipsoid(thorax, thoraxMaterial, {
    name: "mesothorax",
    rx: 0.098,
    ry: 0.090,
    rz: 0.095,
    position: [0, 0.020, 0.082],
    widthSegments: 48,
    heightSegments: 32,
  });
  addEllipsoid(thorax, thoraxMaterial, {
    name: "metathorax",
    rx: 0.092,
    ry: 0.084,
    rz: 0.082,
    position: [0, 0.012, -0.068],
    widthSegments: 44,
    heightSegments: 30,
  });
  addEllipsoid(thorax, thoraxMaterial, {
    name: "thorax-neck",
    rx: 0.036,
    ry: 0.034,
    rz: 0.032,
    position: [0, 0.010, 0.195],
    widthSegments: 24,
    heightSegments: 18,
  });
  addEllipsoid(thorax, thoraxMaterial, {
    name: "scutellum",
    rx: 0.042,
    ry: 0.028,
    rz: 0.038,
    position: [0, 0.078, 0.055],
    widthSegments: 24,
    heightSegments: 16,
  });
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? "left" : "right";
    addEllipsoid(thorax, thoraxMaterial, {
      name: `wing-process-${side}`,
      rx: 0.028,
      ry: 0.022,
      rz: 0.040,
      position: [0.088 * sign, 0.018, 0.070],
      widthSegments: 20,
      heightSegments: 14,
    });
  }
  group.add(thorax);

  const head = ignoreDynamicRtx(new THREE.Mesh(
    ellipsoidGeometry(0.070, 0.074, 0.082, 48, 32),
    headMaterial,
  ));
  head.name = "head";
  head.castShadow = true;
  head.receiveShadow = true;
  head.position.set(0, 0.016, 0.388);
  addPalp(head, -1, palpMaterial);
  addPalp(head, 1, palpMaterial);
  group.add(head);

  const abdomen = ignoreDynamicRtx(new THREE.Group());
  abdomen.name = "abdomen";
  abdomen.position.set(0, -0.006, -0.148);
  abdomen.rotation.x = -0.10;
  for (let index = 0; index < ABDOMEN_SEGMENTS.length; ++index) {
    const segment = ABDOMEN_SEGMENTS[index];
    addEllipsoid(abdomen, abdomenMaterial, {
      name: `abdomen-segment-${index + 1}`,
      rx: segment.rx,
      ry: segment.ry,
      rz: segment.rz,
      position: [0, segment.y, segment.z],
      widthSegments: 36,
      heightSegments: 24,
    });
  }
  group.add(abdomen);

  group.traverse(object => {
    object.userData.rtxIgnore = true;
  });

  return Object.freeze({ group, head, thorax, abdomen });
}
