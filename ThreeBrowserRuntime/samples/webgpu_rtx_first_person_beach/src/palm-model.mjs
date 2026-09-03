import * as THREE from "three/webgpu";
import { createMappedMaterial } from "./materials.mjs";

const MATERIAL_PROFILES = Object.freeze({
  "material/palm-bark": Object.freeze({
    tile: "palm-bark", color: 0x4b2f1c, uvScale: [0.85, 4.2], roughness: 0.86, normalScale: 0.38,
  }),
  "material/palm-coconut": Object.freeze({
    tile: "palm-bark", color: 0x3a2616, uvScale: [1.4, 1.4], tint: [0.52, 0.42, 0.29], roughness: 0.78, normalScale: 0.72,
  }),
  "material/palm-rachis": Object.freeze({
    tile: "palm-leaf", color: 0x52712d, uvScale: [0.35, 2.0], tint: [0.72, 0.9, 0.42], roughness: 0.82, normalScale: 0.28,
  }),
  "material/palm-leaf": Object.freeze({
    tile: "palm-leaf", color: 0x174a22, uvScale: [0.22, 1.0], tint: [0.68, 0.9, 0.65], roughness: 0.78, normalScale: 0.3, foliage: true,
  }),
  "material/palm-leaf-light": Object.freeze({
    tile: "palm-leaf", color: 0x367332, uvScale: [0.22, 1.0], tint: [0.82, 1.0, 0.68], roughness: 0.76, normalScale: 0.28, foliage: true,
  }),
  "material/palm-dry-leaf": Object.freeze({
    tile: "palm-bark", color: 0x8b5b27, uvScale: [0.9, 2.6], tint: [1.0, 0.73, 0.34], roughness: 0.91, normalScale: 0.55, foliage: true,
  }),
});

function studioMaterialId(material) {
  return material?.userData?.studioMaterialId ?? material?.userData?.extras?.studioMaterialId ?? null;
}

export function createCylindricalTrunkUvs(source) {
  if (!source || source.getAttribute("uv")) return source;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.computeBoundingBox();
  const position = geometry.getAttribute("position");
  const bounds = geometry.boundingBox;
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerY = (bounds.min.y + bounds.max.y) * 0.5;
  const height = Math.max(1e-6, bounds.max.z - bounds.min.z);
  const values = new Float32Array(position.count * 2);

  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const u = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner;
      u.push(Math.atan2(position.getY(index) - centerY, position.getX(index) - centerX) / (Math.PI * 2) + 0.5);
    }
    if (Math.max(...u) - Math.min(...u) > 0.5) {
      for (let corner = 0; corner < 3; corner += 1) if (u[corner] < 0.5) u[corner] += 1;
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner;
      values[index * 2] = u[corner];
      values[index * 2 + 1] = (position.getZ(index) - bounds.min.z) / height;
    }
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(values, 2));
  geometry.userData.generatedPalmUv = "cylindrical-z-seam-safe";
  return geometry;
}

function radialNormalScore(geometry) {
  geometry.computeBoundingBox();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const bounds = geometry.boundingBox;
  const height = Math.max(1e-6, bounds.max.z - bounds.min.z);
  const buckets = Array.from({ length: 32 }, () => ({ x: 0, y: 0, count: 0 }));
  for (let index = 0; index < position.count; index += 1) {
    const bucketIndex = Math.min(31, Math.max(0, Math.floor(((position.getZ(index) - bounds.min.z) / height) * 31)));
    const bucket = buckets[bucketIndex];
    bucket.x += position.getX(index);
    bucket.y += position.getY(index);
    bucket.count += 1;
  }
  let score = 0;
  for (let index = 0; index < position.count; index += 1) {
    const bucketIndex = Math.min(31, Math.max(0, Math.floor(((position.getZ(index) - bounds.min.z) / height) * 31)));
    const bucket = buckets[bucketIndex];
    const centerX = bucket.count ? bucket.x / bucket.count : 0;
    const centerY = bucket.count ? bucket.y / bucket.count : 0;
    score += ((position.getX(index) - centerX) * normal.getX(index))
      + ((position.getY(index) - centerY) * normal.getY(index));
  }
  return score / position.count;
}

export function orientTrunkOutward(source) {
  const geometry = source.clone();
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (radialNormalScore(geometry) >= 0) return geometry;
  if (!geometry.index) {
    const indices = Array.from({ length: geometry.getAttribute("position").count }, (_, index) => index);
    geometry.setIndex(indices);
  }
  const sourceIndices = geometry.index.array;
  const reversed = new sourceIndices.constructor(sourceIndices);
  for (let offset = 0; offset < reversed.length; offset += 3) {
    const second = reversed[offset + 1];
    reversed[offset + 1] = reversed[offset + 2];
    reversed[offset + 2] = second;
  }
  geometry.setIndex(new THREE.BufferAttribute(reversed, 1));
  geometry.computeVertexNormals();
  geometry.userData.correctedPalmWinding = "outward";
  return geometry;
}

function mappedPalmMaterial(maps, materialId, profile) {
  const material = createMappedMaterial(maps[profile.tile], {
    name: materialId,
    objectUv: true,
    uvScale: profile.uvScale,
    tint: profile.tint,
    color: profile.color,
    roughness: profile.roughness,
    normalScale: profile.normalScale,
    roughnessFromHeight: true,
    roughnessHigh: Math.min(1, profile.roughness + 0.1),
    reflectionMask: profile.foliage ? 0.03 : 0.06,
  });
  material.side = profile.foliage ? THREE.DoubleSide : THREE.FrontSide;
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.depthTest = true;
  material.depthWrite = true;
  material.transmission = 0;
  material.userData.studioMaterialId = materialId;
  return material;
}

export function prepareStudioPalm(template, maps) {
  const materials = new Map(Object.entries(MATERIAL_PROFILES).map(([materialId, profile]) => [
    materialId,
    mappedPalmMaterial(maps, materialId, profile),
  ]));
  template.name = "Studio realistic beach palm";
  template.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const imported = Array.isArray(object.material) ? object.material[0] : object.material;
    const materialId = studioMaterialId(imported);
    const replacement = materials.get(materialId);
    if (replacement) object.material = replacement;
    if (materialId === "material/palm-bark" && !object.geometry.getAttribute("uv")) {
      object.geometry = createCylindricalTrunkUvs(orientTrunkOutward(object.geometry));
    }
    if (MATERIAL_PROFILES[materialId]?.foliage) object.userData.rtxIgnore = true;
  });
  return template;
}
