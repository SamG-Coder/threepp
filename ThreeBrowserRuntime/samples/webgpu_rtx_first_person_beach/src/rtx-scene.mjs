import * as THREE from "three/webgpu";

const instanceMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();
const point = new THREE.Vector3();
const baseColor = new THREE.Color();
const emissiveColor = new THREE.Color();
const lightColor = new THREE.Color();
const lightPosition = new THREE.Vector3();
const lightTarget = new THREE.Vector3();
const lightDirection = new THREE.Vector3();

function materialForTriangle(mesh, geometry, firstIndex) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length === 1 || geometry.groups.length === 0) return materials[0] ?? null;
  for (const group of geometry.groups) {
    if (firstIndex >= group.start && firstIndex < group.start + group.count) {
      return materials[group.materialIndex] ?? materials[0] ?? null;
    }
  }
  return materials[0] ?? null;
}

function usableMaterial(material) {
  return Boolean(
    material &&
    !material.userData?.rtxIgnore &&
    material.visible !== false &&
    material.transparent !== true &&
    Number(material.opacity ?? 1) >= 0.995 &&
    Number(material.transmission ?? 0) <= 0.005,
  );
}

function triangleRadiance(material) {
  const explicit = material?.userData?.rtxTriangleRadiance;
  if (Array.isArray(explicit) && explicit.length >= 3) {
    return [
      Number(explicit[0]) || 0,
      Number(explicit[1]) || 0,
      Number(explicit[2]) || 0,
      Number(explicit[3] ?? 1) || 1,
    ];
  }
  baseColor.copy(material?.color ?? new THREE.Color(0x384247));
  emissiveColor.copy(material?.emissive ?? new THREE.Color(0));
  const metalness = THREE.MathUtils.clamp(Number(material?.metalness ?? 0), 0, 1);
  const emissiveIntensity = Math.max(0, Number(material?.emissiveIntensity ?? 1));
  const ambient = 0.013 + metalness * 0.01;
  return [
    Math.min(32, baseColor.r * ambient + emissiveColor.r * emissiveIntensity),
    Math.min(32, baseColor.g * ambient + emissiveColor.g * emissiveIntensity),
    Math.min(32, baseColor.b * ambient + emissiveColor.b * emissiveIntensity),
    1,
  ];
}

function triangleSurface(material) {
  baseColor.copy(material?.color ?? new THREE.Color(0x384247));
  return [
    Math.max(0, baseColor.r),
    Math.max(0, baseColor.g),
    Math.max(0, baseColor.b),
    THREE.MathUtils.clamp(Number(material?.roughness ?? 0.7), 0.02, 1),
  ];
}

