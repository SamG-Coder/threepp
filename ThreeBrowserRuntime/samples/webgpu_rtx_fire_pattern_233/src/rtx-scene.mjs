import * as THREE from "three/webgpu";

const DEFAULT_TRIANGLE_BUDGET = 320_000;
const HARD_TRIANGLE_LIMIT = 1_000_000;
const DEFAULT_TIME_BUDGET_MS = 7;
const MAX_STATIC_LIGHTS = 8;

const instanceMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();
const pointA = new THREE.Vector3();
const pointB = new THREE.Vector3();
const pointC = new THREE.Vector3();
const edgeAB = new THREE.Vector3();
const edgeAC = new THREE.Vector3();
const materialColor = new THREE.Color();
const emissiveColor = new THREE.Color();
const instanceColor = new THREE.Color();
const lightColor = new THREE.Color();
const lightPosition = new THREE.Vector3();
const lightTarget = new THREE.Vector3();
const lightDirection = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.trunc(finite(value, fallback));
  return number > 0 ? number : fallback;
}

function rootsFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value.isObject3D && typeof value[Symbol.iterator] === "function") {
    return [...value].filter(Boolean);
  }
  return [value];
}

function visibleAndIncluded(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false || current.userData?.rtxIgnore) return false;
  }
  return true;
}

function animatedMesh(mesh) {
  return Boolean(
    mesh.isSkinnedMesh ||
    mesh.skeleton ||
    mesh.morphTargetInfluences ||
    mesh.geometry?.morphAttributes?.position?.length,
  );
}

function opaqueMaterial(material) {
  return Boolean(
    material &&
    material.visible !== false &&
    !material.userData?.rtxIgnore &&
    material.transparent !== true &&
    finite(material.opacity, 1) >= 0.995 &&
    finite(material.transmission, 0) <= 0.005,
  );
}

function drawableRange(geometry, elementCount) {
  const rawStart = finite(geometry?.drawRange?.start, 0);
  const rawCount = Number(geometry?.drawRange?.count ?? Infinity);
  const start = THREE.MathUtils.clamp(Math.trunc(rawStart), 0, elementCount);
  const count = Number.isFinite(rawCount)
    ? Math.max(0, Math.trunc(rawCount))
    : elementCount - start;
  return { start, end: Math.min(elementCount, start + count) };
}

function materialForElement(mesh, geometry, firstElement) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length <= 1 || geometry.groups.length === 0) return materials[0] ?? null;
  for (const group of geometry.groups) {
    if (firstElement >= group.start && firstElement < group.start + group.count) {
      return materials[group.materialIndex] ?? materials[0] ?? null;
    }
  }
  return materials[0] ?? null;
}

function vertexIndex(sourceIndex, cursor) {
  return sourceIndex ? sourceIndex.getX(cursor) : cursor;
}

function triangleColor(mesh, geometry, material, a, b, c, instance) {
  materialColor.copy(material?.color ?? new THREE.Color(0x3c454b));
  const colorAttribute = geometry.getAttribute?.("color");
  if (colorAttribute?.itemSize >= 3 && a < colorAttribute.count &&
      b < colorAttribute.count && c < colorAttribute.count) {
    materialColor.r *= (
      finite(colorAttribute.getX(a)) +
      finite(colorAttribute.getX(b)) +
      finite(colorAttribute.getX(c))
    ) / 3;
    materialColor.g *= (
      finite(colorAttribute.getY(a)) +
      finite(colorAttribute.getY(b)) +
      finite(colorAttribute.getY(c))
    ) / 3;
    materialColor.b *= (
      finite(colorAttribute.getZ(a)) +
      finite(colorAttribute.getZ(b)) +
      finite(colorAttribute.getZ(c))
    ) / 3;
  }
  if (mesh.isInstancedMesh && mesh.instanceColor && instance < mesh.instanceColor.count) {
    instanceColor.fromBufferAttribute(mesh.instanceColor, instance);
    materialColor.multiply(instanceColor);
  }
  return materialColor;
}

