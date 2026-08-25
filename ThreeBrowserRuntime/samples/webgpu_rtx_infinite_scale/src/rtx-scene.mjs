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

function currentTimeMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function abortError() {
  const error = new Error("Static reflection scene collection was aborted.");
  error.name = "AbortError";
  return error;
}

function createCooperativeScheduler(options = {}) {
  const requestedBudget = Number(options.timeBudgetMs ?? 4);
  const timeBudgetMs = THREE.MathUtils.clamp(
    Number.isFinite(requestedBudget) ? requestedBudget : 4,
    0.25,
    16,
  );
  const shouldAbort = typeof options.shouldAbort === "function"
    ? options.shouldAbort
    : null;
  const abortSignal = options.signal;
  const customYield = typeof options.yieldToHost === "function"
    ? options.yieldToHost
    : null;
  let deadline = currentTimeMilliseconds() + timeBudgetMs;
  let operationsUntilClockCheck = 0;

  function throwIfAborted() {
    if (abortSignal?.aborted || shouldAbort?.()) throw abortError();
  }

  async function yieldToHost() {
    if (customYield) {
      await customYield();
      return;
    }

    await new Promise(resolve => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => resolve());
      } else {
        globalThis.setTimeout(resolve, 0);
      }
    });
  }

  return {
    throwIfAborted,
    checkpoint(operationCount = 1, forceClockCheck = false) {
      operationsUntilClockCheck += operationCount;
      if (!forceClockCheck && operationsUntilClockCheck < 128) return null;
      operationsUntilClockCheck = 0;
      throwIfAborted();
      if (currentTimeMilliseconds() < deadline) return null;
      return yieldToHost().then(() => {
        throwIfAborted();
        deadline = currentTimeMilliseconds() + timeBudgetMs;
      });
    },
  };
}

class ChunkedTypedWriter {
  constructor(ArrayType, chunkElementCount = 65_536) {
    this.ArrayType = ArrayType;
    this.chunkElementCount = chunkElementCount;
    this.chunks = [];
    this.currentChunk = null;
    this.currentLength = 0;
    this.length = 0;
  }

  push(value) {
    if (!this.currentChunk || this.currentLength === this.chunkElementCount) {
      this.currentChunk = new this.ArrayType(this.chunkElementCount);
      this.chunks.push(this.currentChunk);
      this.currentLength = 0;
    }
    this.currentChunk[this.currentLength++] = value;
    this.length++;
  }

  push3(a, b, c) {
    if (this.currentChunk && this.currentLength + 3 <= this.chunkElementCount) {
      const offset = this.currentLength;
      this.currentChunk[offset] = a;
      this.currentChunk[offset + 1] = b;
      this.currentChunk[offset + 2] = c;
      this.currentLength += 3;
      this.length += 3;
      return;
    }
    this.push(a);
    this.push(b);
    this.push(c);
  }

  push4(a, b, c, d) {
    if (this.currentChunk && this.currentLength + 4 <= this.chunkElementCount) {
      const offset = this.currentLength;
      this.currentChunk[offset] = a;
      this.currentChunk[offset + 1] = b;
      this.currentChunk[offset + 2] = c;
      this.currentChunk[offset + 3] = d;
      this.currentLength += 4;
      this.length += 4;
      return;
    }
    this.push(a);
    this.push(b);
    this.push(c);
    this.push(d);
  }

  async finish(scheduler) {
    const result = new this.ArrayType(this.length);
    let destinationOffset = 0;
    for (const chunk of this.chunks) {
      const elementCount = Math.min(chunk.length, this.length - destinationOffset);
      if (elementCount <= 0) break;
      result.set(
        elementCount === chunk.length ? chunk : chunk.subarray(0, elementCount),
        destinationOffset,
      );
      destinationOffset += elementCount;
      const pendingYield = scheduler.checkpoint(elementCount, true);
      if (pendingYield) await pendingYield;
    }
    // Drop the chunk references as each stream is consolidated so peak memory
    // stays near one extra typed stream instead of retaining every source copy.
    this.chunks.length = 0;
    this.currentChunk = null;
    this.currentLength = 0;
    return result;
  }
}

