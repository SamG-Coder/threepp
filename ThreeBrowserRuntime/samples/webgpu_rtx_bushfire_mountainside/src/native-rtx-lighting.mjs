import * as THREE from "three/webgpu";

const DEFAULT_TRIANGLE_BUDGET = 1_200_000;
const HARD_TRIANGLE_LIMIT = 2_400_000;
const DEFAULT_COLLECTION_SLICE_MS = 3.5;
const DEFAULT_SCENE_TIMEOUT_MS = 12_000;
const MAX_FIRE_EMITTERS = 3;

// lighting-v1 deliberately supplies a fixed 128-byte push-constant ABI. This
// project pipeline reuses it for one point-like fire emitter per dispatch:
//
//   cameraPositionMaximumDistance.xyz = camera position
//   cameraPositionMaximumDistance.w   = camera-to-emitter distance
//   directionalLightDirection.xyz     = normalized camera-to-emitter vector
//   lightingParameters.x              = emitter intensity
//   lightingParameters.y              = emitter range
//
// The emitter position can therefore be reconstructed without adding a
// project-specific native API. Each invocation adds warm, inverse-square,
// ray-tested light to the already moon-lit HDR target.
const FIRE_RAY_LIGHTING_GLSL = `#version 460
#extension GL_EXT_ray_query : require

layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;
layout(set = 0, binding = 0) uniform accelerationStructureEXT topLevelScene;
layout(rgba16f, set = 0, binding = 1) uniform image2D hdrColor;
layout(set = 0, binding = 2) uniform sampler2D sceneDepth;

layout(push_constant) uniform FrameConstants {
    mat4 inverseViewProjection;
    vec4 cameraPositionMaximumDistance;
    vec4 directionalLightDirectionAngularRadius;
    vec4 lightingParameters;
    uvec4 extentFlags;
} frame;

const uint kDepthInverted = 1u;

float readDepth(ivec2 pixel) {
    pixel = clamp(pixel, ivec2(0), ivec2(frame.extentFlags.xy) - ivec2(1));
    return texelFetch(sceneDepth, pixel, 0).r;
}

bool isBackground(float depth) {
    return (frame.extentFlags.z & kDepthInverted) != 0u
        ? depth <= 1e-6
        : depth >= 0.999999;
}

vec3 reconstructWorld(ivec2 pixel, float depth) {
    pixel = clamp(pixel, ivec2(0), ivec2(frame.extentFlags.xy) - ivec2(1));
    vec2 uv = (vec2(pixel) + vec2(0.5)) / vec2(frame.extentFlags.xy);
    vec4 clip = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    vec4 world = frame.inverseViewProjection * clip;
    return world.xyz / max(abs(world.w), 1e-8);
}

bool occluded(vec3 origin, vec3 direction, float maximumDistance) {
    rayQueryEXT query;
    rayQueryInitializeEXT(query, topLevelScene,
        gl_RayFlagsOpaqueEXT | gl_RayFlagsTerminateOnFirstHitEXT,
        0xffu, origin, 0.0, direction, maximumDistance);
    while (rayQueryProceedEXT(query)) {}
    return rayQueryGetIntersectionTypeEXT(query, true) !=
           gl_RayQueryCommittedIntersectionNoneEXT;
}

void main() {
    ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
    if (any(greaterThanEqual(pixel, ivec2(frame.extentFlags.xy)))) return;

    float depth = readDepth(pixel);
    if (isBackground(depth)) return;

    vec3 world = reconstructWorld(pixel, depth);
    vec3 worldLeft = reconstructWorld(
        pixel - ivec2(1, 0), readDepth(pixel - ivec2(1, 0)));
    vec3 worldRight = reconstructWorld(
        pixel + ivec2(1, 0), readDepth(pixel + ivec2(1, 0)));
    vec3 worldUp = reconstructWorld(
        pixel - ivec2(0, 1), readDepth(pixel - ivec2(0, 1)));
    vec3 worldDown = reconstructWorld(
        pixel + ivec2(0, 1), readDepth(pixel + ivec2(0, 1)));
    vec3 dxForward = worldRight - world;
    vec3 dxBackward = world - worldLeft;
    vec3 dyForward = worldDown - world;
    vec3 dyBackward = world - worldUp;
    vec3 dx = dot(dxForward, dxForward) < dot(dxBackward, dxBackward)
        ? dxForward
        : dxBackward;
    vec3 dy = dot(dyForward, dyForward) < dot(dyBackward, dyBackward)
        ? dyForward
        : dyBackward;
    vec3 normal = normalize(cross(dy, dx));
    vec3 toCamera = normalize(frame.cameraPositionMaximumDistance.xyz - world);
    if (any(isnan(normal)) || any(isinf(normal))) normal = vec3(0.0, 1.0, 0.0);
    if (dot(normal, toCamera) < 0.0) normal = -normal;

    vec3 emitterDirection =
        normalize(frame.directionalLightDirectionAngularRadius.xyz);
    vec3 emitterPosition = frame.cameraPositionMaximumDistance.xyz +
        emitterDirection * frame.cameraPositionMaximumDistance.w;
    vec3 toEmitter = emitterPosition - world;
    float emitterDistance = length(toEmitter);
    float emitterRange = max(frame.lightingParameters.y, 1e-4);
    if (emitterDistance <= 1e-5 || emitterDistance >= emitterRange) return;

    vec3 lightDirection = toEmitter / emitterDistance;
    float nDotL = max(dot(normal, lightDirection), 0.0);
    if (nDotL <= 1e-5) return;

    float rayBias = frame.lightingParameters.w;
    vec3 origin = world + normal * rayBias;
    float traceDistance = max(emitterDistance - rayBias * 2.0, 1e-5);
    if (occluded(origin, lightDirection, traceDistance)) return;

    float rangeFalloff = max(1.0 - emitterDistance / emitterRange, 0.0);
    rangeFalloff *= rangeFalloff;
    float inverseSquare = 1.0 / max(emitterDistance * emitterDistance, 1.0);
    float radiance = max(frame.lightingParameters.x, 0.0) *
        rangeFalloff * inverseSquare * nDotL;
    vec3 warmFire = vec3(1.0, 0.22, 0.035);
    vec4 base = imageLoad(hdrColor, pixel);
    imageStore(hdrColor, pixel, vec4(base.rgb + warmFire * radiance, base.a));
}
`;

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function positiveInteger(value, fallback = 1) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return THREE.MathUtils.clamp(Number.isFinite(number) ? number : fallback, minimum, maximum);
}