function appendSurface(stream, mesh, geometry, material, a, b, c, instance) {
  const explicit = material?.userData?.rtxTriangleSurface;
  if ((Array.isArray(explicit) || ArrayBuffer.isView(explicit)) && explicit.length >= 4) {
    stream.push(
      Math.max(0, finite(explicit[0])),
      Math.max(0, finite(explicit[1])),
      Math.max(0, finite(explicit[2])),
      THREE.MathUtils.clamp(finite(explicit[3], 0.72), 0.02, 1),
    );
    return;
  }
  const base = triangleColor(mesh, geometry, material, a, b, c, instance);
  stream.push(
    Math.max(0, finite(base.r)),
    Math.max(0, finite(base.g)),
    Math.max(0, finite(base.b)),
    THREE.MathUtils.clamp(finite(material?.roughness, 0.72), 0.02, 1),
  );
}

function appendRadiance(stream, mesh, geometry, material, a, b, c, instance) {
  const explicit = material?.userData?.rtxTriangleRadiance;
  if ((Array.isArray(explicit) || ArrayBuffer.isView(explicit)) && explicit.length >= 3) {
    stream.push(
      Math.min(64, Math.max(0, finite(explicit[0]))),
      Math.min(64, Math.max(0, finite(explicit[1]))),
      Math.min(64, Math.max(0, finite(explicit[2]))),
      Math.max(0, finite(explicit[3], 1)),
    );
    return;
  }
  const base = triangleColor(mesh, geometry, material, a, b, c, instance);
  emissiveColor.copy(material?.emissive ?? new THREE.Color(0));
  const emissiveIntensity = Math.max(0, finite(material?.emissiveIntensity, 1));
  const ambient = 0.006 + THREE.MathUtils.clamp(finite(material?.metalness), 0, 1) * 0.003;
  stream.push(
    Math.min(64, Math.max(0, base.r * ambient + emissiveColor.r * emissiveIntensity)),
    Math.min(64, Math.max(0, base.g * ambient + emissiveColor.g * emissiveIntensity)),
    Math.min(64, Math.max(0, base.b * ambient + emissiveColor.b * emissiveIntensity)),
    1,
  );
}

function scheduler(options) {
  const timeBudgetMs = Math.max(1, finite(options.timeBudgetMs, DEFAULT_TIME_BUDGET_MS));
  const yieldToHost = typeof options.yieldToHost === "function"
    ? options.yieldToHost
    : () => new Promise(resolve => setTimeout(resolve, 0));
  const signal = options.signal ?? null;
  let deadline = performance.now() + timeBudgetMs;
  let work = 0;

  function throwIfAborted() {
    if (signal?.aborted) throw signal.reason ?? new Error("Static RTX collection was aborted.");
  }

  return {
    throwIfAborted,
    async checkpoint(amount = 1) {
      work += amount;
      if (work < 768) return;
      work = 0;
      throwIfAborted();
      if (performance.now() < deadline) return;
      await yieldToHost();
      throwIfAborted();
      deadline = performance.now() + timeBudgetMs;
    },
  };
}

