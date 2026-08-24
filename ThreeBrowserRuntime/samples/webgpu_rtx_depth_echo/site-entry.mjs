// Clean-room ThreeBrowser Runtime sample. The relief estimator, temporal pack,
// choreography and visible UI are project-owned JavaScript/WGSL.
globalThis.__threeBrowserSourceURL =
  "https://webgpu-rtx-depth-echo.runtime.threebrowser.local/";

import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import {
  abs,
  float,
  length,
  max,
  min,
  positionLocal,
  pow,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import {
  RELIEF_HEIGHT,
  RELIEF_LABEL,
  RELIEF_WIDTH,
  createReliefEstimator,
} from "./src/relief-estimator.mjs";

export const LOOP_SECONDS = 12;
export const CURRENT_CELL_WIDTH = RELIEF_WIDTH - 1;
export const ECHO_GRID_WIDTH = 64;
export const ECHO_CELL_WIDTH = ECHO_GRID_WIDTH - 1;
export const ECHO_COUNT = 4;
export const CURRENT_VERTEX_COUNT = CURRENT_CELL_WIDTH * CURRENT_CELL_WIDTH * 4;
export const ECHO_VERTEX_COUNT = ECHO_CELL_WIDTH * ECHO_CELL_WIDTH * 4;
export const DYNAMIC_VERTEX_COUNT = CURRENT_VERTEX_COUNT + ECHO_COUNT * ECHO_VERTEX_COUNT;
export const DYNAMIC_TRIANGLE_COUNT =
  CURRENT_CELL_WIDTH * CURRENT_CELL_WIDTH * 2 +
  ECHO_COUNT * ECHO_CELL_WIDTH * ECHO_CELL_WIDTH * 2;
export const POSITION_ATLAS_WIDTH = 512;
export const POSITION_ATLAS_HEIGHT = 513;

const STAGED_LABEL = "STAGED PROCEDURAL RGBA / NO CAMERA";
const LIVE_LABEL = "LIVE CAMERA / UNMIRRORED";
const CONFIDENCE_THRESHOLD = 0.21;
const CAPTURE_TIMES = [4.15, 4.85, 5.55, 6.25];
const ECHO_TRANSFORMS = [
  { position: [-2.55, 0.05, -1.10], yaw: -0.34, scale: 0.86, tint: 0x32e7ff },
  { position: [-0.92, 0.22, -2.05], yaw: -0.13, scale: 0.80, tint: 0x9e5cff },
  { position: [0.98, 0.16, -2.95], yaw: 0.13, scale: 0.74, tint: 0xff3fb4 },
  { position: [2.62, -0.02, -3.75], yaw: 0.34, scale: 0.68, tint: 0xffb23f },
];

const POSITION_PACK_WGSL = /* wgsl */ `
struct PackParams {
  counts: vec4<u32>,
  shape: vec4<f32>,
};

@group(0) @binding(0) var reliefPositions: texture_2d<f32>;
@group(0) @binding(1) var packedPositions: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> params: PackParams;

fn cornerOffset(corner: u32) -> vec2<u32> {
  if (corner == 0u) { return vec2<u32>(0u, 0u); }
  if (corner == 1u) { return vec2<u32>(1u, 0u); }
  if (corner == 2u) { return vec2<u32>(1u, 1u); }
  return vec2<u32>(0u, 1u);
}

fn sourcePosition(pixel: vec2<u32>) -> vec4<f32> {
  return textureLoad(reliefPositions, vec2<i32>(pixel), 0);
}

fn confidenceForCell(pixel: vec2<u32>, stride: u32) -> f32 {
  let p00 = sourcePosition(pixel).w;
  let p10 = sourcePosition(pixel + vec2<u32>(stride, 0u)).w;
  let p11 = sourcePosition(pixel + vec2<u32>(stride, stride)).w;
  let p01 = sourcePosition(pixel + vec2<u32>(0u, stride)).w;
  return min(min(p00, p10), min(p11, p01));
}

fn echoPixel(pixel: vec2<u32>) -> vec2<u32> {
  return vec2<u32>(
    (pixel.x * 223u + 31u) / 63u,
    (pixel.y * 223u + 31u) / 63u
  );
}

fn echoConfidence(cellPixel: vec2<u32>) -> f32 {
  let p00 = sourcePosition(echoPixel(cellPixel)).w;
  let p10 = sourcePosition(echoPixel(cellPixel + vec2<u32>(1u, 0u))).w;
  let p11 = sourcePosition(echoPixel(cellPixel + vec2<u32>(1u, 1u))).w;
  let p01 = sourcePosition(echoPixel(cellPixel + vec2<u32>(0u, 1u))).w;
  return min(min(p00, p10), min(p11, p01));
}

fn echoTransform(slot: u32, point: vec3<f32>) -> vec3<f32> {
  var translation = vec3<f32>(-2.55, 0.05, -1.10);
  var yaw = -0.34;
  var scale = 0.86;
  if (slot == 1u) {
    translation = vec3<f32>(-0.92, 0.22, -2.05);
    yaw = -0.13;
    scale = 0.80;
  } else if (slot == 2u) {
    translation = vec3<f32>(0.98, 0.16, -2.95);
    yaw = 0.13;
    scale = 0.74;
  } else if (slot == 3u) {
    translation = vec3<f32>(2.62, -0.02, -3.75);
    yaw = 0.34;
    scale = 0.68;
  }
  let c = cos(yaw);
  let s = sin(yaw);
  let scaled = point * scale;
  return vec3<f32>(
    c * scaled.x + s * scaled.z,
    scaled.y,
    -s * scaled.x + c * scaled.z
  ) + translation;
}

fn writeVertex(vertexIndex: u32, point: vec3<f32>) {
  let texel = vec2<i32>(
    i32(vertexIndex % 512u),
    i32(vertexIndex / 512u)
  );
  textureStore(packedPositions, texel, vec4<f32>(point, 1.0));
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let vertexIndex = gid.x;
  let currentVertexCount = params.counts.x;
  let echoVertexCount = params.counts.y;
  let totalVertexCount = params.counts.z;
  let captureSlot = params.counts.w;
  if (vertexIndex >= totalVertexCount) { return; }

  if (vertexIndex < currentVertexCount) {
    let cellVertex = vertexIndex;
    let cell = cellVertex / 4u;
    let corner = cellVertex % 4u;
    let cellPixel = vec2<u32>(cell % 223u, cell / 223u);
    let samplePixel = cellPixel + cornerOffset(corner);
    let source = sourcePosition(samplePixel);
    let confidence = confidenceForCell(cellPixel, 1u);
    var point = source.xyz;
    point.z = -0.20 + (point.z + 0.20) * params.shape.x;
    if (confidence < params.shape.y) {
      let anchor = sourcePosition(cellPixel).xyz;
      point = vec3<f32>(anchor.xy, -0.20 + (anchor.z + 0.20) * params.shape.x);
    }
    writeVertex(vertexIndex, point);
    return;
  }

  let echoLocal = vertexIndex - currentVertexCount;
  let slot = echoLocal / echoVertexCount;
  if (params.shape.z < 0.5 || slot != captureSlot) { return; }
  let slotVertex = echoLocal % echoVertexCount;
  let cell = slotVertex / 4u;
  let corner = slotVertex % 4u;
  let cellPixel = vec2<u32>(cell % 63u, cell / 63u);
  let coarsePixel = cellPixel + cornerOffset(corner);
  let samplePixel = echoPixel(coarsePixel);
  let anchorPixel = echoPixel(cellPixel);
  let source = sourcePosition(samplePixel);
  let confidence = echoConfidence(cellPixel);
  var point = echoTransform(slot, source.xyz);
  if (confidence < params.shape.y) {
    point = echoTransform(slot, sourcePosition(anchorPixel).xyz);
  }
  writeVertex(vertexIndex, point);
}
`;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function smooth01(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function makeIndices() {
  const indices = new Uint32Array(DYNAMIC_TRIANGLE_COUNT * 3);
  let cursor = 0;
  for (let vertex = 0; vertex < DYNAMIC_VERTEX_COUNT; vertex += 4) {
    indices[cursor++] = vertex;
    indices[cursor++] = vertex + 1;
    indices[cursor++] = vertex + 2;
    indices[cursor++] = vertex;
    indices[cursor++] = vertex + 2;
    indices[cursor++] = vertex + 3;
  }
  return indices;
}

function writePackParams(device, buffer, captureSlot, captureEnabled, unfold) {
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  view.setUint32(0, CURRENT_VERTEX_COUNT, true);
  view.setUint32(4, ECHO_VERTEX_COUNT, true);
  view.setUint32(8, DYNAMIC_VERTEX_COUNT, true);
  view.setUint32(12, captureSlot < 0 ? 0xffffffff : captureSlot, true);
  view.setFloat32(16, unfold, true);
  view.setFloat32(20, CONFIDENCE_THRESHOLD, true);
  view.setFloat32(24, captureEnabled ? 1 : 0, true);
  view.setFloat32(28, 0, true);
  device.queue.writeBuffer(buffer, 0, bytes);
}

function clearPositionAtlas(device, texture) {
  const values = new Float32Array(POSITION_ATLAS_WIDTH * POSITION_ATLAS_HEIGHT * 4);
  for (let index = 0; index < values.length; index += 4) {
    values[index + 2] = -80;
    values[index + 3] = 1;
  }
  device.queue.writeTexture(
    { texture },
    values,
    { bytesPerRow: POSITION_ATLAS_WIDTH * 16, rowsPerImage: POSITION_ATLAS_HEIGHT },
    { width: POSITION_ATLAS_WIDTH, height: POSITION_ATLAS_HEIGHT, depthOrArrayLayers: 1 },
  );
}

function createPositionPacker(device, positionsTexture) {
  const textureUsage = globalThis.GPUTextureUsage;
  const bufferUsage = globalThis.GPUBufferUsage;
  const shaderStage = globalThis.GPUShaderStage;
  const packedTexture = device.createTexture({
    label: "Depth Echo current plus four temporal echoes",
    size: {
      width: POSITION_ATLAS_WIDTH,
      height: POSITION_ATLAS_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: "rgba32float",
    usage: textureUsage.COPY_SRC | textureUsage.COPY_DST | textureUsage.STORAGE_BINDING,
  });
  clearPositionAtlas(device, packedTexture);
  let vulkanLayout = "transferDestination";

  const bindGroupLayout = device.createBindGroupLayout({
    label: "Depth Echo pack bindings",
    entries: [
      { binding: 0, visibility: shaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      {
        binding: 1,
        visibility: shaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "rgba32float" },
      },
      { binding: 2, visibility: shaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: "Depth Echo fixed-topology quad pack",
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module: device.createShaderModule({ label: "Depth Echo pack WGSL", code: POSITION_PACK_WGSL }),
      entryPoint: "main",
    },
  });
  const paramsBuffer = device.createBuffer({
    label: "Depth Echo pack parameters",
    size: 32,
    usage: bufferUsage.COPY_DST | bufferUsage.UNIFORM,
  });
  const bindGroup = device.createBindGroup({
    label: "Depth Echo pack resources",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: positionsTexture.createView() },
      { binding: 1, resource: packedTexture.createView() },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });

  return {
    texture: packedTexture,
    get vulkanLayout() { return vulkanLayout; },
    record(commandEncoder, options) {
      writePackParams(
        device,
        paramsBuffer,
        Number(options.captureSlot ?? -1),
        Boolean(options.captureEnabled),
        Number(options.unfold ?? 1),
      );
      const pass = commandEncoder.beginComputePass({ label: "Depth Echo position pack" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(DYNAMIC_VERTEX_COUNT / 64), 1, 1);
      pass.end();
      vulkanLayout = "general";
    },
    clear() {
      clearPositionAtlas(device, packedTexture);
      vulkanLayout = "transferDestination";
    },
    dispose() {
      packedTexture.destroy();
      paramsBuffer.destroy();
    },
  };
}

function waitForRtx(rtx, timeoutMs = 5000) {
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      const status = rtx?.getStatus?.() ?? rtx?.status ?? null;
      const feature = status?.features?.nativeRayTracing;
      if (feature?.active) {
        resolve({ ready: true, status, reason: "" });
      } else if (feature?.supported === false || performance.now() - started > timeoutMs) {
        resolve({
          ready: false,
          status,
          reason: feature?.reason || "native ray tracing did not become active",
        });
      } else {
        setTimeout(poll, 12);
      }
    };
    poll();
  });
}

function collectStaticGeometry(meshes) {
  const positions = [];
  const indices = [];
  const point = new THREE.Vector3();
  let vertexOffset = 0;
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const attribute = mesh.geometry.getAttribute("position");
    for (let index = 0; index < attribute.count; ++index) {
      point.fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld);
      positions.push(point.x, point.y, point.z);
    }
    const geometryIndex = mesh.geometry.getIndex();
    if (geometryIndex) {
      for (let index = 0; index < geometryIndex.count; ++index) {
        indices.push(vertexOffset + geometryIndex.getX(index));
      }
    } else {
      for (let index = 0; index < attribute.count; ++index) {
        indices.push(vertexOffset + index);
      }
    }
    vertexOffset += attribute.count;
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function lumaNode(sample) {
  return sample.r.mul(0.2126).add(sample.g.mul(0.7152)).add(sample.b.mul(0.0722));
}

function createReliefMaterial(sourceTexture, unfoldNode, tintValue, echo = false) {
  const coords = uv();
  const texel = vec2(1 / RELIEF_WIDTH, 1 / RELIEF_HEIGHT);
  const centerSample = texture(sourceTexture, coords).level(float(0));
  const left = lumaNode(texture(sourceTexture, coords.sub(vec2(texel.x, 0))).level(float(0)));
  const right = lumaNode(texture(sourceTexture, coords.add(vec2(texel.x, 0))).level(float(0)));
  const top = lumaNode(texture(sourceTexture, coords.sub(vec2(0, texel.y))).level(float(0)));
  const bottom = lumaNode(texture(sourceTexture, coords.add(vec2(0, texel.y))).level(float(0)));
  const topLeft = lumaNode(texture(sourceTexture, coords.sub(texel)).level(float(0)));
  const topRight = lumaNode(texture(
    sourceTexture,
    coords.add(vec2(texel.x, texel.y.negate())),
  ).level(float(0)));
  const bottomLeft = lumaNode(texture(
    sourceTexture,
    coords.add(vec2(texel.x.negate(), texel.y)),
  ).level(float(0)));
  const bottomRight = lumaNode(texture(sourceTexture, coords.add(texel)).level(float(0)));
  const center = lumaNode(centerSample);
  const sobelX = topRight.add(right.mul(2)).add(bottomRight)
    .sub(topLeft.add(left.mul(2)).add(bottomLeft));
  const sobelY = bottomLeft.add(bottom.mul(2)).add(bottomRight)
    .sub(topLeft.add(top.mul(2)).add(topRight));
  const edge = length(vec2(sobelX, sobelY)).mul(0.34).clamp(0, 1);
  const localMean = left.add(right).add(top).add(bottom).mul(0.25);
  const contrast = abs(center.sub(localMean)).mul(4).clamp(0, 1);
  const maximumChannel = max(max(centerSample.r, centerSample.g), centerSample.b);
  const minimumChannel = min(min(centerSample.r, centerSample.g), centerSample.b);
  const saturation = maximumChannel.sub(minimumChannel);
  const centered = coords.sub(vec2(0.5)).mul(vec2(1, 0.82));
  const centerPrior = float(1).sub(smoothstep(0.22, 0.68, length(centered)));
  const pseudoDepth = float(0.10)
    .add(float(1).sub(center).mul(0.24))
    .add(saturation.mul(0.16))
    .add(contrast.mul(0.24))
    .add(edge.mul(0.36))
    .add(centerPrior.mul(0.25))
    .clamp(0, 1);
  const confidence = centerPrior.mul(0.52)
    .add(saturation.mul(0.18))
    .add(contrast.mul(0.18))
    .add(edge.mul(0.34))
    .clamp(0, 1);

  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    roughness: echo ? 0.58 : 0.72,
    metalness: echo ? 0.16 : 0.05,
    transparent: false,
    alphaTest: CONFIDENCE_THRESHOLD,
  });
  const tint = new THREE.Color(tintValue);
  // Keep the source texture untagged so vertex-stage relief math sees the same
  // encoded bytes as the compute estimator. Convert only the visible color to
  // an approximate linear working value.
  const visibleRgb = pow(centerSample.rgb.max(0), vec3(2.2));
  material.colorNode = visibleRgb.mul(vec3(tint.r, tint.g, tint.b));
  material.emissiveNode = visibleRgb
    .mul(vec3(tint.r, tint.g, tint.b))
    .mul(echo ? 0.38 : 0.10);
  material.opacityNode = confidence;
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    float(-0.20).add(pseudoDepth.mul(1.55).mul(unfoldNode)),
  );
  material.name = echo ? "Frozen heuristic relief echo" : "Current heuristic relief";
  return material;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const amount = clamp(((px - ax) * dx + (py - ay) * dy) / Math.max(0.0001, dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + dx * amount), py - (ay + dy * amount));
}