function abortError() {
  const error = new Error("Static RTX triangle collection was aborted.");
  error.name = "AbortError";
  return error;
}

function createCooperativeScheduler(options = {}) {
  const timeBudgetMs = clampNumber(
    options.timeBudgetMs,
    0.25,
    16,
    DEFAULT_COLLECTION_SLICE_MS,
  );
  const customYield = typeof options.yieldToHost === "function"
    ? options.yieldToHost
    : null;
  const shouldAbort = typeof options.shouldAbort === "function"
    ? options.shouldAbort
    : null;
  const signal = options.signal ?? null;
  let operationsUntilClockCheck = 0;
  let deadline = nowMilliseconds() + timeBudgetMs;

  function throwIfAborted() {
    if (signal?.aborted || shouldAbort?.()) throw abortError();
  }

  function yieldToHost() {
    if (customYield) return Promise.resolve(customYield());
    return new Promise(resolve => {
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
      if (!forceClockCheck && operationsUntilClockCheck < 512) return null;
      operationsUntilClockCheck = 0;
      throwIfAborted();
      if (nowMilliseconds() < deadline) return null;
      return yieldToHost().then(() => {
        throwIfAborted();
        deadline = nowMilliseconds() + timeBudgetMs;
      });
    },
  };
}

function normalizedRoots(objects) {
  if (!objects) return [];
  if (Array.isArray(objects)) return objects.filter(Boolean);
  if (typeof objects[Symbol.iterator] === "function" && !objects.isObject3D) {
    return [...objects].filter(Boolean);
  }
  return [objects];
}

function ancestorsExcluded(object) {
  for (let current = object?.parent; current; current = current.parent) {
    if (current.visible === false || current.userData?.rtxIgnore) return true;
  }
  return false;
}

function drawableElementRange(geometry, elementCount) {
  const startValue = Number(geometry?.drawRange?.start ?? 0);
  const countValue = Number(geometry?.drawRange?.count ?? Infinity);
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

function isOpaqueRtxMaterial(material) {
  return Boolean(
    material &&
    material.visible !== false &&
    !material.userData?.rtxIgnore &&
    material.transparent !== true &&
    Number(material.opacity ?? 1) >= 0.995 &&
    Number(material.transmission ?? 0) <= 0.005,
  );
}

function isAnimatedMesh(mesh) {
  const morphPositions = mesh.geometry?.morphAttributes?.position;
  return Boolean(
    mesh.isSkinnedMesh ||
    mesh.skeleton ||
    mesh.morphTargetInfluences ||
    (Array.isArray(morphPositions) && morphPositions.length > 0),
  );
}

async function countOpaqueTriangles(mesh, geometry, range, scheduler) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length <= 1) {
    return isOpaqueRtxMaterial(materials[0])
      ? Math.floor((range.end - range.start) / 3)
      : 0;
  }

  let count = 0;
  for (let cursor = range.start; cursor + 2 < range.end; cursor += 3) {
    if (isOpaqueRtxMaterial(materialForElement(mesh, geometry, cursor))) count += 1;
    const pendingYield = scheduler.checkpoint(3);
    if (pendingYield) await pendingYield;
  }
  return count;
}

function readPosition(attribute, index, target) {
  target[0] = attribute.getX(index);
  target[1] = attribute.getY(index);
  target[2] = attribute.getZ(index);
}

function writeTransformedPosition(destination, offset, source, matrixElements) {
  const x = source[0];
  const y = source[1];
  const z = source[2];
  destination[offset] = matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z + matrixElements[12];
  destination[offset + 1] = matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z + matrixElements[13];
  destination[offset + 2] = matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z + matrixElements[14];
}

/**
 * Cooperatively snapshots opaque, non-animated Three.js meshes into one
 * bounded world-space triangle stream for the Runtime's static ray-query AS.
 *
 * `objects` may be one Object3D or an iterable of roots. A root should remain
 * unchanged until this promise resolves. Transparent effects, animated meshes,
 * invisible subtrees, and any object/material carrying `userData.rtxIgnore`
 * are excluded. Accepted triangles use unshared vertices deliberately: this
 * keeps material-group filtering exact and permits one allocation sized to the
 * enforced triangle budget.
 */