/** Pack at most eight immutable point/spot lights for the reflections ABI. */
export function packStaticRtxLights(lights = []) {
  const packed = [];
  for (const light of lights ?? []) {
    if (packed.length >= MAX_STATIC_LIGHTS * 16) break;
    if (!light?.isLight || light.visible === false ||
        (!light.isPointLight && !light.isSpotLight)) continue;

    light.updateWorldMatrix?.(true, false);
    light.getWorldPosition(lightPosition);
    lightColor.copy(light.color ?? new THREE.Color(0xffffff));
    lightDirection.set(0, -1, 0);
    const range = Math.max(0.25, finite(light.distance, 0) || 80);
    const intensity = Math.max(0, finite(light.intensity));
    let outerCos = -1;
    let innerCos = -1;
    let type = 0;
    if (light.isSpotLight) {
      light.target?.updateWorldMatrix?.(true, false);
      light.target?.getWorldPosition?.(lightTarget);
      lightDirection.copy(lightTarget).sub(lightPosition).normalize();
      const angle = THREE.MathUtils.clamp(finite(light.angle, Math.PI / 3), 0.01, Math.PI / 2);
      const penumbra = THREE.MathUtils.clamp(finite(light.penumbra), 0, 1);
      outerCos = Math.cos(angle);
      innerCos = Math.cos(angle * (1 - penumbra));
      type = 1;
    }
    packed.push(
      lightPosition.x, lightPosition.y, lightPosition.z, range,
      lightDirection.x, lightDirection.y, lightDirection.z, outerCos,
      lightColor.r, lightColor.g, lightColor.b, intensity,
      innerCos, type, Math.max(0, finite(light.decay, 2)), 0,
    );
  }
  return new Float32Array(packed);
}

/**
 * Cooperatively snapshots opaque, non-deforming geometry into the one native
 * static scene. Every accepted triangle is expanded to world-space vertices so
 * material filtering, instancing and per-triangle streams stay exactly aligned.
 */
export async function collectStaticRtxScene(objects, options = {}) {
  const maxTriangles = Math.min(
    positiveInteger(options.maxTriangles, DEFAULT_TRIANGLE_BUDGET),
    HARD_TRIANGLE_LIMIT,
  );
  const task = scheduler(options);
  const roots = rootsFrom(objects);
  const positions = [];
  const indices = [];
  const triangleRadiance = [];
  const triangleSurface = [];
  const visited = new Set();
  const skipped = {
    ignoredOrHidden: 0,
    animated: 0,
    unsupportedGeometry: 0,
    transparent: 0,
    nonFiniteOrDegenerate: 0,
  };
  let triangleCount = 0;
  let sourceMeshCount = 0;
  let sourceInstanceCount = 0;
  let truncated = false;

  task.throwIfAborted();
  for (const root of roots) root?.updateWorldMatrix?.(true, true);

  rootLoop:
  for (const root of roots) {
    if (!root || visited.has(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const object = stack.pop();
      if (!object || visited.has(object)) continue;
      visited.add(object);
      if (!visibleAndIncluded(object)) {
        skipped.ignoredOrHidden += 1;
        continue;
      }
      for (let index = object.children.length - 1; index >= 0; --index) {
        stack.push(object.children[index]);
      }
      if (!object.isMesh && !object.isInstancedMesh) {
        await task.checkpoint();
        continue;
      }
      if (animatedMesh(object)) {
        skipped.animated += 1;
        continue;
      }

      const geometry = object.geometry;
      const position = geometry?.getAttribute?.("position");
      if (!position || position.itemSize < 3 || position.count < 3) {
        skipped.unsupportedGeometry += 1;
        continue;
      }
      const sourceIndex = geometry.getIndex();
      const elementCount = sourceIndex ? sourceIndex.count : position.count - (position.count % 3);
      const range = drawableRange(geometry, elementCount);
      if (range.end - range.start < 3) {
        skipped.unsupportedGeometry += 1;
        continue;
      }

      const instanceCount = object.isInstancedMesh
        ? Math.max(0, Math.trunc(finite(object.count)))
        : 1;
      if (instanceCount === 0) continue;
      sourceMeshCount += 1;

      for (let instance = 0; instance < instanceCount; ++instance) {
        if (object.isInstancedMesh) {
          object.getMatrixAt(instance, instanceMatrix);
          worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        } else {
          worldMatrix.copy(object.matrixWorld);
        }
        let acceptedInstance = false;

        for (let cursor = range.start; cursor + 2 < range.end; cursor += 3) {
          if (triangleCount >= maxTriangles) {
            truncated = true;
            break rootLoop;
          }
          const material = materialForElement(object, geometry, cursor);
          if (!opaqueMaterial(material)) {
            skipped.transparent += 1;
            continue;
          }
          const a = vertexIndex(sourceIndex, cursor);
          const b = vertexIndex(sourceIndex, cursor + 1);
          const c = vertexIndex(sourceIndex, cursor + 2);
          if (a >= position.count || b >= position.count || c >= position.count) {
            skipped.unsupportedGeometry += 1;
            continue;
          }

          pointA.fromBufferAttribute(position, a).applyMatrix4(worldMatrix);
          pointB.fromBufferAttribute(position, b).applyMatrix4(worldMatrix);
          pointC.fromBufferAttribute(position, c).applyMatrix4(worldMatrix);
          const finiteTriangle = Number.isFinite(pointA.x + pointA.y + pointA.z) &&
            Number.isFinite(pointB.x + pointB.y + pointB.z) &&
            Number.isFinite(pointC.x + pointC.y + pointC.z);
          edgeAB.subVectors(pointB, pointA);
          edgeAC.subVectors(pointC, pointA);
          if (!finiteTriangle || edgeAB.cross(edgeAC).lengthSq() <= 1e-16) {
            skipped.nonFiniteOrDegenerate += 1;
            continue;
          }

          const vertexOffset = positions.length / 3;
          positions.push(
            pointA.x, pointA.y, pointA.z,
            pointB.x, pointB.y, pointB.z,
            pointC.x, pointC.y, pointC.z,
          );
          indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
          appendRadiance(triangleRadiance, object, geometry, material, a, b, c, instance);
          appendSurface(triangleSurface, object, geometry, material, a, b, c, instance);
          triangleCount += 1;
          acceptedInstance = true;
          await task.checkpoint(3);
        }
        if (acceptedInstance) sourceInstanceCount += 1;
      }
    }
  }

  if (triangleCount === 0) {
    throw new Error("Jelly Rave stage contains no opaque static RTX triangles.");
  }
  const lights = packStaticRtxLights(options.lights ?? []);
  const scene = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleRadiance: new Float32Array(triangleRadiance),
    triangleSurface: new Float32Array(triangleSurface),
    lights,
    vertexCount: positions.length / 3,
    triangleCount,
    lightCount: lights.length / 16,
    sourceMeshCount,
    sourceInstanceCount,
    maxTriangles,
    truncated,
    skipped: Object.freeze({ ...skipped }),
  };
  validateStaticRtxScene(scene);
  return scene;
}

