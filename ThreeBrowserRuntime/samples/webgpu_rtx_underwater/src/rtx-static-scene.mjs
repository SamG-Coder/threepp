import * as THREE from "three/webgpu";

const _instanceMatrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();
const _position = new THREE.Vector3();

function appendMesh(mesh, positions, indices) {
  const geometry = mesh.geometry;
  const attribute = geometry?.getAttribute?.("position");
  if (!attribute || attribute.itemSize < 3 || attribute.count < 3) return;

  const geometryIndex = geometry.getIndex();
  const instanceCount = mesh.isInstancedMesh ? mesh.count : 1;

  for (let instance = 0; instance < instanceCount; ++instance) {
    if (mesh.isInstancedMesh) {
      mesh.getMatrixAt(instance, _instanceMatrix);
      _worldMatrix.multiplyMatrices(mesh.matrixWorld, _instanceMatrix);
    } else {
      _worldMatrix.copy(mesh.matrixWorld);
    }

    const vertexOffset = positions.length / 3;
    for (let vertex = 0; vertex < attribute.count; ++vertex) {
      _position.fromBufferAttribute(attribute, vertex).applyMatrix4(_worldMatrix);
      positions.push(_position.x, _position.y, _position.z);
    }

    if (geometryIndex) {
      for (let index = 0; index < geometryIndex.count; ++index) {
        indices.push(vertexOffset + geometryIndex.getX(index));
      }
    } else {
      const triangleVertexCount = attribute.count - (attribute.count % 3);
      for (let index = 0; index < triangleVertexCount; ++index) {
        indices.push(vertexOffset + index);
      }
    }
  }
}

/**
 * Flatten a deliberately static subset of the Three.js scene into world-space
 * indexed triangles for the native Vulkan BLAS. This is a snapshot, not a
 * second renderer: animated/skinned/deformed objects must be omitted until the
 * bridge grows an explicit refit/update path.
 */
export function collectStaticTriangleScene(objects) {
  const positions = [];
  const indices = [];
  const visited = new Set();

  for (const object of objects) {
    if (!object || visited.has(object)) continue;
    object.updateWorldMatrix(true, true);
    object.traverse?.(child => {
      if (visited.has(child) || child.userData?.rtxIgnore) return;
      visited.add(child);
      if (!child.isMesh && !child.isInstancedMesh) return;
      if (child.isSkinnedMesh || child.morphTargetInfluences) return;
      appendMesh(child, positions, indices);
    });
  }

  if (positions.length === 0 || indices.length === 0) {
    throw new Error("The RTX static scene does not contain any indexed triangles.");
  }
  if ((indices.length % 3) !== 0) {
    throw new Error("The RTX static scene index stream is not triangle-aligned.");
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