export async function collectStaticTriangleScene(objects, options = {}) {
  const scheduler = createCooperativeScheduler(options);
  const requestedBudget = positiveInteger(options.maxTriangles, DEFAULT_TRIANGLE_BUDGET);
  const maxTriangles = Math.min(requestedBudget, HARD_TRIANGLE_LIMIT);
  const roots = normalizedRoots(objects);
  const visited = new Set();
  const candidates = [];
  const skipped = {
    ignoredOrHidden: 0,
    animated: 0,
    unsupportedGeometry: 0,
    transparent: 0,
    nonFiniteTriangles: 0,
  };
  let triangleCount = 0;
  let sourceMeshCount = 0;
  let sourceInstanceCount = 0;
  let truncated = requestedBudget > HARD_TRIANGLE_LIMIT;

  scheduler.throwIfAborted();
  for (const root of roots) root?.updateWorldMatrix?.(true, true);

  rootLoop:
  for (const root of roots) {
    if (!root || visited.has(root)) continue;
    const stack = [{ object: root, excluded: ancestorsExcluded(root) }];
    while (stack.length > 0) {
      const entry = stack.pop();
      const object = entry.object;
      if (!object || visited.has(object)) continue;
      visited.add(object);

      const excluded = entry.excluded || object.visible === false || Boolean(object.userData?.rtxIgnore);
      if (!excluded) {
        const children = object.children ?? [];
        for (let index = children.length - 1; index >= 0; --index) {
          stack.push({ object: children[index], excluded: false });
        }
      } else {
        skipped.ignoredOrHidden += 1;
      }

      if (excluded || (!object.isMesh && !object.isInstancedMesh)) {
        const pendingYield = scheduler.checkpoint(1);
        if (pendingYield) await pendingYield;
        continue;
      }
      if (isAnimatedMesh(object)) {
        skipped.animated += 1;
        continue;
      }

      const geometry = object.geometry;
      const position = geometry?.getAttribute?.("position");
      if (!position || position.itemSize < 3 || position.count < 3) {
        skipped.unsupportedGeometry += 1;
        continue;
      }
      const geometryIndex = geometry.getIndex();
      const elementCount = geometryIndex
        ? geometryIndex.count
        : position.count - (position.count % 3);
      const range = drawableElementRange(geometry, elementCount);
      if (range.end - range.start < 3) {
        skipped.unsupportedGeometry += 1;
        continue;
      }

      const opaqueTrianglesPerInstance = await countOpaqueTriangles(
        object,
        geometry,
        range,
        scheduler,
      );
      if (opaqueTrianglesPerInstance <= 0) {
        skipped.transparent += 1;
        continue;
      }

      const instanceCount = object.isInstancedMesh
        ? Math.max(0, Math.trunc(Number(object.count) || 0))
        : 1;
      if (instanceCount <= 0) continue;
      const potentialTriangles = opaqueTrianglesPerInstance * instanceCount;
      const remainingBudget = maxTriangles - triangleCount;
      const acceptedTriangles = Math.min(remainingBudget, potentialTriangles);
      if (acceptedTriangles <= 0) {
        truncated = true;
        break rootLoop;
      }

      candidates.push({
        mesh: object,
        geometry,
        position,
        geometryIndex,
        range,
        opaqueTrianglesPerInstance,
        triangleQuota: acceptedTriangles,
        instanceCount,
      });
      triangleCount += acceptedTriangles;
      sourceMeshCount += 1;
      sourceInstanceCount += Math.min(
        instanceCount,
        Math.ceil(acceptedTriangles / opaqueTrianglesPerInstance),
      );
      if (acceptedTriangles < potentialTriangles) truncated = true;
      if (triangleCount >= maxTriangles) {
        // Conservatively report a full budget as truncated. Discovering that
        // it happened to be the scene's exact final triangle would require a
        // second unbounded traversal for no rendering benefit.
        truncated = true;
        break rootLoop;
      }

      const pendingYield = scheduler.checkpoint(1, true);
      if (pendingYield) await pendingYield;
    }
  }

  if (triangleCount <= 0) {
    throw new Error("Static RTX collection found no opaque triangles.");
  }

  const positions = new Float32Array(triangleCount * 9);
  const indices = new Uint32Array(triangleCount * 3);
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const sourcePoint = new Float64Array(3);
  let writtenTriangles = 0;

  for (const candidate of candidates) {
    let remainingCandidateTriangles = candidate.triangleQuota;
    const mesh = candidate.mesh;
    for (let instance = 0;
      instance < candidate.instanceCount && remainingCandidateTriangles > 0;
      ++instance) {
      scheduler.throwIfAborted();
      if (mesh.isInstancedMesh) {
        mesh.getMatrixAt(instance, instanceMatrix);
        worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      } else {
        worldMatrix.copy(mesh.matrixWorld);
      }
      const matrixElements = worldMatrix.elements;
      const instanceQuota = Math.min(
        candidate.opaqueTrianglesPerInstance,
        remainingCandidateTriangles,
      );
      let writtenForInstance = 0;

      for (let cursor = candidate.range.start;
        cursor + 2 < candidate.range.end && writtenForInstance < instanceQuota;
        cursor += 3) {
        if (!isOpaqueRtxMaterial(materialForElement(mesh, candidate.geometry, cursor))) {
          continue;
        }
        const a = candidate.geometryIndex ? candidate.geometryIndex.getX(cursor) : cursor;
        const b = candidate.geometryIndex ? candidate.geometryIndex.getX(cursor + 1) : cursor + 1;
        const c = candidate.geometryIndex ? candidate.geometryIndex.getX(cursor + 2) : cursor + 2;
        if (a >= candidate.position.count || b >= candidate.position.count || c >= candidate.position.count) {
          continue;
        }

        const positionOffset = writtenTriangles * 9;
        readPosition(candidate.position, a, sourcePoint);
        writeTransformedPosition(positions, positionOffset, sourcePoint, matrixElements);
        readPosition(candidate.position, b, sourcePoint);
        writeTransformedPosition(positions, positionOffset + 3, sourcePoint, matrixElements);
        readPosition(candidate.position, c, sourcePoint);
        writeTransformedPosition(positions, positionOffset + 6, sourcePoint, matrixElements);
        let finiteTriangle = true;
        for (let component = 0; component < 9; ++component) {
          if (!Number.isFinite(positions[positionOffset + component])) {
            finiteTriangle = false;
            break;
          }
        }
        if (!finiteTriangle) {
          skipped.nonFiniteTriangles += 1;
          continue;
        }
        const indexOffset = writtenTriangles * 3;
        const vertexOffset = writtenTriangles * 3;
        indices[indexOffset] = vertexOffset;
        indices[indexOffset + 1] = vertexOffset + 1;
        indices[indexOffset + 2] = vertexOffset + 2;
        writtenTriangles += 1;
        writtenForInstance += 1;

        const pendingYield = scheduler.checkpoint(3);
        if (pendingYield) await pendingYield;
      }
      remainingCandidateTriangles -= writtenForInstance;
    }
  }

  scheduler.throwIfAborted();
  if (writtenTriangles <= 0) {
    throw new Error("Static RTX geometry changed before its triangle snapshot could be written.");
  }
  if (writtenTriangles !== triangleCount) truncated = true;

  const usedPositions = writtenTriangles === triangleCount
    ? positions
    : positions.slice(0, writtenTriangles * 9);
  const usedIndices = writtenTriangles === triangleCount
    ? indices
    : indices.slice(0, writtenTriangles * 3);

  return {
    positions: usedPositions,
    indices: usedIndices,
    vertexCount: writtenTriangles * 3,
    triangleCount: writtenTriangles,
    sourceMeshCount,
    sourceInstanceCount,
    maxTriangles,
    requestedMaxTriangles: requestedBudget,
    truncated,
    skipped: Object.freeze({ ...skipped }),
  };
}