export function validateStaticRtxScene(scene) {
  if (!(scene?.positions instanceof Float32Array) || scene.positions.length < 9 ||
      scene.positions.length % 3 !== 0) {
    throw new TypeError("staticScene.positions must be a non-empty Float32Array of xyz values.");
  }
  if (!(scene?.indices instanceof Uint32Array) || scene.indices.length < 3 ||
      scene.indices.length % 3 !== 0) {
    throw new TypeError("staticScene.indices must be a non-empty Uint32Array triangle list.");
  }
  const triangles = scene.indices.length / 3;
  if (!(scene.triangleRadiance instanceof Float32Array) ||
      scene.triangleRadiance.length !== triangles * 4) {
    throw new TypeError("staticScene.triangleRadiance must contain one vec4 per triangle.");
  }
  if (!(scene.triangleSurface instanceof Float32Array) ||
      scene.triangleSurface.length !== triangles * 4) {
    throw new TypeError("staticScene.triangleSurface must contain one vec4 per triangle.");
  }
  if (!(scene.lights instanceof Float32Array) || scene.lights.length % 16 !== 0 ||
      scene.lights.length > MAX_STATIC_LIGHTS * 16) {
    throw new TypeError("staticScene.lights must contain at most eight 4-vec4 records.");
  }
  const vertices = scene.positions.length / 3;
  for (let index = 0; index < scene.indices.length; ++index) {
    if (scene.indices[index] >= vertices) {
      throw new RangeError(`staticScene index ${index} is outside its vertex stream.`);
    }
  }
  return true;
}

export const collectStaticJellyRaveScene = collectStaticRtxScene;
