import {
  FIBRE_COUNT,
  fibreModelConstants,
  seamDistance,
} from "./fibre-model.mjs";

export const FIBRE_RINGS = 12;
export const FIBRE_SIDES = 4;
export const VERTICES_PER_FIBRE = FIBRE_RINGS * FIBRE_SIDES;
export const TRIANGLES_PER_FIBRE = (FIBRE_RINGS - 1) * FIBRE_SIDES * 2;
export const RTX_PROXY_TRIANGLES_PER_FIBRE = (FIBRE_RINGS - 1) * 2;
export const DYNAMIC_VERTEX_COUNT = FIBRE_COUNT * VERTICES_PER_FIBRE;
export const DYNAMIC_TRIANGLE_COUNT = FIBRE_COUNT * TRIANGLES_PER_FIBRE;
export const RTX_PROXY_TRIANGLE_COUNT = FIBRE_COUNT * RTX_PROXY_TRIANGLES_PER_FIBRE;
export const POSITION_ATLAS_WIDTH = 1024;
export const POSITION_ATLAS_HEIGHT = Math.ceil(DYNAMIC_VERTEX_COUNT / POSITION_ATLAS_WIDTH);

const SIMULATION_UNIFORM_BYTES = 128;
const FRAME_UNIFORM_BYTES = 128;

function requireWebGpuGlobals() {
  const textureUsage = globalThis.GPUTextureUsage;
  const bufferUsage = globalThis.GPUBufferUsage;
  const shaderStage = globalThis.GPUShaderStage;
  if (!textureUsage || !bufferUsage || !shaderStage) {
    throw new Error("The native WebGPU constants are unavailable.");
  }
  return { textureUsage, bufferUsage, shaderStage };
}