function makeTextureResource(texture, layout, width, height) {
  return {
    texture,
    layout,
    vulkanLayout: layout,
    left: 0,
    top: 0,
    width,
    height,
  };
}

function requireTextureUsage(texture, flag, label) {
  if ((Number(texture?.usage ?? 0) & flag) !== flag) {
    throw new Error(`${label} is missing GPUTextureUsage 0x${flag.toString(16)}.`);
  }
}

function validateStaticScene(staticScene) {
  if (!(staticScene?.positions instanceof Float32Array) || staticScene.positions.length < 9 ||
      staticScene.positions.length % 3 !== 0) {
    throw new TypeError("staticScene.positions must be a non-empty Float32Array of xyz values.");
  }
  if (!(staticScene?.indices instanceof Uint32Array) || staticScene.indices.length < 3 ||
      staticScene.indices.length % 3 !== 0) {
    throw new TypeError("staticScene.indices must be a non-empty Uint32Array triangle list.");
  }
  const vertexCount = staticScene.positions.length / 3;
  for (let index = 0; index < staticScene.indices.length; ++index) {
    if (staticScene.indices[index] >= vertexCount) {
      throw new RangeError(`staticScene index ${index} is outside its vertex stream.`);
    }
  }
}

function liveRtxStatus(rtx) {
  try {
    return rtx?.getStatus?.() ?? rtx?.status ?? null;
  } catch {
    return null;
  }
}

async function waitForStaticScene(rtx, timeoutMs) {
  const deadline = nowMilliseconds() + timeoutMs;
  let status = liveRtxStatus(rtx);
  while (nowMilliseconds() < deadline) {
    const feature = status?.features?.nativeRayTracing;
    if (feature?.active) return { ready: true, status, feature };
    if (feature?.supported === false) return { ready: false, status, feature };
    await new Promise(resolve => globalThis.setTimeout(resolve, 8));
    status = liveRtxStatus(rtx) ?? status;
  }
  return {
    ready: false,
    status,
    feature: status?.features?.nativeRayTracing ?? null,
  };
}

function normalizedDirection(value, fallback = [-0.34, 0.73, -0.59]) {
  let x;
  let y;
  let z;
  if (value?.isVector3) {
    x = Number(value.x);
    y = Number(value.y);
    z = Number(value.z);
  } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    x = Number(value[0]);
    y = Number(value[1]);
    z = Number(value[2]);
  }
  if (![x, y, z].every(Number.isFinite)) return [...fallback];
  const length = Math.hypot(x, y, z);
  return length > 1e-8 ? [x / length, y / length, z / length] : [...fallback];
}