function fillStagedFrame(pixels, timeSeconds) {
  const width = RELIEF_WIDTH;
  const height = RELIEF_HEIGHT;
  const sway = Math.sin(timeSeconds * 1.7) * 0.08;
  const orbX = 0.56 * Math.sin(timeSeconds * 1.22);
  const orbY = -0.04 + 0.42 * Math.cos(timeSeconds * 1.22);
  const handX = sway + 0.30 * Math.sin(timeSeconds * 1.22);
  const handY = 0.19 + 0.19 * Math.cos(timeSeconds * 1.22);
  let cursor = 0;
  for (let y = 0; y < height; ++y) {
    const py = (y / (height - 1) - 0.5) * 2;
    for (let x = 0; x < width; ++x) {
      const px = (x / (width - 1) - 0.5) * 2;
      const vignette = clamp(1 - Math.hypot(px, py) * 0.66, 0, 1);
      const scan = 0.5 + 0.5 * Math.sin(y * 0.42 + timeSeconds * 3.2);
      let red = 3 + 5 * vignette + scan * 2;
      let green = 7 + 12 * vignette + scan * 3;
      let blue = 15 + 20 * vignette + scan * 6;

      const shoulder = Math.pow((px - sway) / 0.64, 2) + Math.pow((py - 0.67) / 0.56, 2);
      if (shoulder < 1) {
        const rim = clamp((1 - shoulder) * 1.8, 0, 1);
        red = 12 + rim * 20;
        green = 32 + rim * 52;
        blue = 58 + rim * 90;
      }
      const hood = Math.pow((px - sway) / 0.43, 2) + Math.pow((py + 0.19) / 0.55, 2);
      if (hood < 1) {
        const rim = smooth01((1 - hood) * 2.5);
        red = 17 + rim * 23;
        green = 39 + rim * 41;
        blue = 67 + rim * 56;
      }
      const face = Math.pow((px - sway) / 0.285, 2) + Math.pow((py + 0.20) / 0.39, 2);
      if (face < 1) {
        const faceLight = clamp(1 - face * 0.52, 0, 1);
        red = 138 + faceLight * 79;
        green = 67 + faceLight * 76;
        blue = 77 + faceLight * 82;
      }
      const eyeBand = Math.abs(py + 0.27) < 0.045;
      if (eyeBand && Math.abs(px - sway) < 0.22) {
        const eye = Math.min(Math.abs(px - sway - 0.105), Math.abs(px - sway + 0.105));
        if (eye < 0.040) {
          red = 30;
          green = 238;
          blue = 255;
        }
      }
      if (segmentDistance(px, py, sway + 0.18, 0.35, handX, handY) < 0.085) {
        red = 123;
        green = 45;
        blue = 174;
      }
      const hand = Math.hypot(px - handX, py - handY);
      if (hand < 0.12) {
        red = 238;
        green = 76;
        blue = 171;
      }
      const orb = Math.hypot(px - orbX, py - orbY);
      if (orb < 0.18) {
        const glow = clamp(1 - orb / 0.18, 0, 1);
        red = 255;
        green = 104 + glow * 151;
        blue = 34 + glow * 208;
      } else if (orb < 0.31) {
        const glow = clamp(1 - (orb - 0.18) / 0.13, 0, 1);
        red += 72 * glow;
        green += 23 * glow;
        blue += 58 * glow;
      }
      const ring = Math.abs(Math.hypot(px, py + 0.03) - (0.79 + Math.sin(timeSeconds) * 0.025));
      if (ring < 0.012) {
        red += 18;
        green += 74;
        blue += 96;
      }
      pixels[cursor++] = clamp(Math.round(red), 0, 255);
      pixels[cursor++] = clamp(Math.round(green), 0, 255);
      pixels[cursor++] = clamp(Math.round(blue), 0, 255);
      pixels[cursor++] = 255;
    }
  }
}