function createAsyncCollectionScratch() {
  return {
    instanceMatrix: new THREE.Matrix4(),
    worldMatrix: new THREE.Matrix4(),
    point: new THREE.Vector3(),
    baseColor: new THREE.Color(),
    emissiveColor: new THREE.Color(),
    defaultBaseColor: new THREE.Color(0x3b4246),
    defaultEmissiveColor: new THREE.Color(0x000000),
  };
}

function writeTriangleRadianceAsync(material, writer, scratch) {
  const explicit = material?.userData?.rtxTriangleRadiance;
  if (Array.isArray(explicit) && explicit.length >= 3) {
    writer.push4(
      Number(explicit[0]) || 0,
      Number(explicit[1]) || 0,
      Number(explicit[2]) || 0,
      Number(explicit[3] ?? 1) || 1,
    );
    return;
  }

  scratch.baseColor.copy(material?.color ?? scratch.defaultBaseColor);
  scratch.emissiveColor.copy(material?.emissive ?? scratch.defaultEmissiveColor);
  const metalness = THREE.MathUtils.clamp(Number(material?.metalness ?? 0), 0, 1);
  const emissiveIntensity = Math.max(0, Number(material?.emissiveIntensity ?? 1));
  const ambientResponse = 0.012 + metalness * 0.008;
  writer.push4(
    Math.min(32, scratch.baseColor.r * ambientResponse + scratch.emissiveColor.r * emissiveIntensity),
    Math.min(32, scratch.baseColor.g * ambientResponse + scratch.emissiveColor.g * emissiveIntensity),
    Math.min(32, scratch.baseColor.b * ambientResponse + scratch.emissiveColor.b * emissiveIntensity),
    1,
  );
}

function writeTriangleSurfaceAsync(material, writer, scratch) {
  scratch.baseColor.copy(material?.color ?? scratch.defaultBaseColor);
  const roughness = THREE.MathUtils.clamp(Number(material?.roughness ?? 0.7), 0.02, 1);
  writer.push4(
    Math.max(0, scratch.baseColor.r),
    Math.max(0, scratch.baseColor.g),
    Math.max(0, scratch.baseColor.b),
    roughness,
  );
}