function readEmitterPosition(emitter, target) {
  if (emitter?.isObject3D && typeof emitter.getWorldPosition === "function") {
    emitter.updateWorldMatrix?.(true, false);
    emitter.getWorldPosition(target);
  } else {
    const value = emitter?.worldPosition ?? emitter?.position ?? emitter;
    if (value?.isVector3 || (
      value &&
      Number.isFinite(Number(value.x)) &&
      Number.isFinite(Number(value.y)) &&
      Number.isFinite(Number(value.z))
    )) {
      target.set(Number(value.x), Number(value.y), Number(value.z));
    } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      target.set(Number(value[0]), Number(value[1]), Number(value[2]));
    } else {
      return false;
    }
  }
  return [target.x, target.y, target.z].every(Number.isFinite);
}

function prepareFireEmitters(fireEmitters, cameraPosition, rayBias, scratchPosition) {
  if (!fireEmitters) return [];
  const values = Array.isArray(fireEmitters)
    ? fireEmitters
    : typeof fireEmitters[Symbol.iterator] === "function"
      ? fireEmitters
      : [fireEmitters];
  const prepared = [];
  for (const emitter of values) {
    if (!emitter || emitter.visible === false || !readEmitterPosition(emitter, scratchPosition)) {
      continue;
    }
    const intensity = Number(emitter.intensity ?? emitter.userData?.rtxIntensity ?? 0);
    const range = Number(
      emitter.range ?? emitter.distance ?? emitter.userData?.rtxRange ?? 0,
    );
    if (!Number.isFinite(intensity) || intensity <= 0 ||
        !Number.isFinite(range) || range <= 0) continue;

    const dx = scratchPosition.x - cameraPosition.x;
    const dy = scratchPosition.y - cameraPosition.y;
    const dz = scratchPosition.z - cameraPosition.z;
    const cameraDistance = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(cameraDistance) || cameraDistance <= rayBias * 2) continue;

    prepared.push({
      direction: [dx / cameraDistance, dy / cameraDistance, dz / cameraDistance],
      cameraDistance,
      intensity: Math.min(intensity, 10_000),
      range: Math.min(range, 10_000),
    });
    if (prepared.length >= MAX_FIRE_EMITTERS) break;
  }
  return prepared;
}

/**
 * Minimal native ray-lighting compositor for ThreeBrowser Runtime.
 *
 * The source scene remains ordinary Three.js/WebGPU. This class records a
 * scene-linear FP16 color target and D32 depth, asks the generic Runtime bridge
 * to apply moon visibility plus contact RTAO in place, optionally adds up to
 * three shadow-tested fire emitters through a project lighting-v1 pipeline,
 * and presents that HDR texture with Three's ACES/output-color transform.
 * Custom-fire failure leaves the moon pass active. `render()` returns false
 * without presenting only when the required bridge path is unavailable or
 * stops, allowing an immediate ordinary full-resolution WebGPU render.
 */
