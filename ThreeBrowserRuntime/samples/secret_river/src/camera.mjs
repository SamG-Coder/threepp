import * as THREE from "three/webgpu";

/**
 * Side-on cinematic camera with the creek as the bottom-of-frame anchor.
 * Sits just above the water and looks up the bank at the walker.
 */
export function createFaceOnCamera(camera, walker) {
  const position = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let ready = false;

  camera.fov = 50;
  camera.near = 0.2;
  camera.far = 280;
  camera.updateProjectionMatrix();

  return {
    resize(width, height) {
      camera.aspect = Math.max(0.5, width / Math.max(1, height));
      camera.updateProjectionMatrix();
    },
    update(delta) {
      const origin = walker.position;
      // Sit over the creek looking up the bank so water fills the lower third.
      desiredPosition.set(origin.x, 1.28, origin.z - 16.8);
      desiredLook.set(origin.x, origin.y + 0.55, origin.z + 1.4);
      const smoothing = 1 - Math.exp(-delta * 5.4);
      if (!ready) {
        position.copy(desiredPosition);
        look.copy(desiredLook);
        ready = true;
      } else {
        position.lerp(desiredPosition, smoothing);
        look.lerp(desiredLook, smoothing);
      }
      camera.position.copy(position);
      camera.lookAt(look);
    },
  };
}