async function appendMeshAsync(
  mesh,
  positions,
  indices,
  radiance,
  surfaces,
  scheduler,
  scratch,
) {
  const geometry = mesh.geometry;
  const attribute = geometry?.getAttribute?.("position");
  if (!attribute || attribute.itemSize < 3 || attribute.count < 3) return;

  const geometryIndex = geometry.getIndex();
  const indexCount = geometryIndex ? geometryIndex.count : attribute.count - (attribute.count % 3);
  const drawRange = drawableElementRange(geometry, indexCount);
  if (drawRange.end - drawRange.start < 3) return;
  const instanceCount = mesh.isInstancedMesh ? mesh.count : 1;

  for (let instance = 0; instance < instanceCount; ++instance) {
    scheduler.throwIfAborted();
    if (mesh.isInstancedMesh) {
      mesh.getMatrixAt(instance, scratch.instanceMatrix);
      scratch.worldMatrix.multiplyMatrices(mesh.matrixWorld, scratch.instanceMatrix);
    } else {
      scratch.worldMatrix.copy(mesh.matrixWorld);
    }

    const vertexOffset = positions.length / 3;
    for (let vertex = 0; vertex < attribute.count; ++vertex) {
      scratch.point.fromBufferAttribute(attribute, vertex).applyMatrix4(scratch.worldMatrix);
      positions.push3(scratch.point.x, scratch.point.y, scratch.point.z);
      const pendingYield = scheduler.checkpoint();
      if (pendingYield) await pendingYield;
    }

    for (let cursor = drawRange.start; cursor + 2 < drawRange.end; cursor += 3) {
      const material = materialForTriangle(mesh, geometry, cursor);
      if (usableMaterial(material)) {
        const a = geometryIndex ? geometryIndex.getX(cursor) : cursor;
        const b = geometryIndex ? geometryIndex.getX(cursor + 1) : cursor + 1;
        const c = geometryIndex ? geometryIndex.getX(cursor + 2) : cursor + 2;
        if (a < attribute.count && b < attribute.count && c < attribute.count) {
          indices.push3(vertexOffset + a, vertexOffset + b, vertexOffset + c);
          writeTriangleRadianceAsync(material, radiance, scratch);
          writeTriangleSurfaceAsync(material, surfaces, scratch);
        }
      }
      const pendingYield = scheduler.checkpoint(3);
      if (pendingYield) await pendingYield;
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
 * Snapshots the deliberately static infinite-descent architecture into the native
 * bridge. Camera-visible geometry and the off-camera color chambers share one
 * immutable TLAS so project-owned ray-query shaders can reveal spaces that a
 * screen-space technique cannot see.
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
    throw new Error("The Infinite Descent RTX scene contains no static triangles.");
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

/**
 * Cooperative counterpart to collectStaticReflectionScene(). It preserves the
 * same traversal order and typed-array result while periodically returning to
 * the host so animation, input and loading UI can continue to render.
 *
 * Options:
 *   timeBudgetMs  Work allowed between yields (default 4 ms, clamped 0.25..16).
 *   shouldAbort   Optional synchronous callback; returning true rejects with an
 *                 Error whose name is "AbortError".
 *   signal        Optional AbortSignal with the same rejection behavior.
 *   yieldToHost   Optional async callback for tests or a custom scheduler.
 *
 * The collected objects are expected to remain static until this promise
 * resolves, just as they must remain static after being submitted to the TLAS.
 */
export async function collectStaticReflectionSceneAsync(objects, lights = [], options = {}) {
  const positions = new ChunkedTypedWriter(Float32Array);
  const indices = new ChunkedTypedWriter(Uint32Array);
  const radiance = new ChunkedTypedWriter(Float32Array);
  const surfaces = new ChunkedTypedWriter(Float32Array);
  const visited = new Set();
  const scheduler = createCooperativeScheduler(options);
  // This state is collector-local because async traversal may overlap rendering
  // or another collection; unlike the synchronous path, it must survive yields.
  const scratch = createAsyncCollectionScratch();
  scheduler.throwIfAborted();

  for (const object of objects) {
    if (!object || visited.has(object)) continue;
    object.updateWorldMatrix(true, true);
    let pendingYield = scheduler.checkpoint(1, true);
    if (pendingYield) await pendingYield;
    // Object3D.traverse() is depth-first, parent-first. An explicit stack keeps
    // that exact order while giving us checkpoints between scene nodes.
    if (typeof object.traverse !== "function") continue;
    const stack = [object];
    while (stack.length > 0) {
      const child = stack.pop();
      const children = child?.children ?? [];
      for (let index = children.length - 1; index >= 0; --index) {
        stack.push(children[index]);
      }

      if (!visited.has(child) && !child.userData?.rtxIgnore && isEffectivelyVisible(child)) {
        visited.add(child);
        const isMesh = child.isMesh || child.isInstancedMesh;
        const isAnimatedGeometry = child.isSkinnedMesh || child.morphTargetInfluences;
        if (isMesh && !isAnimatedGeometry) {
          await appendMeshAsync(
            child,
            positions,
            indices,
            radiance,
            surfaces,
            scheduler,
            scratch,
          );
        }
      }

      pendingYield = scheduler.checkpoint();
      if (pendingYield) await pendingYield;
    }
  }

  if (indices.length === 0 || positions.length === 0) {
    throw new Error("The Infinite Descent RTX scene contains no static triangles.");
  }
  if (indices.length % 3 !== 0 || radiance.length !== (indices.length / 3) * 4 ||
      surfaces.length !== (indices.length / 3) * 4) {
    throw new Error("Static reflection geometry, radiance and surface streams are misaligned.");
  }

  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  const packedPositions = await positions.finish(scheduler);
  const packedIndices = await indices.finish(scheduler);
  const packedRadiance = await radiance.finish(scheduler);
  const packedSurfaces = await surfaces.finish(scheduler);
  scheduler.throwIfAborted();

  return {
    positions: packedPositions,
    indices: packedIndices,
    triangleRadiance: packedRadiance,
    triangleSurface: packedSurfaces,
    lights: collectStaticLights(lights),
    vertexCount,
    triangleCount,
  };
}
