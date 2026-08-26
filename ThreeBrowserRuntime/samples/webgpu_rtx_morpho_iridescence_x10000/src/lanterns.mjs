import * as THREE from "three/webgpu";

/**
 * Five idle paper lanterns hung from the greenhouse ironwork.
 * Housings stay opaque and emissive so they can enter the static BLAS;
 * they are never rtxIgnored. Five PointLights keep the packed RTX cap ≤ 8.
 */

const LANTERN_COUNT = 5;
const DEFAULT_DISTANCE = 6;
const DEFAULT_DECAY = 2;

const LANTERN_LAYOUT = Object.freeze([
  Object.freeze({
    id: "lantern-0",
    name: "North-west bay paper lantern",
    kind: "sphere",
    position: Object.freeze([-3.62, 2.88, -5.45]),
    yaw: 0.18,
    radius: 0.22,
    length: 0,
    color: 0xffbb77,
    intensity: 3.2,
    distance: 6,
  }),
  Object.freeze({
    id: "lantern-1",
    name: "North-east bay paper lantern",
    kind: "capsule",
    position: Object.freeze([3.48, 2.18, -4.72]),
    yaw: -0.22,
    radius: 0.13,
    length: 0.28,
    color: 0xffaa66,
    intensity: 2.6,
    distance: 5.8,
  }),
  Object.freeze({
    id: "lantern-2",
    name: "Ridge-hung paper lantern",
    kind: "sphere",
    position: Object.freeze([0.16, 3.16, -0.38]),
    yaw: 0.05,
    radius: 0.18,
    length: 0,
    color: 0xffcc88,
    intensity: 3.9,
    distance: 6.2,
  }),
  Object.freeze({
    id: "lantern-3",
    name: "South-west bay paper lantern",
    kind: "capsule",
    position: Object.freeze([-3.94, 1.86, 4.28]),
    yaw: 0.31,
    radius: 0.145,
    length: 0.36,
    color: 0xffb070,
    intensity: 2.2,
    distance: 6,
  }),
  Object.freeze({
    id: "lantern-4",
    name: "South-east bay paper lantern",
    kind: "capsule",
    position: Object.freeze([3.72, 2.54, 5.52]),
    yaw: -0.14,
    radius: 0.155,
    length: 0.32,
    color: 0xffc488,
    intensity: 3.1,
    distance: 6,
  }),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function keepOpaqueForBlas(material) {
  if (!material) return material;
  material.transparent = false;
  material.transmission = 0;
  material.opacity = 1;
  material.depthWrite = true;
  if (material.userData) delete material.userData.rtxIgnore;
  return material;
}

function setRtxSurface(material, reflectionMask, surface, radiance = null) {
  material.rtxReflectionMask = reflectionMask;
  material.userData.rtxUsesResolvedPbr = 1;
  if (surface) material.userData.rtxTriangleSurface = surface;
  if (radiance) material.userData.rtxTriangleRadiance = radiance;
  return material;
}

function createFallbackPaper() {
  return new THREE.MeshPhysicalNodeMaterial({
    name: "Warm mulberry paper lantern housing",
    color: 0xf3d7b0,
    roughness: 0.78,
    metalness: 0,
    clearcoat: 0.04,
    clearcoatRoughness: 0.88,
  });
}

function createFallbackIron() {
  return setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Greenhouse iron lantern ring",
    color: 0x2a2c30,
    roughness: 0.32,
    metalness: 0.85,
    clearcoat: 0.12,
    clearcoatRoughness: 0.42,
  }), 0.48, [0.14, 0.145, 0.155, 0.32], [0.004, 0.004, 0.0045, 1]);
}

function paperHousingMaterial(source, hex) {
  const material = source?.isMaterial ? source.clone() : createFallbackPaper();
  keepOpaqueForBlas(material);
  material.name = "Warm mulberry paper lantern housing";
  const warm = new THREE.Color(hex);
  material.color = material.color?.isColor
    ? material.color.lerp(new THREE.Color(0xf6e0c4), 0.35)
    : new THREE.Color(0xf6e0c4);
  material.emissive = warm.clone();
  material.emissiveIntensity = 1.35;
  material.roughness = finite(material.roughness, 0.78);
  material.metalness = 0;
  const albedo = material.color;
  return setRtxSurface(
    material,
    0.1,
    [albedo.r, albedo.g, albedo.b, finite(material.roughness, 0.78)],
    [
      Math.min(64, warm.r * 1.85),
      Math.min(64, warm.g * 1.55),
      Math.min(64, warm.b * 1.15),
      1,
    ],
  );
}

