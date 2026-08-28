import * as THREE from "three/webgpu";

/**
 * A map-friendly 2.5D camera. It keeps enough elevation and lateral offset to
 * reveal bends and junctions in both world axes, while remaining shallow
 * enough for the painted character and scenery cards to read as artwork.
 */
export function createMappedObliqueCamera(camera, walker, options = {}) {
  const position = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let ready = false;

  const lateral = Number(options.lateral ?? 7.5);
  const height = Number(options.height ?? 10.8);
  const distance = Number(options.distance ?? 18.5);
  const lookHeight = Number(options.lookHeight ?? 0.72);
  const positionResponse = Number(options.positionResponse ?? 5.8);
  const lookResponse = Number(options.lookResponse ?? 7.6);

  camera.fov = Number(options.fov ?? 43);
  camera.near = Number(options.near ?? 0.15);
  camera.far = Number(options.far ?? 720);
  camera.updateProjectionMatrix();

  return {
    snap() {
      ready = false;
    },
    resize(width, viewportHeight) {
      camera.aspect = Math.max(0.5, width / Math.max(1, viewportHeight));
      camera.updateProjectionMatrix();
    },
    update(delta) {
      const origin = walker.position;
      const velocity = walker.velocity ?? { x: 0, z: 0 };
      const leadX = Number(velocity.x || 0) / positionResponse;
      const leadZ = Number(velocity.z || 0) / positionResponse;

      desiredPosition.set(
        origin.x + lateral + leadX,
        origin.y + height,
        origin.z - distance + leadZ,
      );
      desiredLook.set(
        origin.x + Number(velocity.x || 0) / lookResponse,
        origin.y + lookHeight,
        origin.z + Number(velocity.z || 0) / lookResponse,
      );

      const positionSmoothing = 1 - Math.exp(-Math.max(0, delta) * positionResponse);
      const lookSmoothing = 1 - Math.exp(-Math.max(0, delta) * lookResponse);
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
