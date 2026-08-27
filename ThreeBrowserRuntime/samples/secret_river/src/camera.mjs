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

  const positionResponse = 6.4;
  const lookResponse = 8.2;

  camera.fov = 46;
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
      const velocity = walker.velocity ?? { x: 0, z: 0 };
      // Predict one camera time-constant ahead. At a steady walk this cancels
      // the usual follow-camera lag, so the actor stays painted into the same
      // part of the frame instead of drifting forward and snapping back.
      const leadX = Number(velocity.x || 0) / positionResponse;
      const leadZ = Number(velocity.z || 0) / positionResponse;
      // Sit over the creek looking up the bank so water fills the lower third.
      desiredPosition.set(origin.x + leadX, 1.34, origin.z - 18.4 + leadZ);
      desiredLook.set(
        origin.x + Number(velocity.x || 0) / lookResponse,
        origin.y + 0.58,
        origin.z + 1.65 + Number(velocity.z || 0) / lookResponse,
      );
      const positionSmoothing = 1 - Math.exp(-delta * positionResponse);
      const lookSmoothing = 1 - Math.exp(-delta * lookResponse);
      if (!ready) {
        position.copy(desiredPosition);
        look.copy(desiredLook);
        ready = true;
      } else {
        position.lerp(desiredPosition, positionSmoothing);
        look.lerp(desiredLook, lookSmoothing);
      }
      camera.position.copy(position);
      camera.lookAt(look);
    },
  };
}