function visibleThroughParents(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function elementRange(geometry, count) {
  const startValue = Number(geometry.drawRange?.start ?? 0);
  const countValue = Number(geometry.drawRange?.count ?? Infinity);
  const start = THREE.MathUtils.clamp(Number.isFinite(startValue) ? Math.trunc(startValue) : 0, 0, count);
  const length = Number.isFinite(countValue) ? Math.max(0, Math.trunc(countValue)) : count - start;
  return { start, end: Math.min(count, start + length) };
}

function appendMesh(mesh, positions, indices, radiance, surfaces) {
  const geometry = mesh.geometry;
  const attribute = geometry?.getAttribute?.("position");
  if (!attribute || attribute.itemSize < 3 || attribute.count < 3) return;
  const sourceIndices = geometry.getIndex();
  const sourceCount = sourceIndices ? sourceIndices.count : attribute.count - (attribute.count % 3);
  const range = elementRange(geometry, sourceCount);
  const instances = mesh.isInstancedMesh ? mesh.count : 1;

  for (let instance = 0; instance < instances; ++instance) {
    if (mesh.isInstancedMesh) {
      mesh.getMatrixAt(instance, instanceMatrix);
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
    } else {
      worldMatrix.copy(mesh.matrixWorld);
    }
    const vertexOffset = positions.length / 3;
    for (let vertex = 0; vertex < attribute.count; ++vertex) {
      point.fromBufferAttribute(attribute, vertex).applyMatrix4(worldMatrix);
      positions.push(point.x, point.y, point.z);
    }
    for (let cursor = range.start; cursor + 2 < range.end; cursor += 3) {
      const material = materialForTriangle(mesh, geometry, cursor);
      if (!usableMaterial(material)) continue;
      const a = sourceIndices ? sourceIndices.getX(cursor) : cursor;
      const b = sourceIndices ? sourceIndices.getX(cursor + 1) : cursor + 1;
      const c = sourceIndices ? sourceIndices.getX(cursor + 2) : cursor + 2;
      if (a >= attribute.count || b >= attribute.count || c >= attribute.count) continue;
      indices.push(vertexOffset + a, vertexOffset + b, vertexOffset + c);
      radiance.push(...triangleRadiance(material));
      surfaces.push(...triangleSurface(material));
    }
  }
}

function collectLights(lights) {
  const packed = [];
  for (const light of lights ?? []) {
    if (!light?.isLight || light.visible === false || packed.length >= 8 * 16) continue;
    if (!light.isPointLight && !light.isSpotLight) continue;
    light.updateWorldMatrix?.(true, false);
    light.getWorldPosition(lightPosition);
    lightColor.copy(light.color ?? new THREE.Color(0xffffff));
    const range = Math.max(0.25, Number(light.distance) || 80);
    const intensity = Math.max(0, Number(light.intensity) || 0);
    lightDirection.set(0, -1, 0);
    let outerCos = -1;
    let innerCos = -1;
    let type = 0;
    if (light.isSpotLight) {
      light.target?.updateWorldMatrix?.(true, false);
      light.target?.getWorldPosition?.(lightTarget);
      lightDirection.copy(lightTarget).sub(lightPosition).normalize();
      const angle = THREE.MathUtils.clamp(Number(light.angle) || Math.PI / 3, 0.01, Math.PI / 2);
      const penumbra = THREE.MathUtils.clamp(Number(light.penumbra) || 0, 0, 1);
      outerCos = Math.cos(angle);
      innerCos = Math.cos(angle * (1 - penumbra));
      type = 1;
    }
    packed.push(
      lightPosition.x, lightPosition.y, lightPosition.z, range,
      lightDirection.x, lightDirection.y, lightDirection.z, outerCos,
      lightColor.r, lightColor.g, lightColor.b, intensity,
      innerCos, type, Math.max(0, Number(light.decay) || 2), 0,
    );
  }
  return new Float32Array(packed);
}

export function collectStaticBeachScene(roots, lights = []) {
  const positions = [];
  const indices = [];
  const radiance = [];
  const surfaces = [];
  const visited = new Set();
  for (const root of roots ?? []) {
    if (!root || visited.has(root)) continue;
    root.updateWorldMatrix(true, true);
    root.traverse(child => {
      if (visited.has(child) || child.userData?.rtxIgnore || !visibleThroughParents(child)) return;
      visited.add(child);
      if (!child.isMesh && !child.isInstancedMesh) return;
      if (child.isSkinnedMesh || child.morphTargetInfluences) return;
      appendMesh(child, positions, indices, radiance, surfaces);
    });
  }
  if (positions.length === 0 || indices.length === 0) {
    throw new Error("First-person beach contains no static RTX triangles.");
  }
  const triangleCount = indices.length / 3;
  if (indices.length % 3 !== 0 || radiance.length !== triangleCount * 4 || surfaces.length !== triangleCount * 4) {
    throw new Error("First-person beach RTX geometry and material streams are misaligned.");
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleRadiance: new Float32Array(radiance),
    triangleSurface: new Float32Array(surfaces),
    lights: collectLights(lights),
    vertexCount: positions.length / 3,
    triangleCount,
  };
}