export class NativeRtxLightingRenderer {
  constructor(
    renderer,
    camera,
    rtx = globalThis.navigator?.gpu?.threeBrowserRTX ?? null,
    options = {},
  ) {
    if (!renderer || !camera) {
      throw new TypeError("NativeRtxLightingRenderer requires a renderer and camera.");
    }
    this.renderer = renderer;
    this.camera = camera;
    this.rtx = rtx;
    this.device = renderer.backend?.device ?? null;
    this.options = {
      timeoutMs: Math.min(60_000, positiveInteger(options.timeoutMs, DEFAULT_SCENE_TIMEOUT_MS)),
      directionalLightIntensity: clampNumber(options.directionalLightIntensity, 0, 100, 1),
      directionalAngularRadius: clampNumber(options.directionalAngularRadius, 0, 0.2, 0.0047),
      directionalSampleCount: Math.min(16, positiveInteger(options.directionalSampleCount, 4)),
      aoSampleCount: Math.min(32, positiveInteger(options.aoSampleCount, 8)),
      maxDistance: clampNumber(options.maxDistance, 0.1, 100_000, 10_000),
      rayBias: clampNumber(options.rayBias, 0.00001, 1, 0.003),
      shadowStrength: clampNumber(options.shadowStrength, 0, 1, 0.62),
      aoStrength: clampNumber(options.aoStrength, 0, 1, 0.18),
      aoRadius: clampNumber(options.aoRadius, 0.01, 100, 1.25),
    };

    this.enabled = false;
    this.sceneRegistered = false;
    this.disposed = false;
    this.failure = "";
    this.width = 0;
    this.height = 0;
    this.frameIndex = 0;
    this.target = null;
    this._nativeColor = null;
    this._nativeDepth = null;
    this._registeredStats = null;
    this._firePipeline = null;
    this._firePipelineSupported = Boolean(
      (rtx?.capabilities?.rayQuery || rtx?.capabilities?.nativeRayTracing) &&
      typeof rtx?.compileRayQueryPipeline === "function",
    );
    this._firePipelineAttempted = false;
    this._firePipelineFailure = "";
    this._fireEvaluationCount = 0;
    this._lastFireEmitterCount = 0;

    this._displayScene = new THREE.Scene();
    this._displayScene.name = "Bushfire native moon-lighting presentation";
    this._displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._displayGeometry = new THREE.PlaneGeometry(2, 2);
    const uvs = this._displayGeometry.getAttribute("uv");
    for (let index = 0; index < uvs.count; ++index) uvs.setY(index, 1 - uvs.getY(index));
    uvs.needsUpdate = true;
    this._placeholderMaterial = new THREE.MeshBasicNodeMaterial({
      color: 0x000000,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this._placeholderMaterial.toneMapped = true;
    this._presentationMaterial = null;
    this._displayQuad = new THREE.Mesh(this._displayGeometry, this._placeholderMaterial);
    this._displayQuad.name = "ACES-presented native FP16 lighting";
    this._displayQuad.frustumCulled = false;
    this._displayScene.add(this._displayQuad);

    this._viewProjection = new THREE.Matrix4();
    this._inverseViewProjection = new THREE.Matrix4();
    this._cameraPosition = new THREE.Vector3();
    this._emitterPosition = new THREE.Vector3();
  }

  _destroyFirePipeline() {
    const pipeline = this._firePipeline;
    this._firePipeline = null;
    if (!pipeline) return;
    try {
      pipeline.destroy?.();
    } catch (error) {
      console.warn(`[Bushfire RTX] Fire-light pipeline release failed: ${error?.message || error}`);
    }
  }

  async _compileFirePipeline() {
    this._destroyFirePipeline();
    this._firePipelineAttempted = false;
    this._firePipelineFailure = "";
    this._firePipelineSupported = Boolean(
      (this.rtx?.capabilities?.rayQuery || this.rtx?.capabilities?.nativeRayTracing) &&
      typeof this.rtx?.compileRayQueryPipeline === "function",
    );
    if (!this._firePipelineSupported) {
      this._firePipelineFailure = "Custom lighting-v1 shader compilation is unavailable.";
      return false;
    }

    this._firePipelineAttempted = true;
    try {
      const pipeline = await this.rtx.compileRayQueryPipeline({
        profile: "lighting-v1",
        source: FIRE_RAY_LIGHTING_GLSL,
        language: "glsl",
        stage: "compute",
        entryPoint: "main",
        label: "Bushfire additive shadow-tested point lights",
      });
      if (!pipeline) throw new Error("The runtime returned no custom lighting pipeline.");
      if (this.disposed) {
        pipeline.destroy?.();
        return false;
      }
      this._firePipeline = pipeline;
      return true;
    } catch (error) {
      this._firePipelineFailure = `Fire-light shader unavailable: ${error?.message || error}`;
      console.warn(`[Bushfire RTX] ${this._firePipelineFailure}; moon/RTAO remains active.`);
      return false;
    }
  }

  _destroyRegisteredScene() {
    if (!this.sceneRegistered) return;
    try {
      this.rtx?.destroyStaticScene?.();
    } catch (error) {
      console.warn(`[Bushfire RTX] Static-scene release failed: ${error?.message || error}`);
    }
    this.sceneRegistered = false;
  }

  _disposeTarget() {
    if (this._presentationMaterial) {
      this._displayQuad.material = this._placeholderMaterial;
      this._presentationMaterial.dispose();
      this._presentationMaterial = null;
    }
    this.target?.dispose();
    this.target = null;
    this._nativeColor = null;
    this._nativeDepth = null;
  }

  _setPresentationTexture(texture) {
    if (this._presentationMaterial) this._presentationMaterial.dispose();
    const material = new THREE.MeshBasicNodeMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    material.toneMapped = true;
    this._presentationMaterial = material;
    this._displayQuad.material = material;
  }

  _createTarget(width, height) {
    this._disposeTarget();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = "Bushfire RTX moon-lighting depth";
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;

    const target = new THREE.RenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
      generateMipmaps: false,
    });
    target.texture.name = "Bushfire scene-linear RTX lighting";
    target.texture.format = THREE.RGBAFormat;
    target.texture.type = THREE.HalfFloatType;
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.isStorageTexture = true;
    target.texture.generateMipmaps = false;
    target.texture.mipmapsAutoUpdate = false;

    this.renderer.initRenderTarget(target);
    const nativeColor = this.renderer.backend?.get?.(target.texture)?.texture ?? null;
    const nativeDepth = this.renderer.backend?.get?.(target.depthTexture)?.texture ?? null;
    if (!nativeColor || !nativeDepth) {
      target.dispose();
      throw new Error("Three.js did not expose the FP16 color and D32 depth textures.");
    }
    requireTextureUsage(nativeColor, 0x04, "RTX lighting color sampling");
    requireTextureUsage(nativeColor, 0x08, "RTX lighting color storage");
    requireTextureUsage(nativeDepth, 0x04, "RTX lighting depth sampling");

    this.target = target;
    this._nativeColor = nativeColor;
    this._nativeDepth = nativeDepth;
    this.width = width;
    this.height = height;
    this._setPresentationTexture(target.texture);
  }

