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

  baseColor.copy(material?.color ?? new THREE.Color(0x3b4246));
  emissiveColor.copy(material?.emissive ?? new THREE.Color(0x000000));
  const metalness = THREE.MathUtils.clamp(Number(material?.metalness ?? 0), 0, 1);
  const emissiveIntensity = Math.max(0, Number(material?.emissiveIntensity ?? 1));
  // OP84 now evaluates shadowed direct light at the secondary hit.  Keep only
  // a restrained night-sky floor here plus true emissive energy; the old 0.3+
  // base-color term made every building face self luminous and produced the
  // disconnected bright strips visible in wet-floor reflections.
  const ambientResponse = 0.012 + metalness * 0.008;
  return [
    Math.min(32, baseColor.r * ambientResponse + emissiveColor.r * emissiveIntensity),
    Math.min(32, baseColor.g * ambientResponse + emissiveColor.g * emissiveIntensity),
    Math.min(32, baseColor.b * ambientResponse + emissiveColor.b * emissiveIntensity),
    1,
  ];
}

function triangleSurface(material) {
  baseColor.copy(material?.color ?? new THREE.Color(0x3b4246));
  const roughness = THREE.MathUtils.clamp(Number(material?.roughness ?? 0.7), 0.02, 1);
  return [
    Math.max(0, baseColor.r),
    Math.max(0, baseColor.g),
    Math.max(0, baseColor.b),
    roughness,
  ];
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

function isEffectivelyVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function drawableElementRange(geometry, elementCount) {
  const drawRange = geometry?.drawRange;
  const startValue = Number(drawRange?.start ?? 0);
  const countValue = Number(drawRange?.count ?? Infinity);
  const start = THREE.MathUtils.clamp(
    Number.isFinite(startValue) ? Math.trunc(startValue) : 0,
    0,
    elementCount,
  );
  const count = Number.isFinite(countValue)
    ? Math.max(0, Math.trunc(countValue))
    : elementCount - start;
  return { start, end: Math.min(elementCount, start + count) };
}

function appendMesh(mesh, positions, indices, radiance, surfaces) {
  const geometry = mesh.geometry;
  const attribute = geometry?.getAttribute?.("position");
  if (!attribute || attribute.itemSize < 3 || attribute.count < 3) return;

  const geometryIndex = geometry.getIndex();
  const indexCount = geometryIndex ? geometryIndex.count : attribute.count - (attribute.count % 3);
  const drawRange = drawableElementRange(geometry, indexCount);
  if (drawRange.end - drawRange.start < 3) return;
  const instanceCount = mesh.isInstancedMesh ? mesh.count : 1;

  for (let instance = 0; instance < instanceCount; ++instance) {
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

    // drawRange is expressed in index-buffer elements for indexed geometry and
    // vertex elements otherwise, matching Three.js's renderer contract.
    for (let cursor = drawRange.start; cursor + 2 < drawRange.end; cursor += 3) {
      const material = materialForTriangle(mesh, geometry, cursor);
      if (!usableMaterial(material)) continue;
      const a = geometryIndex ? geometryIndex.getX(cursor) : cursor;
      const b = geometryIndex ? geometryIndex.getX(cursor + 1) : cursor + 1;
      const c = geometryIndex ? geometryIndex.getX(cursor + 2) : cursor + 2;
      if (a >= attribute.count || b >= attribute.count || c >= attribute.count) continue;
      indices.push(vertexOffset + a, vertexOffset + b, vertexOffset + c);
      radiance.push(...triangleRadiance(material));
      surfaces.push(...triangleSurface(material));
    }
  }
}

function collectStaticLights(lights) {
  const packed = [];
  for (const light of lights ?? []) {
    if (!light?.isLight || light.visible === false || packed.length >= 8 * 16) continue;
    if (!light.isPointLight && !light.isSpotLight) continue;

    light.updateWorldMatrix?.(true, false);
    light.getWorldPosition(lightPosition);
    lightColor.copy(light.color ?? new THREE.Color(0xffffff));
    const range = Math.max(0.25, Number(light.distance) || 80);
    const intensity = Math.max(0, Number(light.intensity) || 0);

    let outerCos = -1;
    let innerCos = -1;
    let type = 0;
    lightDirection.set(0, -1, 0);
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

/**
 * Snapshots a deliberately static subset of the atrium into the native bridge.
 * Each indexed triangle receives one linear HDR RGBA radiance value, keeping
 * emitter strips/windows bright while giving ordinary hit surfaces a restrained
 * ambient response. Animated rain, vehicle, foliage and mobile are omitted.
 */
export function collectStaticReflectionScene(objects, lights = []) {
  const positions = [];
  const indices = [];
  const radiance = [];
  const surfaces = [];
  const visited = new Set();

  for (const object of objects) {
    if (!object || visited.has(object)) continue;
    object.updateWorldMatrix(true, true);
    object.traverse?.(child => {
      if (visited.has(child) || child.userData?.rtxIgnore || !isEffectivelyVisible(child)) return;
      visited.add(child);
      if (!child.isMesh && !child.isInstancedMesh) return;
      if (child.isSkinnedMesh || child.morphTargetInfluences) return;
      appendMesh(child, positions, indices, radiance, surfaces);
    });
  }

  if (indices.length === 0 || positions.length === 0) {
    throw new Error("The Midnight Glasshouse RTX scene contains no static triangles.");
  }
  if (indices.length % 3 !== 0 || radiance.length !== (indices.length / 3) * 4 ||
      surfaces.length !== (indices.length / 3) * 4) {
    throw new Error("Static reflection geometry, radiance and surface streams are misaligned.");
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleRadiance: new Float32Array(radiance),
    triangleSurface: new Float32Array(surfaces),
    lights: collectStaticLights(lights),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
