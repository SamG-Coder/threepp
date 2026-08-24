const MAX_STATIC_TRIANGLES = 2_400_000;
const MAX_INSTANCES_PER_MESH = 768;

const MARS_RTX_LIGHTING_GLSL = `#version 460
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
const uint kDirectionalSampleShift = 8u;
const uint kAoSampleShift = 16u;
const uint kSampleMask = 0xffu;

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

uint hash(uint value) {
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    value *= 0x846ca68bu;
    return value ^ (value >> 16u);
}

float random01(inout uint state) {
    state = hash(state);
    return float(state & 0x00ffffffu) / float(0x01000000u);
}

vec3 cosineHemisphere(vec3 normal, inout uint state) {
    float u1 = random01(state);
    float u2 = random01(state);
    float radius = sqrt(u1);
    float angle = 6.28318530718 * u2;
    vec3 tangent = normalize(abs(normal.y) < 0.98
        ? cross(normal, vec3(0.0, 1.0, 0.0))
        : cross(normal, vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(normal, tangent);
    return normalize(tangent * (radius * cos(angle)) +
                     bitangent * (radius * sin(angle)) +
                     normal * sqrt(max(0.0, 1.0 - u1)));
}

void main() {
    ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
    if (any(greaterThanEqual(pixel, ivec2(frame.extentFlags.xy)))) return;

    float depth = readDepth(pixel);
    if (isBackground(depth)) return;

    vec3 world = reconstructWorld(pixel, depth);
    vec3 worldLeft = reconstructWorld(pixel - ivec2(1, 0), readDepth(pixel - ivec2(1, 0)));
    vec3 worldRight = reconstructWorld(pixel + ivec2(1, 0), readDepth(pixel + ivec2(1, 0)));
    vec3 worldUp = reconstructWorld(pixel - ivec2(0, 1), readDepth(pixel - ivec2(0, 1)));
    vec3 worldDown = reconstructWorld(pixel + ivec2(0, 1), readDepth(pixel + ivec2(0, 1)));
    vec3 dxForward = worldRight - world;
    vec3 dxBackward = world - worldLeft;
    vec3 dyForward = worldDown - world;
    vec3 dyBackward = world - worldUp;
    vec3 dx = dot(dxForward, dxForward) < dot(dxBackward, dxBackward) ? dxForward : dxBackward;
    vec3 dy = dot(dyForward, dyForward) < dot(dyBackward, dyBackward) ? dyForward : dyBackward;
    vec3 normal = normalize(cross(dy, dx));
    vec3 toCamera = normalize(frame.cameraPositionMaximumDistance.xyz - world);
    if (any(isnan(normal)) || any(isinf(normal))) normal = vec3(0.0, 1.0, 0.0);
    if (dot(normal, toCamera) < 0.0) normal = -normal;

    vec3 lightDirection = normalize(frame.directionalLightDirectionAngularRadius.xyz);
    vec3 lightTangent = normalize(cross(
        abs(lightDirection.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0),
        lightDirection));
    vec3 lightBitangent = cross(lightDirection, lightTangent);
    float angularScale = tan(frame.directionalLightDirectionAngularRadius.w);
    // Keep the sampling pattern stable. Without a temporal denoiser, changing
    // it every frame reads as film grain and shimmer rather than convergence.
    uint state = uint(pixel.x) * 1973u ^ uint(pixel.y) * 9277u ^ 0x68bc21ebu;

    uint sunSamples = max(1u, (frame.extentFlags.z >> kDirectionalSampleShift) & kSampleMask);
    float sunVisibility = 0.0;
    float diskRotation = random01(state) * 6.28318530718;
    vec3 origin = world + normal * frame.lightingParameters.w;
    for (uint rayIndex = 0u; rayIndex < sunSamples; ++rayIndex) {
        float u = (float(rayIndex) + 0.5) / float(sunSamples);
        float angle = diskRotation + float(rayIndex) * 2.39996322973;
        vec2 disk = sqrt(u) * vec2(cos(angle), sin(angle));
        vec3 direction = normalize(lightDirection +
            (lightTangent * disk.x + lightBitangent * disk.y) * angularScale);
        sunVisibility += occluded(origin, direction, frame.cameraPositionMaximumDistance.w) ? 0.0 : 1.0;
    }
    sunVisibility /= float(sunSamples);

    uint aoSamples = max(1u, (frame.extentFlags.z >> kAoSampleShift) & kSampleMask);
    float aoVisibility = 0.0;
    for (uint rayIndex = 0u; rayIndex < aoSamples; ++rayIndex) {
        aoVisibility += occluded(origin, cosineHemisphere(normal, state), frame.lightingParameters.z) ? 0.0 : 1.0;
    }
    aoVisibility /= float(aoSamples);

    vec4 base = imageLoad(hdrColor, pixel);
    vec3 authoredPbr = max(base.rgb, vec3(0.0));
    float aoFactor = mix(1.0, aoVisibility, clamp(frame.lightingParameters.y, 0.0, 1.0));
    float nDotL = max(dot(normal, lightDirection), 0.0);

    // The authored PBR frame already contains indirect light and emissive
    // detail. Darken only the sun-facing component when a ray query finds an
    // occluder, while short-range AO supplies stable contact grounding.
    float directWeight = smoothstep(0.02, 0.48, nDotL);
    float rayShadow = 1.0 - (1.0 - sunVisibility) * directWeight * 0.52;
    float contact = mix(1.0, aoFactor, 0.55);
    vec3 lit = authoredPbr * rayShadow * contact;
    imageStore(hdrColor, pixel, vec4(lit, base.a));
}
`;

