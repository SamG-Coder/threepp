import * as THREE from "three/webgpu";

import { createSeededRandom, MORPHO_SEED } from "./morpho-model.mjs";

const DEFAULT_DEW_COUNT = 28;
const DEW_RADIUS_MIN = 0.0024;
const DEW_RADIUS_MAX = 0.0055;
const DEW_Y_MIN = 0.4;
const DEW_Y_MAX = 1.6;
const DEW_SPREAD = 1.8;
const WATER_IOR = 1.33;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const scratchEuler = new THREE.Euler();
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const integer = Math.trunc(finite(value, fallback));
  return integer > 0 ? integer : fallback;
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function createDewMaterial(materials) {
  const tint = materials?.water?.color?.isColor
    ? materials.water.color.clone()
    : new THREE.Color(0xeefbff);

  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Transmissive dew-drop water",
    color: tint,
    roughness: 0.016,
    metalness: 0,
    transmission: 0.96,
    thickness: 0.028,
    ior: WATER_IOR,
    attenuationColor: new THREE.Color(0xd7f4ff),
    attenuationDistance: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  // Hybrid real-time frame: these beads are raster transmissive water, not
  // path-traced caustics, so they must stay out of the static BLAS.
  material.transparent = true;
  material.ior = WATER_IOR;
  material.rtxPreserveTransparency = 1;
  material.rtxReflectionMask = 0.1;
  material.userData.rtxIgnore = true;
  return material;
}

function composeDewMatrix(index, random) {
  const halfSpread = DEW_SPREAD * 0.5;
  const onWing = random() < 0.44;
  let x;
  let y;
  let z;
  let flatten;
  let rotX;
  let rotY;
  let rotZ;

  if (onWing) {
    const side = index % 2 === 0 ? -1 : 1;
    const u = random();
    const v = random();
    const span = 0.14 + u * 0.72;
    const chord = (v - 0.5) * (0.16 + u * 0.22);
    x = THREE.MathUtils.clamp(side * span, -halfSpread, halfSpread);
    y = THREE.MathUtils.clamp(
      1.06 + (1 - u) * 0.42 + Math.abs(chord) * 0.12,
      DEW_Y_MIN,
      DEW_Y_MAX,
    );
    z = THREE.MathUtils.clamp(chord - 0.04, -halfSpread, halfSpread);
    flatten = 0.56 + random() * 0.2;
    rotX = chord * 1.1;
    rotY = side * 0.16;
    rotZ = -side * (0.22 + u * 0.18);
  } else {
    const angle = index * GOLDEN_ANGLE + random() * 0.35;
    const radius = Math.pow(random(), 0.6) * halfSpread;
    x = Math.cos(angle) * radius;
    z = Math.sin(angle) * radius * 0.92;
    y = THREE.MathUtils.lerp(DEW_Y_MIN, 1.18, Math.pow(random(), 0.85));
    flatten = 0.48 + random() * 0.24;
    rotX = (random() - 0.5) * 0.85;
    rotY = random() * Math.PI * 2;
    rotZ = (random() - 0.5) * 0.85;
  }

  const radius = THREE.MathUtils.lerp(DEW_RADIUS_MIN, DEW_RADIUS_MAX, random());
  scratchPosition.set(x, y, z);
  scratchEuler.set(rotX, rotY, rotZ, "XYZ");
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchScale.set(
    radius * (0.92 + random() * 0.22),
    radius * flatten,
    radius * (0.92 + random() * 0.22),
  );
  scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
}

export function createDewField({
  materials,
  seed = MORPHO_SEED,
  count = DEFAULT_DEW_COUNT,
} = {}) {
  const total = positiveInteger(count, DEFAULT_DEW_COUNT);
  const random = createSeededRandom(seed);
  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Wing and foliage dew field";

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  geometry.name = "Dew-drop sphere";
  const material = createDewMaterial(materials);
  const mesh = ignoreDynamicRtx(new THREE.InstancedMesh(geometry, material, total));
  mesh.name = "Transmissive dew spheres";
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  for (let index = 0; index < total; ++index) {
    composeDewMatrix(index, random);
    mesh.setMatrixAt(index, scratchMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);

  return Object.freeze({ group, count: total });
}