  async configure(width, height, staticScene) {
    if (this.disposed) return false;
    this.enabled = false;
    this.failure = "";
    this.frameIndex = 0;
    this._registeredStats = null;
    this._fireEvaluationCount = 0;
    this._lastFireEmitterCount = 0;
    this._firePipelineAttempted = false;
    this._firePipelineFailure = "";
    this._firePipelineSupported = Boolean(
      (this.rtx?.capabilities?.rayQuery || this.rtx?.capabilities?.nativeRayTracing) &&
      typeof this.rtx?.compileRayQueryPipeline === "function",
    );
    this.device = this.renderer.backend?.device ?? this.device;
    this._disposeTarget();
    this._destroyRegisteredScene();
    this._destroyFirePipeline();

    if (!this.device || !this.rtx?.capabilities?.nativeRayTracing ||
        typeof this.rtx.registerStaticScene !== "function" ||
        typeof this.rtx.evaluateRayLighting !== "function") {
      this.failure = "The native ray-query lighting bridge is unavailable.";
      return false;
    }

    try {
      validateStaticScene(staticScene);
      // A project fire shader is an optional enhancement. Compilation errors
      // are retained in fireLighting status and never reject moon/RTAO setup.
      await this._compileFirePipeline();
      if (this.disposed) return false;
      const registration = this.rtx.registerStaticScene({
        positions: staticScene.positions,
        indices: staticScene.indices,
      });
      if (!registration?.queued) {
        throw new Error(registration?.reason || "Static scene registration was rejected.");
      }
      this.sceneRegistered = true;
      const ready = await waitForStaticScene(this.rtx, this.options.timeoutMs);
      if (!ready.ready) {
        throw new Error(
          ready.feature?.reason || "The static BLAS/TLAS did not become ready before timeout.",
        );
      }

      this._createTarget(positiveInteger(width), positiveInteger(height));
      this._registeredStats = Object.freeze({
        vertexCount: Number(staticScene.vertexCount ?? staticScene.positions.length / 3),
        triangleCount: Number(staticScene.triangleCount ?? staticScene.indices.length / 3),
        sourceMeshCount: Number(staticScene.sourceMeshCount ?? 0),
        sourceInstanceCount: Number(staticScene.sourceInstanceCount ?? 0),
        truncated: Boolean(staticScene.truncated),
      });
      this.enabled = true;
      return true;
    } catch (error) {
      this.failure = `Native RTX lighting setup failed: ${error?.message || error}`;
      console.warn(`[Bushfire RTX] ${this.failure}`);
      this._disposeTarget();
      this._destroyRegisteredScene();
      this._destroyFirePipeline();
      return false;
    }
  }

  resize(width, height) {
    if (this.disposed || !this.enabled || !this.sceneRegistered) return false;
    const nextWidth = positiveInteger(width);
    const nextHeight = positiveInteger(height);
    if (nextWidth === this.width && nextHeight === this.height) return true;
    try {
      this._createTarget(nextWidth, nextHeight);
      this.frameIndex = 0;
      return true;
    } catch (error) {
      this.failure = `Native RTX lighting resize failed: ${error?.message || error}`;
      console.error(`[Bushfire RTX] ${this.failure}`);
      this.enabled = false;
      this._disposeTarget();
      this._destroyRegisteredScene();
      return false;
    }
  }

  _renderLinearScene(scene, camera) {
    const previousTarget = this.renderer.getRenderTarget?.() ?? null;
    const previousMrt = this.renderer.getMRT?.() ?? null;
    const previousToneMapping = this.renderer.toneMapping;
    const previousExposure = this.renderer.toneMappingExposure;
    try {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
      this.renderer.setMRT?.(null);
      this.renderer.setRenderTarget(this.target);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setMRT?.(previousMrt);
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.toneMappingExposure = previousExposure;
    }
  }

  _present() {
    const previousToneMapping = this.renderer.toneMapping;
    const previousColorSpace = this.renderer.outputColorSpace;
    const previousAutoClear = this.renderer.autoClear;
    try {
      this.renderer.setRenderTarget(null);
      this.renderer.setMRT?.(null);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.autoClear = true;
      this.renderer.render(this._displayScene, this._displayCamera);
    } finally {
      this.renderer.autoClear = previousAutoClear;
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.outputColorSpace = previousColorSpace;
    }
  }