function multiplyMatrix4(a, b) {
  const result = new Float64Array(16);
  for (let column = 0; column < 4; ++column) {
    for (let row = 0; row < 4; ++row) {
      result[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return result;
}

function geometryStats(geometry) {
  const attribute = geometry?.attributes?.position;
  if (!attribute || attribute.itemSize < 3 || attribute.count < 3) return null;

  const index = geometry.index;
  const drawStart = Math.max(0, Math.trunc(geometry.drawRange?.start ?? 0));
  const available = index ? index.count : attribute.count;
  const requested = Number.isFinite(geometry.drawRange?.count) ? geometry.drawRange.count : available - drawStart;
  const elementCount = Math.max(0, Math.min(available - drawStart, Math.trunc(requested)));
  const triangleCount = Math.floor(elementCount / 3);
  return triangleCount ? {attribute, index, drawStart, triangleCount, vertexCount: attribute.count} : null;
}

function yieldToWindowPump() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function writeGeometry(positions, indices, item, vertexBase, indexBase) {
  const {attribute, index, drawStart, triangleCount, vertexCount} = item.stats;
  const elements = item.matrix;
  const sourcePositions = !attribute.isInterleavedBufferAttribute ? attribute.array : null;
  const positionStride = attribute.itemSize;
  for (let vertex = 0; vertex < vertexCount; ++vertex) {
    const source = vertex * positionStride;
    const x = sourcePositions ? sourcePositions[source] : attribute.getX(vertex);
    const y = sourcePositions ? sourcePositions[source + 1] : attribute.getY(vertex);
    const z = sourcePositions ? sourcePositions[source + 2] : attribute.getZ(vertex);
    const target = (vertexBase + vertex) * 3;
    positions[target] = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
    positions[target + 1] = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
    positions[target + 2] = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
    if (vertex > 0 && (vertex & 0xffff) === 0) await yieldToWindowPump();
  }

  const count = triangleCount * 3;
  const sourceIndices = index && !index.isInterleavedBufferAttribute ? index.array : null;
  for (let element = 0; element < count; ++element) {
    const source = drawStart + element;
    indices[indexBase + element] = vertexBase + (index ? (sourceIndices ? sourceIndices[source] : index.getX(source)) : source);
    if (element > 0 && (element & 0x1ffff) === 0) await yieldToWindowPump();
  }
}

function materialIsOpaque(object) {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some(material =>
    material && material.visible !== false && !material.transparent && Number(material.opacity ?? 1) >= 0.995);
}

function objectPathName(object) {
  const names = [];
  for (let current = object; current; current = current.parent) {
    if (current.name) names.push(current.name);
  }
  return names.join("/");
}

function casterPriority(name) {
  if (/(?:dome:gridshell|dome:connector|tower|truss|structure|support|frame|steel|metal|rail|bench|lamp|post|roof|wall|building|station)/i.test(name)) return 0;
  if (/(?:terrain|mountain|ground|soil|sand|rock|landscape)/i.test(name)) return 2;
  return 1;
}

async function buildStaticScene(scene) {
  scene.updateMatrixWorld(true);
  const candidates = [];
  const visit = typeof scene.traverseVisible === "function" ? scene.traverseVisible.bind(scene) : scene.traverse.bind(scene);

  visit(object => {
    if (!object?.isMesh || !object.geometry || !materialIsOpaque(object) || object.isSkinnedMesh) return;
    const name = objectPathName(object);
    if (/(?:sky|mist|particle|fountain|water|glass|rim-glow)/i.test(name)) return;
    const stats = geometryStats(object.geometry);
    const world = object.matrixWorld?.elements;
    if (!stats || !world) return;
    const instances = object.isInstancedMesh && typeof object.getMatrixAt === "function"
      ? Math.min(Math.max(0, object.count | 0), MAX_INSTANCES_PER_MESH)
      : 1;
    candidates.push({object, name, stats, world, instances, priority: casterPriority(name)});
  });

  candidates.sort((a, b) =>
    a.priority - b.priority ||
    a.stats.triangleCount * a.instances - b.stats.triangleCount * b.instances);

  const staticItems = [];
  const instanceGroups = [];
  const instanceUpdates = [];
  const includedMeshes = new Set();
  let triangles = 0;
  let effectiveTriangles = 0;
  let staticTriangles = 0;
  let staticVertices = 0;
  for (const candidate of candidates) {
    const {object, stats, world, priority} = candidate;
    const perObjectBudget = priority === 0 ? 400_000 : priority === 1 ? 180_000 : 80_000;
    let objectTriangles = 0;
    const localMatrix = object.isInstancedMesh ? object.matrixWorld.clone().identity() : null;
    for (let instance = 0; instance < candidate.instances; ++instance) {
      if (triangles + stats.triangleCount > MAX_STATIC_TRIANGLES) break;
      if (objectTriangles && objectTriangles + stats.triangleCount > perObjectBudget) break;
      let matrix = world;
      if (localMatrix) {
        object.getMatrixAt(instance, localMatrix);
        matrix = multiplyMatrix4(world, localMatrix.elements);
      }
      staticItems.push({stats, matrix: Array.from(matrix)});
      triangles += stats.triangleCount;
      effectiveTriangles += stats.triangleCount;
      staticTriangles += stats.triangleCount;
      staticVertices += stats.vertexCount;
      objectTriangles += stats.triangleCount;
      includedMeshes.add(object);
      if (instance > 0 && (instance & 127) === 0) await yieldToWindowPump();
    }
    if ((includedMeshes.size & 15) === 0) await yieldToWindowPump();
    if (triangles >= MAX_STATIC_TRIANGLES) break;
  }

  let positions;
  let indices;
  if (staticTriangles) {
    positions = new Float32Array(staticVertices * 3);
    indices = new Uint32Array(staticTriangles * 3);
    let vertexBase = 0;
    let indexBase = 0;
    for (const item of staticItems) {
      await writeGeometry(positions, indices, item, vertexBase, indexBase);
      vertexBase += item.stats.vertexCount;
      indexBase += item.stats.triangleCount * 3;
    }
  } else {
    positions = new Float32Array([-1, -1000, -1, 1, -1000, -1, 0, -1000, 1]);
    indices = new Uint32Array([0, 1, 2]);
  }

  return {
    positions,
    indices,
    instanceGroups,
    instanceUpdates,
    triangleCount: triangles,
    effectiveTriangleCount: effectiveTriangles,
    meshCount: includedMeshes.size,
  };
}

async function waitForScene(rtx, timeoutMs = 12000) {
  const deadline = performance.now() + timeoutMs;
  let status = rtx.getStatus?.() ?? rtx.status ?? null;
  while (performance.now() < deadline) {
    const feature = status?.features?.nativeRayTracing;
    if (feature?.active) return true;
    if (feature?.supported === false) return false;
    await new Promise(resolve => setTimeout(resolve, 10));
    status = rtx.getStatus?.() ?? rtx.status ?? status;
  }
  return false;
}

function textureResource(texture, layout, width, height) {
  return {texture, layout, vulkanLayout: layout, left: 0, top: 0, width, height};
}

export async function attachMarsRtxLighting({renderer, scene, camera, passNode, sunDirection}) {
  const rtx = globalThis.navigator?.gpu?.threeBrowserRTX;
  const device = renderer.backend?.device;
  if (!rtx?.capabilities?.nativeRayTracing || !device ||
      typeof rtx.registerStaticScene !== "function" ||
      typeof rtx.evaluateRayLighting !== "function") {
    return {active: false, reason: "native ray-query lighting is unavailable"};
  }

  const staticScene = await buildStaticScene(scene);
  const pipeline = rtx.compileRayQueryPipeline({
    profile: "lighting-v1",
    source: MARS_RTX_LIGHTING_GLSL,
    language: "glsl",
    stage: "compute",
    entryPoint: "main",
    label: "Mars RTX material lighting",
  });
  const registration = rtx.registerStaticScene({
    positions: staticScene.positions,
    indices: staticScene.indices,
    instanceGroups: staticScene.instanceGroups,
  });
  if (!registration?.queued || !await waitForScene(rtx)) {
    pipeline?.destroy?.();
    return {active: false, reason: "Mars BLAS/TLAS did not become ready"};
  }
  if (staticScene.instanceUpdates.length) {
    if (typeof rtx.updateInstanceGroup !== "function") {
      pipeline?.destroy?.();
      return {active: false, reason: "native RTX instance updates are unavailable"};
    }
    for (let index = 0; index < staticScene.instanceUpdates.length; ++index) {
      rtx.updateInstanceGroup(staticScene.instanceUpdates[index]);
      if ((index & 7) === 7) await yieldToWindowPump();
    }
  }

  let frameIndex = 0;
  let stopped = false;
  let lastError = "";
  const originalUpdateBefore = passNode.updateBefore.bind(passNode);
  passNode.updateBefore = frame => {
    originalUpdateBefore(frame);
    if (stopped) return;
    try {
      const target = passNode.renderTarget;
      const width = Math.max(1, target.width | 0);
      const height = Math.max(1, target.height | 0);
      const color = renderer.backend.get(target.texture)?.texture;
      const depth = renderer.backend.get(target.depthTexture)?.texture;
      if (!color || !depth) return;

      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const inverseViewProjection =
        camera.projectionMatrixInverse.clone().multiply(camera.matrixWorld).toArray();
      const elements = camera.matrixWorld.elements;
      const encoder = device.createCommandEncoder({label: "Mars RTX lighting"});
      const layouts = rtx.vulkanImageLayouts;
      const result = rtx.evaluateRayLighting({
        pipeline,
        commandEncoder: encoder,
        color: textureResource(color, layouts.colorAttachment, width, height),
        depth: textureResource(depth, layouts.depthStencilAttachment, width, height),
        width,
        height,
        inverseViewProjection,
        cameraPosition: [elements[12], elements[13], elements[14]],
        directionalLightDirection: sunDirection,
        directionalLightIntensity: 0.88,
        directionalAngularRadius: 0.0025,
        directionalSampleCount: 4,
        aoSampleCount: 8,
        maxDistance: 10000,
        rayBias: 0.003,
        frameIndex,
        shadowStrength: 1.0,
        aoStrength: 0.18,
        aoRadius: 0.85,
        depthInverted: false,
      });
      if (result?.queued === false) throw new Error(result.reason || "RTX dispatch was rejected");
      device.queue.submit([encoder.finish()]);
      frameIndex += 1;
    } catch (error) {
      stopped = true;
      lastError = error?.message || String(error);
      console.error("[Mars RTX] lighting stopped:", error);
    }
  };

  const state = {
    active: true,
    triangleCount: staticScene.triangleCount,
    effectiveTriangleCount: staticScene.effectiveTriangleCount,
    meshCount: staticScene.meshCount,
    get frameIndex() { return frameIndex; },
    get error() { return lastError; },
    dispose() {
      stopped = true;
      passNode.updateBefore = originalUpdateBefore;
      pipeline?.destroy?.();
      rtx.destroyStaticScene?.();
    },
  };
  globalThis.__marsRtxLighting = state;
  console.log(
    `[Mars RTX] active: ${staticScene.triangleCount.toLocaleString()} unique triangles · ` +
    `${staticScene.effectiveTriangleCount.toLocaleString()} instanced triangles · ` +
    `${staticScene.meshCount.toLocaleString()} meshes · ` +
    `${staticScene.instanceGroups.length.toLocaleString()} native instance groups`);
  return state;
}
