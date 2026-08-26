import * as THREE from "three/webgpu";

const scratchPoint = new THREE.Vector3();

function meshFrom(value) {
  return value?.mesh ?? value?.surface ?? value?.object ?? value;
}

function textureWidthFor(vertexCount) {
  if (vertexCount <= 256) return 256;
  if (vertexCount <= 512) return 512;
  if (vertexCount <= 1024) return 1024;
  return 2048;
}

/**
 * Packs the visible jelly meshes into one refittable RTX triangle stream.
 * The WebGPU meshes and native BLAS consume the same world-space transforms;
 * no distance LOD or second low-resolution silhouette is introduced.
 */
export function createJellyDynamicRayMesh(jellies, {
  radiance = [0.018, 0.007, 0.032, 1],
  surface = [0.48, 0.16, 0.68, 0.11],
} = {}) {
  const entries = [];
  let vertexCount = 0;
  let indexCount = 0;

  for (const jelly of jellies ?? []) {
    const mesh = meshFrom(jelly);
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.("position");
    if (!mesh?.isMesh || !position || position.itemSize < 3 || position.count < 3) continue;
    const sourceIndex = geometry.getIndex();
    const drawableIndexCount = sourceIndex
      ? sourceIndex.count - (sourceIndex.count % 3)
      : position.count - (position.count % 3);
    if (drawableIndexCount < 3) continue;
    entries.push({
      jelly,
      mesh,
      position,
      sourceIndex,
      vertexOffset: vertexCount,
      drawableIndexCount,
    });
    vertexCount += position.count;
    indexCount += drawableIndexCount;
    // The animated jellies belong only to the refitted BLAS. Including them in
    // the immutable static snapshot would leave duplicate ghosts behind.
    mesh.userData.rtxIgnore = true;
  }
  if (entries.length === 0) throw new Error("At least one indexed jelly mesh is required for RTX refit.");

  const width = textureWidthFor(vertexCount);
  const height = Math.ceil(vertexCount / width);
  const positions = new Float32Array(width * height * 4);
  const indices = new Uint32Array(indexCount);
  let writeIndex = 0;
  for (const entry of entries) {
    const { sourceIndex, drawableIndexCount, vertexOffset } = entry;
    for (let cursor = 0; cursor < drawableIndexCount; ++cursor) {
      indices[writeIndex++] = vertexOffset + (sourceIndex ? sourceIndex.getX(cursor) : cursor);
    }
  }

  const descriptor = Object.freeze({
    width,
    height,
    vertexCount,
    positions,
    indices,
    reflectionMaterial: Object.freeze({
      radiance: Object.freeze([...radiance]),
      surface: Object.freeze([...surface]),
    }),
  });

  let updateCount = 0;
  function update() {
    for (const entry of entries) {
      entry.mesh.updateWorldMatrix(true, false);
      const matrix = entry.mesh.matrixWorld;
      for (let vertex = 0; vertex < entry.position.count; ++vertex) {
        scratchPoint.fromBufferAttribute(entry.position, vertex).applyMatrix4(matrix);
        const target = (entry.vertexOffset + vertex) * 4;
        positions[target] = scratchPoint.x;
        positions[target + 1] = scratchPoint.y;
        positions[target + 2] = scratchPoint.z;
        positions[target + 3] = 1;
      }
    }
    updateCount += 1;
    return true;
  }
  update();

  return Object.freeze({
    descriptor,
    update,
    stats() {
      return {
        jellyCount: entries.length,
        vertexCount,
        triangleCount: indices.length / 3,
        textureWidth: width,
        textureHeight: height,
        updateCount,
      };
    },
  });
}

export default createJellyDynamicRayMesh;