async function loadShader(relativeUrl) {
  const url = new URL(relativeUrl, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url.pathname}`);
  return response.text();
}

function makeRasterIndices() {
  const indices = new Uint32Array(DYNAMIC_TRIANGLE_COUNT * 3);
  let cursor = 0;
  for (let fibre = 0; fibre < FIBRE_COUNT; ++fibre) {
    const base = fibre * VERTICES_PER_FIBRE;
    for (let ring = 0; ring < FIBRE_RINGS - 1; ++ring) {
      const current = base + ring * FIBRE_SIDES;
      const nextRing = current + FIBRE_SIDES;
      for (let side = 0; side < FIBRE_SIDES; ++side) {
        const nextSide = (side + 1) % FIBRE_SIDES;
        const a = current + side;
        const b = current + nextSide;
        const c = nextRing + nextSide;
        const d = nextRing + side;
        indices[cursor++] = a;
        indices[cursor++] = b;
        indices[cursor++] = c;
        indices[cursor++] = a;
        indices[cursor++] = c;
        indices[cursor++] = d;
      }
    }
  }
  return indices;
}

// Native dynamic-mesh creation serializes fixed topology through an 8 MiB
// command ring. A diameter ribbon per strand follows the exact same simulated
// tube vertices while keeping the one-time payload comfortably bounded. The
// dense four-sided tubes remain the visible raster geometry.
function makeRtxProxyIndices() {
  const indices = new Uint32Array(RTX_PROXY_TRIANGLE_COUNT * 3);
  let cursor = 0;
  for (let fibre = 0; fibre < FIBRE_COUNT; ++fibre) {
    const base = fibre * VERTICES_PER_FIBRE;
    for (let ring = 0; ring < FIBRE_RINGS - 1; ++ring) {
      const current = base + ring * FIBRE_SIDES;
      const next = current + FIBRE_SIDES;
      const a = current;
      const b = current + 2;
      const c = next + 2;
      const d = next;
      indices[cursor++] = a;
      indices[cursor++] = d;
      indices[cursor++] = c;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
    }
  }
  return indices;
}

function hashU32(value) {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  return (result ^ (result >>> 16)) >>> 0;
}

function random01(index, salt) {
  return (hashU32((index ^ salt) >>> 0) & 0x00ffffff) / 0x01000000;
}

function anchorForAppearance(index) {
  const globalCount = fibreModelConstants.globalFibreCount;
  if (index < globalCount) {
    const y = 1 - 2 * ((index + 0.5) / globalCount);
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const longitude = index * fibreModelConstants.goldenAngle;
    return [Math.cos(longitude) * radial, y, Math.sin(longitude) * radial];
  }
  const patchIndex = index - globalCount;
  const diskRadius = Math.sqrt(
    (patchIndex + 0.5) / fibreModelConstants.macroFibreCount,
  );
  const angularRadius = diskRadius * fibreModelConstants.macroPatchRadius;
  const angle = patchIndex * fibreModelConstants.goldenAngle +
    (random01(patchIndex, 0x39e2d175) - 0.5) * 0.032;
  const sine = Math.sin(angularRadius);
  return [
    Math.cos(angle) * sine,
    Math.sin(angle) * sine,
    Math.cos(angularRadius),
  ];
}

function makeAppearance() {
  const appearance = new Float32Array(FIBRE_COUNT * 4);
  let seamCount = 0;
  for (let index = 0; index < FIBRE_COUNT; ++index) {
    const [x, y, z] = anchorForAppearance(index);
    const longitude = Math.atan2(z, x);
    const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
    const isSeam = seamDistance(latitude, longitude) <= fibreModelConstants.seamHalfWidth;
    const tone = random01(index, 0xc761c23c);
    const fleck = random01(index, 0x4cf5ad43);
    const offset = index * 4;
    if (isSeam) {
      seamCount += 1;
      appearance[offset] = 0.42 + tone * 0.12;
      appearance[offset + 1] = 0.43 + tone * 0.11;
      appearance[offset + 2] = 0.31 + tone * 0.09;
      appearance[offset + 3] = 0.76 + fleck * 0.18;
    } else {
      if (fleck > 0.994) {
        appearance[offset] = 0.010 + tone * 0.012;
        appearance[offset + 1] = 0.016 + tone * 0.018;
        appearance[offset + 2] = 0.006;
        appearance[offset + 3] = 0.79;
      } else {
        appearance[offset] = 0.38 + tone * 0.15 + fleck * 0.018;
        appearance[offset + 1] = 0.66 + tone * 0.19;
        appearance[offset + 2] = 0.020 + tone * 0.040;
        appearance[offset + 3] = 0.68 + fleck * 0.20;
      }
    }
  }
  return { appearance, seamCount };
}

function writeSimulationUniform(device, buffer, {
  time = 0,
  delta = 0,
  gust = 0,
  ballRadius = 1.0015,
  wind = [0.34, 0.055, -0.16],
  brushNormal = [0, 0, 1],
  brushDirection = [1, 0, 0],
  brushStrength = 0,
  brushRadius = 0.23,
  ballScale = [1, 1, 1],
  ballOffset = [0, 0, 0],
  ballRotation = [0, 0, 0, 1],
  macroDetail = 0,
  frameIndex = 0,
} = {}) {
  const bytes = new ArrayBuffer(SIMULATION_UNIFORM_BYTES);
  const view = new DataView(bytes);
  view.setUint32(0, FIBRE_COUNT, true);
  view.setUint32(4, VERTICES_PER_FIBRE, true);
  view.setUint32(8, POSITION_ATLAS_WIDTH, true);
  view.setUint32(12, Math.max(0, Math.trunc(frameIndex)), true);
  view.setFloat32(16, Number(time) || 0, true);
  view.setFloat32(20, Math.max(0, Number(delta) || 0), true);
  view.setFloat32(24, Math.max(0, Number(gust) || 0), true);
  view.setFloat32(28, Number(ballRadius) || 1.0015, true);
  for (let axis = 0; axis < 3; ++axis) {
    view.setFloat32(32 + axis * 4, Number(wind?.[axis]) || 0, true);
    view.setFloat32(48 + axis * 4, Number(brushNormal?.[axis]) || 0, true);
    view.setFloat32(64 + axis * 4, Number(brushDirection?.[axis]) || 0, true);
  }
  view.setFloat32(44, Math.max(0, Math.min(1, Number(macroDetail) || 0)), true);
  view.setFloat32(60, Math.max(0, Number(brushStrength) || 0), true);
  view.setFloat32(76, Math.max(0.01, Number(brushRadius) || 0.23), true);
  for (let axis = 0; axis < 3; ++axis) {
    // DataView defaults to big-endian. GPU uniform memory is little-endian,
    // so omitting this flag collapses 1.0 into a denormal and visually tears
    // the simulated tubes away from the raster shell during deformation.
    view.setFloat32(80 + axis * 4, Number(ballScale?.[axis]) || 1, true);
    view.setFloat32(96 + axis * 4, Number(ballOffset?.[axis]) || 0, true);
  }
  view.setFloat32(92, 0, true);
  view.setFloat32(108, 0, true);
  for (let axis = 0; axis < 4; ++axis) {
    const component = Number(ballRotation?.[axis]);
    view.setFloat32(
      112 + axis * 4,
      Number.isFinite(component) ? component : (axis === 3 ? 1 : 0),
      true,
    );
  }
  device.queue.writeBuffer(buffer, 0, bytes);
}

function writeFrameUniform(device, buffer, {
  viewProjection,
  cameraPosition,
  lightDirection = [-0.46, 0.78, 0.42],
  lightIntensity = 1.42,
  lightColor = [1.0, 0.88, 0.72],
  environmentColor = [0.20, 0.25, 0.19],
  environmentIntensity = 0.52,
}) {
  const values = new Float32Array(FRAME_UNIFORM_BYTES / 4);
  values.set(viewProjection, 0);
  values.set([cameraPosition[0], cameraPosition[1], cameraPosition[2], 1], 16);
  values.set([lightDirection[0], lightDirection[1], lightDirection[2], lightIntensity], 20);
  values.set([lightColor[0], lightColor[1], lightColor[2], 1], 24);
  values.set([
    environmentColor[0],
    environmentColor[1],
    environmentColor[2],
    environmentIntensity,
  ], 28);
  device.queue.writeBuffer(buffer, 0, values);
}

function requireGpuTexture(texture, label) {
  if (!texture || typeof texture.createView !== "function") {
    throw new TypeError(`${label} must be a native GPUTexture.`);
  }
  return texture;
}

export async function createGpuFibreSystem({ device, rtx = null } = {}) {
  if (!device) throw new TypeError("createGpuFibreSystem requires a GPUDevice.");
  const { textureUsage, bufferUsage, shaderStage } = requireWebGpuGlobals();
  const [physicsSource, rasterSource] = await Promise.all([
    loadShader("../shaders/fibre_physics.wgsl"),
    loadShader("../shaders/fibre_raster.wgsl"),
  ]);

  const positionTexture = device.createTexture({
    label: "Tennis felt GPU positions shared by raster and RTX BLAS",
    size: {
      width: POSITION_ATLAS_WIDTH,
      height: POSITION_ATLAS_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: "rgba32float",
    mipLevelCount: 1,
    sampleCount: 1,
    usage: textureUsage.COPY_SRC | textureUsage.COPY_DST |
      textureUsage.TEXTURE_BINDING | textureUsage.STORAGE_BINDING,
  });
  const stateBuffer = device.createBuffer({
    label: "Tennis felt follicle spring state",
    size: FIBRE_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: bufferUsage.STORAGE | bufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(stateBuffer, 0, new Float32Array(FIBRE_COUNT * 4));
  const simulationUniform = device.createBuffer({
    label: "Tennis felt simulation parameters",
    size: SIMULATION_UNIFORM_BYTES,
    usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
  });
  const frameUniform = device.createBuffer({
    label: "Tennis felt raster frame parameters",
    size: FRAME_UNIFORM_BYTES,
    usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
  });
  const { appearance, seamCount } = makeAppearance();
  const appearanceBuffer = device.createBuffer({
    label: "Tennis felt per-fibre linear color and roughness",
    size: appearance.byteLength,
    usage: bufferUsage.STORAGE | bufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(appearanceBuffer, 0, appearance);
  const indices = makeRasterIndices();
  const rtxProxyIndices = makeRtxProxyIndices();
  const indexBuffer = device.createBuffer({
    label: "Tennis felt fixed tube topology",
    size: indices.byteLength,
    usage: bufferUsage.INDEX | bufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const computeLayout = device.createBindGroupLayout({
    label: "Tennis felt compute bindings",
    entries: [
      { binding: 0, visibility: shaderStage.COMPUTE, buffer: { type: "storage" } },
      {
        binding: 1,
        visibility: shaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "rgba32float" },
      },
      { binding: 2, visibility: shaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const computePipeline = device.createComputePipeline({
    label: "Tennis felt anchored spring and tube pack",
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
    compute: {
      module: device.createShaderModule({ label: "Tennis felt physics WGSL", code: physicsSource }),
      entryPoint: "main",
    },
  });
  const computeBindGroup = device.createBindGroup({
    label: "Tennis felt compute resources",
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: stateBuffer } },
      { binding: 1, resource: positionTexture.createView() },
      { binding: 2, resource: { buffer: simulationUniform } },
    ],
  });

  const rasterLayout = device.createBindGroupLayout({
    label: "Tennis felt raster bindings",
    entries: [
      {
        binding: 0,
        visibility: shaderStage.VERTEX,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      { binding: 1, visibility: shaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      {
        binding: 2,
        visibility: shaderStage.VERTEX | shaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const rasterModule = device.createShaderModule({
    label: "Tennis felt anisotropic raster WGSL",
    code: rasterSource,
  });
  const rasterPipeline = device.createRenderPipeline({
    label: "Tennis felt exact-position tube raster",
    layout: device.createPipelineLayout({ bindGroupLayouts: [rasterLayout] }),
    vertex: { module: rasterModule, entryPoint: "vertexMain" },
    fragment: {
      module: rasterModule,
      entryPoint: "fragmentMain",
      targets: [{
        format: "rgba16float",
        blend: {
          color: {
            operation: "add",
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
          },
          alpha: {
            operation: "add",
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
          },
        },
      }],
    },
    primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  const rasterBindGroup = device.createBindGroup({
    label: "Tennis felt raster resources",
    layout: rasterLayout,
    entries: [
      { binding: 0, resource: positionTexture.createView() },
      { binding: 1, resource: { buffer: appearanceBuffer } },
      { binding: 2, resource: { buffer: frameUniform } },
    ],
  });

  let dynamicMesh = null;
  let disposed = false;
  let simulationFrame = 0;
  let refitCount = 0;

  function recordSimulation(encoder, options = {}) {
    if (disposed) return false;
    writeSimulationUniform(device, simulationUniform, {
      ...options,
      frameIndex: options.frameIndex ?? simulationFrame,
    });
    const pass = encoder.beginComputePass({ label: "Tennis felt GPU spring physics" });
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(FIBRE_COUNT / 64), 1, 1);
    pass.end();
    simulationFrame = Math.max(simulationFrame + 1, Number(options.frameIndex ?? 0) + 1);
    return true;
  }

  // Populate every atlas texel before either rasterization or native AS build.
  const initializeEncoder = device.createCommandEncoder({
    label: "Tennis felt initial GPU position pack",
  });
  recordSimulation(initializeEncoder, { frameIndex: 0, delta: 0, time: 0 });
  device.queue.submit([initializeEncoder.finish()]);

  async function attachDynamicMesh() {
    if (dynamicMesh) return dynamicMesh;
    if (!rtx || typeof rtx.createDynamicTriangleMesh !== "function" ||
        typeof rtx.refitDynamicTriangleMesh !== "function") return null;
    const layout = rtx.vulkanImageLayouts?.general;
    if (!layout) throw new Error("The RTX bridge did not expose the general image layout.");
    const encoder = device.createCommandEncoder({
      label: "Tennis felt dynamic BLAS build",
    });
    const pendingMesh = rtx.createDynamicTriangleMesh({
      commandEncoder: encoder,
      positionsTexture: positionTexture,
      positionsVulkanLayout: layout,
      vertexCount: DYNAMIC_VERTEX_COUNT,
      indices: rtxProxyIndices,
      reflectionMaterial: {
        radiance: [0.006, 0.009, 0.0015, 1],
        surface: [0.31, 0.53, 0.025, 0.74],
      },
      label: "24,576 simulated tennis-felt fibre ribbon proxies",
    });
    if (!pendingMesh) throw new Error("The tennis-felt dynamic BLAS returned no handle.");
    device.queue.submit([encoder.finish()]);
    dynamicMesh = pendingMesh;
    return dynamicMesh;
  }

  function recordRaster(encoder, {
    colorTexture,
    depthTexture,
    viewProjection,
    cameraPosition,
    lightDirection,
    lightIntensity,
    lightColor,
    environmentColor,
    environmentIntensity,
  }) {
    if (disposed) return false;
    const color = requireGpuTexture(colorTexture, "Fibre color target");
    const depth = requireGpuTexture(depthTexture, "Fibre depth target");
    writeFrameUniform(device, frameUniform, {
      viewProjection,
      cameraPosition,
      lightDirection,
      lightIntensity,
      lightColor,
      environmentColor,
      environmentIntensity,
    });
    const pass = encoder.beginRenderPass({
      label: "Tennis felt exact-position raster pass",
      colorAttachments: [{
        view: color.createView(),
        loadOp: "load",
        storeOp: "store",
      }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(rasterPipeline);
    pass.setBindGroup(0, rasterBindGroup);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length, 1, 0, 0, 0);
    pass.end();
    return true;
  }

  function recordRefit(encoder) {
    if (!dynamicMesh || disposed) return false;
    const layout = rtx.vulkanImageLayouts?.shaderReadOnly;
    if (!layout) throw new Error("The RTX bridge did not expose the shader-read image layout.");
    const result = rtx.refitDynamicTriangleMesh({
      commandEncoder: encoder,
      mesh: dynamicMesh,
      positionsTexture: positionTexture,
      positionsVulkanLayout: layout,
      rebuild: false,
    });
    if (result?.queued === false) throw new Error(result.reason || "Fibre BLAS refit was rejected.");
    refitCount += 1;
    return true;
  }

  function destroyDynamicMesh() {
    if (!dynamicMesh) return;
    try {
      const encoder = device.createCommandEncoder({ label: "Tennis felt dynamic BLAS cleanup" });
      rtx?.destroyDynamicTriangleMesh?.({ mesh: dynamicMesh, commandEncoder: encoder });
      device.queue.submit([encoder.finish()]);
    } catch (error) {
      console.warn(`[RTX Tennis Felt] Dynamic BLAS cleanup failed: ${error?.message || error}`);
    }
    dynamicMesh = null;
  }

  function dispose() {
    if (disposed) return;
    destroyDynamicMesh();
    disposed = true;
    positionTexture.destroy();
    stateBuffer.destroy();
    simulationUniform.destroy();
    frameUniform.destroy();
    appearanceBuffer.destroy();
    indexBuffer.destroy();
  }

  return {
    positionTexture,
    recordSimulation,
    recordRaster,
    recordRefit,
    attachDynamicMesh,
    destroyDynamicMesh,
    dispose,
    get dynamicMesh() { return dynamicMesh; },
    get simulationFrame() { return simulationFrame; },
    get refitCount() { return refitCount; },
    stats: Object.freeze({
      fibreCount: FIBRE_COUNT,
      seamFibreCount: seamCount,
      vertexCount: DYNAMIC_VERTEX_COUNT,
      triangleCount: DYNAMIC_TRIANGLE_COUNT,
      rtxProxyTriangleCount: RTX_PROXY_TRIANGLE_COUNT,
      atlasWidth: POSITION_ATLAS_WIDTH,
      atlasHeight: POSITION_ATLAS_HEIGHT,
      verticesPerFibre: VERTICES_PER_FIBRE,
      trianglesPerFibre: TRIANGLES_PER_FIBRE,
    }),
  };
}