function resolveIron(materials) {
  const iron = materials?.iron?.isMaterial ? materials.iron.clone() : createFallbackIron();
  keepOpaqueForBlas(iron);
  if (!Number.isFinite(iron.rtxReflectionMask)) iron.rtxReflectionMask = 0.48;
  return iron;
}

function addIronRing(parent, iron, radius, y) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(0.008, radius * 0.055), 10, 32),
    iron,
  );
  ring.name = "Lantern iron ring";
  ring.rotation.x = Math.PI * 0.5;
  ring.position.y = y;
  ring.castShadow = true;
  ring.receiveShadow = true;
  parent.add(ring);
  return ring;
}

function buildLantern(spec, paperSource, iron) {
  const lantern = new THREE.Group();
  lantern.name = spec.name;
  lantern.position.set(spec.position[0], spec.position[1], spec.position[2]);
  lantern.rotation.y = spec.yaw;

  const radius = Math.max(0.08, finite(spec.radius, 0.18));
  const length = Math.max(0, finite(spec.length, 0));
  const paper = paperHousingMaterial(paperSource, spec.color);
  const geometry = spec.kind === "capsule"
    ? new THREE.CapsuleGeometry(radius, length, 8, 20)
    : new THREE.SphereGeometry(radius, 24, 16);
  const housing = new THREE.Mesh(geometry, paper);
  housing.name = `${spec.name} housing`;
  housing.castShadow = true;
  housing.receiveShadow = true;
  lantern.add(housing);

  const halfBody = spec.kind === "capsule" ? length * 0.5 : radius * 0.72;
  addIronRing(housing, iron, radius * 0.98, halfBody);
  addIronRing(housing, iron, radius * 0.98, -halfBody);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.34, radius * 0.42, radius * 0.16, 16),
    iron,
  );
  cap.name = "Lantern iron cap";
  cap.position.y = (spec.kind === "capsule" ? length * 0.5 + radius : radius) - radius * 0.02;
  cap.castShadow = true;
  cap.receiveShadow = true;
  housing.add(cap);

  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.12, radius * 0.028, 8, 16, Math.PI),
    iron,
  );
  hook.name = "Lantern iron hang hook";
  hook.position.y = cap.position.y + radius * 0.16;
  hook.castShadow = true;
  housing.add(hook);

  const hang = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.34, 6),
    iron,
  );
  hang.name = "Lantern hang rod";
  hang.position.y = hook.position.y + 0.17;
  hang.castShadow = true;
  housing.add(hang);

  const light = new THREE.PointLight(
    spec.color,
    THREE.MathUtils.clamp(finite(spec.intensity, 3), 2, 4),
    finite(spec.distance, DEFAULT_DISTANCE) || DEFAULT_DISTANCE,
    DEFAULT_DECAY,
  );
  light.name = `${spec.name} warm fill`;
  light.decay = DEFAULT_DECAY;
  light.castShadow = false;
  light.position.set(0, 0, 0);
  lantern.add(light);

  return { lantern, housing, light };
}

/** Build five hung paper lanterns with warm 1800–2200 K point fills. */
export function createLanterns({ materials } = {}) {
  const group = new THREE.Group();
  group.name = "Greenhouse paper lanterns";

  const iron = resolveIron(materials);
  const paperSource = materials?.paper?.isMaterial ? materials.paper : null;
  const lights = [];
  const housings = [];

  for (let index = 0; index < LANTERN_COUNT; ++index) {
    const spec = LANTERN_LAYOUT[index];
    const { lantern, housing, light } = buildLantern(spec, paperSource, iron);
    group.add(lantern);
    lights.push(light);
    housings.push(housing);
  }

  return { group, lights, housings };
}