  render(scene, camera = this.camera, { directionalLightDirection, fireEmitters } = {}) {
    if (this.disposed || !this.enabled || !this.sceneRegistered || !this.target ||
        !this._nativeColor || !this._nativeDepth) return false;
    try {
      this._renderLinearScene(scene, camera);

      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._inverseViewProjection.copy(this._viewProjection).invert();
      camera.getWorldPosition(this._cameraPosition);

      const layouts = this.rtx.vulkanImageLayouts;
      if (!layouts?.colorAttachment || !layouts?.depthStencilAttachment) {
        throw new Error("The RTX bridge did not expose non-zero Vulkan image layouts.");
      }
      const encoder = this.device.createCommandEncoder({
        label: "Bushfire ray-tested moon, RTAO, and fire lighting",
      });
      const colorResource = makeTextureResource(
        this._nativeColor,
        layouts.colorAttachment,
        this.width,
        this.height,
      );
      const depthResource = makeTextureResource(
        this._nativeDepth,
        layouts.depthStencilAttachment,
        this.width,
        this.height,
      );
      const result = this.rtx.evaluateRayLighting({
        commandEncoder: encoder,
        color: colorResource,
        depth: depthResource,
        width: this.width,
        height: this.height,
        inverseViewProjection: this._inverseViewProjection.toArray(),
        cameraPosition: this._cameraPosition,
        directionalLightDirection: normalizedDirection(directionalLightDirection),
        directionalLightIntensity: this.options.directionalLightIntensity,
        directionalAngularRadius: this.options.directionalAngularRadius,
        directionalSampleCount: this.options.directionalSampleCount,
        aoSampleCount: this.options.aoSampleCount,
        maxDistance: this.options.maxDistance,
        rayBias: this.options.rayBias,
        // There is no temporal denoiser in this focused lighting-only path.
        // A fixed spatial sequence avoids moon-shadow/AO shimmer while the
        // public frame counter below still records successful presentations.
        frameIndex: 0,
        shadowStrength: this.options.shadowStrength,
        aoStrength: this.options.aoStrength,
        aoRadius: this.options.aoRadius,
        depthInverted: false,
      });
      if (result?.queued === false) {
        throw new Error(result.reason || "Native ray-lighting evaluation was rejected.");
      }

      // Custom fire lighting is intentionally isolated from the required
      // moon/RTAO dispatch. All passes are recorded into this same encoder so
      // the HDR target is submitted once and reaches the swapchain once.
      this._lastFireEmitterCount = 0;
      let firePipelineFailed = false;
      if (this._firePipeline) {
        try {
          const emitters = prepareFireEmitters(
            fireEmitters,
            this._cameraPosition,
            this.options.rayBias,
            this._emitterPosition,
          );
          for (const emitter of emitters) {
            const fireResult = this.rtx.evaluateRayLighting({
              pipeline: this._firePipeline,
              commandEncoder: encoder,
              color: colorResource,
              depth: depthResource,
              width: this.width,
              height: this.height,
              inverseViewProjection: this._inverseViewProjection.toArray(),
              cameraPosition: this._cameraPosition,
              // The custom lighting-v1 shader reconstructs the point emitter
              // from this camera-relative direction and distance.
              directionalLightDirection: emitter.direction,
              directionalLightIntensity: emitter.intensity,
              directionalAngularRadius: 0,
              directionalSampleCount: 1,
              aoSampleCount: 1,
              maxDistance: emitter.cameraDistance,
              rayBias: this.options.rayBias,
              frameIndex: 0,
              // x = shadowStrength * directionalLightIntensity = intensity.
              shadowStrength: 1,
              // lighting-v1 places AO strength in y; the custom shader reads
              // that ABI slot as the fire emitter's finite influence range.
              aoStrength: emitter.range,
              aoRadius: 1,
              depthInverted: false,
            });
            if (fireResult?.queued === false) {
              throw new Error(fireResult.reason || "Fire-light evaluation was rejected.");
            }
            this._lastFireEmitterCount += 1;
            this._fireEvaluationCount += 1;
          }
        } catch (error) {
          firePipelineFailed = true;
          this._firePipelineFailure =
            `Fire-light evaluation disabled: ${error?.message || error}`;
          console.warn(`[Bushfire RTX] ${this._firePipelineFailure}; moon/RTAO remains active.`);
        }
      }

      this.device.queue.submit([encoder.finish()]);
      // A pipeline that failed after recording an earlier emitter must remain
      // alive until its command buffer has been submitted.
      if (firePipelineFailed) this._destroyFirePipeline();
      this._present();
      this.frameIndex += 1;
      return true;
    } catch (error) {
      this.failure = `Native RTX lighting stopped: ${error?.message || error}`;
      console.error(`[Bushfire RTX] ${this.failure}`);
      this.enabled = false;
      try {
        this.renderer.setRenderTarget(null);
        this.renderer.setMRT?.(null);
      } catch {
        // The caller's direct fallback still gets the first opportunity to
        // restore renderer state on the next ordinary WebGPU render.
      }
      this._disposeTarget();
      this._destroyRegisteredScene();
      this._destroyFirePipeline();
      return false;
    }
  }

  status() {
    const runtimeStatus = liveRtxStatus(this.rtx);
    const feature = runtimeStatus?.features?.nativeRayTracing ?? null;
    return {
      enabled: this.enabled,
      configured: this.enabled && this.sceneRegistered && Boolean(this.target),
      sceneRegistered: this.sceneRegistered,
      disposed: this.disposed,
      path: this.enabled ? "native-ray-lighting" : "webgpu-fallback",
      failure: this.failure,
      width: this.width,
      height: this.height,
      frameIndex: this.frameIndex,
      registered: this._registeredStats ? { ...this._registeredStats } : null,
      fireLighting: {
        supported: this._firePipelineSupported,
        compileAttempted: this._firePipelineAttempted,
        pipelineReady: Boolean(this._firePipeline),
        active: this.enabled && Boolean(this._firePipeline),
        lastEmitterCount: this._lastFireEmitterCount,
        evaluationCount: this._fireEvaluationCount,
        maxEmitters: MAX_FIRE_EMITTERS,
        failure: this._firePipelineFailure,
      },
      feature: feature ? {
        supported: Boolean(feature.supported),
        requested: Boolean(feature.requested),
        active: Boolean(feature.active),
        reason: String(feature.reason ?? ""),
        evaluationCount: Number(feature.evaluationCount ?? 0),
        failureCount: Number(feature.failureCount ?? 0),
      } : null,
    };
  }

  snapshot() {
    return this.status();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this._disposeTarget();
    this._destroyRegisteredScene();
    this._destroyFirePipeline();
    this._registeredStats = null;
    this.width = 0;
    this.height = 0;
    this._displayGeometry.dispose();
    this._placeholderMaterial.dispose();
    this._displayScene.clear();
  }
}