function resampleRgba(source, sourceWidth, sourceHeight, destination) {
  for (let y = 0; y < RELIEF_HEIGHT; ++y) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / RELIEF_HEIGHT));
    for (let x = 0; x < RELIEF_WIDTH; ++x) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / RELIEF_WIDTH));
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const to = (y * RELIEF_WIDTH + x) * 4;
      destination[to] = source[from];
      destination[to + 1] = source[from + 1];
      destination[to + 2] = source[from + 2];
      destination[to + 3] = 255;
    }
  }
}

function cameraFrame(video) {
  if (typeof video?.__threeBrowserExternalFrame === "function") {
    return video.__threeBrowserExternalFrame();
  }
  return null;
}

function makeHud() {
  const canvas = document.createElement("canvas");
  canvas.width = 760;
  canvas.height = 340;
  const context = canvas.getContext("2d");
  const canvasTexture = new THREE.CanvasTexture(canvas);
  canvasTexture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicNodeMaterial({
    map: canvasTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.20, 0.52), material);
  mesh.position.set(-0.38, 0.69, 0);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  let previousText = "";
  return {
    texture: canvasTexture,
    mesh,
    update(lines) {
      const serialized = lines.join("\\n");
      if (serialized === previousText) return;
      previousText = serialized;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(2, 7, 14, 0.84)";
      context.fillRect(0, 0, 735, 322);
      context.fillStyle = "rgba(56, 232, 255, 0.85)";
      context.fillRect(0, 0, 9, 322);
      context.strokeStyle = "rgba(255, 66, 178, 0.70)";
      context.lineWidth = 2;
      context.strokeRect(18, 18, 700, 287);
      for (let index = 0; index < lines.length; ++index) {
        context.font = index === 0 ? "700 42px monospace" : "600 20px monospace";
        context.fillStyle = index === 0
          ? "#f4fbff"
          : index === 1
            ? "#ff4db8"
            : index === 2
              ? "#42e9ff"
              : "#c4d4dc";
        context.fillText(lines[index], 36, 58 + index * 38);
      }
      canvasTexture.needsUpdate = true;
    },
    dispose() {
      canvasTexture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

function phaseFor(time) {
  if (time < 2) return "01 / RGB SOURCE";
  if (time < 4) return "02 / HEURISTIC RELIEF";
  if (time < 7) return "03 / FREEZE TEMPORAL ECHOES";
  if (time < 10) return "04 / RTX SHADOW TEST";
  return "05 / ECHO CASCADE";
}

async function main() {
  document.title = "RTX Depth Echo — ThreeBrowser Runtime";
  if (!WebGPU.isAvailable()) {
    throw new Error("RTX Depth Echo requires WebGPU.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#02050a";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  renderer.setPixelRatio(Math.min(1.5, Math.max(1, Number(globalThis.devicePixelRatio || 1))));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
    throw new Error("RTX Depth Echo did not receive a WebGPU backend.");
  }
  const device = renderer.backend.device;
  device.addEventListener?.("uncapturederror", event => {
    console.error("[RTX Depth Echo WebGPU]", event.error?.message || event.error || event);
  });

  const state = {
    sourceLabel: STAGED_LABEL,
    source: null,
    sourceTexture: null,
    video: null,
    stream: null,
    sequence: 1,
    cameraStarting: false,
    cameraError: "",
    captured: 0,
    captureDone: [false, false, false, false],
    raysEnabled: true,
    debug: false,
    rtxActive: false,
    rtxReason: "RTX initialization pending",
    refits: 0,
    evaluations: 0,
    frameError: "",
    loopStart: performance.now(),
    loopNumber: -1,
  };

  const stagedPixels = new Uint8ClampedArray(RELIEF_WIDTH * RELIEF_HEIGHT * 4);
  fillStagedFrame(stagedPixels, 0);
  const stagedSource = {
    width: RELIEF_WIDTH,
    height: RELIEF_HEIGHT,
    data: stagedPixels,
    sequence: state.sequence,
  };
  state.source = stagedSource;
  state.sourceTexture = new THREE.DataTexture(
    stagedPixels,
    RELIEF_WIDTH,
    RELIEF_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  state.sourceTexture.colorSpace = THREE.NoColorSpace;
  state.sourceTexture.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050a);
  scene.fog = new THREE.FogExp2(0x07101a, 0.032);

  const camera = new THREE.PerspectiveCamera(44, innerWidth / Math.max(1, innerHeight), 0.04, 60);
  camera.position.set(0, 1.1, 11.8);
  camera.lookAt(0, 0, -1);

  const hemi = new THREE.HemisphereLight(0x84dfff, 0x180c24, 0.48);
  scene.add(hemi);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(-6, 9, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -10;
  keyLight.shadow.camera.right = 10;
  keyLight.shadow.camera.top = 8;
  keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 30;
  scene.add(keyLight);

  const probeLight = new THREE.PointLight(0xff3dac, 18, 9, 1.5);
  const probeOrb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.11, 2),
    new THREE.MeshBasicNodeMaterial({ color: 0xff73c8 }),
  );
  probeLight.add(probeOrb);
  scene.add(probeLight);

  const matte = new THREE.MeshStandardNodeMaterial({
    color: 0x111a22,
    roughness: 0.91,
    metalness: 0.04,
  });
  const accent = new THREE.MeshStandardNodeMaterial({
    color: 0x243245,
    roughness: 0.68,
    metalness: 0.32,
  });
  const staticMeshes = [];
  function addStatic(geometry, material, position, rotation = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    staticMeshes.push(mesh);
    return mesh;
  }
  addStatic(new THREE.BoxGeometry(18, 0.28, 18), matte, [0, -3.48, -1.2]);
  addStatic(new THREE.BoxGeometry(18, 10, 0.28), matte, [0, 1.2, -7.7]);
  addStatic(new THREE.BoxGeometry(0.28, 9, 15), matte, [-8.7, 0.8, -1.5]);
  addStatic(new THREE.BoxGeometry(0.28, 9, 15), matte, [8.7, 0.8, -1.5]);
  for (let index = 0; index < 7; ++index) {
    addStatic(
      new THREE.BoxGeometry(0.16, 5.8, 0.9),
      accent,
      [-6 + index * 2, -0.42, -6.85],
      [0, 0, (index % 2 ? -1 : 1) * 0.045],
    );
  }
  const grid = new THREE.GridHelper(17, 32, 0x1cd8ee, 0x132f3a);
  grid.position.y = -3.32;
  grid.position.z = -1.2;
  grid.material.transparent = true;
  grid.material.opacity = 0.32;
  scene.add(grid);

  const unfoldNode = uniform(0.04);
  const currentGeometry = new THREE.PlaneGeometry(6.4, 6.4, 112, 112);
  const currentMaterial = createReliefMaterial(state.sourceTexture, unfoldNode, 0xffffff, false);
  const currentMesh = new THREE.Mesh(currentGeometry, currentMaterial);
  currentMesh.name = "Current non-neural heuristic relief";
  currentMesh.castShadow = true;
  currentMesh.receiveShadow = true;
  scene.add(currentMesh);

  const echoMeshes = [];
  const echoTextures = [];
  for (let index = 0; index < ECHO_COUNT; ++index) {
    const pixels = new Uint8ClampedArray(stagedPixels.length);
    const echoTexture = new THREE.DataTexture(
      pixels,
      RELIEF_WIDTH,
      RELIEF_HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    echoTexture.colorSpace = THREE.NoColorSpace;
    echoTexture.needsUpdate = true;
    const echoMaterial = createReliefMaterial(
      echoTexture,
      uniform(1),
      ECHO_TRANSFORMS[index].tint,
      true,
    );
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 6.4, ECHO_CELL_WIDTH, ECHO_CELL_WIDTH),
      echoMaterial,
    );
    const transform = ECHO_TRANSFORMS[index];
    mesh.position.set(...transform.position);
    mesh.rotation.y = transform.yaw;
    mesh.scale.setScalar(transform.scale);
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    echoMeshes.push(mesh);
    echoTextures.push(echoTexture);
  }

  const displayScene = new THREE.Scene();
  const displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const displayMaterial = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  displayMaterial.toneMapped = true;
  const displayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial);
  displayQuad.frustumCulled = false;
  displayScene.add(displayQuad);
  const hud = makeHud();
  displayScene.add(hud.mesh);

  let renderTarget = null;
  let targetWidth = 1;
  let targetHeight = 1;
  function resizeTarget() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const scale = Math.min(
      Math.max(1, Number(globalThis.devicePixelRatio || 1)),
      Math.sqrt(1_350_000 / Math.max(1, width * height)),
    );
    targetWidth = Math.max(1, Math.round(width * scale));
    targetHeight = Math.max(1, Math.round(height * scale));
    renderTarget?.dispose();
    const depthTexture = new THREE.DepthTexture(targetWidth, targetHeight, THREE.FloatType);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.FloatType;
    renderTarget = new THREE.RenderTarget(targetWidth, targetHeight, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
      generateMipmaps: false,
    });
    renderTarget.texture.name = "Depth Echo linear HDR";
    renderTarget.texture.isStorageTexture = true;
    renderTarget.texture.generateMipmaps = false;
    renderer.initRenderTarget(renderTarget);
    displayMaterial.map = renderTarget.texture;
    displayMaterial.needsUpdate = true;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  resizeTarget();
  globalThis.addEventListener("resize", resizeTarget);

  // Disable estimator history so the visible TSL relief and the RTX geometry
  // evaluate the same current-frame formula. Frozen echoes supply the temporal
  // dimension explicitly instead of hiding lag in the pseudo-depth provider.
  const estimator = createReliefEstimator({ device, historyBlend: 0 });
  await estimator.init();
  const firstRelief = await estimator.update({ source: state.source, time: 0, force: true });
  console.log(
    "[RTX Depth Echo] " + firstRelief.label +
    " · " + firstRelief.width + "x" + firstRelief.height +
    " · staged fallback active",
  );

  const positionPacker = createPositionPacker(device, firstRelief.positionsTexture);
  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const forceRaster = globalThis.__threeBrowserDepthEchoForceRaster === true ||
    new URLSearchParams(globalThis.location?.search || "").get("raster") === "1";
  let dynamicMesh = null;
  let staticSceneRegistered = false;
  if (
    !forceRaster &&
    rtx?.capabilities?.nativeRayTracing &&
    typeof rtx.registerStaticScene === "function" &&
    typeof rtx.createDynamicTriangleMesh === "function" &&
    typeof rtx.refitDynamicTriangleMesh === "function" &&
    typeof rtx.evaluateRayLighting === "function"
  ) {
    try {
      const staticGeometry = collectStaticGeometry(staticMeshes);
      const registration = rtx.registerStaticScene(staticGeometry);
      if (!registration?.queued) throw new Error("static scene registration was rejected");
      const ready = await waitForRtx(rtx);
      if (!ready.ready) throw new Error(ready.reason);
      staticSceneRegistered = true;

      const createEncoder = device.createCommandEncoder({
        label: "Depth Echo initial pack and dynamic BLAS build",
      });
      positionPacker.record(createEncoder, {
        captureSlot: -1,
        captureEnabled: false,
        unfold: 0.04,
      });
      const createLayout = rtx.vulkanImageLayouts.general;
      dynamicMesh = rtx.createDynamicTriangleMesh({
        commandEncoder: createEncoder,
        positionsTexture: positionPacker.texture,
        positionsVulkanLayout: createLayout,
        vertexCount: DYNAMIC_VERTEX_COUNT,
        indices: makeIndices(),
      });
      if (!dynamicMesh) throw new Error("dynamic triangle mesh creation returned no handle");
      device.queue.submit([createEncoder.finish()]);
      state.rtxActive = true;
      state.rtxReason = "";
      keyLight.castShadow = false;
      keyLight.intensity = 0.44;
      for (const mesh of [currentMesh, ...echoMeshes]) mesh.castShadow = false;
      console.log(
        "[RTX Depth Echo] dynamic RTX ready · " +
        DYNAMIC_VERTEX_COUNT.toLocaleString() + " vertices · " +
        DYNAMIC_TRIANGLE_COUNT.toLocaleString() + " triangles",
      );
    } catch (error) {
      state.rtxReason = error?.message || String(error);
      console.warn("[RTX Depth Echo] raster fallback: " + state.rtxReason);
    }
  } else {
    state.rtxReason = forceRaster
      ? "raster mode was explicitly requested"
      : "dynamic lighting-v1 RTX bridge is unavailable";
    console.warn("[RTX Depth Echo] raster fallback: " + state.rtxReason);
  }

  function resetLoop() {
    state.captured = 0;
    state.captureDone.fill(false);
    for (const mesh of echoMeshes) mesh.visible = false;
    positionPacker.clear();
  }

  function freezeEcho(slot) {
    echoTextures[slot].image.data.set(stagedPixels);
    echoTextures[slot].needsUpdate = true;
    echoMeshes[slot].visible = true;
    state.captureDone[slot] = true;
    state.captured = Math.max(state.captured, slot + 1);
  }

  async function startCamera() {
    if (state.cameraStarting || state.video) return;
    state.cameraStarting = true;
    state.cameraError = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      const deadline = performance.now() + 5000;
      let frame = cameraFrame(video);
      while (!frame && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 16));
        frame = cameraFrame(video);
      }
      if (!frame) throw new Error("camera opened but produced no RGBA frame");
      state.stream = stream;
      state.video = video;
      state.source = video;
      state.sourceLabel = LIVE_LABEL;
      estimator.reset();
      console.log("[RTX Depth Echo] live camera active; heuristic relief remains non-neural and non-metric.");
    } catch (error) {
      state.cameraError = error?.message || String(error);
      state.sourceLabel = STAGED_LABEL;
      console.warn("[RTX Depth Echo] camera unavailable; staged fallback retained: " + state.cameraError);
    } finally {
      state.cameraStarting = false;
    }
  }

  function onKeyDown(event) {
    const key = String(event.key || "").toLowerCase();
    if (key === "c") startCamera();
    if (key === "q") state.raysEnabled = !state.raysEnabled;
    if (key === "d") {
      state.debug = !state.debug;
      currentMaterial.wireframe = state.debug;
      currentMaterial.needsUpdate = true;
      for (const mesh of echoMeshes) {
        mesh.material.wireframe = state.debug;
        mesh.material.needsUpdate = true;
      }
    }
    if (key === "r") {
      state.loopStart = performance.now();
      state.loopNumber = -1;
      resetLoop();
    }
  }
  globalThis.addEventListener("keydown", onKeyDown);
  if (new URLSearchParams(globalThis.location?.search || "").get("live") === "1") {
    startCamera();
  }

  function updateChoreography(time) {
    let unfold = 1;
    if (time < 2) unfold = 0.035 + smooth01(time / 2) * 0.12;
    else if (time < 4) unfold = 0.15 + smooth01((time - 2) / 2) * 0.85;
    else if (time > 10.3) unfold = 1 - smooth01((time - 10.3) / 1.7) * 0.10;
    unfoldNode.value = unfold;

    const orbit = time < 4
      ? smooth01(time / 4) * 0.6
      : time < 9
        ? 0.6 + smooth01((time - 4) / 5) * 5.5
        : 6.1 - smooth01((time - 9) / 3) * 3.4;
    const cameraZ = time < 7 ? 11.8 - smooth01(time / 7) * 1.6 : 10.2;
    camera.position.set(orbit, 1.05 + Math.sin(time * 0.55) * 0.22, cameraZ);
    camera.lookAt(0, -0.05, -1.55);

    probeLight.position.set(
      Math.sin(time * 1.22) * 3.55,
      -Math.cos(time * 1.22) * 2.25,
      2.2 + Math.cos(time * 0.63) * 1.2,
    );
    return unfold;
  }

  let frameBusy = false;
  let lastHudUpdate = 0;
  async function renderFrame(now) {
    const elapsed = Math.max(0, (now - state.loopStart) / 1000);
    const loopNumber = Math.floor(elapsed / LOOP_SECONDS);
    const loopTime = elapsed % LOOP_SECONDS;
    if (loopNumber !== state.loopNumber) {
      state.loopNumber = loopNumber;
      resetLoop();
    }

    if (state.video) {
      const frame = cameraFrame(state.video);
      if (frame?.data && frame.width && frame.height) {
        resampleRgba(frame.data, frame.width, frame.height, stagedPixels);
        state.sourceTexture.needsUpdate = true;
      }
    } else {
      fillStagedFrame(stagedPixels, elapsed);
      state.sequence += 1;
      stagedSource.sequence = state.sequence;
      state.sourceTexture.needsUpdate = true;
    }

    const unfold = updateChoreography(loopTime);
    const relief = await estimator.update({
      source: state.source,
      mirrorX: false,
      time: elapsed,
      force: !state.video,
    });

    let captureSlot = -1;
    for (let slot = 0; slot < CAPTURE_TIMES.length; ++slot) {
      if (!state.captureDone[slot] && loopTime >= CAPTURE_TIMES[slot]) {
        captureSlot = slot;
        freezeEcho(slot);
        break;
      }
    }

    const previousToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(renderTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.toneMapping = previousToneMapping;

    if (state.rtxActive && dynamicMesh) {
      try {
        const encoder = device.createCommandEncoder({
          label: "Depth Echo pack refit and ray-tested shadows",
        });
        positionPacker.record(encoder, {
          captureSlot,
          captureEnabled: captureSlot >= 0,
          unfold,
        });
        const currentPositionLayout = rtx.vulkanImageLayouts.general;
        rtx.refitDynamicTriangleMesh({
          commandEncoder: encoder,
          mesh: dynamicMesh,
          positionsTexture: positionPacker.texture,
          positionsVulkanLayout: currentPositionLayout,
          rebuild: false,
        });
        state.refits += 1;

        if (state.raysEnabled) {
          camera.updateMatrixWorld();
          camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
          const inverseViewProjection =
            camera.projectionMatrixInverse.clone().multiply(camera.matrixWorld).toArray();
          const elements = camera.matrixWorld.elements;
          const layouts = rtx.vulkanImageLayouts;
          const colorTexture = renderer.backend.get(renderTarget.texture).texture;
          const depthTexture = renderer.backend.get(renderTarget.depthTexture).texture;
          const result = rtx.evaluateRayLighting({
            commandEncoder: encoder,
            color: {
              texture: colorTexture,
              layout: layouts.colorAttachment,
              vulkanLayout: layouts.colorAttachment,
              left: 0,
              top: 0,
              width: targetWidth,
              height: targetHeight,
            },
            depth: {
              texture: depthTexture,
              layout: layouts.depthStencilAttachment,
              vulkanLayout: layouts.depthStencilAttachment,
              left: 0,
              top: 0,
              width: targetWidth,
              height: targetHeight,
            },
            width: targetWidth,
            height: targetHeight,
            inverseViewProjection,
            cameraPosition: [elements[12], elements[13], elements[14]],
            directionalLightDirection: [-0.48, 0.78, 0.39],
            directionalLightIntensity: 1.35,
            directionalAngularRadius: 0.008,
            directionalSampleCount: 4,
            aoSampleCount: 4,
            maxDistance: 60,
            rayBias: 0.008,
            frameIndex: 0,
            shadowStrength: 0.88,
            aoStrength: 0.14,
            aoRadius: 0.92,
            depthInverted: false,
          });
          if (result?.queued === false) throw new Error(result.reason || "ray lighting was rejected");
          state.evaluations += 1;
        }
        device.queue.submit([encoder.finish()]);
      } catch (error) {
        state.rtxActive = false;
        state.rtxReason = error?.message || String(error);
        keyLight.castShadow = true;
        keyLight.intensity = 2.8;
        for (const mesh of [currentMesh, ...echoMeshes]) mesh.castShadow = true;
        console.error("[RTX Depth Echo] dynamic RTX stopped; raster shadows restored: " + state.rtxReason);
      }
    }

    if (now - lastHudUpdate > 100) {
      lastHudUpdate = now;
      const mode = state.rtxActive
        ? (state.raysEnabled ? "DYNAMIC RTX / TEMPORAL BLAS" : "RTX A/B: RAYS DISABLED")
        : "WEBGPU RASTER SHADOW FALLBACK";
      const detail = state.rtxActive
        ? "ECHOES " + state.captured + "/4  REFITS " + state.refits + "  RAY EVALS " + state.evaluations
        : (state.rtxReason || "RTX unavailable").slice(0, 58);
      const input = state.cameraStarting ? "CAMERA STARTING..." : state.sourceLabel;
      hud.update([
        "RTX DEPTH ECHO",
        phaseFor(loopTime),
        input,
        RELIEF_LABEL,
        mode,
        detail,
        state.cameraError ? ("CAMERA: " + state.cameraError).slice(0, 58) : "C CAMERA  Q RAYS  D WIREFRAME  R RESTART",
      ]);
    }

    renderer.setRenderTarget(null);
    renderer.setMRT(null);
    renderer.render(displayScene, displayCamera);
    void relief;
  }

  renderer.setAnimationLoop(() => {
    if (frameBusy) return;
    frameBusy = true;
    renderFrame(performance.now())
      .catch(error => {
        state.frameError = error?.message || String(error);
        console.error("[RTX Depth Echo] frame failed:", error);
      })
      .finally(() => {
        frameBusy = false;
      });
  });

  function cleanup() {
    renderer.setAnimationLoop(null);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resizeTarget);
    state.stream?.getTracks?.().forEach(track => track.stop());
    if (dynamicMesh && staticSceneRegistered) {
      try {
        const encoder = device.createCommandEncoder({ label: "Depth Echo dynamic BLAS cleanup" });
        rtx.destroyDynamicTriangleMesh?.({ mesh: dynamicMesh, commandEncoder: encoder });
        device.queue.submit([encoder.finish()]);
      } catch {
        // Runtime teardown will release the device-owned object.
      }
    }
    rtx?.destroyStaticScene?.();
    positionPacker.dispose();
    estimator.dispose();
    renderTarget?.dispose();
    state.sourceTexture?.dispose();
    for (const textureValue of echoTextures) textureValue.dispose();
    hud.dispose();
    scene.traverse(object => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    displayQuad.geometry.dispose();
    displayMaterial.dispose();
    renderer.dispose();
  }
  globalThis.addEventListener("beforeunload", cleanup, { once: true });
}

main().catch(error => {
  console.error("[RTX Depth Echo] startup failed:", error);
  throw error;
});
